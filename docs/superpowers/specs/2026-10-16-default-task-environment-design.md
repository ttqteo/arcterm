# Default task environment: link dependency folders when a project has no .arc/setup

Effort: cf00e94a-3b08-4b55-a4f6-16bdb1012de9, chunk "Design doc: default setup".

## Why

A project without `.arc/setup` gets bare engine trees: no `node_modules`, so a worker cannot run the project's
tools. SIEM is the case in hand. Its leads wrote per-run wrapper scripts (`~/.arc/<run>/scratch.sh`, `web.sh`) that
make a fresh short-path worktree and run `pnpm install` on every vitest or biome call. Over 20 SIEM runs in 3 weeks
workers spent about 321 minutes in those wrappers. In run 313fb392 `web.sh vitest` averaged 109 s against about 11 s
that vitest itself reported. A project should not need a checked-in Setup to get a working tree.

## Evidence (2026-10-16 probes, SIEM webapp, trees at `arc-wt` depth)

The full numbers are in the chunk 1 note of the effort.

| Path | Result |
|---|---|
| Linked tree (main's `node_modules` junctioned in): vitest, biome, tsc | 671 tests pass in 62 s; one file takes 38 s direct against 307 s through `web.sh` |
| Linked tree: `vite build` | passes in 29 s; the output stays in the tree (`target/www/assets`); the shared `node_modules` is untouched |
| Linked tree: Playwright stubbed tier | 53 of 53 pass in 2.8 min |
| Fresh `pnpm install --prefer-offline` at task depth | 19 s, 1.1 GB; vitest, build and biome run; longest file path 274 chars, `.exe` paths about 180 |
| `pnpm exec` / `pnpm run` in a linked tree | **runs pnpm 11's deps check, which tries to purge the modules dir**: main's, through the junction (see Decision 4) |
| SIEM lockfiles | `pnpm-lock.yaml` and `yarn.lock` are gitignored, so a fresh tree resolves newer versions (vite 8.3.4 against main's 8.0.11) |
| Manifest changes by engine tasks | 0 engine-run commits touched any `package.json` in SIEM's last 567 commits (3 weeks); 2 human commits did |
| Python venvs | none in SIEM; its Python deps live in global environments |

## Decisions

1. **When it applies.** The default runs in place of Setup: when the plan has no `**Setup:**` line and the project has
   no `.arc/setup`. A plan's own Setup or the project's file replaces it entirely. A project that wants bare trees
   checks in `.arc/setup` holding `true`. No setting is added.

2. **What it links.** The default links `node_modules` only. Go, Maven and Cargo keep their deps in user-wide caches,
   and SIEM has no venv, so nothing else needs a per-tree folder today. If a project shows a need, another folder
   kind goes in the same table. For each tracked `package.json` in the tree (`git ls-files`, none under a
   `node_modules`), at directory D:
   - **link** `D/node_modules` to the main checkout's (`git worktree list`, first entry) when all three hold:
     - main's `D/node_modules` is a real directory, not itself a link;
     - the tree has no `D/node_modules`;
     - D's manifests match: every file of `package.json`, `pnpm-workspace.yaml`, `.npmrc`, `pnpm-lock.yaml`,
       `package-lock.json`, `yarn.lock`, `bun.lock` that exists in the tree matches main's copy (a file missing from
       main counts as different). Line endings are ignored: with `core.autocrlf` a checkout writes CRLF, while an
       editor can save main's copy with LF. Files only main has, such as SIEM's gitignored lockfile, are not
       compared.
   - **skip** in every other case. Only a manifest difference is reported (`<dir> (<file> differs from the main
     checkout's)`): a dir main never installed is one nobody runs the tools of. SIEM has ten of those (five old
     `jquery-ui` copies, and apps the developer has not installed), and listing them would send a worker off to
     install them.

   Detection goes by installed folders and tracked manifests, never by tracked lockfiles: SIEM tracks none. Linking
   gives the versions the developer actually runs; a fresh install there would drift.

3. **Where it runs.** Every engine tree that runs Setup today goes through one helper,
   `PrepareTree(ctx, wt, setup)`, which replaces `RunSetup`. It runs `setup` when set, and the link step
   otherwise. The four call sites switch to it:
   - task and lane trees (`engine.go` dispatch);
   - the landing tree at submit (`wshserver_dag.go`);
   - the final tree (`final.go`);
   - the detached base and bisect trees (`withDetachedTree`).

   The link step is Go in `pkg/orchestrate`, not a shell command. A `wsh` command named in Setup would run whichever
   `~/.arc/bin/wsh` installed itself last. The packaged app and the dev app overwrite each other's copy, and a
   worktree dev app opts out with `ARC_DEV_NO_GLOBAL_INSTALL`. The link step takes milliseconds and
   is idempotent, so it runs inside the existing Setup slot, under the dag lock, with `FailureKindSetup`
   unchanged. In a task tree it runs on every dispatch, a reused lane tree included, rather than once per tree as the
   Setup marker allows, so its report reaches each task of the lane. A link that fails, for example because the junction cannot be created, fails Setup
   like any Setup. The step returns its skipped dirs for Decision 5.

4. **The pnpm guard.** pnpm records an absolute `virtualStoreDir` in `.modules.yaml`. From a linked tree that path
   names main's directory, so pnpm 11 judges the layout wrong. Before `pnpm exec` and `pnpm run` it runs
   `pnpm install`, which purges the modules dir: main's, through the junction. In the probe it aborted only because
   there was no TTY; with `CI=true` set it would have deleted main's `node_modules`. pnpm 11 ignores
   `verify-deps-before-run=false` in `.npmrc`; the env var `pnpm_config_verify_deps_before_run=false` stops it, and
   Playwright's `pnpm exec vite preview` passed with it set.
   - The engine sets that variable on every command it runs in an engine tree: plan commands through
     `execPlanCommandEnv`, and every run agent through `jarvis.SpawnRunWorker` (block `cmd:env`).
   - It is set unconditionally, not only when something was linked: a project's `.arc/setup` can junction a pnpm
     dir too, and the variable is inert where no pnpm runs. The cost is that agents no longer get pnpm's automatic
     install before a script; a stale tree then fails loudly instead.

5. **Worker contract.** One sentence is always present: a `node_modules` that is a link into the main checkout is
   shared with it, so run the tools inside it and never install into it, delete it, or `rm -r` through it.
   - When the link step skipped a dir, the prompt also names it and why. It tells the worker to install there with
     the project's package manager before running its tools. A skipped dir is a real, empty location, so installing
     there is safe.
   - A task that must change a manifest in a linked dir unlinks it first with
     `node -e "require('fs').rmdirSync('node_modules')"` and then installs. The probe showed that `rmdirSync` removes a
     junction and leaves its target intact. On a non-empty real directory it fails with ENOTEMPTY (Node's documented
     behaviour, not probed).

6. **Plan reviewer.** Two additions to the existing lens that checks the plan's commands:
   - A task that changes a `package.json` or lockfile in a project on the default needs a Setup that installs. The
     reviewer flags a plan that has none. The landing and final trees would otherwise link main's stale
     `node_modules`, and Verify and Final would fail on a missing module.
   - The reviewer flags a Verify, Check or Final command, or a task step, that rebuilds the environment on every
     call (a scratch worktree or `pnpm install` per call), and names the default as the reason it is not needed.

7. **Cleanup.** Nothing new. `removeWorktreeDir` already unlinks every junction before git or `os.RemoveAll` touches
   the tree (`unlinkReparsePoints`), and `TestRemoveRunWorktreeLeavesJunctionTargetsIntact` tests it. A rewind
   removes a tree instead of resetting it for the same reason.

## Not doing

- **An engine-run install** for a dir whose manifest differs, or when main has nothing installed. No engine task
  changed a manifest in 3 weeks of SIEM runs. The worker install from Decision 5 and the reviewer rule from
  Decision 6 cover the case. Revisit if a run hits it. This replaces the tracker's chunk "a task that changes a
  lockfile ... gets one real install at tree creation".
- Re-linking at Verify time after a merge changed a manifest: the Decision 6 rule makes the plan carry a Setup.
- Folders other than `node_modules`.
- Linking in the run's own tree (lead, quick run). It has no Setup today, and nothing here changes that.

## Tests

- **Link step** (`pkg/orchestrate`, table test against two temp git checkouts, main plus a worktree): it links when
  main has `node_modules` and the manifests match.
  - It skips when main has nothing, when `package.json` differs, when `pnpm-workspace.yaml` differs, and when the
    tree already has the dir.
  - A file only main has does not block the link.
  - A nested workspace package links on its own.
  - Running it twice is a no-op.
- **prepareTree**: with `setup` set it runs the command and does not link; with `setup` empty it links.
- **Removal** (Windows): a tree the link step prepared is removed with main's `node_modules` intact. This extends the
  existing junction test.
- **Env**: `execPlanCommandEnv` and the worker spawn carry `pnpm_config_verify_deps_before_run=false`.
- **Prompt**: the worker contract names the skipped dirs, and holds the shared-link sentence.
- **Live** (tracker chunk 7): a SIEM run on a rebuilt Arc whose plan has no Setup and no wrapper scripts, compared
  with run 313fb392 (`web.sh vitest` 109 s on average, about 54 min on the chain).
