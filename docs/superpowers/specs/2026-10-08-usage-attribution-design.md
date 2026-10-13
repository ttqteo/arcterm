# Usage attribution: spend by project, run and session

Date: 2026-10-08. Status: implemented 2026-10-08 (run d1023f2b).

## Problem

The Usage surface answers "how much, on which provider and model, on which day". It cannot answer
"what was it spent on". `usagestats.Bucket` is keyed by harness, provider, model and day, so nothing
downstream can group by session, run or project. Two deferred items wait on this
(`docs/deferred.md`: usage-to-work links, Usage project support).

What already exists and is not rebuilt here:

- Per-run token accounting: `pkg/jarvis/usage.go` `RunUsage`, sealed into `Run.Evidence.Usage` as
  `[]waveobj.UsageRow`, shown by `frontend/app/view/jarvis/runusage.ts` on the run rail, DAG header,
  peek and cockpit. It is tokens only.
- Priced usage for the focused agent's transcript (`sessionusage.ts`, `GetTranscriptUsageCommand`).

So the gaps are two: the Usage surface has no work dimension, and a run shows no estimate.

## Measurements (2026-10-08, the author's machine, read-only)

- Roots: claude 2481 files / 2221 MB, codex 683 / 559 MB, opencode 778 / 9 MB, pi 605 / 288 MB.
- `ScanUsage`: 7 days 747 ms cold / 210 ms warm, 18 buckets; all time 8.27 s cold / 618 ms warm,
  301 buckets.
- With a session key the bucket count becomes 499 (7 days, 493 sessions) and 1879 (all time, 1809
  sessions). No message id appears in two sessions, so corpus-wide dedupe moves nothing between them.
- A claude transcript's file name equals its inner `sessionId` in 400 of 400 sampled files, one
  session per file.
- Store: 921 runs, 846 with `sessionid`, 83 with `leadsessionids`; every DAG child has a session id;
  all 921 have `projectpath`. There are 932 claude project slug dirs (worktrees), so a project
  cannot come from the slug: it comes from the run's `ProjectPath`, else the session's cwd.
- 7 days: 1.46B tokens, about $890 estimated, 200 work items: 32 orchestrator runs about $396, 22
  quick runs about $71, 146 sessions no run started about $423. Two projects hold 99% of it. The
  costliest run (about $70, 35 sessions) never appears in a sessions-only top ten, which is why the
  ranked unit is the run, not the session.

## Decisions

1. One scan, one RPC. The bucket gains a session key; the same reply carries a session directory.
   Rejected: a second per-session RPC (two scans to keep consistent), a SQLite usage table (a second
   source of truth for what the transcripts already hold; warm scan is 0.2 to 0.6 s).
2. Nothing is persisted. A finished run's totals already live in `Evidence.Usage`.
3. Dedupe stays corpus-wide, before bucketing, so every existing total is unchanged.
4. The work item is a run (its lead, workers, reviewers and stage sessions together) or a session no
   run started. Projects group work items.
5. The Usage surface keeps one detail page and gains a second way to scope it. Attribution is not a
   card added to the provider page.

## Data model and scan (`pkg/usagestats`)

- `Record` and `Bucket` gain `Session string`: the harness's own session id.
  - claude: second path segment under `~/.claude/projects/<slug>/`, minus `.jsonl`. This folds
    `<slug>/<id>/subagents/*.jsonl` into the parent session.
  - pi: the id after the last `_` of the second path segment under `~/.pi/agent/sessions/<slug>/`,
    so subagent sessions under the parent's stem dir fold into the parent.
  - codex: the rollout file's base name. opencode: the `storage/message/<sessionID>/` dir name.
- `bucket()` keys by harness, provider, model, day and session. `SumTranscript` and
  `TranscriptUsage` callers are unaffected (one transcript, one session).
- The per-file `parseCache` entry also keeps the session's cwd and title, read during the same
  parse: claude `cwd` and `aiTitle`, pi session header `cwd` and first user line, codex
  `session_meta.cwd`, opencode `storage/session` `directory` and `title`. Reuse the title reading
  the recent-sessions scan already has where one exists; do not write a second parser for it.
- `ScanUsage` returns the buckets and a `[]SessionMeta{Harness, Session, Cwd, Title}` for the
  sessions that have a bucket in the window.

## RPC (`GetUsageStatsCommand`)

`UsageBucket` gains `session` (omitempty). `CommandGetUsageStatsRtnData` gains
`sessions []UsageSession`:

