// kael1125-views: the run views' scenario for the 2026-11-25 Kael sync (docs/superpowers/plans/
// 2026-11-25-kael-sync-fast-track.md, Task 7). Task 1 created it empty and registered it in scenarios.mjs. kits is
// scenarios.mjs's KAEL_KITS plus `run`: RUN_KIT, the dag seeding helpers; the fixture-run helpers are kits.jarvis's.
//
// `kael1125-fast-track-views`, on a fixture lead nested under an orchestrator run with three independent noop tasks (t-1
// dispatches a real worker that does nothing and is the engine's; t-2 and t-3 are never touched). The stored dag is seeded into
// the state a step is about, as scenarios-kael1113-final.mjs seeds it (`seed`: a seed shows how the cockpit draws a state, not
// what the engine does with it). `fasttrack` stays unset and the dag's status stays running, so the engine neither starts a
// reviewer for the seeded light round nor an end reviewer for the seeded end review. The seeded dag has no Final command, so
// a stage's steps are Tree, Check, Verify, End review and Verifier.
//   1. a light round reviewing, one light reviewer lost and its replacement running: the DAG route line shows two Light review
//      chips, both on the Light reviewers route's model
//   2. an accepted plan review the lead amended: the Agent tree's plan review rows read 'amended by the lead' with the muted dot
//   3. a final stage at Verify with an end review reviewing: the stage pane lists Check, Verify, End review and Verifier, and
//      the tree row says the end review works alongside
//   4. a failed stage whose Detail is only the end review's: End review failed, Check, Verify and the Verifier passed, and the
//      tree's final row failed at End review
//   5. a pass whose end review gave an unverified note: End review unverified, the Verifier passed
//   6. a stage with no endreview: no End review step
//   7. the run's Sessions list holds the end reviewer and the amended round's plan reviewer as stage members, seeded as
//      transcripts the way a run this store never saw is placed (a Sessions row is live only when the roster holds the
//      session's tab, which a seeded session has not): the end review reads 'reviewing' while the stage records it so, then its
//      verdict word, and the plan reviewer reads 'amended by the lead'
//   8. a stage whose commands and verifier are done and which waits only on its end review: the final row and the stage
//      headline read 'end review reviewing'
// Every click is the DOM's own, so the page's listeners are what run.

import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { agentPage } from "./agent-page-fixtures.mjs";

const WIDE = { width: 1600, height: 950, deviceScaleFactor: 1, mobile: false };
const ESCAPE = { code: "Escape", vk: 27 };

const NAME = "kael1125-fast-track-views";
const LEAD = "k1125 views lead";
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
const VERIFY_DETAIL = `Verify \`${VERIFY}\` failed on the merged result (exit 1):\nFAIL pkg/orchestrate TestMergeLane`;
const FINDING = "t-2's test asserts nothing the task changed";
const UNVERIFIED_NOTE = "the e2e needs a browser";
// the Light reviewers route the seed names, so a chip's model does not depend on the app's default pick
const LIGHT_ROUTE = { runtime: "claude", model: "claude-haiku-5-5" };
const LIGHT_MODEL = "haiku-5-5";
const AMENDED = "amended by the lead";

const MODAL = `document.querySelector("[data-dag-modal-kind]")`;
const OPEN_DAG = `document.querySelector("[data-run-sheet] [data-run-sheet-open-dag]")`;
const TREE = `document.querySelector("[data-agent-tree]")`;
const FINAL_ROW = `${TREE}?.querySelector("[data-final-row]")`;
const FINAL_PANE = `document.querySelector("[data-final-pane]")`;
const DONE_FOLD = `[...(${TREE}?.querySelectorAll("div.cursor-pointer") ?? [])].find((d) => /^\\d+ (done|reviews?)/.test(d.textContent.trim()))`;
const PLAN_ROWS = `[...(${TREE}?.querySelectorAll('[data-tree-stage="plan-reviewer"]') ?? [])]`;
const MEMBERS = `document.querySelector('[data-history-detail] [role="group"][aria-label="Sessions in this run"]')`;

