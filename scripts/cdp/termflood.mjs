// Repro loop for heavy terminal output (effort 9e6f68b5). On 2026-10-14 a docker build's BuildKit progress, ~180 KB/s
// into one shell tab, stalled the resmon readout and Usage for 20 minutes. This replays that load in a running dev
// app and measures what the cockpit felt: resmon snapshot round-trips, the router's backlog lines, and output
// chunks the store failed to append (each one is lost from the scrollback and the live terminal).
//
//   node scripts/cdp/termflood.mjs [--rate <KB/s>] [--secs <flood seconds>] [--port <cdp port>] [--view 1] [--tabs <n>]
//                                  [--load 1] [--free <GB>]
//
// --view 1 opens the flood terminal on the Agent surface, so its output also streams to a live xterm; without it
// the tab runs unseen, the way a background shell tab does. --tabs N floods N terminals at once, each at --rate (the
// incident had ~12 agents writing beside the build); with --view only the first is on screen.
//
// --load 1 adds the machine pressure the incident also had (4 runs' Verify, 12 claude.exe, 4.2 of 31.7 GB free)
// beside the flood: a busy loop on every core, memory held until --free GB is left (default 4, never under 2,
// re-checked against os.freemem, and capped so free commit stays above 2 GB), and fsync'd writes in a temp dir. It
// ramps before the flood and stops when the flood does. All of it runs in worker threads of this process, so none
// of it can outlive the script; Ctrl+C runs the same teardown as a normal exit.
//
// Phases: idle baseline, [load ramp,] flood, cooldown. Exits 1 when the flood phase is red (a round-trip over 2s, a
// failed snapshot, or a dropped append), so it doubles as the before/after check for a fix.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { availableParallelism, freemem, tmpdir, totalmem } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { attach, waitFor } from "./attach.mjs";

const BASELINE_SECS = 15;
const COOLDOWN_SECS = 10;
const SAMPLE_MS = 500;
const SAMPLE_TIMEOUT_MS = 10_000;
const BOOT_WAIT_MS = 60_000;
// the effort's red line: a resmon round-trip the user would see as a frozen readout
export const RED_RTT_MS = 2_000;
const TERM_SIZE = { rows: 30, cols: 120 };
const LOG_NAME = "waveapp.log";
const LOG_BACKUP = "waveapp.1.log";
const SHOT_PATH = resolve("cdp-shots", "termflood.png");

// BuildKit redraws its step list in place: cursor up over the block, clear each line, rewrite it. Lines of ~100
// columns at a 50ms tick, as many as the rate needs.
const FLOOD_SRC = `
const [rateKB, secs] = process.argv.slice(2).map(Number);
const TICK_MS = 50, COLS = 100;
const rows = Math.max(1, Math.round((rateKB * 1024 * TICK_MS) / 1000 / COLS));
const end = Date.now() + secs * 1000;
let n = 0;
const t = setInterval(() => {
    if (Date.now() >= end) {
        clearInterval(t);
        process.stdout.write("\\r\\nflood done\\r\\n");
        process.stdin.resume();
        return;
    }
    n++;
    let frame = n > 1 ? "\\x1b[" + rows + "A" : "";
    for (let r = 0; r < rows; r++) {
        const head = "\\x1b[2K#" + r + " [stage-" + (r % 7) + "] => transferring context: " + ((n * (r + 3)) % 9973) + "kB ";
        frame += head + "=".repeat(Math.max(0, COLS - head.length)) + "\\r\\n";
    }
    process.stdout.write(frame);
}, TICK_MS);
`;

export const GiB = 2 ** 30;
export const MIN_FREE_GB = 2;
// a held chunk is one worker thread, so releasing it (terminate) frees its memory at once rather than at some GC
export const MEM_CHUNK = 512 * 2 ** 20;
const MEM_TICK_MS = 250;
const RAMP_MAX_MS = 60_000;
const DISK_WRITERS = 2;
const DISK_BLOCK = 256 * 1024;
// each writer cycles over one file this size, so the disk use stays bounded however fast it writes
const DISK_FILE_CAP = 64 * 2 ** 20;
const LOAD_EXIT_MS = 5_000;

