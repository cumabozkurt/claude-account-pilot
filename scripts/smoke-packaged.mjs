import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assetName, releaseAssetUrl } from "../dist/core/auto-update.js";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const releaseDir = join(repo, "release");
const shots = join(repo, "smoke-shots");
const reports = join(repo, "smoke-reports");
mkdirSync(shots, { recursive: true });
mkdirSync(reports, { recursive: true });

function listed() {
  return readdirSync(releaseDir);
}

function findArtifact(pattern) {
  const name = listed().find((item) => pattern.test(item));
  if (!name) throw new Error(`missing ${pattern} in ${listed().join(", ")}`);
  return join(releaseDir, name);
}

function fakeRelease() {
  const version = "9.9.9";
  const specs = [
    ["appimage", "x64"],
    ["mac-zip", "arm64"],
    ["mac-zip", "x64"],
    ["win-setup", "x64"],
    ["win-portable", "x64"],
  ];
  return {
    tag_name: `v${version}`,
    assets: [
      ...specs.map(([kind, arch]) => {
        const name = assetName(version, kind, arch);
        return { name, browser_download_url: releaseAssetUrl(version, name) };
      }),
      { name: "evil", browser_download_url: "https://evil.example/x" },
    ],
  };
}

function run(command, args, env, timeoutMs = 240000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    const take = (chunk) => {
      out += chunk.toString();
      if (out.length > 200_000) out = out.slice(-100_000);
    };
    child.stdout?.on("data", take);
    child.stderr?.on("data", take);
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`timeout ${command}\n${out.slice(-5000)}`));
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`exit ${code} ${command}\n${out.slice(-5000)}`));
    });
  });
}

function launch(bin, args, env) {
  if (process.platform === "linux") {
    return run("xvfb-run", ["-a", "--server-args=-screen 0 1280x800x24", bin, ...args], env);
  }
  return run(bin, args, env);
}

async function once(bin, args, lang, label, requireKind) {
  const dir = mkdtempSync(join(tmpdir(), `pilot-selftest-${lang}-`));
  const home = join(dir, "home");
  const userData = join(dir, "user");
  mkdirSync(join(home, ".claude"), { recursive: true });
  const original = `${JSON.stringify({ theme: "qa", env: { KEEP: "yes" } }, null, 2)}\n`;
  const settings = join(home, ".claude", "settings.json");
  writeFileSync(settings, original);
  const fake = join(dir, "release.json");
  writeFileSync(fake, JSON.stringify(fakeRelease()));
  const report = join(dir, "report.json");
  const shot = join(shots, `${label}-${lang}.png`);
  const env = {
    ...process.env,
    PILOT_SELFTEST: "1",
    PILOT_SMOKE: "1",
    PILOT_LANG: lang,
    PILOT_HOME: home,
    PILOT_USER_DATA: userData,
    PILOT_FAKE_RELEASE: fake,
    PILOT_REPORT: report,
    PILOT_SHOT: shot,
    PILOT_REQUIRE_INSTALL_KIND: requireKind ? "1" : "0",
    ELECTRON_DISABLE_SANDBOX: "1",
  };
  if (process.platform === "linux") env.APPIMAGE_EXTRACT_AND_RUN = "1";
  try {
    await launch(bin, args, env);
  } catch (error) {
    if (existsSync(report)) copyFileSync(report, join(reports, `${label}-${lang}.json`));
    writeFileSync(join(reports, `${label}-${lang}.log.txt`), String(error));
    throw error;
  }
  const body = JSON.parse(readFileSync(report, "utf8"));
  copyFileSync(report, join(reports, `${label}-${lang}.json`));
  if (!body.ok) throw new Error(`${label} ${lang} failed\n${JSON.stringify(body, null, 2)}`);
  if (body.home !== home) throw new Error(`settings home escaped to ${body.home}`);
  if (readFileSync(settings, "utf8") !== original) throw new Error(`${label} did not restore settings.json`);
  if (!existsSync(shot) || readFileSync(shot).length < 1000) throw new Error(`screenshot missing for ${label} ${lang}`);
  rmSync(dir, { recursive: true, force: true });
  if (existsSync(dir)) throw new Error(`temp home remains: ${dir}`);
  console.log(`${label} ${lang} ok port=${body.port} kind=${body.installKind ?? "none"} update=${body.updateName ?? "n/a"}`);
}

async function main() {
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  if (process.platform === "linux") {
    const image = findArtifact(/linux-x86_64\.AppImage$/);
    execFileSync("chmod", ["755", image]);
    for (const lang of ["en", "tr"]) await once(image, ["--no-sandbox"], lang, "linux-appimage", true);
    const deb = findArtifact(/\.deb$/);
    execFileSync("sudo", ["apt-get", "install", "-y", deb], { stdio: "inherit" });
    const listedDeb = execFileSync("dpkg", ["-L", "claude-account-pilot"], { encoding: "utf8" });
    const bin = listedDeb
      .split("\n")
      .find((line) => line.endsWith("/claude-account-pilot"));
    if (!bin) throw new Error(`deb binary not found\n${listedDeb}`);
    await once(bin, ["--no-sandbox"], "en", "linux-deb", false);
    execFileSync("sudo", ["apt-get", "remove", "-y", "claude-account-pilot"], { stdio: "inherit" });
    if (existsSync(bin)) throw new Error(`uninstall left ${bin}`);
    console.log("linux deb removed");
    return;
  }
  if (process.platform === "darwin") {
    const zip = findArtifact(new RegExp(`mac-${arch}\\.zip$`));
    const dest = mkdtempSync(join(tmpdir(), "pilot-mac-"));
    execFileSync("unzip", ["-qo", zip, "-d", dest]);
    const app = join(dest, "Claude Account Pilot.app");
    const bin = join(app, "Contents", "MacOS", "Claude Account Pilot");
    try {
      execFileSync("xattr", ["-cr", app]);
    } catch {
      /* no quarantine attribute */
    }
    for (const lang of ["en", "tr"]) await once(bin, [], lang, `mac-${arch}`, true);
    rmSync(dest, { recursive: true, force: true });
    if (existsSync(app)) throw new Error("unzipped app remains");
    console.log("mac bundle removed");
    return;
  }
  if (process.platform === "win32") {
    const portable = findArtifact(/Portable.*\.exe$/i);
    for (const lang of ["en", "tr"]) await once(portable, [], lang, "win-portable", true);
    const setup = findArtifact(/Setup.*\.exe$/i);
    const dest = "C:\\pilot-qa";
    rmSync(dest, { recursive: true, force: true });
    await run(setup, ["/S", `/D=${dest}`], process.env);
    const exe = join(dest, "Claude Account Pilot.exe");
    if (!existsSync(exe)) throw new Error(`installer did not write ${exe}`);
    await once(exe, [], "en", "win-setup", true);
    const uninstaller = join(dest, "Uninstall Claude Account Pilot.exe");
    if (!existsSync(uninstaller)) throw new Error("uninstaller missing");
    await run(uninstaller, ["/S"], process.env);
    if (existsSync(exe)) throw new Error("uninstall left the executable");
    console.log("windows setup removed");
    return;
  }
  throw new Error(`unsupported platform ${process.platform}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
