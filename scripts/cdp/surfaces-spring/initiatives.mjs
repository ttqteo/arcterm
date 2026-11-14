// surfaces-spring-initiatives: Jarvis's initiatives, runs and detail sheets on the spring (Task 5 of
// docs/superpowers/plans/2026-11-15-surfaces-chat-look.md; spec docs/superpowers/specs/2026-11-14-surfaces-chat-look-design.md).
// A spring is judged by where an element is on the frames between two states (springprobe.mjs), so every step samples the
// element it is about, triggers the change, and asks whether some frame was strictly between where it started and where it
// ended. kit is scenarios.mjs's SS_KIT.
//
// One run, three fixtures made in arrange and opened in turn: the initiative sheet's own initiative (jarvis-initiative-sheet:
// two stages, a proposed chunk and a sub-initiative), the chunk sheet's (jarvis-chunk-sheet: a chunk with a trail, here with
// one long note), and a deferred run whose stored Final holds one passing scenario with steps.
//   1. a chunk added to an initiative's plan opens its row's height on the spring, one copy of it at every frame
//   2. a long note's "Show all" opens the block's height on the spring, and "Show less" folds it the same way
//   3. the final shots viewer's Steps drawer opens its width on the spring
//   4. a Jarvis detail sheet slides in: its x is between the 24px it starts from and its place at an early sample
// Each step ends on a screenshot. The shots are 1x1 PNGs: the viewer is judged on its drawer, not on what it shows.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { waitFor } from "../attach.mjs";
import { between, readSampler, singleCopy, startSampler } from "./springprobe.mjs";

const q = JSON.stringify;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ADDED = "Spring scenario chunk";
const TRAIL = "Trail chunk";
const LONG_NOTE = Array.from({ length: 9 }, (_, i) => `line ${i + 1} of a long note, well past the four lines the trail shows`).join("\n");

const SHEET = '[data-jarvis-brief-sheet="effort"]';
const PLAN = `${SHEET} [data-jarvis-initiative-detail="sheet"]`;
const CHUNK_VIEW = `${SHEET} [data-jarvis-chunk-view]`;
// ModalShell's sheet panel: briefsheet.tsx puts one wrapper div between it and the sheet's aside
const SHEET_PANEL = `[role="dialog"][aria-modal="true"]:has([data-jarvis-brief-sheet="effort"])`;
const DOCK = `[data-run-sheet] [data-run-sheet-final-shots-dock]`;
const VIEWER = `[data-final-shots-viewer]`;
const STEPS_BUTTON = `${VIEWER} button[aria-expanded]`;
const DRAWER = `${VIEWER} [data-final-shots-steps]`;

// a valid 1x1 PNG, so the viewer has a shot to draw
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const SHOT = "alpha";
const FINAL_STEPS = [
    { step: "1. the Brief is showing", state: "pass", detail: "ok" },
    { step: "2. the sheet opened on the run", state: "pass" },
    { step: "3. the viewer drew its drawer", state: "pass" },
];

const until = (h, expr, ms = 10_000) => waitFor((e) => h.ev(e), expr, ms);

// a real key through CDP, as the sheet scenarios press one
async function press(h, key, { code = key, vk = 0 } = {}) {
    for (const type of ["keyDown", "keyUp"]) {
        await h.cdp("Input.dispatchKeyEvent", { type, key, code, windowsVirtualKeyCode: vk });
    }
}

// a DOM key at the focused element, which the keybinding dispatcher and the modal stack hear on the window
const domKey = (h, key) =>
    h.ev(`(() => {
        const init = { key: ${q(key)}, code: ${q(key)}, bubbles: true, cancelable: true };
        (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent("keydown", init));
        return true;
    })()`);

// An element a change mounts is absent on the first frame, and `between` needs the first one to hold it: drop the frames
// before it appeared.
const present = (samples) => {
    const at = samples.findIndex((s) => s.rect != null);
    return at < 0 ? [] : samples.slice(at);
};

// samples `selector` from just before `trigger` runs until `ms` have passed
async function sampled(h, selector, trigger, ms = 900) {
    await h.ev(startSampler(selector, { ms }));
    await trigger();
    return present(await h.ev(readSampler()));
}

const extent = (samples, key) => {
    const v = samples.map((s) => s.rect?.[key]).filter((x) => x !== undefined);
    return v.length === 0 ? "no frames" : `${v[0]} -> ${v[v.length - 1]} over ${v.length} frames`;
};

const click = (h, expr) => h.ev(`(() => { const el = ${expr}; if (!el) return false; el.click(); return true; })()`);

