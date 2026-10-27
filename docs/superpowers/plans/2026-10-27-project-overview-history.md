# Project Overview: Now and History implementation plan

**Verify:** `node scripts/verify.mjs ./pkg/jarvis`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs project-overview project-overview-history`
**Prototype:** .superpowers\design\project-overview-history\project

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Redraw a project's Overview in two columns, Now (what waits on you, what runs, what finished unread) and
History (the project's ended sessions, councils and runs of the last 7 days, searchable).

**Architecture:** Frontend only. Pure derivations in `projectoverviewmodel.ts` and `needsyoustripmodel.ts` with
vitest beside them; one small store (`projecthistorystore.ts`, tested) for a project's runs, the archive's paging, and
the column's tab and query; three thin views (`projectnow.tsx`, `projecthistory.tsx`, and the page
`projectoverview.tsx`). Sessions come from the scanned archive (`sessionsarchivestore.ts`), councils from
`councilstore.ts`, runs from `GetChannelRunsCommand`. The page calls `useProjectHistory` once and hands the result to
the History column and to the header's counts.

**Tech Stack:** React 19, jotai (`atomFamily` from `jotai/utils`), Tailwind 4 (container queries `@container` /
`@min-[1000px]:`), vitest, the CDP scenario harness (`scripts/cdp/scenarios.mjs`).

**Spec:** `docs/superpowers/specs/2026-10-27-project-overview-history-design.md` — read it first. The prototype's
boards (Main, CouncilsRuns, Search, Quiet, States, Narrow) are what the built page must reach, with two decided
departures: every row in the 7 days is listed (no "N more this week" cap; the last row is only the Older link), and a
folded Needs you group shows its age range. Read `DESIGN.md` before styling: colours only from `@theme` tokens
(`bg-surface-raised`, `border-edge-mid`, `text-muted`, `text-ink-faint`, `text-asking`, …), never raw hex.

Conventions that bite here:
- Typecheck with `task check:ts` (~2 min; `npx tsc` stack-overflows). One test file: `npx vitest run <path>`.
- Prettier only on the files you touched (`npx prettier --check <paths>`); never on `scripts/*.mjs`.
- Commit with a pathspec: `git commit -m "<msg>" -- <paths>`. No Co-Authored-By trailer.
- Ideas (`pkg/ideastore`, `ideasstore.ts`) are being removed: do not read or show them.

---

### Task 1: Fold same-kind Needs you rows

**Depends on:** none
**Files:** `frontend/app/view/agents/needsyoustripmodel.ts`, `frontend/app/view/agents/needsyoustripmodel.test.ts`

**Step 1: Write the failing test** — append to `needsyoustripmodel.test.ts` (add `foldNeedsYouRows` and `groupAge` to
the existing import from `./needsyoustripmodel`):

```ts
describe("foldNeedsYouRows", () => {
    const rows = (kinds: string[]) =>
        buildNeedsYouRows({
            ...base,
            attention: kinds.map((kind, i) => item({ key: `k${i}`, kind })),
        });

    it("leaves two of a kind as rows", () => {
        const out = foldNeedsYouRows(rows(["run-unverified", "run-unverified"]));
        expect(out.map((e) => e.kind)).toEqual(["row", "row"]);
    });

    it("folds three of a kind into one group where the first stood", () => {
        const out = foldNeedsYouRows(rows(["dag-gate", "run-unverified", "run-unverified", "run-unverified"]));
        expect(out.map((e) => e.kind)).toEqual(["row", "group"]);
        const g = out[1];
        expect(g.kind === "group" && g.rows.map((r) => r.key)).toEqual(["k1", "k2", "k3"]);
        expect(g.kind === "group" && g.kindLabel).toBe("Run to confirm");
    });

    it("never folds a learned rule", () => {
        const learn = (i: number) =>
            item({ key: `learn:skill:notes#${i}`, kind: "learn-proposal", channelid: "", learnid: `skill:notes#${i}` });
        const out = foldNeedsYouRows(
            buildNeedsYouRows({ ...base, attention: [learn(1), learn(2), learn(3)] })
        );
        expect(out.map((e) => e.kind)).toEqual(["row", "row", "row"]);
    });
});

describe("groupAge", () => {
    const day = 86_400_000;
    const now = 10 * day;
    const at = (...since: (number | null)[]) => since.map((waitingSince) => ({ waitingSince }));
    it("reads newest to oldest, the unit once when both share it", () => {
        expect(groupAge(at(now - 4 * day, now - 5 * day), now)).toBe("4–5d");
    });
    it("keeps both units when they differ", () => {
        expect(groupAge(at(now - 3 * 3_600_000, now - 2 * day), now)).toBe("3h–2d");
    });
    it("reads one age when they read the same, and skips rows with no age", () => {
        expect(groupAge(at(now - 5 * day, now - 5 * day - 1000, null), now)).toBe("5d");
        expect(groupAge(at(null), now)).toBe("");
    });
});
```

(`base` and `item` already exist at the top of the test file; `base`'s filter is `"all"`. Check `formatAge`'s output
for 4 days is `4d` and for 3 hours `3h`; if it words them otherwise, keep the tests' intent — one unit when shared —
and adjust the expected strings.)

**Step 2: Run it, expect FAIL** (neither is exported):
`npx vitest run frontend/app/view/agents/needsyoustripmodel.test.ts`

**Step 3: Implement** — append to `needsyoustripmodel.ts`:

```ts
// three or more of a kind read as one row, "Run to confirm · 5 runs", that unfolds to them
export const FOLD_AT = 3;

export type NeedsYouEntry =
    | { kind: "row"; row: StripRow }
    | { kind: "group"; key: string; kindLabel: string; tone: StripRow["tone"]; rows: StripRow[] };

/** Pure: the rows with each kind that has FOLD_AT or more folded into one group, placed where its first row stood; the
 *  order is otherwise the server's. A learned rule never folds: each is decided on its own. */
export function foldNeedsYouRows(rows: StripRow[]): NeedsYouEntry[] {
    const byKind = new Map<string, StripRow[]>();
    for (const r of rows) {
        if (r.learnId == null) {
            byKind.set(r.kindLabel, [...(byKind.get(r.kindLabel) ?? []), r]);
        }
    }
    const out: NeedsYouEntry[] = [];
    const placed = new Set<string>();
    for (const r of rows) {
        const same = r.learnId == null ? (byKind.get(r.kindLabel) ?? []) : [];
        if (same.length < FOLD_AT) {
            out.push({ kind: "row", row: r });
        } else if (!placed.has(r.kindLabel)) {
            placed.add(r.kindLabel);
            out.push({ kind: "group", key: `group:${r.kindLabel}`, kindLabel: r.kindLabel, tone: r.tone, rows: same });
        }
    }
    return out;
}

/** Pure: a group's ages, newest to oldest ("4–5d", "3h–2d"), one age when both read the same; rows with no age are
 *  left out. */
