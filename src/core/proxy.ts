import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";
import type { Account, ActivityEvent, ProviderId } from "./types.js";
import { planRequest, type RuntimeSnapshot } from "./plan.js";
import { messagesUrl, providerSpec } from "./providers.js";
import { CODEX_OAUTH } from "./oauth-codex.js";
import { anthropicToCloudCode, CloudCodeStream, cloudCodeToAnthropic } from "./cloudcode.js";
import { windowsFromHeaders, worstPercent } from "./quota.js";
import {
  anthropicError,
  anthropicToChatCompletions,
  anthropicToResponses,
  chatCompletionToAnthropic,
  OpenAiChatStream,
  ResponsesStream,
  responsesToAnthropic,
  usageFromUnknown,
} from "./translate.js";
import { emptyUsage, type TokenUsage } from "./cost.js";
import { translate } from "./i18n.js";

export interface UpstreamResult {
  status: number;
  headers: Record<string, string>;
  body?: Buffer;
  stream?: AsyncIterable<Buffer>;
}

export interface UpstreamRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Buffer;
  signal?: AbortSignal;
}

export type Upstream = (request: UpstreamRequest) => Promise<UpstreamResult>;

export interface ProxyDeps {
  getState: () => RuntimeSnapshot;
  /** Resolve a secret for an account. Return null when it is missing. */
  getSecret: (account: Account) => Promise<string | null>;
  upstream?: Upstream;
  onQuota: (accountId: string, percent: number | null, windows: ReturnType<typeof windowsFromHeaders>) => void;
  onUsage: (accountId: string, model: string, usage: TokenUsage) => void;
  onSwitch: (provider: ProviderId, from: string, to: string, reason: string) => void;
  onActivity: (event: ActivityEvent) => void;
  onCooldown: (accountId: string, until: number) => void;
  rememberActive: (provider: ProviderId, accountId: string) => void;
}

export interface RunningProxy {
  server: Server;
  port: number;
  close: () => Promise<void>;
}

const MAX_BODY = 32 * 1024 * 1024;

export function nodeUpstream(request: UpstreamRequest): Promise<UpstreamResult> {
  const url = new URL(request.url);
  const lib = url.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = lib(
      url,
      { method: request.method, headers: request.headers },
      (res) => {
        const headers: Record<string, string> = {};
        for (const [key, value] of Object.entries(res.headers)) {
          if (value == null) continue;
          headers[key] = Array.isArray(value) ? value.join(", ") : value;
        }
        const status = res.statusCode ?? 0;
        const contentType = headers["content-type"] ?? "";
        const streaming = contentType.includes("text/event-stream");
        if (streaming) {
          resolve({ status, headers, stream: res });
          return;
        }
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => resolve({ status, headers, body: Buffer.concat(chunks) }));
      },
    );
    const abort = () => req.destroy(new Error("client aborted"));
    request.signal?.addEventListener("abort", abort, { once: true });
    req.on("error", reject);
    req.setTimeout(180_000, () => req.destroy(new Error("upstream timeout")));
    req.end(request.body);
  });
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY) throw new Error("body too large");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.destroyed || res.writableEnded || res.headersSent) return;
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "anthropic-version": "2023-06-01",
  });
  res.end(payload);
}

/** Drop CR/LF so a client header cannot inject extra upstream headers. */
export function safeHeader(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value.join(", ") : value;
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 512 || /[\r\n\0]/.test(trimmed)) return undefined;
  return trimmed;
}

function discardUpstream(result: UpstreamResult | undefined): void {
  const stream = result?.stream as { destroy?: () => void; return?: () => Promise<unknown> } | undefined;
  if (!stream) return;
  if (typeof stream.destroy === "function") {
    stream.destroy();
    return;
  }
  if (typeof stream.return === "function") void stream.return();
}

