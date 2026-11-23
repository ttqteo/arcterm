// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// council-figures, council-figures-graph and council-bench-chart (docs/superpowers/plans/2026-11-19-council-figures.md,
// Task 8): the six figures a council draws from what it recorded, as placed in the app. The hooks are called by
// councilscenarios.mjs as arrange(h, fx), assert(h, ctx, fx), teardown(h, ctx, fx).
//
//   council-figures        the Report of the `figures` fixture (a finished Review: five seats' stats, a timeline of timed
//                          steps, three directions): To do, then About the council opened on At a glance (the evidence × agreement quadrant and the stance grid),
//                          then, through its jump link, What it spent (each seat's tokens, and when each worked and what it
//                          read twice), the hovers and clicks of each, the Table views and the narrow pane
//   council-figures-graph  the Map of the same council: the Matrix | Graph switch, the argument map, the hover that dims
//                          every edge but an idea's, and the click that comes back to the matrix with that row open
//   council-bench-chart    Library → Councils: the folded Benchmark section over the list, opened (and kept open across a
//                          reload), a point's tooltip and the Table view
//
// Nothing here calls a model or spends a token. The councils are written into the data dir (fixtures.mjs `seedCouncil`),
// and the benchmark's rows are the page's stand-in for CouncilBenchResultsCommand (`stubRpc`), so no council-bench.jsonl is
// read. Clock text in a tooltip is local time and is never asserted; what is asserted are the words and counts the model
// computes (councilfiguresmodel.ts). The pictures: `council-figures` writes the What's new one
// (public/whatsnew/<next minor>-council-figures.webp, `h.whatsnewShot`), and its shots are the Prototype's boards (Main,
// Glance-narrow, Spend and Lanes), `council-figures-graph`'s is Graph and `council-bench-chart`'s is Bench.

import { waitFor } from "../attach.mjs";
import {
    announceCouncil,
    arrangeCouncilProject,
    openCouncil,
    seedCouncil,
    stubRpc,
    teardownCouncilProject,
    unstubRpc,
    writeCouncil,
} from "./fixtures.mjs";

const WAIT_MS = 10_000;
const SUMMARY = "[data-council-summary]";
const MAP = "[data-council-map]";
const BENCH_OPEN_KEY = "council.benchOpen";

const q = (s) => JSON.stringify(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = (h, expr, ms = WAIT_MS) => waitFor((e) => h.ev(e), expr, ms);
const exists = (h, sel) => h.ev(`!!document.querySelector(${q(sel)})`);
const count = (h, sel) => h.ev(`document.querySelectorAll(${q(sel)}).length`);
const textOf = (h, sel) => h.ev(`document.querySelector(${q(sel)})?.innerText?.replace(/\\s+/g, " ").trim() ?? null`);
const click = (h, sel) =>
    h.ev(`(() => { const el = document.querySelector(${q(sel)}); if (el == null || el.disabled) return false; el.click(); return true; })()`);

// the middle of the first element `sel` matches, scrolled into the middle of its box first; null when it has no size
async function centerOf(h, sel) {
    const box = await h.ev(`(() => {
        const el = document.querySelector(${q(sel)});
        if (el == null) return null;
        el.scrollIntoView({ block: "center", inline: "nearest" });
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 ? { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) } : null;
    })()`);
    if (box != null) await sleep(120);
    // scrolling may have moved it by a pixel or two: read it again where it settled
    return box == null
        ? null
        : h.ev(`(() => {
            const r = document.querySelector(${q(sel)}).getBoundingClientRect();
            return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
        })()`);
}

// a real pointer over the element: the figures' hovers are pointer events, so a DOM `.click()` would not open a tooltip
async function hover(h, sel) {
    const at = await centerOf(h, sel);
    if (at == null) return false;
    await h.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: at.x, y: at.y });
    await sleep(250);
    return true;
}

// the pointer away from every mark, so a tooltip and a dimmed rest let go. A mark is a button that a click focuses, and
// focus opens its tooltip as a hover does, so the focus goes too. True once no tooltip is left open.
async function leave(h) {
    // an SVG mark has blur() too, but is not an HTMLElement
    await h.ev(`(() => { const a = document.activeElement; if (a != null && a !== document.body) a.blur?.(); })()`);
    await h.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: 4, y: 4 });
    await sleep(200);
    return until(h, `!document.querySelector("[data-chart-tooltip]")`, 4_000);
}

async function mouseClick(h, sel) {
    const at = await centerOf(h, sel);
    if (at == null) return false;
    await h.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: at.x, y: at.y });
    await h.cdp("Input.dispatchMouseEvent", { type: "mousePressed", x: at.x, y: at.y, button: "left", buttons: 1, clickCount: 1 });
    await h.cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x: at.x, y: at.y, button: "left", buttons: 0, clickCount: 1 });
    return true;
}

// what an open tooltip says, whitespace folded: the first that matches `want` (any RegExp), else the last one open; null
// while none is. Two figures each keep a tooltip of their own, so `want` names the one this hover is for.
async function tooltipShown(h, want) {
    const read = () =>
        h.ev(`[...document.querySelectorAll("[data-chart-tooltip]")].map((t) => t.innerText.replace(/\\s+/g, " ").trim())`);
    for (const start = Date.now(); Date.now() - start < 4_000; await sleep(150)) {
        const all = await read();
        const hit = want == null ? all.at(-1) : all.find((t) => want.test(t));
        if (hit != null) return hit;
    }
    return (await read()).at(-1) ?? null;
}

