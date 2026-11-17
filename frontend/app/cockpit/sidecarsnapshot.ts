// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The roster → SidecarSnapshot rule (spec 2026-11-13-sidecar-design.md, sections 2 and 3). Pure: the bridge passes in
// what it read from the stores. The tile order, the counts, what a tile says and what it asks are decided here; how
// the wall lays them out is sidecarwallmodel.ts's.

import { entriesToShow } from "@/app/view/agents/agentrowmodel";
import {
    askSentKey,
    filterAgents,
    isRecentlyIdle,
    sortAgents,
    terminalAskNote,
    type AgentAsk,
    type AgentEntry,
    type AgentVM,
} from "@/app/view/agents/agentsviewmodel";
import { providerLabel } from "@/app/view/agents/cockpitrailmodel";
import { dismissKey } from "@/app/view/agents/cockpitsurfacemodel";
import type { SidecarAsk, SidecarMessage, SidecarSnapshot, SidecarTile, SidecarTileState } from "./sidecartypes";

/** A tile keeps this many rows at most: the tallest tile of the wall shows fewer, and the event payload stays small. */
export const MAX_TILE_MESSAGES = 8;
/** A sentence is cut to this many characters (the ellipsis included). */
export const MAX_SAY_CHARS = 240;
/** An ask with more options than this has no 1-9 key for each: it is answered in the main window. */
const MAX_ANSWER_OPTIONS = 9;

// the sentence as the tile shows it: trimmed, and cut to MAX_SAY_CHARS with an ellipsis, never through a surrogate pair
function cutSay(text: string): string {
    const t = text.trim();
    if (t.length <= MAX_SAY_CHARS) {
        return t;
    }
    let end = MAX_SAY_CHARS - 1;
    const last = t.charCodeAt(end - 1);
    if (last >= 0xd800 && last <= 0xdbff) {
        end--;
    }
    return t.slice(0, end) + "…";
}

type ActionEntry = Extract<AgentEntry, { kind: "action" }>;

function toolOf(a: ActionEntry): NonNullable<SidecarMessage["tool"]> {
    const tool: NonNullable<SidecarMessage["tool"]> = { verb: a.verb, target: a.target };
    if (a.outcome != null) {
        tool.outcome = a.outcome;
    }
    return tool;
}

function row(text: string, action: ActionEntry | undefined): SidecarMessage | null {
    const say = cutSay(text);
    const msg: SidecarMessage = {};
    if (say !== "") {
        msg.say = say;
    }
    if (action != null) {
        msg.tool = toolOf(action);
    }
    return msg.say == null && msg.tool == null ? null : msg;
}

/**
 * The rows of one tile from an agent's entries: each message starts a row and takes the last action before the next
 * message as its tool; actions before the first message make one tool-only row (the latest of them). Other entry kinds
 * are skipped. At most `max` rows, the newest, newest last.
 */
export function messageRows(entries: AgentEntry[], max: number): SidecarMessage[] {
    const rows: SidecarMessage[] = [];
    let text: string | null = null; // the message whose row is open; null before the first message
    let action: ActionEntry | undefined;
    const close = () => {
        // actions before the first message have no sentence: they make the tool-only lead row
        const r = row(text ?? "", action);
        if (r != null) {
            rows.push(r);
        }
    };
    for (const e of entries) {
        if (e.kind === "message") {
            close();
            text = e.text;
            action = undefined;
        } else if (e.kind === "action") {
            action = e;
        }
    }
    close();
    return max > 0 ? rows.slice(-max) : [];
}

// the tile's state for an agent that is not asking or working: asleep wins over review, because its process is gone
function restingState(a: AgentVM): SidecarTileState {
    if (a.sleeping != null) {
        return "asleep";
    }
    return a.edited || a.committed ? "review" : "idle";
}

function tileState(a: AgentVM): SidecarTileState {
    return a.state === "asking" || a.state === "working" ? a.state : restingState(a);
}

function since(a: AgentVM, state: SidecarTileState, now: number): number | undefined {
    switch (state) {
        case "asking":
            return a.stateSince ?? (a.blockedMs != null ? now - a.blockedMs : undefined);
        case "working":
            return a.stateSince ?? (a.activeMs != null ? now - a.activeMs : undefined);
        case "asleep":
            return a.sleeping?.since;
        default:
            return a.idleSince;
    }
}

// "Claude · opus 5.5", "Pi", "Codex": the runtime, then the model when the agent reported one
function runtimeLabel(a: AgentVM): string {
    const name = a.agent ? providerLabel(a.agent) : "Agent";
    const model = a.model?.trim();
    return model ? `${name} · ${model}` : name;
}

// What a tile asks. One question, not multi-select, with 1 to 9 options is answered from the tile; anything else shows
// its first question and is answered in the main window. An asking agent with no structured ask at all (a permission
// prompt, a question asked in its terminal) says what it waits on.
function askOf(a: AgentVM): SidecarAsk {
    const ask: AgentAsk | undefined = a.ask;
    const first = ask?.questions?.[0];
    if (first == null) {
        return { question: terminalAskNote(a) ?? "Waiting on you.", options: [], answerable: false };
    }
    const options = (first.options ?? []).map((o) => o.label);
    // an answer names the ask it answers, so one with no key is answered in the main window
    const key = askSentKey(a);
    const out: SidecarAsk = {
        question: first.question || first.header || "",
        options,
        answerable:
            key != null &&
            ask!.questions.length === 1 &&
            first.multiSelect !== true &&
            options.length >= 1 &&
            options.length <= MAX_ANSWER_OPTIONS,
    };
    if (key != null) {
        out.key = key;
    }
    return out;
}

