// Browser stand-in for @tauri-apps/plugin-http (vite.browser.config.ts aliases it): the page's own fetch, since vite
// proxies wavesrv on the page's origin with the auth key (browserconfig.ts browserProxy).
export function fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    return globalThis.fetch(input, init);
}
