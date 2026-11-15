# Vault sync across machines — design

Status: design settled 2026-10-01.

## Problem

Arc runs on two Windows machines (home and work), both left running, used one at a time. Each keeps its
own state: the Wave Vault (`memory:vaultpath`, a local git repo — memory, tasks, decisions, skills,
steering, attributions) has no remote, initiatives (`waveobj.Effort`) live in each machine's SQLite store,
and the Jarvis profile and settings live in each machine's config dir. Switching machines means working
from a different, stale copy of all of it.

Goal: the vault, initiatives, the Jarvis profile and the portable settings are the same on both machines,
synced through a private git repo the user creates, with nothing to remember on a switch.

## Decisions

1. **The git remote is the only switch.** Sync is on iff the vault has an `origin` remote. No setting holds
   the URL or an on/off flag: git config already holds the URL (a setting would be a second source), and
   git config is per-machine, whereas settings become partly synced in stage 3. Pausing is
   `git remote rename origin origin-paused`.
2. **Automatic triggers.** Pull on a 15-minute timer and on window focus; push 5s after the last vault
   write (debounced, so a burst ships as one push); `wsh vault sync` on demand.
3. **Initiatives are one JSON file per effort** — `<vault>/efforts/<oid>.json`, the `Effort` struct
   indented. Lossless, no parser; not meant for hand-editing.
4. **Conflicts merge, else keep both; sync never blocks.** Effort files get a field-aware three-way merge;
   `config/settings.json` gets a key-level three-way merge.
   Any other conflicted file keeps the local side in place and saves the remote side under `conflicts/`.
5. **Projects stay local.** `projects.json` maps names to machine paths; an effort's `Project` is a free
   string, so it matches once both machines register the same name.

## Stage 1 — sync engine

### Setup

`wsh vault remote <url>` sets `origin` (`git remote add`, or `set-url` if present) and runs the first
sync. On the second machine the two vaults have unrelated histories; the first merge uses
`--allow-unrelated-histories`. Identically seeded files (skills, steering) merge clean; differing ones
follow the conflict rule.

Settings > Memory shows the remote URL and the last sync status, read from git and the sync status. Its
URL field writes `git remote set-url` (or `add`/`remove`) through an RPC; it stores no setting.

### `Sync()` — `pkg/wavevault/sync.go`

Under the vault lock (below):

1. If `MERGE_HEAD` exists (an interrupted merge), `git merge --abort`.
2. `Commit("sync: local changes")` — the existing ownership-staged commit, so human edits made outside
   Arc ride along.
3. `git fetch origin`.
4. `git merge origin/main` (merge, not rebase: conflicts resolve once, not per local commit).
5. For each conflicted path (`git diff --name-only --diff-filter=U`):
   - `efforts/*.json`: read stages `:1` (base), `:2` (ours), `:3` (theirs); write `MergeEffort(base, ours,
     theirs)`; `git add`.
   - anything else: keep `:2` in place, write `:3` to `conflicts/<original path>` (outside every scanned
     collection, so a conflict copy is never indexed as a duplicate note); `git add` both.
   - `config/settings.json`: `MergeSettings(base, ours, theirs)` — per key against the base, compared by
     parsed value: changed on one side → that side (a deletion counts as a change); changed on both → ours,
     except that an edit outlives a concurrent delete; `git add`. First join (no base) is the union with ours
     winning a clash, so neither machine's migrated settings are lost.
   - modified on one side, deleted on the other: the side that still has the file wins, with no conflict copy.
   - If any stage fails to parse (malformed effort or settings JSON), treat the path as "anything else".
6. Commit the merge; `git push origin HEAD:main`.
7. On a non-fast-forward rejection, repeat 3–6 once; a second rejection is a sync failure.

Git runs with `GIT_TERMINAL_PROMPT=0` and `GCM_INTERACTIVE=never` so a background sync never opens a
credential dialog. Credentials are set up once by the user (Git Credential Manager or an SSH key).

### Locking

`OpenVault` builds a fresh `*Vault` per call, so `Vault.mu` cannot serialize across callers. A
package-level lock keyed by the cleaned vault root serializes `Sync`, `Commit`, and effort-store writes, so
a capture commit or an effort write never interleaves with a merge. The lock is not reentrant: `Commit`
takes it and delegates to an unlocked `commitLocked`, which `Sync` step 2 calls directly.

