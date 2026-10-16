// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Cockpit office's scenarios (docs/superpowers/specs/2026-10-15-cockpit-office-design.md). cockpit-office draws
// the canvas's boards (Main, NextAsk, Night, Tired, States, RamPanel) on a fixture roster, one real run held in
// planning (its table opens a real LeadCard) and fixture runs handed in through the DEV-only hooks
// (frontend/app/view/agents/cockpitofficedevhooks.ts), and drives the boss with real keys.
// cockpit-office-floors (docs/superpowers/specs/2026-10-16-office-floors-design.md) drives the building of floors: the lift, the
// ride, carrying a room by keys and by mouse, the chip, and what a room holds at three window sizes.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { officeRunWorker, SCENARIOS as ROSTERS } from "../cockpit-fixtures/scenarios.mjs";

export const FIXTURE = new URL("../../public/cockpit-fixtures/active.json", import.meta.url);
export const VIEW_KEY = "cockpit.view";
const KEY_CODES = {
    ArrowUp: 38,
    ArrowDown: 40,
    ArrowLeft: 37,
    ArrowRight: 39,
    Escape: 27,
    Enter: 13,
    " ": 32,
    PageUp: 33,
    PageDown: 34,
    f: 70,
    g: 71,
    h: 72,
    j: 74,
    k: 75,
    l: 76,
    m: 77,
    n: 78,
    o: 79,
    s: 83,
    1: 49,
};
// the boss's walking speed (officeboss.ts BOSS_SPEED), for how long to hold an arrow
const BOSS_PX_PER_S = 240;
// half the boss's body (officeplanmodel.ts BOSS_HALF_W): how far off a side wall its feet stop
const BOSS_HALF_W = 30;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HOLD_MS = 30000;
// main thread busy as a percent of a window: a TaskDuration delta (seconds) over its length, to 0.1
const busyPct = (from, to) => ((to.task - from.task) / (HOLD_MS / 1000)) * 100;
const round1 = (n) => Math.round(n * 10) / 10;
const mb = (bytes) => Math.round((bytes / (1024 * 1024)) * 100) / 100;

async function metrics(h) {
    // React's dev build logs every component render as a performance.measure entry that the page keeps (~50 a second
    // here, tens of thousands in a session), so the heap would read the app's own rendering, not the office's
    await h.ev("performance.clearMeasures()");
    await h.cdp("HeapProfiler.collectGarbage");
    const { metrics: list } = await h.cdp("Performance.getMetrics");
    const m = Object.fromEntries(list.map((x) => [x.name, x.value]));
    return { heap: m.JSHeapUsedSize, nodes: m.Nodes, task: m.TaskDuration };
}

// fixture runs the office draws after the live ones
function devRuns(prefix, specs) {
    return specs.map(([title, project, states], r) => ({
        id: `${prefix}-${r + 1}`,
        title,
        project,
        createdTs: r + 1,
        done: false,
        leadAsking: false,
        tasks: states.map((state, t) => ({ id: `t${t + 1}`, label: `${title} task ${t + 1}`, state, asking: false })),
    }));
}
export const OFFICE_RUNS = devRuns("fx-office-run", [
    ["Canvas gallery", "arcterm", ["done", "reviewing", "running"]],
    ["Billing export", "mozox", ["done", "done", "running", "running", "stalled", "failed", "pending"]],
]);
// Main's runs with Billing export's task 3, on its table's near side, asking (step 1c)
const NEAR_ASK_RUNS = OFFICE_RUNS.map((r) =>
    r.title !== "Billing export" ? r : { ...r, tasks: r.tasks.map((t) => (t.id === "t3" ? { ...t, asking: true } : t)) }
);
const BENCH_STATES = ["running", "running", "running", "done", "done", "reviewing", "pending", "stalled"];
export const BENCH_RUNS = devRuns("fx-bench-run", [
    ["Bench run one", "arcterm", BENCH_STATES],
    ["Bench run two", "mozox", BENCH_STATES],
    ["Bench run three", "thesis", BENCH_STATES],
]);

// the floors canvas's Main board (docs/superpowers/specs/2026-10-16-office-floors-design.md): nine projects over three
// floors. Its roster is the office-floors fixture's (scripts/cockpit-fixtures/scenarios.mjs); which floor and slot a
// project has is the viewer's arrangement, which the office keeps in localStorage under LAYOUT_KEY
export const OFFICE_FLOORS_LAYOUT = {
    v: 1,
    rooms: {
        Home: { floor: 0, slot: 0 },
        "portfolio-journal": { floor: 0, slot: 1 },
        "vnstock-js": { floor: 0, slot: 2 },
        "vnstock-js-docs": { floor: 0, slot: 3 },
        arcterm: { floor: 1, slot: 0 },
        "cuscofi-app": { floor: 1, slot: 1 },
        "mit-thesis": { floor: 1, slot: 2 },
        "cuscofi-production": { floor: 1, slot: 3 },
        chotkeo: { floor: 2, slot: 0 },
    },
};
export const LAYOUT_KEY = "cockpit.office.layout";
// a run as the office plan reads it: a task is its state in the canvas's words, "ask" a running one that asks
const FLOORS_TASK_STATE = { done: "done", work: "running", wait: "pending", ask: "running", fail: "failed" };
function floorsRun(n, title, project, { done = false, lead = "sit", tasks }) {
    return {
        id: `fx-floors-run-${n}`,
        title,
        project,
        createdTs: n,
        done,
        leadAsking: lead === "hand",
        tasks: tasks.map((t, i) => ({ id: `t${i + 1}`, label: `${title} task ${i + 1}`, state: FLOORS_TASK_STATE[t], asking: t === "ask" })),
    };
}
export const OFFICE_FLOORS_RUNS = [
    floorsRun(1, "Price feed retry", "vnstock-js", { tasks: ["done", "work", "wait"] }),
    floorsRun(2, "Land queue", "arcterm", { tasks: ["done", "done", "work", "work", "wait", "wait", "wait"] }),
    floorsRun(3, "Canvas gallery", "arcterm", { tasks: ["done", "ask", "work"] }),
    floorsRun(4, "Tray popover", "arcterm", { done: true, tasks: ["done", "done"] }),
    floorsRun(5, "Menu sync", "cuscofi-app", { lead: "hand", tasks: ["done", "work", "work", "fail"] }),
];
// the Capacity board's fourth run, at work: with it arcterm's 1,600 x 1,000 room has three tables for the three at work
// and the done one in its chip
export const OFFICE_FLOORS_FOURTH_RUN = floorsRun(6, "Office floors", "arcterm", { tasks: ["work", "wait", "wait", "wait", "wait"] });

// a real key on the page: keyDown, keyUp, or both
export async function key(h, k, type = "both") {
    const code = k === " " ? "Space" : k.length === 1 ? (/\d/.test(k) ? `Digit${k}` : `Key${k.toUpperCase()}`) : k;
    const base = { key: k, code, windowsVirtualKeyCode: KEY_CODES[k] };
    if (type !== "up") await h.cdp("Input.dispatchKeyEvent", { type: "keyDown", ...base, ...(k.length === 1 ? { text: k } : {}) });
    if (type !== "down") await h.cdp("Input.dispatchKeyEvent", { type: "keyUp", ...base });
}

// holds a key for ms: the boss walks while an arrow is down
export async function hold(h, k, ms) {
    await key(h, k, "down");
    await sleep(ms);
    await key(h, k, "up");
}

export const probe = (h) => h.ev("window.__cockpitOfficeProbe ? window.__cockpitOfficeProbe() : null");
export const dev = (h, o) => h.ev(`window.__cockpitOffice(${JSON.stringify(o)})`);
export const focusCockpit = (h) => h.ev(`document.querySelector("[data-cockpit-surface]")?.focus()`);

// the office and its hooks load after a reload; null when both are there, else what is missing
export async function waitForOffice(h) {
    return h.ev(`(async () => {
        const ready = () => typeof window.__cockpitOffice === "function" && !!document.querySelector("[data-cockpit-office] [data-office-desk]");
        for (let i = 0; i < 120 && !ready(); i++) await new Promise((r) => setTimeout(r, 250));
        return ready() ? null : "after 30 s the Cockpit shows no office or its dev hooks";
    })()`);
}

// waits until the boss stands still and no path hint shows, up to ms
export async function settleBoss(h, ms = 4000) {
    for (let t = 0; t < ms; t += 100) {
        const p = await probe(h);
        if (p?.boss && !p.boss.moving && p.dots === 0) return p;
        await sleep(100);
    }
    return probe(h);
}

const desk = (id) => `[data-office-desk="${id}"]`;

// the Office's box as the plan reads it: the scroller's content box, under its gutters, the HUD bar's space and its foot
// (cockpitoffice.tsx), plus the window around it
const readBox = (h) =>
    h.ev(`(() => {
        const el = document.querySelector("[data-cockpit-office]");
        const s = getComputedStyle(el);
        const px = (v) => parseFloat(v) || 0;
        return {
            w: el.clientWidth - px(s.paddingLeft) - px(s.paddingRight),
            h: Math.floor(el.clientHeight - px(s.paddingTop) - px(s.paddingBottom)),
            vw: window.innerWidth,
            vh: window.innerHeight,
        };
    })()`);

// sets the window so the Office's box is w x h, within 2 px: the chrome around the box is what the window has over it,
// and a scrollbar a taller floor brings takes some of the width, so it is read again until the box is the one asked for
export async function sizeOfficeBox(h, w, hgt) {
    let box = await readBox(h);
    for (let i = 0; i < 5; i++) {
        await h.cdp("Emulation.setDeviceMetricsOverride", {
            width: Math.round(w + box.vw - box.w),
            height: Math.round(hgt + box.vh - box.h),
            deviceScaleFactor: 1,
            mobile: false,
        });
        await sleep(500);
        box = await readBox(h);
        if (Math.abs(box.w - w) <= 2 && Math.abs(box.h - hgt) <= 2) break;
    }
    return box;
}

// the page's pixel for a point of the plan (the Office root's top left is its origin), the root scrolled into view first
export const pagePoint = (h, x, y) =>
    h.ev(`(() => {
        const r = document.querySelector("[data-office-root]").getBoundingClientRect();
        return { x: Math.round(r.left + ${x}), y: Math.round(r.top + ${y}) };
    })()`);

// a real mouse event at a pixel of the page
export const mousePage = (h, type, x, y) =>
    h.cdp("Input.dispatchMouseEvent", {
        type,
        x: Math.round(x),
        y: Math.round(y),
        button: type === "mouseMoved" ? "none" : "left",
        buttons: type === "mouseReleased" ? 0 : 1,
        clickCount: type === "mouseMoved" ? 0 : 1,
    });

// a real mouse event at a point of the plan
export async function mouse(h, type, x, y) {
    const p = await pagePoint(h, x, y);
    await mousePage(h, type, p.x, p.y);
    return p;
}

// a shot of one box of the plan, recorded as h.shot records a shot
export async function clipShot(h, name, box, pad = 6) {
    const a = await pagePoint(h, box.x - pad, box.y - pad);
    const { data } = await h.cdp("Page.captureScreenshot", {
        format: "png",
        clip: { x: Math.max(0, a.x), y: Math.max(0, a.y), width: box.w + 2 * pad, height: box.h + 2 * pad, scale: 1 },
    });
    const path = `cdp-shots/${name}.png`;
    mkdirSync("cdp-shots", { recursive: true });
    writeFileSync(path, Buffer.from(data, "base64"));
    h.shots.push({ name, png: `${name}.png`, path });
}

// the notice board scenario's cursor key (officeplanmodel.ts BOARD_KEY), its initiative, and the localStorage key of the
// office's animation switch (officestore.ts)
const BOARD_KEY = "board:needs-you";
const BOARD_SOURCE = "Jarvis as graph";
const BOARD_QUOTE = "never leave files staged";
const BOARD_PLAN_KEY = "fx-board-plan";
const BOARD_LEARN_KEY = "learn:fx-board-rule";
const ANIMATION_KEY = "cockpit.office.animation";

// the Needs you rows the board scenario hands the office through the DEV hook (cockpitofficedevhooks.ts): a plan to
// review, whose oref is the initiative its Open lands on (buildNeedsYouRows reads the effort from oref), and a learned
// rule; n > 2 adds more learned rules
function boardRows(effortId, n = 2) {
    const since = Date.now() - 12 * 60_000;
    const rows = [
        {
            kind: "plan-review",
            key: BOARD_PLAN_KEY,
            source: BOARD_SOURCE,
            text: "4 proposed",
            why: "An agent proposed these chunks. They count once you accept them.",
            action: "Open",
            phaseidx: 0,
            waitingsince: since,
            oref: `effort:${effortId}`,
        },
        {
            kind: "learn-proposal",
            key: BOARD_LEARN_KEY,
            learnid: "skill:fx-board#stage",
            source: "Skill · commit",
            text: "Stage only the files a commit names.",
            why: `“${BOARD_QUOTE}”`,
            action: "Accept",
            phaseidx: 0,
            waitingsince: since,
        },
    ];
    for (let i = 3; i <= n; i++) {
        rows.push({
            kind: "learn-proposal",
            key: `learn:fx-board-rule-${i}`,
            learnid: `skill:fx-board#rule-${i}`,
            source: "Skill · commit",
            text: `A fixture rule, number ${i}.`,
            why: `“a fixture quote ${i}”`,
            action: "Accept",
            phaseidx: 0,
            waitingsince: since,
        });
    }
    return rows;
}
const setBoardRows = (h, rows) => h.ev(`window.__cockpitOfficeAttention(${JSON.stringify(rows)})`);
// how many drawn people show one of these sprites right now (data-office-sprite on each person's <img>)
const spriteCount = (h, names) =>
    h.ev(`[...document.querySelectorAll("[data-office-root] [data-office-sprite]")].filter((i) => ${JSON.stringify(names)}.includes(i.dataset.officeSprite)).length`);
// polls for ms until some person shows one of these sprites; the count seen, 0 if none
async function waitForSprite(h, names, ms) {
    for (let t = 0; t <= ms; t += 100) {
        const n = await spriteCount(h, names);
        if (n > 0) return n;
        await sleep(100);
    }
    return 0;
}
const toggleTo = (h, label) =>
    h.ev(`[...document.querySelectorAll("[data-cockpit-view-toggle] button")].find((b) => b.textContent.trim() === ${JSON.stringify(label)})?.click()`);

// the cockpit-office-controls run's plan, a chain as the Run board draws it. Only t-1 dispatches, one real worker told
// to do nothing, which teardownFixtureRun cancels and deletes (docs/reference/cdp-run-fixtures.md)
const OFFICE_RUN_TASKS = [
    "Machine stats, the memory-pressure event and the tray model",
    "Each agent's heaviest command and a Free up action",
    "The tray icon's pixels and the popover's shell",
    "The job queue and what waits on you, in the popover",
    "The tray's settings",
    "Docs and the changelog",
].map((label, i) => ({
    id: `t-${i + 1}`,
    label,
    description: "do nothing, make no file changes, stop immediately",
    deps: i === 0 ? [] : [`t-${i}`],
    gate: false,
    state: "",
}));

// reloads the page and opens the Office again on the floors fixture's runs, on a floor; null when it is there, else what
// is missing. The dev state (the runs, the floor) is in memory, so a reload loses it
async function reloadOffice(h, floor) {
    await h.reload();
    await h.goto("cockpit");
    const missing = await waitForOffice(h);
    if (!missing) await dev(h, { runs: OFFICE_FLOORS_RUNS, afterHours: false, energy: 63, entrance: "skip", ...(floor != null ? { floor } : {}) });
    return missing;
}