export function groupAge(rows: readonly Pick<StripRow, "waitingSince">[], now: number): string {
    const since = rows.flatMap((r) => (r.waitingSince == null ? [] : [r.waitingSince]));
    if (since.length === 0) {
        return "";
    }
    const newest = stripAge(Math.max(...since), now);
    const oldest = stripAge(Math.min(...since), now);
    if (newest === oldest) {
        return newest;
    }
    const unit = (s: string) => s.match(/[a-z]+$/i)?.[0] ?? "";
    const head = unit(newest) !== "" && unit(newest) === unit(oldest) ? newest.slice(0, -unit(newest).length) : newest;
    return `${head}–${oldest}`;
}
```

**Step 4: Run it, expect PASS.**

**Step 5: Commit**
`git commit -m "feat(overview): fold three or more Needs you items of a kind" -- frontend/app/view/agents/needsyoustripmodel.ts frontend/app/view/agents/needsyoustripmodel.test.ts`

---

### Task 2: The Overview's pure model (Running by run, Finished, sessions, councils and runs, counts)

**Depends on:** none
**Files:** `frontend/app/view/agents/projectoverviewmodel.ts`, `frontend/app/view/agents/projectoverviewmodel.test.ts`

Read first: `projectoverviewmodel.ts` (48 lines) and its test, `agentsviewmodel.ts:1013` (`projectOf` reads
`a.project`, else the transcript path), `runlineage.ts` (`Lineage`, `RunRole`, `RunInfo`, `NO_LINEAGE`),
`agenttreemodel.ts` (`buildAgentTree`, how a group's `running` is summed, ~line 260-415), `sessionsarchivestore.ts`
(`LiveSession`), `channelderive.ts:25` (`normProjectPath`), and the generated types `Council`, `Run`, `RunLand`,
`RunEvidence`, `RunVerification` in `frontend/types/gotypes.d.ts`. Council states are `pkg/council/types.go:12-18`; run
statuses `pkg/jarvis/run.go:16-21`; land states `pkg/orchestrate/land.go:30-34`; the not-verified item this mirrors is
`unverifiedItem` in `pkg/jarvis/attention.go:697-711`.

**Why Running changes:** today `overviewRows` keeps only agents whose own project is the project. A run's workers,
stage agents (plan reviewers, verifier) and a lead started in a worktree have their worktree as project, so they are
left out: the Agent tree's arcterm folder reads 8 working while the Overview's Running reads 1. The tree places them by
lineage; the Overview must do the same.

**Step 1: Write the failing tests** — change the test file's import to
`import { askLine, changesLabel, doingLine, finishedRows, historyCounts, historyItems, isQuiet, overviewRows, projectSessions, runningCount } from "./projectoverviewmodel";`
and add `import type { LiveSession } from "./sessionsarchivestore";`,
`import type { Lineage } from "./runlineage";` and `import { buildAgentTree } from "./agenttreemodel";`. The existing
tests call `overviewRows(agents, terminals, project)` and keep passing (the lineage argument defaults to `NO_LINEAGE`).
Append:

```ts
describe("overviewRows with runs", () => {
    const a = (over: Partial<AgentVM>) =>
        ({ id: "a", name: "a", task: "", state: "working", kind: "claude", project: "arc", ...over }) as AgentVM;
    const lineage: Lineage = {
        roles: {
            lead: { kind: "lead", runId: "r1" },
            w1: { kind: "worker", leadRunId: "r1", taskId: "t-1" },
            w2: { kind: "worker", leadRunId: "r1", taskId: "t-2" },
            v: { kind: "stage", leadRunId: "r1", stageRole: "verifier" },
            ow: { kind: "worker", leadRunId: "r2", taskId: "t-1" },
        },
        runs: {
            r1: {
                runId: "r1",
                channelId: "c",
                title: "Ship it",
                project: "arc",
                dag: { tasks: [{ id: "t-1", state: "done" }, { id: "t-2", state: "running" }] },
            } as RunInfo,
            r2: { runId: "r2", channelId: "c2", title: "Other", project: "other" } as RunInfo,
        },
    };
    const agents = [
        a({ id: "plain" }),
        a({ id: "lead", state: "idle" }),
        a({ id: "w1", project: "r1-t-1" }),
        a({ id: "w2", state: "idle", project: "r1-t-2" }),
        a({ id: "v", project: "r1" }),
        a({ id: "ow", project: "arc" }),
    ];

    it("puts a run's members under its run, whatever their worktree project, and leaves another project's run out", () => {
        const rows = overviewRows(agents, [], "arc", lineage);
        expect(rows.working.map((x) => x.id)).toEqual(["plain"]);
        expect(rows.runs.map((r) => [r.run.runId, r.lead?.id, r.working, r.total])).toEqual([["r1", "lead", 2, 4]]);
    });

    it("counts the working agents as the tree folder's badge does", () => {
        const rows = overviewRows(agents, [], "arc", lineage);
        const group = buildAgentTree(agents, agents.map((x) => x.id), lineage).find(
            (r) => r.kind === "group" && r.project === "arc"
        );
        expect(runningCount(rows)).toBe(group?.kind === "group" ? group.running : -1);
    });

    it("drops a run none of whose members works", () => {
        const idle = agents.map((x) => (x.id === "plain" ? x : { ...x, state: "idle" as const }));
        expect(overviewRows(idle, [], "arc", lineage).runs).toEqual([]);
    });
});
```

The tree's `running` counts a worker only while its task is live and a stage only while it judges (`runRows`); build
the fixture's `dag` so every member above counts there (read `runRows` for what it needs: task states, the lead row,
the verifier's stage role), and change the fixture, not `runningCount`, until the two agree. If `ow` (worker of the
other project's run, its own project `arc`) lands in the tree under `other`, that is the rule: a worker or stage goes
by its run, never by its own project.

```ts
describe("finishedRows", () => {
    const a = (over: Partial<AgentVM>) =>
        ({ id: "a", name: "a", task: "", state: "idle", kind: "claude", project: "p", ...over }) as AgentVM;
    it("lists the project's idle agents with an unread turn, newest first", () => {
        const agents = [
            a({ id: "old", stateSince: 1 }),
            a({ id: "new", stateSince: 5 }),
            a({ id: "read", stateSince: 9 }),
            a({ id: "asking", state: "asking" }),
            a({ id: "elsewhere", project: "q" }),
        ];
        const unread = new Map([
            ["old", 1],
            ["new", 2],
            ["asking", 1],
            ["elsewhere", 1],
        ]);
        expect(finishedRows(agents, "p", unread).map((x) => x.id)).toEqual(["new", "old"]);
    });
});

describe("isQuiet with Finished", () => {
    const empty = { asking: [], working: [], terminals: [], runs: [] };
    it("is quiet only when Finished is empty too", () => {
        expect(isQuiet(empty, 0)).toBe(true);
        expect(isQuiet(empty, 0, 1)).toBe(false);
    });
});

describe("projectSessions", () => {
    const s = (over: Partial<LiveSession>) =>
        ({ id: "s", runtime: "claude", projectpath: "D:\\p", task: "t", lastactivets: 100, live: false, events: [], ...over }) as LiveSession;
    const now = 8 * 86_400_000;
    it("keeps the project's ended sessions in the window, newest first, no run workers", () => {
        const list = [
            s({ id: "in", lastactivets: now - 1000 }),
            s({ id: "newer", lastactivets: now - 10, projectpath: "D:/p/" }),
            s({ id: "live", live: true, lastactivets: now }),
            s({ id: "worker", runid: "r1", lastactivets: now }),
            s({ id: "old", lastactivets: now - 8 * 86_400_000 }),
            s({ id: "other", projectpath: "D:/q", lastactivets: now }),
        ];
        expect(projectSessions(list, "D:/p", now, "").map((x) => x.id)).toEqual(["newer", "in"]);
    });
    it("filters on the task, ignoring case", () => {
        const list = [s({ id: "a", task: "Council store", lastactivets: 5 }), s({ id: "b", task: "Rail", lastactivets: 6 })];
        expect(projectSessions(list, "D:/p", 10, "council").map((x) => x.id)).toEqual(["a"]);
    });
    it("is empty while the archive is not loaded", () => {
        expect(projectSessions(null, "D:/p", 10, "")).toEqual([]);
    });
});

