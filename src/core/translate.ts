import { emptyUsage, type TokenUsage } from "./cost.js";

export interface AnthropicMessage {
  id: string;
  type: "message";
  role: "assistant";
  model: string;
  content: Array<Record<string, unknown>>;
  stop_reason: string | null;
  stop_sequence: null;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
    cache_creation_input_tokens: number;
  };
}

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

function toolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (content == null) return "";
  if (Array.isArray(content)) return textOf(content);
  return JSON.stringify(content);
}

/** Anthropic Messages JSON → OpenAI Chat Completions JSON. */
export function anthropicToChatCompletions(body: Record<string, unknown>, model: string): Record<string, unknown> {
  const messages: Array<Record<string, unknown>> = [];
  const system = systemText(body.system);
  if (system) messages.push({ role: "system", content: system });

  const incoming = Array.isArray(body.messages) ? body.messages : [];
  for (const message of incoming) {
    if (!message || typeof message !== "object") continue;
    const record = message as Record<string, unknown>;
    const role = record.role === "assistant" ? "assistant" : "user";
    const content = record.content;
    if (typeof content === "string" || content == null) {
      messages.push({ role, content: content ?? "" });
      continue;
    }
    if (!Array.isArray(content)) {
      messages.push({ role, content: String(content) });
      continue;
    }
    const blocks = content.filter((block) => block && typeof block === "object") as Array<Record<string, unknown>>;
    if (role === "assistant") {
      const text = blocks
        .filter((block) => block.type === "text")
        .map((block) => String(block.text ?? ""))
        .join("");
      const toolCalls = blocks
        .filter((block) => block.type === "tool_use")
        .map((block) => ({
          id: String(block.id ?? "tool"),
          type: "function",
          function: {
            name: String(block.name ?? "tool"),
            arguments: JSON.stringify(block.input ?? {}),
          },
        }));
      const assistant: Record<string, unknown> = { role: "assistant", content: text || null };
      if (toolCalls.length > 0) assistant.tool_calls = toolCalls;
      messages.push(assistant);
      continue;
    }
    const toolResults = blocks.filter((block) => block.type === "tool_result");
    for (const result of toolResults) {
      messages.push({
        role: "tool",
        tool_call_id: String(result.tool_use_id ?? ""),
        content: toolResultText(result.content),
      });
    }
    const text = blocks
      .filter((block) => block.type === "text")
      .map((block) => String(block.text ?? ""))
      .join("\n");
    if (text) messages.push({ role: "user", content: text });
    if (!text && toolResults.length === 0) messages.push({ role: "user", content: textOf(blocks) });
  }

  const out: Record<string, unknown> = {
    model,
    messages,
    stream: Boolean(body.stream),
  };
  if (body.stream) out.stream_options = { include_usage: true };
  if (typeof body.max_tokens === "number") out.max_tokens = body.max_tokens;
  if (typeof body.temperature === "number") out.temperature = body.temperature;
  if (Array.isArray(body.tools)) {
    out.tools = body.tools
      .filter((tool) => tool && typeof tool === "object")
      .map((tool) => {
        const record = tool as Record<string, unknown>;
        return {
          type: "function",
          function: {
            name: String(record.name ?? "tool"),
            description: typeof record.description === "string" ? record.description : "",
            parameters: record.input_schema ?? { type: "object", properties: {} },
          },
        };
      });
  }
  return out;
}

function stopReason(finish: unknown, hasTools: boolean): string {
  if (hasTools) return "tool_use";
  if (finish === "length") return "max_tokens";
  return "end_turn";
}

export function usageFromUnknown(usage: unknown): TokenUsage {
  if (!usage || typeof usage !== "object") return emptyUsage();
  const record = usage as Record<string, unknown>;
  const details = record.prompt_tokens_details;
  const cached =
    details && typeof details === "object"
      ? Number((details as Record<string, unknown>).cached_tokens ?? 0)
      : Number(record.cache_read_input_tokens ?? record.cache_read_tokens ?? 0);
  const cacheWrite = Number(record.cache_creation_input_tokens ?? record.cache_write_tokens ?? 0);
  return {
    inputTokens: numberOr(record.input_tokens ?? record.prompt_tokens),
    outputTokens: numberOr(record.output_tokens ?? record.completion_tokens),
    cacheReadTokens: numberOr(cached),
    cacheWriteTokens: numberOr(cacheWrite),
  };
}