// the step runner every scenario here shares: a thrown step is a failed one, with its message
function stepper(steps) {
    return async (name, run) => {
        try {
            const r = await run();
            steps.push({ step: name, ok: r.ok === true, detail: r.detail });
        } catch (e) {
            steps.push({ step: name, ok: false, detail: String(e?.message ?? e) });
        }
    };
}

// the viewport the scenarios pin between each other (verify.mjs), put back after a step that narrows it
const WIDE = { width: 1600, height: 950, deviceScaleFactor: 1, mobile: false };

// ---- the Report ----

// the Report of the council, drawn: its three directions, and (unless `about` is false) About the council opened on the
// At a glance figures, which it holds folded
async function openReport(h, id, { about = true } = {}) {
    await openCouncil(h, id, "summary");
    const drawn = `document.querySelector(${q(SUMMARY)})?.dataset.councilId === ${q(id)} &&
        document.querySelectorAll("[data-council-direction]").length === 3 &&
        !!document.querySelector("[data-council-about-toggle]")`;
    if (!(await until(h, drawn))) throw new Error("the Report did not draw its directions and About the council");
    // the sections fade in as they mount
    await sleep(500);
    if (about) await openAbout(h);
}

// opens About the council, folded above What it spent, and waits for the At a glance figures inside it
async function openAbout(h) {
    if ((await h.ev(`document.querySelector("[data-council-about-toggle]")?.getAttribute("aria-expanded")`)) !== "true") {
        await click(h, "[data-council-about-toggle]");
    }
    const drawn = `!!document.querySelector('[data-council-figure="glance"]') && !!document.querySelector('[data-council-figure="stance-grid"]')`;
    if (!(await until(h, drawn))) throw new Error("About the council did not open on the At a glance figures");
    // the fold opens over its own motion
    await sleep(500);
}

// a direction's card opened by a figure: its detail is under the grid
const DETAIL = (rank) => `${SUMMARY} [data-council-direction-detail="${rank}"]`;
async function closeDirection(h, rank) {
    if (await exists(h, DETAIL(rank))) await click(h, `${SUMMARY} [data-council-direction="${rank}"][data-council-direction-toggle]`);
    return until(h, `!document.querySelector(${q(DETAIL(rank))})`, 4_000);
}

// the header's jump link, the page gliding to its section
// the council's result as its memory keeps it, which the Report draws as What it settled under the cover
function withMemory(c) {
    c.memory = {
        chosen: { text: "Ship the rail apps behind a flag first", how: "pin", at: c.created },
        entries: [
            { id: "m1", kind: "agreed", text: "The rail keeps three apps at most", by: "auto", round: 2, at: c.created + 1 },
            { id: "m2", kind: "open", text: "Does an app stop when it leaves the screen?", by: "auto", round: 2, at: c.created + 2 },
            { id: "m3", kind: "ruledout", text: "A Services chip in the app bar", why: "the rail already shows them", by: "you", at: c.created + 3 },
        ],
    };
}

// opens What it spent, folded at the foot of the report, and brings it to the top of the page
async function openSpend(h) {
    if ((await h.ev(`document.querySelector("[data-council-spend-toggle]")?.getAttribute("aria-expanded")`)) !== "true") {
        await click(h, "[data-council-spend-toggle]");
    }
    await h.ev(`document.querySelector('[data-council-section="spend"]')?.scrollIntoView({ block: "start" })`);
    await sleep(600);
}

async function jumpTo(h, id) {
    await click(h, `${SUMMARY} [data-council-tabbar] [data-council-jump="${id}"]`);
    await sleep(1_100);
}

