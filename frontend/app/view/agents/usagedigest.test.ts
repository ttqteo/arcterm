import { describe, expect, it } from "vitest";
import { buildUsageDigest } from "./usagedigest";
import { SESSION_ROWS, type SessionRow } from "./usagesessions";
import { aggregateBuckets } from "./usagestats";

const HOUR = 3600_000;

const bucket = (model: string, day: string, over: Partial<UsageBucket> = {}): UsageBucket => ({
    harness: "claude",
    provider: "anthropic",
    model,
    day,
    input: 0,
    output: 0,
    reasoning: 0,
    cacheread: 0,
    cachecreate: 0,
    cachecreate1h: 0,
    msgs: 1,
    ...over,
});

// A Claude-scoped UsageStats over three days, built by the same function the surface uses.
const NOW = new Date(2026, 9, 8, 12).getTime();
const stats = aggregateBuckets(
    [
        bucket("claude-opus-5-5", "2026-10-06", {
            input: 1_000,
            output: 200_000,
            cacheread: 40_000_000,
            cachecreate: 3_000_000,
        }),
        bucket("claude-opus-5-5", "2026-10-08", {
            input: 2_000,
            output: 300_000,
            cacheread: 60_000_000,
            cachecreate: 5_000_000,
        }),
        bucket("claude-sonnet-5-5", "2026-10-08", {
            input: 500,
            output: 100_000,
            cacheread: 9_000_000,
            cachecreate: 800_000,
        }),
    ],
    NOW,
    "claude"
);

const row = (i: number, over: Partial<SessionRow> = {}): SessionRow => ({
    id: `id-${i}`,
    title: `session-${String(i).padStart(2, "0")}`,
    project: "arcterm",
    models: ["opus-5-5"],
    tokens: 1_000_000 - i * 1000,
    spendUsd: 100 - i,
    subSpendUsd: 0,
    share: 0.01,
    avgCtx: 150_000,
    maxCtx: 250_000,
    coldResumes: 0,
    coldSpendUsd: 0,
    lifetimeMs: 2 * HOUR,
    chips: [],
    ...over,
});

const manyRows = (n: number, over: Partial<SessionRow> = {}): SessionRow[] =>
    Array.from({ length: n }, (_, k) => row(k + 1, { share: 1 / n, ...over }));

const digestOf = (rows: SessionRow[], windowLabel = "last 7 days") => buildUsageDigest({ windowLabel, stats, rows });

// the lines under a "## <heading>" up to the next one
function section(digest: string, heading: string): string[] {
    const lines = digest.split("\n");
    const start = lines.findIndex((l) => l.startsWith(`## ${heading}`));
    if (start < 0) return [];
    const rest = lines.slice(start + 1);
    const end = rest.findIndex((l) => l.startsWith("## "));
    return (end < 0 ? rest : rest.slice(0, end)).filter((l) => l.trim() !== "");
}

