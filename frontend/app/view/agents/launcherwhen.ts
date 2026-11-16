// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The run launcher's When row (docs/superpowers/specs/2026-11-16-run-start-choice-design.md, "The launcher row"): Run
// now, After run… or Queue, with the way Jarvis suggests preselected. The pure half: what the row holds, how a
// suggestion lands on it, and the words it and the Start button read. The suggestion is wavesrv's (RunStartSuggestCommand);
// the person's pick always wins over it.

export type WhenChoice = "now" | "after" | "queue";

export interface WhenState {
    choice: WhenChoice;
    // the person picked a choice or ticked a run by hand, so a suggestion no longer moves the choice
    touched: boolean;
    // the runs After waits for, in the order they were ticked
    ticked: string[];
    suggestion: RunStartSuggestion | null;
    // a suggestion is on its way
    checking: boolean;
    // why the last check failed
    error: string | null;
}

export const WHEN_START: WhenState = {
    choice: "now",
    touched: false,
    ticked: [],
    suggestion: null,
    checking: false,
    error: null,
};

// a long run title would push the Start button wider than the dialog's footer allows
const TITLE_CHARS = 30;

function asChoice(raw: string): WhenChoice {
    return raw === "after" || raw === "queue" ? raw : "now";
}

// the live runs the person may wait for: a held run is listed but never ticked, since the queue would block the entry
// the moment it saw it
function tickable(suggestion: RunStartSuggestion | null): Set<string> {
    return new Set((suggestion?.live ?? []).filter((r) => !r.held).map((r) => r.runid));
}

/** A check went out: its answer is awaited, and a choice already made stays. */
export function startChecking(state: WhenState): WhenState {
    return { ...state, checking: true, error: null };
}

/** The check failed: nothing is known about the live runs, so the row leaves Run now (a choice the person made stays,
 *  as it does for any answer) and says why. */
export function failChecking(state: WhenState, error: string): WhenState {
    return {
        ...state,
        checking: false,
        error,
        suggestion: null,
        choice: state.touched ? state.choice : "now",
        ticked: state.touched ? state.ticked : [],
    };
}

/** An answer landed. A choice the person already made is left alone; what the answer still gives is the list After
 *  offers: the runs ticked by hand stay (the ones still live and not held), and when none is left the runs the
 *  suggestion names are ticked, so a person who goes to After finds the overlapping runs ready. */
export function applySuggestion(state: WhenState, suggestion: RunStartSuggestion): WhenState {
    const open = tickable(suggestion);
    const named = (suggestion.after ?? []).filter((id) => open.has(id));
    const kept = state.touched ? state.ticked.filter((id) => open.has(id)) : [];
    return {
        ...state,
        suggestion,
        checking: false,
        error: null,
        choice: state.touched ? state.choice : asChoice(suggestion.choice),
        ticked: kept.length > 0 ? kept : named,
    };
}

export function pickChoice(state: WhenState, choice: WhenChoice): WhenState {
    return { ...state, choice, touched: true };
}

/** Ticks a run After waits for, or unticks it. A held run, and one the suggestion does not list, cannot be ticked. */
export function toggleTick(state: WhenState, runId: string): WhenState {
    if (state.ticked.includes(runId)) {
        return { ...state, touched: true, ticked: state.ticked.filter((id) => id !== runId) };
    }
    if (!tickable(state.suggestion).has(runId)) {
        return state;
    }
    return { ...state, touched: true, ticked: [...state.ticked, runId] };
}

/** The reason line under the row: one line, or two when the quota note applies. Nothing before the first check. */
export function reasonLines(state: WhenState): string[] {
    if (state.checking) {
        return ["Checking…"];
    }
    if (state.error != null) {
        return [`Couldn't check: ${state.error}`];
    }
    if (state.suggestion == null) {
        return [];
    }
    return state.suggestion.quotanote
        ? [state.suggestion.reason, state.suggestion.quotanote]
        : [state.suggestion.reason];
}

function shortTitle(title: string): string {
    const t = title.trim();
    return t.length > TITLE_CHARS ? `${t.slice(0, TITLE_CHARS - 1).trimEnd()}…` : t;
}

/** What the Start button reads. Run now reads `nowLabel` (the launcher's own word for starting a run); the others say
 *  what they do: Queue, Queue after <run>, Queue after <n> runs. */
export function startLabel(state: WhenState, nowLabel = "Start"): string {
    if (state.choice === "now") {
        return nowLabel;
    }
    if (state.choice === "queue") {
        return "Queue";
    }
    if (state.ticked.length === 0) {
        return "Queue after…";
    }
    if (state.ticked.length === 1) {
        const run = state.suggestion?.live.find((r) => r.runid === state.ticked[0]);
        return run != null ? `Queue after ${shortTitle(run.title)}` : "Queue after 1 run";
    }
    return `Queue after ${state.ticked.length} runs`;
}

/** Why Start waits, or null: After with no run ticked has nothing to wait for. */
export function startBlocker(state: WhenState): string | null {
    return state.choice === "after" && state.ticked.length === 0 ? "Pick a run to wait for" : null;
}

/** The runs the queue entry waits for: the ticked ones for After, none for Run now or Queue. */
export function waitingOn(state: WhenState): string[] {
    return state.choice === "after" ? state.ticked : [];
}

const FILES_SHOWN = 3;

/** The second line of a live run in After's list: why it is held, else the files it shares with the new run (a run that
 *  shares none has no line). */
export function runNote(run: RunStartLiveRun): string {
    if (run.held) {
        return "held: land it first";
    }
    const files = run.files ?? [];
    if (files.length === 0) {
        return "";
    }
    const shown = files.slice(0, FILES_SHOWN).join(", ");
    return files.length > FILES_SHOWN ? `shares ${shown} +${files.length - FILES_SHOWN} more` : `shares ${shown}`;
}

/** The choice Jarvis suggested, for the "Jarvis suggests" tag; null before an answer. */
export function suggestedChoice(state: WhenState): WhenChoice | null {
    return state.suggestion == null ? null : asChoice(state.suggestion.choice);
}
