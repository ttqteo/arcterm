// kael1113-timeline: the run timeline's and the tree lanes' scenarios for the 2026-11-13 Kael sync (docs/superpowers/plans/
// 2026-11-13-kael-sync-engine-runviews-rpc.md, Task 14). Task 1 created it empty and registered it in scenarios.mjs. kits is
// scenarios.mjs's KAEL_KITS plus `run`: RUN_KIT, the dag seeding helpers; the fixture-run helpers are kits.jarvis's.
//
// `kael1113-timeline`, on one deferred orchestrator run with a chain of three noop tasks (t-1 dispatches a real worker that
// does nothing; t-2 and t-3 wait on it). A run's events cannot be written through an RPC, so the page is handed `run:event`s
// the way the engine's reach it (`publish`), and the stored dag is seeded into the state a step is about (`seed`: a seeded
// dag proves how the cockpit draws that state, not what the engine does with it):
//   1. a running dag's timeline, given a final stage's end, a human's skip and a failure handed to the human: the rows sit
//      in time order, an event stamped earlier that arrives later leaves an open row open and mounted (the groups are keyed
//      by their first event, 8d14dca57), and every count is a count of events, the header's and the chips' (652fa1a3d)
//   2. in a narrow window the lifecycle is a drawer without the activity strip, capped at 35% of the modal, and the graph
//      keeps the larger share (a728ee85d, 652fa1a3d)
//   3. an ended run's timeline says so: its axis ends at its last event ('ended <time>'), its times carry the date once
//      the events span days, and it draws no now marker and no live pill (652fa1a3d)
//   4. a digest refresh that fails marks the held digest stale, and the hook asks again by itself: the sheet reads 'as of',
//      then recovers with no further event (5459268f8)
// `kael1113-tree-lanes`, on a fixture lead nested under a run whose tasks are seeded (t-2 done and waiting at the merge gate,
// t-3 failed Verify), with the engine's digest patched on the page to hold t-2's merge behind t-3 (the engine port that
// writes `mergeheldby` is another task's): the Agent tree draws the failed tone and the gate row, the rail's lanes read the
// same lines in a capped text, and a task row with no session opens the run's DAG at it (9d633e0a0).
// Every click on a graph or tree row is the DOM's own, so the page's listeners are what run.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const WIDE = { width: 1600, height: 950, deviceScaleFactor: 1, mobile: false };
const NARROW = { width: 1000, height: 700, deviceScaleFactor: 1, mobile: false };

const MODAL = `document.querySelector("[data-dag-modal-kind]")`;
const OPEN_DAG = `document.querySelector("[data-run-sheet] [data-run-sheet-open-dag]")`;
const RAIL_IN_MODAL = `${MODAL}?.querySelector("[data-timeline-rail]")`;

// every timeline row's title, newest first: the first span of the row's first line
const TITLES = `[...(${MODAL}?.querySelectorAll("[data-timeline-row]") ?? [])].map((b) => (b.firstElementChild?.firstElementChild?.textContent ?? "").trim())`;
const ROW = (title) =>
    `[...(${MODAL}?.querySelectorAll("[data-timeline-row]") ?? [])].find((b) => (b.firstElementChild?.firstElementChild?.textContent ?? "").trim() === ${JSON.stringify(title)})`;

// the rail as the page draws it: its layout, the header's count and the filter chips', the live marks, the rows' titles
const READ_RAIL = `(() => {
    const rail = ${RAIL_IN_MODAL};
    if (!rail) return null;
    const num = (sel) => {
        const m = (rail.querySelector(sel)?.textContent ?? "").match(/\\d+/);
        return m ? Number(m[0]) : null;
    };
    return {
        layout: rail.getAttribute("data-timeline-rail"),
        header: num("[data-timeline-count]"),
        all: num('[data-timeline-filter-count="all"]'),
        attention: num('[data-timeline-filter-count="attention"]'),
        now: !!rail.querySelector("[data-timeline-now]"),
        statuses: [...rail.querySelectorAll("[data-timeline-status]")].map((e) => e.getAttribute("data-timeline-status")),
        titles: ${TITLES},
    };
})()`;