export default (kit) => [
    {
        name: "surfaces-spring-initiatives",
        surface: "jarvis",
        async arrange(h) {
            const ctx = {};
            const sheet = kit.scenario("jarvis-initiative-sheet");
            const chunk = kit.scenario("jarvis-chunk-sheet");
            ctx.sheet = await sheet.arrange(h);
            ctx.chunk = await chunk.arrange(h);
            const failed = ctx.sheet.arrangeError ?? ctx.chunk.arrangeError;
            if (failed != null) {
                ctx.arrangeError = failed;
                return ctx;
            }
            try {
                // one long note on the chunk that has a trail, the newest of its entries
                await sleep(60);
                await h.rpc("effortmutate", {
                    effortoid: ctx.chunk.oid,
                    author: "you",
                    ops: [{ op: "appendNote", chunk: TRAIL, note: LONG_NOTE }],
                });
                // the run reloads the page, so the Brief it opens on already holds the two initiatives
                ctx.run = await kit.jarvis.arrangeSheetDagRun(h, "surfaces-spring", kit.jarvis.RUN_SHEET_POLISH_TASKS);
                if (ctx.run.arrangeError != null) throw new Error(ctx.run.arrangeError);
                // the dag seeding helpers read the stored dag's id from the run's ctx
                ctx.run.dagId = (await h.rpc("dagstatus", { channelid: ctx.run.channelId, runid: ctx.run.runId })).group?.oid;
                if (!ctx.run.dagId) throw new Error("the run has no dag");
                ctx.out = mkdtempSync(join(tmpdir(), "verify-spring-initiatives-"));
                mkdirSync(join(ctx.out, "1", "cdp-shots"), { recursive: true });
                writeFileSync(join(ctx.out, "1", "cdp-shots", `${SHOT}.png`), PNG);
                await kit.run.seedFinalShots(h, ctx.run, {
                    final: {
                        state: "passed",
                        round: 1,
                        outdir: `${ctx.out.replace(/\\/g, "/")}/1`,
                        shots: [{ name: SHOT, files: [`cdp-shots/${SHOT}.png`], steps: FINAL_STEPS }],
                        shotsmanifest: true,
                    },
                    pastfinals: [],
                });
            } catch (e) {
                ctx.arrangeError = String(e?.message ?? e);
            }
            return ctx;
        },

        async assert(h, ctx) {
            if (ctx.arrangeError != null) {
                return [{ step: "0. the fixtures were made", ok: false, detail: ctx.arrangeError }];
            }
            const steps = [];
            const step = async (name, run) => {
                try {
                    const r = await run();
                    steps.push({ step: name, ok: r.ok === true, detail: r.detail });
                } catch (e) {
                    steps.push({ step: name, ok: false, detail: String(e?.message ?? e) });
                }
            };
            const open = (oref) => h.ev(`window.__openAddress(${q(oref)})`);
            await until(h, `typeof window.__openAddress === "function"`, 10_000);

            await step("1. a chunk added to the plan opens its row on the spring", async () => {
                await open(`effort:${ctx.sheet.oid}`);
                if (!(await until(h, `!!document.querySelector(${q(`${PLAN} [data-jarvis-tracker-chunk]`)})`))) {
                    return { ok: false, detail: "the initiative's sheet drew no plan" };
                }
                // the sheet's own slide and the plan's first draw are over before the add
                await sleep(800);
                await click(h, `[...document.querySelectorAll(${q(`${PLAN} [data-jarvis-add-chunk]`)})].at(-1)`);
                if (!(await until(h, `document.activeElement?.getAttribute("aria-label") === "New chunk label"`, 3_000))) {
                    return { ok: false, detail: "no chunk input after + Add chunk" };
                }
                await h.cdp("Input.insertText", { text: ADDED });
                // the row lands after the server's round trip: a window long enough to hold it and its spring
                const row = `${PLAN} > div:has(> [data-jarvis-tracker-chunk=${q(ADDED)}])`;
                const samples = await sampled(h, row, () => press(h, "Enter", { vk: 13 }), 2000);
                await sleep(500);
                await h.shot("cdp-shots/surfaces-spring-initiatives-1-chunk.png");
                const slid = between(samples, "height");
                const one = singleCopy(samples);
                // a row clips only while it moves: at rest (the added one, and one drawn with the plan) its status menu and
                // focus ring may hang past its edge
                const rest = await h.ev(`[${q(ADDED)}, "Cards model"].map((label) => {
                    const row = document.querySelector(${q(PLAN)} + ' > div:has(> [data-jarvis-tracker-chunk="' + label + '"])');
                    return row ? getComputedStyle(row).overflow : null;
                })`);
                const unclipped = rest.every((o) => o === "visible");
                return {
                    ok: slid && one && unclipped,
                    detail: `height ${extent(samples, "height")}; between ${slid}; one copy at every frame ${one}; overflow at rest ${JSON.stringify(rest)}`,
                };
            });

            await step("2. a long note's Show all and Show less move the block on the spring", async () => {
                await open(`effort:${ctx.chunk.oid}`);
                if (!(await until(h, `!!document.querySelector(${q(`${SHEET} [data-jarvis-tracker-chunk=${q(TRAIL)}]`)})`))) {
                    return { ok: false, detail: "the chunk's initiative drew no plan" };
                }
                await click(h, `document.querySelector(${q(`${SHEET} [data-jarvis-tracker-chunk=${q(TRAIL)}]`)})`);
                if (!(await until(h, `!!document.querySelector(${q(`${CHUNK_VIEW} [data-jarvis-trail-show]`)})`, 6_000))) {
                    return { ok: false, detail: "the chunk view drew no Show all (is the note clamped?)" };
                }
                await sleep(800);
                const block = `${CHUNK_VIEW} [data-jarvis-trail-block]:has([data-jarvis-trail-show])`;
                const toggle = () => click(h, `document.querySelector(${q(`${CHUNK_VIEW} [data-jarvis-trail-show]`)})`);
                const opened = await sampled(h, block, toggle);
                await sleep(300);
                await h.shot("cdp-shots/surfaces-spring-initiatives-2-show-all.png");
                const folded = await sampled(h, block, toggle);
                await sleep(300);
                const openOk = between(opened, "height");
                const foldOk = between(folded, "height");
                return {
                    ok: openOk && foldOk,
                    detail: `Show all ${extent(opened, "height")} (between ${openOk}); Show less ${extent(folded, "height")} (between ${foldOk})`,
                };
            });

            await step("3. the final shots viewer's Steps drawer opens on the spring", async () => {
                await open(`run:${ctx.run.runId}`);
                if (!(await until(h, `!!document.querySelector(${q(DOCK)}) && !document.querySelector(${q(DOCK)}).disabled`, 15_000))) {
                    return { ok: false, detail: "the run sheet's Screenshots dock never came up on the seeded Final" };
                }
                await click(h, `document.querySelector(${q(DOCK)})`);
                if (!(await until(h, `!!document.querySelector(${q(STEPS_BUTTON)})`, 8_000))) {
                    return { ok: false, detail: "the viewer drew no Steps button" };
                }
                await sleep(400);
                const closedAtFirst = (await h.ev(`document.querySelector(${q(STEPS_BUTTON)}).getAttribute("aria-expanded")`)) === "false";
                const samples = await sampled(h, DRAWER, () => click(h, `document.querySelector(${q(STEPS_BUTTON)})`));
                await sleep(300);
                await h.shot("cdp-shots/surfaces-spring-initiatives-3-steps.png");
                const grew = between(samples, "width");
                return {
                    ok: closedAtFirst && grew,
                    detail: `drawer closed on a passing scenario ${closedAtFirst}; width ${extent(samples, "width")}; between ${grew}`,
                };
            });

            await step("4. a detail sheet slides in on the spring", async () => {
                // Escape closes the viewer, then the run sheet under it; the initiative's sheet then opens on a clean page
                await domKey(h, "Escape");
                await until(h, `!document.querySelector(${q(VIEWER)})`, 3_000);
                await sleep(700);
                await domKey(h, "Escape");
                if (!(await until(h, `!document.querySelector("[data-run-sheet]")`, 6_000))) {
                    return { ok: false, detail: "the run sheet did not close on Escape" };
                }
                await sleep(700);
                const samples = await sampled(h, SHEET_PANEL, () => open(`effort:${ctx.sheet.oid}`));
                await sleep(500);
                await h.shot("cdp-shots/surfaces-spring-initiatives-4-sheet.png");
                const slid = between(samples, "left");
                return { ok: slid, detail: `left ${extent(samples, "left")}; between ${slid}` };
            });

            return steps;
        },

        async teardown(h, ctx) {
            await h.ev(`document.querySelector(${q(`${SHEET} button[aria-label="Close (Esc)"]`)})?.click()`).catch(() => {});
            if (ctx.run?.cwd) await kit.jarvis.teardownFixtureRun(h, ctx.run, "surfaces-spring");
            if (ctx.out) rmSync(ctx.out, { recursive: true, force: true });
            if (ctx.chunk) await kit.scenario("jarvis-chunk-sheet").teardown(h, ctx.chunk);
            if (ctx.sheet) await kit.scenario("jarvis-initiative-sheet").teardown(h, ctx.sheet);
        },
    },
];
