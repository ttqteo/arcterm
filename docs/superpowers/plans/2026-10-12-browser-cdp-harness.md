# Browser CDP Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On a Mac (and Linux), the engine's Final stage runs the CDP scenarios for real, in headless Chrome, instead of ending every run "unverified" because WKWebView answers no CDP.

**Architecture:** `scripts/cdp/browser-app.mjs` starts wavesrv from `dist/bin` on its own store, runs vite with a new
`frontend/tauri/vite.browser.config.ts`, and opens the page in Chrome with `--remote-debugging-port`. That config
aliases the six Tauri modules the frontend imports to small stand-ins in `frontend/tauri/browsershim/`, and proxies
wavesrv's routes through vite so the page reaches them on its own origin with the auth key added (what the Tauri http
plugin does today). `final-verify.mjs` picks this "browser" mode on every platform but Windows; `verify.mjs` notices the
stand-ins (`window.__ARC_BROWSER_SHIM__`), keeps focus emulation on, and skips a scenario marked `host: true` (one that
drives the Tauri host itself), which then makes the Final unverified with that reason instead of failing.

**Tech Stack:** Node 24 scripts (`.mjs`, global `fetch`), vite 6 (`mergeConfig`, `server.proxy`, `resolve.alias`,
`define`), `@tauri-apps/api` 2.x (`dpi` classes reused), vitest, Task (`Taskfile.yml`), Google Chrome headless.

**Spec:** none. Designed in chat on 2026-10-12: six recent orchestrator runs (daee8de9, 9978595a, 2efca102, 91136122,
a3325a67, 5e278caf) all ended `unverified` with "… needs CDP, which WKWebView on macOS does not answer". This plan's
Goal and Architecture are the design.

**Verify:** `node scripts/verify.mjs ./pkg/web`

**Final:** `node scripts/cdp/final-verify.mjs surface-smoke agent-grid`

## Global Constraints

- The shipping Tauri build does not change: `frontend/tauri/vite.config.ts`, `frontend/tauri/main.tsx`, `frontend/tauri/api.ts` and everything under `frontend/app/` stay untouched; only the browser config imports the stand-ins.
- Never run prettier on `scripts/*.mjs` (hand-formatted, 4-space; `.editorconfig` omits `.mjs`). Check only the TS files you touched: `npx prettier --check <paths>` and `npx eslint <paths>`.
- Typecheck with `NODE_OPTIONS=--max-old-space-size=4096 task check:ts` (about 2 minutes: give the command a longer timeout), never `npx tsc`. The baseline is clean.
- Stop a dev app, wavesrv, vite or Chrome you started by its PID, never by image name: the person's own arcterm and Chrome are running.
- The browser app installs no agent hooks, `~/.arc/bin/wsh` or skills (those are the Tauri host's job, and it does not run here).
- No `CHANGELOG.md` line: this is internal build and test tooling.
- Comments explain why, in the surrounding files' plain lowercase style; no comment restates the code.

## Review Focus

1. A frontend file later imports a new name from a shimmed Tauri module, or invokes a new Tauri command: the browser app must fail a unit test, not boot to a blank page. Task 1's drift tests pin it.
2. A public asset or module whose path only starts with `/wave` or `/ws` (`/wave-logo.png`, `/wsh.svg`) must be served by vite, not proxied to wavesrv. Task 1's `browserProxy` test pins it.
3. A missing or stale `dist/bin/wavesrv.*` that exits before its `WAVESRV-ESTART` line: the browser app exits nonzero with the reason as its last line, and the Final's unverified reason carries that line. Task 2 and Task 3 tests pin it.
4. A stopped or killed Final leaves no orphaned wavesrv, vite or Chrome: when any part exits, the browser app stops the rest. Task 2's test pins it.
5. A scenario that ends focus emulation (`agent-grid`) leaves headless Chrome, which has no focused window, unfocused for every later scenario. Task 3's `verify.mjs` change re-enables it after each scenario; Task 3's live step runs `agent-grid` then `surface-smoke`.

---

### Task 1: Tauri stand-ins and the browser vite config

**Depends on:** none
**Files:** `frontend/tauri/browsershim/core.ts`, `frontend/tauri/browsershim/event.ts`, `frontend/tauri/browsershim/window.ts`, `frontend/tauri/browsershim/webview.ts`, `frontend/tauri/browsershim/dialog.ts`, `frontend/tauri/browsershim/http.ts`, `frontend/tauri/browsershim/browsershim.test.ts`, `frontend/tauri/browserconfig.ts`, `frontend/tauri/browserconfig.test.ts`, `frontend/tauri/vite.browser.config.ts`

**Interfaces:**
- Consumes: `InitData` (type, `frontend/tauri/api.ts`); `LogicalPosition`, `LogicalSize`, `PhysicalPosition`, `PhysicalSize` from `@tauri-apps/api/dpi` (not shimmed); the base config `frontend/tauri/vite.config.ts` (default export, a plain `UserConfig` object).
- Produces:
  - env names vite reads, set by Task 2's `browser-app.mjs`: `ARC_BROWSER_WEB`, `ARC_BROWSER_WS` (wavesrv's `host:port` from its ESTART line), `ARC_BROWSER_AUTHKEY`, `ARC_BROWSER_VERSION`, `ARC_BROWSER_BUILDTIME`.
  - `window.__ARC_BROWSER_SHIM__ === true` once the page loaded the stand-ins (read by Task 3's `verify.mjs`).
  - `browserconfig.ts`: `BROWSER_ENV`, `SHIMMED: Record<string, string>`, `browserAliases(shimDir: string): { find: RegExp; replacement: string }[]`, `browserInit(env: NodeJS.ProcessEnv, appVersion: string): Omit<InitData, "wsEndpoint" | "webEndpoint">`, `browserProxy(env: NodeJS.ProcessEnv): Record<string, ProxyOptions>`.
  - `browsershim/core.ts`: `invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T>`, `BROWSER_COMMANDS: readonly string[]`.

- [ ] **Step 1: Write the failing config tests**

`frontend/tauri/browserconfig.test.ts`:

```ts
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BROWSER_ENV, SHIMMED, browserAliases, browserInit, browserProxy } from "./browserconfig";

const ENV = {
    [BROWSER_ENV.web]: "127.0.0.1:61270",
    [BROWSER_ENV.ws]: "127.0.0.1:61269",
    [BROWSER_ENV.authKey]: "key-1",
    [BROWSER_ENV.version]: "0.15.10",
    [BROWSER_ENV.buildTime]: "1719240000",
};

// the proxy key vite would pick for a request path, or undefined when vite serves it itself
function proxiedBy(proxy: Record<string, unknown>, path: string): string | undefined {
    return Object.keys(proxy).find((k) => new RegExp(k).test(path));
}

describe("browserProxy", () => {
    const proxy = browserProxy(ENV);

    it("sends wavesrv's routes to its web port with the auth key", () => {
        for (const path of ["/wave/service?service=client", "/wave/stream-file?path=x", "/canvas/tok/index.html", "/html-preview/tok/a.html", "/schema/settings.json"]) {
            const key = proxiedBy(proxy, path);
            expect(key, path).toBeDefined();
            expect(proxy[key!].target).toBe("http://127.0.0.1:61270");
            expect(proxy[key!].headers).toEqual({ "X-AuthKey": "key-1" });
        }
    });

    it("sends the websocket to wavesrv's ws port", () => {
        const key = proxiedBy(proxy, "/ws?stableid=abc");
        expect(key).toBeDefined();
        expect(proxy[key!]).toMatchObject({ target: "ws://127.0.0.1:61269", ws: true, headers: { "X-AuthKey": "key-1" } });
    });

    it("leaves vite's own paths that only start like a wavesrv route", () => {
        for (const path of ["/wave-logo.png", "/wsh.svg", "/waveform/x.js", "/", "/@vite/client", "/fontawesome/css/all.css"]) {
            expect(proxiedBy(proxy, path), path).toBeUndefined();
        }
    });

    it("says which variable is missing", () => {
        expect(() => browserProxy({ ...ENV, [BROWSER_ENV.web]: "" })).toThrow(/ARC_BROWSER_WEB is not set/);
    });
});

describe("browserInit", () => {
    it("carries the key and wavesrv's version, and leaves the endpoints to the page", () => {
        const init = browserInit(ENV, "0.15.11");
        expect(init).toMatchObject({ authKey: "key-1", version: "0.15.10", appVersion: "0.15.11", buildTime: 1719240000, isDev: true, platform: process.platform });
        expect(init).not.toHaveProperty("wsEndpoint");
        expect(init).not.toHaveProperty("webEndpoint");
    });
});

describe("browserAliases", () => {
    it("matches each shimmed module exactly, and nothing under it", () => {
        const aliases = browserAliases("/shim");
        expect(aliases).toHaveLength(Object.keys(SHIMMED).length);
        const core = aliases.find((a) => a.find.test("@tauri-apps/api/core"))!;
        expect(core.replacement).toBe(resolve("/shim", "core.ts"));
        expect(aliases.some((a) => a.find.test("@tauri-apps/api/dpi"))).toBe(false);
        expect(aliases.some((a) => a.find.test("@tauri-apps/api/core.js"))).toBe(false);
    });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run frontend/tauri/browserconfig.test.ts`
Expected: FAIL, "Failed to resolve import ./browserconfig".

- [ ] **Step 3: Write `frontend/tauri/browserconfig.ts`**

```ts
// The node side of the browser app (vite.browser.config.ts): which Tauri modules are swapped for the stand-ins in
// browsershim/, what the page's get_init returns, and which wavesrv routes vite proxies.
import { hostname, userInfo } from "node:os";
import { resolve } from "node:path";
import type { ProxyOptions } from "vite";
import type { InitData } from "./api";

// set by scripts/cdp/browser-app.mjs from wavesrv's WAVESRV-ESTART line and the auth key it started wavesrv with
export const BROWSER_ENV = {
    web: "ARC_BROWSER_WEB",
    ws: "ARC_BROWSER_WS",
    authKey: "ARC_BROWSER_AUTHKEY",
    version: "ARC_BROWSER_VERSION",
    buildTime: "ARC_BROWSER_BUILDTIME",
} as const;

// every Tauri module the frontend imports, and its stand-in in browsershim/
export const SHIMMED: Record<string, string> = {
    "@tauri-apps/api/core": "core.ts",
    "@tauri-apps/api/event": "event.ts",
    "@tauri-apps/api/window": "window.ts",
    "@tauri-apps/api/webview": "webview.ts",
    "@tauri-apps/plugin-dialog": "dialog.ts",
    "@tauri-apps/plugin-http": "http.ts",
};

function need(env: NodeJS.ProcessEnv, name: string): string {
    const v = env[name];
    if (!v) throw new Error(`${name} is not set: start the browser app with task dev:browser`);
    return v;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&");

// exact matches: @tauri-apps/api/dpi, which the window stand-in re-exports, stays the real module
export function browserAliases(shimDir: string): { find: RegExp; replacement: string }[] {
    return Object.entries(SHIMMED).map(([mod, file]) => ({ find: new RegExp(`^${escapeRe(mod)}$`), replacement: resolve(shimDir, file) }));
}

// the endpoints are left out: the page fills in its own origin, which vite proxies to wavesrv
export function browserInit(env: NodeJS.ProcessEnv, appVersion: string): Omit<InitData, "wsEndpoint" | "webEndpoint"> {
    return {
        authKey: need(env, BROWSER_ENV.authKey),
        appVersion,
        version: need(env, BROWSER_ENV.version),
        buildTime: Number(env[BROWSER_ENV.buildTime] ?? 0),
        platform: process.platform,
        isDev: true,
        userName: userInfo().username,
        hostName: hostname(),
    };
}

// same-origin, since wavesrv sends CORS headers only under WAVETERM_DEV, and with the auth key the Tauri http plugin
// adds (frontend/util/fetchutil.ts). Anchored, so an asset whose name only starts with /wave or /ws stays vite's
export function browserProxy(env: NodeJS.ProcessEnv): Record<string, ProxyOptions> {
    const headers = { "X-AuthKey": need(env, BROWSER_ENV.authKey) };
    const web = `http://${need(env, BROWSER_ENV.web)}`;
    return {
        "^/wave/": { target: web, headers },
        "^/(canvas|html-preview|schema)/": { target: web, headers },
        "^/ws(\\?|$)": { target: `ws://${need(env, BROWSER_ENV.ws)}`, ws: true, headers },
    };
}
```

- [ ] **Step 4: Run the config tests to see them pass**

Run: `npx vitest run frontend/tauri/browserconfig.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Write the failing stand-in tests**

