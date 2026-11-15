// overlays-frost-frames: the one-off frame-time measurement of two frosted panels the toast's measurement (toast.mjs) did
// not cover, each over a terminal streaming output (initiative 7655bf18, chunk 28). Final does not run it.
//
//   1. the terminal's find bar (element/search.tsx), opened over the streaming terminal it searches, standing still: the
//      blur is redrawn every time the output under it changes
//   2. Jarvis' pet peek (jarvis/petpeek.tsx), open over the same terminal, its "Earlier" drawer opened and shut every
//      TOGGLE_MS for the whole pass: the drawer animates its height and the peek, layout="size", animates its own size
//      with it, so the blurred area changes size on every frame of the animation
//
// The flood is toast.mjs's: termflood.mjs's BuildKit-style redraw at 180 KB/s (the 2026-10-14 incident's load), in an
// agent's block shown in its Terminal view on the Agent surface. Each panel gets PASSES passes with its blur on and
// PASSES with it off (`backdrop-filter: none`, set inline with !important; the fill stays the same), alternating so drift
// on a shared machine lands on both, each PASS_MS long after SETTLE_MS, recording `requestAnimationFrame` intervals. Rule
// (toast.mjs's): the blur is kept when the median p95 with it is within P95_BUDGET_MS of the median p95 without it. It runs
// only when named: `ARC_FINAL_OUT=<dir> node scripts/cdp/final-verify.mjs overlays-frost-frames`.
//
// The peek's drawer needs updates to hold: the steps put four into the pet's said list (petstore.ts rememberSaid), as a
// notify would, without raising a bubble. The peek opens by the pet's corner, mostly over the side panel; the step moves
// it over the terminal's screen (CSS translate on its floating wrapper) and reports how much of it is over the screen.
//
//   MEASURED 2026-11-15 on 0febed176 (main), dev app on the Windows WebView2 host, 1600x950 viewport, flood 180 KB/s,
//   5 s per pass, on a machine shared with other agents. Two runs; the second moved the peek over the terminal.
//   Run 1 (a calm stretch; the peek where the pet put it, 10% over the terminal's screen, 267 px shut, 438 px open):
//     find bar (98% over the screen)  median p95 blur 13.4 ms, none 13.4 ms   every pass 13.4-13.5 ms
//     pet peek, drawer flipping       median p95 blur 26.8 ms, none 26.8 ms   pass #1 (blur) 40 ms, the other five 26.8 ms
//   Run 2 (the machine got busy mid-run: the find bar's passes climb from 13.5 to 93.5 ms with the blur on and off alike;
//   the peek wholly over the screen, 319 px shut, 489 px open):
//     find bar                        median p95 blur 67.0 ms, none 66.7 ms   difference 0.3 ms
//     pet peek, drawer flipping       median p95 blur 40.1 ms, none 40.1 ms   difference 0 ms
//   DECISION: KEEP THE BLUR on both. The blur moves no median. What costs frames is the peek's size animation itself:
//   its p95 is 26.8 ms with no blur at all, in a run where a still panel over the same flood holds 13.4 ms. Re-run it
//   when the peek's resize or the terminal renderer changes.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as AC from "../agent-page-fixtures.mjs";

const NAME = "overlays-frost-frames";
const FLOOD_LABEL = "overlays-frost-frames-flood";
const WAIT_MS = 15000;
const SHORT_MS = 5000;

const PASSES = 3; // per state
const PASS_MS = 5000;
const SETTLE_MS = 600;
const P95_BUDGET_MS = 2;
const MIN_FRAMES = 100;
// the peek's drawer flips this often during a pass: its spring settles inside it, so most frames are animation frames
const TOGGLE_MS = 500;
const FLOOD_KBPS = 180;
// longer than the twelve passes need (~70 s) plus the tab's startup; closing the tab ends it sooner
const FLOOD_SECS = 180;
const TERM_SIZE = { rows: 30, cols: 120 };
const UPDATES = 4;

// termflood.mjs's FLOOD_SRC, as toast.mjs carries it
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

// the panels that carry the frost
const SEARCH = ".search-container";
const PEEK = "*:has(> [data-pet-peek])";
const DRAWER_TOGGLE = "[data-pet-peek] [data-pet-updates] > button";
const CREATURE = '[aria-label="Jarvis condition"]';

const KEYS = {
    escape: { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 },
};

const skipStep = (step, detail) => ({ step, skip: true, detail });
const median = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const round = (v) => (v == null ? v : Math.round(v * 10) / 10);

