# Session search fix round 1

**Goal:** make the run's Final pass: the one failing step is `launcher-resume` 6b, a read that does not wait for the
asleep chat to draw its bubble; and correct one wire comment the run left wrong.

Working rules: change only the files a task names; prefer the simplest fix; no new abstractions.

### Task 1: launcher-resume 6b waits for the asleep chat's bubble
**Depends on:** none
**Model:** sonnet
**Files:** `scripts/cdp/scenarios.mjs`

The Final on the merged result failed 104/105 on one step, `launcher-resume` "6b. Open asleep from the Agent tree's
Conversations menu…", with detail `{"cell":{"moon":true,"card":false,"asleepNote":"Asleep since 20:23","conversation":true,"bubble":"",…}}`.
The asleep Claude agent's cell was still on its transcript skeleton when the step read it: in `scenarios.mjs` (the
`launcher-resume` scenario, around line 27857) the step waits only for the moon (`[data-agent-row] [data-agent-sleeping]`)
and then reads `cover?.querySelector('[data-chat-you]')` once. Task t-5 of this run saw the same failure twice under load
and showed it passes when the machine is idle, so this is a missing wait, not a product defect. `conversation: true` does
not prove the transcript drew: the composer's placeholder ("message verify resume session to wake it…") holds the same
task text.

Fix: before the `cell = await h.ev(...)` read, wait (with `polishWaitFor`, as the surrounding code does) until
`document.querySelector('[data-sleeping-transcript="<tabId>"] [data-chat-you]')` has text equal to
`LAUNCHER_RESUME_TASK`, with a generous timeout (30 s, like the other loads in this scenario: the asleep transcript
load is slow on a loaded machine). Keep the assertion as it is; do not weaken it. Make `conversation` read the drawn
conversation, not the composer: check the task text in the cover excluding `[data-sleeping-composer]` (or read it from
the `[data-chat-you]` bubble), so the field means what its name says.

Acceptance: `CDP_PORT=<port> task verify:ui -- launcher-resume` (or `ARC_FINAL_OUT=<dir> node scripts/cdp/final-verify.mjs launcher-resume`)
passes all its steps; say how many runs you made and whether any was under load. Do not run the whole Final.

### Task 2: the SearchSessions query comment names only the syntax the parser has
**Depends on:** none
**Model:** sonnet
**Files:** `pkg/wshrpc/wshrpctypes_agents.go`

`CommandSearchSessionsData.Query`'s comment (`pkg/wshrpc/wshrpctypes_agents.go:408`) says the query takes
`terms, "quoted phrases", -excluded`, but `ParseQuery` in `pkg/agentsessions` has no exclusion syntax (a `-word` is
searched as the text `-word`), and the spec (`docs/superpowers/specs/2026-11-17-session-search-design.md`) asks for none.
Change the comment to match the parser: terms and "quoted phrases". Do not add exclusion. A comment does not reach the
generated TypeScript; if `task generate` changes no file, commit only the Go file.

Acceptance: `go vet ./pkg/wshrpc/` passes; `git diff` shows only that comment line.