export async function startProxy(deps: ProxyDeps, port = 0): Promise<RunningProxy> {
  const upstream = deps.upstream ?? nodeUpstream;
  const server = createServer((req, res) => {
    void handle(req, res, deps, upstream).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "proxy error";
      if (!res.headersSent) writeJson(res, 500, JSON.parse(anthropicError(message)));
      else res.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  const bound = typeof address === "object" && address ? address.port : port;
  return {
    server,
    port: bound,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

async function handle(req: IncomingMessage, res: ServerResponse, deps: ProxyDeps, upstream: Upstream): Promise<void> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (req.method === "GET" && (url.pathname === "/health" || url.pathname === "/")) {
    const state = deps.getState();
    writeJson(res, 200, {
      ok: true,
      service: "claude-account-pilot",
      proxy: true,
      accounts: state.config.accounts.length,
      threshold: state.config.switchThreshold,
    });
    return;
  }
  if (req.method === "POST" && url.pathname === "/v1/messages/count_tokens") {
    const raw = await readBody(req);
    let tokens = 0;
    try {
      tokens = Math.ceil(raw.length / 4);
    } catch {
      tokens = 0;
    }
    writeJson(res, 200, { input_tokens: tokens });
    return;
  }
  if (req.method === "POST" && url.pathname === "/v1/messages") {
    await handleMessages(req, res, deps, upstream);
    return;
  }
  writeJson(res, 404, JSON.parse(anthropicError(`No route for ${req.method ?? "GET"} ${url.pathname}`, "not_found_error")));
}

async function handleMessages(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ProxyDeps,
  upstream: Upstream,
): Promise<void> {
  const raw = await readBody(req);
  let body: Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw.toString("utf8")) as unknown;
    if (!parsed || typeof parsed !== "object") throw new Error("not an object");
    body = parsed as Record<string, unknown>;
  } catch {
    writeJson(res, 400, JSON.parse(anthropicError("The request body was not JSON.", "invalid_request_error")));
    return;
  }
  const requested = typeof body.model === "string" && body.model ? body.model : "claude";
  let state = deps.getState();
  let plan = planRequest(state, requested);
  if (plan.kind !== "forward") {
    const lang = state.config.lang ?? "en";
    const provider = plan.kind === "provider-off" ? "claude" : plan.provider;
    const message =
      plan.kind === "unsupported"
        ? translate(lang, "error.unsupported", { provider })
        : translate(lang, "error.noAccount", { provider });
    writeJson(res, 409, JSON.parse(anthropicError(message, "invalid_request_error")));
    return;
  }

  const avoid: string[] = [];
  const controllers: AbortController[] = [];
  res.on("close", () => {
    for (const controller of controllers) controller.abort();
  });
  const send = async (current: Extract<typeof plan, { kind: "forward" }>, attemptsLeft: number): Promise<void> => {
    const failOver = async (): Promise<boolean> => {
      if (attemptsLeft <= 0 || res.destroyed || res.writableEnded) return false;
      avoid.push(current.account.id);
      state = deps.getState();
      const retry = planRequest(state, requested, Date.now(), avoid);
      if (retry.kind !== "forward" || retry.account.id === current.account.id) return false;
      deps.onActivity({
        at: new Date().toISOString(),
        key: "log.failover",
        vars: { account: current.account.label },
      });
      await send({ ...retry, switched: true, reason: "next-available" }, attemptsLeft - 1);
      return true;
    };
    const secret = await deps.getSecret(current.account);
    if (!secret || /[\r\n\0]/.test(secret)) {
      if (await failOver()) return;
      const lang = deps.getState().config.lang ?? "en";
      writeJson(
        res,
        409,
        JSON.parse(anthropicError(translate(lang, "error.noAccount", { provider: current.provider }), "authentication_error")),
      );
      return;
    }
    if (current.switched) {
      const previous = state.activeByProvider[current.provider] ?? "";
      deps.onSwitch(current.provider, previous, current.account.label, current.reason);
      deps.onActivity({
        at: new Date().toISOString(),
        key: "log.switch",
        vars: { provider: current.provider, from: previous || "—", to: current.account.label, reason: current.reason },
      });
    }
    deps.rememberActive(current.provider, current.account.id);
    deps.onActivity({
      at: new Date().toISOString(),
      key: "log.request",
      vars: {
        requested,
        target: current.model,
        provider: current.provider,
        account: current.account.label,
      },
    });

    const spec = providerSpec(current.provider, current.account.baseUrl);
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: body.stream ? "text/event-stream" : "application/json",
    };
    if (current.provider === "claude" && current.account.authKind === "oauth") {
      headers.authorization = `Bearer ${secret}`;
    } else if (spec.auth === "x-api-key") {
      headers["x-api-key"] = secret;
      headers["anthropic-version"] = "2023-06-01";
    } else if (spec.auth === "bearer") {
      headers.authorization = `Bearer ${secret}`;
    }
    if (current.provider === "codex") {
      const accountId = safeHeader(current.account.externalId);
      if (accountId) headers["chatgpt-account-id"] = accountId;
      headers.originator = CODEX_OAUTH.originator;
      headers.version = CODEX_OAUTH.version;
      headers["openai-beta"] = "responses=experimental";
      headers["user-agent"] = `${CODEX_OAUTH.originator}/${CODEX_OAUTH.version}`;
    }
    const beta = safeHeader(req.headers["anthropic-beta"]);
    if (beta && current.protocol === "anthropic") headers["anthropic-beta"] = beta;

    let upstreamBody: Record<string, unknown> = body;
    if (current.protocol === "openai-chat") upstreamBody = anthropicToChatCompletions(body, current.model);
    if (current.protocol === "openai-responses") {
      upstreamBody = anthropicToResponses(body, current.model);
      if (current.provider === "codex") delete upstreamBody.max_output_tokens;
    }
    if (current.protocol === "cloudcode") upstreamBody = anthropicToCloudCode(body, current.model, current.account.externalId);

    const controller = new AbortController();
    controllers.push(controller);
    let result: UpstreamResult | undefined;
    try {
      result = await upstream({
        url: messagesUrl(spec, Boolean(body.stream)),
        method: "POST",
        headers,
        body: Buffer.from(JSON.stringify(upstreamBody)),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted || res.destroyed || res.writableEnded) return;
      if (await failOver()) return;
      const message = error instanceof Error ? error.message : "upstream failed";
      writeJson(res, 502, JSON.parse(anthropicError(message)));
      return;
    }

    const windows = windowsFromHeaders(result.headers);
    const percent = worstPercent(windows);
    if (percent != null) deps.onQuota(current.account.id, percent, windows);

    if (result.status === 429 || result.status >= 500) {
      if (result.status === 429 && percent != null && percent >= state.config.switchThreshold) {
        deps.onQuota(current.account.id, 100, windows.length ? windows : [{ label: "5h", percent: 100 }]);
      } else if (result.status === 429) {
        deps.onCooldown(current.account.id, Date.now() + 60_000);
      }
      discardUpstream(result);
      if (await failOver()) return;
    }

    if (current.protocol === "anthropic") {
      await pipeAnthropic(res, result, current.account.id, current.model, deps);
      return;
    }
    if (body.stream && result.stream) {
      await pipeTranslatedStream(res, result, current, deps);
      return;
    }
    const text = result.body?.toString("utf8") ?? "";
    let payload: unknown = {};
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      writeJson(res, result.status || 502, JSON.parse(anthropicError(text.slice(0, 500) || "empty upstream")));
      return;
    }
    if (result.status >= 400) {
      writeJson(res, result.status, JSON.parse(anthropicError(text.slice(0, 500) || `upstream ${result.status}`)));
      return;
    }
    const message =
      current.protocol === "openai-responses"
        ? responsesToAnthropic(payload, current.model)
        : current.protocol === "cloudcode"
          ? cloudCodeToAnthropic(payload, current.model)
          : chatCompletionToAnthropic(payload, current.model);
    deps.onUsage(current.account.id, current.model, {
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      cacheReadTokens: message.usage.cache_read_input_tokens,
      cacheWriteTokens: message.usage.cache_creation_input_tokens,
    });
    writeJson(res, 200, message);
  };

  await send(plan, 5);
}

