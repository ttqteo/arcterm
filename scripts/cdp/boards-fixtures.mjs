// Page-side stand-ins for the board commands, shared by the boards scenarios (scenarios-boards-split.mjs, -chat.mjs,
// -library.mjs). Final must never start a real drawer, so the page's RpcApi.Board* methods are replaced here: a board is
// a fixture in the page (its info, its talk, its file with a rev, its answer inbox), the commands read and write that,
// and every call is recorded. A fixture reaches the page's own board:update handlers through feedBoardUpdate, so the
// real applier lands a fed answer (in the open canvas, or in the fixture file through BoardReadCommand and
// BoardSaveCommand) and the real stores reload.
//
//   installBoardStubs / removeBoardStubs   replace / restore the commands (removing deletes the page's fixture state)
//   putBoard      one fixture board: its info, its talk (agent and turns) and its drawing, at rev rev-0
//   putTurns      replace a board's turns (the talk the page reads) and tell the page
//   putAnswer     leave an answer in a board's inbox, as wavesrv does for a drawer's reply
//   feedBoardUpdate  publish a board:update event to the page's handlers
//   boardCalls    the recorded calls of one command, in order
//   boardFile     a board's fixture file as the page holds it: its rev and its parsed elements
//   boardPage     a page-side function body with the app's modules and the fixture state (see below)
//   rectElement   an Excalidraw rectangle element for a fixture drawing
//
// The stubs behave as wavesrv does where a scenario needs it: BoardAnswerAckCommand marks the turn answered (or failed,
// with the error) and publishes talk and list updates; BoardAskCommand adds an answering turn; BoardAskStopCommand stops
// it; BoardAskRetryCommand runs it again; BoardRerouteCommand is only recorded. BoardSaveCommand is rev-guarded.

import { agentPage } from "./agent-page-fixtures.mjs";

export const BOARD_COMMANDS = [
    "BoardListCommand",
    "BoardReadCommand",
    "BoardSaveCommand",
    "BoardTalkCommand",
    "BoardAskCommand",
    "BoardAskStopCommand",
    "BoardAskRetryCommand",
    "BoardRerouteCommand",
    "BoardAnswerInboxCommand",
    "BoardAnswerAckCommand",
];

const q = JSON.stringify;

const FX = `
    const fx = (window.__boardsFx ??= { boards: {}, talks: {}, files: {}, inbox: {}, calls: {}, revs: 0, asked: 0 });
    const { RpcApi } = await mod("app/store/wshclientapi.ts");
    const feed = async (data) => (await mod("app/store/wps.ts")).handleWaveEvent({ event: "board:update", data });
    const record = (name, data) => (fx.calls[name] ??= []).push(structuredClone(data));
`;
const page = (h, body) => agentPage(h, `${FX} ${body}`);

// an async function's body run in the page with the app's modules (`mod`, `globalStore`, `agentsModel`) and the fixture
// state: `fx`, `RpcApi`, `feed(boardUpdateData)` and `record(name, data)`
export const boardPage = page;

