# Kael sync (2026-11-19): Agent's edits, and the small fixes worth taking

Port two things from the kaeltran16 fork (`kael` remote; run `git fetch kael` first) added after the 11-13 sync
(`2026-11-13-kael-sync-engine-hardening-overview-design.md`, cut at `a8f0864d1`). `kael/main` is now at `581f8727b`
(2026-11-19 16:30), 403 non-merge commits later. Boards has its own spec (`2026-11-19-kael-boards-design.md`).

As before, nothing merges: read a commit with `git show <hash>`, a file at the fork's tip with
`git show kael/main:<path>`, and port the behaviour into `main`'s shape. `git cherry-pick -n` only where it applies
cleanly, which here means the new Go package and little else: `main`'s Diff surface has drifted far from the fork's
(`filessurface.tsx` 1,000+ lines apart, `diffscope.ts` 180).

Not taken from this window, and why, so the next sync does not re-read them: the fork's Rendered view, transcript
cards, `@`/`/`/`!` box and mid-turn queue (its specs say they port from `ttqteo/arcterm`, i.e. from us); the workspace
pane beside the transcript (File, Changes, Run, Brainstorm, Canvas tabs: `main` swaps panes in place instead) and its
`GitPatchCommand` and Changes tab Expand all; memgate pause/resume of job trees (the fork itself retreated from it in
`2026-11-13-memgate-fragility-design.md`; `main` gates through `pkg/jobqueue`); the plan-skill bench and slim
superpowers (no verdict yet); pi in the Rendered view (deferred); `d96b53215` (numstat failure in ref mode: `main`
already carries `NumstatError` there, `pkg/gitinfo/gitinfo.go:197`); `eb56a4a17` (composer draft across switches:
`main` keeps drafts per agent, `agentcomposer.tsx:125`).

## Part 1: Agent's edits

Fork spec: `git show kael/main:docs/superpowers/specs/2026-11-18-agent-edits-range-design.md`. It is the design;
this section only records what changes for `main`.

### Problem on main

A Claude agent's Diff scope is fixed to "Since session start" (`defaultRangeFor`, `diffscope.ts:113`): the
working tree against the commit at session start. In the shared checkout that also lists the person's edits, other
sessions' edits and generated output. The same read feeds the agent card's counts (`cardgitstore.ts:65`), the Agent
details rail (`railstore.ts:184`) and the Hub peek (`jarvis/peek/peekagent.tsx:45`), so a fresh agent shows other
sessions' uncommitted work as its own.

### Backend (port nearly as is)

- `pkg/agentedits` (`agentedits.go`, `commits.go`, tests, `testdata/large.jsonl`, bench test): rebuild an agent's
  files from its transcript (file-history backups as pre-images, Edit/Write/MultiEdit calls applied in order, subagent
  transcripts included, Bash calls counted) and build the synthetic commits B and H with a private `GIT_INDEX_FILE`.
  Commits `b585ae766`, `08d349ded`, and the case fix `7951e1a15` (with `core.ignorecase`, a path spelled in another case
  maps onto the anchor tree's entry). Only stdlib imports.
- `GitAgentEditsCommand` in `pkg/wshrpc/wshrpctypes_git.go` (`CommandGitAgentEditsData`, `GitAgentEditFile`,
  `CommandGitAgentEditsRtnData`), served by `pkg/wshrpc/wshserver/wshserver_agentedits.go` with its cache keyed by cwd
  plus size and mtime of the transcript and each subagent transcript. Commits `86897a54e`, `08d349ded`, `7951e1a15`.
  It uses `gitinfo.CommitBefore`, which `main` has (`pkg/gitinfo/gitinfo.go:678`). Then `task generate`.

### Diff surface (rewrite for main)

Decided with the person (2026-11-19):

- **Default plus a switch.** A Claude agent's scope opens on **Agent's edits**. The Diff surface gains a two-state
  switch for an agent scope, Agent's edits / Since session start; it shows only for a Claude agent (a pi, codex or
  other agent writes no file-history backups, keeps the session range and shows no switch). Where the switch sits is
  the builder's call within `DESIGN.md`, near the scope's own row in the history pane, existing tokens only. The choice
  is per agent and survives a surface switch (a per-agent jotai atom, since every surface but Agent unmounts).
