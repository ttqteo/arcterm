// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The details rail's Artifacts section: the boards of the agent's canvas, as rows. Pure; the rail (agentdetailsrail.tsx)
// draws them and a click enters canvas mode on the board.

import { boardLabel, isUnseen } from "./canvasmodel";
import type { CanvasState } from "./canvasstore";

export interface ArtifactRow {
    name: string; // the board's file name: what selectCanvasTab takes
    label: string; // the board's name as the canvas tabs show it
    title: string; // the tooltip: the title canvas.json gives it, else the file name
}

export interface ArtifactsView {
    topic: string; // the design-local topic folder the boards live in
    unseen: boolean; // a board changed since the canvas was last on screen
    rows: ArtifactRow[];
}

const NONE: ArtifactsView = { topic: "", unseen: false, rows: [] };

export function artifactsView(s: CanvasState | null): ArtifactsView {
    // a removed folder keeps the boards the poller last read, but there is nothing left to open
    if (s == null || s.status === "removed") {
        return NONE;
    }
    return {
        topic: s.topic,
        unseen: isUnseen(s),
        rows: s.boards.map((b) => ({ name: b.name, label: boardLabel(b.name), title: b.title ?? b.name })),
    };
}
