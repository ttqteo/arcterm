# Judge on a reply: pick the reply a judge round starts from, and see it marked

Brainstorm: `.superpowers/brainstorm/judge-on-reply/brainstorm.json`. Sketch:
`~/.arc/visuals/2026-11-26-judge-mark.html`, tab "Cả hai". Builds on the agent pair
(`docs/superpowers/specs/2026-11-25-agent-pair-judge-design.md`, guide `docs/guide/agent-pair.md`).

## Why

Add judge sits in the working agent's header and always sends the agent's **latest** reply
(`Manager.Start` / `Manager.Brief` read `Link.LastAnswer`, `pkg/agentpair/manager.go:265`, `:337`). A person who
scrolls up to an older reply and presses it still gets the newest one judged. And while the judge reads, nothing in
Chat says which reply it is reading: the first mark appears only when the judge's answer is relayed back
(`chatpairrelay.tsx`, "arcterm paired this agent with …").

The person wants both: choose the reply to judge where they read it, and see which reply (and which stretch of turns)
a judge round covered.

## What exists today (recon)

- A pair's first message is the worker's latest reply, with its `Text` and `Ts` (`manager.go:373`); the judge owes an
  answer to it. `JudgeBrief` pastes that reply into the brief (`pkg/agentpair/brief.go:55`) and names plan/spec paths
  for the judge to read itself, without pasting them (`brief.go:31`).
- `AgentFacts` carries the working agent's `Cwd` and `Transcript` path (`pkg/wshrpc/wshserver/wshserver_pair.go:317`).
- A stored prose part in Chat carries the `uuid` of its transcript record (`frontend/app/view/agents/chatmodel.ts:62`),
  which Fork from here already uses (`forkPointOfProse`).
- The buttons under an agent reply are `BubbleCopy` (`chatconversation.tsx:186`, used at `:1626`): Copy, Add to
  initiative…, Fork from here, shown on hover or focus. A live (still streaming) prose part has none.
- The header's pair controls are `pairjudgemenu.tsx`: an unpaired agent gets the **Add judge** button
  (`AddJudgeButton`, not `compact`); a paired worker gets **Pair** plus a compact **+** (Add another judge). The menu
  (`PairJudgeMenu`) offers Wake <name>, Open a new judge, and live agents in the project.
- `judgeKeysByItem` (`chatjudge.ts`) already matches a record to the Chat item whose prose has the same text; the same
  idea finds the reply a pair started from.

## Decisions

### 1. The entry: ⚖ on the reply, on hover only (answer 1)

- The header **loses the Add judge button** of an unpaired agent. A paired worker's header keeps its **Pair** button
  and the compact **+**, as today.
- **⚖ Judge this reply** joins the row of buttons under an agent reply (`BubbleCopy`: Copy, Add to initiative, Fork).
  It shows on hover or focus like the others, **the newest reply included**: no always-visible button.
- Pressing it opens the same menu as Add judge today (`PairJudgeMenu`: Wake <name>, Open a new judge, a live agent),
  anchored at the button, and the pair it makes starts from **that** reply.
- Only a finished reply has it (a live, streaming prose part has no buttons, as today), and only in a live Claude or pi
  agent's Chat where pairing is possible (the same rule the header button used).
- Agent's call: the ⚖ sits on the **last prose part of an agent turn** only, the part `LastAnswer` would have returned
  as that turn's reply. Earlier prose parts of the same turn (text between tool calls) do not get it.
- Agent's call: while the agent is in a pair that is not ended, ⚖ under every reply is dimmed and does nothing; its
  tooltip says a judge round is running and to Unpair or let the round end. Adding another judge stays the header's +.
