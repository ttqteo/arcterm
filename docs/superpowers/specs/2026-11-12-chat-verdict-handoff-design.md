# Reviewer verdict and plan handoff cards in Chat

Date: 2026-11-12 · Brainstorm: `.superpowers/brainstorm/chat-verdict-handoff/brainstorm.json` ·
Initiative: "GUI redesign after the AI-chat references" (`effort 7655bf18-619e-40cf-8805-5f4a6e5ac85e`, chunks 5
"Chat: the reviewer's verdict as a card" and 6 "Chat: the plan handoff as a card")

**Prototype:** D:\work\arcterm\.superpowers\design\chat-verdict-handoff\project

The canvas holds two boards: `B-pick-and-send.dc.html` (the verdict card while the agent waits on you, with ticks
and its two buttons) and `H-A-rows.dc.html` (the handoff card). Their sample copy is partly Vietnamese; the UI
strings follow section 7.

## Goal

Two moments in a Claude agent's Chat still read as plain prose: a reviewer's verdict, and the choice of how to build a
finished plan. Draw each as a card in the new Chat look (spec `2026-11-11-chat-redesign-design.md`), next to the
run card, and fold each into a ✓ row when it is done, by the rules of spec
`2026-11-12-chat-brainstorm-review-design.md` (sections 4 and 5).

## Builds on

This spec builds on `2026-11-12-chat-brainstorm-review-design.md`, which run `f2306dc6` is building now. Build this
after that run lands, on its code: its run card, its ✓ rows and its send record (section 5 there) are reused here.
Nothing here edits the files that run touches before it lands.

## Scope

- In scope: the verdict card, the handoff card, and the run card extended to every run the agent starts.
- Verdicts in scope are the reviews the agent runs in its own session: a reviewer subagent
  (`superpowers:code-reviewer`, the `review-plan` skill) and `/code-review` (answer 1).
- Out of scope: an engine run's plan review, its per-task reviews and its Final verifier. They stay in the run sheet
  (Jarvis); Chat does not draw them (answer 1).
- Out of scope: council, `wsh ask` and land actions (answer 7). Doc review is the next card worth adding; it goes
  back to the initiative, not into this spec.

## What exists today

- Engine verdicts are typed: the `plan-reviewed` and `task-review-*` run events (`pkg/waveobj/runevent.go`) and
  `TaskNode.ReviewVerdict` / `ReviewNote` (`pkg/waveobj/wtype.go`). This spec does not use them.
- In-session reviews arrive as free text: `transcriptprojection.ts` reads a `Task` / `Agent` tool call and its
  `subagent_type` (`extractSubagentSpawns`, ~line 590), but not what its result means. `/code-review` reports
  through the `ReportFindings` tool, whose findings are typed (`file`, `line`, `summary`, `failure_scenario`,
  `verdict` CONFIRMED / PLAUSIBLE, `category`).
- `AskUserQuestion` is already projected (`transcriptprojection.ts:305`), and Chat already draws and answers it
  (`chatpane.tsx`, `answerbar.tsx`).
- A run records the session that started it: `Run.OriginTabId` and `OriginTranscript` (`wtype.go:263`).
- The handoff's order and wording live only in `AGENTS.md` ("A finished plan offers the engine first"). No arc skill
  teaches them; `superpowers:writing-plans` offers only Subagent-driven and Inline.
- Fenced-block cards already exist: ```` ```arc-visual ```` (`chatvisual.ts`), and the spec
  `2026-11-12-chat-add-to-initiative-design.md` picked ```` ```arc-initiative ```` with the same rule that a broken
  block stays a code block.

## Design

### 1. How Chat recognizes them (answer 3, the judge's pick)

- **Handoff:** the agent asks with `AskUserQuestion`, header `Handoff`, with four options in the order and wording
  of section 3. Chat draws the handoff card in place of the plain choices. A click answers the tool call, so the
  agent gets the answer it is waiting on, and the agent itself runs `wsh runs start`. The run then carries
  `OriginTabId`, and its card shows (section 4).
