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
    "notify_os",
    "hold_window_frame",
    "redirect_minimize",
    "set_folded_chrome",
    "raise_topmost", // a page has no window to lift above another app; floatstore.ts only logs the answer
    "tray_popover_size", // the browser app has no tray
    "set_tray_status",
];
export const BROWSER_COMMANDS: readonly string[] = [
    "get_init",
    "set_window_init_status",
    "app_foreground",
    "capture_webview",
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
        case "fe_log":
            console.log(`[fe-log] ${String(args?.msg)}`);
            return undefined as T;
    }
    if (NO_OPS.includes(cmd)) return undefined as T;
    throw new Error(`the browser app answers no Tauri command ${cmd}`);
}