- pi (builder question 5, the person's answer "skip pi"): no pi work in this change. The pi projection stays as it is
  (its prose parts have no record id, `pitranscriptprojection.ts:168`), so a pi agent's Chat shows ⚖ only on its
  **latest** reply, which pairs with an empty `From` as today; older pi replies get no ⚖. No pi transcript reader.
- Agent's call (builder question 2): ⚖ shows only on replies of the agent's **current** session, whose record uuid is in
  the transcript wavesrv reads. Replies from an earlier session drawn in the same Chat get no ⚖.
- Ways that are kept: the Agent tree's **Pair: worker + judge** sheet (it still takes the latest reply) and the
  paired header's **+**. In the Terminal view there is no reply to press; the tree is the way there.

### 2. Judging an older reply: the reply plus the transcript path (answer 2, judge's pick)

When the chosen reply is not the latest:

- The pair's first message is **the chosen reply**, with its own text and timestamp, and the judge owes an answer to it.
  `Seen[worker]` is the latest answer's timestamp, as today, so the relay starts with the worker's **next** turn: the
  turns between the chosen reply and now are not relayed and not added to the pair's conversation.
- The judge's brief pastes the chosen reply (as it pastes the latest today) and adds the working agent's **transcript
  path** and the reply's record uuid, with one sentence: the agent has gone on since this reply; read what it did after
  it in the transcript if it bears on your judgement, and judge the code as it is now. No turns are pasted and nothing
  is summarised.
- When the chosen reply is the latest, the brief is exactly today's (no transcript paragraph).
- Agent's call (builder question 4): the working agent is told too. Its first relayed prompt, after `WorkerBrief`, says
  the judge is judging its reply from <HH:MM>, and to weigh the judgement against what it has done since. The sentence
  is only added for an older reply. `pairrelay.ts` and its fixtures (`viewmod_fixtures_test.go`) learn the new sentence
  so Chat keeps folding the brief into one line.

Mechanism (Agent's call): `CommandPairStartData` and `CommandPairBriefData` gain an optional `From` (the transcript
record uuid of the chosen prose part). Empty means the latest reply, today's behaviour. wavesrv reads that record's text
and timestamp from the worker's transcript (a new `Link` method beside `LastAnswer`, e.g. `AnswerAt(tab, uuid)`, backed
by a reader in `pkg/agentsessions` for claude). A uuid that is not found is an error the menu shows; nothing
falls back to the latest silently. `JudgeBriefInput` gains `Transcript` and `Later bool`. Run `task generate` after the
wshrpc type change.

### 3. The mark: which reply and which stretch a round judged (sketch, confirmed)

In the working agent's own Chat:

- The reply the round started from (matched by the pair's first worker message, text and timestamp, as
  `judgeKeysByItem` matches) gets a **⚖ line** under it, drawn like the choice judge's line (`chatjudgeline.tsx`): a
  hairline rule, muted 12.5px text, no box.
  - While the judge owes its first answer: a spinner and "Judge đang chấm reply này · N s" / "The judge is reading this
    reply · N s", and **Open pair** at the line's end (opens the pair conversation, as the header's Pair button does).
  - After that, while the round lives: "⚖ Vòng judge bắt đầu ở đây" / "⚖ The judge round starts here", with Open pair.
- The turns that belong to the round carry a **2px accent bar** on their left, from the marked reply down to the bottom
  while it lives.
- Agent's call (builder question 1): an ended round's bar stops at the **last worker message recorded in the pair**
  (matched in Chat by text, as the first one is). No new stored field. A pair that ended by Unpair gets the same grey
  static mark as one that ended because the person went back to the agent.
- Overlapping rounds (builder question 3, the person's answer): every round keeps its own ⚖ line on the reply it
  started from; a reply that started two rounds carries both lines, the older above. Where two rounds' bars cover the
  same turns, only the **newer** round's bar is drawn there. `pairmark.ts` gives each item one bar owner and a list of
  lines.
- A round that has **ended** keeps a static mark on its first reply: "⚖ Vòng judge 13:40–13:52 · 3 chốt, 0 còn mở" /
  "⚖ Judge round 13:40–13:52 · 3 agreed, 0 open", with a **grey** bar, and the line opens the pair's page in Library
  (through `openAddress` with `{ kind: "pair", pairId }`, `frontend/app/view/jarvis/address.ts:29`).
- Words are Vietnamese when the person writes Vietnamese (`writesVietnamese`), else English, as the pair's other words.
- Motion follows the judge line: the line opens under its message on the spring and its state text cross-fades on the
  micro ease; the bar's colour eases from accent to grey when a round ends. Reduced motion: end states at once.

Agent's call: the turns between an older chosen reply and the pairing moment sit inside the bar (the bar runs from the
marked reply on), since the judge is told to read them.

## Left to the builder

- Where the Chat finds the pairs of this agent (live ones from the pair store the header already reads; ended ones from
  `PairHistory` for the project) and how often it re-reads; keep it to the agent's own pairs.
- How a reply is matched when the pair's first message text is not found in the loaded Chat (an older session part not
  loaded): no mark, no error.