- **Verdict:** `/code-review`'s `ReportFindings` call is used directly. A reviewer subagent writes prose, so after it
  the agent writes one ```` ```arc-review ```` block in its reply, holding one JSON object:
  `{kind: "code" | "plan", reviewer, pass, note, findings?: [{severity, file, line, summary}]}`. Broken JSON or a
  missing `pass` stays a code block, as with `arc-visual`. Outside Chat the block reads as raw JSON.
- No wavesrv change, no new RPC, no migration.
- Chat never guesses a verdict from prose: a review with no block and no `ReportFindings` stays a tool line, as
  today.

### 2. The verdict card (answer 4; board `B-pick-and-send.dc.html`)

- Header: an icon, `Code review · <reviewer>` (or `Plan review · <reviewer>`), a chip `Changes requested` or
  `Approved`, and `Open the review`, which opens the reviewer subagent's transcript.
- One summary line: the block's `note`.
- One row per finding: its severity, `file:line` as a link that opens the file, and its one-sentence summary.
- While the agent waits on you, each finding has a tick box (Important ones ticked from the start), and the footer
  has `Fix N selected` and `Skip the review`. Both send one line to the agent. The box keeps working: typing below
  answers in your own words.
- While the agent is not waiting (it went on to fix things itself), the card has no tick boxes and no buttons.
- Agent's call (builder question 6): `severity` is `Critical`, `Important` or `Minor`, as `superpowers:code-reviewer`
  uses; Critical and Important start ticked. `ReportFindings`' CONFIRMED shows as Important, PLAUSIBLE as Minor, and a
  finding with no `verdict` as Important.
- Agent's call (builder question 7): the `arc-review` block takes an optional `subagent`, the `description` of the
  `Agent` call it judges. Chat pairs the block with that call. Without it, Chat pairs it with the nearest reviewer call
  before the block in the same turn. `Open the review` shows only when there is a subagent transcript to open: the
  `review-plan` skill and `/code-review` run in the agent's own session and have none.

### 3. The handoff card (answer 5; board `H-A-rows.dc.html`)

- Header: an icon, `Plan ready`, the amber `Waiting on you` dot, and `Open the plan`.
- The plan's title, its file, the number of tasks, how many run at once (from its Depends lines), and how many runs
  are active against `runs:maxactive`.
- Four lettered rows A–D, as on the brainstorm question card, in the order `AGENTS.md` sets: `Arc engine`,
  `Arc engine, queued`, `Inline in this session`, `Subagent-driven`. Each row has a one-sentence detail. The row
  `AGENTS.md`'s rules recommend has `Recommended`: Arc engine for three tasks or more; Arc engine, queued in its
  place when `runs:maxactive` runs are already active; Inline for one or two tasks. Inline is never called "Native".
- A click on a row answers the `AskUserQuestion`. Typing in the box answers it in words.
- Agent's call (builder question 2): `Recommended` is the agent's. Chat puts the label on the row whose option label
  carries `(Recommended)` and drops that suffix from the label; Chat computes no recommendation itself (some
  `AGENTS.md` rules, such as `--after` for overlapping files or a Mac hand check, need what only the agent knows).
  Chat always draws the four rows in the order above, whatever order the agent listed them in (Claude Code's own
  guidance puts the recommended option first). The run list and the plan file feed only the facts line.

### 4. The run card for every run the agent starts (answer 2)

The run card of `2026-11-12-chat-brainstorm-review-design.md` section 4 (name, kind, `runStage` stage, Open the
run, folded on land) is drawn for every run the agent starts: one started from a brainstorm, from the handoff card,
or by the agent's own `wsh runs start`. It sits in the conversation where the run started. It shows no verdicts of the
run (answer 1).

Agent's call (builder question 4):

- A run belongs to a conversation by `Run.OriginTranscript`, not by tab: one tab spans `/clear`, resumed sessions and
  forks, and a fresh conversation must not draw old runs' cards. The set is these runs plus `brainstorm.run`
  (a run from the cockpit launcher has no `OriginTabId`), deduplicated by id.
- A card anchors to the `wsh runs start` Bash call whose output names the run's id. A run from a brainstorm keeps the
  place the brainstorm-review spec gives it.
- An agent that has exited draws the cards static. An ended session in Conversation History (`showSession`) draws
  through `CompactTranscript`, not Chat, and is out of scope.

A queued run (builder question 3, the person's answer): when the choice is `Arc engine, queued`, the run card shows
right after `✓ Handoff · Arc engine, queued`, in a `Queued` state (`Queued · after <run>` when the entry waits on
one), read from the run queue (`RunQueueEntry`, which carries `origintabid`, as `donesuggest.ts` reads it). When the
queue starts the run, the same card moves to the run's `runStage` stage. A blocked entry shows `Queued · blocked:
<reason>`. The queued state lives in the card's own model: `runStage`, shared by the tree, Brief and the run sheet,
gains no queued stage.

### 5. Folding (answer 6)

Each card folds into its own ✓ row, by the rule of the brainstorm-review spec section 5:

- The verdict card folds when you send `Fix` or `Skip`, or when the agent writes on without waiting:
  `✓ Code review · Changes requested · 3 findings — Fix 2`, or `✓ Code review · Approved`.
- The handoff card folds into `✓ Handoff · Arc engine`, in place of the `AskUserQuestion` answer. For an engine
  choice, the run card shows right after it, stays live until the run lands, then folds. Inline and Subagent-driven
  leave only the ✓ row.
- The run-ended message (builder question 5, the person's answer): when a run with an origin session ends, wavesrv
  types a message into that session (`originMessage`, `wshserver_originnotify.go`), whose first line starts
  `[arc] Run <first 8 of the id>` followed by `landed: …` or `held: …`. Chat draws no bubble for it. The run card
  folds into `✓ Run 3fa2… landed · merged into main` (or `held: <reason>`), which opens to the message as written.
  Chat pairs the message with its run by that fixed prefix and the id, not through the send record. A message that
  does not match a run card of this conversation stays a bubble. The agent's reply to it is drawn as usual.

### 6. Left to the builder (confirmed)

- The `arc-review` block's format is section 1's. `ReportFindings` maps into the same model.
- The handoff is recognized by `AskUserQuestion` header `Handoff`. The plan path comes from the question text.
  Chat counts tasks and width from the plan file (`### Task N` headings and Depends lines) and reads the active runs
  and `runs:maxactive` from the run list. When any of these is missing, that part is left out and the card still
  draws.