`frontend/tauri/browsershim/browsershim.test.ts`:

```ts
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SHIMMED } from "../browserconfig";

const FRONTEND = resolve(__dirname, "../..");

// by file name (browserconfig.ts SHIMMED's values), as static imports so vite resolves each one
const SHIM_MODULES: Record<string, () => Promise<Record<string, unknown>>> = {
    "core.ts": () => import("./core"),
    "event.ts": () => import("./event"),
    "window.ts": () => import("./window"),
    "webview.ts": () => import("./webview"),
    "dialog.ts": () => import("./dialog"),
    "http.ts": () => import("./http"),
};

// every .ts/.tsx under frontend/ but tests, built output and the stand-ins themselves
function sources(): { path: string; text: string }[] {
    return readdirSync(FRONTEND, { recursive: true, encoding: "utf8" })
        .filter((p) => /\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p) && !/(^|[\\/])(dist|node_modules|browsershim)[\\/]/.test(p))
        .map((p) => ({ path: p, text: readFileSync(join(FRONTEND, p), "utf8") }));
}

// module -> value names the frontend takes from it, static (import { a, type B }) and dynamic (const { a } = await import())
function tauriImports(): Map<string, Set<string>> {
    const found = new Map<string, Set<string>>();
    const add = (mod: string, list: string, sep: RegExp) => {
        const names = found.get(mod) ?? new Set<string>();
        found.set(mod, names);
        for (const raw of list.split(",")) {
            const spec = raw.trim();
            if (!spec || spec.startsWith("type ")) continue;
            names.add(spec.split(sep)[0].trim());
        }
    };
    for (const { text } of sources()) {
        for (const m of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*"(@tauri-apps\/[^"]+)"/g)) add(m[2], m[1], /\s+as\s+/);
        for (const m of text.matchAll(/const\s*\{([^}]*)\}\s*=\s*await\s+import\("(@tauri-apps\/[^"]+)"\)/g)) add(m[2], m[1], /:/);
    }
    return found;
}

describe("the stand-ins cover what the frontend uses", () => {
    it("shims every Tauri module the frontend imports, and exports every name it takes", async () => {
        const found = tauriImports();
        expect(found.size).toBeGreaterThan(0);
        for (const [mod, names] of found) {
            expect(Object.keys(SHIMMED), `${mod} has no stand-in in browserconfig.ts SHIMMED`).toContain(mod);
            const shim = await SHIM_MODULES[SHIMMED[mod]]();
            for (const name of names) expect(shim[name], `${mod} stand-in lacks ${name}`).toBeDefined();
        }
    });

    it("answers every Tauri command the frontend invokes", async () => {
        const { BROWSER_COMMANDS } = await import("./core");
        const invoked = new Set<string>();
        for (const { text } of sources()) for (const m of text.matchAll(/invoke(?:<[^>]*>)?\("([a-z_]+)"/g)) invoked.add(m[1]);
        expect(invoked.size).toBeGreaterThan(0);
        for (const cmd of invoked) expect(BROWSER_COMMANDS, `core.ts answers no ${cmd}`).toContain(cmd);
    });
});

describe("core stand-in", () => {
    beforeEach(() => {
        vi.stubGlobal("location", { host: "localhost:5180" });
        vi.stubGlobal("__ARC_BROWSER_INIT__", { authKey: "k", appVersion: "1", version: "1", buildTime: 0, platform: "darwin", isDev: true, userName: "u", hostName: "h" });
    });
    afterEach(() => vi.unstubAllGlobals());

    it("returns the init data with the page's own origin as both endpoints, and marks the page", async () => {
        const { invoke } = await import("./core");
        const init = await invoke<Record<string, unknown>>("get_init");
        expect(init).toMatchObject({ authKey: "k", wsEndpoint: "localhost:5180", webEndpoint: "localhost:5180" });
        expect((globalThis as any).__ARC_BROWSER_SHIM__).toBe(true);
    });

    it("emits wave-init when the window says ready, as the host does", async () => {
        const { invoke } = await import("./core");
        const { listen } = await import("./event");
        const seen: unknown[] = [];
        const unlisten = await listen("wave-init", (e) => seen.push(e.payload));
        await invoke("set_window_init_status", { status: "ready" });
        unlisten();
        await invoke("set_window_init_status", { status: "ready" });
        expect(seen).toEqual([{ tabId: "", clientId: "", windowId: "", activate: true }]);
    });

    it("says the page is in front, and refuses a window capture and an unknown command", async () => {
        const { invoke } = await import("./core");
        expect(await invoke("app_foreground")).toBe("ours");
        await expect(invoke("capture_webview")).rejects.toThrow(/Tauri host/);
        await expect(invoke("no_such_command")).rejects.toThrow(/no_such_command/);
    });
});

describe("window stand-in", () => {
    beforeEach(() => {
        vi.stubGlobal("window", { innerWidth: 800, innerHeight: 600, devicePixelRatio: 2, screen: { width: 1440, height: 900 }, addEventListener: vi.fn(), removeEventListener: vi.fn() });
        vi.stubGlobal("document", { hasFocus: () => true });
    });
    afterEach(() => vi.unstubAllGlobals());

    // every method the frontend calls on getCurrentWindow() (app-bar, chrome, floatstore, miniclickthrough, sprout-mini, dockbadgesync)
    const METHODS = ["close", "innerPosition", "innerSize", "isFocused", "isFullscreen", "isMaximized", "isMinimized", "isVisible", "maximize", "minimize", "onFocusChanged", "onMoved", "onResized", "outerPosition", "outerSize", "scaleFactor", "setAlwaysOnTop", "setBadgeCount", "setFullscreen", "setIgnoreCursorEvents", "setMinSize", "setPosition", "setShadow", "setSize", "startDragging", "toggleMaximize", "unmaximize", "unminimize"];

    it("has every method the frontend calls", async () => {
        const { getCurrentWindow } = await import("./window");
        const w = getCurrentWindow() as any;
        for (const m of METHODS) expect(typeof w[m], m).toBe("function");
    });

    it("reports the page as a plain, unmaximized window of the page's size", async () => {
        const { getCurrentWindow, PhysicalSize, primaryMonitor } = await import("./window");
        const w = getCurrentWindow();
        expect(await w.isMaximized()).toBe(false);
        expect(await w.isFullscreen()).toBe(false);
        expect(await w.scaleFactor()).toBe(2);
        const size = await w.innerSize();
        expect(size).toBeInstanceOf(PhysicalSize);
        expect([size.width, size.height]).toEqual([1600, 1200]);
        expect((await primaryMonitor())!.size).toMatchObject({ width: 2880, height: 1800 });
    });

    it("forwards the page's resize to onResized and stops on unlisten", async () => {
        const { getCurrentWindow } = await import("./window");
        const cb = vi.fn();
        const unlisten = await getCurrentWindow().onResized(cb);
        const add = (window.addEventListener as any).mock.calls.find((c: unknown[]) => c[0] === "resize");
        add[1]();
        expect(cb).toHaveBeenCalledOnce();
        unlisten();
        expect(window.removeEventListener).toHaveBeenCalledWith("resize", add[1]);
    });
});

describe("dialog and http stand-ins", () => {
    it("cancels every dialog", async () => {
        const { open, save } = await import("./dialog");
        expect(await open()).toBeNull();
        expect(await save()).toBeNull();
    });
});
```

