// kael1113-final: the final stage's scenario for the 2026-11-13 Kael sync (docs/superpowers/plans/
// 2026-11-13-kael-sync-engine-runviews-rpc.md, Task 15). Task 1 created it empty and registered it in scenarios.mjs. kits is
// scenarios.mjs's KAEL_KITS plus `run`: RUN_KIT, the dag seeding helpers; the fixture-run helpers are kits.jarvis's.
//
// `kael1113-final-stage`, on a fixture lead nested under an orchestrator run with three independent noop tasks (t-1 dispatches a
// real worker that does nothing and is the engine's; t-2 and t-3 are seeded). A run's events cannot be written through an RPC,
// so the page is handed `run:event`s the way the engine's reach it (`publish`), and the stored dag is seeded into the state a
// step is about (`seed`: a seeded dag proves how the cockpit draws that state, not what the engine does with it). The engine's
// digest is patched on the page for the merge gate (the engine port that writes `mergeheldby` is another task's).
//   1. a run whose final stage never started and was cancelled after an earlier round failed at Verify: the node reads 'did not
//      run · run cancelled' and an Earlier rounds line opens that round's failure detail (362ec28e7); a later seed gives round 2
//      one shot and a step of 211 ms: it reads '<1s' (cff274e28), the screenshots link opens the viewer, and its round 1 says
//      where it ended in place of 'No screenshots' (362ec28e7)
//   2. in the stage's pane the Verifier step is a button that opens the verifier's ended transcript, where its tab is gone
//      (cff274e28)
//   3. a held merge tip (t-2 behind t-3's failed Verify): the Jarvis Runs row and the DAG peek read the gate's line, and a failed
//      stage's pane says what the run's lead does with it (9f9b2f3e9)
//   4. a done task's peek carries its whole review note clamped with a toggle, the time it worked, and a Verify tail with no escape
//      codes; the Escalate picker of a failed task asks for a model (1c535bc98)
//   5. the recovery line of a failed task counts the engine's retries only, not the human's (932d4fa34)
// Every click is the DOM's own, so the page's listeners are what run.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const WIDE = { width: 1600, height: 950, deviceScaleFactor: 1, mobile: false };
const ESCAPE = { code: "Escape", vk: 27 };

const LEAD = "k1113 final lead";
const RAIL_VISIBLE_KEY = "agent.rail.visible";
const RAIL_SECTIONS_KEY = "cockpit.rail.sections";
const TREE_COLLAPSED_KEY = "agent.tree.collapsed";

const TASKS = [
    { id: "t-1", label: "noop", description: "do nothing, stop immediately", deps: [], gate: false, state: "" },
    { id: "t-2", label: "noop 2", description: "do nothing, stop immediately", deps: [], gate: false, state: "" },
    { id: "t-3", label: "noop 3", description: "do nothing, stop immediately", deps: [], gate: false, state: "" },
];

const CHECK = "go build ./cmd/wsh/...";
const VERIFY = "node scripts/verify.mjs ./pkg/orchestrate";
const FINAL_CMD = "node scripts/cdp/final-verify.mjs surface-smoke";
const VERIFY_DETAIL = `Verify \`${VERIFY}\` failed on the merged result (exit 1):\nFAIL pkg/orchestrate TestMergeLane`;
const SUB_SECOND_MS = 211;
const GATE_LINE = "merge ready · waits on t-3's failed Verify";
const ENDED_BANNER = "Session ended · read-only transcript";
// what a review note carries past the three lines the peek shows
const REVIEW_NOTE = ["the lane reads clean", "line two of the note", "line three of the note", "line four of the note", "line five of the note", "line six of the note"].join("\n");
const ANSI_OUTPUT = "\x1b[2m > \x1b[22mok pkg/orchestrate\x1b[32m ✓\x1b[39m";

