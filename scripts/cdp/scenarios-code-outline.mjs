// code-outline: the Code surface's symbols outline, `@` in the finder, go to definition and find references
// (docs/superpowers/plans/2026-11-12-kael-sync-code-diff-usage-setup.md, Task 5; the fork's 1349eedb2 and its `code-symbols` scenario).
// kit is scenarios.mjs's KAEL_KITS ({ rt, code, files, jarvis }).
//
// The fork's steps pressed F12, Shift+F12 and Ctrl+Shift+O, which Task 16 binds (`kael-keys` presses them); here go to
// definition and find references run from the editor's context menu (codeviewer.tsx addSymbolActions), and the finder is
// opened by Ctrl+P, whose Files scope takes `@`.
//
// The repo is written by the scenario: epsilon is defined twice, so go to definition on it lists instead of jumping. The caret
// is read from Monaco's active line number and placed on a word by a real click, since Monaco takes no text a CDP session
// types.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SURFACE_LABEL } from "./attach.mjs";

const NAME = "verify-code-outline";
const VIEWPORT = { width: 1600, height: 950, deviceScaleFactor: 1, mobile: false };
// line numbers the steps assert against: alpha 5, beta 9, epsilon 13, Gamma 17, Gamma.Delta 19
const MAIN_GO = [
    "package main",
    "",
    'import "fmt"',
    "",
    "func alpha() {",
    "\tfmt.Println(beta(), epsilon())",
    "}",
    "",
    "func beta() string {",
    '\treturn "b"',
    "}",
    "",
    "func epsilon() int {",
    "\treturn 1",
    "}",
    "",
    "type Gamma struct{}",
    "",
    "func (g Gamma) Delta() {}",
    "",
].join("\n");
const CALL_LINE = "fmt.Println(beta(), epsilon())";
const WANT_ROWS = ["alpha@5", "beta@9", "epsilon@13", "Gamma@17", "Gamma.Delta@19"];

const DEFINE = "Go to Definition in Project";
const REFERENCES = "Find References in Project";

// Monaco draws its context menu inside a shadow root, so an item is looked for there as well
const menuItem = (label) => `(() => {
    const roots = [document, ...[...document.querySelectorAll('.shadow-root-host')].map((h) => h.shadowRoot).filter(Boolean)];
    return roots.flatMap((r) => [...r.querySelectorAll('.monaco-menu .action-item')]).find((i) => i.textContent.includes(${JSON.stringify(label)})) ?? null;
})()`;

const CARET_LINE = `(() => { const el = document.querySelector(".monaco-editor .active-line-number"); return el ? Number(el.textContent.trim()) : null; })()`;
const SEARCH_TITLE = `document.querySelector("[data-code-search-title]")?.textContent?.trim() ?? ""`;
const SEARCH_SUMMARY = `(() => { const t = document.querySelector("[data-code-search-title]"); const s = t?.nextElementSibling; return s ? (s.textContent || "").trim() : ""; })()`;

