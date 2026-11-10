# Agent chat document view: round 1 fixes

Two defects the run's final verifier and Task 4's report found in the feature that landed. Spec and boards: the
main plan, `docs/superpowers/plans/2026-11-10-agent-chat-document-view.md`.

### Task 1: The mode menu's foot line and Alt+C on a sleeping agent tell the truth

**Depends on:** none

**Files:** `frontend/app/view/agents/chatfooter.tsx`, `frontend/app/store/keybindings/bindings.ts`, the model that
builds `cellViewOptions` / `nextCellView` (find it from `bindings.ts`) and its test, `scripts/cdp/scenarios.mjs`
(the `agent-chat` scenario only), `docs/keyboard-shortcuts.md` if a line there names what Alt+C walks.

**1. The foot line.** The mode chip's menu ends with `Shift+Tab in the box cycles them too`
(`chatfooter.tsx:315`). That is false: the chat box does not forward Shift+Tab to the terminal, and it must keep
Shift+Tab as the browser's move-focus-back key. Replace the line with one that is true, e.g.
`Shift+Tab in the terminal cycles them too`, in the same `MENU_FOOT` style. Do not forward Shift+Tab from the box.
If a scenario step (step 29) reads the foot line, update its expected text.

**2. Alt+C on a sleeping Claude agent.** While a Claude agent sleeps, the header's view control disables both Chat
and Terminal and leaves a canvas, review or brainstorm option usable (Task 4, `agentheader.tsx` ~420, `chatAsleep`).
The `agent:view-cycle` binding (`bindings.ts`, `chatAgent()` returns only an awake agent) leaves Chat out but still
walks Terminal, so Alt+C can land on the option the header shows disabled. Make the key walk the same options the
header enables: for a sleeping chat-capable agent, neither Chat nor Terminal; with one option or none left the key
passes, as it does today. Every other agent (awake, not Claude, a plain terminal) keeps today's walk exactly. Put the
rule in the pure model with a unit test beside it (asleep chat-capable with a canvas and a review: walks canvas and
review only; asleep with nothing else open: no options), not in the binding's body. `agent:chat-toggle`
(Mod+Shift+K) already passes for a sleeping agent: leave it.

**Acceptance:** the focused vitest files pass; `agent-chat` step 29 reads the new foot line; add a check to
`agent-chat` step 14 (asleep) that Alt+C pressed on the sleeping agent leaves the header's selected option where it
was and never selects Terminal, and record it. Run `node scripts/cdp/final-verify.mjs agent-chat agent-sleep` once
and put its PASS table in your report.
