# Chat ref badges, round 1: the box badge's tooltip, and checks for Ctrl-click and hover

**Goal:** close the open issues the chat ref badges run left that a worker can fix: a badge in the message box says
"(click to open)" though a click there selects it, and nothing exercises a bubble badge's Ctrl-click peek or its
hover lift.

Spec: `docs/superpowers/specs/2026-11-17-chat-ref-badges-design.md`. The run's code: `frontend/app/view/agents/refbadge.ts`
(`refTitle`), `chatrefbadge.tsx` (`RefBadgeFace`, `RefBadge`), `chateditorrefpill.tsx` (`RefMentionNode`), and the
`chat-ref-badges` scenario in `scripts/cdp/scenarios.mjs` (steps 1 to 7).

**Verify:** `node scripts/verify.mjs`

**Check:** `task check:ts`

**Final:** `node scripts/cdp/final-verify.mjs chat-ref-badges`

---

### Task 1: A box badge's tooltip does not offer to open it

**Depends on:** none

**Files:** `frontend/app/view/agents/refbadge.ts`, `frontend/app/view/agents/refbadge.test.ts`,
`frontend/app/view/agents/chatrefbadge.tsx`, `frontend/app/view/agents/chateditorrefpill.tsx`,
`docs/superpowers/specs/2026-11-17-chat-ref-badges-design.md`, `scripts/cdp/scenarios.mjs`

In the box a click on a badge selects it (`chateditorrefpill.tsx`), and only the bubble's badge opens its target, yet
both titles end "(click to open)" (`refTitle`). Give `refTitle` a second argument, `{ opens: boolean }`, default
`true`; with `opens: false` a resolved title ends after the state (`api-tests · agent 3fa1c2e0 · asking`), and an
unresolved title (the reason) is the same either way. `RefBadgeFace` takes an `opens` prop (default `true`) and passes
it; `RefMentionNode`'s decorate passes `opens={false}`. `RefBadge` (the bubble) keeps the default. Add the cases to
`refbadge.test.ts` (a resolved agent and a run with `opens: false`, an unresolved one unchanged). In the spec's
**Look** bullet, say the tooltip ends "(click to open)" in the bubble only.

In the `chat-ref-badges` scenario, step 6 also reads the box badge's `title` (`crbReadBadge` already reads the badge;
add the title if it lacks it) and requires that it starts with `CRB_NAME_B` and does not contain "click to open";
the step's text says so.

**Acceptance:** `npx vitest run frontend/app/view/agents/refbadge.test.ts` passes, and the `chat-ref-badges`
scenario's step 6 passes with the box badge's title free of "click to open".

### Task 2: Scenario steps for a bubble badge's Ctrl-click peek and its hover

**Depends on:** Task 1 (uses step 6's `crbReadBadge` title change; both edit the same scenario)

**Files:** `scripts/cdp/scenarios.mjs`

Add two steps to the `chat-ref-badges` scenario, after step 7, on the bubble's badges (A is the focused agent):

- **8.** Ctrl-click (the platform's peek modifier, `PEEK_BIT` / `PEEK_KEY` as `peek-ctrl-click` uses them, with real
  `Input.dispatchMouseEvent` presses at the badge's centre) on B's agent badge in A's bubble opens the avatar popup's
  peek of B (`[data-pet-peek-item]`, waited until its status is ready), and A stays the focused agent. Escape closes
  the popup, and the step checks it is gone, so teardown starts clean. Follow `peek-ctrl-click` for the gesture and
  the popup checks.
- **9.** Moving the mouse over the run badge's `role="button"` wrapper (`Input.dispatchMouseEvent` `mouseMoved`) makes
  its computed `filter` `brightness(1.25)` (the `hover:brightness-125` class), and moving the mouse away returns it to
  `none`. Wait past the `transition-[filter]` before reading.

Each step records its readings as detail, as steps 1 to 7 do. No step exists only to take a shot.

**Acceptance:** the `chat-ref-badges` scenario's steps 8 and 9 pass under Final, beside steps 1 to 7.
