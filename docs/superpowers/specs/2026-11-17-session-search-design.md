# Session search

Brainstorm: `.superpowers/brainstorm/session-search/brainstorm.json` (2026-11-17). Mockup: canvas `session-search`,
board `A-icon-in-header.dc.html`.

## Intent

Port Kael's session search (the `kael` remote, `kaeltran16/waveterm`) to main, so a past conversation can be found by
what was said in it, and add a search button to the Project and Session columns of the New agent dialog.

## What Kael has

On `kael/main`:

- `pkg/agentsessions/digest.go`: a session's text digest, the prompts a person typed and the agent's text replies
  (tool calls, tool output, thinking and subagent turns left out), one `Turn{Speaker, Text, Ts}` each.
- `pkg/agentsessions/search.go`: `ParseQuery` (words, or a "quoted phrase"), `Query.Match` returning hits with a
  snippet of ±40 runes and the marked ranges (UTF-16 offsets), plus matches in the `asked` / `committed` / `errored`
  events.
- `pkg/agentsessions/index.go`: the 30-day index, held in RAM, built by a background warm-up; a synchronous call
  parses at most 100 files / 64 MB and answers `complete=false` past that.
- `SearchSessionsCommand` (`pkg/wshrpc/wshserver/sessionsearch.go`, types in `wshrpctypes_agents.go`:
  `CommandSearchSessionsData{Query, RunAgents, MaxHits}`, `SessionSearchResult`, `SessionHit`, `Incomplete`). Results
  are newest first; run workers, reviewers, judges and verifiers are left out unless `RunAgents`.
- Frontend: `sessionssearch.ts` / `sessionssearchstore.ts` (the search box over the Sessions list),
  `sessionsfind.ts` + `sessionsdetail.tsx` (open a hit at its place, the find bar).
- Commits: `d2db15190` (digest, matcher, index), `c8d514d79`, `a1eabfbc9`, `4836ccca2`, `15b2e4e21`.

## What main has today

- Conversation History (`frontend/app/view/agents/conversationhistory.tsx`) filters by status only.
- New agent dialog (`launchermodal.tsx`): the Project column has a filter (`filterProjects`, `FilterLine` in
  `launcherrows.tsx`), but it only shows when letters are typed while the dialog has no Task box, so it cannot be
  reached when launching an agent. The Session column (`launcherresumelist.tsx`) has no filter: a letter typed there
  goes to the Task box.
- `pkg/agentsessions` has diverged from Kael's (agy, `scanpage.go`, `canvassessions.go`), so Kael's index code is
  adapted, not cherry-picked. Main has a scan cache (`scanCache`, `agentsessions.go:1310`, at most 32,768 entries) and
  `PageOpts.Query` (`scanpage.go`), which already filters sessions by title on the backend.
- On the owner's machine, `~/.claude/projects` holds 2,350 transcripts modified in the last 30 days (subagents
  excluded), 4.8 GB. Kael measured parsing at ~25 ms/MB: about 2 minutes of CPU to read them all once.

## The design

### Search in the New agent dialog

- **A magnifier button in the Project and Session column headers** (board A). Clicking it, or `/` while that column
  has focus, replaces the column's header with a filter box; Esc closes it and brings the header back. Typing letters
  in a column still goes to the Task box, as today.