const LIB = `const flat = (el) => (el?.innerText ?? el?.textContent ?? "").replace(/\\s+/g, " ").trim();`;

// the DAG's route line: the plan review entry and each reviewer's chip
const READ_CHIPS = `(() => {
    ${LIB}
    const modal = ${MODAL};
    if (!modal) return null;
    return {
        entry: flat(modal.querySelector('[data-dag-stage-entry="planreview"]')),
        chips: [...modal.querySelectorAll("[data-plan-reviewer]")].map((c) => ({
            lens: c.getAttribute("data-plan-reviewer"),
            state: c.getAttribute("data-plan-reviewer-state"),
            text: flat(c),
        })),
    };
})()`;

// the Agent tree's plan reviewer rows: a row's title, its second line and whether its dot is the muted one
const READ_PLAN_ROWS = `(() => {
    ${LIB}
    return ${PLAN_ROWS}.map((r) => {
        const body = r.lastElementChild;
        return {
            title: flat(body?.children[0]),
            sub: flat(body?.children[1]),
            muted: [...r.querySelectorAll("span.rounded-full")].some((s) => /(^|\\s)bg-muted(\\s|$)/.test(s.className)),
        };
    });
})()`;

// the stage's tree row and pane: the row's tone and second line, the pane's steps and headline
const READ_FINAL = `(() => {
    ${LIB}
    const row = ${FINAL_ROW};
    const pane = ${FINAL_PANE};
    return {
        row: row ? { tone: row.getAttribute("data-final-tone"), sub: flat(row.querySelector("[data-final-sub]")) } : null,
        pane: pane
            ? {
                  steps: [...pane.querySelectorAll("[data-final-step]")].map((s) => ({
                      key: s.getAttribute("data-final-step"),
                      state: s.getAttribute("data-final-step-state"),
                      text: flat(s),
                  })),
                  headline: flat(pane.firstElementChild?.querySelector("span.tabular-nums")),
                  text: flat(pane),
              }
            : null,
    };
})()`;

// the run's Sessions list in Conversation History: each member's label and status word
const READ_MEMBERS = `(() => {
    ${LIB}
    const group = ${MEMBERS};
    if (!group) return null;
    return [...group.querySelectorAll("button")].map((b) => ({ label: flat(b.children[1]), status: flat(b.children[2]) }));
})()`;

const keysOf = (read) => (read?.pane?.steps ?? []).map((s) => s.key);
const statesOf = (read) => (read?.pane?.steps ?? []).map((s) => s.state);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// a real key through CDP: the page's listeners hear it as they hear a person's
async function press(h, key, { code = key, vk = 0 } = {}) {
    for (const type of ["keyDown", "keyUp"]) {
        await h.cdp("Input.dispatchKeyEvent", { type, key, code, windowsVirtualKeyCode: vk });
    }
}

// One Claude transcript the backend scan reads as a session: a first prompt with `cwd`, written now. The prompt is how the
// engine's own stage sessions are placed in a run (orchestrate.LaunchOriginOf).
function seedStageSession(folder, cwd, prompt) {
    const id = randomUUID();
    writeFileSync(
        join(folder, `${id}.jsonl`),
        JSON.stringify({ type: "user", cwd, timestamp: new Date().toISOString(), message: { role: "user", content: prompt } }) + "\n"
    );
    return id;
}

const restoreKey = (key, prev) =>
    prev == null ? `localStorage.removeItem(${JSON.stringify(key)})` : `localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(prev)})`;

