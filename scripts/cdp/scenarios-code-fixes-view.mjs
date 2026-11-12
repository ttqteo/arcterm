// code-fixes-view: the Code surface review fixes that change what a file shows: the markdown preview, the editor, jumps and the
// toolbar (docs/superpowers/plans/2026-11-12-kael-sync-code-diff-usage-setup.md, Task 8; the fork's 10dd2d3ca, c24d4be5a,
// 4de5b24f8, be83424f2, c50a510c0, f2b39e1a7 and the matching steps of its scenarios-code-{jumps,editor,toolbar}.mjs and
// code-markdown / code-symbols). kit is scenarios.mjs's KAEL_KITS ({ rt, code, files, jarvis }).
//
// Each scenario writes its own repo and registers it as a project. Files are opened by the palette (Ctrl+P's Files scope,
// whose `path:line` is a jump) or a tree row, and every check reads the DOM: the path bar's data-code-path, Monaco's active
// line number, the preview's headings. The fork read its store through a module resolver this repo keeps inside
// scenarios.mjs, which a module does not reach.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { deflateSync } from "node:zlib";
import { SURFACE_LABEL } from "./attach.mjs";

const BIG = { width: 1600, height: 950, deviceScaleFactor: 1, mobile: false };
const SMALL = { width: 1000, height: 700, deviceScaleFactor: 1, mobile: false };
// a reveal must still hold this long after it first shows: a fresh document's scroller can reset under it
const SETTLE_MS = 600;

const filler = (tag, n) => Array.from({ length: n }, (_, i) => [`${tag} paragraph ${i}.`, ""]).flat();

// front matter, a relative image, an in-page anchor, and sections long enough that each heading starts below the fold
const GUIDE_MD = [
    "---",
    "title: Fixture guide",
    "owner: docs",
    "---",
    "",
    "# Guide",
    "",
    "![fig](../img/fig.png)",
    "",
    "[to the deep part](#deep-section)",
    "",
    "## Setup",
    "",
    ...filler("Setup", 40),
    "## Middle",
    "",
    ...filler("Middle", 40),
    "## Deep Section",
    "",
    "Deep text lives here.",
    "",
    ...filler("Deep", 40),
].join("\n");

const README_MD = "# demo\n\n[docs folder](docs/)\n\n[guide deep](docs/guide.md#deep-section)\n";

// about 200 KB of prose: its synchronous render is what the Opening… placeholder used to sit over
const BIG_MD = ["# Big document", "", ...Array.from({ length: 1600 }, (_, i) => [`## Part ${i}`, "", `${"Lorem ipsum dolor sit amet ".repeat(4)}${i}.`, ""]).flat()].join("\n");

// a long unbroken word and a long line: the preview wraps them instead of scrolling sideways
const LONG_MD = ["# Long", "", "x".repeat(400), "", "word ".repeat(300), "", ...filler("Long", 30)].join("\n");

const B_TS = Array.from({ length: 200 }, (_, i) => (i + 1 === 150 ? "// FAR marks this line" : `export const v${i + 1} = ${i + 1};`)).join("\n");

const MAIN_GO = ["package main", "", 'import "fmt"', "", "func alpha() {", '\tfmt.Println("alpha")', "}", "", "func beta() {}", ""].join("\n");

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
});
function crc32(buf) {
    let c = 0xffffffff;
    for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
}
// a two-colour RGB PNG, with no image library
function checkerPng(width, height) {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr.set([8, 2, 0, 0, 0], 8);
    const row = width * 3 + 1;
    const raw = Buffer.alloc(row * height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const on = (Math.floor(x / 20) + Math.floor(y / 20)) % 2 === 0;
            raw.set(on ? [230, 120, 40] : [30, 60, 110], y * row + 1 + x * 3);
        }
    }
    return Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        pngChunk("IHDR", ihdr),
        pngChunk("IDAT", deflateSync(raw)),
        pngChunk("IEND", Buffer.alloc(0)),
    ]);
}

const FIXTURE = {
    "README.md": README_MD,
    "docs/guide.md": GUIDE_MD,
    "docs/big.md": BIG_MD,
    "docs/long.md": LONG_MD,
    "img/fig.png": null, // written as bytes below
    "data.bin": null,
    "src/a.js": "export const a = 1;\n",
    "src/b.ts": B_TS,
    "main.go": MAIN_GO,
};

