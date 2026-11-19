// Browser stand-in for @tauri-apps/api/core (vite.browser.config.ts aliases it): answers the commands the frontend
// invokes the way the Tauri host would for a plain page, so the cockpit boots in Chrome for the CDP scenarios.
import type { InitData } from "../api";
import { emit } from "./event";

// written by vite.browser.config.ts's define from browserconfig.ts browserInit
declare const __ARC_BROWSER_INIT__: Omit<InitData, "wsEndpoint" | "webEndpoint"> | undefined;

// scripts/cdp/verify.mjs reads it to skip the scenarios that drive the Tauri host
(globalThis as any).__ARC_BROWSER_SHIM__ = true;

const NO_OPS = [
    "fe_log",
    "open_external",
    "reveal_path", // a page has no file manager to open
    "open_path", // nor a default app to hand a document to
    "notify_os",
    "hold_window_frame",
    "cloak_window", // a page has no native window to hide while its frame changes
    "redirect_minimize",
    "set_folded_chrome",
    "raise_topmost", // a page has no window to lift above another app; floatstore.ts only logs the answer
    "cloak_window", // a page has no window to hide while Float changes its frame
    "tray_popover_size", // the browser app has no tray
    "set_tray_status",
];
export const BROWSER_COMMANDS: readonly string[] = [
    "get_init",
    "set_window_init_status",
    "app_foreground",
    "capture_webview",
    "open_sidecar",
    "sidecar_form",
    "sidecar_pids",
    "sidecar_corner",
    "app_frame_action",
    "clipboard_text",
    ...NO_OPS,
];

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
            if (args?.status === "ready")
                await emit("wave-init", { tabId: "", clientId: "", windowId: "", activate: true });
            return undefined as T;
        case "app_foreground":
            return "ours" as T;
        case "capture_webview":
            throw new Error("window capture needs the Tauri host");
        case "open_sidecar":
            // Open Sidecar's toast shows this: a page has no second window to open
            throw new Error("Sidecar is a window of the Tauri host");
        case "sidecar_form":
            // the S and pin buttons shrink and pin a native window: the Sidecar page logs this and leaves its state as it was
            throw new Error("Sidecar is a window of the Tauri host");
        case "sidecar_pids":
            // no WebView2 to ask which process draws the page: the resource panel's Sidecar row reads "—"
            return [] as T;
        case "sidecar_corner":
            // no native window to read a corner from (the host answers null too when it cannot): the Sidecar page keeps its default radius
            return null as T;
        case "app_frame_action":
            return false as T; // a page cannot reach into a cross-origin frame: Home and the window's history stand in
        case "clipboard_text":
            // a page reads the clipboard only behind a prompt, so nothing is ever copied; a scenario stands in for a copy
            // with window.__arcClipboardStub (translatestore.ts)
            return { change: 0, text: null, blocked: false } as T;

        case "fe_log":
            console.log(`[fe-log] ${String(args?.msg)}`);
            return undefined as T;
    }
    if (NO_OPS.includes(cmd)) return undefined as T;
    throw new Error(`the browser app answers no Tauri command ${cmd}`);
}
