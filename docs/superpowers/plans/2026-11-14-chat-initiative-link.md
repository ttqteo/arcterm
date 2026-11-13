# Initiative in Chat: one band under the header — plan

**Spec:** `docs/superpowers/specs/2026-11-14-chat-initiative-link-design.md`
**Verify:** `node scripts/verify.mjs ./pkg/jarvis`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs chat-initiative-band initiative-popover initiative-link`
**Prototype:** D:\work\arcterm\.superpowers\design\chat-initiative-link\project

Goal: in a linked Claude agent's Chat, one band under the header replaces the header's ◇ chip and its popover; the
band can switch the agent's chunk; "the chunk this agent is on" gets one definition shared by the band, the chips and
the Terminal popover. Read the spec first; the decisions below are the ones made beyond it (autonomous run, no one to
ask), each with its reason. A task restates the ones it relies on.

## Decisions beyond the spec

1. **The one definition** (spec §7): `agentChunk(effort, tabId)` is the non-proposed, non-settled chunk whose workrefs
   hold `agent:<tabId>` (an `active` one first if legacy data has several), and nothing else. No active-chunk fallback.
2. **The `done:` chip belongs to the turn.** With Mark done carrying the agent forward, a turn that committed would
   at once offer `done:` for the chunk it was just carried to. So `initiativeChips` offers `done: <chunk>` only when the
   agent's workref on that chunk was stamped (`ChunkWorkRef.ts`) at or before the turn ended (`agent.idleSince`); a
   chunk attached after the turn ended (a switch, a carry-forward) was not that turn's work. `go on with:` is unchanged
   apart from moving onto the one definition: it shows when the agent holds only settled chunks (e.g. the agent ran
   `wsh effort advance` itself, or the carry-forward found the next chunk held by someone else).
3. **Two actives can exist.** The switch makes the chosen chunk `active` and leaves other chunks' statuses alone
   (another agent may be working its own active chunk). Because the server's `advance` finishes the *first* active
   chunk, `markChunkDone` uses `advance` only when the chunk is the first active chunk in plan order; otherwise it sets
   that chunk `done` and calls `advance` only when no chunk is active (today's rule for a non-active chunk).
4. **Carry-forward** (spec §7): after Mark done, the chunk that became active in that write (active after, not before)
   gets the agent attached, unless any workref is already on it. Pure helper decides; the store writes.
5. **The switch** (spec §3): write 1 = `detachWork` (old chunk, `agent:<tab>`) plus, when the old chunk was `active`,
   not settled and has no workref but this agent's, `setChunkStatus` old → `pending`. Write 2 = `attachWork` chosen +
   `setChunkStatus` chosen → `active` (skipped when already active). Write 2 failing runs a rollback write: `attachWork`
   old, plus `setChunkStatus` old → `active` if write 1 demoted it; the band shows write 2's error (and the rollback's,
   if that failed too). An agent with no chunk ("Pick a chunk…") does write 2 only. The ops are built by a pure
   function; the store only sends them.
6. **Who "holds" a chunk:** any workref at all (agent or run). `Work on this` is offered on a chunk whose status is
   `pending`, `active`, `blocked` or `deferred` and that has no workrefs (so never the agent's own, never a done,
   skipped or proposed one). A row held by others is tagged with the holder's roster name, `an agent` when the tab is
   not in the roster, or `a run` for a run workref.
7. **The fixed window** lists, deduplicated and in plan order: the last done chunk this agent holds (latest workref
   `ts` among its done chunks), its own chunk, the next two by `nextChunks(effort, own?.label ?? null)`, and every
   non-settled chunk another holder has. `All chunks (N)` (N = non-proposed chunks) toggles the whole plan in plan
   order, in a list that scrolls past ~240px. The cursor moves over the window rows, then the `All chunks` row, then
   the full list's rows when open.
8. **Keys in the band.** The band root is `data-owns-keys` and focusable; while focus is inside it, the dispatcher
   treats the posture as editable, so every single-key binding stands down by itself (no new global yield atom). Inside:
   `m` Mark done, `n` Add note (expands first if collapsed), `↑`/`↓` move the cursor, `Enter` opens the row's
   status/rename menu (as the popover), **`w` Work on this** on the cursor's row (the spec names no key for it; `w` is
   Work on in the Jarvis Brief), `Esc` or `i` collapse and give focus back to the message box. The global `i`
   (`agent:initiative`) toggles the band of the focused agent when a band for it is on screen
   (`[data-initiative-band="<agentId>"]`), else opens the Terminal popover, else the link picker. Opening the band by
   `i`, a click or `Pick a chunk…` focuses its root.
9. **Open is remembered per agent** in a module atom persisted to localStorage `chat.initiative.band` (the ids whose
   band is open, at most 200, oldest dropped; a storage that throws degrades to memory, warned once). A band starts
   collapsed.
10. **Narrow** below **640px** of band width (ResizeObserver on the band): no segment bar, title clipped to 150px,
    chunk label clipped, `Mark done` → `Done`. Pure `bandLabels(narrow)`.
11. **The switch line** is `initiative: switched you to chunk <n> <label> (effort:<oid>)`, `<n>` the 1-based position
    in `effort.chunks`. Queuing one replaces any earlier `initiative: switched ` line in that agent's pending queue
    (only the last switch goes). The stripper's pattern becomes `^initiative: (added|created|dismissed|switched) `.
    The waiting line reads `Goes with your next message: switched to chunk <n> <label>` with ✕, which drops only that
    line from the queue.
12. **`go on with:` click** = switch to the chip's chunk, then send the chip's text through the normal send, so the
    switched line rides in front of it. If the switch fails, nothing is sent and a toast says why.
13. **The band sits in `ChatPane`**, above the scroll container (not inside it), so it pushes the conversation down and
    never covers it. Opening/closing keeps the reading position: if the view follows the tail it still ends on the last
    message; otherwise the message at the top of the view stays at the top. It animates on `springReveal`
    (`frontend/app/element/motiontokens.ts`).
14. **DOM contract** the scenario reads (Tasks 4, 5 and 6 rely on it): band root `[data-initiative-band="<agentId>"]`
    with `data-band-open` ("" when expanded) and `data-band-narrow` ("" when narrow); `[data-band-title]`,
    `[data-band-progress]` (text `done/total`), `[data-band-segments]` (the bar, absent when narrow),
    `[data-band-on]` (the `On <n> <label>` part, or the no-chunk text), `[data-band-pick]` (Pick a chunk…),
    `[data-band-mark-done]`, `[data-band-toggle]` (chevron); rows `[data-band-row][data-chunk-label="<label>"]` with
    `data-band-row` = `done` | `mine` | `next` | `other` | `plan`, `aria-current` on the cursor's row,
    `[data-band-tag]` inside a row, `[data-band-work-on]` (Work on this button), `[data-band-all]` (All chunks (N)),
    `[data-band-menu]` / `[data-menu-item]` (status menu), `[data-band-parent]`, `[data-band-review]`,
    `[data-band-note]` (latest note), `[data-band-add-note]`, `[data-band-open-jarvis]`, `[data-band-error]`; the
    waiting line `[data-chat-switch-line]` with `[data-chat-switch-drop]` (✕); the lean header's link chip keeps
    `[data-initiative-link]`.
15. **Header**: the lean (Chat) header drops `InitiativeLink` and shows `LinkToInitiative` as a chip with an `i` keycap
    for an unlinked agent; `linkFromMenu`, its `…` menu row and `data-initiative-link-menu` go. The Terminal header is
    unchanged apart from the popover's no-chunk text.
16. **Collapsed controls.** The collapsed line keeps `Mark done` with its `m` keycap as a hint (board A): the button
    works on a click at any time, the key once the band holds focus (a click on the line, `i`). With no chunk for the
    agent there is no Mark done. `Pick a chunk…` shows only when some row offers `Work on this` (`firstWorkOn` ≥ 0); an
    initiative with nothing to pick shows `No chunk for this agent` alone.
17. **Shared popover pieces.** The popover's styling constants (`STATUS_TEXT`, `BTN`, `ROW`, `CURSOR_RING`) and its
    status menu (the `role="menu"` list of `chunkMenuItems` with the rename row) move to a new
    `initiativechunkmenu.tsx` (Task 3), exported; the popover and the band both import them. The rename input and the
    note input stay in each component.
18. **A failed switch is testable.** In DEV only, `window.__initiativeSwitchFail` (a string) makes the switch's second
    write reject with that message before it is sent; the rollback then runs for real. Same pattern as
    `window.__chatSuggestFake`.

### Task 1: An agent may hold one live chunk plus settled ones
**Depends on:** none
**Model:** sonnet
**Files:** `pkg/jarvis/effortops.go`, `pkg/jarvis/effortops_test.go`

`attachWork` validation (`pkg/jarvis/effortops.go` ~249) refuses an oref already on any other chunk. Change it to
refuse only when the oref is on another chunk that is **live**: not `done`, not `skipped` (a `proposed` chunk counts as
live: it cannot be held, but nothing attaches to one through the band). Keep the error code `EC-REF-ALREADY-ATTACHED`
for that case. Attaching to the same chunk stays idempotent. Runs (`kind: run`) follow the same rule.

Acceptance:
- `TestApplyOpsAttachWorkConflictOtherChunk` still refuses an agent on a live chunk attaching to another.
- New `TestApplyOpsAttachWorkAfterSettledChunk`: an agent whose workref is on a `done` chunk (and another on a
  `skipped` one) attaches to a pending chunk; the settled chunks keep their workrefs.
- New `TestApplyOpsAttachWorkBatchStillSeesLiveChunk`: a batch `[detachWork old, attachWork new]` is still refused
  (validation reads the pre-op state), which is why the client switch is two writes (spec §3).
- `go test ./pkg/jarvis -run 'TestApplyOpsAttachWork'` passes (on Windows with the cgo env from AGENTS.md).

### Task 2: The band's pure model, the one chunk definition, the switch line
**Depends on:** none
**Model:** sonnet
**Files:** `frontend/app/view/agents/initiativeband.ts`, `frontend/app/view/agents/initiativeband.test.ts`, `frontend/app/view/agents/initiativepopovermodel.ts`, `frontend/app/view/agents/initiativepopovermodel.test.ts`, `frontend/app/view/agents/chatsuggest.ts`, `frontend/app/view/agents/chatsuggest.test.ts`, `frontend/app/view/agents/chatinitiative.ts`, `frontend/app/view/agents/chatinitiative.test.ts`, `skills/initiatives/SKILL.md`

Pure only: no jotai, no RPC. Decisions 1, 2, 4, 5, 6, 7, 10, 11 above.

- `initiativepopovermodel.ts`: `agentChunk` drops the active-chunk fallback (decision 1); update its doc comment and
  `popoverRows` keeps working on it. Fix the tests that asserted the fallback (`agentChunk(effort, "t9")` → null).
  `chatinitiativecard.tsx:170` also reads `agentChunk` for a card's default chunk: it needs no edit, and a note card on
  an agent with no chunk of its own now starts with no chunk picked instead of the active one (intended: one
  definition).
- `chatsuggest.ts`: `initiativeChips(effort, tabId, committed, vi, turnEnded?: number)` uses `agentChunk` (import it;
  delete its own copy of the rule) and decision 2 (`done:` only when the workref `ts` ≤ `turnEnded`; with
  `turnEnded` undefined, as today). `ChipEffort`'s workrefs gain `ts?: number`. The existing caller in
  `chatpane.tsx` keeps compiling (the param is optional); Task 4 passes it.
- `chatinitiative.ts`: `switchLine(n, label, oref)`; `withSwitchLine(pending, agentId, line)` (drops earlier
  `initiative: switched ` lines of that agent, then queues); `withoutSwitchLine(pending, agentId)`;
  `pendingSwitch(lines)` → `{ n, label } | null` for the waiting line (parses the last switched line);
  `RESULT_LINE` learns `switched`.
- New `initiativeband.ts` (reuse `initiativepopovermodel.ts`: `agentChunk`, `nextChunks`, `latestNoteEntry`,
  `popoverProgress`, `popoverStatus`, `stepRow`, `chunkMenuItems`):
  - `bandRows(effort, tabId)` → `{ window: BandRow[]; all: BandRow[]; total: number }`, `BandRow = { label, n, kind:
    "done" | "mine" | "next" | "other" | "plan", status, holders: { kind: "agent" | "run"; id: string }[], workOn:
    boolean }` (decisions 6, 7);
  - `canWorkOn(chunk)` (decision 6);
  - `holderTag(holder, tabId, nameOf: (tabId) => string | undefined)` → `this agent` when the holder is
    `agent:<tabId>`, else per decision 6;
  - `firstWorkOn(rows)` → index for Pick a chunk…'s cursor, or -1 (then no Pick a chunk…, decision 16);
  - `switchPlan(effort, tabId, toLabel)` → `{ detach: EffortOp[] | null; attach: EffortOp[]; rollback: EffortOp[] |
    null; line: string }` with labels resolved through `chunkRef(planEditChunks(chunks), label)` (as the popover does)
    (decision 5, 11);
  - `carryForward(before, after, tabId)` → label to attach or null (decision 4);
  - `doneIsAdvance(effort, label)` → whether Mark done should send `advance` (decision 3);
  - `bandLabels(narrow)` → `{ markDone: "Mark done" | "Done", segments: boolean, titleMax: number }` (decision 10);
  - `NARROW_BAND_PX = 640`.
- `skills/initiatives/SKILL.md` (~119, the `initiative: …` lines paragraph): say a line `initiative: switched you to
  chunk <n> <label> (effort:<oid>)` means the person moved you to that chunk: work on it from now on; nothing to
  write.

Acceptance (`npx vitest run frontend/app/view/agents/initiativeband.test.ts frontend/app/view/agents/initiativepopovermodel.test.ts frontend/app/view/agents/chatsuggest.test.ts frontend/app/view/agents/chatinitiative.test.ts`):
- `bandRows`: board A's case (a done chunk the agent held, its own, two pending, one held by another tab) lists done,
  mine, next, next, other in plan order; a pending chunk before the agent's own is not "next" (spec: board A's chunk
  `1` is wrong); `workOn` true only per decision 6; `all` has every non-proposed chunk.
- `switchPlan`: from an active chunk no one else holds → detach + old→pending, attach + chosen→active, rollback
  re-attaches and re-activates; old chunk also held by another tab → no demotion; agent with no chunk → `detach` null;
  chosen already active → no status op; line text exact.
- `carryForward`: advance made C2 active and no one holds it → C2; held by someone → null; nothing new active → null.
- `doneIsAdvance`: first active → true; a second active → false.
- `initiativeChips`: no fallback (an agent holding nothing on an initiative with an active chunk gets no chips);
  `done:` hidden for a workref stamped after `turnEnded`.
- `withSwitchLine` twice keeps one switched line and the other result lines; `withoutSwitchLine` leaves the others;
  `stripResultLines` strips a leading switched line; `pendingSwitch` reads n and label.

### Task 3: Stores: the switch, the band's open state, Mark done carries forward
**Depends on:** Task 2 (uses `switchPlan`, `carryForward`, `doneIsAdvance`, `withSwitchLine`, `withoutSwitchLine`, `pendingSwitch`)
**Model:** sonnet
**Files:** `frontend/app/view/agents/initiativechunkmenu.tsx`, `frontend/app/view/agents/initiativebandstore.ts`, `frontend/app/view/agents/initiativebandstore.test.ts`, `frontend/app/view/agents/chatinitiativestore.ts`, `frontend/app/view/agents/chatsuggeststore.ts`, `frontend/app/view/jarvis/effortstore.ts`, `frontend/app/view/agents/chatpane.tsx`, `frontend/app/view/agents/initiativepopover.tsx`

Decisions 3, 4, 5, 9, 11, 17, 18.

- New `initiativechunkmenu.tsx` (decision 17): export `STATUS_TEXT`, `BTN`, `ROW`, `CURSOR_RING` and a
  `ChunkStatusMenu({ status, at, onHover, onChoose, dataAttr })` drawn from the popover's menu markup
  (`initiativepopover.tsx` ~331-367); the popover imports them instead of its own copies, its DOM unchanged
  (`[data-popover-menu]` stays, through `dataAttr`), so `initiative-popover` still passes.

- `effortstore.ts`: export `mutateEffortOps(oref, ops)` (the existing private `mutateEffort`, which already refreshes
  `effortDetailAtom` and the briefing).
- `chatinitiativestore.ts`: `queueSwitchLine(agentId, line)`, `dropSwitchLine(agentId)`, and
  `usePendingSwitch(agentId)` → `{ n, label } | null` (an `atomFamily` over the pending atom, as `useHandled`).
- `chatsuggeststore.ts`: `markChunkDone(oref, label, tabId)` — `advance` only when `doneIsAdvance`, else today's
  set-done-then-advance-if-none-active; then `carryForward(before, after, tabId)` and, when it names a chunk,
  `attachAgent`. Update its two callers in this task so the tree compiles: `chatpane.tsx` (`markDone`) and
  `initiativepopover.tsx` (`markDone`), passing `agent.id`.
- New `initiativebandstore.ts`:
  - `bandOpenAtom` (persisted, decision 9), `useBandOpen(agentId)`, `setBandOpen(agentId, open)`,
    `toggleBand(agentId)`;
  - `switchAgentChunk(oref, tabId, toLabel)`: reads the cached detail (loads it if missing), runs `switchPlan`, sends
    `detach` then `attach` through `mutateEffortOps`; on an `attach` failure sends `rollback` and rejects with an
    `Error` whose message is the attach error (plus `; and the old chunk could not be restored: …` if the rollback
    failed too). On success it `queueSwitchLine`s the line. Never swallows an error. DEV hook per decision 18.

Acceptance (`npx vitest run frontend/app/view/agents/initiativebandstore.test.ts`, mocking `RpcApi` the way
`frontend/app/view/jarvis/effortstore.test.ts` does):
- a switch sends two `EffortMutateCommand` calls in order with the planned ops and queues exactly one switched line;
  two switches leave one line (the last);
- a failing second call sends the rollback ops, rejects with the attach error, and queues no line; with
  `window.__initiativeSwitchFail = "x"` the second write is never sent, the rollback is, and it rejects with `x`;
- `markChunkDone` on the first active chunk sends `advance` then an `attachWork` for the newly active chunk; with that
  chunk held by another tab, no attach; on a non-first active chunk it sends `setChunkStatus done`, not `advance`;
- `toggleBand` flips one agent's flag and writes `chat.initiative.band`; a throwing localStorage still toggles.

### Task 4: The band in Chat, the waiting line, the chips
**Depends on:** Task 3 (uses `switchAgentChunk`, the band open state, `usePendingSwitch`, the new `markChunkDone`)
**Model:** sonnet
**Files:** `frontend/app/view/agents/initiativeband.tsx`, `frontend/app/view/agents/chatpane.tsx`, `frontend/app/view/agents/chatcomposer.tsx`, `CHANGELOG.md`

Decisions 8, 10, 12, 13, 14, 16. Read `DESIGN.md` and the two boards in the Prototype folder; reuse the shared pieces
(`initiativechunkmenu.tsx` from Task 3: the constants and `ChunkStatusMenu`; `SegmentBar`, `SectionLabel`, `KeyCap`,
`formatAgo`) rather than inventing new ones, and do not edit `initiativepopover.tsx` (Task 5 owns it); colors only
from `@theme` tokens.

- New `initiativeband.tsx`: `InitiativeBand({ model, agent })`, drawn by `ChatPane` for an agent with `effortId`,
  above the scroll container. Collapsed line per spec §1 (◇ + title, segment bar + `done/total`, dot + `On <n>
  <label>` or `No chunk for this agent` + `Pick a chunk…`, `Mark done (m)`, chevron). Expanded per spec §2 in two
  columns (parent link through `openTarget`/`openOrPeek`, project · status; the rows with tags, struck-through done
  row, selected background for its own; `Work on this` on hover and on the cursor; `All chunks (N)`; `N proposed ·
  Review on the rail` via `openRailSection(agent.id, "plan")`; right column latest note with age, `Add note (n)`,
  `Open in Jarvis ↗`). Status menu and rename as the popover. Errors (`[data-band-error]`) under the rows. Use
  `useInitiativeReread(agent.effortId, agent.state, false)` and `usePlanReview` as the popover does, so a card write
  or the agent's own `wsh effort` shows. Narrow per decision 10 (ResizeObserver). Gone/loading text as the popover.
- `chatpane.tsx`: render the band; pass `turnEnded` (`agent.idleSince` when idle) to `initiativeChips`; the
  `go on with:` chip click (`kind: "next"`) does `switchAgentChunk` then sends the chip's text (decision 12) — wire it
  through a new optional `onGoOn(chunk, text)` prop on `ChatComposer` / `SuggestChips`.
- `chatcomposer.tsx`: the waiting line over the message box (`usePendingSwitch`), `[data-chat-switch-line]`, ✕ →
  `dropSwitchLine`; sending a plain message takes it with the other result lines (already, via `takeResultLines`).
- `CHANGELOG.md`, top `Unreleased` section (open one if the top has a date): an `Added` line for the band and the
  switch, ending `<!-- big -->` only if the release has fewer than 5 big lines; no `<!-- try: -->`, since
  `agent:initiative` is an Agent binding, not a global one, and `whatsnew.test.ts` accepts only global ids. A
  `Changed` line: Mark done moves the agent on to the next chunk, and an agent that holds no chunk is no longer
  treated as working the initiative's active one.

Acceptance: `task check:ts` clean; the steps of the `chat-initiative-band` scenario (Task 6) that show it: "2. band
collapsed", "3. band expanded", "3b. reading position", "4. switch and the waiting line", "4b. failed switch",
"5. no chunk", "6. narrow cell", "7. chips".

### Task 5: The lean header, the `i` key, the Terminal popover
**Depends on:** Task 3 (calls `toggleBand(agentId)` from `initiativebandstore.ts`; edits `initiativepopover.tsx` after Task 3's extraction)
**Model:** sonnet
**Files:** `docs/guide/agent.md`, `frontend/app/view/agents/agentheader.tsx`, `frontend/app/store/keybindings/bindings.ts`, `frontend/app/store/keybindings/bindings.test.ts`, `frontend/app/view/agents/initiativepopover.tsx`, `docs/keyboard-shortcuts.md`

Decisions 8, 15.

- `agentheader.tsx`: in the lean header, no `InitiativeLink`; an unlinked agent's `LinkToInitiative` chip
  (`[data-initiative-link]`) with an `i` keycap (`KeyCap`); remove `linkFromMenu`, its menu row (~609) and the
  `menuAnchor` path if nothing else uses it. The Terminal header keeps the chip and popover.
- `bindings.ts` `agent:initiative`: band on screen for the focused agent → `toggleBand(agent.id)`; else linked →
  `initiativePopoverAtom`; else the picker when `[data-initiative-link]` is on screen (drop
  `[data-initiative-link-menu]`). Update the comment.
- `bindings.test.ts`: the `agent:initiative` describe block (~2940): a band on screen toggles it and leaves the popover
  closed; the picker test queries `[data-initiative-link]`.
- `initiativepopover.tsx`: the no-chunk text becomes `No chunk for this agent`; the header comment says the Chat band
  replaced it in Chat.
- `docs/keyboard-shortcuts.md` (~258): `i` toggles the band in Chat (and its keys: `m`, `n`, `w`, arrows, `Enter`,
  `Esc`/`i`), opens the popover in Terminal, and Link to initiative for an unlinked agent.
- `docs/guide/agent.md` (the Vietnamese guide: ~111 the header's `◇ <initiative>` link, the `### Link to initiative`
  section ~382, the `i` row ~492): the band in Chat with its keys and Work on this, the popover in Terminal,
  `+ Link to initiative` in the Chat header. Keep the guide's language, UI strings in English.