function numberOr(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function chatCompletionToAnthropic(payload: unknown, model: string): AnthropicMessage {
  const root = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const choice = Array.isArray(root.choices) ? (root.choices[0] as Record<string, unknown> | undefined) : undefined;
  const message =
    choice?.message && typeof choice.message === "object"
      ? (choice.message as Record<string, unknown>)
      : {};
  const content: Array<Record<string, unknown>> = [];
  if (typeof message.content === "string" && message.content) {
    content.push({ type: "text", text: message.content });
  }
  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  for (const call of toolCalls) {
    if (!call || typeof call !== "object") continue;
    const record = call as Record<string, unknown>;
    const fn =
      record.function && typeof record.function === "object"
        ? (record.function as Record<string, unknown>)
        : {};
    let input: unknown = {};
    if (typeof fn.arguments === "string") {
      try {
        input = JSON.parse(fn.arguments);
      } catch {
        input = { raw: fn.arguments };
      }
    }
    content.push({
      type: "tool_use",
      id: String(record.id ?? "tool"),
      name: String(fn.name ?? "tool"),
      input,
    });
  }
  const usage = usageFromUnknown(root.usage);
  return {
    id: String(root.id ?? "msg_pilot"),
    type: "message",
    role: "assistant",
    model,
    content,
    stop_reason: stopReason(choice?.finish_reason, toolCalls.length > 0),
    stop_sequence: null,
    usage: {
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      cache_read_input_tokens: usage.cacheReadTokens,
      cache_creation_input_tokens: usage.cacheWriteTokens,
    },
  };
}

/** Anthropic Messages → OpenAI Responses, used for a Codex subscription login. */
export function anthropicToResponses(body: Record<string, unknown>, model: string): Record<string, unknown> {
  const chat = anthropicToChatCompletions(body, model);
  const messages = Array.isArray(chat.messages) ? chat.messages : [];
  const input: Array<Record<string, unknown>> = [];
  for (const message of messages) {
    const record = message as Record<string, unknown>;
    if (record.role === "tool") {
      input.push({
        type: "function_call_output",
        call_id: String(record.tool_call_id ?? ""),
        output: String(record.content ?? ""),
      });
      continue;
    }
    if (Array.isArray(record.tool_calls)) {
      if (typeof record.content === "string" && record.content) {
        input.push({
          role: "assistant",
          content: [{ type: "output_text", text: record.content }],
        });
      }
      for (const call of record.tool_calls) {
        const tool = call as Record<string, unknown>;
        const fn = (tool.function ?? {}) as Record<string, unknown>;
        input.push({
          type: "function_call",
          call_id: String(tool.id ?? ""),
          name: String(fn.name ?? ""),
          arguments: String(fn.arguments ?? "{}"),
        });
      }
      continue;
    }
    const type = record.role === "assistant" ? "output_text" : "input_text";
    input.push({
      role: record.role,
      content: [{ type, text: String(record.content ?? "") }],
    });
  }
  const out: Record<string, unknown> = {
    model,
    input,
    stream: Boolean(body.stream),
  };
  if (typeof body.max_tokens === "number") out.max_output_tokens = body.max_tokens;
  if (Array.isArray(chat.tools)) {
    out.tools = (chat.tools as Array<Record<string, unknown>>).map((tool) => {
      const fn = (tool.function ?? {}) as Record<string, unknown>;
      return {
        type: "function",
        name: fn.name,
        description: fn.description,
        parameters: fn.parameters,
      };
    });
  }
  return out;
}

export function responsesToAnthropic(payload: unknown, model: string): AnthropicMessage {
  const root = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const output = Array.isArray(root.output) ? root.output : [];
  const content: Array<Record<string, unknown>> = [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (record.type === "function_call") {
      let input: unknown = {};
      if (typeof record.arguments === "string") {
        try {
          input = JSON.parse(record.arguments);
        } catch {
          input = { raw: record.arguments };
        }
      }
      content.push({
        type: "tool_use",
        id: String(record.call_id ?? record.id ?? "tool"),
        name: String(record.name ?? "tool"),
        input,
      });
      continue;
    }
    const parts = Array.isArray(record.content) ? record.content : [];
    for (const part of parts) {
      if (!part || typeof part !== "object") continue;
      const block = part as Record<string, unknown>;
      if (typeof block.text === "string" && block.text) content.push({ type: "text", text: block.text });
    }
  }
  const usage = usageFromUnknown(root.usage);
  const hasTools = content.some((block) => block.type === "tool_use");
  return {
    id: String(root.id ?? "msg_pilot"),
    type: "message",
    role: "assistant",
    model,
    content,
    stop_reason: hasTools ? "tool_use" : "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      cache_read_input_tokens: usage.cacheReadTokens,
      cache_creation_input_tokens: usage.cacheWriteTokens,
    },
  };
}

