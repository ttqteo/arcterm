// The run office's CDP scenarios (docs/superpowers/specs/2026-10-14-run-office-design.md).
//
// jarvis-office first drives the live wiring on a real deferred orchestrator run with a dag (the fixture helpers of
// scenarios.mjs, docs/reference/cdp-run-fixtures.md): off by default, the run's floor under its row, a pending desk
// opening the run sheet, the lead opening its agent. It then draws every pose from a fixture and checks each desk says
// what it is. jarvis-office-bench holds the spec's budgets: it draws 104 desks and reads Performance.getMetrics with
// the office off, open, held open for 30 s, held under reduced motion, and off again. The fixture floors come through
// the DEV-only __officeFixture hook (officedevhooks.ts), so the bench starts no run or worker.
//
// scenarios.mjs hands its fixture helpers in (makeOfficeScenarios) rather than this file importing them, which would
// make the two modules import each other.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const OFFICE_KEY = "jarvis.office.on";
const TOGGLE = `document.querySelector("[data-jarvis-office-toggle]")`;
const TASK_STATES = [
    "pending", "ready", "running", "stalled", "reviewing", "review-failed", "blocked-merge",
    "verifying", "verify-failed", "done", "failed", "cancelled", "skipped",
];
const STAGES = ["working", "plan-review", "wrapping-up", "final-check", "working", "land-held", "planning", "working"];

// the bench's floors: nRuns runs of nTasks tasks, states dealt round the engine's thirteen
function fixtureRuns(nRuns, nTasks) {
    return Array.from({ length: nRuns }, (_, r) => ({
        title: `Fixture run ${r + 1}`,
        run: {
            runId: `fx-${r}`,
            stage: STAGES[r % STAGES.length],
            tasks: Array.from({ length: nTasks }, (_, t) => ({
                id: `fx-${r}-t${t + 1}`,
                label: `Fixture task ${t + 1}`,
                state: TASK_STATES[(t + r) % TASK_STATES.length],
                runid: `fx-${r}-w${t + 1}`,
            })),
        },
        // one worker at a prompt, so the raised hand is on the floor
        agents: r === 0 ? [{ id: "fx-ask", runId: "fx-0-w3", state: "asking" }] : [],
    }));
}

// every engine task state on a floor, at most six task desks to a floor so none scrolls sideways in the main column
// and the shot shows every pose. The second floor's fifth desk is a running task whose worker is at a prompt: the raised
// hand, with the first floor's running desk still showing the typing pose. The leads sit at three different stages.
const POSE_FLOORS = [
    { title: "Every task state · 1 of 3", stage: "working", states: TASK_STATES.slice(0, 5) },
    { title: "Every task state · 2 of 3", stage: "wrapping-up", states: [...TASK_STATES.slice(5, 9), "running"], asking: 4 },
    { title: "Every task state · 3 of 3", stage: "land-held", states: TASK_STATES.slice(9) },
];

function poseFixtureRuns() {
    return POSE_FLOORS.map((f, r) => ({
        title: f.title,
        run: {
            runId: `fx-pose-${r}`,
            stage: f.stage,
            tasks: f.states.map((state, t) => ({
                id: `fx-pose-${r}-t${t + 1}`,
                label: `Fixture task ${t + 1}`,
                state,
                runid: `fx-pose-${r}-w${t + 1}`,
            })),
        },
        agents: f.asking == null ? [] : [{ id: "fx-ask", runId: `fx-pose-${r}-w${f.asking + 1}`, state: "asking" }],
    }));
}

async function setOffice(h, on) {
    return h.ev(`(async () => {
        const b = ${TOGGLE};
        if (!b) return "no toggle";
        if ((b.getAttribute("aria-pressed") === "true") !== ${on}) b.click();
        for (let i = 0; i < 40 && (${TOGGLE}.getAttribute("aria-pressed") === "true") !== ${on}; i++) {
            await new Promise((r) => setTimeout(r, 50));
        }
        return ${TOGGLE}.getAttribute("aria-pressed");
    })()`);
}

// the toggle is in the Runs region, which the Brief draws as skeletons until its snapshot loads (a fresh store, or
// right after a reload), so a scenario waits for it. Returns null when it is there, else what was missing.
async function waitForToggle(h) {
    return h.ev(`(async () => {
        for (let i = 0; i < 120 && !${TOGGLE}; i++) await new Promise((r) => setTimeout(r, 250));
        return ${TOGGLE} ? null : "after 30 s the Brief's Runs region has no office toggle";
    })()`);
}

