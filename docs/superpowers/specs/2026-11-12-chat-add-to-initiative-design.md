# Add to an initiative from Chat

Date: 2026-11-12 · Brainstorm: `.superpowers/brainstorm/chat-add-to-initiative/brainstorm.json` ·
Initiative: "GUI redesign after the AI-chat references" (`effort 7655bf18-619e-40cf-8805-5f4a6e5ac85e`, chunk
"Chat: add to an initiative from the conversation")

**Prototype:** D:\work\arcterm\.superpowers\design\chat-add-to-initiative\project

The canvas holds three boards, all in the new Chat look (spec `2026-11-11-chat-redesign-design.md`):

- `A-prefilled-change.dc.html`: the target row of the card (prefilled initiative chip, `Change…`, chunk dropdown),
  with the `InitiativePicker` open over it.
- `A-compact-or-editor.dc.html`: the card while it waits. Top: the compact card an agent proposes. Bottom: the same
  card opened from `Add to initiative…` on a message, already in its editor.
- `fold-rows.dc.html`: the folded rows after Add (a note, a chunk) and after Dismiss, and the editor for a new
  initiative.

Their copy is Vietnamese where the example conversation is; the UI strings follow section 9.

## Goal

From Chat, add to an initiative without leaving the conversation: a new chunk, a note on a chunk, or a new
initiative. It shows inline as a card, like the brainstorm question card, and folds into one row once handled
(the pattern of spec `2026-11-12-chat-brainstorm-review-design.md`, section 5).

Today an agent writes initiatives silently with `wsh effort` (skill `arc:initiatives`): chunk notes, new chunks, a
follow-up initiative per run with one chunk per finding. The person sees none of it in Chat. `--proposed` chunks exist
for an agent to suggest work, but no initiative holds one today.

## Scope

- In scope: the card in the Chat of a Claude agent, its two ways in (the agent proposes it, or the person starts it
  from a message), its folded rows, the line that tells the agent the outcome, and the `arc:initiatives` skill change.
- Out of scope: agents an Arc run started (leads and workers keep writing directly), pi and other harnesses, the
  Brief and the rail's own editors, and any wavesrv or wire change.
- Do not edit the files run f2306dc6 is changing for the brainstorm-review spec: `chatbrainstorm.ts`,
  `chatbrainstormcard.tsx`, `chatbrainstormstore.ts` and the `brainstorm*.ts` models. Everything new lives in its own
  files (section 8).

## What exists today