- `diffscope.ts`: `DiffRange` gains `{ kind: "edits"; agentId }` (key `edits:<agentId>`); the agent origin carries its
  runtime (absent = claude) so `defaultRangeFor` can pick edits for Claude only; `historyOptsFor` gives the edits
  range no commit list (B and H are synthetic) and the scope row the label "Agent's edits"; `measuredAgainst` says "by
  this agent". Every exhaustive switch over range kinds gets its case; tsc names them.
- `filesstore.ts` `resolveRangeOpts`: the edits range asks `GitAgentEditsCommand` (with the history RPC timeout the
  other Diff reads use), then reads B..H like a landed run (`{ ref: base, end }`). An empty base lists nothing and keeps
  the folder's branch facts; its `reason` is the caption. The 10 s poll re-asks (the backend cache makes an unchanged
  transcript free).
- The file list marks **approximate** (no backup, pre-image taken from the session-start commit) and **changed
  outside this agent** (an Edit's `old_string` no longer matched) files. The caption gives the file count and, when
  `bashcalls > 0`, "N Bash calls may have changed files not shown".
- The commit pane's heading for the scope's own row reads "Agent's edits", not "Working tree" (fork `d30a0310f`).

Reference: fork commit `931cb350a` (the frontend half) and `d30a0310f`; take the logic, not the files.

### The agent's counts elsewhere (decided: in this port)

Fork commit `fd40f2cf3`: one shared read, `agentchanges.ts`, that for a Claude agent asks `GitAgentEditsCommand` and
reads only B..H (nothing until the agent edits); other runtimes keep the session-start read. On `main` its readers
are `cardgitstore.ts` (card counts), `railstore.ts` (Agent details rail; its `branchbase` read stays as is) and
`peekagent.tsx` (Hub peek). The fork's hunk that stops a chip and card saying "repo" in a shared checkout
(`agentrailmodel.ts`/`agentrow.tsx`) has no counterpart on `main`, which has no such prefix: nothing to port. Leave
the fork's workspace-pane and `GitPatchCommand` hunks of that commit out too. `docreviewload.ts`'s session-start read
stays: it reads one file's text for a doc review, not the agent's files or counts.

### Verification

- Go: the fork's `pkg/agentedits` tests and `wshserver_agentedits_test.go` (create, edit chain, `replace_all`, missing
  backup, foreign edit between two edits, subagent edit, path outside the repo, both file-history record shapes,
  case mapping, B..H built in a temp repo lists exactly the agent's files).
- Frontend unit tests beside each model: range key and default by runtime, `historyOptsFor`, caption wording,
  `resolveRangeOpts` for the edits range (empty base, flags), the shared count read.
- CDP: a scenario opening a Claude agent's Diff on Agent's edits from a fixture transcript, showing a flagged file, the
  Bash caption and the commit pane heading, then flipping the switch to Since session start and back; a step showing a
  fixture agent card with its own counts. The fork's `scripts/cdp/scenarios-files-edits.mjs` is the reference.
- `CHANGELOG.md` under Unreleased: one `Added` line for Agent's edits, marked `<!-- big -->` with its
  `<!-- shot: ... -->`, and one `Changed` line for the cards counting only the agent's own edits. The picture is taken
  by the CDP scenario during Final (`h.whatsnewShot("agent-edits", …)`); the line lands as `<!-- shot: none -->` and
  the run's lead commits the picture and the shot comment at wrap-up (as the Boards run did).

## Part 2: the small fixes

Each one was checked against `main` on 2026-11-19; "present" means the bug's code is still there. Port the behaviour
with its test; most need a rewrite because the surrounding file drifted.

1. **A timed-out git reads as "no upstream" or "detached"** (fork `1350f04cd`). On Windows a git killed at its
   context deadline exits 1, the code git uses for "no such ref". Present on `main` in `pkg/gitinfo/gitinfo.go`:
   `upstreamCounts` (:68) returns no upstream on any error, so `Push` (:1748) then publishes with `push -u origin`;
   `Push`'s branch read reports "HEAD is detached" on a timeout; `Pull` (:1729) reports "no upstream". Add the fork's
   `gitFault(ctx, err)` (`ctx.Err() != nil || exitCodeOf(err) <= 0`) and return the git error on a fault in those
   three. Test with a fake git on PATH that hangs one chosen call (the fork's `remote_test.go` does this).
2. **The config watcher misses a write** (fork `88d73b831`). On Windows a config file just replaced by a rename can
   refuse the open ("used by another process"), which drops that file's part from the broadcast config until the next
   change. Present on `main` (`pkg/wconfig/filewatcher.go` has `Reload` but no retry). Port `readFullConfigSettled`
   (retry an open failure up to 1 s, a parse error not retried) and the 100 ms settle re-read that broadcasts only
   when the config changed. Keep `main`'s `reloadMu` and `Reload`.
3. **Sessions under-count tokens of a session that ran subagents** (fork `e7e3bb14a`). `pkg/agentsessions` sums the
   main transcript only (`TokensTotal`, :238) while the Agent details rail bills `<session>/subagents/*.jsonl` too
   (the fork measured 14.8M vs 129.1M on one session). Move the per-message dedupe into one helper and add the
   subagent files' totals for the claude provider. Pi children unchanged.
4. **The run sheet re-parses report markdown every second** (fork `3fe6d645a`). `runsheet.tsx:180` re-renders on the
   1 s `nowAtom` tick and `PlainInlineMarkdown` re-runs react-markdown each render. Memoize `PlainInlineMarkdown`
   (`frontend/app/view/agents/plaininlinemarkdown.tsx`, identical on both sides) and `RunReportView`
   (`frontend/app/view/jarvis/runreportview.tsx`). Check first that `main`'s callers pass stable props.
5. **An effort sync loses a field only the older side changed** (fork `2e9d949e5`). Present: `MergeEffort`
   (`pkg/wavevault/effortmerge.go:49-57`) takes every scalar from the side with the newer `UpdatedTs`. Merge Title,
   Project, Ticket, Status, ParentOID and Meta (and a chunk's Status, Stage, Owner) per field against the base;
   both changed takes the newer side, tie ours; no base keeps the newer-side rule. The fork's Jira field does not exist
   on `main`'s `waveobj.Effort`, so its Jira rule is not ported.
6. **A left-over vault merge blocks every later sync** (fork `381f06723`). Present: `pkg/wavevault/sync.go:99-100` runs
   `git merge --abort`, which exits 128 once a cleanly staged path was edited. Port the fork's recovery: save every
   stage-0 path whose worktree differs from the index (deletions included, unmerged paths skipped), `reset --hard`,
   write the saved content back, then the normal commit, merge and resolve path.
7. **A session opened with `!` is titled with raw tags** (fork `4cb230b79`). Likely present: nothing in `pkg/agentsessions`,
   `humanprompts.go` or `wshcmd-agenthook.go` knows `<bash-input>` / `<bash-stdout>`. Write the test first (a
   transcript whose first user records are a `!` command); if it fails on `main`, port: the first typed prompt names the
   session, `! <command>` until there is one, shell output never a title, started text or prompt.

Verify for part 2: `node scripts/verify.mjs ./pkg/gitinfo ./pkg/wconfig ./pkg/agentsessions ./pkg/wavevault
./cmd/wsh/cmd` and the vitest files beside 4. `CHANGELOG.md` `Fixed` lines for 1, 3, 5, 6 and 7 (the person notices
those); 2 and 4 are internal.

## Hand checks

A change not tried in the app adds a `docs/hand-checks.md` line titled "(arcterm) Kael sync 11-19: …". Agent's edits
in particular wants one: two Claude agents editing the same checkout, each Diff listing only its own files.