- [ ] **Step 6: Run them to see them fail**

Run: `npx vitest run frontend/tauri/browsershim/browsershim.test.ts`
Expected: FAIL, "Failed to resolve import ./core".

- [ ] **Step 7: Write the stand-ins**

`frontend/tauri/browsershim/event.ts`:

```ts
// Browser stand-in for @tauri-apps/api/event (vite.browser.config.ts aliases it): an in-page bus, since no Rust side
// emits here. core.ts emits wave-init on it, as the host does.
type TauriEvent<T> = { event: string; id: number; payload: T };
type Handler = (e: TauriEvent<unknown>) => void;

const handlers = new Map<string, Set<Handler>>();
let nextId = 1;

export async function listen<T>(event: string, handler: (e: TauriEvent<T>) => void): Promise<() => void> {
    const set = handlers.get(event) ?? new Set<Handler>();
    handlers.set(event, set);
    set.add(handler as Handler);
    return () => {
        set.delete(handler as Handler);
    };
}

export async function emit(event: string, payload?: unknown): Promise<void> {
    for (const h of [...(handlers.get(event) ?? [])]) h({ event, id: nextId++, payload });
}
```

`frontend/tauri/browsershim/core.ts`:

```ts
// Browser stand-in for @tauri-apps/api/core (vite.browser.config.ts aliases it): answers the commands the frontend
// invokes the way the Tauri host would for a plain page, so the cockpit boots in Chrome for the CDP scenarios.
import type { InitData } from "../api";
import { emit } from "./event";

// written by vite.browser.config.ts's define from browserconfig.ts browserInit
declare const __ARC_BROWSER_INIT__: Omit<InitData, "wsEndpoint" | "webEndpoint"> | undefined;

// scripts/cdp/verify.mjs reads it to skip the scenarios that drive the Tauri host
(globalThis as any).__ARC_BROWSER_SHIM__ = true;

const NO_OPS = ["fe_log", "open_external", "notify_os", "hold_window_frame", "redirect_minimize", "set_folded_chrome"];
export const BROWSER_COMMANDS: readonly string[] = ["get_init", "set_window_init_status", "app_foreground", "capture_webview", ...NO_OPS];

function initData(): InitData {
    const base = typeof __ARC_BROWSER_INIT__ === "undefined" ? undefined : __ARC_BROWSER_INIT__;
    if (!base) throw new Error("no __ARC_BROWSER_INIT__: start the browser app with task dev:browser");
    // vite proxies wavesrv's routes (browserconfig.ts browserProxy), so both endpoints are this page's own origin
    return { ...base, wsEndpoint: location.host, webEndpoint: location.host };
}

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    switch (cmd) {
        case "get_init":
            return initData() as T;
        case "set_window_init_status":
            if (args?.status === "ready") await emit("wave-init", { tabId: "", clientId: "", windowId: "", activate: true });
            return undefined as T;
        case "app_foreground":
            return "ours" as T;
        case "capture_webview":
            throw new Error("window capture needs the Tauri host");
        case "fe_log":
            console.log(`[fe-log] ${String(args?.msg)}`);
            return undefined as T;
    }
    if (NO_OPS.includes(cmd)) return undefined as T;
    throw new Error(`the browser app answers no Tauri command ${cmd}`);
}
```

`frontend/tauri/browsershim/window.ts`:

```ts
// Browser stand-in for @tauri-apps/api/window (vite.browser.config.ts aliases it): the page is one plain, unmaximized
// window of its own size on one monitor, and every move, resize or flag is a no-op, since no native window exists.
import { LogicalPosition, LogicalSize, PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import type { Monitor, Window } from "@tauri-apps/api/window";

export { LogicalPosition, LogicalSize, PhysicalPosition, PhysicalSize };

const ok = async () => {};
const scale = () => window.devicePixelRatio || 1;
const origin = () => new PhysicalPosition(0, 0);
const pageSize = () => new PhysicalSize(Math.round(window.innerWidth * scale()), Math.round(window.innerHeight * scale()));

function monitor(): Monitor {
    const s = scale();
    const size = new PhysicalSize(Math.round(window.screen.width * s), Math.round(window.screen.height * s));
    return { name: "browser", size, position: origin(), scaleFactor: s, workArea: { position: origin(), size } } as Monitor;
}

function onPage(event: string, payload: () => unknown) {
    return async (cb: (e: { event: string; id: number; payload: unknown }) => void) => {
        const h = () => cb({ event, id: 0, payload: payload() });
        window.addEventListener(event, h);
        return () => window.removeEventListener(event, h);
    };
}

const current = {
    label: "main",
    isMaximized: async () => false,
    isMinimized: async () => false,
    isFullscreen: async () => false,
    isVisible: async () => true,
    isFocused: async () => document.hasFocus(),
    scaleFactor: async () => scale(),
    innerSize: async () => pageSize(),
    outerSize: async () => pageSize(),
    innerPosition: async () => origin(),
    outerPosition: async () => origin(),
    onResized: onPage("resize", pageSize),
    onFocusChanged: async (cb: (e: { event: string; id: number; payload: boolean }) => void) => {
        const focus = () => cb({ event: "focus", id: 0, payload: true });
        const blur = () => cb({ event: "blur", id: 0, payload: false });
        window.addEventListener("focus", focus);
        window.addEventListener("blur", blur);
        return () => {
            window.removeEventListener("focus", focus);
            window.removeEventListener("blur", blur);
        };
    },
    onMoved: async () => () => {},
    close: ok,
    minimize: ok,
    unminimize: ok,
    maximize: ok,
    unmaximize: ok,
    toggleMaximize: ok,
    startDragging: ok,
    setAlwaysOnTop: ok,
    setBadgeCount: ok,
    setFullscreen: ok,
    setIgnoreCursorEvents: ok,
    setMinSize: ok,
    setPosition: ok,
    setShadow: ok,
    setSize: ok,
};

export function getCurrentWindow(): Window {
    return current as unknown as Window;
}

export async function cursorPosition(): Promise<PhysicalPosition> {
    return origin();
}

export async function primaryMonitor(): Promise<Monitor | null> {
    return monitor();
}

export async function currentMonitor(): Promise<Monitor | null> {
    return monitor();
}

export async function availableMonitors(): Promise<Monitor[]> {
    return [monitor()];
}
```

`frontend/tauri/browsershim/webview.ts`:

