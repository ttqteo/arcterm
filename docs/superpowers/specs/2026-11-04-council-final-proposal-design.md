# Council: a pinned final proposal in the Report, and Copy on every message

Status: design, 2026-11-04. From the brainstorm `council-final-proposal`.

## Why

A council's Report shows only The answer and the summary text the coordinator writes when it summarizes. When the
person asks the panel a follow-up ("bản đề xuất, i mean tổng hợp lại") and a seat answers with the proposal they
wanted (a table of six proposals, in the case that prompted this), that answer lives only in the Discussion: it never
reaches the Report, and the "Summarize again" banner does not count follow-up replies
(`frontend/app/view/agents/councilsummary.tsx:973` adds ideas + revised + stances only). Nothing in the chat or the
Report can be copied with one click either.

So:

1. Every seat message in the chat gets a **Copy** button.
2. The person can **pin one seat message to the Report**, where it shows as the **Final proposal** section, with
   Copy.

## Today

- The Report (`councilsummary.tsx:1226-1242`) draws `Summary.Answer` and `Summary.Text`, written by the coordinator in
  `synthesizeOn` (`pkg/council/runner.go:2576`).
- Like / dislike are kept on each idea and reply by `council.SetThumb` (`pkg/council/store.go:288`), reached through
  `CouncilThumbCommand` (`pkg/wshrpc/wshrpctypes_council.go:37`, `pkg/wshrpc/wshserver/wshserver_council.go:457`).
- `Council.Pinned` (`pkg/council/types.go:400`) already means "the whole council pinned to the top of its project
  tree": the new field must not reuse that name.
- `council.Markdown(c)` (`pkg/council/markdown.go:19`) writes the council's report. `WriteDocument`
  (`pkg/council/docpath.go:98`) writes it to disk when the council finishes (`runner.go:655`) and when the person saves
  (`wshserver_council.go:407`); an agent reads the same text through `wsh council` (`cmd/wsh/cmd/wshcmd-council.go:481`,
  `:829`).

## Design

### Copy on every seat message

- Every sent seat message in the chat (an idea, a reply, in the channel and in the thread panel) has a Copy button in
  its byline's hover end, beside like / dislike (`HoverEnd`, `Thumbs` in `councilchat.tsx`): shown on hover or focus,
  like them.
- Copy puts the message's markdown on the clipboard exactly as the seat wrote it: no seat name, no time.
- What "the message's markdown" is (Agent's call): a reply is its `Text`. An idea (`CouncilProposal`,
  `pkg/council/types.go:209`) is `## <Title>`, a blank line, its `Argument`, then its `Evidence` as a list when it has
  any; a Review idea's `Runs` and check `Label` are left out. A revised idea gives its current title and argument (a
  revision overwrites them in place, `runner.go:1593-1596`). One function per side writes it, and the Go `Markdown`
  section, the frontend model, the chat's Copy and the Report's Copy all use it, so the four agree.
- After a press the button reads "Copied" for about 1.5 s. It has an `aria-label` and shows on keyboard focus.

### Pin to the Report

- Beside Copy, the same hover end has **Pin to Report**, on every sent seat message (idea or reply, channel and thread
  panel). The person's own messages and unsent drafts cannot be pinned, the same rule as a thumb.
- One message is pinned per council. Pinning another replaces it, with no confirm.
- The pinned message wears a small always-visible "Pinned to Report" pill, and its Pin button becomes **Unpin**.
- A pinned idea that is later withdrawn stays pinned and shows its Withdrawn pill too.

### The Final proposal section in the Report

- At the end of the Report, after the directions and the kept ideas.
- It shows whether or not the council has a summary (Agent's call): with none, it sits under `NoSummary`, and the
  jump links hold only its entry. `outlineOf` / `jumpLinks` (`councilsummarymodel.ts:595-625`) return `[]` without a
  summary today, so they gain that case; `council.Markdown` likewise prints the section after "_No summary yet._"
  instead of returning before it.
- Header: the title "Final proposal", the seat that wrote the message and its time, **Open in Discussion**, **Copy**
  and **Unpin**.
- Open in Discussion lands on the pinned message itself (Agent's call). An idea goes through `councilChatNav`'s focus
  (`councilchatnav.ts`). A reply opens its idea's thread when it sits in one (`councilChatNav`'s open), or stays in the
  channel when it does not, then scrolls its post (`[data-council-reply-post="<id>"]`) into view with `revealIn` and
  rings it with the flash the quote jump already uses (`data-flash`, `FLASH_MS` in `councilchat.tsx`).
- Body: the message's markdown, drawn the way the chat draws it (tables, lists).
- Copy copies the message's raw markdown, the same as the chat's Copy.
- With nothing pinned the section is absent, with no empty placeholder.
- The Report's jump links (`JumpLinks` in `councilsummary.tsx`) gain a Final proposal entry while a message is pinned.

### Where the pin reaches

- The Final proposal section is part of `council.Markdown`, at its end after the directions, so an agent reading the
  council through `wsh council` sees the proposal the person pinned.
- Pinning or unpinning does **not** rewrite the saved document on disk: the saved file gets the section at its next
  save.

## Out of scope

- The "Summarize again" banner not counting follow-up replies (Agent's call): logged in `docs/open-issues.md`
  Actionable. The pin covers the case by hand.

## Left to the builder

- The name of the field on `Council` that holds the pinned message's id (not `Pinned`); `FinalPick` is a fair name.
- The RPC command, on the model of `CouncilThumbCommand`, with an empty item to unpin, checked as `SetThumb` checks
  (sent, not the person's own, an id the council has). Run `task generate` after adding it.
- The exact place of the section in `council.Markdown`, at its end.
- A clipboard helper already in the frontend, if there is one, over a new one.

## Testing

- Go: the pin command refuses the person's own reply, an unsent draft and an unknown id; pins, replaces and unpins;
  `Markdown` carries the Final proposal section only while a message is pinned.
- Frontend: a pure model for the section (which message, its seat and time, absent when nothing is pinned) with vitest
  beside it.
- CDP: a scenario that opens a council's Report with a pinned message and shows the Final proposal section, and the
  Discussion with the Pin / Copy hover end shown.
