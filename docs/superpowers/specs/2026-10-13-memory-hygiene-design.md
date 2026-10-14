# Memory hygiene: Arc prunes Claude Code's auto memory, you approve

Status: design, 2026-10-13. Mockup: `.superpowers/design/memory-hygiene/project/` (local only, never
committed). Its four boards are the visual spec: `Main` (waveterm, ordinary changes), `Split`
(cyber_assistant getting its own memory), `SplitGate` (the switch-over held), `ChangedOnDisk` (a
conflict).

## Problem

Claude Code's auto memory keeps an index, `MEMORY.md`, plus topic files in
`~/.claude/projects/<slug>/memory/`. A session loads the first 200 lines or 25 KB of the index; topic
files are read on demand. When a write takes the index near or past either limit, Claude Code tells the
session to shrink it. That notice keeps firing here, and Claude is poor at the fix: it trims recent
lines and keeps stale ones, because it can't tell what's stale without evidence it doesn't gather.

Arc can gather that evidence: which files a memory names still exist, whether its rule is already in
CLAUDE.md or AGENTS.md, and how often sessions actually open it. With that evidence, a model can
propose good changes. So Arc checks each project's memory every week (and on demand), proposes
changes with evidence, and applies only the ones you accept. Every applied change can be undone.

**Done means:** every registered project's index stays well under both limits without a session
stopping to prune it. Each change Arc proposes shows its reason and its diff before it's applied.
Nothing is lost that you can't restore for 30 days.

Scope: Claude Code only. Pi (`~/.pi/agent/memory`) and Codex (`~/.codex/memories`) are deferred
(below).

## Where a project's memory lives (measured 2026-10-13)

- **One memory per git repo.** Claude Code docs: "All worktrees and subdirectories within the same git
  repository share one auto memory directory." So a session started in
  `SIEM/src/cyber_ai/cyber_assistant` loads SIEM's index (134 lines, 16.8 KB, 198 memories), most of
  which is about cyber_anomaly_detector and MP-Frontend.
- **Other state is keyed by the launch folder.** Transcripts, CLAUDE.md/AGENTS.md and `.claude/`
  settings follow the folder a session starts in. No session has ever started at the SIEM root (0
  transcripts there); all SIEM work starts in the subprojects Arc registers.
- **`autoMemoryDirectory` overrides the folder.** It's honored in any settings scope. Probed on Claude
  Code 2.1.296 (`claude -p`, scratch repo): `sub/.claude/settings.local.json` setting it made a session
  started in `sub/` load the custom folder, while a session at the repo root kept the default. Not
  probed: interactive mode (the docs say project-file settings need workspace trust; SIEM is trusted),
  and writes into the custom folder.
- **Slugs.** Claude Code names a folder by turning every non-alphanumeric character of the path into
  `-` (`agentobserve.SlugifyCwd`); the drive letter's case follows how the cwd was spelled
  (`c--…-cyber-ai-cyber-assistant` and `C--…` both exist), so matching is case-insensitive. Arc's old
  memory harvester used `memroots.ProjectHash` (only `\ / :` become `-`), which left dead
  folders such as `C--Users-kael02-IdeaProjects-SIEM-src-cyber_ai-cyber_assistant/memory` (62
  files, no index). No session loads them.
- **The three subproject `settings.local.json` files are gitignored** (SIEM `.gitignore:39`
  `**/.claude/`; webapp `.gitignore:37`). Arc writing one never shows in a diff.

### Discovery rule

For each project in the registry (`memroots.RegistryProjects`):

1. If `autoMemoryDirectory` is set (launch folder `.claude/settings.local.json`, then
   `.claude/settings.json`, then `~/.claude/settings.json`), that's its folder.
