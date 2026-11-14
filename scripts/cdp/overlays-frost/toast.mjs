// overlays-frost-toast: the toast's committed fill draws (frost, or solid if the measurement kept it solid), and
// overlays-frost-toast-timing, the one-off frame-time measurement behind that choice (Final does not run it).
// docs/superpowers/specs/2026-11-14-overlays-chat-look-design.md section 4 (the plan's Task 8).
//
// THE MEASUREMENT (overlays-frost-toast-timing). A toast is a backdrop-filter over whatever the app paints under the stack
// in the bottom-right corner, so the worst case is a terminal streaming output there. The scenario floods a terminal tab
// shown on the Agent surface (termflood.mjs's BuildKit-style redraw, 180 KB/s: the 2026-10-14 incident's load), raises one
// toast over it and records `requestAnimationFrame` intervals for 3 passes with the toast forced frosted (its panel
// carries `frost`) and 3 forced solid (`bg-surface`), alternating so drift on a shared machine lands on both. Each pass is
// PASS_MS long after SETTLE_MS for the swap to repaint. Rule: the frost is kept when the median frosted p95 is within
// P95_BUDGET_MS of the median solid p95. It runs only when named (`node scripts/cdp/final-verify.mjs
// overlays-frost-toast-timing`); a run of every scenario skips it, and Final names the others.
//
// The toast stack is fixed bottom-right, which in the default layout is over the inspector panel, not the terminal; the
// scenario moves the stack (inline right/bottom) until the toast sits wholly over the flood, so it measures the worst case,
// a blur over streaming output. The terminal is switched from Chat to its Terminal view first (the centre opens on Chat,
// which covers it).
//
//   MEASURED 2026-11-14, on 7f0af8af7 (the wip(t-8) commit; Task 8's own scenario edits uncommitted, the toast components
//   still on bg-surface, the swap forced from the scenario), dev app on the Windows WebView2 host, 1600x950 viewport
//   (verify.mjs's pin), frames at a 13.3 ms p50, flood 180 KB/s, toast wholly over the terminal screen (overlap 1.0),
//   5 s per pass:
//     pass  fill   p95      worst     p50      frames
//     #1    frost  13.5 ms  53.3 ms   13.3 ms  369
//     #2    solid  13.5 ms  13.7 ms   13.3 ms  375
//     #3    frost  13.5 ms  13.5 ms   13.3 ms  375
//     #4    solid  13.4 ms  26.6 ms   13.3 ms  374
//     #5    frost  13.5 ms  13.6 ms   13.3 ms  374
//     #6    solid  13.4 ms  13.5 ms   13.3 ms  374
//   Median p95: frosted 13.5 ms, solid 13.4 ms, difference 0.1 ms (budget 2 ms). DECISION: FROST. Each fill has one pass
//   with a slow single frame (frosted #1 53.3 ms, solid #4 26.6 ms) that leaves its p95 untouched; the other four passes'
//   worst frames are 13.5-13.7 ms. Re-run it when a toast gains a second blurred layer or the terminal renderer changes.
//
// THE COMMITTED FILL (overlays-frost-toast). Over a working agent it raises the cockpit's toast stack (an agent
// notification, then an error and a warn on top of it, so each level's panel is checked) and the Jarvis Brief's own toast
// (brieftoast.tsx), screenshots each, and runs the fill's verdict on the panel: frostVerdict if FILL is "frost",
// solidVerdict if the measurement kept the toast solid. It does not re-measure.
//
// The cockpit toast's panel is the motion.div parent of [data-notification-toast] (the button inside carries no fill);
// the Brief toast's is the [data-jarvis-brief-toast] element itself. kit is scenarios.mjs's CR_KIT (+ scenario(name),
// unused here).

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as AC from "../agent-page-fixtures.mjs";
import { FROST_BLUR, frostProbe, frostVerdict, solidVerdict } from "./frostcheck.mjs";

// the committed fill: "frost" (the panel carries the frost class) or "solid" (it keeps bg-surface)
const FILL = "frost";
const fillVerdict = FILL === "frost" ? frostVerdict : solidVerdict;
const FILL_WORDS =
    FILL === "frost"
        ? "draws blur(18px) over --color-panel with no backdrop root above it"
        : "keeps a solid fill with no blur";

