// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Boards' state, kept at module level because every surface but Agent unmounts on a switch: each project's board
// list (project "" = every project), each board's talk and viewport, and the open canvases that take the drawer's
// answers live. A board:update event reloads whatever has been read. Three more per-board atoms are in memory only and
// shared by every view of the board (the cell, Library): boardEditingAtom, the Edit switch (a board opens in view mode);
// boardDrawingsAtom, the drawings row and the drawing in view that the open canvas publishes; boardPickAtom, a pick in
// that row that the canvas eases to.

import { globalStore } from "@/app/store/jotaiStore";
import { waveEventSubscribeSingle } from "@/app/store/wps";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { atom, useAtomValue, type PrimitiveAtom } from "jotai";
import { atomFamily, atomWithStorage } from "jotai/utils";
import { useEffect } from "react";
import type { BoardDrawings } from "./boarddrawings";

export interface BoardViewport {
    scrollX: number;
    scrollY: number;
    zoom: number;
    // the newest drawing is the one in view, so a new one is fitted as it lands
    following?: boolean;
}

// null = not read yet
export const boardListAtom = atomFamily(
    (_project: string) => atom<BoardInfo[] | null>(null) as PrimitiveAtom<BoardInfo[] | null>
);
export const boardTalkAtom = atomFamily(
    (_boardId: string) => atom<BoardTalk | null>(null) as PrimitiveAtom<BoardTalk | null>
);
// where the open canvas was looking, so a board closed and opened again (or expanded) shows the same place
export const boardViewportAtom = atomFamily(
    (_boardId: string) => atom<BoardViewport | null>(null) as PrimitiveAtom<BoardViewport | null>
);

// The three below are per board and in memory only: the strip, the board cell and Library read and write the same state
// without plumbing callbacks through the canvas.
// The Edit switch: a board opens in view mode, and every view of it (the cell, Library) shares this one.
export const boardEditingAtom = atomFamily((_boardId: string) => atom(false) as PrimitiveAtom<boolean>);
// What the open canvas publishes for the drawings row and the ask; null until a canvas of the board has loaded.
export const boardDrawingsAtom = atomFamily(
    (_boardId: string) => atom<BoardDrawings | null>(null) as PrimitiveAtom<BoardDrawings | null>
);
// A pick in the drawings row, which the canvas eases to; a new value (a new ts) applies again, so picking the drawing
// already picked fits it again after the view moved off.
export interface BoardPick {
    drawingId: string;
    ts: number;
}
export const boardPickAtom = atomFamily(
    (_boardId: string) => atom<BoardPick | null>(null) as PrimitiveAtom<BoardPick | null>
);
// A press of the strip's Tidy on the drawing in view, which the canvas lays out again (boardlayout.ts); each press is a
// new value, so a second press tidies again.
export const boardTidyAtom = atomFamily(
    (_boardId: string) => atom<BoardPick | null>(null) as PrimitiveAtom<BoardPick | null>
);

// every board's canvas theme, the person's pick on the canvas's sun/moon: the app is dark, the board may be light (for
// a drawing made to be pasted into a paper or slides). Excalidraw draws the dark theme by inverting the canvas.
export type BoardTheme = "dark" | "light";
export const boardThemeAtom = atomWithStorage<BoardTheme>("boards.theme", "dark");

// an update event can start a read while an earlier one is in flight; only the latest may land
const listSeq = new Map<string, number>();
const talkSeq = new Map<string, number>();
// what has been read, so an event reloads it; a talk remembers its project for the reload
const loadedLists = new Set<string>();
const loadedTalks = new Map<string, string>();

function nextSeq(seqs: Map<string, number>, key: string): () => boolean {
    const seq = (seqs.get(key) ?? 0) + 1;
    seqs.set(key, seq);
    return () => seqs.get(key) === seq;
}

// a read that fails is forgotten, so the next hook to ask for it tries again
export async function loadBoardList(project: string): Promise<BoardInfo[]> {
    loadedLists.add(project);
    const latest = nextSeq(listSeq, project);
    let rtn: BoardListRtnData;
    try {
        rtn = await RpcApi.BoardListCommand(TabRpcClient, { project });
    } catch (e) {
        loadedLists.delete(project);
        throw e;
    }
    const boards = rtn?.boards ?? [];
    if (latest()) {
        globalStore.set(boardListAtom(project), boards);
    }
    return boards;
}

export async function loadBoardTalk(project: string, boardId: string): Promise<BoardTalk> {
    loadedTalks.set(boardId, project);
    const latest = nextSeq(talkSeq, boardId);
    let rtn: BoardTalk;
    try {
        rtn = await RpcApi.BoardTalkCommand(TabRpcClient, { project, boardid: boardId });
    } catch (e) {
        loadedTalks.delete(boardId);
        throw e;
    }
    const talk: BoardTalk = {
        project,
        boardid: boardId,
        sessionid: rtn?.sessionid,
        contexttokens: rtn?.contexttokens,
        agent: rtn?.agent,
        turns: rtn?.turns ?? [],
    };
    if (latest()) {
        globalStore.set(boardTalkAtom(boardId), talk);
    }
    return talk;
}

// a turn's state and an answer change the list's facts (shapes, turns, the switcher) as well as the talk
const RELOAD_EVENTS = new Set(["list", "talk", "answer"]);

