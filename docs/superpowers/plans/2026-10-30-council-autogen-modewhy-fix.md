# Council Auto-generate: the mode's reason in the record — fix round

**Spec:** `docs/superpowers/specs/2026-10-30-council-discuss-suggest-design.md`

**Goal:** A council started with the mode Auto-generate picked records why truthfully, instead of "picked by hand".

**Architecture:** One line in the pure model's `startData`, and its test. No view, wire or Go change.

---

### Task 1: Start council sends "picked from the conversation" for a mode Auto-generate picked

**Depends on:** none

**Decision:** `startData` (`frontend/app/view/agents/councilsetupmodel.ts`, the `modewhy` line) sends
`modeReason(draft)` when it is non-empty, as now. Otherwise it sends `"picked from the conversation"` when
`draft.modeFrom === "conversation"`, and `"picked by hand"` in every other case. Today it sends `"picked by hand"` for an
Auto-generate pick, because `modeReason` is empty for one (the spec pins that, so leave `modeReason` alone). The council
record and its markdown report then say "picked by hand" for a mode nobody picked by hand. The words match the chip's
`picked from the conversation` (`modeChip`), so the two read the same. Once the person flips the mode, `flipMode` clears
`modeFrom` and `"picked by hand"` applies again; no extra rule is needed for that.

**Files:**
- Modify: `frontend/app/view/agents/councilsetupmodel.ts` (`startData`'s `modewhy`)
- Test: `frontend/app/view/agents/councilsetupmodel.test.ts` (the "sends the mode and why with Start council" test, or a
  new one in the `Auto-generate` describe)

**Interfaces:** none change.

**Acceptance:**
- A draft settled from an Auto-generate answer naming brainstorm gives `startData(d).modewhy === "picked from the conversation"` and `mode === "brainstorm"`.
- Flipping that draft with `flipMode` gives `"picked by hand"`.
- A suggestion's reason and an untouched draft keep their current results (the existing assertions stay).
- `npx vitest run frontend/app/view/agents/councilsetupmodel.test.ts` passes, and `task check:ts` is clean.
- No CHANGELOG line is needed: the run's Added line for Auto-generate covers it.
