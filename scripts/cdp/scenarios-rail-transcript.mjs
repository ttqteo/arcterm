// The Agent panel's Transcript tab (docs/superpowers/specs/2026-10-29-rail-transcript-tab-design.md), on a long compacted
// session: about 50 MB and more than 8,400 lines, with large tool results and base64 images, two compactions (the older
// more than 5,000 lines from the end), so the first read holds only the last 2,000 lines and everything before is loaded
// back on demand. The fixture agent's terminal is a real block (focus goes to its xterm); a second fixture agent names a
// transcript that is not there, a third none. kit holds scenarios.mjs's helpers.

import { randomUUID } from "node:crypto";
import { appendFileSync, closeSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync, writeSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const AGENT = "fx-rail-transcript";
const AGENT_MISSING = "fx-rail-transcript-missing";
const AGENT_NONE = "fx-rail-transcript-none";
const PROJECT = "verify-rail-transcript";
const KEYS = ["agent.rail.visible", "cockpit.rail.sections", "agent.rail.tab", "agent.rail.wideWidth", "code.project.last", "agent.launch.recentprojects"];
// the remembered wide width the scenario starts from (the window's max at the pinned 1600px viewport is 634)
const WIDE_PX = 600;

// the fixture: 1,050 turns of a user message, three tool calls with their results, and the reply (8 lines each), a
// compaction after turns 375 and 875 (2 lines each). The last 2,000 lines (the first read) hold the newer compaction and
// about 750 items; the older one is 5,400 lines from the end
const TURNS = 1050;
const TOOLS_PER_TURN = 3;
const COMPACT_AFTER = [375, 875];
const COMPACTIONS = [
    { pre: 142000, post: 9100, summary: "OLDER-COMPACTION-SUMMARY: the early part of the session, summarised." },
    { pre: 181000, post: 14000, summary: "NEWER-COMPACTION-SUMMARY: the middle of the session, summarised." },
];
const RESULT_BYTES = 12_000; // a tool result
const IMAGE_BYTES = 300_000; // a pasted image (400 KB as base64) on every 40th turn

const ASIDE = `document.querySelector('aside[aria-label="Agent details"]')`;
const SCROLLER = `document.querySelector("[data-rail-transcript]")`;
const ROOT = `${SCROLLER}?.querySelector("[data-compact-transcript]")`;
const ITEMS = `${ROOT}?.querySelectorAll(":scope > [data-compact-item]")`;
const TAB_LABELS = `[...(${ASIDE}?.querySelectorAll('[role="tab"]') ?? [])].map((t) => t.getAttribute("aria-label") + (t.getAttribute("aria-selected") === "true" ? "*" : ""))`;
const ASIDE_WIDTH = `Math.round(${ASIDE}?.getBoundingClientRect().width ?? 0)`;
const LOADED = `(() => { const s = ${SCROLLER}; return s ? { start: Number(s.dataset.loadedStart ?? -1), lines: Number(s.dataset.loadedLines ?? -1) } : null; })()`;
const LOADED_START = `Number(${SCROLLER}?.dataset.loadedStart ?? -1)`;
// each compaction marker's offset below the scroller's top, and where the pinned prompt's band ends (0 with none): a marker
// the Compactions button put at the top is read when it is clear of the band, close under it
const MARKERS = `(() => {
    const s = ${SCROLLER};
    const top = s.getBoundingClientRect().top;
    const bandEl = s.querySelector("[data-pinned-prompt] > div");
    const band = bandEl ? Math.round(bandEl.getBoundingClientRect().bottom - top) : 0;
    return [...(${ROOT}?.querySelectorAll(":scope > [data-compact-compaction]") ?? [])].map((m) => ({ text: m.textContent.trim(), off: Math.round(m.getBoundingClientRect().top - top), band }));
})()`;
const CLEAR_AT_TOP = (m) => m.off >= m.band && m.off <= m.band + 40;
const CLEAR_AT_TOP_JS = `(m) => m.off >= m.band && m.off <= m.band + 40`;

// 12 KB of text a tool printed, the same for every call but led by its own number so no two lines are alike
function resultText(n) {
    const row = "src/session/transcript/reader.ts:118:    const loaded = await readWindow(path, start, count); // keeps the lines in order\n";
    return `call ${n}\n${row.repeat(Math.ceil(RESULT_BYTES / row.length))}`.slice(0, RESULT_BYTES);
}

// a base64 blob of random bytes: it is not a decodable PNG, which the tab never needs, only the bytes a pasted image carries
function imageData() {
    const bytes = Buffer.alloc(IMAGE_BYTES);
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = (i * 2654435761) >>> 24;
    return bytes.toString("base64");
}

const jsonl = (cwd, at, o) => JSON.stringify({ cwd, timestamp: new Date(at).toISOString(), ...o }) + "\n";
const userRec = (cwd, at, content) => jsonl(cwd, at, { type: "user", message: { role: "user", content } });
const assistantRec = (cwd, at, content) => jsonl(cwd, at, { type: "assistant", message: { role: "assistant", content } });

// one more turn at the end of the file: a prompt and its reply, each carrying `label`
function turnText(cwd, at, label) {
    return (
        userRec(cwd, at, [{ type: "text", text: `APPEND-MARK-${label}` }]) +
        assistantRec(cwd, at + 1000, [{ type: "text", text: `APPEND-REPLY-${label}` }])
    );
}

// writes the fixture transcript; returns its line count
function writeTranscript(file, cwd, title) {
    const fd = openSync(file, "w");
    const image = imageData();
    const result = resultText(0);
    let lines = 0;
    const put = (s) => {
        writeSync(fd, s);
        lines += s.split("\n").length - 1;
    };
    let at = Date.now() - 20 * 86_400_000;
    for (let turn = 0; turn < TURNS; turn += 1) {
        const text = turn === 0 ? title : `turn ${turn}: look at the reader and tell me what it does with a short window`;
        // the first prompt is a plain string, as a session's title is read from it
        const content = turn === 0 ? text : [{ type: "text", text }];
        if (turn > 0 && turn % 40 === 0) content.unshift({ type: "image", source: { type: "base64", media_type: "image/png", data: image } });
        put(userRec(cwd, at, content));
        at += 1000;
        for (let k = 0; k < TOOLS_PER_TURN; k += 1) {
            const id = `t${turn}_${k}`;
            // the last turn reads a file that exists, which a step opens in the File tab from the tool line's link
            const input =
                k === 0
                    ? { command: `ls -la src/${turn}`, description: `list src/${turn}` }
                    : k === 1
                      ? { file_path: turn === TURNS - 1 ? join(cwd, "notes.txt") : join(cwd, `src/file${turn}.ts`) }
                      : { pattern: `window${turn}`, path: cwd };
            put(assistantRec(cwd, at, [{ type: "tool_use", id, name: ["Bash", "Read", "Grep"][k], input }]));
            at += 2000;
            put(userRec(cwd, at, [{ type: "tool_result", tool_use_id: id, content: result.replace("call 0", `call ${turn}.${k}`), is_error: false }]));
            at += 1000;
        }
        put(assistantRec(cwd, at, [{ type: "text", text: `Turn ${turn}: the reader keeps its lines in order and reads only the window it is asked for.` }]));
        at += 1000;
        const c = COMPACT_AFTER.indexOf(turn);
        if (c >= 0) {
            const { pre, post, summary } = COMPACTIONS[c];
            put(jsonl(cwd, at, { type: "system", subtype: "compact_boundary", compactMetadata: { trigger: "auto", preTokens: pre, postTokens: post } }));
            put(userRec(cwd, at + 1, summary).replace('"type":"user"', '"type":"user","isCompactSummary":true'));
            at += 2000;
        }
    }
    closeSync(fd);
    return lines;
}

// the renderer's JS heap in MB after a collection, through CDP
async function heapMb(h) {
    await h.cdp("HeapProfiler.collectGarbage").catch(() => {});
    const u = await h.cdp("Runtime.getHeapUsage");
    return Math.round(u.usedSize / 1048576);
}

export default function (kit) {
    const { waveService, polishWaitFor, polishNap, openRailTerminal, ahReload, waitForProjectInConfig, TREE_RAIL_FIXTURE, UI_ROUTE, MOD_BIT } = kit;

    async function key(h, k, code, keyCode, modifiers = 0) {
        const e = { key: k, code, windowsVirtualKeyCode: keyCode, modifiers };
        await h.cdp("Input.dispatchKeyEvent", { type: "keyDown", ...e });
        await h.cdp("Input.dispatchKeyEvent", { type: "keyUp", ...e });
        await polishNap(500);
    }

    // the agent's pane is the one shown, with its rail
    async function show(h, id) {
        await h.rpc("uireveal", { address: `agent:${id}` }, UI_ROUTE);
        return polishWaitFor(h, `(() => { const p = document.querySelector('[data-agent-terminal="${id}"]'); return p != null && !p.classList.contains("hidden"); })()`, 10000);
    }

    // the Transcript tab selected and its first read landed
    async function openTab(h, ms = 90000) {
        await h.ev(`${ASIDE}?.querySelector('[data-rail-tab="transcript"]')?.click()`);
        return polishWaitFor(h, `Number(${SCROLLER}?.dataset.loadedLines ?? 0) > 0 && !!${ROOT}`, ms);
    }

    // scrolls the tab to the top over and over until `done` (a page expression) holds: each arrival at the top draws more
    // items, or loads an earlier chunk once all are drawn
    async function scrollUntil(h, done, ms = 90000) {
        for (let waited = 0; waited < ms; waited += 400) {
            if (await h.ev(done)) return true;
            await h.ev(`(() => { const s = ${SCROLLER}; if (s) s.scrollTop = 0; })()`);
            await polishNap(400);
        }
        return h.ev(done);
    }

    const scenario = {
        name: "rail-transcript-tab",
        surface: "agent",
        async arrange(h) {
            const ctx = {
                base: mkdtempSync(join(tmpdir(), "verify-rail-transcript-")),
                // under the home directory: the session scan drops a session whose project sits under the temp dir
                cwd: mkdtempSync(join(homedir(), ".verify-rail-transcript-")),
                id: randomUUID().slice(0, 8),
                terminals: [],
                prevFixture: existsSync(TREE_RAIL_FIXTURE) ? readFileSync(TREE_RAIL_FIXTURE, "utf8") : null,
                prevKeys: {},
            };
            try {
                for (const k of KEYS) ctx.prevKeys[k] = await h.ev(`localStorage.getItem(${JSON.stringify(k)})`);
                const git = (...args) => execFileSync("git", ["-C", ctx.cwd, "-c", "user.email=v@v", "-c", "user.name=v", ...args], { stdio: "pipe" });
                git("init", "-q", "--initial-branch=main");
                writeFileSync(join(ctx.cwd, "notes.txt"), "the notes a tool line links to\n");
                git("add", ".");
                git("commit", "-qm", "seed");
                ctx.title = `verify-rail-transcript-${ctx.id}`;
                ctx.transcript = join(ctx.base, "agent.jsonl");
                ctx.lines = writeTranscript(ctx.transcript, ctx.cwd, ctx.title);
                // the same file as a past session, for Conversation History
                ctx.sessionDir = join(homedir(), ".claude", "projects", `verify-rail-transcript-${ctx.id}`);
                mkdirSync(ctx.sessionDir, { recursive: true });
                copyFileSync(ctx.transcript, join(ctx.sessionDir, `${randomUUID()}.jsonl`));
                ctx.missing = join(ctx.base, "gone.jsonl");

                await h.rpc("createproject", { name: PROJECT, path: ctx.cwd });
                ctx.project = PROJECT;
                await waitForProjectInConfig(h, PROJECT);
                const bootTab = String(await h.ev("window.TabRpcClient.routeId")).replace(/^tab:/, "");
                const wslist = await h.rpc("workspacelist", null);
                const ws = wslist.find((w) => (w.workspacedata?.tabids ?? []).includes(bootTab)) ?? wslist[0];
                ctx.workspaceId = ws.workspacedata.oid;
                await openRailTerminal(h, ctx, PROJECT);

                const agent = (a) => ({ project: PROJECT, task: "read the conversation back", state: "idle", agent: "claude", model: "opus", idleSince: Date.now() - 60_000, ...a });
                mkdirSync(new URL(".", TREE_RAIL_FIXTURE), { recursive: true });
                writeFileSync(
                    TREE_RAIL_FIXTURE,
                    JSON.stringify(
                        [
                            agent({ id: AGENT, name: "rail transcript agent", blockId: ctx.terminals[0].blockId, transcriptPath: ctx.transcript }),
                            agent({ id: AGENT_MISSING, name: "rail transcript missing", blockId: "fx-blk-rail-transcript-missing", transcriptPath: ctx.missing }),
                            agent({ id: AGENT_NONE, name: "rail transcript none", blockId: "fx-blk-rail-transcript-none" }),
                        ],
                        null,
                        2
                    )
                );
                ctx.wroteFixture = true;
                // a known rail: open, on Overview, every section at its default, the wide width at a value of its own
                await h.ev(`(() => {
                    localStorage.setItem("agent.rail.visible", "true");
                    for (const k of ["cockpit.rail.sections", "agent.rail.tab"]) localStorage.removeItem(k);
                    localStorage.setItem("agent.rail.wideWidth", ${JSON.stringify(String(WIDE_PX))});
                })()`);
                if (!(await ahReload(h))) throw new Error("the page did not come back after the reload");
                await h.goto("agent");
                ctx.inRoster = await polishWaitFor(h, `!!document.querySelector('[data-agent-terminal="${AGENT}"]')`, 20000);
                ctx.shown = ctx.inRoster && (await show(h, AGENT));
                ctx.xterm = ctx.shown && (await polishWaitFor(h, `!!document.querySelector('[data-agent-terminal="${AGENT}"] .xterm-helper-textarea')`, 15000));
            } catch (e) {
                ctx.arrangeError = String(e?.message ?? e);
            }
            return ctx;
        },
        async assert(h, ctx) {
            const steps = [];
            const rec = (step, ok, detail) => steps.push({ step, ok, detail });
            if (ctx.arrangeError != null || !ctx.xterm) {
                rec("0. the fixture transcript, its agents and the agent's terminal are in place", false, ctx.arrangeError ?? JSON.stringify({ inRoster: ctx.inRoster, shown: ctx.shown, xterm: ctx.xterm }));
                return steps;
            }
            // a thrown call (the page went away, a CDP timeout) must not discard the steps recorded so far
            try {
                const heap0 = await heapMb(h);

                // 1. the strip shows Transcript; clicking it opens the rail at the remembered wide width, and File opens at the same
                const tabs1 = await h.ev(TAB_LABELS);
                const w1a = await h.ev(ASIDE_WIDTH);
                const t0 = Date.now();
                const opened1 = await openTab(h);
                const readMs = Date.now() - t0;
                const w1 = await h.ev(ASIDE_WIDTH);
                const first = await h.ev(LOADED);
                const items1 = await h.ev(`${ITEMS}?.length ?? 0`);
                const heap1 = await heapMb(h);
                await h.shot("cdp-shots/rail-transcript-tab-opened.png");
                const want = await h.ev(`Math.min(${WIDE_PX}, Math.max(360, window.innerWidth - (window.innerWidth < 900 ? 56 : 78) - 248 - 640))`);
                // the last turn's Read names notes.txt: its fold opened, the tool line's link opens the file in the File tab
                await h.ev(`${ROOT}?.querySelector(":scope > [data-compact-item]:last-child [data-fold], :scope > [data-compact-item]:nth-last-child(2) [data-fold]")?.click()`);
                const linked = await polishWaitFor(h, `!![...(${ROOT}?.querySelectorAll("[data-path-link]") ?? [])].find((b) => b.dataset.pathLink.endsWith("notes.txt"))`, 8000);
                await h.ev(`[...${ROOT}.querySelectorAll("[data-path-link]")].find((b) => b.dataset.pathLink.endsWith("notes.txt"))?.click()`);
                const fileOpen = await polishWaitFor(h, `!!${ASIDE}?.querySelector("[data-rail-file]")`, 10000);
                await polishNap(700);
                const w1f = await h.ev(ASIDE_WIDTH);
                const tabs1f = await h.ev(TAB_LABELS);
                const stored = await h.ev(`localStorage.getItem("agent.rail.wideWidth")`);
                rec(
                    "1. the strip shows Transcript on the agent (Overview 300px); clicking it opens the rail at the remembered wide width and reads the last 2,000 lines; a file opened from a tool line opens at the same width",
                    JSON.stringify(tabs1) === JSON.stringify(["Overview*", "Files", "Changes", "Transcript"]) &&
                        Math.abs(w1a - 300) <= 2 &&
                        opened1 &&
                        Math.abs(w1 - want) <= 2 &&
                        first?.lines === 2000 &&
                        first.start === ctx.lines - 2000 &&
                        items1 > 0 &&
                        linked &&
                        fileOpen &&
                        Math.abs(w1f - w1) <= 2 &&
                        tabs1f.includes("Transcript") &&
                        tabs1f.some((t) => t.startsWith("File notes.txt")) &&
                        stored === String(WIDE_PX),
                    JSON.stringify({ tabs1, w1a, w1, want, w1f, first, fileLines: ctx.lines, items1, readMs, linked, fileOpen, tabs1f, stored, heapMbBefore: heap0, heapMbAfterFirstRead: heap1 })
                );

                // back on Transcript for the steps that follow
                await h.ev(`${ASIDE}?.querySelector('[data-rail-tab="transcript"]')?.click()`);
                await polishWaitFor(h, `Number(${SCROLLER}?.dataset.loadedLines ?? 0) > 0 && !!${ROOT}`, 90000);
                await polishNap(500);

                // 2. scrolled to the top, more items are drawn, and the item that was at the top keeps its place
                const before2 = await h.ev(`(() => {
                    const s = ${SCROLLER};
                    const root = ${ROOT};
                    const items = root.querySelectorAll(":scope > [data-compact-item]");
                    window.__rtFirst = items[0];
                    s.scrollTop = 0;
                    return { n: items.length, off: Math.round(items[0].getBoundingClientRect().top - s.getBoundingClientRect().top) };
                })()`);
                const grew = await polishWaitFor(h, `(${ITEMS}?.length ?? 0) > ${before2.n}`, 8000);
                await polishNap(300);
                const after2 = await h.ev(`(() => {
                    const s = ${SCROLLER};
                    const f = window.__rtFirst;
                    return { n: ${ITEMS}.length, kept: f?.isConnected === true, off: f?.isConnected ? Math.round(f.getBoundingClientRect().top - s.getBoundingClientRect().top) : null };
                })()`);
                await h.shot("cdp-shots/rail-transcript-tab-more-items.png");
                rec(
                    "2. scrolling the tab to the top draws 200 more items, and the item that was at the top stays within 2px of where it was",
                    grew && after2.n > before2.n && after2.kept && after2.off != null && Math.abs(after2.off - before2.off) <= 2,
                    JSON.stringify({ before2, after2 })
                );

                // 3. a fold opened, then the top reached until an earlier chunk loads: the fold is still open
                const mark = await h.ev(`(() => {
                    const root = ${ROOT};
                    const fold = root.querySelectorAll("[data-fold]")[3];
                    if (!fold) return null;
                    fold.click();
                    fold.closest("[data-compact-item]").dataset.rtMark = "1";
                    return true;
                })()`);
                await polishNap(400);
                const open3 = await h.ev(`${ROOT}?.querySelector('[data-rt-mark="1"] [data-fold]')?.getAttribute("aria-expanded")`);
                const start3 = await h.ev(LOADED_START);
                const loaded3 = await scrollUntil(h, `${LOADED_START} < ${start3}`);
                await polishNap(600);
                const after3 = await h.ev(`(() => ({
                    loaded: ${LOADED},
                    kept: ${ROOT}?.querySelector('[data-rt-mark="1"] [data-fold]')?.getAttribute("aria-expanded") ?? null,
                    items: ${ITEMS}?.length ?? 0,
                }))()`);
                await h.shot("cdp-shots/rail-transcript-tab-earlier-chunk.png");
                rec(
                    "3. after a fold is opened, scrolling to the top until an earlier chunk loads moves the loaded start back 2,000 lines, and the fold is still open",
                    mark === true && open3 === "true" && loaded3 && after3.loaded?.start === start3 - 2000 && after3.loaded.lines === 4000 && after3.kept === "true",
                    JSON.stringify({ mark, open3, start3, loaded3, after3 })
                );

                // 4. Compactions: the newest marker at the top, then an earlier chunk loads and the older one, then none
                const markers0 = await h.ev(MARKERS);
                const press = () => h.ev(`document.querySelector("[data-rail-compactions]")?.click()`);
                const control = await h.ev(`!!document.querySelector("[data-rail-compactions]")`);
                await press();
                await polishNap(900);
                const newest = await h.ev(MARKERS);
                await h.shot("cdp-shots/rail-transcript-tab-compaction-newest.png");
                const atTop = (list, digits) => list.some((m) => m.text.includes(digits) && CLEAR_AT_TOP(m));
                const start4 = await h.ev(LOADED_START);
                await press();
                const older = await polishWaitFor(h, `(${MARKERS}).some((m) => m.text.includes("142") && (${CLEAR_AT_TOP_JS})(m))`, 90000);
                await polishNap(500);
                const olderMarkers = await h.ev(MARKERS);
                const start4b = await h.ev(LOADED_START);
                await h.shot("cdp-shots/rail-transcript-tab-compaction-older.png");
                await press();
                const none = await polishWaitFor(h, `!!document.querySelector("[data-rail-compactions-none]")`, 90000);
                await polishNap(500);
                const atStart = await h.ev(`${LOADED}`);
                const noneText = await h.ev(`document.querySelector("[data-rail-compactions-none]")?.textContent ?? null`);
                const heap4 = await heapMb(h);
                await h.shot("cdp-shots/rail-transcript-tab-compaction-none.png");
                rec(
                    "4. Compactions: the first press puts the newest marker at the top, clear of the pinned prompt's band, the second loads an earlier chunk (the loaded start moves back) and puts the older marker there, the third says No earlier compactions at the start of the file",
                    control && atTop(newest, "181") && start4b < start4 && older && atTop(olderMarkers, "142") && none && noneText === "No earlier compactions" && atStart?.start === 0 && atStart.lines === ctx.lines,
                    JSON.stringify({ control, markers0: markers0.map((m) => m.text.slice(0, 40)), newest: newest.map((m) => ({ off: m.off, band: m.band })), start4, start4b, older, olderOffsets: olderMarkers.map((m) => ({ off: m.off, band: m.band })), none, noneText, atStart, fileLines: ctx.lines, heapMbAfterLoadingBackToTheStart: heap4 })
                );

                // 5. Mod+Shift+F from the agent's terminal opens Transcript and takes focus; Esc gives it back
                await h.ev(`${ASIDE}?.querySelector('[data-rail-tab="overview"]')?.click()`);
                await polishNap(400);
                const focused5 = await h.ev(`(() => { const t = document.querySelector('[data-agent-terminal="${AGENT}"] .xterm-helper-textarea'); t?.focus(); return document.activeElement === t; })()`);
                await key(h, "F", "KeyF", 70, MOD_BIT | 8);
                await polishNap(500);
                const tabs5 = await h.ev(TAB_LABELS);
                const inTab = await h.ev(`!!document.activeElement?.closest("[data-rail-transcript]")`);
                await h.shot("cdp-shots/rail-transcript-tab-focus.png");
                await key(h, "Escape", "Escape", 27);
                const back = await h.ev(`document.activeElement?.classList.contains("xterm-helper-textarea") === true`);
                rec(
                    "5. from the agent's terminal, Mod+Shift+F opens the rail on Transcript with focus inside the tab, and Esc puts focus back in the terminal",
                    focused5 && tabs5.includes("Transcript*") && inTab && back,
                    JSON.stringify({ focused5, tabs5, inTab, back })
                );

                // 6. the same file as a past session, in Conversation History's session view: scrolled to the top, items past the first 200
                await h.ev(`document.querySelector("[data-agent-history-open]")?.click()`);
                const history = await polishWaitFor(h, `!!document.querySelector("[data-agent-history]")`, 8000);
                const card = await polishWaitFor(h, `[...(document.querySelectorAll('[data-agent-history] button.border[class*="rounded-[10px]"]') ?? [])].some((b) => b.textContent.includes(${JSON.stringify(ctx.title)}))`, 30000);
                await h.ev(`[...document.querySelectorAll('[data-agent-history] button.border[class*="rounded-[10px]"]')].find((b) => b.textContent.includes(${JSON.stringify(ctx.title)}))?.click()`);
                const session = await polishWaitFor(h, `!!document.querySelector("[data-agent-history] [data-compact-transcript]")`, 60000);
                const SESSION_SCROLL = `(() => {
                    let p = document.querySelector("[data-agent-history] [data-compact-transcript]")?.parentElement;
                    while (p && !/auto|scroll/.test(getComputedStyle(p).overflowY)) p = p.parentElement;
                    return p;
                })()`;
                const SESSION_ITEMS = `document.querySelector("[data-agent-history] [data-compact-transcript]")?.querySelectorAll(":scope > [data-compact-item]").length ?? 0`;
                let drawn6 = 0;
                for (let waited = 0; waited < 60000 && drawn6 <= 200; waited += 400) {
                    await h.ev(`(() => { const s = ${SESSION_SCROLL}; if (s) s.scrollTop = 0; })()`);
                    await polishNap(400);
                    drawn6 = await h.ev(SESSION_ITEMS);
                }
                await h.shot("cdp-shots/rail-transcript-tab-history.png");
                rec(
                    "6. the same JSONL as a past session in Conversation History: scrolling its transcript to the top draws items past the first 200",
                    history && card && session && drawn6 > 200,
                    JSON.stringify({ history, card, session, drawn6 })
                );

                // 7. a transcript that is not there says so, with the reason; an agent with none has no Transcript tab
                await show(h, AGENT_MISSING);
                await h.ev(`${ASIDE}?.querySelector('[data-rail-tab="transcript"]')?.click()`);
                const errored = await polishWaitFor(h, `!!${ASIDE}?.querySelector("[data-rail-transcript-error]")`, 15000);
                const errorText = await h.ev(`${ASIDE}?.querySelector("[data-rail-transcript-error]")?.textContent?.trim() ?? null`);
                await h.shot("cdp-shots/rail-transcript-tab-error.png");
                await show(h, AGENT_NONE);
                await polishNap(600);
                const tabs7 = await h.ev(TAB_LABELS);
                await h.shot("cdp-shots/rail-transcript-tab-no-transcript.png");
                rec(
                    "7. an agent whose transcript file is missing shows an error line saying it could not be read, with the reason; an agent with no transcript path has no Transcript tab",
                    errored && errorText?.startsWith("Could not read the transcript: ") && errorText.length > 45 && tabs7.includes("Overview*") && !tabs7.some((t) => t.startsWith("Transcript")),
                    JSON.stringify({ errored, errorText, tabs7 })
                );

                // 8. what the agent writes shows at the bottom within 5 s and the view follows; read higher up, the position holds
                await show(h, AGENT);
                await h.ev(`${ASIDE}?.querySelector('[data-rail-tab="transcript"]')?.click()`);
                const reread = await polishWaitFor(h, `Number(${SCROLLER}?.dataset.loadedLines ?? 0) > 0 && !!${ROOT}`, 90000);
                // the stream is up and the last read is more than the append interval ago
                await polishNap(4000);
                const AT_BOTTOM = `(() => { const s = ${SCROLLER}; return s.scrollHeight - s.scrollTop - s.clientHeight; })()`;
                const bottom0 = await h.ev(AT_BOTTOM);
                appendFileSync(ctx.transcript, turnText(ctx.cwd, Date.now(), "A"));
                const t8 = Date.now();
                const shownA = await (async () => {
                    while (Date.now() - t8 < 5000) {
                        if (await h.ev(`(${SCROLLER}?.textContent ?? "").includes("APPEND-REPLY-A")`)) return true;
                        await polishNap(150);
                    }
                    return false;
                })();
                const msA = Date.now() - t8;
                await polishNap(400);
                const bottomA = await h.ev(AT_BOTTOM);
                await h.shot("cdp-shots/rail-transcript-tab-appended.png");
                const held0 = await h.ev(`(() => { const s = ${SCROLLER}; s.scrollTop = Math.max(0, s.scrollTop - 1500); return s.scrollTop; })()`);
                await polishNap(600);
                const held1 = await h.ev(`${SCROLLER}.scrollTop`);
                appendFileSync(ctx.transcript, turnText(ctx.cwd, Date.now(), "B"));
                const shownB = await polishWaitFor(h, `(${SCROLLER}?.textContent ?? "").includes("APPEND-REPLY-B")`, 10000);
                await polishNap(600);
                const held2 = await h.ev(`${SCROLLER}.scrollTop`);
                await h.shot("cdp-shots/rail-transcript-tab-appended-held.png");
                rec(
                    "8. a turn appended to the file shows at the bottom within 5 s and the view follows it; scrolled up, the next append leaves scrollTop where it was (within 2px)",
                    reread && bottom0 <= 4 && shownA && bottomA <= 4 && shownB && held0 > 0 && Math.abs(held1 - held0) <= 2 && Math.abs(held2 - held0) <= 2,
                    JSON.stringify({ reread, bottom0, shownA, msA, bottomA, held0, held1, shownB, held2 })
                );
            } catch (e) {
                rec("the scenario stopped early: a page call failed", false, String(e?.message ?? e));
            }
            return steps;
        },
        async teardown(h, ctx) {
            const step = async (what, fn) => {
                try {
                    await fn();
                } catch (e) {
                    console.error(`rail-transcript-tab teardown: ${what} failed: ${e?.message ?? e}`);
                }
            };
            for (const t of ctx.terminals ?? []) {
                await step("close the terminal", () => waveService(h, "workspace", "CloseTab", [ctx.workspaceId, t.tabId, false]));
            }
            if (ctx.project) {
                // deleteproject leaves the channel createproject made, so that goes too
                await step("remove the project", async () => {
                    await h.rpc("deleteproject", { name: ctx.project });
                    const norm = (p) => (p || "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
                    const channels = (await h.rpc("getchannels", null))?.channels ?? [];
                    for (const c of channels.filter((c) => norm(c.projectpath) === norm(ctx.cwd))) {
                        await h.rpc("deletechannel", { channelid: c.oid });
                    }
                });
            }
            if (ctx.wroteFixture) {
                await step("restore the fixture roster", () =>
                    ctx.prevFixture != null ? writeFileSync(TREE_RAIL_FIXTURE, ctx.prevFixture) : rmSync(TREE_RAIL_FIXTURE, { force: true })
                );
            }
            await step("restore the keys", async () => {
                for (const [k, v] of Object.entries(ctx.prevKeys ?? {})) {
                    await h.ev(v == null ? `localStorage.removeItem(${JSON.stringify(k)})` : `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)})`);
                }
            });
            // the session folder under ~/.claude/projects goes before the reload, which rescans
            if (ctx.sessionDir) await step("remove the session folder", () => rmSync(ctx.sessionDir, { recursive: true, force: true }));
            await step("reload onto the restored roster", () => ahReload(h));
            await step("remove the temp dirs", () => {
                rmSync(ctx.base, { recursive: true, force: true });
                rmSync(ctx.cwd, { recursive: true, force: true });
            });
        },
    };
    return [scenario];
}
