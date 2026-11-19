// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The council button at the end of the Agent panel's tabs (canvas rail-council-chat, board A): quick access to the
// Discussion of the council the focused agent started. Which council it opens, and the dot and title it is drawn with.
// Pure: no React, no Wave runtime.

import { headerChip, treeMeta, type CouncilTone } from "./councilmodel";

/** The council the agent started most recently, or null for none. A council records the session that started it in
 *  `sessionid` (wsh council start inside an agent's terminal: its transcript's session id), so `sessions` are the ids
 *  the agent goes by; an empty one matches nothing. One refused at the start (not-run) has no discussion to open, so it
 *  is passed over. */
export function agentCouncil(
    councils: readonly Council[] | null | undefined,
    sessions: readonly (string | null | undefined)[]
): Council | null {
    const ids = new Set(sessions.filter((s): s is string => s != null && s !== ""));
    let best: Council | null = null;
    for (const c of councils ?? []) {
        const mine = c.sessionid != null && ids.has(c.sessionid);
        if (mine && c.state !== "not-run" && (best == null || c.created > best.created)) {
            best = c;
        }
    }
    return best;
}

export interface RailCouncilButton {
    /** The dot on the icon, in the tone the council's row in the tree takes; null when it is calm (done, stopped). */
    dot: Exclude<CouncilTone, "muted"> | null;
    /** The tooltip: what the council is about and where it stands, and its key. */
    title: string;
}

export function railCouncilButton(c: Council): RailCouncilButton {
    const tone = treeMeta(c).tone;
    const what = c.feature.trim() || "Council";
    return { dot: tone === "muted" ? null : tone, title: `${what} · ${headerChip(c)} (c)` };
}
