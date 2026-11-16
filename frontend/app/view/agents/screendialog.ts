// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The chat's screen dialog card, pure: a dialog Claude Code shows in its terminal that no hook reports (the safeguards'
// "Session paused" menu, most often), so neither the permission card nor an ask's choices draw it. The card reads the
// dialog off the screen (tuiscreen.ts tuiDialog) and answers it by typing the option's number, as the permission
// prompt takes `1`.

import type { TuiDialog } from "./tuiscreen";

/** Pure: whether the chat looks for a dialog on the agent's screen. Only while the agent waits on the person (asking:
 *  Claude Code reported itself blocked; waiting: a Notification nudge) and no other card answers it: a permission
 *  request at the queue's head has its own card, and an ask its choices. Never for a sleeping agent. */
export function screenDialogWanted(
    agent: { state?: string; sleeping?: unknown },
    hasPermissionHead: boolean,
    askShown: boolean
): boolean {
    if (agent.sleeping != null || hasPermissionHead || askShown) {
        return false;
    }
    return agent.state === "asking" || agent.state === "waiting";
}

/** Pure: the key that picks option `n`: its digit, which a Claude Code select takes at once. Past 9 there is no digit,
 *  so the arrows walk from the cursor and Enter picks. */
export function dialogPickKeys(dialog: Pick<TuiDialog, "cursor">, n: number): string {
    if (n >= 1 && n <= 9) {
        return String(n);
    }
    const moves = n - dialog.cursor;
    const arrow = moves < 0 ? "\x1b[A" : "\x1b[B";
    return arrow.repeat(Math.abs(moves)) + "\r";
}

/** Pure: whether two reads show the same dialog. The card draws a dialog once two reads a second apart agree, so the
 *  permission dialog that shows a moment before its request reaches the queue never flashes up as a card of its own. */
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
