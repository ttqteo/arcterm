# Council: faster, and a sharper top

Date: 2026-11-05. Brainstorm: `.superpowers/brainstorm/council-faster-sharper/brainstorm.json`.

## Why

The person reads a council's answer and its first few items, not every idea or the matrix. The council-vs-team bench
(2026-11-03, `council-bench.jsonl` in the packaged data dir) found council v1 and a Claude Code agent team tied on
findings, but the team ran in about 0.7x the wall time (14.5 against 21.0 minutes over the two cases' first runs) and
wrote a short ranked report, while the council buried a real hit at rank 6 and two runs on the same spec chose different
top directions.

Goal: shorter wall time, and a top section that carries the most important real findings. **Depth first**: round 1 keeps
its full time and every seat's depth; speed comes only from steps that add no finding. A council is expected to stay
around 8-10 minutes.

Not a rebuild on Claude Code agent teams: the council keeps its live view, mixed models, independent round 1, Go-set
claim labels and matrix.

## What the bench councils showed

**Time.** Councils ae60c718, d5606049 (spec-live-agents) and 23801074 (bugs-orchestrate), in the data dir's `councils/`:
9.2 / 10.0 / 11.8 minutes. Round 1 proposals arrived 4.4-6.3, 5.6-7.1 and 5.6-8.8 minutes in; round 2 replies
7.6-7.9, 8.2-8.7 and 10.1-10.4; the coordinator's synthesis took 1.2-1.4 minutes on opus. Each seat makes 2 calls
(round 1, round 2), the coordinator 1. Round 1 ends with the slowest seat (60-80 tool calls); early seats idle up to 5
minutes at the barrier (`pkg/council/runner.go:816-820`). Every seat's timeline opens with the same 9-10 reads of the
council's listed files in its first 20-30 seconds. The team's round 2 took about 0.7 minutes and its report 0.5.

**Report.** Directions are ranked by synthesis rule 2: unchallenged first, then by pick count
(`pkg/council/prompts.go:1252-1254`), at most 3 in full (`maxDirections`, `pkg/council/parse.go:86`), then 10-14 Also
raised items, Ask next and the matrix: about 13 KB. In bugs-orchestrate the hit on key K4 (header 4/5 against tree 5/5)
sat at Also raised #3, sixth overall. The team wrote 5 items ranked by importance, each with Why and Disagrees, in
about 3.5 KB. Both found a real bug no key held: `CancelGroup` (`pkg/orchestrate/scheduler.go:244`) skips
`blocked-merge`, `verifying` and `verify-failed`, so `allTasksTerminal` (`pkg/orchestrate/leadclose.go:220`) never
passes for such a cancelled run.

## Design

### 1. Lean synthesis: Go does the bookkeeping

The coordinator writes only what needs judgment: the answer, which proposals merge, the ranked top with reasoning and
first step, one line per other item, Ask next, and weak claims. Go fills in the stances, `agreed` flags, outcomes and
matrix from the round 2 data it already holds (today synthesis rule 6 has the coordinator copy each stance "from the
replies above", and rule 7 writes every proposal's outcome). A merged direction takes its stances from its member
proposals; the authors of merged proposals stay out of its stances, as today.

### 2. Shared pre-read

The council's listed files go, in full, into every round 1 prompt, where `writeFiles` (`prompts.go:781`) lists them
today, up to a size cap (total and per file, the builder's call); a file over the cap stays listed as today. Full
contents, not a haiku digest: a digest drops detail, and depth comes first.

### 3. Early round 2

A seat that finishes round 1 starts reviewing the proposals already in, instead of waiting at the barrier. A catch-up
pass covers proposals that land after that seat started its round 2.

- **Claim checks stay ahead of review.** `settleClaims` runs between rounds today so claims are checked before anyone
  argues over them (`runner.go:817-819`). It becomes per seat: a seat's citations are checked and its `verify` commands
  run as soon as its round 1 lands, before any early round 2 reads its proposals.
- **Councils that pause keep the barrier.** A council that holds drafts, or has `PauseAfterRound1`, keeps today's
  barrier: the person cuts ideas there, and reviewing early would argue over ideas about to be cut.
- **A Review only** (Agent's call). Early round 2 and the targeted cross-check (section 4) apply to a Review. A
  Brainstorm keeps today's barrier and full round 2: its ranking rests on picks and builds-on counts
  (`writeBrainstormSynthesisTask`, `prompts.go:1301`), which need every seat to see every idea.
- **Picks in a Review** (Agent's call). A seat gives its picks in its last pass (its catch-up, or its only pass), after
  it has seen every proposal's title. Picks stay in the synthesis prompt (`writePicks`) as context for the
  coordinator, not as a ranking rule (section 6).
- **Model seats only** (Agent's call). Live agent seats keep the barrier: their later turns go through
  `AgentLaterPrompt` / `writeAgentTurn`, and they get no `verify`. They still get the routing split of section 4.

### 4. Targeted cross-check: the author names a checker, titles to all

In round 1 each author names one other role to check each proposal and says why (a new field in the round 1 JSON,
parsed in `parse.go` like `verify`). Go sends that seat the proposal's full argument and evidence; every other seat
gets the title and one line and may still challenge it. `round2PromptFor` (`prompts.go:1025`) writes the two kinds
apart. A proposal whose author names no checker, an unknown role or itself goes to the seat with the fewest checks so
far. Live agent seats (`agentPrompt`) get the same split.

Because the checker is known the moment its author's round 1 ends, routing works per proposal as it lands, which early
round 2 needs.

**Reply rounds after round 2** (Agent's call): a seat gets the full text and thread of the proposals routed to it and of
every proposal that drew a challenge; the rest stay title plus one line.

### 5. The top of the report

The answer in two or three sentences, then five ranked findings for a Review (three ideas for a Brainstorm), each with
why, evidence, first step and who disagrees; the rest one line each, folded. `maxDirections` becomes 5 for a Review and
stays 3 for a Brainstorm. The report view (`frontend/app/view/agents/councilsummary.tsx`) shows the top in full and
folds the rest. Older reports (3 directions, coordinator-written stances) still render.

### 6. Ranking: coordinator by severity, Go gates the evidence

Rule 2 ranks by how bad a finding is if left alone (data loss, broken flow, wrong state shown, cost, polish), with the
Go-set claim label breaking ties. The synthesis prompt shows those labels (Ran, Read code, Guess, Disproved), which it
hides today, and tells the coordinator to keep Guess and Disproved claims out of its top 5. Go then enforces it: any
Guess or Disproved direction that slips into the top is moved to the folded list, and the top shows fewer than 5. Go
promotes nothing, since a folded item has no reasoning or first step.

**A merged direction's label** (Agent's call) is its best member's (Ran > Read code > Guess > Disproved), so the gate
holds it back only when none of its proposals is backed (labels are per proposal, `CouncilProposal.Label`,
`pkg/council/cites.go:242`).

Every prompt change bumps `HarnessVersion` (`prompts.go:17`).

## How we know it worked

After the build, the person runs the new council once on `spec-live-agents` and `bugs-orchestrate` (about 25M tokens,
`wsh council bench --variant council --runs 1`) and compares wall time and top-5 hits with the 2026-11-03 rows by hand.
The plan does not run it.

## Builder's calls (settled before the plan)

The points the brainstorm left to the builder, settled here so the plan's tasks share one interface.

**Pre-read caps.** 48 KB per file and 160 KB in all, in the order `c.Files` lists them, each under a `### <path>`
heading in a fenced block; a file past either cap, or one that does not read, stays a plain list line as today, with a
note that it was not inlined. A path resolves the way a cite does (`citeRoots`). Screenshots stay as they are.

**Round 1 field.** Each Review proposal in `round1Shape` gains `"checker": "<expert id>"` and `"checkwhy": "one line:
why that seat should check it"`; the prompt lists the panel's ids for it. `ParseRound1` reads both (a missing one is
""). `CouncilProposal` gains `Checker string \`json:"checker,omitempty"\`` (the seat it is routed to, as Go settled it,
not as the model wrote it) and `CheckWhy string \`json:"checkwhy,omitempty"\``; `task generate` follows. A Brainstorm
and a live agent seat's round 1 ask for neither.

**Routing.** One pure function, `routeChecker(c *Council, p CouncilProposal) string`, in a new `pkg/council/checkers.go`:
the named seat when it is on the panel, not the author and not the coordinator; otherwise the panel seat other than the
author with the fewest proposals routed to it so far, ties broken by panel order. The runner calls it as each proposal
lands and stores the result in `Checker`. At the barrier, a proposal whose checker failed round 1 is routed again the
same way. A council with one seat routes nothing.

**Round 2 prompt.** `round2PromptFor` writes `## Proposals routed to you` (full argument, evidence, results, the
author's `checkwhy`, and the thread after round 2 as today) and `## Other proposals` (the title and the argument's first
sentence, cut at 160 characters, with its id). The task asks a stance on every routed proposal, and on another only when
the seat has a challenge or an objection. In reply rounds after round 2, a proposal that drew a challenge or an
objection moves to the full section with its thread. A Brainstorm keeps today's prompt. `agentPrompt` / `writeAgentTurn`
make the same split.

**Early round 2 and the catch-up.** In a Review with no held drafts and no `PauseAfterRound1`, each model seat runs its
own chain: round 1, then its own claim checks (cites checked, its own proposals' `verify` commands run, after the tree
snapshot is ready), then its early pass over every proposal whose claims are settled and that is not its own. The
per-seat `verify` runs go one at a time behind one runner lock: `RunVerifies` uses one tree per council
(`council-<id>`, `verify.go:511`), and two runs at once would replace and remove each other's tree.

`round2PromptFor` takes a pass scope: the proposal ids in scope (nil for all) and whether the pass asks for picks.
Proposals out of scope are still listed by title, marked as already reviewed, so picks can name any of them. A pass that
asks no picks leaves `c.Picks` alone; `applyPicks` runs only on a pass that asked for them.

An early pass asks for picks only when, as it starts, every seat's round 1 and claim checks are done (nothing is still
unsettled). The barrier is that moment. At the barrier, a proposal whose checker failed round 1 is routed again, then
`routePending` runs (so a catch-up reads the person's routed asks). Each seat then runs a catch-up pass when its earlier
passes left anything: proposals it has not seen at all, proposals routed to it that it saw only as a title (a re-route
at the barrier), or the person's open asks. The scope is those. The catch-up asks for picks when the seat has given
none. A seat whose early pass saw everything settled and that has nothing left runs no catch-up. Both passes save
replies with `Round: 2`; `applyRound2`'s one-stance-per-proposal rule in round 2 keeps a catch-up from repeating a
stance. `markAnswered` and `checkMemory` run after the catch-ups.

`c.Round` becomes 2 when the first seat starts its early pass (the person's call, 2026-11-05): the live view switches to
cross-review as soon as reviews start, and a seat still in round 1 shows on its avatar's activity. Live agent seats run
round 2 after the barrier, as today, with the routed split. In a council of three rounds, round 3 runs `replyPass` as
today after the catch-ups, with the challenged-in-full split. Councils that pause, and every Brainstorm, keep today's
flow unchanged.

**Lean synthesis shape.** A Review's coordinator returns `answer`, `text`, `directions` (`rank`, `title`, `reasoning`,
`firststep`, `from`), `kept` (`title`, one-line `reasoning`, `from`), `asks` and `weak`: no `stances`, `agreed` or
`outcomes`. A Brainstorm's returns the same minus `firststep`'s requirement, plus its `kept` wild ideas. `ParseSynthesis`
still reads `stances`, `agreed` and `outcomes` when present (an older model reply or a test), but Go's fill overwrites
them. The `CouncilSummary` wire type does not change, so old reports render as they are.

**Go's fill** (a new `pkg/council/fill.go`, called from `cleanSummary`, both modes). For each direction and kept item:
each panel seat other than the authors of its `from` proposals takes its strongest stance among its round 2+ replies on
those proposals (oppose > challenge > accept; a seat with none has no stance); `agreed` is true when none is challenge
or oppose. Outcomes: the first proposal of direction N is "Direction N", the others "Merged into direction N"; a kept
item's proposals are "Also raised" (Review) or "Kept aside" (Brainstorm); then "Withdrawn in round R" and "Cut at the
pause" as today. A Review proposal that is sent, not cut and not withdrawn and that the coordinator put nowhere is added
to the end of `kept` as its own line (its title and its argument's first sentence); a Brainstorm's is "Not picked". The
fill runs after the evidence gate, so outcomes match the final ranks.

**Evidence gate** (Review only). A direction's label is its best member's (Ran > Read code > Guess > Disproved); an
empty label (checks did not run) does not gate. Each Guess or Disproved direction in the top moves, in its order, to
the head of `kept`; the top keeps the rest, renumbered from 1, and may hold fewer than 5. `maxDirections` becomes a
function of the mode: 5 for a Review, 3 for a Brainstorm.

**Report view.** The directions show in full as today; the `kept` section (Also raised, or Wild ideas kept aside) is
folded by default behind its heading and count, and opens on a click. An older report (3 directions,
coordinator-written stances) renders the same way.

`HarnessVersion` bumps once per task that changes a prompt.

## Testing

- Go: routing (named checker, fallback on none, unknown or self, load balance); `round2PromptFor` writes full text only
  for routed proposals and title plus one line for the rest; per-seat claim checks run before an early round 2 reads a
  proposal; a council holding drafts keeps the barrier; Go-filled stances, `agreed` and outcomes for plain and merged
  directions; the evidence gate moves a Guess or Disproved direction out of the top 5; the pre-read honours its caps.
- Frontend: the report model shows 5 directions for a Review and 3 for a Brainstorm and folds the rest; an old report
  still renders (vitest on the model).
- CDP: a council report scenario shows the top in full and the rest folded.