// fx: { arrangeFixtureRun, teardownFixtureRun } from scenarios.mjs
export function makeCockpitOfficeScenarios(fx) {
    // opts.roster names the roster (default "office"), opts.tasks a plan for the run
    async function arrangeOffice(h, opts = {}) {
        const ctx = {
            cwd: mkdtempSync(join(tmpdir(), "cockpit-office-")),
            prevFixture: existsSync(FIXTURE) ? readFileSync(FIXTURE, "utf8") : null,
        };
        await fx.arrangeFixtureRun(h, ctx, "cockpit-office", "office lead", { project: "arcterm" });
        // a plan gives the run's dialog box a task column and t-1 a worker's seat: wait for t-1's child run, the run id
        // its worker's roster entry carries
        if (opts.tasks) {
            await h.rpc("dagsubmit", { channelid: ctx.channelId, runid: ctx.runId, title: "Menu Bar and Tray Popover", parallelism: 1, tasks: opts.tasks });
            for (let waited = 0; waited < 60000 && !ctx.workerRunId; waited += 500) {
                const group = (await h.rpc("dagstatus", { channelid: ctx.channelId, runid: ctx.runId })).group;
                ctx.workerRunId = group?.tasks?.find((t) => t.id === "t-1")?.runid;
                if (!ctx.workerRunId) await sleep(500);
            }
        }
        // arrangeFixtureRun wrote its own roster around the run's lead: keep the lead, draw the office's roster
        const now = Date.now();
        const lead = JSON.parse(readFileSync(FIXTURE, "utf8")).find((a) => a.runId === ctx.runId);
        const worker = ctx.workerRunId ? [officeRunWorker(now, ctx.workerRunId)] : [];
        mkdirSync(new URL(".", FIXTURE), { recursive: true });
        writeFileSync(FIXTURE, JSON.stringify([...(lead ? [lead] : []), ...worker, ...ROSTERS[opts.roster ?? "office"](now)], null, 2));
        ctx.prevView = await h.ev(`localStorage.getItem(${JSON.stringify(VIEW_KEY)})`);
        await h.ev(`localStorage.setItem(${JSON.stringify(VIEW_KEY)}, JSON.stringify("office"))`);
        // the card starts small, whatever an earlier run left
        await h.ev(`localStorage.removeItem("cockpit.office.bigcard")`);
        // and the rooms start arranged automatically, not as an earlier run or the viewer left them
        ctx.prevLayout = await h.ev(`localStorage.getItem(${JSON.stringify(LAYOUT_KEY)})`);
        await h.ev(`localStorage.removeItem(${JSON.stringify(LAYOUT_KEY)})`);
        try {
            await h.ev("location.reload()");
        } catch {
            // the evaluate is cut off by the navigation it just started
        }
        // the old document can still answer for a moment after the reload starts
        await sleep(1500);
        for (let waited = 0; waited < 40000; waited += 500) {
            if (await h.ev("!!window.TabRpcClient && !!document.querySelector('nav button')").catch(() => false)) break;
            await sleep(500);
        }
        await h.goto("cockpit");
        ctx.missing = await waitForOffice(h);
        // the boss pet's entrance (a reload opens the first office of a launch) would play under the first steps' shots:
        // skip it, unless the scenario is about the entrance (cockpit-office-pet passes opts.entrance)
        if (!ctx.missing) await dev(h, { runs: OFFICE_RUNS, afterHours: false, energy: 63, ...(opts.entrance ? {} : { entrance: "skip" }) });
        return ctx;
    }
    const cockpitOffice = {
        name: "cockpit-office",
        surface: "cockpit",
        arrange: (h) => arrangeOffice(h),
        async assert(h, ctx) {
            const steps = [];
            const rec = (step, ok, detail) => steps.push({ step, ok: !!ok, detail });
            if (ctx.missing) {
                rec("0. the office loads", false, ctx.missing);
                return steps;
            }

            // 0. opening the office draws the boss at a desk with its card shut and a ↵ over the desk offering it
            let p = await settleBoss(h);
            rec(
                "0. opening the office draws the boss at a desk with its card shut, and a ↵ over the desk offers it",
                p?.boss && p.popup === "" && p.prompt !== "",
                JSON.stringify({ cursor: p?.cursor, popup: p?.popup, prompt: p?.prompt })
            );
            await h.shot("cdp-shots/cockpit-office-prompt.png");

            // 1. Main: quill's card beside its desk
            await h.ev(`document.querySelector(${JSON.stringify(desk("fx-office-quill"))})?.click()`);
            p = await settleBoss(h);
            rec(
                "1. a click on quill's desk walks the boss there and opens its dialog box",
                p?.cursor === "fx-office-quill" && p.dialog === "agent",
                JSON.stringify({ cursor: p?.cursor, dialog: p?.dialog, boss: p?.boss })
            );
            await h.shot("cdp-shots/cockpit-office-main.png");

            // 1b. the building is two canvases: no floor, wall, shade or sign node; names sit on plates in work hours
            const building = await h.ev(`({
                canvases: document.querySelectorAll("[data-office-root] canvas[data-office-canvas]").length,
                old: document.querySelectorAll("[data-office-floor], [data-office-hall], [data-office-dark], [data-office-night], [data-office-sign]").length,
                plates: document.querySelectorAll("[data-office-root] [data-office-plate]").length,
            })`);
            p = await probe(h);
            rec(
                "1b. the building draws on two canvases, the people and labels over it; labels on plates in work hours",
                building.canvases === 2 && building.old === 0 && building.plates > 0 && p?.phase === "day",
                JSON.stringify({ ...building, phase: p?.phase })
            );

            // 1f. the Office is one floor: four rooms by slot, Home first and then the projects by name, each project's runs at
            // tables inside its own room (the real run's project, arcterm's Canvas gallery, mozox's Billing export)
            p = await probe(h);
            const home = p?.rooms?.find((r) => r.key === "room:Home");
            const arcRoom = p?.rooms?.find((r) => r.key === "room:arcterm");
            const mozoxRoom = p?.rooms?.find((r) => r.key === "room:mozox");
            rec(
                "1f. the office is one floor of four rooms by slot, Home the first of them; each project's run is a table in its own room",
                p?.floor === 0 &&
                    p.rooms.length === 4 &&
                    p.rooms[0].key === "room:Home" &&
                    home?.kind === "agents" &&
                    home.desks === 1 &&
                    arcRoom?.tables === 1 &&
                    mozoxRoom?.tables === 1 &&
                    p.rooms.reduce((n, r) => n + r.tables, 0) === 3,
                JSON.stringify({ floor: p?.floor, rooms: p?.rooms?.map((r) => ({ key: r.key, slot: r.slot, desks: r.desks, tables: r.tables })) })
            );

            // 1c. a near-side worker who asks raises its hand facing you over the table: over the over canvas (z 3),
            // its ! bubble beside its head
            await dev(h, { runs: NEAR_ASK_RUNS });
            await sleep(400);
            const nearAsk = await h.ev(`(() => {
                const seat = document.querySelector('[data-office-seat="fx-office-run-2:t3"]');
                seat?.scrollIntoView({ block: "center" });
                const hands = [...document.querySelectorAll('[data-office-root] img[data-office-sprite^="hand"]')].filter((i) => getComputedStyle(i).zIndex === "3");
                return { pose: seat?.dataset.officePose ?? null, nearHands: hands.length, asks: document.querySelectorAll('[data-office-bubble="!"]').length };
            })()`);
            await sleep(200);
            await h.shot("cdp-shots/cockpit-office-near-ask.png");
            await dev(h, { runs: OFFICE_RUNS });
            await h.ev(`document.querySelector(${JSON.stringify(desk("fx-office-quill"))})?.scrollIntoView({ block: "center" })`);
            await sleep(400);
            rec(
                "1c. a near-side worker who asks raises its hand facing you over the table, its bubble beside its head",
                nearAsk?.pose === "hand" && nearAsk.nearHands >= 1 && nearAsk.asks >= 2,
                JSON.stringify(nearAsk)
            );

            // 1d. a view taller than what the office holds: the building grows to the scroller's foot, no gap below
            const fillW = await h.ev("window.innerWidth");
            await h.cdp("Emulation.setDeviceMetricsOverride", { width: fillW, height: 2600, deviceScaleFactor: 1, mobile: false });
            await sleep(600);
            const fill = await h.ev(`(() => {
                const el = document.querySelector("[data-cockpit-office]");
                const root = el.querySelector("[data-office-root]");
                const bottom = root.getBoundingClientRect().bottom - el.getBoundingClientRect().top + el.scrollTop;
                return { bottom: Math.round(bottom), scrollH: el.scrollHeight, clientH: el.clientHeight };
            })()`);
            await h.shot("cdp-shots/cockpit-office-tall.png");
            await h.cdp("Emulation.clearDeviceMetricsOverride", {});
            await sleep(400);
            rec(
                "1d. in a view taller than what it holds, the office fills the view to its foot",
                fill.scrollH <= fill.clientH && fill.bottom + 12 >= fill.clientH - 1,
                JSON.stringify(fill)
            );

            // 1e. the office's size changing (a floor fills the Office's box, so a window resized is what resizes it): the
            // canvas the commit resizes is drawn again before paint, never shown blank for a frame (a MutationObserver's
            // microtask runs after the commit's layout effects, before a passive one)
            const win1e = await h.ev("({ w: window.innerWidth, h: window.innerHeight })");
            await h.ev(`(() => {
                window.__grow = null;
                const c = document.querySelector('[data-office-canvas="under"]');
                const was = c.width;
                const mo = new MutationObserver(() => {
                    mo.disconnect();
                    const px = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
                    let opaque = 0;
                    for (let i = 3; i < px.length; i += 4) if (px[i] > 0) opaque++;
                    window.__grow = { was, now: c.width, opaque };
                });
                mo.observe(c, { attributes: true, attributeFilter: ["width", "height"] });
                setTimeout(() => {
                    mo.disconnect();
                    window.__grow ??= { was, now: c.width, opaque: null };
                }, 4000);
            })()`);
            await h.cdp("Emulation.setDeviceMetricsOverride", { width: win1e.w - 200, height: win1e.h, deviceScaleFactor: 1, mobile: false });
            let grow = null;
            for (let t = 0; t < 4000 && grow == null; t += 100) {
                grow = await h.ev("window.__grow");
                if (grow == null) await sleep(100);
            }
            await h.cdp("Emulation.clearDeviceMetricsOverride", {});
            await sleep(400);
            rec(
                "1e. the office resized with the window draws its new canvas before paint, never blank for a frame",
                grow != null && grow.now !== grow.was && grow.opaque > 0,
                JSON.stringify(grow)
            );

            // 2. 1 answers from that card
            await focusCockpit(h);
            await key(h, "1");
            await sleep(200);
            p = await probe(h);
            rec("2. 1 picks quill's first answer from the card beside the desk", JSON.stringify(p?.answerSel?.["0"]) === "[0]", JSON.stringify(p?.answerSel));

            // 3. the real run's table, in its project's room, opens its LeadCard
            await h.ev(`[...document.querySelectorAll("[data-office-room]")].find((b) => !b.dataset.officeRoom.includes("fx-office-run"))?.click()`);
            p = await settleBoss(h);
            const runText = await h.ev(`(document.querySelector('[data-office-dialog]')?.textContent ?? "").length`);
            rec(
                "3. a click on a run's table opens its run's dialog box",
                (p?.dialog === "lead" || p?.dialog === "leadless") && runText > 0,
                JSON.stringify({ dialog: p?.dialog, cursor: p?.cursor, runText })
            );
            await h.shot("cdp-shots/cockpit-office-run.png");

            const drawsBeforeWalk = (await probe(h))?.sceneryDraws;

            // 4. a wall stops the boss, a door lets it through. From loom's desk (below the door) the boss walks toward the
            // room's hall side, the door's, long enough to reach the wall at any office width, and must stop with its body
            // against it, its feet half a body off the wall. The desk by the wall leaves no lane up it, so the door is
            // walked from the hall: a click on the floor in front of it, then into the room through its middle, and out
            await h.ev(`document.querySelector(${JSON.stringify(desk("fx-office-loom"))})?.click()`);
            const start = await settleBoss(h);
            // the desk click opened its dialog box, where the arrows move the ▶: shut it so they walk
            await focusCockpit(h);
            await key(h, "Escape");
            await sleep(150);
            const arc = start?.boxes?.["room:arcterm"];
            // a room in the left column has its door on its right wall, one in the right column on its left
            const doorLeft = !!arc?.door && arc.door.x < arc.x;
            const toHall = doorLeft ? "ArrowLeft" : "ArrowRight";
            const edge = arc ? (doorLeft ? arc.x + BOSS_HALF_W : arc.x + arc.w - BOSS_HALF_W) : NaN;
            await focusCockpit(h);
            await hold(h, toHall, arc && start?.boss ? Math.round((Math.abs(edge - start.boss.x) / BOSS_PX_PER_S) * 1000) + 1500 : 4000);
            const blocked = await settleBoss(h, 1000);
            await h.shot("cdp-shots/cockpit-office-wall.png");
            const doorMid = arc?.door ? Math.round((arc.door.y + arc.door.h / 2) / 3) * 3 : NaN;
            if (arc?.door) {
                const x = doorLeft ? arc.door.x - 45 : arc.door.x + arc.door.w + 45;
                await h.ev(`(() => {
                    const root = document.querySelector("[data-office-root]");
                    const r = root.getBoundingClientRect();
                    root.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: r.left + ${x}, clientY: r.top + ${doorMid} }));
                })()`);
            }
            const atDoor = await settleBoss(h, 5000);
            await focusCockpit(h);
            await hold(h, doorLeft ? "ArrowRight" : "ArrowLeft", 500);
            const inRoom = await settleBoss(h, 1000);
            await focusCockpit(h);
            await hold(h, toHall, 500);
            const through = await settleBoss(h, 1000);
            rec(
                "4. the arrows walk the boss: it stops with its body against the room's wall, and its door lets it in and out of the hall",
                blocked?.boss?.room === "room:arcterm" &&
                    (doorLeft ? blocked.boss.x >= edge && blocked.boss.x <= edge + 3 : blocked.boss.x >= edge - 3 && blocked.boss.x <= edge) &&
                    atDoor?.boss?.room === "hall" &&
                    inRoom?.boss?.room === "room:arcterm" &&
                    through?.boss?.room === "hall",
                JSON.stringify({ doorLeft, edge, doorMid, blocked: blocked?.boss, atDoor: atDoor?.boss, inRoom: inRoom?.boss, through: through?.boss })
            );

            // 4b. desks are solid: from loom's spot the boss walks up and stops in front of the desk, still at it with ↵
            // offering its card; walked off to the side, out of every desk's reach, nothing is offered and the cursor stays.
            // The wall on loom's left is nearer its spot than a desk's reach, so the side is its right, short of the next
            // desk's reach (desks stand 116 apart, a reach is 40)
            await h.ev(`document.querySelector(${JSON.stringify(desk("fx-office-loom"))})?.click()`);
            await settleBoss(h);
            await focusCockpit(h);
            await key(h, "Escape");
            await sleep(150);
            const loom = await h.ev(`(() => {
                const root = document.querySelector("[data-office-root]").getBoundingClientRect();
                const r = document.querySelector(${JSON.stringify(desk("fx-office-loom"))}).getBoundingClientRect();
                return { x: r.left - root.left + 4, y: r.top - root.top + 50 };
            })()`);
            await focusCockpit(h);
            await hold(h, "ArrowUp", 1500);
            const front = await settleBoss(h, 1000);
            await h.shot("cdp-shots/cockpit-office-front.png");
            if (front?.boss) {
                const x = loom.x + 40 + 57;
                await h.ev(`(() => {
                    const root = document.querySelector("[data-office-root]");
                    const r = root.getBoundingClientRect();
                    root.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: r.left + ${x}, clientY: r.top + ${front.boss.y} }));
                })()`);
            }
            const aside = await settleBoss(h, 3000);
            rec(
                "4b. walking up to loom's desk the boss stops in front of it, still offered its card; walked aside, out of reach, nothing is offered",
                front?.boss &&
                    front.boss.y > loom.y + 80 &&
                    front.boss.y < loom.y + 108 &&
                    front.cursor === "fx-office-loom" &&
                    front.prompt === "agent" &&
                    aside?.boss &&
                    Math.abs(aside.boss.x - (loom.x + 40)) > 40 &&
                    aside.prompt === "" &&
                    aside.popup === "" &&
                    aside.cursor === "fx-office-loom",
                JSON.stringify({ loom, front: [front?.boss, front?.cursor, front?.prompt], aside: [aside?.boss, aside?.cursor, aside?.prompt] })
            );

            p = await probe(h);
            rec(
                "4c. the boss walking and the frame clock draw the scenery no more",
                p?.sceneryDraws === drawsBeforeWalk,
                JSON.stringify({ before: drawsBeforeWalk, after: p?.sceneryDraws })
            );

            // 4d. the lounge's sofa is solid (officeboss.ts furniture): a click on the floor behind it walks the boss
            // there, ↑ stops it at the sofa's back, and a click on the sofa walks it nowhere
            const loungeBox = p?.lounge;
            const clickFloor = (x, y) =>
                h.ev(`(() => {
                    const root = document.querySelector("[data-office-root]");
                    const r = root.getBoundingClientRect();
                    root.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: r.left + ${x}, clientY: r.top + ${y} }));
                })()`);
            await clickFloor(loungeBox.x + 99, loungeBox.y + 207);
            const behind = await settleBoss(h);
            await focusCockpit(h);
            await hold(h, "ArrowUp", 1000);
            const atSofa = await settleBoss(h, 1000);
            await h.ev(`document.querySelector("[data-office-root]").scrollIntoView({ block: "start" })`);
            await h.shot("cdp-shots/cockpit-office-sofa.png");
            await clickFloor(loungeBox.x + 99, loungeBox.y + 165);
            const onSofa = await settleBoss(h, 1000);
            rec(
                "4d. the boss behind the lounge's sofa walks up to its back and stops there; a click on the sofa walks it nowhere",
                behind?.boss?.room === "hall" &&
                    behind.boss.y > loungeBox.y + 200 &&
                    atSofa?.boss &&
                    atSofa.boss.y > loungeBox.y + 188 &&
                    atSofa.boss.y < behind.boss.y &&
                    onSofa?.boss?.x === atSofa.boss.x &&
                    onSofa.boss.y === atSofa.boss.y,
                JSON.stringify({ lounge: loungeBox, behind: behind?.boss, atSofa: atSofa?.boss, onSofa: onSofa?.boss })
            );

            // 5. NextAsk: n shows the way, then the boss walks it
            await focusCockpit(h);
            await key(h, "n");
            await sleep(150);
            const dotGrid = await h.ev(`(() => {
                const root = document.querySelector("[data-office-root]");
                const R = root.getBoundingClientRect();
                const on3 = (v) => Math.abs(v / 3 - Math.round(v / 3)) < 0.001;
                const dots = [...root.querySelectorAll("[data-office-dot]")].map((d) => {
                    const m = new DOMMatrixReadOnly(getComputedStyle(d).transform);
                    const r = d.getBoundingClientRect();
                    return { x: m.m41, y: m.m42, left: r.left - R.left, top: r.top - R.top };
                });
                const label = root.querySelector("[data-office-dot-label]");
                const L = label ? label.getBoundingClientRect() : null;
                const lbox = L ? { left: L.left - R.left, top: L.top - R.top } : null;
                return {
                    dots: dots.length,
                    dotsOn: dots.every((d) => on3(d.x) && on3(d.y) && on3(d.left) && on3(d.top)),
                    label: lbox,
                    labelOn: !!lbox && on3(lbox.left) && on3(lbox.top),
                    first: dots[0] ?? null,
                };
            })()`);
            const hint = await probe(h);
            await h.shot("cdp-shots/cockpit-office-next-ask.png");
            const atAsk = await settleBoss(h, 5000);
            // quill holds the answer step 2 picked: Enter here opens the dialog box, it does not send the answer
            await focusCockpit(h);
            await key(h, "Enter");
            await sleep(200);
            p = await probe(h);
            rec(
                "5. n shows the way to the next Needs you for a second, then the boss walks there and ↵ offers its card; Enter opens its dialog box",
                hint?.dots > 0 &&
                    atAsk?.cursor === "fx-office-quill" &&
                    atAsk.dialog === "" &&
                    atAsk.prompt === "agent" &&
                    p?.dialog === "agent",
                JSON.stringify({ dots: hint?.dots, cursor: atAsk?.cursor, offered: [atAsk?.dialog, atAsk?.prompt], opened: p?.dialog })
            );

            rec(
                "5b. the path's dots and their label sit on the 3 px grid",
                dotGrid?.dots > 0 && dotGrid.dotsOn && dotGrid.labelOn,
                JSON.stringify({ dots: dotGrid?.dots, dotsOn: dotGrid?.dotsOn, label: dotGrid?.label, first: dotGrid?.first })
            );

            // 6. Esc shuts the dialog box and ↵ offers it again; j and k walk desk by desk in office order, offering each card
            await focusCockpit(h);
            await key(h, "Escape");
            await sleep(200);
            const hid = await probe(h);
            const want = hid?.order?.[hid.order.indexOf(hid.cursor) + 1];
            await focusCockpit(h);
            await key(h, "j");
            const next = await settleBoss(h, 5000);
            await focusCockpit(h);
            await key(h, "Enter");
            await sleep(200);
            const opened = await probe(h);
            await focusCockpit(h);
            await key(h, "k");
            const back = await settleBoss(h, 5000);
            rec(
                "6. Esc shuts the dialog box and ↵ offers it again; j walks to the next desk in office order offering its box, Enter opens it, k walks back with the box shut",
                hid?.dialog === "" &&
                    hid.prompt !== "" &&
                    want != null &&
                    next?.cursor === want &&
                    next.dialog === "" &&
                    next.prompt !== "" &&
                    opened?.dialog !== "" &&
                    back?.cursor === hid.cursor &&
                    back.dialog === "" &&
                    back.prompt !== "",
                JSON.stringify({
                    shut: [hid?.dialog, hid?.prompt],
                    want,
                    next: [next?.cursor, next?.dialog, next?.prompt],
                    opened: opened?.dialog,
                    back: [back?.cursor, back?.dialog, back?.prompt],
                })
            );

            // 6b. f opens the offered card big; the corner button shrinks it, f grows it again, and f once more leaves it small
            const popupW = () => h.ev(`document.querySelector("[data-office-popup]")?.offsetWidth ?? 0`);
            await focusCockpit(h);
            await key(h, "f");
            await sleep(300);
            const big = { ...(await probe(h)), w: await popupW() };
            await h.shot("cdp-shots/cockpit-office-big.png");
            await h.ev(`document.querySelector("[data-office-popup-size]")?.click()`);
            await sleep(200);
            const shrunk = { ...(await probe(h)), w: await popupW() };
            await focusCockpit(h);
            await key(h, "f");
            await sleep(200);
            const grown = await probe(h);
            await focusCockpit(h);
            await key(h, "f");
            await sleep(200);
            rec(
                "6b. f opens the offered card big; its corner button shrinks it back to the small card, and f grows it again",
                big.popup !== "" && big.big && big.w > 380 && shrunk.popup !== "" && !shrunk.big && shrunk.w === 380 && grown.big,
                JSON.stringify({ big: [big.popup, big.big, big.w], shrunk: [shrunk.popup, shrunk.big, shrunk.w], grown: grown?.big })
            );

            // 7. a click on the floor walks the boss there; in the hall the cursor stays on the last desk
            const before = await probe(h);
            const hall = before?.hall;
            const spot = hall ? { x: hall.x + hall.w - 36, y: hall.y + Math.min(300, hall.h - 40) } : null;
            if (spot) {
                await h.ev(`(() => {
                    const root = document.querySelector("[data-office-root]");
                    const r = root.getBoundingClientRect();
                    root.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: r.left + ${spot.x}, clientY: r.top + ${spot.y} }));
                })()`);
            }
            p = await settleBoss(h, 5000);
            rec(
                "7. a click on the hall's floor walks the boss there, and the cursor stays on the last desk",
                spot != null &&
                    p?.boss?.room === "hall" &&
                    Math.abs(p.boss.x - spot.x) <= 3 &&
                    Math.abs(p.boss.y - spot.y) <= 3 &&
                    p.cursor === before.cursor &&
                    p.popup === "" &&
                    p.dialog === "" &&
                    p.prompt === "",
                JSON.stringify({ spot, boss: p?.boss, cursor: [before?.cursor, p?.cursor], popup: p?.popup })
            );

            // 8. lights
            p = await probe(h);
            rec(
                "8. Home's room, where no one works, has its lights off; arcterm's room is lit",
                p?.dark?.includes("room:Home") && !p.dark.includes("room:arcterm"),
                JSON.stringify(p?.dark)
            );

            // 9. Night
            const drawsDay = (await probe(h))?.sceneryDraws;
            await dev(h, { afterHours: true });
            await sleep(400);
            p = await probe(h);
            const gone = await h.ev(`document.querySelectorAll('[data-office-desk][data-office-pose="empty"]').length`);
            rec("9. after hours: idle people have gone home, people at work have a lamp", p?.night && p.lamps > 0 && gone > 0, JSON.stringify({ night: p?.night, lamps: p?.lamps, gone }));
            // a delta across the switch: sceneryDraws also counts a scene computed before the canvases mount
            const platesAfter = await h.ev(`document.querySelectorAll("[data-office-root] [data-office-plate]").length`);
            rec(
                "9b. after hours: the after-hours palette in one redraw, and no plates",
                p?.phase === "after" && p.sceneryDraws === drawsDay + 1 && platesAfter === 0,
                JSON.stringify({ phase: p?.phase, draws: [drawsDay, p?.sceneryDraws], platesAfter })
            );
            await h.shot("cdp-shots/cockpit-office-night.png");

            // 10. Tired: the boss stands at pike's desk with its dialog box open; the working desks have coffee, the HUD
            // says 6 % (the energy left of a window 94 % used), and a tired working person yawns one frame in four
            await dev(h, { afterHours: false, energy: 94 });
            await sleep(400);
            await h.ev(`document.querySelector(${JSON.stringify(desk("fx-office-pike"))})?.click()`);
            p = await settleBoss(h);
            const hudText = await h.ev(`document.querySelector("[data-office-hud]")?.textContent ?? ""`);
            const tiredYawns = await waitForSprite(h, ["yawn"], 3000);
            rec(
                "10. the 5-hour window at 94 %: the boss at pike's desk with its dialog box open, coffee on the working desks, the HUD says 6 % left, a working person yawns",
                p?.cursor === "fx-office-pike" && p.dialog === "agent" && p.cups > 0 && hudText.includes("6 %") && tiredYawns > 0,
                JSON.stringify({ cursor: p?.cursor, dialog: p?.dialog, cups: p?.cups, hud: hudText, tiredYawns })
            );
            await h.shot("cdp-shots/cockpit-office-tired.png");

            // 11. States, the yawn and the stretch: at 75 % a working person yawns; a drop from 75 % to 5 % (a reset)
            // makes everyone at a desk stretch once
            await dev(h, { energy: 75 });
            const yawns = await waitForSprite(h, ["yawn"], 4000);
            await dev(h, { energy: 5 });
            const stretches = await waitForSprite(h, ["stretch"], 1000);
            const stretchPoses = await h.ev(`document.querySelectorAll('[data-office-desk][data-office-pose="stretch"]').length`);
            await h.shot("cdp-shots/cockpit-office-stretch.png");
            rec(
                "11. at 75 % a working person yawns; the reset to 5 % stretches everyone at a desk",
                yawns > 0 && stretches > 0 && stretchPoses > 0,
                JSON.stringify({ yawns, stretches, stretchPoses })
            );

            // 12. States, the cheer: quiet makes every agent just finished, so the desks that were at work cheer once
            // (after the stretch, which lasts 1.5 s and would draw over the cheer)
            await sleep(1600);
            const rootW = () => h.ev(`document.querySelector("[data-office-root]")?.offsetWidth ?? 0`);
            const drawsBusy = (await probe(h))?.sceneryDraws;
            const widthBusy = await rootW();
            await dev(h, { quiet: true });
            const cheers = await waitForSprite(h, ["cheer1", "cheer2"], 1200);
            const cheerPoses = await h.ev(`document.querySelectorAll('[data-office-desk][data-office-pose="cheer"]').length`);
            await h.shot("cdp-shots/cockpit-office-cheer.png");
            const drawsQuiet = (await probe(h))?.sceneryDraws;
            const widthQuiet = await rootW();
            await dev(h, { quiet: false, energy: 63 });
            rec(
                "12. a desk that turns done cheers once",
                cheers > 0 && cheerPoses > 0,
                JSON.stringify({ cheers, cheerPoses })
            );
            // the quiet office is shorter, so the page can lose its scrollbar and the office (as wide as the Cockpit)
            // grows by its width: that resize is a second, honest redraw
            rec(
                "12b. the desks going idle redraw the scenery once (once more if the page's width changed)",
                drawsQuiet === drawsBusy + 1 + (widthQuiet !== widthBusy ? 1 : 0),
                JSON.stringify({ draws: [drawsBusy, drawsQuiet], width: [widthBusy, widthQuiet] })
            );

            // 13. States: every sprite. The sheet is about 1,350 px wide: widen the viewport so it fits the scroller
            await h.cdp("Emulation.setDeviceMetricsOverride", { width: 2000, height: 950, deviceScaleFactor: 1, mobile: false });
            await dev(h, { sheet: true });
            await sleep(400);
            const daySrcs = await h.ev(`[...document.querySelectorAll("[data-office-sheet] img")].map((i) => i.getAttribute("src") ?? "")`);
            const sheet = daySrcs.map((s) => s.length);
            p = await probe(h);
            rec(
                "13. every sprite in every look draws, every colour token resolved",
                sheet.length === p?.sheetSize && sheet.every((n) => n > 0) && p?.unresolved?.length === 0,
                JSON.stringify({ sprites: sheet.length, sheetSize: p?.sheetSize, unresolved: p?.unresolved })
            );
            await h.shot("cdp-shots/cockpit-office-states.png");

            // 13b. the Cast after hours, as the canvas's Cast board draws it on B's floor: the same sheet in the
            // after-hours outline, shadow and chair
            await dev(h, { afterHours: true });
            await sleep(400);
            const nightSrcs = await h.ev(`[...document.querySelectorAll("[data-office-sheet] img")].map((i) => i.getAttribute("src") ?? "")`);
            p = await probe(h);
            rec(
                "13b. after hours, every sprite on the sheet draws again in the after-hours palette",
                p?.phase === "after" &&
                    nightSrcs.length === p.sheetSize &&
                    nightSrcs.every((s) => s.length > 0) &&
                    nightSrcs.every((s, i) => s !== daySrcs[i]),
                JSON.stringify({ phase: p?.phase, sprites: nightSrcs.length, changed: nightSrcs.filter((s, i) => s !== daySrcs[i]).length })
            );
            await h.shot("cdp-shots/cockpit-office-states-night.png");

            // 13d. the Cast sheet in the board's cells (22 art px = 66 px a column): the labels sit over their sprites
            const cast = await h.ev(`(() => {
                const sheet = document.querySelector("[data-office-sheet]");
                const area = sheet.querySelector("[data-office-sheet-area]").getBoundingClientRect();
                const cols = [...sheet.querySelectorAll("[data-office-sheet-col]")].map((e) => e.getBoundingClientRect().left - area.left);
                // the States sheet has no boss row: the boss is the pet, drawn on the floor
                const boss = sheet.querySelectorAll("[data-office-sheet-boss]").length;
                const imgs = [...sheet.querySelectorAll("[data-office-sheet-area] img")].slice(0, 18);
                const sprites = imgs.map((img, c) => {
                    const r = img.getBoundingClientRect();
                    const want = (c * 22 + 4 + (Math.round(r.width) === 60 ? -3 : 0)) * 3;
                    return Math.abs(r.left - area.left - want);
                });
                // the Office's scroller: its canvases are drawn a whole number of art px wide, so the root they sit in
                // can overflow by a pixel or two inside the scroller's gutter, which is no scrollbar
                const scroller = sheet.closest("[data-cockpit-office]");
                return {
                    right: sheet.getBoundingClientRect().right,
                    vw: window.innerWidth,
                    cols: cols.length,
                    boss,
                    colOff: cols.map((l, i) => Math.abs(l - i * 66)),
                    spriteOff: sprites,
                    scrolls: scroller ? scroller.scrollWidth - scroller.clientWidth : null,
                };
            })()`);
            rec(
                "13d. the Cast sheet in the board's cells",
                cast?.right <= cast?.vw &&
                    cast.scrolls != null &&
                    cast.scrolls <= 0 &&
                    cast.cols === 18 &&
                    cast.boss === 0 &&
                    cast.colOff.every((d) => d < 1) &&
                    cast.spriteOff.length === 18 &&
                    cast.spriteOff.every((d) => d <= 1),
                JSON.stringify({ right: cast?.right, vw: cast?.vw, cols: cast?.cols, boss: cast?.boss, scrolls: cast?.scrolls, maxColOff: Math.max(...(cast?.colOff ?? [0])), maxSpriteOff: Math.max(...(cast?.spriteOff ?? [0])) })
            );
            await dev(h, { sheet: false, afterHours: false });
            await h.cdp("Emulation.setDeviceMetricsOverride", { width: 1600, height: 950, deviceScaleFactor: 1, mobile: false });
            await sleep(400);

            // 13c. a theme switched with the office open: the building draws once more, and the boss's ring (the
            // accent) is drawn again in the new theme's colours, no stale cached colour
            const ring = () => h.ev(`document.querySelector("[data-office-ring]")?.getAttribute("src") ?? ""`);
            const themeDraws = (await probe(h))?.sceneryDraws;
            const claudeRing = await ring();
            ctx.prevTheme = await h.ev(`window.__cockpitOfficeTheme("graphite")`);
            await sleep(500);
            p = await probe(h);
            ctx.graphiteRing = await ring();
            await h.shot("cdp-shots/cockpit-office-theme.png");
            await h.ev(`window.__cockpitOfficeTheme(${JSON.stringify(ctx.prevTheme)})`);
            await sleep(500);
            rec(
                "13c. a theme switched with the office open redraws the building once and the ring in the new accent",
                ctx.prevTheme !== "graphite" &&
                    p?.sceneryDraws === themeDraws + 1 &&
                    claudeRing !== "" &&
                    ctx.graphiteRing !== "" &&
                    ctx.graphiteRing !== claudeRing &&
                    p.unresolved?.length === 0,
                JSON.stringify({ prevTheme: ctx.prevTheme, draws: [themeDraws, p?.sceneryDraws], ringChanged: ctx.graphiteRing !== claudeRing })
            );

            // 14. animation off
            await h.ev("window.__cockpitOfficeAnimation(false)");
            await sleep(700);
            const off = await probe(h);
            await h.ev("window.__cockpitOfficeAnimation(true)");
            await sleep(700);
            const on = await probe(h);
            rec(
                "14. with the animation off no clock runs; on again, the frame clock runs",
                off?.clock?.frame === false && off.clock.walk === false && on?.clock?.frame === true,
                JSON.stringify({ off: off?.clock, on: on?.clock })
            );

            // 14b. the crowded lounge: 14 more idle agents past the Finished window, several of them 10 min and more,
            // with the animation off so everyone is there at once. A floor's lounge holds the idle people of that floor's
            // rooms who have a desk (not the ones in a room's chip), so the Office is made big enough for the crowd's room
            // to seat ten of them, and the floor that holds that room is shown. The lounge holds its spots, nothing
            // overlaps, and the rest read "+N in the lounge"
            await h.ev("window.__cockpitOfficeAnimation(false)");
            await sizeOfficeBox(h, 1600, 1000);
            await dev(h, { crowd: 14 });
            await sleep(700);
            let crowdFloor = null;
            for (const f of [0, 1, 2]) {
                await dev(h, { floor: f });
                await sleep(500);
                if ((await probe(h))?.rooms?.some((r) => r.key === "room:crowd")) {
                    crowdFloor = f;
                    break;
                }
            }
            const lounge = await h.ev(`(() => {
                const L = window.__cockpitOfficeProbe().lounge;
                const R = document.querySelector("[data-office-root]").getBoundingClientRect();
                const floor = L && { left: R.left + L.x, top: R.top + L.y, right: R.left + L.x + L.w, bottom: R.top + L.y + L.h };
                const rect = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; };
                const labels = [...document.querySelectorAll("[data-office-lounge-label]")].map(rect);
                const people = [...document.querySelectorAll("[data-office-lounger]")].map(rect);
                const inside = (q) => floor && q.l >= floor.left - 0.5 && q.t >= floor.top - 0.5 && q.r <= floor.right + 0.5 && q.b <= floor.bottom + 0.5;
                const hit = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
                let overlapping = 0;
                for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) if (hit(labels[i], labels[j])) overlapping++;
                return {
                    labels: labels.length,
                    people: people.length,
                    overlapping,
                    outside: labels.filter((q) => !inside(q)).length + people.filter((q) => !inside(q)).length,
                    more: document.querySelector("[data-office-lounge-more]")?.textContent ?? null,
                    moreInside: (() => { const m = document.querySelector("[data-office-lounge-more]"); return m ? inside(rect(m)) : false; })(),
                    // the people drawn: each an <img>, but the boss, an svg of the pet in a button
                    images: document.querySelectorAll("[data-office-root] img[data-office-sprite], [data-office-root] [data-office-boss]").length,
                };
            })()`);
            p = await probe(h);
            await h.shot("cdp-shots/cockpit-office-lounge.png");
            await dev(h, { crowd: 0, floor: 0 });
            await h.ev("window.__cockpitOfficeAnimation(true)");
            await h.cdp("Emulation.setDeviceMetricsOverride", { width: 1600, height: 950, deviceScaleFactor: 1, mobile: false });
            await sleep(400);
            rec(
                "14b. a crowded lounge: no two labels touch, everyone stays inside it, the rest read +N in the lounge, and People counts the people drawn",
                crowdFloor != null &&
                    lounge?.labels > 0 &&
                    lounge.labels === lounge.people &&
                    lounge.overlapping === 0 &&
                    lounge.outside === 0 &&
                    p?.loungeMore > 0 &&
                    lounge.more === `+${p.loungeMore} in the lounge` &&
                    lounge.moreInside &&
                    p.people === lounge.images,
                JSON.stringify({ crowdFloor, lounge, loungeMore: p?.loungeMore, people: p?.people })
            );

            // 15. o and the Cards | Office toggle switch the view, and back
            await focusCockpit(h);
            await key(h, "o");
            await sleep(400);
            const cardsByKey = await h.ev(`!document.querySelector("[data-cockpit-office]")`);
            await focusCockpit(h);
            await key(h, "o");
            const officeByKey = (await waitForOffice(h)) == null;
            await toggleTo(h, "Cards");
            await sleep(400);
            const cardsByClick = await h.ev(`!document.querySelector("[data-cockpit-office]")`);
            await toggleTo(h, "Office");
            const officeByClick = (await waitForOffice(h)) == null;
            await settleBoss(h);
            rec(
                "15. o switches to Cards and back to Office, and so does the toggle beside Live only",
                cardsByKey && officeByKey && cardsByClick && officeByClick,
                JSON.stringify({ cardsByKey, officeByKey, cardsByClick, officeByClick })
            );

            // 15b. a theme switched while the office is away: opened again, its ring is the new theme's, not a stale
            // cached colour
            await toggleTo(h, "Cards");
            await sleep(400);
            const prevAway = await h.ev(`window.__cockpitOfficeTheme("graphite")`);
            ctx.prevTheme ??= prevAway;
            await sleep(400);
            await toggleTo(h, "Office");
            const backIn = (await waitForOffice(h)) == null;
            await settleBoss(h);
            const awayRing = await h.ev(`document.querySelector("[data-office-ring]")?.getAttribute("src") ?? ""`);
            await h.shot("cdp-shots/cockpit-office-theme-away.png");
            await h.ev(`window.__cockpitOfficeTheme(${JSON.stringify(prevAway)})`);
            await sleep(500);
            rec(
                "15b. a theme switched while the office is in Cards: opened again, it draws in the new theme",
                backIn && prevAway !== "graphite" && awayRing !== "" && awayRing === ctx.graphiteRing,
                JSON.stringify({ backIn, prevAway, sameAsOpen: awayRing === ctx.graphiteRing })
            );

            // 16. RamPanel: the office's cost, and its button
            await h.ev(`document.querySelector("[data-worker-capacity]")?.click()`);
            await sleep(1500);
            const line = await h.ev(`document.querySelector("[data-consumers-office]")?.textContent ?? ""`);
            await h.shot("cdp-shots/cockpit-office-ram.png");
            await h.ev(`document.querySelector("[data-consumers-office-toggle]")?.click()`);
            await sleep(700);
            const offLine = await h.ev(`document.querySelector("[data-consumers-office]")?.textContent ?? ""`);
            const stopped = await probe(h);
            await h.ev(`document.querySelector("[data-consumers-office-toggle]")?.click()`);
            await h.ev(`window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
            rec(
                "16. the RAM panel shows the office's JS, people, images and nodes, and its button stops every clock",
                ["Office JS", "People", "Images", "DOM nodes"].every((w) => line.includes(w)) &&
                    offLine.includes("animation off") &&
                    stopped?.clock?.frame === false,
                JSON.stringify({ line, offLine, clock: stopped?.clock })
            );

            // 17. Settings → Appearance → Office: the office's animation switch and the work hours, and the switch is
            // the one the office reads (last: it leaves the Cockpit)
            await h.goto("settings");
            await h.ev(`document.querySelector('button[data-section="appearance"]')?.click()`);
            await h.ev(`(async () => {
                for (let i = 0; i < 50 && !document.querySelector('[data-setting-card="office"]'); i++) await new Promise((r) => setTimeout(r, 100));
            })()`);
            const SWITCH = `document.querySelector('[data-setting-row="appearance.officeanimation"] [role="switch"]')`;
            const card = await h.ev(`(() => {
                const c = document.querySelector('[data-setting-card="office"]');
                c?.scrollIntoView({ block: "center" });
                return {
                    found: !!c,
                    on: ${SWITCH}?.getAttribute("aria-checked") ?? null,
                    hours: c?.querySelector('[data-setting-row="appearance.officehours"]')?.textContent ?? "",
                };
            })()`);
            await h.shot("cdp-shots/cockpit-office-settings.png");
            await h.ev(`${SWITCH}?.click()`);
            await sleep(300);
            const stored = await h.ev(`localStorage.getItem("cockpit.office.animation")`);
            const flipped = await h.ev(`${SWITCH}?.getAttribute("aria-checked") ?? null`);
            await h.ev(`${SWITCH}?.click()`);
            await sleep(300);
            const restored = await h.ev(`localStorage.getItem("cockpit.office.animation")`);
            rec(
                "17. Settings → Appearance → Office holds the animation switch and the work hours (09:00 to 18:00), and the switch sets the office's animation",
                card.found &&
                    card.on === "true" &&
                    card.hours.includes("09:00") &&
                    card.hours.includes("18:00") &&
                    flipped === "false" &&
                    stored === "false" &&
                    restored === "true",
                JSON.stringify({ card, flipped, stored, restored })
            );

            return steps;
        },
        async teardown(h, ctx) {
            await fx.teardownFixtureRun(h, ctx, "cockpit-office", {
                what: "put back the view, the roster and the dev state",
                fn: async () => {
                    // a run cut short between a theme switch and its restore leaves no graphite theme behind
                    if (ctx.prevTheme != null) await h.ev(`window.__cockpitOfficeTheme?.(${JSON.stringify(ctx.prevTheme)})`);
                    await h.ev("window.__cockpitOffice?.(null)");
                    await h.ev(
                        ctx.prevView == null
                            ? `localStorage.removeItem(${JSON.stringify(VIEW_KEY)})`
                            : `localStorage.setItem(${JSON.stringify(VIEW_KEY)}, ${JSON.stringify(ctx.prevView)})`
                    );
                    await h.ev(
                        ctx.prevLayout == null
                            ? `localStorage.removeItem(${JSON.stringify(LAYOUT_KEY)})`
                            : `localStorage.setItem(${JSON.stringify(LAYOUT_KEY)}, ${JSON.stringify(ctx.prevLayout)})`
                    );
                    // the temp dir is the run's cwd: teardownFixtureRun removes it once the run is cancelled
                    if (ctx.prevFixture != null) writeFileSync(FIXTURE, ctx.prevFixture);
                },
            });
        },
    };
    // the boss as the person's pet (docs/superpowers/specs/2026-10-16-office-pet-boss-design.md; canvas
    // .superpowers/design/office-pet-boss: Main, Entrance, Floor): the entrance each pet makes as the office opens (the
    // teleport's beam for Sprout and the Minion; Spider-Man's swing, unmasking and puff), the poses of the Main board, the
    // footer's creature giving way, and the bubble and the peek hanging off the boss. What the boss drew is read from the
    // probe's bossPet. The DEV seams (cockpitoffice.tsx OfficeDev) show what a live run passes through in a moment:
    // entrance: <ms> holds one frame of the entrance still, replayEntrance plays one live, bossRest and bossExpression take
    // a pose. __cockpitOffice merges each call into what is set, so a seam is cleared with null.
    const cockpitOfficePet = {
        name: "cockpit-office-pet",
        surface: "cockpit",
        async arrange(h) {
            // the entrance stays live: the first office after the reload is the one that plays it
            const ctx = await arrangeOffice(h, { entrance: true });
            if (!ctx.missing) {
                // a real 5-hour window past 60 % makes the boss tired and a bubble makes it speak, and each outranks the stand
                // and the pastimes the steps look for
                await dev(h, { bossExpression: "at-rest" });
                await h.ev("window.__cockpitOfficeBubble(false)");
            }
            return ctx;
        },
        async teardown(h, ctx) {
            // the pet the scenario found is the person's own choice, kept in localStorage: put it back before the reload
            try {
                if (ctx.prevPet != null) await h.ev(`window.__cockpitOfficePet?.(${JSON.stringify(ctx.prevPet)})`);
                await h.ev("window.__cockpitOfficeBubble?.(false)");
                await h.ev("window.__cockpitOffice?.(null)");
            } catch (e) {
                console.error(`cockpit-office-pet teardown: put back the pet and the dev state failed: ${e?.message ?? e}`);
            }
            await cockpitOffice.teardown(h, ctx);
        },
        async assert(h, ctx) {
            const steps = [];
            const rec = (step, ok, detail) => steps.push({ step, ok: !!ok, detail });
            if (ctx.missing) {
                rec("0. the office loads", false, ctx.missing);
                return steps;
            }
            const shot = (name) => h.shot(`cdp-shots/cockpit-office-pet-${name}.png`);
            const bp = () => h.ev("window.__cockpitOfficeProbe?.()?.bossPet ?? null");
            // polls the boss pet until test holds, up to ms; the last reading either way
            const waitPet = async (test, ms = 3000) => {
                let q = null;
                for (let t = 0; t <= ms; t += 50) {
                    q = await bp();
                    if (q && test(q)) return q;
                    await sleep(50);
                }
                return q;
            };
            // polls an expression in the page for up to ms; true once it holds
            const until = async (expr, ms = 3000) => {
                for (let t = 0; t <= ms; t += 100) {
                    if (await h.ev(expr).catch(() => false)) return true;
                    await sleep(100);
                }
                return false;
            };
            // sets the pet the boss is drawn as; the first call keeps the one it found, for the teardown to put back
            const setPet = async (name) => {
                const prev = await h.ev(`window.__cockpitOfficePet(${JSON.stringify(name)})`);
                ctx.prevPet ??= prev;
            };
            // the boss's button as drawn: its entrance attribute, its cells (and how many are the suit's red), the strand of
            // a swing, and its box in the plan (the Office root's top left is the origin)
            const bossDom = () =>
                h.ev(`(() => {
                    const el = document.querySelector("[data-office-boss]");
                    const root = document.querySelector("[data-office-root]").getBoundingClientRect();
                    const r = el?.getBoundingClientRect();
                    return {
                        entrance: el?.dataset.officeEntrance ?? null,
                        cells: el?.querySelectorAll("svg rect").length ?? 0,
                        suit: el?.querySelectorAll('svg rect[fill="var(--color-spidey-red)"]').length ?? 0,
                        strand: el?.querySelector("svg line")?.getAttribute("stroke") ?? null,
                        box: r ? { x: Math.round(r.left - root.left), y: Math.round(r.top - root.top), w: Math.round(r.width), h: Math.round(r.height) } : null,
                    };
                })()`);
            // how far the button's feet are from where the boss stands: about 0 when it is on its spot, the swing's distance
            // while it is on the way
            const awayFromSpot = async (dom) => {
                const spot = (await probe(h))?.boss;
                return spot && dom.box ? Math.round(Math.hypot(dom.box.x + dom.box.w / 2 - spot.x, dom.box.y + dom.box.h - spot.y)) : null;
            };
            const clickFloor = (x, y) =>
                h.ev(`(() => {
                    const root = document.querySelector("[data-office-root]");
                    const r = root.getBoundingClientRect();
                    root.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: r.left + ${x}, clientY: r.top + ${y} }));
                })()`);
            // the poses a boss has right after an act: standing, or already walking
            const afterAct = ["stand", "walk1", "walk2"];

            // 0. the office mounted with the entrance (the first office after the reload) and the footer's creature gave way
            const opened = await waitPet(() => true, 5000);
            const given = await h.ev(`({
                footer: document.querySelectorAll("[data-pet-sprite]").length,
                cells: document.querySelectorAll("[data-office-boss] svg rect").length,
            })`);
            rec(
                "0. the office opens with the pet's entrance, the footer's creature gives way, and the boss is drawn as an svg of cells",
                opened?.played === true && given.footer === 0 && given.cells > 0,
                JSON.stringify({ played: opened?.played, character: opened?.character, ...given })
            );

            // 0b, 0c. Sprout and the Minion arrive by the teleport's beam, then stand on the floor (the Floor board)
            for (const [id, name] of [
                ["0b", "sprout"],
                ["0c", "minion"],
            ]) {
                await setPet(name);
                await dev(h, { entrance: 200 });
                const beam = await waitPet((b) => b.entrance === "beam" && b.character === name);
                const dom = await bossDom();
                const beamCells = await h.ev(`document.querySelectorAll('[data-office-boss][data-office-entrance="beam"] svg rect').length`);
                await sleep(150);
                await shot(`beam-${name}`);
                await dev(h, { entrance: "skip" });
                const stands = await waitPet((b) => b.entrance == null && b.pose === "stand" && b.character === name);
                const floorDom = await bossDom();
                await sleep(100);
                await shot(`floor-${name}`);
                rec(
                    `${id}. ${name === "sprout" ? "Sprout" : "The Minion"} arrives by the teleport's beam, then stands on the floor`,
                    beam?.entrance === "beam" &&
                        beam.character === name &&
                        dom.entrance === "beam" &&
                        beamCells > 0 &&
                        stands?.entrance == null &&
                        stands.character === name &&
                        stands.pose === "stand" &&
                        floorDom.cells > 0,
                    JSON.stringify({ beam: [beam?.entrance, beam?.character], beamCells, stands: [stands?.entrance, stands?.character, stands?.pose], floorCells: floorDom.cells })
                );
            }

            // 1. Spider-Man's entrance, one shot per phase: a strand from the window to a boss on the swing, then the suit sits,
            // stands, unmasks, and the puff turns it into Peter
            await setPet("spidey");
            const seen = [];
            for (const [ms, want] of [
                [350, "swing"],
                [850, "land"],
                [1150, "stand"],
                [1550, "unmask"],
                [2000, "puff"],
            ]) {
                await dev(h, { entrance: ms });
                const q = await waitPet((b) => b.entrance === want && b.character === "spidey");
                await sleep(200);
                const dom = await bossDom();
                seen.push({ ms, want, entrance: q?.entrance, attr: dom.entrance, strand: dom.strand, suit: dom.suit, away: await awayFromSpot(dom) });
                await shot(`entrance-${want}`);
            }
            const swingAt = seen[0];
            const landed = seen.slice(1);
            rec(
                "1. Spider-Man swings in, lands, stands, unmasks and puffs: a web strand and a button off the boss's spot on the swing, on the spot after it",
                seen.every((s) => s.entrance === s.want && s.attr === s.want) &&
                    swingAt.strand === "var(--color-spidey-web)" &&
                    swingAt.away > 12 &&
                    landed.every((s) => s.strand == null && s.away != null && s.away <= 4) &&
                    // the suit is what the unmasking takes off: the stand phase shows it, so the next step's count is a real test
                    landed[1].suit > 0,
                JSON.stringify(seen)
            );

            // 2. skipped, Peter stands in his shirt and tie on the boss's spot, with no suit
            await dev(h, { entrance: "skip" });
            const peter = await waitPet((b) => b.entrance == null && b.pose === "stand" && b.character === "spidey");
            const peterDom = await bossDom();
            const peterAway = await awayFromSpot(peterDom);
            await sleep(100);
            await shot("peter");
            rec(
                "2. with the entrance skipped Peter stands in his shirt and tie on the boss's spot, with no red of the suit in his cells",
                peter?.entrance == null &&
                    peter.character === "spidey" &&
                    peter.pose === "stand" &&
                    peterDom.cells > 0 &&
                    peterDom.suit === 0 &&
                    peterAway != null &&
                    peterAway <= 4,
                JSON.stringify({ peter: [peter?.entrance, peter?.character, peter?.pose], cells: peterDom.cells, suit: peterDom.suit, away: peterAway })
            );

            // 3. a live entrance ends with the person's first act: a walk key, a click on the floor, ↵. Each time it is played
            // from its start and seen live, then the act; the pose after it is the boss's own (it stands, or has set off)
            const plays = async () => {
                await dev(h, { entrance: null, replayEntrance: Date.now() });
                return waitPet((b) => b.entrance === "swing", 600);
            };
            const ends = () => waitPet((b) => b.entrance == null, 300);
            const acts = [];
            const note = (act, live, after) => acts.push({ act, live: live?.entrance, after: [after?.entrance, after?.pose] });
            await focusCockpit(h);
            let live = await plays();
            await key(h, "ArrowRight");
            note("→", live, await ends());

            const hall = (await probe(h))?.hall;
            if (hall) {
                live = await plays();
                await clickFloor(hall.x + hall.w - 36, hall.y + Math.min(300, hall.h - 40));
                note("click", live, await ends());
                await settleBoss(h, 5000);
            }

            // ↵ at a desk opens its dialog box (the boss in the hall with the cursor on a desk elsewhere would walk ↵ to the
            // Agent surface): the click walks the boss to quill's desk, Esc shuts the box it opens, and ↵ offers it again
            await h.ev(`document.querySelector(${JSON.stringify(desk("fx-office-quill"))})?.click()`);
            await settleBoss(h, 5000);
            await focusCockpit(h);
            await key(h, "Escape");
            await sleep(200);
            live = await plays();
            await focusCockpit(h);
            await key(h, "Enter");
            note("↵", live, await ends());
            const talked = await probe(h);
            await shot("skip-enter");
            await focusCockpit(h);
            await key(h, "Escape");
            await dev(h, { entrance: "skip" });
            rec(
                "3. a live entrance ends at once with a walk key, a click on the floor and ↵, the boss in place",
                acts.length === 3 && acts.every((a) => a.live === "swing" && a.after[0] == null && afterAct.includes(a.after[1])),
                JSON.stringify({ acts, dialog: talked?.dialog })
            );

            // 4. walking: the boss turns the way it walks, its side grid going right and the same mirrored going left. From
            // the hall's middle, a key held for a moment; the frames read while it is down
            const hallNow = (await probe(h))?.hall;
            if (hallNow) {
                await clickFloor(hallNow.x + hallNow.w / 2, hallNow.y + Math.min(300, hallNow.h - 40));
            }
            await settleBoss(h, 5000);
            const walked = [];
            for (const dir of ["ArrowLeft", "ArrowRight"]) {
                await focusCockpit(h);
                await key(h, dir, "down");
                const sampled = [];
                for (let i = 0; i < 3; i++) {
                    await sleep(60);
                    sampled.push(await bp());
                }
                if (dir === "ArrowLeft") await shot("walk");
                await key(h, dir, "up");
                walked.push({ dir, poses: sampled.map((b) => b?.pose), flips: sampled.map((b) => b?.flip) });
                await settleBoss(h, 2000);
            }
            rec(
                "4. walking left and right the boss shows its walk frames, mirrored going left and not going right",
                hallNow != null &&
                    walked.every(
                        (w) => w.poses.every((p) => p === "walk1" || p === "walk2") && w.flips.every((f) => f === (w.dir === "ArrowLeft"))
                    ),
                JSON.stringify(walked)
            );

            // 5. every pose of the Main board: a rest the boss takes at once, read until each of its frames has shown
            const restPoses = { sit: ["sit"], read: ["read1", "read2"], music: ["music1", "music2"], work: ["work1", "work2"], ball: ["ball1", "ball2"], stand: ["stand"] };
            const rested = {};
            for (const [rest, want] of Object.entries(restPoses)) {
                await dev(h, { bossRest: rest });
                const got = [];
                for (let t = 0; t <= 3000 && got.length < want.length; t += 40) {
                    const b = await bp();
                    if (b && want.includes(b.pose) && !got.includes(b.pose)) {
                        got.push(b.pose);
                        await shot(`pose-${b.pose}`);
                    }
                    await sleep(40);
                }
                rested[rest] = got;
            }
            rec(
                "5. each rest of the Main board shows its pose: sit and stand, and a pastime's two frames in turn",
                Object.entries(restPoses).every(([rest, want]) => want.every((p) => rested[rest].includes(p))),
                JSON.stringify(rested)
            );

            await dev(h, { bossRest: null, bossExpression: "tired" });
            const tired = await waitPet((b) => b.pose === "tired");
            await sleep(150);
            await shot("tired");
            await dev(h, { bossExpression: "at-rest" });
            rec("5b. a tired boss shows the tired pose and the sweat drop", tired?.pose === "tired" && tired.marks.includes("drop"), JSON.stringify({ pose: tired?.pose, marks: tired?.marks }));

            // 6. after hours the office's people are shaded: so is the boss, and it comes back with the day
            const filter = `getComputedStyle(document.querySelector("[data-office-boss]")).filter`;
            await dev(h, { afterHours: true });
            const shaded = await until(`${filter}.includes("brightness(0.7)")`);
            const nightFilter = await h.ev(filter);
            await shot("after-hours");
            await dev(h, { afterHours: false });
            const lit = await until(`${filter} === "none"`);
            const dayFilter = await h.ev(filter);
            rec("6. after hours the boss is shaded to brightness(0.7), and by day it is not", shaded && lit, JSON.stringify({ night: nightFilter, day: dayFilter }));

            // 7. the bubble opens over the boss, and waits out an entrance
            await h.ev(`document.querySelector("[data-office-boss]")?.scrollIntoView({ block: "center" })`);
            await h.ev("window.__cockpitOfficeBubble(true)");
            const bubbled = await until(`!!document.querySelector("[data-pet-bubble]")`);
            await sleep(500);
            const boxes = await h.ev(`(() => {
                const box = (s) => {
                    const b = document.querySelector(s)?.getBoundingClientRect();
                    return b ? { left: Math.round(b.left), top: Math.round(b.top), right: Math.round(b.right), bottom: Math.round(b.bottom) } : null;
                };
                return { bubble: box("[data-pet-bubble]"), boss: box("[data-office-boss]") };
            })()`);
            const speaks = await waitPet((b) => b.pose === "speak");
            await shot("bubble");
            await h.ev("window.__cockpitOfficeBubble(false)");
            await dev(h, { entrance: 350 });
            await h.ev("window.__cockpitOfficeBubble(true)");
            await sleep(700);
            const heldBubble = await h.ev(`document.querySelectorAll("[data-pet-bubble]").length`);
            await dev(h, { entrance: "skip" });
            const afterEntrance = await until(`!!document.querySelector("[data-pet-bubble]")`);
            await h.ev("window.__cockpitOfficeBubble(false)");
            rec(
                "7. the bubble opens above the boss and the boss speaks; while an entrance holds there is no bubble, and it shows once the entrance is over",
                bubbled &&
                    boxes.bubble != null &&
                    boxes.boss != null &&
                    boxes.bubble.bottom <= boxes.boss.top + 4 &&
                    speaks?.pose === "speak" &&
                    heldBubble === 0 &&
                    afterEntrance,
                JSON.stringify({ boxes, pose: speaks?.pose, heldBubble, afterEntrance })
            );

            // 8. a click on the boss opens the condition panel over it; a click on the backdrop shuts it
            await h.ev(`document.querySelector("[data-office-boss]")?.scrollIntoView({ block: "center" })`);
            await sleep(200);
            const centre = await h.ev(`(() => {
                const b = document.querySelector("[data-office-boss]").getBoundingClientRect();
                return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) };
            })()`);
            await mousePage(h, "mousePressed", centre.x, centre.y);
            await mousePage(h, "mouseReleased", centre.x, centre.y);
            const peeked = await until(`!!document.querySelector("[data-pet-peek]")`);
            await sleep(400);
            await shot("peek");
            await h.ev(`document.querySelector("[data-pet-peek-backdrop]")?.click()`);
            const peekShut = await until(`!document.querySelector("[data-pet-peek]")`);
            rec("8. a click on the boss opens the condition panel, and a click on its backdrop shuts it", peeked && peekShut, JSON.stringify({ peeked, peekShut }));

            // 9. leaving gives the footer's creature back, and coming back inside the cooldown plays no entrance. The skip the
            // steps above set is cleared first, so the cooldown is what decides
            await dev(h, { entrance: null });
            await toggleTo(h, "Cards");
            // the footer's creature fades in: wait until it has
            const footer = await until(`(() => { const el = document.querySelector("[data-pet-sprite]"); return !!el && parseFloat(getComputedStyle(el).opacity) >= 0.39; })()`, 5000);
            await shot("footer");
            await toggleTo(h, "Office");
            // the first reading of the new mount (the probe's bossPet is null until the boss has drawn)
            const back = await waitPet(() => true, 5000);
            rec(
                "9. back in Cards the footer's creature is drawn again; back in the Office inside two minutes the boss plays no entrance",
                footer && back?.played === false && back.entrance == null,
                JSON.stringify({ footer, played: back?.played, entrance: back?.entrance })
            );

            return steps;
        },
    };
    // the office controls canvas (.superpowers/design/office-controls): the HUD bar and footer, the dialog box and its
    // ▶ menu, a two-part ask, a run's room and a worker's seat, the full card and Esc's steps back, the box's edge, the
    // office menu and the Events rail
    const cockpitOfficeControls = {
        name: "cockpit-office-controls",
        surface: "cockpit",
        arrange: (h) => arrangeOffice(h, { roster: "office-controls", tasks: OFFICE_RUN_TASKS }),
        teardown: (h, ctx) => cockpitOffice.teardown(h, ctx),
        async assert(h, ctx) {
            const steps = [];
            const rec = (step, ok, detail) => steps.push({ step, ok: !!ok, detail });
            if (ctx.missing) {
                rec("0. the office loads", false, ctx.missing);
                return steps;
            }
            await settleBoss(h);
            const press = async (k, n = 1) => {
                for (let i = 0; i < n; i++) {
                    await focusCockpit(h);
                    await key(h, k);
                    await sleep(120);
                }
                return probe(h);
            };
            // the Space chip over the desk the boss stands at, while it walks
            const chip = () => h.ev(`document.querySelector("[data-office-prompt]")?.textContent ?? ""`);

            // 0. the office fills the surface: no Cockpit title, the filters and switches in the HUD bar inside the
            // view, m menu alone in the footer and not lit, no Events rail
            const chrome = await h.ev(`(() => {
                const s = document.querySelector("[data-cockpit-surface]");
                const hud = s?.querySelector("[data-office-hud]");
                const foot = s?.querySelector("[data-cockpit-hints]");
                return {
                    title: [...(s?.querySelectorAll("h1") ?? [])].some((e) => e.textContent.trim() === "Cockpit"),
                    hud: hud?.textContent ?? "",
                    toggle: !!hud?.querySelector("[data-cockpit-view-toggle]"),
                    menu: !!foot?.querySelector("[data-office-footer-menu]"),
                    lit: foot?.querySelector("[data-office-footer-menu]")?.getAttribute("aria-expanded") === "true",
                    foot: foot?.textContent ?? "",
                    rail: !!document.querySelector('[aria-label="Events"]'),
                };
            })()`);
            rec(
                "0. the office fills the surface: no Cockpit title, the counts, Cards/Office and Live only in the HUD bar, only m menu in the footer, no Events rail",
                !chrome.title &&
                    chrome.hud.includes("work hours") &&
                    chrome.hud.includes("need you") &&
                    chrome.hud.includes("Live only") &&
                    chrome.toggle &&
                    chrome.menu &&
                    !chrome.lit &&
                    !chrome.foot.includes("column") &&
                    !chrome.rail,
                JSON.stringify(chrome)
            );
            await h.shot("cdp-shots/cockpit-office-hud.png");
            rec("0b. the run's t-1 dispatched its worker within 60 s", !!ctx.workerRunId, ctx.workerRunId ?? "no child run on t-1");

            // 1. quill's dialog box: its question and what it said, its answers as the ▶ menu, Send dim
            await h.ev(`document.querySelector(${JSON.stringify(desk("fx-office-quill"))})?.click()`);
            let p = await settleBoss(h);
            const words = await h.ev(`document.querySelector('[data-office-dialog="agent"]')?.textContent ?? ""`);
            rec(
                "1. a click on quill's desk opens its dialog box: the question under what it said, the answers, Send dim, Terminal and Full card",
                p?.dialog === "agent" &&
                    JSON.stringify(p.items) ===
                        JSON.stringify(["Merge now", "Wait for the Final shots", "Show me the diff first", "Send", "Terminal", "Full card"]) &&
                    JSON.stringify(p.dims) === "[3]" &&
                    p.sel === 0 &&
                    words.includes("Merge wave/7c1e into main now") &&
                    words.includes("The branch is ready."),
                JSON.stringify({ dialog: p?.dialog, items: p?.items, dims: p?.dims, sel: p?.sel, words: words.slice(0, 160) })
            );
            await h.shot("cdp-shots/cockpit-office-dialog.png");

            // 2. ↓ steps the ▶ over the dim Send; ↑ comes back
            const sels = [];
            for (let i = 0; i < 3; i++) sels.push((await press("ArrowDown"))?.sel);
            sels.push((await press("ArrowUp"))?.sel);
            rec("2. ↓ ↓ ↓ steps the ▶ 1, 2, then over the dim Send to Terminal; ↑ goes back to 2", JSON.stringify(sels) === "[1,2,4,2]", JSON.stringify(sels));

            // 3. Space, the A button, on an answer picks it and moves the ▶ to Send, which lights (no second Space: it
            // would send)
            await press("ArrowUp", 2);
            p = await press(" ");
            rec(
                "3. Space on the first answer picks it and moves the ▶ to Send, now lit",
                JSON.stringify(p?.answerSel?.["0"]) === "[0]" && p.sel === 3 && JSON.stringify(p.dims) === "[]",
                JSON.stringify({ answerSel: p?.answerSel, sel: p?.sel, dims: p?.dims })
            );
            await h.shot("cdp-shots/cockpit-office-dialog-picked.png");

            // 4. f opens the full card; Esc goes back to the box, Esc again to walking, ↵ Answer offered (quill asks)
            const card = await press("f");
            const back1 = await press("Escape");
            const back2 = await press("Escape");
            const answerChip = await chip();
            rec(
                "4. f opens the full card over the box; Esc goes back to the box, a second Esc to walking, ↵ Answer offered at quill, who asks",
                card?.popup === "agent" &&
                    card.dialog === "" &&
                    back1?.dialog === "agent" &&
                    back1.popup === "" &&
                    back2?.dialog === "" &&
                    back2.prompt === "agent" &&
                    answerChip.includes("Answer"),
                JSON.stringify({ card: [card?.popup, card?.dialog], back1: [back1?.dialog, back1?.popup], back2: [back2?.dialog, back2?.prompt], chip: answerChip })
            );
            await h.shot("cdp-shots/cockpit-office-talk.png");

            // 4b. Space at quill's desk opens the box again; Esc shuts it, and an Esc while walking is the office's too:
            // every Esc is consumed, so none goes on to the window (where macOS can take it out of full screen)
            await h.ev(`(() => {
                window.__officeEsc = [];
                if (!window.__officeEscHooked) {
                    window.__officeEscHooked = true;
                    window.addEventListener("keydown", (e) => e.key === "Escape" && window.__officeEsc.push(e.defaultPrevented));
                }
            })()`);
            const spaced = await press(" ");
            const shutEsc = await press("Escape");
            const walkEsc = await press("Escape");
            const escs = await h.ev(`window.__officeEsc`);
            rec(
                "4b. Space at quill opens its dialog box; Esc shuts it and an Esc while walking keeps walking, both consumed",
                spaced?.dialog === "agent" &&
                    shutEsc?.dialog === "" &&
                    walkEsc?.dialog === "" &&
                    walkEsc.prompt === "agent" &&
                    JSON.stringify(escs) === "[true,true]",
                JSON.stringify({ spaced: spaced?.dialog, shut: shutEsc?.dialog, walk: [walkEsc?.dialog, walkEsc?.prompt], prevented: escs })
            );

            // 5. loom at work: ↵ Talk offered once its box is shut; ↵ opens it again: Open, Reply, Terminal,
            // Background, Full card, and the ▶ stops at the last
            await h.ev(`document.querySelector(${JSON.stringify(desk("fx-office-loom"))})?.click()`);
            await settleBoss(h);
            await press("Escape");
            const talkChip = await chip();
            await press("Enter");
            p = await press("ArrowDown", 6);
            rec(
                "5. an agent at work offers ↵ Talk, and its box Open, Reply, Terminal, Background and Full card; the ▶ stops at the last",
                talkChip.includes("Talk") &&
                    p?.dialog === "agent" &&
                    JSON.stringify(p.items) === JSON.stringify(["Open", "Reply", "Terminal", "Background", "Full card"]) &&
                    p.sel === 4,
                JSON.stringify({ chip: talkChip, items: p?.items, sel: p?.sel })
            );
            await h.shot("cdp-shots/cockpit-office-dialog-working.png");

            // 5b. Reply opens the full card with its composer focused; m typed there types, the menu stays shut
            await press("ArrowUp", 3);
            await press("Enter");
            await sleep(300);
            const focused = await h.ev(`document.activeElement?.tagName ?? ""`);
            await key(h, "m");
            await sleep(150);
            const typed = await h.ev(`({ menu: window.__cockpitOfficeProbe().menu, value: document.activeElement?.value ?? null })`);
            rec(
                "5b. Reply opens the full card with its composer focused; m typed there types and the office menu stays shut",
                focused === "TEXTAREA" && typed.menu === false && (typed.value ?? "").includes("m"),
                JSON.stringify({ focused, typed })
            );
            await key(h, "Escape");
            await press("Escape", 2);

            // 5c. kite asks in two parts: ◀ Branch ▶ 1 of 2 over the first question's answers; → shows the second's,
            // ← the first's again
            await h.ev(`document.querySelector(${JSON.stringify(desk("fx-office-kite"))})?.click()`);
            // kite sits in another room than loom: a long walk
            const first = await settleBoss(h, 12000);
            const tabs = () => h.ev(`document.querySelector("[data-office-question-tabs]")?.textContent ?? ""`);
            const tab1 = await tabs();
            await h.shot("cdp-shots/cockpit-office-dialog-questions.png");
            const second = await press("ArrowRight");
            const tab2 = await tabs();
            const again = await press("ArrowLeft");
            rec(
                "5c. a two-part ask shows ◀ Branch ▶ 1 of 2 over its first answers; → switches to the second question's, ← back",
                first?.dialog === "agent" &&
                    tab1.includes("Branch") &&
                    tab1.includes("1 of 2") &&
                    JSON.stringify(first.items.slice(0, 3)) === JSON.stringify(["Keep feat/tray", "Rename to feat/tray-popover", "Send"]) &&
                    tab2.includes("Tests") &&
                    tab2.includes("2 of 2") &&
                    JSON.stringify(second?.items?.slice(0, 2)) === JSON.stringify(["Unit", "CDP"]) &&
                    again?.items?.[0] === "Keep feat/tray",
                JSON.stringify({ tab1, tab2, first: first?.items, second: second?.items, again: again?.items })
            );
            await press("Escape");

            // 6. the real run's table: the run's plate, its bar and counts, a column of its six tasks (four shown,
            // the rest counted); Open lead first, Adjust (the run has a plan), Full card last
            await h.ev(`[...document.querySelectorAll("[data-office-room]")].find((b) => !b.dataset.officeRoom.includes("fx-office-run"))?.click()`);
            await settleBoss(h);
            const run = await h.ev(`(async () => {
                // the run's plan can load after the page: wait for its task column
                for (let i = 0; i < 40 && !document.querySelector('[data-office-dialog="lead"] [data-office-task]'); i++) {
                    await new Promise((r) => setTimeout(r, 250));
                }
                const box = document.querySelector('[data-office-dialog="lead"]');
                return { text: box?.textContent ?? "", tasks: box?.querySelectorAll("[data-office-task]").length ?? 0 };
            })()`);
            p = await probe(h);
            rec(
                "6. a run's table opens its run's box: N/6 in its counts, four task rows and N more in the full card; Open lead first, Adjust, Full card last",
                p?.dialog === "lead" &&
                    p.items[0] === "Open lead" &&
                    p.items.includes("Adjust") &&
                    p.items[p.items.length - 1] === "Full card" &&
                    run.tasks === 4 &&
                    /\d+ more in the full card/.test(run.text) &&
                    run.text.includes("/6"),
                JSON.stringify({ dialog: p?.dialog, items: p?.items, tasks: run.tasks, text: run.text.slice(0, 240) })
            );
            await h.shot("cdp-shots/cockpit-office-dialog-run.png");

            // 6b. t-1's seat, its worker at work: the task's line and its worker's words; Open, Terminal and Full card
            await press("Escape");
            await h.ev(`document.querySelector('[data-office-seat$=":t-1"]')?.click()`);
            p = await settleBoss(h);
            const seat = await h.ev(`document.querySelector('[data-office-dialog="worker"]')?.textContent ?? ""`);
            rec(
                "6b. a worker's seat at work opens its box: the task and its worker, then Open, Terminal and Full card",
                p?.dialog === "worker" &&
                    JSON.stringify(p.items) === JSON.stringify(["Open", "Terminal", "Full card"]) &&
                    seat.includes("Machine stats") &&
                    seat.includes("vole"),
                JSON.stringify({ dialog: p?.dialog, items: p?.items, seat: seat.slice(0, 200) })
            );
            await h.shot("cdp-shots/cockpit-office-dialog-seat.png");

            // 7. a short view, the boss low in it: the box takes the head when one at the foot would cover the boss, and
            // never covers it. Desks only: each is an agent's, which has a box (a fixture run's seat has none)
            const w = await h.ev("window.innerWidth");
            await h.cdp("Emulation.setDeviceMetricsOverride", { width: w, height: 760, deviceScaleFactor: 1, mobile: false });
            await sleep(500);
            await press("Escape");
            const low = await h.ev(`(() => {
                const el = document.querySelector("[data-cockpit-office]");
                el.scrollTop = el.scrollHeight;
                const v = el.getBoundingClientRect();
                const desks = [...document.querySelectorAll("[data-office-desk]")]
                    .map((d) => ({ d, r: d.getBoundingClientRect() }))
                    .filter(({ r }) => r.top >= v.top && r.bottom <= v.bottom);
                desks.sort((a, b) => b.r.bottom - a.r.bottom);
                desks[0]?.d.click();
                return desks.length;
            })()`);
            p = await settleBoss(h, 5000);
            const geo = await h.ev(`(() => {
                const v = document.querySelector("[data-cockpit-office]").getBoundingClientRect();
                const box = document.querySelector("[data-office-dialog]")?.getBoundingClientRect();
                const boss = document.querySelector("[data-office-boss]")?.getBoundingClientRect();
                if (!box || !boss) return { box: !!box, boss: !!boss };
                // the plate stands 15 px over the box's top edge
                const top = box.top - 15;
                const overlap = !(box.right <= boss.left || box.left >= boss.right || box.bottom <= boss.top || top >= boss.bottom);
                return { overlap, bossBottom: boss.bottom - v.top, viewH: v.height };
            })()`);
            await h.cdp("Emulation.clearDeviceMetricsOverride", {});
            await sleep(400);
            // a box at the foot, 270 px and its plate 15 px over it, reaches up to viewH - 12 - 270 - 15
            const footTop = geo.viewH - 297;
            rec(
                "7. in a short view the box takes the head when one at the foot would cover the boss, the foot otherwise, and never covers the boss",
                low > 0 && geo.overlap === false && p?.edge === (geo.bossBottom > footTop ? "top" : "bottom"),
                JSON.stringify({ low, edge: p?.edge, footTop, geo })
            );

            // 8. m opens the office menu, the footer's m chip lit: START's items with their keys; ↓ moves; Esc shuts it
            await press("Escape", 2);
            const menu = await press("m");
            const lit = await h.ev(`document.querySelector("[data-office-footer-menu]")?.getAttribute("aria-expanded")`);
            await h.shot("cdp-shots/cockpit-office-menu.png");
            const moved = await press("ArrowDown");
            const shut = await press("Escape");
            rec(
                "8. m opens the office menu, the footer's m chip lit: Next Needs you, Notice board, Next desk, Previous desk, Lift, Move this room, Arrange automatically, Events, Mute sound, Cards view, All keys; ↓ moves the ▶; Esc shuts it",
                menu?.menu === true &&
                    lit === "true" &&
                    // Background is listed while a detached `claude --bg` session runs on this machine (the
                    // cockpit-office-background scenario owns it), so it is no part of this list
                    JSON.stringify(menu.menuItems.filter((i) => i !== "Background")) === JSON.stringify(["Next Needs you", "Notice board", "Next desk", "Previous desk", "Lift", "Move this room", "Arrange automatically", "Events", "Mute sound", "Cards view", "All keys"]) &&
                    menu.menuSel === 0 &&
                    moved?.menuSel === 1 &&
                    shut?.menu === false,
                JSON.stringify({ items: menu?.menuItems, lit, sel: [menu?.menuSel, moved?.menuSel], shut: shut?.menu })
            );

            // 9. the menu's Events shows the rail; Esc while walking hides it again
            await press("m");
            await press("ArrowDown", menu?.menuItems?.indexOf("Events") ?? 7);
            await press("Enter");
            const shown = await h.ev(`!!document.querySelector('[aria-label="Events"]')`);
            await press("Escape");
            const hidden = await h.ev(`!document.querySelector('[aria-label="Events"]')`);
            rec("9. the menu's Events shows the Events rail; Esc while walking hides it", shown && hidden, JSON.stringify({ shown, hidden }));

            // 9b. a HUD filter that hides the open box's desk: the box goes and the keys walk. probe.layer is the raw
            // layer atom, so the box's absence is read from probe.dialog
            // the boss may start across the office: the walk to quill's desk can outlast settleBoss's default 4 s
            await h.ev(`document.querySelector(${JSON.stringify(desk("fx-office-quill"))})?.click()`);
            const inBox = await settleBoss(h, 12000);
            const chipSel = `[...document.querySelectorAll('[data-office-hud] [aria-label="Show"] button')].find((b) => b.textContent.includes("working"))`;
            await h.ev(`${chipSel}?.click()`);
            await sleep(300);
            const filtered = await probe(h);
            const bossBefore = filtered?.boss;
            await focusCockpit(h);
            await hold(h, "ArrowLeft", 400);
            const walked = await settleBoss(h, 2000);
            await h.ev(`${chipSel}?.click()`);
            await sleep(300);
            const pressed = await h.ev(`${chipSel}?.getAttribute("aria-pressed")`);
            rec(
                "9b. a box whose desk a HUD filter hides leaves the office walking: no box, and an arrow walks the boss",
                inBox?.dialog === "agent" &&
                    filtered?.dialog === "" &&
                    bossBefore != null &&
                    walked?.boss != null &&
                    (walked.boss.x !== bossBefore.x || walked.boss.y !== bossBefore.y) &&
                    pressed === "false",
                JSON.stringify({ inBox: inBox?.dialog, filtered: filtered?.dialog, before: bossBefore, after: walked?.boss, pressed })
            );

            // 10. the footer: its m opens and shuts the office menu with the mouse, and its line shows the newest event.
            // A fixture roster changes no state, so a run's task-done is published as the engine's would be; it is
            // the newest, so the line names the run and "finished"
            await h.ev(`document.querySelector("[data-office-footer-menu]")?.click()`);
            await sleep(150);
            const opened = (await probe(h))?.menu;
            await h.ev(`document.querySelector("[data-office-footer-menu]")?.click()`);
            await sleep(150);
            const closed = (await probe(h))?.menu;
            let line = null;
            for (let i = 0; i < 2 && !line?.includes("finished"); i++) {
                const event = { id: "fx-office-controls-done", runid: ctx.runId, channelid: ctx.channelId, ts: Date.now(), kind: "task-done" };
                await h.rpc("eventpublish", { event: "run:event", scopes: [`run:${ctx.runId}`], data: { channelid: ctx.channelId, runid: ctx.runId, event } });
                for (let t = 0; t < 3000 && !line?.includes("finished"); t += 200) {
                    await sleep(200);
                    line = await h.ev(`document.querySelector("[data-office-footer-event]")?.textContent ?? null`);
                }
            }
            rec(
                "10. the footer's m opens and shuts the office menu; its line shows the newest event: who, finished, and when",
                opened === true && closed === false && line != null && line.includes("finished"),
                JSON.stringify({ opened, closed, line })
            );
            await h.shot("cdp-shots/cockpit-office-footer.png");

            return steps;
        },
    };
    // the Needs you notice board (docs/superpowers/specs/2026-10-16-office-needs-you-board-design.md; canvas
    // .superpowers/design/office-needs-you-board: Main, Dialog, States). Two Needs you rows are handed in through the
    // DEV hook, a plan to review whose Open lands on a real throwaway initiative and a learned rule; the animation is off
    // so every walk lands at once. Open only loads and shows: Accept and Dismiss call the server, so they are not pressed
    // (officeboardmodel.test.ts pins which of the strip's handlers each ▶ item runs)
    const cockpitOfficeNeedsYouBoard = {
        name: "office-needs-you-board",
        surface: "cockpit",
        async arrange(h) {
            const ctx = await arrangeOffice(h);
            if (ctx.missing) {
                return ctx;
            }
            try {
                const made = await h.rpc("effortcreate", { title: BOARD_SOURCE, chunks: [{ label: "Draft the graph" }] });
                ctx.effortId = made.effortoid;
                ctx.prevAnimation = await h.ev(`localStorage.getItem(${JSON.stringify(ANIMATION_KEY)})`);
                await h.ev("window.__cockpitOfficeAnimation(false)");
                await setBoardRows(h, boardRows(ctx.effortId));
                await sleep(400);
            } catch (e) {
                ctx.missing = `could not arrange the notice board: ${e?.message ?? e}`;
            }
            return ctx;
        },
        async teardown(h, ctx) {
            const step = async (what, fn) => {
                try {
                    await fn();
                } catch (e) {
                    console.error(`office-needs-you-board teardown: ${what} failed: ${e?.message ?? e}`);
                }
            };
            await step("hand back the live Needs you rows", () => h.ev("window.__cockpitOfficeAttention?.(null)"));
            await step("close the detail sheet", () =>
                h.ev(`document.querySelector('[data-jarvis-brief-sheet] button[aria-label="Close detail sheet"]')?.click()`)
            );
            await step("restore the animation switch", () =>
                h.ev(
                    ctx.prevAnimation == null
                        ? `localStorage.removeItem(${JSON.stringify(ANIMATION_KEY)})`
                        : `localStorage.setItem(${JSON.stringify(ANIMATION_KEY)}, ${JSON.stringify(ctx.prevAnimation)})`
                )
            );
            if (ctx.effortId) {
                await step("delete the initiative", () => h.rpc("effortdelete", { effortoid: ctx.effortId }));
            }
            await cockpitOffice.teardown(h, ctx);
        },
        async assert(h, ctx) {
            const steps = [];
            const rec = (step, ok, detail) => steps.push({ step, ok: !!ok, detail });
            if (ctx.missing) {
                rec("0. the office loads and the board's rows are set", false, ctx.missing);
                return steps;
            }
            await settleBoss(h);
            const press = async (k, n = 1) => {
                for (let i = 0; i < n; i++) {
                    await focusCockpit(h);
                    await key(h, k);
                    await sleep(120);
                }
                return probe(h);
            };
            // polls an expression in the page for up to ms; true once it holds
            const until = async (expr, ms = 4000) => {
                for (let t = 0; t <= ms; t += 100) {
                    if (await h.ev(expr).catch(() => false)) return true;
                    await sleep(100);
                }
                return false;
            };
            const atSpot = (p) =>
                !!p?.boss &&
                !!p.board?.spot &&
                p.boss.room === "hall" &&
                Math.abs(p.boss.x - p.board.spot.x) <= 3 &&
                Math.abs(p.boss.y - p.board.spot.y) <= 3;
            const read = (sel) => h.ev(`document.querySelector(${JSON.stringify(sel)})?.textContent ?? ""`);
            const clickDesk = async (id) => {
                await h.ev(`document.querySelector(${JSON.stringify(desk(id))})?.click()`);
                await settleBoss(h);
                await press("Escape");
            };
            const clickBoard = async () => {
                await h.ev(`document.querySelector("[data-office-board]")?.click()`);
                return settleBoss(h);
            };
            const clickFloor = (x, y) =>
                h.ev(`(() => {
                    const root = document.querySelector("[data-office-root]");
                    const r = root.getBoundingClientRect();
                    root.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: r.left + ${x}, clientY: r.top + ${y} }));
                })()`);
            const showBoard = () => h.ev(`document.querySelector("[data-office-board]")?.scrollIntoView({ block: "center" })`);
            const bubbles = () => h.ev(`document.querySelectorAll('[data-office-bubble="!"]').length`);
            const drawn = () =>
                h.ev(`({
                    strip: !!document.querySelector("[data-cockpit-needs-you]"),
                    board: !!document.querySelector("[data-office-board]"),
                    slips: document.querySelectorAll("[data-office-board] [data-office-board-slip]").length,
                    count: document.querySelector("[data-office-board-count]")?.textContent ?? null,
                })`);

            // 1. Main: the strip is gone from Office; the board is in the hall with a slip for each row and the count over it
            await until(`document.querySelectorAll("[data-office-board] [data-office-board-slip]").length === 2`);
            await showBoard();
            await sleep(200);
            const one = await drawn();
            // the HUD's need you counts the asking agents and the board's rows; step 9 reads the Cards tab's asking count
            const officeNeed = await h.ev(`parseInt(document.querySelector('[data-office-chip="asking"]')?.textContent ?? "", 10)`);
            const bubblesWaiting = await bubbles();
            await h.shot("cdp-shots/office-needs-you-board-1-main.png");
            rec(
                "1. in Office there is no Needs you strip; the notice board is drawn with two slips and the count 2 over it",
                one.strip === false && one.board && one.slips === 2 && one.count === "2",
                JSON.stringify({ ...one, officeNeed })
            );

            // 2. the cursor reaches the board: j steps along the office order to it (the last stop); n from the asking
            // desk lands on it after the asking desks
            await clickDesk("fx-office-quill");
            let p = await probe(h);
            const hops = [];
            for (let i = 0; i < (p?.order?.length ?? 0) + 2 && p?.cursor !== BOARD_KEY; i++) {
                p = await press("j");
                hops.push(p?.cursor);
            }
            p = await settleBoss(h);
            const walked = { cursor: p?.cursor, spot: atSpot(p), prompt: p?.prompt, hops: hops.length };
            await showBoard();
            await h.shot("cdp-shots/office-needs-you-board-2-cursor.png");
            await clickDesk("fx-office-quill");
            const nHops = [];
            for (let i = 0; i < 4 && nHops[nHops.length - 1] !== BOARD_KEY; i++) {
                await press("n");
                p = await settleBoss(h, 5000);
                nHops.push(p?.cursor);
            }
            rec(
                "2. j steps the cursor on to the notice board as the last stop, the boss standing under it with ↵ offered; n from the asking desk lands on it after the asking desks",
                walked.cursor === BOARD_KEY &&
                    walked.spot &&
                    walked.prompt === "board" &&
                    JSON.stringify(nHops) === JSON.stringify(["fx-office-quill", BOARD_KEY]) &&
                    atSpot(p),
                JSON.stringify({ walked, nHops, boss: p?.boss })
            );

            // 3. a click on the board from elsewhere walks the boss to its spot and opens its box on page 1 of 2
            await clickDesk("fx-office-quill");
            p = await clickBoard();
            const tabs = () => read("[data-office-question-tabs]");
            const three = {
                cursor: p?.cursor,
                dialog: p?.dialog,
                items: p?.items,
                sel: p?.sel,
                page: [p?.board?.page, p?.board?.of],
                title: await read('[data-office-dialog="board"] [data-office-board-title]'),
                tabs: await tabs(),
                spot: atSpot(p),
            };
            await h.shot("cdp-shots/office-needs-you-board-3-click.png");
            rec(
                "3. a click on the board from elsewhere walks the boss to it and opens its box: page 1 of 2, Plan to review · Jarvis as graph, the one item Open",
                three.cursor === BOARD_KEY &&
                    three.dialog === "board" &&
                    JSON.stringify(three.items) === JSON.stringify(["Open"]) &&
                    three.sel === 0 &&
                    JSON.stringify(three.page) === "[1,2]" &&
                    three.title === `Plan to review · ${BOARD_SOURCE}` &&
                    three.tabs.includes("1 of 2") &&
                    three.spot,
                JSON.stringify(three)
            );
            await press("Escape");

            // 4. the office menu lists Notice board second with its count; picking it walks the boss there and opens the box
            await clickDesk("fx-office-quill");
            const menu = await press("m");
            const entry = await read('[data-office-menu] [data-office-pick="1"]');
            await h.shot("cdp-shots/office-needs-you-board-4-menu.png");
            await press("ArrowDown");
            await press("Enter");
            p = await settleBoss(h);
            rec(
                "4. m lists Notice board second with the count 2; picking it walks the boss to the board and opens the box on page 1 of 2",
                menu?.menuItems?.[1] === "Notice board" &&
                    entry.includes("Notice board") &&
                    entry.includes("2") &&
                    p?.dialog === "board" &&
                    p.cursor === BOARD_KEY &&
                    JSON.stringify([p.board?.page, p.board?.of]) === "[1,2]" &&
                    atSpot(p),
                JSON.stringify({ items: menu?.menuItems, entry, dialog: p?.dialog, page: [p?.board?.page, p?.board?.of], boss: p?.boss })
            );

            // 5. → pages to the learned rule (Accept, Dismiss, Why), the ▶ on Accept; ↓ ↓ ↵ on Why shows the words that
            // raised it; ← goes back to page 1 with the ▶ on its first item and the Why shut
            p = await press("ArrowRight");
            const learned = {
                page: [p?.board?.page, p?.board?.of],
                items: p?.items,
                sel: p?.sel,
                title: await read('[data-office-dialog="board"] [data-office-board-title]'),
                quote: await read('[data-office-dialog="board"] [data-office-board-quote]'),
            };
            await h.shot("cdp-shots/office-needs-you-board-5-learned.png");
            await press("ArrowDown", 2);
            p = await press("Enter");
            const why = {
                sel: p?.sel,
                open: p?.board?.why,
                quote: await read('[data-office-dialog="board"] [data-office-board-quote]'),
            };
            await h.shot("cdp-shots/office-needs-you-board-5-why.png");
            p = await press("ArrowLeft");
            const back = { page: p?.board?.page, items: p?.items, sel: p?.sel, why: p?.board?.why };
            rec(
                "5. → pages to Learned rule with Accept, Dismiss and Why, the ▶ on Accept; ↓ ↓ ↵ on Why shows the quote; ← back to page 1 puts the ▶ on its first item again",
                JSON.stringify(learned.page) === "[2,2]" &&
                    JSON.stringify(learned.items) === JSON.stringify(["Accept", "Dismiss", "Why"]) &&
                    learned.sel === 0 &&
                    learned.title.startsWith("Learned rule") &&
                    learned.quote === "" &&
                    why.open === true &&
                    why.quote.includes(BOARD_QUOTE) &&
                    back.page === 1 &&
                    JSON.stringify(back.items) === JSON.stringify(["Open"]) &&
                    back.sel === 0 &&
                    back.why === false,
                JSON.stringify({ learned, why, back })
            );

            // 6. Esc closes the box and offers ↵ Read over the boss; ↵ opens it again
            p = await press("Escape");
            const prompt = await read('[data-office-prompt="board"]');
            await h.shot("cdp-shots/office-needs-you-board-6-prompt.png");
            const shut = { dialog: p?.dialog, prompt: p?.prompt };
            p = await press("Enter");
            rec(
                "6. Esc closes the box and the ↵ Read prompt shows at the board; ↵ opens the box again",
                shut.dialog === "" && shut.prompt === "board" && prompt.includes("Read") && p?.dialog === "board",
                JSON.stringify({ shut, prompt, reopened: p?.dialog })
            );

            // 6b. the paging keys act only while the box is open: shut, h and l leave the page; open, they turn it
            p = await press("ArrowRight");
            const turned = p?.board?.page;
            p = await press("Escape");
            const shutOn = p?.board?.page;
            await press("h");
            await press("l");
            p = await press("h");
            const stayed = { page: p?.board?.page, dialog: p?.dialog };
            await press("Enter");
            p = await press("h");
            const reopened = { page: p?.board?.page, dialog: p?.dialog, items: p?.items };
            rec(
                "6b. with the box shut at the board h and l do not turn the page; with it open they do",
                turned === 2 &&
                    shutOn === 2 &&
                    stayed.page === 2 &&
                    stayed.dialog === "" &&
                    reopened.dialog === "board" &&
                    reopened.page === 1 &&
                    JSON.stringify(reopened.items) === JSON.stringify(["Open"]),
                JSON.stringify({ turned, shutOn, stayed, reopened })
            );

            // 7. ↵ on Open opens the initiative the plan came from, on Jarvis's detail sheet
            await press("Enter");
            const landed = await until(
                `document.querySelector('[data-jarvis-brief-sheet="effort"]')?.innerText.includes(${JSON.stringify(BOARD_SOURCE)}) === true`,
                15000
            );
            const surface = await h.activeSurfaceLabel();
            await h.shot("cdp-shots/office-needs-you-board-7-open.png");
            rec(
                "7. ↵ on Open opens the plan's initiative: Jarvis, with its detail sheet on it",
                landed && surface === "Jarvis",
                JSON.stringify({ landed, surface })
            );
            await h.ev(`document.querySelector('[data-jarvis-brief-sheet] button[aria-label="Close detail sheet"]')?.click()`);
            await h.goto("cockpit");
            const back7 = await waitForOffice(h);
            await settleBoss(h);

            // 8. the rows going while the box is open: the box closes, the bubble and slips go, the board stays, and the
            // boss still stands at it with the keys walking
            await clickDesk("fx-office-quill");
            await clickBoard();
            const open8 = await probe(h);
            await setBoardRows(h, []);
            await until(`document.querySelectorAll("[data-office-board-slip]").length === 0`);
            await sleep(300);
            p = await probe(h);
            const empty = await drawn();
            await showBoard();
            await h.shot("cdp-shots/office-needs-you-board-8-cleared.png");
            rec(
                "8. the last row going while the box is open closes it, drops the bubble and the slips and leaves the board drawn; the boss still stands at it, the layer back to walking",
                back7 == null &&
                    open8?.dialog === "board" &&
                    p?.dialog === "" &&
                    p.layer === "walk" &&
                    p.cursor === BOARD_KEY &&
                    atSpot(p) &&
                    empty.board &&
                    empty.slips === 0 &&
                    empty.count === null &&
                    (await bubbles()) === bubblesWaiting - 1 &&
                    JSON.stringify([p.board?.count, p.board?.page]) === "[0,0]",
                JSON.stringify({ back7, open8: open8?.dialog, dialog: p?.dialog, layer: p?.layer, cursor: p?.cursor, boss: p?.boss, spot: p?.board?.spot, empty, bubbles: [bubblesWaiting, await bubbles()] })
            );

            // 8b. with no rows the boss still walks up to the quiet board and the cursor stays on it: no jump to a desk
            await clickDesk("fx-office-quill");
            const spot = (await probe(h))?.board?.spot;
            if (spot) await clickFloor(spot.x, spot.y);
            p = await settleBoss(h);
            await sleep(800);
            const still = await probe(h);
            await h.shot("cdp-shots/office-needs-you-board-8b-quiet.png");
            rec(
                "8b. with no rows waiting the boss walks up to the board and the cursor stays on it, the boss where it stopped: no jump to a desk, nothing offered",
                spot != null &&
                    atSpot(p) &&
                    p.cursor === BOARD_KEY &&
                    atSpot(still) &&
                    still.boss.x === p.boss.x &&
                    still.boss.y === p.boss.y &&
                    still.cursor === BOARD_KEY &&
                    still.prompt === "" &&
                    still.dialog === "",
                JSON.stringify({ spot, stopped: [p?.cursor, p?.boss], later: [still?.cursor, still?.boss, still?.prompt, still?.dialog] })
            );

            // 8c. four rows: three slips at most, the count says four, and the box has four pages
            await setBoardRows(h, boardRows(ctx.effortId, 4));
            await until(`document.querySelectorAll("[data-office-board-slip]").length === 3`);
            await sleep(300);
            const four = await drawn();
            await showBoard();
            p = await clickBoard();
            const tabs4 = await tabs();
            await h.shot("cdp-shots/office-needs-you-board-8c-four.png");
            rec(
                "8c. four rows pin three slips, the count over the board reads 4, and the box pages 1 of 4",
                four.slips === 3 && four.count === "4" && p?.board?.count === 4 && tabs4.includes("1 of 4"),
                JSON.stringify({ four, count: p?.board?.count, tabs: tabs4 })
            );
            await press("Escape");

            // 9. Cards keeps the strip, with the same rows
            await setBoardRows(h, boardRows(ctx.effortId));
            await sleep(300);
            await focusCockpit(h);
            await key(h, "o");
            const strip = await until(`document.querySelectorAll("[data-cockpit-needs-you] [data-needs-you-row]").length === 2`);
            const cards = await h.ev(`({
                rows: [...document.querySelectorAll("[data-cockpit-needs-you] [data-needs-you-row]")].map((r) => r.dataset.needsYouRow),
                office: !!document.querySelector("[data-cockpit-office]"),
                board: !!document.querySelector("[data-office-board]"),
                need: parseInt([...document.querySelectorAll("button")].find((b) => /need you$/.test(b.textContent.trim()))?.textContent ?? "", 10),
            })`);
            await h.shot("cdp-shots/office-needs-you-board-9-cards.png");
            rec(
                "9. Cards shows the strip with the same two rows and no board; Office's HUD counted those rows on top of the Cards tab's asking agents",
                strip &&
                    JSON.stringify(cards.rows) === JSON.stringify([BOARD_PLAN_KEY, BOARD_LEARN_KEY]) &&
                    !cards.office &&
                    !cards.board &&
                    Number.isFinite(cards.need) &&
                    officeNeed === cards.need + 2,
                JSON.stringify({ ...cards, officeNeed })
            );
            return steps;
        },
    };
    // the spec's Benchmark: Cards then Office on the office-bench roster plus three fixture runs (48 agents over six projects,
    // of which one floor of four rooms is drawn, about 30 people)
    const cockpitOfficeBench = {
        name: "cockpit-office-bench",
        surface: "cockpit",
        async arrange(h) {
            const ctx = { prevFixture: existsSync(FIXTURE) ? readFileSync(FIXTURE, "utf8") : null };
            mkdirSync(new URL(".", FIXTURE), { recursive: true });
            writeFileSync(FIXTURE, JSON.stringify(ROSTERS["office-bench"](Date.now()), null, 2));
            ctx.prevView = await h.ev(`localStorage.getItem(${JSON.stringify(VIEW_KEY)})`);
            await h.ev(`localStorage.setItem(${JSON.stringify(VIEW_KEY)}, JSON.stringify("cards"))`);
            // the rooms arranged automatically, as the office opens for a viewer who never moved one
            ctx.prevLayout = await h.ev(`localStorage.getItem(${JSON.stringify(LAYOUT_KEY)})`);
            await h.ev(`localStorage.removeItem(${JSON.stringify(LAYOUT_KEY)})`);
            try {
                await h.ev("location.reload()");
            } catch {
                // the evaluate is cut off by the navigation it just started
            }
            // the old document can still answer for a moment after the reload starts
            await sleep(1500);
            for (let waited = 0; waited < 40000; waited += 500) {
                if (await h.ev("!!window.TabRpcClient && !!document.querySelector('nav button')").catch(() => false)) break;
                await sleep(500);
            }
            await h.goto("cockpit");
            ctx.missing = await h.ev(`(async () => {
                for (let i = 0; i < 120 && !(document.querySelector("[data-cockpit-view-toggle]") && window.__cockpitOffice); i++) await new Promise((r) => setTimeout(r, 250));
                return document.querySelector("[data-cockpit-view-toggle]") && window.__cockpitOffice ? null : "after 30 s the Cockpit has no view toggle or dev hooks";
            })()`);
            return ctx;
        },
        async assert(h, ctx) {
            const steps = [];
            const rec = (step, ok, detail) => steps.push({ step, ok: !!ok, detail });
            if (ctx.missing) {
                rec("0. the Cockpit loads", false, ctx.missing);
                return steps;
            }
            // without it Performance.getMetrics returns nothing and every budget reads NaN
            await h.cdp("Performance.enable");
            const r = {};
            const cards = await metrics(h);
            await sleep(HOLD_MS);
            const cardsHold = await metrics(h);
            r.baseBusyPct = round1(busyPct(cards, cardsHold));

            // the boss pet's entrance is a one-off 0.5 to 2.2 s as the office first opens: not what the bench measures
            await dev(h, { runs: BENCH_RUNS, entrance: "skip" });
            r.openMs = Math.round(
                await h.ev(`(async () => {
                    const t0 = performance.now();
                    [...document.querySelectorAll("[data-cockpit-view-toggle] button")].find((b) => b.textContent.trim() === "Office")?.click();
                    // drawn: the desks are in and each canvas has painted (a checkout from before the canvases has none)
                    const drawn = () =>
                        document.querySelector("[data-office-desk]") &&
                        [...document.querySelectorAll("[data-office-root] canvas[data-office-canvas]")].every((c) => c.dataset.officeDrawn != null);
                    for (let i = 0; i < 600 && !drawn(); i++) await new Promise((r) => requestAnimationFrame(r));
                    return performance.now() - t0;
                })()`)
            );
            await sleep(2000);
            const open = await metrics(h);
            r.officeNodes = await h.ev('document.querySelector("[data-office-root]")?.getElementsByTagName("*").length ?? 0');
            r.heapOpenMB = mb(open.heap - cardsHold.heap);
            r.nodesAdded = open.nodes - cardsHold.nodes;

            await dev(h, { patrol: true, walkers: 3 });
            await sleep(1000);
            const walk0 = await metrics(h);
            await sleep(HOLD_MS);
            const walk1 = await metrics(h);
            r.busyRawPct = round1(busyPct(walk0, walk1));
            r.busyPct = round1(r.busyRawPct - r.baseBusyPct);

            // the quiet office (spec: every agent idle inside the Finished window, the hold starting once everyone has
            // settled). Quiet brings the lounge's 18 people back to their desks; walking back three at a time would take
            // a minute, so the animation goes off for a moment and they are there at once. The hold starts when no one
            // walks and no clock runs (the cheers of the desks that just turned done last 1.5 s).
            await dev(h, { patrol: false, walkers: 0 });
            await h.ev("window.__cockpitOfficeAnimation(false)");
            await dev(h, { quiet: true });
            await sleep(300);
            await h.ev("window.__cockpitOfficeAnimation(true)");
            const settleT0 = Date.now();
            let settled = null;
            for (let t = 0; t < 10_000 && settled == null; t += 200) {
                const q = await probe(h);
                if (q?.walking === 0 && q.clock?.frame === false && q.clock?.walk === false) settled = q;
                else await sleep(200);
            }
            r.quietSettleMs = settled ? Date.now() - settleT0 : null;
            const quiet0 = await metrics(h);
            await sleep(HOLD_MS);
            const quiet1 = await metrics(h);
            r.busyQuietPct = round1(busyPct(quiet0, quiet1) - r.baseBusyPct);
            const quietEnd = await probe(h);
            r.clockQuiet = quietEnd?.clock;
            r.walkingQuiet = quietEnd?.walking;

            await h.cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
            await dev(h, { quiet: false, patrol: true, walkers: 3 });
            await sleep(1000);
            const red0 = await metrics(h);
            await sleep(HOLD_MS);
            const red1 = await metrics(h);
            r.busyReducedPct = round1(busyPct(red0, red1) - r.baseBusyPct);
            await h.cdp("Emulation.setEmulatedMedia", { features: [] });
            await dev(h, { patrol: false, walkers: 0 });

            // the lounge holds 5 and reads +N past them, so the people drawn are not the roster: count the floor's desks
            // and seats plus the boss, once the walkers who go to the lounge three at a time have arrived. The office
            // draws one floor, four rooms, so the bench's six projects make two floors
            let p = await probe(h);
            for (let t = 0; t < 20_000 && p?.walking !== 0; t += 250) {
                await sleep(250);
                p = await probe(h);
            }
            r.roster = (p?.desks ?? 0) + (p?.seats ?? 0) + 1;
            r.floors = p?.floors?.length;
            r.people = p?.people;
            r.cache = p?.cache?.entries;

            const toggle = (label) =>
                h.ev(`[...document.querySelectorAll("[data-cockpit-view-toggle] button")].find((b) => b.textContent.trim() === ${JSON.stringify(label)})?.click()`);
            await toggle("Cards");
            await sleep(2000);
            const closed = await metrics(h);
            r.heapAfterMB = mb(closed.heap - cardsHold.heap);

            // a second round trip: the first one's figure carries the dev page's own growth (+1.56 MB with the office
            // never opened), so what the office keeps is what a second open and close adds
            await toggle("Office");
            await h.ev(`(async () => {
                for (let i = 0; i < 600 && !document.querySelector("[data-office-desk]"); i++) await new Promise((r) => requestAnimationFrame(r));
            })()`);
            await sleep(2000);
            await toggle("Cards");
            await sleep(2000);
            const trip = await metrics(h);
            r.heapTripMB = mb(trip.heap - closed.heap);

            rec(
                "0. the bench fills a floor of four rooms with about 30 people (desks, seats and the boss), the other two projects on the floor above",
                r.roster >= 28 && r.floors === 2,
                `${r.roster} (${p?.desks} desks, ${p?.seats} seats, ${p?.people} drawn), ${r.floors} floors`
            );
            rec("1. JS heap, Office minus Cards <= 5 MB", r.heapOpenMB <= 5, `${r.heapOpenMB} MB`);
            rec("2. DOM nodes added <= 2,000", r.nodesAdded <= 2000, `${r.nodesAdded} (the office ${r.officeNodes})`);
            rec("3. main thread busy walking, over the Cards baseline <= 2 %", r.busyPct <= 2, `${r.busyPct} % (${r.busyRawPct} % raw, baseline ${r.baseBusyPct} %)`);
            rec("4. busy under reduced motion <= 0.5 %", r.busyReducedPct <= 0.5, `${r.busyReducedPct} %`);
            rec(
                "5. busy in a quiet office (everyone settled at a desk) <= 0.3 %, no one walking and no clock running",
                r.quietSettleMs != null && r.busyQuietPct <= 0.3 && r.walkingQuiet === 0 && r.clockQuiet?.frame === false && r.clockQuiet?.walk === false,
                `${r.busyQuietPct} %, settled in ${r.quietSettleMs} ms, ${r.walkingQuiet} walking, ${JSON.stringify(r.clockQuiet)}`
            );
            rec("6. sprite cache <= 600 entries", r.cache <= 600, `${r.cache}`);
            rec("7. heap a second Office round trip adds, back in Cards <= 1 MB", r.heapTripMB <= 1, `${r.heapTripMB} MB (first return ${r.heapAfterMB} MB over the first Cards read)`);
            rec("8. toggle click to the office drawn <= 150 ms", r.openMs <= 150, `${r.openMs} ms`);
            console.log(`[cockpit-office-bench] ${JSON.stringify(r)}`);
            return steps;
        },
        async teardown(h, ctx) {
            await h.ev("window.__cockpitOffice?.(null)");
            await h.cdp("Emulation.setEmulatedMedia", { features: [] });
            await h.ev(
                ctx.prevView == null
                    ? `localStorage.removeItem(${JSON.stringify(VIEW_KEY)})`
                    : `localStorage.setItem(${JSON.stringify(VIEW_KEY)}, ${JSON.stringify(ctx.prevView)})`
            );
            await h.ev(
                ctx.prevLayout == null
                    ? `localStorage.removeItem(${JSON.stringify(LAYOUT_KEY)})`
                    : `localStorage.setItem(${JSON.stringify(LAYOUT_KEY)}, ${JSON.stringify(ctx.prevLayout)})`
            );
            if (ctx.prevFixture != null) writeFileSync(FIXTURE, ctx.prevFixture);
            else rmSync(FIXTURE, { force: true });
            await h.ev("location.reload()");
            await sleep(1500);
        },
    };

    // Office sounds (docs/superpowers/specs/2026-10-16-office-sounds-design.md) on the DEV log sink: the office logs what it
    // would play instead of playing it (cockpitofficedevhooks.ts), so this checks which cue, when, and whether sound is
    // allowed, not how anything sounds (a hand check). Fixture runs and real keys, no real run.
    const SOUND_KEYS = ["events", "ui", "music", "volume", "muted"].map((k) => `cockpit.office.sound.${k}`);
    const SOUND_MUTED_KEY = "cockpit.office.sound.muted";
    const JINGLES = ["landed", "taskDone", "needsYou", "setback"];
    // the Settings rows the office's sound has, with their titles
    const SOUND_ROWS = [
        ["appearance.officesoundevents", "Office jingles"],
        ["appearance.officesoundui", "Boss sounds"],
        ["appearance.officesoundmusic", "Office music"],
        ["appearance.officesoundvolume", "Office volume"],
    ];
    // one fixture run whose tasks are in these states, `o` laid over the run (done, landed)
    const soundRuns = (states, o = {}) => devRuns("fx-sound-run", [["Sound run", "arcterm", states]]).map((r) => ({ ...r, ...o }));
    const cockpitOfficeSound = {
        name: "office-sound",
        surface: "cockpit",
        async arrange(h) {
            const ctx = { prevFixture: existsSync(FIXTURE) ? readFileSync(FIXTURE, "utf8") : null, prevSound: {} };
            mkdirSync(new URL(".", FIXTURE), { recursive: true });
            writeFileSync(FIXTURE, JSON.stringify(ROSTERS["office"](Date.now()), null, 2));
            ctx.prevView = await h.ev(`localStorage.getItem(${JSON.stringify(VIEW_KEY)})`);
            ctx.prevAnimation = await h.ev(`localStorage.getItem(${JSON.stringify(ANIMATION_KEY)})`);
            await h.ev(`localStorage.setItem(${JSON.stringify(VIEW_KEY)}, JSON.stringify("office"))`);
            // the defaults hold: the atoms read these keys as the page loads
            for (const k of SOUND_KEYS) {
                ctx.prevSound[k] = await h.ev(`localStorage.getItem(${JSON.stringify(k)})`);
                await h.ev(`localStorage.removeItem(${JSON.stringify(k)})`);
            }
            await h.reload();
            await h.goto("cockpit");
            ctx.missing = await waitForOffice(h);
            if (!ctx.missing) {
                // nothing moves under the shots; the Needs you list is a fixture with no rows, so a live row that arrives
                // meanwhile is no cue in the log
                await h.ev("window.__cockpitOfficeAnimation(false)");
                await h.ev("window.__cockpitOfficeAttention([])");
                await dev(h, { entrance: "skip" });
            }
            return ctx;
        },
        async teardown(h, ctx) {
            const step = async (what, fn) => {
                try {
                    await fn();
                } catch (e) {
                    console.error(`office-sound teardown: ${what} failed: ${e?.message ?? e}`);
                }
            };
            const put = (key, v) => (v == null ? `localStorage.removeItem(${JSON.stringify(key)})` : `localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(v)})`);
            await step("turn the sound log off", () => h.ev("window.__cockpitOfficeSound?.(false)"));
            await step("hand back the live Needs you rows", () => h.ev("window.__cockpitOfficeAttention?.(null)"));
            await step("clear the dev state", () => h.ev("window.__cockpitOffice?.(null)"));
            await step("put back the animation switch", () => h.ev(put(ANIMATION_KEY, ctx.prevAnimation)));
            await step("put back the view", () => h.ev(put(VIEW_KEY, ctx.prevView)));
            for (const k of SOUND_KEYS) {
                await step(`put back ${k}`, () => h.ev(put(k, ctx.prevSound?.[k])));
            }
            await step("put back the roster", () => {
                if (ctx.prevFixture != null) writeFileSync(FIXTURE, ctx.prevFixture);
                else rmSync(FIXTURE, { force: true });
            });
            await step("reload without the fixture", async () => {
                await h.ev("location.reload()");
                await sleep(1500);
            });
        },
        async assert(h, ctx) {
            const steps = [];
            const rec = (step, ok, detail) => steps.push({ step, ok: !!ok, detail });
            if (ctx.missing) {
                rec("0. the office loads", false, ctx.missing);
                return steps;
            }
            const log = async () => (await h.ev("window.__cockpitOfficeSoundLog ? window.__cockpitOfficeSoundLog() : null")) ?? [];
            const ls = (k) => h.ev(`localStorage.getItem(${JSON.stringify(k)})`);
            const press = async (k) => {
                await focusCockpit(h);
                await key(h, k);
                await sleep(150);
                return probe(h);
            };
            const tail = (l) => JSON.stringify(l.slice(-4));
            // the cue effects run after the render that follows each dev() call
            const setRuns = async (runs, ms = 500) => {
                await dev(h, { runs });
                await sleep(ms);
                return log();
            };

            // 1. a run that only came into view is silent
            await h.ev("window.__cockpitOfficeSound(true)");
            const l1 = await setRuns(soundRuns(["running", "running"]));
            rec(
                "1. a run that only came into view is silent: none of landed, taskDone, needsYou, setback in the log",
                !l1.some((c) => JINGLES.includes(c)),
                tail(l1)
            );

            // 2. a task finishing plays taskDone
            const l2 = await setRuns(soundRuns(["done", "running"]));
            rec("2. a task that finishes plays taskDone", l2.at(-1) === "taskDone" && l2.length === l1.length + 1, tail(l2));

            // 3. a task that fails plays setback (a gap past the 1.5 s one between cues)
            await sleep(1600);
            const l3 = await setRuns(soundRuns(["done", "review-failed"]));
            rec("3. a task that fails its review plays setback", l3.at(-1) === "setback" && l3.length === l2.length + 1, tail(l3));

            // 4. a run that lands plays landed, one cue for the burst (the task finishing with it does not add taskDone)
            await sleep(1600);
            const l4 = await setRuns(soundRuns(["done", "done"], { done: true, landed: true }));
            rec(
                "4. a run that lands plays landed, one entry for the burst and not taskDone too",
                l4.at(-1) === "landed" && l4.length === l3.length + 1,
                tail(l4)
            );

            // 5. s mutes: nothing plays for what would have played
            await focusCockpit(h);
            await key(h, "s");
            const muted = await ls(SOUND_MUTED_KEY);
            await sleep(1600);
            const before5 = (await log()).length;
            await setRuns(soundRuns(["running", "running"]), 300);
            const l5 = await setRuns(soundRuns(["done", "running"]));
            rec(
                "5. s mutes (cockpit.office.sound.muted true), and a task finishing then logs nothing",
                muted === "true" && l5.length === before5,
                JSON.stringify({ muted, before: before5, after: l5.length, tail: l5.slice(-2) })
            );

            // 6. s again unmutes; the office menu lists Mute sound right before Cards view with its key
            await focusCockpit(h);
            await key(h, "s");
            const unmuted = await ls(SOUND_MUTED_KEY);
            const menu = await press("m");
            const items = menu?.menuItems ?? [];
            const at = items.indexOf("Mute sound");
            const menuKey = await h.ev(`(() => {
                const row = [...document.querySelectorAll("[data-office-menu] [role=menuitem]")].find((b) => b.querySelector("span.truncate")?.textContent.trim() === "Mute sound");
                return row ? (row.querySelector("kbd")?.textContent.trim() ?? null) : undefined;
            })()`);
            await h.shot("cdp-shots/office-sound-menu.png");
            await key(h, "Escape");
            rec(
                "6. s again unmutes (muted false); m lists Mute sound right before Cards view, its row showing the key s",
                unmuted === "false" && at > 0 && items[at + 1] === "Cards view" && menuKey === "s",
                JSON.stringify({ unmuted, items, menuKey })
            );

            // 7. Settings → Appearance: the four rows, the music switch and the volume write their keys
            await h.goto("settings");
            const up = await fx.spOpen(h, "appearance");
            await h.ev(`${fx.spRow("appearance.officesoundevents")}?.scrollIntoView({ block: "center" })`);
            await sleep(200);
            const rows = [];
            for (const [id, title] of SOUND_ROWS) {
                rows.push(await h.ev(`${fx.spRow(id)}?.textContent.includes(${JSON.stringify(title)}) ?? false`));
            }
            const musicSwitch = `${fx.spRow("appearance.officesoundmusic")}?.querySelector('[role="switch"]')`;
            await h.ev(`${musicSwitch}?.click()`);
            await sleep(200);
            const musicOn = await ls("cockpit.office.sound.music");
            await h.ev(`${musicSwitch}?.click()`);
            await sleep(200);
            const musicOff = await ls("cockpit.office.sound.music");
            const opened = await fx.spClick(h, `${fx.spRow("appearance.officesoundvolume")}?.querySelector("button[data-select]")`);
            let picked = false;
            for (let t = 0; t <= 3000 && !picked; t += 100) {
                picked = await h.ev(fx.caMenuClick("75 %")).catch(() => false);
                if (!picked) await sleep(100);
            }
            await sleep(300);
            const volume = await ls("cockpit.office.sound.volume");
            await h.ev(`${fx.spRow("appearance.officesoundui")}?.scrollIntoView({ block: "center" })`);
            await sleep(200);
            await h.shot("cdp-shots/office-sound-settings.png");
            rec(
                "7. Appearance has Office jingles, Boss sounds, Office music and Office volume; the music switch writes true then false, the volume 75 % writes 0.75",
                up && rows.every(Boolean) && musicOn === "true" && musicOff === "false" && opened && picked && volume === "0.75",
                JSON.stringify({ up, rows, musicOn, musicOff, opened, picked, volume })
            );

            // 8. the boss's sounds: footsteps while the arrows walk, one bump at a wall, a blip as the menu opens
            await h.goto("cockpit");
            const back = await waitForOffice(h);
            if (back) {
                rec("8. the boss's sounds", false, back);
                return steps;
            }
            await h.ev("window.__cockpitOfficeSoundSet({ ui: true })");
            await h.ev("window.__cockpitOfficeAnimation(true)");
            await focusCockpit(h);
            // the layer is walk: in a dialog box the arrows move its ▶ and the boss stands still
            await key(h, "Escape");
            await sleep(150);
            const start = await settleBoss(h, 6000);
            const log8 = (await log()).length;
            await hold(h, "ArrowRight", 700);
            let there = (await settleBoss(h, 2000))?.boss;
            if (there && start?.boss && there.x === start.boss.x) {
                await hold(h, "ArrowLeft", 700);
                there = (await settleBoss(h, 2000))?.boss;
            }
            const walked = (await log()).slice(log8);
            rec(
                "8a. the arrows walking the boss log step, and the boss moved",
                !!start?.boss && !!there && there.x !== start.boss.x && walked.includes("step"),
                JSON.stringify({ from: start?.boss, to: there, walked })
            );
            // up until nothing moves any more: the boss stands at a wall
            let rest = there;
            let atWall = false;
            for (let i = 0; i < 8 && !atWall; i++) {
                await hold(h, "ArrowUp", 1000);
                const b = (await settleBoss(h, 2000))?.boss;
                atWall = !!b && !!rest && b.x === rest.x && b.y === rest.y;
                rest = b;
            }
            const log8b = (await log()).length;
            await hold(h, "ArrowUp", 1000);
            const bumped = (await log()).slice(log8b);
            rec(
                "8b. at a wall one ArrowUp hold logs exactly one bump and no step",
                atWall && bumped.filter((c) => c === "bump").length === 1 && !bumped.includes("step"),
                JSON.stringify({ atWall, at: rest, bumped })
            );
            const log8c = (await log()).length;
            await press("m");
            const opened8 = (await log()).slice(log8c);
            await key(h, "Escape");
            rec("8c. m opening the office menu logs blip", opened8.includes("blip"), JSON.stringify(opened8));
            await h.ev("window.__cockpitOfficeAnimation(false)");
            await h.ev("window.__cockpitOfficeSoundSet({ ui: false })");

            // 9. the music: day, night, and off while muted
            await dev(h, { afterHours: false });
            await h.ev("window.__cockpitOfficeSoundSet({ music: true })");
            await sleep(300);
            const m1 = await log();
            await dev(h, { afterHours: true });
            await sleep(300);
            const m2 = await log();
            await focusCockpit(h);
            await key(h, "s");
            await sleep(300);
            const m3 = await log();
            await key(h, "s");
            const unmuted9 = await ls(SOUND_MUTED_KEY);
            await h.ev("window.__cockpitOfficeSoundSet({ music: false })");
            rec(
                "9. music on plays music:day, after hours music:night, and s (muted) music:off",
                m1.at(-1) === "music:day" && m2.at(-1) === "music:night" && m3.at(-1) === "music:off" && unmuted9 === "false",
                JSON.stringify({ day: m1.at(-1), night: m2.at(-1), muted: m3.at(-1), unmuted: unmuted9 })
            );
            return steps;
        },
    };

    // Floors (docs/superpowers/specs/2026-10-16-office-floors-design.md; canvas .superpowers/design/office-floors: Main,
    // LiftPanel, Ride, Drag, Capacity, Room, NoticeBoard) on the office-floors fixture: nine projects over three floors
    // arranged as the Main board has them, driven by real keys and, where a step says so, the real mouse. The Office
    // box is sized by the window (sizeOfficeBox): 1,424 x 800 for steps 1-12, which makes a room 579 x 353
    const cockpitOfficeFloors = {
        name: "cockpit-office-floors",
        surface: "cockpit",
        async arrange(h) {
            const ctx = { prevFixture: existsSync(FIXTURE) ? readFileSync(FIXTURE, "utf8") : null };
            mkdirSync(new URL(".", FIXTURE), { recursive: true });
            writeFileSync(FIXTURE, JSON.stringify(ROSTERS["office-floors"](Date.now()), null, 2));
            ctx.prevView = await h.ev(`localStorage.getItem(${JSON.stringify(VIEW_KEY)})`);
            ctx.prevLayout = await h.ev(`localStorage.getItem(${JSON.stringify(LAYOUT_KEY)})`);
            ctx.prevAnimation = await h.ev(`localStorage.getItem(${JSON.stringify(ANIMATION_KEY)})`);
            await h.ev(`localStorage.setItem(${JSON.stringify(VIEW_KEY)}, JSON.stringify("office"))`);
            await h.ev(`localStorage.setItem(${JSON.stringify(LAYOUT_KEY)}, ${JSON.stringify(JSON.stringify(OFFICE_FLOORS_LAYOUT))})`);
            await h.ev(`localStorage.removeItem(${JSON.stringify(ANIMATION_KEY)})`);
            await h.ev(`localStorage.removeItem("cockpit.office.bigcard")`);
            ctx.missing = await reloadOffice(h, 1);
            if (!ctx.missing) ctx.box = await sizeOfficeBox(h, 1424, 800);
            return ctx;
        },
        async teardown(h, ctx) {
            const step = async (what, fn) => {
                try {
                    await fn();
                } catch (e) {
                    console.error(`cockpit-office-floors teardown: ${what} failed: ${e?.message ?? e}`);
                }
            };
            await step("clear the window size", () => h.cdp("Emulation.clearDeviceMetricsOverride", {}));
            await step("hand back the live Needs you rows", () => h.ev("window.__cockpitOfficeAttention?.(null)"));
            await step("clear the dev state", () => h.ev("window.__cockpitOffice?.(null)"));
            const put = (key, v) => (v == null ? `localStorage.removeItem(${JSON.stringify(key)})` : `localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(v)})`);
            await step("put back the view", () => h.ev(put(VIEW_KEY, ctx.prevView)));
            await step("put back the arrangement", () => h.ev(put(LAYOUT_KEY, ctx.prevLayout)));
            await step("put back the animation switch", () => h.ev(put(ANIMATION_KEY, ctx.prevAnimation)));
            await step("put back the roster", () => {
                if (ctx.prevFixture != null) writeFileSync(FIXTURE, ctx.prevFixture);
                else rmSync(FIXTURE, { force: true });
            });
            await step("reload without the fixture", async () => {
                await h.ev("location.reload()");
                await sleep(1500);
            });
        },
        async assert(h, ctx) {
            const steps = [];
            const rec = (step, ok, detail) => steps.push({ step, ok: !!ok, detail });
            if (ctx.missing) {
                rec("0. the office loads", false, ctx.missing);
                return steps;
            }
            rec("0. the window gives the Office a 1,424 x 800 box", Math.abs(ctx.box.w - 1424) <= 2 && Math.abs(ctx.box.h - 800) <= 2, JSON.stringify(ctx.box));
            // the boss's walk, a ride and the path hint are all over: the boss stands still on the floor shown
            const settle = async (ms = 15000) => {
                let q = await probe(h);
                for (let t = 0; t < ms; t += 100) {
                    if (q?.boss && !q.boss.moving && !q.riding && q.dots === 0) {
                        await sleep(150);
                        q = await probe(h);
                        if (q?.boss && !q.boss.moving && !q.riding && q.dots === 0) return q;
                    }
                    await sleep(100);
                    q = await probe(h);
                }
                return q;
            };
            const press = async (k, n = 1) => {
                for (let i = 0; i < n; i++) {
                    await focusCockpit(h);
                    await key(h, k);
                    await sleep(120);
                }
                return probe(h);
            };
            // polls an expression in the page for up to ms; true once it holds
            const until = async (expr, ms = 6000) => {
                for (let t = 0; t <= ms; t += 100) {
                    if (await h.ev(expr).catch(() => false)) return true;
                    await sleep(100);
                }
                return false;
            };
            const read = (sel) => h.ev(`document.querySelector(${JSON.stringify(sel)})?.textContent ?? ""`);
            // each room of the floor shown by slot: a project's name, or "·" for an empty one
            const names = (q) => (q?.rooms ?? []).map((r) => (r.kind === "agents" ? r.title : "·"));
            const room = (q, name) => q?.rooms?.find((r) => r.key === `room:${name}`);
            const clickFloor = (x, y) =>
                h.ev(`(() => {
                    const root = document.querySelector("[data-office-root]");
                    const r = root.getBoundingClientRect();
                    root.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: r.left + ${x}, clientY: r.top + ${y} }));
                })()`);
            // a desk's click walks the boss there and opens its box; Esc shuts the box and leaves the boss walking
            const clickDesk = async (id) => {
                await h.ev(`document.querySelector(${JSON.stringify(desk(id))})?.click()`);
                await settle();
                await press("Escape");
            };
            const deskOf = (name) => `fx-floors-${name}`;
            // a floor on show at once, the boss stood where it was
            const showFloor = async (f) => {
                await dev(h, { floor: f });
                await sleep(500);
                return probe(h);
            };
            // the arrangement back as the Main board has it, the page loaded again on floor 1
            const reseed = async () => {
                await h.ev(`localStorage.setItem(${JSON.stringify(LAYOUT_KEY)}, ${JSON.stringify(JSON.stringify(OFFICE_FLOORS_LAYOUT))})`);
                const missing = await reloadOffice(h, 1);
                const q = missing ? null : await settle();
                return missing ? { missing } : q;
            };
            const SLOT_NAMES = ["arcterm", "cuscofi-app", "mit-thesis", "cuscofi-production"];

            // 1. Main, floor 1: four rooms by slot; arcterm's holds 4 desks and 2 tables, its chip says what is left and asks
            let p = await settle();
            const chipDrawn = await read(`[data-office-chip="room:arcterm"]`);
            const arc1 = room(p, "arcterm");
            await h.shot("cdp-shots/cockpit-office-floors-1-floor.png");
            rec(
                "1. floor 1 draws its four rooms by slot; arcterm's has 4 desks, 2 tables and the chip `! +3 agents · +1 run`; the lift says ▲ 1 on 2",
                p?.floor === 1 &&
                    JSON.stringify(p.floors) === JSON.stringify(["G", "1", "2"]) &&
                    JSON.stringify(names(p)) === JSON.stringify(SLOT_NAMES) &&
                    arc1?.desks === 4 &&
                    arc1.tables === 2 &&
                    arc1.chip?.text === "+3 agents · +1 run" &&
                    arc1.chip.ask === true &&
                    chipDrawn.replace(/\s+/g, " ").trim() === "! +3 agents · +1 run" &&
                    JSON.stringify(p.liftAsks) === JSON.stringify(["▲ 1 on 2"]),
                JSON.stringify({ floor: p?.floor, floors: p?.floors, names: names(p), arcterm: arc1 && { desks: arc1.desks, tables: arc1.tables, chip: arc1.chip?.text, ask: arc1.chip?.ask }, chipDrawn, liftAsks: p?.liftAsks })
            );

            // 1b. G draws the brick facade with the glass doors, the sign and the needle leftmost; a floor above it
            // draws a plain wall with windows in that strip (hashed off the scenery canvas), and no entrance
            const footHash = () =>
                h.ev(`(() => {
                    const c = document.querySelector('[data-office-canvas="under"]');
                    const root = document.querySelector("[data-office-root]");
                    const k = c.height / root.offsetHeight;
                    const y0 = Math.floor((root.offsetHeight - 40) * k);
                    const px = c.getContext("2d").getImageData(0, y0, c.width, c.height - y0).data;
                    let hash = 0;
                    for (let i = 0; i < px.length; i += 4) hash = (hash * 31 + px[i] + 7 * px[i + 1] + 13 * px[i + 2]) | 0;
                    return hash;
                })()`);
            const foot1 = await footHash();
            const ground = await showFloor(0);
            const footG = await footHash();
            await h.shot("cdp-shots/cockpit-office-floors-1b-ground.png");
            rec(
                "1b. Ground draws four rooms and a foot strip of its own (the brick facade, the glass doors, the sign); the lift says ▲ 4 on 1 and ▲ 1 on 2",
                ground?.floor === 0 &&
                    JSON.stringify(names(ground)) === JSON.stringify(["Home", "portfolio-journal", "vnstock-js", "vnstock-js-docs"]) &&
                    JSON.stringify(ground.liftAsks) === JSON.stringify(["▲ 1 on 2", "▲ 4 on 1"]) &&
                    foot1 !== footG,
                JSON.stringify({ floor: ground?.floor, names: names(ground), liftAsks: ground?.liftAsks, foot: [foot1, footG] })
            );
            await showFloor(1);
            await settle();

            // 2. the boss at the lift's doors: ↵ opens the lift's panel, a button per floor, ▶ on Floor 2
            const lift = p?.lift;
            await clickFloor(lift.spot.x, lift.spot.y);
            p = await settle();
            const atLift = !!p?.boss && Math.abs(p.boss.x - lift.spot.x) <= 3 && Math.abs(p.boss.y - lift.spot.y) <= 3;
            p = await press("Enter");
            const row = (f) => h.ev(`(() => {
                const b = document.querySelector('[data-office-lift-panel] [data-office-floor="${f}"]');
                return b ? { text: b.textContent.replace(/\\s+/g, " ").trim(), arrow: b.getAttribute("aria-current") === "true", disabled: b.getAttribute("aria-disabled") === "true", asks: b.querySelector("[data-office-floor-asks]")?.textContent.trim() ?? null } : null;
            })()`);
            const rows = { 2: await row(2), 1: await row(1), 0: await row(0) };
            await h.shot("cdp-shots/cockpit-office-floors-2-lift.png");
            rec(
                "2. at the lift ↵ opens its panel: Floor 2, Floor 1 (the one shown), Ground, `! 1` on Floor 2, the ▶ on Floor 2",
                atLift &&
                    p?.dialog === "lift" &&
                    JSON.stringify(p.items) === JSON.stringify(["Floor 2", "Floor 1", "Ground"]) &&
                    p.sel === 0 &&
                    rows[2]?.asks === "! 1" &&
                    rows[2].arrow &&
                    rows[1]?.disabled &&
                    rows[0]?.asks == null,
                JSON.stringify({ atLift, dialog: p?.dialog, items: p?.items, sel: p?.sel, rows })
            );

            // 3. ↵ rides to Floor 2: the doors shut over the office with the dial on Floor 2 (held for the shot), then
            // open on a floor with chotkeo's room and three empty ones
            await dev(h, { rideHold: true });
            await press("Enter");
            const shut = await until(`!!document.querySelector("[data-office-ride-shut]") && document.querySelector("[data-office-ride-label]")?.textContent.trim() === "Floor 2"`, 8000);
            const riding = await probe(h);
            await sleep(300);
            await h.shot("cdp-shots/cockpit-office-floors-3-ride.png");
            await dev(h, { rideHold: false });
            await until(`!document.querySelector("[data-office-ride]")`, 6000);
            p = await settle();
            rec(
                "3. ↵ on Floor 2 rides: the doors shut with the dial on Floor 2, then open on chotkeo's room and three empty ones",
                shut &&
                    riding?.riding === true &&
                    p?.floor === 2 &&
                    p.riding === false &&
                    JSON.stringify(names(p)) === JSON.stringify(["chotkeo", "·", "·", "·"]) &&
                    JSON.stringify(p.rooms.map((r) => r.kind)) === JSON.stringify(["agents", "empty", "empty", "empty"]),
                JSON.stringify({ shut, riding: riding?.riding, floor: p?.floor, names: names(p), kinds: p?.rooms?.map((r) => r.kind) })
            );

            // 4. PageDown and PageUp ride a floor at a time; n to an ask on another floor rides there and walks to it
            const f4 = [];
            for (const k of ["PageDown", "PageUp", "PageDown"]) {
                await press(k);
                f4.push((await settle())?.floor);
            }
            const trail = [];
            p = await probe(h);
            for (let i = 0; i < 8 && !(p?.floor === 2 && p.cursor === deskOf("chotkeo-deal-scraper")); i++) {
                await press("n");
                p = await settle(20000);
                trail.push(`${p?.floor}:${p?.cursor}`);
            }
            rec(
                "4. PageDown, PageUp, PageDown ride 1, 2, 1; n until the ask on floor 2 rides there and walks to chotkeo's asking agent",
                JSON.stringify(f4) === JSON.stringify([1, 2, 1]) && p?.floor === 2 && p.cursor === deskOf("chotkeo-deal-scraper"),
                JSON.stringify({ f4, floor: p?.floor, cursor: p?.cursor, trail })
            );

            // 5. g in arcterm's room picks it up, ↓ aims it at the slot below (mit-thesis's: a swap), ↵ puts it down there
            await press("PageDown");
            p = await settle();
            await clickDesk(deskOf("arcterm-canvas-gallery"));
            p = await press("g");
            await press("ArrowDown");
            p = await probe(h);
            const card5 = {
                head: await read("[data-office-carry-head]"),
                line: await read("[data-office-carry-line]"),
                origin: await h.ev(`document.querySelector("[data-office-carry-origin]")?.dataset.officeCarryOrigin ?? null`),
                target: await h.ev(`document.querySelector("[data-office-carry-target]")?.dataset.officeCarryTarget ?? null`),
            };
            await h.shot("cdp-shots/cockpit-office-floors-5-carry.png");
            const aimed = p?.carry;
            const layer5 = p?.layer;
            p = await press("Enter");
            p = await settle();
            rec(
                "5. g in arcterm's room, ↓: the card says Swap with mit-thesis, the target is slot 2; ↵ swaps: mit-thesis in slot 0, arcterm in slot 2",
                p?.floor === 1 &&
                    layer5 === "carry" &&
                    aimed?.project === "arcterm" &&
                    aimed.by === "key" &&
                    JSON.stringify(aimed.target) === JSON.stringify({ floor: 1, slot: 2 }) &&
                    card5.head === "Moving arcterm" &&
                    card5.line === "Swap with mit-thesis" &&
                    card5.origin === "room:arcterm" &&
                    card5.target === "room:mit-thesis" &&
                    p.carry == null &&
                    JSON.stringify(names(p)) === JSON.stringify(["mit-thesis", "cuscofi-app", "arcterm", "cuscofi-production"]),
                JSON.stringify({ layer: layer5, aimed, card: card5, names: names(p), carry: p?.carry })
            );

            // 6. the arrangement is kept per viewer: after a reload the swap is still there
            const missing6 = await reloadOffice(h, 1);
            p = missing6 ? null : await settle();
            const box6 = await readBox(h);
            rec(
                "6. after a reload the swap is still there (saved in localStorage under cockpit.office.layout)",
                !missing6 &&
                    p?.floor === 1 &&
                    JSON.stringify(names(p)) === JSON.stringify(["mit-thesis", "cuscofi-app", "arcterm", "cuscofi-production"]) &&
                    Math.abs(box6.w - 1424) <= 2 &&
                    Math.abs(box6.h - 800) <= 2,
                JSON.stringify({ missing6, floor: p?.floor, names: names(p), box: box6 })
            );

            // 7. By pointer: a press on mit-thesis's title, moved past 4 px to the middle of slot 2 (arcterm's), picks the
            // room up; the card follows the pointer and says what a drop does; let go, they swap back
            const centre = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
            const drag = async (title, to, hold) => {
                const a = centre(title);
                await mouse(h, "mouseMoved", a.x, a.y);
                await mouse(h, "mousePressed", a.x, a.y);
                for (let i = 1; i <= 8; i++) {
                    await mouse(h, "mouseMoved", a.x + ((to.x - a.x) * i) / 8, a.y + ((to.y - a.y) * i) / 8);
                    await sleep(40);
                }
                await sleep(250);
                await hold?.();
                await mouse(h, "mouseReleased", to.x, to.y);
            };
            p = await probe(h);
            const mit = room(p, "mit-thesis");
            const slot2 = p.rooms.find((r) => r.slot === 2);
            let mid7 = null;
            await drag(mit.titleBox, centre(slot2.box), async () => {
                mid7 = {
                    ...(await probe(h)),
                    head: await read("[data-office-carry-head]"),
                    line: await read("[data-office-carry-line]"),
                    by: await h.ev(`document.querySelector("[data-office-carry-card]")?.dataset.officeCarryCard ?? null`),
                    panel: await h.ev(`!!document.querySelector("[data-office-carry-panel] [data-office-floor]")`),
                };
                await h.shot("cdp-shots/cockpit-office-floors-7-drag.png");
            });
            await sleep(300);
            p = await settle();
            rec(
                "7. by pointer: a press on mit-thesis's title moved to slot 2 picks it up (the card says Drop to swap with arcterm, the lift's map open); let go, arcterm is back in slot 0 and mit-thesis in slot 2",
                mid7?.layer === "carry" &&
                    mid7.carry?.project === "mit-thesis" &&
                    mid7.carry.by === "pointer" &&
                    JSON.stringify(mid7.carry.target) === JSON.stringify({ floor: 1, slot: 2 }) &&
                    mid7.by === "pointer" &&
                    mid7.line === "Drop to swap with arcterm" &&
                    mid7.panel &&
                    p?.carry == null &&
                    JSON.stringify(names(p)) === JSON.stringify(SLOT_NAMES),
                JSON.stringify({ layer: mid7?.layer, carry: mid7?.carry, by: mid7?.by, head: mid7?.head, line: mid7?.line, panel: mid7?.panel, after: names(p), carry2: p?.carry })
            );

            // the lift's map while a room is carried: the row of a floor, and whether it says it is full
            const mapRow = (f) =>
                h.ev(`(() => {
                    const b = document.querySelector('[data-office-carry-panel] [data-office-floor="${f}"]');
                    return b ? { text: b.textContent.replace(/\\s+/g, " ").trim(), arrow: b.getAttribute("aria-current") === "true", full: b.hasAttribute("data-office-floor-full"), dim: b.getAttribute("aria-disabled") === "true" } : null;
                })()`);

            // 7b. carrying across floors by keys: PageUp rides with the room and the lift's map opens; PageUp past the top
            // aims it at + New floor; Esc rides back and puts it where it was
            await clickDesk(deskOf("arcterm-canvas-gallery"));
            await press("g");
            await press("PageUp");
            await until(`window.__cockpitOfficeProbe().floor === 2 && !window.__cockpitOfficeProbe().riding`, 8000);
            const up1 = await settle();
            const map1 = { 2: await mapRow(2), 1: await mapRow(1), new: await mapRow("new") };
            await press("PageUp");
            await sleep(300);
            const up2 = await probe(h);
            const newLine = await read("[data-office-carry-line]");
            const mapNew = await mapRow("new");
            await h.shot("cdp-shots/cockpit-office-floors-7b-new-floor.png");
            await press("Escape");
            await until(`window.__cockpitOfficeProbe().floor === 1 && !window.__cockpitOfficeProbe().riding`, 8000);
            p = await settle();
            rec(
                "7b. g, PageUp rides to floor 2 with the room, the lift's map open on it; PageUp again aims it at + New floor; Esc rides back and puts it where it was",
                up1?.floor === 2 &&
                    up1.carry?.project === "arcterm" &&
                    up1.carry.target?.floor === 2 &&
                    up1.layer === "carry" &&
                    map1[2]?.arrow &&
                    map1.new != null &&
                    up2?.floor === 2 &&
                    up2.carry?.target === "new" &&
                    newLine === "Put it on a new floor" &&
                    mapNew?.arrow &&
                    p?.floor === 1 &&
                    p.carry == null &&
                    p.layer === "walk" &&
                    JSON.stringify(names(p)) === JSON.stringify(SLOT_NAMES),
                JSON.stringify({ up1: [up1?.floor, up1?.carry, up1?.layer], map1, up2: [up2?.floor, up2?.carry], newLine, mapNew, back: [p?.floor, p?.carry, p?.layer, names(p)] })
            );

            // 7c. G holds four rooms: carried there by PageDown its row says Floor full and the target stays on G's
            // slots, so ↵ swaps with the room in the slot, which goes up to arcterm's place
            await press("g");
            await press("PageDown");
            await until(`window.__cockpitOfficeProbe().floor === 0 && !window.__cockpitOfficeProbe().riding`, 8000);
            const down = await settle();
            const rowG = await mapRow(0);
            const swapWith = down?.rooms?.find((r) => r.slot === down.carry?.target?.slot)?.title;
            const lineG = await read("[data-office-carry-line]");
            await h.shot("cdp-shots/cockpit-office-floors-7c-full.png");
            await press("Enter");
            const landed = await settle();
            const onG = names(landed);
            const above = await showFloor(1);
            rec(
                "7c. carried down to G, the room's row says Floor full and the target stays on G's four slots; ↵ swaps with the room there, which goes to floor 1",
                down?.floor === 0 &&
                    down.carry?.target?.floor === 0 &&
                    rowG?.full &&
                    rowG.text.includes("Floor full") &&
                    swapWith != null &&
                    lineG === `Swap with ${swapWith}` &&
                    landed?.carry == null &&
                    landed.floor === 0 &&
                    onG[down.carry.target.slot] === "arcterm" &&
                    names(above)[0] === swapWith,
                JSON.stringify({ floor: down?.floor, target: down?.carry?.target, rowG, swapWith, lineG, onG, floor1: names(above) })
            );
            p = await reseed();
            rec("7c'. the arrangement put back: floor 1 holds arcterm, cuscofi-app, mit-thesis, cuscofi-production", p?.floor === 1 && JSON.stringify(names(p)) === JSON.stringify(SLOT_NAMES), JSON.stringify({ floor: p?.floor, names: names(p) }));

            // 7d. by mouse across floors: a drag of arcterm's title opens the lift's map; a drop on Floor 2's button puts it
            // in that floor's first empty slot; a drop on a full floor's button does nothing
            const pageBox = (sel) =>
                h.ev(`(() => {
                    const r = document.querySelector(${JSON.stringify(sel)})?.getBoundingClientRect();
                    return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
                })()`);
            const dragToButton = async (floor, hold) => {
                p = await probe(h);
                const t = centre(room(p, "arcterm").titleBox);
                const from = await pagePoint(h, t.x, t.y);
                await mousePage(h, "mouseMoved", from.x, from.y);
                await mousePage(h, "mousePressed", from.x, from.y);
                await mousePage(h, "mouseMoved", from.x + 30, from.y + 20);
                await until(`!!document.querySelector('[data-office-carry-panel] [data-office-floor="${floor}"]')`, 4000);
                const to = await pageBox(`[data-office-carry-panel] [data-office-floor="${floor}"]`);
                for (let i = 1; i <= 8; i++) {
                    await mousePage(h, "mouseMoved", from.x + 30 + ((to.x - from.x - 30) * i) / 8, from.y + 20 + ((to.y - from.y - 20) * i) / 8);
                    await sleep(40);
                }
                await sleep(250);
                await hold?.();
                await mousePage(h, "mouseReleased", to.x, to.y);
                await sleep(400);
            };
            let hover2 = null;
            await dragToButton(2, async () => {
                hover2 = { ...(await probe(h)), line: await read("[data-office-carry-line]") };
                await h.shot("cdp-shots/cockpit-office-floors-7d-floor-button.png");
            });
            p = await settle();
            rec(
                "7d. by mouse: dragged over Floor 2's button, the card says Drop to move it to Floor 2; dropped, arcterm is in floor 2's first empty slot",
                hover2?.carry?.by === "pointer" &&
                    JSON.stringify(hover2.carry.target) === JSON.stringify({ floor: 2, slot: 1 }) &&
                    hover2.line === "Drop to move it to Floor 2" &&
                    p?.floor === 2 &&
                    p.carry == null &&
                    JSON.stringify(names(p)) === JSON.stringify(["chotkeo", "arcterm", "·", "·"]),
                JSON.stringify({ hover: hover2?.carry, line: hover2?.line, floor: p?.floor, names: names(p) })
            );
            p = await reseed();
            let hoverG = null;
            await dragToButton(0, async () => {
                hoverG = { ...(await probe(h)), line: await read("[data-office-carry-line]"), row: await mapRow(0) };
            });
            p = await settle();
            rec(
                "7d'. a drop on the full Ground floor's button does nothing: no target while over it, and the room stays where it was",
                hoverG?.carry?.by === "pointer" &&
                    hoverG.carry.target === null &&
                    hoverG.row?.full === true &&
                    p?.floor === 1 &&
                    p.carry == null &&
                    JSON.stringify(names(p)) === JSON.stringify(SLOT_NAMES),
                JSON.stringify({ hover: hoverG?.carry, row: hoverG?.row, line: hoverG?.line, floor: p?.floor, carry: p?.carry, names: names(p) })
            );

            // 8. m → Arrange automatically puts the rooms in name order from G, Home first (it stays on the floor shown)
            p = await press("m");
            const menu8 = p?.menuItems ?? [];
            const want8 = menu8.indexOf("Arrange automatically");
            for (let i = 0; i < 12 && p?.menuSel !== want8 && want8 >= 0; i++) p = await press("ArrowDown");
            const sel8 = p?.menuSel;
            await press("Enter");
            await sleep(600);
            const by = {};
            for (const f of [0, 1, 2]) by[f] = names(await showFloor(f));
            rec(
                "8. m → Arrange automatically puts the rooms in name order from G: Home, arcterm, chotkeo, cuscofi-app; cuscofi-production, mit-thesis, portfolio-journal, vnstock-js; vnstock-js-docs",
                menu8.includes("Lift") &&
                    menu8.includes("Move this room") &&
                    sel8 === want8 &&
                    JSON.stringify(by[0]) === JSON.stringify(["Home", "arcterm", "chotkeo", "cuscofi-app"]) &&
                    JSON.stringify(by[1]) === JSON.stringify(["cuscofi-production", "mit-thesis", "portfolio-journal", "vnstock-js"]) &&
                    JSON.stringify(by[2]) === JSON.stringify(["vnstock-js-docs", "·", "·", "·"]),
                JSON.stringify({ menu: menu8, sel: sel8, by })
            );
            p = await reseed();

            // 9. Esc after g puts the room back: g in arcterm's room, →, Esc
            await clickDesk(deskOf("arcterm-canvas-gallery"));
            await press("g");
            p = await press("ArrowRight");
            const aimed9 = p?.carry;
            p = await press("Escape");
            await sleep(200);
            p = await settle();
            rec(
                "9. g in arcterm's room, →, Esc: the room is back where it was, nothing is carried",
                JSON.stringify(aimed9?.target) === JSON.stringify({ floor: 1, slot: 1 }) &&
                    p?.carry == null &&
                    p.layer === "walk" &&
                    JSON.stringify(names(p)) === JSON.stringify(SLOT_NAMES),
                JSON.stringify({ aimed: aimed9, carry: p?.carry, layer: p?.layer, names: names(p) })
            );

            // 10. The full room: arcterm's 4 desks, 2 tables with their screens and the chip; mit-thesis, with no run, has
            // no table and a plant in the strip's left (plus the top-right one while its first desk row has a place free)
            // the boss waits in the hall, off the desks and their ↵ prompt
            p = await probe(h);
            await clickFloor(p.hall.x + p.hall.w / 2, p.hall.y + 330);
            p = await settle();
            const arc10 = room(p, "arcterm");
            const mit10 = room(p, "mit-thesis");
            await clipShot(h, "cockpit-office-floors-10-room", arc10.box);
            const inRoom = await h.ev(`(() => {
                const root = document.querySelector("[data-office-root]").getBoundingClientRect();
                const b = ${JSON.stringify(arc10.box)};
                const inside = (el) => {
                    const r = el.getBoundingClientRect();
                    const x = r.left - root.left + r.width / 2;
                    const y = r.top - root.top + r.height / 2;
                    return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
                };
                return {
                    tables: [...document.querySelectorAll('[data-office-room^="meet:"]')].filter(inside).length,
                    captions: [...document.querySelectorAll("[data-office-table-caption]")].filter(inside).map((e) => e.textContent.trim()),
                    desks: [...document.querySelectorAll("[data-office-desk]")].filter(inside).length,
                };
            })()`);
            // a plant stands in the strip when its y is inside the room's bottom MEET_H (124) px
            const MEET_H = 124;
            const stripPlants = (r) => (r?.plants ?? []).filter((q) => q.y >= r.box.y + r.box.h - MEET_H && q.y < r.box.y + r.box.h);
            rec(
                "10. arcterm's room holds 4 desks, 2 tables with their captions and the chip; mit-thesis's, with no run, has no table and a plant in its strip",
                arc10?.desks === 4 &&
                    arc10.tables === 2 &&
                    arc10.chip?.text === "+3 agents · +1 run" &&
                    inRoom.desks === 4 &&
                    inRoom.tables === 2 &&
                    JSON.stringify(inRoom.captions) === JSON.stringify(["Land queue · 2 of 7", "Canvas gallery · 1 of 3"]) &&
                    mit10?.tables === 0 &&
                    mit10.plant === true &&
                    stripPlants(mit10).length === 1 &&
                    stripPlants(arc10).length === 0 &&
                    mit10.desks === 1,
                JSON.stringify({ arcterm: { desks: arc10?.desks, tables: arc10?.tables, chip: arc10?.chip?.text, plants: arc10?.plants }, inRoom, mit: { tables: mit10?.tables, plant: mit10?.plant, plants: mit10?.plants, box: mit10?.box, desks: mit10?.desks } })
            );

            // 11. The chip: n stops at it (it asks), ↵ lists what has no desk or table, the asking one first; a click on the
            // chip walks the boss to it and opens the same box; ↵ on its first row opens that agent's card beside the chip
            const chipKey = "chip:room:arcterm";
            p = await probe(h);
            for (let i = 0; i < 8 && p?.cursor !== chipKey; i++) {
                await press("n");
                p = await settle(20000);
            }
            const atChip = p?.cursor === chipKey;
            p = await press("Enter");
            const list = {
                dialog: p?.dialog,
                items: p?.items,
                words: await h.ev(`[...document.querySelectorAll('[data-office-dialog="chip"] [data-office-hidden-word]')].map((e) => e.textContent.trim())`),
            };
            await h.shot("cdp-shots/cockpit-office-floors-11-chip.png");
            await press("Escape");
            // walked off, the chip is clicked with the mouse
            await clickDesk(deskOf("arcterm-canvas-gallery"));
            const chipBox = room(await probe(h), "arcterm").chip.box;
            await mouse(h, "mousePressed", chipBox.x + chipBox.w / 2, chipBox.y + chipBox.h / 2);
            await mouse(h, "mouseReleased", chipBox.x + chipBox.w / 2, chipBox.y + chipBox.h / 2);
            p = await settle();
            const byClick = { cursor: p?.cursor, dialog: p?.dialog, items: p?.items };
            p = await press("Enter");
            await sleep(300);
            const card11 = await read(`[data-office-popup="agent"]`);
            await h.shot("cdp-shots/cockpit-office-floors-11b-chip-card.png");
            const opened = { popup: p?.popup, layer: p?.layer, named: card11.includes("Tray popover") };
            await press("Escape", 2);
            rec(
                "11. n stops at arcterm's chip; ↵ lists the hidden agents and the run, the asking one first; a click on the chip opens the same box; ↵ on its first row opens that agent's card beside the chip",
                atChip &&
                    list.dialog === "chip" &&
                    JSON.stringify(list.items) === JSON.stringify(["Tray popover", "Sleepwatch", "Worktree cleanup", "Tray popover"]) &&
                    JSON.stringify(list.words) === JSON.stringify(["Needs you", "done", "idle", "done"]) &&
                    byClick.cursor === chipKey &&
                    byClick.dialog === "chip" &&
                    JSON.stringify(byClick.items) === JSON.stringify(list.items) &&
                    opened.popup === "agent" &&
                    opened.layer === "card" &&
                    opened.named,
                JSON.stringify({ atChip, list, byClick, opened })
            );

            // 12. The notice board on floor 2 (NoticeBoard): the Needs you rows of floor 1's two asking agents are on the
            // board of every floor; a click on the lift's doors walks the boss to them and opens the lift's panel
            const since = Date.now() - 12 * 60_000;
            const askRows = ["Changelog pass", "Tray popover"].map((n, i) => ({
                kind: "learn-proposal",
                key: `learn:fx-floors-${i}`,
                learnid: `skill:fx-floors#${i}`,
                source: `arcterm · ${n}`,
                text: `${n} is waiting for you.`,
                why: `“${n} asked”`,
                action: "Accept",
                phaseidx: 0,
                waitingsince: since,
            }));
            await h.ev(`window.__cockpitOfficeAttention(${JSON.stringify(askRows)})`);
            await until(`document.querySelectorAll("[data-office-board] [data-office-board-slip]").length === 2`);
            p = await probe(h);
            const on1 = { count: p?.board?.count, floor: p?.floor };
            await press("PageUp");
            await until(`window.__cockpitOfficeProbe().floor === 2 && !window.__cockpitOfficeProbe().riding`, 8000);
            p = await settle();
            const boardBox = await h.ev(`(() => {
                const root = document.querySelector("[data-office-root]").getBoundingClientRect();
                const r = document.querySelector("[data-office-board]").getBoundingClientRect();
                return { x: Math.round(r.left - root.left), y: Math.round(r.top - root.top), w: Math.round(r.width), h: Math.round(r.height) };
            })()`);
            await clipShot(h, "cockpit-office-floors-12-board", boardBox, 12);
            const on2 = {
                count: p?.board?.count,
                floor: p?.floor,
                slips: await h.ev(`document.querySelectorAll("[data-office-board] [data-office-board-slip]").length`),
                number: await read("[data-office-board-count]"),
            };
            const doors = await pageBox("[data-office-lift]");
            await mousePage(h, "mouseMoved", doors.x, doors.y);
            await mousePage(h, "mousePressed", doors.x, doors.y);
            await mousePage(h, "mouseReleased", doors.x, doors.y);
            p = await settle();
            const atSpot = !!p?.boss && Math.abs(p.boss.x - p.lift.spot.x) <= 3 && Math.abs(p.boss.y - p.lift.spot.y) <= 3;
            await h.shot("cdp-shots/cockpit-office-floors-12b-lift-doors.png");
            rec(
                "12. the board on floor 2 lists the two rows of floor 1's asking agents, as floor 1's does; a click on the lift's doors walks the boss to them and opens the lift's panel",
                on1.count === 2 &&
                    on2.floor === 2 &&
                    on2.count === 2 &&
                    on2.slips === 2 &&
                    on2.number === "2" &&
                    atSpot &&
                    p?.dialog === "lift" &&
                    JSON.stringify(p.items) === JSON.stringify(["Floor 2", "Floor 1", "Ground"]),
                JSON.stringify({ on1, on2, atSpot, dialog: p?.dialog, items: p?.items })
            );
            await press("Escape");
            await h.ev(`window.__cockpitOfficeAttention(null)`);
            await sleep(300);

            // 13. Capacity: what a room holds follows the Office's size, never which floor or slot it is on. Back on floor 1
            await showFloor(1);
            const hands = async (w, hgt, runs) => {
                const box = await sizeOfficeBox(h, w, hgt);
                if (runs) await dev(h, { runs });
                await sleep(500);
                const q = await settle();
                const arc = room(q, "arcterm");
                return { box, q, arc };
            };
            const small = await hands(1050, 650);
            await clipShot(h, "cockpit-office-floors-13a-1050x650", small.arc.box);
            rec(
                "13a. at 1,050 x 650 arcterm's room holds 3 desks and 2 tables; the chip says +4 agents · +1 run",
                Math.abs(small.box.w - 1050) <= 2 &&
                    Math.abs(small.box.h - 650) <= 2 &&
                    small.q?.floor === 1 &&
                    small.arc?.desks === 3 &&
                    small.arc.tables === 2 &&
                    small.arc.chip?.text === "+4 agents · +1 run" &&
                    JSON.stringify(names(small.q)) === JSON.stringify(SLOT_NAMES),
                JSON.stringify({ box: small.box, floor: small.q?.floor, room: small.arc && { w: small.arc.box.w, h: small.arc.box.h, desks: small.arc.desks, tables: small.arc.tables, chip: small.arc.chip?.text } })
            );
            const big = await hands(1600, 1000, [...OFFICE_FLOORS_RUNS, OFFICE_FLOORS_FOURTH_RUN]);
            await clipShot(h, "cockpit-office-floors-13b-1600x1000", big.arc.box);
            rec(
                "13b. at 1,600 x 1,000, with a fourth run at work, arcterm's room seats all 7 agents at 7 desks and draws 3 tables; the done run is the chip's: +1 run",
                Math.abs(big.box.w - 1600) <= 2 &&
                    Math.abs(big.box.h - 1000) <= 2 &&
                    big.arc?.desks === 7 &&
                    big.arc.tables === 3 &&
                    big.arc.chip?.text === "+1 run" &&
                    big.arc.chip.ask === false,
                JSON.stringify({ box: big.box, room: big.arc && { w: big.arc.box.w, h: big.arc.box.h, desks: big.arc.desks, tables: big.arc.tables, chip: big.arc.chip } })
            );

            return steps;
        },
    };

    // the Office hides the Backgrounded section and the background-agents strip, which no room draws, until the office
    // menu's Background shows them (cockpit office spec, "The office fills the Cockpit"): the floors roster with one agent
    // moved to the background and two detached `claude --bg` sessions
    const BG_BACKGROUNDED = "fx-floors-arcterm-land-queue-review";
    const BG_SESSIONS = [
        { sessionid: "fx-bg-nightly-deps", cwd: "D:\\fx\\arcterm", kind: "background", name: "Nightly dependency bump", state: "working", startedts: 0 },
        { sessionid: "fx-bg-flaky-tests", cwd: "D:\\fx\\arcterm", kind: "background", name: "Hunt the flaky orchestrate test", state: "blocked", startedts: 0 },
    ];
    const cockpitOfficeBackground = {
        name: "cockpit-office-background",
        surface: "cockpit",
        async arrange(h) {
            const ctx = await cockpitOfficeFloors.arrange(h);
            if (!ctx.missing) {
                const now = Date.now();
                const sessions = BG_SESSIONS.map((s, i) => ({ ...s, startedts: now - (i + 1) * 47 * 60_000 }));
                await h.ev(`window.__cockpitOfficeBackground(${JSON.stringify({ sessions, backgrounded: [BG_BACKGROUNDED] })})`);
                await h.ev(`localStorage.removeItem("cockpit.office.animation")`);
            }
            return ctx;
        },
        async teardown(h, ctx) {
            try {
                await h.ev("window.__cockpitOfficeBackground?.(null)");
            } catch (e) {
                console.error(`cockpit-office-background teardown: clear the background failed: ${e?.message ?? e}`);
            }
            await cockpitOfficeFloors.teardown(h, ctx);
        },
        async assert(h, ctx) {
            const steps = [];
            const rec = (step, ok, detail) => steps.push({ step, ok: !!ok, detail });
            if (ctx.missing) {
                rec("0. the office loads", false, ctx.missing);
                return steps;
            }
            const press = async (k, n = 1) => {
                for (let i = 0; i < n; i++) {
                    await focusCockpit(h);
                    await key(h, k);
                    await sleep(150);
                }
                return probe(h);
            };
            const lists = () =>
                h.ev(`({
                    backgrounded: !!document.querySelector("[data-cockpit-backgrounded]"),
                    sessions: !!document.querySelector("[data-cockpit-background-agents]"),
                })`);
            await settleBoss(h, 15000);

            // 1. the office opens with neither list under the building
            const hidden = await lists();
            await h.shot("cdp-shots/cockpit-office-background-hidden.png");
            rec("1. Office opens with no Backgrounded section and no Background strip under the building", !hidden.backgrounded && !hidden.sessions, JSON.stringify(hidden));

            // 2. m lists Background after Events with the three agents no room draws
            const menu = await press("m");
            const at = menu?.menuItems?.indexOf("Background") ?? -1;
            await h.shot("cdp-shots/cockpit-office-background-menu.png");
            rec(
                "2. m lists Background right after Events, its count 3 (one backgrounded agent, two detached sessions)",
                at > 0 && menu.menuItems[at - 1] === "Events" && (await h.ev(`/Background\\s*3/.test(document.querySelector("[data-office-menu]")?.textContent ?? "")`)),
                JSON.stringify({ items: menu?.menuItems })
            );

            // 3. ↵ on Background shows both lists under the office and shuts the menu
            await press("ArrowDown", at - (menu?.menuSel ?? 0));
            const shut = await press("Enter");
            await sleep(400);
            // open the strip's fold so the shot shows the sessions themselves
            await h.ev(`document.querySelector("[data-cockpit-background-agents] button")?.click()`);
            await sleep(400);
            const shown = await lists();
            await h.shot("cdp-shots/cockpit-office-background-shown.png");
            rec("3. ↵ on Background shuts the menu and shows the Backgrounded section and the Background strip", shut?.menu === false && shown.backgrounded && shown.sessions, JSON.stringify({ menu: shut?.menu, ...shown }));

            // 4. the menu now names it Hide background, which hides both again
            const again = await press("m");
            const hideAt = again?.menuItems?.indexOf("Hide background") ?? -1;
            await press("ArrowDown", hideAt - (again?.menuSel ?? 0));
            await press("Enter");
            await sleep(400);
            const back = await lists();
            rec("4. the menu names it Hide background, and ↵ hides both lists again", hideAt > 0 && !back.backgrounded && !back.sessions, JSON.stringify({ hideAt, ...back }));

            // 5. Cards still shows both
            await toggleTo(h, "Cards");
            await sleep(600);
            const cards = await lists();
            await toggleTo(h, "Office");
            rec("5. Cards still shows the Backgrounded section and the Background strip", cards.backgrounded && cards.sessions, JSON.stringify(cards));
            return steps;
        },
    };

    return { cockpitOffice, cockpitOfficePet, cockpitOfficeControls, cockpitOfficeNeedsYouBoard, cockpitOfficeBench, cockpitOfficeSound, cockpitOfficeFloors, cockpitOfficeBackground };
}
