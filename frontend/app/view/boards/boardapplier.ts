// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Lands the drawer's answers. The drawer's answer is element skeletons, and only Excalidraw turns those into
// elements, so wavesrv leaves each answer in the board's inbox and publishes board:update; this lands it, on the open
// canvas when the board shows (one undo step), else in the file under the rev it read, and acks it with the shape ids
// it added or changed. An answer that cannot land is acked with the error, which fails its turn: nothing changed.
// One answer per board is in flight at a time, oldest first.
//
// It also toasts a drawn turn the agent asked for (`wsh board draw`), unless the Agent surface shows that agent.

import { pushToast } from "@/app/cockpit/notificationstore";
import { globalStore } from "@/app/store/jotaiStore";
import { waveEventSubscribeSingle } from "@/app/store/wps";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { fireAndForget } from "@/util/util";
import type { Atom } from "jotai";
import type { SurfaceKey } from "../agents/agents";
import { BoardFileError, parseBoardFile, serializeBoard } from "./boardmodel";
import { openBoard, type BoardOpenModel } from "./boardsplitstore";
import { boardListAtom, boardTalkAtom, liveBoardApply, loadBoardConvert, onLiveBoardRegistered } from "./boardstore";
import { KIND_REQUEST, agentAlive } from "./boardtalkmodel";

const SAVE_TRIES = 3;
const ACK_TRIES = 3;
const ACK_RETRY_MS = 1000;

export type BoardApplierModel = BoardOpenModel & { surfaceAtom: Atom<SurfaceKey> };