### Triggers — `vaultsync` loop in wavesrv

- 15-minute ticker.
- `Poke()`: called after every Arc vault write (`Commit` and effort-store writes); debounced 5s.
- `VaultSyncCommand` RPC: the frontend calls it on window focus, throttled to once a minute; `wsh vault
  sync` calls it unthrottled.
- Single-flight: a trigger during a running sync sets a "run again" flag instead of queuing.

### Status

`wsh vault status` (and the `VaultStatusCommand` RPC behind it): remote URL, last success time, last error,
open conflict copies under `conflicts/`, malformed effort files. A sync failure raises one cockpit notice
(the existing notify path) on the first failure of a streak, not on each retry; each new conflict copy
raises one notice.

### What needs no reload

Memory scanners, the steering doc, skills projection (at each agent launch), and the profile already read
from disk on demand, so pulled changes appear on the next read. Efforts and settings are covered in their
stages.

## Stage 2 — initiatives in the vault

Today every effort read and write goes through `pkg/wstore/wstore_effort.go` (`CreateEffort`, `GetEffort`,
`GetAllEfforts`, `UpdateEffort`) plus one `wstore.DBDelete` in `wshserver_effort.go`; callers are
`pkg/jarvis/effortops.go`, `pkg/jarvisstate/{effortlink,fetch}.go`, `pkg/orchestrate/verify.go`, and
`pkg/wshrpc/wshserver/wshserver_{effort,dag,runs}.go`. The frontend reads efforts only over RPC.
Measured 2026-10-01: 48 efforts, 2.2 MB total, largest 477 KB.

### `pkg/effortstore`

Same signatures — `Create`, `Get`, `GetAll`, `Update(oid, fn)`, `Delete` — backed by
`<vault>/efforts/<oid>.json` (`json.MarshalIndent`, for line diffs). Callers change their import only; the
RPC surface, generated bindings and frontend are unchanged. `Create`/`Update` keep today's semantics
(new OID, default status, `Version++`, `UpdatedTs`).