describe("historyItems", () => {
    const day = 86_400_000;
    const now = 10 * day;
    const council = (over: Partial<Council>) =>
        ({ id: "c", project: "D:/p", feature: "f", state: "done", experts: [{}, {}, {}], updated: now - 100, created: 0, round: 1, tokens: 0, calls: 0, ...over }) as Council;
    const run = (over: Partial<Run>) =>
        ({ oid: "r", id: "r", goal: "Ship it\nmore", status: "done", channeloid: "ch", projectpath: "D:/p", createdts: now - 50, phases: [], ...over }) as Run;
    const unverified = (reasons: string[]) =>
        ({ capturedts: 1, hash: "", addtotal: 0, deltotal: 0, verification: { state: "unverified", reasons } }) as RunEvidence;

    it("merges councils and runs newest first, inside the window", () => {
        const out = historyItems(
            [council({ id: "c1", updated: now - 100 }), council({ id: "old", updated: now - 8 * day })],
            [run({ id: "r1", oid: "r1", createdts: now - 50 })],
            now,
            ""
        );
        expect(out.map((i) => i.key)).toEqual(["run:r1", "council:c1"]);
    });

    it("keeps a run to the window by when it was created, not when it ended", () => {
        const late = run({ id: "late", oid: "late", createdts: now - 9 * day, completedts: now - day });
        expect(historyItems([], [late], now, "")).toEqual([]);
    });

    it("reads a council's answer, else its state, and its experts", () => {
        const [withAnswer] = historyItems([council({ summary: { answer: "Yes.", text: "", directions: [], outcomes: {}, at: 1 } })], [], now, "");
        expect(withAnswer.line).toBe("Answer: Yes. · 3 experts");
        const [stopped] = historyItems([council({ state: "stopped", question: "Which db?" })], [], now, "");
        expect(stopped.title).toBe("Which db?");
        expect(stopped.line).toBe("Stopped · 3 experts");
    });

    it("reads a run's goal headline, its land, and what it left unverified until acknowledged", () => {
        const landed = run({ basebranch: "main", land: { state: "landed", notes: ["a note"] }, evidence: unverified(["x", "y"]) });
        const [item] = historyItems([], [landed], now, "");
        expect(item.title).toBe("Ship it");
        expect(item.line).toBe("Landed on main");
        expect(item.warn).toBe("3 not verified");
        const [acked] = historyItems([], [{ ...landed, verificationackts: 5 }], now, "");
        expect(acked.warn).toBe("");
    });

    it("counts the land's notes on a verified run, and warns on a done run only", () => {
        const notesOnly = run({ land: { state: "landed", notes: ["base moved"] } });
        expect(historyItems([], [notesOnly], now, "")[0].warn).toBe("1 not verified");
        const running = run({ status: "executing", evidence: unverified(["x"]) });
        expect(historyItems([], [running], now, "")[0].warn).toBe("");
    });

    it("filters on the title", () => {
        const out = historyItems([council({ feature: "Council store" })], [run({ goal: "Rail" })], now, "council");
        expect(out.map((i) => i.kind)).toEqual(["council"]);
    });
});

describe("historyCounts", () => {
    const item = (kind: "council" | "run") => ({ kind }) as HistoryItem;
    it("names the non-zero counts, singular or plural, with the tab each opens", () => {
        expect(historyCounts(14, [item("run"), item("council"), item("council")])).toEqual([
            { label: "14 sessions", tab: "sessions" },
            { label: "1 run", tab: "councils" },
            { label: "2 councils", tab: "councils" },
        ]);
        expect(historyCounts(0, [])).toEqual([]);
    });
});
```

(Add `HistoryItem` to the import; `RunInfo` comes from `./runlineage`. If `RunEvidence`'s verification field is not
named `verification` in `gotypes.d.ts`, use the real name in both test and code; the server reads
`run.Evidence.Verification`.)

**Step 2: Run, expect FAIL:** `npx vitest run frontend/app/view/agents/projectoverviewmodel.test.ts`

**Step 3: Implement** in `projectoverviewmodel.ts` (imports: `normProjectPath` from `./channelderive`,
`type LiveSession` from `./sessionsarchivestore`, `NO_LINEAGE` and the types `Lineage`, `RunInfo` from
`./runlineage`):

```ts
export interface RunRow {
    run: RunInfo;
    lead?: AgentVM; // the run's lead, when it is in the roster
    working: number; // its members at work, the lead included
    total: number; // its members in the roster, the lead included
}

export interface OverviewRows {
    asking: AgentVM[]; // the project's agents asking, a run's members included, longest-blocked first
    working: AgentVM[]; // its plain agents at work (no part in a run)
    terminals: AgentVM[]; // its terminals running a command
    runs: RunRow[]; // its runs with a member at work, one row each
}

// the run an agent is part of (lead, worker or stage), if the lineage knows it
function runOf(a: AgentVM, lineage: Lineage): RunInfo | undefined {
    const role = lineage.roles[a.id];
    if (role == null) {
        return undefined;
    }
    return lineage.runs[role.kind === "lead" ? role.runId : role.leadRunId];
}

// an agent belongs to the project as the Agent tree places it: a worker or stage by its run's project (its own is its
// worktree), a lead by its run's project or its own, any other agent by its own
function inProject(a: AgentVM, project: string, lineage: Lineage): boolean {
    const run = runOf(a, lineage);
    if (run == null) {
        return projectOf(a) === project;
    }
    return run.project === project || (lineage.roles[a.id]?.kind === "lead" && projectOf(a) === project);
}
```

Then rewrite `overviewRows(agents, terminals, project, lineage = NO_LINEAGE)`:
- `mine = sortAgents(agents.filter((a) => a.kind !== "terminal" && inProject(a, project, lineage)))`.
- `asking` = `mine` asking (run members included).
- `working` = `mine` working with no `runOf(a, lineage)`.
- `runs`: group `mine` that have a run by `run.runId`; `lead` = the member whose role is `lead`; `working` counts the
  group's `state === "working"`; `total` the group's size; keep groups with `working > 0`, in `mine`'s order of their
  first member.
- `terminals` unchanged.

Check the `inProject` rule against the tree: a lead goes by `projectOf(lead)` there and its workers by
`lineage.runs[leadRunId].project`. If the tree places a lead whose run's project differs from its own under its own
project only, make `inProject` match the tree exactly (the count test above is the judge) and say so in the commit.

Add:

```ts
// the Running block's agent count: the plain agents at work and every run's members at work, as the tree folder's
// badge counts them
export function runningCount(rows: OverviewRows): number {
    return rows.working.length + rows.runs.reduce((n, r) => n + r.working, 0);
}
```

`isQuiet(rows, waiting, finished = 0)`: also requires `rows.runs.length === 0` and `finished === 0` (the default
keeps today's caller compiling until Task 6).

Then the History model:

```ts
// History looks back this far; older is Conversation History's
export const HISTORY_WINDOW_MS = 7 * 86_400_000;

export type HistoryTab = "sessions" | "councils";

