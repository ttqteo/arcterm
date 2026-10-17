# Session Lists Lazy Load Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The New dialog's Resume list and Conversation History reach every session still on disk by loading older pages as you scroll, instead of stopping at the newest 50 or 100, and Claude Code keeps transcripts 90 days instead of 30.

**Architecture:** The backend session scan (`pkg/agentsessions`) gains one paged entry point: newest first, an opaque cursor naming the last transcript a page read, and optional runtime, project and title filters applied before the limit counts. The two session RPCs carry the cursor and filters through. The Resume list asks for one project and runtime at a time and searches the backend as you type; History appends pages and keeps them across refreshes. `wsh install-agent-hooks` writes `cleanupPeriodDays: 90` into `~/.claude/settings.json` when the person has not set it.

**Tech Stack:** Go (agentsessions, wshrpc, wsh), React 19 + jotai + Tailwind 4, vitest, CDP scenario harness.

**Spec:** This file's Design section, agreed in chat on 2026-10-17; the decisions and measurements are the note trail of effort cd1ec402-930e-4f3f-b871-f0e0563365d8.

**Verify:** `node scripts/verify.mjs ./pkg/agentsessions ./pkg/wshrpc/... ./cmd/wsh/...`

**Final:** `node scripts/cdp/final-verify.mjs launcher-resume launcher-resume-older history-older agent-history`

## Design

Measured on the Mac on 2026-10-17: ~40 interactive Claude sessions a day, so the Resume list (14 days, limit 50, filtered to one project in the browser) reached ~40 h back and History (30 days, limit 100) ~3 days. Claude Code's `cleanupPeriodDays` (default 30) deletes older transcripts, so nothing before 2026-09-17 is on disk.

Scan cost, `agentsessions.ScanSessions` from a scratch program: the stat-only walk over all 1507 transcript files 84 ms cold / 16 ms warm; a page of 50 parses in 210–290 ms cold, 15 ms warm; all 587 sessions in 1.33 s cold, 15 ms warm. The parse cache held ~1.2 MB for 1500 files.

