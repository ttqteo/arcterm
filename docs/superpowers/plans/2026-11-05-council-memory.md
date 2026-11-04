# Council memory: what the council has reached

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The council's Memory tab becomes one list of what the discussion has reached (the Direction pinned on top, then
Agreed, Ruled out and Open entries the round check keeps up on its own), and every seat reads it before every turn.

**Architecture:** Go holds the entries on `CouncilMemory` beside the direction, with pure moves in `pkg/council/memory.go`
and one new wshrpc command; the existing round check answers entry changes beside its direction suggestion; the seat and
synthesis prompts and the saved document carry the whole memory. The frontend draws it from a pure model
(`councilmemorymodel.ts`) in a rewritten `councilmemory.tsx`.

**Tech Stack:** Go (pkg/council, pkg/wshrpc), React 19 + Tailwind 4 + jotai, vitest, the CDP scenario harness.

**Spec:** `docs/superpowers/specs/2026-11-05-council-memory-design.md`
**Verify:** `node scripts/verify.mjs ./pkg/council/... ./pkg/wshrpc/...`
**Check:** `NODE_OPTIONS=--max-old-space-size=4096 task check:ts && go vet ./pkg/council/... ./pkg/wshrpc/...`

This run has no Final: the person checks the UI in the built app themselves, so no task starts a dev app or runs a CDP
scenario. The mockups are `.superpowers/design/council-memory/project/` (`C-merged`, `C-add`, `C-empty`): read them for
the layout.

Read the spec first. The 2026-11-04 spec (`docs/superpowers/specs/2026-11-04-council-ideas-memory-design.md`, section 2)
still governs the direction's moves, the pre-set check and the two cards; this plan changes only what the 2026-11-05 spec
says.

## Global Constraints

- Go is the source of truth for the wire: never hand-edit `frontend/types/gotypes.d.ts`,
  `frontend/app/store/wshclientapi.ts` or `pkg/wshrpc/wshclient/wshclient.go`; change the Go and run `task generate`.
- No test calls a real model: Go tests fake `Caller` (the fakes in `pkg/council/runner_test.go`,
  `memorycheck_test.go`); the CDP scenario replaces model-calling RpcApi commands in the page (`stubRpc`).
- Frontend logic goes in the pure `councilmemorymodel.ts` with vitest beside it; `.tsx` stays thin; no render tests.
- Colors only from `@theme` tokens (DESIGN.md): badges Direction `bg-surface-selected text-primary font-semibold`,
  Agreed `text-success-soft`, Ruled out `text-secondary`, Open `text-warning-soft`, each on `bg-pill`; the new dot
  `bg-accent-soft`.
- Badge words and tooltips, verbatim: Direction "What the council will do. The seats follow it over the Report.";
  Agreed "Settled as true. The seats do not argue it again."; Ruled out "Dropped. The seats do not bring it back without
  something new."; Open "Still to settle. The seats work on it next."
- The UI never says "the check": an automatic entry is `Auto · round N`, an accepted check suggestion
  `Accepted · auto after round N`.
- Empty state copy, verbatim: `Nothing yet. What the seats agree on, rule out or leave open shows up here after each round.`
- Entry kinds on the wire: `agreed`, `ruledout`, `open`; by: `auto`, `you`. At most 40 entries; at most 3 entry changes
  per round check.
- The repo is public: fixtures and test data use neutral content (a made-up feature), never text from a real council.
- Check only the files you touched with `gofmt -l` / `npx prettier --check`; never `--write` the tree, never prettier on
  `scripts/*.mjs`.

## Review Focus

- A round check that answers `"change": false` but lists entry changes: the entries still apply (today's parser returns
  early on change false). Task 2 pins it.
- Chốt on an entry that comes back held, then Discard: the entry stays in the list; Set anyway removes it. Task 1 pins it.
- The check adding back what the person removed, in another case or spacing: refused by its folded key. Task 1 pins it.
- A council saved before this change (no `entries`, no `nextentry`) loads, prompts and renders as today. Tasks 1, 3 and 4
  pin it.
