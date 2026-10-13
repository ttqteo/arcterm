import { describe, expect, it } from "vitest";
import {
    buildLevers,
    hasInsights,
    leverEvidence,
    leverViews,
    LONG_CTX_FROM,
    LONG_CTX_TARGET,
    MAX_TABS,
    MIN_SHARE,
    selectedLeverKey,
    sessionRef,
    TIPS_KEY,
    type LeverView,
} from "./usagelevers";
import type { SessionRow } from "./usagesessions";

const row = (id: string, over: Partial<SessionRow> = {}): SessionRow => ({
    id,
    title: `title ${id}`,
    project: "arcterm",
    models: ["opus-5-5"],
    tokens: 0,
    spendUsd: 0,
    subSpendUsd: 0,
    share: 0,
    fiveHourPct: null,
    weekPct: null,
    avgCtx: 50_000,
    maxCtx: 90_000,
    coldResumes: 0,
    coldSpendUsd: 0,
    lifetimeMs: 0,
    bigResults: [],
    chips: [],
    mainModel: "claude-opus-5-5",
    ...over,
});

const lever = (rows: SessionRow[], key: string) => buildLevers(rows).find((l) => l.key === key);

describe("sessionRef", () => {
    it("is S plus the 1-based place", () => {
        expect(sessionRef(0)).toBe("S1");
        expect(sessionRef(11)).toBe("S12");
    });
});

describe("buildLevers longctx", () => {
    it("saves the main spend's share above the 100k target", () => {
        expect(LONG_CTX_FROM).toBe(200_000);
        expect(LONG_CTX_TARGET).toBe(100_000);
        const l = lever([row("a", { avgCtx: 300_000, spendUsd: 10, subSpendUsd: 2 })], "longctx")!;
        expect(l.sessions).toHaveLength(1);
        expect(l.sessions[0].saveusd).toBeCloseTo(8 * (1 - 100_000 / 300_000), 10);
        expect(l.sessions[0].saveusd).toBeCloseTo(5.3333333, 6);
    });

    it("has no candidate at exactly 200k", () => {
        expect(lever([row("a", { avgCtx: LONG_CTX_FROM, spendUsd: 10 })], "longctx")).toBeUndefined();
    });

    it("has no candidate when the main conversation cost nothing", () => {
        expect(lever([row("a", { avgCtx: 300_000, spendUsd: 2, subSpendUsd: 2 })], "longctx")).toBeUndefined();
    });

    it("counts the sessions and takes the rounded mean avgCtx of the candidates as tokens", () => {
        const l = lever(
            [
                row("a", { avgCtx: 300_000, spendUsd: 10 }),
                row("b", { avgCtx: 250_001, spendUsd: 10 }),
                row("c", { avgCtx: 100_000, spendUsd: 10 }), // not a candidate: not in the mean
            ],
            "longctx"
        )!;
        expect(l.count).toBe(2);
        expect(l.tokens).toBe(Math.round((300_000 + 250_001) / 2));
        expect(Number.isInteger(l.tokens)).toBe(true);
    });
});

