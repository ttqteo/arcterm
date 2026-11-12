// code-fixes-session, code-fixes-diff-states and code-changed-walk: the Code surface review fixes for a session's view of its
// files: the session, the Diff view's states and the Changed pane's keyboard walk
// (docs/superpowers/plans/2026-11-12-kael-sync-code-diff-usage-setup.md, Task 9; the fork's 3ac8d932b, 5f16e421b, c3d985bb6,
// a857dd852 and 7f95de490, and its code-session, code-diff-states and code-changed scenarios).
// kits is scenarios.mjs's KAEL_KITS ({ rt, code, files, jarvis }).
//
// What the fork's steps did that this port does not: a stored folder opened by path is not restored after a reload and a
// refused save does not raise the stale bar (our rules for both stay, so no step asserts them); Compare with disk is reached
// from the stale bar the focus check raises, which the diff-states steps call (checkStale) the way a window focus does.
//
// The repos are written by the scenario and registered as projects, picked in the Code picker. Monaco takes no text a CDP
// session types, so an edit goes through editDraft (which the editor's onChange calls), and the name inputs are set the way
// the finder's scenarios set theirs. The app modules are reached through the page's own module graph (see IN_PAGE).

import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { SURFACE_LABEL } from "./attach.mjs";

const VIEWPORT = { width: 1600, height: 950, deviceScaleFactor: 1, mobile: false };

// The url of an app module as the app loaded it, read out of the transformed source of the modules that import it, static or
// lazy (the Code surface is a lazy chunk, so a graph of static imports alone never reaches codestore.ts). A hot-updated module's
// url carries `?t=<stamp>` and an import of the bare url is another instance, whose atoms are not the ones the app renders from;
// resource timing cannot name it either, since its buffer holds 250 entries, fewer than an unbundled dev page loads. This is
// scenarios.mjs's lookResolveInPage (not exported, so copied); it walks the graph from main.tsx once per page. Runs IN THE PAGE
// (IN_PAGE sends its source); returns null when the graph holds no such module.
async function resolveInPage(path) {
    const sourceOf = async (url) => {
        try {
            const res = await fetch(url);
            return res.ok ? await res.text() : "";
        } catch {
            return "";
        }
    };
    const importsIn = (source, base) => {
        const urls = [];
        for (const m of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["']([^"'\s]+)["']/g)) {
            if (/^(\/|\.\.?\/)/.test(m[1])) urls.push(new URL(m[1], base).href);
        }
        return urls;
    };
    const bare = (url) => url.split("?")[0];
    const isCode = (url) => /\.(tsx?|jsx?|mjs)$/.test(bare(url)) && !/node_modules|\/@vite\//.test(url);
    const graph = (window.__arcLookGraph ??= { importers: new Map(), done: null });
    if (graph.done == null) {
        graph.done = (async () => {
            const entry = [...document.querySelectorAll('script[type="module"][src]')].find((s) => /\/main\.tsx(\?|$)/.test(s.src));
            if (!entry) return;
            const seen = new Set([bare(entry.src)]);
            let level = [entry.src];
            while (level.length > 0 && seen.size < 6000) {
                const next = [];
                for (let i = 0; i < level.length; i += 40) {
                    const chunk = level.slice(i, i + 40);
                    const sources = await Promise.all(chunk.map(sourceOf));
                    sources.forEach((source, k) => {
                        for (const url of importsIn(source, chunk[k])) {
                            if (!isCode(url) || seen.has(bare(url))) continue;
                            seen.add(bare(url));
                            graph.importers.set(bare(url), chunk[k]);
                            next.push(url);
                        }
                    });
                }
                level = next;
            }
        })();
    }
    await graph.done;
    const key = [...graph.importers.keys()].find((k) => k.endsWith("/" + path));
    if (key == null) return null;
    // the importer's own url needs no query: the dev server answers any query with the current source
    const importer = graph.importers.get(key);
    return importsIn(await sourceOf(importer), importer).find((u) => bare(u) === key) ?? null;
}