const hasText = (text: string, q: string) => q === "" || text.toLowerCase().includes(q.toLowerCase());
const samePath = (a: string, b: string) => normProjectPath(a).toLowerCase() === normProjectPath(b).toLowerCase();

// the project's agents that finished a turn you have not looked at, and wait on nothing: the newest first
export function finishedRows(
    agents: readonly AgentVM[],
    project: string,
    unread: ReadonlyMap<string, number>
): AgentVM[] {
    return agents
        .filter(
            (a) =>
                a.kind !== "terminal" &&
                projectOf(a) === project &&
                a.state !== "asking" &&
                a.state !== "working" &&
                (unread.get(a.id) ?? 0) > 0
        )
        .sort((x, y) => (y.stateSince ?? 0) - (x.stateSince ?? 0));
}

// the project's ended sessions in the window, newest first; a run's worker is left to its run, a live one to Now
export function projectSessions(
    sessions: readonly LiveSession[] | null,
    path: string,
    now: number,
    q: string
): LiveSession[] {
    return (sessions ?? [])
        .filter(
            (s) =>
                !s.live &&
                !s.runid &&
                samePath(s.projectpath, path) &&
                s.lastactivets >= now - HISTORY_WINDOW_MS &&
                hasText(s.task, q)
        )
        .sort((a, b) => b.lastactivets - a.lastactivets);
}

// ts orders the list and reads as the row's age; since decides the window (a run by when it was created)
export type HistoryItem =
    | { kind: "council"; key: string; title: string; line: string; warn: string; ts: number; since: number; councilId: string }
    | {
          kind: "run";
          key: string;
          title: string;
          line: string;
          warn: string;
          ts: number;
          since: number;
          channelId: string;
          runId: string;
      };

const COUNCIL_STATE: Record<string, string> = {
    running: "Running",
    "awaiting-you": "Waiting on you",
    done: "Done",
    "not-run": "Not started",
    stopped: "Stopped",
    failed: "Failed",
    queued: "Queued",
};

const RUN_STATUS: Record<string, string> = {
    planning: "Planning",
    "awaiting-review": "Awaiting review",
    executing: "Running",
    blocked: "Blocked",
    done: "Done",
    cancelled: "Cancelled",
};

function councilItem(c: Council): HistoryItem {
    const answer = c.summary?.answer?.trim();
    const n = c.experts?.length ?? 0;
    const state = answer ? `Answer: ${answer}` : (COUNCIL_STATE[c.state] ?? c.state);
    return {
        kind: "council",
        key: `council:${c.id}`,
        title: c.question?.trim() || c.feature,
        line: `${state} · ${n} ${n === 1 ? "expert" : "experts"}`,
        warn: "",
        ts: c.updated,
        since: c.updated,
        councilId: c.id,
    };
}

// what Needs you's "Run to confirm" counts (unverifiedItem, pkg/jarvis/attention.go): on a done run not yet
// acknowledged, the verifier's unverified reasons and the land's notes
function unverifiedCount(r: Run): number {
    if (r.status !== "done" || r.verificationackts) {
        return 0;
    }
    const v = r.evidence?.verification;
    return (v?.state === "unverified" ? (v.reasons?.length ?? 0) : 0) + (r.land?.notes?.length ?? 0);
}

function runItem(r: Run): HistoryItem {
    const land = r.land?.state;
    const line =
        land === "landed"
            ? `Landed on ${r.basebranch || "its base"}`
            : land === "held"
              ? "Land held"
              : (RUN_STATUS[r.status] ?? r.status);
    const unverified = unverifiedCount(r);
    return {
        kind: "run",
        key: `run:${r.id}`,
        title: r.goal.trim().split("\n")[0] || "Orchestrator run",
        line,
        warn: unverified > 0 ? `${unverified} not verified` : "",
        ts: r.completedts || r.createdts,
        since: r.createdts,
        channelId: r.channeloid ?? "",
        runId: r.id,
    };
}

// councils and runs in the window, newest first, kept to the query on their title
export function historyItems(
    councils: readonly Council[] | null,
    runs: readonly Run[] | null,
    now: number,
    q: string
): HistoryItem[] {
    return [...(councils ?? []).map(councilItem), ...(runs ?? []).map(runItem)]
        .filter((i) => i.since >= now - HISTORY_WINDOW_MS && hasText(i.title, q))
        .sort((a, b) => b.ts - a.ts);
}