describe("buildUsageDigest", () => {
    it("gives the same string for the same input", () => {
        const rows = manyRows(8);
        expect(digestOf(rows)).toBe(digestOf(rows));
    });

    it("opens with the window label", () => {
        expect(digestOf(manyRows(3), "all time").split("\n")[0]).toContain("all time");
        expect(digestOf(manyRows(3), "last 7 days").split("\n")[0]).toContain("last 7 days");
    });

    it("lists the 25 most expensive sessions and no more", () => {
        const digest = digestOf(manyRows(30));
        const lines = digest.split("\n").filter((l) => /session-\d\d/.test(l));
        expect(SESSION_ROWS).toBe(25);
        expect(lines).toHaveLength(25);
        expect(digest).toContain("session-25");
        expect(digest).not.toContain("session-26");
    });

    it("lists every session when there are fewer than 25", () => {
        const lines = digestOf(manyRows(4))
            .split("\n")
            .filter((l) => /session-\d\d/.test(l));
        expect(lines).toHaveLength(4);
    });

    it("names a session by its title, project, model and spend", () => {
        const digest = digestOf([
            row(1, { title: "Fix the race", project: "engine run", models: ["opus-5-5", "haiku-4-5"], spendUsd: 42.5 }),
        ]);
        const line = digest.split("\n").find((l) => l.includes("Fix the race"))!;
        expect(line).toContain("engine run");
        expect(line).toContain("opus-5-5, haiku-4-5");
        expect(line).toContain("$42.50");
    });

    it("keeps a title with a pipe or a newline on one table line", () => {
        const digest = digestOf([row(1, { title: "alpha | beta\ngamma delta" })]);
        const line = digest.split("\n").find((l) => l.includes("alpha"))!;
        expect(line).toContain("alpha / beta gamma delta");
        expect(line.split("|").length).toBe(
            digestOf([row(1)])
                .split("\n")
                .find((l) => l.includes("session-01"))!
                .split("|").length
        );
    });

    it("shortens a very long title", () => {
        const digest = digestOf([row(1, { title: "x".repeat(500) })]);
        expect(digest).not.toContain("x".repeat(200));
    });

    it("gives the token classes with tokens, spend and share of spend", () => {
        const lines = section(digestOf(manyRows(2)), "Tokens and spend by class");
        const cacheRead = lines.find((l) => l.includes("Cache read"))!;
        expect(cacheRead).toContain("109M"); // 40M + 60M + 9M tokens, as fmt prints them
        expect(cacheRead).toMatch(/\d+%/);
        expect(lines.some((l) => l.includes("Output"))).toBe(true);
        expect(lines.some((l) => l.includes("Reasoning"))).toBe(false); // no reasoning tokens in Claude's records
    });

    it("gives spend per model", () => {
        const lines = section(digestOf(manyRows(2)), "Spend by model");
        expect(lines.some((l) => l.includes("claude-opus-5-5"))).toBe(true);
        expect(lines.some((l) => l.includes("claude-sonnet-5-5"))).toBe(true);
    });

    it("gives tokens and spend for each day with usage and skips the idle one", () => {
        const lines = section(digestOf(manyRows(2)), "Per day");
        expect(lines.some((l) => l.includes("2026-10-06"))).toBe(true);
        expect(lines.some((l) => l.includes("2026-10-08"))).toBe(true);
        expect(lines.some((l) => l.includes("2026-10-07"))).toBe(false);
    });

    it("shares the spend over the four average-context bands, summing to 100%", () => {
        const rows = [
            row(1, { avgCtx: 50_000, share: 0.1 }),
            row(2, { avgCtx: 150_000, share: 0.2 }),
            row(3, { avgCtx: 300_000, share: 0.3 }),
            row(4, { avgCtx: 500_000, share: 0.4 }),
        ];
        const lines = section(digestOf(rows), "Spend by average context");
        const pct = (label: string) => Number(lines.find((l) => l.includes(label))!.match(/(\d+)%/)![1]);
        expect(pct("under 100k")).toBe(10);
        expect(pct("100–200k")).toBe(20);
        expect(pct("200–400k")).toBe(30);
        expect(pct("above 400k")).toBe(40);
        const total = ["under 100k", "100–200k", "200–400k", "above 400k"].reduce((s, l) => s + pct(l), 0);
        expect(Math.abs(total - 100)).toBeLessThanOrEqual(2);
    });

    it("puts a band's edge in the band it opens", () => {
        const rows = [row(1, { avgCtx: 99_999, share: 0.5 }), row(2, { avgCtx: 100_000, share: 0.5 })];
        const lines = section(digestOf(rows), "Spend by average context");
        expect(lines.find((l) => l.includes("under 100k"))).toContain("50%");
        expect(lines.find((l) => l.includes("100–200k"))).toContain("50%");
    });

    it("keeps a session with no main turns out of the bands and says so", () => {
        const rows = [row(1, { avgCtx: 300_000, share: 0.75 }), row(2, { avgCtx: 0, maxCtx: 0, share: 0.25 })];
        const lines = section(digestOf(rows), "Spend by average context");
        expect(lines.find((l) => l.includes("under 100k"))).toContain("0%");
        expect(lines.find((l) => l.includes("200–400k"))).toContain("75%");
        expect(lines.find((l) => l.includes("unknown"))).toContain("25%");
    });

    it("totals the cold resumes and their spend", () => {
        const rows = [
            row(1, { coldResumes: 3, coldSpendUsd: 12.5, share: 0.5 }),
            row(2, { coldResumes: 2, coldSpendUsd: 7.5, share: 0.5 }),
            row(3, { coldResumes: 0, coldSpendUsd: 0, share: 0 }),
        ];
        const text = section(digestOf(rows), "Cold resumes").join("\n");
        expect(text).toContain("5 cold resumes");
        expect(text).toContain("$20.00");
        expect(text).toContain("2 sessions");
    });

    it("gives the subagent share of spend", () => {
        const rows = [
            row(1, { spendUsd: 60, subSpendUsd: 15, share: 0.6 }),
            row(2, { spendUsd: 40, subSpendUsd: 25, share: 0.4 }),
        ];
        expect(section(digestOf(rows), "Subagents").join("\n")).toContain("40%"); // (15 + 25) / 100
    });

    it("still builds when there are no sessions", () => {
        const digest = digestOf([]);
        expect(digest).toContain("last 7 days");
        expect(digest).not.toMatch(/NaN|Infinity|undefined/);
    });

    it("never prints NaN or Infinity when nothing was spent", () => {
        const rows = [row(1, { spendUsd: 0, subSpendUsd: 0, share: 0, coldSpendUsd: 0 })];
        expect(digestOf(rows)).not.toMatch(/NaN|Infinity|undefined/);
    });

    it("stays within a few thousand tokens for a full week", () => {
        // about 4 characters per token; the spec budgets 3-5k tokens
        expect(digestOf(manyRows(30)).length).toBeLessThan(20_000);
    });
});