const IN_PAGE = `
    const nap = (ms) => new Promise((r) => setTimeout(r, ms));
    const flat = (el) => (el?.textContent ?? "").replace(/\\s+/g, " ").trim();
    const until = async (fn, ms = 8000) => {
        for (const t0 = Date.now(); Date.now() - t0 < ms; await nap(150)) if (fn()) return true;
        return !!fn();
    };
    const resolveInPage = ${resolveInPage.toString()};
    const mod = async (path) => {
        const resolved = await resolveInPage(path).catch(() => null);
        if (resolved != null) return import(resolved);
        const names = performance.getEntriesByType("resource").map((e) => e.name.split("?")[0]);
        const hit = names.filter((n) => n.endsWith("/" + path)).pop();
        const base = names.find((n) => n.endsWith("/app/store/jotaiStore.ts"));
        if (hit == null && base == null) throw new Error("no app module url for " + path);
        return import(hit ?? base.replace("app/store/jotaiStore.ts", path));
    };
    const S = await mod("app/store/jotaiStore.ts");
    const C = await mod("app/view/code/codestore.ts");
    const rows = () => [...document.querySelectorAll('[data-code-tree] [role="treeitem"]')];
    const row = (name) => rows().find((r) => (r.querySelector("span.min-w-0")?.textContent ?? "") === name) ?? null;
    const headerButton = (label) => document.querySelector('button[aria-label="' + label + '"]');
    const openPath = () => document.querySelector("[data-code-path]")?.getAttribute("data-code-path") ?? null;
    const chip = () => flat(document.querySelector("[data-code-project-picker]"));
    // a button by its own text, as a person reads it (the header's icon buttons have only an aria-label)
    const button = (root, re) => [...(root?.querySelectorAll("button") ?? [])].find((b) => re.test(flat(b))) ?? null;
`;
const inPage = (h, body) => h.ev(`(async () => { ${IN_PAGE} ${body} })()`);

const key = async (h, name, code, vk) => {
    await h.cdp("Input.dispatchKeyEvent", { type: "keyDown", key: name, code, windowsVirtualKeyCode: vk, ...(name === "Enter" ? { text: "\r" } : {}) });
    await h.cdp("Input.dispatchKeyEvent", { type: "keyUp", key: name, code, windowsVirtualKeyCode: vk });
};

