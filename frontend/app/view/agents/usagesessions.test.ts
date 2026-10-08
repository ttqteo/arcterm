import { describe, expect, it } from "vitest";
import { priceFor, spendOf } from "./usagepricing";
import {
    buildSessionRows,
    CHIP_LABEL,
    COLD_RESUMES,
    LARGE_CTX,
    liveSessionTabs,
    LONG_LIVED_MS,
    SESSION_ROWS,
    visibleSessionRows,
} from "./usagesessions";

const HOUR = 3600_000;

const mdl = (model: string, over: Partial<UsageSessionModel> = {}): UsageSessionModel => ({
    model,
    input: 0,
    output: 0,
    cacheread: 0,
    cachecreate: 0,
    cachecreate1h: 0,
    ...over,
});

const sess = (id: string, over: Partial<UsageSession> = {}): UsageSession => ({
    id,
    title: `title ${id}`,
    project: "arcterm",
    models: [mdl("claude-opus-5-5", { output: 1_000_000 })],
    turns: 10,
    subturns: 0,
    avgctx: 50_000,
    maxctx: 90_000,
    coldresumes: 0,
    coldtokens: 0,
    firstts: 1_000_000,
    lastts: 1_000_000 + HOUR,
    ...over,
});

const none = new Map<string, string>();

