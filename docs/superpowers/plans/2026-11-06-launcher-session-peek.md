# New agent: Quick look a Claude session

**Spec:** `docs/superpowers/specs/2026-11-06-launcher-session-peek-design.md` (decisions D1–D8; follow it where this plan is silent)
**Verify:** `node scripts/verify.mjs ./pkg/agentsessions/... ./pkg/wshrpc/...`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs launcher-session-peek launcher-resume`
**Prototype:** D:\src\arcterm\.superpowers\design\launcher-session-peek\project\A2-under-columns.dc.html

Decisions this plan makes beyond the spec, and why:

1. **Wire names.** One wshrpc command, `GetSessionPeekCommand` (wire name `getsessionpeek`), in
   `pkg/wshrpc/wshrpctypes_agents.go`:
   `CommandGetSessionPeekData{ TranscriptPath string "transcriptpath"; Count int "count" }` →
   `CommandGetSessionPeekRtnData{ Messages []SessionPeekMessage "messages"; Capped bool "capped" }`,
   `SessionPeekMessage{ Role string "role" ("user" | "assistant"); Text string "text"; Ts int64 "ts" (UnixMilli) }`.
   The frontend reads it as `RpcApi.GetSessionPeekCommand(TabRpcClient, { transcriptpath, count: 5 })`. Named "peek"
   to match the existing Overview Quick look (`sessionpeek.tsx`). The interface lands first as its own task (Task 1)
   so the panel (Task 4) does not wait on the reader (Task 2).
2. **Go entry point** is `agentsessions.ClaudeTailMessages(path string, n int) (msgs []PeekMessage, capped bool, err error)`
   in a new `pkg/agentsessions/tailmessages.go`, `PeekMessage{ Role, Text string; Ts int64 }`. A file that cannot be
   opened returns the error (the panel shows it, D8); `Count` outside 1..20 is clamped (0 → 5). The command requires a
   non-empty path ending in `.jsonl` and otherwise reads any path, as `GetAgentTranscriptCommand` already does: Claude
   accounts can live in more than one config dir, so a fixed-root check would refuse real sessions.
3. **Which user records are prompts** reuses `claudeTypedText` (`humanprompts.go`) as is, so the panel and
   `HumanPrompts` never disagree. On top of it, `<system-reminder>…</system-reminder>` blocks are stripped from a
   prompt's text, and a prompt left empty is skipped (spec D4: system reminders are left out).
4. **Turn rule, read backwards** (spec D4): walking records newest → oldest, a non-sidechain assistant record with
   text (`textBlocks`) is the turn's answer only if this turn has no answer yet; a real prompt is emitted and resets
   "answer found". So narration earlier in the same turn is skipped, and a turn still running (no text yet) shows
   only its prompt.
5. **Esc order** in `launcherKey`: flag menu → branch list → account menu → Quick look → filter → close. The popovers
   draw over the panel, so they are innermost; the filter and the panel never coexist in practice (a project pick
   closes the panel, D6). `peekOpen` is an optional field of `LauncherKeyCtx`, as `accountMenuOpen` is, so Task 3
   lands without touching `launchermodal.tsx`.
6. **Panel state lives in the dialog** (`useState` in `LauncherModal`, plus a per-opening loader/cache from
   `launcherpeek.ts` held in a ref), not in a jotai atom: the spec wants nothing to live on after the dialog closes,
   and the dialog is the panel's only host.
7. **RAM measurement is a substitute for the spec's.** The spec asks for wavesrv's RAM while holding ↓ through a long
   session list; nobody can do that in a live app during an engine run. Instead a Go benchmark with
   `b.ReportAllocs()` reads a synthetic 52 MB / 5,300-line transcript shaped like the measured one (long tool-result
   lines), and its `B/op` (allocation per read, not wavesrv RSS) is logged under "(arcterm) RAM watch" in
   `docs/open-issues.md`, saying it is that substitute. Holding ↓ costs one or two such reads (D7) and nothing is held
   between reads, so the per-read allocation is the number that decides whether this is heavy.
8. **The panel shrinks before anything else.** The dialog's fields region (`launchermodal.tsx`, the
   `min-h-0 shrink … overflow-y-auto` div holding the Task box) and the columns would otherwise give up height first.
   The panel takes a much larger flex-shrink weight than both (e.g. `[flex-shrink:100]`) and a min height of about
   two messages (~64px), so in a short window it gives its height up first and the Task box and columns keep theirs
   (D5).
9. **Scenario.** A new CDP scenario `launcher-session-peek`, and the existing `launcher-resume` step 6 changes:
   Shift+Enter on a Claude session now opens Quick look, so Open asleep is pressed from the panel's header. The DOM
   hooks below are fixed here, so the scenario (Task 5) is written beside the panel (Task 4); it runs only at Final.

DOM hooks (Task 4 adds them, Task 5 reads them):
`[data-launcher-peek-toggle]` (footer Quick look button, `aria-pressed`), `[data-launcher-peek]` (the panel section,
`data-peek-session="<session id>"`, `data-peek-state="loading|ready|empty|capped|error"`), `[data-peek-reading]`
(the "Reading…" line, drawn only after the 150 ms delay), `[data-peek-msg]` (one per message,
`data-role="user|assistant"`), `[data-peek-note]` (the capped note, with 1–4 found), `[data-peek-empty]` (the empty
or capped-with-none line), `[data-peek-error]` (the error line), `[data-peek-asleep]` (Open asleep in the panel
header), `[data-peek-close]` (the panel's close button), `[data-peek-scroll]` (the scrolling message area).

### Task 1: The getsessionpeek interface
**Depends on:** none
**Model:** sonnet
**Files:** `pkg/agentsessions/tailmessages.go`, `pkg/wshrpc/wshrpctypes_agents.go`, `pkg/wshrpc/wshserver/wshserver_agents.go`, `pkg/wshrpc/wshclient/wshclient.go`, `frontend/app/store/wshclientapi.ts`, `frontend/types/gotypes.d.ts`

Add the command and its types (decision 1) to `wshrpctypes_agents.go`. Add `pkg/agentsessions/tailmessages.go` with
`PeekMessage` and the `ClaudeTailMessages` signature (decision 2), its body for now only the count clamp and
`return nil, false, errors.New("session peek: not implemented")`. Implement the command in `wshserver_agents.go`: the
`.jsonl` path check, the call, the conversion to `wshrpc.SessionPeekMessage`, the error wrapped as
`reading session peek: %w`. Run `task generate` and commit the generated files.

Acceptance — `go build ./pkg/... ./cmd/...` succeeds; `GetSessionPeekCommand` is in `frontend/app/store/wshclientapi.ts`
and `SessionPeekMessage` / `CommandGetSessionPeekRtnData` in `frontend/types/gotypes.d.ts`; `task check:ts` is clean.

### Task 2: The backward tail reader
**Depends on:** Task 1
**Model:** sonnet
**Files:** `pkg/agentsessions/tailmessages.go`, `pkg/agentsessions/tailmessages_test.go`, `docs/open-issues.md`

Write `ClaudeTailMessages`'s body per spec D7 and decisions 3–4:

- Reads the file backwards from its end in 64 KB chunks (`os.File.ReadAt`), splitting on `\n` and carrying a partial
  line across chunk boundaries; stops as soon as it has `n` messages. Never loads the whole file; holds one chunk,
  the carry and the messages' text.
- The bytes after the file's last `\n` (an unterminated last line, a session still writing) are ignored.
- A line longer than 256 KB is skipped unparsed: once the carry passes 256 KB, drop it and skip to the next `\n`
  boundary instead of growing it.
- Scans at most 8 MB from the end; `capped` is true when it stopped at that cap before reaching byte 0 with fewer
  than `n` messages.
- Cheap pre-filter before `json.Unmarshal`, as `claudeLastAnswer` does (skip lines with neither `"type":"assistant"`,
  `"type":"user"` nor `"queued_command"`).
- Each message's text is clipped at 1,500 characters ending in "…", keeping its line breaks (use `trimTo` only if it
  does not collapse newlines). Output is oldest first.

Measure (decision 7): `BenchmarkClaudeTailMessages` in the test file over a synthetic ~52 MB transcript (written to
`b.TempDir()`) whose tail holds long tool-result lines; record `B/op` and the time per read, and add one entry under
"## 5 · (arcterm) RAM watch" in `docs/open-issues.md`: date 2026-11-06, the numbers, that it is a per-read allocation
with nothing held between reads, and that it stands in for the spec's live wavesrv measurement.

Acceptance — `go test ./pkg/agentsessions -run 'TestClaudeTailMessages'` passes with cases for: a line far over
256 KB (skipped, the messages around it found), a file smaller than one chunk, a message that spans a chunk boundary,
an unterminated last line, the 8 MB cap (`capped` true, fewer than n returned; and false when the file start is
reached), `isMeta` and sidechain records, a non-human `origin`, a system-reminder-only prompt, task-notification and
slash-command notices, a turn with narration then a final answer (only the answer), a tool-only turn (only its
prompt), and a missing file (an error). On Windows prefix with `CGO_ENABLED=1 CC="zig cc -target x86_64-windows-gnu"`.

### Task 3: Pure Quick look model and the Esc order
**Depends on:** none
**Model:** sonnet
**Files:** `frontend/app/view/agents/launcherpeek.ts`, `frontend/app/view/agents/launcherpeek.test.ts`, `frontend/app/view/agents/launcher.ts`, `frontend/app/view/agents/launcher.test.ts`

`launcherpeek.ts` is the panel's pure model (no React, no RPC import; the fetch is injected). It declares its own
`PeekMessage { role: "user" | "assistant"; text: string; ts: number }` and `PeekResult { messages; capped }` so it
does not wait on Task 1's generated types (they are structurally the same). Exports, at least:

- `peekOffered(runtime, resume: SessionInfo | null): boolean` — true only for `claude` with a session picked (D1).
- `peekCacheKey(s: SessionInfo): string` — transcript path + `lastactivets` (D7).
- `createPeekLoader({ fetch, debounceMs = 150, cacheLimit = 20, setTimeout/clearTimeout injectable })` returning
  `{ request(session, onResult), dispose() }`: a request waits until the pick has been still for `debounceMs`; a
  request overtaken by a newer one before its fetch resolves never calls back; results (errors excluded) are cached
  by `peekCacheKey`, oldest evicted past `cacheLimit`; a cached session answers at once with no fetch; `dispose()`
  drops the cache and every pending callback (the dialog closing, D7).
- `peekView(state)` deriving D8's states: `loading` (with a `showReading` flag only after `PEEK_READING_DELAY_MS`
  = 150), `empty` ("This session has no messages yet."), `capped` with none ("No messages in the last 8 MB. Open
  asleep to read the whole session."), the capped note above the oldest message when 1–4 were found, `error` (the
  real error text), `ready`.
- `peekMeta(s: SessionInfo, now)` → `"<age> · <model> · <branch> · <tokens>"`, the age from `formatAgo` (it already
  says "ago" and "just now"), tokens from `formatTokens`, both in `agentsviewmodel.ts`; empty parts left out.
- `splitFences(text)` → segments `{ code: boolean; text }` so a fenced block draws monospace and the rest stays
  plain text with its line breaks (D8; no markdown rendering).
- `peekClosesOn(prev, next)` — true when the agent, the project, or the pick changes to New session (D6); moving
  between sessions keeps it open.

In `launcher.ts`, add an optional `peekOpen?: boolean` to `LauncherKeyCtx` (decision 5) and `"peek"` to
`LauncherInner`, and give Escape the order in decision 5. Shift+Enter keeps returning `resume-secondary` (the dialog
decides what it does); in the Task box it stays a newline.

Acceptance — `npx vitest run frontend/app/view/agents/launcherpeek.test.ts frontend/app/view/agents/launcher.test.ts`
passes, with tests for: offered only for Claude with a session; Esc closes the menus first, then Quick look, then the
dialog; the debounce (holding ↓ across 9 sessions within the window fetches once) and the drop of an overtaken read
(fake timers, a deferred fetch); the cache key, a hit with no fetch, eviction past 20, and `dispose`; each `peekView`
state including the delayed "Reading…"; `peekMeta` for a fresh session ("just now", no "ago ago"); `splitFences`;
`peekClosesOn`. `task check:ts` is clean.

### Task 4: The Quick look panel in New agent
**Depends on:** Task 1 (uses the getsessionpeek command and its generated client), Task 3 (uses launcherpeek.ts and the Esc order)
**Model:** sonnet
**Files:** `frontend/app/view/agents/launcherpeekpanel.tsx`, `frontend/app/view/agents/launchermodal.tsx`

Read `DESIGN.md` and the Prototype canvas first; match it. Colors from `@theme` tokens only.

- New `launcherpeekpanel.tsx`: the panel section (`[data-launcher-peek]`, every hook in the header list) spanning the
  dialog's width between the columns and the footer (D3). Header: eye icon (lucide `Eye`), the session's title
  (`sessionTitle` from `launcherresume.ts`), the meta line (`peekMeta`), an Open asleep button (`[data-peek-asleep]`,
  disabled as the footer's was, enabled in the error state) and a close button (`[data-peek-close]`). Body
  (`[data-peek-scroll]`): the messages, oldest top, each a label ("You" muted, "Claude" `text-accent`) beside its
  text, plain text with line breaks kept (`whitespace-pre-wrap`), fenced code monospace via `splitFences`; the
  loading, empty, capped and error states of `peekView`. Fixed ~170px tall, scrolling inside with the app's shared
  scrollbar (no scrollbar style of its own); in a short window it shrinks first, down to about two messages
  (decision 8). Scrolled to the newest message on open and on every session switch.
- `launchermodal.tsx`: for a Claude session (`peekOffered`), the footer's second button is **Quick look**
  (`[data-launcher-peek-toggle]`, hint `shift+enter`, `aria-pressed` while open) in place of Open asleep; pi/agy
  keep Open asleep and Codex keeps Transcript (D1, D2). `resume-secondary` toggles the panel when offered and keeps
  today's behavior otherwise. Pass `peekOpen` into the key context; `dismiss-inner` `"peek"` closes the panel. The
  panel follows the picked session as ↑↓ move (D6), closes per `peekClosesOn`, and Enter still resumes. One loader
  per dialog opening (decision 6), `dispose()`d on close. Open asleep from the panel calls the same
  `launchAgentRow(project, true)` path.

Acceptance — `task check:ts` is clean. At Final, the `launcher-session-peek` scenario (Task 5) shows this task's
views and interactions: step 2 (the panel with 5 messages, the toggle pressed, the Task box and columns unmoved),
step 3 (following ↓), step 4 (Reading… after the delay), steps 5–7 (empty, capped with none, capped note), step 8
(read error with Open asleep enabled), step 9 (the close button), step 10 (↑ to New session closes it), step 11 (the
short window) and step 12 (Esc order); and `launcher-resume` step 6 shows Open asleep from the panel's header.

### Task 5: CDP scenario for Quick look
**Depends on:** none
**Model:** sonnet
**Files:** `scripts/cdp/scenarios.mjs`

Add a `launcher-session-peek` scenario modeled on `launcher-resume` (its project setup, transcript dir under
`~/.claude/projects`, recent-projects and flags handling, the RPC mock-client pattern of `installTranscriptCounter`,
and teardown that removes every file it wrote), and register it in `SCENARIOS`. It uses only the DOM hooks in the
plan header. It never presses Resume or Launch. Arrange writes Claude transcripts in one project, all listed by the
session scan (each needs a real prompt with the project dir as its `cwd`; give each a distinct `lastactivets` via
mtime so their list order is known):

- **A** — 7+ turns including tool_use/tool_result records, an `isMeta` record, a sidechain record and a
  narration-then-answer turn.
- **B** — one prompt and one answer.
- **C** — listed normally; after the list loads, overwritten with only meta, sidechain and tool records (empty).
- **D** — a prompt at its start, then over 9 MB of tool-result lines each over 256 KB (capped with none).
- **E** — a few messages at its start, over 9 MB of long lines, then one prompt and one answer at the end (capped
  note with 2 found).
- **F** — listed, then deleted after the list loads (read error).

Steps, each with a screenshot:

1. Open New agent, pick Claude, click A: the footer shows Quick look (not Open asleep), not pressed.
2. Focus A's row and press Shift+Enter: `[data-launcher-peek]` has `data-peek-session` = A, `data-peek-state="ready"`,
   exactly 5 `[data-peek-msg]` (roles as written, newest last, no tool text, no meta or sidechain text, the narration
   absent), the toggle `aria-pressed="true"`, `[data-peek-scroll]` scrolled to its bottom, and `#launcher-task` and
   the Session column's top unchanged from before (±1px).
