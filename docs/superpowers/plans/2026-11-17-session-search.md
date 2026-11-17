# Session search Implementation Plan

**Goal:** find a past claude or pi conversation by what was said in it: a magnifier filter box in the New agent dialog's
Project and Session columns, a search box in Conversation History, and a find bar that opens a result at its hit.

**Architecture:** Kael's digest and matcher (`kael/main`, commits `d2db15190`, `c8d514d79`, `a1eabfbc9`, `4836ccca2`,
`15b2e4e21`) are ported to `pkg/agentsessions`, but the digests live on disk, one JSON file per transcript under the
data dir, built lazily and by a background warm-up, and every search scans them; nothing stays in RAM. One wshrpc
command, `SearchSessions`, answers both the Session column (scoped by runtime and project) and History (every project).
The frontend shares one pure model (`sessionsfind.ts`, `sessionsearch.ts`) and one store; the dialog, History's list
and the find bar are built beside each other on it.

**Tech stack:** Go (`pkg/agentsessions`, `pkg/wshrpc`), React 19 + jotai + Tailwind 4, vitest, CDP scenarios.

**Spec:** `D:\projects\arcterm\docs\superpowers\specs\2026-11-17-session-search-design.md` (the main checkout; it is
not committed, so a worktree has no copy) — its "Builder's decisions" section holds every
call this plan relies on (file format, RPC shape, keys, debounce, what History shows); read it before your task.
**Verify:** `node scripts/verify.mjs ./pkg/agentsessions/... ./pkg/wshrpc/...`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs session-search-launcher session-search-history session-search-find launcher launcher-resume agent-history`

Working rules for every task: prefer simple, direct code (KISS, YAGNI, DRY, one source of truth); measure before
optimizing; no abstraction for a single implementation; handle errors at boundaries and never swallow one silently
(log it or return it). Colors come from `@theme` tokens only (`DESIGN.md`). Pure logic goes in a `foo.ts` with a
`foo.test.ts` beside it; no jsdom render tests. Never hand-edit generated files: change the Go types and run
`task generate`. Go tests on Windows need `CGO_ENABLED=1 CC="zig cc -target x86_64-windows-gnu"` (Bash). Kael's code is
read with `git show kael/main:<path>`; adapt it to main, never cherry-pick (main's `pkg/agentsessions` has diverged).

### Task 1: SearchSessions wire types and command
**Depends on:** none
**Model:** sonnet
**Files:** `pkg/wshrpc/wshrpctypes_agents.go`, `pkg/wshrpc/wshserver/sessionsearch.go`, `pkg/wshrpc/wshclient/wshclient.go`, `frontend/app/store/wshclientapi.ts`, `frontend/types/gotypes.d.ts`

Land the interface the other tasks build on, small and first.

Built once already by the cancelled run b0f9b964, reviewed and passed: commit `c3cddb795` on branch
`wave/b0f9b964-27ba-474c-9185-97370a6a6af1` (same repo). Start with `git cherry-pick c3cddb795`. On a conflict in a
generated file, take your tree's side of that file and rerun `task generate`, never hand-merge it. Then check the
acceptance below against today's code and fix what main changed since; the rest of this task is what that commit did.

- In `wshrpctypes_agents.go`, declare `SearchSessionsCommand(ctx, CommandSearchSessionsData) (*CommandSearchSessionsRtnData, error)`
  beside `GetSessionsActivityCommand`, and the types exactly as the spec's "Builder's decisions → Backend" names them:
  `CommandSearchSessionsData{Query, Runtime, ProjectPath string; RunAgents bool; MaxHits, Limit int}` (json
  `query`, `runtime,omitempty`, `projectpath,omitempty`, `runagents,omitempty`, `maxhits,omitempty`, `limit,omitempty`),
  `CommandSearchSessionsRtnData{Results []SessionSearchResult; Terms []string; Incomplete, Truncated bool}` (json
  `results`, `terms`, `incomplete,omitempty`, `truncated,omitempty`), `SessionSearchResult{Session SessionActivity;
  Hits []SessionHit; TurnHits, EventHits int}` (json `session`, `hits`, `turnhits`, `eventhits`), `SessionHit{Kind,
  Speaker string; Ord int; Text string; Marks [][]int}` (json `kind`, `speaker`, `ord`, `text`, `marks`), each field
  with a one-line comment (Marks are UTF-16 `[start, end)` offsets into Text; Kind is `turn` | `event`; Speaker is
  `user` | `agent` for a turn, the event's type for an event; Ord is the hit's position among the session's turn hits,
  or its index in `Session.Events`).
- Create `pkg/wshrpc/wshserver/sessionsearch.go` with `SearchSessionsCommand` on `*WshServer` returning
  `&wshrpc.CommandSearchSessionsRtnData{Results: []wshrpc.SessionSearchResult{}, Terms: []string{}}` and a comment that
  Task 3 fills it in, so the server builds.
- Run `task generate`; commit the regenerated files.

Acceptance: `go build ./pkg/wshrpc/...` passes; `frontend/types/gotypes.d.ts` has `SessionSearchResult` and `SessionHit`;
`RpcApi.SearchSessionsCommand` exists in `wshclientapi.ts` with command name `searchsessions`; `task check:ts` passes.

### Task 2: Digest turns and the query matcher
**Depends on:** none
**Model:** sonnet
**Files:** `pkg/agentsessions/digest.go`, `pkg/agentsessions/digest_test.go`, `pkg/agentsessions/search.go`, `pkg/agentsessions/search_test.go`, `pkg/agentsessions/humanprompts.go`, `pkg/agentsessions/lastanswer.go`, `pkg/agentsessions/tailmessages.go`, `pkg/agentsessions/agentsessions.go`

Port Kael's `digest.go`, `search.go` and their tests (`git show d2db15190`), adapted to main.

Built once already by the cancelled run b0f9b964, reviewed and passed: commit `639589b94` on branch
`wave/b0f9b964-27ba-474c-9185-97370a6a6af1` (same repo). Start with `git cherry-pick 639589b94` (this is the earlier
port of this very task, not Kael's code, so the no-cherry-pick rule above does not apply to it), resolve any conflict
against today's main, and run the tests. Its reviewer noted that `Match`'s doc comment wrongly says Ord counts "among
the turns that hold a hit": Ord goes up once per merged hit range across all turns, as the code does; fix the comment.
The rest of this task is what that commit did.

- `digest.go`: `Turn{Speaker, Text string; Ts int64}` (with json tags `speaker`, `text`, `ts`: Task 3 writes turns to
  disk), `claudeTurns(recs []claudeLine) []Turn`, `piTurns(*pisession.File) []Turn`. Prompts follow `HumanPrompts`'
  rules, replies `LastAnswer`'s: refactor `humanprompts.go` and `lastanswer.go` the way Kael's commit does, so one
  `claudeTypedText`, `claudeReplyText`, `piTypedText`, `piReplyText` serve both the existing functions and the digest
  (one source of truth). Main's `claudeTypedText` takes `claudePromptLine` and `tailmessages.go` uses it: either make
  `claudeLine` carry the fields `claudePromptLine` has (`IsCompactSummary`, `Attachment`) and drop `claudePromptLine`,
  or keep both callers compiling some other way; `HumanPrompts`, `LastAnswer` and `TailMessages` must answer exactly
  as before.
- `search.go`: Kael's `ParseQuery`, `Query`, `Hit`, `fold`, `snippet`, `ranges`, unchanged in behaviour. `Match` takes
  what Task 3 stores instead of Kael's `IndexedSession`: `func (q Query) Match(title string, turns []Turn, events
  []SessionEvent, maxHits int) (ok bool, hits []Hit, turnHits, eventHits int)`. This signature is the interface Task 3
  calls.
- Tests: Kael's `digest_test.go` and `search_test.go` cases (quoted phrases, unmatched quote, case folding with a
  rune that changes length, snippet ellipses and UTF-16 marks for an emoji, overlapping ranges merged and touching ones
  kept apart, every term required, events other than asked/committed/errored ignored, maxHits caps hits but not
  counts), adapted to the new `Match` signature; plus a claude transcript fixture whose digest leaves out tool calls,
  tool output, thinking and sidechain turns, and a pi one read off the active branch only.

Name the new tests `TestTurns*`, `TestParseQuery*`, `TestMatch*`, `TestSnippet*` and `TestFold*`.

Acceptance: `go test ./pkg/agentsessions -run 'TestTurns|TestParseQuery|TestMatch|TestSnippet|TestFold|HumanPrompts|LastAnswer|TailMessages'`
passes and runs the new tests (`-v` lists them), the last three groups unchanged.

### Task 3: On-disk digest store and the SearchSessions handler
**Depends on:** Task 1, Task 2 (uses `Turn`, `claudeTurns` / `piTurns`, `ParseQuery` and `Query.Match`)
**Model:** sonnet
**Files:** `pkg/agentsessions/digeststore.go`, `pkg/agentsessions/digeststore_test.go`, `pkg/agentsessions/agentsessions.go`, `pkg/wshrpc/wshserver/sessionsearch.go`, `pkg/wshrpc/wshserver/sessionsearch_test.go`, `docs/open-issues.md`

Build the store and the handler exactly as the spec's "Builder's decisions → Backend" says; the points that bind:

- `digeststore.go`: the digest directory is a package var defaulting to `filepath.Join(wavebase.GetWaveDataDir(),
  "sessiondigests")` so tests point it at `t.TempDir()`. One file per transcript, named `hex(sha1(path)).json`, holding
  `{v, path, mtime (ns), size, runtime, session (null when none), turns}`; `session` carries the `SessionInfo` and
  `sessionEvents` (events, status, startedTs, durationMs) the provider's `fused` derives. Fresh means same `v`, mtime
  and size. Writes go to a temp file in the same directory and are renamed over. A transcript is read once and its
  lines unmarshalled once for session, events and turns (add a per-provider turns hook or a fused variant; do not parse
  twice). A read error (`sessionEvents.readErr`, or a failed `readLines`) writes no digest, as the scan cache does not
  cache one.
- `SearchDigests(opts DigestSearch) (results []DigestResult, incomplete bool)` (the names are yours; this
  is the one entry point the handler calls): walk only the claude providers (including `claudeArchiveProvider`) and pi
  in the 30-day window, narrowed by `Runtime` and, for `ProjectPath`, through `projectDir` as `scanPageFrom` does; load
  each fresh digest or build a stale or missing one inline within a budget of 100 files / 64 MB per call (vars so tests
  shrink them); past the budget skip it, answer `incomplete` and call `StartDigestWarmup()`. Drop sessions under the
  temp dir and, for `ProjectPath`, sessions whose `normProjectPath` differs. Match with Task 2's `Query.Match`, read
  files on `parseWorkers` goroutines, return newest first (`asSession`'s rules for `LastActiveTs`, `ResumeCommand`,
  `withoutRecentFinish`). It returns every match (hits per session capped by `MaxHits`); it applies no `Limit`, since
  run roles are only known after the handler links runs.
- `StartDigestWarmup()`: one goroutine, idempotent while running (`atomic.Bool`), wrapped in `panichandler`; builds every
  missing or stale digest of the window newest first, one file at a time, `runtime.Gosched()` between files; then
  deletes digest files whose name is not the hash of a window candidate; logs one line with the count and the time.
  Not queued through `pkg/jobqueue` (spec).
- `sessionsearch.go` handler: empty query or a runtime other than claude/pi → empty results, no error; else
  `ParseQuery`, `SearchDigests`, convert to wire (reuse `sessionActivityToWire`; hits as Kael's `hitsToWire`; never a
  nil slice on the wire), `linkSessionsToRuns` (an error is logged and results stay unlinked), drop every result whose
  `Role` is set and is not `lead` unless `RunAgents`, sort newest first, and only then cut at `Limit`, setting
  `Truncated` when more were left. `MaxHits` default 20, `Limit` default 200.
- Tests (`digeststore_test.go`, with fixture transcripts written under temp provider roots the way existing scan tests
  build them): a digest is written once and reused (a `readLines` counter stays put on the second search); an appended
  transcript is rebuilt; a file with no session gets a digest and is not re-read; a corrupt or old-version digest file
  is rebuilt; the budget makes a call `incomplete` and the warm-up then completes it; the prune removes the digest of a
  deleted transcript and of one past the window; runtime and project scoping; a temp-dir session is dropped.
  `sessionsearch_test.go`: run agents dropped unless `RunAgents` (stub the link step as Kael's test does), newest first,
  `Limit` and `Truncated`, `Limit` counted after the drop (with `Limit` 2 and three newer worker sessions, the two
  newest non-worker sessions come back), an unsupported runtime answers empty. Name the tests `TestDigest*` and
  `TestSearchSessions*`.
- Measure (spec): with a small throwaway program or a test skipped unless `ARC_DIGEST_MEASURE=1`, build digests for the
  newest ~300 of the owner's `~/.claude/projects` transcripts into a temp dir (never the real data dir), and record the
  bytes read, the digest bytes written, the build time, one whole-window search time and the peak heap
  (`runtime.ReadMemStats`); extrapolate to the 2,350 transcripts / 4.8 GB. Add one row under "## 5 · (arcterm) RAM
  watch" in `docs/open-issues.md` with those numbers, the method, and "re-measure the full build after install". If a
  search over the extrapolated corpus would pass ~2 s, add the raw-bytes prefilter as an open issue there, not code.

Acceptance: `go test -v ./pkg/agentsessions -run 'TestDigest'` and `go test -v ./pkg/wshrpc/wshserver -run 'TestSearchSessions'`
pass and list the new tests; the RAM watch row exists with measured numbers.

### Task 4: Shared search model, store, snippet and scenario files
**Depends on:** Task 1 (uses the generated `SessionSearchResult`, `SessionHit` and `RpcApi.SearchSessionsCommand`)
**Model:** sonnet
**Files:** `frontend/app/view/agents/sessionsfind.ts`, `frontend/app/view/agents/sessionsfind.test.ts`, `frontend/app/view/agents/sessionsearch.ts`, `frontend/app/view/agents/sessionsearch.test.ts`, `frontend/app/view/agents/sessionsearchstore.ts`, `frontend/app/view/agents/searchsnippet.tsx`, `scripts/cdp/scenarios-session-search-launcher.mjs`, `scripts/cdp/scenarios-session-search-history.mjs`, `scripts/cdp/scenarios-session-search-find.mjs`, `scripts/cdp/scenarios.mjs`

The pieces Tasks 5, 6 and 7 share; each of them imports these and none redefines them.

- `sessionsfind.ts` (port of Kael's, `git show kael/main:frontend/app/view/agents/sessionsfind.ts` and its test):
  `findTerms`, `findRanges`, `stepFind`, and the find state: `export interface SessionFind { sessionKey: string; query:
  string; terms: string[]; target: { kind: "turn" | "event"; ord: number }; at: { sel: string; member?: string } }`,
  `export const sessionFindAtom = atom<SessionFind | null>(null)` (module-level, spec), and
  `openSessionHit(model: AgentsViewModel, r: SessionSearchResult, query: string, terms: string[], hit?: SessionHit):
  void`. The hit defaults to `r.hits[0]`, and with no hits at all the target is `{ kind: "turn", ord: 0 }`. It selects
  the session the way History does, with `sessionSelection(r.session)` (`sessionsruns.ts`): `model.sessionsSelAtom` to
  its `sel` and, for a run's session, `model.sessionsMemberAtom` to its `member`; sets `model.sessionsViewAtom` to
  `"activity"` when the target is an event, `"transcript"` otherwise; and sets `sessionFindAtom` with `at` = that
  selection. Port Kael's `foundSession(find, sel, member, sessions)` (the found session while the selection still
  shows its run member, so a member whose default session is another one shows the found one) and
  `findEnded(find, sel, member)` (selecting anything else ends the find; "all" does not), with Kael's tests. Pull the
  selection logic into a pure `hitSelection(r, hit?)` returning `{ sel, member?, view, target }` and test it: a
  turn first hit, an event first hit (opens activity), no hits, an explicit hit, a solo session and a run worker's
  session (member set).
- `sessionsearch.ts` (pure): `titleMatches(title: string, terms: string[]): boolean` (every term in the folded title,
  folded as `findRanges` folds); `splitSessionResults(loaded: SessionInfo[], results: SessionSearchResult[] | null,
  terms: string[]): { title: SessionInfo[]; content: { session: SessionInfo; result: SessionSearchResult }[] }` per
  the spec's New agent dialog rule (loaded title matches first, then title-only results not already listed, and the
  rest under content, no session twice); `sessionInfoOf(a: SessionActivity): SessionInfo`; `snippetParts(text: string,
  marks: number[][]): { text: string; mark: boolean }[]` (marks are UTF-16 offsets, so plain string slicing); and
  `searchHint(titleCount, contentCount, incomplete)` → `"1 title · 2 content"`, with `" · indexing…"` while incomplete.
  Tests for each, including a mark at the string's start and end and an emoji before a mark.
- `sessionsearchstore.ts`: `useSessionSearch(query: string, scope: { runtime?: string; projectPath?: string }):
  { results: SessionSearchResult[] | null; terms: string[]; incomplete: boolean; truncated: boolean; error: string | null }`
  — debounced 250 ms, a stale answer dropped by a sequence number, asked again every 3 s while `incomplete` and the
  query is unchanged, nothing asked for an empty query (results `null`). An RPC error is kept in `error`, not swallowed.
  Put the debounce/sequence/re-ask decision in a small pure function in `sessionsearch.ts` if it needs a test.
- Every scenario in Tasks 5–7 mocks the search's states in-page, so the mock answers are the scenario's to choose:
  `incomplete: true`, no results, `truncated: true`, and a rejected call (an error) are all one mock answer away.
- `searchsnippet.tsx`: `SearchSnippet({ hit }: { hit: SessionHit })`, one truncated line with the marked parts drawn as
  `<mark data-search-mark>` in token colors (a subtle accent background, `text-primary`), the rest muted.
- Scenario files: create the three `scripts/cdp/scenarios-session-search-*.mjs`, each a default export `(kits) => []`
  with a header comment naming the scenario it will hold (`session-search-launcher`, `session-search-history`,
  `session-search-find`), and register all three in `scripts/cdp/scenarios.mjs` as `scenarios-usage-lens.mjs` is
  (import + spread into the list). Tasks 5, 6 and 7 fill one each.

Acceptance: `npx vitest run frontend/app/view/agents/sessionsfind.test.ts frontend/app/view/agents/sessionsearch.test.ts`
passes; `task check:ts` passes; the scenario list still loads with the three files in it:
`node --input-type=module -e "const m=await import('./scripts/cdp/scenarios.mjs'); console.log(m.SCENARIOS.length)"`
prints a number and no error.

### Task 5: Search in the New agent dialog's Project and Session columns
**Depends on:** Task 4 (uses `useSessionSearch`, `splitSessionResults`, `searchHint`, `SearchSnippet`, `findTerms` and the launcher scenario file)
**Model:** sonnet
**Files:** `frontend/app/view/agents/launcher.ts`, `frontend/app/view/agents/launcher.test.ts`, `frontend/app/view/agents/launcherresume.ts`, `frontend/app/view/agents/launcherresume.test.ts`, `frontend/app/view/agents/launcherrows.tsx`, `frontend/app/view/agents/launcherresumelist.tsx`, `frontend/app/view/agents/launchermodal.tsx`, `scripts/cdp/scenarios-session-search-launcher.mjs`, `docs/keyboard-shortcuts.md`, `CHANGELOG.md`

Board A of the canvas (`D:\projects\arcterm\.superpowers\design\session-search\project\A-icon-in-header.dc.html`;
its labels are Vietnamese, the app's are English: "Search projects", "Search sessions", "Matched by content").

- `ColumnLabel` (`launcherrows.tsx`) takes an optional `search` prop (optional, so its other callers,
  `launcherrunfields.tsx`, `launchertoolfields.tsx` and `launcherwhenrow.tsx`, stay untouched): a magnifier button (`data-launcher-search-open=<column>`,
  aria-label "Search") at the header's right; open, the header is replaced by a box (`data-launcher-search=<column>`,
  an `<input>` with the existing `FilterLine` look, the count hint, and a close button `×`
  (`data-launcher-search-close`) at its right, as board A has). Esc in the box, or the ×, closes it, clears its
  filter and focuses the column; ↓ focuses the column's first row.
- Project column: the box drives the existing `filter` / `applyFilter` / `filterProjects`. The column's `onBlur` must
  not clear the filter while focus moves into its own box. The old type-to-filter for a pick with no Task box stays.
- Session column (`launcherresumelist.tsx`): the magnifier shows only for runtimes `claude` and `pi`. With a query:
  New session stays row 1; then the title group, then a "Matched by content" label (`data-resume-content-label`) and
  the content rows (`data-resume-content-id`), each with its title and age on the first line (as board A and the
  title rows have) and a `SearchSnippet` line under it; digits number across both groups; the header hint is
  `searchHint(...)`; older-page loading stops. A search error shows one muted line `data-resume-search-error`
  ("Search failed: …"); a query nothing matches shows `data-resume-search-empty` ("No sessions match"). `useSessionSearch(query, { runtime,
  projectPath })`. Clicking or picking a content row picks it to resume exactly as a title row does: make sure the
  modal's `resume` lookup finds a session that came only from the search (convert with `sessionInfoOf`).
- Keys: `/` in the Project or Session column opens its box (`launcherKey` in `launcher.ts` and `resumeListKey` in
  `launcherresume.ts`, with tests); letters typed in a column still go to the Task box; Esc order as the spec says.
- `docs/keyboard-shortcuts.md` (The New dialog section): `/`, Esc and ↓ for the column search; and in Conversation
  History's find bar, Enter / Shift+Enter for next / previous match and Esc to close (Task 7 builds those keys).
- `CHANGELOG.md` `Unreleased` → `Added`: one line for searching projects and sessions in the New dialog, one for
  searching Conversation History by what was said and opening a result at its match (`<!-- big -->` on the History
  line only).
- Scenario `session-search-launcher` (in its file; mock `searchsessions` and `getrecentsessions` in-page through
  `RpcApi.setMockRpcClient` as `installAhMock` in `scenarios.mjs` does; register a temp project as `launcher-resume`
  does; restore everything in teardown). Steps, each with a screenshot: (1) the Project column header shows the
  magnifier; (2) clicking it shows the box in place of the header, typing narrows the projects and the count reads
  "N of M"; (3) Esc brings the header back with the full list; (4) in the Session column with a claude agent, `/` opens
  the box; typing a query shows the title row at once, then "Matched by content" with two rows whose snippets hold a
  `[data-search-mark]`, each content row with its age, and the hint reads "1 title · 2 content"; (5) clicking a content
  row picks it (its row is `aria-checked`); (6) with the mock answering `incomplete: true` the hint ends
  "indexing…"; (7) a query the mock answers with no results shows "No sessions match"; (8) a rejected search shows
  the "Search failed" line; (9) the box's × closes it and the header is back; (10) with Codex picked the Session
  column shows no magnifier.

Acceptance: `npx vitest run frontend/app/view/agents/launcher.test.ts frontend/app/view/agents/launcherresume.test.ts`
passes; `task check:ts` passes; `ARC_FINAL_OUT=<a temp dir> node scripts/cdp/final-verify.mjs session-search-launcher launcher launcher-resume`
passes (it starts its own dev app on its own ports and store, so workers running at once never share one; never
`task verify:ui` against a shared :9222).

### Task 6: Search box and results in Conversation History
**Depends on:** Task 4 (uses `useSessionSearch`, `openSessionHit`, `sessionInfoOf`, `SearchSnippet` and the history scenario file)
**Model:** sonnet
**Files:** `frontend/app/view/agents/conversationhistory.tsx`, `scripts/cdp/scenarios-session-search-history.mjs`

- A search box (`data-history-search`, placeholder "Search conversations") under the title row, above the status
  filter. `useSessionSearch(query, {})`. While it holds text the list shows the results as solo cards
  (`data-history-result=<sessionKey>`), one per session, each with its first hit's `SearchSnippet` (a run's session
  shows its run's name when the run is loaded through `useRunObjects`), filtered by the status filter as `keepRow`
  filters solo rows; one "N results" header (with "· indexing…" while incomplete and "newest 200" when truncated) in
  place of "All activity" and the recency groups. Clearing the box (or Esc in it) brings the paged list back
  unchanged, cursor and loaded pages kept. While the box holds text, `loadIfAtEnd` loads no older page (a short
  results list fills no scroll and would otherwise page through the archive). An error shows one line
  `data-history-search-error` ("Search failed: …"); no results shows `data-history-search-empty`
  ("No conversations match").
- Clicking a result calls `openSessionHit(model, result, query, terms)`, which selects it as History does (a run's
  session selects its run and member). The detail must show that session even when it is not among the loaded
  pages: the sessions History groups and resolves against (`live`, `groupRunSessions`, `resolveSelectedSession`) are
  the loaded ones plus the results' sessions not already loaded (live overlay applied to both), and `useRunObjects`
  is given the results' run ids too. The `j`/`k` list nav walks the results while searching.
- Scenario `session-search-history` (mock `searchsessions` and `getsessionsactivity` in-page as `installAhMock` does):
  (1) History shows the search box; (2) typing a query shows "N results" and cards with marked snippets, one of them a
  session older than the loaded page; (3) the status filter narrows the results; (4) a mock answer with
  `incomplete: true` shows "· indexing…" and one with `truncated: true` shows "newest 200"; (5) no results shows
  "No conversations match" and a rejected call shows "Search failed"; (6) clearing the box brings back the paged list
  with "All activity"; (7) clicking a solo result selects it and the right pane shows that session's header; (8)
  clicking a run worker's result shows the run's detail with that member selected.

Acceptance: `task check:ts` passes; `ARC_FINAL_OUT=<a temp dir> node scripts/cdp/final-verify.mjs session-search-history agent-history`
passes (its own dev app; never `task verify:ui` against a shared :9222).

### Task 7: Open a result at its hit, with a find bar
**Depends on:** Task 4 (uses `sessionFindAtom`, `findRanges`, `findTerms`, `stepFind` and the find scenario file)
**Model:** sonnet
**Files:** `frontend/app/view/agents/sessionsdetail.tsx`, `frontend/app/view/agents/sessionfindbar.tsx`, `frontend/app/view/agents/transcriptread.ts`, `frontend/app/view/agents/transcriptread.test.ts`, `frontend/app/view/agents/compacttranscript.tsx`, `frontend/tailwindsetup.css`, `scripts/cdp/scenarios-session-search-find.mjs`

Kael's `15b2e4e21` (`git show 15b2e4e21 -- frontend/app/view/agents/sessionsdetail.tsx`) is the reference, but main's
`SessionBody` renders `CompactTranscript` over `useTranscriptRead`, not Kael's `NarrationTimeline`: adapt.

- `useTranscriptRead(path, runtime, live, full?: boolean)`: `full` reads the whole file (`maxlines: -1`) instead of the
  tail (`transcriptAsk` takes it; test it). The optional parameter leaves `sleepingtranscript.tsx` untouched. A change
  of `full` resets the reader as a change of path does (drops the held window and reads afresh): a session open on
  its tail that a find then targets must not keep the tail window and only append to it. Test that `full` flipping
  asks for the whole file.
- `SessionBody` (`sessionsdetail.tsx`): when `sessionFindAtom` names this session, read it `full`, show the find bar
  (`sessionfindbar.tsx`, `data-session-find`: the query, editable to refine with `findTerms`; "2 / 7" in
  `data-find-pos`, "No matches" at 0; previous / next buttons; Enter / Shift+Enter step, Esc closes and clears the
  atom). Count matches over the projected entries' prompt and reply text with `findRanges`, start at the hit's `ord`,
  jump to the current match's entry through `CompactTranscript`'s `scrollTo` (which draws back a window that does not
  hold it), then paint the drawn matches with the CSS Custom Highlight API under `session-find` /
  `session-find-current` (new `::highlight` rules in `tailwindsetup.css` matching `doc-find`'s look) and centre the
  current one. Add to `CompactTranscript` only what it lacks for this (for example a data attribute on the element
  holding a prompt's or reply's text). A re-read of a live session must not snap the reader back to the match unless
  the match changed (Kael's `needsCentre` rule). `RunDetail` shows `foundSession(...)` in place of the member's
  default session while the find holds; `SoloDetail` and `RunDetail` clear `sessionFindAtom` when `findEnded(...)`
  says the selection moved on.
- An event hit opens the Activity view with that event outlined (`aria-current`) and scrolled into view.
- Scenario `session-search-find` (mock `getsessionsactivity` and `getagenttranscript` in-page; the transcript has the
  match in its first turn and further ones later, more lines than the tail). It does not use History's search box
  (Task 6 builds that beside this task): it opens History, then opens a hit in-page by importing `sessionsfind.ts`
  and the agents model the way `ahResolveModules` reaches app modules, and calling `openSessionHit` with a mocked
  `SessionSearchResult` (a turn hit; for step 7 an event hit). Steps: (1) the opened result shows the find bar
  reading "1 / N" and the first turn's match painted and in view; (2) Enter moves to "2 / N" and the view moves; (3)
  Shift+Enter goes back; (4) refining the query changes the count; (5) a query with no match in the transcript reads
  "No matches"; (6) Esc closes the bar and the transcript stays; (7) an event hit opens Activity with the event
  outlined.

Acceptance: `npx vitest run frontend/app/view/agents/transcriptread.test.ts` passes; `task check:ts` passes;
`ARC_FINAL_OUT=<a temp dir> node scripts/cdp/final-verify.mjs session-search-find` passes (its own dev app; never
`task verify:ui` against a shared :9222).
