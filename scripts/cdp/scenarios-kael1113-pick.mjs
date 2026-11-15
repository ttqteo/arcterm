// kael1113-pick: the visible fixes of the 2026-11-15 Kael sync pick (docs/superpowers/plans/2026-11-15-kael-sync-hardening-pick.md,
// Task 10). kits is scenarios.mjs's KAEL_KITS plus `run`; the fixture-run helpers are kits.jarvis's, the wavesrv service route
// kits.rt's.
//
// One scenario, `kael1113-pick`, on one deferred orchestrator run with a chain of three noop tasks (t-1 dispatches a real
// worker that does nothing). The roster is a fixture file read at boot (a lead carrying the run, and an asking agent); no agent
// runs. The page reloads onto it after t-1 dispatches, so it holds no object of t-1's run (arrange says why it matters).
//   1. a worker tab that joins a run is under the run's row in the Agent tree from its first frame (Task 9, the fork's
//      7295fec74): the page samples the tree on every animation frame from the inject, and any frame where the tab renders
//      outside t-1's worker row fails the step. The fork's step 9c is the model. Its step 9c2, a real shell block behind the
//      tab so its header does not read "failed to start / error getting block", is not built: the tab is never focused here,
//      so no header or terminal opens for it, and the step reads the tab's row for that text instead (see LEAD for why no
//      block here is real).
//   2. an answer that did not reach the agent can be answered again (Task 7, the fork's 8051926e0): the first `answeragent`
//      the page sends is rejected, which raises the error toast and unlocks the card's answer bar; the second goes through and
//      the card reads Answered.
// A commit a task skipped would get no step; both landed, so both have one.
// Every click is a real CDP mouse event, so the page's own listeners are what run. The page's own `answeragent` call is
// recorded here and never forwarded, so no real agent gets an answer.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentPage } from "./agent-page-fixtures.mjs";

const NAME = "kael1113-pick";
// Every block here is made up, as agent-tree-rail's are, so no process starts: the pane the Agent surface opens on the lead
// reads "error getting block" in the shots. A real tab behind the lead was tried and dropped: the surface then starts a
// shell and Claude Code in it, a real agent launched for a screenshot.
const LEAD = { id: "fx-pick-lead", name: "pick lead", blockId: "fx-blk-pick-lead" };
const WORKER = { id: "fx-pick-worker", name: "pick worker", blockId: "fx-blk-pick-worker" };
const ASKER = { id: "fx-pick-asker", name: "pick asker", blockId: "fx-blk-pick-asker", askId: "fx-pick-ask" };
const ASK = {
    header: "Track",
    question: "Which track should it take?",
    options: [{ label: "the short one" }, { label: "the long one" }],
};
const VIEW_KEY = "cockpit.view";
const TOAST_TITLE = "The answer did not reach the agent";
const DISPATCH_FAILURE = "the agent's terminal is gone";
// the words of a block the header could not start; a row must not read like one
const BLOCK_ERROR_RE = /failed to start|error getting block/i;
const WIDE = { width: 1600, height: 950, deviceScaleFactor: 1, mobile: false };

const TREE = `document.querySelector("[data-agent-tree]")`;
const T1_ROW = (id) => `${TREE}?.querySelector('[data-tree-task="t-1"][data-agent-row="${id}"]')`;
const CARD = (id) => `document.querySelector('[data-cockpit-surface] [data-agent-id="${id}"]')`;

// what the asking card shows: its answer buttons (an option is a button whose text, minus its leading digit, is a label),
// whether any is disabled, and the bar's place once the ask is sent: one line, "Answered: <what was picked>"
const READ_CARD = `(() => {
    const card = ${CARD(ASKER.id)};
    if (!card) return null;
    const flat = (el) => (el?.textContent ?? "").replace(/\\s+/g, " ").trim();
    const labels = ${JSON.stringify(ASK.options.map((o) => o.label))};
    const options = [...card.querySelectorAll("button")].filter((b) => labels.includes(flat(b).replace(/^\\d/, "")));
    const sentEl = [...card.querySelectorAll("div")].find((d) => /^Answered\\b/.test(flat(d)) && !d.querySelector("div"));
    return {
        options: options.map((b) => flat(b).replace(/^\\d/, "")),
        enabled: options.length > 0 && options.every((b) => !b.disabled),
        sentLine: sentEl ? flat(sentEl) : null,
    };
})()`;