const MODAL = `document.querySelector("[data-dag-modal-kind]")`;
const OPEN_DAG = `document.querySelector("[data-run-sheet] [data-run-sheet-open-dag]")`;
const FINAL_NODE = `${MODAL}?.querySelector('[data-dag-node="final"]')`;
const FINAL_PEEK = `${MODAL}?.querySelector("[data-dag-final-peek]")`;
const TASK_NODE = (id) => `${MODAL}?.querySelector('[data-dag-node="${id}"]')`;
const TASK_PEEK = (id) => `${MODAL}?.querySelector('[data-dag-task-peek="${id}"]')`;
const TREE = `document.querySelector("[data-agent-tree]")`;
const FINAL_ROW = `${TREE}?.querySelector("[data-final-row]")`;
const FINAL_PANE = `document.querySelector("[data-final-pane]")`;
const DONE_FOLD = `[...(${TREE}?.querySelectorAll("div.cursor-pointer") ?? [])].find((d) => /^\\d+ (done|reviews?)/.test(d.textContent.trim()))`;
const VIEWER = `document.querySelector("[data-final-shots-viewer]")`;
const SHEET_ROW = (id) => `document.querySelector('[data-run-sheet] [data-run-sheet-row="${id}"]')`;

const LIB = `const flat = (el) => (el?.innerText ?? el?.textContent ?? "").replace(/\\s+/g, " ").trim();
    const steps = (root) => [...(root?.querySelectorAll("[data-final-step]") ?? [])].map((s) => ({
        key: s.getAttribute("data-final-step"),
        state: s.getAttribute("data-final-step-state"),
        text: flat(s),
    }));`;

// the final node and its peek: the node's words, the steps with their times, each earlier round and the detail opened
const READ_FINAL = `(() => {
    ${LIB}
    const peek = ${FINAL_PEEK};
    const node = ${FINAL_NODE};
    if (!node) return null;
    return {
        node: flat(node),
        peek: peek != null,
        steps: steps(peek),
        past: [...(peek?.querySelectorAll("[data-final-past-round]") ?? [])].map((p) => ({
            round: p.getAttribute("data-final-past-round"),
            text: flat(p.querySelector("span.tabular-nums")),
            expanded: p.getAttribute("aria-expanded"),
            shots: p.parentElement?.querySelector("[data-final-past-round-shots]") != null,
        })),
        detail: flat(peek?.querySelector("[data-final-past-round-detail]")) || null,
        shotsLink: peek?.querySelector("[data-final-shots-link]") != null,
    };
})()`;

// the shots viewer is portaled to body: its round buttons and the empty state it shows
const READ_VIEWER = `(() => {
    ${LIB}
    const v = ${VIEWER};
    if (!v) return null;
    return {
        rounds: [...v.querySelectorAll('[role="group"][aria-label="Round"] button')].map((b) => ({
            text: flat(b),
            on: b.getAttribute("aria-pressed") === "true",
        })),
        empty: flat(v.querySelector("[data-final-shots-empty]")) || null,
    };
})()`;

// the stage's pane in the Agent surface: its steps, the Verifier's role, the note under a failed stage
const READ_PANE = `(() => {
    ${LIB}
    const pane = ${FINAL_PANE};
    if (!pane) return null;
    return {
        steps: steps(pane),
        verifierRole: pane.querySelector('[data-final-step="verifier"]')?.getAttribute("role") ?? null,
        note: flat(pane.querySelector("[data-final-note]")) || null,
    };
})()`;

// a task's peek card: the rows, the review note's clamp, the time it worked and the Verify tail
const READ_TASK_PEEK = (id) => `(() => {
    ${LIB}
    const peek = ${TASK_PEEK(id)};
    if (!peek) return null;
    const note = peek.querySelector("[data-peek-review-note]");
    const toggle = peek.querySelector("[data-peek-review-toggle]");
    return {
        text: flat(peek),
        note: note ? note.textContent : null,
        noteClamped: note ? /line-clamp-3/.test(note.className) : null,
        toggle: toggle ? { text: flat(toggle), expanded: toggle.getAttribute("aria-expanded") } : null,
        activity: flat(peek.querySelector("[data-peek-activity]")) || null,
        tail: peek.querySelector("[data-peek-verify-tail]")?.textContent ?? null,
        merge: peek.querySelector('[data-dag-peek-action="merge"]') != null,
    };
})()`;

// a task row of the run sheet: the second line it draws
const READ_SHEET_ROW = (id) => `(() => {
    const row = ${SHEET_ROW(id)};
    if (!row) return null;
    const spans = [...(row.children[1]?.querySelectorAll("span") ?? [])];
    return { meta: spans[1]?.textContent.trim() ?? null, state: row.children[2]?.firstElementChild?.textContent.trim() ?? null };
})()`;

const RESTORE_STUB = `(() => {
    const s = window.__k1113FinalStub;
    if (!s) return "absent";
    s.restore();
    return "restored";
})()`;

