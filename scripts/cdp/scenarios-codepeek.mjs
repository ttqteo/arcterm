// code-peek: the terminal Code peek, a card that opens on Ctrl+Shift+click (Cmd+Shift+click on a Mac) on a linked path in an
// agent's terminal (docs/superpowers/plans/2026-11-12-kael-sync-code-diff-usage-setup.md, Task 7; the fork's 8216f5927,
// e7cae9a2c, 6c717bf51, 9f979e412, 8962d9efb, 294cde415 and 19e16133d, and its scenarios-codepeek.mjs). Ctrl+click keeps what it
// always did: it opens the path in the agent's panel (or Code), and no card opens. Inside the card Enter opens the file in Code
// and Escape closes it, both the card's own (data-owns-keys); Escape with focus in the terminal still reaches the agent.
//
// A shell tab is made a claude agent by the agent:status event `wsh agentstatus` publishes (as agent-uploads does), so the Agent
// surface mounts its pane with the details rail. The shell prints one absolute path per row, from column 0: the card starts 4
// cells in, so a click on a row's third cell reaches xterm even while the card covers the rest of the row. Every click is a
// real mouse event with the modifiers set (CDP Input.dispatchMouseEvent), after xterm has resolved the link on a hover.
//
// The last steps read the page's JS heap (HeapProfiler.collectGarbage, then Runtime.getHeapUsage) before the card opens, while
// it is open and after it closes (plan decision 15), and fail when the heap after is more than 5 MB over the heap before. They
// run after the card has opened once, so the code it loads on first use (Markdown, the editors) is not what they measure: the
// card's own text, models and editors are.
//
// kit is scenarios.mjs's KAEL_KITS ({ rt, code, files, jarvis }); what it lacks is defined here.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SURFACE_LABEL } from "./attach.mjs";

const NAME = "verify-code-peek";
const WAIT_MS = 15_000;
const CTRL = 2;
const SHIFT = 8;
const HEAP_LIMIT_MB = 5;
const COMMITTED_LINES = 40;
// a 1x1 png: the peek classifies by mime, so the bytes only need to be a real image
const PIXEL_PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
// the keys the Code surface and the agent panel write, which a landing in Code changes and teardown puts back
const KEYS = ["code.project.last", "code.project.recents", "agent.rail.visible", "agent.rail.tab", "agent.chatmode"];

const ESCAPE = { key: "Escape", code: "Escape", keyCode: 27 };
const ENTER = { key: "Enter", code: "Enter", keyCode: 13 };

const slash = (p) => p.replace(/\\/g, "/");

// in the page: the dev hooks term.tsx and termpathlinks.ts publish, and the card
const LIB = `
    const nap = (ms) => new Promise((r) => setTimeout(r, ms));
    const flat = (el) => (el?.textContent ?? "").replace(/\\s+/g, " ").trim();
    const until = async (fn, ms = 6000) => {
        for (const t0 = Date.now(); Date.now() - t0 < ms; await nap(120)) if (fn()) return true;
        return !!fn();
    };
    const wrap = (id) => window.__arcTerms?.[id] ?? null;
    const screenOf = (id) => wrap(id)?.terminal.element?.querySelector(".xterm-screen") ?? null;
    const card = () => document.querySelector("[data-code-peek]");
    const rectOf = (el) => { const r = el?.getBoundingClientRect(); return r ? { top: r.top, bottom: r.bottom, left: r.left, right: r.right } : null; };
    const info = () => {
        const c = card();
        if (!c) return { count: 0, modes: {}, message: "", stat: "" };
        return {
            count: document.querySelectorAll("[data-code-peek]").length,
            state: c.dataset.peekState,
            side: c.dataset.peekSide,
            rect: rectOf(c),
            path: flat(c.querySelector("[data-peek-path]")),
            message: flat(c.querySelector("[data-peek-message]")),
            stat: flat(c.querySelector("[data-peek-stat]")),
            focused: c.contains(document.activeElement),
            modes: Object.fromEntries([...c.querySelectorAll("[data-peek-mode]")].map((b) => [b.dataset.peekMode, { pressed: b.getAttribute("aria-pressed") === "true", disabled: b.disabled }])),
        };
    };
`;
const inPage = (h, body) => h.ev(`(async () => { ${LIB} ${body} })()`);

