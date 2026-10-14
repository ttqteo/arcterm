# Run handoff lifecycle — fix round 1

**Spec:** `docs/superpowers/specs/2026-10-14-run-handoff-lifecycle-design.md`

**Goal:** A run that started from the queue says so on its timeline, in words, under the RUN group.

## Worker and reviewer brief

- Read `AGENTS.md`. Never hand-edit generated files. Commit with a pathspec; never push.
- Go tests in `pkg/wshrpc/wshserver` need cgo, which `node scripts/verify.mjs` turns on through zig; plain `go test`
  there panics with "go-sqlite3 requires cgo" on this machine.

### Task 1: The queued-start event reads as a sentence on the run's timeline

**Depends on:** none

**Files:** `frontend/app/view/agents/runtimeline.ts`, `frontend/app/view/agents/runtimeline.test.ts`, `scripts/cdp/scenarios.mjs`

The scheduler writes a `queued-start` run event (detail `{"entryid": "q-…"}`) on every run it starts from a queue entry,
by the loop or by Start now (`startQueuedEntry`, `pkg/wshrpc/wshserver/wshserver_runqueue.go:219`). The timeline does
not know the kind: `KIND_TITLE` in `runtimeline.ts` has no entry, so the row reads the raw `queued-start`, and
`RUN_GROUP_KINDS` leaves it out, so the row shows only in the collapsed preview.

1. Add `"queued-start": "Started from the queue"` to `KIND_TITLE`, and add `queued-start` to `RUN_GROUP_KINDS`.
2. In the event's detail line (the `switch (event.kind)` that builds a row's second part), `queued-start` reads
   `Started from the queue · <entryid>` when the detail has an `entryid`, and the title alone when it does not.
3. Tests in `runtimeline.test.ts`: the title; the detail line with and without `entryid`; a `queued-start` event with no
   `phaseidx` lands in the RUN group.
4. `run-queue` scenario in `scripts/cdp/scenarios.mjs`: after step 5 (Start now on C makes one new run), add a step
   that opens C's new run on its run sheet (`[data-run-sheet]`, `frontend/app/view/jarvis/runsheet.tsx`; an existing
   scenario waits on it near `scenarios.mjs:1448`) and asserts that the sheet's timeline shows a row reading
   `Started from the queue`; shot it. If the sheet shows no timeline for a held run, open the timeline where the app
   shows one for it (`runtimelineview.tsx`) and say which in the report. Leave the scenario's other steps as they are. The run is held by deferstart, so
   opening its sheet spawns nothing.

Acceptance: the vitest file passes; `task verify:ui -- run-queue` passes with the new step.
