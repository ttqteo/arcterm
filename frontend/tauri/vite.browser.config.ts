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