export const installBoardStubs = (h) =>
    page(
        h,
        `// every resource the page fetches from now on, for a step that reads where the fonts came from: the page's own
        // timing buffer is full of the dev server's modules, and a canvas drawn before that step (the split beside Chat)
        // fetches them first
        if (fx.observer == null) {
            fx.resources = [];
            fx.observer = new PerformanceObserver((list) => fx.resources.push(...list.getEntries().map((e) => e.name)));
            fx.observer.observe({ type: "resource" });
        }
        const shapeCount = (data) => {
            try {
                return (JSON.parse(data).elements ?? []).filter((e) => !e.isDeleted && !(e.type === "text" && e.containerId != null)).length;
            } catch {
                return 0;
            }
        };
        const talkOf = (b) => fx.talks[b.id] ?? { project: b.project, boardid: b.id, turns: [] };
        // BoardInfo as wavesrv derives it from the talk and the file
        const infoOf = (b) => {
            const talk = talkOf(b);
            const turns = talk.turns;
            const last = turns.at(-1);
            const drawn = turns.filter((t) => t.state === "answered" && (t.added ?? 0) + (t.changed ?? 0) + (t.removed ?? 0) > 0);
            const drawnts = Math.max(0, ...drawn.map((t) => t.answeredts ?? 0));
            return {
                ...b,
                turns: turns.length,
                shapes: shapeCount(fx.files[b.id].data),
                drawnts: drawnts || undefined,
                activets: Math.max(b.createdts, ...turns.map((t) => Math.max(t.ts, t.answeredts ?? 0))),
                state: last?.state === "answering" || last?.state === "waiting" ? "answering" : last?.state === "failed" ? "failed" : undefined,
                agenttabid: talk.agent?.tabid,
                agenttitle: talk.agent?.title,
            };
        };
        const turnById = (boardId, turnId) => fx.talks[boardId]?.turns.find((t) => t.id === turnId);
        const talkChanged = async (boardId, turn) => {
            const b = fx.boards[boardId];
            await feed({ project: b.project, boardid: boardId, what: "talk", turnid: turn?.id, state: turn?.state });
            await feed({ project: b.project, boardid: boardId, what: "list" });
        };
        RpcApi.BoardListCommand = async (_c, d) => {
            const boards = Object.values(fx.boards).filter((b) => !d.project || b.project === d.project).map(infoOf);
            boards.sort((a, b) => b.activets - a.activets);
            return structuredClone({ boards });
        };
        RpcApi.BoardTalkCommand = async (_c, d) => structuredClone(talkOf(fx.boards[d.boardid] ?? { id: d.boardid, project: d.project }));
        RpcApi.BoardReadCommand = async (_c, d) => {
            record("BoardReadCommand", d);
            const file = fx.files[d.boardid];
            if (file == null) throw new Error("no such board " + d.boardid);
            return { info: structuredClone(infoOf(fx.boards[d.boardid])), data: file.data, rev: file.rev };
        };
        RpcApi.BoardSaveCommand = async (_c, d) => {
            record("BoardSaveCommand", d);
            const file = fx.files[d.boardid];
            if (d.baserev !== file.rev) return { conflict: true };
            file.data = d.data;
            file.rev = "rev-" + ++fx.revs;
            return { rev: file.rev };
        };
        RpcApi.BoardAnswerInboxCommand = async (_c, d) => structuredClone(fx.inbox[d.boardid] ?? []);
        RpcApi.BoardAnswerAckCommand = async (_c, d) => {
            record("BoardAnswerAckCommand", d);
            fx.inbox[d.boardid] = (fx.inbox[d.boardid] ?? []).filter((a) => a.id !== d.answerid);
            const turn = turnById(d.boardid, d.turnid);
            if (turn != null) {
                if (d.error) {
                    Object.assign(turn, { state: "failed", reason: d.error, answeredts: Date.now() });
                } else {
                    Object.assign(turn, { state: "answered", shapeids: d.shapeids ?? [], added: (d.shapeids ?? []).length, answeredts: Date.now() });
                }
            }
            await talkChanged(d.boardid, turn);
        };
        RpcApi.BoardAskCommand = async (_c, d) => {
            record("BoardAskCommand", d);
            const turn = {
                id: "asked-" + ++fx.asked, ts: Date.now(), kind: "ask", question: d.question, on: d.on,
                selectedids: d.selectedids, state: "answering", startedts: Date.now(),
            };
            (fx.talks[d.boardid] ??= talkOf(fx.boards[d.boardid])).turns.push(turn);
            await talkChanged(d.boardid, turn);
        };
        RpcApi.BoardAskStopCommand = async (_c, d) => {
            record("BoardAskStopCommand", d);
            const turn = fx.talks[d.boardid]?.turns.find((t) => t.state === "answering");
            if (turn != null) turn.state = "stopped";
            await talkChanged(d.boardid, turn);
        };
        RpcApi.BoardAskRetryCommand = async (_c, d) => {
            record("BoardAskRetryCommand", d);
            const turn = turnById(d.boardid, d.turnid);
            if (turn != null) Object.assign(turn, { state: "answering", startedts: Date.now(), reason: undefined });
            await talkChanged(d.boardid, turn);
        };
        RpcApi.BoardRerouteCommand = async (_c, d) => {
            record("BoardRerouteCommand", d);
        };
        return true;`
    );

