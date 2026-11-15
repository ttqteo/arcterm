# Kael sync (2026-11-13), step 2: the fixes worth taking (stores, install, hooks, agents)

**Spec:** `docs/superpowers/specs/2026-11-13-kael-sync-engine-hardening-overview-design.md` (read "Our code wins" and groups 5, 6 and 12 before starting a task; this plan replaces the spec's steps 2 to 4, see "What this plan takes, and what it drops")
**Verify:** `node scripts/verify.mjs ./cmd/wsh/... ./cmd/server/... ./pkg/baseds/... ./pkg/wavevault/... ./pkg/effortstore/... ./pkg/notestore/... ./pkg/agentsync/... ./pkg/agentobserve/... ./pkg/agentsessions/... ./pkg/blockcontroller/... ./pkg/consult/... ./pkg/gitinfo/... ./pkg/usagestats/... ./pkg/wshrpc/...`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs surface-smoke agent-tree-rail agent-streams-offsurface kael1113-pick`

> **For Claude:** run this with the engine (`wsh runs start --plan <this file>`), or task by task with
> superpowers:subagent-driven-development.

**Goal:** Port only the fork commits that fix real bugs: settings that get overwritten, a stuck vault, skills that
fail to sync, the Claude mod's checks on Windows paths, the `wsh agents` waits, and agent rows that do not match the
agent's real state. Nothing of ours changes behaviour except the bug each commit fixes.

**Architecture:** A port of behaviour from `kael/main` (`a8f0864d1`), not a cherry-pick, done the way step 1 did it
(below). Tasks 1 to 7 and 9 run side by side, since their files do not overlap; Task 8 waits on Tasks 1 and 7, which
share its files; Task 10 writes the scenario for the visible changes once they land; Task 11 writes the docs last.

**Tech stack:** Go (`cmd/wsh`, `pkg/wavevault`, `pkg/agentsync`, `pkg/wshrpc/wshserver`), Rust (`src-tauri`), the
Claude mod's TypeScript (`claude/arc-mod/hooks`), React 19 + jotai (`frontend/app/view/agents`), vitest, the CDP
scenario harness (`scripts/cdp`).

---

## What this plan takes, and what it drops

The owner's call on 2026-11-15: take only what is worth taking. The spec's groups 4, 7, 8, 9, 10 and 11 are dropped,
and so are the parts of groups 5 and 6 that are polish or new commands. Task 11 writes each dropped group into the
spec as skipped, with the reason:

- **4 (API key login):** not needed; the owner signs in to Claude with accounts, not an API key.
- **5 (live-run states), except the bugs in Tasks 8 and 9:** UI polish of the lead card, the Events rail, and lead
  names. Ours redid those surfaces in the Chat look after the spec was written (runs `d2a699db`, `68701920`).
  `ad2e2cae5` (a backgrounded run listed under Backgrounded) is dropped too: ours' Cockpit surface has no Backgrounded
  section (`cockpitsurfacemodel.ts` has no `prunedBackgrounded`), so the bug cannot happen.
- **6, except the fixes in Task 7:** `wsh agents explain` (`603a21a35`, with its registry `8897f387c`) is a new
  command. `ffe84cf3b` adds `--until idle|asking` to `wsh agents wait`, which ours does not have
  (`cmd/wsh/cmd/wshcmd-agents.go` has only `--timeout`): a new flag, not a fix. The spec's line saying ours already has
  `--until` is wrong; Task 11 corrects it.
- **7 (Chat cards), 8 (project Overview):** new features nobody has asked for.
- **9 (brainstorm), 10 (motion):** ours has moved past them. The brainstorm now lives in Chat (the band's brainstorm
  part, boards that open over Chat), and the surfaces animate on Chat's spring (`6ad961fa6`, `528bc3725`).
- **11 (surface fixes, 71):** small races in views that ours has since redone. Each one costs a re-check, and the
  user is unlikely to hit any of them.
- **From group 12:** `90a09852e` (spec: our code wins). `5d93c0f49` is cosmetic, and its scenario file is not in
  ours. `ea5c40ad1` is not needed, because ours' `.arc/setup` already junctions `node_modules` into each tree.
- **Already in ours, so not ported:** `3d8ec7369` (ours has `agentobserve.NestedSession`, checked in
  `cmd/wsh/cmd/wshcmd-agenthook.go`), `59f6c705e` (ours' `8c3f1c3fc`: sync holds the vault lock only for its commit
  and merge), `aae9224b8` (ours' `lfText` in `pkg/agentsync/skills.go` already reads CRLF and a BOM).
- **The spec's scenario fixes:** they all belong to dropped groups or to scenario files ours lacks.

## How every task runs

First `git fetch kael` (the hashes are on `kael/main`). Then, for each commit the task lists, oldest first:

1. Read it: `git show <hash>` (and `git show kael/main:<path>` for a file at the fork's tip).
2. Check whether ours already does it. A commit or hunk ours already has is skipped.
3. Port the commit's tests first, adapted to our names. Add only new test functions or cases, except the existing
   assertions a task names as changed by its fix. Run them (one package with `-run`, or one vitest file) and see the
   new ones fail for the reason the commit fixes.
4. Port the code. Use `git cherry-pick -n <hash>` only when it applies cleanly; otherwise edit by hand.
5. Run the same focused tests and see them pass. Every other existing test in that file must still pass unchanged.
6. Commit by pathspec (`git add -- <paths>` then `git commit -m "<msg>" -- <paths>`). Make one commit per fork
   commit, or one for a few small related ones. Write the subject in our style (`fix(wavevault): …`) and name the fork
   hash in the body. List every skipped commit or hunk, and why, in the body under a "Differs from plan:" paragraph,
   and every existing test assertion changed, with why the fix changes it.

Go tests on Windows need cgo: `CGO_ENABLED=1 CC="zig cc -target x86_64-windows-gnu" go test ./pkg/x -run '^(TestA|TestB)$'`
(Bash). A frontend or mod test: `npx vitest run <file>.test.ts`. Rust: `cargo test --manifest-path src-tauri/Cargo.toml`.

## Rules every task follows

- **Our code wins** (spec section). Additive only: never rewrite, rename, remove or restyle an existing behaviour,
  component, binding, wire field or test of ours, beyond the bug the commit fixes. Adding test cases is fine; editing
  an existing case is allowed only where the task names it, because the fix changes exactly what it asserts. A task
  reviewer treats any other changed behaviour of ours as a failure.
- **Path changes since the fork split:**
  - Ours has no `pkg/claudemod`; its `readSettings` is our `readJSONObject` and the inline reads in
    `cmd/wsh/cmd/wshcmd-installhooks.go`.
  - Ours has no `cmd/wsh/cmd/claude-mod/` copy: wsh embeds `claude/arc-mod/` directly. Edit only `claude/arc-mod/`.
  - Ours has `scripts/cdp/scenarios-agent-streams.mjs` (scenario `agent-streams-offsurface`, registered in
    `scenarios.mjs`), so a fork step in it is ported (Task 6). The fork's `scenarios-agent.mjs` and
    `scenarios-brief.mjs` steps are not: ours lacks those files, and Task 10 covers their behaviour in a scenario of
    its own.
- **No wire type changes, except the one Task 8 names** (an additive `Ended` field on `baseds.AgentStatusData`). Any
  other commit that needs a new wire field skips that part and says so in its commit body.
- **Only Task 11 edits** `CHANGELOG.md`, `docs/hand-checks.md`, `docs/open-issues.md` and the kael spec. A task that
  needs one of those changed lists the change in its commit body for Task 11.
- Colours only from `@theme` tokens; pure logic in a `foo.ts` with `foo.test.ts` beside it.
- **A task that changes what the app shows names the scenario step that shows it.** Tasks 1 to 5 change no rendered
  state. Task 6's step is `agent-streams-offsurface` step 4; Task 7's, 8's and 9's are Task 10's `kael1113-pick` steps.

---

### Task 1: settings.json is never overwritten, and install keeps going
**Depends on:** none
**Files:** `cmd/wsh/cmd/wshcmd-installhooks.go`, `cmd/wsh/cmd/wshcmd-installhooks_test.go`, `src-tauri/src/main.rs`

Commits: `e84190ea4`, `6fa51ef03`, `e2c1dfeab`, `a341995a8`.

1. `e84190ea4`: ours has the bug. `readJSONObject` and the reads in `mergePiSettingsDefaults` and in the Claude
   settings install treat any `os.ReadFile` error as "no settings". A `settings.json` that is locked for a moment at
   launch (an editor, a sync tool, an antivirus scan) is then replaced by an Arc-only file, which loses the user's
   model, permissions, env and own hooks.
   - Add one helper beside `readJSONObject`. A missing file, or one that is blank, reads as no settings. Any other
     read error is returned, and nothing is written.
   - Route every read-modify-write of a settings file in this file through that helper.
   - Port the fork's test that makes the file unreadable. On Windows, hold it open with a share mode that denies
     reading, or skip the case on Windows with a reason, as the fork's test does.
2. `e2c1dfeab`, in two parts.
   - The helper drops a leading UTF-8 BOM.
   - A Claude settings file that does not parse must not stop the opencode, pi and agy installs. The Claude step's
     error is printed and returned after them.
   - `src-tauri/src/main.rs` waits for wsh on a thread and logs the exit status and stderr of a failed install to
     `waveapp.log`.
3. `6fa51ef03`: read `settings.json` after the claude version probe, if ours probes first.
4. `a341995a8`: a user's own hook that shares a matcher group with an Arc hook is kept when the install rewrites the
   group.
5. Run `go test ./cmd/wsh/cmd -run 'Install|Settings|Hook'` (with cgo) and `cargo test --manifest-path
   src-tauri/Cargo.toml`.

No rendered state changes.

### Task 2: the Tauri host opens links without a shell and keeps logging
**Depends on:** none
**Files:** `src-tauri/Cargo.lock`, `src-tauri/Cargo.toml`, `src-tauri/src/applog.rs`, `src-tauri/src/commands.rs`

Commits: `88bedf307`, `226a4192a`.

1. `88bedf307`: `open::that` runs `cmd /c start "" "<url>"`, so `&` and `^` inside the quotes are harmless, but a raw
   quote in a URL closes the argument and cmd runs what follows (`https://x/"&calc.exe&"`). Port the fork's fix: the
   allow-list also refuses raw quotes, whitespace and control characters, and the command calls `open::that_detached`
   with the `open` crate's `shellexecute-on-windows` feature, which hands the URL to `ShellExecuteExW` as one string.
   Port both of its tests. Keep our command's name and its arguments.
2. `226a4192a`: if `waveapp.log` cannot be rolled to `waveapp.1.log` (another process holds it), logging goes on in
   the current file instead of stopping.
3. `cargo test --manifest-path src-tauri/Cargo.toml` passes; `cargo build --manifest-path src-tauri/Cargo.toml`
   compiles.

No rendered state changes.

### Task 3: the vault never sticks on a lock, and keeps both sides' notes
**Depends on:** none
**Files:** `docs/superpowers/specs/2026-10-01-vault-sync-design.md`, `pkg/effortstore/effortstore.go`, `pkg/effortstore/effortstore_test.go`, `pkg/effortstore/migrate.go`, `pkg/notestore/notestore.go`, `pkg/notestore/notestore_test.go`, `pkg/wavevault/effortmerge.go`, `pkg/wavevault/effortmerge_test.go`, `pkg/wavevault/git.go`, `pkg/wavevault/git_test.go`, `pkg/wavevault/sync.go`, `pkg/wavevault/sync_test.go`

Commits, oldest first: `4449981e6`, `64e3c131f`, `c9f2f9d1c`, `05da38329`, `57b939c54`, `8d2bed4e6`, `2f17ea213`.
(`59f6c705e` is already ours as `8c3f1c3fc`; not ported.)

- `4449981e6`: the git timeout is bounded by the context, not by a credential helper keeping the pipe open.
- `64e3c131f`: remove the `index.lock` that a timed-out git leaves behind.
- `c9f2f9d1c`: a killed fetch or push leaves `index.lock` alone, because those commands do not take it.
- `05da38329`: effort notes, events and workrefs merge against the merge base, so neither side's additions are lost
  and a removal on one side survives. Port its edit of the vault-sync spec's merge rule
  (`docs/superpowers/specs/2026-10-01-vault-sync-design.md`) too.
- `57b939c54`, `2f17ea213`: effortstore's Update, and notestore's Add and Update, hold the vault lock across their
  read.
- `8d2bed4e6`: list efforts without a glob of the vault path. A path with `[` in it broke the listing.

`pkg/wavevault/git_test.go` is new in ours. Run `go test ./pkg/wavevault ./pkg/effortstore ./pkg/notestore`
(with cgo).

No rendered state changes.

### Task 4: skills sync on Windows
**Depends on:** none
**Files:** `pkg/agentsync/adopt.go`, `pkg/agentsync/adopt_test.go`, `pkg/agentsync/skills.go`, `pkg/agentsync/skills_test.go`, `pkg/agentsync/steering.go`, `pkg/agentsync/steering_test.go`

Commits: `d65594736`, `eedfcadd2`, `abd886f03`. (`aae9224b8` is already ours: `lfText`; not ported.)

- `d65594736`: never adopt a skill under a shipped name that has been retired.
- `eedfcadd2`: match a harness's skill folder to its vault name without regard to case. Windows folders do not
  care about case.
- `abd886f03`: when a steering file's end marker is gone, keep the user's text instead of cutting it.

Run `go test ./pkg/agentsync` (with cgo).

No rendered state changes.

### Task 5: the Claude mod reads Windows paths and cockpit prompts right
**Depends on:** none
**Files:** `claude/arc-mod/hooks/control-core.test.ts`, `claude/arc-mod/hooks/control-core.ts`, `claude/arc-mod/hooks/goalpost-core.test.ts`, `claude/arc-mod/hooks/goalpost-core.ts`, `claude/arc-mod/hooks/guard-core.test.ts`, `claude/arc-mod/hooks/guard-core.ts`

Commits: `fed97e1e8`, `8d6a6fb79`, `324a652ed`, `1ece91003`, `c0f606fd2`.

- `fed97e1e8`, `8d6a6fb79`: the goalpost checks recognise Windows paths (`C:\…`, backslashes), both in file
  arguments and in shell commands.
- `324a652ed`: the guard rules mask the text of commit and tag messages before matching. A message that mentions
  `rm -rf` is not a command.
- `1ece91003`: a cockpit prompt that starts with a path goes in as a prompt, not as a slash command.
- `c0f606fd2`: a slash text the session will not run is submitted as plain text.

Edit only `claude/arc-mod/` (ours embeds it directly; there is no copy). Run `npx vitest run
claude/arc-mod/hooks/goalpost-core.test.ts claude/arc-mod/hooks/guard-core.test.ts
claude/arc-mod/hooks/control-core.test.ts` and `claude plugin validate claude/arc-mod`.

No rendered state changes in the cockpit (the mod's checks act inside the Claude session).

### Task 6: sessions, usage and backend leaks
**Depends on:** none
**Files:** `cmd/server/main-server.go`, `frontend/app/view/agents/livetranscript.ts`, `frontend/app/view/term/term-model.ts`, `frontend/app/view/term/termwrap.ts`, `pkg/agentobserve/procanchor.go`, `pkg/agentobserve/procanchor_test.go`, `pkg/agentsessions/agentsessions.go`, `pkg/agentsessions/agentsessions_test.go`, `pkg/blockcontroller/blockcontroller.go`, `pkg/blockcontroller/blockcontroller_test.go`, `pkg/consult/exec.go`, `pkg/consult/exec_test.go`, `pkg/gitinfo/gitinfo.go`, `pkg/gitinfo/gitinfo_test.go`, `pkg/usagestats/pi.go`, `pkg/usagestats/pi_test.go`, `pkg/usagestats/usagestats.go`, `pkg/usagestats/usagestats_test.go`, `pkg/wshrpc/wshserver/transcript.go`, `pkg/wshrpc/wshserver/transcript_test.go`, `scripts/cdp/scenarios-agent-streams.mjs`

Commits: `828356a12`, `d26df2b5c`, `8b2088d15`, `81cfba592`, `7f0627eb4`, `9e0fc711a`, `57dff0eb5`.
(`3d8ec7369` is already ours: `agentobserve.NestedSession`; not ported.)

- `828356a12`: the transcript stream waits for a transcript folder that does not exist yet, instead of failing.
  Port the backend, the frontend hunk in `livetranscript.ts`, and the fork's step 4 of
  `scripts/cdp/scenarios-agent-streams.mjs` ("an agent whose transcript folder did not exist when its stream opened
  shows both lines written once the folder appears"), fitted to ours' version of that scenario. That step is this
  task's scenario check; Final runs `agent-streams-offsurface`.
- `d26df2b5c`: a resize sent to a block with no controller is quiet (no error, no log line). The existing assertion
  in `pkg/blockcontroller/blockcontroller_test.go` (near line 202) that a resize for a block with no controller
  reports an error is the behaviour this fixes: change that assertion to match, and keep its check that the size is
  persisted and that other input still reports an error.
- `8b2088d15`: one `rev-parse` per change read. `git status` runs with `--no-optional-locks`, so a status poll never
  takes `index.lock` from the user's own git.
- `81cfba592`, `7f0627eb4`: Usage bills the entries a forked pi session copied from its parent once, and bills pi's
  `type:usage` entries. `81cfba592` changes the pi fixture in `pkg/usagestats/usagestats_test.go` (near line 1008);
  that edit is allowed, as the fork makes it.
- `9e0fc711a`: consult removes a held stderr capture once it is let go (a file leak).
- `57dff0eb5`: an opencode session whose read failed is not cached. Its test goes in `agentsessions_test.go`, since
  ours has no `index_test.go`.

Run the touched packages' tests (with cgo), `go test ./cmd/server/...` (with cgo) if `main-server.go` changed, and
`npx vitest run` on the frontend tests next to any changed `.ts`.

### Task 7: `wsh agents send --wait` and asks report the real state
**Depends on:** none
**Files:** `cmd/wsh/cmd/wshcmd-agents.go`, `cmd/wsh/cmd/wshcmd-agents_test.go`, `frontend/app/view/agents/askanswer.ts`, `frontend/app/view/agents/askanswer.test.ts`, `pkg/wshrpc/wshserver/wshserver_agentmsg.go`, `pkg/wshrpc/wshserver/wshserver_agentmsg_test.go`

Commits: `8479d6a85`, `ad650942f`, `e5b3e8ca2`, `8051926e0`.

- `8479d6a85`: `send --wait` fails fast when no turn starts after the send, instead of waiting out the whole
  timeout.
- `ad650942f`: its timeout message names the target's real state (asking, idle, gone).
- `e5b3e8ca2`: an agent showing a permission prompt reads as asking, not idle. Ours' `PermissionRequest` and
  `Notification` hooks already report `AgentState_Waiting`, so take the roster part: `Waiting` counts as asking.
  - Ours' status has no `NotificationType` field, and this plan adds none for it. Where the fork names the prompt
    from `status.NotificationType` (`agentOpenPrompt`, in this commit and in `ad650942f`), word it from `Waiting`
    alone: an open ask is "a question", `Waiting` without an ask is "a question or a permission prompt".
  - Skip the commit's `--until` wording in `wsh agents wait`'s help: ours has no `--until`. Take the rest of its
    help and message wording.
  - The row `{baseds.AgentState_Waiting, false, wshrpc.AgentsState_Idle}` of `TestAgentsRosterStates` in
    `pkg/wshrpc/wshserver/wshserver_agentmsg_test.go` (near line 153) is the behaviour this fixes: change it to
    `AgentsState_Asking`, as the fork does.
- `8051926e0`: an ask whose answer never reached the agent is unlocked, so it can be answered again.
  `askanswer.test.ts` is new in ours.

Do not port `wsh agents explain` (`603a21a35`), its terminal registry (`8897f387c`) or `ffe84cf3b`'s `--until`. If
`8479d6a85` reads the screen through that registry, port its fail-fast through ours' existing turn and status
signals, and say so in the commit body. Run `go test ./cmd/wsh/cmd -run 'Agents'` and `./pkg/wshrpc/wshserver -run
'AgentMsg|Agents|Send|Ask'` (with cgo), and `npx vitest run frontend/app/view/agents/askanswer.test.ts`.

The re-answerable ask is shown by Task 10's `kael1113-pick` step.

### Task 8: an exited agent leaves the roster, and a prompt to no terminal is refused
**Depends on:** Task 1, Task 7
**Files:** `cmd/wsh/cmd/wshcmd-agenthook.go`, `cmd/wsh/cmd/wshcmd-agenthook_test.go`, `cmd/wsh/cmd/wshcmd-installhooks.go`, `cmd/wsh/cmd/wshcmd-installhooks_test.go`, `frontend/app/store/services.ts`, `frontend/app/store/wshclientapi.ts`, `frontend/types/gotypes.d.ts`, `frontend/types/waveevent.d.ts`, `pkg/baseds/baseds.go`, `pkg/waveobj/metaconsts.go`, `pkg/wconfig/metaconsts.go`, `pkg/wshrpc/wshclient/wshclient.go`, `pkg/wshrpc/wshserver/wshserver_agentmsg.go`, `pkg/wshrpc/wshserver/wshserver_agentmsg_test.go`

Commits: `9ea34975e`, `52939d137`.

- `9ea34975e`: refuse a prompt sent to a block that no terminal can take, instead of the prompt being lost. Port the
  server refusal in `AgentPromptCommand` (`wshserver_agentmsg.go`) and its tests. Skip the fork's `agentsend.ts`,
  `headercontrols.tsx`, `agentcomposer.tsx`, `snapshotguard_test.go` and `scenarios-brief.mjs` parts: ours' composer
  sends through `submitToAgent` (`agentsubmit.ts`), never `AgentPromptCommand`, and already reports a failed send.
  Ours' callers of `AgentPromptCommand` already show a rejected call: `shipstore.ts` toasts it, `brainstormsend.ts`
  and `commentsend.ts` catch and report it. So the refusal needs no frontend change; check those three still show
  the server's message, and say in the commit body if one does not (fix it there only if it swallows the error).
- `52939d137`: a Claude session that exited back to its shell leaves the `wsh agents` roster, so a send is not typed
  into the shell.
  - Add `Ended bool \`json:"ended,omitempty"\`` to `baseds.AgentStatusData` (`pkg/baseds/baseds.go`), the one wire
    change this plan allows: additive and optional, so every existing reporter and reader is unchanged. Run
    `task generate`, and commit the regenerated files with it (never hand-edit them).
  - `wsh agent-hook` reports idle with `Ended` on Claude's `SessionEnd`, except a `/clear` or `/resume`; the install
    manages `{Event: "SessionEnd", Args: "agent-hook", Timeout: 10}` again; `buildAgentRoster` drops a session whose
    latest status is ended. Ours' pi reports plain idle at shutdown, not ended: leave pi as it is and note it under
    Found not fixed.
  - Managing SessionEnd again changes two existing tests in `cmd/wsh/cmd/wshcmd-installhooks_test.go` that use
    SessionEnd as their example of an event arcterm does not manage (`TestMergePrunesHooksUnderNoLongerManagedEvents`,
    `TestMergeKeepsForeignHooksUnderUnmanagedEvents`, near lines 721 to 759), plus any count of managed hooks. Move
    their example to an event ours still does not manage, keeping what each asserts, as the fork's edit of that file
    does where it applies.

Run `go test ./cmd/wsh/cmd ./pkg/wshrpc/wshserver -run 'AgentHook|Install|Merge|AgentMsg|Agents|Prompt'` (with cgo)
and `task check:ts`.

No rendered state of the cockpit changes: the refusal reaches the existing error toasts, and the roster is
`wsh agents list`'s.

### Task 9: run rows load and place right
**Depends on:** none
**Files:** `frontend/app/view/agents/agenttreemodel.test.ts`, `frontend/app/view/agents/runeventstore.test.ts`, `frontend/app/view/agents/runeventstore.ts`, `frontend/app/view/agents/runlineage.test.ts`, `frontend/app/view/agents/runlineage.ts`, `frontend/app/view/agents/runlineagestore.ts`

Commits: `56d1be199`, `7295fec74`. Each fork commit was built on a view of its own, so first find the code in ours
that does the same job. If ours no longer has it, or has already fixed the bug, skip the commit with a reason.

- `56d1be199`: retry a failed run-event load, and merge the result with the live events instead of replacing them.
  `runeventstore.test.ts` is new in ours.
- `7295fec74`: a worker tab that joins its run is placed under the run from its first frame, not after a later
  refresh. Port its `runlineage.ts` and test changes; its `scenarios-agent.mjs` step becomes Task 10's step.

Run `npx vitest run` on the touched test files.

The row placement is shown by Task 10's `kael1113-pick` step.

### Task 10: a scenario for the visible fixes
**Depends on:** Task 7, Task 8, Task 9
**Files:** `scripts/cdp/scenarios-kael1113-pick.mjs`, `scripts/cdp/scenarios.mjs`

Write `scripts/cdp/scenarios-kael1113-pick.mjs` with one scenario named exactly `kael1113-pick`, and register it in
`scripts/cdp/scenarios.mjs` beside the other `kael1113` files. Follow the arrange / goto / shot / assert / teardown
shape of `scenarios-kael1113-dag.mjs` and `scenarios-agent-streams.mjs`, and inject agents with the helpers those
files already use. One numbered step, with a screenshot and an assert, for each of:

1. Task 9 `7295fec74`: a worker tab that joins a run is under the run's row in the Agent tree on the first frame it
   shows (the fork's `scenarios-agent.mjs` step is the model: `git show 7295fec74 -- scripts/cdp/scenarios-agent.mjs`).
2. Task 7 `8051926e0`: an ask whose answer failed to reach the agent can be answered again (the answer control is
   enabled again).

Read each task's commit body first: a commit the task skipped gets no step, and the file says why in a comment. If
both were skipped, the scenario still opens the Agent surface and asserts the run tree renders, so Final's name
resolves. Run it against a dev app with `task verify:ui -- kael1113-pick` if one is up; otherwise Final runs it.

### Task 11: changelog, hand checks and the spec's skip list
**Depends on:** Task 1, Task 2, Task 3, Task 4, Task 5, Task 6, Task 7, Task 8, Task 9, Task 10
**Files:** `CHANGELOG.md`, `docs/hand-checks.md`, `docs/open-issues.md`, `docs/superpowers/specs/2026-11-13-kael-sync-engine-hardening-overview-design.md`, `docs/superpowers/plans/2026-11-15-kael-sync-hardening-pick.md`

Read every commit the run landed (`git log main..HEAD`) and their bodies before writing.

1. `CHANGELOG.md`: under `## Unreleased` → `Fixed`, add one line for each fix that landed and that the user would
   notice, written for the user. Derive the list from the landed commits, not from this plan: a commit a task
   skipped gets no line. Merge lines that read as one fix. No line for tests or internals.
2. `docs/hand-checks.md`: add a `- [ ] (arcterm) Kael sync 11-13 step 2: …` line, with the commit, for each landed
   fix the tasks could only unit-test and the user can try. For example, where they landed: a locked
   `settings.json` at launch (open it in an editor that locks it, restart arcterm, and the file is unchanged); a link
   with a raw `"` in it from previewed markdown is refused and logged, and a normal link with `&` in its query still
   opens; a vault sync killed mid-push; a Claude agent exiting to its shell leaves `wsh agents list`; a permission
   prompt reads as asking in `wsh agents list`.
3. `docs/open-issues.md`: add a row for each item a task's report or commit body left open.
4. The kael spec:
   - Under "Order", state that steps 2 to 4 were replaced on 2026-11-15 by this pick.
   - Add a "Dropped (2026-11-15)" paragraph with each dropped group or commit and its reason, copied from "What this
     plan takes, and what it drops" above, plus any commit or hunk a task skipped and its reason (from the commit
     bodies' "Differs from plan:" paragraphs).
   - Correct the two places that say ours already has `wsh agents wait` with an `--until` (the "Why this is a port"
     paragraph and group 6): ours' `wait` has only `--timeout`.
5. Delete this plan file in the same commit (a plan is deleted once it ships).
