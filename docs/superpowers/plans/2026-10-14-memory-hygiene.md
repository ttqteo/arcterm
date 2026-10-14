# Memory hygiene implementation plan

**Spec:** `docs/superpowers/specs/2026-10-13-memory-hygiene-design.md`
**Verify:** `node scripts/verify.mjs ./pkg/memhygiene ./pkg/jarvisvolunteer ./pkg/wshrpc/... ./pkg/wps ./pkg/tsgen ./cmd/server`
**Check:** `go vet ./pkg/... ./cmd/server/... && task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs setup-memory surface-smoke`
**Prototype:** C:/Users/kael02/IdeaProjects/waveterm/.superpowers/design/memory-hygiene/project/Main.dc.html

**Goal:** Arc checks each registered project's Claude Code auto memory weekly and on Check now, proposes changes with evidence, and applies only the ones the user accepts. Every applied change can be undone.

**Architecture:** A new Go package `pkg/memhygiene` handles discovery, inventory and evidence, the judge and validation, the split, apply and undo, and the check pipeline and weekly sweep. It keeps per-project JSON state under `<data dir>/memhygiene/` and is reached over three wshrpc commands plus a `memhygiene:update` event. The Setup surface gets a third tab, **Memory**: a thin `setupmemory.tsx` over a pure `memorymodel.ts`. A `MemoryHygieneProducer` in `pkg/jarvisvolunteer` raises a volunteer card that opens the tab through the `memhygiene:<project>` address.

**Tech stack:** Go (wavesrv), wshrpc + `task generate`, React 19 + jotai + Tailwind 4, vitest, raw-CDP scenario harness.

## Worker and reviewer brief (applies to every task)

Read the spec and AGENTS.md before you start. The spec is the source of truth. Its copy and layout come from the mockup boards in the Prototype folder (`Main`, `Split`, `SplitGate`, `ChangedOnDisk`). The folder is gitignored, so read it at its absolute path. The boards' sample names, counts and paths are illustration, not constants. The mockup's raw hex colors map onto the existing `@theme` tokens in `frontend/tailwindsetup.css`. Introduce no new tokens.

Do not spawn subagents or forks. Prefer simple, direct code over enterprise over-engineering. Apply SOLID, KISS, YAGNI and DRY, and keep one source of truth. Don't abstract for a single implementation. Handle errors at boundaries, never swallow them silently, and give every error message its context. Read the exports, the callers and the existing helpers before writing code. Add no new dependencies. Make no unrelated refactors, and don't reformat files you didn't otherwise change. Comments say only why, in lower case. Never hand-edit generated files: change the Go source and run `task generate`. Every test must fail when the behavior it names is violated. Run only the focused tests your task names, plus the Check line. Verify runs the rest.

Go tests use temp dirs with a real `git init` (see `scripts/cdp/scenarios.mjs` `git()` for the author env). No test may read or write the real `~/.claude`: every function that touches Claude Code's files takes the Claude home (`~/.claude`) as a parameter. Production passes `filepath.Join(wavebase.GetHomeDir(), ".claude")`.

## Global constraints

- Claude Code loads the first 200 lines or 25 KB of `MEMORY.md`: `LimitLines = 200`, `LimitBytes = 25000`, one definition in Go and one in `memorymodel.ts`.
- Weekly cadence: an hourly ticker checks projects whose last check is 7 days old or more. The clock survives restarts.
- Backups live in `<data dir>/memhygiene/backups/<applyId>/` with a manifest. The sweep deletes them after 30 days.
- State lives in `<data dir>/memhygiene/<file-safe project>.json`. It's JSON, not a waveobj, so it needs no migration.
- The judge uses `consult.HeadlessSpecForTier(consult.TierCapable)` with cwd `wavebase.HeadlessAgentCwd()` and no tools. Batches hold up to 60 KB of memory bodies.
- Harvester frontmatter keys: `source`, `source_hash`, `harvested_at`.
- Notification: `SourceType` `memhygiene`, `SourceRef` `memhygiene:<project>`, `ID` `memory-hygiene:<project>:<checkedAt>`, `At` = checkedAt.
- Event: `wps.Event_MemHygieneUpdate = "memhygiene:update"`, with no payload.
- Every file write is atomic (temp file in the same dir, then rename). It preserves the file's existing line endings (CRLF or LF) and a leading UTF-8 BOM.
- Scope is Claude Code only.

## Review focus

1. **A check finishing while the user applies or undoes.** The check must not overwrite the apply record or a verdict made during it. Every state write goes through one per-project lock that re-reads the file and merges. Task 1 owns the lock and its test. Task 7 owns the merge and its test.
2. **A `MEMORY.md` with CRLF line endings, or a BOM.** An index line still matches, removal leaves the rest byte-identical, and an added line uses the file's ending. Task 3 (parse) and Task 5 (write) each test it.
3. **A judge reply wrapped in prose or a json code fence, or truncated.** Parse takes the JSON out of the fence or prose. Truncated JSON is a parse error that keeps the last result. Task 4 tests it.
4. **A project name with a character a filename can't hold** (`/`, `:`, `*`, `?`, or a space). It maps to a distinct, stable file, and two names never share one. Task 1 tests it.
5. **A registered path that is gone, is not a git repo, or has no memory folder.** Discovery skips it and gives the reason (missing path), or falls back to the path itself (not a repo). List shows the project as having nothing to check, with no crash or error toast. Task 2 and Task 1 test it.

---