2. Otherwise its folder is `~/.claude/projects/<SlugifyCwd(git toplevel)>/memory`, where git toplevel
   is `git -C <path> rev-parse --show-toplevel` (the path itself when it's not a repo). The folder must
   exist; a project with none has nothing to check.
3. A folder that two or more registered projects resolve to is **shared**. A sharing project gets the
   split (below) and no ordinary checks: proposing trims to a folder three projects load would list the
   same change three times, and the split removes the need.

Transcripts for read counts: every folder under `~/.claude/projects` whose name equals
`SlugifyCwd(path)` or starts with `SlugifyCwd(path) + "--"` (worktrees under the project, such as
`.worktrees` and `.claude/worktrees`), case-insensitive, skipping `agentobserve.HeadlessAgentSlug()`.

## Each project gets its own memory (the split)

The user chose to make memory follow Arc's projects. For a sharing project, the Memory tab shows the
changes that give it its own folder, reviewed like every other change (board `Split`):

- **Its own folder** is the dead harvester folder `~/.claude/projects/<ProjectHash(path)>/memory`
  when that exists, since it already holds the project's leftovers. Otherwise it's
  `~/.claude/projects/<SlugifyCwd(path)>/memory`. Either way the path is set explicitly, so its name
  doesn't need to match Claude Code's.
- **From the shared memory.** The model sorts each shared memory by the registered projects it applies
  to, plus `other` (anything about an unregistered part of the repo). Code turns that sort into changes:
  - applies only to this project: **Move here** (delete from the shared folder, add to its own, and
    move its index line);
  - applies to this project and others: **Copy here** (the shared copy stays);
  - a memory whose index line links several files moves or copies them together (the gap hub and its
    11 files are one change).
  - Once every project a memory applies to has switched to its own folder, and `other` isn't among
    them, the next check proposes **Remove from SIEM** under the last project to switch.
- **Already in its own folder.** The harvester's leftovers get the ordinary changes (Delete, Merge,
  Add to index) before anything loads them.
- **Switch over.** One **Settings** change writes `autoMemoryDirectory` into
  `<path>/.claude/settings.local.json`. It stays disabled while any change from the shared memory is
  still to review (board `SplitGate`), because switching first would drop those memories from the
  project's sessions. "Keep as is" on it leaves the project sharing, and it's not checked: while the
  Settings change is kept, the weekly sweep skips the project, and its rail status reads "Kept
  sharing". **Check now** still runs a check, and **Review again** on the Settings change lets the
  sweep pick it up again. Kept moves stay kept while their files don't change.

Sessions started at the repo root keep the shared folder. Running sessions keep the folder they loaded
until they restart.

## Change kinds

| Kind | Apply does |
|---|---|
| Delete | Deletes the file and its index line. |
| Trim | Replaces one exact passage in the body (and optionally the index line) with a shorter one. |
| Merge | Writes one file from two or more, deletes the others, replaces their index lines with one. |
| Move to AGENTS.md | Adds a drafted passage to the end of a named section of the project's instruction file, then deletes the memory and its index line. The target is `CLAUDE.md` when the project has one, else `AGENTS.md` (the file Claude Code loads), and the label names it. The edit stays uncommitted in the working tree. |
| Add to index | Adds an index line for a file the index doesn't link, and drops harvester frontmatter (`source`, `source_hash`, `harvested_at`). Creates `MEMORY.md` if missing. |
| Move here / Copy here / Remove from SIEM | The split's file moves, above. |
| Settings | Inserts or replaces the one `autoMemoryDirectory` key, leaving every other byte of the file as it was. Refuses a file that isn't a JSON object. |

## The check

Runs weekly per project (an hourly ticker, like `jarvisvolunteer.StartLooseEndSweep`, that checks
projects whose last check attempt is 7 days old, so restarts don't reset the clock and a failed check
waits a week rather than calling the model every hour) and on **Check now**, which runs at any time.

1. **Inventory.** Read the folder: the index lines, and each file's frontmatter, body, size and
   sha256.
2. **Evidence**, in code:
   - repo paths and `file:line` references the body names that are gone or out of range;
   - commit hashes it names that aren't on the default branch;
   - files the index doesn't link, and index links to files that don't exist;
   - harvester frontmatter;
   - dated claims: a date in the body ("Verified 2026-07-24", "since 07-21") and its age, so the
     judge can tell a one-off note from a rule. Age alone never proposes a change;
   - read counts: sessions whose transcript has a `Read` tool call on that file, and the last such
     read. A name match alone counts for nothing, since the index text is in every session.
   - the project's CLAUDE.md/AGENTS.md and the global `~/.claude/CLAUDE.md`, passed to the judge so it
     can spot a memory that repeats them.
   The regex "self-stale" checks in `~/.claude/scripts/memory-audit.mjs` aren't ported: they gave false
   positives on all 4 live entries checked.