// the commands go back to the generated client's own, and the fixture state goes
export const removeBoardStubs = (h) =>
    page(
        h,
        `for (const name of ${q(BOARD_COMMANDS)}) delete RpcApi[name];
        fx.observer?.disconnect();
        delete window.__boardsFx;
        return true;`
    );

// An Excalidraw rectangle as a fixture drawing holds it. `label` is not part of an element: the drawer's skeletons carry
// one, a fixture file holds the box and its bound text apart (see boxElements).
export function rectElement(id, x, y, width, height, extra = {}) {
    return {
        id,
        type: "rectangle",
        x,
        y,
        width,
        height,
        strokeColor: "#1e1e1e",
        backgroundColor: "transparent",
        fillStyle: "solid",
        strokeWidth: 2,
        strokeStyle: "solid",
        roundness: null,
        roughness: 1,
        opacity: 100,
        angle: 0,
        seed: 1,
        version: 1,
        versionNonce: 1,
        index: null,
        isDeleted: false,
        groupIds: [],
        frameId: null,
        boundElements: null,
        updated: 1,
        link: null,
        locked: false,
        ...extra,
    };
}

// a labelled box as Excalidraw stores it: the rectangle and its bound text, linked both ways. fontFamily 5 is
// Excalifont, which Excalidraw carries inside its bundle; another (6 Nunito, 8 Comic Shanns) is fetched from the fonts url.
export function boxElements(id, x, y, label, fontFamily = 5) {
    const w = 180;
    const h = 70;
    return [
        rectElement(id, x, y, w, h, { boundElements: [{ type: "text", id: `${id}-label` }] }),
        {
            ...rectElement(`${id}-label`, x + 40, y + 22, w - 80, 25),
            type: "text",
            text: label,
            originalText: label,
            fontSize: 20,
            fontFamily,
            textAlign: "center",
            verticalAlign: "middle",
            containerId: id,
            autoResize: true,
            lineHeight: 1.25,
        },
    ];
}

// One fixture board. `agent` is the tab the board is tied to ({ tabid, title }), `turns` its talk, `elements` its drawing.
export const putBoard = (h, { id, name, project, agent, turns = [], elements = [], createdts = Date.now() - 3_600_000 }) =>
    page(
        h,
        `fx.boards[${q(id)}] = { id: ${q(id)}, name: ${q(name)}, project: ${q(project)}, path: "/fixture/" + ${q(id)} + ".excalidraw", createdts: ${createdts} };
        fx.talks[${q(id)}] = { project: ${q(project)}, boardid: ${q(id)}, agent: ${q(agent)}, turns: ${q(turns)} };
        fx.files[${q(id)}] = {
            rev: "rev-0",
            data: JSON.stringify({ arc: { name: ${q(name)}, createdts: ${createdts} }, type: "excalidraw", version: 2, source: "arc",
                elements: ${q(elements)}, appState: {}, files: {} }),
        };
        fx.inbox[${q(id)}] = [];
        await feed({ project: ${q(project)}, boardid: ${q(id)}, what: "list" });
        return true;`
    );

// replace a board's turns, and tell the page its talk changed
export const putTurns = (h, boardId, turns) =>
    page(
        h,
        `fx.talks[${q(boardId)}].turns = ${q(turns)};
        const b = fx.boards[${q(boardId)}];
        await feed({ project: b.project, boardid: ${q(boardId)}, what: "talk" });
        await feed({ project: b.project, boardid: ${q(boardId)}, what: "list" });
        return true;`
    );

export const putAnswer = (h, boardId, answer) =>
    page(
        h,
        `const b = fx.boards[${q(boardId)}];
        (fx.inbox[${q(boardId)}] ??= []).push({ project: b.project, boardid: ${q(boardId)}, ts: Date.now(), ...${q(answer)} });
        return true;`
    );

export const feedBoardUpdate = (h, data) => page(h, `await feed(${q(data)}); return true;`);

export const boardCalls = (h, name) => page(h, `return structuredClone(fx.calls[${q(name)}] ?? []);`);

export const boardFile = (h, boardId) =>
    page(
        h,
        `const file = fx.files[${q(boardId)}];
        return file == null ? null : { rev: file.rev, elements: JSON.parse(file.data).elements };`
    );
