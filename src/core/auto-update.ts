export type InstallKind = "appimage" | "mac-zip" | "win-setup" | "win-portable";

export interface UpdateAsset {
  name: string;
  url: string;
  kind: InstallKind;
}

const RELEASE_HOST = "https://github.com/cumabozkurt/claude-account-pilot/releases/download/";

export function assetName(version: string, kind: InstallKind, arch: string): string | null {
  const clean = version.replace(/^v/, "");
  if (kind === "appimage") return `Claude.Account.Pilot-${clean}-linux-x86_64.AppImage`;
  if (kind === "mac-zip") {
    const macArch = arch === "arm64" ? "arm64" : arch === "x64" ? "x64" : "";
    if (!macArch) return null;
    return `Claude.Account.Pilot-${clean}-mac-${macArch}.zip`;
  }
  if (kind === "win-setup") return `Claude.Account.Pilot-Setup-${clean}-win-x64.exe`;
  if (kind === "win-portable") return `Claude.Account.Pilot-Portable-${clean}-win-x64.exe`;
  return null;
}

export function releaseAssetUrl(version: string, name: string): string {
  return `${RELEASE_HOST}v${version.replace(/^v/, "")}/${name}`;
}

/** How this process can replace itself. A dev tree and a deb install cannot. */
export function installKind(input: {
  platform: NodeJS.Platform;
  arch: string;
  packaged: boolean;
  appImage?: string;
  portable?: boolean;
}): InstallKind | null {
  if (!input.packaged) return null;
  if (input.platform === "linux") return input.appImage ? "appimage" : null;
  if (input.platform === "darwin") return input.arch === "arm64" || input.arch === "x64" ? "mac-zip" : null;
  if (input.platform === "win32") return input.portable ? "win-portable" : "win-setup";
  return null;
}

/** Hosts a GitHub release asset is allowed to redirect through. */
const REDIRECT_HOSTS = new Set([
  "github.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
  "github-releases.githubusercontent.com",
]);

export interface ManualResponse {
  status: number;
  headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
}

/**
 * Follow redirects only while every hop stays on GitHub's release hosts.
 * A download URL that leaves those hosts is rejected.
 */
export function redirectAllowed(fromUrl: string, location: string): string | null {
  let next: URL;
  try {
    next = new URL(location, fromUrl);
  } catch {
    return null;
  }
  if (next.protocol !== "https:") return null;
  if (!REDIRECT_HOSTS.has(next.hostname)) return null;
  return next.toString();
}

export async function fetchReleaseBytes(
  url: string,
  fetchImpl: (input: string, init: { redirect: "manual"; signal?: AbortSignal }) => Promise<ManualResponse>,
  signal?: AbortSignal,
): Promise<Uint8Array | null> {
  if (!url.startsWith(RELEASE_HOST)) return null;
  let current = url;
  for (let hop = 0; hop < 5; hop += 1) {
    const response = await fetchImpl(current, { redirect: "manual", signal });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return null;
      const next = redirectAllowed(current, location);
      if (!next) return null;
      current = next;
      continue;
    }
    if (response.status < 200 || response.status >= 300) return null;
    return new Uint8Array(await response.arrayBuffer());
  }
  return null;
}

/** The .app that contains this executable. An earlier ".app" in the path is not the bundle. */
export function macAppBundle(execPath: string): string | null {
  const marker = ".app/";
  const index = execPath.lastIndexOf(marker);
  if (index < 0) return null;
  const bundle = execPath.slice(0, index + ".app".length);
  if (!bundle.endsWith(".app")) return null;
  const rest = execPath.slice(bundle.length);
  if (!rest.startsWith("/Contents/")) return null;
  return bundle;
}

/** A cmd script that swaps a portable exe. Quotes and newlines in a path are rejected. */
export function windowsSwapScript(file: string, target: string): string {
  const quote = (value: string) => {
    if (/[\r\n"&|<>^%]/.test(value)) throw new Error("unsafe update path");
    return value;
  };
  return `@echo off\r\nping 127.0.0.1 -n 3 >nul\r\nmove /Y "${quote(file)}" "${quote(target)}"\r\nstart "" "${quote(target)}"\r\n`;
}

export function looksLikeInstaller(kind: InstallKind, bytes: Uint8Array): boolean {
  if (bytes.length < 1_000_000) return false;
  if (kind === "mac-zip") return bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (kind === "win-setup" || kind === "win-portable") return bytes[0] === 0x4d && bytes[1] === 0x5a;
  if (kind === "appimage") return bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46;
  return false;
}

/**
 * Pick the asset for this OS from a GitHub release document.
 * The URL has to be this repo's release download. Anything else is ignored.
 */
export function pickUpdateAsset(
  version: string,
  kind: InstallKind | null,
  arch: string,
  assets: Array<{ name?: string; browser_download_url?: string }>,
): UpdateAsset | null {
  if (!kind) return null;
  const name = assetName(version, kind, arch);
  if (!name) return null;
  const url = releaseAssetUrl(version, name);
  const listed = assets.some((asset) => asset.name === name && asset.browser_download_url === url);
  if (!listed) return null;
  if (!url.startsWith(RELEASE_HOST)) return null;
  return { name, url, kind };
}