interface ToolBuild {
  id: string;
  name: string;
  args: string;
  open: boolean;
}

/**
 * Turns an OpenAI chat-completions SSE stream into Anthropic Messages SSE.
 * `push` accepts arbitrary chunks; call `finish` when the upstream ends.
 */
export class OpenAiChatStream {
  private buffer = "";
  private started = false;
  private textOpen = false;
  private nextIndex = 0;
  private readonly tools = new Map<number, ToolBuild>();
  private inputTokens = 0;
  private outputTokens = 0;
  private stop: string | null = null;
  readonly messageId: string;

  constructor(
    private readonly model: string,
    messageId = `msg_pilot_${Math.random().toString(36).slice(2, 10)}`,
  ) {
    this.messageId = messageId;
  }

  push(chunk: string): string {
    this.buffer += chunk;
    let out = "";
    let split = this.buffer.indexOf("\n\n");
    while (split >= 0) {
      const frame = this.buffer.slice(0, split);
      this.buffer = this.buffer.slice(split + 2);
      out += this.consume(frame);
      split = this.buffer.indexOf("\n\n");
    }
    return out;
  }

  usage(): TokenUsage {
    return {
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    };
  }

  finish(): string {
    let out = "";
    if (this.buffer.trim()) {
      out += this.consume(this.buffer);
      this.buffer = "";
    }
    out += this.closeOpen();
    out += sse("message_delta", {
      type: "message_delta",
      delta: { stop_reason: this.stop ?? "end_turn", stop_sequence: null },
      usage: { output_tokens: this.outputTokens },
    });
    out += sse("message_stop", { type: "message_stop" });
    return out;
  }

  private consume(frame: string): string {
    const data = frame
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("");
    if (!data || data === "[DONE]") return "";
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return "";
    }
    const usage = usageFromUnknown(json.usage);
    if (usage.inputTokens) this.inputTokens = usage.inputTokens;
    if (usage.outputTokens) this.outputTokens = usage.outputTokens;
    const choice = Array.isArray(json.choices) ? (json.choices[0] as Record<string, unknown>) : undefined;
    if (!choice) return this.ensureStart();
    if (typeof choice.finish_reason === "string") {
      const calls = this.tools.size > 0;
      this.stop = stopReason(choice.finish_reason, calls);
    }
    const delta =
      choice.delta && typeof choice.delta === "object" ? (choice.delta as Record<string, unknown>) : {};
    let out = this.ensureStart();
    if (typeof delta.content === "string" && delta.content) {
      if (!this.textOpen) {
        out += sse("content_block_start", {
          type: "content_block_start",
          index: this.nextIndex,
          content_block: { type: "text", text: "" },
        });
        this.textOpen = true;
        this.nextIndex += 1;
      }
      out += sse("content_block_delta", {
        type: "content_block_delta",
        index: this.nextIndex - 1,
        delta: { type: "text_delta", text: delta.content },
      });
    }
    if (Array.isArray(delta.tool_calls)) {
      if (this.textOpen) {
        out += sse("content_block_stop", { type: "content_block_stop", index: this.nextIndex - 1 });
        this.textOpen = false;
      }
      for (const call of delta.tool_calls) {
        if (!call || typeof call !== "object") continue;
        const record = call as Record<string, unknown>;
        const index = Number(record.index ?? 0);
        const fn =
          record.function && typeof record.function === "object"
            ? (record.function as Record<string, unknown>)
            : {};
        let tool = this.tools.get(index);
        if (!tool) {
          tool = {
            id: String(record.id ?? `tool_${index}`),
            name: String(fn.name ?? "tool"),
            args: "",
            open: false,
          };
          this.tools.set(index, tool);
        }
        if (typeof record.id === "string") tool.id = record.id;
        if (typeof fn.name === "string" && fn.name) tool.name = fn.name;
        if (!tool.open) {
          out += sse("content_block_start", {
            type: "content_block_start",
            index: this.nextIndex,
            content_block: { type: "tool_use", id: tool.id, name: tool.name, input: {} },
          });
          tool.open = true;
          this.nextIndex += 1;
        }
        if (typeof fn.arguments === "string" && fn.arguments) {
          tool.args += fn.arguments;
          out += sse("content_block_delta", {
            type: "content_block_delta",
            index: this.nextIndex - 1,
            delta: { type: "input_json_delta", partial_json: fn.arguments },
          });
        }
      }
    }
    return out;
  }

  private ensureStart(): string {
    if (this.started) return "";
    this.started = true;
    return sse("message_start", {
      type: "message_start",
      message: {
        id: this.messageId,
        type: "message",
        role: "assistant",
        model: this.model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: this.inputTokens, output_tokens: 0 },
      },
    });
  }

  private closeOpen(): string {
    let out = this.ensureStart();
    if (this.textOpen) {
      out += sse("content_block_stop", { type: "content_block_stop", index: this.nextIndex - 1 });
      this.textOpen = false;
    }
    for (const tool of this.tools.values()) {
      if (!tool.open) continue;
      out += sse("content_block_stop", { type: "content_block_stop", index: this.nextIndex - 1 });
      tool.open = false;
    }
    return out;
  }
}