export const councilFigures = {
    async arrange(h, fx) {
        const ctx = await arrangeCouncilProject(h, fx);
        try {
            // one clock for every write of the council, so a rewrite keeps the gaps and the times it had
            ctx.now = Date.now();
            ctx.councilId = await seedCouncil(h, ctx, "figures", { now: ctx.now, edit: withMemory });
        } catch (e) {
            await teardownCouncilProject(h, ctx).catch(() => {});
            throw e;
        }
        return ctx;
    },

    async assert(h, ctx) {
        const steps = [];
        const step = stepper(steps);
        await openReport(h, ctx.councilId, { about: false });

        await step("To do and What it settled sit under the cover, the directions after them, About the council folded under the directions with At a glance inside it, and What it spent folded at the foot, each computed from the council", async () => {
            // folded, About the council draws no figure
            const aboutFolded = await h.ev(`document.querySelector("[data-council-about-toggle]")?.getAttribute("aria-expanded") === "false" && !document.querySelector('[data-council-figure="glance"]')`);
            await openAbout(h);
            const facts = await h.ev(`(() => {
                const t = (s) => document.querySelector(s)?.innerText?.replace(/\\s+/g, " ").trim() ?? null;
                const after = (a, b) => !!a && !!b && !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
                const cover = document.querySelector("[data-council-cover]");
                const todo = document.querySelector('[data-council-section="todo"]');
                const about = document.querySelector('[data-council-section="about"]');
                const glance = document.querySelector('[data-council-about-block="glance"]');
                const spend = document.querySelector('[data-council-section="spend"]');
                const settled = document.querySelector('[data-council-section="settled"]');
                const last = document.querySelector('[data-council-direction="3"]');
                return {
                    order: after(cover, todo) && after(todo, settled) && after(settled, document.querySelector('[data-council-direction="1"]')) && after(last, about) && about.contains(glance) && after(about, spend),
                    // nothing after What it spent but the rating row and the Map link
                    spendLast: !!spend && [...document.querySelectorAll("[data-council-section], [data-council-asks-next], [data-council-kept]")].pop() === spend,
                    settledHeading: t('[data-council-section="settled"] > h2'),
                    settledDirection: t("[data-council-settled-direction]"),
                    settledGroups: [...document.querySelectorAll("[data-council-settled]")].map((g) => g.dataset.councilSettled).join(","),
                    settledWhy: t('[data-council-settled="ruledout"]'),
                    glanceHeading: t('[data-council-about-block="glance"] > h2'),
                    spendToggle: t("[data-council-spend-toggle]"),
                    spendFolded: document.querySelector("[data-council-spend-toggle]")?.getAttribute("aria-expanded") === "false" && !document.querySelector('[data-council-figure="spend"]'),
                    glanceCaption: t('[data-council-figure="glance"] figcaption'),
                    gridCaption: t('[data-council-figure="stance-grid"] figcaption'),
                    jumps: [...document.querySelectorAll("[data-council-tabbar] [data-council-jump]")].map((j) => j.dataset.councilJump).join(","),
                    points: document.querySelectorAll("[data-glance-point]").length,
                    rows: document.querySelectorAll("tr[data-stance-row]").length,
                    sideBySide: (() => {
                        const a = document.querySelector('[data-council-figure="glance"]')?.getBoundingClientRect();
                        const b = document.querySelector('[data-council-figure="stance-grid"]')?.getBoundingClientRect();
                        return !!a && !!b && a.right <= b.left + 1 && Math.abs(a.top - b.top) < 40;
                    })(),
                    // B sits beside A only when its columns fit there, and drops under A otherwise: this window's pane
                    // leaves B 499px, a 4-seat grid needs 598, so it stacks here
                    stacked: (() => {
                        const a = document.querySelector('[data-council-figure="glance"]')?.getBoundingClientRect();
                        const b = document.querySelector('[data-council-figure="stance-grid"]')?.getBoundingClientRect();
                        return !!a && !!b && a.bottom <= b.top + 1 && Math.abs(a.left - b.left) < 2;
                    })(),
                    // either way the grid shows every column: its own scroll box has nothing to scroll, and the last
                    // seat's header and the Backing header sit inside it (columns are sized to their content, and only
                    // the Direction title gives way)
                    grid: (() => {
                        const box = document.querySelector('[data-council-figure="stance-grid"] [data-stance-scroll]');
                        const heads = [...document.querySelectorAll('[data-council-figure="stance-grid"] thead th[data-stance-head]')];
                        const backing = heads.find((th) => th.dataset.stanceHead === "backing");
                        const lastSeat = heads.length >= 3 ? heads[heads.length - 2] : null;
                        if (!box || !backing || !lastSeat) return null;
                        const r = box.getBoundingClientRect();
                        const inside = (el) => {
                            const e = el.getBoundingClientRect();
                            return e.width > 0 && e.left >= r.left - 1 && e.right <= r.right + 1;
                        };
                        const cells = [...document.querySelectorAll('[data-council-figure="stance-grid"] tbody [data-stance-glyph]')];
                        return {
                            scrollWidth: box.scrollWidth,
                            clientWidth: box.clientWidth,
                            lastSeat: lastSeat.dataset.stanceHead,
                            lastSeatInside: inside(lastSeat),
                            backingInside: inside(backing),
                            // a pill is never cut: it is as wide as its own content
                            pillsWhole: cells.every((p) => p.getBoundingClientRect().height < 24 && p.scrollWidth <= p.clientWidth + 1),
                            seats: heads.length - 2,
                            // each column's width, Direction first and Backing last, and the widest pill of each seat
                            cols: [...document.querySelectorAll('[data-council-figure="stance-grid"] thead th')].map((th) => Math.round(th.getBoundingClientRect().width)),
                            widestPill: heads.slice(1, -1).map((_, i) =>
                                Math.round(Math.max(0, ...[...document.querySelectorAll('[data-council-figure="stance-grid"] tbody tr')].map((tr) => tr.children[i + 1]?.querySelector("[data-stance-glyph]")?.getBoundingClientRect().width ?? 0)))
                            ),
                            backingCell: Math.round(document.querySelector('[data-council-figure="stance-grid"] tbody tr td:last-child > span')?.getBoundingClientRect().width ?? 0),
                        };
                    })(),
                };
            })()`);
            // At a glance brought to the top of the page (it has no jump link: About the council holds it): the board's
            // picture and the What's new one (a clip of the block, which only holds what is on screen) both show it whole
            await jumpTo(h, "settled");
            await h.shot("cdp-shots/council-figures-settled.png");
            await h.ev(`document.querySelector('[data-council-about-block="glance"]').scrollIntoView({ block: "start" })`);
            await sleep(400);
            await h.shot("cdp-shots/council-figures.png");
            const pic = await h.whatsnewShot("council-figures", { selector: '[data-council-about-block="glance"]' });
            await openSpend(h);
            const opened = await h.ev(`(() => {
                const t = (s) => document.querySelector(s)?.innerText?.replace(/\\s+/g, " ").trim() ?? null;
                return { spendCaption: t('[data-council-figure="spend"] figcaption'), lanesCaption: t('[data-council-figure="lanes"] figcaption') };
            })()`);
            await h.shot("cdp-shots/council-figures-spend-open.png");
            Object.assign(facts, opened);
            const ok =
                aboutFolded &&
                facts.order &&
                facts.spendLast &&
                facts.settledHeading === "What it settled" &&
                /Ship the rail apps behind a flag first/.test(facts.settledDirection ?? "") &&
                facts.settledGroups === "agreed,open,ruledout" &&
                /Why: the rail already shows them/.test(facts.settledWhy ?? "") &&
                facts.glanceHeading === "At a glance" &&
                facts.spendFolded &&
                /^What it spent .*9\.0M tokens in \d+ calls/.test(facts.spendToggle ?? "") &&
                facts.glanceCaption?.includes("D1 and D2 stand on checked evidence and the panel's backing") &&
                facts.glanceCaption?.includes("D3 is a guess") &&
                facts.gridCaption?.includes("The panel split on D3") &&
                facts.spendCaption?.includes("Đo RAM spent a third of the tokens (3.0M of 9.0M)") &&
                facts.spendCaption?.includes("1.5M a call") &&
                // the Skeptic's lane holds 200 steps: the oldest are gone, so it is the last ones that were kept
                !!facts.lanesCaption &&
                // the fixture keeps two ideas aside, so Also raised is a link after the directions; it has no figure,
                // so Figures has none; neither has About the council (At a glance) nor What it spent
                facts.jumps === "todo,settled,directions,kept" &&
                facts.points === 3 &&
                facts.rows === 3 &&
                (facts.sideBySide || facts.stacked) &&
                !!facts.grid &&
                facts.grid.scrollWidth <= facts.grid.clientWidth + 1 &&
                facts.grid.lastSeatInside &&
                facts.grid.backingInside &&
                facts.grid.pillsWhole;
            return { ok, detail: JSON.stringify({ aboutFolded, ...facts, pic }) };
        });

        await step("a hover on a point of the quadrant opens its tooltip (evidence held, backing), a click opens that direction's card, and a click on a row of the stance grid opens its direction", async () => {
            const hovered = await hover(h, '[data-glance-point="1"]');
            const tip = await tooltipShown(h, /evidence held/);
            await h.shot("cdp-shots/council-figures-hover.png");
            const gone = await leave(h);
            const hollow = await hover(h, '[data-glance-point="3"]');
            const tip3 = await tooltipShown(h, /^D3 /);
            const gone3 = await leave(h);
            const clicked = await mouseClick(h, '[data-glance-point="1"]');
            const open1 = await until(h, `!!document.querySelector(${q(DETAIL(1))})`);
            const closed1 = await closeDirection(h, 1);
            const left1 = await leave(h);
            const row = await mouseClick(h, 'tr[data-stance-row="2"]');
            const open2 = await until(h, `!!document.querySelector(${q(DETAIL(2))})`);
            const closed2 = await closeDirection(h, 2);
            const left2 = await leave(h);
            const ok =
                hovered &&
                /evidence held 3 of 3/.test(tip ?? "") &&
                /backed by 4 of 4 seats/.test(tip ?? "") &&
                gone &&
                hollow &&
                /no evidence cited/.test(tip3 ?? "") &&
                !/evidence held/.test(tip3 ?? "") &&
                gone3 &&
                clicked &&
                open1 &&
                closed1 &&
                left1 &&
                row &&
                open2 &&
                closed2 &&
                left2;
            return {
                ok,
                detail: JSON.stringify({ hovered, tip, gone, hollow, tip3, gone3, clicked, open1, closed1, left1, row, open2, closed2, left2 }),
            };
        });

        await step("What it spent, unfolded at the foot: a lane for each seat that worked and the files more than one read, and a hover on the Đo RAM row says what it cost a call", async () => {
            await openSpend(h);
            const drew = await until(h, `document.querySelectorAll("[data-lane-seat]").length >= 4 && document.querySelectorAll("[data-shared-read]").length >= 2`);
            const lanes = await count(h, "[data-lane-seat]");
            const shared = await count(h, "[data-shared-read]");
            const rows = await count(h, "[data-spend-seat]");
            await h.shot("cdp-shots/council-figures-spend.png");
            const hovered = await hover(h, '[data-spend-seat="ram"]');
            const tip = await tooltipShown(h, /a call/);
            await h.shot("cdp-shots/council-figures-spend-hover.png");
            const gone = await leave(h);
            const ok = drew && lanes >= 4 && shared >= 2 && rows >= 4 && hovered && /a call/.test(tip ?? "") && gone;
            return { ok, detail: JSON.stringify({ drew, lanes, shared, rows, hovered, tip, gone }) };
        });

        await step("a hover on a stretch of a lane names its steps", async () => {
            const sel = '[data-lane-seat="ux"] [data-lane-span]';
            const hovered = await hover(h, sel);
            const tip = await tooltipShown(h, /\d+ steps?/);
            await h.shot("cdp-shots/council-figures-lanes.png");
            const gone = await leave(h);
            const capped = await exists(h, '[data-lane-seat="skeptic"] [data-lane-capped]');
            const ok = hovered && /\d+ steps?/.test(tip ?? "") && capped && gone;
            return { ok, detail: JSON.stringify({ hovered, tip, gone, capped, laneCaps: await textOf(h, '[data-lane-seat="skeptic"] [data-lane-capped]') }) };
        });

        await step("a click on a seat's spend row opens the Discussion on that seat's messages alone, and the Report comes back", async () => {
            const clicked = await mouseClick(h, '[data-spend-seat="ram"]');
            const only = await until(h, `!!document.querySelector("[data-council-only='ram']")`);
            const line = await textOf(h, "[data-council-only]");
            await h.shot("cdp-shots/council-figures-seat-discussion.png");
            await click(h, "[data-council-action='show-everyone']");
            const released = await until(h, `!document.querySelector("[data-council-only]")`);
            await openReport(h, ctx.councilId);
            const ok = clicked && only && /^Only /.test(line ?? "") && released;
            return { ok, detail: JSON.stringify({ clicked, only, line, released }) };
        });

        await step("a council rewritten while its Report is open redraws: a seat that spent more has a wider bar once it settles", async () => {
            await openSpend(h);
            const bar = () => h.ev(`document.querySelector('[data-spend-seat="ux"] [data-spend-bar]')?.getBoundingClientRect().width ?? 0`);
            const label = () => textOf(h, '[data-spend-seat="ux"]');
            const before = await bar();
            const labelBefore = await label();
            // UX spends half as much again: Đo RAM is the seat the axis is drawn to (its bar is always the full share),
            // so it is a seat under it whose bar can grow
            writeCouncil(ctx, "figures", {
                now: ctx.now,
                edit: (c) => {
                    withMemory(c);
                    const more = Math.round(c.stats.ux.tokens / 2);
                    c.stats.ux.tokens += more;
                    c.tokens += more;
                },
            });
            await announceCouncil(h, ctx, ctx.councilId);
            const grew = await until(h, `(document.querySelector('[data-spend-seat="ux"] [data-spend-bar]')?.getBoundingClientRect().width ?? 0) > ${before + 4}`);
            // the bar eases to its width: it has settled once it stops moving
            await sleep(700);
            const after = await bar();
            const labelAfter = await label();
            const ram = await h.ev(`document.querySelector('[data-spend-seat="ram"] [data-spend-bar]')?.getBoundingClientRect().width ?? 0`);
            const ok = grew && after > before + 4 && labelAfter !== labelBefore && ram >= after - 1;
            return { ok, detail: JSON.stringify({ before, after, ram, labelBefore, labelAfter }) };
        });

        await step("the glance figure's Table shows the same numbers as a table, and a pane narrower than the stance grid's columns keeps the quadrant above it, the grid scrolling inside its own box", async () => {
            await h.ev(`document.querySelector("[data-council-scroll]").scrollTop = 0`);
            await sleep(300);
            const toggled = await click(h, '[data-council-figure="glance"] [data-figure-table-toggle]');
            const table = await until(h, `document.querySelector('[data-council-figure="glance"]')?.dataset.figureView === "table"`);
            const rows = await h.ev(`document.querySelectorAll('[data-council-figure="glance"] table tbody tr').length`);
            const noPoints = (await count(h, "[data-glance-point]")) === 0;
            await h.shot("cdp-shots/council-figures-table.png");
            try {
                await h.cdp("Emulation.setDeviceMetricsOverride", { width: 1000, height: 950, deviceScaleFactor: 1, mobile: false });
                await sleep(500);
                const m = await h.ev(`(() => {
                    const a = document.querySelector('[data-council-figure="glance"]').getBoundingClientRect();
                    const b = document.querySelector('[data-council-figure="stance-grid"]').getBoundingClientRect();
                    const box = document.querySelector("[data-council-scroll]");
                    return {
                        aBottom: Math.round(a.bottom),
                        bTop: Math.round(b.top),
                        aLeft: Math.round(a.left),
                        bLeft: Math.round(b.left),
                        scrollWidth: box.scrollWidth,
                        clientWidth: box.clientWidth,
                        stillTable: document.querySelector('[data-council-figure="glance"]').dataset.figureView,
                    };
                })()`);
                // the narrowed pane's board shows the two figures stacked, not the cover above them
                await h.ev(`document.querySelector('[data-council-about-block="glance"]').scrollIntoView({ block: "start" })`);
                await sleep(300);
                await h.shot("cdp-shots/council-figures-narrow.png");
                const ok =
                    toggled &&
                    table &&
                    rows >= 3 &&
                    noPoints &&
                    m.aBottom <= m.bTop + 1 &&
                    m.stillTable === "table" &&
                    // the grid scrolls inside its own box: the page never does
                    m.scrollWidth <= m.clientWidth + 1;
                return { ok, detail: JSON.stringify({ toggled, table, rows, noPoints, ...m }) };
            } finally {
                await h.cdp("Emulation.setDeviceMetricsOverride", WIDE);
            }
        });

        return steps;
    },

    async teardown(h, ctx) {
        await teardownCouncilProject(h, ctx);
    },
};