// the header's "Last 7 days" line: each non-zero count and the History tab it shows
export function historyCounts(
    sessions: number,
    items: readonly Pick<HistoryItem, "kind">[]
): { label: string; tab: HistoryTab }[] {
    const word = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
    const runs = items.filter((i) => i.kind === "run").length;
    const councils = items.filter((i) => i.kind === "council").length;
    return [
        { n: sessions, label: word(sessions, "session"), tab: "sessions" as const },
        { n: runs, label: word(runs, "run"), tab: "councils" as const },
        { n: councils, label: word(councils, "council"), tab: "councils" as const },
    ]
        .filter((c) => c.n > 0)
        .map(({ label, tab }) => ({ label, tab }));
}
```

Update the file's header comment to say it also groups a project's runs for Running and derives the History rows.

**Step 4: Run, expect PASS** (the old tests too). Fix fixtures (not behaviour) if a generated type needs another
required field. `task check:ts` → exit 0 (`projectoverview.tsx` still calls `overviewRows` with three arguments and
`isQuiet` with two; the defaults keep it compiling).

**Step 5: Commit**
`git commit -m "feat(overview): model for runs in Running, Finished, project sessions, councils and runs" -- frontend/app/view/agents/projectoverviewmodel.ts frontend/app/view/agents/projectoverviewmodel.test.ts`

---

### Task 3: The project history store

**Depends on:** Task 2 (imports the HistoryTab type and HISTORY_WINDOW_MS)
**Files:** `frontend/app/view/agents/projecthistorystore.ts`, `frontend/app/view/agents/projecthistorystore.test.ts`

Read first: `channelsstore.ts` (`channelsAtom`, `loadChannels`), `runoriginstore.ts:57-80` (the same per-channel
`GetChannelRunsCommand` fan-out), `sessionsarchivestore.ts` (`sessionsArchiveAtom`, `sessionsErrorAtom`,
`sessionsCursorAtom`, `loadSessionsArchive`, `loadMoreSessionsArchive`, `overlayLive`; the archive holds the newest
100 sessions of every project per page), `councilstore.ts:155` (`useCouncils`, which reloads on mount), and
`councilstore.test.ts` (how it mocks `RpcApi`, `wshrpcutil` and `wps`).

History is read each time the Overview opens and when its project changes. The archive may already be loaded (the
palette, `runoriginstore` and the sidebar load it earlier), so the hook reloads it every time rather than only when it
is null, then reads older pages until the window is covered.

**Step 1: Write the failing tests** — `projecthistorystore.test.ts`, mocking `@/app/store/wshclientapi` (at least
`GetChannelRunsCommand`, `GetSessionsActivityCommand`, and every command the imported stores call at load),
`@/app/store/wshrpcutil` and `@/app/store/wps` as `councilstore.test.ts` does. Set `channelsAtom` directly with
`globalStore.set` (a non-null list skips `loadChannels`). Cases:
- `loadProjectRuns("D:/p")` asks `GetChannelRunsCommand` only for channels whose `projectpath` is the path (`D:\\p\\`
  and `d:/P` count, `D:/q` does not), and `projectRunsAtom("D:/p")` holds both channels' runs, error null.
- a rejected `GetChannelRunsCommand` after a good read keeps the earlier runs and sets `error` to the message.
- `loadSessionsWindow(now)`: with a first page whose oldest session is inside the window and a cursor, it asks the
  next page; it stops when a page's oldest is older than `now - HISTORY_WINDOW_MS`, when the cursor comes back `""`,
  and after `MAX_PAGES` (10) older pages whatever the cursor says. Count the `GetSessionsActivityCommand` calls.

Reset the store's atoms between tests (`globalStore.set(sessionsArchiveAtom, null)` and so on).

**Step 2: Run, expect FAIL:** `npx vitest run frontend/app/view/agents/projecthistorystore.test.ts`

**Step 3: Write the store** (glue only; the pure parts are Task 2's):

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What a project's Overview History column reads (projecthistory.tsx): the project's runs, read from each channel bound
// to its path, with their loading and error state; the sessions archive, read back far enough to cover the window; and
// the column's tab and search, per project, since the centre mode unmounts. Councils are councilstore.ts's; the rows
// they all make are projectoverviewmodel.ts's.

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { fireAndForget } from "@/util/util";
import { atom, useAtomValue, type PrimitiveAtom } from "jotai";
import { atomFamily } from "jotai/utils";
import { useEffect } from "react";
import type { AgentsViewModel } from "./agents";
import { normProjectPath } from "./channelderive";
import { channelsAtom, loadChannels } from "./channelsstore";
import { useCouncils } from "./councilstore";
import { HISTORY_WINDOW_MS, type HistoryTab } from "./projectoverviewmodel";
import {
    loadMoreSessionsArchive,
    loadSessionsArchive,
    overlayLive,
    sessionsArchiveAtom,
    sessionsCursorAtom,
    sessionsErrorAtom,
    type LiveSession,
} from "./sessionsarchivestore";

export type RunsState = { runs: Run[] | null; error: string | null };

export const historyTabAtom = atomFamily((_path: string) => atom<HistoryTab>("sessions") as PrimitiveAtom<HistoryTab>);
export const historyQueryAtom = atomFamily((_path: string) => atom("") as PrimitiveAtom<string>);
export const projectRunsAtom = atomFamily(
    (_path: string) => atom<RunsState>({ runs: null, error: null }) as PrimitiveAtom<RunsState>
);

// the archive's older pages read past the first to cover the window, at most: 1,000 sessions across every project
export const MAX_PAGES = 10;

const samePath = (a: string, b: string) => normProjectPath(a).toLowerCase() === normProjectPath(b).toLowerCase();

/** Reads the runs of every channel bound to the project's path. A failure keeps the runs read before, with the error. */
export async function loadProjectRuns(path: string): Promise<void> {
    const at = projectRunsAtom(path);
    try {
        if (globalStore.get(channelsAtom) == null) {
            await loadChannels();
        }
        const ids = (globalStore.get(channelsAtom) ?? [])
            .filter((c) => c.projectpath && samePath(c.projectpath, path))
            .map((c) => c.oid);
        const lists = await Promise.all(
            ids.map((id) => RpcApi.GetChannelRunsCommand(TabRpcClient, { channelid: id }).then((r) => r.runs ?? []))
        );
        globalStore.set(at, { runs: lists.flat(), error: null });
    } catch (e) {
        globalStore.set(at, { runs: globalStore.get(at).runs, error: e instanceof Error ? e.message : String(e) });
    }
}

/** Reloads the sessions archive, then reads older pages until its oldest session is older than the window, none are
 *  left, or MAX_PAGES were read. */
export async function loadSessionsWindow(now: number): Promise<void> {
    await loadSessionsArchive();
    for (let i = 0; i < MAX_PAGES; i++) {
        const list = globalStore.get(sessionsArchiveAtom);
        const cursor = globalStore.get(sessionsCursorAtom);
        if (list == null || cursor === "" || list.length === 0) {
            return;
        }
        if (Math.min(...list.map((s) => s.lastactivets)) < now - HISTORY_WINDOW_MS) {
            return;
        }
        await loadMoreSessionsArchive();
        if (globalStore.get(sessionsCursorAtom) === cursor) {
            return; // a failed page keeps the cursor: stop rather than ask again
        }
    }
}

export interface ProjectHistory {
    sessions: LiveSession[] | null; // null while the archive loads
    sessionsError: boolean;
    councils: Council[] | null;
    runs: RunsState;
    retrySessions: () => void;
    retryRuns: () => void;
}

/** A project's history, read each time the Overview shows it and when its path changes; not polled. The page calls it
 *  once and hands it to the History column and the header's counts. */
export function useProjectHistory(model: AgentsViewModel, path: string): ProjectHistory {
    const archive = useAtomValue(sessionsArchiveAtom);
    const sessionsError = useAtomValue(sessionsErrorAtom);
    const roster = useAtomValue(model.agentsAtom);
    const councils = useCouncils(path || null);
    const runs = useAtomValue(projectRunsAtom(path));
    useEffect(() => {
        if (!path) {
            return;
        }
        fireAndForget(() => loadSessionsWindow(Date.now()));
        fireAndForget(() => loadProjectRuns(path));
    }, [path]);
    return {
        sessions: archive == null ? null : overlayLive(archive, roster, 0),
        sessionsError,
        councils,
        runs,
        retrySessions: () => fireAndForget(() => loadSessionsWindow(Date.now())),
        retryRuns: () => fireAndForget(() => loadProjectRuns(path)),
    };
}
```

Check before you rely on them: `overlayLive`'s third argument is unused (`_now`); `loadChannels` takes no arguments;
`fireAndForget` takes a function returning a promise; `SessionActivity.lastactivets` is the field name. If
`useCouncils`'s key is not the project path (read `councilProjectKey` in `councilstore.ts` and how
`projectoverview.tsx` passes `path` to `showCouncilSetup`), pass what it expects.

**Step 4: Run, expect PASS;** `task check:ts` (timeout 5 min) → exit 0.

**Step 5: Commit**
`git commit -m "feat(overview): store for a project's runs, the archive window and the History tab" -- frontend/app/view/agents/projecthistorystore.ts frontend/app/view/agents/projecthistorystore.test.ts`

---

### Task 4: The Now column

**Depends on:** Task 1 (uses foldNeedsYouRows and groupAge), Task 2 (uses overviewRows' runs, runningCount, finishedRows, isQuiet)
**Files:** `frontend/app/view/agents/projectnow.tsx`, `frontend/app/view/agents/needsyoustrip.tsx`

The prototype's Main board (left column), Quiet and Narrow boards show it. Read `projectoverview.tsx` (the asking and
Running blocks move here) and `needsyoustrip.tsx` (`ActRow`, `LearnRow`, `whyLines`).

**Step 1: `CompactNeedsYouRows` in `needsyoustrip.tsx`.** The strip's one-line row (116px kind + 140px source + text +
age + buttons) does not fit a 420px column, so the Overview draws two-tier rows:
- line 1: the kind label (`TONE_TEXT[row.tone]`, 10.5px semibold), the source (`text-ink-mid`, truncated), a spacer,
  the age (`stripAge`), then the act button(s) and Open exactly as `ActRow` draws them (same `data-needs-you-act`,
  `data-strip-act`, `data-needs-you-open` attributes and handlers);
