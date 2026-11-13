# Brainstorm in Chat — fix round

**Spec:** `docs/superpowers/specs/2026-11-14-chat-brainstorm-status-design.md`

Two defects the reviews of the landed run found in the shared Chat band (`chatband.tsx`, `brainstormbandview.tsx`).
Nothing else changes: the band's DOM contract, keys and scenarios stay as landed.

### Task 1: The brainstorm body sits under its part, and `i` reads this agent's own link chip
**Depends on:** none
**Files:** `frontend/app/view/agents/brainstormbandview.tsx`, `frontend/app/view/agents/chatband.tsx`, `frontend/app/view/agents/agentheader.tsx`, `frontend/app/store/keybindings/bindings.ts`, `scripts/cdp/scenarios-chat-brainstorm-band.mjs`

Decisions:
- **The expanded brainstorm body's left edge follows the brainstorm part, not a fixed offset.** Today the body beside an
  initiative part is padded `pl-[395px]`, sized for the initiative part at its full 380px basis; the line's initiative
  part is `flex-[0_1_380px]` and shrinks in a band under ~710px wide, so between 640 and ~710px the body sits up to 65px
  right of the part it opens from. The body's columns start where the brainstorm part's content starts at every wide
  width (the same flex basis as the line, or the part's measured left; one rule, no second constant to keep in step).
  The brainstorm-only (`pl-[39px]`) and narrow (`pl-4`) bodies do not change.
- **`i` in a brainstorm-only band asks whether this agent's header carries the Link to initiative chip, not whether any
  chip is on the page.** `chatband.tsx`'s handler and the global `agent:initiative` binding both test
  `document.querySelector("[data-initiative-link]")`; in a split, another agent's chip makes `i` open the picker for an
  agent whose own header has none (an ended session, a run's worker). The chip's attribute carries its agent's id
  (`data-initiative-link={agent.id}`) and both checks look for that agent's; selectors that match the bare attribute
  (scenarios, `[data-initiative-link-open]`) keep working. One way to ask, used by both callers.

Acceptance:
- `chat-brainstorm-band` gains a step (with its shot) at a band width between 640 and 700px, wide (not
  `data-band-narrow`), with both parts present and the brainstorm part open: the left of the body's first column is
  within 2px of the left of the brainstorm part's content on the line. Steps 1 to 7, 3b and 4b still pass.
- `chat-initiative-band` still passes (its `i` steps on an unlinked agent open the picker as before).
- A unit test, or a scenario step, shows `i` with focus in a brainstorm-only band of an agent that cannot link does not
  open the picker while another agent's chip is on the page; if the check is extracted to a function, test it there.
- `task check:ts` clean; `npx vitest run frontend/app/store/keybindings` green.
