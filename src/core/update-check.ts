export function compareVersions(left: string, right: string): number {
  const parse = (value: string) =>
    value
      .replace(/^v/, "")
      .split(".")
      .map((part) => {
        const match = /^(\d+)/.exec(part);
        return match ? Number(match[1]) : 0;
      });
  const a = parse(left);
  const b = parse(right);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const delta = (a[index] ?? 0) - (b[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

export interface ReleaseNotice {
  version: string;
  url: string;
}

/** Read a GitHub release document. Returns a notice only when the tag is newer. */
export function newerRelease(current: string, payload: unknown): ReleaseNotice | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const tag = typeof record.tag_name === "string" ? record.tag_name : "";
  const url = typeof record.html_url === "string" ? record.html_url : "";
  if (!tag || !url) return null;
  if (compareVersions(tag, current) <= 0) return null;
  return { version: tag.replace(/^v/, ""), url };
}
