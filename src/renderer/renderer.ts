import { translate, type I18nKey } from "../core/i18n.js";
import { formatCountdown } from "../core/monitor.js";
import { PROVIDER_IDS, type Lang, type ProviderId, type QuotaWindow } from "../core/types.js";

interface PublicAccount {
  id: string;
  provider: ProviderId;
  label: string;
  enabled: boolean;
  active: boolean;
  percent: number | null;
  windows: QuotaWindow[];
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  source: "provider" | "headers" | "local-estimate" | "none";
  note?: string;
  authKind: "api-key" | "oauth" | "discovered";
  email?: string;
  synced?: boolean;
  ownedByClaudeCode?: boolean;
  resetsAt?: string;
  history?: Array<number | null>;
}

interface Discovery {
  provider: ProviderId;
  found: boolean;
  detail: string;
  canImport: boolean;
  expired: boolean;
}

interface RouteRow {
  id: string;
  enabled: boolean;
  match: string;
  provider: ProviderId;
  targetModel: string;
}

interface Activity {
  at: string;
  key: string;
  vars: Record<string, string | number>;
}

interface PublicState {
  lang: Lang;
  proxyRunning: boolean;
  baseUrl: string;
  envSnippet: string;
  threshold: number;
  port: number;
  widgetEnabled: boolean;
  launchAtLogin: boolean;
  notify: boolean;
  encryptionWarning: boolean;
  providersEnabled: Record<ProviderId, boolean>;
  accounts: PublicAccount[];
  routes: RouteRow[];
  discoveries: Discovery[];
  activity: Activity[];
  activeLabel: string;
  activePercent: number | null;
  message?: { text: string; warn?: boolean };
}

interface PilotBridge {
  getState: () => Promise<PublicState>;
  setLang: (lang: Lang) => Promise<void>;
  setThreshold: (value: number) => Promise<void>;
  setPort: (value: number) => Promise<void>;
  setProxyEnabled: (enabled: boolean) => Promise<void>;
  setProvider: (id: ProviderId, enabled: boolean) => Promise<void>;
  setWidget: (enabled: boolean) => Promise<void>;
  setLaunchAtLogin: (enabled: boolean) => Promise<void>;
  addAccount: (input: { label: string; provider: ProviderId; secret: string; authKind: "api-key" | "oauth" }) => Promise<void>;
  toggleAccount: (id: string, enabled: boolean) => Promise<void>;
  removeAccount: (id: string) => Promise<void>;
  toggleRoute: (id: string, enabled: boolean) => Promise<void>;
  addRoute: (input: { match: string; provider: ProviderId; targetModel: string }) => Promise<void>;
  removeRoute: (id: string) => Promise<void>;
  moveRoute: (id: string, direction: -1 | 1) => Promise<void>;
  importDiscovered: (provider: ProviderId) => Promise<void>;
  applyClaude: () => Promise<void>;
  restoreClaude: () => Promise<void>;
  setNotify: (enabled: boolean) => Promise<void>;
  startClaudeLogin: () => Promise<{ url: string }>;
  finishClaudeLogin: (pasted: string) => Promise<{ ok: boolean }>;
  importClaudeCredentials: (raw: string) => Promise<{ ok: boolean }>;
  syncClaudeAccount: (id: string) => Promise<{ ok: boolean }>;
  restoreClaudeCredentials: () => Promise<void>;
  openMain: () => Promise<void>;
  onState: (listener: (state: PublicState) => void) => () => void;
}

declare global {
  interface Window {
    pilot: PilotBridge;
  }
}

const widgetMode = new URLSearchParams(location.search).has("widget");
let state: PublicState | null = null;

function t(key: I18nKey | string, vars?: Record<string, string | number>): string {
  return translate(state?.lang ?? "en", key as I18nKey, vars);
}

