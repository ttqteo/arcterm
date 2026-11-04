# Council: a pinned Final proposal in the Report, and Copy on every message — plan

**Spec:** `docs/superpowers/specs/2026-11-04-council-final-proposal-design.md`
**Verify:** `node scripts/verify.mjs ./pkg/council ./pkg/wshrpc/...`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs council-final-proposal council-summary council-discussion`

Goal: every sent seat message in a council's chat gets Copy and Pin to Report; the one pinned message shows as the
Report's **Final proposal** section (Open in Discussion, Copy, Unpin) and closes `council.Markdown`.

Shared names every task relies on (fixed here so the tasks can run side by side):

- Go field `Council.FinalPick string` with json `finalpick,omitempty` (`pkg/council/types.go`): the pinned idea's or
  reply's id (`P1`, `r3`), empty when nothing is pinned. Never the existing `Pinned` field, which pins the whole council
  in its project tree.
- Go `council.SetFinalPick(id, item string) (*Council, error)`: `item == ""` unpins; otherwise the same refusals as
  `SetThumb` (`pkg/council/store.go:304`): an id the council lacks, the person's own reply (`Author == YouId`), an unsent
  idea or reply (`!Sent(Draft)`). Nothing is saved on a refusal. It saves through `UpdateMark` (`store.go:199`, what
  `SetPinned` uses), never `Update`: `Update` stamps `Updated`, which is a no-summary council's ended time, and a pin
  would move the council in the tree.
- RPC `CouncilFinalPickCommand(ctx, CommandCouncilFinalPickData) error`, `CommandCouncilFinalPickData{ Id string
  json:"id"; Item string json:"item,omitempty" }`, on the model of `CouncilThumbCommand`
  (`pkg/wshrpc/wshrpctypes_council.go`, `pkg/wshrpc/wshserver/wshserver_council.go`), announcing the change the way
  the thumb command does.
- Go `council.MessageMarkdown(c *Council, id string) (string, bool)` (`pkg/council/markdown.go`) and TS
  `messageMarkdown(c: Council, id: string): string | null` (`frontend/app/view/agents/councilfinalmodel.ts`) write a
  message's markdown identically: a reply is its `Text`, trimmed; an idea is `## <Title>`, a blank line, its
  `Argument` (trimmed), then, when it has evidence, a blank line and one line per `CouncilEvidence` item. A Review
  idea's `Runs` and check `Label`, and an evidence item's `Quote`, `Cite`, `CiteNote` and `Region`, are left out. An
  evidence line is the per-item text Go's `evidenceText` (`pkg/council/prompts.go:490`) already writes, after `- `:
  - not weak: `- <Ref>`
  - weak with Ref and Note: `- <Ref> (weak: <Note>)`
  - weak with Ref only: `- <Ref> (weak)`
  - weak with Note only: `- weak: <Note>`
  - weak with neither: `- weak`

  Go factors that per-item text out of `evidenceText` into one function both use (Task 2). No trailing newline.

  The shared cases. Task 2's Go test and Task 3's TS test both use exactly these inputs and expected strings (`\n` is a
  newline):

  | Case | Input | Expected |
  |---|---|---|
  | reply | reply `r3`, Text `"  | A | B |\n|---|---|\n| 1 | 2 |\n"` | `"| A | B |\n|---|---|\n| 1 | 2 |"` |
  | idea, no evidence | `P1`, Title `Cache the tree`, Argument `Keep it in memory.` | `"## Cache the tree\n\nKeep it in memory."` |
  | idea, evidence | `P2`, Title `Pin rail apps`, Argument `Settings, not localStorage.`, Evidence `[{ref:"a.ts:12"}, {ref:"b.go:40", weak:true, note:"no test"}, {ref:"c.go:7", weak:true}, {weak:true, note:"about 3 s"}, {weak:true}]` | `"## Pin rail apps\n\nSettings, not localStorage.\n\n- a.ts:12\n- b.go:40 (weak: no test)\n- c.go:7 (weak)\n- weak: about 3 s\n- weak"` |
  | Review idea with runs | `P3`, Title `Fix the race`, Argument `Lock the map.`, Evidence `[{ref:"x.go:9", quote:"m[k] = v", cite:"ok"}]`, with Runs and a check Label set | `"## Fix the race\n\nLock the map.\n\n- x.go:9"` |
  | unknown id | `P9` | Go `("", false)`, TS `null` |