// a real key through CDP: the page's listeners hear it as they hear a person's
async function press(h, key, { code = key, vk = 0 } = {}) {
    for (const type of ["keyDown", "keyUp"]) {
        await h.cdp("Input.dispatchKeyEvent", { type, key, code, windowsVirtualKeyCode: vk });
    }
}

// Hands the page `run:event`s as the engine's would be: [kind, detail, age in ms], stamped that long before now. The page
// appends each to the run's list; the list's first load replaces it, so a step publishes again until what it reads shows.
async function publish(h, ctx, tag, events) {
    const now = Date.now();
    for (const [i, [kind, detail, ageMs]] of events.entries()) {
        const event = {
            id: `k1113f-${tag}-${i}`,
            runid: ctx.runId,
            channelid: ctx.channelId,
            ts: now - ageMs,
            kind,
            detail: JSON.stringify(detail),
        };
        await h.rpc("eventpublish", {
            event: "run:event",
            scopes: [`run:${ctx.runId}`],
            data: { channelid: ctx.channelId, runid: ctx.runId, event },
        });
    }
}

// Puts a function of the page's own RpcApi.DagStatusCommand in its place; the module url is the one the app loaded, so the
// import is its instance. `wrapperSrc` is the source of (call, state, args) => promise.
async function stubDagStatus(h, wrapperSrc) {
    return h.ev(`(async () => {
        const hits = performance.getEntriesByType("resource").map((e) => e.name).filter((n) => /\\/wshclientapi\\.ts(\\?|$)/.test(n));
        const url = hits[hits.length - 1];
        if (!url) return { ok: false, why: "no wshclientapi module in the page's resources" };
        const { RpcApi } = await import(url);
        if (!RpcApi || typeof RpcApi.DagStatusCommand !== "function") return { ok: false, why: "no RpcApi.DagStatusCommand at " + url };
        if (window.__k1113FinalStub) window.__k1113FinalStub.restore();
        const orig = RpcApi.DagStatusCommand;
        const state = { calls: 0 };
        const wrap = (${wrapperSrc});
        RpcApi.DagStatusCommand = function (...args) {
            return wrap(orig.bind(RpcApi), state, args);
        };
        window.__k1113FinalStub = {
            state,
            restore() {
                RpcApi.DagStatusCommand = orig;
                delete window.__k1113FinalStub;
            },
        };
        return { ok: true, url };
    })()`);
}

const restoreKey = (key, prev) =>
    prev == null ? `localStorage.removeItem(${JSON.stringify(key)})` : `localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(prev)})`;

