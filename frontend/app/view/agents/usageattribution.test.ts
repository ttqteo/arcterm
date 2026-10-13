import { describe, expect, it } from "vitest";
import {
    buildAttribution,
    itemScopeKey,
    listPage,
    otherFoldersText,
    resolveScope,
    scopeBuckets,
    scopeId,
    scopeItems,
    scopeList,
    scopeSplit,
    type SplitPart,
    type WorkScope,
} from "./usageattribution";
import { aggregateBuckets } from "./usagestats";

const NOW = Date.parse("2026-10-08T12:00:00.000Z");
const DAY = "2026-10-08";
const M = 1_000_000;
const OPUS = "claude-opus-4-8"; // $25 per 1M output tokens
const WAVE = "C:/work/waveterm";
const CYBER = "C:/work/cyber";

// one output-only opus bucket: `millions` of tokens cost exactly millions * $25
function bkt(session: string, millions: number, over: Partial<UsageBucket> = {}): UsageBucket {
    return {
        harness: "claude",
        provider: "anthropic",
        model: OPUS,
        day: DAY,
        session,
        input: 0,
        output: millions * M,
        reasoning: 0,
        cacheread: 0,
        cachecreate: 0,
        cachecreate1h: 0,
        msgs: 1,
        ...over,
    };
}

function ses(session: string, over: Partial<UsageSessionMeta> = {}): UsageSessionMeta {
    return { harness: "claude", session, ...over };
}

function inRun(session: string, role: string, over: Partial<UsageSessionMeta> = {}): UsageSessionMeta {
    return ses(session, {
        project: WAVE,
        runid: "r1",
        channelid: "c1",
        rungoal: "Ship usage attribution",
        runmode: "orchestrator",
        role,
        ...over,
    });
}

const RUN_BUCKETS = [bkt("lead", 4), bkt("w1", 2), bkt("w2", 2), bkt("rev", 1), bkt("ver", 1)];
const RUN_SESSIONS = [
    inRun("lead", "lead"),
    inRun("w1", "worker", { taskid: "t-1" }),
    inRun("w2", "worker", { taskid: "t-2" }),
    inRun("rev", "reviewer", { taskid: "t-1" }),
    inRun("ver", "verifier"),
];

const sum = (parts: SplitPart[], pick: (p: SplitPart) => number) => parts.reduce((s, p) => s + pick(p), 0);
const ALL: WorkScope = { kind: "all" };

describe("work items", () => {
    it("folds a run's lead, workers, reviewer and verifier into one item that is their sum", () => {
        const attr = buildAttribution(RUN_BUCKETS, RUN_SESSIONS);
        expect(attr.items).toHaveLength(1);
        const [run] = attr.items;
        expect(run.key).toBe("run:r1");
        expect(run.kind).toBe("orchestrator");
        expect(run.title).toBe("Ship usage attribution");
        expect(run.sessions).toHaveLength(5);
        expect(run.tokens).toBe(10 * M);
        expect(run.spendUsd).toBe(250);
        expect(run.runId).toBe("r1");
        expect(run.channelId).toBe("c1");
        expect(run.projectLabel).toBe("waveterm");
    });

    it("keeps an unlinked session as its own item, titled by its title and then its id", () => {
        const attr = buildAttribution(
            [bkt("solo", 1), bkt("bare", 2)],
            [ses("solo", { title: "Fix the rail", project: WAVE }), ses("bare", { project: WAVE })]
        );
        expect(attr.items.map((it) => [it.key, it.kind, it.title])).toEqual([
            ["session:claude:bare", "session", "bare"],
            ["session:claude:solo", "session", "Fix the rail"],
        ]);
    });

    it("marks a quick run as a quick run", () => {
        const attr = buildAttribution(
            [bkt("q", 1)],
            [ses("q", { runid: "rq", runmode: "quick", rungoal: "Rename a flag", project: WAVE })]
        );
        expect(attr.items[0]).toMatchObject({ key: "run:rq", kind: "quick", title: "Rename a flag" });
    });

    it("still counts a bucket whose session the directory does not list, as a session with no project", () => {
        const attr = buildAttribution([bkt("ghost", 3)], []);
        expect(attr.items).toHaveLength(1);
        expect(attr.items[0]).toMatchObject({ key: "session:claude:ghost", kind: "session", project: "" });
        expect(attr.items[0].tokens).toBe(3 * M);
        expect(attr.total.spendUsd).toBe(75);
        expect(attr.projects).toEqual([]);
        expect(attr.other).toEqual({ count: 1, tokens: 3 * M, spendUsd: 75 });
    });

    it("gives no items, no projects and no throw for an empty window", () => {
        const attr = buildAttribution([], []);
        expect(attr.items).toEqual([]);
        expect(attr.projects).toEqual([]);
        expect(attr.other.count).toBe(0);
        expect(scopeList(attr, ALL, "last 7 days")).toBeNull();
        expect(scopeSplit(attr, ALL, []).parts).toEqual([]);
        expect(scopeBuckets([], attr, resolveScope(attr, "gone", "run:gone"))).toEqual([]);
    });
});

