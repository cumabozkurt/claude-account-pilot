import { createHash, randomUUID } from "node:crypto";
import { emptyUsage, type TokenUsage } from "./cost.js";
import { OpenAiChatStream, type AnthropicMessage, usageFromUnknown } from "./translate.js";

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      if (!block || typeof block !== "object") return "";
      const record = block as Record<string, unknown>;
      if (record.type === "text" && typeof record.text === "string") return record.text;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function systemText(system: unknown): string {
  if (typeof system === "string") return system;
  return textOf(system);
}

/**
 * Anthropic Messages → the Antigravity v1internal envelope.
 * The inner `request` is Gemini generateContent. The outer fields match
 * CLIProxyAPI's geminiToAntigravity wrapper: userAgent, requestType, project.
 */
export function anthropicToCloudCode(body: Record<string, unknown>, model: string, projectId?: string): Record<string, unknown> {
  const contents: Array<Record<string, unknown>> = [];
  const incoming = Array.isArray(body.messages) ? body.messages : [];
  for (const message of incoming) {
    if (!message || typeof message !== "object") continue;
    const record = message as Record<string, unknown>;
    const role = record.role === "assistant" ? "model" : "user";
    const content = record.content;
    const parts: Array<Record<string, unknown>> = [];
    if (typeof content === "string" || content == null) {
      parts.push({ text: content ?? "" });
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if (!block || typeof block !== "object") continue;
        const item = block as Record<string, unknown>;
        if (item.type === "text") parts.push({ text: String(item.text ?? "") });
        if (item.type === "tool_use") {
          parts.push({ functionCall: { name: String(item.name ?? "tool"), args: item.input ?? {} } });
        }
        if (item.type === "tool_result") {
          const response = typeof item.content === "string" ? { output: item.content } : { output: textOf(item.content) };
          parts.push({ functionResponse: { name: String(item.name ?? "tool"), response } });
        }
      }
    }
    if (parts.length === 0) parts.push({ text: "" });
    contents.push({ role, parts });
  }
  const request: Record<string, unknown> = { contents };
  const system = systemText(body.system);
  if (system) request.systemInstruction = { role: "user", parts: [{ text: system }] };
  const generation: Record<string, unknown> = {};
  if (typeof body.max_tokens === "number") generation.maxOutputTokens = body.max_tokens;
  if (typeof body.temperature === "number") generation.temperature = body.temperature;
  if (Object.keys(generation).length > 0) request.generationConfig = generation;
  if (Array.isArray(body.tools) && body.tools.length > 0) {
    request.tools = [
      {
        functionDeclarations: body.tools
          .filter((tool) => tool && typeof tool === "object")
          .map((tool) => {
            const record = tool as Record<string, unknown>;
            return {
              name: String(record.name ?? "tool"),
              description: typeof record.description === "string" ? record.description : "",
              parameters: record.input_schema ?? { type: "object", properties: {} },
            };
          }),
      },
    ];
  }
  const firstUser = contents.find((item) => item.role === "user");
  const seed = JSON.stringify(firstUser ?? {});
  const digest = createHash("sha256").update(seed).digest();
  const session = digest.readBigInt64BE(0) & 0x7fffffffffffffffn;
  request.sessionId = `-${session.toString()}`;
  const image = model.toLowerCase().includes("image");
  return {
    model,
    userAgent: "antigravity",
    requestType: image ? "image_gen" : "agent",
    requestId: image ? `image_gen/${Date.now()}/${randomUUID()}/12` : `agent-${randomUUID()}`,
    project: projectId || "pilot-local",
    request,
  };
}

function geminiUsage(metadata: unknown): TokenUsage {
  if (!metadata || typeof metadata !== "object") return emptyUsage();
  const record = metadata as Record<string, unknown>;
  return {
    inputTokens: Number(record.promptTokenCount ?? 0) || 0,
    outputTokens: Number(record.candidatesTokenCount ?? 0) || 0,
    cacheReadTokens: Number(record.cachedContentTokenCount ?? 0) || 0,
    cacheWriteTokens: 0,
  };
}

