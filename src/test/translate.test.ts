import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  anthropicToChatCompletions,
  anthropicToResponses,
  chatCompletionToAnthropic,
  OpenAiChatStream,
  ResponsesStream,
  responsesToAnthropic,
} from "../core/translate.js";

describe("protocol translation", () => {
  const anthropic = {
    model: "claude-haiku-4-5",
    max_tokens: 128,
    stream: false,
    system: "Be brief.",
    messages: [
      { role: "user", content: "Hi" },
      {
        role: "assistant",
        content: [{ type: "tool_use", id: "toolu_1", name: "lookup", input: { q: "a" } }],
      },
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "found" }],
      },
    ],
    tools: [{ name: "lookup", description: "Find", input_schema: { type: "object" } }],
  };

  it("maps messages, system and tools onto chat completions", () => {
    const chat = anthropicToChatCompletions(anthropic, "deepseek-v4-flash");
    assert.equal(chat.model, "deepseek-v4-flash");
    const messages = chat.messages as Array<Record<string, unknown>>;
    assert.equal(messages[0]?.role, "system");
    assert.equal(messages[1]?.content, "Hi");
    assert.equal(messages[3]?.role, "tool");
    const tools = chat.tools as Array<Record<string, unknown>>;
    assert.equal((tools[0]?.function as { name: string }).name, "lookup");
  });

  it("maps a chat completion with a tool call back to Anthropic", () => {
    const message = chatCompletionToAnthropic(
      {
        id: "chatcmpl_1",
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              content: null,
              tool_calls: [{ id: "call_1", type: "function", function: { name: "lookup", arguments: "{\"q\":\"a\"}" } }],
            },
          },
        ],
        usage: { prompt_tokens: 11, completion_tokens: 4 },
      },
      "deepseek-v4-flash",
    );
    assert.equal(message.stop_reason, "tool_use");
    assert.equal(message.content[0]?.type, "tool_use");
    assert.equal(message.usage.input_tokens, 11);
    assert.deepEqual(message.content[0]?.input, { q: "a" });
  });

  it("maps Responses input and output", () => {
    const responses = anthropicToResponses(anthropic, "gpt-5.3-codex");
    assert.equal(responses.model, "gpt-5.3-codex");
    assert.equal(responses.max_output_tokens, 128);
    const back = responsesToAnthropic(
      {
        id: "resp_1",
        output: [
          { type: "message", content: [{ type: "output_text", text: "done" }] },
          { type: "function_call", call_id: "call_9", name: "lookup", arguments: "{\"q\":1}" },
        ],
        usage: { input_tokens: 3, output_tokens: 2 },
      },
      "gpt-5.3-codex",
    );
    assert.equal(back.content[0]?.text, "done");
    assert.equal(back.content[1]?.name, "lookup");
    assert.equal(back.usage.output_tokens, 2);
  });

  it("converts an OpenAI SSE stream into Anthropic events", () => {
    const stream = new OpenAiChatStream("deepseek-v4-flash", "msg_test");
    const raw = [
      'data: {"choices":[{"index":0,"delta":{"role":"assistant"}}]}\n\n',
      'data: {"choices":[{"index":0,"delta":{"content":"Merhaba"}}]}\n\n',
      'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":1}}\n\n',
      "data: [DONE]\n\n",
    ].join("");
    const text = stream.push(raw) + stream.finish();
    assert.match(text, /event: message_start/);
    assert.match(text, /Merhaba/);
    assert.match(text, /event: message_stop/);
    assert.equal(stream.usage().inputTokens, 5);
    assert.equal(stream.usage().outputTokens, 1);
  });

  it("converts Codex response text deltas", () => {
    const stream = new ResponsesStream("gpt-5.3-codex");
    const raw = [
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"Hi"}\n\n',
      'event: response.completed\ndata: {"type":"response.completed","response":{"usage":{"input_tokens":2,"output_tokens":1}}}\n\n',
    ].join("");
    const text = stream.push(raw) + stream.finish();
    assert.match(text, /Hi/);
    assert.equal(stream.usage().inputTokens, 2);
  });
});