3. ↓ to B: the panel follows (`data-peek-session` = B, 2 messages), its own height unchanged.
4. Reading: wrap the RPC client so `getsessionpeek` answers after 1 s; pick another session: the header shows at
   once, no `[data-peek-reading]` at ~50 ms, `[data-peek-reading]` by ~400 ms; remove the wrapper.
5. Pick C: state `empty`, `[data-peek-empty]` reads "This session has no messages yet."
6. Pick D: state `capped`, `[data-peek-empty]` reads "No messages in the last 8 MB. Open asleep to read the whole session."
7. Pick E: 2 `[data-peek-msg]` with `[data-peek-note]` above the oldest.
8. Pick F: state `error`, `[data-peek-error]` holds a non-empty error, `[data-peek-asleep]` and Resume enabled.
9. Click `[data-peek-close]`: the panel is gone, the toggle not pressed; Shift+Enter opens it again.
10. ↑ to New session: the panel closes.
11. Short window: `Emulation.setDeviceMetricsOverride` to a height where the dialog's 86vh cannot hold everything;
    reopen the panel on A: its height is below 170px and at least ~two messages tall, and `#launcher-task`'s top and
    height and the Session column's top are unchanged from the same window with the panel closed. Restore the viewport.
12. Esc: the panel closes and the dialog stays open; Esc again closes the dialog.

