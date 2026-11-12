// diff-states: the Diff surface review fixes for how a file reads (a new file, a deleted one, one git cannot count or read)
// (docs/superpowers/plans/2026-11-12-kael-sync-code-diff-usage-setup.md, Task 12; the fork's ed9065e38, 17f5e4976,
// 44e2c54b1, cda904c6f, 461e72729 and 4d4254507, and the steps of its diff-states scenario in scenarios-files-states.mjs).
//
// One temp repo registered as a project, whose working tree holds a file of each kind: an untracked binary, an untracked
// file past the 2 MB read cap, an untracked empty file, a deleted empty file, a modified text file and a new file with a
// long name. The Diff is pointed at the project and opened on the Log tab's working-tree row.
//
// Two states are made in the page rather than on disk, the way the fork's own scenario stubs them: a read the file system
// refuses (the `fileread` command for one path rejects) and a working tree git can list but not count (the `gitchanges`
// answer for this repo gains a numstat error with a CRLF warning ahead of git's fatal line). Both stubs wrap the page's
// own RPC client and are put back in the step and again in teardown.
//
// kits is scenarios.mjs's KAEL_KITS ({ rt, code, files, jarvis }). verify.mjs pins the viewport before a scenario; the
// steps pin their own where a width matters.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PROJECT = "verify-diff-states";
const SEED = "seed the states repo";
const FILES = {
    deletedEmpty: "src/gone.txt",
    binary: "src/blob.bin",
    big: "big.log",
    empty: "src/empty.txt",
    // committed, then edited in two places: a modified text file taller than the pane
    notes: "lib/notes.txt",
    // untracked, with a name long enough to overrun the pane header at 1000 wide
    longNew: "docs/2026-11-05-a-very-long-review-plus-fixes-design-with-a-much-longer-tail-than-fits.md",
};
// over the pane's 2 MB cap (diffcontentstore.MAX_DIFF_BYTES)
const BIG_BYTES = 3 * 1024 * 1024;
const NOTES_LINES = 80;
const READ_REFUSAL = "open lib/notes.txt: Access is denied.";
// what git prints when one unreadable file fails `diff --numstat`, a CRLF warning ahead of the reason it stopped
const NUMSTAT_ERROR =
    "git diff --numstat --relative HEAD: exit status 128: warning: in the working copy of 'lib/notes.txt', LF will be replaced by CRLF the next time Git touches it\nfatal: cannot hash src/blob.bin";
const PANE = "[data-diff-pane]";
const DIFF_EDITOR = `${PANE} .monaco-diff-editor`;
const NARROW = { width: 1000, height: 700 };
const WIDE = { width: 1600, height: 950 };
// over MonacoDiffViewer's 100ms layout debounce plus a ResizeObserver frame
const LAYOUT_SETTLE_MS = 500;
// rects round to subpixels
const PX_SLACK = 3;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (sel) => `document.querySelector(${JSON.stringify(sel)})`;
const rowSel = (path) => `[data-changed-file-row=${JSON.stringify(path)}]`;
const emptyIs = (kind) => `!!${q(`${PANE} [data-diff-empty="${kind}"]`)}`;
const notesText = (edit) =>
    Array.from({ length: NOTES_LINES }, (_, i) => `line ${i + 1}${edit && (i === 4 || i === 69) ? " edited" : ""}\n`).join(
        ""
    );

// in-page: an app module's own instance, so a store a step calls is the one the surface renders
const MOD_LIB = `
    const mod = async (path) => {
        const names = performance.getEntriesByType("resource").map((e) => e.name.split("?")[0]);
        const hit = names.filter((n) => n.endsWith("/" + path)).pop();
        const base = names.find((n) => n.endsWith("/app/store/jotaiStore.ts"));
        if (hit == null && base == null) throw new Error("no app module url for " + path);
        return import(hit ?? base.replace("app/store/jotaiStore.ts", path));
    };`;

// in-page: wraps the RPC client once, so a stub can be set and cleared per command without stacking wrappers
const STUB_LIB = `
    const c = window.TabRpcClient;
    if (!c.__dfsOrig) {
        c.__dfsOrig = c.wshRpcCall;
        c.__dfsStubs = {};
        c.wshRpcCall = function (command, data, opts) {
            const stub = c.__dfsStubs[command];
            const call = () => c.__dfsOrig.call(c, command, data, opts);
            return stub ? stub(data, call) : call();
        };
    }`;
