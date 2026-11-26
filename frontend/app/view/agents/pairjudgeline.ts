// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The ⚖ line under a working agent's name while it works in an active pair (spec docs/superpowers/specs/
// 2026-11-26-pair-judge-round-design.md, "The judge is a line inside the worker's row"), pure: the words of the judge's
// state, the tone they are drawn in, the dot beside them and the judges' tokens. pairjudgelineview.tsx draws it.
//
// The words are Vietnamese when the pair's own words are (pairVietnamese), else English, by the rule the pause card uses.
// One judge: "judge reviewing". With several the line begins with how many and speaks for the one that needs you most (asking,
// then working, then the rest): "2 judge · reviewing". A stopped pair says its stop in the words of the pause card's head.

import { formatTokens, type AgentVM } from "./agentsviewmodel";

/** How a judge stands in the roster, as the line reads it. An asleep agent is idle in the roster, so sleeping comes first. */
export type JudgeState = "asking" | "working" | "idle" | "asleep";

export type JudgeLineWords = {
    text: string;
    /** "warning" while a judge asks you */
    tone: "normal" | "warning";
    /** how many judges the row's pair has in the roster */
    count: number;
};

export function judgeStateOf(a: Pick<AgentVM, "state" | "sleeping">): JudgeState {
    return a.sleeping != null ? "asleep" : a.state;
}

// what the line says of a pair, once the judges' states and the stop are weighed
type Standing = "asking" | "working" | "stopped" | "idle" | "asleep";

// a judge that asks you speaks first, whatever the pair does; a stopped pair then says its stop (a judge still finishing its
// last turn is no news beside the Resume it offers); a relaying one speaks for the judge at work, else the more awake of the rest
function standing(pair: Pick<PairInfo, "state">, judges: readonly JudgeState[]): Standing {
    if (judges.includes("asking")) {
        return "asking";
    }
    if (pair.state === "stopped") {
        return "stopped";
    }
    if (judges.includes("working")) {
        return "working";
    }
    return judges.length > 0 && judges.every((s) => s === "asleep") ? "asleep" : "idle";
}

// what follows "judge " in the English words and, apart, in the Vietnamese ones
const STATE_WORDS: Record<Exclude<Standing, "stopped">, [string, string]> = {
    working: ["reviewing", "đang soát"],
    idle: ["waiting", "đang chờ"],
    asleep: ["asleep", "đang ngủ"],
    asking: ["is asking you", "đang hỏi bạn"],
};

const STOP_WORDS: Record<string, [string, string]> = {
    "no-new-points": ["paused: no new points", "dừng: hết điểm"],
    settled: ["paused: both agree", "dừng: hai bên thống nhất"],
    "token-cap": ["paused: token cap", "dừng: chạm trần token"],
    "judges-gone": ["paused: no judge left", "dừng: không còn judge"],
};

/** The line's words for a pair (its PairInfo or PairView) and its judges' states, in the order that does not matter. */
export function judgeLineWords(
    pair: Pick<PairInfo, "state" | "stopreason">,
    judges: readonly JudgeState[],
    vietnamese: boolean
): JudgeLineWords {
    const at = vietnamese ? 1 : 0;
    const now = standing(pair, judges);
    const count = judges.length;
    const part = now === "stopped" ? (STOP_WORDS[pair.stopreason] ?? ["paused", "dừng"])[at] : STATE_WORDS[now][at];
    // "2 judge · is asking you" would read as a sentence cut short: with several, the asking one is "asking you"
    const said = count > 1 && now === "asking" && !vietnamese ? "asking you" : part;
    return {
        text: count > 1 ? `${count} judge · ${said}` : `judge ${said}`,
        tone: now === "asking" ? "warning" : "normal",
        count,
    };
}

/** The dot beside the words: green for a judge at work, amber for one that asks you, none otherwise (a stop or a wait is
 *  said in words only, and amber stays the colour of asking). */
export function judgeLineDot(
    pair: Pick<PairInfo, "state" | "stopreason">,
    judges: readonly JudgeState[]
): "working" | "asking" | null {
    const now = standing(pair, judges);
    return now === "working" || now === "asking" ? now : null;
}

/** The first judge that asks you, which a click on the line opens in its own view; undefined when none does. */
export function askingJudgeId(judges: readonly Pick<AgentVM, "id" | "state">[]): string | undefined {
    return judges.find((j) => j.state === "asking")?.id;
}

/** The judges' tokens as a row formats its own; null when there are none to show. */
export function judgeLineTokens(tokens: number | undefined): string | null {
    return tokens != null && tokens > 0 ? formatTokens(tokens) : null;
}
