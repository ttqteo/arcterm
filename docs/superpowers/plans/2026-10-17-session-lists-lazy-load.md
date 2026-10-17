# Session Lists Lazy Load Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The New dialog's Resume list and Conversation History reach every session still on disk by loading older pages as you scroll, instead of stopping at the newest 50 or 100, and Claude Code keeps transcripts 90 days instead of 30.

**Architecture:** The backend session scan (`pkg/agentsessions`) gains one paged entry point: newest first, an opaque cursor naming the last transcript a page read, and optional runtime, project and title filters applied before the limit counts. The two session RPCs carry the cursor and filters through. The Resume list asks for one project and runtime at a time and searches the backend as you type; History appends pages and keeps them across refreshes. `wsh install-agent-hooks` writes `cleanupPeriodDays: 90` into `~/.claude/settings.json` when the person has not set it.

**Tech Stack:** Go (agentsessions, wshrpc, wsh), React 19 + jotai + Tailwind 4, vitest, CDP scenario harness.

**Spec:** This file's Design section, agreed in chat on 2026-10-17; the decisions and measurements are the note trail of effort cd1ec402-930e-4f3f-b871-f0e0563365d8.

**Verify:** `node scripts/verify.mjs ./pkg/agentsessions ./pkg/wshrpc/... ./cmd/wsh/...`

**Final:** `node scripts/cdp/final-verify.mjs launcher-resume launcher-resume-older history-older`

## Design

Measured on the Mac on 2026-10-17: ~40 interactive Claude sessions a day, so the Resume list (14 days, limit 50, filtered to one project in the browser) reached ~40 h back and History (30 days, limit 100) ~3 days. Claude Code's `cleanupPeriodDays` (default 30) deletes older transcripts, so nothing before 2026-09-17 is on disk.

Scan cost, `agentsessions.ScanSessions` from a scratch program: the stat-only walk over all 1507 transcript files 84 ms cold / 16 ms warm; a page of 50 parses in 210–290 ms cold, 15 ms warm; all 587 sessions in 1.33 s cold, 15 ms warm. The parse cache held ~1.2 MB for 1500 files.