describe("projects", () => {
    it("gives a project at exactly 1% of spend a row and folds one below it", () => {
        // total 100M tokens = $2500: `edge` holds exactly 1%, `under` just less
        const attr = buildAttribution(
            [bkt("big", 98.5), bkt("edge", 1), bkt("under", 0.5)],
            [
                ses("big", { project: WAVE }),
                ses("edge", { project: "C:/work/edge" }),
                ses("under", { project: "C:/work/under" }),
            ]
        );
        expect(attr.projects.map((p) => p.label)).toEqual(["waveterm", "edge"]);
        expect(attr.projects[1].sharePct).toBe(1);
        expect(attr.other).toEqual({ count: 1, tokens: 0.5 * M, spendUsd: 12.5 });
        // the folded folder's session still ranks under All usage
        expect(scopeItems(attr, ALL).map((it) => it.key)).toContain("session:claude:under");
    });

    it("keeps eight rows and folds the ninth qualifying project", () => {
        const names = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];
        const attr = buildAttribution(
            names.map((n, i) => bkt(n, 10 - i)),
            names.map((n) => ses(n, { project: `C:/work/${n}` }))
        );
        expect(attr.projects.map((p) => p.label)).toEqual(names.slice(0, 8));
        expect(attr.other).toEqual({ count: 1, tokens: 2 * M, spendUsd: 50 });
        expect(scopeItems(attr, ALL)).toHaveLength(9);
        expect(otherFoldersText(attr.other)).toContain("1 other folder holds ≈ $50.00");
    });

    it("keeps two repo paths with the same folder name as two projects", () => {
        const attr = buildAttribution(
            [bkt("one", 2), bkt("two", 1)],
            [ses("one", { project: "C:/a/app" }), ses("two", { project: "D:\\b\\app" })]
        );
        expect(attr.projects.map((p) => [p.key, p.label, p.count])).toEqual([
            ["C:/a/app", "app", 1],
            ["D:/b/app", "app", 1],
        ]);
    });

    it("treats one repo named with other slashes or drive-letter case as one project", () => {
        const attr = buildAttribution(
            [bkt("one", 2), bkt("two", 1)],
            [ses("one", { project: "C:/work/waveterm" }), ses("two", { project: "c:\\work\\waveterm\\" })]
        );
        expect(attr.projects.map((p) => [p.key, p.count])).toEqual([["C:/work/waveterm", 2]]);
    });

    it("resolves a project off the rail, or an item the window dropped, to the scope above", () => {
        const attr = buildAttribution([bkt("solo", 1)], [ses("solo", { project: WAVE })]);
        expect(scopeId(resolveScope(attr, WAVE, null))).toBe(`project:${WAVE}`);
        expect(scopeId(resolveScope(attr, "C:/gone", null))).toBe("all");
        expect(scopeId(resolveScope(attr, WAVE, "run:gone"))).toBe(`project:${WAVE}`);
        expect(scopeId(resolveScope(attr, "all", "session:claude:solo"))).toBe("session:claude:solo");
        expect(itemScopeKey(attr, attr.items[0])).toBe(WAVE);
    });
});

