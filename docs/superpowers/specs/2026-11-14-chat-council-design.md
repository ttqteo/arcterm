# Council and Doc review cards in Chat

Date: 2026-11-14 · Brainstorm: `.superpowers/brainstorm/chat-council/brainstorm.json` ·
Initiative: "GUI redesign after the AI-chat references" (`effort 7655bf18-619e-40cf-8805-5f4a6e5ac85e`, chunk 8
"Chat: a council card" and the Doc review card named in chunk 7)

**Prototype:** D:/work/arcterm/.superpowers/design/chat-council/project

The canvas holds two boards: `Council.dc.html` (the council card in each state, top to bottom) and
`DocReview.dc.html` (the Doc review card while it waits, then its two folded rows). Their sample copy is partly
Vietnamese; the UI strings are the English ones in section 6.

## Goal

Two moments in a Claude agent's Chat still read as plain text: a council the agent started, and a Doc review the agent
asks for. Draw each as a card in the Chat look of the run, verdict and handoff cards
(`2026-11-11-chat-redesign-design.md`, `2026-11-12-chat-brainstorm-review-design.md`,
`2026-11-12-chat-verdict-handoff-design.md`), and fold each into one row when it is over.

The council keeps running in its own room. Chat follows it the way it follows a brainstorm: the brainstorm stays its
own tab and Chat shows a card for it (answer 2). Nothing of the room moves into Chat.

## Scope

- In scope: the council card for a council the agent started with `wsh council start` in this conversation; the Doc
  review card.
- Out of scope: the council room (`councilchat.tsx`, `councildiscussion.tsx`) and its drafts, seats and report;
  councils the person started (New, Ask the council, Discuss together), even when they carry this session's
  `SessionId` (builder question 1); reading the experts' messages in Chat (answer 2).
- One spec for both cards (answer 1): both are "waiting on you" moments with the same card shell.

## What exists today

- A council the agent starts: `wsh council start` (`cmd/wsh/cmd/wshcmd-council.go`) prints
  `council <id> started: …` (`councilStartedLine`), or `Queued after … · council <id> starts by itself when it ends`
  (`councilQueuedLine`), or a `Not run: …` refusal naming the id (`councilNotRunText`). The agent then runs
  `wsh council wait` and sums the report up in its own words (`skills/council/SKILL.md`).
- The council records `SessionId` (the agent session that started it) and `ByAgent` (`pkg/council/types.go`).
- States (`pkg/council/types.go`): `queued`, `running`, `awaiting-you`, `done`, `stopped`, `failed`, `not-run`.
  `awaiting-you` has two causes (`pkg/council/runner.go`): drafts held for the person (`awaitingDrafts`), or a pause
  after round 1 (`PauseAfterRound1`). A council from `wsh council start` always has `ByAgent`
  (`wshcmd-council.go:675`), and `draftModeFromSeats` holds drafts only when `!c.ByAgent` (`types.go:94-99`), so for
  a council in scope `awaiting-you` always means the pause after round 1.
- The frontend holds councils in `councilstore.ts`, reloaded on `council:changed` (`wps.Event_CouncilChanged`).
  Continue and Stop are `CouncilContinueCommand` and `CouncilStopCommand`, which the room calls through
  `councilactions.ts`.
- A Doc review is an `AskUserQuestion` with header `Doc review` (`skills/doc-review/SKILL.md`): first line the file's
  absolute path, then an intro, an optional `Pages: N`, and `- ` lines worth a look; options `Approve` and
  `Request changes`. `answerbar.tsx` recognizes it (`docreview.ts` `parseDocReview`) and its Review button opens the
  review view (`docreviewstore.openReview`).
- In Chat, `chatpane.tsx` `ChatAsk` draws an ask with header `Handoff` as `ChatHandoffCard` and every other ask,
  Doc review included, as a plain `AskRow`. Answers go through `askanswer.ts` (`answerAgentAsk`).
- Card shell, folds and ✓ rows are shared in `chatbrainstormparts.tsx` (`CardShell`, `Fold`, `DoneRow`).

## Design

### 1. The council card (answers 2 and 3; board `Council.dc.html`, states 1 to 3)

One card per council this agent's session started. Its header: the council icon, `Council · <mode>`, the state, and
`Open council` on the right, which opens the council's room (through `openref.ts`, the one router).