- **Atomic update:** a per-OID mutex; read, apply `fn`, write a temp file, rename over. `fn` returning an
  error leaves the file untouched (today's transaction rollback). Writes also take the vault lock briefly.
  Only wavesrv writes (wsh goes through RPC), so in-process locks suffice.
- **Reads:** `GetAll` parses `efforts/*.json`, cached per file by mtime and size, so a file changed by a
  pull or edited by hand is re-read. Sorted by `UpdatedTs` desc as today.
- **Malformed file:** skipped and logged; `GetAll` returns the rest; `Get` returns an error naming the
  file; listed in `wsh vault status`.
- **Writes don't commit:** they `Poke()` the sync loop; sync step 2 commits them.

### Migration

At startup, if the `db_effort` table has rows: write each to `efforts/<oid>.json` (skipping an OID whose
file already exists), then delete the row. Each machine migrates its own efforts; distinct OIDs mean the
first sync unions them without conflict. The `effort` otype stays registered and its table stays (empty)
— no SQL migration, and `effort:` orefs keep resolving.

### `MergeEffort(base, ours, theirs)`

Pure function, three-way against git's base (stage 1; empty when the file is new on both sides):

- **Scalar fields** (`Title`, `Project`, `Ticket`, `Status`, `ParentOID`, `Meta`): from the side with the
  newer `UpdatedTs`.
- **Chunks**, keyed by `Label`: on one side only and absent from base → added, keep. In base, missing on
  one side, unchanged on the other → removed. Missing on one side and changed on the other → keep the
  changed one (an edit outlives a concurrent delete). On both sides → the chunk with the newer
  `UpdatedTs`, with `Notes` and `WorkRefs` merged as below.
- **Notes, Events, chunk Notes, WorkRefs:** a set merge against the base, by full value: kept on both
  sides → kept; added on either side → kept; in base and dropped by either side (removed, or edited into a
  new value) → dropped. With no base this is the union. De-duplicated, sorted by `Ts`.
- **Chunk order:** the newer side's order; chunks only on the other side appended in their order.
- **Version:** `max + 1`; **UpdatedTs:** max.

### Cross-machine workrefs

A `ChunkWorkRef` can name a run or agent session that exists only on the other machine. The frontend
loads workrefs but no component renders them, so an unresolvable ref is inert.

### Freshness in the UI

The Brief reloads its briefing on entry and `effortDetailIsFresh` compares `updatedts`, so pulled changes
appear on the next Brief entry.

## Stage 3 — Jarvis profile and settings

### Profile

`jarvis-profile.json` moves from the config dir to `<vault>/config/jarvis-profile.json`.
`LoadGlobalProfile` / `SaveGlobalProfile` change their path only. Startup migration moves a local file
into the vault when the vault has none. If both machines had one, the first sync conflicts and the
general rule applies (local kept, remote under `conflicts/`).

### Settings layer

Read order: defaults → `<vault>/config/settings.json` → local `settings.json` (local wins).

- **Machine-local keys** — `memory:vaultpath`, `jarvis:vaultpath`, `term:gitbashpath`,
  `term:localshellpath`, `term:localshellopts` — one named set in `wconfig`; never written to the vault
  layer, ignored if found there.
- **Write routing** (`SetBaseConfigValue`): a machine-local key, or a key the local file already defines,
  writes to the local file; every other key writes to the vault layer. A deleted key (`nil`) is removed
  from whichever file holds it.
- **Migration:** at startup, local keys that are not machine-local move into the vault layer once
  (vault-layer value wins if both exist). When both machines migrate before their first sync, the
  key-level merge of `config/settings.json` (stage 1, `Sync()` step 5) unions them.
- **No bootstrap cycle:** the vault path is a setting. `wconfig` resolves it from defaults + local only —
  exact, because the vault-path keys are machine-local. The resolution moves from `memroots.VaultRoot`
  into `wconfig`; `memroots` delegates to it.
- **Reload:** the config watcher also watches `<vault>/config/`, so a pulled settings change reloads as a
  local edit does; when `memory:vaultpath` changes it drops the old watch and adds the new one.

## Error handling

Sync failures never block local work; the vault stays a working local repo and the next trigger retries.
Every failure is logged to `waveapp.log` with the git command and its stderr, recorded in status, and
noticed once per streak. A crash mid-merge is recovered by `merge --abort` on the next sync; a merge only
adds a commit, so local commits are never lost. No `git` on PATH or no `origin` → sync is off, and status
says which.

## Testing

- **Sync (real git, no mocks):** two vaults plus a bare repo in `t.TempDir()`. Cases: each side commits
  and syncs; both edit the same effort (field-aware result); both edit the same note (conflict copy under
  `conflicts/`, local kept); joining unrelated histories; push rejected by a race (retry succeeds);
  recovery from an interrupted merge; no remote is a no-op.
- **`MergeEffort`:** table tests — chunk add/remove/edit on each side, edit-vs-delete, note/event union and
  de-dup, scalar newer-wins, order.
- **`MergeSettings`:** table tests — one-side change, both-side change (ours), deletion vs unchanged,
  no-base union.
- **`effortstore`:** the existing `wshserver_effort*_test.go` suites pass unchanged against the new store;
  new tests for the mtime cache, malformed-file skip, failed-`fn` leaves the file untouched, migration.
- **Settings/profile:** layer order, write routing, machine-local keys never reach the vault layer,
  migration, vault path resolved without the vault layer.
- **Frontend:** the focus trigger and Settings > Memory view are thin; verified manually over CDP.

## Delivery

Three stages, each shippable alone, one plan with three task groups:

1. Sync engine, `wsh vault remote|sync|status`, focus trigger, Settings > Memory view — already syncs
   memory, tasks, decisions, skills, steering, attributions.
2. Initiatives in the vault.
3. Profile and settings layer.

## Out of scope

- Projects (`projects.json`) — local by decision 5.
- Runs, DAGs, tabs, blocks, channels — bound to local worktrees, processes and terminals.
- Radar reports (derived from local transcripts), `data/jarvis/prompts/` (per-run), `secrets.enc`.
- A sync on/off or interval setting (decision 1).
