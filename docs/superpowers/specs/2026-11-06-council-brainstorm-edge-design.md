# Council Brainstorm: beat the agent team and one agent — design

Date: 2026-11-06. Brainstorm: `.superpowers/brainstorm/council-brainstorm-edge/brainstorm.json`.

## Goal

A Brainstorm council matches more answer-key lines than both the Claude agent team and one agent alone (solo) on the
bench, while spending fewer tokens than the team. Only Brainstorm changes; a Review keeps today's flow.

## What the bench showed (harness 2026-11-05.5, case newcomer, one run each)

| variant | recall | tokens | minutes | messages |
|---|---|---|---|---|
| council | 1/5 | 1.24M | 5.4 | 103 |
| team | 2/5 | 4.57M | 2.2 | 20 |
| solo | 2/5 | 0.33M | 1.9 | 6 |

Read by hand, all three matched K1; council was the only one that replaced the code words (K2), yet the judge scored it
lowest. The bench keeps only the count, so the judge cannot be checked. What held the council back:

- **Its top 3 crowd into one area.** The judge scores a Brainstorm's first 3 directions only (`judgedItems`,
  `pkg/council/bench/judge.go:85-90`; `TopBrainstorm`), the kept wild ideas apart. The synthesis ranks by how many seats
  picked an idea (`writeBrainstormSynthesisTask`, `pkg/council/prompts.go:1606`), so well-liked ideas from the same area
  take all 3 places. The newcomer key spreads over 5 areas.
- **Round 1 seats all sweep the whole feature.** A role is one general angle (`brief`, `pkg/council/roles.go:22`); the
  newcomer council made 25 proposals with heavy overlap.
- **Brainstorm asks for no grounding.** Round 1 runs every seat with Read/Grep/Glob (`runner.go:1125`), but `angleOf`
  (`prompts.go:376`) cuts `briefEvidenceRule` from the brief and `writeProposal` drops a Brainstorm's evidence line. The
  team's ideas cited code (`agentcenter.ts:62`); the council's report owned to assumptions nobody checked.
- **Cost headroom.** The council spent 1.24M against the team's 4.57M on newcomer, so it can spend more before losing
  the cost condition.

The faster-sharper work (`checkers.go`, `fill.go`, early round 2, the evidence gate) covers Review only and is not
changed here.

## Decisions

### D1. The coordinator sets one zone per seat before round 1

Before round 1, one short call, with no tools, reads the council's question, feature and file list and returns one
zone per model seat: a name of a few words and one sentence saying what part of the feature it covers. Zones are read
from the question itself, not a fixed list: the bench keys spread by user journey on newcomer and by part of the feature
on `run-pause` and `launcher-declutter`, and only zones read from the question fit both.

- Each seat's round 1 prompt names its zone: most of its ideas sit in it, and it may still offer one idea outside it
  when it thinks that idea strong.
- If the call fails or returns fewer zones than seats, round 1 runs as today, without zones (logged, not shown as an
  error).
- Agent seats get the zone in their first turn the same way.
- *Agent's call (builder question 5):* the call returns one zone for every seat but the coordinator, agent seats
  included; fewer zones than that turns zoning off for the council.
- Round 1 stays parallel; round 2 stays the whole cross-check a Brainstorm's ranking needs.

### D2. The top 3 spread over zones

Each round 1 idea carries the zone it belongs to (the author names it; an idea outside its seat's zone names the zone
it fits, or none). The Brainstorm synthesis then picks its at most 3 directions from 3 different zones where the ideas
allow it: merge ideas that say the same thing, take the best idea of each zone, and rank zones against each other.
Picks and builds rank ideas within a zone and break ties between zones; they no longer let one zone take every place. A
wild idea still never takes a place.

### D3. Round 1 is grounded

A Brainstorm's round 1 asks for a `path:line` (or a screenshot region) for every claim about what the code does today,
as a Review does; an idea about what to build needs none. Its cited claims go through the same cite check
(`ApplyChecks`) and get the same labels (Read code, Guess). The synthesis prompt shows each idea's label and prefers an
idea whose claims were read in the code when two ideas are otherwise even. A Brainstorm is not gated: a Guess idea can
still be a direction.

*Agent's call (builder question 3):* in a Brainstorm, an idea that cites nothing makes no claim about today's code and
gets no label (empty, not Guess), and stays out of the tie-break. Only an idea with cites gets Read code, Guess or
Disproved from them. `LabelOf` (`cites.go:247`) returns Guess for no ok cite today; a Brainstorm idea with no evidence
keeps the empty label.