Decisions:
1. **Lazy loading, not a bigger cap.** Each list loads one page, then the next when its scroll reaches the end. No day window: a page walks every transcript on disk.
2. **The Resume list filters on the server**, by the picked runtime and project, so a page is that project's own sessions. Engine workers run in worktree folders, never in the project folder, so they drop out of the Resume list by this filter alone.
3. **Search reaches the whole store.** Typing in the Resume list asks the backend for sessions of that project whose title contains the text, beside the instant filter over the rows already loaded. History has no search box and gets none.
4. **The palette lists no engine worker, reviewer or stage sessions**: only sessions with no run role, or the lead.
5. **`cleanupPeriodDays: 90`** (~4.5 GB at today's rate), written only when the settings have no `cleanupPeriodDays` of their own.
6. **The parse cache cap goes from 4096 to 32768 entries**: ~4500 files at 90 days would overflow 4096, and a full cache clears itself, so every scan would go cold.

## Global Constraints

- Resume list page: 30 sessions. History page: 100 sessions.
- A list loads its next page when its scroll is within 120 px of the bottom, one request in flight at a time, and stops when the answer's cursor is `""`.
- While a page is in flight the list shows a last row reading exactly `Loading older sessions…`, muted.
- `cleanupPeriodDays` value: `90`. A value the person set (any number, including 0) is kept.
- `scanCacheMax`: `32768`.
- Generated files (`frontend/types/gotypes.d.ts` and the rest `task generate` writes) are never hand-edited: change the Go type, run `task generate`.
- Colors come from the `@theme` tokens; follow `DESIGN.md`.

## Review Focus

1. Switching the Resume list's project or runtime while a page is in flight: the old project's answer must not land in the new list. (Task 3, store test.)
2. An agent exits while History has three pages loaded: the refresh keeps the older pages, lists no session twice, and the session that just ended moves to the top. (Task 4, `mergeFreshPage` test.)
3. Two transcripts with the same mtime on either side of a page boundary: each listed exactly once. (Task 1, Go test.)
4. Deleting a session that came in on page 3: its row goes, though the reload only re-reads page 1. (Task 4, `dropFromArchive` test.)
5. Scrolling fast, or a project with no sessions: one request at a time, and an empty last page with cursor `""` ends the loading for good, never a loop. (Tasks 3 and 4, store tests.)

---

### Task 1: Paged session scan and RPC

**Depends on:** none
**Files:** `pkg/agentsessions/agentsessions.go`, `pkg/agentsessions/scanpage.go`, `pkg/agentsessions/scanpage_test.go`, `pkg/wshrpc/wshrpctypes_agents.go`, `pkg/wshrpc/wshserver/wshserver_agents.go`, `frontend/types/gotypes.d.ts`

**Interfaces:**
- Produces (Go, `pkg/agentsessions/scanpage.go`):
  ```go
  type PageOpts struct {
      WindowDays  int    // 0 = every transcript on disk
      Limit       int    // sessions per page; <= 0 = no limit
      Cursor      string // Page.Next of the page before; "" = start at the newest
      Runtime     string // "" = every runtime; else only that provider's candidates are walked
      ProjectPath string // "" = every project; else normProjectPath(s.ProjectPath) == normProjectPath(ProjectPath)
      Query       string // "" = no filter; else strings.Contains(lower(s.Task), lower(trimmed Query))
  }
  type Page struct {
      Sessions []SessionInfo
      Next     string // cursor of the last candidate read; "" when no candidate is left past this page
  }
  func ScanPage(opts PageOpts) (Page, error) // error only for a malformed Cursor
  ```
- Produces (RPC, `pkg/wshrpc/wshrpctypes_agents.go`):
  - `CommandGetRecentSessionsData` adds `Cursor string \`json:"cursor,omitempty"\``, `Runtime string \`json:"runtime,omitempty"\``, `ProjectPath string \`json:"projectpath,omitempty"\``, `Query string \`json:"query,omitempty"\``.
  - `CommandGetSessionsActivityData` adds `Cursor string \`json:"cursor,omitempty"\``.
  - Both RtnData types add `NextCursor string \`json:"nextcursor,omitempty"\``.
  - `windowdays` 0 (or omitted) now means every transcript on disk for both commands. `recentsessionsstore.ts` passes 14 and keeps its behavior.

- [ ] **Step 1: Write the failing tests** in `pkg/agentsessions/scanpage_test.go`, building transcripts under `t.TempDir()` with `claudeProvider(root)` as `agentsessions_test.go:678` does, and setting mtimes with `os.Chtimes`. They call an internal `scanPageFrom(providers []provider, opts PageOpts, tempDir string) (Page, error)`.
  - `TestScanPage_pagesNewestFirstWithoutGapsOrRepeats`: 7 sessions, mtimes 1 minute apart, `Limit: 3`. Pages read by following `Next` hold 3, 3, 1 sessions; together they are the 7 ids newest first, each once; the last page's `Next == ""`.
  - `TestScanPage_sameMtimeAcrossABoundary`: 4 sessions, two sharing one mtime, `Limit: 1`. Following `Next` lists all 4 ids, each once.
  - `TestScanPage_filtersBeforeTheLimitCounts`: 6 sessions, 2 with cwd `/p/a`, 4 with cwd `/p/b`, newest is `/p/b`. `ProjectPath: "/p/a/", Limit: 2` returns both `/p/a` sessions and `Next == ""`.
  - `TestScanPage_queryMatchesTheTitleCaseInsensitively`: tasks `"Fix the Resume list"` and `"other"`; `Query: "resume"` returns only the first.
  - `TestScanPage_runtimeFilter`: a claude and a codex provider; `Runtime: "codex"` returns only the codex session.
  - `TestScanPage_badCursor`: `Cursor: "nope"` returns a non-nil error.
  - `TestScanPage_windowZeroReadsEveryFile`: one session with an mtime 400 days ago; `WindowDays: 0` lists it.

- [ ] **Step 2: Run them to see them fail**

Run: `go test ./pkg/agentsessions -run '^TestScanPage_'`
Expected: FAIL, `undefined: PageOpts`.

- [ ] **Step 3: Implement**
  - Cursor: `<mtime UnixNano>|<path>`, made and parsed only in `scanpage.go`. A candidate comes after the cursor when its mtime is older, or equal with a greater path.
  - `walkSince` (`agentsessions.go:1125`) sorts by mtime descending, then path ascending, so the order the cursor walks is total.
  - `parseCandidates` (`agentsessions.go:1207`) takes a `keep func(*SessionInfo) bool` (nil keeps all), applied with the tempDir drop, and also returns how many candidates it consumed. `Next` is the cursor of the last consumed candidate, `""` when it consumed them all.
  - `scanProviders` keeps its signature and returns `scanPageFrom(...)`'s sessions; `ScanSessions` keeps its 14-day / 20 defaults and does the same.
  - `normProjectPath(p string) string`: backslashes to `/`, trailing `/` trimmed, lowercased (as `normPath` in `frontend/app/view/agents/launcherresume.ts:15`).
  - `scanCacheMax` = `32768`; its comment gives the measurement (~1.2 MB per 1500 entries) and the reason (90-day retention is ~4500 files here).
  - The two handlers in `wshserver_agents.go:180` and `:197` call `agentsessions.ScanPage` with the request's fields, return `Next` as `NextCursor`, and wrap a cursor error as `fmt.Errorf("scanning sessions: %w", err)`.

- [ ] **Step 4: Regenerate the bindings**

Run: `task generate`
Expected: `frontend/types/gotypes.d.ts` gains `cursor?`, `runtime?`, `projectpath?`, `query?` and `nextcursor?` on those four types; no other generated file changes.

- [ ] **Step 5: Run the package tests**

Run: `go test ./pkg/agentsessions ./pkg/wshrpc/wshserver`
Expected: PASS, the existing `scanProviders` tests included.

- [ ] **Step 6: Commit**

```bash
git add pkg/agentsessions/agentsessions.go pkg/agentsessions/scanpage.go pkg/agentsessions/scanpage_test.go pkg/wshrpc/wshrpctypes_agents.go pkg/wshrpc/wshserver/wshserver_agents.go frontend/types/gotypes.d.ts
git commit -m "feat(sessions): page the session scan with a cursor and server-side filters"
```

### Task 2: Claude Code keeps transcripts 90 days

**Depends on:** none
**Files:** `cmd/wsh/cmd/wshcmd-installhooks.go`, `cmd/wsh/cmd/wshcmd-installhooks_test.go`, `docs/guide/agent-integration.md`

**Interfaces:**
- Produces: `const claudeCleanupPeriodDays = 90` and `func mergeClaudeCleanupPeriod(existing map[string]any) map[string]any` (a copy, as `mergeClaudePluginDirs` makes one at `wshcmd-installhooks.go:313`).

- [ ] **Step 1: Write the failing tests** in `wshcmd-installhooks_test.go`:
  - `TestMergeClaudeCleanupPeriod_setsNinetyWhenAbsent`: from `{"env": {"A": "1"}}`, `json.Marshal` of the result contains `"cleanupPeriodDays":90` and keeps `"A":"1"`.
  - `TestMergeClaudeCleanupPeriod_keepsTheUsersValue`: from `cleanupPeriodDays` 7, and from 0, the value is unchanged.
  - `TestMergeClaudeCleanupPeriod_doesNotMutateItsInput`: the input map has no `cleanupPeriodDays` key afterwards.
  - `TestConfigIsHealthy_requiresCleanupPeriod`: a config built by the full merge chain is healthy; the same config with `cleanupPeriodDays` deleted is not.

- [ ] **Step 2: Run them to see them fail**

Run: `go test ./cmd/wsh/cmd -run 'CleanupPeriod'`
Expected: FAIL, `undefined: mergeClaudeCleanupPeriod`.

- [ ] **Step 3: Implement.** `configIsHealthy` (`:635`) returns false when the key is absent, beside its `pluginDirsInclude` check (`:674`); the install path applies `mergeClaudeCleanupPeriod` right after `mergeClaudePluginDirs` (`:1281`). Existing `TestConfigIsHealthy*` cases that expect healthy now need the key in their fixture: add it there, never weaken the check.

- [ ] **Step 4: Run the package tests**

Run: `go test ./cmd/wsh/cmd`
Expected: PASS.

- [ ] **Step 5: Document it.** In `docs/guide/agent-integration.md:13`, the Claude Code row also names `cleanupPeriodDays` 90 in `~/.claude/settings.json`, written only when unset (the page is in Vietnamese; write the addition in Vietnamese).

- [ ] **Step 6: Commit**

```bash
git add cmd/wsh/cmd/wshcmd-installhooks.go cmd/wsh/cmd/wshcmd-installhooks_test.go docs/guide/agent-integration.md
git commit -m "feat(hooks): keep Claude Code transcripts 90 days unless the person set their own"
```

### Task 3: Resume list loads a project's sessions page by page and searches them all

**Depends on:** Task 1
**Files:** `frontend/app/view/agents/launcherresume.ts`, `frontend/app/view/agents/launcherresume.test.ts`, `frontend/app/view/agents/launcherstore.ts`, `frontend/app/view/agents/launcherstore.test.ts`, `frontend/app/view/agents/launcherresumelist.tsx`, `frontend/app/view/agents/launchermodal.tsx`

**Interfaces:**
- Consumes: `GetRecentSessionsCommand` with `runtime`, `projectpath`, `limit`, `cursor`, `query`; answer `nextcursor` (Task 1).
- Produces (`launcherresume.ts`, pure):
  - `RESUME_PAGE = 30`, replacing `RESUME_LIST_MAX`; `resumeChoices` keeps its runtime and project guard and drops the `slice`.
  - `resumeKey(runtime: Runtime, projectPath: string): string`: `""` when `resumeChoices` would offer nothing (terminal, no project), else the runtime and the normalized path.
  - `appendPage(prev: SessionInfo[], page: SessionInfo[]): SessionInfo[]`: `prev`, then the page's sessions whose id `prev` lacks.
  - `shownSessions(choices: SessionInfo[], filter: string, found: SessionInfo[] | null): SessionInfo[]`: `choices` when the filter is empty; else `filterSessions(choices, filter)` joined with `found`, each id once, newest first.
- Produces (`launcherstore.ts`):
  - `launcherPageAtom: { key: string; cursor: string; loading: boolean }` and `launcherFoundAtom: { key: string; query: string; sessions: SessionInfo[] } | null`.
  - `loadLauncherSessions(runtime: Runtime, projectPath: string): Promise<void>`: first page for that key, replacing `launcherSessionsAtom`.
  - `loadMoreLauncherSessions(): Promise<void>`: no-op while loading or when the cursor is `""`.
  - `findLauncherSessions(query: string): Promise<void>`: one page of `query` matches for the current key.
  - An answer whose key (or query) is no longer current is dropped.

- [ ] **Step 1: Write the failing tests.**
  - `launcherresume.test.ts`: `appendPage` keeps order and drops repeats; `shownSessions` with `"old"` joins a loaded match and a found one, each once, newest first; `resumeKey` is `""` for `"terminal"` and for an empty project, and equal for `/A/b/` and `/a/b`.
  - `launcherstore.test.ts` (mock `RpcApi.GetRecentSessionsCommand` as `sessionsarchivestore.test.ts:23` does): the first load sends `{ runtime, projectpath, limit: 30 }`; `loadMoreLauncherSessions` sends the answer's `nextcursor` and appends; a second call while the first is pending sends nothing; after an answer with no `nextcursor` it sends nothing; a first page for project A answered after a switch to project B leaves B's list alone; `findLauncherSessions("old")` sends `query: "old"` and fills `launcherFoundAtom`.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run frontend/app/view/agents/launcherresume.test.ts frontend/app/view/agents/launcherstore.test.ts`
Expected: FAIL, the new exports are undefined.

- [ ] **Step 3: Implement the model and store** to the interfaces above.

- [ ] **Step 4: Wire the views.**
  - `launchermodal.tsx:380-386`: the once-per-open load becomes an effect on `[open, runtime, projectPath]` that calls `loadLauncherSessions` when `resumeKey` is non-empty, still clearing the last open's list first.
  - `launcherresumelist.tsx`:
    - The rows' scroll container (`:135`) calls `loadMoreLauncherSessions` within 120 px of its bottom. Keys that move the pick down scroll it there too.
    - A non-empty filter calls `findLauncherSessions` 150 ms after the last keystroke.
    - Rows are `shownSessions(choices, filter, found)` when the found answer is for this filter, else `filterSessions(choices, filter)`.
    - The hint reads `${choices.length}+ · newest first` while a cursor remains.
    - While loading, the last row is `Loading older sessions…`.

- [ ] **Step 5: Run the tests and the typecheck**

Run: `npx vitest run frontend/app/view/agents/launcherresume.test.ts frontend/app/view/agents/launcherstore.test.ts && NODE_OPTIONS=--max-old-space-size=4096 task check:ts`
Expected: PASS, and `check:ts` exits 0 (about 2 minutes).

- [ ] **Step 6: Commit**

```bash
git add frontend/app/view/agents/launcherresume.ts frontend/app/view/agents/launcherresume.test.ts frontend/app/view/agents/launcherstore.ts frontend/app/view/agents/launcherstore.test.ts frontend/app/view/agents/launcherresumelist.tsx frontend/app/view/agents/launchermodal.tsx
git commit -m "feat(launcher): the Resume list loads older sessions as it scrolls and searches every one"
```

### Task 4: History loads older sessions as it scrolls; the palette drops engine workers

**Depends on:** Task 1
**Files:** `frontend/app/view/agents/sessionsarchivestore.ts`, `frontend/app/view/agents/sessionsarchivestore.test.ts`, `frontend/app/view/agents/conversationhistory.tsx`, `frontend/app/view/agents/sessiondelete.ts`, `frontend/app/view/agents/sessiondelete.test.ts`, `frontend/app/cockpit/actions/session.ts`

**Interfaces:**
- Consumes: `GetSessionsActivityCommand` with `limit`, `cursor`; answer `nextcursor` (Task 1).
- Produces (`sessionsarchivestore.ts`):
  - `PAGE = 100`, replacing `WINDOW_DAYS` and `LIMIT`. The request sends no `windowdays`.
  - `sessionsCursorAtom: string` (`""` = everything loaded) and `sessionsLoadingMoreAtom: boolean`.
  - `mergeFreshPage(fresh: SessionActivity[], freshCursor: string, kept: SessionActivity[], keptCursor: string): { sessions: SessionActivity[]; cursor: string }`: the fresh page, then the kept sessions older than the fresh page's oldest that it does not list. The cursor is `keptCursor` when such kept sessions remain, else `freshCursor`. Identity is runtime + id.
  - `loadSessionsArchive()` merges its page 1 through `mergeFreshPage`; `loadMoreSessionsArchive(): Promise<void>` appends the next page (no-op while loading or at cursor `""`).
  - `dropFromArchive(transcriptPath: string): void` removes that row now.
  - `paletteSessions<T extends SessionActivity>(list: T[]): T[]`: resumable sessions whose `role` is empty or `"lead"`.

- [ ] **Step 1: Write the failing tests** in `sessionsarchivestore.test.ts` and `sessiondelete.test.ts`:
  - `mergeFreshPage`, three pages kept, a fresh page where an old session moved to the top: the result lists every session once, that session first, and keeps `keptCursor`.
  - `mergeFreshPage` with nothing older kept: `freshCursor`.
  - `loadMoreSessionsArchive` sends the stored cursor, appends, and sends nothing while pending or once the cursor is `""`.
  - `paletteSessions` keeps a session with no role and a lead; drops `"worker"`, `"review"` and a stage role; drops one with no `resumecommand`.
  - `deleteSession` removes the row of a session that is not in the reload's page 1.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run frontend/app/view/agents/sessionsarchivestore.test.ts frontend/app/view/agents/sessiondelete.test.ts`
Expected: FAIL, the new exports are undefined.

- [ ] **Step 3: Implement the store**, `dropFromArchive` before the reload in `deleteSession` (`sessiondelete.ts:58`), and `paletteSessions` in place of the `.filter((s) => s.resumecommand)` in `frontend/app/cockpit/actions/session.ts:58-66`.

- [ ] **Step 4: Wire History.** The list's scroll container (`conversationhistory.tsx:303`) calls `loadMoreSessionsArchive` within 120 px of its bottom. While `sessionsLoadingMoreAtom` is true, its last row is `Loading older sessions…`.

- [ ] **Step 5: Run the tests and the typecheck**

Run: `npx vitest run frontend/app/view/agents/sessionsarchivestore.test.ts frontend/app/view/agents/sessiondelete.test.ts frontend/app/cockpit/actions/session.test.ts && NODE_OPTIONS=--max-old-space-size=4096 task check:ts`
Expected: PASS, and `check:ts` exits 0.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/view/agents/sessionsarchivestore.ts frontend/app/view/agents/sessionsarchivestore.test.ts frontend/app/view/agents/conversationhistory.tsx frontend/app/view/agents/sessiondelete.ts frontend/app/view/agents/sessiondelete.test.ts frontend/app/cockpit/actions/session.ts
git commit -m "feat(history): load older sessions as the list scrolls; the palette lists no engine workers"
```

### Task 5: Scenarios and changelog

**Depends on:** Task 2, Task 3, Task 4
**Files:** `scripts/cdp/scenarios.mjs`, `CHANGELOG.md`

**Interfaces:**
- Consumes: the `Loading older sessions…` row, `data-launcher-resume`, `data-resume-id` (Task 3); the History list (Task 4).

- [ ] **Step 1: Add `launcher-resume-older`**, arranged as `launcher-resume` (`scenarios.mjs:22494`) is: one project in a `mkdtemp` under the home dir, transcripts in their own `~/.claude/projects/verify-…` folder, `utimesSync` for mtimes, and everything removed in teardown. Seed 40 sessions with mtimes 1 to 40 hours ago, titled `verify lazy N`, and one 10 days old titled `verify-older-<8 hex>`. Steps:
  1. Opening the dialog on Claude and that project lists 30 session rows.
  2. Scrolling the Session column to its end lists 41, the last being the 10-day-old one.
  3. Reopened, typing `older` in the Session column shows the 10-day-old row before any scroll.

- [ ] **Step 2: Add `history-older`**: one session 10 days old titled `verify-history-older-<8 hex>`, seeded the same way. Open Conversation History as `agent-history` (`scenarios.mjs:14511`) does. Steps:
  1. The first load lists at most 100 rows.
  2. Scrolling the list to its end, waiting out `Loading older sessions…` each time (at most 30 rounds), brings up the seeded row.

- [ ] **Step 3: Run them in the browser app**

Run: `node --experimental-websocket scripts/cdp/verify.mjs launcher-resume launcher-resume-older history-older` against a running `task dev:browser`.
Expected: every step PASS.

- [ ] **Step 4: CHANGELOG.** Under `## Unreleased` → `### Changed`, three lines for the user:
  - The Resume list and Conversation History load older sessions as you scroll, instead of stopping at the newest 50 or 100.
  - Typing in the Resume list finds any session of that project still on disk.
  - Claude Code now keeps conversations 90 days instead of 30, unless you set `cleanupPeriodDays` yourself.

  Add `<!-- try: <id> -->` only where a global binding in `frontend/app/store/keybindings/bindings.ts` opens the New dialog or History.

- [ ] **Step 5: Commit**

```bash
git add scripts/cdp/scenarios.mjs CHANGELOG.md
git commit -m "test(cdp): older sessions in the Resume list and History; changelog"
```