describe("buildLevers bigread and bigbash", () => {
    const group = (tool: string, over: Partial<UsageBigResults> = {}): UsageBigResults => ({
        tool,
        count: 2,
        chars: 80_000,
        rereadtokens: 100_000,
        ...over,
    });

    it("prices one cache write per result plus every reread at the cache-read rate", () => {
        const l = lever([row("a", { bigResults: [group("Read")] })], "bigread")!;
        // (20_000 tokens x $8 + 100_000 x $0.2) / 1e6 on claude-opus-5-5
        expect(l.sessions[0].saveusd).toBeCloseTo(0.18, 10);
    });

    it("counts only the cache write of a subagent's result", () => {
        const l = lever([row("a", { bigResults: [group("Read", { sub: true })] })], "bigread")!;
        expect(l.sessions[0].saveusd).toBeCloseTo((20_000 * 8) / 1e6, 10);
    });

    it("reads a missing rereadtokens as 0", () => {
        const l = lever([row("a", { bigResults: [group("Read", { rereadtokens: undefined })] })], "bigread")!;
        expect(l.sessions[0].saveusd).toBeCloseTo((20_000 * 8) / 1e6, 10);
    });

    it("sums the groups of one tool and counts their results and tokens", () => {
        const l = lever(
            [row("a", { bigResults: [group("Read"), group("Read", { sub: true, count: 3, chars: 40_000 })] })],
            "bigread"
        )!;
        expect(l.count).toBe(5);
        expect(l.tokens).toBe(30_000); // 120_000 chars / 4
        expect(l.sessions[0].saveusd).toBeCloseTo(0.18 + (10_000 * 8) / 1e6, 10);
    });

    it("rounds tokens to a whole number", () => {
        const l = lever([row("a", { bigResults: [group("Read", { chars: 80_002, rereadtokens: 0 })] })], "bigread")!;
        expect(l.tokens).toBe(20_001); // 20_000.5
    });

    it("prices bigbash the same way from the Bash groups", () => {
        const rows = [row("a", { bigResults: [group("Bash")] })];
        expect(lever(rows, "bigbash")!.sessions[0].saveusd).toBeCloseTo(0.18, 10);
        expect(lever(rows, "bigread")).toBeUndefined();
    });

    it("puts any other tool in neither lever", () => {
        const levers = buildLevers([row("a", { bigResults: [group("Grep"), group("WebFetch")] })]);
        expect(levers.map((l) => l.key)).toEqual([]);
    });

    it("prices at the session's main model, and not at all without a price", () => {
        const sonnet = lever([row("a", { mainModel: "claude-sonnet-5-5", bigResults: [group("Read")] })], "bigread")!;
        expect(sonnet.sessions[0].saveusd).toBeCloseTo((20_000 * 4 + 100_000 * 0.2) / 1e6, 10);
        expect(lever([row("a", { mainModel: "mystery-1", bigResults: [group("Read")] })], "bigread")).toBeUndefined();
        expect(lever([row("a", { mainModel: undefined, bigResults: [group("Read")] })], "bigread")).toBeUndefined();
    });
});

describe("buildLevers opus", () => {
    it("saves the Opus spend above its Sonnet price", () => {
        const l = lever([row("a", { opusSpendUsd: 30, opusAsSonnetUsd: 12 })], "opus")!;
        expect(l.sessions[0].saveusd).toBeCloseTo(18, 10);
        expect(l.count).toBe(1);
    });

    it("leaves out a session with no Opus, or one Sonnet would not make cheaper", () => {
        expect(lever([row("a", { opusSpendUsd: 0, opusAsSonnetUsd: 0 })], "opus")).toBeUndefined();
        expect(lever([row("a")], "opus")).toBeUndefined();
        expect(lever([row("a", { opusSpendUsd: 5, opusAsSonnetUsd: 5 })], "opus")).toBeUndefined();
        expect(lever([row("a", { opusSpendUsd: 4, opusAsSonnetUsd: 5 })], "opus")).toBeUndefined();
    });
});

describe("buildLevers cold", () => {
    it("saves the cold-resume spend and counts the resumes", () => {
        const l = lever(
            [row("a", { coldResumes: 2, coldSpendUsd: 3 }), row("b", { coldResumes: 5, coldSpendUsd: 1.5 })],
            "cold"
        )!;
        expect(l.sessions.map((s) => s.saveusd)).toEqual([3, 1.5]);
        expect(l.count).toBe(7);
    });

    it("leaves out a session whose cold resumes cost nothing", () => {
        expect(lever([row("a", { coldResumes: 2, coldSpendUsd: 0 })], "cold")).toBeUndefined();
    });
});