### Task 1: Wire types, state store and the update event
**Depends on:** none
**Files:** `pkg/memhygiene/types.go`, `pkg/memhygiene/store.go`, `pkg/memhygiene/store_test.go`, `pkg/memhygiene/entry.go`, `pkg/memhygiene/textfile.go`, `pkg/memhygiene/textfile_test.go`, `pkg/wshrpc/wshrpctypes_memhygiene.go`, `pkg/wshrpc/wshrpctypes.go`, `pkg/wshrpc/wshserver/wshserver_memhygiene.go`, `pkg/wps/wpstypes.go`, `pkg/tsgen/tsgenevent.go`, `pkg/wshrpc/wshclient/wshclient.go`, `frontend/app/store/wshclientapi.ts`, `frontend/types/gotypes.d.ts`, `frontend/types/waveevent.d.ts`

This task builds the wire and state shapes every other task uses, and it is the only task that edits wshrpc types or runs `task generate`.

**Wire types** (`wshrpctypes_memhygiene.go`, composed into `WshRpcInterface` as `MemHygieneCommands`). These are also the stored shape, one source of truth:

```go
type MemHygieneCommands interface {
    ListMemoryHygieneCommand(ctx context.Context) (*CommandListMemoryHygieneRtnData, error)
    CheckMemoryHygieneCommand(ctx context.Context, data CommandCheckMemoryHygieneData) error           // starts a check, returns at once
    DecideMemoryChangeCommand(ctx context.Context, data CommandDecideMemoryChangeData) (*MemHygieneProject, error) // file work only
}
type CommandListMemoryHygieneRtnData struct { Projects []MemHygieneProject `json:"projects"` }
type CommandCheckMemoryHygieneData struct { Project string `json:"project"` }
type CommandDecideMemoryChangeData struct { Project, ChangeId, Verdict string } // json: project, changeid, verdict; verdict apply|keep|undo|reopen

type MemHygieneProject struct {
    Project, Path string
    CheckedAt, NextCheckAt int64   // unix ms; 0 = never checked
    Checking bool
    LastError string               // "" or the last failed check's reason; the last good result stays
    Memories, Sessions int
    Folder string                  // the memory folder its sessions load today
    SharedWith []string            // other registered projects loading Folder; empty = its own
    OwnFolder string               // split target; "" unless sharing or formerly sharing
    FormerShared string            // the shared folder it loaded before switching over
    SwitchedAt int64
    Index MemIndexStats            // Folder's MEMORY.md
    OwnIndex *MemIndexStats        // OwnFolder's, during a split
    Changes []MemChange
}
type MemIndexStats struct { Exists bool; Lines, Bytes int }
type MemChange struct {
    Id string        // identity: sha256 of kind + sorted file paths + their hashes; same identity across checks
    Kind string      // delete|trim|merge|move-to-doc|add-to-index|move-here|copy-here|remove-shared|settings
    Group string     // ""|shared|own|switch (the split's three groups)
    Title, Note string
    ApplyLabel string             // the rail button label ("Apply trim", "Move to CLAUDE.md", "Switch memory"...)
    Effect string                 // table cell ("Index −135 B", "12 files · 33 KB")
    Files []MemFileRef            // every file the change touches, with sha256 at check time ("" = must not exist yet)
    Evidence []MemEvidence
    Diffs []MemDiff
    IndexDelta, OwnIndexDelta MemIndexDelta // effect on Folder's / OwnFolder's MEMORY.md
    Op MemOp
    Status string                 // open|applied|kept|conflict
    ConflictFile string           // the file whose hash changed, for "Changed on disk since the check"
    DecidedAt, BackupUntil int64
    ApplyId string
}
type MemFileRef struct { Path, Sha256 string }
type MemEvidence struct { Tone, Text, Code string } // tone ok|warn|none; Code is the monospace tail
type MemDiff struct { Path, Note string; Lines []MemDiffLine }
type MemDiffLine struct { Sign, Text string }       // sign "-", "+" or " "
type MemIndexDelta struct { Lines, Bytes int }
type MemOp struct {                                  // what apply writes; folders are absolute
    Folder string             // the folder the memory files live in (the source, for split moves)
    Memories []string         // memory file names in Folder the change acts on
    Old, New string           // trim: exact passage and its replacement
    IndexRemove []string      // exact index lines removed from Folder's MEMORY.md
    IndexAdd string           // one index line added (to IndexFolder's MEMORY.md)
    IndexFolder string        // defaults to Folder
    WriteName, WriteBody string // merge: the file written
    DocPath, DocSection, DocPassage string // move-to-doc
    ToFolder string           // move-here / copy-here destination
    SettingsPath, SettingsValue string // settings: file and the autoMemoryDirectory value
    StripHarvester bool       // add-to-index: drop source/source_hash/harvested_at
}
```

Field json tags are lower-case with no separators, as in the repo's other wshrpc types (`changeid`, `ownindex`, `sharedwith`...).

**Event:** add `Event_MemHygieneUpdate = "memhygiene:update"` to `pkg/wps/wpstypes.go` (and its list), and map it to `nil` in `tsgenevent.go` so the TS payload is `null`.

**`pkg/memhygiene/types.go`** holds the internal types later tasks share:

```go
const LimitLines, LimitBytes = 200, 25000
type Memory struct {
    Name, Path, Sha256 string; Size int
    Frontmatter map[string]string; Description, Body string
    IndexLine string                 // "" when the index doesn't link it
    Evidence []wshrpc.MemEvidence     // filled by evidence.go
    Reads int; LastRead int64         // sessions with a Read tool call on the file
}
type Inventory struct {
    Folder, IndexPath string
    IndexLines []string               // index content lines, endings stripped
    Index wshrpc.MemIndexStats
    Memories []Memory                 // index order first, then unlinked by name
    DeadLinks []string                // index links to missing files
    Sessions int
}
type Resolved struct {
    Project, Path, Toplevel, Folder string
    SharedWith []string; OwnFolder string
    TranscriptDirs []string
    Skip string                       // non-empty: why there's nothing to check (missing path, no folder)
}
type State struct {                   // the state file
    wshrpc.MemHygieneProject
    Seen map[string]string `json:"seen"` // memory name -> sha256+evidence fingerprint at the last check (hash gate)
}
```

**`store.go`:** `StateDir() string` (`<wavebase.GetWaveDataDir()>/memhygiene`), `FileName(project string) string`, `Load(project) (*State, error)` (a missing file returns a zero state, not an error), `Update(project string, fn func(*State) error) (*State, error)`, and `List(registry map[string]string) ([]wshrpc.MemHygieneProject, error)`. `FileName` maps any registry name to a safe, stable file name; names that differ only in unsafe characters must not collide (for example, append a short hash of the raw name). `Update` holds a per-project mutex. It re-reads the file inside the lock, writes it atomically, and publishes `Event_MemHygieneUpdate`. Every state write in every task goes through `Update`. `List` returns one entry per registry project, sorted by name. A project with no state file gets `{Project, Path}` and zeroes ("Not checked yet"). `List` only reads: no discovery and no disk walk beyond the state files.

**`textfile.go`: the one set of file helpers Tasks 3 to 7 share.** Tasks 2 to 6 run at the same time in this one package, so none of them defines its own hashing, id, text or write helper. They call these and name them:

- `HashFile(path string) (string, error)`: hex sha256 of the bytes, and "" with a nil error when the file doesn't exist.
- `ChangeID(kind string, files []wshrpc.MemFileRef) string`: hex sha256 over kind plus the files sorted by path, each path with its hash. It's the only way a `MemChange.Id` is made (Task 4's ParseJudge, Task 6's split, Task 7's merge).
- `type TextFile struct { Lines []string; EOL string; BOM bool; FinalEOL bool }`, `ReadText(path string) (TextFile, error)` (a missing file returns an empty TextFile with EOL "\n"), and `(TextFile) Bytes() []byte`, which round-trips byte for byte. Every read of `MEMORY.md`, a topic file or an instruction doc goes through `ReadText`.
- `WriteAtomic(path string, data []byte) error`: a temp file in the same dir, then rename, creating the parent dir. Every file write in the package goes through it, the state store included.
- `IndexLinks(line string) []string`: the `*.md` link targets of one index line, in order, URL-decoded.

**`entry.go`:** `ListProjects()` (registry from `memroots.RegistryProjects()`), plus `StartCheck(project string) error` and `Decide(project, changeID, verdict string) (*wshrpc.MemHygieneProject, error)`. In this task the last two return `fmt.Errorf("memory hygiene: %s is not wired yet", ...)`, and Task 7 replaces them. `wshserver_memhygiene.go` calls these three and nothing else.

Tests (`store_test.go`): `TestFileNameSafeAndDistinct` (`a/b`, `a:b`, `a b`, `a*b` all distinct, stable, and free of any char in `\/:*?"<>|`); `TestLoadMissingIsZero`; `TestUpdateMergesConcurrentWriters` (two goroutines updating different fields, both survive); `TestUpdatePublishesEvent` (swap the publish seam); `TestListIncludesUncheckedProjects`. Tests (`textfile_test.go`): `TestHashFileMissingIsEmpty`; `TestChangeIDOrderIndependent` (the same files in another order give the same id, and a changed hash gives a different one); `TestTextFileRoundTrip` (LF, CRLF, BOM, and no final newline each come back byte-identical); `TestWriteAtomicReplaces`; `TestIndexLinks` (two links on a line, a `%20` name, a non-md link ignored). Run `go test ./pkg/memhygiene -run 'TestFileName|TestLoad|TestUpdate|TestList|TestHashFile|TestChangeID|TestTextFile|TestWriteAtomic|TestIndexLinks'`, then `task generate`, and check that `wshclientapi.ts` has the three commands and `waveevent.d.ts` has `memhygiene:update`.

### Task 2: Discovery
**Depends on:** Task 1
**Files:** `pkg/memhygiene/discover.go`, `pkg/memhygiene/discover_test.go`

`Discover(registry map[string]string, claudeHome string) []Resolved`, plus `OwnFolderFor(path, claudeHome string) string`. Follow the spec's Discovery rule exactly:

- `autoMemoryDirectory` precedence: launch folder `.claude/settings.local.json`, then `.claude/settings.json`, then `<claudeHome>/settings.json`.
- Otherwise the folder is `<claudeHome>/projects/<agentobserve.SlugifyCwd(toplevel)>/memory`, where toplevel is `git -C <path> rev-parse --show-toplevel`, or the path itself when it's not a repo. The folder name matches case-insensitively, so an existing dir whose name differs only in drive-letter case is the one used.
- A folder that two or more projects resolve to gives each of them `SharedWith` (the others) and `OwnFolder = OwnFolderFor(path)`: `<claudeHome>/projects/<memroots.ProjectHash(path)>/memory` when that exists, else `<claudeHome>/projects/<SlugifyCwd(path)>/memory`.
- `TranscriptDirs`: every dir under `<claudeHome>/projects` whose name equals `SlugifyCwd(path)` or starts with it plus `"--"`, case-insensitively, skipping `agentobserve.HeadlessAgentSlug()`.
- A missing path or a missing folder sets `Skip` with the reason. A not-a-repo path falls back to the path itself.