- **Running** (state 1): the feature as the title, the question under it in one or two lines, the seats as chips
  with a dot (done, working, waiting), the step in the header (`Round N of 3`, `Writing the summary`, `Follow-up`;
  the board's ` · reactions` round name is dropped, Builder decision 6), the elapsed time and the
  start line's estimate (`≈ N calls · ~X tokens`), and a `Stop` button.
- **Waiting on you, paused after round 1** (state 2, answer 3): the header reads `Waiting on you`; the line says how
  many experts sent how many ideas; `Continue` (primary) and `Stop` act from the card.
- There is no drafts-held state: a council the agent started never holds drafts (builder question 1).
- **Queued** (state 3): a quieter card naming the council it waits for and that it starts by itself, with
  `Open council`.

A button goes dead once pressed, until `council:changed` brings the new state.

### 2. Where the card sits (answer 6)

While the council is queued, running or waiting on you, the card sits at the end of the conversation, above the
composer, where the brainstorm card sits. When the council ends, the card leaves the end and its row (section 3) is
drawn in place of the `wsh council start` tool row in the conversation.

### 3. When the council ends (answer 5; board `Council.dc.html`, states 4 and 5)

- **Done** (state 4): one ✓ row, `✓ Council · <mode> · N directions|ideas · <elapsed>`, the feature dimmed, and
  `Open report`. The row does not list the directions: the agent's own summary, right after it, is the content.
- **Stopped, failed, not run** (state 5): the same row shape with its own mark (■, !, –), what happened
  (`stopped in round N`, `failed in round N`, `not run`), the reason in one line (the council's error, or the
  refusal's), and `Open council`.
- **Running again** (builder question 2): done, stopped, failed and not-run are not final in the runner (a follow-up
  or re-summarize after done, `runner.go:2822` and `:3068`; a resume or retry, `:2886` and `:3225`; a not-run council
  started from the app). A council that has ended once in this conversation stays a row at its start tool row for
  good: the row updates its mark and text (running again, the follow-up round) and keeps `Open council`, but never
  returns to the end of the conversation. The model needs the "has ended once" memory for this; the builder picks
  where it lives.

### 4. The Doc review card (answer 4; board `DocReview.dc.html`, state 1)

`ChatAsk` draws an ask whose header is `Doc review` as a card, the way it draws `Handoff`. The card shows the file
path (monospace), the intro, `Pages: N` in the header when given, and the "worth a look" lines as a list. Buttons:
`Review` (primary) opens the review view as the answer bar's Review does, and `Approve` answers the ask with the
agent's `Approve` option through `answerAgentAsk`. Request changes is never on the card: each comment belongs to a
passage, so it is made in the review view. Words typed in the composer answer the ask as for any ask. For an exited
agent the card is static.

### 5. The Doc review card once answered (board `DocReview.dc.html`, state 2)

The card folds in place into one row: `✓ Doc review · approved · <file>` or
`↺ Doc review · changes requested · N comments · <file>`. The person's long Request changes answer is not drawn as a
message bubble in Chat; the row stands for it.

### 6. Strings

Card header: `Council · review`, `Council · brainstorm`, `Doc review`, `Waiting on you`, `Round 2 of 3`,
`Queued after "<feature>" · starts by itself`. Buttons: `Open council`, `Open report`, `Stop`, `Continue`,
`Review`, `Approve`. Note under the Doc review buttons:
`Request changes from Review: each comment sits on a passage`.

### 7. Left to the builder (confirmed)

- How Chat finds this conversation's councils: the id in the start, queued or not-run line of a `wsh council start`
  Bash result (builder question 1). `SessionId` alone is not enough: a council the person started from this agent
  carries it too, and is out of scope.
- Keeping the card current on `council:changed` through `councilstore.ts`, without a second fetch path.
- Continue and Stop call the same commands the room calls (`councilactions.ts`).
- Approve answers through `askanswer.ts` as the handoff card does, locked against a second click.
- Where the ended row goes when the start tool row is no longer in the transcript (compacted): the builder decides,
  and says so in the code.
- A CDP scenario that opens each state on the two boards (council: running, paused after round 1,
  queued, done row, stopped/failed/not-run rows; Doc review: waiting, approved row, changes-requested row), seeded
  with fixture councils and a fixture ask.

## Testing

- Pure models beside their tests (`chatcouncil.ts` / `chatcouncil.test.ts`, `chatdocreview.ts` /
  `chatdocreview.test.ts`): which councils belong to the session, which state the card shows, the ended row's text,
  where it goes; the Doc review card's fields from `parseDocReview` and the folded row from the answer.
- The CDP scenario above, named in the plan's Final.
- CHANGELOG: one `Added` line for each card.

## Builder decisions (2026-11-14, autonomous run)

Made by the run's lead with nobody at the cockpit, each the call the spec left to the builder (section 7) or one it
did not name.

1. **Finding the councils: a `councilstart` part, the run card's pattern.** `chatmodel.ts` `momentOf` reads a Bash
   call whose command is `wsh council start` (through a path, `wsh.exe`, quotes, `cd x &&`, the run card's
   `RUNS_START_COMMAND` shape) and whose output carries one of the three lines `wshcmd-council.go` prints:
   `council <id> started: … · ≈ N calls · ~X tokens` (started; the estimate kept as text), `… · council <id> starts
   by itself when it ends` (queued), `council <id> saved as not run` (not run; the `Not run: …` line above it kept as
   the reason). The call becomes an `AgentPart` `{ kind: "councilstart"; key; anchor }` after its tool line, as
   `runstart` does. Why: the run cards already find a conversation's runs this way, and only the agent's own start
   names the id (a council the person started carries the same `SessionId`, spec section 7). One call names one
   council: the first such line wins.
2. **Keeping the cards current: `councilAtom(id)` through `loadCouncil`, one per anchored id.** A small hook in
   `chatcouncilstore.ts` loads each anchored council once and reads the atoms `councilstore.ts` already reloads on
   `council:changed`. No second fetch path, no polling.
3. **"Has ended once" lives in two places.** A council counts as ended once when (a) its anchor is a not-run line,
   (b) its state is `done`, `stopped`, `failed` or `not-run`, (c) it carries a `summary` (a follow-up after done), or
   (d) this app session saw it in (b) (an in-memory jotai set keyed by council id in `chatcouncilstore.ts`). (a) and
   (c) survive a reload; (d) covers a stopped or failed council resumed within the session. Why: no new wire field and
   no persisted store for a fact the council mostly carries itself. Accepted gap: a council stopped, then resumed after
   an app restart, returns to the end of the conversation until it ends again.
4. **A start call outside the loaded transcript draws nothing.** Chat finds councils only by their start call, so a
   council whose call is in an earlier page not loaded yet (or compacted away) has no card and no row; Show earlier
   brings its row back. Why: a council takes minutes while its agent sits in `wsh council wait`, so a live council's
   call is in the loaded tail in practice, and drawing an ended row at the end would leave it there for good.
5. **Order at the end:** the trailing run cards, then the live council cards (oldest call first), then the brainstorm
   card. A council's live card is drawn by the conversation, not by the dock, so it scrolls with the transcript as the
   brainstorm card does.
6. **Card state from the council model's own words.** The card reuses `councilmodel.ts`: `headerChip`'s step word
   (`Round N of 3`, `Writing the summary`, `Follow-up`), `duration` over its `elapsedMs` (exported for this) for the
   elapsed time, read as `2 min 14 s` like the rest of the app rather than the board's `2m 14s`, `queuedLine`'s holder
   rule (the card reads the holder with `useCouncil(c.queuedafter)`, as `councildiscussion.tsx` does), and its
   `stopped with a summary reads as done` rule; never a second reading of the states. The round's name on the board
   (`Round 2 of 3 · reactions`) is dropped: neither `pkg/council` nor the frontend names rounds, and inventing names
   here would be a second source. The header's state slot shows the council's own word through a `tag` that
   `CardShell` gains (running: the step, waiting on you: `Waiting on you`, queued: `Queued after "<feature>" · starts by
   itself`); `CardState` stays the colour and the scenario attribute: running and queued → `working`, waiting on you →
   `waiting`. An exited agent draws the card `static` with the council's word still in the tag and no Stop / Continue.
   A seat's dot: `working` while the council's `activity` has the seat, `done` once it sent in the current round,
   else `waiting`.
7. **Open report** is `openTarget(model, { kind: "council", councilId, view: "summary" })`: the council target in
   `address.ts` gains an optional `view`, which `openref.ts` passes to `showCouncil`. Open council passes no view.
8. **Count word in the done row:** `ideas` for a brainstorm-mode council, `directions` for every other mode; the
   number is `summary.directions.length` (the row leaves the count out when there is no summary).
9. **The Doc review card needs a valid Doc review.** `ChatAsk` draws the card when `parseDocReview` reads the ask as
   `kind: "doc"` (a `.md` or `.tex` path on its first line); any other ask with that header stays the plain `AskRow`.
   The same test makes the transcript's AskUserQuestion a `{ kind: "docreview"; key; question }` part, so the answered
   ask folds into its row in place, as `handoff` does. The file shows relative to the agent's project folder when it
   sits under it (`relativeToProject`), else as given.
10. **The folded Doc review row reads the answer, not a send record.** `approved` when the picked label is the ask's
    approve option; otherwise `changes requested`, with `N comments` counted from the numbered `N. [` lines
    `formatRequest` (`proseanchor.ts`) writes, left out at zero (a free answer typed in the box). The row has no
    detail fold: the review view keeps the comments.
11. **Shared parts:** `chatbrainstormparts.tsx` `CardKind` gains `council` and `docreview`; `DoneRow` gains those two
    kinds, an optional `mark` (the glyph in place of ✓: ■, !, –, ↺) and an optional `action` (a link button at the
    row's right end, for Open report / Open council; only on a row without `detail`, so a button never nests in a
    button) and an optional `extra` (`data-*` attributes spread on the row element, as `CardShell` has); `CardShell`
    gains an optional `tag` that replaces its `StateTag`.