- TS `finalProposal(c: Council): FinalProposal | null` in `councilfinalmodel.ts`: `{ id, kind: "idea" | "reply",
  seatName, at, markdown, threadOf }` (`threadOf` the idea id a reply sits under, or null in the channel); null when
  `finalpick` is empty or names nothing the council has.
- TS store action `finalPickCouncil(id: string, item: string): Promise<CouncilCall<void>>` in
  `frontend/app/view/agents/councilstore.ts`, on the model of `thumbCouncil`: on success it patches the council's atom
  with `finalpick: item` so the buttons do not wait for `council:changed`.
- TS `revealCouncilMessage(councilId: string, messageId: string): void` and `councilRevealAtom` in
  `frontend/app/view/agents/councilreveal.ts`: sets the atom to `{ councilId, messageId }` and calls
  `showCouncil(councilId, "discussion")`; the chat consumes the atom once on screen and sets it back to null.
- DOM hooks the scenario reads. Chat: `data-council-copy="<id>"` (Copy button), `data-council-finalpick="<id>"` with
  `data-pinned="true"` when it is the pinned one (its label reads Unpin then), `data-council-pinned-pill="<id>"` (the
  "Pinned to Report" pill). Never `data-council-pin`: `councilpin.tsx:19` uses it for the whole-council pin. Report:
  `data-council-final` on the section, which also carries `data-council-section="final"` so the jump link's
  `sectionOf` fallback (`councilsummary.tsx:642`) finds it; `data-council-final-body`, `data-council-final-open`,
  `data-council-final-copy`, `data-council-final-unpin`; the outline / jump-link entry id is `final`.

### Task 1: Pin a message — the field, the store call and the RPC
**Depends on:** none
**Files:** `pkg/council/types.go`, `pkg/council/store.go`, `pkg/council/store_test.go`, `pkg/wshrpc/wshrpctypes_council.go`, `pkg/wshrpc/wshserver/wshserver_council.go`, `pkg/wshrpc/wshclient/wshclient.go`, `frontend/app/store/wshclientapi.ts`, `frontend/types/gotypes.d.ts`

Add `Council.FinalPick` (comment: the message the person pinned to the Report as its Final proposal; display only, no
prompt reads it; a re-summarize keeps it), `SetFinalPick`, the command type and its server handler as the shared names
above say. Then `task generate` and keep only the generated changes it makes (never hand-edit them).

Acceptance (tests in `store_test.go`, beside the `SetThumb` tests):
- `SetFinalPick` pins a sent idea, pins a sent seat reply, replaces an earlier pin, and `""` unpins; the saved
  council's `Updated` is unchanged by each.
- It refuses the person's own reply, an unsent (held or dropped) draft and an unknown id, and leaves the saved
  council's `FinalPick` unchanged on each.
- Run `go test ./pkg/council -run 'TestSetFinalPick'` (with the cgo env AGENTS.md gives on Windows).
- `frontend/types/gotypes.d.ts` has `finalpick?: string` on `Council` and `wshclientapi.ts` has `CouncilFinalPickCommand`.

### Task 2: The Final proposal section in `council.Markdown`
**Depends on:** Task 1 (reads `Council.FinalPick`)
**Files:** `pkg/council/markdown.go`, `pkg/council/markdown_test.go`, `pkg/council/prompts.go`