```ts
// Browser stand-in for @tauri-apps/api/webview (vite.browser.config.ts aliases it): zoom is the native webview's,
// so it is a no-op here.
import type { Webview } from "@tauri-apps/api/webview";

const current = { label: "main", setZoom: async () => {} };

export function getCurrentWebview(): Webview {
    return current as unknown as Webview;
}
```

`frontend/tauri/browsershim/dialog.ts`:

```ts
// Browser stand-in for @tauri-apps/plugin-dialog (vite.browser.config.ts aliases it): no native dialog opens here, so
// every one is cancelled, which every caller already handles.
export async function open(): Promise<null> {
    return null;
}

export async function save(): Promise<null> {
    return null;
}
```

`frontend/tauri/browsershim/http.ts`:

```ts
// Browser stand-in for @tauri-apps/plugin-http (vite.browser.config.ts aliases it): the page's own fetch, since vite
// proxies wavesrv on the page's origin with the auth key (browserconfig.ts browserProxy).
export function fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    return globalThis.fetch(input, init);
}
```

Each test calls `await import("./core")` and friends; vitest caches modules per file, so the event bus is shared across the core tests in one file, which the wave-init test relies on (it unlistens before its second invoke).

- [ ] **Step 8: Run the stand-in tests to see them pass**

Run: `npx vitest run frontend/tauri/browsershim/browsershim.test.ts frontend/tauri/browserconfig.test.ts`
Expected: PASS. If the drift test names a module, export or command the stand-ins lack, add it to the stand-in (never filter it out of the test).

- [ ] **Step 9: Write `frontend/tauri/vite.browser.config.ts`**

```ts
import { readFileSync } from "fs";
import { resolve } from "path";
import { defineConfig, mergeConfig } from "vite";
import { browserAliases, browserInit, browserProxy } from "./browserconfig";
import base from "./vite.config";

// The cockpit in a plain browser, for the CDP scenarios where the webview answers no CDP (macOS's WKWebView):
// scripts/cdp/browser-app.mjs starts wavesrv and runs vite with this. Tauri's modules become the stand-ins in
// browsershim/, and wavesrv's routes are proxied so the page reaches them on its own origin.
const appVersion: string = JSON.parse(readFileSync(resolve(__dirname, "../../package.json"), "utf8")).version;

export default defineConfig(() =>
    mergeConfig(base, {
        resolve: { alias: browserAliases(resolve(__dirname, "browsershim")) },
        define: { __ARC_BROWSER_INIT__: JSON.stringify(browserInit(process.env, appVersion)) },
        server: { proxy: browserProxy(process.env) },
    })
);
```

- [ ] **Step 10: Check the config loads**

Run: `ARC_BROWSER_WEB=127.0.0.1:1 ARC_BROWSER_WS=127.0.0.1:2 ARC_BROWSER_AUTHKEY=k ARC_BROWSER_VERSION=0 node -e "import('vite').then(v => v.resolveConfig({ configFile: 'frontend/tauri/vite.browser.config.ts' }, 'serve')).then(c => console.log(Object.keys(c.server.proxy), c.resolve.alias.filter(a => String(a.find).includes('tauri-apps')).length, c.resolve.alias.some(a => a.find === '@/store')))"`
Expected: prints the three proxy keys, `6` (the stand-ins) and `true` (the base config's aliases survived the merge).

- [ ] **Step 11: Typecheck, lint and format the touched files**

Run: `NODE_OPTIONS=--max-old-space-size=4096 task check:ts` (timeout 5 min), then `npx eslint frontend/tauri/browsershim frontend/tauri/browserconfig.ts frontend/tauri/browserconfig.test.ts frontend/tauri/vite.browser.config.ts` and `npx prettier --check frontend/tauri/browsershim frontend/tauri/browserconfig.ts frontend/tauri/browserconfig.test.ts frontend/tauri/vite.browser.config.ts`
Expected: all exit 0. Fix prettier findings with `npx prettier --write` on these paths only.

- [ ] **Step 12: Commit**

```bash
git add frontend/tauri/browsershim frontend/tauri/browserconfig.ts frontend/tauri/browserconfig.test.ts frontend/tauri/vite.browser.config.ts
git commit -m "feat(cdp): a browser build of the cockpit: Tauri stand-ins and a vite config that proxies wavesrv"
```

### Task 2: The browser app launcher and `task dev:browser`

**Depends on:** none
**Files:** `scripts/cdp/browser-app.mjs`, `scripts/cdp/browser-app.test.mjs`, `Taskfile.yml`

**Interfaces:**
- Consumes: Task 1's env names `ARC_BROWSER_WEB`, `ARC_BROWSER_WS`, `ARC_BROWSER_AUTHKEY`, `ARC_BROWSER_VERSION`, `ARC_BROWSER_BUILDTIME` and the config path `frontend/tauri/vite.browser.config.ts` (it need not exist for this task's tests, which run a stand-in vite).
- Produces (Task 3 relies on these):
  - `task dev:browser [-- --headed]`, which builds the dev-host backend like `task dev` and runs `node scripts/cdp/browser-app.mjs`.
  - inputs: `ARC_BROWSER_CDP_PORT` (default `9222`), `ARC_BROWSER_VITE_PORT` (default `5180`), `ARC_DEV_DATA_DIR` (the store; default `defaultStore()`), `CHROME_PATH`; test-only `ARC_BROWSER_WAVESRV` and `ARC_BROWSER_VITE_SCRIPT` (a `.js`/`.cjs`/`.mjs` path runs under node).
  - stdout: `browser app ready: http://localhost:<vite>/ (CDP :<cdp>, store <dir>)` once Chrome answers CDP; on a failure, the reason as its last line and a nonzero exit.
  - wavesrv's stderr is appended to `<store>/data/waveapp.log` (final-verify keeps that file).
  - exports: `parseEstart`, `wavesrvPath`, `defaultStore`, `findChrome`, `chromeArgs`, `wavesrvEnv`, `viteEnv`, `DEFAULT_CDP_PORT`, `DEFAULT_VITE_PORT`.

- [ ] **Step 1: Write the failing tests**

`scripts/cdp/browser-app.test.mjs`:

```js
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { chromeArgs, defaultStore, findChrome, parseEstart, viteEnv, wavesrvEnv, wavesrvPath } from "./browser-app.mjs";

const SCRIPT = fileURLToPath(new URL("./browser-app.mjs", import.meta.url));

describe("parseEstart", () => {
    it("reads wavesrv's endpoints, version and build time", () => {
        expect(parseEstart("WAVESRV-ESTART ws:127.0.0.1:61269 web:127.0.0.1:61270 version:0.11.0-beta.1 buildtime:1719240000")).toEqual({
            ws: "127.0.0.1:61269",
            web: "127.0.0.1:61270",
            version: "0.11.0-beta.1",
            buildtime: 1719240000,
        });
    });
    it("is null for any other line", () => {
        expect(parseEstart("[wavesrv] listening on 127.0.0.1:61270")).toBeNull();
    });
});

describe("wavesrvPath", () => {
    it("names the binary as the Taskfile does", () => {
        expect(wavesrvPath("/r", "darwin", "arm64")).toBe(join("/r", "dist", "bin", "wavesrv.arm64"));
        expect(wavesrvPath("/r", "win32", "x64")).toBe(join("/r", "dist", "bin", "wavesrv.x64.exe"));
    });
});

describe("defaultStore", () => {
    it("keeps a store of its own beside the dev app's, short enough for wavesrv's socket", () => {
        const store = defaultStore("darwin", {}, "/Users/someone");
        expect(store).toBe(join("/Users/someone", "Library", "Application Support", "dev.arc.app-browser"));
        // macOS caps a unix socket path at 104 bytes; wavesrv binds <store>/data/wave.sock
        expect(Buffer.byteLength(join(store, "data", "wave.sock"))).toBeLessThan(104);
        expect(defaultStore("win32", { LOCALAPPDATA: "C:\\L" }, "C:\\U")).toBe(join("C:\\L", "dev.arc.app-browser"));
    });
});

describe("findChrome", () => {
    it("takes CHROME_PATH when it exists, and is null when it does not", () => {
        expect(findChrome("darwin", { CHROME_PATH: "/x/chrome" }, (p) => p === "/x/chrome")).toBe("/x/chrome");
        expect(findChrome("darwin", { CHROME_PATH: "/x/chrome" }, () => false)).toBeNull();
    });
    it("finds the installed Chrome", () => {
        const mac = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
        expect(findChrome("darwin", {}, (p) => p === mac)).toBe(mac);
        expect(findChrome("darwin", {}, () => false)).toBeNull();
    });
});

describe("chromeArgs", () => {
    it("is headless unless headed, on its own profile, with the page last", () => {
        const args = chromeArgs({ cdpPort: 9300, url: "http://localhost:5180/", profile: "/s/chrome", headed: false });
        expect(args).toContain("--headless=new");
        expect(args).toContain("--remote-debugging-port=9300");
        expect(args).toContain("--user-data-dir=/s/chrome");
        expect(args.at(-1)).toBe("http://localhost:5180/");
        expect(chromeArgs({ cdpPort: 9300, url: "u", profile: "p", headed: true })).not.toContain("--headless=new");
    });
});

describe("wavesrvEnv and viteEnv", () => {
    it("start wavesrv on the store with the key, and hand vite what it printed", () => {
        expect(wavesrvEnv({ authKey: "k", root: "/r", store: "/s", env: {} })).toEqual({
            WAVETERM_AUTH_KEY: "k",
            WAVETERM_APP_PATH: join("/r", "dist"),
            WAVETERM_DATA_HOME: join("/s", "data"),
            WAVETERM_CONFIG_HOME: join("/s", "config"),
        });
        const estart = { ws: "127.0.0.1:1", web: "127.0.0.1:2", version: "0.15.10", buildtime: 7 };
        expect(viteEnv({ estart, authKey: "k", env: {} })).toEqual({
            ARC_BROWSER_WEB: "127.0.0.1:2",
            ARC_BROWSER_WS: "127.0.0.1:1",
            ARC_BROWSER_AUTHKEY: "k",
            ARC_BROWSER_VERSION: "0.15.10",
            ARC_BROWSER_BUILDTIME: "7",
        });
    });
});

function freePort() {
    return new Promise((resolve) => {
        const srv = createServer();
        srv.listen(0, "127.0.0.1", () => {
            const { port } = srv.address();
            srv.close(() => resolve(port));
        });
    });
}

function alive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

async function gone(pid, ms) {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
        if (!alive(pid)) return true;
        await new Promise((r) => setTimeout(r, 100));
    }
    return !alive(pid);
}

// stand-ins for wavesrv, vite and Chrome: each records its pid (and vite its argv and env) and answers what the
// browser app waits on
function fakes(dir, { wavesrvExit } = {}) {
    const wavesrv = join(dir, "wavesrv.cjs");
    writeFileSync(
        wavesrv,
        `require("fs").writeFileSync(${JSON.stringify(join(dir, "wavesrv.pid"))}, String(process.pid));
