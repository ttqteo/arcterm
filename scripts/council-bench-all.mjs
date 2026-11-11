// council-bench-all: runs round 2 of the council bench from A to Z, one bench at a time, and can be started again at
// any point.
//
//   wsh detach -- node scripts/council-bench-all.mjs      start it (detached, so an arcterm restart does not take it down)
//   node scripts/council-bench-all.mjs --dry              print the cells still missing scored runs; starts nothing
//
// What it runs: the cases in PLAN, each as the Brainstorm council (the installed `wsh council bench --case <id>
// --variant council`) and as the brainstorm skill (`go run ./cmd/council-bench-brainstorm --case <id>`, from this
// checkout), RUNS scored runs per cell. A cell's scored runs are the rows of council-bench.jsonl for its case and
// variant whose state is "done" and whose harness is this checkout's council.HarnessVersion (pkg/council/prompts.go),
// so a row of an earlier round never fills a cell. It reads the results file before every step, so a second start
// (after a crash, a reboot, a killed session) only runs the cells still missing. A start waits until FREE_GB of RAM is
// free on two reads 30 s apart. A bench that dies (wavesrv restarts) or ends short (the token cap, a stop) has its
// missing runs rerun, at most MAX_STARTS starts per cell. A refused Token burn card stops the script. It never stops
// a bench itself.
//
// Before its first bench it reads the harness version of the running wavesrv (`wsh council bench results --json`) and
// stops when it is not this checkout's: the council side scores inside the installed app, so the new build has to be
// installed first.
//
// Files in <data dir>/council-bench/work/: bench-all.status.txt (one line per step, appended), bench-all.pid (the
// running copy; a second copy refuses to start while it lives), bench-all.results.txt (the final `wsh council bench
// results`).
import { spawnSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPTS = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(SCRIPTS, "..");
const FREE_GB = 8;
const MAX_STARTS = 3;

// PLAN is round 2: per case the council variant, then the brainstorm variant, RUNS scored runs each.
const PLAN = {
    cases: ["run-pause", "held-services", "heavy-job-queue", "goalpost-guard"],
    variants: ["council", "brainstorm"],
    runs: 2,
};

// parseHarnessVersion reads council.HarnessVersion ("<YYYY-MM-DD>.<n>") out of pkg/council/prompts.go's source.
export function parseHarnessVersion(goSource) {
    const m = /\bHarnessVersion\s*=\s*"(\d{4}-\d{2}-\d{2}\.\d+)"/.exec(goSource);
    if (!m) throw new Error('no HarnessVersion = "<YYYY-MM-DD>.<n>" in pkg/council/prompts.go');
    return m[1];
}

// scoredRuns are the rows that count toward a cell: its case and variant, state done, written by this harness.
export function scoredRuns(rows, harness, caseId, variant) {
    return rows.filter((r) => r.case === caseId && r.variant === variant && r.state === "done" && r.harness === harness);
}

// missingCells lists, in plan order, the cells short of plan.runs scored runs, with how many runs each still needs.
export function missingCells(rows, plan, harness) {
    const out = [];
    for (const caseId of plan.cases) {
        for (const variant of plan.variants) {
            const need = plan.runs - scoredRuns(rows, harness, caseId, variant).length;
            if (need > 0) out.push({ case: caseId, variant, need });
        }
    }
    return out;
}

// harnessCheck says whether the running wavesrv's harness is the checkout's; an absent one (an older wavesrv, or none
// answering) is a mismatch.
export function harnessCheck(serverHarness, checkoutHarness) {
    if (!serverHarness) {
        return {
            ok: false,
            message: `the running wavesrv reports no harness version (an older build, or none running; the checkout's is ${checkoutHarness}): install the new build first`,
        };
    }
    if (serverHarness !== checkoutHarness) {
        return {
            ok: false,
            message: `the running wavesrv's harness is ${serverHarness}, the checkout's is ${checkoutHarness}: install the new build first`,
        };
    }
    return { ok: true, message: "" };
}

// dataDir is the packaged app's data dir, as cmd/council-bench-brainstorm resolves it.
function dataDir() {
    if (process.platform === "win32") {
        if (!process.env.LOCALAPPDATA) throw new Error("LOCALAPPDATA is not set");
        return path.join(process.env.LOCALAPPDATA, "dev.arc.app", "data");
    }
    if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "dev.arc.app");
    throw new Error(`no packaged app's data dir on ${process.platform}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const localTs = (d = new Date()) => d.toLocaleString("sv-SE"); // "YYYY-MM-DD HH:MM:SS", as waveapp.log writes it

function alive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

// the pid of the installed app's wavesrv, "" when none is found; a bench dies with it
function wavesrvPid() {
    try {
        if (process.platform === "win32") {
            return execFileSync("powershell.exe", [
                "-NoProfile",
                "-Command",
                "(Get-Process wavesrv.x64 -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*\\AppData\\Local\\arcterm\\*' } | Select-Object -First 1).Id",
            ])
                .toString()
                .trim();
        }
        return execFileSync("pgrep", ["-f", "wavesrv"]).toString().trim().split("\n")[0];
    } catch {
        return "";
    }
}

async function main(argv) {
    const dry = argv.includes("--dry");
    const unknown = argv.find((a) => a !== "--dry");
    if (unknown) throw new Error(`unknown argument ${unknown} (the only one is --dry)`);

    const DATA = dataDir();
    const WORK = path.join(DATA, "council-bench", "work");
    const RESULTS = path.join(DATA, "council-bench.jsonl");
    const APPLOG = path.join(DATA, "waveapp.log");
    const WSH = process.platform === "win32" ? path.join(DATA, "bin", "wsh.exe") : "wsh";
    const STATUS = path.join(WORK, "bench-all.status.txt");
    const PIDFILE = path.join(WORK, "bench-all.pid");
    const FINAL = path.join(WORK, "bench-all.results.txt");
    const HARNESS = parseHarnessVersion(fs.readFileSync(path.join(REPO, "pkg", "council", "prompts.go"), "utf8"));

    function log(msg) {
        const line = `${localTs()} ${msg}`;
        console.log(line);
        if (!dry) fs.appendFileSync(STATUS, line + "\n");
    }

    // the run rows of the results file; a line that does not parse is logged once and skipped
    const warned = new Set();
    function readRows() {
        let text;
        try {
            text = fs.readFileSync(RESULTS, "utf8");
        } catch (err) {
            if (err.code === "ENOENT") return [];
            throw err;
        }
        const out = [];
        for (const l of text.split("\n")) {
            if (!l) continue;
            try {
                const r = JSON.parse(l);
                if (r.kind === "run") out.push(r);
            } catch (err) {
                if (!warned.has(l)) {
                    warned.add(l);
                    log(`skipping a line of council-bench.jsonl that does not parse (${err.message}): ${l.slice(0, 80)}`);
                }
            }
        }
        return out;
    }

    function benchEndedSince(since) {
        try {
            return fs
                .readFileSync(APPLOG, "utf8")
                .split("\n")
                .slice(-5000)
                .some((l) => l.includes("[council-bench] the bench ended") && l.slice(0, 19) >= since);
        } catch (err) {
            log(`cannot read ${APPLOG} (${err.message}); the end of a bench shows only in its rows or wavesrv's pid`);
            return false;
        }
    }

    // the running wavesrv's harness from `wsh council bench results --json`; undefined when it cannot be read
    function serverHarness() {
        const r = spawnSync(WSH, ["council", "bench", "results", "--json"], { encoding: "utf8", maxBuffer: 1 << 28 });
        if (r.status !== 0) {
            const said = (r.stderr ?? "").trim().split("\n").slice(-3).join(" | ");
            log(`cannot read the running wavesrv's harness: ${WSH} exited ${r.status ?? r.error?.message}: ${said}`);
            return undefined;
        }
        try {
            return JSON.parse(r.stdout).harness;
        } catch (err) {
            log(`cannot read the running wavesrv's harness: the results are not JSON (${err.message})`);
            return undefined;
        }
    }

    async function waitForMemory(label) {
        let ok = 0;
        let said = false;
        for (;;) {
            const free = os.freemem() / 2 ** 30;
            if (free >= FREE_GB) {
                if (++ok >= 2) break;
            } else {
                ok = 0;
                if (!said) log(`${label}: waiting for memory (${free.toFixed(1)} GB free, want ${FREE_GB})`);
                said = true;
            }
            await sleep(30_000);
        }
        log(`${label}: ${(os.freemem() / 2 ** 30).toFixed(1)} GB free, starting`);
    }

    function stop(msg) {
        log(`STOPPED: ${msg}`);
        process.exit(1);
    }

    // startCouncil runs one `wsh council bench` for the cell and waits for its rows, its end line, or wavesrv going away.
    async function startCouncil(cell, label) {
        const rowsOf = () => readRows().filter((r) => r.case === cell.case && r.variant === cell.variant);
        for (;;) {
            await waitForMemory(label);
            const args = ["council", "bench", "--case", cell.case, "--variant", cell.variant, "--runs", String(cell.need)];
            const target = rowsOf().length + cell.need;
            const since = localTs();
            const pid = wavesrvPid();
            log(`${label}: wsh ${args.join(" ")} (wavesrv pid ${pid || "none"})`);
            const r = spawnSync(WSH, args, { encoding: "utf8" });
            const said = ((r.stdout ?? "") + (r.stderr ?? "")).trim();
            log(`${label}: ${said.replace(/\n/g, " | ")}`);
            if (/already running/.test(said)) {
                log(`${label}: another bench is running; waiting 2 min (this script never stops it)`);
                await sleep(120_000);
                continue;
            }
            if (r.status !== 0 || /Not run/.test(said)) {
                stop(`${label}: the start failed or the Token burn card was refused (exit ${r.status ?? r.error?.message})`);
            }
            for (;;) {
                await sleep(20_000);
                if (rowsOf().length >= target) return;
                const now = wavesrvPid();
                if (now !== pid) {
                    log(`${label}: wavesrv changed (pid ${pid} -> ${now || "none"}): the bench died with it`);
                    await sleep(60_000);
                    return;
                }
                if (benchEndedSince(since)) {
                    await sleep(5_000);
                    log(`${label}: the bench ended before every row (the token cap, a stop, or a failure)`);
                    return;
                }
            }
        }
    }

    // startBrainstorm runs the brainstorm variant's runs for the cell, from the checkout, and waits for them to end.
    async function startBrainstorm(cell, label) {
        await waitForMemory(label);
        log(`${label}: go run ./cmd/council-bench-brainstorm --case ${cell.case} --runs ${cell.need}`);
        const r = spawnSync("go", ["run", "./cmd/council-bench-brainstorm", "--case", cell.case, "--runs", String(cell.need)], {
            cwd: REPO,
            encoding: "utf8",
            maxBuffer: 1 << 28,
        });
        const said = ((r.stdout ?? "") + (r.stderr ?? "")).trim().split("\n").slice(-3).join(" | ");
        log(`${label}: exit ${r.status ?? r.error?.message}: ${said}`);
    }

    // one live copy: a pid file whose process lives refuses a second start
    if (!dry) {
        fs.mkdirSync(WORK, { recursive: true });
        if (fs.existsSync(PIDFILE)) {
            const old = Number(fs.readFileSync(PIDFILE, "utf8"));
            if (old && old !== process.pid && alive(old)) {
                console.error(`bench-all is already running as pid ${old}; stop it first`);
                return 2;
            }
        }
        fs.writeFileSync(PIDFILE, String(process.pid));
        process.on("exit", () => {
            if (fs.existsSync(PIDFILE) && fs.readFileSync(PIDFILE, "utf8") === String(process.pid)) fs.rmSync(PIDFILE, { force: true });
        });
    }
    log(`bench-all ${dry ? "dry run" : "started as pid " + process.pid}; harness ${HARNESS}, ${PLAN.runs} scored runs per cell`);

    const starts = new Map();
    let harnessChecked = false;
    for (;;) {
        const missing = missingCells(readRows(), PLAN, HARNESS);
        if (missing.length === 0) break;
        if (dry) {
            for (const c of missing) log(`${c.case} ${c.variant}: would run ${c.need}`);
            return 0;
        }
        const cell = missing.find((c) => (starts.get(`${c.case} ${c.variant}`) ?? 0) < MAX_STARTS);
        if (!cell) {
            for (const c of missing) log(`${c.case} ${c.variant}: GAVE UP after ${MAX_STARTS} starts; still missing ${c.need}`);
            break;
        }
        if (!harnessChecked) {
            const check = harnessCheck(serverHarness(), HARNESS);
            if (!check.ok) stop(check.message);
            harnessChecked = true;
        }
        const label = `${cell.case} ${cell.variant}`;
        const n = (starts.get(label) ?? 0) + 1;
        starts.set(label, n);
        log(`${label}: start ${n} of at most ${MAX_STARTS}, ${cell.need} scored run(s) missing`);
        if (cell.variant === "council") await startCouncil(cell, label);
        else await startBrainstorm(cell, label);

        const rows = readRows().filter((r) => r.case === cell.case && r.variant === cell.variant && r.harness === HARNESS);
        const bad = rows.filter((r) => r.state !== "done");
        log(`${label}: ${rows.length - bad.length} scored${bad.length ? `, ${bad.length} not scored (${bad.map((r) => r.state).join(", ")})` : ""}`);
    }

    const left = missingCells(readRows(), PLAN, HARNESS);
    if (left.length === 0) log(`every cell has its ${PLAN.runs} scored runs`);
    if (dry) return 0;
    const res = spawnSync(WSH, ["council", "bench", "results"], { encoding: "utf8", maxBuffer: 1 << 28 });
    fs.writeFileSync(FINAL, (res.stdout ?? "") + (res.stderr ?? ""));
    log(left.length ? `DONE WITH GAPS (${left.map((c) => `${c.case} ${c.variant} ${c.need}`).join(", ")}): the table is in ${FINAL}` : `ALL DONE: the table is in ${FINAL}`);
    return left.length ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        process.exitCode = await main(process.argv.slice(2));
    } catch (err) {
        console.error(err.stack ?? err.message);
        process.exitCode = 1;
    }
}