async function mouse(h, type, x, y, modifiers = 0) {
    const click = type === "mouseMoved" ? {} : { button: "left", clickCount: 1 };
    await h.cdp("Input.dispatchMouseEvent", { type, x, y, modifiers, ...click });
}

// a real key press, as the dispatcher and the page see it
async function pressKey(h, { key, code, keyCode }) {
    for (const type of ["keyDown", "keyUp"]) {
        await h.cdp("Input.dispatchKeyEvent", { type, key, code, windowsVirtualKeyCode: keyCode });
    }
    await new Promise((r) => setTimeout(r, 450));
}

// the page's JS heap in MB after a collection, or null when this browser answers neither CDP method
async function heapMB(h) {
    try {
        await h.cdp("HeapProfiler.enable", {}).catch(() => {});
        await h.cdp("HeapProfiler.collectGarbage", {});
        const usage = await h.cdp("Runtime.getHeapUsage", {});
        return Math.round((usage.usedSize / 1048576) * 10) / 10;
    } catch {
        return null;
    }
}

function makeRepo(git, dir) {
    for (const d of ["src", "notes", "bin"]) mkdirSync(join(dir, d), { recursive: true });
    git(dir, "init", "-q");
    const committed = Array.from({ length: COMMITTED_LINES }, (_, i) => `export const line${i + 1} = ${i + 1};`);
    writeFileSync(join(dir, "src", "committed.ts"), committed.join("\n") + "\n");
    git(dir, "-c", "core.autocrlf=false", "add", "src/committed.ts");
    git(dir, "-c", "core.autocrlf=false", "commit", "-q", "-m", "seed");
    // two lines changed since HEAD, so the card's Diff and its stat have a + and a −
    const changed = committed.map((l, i) => (i === 2 || i === 3 ? `${l} // changed` : l));
    writeFileSync(join(dir, "src", "committed.ts"), changed.join("\n") + "\n");
    // never added to git: a file not in HEAD, which Diff must draw with no removed line
    writeFileSync(join(dir, "notes", "peek.md"), ["# Code peek", "", "- a new note", "- not in HEAD yet", ""].join("\n"));
    writeFileSync(join(dir, "bin", "blob.bin"), Buffer.from([0x41, 0, 0x42, 0, 0, 0x43]));
    writeFileSync(join(dir, "bin", "pixel.png"), Buffer.from(PIXEL_PNG_B64, "base64"));
}

