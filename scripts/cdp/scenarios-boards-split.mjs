// Scenario `boards-split`: a board as a cell of the Agent grid beside its agent's Chat (docs/superpowers/specs/
// 2026-11-22-board-cells-design.md). The agent's tree lists the board as a row under it; clicking the row opens it as a
// cell right of the agent's, `[data-board-cell]` inside a `[data-board-cell-of="<project>/<board>"]` wrapper that is a
// sibling of the agent's `[data-agent-terminal]` cell, never inside it. A board cell is a cell of its own (more than one
// can be open); these steps open one at a time, openBoardOn closing the others first. Its header, turns and ask box are the steps below, each a screenshot plus
// a DOM assert. Beside Chat only the latest turn shows, so a step that reads one turn's row puts that turn last; a dense
// board (B3) reads one part at a time (8b), a small one (B1) reads whole.
//
// Two fixture claude agents over real tabs (no controller, so nothing runs) and a mock roster for them; the first has a
// short transcript so Chat has something to show beside the board. The board commands are stubbed in the page
// (boards-fixtures.mjs): no real drawer runs and wavesrv holds no board. A turn's state is whatever the step puts in the
// fixture talk, and a button's call is read back from the stub's record.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as AC from "./agent-page-fixtures.mjs";
import { boardCalls, boardPage, boxElements, installBoardStubs, putBoard, putTurns, removeBoardStubs, textElement } from "./boards-fixtures.mjs";

const NAME = "boards-split";
const PROJECT = "boards-split-fx";
const B1 = "b0a5b001";
const B1_NAME = "wavesrv-startup";
const B2 = "b0a5b002";
const B2_NAME = "jobslot-queue";
const AGENT_TITLE = `claude · ${PROJECT}`;
const WAIT_MS = 15000;
const REPLY = "The host makes a fresh key on every launch so no other process can reach the last session's wavesrv.";
const SESSION = "boards-split-session";

const q = JSON.stringify;

// a filled box, so a click anywhere inside it selects it (Excalidraw selects a transparent shape by its stroke only)
const filled = (elements, background) => elements.map((e) => (e.type === "rectangle" ? { ...e, backgroundColor: background } : e));

const ELEMENTS_1 = [
    ...filled(boxElements("tauri-host", 40, 40, "Tauri host"), "#a5d8ff"),
    ...filled(boxElements("auth-key", 300, 40, "auth key"), "#ffec99"),
    ...filled(boxElements("sqlite", 170, 200, "SQLite"), "#b2f2bb"),
];
const ELEMENTS_2 = filled(boxElements("jobslot", 40, 40, "jobslot"), "#ffd8a8");
// a dense board: three parts far apart, each a titled cluster, so fitted to the canvas its text is too small to read
const B3 = "b0a5b003";
const B3_NAME = "thesis-map";
const partOf = (id, x, y, title) => [
    textElement(`${id}-title`, x, y, title),
    ...filled(boxElements(`${id}-a`, x, y + 40, `${title} A`), "#a5d8ff"),
    ...filled(boxElements(`${id}-b`, x + 200, y + 40, `${title} B`), "#ffec99"),
];
const ELEMENTS_3 = [...partOf("harness", 0, 0, "Harness"), ...partOf("bench", 2400, 0, "Benchmark"), ...partOf("rq", 0, 1800, "Research questions")];

// the talk: your drawn ask, a question forwarded to the agent and answered there, the agent's drawn request
const TA = "t-ask-drawn";
const TB = "t-ask-forwarded";
const TC = "t-request-drawn";
const TD = "t-ask-running";

const baseTurns = (now) => [
    {
        id: TA,
        ts: now - 600_000,
        kind: "ask",
        question: "draw how wavesrv starts",
        title: "Draw how wavesrv starts",
        state: "answered",
        added: 2,
        shapeids: ["tauri-host", "auth-key"],
        startedts: now - 600_000,
        answeredts: now - 590_000,
    },
    {
        id: TB,
        ts: now - 400_000,
        kind: "ask",
        question: "Why is the auth key new on every launch?",
        on: "auth key",
        selectedids: ["auth-key"],
        state: "forwarded",
        forward: { state: "replied", sentts: now - 399_000, reply: REPLY, replyts: now - 380_000 },
    },
    {
        id: TC,
        ts: now - 300_000,
        kind: "request",
        question: "add the SQLite store",
        title: "Add the SQLite store",
        state: "answered",
        added: 1,
        shapeids: ["sqlite"],
        startedts: now - 300_000,
        answeredts: now - 290_000,
    },
];

// the base turns with `id` moved last, so it is the one row beside Chat
const lastTurn = (now, id) => {
    const turns = baseTurns(now);
    return [...turns.filter((t) => t.id !== id), turns.find((t) => t.id === id)];
};

const runningTurn = (now, over = {}) => ({
    id: TD,
    ts: now - 14_000,
    kind: "ask",
    question: "add the build step",
    state: "answering",
    startedts: now - 14_000,
    ...over,
});

