// surfaces-spring-diff: Diff's Review mode folds a file on the spring (Task 6 of docs/superpowers/plans/2026-11-15-surfaces-chat-look.md;
// docs/superpowers/specs/2026-11-14-surfaces-chat-look-design.md, §2 Diff). Review mode stacks every changed file in one scroll,
// each under a header that folds its body (reviewlistview.tsx, FoldBody): the body's height opens and closes on MOTION.spring, a
// body taller than ARRIVAL_CAP_PX moves only its last 320px, and a file the reader is inside (its top above the list's top)
// folds at once so the reader's place holds. File mode and the side panel stay instant, and are not driven here.
//
// The repo is diff-file-states' (scenarios-diff-states.mjs, run through `kit.scenario("diff-file-states")`: its arrange and
// teardown, so the project, the temp dir and the page reset are the ones that scenario already keeps), plus two untracked files
// written here, lib/long.txt and lib/read.txt, 60 lines each: all inserts, so each body is a ~1200px stack of rows, far past
// the cap. The short file is the fixture's untracked docs file (3 lines).
//
// Each step times the body of one file frame by frame (springprobe.mjs: startSampler on `[data-review-body=<path>]`, then the
// click, then readSampler). A body is absent from the DOM before it unfolds and after it has folded, so `trim` drops the frames
// where it is not there before a verdict reads the ends (the sampler's `between` wants an element on its first and last frame).
//
// kit is scenarios.mjs's SS_KIT; `kit.files` carries pickFilesSource and showLogTab. verify.mjs pins the viewport before a
// scenario; the steps pin their own.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { between, readSampler, startSampler } from "./springprobe.mjs";

const BASE = "diff-file-states";
const PROJECT = "verify-diff-states";
const SHORT = "docs/2026-11-05-a-very-long-review-plus-fixes-design-with-a-much-longer-tail-than-fits.md";
const LONG = "lib/long.txt";
// a second long file, listed after the first, for step 3's reader to be inside
const READ = "lib/read.txt";
const LONG_LINES = 60;
// Chat's ARRIVAL_CAP_PX (chatarrival.ts): the most a body opens or closes over
const CAP = 320;
// rects round to subpixels, and a spring's first frame can land a pixel off its start
const SLACK = 4;
const WIDE = { width: 1600, height: 950 };
// the spring settles in ~0.35s; the sampler's window is 900ms
const SETTLE_MS = 1200;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (sel) => `document.querySelector(${JSON.stringify(sel)})`;
const rowSel = (path) => `[data-changed-file-row=${JSON.stringify(path)}]`;
const headerSel = (path) => `[data-review-file=${JSON.stringify(path)}]`;
const bodySel = (path) => `[data-review-body=${JSON.stringify(path)}]`;
const LIST = "[data-review-list]";

// the frames from the first to the last on which the element was there
const trim = (samples) => {
    const at = samples.map((s) => s.rect != null);
    const first = at.indexOf(true);
    const last = at.lastIndexOf(true);
    return first < 0 ? [] : samples.slice(first, last + 1);
};
const heights = (samples) => samples.map((s) => Math.round(s.rect?.height ?? -1));