3. **Hash gate.** A memory whose sha256 and evidence match the last check, and that has no open change,
   isn't judged again. A change you kept stays kept until one of its files changes.
4. **Judge.** One headless run per batch (`consult.HeadlessSpecForTier(consult.TierCapable)`, cwd
   `wavebase.HeadlessAgentCwd()`). It returns JSON: a list of changes in the kinds above, each with a
   title, its files, its evidence lines and the exact text. Batches hold up to 60 KB of memory bodies in
   index order, so related entries share a batch. Every batch also gets the whole index, so it knows
   what else exists, but merges are proposed only within a batch. The judge gets no file tools:
   everything it needs is in the prompt, and Arc applies the result. Same guard as the radar audit
   session's allowlist stream: the default headless runtime (openrouter) has no tools; a CLI runtime
   runs with every tool off (claude `--tools "" --strict-mcp-config`), and a session whose `init`
   event lists any tool fails the check. The split's sort is one run over each shared memory's index line and
   frontmatter `description` (about 40 KB for SIEM).
5. **Validate**, in code. Drop a change (and log why) if a file it names isn't there, if a Trim's old
   passage doesn't appear exactly once, if a Move to AGENTS.md section heading doesn't appear exactly
   once, if a Merge names fewer than two files, if an index line it writes is more than one line, or
   if it would add an index line for a file already linked.
6. **Store** the result, with each touched file's sha256 at check time.

A failed judge run keeps the last good result and shows "Last check failed: <reason>" on the project.

## Apply, keep, undo

- **Apply** re-hashes every file the change touches. Any mismatch marks it "Changed on disk since the
  check" with **Check again** (board `ChangedOnDisk`), and nothing is written. Otherwise Arc copies the
  originals to `<data dir>/memhygiene/backups/<applyId>/` with a manifest, then writes each file
  atomically (temp file + rename).
- **Keep as is** records the verdict against the change's identity (kind + files + their hashes). It
  applies only to an open or conflicting change; **Review again** only to a kept one. Arc refuses
  either on any other status, naming it.
- **Undo** restores the backup if every file still has the hash Arc wrote. Otherwise it reports which
  file changed and doesn't write anything. **Review again** reopens a kept change.
