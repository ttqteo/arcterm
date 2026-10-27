# Project Overview: Now and History implementation plan

**Verify:** `node scripts/verify.mjs ./pkg/jarvis`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs project-overview project-overview-history`
**Prototype:** .superpowers\design\project-overview-history\project

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Redraw a project's Overview in two columns, Now (what waits on you, what runs, what finished unread) and
History (the project's ended sessions, councils and runs of the last 7 days, searchable).

**Architecture:** Frontend only. Pure derivations in `projectoverviewmodel.ts` and `needsyoustripmodel.ts` with
vitest beside them; one small store (`projecthistorystore.ts`) for a project's runs and the column's tab and query;
three thin views (`projectnow.tsx`, `projecthistory.tsx`, and the page `projectoverview.tsx`). Sessions come from the
scanned archive (`sessionsarchivestore.ts`), councils from `councilstore.ts`, runs from `GetChannelRunsCommand`.

**Tech Stack:** React 19, jotai (`atomFamily` from `jotai/utils`), Tailwind 4 (container queries `@container` /
`@min-[1000px]:`), vitest, the CDP scenario harness (`scripts/cdp/scenarios.mjs`).

**Spec:** `docs/superpowers/specs/2026-10-27-project-overview-history-design.md` — read it first. The prototype's
boards (Main, CouncilsRuns, Search, Quiet, States, Narrow) are what the built page must reach. Read `DESIGN.md` before
styling: colours only from `@theme` tokens (`bg-surface-raised`, `border-edge-mid`, `text-muted`, `text-ink-faint`,
`text-asking`, …), never raw hex.

Conventions that bite here:
- Typecheck with `task check:ts` (~2 min; `npx tsc` stack-overflows). One test file: `npx vitest run <path>`.
- Prettier only on the files you touched (`npx prettier --check <paths>`); never on `scripts/*.mjs`.
- Commit with a pathspec: `git commit -m "<msg>" -- <paths>`. No Co-Authored-By trailer.
- Ideas (`pkg/ideastore`, `ideasstore.ts`) are being removed: do not read or show them.

---

### Task 1: Fold same-kind Needs you rows

**Depends on:** none

**Files:**
- Modify: `frontend/app/view/agents/needsyoustripmodel.ts` (append after `whyLines`)
- Test: `frontend/app/view/agents/needsyoustripmodel.test.ts` (append)

**Step 1: Write the failing test** — append to `needsyoustripmodel.test.ts` (add `foldNeedsYouRows` to the existing
import from `./needsyoustripmodel`):

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
```

(`base` and `item` already exist at the top of the test file; check `base`'s filter is `"all"`.)

**Step 2: Run it, expect FAIL** (`foldNeedsYouRows` is not exported):
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
```

**Step 4: Run it, expect PASS.**

**Step 5: Commit**
`git commit -m "feat(overview): fold three or more Needs you items of a kind" -- frontend/app/view/agents/needsyoustripmodel.ts frontend/app/view/agents/needsyoustripmodel.test.ts`

---

### Task 2: The Overview's pure model (Finished, sessions, councils and runs, counts)

**Depends on:** none

**Files:**
- Modify: `frontend/app/view/agents/projectoverviewmodel.ts`
- Test: `frontend/app/view/agents/projectoverviewmodel.test.ts`

Read first: `projectoverviewmodel.ts` (48 lines), `sessionsarchivestore.ts` (`LiveSession`, `overlayLive`),
`channelderive.ts:25` (`normProjectPath`), and the generated types `Council`, `Run`, `RunLand`, `RunEvidence`,
`RunVerification` in `frontend/types/gotypes.d.ts`. Council states are `pkg/council/types.go:12-18`; run statuses
`pkg/jarvis/run.go:16-21`; land states `pkg/orchestrate/land.go:30-34`.

**Step 1: Write the failing tests** — append to `projectoverviewmodel.test.ts`:

```ts
describe("finishedRows", () => {
    const a = (over: Partial<AgentVM>) =>
        ({ id: "a", name: "a", task: "", state: "idle", kind: "claude", cwd: "D:/p", ...over }) as AgentVM;
    it("lists the project's idle agents with an unread turn, newest first", () => {
        const agents = [
            a({ id: "old", stateSince: 1 }),
            a({ id: "new", stateSince: 5 }),
            a({ id: "read", stateSince: 9 }),
            a({ id: "asking", state: "asking" }),
            a({ id: "elsewhere", cwd: "D:/q" }),
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
```

Check how `projectOf` (`agentsviewmodel.ts:1013`) names a project before writing the fixture: set whatever field it
reads (cwd, a project meta, …) so `projectOf(a)` is `"p"` for the first four and `"q"` for `elsewhere`; adjust the
fixture, not the function.

```ts
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
    const now = 10 * 86_400_000;
    const council = (over: Partial<Council>) =>
        ({ id: "c", project: "D:/p", feature: "f", state: "done", experts: [{}, {}, {}], updated: now - 100, created: 0, round: 1, tokens: 0, calls: 0, ...over }) as Council;
    const run = (over: Partial<Run>) =>
        ({ oid: "r", id: "r", goal: "Ship it\nmore", status: "done", channeloid: "ch", projectpath: "D:/p", createdts: now - 50, phases: [], ...over }) as Run;

    it("merges councils and runs newest first, inside the window", () => {
        const out = historyItems(
            [council({ id: "c1", updated: now - 100 }), council({ id: "old", updated: now - 8 * 86_400_000 })],
            [run({ id: "r1", oid: "r1", createdts: now - 50 })],
            now,
            ""
        );
        expect(out.map((i) => i.key)).toEqual(["run:r1", "council:c1"]);
    });

    it("reads a council's answer, else its state, and its experts", () => {
        const [withAnswer] = historyItems([council({ summary: { answer: "Yes.", text: "", directions: [], outcomes: {}, at: 1 } })], [], now, "");
        expect(withAnswer.line).toBe("Answer: Yes. · 3 experts");
        const [stopped] = historyItems([council({ state: "stopped", question: "Which db?" })], [], now, "");
        expect(stopped.title).toBe("Which db?");
        expect(stopped.line).toBe("Stopped · 3 experts");
    });

    it("reads a run's goal headline, its land, and what it left unverified until acknowledged", () => {
        const landed = run({
            basebranch: "main",
            land: { state: "landed", notes: ["a note"] },
            evidence: { capturedts: 1, hash: "", addtotal: 0, deltotal: 0, verification: { state: "unverified", reasons: ["x", "y"] } } as RunEvidence,
        });
        const [item] = historyItems([], [landed], now, "");
        expect(item.title).toBe("Ship it");
        expect(item.line).toBe("Landed on main");
        expect(item.warn).toBe("3 not verified");
        const [acked] = historyItems([], [{ ...landed, verificationackts: 5 }], now, "");
        expect(acked.warn).toBe("");
    });

    it("filters on the title", () => {
        const out = historyItems([council({ feature: "Council store" })], [run({ goal: "Rail" })], now, "council");
        expect(out.map((i) => i.kind)).toEqual(["council"]);
    });
});

describe("historyCounts", () => {
    it("names the non-zero counts, singular or plural, with the tab each opens", () => {
        expect(historyCounts(14, 1, 0)).toEqual([
            { label: "14 sessions", tab: "sessions" },
            { label: "1 run", tab: "councils" },
        ]);
        expect(historyCounts(0, 0, 0)).toEqual([]);
    });
});
```

If `RunEvidence`'s verification field is not named `verification` in `gotypes.d.ts`, use the real name in both the
test and the code (the server reads `run.Evidence.Verification` in `pkg/jarvis/attention.go:703`).

**Step 2: Run, expect FAIL:** `npx vitest run frontend/app/view/agents/projectoverviewmodel.test.ts`

**Step 3: Implement** — add to `projectoverviewmodel.ts` (imports: `normProjectPath` from `./channelderive`,
`type LiveSession` from `./sessionsarchivestore`):

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

export type HistoryItem =
    | { kind: "council"; key: string; title: string; line: string; warn: string; ts: number; councilId: string }
    | {
          kind: "run";
          key: string;
          title: string;
          line: string;
          warn: string;
          ts: number;
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
        councilId: c.id,
    };
}

function runItem(r: Run): HistoryItem {
    const land = r.land?.state;
    const line =
        land === "landed"
            ? `Landed on ${r.basebranch || "its base"}`
            : land === "held"
              ? "Land held"
              : (RUN_STATUS[r.status] ?? r.status);
    // what Needs you's "Run to confirm" counts (pkg/jarvis/attention.go): the verifier's reasons and the land's notes
    const unverified =
        r.evidence?.verification?.state === "unverified" && !r.verificationackts
            ? (r.evidence.verification.reasons?.length ?? 0) + (r.land?.notes?.length ?? 0)
            : 0;
    return {
        kind: "run",
        key: `run:${r.id}`,
        title: r.goal.trim().split("\n")[0] || "Orchestrator run",
        line,
        warn: unverified > 0 ? `${unverified} not verified` : "",
        ts: r.completedts || r.createdts,
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
        .filter((i) => i.ts >= now - HISTORY_WINDOW_MS && hasText(i.title, q))
        .sort((a, b) => b.ts - a.ts);
}

// the header's "Last 7 days" line: each non-zero count and the History tab it shows
export function historyCounts(
    sessions: number,
    runs: number,
    councils: number
): { label: string; tab: HistoryTab }[] {
    const word = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
    return [
        { n: sessions, label: word(sessions, "session"), tab: "sessions" as const },
        { n: runs, label: word(runs, "run"), tab: "councils" as const },
        { n: councils, label: word(councils, "council"), tab: "councils" as const },
    ]
        .filter((c) => c.n > 0)
        .map(({ label, tab }) => ({ label, tab }));
}
```

Update the file's header comment to say it also derives the History rows.

**Step 4: Run, expect PASS.** Fix fixtures (not behaviour) if a generated type needs another required field.

**Step 5: Commit**
`git commit -m "feat(overview): model for Finished, project sessions, councils and runs" -- frontend/app/view/agents/projectoverviewmodel.ts frontend/app/view/agents/projectoverviewmodel.test.ts`

---

### Task 3: The project history store

**Depends on:** none

**Files:**
- Create: `frontend/app/view/agents/projecthistorystore.ts`

Read first: `channelsstore.ts` (`channelsAtom`, `loadChannels`), `runoriginstore.ts:57-80` (the same per-channel
`GetChannelRunsCommand` fan-out), `sessionsarchivestore.ts` (`sessionsArchiveAtom`, `sessionsErrorAtom`,
`loadSessionsArchive`, `overlayLive`), `councilstore.ts:155` (`useCouncils`).

**Step 1: Write the store** (glue only; the pure parts are Task 2's):

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What a project's Overview History column reads (projecthistory.tsx): the project's runs, read from each channel bound
// to its path, with their loading and error state, and the column's tab and search, per project, since the centre mode
// unmounts. Sessions are the scanned archive's (sessionsarchivestore.ts) and councils councilstore.ts's; the rows they
// make are projectoverviewmodel.ts's.

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
import type { HistoryTab } from "./projectoverviewmodel";
import {
    loadSessionsArchive,
    overlayLive,
    sessionsArchiveAtom,
    sessionsErrorAtom,
    type LiveSession,
} from "./sessionsarchivestore";

export type RunsState = { runs: Run[] | null; error: string | null };

export const historyTabAtom = atomFamily((_path: string) => atom<HistoryTab>("sessions") as PrimitiveAtom<HistoryTab>);
export const historyQueryAtom = atomFamily((_path: string) => atom("") as PrimitiveAtom<string>);
export const projectRunsAtom = atomFamily(
    (_path: string) => atom<RunsState>({ runs: null, error: null }) as PrimitiveAtom<RunsState>
);

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

export interface ProjectHistory {
    sessions: LiveSession[] | null; // null while the archive loads
    sessionsError: boolean;
    councils: Council[] | null;
    runs: RunsState;
    retrySessions: () => void;
    retryRuns: () => void;
}

/** A project's history, read when the Overview shows it and again when its path changes; not polled. */
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
        if (globalStore.get(sessionsArchiveAtom) == null) {
            fireAndForget(loadSessionsArchive);
        }
        fireAndForget(() => loadProjectRuns(path));
    }, [path]);
    return {
        sessions: archive == null ? null : overlayLive(archive, roster, 0),
        sessionsError,
        councils,
        runs,
        retrySessions: () => fireAndForget(loadSessionsArchive),
        retryRuns: () => fireAndForget(() => loadProjectRuns(path)),
    };
}
```

Check before you rely on them: `overlayLive`'s third argument is unused (`_now`); `loadChannels` and
`loadSessionsArchive` take no arguments; `fireAndForget` takes a function returning a promise. If `useCouncils`'s key is
not the project path (read `councilProjectKey` in `councilstore.ts` and how `projectoverview.tsx` passes `path` to
`showCouncilSetup`), pass what it expects.

**Step 2:** `task check:ts` (timeout 5 min) → exit 0.

**Step 3: Commit**
`git commit -m "feat(overview): store for a project's runs and History tab" -- frontend/app/view/agents/projecthistorystore.ts`

---

### Task 4: The Now column

**Depends on:** Task 1, Task 2

**Files:**
- Create: `frontend/app/view/agents/projectnow.tsx`
- Modify: `frontend/app/view/agents/needsyoustrip.tsx` (export `openTitle`; add `CompactNeedsYouRows`)

The prototype's Main board (left column) and Narrow board show it. Read `projectoverview.tsx` (the asking and Running
blocks move here unchanged in behaviour) and `needsyoustrip.tsx` (`ActRow`, `LearnRow`, `whyLines`).

**Step 1: `CompactNeedsYouRows` in `needsyoustrip.tsx`.** The strip's one-line row (116px kind + 140px source + text +
age + buttons) does not fit a 420px column, so the Overview draws two-tier rows:
- line 1: the kind label (`TONE_TEXT[row.tone]`, 10.5px semibold), the source (`text-ink-mid`, truncated), a spacer,
  the age (`stripAge`), then the act button(s) and Open exactly as `ActRow` draws them (same `data-needs-you-act`,
  `data-strip-act`, `data-needs-you-open` attributes and handlers);
- line 2: the text, which unfolds like `ActRow`'s (a `<button data-needs-you-expand aria-expanded>` when `whyLines`
  gives lines; unfolded, the `·` list under it, `data-needs-you-detail`).
- Every row keeps `data-needs-you-row={row.key}`.
- A group from `foldNeedsYouRows`: one row `data-needs-you-group={kindLabel}`, a `<button aria-expanded>` reading
  `▸ <kindLabel> · <n> <rows' noun>` (use `n runs` for the run kinds, `n items` otherwise) with the oldest age; unfolded,
  its rows drawn indented (`pl-3`) as compact rows. Folded by default; the fold is `useState` (it may reset when the
  Overview unmounts).