const norm = (p) => `(${p} || "").replace(/\\\\/g, "/").replace(/\\/+$/, "").toLowerCase()`;

function seedRepo(git) {
    const base = mkdtempSync(join(tmpdir(), "verify-diff-states-"));
    const dir = join(base, "repo");
    mkdirSync(join(dir, "src"), { recursive: true });
    mkdirSync(join(dir, "lib"));
    git(dir, "init", "-q", "--initial-branch=main");
    writeFileSync(join(dir, FILES.deletedEmpty), "");
    writeFileSync(join(dir, "src", "old.py"), "def old():\n    return 1\n");
    writeFileSync(join(dir, FILES.notes), notesText(false));
    git(dir, "add", ".");
    git(dir, "commit", "-q", "-m", SEED);
    rmSync(join(dir, FILES.deletedEmpty));
    // bytes that are not UTF-8 (0x80 and up, unpaired), so the working-tree read calls it binary
    writeFileSync(join(dir, FILES.binary), Buffer.from(Array.from({ length: 1024 }, (_, i) => 0x80 + (i % 0x7f))));
    writeFileSync(join(dir, FILES.big), "x".repeat(BIG_BYTES - 1) + "\n");
    writeFileSync(join(dir, FILES.empty), "");
    writeFileSync(join(dir, FILES.notes), notesText(true));
    mkdirSync(join(dir, "docs"));
    writeFileSync(join(dir, FILES.longNew), "# Review plus fixes\n\nA new file, so its diff is all inserts.\n");
    return { base, dir };
}

