# Kael sync (2026-11-03): the fork's engine fixes and optimizations

**Verify:** `node scripts/verify.mjs ./pkg/orchestrate/... ./pkg/jarvis/... ./pkg/wshrpc/... ./cmd/wsh/...`
**Check:** `task check:ts && go vet ./pkg/orchestrate/... ./pkg/jarvis/... ./pkg/wshrpc/... ./cmd/wsh/...`
**Final:** `node scripts/cdp/final-verify.mjs final-rerun`

## Context for every task

The `kael` remote is `https://github.com/kaeltran16/waveterm.git`; `kael/main` is at `16b726ffd` (fetched
2026-11-03). Our last real merge of it is `a8020da45` (2026-10-19); the 2026-10-30 sync ported later commits by
hand, under different subjects. Read a commit with `git show <hash>`, a file at the fork's tip with
`git show kael/main:<path>`. The remote's refs are shared by every worktree.

Scope is the orchestrator engine only (`pkg/orchestrate`, its lead/worker prompts in `pkg/jarvis`, `wsh runs` /
`wsh jarvis dag`, and the run UI only where a ported engine change needs a control). Not in scope: remote mode,
Jira, sessions, Code, brainstorm, workflow scan, and the fork's dropping of the `Arc-Run`/`Arc-Task`/`Arc-Model`
commit trailers (`0db3b5bd7`, `d834c09f1`): keep our trailers.

**Port, don't cherry-pick blindly.** Our engine has diverged. For each commit: read it, check in our source whether
the bug or gap exists here (it may already be fixed under another name), and port the behaviour with its tests
(adapted) if it does. `git cherry-pick -n` is fine where it applies cleanly.

Rules: Go is the source of truth for wire types; change the Go and run `task generate`, never hand-edit
`frontend/types/gotypes.d.ts`, `frontend/app/store/wshclientapi.ts`, `pkg/wshrpc/wshclient/wshclient.go` or
`pkg/{waveobj,wconfig}/metaconsts.go`. Go tests on Windows need `CGO_ENABLED=1 CC="zig cc -target
x86_64-windows-gnu"` (Bash). A change a user would notice adds one line under `## Unreleased` in `CHANGELOG.md`.
Update `docs/guide/orchestrator.md` where a task changes what it describes. Each task's last commit message ends
with a table of every commit it looked at: ported / already here / not ours.

### Task 1: Rerun a failed final stage; a Check/Verify exit 3 or a killed command is not a verdict
**Depends on:** none

Commits: `feb854902` (rerun a failed final stage in the same round from `wsh runs rerun-final`, the run sheet, the
Final verification pane and the palette; in the final stage Check and Verify may exit 3 as unverified; the lead is
told to drop its fix plan; a run held only by the failed stage lands once the rerun passes; it adds the CDP
scenario `final-rerun`: keep it under that name, adapted to our run sheet), `36ecddae6` (a timed-out or killed
command is not read as a verdict on the code), `71620ec41` (a lead fixes every failing final step, one already
failing on the base included). We already have three final rounds and the human's grant of one more
(`bb4b4605f`): build on it.

### Task 2: A machine-wide worker cap, and slots freed under review
**Depends on:** none

Commits: `b78686ca4` (dispatch claims slots against a machine-wide cap of MaxParallelism, refills a run only to its
fair share while another runs, and holds dispatch while memory is short; `pkg/orchestrate/workerslots.go`). Our
`pkg/jobqueue` / `pkg/memgate` already gate heavy commands on RAM: read the memory check from there rather than
adding a second one. `28e43a4c3` (a task under review frees its parallelism slot), `cfeedca95` (a stopped worker
fails its task, not the whole dag), `70c90eb0d` (split `scheduleLocked` along its phases) if it makes the above
cleaner.

### Task 3: Plan review and lead wakes
**Depends on:** none

Commits: `be564a7a9` (plan review flags a command that names a path a later task creates), `559231030` (cap the
failed plan review wake; `wsh jarvis dag planreview findings` prints them whole), `18f7167ea` and `da42814bd` (the
plan format's Files lines, the worker's red-first step, plan review checking the plan's claims about code: in our
prompts and `skills/`, never the claude-mod copy), `00d5bec9d` (move a run's spec into its tree so its land never
holds), `81485fa70` (refuse a gitignored spec at run start and approve).

### Task 4: Merge, land and recovery fixes
**Depends on:** Task 1, Task 2

Commits, each checked against our source: `6bb1f87a1` (a lane tree whose directory a process holds moves to a
fresh path), `32dad1457` (plan commands keep Git Bash's path conversion), `4c274c131` (retry refuses a task that
landed or holds a merge), `41f34bc7b` (merge --continue refuses a squash no longer staged), `c00951639` (an
uncommitted fix in the landing tree no longer passes and then vanishes), `8fa2a92ce` (cancel at boot the dag runs a
quit left unrecorded), `8b58986fa` (a land held on a busy checkout claim retries by itself), `c3bb38c19` (the
auto-retry bound holds when the failure kind changes), `8bc284e7d` (a land clears an untracked copy in a project
that is a subfolder of its repo), `17da06a2c` (escalate refuses a blocked merge), `1711286f4` (a merge Verify
bisect blames no lane for a failure it cannot reproduce), `af66a198a` (closing a run's agent tab fails the run),
`dd124e16a`, `3b528ac3d`, `8e6f6b893` (likely already here from the 10-30 sync: confirm).