// an answer button of the asking card, by its label (a digit hint leads it while the cursor is on the card)
const OPTION = (label) =>
    `[...(${CARD(ASKER.id)}?.querySelectorAll("button") ?? [])].find((b) => (b.textContent ?? "").replace(/\\s+/g, " ").trim().replace(/^\\d\\s*/, "") === ${JSON.stringify(label)})`;

const toastTexts = `[...document.querySelectorAll("[data-notification-toast]")].map((t) => (t.textContent ?? "").replace(/\\s+/g, " ").trim())`;

// The centre of an element as a point, and whether that point is over the element itself: a click is dispatched only when it
// is, so a layout that moved between this read and the press cannot land the click on a neighbour (the lead card's Cancel
// run, a link to another surface). The scroll is instant and only as far as needed, so the rect read is the settled one.
const centre = (expr) => `(() => {
    const el = ${expr};
    if (!el) return null;
    el.scrollIntoView?.({ block: "nearest", inline: "nearest", behavior: "instant" });
    const b = el.getBoundingClientRect();
    const x = Math.round(b.x + b.width / 2);
    const y = Math.round(b.y + b.height / 2);
    const over = document.elementFromPoint(x, y);
    return {
        x,
        y,
        hit: over != null && el.contains(over),
        over: over ? over.tagName.toLowerCase() + " " + (over.textContent ?? "").replace(/\\s+/g, " ").trim().slice(0, 40) : null,
    };
})()`;

// Clicks an element with real mouse events. Returns what was done: { clicked, x, y, over }; clicked is false when there
// was no such element or the point was not over it, and then nothing was pressed.
async function click(h, expr) {
    const at = await h.ev(centre(expr));
    if (at == null) return { clicked: false, over: null };
    const { hit, ...where } = at;
    if (!hit) return { clicked: false, ...where };
    await h.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: at.x, y: at.y });
    for (const type of ["mousePressed", "mouseReleased"]) {
        await h.cdp("Input.dispatchMouseEvent", { type, x: at.x, y: at.y, button: "left", clickCount: 1 });
    }
    return { clicked: true, ...where };
}