// what the drawer takes of the modal, against the graph's pane
const READ_DRAWER = `(() => {
    const rail = ${MODAL}?.querySelector('[data-timeline-rail="drawer"]');
    const pane = ${MODAL}?.querySelector(".react-flow");
    if (!rail || !pane) return null;
    const box = rail.getBoundingClientRect();
    const body = rail.parentElement.getBoundingClientRect();
    const scroller = rail.querySelector(".overflow-y-auto")?.getBoundingClientRect();
    const rows = [...rail.querySelectorAll("[data-timeline-row]")];
    const whole = scroller
        ? rows.filter((r) => {
              const q = r.getBoundingClientRect();
              return q.top >= scroller.top - 1 && q.bottom <= scroller.bottom + 1;
          }).length
        : 0;
    return {
        drawer: Math.round(box.height),
        body: Math.round(body.height),
        cap: Math.round(body.height * 0.35),
        pane: Math.round(pane.getBoundingClientRect().height),
        rows: rows.length,
        whole,
        strip: !!rail.querySelector("[data-timeline-strip]"),
    };
})()`;

// the activity strip's bottom line: where the axis starts, how long it is and where it ends
const READ_STRIP = `(() => {
    const rail = ${RAIL_IN_MODAL};
    const strip = rail?.querySelector("[data-timeline-strip]");
    const line = strip?.querySelector("div.justify-between");
    return {
        cells: line ? [...line.children].map((c) => c.textContent.trim()) : null,
        end: strip?.querySelector("[data-timeline-strip-end]")?.textContent.trim() ?? null,
        now: !!rail?.querySelector("[data-timeline-now]"),
        statuses: [...(rail?.querySelectorAll("[data-timeline-status]") ?? [])].map((e) => e.getAttribute("data-timeline-status")),
        header: Number(((rail?.querySelector("[data-timeline-count]")?.textContent ?? "").match(/\\d+/) ?? [])[0] ?? NaN),
    };
})()`;

// 'Oct 16 13:59', as tsLabel(ts, true) reads
const DATED = /^[A-Z][a-z]{2} \d{1,2} \d{2}:\d{2}$/;
const DATED_END = /^ended [A-Z][a-z]{2} \d{1,2} \d{2}:\d{2}$/;

const DAY_MS = 24 * 60 * 60_000;
const ESCAPE = { code: "Escape", vk: 27 };

// a real key through CDP: the page's listeners hear it as they hear a person's
async function press(h, key, { code = key, vk = 0 } = {}) {
    for (const type of ["keyDown", "keyUp"]) {
        await h.cdp("Input.dispatchKeyEvent", { type, key, code, windowsVirtualKeyCode: vk });
    }
}

