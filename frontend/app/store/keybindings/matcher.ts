// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as keyutil from "@/util/keyutil";
import type { Binding, KeyContext, MatchResult } from "./types";

export function isSequenceKeys(keys: string): boolean {
    return keys.includes(" ");
}

function hasModifier(e: WaveKeyboardEvent): boolean {
    return !!(e.control || e.alt || e.meta || e.cmd || e.option);
}

// A modifier chord that opens a leader while a text field (or the terminal's hidden textarea) holds
// focus. The bare prefix cannot do this — it has to reach the agent — so the leader gets a second
// door. Checked against this map directly, NOT against the when-filtered sequence set, which is empty
// inside the TUI: deriving the door from that set would make it depend on what it exists to open.
export const LEADER_ALIASES: Record<string, string> = { "Mod:g": "g" };

// Pure. No DOM, no atoms. `ctx.leader` carries the active leader prefix (or null).
export function matchBinding(waveEvent: WaveKeyboardEvent, ctx: KeyContext, bindings: Binding[]): MatchResult {
    const active = bindings.filter((b) => (b.when ? b.when(ctx) : true));
    const sequences = active.filter((b) => isSequenceKeys(b.keys));
    const singles = active.filter((b) => !isSequenceKeys(b.keys));

    if (ctx.leader != null) {
        // A modifier chord during leader mode cancels the leader and is processed normally.
        if (hasModifier(waveEvent)) {
            return { kind: "resetAndProcess", result: matchBinding(waveEvent, { ...ctx, leader: null }, bindings) };
        }
        // Escape cancels, ahead of both match passes. It is itself a registered single (agent:back,
        // subagent:back), and with the leader-aware guard those are active here — so without this rule
        // Escape would navigate instead of cancelling, which is the opposite of what the which-key bar
        // implies. Cancelling is the only meaning Escape has while that bar is showing.
        if (keyutil.checkKeyPressed(waveEvent, "Escape")) {
            return { kind: "reset" };
        }
        for (const b of sequences) {
            const [lead, next] = b.keys.split(" ");
            if (lead === ctx.leader && keyutil.checkKeyPressed(waveEvent, next)) {
                return { kind: "run", binding: b };
            }
        }
        // Fall back to the surface's own single-key vocabulary (d, j, k, [, ], ?) so the leader reuses
        // it instead of needing a mirrored `g <letter>` for each. Sequences win on a shared letter,
        // which is why `g f` is Files rather than fullscreen.
        for (const b of singles) {
            if (keyutil.checkKeyPressed(waveEvent, b.keys)) {
                return { kind: "run", binding: b };
            }
        }
        return { kind: "reset" };
    }

    // Leader entry by alias chord. Ahead of the singles pass on purpose: an alias chord MEANS "open
    // the leader", and the registry carries a documentation-only binding on that same chord so the
    // footer and cheat sheet can advertise it. Matched as a single, that binding would win the key and
    // its run() returns false — the dispatcher would then neither open the leader nor consume the
    // keystroke, and ^G would reach the PTY. Nothing else may claim a key in this map.
    for (const [chord, leader] of Object.entries(LEADER_ALIASES)) {
        if (keyutil.checkKeyPressed(waveEvent, chord)) {
            return { kind: "enterLeader", leader };
        }
    }
    // Exact single/chord matches take priority over entering a leader by bare prefix.
    for (const b of singles) {
        if (keyutil.checkKeyPressed(waveEvent, b.keys)) {
            return { kind: "run", binding: b };
        }
    }
    // Leader entry by bare prefix — only where a sequence binding is actually active.
    const prefixes = new Set(sequences.map((b) => b.keys.split(" ")[0]));
    for (const p of prefixes) {
        if (keyutil.checkKeyPressed(waveEvent, p)) {
            return { kind: "enterLeader", leader: p };
        }
    }
    return { kind: "none" };
}
