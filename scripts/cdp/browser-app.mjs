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
        let child;
        try {
            child = spawn(cmd, argv, opts);
        } catch (e) {
            // spawn throws instead of emitting 'error' for a file the os cannot run (a wrong format or arch)
            stop(`${name} could not start: ${e.message}`);
            return null;
        }
        children.push(child);
        // a part that is missing or not executable emits 'error' and no reliable 'exit'
        child.on("error", (e) => stop(`${name} could not start: ${e.message}`));
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
