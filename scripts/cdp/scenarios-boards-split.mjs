// Scenario `boards-split`: the board split beside the agent's Chat (docs/superpowers/specs/2026-11-19-kael-boards-design.md,
// plan 2026-11-19-kael-boards.md Task 7). A board opens right of a 360px Chat column in the agent's cell, the agent tree folded to a strip; its
// header, turns and ask box are the steps below, each a screenshot plus a DOM assert. Beside Chat only the latest turn
// shows, so a step that reads one turn's row puts that turn last; a dense board (B3) reads one part at a time (8b), a
// small one (B1) reads whole.
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
    const LS_KEYS = [GRID_KEY, "agent.chatmode"];

    const rosterRows = (ctx) =>
        [ctx.agent, ctx.other].map((tab, i) => ({
            project: PROJECT,
            task: "",
            agent: "claude",
            model: "opus",
            state: "idle",
            idleSince: Date.now() - 60_000,
            usage: { contextpct: 12 },
            id: tab.tabId,
            name: i === 0 ? AGENT_TITLE : `claude · ${PROJECT} 2`,
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
                if (!(await ahReload(h))) throw new Error("the page did not come back after the reload");
                await h.goto("agent");

                at = "making the tabs";
                ctx.agent = await makeTab(h, ctx, {
                    label: PROJECT,
                    blockMeta: { view: "term", "agent:transcriptpath": ctx.transcript },
                });
                ctx.other = await makeTab(h, ctx, { label: `${PROJECT}-2`, blockMeta: { view: "term" } });

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

            const CELL = `[data-agent-terminal="${A}"]`;
            const SPLIT = (id) => `${CELL} [data-board-split="${id}"]`;
            const CANVAS = (id) => `[data-board-canvas="${id}"]`;
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
                    const split = globalStore.get(S.boardSplitAtom(${q(A)}));
                    return {
                        split,
                        chat: window.__arcChatMode?.get(${q(A)}) ?? null,
                        review: globalStore.get(D.docReviewStateAtom(${q(A)}))?.mode ?? null,
                        focus: globalStore.get(agentsModel().focusIdAtom),
                    };`
                );
            const openBoardOn = (boardId) =>
                AC.agentPage(
                    h,
                    `const S = await mod("app/view/boards/boardsplitstore.ts");
                    S.openBoard(agentsModel(), ${q(A)}, ${q(PROJECT)}, ${q(boardId)});
                    return true;`
                );
            const closeBoardOn = () =>
                AC.agentPage(
                    h,
                    `const S = await mod("app/view/boards/boardsplitstore.ts");
                    S.closeBoard(${q(A)});
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
                h.ev(`[...document.querySelectorAll(${q(`${CELL} [data-board-turn]`)})].map((row) => ({
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
            // the terminal pane's box: it must not move or resize when a board opens, expands or closes
            const termBox = () => box(`${CELL} .cockpit-focus-pane`);
            // Excalidraw's App instance off the canvas's React fiber, and a shape's centre in client px
            const APP = `
                const app = () => {
                    const el = document.querySelector('${CELL} [data-board-canvas] .excalidraw');
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
            // the terminal's box while the board is open: the tree folds to a strip, so the cell (and the pane) widen once
            let termOpen = null;
            const TREE = "[data-agent-tree]";
            const STRIP = (state) => `[data-agent-tree-strip="${state}"]`;
            await run("1. Open puts Chat on the left and the board on the right, its name and facts in the header", async (name) => {
                const chatBefore = await box(`[data-agent-chat="${A}"]`);
                await openBoardOn(B1);
                const shown = await until(async () => (await box(SPLIT(B1))) != null);
                const ready = await canvasReady(B1);
                await polishNap(500);
                // the drawing is fitted to the half cell: every shape's centre is on the canvas
                const fits = await canvasPage(`
                    const r = document.querySelector('${CELL} [data-board-canvas]').getBoundingClientRect();
                    return ["tauri-host", "auth-key", "sqlite"].map((id) => {
                        const c = centreOf(id);
                        return c != null && c.x > r.left && c.x < r.right && c.y > r.top && c.y < r.bottom;
                    });`);
                const cell = await box(CELL);
                const chat = await box(`${CELL} [data-agent-chat="${A}"]`);
                const board = await box(SPLIT(B1));
                const term = await termBox();
                const title = await text(`${SPLIT(B1)} [data-board-name]`);
                const facts = await text(`${SPLIT(B1)} [data-board-facts]`);
                const st = await state();
                await shot("1-open");
                // Chat is a 360px column (half a cell narrower than 720px), the board the rest
                const mid = cell == null ? null : cell.l + Math.min(360, cell.w / 2);
                const treeGone = (await count(TREE)) === 0 && (await count(STRIP("folded"))) === 1;
                termOpen = term;
                rec(
                    name,
                    shown &&
                        ready &&
                        fits.length === 3 &&
                        fits.every(Boolean) &&
                        termBefore != null &&
                        st.split?.boardId === B1 &&
                        st.split?.expanded === false &&
                        st.chat === "chat" &&
                        near(board?.l, mid) &&
                        near(board?.r, cell?.r) &&
                        near(chat?.l, cell?.l) &&
                        near(chat?.r, mid) &&
                        // the tree folds to a strip: the pane under both widens once, its top and height kept
                        treeGone &&
                        term != null &&
                        term.w > termBefore.w &&
                        term.t === termBefore.t &&
                        term.h === termBefore.h &&
                        title === B1_NAME &&
                        /^3 shapes · drawn (\d\d:\d\d|\d+ [A-Z][a-z]{2})$/.test(facts ?? ""),
                    { cell, chat: { before: chatBefore, after: chat }, board, term: { before: termBefore, after: term }, treeGone, title, facts, fits, split: st.split }
                );
            });

            // --- 1b. the strip opens the tree beside the board, and folds it again ---
            await run("1b. the strip beside the board opens the agent tree and folds it back", async (name) => {
                const opened = (await click(STRIP("folded"))) && (await until(async () => (await count(TREE)) === 1 && (await count(STRIP("open"))) === 1));
                await polishNap(300);
                await shot("1b-tree-peek");
                const stillSplit = (await box(SPLIT(B1))) != null;
                const folded = (await click(STRIP("open"))) && (await until(async () => (await count(TREE)) === 0 && (await count(STRIP("folded"))) === 1));
                await polishNap(300);
                const term = await termBox();
                rec(name, opened && stillSplit && folded && JSON.stringify(term) === JSON.stringify(termOpen), { opened, stillSplit, folded, term, termOpen });
            });

            // --- 2. beside Chat only the latest turn shows, one line, with "N earlier" for the rest ---
            await run("2. one turn shows beside Chat: a drawn one with Show, a forwarded one reading forwarded · answered in Chat", async (name) => {
                const now = Date.now();
                // as fixed: the agent's drawn request is the latest
                const base = await turnRows();
                const baseEarlier = await text(`${CELL} [data-board-turns-earlier]`);
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
                const errors = await count(`${CELL} [data-board-error]`);
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
                await typeInto(`${SPLIT(B1)} [data-board-ask-input]`, "why does it change?");
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
                        enabled &&
                        clicked &&
                        calls.length === 1 &&
                        calls[0].project === PROJECT &&
                        calls[0].boardid === B1 &&
                        calls[0].question === "why does it change?" &&
                        calls[0].on === "auth key" &&
                        calls[0].selectedids?.join() === "auth-key" &&
                        emptied,
                    { none, at, picked, calls, emptied }
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
                const earlier = await text(`${CELL} [data-board-turns-earlier]`);
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
            await run("6. Expand takes the whole cell: every turn in a column with the copied reply, Chat kept mounted under it", async (name) => {
                // a draft in the Chat box, and the box's node, to prove expanding never remounts the pane
                const COMPOSER = `${CELL} [data-agent-chat="${A}"] [data-chat-input]`;
                await typeInto(COMPOSER, "a draft I have not sent");
                await h.ev(`document.querySelector(${q(COMPOSER)}).__keep = true`);
                const clicked = await click(`${SPLIT(B1)} [data-board-expand]`);
                const expanded = await until(() => h.ev(`document.querySelector(${q(SPLIT(B1))})?.dataset.boardExpanded === "true"`));
                const cell = await box(CELL);
                const board = await box(SPLIT(B1));
                const chat = await box(`${CELL} [data-agent-chat="${A}"]`);
                const term = await termBox();
                const rows = await turnRows();
                const column = await box(`${SPLIT(B1)} [data-board-turns="full"]`);
                const canvasBox = await box(`${SPLIT(B1)} ${CANVAS(B1)}`);
                const label = await h.ev(`document.querySelector(${q(`${SPLIT(B1)} [data-board-expand]`)})?.getAttribute("aria-label") ?? null`);
                const inert = await h.ev(`!!document.querySelector(${q(`${CELL} [data-agent-chat="${A}"]`)})?.closest("[inert]")`);
                const kept = await h.ev(`document.querySelector(${q(COMPOSER)})?.__keep === true`);
                const draft = await text(COMPOSER);
                await canvasReady(B1);
                await shot("6-expanded");
                // Collapse, then the "N earlier" line opens it again
                const collapsed = (await click(`${SPLIT(B1)} [data-board-expand]`)) && (await until(() => h.ev(`document.querySelector(${q(SPLIT(B1))})?.dataset.boardExpanded === "false"`)));
                const keptAfter = await h.ev(`document.querySelector(${q(COMPOSER)})?.__keep === true`);
                const earlierClicked = await click(`${CELL} [data-board-turns-earlier]`);
                const reopened = await until(() => h.ev(`document.querySelector(${q(SPLIT(B1))})?.dataset.boardExpanded === "true"`));
                rec(
                    name,
                    clicked &&
                        expanded &&
                        label === "Collapse" &&
                        near(board?.l, cell?.l) &&
                        near(board?.r, cell?.r) &&
                        // the pane stays a 360px column under the board
                        near(chat?.r, cell == null ? null : cell.l + Math.min(360, cell.w / 2)) &&
                        JSON.stringify(term) === JSON.stringify(termOpen) &&
                        inert &&
                        kept &&
                        draft === "a draft I have not sent" &&
                        keptAfter &&
                        rows.length === 4 &&
                        rowOf(rows, TB)?.reply === REPLY &&
                        column != null &&
                        // wide enough: the turns column is beside the canvas, which keeps the room
                        canvasBox != null &&
                        canvasBox.w >= 400 &&
                        canvasBox.r <= column.l + 2 &&
                        collapsed &&
                        earlierClicked &&
                        reopened,
                    { cell, board, chat, column, rows: rows.length, reply: rowOf(rows, TB)?.reply, label, inert, kept, draft, keptAfter, collapsed, reopened }
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
                const still = (await state()).split;
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
                        // switching keeps the split as it was
                        still?.expanded === true &&
                        back &&
                        switchedBack,
                    { items, title2, gone1, still }
                );
            });

            // --- 8. Close: Chat alone again, at the cell's full width ---
            await run("8. Close brings back Chat alone at full width", async (name) => {
                const COMPOSER = `${CELL} [data-agent-chat="${A}"] [data-chat-input]`;
                // collapsed first, so the half the pane gives back is what is measured
                await click(`${SPLIT(B1)} [data-board-expand]`);
                await until(() => h.ev(`document.querySelector(${q(SPLIT(B1))})?.dataset.boardExpanded === "false"`));
                const clicked = await click(`${SPLIT(B1)} [data-board-close]`);
                const closed = await until(async () => (await box(SPLIT(B1))) == null && (await state()).split == null);
                await polishNap(400);
                const cell = await box(CELL);
                const chat = await box(`${CELL} [data-agent-chat="${A}"]`);
                const term = await termBox();
                const kept = await h.ev(`document.querySelector(${q(COMPOSER)})?.__keep === true`);
                const inert = await h.ev(`!!document.querySelector(${q(`${CELL} [data-agent-chat="${A}"]`)})?.closest("[inert]")`);
                await shot("8-closed");
                rec(
                    name,
                    clicked &&
                        closed &&
                        near(chat?.l, cell?.l) &&
                        near(chat?.r, cell?.r) &&
                        // the tree is back, so the pane is back to its box from before the board opened
                        (await count(TREE)) === 1 &&
                        (await count(STRIP("folded"))) === 0 &&
                        JSON.stringify(term) === JSON.stringify(termBefore) &&
                        // the same pane, never rebuilt
                        kept &&
                        !inert,
                    { cell, chat, kept, inert }
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
                let picture;
                try {
                    picture = await h.whatsnewShot("board-parts", { selector: SPLIT(B3) });
                } catch (e) {
                    picture = { error: String(e?.message ?? e) };
                }
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
                        b1Stepper === 0 &&
                        picture?.error == null,
                    { fitZoom, hoverText, partZoom, partName, index, nextName, b1Parts, b1Stepper, picture }
                );
            });

            // --- 9. the agent in a grid of two cells: Open opens the board expanded, with no Expand ---
            await run("9. in a grid of two cells Open opens the board expanded, with no Expand", async (name) => {
                const grown = await AC.agentPage(
                    h,
                    `const G = await mod("app/view/agents/gridstore.ts");
                    return G.openInSplit(agentsModel(), ${q(B)});`
                );
                await until(async () => (await h.ev(`document.querySelector("[data-agent-grid]")?.dataset.agentGridCount`)) === "2");
                await AC.focusAgent(h, A);
                await openBoardOn(B1);
                const shown = await until(async () => (await box(SPLIT(B1))) != null);
                await polishNap(400);
                const st = await state();
                const cell = await box(CELL);
                const board = await box(SPLIT(B1));
                const expandButtons = await count(`${SPLIT(B1)} [data-board-expand]`);
                const closeButtons = await count(`${SPLIT(B1)} [data-board-close]`);
                const canvasBox = await box(`${SPLIT(B1)} ${CANVAS(B1)}`);
                const turnsBox = await box(`${SPLIT(B1)} [data-board-turns="full"]`);
                const cells = await h.ev(`document.querySelector("[data-agent-grid]")?.dataset.agentGridCount ?? null`);
                const expandedAttr = await h.ev(`document.querySelector(${q(SPLIT(B1))})?.dataset.boardExpanded ?? null`);
                await canvasReady(B1);
                await shot("9-grid");
                rec(
                    name,
                    grown &&
                        shown &&
                        cells === "2" &&
                        st.split?.expanded === true &&
                        expandedAttr === "true" &&
                        expandButtons === 0 &&
                        closeButtons === 1 &&
                        // the whole cell under the grid cell's bar
                        near(board?.l, cell?.l) &&
                        near(board?.r, cell?.r) &&
                        near(board?.b, cell?.b) &&
                        near(board?.t, cell == null ? null : cell.t + 26, 3) &&
                        // a narrow board stacks its turns under the canvas, which keeps most of the cell
                        canvasBox != null &&
                        turnsBox != null &&
                        canvasBox.w >= board.w - 4 &&
                        canvasBox.h >= 250 &&
                        turnsBox.t >= canvasBox.b - 2 &&
                        turnsBox.b <= board.b + 1,
                    { grown, cells, split: st.split, expandButtons, closeButtons, cell, board, canvasBox, turnsBox }
                );
                await closeBoardOn();
                await AC.agentPage(h, `const G = await mod("app/view/agents/gridstore.ts"); G.endSplit(agentsModel()); return true;`);
                await AC.focusAgent(h, A);
                await until(async () => (await h.ev(`document.querySelector("[data-agent-grid]")?.dataset.agentGridCount`)) === "1");
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
                        st.split?.boardId === B1,
                    { reviewUp, before: before.review, after: st.review, chat, split: st.split }
                );
                await closeBoardOn();
                await AC.agentPage(h, `const D = await mod("app/view/agents/docreviewstore.ts"); globalStore.set(D.docReviewStateAtom(${q(A)}), null); return true;`);
            });

            // --- 10b. the agent in Terminal chat mode: Open switches it to Chat ---
            await run("10b. in Terminal chat mode the board is not drawn; Open switches the agent to Chat and shows both", async (name) => {
                await AC.agentPage(h, `window.__arcChatMode.set(${q(A)}, "terminal"); return true;`);
                const chatGone = await until(async () => (await count(`${CELL} [data-agent-chat="${A}"]:not([data-chat-leaving])`)) === 0);
                // a split set while the cell shows the terminal draws nothing: the live xterm is never inside the split
                await AC.agentPage(
                    h,
                    `const S = await mod("app/view/boards/boardsplitstore.ts");
                    globalStore.set(S.boardSplitAtom(${q(A)}), { project: ${q(PROJECT)}, boardId: ${q(B1)}, expanded: false });
                    return true;`
                );
                await polishNap(600);
                const drawnInTerminal = await count(`${CELL} [data-board-split]`);
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

            // --- 12. the What's new picture: the split in a cell, a shape selected ---
            await run("12. the What's new picture of the split beside Chat", async (name) => {
                await putTurns(h, B1, baseTurns(Date.now()));
                await AC.focusAgent(h, A);
                await openBoardOn(B1);
                await canvasReady(B1);
                await polishNap(500);
                const at = await canvasPage(`return centreOf("auth-key");`);
                await clickAt(at);
                await until(async () => (await text(`${SPLIT(B1)} [data-board-ask-selected]`)) === "Selected auth key");
                await polishNap(600);
                let picture;
                try {
                    picture = await h.whatsnewShot("boards", { selector: CELL });
                } catch (e) {
                    picture = { error: String(e?.message ?? e) };
                }
                await shot("12-picture");
                rec(name, picture?.error == null && /-boards\.webp$/.test(picture?.file ?? ""), picture);
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
                    for (const id of ${q([ctx.agent?.tabId, ctx.other?.tabId].filter(Boolean))}) {
                        S.closeBoard(id);
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