// ---- the Map ----

// opens a council's Map through the DEV hook (fixtures.mjs openCouncil opens only the Discussion and the Report)
async function openMap(h, id) {
    if (!(await h.ev("!!window.__arcCouncil"))) throw new Error("window.__arcCouncil is missing: the DEV build installs it (councilpane.tsx)");
    await h.ev(`window.__arcCouncil.showCouncil(${q(id)}, "map")`);
    const drawn = `document.querySelector(${q(MAP)})?.dataset.councilId === ${q(id)} && !!document.querySelector("[data-council-map-matrix]")`;
    if (!(await until(h, drawn))) throw new Error(`the Map of ${id} did not draw`);
    await sleep(400);
}

export const councilFiguresGraph = {
    async arrange(h, fx) {
        const ctx = await arrangeCouncilProject(h, fx);
        try {
            ctx.councilId = await seedCouncil(h, ctx, "figures");
        } catch (e) {
            await teardownCouncilProject(h, ctx).catch(() => {});
            throw e;
        }
        return ctx;
    },

    async assert(h, ctx) {
        const steps = [];
        const step = stepper(steps);
        await openMap(h, ctx.councilId);

        await step("the Map opens on the matrix, and Graph swaps it for the argument map: nine ideas in five groups, a seat each", async () => {
            const before = await h.ev(`(() => ({
                shown: document.querySelector("[data-council-map-matrix]")?.dataset.mapShown,
                matrix: !!document.querySelector("[data-council-map-frame]"),
                graph: !!document.querySelector('[data-council-figure="graph"]'),
                pressed: [...document.querySelectorAll("[data-map-view]")].map((b) => b.dataset.mapView + "=" + b.getAttribute("aria-pressed")).join(","),
            }))()`);
            const clicked = await click(h, '[data-map-view="graph"]');
            const drew = await until(h, `!!document.querySelector('[data-council-figure="graph"]') && document.querySelectorAll("[data-graph-idea]").length > 0`);
            // the figure fades in and the page settles
            await sleep(700);
            const after = await h.ev(`(() => ({
                shown: document.querySelector("[data-council-map-matrix]")?.dataset.mapShown,
                matrix: !!document.querySelector("[data-council-map-frame]"),
                ideas: document.querySelectorAll("[data-graph-idea]").length,
                groups: document.querySelectorAll("[data-graph-group]").length,
                seats: document.querySelectorAll("[data-graph-seat]").length,
                edges: document.querySelectorAll("[data-graph-edge]").length,
                dimmed: document.querySelectorAll("[data-graph-edge][data-dimmed]").length,
                caption: document.querySelector('[data-council-figure="graph"] figcaption')?.innerText?.replace(/\\s+/g, " ").trim() ?? null,
                pressed: [...document.querySelectorAll("[data-map-view]")].map((b) => b.dataset.mapView + "=" + b.getAttribute("aria-pressed")).join(","),
            }))()`);
            await h.shot("cdp-shots/council-figures-graph.png");
            const ok =
                before.shown === "matrix" &&
                before.matrix &&
                !before.graph &&
                before.pressed === "matrix=true,graph=false" &&
                clicked &&
                drew &&
                after.shown === "graph" &&
                !after.matrix &&
                after.ideas === 9 &&
                after.groups === 5 &&
                // four panel seats, and a You row only when the person replied to an idea
                after.seats >= 4 &&
                after.edges > 0 &&
                after.dimmed === 0 &&
                /Most contested: P4/.test(after.caption ?? "") &&
                after.pressed === "matrix=false,graph=true";
            return { ok, detail: JSON.stringify({ before, after }) };
        });

        await step("a hover on an idea dims every edge that is not on it, and a click on it comes back to the matrix with its row open", async () => {
            const hovered = await hover(h, '[data-graph-idea="P4"]');
            const tip = await tooltipShown(h);
            const edges = await h.ev(`(() => {
                const all = [...document.querySelectorAll("[data-graph-edge]")];
                const own = all.filter((e) => e.dataset.graphEdge.endsWith("->P4"));
                return {
                    total: all.length,
                    own: own.length,
                    ownFull: own.every((e) => !e.hasAttribute("data-dimmed")),
                    restDimmed: all.filter((e) => !e.dataset.graphEdge.endsWith("->P4")).every((e) => e.hasAttribute("data-dimmed")),
                };
            })()`);
            await sleep(300);
            await h.shot("cdp-shots/council-figures-graph-hover.png");
            // the pointer leaving lets go: its tooltip closes and every edge is full again
            const gone = await leave(h);
            const undimmed = await until(h, `document.querySelectorAll("[data-graph-edge][data-dimmed]").length === 0`, 4_000);
            await hover(h, '[data-graph-idea="P4"]');
            const clicked = await mouseClick(h, '[data-graph-idea="P4"]');
            const back = await until(h, `document.querySelector("[data-council-map-matrix]")?.dataset.mapShown === "matrix" && !!document.querySelector("[data-council-map-frame]")`);
            const rowOpen = await until(h, `document.querySelector('[data-council-map-row="P4"]')?.dataset.open === "true" && !!document.querySelector('[data-council-map-reasons="P4"]')`);
            // the switch is the matrix's again, and it keeps the view for the council
            const pressed = await h.ev(`[...document.querySelectorAll("[data-map-view]")].map((b) => b.dataset.mapView + "=" + b.getAttribute("aria-pressed")).join(",")`);
            await sleep(700);
            await h.shot("cdp-shots/council-figures-graph-matrix.png");
            const ok =
                hovered &&
                edges.own >= 2 &&
                edges.ownFull &&
                edges.restDimmed &&
                edges.total > edges.own &&
                gone &&
                undimmed &&
                clicked &&
                back &&
                rowOpen &&
                pressed === "matrix=true,graph=false";
            return { ok, detail: JSON.stringify({ tip, edges, gone, undimmed, clicked, back, rowOpen, pressed }) };
        });

        return steps;
    },

    async teardown(h, ctx) {
        await teardownCouncilProject(h, ctx);
    },
};

