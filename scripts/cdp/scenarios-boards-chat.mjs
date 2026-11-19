// Scenario `boards-chat`: a board in the agent's Chat (docs/superpowers/specs/2026-11-19-kael-boards-design.md, plan
// 2026-11-19-kael-boards.md Tasks 6 and 8): the toast when the drawer draws for an agent you are not looking at, the
// card a turn that ran `wsh board draw` ends in, and the chip a question forwarded from a board wears.
//
//   board card   [data-chat-board="<board id>"] at the end of its turn's [data-chat-agent] group, with [data-chat-board-name],
//                [data-chat-board-facts] (`9 shapes`, then ` · drawing…` while the drawer answers the agent's last
//                request) and [data-chat-board-open]; [data-chat-board-drawing] while it draws
//   forward chip [data-chat-board-chip] right before the [data-chat-you] bubble of a forwarded question
//
// Two fixture claude agents over real tabs (no controller, so nothing runs) and a mock roster for them; the first has a
// transcript the steps read as Chat. The board commands are stubbed in the page (boards-fixtures.mjs): no real drawer
// runs, and wavesrv holds no board. A drawer's answer is put in the fixture inbox and announced with board:update, so the
// real applier lands it through the real Excalidraw (convertToExcalidrawElements) into the fixture file and acks it; the
// stubbed ack marks the turn answered and publishes the update, as wavesrv does.

import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
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
    rectElement,
    removeBoardStubs,
} from "./boards-fixtures.mjs";

const NAME = "boards-chat";
const PROJECT = "boards-chat-fx";
const SESSION = "boards-chat-session";
const BOARD_ID = "b0a4d001";
const BOARD_NAME = "wavesrv-startup";
const GHOST_BOARD = "ghost-board";
const AGENT_TITLE = `claude · ${PROJECT}`;
const WAIT_MS = 15000;
const TOAST = "[data-notification-toast]";
const TOAST_ACTION = "[data-notification-action]";
const AFTER_DRAW = "Added the auth key step to the picture.";
// what `wsh board draw` prints (cmd/wsh/cmd/wshcmd-board.go), which a call's result carries
const DRAWN_9 = `Drawn on board "${BOARD_NAME}": +9 shapes, 0 changed, 0 removed.`;
const DRAWN_1 = `Drawn on board "${BOARD_NAME}": +1 shapes, 0 changed, 0 removed.`;
const DRAWN_GHOST = `Drawn on board "${GHOST_BOARD}": +2 shapes, 0 changed, 0 removed.`;
// the messages wavesrv types into the agent for a forwarded question (pkg/boardforward Marker), with a selection and
// without one
const FORWARD_ON = `[From board "${BOARD_NAME}" · on wavesrv, SQLite · turn t-fwd-1]\nwhy two stores?`;
const FORWARD_OFF = `[From board "${BOARD_NAME}" · turn t-fwd-2]\nwhat is this box?`;

// the drawer's reply to the agent's request: two labelled boxes, as the drawer writes skeletons
const SKELETON = JSON.stringify([
    { type: "rectangle", x: 0, y: 0, width: 180, height: 70, label: { text: "wavesrv" } },
    { type: "rectangle", x: 260, y: 0, width: 180, height: 70, label: { text: "SQLite" } },
]);

const requestTurn = (id, over = {}) => ({
    id,
    ts: Date.now() - 20_000,
    kind: "request",
    question: "draw how wavesrv starts",
    context: "wavesrv startup flow",
    state: "answering",
    startedts: Date.now() - 18_000,
    ...over,
});

