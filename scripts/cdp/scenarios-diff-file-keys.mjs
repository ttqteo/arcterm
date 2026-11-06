// diff-file-keys: n / p open the next and previous file of the Diff's changed-file list, in the order the list draws
// them, without marking it reviewed and without wrapping past either end. Task 6 of
// docs/superpowers/plans/2026-11-06-kael-sync-surfaces.md; the fork's n/p scenario steps (kaeltran16 commit dc26b2004) onto
// our Diff, seeded like `diff-review-marks` in scenarios.mjs: a temp git repo with changed files in its working tree,
// registered as a project, picked as the Diff source, its Log tab's Uncommitted changes row opened.
//
// The three changed files are chosen so the tree's order is not git's: git lists README.md first (an uppercase R sorts
// before the lowercase `src`), the tree draws the src/retry directory first and the root-level README.md after it. A key
// that stepped through git's order instead of the list's would open README.md after the first file, not policy.go.
//
// kit is scenarios.mjs's FILES_KIT: git, pickFilesSource, showLogTab, reloadApp, REVIEW_STORAGE_KEY,
// restoreLocalStorage. verify.mjs pins the viewport before a scenario, and the seed pins it again after a reload, which this
// one does too.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PROJECT = "verify-diff-file-keys";
const BUDGET = "src/retry/budget.go";
const POLICY = "src/retry/policy.go";
const README = "README.md";
// the list's drawn order, which is not git's
const DRAWN = [BUDGET, POLICY, README];
const KEY_SETTLE_MS = 500;