- A learned rule never reaches the Overview (`useNeedsYou(..., project)` leaves them out), so no `LearnRow` here.

Export it as `export function CompactNeedsYouRows({ ny }: { ny: NeedsYou })`. Keep `NeedsYouRows` unchanged for the
Cockpit strip.

**Step 2: `projectnow.tsx`** exports `NowColumn({ model, project, ny })`:

```tsx
// The Overview's Now column: what in the project waits on you (its asking agents and the Cockpit's items for it), what
// runs in it, and its agents that finished a turn you have not read. Rows are projectoverviewmodel.ts's.
```

- Reads `model.agentsAtom`, `model.terminalsAtom`, `model.nowAtom`, `unreadAgentsAtom` (`unreadagentsstore.ts`);
  `rows = overviewRows(...)`, `finished = finishedRows(agents, project, unread)`.
- Root: `<div data-overview-now className="flex min-w-0 flex-col gap-[18px]">` with a `Now` label
  (`text-[11px] font-semibold text-muted`).
- **Needs you** (`data-overview-needs`, count `rows.asking.length + ny.rows.length`): the asking agents first, two-tier
  (name + age on line 1; `asking` in `text-asking` + `askLine(a)` on line 2; **Answer** button, `data-overview-answer`,
  `selectAgentRow`), each `data-overview-asking={a.id}`; then `<CompactNeedsYouRows ny={ny} />`.