- The hover actions and the details popover are reachable by keyboard (they show on focus-within, not only hover).
  Task 6 pins it.

---

### Task 1: Entries on the memory, their moves and the wire
**Depends on:** none
**Files:** `pkg/council/types.go`, `pkg/council/memory.go`, `pkg/council/memory_test.go`, `pkg/council/direction.go`, `pkg/council/direction_test.go`, `pkg/wshrpc/wshrpctypes_council.go`, `pkg/wshrpc/wshserver/wshserver_council.go`, `pkg/wshrpc/wshserver/wshserver_council_test.go`, `pkg/wshrpc/wshclient/wshclient.go`, `frontend/app/store/wshclientapi.ts`, `frontend/types/gotypes.d.ts`

**Interfaces — Produces:**
- `pkg/council/types.go`: consts `EntryAgreed = "agreed"`, `EntryRuledOut = "ruledout"`, `EntryOpen = "open"`,
  `EntryByAuto = "auto"`, `EntryByYou = "you"`, `MemoryEntriesMax = 40`;
  `type CouncilMemoryEntry struct { Id, Kind, Text string; Why string (omitempty); By string; Round int (omitempty); Messages []string (omitempty); At int64 }`
  with json names `id, kind, text, why, by, round, messages, at`. `CouncilMemory` gains
  `Entries []CouncilMemoryEntry \`json:"entries,omitempty"\`` (arrival order), `Removed []string \`json:"removed,omitempty"\``,
  `NextEntry int \`json:"nextentry,omitempty"\``. `CouncilMemoryCard` gains `Entry string \`json:"entry,omitempty"\``.
- `pkg/council/memory.go` (pure, like the direction moves):
  - `func EntryKey(e CouncilMemoryEntry) string` → `e.Kind + ":" + foldText(e.Text)`.
  - `func (m *CouncilMemory) AddEntry(e CouncilMemoryEntry, now int64) (CouncilMemoryEntry, error)`: trims text (empty
    is an error), refuses an unknown kind, keeps `Why` only for `ruledout`, refuses a key an entry already has
    (`errEntryExists`), refuses an `auto` entry whose key is in `Removed` (`errEntryRemoved`), refuses at
    `MemoryEntriesMax` (`errMemoryFull`); assigns `Id = "m" + (NextEntry+1)`, bumps `NextEntry`, sets `At = now`.
  - `func (m *CouncilMemory) EditEntry(id, text, why string) error`: rewrites in place, sets `By = EntryByYou`.
  - `func (m *CouncilMemory) RemoveEntry(id string) error`: takes it off; an `auto` one appends its key to `Removed`.
  - `func (m *CouncilMemory) DropEntry(id string) error`: the check's drop; allowed for an `auto` entry or any `open`
    one, else `errEntryKept`.
  - `func (m *CouncilMemory) takeEntry(id string) (CouncilMemoryEntry, bool)`: removes with no key (promoted to the
    direction).
  - `func (m *CouncilMemory) EntriesOf(kind string) []CouncilMemoryEntry` (arrival order) and
    `func entryLine(e CouncilMemoryEntry) string` → `- [m3] <text>`, plus ` (why: <why>)` when there is one. Tasks 2
    and 3 render the memory with these two.
- `pkg/council/direction.go`: `DirectionIn` gains `Entry string`. `ActionPin` with `Entry` set reads the text from that
  entry (an unknown entry is an error naming it) and sets the direction's `From` to the entry's first message, if any.
  When the direction is set (fits) the entry leaves the list via `takeEntry`; when held, the card keeps `Entry`, and
  `SetAnyway` takes the entry; `Discard` leaves it. Entry actions: consts `EntryActionAdd = "add"`,
  `EntryActionEdit = "edit"`, `EntryActionRemove = "remove"`; `type EntryIn struct { Action, Entry, Kind, Text, Why string }`;
  `func (r *Runner) MemoryEntry(id string, in EntryIn) (*Council, error)` (add is `By: EntryByYou`; it does not call
  `r.changed`, as `Direction` does not).