${wavesrvExit ? `process.exit(${wavesrvExit});` : `process.stderr.write("WAVESRV-ESTART ws:127.0.0.1:1 web:127.0.0.1:2 version:0.15.10 buildtime:7\\n");`}
setInterval(() => {}, 1000);
`
    );
    const vite = join(dir, "vite.cjs");
    writeFileSync(
        vite,
        `const fs = require("fs");
fs.writeFileSync(${JSON.stringify(join(dir, "vite.pid"))}, String(process.pid));
fs.writeFileSync(${JSON.stringify(join(dir, "vite.json"))}, JSON.stringify({ argv: process.argv.slice(2), env: process.env }));
const port = Number(process.argv[process.argv.indexOf("--port") + 1]);
require("http").createServer((q, s) => s.end("vite")).listen(port, "localhost");
`
    );
    const chrome = join(dir, "chrome.cjs");
    writeFileSync(
        chrome,
        `require("fs").writeFileSync(${JSON.stringify(join(dir, "chrome.pid"))}, String(process.pid));
const port = Number(process.argv.find((a) => a.startsWith("--remote-debugging-port=")).split("=")[1]);
require("http").createServer((q, s) => s.end("{}")).listen(port, "127.0.0.1");
`
    );
    return { wavesrv, vite, chrome };
}

function start(env) {
    const child = spawn(process.execPath, [SCRIPT], { env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    const exited = new Promise((resolve) => child.on("exit", (code) => resolve(code)));
    const ready = async (ms) => {
        const deadline = Date.now() + ms;
        while (Date.now() < deadline && !out.includes("browser app ready")) await new Promise((r) => setTimeout(r, 100));
        return out.includes("browser app ready");
    };
    return { child, exited, ready, out: () => out };
}

describe("browser-app.mjs", () => {
    let dir;
    afterEach(() => {
        if (dir) rmSync(dir, { recursive: true, force: true });
        dir = undefined;
    });

    async function env(f) {
        return {
            ...process.env,
            ARC_DEV_DATA_DIR: join(dir, "store"),
            ARC_BROWSER_WAVESRV: f.wavesrv,
            ARC_BROWSER_VITE_SCRIPT: f.vite,
            CHROME_PATH: f.chrome,
            ARC_BROWSER_CDP_PORT: String(await freePort()),
            ARC_BROWSER_VITE_PORT: String(await freePort()),
        };
    }

    it("starts wavesrv, vite with the browser config and wavesrv's endpoints, then Chrome; and stops them all when one exits", async () => {
        dir = mkdtempSync(join(tmpdir(), "browser-app-"));
        const f = fakes(dir);
        const e = await env(f);
        const app = start(e);
        expect(await app.ready(20_000)).toBe(true);
        const vite = JSON.parse(readFileSync(join(dir, "vite.json"), "utf8"));
        expect(vite.argv).toEqual(["--config", expect.stringMatching(/frontend[\\/]tauri[\\/]vite\.browser\.config\.ts$/), "--port", e.ARC_BROWSER_VITE_PORT, "--strictPort"]);
        expect(vite.env).toMatchObject({ ARC_BROWSER_WEB: "127.0.0.1:2", ARC_BROWSER_WS: "127.0.0.1:1", ARC_BROWSER_VERSION: "0.15.10" });
        expect(readFileSync(join(dir, "store", "data", "waveapp.log"), "utf8")).toContain("WAVESRV-ESTART");

        const pids = ["wavesrv", "vite", "chrome"].map((n) => Number(readFileSync(join(dir, `${n}.pid`), "utf8")));
        process.kill(pids[0], "SIGKILL");
        expect(await app.exited).not.toBe(0);
        expect(app.out().trim().split("\n").at(-1)).toMatch(/^wavesrv exited .* while running$/);
        for (const pid of pids) expect(await gone(pid, 5000)).toBe(true);
    }, 40_000);

    // a signal from the shell or from final-verify reaches the browser app, which stops what it started
    it.skipIf(process.platform === "win32")("stops wavesrv, vite and Chrome on SIGTERM", async () => {
        dir = mkdtempSync(join(tmpdir(), "browser-app-"));
        const app = start(await env(fakes(dir)));
        expect(await app.ready(20_000)).toBe(true);
        const pids = ["wavesrv", "vite", "chrome"].map((n) => Number(readFileSync(join(dir, `${n}.pid`), "utf8")));
        app.child.kill("SIGTERM");
        await app.exited;
        for (const pid of pids) expect(await gone(pid, 5000)).toBe(true);
    }, 40_000);

    it("says why when wavesrv exits before it is ready, and starts nothing else", async () => {
        dir = mkdtempSync(join(tmpdir(), "browser-app-"));
        const app = start(await env(fakes(dir, { wavesrvExit: 2 })));
        expect(await app.exited).not.toBe(0);
        expect(app.out().trim().split("\n").at(-1)).toBe("wavesrv exited with code 2 before the browser app was ready");
        expect(existsSync(join(dir, "vite.pid"))).toBe(false);
    }, 20_000);

    it("says how to get Chrome when none is found", async () => {
        dir = mkdtempSync(join(tmpdir(), "browser-app-"));
        const app = start({ ...(await env(fakes(dir))), CHROME_PATH: join(dir, "no-chrome") });
        expect(await app.exited).toBe(1);
        expect(app.out().trim().split("\n").at(-1)).toBe("no Chrome found: install Google Chrome or set CHROME_PATH");
    }, 20_000);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run scripts/cdp/browser-app.test.mjs`
Expected: FAIL, "Failed to load ./browser-app.mjs".

- [ ] **Step 3: Write `scripts/cdp/browser-app.mjs`**

