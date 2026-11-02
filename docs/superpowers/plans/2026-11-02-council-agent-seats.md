# Council: an agent seats the chats you name — plan

**Spec:** `docs/superpowers/specs/2026-11-02-council-agent-seats-design.md` (its "Implementation" section holds the
decisions each task builds; read it first)
**Verify:** `node scripts/verify.mjs ./pkg/council/... ./pkg/wshrpc/... ./cmd/wsh/...`
**Check:** `go vet ./pkg/council/... ./pkg/wshrpc/... ./cmd/wsh/...`

Go is the source of truth for the wire: never hand-edit `frontend/types/gotypes.d.ts`, run `task generate`. On Windows
run a Go test as `CGO_ENABLED=1 CC="zig cc -target x86_64-windows-gnu" go test ./pkg/x -run '<names>'` (Bash), or the
sqlite store panics. Work by: simple and direct, one source of truth, no abstraction for a single use, errors handled
at the boundary and never swallowed.

### Task 1: The record field and the wire fields
**Depends on:** none
**Model:** sonnet
**Files:** `pkg/council/types.go`, `pkg/wshrpc/wshrpctypes_council.go`, `frontend/types/gotypes.d.ts`

The interface the other tasks build on; no behaviour yet.

- `Council` (`pkg/council/types.go`) gains `ByAgent bool \`json:"byagent,omitempty"\``, commented: started by
  `wsh council start`; such a council never holds an answer as a draft, agents seated or not.
- `CommandCouncilStartData` gains `Agents []string \`json:"agents,omitempty"\`` (live tabs to seat: tab ids or unique
  prefixes, in seat order; wavesrv resolves them and seats them before the role experts) and
  `ByAgent bool \`json:"byagent,omitempty"\``; `CommandCouncilEstimateData` gains the same `Agents`. Update both
  types' doc comments (the start's "a council with one holds every answer as a draft" now excepts `ByAgent`).
- Run `task generate`; only `frontend/types/gotypes.d.ts` should change among generated files.

Acceptance: `go build ./pkg/... ./cmd/...` passes; `task generate` run twice leaves no diff.

### Task 2: The no-hold rule, the two groups and the seat prompt
**Depends on:** Task 1
**Model:** sonnet
**Files:** `pkg/council/types.go`, `pkg/council/types_test.go`, `pkg/council/runner.go`, `pkg/council/runner_test.go`, `pkg/council/roles.go`, `pkg/council/roles_test.go`, `pkg/council/prompts.go`, `pkg/council/prompts_test.go`

- Add `HoldsDrafts(c *Council) bool` beside `HasAgents` in `types.go`: `HasAgents(c) && !c.ByAgent`. Use it in place of
  `HasAgents` exactly where the runner decides on holding: `heldFor`, the `held` of `roundsWork`, and `heldRoundAfter`
  (`runner.go`); fix their comments. Leave every other `HasAgents` use (`beginFresh`'s Rounds, the estimate, the picks
  wording) as it is. With `ByAgent`, `--pause` pauses after round 1 as for an expert-only council.
- Add the built-in groups after the three that ship: `{Id: "agents", Name: "Chats with a Skeptic", Roles:
  ["skeptic"], Coordinator: "coordinator"}` and `{Id: "agents-ideas", Name: "Chats with a Contrarian", Roles:
  ["contrarian"], Coordinator: "facilitator"}`; update the comment ("the five groups that ship") and the three
  `len(Groups()) != 3` checks in `roles_test.go`.
- `AgentFirstPrompt` (`prompts.go`): keep "Nothing you say reaches the others until the person sends it, and they may
  edit or drop it first." only when `HoldsDrafts(c)`; otherwise say what the seat says reaches the others as it writes
  it, and that the person is in the room and may post or @ a seat. Keep the rest of the paragraph.
- `Runner.Suggest` (`runner.go`) leaves `agents` and `agents-ideas` out of the groups it passes to `suggestPrompt` and
  `parseSuggestion`, so Setup's suggestion never offers or accepts them (with no chat seated they are a panel of one).
  `Groups()` itself still lists them, so Setup's picker does.