export default function (kits) {
    const { waveService, polishWaitFor, polishNap, ahReload } = kits.rt;
    const { git } = kits.code;
    const skipStep = (step, detail) => ({ step, skip: true, detail });

    // hovers a linked path (off it first, so xterm resolves it fresh), waits for xterm to mark it as a link, then clicks it
    // with the modifiers held. Resolves to false when the path is not in the viewport
    async function clickLink(h, ctx, text, modifiers) {
        const at = await h.ev(`window.__arcTermPathLinks?.locate(${JSON.stringify(ctx.blockId)}, ${JSON.stringify(text)})`);
        if (at == null) return false;
        const off = await inPage(h, `const r = screenOf(${JSON.stringify(ctx.blockId)})?.getBoundingClientRect(); return r ? { x: Math.round(r.right - 12) } : null;`);
        await mouse(h, "mouseMoved", off?.x ?? at.x + 200, at.y, modifiers);
        await polishNap(100);
        await mouse(h, "mouseMoved", at.x, at.y, modifiers);
        await polishWaitFor(h, `!!window.__arcTerms?.[${JSON.stringify(ctx.blockId)}]?.terminal.element?.querySelector(".xterm-screen")?.classList.contains("xterm-cursor-pointer")`, 3000);
        await mouse(h, "mousePressed", at.x, at.y, modifiers);
        await mouse(h, "mouseReleased", at.x, at.y, modifiers);
        return true;
    }

    // Ctrl+Shift+click on the link, then wait for a card that has finished loading
    async function peek(h, ctx, text) {
        const clicked = await clickLink(h, ctx, text, CTRL | SHIFT);
        if (!clicked) return { clicked, info: { count: 0, modes: {}, message: "", stat: "" } };
        // a fresh store's first minute has wavesrv scanning every transcript on disk (the daily usage tally), which can hold a
        // card's first reads for many seconds: wait for that, not for a fixed beat
        await inPage(h, `await until(() => info().count > 0 && info().state !== "loading", 40000);`);
        await polishNap(300);
        return { clicked, info: await inPage(h, `return info();`) };
    }

    const closeCard = (h) =>
        inPage(h, `card()?.querySelector('button[aria-label="Close the peek"]')?.click(); await until(() => card() == null, 3000); await nap(150); return card() == null;`);

    // The agent's pane shown with its terminal in front: a Claude agent opens on Chat, whose layer covers the terminal, so the
    // header's Terminal is clicked until the xterm screen is what sits under the pointer at the middle of it
    const showAgent = async (h, ctx) => {
        await h.goto("agent");
        return polishWaitFor(
            h,
            `(() => {
                const pane = document.querySelector('[data-agent-terminal="${ctx.tabId}"]');
                const screen = window.__arcTerms?.["${ctx.blockId}"]?.terminal.element?.querySelector(".xterm-screen");
                if (pane == null || pane.classList.contains("hidden") || screen == null) {
                    document.querySelector('[data-agent-row="${ctx.tabId}"]')?.click();
                    return false;
                }
                const r = screen.getBoundingClientRect();
                const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
                if (top != null && screen.contains(top)) return true;
                [...document.querySelectorAll("[data-agent-header] button")].find((b) => b.textContent.trim() === "Terminal")?.click();
                return false;
            })()`,
            WAIT_MS
        );
    };

    const scenario = {
        name: "code-peek",
        surface: "agent",
        async arrange(h) {
            const ctx = {};
            try {
                ctx.repo = mkdtempSync(join(tmpdir(), "vpk-"));
                makeRepo(git, ctx.repo);
                // the paths the shell prints, forward slashes in single quotes: the same in Git Bash, pwsh and cmd
                ctx.paths = {
                    ts: slash(join(ctx.repo, "src", "committed.ts")),
                    md: slash(join(ctx.repo, "notes", "peek.md")),
                    bin: slash(join(ctx.repo, "bin", "blob.bin")),
                    png: slash(join(ctx.repo, "bin", "pixel.png")),
                };
                ctx.prevKeys = await h.ev(`Object.fromEntries(${JSON.stringify(KEYS)}.map((k) => [k, localStorage.getItem(k)]))`);
                const bootTab = String(await h.ev("window.TabRpcClient.routeId")).replace(/^tab:/, "");
                const wslist = await h.rpc("workspacelist", null);
                const ws = wslist.find((w) => (w.workspacedata?.tabids ?? []).includes(bootTab)) ?? wslist[0];
                ctx.workspaceId = ws.workspacedata.oid;
                ctx.tabId = await waveService(h, "workspace", "CreateTab", [ctx.workspaceId, NAME, false]);
                const tab = await waveService(h, "object", "GetObject", [`tab:${ctx.tabId}`]);
                ctx.blockId = tab?.blockids?.[0];
                if (!ctx.blockId) throw new Error("the new tab has no block");
                // the shell starts in ~, so nothing in the app holds the temp repo as its cwd and teardown can remove it
                await h.rpc("setmeta", { oref: `block:${ctx.blockId}`, meta: { view: "term", controller: "shell", "cmd:cwd": "~" } });
                await h.rpc("setmeta", { oref: `tab:${ctx.tabId}`, meta: { "session:project": NAME } });
                await h.rpc("eventpublish", {
                    event: "agent:status",
                    scopes: [`block:${ctx.blockId}`],
                    persist: 1,
                    data: { oref: `block:${ctx.blockId}`, state: "working", agent: "claude", title: NAME, ts: Date.now() },
                });
            } catch (e) {
                ctx.launchError = String(e?.message ?? e);
            }
            return ctx;
        },
        async assert(h, ctx) {
            const first = "the agent's terminal prints file paths, each a link";
            if (ctx.launchError != null) return [skipStep(first, `could not verify: the arrange failed: ${ctx.launchError}`)];
            const steps = [];
            const rec = (step, ok, detail) => steps.push({ step, ok: !!ok, detail: typeof detail === "string" ? detail : JSON.stringify(detail) });

            // 0. the fixture agent's terminal, its shell up, the rows printed
            if (!(await showAgent(h, ctx))) return [skipStep(first, "could not verify: the shell tab never joined the roster as an agent")];
            const shellUp = await polishWaitFor(
                h,
                `(() => { const b = window.__arcTerms?.["${ctx.blockId}"]?.terminal.buffer.active; for (let y = 0; b && y < b.length; y++) if ((b.getLine(y)?.translateToString(true) ?? "").trim() !== "") return true; return false; })()`,
                WAIT_MS
            );
            if (!shellUp) return [skipStep(first, "could not verify: the shell never printed a prompt")];
            await polishNap(1200);
            const echoes = Object.values(ctx.paths).map((p) => `echo '${p}'`).join("; ");
            await h.rpc("controllerinput", { blockid: ctx.blockId, inputdata64: Buffer.from(`clear; ${echoes}\r`).toString("base64") });
            const wanted = Object.values(ctx.paths);
            const linked = await polishWaitFor(
                h,
                `(async () => { const found = (await window.__arcTermPathLinks?.scan(${JSON.stringify(ctx.blockId)})) ?? []; return ${JSON.stringify(wanted)}.every((p) => found.some((f) => f.text === p)); })()`,
                WAIT_MS
            );
            await polishNap(500);
            // what the steps compare at the end: the one xterm element and TermWrap this terminal has had since it mounted
            await inPage(h, `window.__peekNode = wrap(${JSON.stringify(ctx.blockId)})?.terminal.element; window.__peekWrap = wrap(${JSON.stringify(ctx.blockId)});`);
            rec(first, linked, { paths: wanted, linked });
            if (!linked) return steps;

            // 1. the hover hint names both gestures
            const hintAt = await h.ev(`window.__arcTermPathLinks?.locate(${JSON.stringify(ctx.blockId)}, ${JSON.stringify(ctx.paths.ts)})`);
            let hint = "";
            if (hintAt) {
                await mouse(h, "mouseMoved", hintAt.x - 60, hintAt.y + 120, 0);
                await mouse(h, "mouseMoved", hintAt.x, hintAt.y, 0);
                await polishWaitFor(h, `document.body.innerText.includes("click to open committed.ts")`, 3000);
                hint = await h.ev(`[...document.querySelectorAll("[data-tooltip]")].map((t) => t.textContent).join(" | ")`);
            }
            rec(
                "hovering a path names Ctrl+click to open it and Ctrl+Shift+click to peek",
                /click to open committed\.ts/.test(hint) && /Shift-click to peek/.test(hint),
                { hint }
            );

            // 2. Ctrl+click is the open it always was: the agent's panel shows the file, and no card opens
            const opened = await clickLink(h, ctx, ctx.paths.ts, CTRL);
            const inPanel = opened && (await polishWaitFor(h, `(document.querySelector('aside[aria-label="Agent details"] [data-rail-file]')?.innerText ?? "").includes("committed.ts")`, 8000));
            await polishNap(500);
            const afterOpen = await inPage(h, `return { cards: document.querySelectorAll("[data-code-peek]").length };`);
            const surface2 = await h.activeSurfaceLabel();
            rec(
                "Ctrl+click on a path still opens it in the agent's panel, and no card opens",
                opened && inPanel && afterOpen.cards === 0 && surface2 === SURFACE_LABEL.agent,
                { opened, inPanel, cards: afterOpen.cards, surface: surface2 }
            );

            // 3. Ctrl+Shift+click opens the card beside the terminal, with the file's text
            const textCard = await peek(h, ctx, ctx.paths.ts);
            const body3 = await inPage(h, `
                await until(() => card()?.querySelector(".monaco-editor .view-line") != null, 8000);
                await nap(300);
                const pane = card()?.closest("[data-term-view]");
                return { text: flat(card()?.querySelector(".monaco-editor .view-lines")), pane: rectOf(pane) };
            `);
            await h.shot("cdp-shots/code-peek-card.png");
            const c3 = textCard.info;
            rec(
                "Ctrl+Shift+click on a path opens one card beside the terminal, with the file's text",
                c3.count === 1 && c3.state === "text" && c3.path.endsWith("committed.ts") && c3.modes.source?.pressed && body3.text.includes("export const line1") &&
                    body3.pane != null && c3.rect.top >= body3.pane.top && c3.rect.bottom <= body3.pane.bottom && c3.rect.left >= body3.pane.left && c3.rect.right <= body3.pane.right,
                { info: c3, body: body3 }
            );
            rec("the card's stat counts the two changed lines, +2 and −2", /\+2/.test(c3.stat) && /−2/.test(c3.stat), c3.stat);
            await closeCard(h);

            // 4. a binary file, an image
            const binary = await peek(h, ctx, ctx.paths.bin);
            rec("a binary file shows the binary hint", binary.info.state === "binary" && binary.info.message === "Binary file", binary.info);
            await closeCard(h);
            const image = await peek(h, ctx, ctx.paths.png);
            rec("an image shows the image hint", image.info.state === "binary" && image.info.message === "Image — open it in Code", image.info);
            await closeCard(h);

            // 5. a file not in HEAD, in Diff
            const fresh = await peek(h, ctx, ctx.paths.md);
            const diff = await inPage(h, `
                card()?.querySelector('[data-peek-mode="diff"]')?.click();
                await until(() => card()?.querySelector(".monaco-editor .line-insert") != null, 8000);
                await nap(400);
                const ed = card()?.querySelector(".monaco-editor");
                return {
                    pressed: info().modes.diff?.pressed,
                    caption: /New file, not in HEAD/.test(flat(card())),
                    lines: ed?.querySelectorAll(".view-line").length ?? 0,
                    inserted: ed?.querySelectorAll(".view-overlays .line-insert").length ?? 0,
                    removed: card()?.querySelectorAll(".line-delete, .inline-deleted-margin-view-zone").length ?? 0,
                };
            `);
            await h.shot("cdp-shots/code-peek-new-file.png");
            rec(
                "a new (uncommitted) file opens on Preview and its Diff draws every line inserted and no removed line",
                fresh.info.modes.preview?.pressed && diff.pressed && diff.caption && diff.lines > 0 && diff.inserted === diff.lines && diff.removed === 0,
                { opened: fresh.info.modes, diff }
            );

            // 6. with focus in the card, Enter opens the file in Code
            const focused = (await inPage(h, `return info();`)).focused;
            await pressKey(h, ENTER);
            const landed = await polishWaitFor(h, `(document.querySelector("[data-code-path]")?.getAttribute("data-code-path") ?? "").endsWith("peek.md")`, 10000);
            const surface6 = await h.activeSurfaceLabel();
            const cardGone6 = await h.ev(`document.querySelectorAll("[data-code-peek]").length === 0`);
            await h.shot("cdp-shots/code-peek-enter.png");
            rec(
                "with focus in the card, Enter opens the file in Code and closes the card",
                focused && landed && surface6 === SURFACE_LABEL.code && cardGone6,
                { focused, landed, surface: surface6, cardGone: cardGone6 }
            );

            // 7. back in the terminal: reopen it, and Escape closes it
            if (!(await showAgent(h, ctx))) return [...steps, skipStep("Escape closes the reopened card", "could not verify: the agent's terminal did not come back")];
            await polishNap(500);
            const again = await peek(h, ctx, ctx.paths.md);
            await pressKey(h, ESCAPE);
            const esc7 = await inPage(h, `
                const gone = await until(() => card() == null, 3000);
                await nap(150);
                const ta = wrap(${JSON.stringify(ctx.blockId)})?.terminal.textarea;
                return { gone, terminalFocused: ta != null && document.activeElement === ta };
            `);
            rec(
                "reopened, the card takes Escape: it closes and the terminal gets its focus back",
                again.info.count === 1 && again.info.focused && esc7.gone && esc7.terminalFocused,
                { reopened: again.info.count, focused: again.info.focused, ...esc7 }
            );

            // 8. with the card open and focus in the terminal, Escape reaches the terminal and leaves the card open
            // The keys Escape reaches are read twice, with the card open and with it closed, and must match: the card changes
            // nothing about where Escape goes from the terminal. Two probes: on the terminal's textarea, and on window in the
            // capture phase, added after the keybinding dispatcher's, so it sees only the keys the dispatcher left alone
            await peek(h, ctx, ctx.paths.ts);
            const keys = await inPage(h, `
                const t = wrap(${JSON.stringify(ctx.blockId)})?.terminal;
                const s = screenOf(${JSON.stringify(ctx.blockId)})?.getBoundingClientRect();
                window.__peekKeys = { textarea: [], window: [] };
                if (!window.__peekKeyProbe) {
                    window.__peekKeyProbe = true;
                    t.textarea.addEventListener("keydown", (e) => window.__peekKeys.textarea.push(e.key));
                    window.addEventListener("keydown", (e) => window.__peekKeys.window.push(e.key), true);
                }
                // a click on an empty row left of the card, which xterm answers by focusing its textarea
                return s ? { x: Math.round(s.left + 2.5 * (s.width / t.cols)), y: Math.round(s.top + (t.rows - 1.5) * (s.height / t.rows)) } : null;
            `);
            const focusTerminal = async () => {
                if (keys) {
                    await mouse(h, "mousePressed", keys.x, keys.y, 0);
                    await mouse(h, "mouseReleased", keys.x, keys.y, 0);
                }
                await polishNap(250);
                return inPage(h, `const ta = wrap(${JSON.stringify(ctx.blockId)})?.terminal.textarea; return ta != null && document.activeElement === ta;`);
            };
            const termFocused = await focusTerminal();
            await pressKey(h, ESCAPE);
            const stays = await inPage(h, `return { cards: document.querySelectorAll("[data-code-peek]").length, keys: window.__peekKeys };`);
            await h.shot("cdp-shots/code-peek-esc-in-terminal.png");
            await closeCard(h);
            await inPage(h, `window.__peekKeys.textarea.length = 0; window.__peekKeys.window.length = 0;`);
            const termFocusedClosed = await focusTerminal();
            await pressKey(h, ESCAPE);
            const withoutCard = await inPage(h, `return window.__peekKeys;`);
            rec(
                "with the card open and focus in the terminal, Escape leaves the card open and goes where it goes with no card",
                termFocused && termFocusedClosed && stays.cards === 1 && JSON.stringify(stays.keys) === JSON.stringify(withoutCard),
                { termFocused, termFocusedClosed, cardsAfterEscape: stays.cards, withCard: stays.keys, withoutCard }
            );

            // 9. the xterm element and its TermWrap are the ones the terminal mounted with: the card never remounted the pane
            const same = await inPage(h, `
                const w = wrap(${JSON.stringify(ctx.blockId)});
                return { sameWrap: w === window.__peekWrap, sameNode: w?.terminal.element === window.__peekNode, connected: window.__peekNode?.isConnected === true };
            `);
            rec("the terminal's xterm element is the same node throughout", same.sameWrap && same.sameNode && same.connected, same);

            // 10. the page's JS heap: before the card opens, while it is open, and after it closes
            const before = await heapMB(h);
            if (before == null) {
                steps.push(skipStep("closing the card gives its memory back", "could not verify: this browser answers no CDP heap method"));
            } else {
                await peek(h, ctx, ctx.paths.ts);
                await inPage(h, `await until(() => card()?.querySelector(".monaco-editor .view-line") != null, 8000); await nap(500);`);
                const whileOpen = await heapMB(h);
                await closeCard(h);
                await polishNap(500);
                const after = await heapMB(h);
                const delta = Math.round((after - before) * 10) / 10;
                rec(
                    `closing the card gives its memory back: the heap after is no more than ${HEAP_LIMIT_MB} MB over the heap before`,
                    delta <= HEAP_LIMIT_MB,
                    { beforeMB: before, openMB: whileOpen, afterMB: after, deltaMB: delta, limitMB: HEAP_LIMIT_MB }
                );
            }
            return steps;
        },
        async teardown(h, ctx) {
            const step = async (what, fn) => {
                try {
                    await fn();
                } catch (e) {
                    console.error(`code-peek teardown: ${what} failed: ${e?.message ?? e}`);
                }
            };
            await step("close the tab", async () => {
                if (ctx.tabId) await waveService(h, "workspace", "CloseTab", [ctx.workspaceId, ctx.tabId, false]);
            });
            // the landing in Code selected the temp repo as its project: the keys go back, and the reload reads them
            await step("restore the keys", async () => {
                for (const [k, v] of Object.entries(ctx.prevKeys ?? {})) {
                    await h.ev(v == null ? `localStorage.removeItem(${JSON.stringify(k)})` : `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)})`);
                }
            });
            await step("reload onto the restored keys", () => ahReload(h));
            await step("remove the temp repo", () => {
                if (ctx.repo) rmSync(ctx.repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
            });
        },
    };
    return [scenario];
}