function errorText(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

// read, land, save under the rev read; a save that lost to another writer re-reads and lands again
async function saveToFile(answer: BoardAnswer): Promise<string[]> {
    const ref = { project: answer.project, boardid: answer.boardid };
    // loaded on the first answer: the shell mounts this at boot, and Excalidraw's runtime is ~2 MB
    const { landAnswer } = await loadBoardConvert();
    for (let i = 0; i < SAVE_TRIES; i++) {
        const read = await RpcApi.BoardReadCommand(TabRpcClient, ref);
        if (read?.info?.loaderror) {
            throw new BoardFileError(`the board's file won't open: ${read.info.loaderror}`);
        }
        const { scene, shapeIds } = landAnswer(parseBoardFile(read.data), answer, Date.now());
        const saved = await RpcApi.BoardSaveCommand(TabRpcClient, {
            ...ref,
            data: serializeBoard(scene),
            baserev: read.rev,
        });
        if (!saved?.conflict) {
            return shapeIds;
        }
    }
    throw new Error(`the board changed under ${SAVE_TRIES} saves in a row`);
}

// the board's list entry, cached or read; undefined when the list can't be read
async function boardEntry(project: string, boardId: string): Promise<BoardInfo | undefined> {
    const find = (list: readonly BoardInfo[] | null | undefined) => list?.find((b) => b.id === boardId);
    const cached = find(globalStore.get(boardListAtom(project))) ?? find(globalStore.get(boardListAtom("")));
    if (cached != null) {
        return cached;
    }
    try {
        return find((await RpcApi.BoardListCommand(TabRpcClient, { project }))?.boards);
    } catch {
        return undefined;
    }
}

// a turn by id, from the talk already read or else from wavesrv; its kind never changes
async function findTurn(project: string, boardId: string, turnId: string): Promise<BoardTurn | undefined> {
    const find = (talk: BoardTalk | null | undefined) => talk?.turns?.find((t) => t.id === turnId);
    const cached = find(globalStore.get(boardTalkAtom(boardId)));
    if (cached != null) {
        return cached;
    }
    try {
        return find(await RpcApi.BoardTalkCommand(TabRpcClient, { project, boardid: boardId }));
    } catch {
        return undefined;
    }
}

// "+9 shapes, 2 changed, 1 removed", as `wsh board draw` tells the agent
function drewLine(turn: BoardTurn): string {
    const parts: string[] = [];
    if (turn.added) {
        parts.push(`+${turn.added} shape${turn.added === 1 ? "" : "s"}`);
    }
    if (turn.changed) {
        parts.push(`${turn.changed} changed`);
    }
    if (turn.removed) {
        parts.push(`${turn.removed} removed`);
    }
    return parts.join(", ") || turn.title || "";
}

export function startBoardApplier(model: BoardApplierModel): () => void {
    // an answer is taken once; one whose outcome could not be reported is let go, so the next inbox read retries it
    const taken = new Set<string>();
    const chains = new Map<string, Promise<void>>();
    // a turn's state is published more than once; each answered turn is toasted once
    const toasted = new Set<string>();
    let stopped = false;

    // Answers that are on their board whose ack did not get through. wavesrv holds the board busy until every answer
    // is acked, so the next read of the inbox acks these again without landing them a second time.
    const landed = new Map<string, string[]>();

    // true once the turn has its outcome told to wavesrv: the answer is on the board, or the turn is failed
    async function land(answer: BoardAnswer): Promise<boolean> {
        if (stopped) {
            return false;
        }
        const ack: CommandBoardAnswerAckData = {
            project: answer.project,
            boardid: answer.boardid,
            answerid: answer.id,
            turnid: answer.turnid,
        };
        const already = landed.get(answer.id);
        if (already != null) {
            ack.shapeids = already;
        } else {
            try {
                const live = liveBoardApply(answer.boardid);
                ack.shapeids = live != null ? await live(answer) : await saveToFile(answer);
            } catch (e) {
                console.warn("boards: an answer could not land; failing its turn", answer.boardid, answer.id, e);
                ack.error = errorText(e);
            }
        }
        for (let i = 0; i < ACK_TRIES && !stopped; i++) {
            try {
                await RpcApi.BoardAnswerAckCommand(TabRpcClient, ack);
                landed.delete(answer.id);
                return true;
            } catch (e) {
                console.warn("boards: acking an answer failed", answer.boardid, answer.id, e);
                if (i < ACK_TRIES - 1) {
                    await new Promise((resolve) => setTimeout(resolve, ACK_RETRY_MS));
                }
            }
        }
        if (ack.error == null) {
            landed.set(answer.id, ack.shapeids ?? []);
        }
        return false;
    }

    function take(answer: BoardAnswer): void {
        if (stopped || taken.has(answer.id)) {
            return;
        }
        taken.add(answer.id);
        const prev = chains.get(answer.boardid) ?? Promise.resolve();
        chains.set(
            answer.boardid,
            prev.then(async () => {
                if (!(await land(answer))) {
                    taken.delete(answer.id);
                }
            })
        );
    }

    function readInbox(ref: CommandBoardRefData): void {
        RpcApi.BoardAnswerInboxCommand(TabRpcClient, ref)
            .then((answers) => [...(answers ?? [])].sort((a, b) => a.ts - b.ts).forEach((answer) => take(answer)))
            .catch((e) => console.warn("boards: reading the answer inbox failed", ref, e));
    }

    // an answer wavesrv delivered while the app was away: only a board with a turn answering can hold one
    async function sweep(): Promise<void> {
        try {
            const rtn = await RpcApi.BoardListCommand(TabRpcClient, { project: "" });
            for (const b of rtn?.boards ?? []) {
                if (b.state === "answering") {
                    readInbox({ project: b.project, boardid: b.id });
                }
            }
        } catch (e) {
            console.warn("boards: listing the boards to find waiting answers failed", e);
        }
    }

    // the agent is in front of you when the Agent surface shows it focused: its Chat says what the toast would
    function inView(agentTabId: string | undefined): boolean {
        return (
            agentTabId != null &&
            globalStore.get(model.surfaceAtom) === "agent" &&
            globalStore.get(model.focusIdAtom) === agentTabId
        );
    }

    async function toastRequest(data: BoardUpdateData): Promise<void> {
        const turn = await findTurn(data.project, data.boardid ?? "", data.turnid ?? "");
        if (turn?.kind !== KIND_REQUEST) {
            return;
        }
        const board = await boardEntry(data.project, data.boardid ?? "");
        if (inView(board?.agenttabid)) {
            return;
        }
        // a toast still names something when the list can't be read
        const name = board?.name || `board ${data.boardid}`;
        const tabId = board?.agenttabid;
        // Open splits the agent's cell, so it is offered only while the agent's tab is there
        const action =
            board != null && tabId != null && agentAlive(tabId, globalStore.get(model.agentsAtom))
                ? { label: "Open", run: () => openBoard(model, tabId, board.project, board.id) }
                : undefined;
        pushToast({ title: `The drawer drew on ${name}`, message: drewLine(turn), level: "info", action });
    }

    function onTalk(data: BoardUpdateData): void {
        if (!data.boardid || !data.turnid) {
            return;
        }
        const key = `${data.boardid}:${data.turnid}`;
        if (data.state !== "answered") {
            // the turn runs again (Retry), so its next answer toasts again
            toasted.delete(key);
            return;
        }
        if (toasted.has(key)) {
            return;
        }
        toasted.add(key);
        fireAndForget(() => toastRequest(data));
    }

    const unsubscribe = waveEventSubscribeSingle({
        eventType: "board:update",
        handler: (event) => {
            const data = event.data as BoardUpdateData | undefined;
            if (stopped || data == null) {
                return;
            }
            if (data.what === "answer" && data.boardid) {
                readInbox({ project: data.project, boardid: data.boardid });
            } else if (data.what === "talk") {
                onTalk(data);
            }
        },
    });
    const unlisten = onLiveBoardRegistered((project, boardid) => readInbox({ project, boardid }));
    fireAndForget(sweep);
    return () => {
        stopped = true;
        unsubscribe();
        unlisten();
    };
}
