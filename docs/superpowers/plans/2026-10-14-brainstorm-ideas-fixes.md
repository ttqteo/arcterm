# Brainstorm ideas: fix round

**Spec:** `docs/superpowers/specs/2026-10-14-brainstorm-ideas-design.md` (sections 5 and 6)

**Prototype:** D:\work\arcterm\.superpowers\design\brainstorm-ideas\project

This round fixes two cosmetic gaps that the final verifier found in the merged result. It also covers one path that only unit tests reach. Everything else from the run stays as it landed.

### Task 1: Ideas polish and the empty-session shortcut step

**Depends on:** none

**Files:** `frontend/app/view/agents/ideasmodel.ts`, `frontend/app/view/agents/ideasmodel.test.ts`, `frontend/app/view/agents/ideassection.tsx`, `scripts/cdp/scenarios.mjs`

1. **Kind choice reads "Idea".** The inline edit's three-way kind choice (`ideassection.tsx`, the `role="radiogroup"` `aria-label="Kind"`) labels its middle option `Ideas`, because it reuses `IDEA_GROUPS[].label`. `Ideas-EditMerge.dc.html` has `Decided · Idea · Open`.
   - Give the choice its own singular labels, for example a `choiceLabel` on each `IDEA_GROUPS` entry or a small `kindChoiceLabel(kind)` in `ideasmodel.ts`.
   - Leave the group headings as they are: Decided / Ideas / Open.
   - Add a test in `ideasmodel.test.ts`.
2. **No horizontal scrollbar in the ended view.** When `EndedSessionIdeas` is open (the `max-h-[40vh] max-w-[560px] overflow-y-auto` wrapper), it shows a thin horizontal scrollbar under the **Add an idea** box.
   - Find what overflows sideways: likely the input's width, a ring or a negative margin.
   - Fix it so the content fits. Add `overflow-x-hidden` only if that does not clip the focus ring.
   - The rail's own Ideas section must look the same as before.
3. **Scenario step for a session with no ideas.** In the `ideas-rail` scenario, add steps after the current last step (21) to cover the shortcut with nothing selected on an agent whose session has no ideas yet. The scenario currently tests this only with `planAgentRail` unit tests (`ideasRequested`).
   - The steps should show that the strip still has no Ideas count, that the Ideas section opens with no count and its **Add an idea** input focused, and that adding one line makes the count `1` appear.
   - Use a second fixture session with no ideas file. Its transcript basename must be distinct, and it needs its own roster blockId and real shell, set up like the existing fixture agent.
   - Tear down whatever the steps add. Take a screenshot of the opened empty section.
   - Also add a step that opens the ended view's Ideas fold (if no step does yet) and screenshots it, so fix 2 is seen.
   - Run `node scripts/cdp/final-verify.mjs ideas-rail` and report each step's result.