export default function (kit) {
    const { waveService, polishNap, ahReload, GRID_KEY, GRID_EMPTY } = kit;
    const { makeTab, closeTabs } = AC.tabFixtures({ waveService });
    const LS_KEYS = [GRID_KEY, "agent.chatmode"];

    // a record's time: real time, strictly after the one before, so the transcript reads in the order it was written
    const stamp = (ctx) => {
        ctx.last = Math.max((ctx.last ?? 0) + 1, Date.now());
        return { cwd: ctx.dir, ts: new Date(ctx.last).toISOString() };
    };
    const append = (ctx, ...lines) => appendFileSync(ctx.transcript, lines.join("\n") + "\n");

    // the first agent has the transcript; the other only has to be somewhere else to look at
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
            const ctx = { prev: {}, dir: mkdtempSync(join(tmpdir(), "verify-boards-chat-")) };
            let at = "reading the keys";
            try {
                for (const k of LS_KEYS) ctx.prev[k] = await h.ev(`localStorage.getItem(${JSON.stringify(k)})`);

                at = "writing the transcript";
                // turn 1 draws twice on one board (one card), turn 2 on a board nobody has made (no card); both calls print
                // what `wsh board draw` prints
                const base = Date.now() - 3_600_000;
                const o = (sec) => ({ cwd: ctx.dir, ts: new Date(base + sec * 1000).toISOString() });
                const draw = (id, sec, command, output) => [
                    AC.toolUse(id, "Bash", { command, description: "Draw it on the board" }, o(sec)),
                    AC.toolResult(id, output, o(sec + 1)),
                ];
                ctx.transcript = AC.writeTranscript(ctx.dir, SESSION, [
                    AC.userText("how does wavesrv start? draw it", o(0)),
                    AC.assistantText("I'll draw the startup flow on a board.", o(2)),
                    ...draw(
                        "toolu_board_1",
                        4,
                        `cd /work/arcterm && wsh board draw --board ${BOARD_NAME} --context "wavesrv starts the store, then the servers"`,
                        DRAWN_9
                    ),
                    AC.assistantText("Drawn. Tell me what to change.", o(8)),
                    ...draw(
                        "toolu_board_2",
                        10,
                        `~/.arc/bin/wsh board draw --board "${BOARD_NAME.toUpperCase()}" --ask "add the auth key step"`,
                        DRAWN_1
                    ),
                    AC.assistantText(AFTER_DRAW, o(14)),
                    AC.userText("now draw the other thing", o(20)),
                    ...draw(
                        "toolu_board_3",
                        22,
                        `wsh board draw --board ${GHOST_BOARD} --context "the part nobody made a board for"`,
                        DRAWN_GHOST
                    ),
                    AC.assistantText("That one is on its own board.", o(26)),
                ]);
                ctx.last = Date.now();

                at = "resetting the grid";
                await h.ev(`localStorage.setItem(${JSON.stringify(GRID_KEY)}, ${JSON.stringify(JSON.stringify(GRID_EMPTY))})`);
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
                await putBoard(h, {
                    id: BOARD_ID,
                    name: BOARD_NAME,
                    project: PROJECT,
                    agent: { tabid: ctx.agent.tabId, title: AGENT_TITLE },
                    // Nunito: a family Excalidraw fetches rather than carries, so the canvas step can see where fonts come from
                    elements: boxElements("user-box", 0, 200, "my note", 6),
                });
            } catch (e) {
                ctx.arrangeError = `${at}: ${String(e?.message ?? e)}`;
            }
            return ctx;
        },

        async assert(h, ctx) {
            const steps = [];
            const rec = (step, ok, detail) => steps.push({ step, ok: !!ok, detail: typeof detail === "string" ? detail : JSON.stringify(detail) });
            if (ctx.arrangeError != null) {
                rec("0. the fixture agents and the stubbed board", false, ctx.arrangeError);
                return steps;
            }
            const A = ctx.agent.tabId;
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
                    await h.shot(`cdp-shots/boards-chat-${name}.png`);
                } catch (e) {
                    console.error(`boards-chat: the shot ${name} failed: ${e?.message ?? e}`);
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

            // the toasts on screen: their text, and whether one has an Open button
            const toasts = () =>
                h.ev(`[...document.querySelectorAll(${JSON.stringify(TOAST)})].map((t) => ({
                    text: (t.textContent ?? "").replace(/\\s+/g, " ").trim(),
                    open: (t.parentElement?.querySelector(${JSON.stringify(TOAST_ACTION)})?.textContent ?? "").trim(),
                }))`);
            // the board's split state and the agent focus, as the stores hold them
            const state = () =>
                AC.agentPage(
                    h,
                    `const S = await mod("app/view/boards/boardsplitstore.ts");
                    const model = agentsModel();
                    return {
                        split: globalStore.get(S.boardSplitAtom(${JSON.stringify(A)})),
                        focus: globalStore.get(model.focusIdAtom),
                        surface: globalStore.get(model.surfaceAtom),
                        chat: window.__arcChatMode?.get(${JSON.stringify(A)}) ?? null,
                    };`
                );
            const toastShows = async () => (await toasts()).some((t) => t.text.includes(`The drawer drew on ${BOARD_NAME}`));
            const closeSplit = () =>
                AC.agentPage(
                    h,
                    `const S = await mod("app/view/boards/boardsplitstore.ts");
                    S.closeBoard(${JSON.stringify(A)});
                    return true;`
                );

            // --- 1. the agent's request is drawn, and you are looking at another agent ---
            await run("1. a drawn request toasts The drawer drew on <board>, with Open", async (name) => {
                await AC.focusAgent(h, ctx.other.tabId);
                await putTurns(h, BOARD_ID, [requestTurn("t-req-1")]);
                await putAnswer(h, BOARD_ID, { id: "ans-1", turnid: "t-req-1", add: SKELETON });
                await feedBoardUpdate(h, { project: PROJECT, boardid: BOARD_ID, what: "answer" });
                const shown = await until(toastShows);
                await shot("toast");
                const list = await toasts();
                const toast = list.find((t) => t.text.includes(`The drawer drew on ${BOARD_NAME}`));
                const acks = await boardCalls(h, "BoardAnswerAckCommand");
                const saves = await boardCalls(h, "BoardSaveCommand");
                const file = await boardFile(h, BOARD_ID);
                const texts = (file?.elements ?? []).filter((e) => e.type === "text").map((e) => e.text);
                // the user's box stays; the two the drawer drew land on it, through the real Excalidraw
                const shapes = (file?.elements ?? []).filter((e) => !(e.type === "text" && e.containerId != null));
                rec(
                    name,
                    shown &&
                        toast?.open === "Open" &&
                        acks.length === 1 &&
                        acks[0].turnid === "t-req-1" &&
                        acks[0].error == null &&
                        acks[0].shapeids?.length === 2 &&
                        saves.length === 1 &&
                        saves[0].baserev === "rev-0" &&
                        shapes.length === 3 &&
                        texts.includes("wavesrv") &&
                        texts.includes("SQLite") &&
                        texts.includes("my note"),
                    { toast, acks, saves: saves.map((s) => s.baserev), shapes: shapes.length, texts, fileRev: file?.rev }
                );
            });

            // --- 2. Open: the agent is focused on the Agent surface and the split is opened for it ---
            await run("2. Open focuses the agent on the Agent surface and sets its board split", async (name) => {
                const before = await state();
                const clicked = await h.ev(`(() => {
                    const open = document.querySelector(${JSON.stringify(TOAST_ACTION)});
                    if (!open) return false;
                    open.click();
                    return true;
                })()`);
                await until(async () => (await state()).split != null);
                const after = await state();
                await shot("opened");
                rec(
                    name,
                    clicked &&
                        before.split == null &&
                        before.focus === ctx.other.tabId &&
                        after.focus === A &&
                        after.surface === "agent" &&
                        after.chat === "chat" &&
                        after.split?.project === PROJECT &&
                        after.split?.boardId === BOARD_ID &&
                        after.split?.expanded === false,
                    { before, after }
                );
            });

            // --- 3. looking at the agent: the drawing lands and nothing toasts ---
            await run("3. no toast while the Agent surface shows the board's agent", async (name) => {
                const before = (await boardCalls(h, "BoardAnswerAckCommand")).length;
                await putTurns(h, BOARD_ID, [requestTurn("t-req-2", { question: "add the auth key" })]);
                await putAnswer(h, BOARD_ID, { id: "ans-2", turnid: "t-req-2", add: SKELETON });
                await feedBoardUpdate(h, { project: PROJECT, boardid: BOARD_ID, what: "answer" });
                const acked = await until(async () => (await boardCalls(h, "BoardAnswerAckCommand")).length === before + 1);
                // the toast is raised after the ack's own update, so give it the time it would take
                await polishNap(1500);
                const list = await toasts();
                await shot("quiet");
                rec(name, acked && list.length === 0, { acked, toasts: list });
            });

            // --- 4. the canvas itself: BoardCanvas mounted on its own in a box over the page (the split that hosts it is
            // Task 7's), on the board the steps above drew on ---
            const CANVAS = `[data-board-canvas="${BOARD_ID}"]`;
            // Excalidraw's App instance, off the canvas's React fiber, and what it holds
            const APP = `
                const app = () => {
                    const el = document.querySelector('${CANVAS} .excalidraw');
                    const key = el && Object.keys(el).find((k) => k.startsWith("__reactFiber$"));
                    for (let f = key ? el[key] : null; f != null; f = f.return) {
                        if (typeof f.stateNode?.updateScene === "function" && f.stateNode?.scene != null) return f.stateNode;
                    }
                    return null;
                };
                // the canvas's shapes, bound text counted with its box
                const shapes = () => (app()?.scene.getNonDeletedElements() ?? []).filter((e) => !(e.type === "text" && e.containerId != null));
                const selected = () => Object.keys(app()?.state.selectedElementIds ?? {}).filter((id) => app().state.selectedElementIds[id]).sort();
            `;
            const canvas = (body) => boardPage(h, `${APP} ${body}`);
            await run("4. BoardCanvas: loads the file, Show selects shapes, a live answer is one undo step", async (name) => {
                // the split step 2 opened holds a canvas of this board once the split is drawn (Task 7): the smoke canvas must
                // be the board's only mount, since the live answer lands on the newest one
                await closeSplit();
                await boardPage(
                    h,
                    `// the optimized deps are CommonJS: their exports sit on the module's default
                    const R = (await mod("deps/react.js")).default;
                    const D = (await mod("deps/react-dom_client.js")).default;
                    const { BoardCanvas } = await mod("app/view/boards/boardcanvas.tsx");
                    const host = document.createElement("div");
                    host.setAttribute("data-board-smoke", "");
                    host.style.cssText = "position:fixed;left:80px;top:80px;width:960px;height:600px;z-index:9999;";
                    document.body.appendChild(host);
                    const root = D.createRoot(host);
                    const smoke = (fx.smoke = { root, host, selections: [], resources: [] });
                    // the page's resource-timing buffer is already full of the dev server's modules, so what the canvas
                    // fetches is read from an observer
                    smoke.observer = new PerformanceObserver((list) => smoke.resources.push(...list.getEntries().map((e) => e.name)));
                    smoke.observer.observe({ type: "resource" });
                    smoke.render = (highlightIds) =>
                        root.render(R.createElement(BoardCanvas, {
                            project: ${JSON.stringify(PROJECT)}, boardId: ${JSON.stringify(BOARD_ID)}, highlightIds,
                            onSelection: (s) => smoke.selections.push(s),
                        }));
                    smoke.render(null);
                    return true;`
                );
                const loaded = await until(() => h.ev(`document.querySelector('${CANVAS}')?.dataset.boardReady === "true"`));
                const file0 = await boardFile(h, BOARD_ID);
                const shapes0 = (file0?.elements ?? []).filter((e) => !(e.type === "text" && e.containerId != null)).length;
                const start = await canvas(`return { shapes: shapes().length, selected: selected() };`);
                await shot("canvas");
                // the fonts come from the app (/excalidraw/fonts/), never from esm.sh, which the CSP refuses and offline cannot
                // reach: Excalidraw is pointed at the app's own path, the app serves a font file there, and what the canvas
                // fetched (a font is requested when its text first draws) came from there
                const fontUrls = await boardPage(
                    h,
                    `await document.fonts.ready;
                    await nap(1500);
                    const res = await fetch("/excalidraw/fonts/Excalifont/Excalifont-Regular-a88b72a24fb54c9f94e3b5fdaa7481c9.woff2");
                    const names = fx.smoke.resources;
                    return {
                        assetPath: window.EXCALIDRAW_ASSET_PATH,
                        served: { ok: res.ok, type: res.headers.get("content-type"), bytes: (await res.arrayBuffer()).byteLength },
                        local: names.filter((n) => n.includes("/excalidraw/fonts/")).length,
                        remote: names.filter((n) => /esm\\.sh|unpkg|jsdelivr/.test(n)),
                    };`
                );

                // Show: the shapes of a drawn turn are selected, and the selection is reported with its label
                await canvas(`fx.smoke.render(["user-box"]); return true;`);
                const shown = await until(() => h.ev(`document.querySelector('${CANVAS}')?.dataset.boardHighlight === "user-box"`));
                const afterShow = await canvas(`return { selected: selected(), selections: fx.smoke.selections };`);
                await shot("canvas-show");

                // a live answer: handed to this canvas, one updateScene, saved under the canvas's rev, acked with its ids
                const acks0 = (await boardCalls(h, "BoardAnswerAckCommand")).length;
                const reads0 = (await boardCalls(h, "BoardReadCommand")).length;
                const saves0 = (await boardCalls(h, "BoardSaveCommand")).length;
                await putTurns(h, BOARD_ID, [requestTurn("t-req-3", { question: "add the build step" })]);
                await putAnswer(h, BOARD_ID, { id: "ans-3", turnid: "t-req-3", add: SKELETON });
                await feedBoardUpdate(h, { project: PROJECT, boardid: BOARD_ID, what: "answer" });
                const landed = await until(async () => (await boardCalls(h, "BoardAnswerAckCommand")).length === acks0 + 1);
                const afterAnswer = await canvas(`return { shapes: shapes().length };`);
                const acks = await boardCalls(h, "BoardAnswerAckCommand");
                const saves = await boardCalls(h, "BoardSaveCommand");
                const reads = await boardCalls(h, "BoardReadCommand");
                await shot("canvas-answer");

                // one Ctrl+Z takes the whole turn back
                await canvas(`app().focusContainer?.(); document.querySelector('${CANVAS} .excalidraw')?.focus(); return true;`);
                for (const type of ["rawKeyDown", "keyUp"]) {
                    await h.cdp("Input.dispatchKeyEvent", { type, modifiers: 2, key: "z", code: "KeyZ", windowsVirtualKeyCode: 90 });
                }
                const undone = await until(async () => (await canvas(`return shapes().length;`)) === afterAnswer.shapes - 2);
                const afterUndo = await canvas(`return { shapes: shapes().length };`);
                await shot("canvas-undo");

                rec(
                    name,
                    loaded &&
                        fontUrls.assetPath === "/excalidraw/" &&
                        fontUrls.served.ok &&
                        fontUrls.served.type === "font/woff2" &&
                        fontUrls.served.bytes > 1000 &&
                        fontUrls.local > 0 &&
                        fontUrls.remote.length === 0 &&
                        start.shapes === shapes0 &&
                        shown &&
                        afterShow.selected.join() === "user-box" &&
                        afterShow.selections.at(-1)?.label === "my note" &&
                        landed &&
                        acks.at(-1).error == null &&
                        acks.at(-1).shapeids?.length === 2 &&
                        afterAnswer.shapes === start.shapes + 2 &&
                        saves.length === saves0 + 1 &&
                        // the canvas takes the answer itself: the applier never read the file for it
                        reads.length === reads0 &&
                        undone &&
                        afterUndo.shapes === start.shapes,
                    { loaded, fontUrls, shapes0, start, shown, afterShow, afterAnswer, ack: acks.at(-1), saves: saves.length - saves0, reads: reads.length - reads0, undone, afterUndo }
                );
            });

            // --- the card in Chat: A's transcript is the conversation ---
            const LAYER = `document.querySelector('[data-agent-chat="${A}"]')`;
            // every board card in A's Chat: the board it names, what it says, whether it ends its turn
            const cards = () =>
                AC.agentPage(
                    h,
                    `return [...(${LAYER}?.querySelectorAll("[data-chat-board]") ?? [])].map((c) => {
                        const group = c.closest("[data-chat-agent]");
                        return {
                            id: c.getAttribute("data-chat-board"),
                            name: flat(c.querySelector("[data-chat-board-name]")),
                            facts: flat(c.querySelector("[data-chat-board-facts]")),
                            open: flat(c.querySelector("[data-chat-board-open]")),
                            drawing: c.hasAttribute("data-chat-board-drawing"),
                            endsTurn: group?.lastElementChild?.contains(c) ?? false,
                            turn: flat(group),
                        };
                    });`
                );
            const scrollTo = (sel) =>
                AC.agentPage(
                    h,
                    `${LAYER}?.querySelector(${JSON.stringify(sel)})?.scrollIntoView({ block: "center" });
                    await nap(300);
                    return true;`
                );
            const nine = Array.from({ length: 9 }, (_, i) => rectElement(`shape-${i}`, i * 60, 0, 50, 40));

            await run("5. a turn that ran wsh board draw ends in one card: the name, 9 shapes and Open", async (name) => {
                // the smoke canvas of step 4 goes, and so does the split step 2 opened: Chat alone, as you find it
                await boardPage(h, `fx.smoke?.root.unmount(); fx.smoke?.host.remove(); fx.smoke = null; return true;`);
                await closeSplit();
                await AC.focusAgent(h, A);
                // the board as the agent left it: nine shapes, its request drawn
                await putBoard(h, {
                    id: BOARD_ID,
                    name: BOARD_NAME,
                    project: PROJECT,
                    agent: { tabid: A, title: AGENT_TITLE },
                    turns: [requestTurn("t-card-1", { state: "answered", answeredts: Date.now() - 5_000, added: 9, shapeids: nine.map((e) => e.id) })],
                    elements: nine,
                });
                // the card may have drawn from the board as the steps before left it: it says nine shapes once the list reloads
                const shown = await until(async () => (await cards())[0]?.facts === "9 shapes");
                await scrollTo("[data-chat-board]");
                await shot("card");
                const list = await cards();
                // two calls on the board in turn 1 (one spelled in capitals) are one card; the call on a board nobody made, in
                // turn 2, has none
                rec(
                    name,
                    shown &&
                        list.length === 1 &&
                        list[0].id === BOARD_ID &&
                        list[0].name === BOARD_NAME &&
                        list[0].facts === "9 shapes" &&
                        list[0].open === "Open" &&
                        !list[0].drawing &&
                        list[0].endsTurn &&
                        list[0].turn.includes(AFTER_DRAW) &&
                        !list[0].turn.includes("That one is on its own board."),
                    { shown, list: list.map((c) => ({ ...c, turn: c.turn.slice(-80) })) }
                );
            });

            await run("6. the card says drawing… while the drawer answers the agent's last request, and not for your own ask", async (name) => {
                const ids = nine.map((e) => e.id);
                const done = requestTurn("t-card-1", { state: "answered", answeredts: Date.now() - 5_000, added: 9, shapeids: ids });
                await putTurns(h, BOARD_ID, [done, requestTurn("t-card-2", { question: "add the auth key" })]);
                const drawing = await until(async () => (await cards())[0]?.drawing === true);
                const during = (await cards())[0];
                await shot("card-drawing");
                // your own ask answering is the drawer's too, but it is not the agent's request
                await putTurns(h, BOARD_ID, [done, requestTurn("t-ask-1", { kind: "ask", question: "why two stores?", state: "answering" })]);
                const asking = await until(async () => (await cards())[0]?.drawing === false);
                const own = (await cards())[0];
                // the request lands
                await putTurns(h, BOARD_ID, [done]);
                const settled = await until(async () => (await cards())[0]?.facts === "9 shapes");
                rec(
                    name,
                    drawing && during?.facts === "9 shapes · drawing…" && asking && own?.facts === "9 shapes" && settled,
                    { drawing, during: during?.facts, asking, own: own?.facts, settled }
                );
            });

            await run("7. Open on the card focuses the agent on the Agent surface and sets its board split", async (name) => {
                await closeSplit();
                const before = await state();
                const clicked = await AC.agentPage(
                    h,
                    `const open = ${LAYER}?.querySelector("[data-chat-board-open]");
                    if (!open) return false;
                    open.click();
                    return true;`
                );
                await until(async () => (await state()).split != null);
                const after = await state();
                await shot("card-opened");
                rec(
                    name,
                    clicked &&
                        before.split == null &&
                        after.focus === A &&
                        after.surface === "agent" &&
                        after.chat === "chat" &&
                        after.split?.project === PROJECT &&
                        after.split?.boardId === BOARD_ID &&
                        after.split?.expanded === false,
                    { clicked, before, after }
                );
            });

            await run("8. a question a board forwarded draws the chip over your words, with no marker line", async (name) => {
                // Chat alone again, and the three messages the agent's transcript gets: a forward with a selection, one without,
                // and a message of your own
                await closeSplit();
                append(
                    ctx,
                    AC.userText(FORWARD_ON, stamp(ctx)),
                    AC.assistantText("They hold different lifetimes.", stamp(ctx)),
                    AC.userText(FORWARD_OFF, stamp(ctx)),
                    AC.assistantText("That box is the store.", stamp(ctx)),
                    AC.userText("thanks", stamp(ctx)),
                    AC.assistantText("You're welcome.", stamp(ctx))
                );
                // each bubble of yours, with the chip right before it when it has one
                const bubbles = () =>
                    AC.agentPage(
                        h,
                        `return [...(${LAYER}?.querySelectorAll("[data-chat-you]") ?? [])].map((b) => ({
                            text: flat(b),
                            chip: b.previousElementSibling?.matches("[data-chat-board-chip]") ? flat(b.previousElementSibling) : null,
                        }));`
                    );
                const shown = await until(async () => (await bubbles()).some((b) => b.text.includes("thanks")));
                await scrollTo("[data-chat-board-chip]");
                await shot("chip");
                const all = await bubbles();
                const last3 = all.slice(-3);
                const layerText = await AC.agentPage(h, `return flat(${LAYER});`);
                rec(
                    name,
                    shown &&
                        last3.length === 3 &&
                        last3[0].text.includes("why two stores?") &&
                        last3[0].chip === "from wavesrv-startup · on wavesrv, SQLite" &&
                        last3[1].text.includes("what is this box?") &&
                        last3[1].chip === "from wavesrv-startup" &&
                        last3[2].text.includes("thanks") &&
                        last3[2].chip === null &&
                        // the marker line is in the transcript and nowhere on the page
                        !layerText.includes("[From board") &&
                        !last3.some((b) => b.text.includes("From board") || b.text.includes("turn t-fwd")),
                    { shown, last3, markerShown: layerText.includes("[From board") }
                );
            });

            return steps;
        },

        async teardown(h, ctx) {
            await (async () => {
                try {
                    await boardPage(
                        h,
                        `fx.smoke?.root.unmount();
                        fx.smoke?.host.remove();
                        return true;`
                    );
                } catch (e) {
                    console.error(`boards-chat teardown: unmounting the canvas failed: ${e?.message ?? e}`);
                }
            })();
            const step = async (what, fn) => {
                try {
                    await fn();
                } catch (e) {
                    console.error(`boards-chat teardown: ${what} failed: ${e?.message ?? e}`);
                }
            };
            await step("close the board splits", () =>
                AC.agentPage(
                    h,
                    `const S = await mod("app/view/boards/boardsplitstore.ts");
                    for (const id of ${JSON.stringify([ctx.agent?.tabId, ctx.other?.tabId].filter(Boolean))}) S.closeBoard(id);
                    const N = await mod("app/cockpit/notificationstore.ts");
                    globalStore.set(N.toastsAtom, []);
                    return true;`
                )
            );
            await step("restore the board commands", () => removeBoardStubs(h));
            await step("restore the roster", () => AC.restoreRoster(h));
            await step("close the fixture tabs", () => closeTabs(h, ctx));
            await step("remove the transcript", () => rmSync(ctx.dir, { recursive: true, force: true }));
            await step("restore the keys", () =>
                h.ev(`(() => {
                    for (const [k, v] of Object.entries(${JSON.stringify(ctx.prev ?? {})})) {
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