- **Running** (`data-overview-running`): the rows `projectoverview.tsx` draws today, same `data-overview-running-row`.
- **Finished, not read yet** (`data-overview-finished`): one button per agent, `data-overview-finished-row={a.id}`: a
  hollow 7px dot (`border-[1.5px] border-muted rounded-full`), the name, `doingLine(a)` truncated, `since(a)`; click
  `selectAgentRow(model, a.id)`.
- Each block is drawn only when it has rows. With none, one line: `<p data-overview-quiet …>Nothing needs you and
  nothing is running in {project}.</p>` (the existing scenario looks for `data-overview-quiet`).
- Reuse the panel and row classes from `projectoverview.tsx` (`PANEL`, `ROW`, `SectionHead`): move them into
  `projectnow.tsx` and export them, or into a small shared module; the page imports them back.

**Step 3:** `task check:ts` → exit 0; `npx prettier --check` the two files; `npx eslint` them.

**Step 4: Commit**
`git commit -m "feat(overview): the Now column with folded Needs you and Finished" -- frontend/app/view/agents/projectnow.tsx frontend/app/view/agents/needsyoustrip.tsx`

---

### Task 5: The History column

**Depends on:** Task 2, Task 3

**Files:**
- Create: `frontend/app/view/agents/projecthistory.tsx`

