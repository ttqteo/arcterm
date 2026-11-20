// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Pure: the line over Chat's box that asks once, when a Claude agent's context crosses the red line (200k tokens, or a
// nearly full window: agentrailmodel.ts contextLevel), whether to compact or clear it. Chat never compacts on its own:
// only the person knows whether the task is at a point where losing detail is fine. chatcontextnudgeline.tsx draws it.

import { contextLevel, contextTokens, offersContextReset } from "./agentrailmodel";
import { usageLevel, type AgentVM } from "./agentsviewmodel";

type Level = ReturnType<typeof contextLevel>;

/** The line shows while the agent sits idle past the red line and the person has not answered it for this crossing. It
 *  waits through a turn (a slash command typed mid-turn would queue into Claude's input, not run). */
export function contextNudgeShows(o: {
    isClaude: boolean;
    state: AgentVM["state"];
    level: Level;
    live: boolean;
    answered: boolean;
}): boolean {
    return o.level === "hot" && !o.answered && offersContextReset(o);
}

/** An answer (Compact, Clear or Later) holds until the context falls back under the warn line (150k): a compact, a clear
 *  or a new session. Crossing 200k again after that asks again; staying between 150k and 200k does not. */
export function stillAnswered(answered: boolean, level: Level): boolean {
    return answered && level !== "ok";
}

/** The line's words: what every turn re-reads, or that the window is nearly full when that is what made it red. */
export function contextNudgeText(pct: number, max: number | undefined): string {
    const tokens = contextTokens(pct, max);
    if (usageLevel(pct) === "hot" || tokens == null) {
        return "Context nearly full: compact before Claude does it on its own and loses detail?";
    }
    return `Every turn re-reads ${tokens}. Compact or clear before the next task?`;
}
