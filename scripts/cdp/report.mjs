// Pure result formatting for the verification runner. No CDP/DOM/browser deps, so it is unit-testable
// without a live app. A scenario result is { name, steps: [{ step, ok, skip?, detail? }], error? }.
//
// A step carrying `skip` is one whose precondition this dev profile does not meet — no scan report to cite,
// no pi session focused. It is a third state on purpose: scoring it a pass counts an assertion that never
// ran toward the tally, and scoring it a failure leaves a row that is red on every run, which teaches the
// reader to skim past the table the suite exists to make readable.
//
// makeRunReporter, at the end, is the one part that touches the outside: it hands each run to wavesrv through `wsh verify
// report`, so the agent's rail can show the result. Everything else here stays pure.
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

// The exit code verify.mjs gives when the page never finished loading, so no scenario could run. It is the Final
// contract's "could not verify" (pkg/jarvis/plan.go PlanFormat), not a failure: nothing of the app was tried.
export const EXIT_UNVERIFIED = 3;
// A freshly started app answers CDP before its first render, and a cold vite holds the entry's module graph while it
// pre-bundles: past 2.5 min on 2026-10-14, beyond the old 120s deadline, with readyState already "complete". So the
// render deadline starts once the app's own code has started (frontend/tauri/bootmark.ts). An app that started and
// never renders, or a boot error, is a real failure; an app whose code never started is unverified.
export const RENDER_WAIT_MS = 120_000;
export const LOAD_WAIT_MS = 600_000;

// What the wait for the first render decides: "wait", "rendered", "boot-error" or "not-rendered" (both fail), or
// "not-loaded" (unverified). startedAt is when main.tsx's boot was first seen running, null while the page is
// (re)loading; error is a boot error or vite's error overlay.
export function renderWait({ now, start, startedAt, rendered, error }) {
    if (rendered) return "rendered";
    if (error) return "boot-error";
    if (startedAt == null) return now - start >= LOAD_WAIT_MS ? "not-loaded" : "wait";
    return now - startedAt >= RENDER_WAIT_MS ? "not-rendered" : "wait";
}

// the names asked for that no scenario has: a typo, or a scenario a later run was meant to write. Run with the rest
// left out silently, a Final passed while the screen it was named for went unchecked (run 911b6d3a's
// chat-verdict-handoff), so the runners fail on any of these instead.
export function unknownScenarios(scenarios, names) {
    const known = new Set(scenarios.map((s) => s.name));
    return names.filter((n) => !known.has(n));
}

export function exitCode(scenarioResults) {
    const allPass = scenarioResults.every((s) => !s.error && s.steps.every((st) => st.ok || st.skip));
    return allPass ? 0 : 1;
}

export function formatResults(scenarioResults) {
    const lines = [];
    let pass = 0;
    let skipped = 0;
    let ran = 0;
    for (const s of scenarioResults) {
        lines.push(`\n# ${s.name}`);
        if (s.error) lines.push(`  ERROR: ${s.error}`);
        for (const st of s.steps) {
            if (st.skip) {
                skipped++;
            } else {
                ran++;
                if (st.ok) pass++;
            }
            lines.push(`  ${st.skip ? "SKIP" : st.ok ? "PASS" : "FAIL"}  ${st.step}`);
            if (st.detail) lines.push(`        ${st.detail}`);
        }
    }
    lines.push(`\n${pass}/${ran} steps passed${skipped > 0 ? `, ${skipped} skipped` : ""}`);
    return lines.join("\n");
}

// the paths of shots (attach.mjs's { path }) that sit under root, relative to it with forward slashes. A scenario that
// writes a fixture png elsewhere must not list it as one of its screenshots
export function shotsUnder(shots, root) {
    const files = [];
    for (const s of shots) {
        const rel = relative(resolve(root), resolve(s.path));
        if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) continue;
        files.push(rel.split(sep).join("/"));
    }
    return files;
}

// the shots.json manifest the engine reads from ARC_FINAL_OUT: one entry per scenario, its shots in the order taken
// and its steps in the order asserted. shotsByScenario maps a scenario name to png paths relative to cdp-shots/
export function shotsManifest(results, shotsByScenario) {
    return results.map((s) => {
        const steps = s.steps.map((st) => ({
            step: st.step,
            state: st.skip ? "skip" : st.ok ? "pass" : "fail",
            ...(st.detail ? { detail: st.detail } : {}),
        }));
        if (s.error) steps.push({ step: "the scenario threw", state: "fail", detail: s.error });
        return { name: s.name, files: shotsByScenario[s.name] ?? [], steps };
    });
}

