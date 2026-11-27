// Scenario `boards-library`: Library → Boards (docs/superpowers/specs/2026-11-19-kael-boards-design.md, plan
// 2026-11-19-kael-boards.md Task 9). The list of the boards agents drew, with a thumbnail each, and what a row opens:
// the open board of an ended agent in Library (canvas, status line, Open conversation), a live agent's board beside its
// Chat on the Agent surface. There is no turns column and no ask box: questions about a board go through Chat's `@board`.
//
// One fixture claude agent over a real tab (no controller, so nothing runs) is the live one; the other boards belong to
// agents that are not in the roster, which is how an ended agent reads. The board commands are stubbed in the page
// (boards-fixtures.mjs): no real drawer runs and wavesrv holds no board. The app bar's project is set to the fixture
// project, and put back at teardown.
//
//   list      [data-library-boards-list] > [data-library-board="<id>"] with [data-library-board-name],
//             [data-library-board-agent-line], [data-library-board-summary], [data-library-board-thumb]
//   open      [data-library-board-open="<id>"] with [data-library-board-conversation], [data-library-board-ended]
//   status    [data-board-status="<waiting|answering|slow|failed|error>"] under the open board's canvas, only while the
//             drawer works or the latest turn failed: [data-board-status-label], [data-board-status-reason], and
//             [data-board-status-stop] (slow) or [data-board-status-retry] (failed)
//   empty     [data-library-boards-empty]
//   strip     [data-board-strip] above the open board's canvas: its drawings row ([data-board-drawings] with a
//             [data-board-drawing="<id>"] chip each) and the Edit switch [data-board-edit] (aria-pressed); a board opens in
//             view mode (the canvas's data-board-view-mode); [data-board-empty] over the canvas of a board with no shapes

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as AC from "./agent-page-fixtures.mjs";
import { boardCalls, boardFile, boardPage, boxElements, installBoardStubs, putBoard, putTurns, rectElement, removeBoardStubs } from "./boards-fixtures.mjs";

const NAME = "boards-library";
const PROJECT = "boards-library-fx";
const OTHER_PROJECT = "boards-library-other";
const EMPTY_PROJECT = "boards-library-empty";
const SESSION = "boards-library-session";
const SESSION_ENDED = "boards-library-ended-session";
const WAIT_MS = 15000;
const REPLY = "The host makes a fresh key on every launch so no other process can reach the last session's wavesrv.";
const ENDED_LINE = "Its agent has ended.";

const B_ENDED = "b0b1b001"; // wavesrv-startup: its agent ended; the newest
const B_LIVE = "b0b1b002"; // jobslot-queue: its agent is in the roster
const B_OLD = "b0b1b003"; // council-rounds: ended, three days old
const B_OTHER = "b0b1b004"; // another project's board
const B_EMPTY = "b0b1b005"; // step 7c's board with nothing drawn on it, there only while that step runs
const N_ENDED = "wavesrv-startup";
const N_LIVE = "jobslot-queue";
const N_OLD = "council-rounds";
const N_OTHER = "retro-flow";
const N_EMPTY = "empty-notes";

const T_DRAWN = "t-drawn";
const T_FWD = "t-forwarded";
const T_FAILED = "t-failed"; // step 6's failed turn, there only while that step runs

const q = JSON.stringify;
const KEY_3 = { key: "3", code: "Digit3", windowsVirtualKeyCode: 51 };

// a filled box, so a click anywhere inside it selects it
const filled = (elements, background) => elements.map((e) => (e.type === "rectangle" ? { ...e, backgroundColor: background } : e));

const ELEMENTS_ENDED = [
    ...filled(boxElements("tauri-host", 40, 40, "Tauri host"), "#a5d8ff"),
    ...filled(boxElements("auth-key", 300, 40, "auth key"), "#ffec99"),
    ...filled(boxElements("sqlite", 170, 200, "SQLite"), "#b2f2bb"),
];
const ELEMENTS_LIVE = [...filled(boxElements("queue", 40, 40, "queue"), "#ffd8a8"), ...filled(boxElements("slot", 300, 40, "slot"), "#d0bfff")];
const ELEMENTS_OLD = filled(boxElements("round", 40, 40, "round"), "#ffc9c9");
const ELEMENTS_OTHER = filled(boxElements("retro", 40, 40, "retro"), "#c3fae8");

