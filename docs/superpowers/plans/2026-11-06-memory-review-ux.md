# Memory review, one card at a time — Implementation Plan

**Spec:** `docs/superpowers/specs/2026-11-06-memory-review-ux-design.md` (read its "Implementation decisions" section: the field names, the `SupersededBy` / `FromReview` link and the ask queue below come from it)
**Verify:** `node scripts/verify.mjs ./pkg/memhygiene/... ./pkg/consult/... ./pkg/wshrpc/... ./cmd/wsh/cmd/`
**Check:** `task check:ts && go vet ./pkg/memhygiene/... ./pkg/consult/... ./pkg/wshrpc/... ./cmd/wsh/cmd/`
**Final:** `node scripts/cdp/final-verify.mjs setup-memory`
**Prototype:** D:\src\arcterm\.superpowers\design\memory-review-ux\project\A-one-card.dc.html

**Goal:** Setup → Memory reviews one memory at a time: a queue strip and one card showing the memory's text,
Still true / Ask an agent / Delete / Keep, a Go-built reason section, an agent proposal card, and a
claude fallback when OpenRouter has no key.

**Architecture:** Go (`pkg/memhygiene`) adds the reason section, a `delete` verdict on a Review with an
Undo that reopens it, and a one-memory "Ask an agent" judge call that runs off the rpc context with a
per-project queue. The wire shape lands first (Task 1) so the Go and frontend tasks run beside each other.
The frontend keeps its pure-model pattern: `memorymodel.ts` derives the queue and the card; the views are
thin. The old table + rail stays as the "All changes as a table" view.

**Tech Stack:** Go, wshrpc + `task generate`, React 19 + jotai + Tailwind 4, vitest, CDP scenarios.

Design canvas boards (each needs a scenario step, Task 8): `A-one-card.dc.html` (the Review card) and
`A2-agent-proposal.dc.html` (the agent proposal card), in the Prototype's folder. Read both before any UI
work, and read `DESIGN.md` (tokens only, no raw colors).

Repo rules every worker follows: never hand-edit generated files (`task generate` writes them); Go tests on
Windows need `CGO_ENABLED=1 CC="zig cc -target x86_64-windows-gnu"`; the frontend typecheck is
`task check:ts` (never `npx tsc`); run only the focused tests a task names, not whole suites; commits carry
no attribution trailer.

### Task 1: Wire shape: new fields, the ask RPC and the delete verdict
**Depends on:** none
**Files:** `pkg/wshrpc/wshrpctypes_memhygiene.go`, `pkg/wshrpc/wshserver/wshserver_memhygiene.go`, `pkg/memhygiene/ask.go`, `pkg/wshrpc/wshclient/wshclient.go`, `frontend/app/store/wshclientapi.ts`, `frontend/types/gotypes.d.ts`

The interface every other task builds on. Small on purpose.

In `wshrpctypes_memhygiene.go`:
- `MemVerdict_Delete = "delete"`.
- `MemHygieneCommands` gains `AskMemoryAgentCommand(ctx, data CommandAskMemoryAgentData) error` (comment:
  starts a one-memory judge call and returns at once, like the check). `CommandAskMemoryAgentData{Project
  string "project"; ChangeId string "changeid"}`.
- `MemChange` gains, with json tags in the file's lowercase style: `Body string "body"` (the memory's text,
  frontmatter stripped; Reviews and agent proposals), `Verdict string "verdict"` (the reason section's
  sentence), `DocLines []MemDocLine "doclines"`, `Source string "source"` (`""` or `"agent"`),
  `ProposedAt int64 "proposedat"`, `FromReview string "fromreview"` (on a delete or agent proposal: the
  Review it came from), `SupersededBy string "supersededby"` (on a Review: the change that took its
  place), `AskReason string "askreason"`, `AskedAt int64 "askedat"`, `AskedBy string "askedby"` (the
  runtime that answered), `AskError string "askerror"`.
- `MemChange.Status`'s comment lists the new status `superseded` (a Review another change replaced; not
  pending). Add `MemStatus_Superseded = "superseded"` beside the verdict constants so Go and TS share it.