```go
type UsageSession struct {
    Harness   string `json:"harness"`
    Session   string `json:"session"`
    Title     string `json:"title,omitempty"`
    Project   string `json:"project,omitempty"`   // repo root path
    RunId     string `json:"runid,omitempty"`     // the owning top-level run
    ChannelId string `json:"channelid,omitempty"`
    RunGoal   string `json:"rungoal,omitempty"`   // first line
    RunMode   string `json:"runmode,omitempty"`   // orchestrator | quick
    Role      string `json:"role,omitempty"`      // lead | worker | reviewer | a stage role
    TaskId    string `json:"taskid,omitempty"`
}
```

The handler fills the run fields from the store, for claude and pi sessions only:

- Load runs by session id, matching `sessionid` and `leadsessionids`. `wstore.GetRunsBySessionIds`
  matches only `sessionid` today; extend it rather than add a sibling.
- Resolve owner and role with the existing `runLinkOf` (`pkg/wshrpc/wshserver/sessionruns.go`): a DAG
  child reports its DAG's owning run.
- `Project` is the run's `ProjectPath` when linked, else the session cwd, with a trailing
  `/.worktrees/<x>` or `/.claude/worktrees/<x>` cut back to the repo root. A cwd that is a lane
  folder elsewhere stays as it is and lands under "other folders".

`task generate` after the type change. The existing dev fixture `wave:dev-usage-buckets` gains the
session field and a sessions list.

## Usage surface (`frontend/app/view/usage`)

The mockup is the spec for layout and copy: `.superpowers/design/usage-attribution/project/Main.dc.html`
(interactive, real data). No new design tokens; every color in it is an existing `@theme` token.

- Rail: "All usage" on top, then a switch **By provider | By work**.
  - By provider: today's rail and today's detail page, unchanged. No work list.
  - By work: project rows with share of spend. A project gets a row when it holds at least 1% of
    the window's estimated spend, eight at most; the rest fold into one line of text.
- Detail page in By work, for All usage, a project, a run or a session. Same components as today,
  re-scoped: header, four stat cards (with "x% of all usage" and "x% of all spend" on a narrower
  scope), Where it goes, Daily, model groups. No Live limits (quota is per provider).
  - Where it goes splits by the next level down instead of by token class: projects for All usage;
    orchestrator runs, quick runs and sessions no run started for a project; roles for a run. A
    single session keeps the token-class split.
  - One ranked list: "Spent on" for All usage, "Runs and sessions" for a project, "Sessions in this
    run" for a run, none for a session. Eight rows, "Show top 25" to expand. The run page's list has
    no role sentence above it: the split card already says it.
  - A row opens that run or session as the same page, with "Back to <scope>". A run page has "Open
    run", which goes through `openTarget` (`frontend/app/view/jarvis/openref.ts`). A session has no
    open button: `openTarget` has no session target, and that stays deferred.
- Rows rank by estimated spend, then tokens. Where a scope has no priced tokens and its source
  reports a cost (pi on an unpriced model), the row shows the reported cost, marked "reported".
- Logic goes in a pure `usageattribution.ts` beside `usagestats.ts` (work items from buckets and the
  session directory, scope aggregates, splits), consumed by `usagesurface.tsx`. Lens, selected scope
  and drilled item are jotai atoms in `usagestore.ts`, since the surface unmounts on switch.

## Run surfaces

`runusage.ts` gains a pure estimate over the existing `UsageRow`s using `priceFor`
(`usagepricing.ts`), and `usageText` appends it as "≈ $x", so the run rail, DAG header, peek and
cockpit pick it up from the one function. `runsheet.tsx` shows the same figure in place of the
live-workers-only `costusd` sum. Mockup: `RunCost.dc.html`. The per-role panel on that board is not
built; the Usage run page covers it.

## Tests

- Go, `pkg/usagestats`: summing the new buckets over sessions equals the buckets the old key
  produced (the invariant that totals do not move); session key per harness layout, subagent files
  included; a message present in two files is counted once.
- Go, `wshserver`: directory linking for a lead session id, a `leadsessionids` entry, a DAG worker
  and a reviewer (owner run and role), and an unlinked session; worktree cwd folds to its repo.
- Vitest, `usageattribution.test.ts`: work items group a run's sessions; project cutoff and fold;
  each scope's split; ranking with an unpriced, cost-reporting session; `runusage.test.ts`: the
  estimate and its text.
- CDP: `usage-charts` still passes on the provider tab; a new `usage-work` scenario seeds the
  fixture and shows By work for All usage, a project, and a run.

## Out of scope

Persisting usage; a chart brush for all time; session open targets; cost on anything other than the
surfaces named above; codex and opencode run linking (no run uses them).
