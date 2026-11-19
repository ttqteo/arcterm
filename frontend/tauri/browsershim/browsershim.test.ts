import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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

// every .ts/.tsx under frontend/ but tests, built output and the stand-ins themselves, read once for the file in the
// beforeAll below: ~1,300 files, 80 ms warm but 4 s cold on an idle machine, and an engine Verify reads them cold
// (a fresh worktree) beside the full suite, where the walk and the stand-ins' imports passed a case's 30 s
let read: { path: string; text: string }[] | undefined;
function sources(): { path: string; text: string }[] {
    read ??= readdirSync(FRONTEND, { recursive: true, encoding: "utf8" })
        .filter(
            (p) =>
                /\.tsx?$/.test(p) &&
                !/\.test\.tsx?$/.test(p) &&
                !/(^|[\\/])(dist|node_modules|browsershim)[\\/]/.test(p)
        )
        .map((p) => ({ path: p, text: readFileSync(join(FRONTEND, p), "utf8") }));
    return read;
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
        for (const m of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*"(@tauri-apps\/[^"]+)"/g))
            add(m[2], m[1], /\s+as\s+/);
        for (const m of text.matchAll(/const\s*\{([^}]*)\}\s*=\s*await\s+import\("(@tauri-apps\/[^"]+)"\)/g))
            add(m[2], m[1], /:/);
    }
    return found;
}

describe("the stand-ins cover what the frontend uses", () => {
    // the cold walk and the stand-ins' first imports are paid here, so no case's timeout depends on machine load
    const shims: Record<string, Record<string, unknown>> = {};
    beforeAll(async () => {
        sources();
        for (const [file, load] of Object.entries(SHIM_MODULES)) shims[file] = await load();
    }, 120000);

    it("shims every Tauri module the frontend imports, and exports every name it takes", () => {
        const found = tauriImports();
        expect(found.size).toBeGreaterThan(0);
        for (const [mod, names] of found) {
            expect(Object.keys(SHIMMED), `${mod} has no stand-in in browserconfig.ts SHIMMED`).toContain(mod);
            const shim = shims[SHIMMED[mod]];
            expect(
                shim,
                `browserconfig.ts SHIMMED names ${SHIMMED[mod]}, which SHIM_MODULES does not load`
            ).toBeDefined();
            for (const name of names) expect(shim[name], `${mod} stand-in lacks ${name}`).toBeDefined();
        }
    });

    it("answers every Tauri command the frontend invokes", async () => {
        const { BROWSER_COMMANDS } = await import("./core");
        const invoked = new Set<string>();
        for (const { text } of sources())
            for (const m of text.matchAll(/invoke(?:<[^>]*>)?\("([a-z_]+)"/g)) invoked.add(m[1]);
        expect(invoked.size).toBeGreaterThan(0);
        for (const cmd of invoked) expect(BROWSER_COMMANDS, `core.ts answers no ${cmd}`).toContain(cmd);
    });
});

describe("core stand-in", () => {
    beforeEach(() => {
        vi.stubGlobal("location", { host: "localhost:5180" });
        vi.stubGlobal("__ARC_BROWSER_INIT__", {
            authKey: "k",
            appVersion: "1",
            version: "1",
            buildTime: 0,
            platform: "darwin",
            isDev: true,
            userName: "u",
            hostName: "h",
        });
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

    it("refuses the Sidecar window's commands: a page has no second window to open, shrink or pin", async () => {
        const { invoke } = await import("./core");
        await expect(invoke("open_sidecar")).rejects.toThrow(/Tauri host/);
        await expect(invoke("sidecar_form", { change: null })).rejects.toThrow(/Tauri host/);
        await expect(invoke("sidecar_form", { change: { small: true } })).rejects.toThrow(/Tauri host/);
    });

    it("answers null for the Sidecar window's corner: a page has no native window to read it from", async () => {
        const { invoke } = await import("./core");
        expect(await invoke("sidecar_corner")).toBeNull();
    });
});

describe("window stand-in", () => {
    beforeEach(() => {
        vi.stubGlobal("window", {
            innerWidth: 800,
            innerHeight: 600,
            devicePixelRatio: 2,
            screen: { width: 1440, height: 900 },
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        });
        vi.stubGlobal("document", { hasFocus: () => true });
    });
    afterEach(() => vi.unstubAllGlobals());

    // every method the frontend calls on getCurrentWindow() (app-bar, chrome, floatstore, miniclickthrough, sprout-mini, dockbadgesync)
    const METHODS = [
        "close",
        "innerPosition",
        "innerSize",
        "isFocused",
        "isFullscreen",
        "isMaximized",
        "isMinimized",
        "isVisible",
        "maximize",
        "minimize",
        "onFocusChanged",
        "onMoved",
        "onResized",
        "outerPosition",
        "outerSize",
        "scaleFactor",
        "setAlwaysOnTop",
        "setBadgeCount",
        "setFullscreen",
        "setIgnoreCursorEvents",
        "setMinSize",
        "setPosition",
        "setShadow",
        "setSize",
        "startDragging",
        "toggleMaximize",
        "unmaximize",
        "unminimize",
    ];

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
