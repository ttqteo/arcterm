# Council: add a chat to a council that already exists — plan

**Spec:** `D:\work\arcterm\docs\superpowers\specs\2026-11-02-council-add-chat-design.md`
**Verify:** `node scripts/verify.mjs ./pkg/council ./pkg/wshrpc/...`
**Check:** `task check:ts && go vet ./pkg/council ./pkg/wshrpc/...`
**Final:** `node scripts/cdp/final-verify.mjs council-discussion`
**Prototype:** D:\work\arcterm\.superpowers\design\council-add-chat\project\B-at-mention.dc.html

The person types @ in a council's message box, picks one or more live claude or pi chats under **Add a live chat**, and
on Send wavesrv seats them and posts the message to them. On the Go side: the wire field and the stored draft mode
(Task 1), seating on reply and the mention key (Task 2), the joining chat's first prompt (Task 3), and the follow-up
estimate pricing chats at their context (Task 4). On the frontend: the pure picker model (Task 5), then the composer
view with its CDP steps (Task 6). Tasks 1, 3 and 5 start at once.

Go tests on Windows need cgo: prefix `go test` with `CGO_ENABLED=1 CC="zig cc -target x86_64-windows-gnu"` (Bash).
Never hand-edit `frontend/types/gotypes.d.ts`: run `task generate`.

**The mention key, one rule for Go and the frontend.** A chat's mention key is the shortest prefix of its tab id, 8
characters or more, that no other chat in the set shares (the set: the chat seats in Go; the chat seats plus the
listed chats in the picker). A chat seat is reached by `@` followed by a whole word (word boundary as `mentions` reads
one) of 8 characters or more that starts its tab id and starts no other chat seat's tab id. So the picker's inserted
key, which is unique in a wider set, always reaches its seat.

### Task 1: Reply wire field and the stored draft mode
**Depends on:** none
**Files:** `pkg/wshrpc/wshrpctypes_council.go`, `pkg/council/types.go`, `pkg/council/types_test.go`, `pkg/council/runner.go`, `pkg/council/runner_test.go`, `frontend/types/gotypes.d.ts`

Interfaces other tasks rely on:

- `CommandCouncilReplyData` gains `Agents []string \`json:"agents,omitempty"\``: the tab ids (or unique prefixes) of
  the chats the message seats. Doc comment: they are seated before the message is posted; a gone or unseatable id
  fails the send, and an id named twice or already seated sits once.
- `CommandCouncilEstimateData.Agents`'s doc comment also covers a follow-up (Id and Followup or Agents set): there it
  names the chat answerers, each priced at its context (Task 4 implements it).
- `Council` gains `DraftMode string \`json:"draftmode,omitempty"\``, with constants `DraftModeHeld = "held"` and
  `DraftModeFree = "free"`. Do not reuse or redeclare `DraftHeld` (`types.go`, an idea's or reply's draft state).
  Empty means a record from before the field.
- `func freezeDraftMode(c *Council)` in `types.go`: when `c.DraftMode` is empty, it sets it from today's rule
  (`HasAgents(c) && !c.ByAgent` → held, else free). A set mode is left alone. Task 2 calls it just before it seats
  joining chats.
- `HoldsDrafts(c)` returns `c.DraftMode == DraftModeHeld` when the mode is set, and today's rule when it is empty.

Set the mode at start: `beginFresh` in `runner.go` (Start, StartSaved and the queue all go through it) clears
`DraftMode` and calls `freezeDraftMode`, so a re-run of a saved council takes the mode its seats give at that start.
Then run `task generate` and keep only the `gotypes.d.ts` change it makes.

Acceptance:
- `types_test.go`, extend `TestHoldsDrafts` and add `TestFreezeDraftMode`: a stored `held` holds and a stored `free`
  does not, whatever the seats are now. An empty mode with no chat reads free; `freezeDraftMode` stores `free`, and
  seating a chat afterwards still reads free. An empty mode with a chat at start (not `ByAgent`) freezes to `held`; a
  `ByAgent` council with a chat freezes to `free`. `freezeDraftMode` never overwrites a set mode.