// a stuck wsh (wavesrv hung) must not hold a verification run: past this the report is given up on and logged
const REPORT_TIMEOUT_MS = 10_000;

// why a finished `wsh verify report` counts as failed, or "" when it went through. A result with neither a status nor an
// error (a stand-in's) is taken as having gone through
function reportFailure(r) {
    if (!r) return "";
    if (r.error) return r.error.message ?? String(r.error);
    if (r.status === 0 || r.status === undefined) return "";
    const said = String(r.stderr ?? "").trim().split(/\r?\n/)[0];
    return `wsh exited ${r.status ?? r.signal}${said ? `: ${said}` : ""}`;
}

// Reports one run to wavesrv through `wsh verify report`, so the agent's rail can draw its Verify tile. It reports only
// inside an agent's terminal (WAVETERM_BLOCKID set; anywhere else every method does nothing), finds wsh in
// WAVETERM_WSHBINDIR or on PATH, and never fails the run: a report that does not go through is logged once, and the next
// ones are still sent. Reports carry no timestamp: wavesrv stamps them on arrival.
//
// Returns { start(names, command), scenarioDone(result, files), end(results, shotsByScenario, shotsDir), unverified(reason) }.
// A run id and a command Final passes down (ARC_VERIFY_RUNID, ARC_VERIFY_COMMAND) win over this reporter's own, so Final
// and the verify.mjs it runs report one run. The command is what the person would type to run it again.
export function makeRunReporter({ env = process.env, spawn = spawnSync, log = console.log, platform = process.platform } = {}) {
    const active = Boolean(env.WAVETERM_BLOCKID);
    const runid = env.ARC_VERIFY_RUNID || randomUUID();
    const wsh = env.WAVETERM_WSHBINDIR ? join(env.WAVETERM_WSHBINDIR, platform === "win32" ? "wsh.exe" : "wsh") : "wsh";
    let command = env.ARC_VERIFY_COMMAND || "";
    let names = [];
    // the scenarios this process has seen finish, as the manifest writes them
    const finished = new Map();
    let warned = false;

    const warn = (why) => {
        if (warned) return;
        warned = true;
        log(`verify report: ${why}`);
    };
    // build runs inside the try: a document that cannot be made (a bad argument) is a report that failed, not a crash
    const report = (build) => {
        if (!active) return;
        try {
            const doc = build();
            const r = spawn(wsh, ["verify", "report"], {
                input: JSON.stringify({ runid, phase: doc.phase, pid: process.pid, cwd: process.cwd(), command, ...doc }),
                encoding: "utf8",
                timeout: REPORT_TIMEOUT_MS,
                windowsHide: true,
            });
            const why = reportFailure(r);
            if (why) warn(why);
        } catch (e) {
            warn(e?.message ?? String(e));
        }
    };
    // every scenario named at start: those finished here with their steps and files, the rest waiting
    const scenarios = () => names.map((name) => finished.get(name) ?? { name, files: [], steps: [], done: false });

    return {
        start(list, cmd) {
            report(() => {
                names = [...list];
                command = env.ARC_VERIFY_COMMAND || cmd || command;
                return { phase: "start", scenarios: scenarios() };
            });
        },
        scenarioDone(result, files = []) {
            report(() => {
                const [entry] = shotsManifest([result], { [result.name]: files });
                finished.set(result.name, { ...entry, done: true });
                if (!names.includes(result.name)) names.push(result.name);
                return { phase: "progress", scenarios: scenarios() };
            });
        },
        end(results, shotsByScenario, shotsDir) {
            report(() => ({
                phase: "end",
                shotsdir: resolve(shotsDir),
                scenarios: shotsManifest(results, shotsByScenario).map((s) => ({ ...s, done: true })),
            }));
        },
        // the run ended with no result: the dev app never started, or nothing could be run. A scenario this process did
        // finish keeps its steps; every other one is sent with none, which wavesrv reads as no result
        unverified(reason) {
            report(() => ({ phase: "end", scenarios: scenarios(), reason }));
        },
    };
}

export function contactSheetHtml(shots, root) {
    // src is relative to the html file, which sits in root, so a shot written outside root still resolves
    const cards = shots
        .map((s) => {
            const src = relative(resolve(root), resolve(s.path)).split(sep).join("/");
            return `<figure><figcaption>${s.name}</figcaption><img src="${src}" alt="${s.name}"></figure>`;
        })
        .join("\n");
    return `<!doctype html><meta charset="utf-8"><title>verify contact sheet</title>
<style>body{background:#111;color:#eee;font:13px system-ui;margin:16px}
figure{margin:0 0 24px}figcaption{margin-bottom:6px;color:#9ab}
img{max-width:100%;border:1px solid #333}</style>
${cards}`;
}