- `InitiativePicker` (`frontend/app/view/jarvis/initiativepicker.tsx`, model `initiativepickermodel.ts`): a filter
  field over the initiatives, the project's own first, other projects behind `Other projects · N`, an optional
  `+ New initiative…` row, `pickVerb`. Used by the agent header's Link to initiative (`agentheader.tsx` ~281), the
  Brief's Link to…, and the council sheet's Add to initiative… (`councilsheet.tsx` ~413, `chunkLabelFor` in
  `councilsheetmodel.ts` clips a label to wavesrv's 200-character limit).
- An agent knows its initiative: `effortId` (`agentsviewmodel.ts:130`), the one it was launched from or last read or
  wrote through `wsh effort`. `agentChunk` (`view/agents/initiativepopovermodel.ts:22`) finds the chunk the agent holds,
  falling back to the active chunk.
- `mutateEffort` and its ops in `view/jarvis/effortstore.ts` (add a chunk, append a chunk note); `EffortCreate` makes an
  initiative with a parent. `wsh effort list --topics` lists the 13 topics initiatives sit under.
- Chat draws an agent-written fenced block inline: `arc-visual` (`view/agents/chatvisual.ts`, skill `arc:visual`).
- Chat hides the action lines Arc sends for a brainstorm and pairs records with transcript messages by a `seen` count
  (`chat.brainstorm.sent` in `localStorage`, chat-redesign spec "Builder decisions").
- Counts today: 137 initiatives not archived (120 in arcterm), 106 under a topic; a median of 6 chunks, at most 29.

## Design

### 1. Who starts it (answer 1)

Both ways in lead to the same card:

- The agent proposes it in its reply (section 4).
- The person picks `Add to initiative…` on a message; the card opens at the end of the conversation with that
  message's text filled in.

### 2. Choosing the target (answer 2, the judge's pick; board `A-prefilled-change.dc.html`)

The card opens with its target filled in: the agent fills it when it proposes; from a message, Arc takes the agent's
`effortId` and its `agentChunk`. An `Into` row shows the initiative as a chip (title, `done/total`) and a
`Change…` chip that opens the existing `InitiativePicker` (`pickVerb` "add to", no new-initiative row). A `Chunk` row
is a dropdown of the initiative's chunks, number and label, the agent's own marked. 137 initiatives need no new
picker: the project's come first and typing filters them all.

### 3. The card while it waits (answer 3, the judge's pick; board `A-compact-or-editor.dc.html`)

- Header: a flag icon, `Add to initiative · proposed by the agent` (or `· from your message`), the amber
  `Waiting on you` dot.
- **Proposed by the agent: compact.** One sentence, `Add a note to <initiative chip> › <chunk dropdown>` with
  `Change…` on the chip, then the text in a quote clipped to two lines, then `Add note` (accent), `Edit`, `Dismiss`.
  The verb follows the kind: `Add note`, `Add chunk`, `Create initiative`.
- **`Edit`** opens the editor in place on the spring: a kind switch (`New chunk` / `Note` / `New initiative`), the
  text in a textarea, the `Into` and `Chunk` rows.
- **From a message: the editor, open.** The whole message is filled in and nearly always needs trimming, so the card
  opens straight in the editor, kind `Note`, with `Add note` and `Cancel`.
- Agent's call (builder question 2): a card started from a message is anchored where it opened, after the last
  transcript entry at that moment, and stays there as the agent goes on replying; its ✓ row takes that place once it
  is added. Several can be open at once, one per `Add to initiative…`. Its draft (kind, text, target) persists in
  `localStorage` with its record, so a reload or a switch between Chat, Terminal and Brainstorm keeps the trimmed text.
- Builder decision (plan decision 7): Cancel on a card opened from a message removes it: no row, no result line, its
  draft dropped. The agent never proposed it, so telling it "dismissed" is noise, and a faint row for something the
  person changed their mind about clutters the conversation. Only Added folds such a card to its ✓ row (and queues
  its line). A card the agent proposed keeps its Dismiss, which leaves the faint row and queues the line (section 6).
- Builder question 3 (the person's answer): a waiting card raises no new signal outside Chat. The turn that carried
  it already marks the agent unread (the Agent nav badge, `unreadagents.ts`), so nothing is wired into `navrail.tsx`
  or the cockpit's Needs you.

### 4. How the agent raises the card (answer 5, the judge's pick)

The agent writes a fenced block in its reply, as it does for `arc-visual`:

````
```arc-initiative
{"kind": "note", "effort": "7655bf18-…", "chunk": "Chat: add to an initiative from the conversation", "text": "…"}
```
````

Chat draws it as the card of section 3. `Add` writes through `mutateEffort` (or `EffortCreate`) from the frontend;
nothing is added to wavesrv. Outside Chat (the terminal view) the block reads as raw JSON, as `arc-visual` does.

### 5. When the agent still writes directly (answer 6)

- Directly with `wsh effort`, as today: its own work. Progress notes and status on the chunk it holds, claiming,
  ticking done.
- Through the card: anything new or anything not its own. A new chunk, a new initiative, a note on a chunk it does
  not hold.
- Agents an Arc run started do not change.

`skills/initiatives/SKILL.md` gains this rule, the block's format, and how to read the result line (section 7).

### 6. Folded rows (answer 4; board `fold-rows.dc.html`)

- After Add the card folds, on the spring, into one ✓ row at its place, with `Open ↗`. A click opens the initiative
  through `openref.ts`. Builder decision (plan decision 8): the wording follows the board `fold-rows.dc.html`:
  `Note added · <initiative> › <chunk number> — <text>`, `Chunk added · <initiative> › <new chunk's number> —
  <label>`, `Initiative created · “<title>” under <topic>` (not on a board; `under …` is left out with no topic). The
  text after `—` is clipped by CSS to one line.
- After Dismiss it leaves one faint row: `✕ Dismissed · <note|chunk> for <initiative>`, or, for a new initiative,
  `✕ Dismissed · new initiative “<title>” under <topic>` (same decision).
- Builder decision (plan decision 7): Cancel on a card opened from a message leaves no row and sends no line
  (section 3). Only a card the agent proposed has a Dismissed row.
- Both rows stay in the conversation.

### 7. How the agent learns the outcome (answer 7)

Arc does not send anything at Add or Dismiss, which would wake an idle agent for a turn. It keeps the outcome and
prepends one line per card handled since the last message to the next message the person sends that agent, then one
blank line, then the person's text. Builder decision (plan decision 6): the formats, one line each, in the order
handled:

- `initiative: added note to <title> (effort:<oid>) › <chunk>`
- `initiative: added chunk "<label>" to <title> (effort:<oid>)`
- `initiative: created initiative <title> (effort:<new oid>) under <topic title>` (the `under` part is left out with
  no topic)
- `initiative: dismissed <note|chunk|initiative> for <title>` (the initiative's title, or the new one's title)

The oid lets the agent act on the initiative with `wsh effort` without searching. Chat strips from the person's
bubble a leading run of lines matching `^initiative: (added|created|dismissed) ` plus the blank line after it, nothing
else. A message carrying lines is a multi-line message, so Claude Code stores it wrapped whole in `<pasted_content>`:
the stripper unwraps that paste first, then strips. If the person sends nothing more, the agent never hears, which is
fine.

Agent's call (builder question 1): only a plain message sent from Chat's box carries the line, so the hook sits in
`chatcomposer.tsx`, not in `useAgentSend`. A slash command (`/compact`…), `/btw`, a wake send, and a brainstorm answer
typed in the box while a question waits do not carry it. The line stays pending until the next plain message.
Brainstorm answers pair with the transcript by exact text (`pairAnswers`, `chatbrainstorm.ts`, a file run f2306dc6
holds), and a line in front of a slash command breaks the command.

### 8. Left to the builder (confirmed)

- Claude agents only: Chat is the Chat of a Claude agent.
- New files: a pure `chatinitiative.ts` with `chatinitiative.test.ts` (parse the block, the card's state, the fold
  rows' labels, the result line, stripping it from a bubble), `chatinitiativestore.ts` (persisted state),
  `chatinitiativecard.tsx` (the card and its rows). The conversation and the message menu only call into them.
- The block is ```` ```arc-initiative ```` then one JSON object `{kind: "chunk" | "note" | "initiative", effort?,
  chunk?, text, title?, chunks?, parent?}`. Broken JSON, an unknown kind or no `text` stays a code block, as with
  `arc-visual`. An `effort` or `chunk` that does not exist opens the card with that target empty and `Change…` ready.
- Default target: the block's `effort`, else the agent's `effortId`; the block's `chunk`, else `agentChunk`. With
  neither, `Into` is empty and Add is disabled until one is picked.
- New initiative (board `fold-rows.dc.html`): a title, first chunks one per line, `Under` a topic: the block's
  `parent`, else the parent of the agent's initiative. `Change…` opens a picker over the topics (`wsh effort list
  --topics`). Created with `EffortCreate` and its parent, in the agent's project.
- New chunk: appended at the end of the initiative; a label is at most 200 characters, clipped as `chunkLabelFor`
  does.
- The message entry: `Add to initiative…` in a message's right-click menu beside Copy text and Fork from here, and in
  its hover buttons. It opens the card at the end of the conversation, in the editor, kind Note, the text clipped to
  200 characters if the kind is switched to chunk.
- Added / Dismissed and the pending result lines persist in `localStorage` (as `chat.brainstorm.sent` does), so folded
  rows survive a reload and a handled card never comes back. Builder decision (plan decision 1, replacing "content and
  its position in the transcript" of the agent's call on builder question 4): a block's handled record is keyed by a
  hash of the block's content alone (the parsed object re-serialised with sorted keys, so whitespace does not split a
  key), not by agent id. The reason for the key is that a fork made with Fork from here must see the cards it copied as
  handled, and never write them a second time. A position does not survive a fork (wavesrv cuts the transcript and
  Claude's `--fork-session` writes a new session file, so neither the entry index nor, provably, the record uuid is
  the same) nor a Chat window that loads earlier entries; content does. The cost: an agent that writes the very same
  block again (after a Dismiss, say) sees it drawn as the handled row and is not told again, so the skill tells it to
  word a new proposal differently. The pending result lines stay keyed by agent id.
- A failed write (wavesrv refuses it) shows its reason on the card with `Try again`; the card does not fold.
- An agent that has exited turns a waiting card static (no amber dot); its Add still works, since the write needs no
  agent.
- Motion: the card enters and folds on `springReveal`, as the brainstorm card does.

### 9. Strings

Chat's UI strings stay English, as the rest of Chat: `Add to initiative`, `Waiting on you`, `Change…`, `Add note`,
`Edit`, `Dismiss`, `Note added`, `Dismissed`. The user's content (titles, labels, notes) shows as written.

## Deviations

Controls the build added that the boards do not show (builder decisions, recorded by the run's lead):

- **Cancel in the editor of a card the agent proposed** (beside the verb and Dismiss). It is the only way back from
  `Edit`: it closes the editor to the compact card the agent proposed and drops the edited draft. Without it, a person
  who opened Edit to look could only add or dismiss. A card opened from a message keeps its own Cancel (§3: it goes,
  leaving no row).
- **`No topic` in the `Under` row**, shown once a topic is chosen. It is the only way to undo a topic choice and create
  an initiative with no parent, which §6's row already words for (`under …` is left out with no topic).

## Testing

- vitest for `chatinitiative.ts`: parsing (valid, broken JSON, unknown kind, missing text), the default target from
  block / `effortId` / `agentChunk`, the card's state (waiting, editing, adding, failed, added, dismissed, exited agent),
  the fold rows' wording, the label clip, the result line and its stripping from a bubble.
- CDP: steps in `agent-chat` (or a new scenario) that show the compact card, the editor from a message, the picker
  open, the ✓ row, the Dismissed row and the new-initiative editor, one per board.
- `task check:ts`; one `CHANGELOG.md` line under Added.
