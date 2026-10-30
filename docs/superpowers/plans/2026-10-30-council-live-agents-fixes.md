# Council with live agents — fix round

Spec: `docs/superpowers/specs/2026-10-29-council-live-agents-design.md`. These are defects the landed tasks of run
f46b61f9 reported under Found not fixed. Each one is inside the run's goal: rounds the person sets, and held drafts kept
out of everything until sent.

### Task 1: Prompts name the real reply round, and Summarize needs a sent idea
**Depends on:** none
**Files:** `pkg/council/prompts.go`, `pkg/council/prompts_test.go`, `pkg/council/markdown.go`, `pkg/council/markdown_test.go`, `pkg/council/parse_test.go`, `pkg/council/runner.go`, `pkg/council/runner_test.go`

The synthesis, answers and picks prompts still hard-code round 2. They say "In round 2 each expert named…" (`prompts.go:241`
and `:243`), "Its author withdrew it in round 2" (`:626`), and the outcome word `Withdrawn in round 2` in the shapes
(`:658`, `:690`, and the example at `:79`). With `Rounds` 3, picks and withdrawals happen in round 3. Word these from
the council's last reply round, `SynthesisRound(c) - 1` (types.go): a council with no agent, or with `Rounds` 2, reads
exactly as today, and `Rounds` 1 has no reply round, so leave out its picks and withdrawal sentences. If `markdown.go`
or the parse side matches the literal `Withdrawn in round 2`, make it accept the round number in use. Bump
`HarnessVersion`, because the prompts change.

`summarizeLocked` (`runner.go`) lets an awaiting-you council whose ideas are all held drafts reach the synthesis, which
then sees no idea at all. Refuse it at that boundary: `council <id> has no sent idea to summarize`. Read sent ideas
with the existing `Sent` helper.

Tests:
- a 3-round council's synthesis and picks prompts say round 3;
- a 2-round council and a council with no agent produce the same prompt text as before (an existing golden or contains
  check stays green);
- Summarize on an awaiting council whose only ideas are held is refused with that error, and one with a sent idea is
  still accepted.

Run `go test ./pkg/council -run 'Prompt|Synth|Summar|Markdown|Parse'` with `CGO_ENABLED=1 CC="zig cc -target x86_64-windows-gnu"`.

### Task 2: The frontend counts sent ideas only, and one seat rule
**Depends on:** none
**Files:** `frontend/app/view/agents/councilmodel.ts`, `frontend/app/view/agents/councilmodel.test.ts`, `frontend/app/view/agents/councildiscussionmodel.ts`, `frontend/app/view/agents/councildiscussionmodel.test.ts`, `frontend/app/view/agents/agenttreemodel.ts`, `frontend/app/view/agents/agenttreemodel.test.ts`, `frontend/app/view/agents/councilsetupmodel.ts`, `frontend/app/view/agents/councilsetupmodel.test.ts`, `scripts/cdp/council/discussion.mjs`

- `canSummarize` (`councilmodel.ts:623`) counts every proposal, including held and dropped ones. Count sent ideas only,
  through the sent predicate `councilmodel.ts` already uses for the other draft-aware helpers. For an awaiting council
  whose ideas are all held, `summarizeHold` reads "Send or drop the drafts first". This matches Task 1's Go refusal.
- `proposalsBy` in `councildiscussionmodel.ts:109` (behind `expertCard`, still used by the round-1 cards) counts held
  and dropped ideas. Make it count sent ideas only.
- The claude/pi seat rule exists twice: `seatableOf` (`agenttreemodel.ts:601`) and `seatableAgents`
  (`councilsetupmodel.ts:276`), with different project-path fallbacks. Keep one rule: `seatableAgents` keeps the
  rule, and `seatableOf` calls it, or the reverse. Keep the fallback Setup uses, a registered project path, else the
  agent's `cwd`, else the council's project. Both callers' existing tests stay green.
- CDP: in `council-discussion`'s `room-awaiting` phase (its ideas are all held), add a step asserting that
  `[data-council-summarize]` is disabled and that its title reads the new hold.

Run `npx vitest run frontend/app/view/agents/councilmodel.test.ts frontend/app/view/agents/councildiscussionmodel.test.ts frontend/app/view/agents/agenttreemodel.test.ts frontend/app/view/agents/councilsetupmodel.test.ts`.
The step is checked by the run's Final (`council-discussion`).