Tests (new, focused; name them as below):
- `TestHoldsDrafts`: no agents → false; agents → true; agents + `ByAgent` → false.
- `TestAgentCouncilByAgentHoldsNothing` (runner_test, with the fake agent caller the existing agent-council tests use):
  a `ByAgent` council with an agent seat runs round 1, the reply pass and the synthesis to done with no draft held and
  never stops awaiting-you; the same council `Record`ed as not-run and then started with `StartSaved` does the same; the
  same council without `ByAgent` still stops awaiting-you at round 1 with drafts held (reuse or extend the existing
  held-draft test rather than duplicating it).
- `TestSuggestLeavesOutAgentGroups`: the suggestion prompt names neither group, and a reply naming `agents` comes back
  with an empty group.
- `TestAgentsGroups` (roles_test): `ExpertsFor("agents")` is Skeptic then the coordinator; `ExpertsFor("agents-ideas")`
  is Contrarian then the Facilitator.
- `TestAgentFirstPromptSaysWhetherDraftsAreHeld` (prompts_test): the held wording with `ByAgent` false, the sent wording
  with it true.

### Task 3: wavesrv seats the named tabs
**Depends on:** Task 1 (uses the Agents and ByAgent wire fields it adds)
**Model:** sonnet
**Files:** `pkg/wshrpc/wshserver/wshserver_councilagents.go`, `pkg/wshrpc/wshserver/wshserver_councilagents_test.go`, `pkg/wshrpc/wshserver/wshserver_council.go`, `pkg/wshrpc/wshserver/wshserver_council_test.go`

- In `wshserver_councilagents.go`, one function resolves `Agents` into seats from one roster load
  (`loadAgentRosterFacts` + `buildAgentRoster`, `resolveAgentTab`, `seatHarnesses`, `seatContext`, as
  `liveAgentLink.find` and `Seat` already use): each seat `CouncilExpert{Id: "agent-<tabid>", Name: <row name>,
  Agent: <tabid>, Harness: <row harness>, Context: seatContext(...)}`, in the order given, a tab named twice (by id or
  prefix) seated once. A name that resolves to no live tab, to several, or to a harness other than claude or pi fails
  the whole call: the error names the id and why, then lists every live claude and pi tab, one per line, as short id,
  project and title (the columns `wsh agents list --all` prints).
- `CouncilEstimateCommand` (new-council branch) and `CouncilStartCommand` call it when `Agents` is set and put the
  seats in front of the experts sent (the coordinator stays last). `CouncilStartCommand` copies `data.ByAgent` onto the
  council, for a run and for `NotRun`'s `Record` alike. An empty `Agents` changes nothing.

Tests (new, focused, with the roster fixtures `wshserver_councilagents_test.go` already builds):
- `TestCouncilAgentSeatsResolve`: an id and a unique prefix resolve to seats with the tab's name, harness and context;
  a tab named twice sits once; a seat from another project is accepted.
- `TestCouncilAgentSeatsRefuseAndList`: an unknown id, an ambiguous prefix and a non-claude/pi tab each fail, and the
  error lists the live claude and pi tabs.
- `TestCouncilStartSeatsAgentsAndRecordsByAgent` (wshserver_council_test): a start with `Agents` and `ByAgent` saves the
  seats first, the coordinator last, and `ByAgent` true; a `NotRun` start keeps `ByAgent`; a bad id saves nothing.
- `TestCouncilEstimatePricesAgentSeats`: an estimate with `Agents` counts each seat's context per round (as
  `council.Estimate` does for a seat with `Context`).

### Task 4: `wsh council start` / `estimate` take `--agent` and `--expert`
**Depends on:** Task 1 (uses the Agents and ByAgent wire fields it adds)
**Model:** sonnet
**Files:** `cmd/wsh/cmd/wshcmd-council.go`, `cmd/wsh/cmd/wshcmd-council_test.go`

- `--agent <tab>` (repeatable `StringArray`) and `--expert <role id>` (repeatable) on `start` and `estimate`, in
  `addCouncilPanelFlags`. `--agent self` becomes `getTabIdFromEnv()`; empty there fails with "--agent self runs only
  inside an agent's terminal". The agents go to wavesrv as `Agents` on both the estimate and the start request, so a bad
  id fails at the estimate in `councilPrepare`, before `tokengateDecide`, and wsh prints wavesrv's error as it comes.
