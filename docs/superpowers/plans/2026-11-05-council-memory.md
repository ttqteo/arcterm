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
**Final:** `node scripts/cdp/final-verify.mjs council-memory`
**Prototype:** .superpowers/design/council-memory/project

The Prototype folder holds the boards `C-merged.dc.html` (the list, a hovered entry with its details), `C-add.dc.html`
(the Add form, Earlier unfolded) and `C-empty.dc.html` (the empty legend); read them for the layout. Final runs the
`council-memory` scenario once on the merged result (headless Chrome on a Mac); no task starts a dev app or runs a
scenario itself.

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
- Who may drop what (the person's call, 2026-11-05): the check may drop an `auto` entry, or any Open the round answered,
  the person's included; it never drops the person's Agreed or Ruled out. The person's Remove takes off anything.
- An earlier direction reads its own end word and time everywhere: `replaced 22:25`, `edited 22:25` or
  `unpinned 22:25` (`memoryEnded` in Go, `ended` in `replacedRows`), never `replaced` for all.
- The repo is public: fixtures and test data use neutral content (a made-up feature), never text from a real council.
- Check only the files you touched with `gofmt -l` / `npx prettier --check`; never `--write` the tree, never prettier on
  `scripts/*.mjs`.

## Review Focus

- A round check that answers `"change": false` but lists entry changes, or lists entries with no direction
  (`{"entries": […]}` alone, or `"change": true` with no direction): the entries still apply and no error is logged.
  Today's parser returns early on change false and errors on a missing direction. Task 3 pins it.
- Chốt on an entry that comes back held, then Discard: the entry stays in the list; Set anyway removes it. The held
  card's Edit is a new `set` from the Add form with no entry, so the entry stays. Task 2 pins it.
- The check adding back what the person removed, in another case or spacing: refused by its folded key. Task 1 pins it.
- The check dropping the person's Agreed or Ruled out: refused; their Open: allowed. Tasks 1 and 3 pin it.
- A council saved before this change (no `entries`, no `nextentry`) loads, prompts and renders as today. Tasks 1, 4 and 5
  pin it.
- The hover actions and the details popover are reachable by keyboard (they show on focus-within, not only hover).
  Task 7's `details` step pins it.

---

### Task 1: Memory entries: the types and their pure moves
**Depends on:** none
**Files:** `pkg/council/types.go`, `pkg/council/memory.go`, `pkg/council/memory_test.go`, `frontend/types/gotypes.d.ts`

The interface Tasks 2 to 5 build on. No runner, no wire command: those are Task 2.

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
  - `func (m *CouncilMemory) EditEntry(id, text, why string) error`: rewrites in place (empty text is an error, `Why`
    kept only for `ruledout`), sets `By = EntryByYou`.
  - `func (m *CouncilMemory) RemoveEntry(id string) error`: takes it off; an `auto` one appends its key to `Removed`.
  - `func (m *CouncilMemory) DropEntry(id string) error`: the check's drop; allowed for an `auto` entry or any `open`
    one (the person's included), else `errEntryKept`. It appends nothing to `Removed`.
  - `func (m *CouncilMemory) takeEntry(id string) (CouncilMemoryEntry, bool)`: removes with no key (promoted to the
    direction).
  - `func (m *CouncilMemory) EntriesOf(kind string) []CouncilMemoryEntry` (arrival order) and
    `func entryLine(e CouncilMemoryEntry) string` → `- [m3] <text>`, plus ` (why: <why>)` when there is one. Tasks 3
    and 4 render the memory with these two.
- `frontend/types/gotypes.d.ts` regenerated: `CouncilMemoryEntry`, `CouncilMemory.entries`, `.removed`, `.nextentry`,
  `CouncilMemoryCard.entry`. Task 5 reads them.

- [ ] **Step 1: Write the failing Go tests** in `memory_test.go`: `TestAddEntryNumbersAndStamps` (ids m1, m2; At),
  `TestAddEntryRefusesDuplicateFold` ("Cache by locale" vs " cache  BY locale"), `TestRemovedAutoEntryNotAddedAgain`
  (remove auto → AddEntry auto same fold → errEntryRemoved; the same by you is accepted), `TestAddEntryCap` (41st →
  errMemoryFull), `TestEditEntryBecomesYours`, `TestDropEntryKeepsTheirs` (drop a `you` agreed → errEntryKept, a `you`
  ruledout → errEntryKept; a `you` open → dropped; an `auto` agreed → dropped, `Removed` unchanged),
  `TestWhyOnlyForRuledOut`, `TestEntriesOfAndEntryLine` (arrival order per kind; `- [m3] T (why: W)`),
  `TestOldMemoryLoads` (JSON with no entries/nextentry unmarshals, zero values).
- [ ] **Step 2: Run them and see them fail:** `go test ./pkg/council -run 'Entry|Entries|OldMemory'`.
- [ ] **Step 3: Implement** the types and the moves. Run `task generate`; only `gotypes.d.ts` should change among the
  generated files.
- [ ] **Step 4: Run the tests again; they pass.** `gofmt -l` on the touched Go files prints nothing.
- [ ] **Step 5: Commit** `feat(council): memory entries and their moves`.

### Task 2: Chốt from an entry, the entry moves and the wire
**Depends on:** Task 1
**Files:** `pkg/council/direction.go`, `pkg/council/direction_test.go`, `pkg/council/memory.go`, `pkg/wshrpc/wshrpctypes_council.go`, `pkg/wshrpc/wshserver/wshserver_council.go`, `pkg/wshrpc/wshserver/wshserver_councilmemory_test.go`, `pkg/wshrpc/wshclient/wshclient.go`, `frontend/app/store/wshclientapi.ts`, `frontend/types/gotypes.d.ts`

**Interfaces — Consumes:** Task 1's types and moves. **Produces:**
- `pkg/council/direction.go`: `DirectionIn` gains `Entry string`. `ActionPin` with `Entry` set reads the text from that
  entry (an unknown entry is an error naming it) and sets the direction's `From` to the entry's first message, if any.
  When the direction is set (fits) the entry leaves the list via `takeEntry`; when held, the card keeps `Entry`.
  `SetAnyway` (in `memory.go`) takes the card's entry, if it is still there; `Discard` leaves it. Only a pin carries an
  entry: a `set` never does, so a held card's Edit (the person rewrites the held text and sets it, Task 6) makes a new
  `set` whose result replaces the card (`Hold` or `Choose`), and the entry stays in the list.
- Entry actions: consts `EntryActionAdd = "add"`, `EntryActionEdit = "edit"`, `EntryActionRemove = "remove"`;
  `type EntryIn struct { Action, Entry, Kind, Text, Why string }`;
  `func (r *Runner) MemoryEntry(id string, in EntryIn) (*Council, error)`: refuses an unknown action (naming the known
  ones) before it loads; add is `By: EntryByYou` with `At` now; edit and remove name the entry. It does not call
  `r.changed`, as `Direction` does not.
- The held card's reason for a failed pre-set check, shown in the UI, becomes `Could not check it: <error>` (was
  `The check did not answer: <error>`); update the `direction_test.go` asserts that pin it.
- wshrpc: `CouncilMemoryCommand(ctx context.Context, data CommandCouncilMemoryData) error` with
  `CommandCouncilMemoryData{ Id, Action, Entry, Kind, Text, Why string }` (json lower-case, all but id/action omitempty);
  `CommandCouncilDirectionData` gains `Entry string \`json:"entry,omitempty"\``, passed to `DirectionIn.Entry`. The
  server handler mirrors `CouncilDirectionCommand`: refuse an empty id, call the runner, publish once. Generated:
  `CouncilMemoryCommand` in `wshclientapi.ts` and `wshclient.go`, the data types in `gotypes.d.ts`. Task 6 calls them.

- [ ] **Step 1: Write the failing Go tests.** In `direction_test.go`: `TestPinFromEntryLeavesListWhenSet` (and `From`
  is the entry's first message), `TestPinFromEntryHeldThenDiscardKeepsIt`, `TestPinFromEntryHeldThenSetAnywayTakesIt`,
  `TestHeldPinFromEntryThenSetKeepsEntry` (pin from an entry → held; a plain `set` of rewritten text that fits → the
  direction is set, the held card is gone, the entry is still in the list), `TestPinUnknownEntryRefused`,
  `TestMemoryEntryMoves` (add by you, edit, remove through the runner), `TestMemoryEntryRefusesUnknownAction`. In the new
  `wshserver_councilmemory_test.go`: `TestCouncilMemoryPublishesOncePerMove` (shaped like the direction one in
  `wshserver_council_test.go`, whose helpers it reuses; that file is Task 3's, so do not edit it).
- [ ] **Step 2: Run them and see them fail:** `go test ./pkg/council -run 'PinFromEntry|PinUnknownEntry|MemoryEntry'`
  and `go test ./pkg/wshrpc/wshserver -run 'TestCouncilMemory'`.
- [ ] **Step 3: Implement** the entry path in `checkedDirection` and `SetAnyway`, `MemoryEntry`, the reason wording, the
  wshrpc type and handler. Run `task generate`.
- [ ] **Step 4: Run the tests again; they pass**, and `go test ./pkg/council -run 'Direction|Preset|Held'` for the
  direction tests whose wording changed. `gofmt -l` on the touched Go files prints nothing.
- [ ] **Step 5: Commit** `feat(council): Chốt from an entry and CouncilMemoryCommand`.

### Task 3: The round check keeps the entries up
**Depends on:** Task 1 (uses AddEntry, DropEntry, EntriesOf and entryLine)
**Files:** `pkg/council/memorycheck.go`, `pkg/council/memorycheck_test.go`, `pkg/council/estimate.go`, `pkg/wshrpc/wshserver/wshserver_council_test.go`

**Interfaces — Consumes:** Task 1's moves. **Produces:** `type EntryChange struct { Op, Kind, Text, Why, Entry string; Messages []string }`
(`Op` is `"add"` or `"drop"`); `RoundCheck` gains `Entries []EntryChange`;
`func parseRoundCheck(text string, seen, entries []string) (RoundCheck, error)` (`entries` the entry ids shown).

- [ ] **Step 1: Write the failing tests** in `memorycheck_test.go`: `TestRoundCheckPromptShowsMemory` (the prompt lists
  the direction and each entry by `entryLine`, under `## The council's memory`, marks the person's Agreed and Ruled out
  lines ` (the person's)`, and asks for `"entries"`); `TestParseRoundCheckEntriesWithNoChange`
  (`{"change": false, "entries": [{"op":"add","kind":"agreed","text":"T"}]}` → no direction change, one add);
  `TestParseRoundCheckEntriesWithoutDirection` (`{"entries": [one add]}` alone, and `{"change": true, "entries": [one add]}`
  with no direction → no direction change, no error, the add kept; `{"change": true}` with neither still errors as
  today); `TestParseRoundCheckEntriesFiltered` (unknown kind, empty text, a drop of an id not shown and a message id not
  shown are dropped; a fourth change is cut; text cut at `memoryDirMax`); `TestCheckMemoryAppliesEntries` (a fake caller
  answers one add and one drop of an auto Open: the council saved has the new auto entry with `Round` and `Messages`,
  the Open is gone, a duplicate add is skipped silently); `TestCheckMemoryDropRefusedForYours` (a drop of a `you` agreed
  entry leaves it; a drop of a `you` open takes it); `TestPresetPromptShowsMemory`.
- [ ] **Step 2: Run them and see them fail:** `go test ./pkg/council -run 'RoundCheck|CheckMemory|PresetPrompt'`.
- [ ] **Step 3: Implement.** `roundCheckPrompt` and `presetPrompt` add a `## The council's memory` section (direction,
  then each kind's `entryLine`s with their ids; in the round check's, the person's Agreed and Ruled out lines end
  ` (the person's)`); the round check's rules add: add an entry only for what the seats plainly settled, dropped or left
  open this round, never what the memory already says or rules out, at most three changes; drop only an Open the round
  answered (and add the answer as Agreed) or an entry it made that is wrong, never a line marked the person's. The reply
  shape: `{"change": false}` or the direction fields as today, plus optional
  `"entries": [{"op": "add", "kind": "agreed" | "ruledout" | "open", "text": "<one sentence>", "why": "<for ruledout>", "messages": ["<id>"]}, {"op": "drop", "entry": "<m id>"}]`.
  `parseRoundCheck` reads entries whatever `change` says; a reply with no direction is no direction change when it
  carries entries, and an error only when it carries neither (today's message). `checkMemory` applies them in its
  existing `updateLogged`, `By: EntryByAuto`, the pass's `round`, skipping any change a move refuses.
  `roundCheckTokens` goes from 15_000 to 18_000. `estimate_test.go` uses the const and needs no change;
  `wshserver_council_test.go` pins the literal `15_000` in its `TestCouncilEstimate*` asserts (lines ~160-371,
  `routerAndCheck` included): change each round-check `15_000` to `18_000`, leaving the router's `15_000`.
- [ ] **Step 4: Run the tests again; they pass**, and `go test ./pkg/council -run 'Estimate'` and
  `go test ./pkg/wshrpc/wshserver -run 'TestCouncilEstimate'`.
- [ ] **Step 5: Commit** `feat(council): the round check adds and drops memory entries`.

### Task 4: Seats, the synthesis and the document read the whole memory
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
  `TestMarkdownMemorySection` (`## Memory` above the Report: the direction, `Earlier directions` each ending with its
  own end word and time from `memoryEnded` (`replaced 22:25`, `edited 22:40`, `unpinned 22:50` in one fixture), then
  `### Agreed`, `### Ruled out` with why, `### Open`) and `TestMarkdownNoMemory`.
- [ ] **Step 2: Run them and see them fail:** `go test ./pkg/council -run 'SeatPrompt|Synthesis|Markdown'`.
- [ ] **Step 3: Implement.** The rule lines, one per kind: Agreed "settled as true: do not argue it again unless you
  bring new evidence"; Ruled out "dropped: do not propose it again unless you say what is new"; Open "still to settle:
  work on these first". `writeMemory` in `markdown.go` writes the new section; the direction's struck `~~…~~` lines
  become plain list items ending `<memoryEnded(d)> <time>`. Bump `HarnessVersion` to `2026-11-05.1`: this run changes
  the seat, synthesis and round check prompts (Task 3's too), and the const lives here.
- [ ] **Step 4: Run the tests again; they pass** (and `go test ./pkg/council -run 'Prompt'` for the rest of the prompt
  tests).
- [ ] **Step 5: Commit** `feat(council): seats and the document read the whole memory`.

### Task 5: The Memory tab's model
**Depends on:** Task 1 (uses CouncilMemoryEntry from gotypes.d.ts)
**Files:** `frontend/app/view/agents/councilmemorymodel.ts`, `frontend/app/view/agents/councilmemorymodel.test.ts`

**Interfaces — Consumes:** `CouncilMemoryEntry`, `CouncilMemory.entries` from the generated types. **Produces**
(existing exports keep their signatures; Task 6 moves callers over):
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
  suggestion → `Suggested direction`; `replacedRows`' `line` → `<ended> <time>` (`replaced 22:25`, `edited 22:25`,
  `unpinned 22:25`), the how dropped from the line (it stays in `how`).

- [ ] **Step 1: Write the failing tests** in `councilmemorymodel.test.ts`, one `describe` per export above, with the
  spec's values (`Auto · round 3`, `replaced 22:25`, an edited one reading `edited 22:25`, the four meanings verbatim),
  plus `old council with no entries` (count 0 or 1, no dot from entries, `memoryEntries` empty).
- [ ] **Step 2: Run and see them fail:** `npx vitest run frontend/app/view/agents/councilmemorymodel.test.ts`.
- [ ] **Step 3: Implement** in `councilmemorymodel.ts`; update the existing tests whose copy changed.
- [ ] **Step 4: Run again; they pass.**
- [ ] **Step 5: Commit** `feat(council): the Memory tab's model for entries`.

### Task 6: The Memory tab drawn as one list
**Depends on:** Task 2 (calls CouncilMemoryCommand and the direction's entry), Task 5
**Files:** `frontend/app/view/agents/councilmemory.tsx`, `frontend/app/view/agents/councilchat.tsx`, `frontend/app/view/agents/councilstore.ts`, `frontend/app/view/agents/councilmemoryseen.ts`, `frontend/app/view/agents/councilmemorymodel.ts`, `frontend/app/view/agents/councilmemorymodel.test.ts`, `CHANGELOG.md`

**Interfaces — Consumes:** Task 5's model; Task 2's `CouncilMemoryCommand` and `entry` on the direction data.
**Produces** (Task 7's scenario reads these): on the panel `data-council-memory`; the card as today
(`data-council-memory-card`, `-kicker`, `-card-text`, `-reason`, actions `accept`, `dismiss`, `edit-held`,
`setanyway`, `discard`), its reason's message links `data-council-memory-reason-link="<id>"`; the direction row
`data-council-memory-direction`; each entry `data-council-memory-entry="<id>"` with `data-kind`; a badge
`data-council-memory-badge="<kind>"` whose `title` is its meaning; `data-council-memory-new` on the new dot; the details
button `data-council-memory-details` and its popover `data-council-memory-popover`, its message links
`data-council-memory-message="<id>"`; row actions `data-council-memory-action` = `chot`, `edit`, `remove`, `unpin`,
`earlier`; earlier rows `data-council-memory-earlier-row`; the in-place editor `data-council-memory-editor` with
`data-council-memory-edit-text`, `data-council-memory-edit-why` and actions `save`, `cancel`; the add form
`data-council-memory-add` with kind radios `data-council-memory-kind="<kind>"`, `data-council-memory-add-text`,
`data-council-memory-add-why`, actions `add`, `cancel`; the empty state `data-council-memory-empty` and
`data-council-memory-legend`; in the tab strip `data-council-memory-open-add` and the existing
`data-council-memory-dot` (the `council-discussion` scenario reads it too, so keep it).

- [ ] **Step 1: Store and seen state.** `councilstore.ts`: `memoryCouncil(id: string, action: "add" | "edit" | "remove", fields: { entry?: string; kind?: string; text?: string; why?: string }): Promise<CouncilCall<void>>`
  and an optional fifth `entry?: string` on `directionCouncil`. `councilmemoryseen.ts`: `memorySeenAtom`, an
  `atomWithStorage<Record<string, number>>("council.memory.seen", {})`, read and written per council id. Opening the
  Memory tab snapshots the old time for the panel's new dots, then writes now.
- [ ] **Step 2: The panel.** Rewrite `councilmemory.tsx` to the boards `C-merged`, `C-add`, `C-empty`: the card at the
  top (the reason's message ids are links that call `onShow([id])`; Show the messages goes), the direction row (15px,
  medium), Earlier · N unfolding the replaced directions (each `replacedRows` line), entries newest first, the Ruled out
  why on a muted line, the badge line. Row actions and the details button show on hover and on focus-within (`group`).
  The details popover opens on hover or focus of its button (`PopoverReveal`), message ids opening their thread through
  `onOpenSource` (`directionSource(c, id)`, which the model exports for this). Moves:
  - Add form, opened from the tab strip: the kind picker (Direction / Agreed / Ruled out / Open, Why only for Ruled
    out); Direction posts `directionCouncil(id, "set", text)`, the others `memoryCouncil(id, "add", { kind, text, why })`.
  - Edit on an entry turns its text (and why, for Ruled out) into the in-place editor; Save posts
    `memoryCouncil(id, "edit", { entry, text, why })`. Edit on the direction does the same and posts
    `directionCouncil(id, "edit", text)`. Unpin posts `directionCouncil(id, "unpin")`.
  - Chốt on an entry posts `directionCouncil(id, "pin", entry.text, undefined, entry.id)`; Remove posts
    `memoryCouncil(id, "remove", { entry })`.
  - The held card's Edit (`edit-held`) opens the Add form with Direction picked and the held text in it, focused (the
    Set the direction input it filled is gone); its Add posts `set` with no entry, so an entry the held pin came from
    stays in the list (Task 2).
  Every move goes through `acts.run`, one at a time, a refusal shown under the form or editor as today. Delete the model
  exports nothing calls any more (`memoryEmpty`, `memoryDot` if unused) and their tests.
- [ ] **Step 3: The tab strip** in `councilchat.tsx`: the label `Memory · N` (`memoryCount`, no ` · 0`), the dot from
  `memoryDotOn`, and `+ Add` left of the fold button while Memory is the tab.
- [ ] **Step 4: `CHANGELOG.md`**, under Changed in the top section: "The council's Memory tab is now the council's
  memory: one list of what the seats agreed on, ruled out and left open, kept up after each round, with the direction
  pinned on top. Every seat reads it before it answers."
- [ ] **Step 5: Check:** `NODE_OPTIONS=--max-old-space-size=4096 task check:ts` exits 0;
  `npx vitest run frontend/app/view/agents/councilmemorymodel.test.ts` passes; `npx prettier --check` and
  `npx eslint` on the touched `.ts`/`.tsx` files pass.
- [ ] **Step 6: Commit** `feat(council): the Memory tab drawn as one list`.

**Acceptance (under Final):** Task 7's `council-memory` steps show each part: the list, badges, new dots and tab label
(`list`), the suggestion card's message links (`suggestion`), keyboard-reached actions and the details popover
(`details`), the Add form (`add`), in-place Edit (`edit`), Chốt and the held card's Edit / Set anyway / Discard
(`chot`, `held`), Remove (`remove`), the direction's Edit and Unpin (`direction`), Earlier (`earlier`) and the empty
legend (`empty`).

### Task 7: The council-memory scenario for the new boards
**Depends on:** Task 6 (uses its data attributes)
**Files:** `scripts/cdp/council/memory.mjs`

Every step stubs `CouncilDirectionCommand` and `CouncilMemoryCommand`, asserts the recorded call, then writes the council
with the memory the backend would have saved and announces it, as the file does today. The fixture's memory is neutral
content (a made-up caching feature), built in this file. Each step records its result under the name given here and
takes a shot `cdp-shots/council-memory-<name>.png`; Final runs the scenario and its verifier judges the shots against
the boards named.

- [ ] **Step 1: Rewrite the steps** (the held-card steps of today kept, adjusted to the new layout):
  1. `list` (board C-merged): a council with a direction, one earlier direction that ended `edited`, two Agreed (one
     auto, round 3, resting on a message; one yours), two Ruled out (one with a why), two Open (one yours) and one
     waiting suggestion whose reason rests on two messages: the direction row is first, entries are newest first, each
     badge's word and `title` match the meanings, the new dot shows on entries after the seen time and not before, the
     tab reads `Memory · 7` with its dot, and `+ Add` shows in the tab strip (and not while another tab is shown);
  2. `suggestion`: the card's kicker reads `Suggested direction`, its reason is followed by two
     `data-council-memory-reason-link`s, and clicking one brings that message into view in the channel;
  3. `details` (board C-merged, the hovered entry): focus the auto Agreed's details button (focus, not hover): its
     actions and the popover show, reading `Auto · round 3` and its message link; the yours entry's popover reads
     `You · <time>`; nothing on the badge line wraps (each badge's height is one line);
  4. `add` (board C-add): open Add from the tab strip, pick Ruled out, type the text and a why, Add: the call is
     `{action: "add", kind: "ruledout", text, why}` and the new entry shows at the top;
  5. `edit`: Edit the yours Ruled out in place, change text and why, Save: the call is
     `{action: "edit", entry, text, why}` and the new text shows;
  6. `chot`: Chốt on an Agreed entry: the call is `{action: "pin", text, entry}`; after the saved direction is announced,
     the entry is gone from the list and its text is the direction;
  7. `held`: Chốt on another entry comes back held: the card shows; its Edit opens the Add form with Direction picked
     and the held text in it; then Set anyway (`{action: "setanyway"}`, the entry gone after the announce) and, on a
     second held pin, Discard (`{action: "discard"}`, the entry still listed);
  8. `remove`: Remove an entry: `{action: "remove", entry}`, and it leaves the list;
  9. `direction`: the direction's Edit, new text, Save: `{action: "edit", text}`; then Unpin: `{action: "unpin"}`, and
     the direction row is gone;
  10. `earlier` (board C-add, Earlier unfolded): Earlier · 1 unfolds the replaced direction reading `edited <time>`,
      with no strikethrough;
  11. `empty` (board C-empty): a council with nothing: the empty line verbatim and the legend's four badges with their
      meanings.
- [ ] **Step 2: Check it loads:** `node --check scripts/cdp/council/memory.mjs` exits 0, and every selector it uses is
  one Task 6 lists (grep `councilmemory.tsx` and `councilchat.tsx` for each). Do not start a dev app: Final runs the
  scenario on the merged result.
- [ ] **Step 3: Commit** `test(cdp): council-memory draws the one-list memory`.