export default function (kits) {
    const { code, jarvis } = kits;
    const { git, chooseProjectNamed, setFinderQuery, waitForProjectInConfig, polishWaitFor, polishNap } = code;
    const { openPalette } = jarvis;

    // the middle of one word on a rendered editor line, or null while the line is not drawn
    const wordPoint = (h, lineText, word) =>
        h.ev(`(() => {
            const line = [...document.querySelectorAll(".monaco-editor .view-line")].find((l) => l.textContent.replace(/\\u00a0/g, " ").includes(${JSON.stringify(lineText)}));
            if (!line) return null;
            const walk = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
            for (let n = walk.nextNode(); n; n = walk.nextNode()) {
                const i = n.textContent.indexOf(${JSON.stringify(word)});
                if (i < 0) continue;
                const r = document.createRange();
                r.setStart(n, i + 1);
                r.setEnd(n, i + 2);
                const b = r.getBoundingClientRect();
                return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
            }
            return null;
        })()`);

    const mouse = async (h, pt, button) => {
        for (const type of ["mousePressed", "mouseReleased"]) {
            await h.cdp("Input.dispatchMouseEvent", { type, x: pt.x, y: pt.y, button, clickCount: 1 });
        }
    };

    // a real click on a word of a rendered line puts Monaco's caret there
    const clickWord = async (h, lineText, word) => {
        const pt = await wordPoint(h, lineText, word);
        if (pt == null) return false;
        await mouse(h, pt, "left");
        await polishNap(250);
        return true;
    };

    // Monaco moves the caret to a right-clicked word and opens its context menu
    const rightClickWord = async (h, lineText, word) => {
        const pt = await wordPoint(h, lineText, word);
        if (pt == null) return false;
        await mouse(h, pt, "right");
        return true;
    };

    // monaco's menu runs an item on a mouseup over the item it has focused on hover, so the pointer moves onto the item and
    // waits for that focus (or a short settle) before it presses. The menu attaches that mouseup listener 100 ms after it
    // draws ("to avoid accidental clicks", base/browser/ui/menu/menu.js), so a press just after it appears is lost: settle first.
    const clickMenuItem = async (h, label) => {
        const shown = await polishWaitFor(h, `!!${menuItem(label)}`, 4000);
        if (!shown) return false;
        await polishNap(500);
        const pt = await h.ev(`(() => { const b = ${menuItem(label)}?.getBoundingClientRect(); return b ? { x: b.left + b.width / 2, y: b.top + b.height / 2 } : null; })()`);
        if (pt == null) return false;
        await h.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: pt.x, y: pt.y, button: "none" });
        const focused = await polishWaitFor(h, `!!${menuItem(label)}?.classList.contains('focused')`, 1000);
        if (!focused) await polishNap(200);
        await mouse(h, pt, "left");
        return true;
    };

    const waitCaret = async (h, line) => {
        await polishWaitFor(h, `${CARET_LINE} === ${line}`, 6000);
        return h.ev(CARET_LINE);
    };

    // types into the open finder without pressing Enter, so the list it shows can be read first
    const typeFinder = (h, text) =>
        h.ev(`(() => {
            const input = document.querySelector('input[data-palette-input]');
            if (!input) return false;
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            setter.call(input, ${JSON.stringify(text)});
            input.dispatchEvent(new Event('input', { bubbles: true }));
            return true;
        })()`);

    const scenario = {
        name: "code-outline",
        surface: "code",
        async arrange(h) {
            const ctx = { name: NAME };
            try {
                ctx.dir = mkdtempSync(join(tmpdir(), "verify-code-outline-"));
                git(ctx.dir, "init", "-q", "--initial-branch=main");
                writeFileSync(join(ctx.dir, "main.go"), MAIN_GO);
                mkdirSync(join(ctx.dir, "sub"));
                writeFileSync(join(ctx.dir, "sub", "x.go"), "package sub\n\nfunc epsilon() int { return 2 }\n");
                git(ctx.dir, "add", ".");
                git(ctx.dir, "commit", "-q", "-m", "seed the outline fixture");
                await h.rpc("createproject", { name: ctx.name, path: ctx.dir });
                ctx.madeProject = true;
                await waitForProjectInConfig(h, ctx.name);
                await h.reload();
            } catch (e) {
                ctx.arrangeError = String(e?.message ?? e);
            }
            return ctx;
        },
        async assert(h, ctx) {
            if (ctx.arrangeError) return [{ step: "arrange the temp repo", ok: false, detail: ctx.arrangeError }];
            const steps = [];
            const rec = (step, ok, detail) => steps.push({ step, ok: ok === true, detail });

            await h.cdp("Emulation.setDeviceMetricsOverride", VIEWPORT);
            await h.goto("code");
            rec("Code surface is active", (await h.activeSurfaceLabel()) === SURFACE_LABEL.code, `active=${await h.activeSurfaceLabel()}`);

            // another Code scenario may have left a project loaded, which the picker helper would then not open; pick this one
            // whenever the chip does not already name it
            const onProject = () => h.ev(`(document.querySelector('[data-code-project-picker]')?.textContent ?? '').includes(${JSON.stringify(NAME)})`);
            if ((await onProject()) !== true) {
                await h.ev(`document.querySelector('[data-code-project-picker]')?.click()`);
                await polishNap(300);
                await chooseProjectNamed(h, NAME);
                await polishWaitFor(h, `(document.querySelector('[data-code-project-picker]')?.textContent ?? '').includes(${JSON.stringify(NAME)})`, 8000);
            }
            rec("select the fixture project", await onProject(), `chip names ${NAME}`);

            await h.ev(`document.querySelector('[data-code-column-tab="files"]')?.click()`);
            const opened = await polishWaitFor(
                h,
                `(() => {
                    const r = [...document.querySelectorAll('[data-code-tree] [role="treeitem"]')].find((x) => x.textContent.trim() === "main.go");
                    if (!r) return false;
                    r.click();
                    return true;
                })()`,
                10000
            );
            const editor = opened && (await polishWaitFor(h, `!!document.querySelector(".monaco-editor .view-line")`, 10000));
            rec("open main.go in the editor", editor === true, `opened=${opened} editor=${editor}`);

            await h.ev(`document.querySelector('[data-code-column-tab="symbols"]')?.click()`);
            const rows = `(() => {
                const rows = [...document.querySelectorAll("[data-code-symbol-row]")].map((r) => r.getAttribute("data-code-symbol-row") + "@" + r.getAttribute("data-line"));
                return rows.length ? rows : null;
            })()`;
            await polishWaitFor(h, `${rows} !== null`, 6000);
            const names = await h.ev(rows);
            await h.shot("cdp-shots/code-outline.png");
            rec("the Symbols tab lists the file's declarations with their lines", JSON.stringify(names) === JSON.stringify(WANT_ROWS), `rows=${JSON.stringify(names)}`);

            await h.ev(`document.querySelector('[data-code-symbol-row="Gamma.Delta"]')?.click()`);
            const afterRow = await waitCaret(h, 19);
            rec("clicking a symbol row moves the editor to its line", afterRow === 19, `caret=${afterRow}`);

            // ours: "@" typed into a plain Ctrl+P stays a path search; only Alt+O, which seeds "@", lists symbols
            const openedPlain = await openPalette(h);
            const typedPlain = openedPlain && (await typeFinder(h, "@"));
            await polishNap(400);
            const plainSymbols = typedPlain && (await h.ev(`document.body.textContent.includes("Symbols in main.go")`));
            rec("@ typed into a plain Ctrl+P does not switch to symbols", typedPlain === true && plainSymbols === false, `opened=${openedPlain} typed=${typedPlain} symbols=${plainSymbols}`);
            await h.cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
            await h.cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
            await polishWaitFor(h, `document.querySelector("input[data-palette-input]") == null`, 4000);

            // Alt+O (modifier 1 = Alt) opens the search seeded with "@", listing the file's symbols
            await h.cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "o", code: "KeyO", windowsVirtualKeyCode: 79, modifiers: 1 });
            await h.cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "o", code: "KeyO", windowsVirtualKeyCode: 79, modifiers: 1 });
            const opened1 = await polishWaitFor(h, `!!document.querySelector("input[data-palette-input]")`, 4000);
            const typed = opened1 && (await h.ev(`document.querySelector("input[data-palette-input]").value`)) === "@";
            const group = typed && (await polishWaitFor(h, `document.body.textContent.includes("Symbols in main.go")`, 4000));
            await h.shot("cdp-shots/code-outline-finder.png");
            rec("Alt+O opens the finder on @, listing the file's symbols", group === true, `opened=${opened1} seeded=${typed} group=${group}`);

            const picked = await setFinderQuery(h, "@alpha");
            const afterPick = await waitCaret(h, 5);
            rec("@alpha then Enter moves the editor to alpha's line", picked === true && afterPick === 5, `typed=${picked} caret=${afterPick}`);
            // a click while the closing finder still covers the editor lands on it
            await polishWaitFor(h, `document.querySelector("input[data-palette-input]") == null`, 4000);
            await polishNap(400);

            const onBeta = await clickWord(h, CALL_LINE, "beta");
            const onLine = await waitCaret(h, 6);
            const menuBeta = onBeta && (await rightClickWord(h, CALL_LINE, "beta"));
            const clickedDef = menuBeta && (await clickMenuItem(h, DEFINE));
            const afterDef = await waitCaret(h, 9);
            rec(
                "go to definition from the context menu, on a name with one definition, jumps to it",
                clickedDef === true && onLine === 6 && afterDef === 9,
                `clicked=${onBeta} caret before=${onLine} menu=${clickedDef} after=${afterDef}`
            );

            const onEps = await clickWord(h, CALL_LINE, "epsilon");
            // the jump above moved the caret; the call line is on screen again once the click finds it
            const menuEps = onEps && (await rightClickWord(h, CALL_LINE, "epsilon"));
            const clickedEps = menuEps && (await clickMenuItem(h, DEFINE));
            const defTitle = clickedEps && (await polishWaitFor(h, `(${SEARCH_TITLE}) === "Definitions of epsilon"`, 8000));
            const defSummary = defTitle && (await polishWaitFor(h, `/2 matches in 2 files/.test(${SEARCH_SUMMARY})`, 8000));
            await h.shot("cdp-shots/code-outline-definitions.png");
            rec(
                "go to definition on a name defined twice lists both under Definitions of",
                defTitle === true && defSummary === true,
                `clicked=${onEps} menu=${clickedEps} title=${JSON.stringify(await h.ev(SEARCH_TITLE))} summary=${JSON.stringify(await h.ev(SEARCH_SUMMARY))}`
            );

            const onBeta2 = await clickWord(h, CALL_LINE, "beta");
            const menuRef = onBeta2 && (await rightClickWord(h, CALL_LINE, "beta"));
            const clickedRef = menuRef && (await clickMenuItem(h, REFERENCES));
            const refTitle = clickedRef && (await polishWaitFor(h, `(${SEARCH_TITLE}) === "References to beta"`, 8000));
            const refSummary = refTitle && (await polishWaitFor(h, `/2 matches in 1 file/.test(${SEARCH_SUMMARY})`, 8000));
            await h.shot("cdp-shots/code-outline-references.png");
            rec(
                "find references from the context menu lists the name's whole-word matches under References to",
                refTitle === true && refSummary === true,
                `clicked=${onBeta2} menu=${clickedRef} title=${JSON.stringify(await h.ev(SEARCH_TITLE))} summary=${JSON.stringify(await h.ev(SEARCH_SUMMARY))}`
            );
            return steps;
        },
        async teardown(h, ctx) {
            const step = async (what, fn) => {
                try {
                    await fn();
                } catch (e) {
                    console.error(`code-outline teardown: ${what} failed: ${e?.message ?? e}`);
                }
            };
            await step("back to the Files tab", () => h.ev(`document.querySelector('[data-code-column-tab="files"]')?.click()`));
            await step("clear the viewport", () => h.cdp("Emulation.clearDeviceMetricsOverride"));
            await step("leave Code", () => h.goto("cockpit"));
            if (ctx?.madeProject) await step("delete the project", () => h.rpc("deleteproject", { name: ctx.name }));
            if (ctx?.dir) await step(`remove ${ctx.dir}`, () => rmSync(ctx.dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 }));
        },
    };
    return [scenario];
}
