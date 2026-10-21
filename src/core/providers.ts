import type { ProviderId } from "./types.js";

export type UpstreamProtocol = "anthropic" | "openai-chat" | "openai-responses" | "cloudcode" | "unsupported";

export interface ProviderSpec {
  id: ProviderId;
  protocol: UpstreamProtocol;
  /** Origin plus any base path, without a trailing slash. */
  baseUrl: string;
  auth: "x-api-key" | "bearer" | "none";
}

export const PROVIDERS: Record<ProviderId, ProviderSpec> = {
  claude: {
    id: "claude",
    protocol: "anthropic",
    baseUrl: "https://api.anthropic.com",
    auth: "x-api-key",
  },
  "opencode-go": {
    id: "opencode-go",
    protocol: "openai-chat",
    baseUrl: "https://opencode.ai/zen/go/v1",
    auth: "bearer",
  },
  deepseek: {
    id: "deepseek",
    protocol: "openai-chat",
    baseUrl: "https://api.deepseek.com",
    auth: "bearer",
  },
  codex: {
    id: "codex",
    protocol: "openai-responses",
    baseUrl: "https://chatgpt.com/backend-api/codex",
    auth: "bearer",
  },
  cursor: {
    id: "cursor",
    protocol: "unsupported",
    baseUrl: "",
    auth: "none",
  },
  antigravity: {
    id: "antigravity",
    protocol: "cloudcode",
    baseUrl: "https://daily-cloudcode-pa.googleapis.com",
    auth: "bearer",
  },
  openrouter: {
    id: "openrouter",
    protocol: "openai-chat",
    baseUrl: "https://openrouter.ai/api/v1",
    auth: "bearer",
  },
  gemini: {
    id: "gemini",
    protocol: "openai-chat",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    auth: "bearer",
  },
};

export function providerSpec(id: ProviderId, baseUrl?: string): ProviderSpec {
  const spec = PROVIDERS[id];
  if (!baseUrl) return spec;
  return { ...spec, baseUrl: baseUrl.replace(/\/+$/, "") };
}

export function messagesUrl(spec: ProviderSpec, stream = false): string {
  if (spec.protocol === "anthropic") return `${spec.baseUrl}/v1/messages`;
  if (spec.protocol === "openai-chat") {
    const base = spec.baseUrl.replace(/\/$/, "");
    if (base.endsWith("/openai")) return `${base}/chat/completions`;
    return base.endsWith("/v1") ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
  }
  if (spec.protocol === "openai-responses") {
    const base = spec.baseUrl.replace(/\/$/, "");
    return base.endsWith("/responses") ? base : `${base}/responses`;
  }
  if (spec.protocol === "cloudcode") {
    const path = stream ? "/v1internal:streamGenerateContent?alt=sse" : "/v1internal:generateContent";
    return `${spec.baseUrl.replace(/\/$/, "")}${path}`;
  }
  return spec.baseUrl;
}