In `launcher-resume`, change step 6: on a picked Claude session the footer offers Quick look
(`[data-launcher-peek-toggle]`) in place of Open asleep and Transcript (6a); Shift+Enter opens the panel and Open
asleep is clicked at `[data-peek-asleep]`; reword 6b to "Open asleep from Quick look closes the dialog and the session
is a new agent row with the moon; …"; 6c keeps its checks.

Acceptance — the scenario is registered and `node --check scripts/cdp/scenarios.mjs` passes; at Final,
`node scripts/cdp/final-verify.mjs launcher-session-peek launcher-resume` passes on the merged tree.

### Task 6: Docs
**Depends on:** none
**Model:** sonnet
**Files:** `CHANGELOG.md`, `docs/keyboard-shortcuts.md`, `docs/superpowers/specs/2026-10-28-new-launcher-declutter-design.md`

- `CHANGELOG.md`, top `Unreleased` section (open one above a dated top section), under Added: "New agent: Quick look
  shows a Claude session's last 5 messages before you resume it (Shift+Enter)."
- `docs/keyboard-shortcuts.md`, the New dialog's Shift+Enter row: in the task or goal box a new line; elsewhere, with
  a Claude session picked, Quick look (its last 5 messages; Esc closes it first); for other agents, open it asleep or
  read its transcript as today.
- Declutter spec D5: narrow it — the dialog still reads no transcript on a pick; it reads one only when the person
  opens Quick look (`2026-11-06-launcher-session-peek-design.md`).

Acceptance — the three edits are present and say what Tasks 3–4 build; no other file changes.