- line 2: the text, which unfolds like `ActRow`'s (a `<button data-needs-you-expand aria-expanded>` when `whyLines`
  gives lines; unfolded, the `·` list under it, `data-needs-you-detail`).
- Every row keeps `data-needs-you-row={row.key}`.
- A group from `foldNeedsYouRows`: one row `data-needs-you-group={kindLabel}`, a `<button aria-expanded>` reading
  `▸ <kindLabel> · <n> <noun>` (`runs` for the run kinds, `items` otherwise), with `groupAge(rows, now)` at the right
  (`data-needs-you-group-age`); unfolded, its rows drawn indented (`pl-3`) as compact rows. Folded by default; the fold
  is `useState` (it may reset when the Overview unmounts).
- A learned rule never reaches the Overview (`useNeedsYou(..., project)` leaves them out), so no `LearnRow` here.

Export it as `export function CompactNeedsYouRows({ ny }: { ny: NeedsYou })`. Keep `NeedsYouRows` unchanged for the
Cockpit strip.

**Step 2: `projectnow.tsx`** exports `NowColumn({ model, project, ny }: { model: AgentsViewModel; project: string; ny: NeedsYou })`:

```tsx
// The Overview's Now column: what in the project waits on you (its asking agents and the Cockpit's items for it), what
// runs in it (its agents, terminals and runs, a run's members counted as the Agent tree counts them), and its agents
// that finished a turn you have not read. Rows are projectoverviewmodel.ts's.
```

- Reads `model.agentsAtom`, `model.terminalsAtom`, `model.lineageAtom`, `model.nowAtom`, `unreadAgentsAtom`
  (`unreadagentsstore.ts`); `rows = overviewRows(agents, terminals, project, lineage)`,
  `finished = finishedRows(agents, project, unread)`. Define its own
  `since = (a) => a.stateSince != null ? formatAge(Math.max(0, now - a.stateSince)) : ""` (the page's is a closure,
  not exported).
- Root: `<div data-overview-now className="flex min-w-0 flex-col gap-[18px]">` with a `Now` label
  (`text-[11px] font-semibold text-muted`).
- **Needs you** (`data-overview-needs`, count `rows.asking.length + ny.rows.length`): the asking agents first, two-tier
  (name + age on line 1; `asking` in `text-asking` + `askLine(a)` on line 2; **Answer** button, `data-overview-answer`,
  `selectAgentRow`), each `data-overview-asking={a.id}`; then `<CompactNeedsYouRows ny={ny} />`.
- **Running** (`data-overview-running`, count `runningCount(rows) + rows.terminals.length`): the plain agent and
  terminal rows `projectoverview.tsx` draws today, same `data-overview-running-row`; then one row per `rows.runs` entry,
  `data-overview-running-run={run.runId}`: the working dot, line 1 the run's title (`run.title`, which `runlineage.ts`
  already fills with `runTitle`), line 2 `<working> at work` and, when `run.dag?.tasks` is set,
  ` · <done>/<total> tasks` (`done` = tasks in state `done`), the age of the lead's state (`since(lead)`, empty with no
  lead). Click: `selectAgentRow(model, lead.id)`, or with no lead in the roster
  `openTarget(model, { kind: "run", runId: run.runId })` (`view/jarvis/openref.ts`; check the call shape there).
- **Finished, not read yet** (`data-overview-finished`): one button per agent, `data-overview-finished-row={a.id}`: a
  hollow 7px dot (`border-[1.5px] border-muted rounded-full`), the name, `doingLine(a)` truncated, `since(a)`; click
  `selectAgentRow(model, a.id)`.
- Each block is drawn only when it has rows. When `isQuiet(rows, ny.rows.length, finished.length)`, one line:
  `<p data-overview-quiet …>Nothing needs you and nothing is running in {project}.</p>` (the existing scenario looks
  for `data-overview-quiet`).
- Copy the panel and row classes it needs (`PANEL`, `ROW`, `SectionHead`) from `projectoverview.tsx` into
  `projectnow.tsx` as module-private. Do not edit `projectoverview.tsx` (Task 6 owns it and deletes its copies).

**Step 3:** `task check:ts` → exit 0; `npx prettier --check` the two files; `npx eslint` them.

**Acceptance in the app:** Task 7's steps 1 (two columns), 9 (Narrow), 11 (Quiet), 12 (a run member with a worktree
project counted in its run's row, and Finished) and 13 (folded group with its age range) show this column; Final
judges their shots.

**Step 4: Commit**
`git commit -m "feat(overview): the Now column with runs in Running, folded Needs you and Finished" -- frontend/app/view/agents/projectnow.tsx frontend/app/view/agents/needsyoustrip.tsx`

---

### Task 5: The History column and its `/` key

**Depends on:** Task 2 (uses projectSessions and historyItems), Task 3 (uses ProjectHistory and the tab and query atoms)
**Files:** `frontend/app/view/agents/projecthistory.tsx`, `frontend/app/store/keybindings/bindings.ts`, `docs/keyboard-shortcuts.md`

The prototype's Main (right column), CouncilsRuns, Search, Quiet and States boards show it.

`export function HistoryColumn({ model, path, project, history }: { model: AgentsViewModel; path: string; project: string; history: ProjectHistory })`.
It does not call `useProjectHistory` itself: the page calls it once (Task 6) and passes it down.

- `h = history`; `tab`/`q` from `historyTabAtom(path)` / `historyQueryAtom(path)`; `now` from `model.nowAtom`.
- `sessions = projectSessions(h.sessions, path, now, q)`; `items = historyItems(h.councils, h.runs.runs, now, q)`.
- Root `<section data-overview-history aria-label="History" className="flex min-w-0 flex-1 flex-col gap-[10px]">`.
- Head row: `History` label, spacer, the search `<input data-history-search type="text" aria-label="Search this
  project's history" placeholder="Search this project's history">` (h-[28px], w-[240px], `rounded-[6px] border
  border-edge-mid bg-surface px-[10px] text-[12px]`, `focus-visible:border-accent`), bound to `q`. Escape in it clears
  `q` (and stops there: it does not also leave the Overview while `q` was set).
- Tabs (`role="tablist"`): `Sessions <n>` and `Councils & runs <n>`, `data-history-tab="sessions" | "councils"`,
  `role="tab" aria-selected`, the selected one `text-primary border-b-2 border-primary`, the other `text-muted`. Each
  `<n>` is the filtered count (`sessions.length`, `items.length`), so it follows the search; give the number its own
  `<span data-history-tab-count>`.
- **Sessions** rows: `<button data-history-row={sessionKey(s)} data-history-kind="session">` (`sessionKey` from
  `sessionsruns.ts`): line 1 the task (13px, truncated) and the age (`formatAgeShort(now - s.lastactivets)`,
  `text-ink-faint` 11px); line 2 `[s.branch, runtime name, `${compact(s.tokenstotal)} tokens`].filter(Boolean).join(" · ")`
  in `text-muted` 12px. Use the app's existing compact token formatter (grep `formatTokens` / `compactTokens` in
  `view/agents`). Click: `showSession(model, sessionKey(s))` (`agentcenter.ts`).
- **Councils & runs** rows: `<button data-history-row={item.key} data-history-kind={item.kind}>`: a 52px kind word
  (`Council` / `Run`, 11px semibold `text-ink-mid`); title; line 2 `item.line`, then ` · ` + `item.warn` in a
  `<span data-history-warn className="text-asking">` when set; the age (`formatAgeShort(now - item.ts)`). Click: a
  council `openTarget(model, { kind: "council", councilId })`; a run `openTarget(model, { kind: "channel", channelId,
  runId })` (`view/jarvis/openref.ts`; check each call shape there).
