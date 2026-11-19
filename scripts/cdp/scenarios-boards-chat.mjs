// Scenario `boards-chat`: a board in the agent's Chat, and the toast when the drawer draws for an agent you are not
// looking at (docs/superpowers/specs/2026-11-19-kael-boards-design.md, plan 2026-11-19-kael-boards.md Tasks 6 and 8).
//
// Two fixture claude agents over real tabs (no controller, so nothing runs) and a mock roster for them. The board
// commands are stubbed in the page (boards-fixtures.mjs): no real drawer runs, and wavesrv holds no board. A drawer's
// answer is put in the fixture inbox and announced with board:update, so the real applier lands it through the real
// Excalidraw (convertToExcalidrawElements) into the fixture file and acks it; the stubbed ack marks the turn answered and
// publishes the update, as wavesrv does. The step list is open for the Chat card and chip steps (Task 8).

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
} from "./boards-fixtures.mjs";

const NAME = "boards-chat";
const PROJECT = "boards-chat-fx";
const BOARD_ID = "b0a4d001";
const BOARD_NAME = "wavesrv-startup";
const AGENT_TITLE = `claude · ${PROJECT}`;
const WAIT_MS = 15000;
const TOAST = "[data-notification-toast]";
const TOAST_ACTION = "[data-notification-action]";

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
        }));

    const scenario = {
        name: NAME,
        surface: "agent",

        async arrange(h) {
            const ctx = { prev: {} };
            let at = "reading the keys";
            try {
                for (const k of LS_KEYS) ctx.prev[k] = await h.ev(`localStorage.getItem(${JSON.stringify(k)})`);
                at = "resetting the grid";
                await h.ev(`localStorage.setItem(${JSON.stringify(GRID_KEY)}, ${JSON.stringify(JSON.stringify(GRID_EMPTY))})`);
                await h.ev(`localStorage.removeItem("agent.chatmode")`);
                if (!(await ahReload(h))) throw new Error("the page did not come back after the reload");
                await h.goto("agent");

                at = "making the tabs";
                ctx.agent = await makeTab(h, ctx, { label: PROJECT, blockMeta: { view: "term" } });
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