export default function (kit) {
    const { waveService, polishNap, ahReload, GRID_KEY, GRID_EMPTY } = kit;
    const { makeTab, closeTabs } = AC.tabFixtures({ waveService });
    const LS_KEYS = [GRID_KEY, "agent.chatmode", "agent.openboards"];

    const scenario = {
        name: NAME,
        surface: "library",

        async arrange(h) {
            const ctx = { prev: {}, dir: mkdtempSync(join(tmpdir(), "verify-blib-")) };
            let at = "reading the keys";
            try {
                for (const k of LS_KEYS) ctx.prev[k] = await h.ev(`localStorage.getItem(${q(k)})`);
                ctx.prevFilter = await AC.agentPage(h, `return globalStore.get(agentsModel().projectFilterAtom);`);

                at = "writing the transcript";
                const base = Date.now() - 3_600_000;
                const o = (sec) => ({ cwd: AC.FIXTURE_DIR, ts: new Date(base + sec * 1000).toISOString() });
                ctx.transcript = AC.writeTranscript(ctx.dir, SESSION, [
                    AC.userText("How does the job queue work? Draw it on a board.", o(0)),
                    AC.assistantText("I asked the drawer to draw it on the board jobslot-queue.", o(20)),
                ]);

                at = "resetting the grid";
                await h.ev(`localStorage.setItem(${q(GRID_KEY)}, ${q(JSON.stringify(GRID_EMPTY))})`);
                await h.ev(`localStorage.removeItem("agent.chatmode")`);
                if (!(await ahReload(h))) throw new Error("the page did not come back after the reload");
                await h.goto("agent");

                at = "making the live agent's tab";
                ctx.agent = await makeTab(h, ctx, {
                    label: PROJECT,
                    blockMeta: { view: "term", "agent:transcriptpath": ctx.transcript },
                });

                at = "setting the roster";
                await AC.setRoster(h, [
                    {
                        project: PROJECT,
                        task: "",
                        agent: "claude",
                        model: "opus",
                        state: "idle",
                        idleSince: Date.now() - 60_000,
                        usage: { contextpct: 12 },
                        id: ctx.agent.tabId,
                        name: "claude · jobqueue",
                        blockId: ctx.agent.blockId,
                        transcriptPath: ctx.transcript,
                    },
                ]);

                at = "stubbing the board commands";
                await installBoardStubs(h);
                const now = Date.now();
                const gone = (n, title, sessionid) => ({ tabid: `boards-library-gone-${n}`, title, sessionid });
                // wavesrv-startup: a drawn turn, then a question forwarded to the agent and answered there
                await putBoard(h, {
                    id: B_ENDED,
                    name: N_ENDED,
                    project: PROJECT,
                    agent: gone(1, "claude · startup", SESSION_ENDED),
                    createdts: now - 7_200_000,
                    elements: ELEMENTS_ENDED,
                    turns: [
                        {
                            id: T_DRAWN,
                            ts: now - 3_600_000,
                            kind: "ask",
                            question: "draw how wavesrv starts",
                            title: "Draw how wavesrv starts",
                            state: "answered",
                            added: 2,
                            shapeids: ["tauri-host", "auth-key"],
                            startedts: now - 3_600_000,
                            answeredts: now - 3_590_000,
                        },
                        {
                            id: T_FWD,
                            ts: now - 1_800_000,
                            kind: "ask",
                            question: "Why is the auth key new on every launch?",
                            on: "auth key",
                            selectedids: ["auth-key"],
                            state: "forwarded",
                            forward: { state: "replied", sentts: now - 1_799_000, reply: REPLY, replyts: now - 1_780_000 },
                        },
                    ],
                });
                await putBoard(h, {
                    id: B_LIVE,
                    name: N_LIVE,
                    project: PROJECT,
                    agent: { tabid: ctx.agent.tabId, title: "claude · jobqueue" },
                    createdts: now - 21_600_000,
                    elements: ELEMENTS_LIVE,
                    turns: [
                        {
                            id: "t-live-1",
                            ts: now - 18_000_000,
                            kind: "request",
                            question: "draw the queue",
                            title: "Draw the queue",
                            state: "answered",
                            added: 2,
                            shapeids: ["queue", "slot"],
                            startedts: now - 18_000_000,
                            answeredts: now - 17_990_000,
                        },
                    ],
                });
                await putBoard(h, {
                    id: B_OLD,
                    name: N_OLD,
                    project: PROJECT,
                    agent: gone(2, "claude · council", undefined),
                    createdts: now - 4 * 86_400_000,
                    elements: ELEMENTS_OLD,
                    turns: [
                        {
                            id: "t-old-1",
                            ts: now - 3 * 86_400_000,
                            kind: "request",
                            question: "draw the rounds",
                            title: "Draw the rounds",
                            state: "answered",
                            added: 1,
                            shapeids: ["round"],
                            startedts: now - 3 * 86_400_000,
                            answeredts: now - 3 * 86_400_000 + 10_000,
                        },
                    ],
                });
                await putBoard(h, {
                    id: B_OTHER,
                    name: N_OTHER,
                    project: OTHER_PROJECT,
                    agent: gone(3, "claude · retro", undefined),
                    createdts: now - 8 * 86_400_000,
                    elements: ELEMENTS_OTHER,
                    turns: [],
                });
                at = "setting the app bar's project";
                await AC.agentPage(h, `globalStore.set(agentsModel().projectFilterAtom, ${q(PROJECT)}); return true;`);
            } catch (e) {
                ctx.arrangeError = `${at}: ${String(e?.message ?? e)}`;
            }
            return ctx;
        },

        async assert(h, ctx) {
            const steps = [];
            const rec = (step, ok, detail) => steps.push({ step, ok: !!ok, detail: typeof detail === "string" ? detail : JSON.stringify(detail) });
            if (ctx.arrangeError != null) {
                rec("0. the fixture agent and the stubbed boards", false, ctx.arrangeError);
                return steps;
            }
            const run = async (name, fn) => {
                try {
                    await fn(name);
                } catch (e) {
                    rec(name, false, `the step threw: ${String(e?.message ?? e)}`);
                }
            };
            const shot = async (name) => {
                try {
                    await h.shot(`cdp-shots/boards-library-${name}.png`);
                } catch (e) {
                    console.error(`boards-library: the shot ${name} failed: ${e?.message ?? e}`);
                }
            };
            const until = async (fn, ms = WAIT_MS) => {
                for (let waited = 0; waited < ms; waited += 250) {
                    if (await fn()) return true;
                    await polishNap(250);
                }
                return false;
            };
            await h.cdp("Emulation.setFocusEmulationEnabled", { enabled: true });

            const A = ctx.agent.tabId;
            const OPEN = (id) => `[data-library-board-open="${id}"]`;
            const text = (sel) => h.ev(`(document.querySelector(${q(sel)})?.textContent ?? null)?.replace(/\\s+/g, " ").trim() ?? null`);
            const count = (sel) => h.ev(`document.querySelectorAll(${q(sel)}).length`);
            const click = (sel) => h.ev(`(() => { const el = document.querySelector(${q(sel)}); if (!el) return false; el.click(); return true; })()`);
            // blurred first: a tab key is Library's only while no field or button holds the focus
            const press = async (k) => {
                await h.ev("document.activeElement?.blur?.()");
                for (const type of ["keyDown", "keyUp"]) {
                    await h.cdp("Input.dispatchKeyEvent", { type, ...k });
                }
                await polishNap(300);
            };
            const setSearch = (value) =>
                h.ev(`(() => {
                    const el = document.querySelector("[data-library-boards-search]");
                    if (!el) return false;
                    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, ${q(value)});
                    el.dispatchEvent(new Event("input", { bubbles: true }));
                    return true;
                })()`);
            // the list as drawn, in order
            const rowsNow = () =>
                h.ev(`[...document.querySelectorAll("[data-library-boards-list] [data-library-board]")].map((row) => ({
                    id: row.getAttribute("data-library-board"),
                    agent: row.getAttribute("data-library-board-agent"),
                    name: (row.querySelector("[data-library-board-name]")?.textContent ?? "").trim(),
                    project: (row.querySelector("[data-library-board-project-name]")?.textContent ?? "").trim(),
                    agentLine: (row.querySelector("[data-library-board-agent-line]")?.textContent ?? "").trim(),
                    summary: (row.querySelector("[data-library-board-summary]")?.textContent ?? "").trim(),
                    thumb: row.querySelector("[data-library-board-thumb]")?.getAttribute("data-library-board-thumb") ?? null,
                    thumbSrc: (row.querySelector("[data-library-board-thumb] img")?.getAttribute("src") ?? "").slice(0, 26),
                    selected: row.getAttribute("aria-current") === "true",
                }))`);
            const ids = (rows) => rows.map((r) => r.id);
            const lib = (body) => boardPage(h, `const L = await mod("app/view/library/librarystore.ts"); ${body}`);
            const libState = () =>
                lib(`return {
                    tab: globalStore.get(L.libraryTabAtom),
                    sel: globalStore.get(L.libraryBoardSelAtom),
                    conv: globalStore.get(L.libraryConvViewAtom),
                    session: globalStore.get(agentsModel().sessionsSelAtom),
                    surface: globalStore.get(agentsModel().surfaceAtom),
                };`);
            const active = () => h.ev(`document.querySelector("[data-library]")?.getAttribute("data-library-active") ?? null`);
            // Excalidraw's App instance off the canvas's React fiber
            const APP = `
                const app = () => {
                    const el = document.querySelector('${OPEN(B_ENDED)} [data-board-canvas] .excalidraw');
                    const key = el && Object.keys(el).find((k) => k.startsWith("__reactFiber$"));
                    for (let f = key ? el[key] : null; f != null; f = f.return) {
                        if (typeof f.stateNode?.updateScene === "function" && f.stateNode?.scene != null) return f.stateNode;
                    }
                    return null;
                };
            `;
            const canvasReady = (id) => until(() => h.ev(`document.querySelector(${q(`${OPEN(id)} [data-board-canvas="${id}"]`)})?.dataset.boardReady === "true"`));
            // the open board's Edit switch, set to on or off: pressed only when it reads the other way, then waited for
            const setEdit = async (id, on) => {
                const sel = `${OPEN(id)} [data-board-edit]`;
                const now = await h.ev(`document.querySelector(${q(sel)})?.getAttribute("aria-pressed") ?? null`);
                if (now == null) return false;
                if (now !== String(on)) await click(sel);
                const ok = await until(() => h.ev(`document.querySelector(${q(sel)})?.getAttribute("aria-pressed") === ${q(String(on))}`));
                await polishNap(300);
                return ok;
            };
            // the board's mode as drawn: the canvas's view mode flag, Excalidraw's drawing toolbar, the Edit switch. The toolbar
            // is probed by .App-toolbar-container, which both layouts render only while the drawing tools show: the phone
            // layout's bottom footer.App-toolbar stays in view mode
            const modeOf = (id) =>
                h.ev(`(() => {
                    const c = document.querySelector(${q(`${OPEN(id)} [data-board-canvas="${id}"]`)});
                    const e = document.querySelector(${q(`${OPEN(id)} [data-board-edit]`)});
                    return {
                        view: c?.dataset.boardViewMode ?? null,
                        toolbar: !!c?.querySelector(".App-toolbar-container"),
                        edit: e?.getAttribute("aria-pressed") ?? null,
                        editLabel: (e?.textContent ?? "").trim(),
                    };
                })()`);
            // the status line under the open ended board's canvas as it reads, or null when there is none
            const STATUS = `${OPEN(B_ENDED)} [data-board-status]`;
            const statusLine = () =>
                h.ev(`(() => {
                    const el = document.querySelector(${q(STATUS)});
                    if (el == null) return null;
                    const label = el.querySelector("[data-board-status-label]");
                    return {
                        state: el.getAttribute("data-board-status"),
                        turn: el.getAttribute("data-board-status-turn"),
                        label: (label?.textContent ?? "").trim(),
                        reason: (el.querySelector("[data-board-status-reason]")?.textContent ?? "").trim(),
                        buttons: [...el.querySelectorAll("button")].map((b) => b.textContent.trim()),
                    };
                })()`);

            // --- 1. the tab strip names 3 in Boards' tooltip (no digit beside a label; the key is the tab's
            // aria-keyshortcuts), and the key 3 opens it ---
            await run("1. Library's tab row names 3 in Boards' tooltip, and the key 3 opens the tab", async (name) => {
                await h.goto("library");
                await h.ev(`document.querySelector('[data-library-tab="conversations"]')?.click()`);
                await until(async () => (await active()) === "conversations");
                const tabs = await h.ev(`[...document.querySelectorAll("[data-library-tab]")].map((t) => ({
                    tab: t.getAttribute("data-library-tab"),
                    key: t.getAttribute("aria-keyshortcuts") ?? "",
                    tip: t.getAttribute("title"),
                    label: t.textContent.replace(/\\s+/g, " ").trim(),
                }))`);
                await press(KEY_3);
                const opened = await until(async () => (await active()) === "boards");
                const listed = await until(async () => (await count(`[data-library-boards-list] [data-library-board]`)) >= 3);
                await shot("1-tab");
                const boards = tabs.find((t) => t.tab === "boards");
                rec(
                    name,
                    tabs.map((t) => t.tab).join() === "conversations,canvases,boards" &&
                        boards?.key === "3" &&
                        boards.tip === "Boards (3)" &&
                        tabs.every((t) => !t.label.match(/\d/)) &&
                        boards.label.startsWith("Boards") &&
                        opened &&
                        listed,
                    { tabs, opened, listed }
                );
            });

            // --- 2. the list: three boards of the app bar's project, with thumbnails, who drew them, the counts ---
            await run("2. the list shows the project's three boards, newest first, each with a thumbnail, its agent's state and its counts", async (name) => {
                const ready = await until(async () => {
                    const rows = await rowsNow();
                    return rows.length === 3 && rows.every((r) => r.thumb === "ready");
                });
                const rows = await rowsNow();
                await shot("2-list");
                const [ended, live, old] = rows;
                const when = /drawn (\d\d:\d\d|\d+ [A-Z][a-z]{2})$/;
                rec(
                    name,
                    ready &&
                        ids(rows).join() === [B_ENDED, B_LIVE, B_OLD].join() &&
                        ended.name === N_ENDED &&
                        ended.agent === "ended" &&
                        ended.agentLine === "claude · startup · ended" &&
                        /^2 turns · 3 shapes · drawn /.test(ended.summary) &&
                        when.test(ended.summary) &&
                        live.name === N_LIVE &&
                        live.agent === "running" &&
                        live.agentLine === "claude · jobqueue · running" &&
                        /^1 turn · 2 shapes · drawn /.test(live.summary) &&
                        old.name === N_OLD &&
                        old.agent === "ended" &&
                        /^1 turn · 1 shape · drawn \d+ [A-Z][a-z]{2}$/.test(old.summary) &&
                        // the project is the app bar's: no row names it
                        rows.every((r) => r.project === "") &&
                        rows.every((r) => r.thumbSrc.startsWith("data:image/svg+xml")),
                    { ready, rows }
                );
            });

            // --- 3. no project picked: every project's boards, each naming its project ---
            await run("3. with no project picked the list holds every project's boards and each row names its project", async (name) => {
                await AC.agentPage(h, `globalStore.set(agentsModel().projectFilterAtom, "all"); return true;`);
                const grew = await until(async () => (await count(`[data-library-boards-list] [data-library-board]`)) === 4);
                const rows = await rowsNow();
                await shot("3-every-project");
                const other = rows.find((r) => r.id === B_OTHER);
                await AC.agentPage(h, `globalStore.set(agentsModel().projectFilterAtom, ${q(PROJECT)}); return true;`);
                const back = await until(async () => (await count(`[data-library-boards-list] [data-library-board]`)) === 3);
                rec(
                    name,
                    grew &&
                        back &&
                        rows.length === 4 &&
                        // newest first across projects: the other project's is the oldest
                        rows.at(-1)?.id === B_OTHER &&
                        other?.name === N_OTHER &&
                        rows.every((r) => r.project !== "") &&
                        other.project === OTHER_PROJECT &&
                        rows.filter((r) => r.id !== B_OTHER).every((r) => r.project === PROJECT),
                    { rows: rows.map((r) => ({ id: r.id, project: r.project })), grew, back }
                );
            });

            // --- 4. the search filters by name ---
            await run("4. the search box filters the list to one board by name, and clearing it brings the rest back", async (name) => {
                await setSearch("job");
                const filtered = await until(async () => (await count(`[data-library-boards-list] [data-library-board]`)) === 1);
                const one = ids(await rowsNow());
                await shot("4-search");
                await setSearch("nothing like it");
                const none = await until(async () => (await count("[data-library-boards-none]")) === 1);
                const noneText = await text("[data-library-boards-none]");
                await setSearch("");
                const back = await until(async () => (await count(`[data-library-boards-list] [data-library-board]`)) === 3);
                rec(
                    name,
                    filtered && one.join() === B_LIVE && none && noneText === 'No board named "nothing like it".' && back,
                    { filtered, one, noneText, back }
                );
            });

            // --- 5. an ended agent's board: its canvas, no status line, the ended line ---
            await run("5. selecting the ended board shows its canvas, no status line (its latest turn is forwarded), the ended line and Open conversation", async (name) => {
                const clicked = await click(`[data-library-board="${B_ENDED}"]`);
                const shown = await until(async () => (await count(OPEN(B_ENDED))) === 1);
                const ready = await canvasReady(B_ENDED);
                await polishNap(500);
                // a forwarded latest turn is answered in Chat: nothing for the line to say
                const lines = await count(STATUS);
                const ended = await text(`${OPEN(B_ENDED)} [data-library-board-ended]`);
                const title = await text(`${OPEN(B_ENDED)} [data-library-board-title]`);
                const state = await text(`${OPEN(B_ENDED)} [data-library-board-state]`);
                const conversation = await text(`${OPEN(B_ENDED)} [data-library-board-conversation]`);
                const canvases = await count(`[data-board-canvas="${B_ENDED}"]`);
                const st = await libState();
                const selectedRow = (await rowsNow()).find((r) => r.selected)?.id;
                await shot("5-ended-board");
                rec(
                    name,
                    clicked &&
                        shown &&
                        ready &&
                        st.tab === "boards" &&
                        st.sel?.boardId === B_ENDED &&
                        st.sel?.project === PROJECT &&
                        st.surface === "library" &&
                        selectedRow === B_ENDED &&
                        title === N_ENDED &&
                        state === "claude · startup · ended · hand edits still save" &&
                        lines === 0 &&
                        ended === ENDED_LINE &&
                        conversation === "Open conversation" &&
                        // one canvas of this board in the page: the Agent surface's split has none while Library shows
                        canvases === 1,
                    { st, selectedRow, title, state, lines, ended, conversation, canvases }
                );
            });

            // --- 6. the status line under the canvas, for a failed latest turn of the ended board ---
            await run("6. a failed latest turn puts the status line under the canvas (Couldn't draw, its reason, Retry); Retry calls BoardAskRetryCommand, and a later drawn turn takes the line away", async (name) => {
                const now = Date.now();
                const reason = "the drawer could not read the transcript";
                const talk = await boardPage(h, `return structuredClone(fx.talks[${q(B_ENDED)}].turns);`);
                const failedTurn = { id: T_FAILED, ts: now - 5000, kind: "request", question: "add the SQLite store", state: "failed", reason, startedts: now - 4000, answeredts: now - 1000 };
                await putTurns(h, B_ENDED, [...talk, failedTurn]);
                const shown = await until(async () => (await statusLine())?.state === "failed");
                const failed = await statusLine();
                const lines = await count(STATUS);
                await polishNap(300);
                await shot("6-status-failed");
                const clicked = await click(`${STATUS} [data-board-status-retry]`);
                await until(async () => (await boardCalls(h, "BoardAskRetryCommand")).length === 1);
                const calls = await boardCalls(h, "BoardAskRetryCommand");
                const retried = await until(async () => (await statusLine())?.state === "answering");
                // the board's own talk again: its latest turn is forwarded, so the line goes
                await putTurns(h, B_ENDED, talk);
                const gone = await until(async () => (await count(STATUS)) === 0);
                rec(
                    name,
                    shown &&
                        failed?.turn === T_FAILED &&
                        failed.label === "Couldn't draw" &&
                        failed.reason === `${reason} · nothing changed` &&
                        failed.buttons.join() === "Retry" &&
                        lines === 1 &&
                        clicked &&
                        calls.length === 1 &&
                        calls[0].project === PROJECT &&
                        calls[0].boardid === B_ENDED &&
                        calls[0].turnid === T_FAILED &&
                        retried &&
                        gone,
                    { failed, lines, calls, retried, gone }
                );
            });

            // --- 7. a hand edit saves under the rev the canvas read ---
            // Edit is pressed first: a board opens in view mode, and the strip above Library's canvas holds the switch
            await run("7. in Edit, a rectangle added on the ended board's canvas is saved: BoardSaveCommand with the board's rev", async (name) => {
                const editOn = await setEdit(B_ENDED, true);
                // opening the board wrapped its loose shapes in an Earlier drawings frame and saved that once, at rev-0
                const wrapped = await until(async () => (await boardFile(h, B_ENDED))?.rev !== "rev-0");
                const before = await boardCalls(h, "BoardSaveCommand");
                const revBefore = (await boardFile(h, B_ENDED))?.rev;
                await boardPage(
                    h,
                    `${APP}
                    const a = app();
                    if (a == null) throw new Error("no Excalidraw on the open board");
                    const rect = ${q(rectElement("hand-rect", 420, 260, 140, 70, { backgroundColor: "#ffc9c9" }))};
                    a.updateScene({ elements: [...a.scene.getElementsIncludingDeleted(), rect] });
                    return true;`
                );
                const saved = await until(async () => (await boardCalls(h, "BoardSaveCommand")).length > before.length);
                const calls = await boardCalls(h, "BoardSaveCommand");
                const call = calls.at(-1);
                const file = await boardFile(h, B_ENDED);
                await shot("7-hand-edit");
                const wrapSave = before[0] == null ? null : JSON.parse(before[0].data).elements.filter((e) => e.type === "frame" && !e.isDeleted);
                rec(
                    name,
                    editOn &&
                        wrapped &&
                        before.length === 1 &&
                        before[0].baserev === "rev-0" &&
                        wrapSave?.length === 1 &&
                        wrapSave[0].name === "Earlier drawings" &&
                        saved &&
                        calls.length === before.length + 1 &&
                        call.project === PROJECT &&
                        call.boardid === B_ENDED &&
                        call.baserev === revBefore &&
                        String(call.data).includes('"hand-rect"') &&
                        file?.rev !== revBefore &&
                        file.elements.some((e) => e.id === "hand-rect") &&
                        // the drawn shapes are still there, and so is their frame
                        file.elements.some((e) => e.id === "tauri-host") &&
                        file.elements.some((e) => e.type === "frame" && !e.isDeleted),
                    { editOn, before: before.map((c) => ({ baserev: c.baserev, frames: wrapSave?.length })), revBefore, calls: calls.map((c) => ({ boardid: c.boardid, baserev: c.baserev, hasRect: String(c.data).includes("hand-rect") })), rev: file?.rev }
                );
            });

            // --- 7b. Library's strip: the Edit switch and the board's drawings row, above a canvas that opens in view mode ---
            await run("7b. Library's strip shows Edit and the board's chip, and a board opens in view mode there; Edit brings the drawing toolbar back", async (name) => {
                const chipsOf = () =>
                    h.ev(`[...document.querySelectorAll(${q(`${OPEN(B_OLD)} [data-board-drawings] [data-board-drawing]`)})].map((b) => {
                        const clone = b.cloneNode(true);
                        clone.querySelector("[data-board-drawing-new]")?.remove();
                        const label = clone.textContent.replace(/\\s+/g, " ").trim();
                        const m = /^(\\d+)\\s*(.*)$/.exec(label);
                        return { n: m?.[1] ?? "", title: m?.[2] ?? label, current: b.getAttribute("aria-current") === "true" };
                    })`);
                const clicked = await click(`[data-library-board="${B_OLD}"]`);
                const shown = await until(async () => (await count(OPEN(B_OLD))) === 1);
                const ready = await canvasReady(B_OLD);
                await until(async () => (await chipsOf()).length === 1);
                await polishNap(500);
                const mode = await modeOf(B_OLD);
                const chips = await chipsOf();
                const strip = await h.ev(`(() => {
                    const s = document.querySelector(${q(`${OPEN(B_OLD)} [data-board-strip]`)})?.getBoundingClientRect();
                    const c = document.querySelector(${q(`${OPEN(B_OLD)} [data-board-canvas="${B_OLD}"]`)})?.getBoundingClientRect();
                    return s == null || c == null ? null : { bottom: Math.round(s.bottom), canvasTop: Math.round(c.top), left: Math.round(s.left), canvasLeft: Math.round(c.left) };
                })()`);
                await shot("7b-strip");
                const on = await setEdit(B_OLD, true);
                const editing = await modeOf(B_OLD);
                await shot("7b-edit");
                const off = await setEdit(B_OLD, false);
                const viewing = await modeOf(B_OLD);
                rec(
                    name,
                    clicked &&
                        shown &&
                        ready &&
                        mode.view === "true" &&
                        !mode.toolbar &&
                        mode.edit === "false" &&
                        mode.editLabel === "Edit" &&
                        chips.length === 1 &&
                        chips[0].n === "1" &&
                        chips[0].title === "Earlier drawings" &&
                        chips[0].current &&
                        // above the canvas, in its column
                        strip != null &&
                        strip.bottom <= strip.canvasTop + 2 &&
                        Math.abs(strip.left - strip.canvasLeft) <= 3 &&
                        on &&
                        editing.view === "false" &&
                        editing.toolbar &&
                        off &&
                        viewing.view === "true" &&
                        !viewing.toolbar,
                    { mode, chips, strip, editing, viewing }
                );
            });

            // --- 7c. a board with nothing on it says how to start ---
            await run("7c. a board with no shapes (its list row has no shapes, as the wire omits 0) shows Nothing drawn yet and names Edit", async (name) => {
                const now = Date.now();
                await putBoard(h, { id: B_EMPTY, name: N_EMPTY, project: PROJECT, agent: { tabid: "boards-library-gone-4", title: "claude · notes" }, createdts: now - 600_000, elements: [], turns: [] });
                const listed = await until(async () => (await count(`[data-library-board="${B_EMPTY}"]`)) === 1);
                const wire = await boardPage(
                    h,
                    `const rows = (await RpcApi.BoardListCommand(null, { project: ${q(PROJECT)} })).boards;
                    const row = rows.find((b) => b.id === ${q(B_EMPTY)});
                    return row == null ? null : { hasShapes: "shapes" in row };`
                );
                const clicked = await click(`[data-library-board="${B_EMPTY}"]`);
                const shown = await until(async () => (await count(OPEN(B_EMPTY))) === 1);
                const ready = await canvasReady(B_EMPTY);
                const shownEmpty = await until(async () => (await count(`${OPEN(B_EMPTY)} [data-board-empty]`)) === 1);
                const line = await text(`${OPEN(B_EMPTY)} [data-board-empty]`);
                const edit = await text(`${OPEN(B_EMPTY)} [data-board-edit]`);
                await shot("7c-empty-board");
                // the ended board is open again as steps 8 and 9c expect it, and the fixture goes
                const back = (await click(`[data-library-board="${B_ENDED}"]`)) && (await until(async () => (await count(OPEN(B_ENDED))) === 1));
                await canvasReady(B_ENDED);
                await boardPage(
                    h,
                    `delete fx.boards[${q(B_EMPTY)}];
                    delete fx.talks[${q(B_EMPTY)}];
                    delete fx.files[${q(B_EMPTY)}];
                    delete fx.inbox[${q(B_EMPTY)}];
                    await feed({ project: ${q(PROJECT)}, boardid: ${q(B_EMPTY)}, what: "list" });
                    return true;`
                );
                const gone = await until(async () => (await count(`[data-library-board="${B_EMPTY}"]`)) === 0);
                rec(
                    name,
                    listed &&
                        wire?.hasShapes === false &&
                        clicked &&
                        shown &&
                        ready &&
                        shownEmpty &&
                        line === "Nothing drawn yet. Press Edit to draw on it." &&
                        edit === "Edit" &&
                        gone &&
                        back,
                    { wire, line, edit, gone, back }
                );
            });

            // --- 8. Open conversation lands on Conversations with the agent's session ---
            await run("8. Open conversation opens Library's Conversations tab on the board's agent session", async (name) => {
                const clicked = await click(`${OPEN(B_ENDED)} [data-library-board-conversation]`);
                const landed = await until(async () => (await active()) === "conversations");
                const st = await libState();
                await polishNap(500);
                await shot("8-conversation");
                rec(
                    name,
                    clicked && landed && st.tab === "conversations" && st.conv === "session" && st.session === `claude:${SESSION_ENDED}` && st.surface === "library",
                    st
                );
            });

            // --- 9. a live agent's board opens beside its Chat on the Agent surface ---
            await run("9. selecting the live agent's board shows it alone over the Agent surface's centre, the split left as it was", async (name) => {
                await h.ev(`document.querySelector('[data-library-tab="boards"]')?.click()`);
                await until(async () => (await count(`[data-library-board="${B_LIVE}"]`)) === 1);
                const gridBefore = await h.ev(`document.querySelector("[data-agent-grid]")?.dataset.agentGridCount ?? null`);
                const clicked = await click(`[data-library-board="${B_LIVE}"]`);
                const ALONE = `[data-board-alone="${PROJECT}/${B_LIVE}"]`;
                const alone = await until(async () => (await count(ALONE)) === 1);
                const st = await boardPage(
                    h,
                    `return {
                        open: [...globalStore.get((await mod("app/view/boards/boardentries.ts")).openBoardsAtom).keys()],
                        surface: globalStore.get(agentsModel().surfaceAtom),
                    };`
                );
                const ready = await until(() => h.ev(`document.querySelector(${q(`${ALONE} [data-board-canvas="${B_LIVE}"]`)})?.dataset.boardReady === "true"`));
                // no cell of it in the split: a pick shows alone, only Open in split or a drop reshapes a split.
                // data-board-cell is on BoardCell's root, which the alone view draws too; a cell in the split is wrapped
                // by BoardGridCell, which carries data-board-cell-of={boardKey} (the key ALONE uses).
                const noCell = (await count(`[data-board-cell-of="${PROJECT}/${B_LIVE}"]`)) === 0;
                const libraryOpen = await count(`[data-library-board-open]`);
                await polishNap(400);
                await shot("9-live-agent");
                rec(
                    name,
                    clicked && alone && ready && noCell && st.surface === "agent" && st.open.length === 0 && libraryOpen === 0,
                    { clicked, alone, ready, st, gridBefore, noCell, libraryOpen }
                );
                // back to the agent, as Close on the alone board does
                await boardPage(h, `(await mod("app/view/agents/agentcenter.ts")).leaveCenter(); return true;`);
            });

            // --- 9b. an ended agent's board goes to a live agent of its project and opens beside its Chat ---
            await run("9b. Open beside Chat… on an ended board lists the project's live agent; picking it takes the board over and opens it beside that agent's Chat, its header reading that chat", async (name) => {
                await boardPage(h, `const S = await mod("app/view/boards/boardsplitstore.ts"); for (const b of [...globalStore.get((await mod("app/view/boards/boardentries.ts")).openBoardsAtom).values()]) S.closeBoard(agentsModel(), b); return true;`);
                await h.goto("library");
                await h.ev(`document.querySelector('[data-library-tab="boards"]')?.click()`);
                await until(async () => (await count(`[data-library-board="${B_OLD}"]`)) === 1);
                const picked = await click(`[data-library-board="${B_OLD}"]`);
                const shown = await until(async () => (await count(`${OPEN(B_OLD)} [data-library-board-takeover]`)) === 1);
                const opened = await click(`${OPEN(B_OLD)} [data-library-board-takeover]`);
                const listed = await until(async () => (await count(`${OPEN(B_OLD)} [data-library-board-takeover-agent]`)) === 1);
                const items = await h.ev(`[...document.querySelectorAll(${q(`${OPEN(B_OLD)} [data-library-board-takeover-agent]`)})].map((b) => ({
                    id: b.getAttribute("data-library-board-takeover-agent"), name: b.textContent.trim(),
                }))`);
                await polishNap(300);
                await shot("9b-takeover-menu");
                const chose = await click(`${OPEN(B_OLD)} [data-library-board-takeover-agent="${A}"]`);
                const SPLIT = `[data-board-cell="${B_OLD}"]`;
                const split = await until(async () => (await count(SPLIT)) === 1);
                const beside = await until(async () => (await h.ev(`document.querySelector("[data-agent-grid]")?.dataset.agentGridCount`)) === "2" && (await count(`[data-agent-terminal="${A}"]`)) === 1);
                const calls = await boardCalls(h, "BoardTakeOverCommand");
                const st = await boardPage(
                    h,
                    `const S = await mod("app/view/boards/boardsplitstore.ts");
                    return { split: ([...globalStore.get((await mod("app/view/boards/boardentries.ts")).openBoardsAtom).values()][0] ?? null), surface: globalStore.get(agentsModel().surfaceAtom) };`
                );
                // the cell's header names the agent just picked as the chat the board reads
                const tied = await until(async () => (await h.ev(`document.querySelector(${q(`${SPLIT} [data-board-chat]`)})?.getAttribute("data-board-chat") ?? null`)) === A);
                await polishNap(400);
                await shot("9b-beside-chat");
                rec(
                    name,
                    picked &&
                        shown &&
                        opened &&
                        listed &&
                        items.length === 1 &&
                        items[0].id === A &&
                        items[0].name === "claude · jobqueue" &&
                        chose &&
                        split &&
                        beside &&
                        calls.length === 1 &&
                        calls[0].project === PROJECT &&
                        calls[0].boardid === B_OLD &&
                        calls[0].tabid === A &&
                        st.surface === "agent" &&
                        st.split?.boardId === B_OLD &&
                        tied,
                    { items, calls, st, tied, beside }
                );
            });

            // --- 9c. Delete board: the header's trash, a confirm, and the board leaves the list ---
            await run("9c. Delete board in the open board's header asks first, then the board leaves the list and the detail", async (name) => {
                await h.goto("library");
                await h.ev(`document.querySelector('[data-library-tab="boards"]')?.click()`);
                await until(async () => (await count(`[data-library-board="${B_ENDED}"]`)) === 1);
                await click(`[data-library-board="${B_ENDED}"]`);
                await until(async () => (await count(`[data-library-board-open="${B_ENDED}"]`)) === 1);
                const rowsBefore = await count(`[data-library-board]`);
                const before = await boardCalls(h, "BoardDeleteCommand");
                const clicked = await click(`[data-library-board-open] [data-library-board-delete="${B_ENDED}"]`);
                // the confirm's button is a DialogButton: its label, then a key-hint <kbd> ("DeleteEnter" as textContent),
                // so match the label alone (firstChild), and only inside the dialog, never the header's text-less trash
                // or a row's Delete button
                const CONFIRM_DELETE = `[...document.querySelectorAll('[role="dialog"] button')].find((b) => (b.firstChild?.textContent ?? "").trim() === "Delete")`;
                const asked = await until(() => h.ev(`${CONFIRM_DELETE} != null`));
                await shot("9c-delete-confirm");
                const confirmed = await h.ev(`(() => {
                    const b = ${CONFIRM_DELETE};
                    b?.click();
                    return b != null;
                })()`);
                const gone = await until(async () => (await count(`[data-library-board="${B_ENDED}"]`)) === 0);
                const calls = await boardCalls(h, "BoardDeleteCommand");
                const detail = await count(`[data-library-board-open]`);
                const rowsAfter = await count(`[data-library-board]`);
                await shot("9c-deleted");
                rec(
                    name,
                    clicked &&
                        asked &&
                        confirmed &&
                        gone &&
                        calls.length === before.length + 1 &&
                        calls.at(-1)?.boardid === B_ENDED &&
                        calls.at(-1)?.project === PROJECT &&
                        detail === 0 &&
                        rowsAfter === rowsBefore - 1,
                    { clicked, asked, confirmed, gone, calls: calls.length, detail, rowsBefore, rowsAfter }
                );
            });

            // --- 10. a project with no boards says so ---
            await run("10. a project with no boards reads No boards in <project> yet, and says where boards come from", async (name) => {
                await boardPage(
                    h,
                    `const S = await mod("app/view/boards/boardsplitstore.ts");
                    for (const b of [...globalStore.get((await mod("app/view/boards/boardentries.ts")).openBoardsAtom).values()]) S.closeBoard(agentsModel(), b);
                    globalStore.set(agentsModel().projectFilterAtom, ${q(EMPTY_PROJECT)});
                    return true;`
                );
                await h.goto("library");
                await h.ev(`document.querySelector('[data-library-tab="boards"]')?.click()`);
                const shown = await until(async () => (await count("[data-library-boards-empty]")) === 1);
                const empty = await text("[data-library-boards-empty]");
                const rows = await count(`[data-library-board]`);
                await shot("10-empty");
                rec(
                    name,
                    shown &&
                        empty === `No boards in ${EMPTY_PROJECT} yet. Boards appear when an agent runs wsh board draw.` &&
                        rows === 0,
                    { empty, rows }
                );
            });

            return steps;
        },

        async teardown(h, ctx) {
            const step = async (what, fn) => {
                try {
                    await fn();
                } catch (e) {
                    console.error(`boards-library teardown: ${what} failed: ${e?.message ?? e}`);
                }
            };
            await step("close the board split and put the app bar's project back", () =>
                AC.agentPage(
                    h,
                    `const S = await mod("app/view/boards/boardsplitstore.ts");
                    for (const b of [...globalStore.get((await mod("app/view/boards/boardentries.ts")).openBoardsAtom).values()]) S.closeBoard(agentsModel(), b);
                    globalStore.set(agentsModel().projectFilterAtom, ${q(ctx.prevFilter ?? "all")});
                    const G = await mod("app/view/agents/gridstore.ts");
                    G.endSplit(agentsModel());
                    return true;`
                )
            );
            await step("restore the board commands", () => removeBoardStubs(h));
            await step("restore the roster", () => AC.restoreRoster(h));
            await step("close the fixture tab", () => closeTabs(h, ctx));
            await step("restore the keys", () =>
                h.ev(`(() => {
                    for (const [k, v] of Object.entries(${q(ctx.prev ?? {})})) {
                        if (v == null) localStorage.removeItem(k);
                        else localStorage.setItem(k, v);
                    }
                    return true;
                })()`)
            );
            await step("reload onto the live roster", () => ahReload(h));
            await step("go home", () => h.goto("cockpit"));
        },
    };

    return [scenario];
}
