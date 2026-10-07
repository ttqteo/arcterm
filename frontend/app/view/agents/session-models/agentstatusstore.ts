// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import * as WOS from "@/app/store/wos";
import { waveEventSubscribeSingle } from "@/app/store/wps";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { fireAndForget } from "@/util/util";
import { atom, type PrimitiveAtom } from "jotai";
import { blockLoginEmail, claudeIdentityAtom, rateLimitKey, recordRateLimit } from "../ratelimitstore";
import { persistResume } from "./agentresumestore";

function invertPct(pct: number | undefined): number | undefined {
    if (pct == null) {
        return undefined;
    }
    return Math.max(0, Math.min(100, 100 - pct));
}

// Stable identity/context fields carried on some events but not others (the Claude hook omits
// title+model on Notification/AskUserQuestion; the backend worker emitters carry only state+agent).
// State events are deltas, so an omitted field means "unchanged", not "cleared" — a full replacement
// would wipe the retained title and drop the row label back to the project name until the next
// titled event, i.e. the rename flicker. detail/ts are always transient (current activity / event
// time) and are never retained.
const RETAINED_FIELDS = ["title", "model", "agent", "provider", "cwd", "transcriptpath", "sessionid"] as const;

/** Pure: fold a state-delta event onto the previous status, keeping last-known values for fields the
 *  event omits. null prev (first event) passes through unchanged. */
export function mergeAgentStatusData(prev: AgentStatusData | null, next: AgentStatusData): AgentStatusData {
    if (!prev) {
        return next;
    }
    const merged: AgentStatusData = { ...next };
    for (const field of RETAINED_FIELDS) {
        if (!merged[field]) {
            merged[field] = prev[field];
        }
    }
    return merged;
}

export function normalizeAgentUsage(provider: string, usage: AgentUsage): AgentUsage {
    if (provider.toLowerCase() !== "codex") {
        return usage;
    }
    return {
        ...usage,
        contextpct: invertPct(usage.contextpct),
        fivehourpct: invertPct(usage.fivehourpct),
        weekpct: invertPct(usage.weekpct),
    };
}

/** Pure: what a block's status atom holds once its retained last event arrives after a reload. A live event
 *  that beat the read wins, since it is newer by construction; an event without a state seeds nothing. */
export function seedAgentStatus(
    current: AgentStatusData | null,
    retained: AgentStatusData | null | undefined
): AgentStatusData | null {
    if (current != null || retained == null || !retained.state) {
        return current;
    }
    return retained;
}

// Set once the subscription is up: reads a block's retained agent:status the first time its atom is created, so
// a reload does not empty the roster until every agent's next hook event. Unset in tests and before boot, so
// creating an atom stays pure there.
let seedStatus: ((oref: string, statusAtom: PrimitiveAtom<AgentStatusData>) => void) | null = null;

// Orefs whose retained-status read has finished — found a status, found none, or failed. The roster's
// first-load gate (liveagents.ts) waits on these, so a failed read has to settle too.
export const seededOrefsAtom = atom<ReadonlySet<string>>(new Set<string>()) as PrimitiveAtom<ReadonlySet<string>>;

function readRetainedStatus(oref: string, statusAtom: PrimitiveAtom<AgentStatusData>) {
    fireAndForget(async () => {
        try {
            const events = await RpcApi.EventReadHistoryCommand(TabRpcClient, {
                event: "agent:status",
                scope: oref,
                maxitems: 1,
            });
            const retained = events?.[events.length - 1]?.data as AgentStatusData | undefined;
            globalStore.set(statusAtom, (prev) => seedAgentStatus(prev, retained));
        } catch (err) {
            console.warn(`reading the retained agent:status of ${oref} failed`, err);
        } finally {
            globalStore.set(seededOrefsAtom, (prev) => new Set(prev).add(oref));
        }
    });
}

// keyed by block ORef string ("block:<uuid>")
const agentStatusAtoms = new Map<string, PrimitiveAtom<AgentStatusData>>();

export function getAgentStatusAtom(oref: string): PrimitiveAtom<AgentStatusData> {
    let statusAtom = agentStatusAtoms.get(oref);
    if (!statusAtom) {
        statusAtom = atom(null) as PrimitiveAtom<AgentStatusData>;
        agentStatusAtoms.set(oref, statusAtom);
        seedStatus?.(oref, statusAtom);
    }
    return statusAtom;
}

// per-block latest usage snapshot (context %, cost, plan rate limits); set by usage-only events
const agentUsageAtoms = new Map<string, PrimitiveAtom<AgentUsage>>();

export function getAgentUsageAtom(oref: string): PrimitiveAtom<AgentUsage> {
    let usageAtom = agentUsageAtoms.get(oref);
    if (!usageAtom) {
        usageAtom = atom(null) as PrimitiveAtom<AgentUsage>;
        agentUsageAtoms.set(oref, usageAtom);
    }
    return usageAtom;
}

// per-block manual expand override (undefined = auto). Reset to undefined on the parent's idle transition.
const subagentExpandAtoms = new Map<string, PrimitiveAtom<boolean>>();

export function getSubagentExpandAtom(oref: string): PrimitiveAtom<boolean> {
    let expandAtom = subagentExpandAtoms.get(oref);
    if (!expandAtom) {
        expandAtom = atom(undefined) as PrimitiveAtom<boolean>;
        subagentExpandAtoms.set(oref, expandAtom);
    }
    return expandAtom;
}

export function toggleSubagentExpand(oref: string, currentlyExpanded: boolean) {
    if (!oref) {
        return;
    }
    globalStore.set(getSubagentExpandAtom(oref), !currentlyExpanded);
}

let subscribed = false;
export function setupAgentStatusSubscription() {
    if (subscribed) {
        return;
    }
    subscribed = true;
    seedStatus = readRetainedStatus;
    // atoms made before the subscription existed are seeded now
    for (const [oref, statusAtom] of agentStatusAtoms) {
        seedStatus(oref, statusAtom);
    }
    waveEventSubscribeSingle({
        eventType: "agent:status",
        handler: (event) => {
            const data = event.data as AgentStatusData;
            if (data?.oref == null) {
                return;
            }
            if (data.usage != null) {
                const provider = data.agent ?? globalStore.get(getAgentStatusAtom(data.oref))?.agent ?? "claude";
                const usage = normalizeAgentUsage(provider, data.usage);
                globalStore.set(getAgentUsageAtom(data.oref), usage);
                // persist account-level windows so the Usage donuts survive idle (no-op if none present)
                // a Default agent's windows are its /login account's as of when it started: the email its block
                // was stamped with, which can differ from the current /login one. An unloaded block has none
                const loginEmail = blockLoginEmail(globalStore.get(WOS.getWaveObjectAtom<Block>(data.oref)));
                recordRateLimit(
                    rateLimitKey(provider, usage.account, globalStore.get(claudeIdentityAtom), loginEmail),
                    usage
                );
            }
            // a delta-only event carries an empty state; only a real state update should touch the parent atom
            if (data.state) {
                const prev = globalStore.get(getAgentStatusAtom(data.oref));
                globalStore.set(getAgentStatusAtom(data.oref), mergeAgentStatusData(prev, data));
                // resume-on-reopen: bake this session's resume key into the block's launch command
                void persistResume(data.oref, data.agent, data.transcriptpath, data.sessionid);
                if (data.state === "idle") {
                    // turn ended: reset the manual subagent-expand override (disk-backed list persists)
                    globalStore.set(getSubagentExpandAtom(data.oref), undefined);
                }
            }
        },
    });
}