- **Project column:** the box drives the existing `filterProjects` filter.
- **Session column: titles at once, content after.** Typing filters the sessions by title at once; then the sessions
  that match by content (the ported search) are added below under a "Matched by content" label, each with its snippet,
  the matched words marked. New session stays the pinned first row. The header shows the counts ("1 title · 2
  content").
- The Session column searches only the picked agent's sessions in the picked project (see Left to the builder).
- Clicking a session row still picks it to resume; it does not open the transcript.

### Search in Conversation History

- A search box at the top of Conversation History searches every session of the last 30 days, across projects and
  agents, each result with its snippet. No palette command is added.
- Agent's call (builder question 3): Kael's uncapped 30-day list is not ported. While the box holds text, the paged
  list is replaced by the `SearchSessions` results, one row per session (a run's session shows its run's name; no run
  cards gathering a run's hits); the status filter Conversation History already applies still applies to the results
  (History has no project scope: it lists every project). Clearing the box brings the paged list back.
- **Opening a content hit lands on it.** Clicking a result opens the session scrolled to that hit, with the matched
  words marked, and a find bar with a count ("2 / 7"); Enter / Shift+Enter step to the next / previous match. Kael's
  `sessionsfind.ts` already counts matches the way the Go matcher does; port it.

### Where the index lives: Kael's digest, on disk

Port Kael's `digest.go`, `search.go` and warm-up path, but each transcript's digest is written to its own file in the
data dir, keyed by the transcript's path + mtime + size, and each search scans those digest files instead of holding
the digests in RAM. No resident index, no re-parse of 4.8 GB at every app start, and no `sqlite_fts5` build tag
(Taskfile.yml sets none).

Agent's call (builder question 2): a transcript's digest file holds, beside the turns, what search needs from the
session: its title, project, status, `asked` / `committed` / `errored` events and resume args, so a search after a
restart parses no transcript. The session lists (Conversation History, the Session column) still read through the scan
as today, not from the digest files.

### Runtimes without search

Only claude and pi sessions are searched (the runtimes Kael's `digest.go` covers). agy, codex and opencode have no
search for now: the Session column shows no magnifier when the agent is one of them, Conversation History does not
search their sessions, and no digest is written for them (builder question 1).

## Left to the builder

- `SearchSessions` takes a runtime and a project so the Session column searches only the picked agent's sessions in
  the picked project (main's `PageOpts` already has both filters).
- Run workers, reviewers and judges are hidden by default, as in Kael (`RunAgents=false`).
- A 30-day window, as in Kael; digest files of transcripts past 30 days or deleted are cleaned up.
- Where the digest files live in the data dir, and their format.
- The first digest build reads 4.8 GB: it runs in the background and results come back `incomplete` until it is done,
  as in Kael. Whether that background job queues through `pkg/jobqueue` is the builder's call.
- Measure the digest directory's size and wavesrv's RAM while searching, and log them under RAM watch in
  `docs/open-issues.md`.
- CDP scenarios: the magnifier and filter box in the Project and Session columns (board A), the search box and
  snippets in Conversation History, and the find bar when opening a result.

## Builder's decisions (2026-11-17, autonomous run)

Made by the run's lead with nobody at the cockpit; each with why.

### Backend

- **The digest store is `pkg/agentsessions/digeststore.go`, one JSON file per transcript under
  `<data dir>/sessiondigests/`, named by the hex SHA-1 of the transcript's path** (`.json`). The file holds a format
  version, the path, the mtime (ns) and size it was built from, the runtime, the session as the scan derives it (the
  `SessionInfo` fields and `sessionEvents` the provider's `fused` returns, `null` for a file that carries no session),
  and the turns. Why: a hashed name lets the prune decide from the directory listing alone which files belong to a
  transcript still in the window, without opening them; recording mtime + size inside the file keeps the freshness rule
  the scan cache already uses (transcripts only grow by append). A file for "no session" (subagent and tool-only
  transcripts, which dominate the candidate set) is kept too, so they are never re-parsed. A version bump rebuilds every
  file. Writes go through a temp file + rename so a sync build and the warm-up writing one digest never leave a torn
  file. Plain JSON, not gzip: measure first (below); gzip is the first lever if the directory is too big.
- **Building a digest reads the transcript once and unmarshals its lines once**: the session, its events and its turns
  come from the same parse (Kael's `claudeTurns` / `piTurns` over the provider's own parse), not a second pass.
- **A search walks the claude and pi providers' candidates in the 30-day window** (narrowed by runtime, and by project
  through the provider's `projectDir`, as `scanPageFrom` does), loads each fresh digest, and builds a missing or stale one
  inline within Kael's budget (100 files / 64 MB per call). Past the budget the call answers `incomplete: true` and
  starts the warm-up. Sessions under the temp dir are dropped, as the scan drops them.
- **The warm-up is one background goroutine, started by the first search that finds a missing digest**, not at wavesrv
  start: it builds every missing or stale digest of the window, newest first, one file at a time with a `Gosched`
  between files, then prunes the digest files whose transcript is no longer in the window (aged out or deleted).
  Idempotent while one runs. Why lazy: a person who never searches never pays the first 4.8 GB read. **It does not queue
  through `pkg/jobqueue`**: the queue admits shell commands by their RAM estimate, and this goroutine holds one
  transcript at a time (tens of MB at most), so it never needs admission; one core at low priority is its whole cost.
- **No resident index.** A search reads digest files on `parseWorkers` goroutines, matches each, and keeps only the
  results; nothing is held between searches. Measure before optimizing: if a whole-window search takes over ~2 s on the
  owner's corpus, the first lever is a raw-bytes prefilter of each file for the terms, logged as an open issue, not built
  here.
- **The RPC is `SearchSessionsCommand`** (`wshrpctypes_agents.go`):
  `CommandSearchSessionsData{Query, Runtime, ProjectPath, RunAgents, MaxHits, Limit}` →
  `CommandSearchSessionsRtnData{Results []SessionSearchResult, Terms []string, Incomplete, Truncated bool}`, a
  `SessionSearchResult{Session SessionActivity, Hits []SessionHit, TurnHits, EventHits int}`, a
  `SessionHit{Kind, Speaker string, Ord int, Text string, Marks [][]int}`. Results newest first, `Limit` default 200
  (`Truncated` when more matched): a common word over 30 days would otherwise send thousands of sessions with 20
  snippets each. The store returns every match (hits capped by `MaxHits`); the handler cuts at `Limit` only after it
  has linked runs and dropped run agents, so workers never fill the 200 and hide older sessions. `MaxHits` default 20. Run agents (workers, reviewers, judges, verifiers, plan reviewers, land resolvers;
  every role but `lead`) are dropped unless `RunAgents`, after `linkSessionsToRuns` fills their roles. `Terms` is the
  parsed query, so the frontend marks what the backend matched.
- **Runtimes**: a `Runtime` other than `claude` or `pi` answers no results and no error.

### New agent dialog

- **Title matches use the backend's terms**: a session matches by title when every term of the query (Kael's
  `findTerms`, the frontend twin of `ParseQuery`) is in its folded title. The title group shows at once over the sessions
  already loaded; when `SearchSessions` answers, its title-only results not already listed join the title group and the
  rest form "Matched by content". One pure function (`sessionsearch.ts`) splits them, with tests.
- **While a query is in the Session column's box, the older-page loading stops**: the content search reaches the whole
  30 days. Digits keep numbering rows across both groups (New session is 1).
- **Searching is debounced 250 ms and a stale answer is dropped** (a sequence number), in the Session column and in
  History alike. **An `incomplete` answer is asked again every 3 s while its box holds the same query**, so results fill
  in as the warm-up runs; the header hint says "indexing…" meanwhile.
- **Keys**: `/` in the Project or Session column opens its box; in the box, ↓ moves to the column's first row, Esc closes
  the box (clearing its filter) and puts focus back on the column, and Esc again closes the dialog as today. The Project
  column's old type-to-filter, for a pick with no Task box, stays.
- A content row shows its title and age on the first line (as a title row does) and its first hit's snippet, marks
  highlighted, on a second line. The open box has a close button (×) at its right, which does what Esc does (board A).
- An error from the search shows as one muted line under the box ("Search failed: …"); no match shows
  "No sessions match".

### Conversation History

- **History has no project scope today** (`conversationhistory.tsx` lists every project); the status filter is the
  only one the results honour. While the box holds text, the list shows the results as solo cards (a run's session
  titled by its run's name when its run is loaded), each with its first snippet; the "All activity" row and the
  recency groups give way to one "N results" header. Older pages stop loading while the box holds text. Clearing the
  box brings the paged list back unchanged. An error shows as one line in place of the results; no results shows
  "No conversations match".
- **Opening a result selects its session the way History selects one** (`sessionSelection`: a solo session's key, or a
  run's session's run and member); the detail shows that session even when the member's default session is another
  one (Kael's `foundSession`). Selecting anything else ends the find (Kael's `findEnded`). A result opened without a
  named hit opens at its first hit; a first hit that is an event opens the Activity view.
- **The opened session reads** its whole transcript instead
  of the 2,000-line tail (a hit can sit in the first turn), scrolled to the hit through `CompactTranscript`'s
  `scrollTo`, with the matches painted by the CSS Custom Highlight API (as `docfindbar.tsx` does) and a find bar
  ("2 / 7", Enter / Shift+Enter, Esc closes). An event hit opens the Activity view with that event outlined. The find
  state is one module-level atom in `sessionsfind.ts`; selecting another session ends it.
- **Match counting is done over the transcript entries' text, not the DOM**, with Kael's `findRanges`, so the count
  includes matches in items the transcript window has not drawn; stepping to one asks `CompactTranscript` to draw back
  to it before painting.

### Tests and scenarios

- Three CDP scenarios in their own files, registered in `scripts/cdp/scenarios.mjs`: `session-search-launcher`,
  `session-search-history`, `session-search-find`. They answer `searchsessions` (and the session lists and transcript
  they need) in-page through `RpcApi.setMockRpcClient`, as `installAhMock` does, so they never depend on the
  developer's transcripts; the Go matcher and store are proven by Go tests.
- The measured digest directory size, build rate, search time and wavesrv heap go to RAM watch in
  `docs/open-issues.md`, measured on the newest ~300 of the owner's transcripts and extrapolated by bytes, so a worker
  never runs the whole 4.8 GB read in working hours; the row says to re-measure after install.