// Hands the page `run:event`s as the engine's would be: [kind, detail, age in ms], stamped that long before now. The
// page appends each to the run's list (runeventstore.ts); the list's first load replaces it, so call this after the rail
// reads live. An id published again moves to the front.
async function publish(h, ctx, tag, events) {
    const now = Date.now();
    for (const [i, [kind, detail, ageMs]] of events.entries()) {
        const event = {
            id: `k1113-${tag}-${i}`,
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

// Puts a function of the page's own RpcApi.DagStatusCommand in its place. The module url is the one the app loaded, so
// the import is its instance. `wrapperSrc` is the source of (call, state, args) => promise: call is the original, state
// is the object the scenario reads back from window.__k1113Stub. restore() puts the original back.
async function stubDagStatus(h, wrapperSrc) {
    return h.ev(`(async () => {
        const hits = performance.getEntriesByType("resource").map((e) => e.name).filter((n) => /\\/wshclientapi\\.ts(\\?|$)/.test(n));
        const url = hits[hits.length - 1];
        if (!url) return { ok: false, why: "no wshclientapi module in the page's resources" };
        const { RpcApi } = await import(url);
        if (!RpcApi || typeof RpcApi.DagStatusCommand !== "function") return { ok: false, why: "no RpcApi.DagStatusCommand at " + url };
        if (window.__k1113Stub) window.__k1113Stub.restore();
        const orig = RpcApi.DagStatusCommand;
        const state = { calls: [], failing: false };
        const wrap = (${wrapperSrc});
        RpcApi.DagStatusCommand = function (...args) {
            return wrap(orig.bind(RpcApi), state, args);
        };
        window.__k1113Stub = {
            state,
            restore() {
                RpcApi.DagStatusCommand = orig;
                delete window.__k1113Stub;
            },
        };
        return { ok: true, url };
    })()`);
}
const RESTORE_STUB = `(() => {
    const s = window.__k1113Stub;
    if (!s) return "absent";
    s.restore();
    return "restored";
})()`;

export default function (kits) {
    const { arrangeFixtureRun, arrangeSheetDagRun, teardownFixtureRun, waitForDispatch, RUN_SHEET_POLISH_TASKS, polishWaitFor, polishNap } =
        kits.jarvis;
    const { seedDag } = kits.run;

    // what a seed must hold: every task's state but t-1's, which the engine owns, and the dag's status when asked
    const fingerprint = (dag) =>
        JSON.stringify([dag?.status ?? null, (dag?.tasks ?? []).map((t) => [t.id, t.id === "t-1" ? "" : t.state])]);

    // Seeds the stored dag: `edit` maps one task, `top` the dag's own fields. The engine's tick holds the dag lock for
    // seconds while it spawns t-1's worker and then writes the dag it read first, over a seed that landed meanwhile, so
    // the seed is read back after a pause and written again until it has stayed.
    async function seed(h, ctx, top, edit) {
        const stored0 = (await h.rpc("dagstatus", { channelid: ctx.channelId, runid: ctx.runId })).group;
        const want = fingerprint({
            status: top.status ?? stored0?.status,
            tasks: (stored0?.tasks ?? []).map((t) => ({ id: t.id, state: edit[t.id]?.state ?? t.state })),
        });
        const print = (dag) => (top.status == null ? fingerprint({ ...dag, status: stored0?.status }) : fingerprint(dag));
        for (let round = 0; round < 4; round++) {
            await seedDag(
                h,
                ctx,
                (dag) => ({ ...dag, ...top, tasks: dag.tasks.map((t) => ({ ...t, ...(edit[t.id] ?? {}) })) }),
                print
            );
            await polishNap(2500);
            const stored = (await h.rpc("dagstatus", { channelid: ctx.channelId, runid: ctx.runId })).group;
            if (print(stored) === want) return;
        }
        throw new Error(`the dag did not keep its seed: want ${want}`);
    }

    // opens the run's DAG from the sheet's dock; true once the graph shows its cards
    async function openDag(h) {
        const dock = await polishWaitFor(h, `!!${OPEN_DAG}`, 15000);
        if (dock) await h.ev(`${OPEN_DAG}.click()`);
        return dock && (await polishWaitFor(h, `${MODAL}?.querySelectorAll("[data-dag-node]").length >= 4`, 10000));
    }

    // Escape until the modal is gone: a selection takes the first press
    async function closeDag(h) {
        for (let i = 0; i < 4 && (await h.ev(`!!${MODAL}`)); i++) {
            await press(h, "Escape", ESCAPE);
            await polishNap(400);
        }
        return polishWaitFor(h, `!${MODAL}`, 3000);
    }

    const timeline = {
        name: "kael1113-timeline",
        surface: "jarvis",
        async arrange(h) {
            await h.cdp("Emulation.setDeviceMetricsOverride", WIDE);
            const ctx = await arrangeSheetDagRun(h, "kael1113-timeline", RUN_SHEET_POLISH_TASKS);
            if (ctx.arrangeError != null) return ctx;
            try {
                await waitForDispatch(h, ctx, "t-1");
                ctx.dagId = (await h.rpc("dagstatus", { channelid: ctx.channelId, runid: ctx.runId })).group.id;
            } catch (e) {
                ctx.arrangeError = String(e?.message ?? e);
            }
            return ctx;
        },
        async assert(h, ctx) {
            const steps = [];
            const rec = (step, ok, detail) => steps.push({ step, ok: !!ok, detail: JSON.stringify(detail) });
            rec(
                "0. the run's sheet opened and t-1 dispatched its worker",
                ctx.arrangeError == null && ctx.opened?.ok === true && ctx.dispatched === true,
                ctx.arrangeError ?? { opened: ctx.opened, dispatched: ctx.dispatched }
            );
            if (ctx.arrangeError != null) return steps;

            // 1. a running dag: a final stage's end, a human's skip and a failure handed to the human
            const opened1 = await openDag(h);
            const live1 = opened1 && (await polishWaitFor(h, `!!${MODAL}?.querySelector('[data-timeline-rail] [data-timeline-status="live"]')`, 15000));
            const base = live1 ? await h.ev(READ_RAIL) : null;
            // the later two first: the earlier two then arrive stamped before rows already shown
            await publish(h, ctx, "late", [
                ["final-ended", { round: 1, outcome: "passed" }, 60_000],
                ["task-skipped", { taskid: "t-3", by: "human" }, 300_000],
            ]);
            const shown = await polishWaitFor(h, `${TITLES}.includes("Final verification passed") && ${TITLES}.includes("Skipped")`, 8000);
            let kept = null;
            let expandedFirst = false;
            if (shown) {
                await h.ev(`${ROW("Final verification passed")}?.click()`);
                expandedFirst = await polishWaitFor(h, `${ROW("Final verification passed")}?.getAttribute("aria-expanded") === "true"`, 5000);
                await h.ev(`(() => { window.__k1113Row = ${ROW("Final verification passed")}; return true; })()`);
            }
            await publish(h, ctx, "early", [
                ["task-stalled", { taskid: "t-2" }, 600_000],
                ["task-forwarded", { taskid: "t-2", note: "needs a decision" }, 570_000],
            ]);
            const arrived = await polishWaitFor(h, `${TITLES}.includes("Handed to you")`, 8000);
            await polishWaitFor(h, `(${READ_RAIL})?.header === ${(base?.header ?? 0) + 4}`, 5000);
            if (arrived) {
                kept = await h.ev(`(() => {
                    const now = ${ROW("Final verification passed")};
                    const was = window.__k1113Row;
                    delete window.__k1113Row;
                    return { same: !!now && now === was, connected: was?.isConnected === true, expanded: now?.getAttribute("aria-expanded") === "true" };
                })()`);
            }
            const after = await h.ev(READ_RAIL);
            await h.shot("cdp-shots/kael1113-timeline-1-events.png");
            const at = (t) => after?.titles?.indexOf(t) ?? -1;
            rec(
                "1. a running dag's timeline: rows in time order, an open row kept when an earlier event arrives, and every count an event count",
                opened1 &&
                    live1 &&
                    base?.layout === "rail" &&
                    base.now &&
                    base.statuses.includes("live") &&
                    shown &&
                    expandedFirst &&
                    arrived &&
                    kept?.same &&
                    kept.connected &&
                    kept.expanded &&
                    at("Final verification passed") >= 0 &&
                    at("Final verification passed") < at("Skipped") &&
                    at("Skipped") < at("Handed to you") &&
                    after.header === base.header + 4 &&
                    after.all === after.header &&
                    after.attention === base.attention + 2,
                { opened1, live1, base, shown, expandedFirst, arrived, kept, after }
            );

            // 2. a narrow window: the lifecycle is a drawer, and the graph keeps the larger share
            let drawer = null;
            if (opened1) {
                await h.cdp("Emulation.setDeviceMetricsOverride", NARROW);
                const isDrawer = await polishWaitFor(h, `!!${MODAL}?.querySelector('[data-timeline-rail="drawer"]')`, 8000);
                if (isDrawer) {
                    await h.ev(`${MODAL}?.querySelector('[data-timeline-rail="drawer"] button[aria-expanded="false"]')?.click()`);
                    await polishWaitFor(h, `(${MODAL}?.querySelectorAll('[data-timeline-rail="drawer"] [data-timeline-row]').length ?? 0) > 0`, 8000);
                    await polishNap(1500);
                    drawer = await h.ev(READ_DRAWER);
                }
                await h.shot("cdp-shots/kael1113-timeline-2-drawer.png");
                await h.cdp("Emulation.setDeviceMetricsOverride", WIDE);
                await polishNap(1000);
            }
            rec(
                "2. a narrow window turns the lifecycle into a drawer with no activity strip, capped at 35% of the modal, and the graph's pane is taller than it",
                drawer != null &&
                    !drawer.strip &&
                    drawer.drawer <= drawer.cap + 2 &&
                    drawer.pane > drawer.drawer &&
                    drawer.whole >= 1,
                { drawer }
            );
            await closeDag(h);

            // 3. an ended run, its first event days back
            await seed(h, ctx, { status: "cancelled" }, { "t-2": { state: "failed", attempts: 1 }, "t-3": { state: "skipped" } });
            await publish(h, ctx, "old", [["run-created", {}, 3 * DAY_MS + 60 * 60_000]]);
            const opened3 = await openDag(h);
            const striped = opened3 && (await polishWaitFor(h, `!!${RAIL_IN_MODAL}?.querySelector("[data-timeline-strip]")`, 15000));
            const ended = striped ? await h.ev(READ_STRIP) : null;
            await h.shot("cdp-shots/kael1113-timeline-3-ended.png");
            rec(
                "3. an ended run's timeline: its axis ends 'ended <date time>' at its last event, its times carry the date, and no now marker or live pill is drawn",
                striped &&
                    ended?.cells?.length === 3 &&
                    DATED.test(ended.cells[0]) &&
                    ended.cells[1] === "3d" &&
                    DATED_END.test(ended.cells[2]) &&
                    ended.end === ended.cells[2] &&
                    !ended.now &&
                    !ended.statuses.includes("live") &&
                    ended.header > 0,
                { opened3, striped, ended }
            );
            await closeDag(h);

            // 4. a refresh that fails once is stale, and the hook asks again by itself
            const AS_OF = `[...document.querySelectorAll("[data-run-sheet-row]")].some((r) => /as of/.test(r.textContent))`;
            const stub = await stubDagStatus(
                h,
                `(call, state, args) => {
                    state.calls.push({ at: Date.now(), failed: state.failing });
                    return state.failing ? Promise.reject(new Error("k1113: the digest refresh failed")) : call(...args);
                }`
            );
            await h.ev(`(() => { window.__k1113Stub.state.failing = true; return true; })()`);
            const before = await h.ev(`${AS_OF}`);
            // child-ask-cleared is a kind that schedules a digest refresh and changes no dag version
            await publish(h, ctx, "refresh", [["child-ask-cleared", { taskid: "t-2" }, 0]]);
            const stale = await polishWaitFor(h, AS_OF, 10000);
            await h.shot("cdp-shots/kael1113-timeline-4-stale.png");
            const flippedAt = Date.now();
            await h.ev(`(() => { window.__k1113Stub.state.failing = false; return true; })()`);
            // the first wait before the hook asks again is 5s: nothing here asks for it
            const recovered = await polishWaitFor(h, `!(${AS_OF})`, 15000);
            const recoveredMs = Date.now() - flippedAt;
            const calls = await h.ev(`window.__k1113Stub?.state.calls ?? null`);
            await h.shot("cdp-shots/kael1113-timeline-4-recovered.png");
            rec(
                "4. a failed digest refresh reads as stale ('as of …'), and the hook's own retry recovers it with no further event",
                stub?.ok === true &&
                    before === false &&
                    stale &&
                    calls?.some((c) => c.failed) &&
                    recovered &&
                    calls.some((c) => !c.failed && c.at > flippedAt),
                { stub, before, stale, recovered, recoveredMs, calls }
            );
            return steps;
        },
        async teardown(h, ctx) {
            await teardownFixtureRun(h, ctx, "kael1113-timeline", {
                what: "restore RpcApi.DagStatusCommand and the viewport",
                fn: async () => {
                    await h.ev(RESTORE_STUB);
                    await h.cdp("Emulation.clearDeviceMetricsOverride", {});
                },
            });
        },
    };

    // --- kael1113-tree-lanes ------------------------------------------------------------------------------------------
    const RAIL_VISIBLE_KEY = "agent.rail.visible";
    const RAIL_SECTIONS_KEY = "cockpit.rail.sections";
    const TREE_COLLAPSED_KEY = "agent.tree.collapsed";
    const LEAD = "k1113 lanes lead";
    // three lanes of one task each: t-1 is the engine's (a real worker that does nothing); t-2 is seeded done and waiting at
    // the merge gate, t-3 failed Verify. Independent tasks, so each is its own lane's tip.
    const LANE_TASKS = [
        { id: "t-1", label: "noop", description: "do nothing, stop immediately", deps: [], gate: false, state: "" },
        { id: "t-2", label: "noop 2", description: "do nothing, stop immediately", deps: [], gate: false, state: "" },
        { id: "t-3", label: "noop 3", description: "do nothing, stop immediately", deps: [], gate: false, state: "" },
    ];
    const GATE_LINE = "merge ready · waits on t-3's failed Verify";
    const TREE_ROW = (id) => `document.querySelector('[data-agent-tree] [data-tree-task="${id}"]')`;
    // a task row of the tree: its second line, the dot or check before it, and the colour classes of both
    const READ_TREE_ROW = (id) => `(() => {
        const row = ${TREE_ROW(id)};
        if (!row) return null;
        const sub = [...row.querySelectorAll("span")].find((s) => s.children.length === 0 && s.textContent.trim().startsWith(${JSON.stringify(id + " ·")}));
        const dot = row.querySelector('span[class*="rounded-full"][class*="h-[7px]"]');
        return {
            sub: sub?.textContent.trim() ?? null,
            subTone: /text-error/.test(sub?.className ?? "") ? "error" : /text-warning/.test(sub?.className ?? "") ? "warning" : "muted",
            dot: dot ? (/bg-error/.test(dot.className) ? "error" : /bg-warning/.test(dot.className) ? "warning" : /border-muted/.test(dot.className) ? "hollow" : "other") : null,
            check: !!row.querySelector("svg.lucide-check"),
            pointer: /cursor-pointer/.test(row.className),
        };
    })()`;
    // each lane of the rail's Run section: its task, its words and how wide they are drawn
    const READ_LANES = `(() => {
        const aside = document.querySelector('aside[aria-label="Agent details"]');
        if (!aside) return null;
        return [...aside.querySelectorAll("[data-lane-text]")].map((t) => {
            const grid = t.parentElement;
            const nameBox = grid.children[1]?.getBoundingClientRect();
            return {
                name: (grid.children[1]?.firstElementChild?.textContent ?? "").trim(),
                text: t.textContent.trim(),
                textW: Math.round(t.getBoundingClientRect().width),
                nameW: Math.round(nameBox?.width ?? 0),
            };
        });
    })()`;

    // the lead's row once its run has nested it; clicked, so the Agent surface and its rail show the run
    async function focusLead(h, ctx) {
        await h.ev(`localStorage.setItem(${JSON.stringify(RAIL_VISIBLE_KEY)}, "true")`);
        await h.ev(`localStorage.removeItem(${JSON.stringify(RAIL_SECTIONS_KEY)})`);
        await h.ev(`localStorage.removeItem(${JSON.stringify(TREE_COLLAPSED_KEY)})`);
        await h.ev("location.reload()");
        await polishWaitFor(h, `!!window.TabRpcClient && !!document.querySelector("nav button")`, 30000);
        await h.goto("agent");
        ctx.leadFocused = await h.ev(`(async () => {
            const leadRow = () => {
                const tree = document.querySelector("[data-agent-tree]");
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

    const restoreKey = (key, prev) =>
        prev == null ? `localStorage.removeItem(${JSON.stringify(key)})` : `localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(prev)})`;

    const treeLanes = {
        name: "kael1113-tree-lanes",
        surface: "agent",
        async arrange(h) {
            await h.cdp("Emulation.setDeviceMetricsOverride", WIDE);
            const ctx = {
                cwd: mkdtempSync(join(tmpdir(), "verify-kael1113-lanes-")),
                prevRail: await h.ev(`localStorage.getItem(${JSON.stringify(RAIL_VISIBLE_KEY)})`),
                prevSections: await h.ev(`localStorage.getItem(${JSON.stringify(RAIL_SECTIONS_KEY)})`),
                prevCollapsed: await h.ev(`localStorage.getItem(${JSON.stringify(TREE_COLLAPSED_KEY)})`),
            };
            // a throw past this point still returns ctx, so teardown removes whatever was already made
            try {
                await arrangeFixtureRun(h, ctx, "kael1113-lanes", LEAD);
                await h.rpc("dagsubmit", {
                    channelid: ctx.channelId,
                    runid: ctx.runId,
                    title: "verify kael1113 lanes",
                    parallelism: 1,
                    tasks: LANE_TASKS,
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

            // t-2 done and unmerged, t-3 failed Verify; then the digest patched on the page, and a refresh asked for
            await seed(h, ctx, {}, { "t-2": { state: "done" }, "t-3": { state: "verify-failed", attempts: 1 } });
            const stub = await stubDagStatus(
                h,
                `async (call, state, args) => {
                    const rtn = await call(...args);
                    state.calls.push({ at: Date.now() });
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
            // child-ask-cleared is a kind the lineage store reloads a digest on, and it changes no dag version
            await publish(h, ctx, "lanes", [["child-ask-cleared", { taskid: "t-2" }, 0]]);
            const gated = await polishWaitFor(h, `(${READ_TREE_ROW("t-2")})?.sub?.includes(${JSON.stringify(GATE_LINE)}) === true`, 15000);
            const t2 = await h.ev(READ_TREE_ROW("t-2"));
            const t3 = await h.ev(READ_TREE_ROW("t-3"));
            const lanes = await h.ev(READ_LANES);
            await h.shot("cdp-shots/kael1113-tree-lanes-1-wide.png");
            const laneOf = (rows, re) => rows?.find((l) => re.test(l.text));
            rec(
                "1. in the Agent tree a failed task has an error dot and sub, and a done tip held at the merge gate stays among the live rows with the gate's line and a wait dot",
                stub?.ok === true &&
                    gated &&
                    t3?.dot === "error" &&
                    t3.subTone === "error" &&
                    /verify failed/.test(t3.sub ?? "") &&
                    t2?.sub?.includes(GATE_LINE) &&
                    t2.dot === "hollow" &&
                    !t2.check,
                { stub, gated, t2, t3 }
            );
            const gateLane = laneOf(lanes, /merge ready/);
            const failedLane = laneOf(lanes, /verify-failed/);
            rec(
                "2. the rail's lanes read the same lines, the gate's text capped at 120px so it wraps and the lane's name keeps its room",
                gateLane?.text === GATE_LINE &&
                    failedLane != null &&
                    gateLane.textW <= 121 &&
                    gateLane.nameW >= 40 &&
                    failedLane.nameW >= 40,
                { lanes }
            );

            // the same at the narrow width
            await h.cdp("Emulation.setDeviceMetricsOverride", NARROW);
            await polishNap(1500);
            const t2n = await h.ev(READ_TREE_ROW("t-2"));
            const t3n = await h.ev(READ_TREE_ROW("t-3"));
            const lanesN = await h.ev(READ_LANES);
            await h.shot("cdp-shots/kael1113-tree-lanes-2-narrow.png");
            await h.cdp("Emulation.setDeviceMetricsOverride", WIDE);
            await polishNap(800);
            const gateN = laneOf(lanesN, /merge ready/);
            rec(
                "3. at 1000x700 the tree and the lanes read the same",
                t3n?.dot === "error" &&
                    t2n?.sub?.includes(GATE_LINE) &&
                    t2n.dot === "hollow" &&
                    gateN?.text === GATE_LINE &&
                    gateN.textW <= 121 &&
                    laneOf(lanesN, /verify-failed/) != null,
                { t2n, t3n, lanesN }
            );

            // a task row with no session to open opens the run's DAG at its task
            const pointer = (await h.ev(READ_TREE_ROW("t-3")))?.pointer === true;
            await h.ev(`${TREE_ROW("t-3")}?.click()`);
            const modal = await polishWaitFor(h, `!!${MODAL}`, 10000);
            const selected = modal && (await polishWaitFor(h, `!!${MODAL}?.querySelector('[data-dag-node="t-3"][aria-pressed="true"]')`, 8000));
            await h.shot("cdp-shots/kael1113-tree-lanes-3-open-dag.png");
            rec(
                "4. clicking the failed t-3's row, which has no session, opens the run's DAG with t-3 selected",
                pointer && modal && selected,
                { pointer, modal, selected }
            );
            if (modal) await closeDag(h);
            return steps;
        },
        async teardown(h, ctx) {
            await teardownFixtureRun(h, ctx, "kael1113-tree-lanes", {
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

    return [timeline, treeLanes];
}
