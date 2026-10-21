export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

interface Price {
  match: RegExp;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/**
 * USD per 1,000,000 tokens. Display estimates only — providers change list
 * prices, and subscription plans are not billed per token.
 * Order matters: the first match wins.
 */
const PRICES: Price[] = [
  { match: /haiku/i, input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  { match: /sonnet/i, input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  { match: /opus|fable/i, input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  { match: /deepseek-v4-flash|deepseek-chat/i, input: 0.14, output: 0.28, cacheRead: 0.014, cacheWrite: 0.14 },
  { match: /deepseek/i, input: 0.27, output: 1.1, cacheRead: 0.07, cacheWrite: 0.27 },
  { match: /gpt-|codex/i, input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 1.25 },
  { match: /gemini|grok/i, input: 1.25, output: 10, cacheRead: 0.31, cacheWrite: 1.25 },
];

const FALLBACK: Price = {
  match: /.*/,
  input: 3,
  output: 15,
  cacheRead: 0.3,
  cacheWrite: 3.75,
};

export function priceFor(model: string): Price {
  return PRICES.find((row) => row.match.test(model)) ?? FALLBACK;
}

export function estimateCostUsd(model: string, usage: TokenUsage): number {
  const price = priceFor(model);
  const million = 1_000_000;
  const cost =
    (usage.inputTokens * price.input +
      usage.outputTokens * price.output +
      usage.cacheReadTokens * price.cacheRead +
      usage.cacheWriteTokens * price.cacheWrite) /
    million;
  return Math.round(cost * 1_000_000) / 1_000_000;
}

export function emptyUsage(): TokenUsage {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
}

export function addUsage(left: TokenUsage, right: TokenUsage): TokenUsage {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    cacheReadTokens: left.cacheReadTokens + right.cacheReadTokens,
    cacheWriteTokens: left.cacheWriteTokens + right.cacheWriteTokens,
  };
}
