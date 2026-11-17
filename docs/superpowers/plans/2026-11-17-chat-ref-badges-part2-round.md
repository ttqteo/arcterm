# Chat ref badges, part 2: fix round

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix what the review of run 3b228cde's part 2 left: the caret jumping past a badge formed at the start of a
text node, the two copies of the conversation-archive load guard, and the `chat-ref-badges` scenario's shots that show
the seeded badges unresolved after an `@` reload, plus two formatting slips in that scenario.

**Architecture:** Part 2 landed on this branch: `$settleTypedText` / `$atomsInTypedText` in
`frontend/app/view/agents/chateditor.tsx` turn a finished token typed or pasted into the box into a badge or a file
pill; `chatrefbadge.tsx` and `refmentionstore.ts` each keep a private `loadingSessions` / `loadSessionsOnce` guard
around `loadSessionsArchive`; `scripts/cdp/scenarios.mjs` holds the `chat-ref-badges` scenario (`crbSeed`, steps 4a-4e
and 7a-7e). Spec: `docs/superpowers/specs/2026-11-17-chat-ref-badges-design.md`, "In the box" and "Part 2".

**Tech Stack:** React 19, jotai, Lexical, vitest, CDP scenarios.

### Task 1: The caret stays before a badge formed at its place, and the scenario's shots read resolved

**Depends on:** none

**Files:** `frontend/app/view/agents/chateditor.tsx`, `frontend/app/view/agents/chateditormodel.ts`,
`frontend/app/view/agents/chateditormodel.test.ts`, `scripts/cdp/scenarios.mjs`

The spec's rule: a typed token becomes a badge and "the caret goes back where it was in the text". When a finished
token starts at a text node's offset 0 and the caret sits at 0 (Delete or Backspace removes the `x` of
`xagent:7cd99627 ` with the caret before the token), `$atomsInTypedText` splits the node and `replace()`s the token's
part, and the caret lands after the new badge instead of before it (found by part 2's reviewer, by reading the code).

**Step 1:** Check the claim first (a throwaway headless test as Task 4 of part 2 did, not committed, or by reading
Lexical's `splitText` / `replace` selection handling). If the caret already stays put, say so in the report and skip
to Step 3.

**Step 2:** In `$atomsInTypedText`, after the swaps, put the caret back at its text offset: when the caret was at or
before a run's start, it sits before that run's new node (at the end of the text before it, or the paragraph offset of
the node when there is none); when it was after a run's end, it sits in the text after it, at the same distance from
the run's end; a caret inside a run cannot happen (`atomRunsIn` leaves a token the caret ends). If this needs a pure
helper (the caret's new place from the runs and the old offset), put it in `chateditormodel.ts` with a vitest case in
`chateditormodel.test.ts` for a caret at 0, between two runs, and after the last.

**Step 3: Scenario.** In `chat-ref-badges` (`scripts/cdp/scenarios.mjs`):

- Add a step after 7e, "caret before a badge formed at it": in an empty box type `xagent:<A's 8> ` with key events
  (`crbTypeKeys`), press Home, then Delete: the box holds one `[data-chat-ref]` badge, `crbBoxText` is
  `agent:<8> `, and the caret is before the badge (read the Lexical selection's place in the box text, or type `y`
  and check `crbBoxText` reads `y agent:<8> ` or `yagent:<8> `, whichever the gap rule makes, never `agent:<8> y`).
  Clear the box after. Shot `cdp-shots/chat-ref-badges-caret.png`.
- Typing `@` re-reads the runs, councils and initiatives over the seed, so the bubble behind the picker and typed
  shots (`-picker-effort`, `-picker-session`, `-typed`, `-typed-pill`) shows part 1's seeded run and council and the
  seeded finished initiative as unresolved. Before each of those shots, once the picker's load has settled, re-run
  `crbSeed(h, ctx)` and wait until the bubble's seeded run badge reads `data-ref-state="resolved"` again, so the shot
  shows what a person sees.
- Two slips from part 2: restore the space in the comment header `// --- chat-initiative: Add to an initiative from
  Chat` (it lost it: `chat-initiative:Add`), and write `const inBubble = (token) =>` (now `inBubble =(token)`). Never
  run prettier on this file.

Check with `node --check scripts/cdp/scenarios.mjs`; the run's Final runs the scenario.

**Step 4: Commit**

```bash
git commit -m "fix(chat): the caret stays before a badge formed at it; ref badges scenario re-seeds before its shots" -- frontend/app/view/agents/chateditor.tsx frontend/app/view/agents/chateditormodel.ts frontend/app/view/agents/chateditormodel.test.ts scripts/cdp/scenarios.mjs
```

(leave out a file the task did not change)

### Task 2: One guard for the conversation-archive load

**Depends on:** none

**Files:** `frontend/app/view/agents/refmentionstore.ts`, `frontend/app/view/agents/chatrefbadge.tsx`

`loadSessionsArchive` (`sessionsarchivestore.ts`) asked again while a scan runs scans once more, so each caller wraps
it in a once-guard; part 2 wrote two private copies (`chatrefbadge.tsx` and `refmentionstore.ts`, both
`loadingSessions` / `loadSessionsOnce`), and a badge and the picker together can still start two scans.

**Step 1:** Export one `loadRefSessions()` (the guard as it is in `refmentionstore.ts`) from `refmentionstore.ts`,
next to `loadRefEfforts`, and have `chatrefbadge.tsx` import it in place of its own copy (it already imports
`loadRefEfforts` from there). Delete the copy and its comment from `chatrefbadge.tsx`; keep one comment saying why the
guard exists.

**Step 2: Check.** `task check:ts`, and `npx vitest run frontend/app/view/agents/refmention.test.ts
frontend/app/view/agents/refbadge.test.ts`.

**Step 3: Commit**

```bash
git commit -m "refactor(chat): one guard for the conversation-archive load behind ref badges and the @ picker" -- frontend/app/view/agents/refmentionstore.ts frontend/app/view/agents/chatrefbadge.tsx
```
