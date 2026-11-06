# Memory review, one card at a time

Setup → Memory is hard to review with. Four problems, all confirmed by the person:

1. The detail rail shows no memory content. A Review's only diff is the frontmatter `modified` date
   (`pkg/memhygiene/review.go`, `ReviewChanges`).
2. Keep / Still true are the only actions. Deleting, trimming or moving a memory means leaving the
   screen.
3. The Why rows (`evidence.go`) don't answer the two questions that matter: is the memory still
   needed, and is it already in AGENTS.md?
4. The layout is cramped. The table has fixed columns (`TABLE_GRID` 148px / 1fr / 128px / 92px in
   `setupmemory.tsx`), the detail rail is clamped (`DETAIL_RAIL_WIDTH`), titles wrap, and the Verdict
   buttons sit at the bottom of the rail, far from what they decide.

Design canvas: `.superpowers/design/memory-review-ux/project/` (boards `A-one-card.dc.html` and
`A2-agent-proposal.dc.html`). The rejected layouts are in `unchosen/`.

## 1. One card at a time

The Memory tab's project pane becomes a review flow instead of a table plus a rail:

- **Project rail** (left, unchanged).
- **Queue strip** (280px). "To review · N in <project>" lists every open change of the selected
  project in the current order: Review cards, and trim / merge / split / move-to-doc / delete changes
  from the model check. Each row shows the memory title on up to two lines and one status line
  (`Untouched 30 days`, `3 findings`, `Agent proposes: move to AGENTS.md`, `Asking claude…`). The
  selected row has the accent inset. At the foot, **All changes as a table** switches the pane back to
  today's `ChangeTable` + `ChangeDetail`. That view stays as it is, for bulk groups (`ApplyAll`) and the
  split. The choice is remembered in a jotai atom, since the surface unmounts.