The prototype's Main (right column), CouncilsRuns, Search, Quiet and States boards show it.

`export function HistoryColumn({ model, path, project }: { model: AgentsViewModel; path: string; project: string })`:

- `h = useProjectHistory(model, path)`; `tab`/`q` from `historyTabAtom(path)` / `historyQueryAtom(path)`; `now` from
  `model.nowAtom`.
- `sessions = projectSessions(h.sessions, path, now, q)`; `items = historyItems(h.councils, h.runs.runs, now, q)`.
- Root `<section data-overview-history aria-label="History" className="flex min-w-0 flex-1 flex-col gap-[10px]">`.
- Head row: `History` label, spacer, the search `<input data-history-search type="text" aria-label="Search this
  project's history" placeholder="Search this project's history">` (h-[28px], w-[240px], `rounded-[6px] border
  border-edge-mid bg-surface px-[10px] text-[12px]`, `focus-visible:border-accent`), bound to `q`. Escape in it clears
  `q`. `/` focusing it is optional; if you add it, add the binding to `bindings.ts` and `docs/keyboard-shortcuts.md`.
- Tabs (`role="tablist"`): `Sessions <n>` and `Councils & runs <n>`, `data-history-tab="sessions" | "councils"`,
  `role="tab" aria-selected`, the selected one `text-primary border-b-2 border-primary`, the other `text-muted`.