- `councilGroupFor(group, mode, withAgents)`: an explicit `--group` wins; with agents, `agents` for review and
  `agents-ideas` for brainstorm; else today's groups. `--expert` ids are added from the roles answer before the
  coordinator, in the order given; an unknown id, one already in the panel, or a role with `Coordinator` set
  (`coordinator`, `areachair`, `facilitator`) fails, listing only the role ids it takes.
- The start request always carries `ByAgent: true`.
- The gate's agent count, asked before the start, is `len(agents)` plus the role experts. The started line is printed
  after `CouncilStartCommand` returns, so it counts the chats from the returned council's `Experts`
  (`council.IsAgent`; a tab named twice sits once) and names the role experts from them too. With chats seated it
  reads `council <id> started: <feature> · <mode> · <group name> · 2 chats + Skeptic · ≈ N calls · ~X tokens` (one
  chat: `1 chat`; role names joined with `, `), N and X from the estimate; without chats it is unchanged.
- `councilGroupFor` and `councilStartedLine` change signature: update their existing calls in
  `wshcmd-council_test.go` (around lines 116, 369 and 374).
- Update the `start` and `estimate` `Long` help: `--agent`, `--agent self`, `--expert`, the groups with agents, and that
  a council `wsh council start` starts never holds drafts.

Tests (new, focused, pure functions in `wshcmd-council_test.go`):
- `TestCouncilGroupForAgents`: review / brainstorm / explicit group, with and without agents.
- `TestCouncilAgentFlags`: `self` resolves from `WAVETERM_TABID`, fails without it; ids pass through in order.
- `TestCouncilExpertFlag`: a known role lands before the coordinator; unknown, repeated and coordinator ids fail
  listing the usable roles.
- `TestCouncilStartedLineWithChats`: takes a returned council and an estimate; one chat, two chats with Skeptic, and
  the unchanged line with no chat; N and X come from the estimate passed, not hard-coded.
- `TestCouncilStartDataByAgent`: the start request carries `ByAgent` and `Agents`.

### Task 5: The skill, the changelog and the hand check
**Depends on:** none
**Model:** sonnet
**Files:** `skills/council/SKILL.md`, `CHANGELOG.md`, `docs/open-issues.md`

- `skills/council/SKILL.md`, per the spec's "What the skill tells the agent": a section "Seating chats" — when the
  person names chats or tabs, pass each as `--agent <tab id>` (ids from `wsh agents list --all`), `--agent self` only
  when they name this chat ("this chat", "v5 này"); never summarise another tab into a file for the panel; with no chat
  named the council stays expert-only as today. `--expert <role>` only when the question needs a view no seat has, and
  say why in the started line; `start --expert <role>` is not `retry --expert <seat>`. With `--agent self`, run
  `wsh council wait <id> --timeout 0` with `run_in_background`, then end the turn and do no other work, so the tab reads
  idle (a working tab skips a round after 10 minutes); answer each council turn that arrives as a prompt, and sum up the
  report when the wait exits. If start fails on an id,
  ask the person with the list it printed; never start without a seat they named. A pi agent does not seat itself, and
  says so. Note that a council started this way holds no drafts. Keep the rest of the skill as it is; update the
  `--group` bullet for the `agents` / `agents-ideas` default.
- `CHANGELOG.md`: one `Added` line under the top `Unreleased` section (open one if the top has a date), for the user:
  an agent asked for a council on named chats now seats those chats, plus a Skeptic and a coordinator, and runs to the
  report without held drafts.
- `docs/open-issues.md` "0 · Waiting on a hand check": a `- [ ] (arcterm)` line — from a claude chat, ask for a council
  on "this chat + <another tab id>" → `wsh council start` runs with `--agent self --agent <id>`, both tabs answer each
  round in their own transcript, nothing is held, the starter's background wait brings the report; a wrong id fails
  before the Token burn card and lists the live tabs.

Acceptance: `npx vitest run frontend/app/cockpit/whatsnew.test.ts` passes with the new changelog line.
