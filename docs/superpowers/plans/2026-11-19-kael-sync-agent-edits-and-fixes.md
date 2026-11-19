# Kael sync 11-19: Agent's edits and the small fixes, Implementation Plan

**Goal:** a Claude agent's Diff opens on "Agent's edits" (only the files that agent itself changed, rebuilt from its
transcript), with a switch back to "Since session start"; its card, details rail and Hub peek count only its own edits;
and seven small fixes from the kaeltran16 fork land (git timeout, config watcher, subagent tokens, run-sheet re-parse,
effort merge, vault merge recovery, `!` session titles).

**Architecture:** the backend half of Agent's edits is the fork's `pkg/agentedits` and `GitAgentEditsCommand`, ported
nearly as is: it replays the transcript's Edit/Write/MultiEdit calls over Claude Code's file-history backups and builds
two synthetic commits B and H, so the Diff surface reads B..H through the bounded read a landed run already uses. The
frontend half is rewritten for `main`'s Diff surface, which has drifted far from the fork's. The interface (wire types,
a stub command, the `editsApply` rule) lands first so the backend and the Diff surface build beside each other. The
seven fixes are independent tasks in their own packages.

**Tech stack:** Go (`pkg/agentedits`, `pkg/gitinfo`, `pkg/wconfig`, `pkg/agentsessions`, `pkg/wavevault`,
`pkg/wshrpc`), React 19 + jotai + Tailwind 4, vitest, CDP scenarios.

**Spec:** `docs/superpowers/specs/2026-11-19-kael-sync-agent-edits-and-fixes-design.md` — read it before your task. The
fork's own design for Agent's edits is `git show kael/main:docs/superpowers/specs/2026-11-18-agent-edits-range-design.md`.
**Verify:** `node scripts/verify.mjs ./pkg/agentedits ./pkg/gitinfo ./pkg/wconfig ./pkg/agentsessions ./pkg/wavevault ./pkg/wshrpc/... ./cmd/wsh/cmd`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs diff-agent-edits diff-scope diff-compare-refresh diff-comments diff-file-keys diff-file-states kael-keys diff-log-tab diff-compare diff-review-marks diff-worktrees agent-rail-file-link run-sheet-done`

Working rules for every task: prefer simple, direct code (KISS, YAGNI, DRY, one source of truth); no abstraction for a
single implementation; handle errors at boundaries and never swallow one silently (log it or return it). Colors come
from `@theme` tokens only (`DESIGN.md`). Pure logic goes in a `foo.ts` with a `foo.test.ts` beside it; no jsdom render
tests. Never hand-edit generated files: change the Go types and run `task generate`. Go tests on Windows need
`CGO_ENABLED=1 CC="zig cc -target x86_64-windows-gnu"` in front (Bash). The fork is the `kael` remote: run
`git fetch kael` once, then read its code with `git show kael/main:<path>` or `git show <hash>`. Port behaviour into
`main`'s shape; never merge `kael/main`. Commit with the files named (`git commit -- <paths>`), no attribution trailer.
`CHANGELOG.md` and `docs/hand-checks.md` belong to Task 10 only: no other task edits them.

### Task 1: Agent's edits interface: wire types, stub command, the runtime rule
**Depends on:** none
**Model:** sonnet
**Files:** `pkg/wshrpc/wshrpctypes_git.go`, `pkg/wshrpc/wshserver/wshserver_agentedits.go`, `pkg/wshrpc/wshclient/wshclient.go`, `frontend/app/store/wshclientapi.ts`, `frontend/types/gotypes.d.ts`, `pkg/agentedits/doc.go`, `frontend/app/view/agents/agentedits.ts`, `frontend/app/view/agents/agentedits.test.ts`

Land the interface Tasks 2, 3 and 4 build on, small and first. Fork reference: commit `86897a54e`.

**Step 1:** add to the `GitCommands` interface in `pkg/wshrpc/wshrpctypes_git.go`:

```go
	GitAgentEditsCommand(ctx context.Context, data CommandGitAgentEditsData) (*CommandGitAgentEditsRtnData, error)
```

and the types, verbatim from the fork:

```go
type CommandGitAgentEditsData struct {
	Cwd            string `json:"cwd"`
	TranscriptPath string `json:"transcriptpath"`
}

type GitAgentEditFile struct {
	Path string `json:"path"`           // cwd-relative, forward slashes
	Flag string `json:"flag,omitempty"` // "" | "approximate" | "outside"
}

