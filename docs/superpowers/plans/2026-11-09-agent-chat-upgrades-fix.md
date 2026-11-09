# Agent chat view, round 3: fix round — Implementation Plan

**Goal:** Fix what the round-3 run left behind: a stopped subagent's unresolved tool spins forever, the second-choice
comment misstates Deny, two scenario shots miss what they assert, the hovered Copy button was never looked at, and six
files the run touched fail Prettier.

**Spec:** `docs/superpowers/specs/2026-11-09-agent-gui-view-design.md`, "Round 3". The run's plan is
`docs/superpowers/plans/2026-11-09-agent-chat-upgrades.md`; its Global Constraints apply here too.

## Global Constraints

- Pure logic in `foo.ts` with `foo.test.ts` beside it, a thin `.tsx` over it; no jsdom render tests.
- Colours only from the `@theme` tokens in `frontend/tailwindsetup.css`; spacing per `DESIGN.md`.
- Never commit `cmd/wsh/cmd/pi-tools-extension.ts` (every dev build rewrites it from `pi/`); restore it before each commit.
- Keep every existing data hook and every existing `agent-chat` step passing.

---

### Task 1: A stopped subagent's tool stops spinning; the second-choice comment

**Depends on:** none
**Files:** `frontend/app/view/agents/session-models/sessionviewmodel.ts`, `frontend/app/view/agents/session-models/sessionviewmodel.test.ts`, `frontend/app/view/agents/subagentinterior.tsx`, `pkg/wshrpc/wshrpctypes_agentperm.go`, `scripts/cdp/scenarios.mjs`

`subagentinterior.tsx` draws `<ChatConversation … active />` and passes no `working`, so `toolsLive` in
`chatconversation.tsx` is always true. A tool the subagent left with no result then shows the spinner and a ticking time
forever, after the subagent has stopped (`inFlight` in `compacttimeline.ts` is `live && outcome == null`).

- [ ] Add a pure `subagentWorking(subs: SubagentVM[] | undefined, agentId: string): boolean` to `sessionviewmodel.ts`.
  It is true only when the entry whose `id` is `agentId` has `state === "working"`, and false for any other state, a
  missing entry or a missing list. Test the four cases in `sessionviewmodel.test.ts`.
- [ ] In `SubagentInterior`, read `useAtomValue(subagentsByIdAtom)[sub.parentId]` (`subagentsstore.ts`; the tree and
  the rail set `focusSubagentAtom.agentId` from that list's `id`). Pass `working={subagentWorking(…)}` beside `active`.
  `active` stays as it is: it opens the last stretch of work.
- [ ] In `pkg/wshrpc/wshrpctypes_agentperm.go`, the `Choice` comment says "a Deny ignores it", but the server rejects
  an out-of-range Choice on a Deny too (Task 1's accepted rule). Reword it: any value but 0, 1 or 2 is an error, Allow
  or Deny, and a Deny types no option. The comment only; no generated file changes, since `gotypes.d.ts` carries no
  field comments.
- [ ] `agent-chat` step 16 (the subagent interior, around `cdp-shots/agent-chat-16-subagent.png`): give the subagent
  fixture's transcript a last `tool_use` with no `tool_result`. Assert that it draws `data-tool-settled` and no
  `data-tool-running` while `subagentsByIdAtom` has no entry for the subagent, or has one that is not `working`. Then
  set the entry to `state: "working"` and assert `data-tool-running`. Keep the step's current assertions, and put
  `subagentsByIdAtom` back in teardown.
- [ ] Run `npx vitest run frontend/app/view/agents/session-models/sessionviewmodel.test.ts`, the Check, and
  `node scripts/cdp/final-verify.mjs agent-chat`. Report every agent-chat step's result.

**Acceptance:** `agent-chat` step 16 shows the settled and the running subagent tool.

### Task 2: Shots that show what they assert, the hovered Copy, Prettier on the run's files

**Depends on:** Task 1
**Files:** `scripts/cdp/scenarios.mjs`, `frontend/app/view/agents/chatconversation.tsx`, `frontend/app/view/agents/chatcomposer.tsx`, `frontend/app/view/agents/chatmodel.test.ts`, `frontend/app/view/agents/chatpending.ts`, `frontend/app/view/agents/chatpending.test.ts`, `frontend/app/view/agents/compacttimeline.ts`

- [ ] `agent-chat` steps 25 and 26 (`cdp-shots/agent-chat-25-second-choice.png`,
  `cdp-shots/agent-chat-26-tool-running.png`): the shots are not scrolled to the tail. The permission card's third
  button and the running row's spinner are asserted in the DOM but don't appear in the picture. Scroll the chat to its
  tail, or scroll the asserted element into view, before each shot. Open both PNGs and confirm that the card's three
  buttons and the spinner row are in them.
- [ ] Open `cdp-shots/agent-chat-26-copy.png` (the bubble forced to `:hover`). `BubbleCopy` in `chatconversation.tsx`
  sits `absolute top-full -mt-1` under the bubble. If the button touches or covers the next item, move it so that it
  sits in the gap below its own bubble without touching the next item. Add only spacing, and keep the hover behaviour,
  `data-chat-copy` and the bubble's layout. If it already clears the next item, change nothing and say so. Either way,
  name in the report what the shot shows.
- [ ] Run `npx prettier --write` on exactly these six files, which were Prettier-clean (or new) before the run and fail
  `npx prettier --check` now: `chatcomposer.tsx`, `chatconversation.tsx`, `chatmodel.test.ts`, `chatpending.ts`,
  `chatpending.test.ts`, `compacttimeline.ts` (all under `frontend/app/view/agents/`). Never run it on
  `scripts/*.mjs` or on any other file: `chatpane.tsx`, `narrationtimeline.tsx`, `transcriptprojection.ts` and
  `compacttimeline.test.ts` already failed it on the base. Commit the formatting on its own, with no other change.
- [ ] Run `npx vitest run frontend/app/view/agents/`, the Check, and `node scripts/cdp/final-verify.mjs agent-chat`.
  Report every agent-chat step's result.

**Acceptance:** `agent-chat` steps 25 and 26 show the third button, the spinner and the hovered Copy in their shots.
