# Float Note and Translate: Review Fixes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the three defects the reviews of the Float Note and Translate run left open: a read that can replace an edit typed while it waits, three colors that differ from the approved canvas, and a scenario teardown that can delete a `tools.json` entry it never touched.

**Architecture:** Small edits to what the run landed (plan `docs/superpowers/plans/2026-10-17-float-note-translate.md`). No new files and no new behavior.

**Tech Stack:** TypeScript, React 19 + jotai + Tailwind 4, vitest, CDP scenario harness.

**Spec:** The run's plan above (its Design section) and the canvas on its Prototype line.

**Prototype:** .superpowers/design/float-note-translate/project/Main.dc.html

### Task 1: loadScratch takes the edit counter before it waits

**Depends on:** none
**Files:** `frontend/app/view/agents/floatnotestore.ts`, `frontend/app/view/agents/floatnotestore.test.ts`

`loadScratch` (`floatnotestore.ts:84`) awaits the write in flight and only then reads `editSeq`. FloatNote calls it on mount while the editor is already shown, so an edit typed during that wait counts as made before the read. If the edit's debounced save has started by the time the read returns, `pending` is null, the check passes, and the read replaces the typed text with the older disk text. The next edit then saves without the lost text.

- [ ] **Step 1: Write the failing test.** In `describe("loadScratch", …)` add `it("does not overwrite an edit made while it waited for a write", …)`, using the fake timers the file already uses:
  - Make `write` return a held promise the first time and resolve at once after that. Make `read` resolve `"old"`.
  - `editScratch("a")`, then `closeFloatNote()`, so a write is in flight.
  - `const loading = loadScratch()`, then `editScratch("typed")`, then `await vi.advanceTimersByTimeAsync(SCRATCH_SAVE_MS)`, so the edit's save has started (`pending` is null).
  - Release the first write, `await loading`, and expect `scratchBodyAtom` to be `"typed"`.
- [ ] **Step 2: Run it and see it fail:** `npx vitest run frontend/app/view/agents/floatnotestore.test.ts -t "while it waited"`. Expect the body to be `"old"`.
- [ ] **Step 3: Fix it.** Take `const seq = editSeq;` before `await writing;`, and say why in the comment above it: an edit typed while the read waits for the write must also keep its text.
- [ ] **Step 4: Run the whole file:** `npx vitest run frontend/app/view/agents/floatnotestore.test.ts`. Every test passes, the old ones included.
- [ ] **Step 5: Commit.** `fix(float): an edit typed while the note waits for a save is not replaced by the read`.

### Task 2: The note's placeholder, error line and Edit | Preview switch take the canvas's colors

**Depends on:** none
**Files:** `frontend/app/cockpit/float-note.tsx`, `frontend/app/cockpit/float-bar.tsx`

The canvas (`Main.dc.html`) draws three things in other tokens than the code:

| What | Canvas | Code now | Change to |
|---|---|---|---|
| The editor's placeholder (`float-note.tsx:98`) | `#a3a198`, `--color-muted` | `placeholder:text-secondary` | `placeholder:text-muted` |
| The save error line's text (`float-note.tsx:105`) | `#f0a9a4`, `--color-error-soft` | `text-error` on the row | `text-error-soft` on the row |
| The save error line's icon (`float-note.tsx:107`) | stroke `#ff6b80`, `--color-error` | inherits the row's color | `text-error` on the `CircleAlert` |
| The unpressed half of Edit \| Preview (`float-bar.tsx:124`) | `#a3a198`, `--color-muted` | `text-secondary` | `text-muted`, keeping `hover:text-primary` |

Use the tokens, never the hex values (AGENTS.md, Frontend conventions). Change nothing else.

- [ ] **Step 1: Make the four class changes in the table.**
- [ ] **Step 2: Typecheck:** `NODE_OPTIONS=--max-old-space-size=4096 task check:ts` (about 2 minutes; give it a 5-minute timeout). It exits 0.
- [ ] **Step 3: See it.** The `float-note` scenario's shots show each change: `cdp-shots/float-note-empty.png` (the placeholder), `float-note-edit.png` and `float-note-preview.png` (the unpressed half of the switch), and `float-note-error.png` (the error line). The round's Final runs this scenario. If you can run it yourself (`task dev:browser`, then `node --experimental-websocket scripts/cdp/verify.mjs float-note`), compare those four shots with the `NoteEmpty`, `Main`, `NotePreview` and `NoteError` boards; otherwise say in the report that the Final's shots are the check.
- [ ] **Step 4: Commit.** `fix(float): the note's placeholder, error line and Edit | Preview switch match the canvas's colors`.

### Task 3: The float-note teardown restores the trans tool only after arrange read it

**Depends on:** none
**Files:** `scripts/cdp/scenarios.mjs`

The `float-note` scenario's arrange sets `ctx.workspaceId` first and reads `ctx.prevTrans` (`getfullconfig` → `tools.trans`) several awaits later. Teardown restores the trans tool whenever `ctx.workspaceId` is set: when `ctx.prevTrans` is undefined, it sends `toolssetuser {id: "trans"}`, which deletes the user's `trans` entry. So an arrange that throws between those two lines (in `openRailTerminal` or `notescratchread`) deletes a `tools.json` entry that the scenario never changed.

- [ ] **Step 1: Fix it.** In teardown's "restore the trans tool" step, run the step only when arrange read the value, i.e. when `ctx.prevTrans !== undefined` (arrange stores `null` when there was no entry, and that case must still remove the scenario's entry). Leave the "close the terminals the scenario made" step guarded by `ctx.workspaceId` as it is. Add a short comment that matches the file's style.
- [ ] **Step 2: Check the file parses:** `node --check scripts/cdp/scenarios.mjs`. Don't run prettier on it (AGENTS.md: it reindents `scripts/*.mjs`).
- [ ] **Step 3: Commit.** `fix(cdp): float-note's teardown leaves the trans tool alone when arrange never read it`.
