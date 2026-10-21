/**
 * Collapse concurrent calls that share a key into one promise.
 * A token refresh uses this so two requests cannot rotate the same refresh token.
 */
export function singleFlight(): <T>(key: string, fn: () => Promise<T>) => Promise<T> {
  const inflight = new Map<string, Promise<unknown>>();
  return function run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = inflight.get(key);
    if (existing) return existing as Promise<T>;
    const job = Promise.resolve()
      .then(fn)
      .finally(() => {
        if (inflight.get(key) === job) inflight.delete(key);
      });
    inflight.set(key, job);
    return job;
  };
}