- **Sessions** rows: `<button data-history-row={sessionKey(s)}>` (`sessionKey` from `sessionsruns.ts`): line 1 the task
  (13px, truncated) and the age (`formatAgeShort(now - s.lastactivets)`, `text-ink-faint` 11px); line 2
  `[s.branch, runtime name, `${compact(s.tokenstotal)} tokens`].filter(Boolean).join(" · ")` in `text-muted` 12px. Use
  the app's existing compact token formatter (grep `formatTokens` / `compactTokens` in `view/agents`). Click:
  `showSession(model, sessionKey(s))` (`agentcenter.ts`).
- **Councils & runs** rows: `<button data-history-row={item.key}>`: a 52px kind word (`Council` / `Run`, 11px
  semibold `text-ink-mid`); title; line 2 `item.line`, then ` · ` + `item.warn` in `text-asking` when set; the age.
  Click: a council `openTarget(model, { kind: "council", councilId })`; a run `openTarget(model, { kind: "channel",
  channelId, runId })` (`view/jarvis/openref.ts`).
- A search match is marked: wrap the matched part of the title in `<mark className="rounded-[3px] bg-highlightbg px-[2px]
  text-inherit">` (case-insensitive, first match only).
- Last row of each list: `<button data-history-older>` "Older: Conversation History" → `showHistory(model)`.
- States (each its own `data-history-*`):
  - loading (`h.sessions == null` on Sessions; `h.councils == null && h.runs.runs == null` on the other):
    `data-history-loading`, three skeleton rows (`bg-surface-hover` bars), `aria-busy`.
  - empty with no query: `data-history-empty` "No sessions, runs or councils in {project} in the last 7 days." then
    the Older row.
  - no match: `data-history-nomatch` `Nothing in the last 7 days matches "{q}".` + **Clear search**.
  - error: `data-history-error`, a red dot (`bg-error`), "Could not read sessions." / `Could not read runs: {error}.`,
    **Retry** (`h.retrySessions` / `h.retryRuns`); in Councils & runs the councils still list under it.
