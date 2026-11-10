# Council: faster, and a sharper top — plan

Goal: a Review council finishes sooner (shared pre-read, early round 2, a lean synthesis) and its report leads with five
ranked, evidence-backed findings, the rest folded. The spec, including its "Builder's calls" section, is the contract:
read it first, then `pkg/council/runner.go` `roundsWork` (line ~798), `prompts.go` `SynthesisPrompt` / `round2PromptFor`,
`parse.go` `ParseSynthesis`, and `runner.go` `cleanSummary` before changing them.

Principles: simple, direct code; one source of truth; no abstraction for a single use; errors handled at boundaries,
never swallowed. Go tests on Windows need `CGO_ENABLED=1 CC="zig cc -target x86_64-windows-gnu"` (Bash).

**Spec:** `docs/superpowers/specs/2026-11-05-council-faster-sharper-design.md`
**Verify:** `node scripts/verify.mjs ./pkg/council/...`
**Check:** `go vet ./pkg/council/ && task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs council-summary`

### Task 1: Report view folds the rest, shows up to five directions
**Depends on:** none
**Files:** `frontend/app/view/agents/councilsummarymodel.ts`, `frontend/app/view/agents/councilsummarymodel.test.ts`, `frontend/app/view/agents/councilsummary.tsx`, `scripts/cdp/council/summary.mjs`, `CHANGELOG.md`

The `CouncilSummary` wire type does not change, so this task needs no Go change and runs beside the rest.

Design decisions:
- The directions render in full as today, however many the report holds (Go caps them: 5 for a Review, 3 for a
  Brainstorm). The view sets no cap of its own.
- The `kept` section (`data-council-kept`, heading from `keptHeading`: Also raised, or Wild ideas kept aside) is folded
  by default: its heading and count become one button (with `aria-expanded`, a chevron, a `data-council-kept-toggle`
  attribute) that opens and closes the grid. The fold state is local `useState` (losing it on unmount is fine: folded
  is the default). Follow DESIGN.md and the existing tokens; no raw colors.
- Keep the logic in the pure model (`councilsummarymodel.ts`), e.g. the toggle's label and count, with the `.tsx`
  thin.

Acceptance:
- Vitest in `councilsummarymodel.test.ts`: a Review report with 5 directions and 4 kept items gives 5 `directionRows`
  and 4 `keptRows`; a Brainstorm with 3 directions gives 3; an old report (3 directions, coordinator-written stances,
  kept items) gives the same rows as before. Run `npx vitest run frontend/app/view/agents/councilsummarymodel.test.ts`.
- CDP: derive a Review variant with 5 directions and at least 3 kept items inside `summary.mjs` from the done fixture,
  the way the Brainstorm variant there is derived (`summary.mjs` ~line 1096, "The done fixture as a Brainstorm"); do not
  add a fixture file or change `fixtures.mjs` (its list is asserted by `fixtures.test.mjs`). Add steps to the
  `council-summary` scenario that load that variant and assert:
  5 direction rows are shown in full; the kept section shows its heading and count with the grid hidden; a click on
  the toggle shows every kept item; a second click folds it. Existing `council-summary` steps that read
  `[data-council-kept-idea]` open the fold first. Run `task verify:ui -- council-summary` against a dev app if one can
  start; Final runs it regardless.
- `CHANGELOG.md` under the top section's `Changed`: one user-facing line for this whole run, e.g. a council's report
  leads with up to five ranked findings and folds the rest, and a council finishes sooner because seats start reviewing
  as ideas arrive.

### Task 2: Shared pre-read and targeted cross-check routing
**Depends on:** none
**Files:** `pkg/council/types.go`, `pkg/council/parse.go`, `pkg/council/parse_test.go`, `pkg/council/prompts.go`, `pkg/council/prompts_test.go`, `pkg/council/checkers.go`, `pkg/council/checkers_test.go`, `frontend/types/gotypes.d.ts`

Design decisions (spec, "Builder's calls": Pre-read caps, Round 1 field, Routing, Round 2 prompt):
- `writeFiles` inlines each of `c.Files` in full under `### <path>` in a fenced block, up to 48 KB per file and 160 KB
  in all, in list order; a file over a cap or one that does not read stays a plain list line with a note that it was
  not inlined. Resolve paths the way cites do (`citeRoots`, `runner.go`). Only round 1 prompts carry the contents.
- `round1Shape` gains `"checker"` and `"checkwhy"` per proposal, with a rule that names the panel's ids and asks for
  one other seat that should check it and why. `ParseRound1` reads both. `CouncilProposal` gains `Checker` and
  `CheckWhy` (`json:"checker,omitempty"`, `json:"checkwhy,omitempty"`); run `task generate` and commit the
  regenerated `frontend/types/gotypes.d.ts` (never hand-edit it). A Brainstorm and an agent seat's first turn ask for
  neither.
- New `checkers.go`: `func routeChecker(c *Council, p CouncilProposal) string` — the named seat when it is on the panel
  (`panelOf`), not the author and not the coordinator; else the panel seat other than the author with the fewest
  sent proposals already routed to it, ties by panel order; "" for a one-seat panel. Task 4 relies on this exact
  signature and on `Checker` holding the settled seat id.
