// code-blame-draft: blame follows unsaved edits (docs/superpowers/plans/2026-11-06-kael-sync-surfaces.md, Task 5; the fork's
// ff2540f33). Blame describes the saved file, so with a draft open each blame entry has to sit beside its own saved lines where
// the draft moved them, and a line git has never seen reads "unsaved" instead of borrowing a neighbour's blame. Two lines
// are inserted at the top of an open file without saving.
//
// The seed is `code-blame` in scenarios.mjs, minus the orchestrator run: no row here needs a run credited, so the project is a
// plain temp repo of two commits (the second changes line four), registered the same way and picked in the same Code picker.
//
// kit is scenarios.mjs's CODE_KIT. What it lacks is here: the page-side reads and the module import that reaches codestore.ts
// (the editor takes no text a CDP session types, so the edit goes through editDraft, which the editor's onChange calls).

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const NAME = "verify-code-blame-draft";
const SECOND = "edit line four";
const INSERTED = ["inserted1", "inserted2"];
// the saved file is the kit's blameLines() with line four changed in the second commit. Its lines are one word each, so a
// Monaco line's text is its own and whitespace cannot differ from what is written here.
const SAVED_EDITS = { 4: "FOUR" };

// the editor takes the unsaved edit through editDraft, which lives in codestore.ts. A hot-updated module is a second instance
// when imported by its bare url, so the url is read out of the transformed source of a module that imports it (the dev server
// answers any query with the current source), the way scenarios.mjs's lookResolveInPage does; resource timing, which holds 250
// entries, is only the fallback. Runs in the page.
const IN_PAGE = `
    const nap = (ms) => new Promise((r) => setTimeout(r, ms));
    const flat = (el) => (el?.textContent ?? "").replace(/\\s+/g, " ").trim();
    const until = async (fn, ms = 8000) => {
        for (const t0 = Date.now(); Date.now() - t0 < ms; await nap(150)) if (fn()) return true;
        return !!fn();
    };
    const codestore = async () => {
        const main = [...document.querySelectorAll('script[type="module"][src]')].find((s) => /\\/main\\.tsx(\\?|$)/.test(s.src));
        if (main != null) {
            const importer = main.src.replace(/tauri\\/main\\.tsx.*$/, "app/view/code/codeblamestore.ts");
            const source = await fetch(importer).then((r) => (r.ok ? r.text() : "")).catch(() => "");
            const m = source.match(/from\\s*["']([^"']*\\/codestore\\.ts[^"']*)["']/);
            if (m != null) return import(new URL(m[1], importer).href);
        }
        const hit = performance.getEntriesByType("resource").map((e) => e.name).filter((n) => /\\/app\\/view\\/code\\/codestore\\.ts(\\?|$)/.test(n)).pop();
        if (hit == null) throw new Error("no url for codestore.ts");
        return import(hit);
    };
    const box = (el) => {
        const r = el.getBoundingClientRect();
        return { top: Math.round(r.top), bottom: Math.round(r.bottom) };
    };
    // where an editor line is drawn, by its text
    const lineBox = (t) => {
        const el = [...document.querySelectorAll(".monaco-editor .view-line")].find((l) => flat(l) === t);
        return el == null ? null : box(el);
    };
    // the blame rows, top to bottom, and the unsaved marks
    const blameRows = () =>
        [...document.querySelectorAll("[data-code-blame-column] [data-code-blame-entry]")]
            .map((r) => ({ subject: (r.getAttribute("title") || "").split(" — ")[0], ...box(r) }))
            .sort((a, b) => a.top - b.top);
    const unsavedMarks = () =>
        [...document.querySelectorAll("[data-code-blame-column] [data-code-blame-unsaved]")].map((r) => ({ text: flat(r), ...box(r) }));
    const read = (names) => ({
        rows: blameRows(),
        marks: unsavedMarks(),
        lines: Object.fromEntries(names.map((n) => [n, lineBox(n)])),
    });
`;
const inPage = (h, body) => h.ev(`(async () => { ${IN_PAGE} ${body} })()`);

