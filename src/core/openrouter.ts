/** OpenRouter key endpoint: limit and usage are USD credits when the key has a limit. */
export function openRouterPercent(payload: unknown): { percent: number | null; note?: string; resetsAt?: string } {
  const root = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const data = root.data && typeof root.data === "object" ? (root.data as Record<string, unknown>) : root;
  const limit = Number(data.limit);
  const usage = Number(data.usage);
  const remaining = Number(data.limit_remaining ?? data.limitRemaining);
  if (Number.isFinite(limit) && limit > 0 && Number.isFinite(usage) && usage >= 0) {
    const percent = Math.round(Math.min(100, (usage / limit) * 100) * 10) / 10;
    return { percent, note: `$${usage.toFixed(2)} / $${limit.toFixed(2)}` };
  }
  if (Number.isFinite(remaining)) return { percent: null, note: `$${remaining.toFixed(2)} left` };
  if (Number.isFinite(usage)) return { percent: null, note: `$${usage.toFixed(2)} used` };
  return { percent: null };
}

export const OPENROUTER_KEY_URL = "https://openrouter.ai/api/v1/key";
export const GEMINI_OPENAI_BASE = "https://generativelanguage.googleapis.com/v1beta/openai";