- "The agent is waiting" means its turn has ended and the verdict card is the last thing in that turn. Only then do
  the tick boxes and buttons show.
- `Fix N selected` sends one line listing the ticked findings (file:line and summary). `Skip the review` sends a short
  line. Neither draws a bubble: each becomes the verdict's ✓ row, paired by the send record of the brainstorm-review
  spec section 5 (the record grows one more `kind`).
- Skill (builder question 1, the person's answer): a new arc skill in `skills/` (e.g. `skills/handoff/`, listed as
  `arc:handoff`) whose description fires when `superpowers:writing-plans` finishes a plan and when a review returns
  inside Arc, the way `arc:brainstorm` rides on `superpowers:brainstorming` ("Use whenever … runs inside Arc"). It
  works in every project, since arc skills are seeded into every harness, and loads only at those moments. It holds
  the Handoff section (`AskUserQuestion` header `Handoff`, the four options in order and wording, `(Recommended)` by
  the `AGENTS.md` rules, never "Native", in place of `writing-plans`' own two-option handoff) and the `arc-review`
  section (write the block after every review subagent, with its `subagent`). `AGENTS.md` points to the skill instead
  of keeping the rule itself. Register it in `skills/skills.go` as the other arc skills are.
- Pure models with vitest beside them: `chatverdict.ts` (block and `ReportFindings` → verdict, which findings start
  ticked, the ✓ row text), `chathandoff.ts` (recognizing the question, the plan's facts, the `Recommended` label),
  and the run card's model extended to every run by `OriginTranscript`. The cards draw in their own component file.
- An agent that has exited turns every card static (no amber dot). Motion: the spring the question card uses.
- An `agent-chat` CDP scenario step for the verdict card (open, ticked, folded), the handoff card (open, folded) and
  the run card of a run that did not start from a brainstorm, and one `CHANGELOG.md` line.

### 7. Strings

Chat's UI strings stay English, as in the rest of Chat: `Code review`, `Plan review`, `Changes requested`,
`Approved`, `Fix N selected`, `Skip the review`, `Plan ready`, `Recommended`, `Open the plan`. The user's content
(plan titles, findings) shows as written.

## Testing

- vitest for each pure model: an `arc-review` block parsed, broken, missing `pass`; `ReportFindings` mapped; which
  findings start ticked; when the buttons show (waiting vs not); the ✓ row text for each verdict and handoff choice;
  handoff recognition, the `Recommended` row taken from the agent's `(Recommended)` label, and the four rows in fixed
  order whatever order the agent sent; the facts line with and without the plan file and run list; run cards found by
  `OriginTranscript` plus `brainstorm.run`, deduplicated; an `arc-review` block paired by `subagent` and by nearest
  call; the queued card (waiting, after a run, blocked, then started); the run-ended `[arc] Run` message paired with
  its card (landed, held, and one for a run of another conversation, which stays a bubble); an exited agent.
- CDP: `agent-chat` steps that open the verdict card with ticks, its folded row, the handoff card, its folded row
  followed by a run card, and a run card for a run started outside a brainstorm. The boards are the reference.
