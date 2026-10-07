// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Pure helpers for the Channels Jarvis surface: parse the ChannelMessage.data payload into the rich
// Gatekeeper card model, derive pending asks and fleet counts. No React, no jotai — unit-tested in
// jarviscards.test.ts.

export interface JarvisCardOption {
    label: string;
    sub?: string;
}

export interface JarvisCardData {
    askORef: string;
    askId?: string; // the one ask this card is about: every ask an agent raises shares its block's askORef
    workerORef: string;
    question: string;
    options: JarvisCardOption[];
    choice?: number; // Jarvis's own pick (gatekeeper auto-answer); absent on an escalation
    humanPick?: number; // the option a human selected on this card, persisted so it survives a remount
    reason?: string;
}

// parseCardData reads the structured payload off a jarvis-answered/-escalation message. Returns null
// for legacy messages (no data), malformed JSON, or a payload missing required fields — callers then
// fall back to the flat msg.text.
export function parseCardData(msg: ChannelMessage): JarvisCardData | null {
    if (!msg.data) {
        return null;
    }
    try {
        const p = JSON.parse(msg.data) as Partial<JarvisCardData>;
        if (typeof p.question !== "string" || !Array.isArray(p.options) || typeof p.askORef !== "string") {
            return null;
        }
        return {
            askORef: p.askORef,
            askId: typeof p.askId === "string" ? p.askId : undefined,
            workerORef: typeof p.workerORef === "string" ? p.workerORef : "",
            question: p.question,
            options: p.options,
            choice: typeof p.choice === "number" ? p.choice : undefined,
            humanPick: typeof p.humanPick === "number" ? p.humanPick : undefined,
            reason: typeof p.reason === "string" ? p.reason : undefined,
        };
    } catch {
        return null;
    }
}

// The set of ask ids Jarvis has already auto-answered in this channel (jarvis-answered cards).
export function answeredAskIds(messages: ChannelMessage[]): Set<string> {
    const out = new Set<string>();
    for (const m of messages) {
        if (m.kind !== "jarvis-answered") {
            continue;
        }
        const card = parseCardData(m);
        if (card?.askId) {
            out.add(card.askId);
        }
    }
    return out;
}

// fleetCounts tallies working + waiting(=asking) from a fleet snapshot; idle/gone are excluded.
export function fleetCounts(snapshot: { state: string }[]): { working: number; waiting: number } {
    let working = 0;
    let waiting = 0;
    for (const w of snapshot) {
        if (w.state === "working") {
            working++;
        } else if (w.state === "asking") {
            waiting++;
        }
    }
    return { working, waiting };
}