// workers stop when the shared flag is set; the disk writer must close its fd itself, which terminate() would leak
const CPU_SRC = `
const { workerData } = require("node:worker_threads");
const stop = new Int32Array(workerData.stop);
let x = 1;
while (Atomics.load(stop, 0) === 0) for (let i = 0; i < 1e6; i++) x = (x * 1103515245 + 12345) | 0;
`;

const DISK_SRC = `
const { workerData } = require("node:worker_threads");
const fs = require("node:fs");
const crypto = require("node:crypto");
const stop = new Int32Array(workerData.stop);
const written = new Int32Array(workerData.written);
const block = crypto.randomBytes(${DISK_BLOCK});
const fd = fs.openSync(workerData.path, "w");
let pos = 0;
try {
    while (Atomics.load(stop, 0) === 0) {
        fs.writeSync(fd, block, 0, block.length, pos);
        fs.fsyncSync(fd);
        pos = (pos + block.length) % ${DISK_FILE_CAP};
        Atomics.add(written, workerData.slot, 1);
    }
} finally {
    fs.closeSync(fd);
}
`;

// random bytes, since Windows compresses a trimmed page of a constant fill to almost nothing; touching every page
// on a timer keeps the chunk in the working set the way a live process's heap is
const MEM_SRC = `
const { parentPort } = require("node:worker_threads");
const buf = Buffer.allocUnsafeSlow(${MEM_CHUNK});
require("node:crypto").randomFillSync(buf);
parentPort.postMessage("held");
setInterval(() => { for (let i = 0; i < buf.length; i += 4096) buf[i]++; }, 2000);
`;

// chunks to take (+1, one at a time so freemem is re-read after each) or release (-n) to keep free memory at or just
// above target, never holding more than cap
export function memDelta({ free, held, cap, target, chunk = MEM_CHUNK }) {
    // the || turns -0 (short, but nothing held) into 0
    if (free < target) return -Math.min(Math.ceil((target - free) / chunk), Math.floor(held / chunk)) || 0;
    if (free - chunk >= target && held + chunk <= cap) return 1;
    return 0;
}

// the most the load may hold: physical memory down to the target, and commit (RAM + pagefile) down to the floor, since
// running the commit charge out fails allocations in every process, the user's live agents included
export function memCap({ total, target, commitFree }) {
    return Math.max(0, Math.min(total - target, commitFree - MIN_FREE_GB * GiB));
}

// read once when the load starts: it costs a powershell launch, and the load's own chunks count against it in memCap
function commitFree() {
    if (process.platform !== "win32") return Infinity;
    const cmd = "(Get-CimInstance Win32_OperatingSystem).FreeVirtualMemory";
    const out = execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", cmd], { encoding: "utf8", timeout: 30_000 });
    const kb = Number(out.trim());
    if (!Number.isFinite(kb) || kb <= 0) throw new Error(`could not read the free commit charge: ${JSON.stringify(out)}`);
    return kb * 1024;
}

export function percentile(sorted, p) {
    if (sorted.length === 0) return null;
    return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

export function summarize(samples) {
    const ms = samples.filter((s) => s.ok).map((s) => s.ms).sort((a, b) => a - b);
    return {
        n: samples.length,
        failed: samples.filter((s) => !s.ok).length,
        p50: percentile(ms, 50),
        p95: percentile(ms, 95),
        max: ms.length ? ms[ms.length - 1] : null,
    };
}

// wavesrv's log lines start with a local "YYYY-MM-DD HH:MM:SS.mmm" stamp; a line without one (a panic stack's
// continuation) is dropped, since nothing tallied here spans lines
export function parseLog(text) {
    const out = [];
    for (const line of text.split(/\r?\n/)) {
        const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}\.\d{3}) /.exec(line);
        if (m) out.push({ ts: new Date(`${m[1]}T${m[2]}`).getTime(), line });
    }
    return out;
}

