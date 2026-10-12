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
        for (const path of [
            "/wave/service?service=client",
            "/wave/stream-file?path=x",
            "/canvas/tok/index.html",
            "/html-preview/tok/a.html",
            "/schema/settings.json",
        ]) {
            const key = proxiedBy(proxy, path);
            expect(key, path).toBeDefined();
            expect(proxy[key!].target).toBe("http://127.0.0.1:61270");
            expect(proxy[key!].headers).toEqual({ "X-AuthKey": "key-1" });
        }
    });

    it("sends the websocket to wavesrv's ws port", () => {
        const key = proxiedBy(proxy, "/ws?stableid=abc");
        expect(key).toBeDefined();
        expect(proxy[key!]).toMatchObject({
            target: "ws://127.0.0.1:61269",
            ws: true,
            headers: { "X-AuthKey": "key-1" },
        });
    });

    it("leaves vite's own paths that only start like a wavesrv route", () => {
        for (const path of [
            "/wave-logo.png",
            "/wsh.svg",
            "/waveform/x.js",
            "/",
            "/@vite/client",
            "/fontawesome/css/all.css",
        ]) {
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
        expect(init).toMatchObject({
            authKey: "key-1",
            version: "0.15.10",
            appVersion: "0.15.11",
            buildTime: 1719240000,
            isDev: true,
            platform: process.platform,
        });
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
