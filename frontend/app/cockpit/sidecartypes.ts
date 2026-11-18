// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What the cockpit sends the Sidecar window and what it sends back (spec 2026-11-13-sidecar-design.md). The Sidecar
// page (frontend/tauri/sidecar.tsx) holds no store of its own: the main window's bridge builds a SidecarSnapshot from
// the cockpit's stores and emits it as sidecar:snapshot; the page emits each click as a SidecarAct on sidecar:act, and
// the host tells the main window the Sidecar window is gone with sidecar:closed. Plain data only: it crosses a Tauri event.

export const SIDECAR_SNAPSHOT_EVENT = "sidecar:snapshot"; // main → sidecar window
export const SIDECAR_ACT_EVENT = "sidecar:act"; // sidecar page → main
export const SIDECAR_CLOSED_EVENT = "sidecar:closed"; // host → main, when the Sidecar window is destroyed

export type SidecarTileState = "asking" | "working" | "review" | "idle" | "asleep";

export interface SidecarAsk {
    question: string;
    options: string[];
    answerable: boolean; // one question, not multi-select, 1 to 9 options, and a key: 1-9 answers it from the tile
    key?: string; // the ask's identity (askSentKey): an answer names it, so a new ask never takes an answer meant for the old
}

/** One row of Needs you: an ask, a finished agent's question, or something Jarvis holds for you. */
export type SidecarNeedKind = "ask" | "question" | "jarvis";
export interface SidecarNeed {
    key: string; // ask: "ask:<agent id>"; question: "q:<agent id>"; jarvis: the AttentionItem's key
    kind: SidecarNeedKind;
    id?: string; // the agent, for ask and question rows
    who: string; // the agent's name, or the item's channel / source
    since: number; // UnixMilli it began waiting; the list is oldest first
    text: string; // the question in its own words, or the item's text
    word?: string; // jarvis rows: kindWord(kind, retry), "gate", "blocked", "due"…
    failed?: boolean; // a run held at Final or with a failed task
    options?: string[]; // ask rows
    answerable?: boolean; // ask rows: 1-9 answers it here
    askKey?: string; // ask rows: SidecarAsk.key
    sent?: boolean; // ask rows: the answer went out
}

export interface SidecarRunBox {
    id: string;
    leadId?: string; // the lead agent's tile id, whose node and lane carry the run
    title: string;
    done: number;
    total: number;
    failed: boolean;
    since?: number; // run created, UnixMilli
    due?: string; // the first due chunk's label
}

export interface SidecarUsage {
    fiveHourPct?: number;
    weekPct?: number;
}

export interface SidecarTile {
    id: string;
    name: string;
    project?: string;
    runtime: string; // "Claude · opus", "Pi", "Codex"
    state: SidecarTileState;
    since?: number; // UnixMilli the state began, for the age
    ctxPct?: number;
    ask?: SidecarAsk;
    sent?: boolean; // the answer to its ask has gone out and the agent has not moved on yet
    failed?: boolean; // the agent's run failed, or it holds a failed need
    diff?: { adds: number; dels: number }; // the lines its work added and removed
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
    needs?: SidecarNeed[]; // what waits on the person, oldest first
    run?: SidecarRunBox; // the newest active orchestrator run
    usage?: SidecarUsage; // the 5-hour and weekly plan rings
    more?: number; // agents past the orbit's eight, for the core's "+N"
    resources?: SidecarResources; // only while the page shows the resources (the wall's band, or the small form's panel)
}

/** One row of the resource panel: a figure is left out where it could not be read (CPU before a second sample). */
export interface SidecarResourceRow {
    key: string;
    label: string;
    kind: "sidecar" | "arcterm" | "agent" | "other";
    cpu?: number; // percent of the whole machine, one decimal
    mem?: number; // bytes held in RAM (the private working set), rounded to the MB
    gpu?: number; // percent of its busiest GPU engine, whole; left out at 0 or where not read
    count?: number; // an "other" row's processes of that name
    runtime?: string; // an agent row's runtime (claude, pi…), for its logo
    icon?: string; // an "other" row's image icon, a PNG data URL (pkg/resmon reads it on Windows)
}

/** One reading of the whole machine for the resource charts: whole percents, `gpu` left out where not read. */
export interface SidecarResourcePoint {
    t: number; // UnixMilli of the reading
    cpu: number;
    mem: number; // RAM in use, percent of the total
    gpu?: number;
}

/** The resource panel (sidecarresources.ts builds it): arcterm's rows, then the heavy processes outside it. */
export interface SidecarResources {
    state: "measuring" | "ready" | "unsupported";
    rows: SidecarResourceRow[];
    others: SidecarResourceRow[];
    othersMin?: number; // bytes: the least an "other" row holds
    history: SidecarResourcePoint[]; // the last 5 minutes, oldest first
    memTotal?: number; // bytes, for the RAM chart's figure
}

export type SidecarAct =
    | { kind: "hello" }
    | { kind: "open"; id: string }
    | { kind: "need"; key: string } // a Jarvis row: must be a need of the last snapshot
    | { kind: "answer"; id: string; option: number; key: string } // key: the ask the page showed (SidecarAsk.key)
    | { kind: "stop"; id: string; pid: number } // must match a heavy row's process
    | { kind: "sleep"; id: string } // must be a heavy row
    // the resource panel opened (with the pids the host says draw the page; re-sent as they change) or closed
    | { kind: "resources"; open: boolean; pids: number[] };

/** What the host's sidecar_form command answers: whether the window is in its small form and pinned on top. */
export interface SidecarForm {
    small: boolean;
    pinned: boolean;
}
