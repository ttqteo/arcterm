// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// `task install` on a Mac: puts the last `task tauri:build` in place of /Applications/arcterm.app and
// reopens it. It quits the running arcterm and every agent in it, so an agent never runs it on its own.
//
//   node scripts/install-mac.mjs            quit arcterm, replace it, reopen it (in the background)
//   node scripts/install-mac.mjs --dry-run  say what it would quit and copy, touching nothing
//
// The work runs in a detached child, a session of its own: run from a terminal inside arcterm, that
// terminal's shell goes down with the app, and the install must not go with it. The child logs to
// $TMPDIR/arcterm-install.log.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP = "/Applications/arcterm.app";
const BUILT = fileURLToPath(new URL("../src-tauri/target/release/bundle/macos/arcterm.app", import.meta.url));
const LOG = join(tmpdir(), "arcterm-install.log");
// the copy lands here first, on the same volume as APP: a failed copy leaves arcterm as it was, and the
// swap is a rename
const STAGING = "/Applications/.arcterm-install";

// appPids reads `ps -axo pid=,command=` for the processes whose executable lies inside the bundle at
// app: the app and the wavesrv it spawned. Never the dev app or a build in a repo, which share their
// image names, nor a process that only names the path in its arguments.
export function appPids(ps, app) {
    const inside = app + "/Contents/";
    const pids = [];
    for (const line of ps.split("\n")) {
        const m = line.match(/^\s*(\d+)\s+(.*)$/);
        if (m && m[2].startsWith(inside)) {
            pids.push(Number(m[1]));
        }
    }
    return pids;
}

const log = (msg) => console.log(`${new Date().toISOString()} ${msg}`);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const running = () => appPids(execFileSync("ps", ["-axo", "pid=,command="], { encoding: "utf8" }), APP);

function version(app) {
    try {
        return execFileSync("plutil", ["-extract", "CFBundleShortVersionString", "raw", join(app, "Contents/Info.plist")], {
            encoding: "utf8",
        }).trim();
    } catch {
        return "none";
    }
}

// waits up to ms for every app process to exit; true once none is left
async function gone(ms) {
    for (const end = Date.now() + ms; Date.now() < end; await sleep(500)) {
        if (running().length === 0) {
            return true;
        }
    }
    return running().length === 0;
}

function signal(pids, sig) {
    for (const pid of pids) {
        try {
            process.kill(pid, sig);
        } catch {
            // already gone
        }
    }
}

// a plain quit first: the host's RunEvent::Exit stops wavesrv itself. by pid only if it will not go
async function quit() {
    if (running().length === 0) {
        return;
    }
    log("quitting arcterm");
    try {
        execFileSync("osascript", ["-e", 'tell application id "dev.arc.app" to quit']);
    } catch (err) {
        log(`osascript: ${err.message}`);
    }
    if (!(await gone(20_000))) {
        log(`still running after 20 s, SIGTERM ${running().join(" ")}`);
        signal(running(), "SIGTERM");
    }
    if (!(await gone(10_000))) {
        log(`still running after 30 s, SIGKILL ${running().join(" ")}`);
        signal(running(), "SIGKILL");
        await gone(5_000);
    }
}

async function install() {
    log(`installing ${version(BUILT)} from ${BUILT} over ${version(APP)} at ${APP}`);
    rmSync(STAGING, { recursive: true, force: true });
    mkdirSync(STAGING);
    const staged = join(STAGING, "arcterm.app");
    execFileSync("ditto", [BUILT, staged]);
    await quit();
    rmSync(APP, { recursive: true, force: true });
    renameSync(staged, APP);
    rmSync(STAGING, { recursive: true, force: true });
    log("reopening");
    execFileSync("open", [APP]);
    log("done");
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === self) {
    const mode = process.argv[2];
    if (!existsSync(BUILT)) {
        console.error(`no build at ${BUILT}: run task tauri:build first`);
        process.exit(1);
    }
    if (mode === "--dry-run") {
        console.log(`would quit: ${running().join(", ") || "nothing (arcterm is not running)"}`);
        console.log(`would install ${version(BUILT)} over ${version(APP)} at ${APP}, then open it`);
    } else if (mode === "--detached") {
        try {
            await install();
        } catch (err) {
            log(`failed: ${err.stack ?? err}`);
            // whatever stands at APP now, the person gets an arcterm back
            if (existsSync(APP)) {
                execFileSync("open", [APP]);
            }
            process.exitCode = 1;
        }
    } else {
        const out = openSync(LOG, "w");
        spawn(process.execPath, [self, "--detached"], { detached: true, stdio: ["ignore", out, out] }).unref();
        console.log(`arcterm ${version(BUILT)} replaces ${version(APP)}: arcterm quits and reopens in a few seconds.`);
        console.log(`log: ${LOG}`);
    }
}