- A search match is marked: wrap the matched part of the title in `<mark className="rounded-[3px] bg-highlightbg px-[2px]
  text-inherit">` (case-insensitive, first match only).
- Every row in the window is listed; no cap. The last row of each list: `<button data-history-older>` "Older:
  Conversation History" → `showHistory(model)`.
- States (each its own `data-history-*`):
  - loading — Sessions: `h.sessions == null`; Councils & runs: `h.councils == null || (h.runs.runs == null &&
    h.runs.error == null)`: `data-history-loading` with `aria-busy="true"`, three skeleton rows (`bg-surface-hover`
    bars).
  - empty with no query: `data-history-empty`. With both lists empty (`projectSessions(..., "")` and
    `historyItems(..., "")`), "No sessions, runs or councils in {project} in the last 7 days."; else the tab's own
    "No sessions in {project} in the last 7 days." / "No councils or runs in {project} in the last 7 days.". Then the
    Older row.
  - no match: `data-history-nomatch` `Nothing in the last 7 days matches "{q}".` + a
    `<button data-history-clear>Clear search</button>` that sets `q` to "".
  - error: `data-history-error`, a red dot (`bg-error`), "Could not read sessions." (Sessions, `h.sessionsError`) /
    `Could not read runs: {h.runs.error}.` (Councils & runs), and `<button data-history-retry>Retry</button>`
    (`h.retrySessions` / `h.retryRuns`); in Councils & runs the councils (and any runs read before) still list under it.

**The `/` binding.** In `buildAgentBindings` (`bindings.ts`), beside `canvases:search`, add:

```ts
        {
            id: "overview:search",
            keys: "/",
            group: "Agent",
            label: "Search the project's history",
            paletteHidden: true,
            when: onOverview,
            run: () => {
                const el = document.querySelector<HTMLInputElement>("[data-history-search]");
                if (el == null) {
                    return false; // an Overview with no project path draws no History
                }
                el.focus();
            },
        },
```

with `const onOverview = (ctx: KeyContext) => navigate(ctx) && ctx.surface === "agent" &&
globalStore.get(centerModeAtom) === "project" && initiativePopoverClosed();` next to `onGallery`. It activates with
the other Agent bindings (`useKeybindings(agentBindings)` in `agentsurface.tsx`), so nothing new is wired. Check no
other Agent binding on `/` fires in the `project` centre mode (the `when`s of `canvases:search` and any other `/`);
if one does, narrow it so the two never share the key.

In `docs/keyboard-shortcuts.md` add, after the `### Agent: Canvas gallery` section, a `### Agent: project Overview`
section with one row: `` | `/` | Search the project's history (`Esc` in the box clears it) | ``, and a one-line intro
(opened from a project folder's menu, Open overview).

**Steps:** write it; `task check:ts` → exit 0; prettier and eslint on `projecthistory.tsx` and `bindings.ts`.

**Acceptance in the app:** Task 7's steps 2-8 and 10-11 show this column (the tabs and counts, a matching search with
`<mark>`, `/` and Escape, no match and Clear search, each row kind's click and the Older row, a failed read with Retry,
loading and empty); Final judges their shots.

**Commit**
`git commit -m "feat(overview): the History column, and / to search it" -- frontend/app/view/agents/projecthistory.tsx frontend/app/store/keybindings/bindings.ts docs/keyboard-shortcuts.md`

---

### Task 6: The two-column page

**Depends on:** Task 4 (renders NowColumn), Task 5 (renders HistoryColumn)
**Files:** `frontend/app/view/agents/projectoverview.tsx`, `CHANGELOG.md`

**Step 1:** In `ProjectOverview`:
- Call `const history = useProjectHistory(model, path ?? "")` with the other hooks, before the `project === ""`
  early return.
- Root keeps `data-project-overview={project}`; it becomes `@container min-h-0 flex-1 overflow-y-auto px-8 py-6`, inner
  `mx-auto flex max-w-[1120px] flex-col gap-[22px]`.
- The header stays as it is; under the buttons add `<div data-overview-counts>`: `Last 7 days:` then each entry of
  `historyCounts(projectSessions(history.sessions, path, now, "").length, historyItems(history.councils,
  history.runs.runs, now, ""))` as a `<button data-overview-count={entry.tab}>` (`text-secondary`, no border) whose
  click sets `historyTabAtom(path)` to `entry.tab`, joined by ` · `. Left out when the list is empty or there is no
  `path`.
- Under the header: `<div className="flex flex-col gap-6 @min-[1000px]:flex-row @min-[1000px]:items-start">` holding
  `<div className="w-full @min-[1000px]:w-[420px] @min-[1000px]:flex-none"><NowColumn model={model} project={project}
  ny={ny} /></div>` and, when `path` is set, `<HistoryColumn model={model} path={path} project={project}
  history={history} />`. With no `path`, Now spans the width.
- Delete the old asking / Running / quiet markup (now in `NowColumn`), `rows`, `since`, `waiting`, `running`, and the
  `PANEL` / `ROW` / `SectionHead` definitions and imports the page no longer uses (the header uses `PRIMARY_BTN` /
  `SECONDARY_BTN`); keep `useNeedsYou` here and pass `ny` down.
- Update the file's header comment.

**Step 2:** `CHANGELOG.md`, under the top `## Unreleased` → `### Changed` (open `## Unreleased` above a dated top
section if there is one):
`- A project's Overview has a History column beside what needs you: its sessions, councils and runs of the last 7 days, searchable with /, and the agents that finished a turn you have not read. Running now lists the project's runs, their workers counted as the Agent tree counts them, and three or more items of one kind in Needs you fold into one row.`

**Step 3:** `task check:ts` → exit 0; `npx vitest run frontend/app/view/agents/projectoverviewmodel.test.ts
frontend/app/view/agents/needsyoustripmodel.test.ts frontend/app/view/agents/projecthistorystore.test.ts` → pass;
prettier and eslint on `projectoverview.tsx`.

**Acceptance in the app:** Task 7's steps 1 (two columns), 2 (the counts line), 3 (a count button switches the tab), 9
(stacked under 1000px) and 11 (no run or council count on a sessions-only project); Final judges their shots, and the
`project-overview` scenario still passes.

**Step 4: Commit**
`git commit -m "feat(overview): Now and History in two columns" -- frontend/app/view/agents/projectoverview.tsx CHANGELOG.md`

---

### Task 7: CDP scenario `project-overview-history`

**Depends on:** Task 6 (drives the two-column page it builds)
**Files:** `scripts/cdp/scenarios.mjs`

Model it on `projectOverview` (`const projectOverview` at ~52410; the helpers `ovSeedRepo`, `ovTerminalTab`,
`ahReload`, `ahResolveModules`, `installAhMock` (~14637), `ovSession`, `ovOpenFromMenu`, `ovHas`, `polishWaitFor`,
`ovHeldRun`, `window.__cockpitOfficeAttention`, and `TREE_RAIL_FIXTURE` for a fixture roster are all there). Do not
change `projectOverview`; its selectors (`data-overview-asking`, `data-overview-running-row`, `data-overview-quiet`,
`data-overview-needs`, `data-needs-you-row`) must still pass, and Final runs both.

