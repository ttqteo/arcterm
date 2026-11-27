// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// What a board's talk says, for the board cell, Library → Boards and Chat's board card: a turn's shown state, the one
// turn the status line under the canvas shows, and the header's facts. Pure: no React, no RPC.

// Past this long answering, a turn reads "Still answering" and offers Stop.
export const SLOW_MS = 45_000;

const MS_PER_SECOND = 1000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// `BoardTurn.state` as wavesrv writes it (pkg/boarddrawer)
const STATE_WAITING = "waiting";
const STATE_ANSWERING = "answering";
const STATE_ANSWERED = "answered";
const STATE_FORWARDED = "forwarded";
const STATE_FAILED = "failed";
const STATE_STOPPED = "stopped";

// `BoardTurn.kind`: the agent's `wsh board draw` (drawn or failed); older talks also hold the person's asks ("ask")
export const KIND_REQUEST = "request";

export type TurnShown = "waiting" | "answering" | "slow" | "drawn" | "forwarded" | "failed" | "stopped";

export interface TurnView {
    state: TurnShown;
    seconds: number; // answering and slow: since the turn started answering; else 0
}

function pad2(n: number): string {
    return String(n).padStart(2, "0");
}

export function plural(n: number, word: string): string {
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

export function turnView(turn: BoardTurn, now: number): TurnView {
    const state = shownState(turn, now);
    const running = state === "answering" || state === "slow";
    return {
        state,
        seconds: running ? Math.max(0, Math.floor((now - (turn.startedts || turn.ts)) / MS_PER_SECOND)) : 0,
    };
}

// The one turn the status line under a board's canvas shows, or null for none (the line is gone): the turn the drawer
// is on (answering or slow; one runs at a time per board), else the next one queued, else the latest turn when it
// failed, so its reason and Retry stay until a later turn lands. A drawn, stopped or forwarded latest turn shows nothing.
export function statusTurn(
    talk: BoardTalk | null | undefined,
    now: number
): { turn: BoardTurn; view: TurnView } | null {
    const all = talk?.turns ?? [];
    const pick =
        all.find((t) => t.state === STATE_ANSWERING) ??
        all.find((t) => t.state === STATE_WAITING) ??
        (all.length > 0 && all[all.length - 1].state === STATE_FAILED ? all[all.length - 1] : undefined);
    return pick == null ? null : { turn: pick, view: turnView(pick, now) };
}

// "12s", "1m 5s": how long a turn has been answering
export function elapsedLabel(seconds: number): string {
    const s = Math.max(0, Math.floor(seconds));
    if (s < 60) {
        return `${s}s`;
    }
    return s % 60 === 0 ? `${s / 60}m` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

// the words a turn is named by: what the drawer says it drew, else what was asked, else the agent's briefing
export function turnText(turn: BoardTurn): string {
    return turn.title || turn.question || turn.context || "Drawing";
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

// a board's agent is alive while its tab is in the roster (sleeping included)
export function agentAlive(agentTabId: string | undefined, roster: readonly { id: string }[]): boolean {
    return agentTabId != null && agentTabId !== "" && roster.some((a) => a.id === agentTabId);
}
