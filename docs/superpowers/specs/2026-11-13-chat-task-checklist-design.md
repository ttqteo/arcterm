# Step checklist in Chat

**Date:** 2026-11-13
**Prototype:** `.superpowers/design/chat-task-checklist/project/A-inline.dc.html` (gitignored; the
board for the chosen design)

## Why

Claude Desktop draws an agent's plan as a checklist inside the turn. The step being worked on has a spinner, steps not
started have a dashed ring, and finished steps are ticked. The person likes it and wants it in arcterm's Chat.

What exists today:

- The agent card already shows a done/total chip (`taskProgress`, `agentrow.tsx:279`) from `tasksByIdAtom`
  (`livetranscriptatoms.ts:21`), which `livetranscript.ts:92` fills through each harness's `extractTasks`.
- Claude: `extractTasks` (`transcriptprojection.ts:636`) reads `TodoWrite`. pi: `extractPiTasks`
  (`pitranscriptprojection.ts:422`) reads `TaskCreate` / `TaskList`. codex: `extractCodexTasks`
  (`codextranscriptprojection.ts:182`) reads `update_plan`.
- **Claude agents never write a list.** None of the 2029 Claude transcripts under `~/.claude/projects` calls `TodoWrite`
  or `TaskCreate`, and the Claude Code build in use offers neither tool. Reading the tool alone would give Claude agents
  no checklist.
- Chat already draws fenced blocks an agent writes: `markdownmessage.tsx:110` sends ```` ```arc-visual ```` to
  `VisualBlock` (`chatvisual.ts` / `chatvisualview.tsx`) and ```` ```arc-initiative ```` to its card.

## Source: an `arc-steps` block

A Claude agent writes its steps as a fenced ```` ```arc-steps ```` block in its reply. Chat draws the block as the
checklist. pi and codex keep using their own list tools (`TaskCreate`/`TaskList`, `update_plan`), read as today.

A new arc skill teaches the block: `skills/steps/` (name it `steps`), embedded by `skills/skills.go` like the others. It
reaches Claude through the arc mod as `arc:steps`.

Agent's call: `skills/` is seeded into every harness, so the skill says, as `visual` does, that only a Claude agent's
Chat draws the block, and tells a pi or codex agent to keep using its own list tool. `extractPiTasks` and
`extractCodexTasks` do not read `arc-steps` blocks.

### When the agent writes it

The skill tells the agent to write the block when it starts work that takes **three or more steps**. It skips questions
and small fixes.

### The block

One step per line:

```arc-steps
[x] Xem dung lượng và danh sách session
[>] Xác định session mồ côi
[ ] Đề xuất cách dọn
```

- `[x]` done, `[>]` being worked on, `[ ]` not started; after the marker comes the step's text.
- The agent writes the whole block again each time a step changes state.
- A line that does not parse is skipped. A block with no valid line draws as a plain code block, as `arc-visual` does
  with a bad line.

## How Chat draws it

**The list sits only in the turn,** as in Claude Desktop (board `A-inline.dc.html`). Nothing is added to the chat box.

- The list is drawn where the agent first wrote a block in that turn. Each later block in the same turn updates that one
  list in place, and the later blocks draw nothing where they stand. A finished turn keeps its last list.
- What a turn is (Agent's call): a turn runs from one of your messages to the next, not one agent group in
  `chatItems` (`chatmodel.ts:212`). A marker that cuts the group while the agent works (an auto-compaction, a background
  `<task-notification>`, an interruption) does not end the turn: the list stays where it was first drawn, and a block
  after the marker still updates it. A message you queue while the agent works does start a new turn: the earlier list
  stays as it last was, and the agent's next block draws a new list.
- Row icons: a done step has a tick in a ring, in `muted`, and its text is `muted`. The step being worked on has a
  `working` green ring with a dot that pulses through `element/pulsedriver.tsx` (not a CSS animation), and its text is
  `foreground`. A step not started has a dashed ring in `ink-faint`, and its text is `secondary`. Status is never shown
  by colour alone: each state has its own glyph.
- The container is `border-edge-mid rounded-lg` with no fill, rows 14px, a 16px icon column and `gap` 8px between rows,
  as drawn on the board.
- When the turn ends with a `[>]` step still open, that step stops pulsing and draws as not started. Agent's call on
  what "ends" means: while the agent waits on you (a permission prompt, an `AskUserQuestion`), a `[>]` step keeps its
  green ring but stops pulsing; once the agent is idle or ended, or a later turn has begun, it draws as not started.
- Motion: a step's icon changing (pending → working → done) crossfades on the Fluid ease at `MOTION.durMicro`. A step
  added to or removed from the list grows or folds through `springReveal`. The list's first appearance takes no
  entrance animation beyond the turn's own.

## Card chip counts the block too

The latest `arc-steps` block in an agent's transcript also feeds `tasksByIdAtom`, so the card's done/total chip shows
for Claude agents as it does for pi and codex. `[x]` is done; `[>]` and `[ ]` are not. The chip keeps the last list
until the agent writes a new one, the same as today's tool-based lists.

## Reading Claude's list tools

`extractTasks` also reads `TaskCreate` / `TaskUpdate` beside `TodoWrite`, in case a Claude Code build offers them,
matched by task id as `extractPiTasks` does. These tool lists feed only the card chip: Chat draws only `arc-steps`
blocks, never a list from a tool call. When an agent's transcript has both a list tool call and an `arc-steps` block,
the one written last wins for the chip.

## Left to the builder

- **Pure parser:** a pure module, e.g. `chatsteplist.ts`, with `chatsteplist.test.ts` beside it, following
  `chatvisual.ts`. It parses a block into `{ text, state }[]`, decides which block in a turn is the latest, and
  decides where the list is drawn. The `.tsx` view stays thin and is wired into `markdownmessage.tsx`'s
  `DIAGRAM_COMPONENT` next to `VISUAL_LANG`.
- **Transcript side:** `extractTasks` reads `TaskCreate`/`TaskUpdate` and `arc-steps` blocks, with tests in
  `transcriptprojection.test.ts`.
- **Skill:** `skills/steps/SKILL.md`. The block format, the three-step threshold, the rule to rewrite the whole
  block on each change, and the scoping to Claude agents (Agent's call, under "Source").
- **Verification:** a CDP scenario in `scripts/cdp/scenarios.mjs`, using a fixture transcript, that shows one list with
  a step in progress and one finished turn's list.
- **CHANGELOG:** one line under `Added` in the `Unreleased` section.