// the dev hooks load by dynamic import after the Brief mounts (a reload, or the previous scenario's teardown reload,
// leaves a gap), so a scenario waits for them as brief-run-sheet-order waits for __openAddress, then for the toggle.
// Returns null when the Brief has what the scenario needs, else what was missing.
async function waitForOfficeSeams(h) {
    const hooks = await h.ev(`(async () => {
        const missing = () => ["__officeFixture", "__officeProbe"].filter((k) => typeof window[k] !== "function");
        for (let i = 0; i < 20 && missing().length; i++) await new Promise((r) => setTimeout(r, 250));
        return missing().length ? "after 5 s the page has no " + missing().join(", ") : null;
    })()`);
    return hooks ?? (await waitForToggle(h));
}

async function metrics(h) {
    await h.cdp("HeapProfiler.collectGarbage");
    const { metrics: list } = await h.cdp("Performance.getMetrics");
    const m = Object.fromEntries(list.map((x) => [x.name, x.value]));
    return { heap: m.JSHeapUsedSize, nodes: m.Nodes, task: m.TaskDuration };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mb = (bytes) => Math.round((bytes / (1024 * 1024)) * 100) / 100;

// fx: { arrangeFixtureRun, waitForDispatch, briefReload, teardownFixtureRun, tasks, leadId } from scenarios.mjs
export function makeOfficeScenarios(fx) {
    const jarvisOffice = {
        name: "jarvis-office",
        surface: "jarvis",
        async arrange(h) {
            const ctx = { cwd: mkdtempSync(join(tmpdir(), "verify-office-")) };
            // a throw past this point still returns ctx, so teardown removes whatever was already made
            try {
                // no stored choice, so the reload below shows the default
                ctx.stored = await h.ev(`(() => {
                    try {
                        const v = localStorage.getItem(${JSON.stringify(OFFICE_KEY)});
                        localStorage.removeItem(${JSON.stringify(OFFICE_KEY)});
                        return v;
                    } catch {
                        return null;
                    }
                })()`);
                ctx.cleared = true;
                await fx.arrangeFixtureRun(h, ctx, "office", "office lead");
                await h.rpc("dagsubmit", {
                    channelid: ctx.channelId,
                    runid: ctx.runId,
                    title: "verify office",
                    parallelism: 1,
                    tasks: fx.tasks,
                });
                // waited for so teardown has t-1's worker block to delete
                await fx.waitForDispatch(h, ctx, "t-1");
                // the roster fixture is read once at boot, and the Brief reads a boot-primed snapshot
                await fx.briefReload(h);
            } catch (e) {
                ctx.arrangeError = String(e?.message ?? e);
            }
            return ctx;
        },
        async assert(h, ctx) {
            const steps = [];
            const rec = (step, ok, detail) => steps.push({ step, ok, detail });
            rec(
                "0. a deferred run with a three-task dag and its lead are up",
                ctx.arrangeError == null,
                ctx.arrangeError ?? JSON.stringify({ runId: ctx.runId, dispatched: ctx.dispatched })
            );
            if (ctx.arrangeError != null) return steps;
            const FLOOR = `document.querySelector('[data-office-floor="${ctx.runId}"]')`;
            const desk = (key) => `${FLOOR}?.querySelector('[data-office-desk="${key}"]')`;

            // the Brief is still drawing skeletons for a moment after the reload
            const noToggle = await waitForToggle(h);
            const off = await h.ev(`({
                pressed: ${TOGGLE}?.getAttribute("aria-pressed"),
                floors: document.querySelectorAll("[data-office-floor]").length,
            })`);
            rec(
                "1. with no stored choice the office is off and draws no floor",
                noToggle == null && off.pressed === "false" && off.floors === 0,
                noToggle ?? JSON.stringify(off)
            );
            if (noToggle != null) return steps;

            await setOffice(h, true);
            const live = await h.ev(`(async () => {
                for (let i = 0; i < 100 && !${FLOOR}; i++) await new Promise((r) => setTimeout(r, 100));
                const floor = ${FLOOR};
                if (!floor) return { floor: false };
                // the floor's wrapper follows the run's row inside the row's motion.div
                const prev = floor.parentElement?.previousElementSibling;
                const row = prev?.matches('[data-jarvis-brief-row="session"]') || !!prev?.querySelector('[data-jarvis-brief-row="session"]');
                const desks = [...floor.querySelectorAll("[data-office-desk]")].map((d) => d.dataset.officeDesk);
                return { floor: true, row, desks };
            })()`);
            rec(
                "2. turning it on draws the run's floor right under its row: the lead and a desk per task",
                live.floor && live.row && ["lead", "t-1", "t-2", "t-3"].every((k) => live.desks?.includes(k)),
                JSON.stringify(live)
            );
            await h.shot("cdp-shots/jarvis-office-live.png");

            // a task whose dependency has not finished has no worker, so its desk opens the run; the first pending
            // desk rather than t-2, which becomes ready if t-1's no-op worker finishes before this step
            const sheet = await h.ev(`(async () => {
                const pick = () => ${FLOOR}?.querySelector('[data-office-desk][data-office-state="pending"]');
                const target = pick();
                const key = target?.dataset.officeDesk;
                target?.click();
                for (let i = 0; i < 60 && !document.querySelector("[data-run-sheet]"); i++) await new Promise((r) => setTimeout(r, 100));
                for (let i = 0; i < 20 && !${FLOOR}?.classList.contains("bg-surface-selected"); i++) await new Promise((r) => setTimeout(r, 100));
                return {
                    desk: key,
                    state: target?.dataset.officeState,
                    sheet: !!document.querySelector("[data-run-sheet]"),
                    selected: !!${FLOOR}?.classList.contains("bg-surface-selected"),
                };
            })()`);
            rec(
                "3. clicking a pending desk (no agent) opens the run sheet and marks the floor selected",
                sheet.state === "pending" && sheet.sheet && sheet.selected,
                JSON.stringify(sheet)
            );
            await h.shot("cdp-shots/jarvis-office-selected.png");

            const lead = await h.ev(`(async () => {
                ${desk("lead")}?.click();
                const row = () => document.querySelector('[data-agent-row="${fx.leadId}"]');
                for (let i = 0; i < 60 && !row()?.classList.contains("bg-surface-selected"); i++) await new Promise((r) => setTimeout(r, 100));
                return { row: !!row(), selected: !!row()?.classList.contains("bg-surface-selected") };
            })()`);
            rec("4. clicking the lead's desk opens the lead's agent", lead.selected, JSON.stringify(lead));
            await h.goto("jarvis");

            const missing = await waitForOfficeSeams(h);
            if (missing != null) {
                rec("5. the fixture floors drew", false, missing);
                return steps;
            }
            await h.ev(`window.__officeFixture(${JSON.stringify(poseFixtureRuns())})`);
            await setOffice(h, true);
            const seen = await h.ev(`(async () => {
                for (let i = 0; i < 60 && !document.querySelector("[data-office-fixture] [data-office-desk]"); i++) {
                    await new Promise((r) => setTimeout(r, 100));
                }
                const floors = [...document.querySelectorAll("[data-office-fixture] [data-office-floor]")];
                const desks = [...document.querySelectorAll("[data-office-fixture] [data-office-desk]")];
                return {
                    floors: floors.length,
                    widest: Math.max(0, ...floors.map((f) => f.querySelectorAll('[data-office-desk]:not([data-office-desk="lead"])').length)),
                    // a floor wider than the column scrolls inside it, and its later poses are off the shot
                    scrolls: floors.filter((f) => f.scrollWidth > f.clientWidth + 1).length,
                    states: [...new Set(desks.filter((d) => d.dataset.officeDesk !== "lead").map((d) => d.dataset.officeState))],
                    leads: desks.filter((d) => d.dataset.officeDesk === "lead").length,
                    unlabelled: desks.filter((d) => !d.textContent.trim()).length,
                    needsYou: desks.filter((d) => d.dataset.officePose === "handup" && d.textContent.includes("Needs you")).length,
                    imgs: desks.flatMap((d) => [...d.querySelectorAll("img")]).filter((i) => !i.src.startsWith("data:image/png")).length,
                };
            })()`);
            rec("5. the fixture floors drew", seen?.leads === POSE_FLOORS.length, JSON.stringify(seen));
            rec(
                "6. every engine task state has a desk",
                TASK_STATES.every((s) => seen?.states?.includes(s)),
                JSON.stringify(seen?.states)
            );
            rec("7. every desk says what it is in words", seen?.unlabelled === 0, `unlabelled: ${seen?.unlabelled}`);
            rec("8. the asking worker raises a hand and reads Needs you", seen?.needsYou === 1, `needsYou: ${seen?.needsYou}`);
            rec("9. every person is a drawn sprite", seen?.imgs === 0, `undrawn: ${seen?.imgs}`);
            const probe = await h.ev(`window.__officeProbe()`);
            rec("10. every office colour token resolves", probe?.unresolved?.length === 0, JSON.stringify(probe?.unresolved));
            rec(
                "11. no fixture floor holds more than six task desks or scrolls sideways, so the shot shows every pose",
                seen?.widest <= 6 && seen?.scrolls === 0,
                `widest ${seen?.widest} task desks, ${seen?.scrolls} scrolling`
            );
            await h.ev(`document.querySelector("[data-office-fixture]")?.scrollIntoView({ block: "start" })`);
            await h.shot("cdp-shots/jarvis-office.png");
            await setOffice(h, false);
            const gone = await h.ev(`document.querySelectorAll("[data-office-floor]").length`);
            rec("12. turning it off removes every floor", gone === 0, `floors left: ${gone}`);
            return steps;
        },
        async teardown(h, ctx) {
            await h.ev(`window.__officeFixture?.(null)`);
            // teardownFixtureRun reloads after restore, so the toggle comes back as it was from storage
            await fx.teardownFixtureRun(h, ctx, "jarvis-office", {
                what: "restore the office toggle",
                fn: () =>
                    ctx.cleared &&
                    h.ev(`(() => {
                        const v = ${JSON.stringify(ctx.stored ?? null)};
                        if (v == null) localStorage.removeItem(${JSON.stringify(OFFICE_KEY)});
                        else localStorage.setItem(${JSON.stringify(OFFICE_KEY)}, v);
                    })()`),
            });
        },
    };
    return { jarvisOffice, jarvisOfficeBench };
}

const jarvisOfficeBench = {
    name: "jarvis-office-bench",
    surface: "jarvis",
    async arrange(h) {
        return {};
    },
    async assert(h, ctx) {
        const steps = [];
        const rec = (step, ok, detail) => steps.push({ step, ok, detail });
        const missing = await waitForOfficeSeams(h);
        if (missing != null) {
            rec("0. the bench drew 104 desks", false, missing);
            return steps;
        }
        ctx.wasOn = (await h.ev(`${TOGGLE}?.getAttribute("aria-pressed")`)) === "true";
        await h.cdp("Performance.enable");
        await setOffice(h, false);
        const runs = fixtureRuns(8, 12);
        const want = 8 * 13;
        await h.ev(`window.__officeFixture(${JSON.stringify(runs)})`);
        const closed = await metrics(h);

        const openMs = await h.ev(`(async () => {
            const t0 = performance.now();
            ${TOGGLE}.click();
            for (let i = 0; i < 300 && document.querySelectorAll("[data-office-fixture] [data-office-desk]").length < ${want}; i++) {
                await new Promise((r) => requestAnimationFrame(r));
            }
            await new Promise((r) => requestAnimationFrame(r));
            return performance.now() - t0;
        })()`);
        await sleep(2000);
        const open = await metrics(h);
        await sleep(30000);
        const held = await metrics(h);
        const probe = await h.ev(`window.__officeProbe()`);

        await h.cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
        await sleep(500);
        const calmStart = await metrics(h);
        const calmClock = (await h.ev(`window.__officeProbe()`)).clock;
        await sleep(30000);
        const calmEnd = await metrics(h);
        await h.cdp("Emulation.setEmulatedMedia", { features: [] });

        await setOffice(h, false);
        await sleep(500);
        const after = await metrics(h);
        const offProbe = await h.ev(`window.__officeProbe()`);

        const r = {
            desks: probe.desks,
            heapOpenMB: mb(open.heap - closed.heap),
            nodesAdded: open.nodes - closed.nodes,
            busyPct: Math.round(((held.task - open.task) / 30) * 1000) / 10,
            busyReducedPct: Math.round(((calmEnd.task - calmStart.task) / 30) * 1000) / 10,
            cache: probe.cache,
            heapAfterOffMB: mb(after.heap - closed.heap),
            openMs: Math.round(openMs),
            clockReduced: calmClock,
            clockOff: offProbe.clock,
        };
        ctx.result = r;
        const d = JSON.stringify(r);
        rec("0. the bench drew 104 desks", r.desks >= want, d);
        rec("1. JS heap open minus closed <= 5 MB", r.heapOpenMB <= 5, `${r.heapOpenMB} MB`);
        rec("2. DOM nodes added <= 2,000", r.nodesAdded <= 2000, `${r.nodesAdded}`);
        rec("3. main thread busy over 30 s <= 2 %", r.busyPct <= 2, `${r.busyPct} %`);
        rec("4. busy under reduced motion <= 0.5 %, clock stopped", r.busyReducedPct <= 0.5 && r.clockReduced === false, `${r.busyReducedPct} %, clock ${r.clockReduced}`);
        rec("5. sprite cache <= 320 entries", r.cache <= 320, `${r.cache}`);
        rec("6. heap after turning it off <= 1 MB over closed, clock stopped", r.heapAfterOffMB <= 1 && r.clockOff === false, `${r.heapAfterOffMB} MB, clock ${r.clockOff}`);
        rec("7. toggle to floors drawn <= 150 ms", r.openMs <= 150, `${r.openMs} ms`);
        console.log(`[jarvis-office-bench] ${d}`);
        return steps;
    },
    async teardown(h, ctx) {
        await h.cdp("Emulation.setEmulatedMedia", { features: [] });
        await h.ev(`window.__officeFixture?.(null)`);
        if (ctx.wasOn !== undefined) await setOffice(h, ctx.wasOn);
    },
};
