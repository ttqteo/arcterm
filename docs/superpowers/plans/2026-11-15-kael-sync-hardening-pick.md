# Kael sync (2026-11-13), step 2: the fixes worth taking (stores, install, hooks, agents)

**Spec:** `docs/superpowers/specs/2026-11-13-kael-sync-engine-hardening-overview-design.md` (read "Our code wins" and groups 5, 6 and 12 before starting a task; this plan replaces the spec's steps 2 to 4, see "What this plan takes, and what it drops")
**Verify:** `node scripts/verify.mjs ./cmd/wsh/... ./pkg/wavevault/... ./pkg/effortstore/... ./pkg/notestore/... ./pkg/agentsync/... ./pkg/agentobserve/... ./pkg/agentsessions/... ./pkg/blockcontroller/... ./pkg/consult/... ./pkg/gitinfo/... ./pkg/usagestats/... ./pkg/wshrpc/...`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs surface-smoke agent-tree-rail`

> **For Claude:** run this with the engine (`wsh runs start --plan <this file>`), or task by task with
> superpowers:subagent-driven-development.

**Goal:** Port only the fork commits that fix real bugs: settings that get overwritten, a stuck vault, skills that
fail to sync, the Claude mod's checks on Windows paths, the `wsh agents` waits, and agent rows that do not match the
agent's real state. Nothing of ours changes behaviour except the bug each commit fixes.

**Architecture:** A port of behaviour from `kael/main` (`a8f0864d1`), not a cherry-pick, done the way step 1 did it
(below). Seven tasks run side by side, since their files do not overlap; Task 8 waits on the three tasks that share
its files; Task 9 writes the docs last.

**Tech stack:** Go (`cmd/wsh`, `pkg/wavevault`, `pkg/agentsync`, `pkg/wshrpc/wshserver`), Rust (`src-tauri`), the
Claude mod's TypeScript (`claude/arc-mod/hooks`), React 19 + jotai (`frontend/app/view/agents`), vitest.

---

## What this plan takes, and what it drops

The owner's call on 2026-11-15: take only what is worth taking. The spec's groups 4, 7, 8, 9, 10 and 11 are dropped,
and so are the parts of groups 5 and 6 that are polish or new commands. Task 9 writes each dropped group into the
spec as skipped, with the reason:

- **4 (API key login):** not needed; the owner signs in to Claude with accounts, not an API key.
- **5 (live-run states), except the five bugs in Task 8:** UI polish of the lead card, the Events rail, and lead
  names. Ours redid those surfaces in the Chat look after the spec was written (runs `d2a699db`, `68701920`).
- **6, except the four fixes in Task 7:** `wsh agents explain` (`603a21a35`, with its registry `8897f387c`) is a new
  command, and ours already has `wsh agents wait` (`ffe84cf3b`).
- **7 (Chat cards), 8 (project Overview):** new features nobody has asked for.
- **9 (brainstorm), 10 (motion):** ours has moved past them. The brainstorm now lives in Chat (the band's brainstorm
  part, boards that open over Chat), and the surfaces animate on Chat's spring (`6ad961fa6`, `528bc3725`).
- **11 (surface fixes, 71):** small races in views that ours has since redone. Each one costs a re-check, and the
  user is unlikely to hit any of them.
- **From group 12:** `90a09852e` (spec: our code wins). `5d93c0f49` is cosmetic, and its scenario file is not in
  ours. `ea5c40ad1` is not needed, because ours' `.arc/setup` already junctions `node_modules` into each tree.
- **The spec's scenario fixes:** they all belong to dropped groups or to scenario files ours lacks.

## How every task runs

First `git fetch kael` (the hashes are on `kael/main`). Then, for each commit the task lists, oldest first:

1. Read it: `git show <hash>` (and `git show kael/main:<path>` for a file at the fork's tip).
2. Check whether ours already does it. A commit or hunk ours already has is skipped.
3. Port the commit's tests first, adapted to our names. Add only new test functions or cases. Run them (one package
   with `-run`, or one vitest file) and see the new ones fail for the reason the commit fixes.
4. Port the code. Use `git cherry-pick -n <hash>` only when it applies cleanly; otherwise edit by hand.
5. Run the same focused tests and see them pass. Every existing test in that file must still pass unchanged.
6. Commit by pathspec (`git add -- <paths>` then `git commit -m "<msg>" -- <paths>`). Make one commit per fork
   commit, or one for a few small related ones. Write the subject in our style (`fix(wavevault): …`) and name the fork
   hash in the body. List every skipped commit or hunk, and why, in the body under a "Differs from plan:" paragraph.

Go tests on Windows need cgo: `CGO_ENABLED=1 CC="zig cc -target x86_64-windows-gnu" go test ./pkg/x -run '^(TestA|TestB)$'`
(Bash). A frontend or mod test: `npx vitest run <file>.test.ts`. Rust: `cargo test --manifest-path src-tauri/Cargo.toml`.

## Rules every task follows

- **Our code wins** (spec section). Additive only: never rewrite, rename, remove or restyle an existing behaviour,
  component, binding, wire field or test of ours, beyond the bug the commit fixes. Adding test cases is fine; editing
  or deleting an existing case is not. A task reviewer treats any other changed behaviour of ours as a failure.
- **Path changes since the fork split:**
  - Ours has no `pkg/claudemod`; its `readSettings` is our `readJSONObject` and the inline reads in
    `cmd/wsh/cmd/wshcmd-installhooks.go`.
  - Ours has no `cmd/wsh/cmd/claude-mod/` copy: wsh embeds `claude/arc-mod/` directly. Edit only `claude/arc-mod/`.
  - A fork scenario file ours lacks (`scenarios-agent.mjs`, `scenarios-brief.mjs`, `scenarios-agent-streams.mjs`) is
    skipped. Write a vitest case for the same behaviour instead.
- **No wire type changes.** If a commit needs a new wshrpc field, the task stops and says so in its report.
- **Only Task 9 edits** `CHANGELOG.md`, `docs/hand-checks.md`, `docs/open-issues.md` and the spec. A task that needs
  one of those changed lists the change in its commit body for Task 9.
- Colours only from `@theme` tokens; pure logic in a `foo.ts` with `foo.test.ts` beside it.

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

### Task 2: the Tauri host opens links without a shell and keeps logging
**Depends on:** none
**Files:** `src-tauri/Cargo.lock`, `src-tauri/Cargo.toml`, `src-tauri/src/applog.rs`, `src-tauri/src/commands.rs`

Commits: `88bedf307`, `226a4192a`.

1. `88bedf307`: the open-external-URL command must not pass the URL through a shell. A URL with `&` or `^` in it is
   otherwise read as shell syntax. Port the fork's way: the opener crate or a direct `ShellExecuteW`, whichever it
   used, with a scheme allow-list if the fork has one. Keep our command's name and its arguments.
2. `226a4192a`: if `waveapp.log` cannot be rolled to `waveapp.1.log` (another process holds it), logging goes on in
   the current file instead of stopping.
3. `cargo test --manifest-path src-tauri/Cargo.toml` passes; `cargo build --manifest-path src-tauri/Cargo.toml`
   compiles.

### Task 3: the vault never sticks on a lock, and keeps both sides' notes
**Depends on:** none
**Files:** `pkg/effortstore/effortstore.go`, `pkg/effortstore/effortstore_test.go`, `pkg/effortstore/migrate.go`, `pkg/notestore/notestore.go`, `pkg/notestore/notestore_test.go`, `pkg/wavevault/effortmerge.go`, `pkg/wavevault/effortmerge_test.go`, `pkg/wavevault/git.go`, `pkg/wavevault/git_test.go`, `pkg/wavevault/sync.go`, `pkg/wavevault/sync_test.go`

Commits, oldest first: `4449981e6`, `64e3c131f`, `c9f2f9d1c`, `59f6c705e`, `05da38329`, `57b939c54`, `8d2bed4e6`,
`2f17ea213`.

- `4449981e6`: the git timeout is bounded by the context, not by a credential helper keeping the pipe open.
- `64e3c131f`: remove the `index.lock` that a timed-out git leaves behind.
- `c9f2f9d1c`: a killed fetch or push leaves `index.lock` alone, because those commands do not take it.
- `59f6c705e`: sync releases the vault lock during fetch and push, so an effort write is not held for the length of
  a network call.
- `05da38329`: effort notes, events and workrefs merge against the merge base, so neither side's additions are lost.
- `57b939c54`, `2f17ea213`: effortstore's Update, and notestore's Add and Update, hold the vault lock across their
  read.
- `8d2bed4e6`: list efforts without a glob of the vault path. A path with `[` in it broke the listing.

`pkg/wavevault/git_test.go` is new in ours. Run `go test ./pkg/wavevault ./pkg/effortstore ./pkg/notestore`
(with cgo).

### Task 4: skills sync on Windows and CRLF files
**Depends on:** none
**Files:** `pkg/agentsync/adopt.go`, `pkg/agentsync/adopt_test.go`, `pkg/agentsync/skills.go`, `pkg/agentsync/skills_test.go`, `pkg/agentsync/steering.go`, `pkg/agentsync/steering_test.go`

Commits: `d65594736`, `eedfcadd2`, `aae9224b8`, `abd886f03`.

- `d65594736`: never adopt a skill under a shipped name that has been retired.
- `eedfcadd2`: match a harness's skill folder to its vault name without regard to case. Windows folders do not
  care about case.
- `aae9224b8`: read the frontmatter of a `SKILL.md` with CRLF line endings.
- `abd886f03`: when a steering file's end marker is gone, keep the user's text instead of cutting it.

Run `go test ./pkg/agentsync` (with cgo).

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

### Task 6: sessions, usage and backend leaks
**Depends on:** none
**Files:** `cmd/server/main-server.go`, `cmd/wsh/cmd/wshcmd-agenthook.go`, `frontend/app/view/agents/livetranscript.ts`, `frontend/app/view/term/term-model.ts`, `frontend/app/view/term/termwrap.ts`, `pkg/agentobserve/procanchor.go`, `pkg/agentobserve/procanchor_test.go`, `pkg/agentsessions/agentsessions.go`, `pkg/agentsessions/agentsessions_test.go`, `pkg/blockcontroller/blockcontroller.go`, `pkg/blockcontroller/blockcontroller_test.go`, `pkg/consult/exec.go`, `pkg/consult/exec_test.go`, `pkg/gitinfo/gitinfo.go`, `pkg/gitinfo/gitinfo_test.go`, `pkg/usagestats/pi.go`, `pkg/usagestats/pi_test.go`, `pkg/usagestats/usagestats.go`, `pkg/usagestats/usagestats_test.go`, `pkg/wshrpc/wshserver/transcript.go`, `pkg/wshrpc/wshserver/transcript_test.go`

Commits: `828356a12`, `d26df2b5c`, `8b2088d15`, `81cfba592`, `7f0627eb4`, `9e0fc711a`, `3d8ec7369`, `57dff0eb5`.

- `828356a12`: the transcript stream waits for a transcript folder that does not exist yet, instead of failing.
  Port the frontend hunk in `livetranscript.ts`. Skip the fork's `scenarios-agent-streams.mjs` step.
- `d26df2b5c`: a resize sent to a block with no controller is quiet (no error, no log line).
- `8b2088d15`: one `rev-parse` per change read. `git status` runs with `--no-optional-locks`, so a status poll never
  takes `index.lock` from the user's own git.
- `81cfba592`, `7f0627eb4`: Usage bills the entries a forked pi session copied from its parent once, and bills pi's
  `type:usage` entries.
- `9e0fc711a`: consult removes a held stderr capture once it is let go (a file leak).
- `3d8ec7369`: a claude started inside another agent's terminal no longer takes over the outer agent's row.
- `57dff0eb5`: an opencode session whose read failed is not cached. Its test goes in `agentsessions_test.go`, since
  ours has no `index_test.go`.

Run the touched packages' tests (with cgo), and `npx vitest run` on the frontend tests next to any changed `.ts`.

### Task 7: `wsh agents send --wait` and asks report the real state
**Depends on:** none
**Files:** `cmd/wsh/cmd/wshcmd-agents.go`, `cmd/wsh/cmd/wshcmd-agents_test.go`, `frontend/app/view/agents/askanswer.ts`, `frontend/app/view/agents/askanswer.test.ts`, `pkg/wshrpc/wshserver/wshserver_agentmsg.go`, `pkg/wshrpc/wshserver/wshserver_agentmsg_test.go`

Commits: `8479d6a85`, `ad650942f`, `e5b3e8ca2`, `8051926e0`.

- `8479d6a85`: `send --wait` fails fast when no turn starts after the send, instead of waiting out the whole
  timeout.
- `ad650942f`: its timeout message names the target's real state (asking, idle, gone).
- `e5b3e8ca2`: an agent showing a permission prompt reads as asking, not idle. Fit it to our `PermissionRequest`
  hook: the spec says this applies to it too.
- `8051926e0`: an ask whose answer never reached the agent is unlocked, so it can be answered again.
  `askanswer.test.ts` is new in ours.

Do not port `wsh agents explain` (`603a21a35`) or its terminal registry (`8897f387c`). If `8479d6a85` reads the
screen through that registry, port its fail-fast through ours' existing turn and status signals, and say so in the
commit body. Run `go test ./cmd/wsh/cmd -run 'Agents'` and `./pkg/wshrpc/wshserver -run 'AgentMsg|Send|Ask'` (with
cgo).

### Task 8: agent rows match the agent's real state
**Depends on:** Task 1, Task 6, Task 7
**Files:** `cmd/wsh/cmd/wshcmd-agenthook.go`, `cmd/wsh/cmd/wshcmd-agenthook_test.go`, `cmd/wsh/cmd/wshcmd-installhooks.go`, `cmd/wsh/cmd/wshcmd-installhooks_test.go`, `frontend/app/view/agents/agentcomposer.test.ts`, `frontend/app/view/agents/agentcomposer.tsx`, `frontend/app/view/agents/agenttreemodel.test.ts`, `frontend/app/view/agents/cockpitsurface.tsx`, `frontend/app/view/agents/cockpitsurfacemodel.test.ts`, `frontend/app/view/agents/cockpitsurfacemodel.ts`, `frontend/app/view/agents/runeventstore.ts`, `frontend/app/view/agents/runeventstore.test.ts`, `frontend/app/view/agents/runlineage.test.ts`, `frontend/app/view/agents/runlineage.ts`, `frontend/app/view/agents/runlineagestore.ts`, `pkg/wshrpc/wshserver/wshserver_agentmsg.go`, `pkg/wshrpc/wshserver/wshserver_agentmsg_test.go`

Commits: `9ea34975e`, `52939d137`, `56d1be199`, `7295fec74`, `ad2e2cae5`. Each fork commit was built on a view of its
own, so for each one first find the code in ours that does the same job. Our Agent and Cockpit surfaces have been
redone in the Chat look. If ours no longer has that view, or has already fixed the bug, skip the commit with a reason.

- `9ea34975e`: refuse a prompt sent to a block that no terminal can take, and say so in the composer, instead of
  the prompt being lost. Ours has no `agentsend.ts` or `headercontrols.tsx`; port the server refusal in
  `wshserver_agentmsg.go` and show it where ours sends from the composer. Skip its `snapshotguard_test.go` and
  `scenarios-brief.mjs` parts.
- `52939d137`: an agent that exited back to its shell leaves the roster. Its hook and install parts sit beside
  Task 1's edits.
- `56d1be199`: retry a failed run-event load, and merge the result with the live events instead of replacing them.
  `runeventstore.test.ts` is new in ours.
- `7295fec74`: a worker tab that joins its run is placed under the run from its first frame, not after a later
  refresh. Write a vitest case in place of the fork's `scenarios-agent.mjs` step.
- `ad2e2cae5`: a run whose lead idles while the run goes on is listed as backgrounded (or ours' equivalent of
  Backgrounded).

Run the touched vitest files, and `go test ./cmd/wsh/cmd ./pkg/wshrpc/wshserver -run 'AgentHook|Install|AgentMsg'`
(with cgo).

### Task 9: changelog, hand checks and the spec's skip list
**Depends on:** Task 1 (its commit bodies), Task 2 (its commit bodies), Task 3 (its commit bodies), Task 4 (its commit bodies), Task 5 (its commit bodies), Task 6 (its commit bodies), Task 7 (its commit bodies), Task 8 (its commit bodies)
**Files:** `CHANGELOG.md`, `docs/hand-checks.md`, `docs/open-issues.md`, `docs/superpowers/specs/2026-11-13-kael-sync-engine-hardening-overview-design.md`

1. `CHANGELOG.md`: under `## Unreleased` → `Fixed`, add one line for each fix the user would notice, written for the
   user:
   - settings.json is no longer overwritten when it is locked at launch
   - a link with `&` in it opens whole
   - the vault no longer sticks after a timed-out sync
   - skills sync with CRLF files and folder names in any case
   - the Claude mod's checks understand Windows paths
   - `wsh agents send --wait` fails fast
   - an agent that went back to its shell leaves the list
   - a prompt to a closed terminal says so
   - Usage bills pi sessions correctly

   Merge lines that read as one fix. No line for tests or internals.
2. `docs/hand-checks.md`: add a `- [ ] (arcterm) Kael sync 11-13 step 2: …` line, with the commit, for each fix the
   tasks could only unit-test and the user can try. At least:
   - a locked `settings.json` at launch (open it in an editor that locks it, restart arcterm, and the file is
     unchanged)
   - a link with `&` from the cockpit
   - a vault sync killed mid-push
   - an agent exiting to its shell
   - a permission prompt that reads as asking
3. `docs/open-issues.md`: add a row for each item a task's report left open.
4. The spec: under "Order", state that steps 2 to 4 were replaced on 2026-11-15 by this pick. Add a "Dropped
   (2026-11-15)" paragraph with each dropped group or commit and its reason, copied from "What this plan takes, and
   what it drops" above, plus any commit a task skipped and its reason (from the commit bodies' "Differs from plan:"
   paragraphs).
5. Delete this plan file in the same commit (a plan is deleted once it ships).