function money(value: number): string {
  return new Intl.NumberFormat(state?.lang === "tr" ? "tr-TR" : "en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function tokens(value: number): string {
  return new Intl.NumberFormat(state?.lang === "tr" ? "tr-TR" : "en-US").format(value);
}

function applyStatic(): void {
  document.documentElement.lang = state?.lang ?? "en";
  document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((node) => {
    const key = node.dataset.i18n as I18nKey | undefined;
    if (key) node.textContent = t(key);
  });
  document.querySelectorAll<HTMLInputElement>("[data-i18n-placeholder]").forEach((node) => {
    const key = node.dataset.i18nPlaceholder as I18nKey | undefined;
    if (key) node.placeholder = t(key);
  });
  const subtitle = document.querySelector("#subtitle");
  if (subtitle && state) subtitle.textContent = t("app.subtitle", { threshold: state.threshold });
  for (const lang of ["en", "tr"] as const) {
    const button = document.querySelector<HTMLButtonElement>(`#lang-${lang}`);
    if (!button) continue;
    button.setAttribute("aria-pressed", String(state?.lang === lang));
  }
}

function barClass(percent: number | null): string {
  if (percent == null) return "";
  if (percent >= 98) return "bad";
  if (percent >= 80) return "warn";
  return "";
}

function renderAccounts(): void {
  const root = document.querySelector("#accounts");
  if (!root || !state) return;
  root.replaceChildren();
  if (state.accounts.length === 0) {
    const empty = document.createElement("p");
    empty.className = "hint";
    empty.textContent = t("accounts.empty");
    root.append(empty);
    return;
  }
  for (const account of state.accounts) {
    const card = document.createElement("article");
    card.className = "account";
    const head = document.createElement("div");
    head.className = "account-head";
    const title = document.createElement("strong");
    title.textContent = `${account.label} · ${t(`provider.${account.provider}`)}`;
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "switch";
    toggle.setAttribute("aria-pressed", String(account.enabled));
    toggle.textContent = account.enabled ? t("accounts.enable") : t("accounts.disable");
    toggle.addEventListener("click", () => void window.pilot.toggleAccount(account.id, !account.enabled));
    head.append(title, toggle);
    const meta = document.createElement("p");
    meta.className = "meta";
    const percent =
      account.percent == null ? t("accounts.noQuota") : t("accounts.percent", { percent: account.percent });
    const sourceKey = `accounts.source.${account.source}` as I18nKey;
    meta.textContent = `${percent} · ${t(sourceKey)} · ${t("accounts.tokens", {
      input: tokens(account.inputTokens),
      output: tokens(account.outputTokens),
    })} · ${t("accounts.cost", { cost: money(account.costUsd) })}`;
    const bar = document.createElement("div");
    bar.className = "bar";
    const fill = document.createElement("span");
    fill.style.width = `${Math.max(0, Math.min(100, account.percent ?? 0))}%`;
    fill.className = barClass(account.percent);
    bar.append(fill);
    const windows = document.createElement("div");
    windows.className = "windows";
    for (const item of account.windows) {
      const tag = document.createElement("span");
      tag.className = "tag";
      const name = item.name ? `${item.name} ` : "";
      const countdown = item.resetsAt ? formatCountdown(item.resetsAt) : null;
      const reset = countdown ? ` · ${t("window.reset", { when: countdown })}` : "";
      tag.textContent = `${name}${t(`window.${item.label}`)} ${item.percent}%${reset}`;
      windows.append(tag);
    }
    if (account.active) {
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = t("accounts.active");
      windows.append(tag);
    }
    const cache = document.createElement("p");
    cache.className = "hint";
    cache.textContent = t("accounts.cache", {
      read: tokens(account.cacheReadTokens),
      write: tokens(account.cacheWriteTokens),
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = t("accounts.remove");
    remove.addEventListener("click", () => void window.pilot.removeAccount(account.id));
    card.append(head, meta, bar, sparkline(account.history ?? []), windows, cache);
    if (account.email) {
      const email = document.createElement("p");
      email.className = "hint";
      email.textContent = account.email;
      card.append(email);
    }
    if (account.note === "relogin") {
      const note = document.createElement("p");
      note.className = "hint";
      note.textContent = t("oauth.dead");
      card.append(note);
    } else if (account.note) {
      const note = document.createElement("p");
      note.className = "hint";
      note.textContent = account.note;
      card.append(note);
    }
    if (account.ownedByClaudeCode) {
      const owned = document.createElement("p");
      owned.className = "hint";
      owned.textContent = t("oauth.owned");
      card.append(owned);
    }
    if (account.provider === "claude" && account.authKind !== "api-key") {
      const sync = document.createElement("button");
      sync.type = "button";
      sync.textContent = account.synced ? t("oauth.synced") : t("oauth.sync");
      sync.disabled = Boolean(account.synced);
      sync.addEventListener("click", () => void window.pilot.syncClaudeAccount(account.id));
      card.append(sync);
    }
    card.append(remove);
    root.append(card);
  }
}

function sparkline(points: Array<number | null>): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 120 28");
  svg.setAttribute("class", "spark");
  const values = points.filter((point): point is number => point != null);
  if (values.length < 2) return svg;
  const step = 120 / (values.length - 1);
  const d = values
    .map((value, index) => {
      const x = (index * step).toFixed(1);
      const y = (26 - (Math.max(0, Math.min(100, value)) / 100) * 24).toFixed(1);
      return `${index === 0 ? "M" : "L"}${x} ${y}`;
    })
    .join(" ");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", d);
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "1.5");
  svg.append(path);
  return svg;
}

function renderProviders(): void {
  const root = document.querySelector("#providers");
  if (!root || !state) return;
  root.replaceChildren();
  for (const id of PROVIDER_IDS) {
    const card = document.createElement("article");
    card.className = "provider";
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "switch";
    const enabled = state.providersEnabled[id];
    toggle.setAttribute("aria-pressed", String(enabled));
    toggle.textContent = enabled ? t("accounts.enable") : t("accounts.disable");
    toggle.addEventListener("click", () => void window.pilot.setProvider(id, !enabled));
    const title = document.createElement("strong");
    title.textContent = t(`provider.${id}`);
    const note = document.createElement("p");
    note.className = "hint";
    note.textContent = t(`provider.note.${id}`);
    card.append(toggle, title, note);
    root.append(card);
  }
}

function renderRoutes(): void {
  const root = document.querySelector("#routes");
  if (!root || !state) return;
  root.replaceChildren();
  if (state.routes.length === 0) {
    const empty = document.createElement("p");
    empty.className = "hint";
    empty.textContent = t("routes.empty");
    root.append(empty);
    return;
  }
  state.routes.forEach((route, index) => {
    const row = document.createElement("article");
    row.className = "route";
    const head = document.createElement("div");
    head.className = "account-head";
    const title = document.createElement("strong");
    title.textContent = `${route.match} → ${t(`provider.${route.provider}`)} · ${route.targetModel}`;
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "switch";
    toggle.setAttribute("aria-pressed", String(route.enabled));
    toggle.textContent = route.enabled ? t("accounts.enable") : t("accounts.disable");
    toggle.addEventListener("click", () => void window.pilot.toggleRoute(route.id, !route.enabled));
    head.append(title, toggle);
    const actions = document.createElement("div");
    actions.className = "actions";
    const up = document.createElement("button");
    up.type = "button";
    up.textContent = t("routes.up");
    up.disabled = index === 0;
    up.addEventListener("click", () => void window.pilot.moveRoute(route.id, -1));
    const down = document.createElement("button");
    down.type = "button";
    down.textContent = t("routes.down");
    down.disabled = index === state!.routes.length - 1;
    down.addEventListener("click", () => void window.pilot.moveRoute(route.id, 1));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = t("routes.remove");
    remove.addEventListener("click", () => void window.pilot.removeRoute(route.id));
    actions.append(up, down, remove);
    row.append(head, actions);
    root.append(row);
  });
}

function renderDiscover(): void {
  const root = document.querySelector("#discover");
  if (!root || !state) return;
  root.replaceChildren();
  if (state.discoveries.length === 0) {
    const empty = document.createElement("p");
    empty.className = "hint";
    empty.textContent = t("discover.none");
    root.append(empty);
    return;
  }
  for (const item of state.discoveries) {
    const row = document.createElement("article");
    row.className = "route";
    const title = document.createElement("strong");
    title.textContent = `${t(`provider.${item.provider}`)} · ${item.detail}`;
    row.append(title);
    if (item.expired) {
      const note = document.createElement("p");
      note.className = "hint";
      note.textContent = t("discover.expired");
      row.append(note);
    }
    if (item.canImport) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = t("discover.import");
      button.addEventListener("click", () => void window.pilot.importDiscovered(item.provider));
      row.append(button);
    }
    root.append(row);
  }
}