// Base and End are synthetic commits (B and H) rebuilt from the agent's transcript, so the Diff surface
// can compare them like any two refs. An empty Base means there is nothing to show and Reason says why.
type CommandGitAgentEditsRtnData struct {
	Base      string             `json:"base"`
	End       string             `json:"end"`
	Files     []GitAgentEditFile `json:"files"`
	BashCalls int                `json:"bashcalls"`
	Reason    string             `json:"reason,omitempty"`
}
```

**Step 2:** create `pkg/wshrpc/wshserver/wshserver_agentedits.go` with a stub that returns
`&wshrpc.CommandGitAgentEditsRtnData{Reason: "Agent's edits are not built yet"}, nil` (Task 2 replaces the body), and
`pkg/agentedits/doc.go` holding only `package agentedits` and a one-paragraph doc comment saying what the package does
(it lets Verify name `./pkg/agentedits` before Task 2 fills it).

**Step 3:** run `task generate`; check that `GitAgentEditsCommand` appears in `frontend/app/store/wshclientapi.ts` and
`CommandGitAgentEditsRtnData` in `frontend/types/gotypes.d.ts`.

**Step 4:** write the failing test `frontend/app/view/agents/agentedits.test.ts`: `editsApply(undefined)` and
`editsApply("claude")` are true; `"pi"`, `"codex"`, `"agy"`, `"opencode"`, `"terminal"` are false. Run
`npx vitest run frontend/app/view/agents/agentedits.test.ts`: FAIL (no module).

**Step 5:** create `frontend/app/view/agents/agentedits.ts`:

```ts
// Agent's edits: the files one agent changed itself, rebuilt by the backend (GitAgentEditsCommand) from its
// transcript. Only Claude Code writes the file-history backups that rebuild needs, so only a claude agent has
// the range; the AgentVM's `agent` field is its runtime, absent meaning claude.
export function editsApply(runtime: string | undefined): boolean {
    return (runtime || "claude") === "claude";
}