// the price of one model entry, the way the surface prices a bucket
const priced = (m: UsageSessionModel) =>
    spendOf({
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

describe("buildSessionRows pricing", () => {
    it("prices a session as the sum of spendOf over its models", () => {
        const models = [
            mdl("claude-opus-5-5", {
                input: 10_000,
                output: 200_000,
                cacheread: 5_000_000,
                cachecreate: 400_000,
                cachecreate1h: 150_000,
            }),
            mdl("claude-haiku-4-5", {
                sub: true,
                input: 3_000,
                output: 50_000,
                cacheread: 800_000,
                cachecreate: 90_000,
            }),
        ];
        const [row] = buildSessionRows([sess("a", { models })], none);
        expect(row.spendUsd).toBeCloseTo(priced(models[0]) + priced(models[1]), 10);
        expect(row.subSpendUsd).toBeCloseTo(priced(models[1]), 10);
        expect(row.spendUsd).toBeGreaterThan(0);
    });

    it("counts every token class of every model, subagents included", () => {
        const models = [
            mdl("claude-opus-5-5", { input: 1, output: 2, cacheread: 4, cachecreate: 8, cachecreate1h: 8 }),
            mdl("claude-haiku-4-5", { sub: true, input: 16, output: 32, cacheread: 64, cachecreate: 128 }),
        ];
        const [row] = buildSessionRows([sess("a", { models })], none);
        expect(row.tokens).toBe(1 + 2 + 4 + 8 + 16 + 32 + 64 + 128);
    });

    it("prices an unknown model at 0 and still counts its tokens", () => {
        const [row] = buildSessionRows([sess("a", { models: [mdl("mystery-1", { output: 5_000 })] })], none);
        expect(row.spendUsd).toBe(0);
        expect(row.tokens).toBe(5_000);
    });

    it("prices the cold resumes at the main model's 1h cache-write rate", () => {
        const [row] = buildSessionRows([sess("a", { coldresumes: 2, coldtokens: 2_000_000 })], none);
        expect(row.coldResumes).toBe(2);
        expect(row.coldSpendUsd).toBeCloseTo((2_000_000 * priceFor("claude-opus-5-5")!.cacheWrite1h) / 1_000_000, 10);
    });

    it("takes the main model as the one with the most main tokens, not a busier subagent", () => {
        const models = [
            mdl("claude-opus-5-5", { output: 100 }),
            mdl("claude-sonnet-5-5", { output: 9_000 }),
            mdl("claude-haiku-4-5", { sub: true, output: 9_000_000 }),
        ];
        const [row] = buildSessionRows([sess("a", { models, coldresumes: 1, coldtokens: 1_000_000 })], none);
        expect(row.coldSpendUsd).toBeCloseTo((1_000_000 * priceFor("claude-sonnet-5-5")!.cacheWrite1h) / 1_000_000, 10);
        expect(row.models).toEqual(["sonnet-5-5", "opus-5-5", "haiku-4-5"]);
    });

    it("gives a cold resume spend of 0 when the main model is unpriced", () => {
        const [row] = buildSessionRows(
            [sess("a", { models: [mdl("mystery-1", { output: 5 })], coldtokens: 1_000_000 })],
            none
        );
        expect(row.coldSpendUsd).toBe(0);
    });
});

describe("buildSessionRows models", () => {
    it("lists each model once, main first, without the claude- prefix", () => {
        const models = [
            mdl("claude-haiku-4-5", { sub: true, output: 50 }),
            mdl("claude-opus-5-5", { output: 10 }),
            mdl("claude-opus-5-5", { sub: true, output: 5 }),
        ];
        const [row] = buildSessionRows([sess("a", { models })], none);
        expect(row.models).toEqual(["opus-5-5", "haiku-4-5"]);
    });
});

describe("buildSessionRows order and share", () => {
    const three = [
        sess("small", { models: [mdl("claude-opus-5-5", { output: 100_000 })] }),
        sess("big", { models: [mdl("claude-opus-5-5", { output: 3_000_000 })] }),
        sess("mid", { models: [mdl("claude-opus-5-5", { output: 900_000 })] }),
    ];

    it("sorts by spend, most expensive first", () => {
        expect(buildSessionRows(three, none).map((r) => r.id)).toEqual(["big", "mid", "small"]);
    });

    it("gives shares that sum to 1 over every session", () => {
        const rows = buildSessionRows(three, none);
        expect(rows.reduce((s, r) => s + r.share, 0)).toBeCloseTo(1, 10);
        expect(rows[0].share).toBeGreaterThan(rows[1].share);
    });

    it("gives a share of 0, not NaN, when nothing in the window has a price", () => {
        const rows = buildSessionRows([sess("a", { models: [mdl("mystery-1", { output: 5 })] })], none);
        expect(rows[0].share).toBe(0);
    });

    it("returns no rows for no sessions", () => {
        expect(buildSessionRows([], none)).toEqual([]);
    });

    it("does not reorder or change the input", () => {
        const input = [...three];
        buildSessionRows(input, none);
        expect(input.map((s) => s.id)).toEqual(["small", "big", "mid"]);
    });
});

describe("buildSessionRows titles and fields", () => {
    it("falls back to Untitled plus the first 8 of the id when there is no ai-title", () => {
        const [row] = buildSessionRows([sess("0123456789abcdef", { title: "" })], none);
        expect(row.title).toBe("Untitled · 01234567");
    });

    it("keeps the title it has", () => {
        const [row] = buildSessionRows([sess("a", { title: "Fix the race" })], none);
        expect(row.title).toBe("Fix the race");
    });

    it("carries project, context and lifetime through", () => {
        const [row] = buildSessionRows(
            [
                sess("a", {
                    project: "engine run",
                    avgctx: 123,
                    maxctx: 456,
                    firstts: 10_000,
                    lastts: 10_000 + 5 * HOUR,
                }),
            ],
            none
        );
        expect(row.project).toBe("engine run");
        expect(row.avgCtx).toBe(123);
        expect(row.maxCtx).toBe(456);
        expect(row.lifetimeMs).toBe(5 * HOUR);
    });

    it("handles a session with no main turns without dividing by them", () => {
        const [row] = buildSessionRows(
            [
                sess("0123456789", {
                    title: "",
                    project: "",
                    turns: 0,
                    subturns: 4,
                    avgctx: 0,
                    maxctx: 0,
                    models: [mdl("claude-haiku-4-5", { sub: true, output: 1_000_000 })],
                }),
            ],
            none
        );
        expect(row.title).toBe("Untitled · 01234567");
        expect(row.avgCtx).toBe(0);
        expect(Number.isFinite(row.spendUsd)).toBe(true);
        expect(row.subSpendUsd).toBeCloseTo(row.spendUsd, 10);
        expect(row.models).toEqual(["haiku-4-5"]);
    });
});

describe("buildSessionRows chips", () => {
    const chips = (over: Partial<UsageSession>) => buildSessionRows([sess("a", over)], none)[0].chips;

    it("has none for an ordinary session", () => {
        expect(chips({})).toEqual([]);
    });

    it("flags large context only above 200,000 average", () => {
        expect(chips({ avgctx: LARGE_CTX })).not.toContain("large-context");
        expect(chips({ avgctx: LARGE_CTX + 1 })).toContain("large-context");
    });

    it("flags cold resumes from 3", () => {
        expect(chips({ coldresumes: COLD_RESUMES - 1 })).not.toContain("cold-resumes");
        expect(chips({ coldresumes: COLD_RESUMES })).toContain("cold-resumes");
    });

    it("flags heavy subagents at 51% of the session's spend and not at 50%", () => {
        const split = (main: number, sub: number) => [
            mdl("claude-opus-5-5", { output: main }),
            mdl("claude-opus-5-5", { sub: true, output: sub }),
        ];
        expect(chips({ models: split(50_000, 50_000) })).not.toContain("heavy-subagents");
        expect(chips({ models: split(49_000, 51_000) })).toContain("heavy-subagents");
    });

    it("never flags heavy subagents when nothing was spent", () => {
        expect(chips({ models: [mdl("mystery-1", { sub: true, output: 1_000 })] })).not.toContain("heavy-subagents");
    });

    it("flags long-lived only past 24 hours", () => {
        expect(chips({ firstts: 0, lastts: LONG_LIVED_MS })).not.toContain("long-lived");
        expect(chips({ firstts: 0, lastts: 25 * HOUR })).toContain("long-lived");
    });

    it("lists chips in a fixed order when several apply", () => {
        expect(
            chips({
                avgctx: LARGE_CTX + 1,
                coldresumes: COLD_RESUMES,
                firstts: 0,
                lastts: 48 * HOUR,
                models: [
                    mdl("claude-opus-5-5", { output: 1_000 }),
                    mdl("claude-opus-5-5", { sub: true, output: 9_000 }),
                ],
            })
        ).toEqual(["large-context", "cold-resumes", "heavy-subagents", "long-lived"]);
    });

    it("labels every chip", () => {
        expect(CHIP_LABEL).toEqual({
            "large-context": "large context",
            "cold-resumes": "cold resumes",
            "heavy-subagents": "heavy subagents",
            "long-lived": "long-lived",
        });
    });
});

describe("visibleSessionRows", () => {
    const rows = buildSessionRows(
        Array.from({ length: 30 }, (_, i) => sess(`s${i}`, { models: [mdl("claude-opus-5-5", { output: 1000 + i })] })),
        none
    );

    it("cuts at 25 rows", () => {
        expect(SESSION_ROWS).toBe(25);
        expect(visibleSessionRows(rows, false)).toHaveLength(25);
        expect(visibleSessionRows(rows, false)[0]).toBe(rows[0]);
    });

    it("shows all of them when asked", () => {
        expect(visibleSessionRows(rows, true)).toHaveLength(30);
    });

    it("shows a short list whole", () => {
        expect(visibleSessionRows(rows.slice(0, 3), false)).toHaveLength(3);
    });
});

describe("liveSessionTabs", () => {
    it("keys a claude agent's tab by its transcript's session id", () => {
        const live = liveSessionTabs([
            { id: "tab-1", agent: "claude", transcriptPath: "C:\\Users\\u\\.claude\\projects\\x\\abc-123.jsonl" },
            { id: "tab-2", transcriptPath: "/home/u/.claude/projects/x/def-456.jsonl" }, // agent undefined = claude
        ]);
        expect(live.get("abc-123")).toBe("tab-1");
        expect(live.get("def-456")).toBe("tab-2");
        expect(live.size).toBe(2);
    });

    it("skips other harnesses, plain terminals, background agents and agents with no transcript", () => {
        const live = liveSessionTabs([
            { id: "t1", agent: "codex", transcriptPath: "/x/codex-1.jsonl" },
            { id: "t2", agent: "claude", kind: "terminal", transcriptPath: "/x/term-1.jsonl" },
            { id: "t3", agent: "claude", kind: "background", transcriptPath: "/x/bg-1.jsonl" },
            { id: "t4", agent: "claude" },
            { id: "t5", agent: "claude", kind: "agent", transcriptPath: "/x/ok-1.jsonl" },
        ]);
        expect([...live.entries()]).toEqual([["ok-1", "t5"]]);
    });

    it("marks the row of a session an open tab runs", () => {
        const live = liveSessionTabs([{ id: "tab-9", agent: "claude", transcriptPath: "/p/running.jsonl" }]);
        const rows = buildSessionRows([sess("running"), sess("ended")], live);
        expect(rows.find((r) => r.id === "running")?.liveTabId).toBe("tab-9");
        expect(rows.find((r) => r.id === "ended")?.liveTabId).toBeUndefined();
    });
});
