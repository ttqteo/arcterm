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
    return Object.entries(SHIMMED).map(([mod, file]) => ({
        find: new RegExp(`^${escapeRe(mod)}$`),
        replacement: resolve(shimDir, file),
    }));
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