export type EditFlag = "approximate" | "outside";
```

Run the test again: PASS.

**Step 6:** commit.

**Acceptance:** `task generate` leaves no diff after a second run; the vitest file passes; `go build ./pkg/...` passes.

### Task 2: Agent's edits backend: rebuild from the transcript, build B and H
**Depends on:** Task 1
**Model:** sonnet
**Files:** `pkg/agentedits/doc.go`, `pkg/agentedits/agentedits.go`, `pkg/agentedits/commits.go`, `pkg/agentedits/agentedits_test.go`, `pkg/agentedits/commits_test.go`, `pkg/agentedits/agentedits_bench_test.go`, `pkg/agentedits/testdata/large.jsonl`, `pkg/wshrpc/wshserver/wshserver_agentedits.go`, `pkg/wshrpc/wshserver/wshserver_agentedits_test.go`

Port the fork's package and the command's body. Fork commits, in order: `b585ae766` (replay), `08d349ded` (B and H,
the command, its cache), `7951e1a15` (map a path spelled in another case onto the anchor tree's entry when
`core.ignorecase` is true). The fork's tip files are the end state:
`git show kael/main:pkg/agentedits/<file>` and `git show kael/main:pkg/wshrpc/wshserver/wshserver_agentedits{,_test}.go`.

**Step 1:** copy the fork's tip versions of the four `pkg/agentedits` Go files and `testdata/large.jsonl`. Fold
`doc.go`'s comment into `agentedits.go`'s package comment and delete `doc.go`, or keep `doc.go` and drop the duplicate
comment; one package comment only. The package imports only the standard library.

**Step 2:** run `go test ./pkg/agentedits -run 'TestReplay|TestParse|TestFileHistoryDir|TestSubagentTranscripts|TestBuildCommits'`
(with the CGO prefix). Expected: PASS. A failure here is a porting error, since the package touches nothing of `main`'s.

**Step 3:** replace Task 1's stub with the fork's tip `wshserver_agentedits.go` and copy its test. It calls
`gitinfo.CommitBefore` (present on `main`, `pkg/gitinfo/gitinfo.go:678`); adapt only what `main`'s wshserver package
names differently (test server construction, helpers); read the compile errors rather than guessing.

**Step 4:** run `go test ./pkg/wshrpc/wshserver -run '^TestGitAgentEdits'`: PASS. The tests cover the reason on nothing
to show, cwd-relative paths from a subfolder, the cache until a transcript grows, the logged error, and both case rules.

**Step 5:** commit.

**Acceptance:** the two test runs above pass; the command logs one `agentedits:` line per call with the cache hit or
miss; nothing under `~/.claude` is written by the tests.

### Task 3: Agent's edits in the Diff surface, default for a Claude agent, with a switch
**Depends on:** Task 1 (uses `GitAgentEditsCommand`'s generated client and types, and `editsApply` from `agentedits.ts`)
**Model:** sonnet
**Files:** `frontend/app/view/agents/diffscope.ts`, `frontend/app/view/agents/diffscope.test.ts`, `frontend/app/view/agents/diffrangechoice.ts`, `frontend/app/view/agents/filesstore.ts`, `frontend/app/view/agents/filesstore.test.ts`, `frontend/app/view/agents/agentdiffnav.ts`, `frontend/app/view/agents/agentdiffnav.test.ts`, `frontend/app/view/agents/githistorystore.ts`, `frontend/app/view/agents/githistorystore.test.ts`, `frontend/app/view/agents/historyrows.ts`, `frontend/app/view/agents/historyrows.test.ts`, `frontend/app/view/agents/commitpane.tsx`, `frontend/app/view/agents/diffpanel.tsx`, `frontend/app/view/agents/changedfilelist.tsx`, `frontend/app/view/agents/filessurface.tsx`, `frontend/app/view/agents/diffsource.ts`, `frontend/app/view/agents/diffsource.test.ts`, `frontend/app/cockpit/actions/agent.ts`, `frontend/app/view/agents/agentdetailsrail.tsx`, `frontend/app/view/agents/chatconversation.tsx`, `frontend/app/view/agents/chatpane.tsx`, `frontend/app/view/agents/cockpitsurface.tsx`, `frontend/app/view/agents/filetab.tsx`, `scripts/cdp/scenarios-diff-agent-edits.mjs`, `scripts/cdp/scenarios.mjs`, `scripts/cdp/scenarios-diff-scope.mjs`, `scripts/cdp/scenarios-diff-comments.mjs`, `scripts/cdp/scenarios-diff-file-keys.mjs`, `scripts/cdp/scenarios-diff-states.mjs`, `scripts/cdp/scenarios-kael-keys.mjs`, `scripts/cdp/surfaces-spring/diff.mjs`, `scripts/cdp/overlays-frost/chat.mjs`

The spec's "Diff surface (rewrite for main)" section is the contract. Fork reference for the logic only: commits
`931cb350a` and `d30a0310f`, and `git show kael/main:scripts/cdp/scenarios-files-edits.mjs` for the fixture. `main`'s
Diff is one panel (a source dropdown over Commit | Log tabs) beside a wide diff, not the fork's history column: take the
logic, not the fork's files. Against Task 1's stub the command answers "nothing to show"; your unit tests mock the RPC,
and Final runs against the merged backend.

**Step 1 (pure model, test first):** in `diffscope.test.ts` add cases, then make them pass in `diffscope.ts`:
- `DiffRange` gains `{ kind: "edits"; agentId: string }`; `rangeKey` gives `edits:<agentId>`.
- The agent origin carries its runtime: `{ kind: "agent"; id: string; runtime?: string }`. `originKey` is unchanged (a
  runtime never changes an agent's identity).
- `defaultRangeFor(origin, choice?)`: for an agent, `editsApply(origin.runtime)` (from `./agentedits`) and
  `choice !== "session"` gives `edits`; anything else gives `session`. Project, worktree and run are unchanged.
- `historyOptsFor` for `edits`: `{ noCommits: true, rowLabel: "Agent's edits" }` (add `noCommits?: boolean` to
  `LoadHistoryOpts`: B and H are synthetic, so no git history read and only the scope's own row).
- `measuredAgainst` for `edits`: `"by this agent"`.
- A pure `editsCaption({ files, bashcalls, reason, hasBase })`: no base gives the reason, or `"no edits to show"`;
  otherwise `"<n> file(s) by this agent"` plus, when `bashcalls > 0`,
  `" · <n> Bash call(s) may have changed files not shown"` (singular for 1).
Run `npx vitest run frontend/app/view/agents/diffscope.test.ts`. Then run `task check:ts` and add the `edits` case to
every exhaustive switch it names.

**Step 2 (the choice survives a surface switch):** create `frontend/app/view/agents/diffrangechoice.ts`: a module-level
jotai atom `Record<agentId, "edits" | "session">` with `rangeChoiceFor(id)` and `setRangeChoice(id, choice)` (the Diff
surface unmounts on every switch, so `useState` would lose it). `agentDiffScope(agentId, label, runtime?)` in
`agentdiffnav.ts` passes `{ kind: "agent", id, runtime }` and `rangeChoiceFor(agentId)` to `defaultRangeFor`. Test it in
`agentdiffnav.test.ts` (claude default edits; claude with choice session; pi always session).

**Step 3 (callers pass the runtime):** every `agentDiffScope(` call passes the agent's `agent` field (the AgentVM's
runtime): `cockpit/actions/agent.ts`, `agentdetailsrail.tsx` (two), `chatconversation.tsx`, `chatpane.tsx` (two),
`cockpitsurface.tsx`, `filessurface.tsx` (two), `filetab.tsx`. Grep `agentDiffScope(` again after; none may be left
without it where the agent is in reach.

**Step 4 (the read, test first):** in `filesstore.test.ts` mock `RpcApi.GitAgentEditsCommand` and
`RpcApi.GitChangesCommand` and cover: a base and end read `GitChangesCommand` with `{ ref: base, end }`; the reply's
flags land in `FilesState.edits` (`{ flags: Record<path, EditFlag>, bashcalls, reason }`, keyed by the list's
cwd-relative path); an empty base lists no files (never the working tree the plain read returns) and keeps branch and
`isrepo`; the poll (`reloadChanges`) re-asks the command for the edits range. Then in `filesstore.ts`
`resolveRangeOpts` add the `edits` case: it needs the cwd, so resolve it inside the load as the fork's `editsOf` does,
calling the command with `{ timeout: HISTORY_RPC_TIMEOUT_MS }`. Run
`npx vitest run frontend/app/view/agents/filesstore.test.ts`.

**Step 5 (history pane):** `githistorystore.ts` honours `noCommits` (no git log call; only the scope's own row), and
`historyrows.ts` gives that row the label "Agent's edits". `buildRows` keeps the scope's own row when `noCommits` is
set even at 0 files (today it drops the working-tree row at 0 files, `historyrows.ts` `buildRows`; with no commits
either, the pane would fall to "Select a commit" and show no caption for an agent with no edits). Add a pure
`paneCaption(range, state)` in `historyrows.ts`: `editsCaption(...)` from `state.edits` for the edits range,
`worktreeCaption(...)` otherwise (`worktreeCaption`'s `default:` would otherwise swallow the edits range silently);
`diffpanel.tsx` (:303) calls `paneCaption` instead of `worktreeCaption`. Tests beside both, including the 0-file edits
row and the edits caption.

**Step 6 (the view):**
- `commitpane.tsx` `WorkingTreeHeader`: the region label reads "Agent's edits" instead of "Working tree" for the edits
  range (fork `d30a0310f`); its caption is the one `paneCaption` gives. Put `data-commit-pane` on the pane and
  `data-files-range-summary` on the caption.
- The switch lives in `diffpanel.tsx`, not in `WorkingTreeHeader` (that header draws only while the scope's own row is
  selected, so a selected commit in Since session start would hide the way back): a two-state segmented control
  "Agent's edits | Since session start" in a strip directly under the panel's 40 px header row, shown whenever the
  scope is an agent whose `editsApply(runtime)` holds, whatever row is selected and outside compare. Each button
  carries `data-range-choice="edits"` or `"session"` with `aria-pressed`; a click calls `setRangeChoice` and sets
  `model.diffScopeAtom` to the agent's scope with that range. Follow `DESIGN.md` for the control (existing tokens and
  an existing segmented-control look in the Diff surface if there is one).
- `changedfilelist.tsx`: a flagged row carries `data-edit-flag="approximate" | "outside"` and a small marker with a
  `title` ("No backup: compared with the session start" / "Changed outside this agent between its edits").

**Step 7 (scenario `diff-agent-edits`):** create `scripts/cdp/scenarios-diff-agent-edits.mjs` and register it in
`scripts/cdp/scenarios.mjs` beside `diffScopeScenarios`. Seed it as `scripts/cdp/scenarios-diff-scope.mjs` seeds its
fixture roster agent (a temp git repo, a transcript in a temp dir naming that repo as cwd), with the fork's fixture
cases: a Write of a new file with a `file-history-delta` record whose backup is null, an Edit of a file with no record
(approximate), two Edits of one file where the second `old_string` no longer matches (outside), one Bash call, and an
unrelated working-tree edit the agent never made. Nothing is written under `~/.claude`. Steps, each its own shot:
1. The agent's Diff opens on Agent's edits: the switch's `edits` button is pressed; the list is exactly the agent's
   three files (not the unrelated one); the outside and approximate rows carry their `data-edit-flag`; the caption
   says 3 files and 1 Bash call; the commit pane's label reads "Agent's edits". Take the What's new picture here:
   `await h.whatsnewShot("agent-edits", { selector: "[data-commit-pane]", pad: 200 })` (store the result in the step's
   detail; a failure to shoot does not fail the step).
2. Click Since session start: the list now includes the unrelated file.
3. Switch to another surface and back: Since session start is still pressed.
4. A second fixture agent whose transcript has no Edit or Write call: Agent's edits shows the "no edits" caption and an
   empty list.
5. A fixture agent with `agent: "pi"`: no switch, the range is Since session start.

**Step 8 (existing scenarios):** fixture Claude agents in older Diff scenarios get their files from writes to disk, not
from Edit calls in their transcripts, so they would now open on an empty Agent's edits. Check each of these (they
assert on `data-changed-file-row` lists): `scenarios-diff-scope.mjs` (`diff-scope`, `diff-compare-refresh`),
`scenarios-diff-comments.mjs` (`diff-comments`), `scenarios-diff-file-keys.mjs` (`diff-file-keys`),
`scenarios-diff-states.mjs` (`diff-file-states`), `scenarios-kael-keys.mjs` (`kael-keys`), in `scenarios.mjs`
`diff-log-tab`, `diff-compare`, `diff-review-marks`, `diff-worktrees` and `doc-review-canvas`, and
`surfaces-spring/diff.mjs`, `overlays-frost/chat.mjs`. Where one opens a Claude agent's Diff and asserts on its file
list, set its choice to `session` in its arrange (import `diffrangechoice.ts` through the page's module loader, as
`scenarios-diff-scope.mjs`'s `MOD_LIB` does) so it keeps testing what it tested; one on a project or run scope needs
nothing. Do not reseed them. List the scenarios you changed in your commit message; Final runs all the named Diff
ones (`doc-review-canvas` and the two overlay scenarios are not in Final: if you change one, run it yourself with
`task verify:ui -- <name>` and say so in your report).

**Step 9:** `task check:ts`, then the vitest files of this task. Commit.

**Acceptance:** `diff-agent-edits` steps 1-5 pass and their screenshots show the switch, the flagged rows and the
caption; step 4's screenshot shows the switch and the "no edits" caption; the Diff scenarios Step 8 names still pass.

### Task 4: An agent's card, rail and peek count only its own edits
**Depends on:** Task 3
**Model:** sonnet
**Files:** `frontend/app/view/agents/agentchanges.ts`, `frontend/app/view/agents/agentchanges.test.ts`, `frontend/app/view/agents/cardgitstore.ts`, `frontend/app/view/agents/cardgitstore.test.ts`, `frontend/app/view/agents/railstore.ts`, `frontend/app/view/agents/railstore.test.ts`, `frontend/app/view/agents/usecardstreams.ts`, `frontend/app/view/agents/agentdetailsrail.tsx`, `frontend/app/view/agents/cockpitsurface.tsx`, `frontend/app/view/jarvis/peek/peekagent.tsx`, `scripts/cdp/scenarios-diff-agent-edits.mjs`, `scripts/cdp/scenarios.mjs`

Depends on Task 3 because both edit `agentdetailsrail.tsx`, `cockpitsurface.tsx` and the new scenario. Fork reference:
commit `fd40f2cf3` (`git show fd40f2cf3 -- frontend/app/view/agents/agentchanges.ts` is the shared read); leave out its
workspace-pane, Changes-tab and `GitPatchCommand` hunks, which `main` does not have.

**Step 1 (test first):** `agentchanges.test.ts` with the RPCs mocked: a non-claude runtime calls `GitChangesCommand`
with `sessionstartts` only; a claude agent with a base reads `{ ref: base, end }`; a claude agent with no base returns
the plain read's branch and `isrepo` with an empty `statusz` and `numstat`. Then create `agentchanges.ts`
(`readAgentChanges(cwd, { transcriptPath, runtime }, startTs)`), as the fork's, importing `editsApply` from
`./agentedits`.

**Step 2:** route the three readers through it, threading the runtime from where each gets the agent:
`cardgitstore.ts` `refreshCardGit` / `scheduleCardGit` (callers in `usecardstreams.ts` and `cockpitsurface.tsx`),
`railstore.ts` `loadRailForAgent` (its `branchbase` read stays as it is; caller `agentdetailsrail.tsx`), and
`peekagent.tsx` `useAgentGit`. Where a reader keeps a `ref` for per-file diffs (the rail's `ref`), check what reads it
and give it the edits read's base and end so a click shows the same B..H the list came from. Update the readers' tests.

**Step 3:** add steps to `diff-agent-edits`, each its own shot:
- step 6: the edits fixture agent's cockpit card shows a diff count of its 3 files, not 4 (the unrelated file stays
  out). Find the card's diff pill selector in `cockpitsurface.tsx` / the card component and add a `data-` hook if it
  has none.
- step 7: the same agent's Agent details rail (open it with `railVisibleAtom`, as `scenarios-agent-streams.mjs` does)
  lists exactly its 3 files, not the unrelated one.
- step 8, the Hub peek: if an existing scenario helper opens an agent's peek, show it counting 3 files; if none does,
  leave the step out and name the peek under Not verified in your report.

**Step 4:** the card and the rail have no switch, so a scenario whose fixture Claude agent's card count or rail file
list came from files written to disk now reads nothing. Reseed those fixtures through Edit/Write records in the
fixture's transcript (with the file-history records the fork's fixture uses), so the agent's own edits are the files
the scenario expects. Known case: `agent-rail-file-link` in `scenarios.mjs` (asserts on the rail's file rows). Grep
`scripts/cdp/` for other asserts on `diffStatsByIdAtom` or the rail's file rows (`railVisibleAtom` users that only
toggle the rail, such as `agent-streams`, `agent-subagents`, `chat-council`, `chat-verdict-handoff`,
`brainstorm-builder`, assert nothing about files and need no change). List the scenarios you changed in the commit
message; one not in Final's list you run yourself with `task verify:ui -- <name>` and say so in your report.

**Step 5:** `task check:ts`, the vitest files above. Commit.

**Acceptance:** `diff-agent-edits` steps 6 and 7 pass and their shots show 3 files; `agent-rail-file-link` passes; the
readers' unit tests pass. `docreviewload.ts`'s session-start read stays as is: it reads one file's text at the session
start for a doc review, not the agent's file list or counts.

### Task 5: A timed-out git is an error, not "no upstream" or "detached"
**Depends on:** none
**Model:** sonnet
**Files:** `pkg/gitinfo/gitinfo.go`, `pkg/gitinfo/gitfault_test.go`

Fork reference: commit `1350f04cd` (its `remote.go` is `main`'s `gitinfo.go` here). On Windows a git killed at its
context deadline exits 1, the code git uses for "no such ref", so a timeout reads as a normal state.

**Step 1 (test first):** `pkg/gitinfo/gitfault_test.go`, modelled on the fork's `git show kael/main:pkg/gitinfo/remote_test.go`
(a fake `git` first on PATH that hangs one chosen call): `TestPushTimedOutBranchReadIsAnError`,
`TestPushTimedOutUpstreamReadIsAnError` (must not run `push -u origin`), `TestPullTimedOutUpstreamReadIsAnError`, and
`TestUpstreamCountsNoUpstreamIsNotAnError` (a real repo with no upstream still pushes with `-u`). Run
`go test ./pkg/gitinfo -run 'TestPushTimedOut|TestPullTimedOut|TestUpstreamCountsNoUpstream'`: the timeout ones FAIL.

**Step 2:** in `pkg/gitinfo/gitinfo.go` add beside `exitCodeOf`:

```go
// gitFault reports a git call that did not answer: it never ran, or ctx ran out. A git killed at the
// deadline exits 1 on Windows, the code git uses for "no such ref", so the exit code alone cannot tell.
func gitFault(ctx context.Context, err error) bool {
	return ctx.Err() != nil || exitCodeOf(err) <= 0
}
```

and use it in `Push` (the branch read, :1751), `Pull` (the upstream read, :1729) and `upstreamCounts` (:68).
`upstreamCounts` gains an `error` return: on a fault it returns the git error; a real exit status (no upstream) keeps
today's empty upstream and a nil error. Its callers:
- `Push` and `Pull` report a fault the way they report every other git failure on `main`, as data:
  `return syncFailure(args, err), nil` (a `SyncResult.Failure` built by `failureOf`, with `args` the read that faulted),
  never "HEAD is detached" or "no upstream", and `Push` never goes on to `push -u origin`.
- `GetChanges` (:146) and the range read (:251) ignore the error and keep today's empty upstream and zero counts, so a
  slow upstream read never fails the Diff list; add a one-line comment saying so at each.

A real exit status keeps today's meaning everywhere.

**Step 3:** the tests pass. Commit.

**Acceptance:** the four tests pass; `TestPush*`/`TestPull*` tests already in `gitinfo_test.go` still pass
(`go test ./pkg/gitinfo -run 'TestPush|TestPull'`).

### Task 6: The config watcher re-reads a write its event read missed
**Depends on:** none
**Model:** sonnet
**Files:** `pkg/wconfig/filewatcher.go`, `pkg/wconfig/filewatcher_test.go`

Fork reference: commit `88d73b831` (the Go half; its CDP edits are not ours). On Windows a config file just replaced by
a rename can refuse the open ("used by another process"), which drops that file's part of the config until the next
change.

**Step 1 (test first):** in `filewatcher_test.go`, `TestReadFullConfigSettledRetriesAnOpenFailure` (a read func that
reports an open failure in `ConfigErrors` twice, then succeeds: the result is the third read),
`TestReadFullConfigSettledGivesUpAfterTheDeadline`, and `TestReadFullConfigSettledDoesNotRetryAParseError`. Take the
fork's tests as the model (`git show 88d73b831 -- pkg/wconfig/filewatcher_test.go`). Run
`go test ./pkg/wconfig -run 'TestReadFullConfigSettled'`: FAIL.

**Step 2:** port `readFullConfigSettled`, `hasOpenFailure`, the constants and the settle re-read
(`handleEvent` reports whether it read; the `Start` loop arms a 100 ms timer and calls `rereadIfChanged`, which
broadcasts only when the config differs). Keep `main`'s `reloadMu` and `Reload` (not in the fork): `Reload` uses
`readFullConfigSettled(ReadFullConfig)` and `rereadIfChanged` takes `reloadMu` too.

**Step 3:** tests pass, plus the file's existing tests (`go test ./pkg/wconfig -run 'Watcher|Reload|Settled'`). Commit.

### Task 7: Sessions: subagent tokens, and no raw `!` tags as a title
**Depends on:** none
**Model:** sonnet
**Files:** `pkg/agentsessions/agentsessions.go`, `pkg/agentsessions/humanprompts.go`, `pkg/agentsessions/extractsession_test.go`, `pkg/agentsessions/humanprompts_test.go`, `cmd/wsh/cmd/wshcmd-agenthook.go`, `cmd/wsh/cmd/wshcmd-agenthook_test.go`

Two fixes in one package, done in this order.

**Part A, subagent tokens** (fork `e7e3bb14a`). Sessions sums the main transcript only (`TokensTotal`,
`agentsessions.go:238`) while the details rail (`pkg/usagestats` `TranscriptUsage`) also bills
`<session>/subagents/*.jsonl`.
1. Test first in `extractsession_test.go`: `TestClaudeSessionTokensIncludeSubagents` (a parent transcript plus one
   subagent file; `TokensTotal` is their sum, a message id repeated across records counted once). FAIL.
2. Move the per-message usage dedupe into one helper (`claudeTokens`) and add the subagent files' totals for the claude
   provider through it, as the fork does. Pi unchanged.
3. `go test ./pkg/agentsessions -run 'TestClaudeSessionTokens'`: PASS.

**Part B, `!` titles** (fork `4cb230b79`). A `!` command writes two user records, `<bash-input>…</bash-input>` then
`<bash-stdout>…</bash-stdout><bash-stderr>…</bash-stderr>`.
1. Test first: `TestBashOpenedSessionTitle` (a transcript whose first user records are a `!` command, then a typed
   prompt: the session's title is the typed prompt, and before it `! <command>`; no title, started text or human prompt
   contains `<bash-`), and a `humanprompts_test.go` case that shell output is never a human prompt. Run them.
2. If they pass on `main`, the bug is not here: drop Part B, say so in the commit message, and do not edit
   `humanprompts.go` or `wshcmd-agenthook.go`. If they fail, port the fork's handling (`git show 4cb230b79`) into the
   session index, `HumanPrompts`, and the hook's no-ai-title fallback in `wshcmd-agenthook.go` (with a test in
   `wshcmd-agenthook_test.go`).

Commit once both parts are green: `go test ./pkg/agentsessions -run 'TestClaudeSessionTokens|TestBashOpened|HumanPrompts'`.

### Task 8: The run sheet stops re-parsing report markdown every second
**Depends on:** none
**Model:** sonnet
**Files:** `frontend/app/view/agents/plaininlinemarkdown.tsx`, `frontend/app/view/jarvis/runreportview.tsx`

Fork reference: commit `3fe6d645a`. `runsheet.tsx:180` re-renders on the 1 s `nowAtom` tick, and
`PlainInlineMarkdown` re-runs react-markdown with remark-gfm on every render.

**Step 1:** wrap `PlainInlineMarkdown` in `React.memo`. Grep its callers (`PlainInlineMarkdown` across `frontend/`):
each must pass stable props (module-level `components` objects, strings). A caller that builds a `components` object
inline defeats the memo: hoist it to module level in that caller only if it is a one-line move; otherwise leave it and
name it in the commit message.

**Step 2:** wrap `RunReportView` in `React.memo`; check `runsheet.tsx:262` passes it `model` and `run` only, neither
rebuilt per tick.

**Step 3:** `task check:ts`. Commit.

**Acceptance:** `run-sheet-done` passes (the report still renders). That the re-parse stopped is a code check, not a
measured one (there is no render-count harness): the commit message names each `PlainInlineMarkdown` and
`RunReportView` caller and why its props are stable across the 1 s tick, so the reviewer can check it.

### Task 9: Vault sync: per-field effort merge, and recovery from an interrupted merge
**Depends on:** none
**Model:** sonnet
**Files:** `pkg/wavevault/effortmerge.go`, `pkg/wavevault/effortmerge_test.go`, `pkg/wavevault/sync.go`, `pkg/wavevault/sync_test.go`

**Part A, per-field merge** (fork `2e9d949e5`). `MergeEffort` (`effortmerge.go:49-57`) takes every scalar from the side
with the newer `UpdatedTs`, so a field only the older side changed is lost.
1. Tests first in `effortmerge_test.go` (model: `git show 2e9d949e5 -- pkg/wavevault/effortmerge_test.go`): a field
   changed only on the older side survives; both changed takes the newer side, tie ours; a chunk's Status, Stage and
   Owner merge the same way; with no base (and a chunk new on both sides) the newer-side rule stays. FAIL.
2. Port the fork's per-field merge for Title, Project, Ticket, Status, ParentOID and Meta (Meta compared whole).
   `main`'s `waveobj.Effort` has no Jira field (`pkg/waveobj/wtype.go`), so leave out the fork's Jira handling and its
   test. `go test ./pkg/wavevault -run 'MergeEffort'`: PASS.

**Part B, interrupted merge** (fork `381f06723`). `sync.go:99-100` runs `git merge --abort`, which exits 128 once a
cleanly staged path was edited, so that sync and every later one fail.
1. Test first in `sync_test.go`: `TestSyncRecoversAnInterruptedMergeKeepingEdits` (leave a merge with MERGE_HEAD, edit a
   path it staged cleanly, sync: it succeeds, the edit is kept, no conflict markers are committed). FAIL.
2. Port the fork's recovery: when MERGE_HEAD exists, save every stage-0 path whose worktree differs from the index
   (deletions included), skipping the paths `git ls-files -u` lists, `reset --hard` HEAD, write the saved content back,
   then the normal commit, merge and resolve path. `go test ./pkg/wavevault -run 'TestSyncRecovers'`: PASS.

Commit.

### Task 10: CHANGELOG, What's new, hand checks and the Diff guide
**Depends on:** Task 4 (its line describes the counts Task 4 changed), Task 5 (describes its fix), Task 7 (describes its fixes, or leaves Part B out if it was dropped), Task 9 (describes its fixes)
**Model:** sonnet
**Files:** `CHANGELOG.md`, `docs/hand-checks.md`, `docs/guide/diff.md`

Task 4 already waits on Tasks 1 and 3, so this task runs last. Read each listed task's commit before writing its line.

**Step 1:** under `## Unreleased` in `CHANGELOG.md` (read the file's header for the line rules), written for the person:
- `### Added`: Agent's edits: a Claude agent's Diff now lists only the files it changed itself, rebuilt from its own
  edits, with a switch back to everything since its session started; files it could not rebuild exactly are marked,
  and Bash calls that may have changed other files are counted. End with `<!-- big --> <!-- shot: none -->`: the
  picture `diff-agent-edits` takes in Final is added by the lead after Final (see the last section), and `whatsnew.test.ts` fails a shot file
  that is not in `public/whatsnew/` yet.
- `### Changed`: an agent's card, details rail and Hub peek count only that agent's own edits in a shared checkout.
- `### Fixed`: a git that timed out no longer reads as "no upstream" (Push no longer publishes the branch anew);
  Sessions counts the tokens of subagents; a field only one side changed is no longer lost when the vault syncs an
  initiative; an interrupted vault merge no longer blocks every later sync; a session opened with `!` no longer takes
  the raw command tags as its title (only if Task 7 Part B landed).

**Step 2:** `docs/guide/diff.md`: where it describes "Since session start", add Agent's edits as a Claude agent's
default, the switch, the two file marks and the Bash caption, in the guide's own style.

**Step 3:** `docs/hand-checks.md`: lines titled "(arcterm) Kael sync 11-19: …" for: two Claude agents editing the same
checkout, each Diff listing only its own files; the switch keeping its choice across surfaces; a config file replaced
while arcterm runs (a project registered from a script) showing up without a restart.

**Step 4:** `npx vitest run frontend/app/cockpit/whatsnew.test.ts`. Commit.

## The What's new picture (the lead's wrap-up, after Final)

The run's lead owns this, at the run-finished wake before completing, as the Boards run did (`05341f99c`):
`diff-agent-edits` step 1 leaves `<version>-agent-edits.webp` in the Final output (or the run's tree). The lead copies
it to `public/whatsnew/`, checks it is under 120 KB and shows the switch and the flagged rows, changes the Added line's
`<!-- shot: none -->` to `<!-- shot: <that file> -->`, runs `npx vitest run frontend/app/cockpit/whatsnew.test.ts`, and
commits both. If Final took no picture, the line keeps `<!-- shot: none -->` and the lead files a chunk for it
(`node scripts/whatsnew-shot.mjs agent-edits --selector "[data-commit-pane]"` on a dev app showing the fixture).