export function tallyLog(entries) {
    const t = { appendErrors: 0, deadlineExceeded: 0, flushErrors: 0, backlogMax: 0 };
    for (const { line } of entries) {
        if (line.includes("error appending to blockfile")) t.appendErrors++;
        if (line.includes("context deadline exceeded")) t.deadlineExceeded++;
        if (line.includes("filestore flush:") && !line.includes("err:<nil>")) t.flushErrors++;
        const b = /\[router\] backlog for linkid=\d+ (?:reached (\d+) messages|cleared.*highwater mark was (\d+) messages)/.exec(line);
        if (b) t.backlogMax = Math.max(t.backlogMax, Number(b[1] ?? b[2]));
    }
    return t;
}

export function redReasons(rtt, log) {
    const reasons = [];
    if (rtt.max != null && rtt.max > RED_RTT_MS) reasons.push(`resmon round-trip ${Math.round(rtt.max)}ms > ${RED_RTT_MS}ms`);
    if (rtt.failed > 0) reasons.push(`${rtt.failed} resmon snapshot(s) failed`);
    if (log.appendErrors > 0) reasons.push(`${log.appendErrors} terminal append(s) dropped`);
    return reasons;
}

export function parseArgs(argv) {
    const opts = { rate: 180, secs: 60, port: 9222, view: 0, tabs: 1, load: 0, free: 4 };
    for (let i = 0; i < argv.length; i += 2) {
        const key = argv[i].replace(/^--/, "");
        if (!(key in opts) || !Number.isFinite(Number(argv[i + 1]))) throw new Error(`bad argument: ${argv[i]} ${argv[i + 1] ?? ""}`);
        opts[key] = Number(argv[i + 1]);
    }
    if (opts.free < MIN_FREE_GB) throw new Error(`--free ${opts.free}: the load never leaves less than ${MIN_FREE_GB} GB free`);
    return opts;
}

// Ctrl+C aborts the current wait, so main's finally closes the tabs and stops the load; a second one kills outright
const interrupt = new AbortController();
const sleep = (ms) => delay(ms, undefined, { signal: interrupt.signal });

function loadWorker(load, src, workerData) {
    const w = new Worker(src, { eval: true, workerData });
    w.exited = new Promise((r) => w.once("exit", r));
    w.on("error", (e) => {
        load.errors.push(e?.message ?? String(e));
        console.error(`termflood: a load worker failed: ${e?.message ?? e}`);
    });
    return w;
}

function holdChunk(load) {
    const w = loadWorker(load, MEM_SRC);
    return new Promise((res, rej) => {
        w.once("message", () => res(w));
        w.exited.then((code) => rej(new Error(`a memory chunk exited (code ${code}) before it was held`)));
    });
}

async function holdMemory(load) {
    try {
        while (!load.stopped) {
            const free = freemem();
            load.minFree = Math.min(load.minFree, free);
            const d = memDelta({ free, held: load.chunks.length * MEM_CHUNK, cap: load.cap, target: load.target });
            if (d <= 0) load.settle();
            if (d > 0) load.chunks.push(await holdChunk(load));
            else if (d < 0) await Promise.all(load.chunks.splice(d).map((w) => w.terminate()));
            else await delay(MEM_TICK_MS);
            load.peakHeld = Math.max(load.peakHeld, load.chunks.length * MEM_CHUNK);
        }
    } catch (e) {
        load.errors.push(e.message);
        console.error(`termflood: memory load stopped: ${e.message}`);
        load.settle();
    }
}

