// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Cockpit's "Needs you" strip, as data. An ask is already a card in the Cockpit (a plain agent's, or a run
// card's answer bar), so the strip lists the other things that wait on you: a review gate, a blocked task, a run
// to acknowledge or land, an escalation. Each row carries what Jarvis's Waiting row does (attentionact.ts picks
// the one button), so the same item reads the same on both surfaces. Pure; needsyoustrip.tsx draws it.

import { attentionAct, type AttentionAct } from "@/app/view/jarvis/attentionact";
import type { AttentionRunRow } from "@/app/view/jarvis/attentionrun";
import { formatAge, type AgentVM } from "./agentsviewmodel";
import { normProjectPath } from "./channelderive";
import { parseCardData } from "./jarviscards";

const KIND_LABEL: Record<string, string> = {
    "dag-gate": "Review task",
    "dag-blocked": "Blocked task",
    "run-unverified": "Run to confirm",
    "run-land-held": "Run to land",
    escalation: "Escalation",
};

export type StripOpen =
    // an escalation whose asking agent is in the roster: its card, where the ask is answered
    | { kind: "agent"; agentId: string }
    // the run's sheet, or the channel's newest when the item names no run (what Jarvis's Open does)
    | { kind: "channel"; channelId: string; runId: string | null };

export interface StripRow {
    key: string;
    kindLabel: string;
    tone: "asking" | "error";
    source: string;
    text: string;
    why: string;
    waitingSince: number | null;
    act: AttentionAct;
    run: AttentionRunRow;
    open: StripOpen | null;
}

const ESCALATION_PREFIX = "esc:";

// "tab:abc" -> "abc" when the oref is of that type
function idOf(oref: string | undefined, otype: string): string {
    return oref != null && oref.startsWith(otype + ":") ? oref.slice(otype.length + 1) : "";
}

/** Pure: the agent an escalation is about, if it is still in the roster. The server's item names the card's
 *  message (`esc:<message id>`); the card names the worker's tab and the ask's block, both of which the roster
 *  knows. A card older than the channel's message window, or an agent that has since ended, finds nothing. */
export function escalationAgent(
    item: AttentionItem,
    messages: ChannelMessage[] | undefined,
    roster: ReadonlyArray<AgentVM>
): AgentVM | undefined {
    if (item.kind !== "escalation" || !item.key.startsWith(ESCALATION_PREFIX)) {
        return undefined;
    }
    const id = item.key.slice(ESCALATION_PREFIX.length);
    const msg = (messages ?? []).find((m) => m.id === id);
    const card = msg != null ? parseCardData(msg) : null;
    if (card == null) {
        return undefined;
    }
    const tabId = idOf(card.workerORef, "tab");
    const blockId = idOf(card.askORef, "block");
    return (
        (tabId !== "" ? roster.find((a) => a.id === tabId) : undefined) ??
        (blockId !== "" ? roster.find((a) => a.blockId === blockId) : undefined)
    );
}

/** Pure: each channel's registered project, by the project path the channel is bound to. A project filter is a
 *  registry name, so this is the only join that scopes an item by project. A channel the registry cannot name
 *  (no path, an unregistered or since-removed project) is left out. */
export function channelProjects(
    channels: Channel[] | null | undefined,
    registry: Record<string, { path?: string }> | null | undefined
): Map<string, string> {
    const byPath = new Map<string, string>();
    for (const [name, p] of Object.entries(registry ?? {})) {
        if (p?.path) {
            byPath.set(normProjectPath(p.path), name);
        }
    }
    const out = new Map<string, string>();
    for (const c of channels ?? []) {
        const name = c.projectpath ? byPath.get(normProjectPath(c.projectpath)) : undefined;
        if (name != null) {
            out.set(c.oid, name);
        }
    }
    return out;
}

/** Pure: the strip's rows, in the server's order (gates, escalations, then runs to acknowledge), scoped by the
 *  Cockpit's project filter like its grid. Under one project an item whose channel resolves to no project is
 *  left out; under all it shows. */
export function buildNeedsYouRows(input: {
    attention: AttentionItem[];
    filter: string;
    channelProject: Map<string, string>;
    channelMessages: Record<string, ChannelMessage[]>;
    roster: AgentVM[];
}): StripRow[] {
    const rows: StripRow[] = [];
    for (const a of input.attention ?? []) {
        if (!(a.kind in KIND_LABEL)) {
            continue;
        }
        const channelId = a.channelid ?? "";
        if (input.filter !== "all" && input.channelProject.get(channelId) !== input.filter) {
            continue;
        }
        const run: AttentionRunRow = {
            wireKind: a.kind,
            channelId,
            runId: a.runid || null,
            taskId: a.taskid ?? "",
            retry: a.retry === true,
            source: a.source,
            title: a.text,
        };
        const agent = escalationAgent(a, input.channelMessages[channelId], input.roster);
        rows.push({
            key: a.key,
            kindLabel: KIND_LABEL[a.kind],
            tone: a.kind === "dag-blocked" ? "error" : "asking",
            source: a.source,
            text: a.text,
            why: a.why ?? "",
            waitingSince: a.waitingsince > 0 ? a.waitingsince : null,
            act: attentionAct(run),
            run,
            open:
                agent != null
                    ? { kind: "agent", agentId: agent.id }
                    : channelId !== ""
                      ? { kind: "channel", channelId, runId: run.runId }
                      : null,
        });
    }
    return rows;
}

/** Pure: how long an item has waited, as the cockpit's other ages read ("just now", "5m", "3h"). */
export function stripAge(waitingSince: number | null, now: number): string {
    return waitingSince == null ? "" : formatAge(Math.max(0, now - waitingSince));
}