export default function (kits) {
    const { rt, files, jarvis } = kits;
    const { git, pickFilesSource, showLogTab, reloadApp } = files;
    const { waitForProjectInConfig } = rt;
    const { teardownFixtureRun } = jarvis;

    const scenario = {
        name: "diff-file-states",
        surface: "files",
        async arrange(h) {
            const ctx = { project: null };
            try {
                const { base, dir } = seedRepo(git);
                ctx.cwd = base;
                ctx.dir = dir;
                await h.rpc("createproject", { name: PROJECT, path: dir });
                ctx.project = PROJECT;
                await waitForProjectInConfig(h, PROJECT);
                // fresh module state: the Diff's scope, tab and selection outlive the surface for the page's life
                await reloadApp(h);
            } catch (e) {
                ctx.arrangeError = String(e?.message ?? e);
            }
            return ctx;
        },
        async assert(h, ctx) {
            const steps = [];
            const rec = (step, ok, detail) => steps.push({ step, ok, detail });
            if (ctx.arrangeError != null) {
                return [{ step: "0. the repo and the project", ok: false, detail: ctx.arrangeError }];
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
            const text = (sel) => h.ev(`(${q(sel)}?.innerText ?? "").trim()`);
            const rectOf = (sel) =>
                h.ev(`(() => { const e = ${q(sel)}; if (!e) return null; const r = e.getBoundingClientRect();
                    return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left),
                        right: Math.round(r.right), height: Math.round(r.height) }; })()`);
            const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
            const stub = (command, body) =>
                h.ev(`(() => { ${STUB_LIB} c.__dfsStubs[${JSON.stringify(command)}] = ${body}; return true; })()`);
            const unstub = (command) =>
                h.ev(`(() => { const c = window.TabRpcClient; if (c?.__dfsStubs) delete c.__dfsStubs[${JSON.stringify(command)}]; return true; })()`);
            const reloadList = () =>
                h.ev(`(async () => { ${MOD_LIB}
                    const { globalStore } = await mod("app/store/jotaiStore.ts");
                    const fs = await mod("app/view/agents/filesstore.ts");
                    await fs.reloadChanges(globalStore.get(fs.filesStateAtom)?.cwd ?? null);
                    return true; })()`);
            const pickFile = async (path) => {
                if (!(await until(`!!${q(rowSel(path))}`, 10000))) return false;
                await click(rowSel(path));
                return until(`${q(rowSel(path))}?.getAttribute("aria-current") === "true"`, 5000);
            };
            // a file opened, and the pane's state for it once it settles
            const emptyStateOf = async (path, kind) => {
                const picked = await pickFile(path);
                const shown = picked && (await until(emptyIs(kind), 10000));
                return { picked, shown, pane: (await text(PANE)).replace(/\s+/g, " ").slice(0, 200) };
            };
            const open = async () => {
                if (!(await pickFilesSource(h, PROJECT, PROJECT))) return false;
                // the surface picks the panel's tab once the list has landed (difflayout.panelTabToApply), and a click
                // before then is overridden: let it settle, then open the Log tab's working-tree row
                await until(`!!${q('[data-panel-tab="log"]')}`, 15000);
                await sleep(1500);
                await showLogTab(h);
                if (!(await until(`${q('[data-panel-tab="log"]')}?.getAttribute("aria-selected") === "true"`, 5000))) {
                    return false;
                }
                if (!(await until(`!!${q('[data-history-row="worktree"] button')}`, 15000))) return false;
                await click('[data-history-row="worktree"] button');
                return until(Object.values(FILES).map((p) => `!!${q(rowSel(p))}`).join(" && "), 15000);
            };

            await pin(WIDE);
            await sleep(400);
            const opened = await open();
            const listed = await h.ev(
                `[...document.querySelectorAll("[data-changed-file-row]")].map((e) => e.dataset.changedFileRow).join(",")`
            );
            if (!opened) {
                rec("0. the project opens on Diff's working tree and lists each seeded file", false, `listed=${listed}`);
                return steps;
            }

            // 1. capped reads: an untracked file past the cap and an untracked binary
            const big = await emptyStateOf(FILES.big, "toolarge");
            await h.shot("cdp-shots/diff-file-states-toolarge.png");
            const blob = await emptyStateOf(FILES.binary, "binary");
            rec(
                "1. the working-tree read is capped: a 3 MB untracked file shows Too large to show here, and an untracked binary shows Binary file",
                big.shown && big.pane.includes("Too large to show here") && blob.shown && blob.pane.includes("Binary file"),
                JSON.stringify({ big, blob })
            );
            await h.shot("cdp-shots/diff-file-states-binary.png");

            // 2. empty files read as added or deleted, not as a rename
            const added = await emptyStateOf(FILES.empty, "newempty");
            await h.shot("cdp-shots/diff-file-states-new-empty.png");
            const deleted = await emptyStateOf(FILES.deletedEmpty, "deletedempty");
            rec(
                "2. an untracked empty file reads New empty file and a deleted empty file reads Deleted empty file, neither a rename",
                added.shown && added.pane.includes("New empty file") && deleted.shown && deleted.pane.includes("Deleted empty file"),
                JSON.stringify({ added, deleted })
            );
            await h.shot("cdp-shots/diff-file-states-deleted-empty.png");

            // 3. a read the file system refuses says so, with a Retry that reads it once it can
            try {
                await stub(
                    "fileread",
                    `(data, call) => ${norm("data?.info?.path")}.endsWith(${JSON.stringify(FILES.notes)})
                        ? Promise.reject(new Error(${JSON.stringify(READ_REFUSAL)})) : call()`
                );
                const failed = await emptyStateOf(FILES.notes, "failed");
                const retry = await h.ev(`!!${q(`${PANE} [data-diff-retry]`)}`);
                await h.shot("cdp-shots/diff-file-states-read-failure.png");
                await unstub("fileread");
                await click(`${PANE} [data-diff-retry]`);
                const recovered = await until(
                    `(${q(DIFF_EDITOR)}?.textContent ?? "").replace(/\\u00a0/g, " ").includes("line 5 edited")`,
                    10000
                );
                rec(
                    "3. a read the file system refuses shows Couldn’t read this file with its reason and a Retry, and Retry draws the diff once the read succeeds",
                    failed.shown && failed.pane.includes("Couldn’t read this file") && failed.pane.includes("Access is denied") &&
                        retry && recovered,
                    JSON.stringify({ failed, retry, recovered })
                );
            } finally {
                await unstub("fileread").catch(() => {});
            }

            // 4. git lists the files but cannot count their lines: the list stays, the counts go, git's error line leads
            try {
                await stub(
                    "gitchanges",
                    `(data, call) => call().then((r) =>
                        r && r.isrepo && ${norm("data?.cwd")} === ${norm(JSON.stringify(ctx.dir))}
                            ? { ...r, numstat: "", numstaterror: ${JSON.stringify(NUMSTAT_ERROR)} } : r)`
                );
                await reloadList();
                const noticed = await until(
                    `[...document.querySelectorAll("[data-git-failure-notice]")].some((e) => e.textContent.includes("Line counts unavailable"))`,
                    10000
                );
                const headline = await h.ev(`(() => {
                    const n = [...document.querySelectorAll("[data-git-failure-notice]")].find((e) => e.textContent.includes("Line counts unavailable"));
                    const l = n?.querySelector("[data-git-failure-headline]");
                    return l ? { text: l.textContent, title: l.getAttribute("title") ?? "" } : null;
                })()`);
                // the file still opens: the list is valid even though its counts are not
                const picked = await pickFile(FILES.notes);
                const drawn = picked && (await until(`!!${q(DIFF_EDITOR)}`, 10000));
                const counts = await h.ev(`(() => {
                    const rows = [...document.querySelectorAll("[data-changed-file-row]")];
                    const dirs = [...document.querySelectorAll("[data-changed-dir-row]")];
                    return {
                        rows: rows.length,
                        rowCounts: rows.filter((r) => /[+−]\\d/.test(r.textContent)).length,
                        dirCounts: dirs.filter((r) => /[+−]\\d/.test(r.textContent)).length,
                        paneCount: (document.querySelector("[data-files-count]")?.parentElement?.textContent ?? "").match(/[+−]\\d/g) ?? [],
                        header: !!document.querySelector("${PANE} [data-diff-adds]") || !!document.querySelector("${PANE} [data-diff-dels]"),
                    };
                })()`);
                rec(
                    "4. with the line counts failing, the change list stays and opens files, the notice's line is git's fatal line though a warning precedes it, and no +N −N is drawn on rows, the list header or the pane header",
                    noticed &&
                        headline != null &&
                        /^fatal:/.test(headline.text) &&
                        headline.title.indexOf("warning:") >= 0 &&
                        headline.title.indexOf("warning:") < headline.title.indexOf("fatal:") &&
                        counts.rows >= Object.keys(FILES).length &&
                        counts.rowCounts === 0 &&
                        counts.dirCounts === 0 &&
                        counts.paneCount.length === 0 &&
                        !counts.header &&
                        drawn,
                    JSON.stringify({ noticed, headline, counts, picked, drawn })
                );
                await h.shot("cdp-shots/diff-file-states-numstat-failure.png");
            } finally {
                await unstub("gitchanges").catch(() => {});
                await reloadList().catch(() => {});
            }
            const countsBack = await until(`!!${q(`${PANE} [data-diff-adds]`)}`, 10000);
            const noticeGone = await until(
                `![...document.querySelectorAll("[data-git-failure-notice]")].some((e) => e.textContent.includes("Line counts unavailable"))`,
                10000
            );
            rec(
                "4b. once git counts again, the notice goes and the pane header shows +N −N",
                countsBack && noticeGone,
                JSON.stringify({ countsBack, noticeGone })
            );

            // 5. a new file reads without a removed line: no bands, no old-side line number, no +/- markers
            const pickedNew = await pickFile(FILES.longNew);
            const drewNew = pickedNew && (await until(`!!${q(DIFF_EDITOR)} && !!${q(`${PANE}[data-diff-new-file]`)}`, 10000));
            await sleep(LAYOUT_SETTLE_MS);
            const newFile = await h.ev(`(() => {
                const pane = document.querySelector("${PANE}");
                const clear = (v) => v === "" || v === "transparent" || v === "rgba(0, 0, 0, 0)";
                const painted = (sel) => [...pane.querySelectorAll(sel)].filter((e) => !clear(getComputedStyle(e).backgroundColor)).length;
                const ed = pane.querySelector(".monaco-editor");
                const cs = ed ? getComputedStyle(ed) : null;
                return {
                    marked: pane.hasAttribute("data-diff-new-file"),
                    removedVar: cs?.getPropertyValue("--vscode-diffEditor-removedLineBackground").trim() ?? null,
                    insertedVar: cs?.getPropertyValue("--vscode-diffEditor-insertedLineBackground").trim() ?? null,
                    removedBands: painted(".line-delete, .char-delete, .gutter-delete"),
                    insertedBands: painted(".line-insert, .char-insert, .gutter-insert"),
                    signs: pane.querySelectorAll(".delete-sign, .insert-sign").length,
                    text: (pane.querySelector(".monaco-diff-editor")?.textContent ?? "").replace(/\\u00a0/g, " ").slice(0, 120),
                };
            })()`);
            rec(
                "5. a new file's diff is marked new and draws no removed line: no removed or inserted band, and no +/- markers",
                drewNew &&
                    newFile.marked &&
                    newFile.removedBands === 0 &&
                    newFile.insertedBands === 0 &&
                    newFile.signs === 0 &&
                    newFile.text.includes("Review plus fixes"),
                JSON.stringify({ pickedNew, drewNew, newFile })
            );
            await h.shot("cdp-shots/diff-file-states-new-file.png");

            // 6. a long name truncates at 1000 wide without overprinting the counts or the change walker
            await pin(NARROW);
            await sleep(LAYOUT_SETTLE_MS);
            const name = await rectOf(`${PANE} [data-diff-filename]`);
            const adds = await rectOf(`${PANE} [data-diff-adds]`);
            const dels = await rectOf(`${PANE} [data-diff-dels]`);
            const options = await rectOf(`${PANE} [data-diff-options]`);
            const truncates = await h.ev(`(() => { const e = ${q(`${PANE} [data-diff-filename]`)};
                return e ? { scrollWidth: e.scrollWidth, clientWidth: e.clientWidth } : null; })()`);
            const parts = [name, adds, dels, options];
            const clear =
                parts.every((r) => r != null) && parts.every((a, i) => parts.slice(i + 1).every((b) => !overlaps(a, b)));
            rec(
                "6. at 1000x700 the long file name truncates and does not overprint +N, −N or the options button",
                clear && truncates != null && truncates.scrollWidth > truncates.clientWidth,
                JSON.stringify({ name, adds, dels, options, truncates })
            );
            await h.shot("cdp-shots/diff-file-states-long-name.png");

            // 7. the diff editor follows the pane: it sits under the header, inside the pane, and grows with the window.
            // The file is picked wide, where the panel and its list show (at 1000 wide the panel folds away).
            await pin(WIDE);
            await sleep(LAYOUT_SETTLE_MS);
            const pickedNotes = await pickFile(FILES.notes);
            const drawnNotes =
                pickedNotes &&
                (await until(`!!${q(DIFF_EDITOR)} && !${q(`${PANE}[data-diff-new-file]`)}`, 10000));
            await sleep(LAYOUT_SETTLE_MS);
            const measure = async () => ({
                editor: await rectOf(DIFF_EDITOR),
                pane: await rectOf(PANE),
                header: await rectOf(`${PANE} [data-diff-header]`),
            });
            const wide = await measure();
            await pin(NARROW);
            await sleep(LAYOUT_SETTLE_MS);
            const narrow = await measure();
            await pin(WIDE);
            await sleep(LAYOUT_SETTLE_MS);
            const inside = (m) =>
                m.editor != null &&
                m.pane != null &&
                m.header != null &&
                m.editor.top >= m.header.bottom - PX_SLACK &&
                m.editor.bottom <= m.pane.bottom + PX_SLACK &&
                m.editor.height > 100;
            const grew =
                inside(narrow) &&
                inside(wide) &&
                Math.abs(wide.editor.height - narrow.editor.height - (wide.pane.height - narrow.pane.height)) <= PX_SLACK;
            rec(
                "7. the diff editor fits the pane: under the header and inside the pane at 1000x700 and 1600x950, and it grows by what the pane grows",
                drawnNotes && grew,
                JSON.stringify({ pickedNotes, drawnNotes, narrow, wide })
            );
            await h.shot("cdp-shots/diff-file-states-fit.png");
            return steps;
        },
        async teardown(h, ctx) {
            try {
                // verify.mjs pins the viewport again after teardown
                await h.ev(
                    `(() => { const c = window.TabRpcClient; if (c?.__dfsOrig) { c.wshRpcCall = c.__dfsOrig; delete c.__dfsOrig; delete c.__dfsStubs; } })()`
                );
            } catch (e) {
                console.error(`diff-file-states teardown: restore the page failed: ${e?.message ?? e}`);
            }
            if (ctx.project) {
                // deleteproject leaves the channel createproject made, so that goes too
                try {
                    await h.rpc("deleteproject", { name: ctx.project });
                    const n = (p) => (p || "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
                    const channels = (await h.rpc("getchannels", null))?.channels ?? [];
                    for (const c of channels.filter((c) => n(c.projectpath) === n(ctx.dir))) {
                        await h.rpc("deletechannel", { channelid: c.oid });
                    }
                } catch (e) {
                    console.error(`diff-file-states teardown: remove the project failed: ${e?.message ?? e}`);
                }
            }
            // reloads the page (dropping every module state this scenario left) and removes the temp dir
            await teardownFixtureRun(h, ctx, "diff-file-states");
        },
    };
    return [scenario];
}