function startLoad(opts, dir) {
    const stop = new SharedArrayBuffer(4);
    const written = new SharedArrayBuffer(4 * DISK_WRITERS);
    const target = opts.free * GiB;
    const cap = memCap({ total: totalmem(), target, commitFree: commitFree() });
    const load = { stop, written, busy: [], chunks: [], errors: [], target, cap, minFree: freemem(), peakHeld: 0 };
    load.settled = new Promise((r) => (load.settle = r));
    for (let i = 0; i < availableParallelism(); i++) load.busy.push(loadWorker(load, CPU_SRC, { stop }));
    for (let i = 0; i < DISK_WRITERS; i++) {
        load.busy.push(loadWorker(load, DISK_SRC, { stop, written, slot: i, path: join(dir, `disk-${i}.bin`) }));
    }
    load.memLoop = holdMemory(load);
    return load;
}

async function stopLoad(load) {
    load.stopped = true;
    Atomics.store(new Int32Array(load.stop), 0, 1);
    await load.memLoop;
    await Promise.all(load.chunks.map((w) => w.terminate()));
    // a worker stuck in a write past the grace period is terminated; its fd then closes with the process
    await Promise.all(
        load.busy.map((w) =>
            Promise.race([w.exited, delay(LOAD_EXIT_MS, undefined, { ref: false })]).then(() => w.terminate())
        )
    );
}

function loadSummary(load, secs) {
    const blocks = new Int32Array(load.written).reduce((a, b) => a + b, 0);
    const gb = (b) => (b / GiB).toFixed(1);
    return (
        `load: ${load.busy.length - DISK_WRITERS} busy cores, fsync'd writes ${((blocks * DISK_BLOCK) / 2 ** 20 / secs).toFixed(0)} MB/s, ` +
        `held up to ${gb(load.peakHeld)} GB (cap ${gb(load.cap)}), free min ${gb(load.minFree)} of ${gb(totalmem())} GB (target ${gb(load.target)})` +
        (load.errors.length ? `, ${load.errors.length} load error(s)` : "")
    );
}

// the log text written since offset; across a roll (past 10 MB the log moves to waveapp.1.log) the backup's tail
// then the new file
function logSince(dir, offset) {
    const cur = join(dir, LOG_NAME);
    const size = statSync(cur).size;
    if (size >= offset) return readFileSync(cur).subarray(offset).toString("utf8");
    return readFileSync(join(dir, LOG_BACKUP)).subarray(offset).toString("utf8") + readFileSync(cur, "utf8");
}