- `MemDocLine{Doc string "doc"; Line int "line"; Text string "text"}`.
- `MemHygieneProject` gains `Asking *MemAsk "asking,omitempty"`, `AskWaiting []string "askwaiting"`,
  `JudgedBy string "judgedby"`; `MemAsk{ChangeId string "changeid"; StartedAt int64 "startedat"; Runtime
  string "runtime"}` (the runtime the ask runs on, e.g. `claude`).
- Update the `Verdict` comment on `CommandDecideMemoryChangeData` to list `delete`.

`pkg/memhygiene/ask.go` (new): `func StartAsk(project, changeID string) error` that returns
`fmt.Errorf("memory hygiene: ask an agent is not built yet")` — Task 4 replaces the body.
`wshserver_memhygiene.go`: `AskMemoryAgentCommand` calls `memhygiene.StartAsk(data.Project, data.ChangeId)`.

Run `task generate`; commit the generated files with the change.

Acceptance: `go build ./pkg/... ./cmd/...` succeeds; `task generate` leaves no further diff; the new types
appear in `frontend/types/gotypes.d.ts` and `RpcApi.AskMemoryAgentCommand` in `wshclientapi.ts`. No tests
beyond the build: the shape is exercised by Tasks 2–8.

### Task 2: The reason section (verdict sentence and matching doc lines) on Reviews
**Depends on:** Task 1 (uses the `Verdict`, `DocLines`, `Body` fields)
**Files:** `pkg/memhygiene/reason.go`, `pkg/memhygiene/reason_test.go`, `pkg/memhygiene/review.go`, `pkg/memhygiene/review_test.go`, `pkg/memhygiene/check.go`, `pkg/memhygiene/check_test.go`, `pkg/memhygiene/evidence.go`

Spec §3. Built in Go with no model call.

Interface Task 4 relies on (keep this signature):
`func Reason(m Memory, sessions int, docs map[string]string, judgeSaw bool) (verdict string, lines []wshrpc.MemDocLine)`
- `judgeSaw` is true only when the caller knows the judge judged this exact version and proposed nothing
  (the check: `judged && seen[m.Name] == checkFingerprint(m)`; `judged=false` → always false).
- The sentence is assembled from signals already on `m`: reads (`m.Reads` of `sessions`, with "since
  <date>" when known), untouched days, whether what it names still exists / is gone (the `references`
  evidence), dated claims (`evidenceDates` evidence), how many doc lines matched and in which docs
  (base names: `AGENTS.md`, `CLAUDE.md`), and "The judge saw this version beside <docs> and proposed
  nothing." only when `judgeSaw`. Match the spec's two example sentences in shape and tone; numbers with
  thousands separators.
- Doc lines: tokens from the body's code spans, file paths and command names, reusing the path extraction
  `evidenceRepo.references` uses (`evidencePathRe`; factor a shared helper in `evidence.go` if needed,
  without changing what `references` reports). Ignore tokens shorter than 4 characters and tokens found in
  more than 10 lines of a doc. Each hit is `{Doc: <path>, Line: <1-based>, Text: <the line, trimmed>}`;
  at most 5, longest matched token first, a doc line listed once.

`ReviewChanges` gains the docs and the seen map it needs (e.g.
`ReviewChanges(inv, others, judged, now, docs, seen)`), and `reviewChange` sets `Body` (`m.Body`),
`Verdict` and `DocLines` from `Reason`. Update both call sites in `checkRun` (`check.go`): the judged path
passes `out.seen` with `judged=true`; the judge-failed path passes `judged=false`. Leave every other line
of `check.go` alone — Task 4 edits it next.

Tests (TDD), focused: `go test ./pkg/memhygiene -run 'TestReason|TestReviewChanges'`
- `TestReason_judgeSaw` / `TestReason_notSeen`: the judge clause appears only when `judgeSaw`.
- `TestReviewChanges_notJudgedSaysNothingOfTheJudge`: `judged=false` → no judge clause even when `seen`
  holds the fingerprint.