function renderActivity(): void {
  const root = document.querySelector("#activity");
  if (!root || !state) return;
  root.replaceChildren();
  if (state.activity.length === 0) {
    const item = document.createElement("li");
    item.textContent = t("activity.empty");
    root.append(item);
    return;
  }
  for (const event of state.activity) {
    const item = document.createElement("li");
    const time = new Date(event.at).toLocaleTimeString(state.lang === "tr" ? "tr-TR" : "en-US");
    item.textContent = `${time} · ${t(event.key as I18nKey, event.vars)}`;
    root.append(item);
  }
}

function renderProxy(): void {
  if (!state) return;
  const dot = document.querySelector("#dot");
  dot?.classList.toggle("on", state.proxyRunning);
  const text = document.querySelector("#proxy-text");
  if (text) text.textContent = state.proxyRunning ? t("proxy.running") : t("proxy.stopped");
  const address = document.querySelector("#proxy-address");
  if (address) address.textContent = state.baseUrl;
  const toggle = document.querySelector("#toggle-proxy");
  if (toggle) toggle.textContent = state.proxyRunning ? t("proxy.stop") : t("proxy.start");
  const threshold = document.querySelector<HTMLInputElement>("#threshold");
  if (threshold && document.activeElement !== threshold) threshold.value = String(state.threshold);
  const port = document.querySelector<HTMLInputElement>("#port");
  if (port && document.activeElement !== port) port.value = String(state.port);
  const launch = document.querySelector<HTMLInputElement>("#launch");
  if (launch) launch.checked = state.launchAtLogin;
  const widget = document.querySelector<HTMLInputElement>("#widget");
  if (widget) widget.checked = state.widgetEnabled;
  const notify = document.querySelector<HTMLInputElement>("#notify");
  if (notify) notify.checked = state.notify;
  const banner = document.querySelector("#banner");
  if (banner) {
    const parts = [];
    if (state.encryptionWarning) parts.push(t("status.encryptionWarn"));
    if (state.message?.text) parts.push(state.message.text);
    banner.textContent = parts.join(" ");
    banner.classList.toggle("warn", Boolean(state.encryptionWarning || state.message?.warn));
  }
}

