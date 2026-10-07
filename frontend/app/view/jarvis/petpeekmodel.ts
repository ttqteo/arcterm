// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What the peek's body shows: one row per waiting item the creature can act on, and the spoken updates that
// are not already one of those rows. Pure, like petcondition.ts — petpeek.tsx is a renderer, not the thing
// that decides.

import { inlineAnswerOptions } from "@/app/cockpit/palette-needs";
import type { AgentVM } from "@/app/view/agents/agentsviewmodel";
import { escalationAgent } from "@/app/view/agents/needsyoustripmodel";
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
    // the row's button, labelled with the item's own verb: an unverified run's in-place ack, a held land's
    // retry, otherwise the escort. null when nothing is addressable behind the item.
    primary: PetAct | null;
    // the acts beside the button: the escort, so settling a row in place does not cost the way to read it
    // first, and a held land's Dismiss
    links: PetAct[];
    // a question one key answers: its options, in order, so digit n sends answers[n - 1]. [] for every other row
    answers: PetAct[];
}

// pkg/jarvis/attention.go writes Text per kind, and only these put anything in it that the row's own verb
// does not already say: an escalation's and an ask's question (askText), a blocked dag's reason, and why a land
// was held, which is what the human has to clear before Land again can merge (or that says to dismiss it).
// A dag-gate's "Approve <task> before the DAG proceeds." says what its verb already does, so it is dropped and
// the width goes to the source — the part that differs.
const DETAIL_KINDS = new Set(["escalation", "dag-blocked", "ask", "run-land-held"]);

// A row names its kind in a word beside its dot, so the kind never rides on colour alone.
const ROW_KIND_LABEL: Record<string, string> = {
    "dag-gate": "Gate",
    escalation: "Escalation",
    "dag-blocked": "Blocked",
    ask: "Question",
    "run-land-held": "Land held",
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

// The agent a question waits in: an ask by its block, an escalation through its card in the channel's messages
// (the Cockpit's Needs-you strip joins it the same way). A card older than the loaded messages finds nothing.
function askingAgent(
    item: AttentionItem,
    agents: ReadonlyArray<AgentVM>,
    messages: Record<string, ChannelMessage[]>
): AgentVM | undefined {
    if (item.kind === "ask") {
        return askAgent(agents, item.key.slice("ask:".length));
    }
    return escalationAgent(item, messages[item.channelid ?? ""], agents);
}

// The same options and the same send as the Cockpit's answer bar and the palette's digits.
function answersFor(item: AttentionItem, agent: AgentVM | undefined): PetAct[] {
    if (agent == null) {
        return [];
    }
    return inlineAnswerOptions(agent).map((label, option) => ({
        id: `${item.key}:answer:${option + 1}`,
        verb: "answer",
        label,
        agentId: agent.id,
        option,
    }));
}

// Radar triage is the one attention kind the creature has no business holding. It names no channel and no
// run, so it arrives with no act behind it (petacts.actsForAttention) and renders as a project name, an age
// and nothing to press; the avatar's own signals never counted it either (petview.usePetSignals reads
// gates, escalations and asks). It is addressed through its ORef by the Radar rail's badge and the Brief's
// queue, which is the same routing splitAttention already does to keep it off Cockpit.
const PEEK_EXCLUDED_KIND = "radar-triage";

export function queueRows(
    items: AttentionItem[],
    agents: ReadonlyArray<AgentVM> = [],
    messages: Record<string, ChannelMessage[]> = {}
): PeekRow[] {
    return (items ?? [])
        .filter((item) => item.kind !== PEEK_EXCLUDED_KIND)
        .map((item) => {
            // actsForAttention returns [] with no runid, [in-place act, escort] for a dag gate, a retryable failed
            // task or an unverified run, [land, dismiss, escort] for a held land, [escort] otherwise
            const [first, ...links] = actsForAttention(item);
            const answers = answersFor(item, askingAgent(item, agents, messages));
            // "Review" / "Decide" / "Answer" is the same navigation as "Open", named by what it is for. An
            // in-place act keeps its own label: the item's action ("Review") names the escort, not the
            // approve, retry, ack or land. Where the options answer, the escort is only the way to read it.
            const escortLabel = answers.length > 0 ? "Open" : item.action;
            const primary = first ?? answerInAgent(item, agents);
            return {
                key: item.key,
                kind: item.kind,
                source: item.source,
                detail: DETAIL_KINDS.has(item.kind) ? item.text : null,
                waitingsince: item.waitingsince,
                primary: primary?.verb === "open" ? { ...primary, label: escortLabel } : primary,
                links,
                answers,
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

// A bare digit answers the focused row with that option, as on the Cockpit's answer bar.
export function peekAnswerAct(row: PeekRow | undefined, key: string): PetAct | null {
    if (!/^[1-9]$/.test(key)) {
        return null;
    }
    return row?.answers[Number(key) - 1] ?? null;
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
    const escort = [row?.primary, ...(row?.links ?? [])].find((act) => act?.verb === "open");
    return escort?.verb === "open" ? escort.target : null;
}

// The Enter hint names what Enter does to the focused row, which is not always a navigation.
export function enterHintLabel(act: PetAct | null): string {
    switch (act?.verb) {
        case "ack":
            return "acknowledge";
        case "land":
            return "land again";
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
