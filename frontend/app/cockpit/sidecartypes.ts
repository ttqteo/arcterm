// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What the cockpit sends the Sidecar window and what it sends back (spec 2026-11-13-sidecar-design.md). The Sidecar
// page (frontend/tauri/sidecar.tsx) holds no store of its own: the main window's bridge builds a SidecarSnapshot from
// the cockpit's stores and emits it as sidecar:snapshot; the page emits each click as a SidecarAct on sidecar:act, and
// the host tells the main window the Sidecar window is gone with sidecar:closed. Plain data only: it crosses a Tauri event.

export const SIDECAR_SNAPSHOT_EVENT = "sidecar:snapshot"; // main → sidecar window
// main → sidecar window: new machine figures (a SidecarMachine) when nothing else of the snapshot changed, so a 5 s poll
// redraws the figures alone, not the dashboard
export const SIDECAR_MACHINE_EVENT = "sidecar:machine";
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
    label?: string; // what kind of thing waits, in words: "Rule to approve", "Due", "Asks you" (needLabel)
    late?: boolean; // its age is how late it is (a chunk past its due day), not how long it has waited
    failed?: boolean; // a task that failed and can be retried
    options?: string[]; // ask rows
    answerable?: boolean; // ask rows: 1-9 answers it here
    askKey?: string; // ask rows: SidecarAsk.key
    sent?: boolean; // ask rows: the answer went out
    acts?: SidecarNeedAct[]; // jarvis rows: what can be done about it from Sidecar, in-place acts first
    note?: string; // what the last act pressed on it came to, when it did not settle it, for a few seconds
}

/** A button on a Jarvis row of Needs you: the bridge runs the act it names (the tray peek's own PetAct, or a rule's
 * Accept and Dismiss). */
export interface SidecarNeedAct {
    id: string;
    label: string;
    strong?: boolean; // the act that settles the row (Accept, Approve, Retry…), drawn filled; an Open is not
}

export interface SidecarRunBox {
    id: string;
    leadId?: string; // the lead agent's tile id, whose node and lane carry the run
    title: string;
    done: number;
    total: number;
    failed: boolean;
    since?: number; // run created, UnixMilli
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
    runs?: SidecarRunBox[]; // every active orchestrator run: the failed first, then the newest (none: left out)
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
    endable?: boolean; // an "other" row Sidecar may end (resmon.Endable): not the system's own processes or arcterm's
    note?: string; // what the last End task on this row came to, for a few seconds
}

/** One reading of the whole machine for the resource charts: whole percents, `gpu` left out where not read. */
export interface SidecarResourcePoint {
    t: number; // UnixMilli of the reading
    cpu: number;
    mem: number; // RAM in use, percent of the total
    gpu?: number;
    swap?: number; // bytes of swap in use, to the MB; a Mac's only (pkg/resmon reads vm.swapusage)
}

/** The resource panel (sidecarresources.ts builds it): arcterm's rows, then the heavy processes outside it. */
export interface SidecarResources {
    state: "measuring" | "ready" | "unsupported";
    rows: SidecarResourceRow[];
    others: SidecarResourceRow[];
    othersMin?: number; // bytes: the least an "other" row holds
    history: SidecarResourcePoint[]; // the last 5 minutes, oldest first
    memTotal?: number; // bytes, for the RAM chart's figure
    swapTotal?: number; // bytes: the swap files' size now (macOS grows them as it needs); the charts show only the swap in use
    ask?: number; // the page's open act these answer (`resourcesFor`): a snapshot sent before a close carries the last one's
    failed?: string; // why no reading has come: the last read failed (a timeout under load), and the bridge keeps trying
}

export type SidecarAct =
    | { kind: "hello" }
    | { kind: "open"; id: string }
    | { kind: "need"; key: string } // a Jarvis row: must be a need of the last snapshot
    | { kind: "answer"; id: string; option: number; key: string } // key: the ask the page showed (SidecarAsk.key)
    | { kind: "stop"; id: string; pid: number } // must match a heavy row's process
    | { kind: "sleep"; id: string } // must be a heavy row
    | { kind: "endapp"; name: string } // End task: must be an endable other app of the last snapshot's resources
    | { kind: "needact"; key: string; act: string } // a Jarvis row's button: one of that need's acts in the last snapshot
    // a run row: that run's sheet in the main window (a run of the last snapshot); no id, the runs in Jarvis
    | { kind: "run"; id?: string }
    // the resource panel opened (with the pids the host says draw the page; re-sent as they change) or closed; `ask`
    // numbers each opening, and the bridge puts it on the resources it sends back
    | { kind: "resources"; open: boolean; pids: number[]; ask?: number }
    // the page became hidden (minimized, on another Space, covered whole) or shown again: hidden, it is sent nothing
    | { kind: "visible"; visible: boolean };

/** What the host's sidecar_form command answers: whether the window is in its small form and pinned on top. */
export interface SidecarForm {
    small: boolean;
    pinned: boolean;
}