- wshrpc: `CouncilMemoryCommand(ctx context.Context, data CommandCouncilMemoryData) error` with
  `CommandCouncilMemoryData{ Id, Action, Entry, Kind, Text, Why string }` (json lower-case, all but id/action omitempty);
  `CommandCouncilDirectionData` gains `Entry string \`json:"entry,omitempty"\``. The server handler mirrors
  `CouncilDirectionCommand`: refuse an empty id, call the runner, publish once.

- [ ] **Step 1: Write the failing Go tests** in `memory_test.go`: `TestAddEntryNumbersAndStamps` (ids m1, m2; At),
  `TestAddEntryRefusesDuplicateFold` ("Cache by locale" vs " cache  BY locale"), `TestRemovedAutoEntryNotAddedAgain`
  (remove auto → AddEntry auto same fold → errEntryRemoved; the same by you is accepted), `TestAddEntryCap` (41st →
  errMemoryFull), `TestEditEntryBecomesYours`, `TestDropEntryKeepsTheirs` (drop a `you` agreed → errEntryKept; an `open`
  of yours → dropped), `TestWhyOnlyForRuledOut`, `TestOldMemoryLoads` (JSON with no entries/nextentry unmarshals, zero
  values). In `direction_test.go`: `TestPinFromEntryLeavesListWhenSet`, `TestPinFromEntryHeldThenDiscardKeepsIt`,
  `TestPinFromEntryHeldThenSetAnywayTakesIt`, `TestMemoryEntryRefusesUnknownAction`. In `wshserver_council_test.go`:
  `TestCouncilMemoryPublishesOncePerMove` beside the direction one.
- [ ] **Step 2: Run them and see them fail:** `go test ./pkg/council -run 'Entry|OldMemory|PinFromEntry|MemoryEntry'`
  and `go test ./pkg/wshrpc/wshserver -run 'TestCouncilMemory'`.
- [ ] **Step 3: Implement** the types, moves, the entry path in `checkedDirection`/`SetAnyway`, `MemoryEntry`, the
  wshrpc type and handler. The held card's reason for a failed pre-set check, shown in the UI, becomes
  `Could not check it: <error>` (was `The check did not answer: <error>`; update the tests that pin it). Run
  `task generate`.
- [ ] **Step 4: Run the tests again; they pass.** `gofmt -l` on the touched Go files prints nothing.
- [ ] **Step 5: Commit** `feat(council): memory entries, their moves and CouncilMemoryCommand`.

### Task 2: The round check keeps the entries up
**Depends on:** Task 1 (uses AddEntry, DropEntry, EntriesOf and entryLine)
**Files:** `pkg/council/memorycheck.go`, `pkg/council/memorycheck_test.go`, `pkg/council/estimate.go`, `pkg/council/estimate_test.go`

**Interfaces — Consumes:** Task 1's moves. **Produces:** `type EntryChange struct { Op, Kind, Text, Why, Entry string; Messages []string }`
(`Op` is `"add"` or `"drop"`); `RoundCheck` gains `Entries []EntryChange`;
`func parseRoundCheck(text string, seen, entries []string) (RoundCheck, error)` (`entries` the entry ids shown).

- [ ] **Step 1: Write the failing tests** in `memorycheck_test.go`: `TestRoundCheckPromptShowsMemory` (the prompt lists
  the direction and each entry by `entryLine`, under `## The council's memory`, and asks for `"entries"`);
  `TestParseRoundCheckEntriesWithNoChange` (`{"change": false, "entries": [{"op":"add","kind":"agreed","text":"T"}]}` →
  no direction change, one add); `TestParseRoundCheckEntriesFiltered` (unknown kind, empty text, a drop of an id not
  shown and a message id not shown are dropped; a fourth change is cut; text cut at `memoryDirMax`);
  `TestCheckMemoryAppliesEntries` (a fake caller answers one add and one drop of an auto Open: the council saved has
  the new auto entry with `Round` and `Messages`, the Open is gone, a duplicate add is skipped silently);
  `TestCheckMemoryDropRefusedForYours` (a drop of a `you` agreed entry leaves it); `TestPresetPromptShowsMemory`.