- Expose the counts for the header: `export function useHistoryCounts(model, path)` returning
  `historyCounts(sessions.length, runs-in-window count, councils-in-window count)` computed with `q = ""`, and the
  setter for the tab, so the page's count buttons can switch tabs.

**Steps:** write it, `task check:ts` → exit 0, prettier and eslint on the file, then
`git commit -m "feat(overview): the History column" -- frontend/app/view/agents/projecthistory.tsx`

---

### Task 6: The two-column page

**Depends on:** Task 4, Task 5

**Files:**
- Modify: `frontend/app/view/agents/projectoverview.tsx`
- Modify: `CHANGELOG.md` (top `## Unreleased`, `### Changed`)

**Step 1:** In `ProjectOverview`:
- Root keeps `data-project-overview={project}`; it becomes `@container min-h-0 flex-1 overflow-y-auto px-8 py-6`, inner
  `mx-auto flex max-w-[1120px] flex-col gap-[22px]`.
- The header stays as it is; under the buttons add `<div data-overview-counts>`: `Last 7 days:` then each
  `useHistoryCounts` entry as a `<button>` (`text-secondary`, no border) that sets the History tab, joined by ` · `.
  Left out when the list is empty or there is no `path`.
- Under the header: `<div className="flex flex-col gap-6 @min-[1000px]:flex-row @min-[1000px]:items-start">` holding
  `<div className="w-full @min-[1000px]:w-[420px] @min-[1000px]:flex-none"><NowColumn …/></div>` and, when `path` is
  set, `<HistoryColumn model={model} path={path} project={project} />`. With no `path`, Now spans the width.
- Remove the old asking / Running / quiet markup now in `NowColumn`; keep `useNeedsYou` here and pass `ny` down.
- Update the file's header comment.

**Step 2:** `CHANGELOG.md`, under the top `## Unreleased` → `### Changed`:
`- A project's Overview has a History column beside what needs you: its sessions, councils and runs of the last 7 days, searchable, and the agents that finished a turn you have not read. Three or more items of one kind in Needs you fold into one row.`

**Step 3:** `task check:ts` → exit 0; `npx vitest run frontend/app/view/agents/projectoverviewmodel.test.ts
frontend/app/view/agents/needsyoustripmodel.test.ts` → pass; prettier and eslint on the touched `.tsx`.