export default (kit) => {
    const { files } = kit;
    const { pickFilesSource, showLogTab } = files;
    const base = () => kit.scenario(BASE);

    const scenario = {
        name: "surfaces-spring-diff",
        surface: "files",
        async arrange(h) {
            const ctx = await base().arrange(h);
            if (ctx.arrangeError == null) {
                try {
                    mkdirSync(join(ctx.dir, "lib"), { recursive: true });
                    for (const path of [LONG, READ]) {
                        writeFileSync(
                            join(ctx.dir, path),
                            Array.from({ length: LONG_LINES }, (_, i) => `line ${i + 1} of ${path}\n`).join("")
                        );
                    }
                } catch (e) {
                    ctx.arrangeError = String(e?.message ?? e);
                }
            }
            return ctx;
        },
        async assert(h, ctx) {
            const steps = [];
            const rec = (step, ok, detail) => steps.push({ step, ok, detail });
            if (ctx.arrangeError != null) {
                return [{ step: "0. the repo, the project and the long file", ok: false, detail: ctx.arrangeError }];
            }
            const until = async (expr, ms = 8000) => {
                for (let waited = 0; waited < ms; waited += 250) {
                    if (await h.ev(expr).catch(() => false)) return true;
                    await sleep(250);
                }
                return false;
            };
            const click = (sel) => h.ev(`(() => { const el = ${q(sel)}; if (!el) return false; el.click(); return true; })()`);
            const pin = ({ width, height }) =>
                h.cdp("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
            // the list's scroll offset after putting `path`'s section at its top (instant), and the section's top relative to the list
            const scrollToFile = (path, extra = 0) =>
                h.ev(`(() => {
                    const list = ${q(LIST)};
                    const section = ${q(headerSel(path))}?.parentElement;
                    if (!list || !section) return null;
                    section.scrollIntoView({ block: "start" });
                    list.scrollTop += ${extra};
                    return { scrollTop: list.scrollTop, top: Math.round(section.getBoundingClientRect().top - list.getBoundingClientRect().top) };
                })()`);
            // time a toggle: the sampler on the file's body, the click on its header, the frames back
            const timed = async (path) => {
                await h.ev(startSampler(bodySel(path)));
                await click(headerSel(path));
                return h.ev(readSampler());
            };
            const bodyIs = (path, there) => until(`${there ? "!!" : "!"}${q(bodySel(path))}`, 4000);
            const shot = (name) => h.shot(`cdp-shots/surfaces-spring-diff-${name}.png`);

            // 0. Diff on the fixture project's working tree, in Review mode, with the short, the long and the notes files listed
            await pin(WIDE);
            await sleep(400);
            const picked = await pickFilesSource(h, PROJECT, PROJECT);
            await until(`!!${q('[data-panel-tab="log"]')}`, 15000);
            await sleep(1500);
            await showLogTab(h);
            const worktree = await until(`!!${q('[data-history-row="worktree"] button')}`, 15000);
            if (worktree) await click('[data-history-row="worktree"] button');
            const listed = await until([SHORT, LONG, READ].map((p) => `!!${q(rowSel(p))}`).join(" && "), 15000);
            const reviewing = listed && (await click('[data-diff-mode-option="review"]'));
            const drawn =
                reviewing && (await until([SHORT, LONG, READ].map((p) => `!!${q(headerSel(p))}`).join(" && "), 15000));
            if (!drawn) {
                rec(
                    "0. Review mode lists the short file and the two long files",
                    false,
                    JSON.stringify({ picked, worktree, listed, reviewing })
                );
                return steps;
            }
            // the long file is a stack of rows far past the cap
            const fullLong = await h.ev(`Math.round(${q(bodySel(LONG))}.getBoundingClientRect().height)`);
            const fullShort = await h.ev(`Math.round(${q(bodySel(SHORT))}.getBoundingClientRect().height)`);
            await shot("0-review");
            rec(
                "0. Review mode lists the short file (3 rows) and two long ones (60 rows each, far past the 320px cap), each body open",
                fullLong > CAP * 2 && fullShort > 0 && fullShort < CAP,
                JSON.stringify({ fullLong, fullShort })
            );

            try {
                // 1. a short file folds and unfolds on the spring: some frame between its two heights, both ways. It sits first, with its
                // top at the list's top (not above it), so it animates
                const top1 = await scrollToFile(SHORT);
                const fold1 = trim(await timed(SHORT));
                const gone1 = await bodyIs(SHORT, false);
                await shot("1-short-folded");
                const unfold1 = trim(await timed(SHORT));
                await sleep(SETTLE_MS - 900);
                const back1 = await bodyIs(SHORT, true);
                const restored1 = await h.ev(`Math.round(${q(bodySel(SHORT))}?.getBoundingClientRect().height ?? -1)`);
                const clean1 = await h.ev(`(() => { const s = ${q(bodySel(SHORT))}?.style; return !!s && s.height === "" && s.opacity === "" && s.overflow === ""; })()`);
                await shot("1-short-unfolded");
                rec(
                    "1. a short file folds and unfolds on the spring: its body height passes through a value between its two ends both ways, the body leaves the DOM when it has folded and comes back at its own height with no style left on it",
                    fold1.length > 1 &&
                        between(fold1, "height") &&
                        gone1 &&
                        unfold1.length > 1 &&
                        between(unfold1, "height") &&
                        back1 &&
                        Math.abs(restored1 - fullShort) <= SLACK &&
                        clean1,
                    JSON.stringify({ top1, fold: heights(fold1), unfold: heights(unfold1), gone1, back1, restored1, fullShort, clean1 })
                );

                // 2. a long file opens only over its last 320px: the first frame of the unfold is (full - 320) high, never 0, and it
                // ends at its own height; the fold before it starts from at most 320px
                const top2 = await scrollToFile(LONG);
                const foldSamples2 = await timed(LONG);
                const gone2 = await bodyIs(LONG, false);
                await shot("2-long-folded");
                const unfoldSamples2 = await timed(LONG);
                await sleep(SETTLE_MS - 900);
                await bodyIs(LONG, true);
                const fold2 = trim(foldSamples2);
                const unfold2 = trim(unfoldSamples2);
                const full2 = await h.ev(`Math.round(${q(bodySel(LONG))}?.getBoundingClientRect().height ?? -1)`);
                const want2 = full2 - CAP;
                const first2 = Math.round(unfold2[0]?.rect.height ?? -1);
                const lowest2 = Math.min(...heights(unfold2));
                const last2 = Math.round(unfold2[unfold2.length - 1]?.rect.height ?? -1);
                // the first frame after the click that shows the fold started: its height is at most the cap
                const folded2 = fold2.findIndex((s) => s.rect.height < fullLong - SLACK);
                const start2 = Math.round(fold2[folded2]?.rect.height ?? -1);
                await shot("2-long-unfolded");
                rec(
                    "2. a long file unfolds from (full - 320px), never from 0: the first frame is within a few px of full - 320, no frame is lower, it ends at full and passes through a value between; its fold starts from at most 320px",
                    full2 > CAP * 2 &&
                        Math.abs(first2 - want2) <= SLACK &&
                        lowest2 >= want2 - SLACK &&
                        Math.abs(last2 - full2) <= SLACK &&
                        between(unfold2, "height") &&
                        gone2 &&
                        folded2 > 0 &&
                        start2 > 0 &&
                        start2 <= CAP + SLACK &&
                        between(fold2, "height"),
                    JSON.stringify({ top2, full2, want2, first2, lowest2, last2, start2, gone2, unfold: heights(unfold2), fold: heights(fold2) })
                );

                // 3. folding a file whose top is above the reading position shows at once and leaves the reader's place: the second long
                // file is scrolled to a row well inside it, the first long file (wholly above the viewport) is folded by its header, and
                // the row the reader is on stays where it was on screen
                const place = (key) =>
                    h.ev(`(() => {
                        const list = ${q(LIST)};
                        const listTop = list.getBoundingClientRect().top;
                        const rows = [...${q(headerSel(READ))}.parentElement.querySelectorAll("[data-review-row]")];
                        // the first row clear of the sticky header, unless the one the reader was on is named
                        const row = ${key == null ? "rows.find((r) => r.getBoundingClientRect().top - listTop >= 60)" : `rows.find((r) => r.dataset.reviewRow === ${JSON.stringify(key)})`};
                        return { key: row?.dataset.reviewRow ?? null, scrollTop: Math.round(list.scrollTop),
                            rowTop: row ? Math.round(row.getBoundingClientRect().top - listTop) : null,
                            max: Math.round(list.scrollHeight - list.clientHeight) };
                    })()`);
                const read = await scrollToFile(READ, 300);
                const before3 = await place(null);
                const aboveBottom = await h.ev(
                    `Math.round(${q(headerSel(LONG))}.parentElement.getBoundingClientRect().bottom - ${q(LIST)}.getBoundingClientRect().top)`
                );
                await shot("3-before-fold-above");
                const samples3 = await timed(LONG);
                await sleep(SETTLE_MS - 900);
                const after3 = await place(before3.key);
                const gone3 = await bodyIs(LONG, false);
                await shot("3-after-fold-above");
                // at once: the body is at its height on the frames before the click and gone after, with no frame at a height between
                const partial3 = samples3.filter((s) => s.rect != null && s.rect.height > 1 && Math.round(s.rect.height) < fullLong - SLACK);
                const unfolded3 = await timed(LONG);
                await sleep(SETTLE_MS - 900);
                const after3b = await place(before3.key);
                const partialOpen3 = trim(unfolded3).filter((s) => s.rect.height > 1 && Math.round(s.rect.height) < fullLong - SLACK);
                await shot("3-after-unfold-above");
                rec(
                    "3. folding and unfolding the first long file while the second is read below it (its top above the viewport) is instant, no frame at a height between, and the row the reader is on stays at the same place in the list (the list's scrollTop moves by the folded height, which is the browser's scroll anchoring holding the row: the detail has both)",
                    aboveBottom <= 0 &&
                        gone3 &&
                        partial3.length === 0 &&
                        partialOpen3.length === 0 &&
                        before3.rowTop != null &&
                        Math.abs(after3.rowTop - before3.rowTop) <= 1 &&
                        Math.abs(after3b.rowTop - before3.rowTop) <= 1,
                    JSON.stringify({ read, aboveBottom, before3, after3, after3b, gone3, partialFold: partial3.length, partialUnfold: partialOpen3.length })
                );
            } finally {
                // back to File mode, whatever a step left
                await click('[data-diff-mode-option="file"]').catch(() => {});
            }
            return steps;
        },
        async teardown(h, ctx) {
            await base().teardown(h, ctx);
        },
    };
    return [scenario];
};