const NAME = "overlays frost toast";
const FLOOD_LABEL = "overlays-frost-toast-flood";
const TIMING = "overlays-frost-toast-timing";
const WAIT_MS = 15000;
const SHORT_MS = 5000;

// the timing run
const PASSES = 3; // per fill
const PASS_MS = 5000;
const SETTLE_MS = 600;
const P95_BUDGET_MS = 2;
const MIN_FRAMES = 100;
const FLOOD_KBPS = 180;
// longer than the six passes need (~34 s) plus the tab's startup; closing the tab ends it sooner
const FLOOD_SECS = 120;
const TERM_SIZE = { rows: 30, cols: 120 };
// a toast that outlives the whole run: the clock never dismisses it
const LONG_TTL_MS = 600_000;

// termflood.mjs's FLOOD_SRC: BuildKit redraws its step list in place, cursor up over the block, clear each line, rewrite it
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

// the cockpit toast stack: its panels are the stack's children (a toast's button sits one level inside)
const STACK = `[data-pet-avoid][role="status"]`;
const PANEL = (i) => `${STACK} > div:nth-child(${i})`;
// the Brief's toast is its own panel
const BRIEF = "[data-jarvis-brief-toast]";

// an agent notification, the common toast, then the two other levels the stack draws
const TOASTS = [
    {
        title: "verify-of-toast",
        message: "Finished the sync retry change; 3 files touched.",
        level: "info",
        eyebrow: { label: "Finished", tone: "done", icon: "done", meta: "verify-of-toast", runtime: "claude" },
        ttlMs: LONG_TTL_MS,
    },
    { title: "Kill shell task", message: "Not killed: the task had already exited.", level: "error", ttlMs: LONG_TTL_MS },
    { title: "Not a design canvas board: docs/notes.html", message: "", level: "warn", ttlMs: LONG_TTL_MS },
];
const BRIEF_TEXT = "Archived effort · sync retry policy";

// a panel's fade has ended: a toast's entrance animates opacity to 1
const FADED_IN = (sel) => `Number(getComputedStyle(document.querySelector(${JSON.stringify(sel)})).opacity) === 1`;

const skipStep = (step, detail) => ({ step, skip: true, detail });

const median = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const round = (v) => (v == null ? v : Math.round(v * 10) / 10);