describe("buildLevers order and refs", () => {
    it("leaves out a lever with no candidate", () => {
        expect(buildLevers([row("a")])).toEqual([]);
        expect(buildLevers([])).toEqual([]);
    });

    it("lists the levers in a fixed order", () => {
        const levers = buildLevers([
            row("a", {
                coldSpendUsd: 1,
                coldResumes: 1,
                opusSpendUsd: 2,
                opusAsSonnetUsd: 1,
                avgCtx: 300_000,
                spendUsd: 3,
                bigResults: [
                    { tool: "Bash", count: 1, chars: 40_000 },
                    { tool: "Read", count: 1, chars: 40_000 },
                ],
            }),
        ]);
        expect(levers.map((l) => l.key)).toEqual(["longctx", "bigread", "bigbash", "opus", "cold"]);
    });

    it("sorts a lever's sessions by saving, and numbers them by their place in the rows", () => {
        const l = lever(
            [
                row("a", { coldResumes: 1, coldSpendUsd: 1 }),
                row("b"),
                row("c", { coldResumes: 1, coldSpendUsd: 9 }),
                row("d", { coldResumes: 1, coldSpendUsd: 4 }),
            ],
            "cold"
        )!;
        expect(l.sessions.map((s) => [s.ref, s.id, s.title, s.saveusd])).toEqual([
            ["S3", "c", "title c", 9],
            ["S4", "d", "title d", 4],
            ["S1", "a", "title a", 1],
        ]);
    });

    it("keeps row order between sessions that save the same", () => {
        const l = lever(
            [row("a", { coldResumes: 1, coldSpendUsd: 2 }), row("b", { coldResumes: 1, coldSpendUsd: 2 })],
            "cold"
        )!;
        expect(l.sessions.map((s) => s.ref)).toEqual(["S1", "S2"]);
    });

    it("uses the same ref for a session in every lever", () => {
        const rows = [row("a"), row("b", { coldResumes: 1, coldSpendUsd: 1, opusSpendUsd: 3, opusAsSonnetUsd: 1 })];
        const levers = buildLevers(rows);
        expect(levers.map((l) => l.sessions[0].ref)).toEqual(["S2", "S2"]);
    });
});

const saved = (over: Partial<UsageInsights> = {}): UsageInsights => ({
    markdown: "",
    headline: "h",
    analyzedts: 1,
    windowdays: 7,
    model: "sonnet",
    spendusd: 100,
    ...over,
});

const ls = (ref: string, saveusd: number): UsageLeverSession => ({
    ref,
    id: `id-${ref}`,
    title: `title ${ref}`,
    saveusd,
});