export default function (kits) {
    const { arrangeFixtureRun, waitForDispatch, teardownFixtureRun, polishWaitFor, polishNap, waveService } = kits.jarvis;
    const { seedDag } = kits.run;

    // what a seed must hold: the dag's status and Final command, its plan review and its final stage with the end review
    const reviewersPrint = (pr) => (pr?.reviewers ?? []).map((r) => `${r.lens}:${r.state}`);
    const endPrint = (er) => (er ? [er.state, er.waiting === true, er.unverified ?? ""] : null);
    const print = (dag) =>
        JSON.stringify([
            dag?.status ?? "",
            dag?.finalcmd ?? "",
            dag?.planreview ? [dag.planreview.state, dag.planreview.amended === true, reviewersPrint(dag.planreview)] : null,
            dag?.final
                ? [dag.final.state, dag.final.round, dag.final.step ?? "", (dag.final.detail ?? "").length, (dag.final.unverified ?? []).length, endPrint(dag.final.endreview)]
                : null,
        ]);

    // Seeds the stored dag: the commands, no Final command, and the plan review and final stage a step gives (a step that gives
    // none clears the earlier one). The engine's tick holds the dag lock for seconds while it spawns t-1's worker and then writes
    // the dag it read first, over a seed that landed meanwhile, so the seed is read back after a pause and written again until it
    // has stayed. The tick can land over the seed later too, once a step has read it, so the seed also leaves `keeper`: what
    // `until` runs between its looks to write the seed again once the stored dag has lost it.
    let keeper = null;
    async function seed(h, ctx, { planreview, final } = {}) {
        let want = null;
        const write = () =>
            seedDag(
                h,
                ctx,
                (dag) => {
                    const { final: _final, pastfinals: _past, planreview: _review, fasttrack: _fast, ...rest } = dag;
                    const next = {
                        ...rest,
                        status: "running",
                        check: CHECK,
                        verify: VERIFY,
                        finalcmd: "",
                        lightreviewerroute: LIGHT_ROUTE,
                        ...(planreview ? { planreview } : {}),
                        ...(final ? { final } : {}),
                        pastfinals: [],
                    };
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

    // polls expr until ok holds; on every fourth look it writes the seed again if the tick took it
    async function until(h, expr, ok, ms = 12_000) {
        let last = null;
        for (let i = 0; i * 250 < ms; i++) {
            last = await h.ev(expr).catch(() => null);
            if (last != null && ok(last)) return last;
            if (i % 4 === 3) await keeper?.();
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

    // Escape until the modal is gone: a selection takes the first press
    async function closeDag(h) {
        for (let i = 0; i < 5 && (await h.ev(`!!${MODAL}`)); i++) {
            await press(h, "Escape", ESCAPE);
            await polishNap(400);
        }
        return polishWaitFor(h, `!${MODAL}`, 3000);
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

    // the plan reviewers' rows: they sit in the run's fold of what finished, which the tree draws closed
    async function openPlanRows(h) {
        await h.goto("agent");
        await polishWaitFor(h, `${PLAN_ROWS}.length > 0 || !!${DONE_FOLD}`, 20_000);
        if (await h.ev(`${PLAN_ROWS}.length === 0 && ${DONE_FOLD} != null`)) await h.ev(`${DONE_FOLD}.click()`);
        return polishWaitFor(h, `${PLAN_ROWS}.length > 0`, 10_000);
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

    // Conversation History on the run, with a member in view: the archive is read when the list mounts
    async function openSessions(h, ctx, member) {
        await agentPage(
            h,
            `const L = await mod("app/view/library/librarystore.ts");
            const model = agentsModel();
            globalStore.set(model.sessionsStatusFilterAtom, "all");
            globalStore.set(model.sessionsSelAtom, ${JSON.stringify(`run:${ctx.runId}`)});
            globalStore.set(model.sessionsMemberAtom, ${JSON.stringify(member)});
            L.showLibrary(model, "conversations");
            return true;`
        );
    }

    const now = () => Date.now();
    // a stage's end review beside Check and Verify, and the stage by its states
    const checking = (endreview) => ({ state: "checking", round: 1, step: "verify", stepts: now() - 60_000, startedts: now() - 120_000, endreview });

    const scenario = {
        name: NAME,
        surface: "agent",
        async arrange(h) {
            await h.cdp("Emulation.setDeviceMetricsOverride", WIDE);
            const ctx = {
                cwd: mkdtempSync(join(tmpdir(), "verify-kael1125-views-")),
                // not under the temp dir: the session scan drops a session whose project sits there (parseCandidates)
                sessionsCwd: mkdtempSync(join(homedir(), ".verify-kael1125-views-")),
                transcriptDir: join(homedir(), ".claude", "projects", `verify-kael1125-${randomUUID().slice(0, 8)}`),
                prevRail: await h.ev(`localStorage.getItem(${JSON.stringify(RAIL_VISIBLE_KEY)})`),
                prevSections: await h.ev(`localStorage.getItem(${JSON.stringify(RAIL_SECTIONS_KEY)})`),
                prevCollapsed: await h.ev(`localStorage.getItem(${JSON.stringify(TREE_COLLAPSED_KEY)})`),
            };
            // a throw past this point still returns ctx, so teardown removes whatever was already made
            try {
                await arrangeFixtureRun(h, ctx, "kael1125-views", LEAD);
                await h.rpc("dagsubmit", {
                    channelid: ctx.channelId,
                    runid: ctx.runId,
                    title: "verify kael1125 views",
                    parallelism: 1,
                    tasks: TASKS,
                });
                await waitForDispatch(h, ctx, "t-1");
                ctx.dagId = (await h.rpc("dagstatus", { channelid: ctx.channelId, runid: ctx.runId })).group.id;
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
                ctx.arrangeError == null && ctx.leadFocused === true && ctx.dispatched === true,
                ctx.arrangeError ?? { runId: ctx.runId, leadFocused: ctx.leadFocused, dispatched: ctx.dispatched }
            );
            if (ctx.arrangeError != null || ctx.leadFocused !== true) return steps;

            // 1. a light round reviewing: one light reviewer lost, its replacement running
            await seed(h, ctx, {
                planreview: {
                    state: "reviewing",
                    round: 1,
                    reviewers: [
                        { lens: "light", state: "lost" },
                        { lens: "light", state: "reviewing" },
                    ],
                },
            });
            const opened1 = await openDag(h, ctx);
            const route = opened1 ? await until(h, READ_CHIPS, (r) => r.chips.length === 2) : null;
            await h.shot("cdp-shots/kael1125-fast-track-views-1-light-chips.png");
            rec(
                `1. a light round with a lost reviewer and its replacement: the DAG route line shows two Light review chips, on the Light reviewers route's model (${LIGHT_MODEL})`,
                opened1 &&
                    route?.entry === "plan review · reviewing · round 1" &&
                    same(route.chips.map((c) => [c.lens, c.state, c.text]), [
                        ["light", "lost", `Light review · lost · ${LIGHT_MODEL}`],
                        ["light", "reviewing", `Light review · reviewing · ${LIGHT_MODEL}`],
                    ]),
                { opened1, route }
            );
            await closeDag(h);

            // 2. the lead amended the plan after the light review failed: the round's reviewers read as that, not as failed
            await seed(h, ctx, {
                planreview: {
                    state: "accepted",
                    round: 1,
                    amended: true,
                    reviewers: [
                        { lens: "light", state: "lost", runid: randomUUID() },
                        { lens: "light", state: "failed", runid: randomUUID() },
                    ],
                },
            });
            const rows2 = (await openPlanRows(h)) ? await until(h, READ_PLAN_ROWS, (r) => r.length === 2 && r.every((x) => x.sub !== "")) : null;
            await h.shot("cdp-shots/kael1125-fast-track-views-2-amended-tree.png");
            rec(
                `2. an accepted plan review the lead amended: the Agent tree's Light review rows, the lost reviewer's too, read '${AMENDED}' with the muted dot`,
                rows2?.length === 2 &&
                    rows2.every((r) => r.title === "Plan review · Light review" && r.sub === AMENDED && r.muted === true),
                rows2
            );

            // 3. the end review reviewing beside a running Verify
            await seed(h, ctx, { final: checking({ state: "reviewing", startedts: now() - 100_000 }) });
            const paneOpen3 = await openPane(h);
            const alongside = paneOpen3
                ? await until(h, READ_FINAL, (s) => s.pane != null && same(statesOf(s), ["passed", "passed", "running", "running", "waiting"]))
                : null;
            await h.shot("cdp-shots/kael1125-fast-track-views-3-end-review-alongside.png");
            rec(
                "3. a stage at Verify with an end review reviewing: the pane lists Check, Verify, End review and Verifier, and the row's second line says the end review works alongside",
                paneOpen3 &&
                    same(keysOf(alongside), ["tree", "check", "verify", "review", "verifier"]) &&
                    same(statesOf(alongside), ["passed", "passed", "running", "running", "waiting"]) &&
                    /^End review\b/.test(alongside.pane.steps[3].text) &&
                    /^Verify · .* · end review alongside$/.test(alongside.row?.sub ?? ""),
                { paneOpen3, alongside }
            );

            // 4. the stage failed by the end review alone
            await seed(h, ctx, {
                final: { state: "failed", round: 1, detail: `[End review] ${FINDING}`, endreview: { state: "failed", text: FINDING } },
            });
            const paneOpen4 = await openPane(h);
            const failed = paneOpen4 ? await until(h, READ_FINAL, (s) => s.row?.tone === "fail" && s.pane != null) : null;
            await h.shot("cdp-shots/kael1125-fast-track-views-4-end-review-failed.png");
            rec(
                "4. a stage whose Detail is only the end review's: End review failed, Check, Verify and the Verifier passed, the findings in the pane and the tree's final row failed at End review",
                paneOpen4 &&
                    same(statesOf(failed), ["passed", "passed", "passed", "failed", "passed"]) &&
                    failed.row?.sub === "failed at End review · round 1" &&
                    failed.pane.text.includes(FINDING),
                { paneOpen4, failed }
            );

            // 5. a pass that could not verify everything
            await seed(h, ctx, {
                final: {
                    state: "unverified",
                    round: 1,
                    unverified: [`end review: ${UNVERIFIED_NOTE}`],
                    endreview: { state: "passed", unverified: UNVERIFIED_NOTE },
                },
            });
            const paneOpen5 = await openPane(h);
            const unverified = paneOpen5 ? await until(h, READ_FINAL, (s) => s.row?.tone === "warn" && s.pane != null) : null;
            await h.shot("cdp-shots/kael1125-fast-track-views-5-end-review-unverified.png");
            rec(
                "5. a pass with an unverified note: End review reads unverified, the other steps passed, and the note is the stage's reason",
                paneOpen5 &&
                    same(statesOf(unverified), ["passed", "passed", "passed", "unverified", "passed"]) &&
                    unverified.row?.sub.startsWith("unverified") &&
                    unverified.pane.text.includes(UNVERIFIED_NOTE),
                { paneOpen5, unverified }
            );

            // 6. a stage with no endreview draws as it always did
            await seed(h, ctx, { final: { state: "failed", round: 1, detail: VERIFY_DETAIL } });
            const paneOpen6 = await openPane(h);
            const plain = paneOpen6 ? await until(h, READ_FINAL, (s) => s.row?.tone === "fail" && s.pane != null) : null;
            await h.shot("cdp-shots/kael1125-fast-track-views-6-no-end-review.png");
            rec(
                "6. a stage with no endreview has no End review step: Tree, Check, Verify and Verifier, failed at Verify",
                paneOpen6 &&
                    same(keysOf(plain), ["tree", "check", "verify", "verifier"]) &&
                    same(statesOf(plain), ["passed", "passed", "failed", "notrun"]) &&
                    !plain.pane.text.includes("End review") &&
                    plain.row?.sub === "failed at Verify · round 1",
                { paneOpen6, plain }
            );

            // 7. the Sessions list: the end reviewer and the amended round's plan reviewer as stage members
            mkdirSync(ctx.transcriptDir, { recursive: true });
            seedStageSession(ctx.transcriptDir, ctx.sessionsCwd, `You are the end reviewer for run ${ctx.runId}`);
            seedStageSession(ctx.transcriptDir, ctx.sessionsCwd, `You are the plan reviewer for run ${ctx.runId}`);
            const amendedRound = {
                state: "accepted",
                round: 1,
                amended: true,
                reviewers: [{ lens: "light", state: "failed", runid: randomUUID() }],
            };
            await seed(h, ctx, {
                planreview: amendedRound,
                final: { state: "verifying", round: 1, startedts: now() - 120_000, endreview: { state: "reviewing", startedts: now() - 62_000 } },
            });
            await openSessions(h, ctx, "end-reviewer");
            const member = (list, label) => list?.find((m) => m.label === label)?.status ?? null;
            const reviewing7 = await until(h, READ_MEMBERS, (m) => member(m, "End review") != null && member(m, "Plan review") != null, 20_000);
            await h.shot("cdp-shots/kael1125-fast-track-views-7a-sessions-reviewing.png");
            // the stage records its verdict: a pass that could not verify everything
            await seed(h, ctx, {
                planreview: amendedRound,
                final: {
                    state: "unverified",
                    round: 1,
                    unverified: [`end review: ${UNVERIFIED_NOTE}`],
                    endreview: { state: "passed", unverified: UNVERIFIED_NOTE },
                },
            });
            const verdict7 = await until(h, READ_MEMBERS, (m) => member(m, "End review") === "unverified");
            await h.shot("cdp-shots/kael1125-fast-track-views-7b-sessions-verdict.png");
            rec(
                `7. the run's Sessions list holds the end reviewer as a stage member reading 'reviewing' while the stage records it so and its verdict word once it records one, and the amended round's plan reviewer reading '${AMENDED}'`,
                member(reviewing7, "End review") === "reviewing" &&
                    member(reviewing7, "Plan review") === AMENDED &&
                    member(verdict7, "End review") === "unverified" &&
                    member(verdict7, "Plan review") === AMENDED,
                { reviewing7, verdict7 }
            );

            // 8. the commands and the verifier are done and the stage waits only on its end review (the Agent surface again)
            await seed(h, ctx, {
                final: {
                    state: "verifying",
                    round: 1,
                    startedts: now() - 120_000,
                    endreview: { state: "reviewing", startedts: now() - 62_000, waiting: true, judged: true },
                },
            });
            const paneOpen8 = await openPane(h);
            const waiting = paneOpen8
                ? await until(h, READ_FINAL, (s) => s.pane != null && same(statesOf(s), ["passed", "passed", "passed", "running", "passed"]))
                : null;
            await h.shot("cdp-shots/kael1125-fast-track-views-8-waits-on-end-review.png");
            rec(
                "8. a stage that waits only on its end review: the final row and the stage headline read 'end review reviewing'",
                paneOpen8 &&
                    same(statesOf(waiting), ["passed", "passed", "passed", "running", "passed"]) &&
                    waiting.row?.sub.startsWith("end review reviewing") &&
                    /^round 1 · end review reviewing\b/.test(waiting.pane.headline),
                { paneOpen8, waiting }
            );
            return steps;
        },
        async teardown(h, ctx) {
            await teardownFixtureRun(h, ctx, NAME, {
                what: "remove the seeded sessions, restore the rail's and the tree's keys and the viewport",
                fn: async () => {
                    rmSync(ctx.transcriptDir, { recursive: true, force: true });
                    rmSync(ctx.sessionsCwd, { recursive: true, force: true });
                    await h.ev(restoreKey(RAIL_VISIBLE_KEY, ctx.prevRail));
                    await h.ev(restoreKey(RAIL_SECTIONS_KEY, ctx.prevSections));
                    await h.ev(restoreKey(TREE_COLLAPSED_KEY, ctx.prevCollapsed));
                    await h.cdp("Emulation.clearDeviceMetricsOverride", {});
                },
            });
        },
    };

    return [scenario];
}
