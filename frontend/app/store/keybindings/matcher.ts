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

// The one door into a leader: a modifier chord, the same in every posture, so a leader works the same
// from a list and from inside the terminal. A bare prefix letter never opens one: it is text in a field
// and a plain key elsewhere. Checked against this map directly, NOT against the when-filtered sequence
// set, which is empty inside the TUI: deriving the door from that set would make it depend on what it
// exists to open.
export const LEADER_ALIASES: Record<string, string> = { "Mod:g": "g" };

// A sequence as the user presses it: its leader shown as the chord that opens it ("g c" -> "Mod:g c").
// Bindings keep the leader letter in `keys` (the matcher keys leader mode on it); every place that shows
// a key to the user goes through this.
export function displayKeys(keys: string): string {
    if (!isSequenceKeys(keys)) {
        return keys;
    }
    const [lead, ...rest] = keys.split(" ");
    return [leaderChord(lead), ...rest].join(" ");
}

// The chord that opens a leader ("g" -> "Mod:g"); the letter itself for a leader no chord opens.
export function leaderChord(leader: string): string {
    return Object.keys(LEADER_ALIASES).find((c) => LEADER_ALIASES[c] === leader) ?? leader;
}

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
    for (const b of singles) {
        if (keyutil.checkKeyPressed(waveEvent, b.keys)) {
            return { kind: "run", binding: b };
        }
    }
    return { kind: "none" };
}