// the blur on or off on one panel, inline so a re-render's class list cannot put it back; the computed style says it took
const FORCE = (sel, on) => `(() => {
    const p = document.querySelector(${JSON.stringify(sel)});
    if (!p) return null;
    for (const prop of ["backdrop-filter", "-webkit-backdrop-filter"]) {
        if (${on}) p.style.removeProperty(prop);
        else p.style.setProperty(prop, "none", "important");
    }
    const cs = getComputedStyle(p);
    return { backdropFilter: cs.backdropFilter || cs.webkitBackdropFilter || "none", background: cs.backgroundColor };
})()`;

// frames, and for the peek the drawer flipping every TOGGLE_MS while they are recorded (an even count, so every pass
// starts from the drawer shut)
const FRAMES_START = (toggle) => `(() => {
    const f = (window.__offFrames = { on: true, last: 0, deltas: [], flips: 0 });
    const tick = (t) => {
        if (!f.on) return;
        if (f.last) f.deltas.push(t - f.last);
        f.last = t;
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    if (${toggle}) {
        f.timer = setInterval(() => {
            const b = document.querySelector(${JSON.stringify(DRAWER_TOGGLE)});
            if (b) { b.click(); f.flips++; }
        }, ${TOGGLE_MS});
    }
    return true;
})()`;
const FRAMES_STOP = `(() => {
    const f = window.__offFrames;
    if (!f) return null;
    f.on = false;
    clearInterval(f.timer);
    delete window.__offFrames;
    // leave the drawer shut for the next pass
    const b = document.querySelector(${JSON.stringify(DRAWER_TOGGLE)});
    if (b && b.getAttribute("aria-expanded") === "true") b.click();
    const d = [...f.deltas].sort((a, b) => a - b);
    if (d.length === 0) return null;
    const at = (q) => d[Math.min(d.length - 1, Math.ceil(q * d.length) - 1)];
    return { frames: d.length, p50: at(0.5), p95: at(0.95), worst: d[d.length - 1], over20: d.filter((x) => x > 20).length, flips: f.flips };
})()`;