// page-side reads every step uses
const PATH_SHOWN = `(document.querySelector("[data-code-path]")?.getAttribute("data-code-path") ?? null)`;
const CARET_LINE = `(() => { const el = document.querySelector(".monaco-editor .active-line-number"); return el ? Number(el.textContent.trim()) : null; })()`;
const SHOWN_LINES = `[...document.querySelectorAll(".monaco-editor .line-numbers")].map((e) => Number(e.textContent.trim()))`;
// the preview's document scroller (the first viewport holding headings; the TOC's comes after)
const VIEWPORT = `([...document.querySelectorAll("[data-code-preview] [data-overlayscrollbars-viewport]")].find((v) => v.querySelector(".heading") != null) ?? null)`;
// a heading's offset below the preview's top edge: small once a jump scrolled to it, null until it renders
const headingTop = (name) => `(() => {
    const v = ${VIEWPORT};
    const el = v && [...v.querySelectorAll(".heading")].find((x) => (x.textContent || "").replace(/\\s+/g, " ").trim() === ${JSON.stringify(name)});
    const root = document.querySelector("[data-code-preview]");
    return el && root ? Math.round(el.getBoundingClientRect().top - root.getBoundingClientRect().top) : null;
})()`;
const atTop = (name) => `(() => { const t = ${headingTop(name)}; return t != null && t >= -2 && t < 80; })()`;
const treeRow = (name) => `([...document.querySelectorAll('[data-code-tree] [role="treeitem"]')].find((r) => r.textContent.trim() === ${JSON.stringify(name)}) ?? null)`;
// the view-mode segments drawn as selected
const SELECTED_MODES = `[...document.querySelectorAll("[data-code-view-mode]")].filter((b) => b.className.includes("bg-accent/10")).map((b) => b.getAttribute("data-code-view-mode"))`;
// Monaco draws its context menu inside a shadow root, so an item is looked for there as well
const menuItem = (label) => `(() => {
    const roots = [document, ...[...document.querySelectorAll('.shadow-root-host')].map((h) => h.shadowRoot).filter(Boolean)];
    return roots.flatMap((r) => [...r.querySelectorAll('.monaco-menu .action-item')]).find((i) => i.textContent.includes(${JSON.stringify(label)})) ?? null;
})()`;
// navigator.clipboard is swapped for a recorder, so a Copy path press can be read back
const CLIPBOARD_SPY = `(() => {
    window.__copied = [];
    try {
        Object.defineProperty(navigator.clipboard, "writeText", { configurable: true, value: (t) => { window.__copied.push(t); return Promise.resolve(); } });
        return true;
    } catch {
        return false;
    }
})()`;
const COPIED = `(window.__copied ?? [])`;

