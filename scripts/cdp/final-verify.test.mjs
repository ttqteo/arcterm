import { execFile, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
    EXIT_UNVERIFIED,
    acquireBuildLock,
    buildLockPath,
    finalManifest,
    inUse,
    pickPort,
    pickVitePort,
    sweepStaleStores,
    unlinkBuildJunctions,
    writeFinalManifest,
} from "./final-verify.mjs";

const SCRIPT = fileURLToPath(new URL("./final-verify.mjs", import.meta.url));

function listen(port, host = "127.0.0.1") {
    return new Promise((resolve, reject) => {
        const srv = createServer();
        srv.once("error", reject);
        srv.listen(port, host, () => resolve(srv));
    });
}

async function freePort() {
    const probe = await listen(0);
    const port = probe.address().port;
    await close(probe);
    return port;
}

const close = (srv) => new Promise((r) => srv.close(r));

// spawn the real CLI: the engine only sees the exit code and the last stdout line
function run(env) {
    return new Promise((resolve) => {
        execFile(process.execPath, [SCRIPT], { env, timeout: 30_000 }, (err, stdout) => {
            const lines = stdout.trim().split(/\r?\n/);
            resolve({ code: err ? err.code : 0, killed: Boolean(err?.killed), last: lines[lines.length - 1] });
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

// a killed process stays signalable until its parent reaps it, so give it a moment to go
async function gone(pid, ms) {
    const deadline = Date.now() + ms;
    while (alive(pid)) {
        if (Date.now() >= deadline) return false;
        await new Promise((r) => setTimeout(r, 50));
    }
    return true;
}

describe("pickPort", () => {
    it("skips a port another process holds", async () => {
        const held = await listen(0);
        const port = held.address().port;
        try {
            expect(await pickPort(port)).toBeGreaterThan(port);
        } finally {
            await close(held);
        }
    });

    it("returns the start port when it is free", async () => {
        const probe = await listen(0);
        const port = probe.address().port;
        await close(probe);
        expect(await pickPort(port)).toBe(port);
    });
});

describe("inUse", () => {
    // vite on windows listens on ::1 alone
    it.each(["127.0.0.1", "::1"])("sees a listener on %s", async (host) => {
        const held = await listen(0, host);
        try {
            expect(await inUse(held.address().port)).toBe(true);
        } finally {
            await close(held);
        }
    });

    it("is false for a port nobody listens on", async () => {
        expect(await inUse(await freePort())).toBe(false);
    });
});

// each test points LOCALAPPDATA at its own dir, so it never shares the build lock or a store with a real final stage
describe("final-verify.mjs", () => {
    let dir;
    afterEach(() => {
        if (dir) rmSync(dir, { recursive: true, force: true });
        dir = undefined;
    });

    it("is unverified when ARC_FINAL_OUT is not set", async () => {
        const env = { ...process.env };
        delete env.ARC_FINAL_OUT;
        const r = await run(env);
        expect(r.code).toBe(EXIT_UNVERIFIED);
        expect(r.last).toBe("ARC_FINAL_OUT is not set");
    });

    it("is unverified when the dev app never answers CDP, and stops the process it started", async () => {
        dir = mkdtempSync(join(tmpdir(), "final-verify-"));
        const pidFile = join(dir, "dev.pid");
        const fakeDev = join(dir, "fake-dev.cjs");
        writeFileSync(fakeDev, `require("fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));\nsetInterval(() => {}, 1000);\n`);

        const r = await run({
            ...process.env,
            LOCALAPPDATA: join(dir, "localappdata"),
            ARC_FINAL_OUT: join(dir, "out"),
            ARC_FINAL_BOOT_MS: "3000",
            ARC_FINAL_DEV_CMD: `node "${fakeDev}"`,
            ARC_FINAL_VITE_PORT: String(await freePort()),
        });

        expect(r.killed).toBe(false);
        expect(r.code).toBe(EXIT_UNVERIFIED);
        expect(r.last).toMatch(/^dev app did not answer on :\d+$/);
        expect(existsSync(pidFile)).toBe(true);
        expect(await gone(Number(readFileSync(pidFile, "utf8")), 5000)).toBe(true);
    }, 30_000);

    // a dev app is running on the vite port most of the time here: the final one takes another port, and builds
    // and stores everything where the running one cannot see it
    it("starts the dev app on its own vite port, target dir, store and no global install", async () => {
        dir = mkdtempSync(join(tmpdir(), "final-verify-"));
        const out = join(dir, "out");
        const envFile = join(dir, "env.json");
        const fakeDev = join(dir, "fake-dev.cjs");
        // stands in for the dev app: records its env and writes a log into the store it was given
        writeFileSync(
            fakeDev,
            `const fs = require("fs"), path = require("path");
fs.writeFileSync(${JSON.stringify(envFile)}, JSON.stringify(process.env));
const data = path.join(process.env.ARC_DEV_DATA_DIR, "data");
fs.mkdirSync(data, { recursive: true });
fs.writeFileSync(path.join(data, "waveapp.log"), "boot log");
`
        );
        const held = await listen(0, "::1");
        const heldPort = held.address().port;
        try {
            const r = await run({
                ...process.env,
                LOCALAPPDATA: join(dir, "localappdata"),
                ARC_FINAL_OUT: out,
                ARC_FINAL_BOOT_MS: "3000",
                ARC_FINAL_DEV_CMD: `node "${fakeDev}"`,
                ARC_FINAL_VITE_PORT: String(heldPort),
            });
            expect(r.code).toBe(EXIT_UNVERIFIED);
            expect(r.last).toMatch(/^dev app exited with code 0 before answering on :\d+$/);
        } finally {
            await close(held);
        }

        const cfg = JSON.parse(readFileSync(join(out, "tauri.final.json"), "utf8"));
        const port = Number(new URL(cfg.build.devUrl).port);
        expect(port).toBeGreaterThan(heldPort);
        expect(cfg.build.beforeDevCommand).toContain(`--port ${port} --strictPort`);

        const env = JSON.parse(readFileSync(envFile, "utf8"));
        const base = join(dir, "localappdata", "arc-final");
        expect(env.CARGO_TARGET_DIR).toBe(join(base, "target"));
        // wavesrv binds <store>/data/wave.sock, and windows caps a unix socket path at 108 bytes: measured on the
        // real base, since this test's base sits under a longer temp dir
        expect(dirname(env.ARC_DEV_DATA_DIR)).toBe(join(base, "stores"));
        const realBase = join(process.env.LOCALAPPDATA || join(homedir(), ".cache"), "arc-final");
        expect(join(realBase, "stores", basename(env.ARC_DEV_DATA_DIR), "data", "wave.sock").length).toBeLessThan(108);
        expect(existsSync(env.ARC_DEV_DATA_DIR)).toBe(false);
        expect(readFileSync(join(out, "waveapp.log"), "utf8")).toBe("boot log");
        expect(env.ARC_DEV_NO_GLOBAL_INSTALL).toBe("1");
        expect(env.WEBVIEW2_USER_DATA_FOLDER).toBe(join(out, "webview2-profile"));
    });
});

// final stages share the cargo target dir and run the exe they build there, so they must not overlap
describe("final-verify.mjs build lock", () => {
    let dir;
    afterEach(() => {
        if (dir) rmSync(dir, { recursive: true, force: true });
        dir = undefined;
    });

    // a dev app that logs its start and end to a shared file and exits after holdMs
    function fakeDevEnv(name, logFile, holdMs) {
        const fakeDev = join(dir, "fake-dev.cjs");
        writeFileSync(
            fakeDev,
            `const fs = require("fs");
fs.appendFileSync(${JSON.stringify(logFile)}, "start\\n");
setTimeout(() => fs.appendFileSync(${JSON.stringify(logFile)}, "end\\n"), ${holdMs});
`
        );
        return {
            ...process.env,
            LOCALAPPDATA: join(dir, "localappdata"),
            ARC_FINAL_OUT: join(dir, name),
            ARC_FINAL_BOOT_MS: "10000",
            ARC_FINAL_DEV_CMD: `node "${fakeDev}"`,
        };
    }

    // node cuts a unix socket path past sun_path (104 bytes on macOS) instead of failing, so the lock file would not
    // be where the stale-socket probe and drop look for it
    it("keeps the posix lock path within a socket path, and the windows lock a named pipe", () => {
        const long = join(tmpdir(), "x".repeat(120), "arc-final");
        const posix = buildLockPath(long, "darwin");
        expect(Buffer.byteLength(posix)).toBeLessThanOrEqual(104);
        expect(buildLockPath(long, "linux")).toBe(posix);
        expect(posix).toMatch(/arc-final-build-[0-9a-f]{8}\.sock$/);
        const short = join("/home/u", ".cache", "arc-final");
        const inBase = buildLockPath(short, "linux");
        expect(dirname(inBase)).toBe(short);
        expect(basename(inBase)).toMatch(/^build-[0-9a-f]{8}\.sock$/);
        expect(buildLockPath(long, "win32")).toMatch(/^\\\\\.\\pipe\\arc-final-build-[0-9a-f]{8}$/);
    });

    it("runs two final stages one after the other", async () => {
        dir = mkdtempSync(join(tmpdir(), "final-lock-"));
        const logFile = join(dir, "dev.log");
        const [a, b] = await Promise.all([
            run(fakeDevEnv("out-a", logFile, 1500)),
            run(fakeDevEnv("out-b", logFile, 1500)),
        ]);
        for (const r of [a, b]) {
            expect(r.code).toBe(EXIT_UNVERIFIED);
            expect(r.last).toMatch(/^dev app exited with code 0 before answering on :\d+$/);
        }
        expect(readFileSync(logFile, "utf8").trim().split(/\r?\n/)).toEqual(["start", "end", "start", "end"]);
    }, 30_000);

    it("is unverified when another final stage keeps the build past the wait", async () => {
        dir = mkdtempSync(join(tmpdir(), "final-lock-"));
        const base = join(dir, "localappdata", "arc-final");
        mkdirSync(base, { recursive: true });
        const held = await acquireBuildLock(buildLockPath(base), 0);
        expect(held).not.toBeNull();
        try {
            const r = await run({ ...fakeDevEnv("out", join(dir, "dev.log"), 0), ARC_FINAL_LOCK_WAIT_MS: "1500" });
            expect(r.code).toBe(EXIT_UNVERIFIED);
            expect(r.last).toBe("another final stage held the shared build for 2s");
            expect(existsSync(join(dir, "dev.log"))).toBe(false);
        } finally {
            await close(held);
        }
    });

    it("is free once the stage holding it is killed", async () => {
        dir = mkdtempSync(join(tmpdir(), "final-lock-"));
        const base = join(dir, "localappdata", "arc-final");
        mkdirSync(base, { recursive: true });
        const lockPath = buildLockPath(base);
        const holder = spawn(process.execPath, [
            "-e",
            `require("net").createServer().listen(${JSON.stringify(lockPath)}, () => console.log("held"));`,
        ]);
        await new Promise((resolve) => holder.stdout.once("data", resolve));
        expect(await acquireBuildLock(lockPath, 0)).toBeNull();
        holder.kill("SIGKILL");
        await new Promise((resolve) => holder.once("exit", resolve));

        const lock = await acquireBuildLock(lockPath, 5000);
        expect(lock).not.toBeNull();
        await close(lock);
    });
});

describe("pickVitePort", () => {
    it("skips a port a dev app holds on ::1 alone", async () => {
        const held = await listen(0, "::1");
        const port = held.address().port;
        try {
            expect(await pickVitePort(port)).toBeGreaterThan(port);
        } finally {
            await close(held);
        }
    });
});

describe("unlinkBuildJunctions", () => {
    let dir;
    afterEach(() => {
        if (dir) rmSync(dir, { recursive: true, force: true });
        dir = undefined;
    });

    it("removes the build-output links and leaves what they point at", () => {
        dir = mkdtempSync(join(tmpdir(), "final-junctions-"));
        const main = join(dir, "main");
        const tree = join(dir, "tree");
        for (const rel of ["dist/bin", "src-tauri/target"]) {
            mkdirSync(join(main, rel), { recursive: true });
            writeFileSync(join(main, rel, "keep.txt"), "x");
            mkdirSync(join(tree, rel, ".."), { recursive: true });
            symlinkSync(join(main, rel), join(tree, rel), "junction");
        }
        mkdirSync(join(tree, "node_modules"));

        unlinkBuildJunctions(tree);

        for (const rel of ["dist/bin", "src-tauri/target"]) {
            expect(existsSync(join(tree, rel))).toBe(false);
            expect(existsSync(join(main, rel, "keep.txt"))).toBe(true);
        }
        expect(existsSync(join(tree, "node_modules"))).toBe(true);
    });

    it("leaves a real directory alone", () => {
        dir = mkdtempSync(join(tmpdir(), "final-junctions-"));
        mkdirSync(join(dir, "dist", "bin"), { recursive: true });
        writeFileSync(join(dir, "dist", "bin", "wavesrv.x64.exe"), "x");
        unlinkBuildJunctions(dir);
        expect(existsSync(join(dir, "dist", "bin", "wavesrv.x64.exe"))).toBe(true);
    });
});

describe("sweepStaleStores", () => {
    let dir;
    afterEach(() => {
        if (dir) rmSync(dir, { recursive: true, force: true });
        dir = undefined;
    });

    it("drops every store a killed or half-cleaned stage left", () => {
        dir = mkdtempSync(join(tmpdir(), "final-stores-"));
        for (const id of ["aaaa1111", "bbbb2222"]) {
            mkdirSync(join(dir, id, "data", "db"), { recursive: true });
            writeFileSync(join(dir, id, "data", "db", "waveterm.db"), "x");
        }

        sweepStaleStores(dir);

        expect(existsSync(join(dir, "aaaa1111"))).toBe(false);
        expect(existsSync(join(dir, "bbbb2222"))).toBe(false);
    });

    it("is a no-op when no stage has made a store yet", () => {
        dir = mkdtempSync(join(tmpdir(), "final-stores-"));
        expect(() => sweepStaleStores(join(dir, "missing"))).not.toThrow();
    });
});

describe("finalManifest", () => {
    it("prefixes every file with cdp-shots/ and keeps the rest of the entry", () => {
        const steps = [{ step: "a", state: "pass" }];
        expect(
            finalManifest([
                { name: "runs", files: ["runs.png", "nested/open.png"], steps },
                { name: "empty", files: [], steps: [] },
            ])
        ).toEqual([
            { name: "runs", files: ["cdp-shots/runs.png", "cdp-shots/nested/open.png"], steps },
            { name: "empty", files: [], steps: [] },
        ]);
    });
});

describe("writeFinalManifest", () => {
    let dir;
    afterEach(() => {
        if (dir) rmSync(dir, { recursive: true, force: true });
        dir = undefined;
    });

    it("writes the prefixed manifest at the top of the out dir", () => {
        dir = mkdtempSync(join(tmpdir(), "final-manifest-"));
        const shots = join(dir, "cdp-shots");
        const out = join(dir, "out");
        mkdirSync(shots);
        mkdirSync(out);
        writeFileSync(join(shots, "shots.json"), JSON.stringify([{ name: "runs", files: ["runs.png"], steps: [] }]));

        writeFinalManifest(shots, out);

        expect(JSON.parse(readFileSync(join(out, "shots.json"), "utf8"))).toEqual([
            { name: "runs", files: ["cdp-shots/runs.png"], steps: [] },
        ]);
    });

    it("writes nothing when verify never wrote a manifest", () => {
        dir = mkdtempSync(join(tmpdir(), "final-manifest-"));
        const out = join(dir, "out");
        mkdirSync(out);

        writeFinalManifest(join(dir, "cdp-shots"), out);

        expect(existsSync(join(out, "shots.json"))).toBe(false);
    });

    it("writes nothing and does not throw when the manifest is unreadable", () => {
        dir = mkdtempSync(join(tmpdir(), "final-manifest-"));
        const shots = join(dir, "cdp-shots");
        const out = join(dir, "out");
        mkdirSync(shots);
        mkdirSync(out);
        writeFileSync(join(shots, "shots.json"), "{not json");

        expect(() => writeFinalManifest(shots, out)).not.toThrow();
        expect(existsSync(join(out, "shots.json"))).toBe(false);
    });
});