- **Decided items stay in the queue** (Agent's call). After Still true, Delete, Keep or Apply, the card
  moves to the next open item, as `nextPending` does today. The decided item stays in the queue below
  the open ones, greyed, with its status line (`Deleted · Undo`, `Still true`, `Kept`), until the next
  check rebuilds the list. `j`/`k` reach it, and its card shows the applied or kept state with Undo or
  Reopen, as `ChangeDetail` does today.
- **Split and shared-folder projects open in the table** (Agent's call). A project with `SharedWith`
  (or an open split / remove-shared / settings change) opens in today's table view by default, with a
  "Review one at a time" link to the card view. `ReviewChanges` doesn't run for those projects, and the
  split's groups, `switchGate` and `OwnIndexDelta` stay in the table. The card view renders a split
  change as a plain card (diff + apply label), with no group headers.
- **The card** (the rest, `max-width` ~900px). The pane header line stays above it: checked at,
  counts, next check, `MEMORY.md n of 200 lines · x of 25 KB`, and Check now.

Every change kind renders as a card: kind chip, title, file name and kind, then the body (below), then
its buttons right under the body, then a one-line hint, then the reason section. A non-Review change
shows its diff as the body, its own apply label (`ApplyLabel`) as the primary button, and Keep as is.

### The Review card (board A)

- Head: `Review` chip, `Untouched 30 days, since <date>`, the title, `<file> · <type>`.
- Body: the memory's text (frontmatter stripped), rendered as markdown with code spans, on the
  sunken background. It is never truncated: the card scrolls.
- Buttons, in this order: **Still true** (primary, today's apply of a Review), **Ask an agent…**,
  **Delete** (danger text), **Keep as is**. Keys: `a` still true, `d` delete, `x` keep, `j`/`k` move
  through the queue, as today plus `d`.
- Hint: "Ask an agent proposes one change for this memory (move into AGENTS.md, trim, delete or still
  true) that you Apply with Undo. Delete keeps a copy you can undo."
- Reason section (§3).

### Delete

Delete applies a `delete` change for that one memory and its MEMORY.md index line, through the
existing `Apply` (`apply.go`), so it has a backup and Undo like every applied change. No confirm
dialog. The card shows the applied state with Undo, as applied changes do today, and the queue moves
to the next card.

Backend: a new verdict, or a new command, builds the delete change from the Review's memory at decide
time, with the hashes from the Review's `Files` (a file changed since the check is a conflict, as
today).

Undo of a Delete made from a Review brings the Review back (Agent's call). The delete change records
the Review it came from. On Undo, the files are restored as today, the delete change is removed, and
the Review reopens. The queue then shows the Review card, not an open "Delete" card.

## 2. Ask an agent (board A2)

**Ask an agent…** runs the memhygiene judge on that one memory: `JudgePrompt(inv, []Memory{m}, docs,
docTarget)` (`judge.go:124`) through `runModel`, the same no-tools call the check makes, then
`ParseJudge` (`judge.go:238`) and `Validate`. It runs off the RPC context, like `StartCheck`
(`entry.go:37`): the command returns at once and the result reaches the project's state.

**Where the reason comes from** (Agent's call). `JudgePrompt` takes an `explain` option, which only Ask
sets, so the weekly check's prompt and its tests stay as they are. With it, the prompt asks for an extra
top-level `"fine": [{"memory": "<name>", "reason": "<one sentence>"}]` for a memory it leaves
unchanged, and asks that each change's `title` be the one-sentence reason. `ParseJudge` returns the
`fine` list next to the changes (empty when it is absent). The proposal card's body shows the change's
`title` as the judge's reason. The fixed `judgeNote` line (`judge.go:385`) stays in the hint area,
where it is today.

**Asks and checks don't overlap** (Agent's call):
- Ask an agent runs one memory at a time per project. A second Ask while one runs is queued in
  memory, and its row reads `Waiting to ask…`.
- The project's state stores an `Asking` marker (change id and start time) on `MemHygieneProject`, so
  the queue row survives the surface unmounting. A marker older than the check timeout is treated as
  failed.
- Ask is disabled while `Checking`. Check now is disabled while an ask runs or waits, with the
  tooltip "Waiting for Ask an agent".
- A proposal from Ask is stored with `Source: "agent"`. `checkMerge` keeps an open agent proposal
  through a later check unless one of its files' hashes changed. It is not replaced by that check's
  rebuilt Review.

- While it runs, the card's buttons are disabled and a line under them reads `Asking claude…` (or the
  runtime's name). The queue row says the same. The person can press `j` and review other cards
  meanwhile.
- **A change comes back** (move-to-doc, trim, merge, delete): it is stored as an open change on that
  memory. It takes the Review's place in the queue, the Review leaves, and the card shows it:
  - Head: the kind chip (`Move to AGENTS.md`), `Proposed by the agent, <time>`, the title and file.
  - Body: the change's `title` (the judge's one-sentence reason, see above) as one paragraph, then its diffs (`MemDiff`, every
    file the change touches: AGENTS.md section, the memory file deleted, the MEMORY.md line removed).
  - Buttons: **Apply** (primary, `a`), **Talk it over with an agent**, **Back to review** (`x`, which
    drops the proposal and restores the Review).
  - Hint: "Apply keeps a copy of all three files, with Undo. Talk it over opens a Claude agent with
    this memory, AGENTS.md and the proposal; it edits the files itself, outside Undo."
- **The judge proposes nothing** (the memory is fine): the Review card comes back with the judge's
  one-line reason from `fine` at the top of the reason section ("Asked claude at 12:58: still needed,
  nothing in AGENTS.md covers it"). The reason is stored on the Review. The person still decides Still
  true or Keep.
- **What an ask writes to `Seen`** (Agent's call). An ask that proposes nothing writes the memory's
  current fingerprint to `State.Seen`, exactly as a check would after judging it: it was judged beside
  the same docs. So the verdict sentence can say the judge saw it, and the next weekly check skips it
  through the hash gate until the file changes. An ask that returns a proposal leaves `Seen` alone.
- **Back to review** is Keep on the proposal (Agent's call): the change takes today's `kept` status,
  which today's `checkMerge` / `checkInPlay` rules already handle, and the Review reopens beside it. It is
  not a new status.
- **The call fails**: the card shows the error line in the warning tone (the model's own error text)
  and Ask an agent becomes available again.

**Talk it over with an agent** launches a Claude agent through the existing `launchAgent` with a task
(as `councilsummary.tsx:1091` and `initiativeworkaction.ts:72` do), in the project's directory. The
task holds the memory's path and text, the project's AGENTS.md path, and the proposal (kind, note,
diffs). It does not switch surfaces: the agent appears in the Agent tree and the Agent nav badge. The
agent edits files directly, outside memhygiene's Undo, and the hint says so. Once the files change,
the change's hashes no longer match, so Apply reports a conflict as today. Check now rebuilds the
cards.

## 3. The reason section

It is built in Go with no model call, next to the existing evidence (`evidence.go`), and sent on the
`MemChange` (new fields; then `task generate`):

1. **One verdict sentence**, assembled from the signals already gathered: reads (`evidenceReads`),
   untouched days, whether what it names still exists (`references`), dated claims (`evidenceDates`),
   how many instruction-doc lines match (item 2), and whether the judge has seen it. Only say the
   judge saw it when `State.Seen[name]` holds the memory's current fingerprint, i.e. a check judged
   this version beside the docs and proposed nothing. `ReviewChanges` also builds Reviews when the
   judge did not run (`judged=false`, `review.go:48`), and then the sentence says nothing about the
   judge. Examples:
   - "Read in none of 1,149 sessions since Oct 7, and AGENTS.md names the same command in 2 places.
     The judge saw this version beside AGENTS.md and proposed nothing."
   - "Read in 4 of 1,149 sessions; nothing in AGENTS.md or CLAUDE.md names what it names."
2. **Matching instruction-doc lines**: take the memory body's code spans, file paths and command
   names (reuse the extraction in `evidenceRepo.references`, `evidence.go:211`), look each up in the
   texts `InstructionDocs` returns (`evidence.go:545`: AGENTS.md / CLAUDE.md), and list the hits as
   `<doc>:<line>` plus the line, monospace, at most 5, longest token match first. Ignore tokens shorter
   than 4 characters, and ones that appear in more than ~10 lines of a doc.
3. The existing evidence rows stay available, folded under a "Details" disclosure, closed by default.

The reason section sits below the buttons, so the buttons stay right under the content.

## 4. Model runtime without a key

memhygiene's `runModel` (`model.go:18`) uses `consult.HeadlessSpecForTier(TierCapable)`. When the
headless runtime is `openrouter` and no OpenRouter key is configured (the error from
`consult/openrouter.go:42`), memhygiene alone falls back to the `claude` headless spec, still through
`modelNoTools` (no tools, init event checked). This applies to the weekly check, Check now and Ask an
agent. The shared `headless:runtime` setting is not changed, so jarvis classify, jarvisvolunteer,
jarviscontinuity and pititle keep their behaviour.

The pane header says which runtime judged: `judged by claude (OpenRouter has no key)` when the
fallback ran, nothing extra otherwise. `LastError` is only set when the fallback fails too.

## Out of scope

- No change to how the check picks memories (`checkJudge` fingerprints) or to the other kinds' rules.
- No in-place editor for the memory file.
- No change to the table view beyond the link that reaches it.

## Verification

- Go: tests for the verdict sentence (seen vs not seen, judged=false), the doc-line matcher (short
  tokens, common tokens, the 5 cap), the single-memory judge path (proposal stored, Review replaced;
  nothing proposed; error), the delete-from-review verdict (backup, Undo, conflict), and the
  OpenRouter-without-key fallback (fake spec). Also: `JudgePrompt` without `explain` is byte-identical
  to today's; `ParseJudge` reads `fine`; an ask's empty result writes `Seen`; Undo of a Review's
  Delete reopens the Review; an agent proposal survives a check whose hashes match and drops when they
  don't; Ask is refused while `Checking`, and Check now while `Asking`.
- Frontend: the queue and card view-model in a pure `memorymodel.ts` function with vitest (queue order,
  which card shows for each state, key map on Review vs proposal cards).
- CDP: extend the `setup-memory` scenario (`scripts/cdp/scenarios.mjs`) with steps that shoot the
  Review card (board A) and a card with an agent proposal (board A2; seed the proposal in the fixture
  state rather than calling a model), plus Delete → Undo.
- CHANGELOG `Changed` line: Setup → Memory reviews one memory at a time, with its text, Delete and Ask
  an agent.

## Implementation decisions (lead, autonomous run 150ea1e1)

Calls made where the spec leaves the shape open, each with why.

1. **A replaced Review takes the status `superseded`** (the person's call, plan review round 1), with
   `SupersededBy string` naming the change that took its place; that change carries `FromReview string`.
   Delete-from-review and an Ask proposal both set the pair. `superseded` is not pending, so every
   existing `Pending` / `isPending` caller (rail counts, the Setup badge, `checkResult`, jarvisvolunteer)
   stops counting it with no change. Undo of a delete with `FromReview` removes the delete change and sets
   the Review back to `open` with `SupersededBy` cleared; Keep on an agent proposal with `FromReview`
   (Back to review) does the same to the Review. If a check has since dropped the Review (its memory file
   changed or was deleted), Undo leaves the delete change open, as an undo does today. Why: one mechanism
   serves Delete→Undo and Back to review, the Review keeps its id and evidence, and no pending-count
   caller has to learn about the link.
2. **Wire fields on `MemChange`**: `Body` (memory text, frontmatter stripped; Reviews and agent proposals),
   `Verdict` (the §3 sentence), `DocLines []MemDocLine{Doc, Line, Text}` (§3 item 2), `Source`
   (`""` or `"agent"`), `ProposedAt` (unix ms), `AskReason` / `AskedAt` (the judge's `fine` reason stored
   on the Review), `AskedBy` (the runtime that answered, for "Asked <runtime> at HH:MM"), `AskError` (a
   failed ask's error, on the Review). On `MemHygieneProject`:
   `Asking *MemAsk{ChangeId, StartedAt, Runtime}` (Runtime is the runtime the ask runs on, after the §4
   fallback; the person's call, plan review round 1), `AskWaiting []string` (change ids queued behind it) and
   `JudgedBy string` (`""`, or `claude (OpenRouter has no key)` after the fallback). Why: everything
   the card shows survives the surface unmounting, read from the one list call.
3. **New RPC `AskMemoryAgentCommand{project, changeid}`**, returning at once like
   `CheckMemoryHygieneCommand`; **Delete is a new verdict `delete`** on `DecideMemoryChangeCommand`, valid
   only on an open Review. Why: the ask runs a model call off the rpc context; delete is one synchronous
   apply like the other verdicts.
4. **The ask queue lives in a per-project goroutine in `pkg/memhygiene/ask.go`**; `AskWaiting` mirrors it
   in the state for display. A marker older than `checkTimeout` (and the waiting ids behind it) reads as
   failed: `StartAsk` and `entryBegin` ignore it and the frontend shows Ask as available again. Why: the
   spec says queued in memory; a restart loses the goroutine, and the timeout rule already covers it.
5. **`JudgePrompt` keeps its signature and output**; an unexported `judgePrompt(…, explain bool)` holds
   the body and `ParseJudge` likewise wraps a `parseJudge` that also returns `fine`. Why: the weekly
   check's call sites and tests stay byte-identical, as the spec requires.
6. **`checkMerge`: an open `Source:"agent"` change whose files are unchanged is kept, and a fresh
   proposal or Review on the same memory paths is dropped in its favour**; once a file's hash changed,
   the agent proposal is dropped like any stale change. Why: the spec keeps the agent proposal through a
   check; letting a fresh judge proposal sit beside it would put two open cards on one memory.
7. **The reason section is computed for Reviews (in the check) and for agent proposals (in the ask)**;
   other judge proposals keep only their evidence under Details. Why: those are the two cards the spec
   designs; the weekly judge's own changes already carry its evidence.
8. **Runtime fallback is decided up front**: when `consult.HeadlessRuntime()` is `openrouter` and no
   OpenRouter key is stored, memhygiene uses `consult.SpecForTier("claude", TierCapable)`. `consult`
   gains a small exported `OpenRouterKeyConfigured() (bool, error)` reusing the secret name it already
   reads. Why: checking before the call avoids a failed request per batch and keeps `runModel`'s
   signature, which every test stubs.
9. **The card view is the default; `memoryViewAtom` (per project, `"cards" | "table"`) remembers the
   choice**, and a project with `SharedWith`, or an open split / remove-shared / settings change, defaults
   to the table. Why: as the spec says; per-project, since the person may want the table only for the
   split project.
10. **Talk it over is a frontend-only `launchAgent` call** with a task built by a pure
    `talkItOverTask(p, change)` in `memorymodel.ts`. Why: no backend is needed, and the prompt stays
    unit-testable.
11. **A project with nothing open shows a done card** (the person's call, plan review round 1): "Nothing to
    review in <project>" with the next check time. The decided rows stay in the queue, and selecting one
    shows its card with Undo or Reopen. The view does not fall back to the table.
12. **The queue lists decided items decided since the last check** (`DecidedAt >= CheckedAt`; the
    person's call, plan review round 1), as §1's "until the next check rebuilds the list" says. Older
    applied or kept changes, which the state keeps for their backup or indefinitely, stay reachable in the
    table view.
13. **After Delete the selection moves on.** Delete, like Still true, Keep and Apply, selects the next open
    item in the queue; the delete's row stays as `Deleted · Undo`, and `k` (or a click) returns to it,
    whose card shows the applied delete with Undo. Undo of a Delete selects the Review it reopened.