- `round2PromptFor` writes `## Proposals routed to you` (a proposal whose `Checker` is this seat: full argument,
  evidence, results, its `checkwhy`, and its thread in rounds after 2) and `## Other proposals` (id, title and the
  argument's first sentence cut at 160 characters). In rounds after 2, a proposal that drew a challenge or an
  objection is written in full with its thread for every seat. The task text asks a stance on every routed proposal
  and on another only for a challenge or an objection; picks may name any proposal. A proposal with an empty `Checker`
  (an old council) is written in full, as today. A Brainstorm keeps today's prompt. `writeAgentTurn` makes the same
  split for agent seats.
- Pass scope (Task 4 relies on this exact interface): `type round2Scope struct { Only []string; Picks bool }` —
  `Only` lists the proposal ids the pass reviews (nil means all), `Picks` says whether it asks for picks. The signature
  becomes `round2PromptFor(c *Council, e CouncilExpert, round int, scope round2Scope) string`, and `round2Task` takes
  the `Picks` flag: with it false, the task text and the JSON shape ask no picks. A proposal out of scope is still
  listed under `## Already reviewed` by id and title only, so a picks pass can name it. `Round2Prompt` and today's one
  caller (`runner.go` `round2`) pass `round2Scope{Picks: <today's rule>}`, so behaviour is unchanged until Task 4.
- Bump `HarnessVersion`.

Acceptance (focused tests; `go test ./pkg/council -run '<names>'`):
- `routeChecker`: named checker kept; none, unknown, self or coordinator falls back to the fewest-checks seat; ties go
  by panel order; load spreads over several proposals; one-seat panel gives "".
- `ParseRound1` reads `checker` / `checkwhy`, and a reply without them still parses.
- `round2PromptFor` writes a routed proposal's full argument and evidence and only title plus first line for the rest;
  a later round writes a challenged proposal in full; a Brainstorm prompt is unchanged; an empty `Checker` is written
  in full.
- `round2PromptFor` with a scope writes only the in-scope proposals for review and lists the rest by title under
  `## Already reviewed`; with `Picks` false it asks no picks, with true it does.
- The pre-read inlines a small file, lists but does not inline one over 48 KB, stops inlining past 160 KB total, and
  lists a missing file.

### Task 3: Lean synthesis, Go's fill and the evidence gate
**Depends on:** Task 2
**Files:** `pkg/council/prompts.go`, `pkg/council/prompts_test.go`, `pkg/council/parse.go`, `pkg/council/parse_test.go`, `pkg/council/fill.go`, `pkg/council/fill_test.go`, `pkg/council/runner.go`, `pkg/council/runner_test.go`, `pkg/council/direction_test.go`, `pkg/council/markdown_test.go`, `skills/council/SKILL.md`

Runs after Task 2 (shares `prompts.go` and `parse.go`). `skills/council/SKILL.md` (~line 13) says a report holds up to
three directions: make it five for a Review, three for a Brainstorm.

Design decisions (spec sections 1, 5, 6 and "Builder's calls": Lean synthesis shape, Go's fill, Evidence gate):
- `synthesisShape` and `brainstormSynthesisShape` drop `stances`, `agreed` and `outcomes`; the rules that asked for
  them (today's rules 6 and 7) go. `ParseSynthesis` still reads them when present.
- Rule 2 for a Review ranks by how bad the finding is if left alone (data loss, broken flow, wrong state shown, cost,
  polish), the claim label breaking ties; the prompt now shows each proposal's and reply's label (Ran, Read code,
  Guess, Disproved — use the words the UI uses for `LabelRan` etc.) and says Guess and Disproved claims stay out of the
  top 5. Picks stay as context (`writePicks`), not a ranking rule. A Brainstorm's ranking rule is unchanged.
- `maxDirections` becomes a function of the council: 5 for a Review, 3 for a Brainstorm; every use follows
  (`cleanSummary`, both synthesis prompts).
- New `fill.go`, called from `cleanSummary` after `cleanDirection`: the evidence gate (Review only; a direction's label
  is its best member's, Ran > Read code > Guess > Disproved; "" does not gate; a gated direction moves, in order, to
  the head of `kept`; the top renumbers from 1), then the fill for both modes: stances (each panel seat other than the
  `from` authors takes its strongest stance among its replies of round 2 and later on those proposals, oppose >
  challenge > accept), `agreed`, outcomes ("Direction N" / "Merged into direction N" / "Also raised" or "Kept aside" /
  "Withdrawn in round R" / "Cut at the pause"), and a Review proposal placed nowhere appended to `kept` as its own line
  (a Brainstorm's reads "Not picked"). Go's values replace whatever the model sent.
- Bump `HarnessVersion`.

Acceptance (focused tests):
- Fill: a plain direction's stances, `agreed` and outcomes from round 2 replies; a merged direction leaves its authors
  out and takes each seat's strongest stance; a kept item's outcomes; a withdrawn and a cut proposal; a Review
  proposal placed nowhere lands at the end of `kept`; a Brainstorm's reads "Not picked".
- Gate: a Guess direction and a Disproved direction in the top move to the head of `kept` and the top shows fewer than
  5; a merged direction with one Ran member stays; an unlabelled direction stays; a Brainstorm is not gated.
- `cleanSummary` keeps 5 directions for a Review and moves the sixth to `kept`; keeps 3 for a Brainstorm.
- `ParseSynthesis` reads the lean shape and still reads an old reply with stances and outcomes.
- `SynthesisPrompt` shows labels, asks for no stances or outcomes, and states the severity rule for a Review.
- Update existing `runner_test.go` / `direction_test.go` / `markdown_test.go` cases that relied on coordinator-written
  stances or outcomes, or on 3 directions in a Review.

### Task 4: Early round 2 with per-seat claim checks
**Depends on:** Task 2 (uses `routeChecker`, `CouncilProposal.Checker` and the `round2Scope` pass parameter), Task 3
**Files:** `pkg/council/runner.go`, `pkg/council/runner_test.go`, `pkg/council/verify.go`, `pkg/council/verify_test.go`, `docs/guide/council.md`

Runs after Task 3 (shares `runner.go` and `runner_test.go`). It changes no prompt: it only calls Task 2's
`round2PromptFor(c, e, round, round2Scope{...})`.

Design decisions (spec section 3 and "Builder's calls": Routing, Early round 2 and the catch-up — read that section
in full; it is the contract):
- In `round1`'s apply, set each landed proposal's `Checker` with `routeChecker` (Review only).
- In `roundsWork`, a Review with no held drafts and no `PauseAfterRound1` runs, per model seat, one chain: round 1;
  its own claim checks (cites via `ApplyChecks`, and `verify` commands of its own proposals only, after the tree
  snapshot is ready — give `RunVerifies` an author filter or an equivalent in `verify.go`); then an early round 2 over
  every other seat's proposal whose claims are settled.
- Per-seat verify runs are serialized behind one runner mutex: `RunVerifies` keys its tree `council-<id>`
  (`verify.go:511`) and `CouncilTrees.Make` replaces a tree of that key (`counciltree.go:50`), whose deferred Remove
  deletes it, so two seats verifying at once would wipe each other's tree.
- Picks: an early pass passes `Picks: true` only when, as it starts, every seat's round 1 and claim checks are done.
  `applyPicks` runs only on a pass that asked for picks (today it runs on any round-2 pass, `runner.go` ~1674, and
  overwrites `c.Picks[seat]`).
- `c.Round` becomes 2 when the first seat starts its early pass (the person's choice): the live view then shows
  cross-review. Keep `roundsWork`'s own loop and `everyoneFailedRound1` reading the round they mean, not `c.Round`.
- At the barrier (every seat's round 1 and claim checks done): `everyoneFailedRound1` is checked as today; a proposal
  whose `Checker` failed round 1 is routed again; then `routePending` runs, before any catch-up, so a catch-up reads
  the person's routed asks. Then each seat runs a catch-up when its earlier passes left anything — proposals it has not
  seen at all, proposals routed to it that it saw only as a title, or open asks — with `Only` set to those and `Picks`
  true if it has given none. Track per seat which proposal ids each pass's prompt held in full and which by title.
  `markAnswered` and `checkMemory` run after the catch-ups.
- A council of three rounds runs round 3 through `replyPass` as today after the catch-ups.
- Agent seats run round 2 after the barrier as today. A Stop (ctx cancelled) ends every chain cleanly.
- Councils that hold drafts or pause after round 1, and every Brainstorm, keep today's flow unchanged.
- `docs/guide/council.md`: describe what a person now sees: seats start reviewing as ideas arrive, each idea goes to
  one named checker in full, the report's top five (three for a Brainstorm) with the rest folded, and Guess or
  Disproved claims kept out of the top.

Acceptance (focused tests with the fake callers `runner_test.go` already uses):
- An early-finishing seat's round 2 call starts before a slow seat's round 1 ends, and its prompt holds only proposals
  whose claims were settled (cites checked, own verify runs done) when it was built.
- The catch-up pass covers the late proposals, gives the picks, and adds no second stance on a proposal the early pass
  answered; an early pass that started while a seat was still in its claim checks (round 1 done) asks no picks and is
  followed by a catch-up covering that seat's proposals.
- A seat that finishes last runs one pass, with picks; an early pass without picks leaves `c.Picks` for that seat
  unset.
- Landed proposals carry `Checker`; a checker that failed round 1 is re-routed at the barrier, and its new checker's
  catch-up reviews it in full.
- `c.Round` reads 2 once the first early pass starts, while another seat is still in round 1.
- Two seats' `verify` commands requested at once both run and keep their results (no tree wiped).
- A person's ask posted during round 1 is routed before the catch-ups and answered in one.
- A three-round Review runs round 3 after the catch-ups.
- A council with held drafts, one with `PauseAfterRound1`, and a Brainstorm keep the barrier (no round 2 call before
  every round 1 ends).
- A Stop during early round 2 ends the council without a hang (run with `-race` on the new tests if cgo allows).
