// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The shape of Chat's floating message box, and the line it asks in when it is empty. The box is one object that changes
// shape by state (chatcomposer.tsx draws it and springs its height between them); which state it is in is decided here,
// from facts the composer already owns, so the precedence is one tested table and the components only draw it. A waiting
// brainstorm question changes the placeholder only (the `override`), never the state.

export type BoxState = "idle" | "running" | "drop" | "suggest" | "bash" | "asleep";

export interface BoxStateInput {
    /** the agent is asleep: the box wakes it */
    asleep: boolean;
    /** the agent is working or asking, awake (Stop is on offer) */
    running: boolean;
    /** files are dragged over the box */
    dragging: boolean;
    /** the `/` or `@` list is open */
    suggesting: boolean;
    /** the text starts with `!`: a shell command */
    bash: boolean;
}

/** drop > suggest > bash > asleep > running > idle: the more specific thing the person is doing wins over what the agent
 *  is doing (dragging files while the agent works is still a drop; a `/` list over a `!` command is still the list). */
export function boxState(i: BoxStateInput): BoxState {
    if (i.dragging) {
        return "drop";
    }
    if (i.suggesting) {
        return "suggest";
    }
    if (i.bash) {
        return "bash";
    }
    if (i.asleep) {
        return "asleep";
    }
    if (i.running) {
        return "running";
    }
    return "idle";
}

/** What the empty box says. Bash mode says it takes a shell command and how to leave it: its `!` is drawn beside the
 *  editor, so the editor is empty after a bare `!`. `override` (a null or empty one is not given) wins in every other
 *  state: a waiting brainstorm question asks for its answer here. Asleep with a wake under way (`waking`), it says the
 *  agent is coming back: the box takes nothing until then. The states that put a list or a drop zone over the box fall
 *  back to the idle line, which is never seen under them. */
export function boxPlaceholder(state: BoxState, agentName: string, override?: string | null, waking = false): string {
    if (state === "bash") {
        return "a command for the agent's shell; Backspace leaves bash mode";
    }
    if (override != null && override !== "") {
        return override;
    }
    if (state === "asleep" && waking) {
        return `waking ${agentName}…`;
    }
    if (state === "asleep") {
        return `message ${agentName} to wake it… (Enter)`;
    }
    if (state === "running") {
        return `Reply to ${agentName}; it waits for the turn to end`;
    }
    return `Reply to ${agentName}, @ to mention, / for commands`;
}

/** A piece of a hint line: plain text, or a key drawn as a keycap. */
export type HintPart = string | { key: string };

/** The idle or asleep line while suggested replies show above the box: it names Tab, which walks them (chatsuggest.ts
 *  stepPick). Asleep it still says a message wakes the agent, as a chip's does. Only those two lines with no question
 *  waiting get it; every other state keeps its own words. */
export function boxTabPlaceholder(agentName: string, asleep = false): HintPart[] {
    if (asleep) {
        return [`message ${agentName} to wake it, `, { key: "Tab" }, " for suggestions… (Enter)"];
    }
    return [`Reply to ${agentName}, `, { key: "Tab" }, " for suggestions, @ to mention, / for commands"];
}

/** The box's layout (chat-compact-composer/Main.dc.html): one row 44px high (`+`, the text, Send or Stop), or grown, the
 *  text and the attachments on top and `+` and Send/Stop in a row at the bottom. */
export type BoxLayout = "row" | "grown";

export interface BoxLayoutInput {
    /** the text in the box, as the agent would receive it */
    text: string;
    /** how many attachments wait in the box */
    attachments: number;
    /** the text is a bash command (`!`): its caption and shell well need the grown box */
    bash: boolean;
    /** the editor measured past one line since the text was last empty. It is a latch, not the current measure: a line
     *  that wraps only at the row's narrower width would fit again once grown, and the box would flip back and forth */
    wrapped: boolean;
}

/** Several lines, an attachment or bash mode grow the box; an empty text lets go of a wrap. */
export function boxLayout(i: BoxLayoutInput): BoxLayout {
    if (i.bash || i.attachments > 0 || i.text.includes("\n") || (i.wrapped && i.text !== "")) {
        return "grown";
    }
    return "row";
}