export default function (kits) {
    const { arrangeFixtureRun, waitForDispatch, teardownFixtureRun, RUN_SHEET_POLISH_TASKS, polishWaitFor, polishNap } =
        kits.jarvis;
    const { TREE_RAIL_FIXTURE, ahReload } = kits.rt;

    const rosterOf = (runId) => [
        {
            id: LEAD.id,
            name: LEAD.name,
            project: "waveterm",
            task: "verify kael1113 pick",
            state: "working",
            agent: "claude",
            model: "opus",
            activeMs: 240_000,
            runId,
            blockId: LEAD.blockId,
        },
        {
            id: ASKER.id,
            name: ASKER.name,
            project: "verify-kael1113-pick",
            task: "pick a track",
            state: "asking",
            agent: "claude",
            model: "opus",
            blockedMs: 60_000,
            blockId: ASKER.blockId,
            ask: { askId: ASKER.askId, oref: `block:${ASKER.blockId}`, questions: [ASK] },
        },
    ];

    const scenario = {
        name: NAME,
        surface: "agent",
        async arrange(h) {
            const ctx = { cwd: mkdtempSync(join(tmpdir(), "verify-kael1113-pick-")) };
            // a throw past this point still returns ctx, so teardown undoes whatever was already made
            try {
                await h.cdp("Emulation.setDeviceMetricsOverride", WIDE);
                await arrangeFixtureRun(h, ctx, NAME, LEAD.name, {});
                await h.rpc("dagsubmit", {
                    channelid: ctx.channelId,
                    runid: ctx.runId,
                    title: `verify ${NAME}`,
                    parallelism: 1,
                    tasks: RUN_SHEET_POLISH_TASKS,
                });
                // a queued task folds away, so t-1 has a worker row only once it dispatches
                await waitForDispatch(h, ctx, "t-1");
                ctx.t1Run = (await h.rpc("dagstatus", { channelid: ctx.channelId, runid: ctx.runId })).group?.tasks?.find(
                    (t) => t.id === "t-1"
                )?.runid;
                // The roster goes in the fixture file, over the one arrangeFixtureRun wrote, and the page reloads onto it.
                // The reload is the point: wavesrv pushes every run it updates, so a page open while t-1 dispatched already
                // holds t-1's run, and a tab joining then is placed at once whatever the lineage does. A reloaded page
                // reads that run only when something asks, which is the window the fix closes.
                writeFileSync(TREE_RAIL_FIXTURE, JSON.stringify(rosterOf(ctx.runId), null, 2));
                if (!(await ahReload(h))) throw new Error("the app did not come back from the reload");
                await h.goto("agent");
                // the lead nests under its run once the run and its dag load, and t-1's worker row shows with no tab yet
                ctx.treeReady = await polishWaitFor(h, `!!${TREE}?.querySelector('[data-tree-task="t-1"]')`, 30000);
            } catch (e) {
                ctx.arrangeError = String(e?.message ?? e);
            }
            return ctx;
        },
        async assert(h, ctx) {
            const steps = [];
            const rec = (step, ok, detail) => steps.push({ step, ok: !!ok, detail: JSON.stringify(detail) });
            rec(
                "0. the run's t-1 dispatched its worker, and the Agent tree shows t-1's worker row under the run with no tab",
                ctx.arrangeError == null && ctx.dispatched === true && ctx.t1Run != null && ctx.treeReady === true,
                ctx.arrangeError ?? { dispatched: ctx.dispatched, t1Run: ctx.t1Run, treeReady: ctx.treeReady }
            );
            if (ctx.arrangeError != null || ctx.treeReady !== true || ctx.t1Run == null) return steps;

            // a thrown call (the page went away, a CDP timeout) must not discard the steps recorded so far
            try {
                // 1. the worker tab joins the roster; the sampler runs on every frame from the inject
                const worker = {
                    id: WORKER.id,
                    name: WORKER.name,
                    project: "waveterm",
                    task: "noop",
                    state: "working",
                    agent: "claude",
                    model: "sonnet",
                    runId: ctx.t1Run,
                    blockId: WORKER.blockId,
                };
                const joined = await agentPage(
                    h,
                    `const D = await mod("app/view/agents/devmock.ts");
                    const id = ${JSON.stringify(worker.id)};
                    const rowsOf = () => [...document.querySelectorAll('[data-agent-tree] [data-agent-row="' + id + '"]')];
                    // out of place: in a row of its own or nested, neither of which carries t-1's data-tree-task
                    const frames = [];
                    let sampling = true;
                    const sample = () => {
                        const rows = rowsOf();
                        frames.push({
                            stray: rows.filter((r) => !r.hasAttribute("data-tree-task")).map((r) => flat(r).slice(0, 60)),
                            placed: rows.some((r) => r.getAttribute("data-tree-task") === "t-1"),
                        });
                        if (sampling) requestAnimationFrame(sample);
                    };
                    requestAnimationFrame(sample);
                    globalStore.set(D.devMockAgentsAtom, (cur) => [...(cur ?? []), ${JSON.stringify(worker)}]);
                    const placed = await until(() => rowsOf().some((r) => r.getAttribute("data-tree-task") === "t-1"), 8000);
                    // a few frames past the placement: it must hold
                    await nap(600);
                    sampling = false;
                    const strayFrames = frames.filter((f) => f.stray.length > 0);
                    return {
                        placed,
                        frames: frames.length,
                        strayFrames: strayFrames.length,
                        firstStray: strayFrames[0]?.stray ?? null,
                        lastPlaced: frames.at(-1)?.placed === true,
                        rowText: flat(rowsOf().find((r) => r.getAttribute("data-tree-task") === "t-1")),
                    };`
                );
                await polishNap(400);
                await h.shot("cdp-shots/kael1113-pick-1-worker-placed.png");
                rec(
                    "1. a worker tab that joins the run renders in no frame anywhere but t-1's worker row, and that row reads no block error",
                    joined.placed === true &&
                        joined.frames > 0 &&
                        joined.strayFrames === 0 &&
                        joined.lastPlaced === true &&
                        !BLOCK_ERROR_RE.test(joined.rowText ?? ""),
                    joined
                );

                // 2. the Cockpit's card of the asking agent: its first answer is lost, its second is not
                await agentPage(
                    h,
                    `const O = await mod("app/view/agents/officestore.ts");
                    window.__kpickPrevView = localStorage.getItem(${JSON.stringify(VIEW_KEY)});
                    globalStore.set(O.cockpitViewAtom, "cards");
                    const c = window.TabRpcClient;
                    if (!c.__kpickOrig) {
                        c.__kpickOrig = c.wshRpcCall;
                        const call = c.wshRpcCall.bind(c);
                        c.wshRpcCall = (command, data, opts) => {
                            if (command !== "answeragent") return call(command, data, opts);
                            window.__kpickAnswers.push(data);
                            // the first answer never reaches the agent; the second does
                            return window.__kpickAnswers.length === 1
                                ? Promise.reject(new Error(${JSON.stringify(DISPATCH_FAILURE)}))
                                : Promise.resolve(null);
                        };
                    }
                    window.__kpickAnswers = [];
                    return true;`
                );
                await h.goto("cockpit");
                const ready = await polishWaitFor(h, `${READ_CARD}?.options?.length === 2`, 20000);
                await h.shot("cdp-shots/kael1113-pick-2-ask.png");
                const answers = async () => JSON.parse(await h.ev("JSON.stringify(window.__kpickAnswers || [])"));

                const first = { ready, click: await click(h, OPTION(ASK.options[0].label)) };
                // the lock shows Answered for the moment the send is out; the failure then unlocks the bar and raises the toast
                first.toast = await polishWaitFor(h, `${toastTexts}.some((t) => t.includes(${JSON.stringify(TOAST_TITLE)}))`, 10000);
                await polishNap(500);
                first.card = await h.ev(READ_CARD);
                first.sent = await answers();
                first.toastText = (await h.ev(toastTexts)).find((t) => t.includes(TOAST_TITLE)) ?? null;
                await h.shot("cdp-shots/kael1113-pick-2-failed.png");

                // a different option, since a click on the picked one toggles it off
                const second = { click: await click(h, OPTION(ASK.options[1].label)) };
                second.line = await polishWaitFor(h, `${READ_CARD}?.sentLine != null`, 10000);
                second.card = await h.ev(READ_CARD);
                // a click that left the Cockpit shows here, with what the point was over in `click.over`
                second.surface = await h.activeSurfaceLabel();
                second.sent = await answers();
                await h.shot("cdp-shots/kael1113-pick-2-resent.png");
                rec(
                    "2. an answer that did not reach the agent raises an error toast and leaves the card answerable; the second answer goes through and the card reads Answered",
                    ready &&
                        first.click.clicked &&
                        first.toast &&
                        first.toastText?.includes(DISPATCH_FAILURE) &&
                        first.sent.length === 1 &&
                        first.card?.sentLine == null &&
                        first.card?.enabled === true &&
                        first.card.options.length === 2 &&
                        second.click.clicked &&
                        second.line &&
                        second.sent.length === 2 &&
                        JSON.stringify(second.sent[1].answers) === JSON.stringify([{ selectedindexes: [1] }]) &&
                        second.sent[1].oref === `block:${ASKER.blockId}` &&
                        second.card?.sentLine === `Answered: ${ASK.options[1].label}`,
                    { first, second }
                );
            } catch (e) {
                rec("the scenario ran to its end", false, String(e?.stack ?? e?.message ?? e));
            }
            return steps;
        },
        async teardown(h, ctx) {
            const step = async (what, fn) => {
                try {
                    await fn();
                } catch (e) {
                    console.error(`${NAME} teardown: ${what} failed: ${e?.message ?? e}`);
                }
            };
            await step("clear the page's hooks", () =>
                agentPage(
                    h,
                    `const c = window.TabRpcClient;
                    if (c?.__kpickOrig) { c.wshRpcCall = c.__kpickOrig; delete c.__kpickOrig; }
                    delete window.__kpickAnswers;
                    return true;`
                )
            );
            await step("put the Cockpit view back", () =>
                agentPage(
                    h,
                    `const prev = window.__kpickPrevView;
                    if (prev === undefined) return true;
                    if (prev === null) localStorage.removeItem(${JSON.stringify(VIEW_KEY)});
                    else localStorage.setItem(${JSON.stringify(VIEW_KEY)}, prev);
                    delete window.__kpickPrevView;
                    return true;`
                )
            );
            await step("clear the viewport", () => h.cdp("Emulation.clearDeviceMetricsOverride", {}));
            // the run, its channel and worker, and the temp dir; ends with a reload onto the live roster
            await teardownFixtureRun(h, ctx, NAME);
        },
    };
    return [scenario];
}
