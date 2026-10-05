// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Per-agent canvas state. Keyed by agent id, so switching the focused agent never touches another agent's
// terminal/canvas mode, and held in atoms because the Agent surface's own useState is not the only reader.

import { globalStore } from "@/app/store/jotaiStore";
import { atom, type PrimitiveAtom } from "jotai";
import { atomFamily } from "jotai/utils";
import type { AgentsViewModel } from "./agents";
import type { Mark } from "./canvasmarks";
import { ALL_TAB, canvasTabs, currentTab, stepTab, type CanvasBoard } from "./canvasmodel";

export type CanvasState = {
    topic: string;
    dir: string;
    projectDir: string;
    mode: "terminal" | "canvas";
    board: string | null;
    // every board side by side (the All tab), rather than the selected one alone
    all: boolean;
    boards: CanvasBoard[];
    // where wavesrv serves the project's design folder; null until the poller has asked it to
    base: string | null;
    status: "probing" | "ready" | "server-down" | "removed";
    lastModifiedMs: number | null;
    lastViewedMs: number;
    marking: boolean;
    marks: Mark[];
    reloadKey: number;
};

// cast because a null initial value picks jotai's read-only overload under the non-strict tsconfig
export const canvasStateAtom = atomFamily(
    (_agentId: string) => atom<CanvasState | null>(null) as PrimitiveAtom<CanvasState | null>
);

// atomFamily can't be enumerated, and canvasOwner has to find an agent by topic
const attached = new Set<string>();

export function getCanvas(agentId: string): CanvasState | null {
    return globalStore.get(canvasStateAtom(agentId));
}

export function updateCanvas(agentId: string, fn: (s: CanvasState) => CanvasState): void {
    const s = getCanvas(agentId);
    if (s != null) {
        globalStore.set(canvasStateAtom(agentId), fn(s));
    }
}

export function attachCanvas(
    agentId: string,
    a: { topic: string; dir: string; projectDir: string; board?: string },
    now: number
): void {
    const prev = getCanvas(agentId);
    let next: CanvasState;
    if (prev != null && prev.topic === a.topic) {
        const board = a.board ?? prev.board;
        // a reveal naming a board opens that board's own tab
        const all = a.board != null ? false : prev.all;
        const keep = board === prev.board && all === prev.all;
        // the base is the old project's design folder, so a canvas re-attached from another project drops it
        const base = a.projectDir === prev.projectDir ? prev.base : null;
        next = { ...prev, dir: a.dir, projectDir: a.projectDir, board, all, base, marks: keep ? prev.marks : [] };
    } else {
        next = {
            topic: a.topic,
            dir: a.dir,
            projectDir: a.projectDir,
            mode: "terminal",
            board: a.board ?? null,
            all: false,
            boards: [],
            base: null,
            status: "probing",
            lastModifiedMs: null,
            lastViewedMs: now,
            marking: false,
            marks: [],
            reloadKey: 0,
        };
    }
    attached.add(agentId);
    globalStore.set(canvasStateAtom(agentId), next);
}

export function detachCanvas(agentId: string): void {
    attached.delete(agentId);
    globalStore.set(canvasStateAtom(agentId), null);
}

export function canvasOwner(topic: string): string | null {
    for (const id of attached) {
        if (getCanvas(id)?.topic === topic) {
            return id;
        }
    }
    return null;
}

export function setCanvasMode(agentId: string, mode: "terminal" | "canvas", now: number): void {
    updateCanvas(agentId, (s) =>
        mode === "canvas" ? { ...s, mode, lastViewedMs: now } : { ...s, mode, marking: false, marks: [] }
    );
}

// marks are drawn over one board where it sits on screen, so any board or view switch drops them
function withTab(s: CanvasState, tab: string | null): CanvasState {
    return tab === ALL_TAB ? { ...s, all: true, marks: [] } : { ...s, all: false, board: tab ?? s.board, marks: [] };
}

// [ and ] walk the tabs, All included
export function stepCanvasBoard(agentId: string, delta: number): void {
    updateCanvas(agentId, (s) => withTab(s, stepTab(canvasTabs(s.boards), currentTab(s), delta)));
}

export function selectCanvasTab(agentId: string, tab: string): void {
    updateCanvas(agentId, (s) => withTab(s, tab));
}

// a board picked on the All canvas: the view stays, the selection moves

export function selectCanvasBoard(agentId: string, board: string): void {
    updateCanvas(agentId, (s) => ({ ...s, board, marks: [] }));
}

export function setMarking(agentId: string, on: boolean): void {
    updateCanvas(agentId, (s) => ({ ...s, marking: on, marks: on ? s.marks : [] }));
}

export function clearMarks(agentId: string): void {
    updateCanvas(agentId, (s) => ({ ...s, marks: [] }));
}

export function focusedCanvas(model: AgentsViewModel): CanvasState | null {
    const id = globalStore.get(model.focusIdAtom);
    return id ? getCanvas(id) : null;
}

export function focusedCanvasMode(model: AgentsViewModel): CanvasState | null {
    const s = focusedCanvas(model);
    return s?.mode === "canvas" ? s : null;
}