```js
// The cockpit in headless Chrome, for the CDP scenarios where the webview answers no CDP (macOS's WKWebView). It
// starts wavesrv from dist/bin on its own store, runs vite with frontend/tauri/vite.browser.config.ts (Tauri's modules
// swapped for stand-ins, wavesrv proxied on the page's origin), then opens the page in Chrome with
// --remote-debugging-port, which scripts/cdp/verify.mjs attaches to as it does to the dev app's WebView2.
//
//   task dev:browser [-- --headed]
//
// ARC_BROWSER_CDP_PORT (default 9222), ARC_BROWSER_VITE_PORT (default 5180), ARC_DEV_DATA_DIR (the store) and
// CHROME_PATH; ARC_BROWSER_WAVESRV and ARC_BROWSER_VITE_SCRIPT exist so the test can run stand-ins. Nothing global is
// installed (agent hooks, ~/.arc/bin/wsh, skills): that is the Tauri host's job, and it does not run here.
// When any part exits, or a signal comes, it stops the rest and exits nonzero with the reason as its last line.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";

export const DEFAULT_CDP_PORT = 9222;
// past the dev app's 5174 and final-verify's 5175+, so it runs beside both
export const DEFAULT_VITE_PORT = 5180;
const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const BOOT_MS = 120_000;
const POLL_MS = 500;

// mirrors src-tauri/src/estart.rs
const ESTART_RE = /WAVESRV-ESTART ws:([a-z0-9.:]+) web:([a-z0-9.:]+) version:([a-z0-9.-]+) buildtime:(\d+)/;

export function parseEstart(line) {
    const m = ESTART_RE.exec(line);
    return m ? { ws: m[1], web: m[2], version: m[3], buildtime: Number(m[4]) } : null;
}

// the Taskfile names wavesrv after the arch it runs on, amd64 spelled x64 (src-tauri/src/main.rs wavesrv_name)
export function wavesrvPath(root, platform = process.platform, arch = process.arch) {
    return join(root, "dist", "bin", `wavesrv.${arch === "arm64" ? "arm64" : "x64"}${platform === "win32" ? ".exe" : ""}`);
}

// a store of its own: two wavesrv on one store fight over its wave.lock, and `task dev` may be running
export function defaultStore(platform = process.platform, env = process.env, home = homedir()) {
    const name = "dev.arc.app-browser";
    if (platform === "win32") return join(env.LOCALAPPDATA || join(home, "AppData", "Local"), name);
    if (platform === "darwin") return join(home, "Library", "Application Support", name);
    return join(env.XDG_DATA_HOME || join(home, ".local", "share"), name);
}

const CHROME_PATHS = {
    darwin: ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium"],
    win32: ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"],
    linux: ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"],
};

export function findChrome(platform = process.platform, env = process.env, exists = existsSync) {
    if (env.CHROME_PATH) return exists(env.CHROME_PATH) ? env.CHROME_PATH : null;
    return (CHROME_PATHS[platform] ?? CHROME_PATHS.linux).find((p) => exists(p)) ?? null;
}

// its own profile, so it never opens in, or locks, the person's Chrome; the size matches verify.mjs's viewport
export function chromeArgs({ cdpPort, url, profile, headed }) {
    return [
        ...(headed ? [] : ["--headless=new"]),
        `--remote-debugging-port=${cdpPort}`,
        `--user-data-dir=${profile}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--window-size=1600,950",
        url,
    ];
}

// what spawn_wavesrv (src-tauri/src/main.rs) gives it
export function wavesrvEnv({ authKey, root, store, env = process.env }) {
    return {
        ...env,
        WAVETERM_AUTH_KEY: authKey,
        WAVETERM_APP_PATH: join(root, "dist"),
        WAVETERM_DATA_HOME: join(store, "data"),
        WAVETERM_CONFIG_HOME: join(store, "config"),
    };
}

// what vite.browser.config.ts reads (frontend/tauri/browserconfig.ts BROWSER_ENV)
export function viteEnv({ estart, authKey, env = process.env }) {
    return {
        ...env,
        ARC_BROWSER_WEB: estart.web,
        ARC_BROWSER_WS: estart.ws,
        ARC_BROWSER_AUTHKEY: authKey,
        ARC_BROWSER_VERSION: estart.version,
        ARC_BROWSER_BUILDTIME: String(estart.buildtime),
    };
}

function fail(reason) {
    console.log(reason);
    process.exit(1);
}

async function answers(url) {
    try {
        return (await fetch(url, { signal: AbortSignal.timeout(2_000) })).ok;
    } catch {
        return false;
    }
}

async function waitFor(url, ms) {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
        if (await answers(url)) return true;
        await new Promise((r) => setTimeout(r, POLL_MS));
    }
    return false;
}

async function main() {
    const headed = process.argv.includes("--headed");
    const cdpPort = Number(process.env.ARC_BROWSER_CDP_PORT) || DEFAULT_CDP_PORT;
    const vitePort = Number(process.env.ARC_BROWSER_VITE_PORT) || DEFAULT_VITE_PORT;
    const store = process.env.ARC_DEV_DATA_DIR || defaultStore();
    const chrome = findChrome();
    if (!chrome) fail("no Chrome found: install Google Chrome or set CHROME_PATH");
    const wavesrv = process.env.ARC_BROWSER_WAVESRV || wavesrvPath(ROOT);
    if (!existsSync(wavesrv)) fail(`no wavesrv at ${wavesrv}: task dev:browser builds it`);
    mkdirSync(join(store, "data"), { recursive: true });
    mkdirSync(join(store, "config"), { recursive: true });

    // none is detached, so a kill of this process group (final-verify's) takes them all too
    const children = [];
    let ready = false;
    let stopping = false;
    const stop = (reason) => {
        if (stopping) return;
        stopping = true;
        for (const c of children) if (c.exitCode === null && c.signalCode === null) c.kill("SIGKILL");
        fail(reason);
    };
    for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => stop(`stopped by ${sig}`));
    const start = (name, file, args, opts) => {
        // a .js/.cjs/.mjs file (vite's bin, the test's stand-ins) runs under this node
        const [cmd, argv] = /\.[cm]?js$/.test(file) ? [process.execPath, [file, ...args]] : [file, args];
        const child = spawn(cmd, argv, opts);
        children.push(child);
        child.on("exit", (code, signal) => {
            const how = code === null ? `on ${signal}` : `with code ${code}`;
            stop(`${name} exited ${how} ${ready ? "while running" : "before the browser app was ready"}`);
        });
        return child;
    };

    const authKey = randomUUID();
    // the Tauri host keeps wavesrv's stderr in waveapp.log too; final-verify copies it out of the store
    const log = createWriteStream(join(store, "data", "waveapp.log"), { flags: "a" });
    // stdin stays a pipe this process holds: wavesrv quits on its EOF
    const srv = start("wavesrv", wavesrv, [], { env: wavesrvEnv({ authKey, root: ROOT, store }), stdio: ["pipe", "ignore", "pipe"] });
    const estart = await new Promise((res) => {
        const timer = setTimeout(() => stop(`wavesrv printed no WAVESRV-ESTART line in ${BOOT_MS / 1000}s`), BOOT_MS);
        createInterface({ input: srv.stderr }).on("line", (line) => {
            log.write(line + "\n");
            const e = parseEstart(line);
            if (e) {
                clearTimeout(timer);
                res(e);
            }
        });
    });

    const vite = process.env.ARC_BROWSER_VITE_SCRIPT || join(ROOT, "node_modules", "vite", "bin", "vite.js");
    const config = join(ROOT, "frontend", "tauri", "vite.browser.config.ts");
    start("vite", vite, ["--config", config, "--port", String(vitePort), "--strictPort"], {
        cwd: ROOT,
        env: viteEnv({ estart, authKey }),
        stdio: ["ignore", "inherit", "inherit"],
    });
    const url = `http://localhost:${vitePort}/`;
    if (!(await waitFor(url, BOOT_MS))) stop(`vite did not answer on ${url} in ${BOOT_MS / 1000}s`);

    start("chrome", chrome, chromeArgs({ cdpPort, url, profile: join(store, "chrome"), headed }), { stdio: "ignore" });
    if (!(await waitFor(`http://127.0.0.1:${cdpPort}/json/version`, BOOT_MS))) stop(`chrome did not answer CDP on :${cdpPort}`);
    ready = true;
    console.log(`browser app ready: ${url} (CDP :${cdpPort}, store ${store})`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((e) => fail(`browser-app: ${e?.message ?? e}`));
}
```

Note: the test's last-line checks read stdout. `stop()` prints through `fail()` (stdout); vite's own output is inherited, so a test stand-in prints nothing there.

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run scripts/cdp/browser-app.test.mjs`
Expected: PASS (11 tests; the SIGTERM one skips on Windows).

- [ ] **Step 5: Add `task dev:browser`**

In `Taskfile.yml`, directly after the `tauri:dev:` task block (before `tauri:sync-version:`), add:

```yaml
    dev:browser:
        desc: "Run the cockpit in headless Chrome for the CDP scenarios where the webview answers none (macOS's WKWebView): builds the dev-host backend like `task dev`, then scripts/cdp/browser-app.mjs (CDP :9222, vite :5180). `task dev:browser -- --headed` shows the window."
        cmd: node scripts/cdp/browser-app.mjs {{.CLI_ARGS}}
        deps:
            - npm:install
            - sync:piartifacts
            - sync:claudemod
            - build:backend:devhost
            - build:backend:devhost:full
        env:
            WAVETERM_ENVFILE: "{{.ROOT_DIR}}/.env"
            WAVETERM_NOCONFIRMQUIT: "1"
```

- [ ] **Step 6: Check the task is listed**