- `TestReason_docLines`: short tokens (<4 chars) ignored, a token in >10 lines of a doc ignored, at most 5
  hits, longest token first, `<doc>:<line>` correct.
- `TestReviewChanges_setsBody`: the Review's `Body` is the text without frontmatter.
Fix any existing `ReviewChanges` callers in `review_test.go` / `check_test.go` for the new parameters.

### Task 3: Delete from a Review, Undo that reopens it, Back to review
**Depends on:** Task 1 (uses `MemVerdict_Delete`, `FromReview`, `SupersededBy`)
**Files:** `pkg/memhygiene/entry.go`, `pkg/memhygiene/entry_test.go`, `cmd/wsh/cmd/wshcmd-memory.go`, `cmd/wsh/cmd/wshcmd-memory_test.go`

Spec §1 "Delete" and Implementation decision 1.

In `Decide` (`entry.go`):
- Accept `delete` (add it to the verdict list; also to `wsh memory`'s list and usage text in
  `wshcmd-memory.go`). It is valid only on an open (pending, not superseded) change of kind `review`;
  anything else is refused with `entryRefuse`.
- Delete builds a `delete` change for the Review's one memory and its MEMORY.md index line, the same
  change the judge's `delete` kind produces (reuse `judgeBuild` with a `judgeChange{Kind: "delete",
  Files: [name]}` over `ReadInventory(op.Folder)`), but with each file's hash taken from the Review's
  `Files` where the Review lists it, so a memory changed since the check is a conflict as today. Set
  `FromReview` = the Review's id and `Status` open, append it to `st.Changes`, set the Review's
  `Status = superseded` and `SupersededBy` = the delete's id, then apply it through `entryApply` (backup,
  `ApplyId`, `BackupUntil`). A conflict leaves the delete change in `conflict` status, as any apply does,
  and the Review stays superseded behind it (the conflict card is what to read next).
- `superseded` is not pending: `Pending` (`split.go`) already tests status only, so it needs no change;
  every caller (rail counts, jarvisvolunteer's `pendingChanges`) stops counting a superseded Review.
- Undo of a change with `FromReview` whose kind is `delete`: after the files are restored as today, remove
  that change from `st.Changes` and set the Review back to `open` with `SupersededBy` cleared. If the
  Review is no longer in `st.Changes` (a check dropped it), the delete change stays, open, as today's undo.
- Keep of a pending change with `FromReview` (Back to review on an agent proposal): today's Keep (status
  `kept`), and set the Review back to `open` with `SupersededBy` cleared.
- Put the small helpers Task 4 reuses in this file: `entrySupersede(st, review, by *wshrpc.MemChange)` and
  `entryRestoreReview(st, reviewID)`.
- `checkRemeasure` runs after each, as today.

Tests (TDD), focused: `go test ./pkg/memhygiene -run 'TestDecideDelete|TestDecideKeepFromReview'` and
`go test ./cmd/wsh/cmd -run 'TestMemory'` (only if you touched its parsing). Use the existing test seams
(`claudeHomeFn`, `registryFn`, a temp state dir — see `helpers_test.go`, `check_test.go`):
- `TestDecideDelete_appliesWithBackup`: the memory file and its index line are gone, the delete change is
  `applied` with an `ApplyId`, the Review is `superseded` with `SupersededBy`, and `Pending` is false for it.
- `TestDecideDelete_undoReopensReview`: Undo restores both files byte-identical, removes the delete change,
  and the Review is open with `SupersededBy == ""`.
- `TestDecideDelete_undoAfterReviewDropped`: with the Review removed from the state, Undo restores the
  files and leaves the delete change open.
- `TestDecideDelete_conflict`: memory edited after the check → delete change `conflict`, files untouched.
- `TestDecideDelete_refusedOnNonReview`.
- `TestDecideKeepFromReview_restoresReview`.

### Task 4: Ask an agent (one-memory judge call, queue, merge rule)
**Depends on:** Task 2 (uses `Reason` and edits `check.go` after it), Task 3 (edits `entry.go` after it)
**Files:** `pkg/memhygiene/ask.go`, `pkg/memhygiene/ask_test.go`, `pkg/memhygiene/judge.go`, `pkg/memhygiene/judge_test.go`, `pkg/memhygiene/check.go`, `pkg/memhygiene/check_test.go`, `pkg/memhygiene/entry.go`

Spec §2 and Implementation decisions 4–6.

`judge.go`:
- Move `JudgePrompt`'s body into `judgePrompt(inv, batch, docs, docTarget string, explain bool)`;
  `JudgePrompt` calls it with `explain=false` and its output stays byte-identical. With `explain`, the
  prompt also asks for a top-level `"fine": [{"memory": "<name>", "reason": "<one sentence>"}]` for a
  memory it leaves unchanged, and that each change's `title` be the one-sentence reason.
- `ParseJudge` keeps its signature; it wraps `parseJudge(reply, inv, docTarget) ([]wshrpc.MemChange,
  []judgeFine, error)` that also reads `fine` (empty when absent; reuse `judgeExtract`, tolerating a reply
  with only `changes`).

`ask.go` — replace the Task 1 stub:
- `StartAsk(project, changeID)`: refuse when the project is `Checking`, when the change isn't an open
  Review (or is superseded), or when it is already asking / waiting. Otherwise, in one `Update`: if no live
  ask (`Asking == nil`, or `StartedAt` older than `checkTimeout`, which also drops the stale
  `AskWaiting`), set `Asking{changeID, now, Runtime: consult.HeadlessRuntime()}` (Task 5 replaces it with
  the runtime after its fallback) and clear the Review's `AskError`; else append to
  `AskWaiting`. Start the per-project worker goroutine if none runs (a mutex-guarded map); return at once.
- The worker (with `panichandler`, like `entryRun`): for the current id, resolve the project as `checkRun`
  does (`Discover`, `checkInventory`, `InstructionDocs`, `DocTarget`), find the memory, run
  `runModel(ctx, judgePrompt(inv, []Memory{m}, docs, docTarget, true))` under a `checkTimeout` context,
  `parseJudge`, then `Validate`. Then in one `Update`:
  - a change came back: store it with `Source "agent"`, `ProposedAt`, `FromReview` = the Review's id,
    `Body` = `m.Body`, and `Verdict`/`DocLines` from `Reason(m, inv.Sessions, docs, false)`; supersede
    the Review with Task 3's `entrySupersede`; leave `Seen` alone.
  - nothing came back: set the Review's `AskReason` (the `fine` reason for that memory, or "nothing to
    change" when absent), `AskedAt` and `AskedBy` (`Asking.Runtime`), and write
    `State.Seen[m.Name] = checkFingerprint(m)`.
  - error: set the Review's `AskError` to the error text.
  Clear `Asking`, pop the next id from `AskWaiting` into `Asking` (or stop the worker when empty).
- Ask while one runs in the same project queues; a different project runs its own.

`check.go`: in `checkMerge`, an open `Source == "agent"` change in `cur` whose files are unchanged is kept,
and fresh changes (judge proposals or Reviews) on the same memory paths are dropped in its favour; an agent
proposal whose file hash changed is dropped. A superseded Review stays (still superseded) while its
superseding change stays, and is dropped with it.
`entry.go`: `entryBegin` refuses a check while a live ask runs or waits ("memory hygiene: <project> is
asking an agent").

Tests (TDD), focused: `go test ./pkg/memhygiene -run 'TestJudgePrompt|TestParseJudge|TestAsk|TestCheckMerge|TestEntryBegin'`, stubbing `runModel` as `check_test.go` does:
- `TestJudgePrompt_withoutExplainUnchanged`: `JudgePrompt` equals a golden string captured before the edit.
- `TestParseJudge_readsFine`.
- `TestAsk_proposalReplacesReview` (Source, FromReview, SupersededBy, Seen untouched),
  `TestAsk_nothingProposedWritesSeenAndReason`, `TestAsk_errorStoredOnReview`,
  `TestAsk_queuesSecond`, `TestAsk_refusedWhileChecking`, `TestEntryBegin_refusedWhileAsking`,
  `TestAsk_staleMarkerIgnored`.
- `TestCheckMerge_agentProposalSurvivesUnchangedHashes`, `TestCheckMerge_agentProposalDropsOnChangedHash`.

### Task 5: claude fallback when OpenRouter has no key
**Depends on:** Task 4 (edits `check.go` and `ask.go` after it)
**Files:** `pkg/memhygiene/model.go`, `pkg/memhygiene/model_test.go`, `pkg/consult/openrouter.go`, `pkg/consult/openrouter_key_test.go`, `pkg/memhygiene/check.go`, `pkg/memhygiene/ask.go`

Spec §4 and Implementation decision 8.

- `pkg/consult/openrouter.go`: export `OpenRouterKeyConfigured() (bool, error)` reading the same secret
  `RunWithUsage` reads (`openRouterSecretName`) through a package seam `var getSecretFn =
  secretstore.GetSecret`, and use it in `RunWithUsage` too so there is one source of truth.
- `model.go`: two package seams, `var headlessRuntimeFn = consult.HeadlessRuntime` (it reads the wconfig
  watcher, which tests can't set) and `var openRouterKeyFn = consult.OpenRouterKeyConfigured` (the secret
  store), and `func modelSpec() (spec consult.RuntimeSpec, runtime, judgedBy string, err error)`: when
  `headlessRuntimeFn()` is `openrouter` and `openRouterKeyFn()` says no key, return
  `consult.SpecForTier("claude", consult.TierCapable)`, `runtime = "claude"`,
  `judgedBy = "claude (OpenRouter has no key)"`; otherwise `HeadlessSpecForTier(TierCapable)`, the
  headless runtime's name and `""`. A key read error is returned, not swallowed. `runModel` uses it, still
  through `modelNoTools`; its signature is unchanged. Add `modelRuntime() (runtime, judgedBy string)` (logs
  and returns the headless runtime and "" on error) for the store sites.
- `check.go` (`checkStore`) sets `st.JudgedBy` when the model ran; `ask.go` sets `Asking.Runtime` from
  `modelRuntime()` instead of `consult.HeadlessRuntime()`, and `st.JudgedBy` after the ask's model call.
  `LastError` is set only when the fallback run fails too (today's path).
- Other `consult` users (jarvis classify, jarvisvolunteer, jarviscontinuity, pititle) are untouched.

Tests (TDD), focused: `go test ./pkg/memhygiene -run 'TestModelSpec'` and `go test ./pkg/consult -run 'TestOpenRouterKeyConfigured'`:
- `TestModelSpec_openrouterWithoutKeyFallsBackToClaude` (set `headlessRuntimeFn` and `openRouterKeyFn`),
  `TestModelSpec_openrouterWithKeyUnchanged`, `TestModelSpec_claudeRuntimeUnchanged`,
  `TestModelSpec_keyReadErrorReturned`, and `TestOpenRouterKeyConfigured` (stub `getSecretFn`: present,
  absent, read error).

### Task 6: The queue and card view-model
**Depends on:** Task 1 (uses the new fields in `gotypes.d.ts`)
**Files:** `frontend/app/view/agents/memorymodel.ts`, `frontend/app/view/agents/memorymodel.test.ts`

Pure functions only; Task 7 renders them. Exported interface Task 7 relies on (names fixed, details yours):
- `type MemoryView = "cards" | "table"`; `defaultMemoryView(p): MemoryView` — `"table"` when
  `p.sharedwith?.length`, or an open change has a split group or kind `remove-shared` / `settings`;
  else `"cards"`.
- A superseded Review has `status === "superseded"`; today's `isPending` already returns false for it, so
  the rail counts, `checkResult` and the Setup badge need no change — add a test proving they skip it.
  `statusOf` gives it a label for the table view ("Replaced").
- `memoryQueue(p, now): QueueRow[]` with `QueueRow { id, title, status: string, tone, decided: boolean }`:
  every change except superseded ones; open ones first in today's `changeOrder`, then the decided ones
  (applied, kept) decided since the last check (`decidedat >= p.checkedat`), greyed. Status lines: Review
  `Untouched N days` (or `N findings`, from `effect`), agent proposal `Agent proposes: <kind label>`,
  asking `Asking <p.asking.runtime>…`, waiting `Waiting to ask…`, decided `Deleted · Undo` /
  `Applied · Undo` / `Still true` / `Kept`.
- `askState(p, changeId, now): "asking" | "waiting" | "idle"` — a marker older than 30 minutes reads
  `idle` (the check timeout).
- `stepQueue(p, id, delta)` and `nextOpenInQueue(p, id)` over `memoryQueue` order (j/k and advance;
  `nextOpenInQueue` works when `id` is a superseded Review no longer in the queue, using its old place).
- `selectAfterUndo(p, undoneId): string | null` — after an Undo, the id to show: the `fromreview` Review
  when the undone change is gone and that Review is open again, else `undoneId`.
- `pickCard(p, id): MemChange | null` — the shown card's change: `id` when it is in the queue, else the
  first open queue item, else `null` (the done card).
- `doneCard(p, now)` — "Nothing to review in <project>" with the next check time, for when `pickCard`
  is `null` (empty or all decided).
- `memoryCard(p, change, now): CardModel` — chip label, head line (`Untouched 30 days, since <date>` for a
  Review; `Proposed by the agent, <time>` for an agent proposal), title, file line (`<file> · <type>`),
  body kind (`"text"` with `change.body` for a Review, `"proposal"` with the reason paragraph (`title`)
  then diffs for an agent proposal, `"diff"` otherwise), the buttons in order with their key, primary /
  danger flags and disabled state (Review: Still true `a`, Ask an agent…, Delete `d`, Keep as is `x`;
  agent proposal: Apply `a`, Talk it over with an agent, Back to review `x`; other kinds: their
  `applylabel` `a`, Keep as is `x`; decided: Undo `u` or Reopen `u`), the hint text from the spec, the
  status line under the buttons (`Asking claude…` or the `askerror` in warning tone), and the reason
  section (`verdict`, the ask line `Asked <askedby> at HH:MM: <askreason>` when `askedat`, `doclines`,
  `evidence` for Details). Ask disabled while `p.checking` or the card is asking/waiting; all buttons
  disabled while asking.
- `cardKeyAction(card, key): "apply" | "delete" | "keep" | "undo" | "reopen" | null`.
- `checkNowBlocked(p, now): string | null` — `"Waiting for Ask an agent"` while an ask runs or waits.
- `judgedByText(p): string` — `"judged by " + p.judgedby` when set, else `""`.
- `talkItOverTask(p, change): string` — memory path and text, the project's AGENTS.md path, the proposal
  (kind, note, diffs as unified lines), and the instruction that the agent edits files itself.

Tests (vitest), focused: `npx vitest run frontend/app/view/agents/memorymodel.test.ts` — queue order (open
before decided, superseded hidden, decided before the last check left out), rail counts and the badge
skip a superseded Review, `selectAfterUndo`, `pickCard` falling to the done card, status lines per state, default view for split/shared vs plain,
which card shows for Review / agent proposal / other / applied delete, button order and disabled states
while checking and asking, the key map on Review vs proposal cards, stale ask marker, the talk-it-over
task text. Keep the existing tests passing.

### Task 7: The card view, queue strip, actions and keys
**Depends on:** Task 6 (renders its view-model)
**Files:** `frontend/app/view/agents/setupmemory.tsx`, `frontend/app/view/agents/memorycard.tsx`, `frontend/app/view/agents/memoryparts.tsx`, `frontend/app/view/agents/memorystore.ts`, `frontend/app/store/keybindings/bindings.ts`, `docs/keyboard-shortcuts.md`, `CHANGELOG.md`

Match boards A and A2 of the Prototype. `DESIGN.md` tokens only.

- `memorystore.ts`: `MemVerdict` gains `"delete"`; `memoryViewAtom` (per project, an `atom<Record<string,
  MemoryView>>`) with `memoryViewOf(p)` falling back to `defaultMemoryView(p)` and `setMemoryView`;
  `askMemoryAgent(project, changeId)` calling `RpcApi.AskMemoryAgentCommand` then `loadMemory()`, errors to
  `memoryErrorAtom`; in the card view, after Delete, Still true, Keep or Apply the selection moves to
  `nextOpenInQueue` (after Delete the shown Review is superseded, so advance from it, not stop on it); the
  delete's row stays `Deleted · Undo` and `k` returns to its card. After Undo the selection is
  `selectAfterUndo` (the reopened Review for a Delete). The table view keeps `nextPending`; `talkItOver(p, change)` calls `launchAgent`
  (`@/app/cockpit/cockpit-actions`) with `runtime: "claude"`, `runtimeStartupCommand("claude")`,
  `task: talkItOverTask(p, change)`, `projectPath: p.path`, `projectName: p.project`, without switching
  surface (see `councilsummary.tsx` around its `launchAgent` call for the model and pattern).
- `memorycard.tsx` (new): `MemoryQueue` (280px strip, "To review · N in <project>", two-line titles, status
  line, accent inset on the selected row, decided rows greyed, "All changes as a table" at the foot) and
  `MemoryCard` (max-width ~900px, scrolls; head, body on the sunken background — a Review's text as
  markdown with code spans via the existing `MarkdownMessage` / `InlineMarkdown` in `view/agents/`, never
  truncated; buttons right under the body; status line; hint; reason section with the verdict sentence,
  the ask line, doc lines as `<doc>:<line>` + line in monospace, and the evidence rows under a "Details"
  disclosure closed by default), and the done card from `doneCard` when `pickCard` is `null`.
- `memoryparts.tsx` (new): move `DiffBlock`, `KindChip`, `ConflictAlert`, `Dot` and the shared class
  constants out of `setupmemory.tsx` into it; both `setupmemory.tsx` and `memorycard.tsx` import from it,
  and neither imports the other's components (no import cycle; `setupmemory.tsx` imports `memorycard.tsx`).
- Add `data-memory-*` attributes the scenario needs (`data-memory-card` is already the index meter card in
  `setupmemory.tsx`; don't reuse it): `data-memory-queue`, `data-memory-queue-row` (+ `data-selected`,
  `data-decided`), `data-memory-review-card` (+ `data-card-kind` = `review|proposal|change|done`),
  `data-memory-card-action="<action>"` on each button, `data-memory-card-status` (the line under the
  buttons, + `data-tone`), `data-memory-reason`, `data-memory-ask-line`, `data-memory-doclines`,
  `data-memory-judged-by`, `data-memory-view-toggle`.
- `setupmemory.tsx`: `ProjectPane` keeps its header line (checked at, counts, next check, the MEMORY.md
  meter, Check now) and adds `judgedByText(p)`; Check now is disabled with the tooltip from
  `checkNowBlocked`. Below it, the card view (`MemoryQueue` + `MemoryCard`) or today's `ChangeTable` +
  `ChangeDetail` per `memoryViewOf(p)`; the table view gets a "Review one at a time" link back. The table
  view is otherwise unchanged.
- `bindings.ts` (`buildMemoryBindings`): add `d` "Delete the memory" (card view, open Review only); in the
  card view `j`/`k`/arrows step through `stepQueue` and `a`/`x`/`u`/`d` follow `cardKeyAction` on the
  shown card; the table view keeps today's behaviour. Mirror in `docs/keyboard-shortcuts.md` ("Setup:
  Memory tab").
- `CHANGELOG.md`: under the top section's `Changed`: "Setup → Memory reviews one memory at a time, with its
  text, Delete and Ask an agent."

Acceptance: `task check:ts` clean; `npx vitest run frontend/app/view/agents/memorymodel.test.ts` passes;
the views are shown by Task 8's scenario steps `setup-memory-review-card` (with the judged-by header and
the ask line), `setup-memory-agent-proposal`, `setup-memory-asking`, `setup-memory-ask-error`,
`setup-memory-conflict-card`, `setup-memory-delete-undo`, `setup-memory-done-card` and
`setup-memory-table-view` (Task 8 adds them; keep the `data-memory-*` attributes above stable for it). Before completing, try the card view in the dev app if
you can (`cdp-shot.mjs`); otherwise say so in your report.

### Task 8: CDP scenario steps for the cards
**Depends on:** Task 7 (drives its `data-memory-*` attributes), Task 3 (Delete → Undo runs the real verdict)
**Files:** `scripts/cdp/memory-fixtures.mjs`, `scripts/cdp/memory-fixtures.test.mjs`, `scripts/cdp/scenarios.mjs`

Extend the `setup-memory` scenario (`scripts/cdp/scenarios.mjs`, around its existing steps) and its fixture
(`memory-fixtures.mjs`, which writes state files with real hashes). Never run prettier on `.mjs` files.

- Fixture (seeded state, never a model call): on the plain project set `judgedby: "claude (OpenRouter has
  no key)"`; give its first Review a `body`, `verdict`, two `doclines`, and `askreason` / `askedat` /
  `askedby: "claude"`; add a second memory with a seeded agent proposal (`source: "agent"`, `fromreview` →
  its Review, which gets `status: "superseded"` and `supersededby`; a `move-to-doc` change with diffs for
  AGENTS.md, the memory file and MEMORY.md, as `ParseJudge` would build it); a third Review with a recent
  `asking` marker (`runtime: "claude"`); a fourth Review with an `askerror`; and a trim change in
  `conflict` status with a `conflictfile`. Add a second plain project (a new `MEMORY_PROJECTS` entry) whose
  only change is applied, for the done card. Keep `checkedat` before the decided items' `decidedat` so they
  show in the queue. Update `memory-fixtures.test.mjs` for the new shape.