export default function (kit) {
    const { waveService, polishWaitFor, polishNap, ahReload, GRID_KEY, GRID_EMPTY } = kit;
    const { makeTab, closeTabs } = AC.tabFixtures({ waveService });

    async function shot(h, name) {
        try {
            await h.shot(`cdp-shots/overlays-frost-toast-${name}.png`);
        } catch (e) {
            console.error(`overlays-frost-toast: the shot ${name} failed: ${e?.message ?? e}`);
        }
    }
    const teardownStep = (label) => async (what, fn) => {
        try {
            await fn();
        } catch (e) {
            console.error(`${label} teardown: ${what} failed: ${e?.message ?? e}`);
        }
    };
    const clearToasts = (h) =>
        AC.agentPage(
            h,
            `const N = await mod("app/cockpit/notificationstore.ts");
            for (const t of globalStore.get(N.toastsAtom)) N.dismissToast(t.id);
            const B = await mod("app/view/jarvis/briefundo.ts").catch(() => null);
            if (B) globalStore.set(B.briefToastAtom, null);
            return true;`
        );
    const restoreKeys = (h, prev) =>
        h.ev(`(() => {
            for (const [k, v] of Object.entries(${JSON.stringify(prev ?? {})})) {
                if (v == null) localStorage.removeItem(k);
                else localStorage.setItem(k, v);
            }
            return true;
        })()`);
    // an empty grid, so the tab made here is shown alone, and the page reloaded onto it
    async function emptyGrid(h, ctx) {
        ctx.prev = { [GRID_KEY]: await h.ev(`localStorage.getItem(${JSON.stringify(GRID_KEY)})`) };
        await h.ev(`localStorage.setItem(${JSON.stringify(GRID_KEY)}, ${JSON.stringify(JSON.stringify(GRID_EMPTY))})`);
        if (!(await ahReload(h))) throw new Error("the page did not come back after the reload");
    }

    // --- overlays-frost-toast: the committed fill draws ----------------------------------------------------------------

    // the roster row of the one agent, working: what is under the toast
    const roster = (ctx) => [
        {
            project: NAME,
            task: "",
            agent: "claude",
            model: "opus",
            state: "working",
            activity: "Reading retry.ts",
            activeMs: 30_000,
            usage: { contextpct: 42 },
            id: ctx.tab.tabId,
            name: NAME,
            blockId: ctx.tab.blockId,
            transcriptPath: ctx.transcript,
        },
    ];

    const drawn = {
        name: "overlays-frost-toast",
        surface: "agent",
        async arrange(h) {
            const ctx = { dir: mkdtempSync(join(tmpdir(), "verify-of-toast-")) };
            let at = "resetting the grid";
            try {
                await emptyGrid(h, ctx);
                at = "writing the transcript";
                const base = Date.now() - 600_000;
                const o = (sec) => ({ cwd: ctx.dir, ts: new Date(base + sec * 1000).toISOString() });
                const lines = [];
                for (let i = 0; i < 4; i++) {
                    lines.push(AC.userText(`question ${i}: how does part ${i} of the sync client work?`, o(i * 10)));
                    lines.push(AC.assistantText(`Reply ${i}. The sync client retries a failed request and logs what it sent.`, o(i * 10 + 2)));
                }
                lines.push(AC.userText("make the sync client retry a failed request", o(100)));
                ctx.transcript = AC.writeTranscript(ctx.dir, "overlays-frost-toast", lines);
                await h.goto("agent");
                at = "making the tab";
                ctx.tab = await makeTab(h, ctx, { label: NAME, blockMeta: { view: "term" } });
                at = "setting the roster";
                await AC.setRoster(h, roster(ctx));
            } catch (e) {
                ctx.arrangeError = `${at}: ${String(e?.message ?? e)}`;
            }
            return ctx;
        },

        async assert(h, ctx) {
            const steps = [];
            const rec = (step, ok, detail) => steps.push({ step, ok: ok === true, detail: typeof detail === "string" ? detail : JSON.stringify(detail) });
            if (ctx.arrangeError != null) {
                rec("0. the fixture agent and its roster row", false, ctx.arrangeError);
                return steps;
            }
            // a step that throws is a failed step, not the end of the run
            const run = async (name, fn) => {
                try {
                    await fn(name);
                } catch (e) {
                    rec(name, false, `the step threw: ${String(e?.message ?? e)}`);
                }
            };
            const verdict = async (selector) => {
                const r = await h.ev(frostProbe(selector));
                return { ...fillVerdict(r), r };
            };
            const push = (t) => AC.agentPage(h, `const N = await mod("app/cockpit/notificationstore.ts"); N.pushToast(${JSON.stringify(t)}); return true;`);
            await h.cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
            await AC.focusAgent(h, ctx.tab.tabId);
            await polishNap(800);
            await clearToasts(h);

            // 1. an agent notification over the working agent
            await run("1. agent notification", async (name) => {
                await push(TOASTS[0]);
                const up = await polishWaitFor(h, `!!document.querySelector(${JSON.stringify(PANEL(1))}) && ${FADED_IN(PANEL(1))}`, SHORT_MS);
                await polishNap(250);
                const v = await verdict(PANEL(1));
                const holds = await h.ev(`document.querySelector(${JSON.stringify(PANEL(1))})?.querySelector("[data-notification-toast]")?.textContent.includes(${JSON.stringify(TOASTS[0].message)}) === true`);
                await shot(h, "1-agent-notification");
                rec(`${name}: a finished-turn toast rises over the working agent; its panel ${FILL_WORDS}`, up && holds && v.ok, { holds, ...v });
            });

            // 2. an error and a warn on top: the stack, each level's panel
            await run("2. stack of three", async (name) => {
                await push(TOASTS[1]);
                await push(TOASTS[2]);
                const up = await polishWaitFor(h, `document.querySelectorAll(${JSON.stringify(`${STACK} > div`)}).length === 3 && ${FADED_IN(PANEL(3))}`, SHORT_MS);
                await polishNap(250);
                const per = [];
                for (const i of [1, 2, 3]) per.push({ i, ...(await verdict(PANEL(i))) });
                await shot(h, "2-stack");
                rec(
                    `${name}: with an error and a warn above it the three panels stack, and each ${FILL_WORDS.replace("draws", "draws")}`,
                    up && per.every((p) => p.ok),
                    per.map((p) => ({ i: p.i, ok: p.ok, detail: p.detail }))
                );
            });

            // 3. the Brief's own toast (brieftoast.tsx), over the Jarvis surface
            await run("3. brief toast", async (name) => {
                await clearToasts(h);
                await h.goto("jarvis");
                await AC.agentPage(
                    h,
                    `const B = await mod("app/view/jarvis/briefundo.ts");
                    globalStore.set(B.briefToastAtom, { id: Date.now(), text: ${JSON.stringify(BRIEF_TEXT)}, undo: () => {} });
                    return true;`
                );
                const up = await polishWaitFor(h, `!!document.querySelector(${JSON.stringify(BRIEF)}) && ${FADED_IN(BRIEF)}`, WAIT_MS);
                await polishNap(250);
                const v = await verdict(BRIEF);
                const holds = await h.ev(`(document.querySelector(${JSON.stringify(BRIEF)})?.textContent ?? "").includes(${JSON.stringify(BRIEF_TEXT)})`);
                await shot(h, "3-brief-toast");
                rec(`${name}: the Brief's toast rises bottom-centre over the Jarvis surface with its Undo; its panel ${FILL_WORDS}`, up && holds && v.ok, { holds, ...v });
            });

            return steps;
        },

        async teardown(h, ctx) {
            const step = teardownStep("overlays-frost-toast");
            await step("clear the toasts", () => clearToasts(h));
            await step("restore the roster", () => AC.restoreRoster(h));
            await step("close the fixture tab", () => closeTabs(h, ctx));
            await step("restore the keys", () => restoreKeys(h, ctx.prev));
            await step("reload onto the live roster", () => ahReload(h));
            if (ctx.dir) await step(`remove ${ctx.dir}`, () => rmSync(ctx.dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 }));
            await step("go home", () => h.goto("cockpit"));
        },
    };

    // --- overlays-frost-toast-timing: the one-off measurement ----------------------------------------------------------

    // the swap the passes force on the toast's panel; the computed style read back says it took
    const FORCE = (fill) => `(() => {
        const p = document.querySelector(${JSON.stringify(PANEL(1))});
        if (!p) return null;
        if (${fill === "frost"}) { p.classList.remove("bg-surface"); p.classList.add("frost"); }
        else { p.classList.remove("frost"); p.classList.add("bg-surface"); }
        const cs = getComputedStyle(p);
        return { backdropFilter: cs.backdropFilter || cs.webkitBackdropFilter || "none", background: cs.backgroundColor };
    })()`;
    const FRAMES_START = `(() => {
        const f = (window.__ofFrames = { on: true, last: 0, deltas: [] });
        const tick = (t) => {
            if (!f.on) return;
            if (f.last) f.deltas.push(t - f.last);
            f.last = t;
            requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        return true;
    })()`;
    const FRAMES_STOP = `(() => {
        const f = window.__ofFrames;
        if (!f) return null;
        f.on = false;
        delete window.__ofFrames;
        const d = [...f.deltas].sort((a, b) => a - b);
        if (d.length === 0) return null;
        const at = (q) => d[Math.min(d.length - 1, Math.ceil(q * d.length) - 1)];
        return { frames: d.length, p50: at(0.5), p95: at(0.95), worst: d[d.length - 1] };
    })()`;

    // Chat or Terminal for one agent (chatmodestore.ts); "chat" drops the stored entry again
    const setMode = (h, tabId, mode) =>
        AC.agentPage(
            h,
            `const { setChatMode } = await mod("app/view/agents/chatmodestore.ts");
            setChatMode(${JSON.stringify(tabId)}, ${JSON.stringify(mode)});
            return true;`
        );

    // the roster row of the agent whose terminal floods
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

    // the toast and the terminal's screen, for the overlap the passes need
    const GEOMETRY = (tabId) => `(() => {
        const t = document.querySelector(${JSON.stringify(PANEL(1))})?.getBoundingClientRect();
        const x = document.querySelector('[data-agent-terminal="${tabId}"] .xterm-screen')?.getBoundingClientRect();
        if (!t || !x) return { toast: !!t, screen: !!x };
        const w = Math.max(0, Math.min(t.right, x.right) - Math.max(t.left, x.left));
        const h = Math.max(0, Math.min(t.bottom, x.bottom) - Math.max(t.top, x.top));
        const r = (b) => ({ x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) });
        return { toast: r(t), screen: r(x), overlap: t.width * t.height > 0 ? (w * h) / (t.width * t.height) : 0 };
    })()`;

    // a clip of the terminal's screen well left of the toast, captured twice: the flood redraws it every 50 ms
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

    const timing = {
        name: TIMING,
        surface: "agent",
        async arrange(h) {
            const ctx = { dir: null };
            // only when named: a run of every scenario would spend two minutes on it
            if (!process.argv.slice(2).includes(TIMING)) {
                ctx.skip = `a measurement, run only when named: node scripts/cdp/final-verify.mjs ${TIMING}`;
                return ctx;
            }
            let at = "writing the flood";
            try {
                ctx.dir = mkdtempSync(join(tmpdir(), "verify-of-toast-timing-"));
                ctx.flood = join(ctx.dir, "flood.mjs");
                writeFileSync(ctx.flood, FLOOD_SRC);
                at = "resetting the grid";
                await emptyGrid(h, ctx);
                await h.goto("agent");
            } catch (e) {
                ctx.arrangeError = `${at}: ${String(e?.message ?? e)}`;
            }
            return ctx;
        },

        async assert(h, ctx) {
            if (ctx.skip) return [skipStep("toast frame timing", ctx.skip)];
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
                // an agent whose block runs the flood, on the Agent surface: the streaming agent terminal the toast sits over.
                // The tab is made as an agent (makeTab stamps session:agent), so it is a roster row, not a tree terminal.
                await AC.setRoster(h, [floodRow(ctx)]);
                await AC.focusAgent(h, ctx.tab.tabId);
                // the centre opens on Chat, which covers the terminal: show the terminal itself
                await setMode(h, ctx.tab.tabId, "terminal");
                const term = `document.querySelector('[data-agent-terminal="${ctx.tab.tabId}"] .xterm-screen')`;
                if (!(await polishWaitFor(h, `(() => { const e = ${term}; const r = e?.getBoundingClientRect(); return !!r && r.width > 200 && r.height > 200 && getComputedStyle(e).visibility !== "hidden"; })()`, WAIT_MS))) {
                    throw new Error("the flood terminal did not mount and show");
                }
                // a mounted view starts its own process; the resync gives it the size the flood is drawn for
                await h.rpc("controllerresync", { tabid: ctx.tab.tabId, blockid: ctx.tab.blockId, rtopts: { termsize: TERM_SIZE } });
                at = "moving the toast stack over the terminal";
                // The stack is fixed bottom-right, which in the default layout is over the inspector panel, not the terminal. The
                // measurement is the worst case, a blur over streaming output, so the stack is moved (inline right/bottom, 16px in
                // from the screen's corner) until the toast sits wholly over the flood. Where it sits changes no cost per pixel.
                const moved = await h.ev(`(() => {
                    const s = document.querySelector(${JSON.stringify(STACK)});
                    const r = ${term}?.getBoundingClientRect();
                    if (!s || !r) return false;
                    s.style.right = Math.round(innerWidth - r.right + 16) + "px";
                    s.style.bottom = Math.round(innerHeight - r.bottom + 16) + "px";
                    return true;
                })()`);
                if (!moved) throw new Error("the toast stack or the terminal screen was not found");
                at = "raising the toast";
                await clearToasts(h);
                await AC.agentPage(h, `const N = await mod("app/cockpit/notificationstore.ts"); N.pushToast(${JSON.stringify(TOASTS[0])}); return true;`);
                if (!(await polishWaitFor(h, `!!document.querySelector(${JSON.stringify(PANEL(1))}) && ${FADED_IN(PANEL(1))}`, SHORT_MS))) {
                    throw new Error("the toast did not rise");
                }
            } catch (e) {
                rec("1. the flood terminal and the toast", false, `${at}: ${String(e?.message ?? e)}`);
                return steps;
            }

            // 1. the toast sits over the streaming terminal
            const geo = await h.ev(GEOMETRY(ctx.tab.tabId));
            const live = geo.screen && typeof geo.screen === "object" ? await floodLive(h, geo.screen) : false;
            await shot(h, "timing-1-flood");
            rec(
                "1. a flood terminal streams on the Agent surface and the toast sits over its screen",
                live && geo.overlap > 0.5,
                { live, ...geo }
            );
            if (!(live && geo.overlap > 0.5)) return steps;

            // 2. six passes, alternating: frosted then solid, three each
            const passes = [];
            let bad = null;
            for (let n = 0; n < PASSES * 2 && bad == null; n++) {
                const fill = n % 2 === 0 ? "frost" : "solid";
                const forced = await h.ev(FORCE(fill));
                const took = forced != null && (fill === "frost" ? forced.backdropFilter === FROST_BLUR : forced.backdropFilter === "none");
                await polishNap(SETTLE_MS);
                await h.ev(FRAMES_START);
                await polishNap(PASS_MS);
                const s = await h.ev(FRAMES_STOP);
                if (n < 2) await shot(h, `timing-2-${fill}`);
                const pass = { n: n + 1, fill, took, backdropFilter: forced?.backdropFilter ?? null, frames: s?.frames ?? 0, p50: round(s?.p50), p95: round(s?.p95), worst: round(s?.worst) };
                passes.push(pass);
                if (!took || s == null || s.frames < MIN_FRAMES) bad = pass;
            }
            const of = (fill, key) => passes.filter((p) => p.fill === fill).map((p) => p[key]);
            const frosted = round(median(of("frost", "p95")));
            const solid = round(median(of("solid", "p95")));
            const delta = round(frosted - solid);
            const decision = delta <= P95_BUDGET_MS ? "frost" : "solid";
            const table = passes.map((p) => `#${p.n} ${p.fill}: p95 ${p.p95} ms, worst ${p.worst} ms, p50 ${p.p50} ms, ${p.frames} frames`);
            // the numbers in the log, where the run's reader finds them without opening the detail
            console.log(`${TIMING}: ${table.join(" | ")}`);
            console.log(`${TIMING}: median p95 frosted ${frosted} ms, solid ${solid} ms, difference ${delta} ms (budget ${P95_BUDGET_MS} ms): DECISION ${decision.toUpperCase()}`);
            rec(
                `2. frame timing under the flood: ${PASSES} passes with the toast forced frosted, ${PASSES} forced solid, alternating; the decision is ${decision}`,
                bad == null,
                bad == null
                    ? { passes: table, medianP95: { frosted, solid }, differenceMs: delta, budgetMs: P95_BUDGET_MS, decision }
                    : { failedPass: bad, passes: table, why: `pass #${bad.n} (${bad.fill}) ${!bad.took ? `did not force the fill (backdrop-filter ${bad.backdropFilter})` : `recorded ${bad.frames} frames, under ${MIN_FRAMES}`}` }
            );
            return steps;
        },

        async teardown(h, ctx) {
            if (ctx.skip) return;
            const step = teardownStep(TIMING);
            await step("stop the recorder", () => h.ev(`(() => { if (window.__ofFrames) window.__ofFrames.on = false; delete window.__ofFrames; return true; })()`));
            await step("clear the toasts", () => clearToasts(h));
            await step("restore the roster", () => AC.restoreRoster(h));
            if (ctx.tab) await step("drop the stored chat mode", () => setMode(h, ctx.tab.tabId, "chat"));
            await step("close the flood tab", () => closeTabs(h, ctx));
            await step("restore the keys", () => restoreKeys(h, ctx.prev));
            await step("reload", () => ahReload(h));
            if (ctx.dir) await step(`remove ${ctx.dir}`, () => rmSync(ctx.dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 }));
            await step("go home", () => h.goto("cockpit"));
        },
    };

    return [drawn, timing];
}