Acceptance: `npx vitest run frontend/app/store/keybindings/bindings.test.ts -t "agent:initiative"` passes; the
`chat-initiative-band` step "1. unlinked header" (Task 6), the updated `initiative-link` scenario and the new
`initiative-popover` step "no chunk for this agent" show it.

### Task 6: CDP scenarios
**Depends on:** Task 1 (the switch and the carry-forward attach an agent that holds a done chunk, which the old `attachWork` refuses), Task 4 (asserts the band, waiting line and chips it draws, and its DEV switch-failure path), Task 5 (asserts the lean header's link chip, the `i` key and the popover's no-chunk text)
**Model:** sonnet
**Files:** `scripts/cdp/scenarios-chat-initiative-band.mjs`, `scripts/cdp/scenarios.mjs`, `scripts/cdp/scenarios-chat-redesign.mjs`

A new `chat-initiative-band` scenario in its own file, registered in `scripts/cdp/scenarios.mjs` as the other
`scenarios-*.mjs` files are. Model it on `scripts/cdp/scenarios-chat-redesign.mjs` (one fixture Claude agent over a
real tab with a fixture roster row and transcript, through `agent-page-fixtures.mjs`; the kit it takes from
`scenarios.mjs`), with real initiatives made by `h.rpc("effortcreate")` / `effortmutate` and removed in teardown. Real
CDP key and mouse events (the band's keys need focus). No real agent is launched. Read the DOM contract (plan
decision 14) and the components Tasks 4 and 5 wrote. Each step takes a screenshot:

