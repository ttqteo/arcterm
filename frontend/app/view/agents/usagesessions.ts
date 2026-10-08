// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Pure model for the Usage surface's By session table. Folds the backend's per-session Claude usage
// (GetSessionUsageCommand) into rows: spend priced per model through usagepricing (the one price
// table), the session's share of the window's Claude spend, and the deterministic chips that say why
// a tab is expensive. No React, no Wave runtime imports.

import type { AgentVM } from "./agentsviewmodel";
import { sessionIdFromTranscript } from "./launch";
import { priceFor, spendOf } from "./usagepricing";

export type ChipKey = "large-context" | "cold-resumes" | "heavy-subagents" | "long-lived";
export const CHIP_LABEL: Record<ChipKey, string> = {
    "large-context": "large context",
    "cold-resumes": "cold resumes",
    "heavy-subagents": "heavy subagents",
    "long-lived": "long-lived",
};
export const LARGE_CTX = 200_000;
export const COLD_RESUMES = 3;
export const HEAVY_SUB = 0.5; // share of the session's spend
export const LONG_LIVED_MS = 24 * 3600_000;
export const SESSION_ROWS = 25;

export interface SessionRow {
    id: string;
    title: string; // "Untitled · <id 8>" when the session has no ai-title
    project: string;
    models: string[]; // distinct model ids, main first, without the "claude-" prefix
    tokens: number;
    spendUsd: number;
    subSpendUsd: number;
    share: number; // 0..1 of the window's Claude spend over every session
    avgCtx: number;
    maxCtx: number;
    coldResumes: number;
    coldSpendUsd: number; // coldTokens at the main model's 1h cache-write rate
    lifetimeMs: number;
    chips: ChipKey[];
    liveTabId?: string; // set when an open agent tab runs this session
}

function modelTokens(m: UsageSessionModel): number {
    return m.input + m.output + m.cacheread + m.cachecreate;
}

// A session model as a UsageRecord, so it prices through the same path as a usage bucket.
function modelSpend(m: UsageSessionModel): number {
    return spendOf({
        ts: 0,
        harness: "claude",
        provider: "anthropic",
        model: m.model,
        inputTokens: m.input,
        outputTokens: m.output,
        reasoningTokens: 0,
        cacheReadTokens: m.cacheread,
        cacheCreateTokens: m.cachecreate,
        cacheCreate1hTokens: m.cachecreate1h,
    });
}

// Distinct model ids ordered main first (by main tokens), then subagent-only models by their tokens.
function modelsOf(models: UsageSessionModel[]): { ids: string[]; main?: string } {
    const mainTokens = new Map<string, number>();
    const subTokens = new Map<string, number>();
    for (const m of models) {
        const into = m.sub ? subTokens : mainTokens;
        into.set(m.model, (into.get(m.model) ?? 0) + modelTokens(m));
    }
    const byTokens = (a: [string, number], b: [string, number]) => b[1] - a[1];
    const main = [...mainTokens.entries()].sort(byTokens).map(([id]) => id);
    const subOnly = [...subTokens.entries()]
        .filter(([id]) => !mainTokens.has(id))
        .sort(byTokens)
        .map(([id]) => id);
    return { ids: [...main, ...subOnly], main: main[0] };
}

function chipsOf(
    row: Pick<SessionRow, "avgCtx" | "coldResumes" | "spendUsd" | "subSpendUsd" | "lifetimeMs">
): ChipKey[] {
    const chips: ChipKey[] = [];
    if (row.avgCtx > LARGE_CTX) chips.push("large-context");
    if (row.coldResumes >= COLD_RESUMES) chips.push("cold-resumes");
    if (row.spendUsd > 0 && row.subSpendUsd / row.spendUsd > HEAVY_SUB) chips.push("heavy-subagents");
    if (row.lifetimeMs > LONG_LIVED_MS) chips.push("long-lived");
    return chips;
}

// One row per session, most expensive first. `live` maps a session id to the tab running it
// (liveSessionTabs).
export function buildSessionRows(sessions: UsageSession[], live: Map<string, string>): SessionRow[] {
    const partial = sessions.map((s) => {
        let spendUsd = 0;
        let subSpendUsd = 0;
        let tokens = 0;
        for (const m of s.models) {
            const sp = modelSpend(m);
            spendUsd += sp;
            if (m.sub) subSpendUsd += sp;
            tokens += modelTokens(m);
        }
        const { ids, main } = modelsOf(s.models);
        const coldRate = main != null ? (priceFor(main)?.cacheWrite1h ?? 0) : 0;
        const lifetimeMs = Math.max(0, s.lastts - s.firstts);
        const row = {
            id: s.id,
            title: s.title || `Untitled · ${s.id.slice(0, 8)}`,
            project: s.project,
            models: ids.map((id) => id.replace(/^claude-/, "")),
            tokens,
            spendUsd,
            subSpendUsd,
            avgCtx: s.avgctx,
            maxCtx: s.maxctx,
            coldResumes: s.coldresumes,
            coldSpendUsd: (s.coldtokens * coldRate) / 1_000_000,
            lifetimeMs,
        };
        return { ...row, chips: chipsOf(row) };
    });
    const total = partial.reduce((sum, r) => sum + r.spendUsd, 0);
    return partial
        .map((r): SessionRow => {
            const row: SessionRow = { ...r, share: total > 0 ? r.spendUsd / total : 0 };
            const tab = live.get(r.id);
            if (tab != null) row.liveTabId = tab;
            return row;
        })
        .sort((a, b) => b.spendUsd - a.spendUsd || a.id.localeCompare(b.id));
}

// The table's first SESSION_ROWS rows, or all of them once "Show all" is on.
export function visibleSessionRows(rows: SessionRow[], showAll: boolean): SessionRow[] {
    return showAll ? rows : rows.slice(0, SESSION_ROWS);
}

// Session id -> the tab running it, for the open Claude agents (the roster's own agents: not plain
// terminals, not detached background agents, which have no tab). A claude agent's session id is the
// stem of its transcript filename.
export function liveSessionTabs(
    agents: Pick<AgentVM, "id" | "agent" | "kind" | "transcriptPath">[]
): Map<string, string> {
    const live = new Map<string, string>();
    for (const a of agents) {
        if ((a.agent || "claude") !== "claude" || (a.kind != null && a.kind !== "agent")) {
            continue;
        }
        const sessionId = sessionIdFromTranscript(a.transcriptPath);
        if (sessionId) {
            live.set(sessionId, a.id);
        }
    }
    return live;
}
