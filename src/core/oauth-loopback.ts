import { createServer, type Server } from "node:http";

export interface OAuthCallback {
  code: string;
  state?: string;
}

export interface OAuthLoopback {
  port: number;
  done: Promise<OAuthCallback>;
  close: () => void;
}

/**
 * One-shot loopback for a provider whose official redirect is 127.0.0.1.
 * Pass port 0 in tests. The page tells the user they can close the tab.
 */
export function listenForOAuthCode(port: number, pathname: string, timeoutMs = 180_000): Promise<OAuthLoopback> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let succeed: (value: OAuthCallback) => void = () => undefined;
    let fail: (error: Error) => void = () => undefined;
    const done = new Promise<OAuthCallback>((resolveDone, rejectDone) => {
      succeed = resolveDone;
      fail = rejectDone;
    });
    const server: Server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== pathname) {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      const code = url.searchParams.get("code") ?? "";
      const error = url.searchParams.get("error");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end("<!doctype html><title>Claude Account Pilot</title><p>You can close this tab and return to Claude Account Pilot.</p>");
      if (!code) fail(new Error(error || "missing code"));
      else succeed({ code, state: url.searchParams.get("state") ?? undefined });
    });
    const timer = setTimeout(() => fail(new Error("oauth callback timed out")), timeoutMs);
    const close = () => {
      clearTimeout(timer);
      server.close();
    };
    done.finally(close);
    server.once("error", (error) => {
      if (!settled) reject(error);
      else fail(error);
    });
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      const bound = typeof address === "object" && address ? address.port : port;
      settled = true;
      resolve({ port: bound, done, close });
    });
  });
}