describe("splits", () => {
    const buckets = [
        ...RUN_BUCKETS,
        bkt("quick", 3),
        bkt("solo", 2),
        bkt("other", 5),
        bkt("tiny", 0.1), // under 1% of spend: folds
    ];
    const sessions = [
        ...RUN_SESSIONS,
        ses("quick", { project: WAVE, runid: "rq", runmode: "quick", rungoal: "Quick fix" }),
        ses("solo", { project: WAVE, title: "Solo" }),
        ses("other", { project: CYBER }),
        ses("tiny", { project: "C:/work/tiny" }),
    ];
    const attr = buildAttribution(buckets, sessions);
    const statsOf = (scope: WorkScope) => aggregateBuckets(scopeBuckets(buckets, attr, scope), NOW);
    const splitOf = (scope: WorkScope) => scopeSplit(attr, scope, statsOf(scope).split).parts;
    const expectSumsTo = (scope: WorkScope) => {
        const parts = splitOf(scope);
        const { tokensWindow, spendWindowUsd } = statsOf(scope).totals;
        expect(sum(parts, (p) => p.tokens)).toBe(tokensWindow);
        expect(sum(parts, (p) => p.spendUsd)).toBeCloseTo(spendWindowUsd, 9);
    };
    const project = resolveScope(attr, WAVE, null);
    const run = resolveScope(attr, "all", "run:r1");
    const session = resolveScope(attr, "all", "session:claude:solo");
    const quick = resolveScope(attr, "all", "run:rq");

    it("splits All usage by project, with the folded folders as one part", () => {
        expect(splitOf(ALL).map((p) => [p.key, p.label])).toEqual([
            [WAVE, "waveterm"],
            [CYBER, "cyber"],
            ["other", "1 other folder"],
        ]);
        expectSumsTo(ALL);
    });

    it("splits a project by the three kinds of work with their counts", () => {
        expect(splitOf(project).map((p) => [p.label, p.tokens])).toEqual([
            ["Orchestrator runs · 1", 10 * M],
            ["Quick runs · 1", 3 * M],
            ["Sessions no run started · 1", 2 * M],
        ]);
        expectSumsTo(project);
    });

    it("leaves a kind with nothing out of a project's split", () => {
        const cyber = resolveScope(attr, CYBER, null);
        expect(splitOf(cyber).map((p) => p.label)).toEqual(["Sessions no run started · 1"]);
        expectSumsTo(cyber);
    });

    it("splits a run by role with session counts, costliest first", () => {
        // workers and lead tie on spend and tokens, so they keep the order the run ranks its sessions in
        expect(splitOf(run).map((p) => [p.label, p.tokens])).toEqual([
            ["1 lead", 4 * M],
            ["2 workers", 4 * M],
            ["1 reviewer", 1 * M],
            ["1 verifier", 1 * M],
        ]);
        expectSumsTo(run);
    });

    it("splits a single session, and a run of one session, by token class", () => {
        const classes = ["cacheRead", "reasoning", "output", "cacheWrite", "input"];
        expect(splitOf(session).map((p) => p.key)).toEqual(classes);
        expect(splitOf(quick).map((p) => p.key)).toEqual(classes);
        expectSumsTo(session);
        expectSumsTo(quick);
    });

    it("gives a project the aggregate of exactly its buckets, and All usage today's totals", () => {
        const mine = buckets.filter((b) => ["lead", "w1", "w2", "rev", "ver", "quick", "solo"].includes(b.session));
        expect(statsOf(project)).toEqual(aggregateBuckets(mine, NOW));
        expect(statsOf(ALL)).toEqual(aggregateBuckets(buckets, NOW, "all"));
        expect(attr.total.tokens).toBe(aggregateBuckets(buckets, NOW).totals.tokensWindow);
    });
});