function tileOf(
    a: AgentVM,
    state: SidecarTileState,
    entriesById: Record<string, AgentEntry[]>,
    sentIds: ReadonlySet<string>,
    kept: Record<string, SidecarMessage[]>,
    now: number
): SidecarTile {
    const entries = entriesToShow(entriesById[a.id] ?? [], a.previousInfo);
    const fresh = messageRows(entries, MAX_TILE_MESSAGES);
    const tile: SidecarTile = {
        id: a.id,
        name: a.name,
        runtime: runtimeLabel(a),
        state,
        messages: fresh.length > 0 ? fresh : (kept[a.id] ?? []),
    };
    if (a.project) {
        tile.project = a.project;
    }
    const at = since(a, state, now);
    if (at != null) {
        tile.since = at;
    }
    const pct = a.usage?.contextpct;
    if (pct != null && Number.isFinite(pct)) {
        tile.ctxPct = Math.round(pct);
    }
    if (state === "asking") {
        tile.ask = askOf(a);
        // an ask with no id cannot have been answered: it has nothing to be marked by
        const key = askSentKey(a);
        if (key != null && sentIds.has(key)) {
            tile.sent = true;
        }
    }
    return tile;
}

const STATE_ORDER: SidecarTileState[] = ["asking", "working", "review", "idle", "asleep"];

/**
 * The snapshot of the whole roster: tiles in order (asking, working, review, idle, asleep), the title-bar counts, and
 * for an agent with no rows from its entries, the rows it last had (`kept`). Plain terminals and tools are left out.
 * Within asking the longest-blocked agent is first, within working the longest-running; the rest keep roster order.
 */
export function sidecarSnapshot(
    agents: AgentVM[],
    entriesById: Record<string, AgentEntry[]>,
    sentIds: ReadonlySet<string>,
    kept: Record<string, SidecarMessage[]>,
    now: number
): SidecarSnapshot {
    // sortAgents orders asking (longest blocked first) and working (longest running first) and keeps idle in roster order
    const tiles = sortAgents(agents.filter((a) => a.kind !== "terminal")).map((a) =>
        tileOf(a, tileState(a), entriesById, sentIds, kept, now)
    );
    // a stable sort: review, idle and asleep are all idle agents in roster order, so ranking them keeps that order
    tiles.sort((x, y) => STATE_ORDER.indexOf(x.state) - STATE_ORDER.indexOf(y.state));
    const count = (s: SidecarTileState) => tiles.filter((t) => t.state === s).length;
    return {
        now,
        counts: {
            asking: count("asking"),
            working: count("working"),
            idle: count("review") + count("idle") + count("asleep"),
        },
        tiles,
    };
}

/** What the Cockpit's grid is showing, read from the main window's stores for the wall's filter. */
export type CockpitScope = {
    now: number;
    /** agents whose just-finished row was dismissed, by idle episode (cockpitsurfacemodel dismissKey) */
    dismissed: ReadonlySet<string>;
    /** agents sent to the Background lane */
    backgrounded: ReadonlySet<string>;
    projectFilter: string;
    liveOnly: boolean;
    /** agents with nothing to show yet (cockpitsurfacemodel hiddenAgentIds) */
    hidden: ReadonlySet<string>;
};

/**
 * The agents the wall shows: the ones the Cockpit's grid shows, so the second screen is the Cockpit at a glance and not
 * the whole roster. That is the asking and working agents and those that went idle within the grace window (5 min) and
 * were not dismissed, minus the Background lane, under the Cockpit's project filter and Live only, minus the agents
 * with nothing to show yet. The idle list the Cockpit folds away stays off the wall; the title bar still counts it.
 * An asking agent is the exception: it shows whatever its lane or the filter, because the title bar counts it as
 * needing you and the small form exists to list it; a filter that hid it would leave "1 need you" with nothing to answer.
 */
export function wallAgentIds(agents: AgentVM[], scope: CockpitScope): Set<string> {
    const asking: AgentVM[] = [];
    const shown = agents.filter((a) => {
        if (a.kind === "terminal" || scope.hidden.has(a.id)) {
            return false;
        }
        if (a.state === "asking") {
            asking.push(a);
            return false;
        }
        if (scope.backgrounded.has(a.id)) {
            return false;
        }
        if (a.state === "idle" && (!isRecentlyIdle(a, scope.now) || scope.dismissed.has(dismissKey(a)))) {
            return false;
        }
        return true;
    });
    const ids = new Set(filterAgents(shown, scope.projectFilter, scope.liveOnly).map((a) => a.id));
    for (const a of asking) {
        ids.add(a.id);
    }
    return ids;
}

/** The snapshot with only the tiles `ids` names, in its order; the counts stay the whole roster's. */
export function scopeTiles(snap: SidecarSnapshot, ids: ReadonlySet<string>): SidecarSnapshot {
    return { ...snap, tiles: snap.tiles.filter((t) => ids.has(t.id)) };
}

/** The rows each tile of a snapshot shows, by agent id, for the bridge to keep; tiles with none are left out. */
export function keptMessages(snap: SidecarSnapshot): Record<string, SidecarMessage[]> {
    const out: Record<string, SidecarMessage[]> = {};
    for (const t of snap.tiles) {
        if (t.messages.length > 0) {
            out[t.id] = t.messages;
        }
    }
    return out;
}
