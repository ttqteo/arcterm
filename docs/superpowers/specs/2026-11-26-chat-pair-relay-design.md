# Chat: a pair's relayed reply drawn as the other agent's turn

Date: 2026-11-26. Design boards: `.superpowers/design/chat-pair-relay/project/F-reply-worker-side.dc.html` (the judge's
reply in the working agent's Chat) and `G-reply-judge-side.dc.html` (the working agent's reply in the judge's Chat),
gitignored, served by arcterm's Canvas gallery. The options not taken (one card per relay, brief as a marker, thread
rows, one line per message, the brief's example redrawn) are in `unchosen/` beside them.

## Problem

In a pair (`docs/guide/agent-pair.md`), arcterm relays each agent's reply to the other as a prompt. Chat reads that
prompt as a cockpit message and draws the generic sent card: a head `message · from arcterm pair`, then the text in
mono, cut to six lines. So:

- **The reply is lost.** On the working agent's first relay, the pair brief comes first and fills the six lines; the
  judge's words after it never show. The screenshot that started this showed only the brief.
- **It reads as a notice, not a reply.** No sender, no time, no way to open the sender's tab; its `arc-judge` /
  `arc-pair` fence is plain mono text, where the same fence in an agent's own reply is a card.
- The brief, written for the agent, takes the person's attention.

What comes in is another agent's reply: draw it as that agent's turn.

## Today (facts the design stands on)

- arcterm wraps everything the pair sends in `agentmsg.PairEnvelope` (`pkg/agentmsg/agentmsg.go:29`): one line
  `[Message from agent "arcterm pair" (relayed by arcterm's pair …)]`, then the text. Three texts ride in it:
  1. **A relay** (`pkg/agentpair/manager.go:840`): `RelayPrompt` (`pkg/agentpair/brief.go:153`) joins, with blank lines,
     an optional opening and one part per message. Each part is a head line from `relayHead` (`brief.go:128`), then the
     sender's text as written (its `> quoted line` and fences included):
     - `From the judge "<name>", 15:04:`
     - `From the working agent "<name>", 15:04:`
     - `From the person (typed in arcterm, not an agent), 15:04:`; the text may open with `> <line>` and
       `Answer to A<n>: ` (`relayItem`, `manager.go:878`)
     - `From arcterm` for anything else; the `, 15:04` part is absent when the time is 0.

     The opening, on the working agent's first relay only, is `WorkerBrief` (`brief.go:91`), which starts
     `arcterm has paired you with `.
  2. **The judge's brief** (`manager.go:384`): `JudgeBrief` (`brief.go:24`), which starts
     `You are the judge of another agent's work. arcterm pairs the two of you: the agent is "<name>" (tab <tab>).` and
     may hold the working agent's latest reply between `--- the agent's latest reply ---` and `--- end of the reply ---`.
  3. **The end notice** (`pkg/agentpair/hold.go:135`): `The pair has ended: no judge holds your heavy commands any more.`
     and one `` - `<cmd>` was held: you may run it now. `` line per command.
- The arc view mod parses the envelope (`PAIR_MESSAGE`, `claude/arc-view-mod/hooks/prompt-core.ts:282`, `message()`
  `:288`) into a `Card` whose body is the text's non-blank lines. Chat's `readSent` (`frontend/app/view/agents/chatmodel.ts:169`)
  takes that card, `cardLines` cuts it to `SENT_LINES` = 6 (`chatmodel.ts:129`), and `SentCard`
  (`chatconversation.tsx:575`) draws it. A pair message has no `tabId`, so it never gets the `markdown` field that a
  `wsh agents send` message gets (`chatmodel.ts:185`).
- Chat draws an agent's prose with `MarkdownMessage` (`markdownmessage.tsx:388`), whose `diagramOf` (`:264`) turns an
  `arc-pair` fence into `PairBlock` and an `arc-judge` fence into `JudgeBlock` (`chatpairblock.tsx:69`, `:84`) under
  Chat's `ChatPairHost`. `PairBlock` draws the full Pair list only for the list `placePairLists`
  (`pairblocks.ts:159`) marked newest, found by the prose part's key (`useChatPartKey`); `placePairLists` reads only
  `agent` items today.
- `pairOf(pairs, tabId)` (`pairmodel.ts:158`) gives the live pair a tab is in, with `worker` and `judges` as
  `{name, tab}`; an ended pair is skipped.
- The mod's fixtures are written by Go from the real functions (`pkg/orchestrate/viewmod_fixtures_test.go:137`
  writes `pair-message.txt` with `agentmsg.PairEnvelope`), and `chatmodel.test.ts` reads them.

## Design

### The relayed reply (boards F and G)

A relay draws as one item per message in it, in order. A message from a judge or the working agent is a **reply
card**:

- Right side (it comes into this agent), `width: 88%` so the fence cards inside it have room; `rounded-[12px] border
  border-edge-mid`, `px-[14px] pt-[10px] pb-[14px]`, `gap-[10px]`.
- **Head row**: a 22px `bg-surface-raised` mark (the `Scale` icon for a judge, a `Hammer` icon for the working
  agent), the sender's **name** in `text-primary font-medium` with an `ArrowUpRight`, then `judge · replied` or
  `working agent · replied` in `text-muted text-[11.5px]`, the time at the row's end (`tabular-nums`). The name and arrow
  are one button that opens the sender's conversation (`openOrPeek`, ctrl-click peeks), as the sent card's head does
  today. When the sender's tab cannot be found (below), the name is plain text, with no arrow.
- **Quote**: a leading `> line` is lifted out of the text and shown as one muted row (a `CornerDownRight` icon, the
  line), not as a blockquote.
- **Body**: the rest of the text through `MarkdownMessage`, at the agent prose size, **whole, never folded**: a reply
  is not cut, as an agent's own reply is not, and its fence card sits at its end. `arc-judge` becomes the Judge marks
  card, `arc-pair` the Pair list, as in the sender's own Chat.
- **Text as relayed**: a muted disclosure at the card's foot opens the part as it was relayed (its head line and text)
  in a code box, so the person can check what the agent read.

A message from **the person** draws as the person's own words: a `You` row inside the relay (name `You`, then
`answered A<n> in the pair` when the text opened with `Answer to A<n>: `, or `in the pair`; the time), its text without
that prefix. It is not a reply card: nothing to open.

A part headed `From arcterm` stays inside the relay as a plain row (`arcterm`, then its text whole as Markdown): it is
not a reply card, nothing to open. Any text the parser cannot split falls back to the sent card, now with the whole
text as Markdown (no six-line cut).

### The brief

Neither brief is a message from anyone, so neither is a card:

- **Working agent's first relay**: the `WorkerBrief` opening becomes one muted line above the relay's first card, right
  aligned: a pair icon, `arcterm paired this agent with <judge names> · <time of the first message> ·`, and a `Brief`
  toggle. Opened, it shows the brief through `MarkdownMessage` in a `bg-surface` box (`rounded-[10px]`, `max-w-[88%]`);
  its `arc-pair` example stays a code block (the brief is outside the pair host, see Parsing).
- **Judge's brief**: the same line, `arcterm made this agent the judge of <name>` with the `Brief` toggle. When the
  brief holds the working agent's latest reply, that reply draws under the line as a reply card from the working agent
  (no time: the brief carries none), so the judge's Chat opens on the reply it judges.

### The end notice

`The pair has ended…` draws as one muted line, `The pair ended`, and under it the commands it lets through, each in mono
(`` `<cmd>` may run now ``). No card.

### The sender's tab

The head names the sender, not its tab. Chat finds the tab in the live pair the conversation's agent is in
(`pairOf(pairs, thisTab)`): the judge whose `name` matches, or the `worker` for the working agent. The judge's brief
names the working agent's tab outright. An ended pair, or a name that two judges share, gives no link.

### Pair list placement in the judge's Chat

In the judge's Chat, the working agent's list only ever arrives inside a relay. `placePairLists` also reads the
working agent's messages in relay items (and the reply a judge's brief holds), in transcript order with the agent's own
replies, so the newest list there draws in full. Its A items keep their chips: the Pair list is one card, and a chip
answers through the pair wherever it is pressed (`useChipAnswer`), as board G draws.

### Motion

- The `Brief` toggle and `Text as relayed` open and fold on `springReveal`, their chevrons turning on the micro tween.
- A reply card enters as a sent card does today; a relay's messages show at once, with no cascade.
- The Judge marks and Pair list cards keep their own motion.

## Parsing (pure, `frontend/app/view/agents/pairrelay.ts`)

`parsePairRelay(text)` takes the text inside the envelope and returns one of:

- `{ kind: "relay", brief: string | null, messages: RelayMessage[] }`, where `RelayMessage` is
  `{ from: "judge" | "worker" | "person" | "arcterm", name: string, time: string | null, quote: string | null,
  answers: number | null, text: string, raw: string }`. Parts split at a line that matches a `relayHead` shape **and**
  follows a blank line (or opens the text); everything before the first head is the brief, kept only when it starts
  `arcterm has paired you with`.
- `{ kind: "judgeBrief", workerName, workerTab, brief, reply: RelayMessage | null }`.
- `{ kind: "ended", commands: string[] }`.
- `null` for anything else (the caller falls back to the sent card with full Markdown).

Chat's `readSent` routes a pair envelope to it and returns the sent item with a `relay` field: it stays a `sent` item, so
it still starts a turn (`chatsteplist.ts:136`), sits on the right and is compared as one (`chatitemeq.ts:157`). A pair
text the parser returns `null` for gets `markdown` (its whole text) instead, which the sent card already draws whole.
The mod's `prompt-core.ts` is not changed: its TUI row keeps its card.

The Go texts and this parser must agree, so Go writes the fixtures: `viewmod_fixtures_test.go` adds `pair-relay-first`
(`RelayPrompt` with `WorkerBrief` and a judge message whose text holds a `> ` line and an `arc-judge` fence),
`pair-relay-batch` (a judge message, then a person's `Answer to A3:` message), `pair-relay-worker` (the working agent's
reply with an `arc-pair` fence), `pair-judge-brief` (`JudgeBrief` with a reply) and `pair-ended` (the end notice),
each through `agentmsg.PairEnvelope`. A change to a head or a brief's opening then fails `pairrelay.test.ts` until the
parser follows.

## Out of scope

- The Pair view (`docs/guide/agent-pair.md`) and the Agent panel's Decided tab: they already draw these messages from
  the server's model.
- The TUI's row for the message (the arc view mod).
- What arcterm writes to the agents: no Go text changes; the brief stays as it is. The end notice moves, word for word,
  from `Unpair` into an exported `EndedNotice` so the fixture test can write it.

## Verification

- `pairrelay.test.ts` over the five fixtures: the split, names, times, quote, `Answer to A<n>`, the brief kept or not,
  a body line that looks like a head but follows no blank line staying in the text.
- `chatmodel.test.ts`: a pair envelope becomes a sent item with `relay`; the six-line cut no longer applies to it; an
  unparsable pair text keeps a sent card with full Markdown.
- `pairblocks.test.ts`: `placePairLists` marks a relayed working-agent list newest in the judge's Chat.
- A CDP scenario `chat-pair-relay` on the dev app with a mock transcript of both sides: the reply card's head, quote,
  Judge marks card, Pair list, the folded brief line and its opened state, `Text as relayed` opened; `arc:ux-check` for
  the two disclosures' motion.
- `CHANGELOG.md` under `Changed`: a pair's relayed reply now reads as the other agent's turn in Chat, whole, with its
  marks and list as cards.