// a row sits beside a line when their tops agree to a pixel or two of rounding
const beside = (row, line) => row != null && line != null && Math.abs(row.top - line.top) <= 2;

export default function (kit) {
    const { git, chooseProjectNamed, waitForProjectInConfig, polishWaitFor, polishNap, BLAME_FILE, BLAME_SEED, blameLines } = kit;
    const ROWS = `document.querySelectorAll("[data-code-blame-column] [data-code-blame-entry]").length`;
    const SAVED_NAMES = ["one", "three", "FOUR", "five"];

    const scenario = {
        name: "code-blame-draft",
        surface: "code",
        async arrange(h) {
            const cwd = mkdtempSync(join(tmpdir(), "verify-code-blame-draft-"));
            const ctx = { cwd, name: NAME };
            try {
                git(cwd, "init", "-q", "--initial-branch=main");
                writeFileSync(join(cwd, BLAME_FILE), blameLines());
                git(cwd, "add", ".");
                git(cwd, "commit", "-q", "-m", BLAME_SEED);
                writeFileSync(join(cwd, BLAME_FILE), blameLines(SAVED_EDITS));
                git(cwd, "commit", "-q", "-am", SECOND);
                await h.rpc("createproject", { name: NAME, path: cwd });
                ctx.project = true;
                await waitForProjectInConfig(h, NAME);
                await h.reload();
            } catch (e) {
                ctx.arrangeError = String(e?.message ?? e);
            }
            return ctx;
        },
        async assert(h, ctx) {
            if (ctx.arrangeError) return [{ step: "arrange the temp repo", ok: false, detail: ctx.arrangeError }];
            const steps = [];
            const rec = (step, ok, detail) => steps.push({ step, ok, detail });

            await h.goto("code");
            // another Code scenario may have left a project loaded, which the picker helper would then not open; pick this one
            // whenever the chip does not already name it
            const onProject = () =>
                h.ev(`(document.querySelector('[data-code-project-picker]')?.textContent ?? '').includes(${JSON.stringify(NAME)})`);
            if ((await onProject()) !== true) {
                await h.ev(`document.querySelector('[data-code-project-picker]')?.click()`);
                await polishNap(300);
                await chooseProjectNamed(h, NAME);
                await polishWaitFor(h, `(document.querySelector('[data-code-project-picker]')?.textContent ?? '').includes(${JSON.stringify(NAME)})`, 8000);
            }
            const TREE_ROW = `[...document.querySelectorAll('[data-code-tree] [role="treeitem"]')].find((r) => r.textContent.includes(${JSON.stringify(BLAME_FILE)}))`;
            await polishWaitFor(h, `!!${TREE_ROW}`, 10000);
            await h.ev(`${TREE_ROW}?.click()`);
            const editor = await polishWaitFor(
                h,
                `document.querySelector('[data-code-path]')?.getAttribute('data-code-path') === ${JSON.stringify(BLAME_FILE)} && !!document.querySelector('.monaco-editor .view-line')`,
                10000
            );
            // the toggle is module state another scenario may have left on
            await h.ev(`(() => { if (!document.querySelector('[data-code-blame-column]')) document.querySelector('[data-code-blame-toggle]')?.click(); })()`);
            // the first blame after launch reads every landed run's commits to credit them
            const shown = await polishWaitFor(h, `${ROWS} >= 3`, 40000);
            await polishNap(300);
            const saved = await inPage(h, `return read(${JSON.stringify(SAVED_NAMES)});`);
            await h.shot("cdp-shots/code-blame-draft-saved.png");
            const [first0, second0, third0] = saved?.rows ?? [];
            rec(
                "with no draft, three blame rows sit beside their own lines and nothing reads unsaved",
                editor === true &&
                    shown === true &&
                    saved?.rows?.length === 3 &&
                    first0.subject === BLAME_SEED &&
                    second0.subject === SECOND &&
                    third0.subject === BLAME_SEED &&
                    beside(first0, saved.lines.one) &&
                    beside(second0, saved.lines.FOUR) &&
                    beside(third0, saved.lines.five) &&
                    saved.marks.length === 0,
                JSON.stringify({ editor, shown, saved })
            );

            try {
                const drafted = await inPage(
                    h,
                    `
                    const { editDraft } = await codestore();
                    editDraft(${JSON.stringify(INSERTED.join("\n") + "\n" + blameLines(SAVED_EDITS))});
                    const seen = await until(() => lineBox(${JSON.stringify(INSERTED[1])}) != null && unsavedMarks().length > 0, 6000);
                    await nap(400);
                    return { seen, ...read(${JSON.stringify([...INSERTED, ...SAVED_NAMES])}) };
                `
                );
                await h.shot("cdp-shots/code-blame-draft-inserted.png");
                const [first, second, third] = drafted?.rows ?? [];
                rec(
                    "after two lines are inserted at the top, the rows still sit beside their own lines, not the inserted ones",
                    drafted?.seen === true &&
                        drafted.rows.length === 3 &&
                        first.subject === BLAME_SEED &&
                        second.subject === SECOND &&
                        third.subject === BLAME_SEED &&
                        beside(first, drafted.lines.one) &&
                        beside(second, drafted.lines.FOUR) &&
                        beside(third, drafted.lines.five),
                    JSON.stringify(drafted)
                );
                const mark = drafted?.marks?.[0];
                const first1 = drafted?.lines?.[INSERTED[0]];
                // the mark spans both inserted lines: from the first one's top to the top of the saved line one that follows them
                const covered = (drafted?.rows ?? []).some((r) => first1 != null && r.top <= first1.top + 2 && r.bottom > first1.top + 2);
                rec(
                    "the two inserted lines read unsaved in one mark, and no commit's row covers them",
                    drafted?.marks?.length === 1 &&
                        mark.text === "unsaved" &&
                        beside(mark, first1) &&
                        Math.abs(mark.bottom - (drafted.lines.one?.top ?? -99)) <= 2 &&
                        !covered,
                    JSON.stringify({ marks: drafted?.marks, first1, one: drafted?.lines?.one, covered })
                );
            } catch (e) {
                rec("insert two lines at the top without saving", false, String(e?.message ?? e));
            } finally {
                // the draft is persisted: leave none behind for the next scenario to open under
                const back = await inPage(
                    h,
                    `
                    const { revertDraft } = await codestore();
                    revertDraft();
                    await until(() => unsavedMarks().length === 0 && lineBox(${JSON.stringify(INSERTED[0])}) == null, 6000);
                    await nap(400);
                    return read(${JSON.stringify(SAVED_NAMES)});
                `
                ).catch((e) => ({ error: String(e?.message ?? e) }));
                const [r1, r2, r3] = back?.rows ?? [];
                rec(
                    "discarding the draft puts the rows back beside the saved lines and clears the mark",
                    back?.rows?.length === 3 &&
                        back.marks.length === 0 &&
                        beside(r1, back.lines.one) &&
                        beside(r2, back.lines.FOUR) &&
                        beside(r3, back.lines.five),
                    JSON.stringify(back)
                );
            }
            return steps;
        },
        async teardown(h, ctx) {
            const step = async (what, fn) => {
                try {
                    await fn();
                } catch (e) {
                    console.error(`code-blame-draft teardown: ${what} failed: ${e?.message ?? e}`);
                }
            };
            await step("hide blame", () =>
                h.ev(`(() => { if (document.querySelector('[data-code-blame-column]')) document.querySelector('[data-code-blame-toggle]')?.click(); })()`)
            );
            await step("leave Code", () => h.goto("cockpit"));
            if (ctx?.project) await step("delete the project", () => h.rpc("deleteproject", { name: ctx.name }));
            if (ctx?.cwd) await step(`remove ${ctx.cwd}`, () => rmSync(ctx.cwd, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 }));
        },
    };
    return [scenario];
}