Tests, all with temp `claudeHome` and temp repos: `TestDiscoverUsesGitToplevel` (subdir project → toplevel's slug); `TestDiscoverAutoMemoryPrecedence` (all three scopes, local wins, then project, then global); `TestDiscoverSlugCaseInsensitive`; `TestDiscoverSharedFolder` (two subprojects of one repo → both SharedWith each other, OwnFolder prefers an existing ProjectHash dir); `TestDiscoverTranscriptPrefixes` (`slug`, `slug--claude-worktrees-x` included, `slug-other` excluded, headless slug skipped); `TestDiscoverSkipsMissingPathAndFolder`; `TestDiscoverNotARepoUsesPath`. Run `go test ./pkg/memhygiene -run 'TestDiscover'`.

### Task 3: Inventory and evidence
**Depends on:** Task 1
**Files:** `pkg/memhygiene/inventory.go`, `pkg/memhygiene/evidence.go`, `pkg/memhygiene/inventory_test.go`, `pkg/memhygiene/evidence_test.go`

Use Task 1's `ReadText`, `HashFile` and `IndexLinks`; define no text, hash or link helper of your own.

- `ReadInventory(folder string) (*Inventory, error)`. It parses `MEMORY.md` (index lines; markdown links `[t](name.md)`, several per line allowed; CRLF and BOM tolerated) and each `*.md` topic file (frontmatter key/values, `description`, body, size, sha256). It fills `IndexLine`, `DeadLinks` and `Index` stats (lines and bytes as Claude Code counts them).
- `GatherEvidence(inv *Inventory, projectPath, defaultBranch string, transcriptDirs []string) error`. It appends spec step 2's evidence to each `Memory.Evidence`, with copy in the mockup's voice ("Names a file that is gone: `x`", "Not in the index, so no session loads it", "Read in N of M sessions, last on Oct 12"):
  - repo paths and `file:line` references that are gone or past the end of the file;
  - commit hashes not on the default branch (`git merge-base --is-ancestor`);
  - unlinked files and dead links;
  - harvester frontmatter;
  - dated claims: each date in the body (`2026-07-24`, `07-21`, `Oct 12`) with its age in days ("Dated claim: verified 2026-07-24, 82 days ago"); evidence only, never a change by itself;
  - read counts: a session counts only when its transcript JSONL has a `Read` tool_use whose `file_path` resolves to that memory file. A bare name in text counts for nothing. `Inventory.Sessions` is the number of transcripts scanned.
- `InstructionDocs(projectPath, claudeHome string) map[string]string`: the project's `CLAUDE.md` and `AGENTS.md` (those that exist) and `<claudeHome>/CLAUDE.md`, path to content, for the judge.
- `DefaultBranch(projectPath string) string`: `origin/HEAD`'s target, else `main`, else `master`.

Port none of `memory-audit.mjs`'s regex self-stale checks.

Tests: `TestInventoryParsesIndexLinksAndFrontmatter` (two links on one line, unlinked file, dead link); `TestInventoryCRLFAndBOM` (same result as LF); `TestEvidenceGonePath`; `TestEvidenceLinePastEnd`; `TestEvidenceCommitNotOnDefaultBranch` (a commit on a side branch is flagged, one on main is not); `TestEvidenceHarvesterFrontmatter`; `TestEvidenceDatedClaims` (both date forms found with their age, a commit hash or version number not read as a date); `TestReadCountsIgnoreBareNameMatches` (transcripts: a Read tool_use on the file counts, a text mention doesn't, a Read of another file doesn't). Run `go test ./pkg/memhygiene -run 'TestInventory|TestEvidence|TestReadCounts'`.

### Task 4: Judge, model call and validation
**Depends on:** Task 1
**Files:** `pkg/memhygiene/judge.go`, `pkg/memhygiene/model.go`, `pkg/memhygiene/validate.go`, `pkg/memhygiene/judge_test.go`, `pkg/memhygiene/validate_test.go`

- `model.go`: `var runModel = func(ctx context.Context, prompt string) (string, error)` is the test seam. It resolves `consult.HeadlessSpecForTier(consult.TierCapable)` and runs `consult.Run` with cwd `wavebase.HeadlessAgentCwd()`. When `spec.Bin == "claude"` it appends `--tools "" --strict-mcp-config` and wraps `spec.ParseLine`, so a `system`/`init` event whose `tools` list is non-empty returns an error that names the tools (the radar audit's guard, `pkg/reporadar/audit.go`). A runtime this can't guard (pi, codex) returns an error naming the runtime rather than running with tools.
- `Batches(memories []Memory) [][]Memory`: index order, each batch ≤ 60 KB of bodies. A single larger memory is its own batch.
- `JudgePrompt(inv *Inventory, batch []Memory, docs map[string]string, docTarget string) string`. It carries the whole index, the batch's bodies with their evidence, and the instruction docs. It asks for strict JSON: a list of changes in the kinds delete, trim, merge, move-to-doc and add-to-index, each with title, files, evidence lines and exact text. `docTarget` is `CLAUDE.md` when the project has one, else `AGENTS.md`, and the label says which ("Move to CLAUDE.md"). Merges only within the batch.
- `ParseJudge(reply string, inv *Inventory, docTarget string) ([]wshrpc.MemChange, error)`. It takes the JSON out of prose or a fenced block and builds full `MemChange`s: Op, Files with their check-time sha256, Diffs, IndexDelta, Effect, ApplyLabel, Note, and Id from Task 1's `ChangeID` (file hashes from `HashFile`). Malformed or truncated JSON is an error.
- `SortPrompt(shared *Inventory, projects []string) string` and `ParseSort(reply string) (map[string][]string, error)` (memory name → registered project names and/or `"other"`), over each shared memory's index line and `description` only.
- `Validate(changes []wshrpc.MemChange, invs map[string]*Inventory, docs map[string]string) (kept []wshrpc.MemChange, dropped []string)`. It applies spec step 5's six drop rules. Each dropped entry is a logged reason naming the change.

Tests (stub `runModel`; never call a real model): `TestBatchesCapAt60KB`; `TestParseJudgeFencedAndProse`; `TestParseJudgeTruncatedIsError`; `TestParseJudgeBuildsOpAndHashes`; `TestDocTargetPrefersClaudeMd`; `TestModelRefusesToolsInInit` (feed a fake init line through the wrapped ParseLine); `TestParseSort`. Then one test per drop rule: `TestValidateDropsMissingFile`, `TestValidateDropsTrimNotExactlyOnce`, `TestValidateDropsSectionNotExactlyOnce`, `TestValidateDropsMergeUnderTwo`, `TestValidateDropsMultilineIndexLine`, `TestValidateDropsAlreadyLinked`. Run `go test ./pkg/memhygiene -run 'TestBatches|TestParse|TestDocTarget|TestModel|TestValidate'`.

### Task 5: Apply, undo, backups and the settings edit
**Depends on:** Task 1
**Files:** `pkg/memhygiene/apply.go`, `pkg/memhygiene/settings.go`, `pkg/memhygiene/apply_test.go`, `pkg/memhygiene/settings_test.go`

Every hash comes from Task 1's `HashFile`, every read from `ReadText`, and every write from `TextFile.Bytes` + `WriteAtomic`, so line endings and the BOM survive. Define no helper of your own for these.

- `Apply(change wshrpc.MemChange, backupRoot string, now time.Time) (applyID string, conflict string, err error)`. It re-hashes every `Files` entry (a "" hash means the file must not exist). On any mismatch it returns that path as `conflict` and writes nothing. Otherwise it copies the originals to `<backupRoot>/<applyId>/` with `manifest.json` (each path, its pre-apply hash or absence, and its post-apply hash), then writes each file atomically, per kind as in the spec's Change kinds table.
  - Move-to-doc appends the passage at the end of the named section and leaves the edit uncommitted.
  - Add-to-index creates `MEMORY.md` when it's missing and, with `StripHarvester`, drops the three keys.
  - Move-here moves the files and the index line, copy-here copies them, remove-shared deletes them from the shared folder with their index line.
  - Settings calls `SetAutoMemoryDirectory`.
- `Undo(backupRoot, applyID string) (conflict string, err error)` restores the backup only if every file still has its post-apply hash (or is still absent). Otherwise it returns the first changed path and writes nothing.
- `PruneBackups(backupRoot string, now time.Time, keep time.Duration) error` deletes backup dirs older than `keep`, judged by the manifest's time.
- `settings.go`: `SetAutoMemoryDirectory(path, value string) error` inserts or replaces the one top-level `autoMemoryDirectory` key and leaves every other byte as it was. It creates `{\n  "autoMemoryDirectory": "..."\n}` when the file is missing, and refuses a file that isn't a JSON object, naming the file.

Tests: `TestApply<Kind>` for each of the nine kinds, asserting the exact bytes of every touched file; `TestApplyPreservesCRLF`; `TestApplyConflictWritesNothing`; `TestUndoRestores`; `TestUndoConflictWritesNothing`; `TestPruneBackupsAfter30Days`; `TestSettingsInsert`, `TestSettingsReplace`, `TestSettingsOtherBytesUnchanged` (the other keys, their order and whitespace survive), `TestSettingsRefusesNonObject`. Run `go test ./pkg/memhygiene -run 'TestApply|TestUndo|TestPrune|TestSettings'`.

### Task 6: The split reducer
**Depends on:** Task 1
**Files:** `pkg/memhygiene/split.go`, `pkg/memhygiene/split_test.go`

`SplitChanges(project string, shared, own *Inventory, sort map[string][]string, ownFolder, settingsPath string) []wshrpc.MemChange` turns the model's sort into the split's changes, all in code. Each change's Id comes from Task 1's `ChangeID`, and its file hashes from `HashFile`:

- applies only to `project` → **move-here** (group `shared`);
- applies to `project` and others → **copy-here** (group `shared`);
- a memory whose index line links several files is one change that moves or copies them all;
- the own folder's leftovers aren't produced here (they get ordinary judge changes in group `own`, which Task 7 sets);
- one **settings** change (group `switch`, `SettingsPath` = `<path>/.claude/settings.local.json`, value = `ownFolder`).

`RemoveShared(project string, shared *Inventory, sort map[string][]string, stillLoading []string) []wshrpc.MemChange` gives **remove-shared** for each memory whose projects have all switched (none in `stillLoading`) and whose sort lacks `"other"`. `OpenSharedChanges(changes) int` is the backend's switch-over gate: Task 7's Decide refuses to apply a settings change while it's above 0, so the gate holds in the action as well as the button.

Tests: `TestSplitOneProjectGivesMove`; `TestSplitSeveralGivesCopy`; `TestSplitLinkedFilesGrouped` (a hub line linking 3 files → one change with 3 files); `TestSplitSettingsChange`; `TestRemoveSharedWhenAllSwitched`; `TestRemoveSharedSkipsOther`; `TestOpenSharedChanges`. Run `go test ./pkg/memhygiene -run 'TestSplit|TestRemoveShared|TestOpenShared'`.

### Task 7: Check pipeline, weekly sweep and wiring
**Depends on:** Task 2, Task 3, Task 4, Task 5, Task 6
**Files:** `pkg/memhygiene/check.go`, `pkg/memhygiene/sweep.go`, `pkg/memhygiene/entry.go`, `pkg/memhygiene/check_test.go`, `pkg/memhygiene/sweep_test.go`, `cmd/server/main-server.go`, `docs/deferred.md`, `docs/open-issues.md`

- `check.go`: `runCheck(ctx, project, claudeHome string) error` runs Discover, then ReadInventory and GatherEvidence for the loaded folder (and the own folder during a split), then the hash gate (skip memories whose `Seen` fingerprint matches and that have no open change), then the judge per batch or the sort + SplitChanges for a sharing project, then Validate, then stores.
  - For a sharing project, the own folder's existing memories also go through the judge, and their changes get group `own`.
  - A switched project (`FormerShared` set) whose check finds no registered project still loading `FormerShared` gets `RemoveShared`, but only when it has the latest `SwitchedAt` among the projects that formerly shared that folder, so the removal is listed once.
  - Stores through `Update`, merging: changes applied, kept or decided during the check keep their status. A previous open or kept change whose files' hashes are unchanged carries over with its status. Applied changes stay listed until `BackupUntil`.
  - A failed model run or parse sets `LastError`, keeps the last good result, and clears `Checking`.
  - Sets `CheckedAt`, `NextCheckAt` (+7 days), `Memories`, `Sessions`, `Index`, `OwnIndex`, `SharedWith`, `OwnFolder` and `Folder`.
- `entry.go`:
  - `StartCheck` refuses a project that's already checking, sets `Checking`, and runs `runCheck` in a detached goroutine with a panic handler, never on the RPC context.
  - `Decide`: apply calls `Apply`, sets status `applied` (or `conflict` + `ConflictFile`), and after a settings apply records `FormerShared` and `SwitchedAt`. Keep sets `kept`. Undo calls `Undo` and reopens the change, or returns an error naming the changed file. Reopen sets `open`. It re-measures `Index`/`OwnIndex` after apply and undo, refuses a settings apply while `OpenSharedChanges > 0`, and refuses unknown verdicts or change ids with a message naming them.
- `sweep.go`: `StartSweep(ctx context.Context)` runs at startup and then hourly, like `jarvisvolunteer.StartLooseEndSweep`. Each tick checks every registered, non-skipped project whose `CheckedAt` is 7 days old or more, one at a time, and calls `PruneBackups(…, 30 days)`. A panic in one tick doesn't end the ticker.
  - The sweep skips a project whose settings change is `kept` (spec: "Kept sharing"). Check now still checks it, and Review again on that change makes it eligible again.
  - At startup the sweep clears a `Checking` flag a previous process left behind, setting `LastError` "Check interrupted by a restart", so the tab never shows "Checking…" forever.
- `cmd/server/main-server.go`: start it beside `StartLooseEndSweep`.
- `docs/deferred.md`: record Pi and Codex memory (`~/.pi/agent/memory`, `~/.codex/memories`) merges across batches, and a numeric retention score / LRU ordering over budget (the spec's Deferred entry). Each entry says why it was deferred and what would revive it. Add a line to "The memory subsystem, removed" saying this feature keeps the index small and doesn't revive recall or harvesting.
- `docs/open-issues.md`: record the spec's two "Live, once, by hand" checks as follow-ups after shipping, each with its steps: (1) apply a split's switch-over on a real subproject, then start an interactive `claude` there and confirm it loads the own folder's `MEMORY.md` and writes a new memory into that folder; (2) leave a project with open changes, let a sweep run, and confirm the volunteer judge says it at least once (the `jarvisvolunteer` log line or the pet card).

Tests (stub `runModel`; temp claudeHome, data dir and repos): `TestCheckStoresChanges`; `TestCheckHashGateSkipsUnchanged` (the second check sends the model no batch for unchanged memories); `TestCheckKeptStaysKeptUntilFileChanges`; `TestCheckFailureKeepsLastResult`; `TestCheckMergeKeepsDecisionMadeDuringCheck` (an apply that lands between the read and the store survives); `TestCheckSharingProjectProducesSplit`; `TestCheckRemoveSharedUnderLastSwitched`; `TestDecideApplyConflict`; `TestDecideSettingsGated`; `TestDecideUndoRemeasuresIndex`; `TestSweepPicksStaleProjectsOnly`; `TestSweepSkipsKeptSharing` (a kept settings change: skipped by the sweep, still checked by StartCheck, eligible again after reopen); `TestSweepClearsStaleChecking`. Run `go test ./pkg/memhygiene -run 'TestCheck|TestDecide|TestSweep'`.

### Task 8: Volunteer producer
**Depends on:** Task 1
**Files:** `pkg/jarvisvolunteer/memhygiene.go`, `pkg/jarvisvolunteer/memhygiene_test.go`, `pkg/jarvisvolunteer/volunteer.go`, `pkg/jarvisvolunteer/candidate.go`, `frontend/app/view/jarvis/petvoice.ts`

`MemoryHygieneProducer` reads state through `memhygiene.ListProjects` (a function field is the test seam, as `LooseEndProducer` does). For `TriggerSweep` it emits one candidate per project with open changes: `Class` `ClassMemoryHygiene = "memory-hygiene"`, `ID` `memory-hygiene:<project>:<checkedAt>`, `At` = CheckedAt, `Title` "<project>'s memory has N changes to review", `SourceType` `memhygiene`, `SourceRef` `memhygiene:<project>`. Add it to `producersFor`'s sweep case beside `LooseEndProducer`, and extend the `SourceType` comments in `candidate.go` and `petvoice.ts` with `memhygiene`.

Tests: `TestMemoryHygieneProducerOnePerProjectWithOpenChanges` (projects with only applied or kept changes emit nothing); `TestMemoryHygieneCandidateStampedFromCheck` (two calls with unchanged state → the same ID and At); `TestSweepIncludesMemoryHygieneProducer`. Run `go test ./pkg/jarvisvolunteer -run 'TestMemoryHygiene|TestSweepIncludesMemoryHygiene'`.

### Task 9: Memory model (pure frontend logic)
**Depends on:** Task 1
**Files:** `frontend/app/view/agents/memorymodel.ts`, `frontend/app/view/agents/memorymodel.test.ts`

These pure functions over the generated `MemHygieneProject`/`MemChange` types follow the mockup's `renderVals` logic and copy. Exports (Task 10 relies on these names):

- `LIMIT_LINES`, `LIMIT_BYTES`;
- `projectsToReview(projects): number` (projects with an open change, plus sharing projects with open split changes) and `toolbarStatus(projects)`: `{ text, tone }`, either "N projects to review" (singular "1 project to review") or "Every project checked";
- `railRow(p, now)`: `{ name, pct, meter, status, tone }`, where meter is "89 lines · 12.6 of 25 KB", or "Shares <repo>'s memory · 134 lines" while sharing, or "Not checked yet";
- `checkLine(p, now)`: "Checked today at 09:12 · 69 memories, 1,232 sessions · next check Oct 20", or "Last check failed: <reason>" appended, or "Checking…";
- `indexCards(p)`: one card, or two during a split, each with lines/kb text, percents and the "After the changes still to review: …" or "Nothing left to review here." line, computed from `IndexDelta`/`OwnIndexDelta` of open changes;
- `changeGroups(p)`: ungrouped, or the split's three labelled groups in order (shared, own, switch) with their hints;
- `switchGate(p, change)`: `{ blocked: boolean, text }`, with the text "Review the N changes from <repo>'s memory first. Switching now would drop those memories from <project> sessions.";
- `closedText(change, now)`: "Applied at 17:42. Arc kept a copy of the old files until Nov 12." (the settings variant names the project), or "Kept as is. The next check skips it unless the memory changes.";
- `statusOf(change)`: To review / Applied / Kept / Changed on disk, each with a tone;
- a rail status of "Kept sharing" for a sharing project whose settings change is kept, "Not checked yet" for a project never checked, and "Checking…" while checking.

Tests cover every export, including the gate (blocked with 1+ open shared changes, open once none remain, never blocking a non-settings change), the after-totals across applied versus open changes, the never-checked, checking and failed-check lines, "Kept sharing", both toolbar texts, and the singular "1 change". Run `npx vitest run frontend/app/view/agents/memorymodel.test.ts`.

### Task 10: The Memory tab
**Depends on:** Task 9
**Files:** `frontend/app/view/agents/setupmemory.tsx`, `frontend/app/view/agents/memorystore.ts`, `frontend/app/view/agents/setupstore.ts`, `frontend/app/view/agents/setupsurface.tsx`

- `setupstore.ts`: `SetupTab` gains `"memory"`.
- `setupsurface.tsx`: `TABS` gains `{ key: "memory", label: "Memory" }`. The panel renders `<MemoryTab />`, and the toolbar shows `<MemoryHeader />` (the dot + "N projects to review" / "Every project checked") on that tab. That's the whole edit to this file.
- `memorystore.ts`: `memoryProjectsAtom`, `memorySelectedProjectAtom` (string | null; Task 11 writes it), `memorySelectedChangeAtom`, `memoryErrorAtom`, `memoryBusyAtom`, and `loadMemory()`, `checkMemory(project)`, `decideMemory(project, changeId, verdict)`. Each RPC has an explicit timeout, an error goes to `memoryErrorAtom` (never swallowed), and a subscription to `memhygiene:update` re-lists. The selection is module-level, so it survives the surface unmounting.
- `setupmemory.tsx` lays out the mockup's three columns:
  - the project rail with meters and status;
  - the center with the check line, **Check now**, the index cards and the grouped change table;
  - the detail rail with kind, title, file, Why, Change diff blocks, note, the gate text, **Keep as is** and the apply label (disabled when gated or in conflict), the conflict alert with **Check again** (it calls `checkMemory`), and the closed state with **Undo** / **Review again**.

  All derivation comes from `memorymodel.ts`, and colors come from theme tokens. Stable hooks for the CDP scenario: `data-memory-project="<name>"` on rail rows, `data-memory-change="<id>"` on table rows, `data-memory-card`, `data-memory-detail`, `data-memory-apply`, `data-memory-keep`, `data-memory-undo`, `data-memory-conflict`, `data-memory-gate`, `data-memory-check`.

A failed RPC shows `memoryErrorAtom`'s message in the tab, in an alert with `data-memory-error`.

Acceptance: `task check:ts` passes. Task 12's `setup-memory` steps show every board and state: steps 1 to 6 (the boards, apply/undo, keep), step 7 (Not checked yet, Last check failed, Checking…), step 8 (the error alert) and step 9 (Every project checked).

### Task 11: The memhygiene address and landing
**Depends on:** Task 10
**Files:** `frontend/app/view/jarvis/address.ts`, `frontend/app/view/jarvis/address.test.ts`, `frontend/app/view/jarvis/openref.ts`, `frontend/app/view/jarvis/openref.test.ts`

- `OpenTarget` gains `{ kind: "memhygiene"; project: string }`, and `parseAddress` maps `memhygiene:<project>` to it, splitting at the first ":" only for this kind, so a project name that holds ":" survives (`memhygiene:a:b` gives project `a:b`). `memory:<id>` stays a note, and every other kind keeps the exactly-two-parts rule.
- `openref.ts`: `targetName` reads "memory of <project>". `isPeekable` returns false for it (like `canvas`). The landing loads the project list and fails with a reason naming the project if it isn't registered. Its select sets `setupTabAtom` to `"memory"`, writes `memorySelectedProjectAtom` and clears `memorySelectedChangeAtom`, then switches the surface to `setup`, following the existing load-then-select pattern.

Tests: `address.test.ts`: `memhygiene:waveterm` parses to the target, `memhygiene:a:b` gives project `a:b`, `memhygiene:` is unsupported, `run:a:b` is still unsupported, and `memory:abc` still parses to a note. `openref.test.ts`: the landing writes the tab and project before the surface switch, and an unknown project fails with a reason and switches nothing. Run `npx vitest run frontend/app/view/jarvis/address.test.ts frontend/app/view/jarvis/openref.test.ts`. Acceptance: Task 12's `setup-memory` step 10 performs the landing in the running app.

### Task 12: The setup-memory CDP scenario
**Depends on:** Task 7, Task 11
**Files:** `scripts/cdp/memory-fixtures.mjs`, `scripts/cdp/memory-fixtures.test.mjs`, `scripts/cdp/scenarios.mjs`

`memory-fixtures.mjs` builds everything in `mkdtemp` dirs and never touches `~/.claude`:

- Two temp `git init` repos. One becomes project `verify-mem-own`, with a memory folder holding a `MEMORY.md` and 4 to 5 topic files. The other gets two subprojects, `verify-mem-split-a` and `verify-mem-split-b`, both reading one temp shared folder, and each with a temp own folder.
- A writer for Task 1's state-file shape (computing real sha256s), using the data dir from `h.rpc("waveinfo", null)` and the file name rule from Task 1's `FileName` (mirror it, and test the mirror against a fixed example).
- Three more state-only projects, registered on their own temp repos: `verify-mem-new` (registered, no state file), `verify-mem-failed` (a state with a prior result and `LastError` "judge returned malformed JSON") and `verify-mem-checking` (`Checking: true`).
- The changes:
  - own project: a trim, a delete, a merge, a move-to-doc (its doc is a temp `AGENTS.md`) and an add-to-index;
  - split-a: two move-here, one copy-here, one own-group delete and the gated settings change.

The scenario registers the projects with `createproject`, writes the state files, reloads, and opens Setup → Memory. It never clicks Check now, and teardown deletes the projects, the state files and the temp dirs. Viewport pinned to 1600x950. Steps, each with a screenshot:

1. **Main:** the own project selected, the toolbar status, a rail meter, one index card, five rows, a trim selected with Why, Change and both buttons.
2. **Split:** split-a selected: the split text, two index cards, three labelled groups, a move-here selected.
3. **SplitGate:** the settings change selected, apply disabled, the gate text shown.
4. **Applied with Undo:** apply the trim. The temp file's bytes equal the trimmed text, the rail shows "Applied at …" and Undo, and the row reads Applied. Click Undo and the file's bytes equal the original.
5. **ChangedOnDisk:** edit the delete's temp file, then click apply. The conflict alert and **Check again** show, and the file still holds the edited bytes, with nothing deleted.
6. **Keep / Review again:** keep a change, see "Kept as is…" and Review again, click it, and the change is open again.
7. **Check states:** select each of the three state-only projects. The rail and check line read "Not checked yet", "Last check failed: judge returned malformed JSON" (with the prior result's table still shown), and "Checking…".
8. **Error alert:** apply a change, delete its backup dir under `<data dir>/memhygiene/backups/<applyId>`, then click Undo. The `data-memory-error` alert shows the backend's message, and the temp file keeps its applied bytes.
9. **Every project checked:** rewrite every fixture state so no change is open, then reload. The toolbar reads "Every project checked".
10. **Landing:** switch to the Cockpit surface, call `window.__openAddress("memhygiene:verify-mem-split-a")`, and confirm Setup is the active surface, the Memory tab is selected, and `verify-mem-split-a`'s rail row is pressed.

`memory-fixtures.test.mjs` (vitest) checks that the fixture writes only under its temp root and that the hashes match the files. Run `npx vitest run scripts/cdp/memory-fixtures.test.mjs` and `task verify:ui -- setup-memory` against a running dev app.