// ---- the benchmark ----

// the rows `wsh council bench results` prints, in the shape the bench log has today: two harnesses (11-12 the newest), both
// modes, and one Review row (the team's on 11-12) that was not judged whole (allscored under scored), so it plots recall@5
// hollow. 14 Review runs and 10 Brainstorm ones: "24 runs in 2 modes".
const BENCH_ROWS = [
    { harness: "2026-11-12.1", mode: "review", variant: "council", runs: 5, scored: 5, recall: 7, keys: 33, wrong: 4, tokens: 7_500_000, recallperm: 0.9333, recall3: 0, judged: 30, recall5: 5, allscored: 5 },
    { harness: "2026-11-12.1", mode: "review", variant: "team", runs: 4, scored: 4, recall: 3, keys: 33, wrong: 5, tokens: 12_000_000, recallperm: 0.25, recall3: 0, judged: 20, recall5: 6, allscored: 2 },
    { harness: "2026-11-05.1", mode: "review", variant: "solo", runs: 5, scored: 5, recall: 13, keys: 33, wrong: 6, tokens: 1_500_000, recallperm: 8.7, recall3: 0, judged: 40, recall5: 9, allscored: 5 },
    { harness: "2026-11-12.1", mode: "brainstorm", variant: "brainstorm", runs: 3, scored: 3, recall: 10, keys: 32, wrong: 0, tokens: 17_100_000, recallperm: 0.58, recall3: 0, judged: 0, recall5: 0, allscored: 0 },
    { harness: "2026-11-12.1", mode: "brainstorm", variant: "council", runs: 4, scored: 4, recall: 7, keys: 32, wrong: 0, tokens: 6_000_000, recallperm: 1.17, recall3: 0, judged: 0, recall5: 0, allscored: 0 },
    { harness: "2026-11-05.1", mode: "brainstorm", variant: "brainstorm", runs: 3, scored: 3, recall: 7, keys: 32, wrong: 0, tokens: 15_000_000, recallperm: 0.47, recall3: 0, judged: 0, recall5: 0, allscored: 0 },
];
const BENCH_RESULTS = { harness: "2026-11-12.1", runs: BENCH_ROWS, results: [], ratings: [] };
const BENCH_STUB = { CouncilBenchResultsCommand: { value: BENCH_RESULTS } };
const POINT = (id) => `[data-bench-point="${id}"]`;

