# Council fix round 1

**Goal:** Fix two defects the Council run left: the Summarize button's enabled state disagrees with what
`Runner.Summarize` accepts, and the Summary view keeps its own copy of the Discussion's avatar colour rule.

Read before any task: `AGENTS.md`, `DESIGN.md`, and the spec `docs/superpowers/specs/2026-10-21-council-design.md`.
No task starts a dev app: the run's Final runs the council scenarios. Run single vitest files and `node --check` on
scenario files; typecheck with `task check:ts` (give it a timeout over 2 minutes).

### Task 1: Summarize is enabled exactly when the runner accepts it

**Depends on:** none

Files: `frontend/app/view/agents/councilmodel.ts`, `frontend/app/view/agents/councilmodel.test.ts`,
`frontend/app/view/agents/councildiscussion.tsx` (title text only, if needed), `scripts/cdp/council/discussion.mjs`,
`scripts/cdp/council/fixtures.test.mjs`.

`canSummarize` (`councilmodel.ts:444`) disagrees with `Runner.summarizeLocked` (`pkg/council/runner.go:1210`), which
refuses any council the runner is running (`busy`) and accepts `done`, `stopped`, `failed` and `awaiting-you` at any
round, once it has proposals and a coordinator:

- It returns true for `running` at round 2, so in a live round 2 the click fails with `council … is running`. The spec
  says the synthesis runs by itself when round 2 ends (spec "Synthesis runs once by itself").
- It returns false for `done`, `stopped` or `failed` at round 1: a council stopped at the pause ("Stop here and keep
  round 1"), or one whose experts all failed round 1 and were retried. The runner accepts those, and Summarize is
  their next step, so the button is dead.

Make `canSummarize` false while `state === "running"` (any round) and true for `done`, `stopped`, `failed` and
`awaiting-you` whenever the council has a proposal. Keep the no-proposals rule. While the council is running at round 2
the disabled button's title says the summary comes by itself when round 2 ends (round 1 keeps its current title, or
none). Update `councilmodel.test.ts` with a case per state and round above, and `fixtures.test.mjs`'s expectations to
match.

The `council-discussion` scenario's round 2 step (`discussion.mjs` ~line 162) clicks Summarize on the running `round2`
fixture and expects a stubbed `CouncilSummarizeCommand`. Change that step to assert the button is disabled on the
running round 2 fixture, and move the stubbed-click check to a fixture the runner would summarize (one at rest with no
summary, such as a stopped or paused council; add a fixture or a variant if none fits), keeping its assertion that one
`CouncilSummarizeCommand` is recorded with the council's id and the Summary opens. The round 1 "Summarize is disabled"
and the follow-up "`Summarize again`" steps must still pass unchanged.

### Task 2: the Summary uses the Discussion's avatar rule

**Depends on:** none

Files: `frontend/app/view/agents/councilsummary.tsx`, `frontend/app/view/agents/councilsummarymodel.ts`,
`frontend/app/view/agents/councilsummarymodel.test.ts`.

`councilsummary.tsx` / `councilsummarymodel.ts` have their own `expertColor` and avatar styling, a copy of
`avatarTone` (`councildiscussionmodel.ts`) and `CouncilAvatar` (`councilthread.tsx`), written before those landed. Make
the Summary import `avatarTone` and `CouncilAvatar` and delete its own copy and its tests. Nothing on screen changes:
the colours and avatar look stay what the `council-summary` scenario's shots show. Grep for every use of the removed
names first.
