// This repo's **Final:** command. The engine runs it in the final tree with ARC_FINAL_OUT set: it starts a dev
// app from that tree, runs verify.mjs against it, and copies the shots and contact sheet into ARC_FINAL_OUT, with a
// shots.json manifest at its top.
// A dev app from the main checkout is usually running, so this one shares nothing it uses: its own CDP and Vite
// ports, WebView2 profile, store, cargo target dir and dist/bin, and it installs no global agent hooks or skills.
// Exit 0 passes, verify.mjs's nonzero code fails, and EXIT_UNVERIFIED with the reason as the last stdout line means
// the UI could not be checked at all.
//
//   ARC_FINAL_OUT=<dir> node scripts/cdp/final-verify.mjs [scenario...]
//
// ARC_FINAL_DEV_CMD (default `task dev` with the port override), ARC_FINAL_BOOT_MS (default 10 min, a cold cargo
// build), ARC_FINAL_VITE_PORT (the first port tried) and ARC_FINAL_LOCK_WAIT_MS (default 10 min) exist so the test
// can drive the boot path without a real app. The lock wait is for a free build slot.
//
// BUILD_SLOTS final stages run at once, each holding one slot: a slot is a cargo target dir, and `cargo tauri dev`
// runs the exe it builds there, so a second stage building into it would overwrite the exe the first is running.
//
// The user's packaged Arc shares the dev app's image names, so only the PID this script spawned is ever killed.
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { connect, createServer } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const EXIT_UNVERIFIED = 3;

const DEFAULT_PORT = 9230;
const PORT_SCAN = 100;
const DEFAULT_BOOT_MS = 600_000;
const POLL_MS = 1_000;
const PROBE_TIMEOUT_MS = 2_000;
// frontend/tauri/vite.config.ts pins the main dev app's vite here; the final one starts past it, so a dev app
// started while this one runs still gets its port
const FIRST_VITE_PORT = 5175;
// the dirs worktree:prepare junctions into the main checkout that a build writes to. node_modules is left: npm
// install replaces its junction with a real dir without touching the main checkout's
const BUILD_JUNCTIONS = ["dist/bin", "src-tauri/target"];
const FINAL_BASE = join(process.env.LOCALAPPDATA || join(homedir(), ".cache"), "arc-final");
// each slot is a target dir outside any checkout that pays one cold cargo build and then stays warm (~4.5 GB each)
export const BUILD_SLOTS = 3;
// keeps the port scans of stages on different slots apart: they pick ports long before anything binds them
const SLOT_PORT_STRIDE = 20;
const STORE_ID_LEN = 8;
// a store's files can stay held for seconds after its dev app is killed; up to 10s before leaving it to the sweep
const STORE_DROP_RETRIES = 20;
const STORE_DROP_RETRY_MS = 500;

// slot 0 keeps the names a checkout's older copy of this script uses, so that copy and this one still exclude each
// other there
function slotPath(name, slot) {
    return join(FINAL_BASE, slot ? `${name}-${slot}` : name);
}
// where verify.mjs writes its shots, contact sheet and shots.json, relative to the tree it runs in
const SHOTS_DIR = "cdp-shots";
// with the 10 min boot and the verify run, a stage that waited this long still ends inside the engine's 30 min
// FinalTimeout (pkg/orchestrate/final.go)
const DEFAULT_LOCK_WAIT_MS = 600_000;

// the dev app's store. wavesrv binds <store>/data/wave.sock and windows caps a unix socket path at 108 bytes, which
// a store under ARC_FINAL_OUT (itself under %TEMP%) can pass, so it lives under a short path keyed by the out dir
function storeDir(out, slot) {
    return join(slotPath("stores", slot), createHash("sha1").update(out).digest("hex").slice(0, STORE_ID_LEN));
}

// keeps the dev app's log for whoever reads the result, then drops the throwaway store
function dropStore(store, out) {
    // runs in a finally, so a failure here is reported and must not replace the result
    try {
        const log = join(store, "data", "waveapp.log");
        if (existsSync(log)) cpSync(log, join(out, "waveapp.log"));
    } catch (e) {
        console.log(`could not keep the dev app's log from ${store}: ${e.message}`);
    }
    try {
        rmSync(store, { recursive: true, force: true, maxRetries: STORE_DROP_RETRIES, retryDelay: STORE_DROP_RETRY_MS });
    } catch (e) {
        // workers reported the old "could not drop" line as a defect in six runs (09-18..10-12); the sweep makes it harmless
        console.log(`the dev app's store ${store} is still held by a file handle; the next final stage on this slot drops it (${e.code ?? e.message})`);
    }
}

