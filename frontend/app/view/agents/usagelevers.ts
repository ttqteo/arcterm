// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Pure model for the Usage surface's Insights levers. Prices what each fix could recover from the By session rows
// (usagesessions.ts) as candidate sessions with a dollar saving each, through usagepricing (the one price table), and
// turns a saved analysis back into the views the card draws: a lever's total as a share of the window's spend, and its
// tabs. Every figure is an upper bound. Claude writes only the words (headline, a fix per lever, which Opus tabs were
// clear work, tips); the numbers are computed here. No React, no Wave runtime imports.

import { priceFor } from "./usagepricing";
import type { SessionRow } from "./usagesessions";
import { fmt } from "./usagestats";

export type LeverKey = "longctx" | "bigread" | "bigbash" | "opus" | "cold";
const LEVER_KEYS: LeverKey[] = ["longctx", "bigread", "bigbash", "opus", "cold"];

export const LONG_CTX_FROM = 200_000; // a session's average context above this is a long-context candidate
export const LONG_CTX_TARGET = 100_000; // the average the saving assumes it could have stayed at
export const MIN_SHARE = 0.01; // a lever under this share of the window's spend is not drawn
export const MAX_TABS = 5; // chips under a lever

const CHARS_PER_TOKEN = 4; // the estimate usagedigest.ts and pkg/usagestats use: a tool result carries no token count

// "S1" for the first of the rows: the id the digest and Claude name a session by, the same in every lever
export function sessionRef(index: number): string {
    return `S${index + 1}`;
}

// What one session could recover under one lever, with the evidence the card prints beside the lever
interface Hit {
    usd: number;
    count: number;
    tokens: number;
}

// An oversized result of `tool` is written to the cache once and re-read by every later turn that keeps it. A
// subagent's results carry no re-read figure (its turns cannot be told apart), so they count the write only.
function bigHit(row: SessionRow, tool: string): Hit {
    const price = row.mainModel != null ? priceFor(row.mainModel) : undefined;
    let usd = 0;
    let count = 0;
    let chars = 0;
    for (const g of row.bigResults) {
        if (g.tool !== tool) continue;
        count += g.count;
        chars += g.chars;
        if (price == null) continue;
        const reread = g.sub ? 0 : (g.rereadtokens ?? 0);
        usd += ((g.chars / CHARS_PER_TOKEN) * price.cacheWrite1h + reread * price.cacheRead) / 1_000_000;
    }
    return { usd, count, tokens: chars / CHARS_PER_TOKEN };
}

// Per lever, the saving of one session. Subagent spend is no lever: subagents keep bulk reading out of the main context.
const HIT: Record<LeverKey, (row: SessionRow) => Hit> = {
    longctx: (r) => ({
        usd: r.avgCtx > LONG_CTX_FROM ? (r.spendUsd - r.subSpendUsd) * (1 - LONG_CTX_TARGET / r.avgCtx) : 0,
        count: 1,
        tokens: r.avgCtx,
    }),
    bigread: (r) => bigHit(r, "Read"),
    bigbash: (r) => bigHit(r, "Bash"),
    opus: (r) => ({ usd: Math.max(0, (r.opusSpendUsd ?? 0) - (r.opusAsSonnetUsd ?? 0)), count: 1, tokens: 0 }),
    cold: (r) => ({ usd: r.coldSpendUsd, count: r.coldResumes, tokens: 0 }),
};

// The candidates Analyze sends: every lever with a session it could recover spend from, sessions by saving. A
// session's ref is S + its 1-based place in `rows` (sorted by spend), the same in every lever and the digest.
export function buildLevers(rows: SessionRow[]): UsageLever[] {
    const levers: UsageLever[] = [];
    for (const key of LEVER_KEYS) {
        const sessions: UsageLeverSession[] = [];
        let count = 0;
        let tokens = 0;
        rows.forEach((row, i) => {
            const hit = HIT[key](row);
            if (!(hit.usd > 0)) return;
            sessions.push({ ref: sessionRef(i), id: row.id, title: row.title, saveusd: hit.usd });
            count += hit.count;
            tokens += hit.tokens;
        });
        if (sessions.length === 0) continue;
        sessions.sort((a, b) => b.saveusd - a.saveusd); // stable: equal savings keep row order
        // longctx's evidence is the mean context of its tabs; the others' a sum
        const evidence = key === "longctx" ? tokens / sessions.length : tokens;
        levers.push({ key, count, tokens: Math.round(evidence), sessions });
    }
    return levers;
}

