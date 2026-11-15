// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What the cockpit sends the Sidecar window and what it sends back (spec 2026-11-13-sidecar-design.md). The Sidecar
// page (frontend/tauri/sidecar.tsx) holds no store of its own: the main window's bridge builds a SidecarSnapshot from
// the cockpit's stores and emits it as sidecar:snapshot; the page emits each click as a SidecarAct on sidecar:act, and
// the host tells the main window the Sidecar window is gone with sidecar:closed. Plain data only: it crosses a Tauri
// event.

export const SIDECAR_SNAPSHOT_EVENT = "sidecar:snapshot"; // main → sidecar window
export const SIDECAR_ACT_EVENT = "sidecar:act"; // sidecar page → main
export const SIDECAR_CLOSED_EVENT = "sidecar:closed"; // host → main, when the Sidecar window is destroyed

export type SidecarTileState = "asking" | "working" | "review" | "idle" | "asleep";

/** One row of a tile: what the agent said, then the tool it ran. Either may be missing, never both. */
export interface SidecarMessage {
    say?: string;
    tool?: { verb: string; target: string; outcome?: "ok" | "fail" | "blocked" };
}

export interface SidecarAsk {
    question: string;
    options: string[];
    answerable: boolean; // one question, not multi-select, 1 to 9 options: 1-9 answers it from the tile
}

export interface SidecarTile {
    id: string;
    name: string;
    project?: string;
    runtime: string; // "Claude · opus", "Pi", "Codex"
    state: SidecarTileState;
    since?: number; // UnixMilli the state began, for the age
    ctxPct?: number;
    messages: SidecarMessage[];
    ask?: SidecarAsk;
    sent?: boolean; // the answer to its ask has gone out and the agent has not moved on yet
}

export interface SidecarSnapshot {
    now: number; // UnixMilli when it was built; the page adds the time since it arrived
    counts: { asking: number; working: number; idle: number };
    tiles: SidecarTile[];
}

export type SidecarAct =
    | { kind: "hello" }
    | { kind: "open"; id: string }
    | { kind: "answer"; id: string; option: number };