function renderWidget(): void {
  if (!state) return;
  const label = document.querySelector("#widget-label");
  if (label) label.textContent = state.activeLabel || t("widget.idle");
  const fill = document.querySelector<HTMLElement>("#widget-bar");
  if (fill) {
    fill.style.width = `${Math.max(0, Math.min(100, state.activePercent ?? 0))}%`;
    fill.className = barClass(state.activePercent);
  }
  const meta = document.querySelector("#widget-meta");
  if (meta) {
    meta.textContent =
      state.activePercent == null ? t("accounts.noQuota") : t("accounts.percent", { percent: state.activePercent });
  }
}

function render(): void {
  if (!state) return;
  applyStatic();
  if (widgetMode) {
    renderWidget();
    return;
  }
  renderProxy();
  renderProviders();
  renderAccounts();
  renderDiscover();
  renderRoutes();
  renderActivity();
  fillProviderSelects();
}

function fillProviderSelects(): void {
  for (const id of ["#acc-provider", "#route-provider"] as const) {
    const select = document.querySelector<HTMLSelectElement>(id);
    if (!select || select.options.length === PROVIDER_IDS.length) {
      if (select) {
        [...select.options].forEach((option, index) => {
          const provider = PROVIDER_IDS[index];
          if (provider) option.textContent = t(`provider.${provider}`);
        });
      }
      continue;
    }
    select.replaceChildren();
    for (const provider of PROVIDER_IDS) {
      const option = document.createElement("option");
      option.value = provider;
      option.textContent = t(`provider.${provider}`);
      select.append(option);
    }
  }
}

