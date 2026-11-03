# Workflow scan, core only: fix round

## Context for every task

A fix round for the run that ported the kaeltran16 fork's workflow scan (plan
`docs/superpowers/plans/2026-11-03-workflow-scan-core.md`, spec `docs/superpowers/specs/2026-10-26-workflow-scan-design.md`).
The palette's Scan workflow row promises "Starts a scan and opens its agent". `startWorkflowScan`
(`frontend/app/cockpit/palette-scan.ts`) calls `openTarget(model, { kind: "workflowscan", runId })` as soon as
`WorkflowScanStartCommand` returns, and `openref.ts`'s `scanAgent` reads `model.agentsAtom` + `model.terminalsAtom`
once, synchronously. The new worker only enters those atoms after its tab's block object loads in the frontend
(`liveTerminalsAtom`) or its hook reports a status (`liveAgentsAtom`), which comes after the RPC returns. So a fresh
start lands on the run's sheet, not on the agent.

### Task 1: The palette's Scan workflow row waits for the scan's agent before opening it
**Depends on:** none

In `frontend/app/cockpit/palette-scan.ts`, after the start returns a run and before `openTarget`, wait until
`model.agentsAtom` or `model.terminalsAtom` holds an entry whose `runId` is the new run's id (subscribe with
`globalStore.sub`, resolve at once if it is already there), for at most 15 s; then call `openTarget` as now, whether
or not the agent showed up (after the timeout it lands on the run's sheet, as it does today). Unsubscribe on every
path. Leave `openref.ts`'s `workflowscan` route as it is: an address opened later, after the agent closed, must still
land on the sheet at once, not after a wait. Keep the wait's pure part (does this roster hold the run's agent)
testable.

Files: `frontend/app/cockpit/palette-scan.ts` (+ `palette-scan.test.ts`).

Acceptance: `palette-scan.test.ts` covers an agent already in the roster (opens with no wait), an agent that appears
after the start returns (opens only after it appears, landing on it), and none appearing (fake timers: opens after
15 s); the existing open and rethrow cases still pass; `task check:ts` is clean.