- `TestNewFieldsLeaveAnOldCouncilsJSONAlone` still passes: an old record round-trips with no `draftmode` key.
- `runner_test.go` `TestStartStoresDraftMode`: `Start` of a council with a chat seated stores `held`, with a chat and
  `ByAgent` stores `free`, and with no chat stores `free`.

Run: `go test ./pkg/council -run '^(TestHoldsDrafts|TestFreezeDraftMode|TestNewFieldsLeaveAnOldCouncilsJSONAlone|TestStartStoresDraftMode|TestAgentSeatsHoldDrafts)$'`

### Task 2: Seat the picked chats on reply, and the mention key in Go
**Depends on:** Task 1
**Files:** `pkg/council/runner.go`, `pkg/council/runner_test.go`, `pkg/wshrpc/wshserver/wshserver_council.go`, `pkg/wshrpc/wshserver/wshserver_council_test.go`

- `Runner.Reply` gains a trailing `seats []CouncilExpert` parameter (nil for a plain reply). Update every caller: the
  21 in `runner_test.go` and `CouncilReplyCommand`.
- `CouncilReplyCommand` resolves `data.Agents` with `councilAgentSeats(ctx, data.Agents)` first. Its error (a gone,
  ambiguous or unseatable tab, listing the live ones) fails the command and nothing is posted. It already seats an id
  named twice once.
- Inside the same `Update` that posts the message, on both the Done/Stopped/Failed path and the plain path:
  1. Drop the seats whose `Agent` already sits in `c.Experts`: no error, no duplicate.
  2. If any seats are left, call `freezeDraftMode(c)` and put them in `c.Experts` after the existing seats and before
     the coordinator, which stays last.
  3. Then `appendPersonReply`.
  If the reply fails (unknown proposal or parent), the seats are not saved either: one `Update`, one error.
- Every newly seated chat is a target of this message, even when the text does not @ it. `appendPersonReply` adds
  their ids to `To` beside what `replyTargets` returns, in the council's order with no duplicates.
- `mentioned()` matches a chat seat by the mention key rule above, beside its name and id.
- No "joined at round N" guard. `replyPass` and `answersPass` reload the council. `roundsWork` reads the panel once at
  the start of round 1 (`runner.go`, the `snap` it loads), so a chat seated during round 1 sits round 1 out and takes
  part from round 2. Leave that as it is.

Acceptance (`runner_test.go`):
- `TestReplySeatsChatsOnADoneCouncil`: the follow-up round starts with the new seat in `c.Experts`, before the
  coordinator, and as a target in the reply's `To`, and the fake agent caller is asked for its turn.
- `TestReplySeatsAChatMidRun`: a chat seated during round 1 is not asked in round 1 and is asked in round 2. One seated
  on a council paused after round 1 is asked in round 2 after `Continue`. Both are in the coordinator's input.
- `TestReplySeatsNoDuplicate`: replying with a chat already seated, or with the same chat twice in `seats`, leaves
  one seat for it.
- `TestReplySeatFreezesDraftMode`: an old record with an empty mode and no chat still reads `HoldsDrafts == false`
  after a chat joins. One with a chat at start still holds.
- `TestReplyTargets` gains cases: a chat seat is reached by `@<first 8 of its tab id>`. With two chat seats whose tab
  ids share their first 8 characters, `@<first 8>` reaches neither, and `@<first 9>` (unique) reaches only its own.

