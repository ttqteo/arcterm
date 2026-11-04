# Council: Ideas by stance, and a Memory tab — plan

**Spec:** `docs/superpowers/specs/2026-11-04-council-ideas-memory-design.md` (the source of every rule below; its
mockups are gitignored, so where a board adds a detail this plan writes it down)
**Verify:** `node scripts/verify.mjs ./pkg/council ./pkg/wshrpc/... ./cmd/wsh/cmd`
**Check:** `task check:ts && go vet ./pkg/council ./pkg/wshrpc/...`
**Final:** `node scripts/cdp/final-verify.mjs council-ideas council-memory council-summary council-discussion`

Shape of the work: Task 1 lands the memory's Go types (the interface everything reads). The moves on it (Task 2), the
wire (Task 3), the prompts (Task 6) and the frontend model (Task 8) build on it beside each other; the estimate
(Task 5) and the Ideas grouping (Task 7) need nothing. The checks (Task 4) need the moves and the wire. The Memory tab's
UI (Task 9) comes last and also owns every expectation in `scripts/cdp/council/discussion.mjs` that Tasks 5, 7 and 9
change (CDP scenarios run only in Final, so an earlier merge leaving them stale breaks nothing).

Every task: errors at the boundary (a command refuses a bad action or a missing card with an error naming it; never a
silent no-op), no abstraction for one caller, colors only from `@theme` tokens. Run `task generate` after changing a
wshrpc / waveobj type; never hand-edit generated files. Go focused tests on Windows need the cgo prefix from AGENTS.md.
`CouncilDirection` already exists (the Report's directions, `types.go:301`): the memory's types are named
`CouncilMemory*` and never touch it.

### Task 1: The council's memory: Go types
**Depends on:** none
**Files:** `pkg/council/types.go`, `pkg/council/types_test.go`, `frontend/types/gotypes.d.ts`

Add beside `Summary` in `types.go` (spec "Data and wire"):

```go
const (
    DirectionPin       = "pin"       // Chốt on a message or idea
    DirectionWritten   = "written"   // typed in Set the direction…
    DirectionSuggested = "suggested" // accepted from a suggestion
    EndReplaced = "replaced"; EndEdited = "edited"; EndUnpinned = "unpinned"
    CardSuggestion = "suggestion"; CardHeld = "held"
    SourceCheck = "check"; SourceGreen = "green" // a suggestion's source: the round check, or all green
)
type CouncilMemoryDirection struct {
    Text     string `json:"text"`
    How      string `json:"how"`                // DirectionPin / Written / Suggested
    Source   string `json:"source,omitempty"`   // for How suggested: SourceCheck or SourceGreen
    Round    int    `json:"round,omitempty"`    // the round a check suggestion came after ("after round N")
    From     string `json:"from,omitempty"`     // the idea (P3) or message (r7) it came from
    At       int64  `json:"at"`
    Replaced int64  `json:"replaced,omitempty"` // when it left Chosen; 0 while chosen
    Ended    string `json:"ended,omitempty"`    // EndReplaced / EndEdited / EndUnpinned
}
type CouncilMemoryCard struct {
    Kind     string   `json:"kind"`               // CardSuggestion or CardHeld
    Text     string   `json:"text"`
    Reason   string   `json:"reason,omitempty"`   // the check's one line; for a held card, why it is held
    How      string   `json:"how,omitempty"`      // a held card: how the person set it (pin / written), kept when set anyway
    Source   string   `json:"source,omitempty"`   // a suggestion: SourceCheck or SourceGreen
    Round    int      `json:"round,omitempty"`
    From     string   `json:"from,omitempty"`     // an idea id (all green) or the message it was pinned from
    Messages []string `json:"messages,omitempty"` // a check suggestion: the message ids it rests on (Show the messages)
    Edited   bool     `json:"edited,omitempty"`   // a held card that came from Edit: setting it ends the old one as EndEdited
    At       int64    `json:"at"`
}
type CouncilMemory struct {
    Chosen     *CouncilMemoryDirection  `json:"chosen,omitempty"`
    Replaced   []CouncilMemoryDirection `json:"replaced,omitempty"`   // newest first
    Suggestion *CouncilMemoryCard       `json:"suggestion,omitempty"` // one slot
    Held       *CouncilMemoryCard       `json:"held,omitempty"`       // a second slot: a suggestion never drops it
    Dismissed  []string                 `json:"dismissed,omitempty"`  // suggestion keys never raised again
    Changed    int64                    `json:"changed,omitempty"`    // when Chosen last changed (set, edit, unpin): the Report's Outdated cause
}
// on Council:  Memory *CouncilMemory `json:"memory,omitempty"`
```

Run `task generate` so `frontend/types/gotypes.d.ts` carries them.

Acceptance: a new `TestMemoryJSON` in `types_test.go` (`go test ./pkg/council -run 'TestMemoryJSON'`): a council
saved without `memory` loads with `Memory == nil`, and a memory with a chosen direction, two replaced, both cards and
a dismissed key round-trips.

### Task 2: The memory's moves
**Depends on:** Task 1 (uses the `CouncilMemory*` types)
**Files:** `pkg/council/memory.go`, `pkg/council/memory_test.go`

Pure moves on the memory (the Runner applies them inside `Update`), with these signatures, which Task 4 relies on:

- `func MemoryOf(c *Council) *CouncilMemory` — creates it on first use.
- `func (m *CouncilMemory) Choose(d CouncilMemoryDirection, ended string, now int64)` — the old Chosen (if any) moves
  to the head of Replaced with `Replaced=now, Ended=ended`; `d` becomes Chosen; `Changed=now`.
- `func (m *CouncilMemory) Unpin(now int64) error` — Chosen to Replaced as `EndUnpinned`, `Changed=now`; error with
  none chosen.
- `func (m *CouncilMemory) Hold(card CouncilMemoryCard)` — fills the held slot (replacing an earlier held card).
- `func (m *CouncilMemory) SetAnyway(now int64) error` / `func (m *CouncilMemory) Discard() error` — settle the held
  card (SetAnyway chooses it with the card's `How`, ending the old Chosen as `EndEdited` when the card is `Edited`,
  else `EndReplaced`); error with nothing held.
- `func (m *CouncilMemory) Raise(card CouncilMemoryCard) bool` — puts a suggestion in its slot, replacing a waiting
  one (a pushed-out suggestion is not dismissed); false, and nothing changes, when its key was dismissed or its text
  is the chosen direction's.
- `func (m *CouncilMemory) Accept(now int64) error` — the suggestion becomes Chosen (`How=DirectionSuggested`, keeping
  Source / Round / From), with no check; error with none waiting.
- `func (m *CouncilMemory) Dismiss() error` — records the suggestion's key in Dismissed and clears the slot.
- `func SuggestionKey(card CouncilMemoryCard) string` — `idea:<From>` for an all-green suggestion, `text:<the text
  folded to lower case and single spaces>` for a check suggestion.

Pinning or typing never touches the suggestion slot; the held slot shows first (the frontend decides that).

Acceptance: `go test ./pkg/council -run 'TestMemory'` covers set then replace (Replaced newest first, `Changed`
moves), unpin, hold then set anyway (an edited card ends the old as `edited`), discard, a dismissed suggestion not
raised again for the same idea or the same text, a newer suggestion replacing a waiting one without dismissing it, a
suggestion never clearing the held card, and every error case.

### Task 3: The direction command on the wire
**Depends on:** Task 1 (generates over the same `gotypes.d.ts`)
**Files:** `pkg/council/direction.go`, `pkg/wshrpc/wshrpctypes_council.go`, `pkg/wshrpc/wshserver/wshserver_council.go`, `pkg/wshrpc/wshclient/wshclient.go`, `frontend/app/store/wshclientapi.ts`, `frontend/types/gotypes.d.ts`

- `pkg/council/direction.go`: `type DirectionIn struct { Action, Text, From string }`, the action words as constants
  (`set`, `pin`, `edit`, `accept`, `dismiss`, `setanyway`, `discard`, `unpin`), and
  `func (r *Runner) Direction(id string, in DirectionIn) (*Council, error)`, which for now refuses an unknown action
  and returns `errors.New("directions are not built yet")` for the rest. Task 4 replaces the body.
- `CouncilDirectionCommand(ctx, CommandCouncilDirectionData{Id, Action, Text, From}) error` in
  `wshrpctypes_council.go`, served in `wshserver_council.go` like `CouncilThumbCommand`: it calls the Runner's
  `Direction` and publishes `council:changed`. An empty id is refused.
- Run `task generate`; the frontend calls `RpcApi.CouncilDirectionCommand`.

Acceptance: `go test ./pkg/wshrpc/... -run 'Council'` passes; `go build ./...` is clean; the generated client has the
command.

### Task 4: The two checks, all green, and the direction actions
**Depends on:** Task 2 (uses the moves), Task 3 (fills in `direction.go`)
**Files:** `pkg/council/direction.go`, `pkg/council/direction_test.go`, `pkg/council/memorycheck.go`, `pkg/council/memorycheck_test.go`, `pkg/council/runner.go`, `pkg/council/runner_test.go`

Spec sections "How a direction gets in", "The check before a direction is set".

- `memorycheck.go`: both model calls follow `routeCall` (`router.go:270`): `ModelRouter` (haiku), no tools, in the
  project folder, JSON out, tokens and calls added to the council's totals as the router's are.
  - The **pre-set check** reads a candidate direction against the chosen one and the council's recent sent messages
    and stances; it answers fits, or clashes / unclear with a one-line reason.
  - The **round check** reads one round's sent messages and the chosen direction; it answers "no change", or a
    suggested direction with a one-line reason and the ids of the messages it rests on (ids it did not see are
    dropped).
  - Prompt builders and parsers are pure functions tested in `memorycheck_test.go` (no change; a suggestion; fits;
    clash; unclear; malformed output is an error).
  - **All green** (no model call): an idea every seat other than its author has accepted (each one's latest stance),
    sent and not withdrawn or cut, is raised as a `SourceGreen` suggestion.
- `runner.go`: after each reply pass (`replyPass`, once its `round2` turns are done) and after each `answerAll`
  batch, raise all green first, then run the round check and raise its suggestion. This runs in the post-Report chat
  too. A failed round check is logged on the council's timeline like a failed router call and raises nothing; it
  never fails the round.
- `direction.go`: the real `Direction`. `set` (typed: How written), `pin` (Chốt: How pin, From the item) and `edit`
  (new text for the chosen one; a held edit is marked `Edited`, a set one ends the old as edited) run the pre-set check
  before returning, with a timeout: fits → `Choose`; clash or unclear → `Hold` with the reason; a check that fails →
  `Hold` with `The check did not answer: <error>`. Never set a direction when the check failed. `accept`, `dismiss`,
  `setanyway`, `discard`, `unpin` apply their move. Empty text, an unknown action and an `edit` with nothing chosen
  are refused.

Acceptance: `go test ./pkg/council -run 'TestDirection|TestRoundCheck|TestPresetCheck|TestAllGreen'` with a fake
caller: a fitting direction is set; a clashing one held with its reason; a failing check holds with `The check did not
answer:`; set anyway and discard; accept with no check; dismiss then the same suggestion not raised again; the round
check runs after a reply pass and after an `answerAll` batch and its tokens count in the totals; all green raised with
no model call, and not for an idea only its author stands on.

### Task 5: The estimate counts the round check
**Depends on:** none
**Files:** `pkg/council/estimate.go`, `pkg/council/estimate_test.go`, `cmd/wsh/cmd/wshcmd-council_test.go`

Spec "Data and wire", last bullet: one round check per reply pass in `Estimate` and `EstimateRemaining`, and one per
message in `EstimateFollowup` and `EstimateRouted`, priced as a no-tools haiku call like the router (a named constant
in `estimate.go`). Update the hard-coded estimate lines in `wshcmd-council_test.go` (lines ~461, 513, 538, 550, 555) to
the new counts. The `≈ 5 calls` line in `scripts/cdp/council/discussion.mjs` is Task 9's.

Acceptance: `go test ./pkg/council -run 'TestEstimate'` and `go test ./cmd/wsh/cmd -run 'Council'` pass with each
estimate one round check larger per pass / message.

### Task 6: Seats, the Report and the saved document read the direction
**Depends on:** Task 1 (uses `CouncilMemory` and its fields)
**Files:** `pkg/council/prompts.go`, `pkg/council/prompts_test.go`, `pkg/council/markdown.go`, `pkg/council/markdown_test.go`

Spec "When a direction changes" and "The saved document and agents".

- Every seat turn's prompt (round 1, round 2 / reply passes, `AnswersPrompt`, the agent first / later prompts) opens
  with a **chosen direction** block, above `writeReport`, saying it outranks the Report where the two differ. One
  helper writes it; a council with no chosen direction prompts byte-for-byte as today.
- `SynthesisPrompt` and the Brainstorm synthesis (`writeBrainstormSynthesisTask`) take the chosen direction as
  settled and binding: the Report ranks it as direction 1 and writes the rest around it.
- `Markdown` (which `wsh council` prints and Save writes) carries **Chosen direction** above the Report, with
  **Replaced** under it (newest first, how each was set and when it was replaced); nothing when there is no memory.
  `markdown.go` already has a `writeDirection` for the Report's directions: name the new helper apart.

Acceptance: `go test ./pkg/council -run 'TestDirectionBlock|TestSynthesisDirection|TestMarkdownMemory'`: the block is
present in each seat prompt kind and absent without a direction; the synthesis prompts name it as direction 1; the
markdown orders Chosen direction, Replaced, then the Report.

### Task 7: The Ideas tab grouped by where the seats stand
**Depends on:** none
**Files:** `frontend/app/view/agents/councillistmodel.ts`, `frontend/app/view/agents/councillistmodel.test.ts`, `frontend/app/view/agents/councilchat.tsx`, `scripts/cdp/council/ideas.mjs`, `scripts/cdp/councilscenarios.mjs`, `CHANGELOG.md`

Spec section 1.

- In `councillistmodel.ts`, beside `listOrder`: a pure `stanceGroups(c, rows)` that sorts the rows `councilList`
  returned (so the seat filter `only` has already narrowed them) into groups, in this order: **Waiting on you** (held
  drafts, muted, no color bar), **Agreed** (`success`), **Has doubts** (`warning`), **Someone against it** (`error`),
  **No stance yet** (`ink-faint`), **Withdrawn** (`edge-strong`, title struck through). Precedence: withdrawn,
  against, doubts, agreed, no stance; read from `latestStances`, derived on every render, never stored. Inside a
  group, arrival order; empty groups left out. Extend `IdeaRow` with what it needs (withdrawn / cut and the round).
  `railMeta` for a withdrawn idea reads `withdrawn in round N` (board `Ideas-by-stance`), for a cut one `cut by you`.
  `railOrderLabel` reads `by where the seats stand`.
- `IdeasList` in `councilchat.tsx` draws each group under a header with a dot in its color, its name in words and a
  count; each row keeps its number (`Idea 13`), seat, title and `railMeta` line, with a thin bar in its group's color.
  Add `data-council-rail-group="<key>"` on each group and keep `data-council-rail-idea` on rows.
- New CDP scenario `council-ideas` in `scripts/cdp/council/ideas.mjs` (its own fixture council, built with the helpers
  in `./council/fixtures.mjs`, no model call), registered in `councilscenarios.mjs`: step 1 opens the council's rail
  and shots the Ideas tab with an idea in every group, asserting the group order, the headers' names and counts, a
  withdrawn idea's `withdrawn in round 2` and a cut idea's `cut by you`; step 2 changes a stance in the fixture and
  asserts the idea moved group; step 3 picks a seat filter and asserts only that seat's ideas show, still grouped.
- The rail order the existing `council-discussion` (`discussion.mjs`) and `council-summary` (`summary.mjs:381`)
  scenarios assert changes with this task; Tasks 9 and 8 update those files.
- `CHANGELOG.md`: one Added line for the Ideas tab grouped by stance.

Acceptance: `npx vitest run frontend/app/view/agents/councillistmodel.test.ts` covers each group's rule, precedence,
held drafts in Waiting on you, cut and withdrawn in Withdrawn with their meta, the filter then group order, empty
groups left out, and the caption; `council-ideas` steps 1–3 pass.

### Task 8: The Report's new Outdated cause and the Memory tab's model
**Depends on:** Task 1 (reads `Council.memory` from `gotypes.d.ts`), Task 7 (its grouped rail order is what `summary.mjs:381` must now expect)
**Files:** `frontend/app/view/agents/councilmodel.ts`, `frontend/app/view/agents/councilmodel.test.ts`, `frontend/app/view/agents/councilsummarymodel.ts`, `frontend/app/view/agents/councilsummarymodel.test.ts`, `frontend/app/view/agents/councilsummary.tsx`, `frontend/app/view/agents/councilmemorymodel.ts`, `frontend/app/view/agents/councilmemorymodel.test.ts`, `scripts/cdp/council/summary.mjs`

- `outdatedChanges` gains `direction` (1 when `memory.changed` is after `summary.at`, else 0), counted in
  `outdatedCount`; a rerun clears it since the new Report is later. `writtenLine` and `councilsummary.tsx` stop
  re-summing the parts and use `outdatedCount` (one source); `outdatedLabel` names it: `Outdated · the direction
  changed`, joined with the other parts as today.
- `councilmemorymodel.ts`, pure, what Task 9 draws:
  - the card that shows: the held card first, else the suggestion, else none;
  - whether the tab's dot is on (a card waits);
  - the empty state (no direction and no card);
  - the chosen direction's line: `Pinned by you`, `Written by you`, `Accepted from the check after round N`, an all
    green one `Accepted: every seat agreed`, with its time and its source item;
  - the Replaced rows newest first, each with how it was set and `replaced` / `edited` / `unpinned` and when;
  - `chotText(item)`: an idea's title, or a message's text cut to one line.
- `scripts/cdp/council/summary.mjs`: update the rail-order expectation at ~381 to the grouped order (Task 7), and add a
  step to `council-summary` with a fixture whose `memory.changed` is after its Report, asserting the banner reads
  `Outdated · the direction changed`.

Acceptance: `npx vitest run frontend/app/view/agents/councilmodel.test.ts frontend/app/view/agents/councilsummarymodel.test.ts frontend/app/view/agents/councilmemorymodel.test.ts`
(the direction cause counted, cleared by a later Report, labelled; every model case above); `council-summary` passes
with the new step.

### Task 9: The Memory tab, Chốt and its key
**Depends on:** Task 3 (uses `RpcApi.CouncilDirectionCommand`), Task 5 (its estimate changes the `≈ 5 calls` line discussion.mjs asserts), Task 7, Task 8 (draws `councilmemorymodel.ts`)
**Files:** `frontend/app/view/agents/councilmemory.tsx`, `frontend/app/view/agents/councilchat.tsx`, `frontend/app/view/agents/councilchatnav.ts`, `frontend/app/view/agents/councilstore.ts`, `frontend/app/store/keybindings/bindings.ts`, `docs/keyboard-shortcuts.md`, `scripts/cdp/council/memory.mjs`, `scripts/cdp/council/discussion.mjs`, `scripts/cdp/councilscenarios.mjs`, `CHANGELOG.md`

Spec section 2, "Layout" top to bottom.

- `councilstore.ts`: `directionCouncil(id, action, text?, from?)` beside `thumbCouncil`, returning a `CouncilCall`.
- `councilmemory.tsx`: the Memory tab panel: caption `the seats read this before the Report`; the **Set the
  direction…** input with **Set**; the one card (a suggestion with **Make it the direction**, **Dismiss**, **Show the
  messages**, which scrolls the channel to its messages; or a held direction with its reason and **Edit** (its text
  back into the input), **Set anyway**, **Discard**); **Chosen direction** with its line, time, source link, **Edit**
  and **Unpin**; **Replaced** struck through. Empty: the input and `Pin a message with Chốt, or write the direction
  here.` Busy and error states through the existing `Actions` (`acts.run`), as the thumbs do.
- `councilchat.tsx`: a `Memory` tab beside Ideas in `CouncilRail` (the tab type gains `"memory"`; keep it in
  `councilchatnav.ts` if the tab is kept there), with a small `accent-soft` dot when a card waits; a **Chốt** item in a
  message's and an idea's action row beside like / dislike, calling the `pin` action with `chotText`.
- `bindings.ts`: a `council:chot` binding in `buildCouncilBindings` that pins the message or idea under the cursor;
  pick a key no council or agent binding uses and that Telex leaves alone (no brackets); mirror it in
  `docs/keyboard-shortcuts.md`.
- `scripts/cdp/council/discussion.mjs`: update what Tasks 5, 7 and 9 change there: the rail's tabs (~3202–3286: the
  Memory tab is always there, so `ideas,memory,thread` and the counts), the rail's grouped order and caption (Task 7),
  and the paused `The rest: ≈ N calls` line (~754) to Task 5's estimate.
- New CDP scenario `council-memory` in `scripts/cdp/council/memory.mjs`, registered in `councilscenarios.mjs`, with
  `CouncilDirectionCommand` stubbed in the page (no model call; each step asserts the stub's recorded action, text and
  from, then the fixture is swapped to the state the backend would save):
  1. clicking the Memory tab shows the empty tab (caption, input, the muted line);
  2. typing in Set the direction… and clicking Set calls `set` with the text;
  3. a chosen direction with two Replaced and a waiting suggestion: the tab's dot is on, the chosen line, time and
     source link, Replaced newest first and struck through (shot);
  4. Make it the direction calls `accept`; Dismiss calls `dismiss`;
  5. Show the messages scrolls the channel so the suggestion's first message is in view;
  6. a held direction above a chosen direction with two Replaced (board `Memory-held`): its reason and Edit / Set
     anyway / Discard, the chosen and Replaced rows (shot);
  7. held Edit puts its text back into the input; Set anyway calls `setanyway`; Discard calls `discard`;
  8. chosen Edit, with new text, calls `edit`; Unpin calls `unpin`;
  9. the stub failing shows the action's error state;
  10. Chốt on a message calls `pin` with the message's one-line text and its id; the `council:chot` key does the
      same on the cursor's idea, with its title.
- `CHANGELOG.md`: one Added line for the Memory tab and Chốt.

Acceptance: `council-memory` steps 1–10 and `council-discussion` pass; `task check:ts` is clean.
