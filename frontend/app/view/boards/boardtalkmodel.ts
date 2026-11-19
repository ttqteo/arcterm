// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// What a board's talk says, for the split beside Chat and for Library → Boards: each turn's shown state, its notes
// and buttons, the last few turns, the header's facts and whether you may ask. Pure: no React, no RPC.

// Past this long answering, a turn reads "Still answering" and offers Stop.
export const SLOW_MS = 45_000;

const MS_PER_SECOND = 1000;
const RECENT_TURNS = 3;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// `BoardTurn.state` and `BoardForward.state` as wavesrv writes them (pkg/boarddrawer, pkg/boardforward)
const STATE_WAITING = "waiting";
const STATE_ANSWERING = "answering";
const STATE_ANSWERED = "answered";
const STATE_FORWARDED = "forwarded";
const STATE_FAILED = "failed";
const STATE_STOPPED = "stopped";
const FORWARD_WAITING = "waiting";
const FORWARD_SENT = "sent";
const FORWARD_REPLIED = "replied";
const FORWARD_AGENT_GONE = "agentgone";

// `BoardTurn.kind`: yours (drawn or forwarded) or the agent's `wsh board draw` (drawn or failed)
export const KIND_ASK = "ask";
export const KIND_REQUEST = "request";

export type TurnShown = "waiting" | "answering" | "slow" | "drawn" | "forwarded" | "failed" | "stopped";

// send the other way: a drawn ask can go to the agent, a forwarded one can be drawn
export type OtherWay = "forward" | "draw";

export interface TurnView {
    state: TurnShown;
    seconds: number; // answering and slow: since the turn started answering; else 0
    forwardNote: string | null; // a forwarded turn's line: waiting for the agent, answered in Chat, agent closed
    canShow: boolean; // a drawn turn with shapes: Show outlines them
    otherWay: OtherWay | null;
}

function pad2(n: number): string {
    return String(n).padStart(2, "0");
}

function plural(n: number, word: string): string {
    return `${n} ${word}${n === 1 ? "" : "s"}`;
}

// "15:20" for today, "12 Nov" for another day
export function talkTime(ts: number, now: number): string {
    const d = new Date(ts);
    const today = new Date(now);
    const sameDay =
        d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
    return sameDay ? `${pad2(d.getHours())}:${pad2(d.getMinutes())}` : `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

function shownState(turn: BoardTurn, now: number): TurnShown {
    switch (turn.state) {
        case STATE_ANSWERING:
            return now - (turn.startedts || turn.ts) >= SLOW_MS ? "slow" : "answering";
        case STATE_ANSWERED:
            return "drawn";
        case STATE_FORWARDED:
            return "forwarded";
        case STATE_FAILED:
            return "failed";
        case STATE_STOPPED:
            return "stopped";
        case STATE_WAITING:
        default:
            return "waiting";
    }
}

// a forward in the narrow split: its answer is in Chat, so the line only says where it went. A forward the server
// has not stated yet (a turn just saved forwarded) reads as sent.
function forwardNote(turn: BoardTurn, agentTitle: string): string {
    switch (turn.forward?.state) {
        case FORWARD_WAITING:
            return `waiting for ${agentTitle}`;
        case FORWARD_REPLIED:
            return "forwarded · answered in Chat";
        case FORWARD_AGENT_GONE:
            return "agent closed";
        case FORWARD_SENT:
        default:
            return "forwarded · answers in Chat";
    }
}

function otherWay(turn: BoardTurn): OtherWay | null {
    if (turn.kind !== KIND_ASK) {
        return null;
    }
    if (turn.state === STATE_ANSWERED) {
        return "forward";
    }
    return turn.state === STATE_FORWARDED ? "draw" : null;
}

// agentTitle names who a waiting forward waits for (the talk's agent); "the agent" when the talk has none
export function turnView(turn: BoardTurn, now: number, agentTitle = ""): TurnView {
    const state = shownState(turn, now);
    const running = state === "answering" || state === "slow";
    return {
        state,
        seconds: running ? Math.max(0, Math.floor((now - (turn.startedts || turn.ts)) / MS_PER_SECOND)) : 0,
        forwardNote: state === "forwarded" ? forwardNote(turn, agentTitle || "the agent") : null,
        canShow: state === "drawn" && (turn.shapeids?.length ?? 0) > 0,
        otherWay: otherWay(turn),
    };
}

// the last `n` turns, oldest first, and how many came before them (the split's "N earlier" line)
export function recentTurns(
    talk: BoardTalk | null | undefined,
    n = RECENT_TURNS
): { turns: BoardTurn[]; earlier: number } {
    const all = talk?.turns ?? [];
    const turns = all.slice(Math.max(0, all.length - n));
    return { turns, earlier: all.length - turns.length };
}

// "9 shapes · drawn 15:20"; a board nothing was drawn on reads "empty · created 15:20"
export function boardFacts(info: BoardInfo, now: number): string {
    const shapes = info.shapes ?? 0;
    if (shapes === 0 && !info.drawnts) {
        return `empty · created ${talkTime(info.createdts, now)}`;
    }
    const facts = [plural(shapes, "shape")];
    if (info.drawnts) {
        facts.push(`drawn ${talkTime(info.drawnts, now)}`);
    }
    return facts.join(" · ");
}

// a board's agent is alive while its tab is in the roster (sleeping included); wavesrv refuses an ask once it is gone
export function agentAlive(agentTabId: string | undefined, roster: readonly { id: string }[]): boolean {
    return agentTabId != null && agentTabId !== "" && roster.some((a) => a.id === agentTabId);
}

// you may ask while the agent is alive and no turn is running or queued
export function askAllowed(talk: BoardTalk | null | undefined, alive: boolean): boolean {
    if (!alive) {
        return false;
    }
    return !(talk?.turns ?? []).some((t) => t.state === STATE_WAITING || t.state === STATE_ANSWERING);
}