Decisions:
1. **Lazy loading, not a bigger cap.** Each list loads one page, then the next when its scroll reaches the end. No day window: a page walks every transcript on disk.
2. **The Resume list filters on the server**, by the picked runtime and project, so a page is that project's own sessions. Engine workers run in worktree folders, never in the project folder, so they drop out of the Resume list by this filter alone.
3. **Search reaches the whole store.** Typing in the Resume list asks the backend for sessions of that project whose title contains the text, beside the instant filter over the rows already loaded. History has no search box and gets none.
4. **The palette lists no engine worker, reviewer or stage sessions**: only sessions with no run role, or the lead.
5. **`cleanupPeriodDays: 90`** (~4.5 GB at today's rate), written only when the settings have no `cleanupPeriodDays` of their own.
6. **The parse cache cap goes from 4096 to 32768 entries**: ~4500 files at 90 days would overflow 4096, and a full cache clears itself, so every scan would go cold. The same constant caps `designWritesCache` (`canvassessions.go`, `designWritesCached`), which also holds one entry per transcript, so its cap rises with it.

History keeps its status filter (All, Live, Needs you, Done) in the browser and lists every project, as it does today; it does not pass `projectpath`. A filter that leaves the list shorter than its container gets the older pages through the refill rule below, not through a server filter.

## Global Constraints

- Resume list page: 30 sessions. History page: 100 sessions.
- The pages walk one total order: transcript mtime descending, then path ascending, across every provider. The cursor is a position in that order.
- A list loads its next page when its scroll is within 120 px of the bottom (`nearListEnd`, Task 1), one request in flight at a time, and stops when the answer's cursor is `""`.
- **Refill:** the same check also runs after each page lands, and in History when the status filter changes, so a list that does not fill its container (no scrollbar, so no scroll event) keeps loading until it does or the cursor is `""`. The Resume list runs it only while its filter is empty; a typed filter is served by the backend search.
- While a page is in flight the list shows a last row reading exactly `Loading older sessions…`, muted.
- A Resume row found by search is pickable and resumes like a loaded one.
- `cleanupPeriodDays` value: `90`. A value the person set (any number, including 0) is kept.
- `scanCacheMax`: `32768`.
- Generated files (`frontend/types/gotypes.d.ts` and the rest `task generate` writes) are never hand-edited: change the Go type, run `task generate`.
- Colors come from the `@theme` tokens; follow `DESIGN.md`.

## Review Focus

1. Switching the Resume list's project or runtime while a page is in flight: the old project's answer must not land in the new list. (Task 3, store test.)
2. An agent exits while History has three pages loaded: the refresh keeps the older pages, lists no session twice, and the session that just ended moves to the top. (Task 4, `mergeFreshPage` test.)
3. Equal mtimes on either side of a page boundary, across providers: each session listed exactly once. (Task 1, Go test with more than 12 equal-mtime files.)
4. Deleting a session that came in on page 3: its row goes, though the reload only re-reads page 1. (Task 4, `dropFromArchive` test; history-older step 4.)
5. Scrolling fast, or a project with no sessions: one request at a time, and an empty last page with cursor `""` ends the loading for good, never a loop. (Tasks 3 and 4, store tests; launcher-resume-older step 3.)
6. A filtered History list too short to scroll still reaches the older sessions that match. (Task 4; history-older step 3.)
7. Picking a Resume row found by search resumes that session, not a New session. (Task 3; launcher-resume-older step 6.)

---

### Task 1: Paged session scan and RPC

**Depends on:** none
**Files:** `pkg/agentsessions/agentsessions.go`, `pkg/agentsessions/canvassessions.go`, `pkg/agentsessions/scanpage.go`, `pkg/agentsessions/scanpage_test.go`, `pkg/wshrpc/wshrpctypes_agents.go`, `pkg/wshrpc/wshserver/wshserver_agents.go`, `frontend/types/gotypes.d.ts`, `frontend/app/view/agents/listend.ts`, `frontend/app/view/agents/listend.test.ts`

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
- Produces (frontend, `frontend/app/view/agents/listend.ts`, pure; Tasks 3 and 4 both use it):
  ```ts
  export const LIST_END_PX = 120;
  // true when the list is within LIST_END_PX of its end, which a list with no scrollbar always is
  export function nearListEnd(el: { scrollHeight: number; scrollTop: number; clientHeight: number }): boolean;
  ```

- [ ] **Step 1: Write the failing tests** in `pkg/agentsessions/scanpage_test.go`, building transcripts under `t.TempDir()` with `claudeProvider(root)` as `agentsessions_test.go:678` does, and setting mtimes with `os.Chtimes`. They call an internal `scanPageFrom(providers []provider, opts PageOpts, tempDir string) (Page, error)`.
  - `TestScanPage_pagesNewestFirstWithoutGapsOrRepeats`: 7 sessions, mtimes 1 minute apart, `Limit: 3`. Pages read by following `Next` hold 3, 3, 1 sessions; together they are the 7 ids newest first, each once; the last page's `Next == ""`.
  - `TestScanPage_sameMtimeAcrossABoundary`: 16 sessions sharing one mtime, split over two providers (two `claudeProvider` roots), `Limit: 5`. Following `Next` lists all 16 ids, each once. 12 or fewer would pass by luck: `sort.Slice` insertion-sorts a slice of up to 12 elements, which keeps input order.
  - `TestScanPage_filtersBeforeTheLimitCounts`: 6 sessions, 2 with cwd `/p/a`, 4 with cwd `/p/b`, newest is `/p/b`. `ProjectPath: "/p/a/", Limit: 2` returns both `/p/a` sessions and `Next == ""`.
  - `TestScanPage_queryMatchesTheTitleCaseInsensitively`: tasks `"Fix the Resume list"` and `"other"`; `Query: "resume"` returns only the first.
  - `TestScanPage_runtimeFilter`: a claude and a codex provider; `Runtime: "codex"` returns only the codex session.
  - `TestScanPage_badCursor`: `Cursor: "nope"` returns a non-nil error.
  - `TestScanPage_windowZeroReadsEveryFile`: one session with an mtime 400 days ago; `WindowDays: 0` lists it.
  - `frontend/app/view/agents/listend.test.ts`: a list with no scrollbar (`scrollHeight == clientHeight`, `scrollTop 0`) is near its end; a 2000 px list in a 400 px box at the top is not; at `scrollTop` 1500 (100 px left) it is; at 1400 (200 px left) it is not.

- [ ] **Step 2: Run them to see them fail**

Run: `go test ./pkg/agentsessions -run '^TestScanPage_' ; npx vitest run frontend/app/view/agents/listend.test.ts`
Expected: FAIL, `undefined: PageOpts`, and the vitest file cannot import `./listend`.

- [ ] **Step 3: Implement**
  - Cursor: `<mtime UnixNano>|<path>`, made and parsed only in `scanpage.go`. A candidate comes after the cursor when its mtime is older, or equal with a greater path.
  - One ordering, `candidateLess(a, b candidate) bool`: mtime descending, then path ascending. `scanPageFrom` sorts the candidates merged from every provider with it (today `scanProviders` merges with `sort.Slice` on mtime alone, which is unstable and reorders equal mtimes); `walkSince`'s own sort uses it too.
  - `parseCandidates` takes a `keep func(*SessionInfo) bool` (nil keeps all), applied with the tempDir drop, and also returns how many candidates it consumed. `Next` is the cursor of the last consumed candidate, `""` when it consumed them all.
  - `scanProviders` keeps its signature and returns `scanPageFrom(...)`'s sessions; `ScanSessions` keeps its 14-day / 20 defaults and does the same.
  - `normProjectPath(p string) string`: backslashes to `/`, trailing `/` trimmed, lowercased (as `normPath` in `frontend/app/view/agents/launcherresume.ts`).
  - `scanCacheMax` = `32768`; its comment gives the measurement (~1.2 MB per 1500 entries), the reason (90-day retention is ~4500 files here), and that it caps `designWritesCache` too. The comment above `designWritesCached`'s clear in `canvassessions.go` says the shared cap is per transcript.
  - `GetRecentSessionsCommand` and `GetSessionsActivityCommand` in `wshserver_agents.go` call `agentsessions.ScanPage` with the request's fields, return `Next` as `NextCursor`, and wrap a cursor error as `fmt.Errorf("scanning sessions: %w", err)`. The handlers only copy fields: `windowdays` 0 is covered by `TestScanPage_windowZeroReadsEveryFile`, and the cursor and `nextcursor` through the real handlers by the Task 5 scenarios (launcher-resume-older step 2, history-older step 2), which read the real wavesrv.
  - `listend.ts`: `nearListEnd` is `scrollHeight - scrollTop - clientHeight < LIST_END_PX`.

- [ ] **Step 4: Regenerate the bindings**

Run: `task generate`
Expected: `frontend/types/gotypes.d.ts` gains `cursor?`, `runtime?`, `projectpath?`, `query?` and `nextcursor?` on those four types; no other generated file changes.

- [ ] **Step 5: Run the package tests**

Run: `go test ./pkg/agentsessions ./pkg/wshrpc/wshserver && npx vitest run frontend/app/view/agents/listend.test.ts`
Expected: PASS, the existing `scanProviders` tests included.

- [ ] **Step 6: Commit**

```bash
git add pkg/agentsessions/agentsessions.go pkg/agentsessions/canvassessions.go pkg/agentsessions/scanpage.go pkg/agentsessions/scanpage_test.go pkg/wshrpc/wshrpctypes_agents.go pkg/wshrpc/wshserver/wshserver_agents.go frontend/types/gotypes.d.ts frontend/app/view/agents/listend.ts frontend/app/view/agents/listend.test.ts
git commit -m "feat(sessions): page the session scan with a cursor and server-side filters"
```

### Task 2: Claude Code keeps transcripts 90 days

**Depends on:** none
**Files:** `cmd/wsh/cmd/wshcmd-installhooks.go`, `cmd/wsh/cmd/wshcmd-installhooks_test.go`, `docs/guide/agent-integration.md`

**Interfaces:**
- Produces: `const claudeCleanupPeriodDays = 90` and `func mergeClaudeCleanupPeriod(existing map[string]any) map[string]any` (a copy, as `mergeClaudePluginDirs` makes one).

- [ ] **Step 1: Write the failing tests** in `wshcmd-installhooks_test.go`:
  - `TestMergeClaudeCleanupPeriod_setsNinetyWhenAbsent`: from `{"env": {"A": "1"}}`, `json.Marshal` of the result contains `"cleanupPeriodDays":90` and keeps `"A":"1"`.
  - `TestMergeClaudeCleanupPeriod_keepsTheUsersValue`: from `cleanupPeriodDays` 7, and from 0, the value is unchanged.
  - `TestMergeClaudeCleanupPeriod_doesNotMutateItsInput`: the input map has no `cleanupPeriodDays` key afterwards.
  - `TestConfigIsHealthy_requiresCleanupPeriod`: a config built by the full merge chain is healthy; the same config with `cleanupPeriodDays` deleted is not.

- [ ] **Step 2: Run them to see them fail**

Run: `go test ./cmd/wsh/cmd -run 'CleanupPeriod'`
Expected: FAIL, `undefined: mergeClaudeCleanupPeriod`.

- [ ] **Step 3: Implement.** `configIsHealthy` returns false when the key is absent, beside its `pluginDirsInclude` check; the install path applies `mergeClaudeCleanupPeriod` right after its `merged = mergeClaudePluginDirs(merged, modDirs...)` call. Existing `TestConfigIsHealthy*` cases that expect healthy now need the key in their fixture: add it there, never weaken the check.

- [ ] **Step 4: Run the package tests**

Run: `go test ./cmd/wsh/cmd`
Expected: PASS.

- [ ] **Step 5: Document it.** In `docs/guide/agent-integration.md`, the Claude Code row of the table near the top also names `cleanupPeriodDays` 90 in `~/.claude/settings.json`, written only when unset (the page is in Vietnamese; write the addition in Vietnamese).

- [ ] **Step 6: Commit**

```bash
git add cmd/wsh/cmd/wshcmd-installhooks.go cmd/wsh/cmd/wshcmd-installhooks_test.go docs/guide/agent-integration.md
git commit -m "feat(hooks): keep Claude Code transcripts 90 days unless the person set their own"
```

### Task 3: Resume list loads a project's sessions page by page and searches them all

**Depends on:** Task 1
**Files:** `frontend/app/view/agents/launcherresume.ts`, `frontend/app/view/agents/launcherresume.test.ts`, `frontend/app/view/agents/launcherstore.ts`, `frontend/app/view/agents/launcherstore.test.ts`, `frontend/app/view/agents/launcherresumelist.tsx`, `frontend/app/view/agents/launchermodal.tsx`

**Shown by:** launcher-resume-older steps 1–6 (Task 5): 30 rows and the `30+ · newest first` hint (1), the `Loading older sessions…` row and the 41st row (2), an empty project (3), a project switch reloading page 1 (4), ArrowDown loading the next page (5), a found row picked and resumed (6). launcher-resume keeps passing.

**Interfaces:**
- Consumes: `GetRecentSessionsCommand` with `runtime`, `projectpath`, `limit`, `cursor`, `query`; answer `nextcursor`; `nearListEnd` (Task 1).
- Produces (`launcherresume.ts`, pure):
  - `RESUME_PAGE = 30`, replacing `RESUME_LIST_MAX`; `resumeChoices` keeps its runtime and project guard and drops the `slice`.
  - `resumeScopeKey(runtime: Runtime, projectPath: string): string`: `""` when `resumeChoices` would offer nothing (terminal, no project), else the runtime and the normalized path. (Not `resumeKey`: `resumeListKey`, the Session column's keyboard mapper, already lives in this file.)
  - `appendPage(prev: SessionInfo[], page: SessionInfo[]): SessionInfo[]`: `prev`, then the page's sessions whose id `prev` lacks.
  - `shownSessions(choices: SessionInfo[], filter: string, found: SessionInfo[] | null): SessionInfo[]`: `choices` when the filter is empty; else `filterSessions(choices, filter)` joined with `found`, each id once, newest first.
- Produces (`launcherstore.ts`):
  - `launcherPageAtom: { key: string; cursor: string; loading: boolean }` and `launcherFoundAtom: { key: string; query: string; sessions: SessionInfo[] } | null`.
  - `loadLauncherSessions(runtime: Runtime, projectPath: string): Promise<void>`: first page for that key, replacing `launcherSessionsAtom`.
  - `loadMoreLauncherSessions(): Promise<void>`: no-op while loading or when the cursor is `""`.
  - `findLauncherSessions(query: string): Promise<void>`: one page of `query` matches for the current key.
  - An answer whose key (or query) is no longer current is dropped.

- [ ] **Step 1: Write the failing tests.**
  - `launcherresume.test.ts`: `appendPage` keeps order and drops repeats; `shownSessions` with `"old"` joins a loaded match and a found one, each once, newest first; `resumeScopeKey` is `""` for `"terminal"` and for an empty project, and equal for `/A/b/` and `/a/b`; `pickedResume(appendPage(choices, found), id)` resolves the id of a found session that `choices` lacks.
  - `launcherstore.test.ts` (mock `RpcApi.GetRecentSessionsCommand` as `sessionsarchivestore.test.ts` does): the first load sends `{ runtime, projectpath, limit: 30 }`; `loadMoreLauncherSessions` sends the answer's `nextcursor` and appends; a second call while the first is pending sends nothing; after an answer with no `nextcursor` it sends nothing; a first page for project A answered after a switch to project B leaves B's list alone; `findLauncherSessions("old")` sends `query: "old"` and fills `launcherFoundAtom`.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run frontend/app/view/agents/launcherresume.test.ts frontend/app/view/agents/launcherstore.test.ts`
Expected: FAIL, the new exports are undefined.

- [ ] **Step 3: Implement the model and store** to the interfaces above.

- [ ] **Step 4: Wire the views.**
  - `launchermodal.tsx`, the effect that reads the Resume list's sessions once per open (it sets `launcherSessionsAtom` to null, then calls `loadLauncherSessions`): it becomes an effect on `[open, runtime, projectPath]` that calls `loadLauncherSessions` when `resumeScopeKey` is non-empty, still clearing the last list first.
  - `launchermodal.tsx`, where `resume` is resolved (`pickedResume(choices, resumeId)`): resolve it over `appendPage(choices, foundHere)`, `foundHere` being `launcherFoundAtom`'s sessions when its key is the current `resumeScopeKey`, else `[]`. A found row older than the loaded pages then resumes instead of launching a New session.
  - `launcherresumelist.tsx`:
    - The rows' scroll container (the `overflow-y-auto` div) calls `loadMoreLauncherSessions` when `nearListEnd` holds: on scroll, and, while the filter is empty, after each page lands (the refill rule). Keys that move the pick down scroll it into view as today, and that scroll loads the next page too.
    - A non-empty filter calls `findLauncherSessions` 150 ms after the last keystroke.
    - Rows are `shownSessions(choices, filter, found)` when the found answer is for this key and filter, else `filterSessions(choices, filter)`.
    - The unfocused hint reads `${choices.length}+ · newest first` while a cursor remains, `${choices.length} · newest first` once it is `""`.
    - While loading, the last row is `Loading older sessions…`, muted.

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

**Shown by:** history-older steps 1–4 (Task 5): page 1 without the old row (1), the `Loading older sessions…` row and the old row after scrolling (2), the Live filter refilling with no scroll (3), deleting a row from an older page (4). agent-history keeps passing. The palette's role filter has no scenario: a session's role comes from the run store (`linkSessionsToRuns`), which a scenario cannot seed without an engine run, so it is covered by the `paletteSessions` unit test only.

**Interfaces:**
- Consumes: `GetSessionsActivityCommand` with `limit`, `cursor`; answer `nextcursor`; `nearListEnd` (Task 1).
- Produces (`sessionsarchivestore.ts`):
  - `PAGE = 100`, replacing `WINDOW_DAYS` and `LIMIT`. The request sends no `windowdays`.
  - `sessionsCursorAtom: string` (`""` = everything loaded) and `sessionsLoadingMoreAtom: boolean`.
  - `mergeFreshPage(fresh: SessionActivity[], freshCursor: string, kept: SessionActivity[], keptCursor: string): { sessions: SessionActivity[]; cursor: string }`: the fresh page, then the kept sessions older than the fresh page's oldest that it does not list. The cursor is `keptCursor` when such kept sessions remain, else `freshCursor`. Identity is runtime + id.
  - `loadSessionsArchive()` merges its page 1 through `mergeFreshPage`; `loadMoreSessionsArchive(): Promise<void>` appends the next page (no-op while loading or at cursor `""`).
  - `dropFromArchive(transcriptPath: string): void` removes that row now.
  - `paletteSessions<T extends SessionActivity>(list: T[]): T[]`: resumable sessions whose `role` is empty or `"lead"`.

- [ ] **Step 1: Write the failing tests** in `sessionsarchivestore.test.ts` and `sessiondelete.test.ts`:
  - `loadSessionsArchive` sends exactly `{ limit: 100 }` to the mocked `GetSessionsActivityCommand`: no `windowdays`, no `cursor`.
  - `mergeFreshPage`, three pages kept, a fresh page where an old session moved to the top: the result lists every session once, that session first, and keeps `keptCursor`.
  - `mergeFreshPage` with nothing older kept: `freshCursor`.
  - `loadMoreSessionsArchive` sends the stored cursor, appends, and sends nothing while pending or once the cursor is `""`; called again right after an empty last page with cursor `""` (what the refill does on a list that never fills), it sends nothing.
  - `paletteSessions` keeps a session with no role and a lead; drops `"worker"`, `"review"` and a stage role; drops one with no `resumecommand`.
  - `deleteSession` removes the row of a session that is not in the reload's page 1.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run frontend/app/view/agents/sessionsarchivestore.test.ts frontend/app/view/agents/sessiondelete.test.ts`
Expected: FAIL, the new exports are undefined.

- [ ] **Step 3: Implement the store**, `dropFromArchive` before the reload in `deleteSession` (`sessiondelete.ts`), and `paletteSessions` in place of the `.filter((s) => s.resumecommand)` in the palette's `entries` (`frontend/app/cockpit/actions/session.ts`).

- [ ] **Step 4: Wire History.** The left list's scroll container in `conversationhistory.tsx` (the `overflow-y-auto` div that starts with the All activity button) calls `loadMoreSessionsArchive` when `nearListEnd` holds: on scroll, after each page lands (`sessionsArchiveAtom` changes), and when the status filter changes. That is the refill rule: a filter such as Live that leaves a few rows and no scrollbar keeps loading pages until the list fills or the cursor is `""`; the store's one-in-flight and cursor `""` stops keep it from looping. While `sessionsLoadingMoreAtom` is true, the list's last row is `Loading older sessions…`, muted, whatever the filter.

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
- Consumes: the `Loading older sessions…` row, the Session column's hint, `data-launcher-resume`, `data-resume-id` (Task 3); the History list, its status filter and Delete session (Task 4).

Both new scenarios read the real wavesrv over the seeded transcripts: neither installs a data mock for `getrecentsessions` or `getsessionsactivity` (agent-history's `installAhMock` answers every call with its fixtures and ignores `cursor` and `limit`, so a copy of it could never page). They share one wrapper, `installCursorDelay(h, apiUrl, ms)`, built on RpcApi's mock client as `installAhMock` is (find `apiUrl` with `ahResolveModules`): it passes every call on to what was there, holds back the answer of a `getrecentsessions` or `getsessionsactivity` call whose data has a non-empty `cursor` for `ms` (800), counts those calls per command, and is removed in teardown. A warm scan takes ~15 ms, so without it the loading row is never on screen to assert.

- [ ] **Step 1: Add `launcher-resume-older`**, arranged as `launcher-resume` is: two projects in `mkdtemp` folders under the home dir, the first with transcripts in their own `~/.claude/projects/verify-…` folder, the second with none, `utimesSync` for mtimes, and everything removed in teardown. Seed in the first 40 sessions with mtimes 1 to 40 hours ago, titled `verify lazy N`, and one 10 days old titled `verify-older-<8 hex>`. Install `installCursorDelay`. Steps:
  1. Opening the dialog on Claude and the first project lists 30 session rows, and the Session column's hint reads `30+ · newest first`.
  2. Scrolling the Session column to its end shows `Loading older sessions…` as its last row within 700 ms; then the list holds 41 rows, the last being the 10-day-old one, the loading row is gone, and the hint reads `41 · newest first`.
  3. Picking the second project shows no Resume section and no `Loading older sessions…`, and in the next second the wrapper counts no `getrecentsessions` call with a cursor.
  4. Back on the first project the list holds 30 rows again: page 1 re-read, no row twice.
  5. From New session, pressing ArrowDown 30 times moves the pick to the 30th row and scrolls it into view, which loads the next page: the list holds 41 rows.
  6. Closed and reopened, typing `older` in the Session column shows the 10-day-old row before any scroll; clicking it makes the button read `Resume agent` and the command `claude --resume <its id>`.

- [ ] **Step 2: Add `history-older`**: a `mkdtemp` folder under the home dir as the sessions' cwd (one under the temp dir is dropped by the scan), and transcripts in their own `~/.claude/projects/verify-…` folder: 110 sessions with mtimes 1 to 110 minutes ago titled `verify history N`, so page 1 holds no session older than them whatever else is on the machine, and one 10 days old titled `verify-history-older-<8 hex>`. Reload the app after seeding so the archive's page 1 is read over them, and install `installCursorDelay`. Open History with the steps agent-history uses (click `[data-agent-history-open]`, wait for the `[data-agent-history]` root), but no `installAhMock`. Steps:
  1. The first load lists at most 100 rows, and the seeded old row is not among them.
  2. Scrolling the list to its end shows `Loading older sessions…` as its last row within 700 ms; scrolling again each time the row goes (at most 30 rounds) brings up the seeded old row.
  3. Reloaded and reopened (page 1 only), picking the Live filter loads older pages with no scroll: `Loading older sessions…` shows within 2 s and later goes for good (wait at most 60 s); picking All then lists the seeded old row with no scroll.
  4. Deleting the seeded old row (select it, Delete session in its detail view, `sessionsdetail.tsx`, then Delete in the confirm) removes its row and its transcript file, while the list still holds more than 100 rows: the older pages stay loaded.

- [ ] **Step 3: Run them**

Run: `node scripts/cdp/final-verify.mjs launcher-resume launcher-resume-older history-older agent-history`
It starts its own app (headless Chrome on a Mac), runs the scenarios and stops it; nothing else needs to be running.
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
