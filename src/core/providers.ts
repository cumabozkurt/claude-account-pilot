import type { ProviderId } from "./types.js";

export type UpstreamProtocol = "anthropic" | "openai-chat" | "openai-responses" | "unsupported";

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
    protocol: "unsupported",
    baseUrl: "",
    auth: "none",
  },
};

export function providerSpec(id: ProviderId, baseUrl?: string): ProviderSpec {
  const spec = PROVIDERS[id];
  if (!baseUrl) return spec;
  return { ...spec, baseUrl: baseUrl.replace(/\/+$/, "") };
}

export function messagesUrl(spec: ProviderSpec): string {
  if (spec.protocol === "anthropic") return `${spec.baseUrl}/v1/messages`;
  if (spec.protocol === "openai-chat") {
    const base = spec.baseUrl.replace(/\/$/, "");
    return base.endsWith("/v1") ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
  }
  if (spec.protocol === "openai-responses") {
    const base = spec.baseUrl.replace(/\/$/, "");
    return base.endsWith("/responses") ? base : `${base}/responses`;
  }
  return spec.baseUrl;
}
