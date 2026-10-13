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

    it("keeps Chrome from downloading its background components into the profile", () => {
        const args = chromeArgs({ cdpPort: 9300, url: "u", profile: "p", headed: false });
        expect(args).toContain("--disable-component-update");
        expect(args).toContain("--disable-background-networking");
        expect(args.find((a) => a.startsWith("--disable-features="))).toContain("OptimizationGuideModelDownloading");
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

    it("says why when a part cannot be spawned, and stops the ones already running", async () => {
        dir = mkdtempSync(join(tmpdir(), "browser-app-"));
        // an existing path that is not an executable: findChrome accepts it, spawn fails
        const app = start({ ...(await env(fakes(dir))), CHROME_PATH: dir });
        expect(await app.exited).not.toBe(0);
        expect(app.out().trim().split("\n").at(-1)).toMatch(/^chrome could not start: /);
        for (const n of ["wavesrv", "vite"]) expect(await gone(Number(readFileSync(join(dir, `${n}.pid`), "utf8")), 5000)).toBe(true);
    }, 40_000);

    it("says how to get Chrome when none is found", async () => {
        dir = mkdtempSync(join(tmpdir(), "browser-app-"));
        const app = start({ ...(await env(fakes(dir))), CHROME_PATH: join(dir, "no-chrome") });
        expect(await app.exited).toBe(1);
        expect(app.out().trim().split("\n").at(-1)).toBe("no Chrome found: install Google Chrome or set CHROME_PATH");
    }, 20_000);
});