function reload(what: string, load: () => Promise<unknown>): void {
    load().catch((e) => console.warn(`boards: reloading the ${what} after board:update failed`, e));
}

export function onBoardUpdate(data: BoardUpdateData | undefined): void {
    if (data == null || !RELOAD_EVENTS.has(data.what)) {
        return;
    }
    // a project's list, and the every-project list, both hold its boards
    for (const project of new Set([data.project, ""])) {
        if (loadedLists.has(project)) {
            reload("list", () => loadBoardList(project));
        }
    }
    if (data.boardid && loadedTalks.has(data.boardid)) {
        const project = loadedTalks.get(data.boardid) ?? data.project;
        reload("talk", () => loadBoardTalk(project, data.boardid));
    }
}

let watching = false;

// one subscription for the app's lifetime, started by the first hook that reads a list or a talk, or by Chat's first read
// of the boards a `board:` badge or the `@` picker names (refmentionstore.ts)
export function watchBoardUpdates(): void {
    if (watching) {
        return;
    }
    watching = true;
    waveEventSubscribeSingle({
        eventType: "board:update",
        handler: (event) => onBoardUpdate(event.data as BoardUpdateData | undefined),
    });
}

// the project's boards (project "" = every project's), read once and kept current; null until first read
export function useBoardList(project: string): BoardInfo[] | null {
    useEffect(() => {
        watchBoardUpdates();
        if (!loadedLists.has(project)) {
            reload("list", () => loadBoardList(project));
        }
    }, [project]);
    return useAtomValue(boardListAtom(project));
}

// one board's talk, read once and kept current; null until first read
export function useBoardTalk(project: string, boardId: string): BoardTalk | null {
    useEffect(() => {
        watchBoardUpdates();
        if (loadedTalks.get(boardId) !== project) {
            reload("talk", () => loadBoardTalk(project, boardId));
        }
    }, [project, boardId]);
    return useAtomValue(boardTalkAtom(boardId));
}

// the boards tied to one agent (its tab), in the list's order, most recently active first
export function boardsOfAgent(list: readonly BoardInfo[] | null | undefined, agentTabId: string): BoardInfo[] {
    return (list ?? []).filter((b) => b.agenttabid === agentTabId);
}

// a board by name, as `wsh board draw --board` finds it: trimmed, any case, the most recently active of several
export function findBoardByName(list: readonly BoardInfo[] | null | undefined, name: string): BoardInfo | undefined {
    const want = name.trim().toLowerCase();
    if (want === "") {
        return undefined;
    }
    return (list ?? [])
        .filter((b) => b.name.trim().toLowerCase() === want)
        .reduce<BoardInfo | undefined>((best, b) => (best == null || b.activets > best.activets ? b : best), undefined);
}

// --- the Excalidraw runtime

// Excalidraw fetches its fonts from window.EXCALIDRAW_ASSET_PATH, else from esm.sh, which the app's CSP refuses and
// offline cannot reach: the build serves them at /excalidraw/fonts/ (frontend/tauri/vite.config.ts). Set before the
// runtime loads, by everything that loads it.
export function pointExcalidrawAtLocalFonts(): void {
    if (typeof window !== "undefined") {
        (window as Window & { EXCALIDRAW_ASSET_PATH?: string }).EXCALIDRAW_ASSET_PATH = "/excalidraw/";
    }
}

// boardconvert.ts is the one module that holds the Excalidraw runtime (~2 MB), so it loads on the first answer or the
// first canvas, once. A load that failed is forgotten, so the next caller tries again.
let convertModule: Promise<typeof import("./boardconvert")> | undefined;

export function loadBoardConvert(): Promise<typeof import("./boardconvert")> {
    pointExcalidrawAtLocalFonts();
    convertModule ??= import("./boardconvert").catch((e) => {
        convertModule = undefined;
        throw e;
    });
    return convertModule;
}

// --- the open canvas

// lands an answer on the open canvas and returns the shape ids it added or changed
export type LiveBoardApply = (answer: BoardAnswer) => Promise<string[]>;

// a stack per board: one board can be mounted twice (the split and Library), the newest applies answers, and when it
// goes the one before takes them again
const liveBoards = new Map<string, LiveBoardApply[]>();
const registeredListeners = new Set<(project: string, boardId: string) => void>();

// the open canvas takes answers itself (updateScene), so a hand edit is never overwritten by a stale-rev save.
// listeners hear every open, so a board's waiting answers land when it opens (a first open, a re-open, a Retry).
export function registerLiveBoard(project: string, boardId: string, apply: LiveBoardApply): () => void {
    liveBoards.set(boardId, [...(liveBoards.get(boardId) ?? []), apply]);
    registeredListeners.forEach((fn) => fn(project, boardId));
    return () => {
        const rest = (liveBoards.get(boardId) ?? []).filter((fn) => fn !== apply);
        if (rest.length > 0) {
            liveBoards.set(boardId, rest);
        } else {
            liveBoards.delete(boardId);
        }
    };
}

export function liveBoardApply(boardId: string): LiveBoardApply | undefined {
    return liveBoards.get(boardId)?.at(-1);
}

export function onLiveBoardRegistered(fn: (project: string, boardId: string) => void): () => void {
    registeredListeners.add(fn);
    return () => {
        registeredListeners.delete(fn);
    };
}
