// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The avatar popup's item view, decided: what its buttons, hints and keys do for a kind and the facts its body
// reported. Pure; peekitem.tsx renders it.

import type { PeekFacts, PeekTarget } from "./peekstore";

type PeekKind = PeekTarget["kind"];

// the word a kind goes by in the item view, which for an effort and a radar report is not its code name
const KIND_NOUN: Record<PeekKind, string> = {
    run: "run",
    agent: "agent",
    record: "record",
    effort: "initiative",
    radar: "finding",
    note: "note",
};

// a note has no surface to open on, so the peek is all there is of it
const VIEW_ONLY: ReadonlySet<PeekKind> = new Set<PeekKind>(["note"]);

export function kindNoun(kind: PeekKind): string {
    return KIND_NOUN[kind];
}

export function openLabel(kind: PeekKind): string {
    return `Open ${KIND_NOUN[kind]}`;
}

export function goneLine(kind: PeekKind): string {
    return `That ${KIND_NOUN[kind]} no longer exists`;
}

export type ButtonState = "enabled" | "disabled" | "absent";

// Loading (no facts yet) and a vanished target both disable Open, and a view-only kind has no Open at all.
export function itemButtons(kind: PeekKind, facts: PeekFacts | null): { open: ButtonState } {
    if (VIEW_ONLY.has(kind)) {
        return { open: "absent" };
    }
    return { open: facts == null || facts.gone ? "disabled" : "enabled" };
}

export type ItemHint = { keys: string[]; label: string };

export function itemHints(kind: PeekKind, facts: PeekFacts | null): ItemHint[] {
    const buttons = itemButtons(kind, facts);
    return [
        ...(buttons.open !== "absent" ? [{ keys: ["↵"], label: openLabel(kind).toLowerCase() }] : []),
        { keys: ["⌫"], label: "back" },
        { keys: ["esc"], label: "close" },
    ];
}

export type ItemKeyCommand = "open" | "back" | "close";

export function itemKeyCommand(key: string): ItemKeyCommand | null {
    switch (key) {
        case "Enter":
            return "open";
        case "Backspace":
            return "back";
        case "Escape":
            return "close";
        default:
            return null;
    }
}
