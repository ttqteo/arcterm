// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Pure builder for the digest the Analyze button sends to Claude (AnalyzeUsageCommand): the window's
// Claude usage as numbers in small markdown tables. It is built here, not in Go, because spend needs
// the one price table (usagepricing.ts), and it carries numbers, session titles and project names only,
// never conversation text. Same input, same string. No React, no Wave runtime imports.

import { SESSION_ROWS, type SessionRow } from "./usagesessions";
import { fmt, usd, type UsageStats } from "./usagestats";

const TITLE_MAX = 80;

// average-context bands, [from, to) in tokens; the last has no upper edge
const BANDS: { label: string; from: number; to: number }[] = [
    { label: "under 100k", from: 0, to: 100_000 },
    { label: "100–200k", from: 100_000, to: 200_000 },
    { label: "200–400k", from: 200_000, to: 400_000 },
    { label: "above 400k", from: 400_000, to: Infinity },
];

function pct(frac: number): string {
    if (!(frac > 0)) return "0%";
    const p = frac * 100;
    return p < 1 ? "<1%" : `${Math.round(p)}%`;
}

function plural(n: number, one: string, many = `${one}s`): string {
    return `${n} ${n === 1 ? one : many}`;
}

// One table cell: a single line with no pipe, so a title cannot break the table.
function cell(text: string): string {
    const flat = text.replace(/\s+/g, " ").replace(/\|/g, "/").trim();
    return flat.length > TITLE_MAX ? `${flat.slice(0, TITLE_MAX - 1)}…` : flat;
}

function lifetime(ms: number): string {
    const mins = Math.round(ms / 60_000);
    return mins < 60 ? `${mins}m` : `${Math.round(mins / 60)}h`;
}

function table(header: string[], body: string[][]): string[] {
    return [
        `| ${header.join(" | ")} |`,
        `|${header.map(() => "---").join("|")}|`,
        ...body.map((cells) => `| ${cells.join(" | ")} |`),
    ];
}

export function buildUsageDigest(input: {
    windowLabel: string; // "last 7 days" | "all time"
    stats: UsageStats; // the Claude-scoped stats the surface already derives
    rows: SessionRow[]; // every session, sorted by spend
}): string {
    const { windowLabel, stats, rows } = input;
    const out: string[] = [];
    const rowSpend = rows.reduce((sum, r) => sum + r.spendUsd, 0);

    const usedDays = stats.daily
        .map((d) => ({ day: d.day, ...(d.byHarness.claude ?? { tokens: 0, spendUsd: 0 }) }))
        .filter((d) => d.tokens > 0);
    const range = usedDays.length > 0 ? ` (${usedDays[0].day} to ${usedDays[usedDays.length - 1].day})` : "";
    out.push(`Claude usage digest: ${windowLabel}${range}`);
    out.push(
        `${plural(rows.length, "session")}, ${fmt(stats.totals.tokensWindow)} tokens, ` +
            `${usd(stats.totals.spendWindowUsd)} estimated spend at API list prices, ` +
            `${plural(stats.totals.activeDays, "active day")}. A session is one Claude tab's conversation, subagents included.`
    );

    const classes = stats.split.filter((c) => c.tokens > 0);
    const classSpend = classes.reduce((sum, c) => sum + c.spendUsd, 0);
    out.push("", "## Tokens and spend by class");
    out.push(
        ...table(
            ["class", "tokens", "spend", "share of spend"],
            classes.map((c) => [
                c.label,
                fmt(c.tokens),
                usd(c.spendUsd),
                pct(classSpend > 0 ? c.spendUsd / classSpend : 0),
            ])
        )
    );

    const models = stats.providers
        .flatMap((p) => p.models)
        .sort((a, b) => b.spendUsd - a.spendUsd || b.tokens - a.tokens || a.model.localeCompare(b.model));
    const modelSpend = models.reduce((sum, m) => sum + m.spendUsd, 0);
    out.push("", "## Spend by model");
    out.push(
        ...table(
            ["model", "tokens", "spend", "share of spend"],
            models.map((m) => [
                m.model,
                fmt(m.tokens),
                usd(m.spendUsd),
                pct(modelSpend > 0 ? m.spendUsd / modelSpend : 0),
            ])
        )
    );

    out.push("", "## Per day (days with no usage left out)");
    out.push(
        ...table(
            ["day", "tokens", "spend"],
            usedDays.map((d) => [d.day, fmt(d.tokens), usd(d.spendUsd)])
        )
    );

    if (rows.length === 0) {
        out.push("", "## Sessions", "No Claude sessions in this window.");
        return out.join("\n");
    }

    out.push("", "## Spend by average context (a turn's context is input + cache read + cache write)");
    const bandRows = BANDS.map((b) => {
        const inBand = rows.filter((r) => r.avgCtx > 0 && r.avgCtx >= b.from && r.avgCtx < b.to);
        return [
            b.label,
            String(inBand.length),
            usd(inBand.reduce((sum, r) => sum + r.spendUsd, 0)),
            pct(inBand.reduce((sum, r) => sum + r.share, 0)),
        ];
    });
    // a session with no main turns in the window (only subagent records) has no average to band
    const unknown = rows.filter((r) => !(r.avgCtx > 0));
    if (unknown.length > 0) {
        bandRows.push([
            "unknown (no main-session turns in the window)",
            String(unknown.length),
            usd(unknown.reduce((sum, r) => sum + r.spendUsd, 0)),
            pct(unknown.reduce((sum, r) => sum + r.share, 0)),
        ]);
    }
    out.push(...table(["average context", "sessions", "spend", "share of spend"], bandRows));

    const cold = rows.reduce((sum, r) => sum + r.coldResumes, 0);
    const coldSessions = rows.filter((r) => r.coldResumes > 0).length;
    const coldSpend = rows.reduce((sum, r) => sum + r.coldSpendUsd, 0);
    out.push("", "## Cold resumes");
    out.push(
        cold === 0
            ? "No cold resumes."
            : `${plural(cold, "cold resume")} in ${plural(coldSessions, "session")}: a turn more than 60 minutes after the ` +
                  `previous one that re-wrote over 50k tokens of cache. They cost ${usd(coldSpend)} at the 1-hour ` +
                  `cache-write rate, ${pct(rowSpend > 0 ? coldSpend / rowSpend : 0)} of the spend.`
    );

    const subSpend = rows.reduce((sum, r) => sum + r.subSpendUsd, 0);
    out.push("", "## Subagents");
    out.push(
        rowSpend > 0
            ? `Subagents account for ${pct(subSpend / rowSpend)} of the spend (${usd(subSpend)} of ${usd(rowSpend)}).`
            : "No spend to attribute to subagents."
    );

    const top = rows.slice(0, SESSION_ROWS);
    out.push("", `## Top ${plural(top.length, "session")} by spend (of ${rows.length})`);
    out.push(
        ...table(
            [
                "#",
                "title",
                "project",
                "models",
                "spend",
                "share",
                "avg ctx",
                "peak ctx",
                "cold resumes",
                "subagent share",
                "lifetime",
            ],
            top.map((r, i) => [
                String(i + 1),
                cell(r.title),
                cell(r.project),
                cell(r.models.join(", ")),
                usd(r.spendUsd),
                pct(r.share),
                fmt(r.avgCtx),
                fmt(r.maxCtx),
                String(r.coldResumes),
                pct(r.spendUsd > 0 ? r.subSpendUsd / r.spendUsd : 0),
                lifetime(r.lifetimeMs),
            ])
        )
    );
    return out.join("\n");
}
