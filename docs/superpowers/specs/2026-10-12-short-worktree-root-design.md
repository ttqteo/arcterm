# Short root for engine worktrees

Effort: 0d2feabb-ca35-4e0b-a3f4-b0a850c893e0, chunk "Plan and implement: short task-worktree root under %LOCALAPPDATA%\arc-wt".

## Why

On Windows, with LongPathsEnabled=1 and core.longpaths=true (set, rebooted), CreateProcess still cannot start an
.exe from a path over 260 chars (ENOENT), and Node's ESM resolver fails `#imports` from a long path
(ERR_PACKAGE_IMPORT_NOT_DEFINED). In SIEM the engine's tree root `<project>\.waveterm\worktrees\<36-char run id>-t-N\`
is 95 chars, and pnpm paths below it reach 186 (package.json) and 134 (.exe), so vitest, vite build and biome fail
inside task trees. A root of about 51 chars, the same for every project, keeps them under 260.

## Decisions

1. **Root.** `filepath.Join(os.UserCacheDir(), "arc-wt")`: `%LOCALAPPDATA%\arc-wt` on Windows, `~/.cache/arc-wt`
   (or `$XDG_CACHE_HOME`) on Linux, `~/Library/Caches/arc-wt` on macOS. One code path on every OS. Resolved once per
   process. If `os.UserCacheDir` fails, the engine logs it once and keeps the legacy in-project layout, so a broken
   environment degrades to today's behaviour instead of failing every run.
2. **Every engine tree moves**, not only task, lane and final trees: everything `worktreeDir(project, key)` computes.
   | key | today | new |
   |---|---|---|
   | `<runID>` (the run's own tree: lead, quick run) | `<project>\.waveterm\worktrees\<runID>` | `arc-wt\<8>` |
   | `<runID>-t-N` (task / lane) | `...\worktrees\<runID>-t-N` | `arc-wt\<8>-t-N` |
   | `<runID>-final`, `-base`, `-bisect` (detached) | `...\worktrees\<runID>-final` | `arc-wt\<8>-final` |
   | `<runID>-final-2` (beside a held final tree) | derived from the final tree | `arc-wt\<8>-final-2` |
   `<8>` is the first 8 chars of the run id. A key that does not start with a 36-char UUID (test fixtures) maps to
   `arc-wt\<key>`, with no prefix or ownership logic.
3. **Branch names do not change**: `wave/<key>` with the full run id, as today. Only the directory moves.
4. **Legacy fallback.** `worktreeDir` stays computed, not stored. A key whose legacy path
   `<project>\.waveterm\worktrees\<key>` exists resolves to that path, so a run in flight when this ships keeps its
   trees until it removes them. A legacy tree that is removed and created again (a lane retry, a fresh final round)
   is created at the new root. Nothing is migrated or moved.
5. **Prefix ownership.** Each run claims its prefix with a marker file `arc-wt\<8>.run` holding the full run id,
   created with O_CREATE|O_EXCL before the run's first tree is added. Resolution reads the marker:
   - absent, or names this run: `arc-wt\<8><suffix>`;
   - anything else: `arc-wt\<full key>` (the full 36-char id, about 79 chars: longer, still shorter than today). A
     marker whose content is not this run's id counts as another run's: one naming another run, one left empty by a
     crash between its create and its write, and one that cannot be read. This run's keys then take the full-id path.
   Creation and removal resolve the same way, so a removal never reaches another run's tree, and two runs never
   share a tree. A claim that loses the O_EXCL race reads the winner's marker and takes the full-id path. Markers are
   never deleted: a run's leftover trees (cleanup debt, a held final tree) can outlive the run, and a deleted marker
   would let a later run with the same prefix remove them. They are a few bytes each, one per run.
6. **Creation sites claim; every other site only resolves.** `CreateRunWorktree`, `EnsureRunWorktree` (re-adding a
   branch), `withDetachedTree` (base and bisect trees) and `finalTree` call a claiming resolver that returns an error
   when the root or the marker cannot be written; the error fails that tree's creation through the path's existing
   error handling (a dispatch fails with `FailureKindWorktree`, the final stage with its tree error). Removal,
   reaping, rewind, recovery-patch and lane-key callers (`cleanup.go`, `rewind.go`, `mutation.go`, `engine.go`,
   `scheduler.go`, `land.go`, `verifier.go`) keep calling `worktreeDir` and need no change beyond what the resolver
   does. `freeFinalTreeDir` keeps appending `-N` to the resolved final tree.
7. **Cross-volume.** A project on another drive than C: gets its trees on C:. `git worktree add` accepts any path:
   with `worktree.useRelativePaths` unset (the default, including git 2.48.1 here) it writes absolute paths into the
   tree's `.git` file and the project's `.git/worktrees/<name>/gitdir`. The Setup junctions (`.arc/setup` ->
   `scripts/worktree-junctions.mjs`) target the main checkout, and NTFS junctions may target any local volume.
   `removeWorktreeDir` unlinks reparse points before removal, wherever they point. A Windows-only test maps a free
   drive letter with `subst` to a temp project, creates a lane tree at the new root, runs git in it and removes it;
   it skips when `subst` is unavailable. This machine has only C:, so a second physical volume is not tested; the
   subst drive exercises git's different-drive-letter path handling, which is the part that could break.
8. **Consumers that recognise engine trees by path.** The claude mod's guard (`claude/arc-mod/hooks/guard-core.ts`,
   `ENGINE_TREE`) refuses `git push`, `git worktree add/remove/move/prune` and branch switches inside an engine tree,
   matched on `.waveterm/worktrees/`. It gains a second match for `[\\/]arc-wt[\\/][^\\/]+` and keeps the legacy one.
   This is the one non-Go change; without it the guard silently stops applying in every new tree. The synced copy
   `cmd/wsh/cmd/claude-mod/hooks/guard-core.ts` is refreshed with `task sync:claudemod`.
