// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure: what the canvas pane derives from a design-local folder, its server, and the agent's canvas state.

import type { CanvasState } from "./canvasstore";

export const CANVAS_POLL_MS = 3000;
export const DEFAULT_BOARD_W = 1440;
export const DEFAULT_BOARD_H = 900;
// the skill's gap between frames in a row, used to place a board canvas.json gives no position
const BOARD_GAP = 80;

const BOARD_EXT = ".dc.html";
// the All tab's key: never a board name, which always ends in .dc.html
export const ALL_TAB = "all";
const MAIN_BOARD = "Main.dc.html";

// x/y/w/h are the board's frame on the canvas, in CSS px, as canvas.json lays it out
export type CanvasBoard = { name: string; x: number; y: number; w: number; h: number; title?: string };

const MAIN_FALLBACK: CanvasBoard = { name: MAIN_BOARD, x: 0, y: 0, w: DEFAULT_BOARD_W, h: DEFAULT_BOARD_H };

function isRecord(v: unknown): v is Record<string, unknown> {
    return v != null && typeof v === "object" && !Array.isArray(v);
}

function finite(entry: unknown, key: string): number | undefined {
    const v = isRecord(entry) ? entry[key] : undefined;
    return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function boardSide(entry: unknown, side: "w" | "h"): number | undefined {
    const v = finite(entry, side);
    return v != null && v > 0 ? v : undefined;
}

// a board with no position goes to the right of everything placed before it
function placeBoards(entries: { name: string; entry: unknown }[]): CanvasBoard[] {
    const boards: CanvasBoard[] = [];
    for (const { name, entry } of entries) {
        const x = finite(entry, "x");
        const y = finite(entry, "y");
        const right = boards.reduce((m, b) => Math.max(m, b.x + b.w + BOARD_GAP), 0);
        const title = isRecord(entry) && typeof entry.title === "string" && entry.title ? entry.title : undefined;
        boards.push({
            name,
            x: x != null && y != null ? x : right,
            y: x != null && y != null ? y : 0,
            w: boardSide(entry, "w") ?? DEFAULT_BOARD_W,
            h: boardSide(entry, "h") ?? DEFAULT_BOARD_H,
            ...(title != null ? { title } : {}),
        });
    }
    return boards;
}

// canvas.json is written by the design-local skill, not by arcterm, so anything malformed reads as the one board
// every canvas has rather than as an error
export function boardsFromCanvasJson(json: unknown): CanvasBoard[] {
    const fallback = [MAIN_FALLBACK];
    if (!isRecord(json) || !isRecord(json.boards)) {
        return fallback;
    }
    const boards = json.boards;
    const known = (n: unknown): n is string => typeof n === "string" && n.endsWith(BOARD_EXT) && n in boards;
    let names = Array.isArray(json.order) ? json.order.filter(known) : [];
    if (names.length === 0) {
        names = Object.keys(boards).filter(known);
        names.sort((a, b) => Number(b === MAIN_BOARD) - Number(a === MAIN_BOARD));
    }
    if (names.length === 0) {
        return fallback;
    }
    return placeBoards(names.map((name) => ({ name, entry: boards[name] })));
}

// the selected board: the one marks, Open in browser and the tabs act on. A name that isn't in the list (a
// stale pick, or boards not polled yet) selects the first one
export function shownBoard(s: CanvasState): CanvasBoard {
    return s.boards.find((b) => b.name === s.board) ?? s.boards[0] ?? MAIN_FALLBACK;
}

// the header's tabs: All first, and only when there is more than one board to lay side by side
export function canvasTabs(boards: CanvasBoard[]): string[] {
    const names = boards.map((b) => b.name);
    return names.length > 1 ? [ALL_TAB, ...names] : names;
}

export function currentTab(s: CanvasState): string {
    return s.all && s.boards.length > 1 ? ALL_TAB : shownBoard(s).name;
}

// the boards on screen, and the ones Build this… builds: every board under All, else the selected one
export function shownBoards(s: CanvasState): CanvasBoard[] {
    return s.all && s.boards.length > 1 ? s.boards : [shownBoard(s)];
}

export type BoardFrame = { board: CanvasBoard; left: number; top: number; width: number; height: number };
export type CanvasLayout = { scale: number; width: number; height: number; frames: BoardFrame[] };

// Every board at its canvas.json frame, shifted so the top-left board sits at the origin and shrunk (never
// grown) so the widest row fits the pane. Sizes are screen px.
export function canvasLayout(boards: CanvasBoard[], paneWidth: number): CanvasLayout {
    const all = boards.length > 0 ? boards : [MAIN_FALLBACK];
    const minX = Math.min(...all.map((b) => b.x));
    const minY = Math.min(...all.map((b) => b.y));
    const spanW = Math.max(...all.map((b) => b.x + b.w)) - minX;
    const spanH = Math.max(...all.map((b) => b.y + b.h)) - minY;
    const scale = fitScale(paneWidth, spanW);
    return {
        scale,
        width: spanW * scale,
        height: spanH * scale,
        frames: all.map((board) => ({
            board,
            left: (board.x - minX) * scale,
            top: (board.y - minY) * scale,
            width: board.w * scale,
            height: board.h * scale,
        })),
    };
}

export function boardLabel(name: string): string {
    return name.endsWith(BOARD_EXT) ? name.slice(0, -BOARD_EXT.length) : name;
}

export function stepTab(tabs: string[], current: string | null, delta: number): string | null {
    const n = tabs.length;
    if (n === 0) {
        return null;
    }
    const at = Math.max(0, tabs.indexOf(current));
    return tabs[(((at + delta) % n) + n) % n];
}

export function paneState(s: CanvasState): "board" | "probing" | "server-down" | "removed" {
    switch (s.status) {
        case "removed":
            return "removed";
        case "server-down":
            return "server-down";
        case "probing":
            return "probing";
        default:
            return "board";
    }
}

export function isUnseen(s: CanvasState): boolean {
    return s.mode === "terminal" && s.lastModifiedMs != null && s.lastModifiedMs > s.lastViewedMs;
}

export function updatedAgo(nowMs: number, ms: number | null): string {
    if (ms == null) {
        return "";
    }
    const secs = Math.max(0, Math.floor((nowMs - ms) / 1000));
    if (secs < 60) {
        return `updated ${secs}s ago`;
    }
    if (secs < 3600) {
        return `updated ${Math.floor(secs / 60)}m ago`;
    }
    return `updated ${Math.floor(secs / 3600)}h ago`;
}

export function fitScale(paneWidth: number, boardWidth: number): number {
    if (paneWidth <= 0 || boardWidth <= 0) {
        return 1;
    }
    return Math.min(1, paneWidth / boardWidth);
}

// base is where wavesrv serves the project's design folder (CanvasServeCommand)
export function boardUrl(base: string, topic: string, board: string): string {
    return `${base}/${encodeURIComponent(topic)}/project/${encodeURIComponent(board)}`;
}

function sepOf(path: string): string {
    return path.includes("\\") ? "\\" : "/";
}

function join(base: string, ...parts: string[]): string {
    const sep = sepOf(base);
    return [base.replace(/[\\/]+$/, ""), ...parts].join(sep);
}

// the folder wavesrv serves a project's canvases from
export function canvasDesignDir(cwd: string): string {
    return join(cwd, ".superpowers", "design");
}

export function canvasDir(cwd: string, topic: string): string {
    return join(canvasDesignDir(cwd), topic);
}

export function canvasProjectDir(dir: string): string {
    return join(dir, "project");
}

export function canvasFeedbackDir(dir: string): string {
    return join(dir, "feedback");
}

export function canvasFeedbackFile(dir: string, name: string): string {
    return join(canvasFeedbackDir(dir), name);
}

export function buildGoal(dir: string, boards: CanvasBoard[]): string {
    return `Build the design in ${canvasProjectDir(dir)} (boards: ${boards.map((b) => boardLabel(b.name)).join(", ")})`;
}

// absolute, because a run's worktree has no copy of the gitignored design folder
export function prototypePath(dir: string, boards: CanvasBoard[]): string {
    return join(dir, "project", boards[0]?.name ?? MAIN_BOARD);
}

const BOARD_PATH = /^(.+?)[\\/]\.superpowers[\\/]design[\\/]([^\\/]+)[\\/]project[\\/]([^\\/]+\.dc\.html)$/i;

// the inverse of prototypePath: a lead names the mockup that settles its design by this path
export function parseCanvasPath(path: string): { cwd: string; topic: string; board: string } | null {
    const m = BOARD_PATH.exec(path);
    return m ? { cwd: m[1], topic: m[2], board: m[3] } : null;
}