describe("leverViews", () => {
    it("is empty for a result with no levers", () => {
        expect(leverViews(saved())).toEqual([]);
        expect(leverViews(saved({ levers: [] }))).toEqual([]);
    });

    it("totals a lever, shares it of spendusd and carries its evidence and fix", () => {
        const [v] = leverViews(
            saved({
                levers: [
                    {
                        key: "cold",
                        count: 7,
                        tokens: 4,
                        sessions: [ls("S1", 3), ls("S2", 1.5)],
                        fix: "Resume sooner.",
                    },
                ],
            })
        );
        expect(v.key).toBe("cold");
        expect(v.totalUsd).toBeCloseTo(4.5, 10);
        expect(v.share).toBeCloseTo(0.045, 10);
        expect([v.count, v.tokens, v.fix]).toEqual([7, 4, "Resume sooner."]);
    });

    it("reads the omitted wire fields as empty", () => {
        const [v] = leverViews(saved({ levers: [{ key: "cold", sessions: [ls("S1", 5)] }] }));
        expect([v.count, v.tokens, v.fix, v.more]).toEqual([0, 0, undefined, 0]);
    });

    it("hides a lever under 1% of spendusd and keeps one at 1%", () => {
        expect(MIN_SHARE).toBe(0.01);
        const views = leverViews(
            saved({
                levers: [
                    { key: "cold", sessions: [ls("S1", 0.99)] },
                    { key: "bigread", sessions: [ls("S2", 1)] },
                ],
            })
        );
        expect(views.map((v) => v.key)).toEqual(["bigread"]);
    });

    it("skips a lever key it has no title for", () => {
        const views = leverViews(
            saved({
                levers: [
                    { key: "mystery", sessions: [ls("S1", 50)] },
                    { key: "cold", sessions: [ls("S2", 5)] },
                ],
            })
        );
        expect(views.map((v) => v.key)).toEqual(["cold"]);
    });

    it("hides every lever when spendusd is missing or 0", () => {
        const levers = [{ key: "cold", sessions: [ls("S1", 50)] }];
        expect(leverViews(saved({ levers, spendusd: 0 }))).toEqual([]);
        expect(leverViews(saved({ levers, spendusd: undefined }))).toEqual([]);
    });

    it("orders the levers by total, largest first", () => {
        const views = leverViews(
            saved({
                levers: [
                    { key: "cold", sessions: [ls("S1", 2)] },
                    { key: "longctx", sessions: [ls("S2", 20), ls("S3", 5)] },
                    { key: "bigread", sessions: [ls("S4", 9)] },
                ],
            })
        );
        expect(views.map((v) => v.key)).toEqual(["longctx", "bigread", "cold"]);
    });

    it("totals the opus lever over opusclear only", () => {
        const levers = [{ key: "opus", count: 3, sessions: [ls("S1", 10), ls("S2", 7), ls("S3", 5)] }];
        const [v] = leverViews(saved({ levers, opusclear: ["S2"] }));
        expect(v.totalUsd).toBe(7);
        expect(v.share).toBeCloseTo(0.07, 10);
        expect(v.count).toBe(1);
        expect(v.tabs.map((t) => t.ref)).toEqual(["S2"]);
        expect(v.more).toBe(0);
    });

    it("ignores an opusclear ref that is not an opus session, and counts a repeated one once", () => {
        const levers = [{ key: "opus", sessions: [ls("S1", 10), ls("S2", 7)] }];
        const [v] = leverViews(saved({ levers, opusclear: ["S9", "S1", "S1"] }));
        expect(v.totalUsd).toBe(10);
        expect(v.tabs.map((t) => t.ref)).toEqual(["S1"]);
    });

    it("hides the opus lever when Claude cleared none", () => {
        const levers = [{ key: "opus", sessions: [ls("S1", 40)] }];
        expect(leverViews(saved({ levers }))).toEqual([]);
        expect(leverViews(saved({ levers, opusclear: [] }))).toEqual([]);
        expect(leverViews(saved({ levers, opusclear: ["S7"] }))).toEqual([]);
    });

    it("shows at most five opusclear tabs and counts the rest as more", () => {
        expect(MAX_TABS).toBe(5);
        const sessions = Array.from({ length: 8 }, (_, i) => ls(`S${i + 1}`, 5));
        const [v] = leverViews(
            saved({
                levers: [{ key: "opus", sessions }],
                opusclear: sessions.map((s) => s.ref),
            })
        );
        expect(v.tabs.map((t) => t.ref)).toEqual(["S1", "S2", "S3", "S4", "S5"]);
        expect(v.more).toBe(3);
        expect(v.totalUsd).toBe(40);
    });

    it("follows Claude's tab order and drops a ref no lever has", () => {
        const [v] = leverViews(
            saved({
                levers: [
                    {
                        key: "cold",
                        sessions: [ls("S1", 9), ls("S2", 8), ls("S3", 7)],
                        tabs: ["S3", "S9", "S1"],
                    },
                ],
            })
        );
        expect(v.tabs.map((t) => t.ref)).toEqual(["S3", "S1"]);
        expect(v.more).toBe(1); // 3 sessions - 2 shown
    });

    it("finds a tab Claude took from another lever's sessions", () => {
        const views = leverViews(
            saved({
                levers: [
                    { key: "longctx", sessions: [ls("S1", 30)], tabs: ["S1", "S2"] },
                    { key: "cold", sessions: [ls("S2", 3)] },
                ],
            })
        );
        expect(views.find((v) => v.key === "longctx")!.tabs.map((t) => t.ref)).toEqual(["S1", "S2"]);
    });

    it("takes the heaviest five when Claude named no tab", () => {
        const sessions = [1, 9, 3, 7, 5, 8, 2].map((n) => ls(`S${n}`, n));
        const views = leverViews(saved({ spendusd: 1000, levers: [{ key: "cold", sessions }] }));
        expect(views[0].tabs.map((t) => t.saveusd)).toEqual([9, 8, 7, 5, 3]);
        expect(views[0].more).toBe(2);
    });

    it("takes the heaviest five when every tab Claude named is unknown", () => {
        const [v] = leverViews(
            saved({ levers: [{ key: "cold", sessions: [ls("S1", 9), ls("S2", 8)], tabs: ["S8", "S9"] }] })
        );
        expect(v.tabs.map((t) => t.ref)).toEqual(["S1", "S2"]);
    });

    it("cuts Claude's tabs at five", () => {
        const sessions = Array.from({ length: 7 }, (_, i) => ls(`S${i + 1}`, 10 - i));
        const [v] = leverViews(
            saved({ levers: [{ key: "cold", sessions, tabs: sessions.map((s) => s.ref).reverse() }] })
        );
        expect(v.tabs.map((t) => t.ref)).toEqual(["S7", "S6", "S5", "S4", "S3"]);
        expect(v.more).toBe(2);
    });

    it("does not change the saved result", () => {
        const ins = saved({ levers: [{ key: "cold", sessions: [ls("S1", 1), ls("S2", 9)] }], spendusd: 10 });
        const before = JSON.stringify(ins);
        leverViews(ins);
        expect(JSON.stringify(ins)).toBe(before);
    });
});

