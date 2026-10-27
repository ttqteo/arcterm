# Project Overview Now and History: fix round 1

**Goal:** Fix the one defect the final stage found: in the real app, Finished rows and a run row's lead show no age,
and Finished is not sorted newest first. The Overview reads `AgentVM.stateSince`, which `agentVMFromInput`
(`frontend/app/view/agents/agentsviewmodel.ts:561`) sets only for a working or asking agent. An idle agent carries
`idleSince` instead. Every Finished row is idle, and a run's lead is usually idle while its workers work.

**Spec:** `docs/superpowers/specs/2026-10-27-project-overview-history-design.md` ("the age" on each Finished row; "the
age of its lead's state" on a run row).

---

### Task 1: Ages and order from the field each state populates

**Depends on:** none
**Files:** `frontend/app/view/agents/projectnow.tsx`, `frontend/app/view/agents/projectoverviewmodel.ts`, `frontend/app/view/agents/projectoverviewmodel.test.ts`, `scripts/cdp/scenarios.mjs`

**Step 1: Write the failing test** — in `projectoverviewmodel.test.ts`, inside `describe("finishedRows", …)`, add a
case with two unread idle agents of the project that carry only `idleSince` (no `stateSince`), as `agentVMFromInput`
builds them: the older one first in the input. Expect `finishedRows` to return the newer one first. Run
`npx vitest run frontend/app/view/agents/projectoverviewmodel.test.ts` and see it fail.

**Step 2: Sort Finished by when the agent went idle** — in `finishedRows` (`projectoverviewmodel.ts`), sort by
`a.idleSince ?? a.stateSince ?? 0`, newest first. Run the test file again and see it pass.

**Step 3: The age the tree shows** — in `NowColumn` (`projectnow.tsx`), replace `since` so it reads the populated field
the way the Agent tree does: `displayAgeMs(a, now)` (`agentsviewmodel.ts:419`), formatted with `formatAge`, and `""`
when `displayAgeMs` returns `undefined` (never "just now" for a missing age). It serves every row that calls `since`:
asking, running, a run row's lead, and Finished.

**Step 4: Make the scenario check the real field** — in `scripts/cdp/scenarios.mjs`, step 12 of
`project-overview-history`: remove `stateSince` from the idle `ovh-done` fixture agent, so it carries only
`idleSince` like a real idle VM. Add to that step's assertion that the run row's text (`runText`) includes the lead's
age `2m`, and that the Finished row `[data-overview-finished-row="ovh-done"]` reads `10m`; put both texts in the step's
JSON detail.

**Acceptance in the app:** `task verify:ui -- project-overview-history` passes, and shot 12 shows `2m` on the
`ovh-run` row and `10m` on the `ovh done` Finished row. Run `task check:ts` and the vitest file above.

**Step 5: Commit** the four files with a pathspec.