// drops every store under dir, a slot's stores. Called holding that slot, when no other stage is running on it, so each
// one is a stage's that was killed before its finally ran or whose drop hit a file its dev app still held. Best-effort,
// like dropStore.
export function sweepStaleStores(dir) {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
        try {
            rmSync(join(dir, name), { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
        } catch (e) {
            console.log(`could not drop the stale dev app store ${name}: ${e.message}`);
        }
    }
}

// the os drops a pipe or socket with its process, so a killed stage leaves no stale lock on windows. keyed by the
// base, which is what the stages share
export function buildLockPath(base, slot = 0) {
    const id = createHash("sha1").update(base).digest("hex").slice(0, STORE_ID_LEN) + (slot ? `-${slot}` : "");
    return process.platform === "win32" ? `\\\\.\\pipe\\arc-final-build-${id}` : join(base, `build-${id}.sock`);
}

function listenOn(path) {
    return new Promise((resolve, reject) => {
        const srv = createServer();
        srv.once("error", (e) => (e.code === "EADDRINUSE" ? resolve(null) : reject(e)));
        srv.listen(path, () => resolve(srv));
    });
}

// a posix socket file outlives a killed stage; one nothing answers on is dropped
async function dropStaleSocket(path) {
    if (process.platform === "win32") return;
    const live = await new Promise((resolve) => {
        const sock = connect(path);
        sock.once("connect", () => {
            sock.destroy();
            resolve(true);
        });
        sock.once("error", () => resolve(false));
    });
    if (!live) rmSync(path, { force: true });
}

// resolves the first free slot and its held lock (close it to release), or null when other stages kept every slot
// past waitMs
export async function acquireBuildSlot(base, waitMs, slots = BUILD_SLOTS) {
    const deadline = Date.now() + waitMs;
    for (let waited = false; ; waited = true) {
        for (let slot = 0; slot < slots; slot++) {
            const path = buildLockPath(base, slot);
            const lock = await listenOn(path);
            if (lock) return { slot, lock };
            await dropStaleSocket(path);
        }
        if (Date.now() >= deadline) return null;
        if (!waited) console.log("waiting for another final stage to finish with a build slot");
        await new Promise((r) => setTimeout(r, POLL_MS));
    }
}

export function unverified(reason) {
    console.log(reason);
    process.exit(EXIT_UNVERIFIED);
}

function isFree(port) {
    return new Promise((resolve) => {
        const srv = createServer();
        srv.once("error", () => resolve(false));
        srv.listen(port, "127.0.0.1", () => srv.close(() => resolve(true)));
    });
}

export async function pickPort(start = DEFAULT_PORT) {
    for (let port = start; port < start + PORT_SCAN; port++) {
        if (await isFree(port)) return port;
    }
    throw new Error(`no free port in ${start}-${start + PORT_SCAN - 1}`);
}

function accepts(host, port) {
    return new Promise((resolve) => {
        const sock = connect({ host, port, timeout: PROBE_TIMEOUT_MS });
        const done = (ok) => {
            sock.destroy();
            resolve(ok);
        };
        sock.once("connect", () => done(true));
        sock.once("error", () => done(false));
        sock.once("timeout", () => done(false));
    });
}

// vite listens on ::1 only on windows, so a bind probe on 127.0.0.1 would call the port free
export async function inUse(port) {
    const hits = await Promise.all(["127.0.0.1", "::1"].map((host) => accepts(host, port)));
    return hits.some(Boolean);
}

function killTree(pid) {
    try {
        if (process.platform === "win32") {
            execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
        } else {
            process.kill(-pid, "SIGKILL");
        }
    } catch {
        // already gone
    }
}

async function answers(port) {
    try {
        const res = await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
        return res.ok;
    } catch {
        return false;
    }
}

// a vite port nothing listens on, on either stack: vite on windows binds ::1 alone
export async function pickVitePort(start = FIRST_VITE_PORT) {
    for (let port = start; port < start + PORT_SCAN; port++) {
        if ((await isFree(port)) && !(await inUse(port))) return port;
    }
    throw new Error(`no free vite port in ${start}-${start + PORT_SCAN - 1}`);
}

function isLink(p) {
    try {
        return lstatSync(p).isSymbolicLink();
    } catch {
        return false;
    }
}

// removes the links alone, never what they point at: a build here must not write into the main checkout, where
// a running dev app uses the binaries
export function unlinkBuildJunctions(root) {
    for (const rel of BUILD_JUNCTIONS) {
        const p = join(root, rel);
        if (!isLink(p)) continue;
        if (process.platform === "win32") rmdirSync(p);
        else unlinkSync(p);
    }
}

// merged over src-tauri/tauri.conf.json by `cargo tauri dev --config`, which pins vite to 5174
function tauriConfig(vitePort) {
    return {
        build: {
            devUrl: `http://localhost:${vitePort}`,
            beforeDevCommand: `npx vite --config frontend/tauri/vite.config.ts --port ${vitePort} --strictPort`,
        },
    };
}

// resolves true once CDP answers, false on timeout or when the dev app exits first
async function waitForCdp(port, dev, bootMs) {
    const deadline = Date.now() + bootMs;
    while (Date.now() < deadline && dev.exitCode === null) {
        if (await answers(port)) return true;
        await new Promise((r) => setTimeout(r, POLL_MS));
    }
    return false;
}

// verify.mjs's manifest lists files relative to cdp-shots/; the engine reads them relative to ARC_FINAL_OUT, where
// the copied dir keeps its name
export function finalManifest(manifest) {
    return manifest.map((entry) => ({ ...entry, files: entry.files.map((f) => `${SHOTS_DIR}/${f}`) }));
}

// writes nothing when verify.mjs never wrote its manifest: the engine then lists the pngs itself. A manifest that
// cannot be read is reported and left out the same way, so it never replaces verify's result
export function writeFinalManifest(shotsDir, out) {
    const src = join(shotsDir, "shots.json");
    if (!existsSync(src)) return;
    try {
        const manifest = JSON.parse(readFileSync(src, "utf8"));
        writeFileSync(join(out, "shots.json"), JSON.stringify(finalManifest(manifest), null, 2));
    } catch (e) {
        console.log(`could not write ${join(out, "shots.json")} from ${src}: ${e.message}`);
    }
}

function runVerify(port, scenarios) {
    const script = fileURLToPath(new URL("./verify.mjs", import.meta.url));
    return new Promise((resolve) => {
        const child = spawn(process.execPath, [script, ...scenarios], {
            stdio: "inherit",
            env: { ...process.env, CDP_PORT: String(port) },
        });
        child.on("exit", (code) => resolve(code ?? 1));
        child.on("error", () => resolve(1));
    });
}

async function main() {
    const out = process.env.ARC_FINAL_OUT;
    if (!out) unverified("ARC_FINAL_OUT is not set");
    const scenarios = process.argv.slice(2);
    const bootMs = Number(process.env.ARC_FINAL_BOOT_MS) || DEFAULT_BOOT_MS;
    const lockWaitMs = Number(process.env.ARC_FINAL_LOCK_WAIT_MS) || DEFAULT_LOCK_WAIT_MS;
    mkdirSync(FINAL_BASE, { recursive: true });
    const held = await acquireBuildSlot(FINAL_BASE, lockWaitMs);
    if (!held) unverified(`other final stages held every build slot for ${Math.round(lockWaitMs / 1000)}s`);
    const { slot, lock } = held;
    // two stages started together would otherwise pick the same free ports
    const portOffset = slot * SLOT_PORT_STRIDE;
    const vitePort = await pickVitePort((Number(process.env.ARC_FINAL_VITE_PORT) || FIRST_VITE_PORT) + portOffset);
    mkdirSync(out, { recursive: true });
    const configPath = join(out, "tauri.final.json");
    writeFileSync(configPath, JSON.stringify(tauriConfig(vitePort), null, 2));
    const devCmd = process.env.ARC_FINAL_DEV_CMD || `task dev -- --config "${configPath}"`;
    unlinkBuildJunctions(process.cwd());
    const store = storeDir(out, slot);
    sweepStaleStores(slotPath("stores", slot));

    const port = await pickPort(DEFAULT_PORT + portOffset);
    // inside the store, so it goes with it: nothing reads it after the run, and kept in ARC_FINAL_OUT it was ~76 MB
    // a round for the 30 days the engine keeps that dir
    const profile = join(store, "webview2-profile");
    mkdirSync(profile, { recursive: true });
    // the dev app's output goes to a file so the last stdout line stays ours for the engine to read
    const logPath = join(out, "dev-app.log");
    const log = openSync(logPath, "a");
    console.log(`starting \`${devCmd}\` on :${port}, vite :${vitePort} (log: ${logPath})`);

    // stdin stays an open pipe: `task dev` exits when its stdin closes
    const dev = spawn(devCmd, {
        shell: true,
        cwd: process.cwd(),
        detached: process.platform !== "win32",
        stdio: ["pipe", log, log],
        env: {
            ...process.env,
            WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
            WEBVIEW2_USER_DATA_FOLDER: profile,
            CARGO_TARGET_DIR: slotPath("target", slot),
            // read by a debug build of the dev host (src-tauri/src/paths.rs) and by sync:piartifacts
            ARC_DEV_DATA_DIR: store,
            ARC_DEV_NO_GLOBAL_INSTALL: "1",
        },
    });
    const stop = () => {
        killTree(dev.pid);
        lock.close();
    };
    for (const sig of ["SIGINT", "SIGTERM"]) {
        process.on(sig, () => {
            stop();
            process.exit(1);
        });
    }

    let code;
    let reason;
    try {
        if (!(await waitForCdp(port, dev, bootMs))) {
            reason =
                dev.exitCode === null
                    ? `dev app did not answer on :${port}`
                    : `dev app exited with code ${dev.exitCode} before answering on :${port}`;
        } else {
            code = await runVerify(port, scenarios);
            if (existsSync(SHOTS_DIR)) {
                cpSync(SHOTS_DIR, join(out, SHOTS_DIR), { recursive: true });
                writeFinalManifest(SHOTS_DIR, out);
            }
        }
    } finally {
        stop();
        dropStore(store, out);
    }
    if (reason) unverified(reason);
    process.exit(code);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((e) => unverified(`final-verify: ${e?.message ?? e}`));
}