// Library → Councils, the Councils tab clicked
async function openLibraryCouncils(h) {
    await h.goto("library");
    await click(h, '[data-library-tab="councils"]');
    if (!(await until(h, `!!document.querySelector('[data-council-figure="bench"]')`))) {
        throw new Error("the Benchmark section did not draw over Library's Councils list");
    }
    await sleep(500);
}

export const councilBenchChart = {
    async arrange(h, fx) {
        const ctx = await arrangeCouncilProject(h, fx);
        try {
            // starts folded, as it does for a person who never opened it
            await h.ev(`(() => { try { window.localStorage.removeItem(${q(BENCH_OPEN_KEY)}); } catch {} })()`);
            await seedCouncil(h, ctx, "figures");
            await stubRpc(h, ["CouncilBenchResultsCommand"], BENCH_STUB);
        } catch (e) {
            await teardownCouncilProject(h, ctx).catch(() => {});
            throw e;
        }
        return ctx;
    },

    async assert(h) {
        const steps = [];
        const step = stepper(steps);

        await step("Library's Councils tab folds the Benchmark to one header and its takeaway over the list, and opening it draws a small multiple for each mode", async () => {
            await openLibraryCouncils(h);
            const folded = await h.ev(`(() => {
                const fig = document.querySelector('[data-council-figure="bench"]');
                const t = (el) => el?.innerText?.replace(/\\s+/g, " ").trim() ?? null;
                return {
                    title: t(fig.querySelector("[id]")),
                    caption: t(fig.querySelector("figcaption")),
                    expanded: fig.querySelector("[data-bench-toggle]")?.getAttribute("aria-expanded"),
                    panels: fig.querySelectorAll("[data-bench-panel]").length,
                    toggle: !!fig.querySelector("[data-figure-table-toggle]"),
                    overList: !!document.querySelector("[data-library-bench] ~ [data-council-history]"),
                };
            })()`);
            await h.shot("cdp-shots/council-bench-folded.png");
            const clicked = await click(h, "[data-bench-toggle]");
            const open = await until(h, `document.querySelectorAll("[data-bench-panel]").length === 2`);
            await sleep(500);
            const facts = await h.ev(`(() => {
                const t = (s) => document.querySelector(s)?.innerText?.replace(/\\s+/g, " ").trim() ?? null;
                return {
                    expanded: document.querySelector("[data-bench-toggle]")?.getAttribute("aria-expanded"),
                    stored: window.localStorage.getItem(${q(BENCH_OPEN_KEY)}),
                    review: t('[data-bench-takeaway="review"]'),
                    brainstorm: t('[data-bench-takeaway="brainstorm"]'),
                    points: document.querySelectorAll("[data-bench-point]").length,
                    hollow: document.querySelectorAll("[data-bench-point][data-bench-hollow]").length,
                    frontier: document.querySelectorAll("[data-bench-frontier]").length,
                    toggle: !!document.querySelector("[data-figure-table-toggle]"),
                };
            })()`);
            await h.shot("cdp-shots/council-bench-chart.png");
            const ok =
                /Benchmark · 24 runs in 2 modes/.test(folded.title ?? "") &&
                /run it on the newest harness/.test(folded.caption ?? "") &&
                folded.expanded === "false" &&
                folded.panels === 0 &&
                !folded.toggle &&
                clicked &&
                open &&
                facts.expanded === "true" &&
                facts.stored === "1" &&
                /Newest harness: /.test(facts.review ?? "") &&
                /Newest harness: /.test(facts.brainstorm ?? "") &&
                // the Review takeaway names the score that counts only five items
                /first 5 items only/.test(facts.review ?? "") &&
                facts.points === 6 &&
                facts.hollow === 1 &&
                // a frontier is drawn for a mode with two or more points on it: the Brainstorm's (the Review's newest points
                // are the council's and the team's hollow one, which the council beats)
                facts.frontier >= 1 &&
                facts.toggle;
            return { ok, detail: JSON.stringify({ folded, facts }) };
        });

        await step("after a reload the section is still open (the stand-in is put back first: a reload drops it)", async () => {
            await h.reload();
            await stubRpc(h, ["CouncilBenchResultsCommand"], BENCH_STUB);
            await openLibraryCouncils(h);
            const open = await until(h, `document.querySelectorAll("[data-bench-panel]").length === 2`);
            const expanded = await h.ev(`document.querySelector("[data-bench-toggle]")?.getAttribute("aria-expanded")`);
            return { ok: open && expanded === "true", detail: JSON.stringify({ open, expanded }) };
        });

        await step("a hover on a point opens the row as `wsh council bench results` prints it, a hollow one says it is recall@5 only, and the Table shows the same rows", async () => {
            const hovered = await hover(h, POINT("review/council/2026-11-12.1"));
            const tip = await tooltipShown(h);
            await h.shot("cdp-shots/council-bench-hover.png");
            await leave(h);
            const hollowHovered = await hover(h, POINT("review/team/2026-11-12.1"));
            const hollowTip = await tooltipShown(h);
            await leave(h);
            const toggled = await click(h, '[data-council-figure="bench"] [data-figure-table-toggle]');
            const table = await until(h, `document.querySelector('[data-council-figure="bench"]')?.dataset.figureView === "table"`);
            await sleep(300);
            const rows = await h.ev(`document.querySelectorAll('[data-council-figure="bench"] table tbody tr').length`);
            const noPoints = (await count(h, "[data-bench-point]")) === 0;
            await h.shot("cdp-shots/council-bench-table.png");
            const ok =
                hovered &&
                /recall@5 5\/33/.test(tip ?? "") &&
                /tokens 7\.5M/.test(tip ?? "") &&
                hollowHovered &&
                /recall@5 only/.test(hollowTip ?? "") &&
                toggled &&
                table &&
                // one row for each (harness, variant) of the six
                rows === 6 &&
                noPoints;
            return { ok, detail: JSON.stringify({ tip, hollowTip, toggled, table, rows, noPoints }) };
        });

        return steps;
    },

    async teardown(h, ctx) {
        try {
            await h.ev(`(() => { try { window.localStorage.removeItem(${q(BENCH_OPEN_KEY)}); } catch {} })()`);
        } catch (e) {
            console.error(`council bench chart: clearing ${BENCH_OPEN_KEY} failed: ${e?.message ?? e}`);
        }
        await unstubRpc(h).catch((e) => console.error(`council bench chart: unstubRpc failed: ${e?.message ?? e}`));
        await teardownCouncilProject(h, ctx);
    },
};