**Register it:** add `projectOverviewHistory` to `SCENARIOS` (~53071) right after `projectOverview`, before
`agentComposer` (which stays last). `verify.mjs` errors only when no name matches, so an unregistered scenario would
silently never run.

- **arrange:**
  - Pin the viewport: `h.cdp("Emulation.setDeviceMetricsOverride", { width: 1600, height: 950, deviceScaleFactor: 1,
    mobile: false })`, as `cockpitofficescenarios.mjs` does, so the centre pane is wide enough for two columns.
  - Two temp project dirs registered as projects, A (`ovSeedRepo`) with one channel, and B (no channel), as
    `projectOverview` does.
  - Install a mock RPC client modelled on `installAhMock`, but its own (own window key, own remove), answering:
    - `getsessionsactivity` → with `data.cursor` set, `{ sessions: [] }`; else sessions: in A two ended within 7 days
      with tasks `Council store review` and `Rail rows`, one with `runid` set, one 9 days old; in B one ended session
      `Quiet notes`.
    - `councillist` → for A's key one done council, `feature: "Price a council before it starts"`, `summary.answer`
      `"Keep it short."`, 3 experts, `updated` an hour ago; for B `[]`. While `mode.holdCouncils` is set, B's answer
      is a promise the step resolves (`mode.release()`).
    - `getchannelruns` for A's channel → one run, `goal: "Ship the rail"`, `status: "done"`, `land: { state:
      "landed" }`, `basebranch: "main"`, `evidence.verification: { state: "unverified", reasons: ["a", "b"] }`,
      `createdts` three hours ago, `completedts` two hours ago; while `mode.runsFail` is set, reject with it.
    - everything else passes through to the previous client. Probe it as `installAhMock` does.
  - The mock is the document's: install it after the arrange's reload, and again after any later reload.
- **steps** (record each with `rec(step, ok, detail)` and shoot `cdp-shots/project-overview-history-N.png`; the
  Overview reloads History each time it opens, so reopening it after a mock change is how a step re-reads):
  1. Open A's Overview from the folder's menu (`ovOpenFromMenu`); `[data-overview-now]` and `[data-overview-history]`
     both show, and History's left edge is right of Now's right edge (two columns). Shot 1.
  2. The Sessions tab lists exactly the two in-window ended sessions (`[data-history-row]` count 2, texts include both
     tasks); `[data-overview-counts]` reads `2 sessions · 1 run · 1 council`. Shot 2.
  3. Click `[data-overview-count="councils"]` (the `1 run` button): `[data-history-tab="councils"]` has
     `aria-selected="true"`; a `[data-history-kind="council"]` row contains `Answer: Keep it short.` and `3 experts`; a
     `[data-history-kind="run"]` row contains `Landed on main` and its `[data-history-warn]` reads `2 not verified`.
     Shot 3.
  4. Search match: focus the page (click an empty spot of `[data-project-overview]`, not an input), press `/` with
     `Input.dispatchKeyEvent`: `document.activeElement` is `[data-history-search]`. Type `council` (set the value and
     dispatch `input`, as other scenarios fill inputs): the Sessions tab's `[data-history-tab-count]` reads `1`, the
     Councils & runs one `1`; a `mark` inside a `[data-history-row]` reads `council` case-insensitively (both tabs).
     Shot 4.
  5. Escape in the box (`Input.dispatchKeyEvent` with the box focused): its value is `""`, the counts read `2` and
     `2`, and the Overview is still open.
  6. No match: type `zzz`: `[data-history-nomatch]` shows; click `[data-history-clear]`; the rows come back. Shot 6.
  7. Row clicks: click the Sessions tab's first row → the centre leaves the Overview for the session view; reopen the
     Overview; click the council row → the council view; reopen; click the run row → the run's view; reopen; click
     `[data-history-older]` → Conversation History. Find each view's root `data-*` marker in its component before
     asserting it. Shot 7 on Conversation History.
  8. Error: set `mode.runsFail = "boom"`, reopen A's Overview, open Councils & runs: `[data-history-error]` reads
     `Could not read runs: …boom.` with `[data-history-retry]`, and the council row is still listed. Shot 8. Clear
     `mode.runsFail`, click Retry: `[data-history-error]` is gone and the run row lists.
  9. Narrow: set `style.width = "760px"` on `[data-project-overview]`; Now's bottom is above History's top (stacked).
     Shot 9. Reset the width.
  10. Loading and empty (B, opened for the first time here so its councils are not cached): set
      `mode.holdCouncils`, open B's Overview, click its Councils & runs tab: `[data-history-loading][aria-busy="true"]`
      shows. Shot 10a. `mode.release()`: `[data-history-empty]` reads `No councils or runs in <B> in the last 7 days.`
      and `[data-history-older]` follows it. Shot 10b.
  11. Quiet (still B): `[data-overview-quiet]` shows in Now; the Sessions tab lists one row (`Quiet notes`);
      `[data-overview-counts]` reads `1 session` and has no run or council button; the Councils & runs count reads
      `0`. Shot 11.
  12. Runs in Running and Finished: write a fixture roster (`TREE_RAIL_FIXTURE`, as `projectOverview` step 8 does,
      and the reload it needs; reinstall the mock) with, in A: a lead `ovh-lead` (idle) whose project is A, a worker
      `ovh-w1` (working) whose project is a worktree folder name (as the tree scenarios build a worktree worker; read
      how they give it a lineage role in run `ovh-run`), and an idle plain agent `ovh-done`. Reopen A's Overview:
      `[data-overview-running-run="ovh-run"]` shows and reads `1 at work`, and `ovh-w1` has no
      `[data-overview-running-row]` of its own. Then set `unreadAgentsAtom` to `{ ovh-done: 1 }` through the app's own
      module (resolve `unreadagentsstore.ts`'s URL as `ahResolveInPage` resolves the store's, and use that
      `globalStore`): `[data-overview-finished-row="ovh-done"]` shows. Shot 12. Click it: the Overview leaves for
      `ovh-done`'s terminal, focused. If the unread tracker resets the atom before the row shows, record that in the
      step's detail rather than passing it.
  13. Fold: inject three `run-unverified` items for A's channel through `window.__cockpitOfficeAttention` (go to the
      Cockpit first, as `projectOverview` step 8 does; build them like `ovHeldRun` with `kind: "run-unverified"`,
      `waitingsince` 4 and 5 days ago, `why` `"Not verified: x; y. Once read, accept it with \`wsh runs ack r\`."`),
      come back, reopen the Overview: `[data-needs-you-group="Run to confirm"]` shows with
      `[data-needs-you-group-age]` reading `4–5d`; click its button; three `[data-needs-you-row]` show; click the
      first one's `[data-needs-you-expand]`; `[data-needs-you-detail]` lists `x` and `y`. Shot 13.
- **teardown:** `Emulation.clearDeviceMetricsOverride`; restore the previous mock client; clear the injected attention
  (as `projectOverview`'s teardown does); restore or remove the fixture roster as `projectOverview`'s teardown does;
  remove the projects, channel, tabs and temp dirs exactly as `projectOverview`'s teardown does.

Run it against a dev app if one is up (`task verify:ui -- project-overview-history project-overview`); if none is, say
so in the commit body — Final runs it.

**Commit**
`git commit -m "test(cdp): project-overview-history scenario" -- scripts/cdp/scenarios.mjs`