export function cloudCodeToAnthropic(payload: unknown, model: string): AnthropicMessage {
  const root = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const response =
    root.response && typeof root.response === "object" ? (root.response as Record<string, unknown>) : root;
  const candidates = Array.isArray(response.candidates) ? response.candidates : [];
  const candidate = candidates[0] && typeof candidates[0] === "object" ? (candidates[0] as Record<string, unknown>) : {};
  const contentNode =
    candidate.content && typeof candidate.content === "object" ? (candidate.content as Record<string, unknown>) : {};
  const parts = Array.isArray(contentNode.parts) ? contentNode.parts : [];
  const content: Array<Record<string, unknown>> = [];
  for (const part of parts) {
    if (!part || typeof part !== "object") continue;
    const record = part as Record<string, unknown>;
    if (typeof record.text === "string" && record.text) content.push({ type: "text", text: record.text });
    const call = record.functionCall;
    if (call && typeof call === "object") {
      const fn = call as Record<string, unknown>;
      content.push({
        type: "tool_use",
        id: `tool_${content.length}`,
        name: String(fn.name ?? "tool"),
        input: fn.args ?? {},
      });
    }
  }
  const usage = geminiUsage(response.usageMetadata);
  const hasTools = content.some((block) => block.type === "tool_use");
  return {
    id: "msg_antigravity",
    type: "message",
    role: "assistant",
    model,
    content,
    stop_reason: hasTools ? "tool_use" : candidate.finishReason === "MAX_TOKENS" ? "max_tokens" : "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      cache_read_input_tokens: usage.cacheReadTokens,
      cache_creation_input_tokens: 0,
    },
  };
}

/** Gemini SSE (possibly cumulative text) → Anthropic events, via the chat stream translator. */
export class CloudCodeStream {
  private buffer = "";
  private full = "";
  private readonly inner: OpenAiChatStream;

  constructor(model: string) {
    this.inner = new OpenAiChatStream(model);
  }

  push(chunk: string): string {
    this.buffer += chunk;
    let out = "";
    let split = this.buffer.indexOf("\n");
    while (split >= 0) {
      const line = this.buffer.slice(0, split);
      this.buffer = this.buffer.slice(split + 1);
      out += this.consumeLine(line);
      split = this.buffer.indexOf("\n");
    }
    return out;
  }

  finish(): string {
    const extra = this.buffer.trim() ? this.consumeLine(this.buffer) : "";
    this.buffer = "";
    return extra + this.inner.finish();
  }

  usage(): TokenUsage {
    return this.inner.usage();
  }

  private consumeLine(line: string): string {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return "";
    const data = trimmed.slice(5).trim();
    if (!data || data === "[DONE]") return "";
    let json: unknown;
    try {
      json = JSON.parse(data);
    } catch {
      return "";
    }
    const message = cloudCodeToAnthropic(json, this.innerModel());
    const text = message.content
      .filter((block) => block.type === "text")
      .map((block) => String(block.text ?? ""))
      .join("");
    let delta = text;
    if (text.startsWith(this.full)) delta = text.slice(this.full.length);
    this.full = text.startsWith(this.full) ? text : this.full + text;
    const tool = message.content.find((block) => block.type === "tool_use");
    const usage = usageFromUnknown({
      prompt_tokens: message.usage.input_tokens,
      completion_tokens: message.usage.output_tokens,
    });
    if (!delta && !tool && !usage.outputTokens && !usage.inputTokens) return "";
    return this.inner.push(
      `data: ${JSON.stringify({
        choices: [
          {
            index: 0,
            delta: {
              content: delta || undefined,
              tool_calls: tool
                ? [{ index: 0, id: tool.id, function: { name: tool.name, arguments: JSON.stringify(tool.input ?? {}) } }]
                : undefined,
            },
            finish_reason: message.stop_reason === "max_tokens" ? "length" : message.stop_reason === "tool_use" ? "tool_calls" : null,
          },
        ],
        usage: usage.inputTokens || usage.outputTokens ? { prompt_tokens: usage.inputTokens, completion_tokens: usage.outputTokens } : undefined,
      })}\n\n`,
    );
  }

  private innerModel(): string {
    return "antigravity";
  }
}
