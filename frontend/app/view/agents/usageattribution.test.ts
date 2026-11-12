import { describe, expect, it } from "vitest";
import {
    FOLD_FILL,
    LIST_COLLAPSED_ROWS,
    LIST_PAGE_STEP,
    buildAttribution,
    itemScopeKey,
    laneFill,
    listPage,
    listPageShown,
    nextShown,
    otherFoldersText,
    resolveScope,
    scopeBuckets,
    scopeId,
    scopeItems,
    scopeList,
    scopeName,
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

describe("paged list", () => {
    it("pages eight rows, then 25 more per step, until every row shows", () => {
        const names = Array.from({ length: 70 }, (_, i) => `s${String(i).padStart(2, "0")}`);
        const many = buildAttribution(
            names.map((n, i) => bkt(n, 70 - i)),
            names.map((n) => ses(n, { project: WAVE })),
            []
        );
        const list = scopeList(many, ALL, "last 7 days")!;
        const at8 = listPageShown(list, LIST_COLLAPSED_ROWS);
        expect(at8.rows).toHaveLength(8);
        expect(at8.rows[0].pct).toBe(100);
        expect(at8).toMatchObject({ moreLabel: "Show 25 more", lessLabel: undefined });

        const step1 = nextShown(LIST_COLLAPSED_ROWS, list.rows.length);
        expect(step1).toBe(8 + LIST_PAGE_STEP);
        const at33 = listPageShown(list, step1);
        expect(at33.rows).toHaveLength(33);
        expect(at33).toMatchObject({ moreLabel: "Show 25 more", lessLabel: "Show top 8" });

        const at58 = listPageShown(list, nextShown(step1, list.rows.length));
        expect(at58.rows).toHaveLength(58);
        expect(at58.moreLabel).toBe("Show the last 12");

        const last = nextShown(58, list.rows.length);
        expect(last).toBe(70);
        const atTotal = listPageShown(list, last);
        expect(atTotal.rows).toHaveLength(70);
        expect(atTotal).toMatchObject({ moreLabel: undefined, lessLabel: "Show top 8" });
        expect(nextShown(last, list.rows.length)).toBe(70);
    });

    it("offers the rest in one step when fewer than 25 remain, and nothing for a short list", () => {
        const few = buildAttribution(
            Array.from({ length: 10 }, (_, i) => bkt(`f${i}`, 1)),
            []
        );
        expect(listPageShown(scopeList(few, ALL, "last 7 days")!, LIST_COLLAPSED_ROWS).moreLabel).toBe(
            "Show the last 2"
        );
        const short = buildAttribution([bkt("only", 1)], []);
        expect(listPageShown(scopeList(short, ALL, "last 7 days")!, LIST_COLLAPSED_ROWS)).toMatchObject({
            moreLabel: undefined,
            lessLabel: undefined,
        });
    });

    it("keeps listPage's two-state form for its callers", () => {
        const names = Array.from({ length: 30 }, (_, i) => `k${String(i).padStart(2, "0")}`);
        const many = buildAttribution(
            names.map((n, i) => bkt(n, 30 - i)),
            []
        );
        expect(listPage(scopeList(many, ALL, "last 7 days")!, false)).toMatchObject({
            hasMore: true,
            moreLabel: "Show top 25 of 30",
        });
    });
});

describe("brainstorm sessions fold into their lead", () => {
    const judge = (session: string, lead: string, over: Partial<UsageSessionMeta> = {}) =>
        ses(session, { role: "judge", project: WAVE, leadharness: "claude", leadsession: lead, ...over });

    it("joins a judge and a builder check to the lead's session item, titled by the lead", () => {
        const attr = buildAttribution(
            [bkt("agent", 1), bkt("j1", 3), bkt("chk", 2)],
            [
                ses("agent", { title: "Brainstorm the rail", project: WAVE }),
                judge("j1", "agent", { title: "Judge the design" }),
                judge("chk", "agent", { role: "builder-check", title: "Check the build" }),
            ]
        );
        expect(attr.items).toHaveLength(1);
        const [item] = attr.items;
        expect(item).toMatchObject({ key: "session:claude:agent", kind: "session", title: "Brainstorm the rail" });
        expect(item.runId).toBeUndefined();
        expect(item.tokens).toBe(6 * M);
        expect(item.sessions.map((s) => s.role).sort()).toEqual(["", "builder-check", "judge"]);
    });

    it("titles a lead's item by its costliest session when the lead billed nothing in the window", () => {
        const attr = buildAttribution(
            [bkt("j1", 1), bkt("j2", 3)],
            [
                ses("agent", { title: "Brainstorm the rail", project: WAVE }),
                judge("j1", "agent", { title: "Small judge" }),
                judge("j2", "agent", { title: "Big judge" }),
            ]
        );
        expect(attr.items.map((it) => [it.key, it.title])).toEqual([["session:claude:agent", "Big judge"]]);
    });

    it("joins a judge to its lead's run when the directory places the lead in one", () => {
        const attr = buildAttribution([...RUN_BUCKETS, bkt("j1", 2)], [...RUN_SESSIONS, judge("j1", "lead")]);
        expect(attr.items).toHaveLength(1);
        expect(attr.items[0]).toMatchObject({ key: "run:r1", kind: "orchestrator", runId: "r1", tokens: 12 * M });
        expect(attr.items[0].sessions.map((s) => s.key)).toContain("claude:j1");
    });

    it("places a judge under its lead's run even when the lead billed nothing in the window", () => {
        const attr = buildAttribution([bkt("j1", 2)], [inRun("lead", "lead"), judge("j1", "lead")]);
        expect(attr.items[0]).toMatchObject({ key: "run:r1", kind: "orchestrator", runId: "r1", channelId: "c1" });
    });
});

describe("titles", () => {
    it("titles a run's task session row by its task id and task title, else its session title", () => {
        const attr = buildAttribution(
            [bkt("lead", 3), bkt("w1", 2), bkt("w2", 1)],
            [
                inRun("lead", "lead", { title: "Lead" }),
                inRun("w1", "worker", { title: "AI title", taskid: "t-3", tasktitle: "Wire types" }),
                inRun("w2", "worker", { title: "No task title", taskid: "t-4" }),
            ]
        );
        const list = scopeList(attr, resolveScope(attr, "all", "run:r1"), "last 7 days")!;
        expect(list.rows.map((r) => r.title)).toEqual(["Lead", "t-3 · Wire types", "No task title"]);
    });

    it("titles a run by its chunk, then its lead's title, then its goal", () => {
        const runOf = (lead: Partial<UsageSessionMeta>, worker: Partial<UsageSessionMeta> = {}) =>
            buildAttribution(
                [bkt("lead", 1), bkt("w1", 3)],
                [inRun("lead", "lead", lead), inRun("w1", "worker", { title: "Worker title", ...worker })]
            ).items[0].title;
        expect(runOf({ title: "Lead title" }, { runchunk: "Chunk 2: wire types" })).toBe("Chunk 2: wire types");
        expect(runOf({ title: "Lead title" })).toBe("Lead title");
        // the lead has no scanned title: its id is not a title, so the goal names the run
        expect(runOf({})).toBe("Ship usage attribution");
    });

    it("titles a quick run by its own session's title before its goal", () => {
        const quick = (over: Partial<UsageSessionMeta>) =>
            buildAttribution(
                [bkt("q", 1)],
                [ses("q", { runid: "rq", runmode: "quick", rungoal: "Rename a flag", project: WAVE, ...over })]
            ).items[0].title;
        expect(quick({ title: "Renamed the flag" })).toBe("Renamed the flag");
        expect(quick({})).toBe("Rename a flag");
    });
});

describe("project labels", () => {
    it("labels a project by its registered name, from any member session", () => {
        const attr = buildAttribution(
            [bkt("one", 2), bkt("two", 1)],
            [ses("one", { project: WAVE }), ses("two", { project: "c:\\work\\waveterm", projectname: "Arc" })]
        );
        expect(attr.projects.map((p) => [p.key, p.label])).toEqual([[WAVE, "Arc"]]);
        expect(attr.items.map((it) => it.projectLabel)).toEqual(["Arc", "Arc"]);
    });

    it("leaves an unregistered folder named by its folder, colliding or not", () => {
        const attr = buildAttribution(
            [bkt("a", 5), bkt("r", 1)],
            [
                ses("a", { project: "C:/x/same/app" }),
                ses("r", { project: "C:/z/cyber_anomaly_detector", projectname: "cyber" }),
            ]
        );
        expect(attr.projects.map((p) => p.label)).toEqual(["app", "cyber"]);
    });
});

describe("initiatives", () => {
    const EFF = "0a1b2c3d-4e5f-6789-abcd-ef0123456789";
    const OTHER = "99887766-5544-3322-1100-ffeeddccbbaa";
    const buckets = [...RUN_BUCKETS, bkt("solo", 2), bkt("cy", 3), bkt("loose", 1), bkt("tagged-other", 0.5)];
    const sessions = [
        ...RUN_SESSIONS.map((s) => (s.session === "w1" ? { ...s, effort: EFF } : s)),
        ses("solo", { project: WAVE, title: "Solo", effort: EFF }),
        ses("cy", { project: CYBER, title: "Cyber", effort: EFF }),
        ses("loose", { project: WAVE, title: "Loose" }),
        ses("tagged-other", { project: WAVE, title: "Other initiative", effort: OTHER }),
    ];
    const attr = buildAttribution(buckets, sessions, [{ oid: EFF, title: "Usage review fixes" }]);
    const scope = resolveScope(attr, `effort:${EFF}`, null);

    it("groups the items any member tags, ranked by spend, named by the effort or the oid's first 8", () => {
        expect(attr.initiatives.map((i) => [i.key, i.label, i.count])).toEqual([
            [`effort:${EFF}`, "Usage review fixes", 3],
            [`effort:${OTHER}`, "99887766", 1],
        ]);
        const [mine] = attr.initiatives;
        expect(mine.tokens).toBe(15 * M);
        expect(mine.sharePct).toBeCloseTo((375 / 412.5) * 100, 9);
    });

    it("keeps at most six, the costliest", () => {
        const ids = Array.from({ length: 7 }, (_, i) => `eff${i}`);
        const many = buildAttribution(
            ids.map((id, i) => bkt(id, 7 - i)),
            ids.map((id) => ses(id, { project: WAVE, effort: id }))
        );
        expect(many.initiatives.map((i) => i.oid)).toEqual(ids.slice(0, 6));
    });

    it("resolves an initiative scope and narrows items and buckets to it", () => {
        expect(scope.kind).toBe("initiative");
        expect(scopeId(scope)).toBe(`effort:${EFF}`);
        expect(scopeItems(attr, scope).map((it) => it.key)).toEqual([
            "run:r1",
            "session:claude:cy",
            "session:claude:solo",
        ]);
        expect(sum(scopeSplit(attr, scope, []).parts, (p) => p.tokens)).toBe(15 * M);
        expect(scopeBuckets(buckets, attr, scope)).toHaveLength(7);
        expect(scopeName(attr, `effort:${EFF}`)).toBe("Usage review fixes");
        expect(scopeId(resolveScope(attr, "effort:gone", null))).toBe("all");
    });

    it("sends a drilled item to its project on the rail, else to its initiative", () => {
        const offRail = buildAttribution([bkt("x", 1)], [ses("x", { effort: EFF })]);
        expect(itemScopeKey(offRail, offRail.items[0])).toBe(`effort:${EFF}`);
        expect(itemScopeKey(attr, attr.items[0])).toBe(WAVE);
    });

    it("splits an initiative by kind, as a project", () => {
        const split = scopeSplit(attr, scope, []);
        expect(split.note).toContain("initiative");
        expect(split.parts.map((p) => p.label)).toEqual(["Orchestrator runs · 1", "Sessions no run started · 2"]);
    });

    it("lists an initiative's runs and sessions with their projects, saying only open tabs' sessions count", () => {
        const list = scopeList(attr, scope, "last 7 days")!;
        expect(list.title).toBe("Runs and sessions");
        expect(list.meta).toBe("3 runs and sessions · last 7 days · runs, and sessions from open tabs");
        expect(list.rows.map((r) => r.sub)).toEqual([
            "waveterm · orchestrator run · 5 sessions",
            "cyber · session",
            "waveterm · session",
        ]);
    });
});

describe("unpriced rows", () => {
    it("marks a row with tokens, nothing priced and no reported cost as unpriced", () => {
        const sol = (session: string, over: Partial<UsageBucket> = {}) =>
            bkt(session, 0, { harness: "pi", model: "no-such-model", input: M, ...over });
        const attr = buildAttribution(
            [bkt("priced", 1), sol("bare"), sol("reported", { reportedcostusd: 0.3 })],
            []
        );
        const rows = scopeList(attr, ALL, "last 7 days")!.rows;
        const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
        expect(byKey["session:pi:bare"]).toMatchObject({ unpriced: true, reported: false, cost: 0 });
        expect(byKey["session:pi:reported"]).toMatchObject({ unpriced: false, reported: true, cost: 0.3 });
        expect(byKey["session:claude:priced"].unpriced).toBe(false);
    });
});

describe("fills", () => {
    it("runs the graph lanes by position, then the fold lane", () => {
        expect([0, 1, 5, 6, 9].map(laneFill)).toEqual([
            "bg-graphlane-1",
            "bg-graphlane-2",
            "bg-graphlane-6",
            FOLD_FILL,
            FOLD_FILL,
        ]);
    });

    it("gives a project's card dot and its split row one lane, and the folded rest the fold lane", () => {
        const names = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];
        const attr = buildAttribution(
            names.map((n, i) => bkt(n, 20 - i)),
            names.map((n) => ses(n, { project: `C:/work/${n}` }))
        );
        expect(attr.projects.map((p) => p.fill)).toEqual([
            "bg-graphlane-1",
            "bg-graphlane-2",
            "bg-graphlane-3",
            "bg-graphlane-4",
            "bg-graphlane-5",
            "bg-graphlane-6",
            FOLD_FILL,
            FOLD_FILL,
        ]);
        const parts = scopeSplit(attr, ALL, []).parts;
        expect(parts.map((p) => p.fill)).toEqual([...attr.projects.map((p) => p.fill), FOLD_FILL]);
    });

    it("gives a run's roles and a project's kinds lanes by position", () => {
        const attr = buildAttribution(RUN_BUCKETS, RUN_SESSIONS);
        const roles = scopeSplit(attr, resolveScope(attr, "all", "run:r1"), []).parts;
        expect(roles.map((p) => p.fill)).toEqual(roles.map((_, i) => laneFill(i)));
    });
});