**Step 4: Commit**
`git commit -m "feat(overview): Now and History in two columns" -- frontend/app/view/agents/projectoverview.tsx CHANGELOG.md`

---

### Task 7: CDP scenario `project-overview-history`

**Depends on:** Task 6

**Files:**
- Modify: `scripts/cdp/scenarios.mjs` (add the scenario next to `projectOverview`, ~line 52410, and register it where
  `projectOverview` is registered)

Model it on `projectOverview` (arrange at ~52413; the helpers `ovSeedRepo`, `ovTerminalTab`, `ahReload`,
`ahResolveModules`, `ovSession`, `ovOpenFromMenu`, `ovHas`, `polishWaitFor`, `ovHeldRun`, `window.__cockpitOfficeAttention`
are all there). Do not change `projectOverview`; its selectors (`data-overview-asking`, `data-overview-running-row`,
`data-overview-quiet`, `data-overview-needs`, `data-needs-you-row`) must still pass, and Final runs both.

- **arrange:** a temp project dir registered as a project with one channel (as `projectOverview` does). Install a mock
  RPC client like `installAhMock` (~14637) but answering three commands: `getsessionsactivity` → sessions in the
  project (two ended within 7 days with tasks `Council store review` and `Rail rows`, one with `runid` set, one 9 days
  old, one in another project path); `councillist` → one done council with `summary.answer` `"Keep it short."` and
  3 experts, `updated` an hour ago, `project` the dir; `getchannelruns` for the channel → one run `goal: "Ship the
  rail"`, `land.state: "landed"`, `basebranch: "main"`, `evidence.verification: { state: "unverified", reasons: ["a",
  "b"] }`, `completedts` two hours ago. Everything else passes through to the previous client. Probe it like
  `installAhMock` does.
- **steps** (record each with `rec(step, ok, detail)` and shoot `cdp-shots/project-overview-history-N.png`):
  1. Open the Overview from the folder's menu (`ovOpenFromMenu`); `[data-overview-now]` and `[data-overview-history]`
     both show, and History's left edge is right of Now's right edge (two columns). Shot 1.
  2. The Sessions tab lists exactly the two in-window ended sessions (`[data-history-row]` count 2, texts include both
     tasks); the counts line reads `2 sessions · 1 run · 1 council`. Shot 2.
  3. Click `[data-history-tab="councils"]`: a row containing `Answer: Keep it short.` and one containing `Landed on
     main` and `2 not verified`. Shot 3.
  4. Type `zzz` into `[data-history-search]` (set the value and dispatch `input`, as other scenarios fill inputs):
     `[data-history-nomatch]` shows; click its Clear search; the rows come back. Shot 4.
  5. Narrow: set `style.width = "760px"` on `[data-project-overview]`; Now's bottom is above History's top (stacked).
     Shot 5. Reset the width.
  6. Fold: inject three `run-unverified` items for the channel through `window.__cockpitOfficeAttention` (go to the
     Cockpit first, as `projectOverview` step 8 does; build them like `ovHeldRun` with `kind: "run-unverified"`, `why`
     `"Not verified: x; y. Once read, accept it with \`wsh runs ack r\`."`), come back, reopen the Overview:
     `[data-needs-you-group="Run to confirm"]` shows; click its button; three `[data-needs-you-row]` show; click the
     first one's `[data-needs-you-expand]`; `[data-needs-you-detail]` lists `x` and `y`. Shot 6.
- **teardown:** restore the previous mock client, clear the injected attention (`__cockpitOfficeAttention(null)` or as
  `projectOverview`'s teardown does), remove the project, channel, tabs and temp dir exactly as `projectOverview`'s
  teardown does.

Run it against a dev app if one is up (`task verify:ui -- project-overview-history project-overview`); if none is, say
so in the commit body — Final runs it.

**Commit**
`git commit -m "test(cdp): project-overview-history scenario" -- scripts/cdp/scenarios.mjs`
