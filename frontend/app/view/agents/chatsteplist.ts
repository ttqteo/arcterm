// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The pure model of Chat's step checklist: a ```arc-steps block in a Claude agent's reply, one step per line
// (`[x]` done, `[>]` being worked on, `[ ]` not started), drawn as one list per turn
// (docs/superpowers/specs/2026-11-13-chat-task-checklist-design.md). This module parses a block, finds the blocks in a
// reply, and decides, for a whole conversation, where each turn's list is drawn and what it shows. No React: the view is
// chatsteplistview.tsx, and transcriptprojection.ts reads the latest block for the card's done/total chip.

import type { ChatItem } from "./chatmodel";

export const STEPS_LANG = "arc-steps";

export type StepState = "done" | "working" | "pending";

export interface Step {
    text: string;
    state: StepState;
}

const MARKER_STATE: Record<string, StepState> = { x: "done", X: "done", ">": "working", " ": "pending" };
const STATE_MARKER: Record<StepState, string> = { done: "x", working: ">", pending: " " };

// `[x] text`, `[>] text`, `[ ] text`; leading and trailing blanks are not part of the step
const STEP_LINE = /^\s*\[([xX> ])\]\s+(\S.*?)\s*$/;

/** Pure: a block's steps, in order. A line that does not parse is skipped; [] when none does. */
export function parseSteps(raw: string): Step[] {
    const steps: Step[] = [];
    for (const line of raw.split(/\r?\n/)) {
        const m = STEP_LINE.exec(line);
        if (m != null) {
            steps.push({ text: m[2], state: MARKER_STATE[m[1]] });
        }
    }
    return steps;
}

/** Pure: a list as one string, the same for two blocks that list the same steps in the same states. */
export function stepsKey(steps: readonly Step[]): string {
    return steps.map((s) => `[${STATE_MARKER[s.state]}] ${s.text}`).join("\n");
}

// a fence opening (``` or ~~~, three or more, at most three spaces in) and its info string's first word
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})\s*$/;

/**
 * Pure: the bodies of the top-level ```arc-steps fences in a reply, in order. A fence closes on a line of the same
 * character at least as long, so a block quoted inside a longer fence (a skill showing the format) is not one; a fence
 * left open runs to the end, as Markdown draws it, so a block still being written counts.
 */
export function stepBlocksOf(text: string): string[] {
    if (!text.includes(STEPS_LANG)) {
        return [];
    }
    const out: string[] = [];
    let open: { fence: string; steps: boolean; body: string[] } | null = null;
    for (const line of text.split(/\r?\n/)) {
        if (open == null) {
            const m = FENCE_OPEN.exec(line);
            if (m != null) {
                open = { fence: m[1], steps: m[2] === STEPS_LANG, body: [] };
            }
            continue;
        }
        const close = FENCE_CLOSE.exec(line);
        if (close != null && close[1][0] === open.fence[0] && close[1].length >= open.fence.length) {
            if (open.steps) {
                out.push(open.body.join("\n"));
            }
            open = null;
            continue;
        }
        open.body.push(line);
    }
    if (open?.steps) {
        out.push(open.body.join("\n"));
    }
    return out;
}

/** Pure: the steps of the last block in a reply that lists any, or null when none does. */
export function lastStepsOf(text: string): Step[] | null {
    const blocks = stepBlocksOf(text);
    for (let i = blocks.length - 1; i >= 0; i--) {
        const steps = parseSteps(blocks[i]);
        if (steps.length > 0) {
            return steps;
        }
    }
    return null;
}

/**
 * How a list's `[>]` step draws. `live`: the agent works on the turn, so the step pulses. `waiting`: the agent waits on
 * you (a permission prompt, a question) in that turn, so the step keeps its green ring, still. `over`: the agent is idle
 * or ended, or a later turn began, so the step draws as not started.
 */
export type StepsPhase = "live" | "waiting" | "over";

/** What the agent is doing now, as ChatConversation knows it. */
export type AgentNow = "working" | "waiting" | "idle";

/** A turn's list where it is drawn: at the block whose steps read `anchor`, showing the turn's latest `steps`. */
export interface PlacedSteps {
    anchor: string;
    steps: Step[];
    phase: StepsPhase;
}

/** The prose part a block sits in, as ChatConversation keys it (drawPart): `<item key>#<part index>`. */
export function stepsPartKey(itemKey: string, part: number): string {
    return `${itemKey}#${part}`;
}

// a message of yours starts a turn (a command, a prompt arcterm typed for you), except a /btw: its side answer does not
// reach the agent's work
function startsTurn(item: ChatItem): boolean {
    if (item.kind === "sent") {
        return true;
    }
    return item.kind === "you" && !("btw" in item && item.btw != null);
}

/**
 * Pure: where each turn's list is drawn. A turn runs from one of your messages to the next; a marker inside it (a
 * compaction, a background task's notification, an interruption) does not end it. The list is drawn at the first block
 * of the turn that lists a step and shows the turn's last such block. The map holds, for each prose part with such a
 * block, its turn's list when the list is drawn there, or null when its blocks draw nothing. Only the last turn can be
 * live or waiting, and only while the agent has not exited.
 */
export function placeStepLists(items: readonly ChatItem[], now: AgentNow): Map<string, PlacedSteps | null> {
    const out = new Map<string, PlacedSteps | null>();
    let turn: PlacedSteps | null = null;
    for (const item of items) {
        if (startsTurn(item)) {
            turn = null;
            continue;
        }
        if (item.kind !== "agent") {
            continue;
        }
        for (const [p, part] of item.parts.entries()) {
            if (part.kind !== "prose") {
                continue;
            }
            const key = stepsPartKey(item.key, p);
            for (const raw of stepBlocksOf(part.text)) {
                const steps = parseSteps(raw);
                if (steps.length === 0) {
                    continue;
                }
                if (turn == null) {
                    turn = { anchor: stepsKey(steps), steps, phase: "over" };
                    out.set(key, turn);
                    continue;
                }
                turn.steps = steps;
                if (!out.has(key)) {
                    out.set(key, null);
                }
            }
        }
    }
    // the list of the turn under way: the last turn, when nothing of yours came after it
    if (turn != null) {
        turn.phase = now === "working" ? "live" : now === "waiting" ? "waiting" : "over";
    }
    return out;
}

/** How a step draws, once the list's phase is applied: a `[>]` step of a turn that is over draws as not started. */
export function shownState(state: StepState, phase: StepsPhase): StepState {
    return state === "working" && phase === "over" ? "pending" : state;
}

/** Pure: a key for each step of a list, stable while the step stays in it: its text, with a count for a repeat. */
export function stepKeys(steps: readonly Step[]): string[] {
    const seen = new Map<string, number>();
    return steps.map((s) => {
        const n = seen.get(s.text) ?? 0;
        seen.set(s.text, n + 1);
        return n === 0 ? s.text : `${s.text}\u0000${n}`;
    });
}