- The exact tooltip and empty states of the dimmed ⚖.

## Docs, changelog, checks

- `docs/guide/agent-pair.md`: "Bắt đầu một pair" says the main way is ⚖ under a reply, describes the older-reply brief,
  and the mark; drop the header Add judge wording (the paired header's Pair and + stay).
- `CHANGELOG.md`: one `Changed` line (Add judge moved onto each reply, and an older reply can be judged) and one `Added`
  line for the mark; the mark is UI the person opens to try, so `<!-- big -->` with its `<!-- shot: … -->`.
- Tests: Go tests for `Start` / `Brief` with `From` (older reply as first message, Seen at latest, brief has the
  transcript paragraph; unknown uuid errors; empty From unchanged) and for the claude transcript reader. A pure
  frontend module (e.g. `pairmark.ts` + test) for which item a pair marks, which items its bar covers, and the line's
  words per state.
- UI: a CDP scenario that shows the ⚖ in the hover row, the reading line, the live bar and an ended round's static
  mark; `arc:ux-check` once at the end.

## Builder's calls (autonomous run, 2026-11-26)

Made by the run's lead with nobody at the cockpit; each with why.

- **Matching a pair message to a Chat reply is by shown text.** `PairMessage.text` is `agentpair.Body(raw)` (the last
  `arc-pair` / `arc-judge` fences and a leading `> ` line taken out), while a Chat prose part holds the raw text. The
  frontend gets `replyBody(text)`, a port of Go's `Body` (text half) in `pairmark.ts`, and a reply matches a worker
  message when `replyBody(part.text).trim() === msg.text.trim()`. When two parts match, the later one wins. Why: no new
  wire or stored field, and the same rule serves the first and the last worker message.
- **The older-reply fact is stored on the pair** as `Pair.Later bool` (`json:"later,omitempty"`). Why: the worker's
  first relayed prompt is built later (`buildPrompt`), when `Seen[worker]` may already have moved on, so it cannot be
  derived then. The spec's "no new stored field" is about the ended bar, which this does not touch.
- **The worker's sentence is appended, not woven into `WorkerBrief`:** `buildPrompt` adds
  `"\n\n" + OlderReplyNote(ts)` after `WorkerBrief(names)` when `p.Later`. `WorkerBrief`'s signature stays. Chat's
  parser already folds everything before the first relay head that starts with `arcterm has paired you with `, so the
  fold holds; a fixture (`pair-relay-first-older`) and a test prove it.
- **The judge's brief for an older reply** keeps today's text and the paste, with its delimiters reading
  `--- the agent's reply ---` (not "latest") and a paragraph above it naming the transcript path and the record uuid.
  `pairrelay.ts`'s `REPLY` pattern accepts both delimiters; fixture `pair-judge-brief-older` proves it.
- **Later is decided on the server:** wavesrv reads the chosen reply (`AnswerAt`) and the latest (`LastAnswer`); the
  reply is later-than-chosen when its timestamp differs from the latest's. Pressing ⚖ on the newest reply therefore
  gives exactly today's brief, with or without a `From`.
- **`From` is ignored when the judge joins an existing pair** (the header's +): that pair already has its first message.
- **An unknown uuid is a toast**, the same `Couldn't add a judge to <name>` toast every failed pick already shows
  (`pairlaunch.ts` `addFailed`): the menu closes on a pick, so the toast is where the error can be read.
- **⚖ shows only where Chat shows the agent's own transcript.** A fork that still shows the session it forked from
  (`forkShowsSource`) is another session's records, so its replies get no ⚖. A Claude reply without a `uuid` gets none.
- **The pause card's judges-gone note** ("Add judge in the header pairs one again") becomes "⚖ under a reply pairs one
  again" / its Vietnamese twin, since the header button is gone.
- **The CHANGELOG `Added` line carries `<!-- shot: none -->`** and a `docs/hand-checks.md` line asks for the shot
  (`node scripts/whatsnew-shot.mjs judge-mark`): an agent an Arc run starts runs no CDP, and the Final's files are not
  committed. Why: whatsnew.test.ts fails a big line whose picture is missing.
- **Where the marks read pairs:** live pairs from `usePairs()`, ended ones from `usePairHistory(project)`, each kept to
  `worker.tab === agent.id`, and each pair's messages from `pairViewAtom` (loaded with `loadPair` once per id, again on
  `pair:update` as the store already does). No polling of its own.