1. unlinked header: no band; the Chat header shows `[data-initiative-link]` with its `i` keycap and no
   `[data-initiative-link-menu]`; `i` opens the picker.
2. band collapsed: title, segments, `done/total`, `On <n> <label>`, Mark done; no `[data-initiative-link-open]` in the
   Chat header.
3. band expanded (click and `i`): the rows of board A (done struck, `this agent`, two next, another agent's tagged with
   its roster name), `All chunks (N)` opens the full list, latest note, Add note, Open in Jarvis; the band's bottom is
   at or above the conversation's top (pushes, never covers); `Esc` collapses; open survives picking another agent
   and back.
3b. reading position: with the conversation scrolled to the middle, the top visible message keeps its offset from the
   scroll container's top (within 4px) across open and close; scrolled to the tail, it still ends on the last message.
4. switch and the waiting line: `Work on this` on a free chunk → the store shows the chosen chunk `active` with the
   agent's workref and the old one `pending` without it; the band reads the new chunk; the waiting line shows; ✕ drops
   it; switch again (`w` on the cursor's row): `localStorage["chat.initiative.pending"]` holds exactly one
   `initiative: switched` line for the agent; send a message: that key loses the line, and the person's bubble
   (`[data-chat-pending]` / `[data-chat-you]`) shows the text without it.
4b. failed switch: with `window.__initiativeSwitchFail` set, `Work on this` leaves the agent on its old chunk (store
   read), the band shows `[data-band-error]` with the message, and no waiting line appears; clear the hook after.
5. no chunk: `No chunk for this agent` + `Pick a chunk…`, which expands with the cursor on the first `Work on this`;
   no Mark done. On an initiative whose chunks all have holders, no `Pick a chunk…`.
6. narrow cell: the band under 640px (a split of two or a narrowed window) has `data-band-narrow`, no segments,
   `Done`.
7. chips (moved here from `chat-redesign` step 19, which this task deletes): a committed turn on a held chunk offers
   `done:`; its click marks it done and carries the agent to the next chunk (band shows it; no `done:` chip for it);
   an agent holding only done chunks is offered `go on with:`, whose click switches and sends with the switched line,
   the waiting line never showing.

Also in `scripts/cdp/scenarios.mjs`: `initiative-popover` sets its agent's chat mode to Terminal with
`window.__arcChatMode.set(tabId, "terminal")` in arrange (localStorage `agent.chatmode` is read once at boot,
`chatmodestore.ts`) and back to `"chat"` in teardown, as `scenarios.mjs` ~33198 / ~34388 do, so it still covers the
Terminal popover; it gains a last step "no chunk for this agent": detach the agent (`effortmutate` `detachWork`),
reopen the popover with `i`, read `No chunk for this agent` and screenshot it; `initiative-link` reads the Chat header's `[data-initiative-link]` chip instead of the
`…` menu row (`LINK_MENU`), and after linking checks the band (`[data-initiative-band]` title) instead of
`[data-initiative-link-open]`.

Acceptance: `node --check` on the three files; the Final line runs `chat-initiative-band`, `initiative-popover` and
`initiative-link`.
