# Save for later

Status: design, 2026-11-27. Brainstorm: `.superpowers/brainstorm/ask-later/brainstorm.json`.
Prototype: `.superpowers/design/chat-later/project/A-direct-when-linked.dc.html` (the menu, the toast and the picker),
`.superpowers/design/chat-later/project/B-later-section.dc.html` (the Later section on the Brief).

## Intent

Some things that come up in a Chat conversation have to wait. One kind is a question to take to someone ("decide
whether 9306 or 1050 takes `audit:` logs; talk it over with a colleague"). Another is a task left for later. For
example, the person said "leave these for later, I'll go on with the parser first", and the agent listed four open
items: push DEV, delete the backup branch, check where a branch stands, and decide which parser takes the logs. The
person wants each item kept on Jarvis until it is resolved, one tick per item, without having to remember it.

Today none of the Chat menu's saves can do this. Add note writes a palette note with no open/done state. Save as idea
makes a new initiative with no chunks. Neither shows on Jarvis as something still open.

## What exists

- The right-click menu over selected Chat text (`frontend/app/view/agents/chatquotemenu.tsx`) offers Reply, Copy,
  Save as idea and Add note. Its title and body come from `chatsaveselection.ts` (`selectionTitle`, `savedBody`).
- Save as idea calls `createIdea` (`frontend/app/view/jarvis/effortstore.ts:375`), which makes an initiative with no
  chunks. The initiative records the agent's project and session as `notesession: "agent:<id>"`. `isIdea`
  (`briefrows.ts:176`) puts it in the Ideas column.
- Add note writes a `UserNote` (`pkg/waveobj/wtype.go:1052`: id, title, body, day) as a vault markdown file
  (`pkg/notestore`). A note has no open/done state.
- `EffortChunk` (`pkg/waveobj/wtype.go:947`) has Status, Stage, Due and Notes. `EffortNote.Session`
  (`agent:<tabid>`) backs "open agent session". Status `deferred` counts as dealt with and leaves Needs you
  (`pkg/jarvis/attention_due_test.go:49`), so it cannot be the later mark.
- An open chunk enters Needs you only once its Due date has come (`chunk-due`, `pkg/jarvis/attention.go:645-680`).
- The initiative picker (`frontend/app/view/jarvis/initiativepicker.tsx`, `initiativepickermodel.ts`) has a filter
  field, lists the agent's project first, keeps other projects behind a count and offers "+ New initiative from this
  session". It has no recent ordering.
- An agent can propose chunks with an `arc-initiative` block (`chatinitiative.ts`, kinds chunk/note/initiative). Chat
  draws it as a card (`chatinitiativecard.tsx`), and the person adds the chunks from that card.
- The Brief's "Waiting on you" strip (`waitingstrip.tsx`) pulses in the asking color and leads with the most urgent
  item. It disappears once nothing is waiting.
- A past conversation reopens in a tab of its own through `reopenSessionById` (`frontend/app/cockpit/cockpit-actions.ts:341`;
  `openref.ts:395` calls it).
- The chunk-priority spec of the same day (`2026-11-27-chunk-priority-design.md`) also adds a field to `EffortChunk`.
  The two changes touch the same type, ops and `wsh effort` command.

## Decisions

1. **A saved-for-later item is a chunk of an initiative.** One chunk per item, so each one is ticked on its own. The
   selected passage and the agent's session go into the chunk's first note (`EffortNote.Session = "agent:<id>"`), so
   the item can go back to the right agent. No new store.
2. **A chunk carries a later mark.** A chunk made by Save for later, or added from an agent's card as later, carries
   its own mark: a new field on `EffortChunk`, not a status. While the chunk is open, the Later section shows it. Due
   stays optional and is used only for sorting.
3. **Which initiative.** When the agent is linked to an initiative, Save for later adds the chunk there at once. The
   menu item's sublabel names that initiative, so the person sees where it goes before clicking. The toast reads
   "Saved for later in <initiative>" and offers Open and Move to…. When the agent is not linked, the click opens the
   initiative picker at the pointer. The picker shows Recent first, then search and "+ New initiative from this
   session" (board `A-direct-when-linked`).
4. **The agent can turn a list into a card.** When the person tells the agent to leave things for later, the agent
   writes an `arc-initiative` block that lists each item as a later chunk. Chat draws the card. The person removes the
   rows they don't want and presses Add.
5. **On Jarvis: a Later section of its own.** The Brief gets a "Later" section just under the Waiting on you strip
   (board `B-later-section`). Items are grouped by initiative. Each row has a tick box that marks the chunk done, the
   row's age, and Ask agent. Later items do not count toward Waiting on you and never make the strip pulse.
6. **Ask agent.** When the agent's tab is open, Ask agent switches to it and quotes the item into its box, as Reply
   does (`withChatQuote`). When the agent has exited, Ask agent resumes the old session from the chunk's note in a new
   tab, then quotes the item into its box.
7. **The menu.** The menu over selected text becomes Reply, Copy, then Save as idea, Save for later, Add note. Add
   note stays as it is, for notes that are not tasks. There is no separate plain "Add to initiative": Save for later is
   the way to add a chunk from a selection.

## Settled in the builder check

- **The agent's list card (Agent's call).** Kind `chunk` in the `arc-initiative` block gains `chunks[]` and
  `later: true`. The card draws one row per item, each with a remove ×, and Add adds the remaining rows as later chunks.
  The target is the agent's linked initiative. When the agent is not linked, the card's target opens the same picker
  as Decision 3 (Recent, search, new). Each chunk's first note holds the item's text and the agent's session. Kind
  `initiative` is unchanged.