export default function ({ git, pickFilesSource, showLogTab, reloadApp, REVIEW_STORAGE_KEY, restoreLocalStorage }) {
    const scenario = {
        name: "diff-file-keys",
        surface: "files",
        async arrange(h) {
            const dir = mkdtempSync(join(tmpdir(), "verify-diff-file-keys-"));
            git(dir, "init", "-q", "--initial-branch=main");
            mkdirSync(join(dir, "src", "retry"), { recursive: true });
            writeFileSync(join(dir, README), "# retry\n");
            writeFileSync(join(dir, POLICY), "package retry\n\nfunc Budget() int {\n    return 3\n}\n");
            writeFileSync(join(dir, BUDGET), "package retry\n\nfunc Floor() int {\n    return 1\n}\n");
            git(dir, "add", ".");
            git(dir, "commit", "-q", "-m", "seed the retry package");
            // the working tree: all three files changed
            writeFileSync(join(dir, README), "# retry\n\nBudgets and backoff for job submission.\n");
            writeFileSync(join(dir, POLICY), "package retry\n\nfunc Budget() int {\n    return 8\n}\n");
            writeFileSync(join(dir, BUDGET), "package retry\n\nfunc Floor() int {\n    return 2\n}\n");
            await h.rpc("createproject", { name: PROJECT, path: dir });

            // the review store reads localStorage once, at module load, so the key is cleared before the reload that
            // gives this scenario fresh module state; teardown puts back whatever the user had
            const prevMarks = await h.ev(`localStorage.getItem(${JSON.stringify(REVIEW_STORAGE_KEY)})`);
            await h.ev(`localStorage.removeItem(${JSON.stringify(REVIEW_STORAGE_KEY)})`);
            await reloadApp(h);
            return { dir, name: PROJECT, prevMarks };
        },
        async assert(h, ctx) {
            const steps = [];
            const rec = (step, ok, detail) => steps.push({ step, ok, detail });
            const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
            const q = (sel) => `document.querySelector(${JSON.stringify(sel)})`;
            const rowSel = (path) => `[data-changed-file-row=${JSON.stringify(path)}]`;
            const until = async (expr, ms = 8000) => {
                for (let waited = 0; waited < ms; waited += 250) {
                    if (await h.ev(expr).catch(() => false)) return true;
                    await sleep(250);
                }
                return false;
            };
            const click = (sel) => h.ev(`(() => { const el = ${q(sel)}; if (!el) return false; el.click(); return true; })()`);
            const isOpen = (path) => `${q(rowSel(path))}?.getAttribute("aria-current") === "true"`;
            const openRow = () => h.ev(`${q('[data-changed-file-row][aria-current="true"]')}?.dataset.changedFileRow ?? ""`);
            const rows = () =>
                h.ev(
                    `Array.from(document.querySelectorAll('[data-changed-file-row]')).map(e => e.dataset.changedFileRow).join(',')`
                );
            const states = () =>
                h.ev(
                    `Array.from(document.querySelectorAll('[data-changed-file-row]')).map(e => e.dataset.reviewState).join(',')`
                );
            const progress = async () =>
                JSON.parse(
                    await h.ev(`(() => { const el = ${q("[data-files-reviewed]")};
                      return JSON.stringify(el ? { done: el.dataset.done, total: el.dataset.total, text: el.textContent }
                                               : { done: null, total: null, text: "" }); })()`)
                );
            // the diff pane's header names the open file: the pane follows the list, not only the list's highlight
            const headerNames = (path) =>
                `(${q("[data-diff-header]")}?.textContent ?? "").includes(${JSON.stringify(path.split("/").pop())})`;
            const press = async (key, code, vk) => {
                // an open diff can hold focus in Monaco, where the dispatcher lets every key through
                await h.ev("document.activeElement?.blur?.()");
                await h.cdp("Input.dispatchKeyEvent", { type: "keyDown", key, code, text: key, windowsVirtualKeyCode: vk });
                await h.cdp("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk });
            };
            const pressN = () => press("n", "KeyN", 78);
            const pressP = () => press("p", "KeyP", 80);
            // a state with nothing reviewed: no row marked and the progress line at 0 of 3
            const unmarked = async () => {
                const p = await progress();
                return (await states()) === "none,none,none" && p.done === "0" && p.total === "3";
            };
            const pin = () =>
                h.cdp("Emulation.setDeviceMetricsOverride", { width: 1600, height: 950, deviceScaleFactor: 1, mobile: false });
            // a source with uncommitted changes opens on the Commit tab, whose rows tick files for a commit; the review
            // marks are on the Log tab's file list, under its Uncommitted changes row. The surface picks the Commit tab
            // only once the tree's list has loaded, so a Log click before that is overridden: wait for Commit first
            const WT_ROW = '[data-history-row="worktree"] button';
            const LOG_ON = `${q('[data-panel-tab="log"]')}?.getAttribute("aria-selected") === "true"`;
            const pick = async () => {
                if (!(await pickFilesSource(h, ctx.name))) return false;
                await until(`${q('[data-panel-tab="commit"]')}?.getAttribute("aria-selected") === "true"`, 15000);
                await showLogTab(h);
                if (!(await until(LOG_ON, 5000))) return false;
                if (!(await until(`!!${q(WT_ROW)}`, 15000))) return false;
                await click(WT_ROW);
                return until(`document.querySelectorAll('[data-changed-file-row]').length === 3`, 15000);
            };

            try {
                await pin();
                await sleep(400);
                const picked = await pick();
                const listed = await rows();
                const drawn = listed === DRAWN.join(",");
                // open the first row on purpose rather than rely on which file the surface opened on
                await click(rowSel(BUDGET));
                const first = await until(`${isOpen(BUDGET)} && ${headerNames(BUDGET)}`, 15000);
                // the review effect publishes the list's files after the render that selected the row
                await sleep(400);
                const clean = await unmarked();
                rec(
                    "1. the working tree lists three changed files in the tree's order (not git's), none reviewed, the first open",
                    picked && drawn && first && clean,
                    `rows=${listed} open=${await openRow()} states=${await states()}`
                );
                await h.shot("cdp-shots/diff-file-keys-list.png");

                await pressN();
                const second = await until(`${isOpen(POLICY)} && ${headerNames(POLICY)}`, 5000);
                rec(
                    "2. n opens the next file in the list, and the diff pane follows it",
                    second && (await openRow()) === POLICY && (await unmarked()),
                    `open=${await openRow()} states=${await states()}`
                );

                await pressN();
                const third = await until(`${isOpen(README)} && ${headerNames(README)}`, 5000);
                const p3 = await progress();
                rec(
                    "3. n again opens the third file, and nothing is marked reviewed: 0/3 and every row unmarked",
                    third && (await openRow()) === README && (await unmarked()),
                    `open=${await openRow()} states=${await states()} progress=${p3.done}/${p3.total}`
                );
                await h.shot("cdp-shots/diff-file-keys-third.png");

                await pressN();
                await sleep(KEY_SETTLE_MS);
                rec(
                    "4. n at the last file declines: the list does not wrap and the third file stays open",
                    (await openRow()) === README && (await unmarked()),
                    `open=${await openRow()} states=${await states()}`
                );

                await pressP();
                const back = await until(`${isOpen(POLICY)} && ${headerNames(POLICY)}`, 5000);
                const backOne = (await openRow()) === POLICY && (await unmarked());
                await h.shot("cdp-shots/diff-file-keys-back.png");
                await pressP();
                const backTwo = await until(`${isOpen(BUDGET)} && ${headerNames(BUDGET)}`, 5000);
                await pressP();
                await sleep(KEY_SETTLE_MS);
                rec(
                    "5. p steps back through the list, unmarked, and declines at the first file",
                    back && backOne && backTwo && (await openRow()) === BUDGET && (await unmarked()),
                    `open=${await openRow()} states=${await states()}`
                );
            } catch (e) {
                rec("scenario aborted", false, String(e?.message ?? e));
            }
            return steps;
        },
        async teardown(h, ctx) {
            await h.ev(restoreLocalStorage(REVIEW_STORAGE_KEY, ctx.prevMarks));
            try {
                await h.rpc("deleteproject", { name: ctx.name });
            } catch {
                /* leave a stale registry entry rather than failing teardown */
            }
            try {
                rmSync(ctx.dir, { recursive: true, force: true });
            } catch {
                /* a leftover temp repo is cheaper than a failed teardown */
            }
        },
    };
    return [scenario];
}
