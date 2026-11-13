# Add to an initiative from Chat — Implementation Plan

**Goal:** From a Claude agent's Chat, add a chunk, a note on a chunk, or a new initiative without leaving the
conversation: an inline card the agent proposes with an `arc-initiative` fenced block or the person opens from a
message, which folds into one row once handled, and whose outcome rides the person's next plain message to the agent.

**Architecture:** frontend only, no wavesrv or wire change. A pure model `chatinitiative.ts` (parse, target, card
state, labels, result lines, the stored maps' pure updates), a thin persisted store `chatinitiativestore.ts`
(localStorage + jotai, and the one write through `effortstore.ts` / `EffortCreateCommand`), the card and its rows
`chatinitiativecard.tsx`; the conversation, the markdown renderer, the message menu and the composer only call into
them.

**Tech Stack:** React 19 + jotai + Tailwind 4 + motion (`springReveal`), vitest, CDP scenarios.

**Effort:** effort:7655bf18-619e-40cf-8805-5f4a6e5ac85e
**Spec:** `docs/superpowers/specs/2026-11-12-chat-add-to-initiative-design.md` — read it first; it holds the copy, the
states and the agent's calls this plan implements.
**Verify:** `node scripts/verify.mjs ./skills/...`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs chat-initiative agent-chat`
**Prototype:** D:\work\arcterm\.superpowers\design\chat-add-to-initiative\project

## Decisions made beyond the spec (with why)

1. **A proposed block's handled record is keyed by a hash of the block's content alone**, not content plus position.
   The spec's reason for the key is that a fork must see its copied cards as handled. A position is not stable across
   a fork (wavesrv cuts the transcript and Claude's `--fork-session` writes a new session file, so neither the entry
   index nor, provably, the record uuid survives) nor across a Chat window that loads earlier entries. Content alone
   survives both. The cost: an agent that writes the very same block again (after a Dismiss, say) sees it drawn as the
   handled row, and is not told again; the skill tells it to word a new proposal differently. The content is
   normalised (the parsed object re-serialised with sorted keys) so whitespace differences do not split a key. Task 5
   updates spec §8 to say this.
2. **The hash is the existing FNV-1a `hashText`**, moved from `chatskim.ts` into a new `texthash.ts` and re-exported
   from `chatskim.ts` (no importer changes). `chatskim.ts` imports from `chatinitiative.ts` (Task 3), so
   `chatinitiative.ts` importing `chatskim.ts` would be an import cycle.
3. **A card opened from a message is anchored to the key of the last chat item at that moment** (`chatItems` keys,
   e.g. `agent:41`). Its row is drawn right after that item's row as a sibling, never a `data-chat-item` (the kept
   scroll place indexes those). The next thing the agent writes after the person's next message is a new item, so the
   card stays where it opened; while the agent is mid-turn its own new parts land in the same item, above the card.
   An anchor no longer drawn (another transcript epoch, or a window that dropped it) draws the card at the end.
4. **The `Under` topic picker is the existing `InitiativePicker`** with `excluding` set to every initiative that is not
   a topic (`pickVerb` "put under", no new-initiative row). A topic is computed in the frontend as `wsh effort list
   --topics` does it (`topicEfforts`, `cmd/wsh/cmd/wshcmd-effort.go:126`): an effort another listed effort's
   `parentoid` points at. No new picker.
5. **Drafts persist for both kinds of card** (one `chat.initiative.drafts` map keyed by the card's key), so a proposed
   card the person opened with Edit keeps its text through a switch to Terminal too. One mechanism, not two.
6. **Result line formats** (one line each, in the order handled):
   `initiative: added note to <title> (effort:<oid>) › <chunk>`,
   `initiative: added chunk "<label>" to <title> (effort:<oid>)`,
   `initiative: created initiative <title> (effort:<new oid>) under <topic title>` (`under` part left out with no topic),
   `initiative: dismissed <note|chunk|initiative> for <title>` (the initiative's title, or the new one's title).
   The oid lets the agent act on it with `wsh effort` without searching. Lines go first in the message, then one blank
   line, then the person's text; the stripper removes a leading run of lines matching
   `^initiative: (added|created|dismissed) ` plus the blank line after it, nothing else.
7. **Cancel on a card the person opened from a message removes it**: no row, no result line, its draft dropped. The
   agent never proposed it, so telling it "dismissed" is noise, and a faint row for something the person changed
   their mind about clutters the conversation. Added from a message does fold to its ✓ row and queues its line (the
   agent learns of the note). A proposed card's Dismiss leaves the row and queues the line, as the spec says. Task 5
   records this in spec §6.
8. **Fold-row wording follows the board** (`fold-rows.dc.html`): `Note added · <initiative> › <chunk number> — <text>`,
   `Chunk added · <initiative> › <new chunk's number> — <label>`, `Initiative created · “<title>” under <topic>`
   (not on a board; `under …` left out with no topic), `Dismissed · <note|chunk> for <initiative>`,
   `Dismissed · new initiative “<title>” under <topic>`. The text after `—` is clipped by CSS to one line.
9. **A new scenario `chat-initiative`** reusing the `agent-chat` fixtures (roster, transcripts in a temp dir, the RPC
   mock), not more steps in `agent-chat`: a queued run edits Chat next, and separate steps keep the two apart. The
   mock answers the effort commands itself (list, detail read, mutate, create) and records them, and refuses the
   first create on purpose; no real initiative is written. `agent-chat` stays in Final as the regression guard for the
   composer and conversation changes.
10. **No `CHANGELOG` `big` marker or `try` id**: there is no global binding that opens the card.
11. **Task 1 lands the card file's three exports as stubs** with their final signatures, so the conversation wiring
    (Task 3) runs beside the card view (Task 2) instead of after it.

Run f2306dc6's plan also touched `chatpane.tsx`, `chatconversation.tsx` and `CHANGELOG.md`; it has landed, so a task
rebases onto it, and a merge conflict in `CHANGELOG.md` keeps both sides' lines.

---

### Task 1: The pure model, the persisted store, the shared hash and the card's stubs
**Depends on:** none
**Files:** `frontend/app/view/agents/chatinitiative.ts`, `frontend/app/view/agents/chatinitiative.test.ts`, `frontend/app/view/agents/chatinitiativestore.ts`, `frontend/app/view/agents/chatinitiativecard.tsx`, `frontend/app/view/agents/texthash.ts`, `frontend/app/view/agents/chatskim.ts`

Land the interface every other task builds on. No React in the model or the store.

`texthash.ts`: move `hashText` (FNV-1a) out of `chatskim.ts` unchanged; `chatskim.ts` re-exports it
(`export { hashText } from "./texthash"`), so its importers and `chatskim.test.ts` keep working untouched.

`chatinitiative.ts` exports (names are the contract Tasks 2-4 rely on; shapes may gain fields, not lose them):

- `INITIATIVE_LANG = "arc-initiative"`.
- `type InitiativeKind = "chunk" | "note" | "initiative"`;
  `type InitiativeBlock = { kind; effort?: string; chunk?: string; text: string; title?: string; chunks?: string[]; parent?: string }`.
- `parseInitiativeBlock(raw: string): InitiativeBlock | null` — one JSON object; null for broken JSON, a non-object,
  an unknown kind, or a missing / blank `text` (spec §8: those stay a code block). Ignores unknown fields.
- `hasInitiativeBlock(text: string): boolean` — a reply holds an `arc-initiative` fence at a line start.
- `blockKey(block: InitiativeBlock): string` — `hashText` of the block re-serialised with sorted keys (decision 1).
- `effortOref(idOrRef: string): string` — `"effort:<oid>"` from either form (`AgentVM.effortId` is a bare oid,
  `EffortSummary.oref` is prefixed).
- `type InitiativeDraft = { kind: InitiativeKind; text: string; title: string; chunks: string; effort: string | null; chunk: string | null; parent: string | null }`
  (`chunks` is the new initiative's first chunks, one per line).
- `draftFromBlock(block, ctx)` and `draftFromMessage(text, ctx)`, where `ctx = { agentEffortId?: string; agentChunk?: string | null; efforts: Pick<EffortSummary, "oref" | "parentoid">[]; chunksOf?: (oref) => string[] | undefined }`.
  Default target (spec §8): the block's `effort`, else the agent's `effortId`; the block's `chunk`, else `agentChunk`.
  An `effort` not in `efforts`, or a `chunk` not among that effort's chunks (when they are known), is left null.
  `parent`: the block's `parent`, else the `parentoid` of the agent's initiative. From a message: kind `note`, the
  whole text.
- `canAdd(draft): boolean` — note needs effort, chunk and text; chunk needs effort and text; initiative needs a title.
- `MAX_CHUNK_LABEL = 200`; `clipLabel(text)` clipped as `chunkLabelFor` does (`councilsheetmodel.ts:248`); switching a
  draft to kind chunk clips its text (spec §8).
- `verbOf(kind)`: `Add note` / `Add chunk` / `Create initiative`.
- `type CardPhase = "waiting" | "editing" | "adding" | "failed" | "added" | "dismissed"` and a reducer
  `cardPhase(prev, event)` over `edit | add | added | failed | retry | dismiss | cancel`; `cardStatic(exited)` — an
  exited agent's waiting card shows no amber dot, its Add still allowed.
- `type HandledRecord = { outcome: "added" | "dismissed"; kind: InitiativeKind; effort: string | null; initiative: string; chunk?: string; chunkNumber?: number; text: string; topic?: string; at: number }`.
- `foldRowLabel(rec)` — decision 8 (the ✓ and ✕ glyphs are the view's).
- `resultLine(rec)`, `withResultLines(lines, message)`, `stripResultLines(text)` — decision 6.
- `topicsOf(summaries)` — decision 4.
- The stored maps' pure halves, so they are tested without a DOM: `readStoredMap(raw: string | null)` (a parse that
  returns `{}` and a reason on broken or non-object JSON, never throws), `queueLine(pending, agentId, line)`,
  `takeLines(pending, agentId) → { lines, next }`, `withHandled(handled, key, rec)`,
  `withMessageCard(cards, agentId, card)`, `settleCard(cards, agentId, id, rec | null)` (null removes it, decision 7).

`chatinitiativestore.ts` (jotai atoms over `localStorage`, every read and write in try/catch like
`chatbrainstormstore.ts` / `chat.brainstorm.sent`; a read that `readStoredMap` rejects logs its reason with
`console.warn` and starts empty; it calls the pure halves above and adds nothing but the I/O):

- `chat.initiative.handled`: `Record<blockKey, HandledRecord>`; `useHandled(key)`, `markHandled(key, rec, agentId)`
  (which also queues `resultLine(rec)` for that agent).
- `chat.initiative.cards`: `Record<agentId, MessageCard[]>`, `MessageCard = { id: string; anchor: string; outcome?: HandledRecord }`;
  `useMessageCards(agentId)`, `openMessageCard(agentId, anchor, text): string` (returns the id; its draft is
  `draftFromMessage`), `settleMessageCard(agentId, id, rec | null)` (an added rec also queues its line; null removes).
- `chat.initiative.drafts`: `Record<cardKey, InitiativeDraft>`; `useDraft(cardKey, initial)`, `setDraft`, `dropDraft`.
- `chat.initiative.pending`: `Record<agentId, string[]>`; `queueResultLine(agentId, line)`,
  `takeResultLines(agentId): string[]` (returns and clears), `putBackResultLines(agentId, lines)` (front of the queue).
- `writeInitiative(draft, project): Promise<HandledRecord>` — note: `appendChunkNote(oref, chunk, text)`; chunk:
  `addChunkOp(oref, clipLabel(text))` (appended at the end; its number is the chunk count after the add); initiative:
  `RpcApi.EffortCreateCommand` with title, `project`, `parentoid` and the chunk lines, as `effortcreateform.tsx` calls
  it. A refusal rejects with wavesrv's message (the card shows it, spec §8); nothing is swallowed.

`chatinitiativecard.tsx`: stubs with the final signatures Task 2 fills and Task 3 calls —
`ChatInitiativeHost({ agent, model, children })` (renders `children`), `InitiativeBlockView({ raw })` (renders
`<CodeBlock code={raw} lang={INITIATIVE_LANG} />`, today's look), `InitiativeMessageCards({ agentId, anchor })`
(renders null).

Tests (`npx vitest run frontend/app/view/agents/chatinitiative.test.ts`), named so they read as the spec's Testing
list: parse valid / broken JSON / unknown kind / missing text; `blockKey` equal across whitespace and key order,
different across content; default target from block, from `effortId` + `agentChunk`, an unknown effort or chunk left
empty, none at all (`canAdd` false); every phase transition including failed → retry and an exited agent; each fold
row of decision 8 word for word; the 200-character clip and the clip on switching to chunk; each result line;
`withResultLines` then `stripResultLines` round-trips to the person's text and leaves a message that merely mentions
`initiative:` mid-text alone; `topicsOf`; `readStoredMap` on null, broken JSON, an array; `queueLine` / `takeLines`
order and clearing; `withHandled`; `settleCard` with a record and with null. Also
`npx vitest run frontend/app/view/agents/chatskim.test.ts` still passes.

### Task 2: The card and its folded rows
**Depends on:** Task 1
**Files:** `frontend/app/view/agents/chatinitiativecard.tsx`

Fill Task 1's stubs with the view of spec §3 and §6, matching the three boards in the Prototype (UI strings English,
spec §9; tokens only, DESIGN.md; enters and folds on `springReveal` as `chatbrainstormcard.tsx` does — read it, do not
edit it). Keep the three exports' signatures.

- `ChatInitiativeHost({ agent, model, children })` — a context with the agent's id, project, `effortId`, its
  `agentChunk` (from `effortDetailAtom` after `loadEffortDetail`, `initiativepopovermodel.ts:22`) and `exited`
  (`procExited(getProcExitAtom(blockId), agent.sleeping)`, as `chatpane.tsx` computes it). It reads the initiative
  list once while mounted with `useInitiativeCards` (or the same `EffortListCommand`) for the chip, `done/total` and
  the topics.
- `InitiativeBlockView({ raw })` — outside a host, or when `parseInitiativeBlock` is null, the code block as the stub
  draws it. Handled (`useHandled(blockKey)`), the fold row; otherwise the compact card (origin agent).
- `InitiativeMessageCards({ agentId, anchor })` — every message card anchored at `anchor`: the editor while open, its
  ✓ row once added; a cancelled one is gone (decision 7).

The card: header (flag icon, `Add to initiative · proposed by the agent` / `· from your message`, the amber
`Waiting on you` dot unless `cardStatic`); compact body `Add a note to <chip> › <chunk dropdown>` (the verb phrase
follows the kind) with `Change…`, the text quoted and clamped to two lines, then the verb (accent), `Edit`, `Dismiss`.
`Edit` opens the editor in place on the spring: kind switch `New chunk` / `Note` / `New initiative`, textarea, `Into`
row (chip + `Change…` opening `InitiativePicker`, `pickVerb` "add to", `newLabel={null}`, the agent's project first,
`Other projects · N` behind) and `Chunk` dropdown (number and label, the agent's own marked `· this agent's`); for a
new initiative: title, first chunks one per line, `Under` topic chip with `Change…` (decision 4). A message card opens
in the editor with `Add note` + `Cancel`. Adding: the button disabled with a spinner; failed: the reason under the
buttons and `Try again`, no fold; Add disabled while `!canAdd`. Rows: `✓ <foldRowLabel>` with `Open ↗` that calls
`openAddress` / `openTarget` of `frontend/app/view/jarvis/openref.ts` for the initiative, and the faint
`✕ <foldRowLabel>`. Settling calls `markHandled` (block) or `settleMessageCard` (message), which queue the result line.

Stable hooks for the scenario (Task 6): `data-chat-initiative="<phase>"`, `data-chat-initiative-origin="agent|message"`
and `data-chat-initiative-static` (when `cardStatic`) on the card; `data-chat-initiative-waiting` on the amber dot;
`data-chat-initiative-row="added|dismissed"` on a row; `data-chat-initiative-into`, `data-chat-initiative-change`,
`data-chat-initiative-chunk` (the dropdown), `data-chat-initiative-kind="<kind>"` on each switch button,
`data-chat-initiative-under`, `data-chat-initiative-add`, `-edit`, `-dismiss`, `-cancel`, `-retry`,
`data-chat-initiative-error`, `data-chat-initiative-open` on `Open ↗`.

Acceptance: `task check:ts` clean; any new decision goes into `chatinitiative.ts` with a test, then this file only
calls it. The views are shown by Task 6's steps 1-9: the compact card (1), the editor opened with Edit and the picker
over it (2), the ✓ rows (3, 4), the Dismissed rows (5), the editor from a message (6), the new-initiative editor, the
failed state and Try again (7), the exited agent's static card (9).

### Task 3: Draw the block and open a card from a message
**Depends on:** Task 1 (calls the card file's three exports and the store's `openMessageCard`)
**Files:** `frontend/app/view/agents/markdownmessage.tsx`, `frontend/app/view/agents/chatconversation.tsx`, `frontend/app/view/agents/chatskim.ts`, `frontend/app/view/agents/chatskim.test.ts`

Runs beside Task 2 against Task 1's stubs.

- `markdownmessage.tsx`: in `DIAGRAM_COMPONENT.pre`, `lang === INITIATIVE_LANG` draws `<InitiativeBlockView raw={raw} />`
  (outside Chat's host it falls back to the code block, as `arc-visual` does).
- `chatconversation.tsx`: wrap the conversation in `ChatInitiativeHost` when `model` and `agent` are given (only a
  live Claude agent's Chat passes them). Add `Add to initiative…` to `copyMenu`'s context menu beside Copy text /
  Fork from here, and a hover button beside Copy in `BubbleCopy` (`data-chat-add-initiative`, a flag icon, title
  `Add to initiative…`), on prose parts and on your text bubbles (not commands). Both call
  `openMessageCard(agent.id, <last item key now>, text)` (read through a ref, as `entriesRef` is, since a kept item's
  handlers outlive its render). Draw `InitiativeMessageCards` as its own row right after the row of its anchor item,
  and at the end for an anchor not drawn (decision 3); these rows are not `data-chat-item` and do not enter the
  `drawnItems` reuse key. Do not edit the brainstorm files (`chatbrainstorm*.ts*`, `brainstorm*.ts`).
- A reply that `hasInitiativeBlock` must not fold behind Show more (as one holding an `arc-visual` block does not), so
  a waiting card is always in view: add the check beside the `arc-visual` one in `chatskim.ts` (Task 1 only moved
  `hashText` out of it, and runs first). Test it in `chatskim.test.ts`
  (`npx vitest run frontend/app/view/agents/chatskim.test.ts -t initiative`).

Acceptance: `task check:ts` clean; the message entry (hover and menu) and the anchored card row are shown by Task 6's
step 6, the block drawn in place by steps 1-5.

### Task 4: The result line rides the next plain message
**Depends on:** Task 1 (uses `takeResultLines`, `putBackResultLines`, `withResultLines` and `stripResultLines`)
**Files:** `frontend/app/view/agents/chatcomposer.tsx`, `frontend/app/view/agents/agentcomposer.tsx`, `frontend/app/view/agents/chatpane.tsx`, `frontend/app/view/agents/chatmodel.ts`, `frontend/app/view/agents/chatmodel.test.ts`, `frontend/app/view/agents/chatpending.ts`, `frontend/app/view/agents/chatpending.test.ts`, `frontend/app/view/agents/chattakeback.ts`, `frontend/app/view/agents/chattakeback.test.ts`, `frontend/app/view/agents/agentsviewmodel.ts`, `frontend/app/view/agents/agentsviewmodel.test.ts`

Spec §7 and its builder call 1. In `chatcomposer.tsx`'s `submit`, only for a plain message (not a local command, a
`/` command, `/btw`, a `!` command, a wake send of a sleeping agent, nor a send while a brainstorm question waits —
`chatpane.tsx` passes the composer a boolean for that from the `card` it already computes), take the agent's pending
lines and send `withResultLines(lines, message)`. `useAgentSend`'s `send` gains an optional prefix (or text) argument
so the wire text differs from the box's; everything else (`onSent`, `noteSent`'s recall, `addPending`) keeps the
person's own text. Lines are put back (`putBackResultLines`) if `send()` returns false.

Everywhere the person's raw transcript text is read back, strip the lines with `stripResultLines`:

- `chatmodel.ts`: a `you` item's `text`, so the bubble, Copy, the pinned prompt and Fork's draft show only what the
  person wrote. Test: `npx vitest run frontend/app/view/agents/chatmodel.test.ts -t "result line"`.
- `chatpending.ts` `userTextCount` (~l.89-95) compares raw entry text with the person's pending text: strip the entry
  text there, so the pending twin retires when the message lands. Test:
  `npx vitest run frontend/app/view/agents/chatpending.test.ts -t "result line"`.
- `chattakeback.ts` (~l.48): Escape's take-back puts `last.text` back in the box: strip it. Test:
  `npx vitest run frontend/app/view/agents/chattakeback.test.ts -t "result line"`.
- `agentsviewmodel.ts` `conversationText` (~l.385, Copy conversation): strip a user entry's text. Test:
  `npx vitest run frontend/app/view/agents/agentsviewmodel.test.ts -t "result line"`.

Shown in the app by Task 6 step 8.

### Task 5: The skill rule, the changelog, the spec and the hand check
**Depends on:** none
**Files:** `skills/initiatives/SKILL.md`, `CHANGELOG.md`, `docs/hand-checks.md`, `docs/superpowers/specs/2026-11-12-chat-add-to-initiative-design.md`

- `skills/initiatives/SKILL.md` (spec §5): directly with `wsh effort` for the agent's own work (progress notes and
  status on the chunk it holds, claim, done); through the card for anything new or not its own (a new chunk, a new
  initiative, a note on a chunk it does not hold), in a Claude agent's Chat; agents an Arc run started keep writing
  directly. The block's format (one JSON object, the fields of spec §8, an example), that broken JSON stays code,
  that the very same block written again shows as already handled (word a new proposal differently, decision 1), and
  how to read the `initiative:` lines that open the person's next message (decision 6) — they are the outcome,
  nothing to act on unless the person says so. Keep the skill's existing voice; nothing else changes.
- The spec: in §8, the handled record is keyed by a hash of the block's content alone, with decision 1's reason
  (replacing "content and its position in the transcript"); in §6, Cancel on a card opened from a message leaves no
  row and sends no line (decision 7); in §6, the fold rows' wording of decision 8. Mark each as a builder decision.
- `CHANGELOG.md`: one line under `Added` in the top section (open `## Unreleased` if the top section has a date):
  Chat can add a chunk, a note or a new initiative from the conversation, proposed by the agent or from any message.
- `docs/hand-checks.md`: a `- [ ] (arcterm) …` line: a real Claude agent, after the skill change, proposes a card
  with an `arc-initiative` block when asked to file a follow-up, and reads the `initiative:` line on its next turn (a
  live agent's behaviour, which no scenario can drive).

Acceptance: `node scripts/verify.mjs ./skills/...` passes (the skills embed test).

### Task 6: The `chat-initiative` scenario
**Depends on:** Task 2 (draws the card and rows the steps show), Task 3 (wires the block and the message entry), Task 4 (sends the result line step 8 asserts)
**Chunk:** Chat: add to an initiative from the conversation
**Files:** `scripts/cdp/scenarios.mjs`

A new scenario `chat-initiative` (decision 9), its own block in `scripts/cdp/scenarios.mjs`, modelled on `agent-chat`
(header near "--- agent-chat"), reusing its tab and roster fixtures and its RPC mock pattern; register it in the
scenarios list before `agentComposer` (which must stay last). The mock answers `EffortListCommand` (three initiatives
in the agent's project, one of them under a topic, the topic itself, and one initiative of another project), the
effort detail read behind `loadEffortDetail` (the agent's initiative holds a chunk whose workrefs carry the agent's
tab), `EffortMutateCommand` and `EffortCreateCommand`, records each call, and refuses the first create on purpose. The
main agent (live) has a reply with three `arc-initiative` blocks — a note on its own initiative, a chunk, and a new
initiative under the topic — and a later reply of plain prose. A second agent that has exited (as `agent-chat`'s
asleep or exited fixtures do) has one proposed block. Steps, one screenshot each, each asserting what it shows:

1. The compact card from the agent: header, `Waiting on you`, the sentence with chip and chunk, the clamped quote,
   `Add note` / `Edit` / `Dismiss` (board `A-compact-or-editor` top).
2. `Edit` on the note card opens the editor in place: kind switch, textarea, `Into` row, `Chunk` dropdown with number
   and label and `· this agent's` on the agent's own; then `Change…` opens `InitiativePicker` over the `Into` row, the
   project's initiatives first and `Other projects · 1` behind (board `A-prefilled-change`). Escape closes the picker.
3. `Add note` → the ✓ row `Note added · <initiative> › <n> — <text>` with `Open ↗`; the mock recorded one mutate with
   the note (board `fold-rows`).
4. `Add chunk` on the chunk card → the ✓ row `Chunk added · <initiative> › <new number> — <label>`; one mutate
   recorded (board `fold-rows`).
5. `Dismiss` on the new-initiative card → the faint row `Dismissed · new initiative “<title>” under <topic>`, and
   nothing recorded (board `fold-rows`).
6. `Add to initiative…` from the plain reply's hover button → a card right after that reply, origin message, open in
   the editor, kind Note, the whole message filled, `Add note` + `Cancel` (board `A-compact-or-editor` bottom). The
   same entry is in the reply's context menu. `Cancel` removes the card with no row.
7. Open it again, kind `New initiative` → title, first chunks, `Under` with the topic chip (board `fold-rows` editor);
   `Create initiative` is refused by the mock → the reason and `Try again` on the card, not folded; `Try again` → the
   ✓ row `Initiative created · “<title>” under <topic>`.
8. Send a plain message from the box: the mock's recorded input, with the bracketed-paste markers (`\x1b[200~`,
   `\x1b[201~`) stripped as `agent-chat` step 3 does, starts with the `initiative:` lines for the cards handled
   (note added, chunk added, initiative dismissed, initiative created) in that order, then a blank line and the
   text; the bubble shows only the text. A second plain message carries no lines; a `/` command sent while a line is
   pending carries none and leaves it pending.
9. The exited agent's card: no amber dot (`data-chat-initiative-static`), its `Add note` still writes (one mutate
   recorded) and folds to its ✓ row.
10. Reload the page: every row stays folded, no handled card waits again.

Teardown puts back everything `agent-chat`'s teardown does, plus the four `chat.initiative.*` localStorage keys.
Acceptance: `node scripts/cdp/final-verify.mjs chat-initiative` passes every step, and `agent-chat` still passes.