- The card view is now the default for the plain project: existing steps that test the table (Apply all,
  the split, keys in the table) switch to the table view first (`data-memory-view-toggle`) or select the
  split project, which opens in the table by default. Keep every existing step passing.
- The existing step-1 assert counting `[data-memory-card]` (the index meter) stays as it is; the new card
  is `[data-memory-review-card]`.
- New steps, each with a shot and asserts:
  - `setup-memory-review-card` (board A): queue strip with N rows (the superseded Review not among them),
    the Review card with its text, the four buttons in order, the reason section's verdict sentence, the
    ask line `Asked claude at …`, the doc lines, Details closed, and the header's `judged by claude
    (OpenRouter has no key)`.
  - `setup-memory-agent-proposal` (board A2): select the proposal row; chip `Move to AGENTS.md`, "Proposed
    by the agent", the reason paragraph, the three diffs, Apply / Talk it over / Back to review. Do not
    click Talk it over (it launches a real agent).
  - `setup-memory-asking`: the asking row reads `Asking claude…`, its card's status line says the same and
    its buttons are disabled.
  - `setup-memory-ask-error`: the fourth Review's card shows the `askerror` line in the warning tone, and
    Ask an agent is enabled.
  - `setup-memory-conflict-card`: the conflict change's card shows `ConflictAlert` naming the file.
  - `setup-memory-delete-undo`: on a Review card press `d`; the memory file is gone on disk, the selection
    moved to the next open card, and the queue row reads `Deleted · Undo` (greyed). Press `k` (or click
    that row): the card shows the applied delete with Undo; record its `applyid` from the state file for
    teardown. Press Undo: the Review card is back, open and selected, and the file is restored
    byte-identical.
  - `setup-memory-done-card`: select the second plain project; the card reads "Nothing to review in
    <project>", and its decided row is in the queue.
  - `setup-memory-table-view`: "All changes as a table" shows today's table; "Review one at a time" returns.

Acceptance: `npx vitest run scripts/cdp/memory-fixtures.test.mjs` passes; the plan's Final runs the
scenario, so don't run `final-verify.mjs` yourself. If you can, run `task verify:ui -- setup-memory`
against a dev app once; otherwise say in your report it was not run.
