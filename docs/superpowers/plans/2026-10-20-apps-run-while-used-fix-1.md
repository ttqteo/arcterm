# Apps run while used: fix round 1

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:systematic-debugging, then superpowers:test-driven-development.

**Goal:** Setup → Tools' Keep running switch shows the person's last click: off then on reads on, as tools.json does.

Spec: `docs/superpowers/specs/2026-10-20-apps-run-while-used-design.md` (§4 Keep running, "Where things live").

---

### Task 1: Keep running reads on after off then on

**Depends on:** none
**Files:** `frontend/app/view/agents/toolslibrary.tsx`, `frontend/app/view/agents/toolslibrarymodel.ts`, `frontend/app/view/agents/toolslibrarymodel.test.ts`

**The defect (Final round 1, `services-setup` step 7).** On svc-run's Setup → Tools page, Keep running is clicked off
and then on. tools.json loses `autostart` and then gains `autostart: true`, and svc-run starts again, so the writes
are right. But the switch (`button[role="switch"][aria-label="Keep svc-run running"]`) still reads
`aria-checked="false"` 300 ms after the entry gained the key. Step detail:
`{"keepIsOn":true,"keepDropped":true,"keepOff":"false","keepGained":true,"keepOn":"false",...}`. Every other step of
the eight Final scenarios passed. The output is in
`<data dir>/final-shots/380eee24-c98a-47fc-81a2-8df8d75dfcfc/1`
(`shots.json`, `waveapp.log`, `dev-app.log`).

**Likely cause, to confirm before fixing.** `ToolDetail` (`toolslibrary.tsx`, ~line 473) keeps the switch in local
state, `useState(tool.autostart)`, and syncs it with `useEffect(() => setAutostart(tool.autostart), [tool.autostart])`.
`tool` comes from the tools status read (`toolsstore.ts` `loadTools`), and a config change triggers that read after
the write. The status that answers the off write can land after the on click. The effect then sets the switch back to
false, and the on write's status may never change `tool.autostart` again from what the effect last saw. Check this
against the code and `waveapp.log` before you write the fix, and say in your report what the cause was.

**The fix.**
- The switch reads the person's own pending choice while a write of it is in flight. After that it reads the stored
  value.
- A status read that began before the last click never overrides that click. The same holds for any order of
  arrival among the off and on writes and their status reads.
- Put the rule in a pure function in `toolslibrarymodel.ts`, beside the other Setup → Tools choices, and test it in
  `toolslibrarymodel.test.ts`. Cover these cases:
  - off then on, with the off status landing after the on click;
  - on then off;
  - a failed write falls back to the stored value;
  - an unrelated status read leaves a pending click alone.
- The thin `toolslibrary.tsx` uses that function.
- Reading the stored value from `atoms.fullConfigAtom`'s `tools[tool.id].autostart` is acceptable. That is what
  `setServiceAutostart` writes and what the scenario reads, and `catalog.go` already treats a missing key as false.
  Whichever source you choose, it must agree with tools.json once the writes settle.
- If `opensin` / `shows` (same file, the same `useState` + `useEffect` pattern) share the race, fix them the same way
  in the same function. If they don't, leave them.

Do not weaken, reorder or add waits to the `services-setup` scenario. The scenario is correct; the view is wrong.

**Step 1:** confirm the cause as described above.
**Step 2:** write the failing vitest cases, run `npx vitest run frontend/app/view/agents/toolslibrarymodel.test.ts`,
and see them fail.
**Step 3:** implement the fix, and see the cases pass.
**Step 4:** `task check:ts` (allow ~3 minutes).
**Step 5:** if a dev app can run, run `task verify:ui -- services-setup` against it and report step 7's detail.
Otherwise say so under Not verified; Final runs it.
**Step 6:** commit with a pathspec.

**Acceptance:** `services-setup` step 7 passes (`keepOn: "true"`) with the scenario unchanged, and the new vitest
cases pass.