function bind(): void {
  document.querySelector("#lang-en")?.addEventListener("click", () => void window.pilot.setLang("en"));
  document.querySelector("#lang-tr")?.addEventListener("click", () => void window.pilot.setLang("tr"));
  document.querySelector("#copy-env")?.addEventListener("click", async () => {
    if (!state) return;
    await navigator.clipboard.writeText(state.envSnippet);
    const banner = document.querySelector("#banner");
    if (banner) banner.textContent = t("proxy.copied");
  });
  document.querySelector("#apply-claude")?.addEventListener("click", () => void window.pilot.applyClaude());
  document.querySelector("#restore-claude")?.addEventListener("click", () => void window.pilot.restoreClaude());
  document.querySelector("#toggle-proxy")?.addEventListener("click", () => {
    if (state) void window.pilot.setProxyEnabled(!state.proxyRunning);
  });
  document.querySelector("#threshold")?.addEventListener("change", (event) => {
    const value = Number((event.target as HTMLInputElement).value);
    void window.pilot.setThreshold(value);
  });
  document.querySelector("#port")?.addEventListener("change", (event) => {
    void window.pilot.setPort(Number((event.target as HTMLInputElement).value));
  });
  document.querySelector("#launch")?.addEventListener("change", (event) => {
    void window.pilot.setLaunchAtLogin((event.target as HTMLInputElement).checked);
  });
  document.querySelector("#widget")?.addEventListener("change", (event) => {
    void window.pilot.setWidget((event.target as HTMLInputElement).checked);
  });
  document.querySelector("#notify")?.addEventListener("change", (event) => {
    void window.pilot.setNotify((event.target as HTMLInputElement).checked);
  });
  document.querySelector("#oauth-open")?.addEventListener("click", () => void window.pilot.startClaudeLogin());
  document.querySelector("#oauth-restore")?.addEventListener("click", () => void window.pilot.restoreClaudeCredentials());
  document.querySelector("#oauth-finish")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const pasted = document.querySelector<HTMLInputElement>("#oauth-code")?.value ?? "";
    void window.pilot.finishClaudeLogin(pasted).then(() => {
      const input = document.querySelector<HTMLInputElement>("#oauth-code");
      if (input) input.value = "";
    });
  });
  document.querySelector("#oauth-import")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const raw = document.querySelector<HTMLTextAreaElement>("#oauth-json")?.value ?? "";
    void window.pilot.importClaudeCredentials(raw).then(() => {
      const input = document.querySelector<HTMLTextAreaElement>("#oauth-json");
      if (input) input.value = "";
    });
  });
  document.querySelector("#add-account")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const label = document.querySelector<HTMLInputElement>("#acc-label")?.value ?? "";
    const provider = document.querySelector<HTMLSelectElement>("#acc-provider")?.value as ProviderId;
    const authKind = document.querySelector<HTMLSelectElement>("#acc-kind")?.value as "api-key" | "oauth";
    const secret = document.querySelector<HTMLInputElement>("#acc-secret")?.value ?? "";
    void window.pilot.addAccount({ label, provider, secret, authKind }).then(() => {
      const form = document.querySelector<HTMLFormElement>("#add-account");
      form?.reset();
    });
  });
  document.querySelector("#add-route")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const match = document.querySelector<HTMLInputElement>("#route-match")?.value ?? "";
    const provider = document.querySelector<HTMLSelectElement>("#route-provider")?.value as ProviderId;
    const targetModel = document.querySelector<HTMLInputElement>("#route-model")?.value ?? "";
    void window.pilot.addRoute({ match, provider, targetModel }).then(() => {
      document.querySelector<HTMLFormElement>("#add-route")?.reset();
    });
  });
  document.querySelector("#widget-open")?.addEventListener("click", () => void window.pilot.openMain());
}

function showShell(): void {
  const app = document.querySelector<HTMLElement>("#app");
  const widget = document.querySelector<HTMLElement>("#widget");
  if (widgetMode) {
    if (app) app.hidden = true;
    if (widget) widget.hidden = false;
    document.body.classList.add("widget-mode");
  } else if (app) {
    app.hidden = false;
    if (widget) widget.hidden = true;
  }
}

async function main(): Promise<void> {
  showShell();
  bind();
  state = await window.pilot.getState();
  render();
  window.pilot.onState((next) => {
    state = next;
    render();
  });
}

void main();
