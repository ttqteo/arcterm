# Agent chat view, round 2: input that still goes to the hidden terminal

**Goal:** While a Claude agent's cell shows Chat, nothing that hands the keyboard to "the agent" picks the xterm under
the chat layer: an Alt-drop mention goes into the chat box, and focus coming back from a drop, the float note or the
translate panel lands in the chat box.

**Architecture:** The rule "the chat box while the cell shows Chat, else the xterm" already exists as `cellInputOf` in
`agentsurface.tsx:129` (Task 8). It moves to one small module and every place that hand-picks
`[data-agent-terminal=…] .xterm-helper-textarea` uses it, so the rule has one home. The Alt-drop mention, which today
pastes `@name ` into the PTY (`pasteIntoTerm`), inserts it into the chat box instead when the cell shows Chat, through
the composer's own text state.

**Tech Stack:** React 19 + jotai, vitest, CDP scenarios.

**Spec:** `docs/superpowers/specs/2026-11-09-agent-gui-view-design.md` ("Focus": `focusTerminalOf` sends focus to the
chat textarea while a cell shows Chat). This round extends that rule to the remaining hand-offs; it changes no
behaviour of a cell showing Terminal. The run keeps its Verify, Check and Final; Final already runs `agent-chat` and
`agent-grid`, where this round's steps go.

Conventions: as the first round's plan (`docs/superpowers/plans/2026-11-09-agent-gui-view.md`): pure logic in `foo.ts`
with `foo.test.ts`, thin views, `@theme` tokens only, never hand-edit generated files. Never commit
`cmd/wsh/cmd/pi-tools-extension.ts`: every dev build rewrites it from `pi/`; restore it before each commit.

### Task 1: One input rule for a cell, used by every hand-off; the Alt-drop mention into the chat box

**Depends on:** none
**Files:** `frontend/app/view/agents/cellinput.ts`, `frontend/app/view/agents/agentsurface.tsx`, `frontend/app/view/agents/griddropoverlay.tsx`, `frontend/app/cockpit/float-note.tsx`, `frontend/app/view/agents/translatepanel.tsx`, `frontend/app/view/agents/chatcomposer.tsx`, `frontend/app/view/agents/chatinsert.ts`, `frontend/app/view/agents/chatinsert.test.ts`, `pkg/wshrpc/wshrpctypes_agentperm.go`, `scripts/cdp/scenarios.mjs`, `docs/hand-checks.md`

What changes, file by file (the pure insert helper goes in `chatinsert.ts`, tested in `chatinsert.test.ts`):
- Create: `frontend/app/view/agents/cellinput.ts` — `cellInputOf(root: ParentNode | null | undefined, id: string)`,
  moved verbatim from `agentsurface.tsx` with its comment (the chat box's textarea when
  `[data-agent-chat="<id>"] [data-agent-chat-composer] textarea` exists, visible or null; else the visible xterm helper
  textarea; else null).
- Modify: `frontend/app/view/agents/agentsurface.tsx` — import it, delete the local copy. No other change.
- Modify: `frontend/app/view/agents/griddropoverlay.tsx` — `focusCellSoon` uses `cellInputOf(document, id)`. The Alt
  drop: when the target cell shows Chat (`getChatMode`/the DOM rule, whichever the existing code already reads for that
  cell; the DOM rule matches what is on screen), insert `mentionDropText(dropped)` at the chat box's caret and focus the
  box; nothing is typed into the PTY. When it shows Terminal, today's `pasteIntoTerm` + `focusTerm` path is unchanged.
- Modify: `frontend/app/cockpit/float-note.tsx:55` and `frontend/app/view/agents/translatepanel.tsx:502` — the
  restore-focus-on-close uses `cellInputOf(document, focusIdRef.current)`.
- Modify: `frontend/app/view/agents/chatcomposer.tsx` (and the store file it already uses, if the insert needs one) —
  a way for another component to insert text at the caret of one agent's chat box that goes through the composer's
  text state (`setText` of `useAgentSend`), not by writing the DOM `value`, which React would overwrite. Keep it the
  smallest thing that works (for example a per-agent "insert request" atom the composer consumes once); the pure helper
  `insertAt(text, selStart, selEnd, insert) -> {text, caret}` lives in `chatinsert.ts` with tests in
  `chatinsert.test.ts` (the atom, if any, may sit there too).
- Modify: `pkg/wshrpc/wshrpctypes_agentperm.go:18-19` — the doc comment: Answer refuses a request that is not the head
  with `agentperm.ErrNotPending`, and Allow on a non-answerable head with its own error ("this prompt is answered in
  the terminal"), as Task 2 built it. Comment only. Run `task generate` and check it rewrites nothing (the generated
  files do not carry this comment); if it does rewrite a file, commit it and name it in the report.
- Modify: `scripts/cdp/scenarios.mjs` — `agent-chat`, new steps after 16:
  - **17:** with a Claude agent's cell showing Chat in a two-cell split, an Alt-drop of the other agent's row onto it
    (a synthesized `dragstart`/`dragover`/`drop` with a `DataTransfer` carrying the agent drag MIME and `altKey: true`)
    leaves `@<name> ` in that cell's chat textarea with focus in it, and records no `controllerinput` to its block.
    Screenshot.
  - **18:** flip that cell to Terminal (Mod+Shift+K) and repeat the Alt-drop: the mention goes to the PTY as before
    (the mock records the paste or `pasteIntoTerm` returns true), and the chat box is untouched. Flip back to Chat in
    teardown.
  - **19:** with the cell showing Chat, open and close the float note (its existing binding): focus returns to the
    chat textarea, not the xterm helper textarea.
- Modify: `docs/hand-checks.md` — fold "Alt-drop a mention onto a chat cell" into the existing
  "(arcterm) Chat over a live Claude agent" line; no new line.
- No test for `cellinput.ts`: it reads the DOM and the repo has no jsdom; steps 17–19 cover it.

**Acceptance:**
- `npx vitest run frontend/app/view/agents/chatinsert.test.ts` passes; `task check:ts` exits 0.
- `agent-chat` steps 17–19 pass with screenshots, and its steps 1–16 still pass; `agent-grid` still passes.
- `rg "xterm-helper-textarea" frontend` lists only `cellinput.ts`, `xterm.css` and code that reads the xterm on
  purpose (none other is expected; name any in the report).
- No change to any cell showing Terminal.

**Out of scope (left as open issues, not round work):** `doc-review-mode` and `agent-rail-tabs` fail on the base
(steps 11–15 and 2–8); `cmd/wsh/cmd/pi-tools-extension.ts` lags `pi/`; a store test harness for `permissionstore.ts`.