### UI: unchanged (builder question 4)

Zones and labels reach only the coordinator's synthesis prompt. The Brainstorm UI stays as it is: it keeps hiding check
labels (`councilmodel.ts:1365-1368`, `councilsources.ts:125`, `councilmapmodel.ts:217-220`) although the data now holds
them, and shows no zone. No frontend change, so the plan is Go only.

### D4. The judge records which key lines matched

Each bench result row keeps, besides the count, which key lines matched and at what rank (the judge already returns
them: `Verdict.Matches` and `Verdict.Kept`, `judge.go:51-52`; the row today stores only `Recall`, `results.go:50`).
`wsh council bench results --json` shows them, so a disputed score can be checked against the report.

### D5. Measure: 4 cases, 2 runs each, before and after

Four Brainstorm cases: `newcomer`, `services-sleep`, and two new ones built on 2026-11-06 from finished brainstorms
outside the council (keys are the person's own answers, snapshot at the commit before the spec):

- `launcher-declutter`: snapshot `76fc59d61`, 6 key lines.
- `run-pause`: snapshot `cb9b26578`, 6 key lines.

Both are in the data dir's `cases.json`; their keys are in `council-bench/keys/`, their leak strings in
`work/fix-subjects.txt`. `check-cases.sh` finds no case-specific leak; it still reports the generic harness words
(`council-agent-team`, `has doubts`), as for the two live Review cases, because every snapshot made after the council
shipped holds council code.

The baseline runs on the current harness (night of 2026-11-06): council, team and solo, 2 runs per case. After this
design ships under a new `HarnessVersion`, the same 4 cases × 3 variants × 2 runs run again. The council wins when its
recall summed over the four cases is above both the team's and solo's, and its tokens are below the team's. One bench
invocation stops at 50M, so each pass runs as two invocations of two cases.

- *Agent's call (builder question 1):* the person runs both passes by hand; they are not plan tasks. The baseline runs
  on the installed build, which a merge does not change until the person installs, so the plan does not wait on it.
- The after-pass is a report, not a gate (builder question 1): the change ships whether or not the council wins. The
  result decides the next step (seats on mixed models, an extra widening round).
- *Agent's call (builder question 2):* `wsh council bench decision` (`Decide`, `decision.go:53`) stays as it is; the D5
  rule is read by hand from `wsh council bench results --json`.

## Builder's decisions

Made by the planning agent on 2026-11-06 from the code; each settles an item the brainstorm left to the builder.

### B1. The zone call

- **When.** In `roundsWork`, a Brainstorm about to run round 1 whose panel (`panelOf`: every seat but the coordinator,
  agent seats included) has 2 or more seats, and whose council holds no zones yet, makes the call before the first
  round 1 call and saves the zones on the council; round 1 then reads them from the reloaded council. A panel of one
  seat (the bench's solo variant) gets no zones: one zone spreads nothing. A council that already holds zones (a rerun)
  keeps them.
- **Model and call.** `ModelZones = "haiku"`, one call through `r.Caller.Call` with no tools, in the project folder, as
  `AutoGenerate` does. Its tokens count in the council's `Tokens` and `Calls` (the coordinator's stats row), so the bench
  sees the spend.
- **Prompt.** The feature, the question, the attached file and folder paths (names only, no contents), and the panel's
  seats as `id (name): angle` (the brief cut by `angleOf`). It asks for one zone per seat, read from the question
  (a user journey, a part of the feature, whatever splits this question), no two alike, each matched to the seat whose
  angle fits it best, written in the council's language (`LangLine`-style line for Vietnamese).
- **Shape.** `{"zones": [{"seat": "ux", "name": "First launch", "covers": "one sentence on the part of the feature it
  covers"}]}`.
- **Parse (`parseZones`, pure).** Trim each field; drop an entry whose seat is not on the panel, a second entry for one
  seat, or one with no name. Every panel seat must end with a zone, or the result is no zones. A failed call, an empty
  reply or an unreadable one is also no zones: logged with `log.Printf("[council] %s: no zones: ...")`, never a council
  error, and round 1 runs as today.
- **Storage.** `Council.Zones []CouncilZone` (`json:"zones,omitempty"`), `CouncilZone{Seat, Name, Covers string}`, in
  panel order. `task generate` regenerates the bindings; the frontend reads none of it.

### B2. The zone in round 1, and on an idea

- `Round1Prompt` and the agent seat's first turn (`AgentFirstPrompt`, through the shared `round1Task`) carry, when the
  council has zones, a block naming the seat's own zone and listing every seat's: most of its ideas sit in its own zone,
  it may offer one idea outside it when it thinks that idea strong, and each idea sets `"zone"` to the zone name it fits
  (its own, another listed one, or `""` for none). The Brainstorm round 1 shape gains `"zone"` only when the council has
  zones. A council with no zones gets the prompt it gets today, word for word.
- `ParseRound1` reads `zone` (trimmed) into `CouncilProposal.Zone` (`json:"zone,omitempty"`) for every mode. The runner
  keeps it only for a Brainstorm with zones, normalized to the stored zone name it matches case-insensitively, and
  clears it otherwise (a Review, no zones, or a name that matches none).

### B3. The synthesis rule

- With zones, the Brainstorm synthesis prompt adds a `## Zones` block (each seat's zone name and covers line), each
  idea in the proposals list shows a `Zone: <name>` line (or `Zone: none`), and rule 2 becomes: choose at most N ideas
  worth trying from N different zones where the ideas allow it. Merge ideas that say the same thing first (rule 1, as
  today). Within a zone, the best idea is the one most experts picked (a pick of any idea it merges counts once), then
  the one most experts built on, then the label (below). The zones' best ideas are then ranked against each other the
  same way. A second idea from a zone already holding a place takes one only when no other zone has an idea anybody
  picked or built on. Ideas with zone none compete as one zone of their own. An idea nobody picked or built on, and a
  wild idea, never take a place.
- Without zones (an old council, or a zone call that failed), rule 2 stays as today, with only the label tie-break added
  once labels exist.
- **Labels.** The prompt shows an idea's label through `writeLabelled`, as a Review's does, with a Brainstorm label rule:
  Read code (a path:line it cites resolves) or Guess (nothing it cites checks out); an idea with no label makes no claim
  about today's code. Between two ideas otherwise even, Read code goes before Guess; an unlabelled idea is never ranked
  above or below one for its label.

### B4. Grounding

- The brief stays cut by `angleOf` (its "every claim ... marked weak" wording is a Review's). A Brainstorm's round 1
  instead gets its own grounding rule: a claim about what the code does today cites a `path:line` (or a screenshot
  region) in the idea's `"evidence"`, with its quote (`quoteRule`); an idea about what to build needs none. The
  Brainstorm round 1 shape gains an optional `"evidence"` list in the Review's cite form. Round 2 is unchanged.
- `ApplyChecks` no longer skips a Brainstorm: it checks a Brainstorm idea's cites and labels it with `LabelOf` only when
  the idea has evidence; an idea with none keeps the empty label. A Brainstorm's replies stay unchecked and unlabelled.
  `checkClaims` stops returning early for a Brainstorm; verify commands, the snapshot and the evidence gate (`fill.go`)
  stay Review only.
- The saved document keeps hiding labels for a Brainstorm, as the UI does: `markdown.go` writes no label word in a
  Brainstorm's matrix or check lines.

### B5. Bench rows

- `CouncilBenchResult` gains `Matches map[string]int` (`json:"matches,omitempty"`: key line id → rank among the top
  items) and `KeptMatches map[string]int` (`json:"keptmatches,omitempty"`: key line id → rank among the wild ideas kept),
  set from `Verdict.Matches` and `Verdict.Kept` in `judgeRow`. A row written before has neither and still reads.
- `wsh council bench results --json` shows each run: `CouncilBenchResultsRtnData` gains `Results
  []bench.CouncilBenchResult` (`json:"results"`), the file's run lines in order, filled where the server already reads
  them. The text table is unchanged.

### B6. Versioning, tests and docs

- `HarnessVersion` becomes `2026-11-06.1`.
- Focused Go tests: `parseZones` (good reply, a missing seat, an unknown seat, a duplicate, garbage); the runner's
  zone step (zones saved; a failed call or too few zones leaves none and round 1 runs; a one-seat panel makes no call);
  round 1 prompts with and without zones (the no-zone prompt equal to today's); `ParseRound1` reading `zone` and the
  runner normalizing it; the synthesis prompt's zone rule, `Zone:` lines and labels, and the no-zone rule; a Review's
  round 1 and synthesis prompts unchanged; `ApplyChecks` on a Brainstorm (cited idea labelled, uncited idea unlabelled,
  replies untouched); the document showing no label in a Brainstorm; a bench row with matches round-tripping and an old
  row reading.
- `docs/guide/council.md` says a Brainstorm gives each seat a zone, spreads its top 3 over zones and checks the cites of
  ideas that make a claim about today's code; one `CHANGELOG.md` line under Changed.
