# Phone agent list: fix round

Spec: `docs/superpowers/specs/2026-11-18-phone-agent-list-design.md`. Two open issues the run's workers found and did not
fix, each small and independent.

### Task 1: The counts line names the agents that wait on approval or input

**Depends on:** none

Files: `pkg/remotemode/web/static/model.js`, `pkg/remotemode/web/model.test.js`, `scripts/cdp/scenarios-remote.mjs`.

The header title (`needYouTitle`) counts questions + shown items + distinct tabs in `permission` or `input` (from
`handed`, `agents` and every run's workers, `needYouCount`). The sub-line under it (`countsLine`) names questions,
agents handed over, runs held and other shown items, but never the permission/input agents. So with only such an
agent waiting, the page reads "1 needs you" over "Nothing waiting", and on `cmd/remotepreview`'s fixture "7 need you"
sits over a sub-line that accounts for only 5 of them.

- `countsLine` adds the permission and input agents, counted exactly as `needYouCount` counts them (distinct tabs over
  `handed`, `agents` and run workers; factor the tab collection into one helper both use, so the two cannot drift). They
  are two parts worded with the existing `COUNT_WORDS` forms: `1 needs approval` / `2 need approval`, `1 needs input` /
  `2 need input`. Order: questions, approval, input, agents handed over, runs held, other. A zero count is left out.
- Invariant to test in `model.test.js`: for any list, the numbers in `countsLine` other than "agents handed over" add up
  to `needYouCount`, and `countsLine` reads "Nothing waiting" only when `needYouCount` is 0 and nothing is handed over.
  Add cases: only a permission agent ("1 needs approval" under "1 needs you"); a permission tab present in both `handed`
  and `agents` counts once; a run worker on input counts; an asking agent adds nothing (it counts through its question).
- `scripts/cdp/scenarios-remote.mjs` step 1 (around line 601) asserts the sub-line exactly: update the expected string
  to what the fixture now gives (read the states of `cmd/remotepreview`'s fixture rows and run workers; the title stays
  "7 need you"). The empty view's "Nothing waiting" (around line 873) stays. Step 1's screenshot is the step that shows
  this change.

### Task 2: A desk hand-over clears the phone-take flag

**Depends on:** none

Files: `pkg/remotemode/handover.go`, `pkg/remotemode/handover_test.go`.

`handAddFrom(a, phone)` keeps an existing hand-over's flags. So when the phone has taken a tab and not acted on it
(`phone: true, acted: false`) and the owner then hands that same tab over at the desk (`Hand`, e.g. `wsh remote hand`
or `p`), the hand-over keeps `phone: true`, and the phone leaving the agent view (`remoteRelease`) ends the hand-over
the desk just asked for.

- In `handAddFrom`, when the tab is already handed over and the call is a desk hand-over (`phone == false`), clear the
  hand-over's `phone` flag: the owner's explicit hand at the desk makes it a desk hand-over. A phone take of an
  existing hand-over (`phone == true`) still changes nothing, as now. Keep `handAdd`'s signature.
- Test in `handover_test.go`: take a tab through `remoteTake`, then `Hand` it; `remoteRelease` leaves it handed over.
  The existing cases (a take of a desk hand-over is not released; a second take keeps `acted`) still pass.
- Update the comment above `handAddFrom` and the `handover` struct's comment to state the rule.