- [ ] **Step 2: Run them and see them fail:** `go test ./pkg/council -run 'RoundCheck|CheckMemory|PresetPrompt'`.
- [ ] **Step 3: Implement.** `roundCheckPrompt` and `presetPrompt` add a `## The council's memory` section (direction,
  then each kind's `entryLine`s with their ids); the round check's rules add: add an entry only for what the seats
  plainly settled, dropped or left open this round, never what the memory already says or rules out, at most three
  changes; drop only an Open the round answered or an `auto` entry it made wrong. The reply shape:
  `{"change": false}` or the direction fields as today, plus optional
  `"entries": [{"op": "add", "kind": "agreed" | "ruledout" | "open", "text": "<one sentence>", "why": "<for ruledout>", "messages": ["<id>"]}, {"op": "drop", "entry": "<m id>"}]`.
  `parseRoundCheck` reads entries whatever `change` says. `checkMemory` applies them in its existing `updateLogged`,
  `By: EntryByAuto`, the pass's `round`, skipping any change a move refuses. `roundCheckTokens` goes from 15_000 to
  18_000; fix the estimate tests that pin totals.
- [ ] **Step 4: Run the tests again; they pass**, and `go test ./pkg/council -run 'Estimate'`.
- [ ] **Step 5: Commit** `feat(council): the round check adds and drops memory entries`.

### Task 3: Seats, the synthesis and the document read the whole memory
**Depends on:** Task 1 (uses EntriesOf and entryLine)
**Files:** `pkg/council/prompts.go`, `pkg/council/prompts_test.go`, `pkg/council/markdown.go`, `pkg/council/markdown_test.go`

**Interfaces — Consumes:** Task 1's `EntriesOf`, `entryLine`. **Produces:** `func writeCouncilMemory(b *strings.Builder, c *Council)`
replacing `writeChosenDirection` at all its call sites; `func writeSettledMemory(b *strings.Builder, c *Council)`
replacing `writeSettledDirection`.

- [ ] **Step 1: Write the failing tests** in `prompts_test.go`: `TestSeatPromptCarriesMemory` (a seat prompt opens, after
  the context lines, with `## The council's memory`: the direction with `outranksReport`, then `Agreed`, `Ruled out`
  with its why and `Open` blocks, each with its rule line, and only the kinds that have entries);
  `TestSeatPromptNoMemoryAsBefore` (no direction, no entries → the prompt is byte-for-byte what it was; update the
  existing chosen-direction tests to the new heading); `TestSynthesisRulesForMemory` (direction still binding as
  direction 1; Agreed taken as settled; a Ruled out option is not ranked as a direction). In `markdown_test.go`:
  `TestMarkdownMemorySection` (`## Memory` above the Report: the direction, `Earlier directions` with
  `replaced <time>`, then `### Agreed`, `### Ruled out` with why, `### Open`) and `TestMarkdownNoMemory`.
- [ ] **Step 2: Run them and see them fail:** `go test ./pkg/council -run 'SeatPrompt|Synthesis|Markdown'`.
- [ ] **Step 3: Implement.** The rule lines, one per kind: Agreed "settled as true: do not argue it again unless you
  bring new evidence"; Ruled out "dropped: do not propose it again unless you say what is new"; Open "still to settle:
  work on these first". `writeMemory` in `markdown.go` writes the new section; the direction's struck `~~…~~` lines
  become plain list items ending `replaced <time>`.
- [ ] **Step 4: Run the tests again; they pass** (and `go test ./pkg/council -run 'Prompt'` for the rest of the prompt
  tests).
- [ ] **Step 5: Commit** `feat(council): seats and the document read the whole memory`.

### Task 4: The Memory tab's model
**Depends on:** Task 1 (uses CouncilMemoryEntry from gotypes.d.ts)
**Files:** `frontend/app/view/agents/councilmemorymodel.ts`, `frontend/app/view/agents/councilmemorymodel.test.ts`

**Interfaces — Consumes:** `CouncilMemoryEntry`, `CouncilMemory.entries` from the generated types. **Produces**
(existing exports keep their signatures; Task 5 moves callers over):
- `type MemoryKind = "direction" | "agreed" | "ruledout" | "open"`; `KIND_LABEL: Record<MemoryKind, string>`
  (Direction, Agreed, Ruled out, Open); `KIND_MEANING: Record<MemoryKind, string>` (the Global Constraints' sentences).
- `memoryEntries(c: Council): CouncilMemoryEntry[]` newest first (by `at`, then id); an entry of an unknown kind is left out.
- `memoryCount(c: Council): number` entries plus one for a chosen direction.
- `newEntryIds(c: Council, seenAt: number | undefined): Set<string>` (entries with `at > (seenAt ?? 0)`).
- `memoryDotOn(c: Council, seenAt: number | undefined): boolean` (a card waits, or a new entry).
- `entryDetails(e: CouncilMemoryEntry): { who: string | null; messages: string[]; time: string }`: auto →
  `who: "Auto · round 3"` (`"Auto"` with no round), you → `who: null` and the view writes `You · <time>`.
- `memoryIsEmpty(c: Council): boolean` (no direction, no entry, no card).
- Changed copy: `directionHow` check source → `Accepted · auto after round N` / `Accepted · auto`; `cardKicker` for a
  suggestion → `Suggested direction`; `replacedRows` line → `replaced <time>`.

- [ ] **Step 1: Write the failing tests** in `councilmemorymodel.test.ts`, one `describe` per export above, with the
  spec's values (`Auto · round 3`, `replaced 22:25`, the four meanings verbatim), plus `old council with no entries`
  (count 0 or 1, no dot from entries, `memoryEntries` empty).
- [ ] **Step 2: Run and see them fail:** `npx vitest run frontend/app/view/agents/councilmemorymodel.test.ts`.
- [ ] **Step 3: Implement** in `councilmemorymodel.ts`; update the existing tests whose copy changed.
- [ ] **Step 4: Run again; they pass.**
- [ ] **Step 5: Commit** `feat(council): the Memory tab's model for entries`.

### Task 5: The Memory tab drawn as one list
**Depends on:** Task 4 (uses the model's exports)
**Files:** `frontend/app/view/agents/councilmemory.tsx`, `frontend/app/view/agents/councilchat.tsx`, `frontend/app/view/agents/councilstore.ts`, `frontend/app/view/agents/councilmemoryseen.ts`, `frontend/app/view/agents/councilmemorymodel.ts`, `CHANGELOG.md`

**Interfaces — Consumes:** Task 4's model; Task 1's `CouncilMemoryCommand` and `entry` on the direction data.
**Produces** (Task 6's scenario reads these): on the panel `data-council-memory`; the card as today
(`data-council-memory-card`, `-kicker`, `-card-text`, `-reason`, actions `accept`, `dismiss`, `edit-held`,
`setanyway`, `discard`); the direction row `data-council-memory-direction`; each entry
`data-council-memory-entry="<id>"` with `data-kind`; a badge `data-council-memory-badge="<kind>"` whose `title` is its
meaning; `data-council-memory-new` on the new dot; the details button `data-council-memory-details` and its popover
`data-council-memory-popover`; row actions `data-council-memory-action` = `chot`, `edit`, `remove`, `unpin`,
`earlier`; earlier rows `data-council-memory-earlier-row`; the add form `data-council-memory-add` with kind radios
`data-council-memory-kind="<kind>"`, `data-council-memory-add-text`, `data-council-memory-add-why`, actions `add`,
`cancel`; the empty state `data-council-memory-empty` and `data-council-memory-legend`; in the tab strip
`data-council-memory-open-add` and the existing `data-council-memory-dot`.

- [ ] **Step 1: Store and seen state.** `councilstore.ts`: `memoryCouncil(id: string, action: "add" | "edit" | "remove", fields: { entry?: string; kind?: string; text?: string; why?: string }): Promise<CouncilCall<void>>`
  and an optional fifth `entry?: string` on `directionCouncil`. `councilmemoryseen.ts`: `memorySeenAtom`, an
  `atomWithStorage<Record<string, number>>("council.memory.seen", {})`, read and written per council id. Opening the
  Memory tab snapshots the old time for the panel's new dots, then writes now.
- [ ] **Step 2: The panel.** Rewrite `councilmemory.tsx` to the boards `C-merged`, `C-add`, `C-empty`: the card at the
  top (the reason's message ids are links that call `onShow([id])`; Show the messages goes), the direction row (15px,
  medium), Earlier · N unfolding the replaced directions, entries newest first, the Ruled out why on a muted line, the
  badge line. Row actions and the details button show on hover and on focus-within (`group`). The details popover opens
  on hover or focus of its button (`PopoverReveal`), message ids opening their thread through `onOpenSource`. The add
  form, opened from the tab strip, has the kind picker (Direction / Agreed / Ruled out / Open, Why only for Ruled out);
  Direction posts `directionCouncil(id, "set", text)`, the others `memoryCouncil(id, "add", …)`. Chốt on an entry is
  `directionCouncil(id, "pin", entry.text, undefined, entry.id)`. Every move goes through `acts.run`, one at a time, a
  refusal shown under the form as today. Delete the model exports nothing calls any more (`memoryEmpty`, `memoryDot`
  if unused).
- [ ] **Step 3: The tab strip** in `councilchat.tsx`: the label `Memory · N` (`memoryCount`, no ` · 0`), the dot from
  `memoryDotOn`, and `+ Add` left of the fold button while Memory is the tab.
- [ ] **Step 4: `CHANGELOG.md`**, under Changed in the top section: "The council's Memory tab is now the council's
  memory: one list of what the seats agreed on, ruled out and left open, kept up after each round, with the direction
  pinned on top. Every seat reads it before it answers."
- [ ] **Step 5: Check:** `NODE_OPTIONS=--max-old-space-size=4096 task check:ts` exits 0;
  `npx vitest run frontend/app/view/agents/councilmemorymodel.test.ts` passes; `npx prettier --check` and
  `npx eslint` on the touched `.ts`/`.tsx` files pass.
- [ ] **Step 6: Commit** `feat(council): the Memory tab drawn as one list`.

### Task 6: The council-memory scenario for the new boards
**Depends on:** Task 5 (uses its data attributes)
**Files:** `scripts/cdp/council/memory.mjs`

Every step stubs `CouncilDirectionCommand` and `CouncilMemoryCommand`, asserts the recorded call, then writes the council
with the memory the backend would have saved and announces it, as the file does today. The fixture's memory is neutral
content (a made-up caching feature), built in this file.

- [ ] **Step 1: Rewrite the steps** (keep the held-card steps as they are, adjusted to the new layout):
  1. a council with a direction, one earlier direction, two Agreed, two Ruled out (one with a why), two Open and one
     waiting suggestion: the direction row is first, entries are newest first, each badge's word and `title` match the
     meanings, the new dot shows on entries after the seen time, the tab reads `Memory · 7` with its dot;
  2. focus an entry's details button (focus, not hover): its actions and the popover show, reading `Auto · round 3`
     and its message link; nothing on the badge line wraps (each badge's height is one line);
  3. open Add from the tab strip, pick Ruled out, type the text and a why, Add: the call is
     `{action: "add", kind: "ruledout", text, why}` and the new entry shows at the top;
  4. Chốt on an Agreed entry: the call is `{action: "pin", text, entry}`; after the saved direction is announced, the
     entry is gone from the list and its text is the direction;
  5. Remove an entry: `{action: "remove", entry}`;
  6. Earlier · 1 unfolds the replaced direction with `replaced <time>` and no strikethrough;
  7. a council with nothing: the empty line verbatim and the legend's four badges with their meanings.
- [ ] **Step 2: Check it loads, without running it:** `node --check scripts/cdp/council/memory.mjs` exits 0, and every
  selector it uses is one Task 5 lists (grep `councilmemory.tsx` and `councilchat.tsx` for each). Do not start a dev app
  or run the scenario: this run has no live check (see the header).
- [ ] **Step 3: Commit** `test(cdp): council-memory draws the one-list memory`.
