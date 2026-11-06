# Council Brainstorm edge: zones, a spread top 3, grounded ideas, judged matches

Goal: a Brainstorm council gives each seat a zone, spreads its top 3 over zones, checks the cites of ideas that claim
something about today's code, and the bench keeps which key lines matched. Go only, plus docs; no frontend change
beyond the regenerated types.

**Spec:** `docs/superpowers/specs/2026-11-06-council-brainstorm-edge-design.md` (decisions D1-D5 and B1-B6)
**Verify:** `node scripts/verify.mjs ./pkg/council/... ./pkg/wshrpc/... ./cmd/wsh/...`
**Check:** `go vet ./pkg/council/... ./pkg/wshrpc/wshserver/ ./cmd/wsh/cmd/`

Go tests on Windows need `CGO_ENABLED=1 CC="zig cc -target x86_64-windows-gnu"` in front (Bash), or a test that opens
the store panics. Never hand-edit a generated file: change the Go type, then `task generate`.

### Task 1: The new fields, and the regenerated types
**Depends on:** none
**Files:** `pkg/council/types.go`, `pkg/council/bench/results.go`, `pkg/council/bench/results_test.go`, `pkg/council/bench/run_test.go`, `pkg/wshrpc/wshrpctypes_council.go`, `frontend/types/gotypes.d.ts`

The interface every later task builds on (spec B1, B2, B5). Fields only, with their doc comments; no behaviour.

- `CouncilZone{Seat, Name, Covers string}` (json `seat`, `name`, `covers`) and `Council.Zones []CouncilZone`
  (`json:"zones,omitempty"`): one zone per panel seat, in panel order; nil when the council has none.
- `CouncilProposal.Zone string` (`json:"zone,omitempty"`): the stored zone name a Brainstorm idea fits; empty for none.
- `CouncilBenchResult.Matches map[string]int` (`json:"matches,omitempty"`, key line id → rank among the top items) and
  `KeptMatches map[string]int` (`json:"keptmatches,omitempty"`, key line id → rank among the wild ideas kept).
- `CouncilBenchResultsRtnData.Results []bench.CouncilBenchResult` (`json:"results"`): every run line of the file, in
  file order.
- The two maps make `CouncilBenchResult` non-comparable: switch every `!=`/`==` on it in the bench tests to
  `reflect.DeepEqual` (`results_test.go:50`, `run_test.go:291` and `:642`, and any other the compiler names), or the
  package's tests stop building.