export default function (kit) {
    const { waveService, polishWaitFor, polishNap, ahReload, GRID_KEY, GRID_EMPTY } = kit;
    const { makeTab, closeTabs } = AC.tabFixtures({ waveService });

    async function shot(h, name) {
        try {
            await h.shot(`cdp-shots/overlays-frost-frames-${name}.png`);
        } catch (e) {
            console.error(`${NAME}: the shot ${name} failed: ${e?.message ?? e}`);
        }
    }
    async function key(h, k) {
        for (const type of ["keyDown", "keyUp"]) await h.cdp("Input.dispatchKeyEvent", { type, ...k });
    }
    const teardownStep = async (what, fn) => {
        try {
            await fn();
        } catch (e) {
            console.error(`${NAME} teardown: ${what} failed: ${e?.message ?? e}`);
        }
    };
    const restoreKeys = (h, prev) =>
        h.ev(`(() => {
            for (const [k, v] of Object.entries(${JSON.stringify(prev ?? {})})) {
                if (v == null) localStorage.removeItem(k);
                else localStorage.setItem(k, v);
            }
            return true;
        })()`);
    const setMode = (h, tabId, mode) =>
        AC.agentPage(
            h,
            `const { setChatMode } = await mod("app/view/agents/chatmodestore.ts");
            setChatMode(${JSON.stringify(tabId)}, ${JSON.stringify(mode)});
            return true;`
        );
    const floodRow = (ctx) => ({
        project: FLOOD_LABEL,
        task: "",
        agent: "claude",
        model: "opus",
        state: "working",
        activity: "Building",
        activeMs: 30_000,
        usage: { contextpct: 42 },
        id: ctx.tab.tabId,
        name: FLOOD_LABEL,
        blockId: ctx.tab.blockId,
    });
    const screenOf = (tabId) => `document.querySelector('[data-agent-terminal="${tabId}"] .xterm-screen')`;
    // how much of a panel is over the terminal's screen
    const OVERLAP = (sel, tabId) => `(() => {
        const t = document.querySelector(${JSON.stringify(sel)})?.getBoundingClientRect();
        const x = ${screenOf(tabId)}?.getBoundingClientRect();
        if (!t || !x) return { panel: !!t, screen: !!x };
        const w = Math.max(0, Math.min(t.right, x.right) - Math.max(t.left, x.left));
        const h = Math.max(0, Math.min(t.bottom, x.bottom) - Math.max(t.top, x.top));
        const r = (b) => ({ x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) });
        return { panel: r(t), screen: r(x), overlap: t.width * t.height > 0 ? Math.round(((w * h) / (t.width * t.height)) * 100) / 100 : 0 };
    })()`;

    // a clip of the terminal's screen, captured until it changes: the flood redraws it every 50 ms
    async function floodLive(h, screen) {
        const clip = { x: screen.x + 10, y: screen.y + 10, width: Math.min(200, screen.w - 20), height: Math.min(100, screen.h - 20), scale: 1 };
        const grab = async () => (await h.cdp("Page.captureScreenshot", { format: "png", clip })).data;
        const first = await grab();
        for (let i = 0; i < 20; i++) {
            await polishNap(250);
            if ((await grab()) !== first) return true;
        }
        return false;
    }

    // PASSES with the blur, PASSES without, alternating; the panel's own decision
    async function measure(h, label, sel, toggle) {
        const passes = [];
        let bad = null;
        for (let n = 0; n < PASSES * 2 && bad == null; n++) {
            const on = n % 2 === 0;
            const forced = await h.ev(FORCE(sel, on));
            const took = forced != null && (on ? forced.backdropFilter !== "none" : forced.backdropFilter === "none");
            await polishNap(SETTLE_MS);
            await h.ev(FRAMES_START(toggle));
            await polishNap(PASS_MS);
            const s = await h.ev(FRAMES_STOP);
            if (n < 2) await shot(h, `${label}-${on ? "blur" : "none"}`);
            const pass = {
                n: n + 1,
                blur: on,
                took,
                backdropFilter: forced?.backdropFilter ?? null,
                frames: s?.frames ?? 0,
                p50: round(s?.p50),
                p95: round(s?.p95),
                worst: round(s?.worst),
                over20: s?.over20 ?? 0,
                flips: s?.flips ?? 0,
            };
            passes.push(pass);
            if (!took || s == null || s.frames < MIN_FRAMES || (toggle && pass.flips < 4)) bad = pass;
        }
        await h.ev(FORCE(sel, true));
        const of = (blur) => passes.filter((p) => p.blur === blur).map((p) => p.p95);
        const blurred = round(median(of(true)));
        const plain = round(median(of(false)));
        const delta = round(blurred - plain);
        const decision = delta <= P95_BUDGET_MS ? "keep the blur" : "drop the blur";
        const table = passes.map(
            (p) => `#${p.n} ${p.blur ? "blur" : "none"}: p95 ${p.p95} ms, worst ${p.worst} ms, p50 ${p.p50} ms, ${p.over20} over 20 ms, ${p.frames} frames${toggle ? `, ${p.flips} flips` : ""}`
        );
        console.log(`${NAME} ${label}: ${table.join(" | ")}`);
        console.log(`${NAME} ${label}: median p95 blur ${blurred} ms, none ${plain} ms, difference ${delta} ms (budget ${P95_BUDGET_MS} ms): ${decision.toUpperCase()}`);
        return { bad, table, blurred, plain, delta, decision };
    }

    const scenario = {
        name: NAME,
        surface: "agent",
        async arrange(h) {
            const ctx = { dir: null };
            // only when named: a run of every scenario would spend two minutes on it
            if (!process.argv.slice(2).includes(NAME)) {
                ctx.skip = `a measurement, run only when named: node scripts/cdp/final-verify.mjs ${NAME}`;
                return ctx;
            }
            let at = "writing the flood";
            try {
                ctx.dir = mkdtempSync(join(tmpdir(), "verify-of-frames-"));
                ctx.flood = join(ctx.dir, "flood.mjs");
                writeFileSync(ctx.flood, FLOOD_SRC);
                at = "resetting the grid";
                ctx.prev = { [GRID_KEY]: await h.ev(`localStorage.getItem(${JSON.stringify(GRID_KEY)})`) };
                await h.ev(`localStorage.setItem(${JSON.stringify(GRID_KEY)}, ${JSON.stringify(JSON.stringify(GRID_EMPTY))})`);
                if (!(await ahReload(h))) throw new Error("the page did not come back after the reload");
                await h.goto("agent");
            } catch (e) {
                ctx.arrangeError = `${at}: ${String(e?.message ?? e)}`;
            }
            return ctx;
        },

        async assert(h, ctx) {
            if (ctx.skip) return [skipStep("frost frame timing", ctx.skip)];
            const steps = [];
            const rec = (step, ok, detail) => steps.push({ step, ok: ok === true, detail: typeof detail === "string" ? detail : JSON.stringify(detail) });
            if (ctx.arrangeError != null) {
                rec("0. the flood script", false, ctx.arrangeError);
                return steps;
            }
            let at = "making the flood tab";
            try {
                await h.cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
                ctx.tab = await makeTab(h, ctx, { label: FLOOD_LABEL, blockMeta: { view: "term" } });
                const meta = { view: "term", controller: "cmd", cmd: `node '${ctx.flood}' ${FLOOD_KBPS} ${FLOOD_SECS}`, "cmd:cwd": "~" };
                await h.rpc("setmeta", { oref: `block:${ctx.tab.blockId}`, meta });
                at = "showing the flood terminal";
                await AC.setRoster(h, [floodRow(ctx)]);
                await AC.focusAgent(h, ctx.tab.tabId);
                await setMode(h, ctx.tab.tabId, "terminal");
                const term = screenOf(ctx.tab.tabId);
                if (!(await polishWaitFor(h, `(() => { const e = ${term}; const r = e?.getBoundingClientRect(); return !!r && r.width > 200 && r.height > 200 && getComputedStyle(e).visibility !== "hidden"; })()`, WAIT_MS))) {
                    throw new Error("the flood terminal did not mount and show");
                }
                await h.rpc("controllerresync", { tabid: ctx.tab.tabId, blockid: ctx.tab.blockId, rtopts: { termsize: TERM_SIZE } });
            } catch (e) {
                rec("1. the flood terminal", false, `${at}: ${String(e?.message ?? e)}`);
                return steps;
            }
            const screen = await h.ev(`(() => { const r = ${screenOf(ctx.tab.tabId)}?.getBoundingClientRect(); return r ? { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) } : null; })()`);
            const live = screen != null && (await floodLive(h, screen));
            rec("1. a flood terminal streams on the Agent surface", live, { live, screen });
            if (!live) return steps;

            // 2. the find bar, over the streaming terminal
            const run = async (name, fn) => {
                try {
                    await fn(name);
                } catch (e) {
                    rec(name, false, `the step threw: ${String(e?.message ?? e)}`);
                }
            };
            await run("2. find bar", async (name) => {
                await AC.agentPage(h, `const T = await mod("app/view/term/termsearch.ts"); T.requestTermSearch(${JSON.stringify(ctx.tab.blockId)}); return true;`);
                const up = await polishWaitFor(h, `!!document.querySelector(${JSON.stringify(SEARCH)})`, WAIT_MS);
                // the bar places itself against its pane a frame after it opens
                await polishNap(400);
                const geo = await h.ev(OVERLAP(SEARCH, ctx.tab.tabId));
                if (!up) return rec(`${name}: the find bar opens over the flood`, false, { up, ...geo });
                const m = await measure(h, "find-bar", SEARCH, false);
                await key(h, KEYS.escape);
                await polishWaitFor(h, `!document.querySelector(${JSON.stringify(SEARCH)})`, SHORT_MS);
                rec(
                    `${name}: frame timing with the find bar open over the flood, ${PASSES} passes blurred and ${PASSES} not, alternating; ${m.decision}`,
                    m.bad == null,
                    m.bad == null
                        ? { overlap: geo.overlap, passes: m.table, medianP95: { blur: m.blurred, none: m.plain }, differenceMs: m.delta, budgetMs: P95_BUDGET_MS, decision: m.decision }
                        : { failedPass: m.bad, passes: m.table }
                );
            });

            // 3. the pet peek, its drawer flipping, over the streaming terminal
            await run("3. pet peek", async (name) => {
                const creature = await polishWaitFor(h, `!!document.querySelector(${JSON.stringify(CREATURE)})`, SHORT_MS);
                if (!creature) return rec(`${name}: the pet's peek opens`, false, "no Jarvis creature on the Agent surface");
                await AC.agentPage(
                    h,
                    `const P = await mod("app/view/jarvis/petstore.ts");
                    const now = Date.now();
                    for (let i = 0; i < ${UPDATES}; i++) {
                        P.rememberSaid({ id: "of-frames-" + i, at: now - i * 60000, kind: "notify", level: "info", text: "overlays frost frames: update " + (i + 1), detail: "Finished the sync retry change; 3 files touched." });
                    }
                    return true;`
                );
                await h.ev(`document.querySelector(${JSON.stringify(CREATURE)})?.click()`);
                const up = await polishWaitFor(h, `!!document.querySelector("[data-pet-peek]")`, SHORT_MS);
                const drawer = up && (await polishWaitFor(h, `!!document.querySelector(${JSON.stringify(DRAWER_TOGGLE)})`, SHORT_MS));
                await polishNap(SETTLE_MS);
                // The peek opens by the pet's corner, mostly over the side panel, not the terminal. The measurement is the
                // worst case, a blur over streaming output, so its floating wrapper is moved over the screen's middle with
                // the CSS translate property, which floating-ui's transform (re-applied on every resize) leaves alone and
                // which makes no backdrop root.
                await h.ev(`(() => {
                    const p = document.querySelector(${JSON.stringify(PEEK)});
                    const w = p?.parentElement;
                    const x = ${screenOf(ctx.tab.tabId)}?.getBoundingClientRect();
                    if (!p || !w || !x) return false;
                    const r = p.getBoundingClientRect();
                    w.style.translate = Math.round(x.left + x.width / 2 - (r.left + r.width / 2)) + "px " + Math.round(x.top + 40 - r.top) + "px";
                    return true;
                })()`);
                await polishNap(SETTLE_MS);
                const geo = await h.ev(OVERLAP(PEEK, ctx.tab.tabId));
                // the drawer opened once, to show the peek changes size with it
                const shut = await h.ev(`document.querySelector(${JSON.stringify(PEEK)})?.getBoundingClientRect().height ?? null`);
                await h.ev(`document.querySelector(${JSON.stringify(DRAWER_TOGGLE)})?.click()`);
                await polishNap(800);
                const opened = await h.ev(`document.querySelector(${JSON.stringify(PEEK)})?.getBoundingClientRect().height ?? null`);
                await shot(h, "peek-drawer-open");
                await h.ev(`document.querySelector(${JSON.stringify(DRAWER_TOGGLE)})?.click()`);
                await polishNap(800);
                const grows = shut != null && opened != null && opened - shut > 20;
                if (!(up && drawer && grows)) {
                    return rec(`${name}: the peek opens with its drawer, and the drawer changes its size`, false, { up, drawer, shut, opened, ...geo });
                }
                const m = await measure(h, "pet-peek", PEEK, true);
                rec(
                    `${name}: frame timing with the peek's drawer flipping every ${TOGGLE_MS} ms over the flood, ${PASSES} passes blurred and ${PASSES} not, alternating; ${m.decision}`,
                    m.bad == null,
                    m.bad == null
                        ? { overlap: geo.overlap, heights: { shut: Math.round(shut), open: Math.round(opened) }, passes: m.table, medianP95: { blur: m.blurred, none: m.plain }, differenceMs: m.delta, budgetMs: P95_BUDGET_MS, decision: m.decision }
                        : { failedPass: m.bad, passes: m.table }
                );
            });
            return steps;
        },

        async teardown(h, ctx) {
            if (ctx.skip) return;
            await teardownStep("stop the recorder", () =>
                h.ev(`(() => { const f = window.__offFrames; if (f) { f.on = false; clearInterval(f.timer); } delete window.__offFrames; return true; })()`)
            );
            await teardownStep("close the peek", () => AC.agentPage(h, `const P = await mod("app/view/jarvis/petstore.ts"); globalStore.set(P.petPeekOpenAtom, false); return true;`));
            await teardownStep("forget the updates", () =>
                AC.agentPage(h, `const P = await mod("app/view/jarvis/petstore.ts"); globalStore.set(P.petSaidAtom, globalStore.get(P.petSaidAtom).filter((e) => !String(e.id).startsWith("of-frames-"))); return true;`)
            );
            await teardownStep("restore the roster", () => AC.restoreRoster(h));
            if (ctx.tab) await teardownStep("drop the stored chat mode", () => setMode(h, ctx.tab.tabId, "chat"));
            await teardownStep("close the flood tab", () => closeTabs(h, ctx));
            await teardownStep("restore the keys", () => restoreKeys(h, ctx.prev));
            await teardownStep("reload", () => ahReload(h));
            if (ctx.dir) await teardownStep(`remove ${ctx.dir}`, () => rmSync(ctx.dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 }));
            await teardownStep("go home", () => h.goto("cockpit"));
        },
    };

    return [scenario];
}