async function service(h, svc, method, args) {
    const [endpoint, key] = await h.ev(`[window.api.getEnv("WAVE_SERVER_WEB_ENDPOINT"), window.api.getAuthKey()]`);
    const res = await fetch(`http://${endpoint}/wave/service?service=${svc}&method=${method}`, {
        method: "POST",
        headers: { "x-authkey": key },
        body: JSON.stringify({ service: svc, method, args, uicontext: null }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || body == null || body.error) throw new Error(`${svc}.${method}: ${body?.error ?? `HTTP ${res.status}`}`);
    return body.data;
}

// total bytes ever appended to the block's term file (the file is circular, so its size counts past the 2 MB cap)
async function termBytes(h, blockId) {
    const [endpoint, key] = await h.ev(`[window.api.getEnv("WAVE_SERVER_WEB_ENDPOINT"), window.api.getAuthKey()]`);
    const res = await fetch(`http://${endpoint}/wave/file?zoneid=${blockId}&name=term`, { headers: { "x-authkey": key } });
    const info = res.headers.get("X-ZoneFileInfo");
    // only the header is needed: draining the 2 MB body adds store reads to the load being measured, and under load
    // the server can cut the body off mid-stream, which would fail the run after the flood
    await res.body?.cancel().catch(() => {});
    if (!info) throw new Error(`HTTP ${res.status}`);
    return JSON.parse(Buffer.from(info, "base64").toString("utf8")).size;
}

// samples run inside the page, so a round-trip is what the cockpit's own resmon poll would wait
const START_SAMPLER = `(() => {
    const s = (window.__termflood = { samples: [], stop: false });
    (async () => {
        while (!s.stop) {
            const t0 = performance.now();
            let ok = true;
            try { await window.TabRpcClient.wshRpcCall("resmonsnapshot", {}, { timeout: ${SAMPLE_TIMEOUT_MS} }); } catch { ok = false; }
            s.samples.push({ at: Date.now(), ms: performance.now() - t0, ok });
            await new Promise((r) => setTimeout(r, ${SAMPLE_MS}));
        }
    })();
    return true;
})()`;

async function mountTerminal(h, tabId) {
    const row = `document.querySelector('[data-tree-terminal="${tabId}"]')`;
    await h.goto("agent");
    if (!(await waitFor(h.ev, `!!${row}`, BOOT_WAIT_MS))) throw new Error("the flood tab has no row in the agent tree");
    await h.ev(`${row}.click()`);
    const term = `document.querySelector('[data-agent-terminal="${tabId}"] .xterm-viewport')`;
    if (!(await waitFor(h.ev, `!!${term}`, BOOT_WAIT_MS))) throw new Error("the flood terminal did not mount");
}

function fmt(rtt) {
    const r = (v) => (v == null ? "-" : `${Math.round(v)}ms`);
    return `n=${rtt.n} failed=${rtt.failed} p50=${r(rtt.p50)} p95=${r(rtt.p95)} max=${r(rtt.max)}`;
}

async function newFloodTab(h, workspaceId, name) {
    const tabId = await service(h, "workspace", "CreateTab", [workspaceId, name, false]);
    const tab = await service(h, "object", "GetObject", [`tab:${tabId}`]);
    const blockId = tab?.blockids?.[0];
    if (!blockId) throw new Error(`tab ${name} has no block`);
    return { tabId, blockId };
}

async function main() {
    const opts = parseArgs(process.argv.slice(2));
    const h = await attach(opts.port);
    process.once("SIGINT", () => {
        console.error("termflood: interrupted, cleaning up (Ctrl+C again to kill)");
        interrupt.abort();
    });
    const dir = mkdtempSync(join(tmpdir(), "termflood-"));
    const ctx = { tabs: [] };
    try {
        if (!(await waitFor(h.ev, "!!window.TabRpcClient", BOOT_WAIT_MS))) throw new Error("the page did not boot its rpc client");
        const info = await h.rpc("waveinfo", null);
        const logDir = info.datadir;
        const logOffset = statSync(join(logDir, LOG_NAME)).size;
        const flood = join(dir, "flood.mjs");
        writeFileSync(flood, FLOOD_SRC);

        const bootTab = String(await h.ev("window.TabRpcClient.routeId")).replace(/^tab:/, "");
        const wslist = await h.rpc("workspacelist", null);
        const ws = wslist.find((w) => (w.workspacedata?.tabids ?? []).includes(bootTab)) ?? wslist[0];
        ctx.workspaceId = ws.workspacedata.oid;
        for (let i = 0; i < opts.tabs; i++) ctx.tabs.push(await newFloodTab(h, ctx.workspaceId, `termflood-${i + 1}`));

        await h.ev(START_SAMPLER);
        const t0 = Date.now();
        console.log(`baseline ${BASELINE_SECS}s ...`);
        await sleep(BASELINE_SECS * 1000);
        const tLoad = Date.now();
        if (opts.load) {
            console.log(`load ramp, holding memory down to ${opts.free} GB free (at most ${RAMP_MAX_MS / 1000}s) ...`);
            ctx.load = startLoad(opts, dir);
            await Promise.race([ctx.load.settled, delay(RAMP_MAX_MS, undefined, { signal: interrupt.signal, ref: false })]);
        }

        // the cwd is ~, not the temp dir, which the process would keep locked past teardown
        const meta = { view: "term", controller: "cmd", cmd: `node '${flood}' ${opts.rate} ${opts.secs}`, "cmd:cwd": "~" };
        for (const t of ctx.tabs) await h.rpc("setmeta", { oref: `block:${t.blockId}`, meta });
        const t1 = Date.now();
        // a mounted view starts its own process; the resync starts every one nothing mounted
        if (opts.view) await mountTerminal(h, ctx.tabs[0].tabId);
        for (const t of ctx.tabs) await h.rpc("controllerresync", { tabid: t.tabId, blockid: t.blockId, rtopts: { termsize: TERM_SIZE } });
        console.log(`flood ${opts.tabs} tab(s) at ${opts.rate} KB/s each for ${opts.secs}s ...`);
        await sleep(opts.secs * 1000);
        const t2 = Date.now();
        let loadLine = null;
        if (ctx.load) {
            await stopLoad(ctx.load);
            loadLine = loadSummary(ctx.load, (t2 - tLoad) / 1000);
            ctx.load = null;
        }
        let stored = 0;
        const unread = [];
        for (const t of ctx.tabs) {
            // under load the store can time this read out too; that is a finding, not a reason to lose the run
            stored += await termBytes(h, t.blockId).catch((e) => (unread.push(e.message), 0));
        }
        // xterm draws to canvas, so the DOM holds no text to assert on; the shot shows whether the flood reached it
        if (opts.view) await h.shot(SHOT_PATH);
        console.log(`cooldown ${COOLDOWN_SECS}s ...`);
        await sleep(COOLDOWN_SECS * 1000);
        const t3 = Date.now();
        const samples = await h.ev("(window.__termflood.stop = true, window.__termflood.samples)");

        const log = parseLog(logSince(logDir, logOffset));
        const phases = [
            ["baseline", t0, tLoad],
            ...(opts.load ? [["ramp", tLoad, t1]] : []),
            ["flood", t1, t2],
            ["cooldown", t2, t3],
        ].map(([name, from, to]) => ({
            name,
            rtt: summarize(samples.filter((s) => s.at >= from && s.at < to)),
            log: tallyLog(log.filter((e) => e.ts >= from && e.ts < to)),
        }));
        for (const p of phases) {
            const l = p.log;
            console.log(
                `${p.name.padEnd(9)} resmon ${fmt(p.rtt)} | appendErrors=${l.appendErrors} deadline=${l.deadlineExceeded} ` +
                    `flushErrors=${l.flushErrors} backlogMax=${l.backlogMax}`
            );
        }
        console.log(
            `stored ${(stored / 1024).toFixed(0)} KB of term output in ${opts.secs}s (${(stored / 1024 / opts.secs).toFixed(0)} KB/s after ConPTY)` +
                (unread.length ? `, ${unread.length} of ${ctx.tabs.length} term file(s) unreadable (${unread[0]})` : "")
        );
        if (loadLine) console.log(loadLine);
        if (opts.view) console.log(`end-of-flood shot: ${SHOT_PATH}`);
        const flooded = phases.find((p) => p.name === "flood");
        const red = redReasons(flooded.rtt, flooded.log);
        console.log(red.length ? `RED: ${red.join("; ")}` : "GREEN");
        process.exitCode = red.length ? 1 : 0;
    } finally {
        if (ctx.load) await stopLoad(ctx.load);
        await h.ev("window.__termflood && (window.__termflood.stop = true)").catch(() => {});
        for (const t of ctx.tabs) {
            await service(h, "workspace", "CloseTab", [ctx.workspaceId, t.tabId, false]).catch((e) =>
                console.error(`termflood: closing a flood tab failed: ${e?.message ?? e}`)
            );
        }
        h.close();
        rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((e) => {
        console.error(`termflood: ${e?.message ?? e}`);
        process.exit(2);
    });
}