export default function (kits) {
    const { code } = kits;
    const { git, chooseProjectNamed, waitForProjectInConfig, polishWaitFor, polishNap } = code;

    // a repo of committed files, registered as a project
    const makeRepo = (prefix, files) => {
        const dir = mkdtempSync(join(tmpdir(), prefix));
        git(dir, "init", "-q", "--initial-branch=main");
        for (const [rel, body] of Object.entries(files)) {
            mkdirSync(dirname(join(dir, rel)), { recursive: true });
            writeFileSync(join(dir, rel), body);
        }
        git(dir, "add", ".");
        git(dir, "commit", "-q", "-m", "seed");
        return dir;
    };

    const register = async (h, ctx, name, dir) => {
        await h.rpc("createproject", { name, path: dir });
        (ctx.projects ??= []).push(name);
        await waitForProjectInConfig(h, name);
    };

    const teardown = (what) => async (h, ctx) => {
        const step = async (label, fn) => {
            try {
                await fn();
            } catch (e) {
                console.error(`${what} teardown: ${label} failed: ${e?.message ?? e}`);
            }
        };
        await step("drop the draft and the stored project", () =>
            inPage(
                h,
                `
                C.revertDraft();
                S.globalStore.set(C.lastCodeProjectAtom, null);
                await C.selectProject(null);
            `
            )
        );
        await step("clear the viewport", () => h.cdp("Emulation.clearDeviceMetricsOverride"));
        await step("put the app-bar project back to all", () =>
            inPage(
                h,
                `
                const sw = document.querySelector('[data-project-switcher="bar"]');
                if (sw == null) return false;
                sw.click();
                await until(() => document.querySelector('[data-project-option="all"]') != null, 3000);
                document.querySelector('[data-project-option="all"]')?.click();
                await nap(200);
                return true;
            `
            )
        );
        await step("leave Code", () => h.goto("cockpit"));
        for (const name of ctx?.projects ?? []) await step(`delete project ${name}`, () => h.rpc("deleteproject", { name }));
        for (const dir of ctx?.dirs ?? []) {
            await step(`remove ${dir}`, () => rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 }));
        }
    };

    // Code, on the named project (the picker is opened only when the chip does not already name it)
    const openProject = async (h, name, rec) => {
        await h.cdp("Emulation.setDeviceMetricsOverride", VIEWPORT);
        await h.goto("code");
        rec("Code surface is active", (await h.activeSurfaceLabel()) === SURFACE_LABEL.code, `active=${await h.activeSurfaceLabel()}`);
        const onProject = () => h.ev(`(document.querySelector('[data-code-project-picker]')?.textContent ?? '').includes(${JSON.stringify(name)})`);
        if ((await onProject()) !== true) {
            await h.ev(`document.querySelector('[data-code-project-picker]')?.click()`);
            await polishNap(300);
            await chooseProjectNamed(h, name);
            await polishWaitFor(h, `(document.querySelector('[data-code-project-picker]')?.textContent ?? '').includes(${JSON.stringify(name)})`, 8000);
        }
        const landed = (await onProject()) === true && (await polishWaitFor(h, `document.querySelectorAll('[data-code-tree] [role="treeitem"]').length > 0`, 10000));
        rec(`select the project ${name}`, landed === true, `chip names ${name}, tree listed`);
        return landed === true;
    };

    // A fresh dev server optimises the editor's dependencies the first time Code opens a file, and reloads the page when it does,
    // which ends an evaluation in flight; a narrowed run has no earlier Code scenario to take that, so it is taken here (the first
    // Code scenario of a full run has already).
    const warm = async (h, name) => {
        for (let attempt = 0; attempt < 4; attempt++) {
            try {
                if (!(await openProject(h, name, () => {}))) throw new Error("project not listed");
                await h.ev(`document.querySelector('[data-code-tree] [role="treeitem"]:not([aria-expanded])')?.click()`);
                if (await polishWaitFor(h, `!!document.querySelector(".monaco-editor .view-line")`, 15000)) return true;
            } catch {
                await polishNap(4000);
            }
        }
        return false;
    };

    // ---- code-fixes-session -------------------------------------------------------------------------------------------

    const ALPHA = "vcfs-alpha";
    const BETA = "vcfs-beta";
    const shot = (h, name) => h.shot(`cdp-shots/code-fixes-session-${name}.png`);

    const sessionScenario = {
        name: "code-fixes-session",
        surface: "code",
        async arrange(h) {
            const ctx = { dirs: [] };
            try {
                const alpha = makeRepo("verify-cfs-alpha-", {
                    "README.md": "# demo\n",
                    "src/a.ts": "export const a = 1;\n",
                    "src/b.ts": "export const b = 2;\n",
                });
                const beta = makeRepo("verify-cfs-beta-", { "beta-only.txt": "the other project\n" });
                ctx.dirs.push(alpha, beta);
                await register(h, ctx, ALPHA, alpha);
                await register(h, ctx, BETA, beta);
                await h.reload();
                await warm(h, ALPHA);
            } catch (e) {
                ctx.arrangeError = String(e?.message ?? e);
            }
            return ctx;
        },
        async assert(h, ctx) {
            if (ctx.arrangeError) return [{ step: "arrange the temp repos", ok: false, detail: ctx.arrangeError }];
            const steps = [];
            const rec = (step, ok, detail) => steps.push({ step, ok: ok === true, detail });
            if (!(await openProject(h, ALPHA, rec))) return steps;

            // 1. Refresh index keeps the open file, its expanded folder and an enabled Back
            await inPage(
                h,
                `
                row("README.md")?.click();
                await until(() => openPath() === "README.md", 6000);
                if (row("src")?.getAttribute("aria-expanded") !== "true") row("src")?.click();
                await until(() => row("b.ts") != null, 4000);
                row("b.ts")?.click();
                await until(() => openPath() === "src/b.ts", 6000);
            `
            );
            const refresh = await inPage(
                h,
                `
                const before = S.globalStore.get(C.codeIndexAtom);
                headerButton("Refresh index")?.click();
                const landed = await until(() => { const i = S.globalStore.get(C.codeIndexAtom); return i != null && i !== before; }, 8000);
                await nap(400);
                return { landed, file: openPath(), expanded: row("src")?.getAttribute("aria-expanded"), back: headerButton("Back")?.disabled };
            `
            );
            await shot(h, "refresh");
            rec(
                "Refresh index keeps the open file, its expanded folder and an enabled Back",
                refresh?.landed === true && refresh.file === "src/b.ts" && refresh.expanded === "true" && refresh.back === false,
                JSON.stringify(refresh)
            );

            // 2. re-picking the project that is shown only closes the picker
            const repick = await inPage(
                h,
                `
                document.querySelector("[data-code-project-picker]")?.click();
                await until(() => document.querySelector("[data-code-picker-row]") != null, 3000);
                const row0 = [...document.querySelectorAll("[data-code-picker-row]")].find((r) => r.getAttribute("data-code-picker-row") === ${JSON.stringify(ALPHA)});
                row0?.click();
                const closed = await until(() => document.querySelector("[data-code-picker-row]") == null, 3000);
                await nap(500);
                return { clicked: row0 != null, closed, file: openPath(), back: headerButton("Back")?.disabled, expanded: row("src")?.getAttribute("aria-expanded") };
            `
            );
            await shot(h, "repick");
            rec(
                "picking the project that is already shown closes the picker and keeps the open file and its expanded folder",
                repick?.clicked === true && repick.closed === true && repick.file === "src/b.ts" && repick.back === false && repick.expanded === "true",
                JSON.stringify(repick)
            );

            // 3. a click outside the picker closes it, on the page beneath it as well
            await h.ev(`document.querySelector("[data-code-project-picker]")?.click()`);
            const opened = await polishWaitFor(h, `document.querySelector("[data-code-picker-backdrop]") != null && document.querySelector("[data-code-picker-row]") != null`, 4000);
            await polishNap(300);
            await shot(h, "picker-open");
            for (const type of ["mousePressed", "mouseReleased"]) {
                await h.cdp("Input.dispatchMouseEvent", { type, x: 800, y: 700, button: "left", clickCount: 1 });
            }
            const closed = await polishWaitFor(h, `document.querySelector("[data-code-picker-backdrop]") == null && document.querySelector("[data-code-picker-row]") == null`, 3000);
            await shot(h, "picker-closed");
            rec("a click outside the open picker closes it", opened === true && closed === true, `opened=${opened} closed=${closed}`);

            // 4. an unsaved draft shows on its row, on a collapsed folder above it, and in the header's list
            const draft = await inPage(
                h,
                `
                await until(() => document.querySelector(".monaco-editor") != null, 8000);
                C.editDraft("export const b = 2;\\n// mine\\n");
                await nap(300);
                const onRow = row("b.ts")?.querySelector('[aria-label="Unsaved edits"]') != null;
                row("README.md")?.click();
                await until(() => openPath() === "README.md", 6000);
                if (row("src")?.getAttribute("aria-expanded") === "true") row("src")?.click();
                await until(() => row("src")?.getAttribute("aria-expanded") === "false", 3000);
                const onFolder = row("src")?.querySelector('[aria-label="Contains unsaved edits"]') != null;
                const count = document.querySelector("[data-code-unsaved-count]");
                const label = flat(count);
                count?.click();
                const listed = await until(() => document.querySelector('[data-code-unsaved-row="src/b.ts"]') != null, 3000);
                return { onRow, onFolder, label, listed };
            `
            );
            await polishNap(300);
            await shot(h, "unsaved");
            rec(
                "an unsaved draft shows its dot on the file's row, on the collapsed folder above it, and as 1 unsaved in the header",
                draft?.onRow === true && draft.onFolder === true && draft.label === "1 unsaved" && draft.listed === true,
                JSON.stringify(draft)
            );
            const reopened = await inPage(
                h,
                `
                document.querySelector('[data-code-unsaved-row="src/b.ts"]')?.click();
                const there = await until(() => openPath() === "src/b.ts", 6000);
                return { there, menuClosed: await until(() => document.querySelector("[data-code-unsaved-row]") == null, 3000) };
            `
            );
            rec("a row of that list opens the file", reopened?.there === true && reopened.menuClosed === true, JSON.stringify(reopened));
            await inPage(h, `C.revertDraft(); await nap(300);`);

            // 5. New folder, then New folder with the same name: the empty folder is only in the session's dirs, and still collides
            const folder = await inPage(
                h,
                `
                const type = async (name) => {
                    S.globalStore.set(C.codeCursorAtom, null); // a root-level folder
                    headerButton("New folder (Shift+N)")?.click();
                    await until(() => document.querySelector("[data-code-name-input]") != null, 4000);
                    const input = document.querySelector("[data-code-name-input]");
                    if (input == null) return null;
                    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, name);
                    input.dispatchEvent(new Event("input", { bubbles: true }));
                    await nap(150);
                    return input;
                };
                const first = await type("fresh");
                first?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
                await until(() => row("fresh") != null, 4000);
                await nap(300);
                const made = { row: row("fresh") != null, selected: row("fresh")?.getAttribute("aria-selected"), expanded: row("fresh")?.getAttribute("aria-expanded") };
                const EXISTS = "Something with that name is already here.";
                const again = await type("fresh");
                await until(() => again?.parentElement?.textContent?.includes(EXISTS), 2000);
                const message = again?.parentElement?.textContent ?? "";
                again?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
                await nap(500);
                const stillOpen = document.querySelector("[data-code-name-input]") != null;
                const freshRows = rows().filter((r) => (r.querySelector("span.min-w-0")?.textContent ?? "") === "fresh").length;
                document.querySelector("[data-code-name-input]")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
                const closed = await until(() => document.querySelector("[data-code-name-input]") == null, 2000);
                return { made, message, stillOpen, freshRows, closed };
            `
            );
            await shot(h, "new-folder-exists");
            rec(
                "New folder makes a selected, expanded row for the empty folder; the same name again is refused as existing, makes no second row, and Escape cancels",
                folder?.made?.row === true &&
                    folder.made.selected === "true" &&
                    folder.made.expanded === "true" &&
                    (folder.message ?? "").includes("Something with that name is already here.") &&
                    folder.stillOpen === true &&
                    folder.freshRows === 1 &&
                    folder.closed === true,
                JSON.stringify(folder)
            );

            // 6. a project picked in the app bar while Code shows opens in Code
            const followed = await inPage(
                h,
                `
                const pick = async (name) => {
                    document.querySelector('[data-project-switcher="bar"]')?.click();
                    await until(() => document.querySelector('[data-project-option="' + name + '"]') != null, 4000);
                    document.querySelector('[data-project-option="' + name + '"]')?.click();
                    await nap(300);
                };
                const title = document.querySelector('[data-project-switcher="bar"]')?.getAttribute("title") ?? null;
                await pick("all");
                const before = chip();
                await pick(${JSON.stringify(BETA)});
                const there = await until(() => chip().includes(${JSON.stringify(BETA)}) && row("beta-only.txt") != null, 8000);
                return { title, before, chip: chip(), there, project: S.globalStore.get(C.codeProjectAtom)?.name ?? null };
            `
            );
            await polishNap(300);
            await shot(h, "follow");
            rec(
                "a project picked in the app bar while Code shows is opened by Code, and the switcher's title says so",
                followed?.there === true &&
                    followed.project === BETA &&
                    followed.before.includes(ALPHA) &&
                    followed.title === "Set the project default; Code opens it",
                JSON.stringify(followed)
            );
            return steps;
        },
        teardown: teardown("code-fixes-session"),
    };

    // ---- code-fixes-diff-states ---------------------------------------------------------------------------------------

    const DIFF = "vcfs-diff";
    const GONE = "gone.txt";
    const SAME = "same.txt";
    const NOTES = "notes.txt";
    const FRESH = "fresh-new.txt";
    const GONE_TEXT = "alpha line\nbeta line\ngamma line\n";
    const DRAFT = "first line\nmy unsaved edit\n";
    const ON_DISK = "first line\nan agent wrote this\n";
    const dshot = (h, name) => h.shot(`cdp-shots/code-fixes-diff-states-${name}.png`);

    // the deleted view once its diff has drawn the HEAD copy
    const READ_DELETED = `
        const root = () => document.querySelector("[data-code-deleted]");
        // the diff paints its text before it has computed which lines were removed
        const drawn = await until(() => {
            const d = root()?.querySelector(".monaco-diff-editor");
            return d != null && flat(d).includes("beta line") && root().querySelectorAll(".line-delete, .char-delete, .gutter-delete").length > 0;
        }, 10000);
        return {
            drawn,
            title: flat(root()).includes("Deleted in the working tree"),
            refresh: button(document.body, /Refresh index/) != null,
            removed: root()?.querySelectorAll(".line-delete, .char-delete, .gutter-delete").length ?? 0,
        };
    `;
    // the diff header: its target, its label, and each option's pressed and disabled state
    const READ_HEADER = `
        const t = document.querySelector("[data-code-diff-target]");
        const opt = (o) => {
            const b = document.querySelector('[data-code-diff-option="' + o + '"]');
            return b == null ? null : { pressed: b.getAttribute("aria-pressed") === "true", disabled: b.disabled, title: b.title };
        };
        const header = { target: t?.getAttribute("data-code-diff-target") ?? "", label: flat(t), head: opt("head"), base: opt("base") };
    `;

    const diffStatesScenario = {
        name: "code-fixes-diff-states",
        surface: "code",
        async arrange(h) {
            const ctx = { dirs: [] };
            try {
                const dir = makeRepo("verify-cfs-diff-", {
                    [GONE]: GONE_TEXT,
                    [SAME]: "unchanged\n",
                    [NOTES]: "first line\n",
                });
                ctx.dir = dir;
                ctx.dirs.push(dir);
                // a tracked file the working tree lost, and a file git has never seen
                unlinkSync(join(dir, GONE));
                writeFileSync(join(dir, FRESH), "new one\nnew two\nnew three\n");
                await register(h, ctx, DIFF, dir);
                await h.reload();
                await warm(h, DIFF);
            } catch (e) {
                ctx.arrangeError = String(e?.message ?? e);
            }
            return ctx;
        },
        async assert(h, ctx) {
            if (ctx.arrangeError) return [{ step: "arrange the temp repo", ok: false, detail: ctx.arrangeError }];
            const steps = [];
            const rec = (step, ok, detail) => steps.push({ step, ok: ok === true, detail });
            if (!(await openProject(h, DIFF, rec))) return steps;

            // 1. a deleted tracked file, from the tree
            const fromTree = await inPage(
                h,
                `
                await until(() => row(${JSON.stringify(GONE)}) != null, 8000);
                row(${JSON.stringify(GONE)})?.click();
                ${READ_DELETED}
            `
            );
            await dshot(h, "deleted-tree");
            rec(
                "a deleted tracked file opened from the tree shows Deleted in the working tree with its HEAD copy removed, and no Refresh index",
                fromTree?.drawn === true && fromTree.title === true && fromTree.refresh === false && fromTree.removed > 0,
                JSON.stringify(fromTree)
            );

            // 2. the same view from the Changed pane's D row
            const fromChanged = await inPage(
                h,
                `
                row(${JSON.stringify(SAME)})?.click();
                await until(() => document.querySelector("[data-code-deleted]") == null && openPath() === ${JSON.stringify(SAME)}, 6000);
                document.querySelector('[data-code-column-tab="changed"]')?.click();
                const changedRow = () => document.querySelector('[data-code-changed-row=${JSON.stringify(GONE)}]');
                await until(() => changedRow() != null, 8000);
                const letter = flat(changedRow()).slice(0, 1);
                changedRow()?.click();
                const out = await (async () => { ${READ_DELETED} })();
                document.querySelector('[data-code-column-tab="files"]')?.click();
                return { ...out, letter };
            `
            );
            await dshot(h, "deleted-changed");
            rec(
                "the Changed pane's D row lands on the same deleted view",
                fromChanged?.letter === "D" && fromChanged.drawn === true && fromChanged.title === true && fromChanged.refresh === false,
                JSON.stringify(fromChanged)
            );

            // 3. an unchanged file says so, and the header's Branch base is disabled with its reason on main
            const unchanged = await inPage(
                h,
                `
                await until(() => row(${JSON.stringify(SAME)}) != null, 4000);
                row(${JSON.stringify(SAME)})?.click();
                await until(() => openPath() === ${JSON.stringify(SAME)}, 6000);
                document.querySelector('[data-code-view-mode="diff"]')?.click();
                const said = await until(() => (document.body.textContent || "").includes("No changes against HEAD"), 8000);
                await until(() => document.querySelector('[data-code-diff-option="base"]')?.disabled === true, 6000);
                ${READ_HEADER}
                return { said, diff: document.querySelector(".monaco-diff-editor") != null, header };
            `
            );
            await dshot(h, "unchanged");
            rec(
                "an unchanged file says No changes against HEAD instead of two equal columns, and Branch base is disabled with its reason on main",
                unchanged?.said === true &&
                    unchanged.diff === false &&
                    unchanged.header?.head?.pressed === true &&
                    unchanged.header?.base?.disabled === true &&
                    (unchanged.header?.base?.title ?? "") !== "",
                JSON.stringify(unchanged)
            );

            // 4. a file that is not in HEAD draws every line inserted and no removed line
            const created = await inPage(
                h,
                `
                await until(() => row(${JSON.stringify(FRESH)}) != null, 6000);
                row(${JSON.stringify(FRESH)})?.click();
                await until(() => openPath() === ${JSON.stringify(FRESH)}, 6000);
                document.querySelector('[data-code-view-mode="diff"]')?.click();
                const drawn = await until(() => document.querySelector(".monaco-editor .view-overlays .line-insert") != null, 8000);
                await nap(400);
                const ed = document.querySelector(".monaco-editor");
                ${READ_HEADER}
                return {
                    drawn,
                    lines: ed?.querySelectorAll(".view-line").length ?? 0,
                    inserted: ed?.querySelectorAll(".view-overlays .line-insert").length ?? 0,
                    removed: document.querySelectorAll(".line-delete, .char-delete, .inline-deleted-margin-view-zone").length,
                    diffEditor: document.querySelector(".monaco-diff-editor") != null,
                    header,
                };
            `
            );
            await dshot(h, "new-file");
            rec(
                "a new file's Diff draws every line as inserted and no removed line, in a plain editor under the HEAD header",
                created?.drawn === true &&
                    created.lines > 0 &&
                    created.inserted === created.lines &&
                    created.removed === 0 &&
                    created.diffEditor === false &&
                    created.header?.target === "head",
                JSON.stringify(created)
            );

            // 5. a commit ahead of main gives the branch a base; only same.txt goes in, so gone.txt stays deleted
            git(ctx.dir, "checkout", "-q", "-b", "feature");
            writeFileSync(join(ctx.dir, SAME), "changed on the feature branch\n");
            git(ctx.dir, "commit", "-q", "-m", "change same", "--", SAME);
            const based = await inPage(
                h,
                `
                document.querySelector('[data-code-view-mode="source"]')?.click();
                row(${JSON.stringify(NOTES)})?.click();
                await until(() => openPath() === ${JSON.stringify(NOTES)}, 6000);
                row(${JSON.stringify(SAME)})?.click();
                await until(() => openPath() === ${JSON.stringify(SAME)}, 6000);
                document.querySelector('[data-code-view-mode="diff"]')?.click();
                const offered = await until(() => { const b = document.querySelector('[data-code-diff-option="base"]'); return b != null && !b.disabled; }, 8000);
                document.querySelector('[data-code-diff-option="base"]')?.click();
                const shown = await until(() => {
                    const d = document.querySelector(".monaco-diff-editor");
                    return document.querySelector('[data-code-diff-target="base"]') != null && d != null && flat(d).includes("unchanged") && flat(d).includes("feature branch");
                }, 8000);
                ${READ_HEADER}
                return { offered, shown, header };
            `
            );
            await dshot(h, "base");
            rec(
                "on a feature branch the header's Branch base is offered and switches the diff to the base, whose side holds main's copy",
                based?.offered === true && based.shown === true && based.header?.base?.pressed === true && /merge-base with/.test(based.header?.label ?? ""),
                JSON.stringify(based)
            );

            // 6. a draft over a file that changed on disk: the stale bar offers Compare with disk beside the reload
            await inPage(
                h,
                `
                document.querySelector('[data-code-view-mode="source"]')?.click();
                row(${JSON.stringify(NOTES)})?.click();
                await until(() => openPath() === ${JSON.stringify(NOTES)} && document.querySelector(".monaco-editor") != null, 8000);
                C.editDraft(${JSON.stringify(DRAFT)});
                await nap(300);
            `
            );
            writeFileSync(join(ctx.dir, NOTES), ON_DISK);
            const compared = await inPage(
                h,
                `
                await C.checkStale(); // what a window focus runs
                const bar = () => document.querySelector("[data-code-stale]");
                await until(() => bar() != null, 4000);
                const labels = [...(bar()?.querySelectorAll("button") ?? [])].map(flat);
                const before = flat(bar());
                button(bar(), /^Compare with disk$/)?.click();
                const shown = await until(() => {
                    const d = document.querySelector(".monaco-diff-editor");
                    return document.querySelector('[data-code-diff-target="disk"]') != null && d != null && flat(d).includes("an agent wrote this") && flat(d).includes("my unsaved edit");
                }, 8000);
                ${READ_HEADER}
                return { labels, before, shown, header };
            `
            );
            await dshot(h, "disk");
            rec(
                "the stale bar over a draft offers Compare with disk, which shows the draft against the disk copy under its own header",
                JSON.stringify(compared?.labels) === JSON.stringify(["Discard my edits and reload", "Compare with disk"]) &&
                    compared.shown === true &&
                    (compared.header?.label ?? "").includes("Your edits against the copy on disk") &&
                    compared.header.head?.pressed === false &&
                    compared.header.base?.pressed === false,
                JSON.stringify(compared)
            );
            await inPage(
                h,
                `
                C.revertDraft();
                document.querySelector('[data-code-view-mode="source"]')?.click();
            `
            );
            return steps;
        },
        teardown: teardown("code-fixes-diff-states"),
    };

    // ---- code-changed-walk --------------------------------------------------------------------------------------------

    const WALK = "vcfs-walk";
    const FILES = ["a.txt", "b.txt", "c.txt"];
    const CHANGED = `[...document.querySelectorAll("[data-code-changed-row]")]`;
    const focusedRow = (h) => h.ev(`document.activeElement?.closest?.("[data-code-changed-row]")?.getAttribute("data-code-changed-row") ?? null`);
    const wshot = (h, name) => h.shot(`cdp-shots/code-changed-walk-${name}.png`);

    const walkScenario = {
        name: "code-changed-walk",
        surface: "code",
        async arrange(h) {
            const ctx = { dirs: [] };
            try {
                const dir = makeRepo("verify-cfs-walk-", Object.fromEntries(FILES.map((f) => [f, "one\n"])));
                ctx.dirs.push(dir);
                for (const f of FILES) writeFileSync(join(dir, f), "one\ntwo\n");
                await register(h, ctx, WALK, dir);
                await h.reload();
                await warm(h, WALK);
            } catch (e) {
                ctx.arrangeError = String(e?.message ?? e);
            }
            return ctx;
        },
        async assert(h, ctx) {
            if (ctx.arrangeError) return [{ step: "arrange the temp repo", ok: false, detail: ctx.arrangeError }];
            const steps = [];
            const rec = (step, ok, detail) => steps.push({ step, ok: ok === true, detail });
            if (!(await openProject(h, WALK, rec))) return steps;
            // the keys below are real CDP presses, which a page that thinks its window is in the background can drop
            await h.cdp("Page.bringToFront").catch(() => {});
            await h.cdp("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});

            const listed = await inPage(
                h,
                `
                // the tree holds focus as the Changed tab replaces it (a click through script moves no focus, so it is still there)
                document.querySelector("[data-code-tree]")?.focus();
                const treeHeld = document.activeElement?.matches?.("[data-code-tree]") ?? false;
                document.querySelector('[data-code-column-tab="changed"]')?.click();
                await until(() => document.querySelectorAll("[data-code-changed-row]").length === ${FILES.length}, 8000);
                return { rows: ${CHANGED}.map((r) => r.getAttribute("data-code-changed-row")), treeHeld, treeFlag: S.globalStore.get(C.codeTreeFocusedAtom) };
            `
            );

            // a sentinel just before the list, so a real Tab press is what lands on the first row
            const placed = await h.ev(`(() => {
                const list = document.querySelector("[data-code-changed-row]")?.parentElement;
                if (!list) return false;
                const s = document.createElement("span");
                s.tabIndex = 0;
                s.setAttribute("data-walk-sentinel", "");
                list.before(s);
                s.focus();
                return document.activeElement === s;
            })()`);
            // what the page's own key listeners saw of each press, for a press that moves nothing
            await h.ev(`(() => {
                window.__walkKeys = [];
                for (const capture of [true, false]) {
                    window.addEventListener("keydown", (e) => window.__walkKeys.push([capture ? "c" : "b", e.key, e.defaultPrevented, document.activeElement?.getAttribute?.("data-code-changed-row") ?? document.activeElement?.tagName, e.isTrusted, document.hasFocus()]), capture);
                }
                return true;
            })()`);
            await key(h, "Tab", "Tab", 9);
            await polishNap(200);
            const tabbed = await h.ev(`(() => {
                const rows = ${CHANGED};
                const at = rows.findIndex((r) => r === document.activeElement);
                return { at, stops: rows.filter((r) => r.tabIndex === 0).length, ring: at === -1 ? null : getComputedStyle(rows[at]).boxShadow };
            })()`);
            await wshot(h, "tab");
            rec(
                "Tab lands on the first row, the list's only tab stop, with a focus ring, and the tree that held focus has let its key bindings go",
                placed === true &&
                    JSON.stringify(listed?.rows) === JSON.stringify(FILES) &&
                    listed.treeHeld === true &&
                    listed.treeFlag === false &&
                    tabbed.at === 0 &&
                    tabbed.stops === 1 &&
                    / 0px 0px 0px [1-9]/.test(tabbed.ring ?? ""),
                JSON.stringify({ placed, listed, tabbed })
            );

            // Each is a real CDP press. The page listener installed above sits behind the app's own key dispatcher, so it counts only
            // the keys the app let through to the page: a press it never counts was claimed by an app binding, which is what the
            // tree's stuck focus flag did to these arrows (codetreepane.tsx), and the step then fails with that in its detail.
            const pressed = [];
            const press = async (name, code, vk) => {
                const count = `(window.__walkKeys ?? []).filter((k) => k[0] === "c" && k[1] === ${JSON.stringify(name)}).length`;
                const before = await h.ev(count);
                const t0 = Date.now();
                await key(h, name, code, vk);
                const arrived = await polishWaitFor(h, `${count} > ${before}`, 3000);
                await polishNap(300);
                pressed.push(arrived ? `${name}:reached the page after ${Date.now() - t0}ms` : `${name}:never reached the page`);
            };

            await press("ArrowDown", "ArrowDown", 40);
            const down1 = await focusedRow(h);
            await press("ArrowDown", "ArrowDown", 40);
            const down2 = await focusedRow(h);
            const stopAfterDown = await h.ev(`${CHANGED}.map((r) => r.tabIndex).join(",")`);
            await wshot(h, "arrow-down");
            rec(
                "ArrowDown walks to the second and the third row, and the tab stop follows",
                down1 === FILES[1] && down2 === FILES[2] && stopAfterDown === "-1,-1,0",
                JSON.stringify({ down1, down2, tabIndexes: stopAfterDown, pressed: [...pressed], keys: await h.ev(`JSON.stringify(window.__walkKeys ?? [])`) })
            );

            await press("ArrowDown", "ArrowDown", 40);
            const pastEnd = await focusedRow(h);
            await press("ArrowUp", "ArrowUp", 38);
            const up = await focusedRow(h);
            await wshot(h, "arrow-up");
            rec(
                "ArrowDown from the last row stays on it, and ArrowUp moves back one row",
                pastEnd === FILES[2] && up === FILES[1],
                JSON.stringify({ pastEnd, up, pressed: [...pressed], keys: await h.ev(`JSON.stringify(window.__walkKeys ?? [])`) })
            );

            await press("Enter", "Enter", 13);
            const editor = await inPage(
                h,
                `
                await until(() => openPath() === ${JSON.stringify(FILES[1])} && document.querySelector(".monaco-editor") != null, 8000);
                return { path: openPath(), monaco: document.querySelector(".monaco-editor") != null };
            `
            );
            await wshot(h, "enter");
            rec("Enter opens the focused row in the editor", editor?.path === FILES[1] && editor.monaco === true, JSON.stringify({ ...editor, pressed: [...pressed] }));

            // a row click opens the file as it always did
            const clicked = await inPage(
                h,
                `
                document.querySelector('[data-code-changed-row="${FILES[2]}"]')?.click();
                const there = await until(() => openPath() === ${JSON.stringify(FILES[2])}, 6000);
                return { there, tag: document.querySelector('[data-code-changed-row="${FILES[2]}"]')?.tagName ?? null };
            `
            );
            rec("a click on a row still opens its file; the rows are buttons", clicked?.there === true && clicked.tag === "BUTTON", JSON.stringify(clicked));
            await inPage(h, `document.querySelector("[data-walk-sentinel]")?.remove(); document.querySelector('[data-code-column-tab="files"]')?.click();`);
            return steps;
        },
        async teardown(h, ctx) {
            await h.cdp("Emulation.setFocusEmulationEnabled", { enabled: false }).catch(() => {});
            await teardown("code-changed-walk")(h, ctx);
        },
    };

    return [sessionScenario, diffStatesScenario, walkScenario];
}