- Run `task generate`; commit the regenerated `frontend/types/gotypes.d.ts` (and any other file it rewrites: add it to
  this task's commit).

Acceptance: `go test ./pkg/council/bench -run 'TestResult'` passes with a new test that appends a row carrying
`Matches` and `KeptMatches`, reads it back equal, and reads an old line without them (both maps nil). `task generate`
leaves no diff after the commit.

### Task 2: Zones: the call, round 1, the idea's zone, the synthesis spread
**Depends on:** Task 1 (uses the `Council.Zones`, `CouncilZone` and `CouncilProposal.Zone` fields it adds)
**Files:** `pkg/council/zones.go`, `pkg/council/zones_test.go`, `pkg/council/runner.go`, `pkg/council/runner_test.go`, `pkg/council/prompts.go`, `pkg/council/prompts_test.go`, `pkg/council/parse.go`, `pkg/council/parse_test.go`

Spec D1, D2, B1, B2, and B3's zone rule (not its labels: Task 3).

- `zones.go`: `ModelZones = "haiku"`; `zonesPrompt(c *Council) string` (feature, question, attached paths by name, the
  panel as `id (name): angle` using `angleOf`, one zone per seat read from the question, no two alike, each matched to
  the seat whose angle fits it best, a Vietnamese line for a `LangVi` council, `jsonRule` and the shape
  `{"zones":[{"seat","name","covers"}]}`); pure `parseZones(reply string, panel []CouncilExpert) ([]CouncilZone, error)`
  (trim; drop an unknown seat, a second entry for a seat, an entry with no name; every panel seat must end with a zone,
  else an error; result in panel order); and `(r *Runner) setZones(ctx, rn, id, snap)` making one no-tools call through
  `r.Caller.Call` in the project folder (as `AutoGenerate` does), adding its tokens to the council's `Tokens`/`Calls`
  and the coordinator's stats row, and saving the zones. Any failure (call, empty reply, parse) is
  `log.Printf("[council] %s: no zones: %v", ...)` and leaves `Zones` nil, never a council error.
- `runner.go` `roundsWork`: before round 1's `forEachExpert`, when the council is a Brainstorm, its panel has 2+ seats
  and it holds no zones, call `setZones` and reload `snap` so round 1 reads them. A one-seat panel makes no call; a
  council already holding zones keeps them. In `round1`'s Brainstorm branch, keep `p.Zone` only when the council has
  zones, normalized to the stored name it matches case-insensitively, else clear it; clear it in a Review.
- `prompts.go`: `round1Task` takes the seat: `round1Task(c *Council, e CouncilExpert, verify bool)`, its two callers
  (`Round1Prompt`, `writeAgentTurn`'s first turn) passing theirs. When the council has zones, the Brainstorm task (so
  `Round1Prompt` and `AgentFirstPrompt` both) carries a block naming e's own zone and every seat's (name: covers),
  saying most ideas sit in its own zone, it may offer one idea outside it when it thinks that idea strong, and each idea
  sets `"zone"` to the zone it fits, or `""`. The Brainstorm round 1 shape becomes one builder,
  `brainstormRound1ShapeFor(c *Council) string`, which adds `"zone"` to each example idea only when the council has
  zones; Task 3 extends this same builder with the evidence field, so there is one shape source. Without zones the
  builder returns today's `brainstormRound1Shape` and the prompt is today's, byte for byte, so the tests pinning that
  shape (`parse_test.go:620`, `prompts_test.go:730`, `:951`) keep passing or are moved to the builder.
  The Brainstorm synthesis, with zones, adds a `## Zones` block, a `Zone: <name>` (or `Zone: none`) line under each
  idea, and replaces rule 2 with the spread rule of spec B3 (at most N from N different zones where the ideas allow;
  within a zone picks, then builds; zones' best ranked against each other the same way; a second idea from a zone only
  when no other zone has an idea anyone picked or built on; zone none competes as one zone; an idea nobody picked or
  built on, and a wild idea, never take a place). Without zones, rule 2 is today's.
- `parse.go`: `ParseRound1` reads `zone` (trimmed) into `CouncilProposal.Zone` for every mode.

Acceptance, by focused tests:
- `go test ./pkg/council -run 'TestParseZones'`: a good reply; a missing seat, an unknown seat, a duplicate seat, a
  nameless entry, garbage.
- `go test ./pkg/council -run 'TestZoneStep'` (runner with a fake caller): zones saved and round 1 prompts carry them;
  a failed call or too few zones leaves `Zones` nil and round 1 still runs; a one-seat panel makes no zone call; a
  Review makes none; a council already holding zones (a rerun from round 1) makes no call and keeps them.
- `go test ./pkg/council -run 'TestRound1PromptZone|TestBrainstormSynthesisZones|TestParseRound1Zone|TestRound1KeepsZone'`:
  a seat's prompt names its own zone and lists all; the agent first turn carries it too; a no-zone Brainstorm prompt
  and a Review's round 1 and synthesis prompts equal today's (compare against the prompt built with `Zones` nil, and
  keep any existing golden tests passing unchanged); the synthesis shows `## Zones`, the `Zone:` lines and the spread
  rule only with zones; `ParseRound1` reads `zone`; the runner normalizes a case-different name and clears an unknown
  one and a Review's.

### Task 3: Grounded Brainstorm ideas, labels in its synthesis, version and docs
**Depends on:** Task 2
**Files:** `pkg/council/prompts.go`, `pkg/council/prompts_test.go`, `pkg/council/cites.go`, `pkg/council/cites_test.go`, `pkg/council/runner.go`, `pkg/council/runner_test.go`, `pkg/council/markdown.go`, `pkg/council/markdown_test.go`, `docs/guide/council.md`, `CHANGELOG.md`

Spec D3, B3's labels, B4, B6. Runs after Task 2 (same files).

- `prompts.go`: keep `angleOf` cutting the brief's evidence rule. The Brainstorm `round1Task` replaces its sentence
  "An idea may rest on a guess, so it needs no evidence; ..." (`prompts.go:884`) with its own grounding rule, a new
  constant written for a Brainstorm (not `evidenceRule` itself): a claim about what the code does today cites a
  `path:line`, or a screenshot region written `screenshot:<file>#<name>@x,y,w,h`, in the idea's `"evidence"` with its
  quote (`quoteRule`); an idea about what to build needs none and may still rest on a guess. Update the test that
  forbids `evidenceRule` in the Brainstorm round 1 prompt (`prompts_test.go:723-731`) to assert the new rule and still
  no `evidenceRule`. `brainstormRound1ShapeFor` (Task 2) gains an optional `"evidence"` list in the Review's cite form:
  the example idea with a cite, the other without; update the tests pinning the shape.
  The Brainstorm synthesis gets a Brainstorm label rule (Read code, Guess; an unlabelled idea makes no claim about
  today's code) and its ranking rule's tie-break: between two ideas otherwise even, Read code before Guess; an
  unlabelled idea is never ranked above or below one for its label. Both are written only when at least one sent idea
  carries a label (spec B3: "once labels exist"), with and without zones, so a Brainstorm with no labelled idea keeps
  today's synthesis and the test forbidding `Label:`/`label:` there (`prompts_test.go:756`) keeps passing. Ideas already
  show their label through `writeLabelled`.
- `cites.go`: `ApplyChecks` stops skipping a Brainstorm. In a Brainstorm it checks a sent idea's cites and sets
  `Label = LabelOf(...)` only when the idea has evidence; an idea with none gets `""`; replies are left as they are.
  Review behaviour unchanged.
- `runner.go`: `checkClaims` stops returning early for a Brainstorm (its `checkRoots` serve both modes). Verify commands,
  the snapshot and `fill.go`'s gate stay Review only.
- `markdown.go`: a Brainstorm's document writes no label word, as the UI hides them: the matrix title skips it for a
  Brainstorm, and `docChecks(label, runs)` takes no council, so its call sites (`markdown.go:594`, `:614`) pass `""` as
  the label for a Brainstorm.
- `HarnessVersion` = `2026-11-06.1`.
- `docs/guide/council.md`: a Brainstorm gives each seat a zone, spreads its top 3 over zones and checks the cites of
  ideas that claim something about today's code. `CHANGELOG.md`: one line under Changed in the top section
  (`## Unreleased`; open one above a dated top section), written for the user.

Acceptance, by focused tests:
- `go test ./pkg/council -run 'TestApplyChecksBrainstorm'`: a cited idea gets Read code (resolving cite) or Guess
  (wrong cite); an uncited idea stays unlabelled; a stance reply stays unlabelled; existing Review `ApplyChecks` tests
  pass unchanged. The existing case "a brainstorm is left alone" (`cites_test.go:361`) asserts the old behaviour:
  replace it with these.
- `go test ./pkg/council -run 'TestBrainstormRound1Grounding|TestBrainstormSynthesisLabels|TestCheckClaimsBrainstorm'`:
  the Brainstorm round 1 prompt carries the grounding rule and the evidence field; a Review's round 1 prompt is
  unchanged; the Brainstorm synthesis shows `Label: Read code` under a labelled idea, the label rule and tie-break, and
  nothing under an unlabelled one; with no labelled idea it shows neither rule nor tie-break; the runner labels a
  Brainstorm idea's cites after round 1.
- `go test ./pkg/council -run 'TestBrainstormDocNoLabels'`: a labelled Brainstorm idea's document shows no label word;
  a Review's still does.
- The existing `HarnessVersion` format test passes.

### Task 4: The bench keeps which key lines matched
**Depends on:** Task 1 (uses the `Matches`, `KeptMatches` and `Results` fields it adds)
**Files:** `pkg/council/bench/run.go`, `pkg/council/bench/run_test.go`, `pkg/wshrpc/wshserver/wshserver_council.go`, `pkg/wshrpc/wshserver/wshserver_council_test.go`

Spec D4, B5. Runs beside Tasks 2 and 3.

- `run.go` `judgeRow`: set `row.Matches = verdict.Matches` and `row.KeptMatches = verdict.Kept` beside the counts; a
  failed judging leaves both nil. The want rows in `run_test.go` (near `:287` and `:638`, whose verdicts already hold
  both maps) gain the matching `Matches`/`KeptMatches`.
- `wshserver_council.go` `CouncilBenchResultsCommand`: fill `Results` with the run lines it already reads, in file
  order (an empty file gives an empty list). The text table (`wsh council bench results` without `--json`) is
  unchanged.

Acceptance: `go test ./pkg/council/bench -run 'TestJudgeRow'` (a judged row carries the verdict's matches and kept
ranks; a failed judging carries none) and `go test ./pkg/wshrpc/wshserver -run 'TestCouncilBenchResults'` (the reply
holds every run line with its matches, beside the summary rows) pass.