export default function (kits) {
    const { code, jarvis } = kits;
    const { git, chooseProjectNamed, setFinderQuery, waitForProjectInConfig, polishWaitFor, polishNap } = code;
    const { openPalette } = jarvis;

    const writeFixture = (dir) => {
        for (const [rel, content] of Object.entries(FIXTURE)) {
            const abs = join(dir, rel);
            mkdirSync(dirname(abs), { recursive: true });
            if (rel === "img/fig.png") writeFileSync(abs, checkerPng(320, 200));
            else if (rel === "data.bin") writeFileSync(abs, Buffer.from([0, 1, 2, 3, 0, 255, 0, 7, 0, 0, 9, 0]));
            else writeFileSync(abs, content);
        }
    };

    const arrangeRepo = async (h, name) => {
        const ctx = { name };
        try {
            ctx.dir = mkdtempSync(join(tmpdir(), `${name}-`));
            git(ctx.dir, "init", "-q", "--initial-branch=main");
            writeFixture(ctx.dir);
            git(ctx.dir, "add", ".");
            git(ctx.dir, "commit", "-q", "-m", "seed the code fixes fixture");
            await h.rpc("createproject", { name: ctx.name, path: ctx.dir });
            ctx.madeProject = true;
            await waitForProjectInConfig(h, ctx.name);
            await h.reload();
        } catch (e) {
            ctx.arrangeError = String(e?.message ?? e);
        }
        return ctx;
    };

    // Code, on the scenario's project: picked from the chip whenever it does not already name it
    const enterProject = async (h, ctx, rec) => {
        await h.cdp("Emulation.setDeviceMetricsOverride", BIG);
        await h.goto("code");
        rec("Code surface is active", (await h.activeSurfaceLabel()) === SURFACE_LABEL.code, `active=${await h.activeSurfaceLabel()}`);
        const chipNames = `(document.querySelector('[data-code-project-picker]')?.textContent ?? '').includes(${JSON.stringify(ctx.name)})`;
        if ((await h.ev(chipNames)) !== true) {
            await h.ev(`document.querySelector('[data-code-project-picker]')?.click()`);
            await polishNap(300);
            await chooseProjectNamed(h, ctx.name);
            await polishWaitFor(h, chipNames, 8000);
        }
        await h.ev(`document.querySelector('[data-code-column-tab="files"]')?.click()`);
        const listed = await polishWaitFor(h, `${treeRow("README.md")} != null`, 10000);
        rec("select the fixture project", (await h.ev(chipNames)) === true && listed === true, `chip names ${ctx.name}, listed=${listed}`);
    };

    // a file by the palette's Files scope; `query` may carry a :line
    const openByPalette = async (h, query, rel) => {
        await polishWaitFor(h, `document.querySelector("input[data-palette-input]") == null`, 3000);
        const opened = await openPalette(h);
        if (!opened) return false;
        await polishNap(200);
        const typed = await setFinderQuery(h, query);
        if (!typed) return false;
        const shown = await polishWaitFor(h, `${PATH_SHOWN} === ${JSON.stringify(rel)}`, 10000);
        // a click while the closing palette still covers the pane lands on it
        await polishWaitFor(h, `document.querySelector("input[data-palette-input]") == null`, 4000);
        await polishNap(300);
        return shown === true;
    };

    const openRoot = async (h, name) => {
        await h.ev(`document.querySelector('[data-code-column-tab="files"]')?.click()`);
        await polishWaitFor(h, `${treeRow(name)} != null`, 6000);
        await h.ev(`${treeRow(name)}?.click()`);
        return polishWaitFor(h, `${PATH_SHOWN} === ${JSON.stringify(name)}`, 10000);
    };

    const mouse = async (h, pt, button) => {
        for (const type of ["mousePressed", "mouseReleased"]) {
            await h.cdp("Input.dispatchMouseEvent", { type, x: pt.x, y: pt.y, button, clickCount: 1 });
        }
    };

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

    const rightClickWord = async (h, lineText, word) => {
        const pt = await wordPoint(h, lineText, word);
        if (pt == null) return false;
        await mouse(h, pt, "left");
        await polishNap(200);
        await mouse(h, pt, "right");
        return polishWaitFor(h, `!!document.querySelector('.shadow-root-host') || !!document.querySelector('.monaco-menu')`, 3000);
    };

    // monaco's menu takes a press only 100 ms after it draws, on the item it focused on hover
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

    const teardown = (label) => async (h, ctx) => {
        const step = async (what, fn) => {
            try {
                await fn();
            } catch (e) {
                console.error(`${label} teardown: ${what} failed: ${e?.message ?? e}`);
            }
        };
        await step("clear the viewport", () => h.cdp("Emulation.clearDeviceMetricsOverride"));
        await step("leave Code", () => h.goto("cockpit"));
        if (ctx?.madeProject) await step("delete the project", () => h.rpc("deleteproject", { name: ctx.name }));
        if (ctx?.dir) await step(`remove ${ctx.dir}`, () => rmSync(ctx.dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 }));
    };

    const begin = () => {
        const steps = [];
        const rec = (step, ok, detail) => steps.push({ step, ok: ok === true, detail });
        return { steps, rec };
    };

    const markdown = {
        name: "code-fixes-markdown",
        surface: "code",
        arrange: (h) => arrangeRepo(h, "verify-code-fixes-md"),
        async assert(h, ctx) {
            if (ctx.arrangeError) return [{ step: "arrange the temp repo", ok: false, detail: ctx.arrangeError }];
            const { steps, rec } = begin(ctx);
            await enterProject(h, ctx, rec);

            const opened = await openByPalette(h, "docs/guide.md", "docs/guide.md");
            const img = await polishWaitFor(h, `(() => { const i = document.querySelector('[data-code-preview] .markdown img'); return !!i && i.complete && i.naturalWidth > 0; })()`, 10000);
            await h.shot("cdp-shots/code-fixes-markdown-image.png");
            rec(
                "a markdown doc's relative image (../img/fig.png) renders in the preview",
                opened && img === true,
                `opened=${opened} img=${JSON.stringify(await h.ev(`(() => { const i = document.querySelector('[data-code-preview] .markdown img'); return i ? { src: i.src.slice(0, 30), w: i.naturalWidth } : null; })()`))}`
            );

            const fm = await h.ev(`[...document.querySelectorAll('[data-code-preview] dl dt')].map((d) => d.textContent.trim())`);
            const fmRule = await h.ev(`!!document.querySelector('[data-code-preview] .markdown hr')`);
            await h.shot("cdp-shots/code-fixes-markdown-frontmatter.png");
            rec(
                "the doc's front matter shows as its fields, not a rule and prose",
                JSON.stringify(fm) === JSON.stringify(["title", "owner"]) && fmRule === false,
                `fields=${JSON.stringify(fm)} hr=${fmRule}`
            );

            // reopening reads the file again; every painted frame shows a document or the file before it, never the
            // Opening… placeholder that sat on screen for the whole render of a large file
            await h.ev(`(() => {
                const seen = { frames: 0, placeholder: 0, blank: 0 };
                const t0 = performance.now();
                const frame = () => {
                    seen.frames++;
                    const doc = document.querySelector('[data-code-preview] .heading');
                    const opening = [...document.querySelectorAll('body *')].some((e) => e.children.length === 0 && (e.textContent || '').trim() === 'Opening…');
                    if (opening) seen.placeholder++;
                    else if (!doc) seen.blank++;
                    if (performance.now() - t0 < 3000) requestAnimationFrame(frame);
                    else window.__codeFixesReopen = seen;
                };
                requestAnimationFrame(frame);
            })()`);
            const bigOpened = await openByPalette(h, "docs/big.md", "docs/big.md");
            await polishWaitFor(h, `window.__codeFixesReopen != null`, 6000);
            const seen = await h.ev(`(() => { const s = window.__codeFixesReopen; delete window.__codeFixesReopen; return s; })()`);
            const bigShown = await h.ev(`(document.querySelector('[data-code-preview] .heading')?.textContent ?? '').trim()`);
            await h.shot("cdp-shots/code-fixes-markdown-large.png");
            rec(
                "a large markdown file opens without the Opening… flash or an empty pane",
                bigOpened && seen != null && seen.placeholder === 0 && seen.blank === 0 && bigShown === "Big document",
                JSON.stringify({ bigOpened, bigShown, ...seen })
            );

            const back = await openByPalette(h, "docs/guide.md", "docs/guide.md");
            await polishWaitFor(h, `${headingTop("Deep Section")} != null`, 8000);
            const before = await h.ev(headingTop("Deep Section"));
            await h.ev(`document.querySelector('[data-code-column-tab="symbols"]')?.click()`);
            await polishWaitFor(h, `!!document.querySelector('[data-code-symbol-row="Deep Section"]')`, 6000);
            await h.ev(`document.querySelector('[data-code-symbol-row="Deep Section"]')?.click()`);
            const atDeep = await polishWaitFor(h, atTop("Deep Section"), 4000);
            await polishNap(SETTLE_MS);
            const heldDeep = await h.ev(atTop("Deep Section"));
            await h.shot("cdp-shots/code-fixes-markdown-heading.png");
            rec(
                "a heading row in the outline scrolls the preview to that heading",
                back && before > 200 && atDeep === true && heldDeep === true,
                `top before=${before} after=${await h.ev(headingTop("Deep Section"))} held=${heldDeep}`
            );

            await h.ev(`document.querySelector('[data-code-symbol-row="Middle"]')?.click()`);
            const atMiddle = await polishWaitFor(h, atTop("Middle"), 4000);
            rec("another heading row scrolls back up to its own heading", atMiddle === true, `top=${await h.ev(headingTop("Middle"))}`);
            await h.ev(`document.querySelector('[data-code-column-tab="files"]')?.click()`);
            return steps;
        },
        teardown: teardown("code-fixes-markdown"),
    };

    const editor = {
        name: "code-fixes-editor",
        surface: "code",
        arrange: (h) => arrangeRepo(h, "verify-code-fixes-editor"),
        async assert(h, ctx) {
            if (ctx.arrangeError) return [{ step: "arrange the temp repo", ok: false, detail: ctx.arrangeError }];
            const { steps, rec } = begin(ctx);
            await enterProject(h, ctx, rec);
            const spy = await h.ev(CLIPBOARD_SPY);

            const opened = await openRoot(h, "main.go");
            const drawn = opened && (await polishWaitFor(h, `!!document.querySelector(".monaco-editor .view-line")`, 10000));
            await polishNap(400);
            const menu = drawn && (await rightClickWord(h, "func alpha() {", "alpha"));
            const hasComment = menu && (await polishWaitFor(h, `!!${menuItem("Add review comment")}`, 4000));
            const hasCopy = menu && (await h.ev(`!!${menuItem("Copy path")}`));
            await h.shot("cdp-shots/code-fixes-editor-menu.png");
            rec(
                "the editor's context menu offers Add review comment and Copy path",
                hasComment === true && hasCopy === true,
                `opened=${opened} drawn=${drawn} menu=${menu} comment=${hasComment} copy=${hasCopy}`
            );

            const pressedCopy = hasCopy && (await clickMenuItem(h, "Copy path"));
            const copied = pressedCopy && (await polishWaitFor(h, `${COPIED}.some((t) => /main\\.go$/.test(t))`, 3000));
            rec("Copy path in the menu copies the file's absolute path", spy === true && copied === true, `spy=${spy} copied=${JSON.stringify(await h.ev(COPIED))}`);

            // the comment input sits in a gap the editor opens under the line, not over the code below it
            const menu2 = await rightClickWord(h, "func alpha() {", "alpha");
            const pressedComment = menu2 && (await clickMenuItem(h, "Add review comment"));
            const input = pressedComment && (await polishWaitFor(h, `!!document.querySelector('[data-code-comment-input]')`, 4000));
            await polishNap(300);
            const gap = await h.ev(`(() => {
                const box = document.querySelector('[data-code-comment-box]')?.getBoundingClientRect();
                const next = [...document.querySelectorAll('.monaco-editor .view-line')].find((l) => l.textContent.replace(/\\u00a0/g, ' ').includes('fmt.Println("alpha")'))?.getBoundingClientRect();
                const zone = [...document.querySelectorAll('.monaco-editor .view-zones > div')].map((z) => z.getBoundingClientRect().height).filter((x) => x > 0);
                return box && next ? { boxBottom: Math.round(box.bottom), nextTop: Math.round(next.top), zones: zone } : null;
            })()`);
            await h.shot("cdp-shots/code-fixes-editor-comment-gap.png");
            rec(
                "a comment's input sits in a gap under its line, and the next line starts below it",
                input === true && gap != null && gap.zones.length > 0 && gap.nextTop >= gap.boxBottom - 1,
                `input=${input} gap=${JSON.stringify(gap)}`
            );
            await h.ev(`(() => { const i = document.querySelector('[data-code-comment-input]'); i?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); return true; })()`);
            const zoneGone = await polishWaitFor(h, `[...document.querySelectorAll('.monaco-editor .view-zones > div')].every((z) => z.getBoundingClientRect().height === 0)`, 3000);
            rec("cancelling the comment closes the gap", zoneGone === true, `zones=${JSON.stringify(await h.ev(`[...document.querySelectorAll('.monaco-editor .view-zones > div')].map((z) => z.getBoundingClientRect().height)`))}`);

            const imgOpened = await openByPalette(h, "img/fig.png", "img/fig.png");
            const imgDrawn = await polishWaitFor(h, `(() => { const i = document.querySelector('[data-code-image] img'); return !!i && i.complete && i.naturalWidth === 320; })()`, 10000);
            await h.shot("cdp-shots/code-fixes-editor-image.png");
            rec("an image file renders", imgOpened && imgDrawn === true, `opened=${imgOpened} drawn=${imgDrawn}`);

            const binOpened = await openRoot(h, "data.bin");
            const binState = await polishWaitFor(h, `[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Copy path') && document.body.textContent.includes('Binary file')`, 8000);
            await h.ev(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Copy path')?.click()`);
            const binCopied = await polishWaitFor(h, `${COPIED}.some((t) => /data\\.bin$/.test(t))`, 3000);
            await h.shot("cdp-shots/code-fixes-editor-binary.png");
            rec("a binary file offers Copy path, which copies its absolute path", binOpened && binState === true && binCopied === true, `opened=${binOpened} state=${binState} copied=${JSON.stringify(await h.ev(COPIED))}`);
            return steps;
        },
        teardown: teardown("code-fixes-editor"),
    };

    const jumps = {
        name: "code-fixes-jumps",
        surface: "code",
        arrange: (h) => arrangeRepo(h, "verify-code-fixes-jumps"),
        async assert(h, ctx) {
            if (ctx.arrangeError) return [{ step: "arrange the temp repo", ok: false, detail: ctx.arrangeError }];
            const { steps, rec } = begin(ctx);
            await enterProject(h, ctx, rec);

            await openRoot(h, "README.md");
            const jumped = await openByPalette(h, "src/b.ts:150", "src/b.ts");
            const onLine = await polishWaitFor(h, `${CARET_LINE} === 150`, 6000);
            await polishNap(200);
            const visible = await h.ev(`${SHOWN_LINES}.includes(150)`);
            await h.shot("cdp-shots/code-fixes-jumps-palette-line.png");
            rec(
                "a palette jump to file:line from another file lands on that line",
                jumped && onLine === true && visible === true,
                `opened=${jumped} caret=${await h.ev(CARET_LINE)} visible=${visible}`
            );

            const bare = await openPalette(h);
            const typed = bare && (await setFinderQuery(h, ":40"));
            const onBare = typed && (await polishWaitFor(h, `${CARET_LINE} === 40`, 6000));
            rec("a bare :40 moves the open file to line 40", onBare === true && (await h.ev(PATH_SHOWN)) === "src/b.ts", `typed=${typed} caret=${await h.ev(CARET_LINE)} path=${await h.ev(PATH_SHOWN)}`);
            await polishWaitFor(h, `document.querySelector("input[data-palette-input]") == null`, 4000);

            const readme = await openRoot(h, "README.md");
            const link = readme && (await polishWaitFor(h, `!!document.querySelector('[data-code-preview] a[href="docs/"]')`, 6000));
            await h.ev(`document.querySelector('[data-code-preview] a[href="docs/"]')?.click()`);
            const selected = await polishWaitFor(h, `${treeRow("docs")}?.getAttribute("aria-selected") === "true"`, 4000);
            await polishNap(300);
            const kept = await h.ev(PATH_SHOWN);
            await h.shot("cdp-shots/code-fixes-jumps-folder-link.png");
            rec(
                "a README link to a folder selects the folder in the tree and keeps the file open",
                link === true && selected === true && kept === "README.md",
                `link=${link} selected=${selected} expanded=${await h.ev(`${treeRow("docs")}?.getAttribute("aria-expanded")`)} file=${kept}`
            );

            const cross = await polishWaitFor(h, `!!document.querySelector('[data-code-preview] a[href="docs/guide.md#deep-section"]')`, 6000);
            await h.ev(`document.querySelector('[data-code-preview] a[href="docs/guide.md#deep-section"]')?.click()`);
            const landed = await polishWaitFor(h, `${PATH_SHOWN} === "docs/guide.md"`, 8000);
            const crossAt = landed && (await polishWaitFor(h, atTop("Deep Section"), 5000));
            await polishNap(SETTLE_MS);
            const crossHeld = await h.ev(atTop("Deep Section"));
            await h.shot("cdp-shots/code-fixes-jumps-cross-anchor.png");
            rec(
                "a doc.md#anchor link opens the doc at that heading",
                cross === true && landed === true && crossAt === true && crossHeld === true,
                `link=${cross} landed=${landed} top=${await h.ev(headingTop("Deep Section"))} held=${crossHeld}`
            );

            // back to the top first (the doc's own first heading, whichever element scrolls), so the link has a way to go
            await h.ev(`(() => { const v = ${VIEWPORT}; v?.querySelector(".heading")?.scrollIntoView({ block: "start" }); return true; })()`);
            await polishWaitFor(h, `(${headingTop("Deep Section")} ?? 0) > 200`, 3000);
            await polishNap(300);
            const before = await h.ev(headingTop("Deep Section"));
            await h.ev(`document.querySelector('[data-code-preview] a[href="#deep-section"]')?.click()`);
            const inPage = await polishWaitFor(h, atTop("Deep Section"), 4000);
            await h.shot("cdp-shots/code-fixes-jumps-in-page-anchor.png");
            rec(
                "an in-page #anchor link scrolls to its heading",
                before > 200 && inPage === true && (await h.ev(PATH_SHOWN)) === "docs/guide.md",
                `before=${before} after=${await h.ev(headingTop("Deep Section"))}`
            );
            return steps;
        },
        teardown: teardown("code-fixes-jumps"),
    };

    const toolbar = {
        name: "code-fixes-toolbar",
        surface: "code",
        arrange: (h) => arrangeRepo(h, "verify-code-fixes-toolbar"),
        async assert(h, ctx) {
            if (ctx.arrangeError) return [{ step: "arrange the temp repo", ok: false, detail: ctx.arrangeError }];
            const { steps, rec } = begin(ctx);
            await enterProject(h, ctx, rec);

            const readme = await openRoot(h, "README.md");
            await polishWaitFor(h, `!!document.querySelector('[data-code-view-mode="source"]')`, 6000);
            await h.ev(`document.querySelector('[data-code-view-mode="source"]')?.click()`);
            const toSource = await polishWaitFor(h, `!!document.querySelector(".monaco-editor .view-line") && !document.querySelector("[data-code-preview]")`, 8000);
            const selSource = await h.ev(SELECTED_MODES);
            await h.shot("cdp-shots/code-fixes-toolbar-source.png");
            await h.ev(`document.querySelector('[data-code-view-mode="preview"]')?.click()`);
            const toPreview = await polishWaitFor(h, `!!document.querySelector("[data-code-preview] .heading")`, 8000);
            const selPreview = await h.ev(SELECTED_MODES);
            await h.shot("cdp-shots/code-fixes-toolbar-preview.png");
            rec(
                "the view-mode toggle switches a markdown file between source and preview, one segment selected",
                readme && toSource === true && toPreview === true && JSON.stringify(selSource) === '["source"]' && JSON.stringify(selPreview) === '["preview"]',
                `source=${toSource} ${JSON.stringify(selSource)} preview=${toPreview} ${JSON.stringify(selPreview)}`
            );

            // README was left in preview mode; a .js file has no preview, so Source is the one selected segment
            const sizes = [];
            for (const vp of [SMALL, BIG]) {
                await h.cdp("Emulation.setDeviceMetricsOverride", vp);
                const js = await openByPalette(h, "src/a.js", "src/a.js");
                await polishWaitFor(h, `!!document.querySelector(".monaco-editor .view-line")`, 8000);
                sizes.push({ at: `${vp.width}x${vp.height}`, js, selected: await h.ev(SELECTED_MODES) });
                await h.shot(`cdp-shots/code-fixes-toolbar-js-${vp.width}.png`);
                await openRoot(h, "README.md");
            }
            rec(
                "a .js file opened from preview mode shows Source as its one selected segment, at 1000x700 and 1600x950",
                sizes.every((s) => s.js === true && JSON.stringify(s.selected) === '["source"]'),
                JSON.stringify(sizes)
            );

            const widths = [];
            for (const vp of [SMALL, BIG]) {
                await h.cdp("Emulation.setDeviceMetricsOverride", vp);
                const long = await openByPalette(h, "docs/long.md", "docs/long.md");
                await polishWaitFor(h, `${VIEWPORT} != null`, 8000);
                await polishNap(300);
                const w = await h.ev(`(() => { const v = ${VIEWPORT}; return v ? { scroll: v.scrollWidth, client: v.clientWidth } : null; })()`);
                widths.push({ at: `${vp.width}x${vp.height}`, long, ...w });
                await h.shot(`cdp-shots/code-fixes-toolbar-long-${vp.width}.png`);
                await openRoot(h, "README.md");
            }
            rec(
                "long markdown does not overflow the preview sideways, at 1000x700 and 1600x950",
                widths.every((w) => w.long === true && w.scroll != null && w.scroll <= w.client + 1),
                JSON.stringify(widths)
            );
            return steps;
        },
        teardown: teardown("code-fixes-toolbar"),
    };

    return [markdown, editor, jumps, toolbar];
}