Run: `task --list | grep dev:browser`
Expected: one line naming `dev:browser`.

- [ ] **Step 7: Commit**

```bash
git add scripts/cdp/browser-app.mjs scripts/cdp/browser-app.test.mjs Taskfile.yml
git commit -m "feat(cdp): task dev:browser starts wavesrv, vite and headless Chrome for the scenarios"
```

### Task 3: Final and verify run the scenarios in the browser app off Windows

**Depends on:** Task 1, Task 2
**Files:** `scripts/cdp/final-verify.mjs`, `scripts/cdp/final-verify.test.mjs`, `scripts/cdp/verify.mjs`, `scripts/cdp/scenarios.mjs`, `AGENTS.md`, `docs/open-issues.md`

**Interfaces:**
- Consumes: `task dev:browser` and its inputs `ARC_BROWSER_CDP_PORT`, `ARC_BROWSER_VITE_PORT`, `ARC_DEV_DATA_DIR`; its last stdout line on failure (Task 2); `window.__ARC_BROWSER_SHIM__` (Task 1).
- Produces: `finalMode(platform, env): "tauri" | "browser"`, `hostOnlyScenarios(scenarios, names): string[]`, `lastLine(path): string` (exported from `final-verify.mjs`); the scenario field `host: true`; env `ARC_FINAL_BROWSER` (`1` or `0`) to pick a mode by hand.

- [ ] **Step 1: Write the failing tests**

In `scripts/cdp/final-verify.test.mjs`, add `finalMode`, `hostOnlyScenarios` and `lastLine` to the import from `./final-verify.mjs`, and add `import { SCENARIOS } from "./scenarios.mjs";`.

Pin the existing WebView2 test to its mode: in `it("starts the dev app on its own vite port, target dir, store and no global install", …)`, add `ARC_FINAL_BROWSER: "0",` to the env passed to `run(...)`.

Add at the end of the `describe("final-verify.mjs", …)` block:

```js
    it("in browser mode starts dev:browser's stand-in on its own CDP and vite ports and store, with no tauri config", async () => {
        dir = mkdtempSync(join(tmpdir(), "final-verify-"));
        const out = join(dir, "out");
        const envFile = join(dir, "env.json");
        const fakeDev = join(dir, "fake-dev.cjs");
        writeFileSync(fakeDev, `require("fs").writeFileSync(${JSON.stringify(envFile)}, JSON.stringify(process.env));\n`);
        const vitePort = await freePort();
        const r = await run({
            ...process.env,
            LOCALAPPDATA: join(dir, "localappdata"),
            ARC_FINAL_OUT: out,
            ARC_FINAL_BOOT_MS: "3000",
            ARC_FINAL_DEV_CMD: `node "${fakeDev}"`,
            ARC_FINAL_VITE_PORT: String(vitePort),
            ARC_FINAL_BROWSER: "1",
        });
        expect(r.code).toBe(EXIT_UNVERIFIED);
        const env = JSON.parse(readFileSync(envFile, "utf8"));
        expect(Number(env.ARC_BROWSER_CDP_PORT)).toBeGreaterThan(0);
        expect(Number(env.ARC_BROWSER_VITE_PORT)).toBeGreaterThanOrEqual(vitePort);
        expect(dirname(env.ARC_DEV_DATA_DIR)).toBe(join(dir, "localappdata", "arc-final", "stores"));
        expect(env.ARC_DEV_NO_GLOBAL_INSTALL).toBe("1");
        expect(env.WEBVIEW2_USER_DATA_FOLDER).toBeUndefined();
        expect(existsSync(join(out, "tauri.final.json"))).toBe(false);
    });

    it("ends with the dev app's own last line when it exits before answering", async () => {
        dir = mkdtempSync(join(tmpdir(), "final-verify-"));
        const fakeDev = join(dir, "fake-dev.cjs");
        writeFileSync(fakeDev, `console.log("starting");\nconsole.log("no Chrome found: install Google Chrome or set CHROME_PATH");\nprocess.exit(1);\n`);
        const r = await run({
            ...process.env,
            LOCALAPPDATA: join(dir, "localappdata"),
            ARC_FINAL_OUT: join(dir, "out"),
            ARC_FINAL_BOOT_MS: "3000",
            ARC_FINAL_DEV_CMD: `node "${fakeDev}"`,
            ARC_FINAL_VITE_PORT: String(await freePort()),
            ARC_FINAL_BROWSER: "1",
        });
        expect(r.code).toBe(EXIT_UNVERIFIED);
        expect(r.last).toMatch(/^dev app exited with code 1 before answering on :\d+: no Chrome found: install Google Chrome or set CHROME_PATH$/);
    });
```

Add new top-level blocks:

```js
describe("finalMode", () => {
    it("runs WebView2 on windows and the browser app elsewhere, unless ARC_FINAL_BROWSER says", () => {
        expect(finalMode("win32", {})).toBe("tauri");
        expect(finalMode("darwin", {})).toBe("browser");
        expect(finalMode("linux", {})).toBe("browser");
        expect(finalMode("darwin", { ARC_FINAL_BROWSER: "0" })).toBe("tauri");
        expect(finalMode("win32", { ARC_FINAL_BROWSER: "1" })).toBe("browser");
    });
});

describe("hostOnlyScenarios", () => {
    const list = [{ name: "a" }, { name: "b", host: true }, { name: "c", host: true }];
    it("names the chosen scenarios that need the Tauri host, every one when none is chosen", () => {
        expect(hostOnlyScenarios(list, ["a", "b"])).toEqual(["b"]);
        expect(hostOnlyScenarios(list, [])).toEqual(["b", "c"]);
        expect(hostOnlyScenarios(list, ["a"])).toEqual([]);
    });
    it("marks notify-toast, which drives the host's IPC itself", () => {
        expect(hostOnlyScenarios(SCENARIOS, ["notify-toast", "surface-smoke"])).toEqual(["notify-toast"]);
    });
});

describe("lastLine", () => {
    it("is the last non-empty line, or empty when the file is missing", () => {
        const d = mkdtempSync(join(tmpdir(), "last-line-"));
        try {
            writeFileSync(join(d, "log"), "one\r\ntwo\n\n");
            expect(lastLine(join(d, "log"))).toBe("two");
            expect(lastLine(join(d, "missing"))).toBe("");
        } finally {
            rmSync(d, { recursive: true, force: true });
        }
    });
});
```

(`freePort`, `run`, `dirname` and the fs helpers are already in the test file.)

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run scripts/cdp/final-verify.test.mjs`
Expected: FAIL: `finalMode` is not exported (the import fails, so every test in the file fails).

- [ ] **Step 3: Add the mode and the helpers to `final-verify.mjs`**

Update the header comment's first paragraph to say: on windows it starts the Tauri dev app (CDP through WebView2); elsewhere `task dev:browser`, the cockpit in headless Chrome (`scripts/cdp/browser-app.mjs`), since macOS's WKWebView answers no CDP; `ARC_FINAL_BROWSER` (1 or 0) picks one by hand. Then add, after `export function unverified(reason)`:

```js
// windows starts the Tauri dev app, whose WebView2 answers CDP; elsewhere the browser app, since macOS's WKWebView
// answers none. ARC_FINAL_BROWSER (1 or 0) picks one by hand
export function finalMode(platform = process.platform, env = process.env) {
    if (env.ARC_FINAL_BROWSER === "1") return "browser";
    if (env.ARC_FINAL_BROWSER === "0") return "tauri";
    return platform === "win32" ? "tauri" : "browser";
}

// the chosen scenarios (every one when none is named) that drive the Tauri host itself, which the browser app has not
export function hostOnlyScenarios(scenarios, names) {
    return scenarios.filter((s) => s.host && (names.length === 0 || names.includes(s.name))).map((s) => s.name);
}

// the dev app's last log line, which says why it stopped
export function lastLine(path) {
    try {
        return readFileSync(path, "utf8").split(/\r?\n/).filter((l) => l.trim()).at(-1)?.trim() ?? "";
    } catch {
        return "";
    }
}
```

In `scripts/cdp/scenarios.mjs`, in the `notify-toast` scenario object (its `name: "notify-toast",` line), add after the name:

```js
    // it catches notify_os at Tauri's IPC fetch and emits through __TAURI_INTERNALS__: the browser app has neither
    host: true,
