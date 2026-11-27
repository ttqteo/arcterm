// Scenario `boards-split`: a board as a cell of the Agent grid beside its agent's Chat (docs/superpowers/specs/
// 2026-11-22-board-cells-design.md). The agent's tree lists the board as a row under it; clicking the row opens it as a
// cell right of the agent's, `[data-board-cell]` inside a `[data-board-cell-of="<project>/<board>"]` wrapper that is a
// sibling of the agent's `[data-agent-terminal]` cell, never inside it. A board cell is a cell of its own (more than one
// can be open); these steps open one at a time, openBoardOn closing the others first. Its header and status line are the
// steps below, each a screenshot plus a DOM assert. There is no turns column and no ask box: questions about a board go
// through Chat's `@board`. Under the canvas one status line (`[data-board-status]`) shows the turn the drawer is on, the
// next one queued, or the latest turn when it failed; with none of those it is not there, so a step that reads it puts
// that turn last (statusTurn picks from the talk). A dense board (B3) reads one part at a time (8b), a small one (B1)
// reads whole once expanded and gets its parts back collapsed.
//
// Steps 17 and 18 are the drawings (docs/superpowers/specs/2026-11-25-kael-sync-boards-drawings-design.md): a board opens
// in Excalidraw's view mode with an Edit switch in the strip above it (17), and each drawer answer is a numbered frame, a
// drawing, listed in the strip's row, fitted as it lands and picked by its chip (18). An answer reaches the page as the
// real one does: left in the fixture inbox (putAnswer) and announced with board:update, so the real applier lands it in
// the open canvas (or in the fixture file when no canvas is open).
//
// Two fixture claude agents over real tabs (no controller, so nothing runs) and a mock roster for them; the first has a
// short transcript so Chat has something to show beside the board. The board commands are stubbed in the page
// (boards-fixtures.mjs): no real drawer runs and wavesrv holds no board. A turn's state is whatever the step puts in the
// fixture talk, and a button's call (Stop, Retry) is read back from the stub's record.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as AC from "./agent-page-fixtures.mjs";
import {
    boardCalls,
    boardFile,
    boardPage,
    boxElements,
    feedBoardUpdate,
    installBoardStubs,
    putAnswer,
    putBoard,
    putTurns,
    removeBoardStubs,
    textElement,
} from "./boards-fixtures.mjs";

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

