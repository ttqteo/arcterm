// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The chat's screen card, pure: what Claude Code shows in its terminal that no other card in Chat answers. A numbered
// dialog no hook reports (the safeguards' "Session paused" menu, most often) is read off the screen whole (tuiscreen.ts
// tuiDialog) and drawn with a button per option, which types the option's number, as the permission prompt takes `1`.
// Anything else the agent waits on there (a form, a "Press Enter to continue") is drawn as the foot of the screen, with
// a way to the terminal: an agent that waits on the person never leaves Chat empty.

import type { AgentEntry } from "./agentsviewmodel";
import { stripResultLines } from "./chatinitiative";
import { tuiDialog, tuiPromptUp, tuiScreenTail, type TuiDialog } from "./tuiscreen";

export type ScreenCard = { kind: "dialog"; dialog: TuiDialog } | { kind: "terminal"; rows: string[] };

/** Pure: whether the chat reads the agent's screen for a card. Whatever its state: a dialog no hook reports can leave
 *  it reading idle (the safeguards' pause comes right after the StopFailure) or working. Not while another card
 *  answers (a permission request at the queue's head, or any ask, a held one's dialog included), nor for a sleeping
 *  agent. */
export function screenWatched(agent: { sleeping?: unknown }, hasPermissionHead: boolean, askOpen: boolean): boolean {
    return agent.sleeping == null && !hasPermissionHead && !askOpen;
}

/** Pure: the card one read of the screen calls for. A dialog draws in any state. The foot of the screen draws only while
 *  the agent waits on the person (asking: Claude Code reported itself blocked; waiting: a Notification nudge) and its
 *  mode line is covered: a mode line in view, whatever mode it names (tuiPromptUp), means the prompt is up, and nothing
 *  on screen asks. null with no screen. */
export function screenCardOf(lines: string[] | null, state: string | undefined): ScreenCard | null {
    if (lines == null) {
        return null;
    }
    const dialog = tuiDialog(lines);
    if (dialog != null) {
        return { kind: "dialog", dialog };
    }
    if ((state !== "asking" && state !== "waiting") || tuiPromptUp(lines)) {
        return null;
    }
    const rows = tuiScreenTail(lines);
    return rows.length > 0 ? { kind: "terminal", rows } : null;
}

/** Pure: whether two reads call for the same card. The card draws once two reads a second apart agree, so the permission
 *  dialog that shows a moment before its request reaches the queue never flashes up as a card of its own. The foot of
 *  the screen counts as the same while it shows at all: a spinner or a typed field changes it every read. */
export function sameCard(a: ScreenCard | null, b: ScreenCard | null): boolean {
    if (a == null || b == null || a.kind !== b.kind) {
        return false;
    }
    return a.kind === "terminal" || (b.kind === "dialog" && sameDialog(a.dialog, b.dialog));
}

/** Pure: whether two reads show the same dialog: its title and its options' labels. */
export function sameDialog(a: TuiDialog | null, b: TuiDialog | null): boolean {
    if (a == null || b == null) {
        return false;
    }
    return (
        a.title === b.title &&
        a.options.length === b.options.length &&
        a.options.every((o, i) => o.label === b.options[i].label)
    );
}

/** Pure: the key that picks option `n`: its digit, which a numbered Claude Code select takes at once. Past 9, or in a
 *  plain list (the folder trust prompt), there is no digit, so the arrows walk from the cursor and Enter picks. */
export function dialogPickKeys(dialog: Pick<TuiDialog, "cursor" | "plain">, n: number): string {
    if (!dialog.plain && n >= 1 && n <= 9) {
        return String(n);
    }
    const moves = n - dialog.cursor;
    const arrow = moves < 0 ? "\x1b[A" : "\x1b[B";
    return arrow.repeat(Math.abs(moves)) + "\r";
}

/** Pure: whether an option puts the last prompt back in Claude Code's box to edit ("Edit prompt and retry with Opus
 *  5.5"): Chat then takes it on into its own box, where the person edits. */
export function editsPrompt(label: string): boolean {
    return /^edit (the |your )?prompt\b/i.test(label.trim());
}

/** Pure: the text of the person's last message in the conversation, as they typed it; null with none. */
export function lastPromptText(entries: readonly AgentEntry[]): string | null {
    for (let i = entries.length - 1; i >= 0; i--) {
        const e = entries[i];
        if (e.kind === "user") {
            const text = stripResultLines(e.text).trim();
            return text === "" ? null : text;
        }
    }
    return null;
}
