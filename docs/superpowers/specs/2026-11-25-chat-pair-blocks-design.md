# Chat: arc-pair and arc-judge blocks drawn as cards

Date: 2026-11-25. Design board: `.superpowers/design/chat-pair-blocks/project/A-grouped.dc.html` (gitignored, served by
arcterm's Canvas gallery).

## Problem

In a pair (`docs/guide/agent-pair.md`), the working agent ends every reply with an ```` ```arc-pair ```` fence (its
numbered `D`/`O`/`A` list), and a judge marks it with an ```` ```arc-judge ```` fence (`reopen D2: why`, `new: point`,
`no new points`). The Pair view hides both fences: it shows `agentpair.Body` (`pkg/agentpair/blocks.go:215`). But each
agent's own **Chat** draws its raw transcript, and nothing in `frontend/` reads either language, so Chat falls through to
the generic `CodeBlock`: a mono box labelled `ARC-PAIR` with numbered lines, 12+ lines long on every reply.

Draw both fences in Chat as cards.

## Today (facts the design stands on)

- `pkg/agentpair/blocks.go` parses both blocks for the server: `WorkerBlock` (the last top-level `arc-pair` fence; lines
  `D1 text`, `O2: text`, `A3 text`, a Markdown bullet read past; a note after ` — ` or ` -- `; an `A` item's chips as a
  closing `[a | b]`), `JudgeMarks` (the last top-level `arc-judge` fence; `reopen D2: why` or `reopen 2: why`,
  `new: point`, `no new points`, any case). Fences are found as `stepBlocksOf` finds `arc-steps`
  (`frontend/app/view/agents/chatsteplist.ts`): a fence closes on a line of the same character at least as long.
- Chat dispatches fenced languages in `diagramOf` (`frontend/app/view/agents/markdownmessage.tsx:261`): `arc-visual`,
  `arc-steps`, `arc-initiative` each draw their own view where Chat provides a host, and fall back to `CodeBlock`
  elsewhere.
- Mid-stream text goes through `tidyLiveText` (`chatlive.ts:164`), which already leaves an open `arc-visual` fence out
  until it closes.
- The Agent panel's Decided tab (`raildecidedpane.tsx`) draws the same list from `PairView.decided`, which the server
  computes; its chips answer both sides through `RpcApi.PairSayCommand(answerChip(...))` (`raildecided.ts`).
- `pairstore.ts` gives `usePairOf(tabId)` (the pair an agent is in) and `usePairView(pairId)`.
- Chat cards are built on `CardShell` (`chatbrainstormparts.tsx:186`): `rounded-[12px] border-edge-strong
  bg-surface-raised px-[16px] py-[14px]`, a 12px muted head row, entering on `springReveal`.

## Design

### The arc-pair card (Pair list): grouped, Agreed folded

Board `A-grouped`. Drawn for the newest `arc-pair` fence in the Chat.

- **Head row** (CardShell's): a list-check icon, `Pair list`, the counts `7 agreed · 1 open` (tabular-nums), then, in
  `asking` amber with a dot, `3 wait on you` (the `A` items not yet answered); `Nothing waits on you` in muted when none.
- **Waits on you** (11.5px medium muted label), first: each `A` item in its own box (`rounded-[10px] border-edge-mid
  bg-surface`), a 34px number column (`A5`, 12px muted tabular-nums) and its text (13.5px `ink-hi`), then its note, then
  a chip row: one pill per chip (26px tall, `rounded-full`, as the Decided tab's `CHIP`) and `other…`. An answered item
  shows `You answered <chip>` in place of the chips, at the same height so the box never resizes.
- **Still open**: each `O` item, number column and text (`secondary`), its note under it in muted.
- **The judge's marks, overlaid (builder question 1, your answer):** the working agent's Chat holds no `arc-judge`
  fence (relayed pair messages draw as plain sent cards), so the judge's marks come from the server. When the card is
  the pair's current list (the chips condition under **Chips**), it overlays `PairView.decided`: a `D` item a judge
  reopened moves from Agreed to Still open with `reopened by judge <tab>` as its note (the Decided tab's `openReason`),
  a judge's `new:` point (an unnumbered item in `decided.open`) shows in Still open with no number, and the head row's
  counts follow the overlaid list. The judge's reason is not shown: `PairItem` carries no reason (`Reopen.Why` is
  dropped in `pkg/agentpair/view.go`), and this change stays frontend-only. A read-only card draws the fence as written,
  with no overlay.
- **Agreed**, last, behind a top border (`edge-mid`): folded by default to one button row: chevron, `Agreed`, the count,
  and, in `ink-faint`, which items this reply newly agreed (`· D11 agreed in this reply`, against the Chat's previous
  `arc-pair` block; left out when none or when there is no previous block). Pressing it opens the list (number column,
  text in `ink-hi`, note in muted). The open state is local to the card (a glance, not persisted).
- A section with no items is left out of the card (the head row's counts already say 0).
- Lines that do not parse are skipped, as `WorkerBlock` does. A fence that lists no item that parses stays a code block.

### Older lists in the same Chat

Only the newest `arc-pair` block draws the full card. Each earlier one folds to one row (`DoneRow`-like:
`rounded-[10px] border-edge-mid bg-surface px-[14px] py-[9px] text-[12.5px]`): the list-check icon, `Pair list`, its own
counts `6 agreed · 2 open · 3 wait on you`, and at the right in `ink-faint` `a newer list replaced it`, with a chevron.
Pressing it opens that list as plain rows (label column + text, muted, no chips, no sections).

### The arc-judge card (Judge marks)

- **Head row**: a scale icon, `Judge marks`, the counts `1 reopened · 1 new point`.
- One row per mark, in a `108px | 1fr` grid: a tag (`rounded-[6px] bg-surface-selected text-[11.5px]`, with an icon:
  rotate-ccw for `Reopens D4`, plus for `New point`), then the text (13.5px `ink-hi`). A reopen's second line, in muted,
  is the reopened item as the newest `arc-pair` list has it (`D4 · <text>`), read from the pair's `PairView.decided`;
  without a pair view it is left out.
- A fence with only `no new points` (or empty) draws one row: a green ✓ (`success`), `Judge marks`, `No new points`.

### Chips

The chips of the newest card answer exactly as the Decided tab's do: `RpcApi.PairSayCommand(TabRpcClient,
answerChip(pairId, item, chip))`, so the working agent and the judge both get it; the pressed item's chips are disabled
while it sends, and a failure toasts `Answer not sent` (as `raildecidedpane.tsx`). The answered state comes from
`PairView.decided.asks[].answer`.

**Agent's call (builder question 2):** `other…` opens the pair conversation (`showPair(pairId)`), as the Decided tab's
does. Text typed in the agent's own Chat box is a plain prompt to the working agent: the judge does not get it and
`Decided` never records it as the item's answer, so it is not offered as the way to answer.

**Agent's call (builder question 3):** chips are drawn only when all of these hold: the card is the newest `arc-pair`
block of the Chat; the agent is in a live pair (`usePairOf(agent tab)`); and the card's `A` items, by number and text,
are exactly `PairView.decided.asks` (the server's anchor list). Otherwise the card is read-only: no chips, no
`You answered`, and `N wait on you` counts every `A` item of the fence. This covers a list written before the pair
started, and a fence that just closed while its turn has not ended (the server's anchor is still the previous list);
the chips appear once the turn ends and the anchor moves. An older card, an unpaired agent, and a council's messages
are read-only the same way.

### Streaming

An `arc-pair` or `arc-judge` fence still open mid-stream is left out, as `tidyLiveText` does for `arc-visual`. When it
closes, the card enters on `springReveal` (CardShell). Agreed and an older list fold and open on `springReveal`; their
chevron turns on the Fluid ease at `durMicro`. The chips row and the `You answered` line crossfade at `durMicro`.
Reduced motion: `usePartMotion`, as every Chat card.

## Build notes (left to the builder, confirmed)

- A pure `frontend/app/view/agents/pairblocks.ts` with `pairblocks.test.ts` beside it: `PAIR_LANG`, `JUDGE_LANG`,
  `parsePairItems(body)`, `parseJudgeMarks(body)` with the same line rules as `blocks.go`, and the "agreed in this reply"
  diff of two lists. Keep the regexes identical to `blocks.go` and say so in a comment on both sides.
- The view, `chatpairblock.tsx`, on `CardShell`; dispatched from `diagramOf` in `markdownmessage.tsx` like `StepsBlock`,
  falling back to `CodeBlock` outside Chat's host. Which block is the newest in the Chat is decided by Chat (like
  `placeStepLists` for steps), not by the block itself.
- `tidyLiveText` leaves open `arc-pair` / `arc-judge` fences out, with a test in `chatlive.test.ts`.
- A CDP scenario (in `scripts/cdp/`) shows the newest card with Agreed folded and opened, an older folded list, and a
  judge card with a reopen and a new point.
- `CHANGELOG.md`: one `Changed` line ("In Chat, a pair's list and a judge's marks show as cards instead of code").
