// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What the peek's body shows: one row per waiting item the creature can act on, and the spoken updates that
// are not already one of those rows. Pure, like petcondition.ts — petpeek.tsx is a renderer, not the thing
// that decides.

import type { AgentVM } from "@/app/view/agents/agentsviewmodel";
import { actsForAttention, type PetAct, type PetTarget } from "./petacts";
import { conditionsFor, type PetExpression, type PetSignals } from "./petcondition";
import { askAgent } from "./petjoin";
import type { PetEvent, PetEventSource } from "./petvoice";

export interface PeekRow {
    key: string;
    kind: string;
    source: string;
    // null when the kind's text is a constant the verb already implies — see DETAIL_KINDS.
    detail: string | null;
    waitingsince: number;
    // the row's button, labelled with the item's own verb: an unverified run's in-place ack, otherwise the
    // escort. null when nothing is addressable behind the item.
    primary: PetAct | null;
    // the escort beside an ack, so settling a row in place does not cost the way to read it first
    secondary: PetAct | null;
}

// pkg/jarvis/attention.go writes Text per kind, and only these put anything in it that the row's own verb
// does not already say: an escalation's and an ask's question (askText), a blocked dag's reason, and why a land
// was held, which is what the human has to clear before Land again can merge. A gate's
// "Approve before Jarvis proceeds." and a dag-gate's near-twin are constants repeated on every row of that
// kind, so they are dropped and the width goes to the source — the part that differs.
const DETAIL_KINDS = new Set(["escalation", "dag-blocked", "ask", "run-land-held"]);

// A row names its kind in a word beside its dot, so the kind never rides on colour alone.
const ROW_KIND_LABEL: Record<string, string> = {
    gate: "Gate",
    "dag-gate": "Gate",
    escalation: "Escalation",
    "dag-blocked": "Blocked",
    ask: "Question",
    "run-land-held": "Not merged",
};

export function rowKindLabel(kind: string): string {
    return ROW_KIND_LABEL[kind] ?? kind;
}

// An ask with no run behind it is still answerable where it was raised: the agent's terminal, found by the
// ask's block oref (the item key is "ask:<block oref>") in the roster.
function answerInAgent(item: AttentionItem, agents: ReadonlyArray<AgentVM>): PetAct | null {
    if (item.kind !== "ask") {
        return null;
    }
    const agent = askAgent(agents, item.key.slice("ask:".length));
    if (agent == null) {
        return null;
    }
    return {
        id: `${item.key}:open`,
        verb: "open",
        label: item.action,
        target: { kind: "oref", ref: `agent:${agent.id}` },
    };
}

// Radar triage is the one attention kind the creature has no business holding. It names no channel and no
// run, so it arrives with no act behind it (petacts.actsForAttention) and renders as a project name, an age
// and nothing to press; the avatar's own signals never counted it either (petview.usePetSignals reads
// gates, escalations and asks). It is addressed through its ORef by the Radar rail's badge and the Brief's
// queue, which is the same routing splitAttention already does to keep it off Cockpit.
const PEEK_EXCLUDED_KIND = "radar-triage";

export function queueRows(items: AttentionItem[], agents: ReadonlyArray<AgentVM> = []): PeekRow[] {
    return (items ?? [])
        .filter((item) => item.kind !== PEEK_EXCLUDED_KIND)
        .map((item) => {
            // actsForAttention returns [] with no runid, [in-place act, escort] for a gate, a retryable failed
            // task, an unverified run or a held land, [escort] otherwise
            const [first, second] = actsForAttention(item);
            return {
                key: item.key,
                kind: item.kind,
                source: item.source,
                detail: DETAIL_KINDS.has(item.kind) ? item.text : null,
                waitingsince: item.waitingsince,
                // "Review" / "Decide" / "Answer" is the same navigation as "Open", named by what it is for. An
                // in-place act keeps its own label: the item's action ("Review") names the escort, not the
                // approve, retry, ack or land.
                primary:
                    first == null
                        ? answerInAgent(item, agents)
                        : first.verb === "open"
                          ? ({ ...first, label: item.action } as PetAct)
                          : first,
                secondary: second ?? null,
            };
        });
}

// An ask waiting on the user is both an AttentionItem keyed "ask:<block oref>" and a PetEvent carrying that
// oref in `ref`. The queue row is the actionable one, so the utterance yields to it — the pet design's
// crossing rule, applied to the only pair that can currently collide.
export function dedupeUpdates(events: PetEvent[], items: AttentionItem[]): PetEvent[] {
    const queued = new Set((items ?? []).filter((item) => item.kind === "ask").map((item) => item.key));
    return (events ?? []).filter(
        (event) => !(event.kind === "ask" && event.ref != null && queued.has(`ask:${event.ref}`))
    );
}

export type PeekKeyCommand = "next" | "previous" | "open" | "peek" | "composer" | "close";

export function peekKeyCommand(key: string): PeekKeyCommand | null {
    switch (key) {
        case "j":
        case "ArrowDown":
            return "next";
        case "k":
        case "ArrowUp":
            return "previous";
        case "Enter":
            return "open";
        case " ":
            return "peek";
        case "/":
            return "composer";
        case "Escape":
            return "close";
        default:
            return null;
    }
}

export function peekActForCommand(row: PeekRow | undefined, command: PeekKeyCommand): PetAct | null {
    if (row == null) {
        return null;
    }
    return command === "open" ? row.primary : null;
}

// What a click on an update shows in the popup: the first thing it carries. An update with nothing to open has
// nothing to peek either.
export function eventPeekTarget(event: { sources?: PetEventSource[] } | undefined): PetTarget | null {
    const source = event?.sources?.[0];
    return source != null ? { kind: "oref", ref: source.ref, anchor: source.anchor } : null;
}

// What Space on a queue row shows: where its escort would land, without landing there.
export function rowPeekTarget(row: PeekRow | undefined): PetTarget | null {
    const escort = [row?.primary, row?.secondary].find((act) => act?.verb === "open");
    return escort?.verb === "open" ? escort.target : null;
}

// The Enter hint names what Enter does to the focused row, which is not always a navigation.
export function enterHintLabel(act: PetAct | null): string {
    switch (act?.verb) {
        case "ack":
            return "acknowledge";
        case "land":
            return "land again";
        case "approve-phase":
        case "approve-task":
            return "approve";
        case "retry-task":
            return "retry";
        default:
            return "open";
    }
}

export interface PeekCondition {
    expr: PetExpression;
    // true only where the KIND has no remedy to offer
    readout: boolean;
}

// The rate-limit countdown has genuinely nothing to do (petacts.ts header), and a full RAM has no act here: its
// remedy is a smaller width at the next pick, which the line says. Naming them here rather than inferring it
// keeps "no remedy" and "no remedy yet" distinguishable.
const READOUT_KINDS = new Set<PetExpression["kind"]>(["tired", "ram-full"]);

// Every standing condition in rank order, each marked readout or not.
export function peekConditions(signals: PetSignals): PeekCondition[] {
    return conditionsFor(signals).map((expr) => ({
        expr,
        readout: READOUT_KINDS.has(expr.kind),
    }));
}