describe("hasInsights", () => {
    it("is false for nothing, and for an empty result with no headline", () => {
        expect(hasInsights(undefined)).toBe(false);
        expect(hasInsights(saved({ headline: undefined }))).toBe(false);
        expect(hasInsights(saved({ headline: "" }))).toBe(false);
    });

    it("is true for markdown saved before levers", () => {
        expect(hasInsights(saved({ markdown: "## x", headline: undefined }))).toBe(true);
    });

    it("is true for a headline", () => {
        expect(hasInsights(saved({ headline: "Opus tabs cost the most." }))).toBe(true);
    });
});

const view = (key: LeverView["key"], over: Partial<LeverView> = {}): LeverView => ({
    key,
    totalUsd: 1,
    share: 0.1,
    count: 0,
    tokens: 0,
    tabs: [],
    more: 0,
    ...over,
});

describe("selectedLeverKey", () => {
    const views = [view("bigread"), view("cold")];

    it("keeps a saved key a drawn lever has, and tips when there are tips", () => {
        expect(selectedLeverKey("cold", views, true)).toBe("cold");
        expect(selectedLeverKey(TIPS_KEY, views, true)).toBe(TIPS_KEY);
    });

    it("falls back to the first lever for no key, an unknown one, or tips that are gone", () => {
        expect(selectedLeverKey(undefined, views, true)).toBe("bigread");
        expect(selectedLeverKey("opus", views, true)).toBe("bigread");
        expect(selectedLeverKey(TIPS_KEY, views, false)).toBe("bigread");
    });

    it("selects tips when no lever is drawn, and nothing when there are no tips either", () => {
        expect(selectedLeverKey("cold", [], true)).toBe(TIPS_KEY);
        expect(selectedLeverKey(undefined, [], false)).toBeUndefined();
    });
});

describe("leverEvidence", () => {
    it("names the tabs and the mean context for longctx", () => {
        expect(leverEvidence(view("longctx", { count: 41, tokens: 314_000 }))).toBe("41 tabs, avg 314K");
    });

    it("names the results and their tokens for bigread and bigbash", () => {
        expect(leverEvidence(view("bigread", { count: 316, tokens: 2_500_000 }))).toBe("316 results, ≈2.5M tokens");
        expect(leverEvidence(view("bigbash", { count: 125, tokens: 754_000 }))).toBe("125 results, ≈754K tokens");
    });

    it("names the tabs for opus and the resumes for cold", () => {
        expect(leverEvidence(view("opus", { count: 9 }))).toBe("9 tabs");
        expect(leverEvidence(view("cold", { count: 48 }))).toBe("48 resumes");
    });

    it("keeps a count of one singular", () => {
        expect(leverEvidence(view("opus", { count: 1 }))).toBe("1 tab");
        expect(leverEvidence(view("bigread", { count: 1, tokens: 90_000 }))).toBe("1 result, ≈90K tokens");
        expect(leverEvidence(view("cold", { count: 1 }))).toBe("1 resume");
    });
});
