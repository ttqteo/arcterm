// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Pure model for the Usage surface's Insights card: which of its states shows (insightsCard), whether
// Analyze is held because Claude's quota window is nearly spent (insightsHeld), and how a result's
// markdown is laid out (splitInsights), and which language the next analysis answers in (insightsLangOf). Spec: 2026-10-08-usage-insights-design.md, section 3. No React,
// no Wave runtime imports.

import { formatReset } from "./agentsviewmodel";
import type { DonutWindow } from "./ratelimitstore";

export const INSIGHTS_STALE_MS = 24 * 3600_000;
export const INSIGHTS_HELD_PCT = 95;

// The languages the analysis can answer in (usageinsights.langName on the server); "en" is the default.
export type InsightsLang = "en" | "vi";

// The language the "usage:insightslang" setting names: unset, or one the card has no toggle for, is English.
export function insightsLangOf(setting: string | null | undefined): InsightsLang {
    return setting === "vi" ? "vi" : "en";
}

// Whether picking `lang` re-runs the analysis at once: one is on screen in the other language (one saved before the
// language was recorded is English) and Analyze may run. With nothing on screen the pick waits for Analyze.
export function relangRuns(input: { card: InsightsCard; held: string | null; lang: InsightsLang }): boolean {
    const { card, held, lang } = input;
    const shown = card.kind === "done" ? card.ins : card.kind === "error" ? card.prev : undefined;
    return shown != null && held == null && insightsLangOf(shown.lang) !== lang;
}

export type InsightsCard =
    | { kind: "no-sessions" }
    | { kind: "never" }
    | { kind: "running" }
    | { kind: "done"; ins: UsageInsights; stale: boolean }
    | { kind: "error"; message: string; prev?: UsageInsights };

// The state the card shows. No Claude sessions in the window beats everything (there is nothing to
// analyse); a running analysis beats an error (the retry is under way); an error keeps the previous
// result beside it. `windowDays` is the surface's window (7, or 0 for all time).
export function insightsCard(input: {
    sessionCount: number;
    saved?: UsageInsights; // markdown "" counts as none
    running: boolean;
    error?: string;
    windowDays: number; // 7, or 0 for all time
    now: number;
}): InsightsCard {
    const { sessionCount, running, error, windowDays, now } = input;
    const saved = input.saved && input.saved.markdown !== "" ? input.saved : undefined;
    if (sessionCount <= 0) {
        return { kind: "no-sessions" };
    }
    if (running) {
        return { kind: "running" };
    }
    if (error) {
        return { kind: "error", message: error, prev: saved };
    }
    if (!saved) {
        return { kind: "never" };
    }
    const stale = now - saved.analyzedts > INSIGHTS_STALE_MS || saved.windowdays !== windowDays;
    return { kind: "done", ins: saved, stale };
}

// null when Analyze may run; else the button's tooltip, e.g. "Claude quota is at 96%, resets in 44m".
// A window at 95% or more holds it, so the analysis does not spend the last of the quota. When both
// windows are held the tooltip names the one that clears last, since that is when Analyze frees up.
export function insightsHeld(windows: DonutWindow[], now: number): string | null {
    const held = windows.filter((w) => w.pct != null && w.pct >= INSIGHTS_HELD_PCT);
    if (held.length === 0) {
        return null;
    }
    held.sort((a, b) => (b.reset ?? -1) - (a.reset ?? -1) || (b.pct ?? 0) - (a.pct ?? 0));
    const { pct, reset } = held[0];
    const head = `Claude quota is at ${Math.round(pct ?? 0)}%`;
    if (reset == null) {
        return head;
    }
    const left = formatReset(reset, now);
    return left === "now" ? `${head}, resets now` : `${head}, resets in ${left}`;
}

const FENCE = /^\s{0,3}(```|~~~)/;
const SECTION = /^## /;

// The last "## " section goes to the side tile (the prompt makes it "what to change"); with fewer than
// two sections everything stays in main. A "## " line inside a code fence is not a heading.
export function splitInsights(md: string): { main: string; side?: string } {
    const lines = md.split("\n");
    const sections: number[] = [];
    let fenced = false;
    lines.forEach((line, i) => {
        if (FENCE.test(line)) {
            fenced = !fenced;
        } else if (!fenced && SECTION.test(line)) {
            sections.push(i);
        }
    });
    if (sections.length < 2) {
        return { main: md };
    }
    const last = sections[sections.length - 1];
    return {
        main: lines.slice(0, last).join("\n").trimEnd(),
        side: lines.slice(last).join("\n").trim(),
    };
}
