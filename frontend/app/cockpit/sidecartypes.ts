// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What the cockpit sends the Sidecar window and what it sends back (spec 2026-11-13-sidecar-design.md). The Sidecar
// page (frontend/tauri/sidecar.tsx) holds no store of its own: the main window's bridge builds a SidecarSnapshot from
// the cockpit's stores and emits it as sidecar:snapshot; the page emits each click as a SidecarAct on sidecar:act, and
// the host tells the main window the Sidecar window is gone with sidecar:closed, and the main window answers an older
// act (scrollback) with sidecar:older. Plain data only: it crosses a Tauri event.

export const SIDECAR_SNAPSHOT_EVENT = "sidecar:snapshot"; // main → sidecar window
export const SIDECAR_ACT_EVENT = "sidecar:act"; // sidecar page → main
export const SIDECAR_CLOSED_EVENT = "sidecar:closed"; // host → main, when the Sidecar window is destroyed
export const SIDECAR_OLDER_EVENT = "sidecar:older"; // main → sidecar window: the answer to an older act

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

export type StrainLevel = "amber" | "red";

/** The machine's figures for the title bar and the strain band, rounded so jitter does not re-emit a snapshot. */
export interface SidecarMachine {
    memFree: number;
    memTotal: number;
    swapUsed?: number; // bytes, rounded (decision 8)
    cpuPct?: number; // whole percent; none before a reading
    platform: "windows" | "macos" | "other"; // names the OS in the red band's last part
}

/** One agent the strain band names: its weight by the band's measure, and what Stop would end. */
export interface SidecarHeavy {
    id: string;
    name: string; // the agent tile's id and name
    ramBytes?: number;
    cpuPct?: number; // its weight by the band's measure
    process?: { pid: number; command: string; ramBytes?: number; cpuPct?: number }; // what Stop ends; none: Sleep only
    note?: string; // the last Stop or Sleep outcome to show on the row
}

export interface SidecarStrain {
    level: StrainLevel;
    by: "ram" | "cpu";
    ram?: { since: number; critical: boolean }; // RAM high (or critical) since, UnixMilli
    cpu?: { since: number; pct: number }; // CPU over 90% since
    working: number;
    heavyJobs: number; // "7 agents working, 2 heavy jobs running"
    heavy: SidecarHeavy[]; // 0-3, heaviest first; empty while the reading is not in yet
}

export interface SidecarSnapshot {
    now: number; // UnixMilli when it was built; the page adds the time since it arrived
    counts: { asking: number; working: number; idle: number };
    tiles: SidecarTile[];
    machine?: SidecarMachine;
    strain?: SidecarStrain;
}

export type SidecarAct =
    | { kind: "hello" }
    | { kind: "open"; id: string }
    | { kind: "answer"; id: string; option: number }
    | { kind: "older"; id: string; before: string | null; count: number } // count 1..50
    | { kind: "stop"; id: string; pid: number } // must match a heavy row's process
    | { kind: "sleep"; id: string }; // must be a heavy row

/** The answer to an older act, main → sidecar window: rows oldest first, `next` null when nothing is earlier. */
export interface SidecarOlder {
    id: string;
    before: string | null;
    rows: SidecarMessage[];
    next: string | null;
}

/** What the host's sidecar_form command answers: whether the window is in its small form and pinned on top. */
export interface SidecarForm {
    small: boolean;
    pinned: boolean;
}