export default function (kit) {
    const { waveService, polishNap, ahReload, GRID_KEY, GRID_EMPTY } = kit;
    const { makeTab, closeTabs } = AC.tabFixtures({ waveService });
    const LS_KEYS = [GRID_KEY, "agent.chatmode", "agent.openboards", "board.turns.folded", "agent.header.buttons"];

    const rosterRows = (ctx) =>
        [ctx.agent, ctx.other, ctx.third, ctx.fourth].filter(Boolean).map((tab, i) => ({
            project: PROJECT,
            task: "",
            agent: "claude",
            model: "opus",
            state: "idle",
            idleSince: Date.now() - 60_000,
            usage: { contextpct: 12 },
            id: tab.tabId,
            name: i === 0 ? AGENT_TITLE : `claude · ${PROJECT} ${i + 1}`,
            blockId: tab.blockId,
            ...(i === 0 ? { transcriptPath: ctx.transcript } : {}),
        }));

    const scenario = {
        name: NAME,
        surface: "agent",

        async arrange(h) {
            const ctx = { prev: {}, dir: mkdtempSync(join(tmpdir(), "verify-bsplit-")) };
            let at = "reading the keys";
            try {
                for (const k of LS_KEYS) ctx.prev[k] = await h.ev(`localStorage.getItem(${q(k)})`);

                at = "writing the transcript and the review file";
                const base = Date.now() - 3_600_000;
                const o = (sec) => ({ cwd: AC.FIXTURE_DIR, ts: new Date(base + sec * 1000).toISOString() });
                ctx.transcript = AC.writeTranscript(ctx.dir, SESSION, [
                    AC.userText("How does wavesrv start? Draw it on a board.", o(0)),
                    AC.assistantText(
                        `I asked the drawer to draw it on the board ${B1_NAME}: the Tauri host makes an auth key, spawns wavesrv and reads the WAVESRV-ESTART line for the ports.`,
                        o(20)
                    ),
                    AC.userText("Why is the auth key new on every launch?", o(300)),
                    AC.assistantText(REPLY, o(320)),
                ]);
                ctx.review = join(ctx.dir, "review.md");
                writeFileSync(ctx.review, "# Review\n\nA note the agent asks you to review.\n");

                at = "resetting the grid";
                await h.ev(`localStorage.setItem(${q(GRID_KEY)}, ${q(JSON.stringify(GRID_EMPTY))})`);
                await h.ev(`localStorage.removeItem("agent.chatmode")`);
                await h.ev(`localStorage.removeItem("agent.openboards")`);
                if (!(await ahReload(h))) throw new Error("the page did not come back after the reload");
                await h.goto("agent");

                at = "making the tabs";
                ctx.agent = await makeTab(h, ctx, {
                    label: PROJECT,
                    blockMeta: { view: "term", "agent:transcriptpath": ctx.transcript },
                });
                ctx.other = await makeTab(h, ctx, { label: `${PROJECT}-2`, blockMeta: { view: "term" } });
                // two more for the full 2x2 of step 9
                ctx.third = await makeTab(h, ctx, { label: `${PROJECT}-3`, blockMeta: { view: "term" } });
                ctx.fourth = await makeTab(h, ctx, { label: `${PROJECT}-4`, blockMeta: { view: "term" } });

                at = "setting the roster";
                await AC.setRoster(h, rosterRows(ctx));

                at = "stubbing the board commands";
                await installBoardStubs(h);
                const agent = { tabid: ctx.agent.tabId, title: AGENT_TITLE };
                await putBoard(h, { id: B1, name: B1_NAME, project: PROJECT, agent, turns: baseTurns(Date.now()), elements: ELEMENTS_1 });
                await putBoard(h, { id: B2, name: B2_NAME, project: PROJECT, agent, turns: [], elements: ELEMENTS_2, createdts: Date.now() - 7_200_000 });
                // tied to the other agent, so A's switcher lists only B1 and B2 until 8b opens it there
                await putBoard(h, { id: B3, name: B3_NAME, project: PROJECT, agent: { tabid: ctx.other.tabId, title: `claude · ${PROJECT} 2` }, turns: [], elements: ELEMENTS_3, createdts: Date.now() - 9_000_000 });
            } catch (e) {
                ctx.arrangeError = `${at}: ${String(e?.message ?? e)}`;
            }
            return ctx;
        },

        async assert(h, ctx) {
            const steps = [];
            const rec = (step, ok, detail) => steps.push({ step, ok: !!ok, detail: typeof detail === "string" ? detail : JSON.stringify(detail) });
            if (ctx.arrangeError != null) {
                rec("0. the fixture agents and the stubbed boards", false, ctx.arrangeError);
                return steps;
            }
            const A = ctx.agent.tabId;
            const B = ctx.other.tabId;
            // a step that throws is a failed step, not the end of the run
            const run = async (name, fn) => {
                try {
                    await fn(name);
                } catch (e) {
                    rec(name, false, `the step threw: ${String(e?.message ?? e)}`);
                }
            };
            const shot = async (name) => {
                try {
                    await h.shot(`cdp-shots/boards-split-${name}.png`);
                } catch (e) {
                    console.error(`boards-split: the shot ${name} failed: ${e?.message ?? e}`);
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

            const GRID = "[data-agent-grid]";
            // the agent's own cell (Chat and its terminal), and the board's: a sibling cell of the grid, never inside it
            const CELL = `[data-agent-terminal="${A}"]`;
            const BOARD = "[data-board-cell-of]";
            const CELL_ID = (id) => `board:${PROJECT}/${id}`;
            const SPLIT = (id) => `${BOARD} [data-board-cell="${id}"]`;
            const CANVAS = (id) => `[data-board-canvas="${id}"]`;
            const TREE_ROW = (id) => `[data-tree-board="${id}"]`;
            // the cells drawn (a hidden one is mounted but has no box)
            const shownCells = (sel) =>
                h.ev(`[...document.querySelectorAll(${q(sel)})].filter((el) => el.getBoundingClientRect().width > 0).length`);
            const gridCount = () => h.ev(`document.querySelector("[data-agent-grid]")?.dataset.agentGridCount ?? null`);
            // a box in client px: null when the element is not there
            const box = (sel) =>
                h.ev(`(() => {
                    const el = document.querySelector(${q(sel)});
                    if (!el) return null;
                    const b = el.getBoundingClientRect();
                    return { l: Math.round(b.left), t: Math.round(b.top), r: Math.round(b.right), b: Math.round(b.bottom), w: Math.round(b.width), h: Math.round(b.height) };
                })()`);
            const text = (sel) => h.ev(`(document.querySelector(${q(sel)})?.textContent ?? null)?.replace(/\\s+/g, " ").trim() ?? null`);
            const count = (sel) => h.ev(`document.querySelectorAll(${q(sel)}).length`);
            const click = (sel) => h.ev(`(() => { const el = document.querySelector(${q(sel)}); if (!el) return false; el.click(); return true; })()`);
            const near = (a, b, tol = 2) => a != null && b != null && Math.abs(a - b) <= tol;
            // the stores as the page holds them
            const state = () =>
                AC.agentPage(
                    h,
                    `const S = await mod("app/view/boards/boardsplitstore.ts");
                    const D = await mod("app/view/agents/docreviewstore.ts");
                    const E = await mod("app/view/boards/boardentries.ts");
                    const split = [...globalStore.get(E.openBoardsAtom).values()][0] ?? null;
                    return {
                        split,
                        max: split != null ? globalStore.get(S.boardMaxAtom(E.boardKey(split))) : false,
                        stored: window.localStorage.getItem("agent.openboards"),
                        chat: window.__arcChatMode?.get(${q(A)}) ?? null,
                        review: globalStore.get(D.docReviewStateAtom(${q(A)}))?.mode ?? null,
                        focus: globalStore.get(agentsModel().focusIdAtom),
                    };`
                );
            const openBoardOn = (boardId) =>
                AC.agentPage(
                    h,
                    `const S = await mod("app/view/boards/boardsplitstore.ts");
                    const E = await mod("app/view/boards/boardentries.ts");
                    for (const b of [...globalStore.get(E.openBoardsAtom).values()]) {
                        if (b.boardId !== ${q(boardId)}) S.closeBoard(agentsModel(), b);
                    }
                    S.openBoard(agentsModel(), ${q(A)}, ${q(PROJECT)}, ${q(boardId)});
                    return true;`
                );
            const closeBoardOn = () =>
                AC.agentPage(
                    h,
                    `const S = await mod("app/view/boards/boardsplitstore.ts");
                    const E = await mod("app/view/boards/boardentries.ts");
                    for (const b of [...globalStore.get(E.openBoardsAtom).values()]) S.closeBoard(agentsModel(), b);
                    return true;`
                );
            const heap = async () => {
                try {
                    await h.cdp("HeapProfiler.collectGarbage", {});
                } catch {
                    // a heap number without a collection first is still a number
                }
                return h.ev(`performance.memory?.usedJSHeapSize ?? null`);
            };
            const mb = (bytes) => (bytes == null ? null : Math.round((bytes / 1048576) * 10) / 10);
            // what the open board's turns read as, in the order drawn
            const turnRows = () =>
                h.ev(`[...document.querySelectorAll(${q(`${BOARD} [data-board-turn]`)})].map((row) => ({
                    id: row.getAttribute("data-board-turn"),
                    state: row.getAttribute("data-board-turn-state"),
                    label: (row.querySelector("[data-board-turn-label]")?.textContent ?? "").trim(),
                    labelClass: row.querySelector("[data-board-turn-label]")?.className ?? "",
                    note: (row.querySelector("[data-board-turn-note]")?.textContent ?? "").trim(),
                    reason: (row.querySelector("[data-board-turn-reason]")?.textContent ?? "").trim(),
                    reply: (row.querySelector("[data-board-turn-reply]")?.textContent ?? "").trim(),
                    buttons: [...row.querySelectorAll("button")].map((b) => b.textContent.trim()),
                    text: row.textContent.replace(/\\s+/g, " ").trim(),
                }))`);
            const rowOf = (rows, id) => rows.find((r) => r.id === id);
            // the terminal pane's box: Chat's cell halves when the board joins it, but the pane itself is never re-parented
            // or remounted (kept: a flag on its node, read back after every change of the grid)
            const termBox = () => box(`${CELL} .cockpit-focus-pane`);
            const paneKept = () => h.ev(`document.querySelector(${q(`${CELL} .cockpit-focus-pane`)})?.__keep === true`);
            // Excalidraw's App instance off the canvas's React fiber, and a shape's centre in client px
            const APP = `
                const app = () => {
                    const el = document.querySelector('${BOARD} [data-board-canvas] .excalidraw');
                    const key = el && Object.keys(el).find((k) => k.startsWith("__reactFiber$"));
                    for (let f = key ? el[key] : null; f != null; f = f.return) {
                        if (typeof f.stateNode?.updateScene === "function" && f.stateNode?.scene != null) return f.stateNode;
                    }
                    return null;
                };
                const selected = () => Object.keys(app()?.state.selectedElementIds ?? {}).filter((id) => app().state.selectedElementIds[id]).sort();
                const centreOf = (id) => {
                    const a = app();
                    const el = a?.scene.getNonDeletedElements().find((e) => e.id === id);
                    if (!el) return null;
                    const s = a.state;
                    return {
                        x: Math.round((el.x + el.width / 2 + s.scrollX) * s.zoom.value + s.offsetLeft),
                        y: Math.round((el.y + el.height / 2 + s.scrollY) * s.zoom.value + s.offsetTop),
                    };
                };
            `;
            const canvasPage = (body) => boardPage(h, `${APP} ${body}`);
            // the board is open and its canvas has its scene in Excalidraw
            const canvasReady = (id) => until(() => h.ev(`document.querySelector(${q(`${SPLIT(id)} ${CANVAS(id)}`)})?.dataset.boardReady === "true"`));
            // typed into the field with the focus, as a person types
            const typeInto = async (sel, words) => {
                await h.ev(`document.querySelector(${q(sel)})?.focus()`);
                await h.cdp("Input.insertText", { text: words });
            };
            const clickAt = async ({ x, y }) => {
                await h.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
                for (const type of ["mousePressed", "mouseReleased"]) {
                    await h.cdp("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
                }
            };

            await AC.focusAgent(h, A);

            // --- 1. open a board on the claude agent: Chat on the left, the board on the right ---
            const termBefore = await (async () => {
                await until(async () => (await termBox()) != null);
                return termBox();
            })();
            const heapBefore = await heap();
            // the pane's node is flagged now: it must be the same node after the board opens, expands, closes and reopens
            await h.ev(`(() => { const p = document.querySelector(${q(`${CELL} .cockpit-focus-pane`)}); if (p) p.__keep = true; })()`);
            const TREE = "[data-agent-tree]";
            const STRIP = (state) => `[data-agent-tree-strip="${state}"]`;
            // the grid's box and the agent's header title as they are before any board opens
            const gridBefore = await box(GRID);
            // the name only: the rest of the title (runtime, state) ticks on its own
            const headerOf = () => text("[data-header-name] > span");
            const headerBefore = await headerOf();

            // --- 1. the tree lists the board under the agent; a click opens it as a cell right of Chat ---
            await run("1a. the agent's tree row lists its latest board with +1 for the other, closed", async (name) => {
                const there = await until(async () => (await count(TREE_ROW(B1))) === 1);
                const label = await text(`${TREE_ROW(B1)} [data-tree-board-name]`);
                const more = await text(`${TREE_ROW(B1)} [data-tree-board-more]`);
                const open = await h.ev(`document.querySelector(${q(TREE_ROW(B1))})?.hasAttribute("data-tree-board-open") ?? null`);
                const cells = await gridCount();
                const boards = await count("[data-board-cell]");
                await shot("1a-tree-row");
                rec(
                    name,
                    there && label === B1_NAME && more === "+1" && open === false && cells === "1" && boards === 0 && termBefore != null,
                    { there, label, more, open, cells, boards }
                );
            });

            await run("1b. clicking the row opens the board as a cell beside Chat: Chat keeps half the grid, the tree stays open", async (name) => {
                const chatBefore = await box(`[data-agent-chat="${A}"]`);
                const clicked = await click(TREE_ROW(B1));
                const shown = await until(async () => (await box(SPLIT(B1))) != null);
                const ready = await canvasReady(B1);
                await polishNap(500);
                // the drawing is fitted to the half grid: every shape's centre is on the canvas
                const fits = await canvasPage(`
                    const r = document.querySelector('${BOARD} [data-board-canvas]').getBoundingClientRect();
                    return ["tauri-host", "auth-key", "sqlite"].map((id) => {
                        const c = centreOf(id);
                        return c != null && c.x > r.left && c.x < r.right && c.y > r.top && c.y < r.bottom;
                    });`);
                const grid = await box(GRID);
                const cell = await box(CELL);
                const wrap = await box(BOARD);
                const chat = await box(`${CELL} [data-agent-chat="${A}"]`);
                const board = await box(SPLIT(B1));
                const term = await termBox();
                const title = await text(`${SPLIT(B1)} [data-board-name]`);
                const facts = await text(`${SPLIT(B1)} [data-board-facts]`);
                const st = await state();
                const cells = await gridCount();
                const tabCells = await shownCells("[data-agent-terminal]");
                const boardCells = await shownCells("[data-board-cell]");
                // the board is a sibling cell of the agent's, never a child of it
                const sibling = await h.ev(`!document.querySelector(${q(CELL)})?.querySelector("[data-board-cell]") && !document.querySelector(${q(CELL)})?.contains(document.querySelector(${q(BOARD)}))`);
                const open = await h.ev(`document.querySelector(${q(TREE_ROW(B1))})?.hasAttribute("data-tree-board-open") ?? null`);
                const treeOpen = (await count(TREE)) === 1 && (await count(STRIP("folded"))) === 0;
                const kept = await paneKept();
                await shot("1b-open");
                // the picture of the feature: the grid with Chat on the left and the board on the right
                let picture;
                try {
                    picture = await h.whatsnewShot("board-cells", { selector: GRID });
                } catch (e) {
                    picture = { error: String(e?.message ?? e) };
                }
                const ratio = grid == null || cell == null ? null : cell.w / grid.w;
                rec(
                    name,
                    clicked &&
                        shown &&
                        ready &&
                        fits.length === 3 &&
                        fits.every(Boolean) &&
                        cells === "2" &&
                        tabCells === 1 &&
                        boardCells === 1 &&
                        sibling &&
                        ratio != null &&
                        ratio > 0.4 &&
                        ratio < 0.6 &&
                        st.split?.boardId === B1 &&
                        st.split?.project === PROJECT &&
                        st.chat === "chat" &&
                        st.focus === A &&
                        // Chat on the left, the board on the right, side by side in the one row of the grid
                        near(chat?.l, cell?.l) &&
                        near(chat?.r, cell?.r, 4) &&
                        wrap != null &&
                        cell != null &&
                        wrap.l >= cell.r - 2 &&
                        near(wrap.t, cell?.t, 3) &&
                        near(wrap.b, cell?.b, 3) &&
                        // the tiled grid keeps a 6px gutter around its cells
                        near(wrap.r, grid?.r, 10) &&
                        board != null &&
                        near(board.l, wrap.l, 3) &&
                        // the tree no longer folds beside a board, and its row reads open
                        treeOpen &&
                        open === true &&
                        // Chat's pane shrank with its cell: the same node (the tiled grid's gutter and the cell's bar move its top)
                        term != null &&
                        termBefore != null &&
                        term.w < termBefore.w &&
                        kept &&
                        title === B1_NAME &&
                        /^3 shapes · drawn (\d\d:\d\d|\d+ [A-Z][a-z]{2})$/.test(facts ?? "") &&
                        picture?.error == null &&
                        /-board-cells\.webp$/.test(picture?.file ?? ""),
                    { ratio, grid, cell, wrap, chat: { before: chatBefore, after: chat }, board, term: { before: termBefore, after: term }, treeOpen, open, sibling, cells, tabCells, boardCells, title, facts, fits, kept, split: st.split, picture }
                );
            });

            // --- 2. beside Chat only the latest turn shows, one line, with "N earlier" for the rest ---
            await run("2. one turn shows beside Chat: a drawn one with Show, a forwarded one reading forwarded · answered in Chat", async (name) => {
                const now = Date.now();
                // as fixed: the agent's drawn request is the latest
                const base = await turnRows();
                const baseEarlier = await text(`${BOARD} [data-board-turns-earlier]`);
                // your drawn ask last
                await putTurns(h, B1, lastTurn(now, TA));
                await until(async () => rowOf(await turnRows(), TA) != null);
                const rowsA = await turnRows();
                const a = rowOf(rowsA, TA);
                const clicked = await click(`${SPLIT(B1)} [data-board-turn="${TA}"] [data-board-turn-show]`);
                const shown = await until(() => h.ev(`document.querySelector(${q(`${SPLIT(B1)} ${CANVAS(B1)}`)})?.dataset.boardHighlight === "tauri-host,auth-key"`));
                const highlight = await h.ev(`document.querySelector(${q(`${SPLIT(B1)} ${CANVAS(B1)}`)})?.dataset.boardHighlight ?? null`);
                const picked = await canvasPage(`return selected();`);
                // Show selected the shapes, so the ask box names them
                const asking = await text(`${SPLIT(B1)} [data-board-ask-selected]`);
                await shot("2-turns-show");
                // the forwarded question last
                await putTurns(h, B1, lastTurn(now, TB));
                await until(async () => rowOf(await turnRows(), TB) != null);
                const rowsB = await turnRows();
                const b = rowOf(rowsB, TB);
                rec(
                    name,
                    base.length === 1 &&
                        base[0].id === TC &&
                        base[0].state === "drawn" &&
                        base[0].buttons.join() === "Show" &&
                        baseEarlier === "2 earlier" &&
                        rowsA.length === 1 &&
                        a?.state === "drawn" &&
                        a.label === "Drawn" &&
                        a.text.includes("+2 shapes") &&
                        a.buttons.includes("Show") &&
                        a.buttons.includes("Send to agent") &&
                        rowsB.length === 1 &&
                        b?.state === "forwarded" &&
                        b.note === "forwarded · answered in Chat" &&
                        // the copied reply is for the expanded column, not the narrow one
                        b.reply === "" &&
                        b.buttons.join() === "Draw instead" &&
                        clicked &&
                        shown &&
                        highlight === "tauri-host,auth-key" &&
                        picked.join() === "auth-key,tauri-host" &&
                        asking?.startsWith("Selected "),
                    { base, baseEarlier, rowsA, rowsB, highlight, picked, asking }
                );
            });

            // --- 3. send the other way: each button asks wavesrv to reroute its turn ---
            await run("3. Send to agent and Draw instead each call BoardRerouteCommand with the turn id", async (name) => {
                const now = Date.now();
                await putTurns(h, B1, lastTurn(now, TA));
                await until(async () => rowOf(await turnRows(), TA) != null);
                const sent = await click(`${SPLIT(B1)} [data-board-turn="${TA}"] [data-board-turn-other]`);
                await putTurns(h, B1, lastTurn(now, TB));
                await until(async () => rowOf(await turnRows(), TB) != null);
                const drawn = await click(`${SPLIT(B1)} [data-board-turn="${TB}"] [data-board-turn-other]`);
                await until(async () => (await boardCalls(h, "BoardRerouteCommand")).length === 2);
                const calls = await boardCalls(h, "BoardRerouteCommand");
                const errors = await count(`${BOARD} [data-board-error]`);
                await shot("3-reroute");
                rec(
                    name,
                    sent &&
                        drawn &&
                        calls.length === 2 &&
                        calls[0].turnid === TA &&
                        calls[1].turnid === TB &&
                        calls.every((c) => c.project === PROJECT && c.boardid === B1) &&
                        errors === 0,
                    { calls, errors }
                );
            });

            // --- 4. select a shape on the canvas: the ask box names it, and Ask sends it along ---
            await run("4. selecting a shape reads Selected <label> in the ask box, and Ask sends on and selectedids", async (name) => {
                // Show in step 2 left two shapes selected: with none selected the box says how to select
                await canvasPage(`app().updateScene({ appState: { selectedElementIds: {} } }); return true;`);
                await until(async () => (await text(`${SPLIT(B1)} [data-board-ask-selected]`)) === "Select shapes to ask about them");
                const none = await text(`${SPLIT(B1)} [data-board-ask-selected]`);
                // Show scrolled to its shapes with an animation: take the position once the view has settled
                await polishNap(900);
                const at = await canvasPage(`return centreOf("auth-key");`);
                await clickAt(at);
                const selectedText = await until(async () => (await text(`${SPLIT(B1)} [data-board-ask-selected]`)) === "Selected auth key");
                const picked = await canvasPage(`return selected();`);
                // a press inside the board cell is no focus change: the agent stays the selected one, the header stays its
                // own, and the keyboard is not handed to an xterm
                const afterPress = await state();
                const headerAfterPress = await headerOf();
                const inXterm = await h.ev(`!!document.activeElement?.closest?.(".xterm")`);
                await typeInto(`${SPLIT(B1)} [data-board-ask-input]`, "why does it change?");
                const afterTyping = await state();
                const headerAfterTyping = await headerOf();
                const asking = await h.ev(`!!document.activeElement?.closest?.(${q(`${BOARD} [data-board-ask-input]`)}) || document.activeElement?.matches?.(${q(`${BOARD} [data-board-ask-input]`)})`);
                const enabled = await h.ev(`!document.querySelector(${q(`${SPLIT(B1)} [data-board-ask-send]`)})?.disabled`);
                await shot("4-selected-ask");
                const clicked = await click(`${SPLIT(B1)} [data-board-ask-send]`);
                await until(async () => (await boardCalls(h, "BoardAskCommand")).length === 1);
                const calls = await boardCalls(h, "BoardAskCommand");
                const emptied = await until(() => h.ev(`document.querySelector(${q(`${SPLIT(B1)} [data-board-ask-input]`)})?.value === ""`));
                rec(
                    name,
                    none === "Select shapes to ask about them" &&
                        selectedText &&
                        picked.join() === "auth-key" &&
                        afterPress.focus === A &&
                        afterTyping.focus === A &&
                        headerBefore != null &&
                        headerAfterPress === headerBefore &&
                        headerAfterTyping === headerBefore &&
                        !inXterm &&
                        asking &&
                        enabled &&
                        clicked &&
                        calls.length === 1 &&
                        calls[0].project === PROJECT &&
                        calls[0].boardid === B1 &&
                        calls[0].question === "why does it change?" &&
                        calls[0].on === "auth key" &&
                        calls[0].selectedids?.join() === "auth-key" &&
                        emptied,
                    { none, at, picked, focus: [afterPress.focus, afterTyping.focus], header: [headerBefore, headerAfterPress, headerAfterTyping], inXterm, asking, calls, emptied }
                );
            });

            // --- 5. a turn that answers, is slow, or fails ---
            await run("5a. an answering turn shows its seconds in green and Ask is disabled", async (name) => {
                const now = Date.now();
                await putTurns(h, B1, [...baseTurns(now), runningTurn(now)]);
                const shown = await until(async () => rowOf(await turnRows(), TD)?.state === "answering");
                await polishNap(1200);
                const rows = await turnRows();
                const d = rowOf(rows, TD);
                const seconds = Number(/(\d+)s$/.exec(d?.label ?? "")?.[1] ?? "NaN");
                const disabled = await h.ev(`document.querySelector(${q(`${SPLIT(B1)} [data-board-ask-send]`)})?.disabled === true`);
                const earlier = await text(`${BOARD} [data-board-turns-earlier]`);
                await shot("5a-answering");
                rec(
                    name,
                    shown &&
                        d?.label.startsWith("Answering · ") &&
                        d.labelClass.includes("text-success") &&
                        seconds >= 14 &&
                        seconds < 30 &&
                        d.buttons.length === 0 &&
                        disabled &&
                        // four turns beside Chat: the running one and a line for the other three
                        rows.length === 1 &&
                        earlier === "3 earlier",
                    { d, seconds, disabled, earlier, rows: rows.length }
                );
            });

            await run("5b. a slow turn reads Still answering and Stop calls BoardAskStopCommand", async (name) => {
                const now = Date.now();
                await putTurns(h, B1, [...baseTurns(now), runningTurn(now, { ts: now - 60_000, startedts: now - 60_000 })]);
                const shown = await until(async () => rowOf(await turnRows(), TD)?.state === "slow");
                const d = rowOf(await turnRows(), TD);
                await shot("5b-slow");
                const clicked = await click(`${SPLIT(B1)} [data-board-turn="${TD}"] [data-board-turn-stop]`);
                await until(async () => (await boardCalls(h, "BoardAskStopCommand")).length === 1);
                const calls = await boardCalls(h, "BoardAskStopCommand");
                const stopped = await until(async () => rowOf(await turnRows(), TD)?.state === "stopped");
                rec(
                    name,
                    shown &&
                        d?.label.startsWith("Still answering · ") &&
                        d.labelClass.includes("text-warning") &&
                        d.buttons.join() === "Stop" &&
                        clicked &&
                        calls.length === 1 &&
                        calls[0].project === PROJECT &&
                        calls[0].boardid === B1 &&
                        stopped,
                    { d, calls, stopped }
                );
            });

            await run("5c. a failed turn reads Couldn't answer with its reason and Retry calls BoardAskRetryCommand", async (name) => {
                const now = Date.now();
                const reason = "the drawer could not read the transcript";
                await putTurns(h, B1, [...baseTurns(now), runningTurn(now, { state: "failed", reason, answeredts: now - 1000 })]);
                const shown = await until(async () => rowOf(await turnRows(), TD)?.state === "failed");
                const d = rowOf(await turnRows(), TD);
                await shot("5c-failed");
                const clicked = await click(`${SPLIT(B1)} [data-board-turn="${TD}"] [data-board-turn-retry]`);
                await until(async () => (await boardCalls(h, "BoardAskRetryCommand")).length === 1);
                const calls = await boardCalls(h, "BoardAskRetryCommand");
                const retried = await until(async () => rowOf(await turnRows(), TD)?.state === "answering");
                rec(
                    name,
                    shown &&
                        d?.label === "Couldn't answer" &&
                        d.labelClass.includes("text-error") &&
                        d.reason.includes(reason) &&
                        d.buttons.join() === "Retry" &&
                        clicked &&
                        calls.length === 1 &&
                        calls[0].turnid === TD &&
                        calls[0].boardid === B1 &&
                        retried,
                    { d, calls, retried }
                );
            });

            // --- 6. Expand: the turns column in full, with the copied reply; Chat stays mounted under the board ---
            await run("6. Expand takes the whole grid: every turn in a column with the copied reply, Chat's cell hidden but mounted", async (name) => {
                // a draft in the Chat box, and the box's node, to prove expanding never remounts the pane
                const COMPOSER = `${CELL} [data-agent-chat="${A}"] [data-chat-input]`;
                await typeInto(COMPOSER, "a draft I have not sent");
                await h.ev(`document.querySelector(${q(COMPOSER)}).__keep = true`);
                const termHalf = await termBox();
                const clicked = await click(`${SPLIT(B1)} [data-board-expand]`);
                const expanded = await until(() => h.ev(`document.querySelector(${q(SPLIT(B1))})?.dataset.boardMax === "true"`));
                await polishNap(300);
                const grid = await box(GRID);
                const board = await box(SPLIT(B1));
                const cellShown = await shownCells(CELL);
                const cellMounted = await count(CELL);
                const st = await state();
                const rows = await turnRows();
                const column = await box(`${SPLIT(B1)} [data-board-turns="full"]`);
                const canvasBox = await box(`${SPLIT(B1)} ${CANVAS(B1)}`);
                const label = await h.ev(`document.querySelector(${q(`${SPLIT(B1)} [data-board-expand]`)})?.getAttribute("aria-label") ?? null`);
                const kept = await h.ev(`document.querySelector(${q(COMPOSER)})?.__keep === true`);
                const draft = await text(COMPOSER);
                const paneKeptMax = await paneKept();
                await canvasReady(B1);
                await shot("6-expanded");
                // Collapse, then the "N earlier" line opens it again
                const collapsed = (await click(`${SPLIT(B1)} [data-board-expand]`)) && (await until(() => h.ev(`document.querySelector(${q(SPLIT(B1))})?.dataset.boardMax !== "true"`)));
                await polishNap(300);
                const keptAfter = await h.ev(`document.querySelector(${q(COMPOSER)})?.__keep === true`);
                const termBack = await termBox();
                const backShown = await shownCells(CELL);
                const earlierClicked = await click(`${BOARD} [data-board-turns-earlier]`);
                const reopened = await until(() => h.ev(`document.querySelector(${q(SPLIT(B1))})?.dataset.boardMax === "true"`));
                rec(
                    name,
                    clicked &&
                        expanded &&
                        label === "Collapse" &&
                        st.max === true &&
                        // the board fills the grid; Chat's cell is hidden under it, still in the DOM with its draft
                        // (inside the tiled grid's 6px gutter, and under the cell's bar)
                        near(board?.l, grid?.l, 10) &&
                        near(board?.r, grid?.r, 10) &&
                        near(board?.t, grid?.t, 40) &&
                        near(board?.b, grid?.b, 10) &&
                        cellShown === 0 &&
                        cellMounted === 1 &&
                        kept &&
                        paneKeptMax &&
                        draft === "a draft I have not sent" &&
                        keptAfter &&
                        // Chat's cell is back at the box it had, so its pane is too
                        collapsed &&
                        backShown === 1 &&
                        JSON.stringify(termBack) === JSON.stringify(termHalf) &&
                        rows.length === 4 &&
                        rowOf(rows, TB)?.reply === REPLY &&
                        column != null &&
                        // wide enough: the turns column is beside the canvas, which keeps the room
                        canvasBox != null &&
                        canvasBox.w >= 400 &&
                        canvasBox.r <= column.l + 2 &&
                        earlierClicked &&
                        reopened,
                    { grid, board, cellShown, cellMounted, column, rows: rows.length, reply: rowOf(rows, TB)?.reply, label, kept, draft, keptAfter, termHalf, termBack, collapsed, reopened, max: st.max }
                );
            });

            // --- 7. the header's name switches between the agent's boards ---
            await run("7. the switcher lists the agent's two boards and switches", async (name) => {
                const opened = await click(`${SPLIT(B1)} [data-board-switcher]`);
                await until(async () => (await count(`${SPLIT(B1)} [data-board-switch-item]`)) === 2);
                const items = await h.ev(`[...document.querySelectorAll(${q(`${SPLIT(B1)} [data-board-switch-item]`)})].map((i) => ({ id: i.getAttribute("data-board-switch-item"), name: i.textContent.replace(/\\s+/g, " ").trim(), current: i.getAttribute("aria-current") }))`);
                await shot("7-switcher");
                const to2 = await click(`${SPLIT(B1)} [data-board-switch-item="${B2}"]`);
                const switched = await until(async () => (await state()).split?.boardId === B2);
                const ready2 = await canvasReady(B2);
                const title2 = await text(`${SPLIT(B2)} [data-board-name]`);
                const gone1 = (await count(CANVAS(B1))) === 0;
                // switching keeps the cell as it was: the same one, still expanded, the grid still two cells
                const stillState = await state();
                const still = { split: stillState.split, max: stillState.max, cells: await gridCount(), boardCells: await count("[data-board-cell]") };
                await shot("7-switched");
                const back = (await click(`${SPLIT(B2)} [data-board-switcher]`)) && (await click(`${SPLIT(B2)} [data-board-switch-item="${B1}"]`));
                const switchedBack = await until(async () => (await state()).split?.boardId === B1);
                await canvasReady(B1);
                rec(
                    name,
                    opened &&
                        items.length === 2 &&
                        items.map((i) => i.id).sort().join() === [B1, B2].sort().join() &&
                        items.find((i) => i.id === B1)?.current === "true" &&
                        items.find((i) => i.id === B2)?.name.startsWith(B2_NAME) &&
                        to2 &&
                        switched &&
                        ready2 &&
                        title2 === B2_NAME &&
                        gone1 &&
                        still.max === true &&
                        still.cells === "2" &&
                        still.boardCells === 1 &&
                        back &&
                        switchedBack,
                    { items, title2, gone1, still }
                );
            });

            // --- 8. the board cell's x: Chat alone again, at the grid's full width ---
            await run("8. the board cell's x brings back Chat alone: one cell, no board cell, the entry cleared", async (name) => {
                const COMPOSER = `${CELL} [data-agent-chat="${A}"] [data-chat-input]`;
                // collapsed first, so the cell Chat gets back is what is measured
                await click(`${SPLIT(B1)} [data-board-expand]`);
                await until(() => h.ev(`document.querySelector(${q(SPLIT(B1))})?.dataset.boardMax !== "true"`));
                const clicked = await click(`[data-board-cell-remove="${CELL_ID(B1)}"]`);
                const closed = await until(async () => (await count("[data-board-cell]")) === 0 && (await state()).split == null && (await gridCount()) === "1");
                // measure once the pane is back to its box
                await until(async () => JSON.stringify(await termBox()) === JSON.stringify(termBefore));
                await polishNap(200);
                const grid = await box(GRID);
                const cell = await box(CELL);
                const chat = await box(`${CELL} [data-agent-chat="${A}"]`);
                const term = await termBox();
                const kept = await h.ev(`document.querySelector(${q(COMPOSER)})?.__keep === true`);
                const st = await state();
                const wraps = await count("[data-board-cell-of]");
                const rowOpen = await h.ev(`document.querySelector(${q(TREE_ROW(B1))})?.hasAttribute("data-tree-board-open") ?? null`);
                await shot("8-closed");
                rec(
                    name,
                    clicked &&
                        closed &&
                        wraps === 0 &&
                        near(chat?.l, cell?.l) &&
                        near(chat?.r, cell?.r) &&
                        near(cell?.r, grid?.r, 3) &&
                        (await count(TREE)) === 1 &&
                        JSON.stringify(term) === JSON.stringify(termBefore) &&
                        // the same pane and the same box, never rebuilt
                        kept &&
                        (await paneKept()) &&
                        // the entry is gone from the store and from storage, and the tree row reads closed
                        st.split == null &&
                        st.max === false &&
                        !(st.stored ?? "").includes(A) &&
                        rowOpen === false,
                    { grid, cell, chat, kept, wraps, stored: st.stored, rowOpen }
                );
            });

            // --- 8a. the agent cell's x leaves its board: a board is a cell of its own ---
            await run("8a. reopening beside Chat, then the agent cell's x: the board stays beside the other agent", async (name) => {
                // a second cell, so the agent's cell has an x to press: the other agent beside it
                await AC.agentPage(
                    h,
                    `const G = await mod("app/view/agents/gridstore.ts");
                    return G.openInSplit(agentsModel(), ${q(B)});`
                );
                await until(async () => (await gridCount()) === "2");
                await AC.focusAgent(h, A);
                await openBoardOn(B1);
                const threeUp = await until(async () => (await gridCount()) === "3" && (await shownCells("[data-board-cell]")) === 1);
                const cellsBefore = await h.ev(`[...document.querySelectorAll("[data-agent-cell]")].length`);
                const clicked = await click(`[data-agent-cell-remove="${A}"]`);
                const stays = await until(async () => (await gridCount()) === "2" && (await shownCells("[data-board-cell]")) === 1);
                await polishNap(300);
                const cells = await gridCount();
                const st = await state();
                const focus = st.focus;
                await shot("8a-agent-x");
                rec(
                    name,
                    threeUp && clicked && stays && cells === "2" && cellsBefore === 3 && st.split?.boardId === B1 && focus === B,
                    { threeUp, cellsBefore, cells, split: st.split, focus }
                );
                // the grid and the tree back as they were: the agent alone, no entry left
                await closeBoardOn();
                await AC.agentPage(h, `const G = await mod("app/view/agents/gridstore.ts"); G.endSplit(agentsModel()); return true;`);
                await AC.focusAgent(h, A);
                await until(async () => (await gridCount()) === "1");
            });

            // --- 8c. the header's Close split ends the split with the board in it ---
            await run("8c. the header's Close split leaves one cell, no board cell, and the tree row closed", async (name) => {
                // Split sits in the header's More menu by default: turn its header button on (the key is restored at teardown)
                await AC.agentPage(
                    h,
                    `const H = await mod("app/view/agents/headerbuttonsstore.ts");
                    globalStore.set(H.headerButtonsAtom, "split", true);
                    return true;`
                );
                await AC.focusAgent(h, A);
                await openBoardOn(B1);
                const opened = await until(async () => (await gridCount()) === "2" && (await shownCells("[data-board-cell]")) === 1);
                await until(async () => (await count("[data-agent-split]")) === 1);
                const rowOpenBefore = await until(() => h.ev(`document.querySelector(${q(TREE_ROW(B1))})?.hasAttribute("data-tree-board-open") === true`));
                const menu = await click("[data-agent-split]");
                const listed = await until(async () => (await count(`[data-menu-item="Close split"]`)) === 1);
                const closed = await click(`[data-menu-item="Close split"]`);
                const gone = await until(async () => (await gridCount()) === "1" && (await count("[data-board-cell]")) === 0);
                await polishNap(300);
                const st = await state();
                const rowOpen = await h.ev(`document.querySelector(${q(TREE_ROW(B1))})?.hasAttribute("data-tree-board-open") ?? null`);
                const kept = await paneKept();
                await shot("8c-close-split");
                rec(
                    name,
                    opened && rowOpenBefore && menu && listed && closed && gone && st.split == null && !(st.stored ?? "").includes(A) && rowOpen === false && kept,
                    { opened, rowOpenBefore, menu, listed, closed, gone, split: st.split, stored: st.stored, rowOpen, kept }
                );
            });

            // --- 8b. a dense board reads one part at a time ---
            await run("8b. a dense board: the header counts its parts, hovering one offers Read, → and Whole board move between them", async (name) => {
                const CV = `${SPLIT(B3)} ${CANVAS(B3)}`;
                const attr = (key) => h.ev(`document.querySelector(${q(CV)})?.dataset.${key} ?? null`);
                const zoom = () => canvasPage(`return app()?.state.zoom.value ?? null;`);
                await openBoardOn(B3);
                const ready = await canvasReady(B3);
                const counted = await until(async () => (await text(`${SPLIT(B3)} [data-board-parts-count]`)) === "3 parts");
                const fitZoom = await zoom();
                // nothing over the board until the pointer is on a part
                const quiet = (await count(`${CV} [data-board-part-hover]`)) === 0;
                const over = await canvasPage(`return centreOf("harness-a");`);
                await h.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: over.x, y: over.y });
                const hovered = await until(async () => (await count(`${CV} [data-board-part-hover="0"]`)) === 1);
                const hoverText = await text(`${CV} [data-board-part-hover]`);
                const one = (await count(`${CV} [data-board-part-hover]`)) === 1;
                await shot("8b-hover");
                // Read opens its part at a reading size, the header naming it
                const picked = await click(`${CV} [data-board-part-hover]`);
                const inPart = await until(async () => (await attr("boardPart")) === "0");
                await polishNap(600);
                const partZoom = await zoom();
                const partName = await text(`${SPLIT(B3)} [data-board-part-name]`);
                const index = await text(`${SPLIT(B3)} [data-board-part-index]`);
                const stepperGone = (await count(`${SPLIT(B3)} [data-board-parts-count]`)) === 0;
                await shot("8b-part");
                // → from inside the canvas steps to the next part
                await h.ev(`document.querySelector(${q(`${CV} .excalidraw`)})?.focus()`);
                await h.cdp("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 });
                await h.cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 });
                const stepped = await until(async () => (await attr("boardPart")) === "1");
                const nextName = await text(`${SPLIT(B3)} [data-board-part-name]`);
                // Whole board goes back to the fitted view and the parts count
                const whole = await click(`${SPLIT(B3)} [data-board-part-whole]`);
                const back = await until(async () => (await attr("boardPart")) === "");
                const recounted = await until(async () => (await count(`${SPLIT(B3)} [data-board-parts-count]`)) === 1);
                await shot("8b-whole");
                // the header's › from the whole board starts at the first part
                const started = (await click(`${SPLIT(B3)} [data-board-parts-next]`)) && (await until(async () => (await attr("boardPart")) === "0"));
                await click(`${SPLIT(B3)} [data-board-close]`);
                await until(async () => (await box(SPLIT(B3))) == null);
                // a small board reads whole: no parts, no stepper
                await openBoardOn(B1);
                await canvasReady(B1);
                const b1Parts = await h.ev(`document.querySelector(${q(`${SPLIT(B1)} ${CANVAS(B1)}`)})?.dataset.boardParts ?? null`);
                const b1Stepper = await count(`${SPLIT(B1)} [data-board-parts-count]`);
                await click(`${SPLIT(B1)} [data-board-close]`);
                await until(async () => (await box(SPLIT(B1))) == null);
                rec(
                    name,
                    ready &&
                        counted &&
                        fitZoom != null &&
                        fitZoom < 0.665 &&
                        quiet &&
                        hovered &&
                        one &&
                        hoverText === "Read Harness" &&
                        picked &&
                        inPart &&
                        partZoom != null &&
                        partZoom >= 0.7 &&
                        partName === "Harness" &&
                        index === "1/3" &&
                        stepperGone &&
                        stepped &&
                        nextName === "Benchmark" &&
                        whole &&
                        back &&
                        recounted &&
                        started &&
                        // a small board reads whole: no parts, no stepper
                        b1Parts === "0" &&
                        b1Stepper === 0,
                    { fitZoom, hoverText, partZoom, partName, index, nextName, b1Parts, b1Stepper }
                );
            });

            let gave = null;
            // --- 9. a full 2x2: the board takes the last other cell, the agent and the focused tab keep theirs ---
            await run("9. in a full 2x2 Open gives the board the last other cell: the agent keeps its cell, that tab keeps running", async (name) => {
                const CELL_OF = (id) => `[data-agent-terminal="${id}"]`;
                const C = ctx.third.tabId;
                const D = ctx.fourth.tabId;
                for (const id of [B, C, D]) {
                    await AC.agentPage(
                        h,
                        `const G = await mod("app/view/agents/gridstore.ts");
                        return G.openInSplit(agentsModel(), ${q(id)});`
                    );
                }
                await AC.focusAgent(h, A);
                const full = await until(async () => (await gridCount()) === "4");
                const before = await Promise.all([A, B, C, D].map((id) => shownCells(CELL_OF(id))));
                // the grid's own order decides which cell gives way: the last one that is neither the agent nor the focused one
                const order = await AC.agentPage(
                    h,
                    `const G = await mod("app/view/agents/gridstore.ts");
                    return G.currentGrid(agentsModel()).ids;`
                );
                const give = [...order].reverse().find((id) => id !== A) ?? null;
                gave = give;
                await openBoardOn(B1);
                const boardUp = await until(async () => (await shownCells("[data-board-cell]")) === 1);
                await polishNap(400);
                const cells = await gridCount();
                const ids = [A, B, C, D];
                const after = await Promise.all(ids.map((id) => shownCells(CELL_OF(id))));
                const st = await state();
                // the roster still holds the tab whose cell gave way: it was not closed
                const stillThere = await AC.agentPage(
                    h,
                    `const m = agentsModel();
                    return [...globalStore.get(m.agentsAtom), ...globalStore.get(m.terminalsAtom)].some((a) => a.id === ${q(give)});`
                );
                await canvasReady(B1);
                await shot("9-full-grid");
                rec(
                    name,
                    full &&
                        before.join() === "1,1,1,1" &&
                        boardUp &&
                        cells === "4" &&
                        give != null &&
                        order.length === 4 &&
                        // exactly the given-up tab's cell is gone; the agent and the other two keep theirs
                        after.join() === ids.map((id) => (id === give ? 0 : 1)).join() &&
                        st.focus === A &&
                        st.split?.boardId === B1 &&
                        stillThere,
                    { full, before, order, give, cells, after, focus: st.focus, split: st.split, stillThere }
                );
            });

            // --- 9b. another agent alone: no canvas stays behind; the split comes back with its agent ---
            await run("9b. focusing another agent alone leaves no board in the DOM; the agent's split returns with its board", async (name) => {
                // the tab whose cell gave way in step 9: no cell of the split, so it shows alone
                const D = gave ?? ctx.fourth.tabId;
                await AC.focusAgent(h, D);
                const gone = await until(async () => (await count(".excalidraw")) === 0 && (await count("[data-board-cell]")) === 0);
                await shot("9b-other-alone");
                await AC.focusAgent(h, A);
                const back = await until(async () => (await shownCells("[data-board-cell]")) === 1);
                const ready = await canvasReady(B1);
                rec(name, gone && back && ready, { gone, back, ready });
                await closeBoardOn();
                await AC.agentPage(h, `const G = await mod("app/view/agents/gridstore.ts"); G.endSplit(agentsModel()); return true;`);
                await AC.focusAgent(h, A);
                await until(async () => (await gridCount()) === "1");
            });

            // --- 10. a Review pane open on the agent: Open closes it and shows Chat with the board ---
            await run("10. with a Review pane open Open closes it and shows Chat with the board", async (name) => {
                await AC.agentPage(
                    h,
                    `const D = await mod("app/view/agents/docreviewstore.ts");
                    globalStore.set(D.docReviewStateAtom(${q(A)}), {
                        askId: "boards-split-review", path: ${q(ctx.review)}, doc: "markdown", mode: "review", tab: "changes",
                        wholeFile: false, comments: [], generalNote: "", lastSend: null,
                    });
                    return true;`
                );
                const reviewUp = await until(async () => (await count("[data-doc-review-pane]")) > 0);
                const before = await state();
                await shot("10-review-before");
                await openBoardOn(B1);
                const shown = await until(async () => (await box(SPLIT(B1))) != null);
                const reviewGone = await until(async () => (await count("[data-doc-review-pane]")) === 0);
                const chat = await box(`${CELL} [data-agent-chat="${A}"]`);
                const st = await state();
                const cells = await gridCount();
                await canvasReady(B1);
                await shot("10-review-open");
                rec(
                    name,
                    reviewUp &&
                        before.review === "review" &&
                        shown &&
                        reviewGone &&
                        st.review === "terminal" &&
                        st.chat === "chat" &&
                        chat != null &&
                        cells === "2" &&
                        st.split?.boardId === B1,
                    { reviewUp, before: before.review, after: st.review, chat, cells, split: st.split }
                );
                await closeBoardOn();
                await until(async () => (await gridCount()) === "1");
                await AC.agentPage(h, `const D = await mod("app/view/agents/docreviewstore.ts"); globalStore.set(D.docReviewStateAtom(${q(A)}), null); return true;`);
            });

            // --- 10b. the agent in Terminal chat mode: Open switches it to Chat ---
            await run("10b. in Terminal chat mode an entry alone draws no board cell; Open switches the agent to Chat and shows both", async (name) => {
                await AC.agentPage(h, `window.__arcChatMode.set(${q(A)}, "terminal"); return true;`);
                const chatGone = await until(async () => (await count(`${CELL} [data-agent-chat="${A}"]:not([data-chat-leaving])`)) === 0);
                // an entry with no cell in the grid draws nothing: a board cell exists only once openBoard has given it one
                await AC.agentPage(
                    h,
                    `const E = await mod("app/view/boards/boardentries.ts");
                    globalStore.set(E.boardEntriesAtom, [{ project: ${q(PROJECT)}, boardId: ${q(B1)} }]);
                    return true;`
                );
                await polishNap(600);
                const drawnInTerminal = await count(`[data-board-cell]`);
                await closeBoardOn();
                const before = await state();
                await shot("10b-terminal");
                await openBoardOn(B1);
                const shown = await until(async () => (await box(SPLIT(B1))) != null);
                const chatBack = await until(async () => (await count(`${CELL} [data-agent-chat="${A}"]:not([data-chat-leaving])`)) === 1);
                const st = await state();
                await canvasReady(B1);
                await shot("10b-chat");
                rec(
                    name,
                    chatGone &&
                        drawnInTerminal === 0 &&
                        before.chat === "terminal" &&
                        shown &&
                        chatBack &&
                        st.chat === "chat" &&
                        st.split?.boardId === B1,
                    { chatGone, drawnInTerminal, before: before.chat, after: st.chat, chatBack, split: st.split }
                );
            });

            // --- 12. two boards open at once, each a cell of its own ---
            await run("12. two boards open side by side: [agent | board | board], each closing alone", async (name) => {
                await openBoardOn(B1);
                await AC.agentPage(
                    h,
                    `const S = await mod("app/view/boards/boardsplitstore.ts");
                    S.openBoard(agentsModel(), ${q(A)}, ${q(PROJECT)}, ${q(B2)});
                    return true;`
                );
                const both = await until(
                    async () => (await gridCount()) === "3" && (await shownCells(SPLIT(B1))) === 1 && (await shownCells(SPLIT(B2))) === 1
                );
                await canvasReady(B2);
                await polishNap(300);
                await shot("12-two-boards");
                const closed = await click(`[data-board-cell-remove="${CELL_ID(B2)}"]`);
                const one = await until(async () => (await gridCount()) === "2" && (await count(SPLIT(B2))) === 0 && (await shownCells(SPLIT(B1))) === 1);
                const st = await state();
                rec(name, both && closed && one && st.split?.boardId === B1, { both, closed, one, split: st.split });
            });

            // --- 13. the chat picker moves the board to another chat ---
            await run("13. the header's chat picker lists the project's chats and moves the board to the picked one", async (name) => {
                await openBoardOn(B1);
                await until(async () => (await shownCells(SPLIT(B1))) === 1);
                const chatBefore = await text(`${SPLIT(B1)} [data-board-chat]`);
                const opened = await click(`${SPLIT(B1)} [data-board-chat]`);
                const listed = await until(async () => (await count(`${SPLIT(B1)} [data-board-chat-item]`)) >= 2);
                await shot("13-chat-picker");
                // the What's new picture: the board beside Chat, its chat picker open
                const picture = await h.whatsnewShot("board-chat", { selector: GRID });
                const picked = await click(`${SPLIT(B1)} [data-board-chat-item="${B}"]`);
                const calls = await boardCalls(h, "BoardTakeOverCommand");
                const moved = await until(async () => (await h.ev(`document.querySelector(${q(`${SPLIT(B1)} [data-board-chat]`)})?.getAttribute("data-board-chat")`)) === B);
                const chatAfter = await text(`${SPLIT(B1)} [data-board-chat]`);
                // the board's cell stays where it was: moving its chat moves no cell
                const cells = await gridCount();
                await shot("13-chat-moved");
                const last = calls.at(-1);
                rec(
                    name,
                    opened && listed && picked && moved && last?.boardid === B1 && last?.tabid === B && cells === "2" && chatAfter !== chatBefore,
                    { opened, listed, picked, moved, call: last, chatBefore, chatAfter, cells, picture }
                );
                // back to the first chat, so the steps after read it as before
                await click(`${SPLIT(B1)} [data-board-chat]`);
                await until(async () => (await count(`${SPLIT(B1)} [data-board-chat-item="${A}"]`)) === 1);
                await click(`${SPLIT(B1)} [data-board-chat-item="${A}"]`);
                await until(async () => (await h.ev(`document.querySelector(${q(`${SPLIT(B1)} [data-board-chat]`)})?.getAttribute("data-board-chat")`)) === A);
            });

            // --- 14. Hide turns folds the column to a strip ---
            await run("14. Hide turns folds the expanded board's turns column to a 14px strip; the strip opens it again", async (name) => {
                await openBoardOn(B1);
                await until(async () => (await shownCells(SPLIT(B1))) === 1);
                await click(`${SPLIT(B1)} [data-board-expand]`);
                await until(() => h.ev(`document.querySelector(${q(SPLIT(B1))})?.dataset.boardMax === "true"`));
                const column = await until(async () => (await count(`${SPLIT(B1)} [data-board-turns-column]`)) === 1);
                const canvasBefore = await box(`${SPLIT(B1)} ${CANVAS(B1)}`);
                const folded = await click(`${SPLIT(B1)} [data-board-turns-toggle]`);
                const strip = await until(async () => (await count(`${SPLIT(B1)} [data-board-turns-strip]`)) === 1 && (await count(`${SPLIT(B1)} [data-board-turns-column]`)) === 0);
                await polishNap(300);
                const stripBox = await box(`${SPLIT(B1)} [data-board-turns-strip]`);
                const canvasAfter = await box(`${SPLIT(B1)} ${CANVAS(B1)}`);
                const kept = await h.ev(`JSON.parse(localStorage.getItem("board.turns.folded") ?? "{}")[${q(`${PROJECT}/${B1}`)}] === true`);
                await shot("14-turns-folded");
                const reopened = await click(`${SPLIT(B1)} [data-board-turns-strip]`);
                const back = await until(async () => (await count(`${SPLIT(B1)} [data-board-turns-column]`)) === 1);
                await click(`${SPLIT(B1)} [data-board-expand]`);
                await until(() => h.ev(`document.querySelector(${q(SPLIT(B1))})?.dataset.boardMax !== "true"`));
                rec(
                    name,
                    column && folded && strip && near(stripBox?.w, 14, 1) && (canvasAfter?.w ?? 0) > (canvasBefore?.w ?? 0) + 200 && kept && reopened && back,
                    { column, folded, strip, stripW: stripBox?.w, canvasBefore: canvasBefore?.w, canvasAfter: canvasAfter?.w, kept, reopened, back }
                );
            });

            // --- 11. what an open board costs the page ---
            await run("11. the page's JS heap with and without an open board", async (name) => {
                await polishNap(500);
                const heapAfter = await heap();
                const delta = heapBefore == null || heapAfter == null ? null : mb(heapAfter - heapBefore);
                rec(
                    name,
                    typeof heapBefore === "number" && typeof heapAfter === "number",
                    { beforeMB: mb(heapBefore), afterMB: mb(heapAfter), deltaMB: delta, note: "usedJSHeapSize after a collection, before the first board opened and with one open and drawn" }
                );
            });

            return steps;
        },

        async teardown(h, ctx) {
            const step = async (what, fn) => {
                try {
                    await fn();
                } catch (e) {
                    console.error(`boards-split teardown: ${what} failed: ${e?.message ?? e}`);
                }
            };
            await step("close the board splits and the review state", () =>
                AC.agentPage(
                    h,
                    `const S = await mod("app/view/boards/boardsplitstore.ts");
                    const D = await mod("app/view/agents/docreviewstore.ts");
                    const E = await mod("app/view/boards/boardentries.ts");
                    for (const b of [...globalStore.get(E.openBoardsAtom).values()]) S.closeBoard(agentsModel(), b);
                    for (const id of ${q([ctx.agent?.tabId, ctx.other?.tabId, ctx.third?.tabId, ctx.fourth?.tabId].filter(Boolean))}) {
                        globalStore.set(D.docReviewStateAtom(id), null);
                    }
                    const G = await mod("app/view/agents/gridstore.ts");
                    G.endSplit(agentsModel());
                    return true;`
                )
            );
            await step("restore the board commands", () => removeBoardStubs(h));
            await step("restore the roster", () => AC.restoreRoster(h));
            await step("close the fixture tabs", () => closeTabs(h, ctx));
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
