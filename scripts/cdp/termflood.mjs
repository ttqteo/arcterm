// Repro loop for heavy terminal output (effort 9e6f68b5). On 2026-10-14 a docker build's BuildKit progress, ~180 KB/s
// into one shell tab, stalled the resmon readout and Usage for 20 minutes. This replays that load in a running dev
// app and measures what the cockpit felt: resmon snapshot round-trips, the router's backlog lines, and output
// chunks the store failed to append (each one is lost from the scrollback and the live terminal).
//
//   node scripts/cdp/termflood.mjs [--rate <KB/s>] [--secs <flood seconds>] [--port <cdp port>] [--view 1] [--tabs <n>]
//
// --view 1 opens the flood terminal on the Agent surface, so its output also streams to a live xterm; without it
// the tab runs unseen, the way a background shell tab does. --tabs N floods N terminals at once, each at --rate (the
// incident had ~12 agents writing beside the build); with --view only the first is on screen.
//
// Phases: idle baseline, flood, cooldown. Exits 1 when the flood phase is red (a round-trip over 2s, a failed
// snapshot, or a dropped append), so it doubles as the before/after check for a fix.
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
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

function parseArgs(argv) {
    const opts = { rate: 180, secs: 60, port: 9222, view: 0, tabs: 1 };
    for (let i = 0; i < argv.length; i += 2) {
        const key = argv[i].replace(/^--/, "");
        if (!(key in opts) || !Number.isFinite(Number(argv[i + 1]))) throw new Error(`bad argument: ${argv[i]} ${argv[i + 1] ?? ""}`);
        opts[key] = Number(argv[i + 1]);
    }
    return opts;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
    await res.arrayBuffer();
    return info ? JSON.parse(Buffer.from(info, "base64").toString("utf8")).size : 0;
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
        let stored = 0;
        for (const t of ctx.tabs) stored += await termBytes(h, t.blockId);
        // xterm draws to canvas, so the DOM holds no text to assert on; the shot shows whether the flood reached it
        if (opts.view) await h.shot(SHOT_PATH);
        console.log(`cooldown ${COOLDOWN_SECS}s ...`);
        await sleep(COOLDOWN_SECS * 1000);
        const t3 = Date.now();
        const samples = await h.ev("(window.__termflood.stop = true, window.__termflood.samples)");

        const log = parseLog(logSince(logDir, logOffset));
        const phases = [
            ["baseline", t0, t1],
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
        console.log(`stored ${(stored / 1024).toFixed(0)} KB of term output in ${opts.secs}s (${(stored / 1024 / opts.secs).toFixed(0)} KB/s after ConPTY)`);
        if (opts.view) console.log(`end-of-flood shot: ${SHOT_PATH}`);
        const red = redReasons(phases[1].rtt, phases[1].log);
        console.log(red.length ? `RED: ${red.join("; ")}` : "GREEN");
        process.exitCode = red.length ? 1 : 0;
    } finally {
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
