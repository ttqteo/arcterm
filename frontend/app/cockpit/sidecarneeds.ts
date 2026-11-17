// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What waits on you in Sidecar (spec 2026-11-17-sidecar-orbit-dashboard-design.md, "What waits on you"): the asks the
// snapshot carries, a finished agent whose last message ends in a question (a heuristic: never a 1-9 answer), and what
// Jarvis holds for you (attentionAtom's jarvis half). One list, oldest first. Pure.

import { IDLE_GRACE_MS, type AgentEntry } from "@/app/view/agents/agentsviewmodel";
import { kindWord } from "@/app/view/jarvis/briefingmodel";
import type { SidecarNeed, SidecarTile } from "./sidecartypes";

const FENCE = /```[\s\S]*?```/g;
// closing marks a question may carry after its "?": markdown emphasis, code, quotes, brackets
const TRAILING = /[\s*_`"'”’)\]»]+$/;

/** The last sentence of `text` when it ends in a question mark (ASCII or full-width), else null. */
export function endsInQuestion(text: string): string | null {
    const t = text.replace(FENCE, "").replace(TRAILING, "");
    if (!t.endsWith("?") && !t.endsWith("？")) {
        return null;
    }
    const body = t.slice(0, -1);
    const cut = Math.max(...[".", "!", "?", "？", "。", "\n"].map((c) => body.lastIndexOf(c)));
    const sentence = t.slice(cut + 1).trim();
    return sentence === "" ? null : sentence;
}

/** The question an agent's last message ends on, unless the person has written to it since. */
export function lastQuestion(entries: readonly AgentEntry[]): string | null {
    for (let i = entries.length - 1; i >= 0; i--) {
        const e = entries[i];
        if (e.kind === "user") {
            return null;
        }
        if (e.kind === "message") {
            return endsInQuestion(e.text);
        }
    }
    return null;
}

export interface NeedsInput {
    tiles: readonly SidecarTile[]; // the whole roster's tiles (the base snapshot), not the orbit's 8
    entriesById: Readonly<Record<string, AgentEntry[]>>; // per agent: entriesToShow(live, previousInfo) (decision 4)
    jarvis: readonly AttentionItem[];
    now: number; // UnixMilli: the `since` of a tile that has none
}

function isFailedItem(i: AttentionItem): boolean {
    return i.kind === "run-unverified" || (i.kind === "dag-blocked" && i.retry === true);
}

export function sidecarNeeds(input: NeedsInput): SidecarNeed[] {
    const asks: SidecarNeed[] = [];
    const questions: SidecarNeed[] = [];
    for (const t of input.tiles) {
        if (t.state === "asking" && t.ask != null) {
            const n: SidecarNeed = {
                key: `ask:${t.id}`,
                kind: "ask",
                id: t.id,
                who: t.name,
                since: t.since ?? input.now,
                text: t.ask.question,
                options: t.ask.options,
                answerable: t.ask.answerable,
            };
            if (t.ask.key != null) {
                n.askKey = t.ask.key;
            }
            if (t.sent) {
                n.sent = true;
            }
            asks.push(n);
        } else if (
            t.state === "review" ||
            (t.state === "idle" && input.now - (t.since ?? input.now) <= IDLE_GRACE_MS)
        ) {
            const q = lastQuestion(input.entriesById[t.id] ?? []);
            if (q != null) {
                questions.push({
                    key: `q:${t.id}`,
                    kind: "question",
                    id: t.id,
                    who: t.name,
                    since: t.since ?? input.now,
                    text: q,
                });
            }
        }
    }
    // AttentionItem.waitingsince is UnixMilli (pkg/jarvis/attention.go: WaitingSince is a message Ts or d.UnixMilli()),
    // the same clock as a tile's `since`, so the two sources sort together.
    const jarvis: SidecarNeed[] = input.jarvis
        .filter((i) => i.kind !== "ask")
        .map((i) => {
            const n: SidecarNeed = {
                key: i.key,
                kind: "jarvis",
                who: i.channelname || i.source,
                since: i.waitingsince,
                text: i.text,
                word: kindWord(i.kind, i.retry),
            };
            if (isFailedItem(i)) {
                n.failed = true;
            }
            return n;
        });
    // a stable sort: equal ages keep asks, then questions, then Jarvis
    return [...asks, ...questions, ...jarvis].sort((a, b) => a.since - b.since);
}