/** Codex / Responses SSE → Anthropic Messages SSE. */
export class ResponsesStream {
  private buffer = "";
  private readonly inner: OpenAiChatStream;
  private toolIndex = -1;

  constructor(model: string) {
    this.inner = new OpenAiChatStream(model);
  }

  push(chunk: string): string {
    this.buffer += chunk;
    let out = "";
    let split = this.buffer.indexOf("\n\n");
    while (split >= 0) {
      const frame = this.buffer.slice(0, split);
      this.buffer = this.buffer.slice(split + 2);
      out += this.consume(frame);
      split = this.buffer.indexOf("\n\n");
    }
    return out;
  }

  usage(): TokenUsage {
    return this.inner.usage();
  }

  finish(): string {
    if (this.buffer.trim()) {
      const extra = this.consume(this.buffer);
      this.buffer = "";
      return extra + this.inner.finish();
    }
    return this.inner.finish();
  }

  private consume(frame: string): string {
    const dataLine = frame
      .split("\n")
      .find((line) => line.startsWith("data:"));
    if (!dataLine) return "";
    const data = dataLine.slice(5).trim();
    if (!data || data === "[DONE]") return "";
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return "";
    }
    const type = String(json.type ?? "");
    if (type === "response.output_text.delta" && typeof json.delta === "string") {
      return this.inner.push(fakeChat({ content: json.delta }));
    }
    if (type === "response.output_item.added") {
      const item = json.item as Record<string, unknown> | undefined;
      if (item?.type === "function_call") {
        this.toolIndex += 1;
        return this.inner.push(
          fakeChat({
            tool_calls: [
              {
                index: this.toolIndex,
                id: item.call_id ?? item.id,
                function: { name: item.name ?? "tool", arguments: "" },
              },
            ],
          }),
        );
      }
    }
    if (type === "response.function_call_arguments.delta" && typeof json.delta === "string") {
      return this.inner.push(
        fakeChat({
          tool_calls: [{ index: Math.max(this.toolIndex, 0), function: { arguments: json.delta } }],
        }),
      );
    }
    if (type === "response.completed" || type === "response.incomplete") {
      const response = json.response as Record<string, unknown> | undefined;
      const usage = usageFromUnknown(response?.usage ?? json.usage);
      return this.inner.push(
        `data: ${JSON.stringify({
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          usage: { prompt_tokens: usage.inputTokens, completion_tokens: usage.outputTokens },
        })}\n\n`,
      );
    }
    return "";
  }
}

function fakeChat(delta: Record<string, unknown>): string {
  return `data: ${JSON.stringify({ choices: [{ index: 0, delta }] })}\n\n`;
}

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function anthropicError(message: string, type = "api_error"): string {
  return JSON.stringify({ type: "error", error: { type, message } });
}