- **Ask agent after the agent has exited (Agent's call).** A later chunk's first note also records the conversation id
  (the `SessionActivity.id` that `reopenSessionById` takes), next to `agent:<tabid>`. This is a new `EffortNote` field,
  set by the chunk-add op, and needs `task generate`. Ask agent looks for the live tab whose conversation is that id
  first, then for the tab id. Only when neither is live does it resume by the conversation id. Because the conversation
  id survives a resume, the note never goes stale. A note without the id (written before this change) falls back to
  the tab id and the error that exists today.
- **Ideas (Agent's call).** The picker keeps leaving ideas out, as `pickerRows` does today. `isIdea` ignores chunks
  that carry the later mark, so an initiative made by "+ New initiative from this session" that holds only later items
  stays in Ideas until it gets a planned chunk.
- **How the mark ends (Agent's call).** The Later section shows a marked chunk while its status is pending, active or
  blocked. Done, skipped and deferred leave it. Starting work does not clear the mark. The person can drop the mark
  without finishing the chunk ("Not later" in the chunk row's menu; `wsh effort chunk later <effort> <chunk> --off`),
  so the op is a toggle.
- **Due on a later chunk (Agent's call).** `chunkDueItems` skips marked chunks, so a later item never enters Waiting on
  you. Once its Due has come, its Later row shows the due chip.
- **Later chunks are not the initiative's work** (the person's answer to builder question 3). A chunk with the later
  mark is left out of the initiative's `done/total` everywhere: the ◇ chip, the picker's count, the board cards and
  `wsh effort show`. It is never the next chunk, so not for `advance`, `nextChunk`, Work on or `agentChunk`, and no
  engine or orchestrator run picks it up. Each of those call sites in `pkg/jarvis`, `pkg/orchestrate` and the frontend
  effort models has to learn about the mark, and so does the chunk-priority change if it lands first.

## Left to the builder

- The later mark's name and shape on `EffortChunk`, and its op. Follow the `due` pattern (`setChunkDue`,
  `EffortOp.Due`, `wsh effort chunk due`) and run `task generate` after changing the type. Coordinate with the
  chunk-priority change if both are in flight.
- A matching flag on `wsh effort chunk add`, a field in the `arc-initiative` block (`parseInitiativeBlock`), and the
  rule in the arc mod/skill that has an agent write the card when told to leave things for later.
- Order within the Later section: the initiative with the newest item first; within a group, items with a Due first,
  then oldest first. With no items, the section is not drawn.
- "Recent" in the picker: the initiatives with the latest activity.
- Move to… from the toast moves the chunk, with its notes, to another initiative.
- A CHANGELOG line (`<!-- big -->` with its shot) and a CDP scenario covering the menu item, the picker and the Later
  section.

## Builder's calls

Made by the builder of the autonomous run, 2026-11-27, each with why. The plan's tasks cite them by number.

1. **The mark is `EffortChunk.Later bool` (`later`, omitempty), set by op `setChunkLater` with `EffortOp.Later`, and
   `addChunk` takes the same field.** One bool both ways makes the op the toggle the spec asks for ("Not later",
   `wsh effort chunk later … --off`), the way `setChunkDue` takes "" to clear. The trail note reads `marked for later`
   or `no longer for later`.
2. **The conversation id is `EffortNote.Conversation` (`conversation`, omitempty).** `addChunk` writes the chunk's first
   note when `EffortOp.Note` is set (today it ignores it). From the cockpit (author "you") the note's `Session` and
   `Conversation` come from new `EffortOp.Session` and `EffortOp.Conversation`, as `CommandEffortCreateData.NoteSession`
   does for an idea. From a terminal the server derives both, for every agent note: `Session` from the block's tab as
   today, `Conversation` from the stem of the block's `agent:transcriptpath` meta (`NoteAuthor.Conversation`, set in
   `agentAuthorForBlock`). Why: one place derives where an agent note came from, and the Chat side already names a
   conversation by the transcript's stem (`sessionIdFromTranscript`, the Notes change of the same day).
3. **The summary does the exclusion once.** `jarvisstate.EffortSummaryOf` leaves a later chunk out of
   `EffortSummary.Chunks`, `Done`, `Total` and `ActiveChunk`, and lists each later chunk whose status is pending,
   active or blocked in a new `EffortSummary.Later []EffortLaterItem` (label, status, due, since, note, session,
   conversation). Why: every reader of summaries (the Brief's cards and their `done/total`, the picker's count, `isIdea`,
   Work on's active chunk, the palette) then follows the rule without learning about the mark, and the Brief's Later
   section reads one list that the ledger already pushes. `since` is the first note's ts, else the `chunk-added` event's,
   else the chunk's `UpdatedTs`; `note` is the first note's text cut to 1,000 runes (the passage Ask agent quotes).
   A later chunk's notes are not the summary's `LastNote` either: a save is not where the initiative's work was left.
4. **Readers of the whole effort filter with one helper per side.** Go checks `c.Later` (`advance`, `chunkDueItems`,
   DUM-E's `ClassifyChunk`, the backlog pass, the Jarvis status counts, the session-ideas scan's project context,
   `wsh effort show`). The frontend's effort-detail readers (`nextChunk`, `effortFacts`, the inline tracker and its
   edits, the popover and band models, chatsuggest, the peek, and the chunk an agent is attached to when it is linked
   in `agentheader.tsx`) call
   `planChunks()` from `frontend/app/view/jarvis/laterchunk.ts`. Plan Chunk lines and `AttachRunToChunks` are left as
   they are: they name a chunk on purpose, and the spec forbids picking one up, not naming it.
5. **On the initiative page, later chunks are their own group.** `initiativeRows` holds every later chunk (any status)
   out of the plan, the facts count and the "next" arrow, and draws them as a "Later · N" group after the plan, with
   the ordinary chunk row (tick, notes, menu). The row menu gains "Not later". Why: the person can still see and drop
   the mark where the chunk lives, and the plan's count stays the initiative's work.
6. **A selection becomes one chunk:** label `selectionTitle(text)` clipped to `MAX_CHUNK_LABEL` and made unique in the
   target with " (2)", " (3)"…; first note `savedBody(text, from, now, !conversation)`, holding the agent's session and
   conversation. The chunk is added at the end, with no due.
7. **Recent in the picker** is the 3 picker-eligible initiatives (not archived, not ideas) with the newest `updatedts`,
   across every project, drawn above the project's list, which then leaves them out. Typing a query hides Recent. Only
   the Save for later picker and the later card ask for it (a `recent` prop); the other pickers are unchanged. The
   picker also opens at a point (the context menu's pointer), not only under an element.
8. **"+ New initiative from this session"** makes the initiative as Save as idea does (`createIdea` with the agent's
   project, the passage as its first note and the agent's session), named by the selection's title, then adds the
   later chunk to it.
9. **Move to… re-adds, then removes.** The chunk is added to the picked initiative with its label (made unique there),
   its mark, its due and its first note's text, session and conversation, then removed from the first one. A chunk
   moved from the toast has only that note. It is two writes, not one: if the remove fails, an error toast names both
   initiatives so the person can delete the copy. `removeChunk` lets a later chunk go even when it is the initiative's
   only chunk (the last-chunk guard is for plan chunks), so a move out of an initiative made by call 8 works.
10. **The toast's Open** opens the initiative (`openAddress(model, oref)`).
11. **The Later section** sits in the Brief's main column right under the Waiting on you strip. It is drawn only with
    items (and, while the Brief's filter is typed, only with items whose label or initiative title match). Header
    "Later N"; groups by initiative, the one with the newest item first; within a group, items with a due first
    (earliest first), then oldest first. A row: tick box, label (a click opens the chunk on its initiative), the due
    chip once its due has come, the age since it was saved, Ask agent. The tick marks the chunk done and offers Undo in
    its toast, which puts the previous status back. Rows are reachable with Tab; the Brief's j/k cursor does not visit
    them (a later item never needs you now). Tokens only; no pulse, no asking color.
12. **Ask agent** quotes the passage the first note quotes (its `> ` lines), else the label. It looks for a live agent
    whose conversation (`sessionIdFromTranscript(transcriptPath)`) is the note's, then for the note's tab, and only then
    resumes by the conversation (`reopenSessionById`). A tab whose chat box is not mounted yet (just resumed) gets the
    quote when its box registers: `chatinsert.ts` holds one pending quote per agent, a newer one replacing it. With
    neither id live nor a conversation to resume, the toast says "That agent session has ended", as today.
13. **The agent's later card.** `{"kind":"chunk","later":true,"text":"<heading>","chunks":["…","…"]}`. `text` stays
    required (the card's heading). The card draws one row per item with a remove ×; Add writes the remaining rows as
    later chunks in one mutate batch, so the add is all or nothing; each first note is `savedBody(item, from, now, …)`
    with the agent's session and conversation. The target is the agent's linked initiative, else the picker of call 7.
    The result line is the existing `initiative: added …` form, naming the count.
14. **The skill rule** (`skills/initiatives/SKILL.md`): when the person tells the agent to leave things for later, it
    writes one later block listing them, and adds nothing itself. That is the one exception to "never write a new
    block". The skill's command table gains `chunk add --later` and `chunk later <effort> <chunk> [--off]`.
15. **Brief's "For later" region (sessions marked for later, `briefforlater.ts`) stays as it is.** The new section is
    named "Later" as board B draws it. Two regions with "later" in their names now share the Brief; whether to merge
    them is left to the person.
16. **Chunk priority** (run af2b7967, in flight) adds `EffortChunk.Priority` and a shared rank rule
    (`chunkorder.go`, `chunkorder.ts`). Whichever lands second keeps both fields and makes the rank rule leave later
    chunks out of the order of work, as call 4 does for `advance` and `nextChunk`.
17. **The changelog line is `<!-- big -->` with `<!-- shot: none -->` in this run.** No tree before the final stage runs
    a dev app, so no task can take the picture, and a shot comment naming a missing file fails `whatsnew.test.ts`.
    After the land, the picture is taken with `node scripts/whatsnew-shot.mjs save-later --selector
    '[data-jarvis-brief-region="later-chunks"]'` and the comment swapped in one commit.