9. **Consumers left as they are, and why.**
   - Transcript lookup (`agentsessions.TranscriptForSession`) tries the cwd slug, then globs on the session id, so
     it finds a worker's transcript wherever the tree is.
   - Claude trust (`jarvis.claudeCanonicalRoot`) resolves a tree through its `.git` pointer to the main repository.
   - Usage attribution (`wshserver/usagesessions.go`, `repoRootOf`) cuts a cwd back to a repo by its
     `.waveterm/worktrees` tail; for a session linked to a run it then takes the owner run's `ProjectPath`, and every
     session in an engine tree is a run's. An unlinked session in `arc-wt` would show its tree path as the project;
     none is expected.
   - No code sweeps `.waveterm\worktrees` for orphans; cleanup works per key through `worktreeDir`.
   - `.waveterm\recovery\` patches stay in the project: they are not tree paths.
   - `vitest.config.ts` keeps excluding `**/.waveterm/worktrees/**` while legacy trees exist.
10. **Behaviour change to note.** A worker's Claude Code and pi used to find `CLAUDE.md` / `AGENTS.md` in the
    project's parent directories by walking up from inside `<project>\.waveterm\worktrees\`. From `arc-wt` they find
    only the tree's own (checked-in) copies. A project whose instruction file is untracked loses it for workers;
    that is an edge case, recorded in the guide, not worked around.
11. **Tests point the root at a temp dir, per test.** An exported `UseWorktreeRootForTest(dir) (restore func())` in
    `pkg/orchestrate`, in the same style as `effortstore.UseRootForTest`, and an exported resolver
    `WorktreeDir(projectPath, key) string` for other packages' tests. About 100 orchestrate fixtures use non-UUID
    keys (`run-1`, `owner-1-t-1`) that used to sit in each test's own `t.TempDir()` project; under one shared root
    they would collide and outlive the test. So the repo fixture helpers (`newGitRepo`/`newGitRepoAt` in
    orchestrate, `newLandingRepo` in wshserver) install a per-test root, `t.TempDir()`, once per test, restored by
    `t.Cleanup`. The TestMains also set a per-process temp root as a backstop, so no test writes into the real
    `%LOCALAPPDATA%\arc-wt`. Tests that hard-code the legacy path (`mutation_test.go`, `wshserver_landing_test.go`,
    `wshserver_dag_test.go`) use the resolver; the test that fails a landing tree by putting a file at
    `.waveterm/worktrees` points the root at a file instead.
12. **Dev-app scenarios.** CDP scenarios that create a real run on a temp repo (`fstStartLive` and the like) now get
    their trees under the real `arc-wt`, and deleting the temp dir no longer removes them. If `cancelrun` removes a
    run's trees, the teardown's existing cancel step covers it; if not, the teardown removes the run's landing tree
    before deleting the temp dir. `docs/reference/cdp-run-fixtures.md` says which.
13. **Docs.** `docs/orchestrator-guide.md` (tree locations, cleanup commands, the bisect, final and stalled-task
    sections) and `docs/reference/cdp-run-fixtures.md` name the new root and the legacy fallback. `AGENTS.md` does not
    name `.waveterm\worktrees` and is unchanged. `docs/orchestrator-redesign-flaws.md` is a record of past
    observations and keeps its old paths.

## Interface

In `pkg/orchestrate/worktree.go` (or a new `worktreeroot.go` beside it):

- `worktreeDir(projectPath, key string) string`: unchanged signature, reads only (legacy stat, marker read).
- `claimWorktreeDir(projectPath, key string) (string, error)`: creates the root, claims the marker when the key has
  a UUID prefix and no legacy tree exists, returns the same path `worktreeDir` returns afterwards.
- `WorktreeDir(projectPath, key string) string`: `worktreeDir` exported for other packages' tests.
- `UseWorktreeRootForTest(dir string) (restore func())`.

## Tests (pkg/orchestrate unless named)

- Path mapping: run key, lane key, `-final`, `-base`, `-bisect`, a `-final` stand-in, a non-UUID key.
- Legacy fallback: an existing `<project>\.waveterm\worktrees\<key>` wins for `worktreeDir` and `claimWorktreeDir`;
  an absent one does not.
- Collision: another run's marker for the same prefix sends this run's keys to the full-id path, for creation and
  removal alike; this run's own marker keeps the short path; removing this run's trees leaves the other run's tree
  in place.
- Claim race: two claims for different runs with one prefix, run concurrently, end with one short owner and one
  full-id path.
- Creation sites: `EnsureRunWorktree`, `finalTree`, `withDetachedTree` create under the test root and write the
  marker; a root that cannot be created fails the creation with an error naming the path.
- Cross-volume (Windows, subst): see decision 7.
- Guard (vitest, `claude/arc-mod/hooks/guard-core.test.ts`): a cwd under `...\arc-wt\<8>-t-1\sub` is an engine tree;
  a legacy cwd still is; an unrelated path containing `arc-wt` as part of a longer name (`my-arc-wtx`) is not.
