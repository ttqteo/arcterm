// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The words the pair's conversation (pairpane.tsx) puts on what pairmodel.ts shapes: how a judge's state reads in the top
// bar, a message's clock, and the one line a Reply quotes. Pure, so pairpanemodel.test.ts holds them.

import type { AgentVM } from "./agentsviewmodel";

/** "12 s", "3 m", "2 h": a span as the top bar reads it, whole units, never negative. */
export function shortSpan(ms: number): string {
    const s = Math.max(0, Math.floor(ms / 1000));
    if (s < 60) {
        return `${s} s`;
    }
    const m = Math.floor(s / 60);
    return m < 60 ? `${m} m` : `${Math.floor(m / 60)} h`;
}

type JudgeAgent = Pick<
    AgentVM,
    "state" | "activity" | "activeMs" | "blockedMs" | "stateSince" | "idleSince" | "sleeping"
>;

// the first word of a working agent's activity line when it is a verb in -ing ("reading study_pilot.py", "Running tests");
// any other line ("task build:backend") names no verb, so the state is just "working"
const ACTIVITY_VERB = /^([a-z]+ing)\b/i;

// how long the agent has been in its state: stateSince grows with the clock, where activeMs and blockedMs are durations
// the roster read once
function stateMs(agent: JudgeAgent, now: number): number | undefined {
    if (agent.stateSince != null) {
        return now - agent.stateSince;
    }
    return agent.state === "asking" ? agent.blockedMs : agent.activeMs;
}

/** A judge's state in the top bar, from the roster ("reading · 12 s", "idle · 1 m", "asking", "asleep"). A judge the pair
 *  lost, or the roster no longer holds, is "gone". */
export function judgeStatus(agent: JudgeAgent | undefined, side: PairSide, now: number): string {
    if (agent == null || side.gone === true) {
        return "gone";
    }
    if (agent.sleeping != null) {
        return "asleep";
    }
    if (agent.state === "idle") {
        return agent.idleSince != null ? `idle · ${shortSpan(now - agent.idleSince)}` : "idle";
    }
    const word =
        agent.state === "working"
            ? (ACTIVITY_VERB.exec(agent.activity ?? "")?.[1].toLowerCase() ?? "working")
            : "asking";
    const ms = stateMs(agent, now);
    return ms != null ? `${word} · ${shortSpan(ms)}` : word;
}

/** A message's head clock: the local HH:MM. */
export function messageClock(ts: number): string {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** The line a Reply quotes in the composer: the first line of the message that holds text, whitespace collapsed, cut at a
 *  word past `max` characters and ended with an ellipsis. */
export function quoteLine(text: string, max = 90): string {
    const line =
        text
            .split("\n")
            .map((l) => l.replace(/\s+/g, " ").trim())
            .find((l) => l !== "") ?? "";
    if (line.length <= max) {
        return line;
    }
    const cut = line.slice(0, max);
    const at = cut.lastIndexOf(" ");
    return `${(at > max / 2 ? cut.slice(0, at) : cut).trimEnd()}…`;
}