Add `MessageMarkdown` (shared names above; factor the per-item evidence text out of `evidenceText` in `prompts.go` so
both use one function, and `evidenceText`'s output stays byte-identical) and end `Markdown` with the section while
`FinalPick` names a message. The section is the very last thing `Markdown` writes, after `## Matrix` when there is one
(today `Markdown` writes the Matrix last, with or without a summary; the spec's "instead of returning" is loose wording
for the same end placement):

```
## Final proposal

_From <seat name>_

<MessageMarkdown>
```

The seat name is the expert's display name for the message's author (`seatOf`, as the rest of `Markdown` names
seats). With no summary the section follows "_No summary yet._" (and the Matrix, when there is one). `Document`
(which wraps `Markdown`) needs no change. Nothing in `prompts.go` reads `FinalPick`.

Acceptance (`markdown_test.go`):
- `MessageMarkdown` gives exactly the shared cases' expected strings (the table in the shared names).
- The existing `evidenceText` tests still pass unchanged.
- `Markdown` has no `## Final proposal` while nothing is pinned; while an idea or a reply is pinned it ends with the
  section, after `## Matrix`; on a council without a summary it has the section after "_No summary yet._".
- Run `go test ./pkg/council -run 'TestMessageMarkdown|TestMarkdownFinalProposal|TestEvidenceText'` (match the
  existing evidence test's name).

### Task 3: Frontend models — message markdown, the section, the outline entry, the pin action, the reveal request
**Depends on:** Task 1 (the generated `finalpick` field and `CouncilFinalPickCommand`)
**Files:** `frontend/app/view/agents/councilfinalmodel.ts`, `frontend/app/view/agents/councilfinalmodel.test.ts`, `frontend/app/view/agents/councilsummarymodel.ts`, `frontend/app/view/agents/councilsummarymodel.test.ts`, `frontend/app/view/agents/councilstore.ts`, `frontend/app/view/agents/councilstore.test.ts`, `frontend/app/view/agents/councilreveal.ts`, `frontend/app/view/agents/councilreveal.test.ts`

Pure models only; no `.tsx`.

- `councilfinalmodel.ts`: `messageMarkdown` and `finalProposal` as the shared names say. Seat name and time come from
  where the chat already reads them for a byline (reuse its helpers rather than a second lookup).
- `councilsummarymodel.ts`: `outlineOf` appends `{ id: "final", label: "Final proposal", count: null, depth: 0,
  rank: null }` last while
  `finalProposal(c)` is non-null, and returns only that entry when there is no summary (today it returns `[]`);
  `jumpLinks` therefore carries it too. Update the doc comments that say "Empty before a summary".
- `councilstore.ts`: `finalPickCouncil` as the shared names say.
- `councilreveal.ts`: `councilRevealAtom` and `revealCouncilMessage` as the shared names say.

Acceptance (vitest):
- `councilreveal.test.ts`: `revealCouncilMessage` sets `councilRevealAtom` to `{ councilId, messageId }` and leaves
  the council selected on its Discussion (`councilSelAtom`, `councilViewAtom` read through `globalStore`).
- `councilfinalmodel.test.ts`: `messageMarkdown` gives exactly the shared cases' expected strings;
  `finalProposal` is null with nothing pinned and for an unknown id, and gives seat, time, kind and `threadOf` for a
  pinned channel reply, a pinned thread reply and a pinned idea (a withdrawn idea included).
- `councilsummarymodel.test.ts`: the `final` entry is last with a summary, alone without one, absent when nothing is
  pinned; `jumpLinks` follows.
- `councilstore.test.ts`: `finalPickCouncil` patches `finalpick` on success (and `""` clears it), and leaves the atom
  as it was on failure.
- Run `npx vitest run frontend/app/view/agents/councilfinalmodel.test.ts frontend/app/view/agents/councilsummarymodel.test.ts frontend/app/view/agents/councilstore.test.ts frontend/app/view/agents/councilreveal.test.ts`.

### Task 4: Copy and Pin in the chat
**Depends on:** Task 3 (uses `messageMarkdown`, `finalPickCouncil`, `councilRevealAtom`)
**Files:** `frontend/app/view/agents/councilchat.tsx`

In the byline's hover end (`HoverEnd`, beside `Thumbs`), on every sent seat message — idea and reply, channel and thread
panel; never the person's own posts or an unsent draft (the thumb's rule):

- **Copy**: `writeClipboard(messageMarkdown(c, id))` from `frontend/app/element/copyfeedback.ts` (its `CopyState` and
  `COPY_HOLD_MS` drive "Copied"; a failure shows as failed, never "Copied"). `aria-label`, shown on hover and on
  keyboard focus like the thumbs.
- **Pin to Report** / **Unpin**: `finalPickCouncil(c.id, id)` or `finalPickCouncil(c.id, "")`. Pinning another message
  replaces the pin with no confirm. The pinned message also wears a small always-visible "Pinned to Report" pill; a
  pinned idea later withdrawn keeps it beside its Withdrawn pill.
- **Reveal**: while the channel is on screen, read `councilRevealAtom` for this council once, set it back to null, and
  land on the message: an idea through `councilChatNav`'s `focus`; a reply opens its idea's thread with `open` when
  `threadOf` is set (else stays in the channel), then `revealIn` its `[data-council-reply-post="<id>"]` and rings it
  with the existing `data-flash` / `FLASH_MS` (factor the ring out of `QuoteRow` so both use one function).
- The DOM hooks are the shared names' chat hooks. Icons and tokens per DESIGN.md (lucide icons, no raw colors).

Acceptance: `task check:ts` passes; the existing `council-discussion` scenario's thumb and byline layout steps
(`scripts/cdp/council/discussion.mjs`, ~2956-3080) still pass with the wider hover end (the Final runs it); the
scenario `council-final-proposal` (Task 6) steps "the hover end shows Copy and
Pin on a seat reply and an idea", "Copy puts the message's markdown on the clipboard and reads Copied", "Pin shows the
pill and Unpin; pinning another moves it", and "Open in Discussion lands on the pinned reply in its thread, ringed" show
this view and interaction.

### Task 5: The Final proposal section in the Report
**Depends on:** Task 3 (uses `finalProposal`, `outlineOf`, `finalPickCouncil`, `revealCouncilMessage`)
**Files:** `frontend/app/view/agents/councilsummary.tsx`

- At the end of the Report, after the directions and the kept ideas, while `finalProposal(c)` is non-null: the section
  `data-council-final` with its header (title "Final proposal", the seat and its time, **Open in Discussion**, **Copy**,
  **Unpin**) and its body, the markdown drawn with the same markdown renderer the chat uses for a message (tables,
  lists). Absent, with no placeholder, when nothing is pinned.
- With no summary, the section sits under `NoSummary`; the jump links (`JumpLinks`) come from `jumpLinks` and so hold
  only its entry; the outline anchor for `final` scrolls to the section like the other entries.
- Copy uses `writeClipboard(proposal.markdown)` with the same "Copied" feedback as the chat; Unpin calls
  `finalPickCouncil(c.id, "")`; Open in Discussion calls `revealCouncilMessage(c.id, proposal.id)`.
- The DOM hooks are the shared names' Report hooks. Styling per DESIGN.md, matching the Report's other sections.

Acceptance: `task check:ts` passes; the scenario `council-final-proposal` (Task 6) steps "the Report ends with the Final
proposal section, its table drawn, its jump link present", "the Report without a summary shows the section and only its
jump link", "Copy on the section copies the raw markdown", and "Unpin removes the section and the jump link" show it.

### Task 6: The `council-final-proposal` scenario, CHANGELOG and the open issue
**Depends on:** Task 4 (drives its Copy, Pin and reveal in the chat), Task 5 (drives the Report's Final proposal section)
**Files:** `scripts/cdp/council/finalproposal.mjs`, `scripts/cdp/councilscenarios.mjs`, `CHANGELOG.md`, `docs/open-issues.md`

- `scripts/cdp/council/finalproposal.mjs`, registered in `councilscenarios.mjs` as `council-final-proposal`, built
  like `summary.mjs` / `discussion.mjs` on `./fixtures.mjs` (`arrangeCouncilProject`, `seedCouncil` with an `edit`
  that adds a seat reply holding a markdown table, inside an idea's thread, and one in the channel, `openCouncil`,
  `teardownCouncilProject`). No model is called; `CouncilFinalPickCommand` stays real (it writes the temp project's
  fixture). Clipboard reads go through a `navigator.clipboard.writeText` spy installed in the page, not the OS
  clipboard. Steps, each with a screenshot under `cdp-shots/council-final-*.png`:
  1. the hover end shows Copy and Pin on a seat reply and an idea (focus the byline, assert `data-council-copy` and
     `data-council-finalpick`), and none on the person's own post;
  2. Copy puts the message's markdown on the clipboard (the spy saw exactly the reply's text) and reads Copied;
  3. Pin shows the pill (`data-council-pinned-pill`) and Unpin (`data-pinned="true"`); pinning another message moves
     both;
  4. the Report ends with the Final proposal section, its table drawn (`data-council-final-body table`), its jump link
     present;
  5. Copy on the section copies the raw markdown;
  6. Open in Discussion lands on the pinned reply in its thread, ringed (`data-flash="true"` on its
     `data-council-reply-post`);
  7. the Report without a summary (a second seeded council with `summary` removed and a pin set) shows the section
     under the no-summary state and only its jump link;
  8. Unpin removes the section and the jump link.
- `CHANGELOG.md`: one `Added` line under the top `Unreleased` section (open one if the top has a date): Copy on every
  council message, and pinning one to the Report as its Final proposal.
- `docs/open-issues.md` Actionable: "(arcterm) Council: the Summarize again banner does not count follow-up replies"
  (`frontend/app/view/agents/councilsummary.tsx`, the banner's count adds ideas + revised + stances only), noting the
  Final proposal pin covers it by hand.

Acceptance: `node scripts/cdp/verify.mjs council-final-proposal` passes against a dev app (the Final runs it); the
scenario file parses (`node --check scripts/cdp/council/finalproposal.mjs`).
