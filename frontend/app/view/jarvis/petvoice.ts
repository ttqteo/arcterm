// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What Jarvis has to say right now: at most one utterance per call, chosen from the events past the
// last-seen watermark. Pure, for the same reason as petcondition.ts — the bubble is a renderer.
//
// Two rules from the design (§3):
//   - Push once per event, then wait. One utterance, never a digest.
//   - Report each thing once. An event whose `reportedAsCondition` is true is already visible in the
//     condition level, so it is skipped here — but it still advances the watermark, because it *was*
//     reported. Speaking it too would count the gardener's sweep twice.

// Where a knowledge utterance points. `ref` is a frontend navigation address (see openref.ts), which
// may carry a vault node id inside an oref-shaped string — the same thing askAboutRecord already does
// with "task:"+dossierId. `anchor` names a sub-object to highlight within `ref`, which is how a
// decision addresses its parent record's thread: decisionlog.tsx renders it, so it has no route of
// its own.
export interface PetEventSource {
    ref: string;
    anchor?: string;
    title: string;
    sourceType: string; // dossier | decision | memory | run
}

export interface PetEvent {
    id: string; // stable across reloads; the watermark compares against it
    at: number; // epoch ms
    kind:
        | "resume"
        | "sweep"
        | "distill-batch"
        | "bg-agent-done"
        // volunteered knowledge: what Jarvis knows about your work, not what the system did
        | "connection"
        | "loose-end"
        | "ledger"
        // announcement channels: notifications and pending agent questions
        | "notify"
        | "ask"
        // a well-known line, said only when there is nothing else to say (petquotes.ts); never listed in the peek
        | "quote";
    text: string;
    // message body / question body — the bubble shows only `text`; the peek renders this dimmed
    detail?: string;
    // a notification's level, which is the only register that names one
    level?: NotifyLevel;
    // address of the thing that raised this event (an ask's block oref) — carried for the peek to open
    ref?: string;
    reportedAsCondition?: boolean;
    // Set on any utterance that has products to open: volunteered knowledge carries one, a distillation
    // pass carries the notes it wrote. An utterance with none is either housekeeping that produced nothing
    // openable, or (for a pass) not said at all — see petjoin.ts.
    sources?: PetEventSource[];
}

export type NotifyLevel = "info" | "warn" | "error";

// What register the utterance came from, in the design's own words. One table for the bubble and the peek,
// so the two cannot name the same event differently.
const KIND_LABEL: Record<PetEvent["kind"], string> = {
    resume: "Where we were",
    sweep: "While you were out",
    "distill-batch": "While you were out",
    "bg-agent-done": "While you were out",
    connection: "This just connected",
    "loose-end": "Still open",
    ledger: "Work state",
    notify: "Notice",
    ask: "Needs you",
    quote: "Quote",
};

const LEVEL_LABEL: Record<NotifyLevel, string> = {
    info: "Notice",
    warn: "Warning",
    error: "Error",
};

export function eventLabel(event: PetEvent): string {
    if (event.kind === "quote") {
        return event.detail || KIND_LABEL.quote; // the author
    }
    return event.kind === "notify" ? LEVEL_LABEL[event.level ?? "info"] : KIND_LABEL[event.kind];
}

// What the bubble says. A question names its agent, because the bubble stands in for the Needs-you toast, which did.
export function bubbleText(event: PetEvent): string {
    const agent = event.kind === "ask" ? event.sources?.[0]?.title : undefined;
    return agent ? `${agent}: ${event.text}` : event.text;
}

// How long the bubble stays: a Needs-you one as long as the toast it replaces, a quote long enough to read it, anything
// else a moment.
export function bubbleMs(event: PetEvent): number {
    return event.kind === "ask" ? 15_000 : event.kind === "quote" ? 10_000 : 6_000;
}

// The last event the creature considered, not merely the last one it said. Both fields are needed: `at`
// orders, and `id` breaks a same-millisecond tie so two events in one tick cannot silently collapse.
export interface PetWatermark {
    at: number;
    id: string;
}

export interface PetSpeech {
    // what to say now, or null for silence
    utterance: PetEvent | null;
    // the watermark to store once said, or null when there was nothing new to consider. It is the newest
    // event seen — not the one spoken — so a skipped condition-reported event is never re-offered.
    watermark: PetWatermark | null;
    // every new event worth remembering, newest first: one bubble speaks, but the peek reads back all of
    // them, so the rest of a burst is not lost behind the one that was said
    heard: PetEvent[];
}

const SILENCE: PetSpeech = { utterance: null, watermark: null, heard: [] };

function isNewer(a: { at: number; id: string }, b: { at: number; id: string }): boolean {
    return a.at !== b.at ? a.at > b.at : a.id > b.id;
}

export function nextUtterance(events: PetEvent[], seen: PetWatermark | null): PetSpeech {
    const unseen = (events ?? []).filter((e) => e != null && (seen == null || isNewer(e, seen)));
    if (unseen.length === 0) {
        return SILENCE;
    }
    // newest first: a backlog (a relaunch after a long absence) says the latest thing rather than
    // narrating twenty stale ones one bubble at a time. The rest are recoverable from the peek.
    const newestFirst = [...unseen].sort((a, b) => (isNewer(a, b) ? -1 : 1));
    const newest = newestFirst[0];
    const heard = newestFirst.filter((e) => e.reportedAsCondition !== true);
    return {
        utterance: heard[0] ?? null,
        watermark: { at: newest.at, id: newest.id },
        heard,
    };
}