async function pipeAnthropic(
  res: ServerResponse,
  result: UpstreamResult,
  accountId: string,
  model: string,
  deps: ProxyDeps,
): Promise<void> {
  if (result.stream) {
    res.writeHead(result.status || 200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    let buffered = "";
    for await (const chunk of result.stream) {
      const text = chunk.toString("utf8");
      buffered = (buffered + text).slice(-200_000);
      res.write(chunk);
    }
    res.end();
    const usage = usageFromSse(buffered);
    if (usage.inputTokens || usage.outputTokens) deps.onUsage(accountId, model, usage);
    return;
  }
  const text = result.body?.toString("utf8") ?? "";
  if (result.status >= 400) {
    writeJson(res, result.status, text ? tryJson(text) : JSON.parse(anthropicError("upstream error")));
    return;
  }
  try {
    const payload = JSON.parse(text) as Record<string, unknown>;
    deps.onUsage(accountId, model, usageFromUnknown(payload.usage));
  } catch {
    /* non-json success still passes through */
  }
  res.writeHead(result.status || 200, { "content-type": "application/json; charset=utf-8" });
  res.end(text);
}

async function pipeTranslatedStream(
  res: ServerResponse,
  result: UpstreamResult,
  plan: { protocol: string; model: string; account: Account },
  deps: ProxyDeps,
): Promise<void> {
  if (result.status >= 400 || !result.stream) {
    const text = result.body?.toString("utf8") ?? "";
    writeJson(res, result.status || 502, JSON.parse(anthropicError(text.slice(0, 500) || "upstream error")));
    return;
  }
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  const translator =
    plan.protocol === "openai-responses"
      ? new ResponsesStream(plan.model)
      : plan.protocol === "cloudcode"
        ? new CloudCodeStream(plan.model)
        : new OpenAiChatStream(plan.model);
  for await (const chunk of result.stream) {
    res.write(translator.push(chunk.toString("utf8")));
  }
  res.write(translator.finish());
  res.end();
  deps.onUsage(plan.account.id, plan.model, translator.usage());
}

function usageFromSse(text: string): TokenUsage {
  let usage = emptyUsage();
  for (const line of text.split("\n")) {
    if (!line.startsWith("data:")) continue;
    try {
      const json = JSON.parse(line.slice(5).trim()) as Record<string, unknown>;
      const message = json.message as Record<string, unknown> | undefined;
      const fromMessage = usageFromUnknown(message?.usage);
      const fromDelta = usageFromUnknown(json.usage);
      usage = {
        inputTokens: fromMessage.inputTokens || fromDelta.inputTokens || usage.inputTokens,
        outputTokens: fromDelta.outputTokens || fromMessage.outputTokens || usage.outputTokens,
        cacheReadTokens: fromMessage.cacheReadTokens || fromDelta.cacheReadTokens || usage.cacheReadTokens,
        cacheWriteTokens: fromMessage.cacheWriteTokens || fromDelta.cacheWriteTokens || usage.cacheWriteTokens,
      };
    } catch {
      /* ignore partial frames */
    }
  }
  return usage;
}

function tryJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return JSON.parse(anthropicError(text.slice(0, 500)));
  }
}