export interface LeverView {
    key: LeverKey;
    totalUsd: number;
    share: number; // of the saved spendusd, 0..1
    count: number;
    tokens: number;
    fix?: string;
    tabs: UsageLeverSession[]; // at most MAX_TABS: Claude's tabs, else the heaviest sessions; for opus, opusclear
    more: number; // sessions beyond `tabs`
}

function isLeverKey(key: string): key is LeverKey {
    return (LEVER_KEYS as string[]).includes(key);
}

function unique(refs: string[]): string[] {
    return [...new Set(refs)];
}

function bySaving(a: UsageLeverSession, b: UsageLeverSession): number {
    return b.saveusd - a.saveusd;
}

function viewOf(
    key: LeverKey,
    l: UsageLever,
    opusclear: string[],
    byRef: Map<string, UsageLeverSession>,
    spend: number
): LeverView {
    const all = l.sessions ?? [];
    const own = new Map(all.map((s) => [s.ref, s]));
    let counted = all; // the sessions the total sums
    let tabs: UsageLeverSession[];
    let count = l.count ?? 0;
    if (key === "opus") {
        // an Opus session counts only when Claude read its title as clear work Sonnet would do
        counted = unique(opusclear)
            .map((ref) => own.get(ref))
            .filter((s): s is UsageLeverSession => s != null);
        tabs = counted.slice(0, MAX_TABS);
        count = counted.length;
    } else {
        // a tab Claude took from another lever's table still names a real session; one no lever has is dropped
        const named = unique(l.tabs ?? [])
            .map((ref) => own.get(ref) ?? byRef.get(ref))
            .filter((s): s is UsageLeverSession => s != null);
        tabs = named.length > 0 ? named.slice(0, MAX_TABS) : [...all].sort(bySaving).slice(0, MAX_TABS);
    }
    const totalUsd = counted.reduce((sum, s) => sum + s.saveusd, 0);
    return {
        key,
        totalUsd,
        share: spend > 0 ? totalUsd / spend : 0,
        count,
        tokens: l.tokens ?? 0,
        fix: l.fix || undefined,
        tabs,
        more: Math.max(0, counted.length - tabs.length),
    };
}

// The levers a saved result draws: opus totals only the opusclear sessions; under MIN_SHARE hidden; largest first.
export function leverViews(ins: UsageInsights): LeverView[] {
    const levers = ins.levers ?? [];
    const byRef = new Map<string, UsageLeverSession>();
    for (const l of levers) {
        for (const s of l.sessions ?? []) {
            if (!byRef.has(s.ref)) byRef.set(s.ref, s);
        }
    }
    const spend = ins.spendusd ?? 0;
    const opusclear = ins.opusclear ?? [];
    const views: LeverView[] = [];
    for (const l of levers) {
        if (!isLeverKey(l.key)) continue;
        const view = viewOf(l.key, l, opusclear, byRef, spend);
        if (view.share >= MIN_SHARE) views.push(view);
    }
    return views.sort((a, b) => b.totalUsd - a.totalUsd); // stable: equal totals keep the saved order
}

// The General tips option's key beside the levers' own, in the card's selection and its data-usage-lever attributes
export const TIPS_KEY = "tips";

// The key the card shows selected. The saved key may be gone (another result, a hidden lever, no tips any more): then the
// first lever, or tips when no lever is drawn. Undefined when the card has nothing to select.
export function selectedLeverKey(saved: string | undefined, views: LeverView[], hasTips: boolean): string | undefined {
    if (saved === TIPS_KEY && hasTips) return TIPS_KEY;
    if (saved != null && views.some((v) => v.key === saved)) return saved;
    return views[0]?.key ?? (hasTips ? TIPS_KEY : undefined);
}

function plural(n: number, one: string, many: string): string {
    return `${n} ${n === 1 ? one : many}`;
}

// What a lever's evidence reads beside its title: "41 tabs, avg 314K", "316 results, ≈2.5M tokens", "9 tabs", "48 resumes".
// Numbers go through usagestats' fmt, as every figure on the Usage surface does.
export function leverEvidence(v: Pick<LeverView, "key" | "count" | "tokens">): string {
    switch (v.key) {
        case "longctx":
            return `${plural(v.count, "tab", "tabs")}, avg ${fmt(v.tokens)}`;
        case "bigread":
        case "bigbash":
            return `${plural(v.count, "result", "results")}, ≈${fmt(v.tokens)} tokens`;
        case "opus":
            return plural(v.count, "tab", "tabs");
        case "cold":
            return plural(v.count, "resume", "resumes");
    }
}

// A saved analysis with something to show: markdown (saved before levers) or a headline.
export function hasInsights(ins: UsageInsights | undefined): boolean {
    return ins != null && (!!ins.markdown || !!ins.headline);
}