// the drawings steps (17-18): B4 is a board drawn before drawings were frames (its shapes are loose in the file, and the
// canvas wraps them in "Earlier drawings" on opening), B5 has nothing on it. Each drawing the drawer answers is a skeleton
// as the drawer writes it: a labelled box, or a free text.
const B4 = "b0a5b004";
const B4_NAME = "auth-flow";
const B5 = "b0a5b005";
const B5_NAME = "blank-board";
const EARLIER = "Earlier drawings";
const ELEMENTS_4 = [...filled(boxElements("host-box", 40, 40, "host"), "#a5d8ff"), ...filled(boxElements("key-box", 300, 40, "key"), "#ffec99")];
const skBox = (x, y, label) => ({ type: "rectangle", x, y, width: 180, height: 70, label: { text: label } });
const skText = (x, y, words) => ({ type: "text", x, y, text: words });
const DRAWING_2 = { title: "Auth key flow", add: [skBox(0, 0, "Tauri host"), skBox(260, 0, "auth key")] };
// the free text is what 18e lengthens
const DRAWING_3 = { title: "Store layout", add: [skBox(0, 0, "SQLite"), skText(260, 20, "note")] };
const DRAWING_4 = { title: "Job queue", add: [skBox(0, 0, "queue"), skBox(260, 0, "slot")] };
// 18h's drawing, landed to be deleted
const DRAWING_DELETE = { title: "Delete me", add: [skBox(0, 0, "doomed"), skBox(260, 0, "also doomed")] };
// Vietnamese: letters the hand-drawn faces lack (ớ ỗ ầ ạ), so the whole board turns to Nunito as the edit lands, and a
// line several times as wide as "note", which ended just inside its drawing's frame
const LONG_NOTE = "Khóa mới mỗi lần chạy";
const DRAG_PX = 60;
const DRAG_STEPS = 6;

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
    const LS_KEYS = [GRID_KEY, "agent.chatmode", "agent.openboards", "agent.header.buttons"];

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
            // a board whose cell is in a split is a cell of the tree's split row, beside the agents
            const TREE_SPLIT = (id) => `[data-split-row] [data-split-board="${id}"]`;
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
            // the status line under the open board's canvas as it reads, or null when there is none (it shows only while the
            // drawer works or the latest turn failed); its state is the line's data-board-status
            const statusLine = () =>
                h.ev(`(() => {
                    const el = document.querySelector(${q(`${BOARD} [data-board-status]`)});
                    if (el == null) return null;
                    const label = el.querySelector("[data-board-status-label]");
                    return {
                        state: el.getAttribute("data-board-status"),
                        turn: el.getAttribute("data-board-status-turn"),
                        label: (label?.textContent ?? "").trim(),
                        labelClass: label?.className ?? "",
                        text: (el.querySelector("[data-board-status-text]")?.textContent ?? "").trim(),
                        reason: (el.querySelector("[data-board-status-reason]")?.textContent ?? "").trim(),
                        error: (el.querySelector("[data-board-status-error]")?.textContent ?? "").trim(),
                        buttons: [...el.querySelectorAll("button")].map((b) => b.textContent.trim()),
                    };
                })()`);
            const statusCount = () => count(`${BOARD} [data-board-status]`);
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
                // the point at fx of a shape's width and fy of its height, in client px
                const pointIn = (id, fx, fy) => {
                    const a = app();
                    const el = a?.scene.getNonDeletedElements().find((e) => e.id === id);
                    if (!el) return null;
                    const s = a.state;
                    return {
                        x: Math.round((el.x + el.width * fx + s.scrollX) * s.zoom.value + s.offsetLeft),
                        y: Math.round((el.y + el.height * fy + s.scrollY) * s.zoom.value + s.offsetTop),
                    };
                };
                const centreOf = (id) => pointIn(id, 0.5, 0.5);
                // the drawings (steps 17-18): each is a frame, numbered in its customData
                const frames = () =>
                    (app()?.scene.getNonDeletedElements() ?? [])
                        .filter((e) => e.type === "frame")
                        .map((f) => ({ id: f.id, name: f.name, n: f.customData?.arcDrawing ?? null, x: f.x, y: f.y, width: f.width, height: f.height }));
                const view = () => {
                    const s = app()?.state;
                    return s == null ? null : { scrollX: s.scrollX, scrollY: s.scrollY, zoom: s.zoom.value };
                };
                // a frame's sides on the canvas in canvas px (Excalidraw maps a scene point to (point + scroll) * zoom), and
                // the canvas's own size
                const onCanvas = (id) => {
                    const a = app();
                    const f = a?.scene.getNonDeletedElements().find((e) => e.id === id);
                    if (f == null) return null;
                    const s = a.state;
                    const z = s.zoom.value;
                    return {
                        left: (f.x + s.scrollX) * z,
                        top: (f.y + s.scrollY) * z,
                        right: (f.x + f.width + s.scrollX) * z,
                        bottom: (f.y + f.height + s.scrollY) * z,
                        width: s.width,
                        height: s.height,
                    };
                };
                // the strip's row of drawings, in order; the "new" word is not part of a chip's title
                const row = () =>
                    [...document.querySelectorAll('${BOARD} [data-board-drawings] [data-board-drawing]')].map((b) => {
                        const clone = b.cloneNode(true);
                        clone.querySelector("[data-board-drawing-new]")?.remove();
                        const label = clone.textContent.replace(/\\s+/g, " ").trim();
                        const m = /^(\\d+)\\s*(.*)$/.exec(label);
                        return {
                            id: b.getAttribute("data-board-drawing"),
                            n: m?.[1] ?? "",
                            title: m?.[2] ?? label,
                            current: b.getAttribute("aria-current") === "true",
                            fresh: b.querySelector("[data-board-drawing-new]") != null,
                            newWord: (b.querySelector("[data-board-drawing-new]")?.textContent ?? "").trim(),
                        };
                    });
            `;
            const canvasPage = (body) => boardPage(h, `${APP} ${body}`);
            // the frame lies wholly on the canvas, and sits in its middle (a drawing fitted whole is centred)
            const fitted = (b) => b != null && b.left >= -1 && b.top >= -1 && b.right <= b.width + 1 && b.bottom <= b.height + 1;
            const centred = (b) => b != null && Math.abs((b.left + b.right) / 2 - b.width / 2) <= 3 && Math.abs((b.top + b.bottom) / 2 - b.height / 2) <= 3;
            const rowNow = () => canvasPage(`return row();`);
            const framesNow = () => canvasPage(`return frames();`);
            const chip = (id, drawingId) => `${SPLIT(id)} [data-board-drawings] [data-board-drawing="${drawingId}"]`;
            // the cell's Edit, set to on or off: pressed only when it reads the other way, then waited for
            const setEdit = async (id, on) => {
                const sel = `${SPLIT(id)} [data-board-edit]`;
                const now = await h.ev(`document.querySelector(${q(sel)})?.getAttribute("aria-pressed") ?? null`);
                if (now == null) return false;
                if (now !== String(on)) await click(sel);
                const ok = await until(() => h.ev(`document.querySelector(${q(sel)})?.getAttribute("aria-pressed") === ${q(String(on))}`));
                await polishNap(300);
                return ok;
            };
            // the board's mode as drawn: the canvas's flag, Excalidraw's own, its drawing toolbar and style panel and the Edit
            // switch. The drawing toolbar is probed by .App-toolbar-container, which both layouts render only while the
            // drawing tools show: the phone layout's bottom footer.App-toolbar stays in view mode
            const readMode = async (id) => {
                const m = await canvasPage(`
                    const c = document.querySelector('${BOARD} [data-board-canvas="${id}"]');
                    return {
                        attr: c?.dataset.boardViewMode ?? null,
                        viewMode: app()?.state.viewModeEnabled ?? null,
                        toolbar: !!c?.querySelector(".App-toolbar-container"),
                        panel: !!c?.querySelector(".selected-shape-actions"),
                        selected: selected(),
                    };`);
                const edit = await h.ev(`document.querySelector(${q(`${SPLIT(id)} [data-board-edit]`)})?.getAttribute("aria-pressed") ?? null`);
                return { ...m, edit };
            };
            // a left-button drag from a point, px right and px down, as a pointer would
            const dragBy = async (from, px) => {
                const to = { x: from.x + px, y: from.y + px };
                await h.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: from.x, y: from.y });
                await h.cdp("Input.dispatchMouseEvent", { type: "mousePressed", x: from.x, y: from.y, button: "left", buttons: 1, clickCount: 1 });
                for (let i = 1; i <= DRAG_STEPS; i++) {
                    const p = { x: from.x + (px * i) / DRAG_STEPS, y: from.y + (px * i) / DRAG_STEPS };
                    await h.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", ...p, button: "left", buttons: 1 });
                }
                await h.cdp("Input.dispatchMouseEvent", { type: "mouseReleased", ...to, button: "left", buttons: 0, clickCount: 1 });
            };
            // the drawer's answer to a running turn, left in the inbox and announced; waits for the applier's ack
            const land = async (boardId, turnId, body) => {
                const answerId = `ans-${turnId}`;
                await putTurns(h, boardId, [{ id: turnId, ts: Date.now() - 5000, kind: "ask", question: "draw it", state: "answering", startedts: Date.now() - 4000 }]);
                await putAnswer(h, boardId, { id: answerId, turnid: turnId, ...body });
                await feedBoardUpdate(h, { project: PROJECT, boardid: boardId, what: "answer" });
                const ackOf = async () => (await boardCalls(h, "BoardAnswerAckCommand")).find((c) => c.answerid === answerId);
                const acked = await until(async () => (await ackOf()) != null);
                // the answering turn put the status line up, and the answered one takes it away: the canvas has its full
                // height back before a step measures where the view ended
                await until(async () => (await statusCount()) === 0, 4000);
                return { acked, ack: await ackOf() };
            };
            // the live frames a board's saved file holds
            const framesInFile = async (boardId) => ((await boardFile(h, boardId))?.elements ?? []).filter((e) => e.type === "frame" && !e.isDeleted);
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
            await run("1a. the tree lists the chat's latest board as a row of its own, a peer of the agents, naming its chat", async (name) => {
                const there = await until(async () => (await count(TREE_ROW(B1))) === 1);
                const label = await text(`${TREE_ROW(B1)} [data-tree-board-name]`);
                const chat = await text(`${TREE_ROW(B1)} [data-tree-board-chat]`);
                const open = await h.ev(`document.querySelector(${q(TREE_ROW(B1))})?.hasAttribute("data-tree-board-open") ?? null`);
                // a peer: not indented under the agent's row
                const rowLeft = (await box(TREE_ROW(B1)))?.l;
                const agentLeft = (await box(`[data-agent-tree] [data-agent-row="${A}"]`))?.l ?? null;
                const cells = await gridCount();
                const boards = await count("[data-board-cell]");
                await shot("1a-tree-row");
                rec(
                    name,
                    there && label === B1_NAME && (chat ?? "").includes(AGENT_TITLE) && open === false && (agentLeft == null || near(rowLeft, agentLeft, 2)) && cells === "1" && boards === 0 && termBefore != null,
                    { there, label, chat, open, rowLeft, agentLeft, cells, boards }
                );
            });

            await run("1b. Open (the Chat card's route) opens the board as a cell beside Chat: Chat keeps half the grid, the tree stays open", async (name) => {
                const chatBefore = await box(`[data-agent-chat="${A}"]`);
                const clicked = await openBoardOn(B1);
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
                // in the split it is a cell of the tree's split row, beside the agent
                const open = await until(async () => (await count(TREE_SPLIT(B1))) === 1 && (await count(TREE_ROW(B1))) === 0);
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

            // --- 2. the status line: there only while the drawer works or the latest turn failed ---
            await run("2. with no turn answering, the status line shows only a failed latest turn (Couldn't draw, its reason, Retry); drawn, forwarded, stopped and an earlier failed turn show none", async (name) => {
                const now = Date.now();
                const reason = "the drawer could not read the transcript";
                const failedTurn = runningTurn(now, { state: "failed", reason, answeredts: now - 1000 });
                // a failed latest turn first: the line shows, so a later "none" is the line gone and not one that never drew
                await putTurns(h, B1, [...baseTurns(now), failedTurn]);
                const shown = await until(async () => (await statusLine())?.state === "failed");
                const failed = await statusLine();
                const lines = await statusCount();
                const stopHidden = (await count(`${SPLIT(B1)} [data-board-status-stop]`)) === 0;
                await shot("2-status-failed");
                // no line with only drawn and forwarded turns, nor with a stopped one last, nor when a drawn turn follows the
                // failed one; each is put and given a moment, as the line leaves on an exit animation
                const none = async (turns) => {
                    await putTurns(h, B1, turns);
                    await until(async () => (await statusCount()) === 0);
                    await polishNap(400);
                    return (await statusCount()) === 0;
                };
                const base = baseTurns(now);
                const afterDrawn = await none([base[0], base[1], failedTurn, base[2]]);
                const onlyDrawn = await none(base);
                const forwardedLast = await none(lastTurn(now, TB));
                const stoppedLast = await none([...base, runningTurn(now, { state: "stopped", answeredts: now - 1000 })]);
                // as the steps after expect: the base talk, no line
                await putTurns(h, B1, base);
                rec(
                    name,
                    shown &&
                        failed?.state === "failed" &&
                        failed.turn === TD &&
                        failed.label === "Couldn't draw" &&
                        failed.labelClass.includes("text-error") &&
                        failed.text === "add the build step" &&
                        failed.reason === `${reason} · nothing changed` &&
                        failed.buttons.join() === "Retry" &&
                        lines === 1 &&
                        stopHidden &&
                        afterDrawn &&
                        onlyDrawn &&
                        forwardedLast &&
                        stoppedLast,
                    { failed, lines, stopHidden, afterDrawn, onlyDrawn, forwardedLast, stoppedLast }
                );
            });

            // --- 4. select a shape on the canvas in Edit: a press in the board cell is no focus change ---
            await run("4. in Edit, a click on a shape selects it and is no focus change: the agent stays the selected one, the header stays its own, the keyboard is not handed to an xterm", async (name) => {
                // a board opens in view mode, where a click does not select: Edit first
                const editOn = await setEdit(B1, true);
                // B1's loose shapes were wrapped in one frame when it opened
                const drawings = await framesNow();
                await canvasPage(`app().updateScene({ appState: { selectedElementIds: {} } }); return true;`);
                await polishNap(300);
                // near the lower-right corner, as step 17a clicks: in a narrow half cell a one-box part's Read label sits
                // over the box's middle, and a click there opens Read instead of selecting the shape
                const at = await canvasPage(`return pointIn("auth-key", 0.85, 0.8);`);
                await clickAt(at);
                const selectedOk = await until(async () => (await canvasPage(`return selected();`)).join() === "auth-key");
                const picked = await canvasPage(`return selected();`);
                // a press inside the board cell is no focus change: the agent stays the selected one, the header stays its
                // own, and the keyboard is not handed to an xterm
                const afterPress = await state();
                const headerAfterPress = await headerOf();
                const inXterm = await h.ev(`!!document.activeElement?.closest?.(".xterm")`);
                await shot("4-selected");
                // back to view mode, as every board opens: the steps after read B1 as a viewer
                const editOff = await setEdit(B1, false);
                rec(
                    name,
                    editOn &&
                        editOff &&
                        drawings.length === 1 &&
                        drawings[0].name === EARLIER &&
                        selectedOk &&
                        picked.join() === "auth-key" &&
                        afterPress.focus === A &&
                        headerBefore != null &&
                        headerAfterPress === headerBefore &&
                        !inXterm,
                    { at, picked, focus: afterPress.focus, header: [headerBefore, headerAfterPress], inXterm, drawings }
                );
            });

            // --- 5. a turn that answers, is slow, or fails ---
            await run("5a. an answering turn reads Answering · Ns in green on the status line, with no Stop", async (name) => {
                const now = Date.now();
                await putTurns(h, B1, [...baseTurns(now), runningTurn(now)]);
                const shown = await until(async () => (await statusLine())?.state === "answering");
                await polishNap(1200);
                const d = await statusLine();
                const seconds = Number(/(\d+)s$/.exec(d?.label ?? "")?.[1] ?? "NaN");
                const lines = await statusCount();
                await shot("5a-answering");
                rec(
                    name,
                    shown &&
                        d?.turn === TD &&
                        d.label.startsWith("Answering · ") &&
                        d.labelClass.includes("text-success") &&
                        d.text === "add the build step" &&
                        seconds >= 14 &&
                        seconds < 30 &&
                        d.buttons.length === 0 &&
                        // the one line is for the turn the drawer is on, not one per turn
                        lines === 1,
                    { d, seconds, lines }
                );
            });

            await run("5b. a slow turn reads Still answering on the status line, Stop calls BoardAskStopCommand and the line goes with the stopped turn", async (name) => {
                const now = Date.now();
                await putTurns(h, B1, [...baseTurns(now), runningTurn(now, { ts: now - 60_000, startedts: now - 60_000 })]);
                const shown = await until(async () => (await statusLine())?.state === "slow");
                const d = await statusLine();
                await shot("5b-slow");
                const clicked = await click(`${SPLIT(B1)} [data-board-status-stop]`);
                await until(async () => (await boardCalls(h, "BoardAskStopCommand")).length === 1);
                const calls = await boardCalls(h, "BoardAskStopCommand");
                // a stopped latest turn shows no line
                const gone = await until(async () => (await statusCount()) === 0);
                rec(
                    name,
                    shown &&
                        d?.turn === TD &&
                        d.label.startsWith("Still answering · ") &&
                        d.labelClass.includes("text-warning") &&
                        d.buttons.join() === "Stop" &&
                        clicked &&
                        calls.length === 1 &&
                        calls[0].project === PROJECT &&
                        calls[0].boardid === B1 &&
                        gone,
                    { d, calls, gone }
                );
            });

            await run("5c. a failed turn reads Couldn't draw on the status line with its reason and Retry calls BoardAskRetryCommand", async (name) => {
                const now = Date.now();
                const reason = "the drawer could not read the transcript";
                await putTurns(h, B1, [...baseTurns(now), runningTurn(now, { state: "failed", reason, answeredts: now - 1000 })]);
                const shown = await until(async () => (await statusLine())?.state === "failed");
                const d = await statusLine();
                await shot("5c-failed");
                const clicked = await click(`${SPLIT(B1)} [data-board-status-retry]`);
                await until(async () => (await boardCalls(h, "BoardAskRetryCommand")).length === 1);
                const calls = await boardCalls(h, "BoardAskRetryCommand");
                const retried = await until(async () => (await statusLine())?.state === "answering");
                // the base talk again, so the steps after start with no line under the canvas
                await putTurns(h, B1, baseTurns(Date.now()));
                const cleared = await until(async () => (await statusCount()) === 0);
                rec(
                    name,
                    shown &&
                        d?.turn === TD &&
                        d.label === "Couldn't draw" &&
                        d.labelClass.includes("text-error") &&
                        d.reason === `${reason} · nothing changed` &&
                        d.buttons.join() === "Retry" &&
                        clicked &&
                        calls.length === 1 &&
                        calls[0].turnid === TD &&
                        calls[0].boardid === B1 &&
                        retried &&
                        cleared,
                    { d, calls, retried, cleared }
                );
            });

            // --- 6. Expand: the board over the whole grid; Chat stays mounted under it ---
            await run("6. Expand takes the whole grid: the canvas across the board, Chat's cell hidden but mounted with its draft, Collapse gives Chat its box back, and Expand again leaves it expanded for step 7", async (name) => {
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
                const canvasBox = await box(`${SPLIT(B1)} ${CANVAS(B1)}`);
                const label = await h.ev(`document.querySelector(${q(`${SPLIT(B1)} [data-board-expand]`)})?.getAttribute("aria-label") ?? null`);
                const kept = await h.ev(`document.querySelector(${q(COMPOSER)})?.__keep === true`);
                const draft = await text(COMPOSER);
                const paneKeptMax = await paneKept();
                await canvasReady(B1);
                await shot("6-expanded");
                // Collapse, then Expand again: step 7 reads the board still expanded
                const collapsed = (await click(`${SPLIT(B1)} [data-board-expand]`)) && (await until(() => h.ev(`document.querySelector(${q(SPLIT(B1))})?.dataset.boardMax !== "true"`)));
                await polishNap(300);
                const keptAfter = await h.ev(`document.querySelector(${q(COMPOSER)})?.__keep === true`);
                const termBack = await termBox();
                const backShown = await shownCells(CELL);
                const expandClicked = await click(`${SPLIT(B1)} [data-board-expand]`);
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
                        // the canvas takes the board's whole width: nothing sits beside it
                        canvasBox != null &&
                        board != null &&
                        canvasBox.w >= 400 &&
                        canvasBox.w >= board.w * 0.9 &&
                        expandClicked &&
                        reopened,
                    { grid, board, canvasBox, cellShown, cellMounted, label, kept, draft, keptAfter, termHalf, termBack, collapsed, reopened, max: st.max }
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
            await run("8c. the header's Close split leaves one cell; the board stays open as a row of its own, off screen", async (name) => {
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
                const rowOpenBefore = await until(async () => (await count(TREE_SPLIT(B1))) === 1);
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
                    // the board leaves the split as an agent would: still open, a row of its own again
                    opened && rowOpenBefore && menu && listed && closed && gone && st.split?.boardId === B1 && (await count(TREE_SPLIT(B1))) === 0 && rowOpen === false && kept,
                    { opened, rowOpenBefore, menu, listed, closed, gone, split: st.split, stored: st.stored, rowOpen, kept }
                );
            });

            // --- 8b. a dense board reads one part at a time ---
            await run("8b. a dense board: the header counts its parts (inside its Earlier drawings), hovering one offers Read, → and Whole drawing move between them; B1 needs parts in the half cell, reads whole once expanded and gets them back collapsed", async (name) => {
                const CV = `${SPLIT(B3)} ${CANVAS(B3)}`;
                const attr = (key) => h.ev(`document.querySelector(${q(CV)})?.dataset.${key} ?? null`);
                const zoom = () => canvasPage(`return app()?.state.zoom.value ?? null;`);
                await openBoardOn(B3);
                const ready = await canvasReady(B3);
                const counted = await until(async () => (await text(`${SPLIT(B3)} [data-board-parts-count]`)) === "3 parts");
                const fitZoom = await zoom();
                // the parts are those of the drawing in view: B3's loose shapes, wrapped in one frame as it opened
                const inView = await attr("boardInView");
                const drawing = await canvasPage(`return frames().map((f) => [f.id, f.name]);`);
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
                // Whole drawing goes back to the drawing in view and the parts count
                const wholeLabel = await text(`${SPLIT(B3)} [data-board-part-whole]`);
                const whole = await click(`${SPLIT(B3)} [data-board-part-whole]`);
                const back = await until(async () => (await attr("boardPart")) === "");
                const recounted = await until(async () => (await count(`${SPLIT(B3)} [data-board-parts-count]`)) === 1);
                await shot("8b-whole");
                // the header's › from the whole board starts at the first part
                const started = (await click(`${SPLIT(B3)} [data-board-parts-next]`)) && (await until(async () => (await attr("boardPart")) === "0"));
                await click(`${SPLIT(B3)} [data-board-close]`);
                await until(async () => (await box(SPLIT(B3))) == null);
                // a small board (B1, 440 wide) needs parts in the half cell, reads whole once expanded and gets them back collapsed
                await openBoardOn(B1);
                const b1Ready = await canvasReady(B1);
                const B1_CV = `${SPLIT(B1)} ${CANVAS(B1)}`;
                const b1Parts = () => h.ev(`document.querySelector(${q(B1_CV)})?.dataset.boardParts ?? null`);
                const b1Stepper = () => count(`${SPLIT(B1)} [data-board-parts-count]`);
                // the parts are published once the canvas has its size, as B3's header count is
                const halfCounted = await until(async () => (await b1Parts()) === "3");
                const half = { parts: await b1Parts(), stepper: await b1Stepper() };
                const expandClicked = await click(`${SPLIT(B1)} [data-board-expand]`);
                const expandedGone = await until(async () => (await b1Parts()) === "0" && (await b1Stepper()) === 0);
                const expanded = { parts: await b1Parts(), stepper: await b1Stepper() };
                const collapseClicked = await click(`${SPLIT(B1)} [data-board-expand]`);
                const collapsedBack = await until(async () => (await b1Parts()) === "3");
                const collapsed = { parts: await b1Parts(), stepper: await b1Stepper() };
                await click(`${SPLIT(B1)} [data-board-close]`);
                await until(async () => (await box(SPLIT(B1))) == null);
                const b1Half = b1Ready && halfCounted && half.parts === "3" && half.stepper === 1;
                const b1Whole = expandClicked && expandedGone && expanded.parts === "0" && expanded.stepper === 0;
                const b1Again = collapseClicked && collapsedBack && collapsed.parts === "3";
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
                        drawing.length === 1 &&
                        drawing[0][1] === EARLIER &&
                        inView === drawing[0][0] &&
                        wholeLabel === "Whole drawing" &&
                        whole &&
                        back &&
                        recounted &&
                        started &&
                        // B1 needs parts in the half cell, reads whole once expanded and gets them back collapsed
                        b1Half &&
                        b1Whole &&
                        b1Again,
                    {
                        ready,
                        counted,
                        fitZoom,
                        quiet,
                        hovered,
                        one,
                        picked,
                        inPart,
                        inView,
                        drawing,
                        hoverText,
                        partZoom,
                        partName,
                        index,
                        stepperGone,
                        stepped,
                        nextName,
                        wholeLabel,
                        whole,
                        back,
                        recounted,
                        started,
                        b1Ready,
                        halfCounted,
                        half,
                        expandClicked,
                        expandedGone,
                        expanded,
                        collapseClicked,
                        collapsedBack,
                        collapsed,
                        b1Half,
                        b1Whole,
                        b1Again,
                    }
                );
            });

            await run("8c. reading a part, in Edit the header's Delete takes the part's shapes off the board, the view goes back to the whole drawing with one part fewer, and the toast's Undo brings it back", async (name) => {
                const CV = `${SPLIT(B3)} ${CANVAS(B3)}`;
                const attr = (key) => h.ev(`document.querySelector(${q(CV)})?.dataset.${key} ?? null`);
                const live = (id) => canvasPage(`return (app()?.scene.getNonDeletedElements() ?? []).some((e) => e.id === ${q(id)});`);
                await openBoardOn(B3);
                const ready = await canvasReady(B3);
                const counted = await until(async () => (await text(`${SPLIT(B3)} [data-board-parts-count]`)) === "3 parts");
                const opened = (await click(`${SPLIT(B3)} [data-board-parts-next]`)) && (await until(async () => (await attr("boardPart")) === "0"));
                const named = await until(async () => (await text(`${SPLIT(B3)} [data-board-part-name]`)) === "Harness");
                await polishNap(400);
                await shot("8c-reading-part");
                // the part's Delete shows in Edit only
                const noDeleteInView = (await count(`${SPLIT(B3)} [data-board-part-delete]`)) === 0;
                const editOn = await setEdit(B3, true);
                const stillReading = (await attr("boardPart")) === "0";
                const deleted = await click(`${SPLIT(B3)} [data-board-part-delete]`);
                const gone = await until(async () => !(await live("harness-a")));
                const whole = await until(async () => (await attr("boardPart")) === "" && (await text(`${SPLIT(B3)} [data-board-parts-count]`)) === "2 parts");
                const offFile = await until(async () => ((await boardFile(h, B3))?.elements ?? []).some((e) => e.id === "harness-a" && e.isDeleted));
                await polishNap(400);
                await shot("8c-part-deleted");
                const undone = await h.ev(`(() => { const b = [...document.querySelectorAll("[data-notification-action]")].at(-1); if (!b) return false; b.click(); return true; })()`);
                const back = await until(async () => (await live("harness-a")) && (await text(`${SPLIT(B3)} [data-board-parts-count]`)) === "3 parts");
                const inFile = await until(async () => ((await boardFile(h, B3))?.elements ?? []).some((e) => e.id === "harness-a" && !e.isDeleted));
                const editOff = await setEdit(B3, false);
                await click(`${SPLIT(B3)} [data-board-close]`);
                await until(async () => (await box(SPLIT(B3))) == null);
                rec(
                    name,
                    ready && counted && opened && named && noDeleteInView && editOn && stillReading && editOff && deleted && gone && whole && offFile && undone && back && inFile,
                    { ready, counted, opened, named, noDeleteInView, editOn, stillReading, editOff, deleted, gone, whole, offFile, undone, back, inFile }
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

            // --- 15. drag the board onto another chat: it reads that chat ---
            await run("15. dragging the board's bar onto the centre of another agent's cell ties it to that chat", async (name) => {
                await openBoardOn(B1);
                await AC.agentPage(h, `const G = await mod("app/view/agents/gridstore.ts"); return G.openInSplit(agentsModel(), ${q(B)});`);
                await until(async () => (await gridCount()) === "3" && (await shownCells(SPLIT(B1))) === 1);
                const before = await boardCalls(h, "BoardTakeOverCommand");
                const drop = await h.ev(`(async () => {
                    const until = async (fn, n) => { for (let i = 0; i < n; i++) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, 50)); } return null; };
                    const src = document.querySelector(${q(`[data-board-cell-bar="${CELL_ID(B1)}"]`)});
                    if (!src) return { ok: false, why: "no board bar" };
                    const dt = new DataTransfer();
                    const fire = (el, type, x, y) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x ?? 0, clientY: y ?? 0 }));
                    fire(src, "dragstart");
                    const ov = await until(() => document.querySelector(${q(`[data-agent-drop-overlay="${B}"]`)}), 60);
                    if (!ov) { fire(src, "dragend"); return { ok: false, why: "no drop overlay over the other agent" }; }
                    const r = ov.getBoundingClientRect();
                    const x = r.left + r.width / 2, y = r.top + r.height / 2;
                    fire(ov, "dragover", x, y);
                    await new Promise((r) => setTimeout(r, 80));
                    const label = ov.textContent.replace(/\\s+/g, " ").trim();
                    fire(ov, "drop", x, y);
                    fire(src, "dragend");
                    return { ok: true, label };
                })()`);
                const calls = await boardCalls(h, "BoardTakeOverCommand");
                const last = calls.at(-1);
                const moved = await until(async () => (await h.ev(`document.querySelector(${q(`${SPLIT(B1)} [data-board-chat]`)})?.getAttribute("data-board-chat")`)) === B);
                const cells = await gridCount();
                await shot("15-dragged-to-chat");
                rec(
                    name,
                    drop?.ok && (drop.label ?? "").includes("Read this chat") && calls.length === before.length + 1 && last?.tabid === B && moved && cells === "3",
                    { drop, call: last, moved, cells }
                );
                // back as the steps after expect: the board on the first chat, the other agent out of the grid
                await AC.agentPage(
                    h,
                    `const A2 = await mod("app/view/boards/boardactions.ts");
                    await A2.moveBoardToChat({ project: ${q(PROJECT)}, boardId: ${q(B1)} }, ${q(A)});
                    const G = await mod("app/view/agents/gridstore.ts");
                    G.removeFromGrid(agentsModel(), ${q(B)});
                    return true;`
                );
                await AC.focusAgent(h, A);
                await until(async () => (await gridCount()) === "2");
            });

            // --- 16. the tree row shows the board alone ---
            await run("16. clicking a board's tree row shows it alone over the centre, its chat kept; Close goes back to the agent", async (name) => {
                await closeBoardOn();
                await AC.focusAgent(h, A);
                await until(async () => (await gridCount()) === "1");
                const clicked = await click(TREE_ROW(B1));
                const alone = await until(async () => (await count(`[data-board-alone="${PROJECT}/${B1}"]`)) === 1);
                const ready = await until(() => h.ev(`document.querySelector(${q(`[data-board-alone] ${CANVAS(B1)}`)})?.dataset.boardReady === "true"`));
                const gridShown = (await shownCells("[data-agent-grid]")) > 0;
                const selected = await h.ev(`document.querySelector(${q(TREE_ROW(B1))})?.hasAttribute("data-tree-board-open") ?? null`);
                const chat = await h.ev(`document.querySelector('[data-board-alone] [data-board-chat]')?.getAttribute("data-board-chat") ?? null`);
                const noExpand = (await count("[data-board-alone] [data-board-expand]")) === 0;
                await polishNap(300);
                await shot("16-board-alone");
                const closed = await click("[data-board-alone] [data-board-close]");
                const back = await until(async () => (await count("[data-board-alone]")) === 0 && (await shownCells(CELL)) === 1);
                rec(
                    name,
                    clicked && alone && ready && !gridShown && selected === true && chat === A && noExpand && closed && back,
                    { clicked, alone, ready, gridShown, selected, chat, noExpand, closed, back }
                );
            });

            // --- 17. a board opens as a viewer: Excalidraw's view mode, with an Edit switch in the strip above the canvas ---
            await run("17a. a board opens in view mode: no drawing toolbar, Edit not pressed, and a drag across a shape pans and moves nothing", async (name) => {
                await closeBoardOn();
                await openBoardOn(B1);
                const ready = await canvasReady(B1);
                await polishNap(600);
                const mode = await readMode(B1);
                const strip = await box(`${SPLIT(B1)} [data-board-strip]`);
                const canvasBox = await box(`${SPLIT(B1)} ${CANVAS(B1)}`);
                // a drag from the lower right of "SQLite" (85 % across, 80 % down), as a pointer would: B1 reads in parts in
                // the half cell, and the Read label of SQLite's part sits in its top-left corner, over the shape's centre
                const from = await canvasPage(`
                    const el = app().scene.getNonDeletedElements().find((e) => e.id === "sqlite");
                    return { ...pointIn("sqlite", 0.85, 0.8), at: [el.x, el.y], view: view() };`);
                // the pointer is on the canvas, not on the label: the first move, then what sits under the point
                await h.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: from.x, y: from.y });
                const hit = await h.ev(`document.elementFromPoint(${from.x}, ${from.y})?.tagName ?? null`);
                await dragBy(from, DRAG_PX);
                await polishNap(400);
                const after = await canvasPage(`
                    const el = app().scene.getNonDeletedElements().find((e) => e.id === "sqlite");
                    return { at: [el.x, el.y], view: view() };`);
                await shot("17a-view-mode");
                const stripAbove = strip != null && canvasBox != null && strip.b <= canvasBox.t + 2;
                const stripAligned = strip != null && canvasBox != null && near(strip.l, canvasBox.l, 3);
                const unmoved = from.at.join() === after.at.join();
                const panned = Math.abs(after.view.scrollX - from.view.scrollX) + Math.abs(after.view.scrollY - from.view.scrollY) > 5;
                rec(
                    name,
                    ready &&
                        mode.attr === "true" &&
                        mode.viewMode === true &&
                        !mode.toolbar &&
                        mode.edit === "false" &&
                        // the strip is the canvas column's first row, right above the canvas
                        stripAbove &&
                        stripAligned &&
                        // the press lands on the canvas, so Excalidraw sees it
                        hit === "CANVAS" &&
                        // the drag moved the view and not the shape
                        unmoved &&
                        panned,
                    { ready, mode, strip, canvasBox, stripAbove, stripAligned, from, hit, after, unmoved, panned }
                );
            });

            await run("17c. Edit brings the drawing toolbar back and a shape can be selected; Edit again returns to view mode with nothing selected", async (name) => {
                const on = await setEdit(B1, true);
                const editing = await readMode(B1);
                await canvasPage(`app().updateScene({ appState: { selectedElementIds: { "auth-key": true } } }); return true;`);
                const picked = await until(async () => (await canvasPage(`return selected();`)).join() === "auth-key");
                await shot("17c-edit");
                const off = await setEdit(B1, false);
                const cleared = await until(async () => (await canvasPage(`return selected();`)).length === 0);
                const viewing = await readMode(B1);
                await shot("17c-view-again");
                rec(
                    name,
                    on &&
                        editing.attr === "false" &&
                        editing.viewMode === false &&
                        editing.toolbar &&
                        editing.edit === "true" &&
                        picked &&
                        off &&
                        cleared &&
                        viewing.attr === "true" &&
                        viewing.viewMode === true &&
                        !viewing.toolbar &&
                        viewing.edit === "false" &&
                        viewing.selected.length === 0,
                    { editing, picked, viewing }
                );
            });

            // --- 18. drawings: each answer is a numbered frame, listed in the strip's row ---
            await run("18a. an old board opens as one drawing: the row has one chip, 1 Earlier drawings, current, and the saved file holds that frame", async (name) => {
                await closeBoardOn();
                await putBoard(h, { id: B4, name: B4_NAME, project: PROJECT, agent: { tabid: A, title: AGENT_TITLE }, turns: [], elements: ELEMENTS_4, createdts: Date.now() - 5_400_000 });
                await openBoardOn(B4);
                const ready = await canvasReady(B4);
                await until(async () => (await rowNow()).length === 1);
                const chips = await rowNow();
                // the canvas saves the board once it holds its frame
                let saved = [];
                const wrote = await until(async () => (saved = await framesInFile(B4)).length === 1);
                const file = await boardFile(h, B4);
                const inFrame = (file?.elements ?? []).filter((e) => e.frameId === saved[0]?.id && !e.isDeleted).length;
                const strip = await box(`${SPLIT(B4)} [data-board-strip]`);
                const canvasBox = await box(`${SPLIT(B4)} ${CANVAS(B4)}`);
                await shot("18a-earlier-drawings");
                rec(
                    name,
                    ready &&
                        chips.length === 1 &&
                        chips[0].n === "1" &&
                        chips[0].title === EARLIER &&
                        chips[0].current &&
                        !chips[0].fresh &&
                        wrote &&
                        saved[0].id === chips[0].id &&
                        saved[0].name === EARLIER &&
                        saved[0].customData?.arcDrawing === 1 &&
                        // the two boxes and their two labels are inside it
                        inFrame === 4 &&
                        file?.rev !== "rev-0" &&
                        strip != null &&
                        canvasBox != null &&
                        strip.b <= canvasBox.t + 2,
                    { chips, saved: saved.map((f) => ({ id: f.id, name: f.name, customData: f.customData })), inFrame, rev: file?.rev, strip, canvasBox }
                );
            });

            await run("18b. beside Chat an answer with a title lands as drawing 2: its chip enters and is current, the view eases to it and its frame ends inside the canvas", async (name) => {
                const reduced = await h.ev(`matchMedia("(prefers-reduced-motion: reduce)").matches`);
                // the narrow cell, not the expanded one: the room a drawing has to fit in is the smallest
                const expandedAttr = await h.ev(`document.querySelector(${q(SPLIT(B4))})?.dataset.boardExpanded ?? null`);
                const before = await framesNow();
                // the view once per animation frame, from before the answer lands until the ease is over
                await canvasPage(`
                    const m = (fx.motion = { rows: [], done: false });
                    const t0 = performance.now();
                    const tick = (now) => {
                        const s = app()?.state;
                        if (s != null) m.rows.push([Math.round(now - t0), s.scrollX, s.scrollY, s.zoom.value]);
                        if (now - t0 < 2500) requestAnimationFrame(tick);
                        else m.done = true;
                    };
                    requestAnimationFrame(tick);
                    return true;`);
                const { acked, ack } = await land(B4, "t-b4-2", { add: JSON.stringify(DRAWING_2.add), title: DRAWING_2.title });
                const current = await until(async () => (await rowNow())[1]?.current === true);
                await until(() => canvasPage(`return fx.motion.done;`));
                const motion = await canvasPage(`return fx.motion.rows;`);
                const moved = motion.map((r, i) => i > 0 && (Math.abs(r[1] - motion[i - 1][1]) > 0.01 || Math.abs(r[2] - motion[i - 1][2]) > 0.01 || Math.abs(r[3] - motion[i - 1][3]) > 0.0001));
                const ease = {
                    frames: motion.length,
                    firstMovedFrame: moved.indexOf(true),
                    firstMovedMs: motion[moved.indexOf(true)]?.[0] ?? null,
                    movingFrames: moved.filter(Boolean).length,
                    lastMovedMs: motion[moved.lastIndexOf(true)]?.[0] ?? null,
                    reduced,
                };
                const after = await framesNow();
                const old = after.find((f) => f.name === EARLIER);
                const next = after.find((f) => f.name === DRAWING_2.title);
                const onCv = next == null ? null : await canvasPage(`return onCanvas(${q(next.id)});`);
                const chips = await rowNow();
                const inView = await h.ev(`document.querySelector(${q(`${SPLIT(B4)} ${CANVAS(B4)}`)})?.dataset.boardInView ?? null`);
                await shot("18b-new-drawing");
                // the picture of the feature: the cell beside Chat with its row of drawings
                let picture;
                try {
                    picture = await h.whatsnewShot("board-drawings", { selector: BOARD });
                } catch (e) {
                    picture = { error: String(e?.message ?? e) };
                }
                rec(
                    name,
                    expandedAttr === "false" &&
                        acked &&
                        ack?.error == null &&
                        ack?.shapeids?.length === 2 &&
                        current &&
                        before.length === 1 &&
                        after.length === 2 &&
                        old != null &&
                        next != null &&
                        next.n === 2 &&
                        // right of the board it landed on, with the board's gap, and level with its top
                        next.x >= old.x + old.width + 100 &&
                        Math.abs(next.y - old.y) <= 2 &&
                        chips.length === 2 &&
                        chips[0].n === "1" &&
                        chips[0].title === EARLIER &&
                        !chips[0].current &&
                        chips[1].n === "2" &&
                        chips[1].title === DRAWING_2.title &&
                        chips[1].current &&
                        !chips[1].fresh &&
                        inView === next.id &&
                        fitted(onCv) &&
                        // it eased: the view moved over several frames and did not jump (reduced motion jumps)
                        ease.frames >= 10 &&
                        (reduced || ease.movingFrames >= 3) &&
                        picture?.error == null &&
                        /-board-drawings\.webp$/.test(picture?.file ?? ""),
                    { expandedAttr, ack, old, next, onCv, chips, inView, ease, picture }
                );
            });

            await run("18c. a pick fits its drawing; one that lands while you are on an earlier drawing leaves the view and reads new; picking it fits it and clears new", async (name) => {
                const first = (await rowNow())[0];
                await click(chip(B4, first.id));
                const onFirst = await until(async () => (await rowNow())[0]?.current === true);
                await polishNap(300);
                const fit1 = await canvasPage(`return onCanvas(${q(first.id)});`);
                const viewBefore = await canvasPage(`return view();`);
                const landed = await land(B4, "t-b4-3", { add: JSON.stringify(DRAWING_3.add), title: DRAWING_3.title });
                const three = await until(async () => (await rowNow()).length === 3);
                // the chip has entered and the canvas has had its say: the view is where the pick left it
                await polishNap(900);
                const chipsAfter = await rowNow();
                const viewAfter = await canvasPage(`return view();`);
                await shot("18c-new-while-earlier");
                const third = chipsAfter[2];
                await click(chip(B4, third?.id ?? ""));
                const onThird = await until(async () => {
                    const r = await rowNow();
                    return r[2]?.current === true && !r[2].fresh;
                });
                await polishNap(300);
                const fit3 = await canvasPage(`return onCanvas(${q(third?.id ?? "")});`);
                const chipsPicked = await rowNow();
                await shot("18c-picked-new");
                rec(
                    name,
                    onFirst &&
                        fitted(fit1) &&
                        centred(fit1) &&
                        landed.acked &&
                        landed.ack?.error == null &&
                        three &&
                        chipsAfter.length === 3 &&
                        chipsAfter[0].current &&
                        !chipsAfter[1].current &&
                        !chipsAfter[2].current &&
                        // the new drawing is marked, the others are not
                        third.n === "3" &&
                        third.title === DRAWING_3.title &&
                        third.fresh &&
                        third.newWord === "new" &&
                        chipsAfter.filter((c) => c.fresh).length === 1 &&
                        // and the view stayed where the pick left it
                        JSON.stringify(viewAfter) === JSON.stringify(viewBefore) &&
                        onThird &&
                        fitted(fit3) &&
                        centred(fit3) &&
                        chipsPicked.every((c) => !c.fresh) &&
                        chipsPicked.filter((c) => c.current).length === 1,
                    { fit1, viewBefore, viewAfter, chipsAfter, fit3, chipsPicked }
                );
            });

            await run("18e. an edit answer that lengthens a text keeps it inside its drawing's frame, on a board that turns to Nunito", async (name) => {
                const target = (await rowNow()).find((c) => c.current);
                const readText = (id) =>
                    canvasPage(`
                        const t = app().scene.getNonDeletedElements().find((e) => e.id === ${q(id)});
                        return t == null ? null : { x: t.x, y: t.y, width: t.width, height: t.height, text: t.text, fontFamily: t.fontFamily };`);
                // drawing 3's free text, and its frame as it was
                const free = await canvasPage(`
                    const t = app().scene.getNonDeletedElements().find((e) => e.frameId === ${q(target?.id ?? "")} && e.type === "text" && e.containerId == null);
                    return t == null ? null : { id: t.id, text: t.text, fontFamily: t.fontFamily };`);
                const old = (await framesNow()).find((f) => f.id === target?.id);
                const landed = await land(B4, "t-b4-5", { update: JSON.stringify([{ id: free?.id, text: LONG_NOTE }]), drawingid: target?.id, title: DRAWING_3.title });
                // Nunito loads when the canvas first shows text in it, and the canvas measures its text again then: wait
                // for the box to hold still
                let settled = await readText(free?.id);
                for (let i = 0; i < 20; i++) {
                    await polishNap(500);
                    const next = await readText(free?.id);
                    const still = JSON.stringify(next) === JSON.stringify(settled);
                    settled = next;
                    if (still && i >= 2) break;
                }
                const fit = await canvasPage(`
                    const all = app().scene.getNonDeletedElements();
                    const outside = (e, f) => e.x < f.x - 0.5 || e.y < f.y - 0.5 || e.x + e.width > f.x + f.width + 0.5 || e.y + e.height > f.y + f.height + 0.5;
                    const mine = frames().find((f) => f.id === ${q(target?.id ?? "")});
                    return {
                        frame: mine,
                        kids: all.filter((e) => e.frameId === mine.id).length,
                        out: all.filter((e) => e.frameId === mine.id && outside(e, mine)).map((e) => e.id),
                        // the other drawings' text turned to Nunito too: what spills out of them is reported, not judged
                        others: frames().filter((f) => f.id !== mine.id).map((f) => ({ n: f.n, out: all.filter((e) => e.frameId === f.id && outside(e, f)).length })),
                        onCanvas: onCanvas(mine.id),
                    };`);
                const chips = await rowNow();
                await shot("18e-edit-refit");
                rec(
                    name,
                    target != null &&
                        free?.text === "note" &&
                        free.fontFamily !== 6 &&
                        old != null &&
                        landed.acked &&
                        landed.ack?.error == null &&
                        settled?.text === LONG_NOTE &&
                        settled.fontFamily === 6 &&
                        // it outgrew the frame as it was, so the frame had to refit
                        settled.x + settled.width > old.x + old.width &&
                        fit.out.length === 0 &&
                        fit.frame.width > old.width &&
                        // an edit adds no chip, and its drawing stays the one in view, whole on the canvas
                        chips.length === 3 &&
                        chips[2].current &&
                        fitted(fit.onCanvas),
                    { target, free, old, settled, fit, chips }
                );
            });

            await run("18f. a board left following and closed, with an answer landing while it is closed, reopens fitted to its newest drawing", async (name) => {
                const left = await rowNow();
                // the newest drawing is the one in view: the board is following
                const following = left.at(-1)?.current === true;
                await polishNap(800);
                await closeBoardOn();
                await until(async () => (await box(SPLIT(B4))) == null);
                // the closing canvas saves what it still holds; the answer lands after that
                await polishNap(800);
                // no canvas of the board is open: the applier lands the answer in the file
                const landed = await land(B4, "t-b4-6", { add: JSON.stringify(DRAWING_4.add), title: DRAWING_4.title });
                let frames = [];
                const saved = await until(async () => (frames = await framesInFile(B4)).length === 4);
                await openBoardOn(B4);
                const ready = await canvasReady(B4);
                await until(async () => (await rowNow()).length === 4);
                await polishNap(500);
                const chips = await rowNow();
                const newest = chips.at(-1);
                const onCv = await canvasPage(`return onCanvas(${q(newest?.id ?? "")});`);
                await shot("18f-reopened-following");
                rec(
                    name,
                    following &&
                        landed.acked &&
                        landed.ack?.error == null &&
                        saved &&
                        frames.some((f) => f.name === DRAWING_4.title && f.customData?.arcDrawing === 4) &&
                        ready &&
                        chips.length === 4 &&
                        newest.n === "4" &&
                        newest.title === DRAWING_4.title &&
                        newest.current &&
                        !newest.fresh &&
                        chips.filter((c) => c.current).length === 1 &&
                        fitted(onCv) &&
                        centred(onCv),
                    { left, following, chips, onCv, frames: frames.map((f) => ({ id: f.id, name: f.name, n: f.customData?.arcDrawing })) }
                );
            });

            await run("18g. an empty board says so over the canvas, naming Chat's @board and Edit, and has no status line", async (name) => {
                await closeBoardOn();
                await putBoard(h, { id: B5, name: B5_NAME, project: PROJECT, agent: { tabid: A, title: AGENT_TITLE }, turns: [], elements: [], createdts: Date.now() - 600_000 });
                await openBoardOn(B5);
                const ready = await canvasReady(B5);
                const shown = await until(async () => (await count(`${SPLIT(B5)} [data-board-empty]`)) === 1);
                await polishNap(300);
                const canvasLine = await text(`${SPLIT(B5)} [data-board-empty]`);
                // no turn, so no status line
                const lines = await statusCount();
                // nothing drawn, so no row; the Edit switch is there from the start
                const chips = await count(`${SPLIT(B5)} [data-board-drawings] [data-board-drawing]`);
                const edit = await text(`${SPLIT(B5)} [data-board-edit]`);
                await shot("18g-empty");
                // as the step after expects: no board open
                await closeBoardOn();
                rec(
                    name,
                    ready &&
                        shown &&
                        canvasLine === "Nothing drawn yet. Ask in Chat with @board, or press Edit to draw." &&
                        canvasLine.includes("@board") &&
                        canvasLine.includes("Edit") &&
                        lines === 0 &&
                        chips === 0 &&
                        edit === "Edit",
                    { canvasLine, lines, chips, edit }
                );
            });

            // --- 18h-i. Copy view and Delete on the strip, and the board's cell in the tree's split row ---
            await run("18h. Copy view puts the canvas as it shows on the clipboard as a PNG the canvas's size; Delete (in Edit only) takes the drawing in view off the row and the file, the view goes to the one before, and the toast's Undo brings it back", async (name) => {
                await openBoardOn(B4);
                const ready = await canvasReady(B4);
                const before = await rowNow();
                const landed = await land(B4, "t-b4-delete", { add: JSON.stringify(DRAWING_DELETE.add), title: DRAWING_DELETE.title });
                const onIt = await until(async () => {
                    const r = await rowNow();
                    return r.length === before.length + 1 && r[r.length - 1].current;
                });
                await polishNap(900);
                const doomed = (await rowNow()).at(-1);
                await shot("18h-before-delete");
                // the clipboard write, caught: the PNG's size against the static canvas's
                await h.ev(`(() => {
                    window.__copied = null;
                    window.__clipWrite ??= navigator.clipboard.write.bind(navigator.clipboard);
                    navigator.clipboard.write = async (items) => {
                        const blob = await items[0].getType("image/png");
                        const bmp = await createImageBitmap(blob);
                        window.__copied = { type: blob.type, w: bmp.width, h: bmp.height };
                    };
                    return true;
                })()`);
                const copied = await click(`${SPLIT(B4)} [data-board-copy-view]`);
                const png = await until(() => h.ev(`window.__copied`));
                const canvasSize = await h.ev(`(() => {
                    const c = document.querySelector(${q(`${SPLIT(B4)} canvas.excalidraw__canvas.static`)});
                    return c == null ? null : { w: c.width, h: c.height };
                })()`);
                await h.ev(`(() => { if (window.__clipWrite) navigator.clipboard.write = window.__clipWrite; return true; })()`);
                const sameSize = png != null && canvasSize != null && png.w === canvasSize.w && png.h === canvasSize.h;
                // Delete shows in Edit only: off the row and the file, the view on the drawing before
                const noDeleteInView = (await count(`${SPLIT(B4)} [data-board-delete]`)) === 0;
                const editOn = await setEdit(B4, true);
                const deleted = await click(`${SPLIT(B4)} [data-board-delete]`);
                const gone = await until(async () => {
                    const r = await rowNow();
                    return r.length === before.length && !r.some((d) => d.id === doomed?.id) && r.at(-1)?.current;
                });
                const offFile = await until(async () => !(await framesInFile(B4)).some((f) => f.id === doomed?.id));
                await polishNap(600);
                await shot("18h-deleted");
                const undoShown = await until(async () => (await count("[data-notification-action]")) > 0);
                const undone = await click("[data-notification-action]");
                const back = await until(async () => (await rowNow()).some((d) => d.id === doomed?.id && d.current));
                const inFile = await until(async () => (await framesInFile(B4)).some((f) => f.id === doomed?.id));
                const editOff = await setEdit(B4, false);
                rec(
                    name,
                    ready && landed.acked && onIt && copied && png?.type === "image/png" && sameSize && noDeleteInView && editOn && editOff && deleted && gone && offFile && undoShown && undone && back && inFile,
                    { before: before.length, doomed: doomed?.id, png, canvasSize, noDeleteInView, editOn, editOff, gone, offFile, undoShown, back, inFile }
                );
            });

            await run("18i. in the tree's split row, a click on the board's cell expands the board over the grid and marks the cell; a second click collapses it", async (name) => {
                const cell = `[data-split-board="${B4}"]`;
                const present = await until(async () => (await count(cell)) === 1);
                const clicked = await click(cell);
                const expanded = await until(() => h.ev(`document.querySelector(${q(SPLIT(B4))})?.dataset.boardMax === "true"`));
                const marked = await h.ev(`document.querySelector(${q(cell)})?.hasAttribute("data-split-board-max") ?? false`);
                await polishNap(400);
                await shot("18i-expanded-from-tree");
                await click(cell);
                const collapsed = await until(() => h.ev(`document.querySelector(${q(SPLIT(B4))})?.dataset.boardMax !== "true"`));
                const unmarked = await h.ev(`!(document.querySelector(${q(cell)})?.hasAttribute("data-split-board-max") ?? false)`);
                await closeBoardOn();
                rec(name, present && clicked && expanded && marked && collapsed && unmarked, { present, expanded, marked, collapsed, unmarked });
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