```

- [ ] **Step 4: Branch `main()` on the mode**

Replace the part of `main()` from `const configPath = join(out, "tauri.final.json");` through the `spawn(devCmd, { … })` call with:

```js
    const mode = finalMode();
    mkdirSync(out, { recursive: true });
    unlinkBuildJunctions(process.cwd());
    const store = storeDir(out);
    sweepStaleStores(STORES_DIR);
    const port = await pickPort();

    let devCmd;
    let devEnv;
    if (mode === "browser") {
        devCmd = process.env.ARC_FINAL_DEV_CMD || "task dev:browser";
        devEnv = { ARC_BROWSER_CDP_PORT: String(port), ARC_BROWSER_VITE_PORT: String(vitePort) };
    } else {
        const configPath = join(out, "tauri.final.json");
        writeFileSync(configPath, JSON.stringify(tauriConfig(vitePort), null, 2));
        devCmd = process.env.ARC_FINAL_DEV_CMD || `task dev -- --config "${configPath}"`;
        const profile = join(out, "webview2-profile");
        mkdirSync(profile, { recursive: true });
        devEnv = {
            WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
            WEBVIEW2_USER_DATA_FOLDER: profile,
            CARGO_TARGET_DIR: FINAL_TARGET_DIR,
        };
    }
    // the dev app's output goes to a file so the last stdout line stays ours for the engine to read
    const logPath = join(out, "dev-app.log");
    const log = openSync(logPath, "a");
    console.log(`starting \`${devCmd}\` (${mode}) on :${port}, vite :${vitePort} (log: ${logPath})`);

    // stdin stays an open pipe: `task dev` exits when its stdin closes
    const dev = spawn(devCmd, {
        shell: true,
        cwd: process.cwd(),
        detached: process.platform !== "win32",
        stdio: ["pipe", log, log],
        env: {
            ...process.env,
            ...devEnv,
            // read by a debug build of the dev host (src-tauri/src/paths.rs), by sync:piartifacts and by browser-app.mjs
            ARC_DEV_DATA_DIR: store,
            ARC_DEV_NO_GLOBAL_INSTALL: "1",
        },
    });
```

Keep the existing `mkdirSync(out, …)` from being called twice: delete the old one above `configPath`. Leave the lock, `vitePort` and everything after `spawn` as they are, except the two changes below.

In the `try` block, make the exit reason carry the dev app's last line:

```js
        if (!(await waitForCdp(port, dev, bootMs))) {
            const said = lastLine(logPath);
            reason =
                (dev.exitCode === null
                    ? `dev app did not answer on :${port}`
                    : `dev app exited with code ${dev.exitCode} before answering on :${port}`) + (said ? `: ${said}` : "");
        } else {
```

and after `code = await runVerify(port, scenarios);` (still inside that `else`), add:

```js
            if (mode === "browser" && code === 0) {
                const { SCENARIOS } = await import("./scenarios.mjs");
                const hostOnly = hostOnlyScenarios(SCENARIOS, scenarios);
                if (hostOnly.length) {
                    reason = `${hostOnly.join(", ")} need the Tauri host, which the browser app on ${process.platform} has not: run them on Windows`;
                }
            }
```

(`reason` set after a pass is reported through the existing `if (reason) unverified(reason);` after the `finally`.)

- [ ] **Step 5: Run the final-verify tests to see them pass**

Run: `npx vitest run scripts/cdp/final-verify.test.mjs`
Expected: PASS, including the existing ones.

- [ ] **Step 6: Teach verify.mjs about the browser app**

In `scripts/cdp/verify.mjs`, after the `localStorage.setItem('jarvis.tour.offered', 'true')` line, add:

```js
// the browser app (scripts/cdp/browser-app.mjs) has no Tauri host: a scenario marked host: true is skipped there. Its
// headless Chrome has no focused window either, where the dev app's has, so focus is emulated, and re-emulated after
// each scenario since one may end it (agent-grid does)
const inBrowser = await h.ev("!!window.__ARC_BROWSER_SHIM__").catch(() => false);
const emulateFocus = () => (inBrowser ? h.cdp("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {}) : undefined);
if (inBrowser) console.log("attached to the browser app: scenarios that need the Tauri host are skipped");
await emulateFocus();
```

At the top of the `for (const scenario of chosen)` loop body, before `const firstShot`, add:

```js
    if (inBrowser && scenario.host) {
        results.push({ name: scenario.name, steps: [{ step: "needs the Tauri host, which the browser app has not: run it on Windows", ok: false, skip: true }] });
        shotsByScenario[scenario.name] = [];
        continue;
    }
```

and in the loop's `finally`, after the `Emulation.setDeviceMetricsOverride` restore, add `await emulateFocus();`.

- [ ] **Step 7: Run the browser app live and check the cockpit renders**

First drop this worktree's `dist/bin` and `src-tauri/target` links, so the build below writes here and not into the main checkout through them: `node -e "import('./scripts/cdp/final-verify.mjs').then(m => m.unlinkBuildJunctions(process.cwd()))"`.
Run in the background: `task dev:browser` (first run builds the backend; allow 10 minutes), and wait for its line `browser app ready: http://localhost:5180/ (CDP :9222, …)`. Note its PID.
Then: `node scripts/cdp-shot.mjs "$(mktemp -d)/arc-browser.png" 9222` and look at the PNG.
Expected: the cockpit with the nav rail and app bar, no `BOOT ERROR`. If it shows one, read the console with a CDP `Runtime.evaluate` of `document.body.innerText` and fix the cause in Task 1's or Task 2's files (this task may edit them, since it runs after both).

- [ ] **Step 8: Run scenarios against it**

Run: `node scripts/cdp/verify.mjs agent-grid surface-smoke`
Expected: `attached to the browser app …`, both PASS (skips allowed where the scenario already skips for its own reasons). `surface-smoke` running after `agent-grid` proves focus is re-emulated.

Run: `node scripts/cdp/verify.mjs notify-toast float-mini canvas-swap agent-uploads`
Expected: `notify-toast` SKIP with "needs the Tauri host". For each other one that fails: if its failing step's detail comes from a Tauri-only path (a stand-in returning a no-op the step asserts on, a native window move or capture), mark it `host: true` with a one-line comment naming that path, as in Step 6; if it fails for any other reason, it is an app or harness bug: fix it, or report it in the task's summary. Never mark a scenario `host: true` to hide a failure the Windows dev app would also show.

Stop the browser app by its PID (`kill <pid>`), never by name.

- [ ] **Step 9: Run Final end to end**

Run: `ARC_FINAL_OUT=$(mktemp -d) node scripts/cdp/final-verify.mjs surface-smoke; echo "exit $?"`
Expected: `exit 0`, and `$ARC_FINAL_OUT/cdp-shots/` holds the surface-smoke shots.
Run: `ARC_FINAL_OUT=$(mktemp -d) node scripts/cdp/final-verify.mjs surface-smoke notify-toast; echo "exit $?"`
Expected: `exit 3`, last line `notify-toast need the Tauri host, which the browser app on darwin has not: run them on Windows`.

- [ ] **Step 10: Update the docs**

In `AGENTS.md`, "Plans the engine runs" paragraph: replace the sentences from "A plan run on a Mac keeps a Final but guards it:" through "which still runs the scenarios on Windows." with:

> On a Mac the same Final runs the scenarios in headless Chrome: WKWebView answers no CDP, so `final-verify.mjs` starts `task dev:browser` (`scripts/cdp/browser-app.mjs`), a browser build of the cockpit with Tauri's modules swapped for the stand-ins in `frontend/tauri/browsershim/`. A scenario marked `host: true` drives the Tauri host itself and is skipped there, which ends that Final unverified; WebKit-only behaviour stays a hand check. Don't add a `uname -s` guard to a Final.

In `AGENTS.md`, "Visual verification (dev)": add a bullet after **Capture:**:

> - **On a Mac:** WKWebView answers no CDP. `task dev:browser` runs the cockpit in headless Chrome on CDP `:9222` (vite `:5180`; `-- --headed` to watch) with its own store (`~/Library/Application Support/dev.arc.app-browser`), then `task verify:ui -- <name>` as usual. It is Chromium, like WebView2, not WebKit, and has no Tauri host: a WebKit-only bug, or a scenario marked `host: true`, needs the real app.

In `docs/open-issues.md`, add a row to the table whose header is `| Item | Kind | Effort | Source / notes |`, in that table's style:

> `| (arcterm) Final on a Mac checks Chromium, not WKWebView: \`task dev:browser\` runs the scenarios in headless Chrome, so WebKit-only behaviour (the File tab Source view's Ctrl+Enter, IME, scrolling) and the scenarios marked \`host: true\` (notify-toast, plus each one Step 8 marked, by name) still need a hand check in the real app or a Windows run | verification gap | S | \`docs/superpowers/plans/2026-10-12-browser-cdp-harness.md\` |`

- [ ] **Step 11: Run the whole frontend suite**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add scripts/cdp/final-verify.mjs scripts/cdp/final-verify.test.mjs scripts/cdp/verify.mjs scripts/cdp/scenarios.mjs AGENTS.md docs/open-issues.md
git commit -m "feat(cdp): Final runs the scenarios in headless Chrome off Windows; a host-only scenario makes it unverified"
```