export default function (kits) {
    const { arrangeFixtureRun, waitForDispatch, teardownFixtureRun, polishWaitFor, polishNap, waveService } = kits.jarvis;
    const { seedDag, fstWriteRun } = kits.run;

    const stageSig = (f) => (f ? [f.state, f.round, f.verifierrunid ?? "", (f.shots ?? []).length, (f.detail ?? "").length] : null);
    // what a seed must hold: the final stage and the earlier rounds, the tasks but t-1 (the engine's), the status when asked
    const dagPrint = (withStatus) => (dag) =>
        JSON.stringify([
            withStatus ? (dag?.status ?? "") : "",
            stageSig(dag?.final),
            (dag?.pastfinals ?? []).map(stageSig),
            (dag?.tasks ?? []).filter((t) => t.id !== "t-1").map((t) => [t.id, t.state, t.reviewverdict ?? "", t.verifyoutput ? 1 : 0]),
        ]);

    // Seeds the stored dag: `change` maps the dag as read to the dag to write. The engine's tick holds the dag lock for seconds
    // while it spawns t-1's worker and then writes the dag it read first, over a seed that landed meanwhile, so the seed is
    // read back after a pause and written again until it has stayed.
    // The tick can land over the seed later too, once a step has read it, so the seed also leaves `keeper`: what `until` runs
    // between its looks to write the seed again once the stored dag has lost it.
    let keeper = null;
    async function seed(h, ctx, change, { status = false } = {}) {
        const print = dagPrint(status);
        let want = null;
        const write = () =>
            seedDag(
                h,
                ctx,
                (dag) => {
                    const next = change(dag);
                    want = print(next);
                    return next;
                },
                print
            );
        keeper = async () => {
            const stored = await waveService(h, "object", "GetObject", [`dag:${ctx.dagId}`]);
            if (print(stored) !== want) await write();
        };
        for (let round = 0; round < 4; round++) {
            await write();
            await polishNap(2500);
            const stored = await waveService(h, "object", "GetObject", [`dag:${ctx.dagId}`]);
            if (print(stored) === want) return;
        }
        throw new Error(`the dag did not keep its seed: want ${want}`);
    }

    // the dag's commands, the earlier rounds (round 1 failed at Verify with no shots, unless a step gives none) and the fields a
    // step adds; `final` is left out unless given
    const ROUND_1 = { state: "failed", round: 1, detail: VERIFY_DETAIL };
    const stages =
        ({ status, final, past = [ROUND_1], edits = {} }) =>
        (dag) => {
            const { final: _final, pastfinals: _past, ...rest } = dag;
            return {
                ...rest,
                ...(status ? { status } : {}),
                check: CHECK,
                verify: VERIFY,
                finalcmd: FINAL_CMD,
                ...(final ? { final } : {}),
                pastfinals: past,
                tasks: dag.tasks.map((t) => (edits[t.id] ? { ...t, ...edits[t.id] } : t)),
            };
        };
    const passedRound2 = (ctx) => ({
        state: "passed",
        round: 2,
        startedts: Date.now() - 20 * 60_000,
        verifierrunid: ctx.verifierRunId,
        outdir: `${ctx.cwd.replace(/\\/g, "/")}/final-shots/2`,
        shots: [{ name: "surface-smoke", files: ["surface-smoke.png"] }],
    });
    // round 2's step events: Tree ran 211 ms
    const round2Steps = [
        ["final-step", { round: 2, step: "tree", ms: SUB_SECOND_MS, ok: true }, 0],
        ["final-step", { round: 2, step: "check", ms: 41_000, ok: true }, 0],
        ["final-step", { round: 2, step: "verify", ms: 431_000, ok: true }, 0],
        ["final-step", { round: 2, step: "final", ms: 188_000, ok: true }, 0],
    ];

    // polls expr until ok holds; on every fourth look it writes the seed again if the tick took it and runs `again` (a step's
    // events published once more: an event published before the run's history loaded is replaced by that load)
    async function until(h, expr, ok, again, ms = 12_000) {
        let last = null;
        for (let i = 0; i * 250 < ms; i++) {
            last = await h.ev(expr).catch(() => null);
            if (last != null && ok(last)) return last;
            if (i % 4 === 3) {
                await keeper?.();
                await again?.();
            }
            await polishNap(250);
        }
        return last;
    }

    // a path through the Jarvis surface to the run's sheet and from it to the DAG; true once the graph shows its cards
    async function openDag(h, ctx) {
        await h.goto("jarvis");
        await polishWaitFor(h, `typeof window.__openAddress === "function"`, 8000);
        await h.ev(`window.__openAddress(${JSON.stringify(`run:${ctx.runId}`)})`);
        const dock = await polishWaitFor(h, `!!${OPEN_DAG}`, 15_000);
        if (!dock) return false;
        if (!(await h.ev(`${MODAL} != null`))) await h.ev(`${OPEN_DAG}.click()`);
        return polishWaitFor(h, `${MODAL}?.querySelectorAll("[data-dag-node]").length >= 4`, 12_000);
    }

    // the sheet alone, the modal closed
    async function openSheet(h, ctx) {
        await h.goto("jarvis");
        await polishWaitFor(h, `typeof window.__openAddress === "function"`, 8000);
        await h.ev(`window.__openAddress(${JSON.stringify(`run:${ctx.runId}`)})`);
        return polishWaitFor(h, `!!document.querySelector("[data-run-sheet-rows]")`, 15_000);
    }

    // Escape until the modal is gone: a selection takes the first press
    async function closeDag(h) {
        for (let i = 0; i < 5 && (await h.ev(`!!${MODAL}`)); i++) {
            await press(h, "Escape", ESCAPE);
            await polishNap(400);
        }
        return polishWaitFor(h, `!${MODAL}`, 3000);
    }

    // selects a node of the open graph and waits for its peek
    async function selectNode(h, nodeExpr, peekExpr) {
        await h.ev(`(() => { const n = ${nodeExpr}; if (n && n.getAttribute("aria-pressed") !== "true") n.click(); })()`);
        return polishWaitFor(h, `!!${peekExpr}`, 8000);
    }

    // the stage's row in the Agent tree, clicked; true once the pane is on screen
    async function openPane(h) {
        await h.goto("agent");
        // a passed stage's row sits under the run's "N done" fold, which the tree draws closed
        await polishWaitFor(h, `!!${FINAL_ROW} || !!${DONE_FOLD}`, 20_000);
        if (await h.ev(`${FINAL_ROW} == null && ${DONE_FOLD} != null`)) await h.ev(`${DONE_FOLD}.click()`);
        if (!(await polishWaitFor(h, `!!${FINAL_ROW}`, 10_000))) return false;
        await h.ev(`${FINAL_ROW}.click()`);
        return polishWaitFor(h, `!!${FINAL_PANE}`, 8000);
    }

    // the lead's row once its run has nested it; clicked, so the Agent surface shows the run
    async function focusLead(h, ctx) {
        await h.ev(`localStorage.setItem(${JSON.stringify(RAIL_VISIBLE_KEY)}, "true")`);
        await h.ev(`localStorage.removeItem(${JSON.stringify(RAIL_SECTIONS_KEY)})`);
        await h.ev(`localStorage.removeItem(${JSON.stringify(TREE_COLLAPSED_KEY)})`);
        await h.ev("location.reload()");
        await polishWaitFor(h, `!!window.TabRpcClient && !!document.querySelector("nav button")`, 30_000);
        await h.goto("agent");
        ctx.leadFocused = await h.ev(`(async () => {
            const leadRow = () => {
                const tree = ${TREE};
                const name = tree && [...tree.querySelectorAll("*")].find((d) => d.textContent.trim() === ${JSON.stringify(LEAD)} && d.children.length === 0);
                return name ? name.closest("[data-agent-row]") : null;
            };
            for (let i = 0; i < 40; i++) {
                const row = leadRow();
                if (row && row.firstElementChild?.firstElementChild?.tagName.toLowerCase() === "svg") {
                    row.click();
                    return true;
                }
                await new Promise((r) => setTimeout(r, 250));
            }
            return false;
        })()`);
        await polishNap(1200);
    }

    const finalStage = {
        name: "kael1113-final-stage",
        surface: "agent",
        async arrange(h) {
            await h.cdp("Emulation.setDeviceMetricsOverride", WIDE);
            const ctx = {
                cwd: mkdtempSync(join(tmpdir(), "verify-kael1113-final-")),
                prevRail: await h.ev(`localStorage.getItem(${JSON.stringify(RAIL_VISIBLE_KEY)})`),
                prevSections: await h.ev(`localStorage.getItem(${JSON.stringify(RAIL_SECTIONS_KEY)})`),
                prevCollapsed: await h.ev(`localStorage.getItem(${JSON.stringify(TREE_COLLAPSED_KEY)})`),
            };
            // a throw past this point still returns ctx, so teardown removes whatever was already made
            try {
                await arrangeFixtureRun(h, ctx, "kael1113-final", LEAD);
                await h.rpc("dagsubmit", {
                    channelid: ctx.channelId,
                    runid: ctx.runId,
                    title: "verify kael1113 final",
                    parallelism: 1,
                    tasks: TASKS,
                });
                await waitForDispatch(h, ctx, "t-1");
                ctx.dagId = (await h.rpc("dagstatus", { channelid: ctx.channelId, runid: ctx.runId })).group.id;
                // the verifier's session is seeded, never spawned: a deferred quick run that carries the stage's role
                const wslist = await h.rpc("workspacelist", null);
                const created = await h.rpc("createrun", {
                    channelid: ctx.channelId,
                    workspaceid: wslist[0].workspacedata.oid,
                    goal: "verify kael1113 final: the verifier's seeded run",
                    runtime: "claude",
                    mode: "quick",
                    deferstart: true,
                });
                ctx.verifierRunId = created.run.id;
                await fstWriteRun(h, ctx.verifierRunId, (run) => ({ ...run, stagerole: "verifier", dagoref: ctx.dagId }));
                await focusLead(h, ctx);
            } catch (e) {
                ctx.arrangeError = String(e?.message ?? e);
            }
            return ctx;
        },
        async assert(h, ctx) {
            const steps = [];
            const rec = (step, ok, detail) => steps.push({ step, ok: !!ok, detail: JSON.stringify(detail) });
            rec(
                "0. the lead row nested under its run and was focused, and t-1 dispatched",
                ctx.arrangeError == null && ctx.leadFocused === true && ctx.dispatched === true && !!ctx.verifierRunId,
                ctx.arrangeError ?? { runId: ctx.runId, leadFocused: ctx.leadFocused, dispatched: ctx.dispatched, verifier: ctx.verifierRunId }
            );
            if (ctx.arrangeError != null || ctx.leadFocused !== true) return steps;

            // 1a. the stage never started and the run was cancelled; round 1 failed at Verify
            await seed(h, ctx, stages({ status: "cancelled" }), { status: true });
            const opened1 = await openDag(h, ctx);
            const selected1 = opened1 && (await selectNode(h, FINAL_NODE, FINAL_PEEK));
            const cancelled = selected1 ? await until(h, READ_FINAL, (s) => s.past.length === 1) : null;
            let detailOpen = null;
            if (cancelled?.past?.length === 1) {
                await h.ev(`${FINAL_PEEK}?.querySelector('[data-final-past-round="1"]')?.click()`);
                detailOpen = await until(h, READ_FINAL, (s) => s.detail != null, null, 4000);
            }
            await h.shot("cdp-shots/kael1113-final-stage-1a-cancelled.png");
            rec(
                "1a. a cancelled dag whose stage never started reads 'did not run · run cancelled' on the node, and an earlier round's line opens its failure detail, with no screenshots link on it",
                selected1 &&
                    cancelled?.node?.includes("did not run · run cancelled") &&
                    cancelled.past[0].round === "1" &&
                    cancelled.past[0].text === "round 1 · failed at Verify" &&
                    cancelled.past[0].shots === false &&
                    detailOpen?.past?.[0]?.expanded === "true" &&
                    detailOpen.detail?.includes("FAIL pkg/orchestrate TestMergeLane"),
                { opened1, selected1, cancelled, detailOpen }
            );

            // 1b. round 2 passed with one shot and a step of 211 ms; round 1 kept none
            await seed(h, ctx, stages({ status: "cancelled", final: passedRound2(ctx) }), { status: true });
            const again = () => publish(h, ctx, "r2", round2Steps);
            await again();
            const withSteps = await until(
                h,
                READ_FINAL,
                (s) => s.steps.find((st) => st.key === "tree")?.text.includes("passed <1s") && s.shotsLink,
                again
            );
            let viewer = null;
            if (withSteps?.shotsLink) {
                await h.ev(`${FINAL_PEEK}?.querySelector("[data-final-shots-link]")?.click()`);
                await polishWaitFor(h, `!!${VIEWER}`, 8000);
                await h.ev(`[...${VIEWER}.querySelectorAll('[role="group"][aria-label="Round"] button')].find((b) => /^Round 1/.test(b.textContent.trim()))?.click()`);
                viewer = await until(h, READ_VIEWER, (v) => v.empty != null, null, 5000);
                await h.shot("cdp-shots/kael1113-final-stage-1b-empty-round.png");
                await press(h, "Escape", ESCAPE);
                await polishWaitFor(h, `!${VIEWER}`, 4000);
            }
            const tree = withSteps?.steps?.find((st) => st.key === "tree");
            rec(
                "1b. a step that ran 211 ms reads <1s with the steps around it keeping their times, and a round that ended at Verify says so in the viewer in place of 'No screenshots'",
                tree?.text.includes("passed <1s") &&
                    withSteps.steps.find((st) => st.key === "check")?.text.includes("41s") &&
                    withSteps.steps.find((st) => st.key === "verify")?.text.includes("7m 11s") &&
                    viewer?.rounds?.length === 2 &&
                    viewer.empty === "Round 1 ended at Verify, before the Final command ran.",
                { withSteps, viewer }
            );
            await closeDag(h);

            // 2. the stage's pane: its Verifier step opens the verifier's ended transcript
            await seed(h, ctx, stages({ status: "running", final: passedRound2(ctx) }), { status: true });
            const paneOpen = await openPane(h);
            const pane = paneOpen ? await until(h, READ_PANE, (p) => p.steps.find((st) => st.key === "tree")?.text.includes("passed <1s"), again) : null;
            await h.shot("cdp-shots/kael1113-final-stage-2-pane.png");
            if (pane?.verifierRole === "button") {
                await h.ev(`${FINAL_PANE}?.querySelector('[data-final-step="verifier"]')?.click()`);
            }
            const transcript = await until(
                h,
                `(() => ({ pane: ${FINAL_PANE} != null, ended: document.body.innerText.includes(${JSON.stringify(ENDED_BANNER)}) }))()`,
                (s) => !s.pane && s.ended,
                null,
                8000
            );
            await h.shot("cdp-shots/kael1113-final-stage-2-transcript.png");
            rec(
                "2. a passed stage's pane reads a 211 ms step as <1s, its Verifier step is a button, and a click opens the verifier's ended transcript in place of the pane",
                paneOpen && pane?.steps?.find((st) => st.key === "tree")?.text.includes("passed <1s") && pane.verifierRole === "button" && transcript?.pane === false && transcript.ended === true,
                { paneOpen, pane, transcript }
            );

            // 3. t-2 done behind t-3's failed Verify: the digest holds its merge, as the engine's will (page-only)
            const stub = await stubDagStatus(
                h,
                `async (call, state, args) => {
                    const rtn = await call(...args);
                    state.calls++;
                    const d = rtn?.digest;
                    if (!d) return rtn;
                    const tasks = [...(d.tasks ?? [])];
                    const i = tasks.findIndex((t) => t.taskid === "t-2");
                    const held = { ...(i >= 0 ? tasks[i] : { taskid: "t-2" }), mergestate: "held", mergeheldby: "t-3" };
                    if (i >= 0) tasks[i] = held;
                    else tasks.push(held);
                    return { ...rtn, digest: { ...d, tasks } };
                }`
            );
            const failedStage = { state: "failed", round: 1, detail: VERIFY_DETAIL };
            await seed(
                h,
                ctx,
                stages({
                    status: "running",
                    final: failedStage,
                    past: [],
                    edits: { "t-2": { state: "done" }, "t-3": { state: "verify-failed", attempts: 1, verifyerror: "exit 1: ✔ adds two numbers\n✔ handles zero" } },
                }),
                { status: true }
            );
            // child-ask-cleared is a kind the digest is reloaded on, and it changes no dag version
            const reload = () => publish(h, ctx, "digest", [["child-ask-cleared", { taskid: "t-2" }, 0]]);
            await reload();
            const sheetOpen = await openSheet(h, ctx);
            const row = sheetOpen ? await until(h, READ_SHEET_ROW("t-2"), (r) => r.meta === GATE_LINE, reload) : null;
            const failedRow = sheetOpen ? await until(h, READ_SHEET_ROW("t-3"), (r) => r.state === "verify-failed", reload, 6000) : null;
            await h.shot("cdp-shots/kael1113-final-stage-3-run-row.png");
            const opened3 = await openDag(h, ctx);
            const peeked = opened3 && (await selectNode(h, TASK_NODE("t-2"), TASK_PEEK("t-2")));
            const gatePeek = peeked ? await until(h, READ_TASK_PEEK("t-2"), (p) => p.text.includes(GATE_LINE), reload, 8000) : null;
            await h.shot("cdp-shots/kael1113-final-stage-3-peek.png");
            await closeDag(h);
            const paneFailed = await openPane(h);
            const note = paneFailed ? await until(h, READ_PANE, (p) => p.note != null) : null;
            await h.shot("cdp-shots/kael1113-final-stage-3-pane.png");
            rec(
                "3. a held tip reads 'merge ready · waits on t-3's failed Verify' in the Jarvis Runs row and the DAG peek, a failed Verify's row shows its reason (never a passing test's line), and a failed stage's pane says what the run's lead does with it",
                stub?.ok === true &&
                    row?.meta === GATE_LINE &&
                    row.state === "done" &&
                    failedRow?.meta === "exit 1" &&
                    gatePeek?.text.includes(GATE_LINE) &&
                    paneFailed &&
                    typeof note?.note === "string" &&
                    note.note.startsWith("The lead") &&
                    !note.note.includes("This failure is yours"),
                { stub, row, failedRow, gatePeek: gatePeek && { text: gatePeek.text, merge: gatePeek.merge }, note }
            );
            await h.ev(RESTORE_STUB);

            // 4. t-2 done with a review note, the time it worked and a Verify tail with escape codes; t-3 failed
            const now = Date.now();
            await seed(
                h,
                ctx,
                stages({
                    status: "running",
                    edits: {
                        "t-2": {
                            state: "done",
                            merged: true,
                            reviewverdict: "pass",
                            reviewnote: REVIEW_NOTE,
                            firstactivity: now - 40 * 60_000,
                            lastactivity: now - 32 * 60_000,
                            verifystartedts: now - 31 * 60_000,
                            verifyoutput: ANSI_OUTPUT,
                        },
                        "t-3": { state: "failed", attempts: 3, lastfailurekind: "verify" },
                    },
                }),
                { status: true }
            );
            const opened4 = await openDag(h, ctx);
            const peeked4 = opened4 && (await selectNode(h, TASK_NODE("t-2"), TASK_PEEK("t-2")));
            const peek4 = peeked4 ? await until(h, READ_TASK_PEEK("t-2"), (p) => p.note != null && p.toggle != null && p.tail != null) : null;
            let expanded = null;
            if (peek4?.toggle) {
                await h.ev(`${TASK_PEEK("t-2")}?.querySelector("[data-peek-review-toggle]")?.click()`);
                expanded = await until(h, READ_TASK_PEEK("t-2"), (p) => p.toggle?.expanded === "true", null, 4000);
            }
            await h.shot("cdp-shots/kael1113-final-stage-4-task-peek.png");
            const peeked3 = opened4 && (await selectNode(h, TASK_NODE("t-3"), TASK_PEEK("t-3")));
            let picker = null;
            if (peeked3) {
                // the engine's digest offers a failed task retry, skip and escalate once it has read the seed
                await polishWaitFor(h, `!!${TASK_PEEK("t-3")}?.querySelector('[data-dag-peek-action="escalate"]')`, 12_000);
                await h.ev(`${TASK_PEEK("t-3")}?.querySelector('[data-dag-peek-action="escalate"]')?.click()`);
                picker = await until(h, `(() => { const el = ${MODAL}?.querySelector("[data-route-picker-empty]"); return el ? { text: el.textContent.trim() } : null; })()`, (p) => p.text !== "", null, 5000);
            }
            await h.shot("cdp-shots/kael1113-final-stage-4-escalate.png");
            await closeDag(h);
            rec(
                "4. a done task's peek holds its whole review note clamped to three lines with a toggle, 'worked 8m', and a Verify tail with no escape codes; a failed task's Escalate picker reads 'Pick a model'",
                peek4?.note?.startsWith("review pass: the lane reads clean") &&
                    peek4.note.includes("line six of the note") &&
                    peek4.noteClamped === true &&
                    peek4.toggle?.text === "Show the whole note" &&
                    expanded?.toggle?.text === "Show less" &&
                    expanded.noteClamped === false &&
                    peek4.activity === "worked 8m" &&
                    peek4.tail === "> ok pkg/orchestrate ✓" &&
                    !peek4.tail.includes("\u001b") &&
                    picker?.text === "Pick a model",
                { peek4, expanded, picker }
            );

            // 5. t-3 failed after two retries of the engine's and one of the human's
            const retries = [
                ["task-retried", { taskid: "t-3", kind: "verify", attempt: 1 }, 300_000],
                ["task-retried", { taskid: "t-3", kind: "verify", attempt: 2 }, 240_000],
                ["task-retried", { taskid: "t-3", auto: false, by: "human" }, 120_000],
                ["task-failed", { taskid: "t-3", runid: "child", lastfailurekind: "verify", attempts: 3 }, 60_000],
            ];
            const retried = () => publish(h, ctx, "retries", retries);
            await retried();
            const sheet5 = await openSheet(h, ctx);
            await retried();
            const recovery = sheet5 ? await until(h, READ_SHEET_ROW("t-3"), (r) => /^Retried/.test(r.meta ?? ""), retried) : null;
            await h.shot("cdp-shots/kael1113-final-stage-5-recovery.png");
            rec(
                "5. a failed task's recovery line counts the engine's two retries and not the human's",
                sheet5 && recovery?.meta === "Retried 2 times · verify · now failed",
                { sheet5, recovery }
            );
            return steps;
        },
        async teardown(h, ctx) {
            await teardownFixtureRun(h, ctx, "kael1113-final-stage", {
                what: "restore RpcApi.DagStatusCommand, the rail's and the tree's keys and the viewport",
                fn: async () => {
                    await h.ev(RESTORE_STUB);
                    await h.ev(restoreKey(RAIL_VISIBLE_KEY, ctx.prevRail));
                    await h.ev(restoreKey(RAIL_SECTIONS_KEY, ctx.prevSections));
                    await h.ev(restoreKey(TREE_COLLAPSED_KEY, ctx.prevCollapsed));
                    await h.cdp("Emulation.clearDeviceMetricsOverride", {});
                },
            });
        },
    };

    return [finalStage];
}
