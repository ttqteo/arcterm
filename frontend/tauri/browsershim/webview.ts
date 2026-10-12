// Browser stand-in for @tauri-apps/api/webview (vite.browser.config.ts aliases it): zoom is the native webview's,
// so it is a no-op here.
import type { Webview } from "@tauri-apps/api/webview";

const current = { label: "main", setZoom: async () => {} };

export function getCurrentWebview(): Webview {
    return current as unknown as Webview;
}