- The sweep deletes backups older than 30 days. The rail shows the expiry date ("kept a copy of the
  old files until Nov 12").

State lives in `<data dir>/memhygiene/<project>.json`: last check time and error, the proposals, the
verdicts and the apply records. JSON, not a waveobj: it's per-project files Arc owns, with no
cross-object queries, so it needs no migration.

The state also records what the check resolved: the project's loaded folder, its own folder during a
split, and each index's lines and bytes (re-measured after every apply and undo). Listing reads the
state files and the registry and never re-runs discovery, so the tab costs no disk walk, and a
fixture state pointing at temp folders renders and applies exactly like a real one. A registered
project with no state file lists as "Not checked yet".

## UI

A third Setup tab, **Memory**, next to Instructions and Skills (`setupsurface.tsx` `TABS`,
`SetupTab` in `setupstore.ts`). Layout and copy follow the mockup:

- **Toolbar status:** "N projects to review".
- **Left rail:** every registered project with a meter of its loaded index (or "Shares SIEM's memory
  · 134 lines") and its status.
- **Center:** the project's check line ("Checked today at 09:12 · 69 memories, 1,232 sessions · next
  check Oct 20"), **Check now**, and an index card. During a split there are two cards: the shared
  index and the project's own, each with "After the changes still to review: …". Below them is the
  table of changes, grouped during a split.
- **Right rail:** the selected change's kind, Why (evidence), Change (diff blocks), note, and
  **Keep as is** / the kind's apply label. Once a change is decided, the rail shows its outcome with
  **Undo** or **Review again**.

Pure logic (meters, the after-totals, the switch-over gate, grouping) goes in `memorymodel.ts` with
`memorymodel.test.ts`. The surface is a thin consumer: the tab is its own `setupmemory.tsx` with its
atoms and loaders in `memorystore.ts` (all in `frontend/app/view/agents/`), so `setupsurface.tsx`
only gains the tab entry and its toolbar status.

## Notification

A `MemoryHygieneProducer` in `pkg/jarvisvolunteer` for `TriggerSweep` emits one candidate per project
with changes to review: `ID` `memory-hygiene:<project>:<checkedAt>`, `At` = the check's time (the
fact's own stamp, so an unchanged result dies at the frontend watermark), `SourceType` `memhygiene`,
`SourceRef` `memhygiene:<project>`. Not `memory`: `address.ts` already parses `memory:<id>` as a
memory note (persisted turns still carry it), and `SourceType` `memory` means a vault note.
`address.ts` gains a `memhygiene` target and `openref.ts` lands it: it sets the Setup tab to Memory,
selects the project and switches surface. It isn't peekable (like `canvas`): opening it is the landing. The judge may decline to say it. The Setup toolbar stays the
source of truth.

## Wire

`wshrpctypes_memhygiene.go`:

- `ListMemoryHygieneCommand`: every project's state.
- `CheckMemoryHygieneCommand {project}`: starts a check and returns at once. A check runs model calls,
  so it can't fit the 5 s RPC budget.
- `DecideMemoryChangeCommand {project, changeid, verdict: apply|keep|undo|reopen}`: file work only.

Every state write publishes `memhygiene:update` (`wps.Event_MemHygieneUpdate`, no payload), and the
tab re-lists on it.

## Package

`pkg/memhygiene`: `discover.go` (folders, sharing, transcripts), `evidence.go`, `judge.go` (prompt,
batches, parse), `validate.go`, `apply.go` (apply, undo, backups, settings edit), `split.go`,
`store.go`, `sweep.go`. Started from `cmd/server/main-server.go` beside `StartLooseEndSweep`.

## Testing

- **Go, temp dirs with a real `git init`:** discovery (git toplevel, the `autoMemoryDirectory`
  precedence, case-insensitive slugs, shared detection, worktree transcript prefixes); evidence (gone
  path, line past end, commit not on main, unlinked file, Read-tool counts that ignore bare-name
  matches); hash gate; validation, one test per drop rule; apply/undo for each kind; conflict on
  apply and on undo; backup expiry; the settings edit (insert, replace, other bytes unchanged,
  non-object refused); the split reducer (one project gives Move, several give Copy, all switched
  gives Remove, linked files grouped); the judge parse with a stubbed `consult.Run` (malformed JSON
  keeps the last result).
- **Vitest:** `memorymodel.test.ts`.
- **CDP:** a `setup-memory` scenario that writes a fixture state whose memory folders sit in a temp dir,
  then opens Setup → Memory and captures: a project with ordinary changes, a split with the switch gated,
  an applied change with Undo, and a conflict. Applying in the scenario touches only the temp folders.
  It arranges for real, with no new test hook: `createproject` registers fixture projects on temp
  `git init` repos, `waveinfo` gives the data dir, and it writes `<data dir>/memhygiene/<project>.json`
  naming temp memory folders with their real hashes. Editing one temp file after that is the
  conflict. It never clicks Check now and never reads or writes `~/.claude`.
- **Live, once, by hand:** an interactive `claude` session in a switched subproject loads its own
  index and writes new memories there (the two probe gaps above); and a sweep with changes to review
  passes the volunteer judge at least once. No run can do these, so they ship as follow-ups recorded
  in `docs/open-issues.md`, with the steps to do them.

## Deferred

- Pi and Codex memory (`~/.pi/agent/memory`, `~/.codex/memories`): same model, different folders and
  loaders. Recorded in `docs/deferred.md` when this ships.
- Merges across batches.
- A numeric retention score, and least-recently-read ordering when an index is over budget (LRU,
  LFU, TTL as eviction rules). Read counts miss most use, since the index line is loaded every
  session, so recency alone would evict rules whose hook does the work. Revive if a few weekly
  checks show the judge's proposals don't keep indexes under budget.
- `docs/deferred.md` "The memory subsystem, removed" says to revive only on evidence that note bodies
  change behavior. This doesn't revive recall or harvesting. It keeps the index small and current,
  and the index is what that measurement found drives behavior.
