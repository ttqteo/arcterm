# Brainstorm in Chat: boards and Decided always visible — plan

**Spec:** `docs/superpowers/specs/2026-11-14-chat-brainstorm-status-design.md`
**Verify:** `node scripts/verify.mjs ./pkg/jarvis`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs chat-brainstorm-band chat-brainstorm-review chat-initiative-band`
**Prototype:** D:\work\arcterm\.superpowers\design\chat-brainstorm-status\project

Goal: while a brainstorm is attached to an agent, its Chat always shows how many boards the brainstorm has (with a dot
for boards new since you last looked at the Brainstorm tab) and the decisions that are yours, in a brainstorm part of
the band under the header that run 175af141 landed for the initiative; the header's Brainstorm tab carries the same
new-board dot; and the Confirm and builder check cards draw a changed decision as the Brainstorm tab's review does
(− / + sentence lines, the Why line, the answer line). Read the spec first. This plan is written against the band as it
landed on `main` (`initiativeband.ts`, `initiativebandstore.ts`, `initiativebandview.tsx`, `chatpane.tsx:783`,
`bindings.ts` `agent:initiative`). The decisions below are the ones made beyond the spec (autonomous run, no one to
ask), each with its reason; a task restates the ones it relies on.

## Decisions beyond the spec

1. **One pure module for what the brainstorm part reads**, `frontend/app/view/agents/brainstormband.ts`: the board
   names (every part's `boards`, notes included, in part order then board order, without repeats; none when the file has
   no `canvas`, as `questionCard`'s `boards` count already says, since a board without a canvas cannot be opened), each
   board's part (the title of the first part that lists it), which are new against the seen names, the `Decided` list
   (`yoursGists`, reused, not copied), and the seen-names map's parse and prune. Why: the store, the poller, the view and
   the header dot all need the same "which boards are new", so it is defined once.
2. **Seen names live in `brainstormstore.ts`**, beside `brainstormSeenAtom` (the same "what the user has seen, keyed by
   the file's path" idea), in localStorage `chat.brainstorm.seenBoards` as `{ [path]: { names: string[]; at: number } }`,
   pruned to the newest `MAX_ANSWER_AGENTS` (40) paths by `at`, the cap `chat.brainstorm.sent` uses. A path with no
   entry has seen nothing: all its boards are new (spec §5). A storage that throws degrades to memory and warns once, as
   `chatbrainstormstore.ts` does.
3. **"The Brainstorm tab is shown" is `BrainstormState.mode === "brainstorm"`**, which is what the header reads for its
   `view` (`agentheader.tsx:427`). Names are taken in `setBrainstormMode(…, "brainstorm", …)` (from the state's `file`,
   when it has one) and in the poller's `pollAndMerge` after a read that returned a file, when the merged state's mode
   is `brainstorm`. The raw `file` is read, not `shownBrainstormFile`: the boards are the same, and the store must not
   depend on the sent-line overlay.
4. **The open part is one value per agent.** `initiativebandstore.ts`'s open set becomes a list of
   `{ id, part: "initiative" | "brainstorm" }`, still under the key `chat.initiative.band` and still the newest 200. The
   old shape (a list of ids) reads as `initiative` open, so an open band survives the update. Why keep the key: renaming
   it changes nothing a person sees. The `chat-initiative-band` scenario does change in two places: its `setBand`
   helper (`scenarios-chat-initiative-band.mjs:178`) and its teardown (`:906`) call `setBandOpen`, which goes, so Task 2
   moves both to `setBandPart(id, open ? "initiative" : null)`.
5. **The DOM contract.** The band's root keeps `[data-initiative-band="<agentId>"]` (with `data-band-open` when the
   initiative part is expanded, `data-band-narrow`, `data-owns-keys`, and every `data-band-*` attribute inside it as
   today) whenever the agent has an initiative, so the `i` binding's "a band is on screen" test reads "a band with an
   initiative part" with no change (spec §2, Keys) and `chat-initiative-band` keeps passing. Every band root also
   carries `[data-chat-band="<agentId>"]` and `data-chat-band-open="initiative|brainstorm"` while a part is open. The
   brainstorm part: `[data-brainstorm-band="<agentId>"]` (the clickable part of the line, `aria-expanded`),
   `[data-bsband-title]` (only for a brainstorm-only agent), `[data-bsband-boards]` (`N boards`, absent with no boards),
   `[data-bsband-new]` (`N new`, absent with none new), `[data-bsband-decided]` (`Decided N`); the expanded part
   `[data-bsband-body]`, one `[data-bsband-decision="<part id>"]` per yours decision, one
   `[data-bsband-board="<file name>"]` per board (a button) with `data-new` when new, and one
   `[data-bsband-open-brainstorm]`, the `Open in Brainstorm (b)` link drawn once after the board rows, as board A and the
   spec draw it. The header's new-board dot is `[data-brainstorm-tab-new]`. The diff lines
   in Chat's decision rows are `[data-diff-line="added|removed"]`, the answer line `[data-brainstorm-said]` (the
   existing `SaidLine`), the cause `[data-chat-bscard-why]`.
6. **A click on a board, or the link, opens the Brainstorm tab** through `setAgentView(agent.id, "brainstorm",
   Date.now())` (`agentview.ts`), which stamps the view and so takes the seen names; it does not also open that board
   (spec §2 says the tab). Expanding the part never marks anything seen.
7. **Keys in the band.** `m` and `n` keep working anywhere in the band (spec: "the `m` key still works");
   `w`, `↑`/`↓` and `Enter` act on the initiative rows only while the initiative part is open; `i` toggles the
   initiative part (opening it over an open brainstorm part); `Esc` closes whichever part is open, and with none open
   hands the keyboard back to the chat box, as today. The brainstorm part has no key of its own and no arrow cursor; its
   board rows and links are buttons reached with Tab.
8. **Mark done with a brainstorm part beside.** The line drops its `Mark done` button (spec §2); the expanded
   initiative view gains a `Mark done` button (with its `m` keycap) in its action row, shown only in that case, calling
   the same `markDone` the line's button does. `[data-band-mark-done]` stays the attribute of whichever is drawn.
9. **The diff is computed once.** `brainstormmodel.ts` gains `changedSentences(was, body)` (`sentenceDiff` without the
   `same` sentences); `ChangeDiff` and `DecisionRowModel` both use it, and `brainstormui.tsx` gains one component,
   `SentenceDiffLines({ lines })`, that draws such lines and that `ChangeDiff` and Chat's `DecisionRow` both render.
   The spec says the component "takes `was` and `body`"; it takes the computed lines instead, so the lines Chat draws
   are exactly the ones `chatbrainstorm.test.ts` checks. `DecisionRowModel` drops `was` (only the `Was:` line read it)
   and carries `body`, `said?` and `diff`.
10. **The CHANGELOG, `docs/hand-checks.md`, `docs/keyboard-shortcuts.md` and `docs/guide/agent.md` belong to Task 4**,
    which writes the lines for Task 3's card change too, so no two tasks that can run at once edit them.
11. **The narrow initiative part drops its chunk label only beside a brainstorm part.** The landed `bandLabels` clips
    the chunk label in a narrow cell and never drops it; the spec's "drops its chunk label first" is read as: with a
    brainstorm part beside it, a narrow initiative part hides the label (the brainstorm part needs the room). An
    initiative-only narrow band keeps clipping it, so `chat-initiative-band`'s narrow step does not change.
12. **The header dot rule is pure** and lives in Task 1's `brainstormband.ts`: `brainstormTabDot(newCount, asking,
    shown): "asking" | "new" | null`: `asking` when the agent asks (amber, whatever else), `new` when not asking, not
    shown and `newCount > 0`, else null. The header only draws what it returns.

## Tasks

### Task 1: The brainstorm part's model and the seen board names
**Depends on:** none
**Files:** `frontend/app/view/agents/brainstormband.ts`, `frontend/app/view/agents/brainstormband.test.ts`, `frontend/app/view/agents/brainstormstore.ts`, `frontend/app/view/agents/brainstormstore.test.ts`, `frontend/app/view/agents/brainstormpoller.ts`, `frontend/app/view/agents/brainstormpoller.test.ts`

Decisions 1, 2 and 3. No UI.

`brainstormband.ts` (new, pure; imports `yoursGists` and `Gist` from `chatbrainstorm.ts` and `BrainstormFile` from
`brainstormmodel.ts`) exports at least:

- `boardNames(f: BrainstormFile): string[]`, as decision 1 says.
- `type BandBoard = { name: string; part: string; isNew: boolean }` and
  `type BrainstormBandModel = { title: string; boards: BandBoard[]; newCount: number; decided: Gist[] }`.
- `brainstormBandModel(f: BrainstormFile, seen: readonly string[] | null): BrainstormBandModel`: `seen` null (no entry
  for the path) makes every board new; `title` is `f.title`.
- `brainstormTabDot(newCount: number, asking: boolean, shown: boolean): "asking" | "new" | null` (decision 12).
- `type SeenBoards = Record<string, { names: string[]; at: number }>`, `parseSeenBoards(raw: string | null | undefined):
  SeenBoards` (anything malformed is dropped entry by entry, never thrown), and `withSeenBoards(map, path, names, now):
  SeenBoards` (the same object back when the names are already the stored ones; otherwise the entry set with `at: now`
  and the map pruned to the newest 40 paths by `at`).

`brainstormstore.ts` gains `SEEN_BOARDS_KEY = "chat.brainstorm.seenBoards"`, `brainstormSeenBoardsAtom` (seeded from
localStorage at module load), `markBoardsSeen(path: string, f: BrainstormFile, now: number): void` (writes the atom and
localStorage; a throwing storage warns once and keeps memory), and
`brainstormBandAtom(agentId): Atom<BrainstormBandModel | null>` (an `atomFamily`; null when no brainstorm is attached or
its file has not been read yet). `setBrainstormMode(agentId, "brainstorm", now)` also calls `markBoardsSeen` with the
state's file when it has one. `brainstormpoller.ts`'s `pollAndMerge` calls `markBoardsSeen` after a merge that read a
file while the agent's state is in `brainstorm` mode (export `pollAndMerge` for its test if needed).

Acceptance (vitest):
- `npx vitest run frontend/app/view/agents/brainstormband.test.ts`: board count across parts without duplicates and in
  order; no canvas gives no boards; each board's part is the first part listing it; new boards from seen names, and
  every board new with no entry; `newCount`; `decided` equals `yoursGists(f)`; the no-boards state (`boards` empty,
  `decided` still listed); `parseSeenBoards` on garbage, a non-object, and bad entries; `withSeenBoards` returning the
  same map for unchanged names and pruning past 40 by `at`; `brainstormTabDot` for asking with new boards (`asking`),
  not asking with new boards (`new`), the tab shown (null), and no new boards (null).
- `npx vitest run frontend/app/view/agents/brainstormstore.test.ts -t "seen board"`: names taken when the tab opens
  (`setBrainstormMode` to `brainstorm`), not when it goes back to `terminal`; persisted under
  `chat.brainstorm.seenBoards`; `brainstormBandAtom` reports a board added after that as new.
- `npx vitest run frontend/app/view/agents/brainstormpoller.test.ts -t "seen board"`: a poll that reads a changed file
  for an agent whose tab is shown refreshes the seen names (a board added while the tab is shown is not new afterwards);
  for an agent not in brainstorm mode (an unfocused split cell) the poll leaves the seen names alone and
  `brainstormBandAtom` reports the new board.

### Task 2: The band's open state names a part
**Depends on:** none
**Files:** `frontend/app/view/agents/initiativebandstore.ts`, `frontend/app/view/agents/initiativebandstore.test.ts`, `frontend/app/view/agents/initiativebandview.tsx`, `frontend/app/store/keybindings/bindings.ts`, `frontend/app/store/keybindings/bindings.test.ts`, `scripts/cdp/scenarios-chat-initiative-band.mjs`

Decision 4. Replaces the boolean open set with which part is open, and moves every caller onto it with no visible change.

`initiativebandstore.ts`: `export type BandPart = "initiative" | "brainstorm"`; `bandPartsAtom` (a list of
`{ id: string; part: BandPart }`, oldest first, the newest 200, seeded from `chat.initiative.band`, `BAND_STORAGE_KEY`
unchanged); `coerceBandOpen(raw)` returns that list, reading a bare string entry (the landed shape) as `initiative`,
dropping anything else and repeats; `withBandPart(list, agentId, part: BandPart | null)`; `useBandPart(agentId):
BandPart | null`; `setBandPart(agentId, part | null)`; `toggleBandPart(agentId, part)` (opens `part`, replacing the other
part if that one was open, or closes it when it is the open one). `bandOpenAtom`, `useBandOpen`, `setBandOpen`,
`toggleBand` and `withBandOpen` go; grep their names across `frontend/` and `scripts/` and leave no reference.

`initiativebandview.tsx` reads `useBandPart(agent.id) === "initiative"` where it read `useBandOpen`, and calls
`setBandPart(agent.id, "initiative" | null)` where it called `setBandOpen`. `bindings.ts` `agent:initiative` calls
`toggleBandPart(agent.id, "initiative")` where it called `toggleBand`; its comment says the band's initiative part.
`scripts/cdp/scenarios-chat-initiative-band.mjs`: the `setBand` helper (line 178, `S.setBandOpen(id, open)`) and the
teardown (line 906, `B.setBandOpen(id, false)`) call `setBandPart(id, open ? "initiative" : null)` and
`setBandPart(id, null)`; nothing else in the scenario changes.

Acceptance:
- `npx vitest run frontend/app/view/agents/initiativebandstore.test.ts`: the old shape `["a1","a2"]` reads as both
  `initiative`; `toggleBandPart` opens, switches one agent from `brainstorm` to `initiative` (one part at a time), and
  closes; other agents untouched; persisted shape round-trips; garbage reads as none; the 200 cap.
- `npx vitest run frontend/app/store/keybindings/bindings.test.ts -t "initiative"`: the existing `i` cases pass against
  `bandPartsAtom`, plus one: with the agent's brainstorm part open, `i` makes the initiative part the open one.
- The `chat-initiative-band` scenario still passes (its steps are the acceptance for no visible change; Final runs it).

### Task 3: A changed decision in Chat's cards shows what changed
**Depends on:** none
**Files:** `frontend/app/view/agents/brainstormmodel.ts`, `frontend/app/view/agents/brainstormmodel.test.ts`, `frontend/app/view/agents/brainstormui.tsx`, `frontend/app/view/agents/chatbrainstorm.ts`, `frontend/app/view/agents/chatbrainstorm.test.ts`, `frontend/app/view/agents/chatbrainstormparts.tsx`, `scripts/cdp/scenarios-chat-brainstorm-review.mjs`

Spec §6 and decision 9.

- `brainstormmodel.ts`: `export function changedSentences(was: string, body: string): SentenceDiff` — `sentenceDiff`
  with the `same` entries left out.
- `brainstormui.tsx`: `export function SentenceDiffLines({ lines }: { lines: SentenceDiff })` draws the lines as
  `ChangeDiff` draws them today (− removed in the removed colour, + added in the added colour), each line with
  `data-diff-line="added|removed"`; `ChangeDiff` renders `SentenceDiffLines` with `changedSentences(part.was ?? "",
  part.body)` and keeps its Why line. The Brainstorm tab looks the same.
- `chatbrainstorm.ts`: `DecisionRowModel` drops `was` and gains `body: string`, `said?: PartAnswer` and
  `diff: SentenceDiff` (empty for a `guess` row, `changedSentences(was, body)` for a `changed` one). `checkCard` fills
  them from the `ReviewRow` (`r.body`, `r.said`, `r.was`); `confirmCard` from `p.body`, `partAnswer(f, p)` (left out when
  null) and `p.was`. Grep `DecisionRowModel` and `.was` readers of the rows across `frontend/` so nothing still reads
  `row.was`.
- `chatbrainstormparts.tsx` `DecisionRow`: for a `changed` row, the `Was: …` line is replaced by the `SaidLine` (when
  `said` is set, closed), the `SentenceDiffLines` of `row.diff`, and the `Why: …` line kept as
  `[data-chat-bscard-why]`.

Acceptance:
- `npx vitest run frontend/app/view/agents/chatbrainstorm.test.ts`: the case at ~978 that checks `was`/`why` checks
  `body`, `diff` (exact removed/added sentences, no `same`) and `why` instead; a Confirm card's changed row carries
  `said` when the part came from an answer and none when it did not; a guess row's `diff` is empty.
- `npx vitest run frontend/app/view/agents/brainstormmodel.test.ts -t "changedSentences"` (add the case beside
  `sentenceDiff`'s).
- CDP, `chat-brainstorm-review`: in the step that shows the Confirm card with the changed `limits` / `timeout` rows and
  in the step that shows the builder check's review, assert the changed row draws `[data-diff-line="removed"]` with the
  old sentence, `[data-diff-line="added"]` with the new one, `[data-chat-bscard-why]` with the cause, no `Was:` text,
  and, for a row whose part came from an answered question, `[data-brainstorm-said]`. `partAnswer` needs more than a
  `from`: the fixture's `designFile` has `history: []`, so give it a history entry with an `n`, the answer, and an
  `into` listing that changed part's id (read `partAnswer` in `brainstormmodel.ts` for the exact fields), and set that
  part's `from` to match. Each assert is part of an existing step's shot, or a
  new sub-step with its own shot, as the file's header describes.

### Task 4: The shared band, its brainstorm part and the new-board dot
**Depends on:** Task 1 (the band model, `brainstormBandAtom` and the seen names), Task 2
**Files:** `frontend/app/view/agents/chatband.tsx`, `frontend/app/view/agents/brainstormbandview.tsx`, `frontend/app/view/agents/initiativebandview.tsx`, `frontend/app/view/agents/initiativeband.ts`, `frontend/app/view/agents/initiativeband.test.ts`, `frontend/app/view/agents/chatpane.tsx`, `frontend/app/view/agents/agentheader.tsx`, `scripts/cdp/scenarios-chat-brainstorm-band.mjs`, `scripts/cdp/scenarios.mjs`, `docs/keyboard-shortcuts.md`, `docs/guide/agent.md`, `docs/hand-checks.md`, `CHANGELOG.md`

Spec §§1–3 and 5, decisions 5 to 8 and 10, the Prototype board `A-shared-band.dc.html` for the look (UI strings
English; spacing and type follow the initiative band and `DESIGN.md`; colours from `@theme` tokens only).

- **Structure.** `chatpane.tsx` mounts the band when the agent has an initiative or a brainstorm attached
  (`brainstormAtom(agent.id)` non-null), above the scroller as today. The shared band (`chatband.tsx`) owns the root
  (decision 5's attributes, the width measurement against `NARROW_BAND_PX`, the 36px line, the one `AnimatePresence`
  region below it with the initiative band's expand animation, `usePartMotion(springReveal)`) and lays out: the
  initiative part, a vertical divider, the brainstorm part. Refactor `initiativebandview.tsx` into pieces the shared
  band places (its line content, its expanded view, its key handler) with every `data-band-*` attribute, behaviour and
  key it has today; how to split it is the worker's call. `brainstormbandview.tsx` draws the brainstorm part's line and
  expanded view from `brainstormBandAtom`.
- **Line.** Initiative part as today minus its `Mark done` button when a brainstorm part is beside it (decision 8; the
  expanded initiative view gains the button then). Brainstorm part: a lightbulb icon, `Brainstorm`, the board icon and
  `N boards` (not drawn with no boards), an accent dot and `N new` when boards are new, a divider, `Decided N`, a
  chevron; for a brainstorm-only agent its title first. Narrow (decision 11): `bandLabels(narrow, brainstormBeside)`
  in `initiativeband.ts` gains a `chunkLabel: boolean` field, false only when `narrow && brainstormBeside`, and the view
  leaves the chunk label out when it is false; the brainstorm part keeps its icon, count with dot, and `Decided N`.
- **Expanded brainstorm part,** pushing the conversation down, never over it: two columns (one in a narrow cell),
  `Decided N` (title then gist per row, design order) and `Boards N` (board icon, file name with a `new` tag, its part,
  then one `Open in Brainstorm (b)` link after the rows; rows and link are buttons; no thumbnail, no board page loaded).
  A click on a row or the link opens the Brainstorm tab (decision 6). One part open at a time (`toggleBandPart`).
- **Keys** as decision 7. `docs/keyboard-shortcuts.md` updates the `i` row: the band can hold a brainstorm part, which
  has no key of its own, Tab reaches its boards, `Esc` closes whichever part is open, `i` opens the initiative part
  over it.
- **Header dot.** `agentheader.tsx` draws what `brainstormTabDot(brainstormBandAtom(agent.id)?.newCount ?? 0,
  brainstormAsking, view === "brainstorm")` returns (decision 12): `asking` the existing amber dot, `new`
  `[data-brainstorm-tab-new]` (accent dot, `aria-label "new boards"`, as the Canvas tab's).
- **Docs.** `CHANGELOG.md` `Unreleased`: one `Added` line for the band's brainstorm part and the new-board dot, with
  no try marker (`agent:initiative` is not a global binding, which `whatsnew.test.ts` requires), and one `Changed` line
  for changed decisions in Chat's cards showing the − / + lines and the answer. `docs/guide/agent.md` is written in
  Vietnamese: in Vietnamese, the band section (~372-389) covers the brainstorm part, and the `i` mentions at ~389 and
  ~513 say `i` is the initiative part's key. `docs/hand-checks.md`: one `- [ ]` line for the band on a live agent with an initiative
  and a brainstorm, a new board arriving while the agent works.

Acceptance:
- `npx vitest run frontend/app/view/agents/initiativeband.test.ts -t "bandLabels"`.
- CDP: new scenario `chat-brainstorm-band` in `scripts/cdp/scenarios-chat-brainstorm-band.mjs`, registered in
  `scripts/cdp/scenarios.mjs` beside `chatInitiativeBandScenarios` (model its arrange/teardown on
  `scenarios-chat-initiative-band.mjs` and `scenarios-chat-brainstorm-review.mjs`: a fixture Claude agent linked to a
  fixture initiative with a `brainstorm.json` attached that has a canvas, 3 boards over 2 parts, 4 yours decisions, and
  `chat.brainstorm.seenBoards` preset with 2 of the 3 names; a second, brainstorm-only agent with a file that has no
  boards). The seen names are read at module load, so the preset is written to localStorage and the page reloaded
  before step 1, as `chat-initiative-band` does for `chat.initiative.band`. For steps 1 to 3 the first file is board
  A's state: the agent working between two questions (`working` set, `question: null`, an answered question in
  `history`). One shot per step:
  1. `collapsed`: both parts on one line; `[data-bsband-boards]` reads `3 boards`, `[data-bsband-new]` `1 new`,
     `[data-bsband-decided]` `Decided 4`; no `[data-band-mark-done]` on the line; the Brainstorm tab carries
     `[data-brainstorm-tab-new]`.
  2. `brainstorm-open`: a click on `[data-brainstorm-band]` opens `[data-bsband-body]` with 4 `[data-bsband-decision]`
     and 3 `[data-bsband-board]` rows, exactly one with `data-new`, and one `[data-bsband-open-brainstorm]` after them;
     `data-chat-band-open="brainstorm"`; no `[data-chat-bscard-kind]` question card is drawn; the conversation's
     scroller top moved down by the body's height (not covered); the tab dot is still there.
  3. `initiative-over`: `i` makes `data-chat-band-open="initiative"`, `[data-bsband-body]` gone, the initiative's
     expanded view shows and has `[data-band-mark-done]`; `Esc` closes it.
  3b. `mark-done-key`: with the band collapsed and focused (no `[data-band-mark-done]` on the line), `m` marks the
     agent's chunk done: the fixture initiative's chunk reads `done` afterwards (read it as `chat-initiative-band`'s
     Mark done step does).
  4. `board-click`: reopen the brainstorm part, click the new board's row: the Brainstorm tab is the shown view; back to
     Chat, `[data-bsband-new]` and `[data-brainstorm-tab-new]` are gone and no row has `data-new`.
  5. `new-board`: the fixture writes a fourth board into `brainstorm.json` while the agent's Chat is shown: within the
     poll interval `[data-bsband-new]` reads `1 new` and the tab dot is back.
  6. `brainstorm-only`: the second agent's band has `[data-chat-band]`, no `[data-initiative-band]`, its
     `[data-bsband-title]`, no `[data-bsband-boards]`, `Decided 0`; `i` opens the Link to initiative picker.
  7. `narrow`: the first agent in a narrow cell (`data-band-narrow`): no chunk label, the brainstorm part keeps
     `[data-bsband-boards]` with its dot and `[data-bsband-decided]`.
- `chat-initiative-band` and `chat-brainstorm-review` still pass.