Acceptance (`wshserver_council_test.go`, faking the agent roster the way the file's existing agent-seat tests do):
- `TestCouncilReplySeatsAChat`: a reply naming a live claude tab seats it and posts the message to it.
- `TestCouncilReplyRefusesAnUnknownChat`: an unknown tab id fails the command, and the council has no new reply and no
  new seat.
- `TestCouncilReplySeatsARepeatedIdOnce`: the same tab named twice sits once.
If the file has no way to fake the roster, cover these at the `Runner` level with seats built in the test, and say so
in the task report.

Run: `go test ./pkg/council -run '^(TestReplySeatsChatsOnADoneCouncil|TestReplySeatsAChatMidRun|TestReplySeatsNoDuplicate|TestReplySeatFreezesDraftMode|TestReplyTargets|TestReplyToADoneCouncilStartsAFollowUp)$'` and `go test ./pkg/wshrpc/wshserver -run '^(TestCouncilReplySeatsAChat|TestCouncilReplyRefusesAnUnknownChat|TestCouncilReplySeatsARepeatedIdOnce)$'`

### Task 3: What a joining chat reads on its first turn
**Depends on:** none
**Files:** `pkg/council/prompts.go`, `pkg/council/prompts_test.go`

The first prompt (`AgentFirstPrompt` / `agentNews` / `writeAgentTurn`) of a seat that has not spoken, in a council that
has a report (`c.Summary != nil`), replaces the replay of every idea and reply with a new section:

- The coordinator's latest report, written by `writeReport` (`prompts.go`). `writeReport` writes nothing when the
  summary has neither Directions nor Kept. For that case, write its `Answer` under the same heading, or one line
  saying the report kept no direction when there is no answer either.
- The sent messages after `Summary.At`, in order:
  - the seats' replies of earlier rounds only (`Round < round`, as `agentNews` reads them), since the seats answer a
    round at once;
  - the person's messages whoever they went to, each labelled as the person's, except the ones that are this seat's
    own questions (`agentAsks`), which come as its questions and are not repeated.
  Held or dropped drafts are left out.
- No ideas: the report already names the ones it keeps.

A council with no report keeps today's first prompt: everything sent so far. A seat that joins in round 2 or later with
no ideas of its own gets one line saying it joined after the ideas were put forward, so it answers what was said
instead of proposing. `AgentLaterPrompt` is unchanged. `seatHasNews` must still be true for a joining seat after the
report when it has a question.

Acceptance (`prompts_test.go`):
- `TestAgentFirstPromptAfterTheReport`: holds the report, every message after `Summary.At` including the person's
  follow-up to another seat, no message from before the report, no idea's argument, no same-round seat reply, and the
  seat's own question once.
- `TestAgentFirstPromptReportWithoutDirections`: a summary with only an Answer still shows it.
- `TestAgentFirstPromptBeforeAReport`: unchanged from today: every sent idea and reply.
- `TestAgentFirstPromptJoinsInRound2`: says the seat joined after the ideas.
- `TestSeatHasNewsForAJoiningSeat`: true after the report when the seat has a question.

Run: `go test ./pkg/council -run '^(TestAgentFirstPrompt.*|TestSeatHasNewsForAJoiningSeat)$'`

### Task 4: The follow-up estimate prices chats at their context
**Depends on:** Task 2
**Files:** `pkg/council/estimate.go`, `pkg/council/estimate_test.go`, `pkg/wshrpc/wshserver/wshserver_council.go`, `pkg/wshrpc/wshserver/wshserver_council_test.go`

- `EstimateFollowup(k int, agents []CouncilExpert, tools bool)`: `k` role experts at today's flat price, plus each chat
  in `agents` at its `Context`, the cost `Estimate` gives a chat's turn. `Calls` counts both, `AgentTokens` is the
  chats' share. Update its callers.
- `CouncilEstimateCommand`: with an `Id` and `Followup > 0` or `Agents` set, resolve `Agents` with
  `councilAgentSeats` (live contexts from the roster) and price with `EstimateFollowup(data.Followup, seats,
  data.Tools)`. `Followup` now counts only role-expert answerers. A chat that cannot be resolved fails the estimate
  with that error; the frontend then shows the line with no figure.

Acceptance:
- `estimate_test.go` `TestEstimateFollowupPricesChatsAtContext`: 2 role experts and one chat of 182k → 2 × 20k +
  182k tokens, 3 calls, `AgentTokens` 182k; with tools on, the role experts take the tools price and the chat keeps its
  context.
- `wshserver_council_test.go` `TestCouncilEstimateFollowupWithChats`: a follow-up estimate naming a live tab prices it
  at the roster's context; an unknown tab fails.

Run: `go test ./pkg/council -run '^TestEstimateFollowup.*$'` and `go test ./pkg/wshrpc/wshserver -run '^TestCouncilEstimateFollowupWithChats$'`

### Task 5: The picker model: chats under the seats, mention keys, the follow-up line
**Depends on:** none
**Files:** `frontend/app/view/agents/councilchatmodel.ts`, `frontend/app/view/agents/councilchatmodel.test.ts`, `frontend/app/view/agents/councilmodel.ts`, `frontend/app/view/agents/councilmodel.test.ts`

Pure functions only. `SeatableAgent` is in `councilmodel.ts`; callers build the list with `seatableAgents`
(`councilsetupmodel.ts`). Signatures Task 6 relies on:

- `chatMentionKeys(tabIds: readonly string[]): Map<string, string>`: each tab id's mention key by the rule above.
- `joinableChats(c: Council, chats: readonly SeatableAgent[]): SeatableAgent[]`: the chats no seat holds (`agent`).
- `mentionPicker(c, text, caret, chats: readonly SeatableAgent[] = [])` returns
  `{ start, seats: CouncilExpert[], chats: { chat: SeatableAgent; key: string }[] } | null`. `chats` holds the joinable
  chats whose key, name or project contains the query, keys computed over the chat seats plus the joinable chats. Null
  only when both lists are empty, and once a whole seat name, seat key or chat key plus a space follows the @.
- `insertChatMention(text, start, caret, key)`: like `insertMention`, inserting `@<key>` plus a space.
- `pickedChats(c, text, chats): SeatableAgent[]`: the joinable chats whose key is mentioned in the text (the same
  `mentions` reading as a seat). Send passes their ids as `agents`, so a mention deleted before Send drops the pick.
- `answerers(c, proposalId, parentId, text, joining: readonly SeatableAgent[] = [])`: a chat seat also matches by the
  key rule. The picked chats count as named answerers, returned after the seats as `CouncilExpert`s shaped like the
  seat wavesrv will build (`id: "agent-<tab id>"`, `name`, `agent`, `harness`, `context`). `replyReach` takes and
  passes the same `joining`.
- `followupLabel(est, experts: number, chats: number, tools)`: counts both ("1 expert and 1 chat answer", "2 experts
  answer", "1 chat answers"), then the estimate as today. Update its callers in these files.
- A chat row's context label reuses `contextLabel` (`182k`). Export it if needed.

Acceptance (vitest, extending the existing `mentionPicker and insertMention`, `replyReach` and `answerers` describes,
plus `followupLabel`):
- `@` lists the seats, then the joinable chats with their keys; a seated chat is not under chats; `@82f` filters both.
- Two chats `3e19c0d2a1…` and `3e19c0d2b7…` get keys `3e19c0d2a` and `3e19c0d2b`; a lone chat gets 8 characters.
- `insertChatMention` puts `@82faafca ` and moves the caret past it.
- `pickedChats` returns the chat while `@82faafca` is in the text and nothing once it is deleted; two picks both count.
- `answerers` and `replyReach` name a picked chat ("Answered by: …"), and reach an existing chat seat by its key.
- `followupLabel` words each mix of experts and chats.

Run: `npx vitest run frontend/app/view/agents/councilchatmodel.test.ts frontend/app/view/agents/councilmodel.test.ts`

### Task 6: The composer's Add a live chat section, Send with agents, and its CDP steps
**Depends on:** Task 1 (the `agents` field in `gotypes.d.ts`), Task 5 (the picker model it draws)
**Files:** `frontend/app/view/agents/councilchat.tsx`, `frontend/app/view/agents/councildiscussion.tsx`, `scripts/cdp/council/discussion.mjs`, `scripts/cdp/council/fixtures.mjs`, `scripts/cdp/council/fixtures.test.mjs`, `CHANGELOG.md`, `docs/open-issues.md`

- Thread the live roster to `Composer`: `councildiscussion.tsx` reads the agents roster atom it can reach (Setup reads
  `model.agentsAtom`) and the projects registry, builds `seatableAgents(roster, registry, c.project)`, and passes the
  list down through `CouncilChat`.
- The @ picker draws Seats, then a heading **Add a live chat** with one row per chat: key, title, harness, project and
  context size, styled as in the prototype board (a selected row included). Arrow keys move across both lists as one;
  Enter or Tab inserts `insertChatMention`. `data-` hooks for the scenario: `data-council-add-chat` on the section,
  `data-council-chat-row="<tab id>"` and `data-selected` on rows.
- Send passes `agents: pickedChats(...).map((a) => a.id)` (left out when empty) to `replyCouncil`. The hint's
  `answerers` / `replyReach` get the picked chats as `joining`.
- On a follow-up (`isFollowUp`), `useEstimate` gets `followup` = the role experts among the answerers and `agents` =
  the tab ids of the chat answerers, seated and picked, and the hint is `followupLabel(est, experts, chats, tools)`.
- A send error (the multi-line `councilAgentSeats` refusal) shows in the composer's error line, whole lines kept.
- Colours from `@theme` tokens only (DESIGN.md).
- `CHANGELOG.md`: one `Added` line under the top `Unreleased` section (open one if the top section is dated), written
  for the user: @ in a council's message box can add a live chat to a council that already exists.
- `docs/open-issues.md`, section "0 · Waiting on a hand check": a `- [ ]` line to add a real live chat to a Done
  council and see it answer from its own context (no scenario starts a real agent).

Fixture: do not change `ROOM_AGENTS` or `roomRoster()`'s default output (the room council's seats, `fixtures.test.mjs`
and `council-setup` rely on them). Add `JOIN_AGENTS` in `fixtures.mjs`: two unseated chats, one claude and one pi, in
different projects, with tab ids whose first 8 characters differ from each other and from `fx-room-` (for example
`3e19c0d2-…` and `82faafca-…`, as the board shows). Add an option `writeRoomRoster(h, { extra: JOIN_AGENTS })` that
appends them to the written roster. Add a `fixtures.test.mjs` case for the option: the default roster is unchanged and
the option appends both.

Acceptance: new phases in the `council-discussion` scenario (`scripts/cdp/council/discussion.mjs`), each with its own
screenshot, all with `CouncilReplyCommand` and `CouncilEstimateCommand` stubbed (`stubRpc`) so nothing spends a token
or starts an agent:
- Step "add-chat-picker" on the `room` fixture with `extra: JOIN_AGENTS`: type `@` in the channel composer, press
  ArrowDown until a chat row is selected, and screenshot. Assert the Seats rows, the **Add a live chat** section with
  both joinable rows, each showing its key, harness, project and context label, one row `data-selected`, and no row
  for a seated chat (`fx-room-witness`, `fx-room-uxaudit`).
- Step "add-chat-send": pick both chats (Enter, then `@` and pick the other), assert the hint names exactly those two
  chats as answerers and no other seat, then Send. Assert from `rpcCalls` that `agents` holds both tab ids. Re-seed the
  fixture council with the two chats added to `experts` and screenshot the seat bar showing both new seat chips.
- Step "add-chat-followup" on the `done` fixture with `extra: JOIN_AGENTS`: pick one chat and assert the line under the
  message box counts it ("… and 1 chat answer") and that the stubbed estimate call carried its tab id in `agents`.
  Screenshot.
- Step "add-chat-refused": stub `CouncilReplyCommand` to reject with a two-line `councilAgentSeats`-style error, Send,
  and assert both lines show in the composer's error line. Screenshot.

Run: `npx vitest run scripts/cdp/council/fixtures.test.mjs`, and `task verify:ui -- council-discussion` against a
running dev app (or `node scripts/cdp/final-verify.mjs council-discussion`).