describe("ranked list", () => {
    const pi = (session: string, over: Partial<UsageBucket>): UsageBucket =>
        bkt(session, 0, { harness: "pi", provider: "openai-codex", model: "gpt-6.1-sol", ...over });
    const buckets = [
        ...RUN_BUCKETS,
        bkt("solo", 20),
        pi("unpriced-big", { input: 9 * M, reportedcostusd: 0.4 }),
        pi("unpriced-small", { input: 2 * M }),
    ];
    const sessions = [
        ...RUN_SESSIONS,
        ses("solo", { project: WAVE, title: "Solo" }),
        { harness: "pi", session: "unpriced-big", title: "Pi big", project: WAVE },
        { harness: "pi", session: "unpriced-small", title: "Pi small", project: WAVE },
    ];
    const attr = buildAttribution(buckets, sessions);

    it("ranks by estimated spend, then tokens", () => {
        const list = scopeList(attr, ALL, "last 7 days")!;
        expect(list.rows.map((r) => r.title)).toEqual(["Solo", "Ship usage attribution", "Pi big", "Pi small"]);
        expect(list.title).toBe("Spent on");
        expect(list.meta).toBe("4 runs and sessions · last 7 days");
        expect(list.nav).toBe(true);
        expect(list.summary).toBe(
            "1 orchestrator run took ≈ $250 and 3 sessions no run started ≈ $500. A run counts its lead, workers and reviewers together; open one to see it the same way as this page."
        );
        expect(list.rows[1].sub).toBe("waveterm · orchestrator run · 5 sessions · Claude");
    });

    it("shows an unpriced session's reported cost, marked reported", () => {
        const rows = scopeList(attr, ALL, "last 7 days")!.rows;
        expect(rows[2]).toMatchObject({ title: "Pi big", spendUsd: 0, cost: 0.4, reported: true });
        expect(rows[3]).toMatchObject({ title: "Pi small", cost: 0, reported: false });
        expect(rows[0]).toMatchObject({ cost: 500, reported: false });
    });

    it("titles a project's list and drops the project from its rows", () => {
        const list = scopeList(attr, resolveScope(attr, WAVE, null), "all time")!;
        expect(list.title).toBe("Runs and sessions");
        expect(list.rows[0].sub).toBe("session · Claude");
    });

    it("lists a run's sessions by role, without a summary and without navigation", () => {
        const list = scopeList(attr, resolveScope(attr, "all", "run:r1"), "last 7 days")!;
        expect(list.title).toBe("Sessions in this run");
        expect(list.meta).toBe("5 sessions");
        expect(list.summary).toBeUndefined();
        expect(list.nav).toBe(false);
        expect(list.rows[0]).toMatchObject({ key: "claude:lead", sub: "lead · Claude", isRun: false });
    });

    it("has no list for a single session", () => {
        expect(scopeList(attr, resolveScope(attr, "all", "session:claude:solo"), "last 7 days")).toBeNull();
    });

    it("pages eight rows, then up to twenty-five", () => {
        const names = Array.from({ length: 30 }, (_, i) => `s${String(i).padStart(2, "0")}`);
        const many = buildAttribution(
            names.map((n, i) => bkt(n, 30 - i)),
            names.map((n) => ses(n, { project: WAVE }))
        );
        const list = scopeList(many, ALL, "last 7 days")!;
        const collapsed = listPage(list, false);
        expect(collapsed.rows).toHaveLength(8);
        expect(collapsed.rows[0].pct).toBe(100);
        expect(collapsed).toMatchObject({ hasMore: true, moreLabel: "Show top 25 of 30" });
        const expanded = listPage(list, true);
        expect(expanded.rows).toHaveLength(25);
        expect(expanded.moreLabel).toBe("Show top 8");

        const few = buildAttribution(
            names.slice(0, 10).map((n) => bkt(n, 1)),
            []
        );
        expect(listPage(scopeList(few, ALL, "last 7 days")!, false).moreLabel).toBe("Show all 10");
        const short = buildAttribution([bkt("only", 1)], []);
        expect(listPage(scopeList(short, ALL, "last 7 days")!, false).hasMore).toBe(false);
    });
});
