// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Agent details rail's compaction line: the compactions in a transcript's tail (Claude's compact_boundary records
// with the summary Claude Code writes after each, or pi's compaction records), and the words the rail's session block
// says about the last one. Chat draws the same records as a thin Compacted divider (transcriptprojection.ts) and leaves
// the summary to the rail; the rail reads them from the tail the subagents store already reads (subagentsstore.ts), so
// a compaction older than that tail is not counted.

import { formatAgo, formatTokens } from "./agentsviewmodel";
import { compactSummaryText } from "./transcriptprojection";

export interface RailCompaction {
    trigger?: string; // "manual" (/compact) or "auto"
    preTokens?: number;
    postTokens?: number;
    summary?: string; // the summary as a person reads it, wrapper removed
    at?: number; // epoch ms of the boundary record, when it has a timestamp
}

function summaryOf(rec: any): string {
    const raw = rec?.message?.content;
    const text =
        typeof raw === "string"
            ? raw
            : Array.isArray(raw)
              ? raw
                    .filter((b: any) => b?.type === "text" && typeof b.text === "string")
                    .map((b: any) => b.text)
                    .join("\n")
              : "";
    return compactSummaryText(text);
}

/** Pure: the compactions in a Claude transcript's lines, oldest first. A summary record joins the boundary before it. */
export function extractCompactions(lines: string[]): RailCompaction[] {
    const out: RailCompaction[] = [];
    for (const line of lines) {
        // most lines are none of them: skip the parse
        if (
            !line.includes("compact_boundary") &&
            !line.includes("isCompactSummary") &&
            !line.includes('"compaction"')
        ) {
            continue;
        }
        let rec: any;
        try {
            rec = JSON.parse(line);
        } catch {
            continue;
        }
        if (rec?.type === "system" && rec.subtype === "compact_boundary") {
            const m = rec.compactMetadata ?? {};
            const c: RailCompaction = {};
            if (typeof m.trigger === "string") {
                c.trigger = m.trigger;
            }
            if (typeof m.preTokens === "number") {
                c.preTokens = m.preTokens;
            }
            if (typeof m.postTokens === "number") {
                c.postTokens = m.postTokens;
            }
            const at = typeof rec.timestamp === "string" ? Date.parse(rec.timestamp) : NaN;
            if (Number.isFinite(at)) {
                c.at = at;
            }
            out.push(c);
            continue;
        }
        // pi writes one record per compaction, its summary inside (pitranscriptprojection.ts reads the same)
        if (rec?.type === "compaction") {
            const c: RailCompaction = {};
            if (typeof rec.summary === "string" && rec.summary.trim() !== "") {
                c.summary = rec.summary;
            }
            if (typeof rec.tokensBefore === "number") {
                c.preTokens = rec.tokensBefore;
            }
            const at = typeof rec.timestamp === "string" ? Date.parse(rec.timestamp) : NaN;
            if (Number.isFinite(at)) {
                c.at = at;
            }
            out.push(c);
            continue;
        }
        if (rec?.type === "user" && rec.isCompactSummary === true) {
            const last = out[out.length - 1];
            const summary = summaryOf(rec);
            // a summary with no boundary before it in the tail (the tail cut between them) still names a compaction
            if (last != null && last.summary == null) {
                if (summary !== "") {
                    last.summary = summary;
                }
            } else {
                out.push(summary !== "" ? { summary } : {});
            }
        }
    }
    return out;
}

/** Pure: the rail's words for the last compaction, "202k → 13k · manual · 12m ago", with how many the tail holds
 *  ("×2") ahead of them when more than one. Null when there is none. */
export function compactionFacts(list: RailCompaction[] | undefined, now: number): string | null {
    if (list == null || list.length === 0) {
        return null;
    }
    const c = list[list.length - 1];
    const parts: string[] = [];
    if (list.length > 1) {
        parts.push(`×${list.length}`);
    }
    if (c.preTokens != null && c.postTokens != null) {
        parts.push(`${formatTokens(c.preTokens)} → ${formatTokens(c.postTokens)}`);
    }
    if (c.trigger) {
        parts.push(c.trigger);
    }
    if (c.at != null) {
        parts.push(formatAgo(Math.max(0, now - c.at)));
    }
    return parts.join(" · ");
}
