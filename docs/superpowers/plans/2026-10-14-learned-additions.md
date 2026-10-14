# Learned additions implementation plan

**Spec:** `docs/superpowers/specs/2026-10-14-learned-additions-design.md` — read it first; it is the source of truth.
**Verify:** `node scripts/verify.mjs ./pkg/learn ./pkg/agentsync ./pkg/jarvis ./pkg/wshrpc/... ./cmd/wsh/cmd`
**Check:** `go vet ./pkg/learn/... ./pkg/agentsync/... && node --stack-size=4000 node_modules/typescript/lib/tsc.js --noEmit`
**Final:** `node scripts/cdp/final-verify.mjs needs-you-learn-card setup-skill-additions setup-learned`

**Goal:** Agents note the user's corrections with `wsh learn note`; a correction seen in two sessions becomes a
proposal in Needs you; an accepted proposal becomes a line in a skill's `.arc/additions.md` (rendered at the end of
SKILL.md under `## Your additions`) or a learned Claude memory file, and Setup highlights those lines apart from the
shipped text.

**Architecture:** A new `pkg/learn` owns the notes log, the proposal rule, the mute list and the Claude memory files.
`pkg/agentsync` owns `additions.md` and renders it into every harness's SKILL.md. New `Learn*` wshrpc commands wire
both to `wsh learn` and the frontend; proposals reach Needs you as a new `AttentionItem` kind built in
`pkg/jarvis/attention.go`. The frontend adds a learn row to the Needs you strip, an additions block and `+N` chip to
Setup → Skills, and a Setup → Learned tab.

**Tech stack:** Go (wavesrv, wsh, cobra), wshrpc + `task generate`, React 19 + jotai + Tailwind 4, vitest, CDP
scenarios.

## Worker and reviewer brief — applies to every task

- Do not spawn subagents or forks. Implement inline. Commit without attribution trailers, staging only your files.
- TDD: write the failing test, see it fail, implement, see it pass. Run only the focused tests named in the task
  and the Check line; the engine runs Verify at merges.
- Never hand-edit generated files (`frontend/app/store/wshclientapi.ts`, `frontend/types/gotypes.d.ts`,
  `frontend/types/waveevent.d.ts`, `pkg/wshrpc/wshclient/wshclient.go`); edit Go and run `task generate`.
- Colors only from `@theme` tokens in `frontend/tailwindsetup.css`; read `DESIGN.md` before styling. Compact by
  default: no new panels or modals.
- Pure frontend logic goes in a `foo.ts` with a `foo.test.ts` beside it; no jsdom render tests.
- In a worktree, typecheck with the Check line's direct `tsc` call, never `task check:ts` (it runs `npm install`
  and breaks the `node_modules` junction).
- Do not run `task dev`; Final starts its own isolated app.
- Prefer simple, direct code (KISS, YAGNI, DRY); handle errors at boundaries and never swallow them silently.

## Shared definitions (all tasks use these exact names)

- Proposal **ID** = `<target>#<key>`; **target** is `skill:<name>` or `memory:<cwd>`.
- **Key**: `^[a-z0-9]+(-[a-z0-9]+)*$`, at most 64 bytes. **Text**: 1–200 runes, one line.
- **Session**: `<WAVETERM_BLOCKID or "cli">:<YYYY-MM-DD local>`.
- Proposal rule: when a note is added, its ID becomes **proposed** if its notes within the 30 days before that note
  come from at least **2 distinct sessions** and the ID is not muted. A proposed ID is recorded in `proposed.json` and
  stays pending, however old its notes grow, until it is taken (accepted) or muted (dismissed): proposals do not expire.
- Additions cap: 20 per skill. "New" highlight: learned within the last 7 days (inclusive of today).
- Store dir: `filepath.Join(wavebase.GetWaveDataDir(), "learn")` holding `notes.jsonl`, `muted.json` and `proposed.json`.
- Attention kind: `"learn-proposal"`.

---

### Task 1: `pkg/learn` notes store and proposal rule

**Depends on:** none
**Files:** `pkg/learn/learn.go`, `pkg/learn/learn_test.go`

**Step 1: Write the failing tests** in `pkg/learn/learn_test.go`:

```go
package learn

import (
	"errors"
	"testing"
	"time"
)

var day0 = time.Date(2026, 10, 14, 10, 0, 0, 0, time.Local)

func note(key, session string, at time.Time) Note {
	return Note{Key: key, Target: "skill:notes", Text: "Write notes in Vietnamese", Quote: "viết tiếng Việt", Session: session, TS: at.UnixMilli()}
}

func TestOneSessionMakesNoProposal(t *testing.T) {
	s := Open(t.TempDir())
	for i := 0; i < 3; i++ {
		if err := s.Add(note("notes-vi", "b1:2026-10-14", day0)); err != nil {
			t.Fatal(err)
		}
	}
	got, err := s.Pending()
	if err != nil || len(got) != 0 {
		t.Fatalf("want no proposal, got %v %v", got, err)
	}
}

func TestTwoSessionsMakeAProposal(t *testing.T) {
	s := Open(t.TempDir())
	_ = s.Add(note("notes-vi", "b1:2026-10-13", day0.Add(-24*time.Hour)))
	n := note("notes-vi", "b2:2026-10-14", day0)
	n.Text = "Always write notes in Vietnamese"
	_ = s.Add(n)
	got, _ := s.Pending()
	if len(got) != 1 {
		t.Fatalf("want 1 proposal, got %v", got)
	}
	p := got[0]
	if p.ID != "skill:notes#notes-vi" || p.Sessions != 2 || p.Text != "Always write notes in Vietnamese" || len(p.Quotes) != 2 {
		t.Fatalf("unexpected proposal %+v", p)
	}
	if p.Since != day0.Add(-24*time.Hour).UnixMilli() {
		t.Fatalf("Since should be the oldest counted note, got %d", p.Since)
	}
}

func TestNotesOlderThan30DaysDoNotCount(t *testing.T) {
	s := Open(t.TempDir())
	_ = s.Add(note("notes-vi", "b1:2026-09-01", day0.Add(-31*24*time.Hour)))
	_ = s.Add(note("notes-vi", "b2:2026-10-14", day0))
	if got, _ := s.Pending(); len(got) != 0 {
		t.Fatalf("want none, got %v", got)
	}
}

func TestProposalDoesNotExpire(t *testing.T) {
	s := Open(t.TempDir())
	_ = s.Add(note("notes-vi", "b1:2026-08-14", day0.Add(-61*24*time.Hour)))
	_ = s.Add(note("notes-vi", "b2:2026-08-15", day0.Add(-60*24*time.Hour)))
	if got, _ := s.Pending(); len(got) != 1 {
		t.Fatalf("a proposal must wait however old its notes are, got %v", got)
	}
	if _, err := s.Peek("skill:notes#notes-vi"); err != nil {
		t.Fatalf("peek an old proposal: %v", err)
	}
}

func TestMuteDropsNotesAndRefusesNewOnes(t *testing.T) {
	s := Open(t.TempDir())
	_ = s.Add(note("notes-vi", "b1:2026-10-13", day0))
	_ = s.Add(note("notes-vi", "b2:2026-10-14", day0))
	if err := s.Mute("skill:notes#notes-vi"); err != nil {
		t.Fatal(err)
	}
	if got, _ := s.Pending(); len(got) != 0 {
		t.Fatalf("muted id still proposed: %v", got)
	}
	if err := s.Add(note("notes-vi", "b3:2026-10-15", day0)); !errors.Is(err, ErrMuted) {
		t.Fatalf("want ErrMuted, got %v", err)
	}
}

func TestTakeReturnsTheProposalAndClearsItsNotes(t *testing.T) {
	s := Open(t.TempDir())
	_ = s.Add(note("notes-vi", "b1:2026-10-13", day0))
	_ = s.Add(note("notes-vi", "b2:2026-10-14", day0))
	_ = s.Add(note("other-key", "b2:2026-10-14", day0))
	p, err := s.Take("skill:notes#notes-vi")
	if err != nil || p.Sessions != 2 {
		t.Fatalf("take: %+v %v", p, err)
	}
	keys, _ := s.Keys("skill:notes")
	if len(keys) != 1 || keys[0].Key != "other-key" {
		t.Fatalf("other notes must survive, got %v", keys)
	}
	if _, err := s.Take("skill:notes#notes-vi"); !errors.Is(err, ErrNoProposal) {
		t.Fatalf("second take: want ErrNoProposal, got %v", err)
	}
}

func TestAddValidates(t *testing.T) {
	s := Open(t.TempDir())
	bad := []Note{
		{Key: "Bad Key", Target: "skill:notes", Text: "x", Session: "s"},
		{Key: "ok", Target: "nowhere:x", Text: "x", Session: "s"},
		{Key: "ok", Target: "skill:notes", Text: "", Session: "s"},
		{Key: "ok", Target: "skill:notes", Text: "two\nlines", Session: "s"},
	}
	for _, n := range bad {
		if err := s.Add(n); err == nil {
			t.Fatalf("want an error for %+v", n)
		}
	}
}

func TestMalformedLineIsSkipped(t *testing.T) {
	dir := t.TempDir()
	s := Open(dir)
	_ = s.Add(note("notes-vi", "b1:2026-10-13", day0))
	appendRaw(t, dir, "{not json\n")
	_ = s.Add(note("notes-vi", "b2:2026-10-14", day0))
	if got, err := s.Pending(); err != nil || len(got) != 1 {
		t.Fatalf("want 1 proposal despite a bad line, got %v %v", got, err)
	}
}
```

Add the helper `appendRaw(t, dir, s)` at the bottom of the test file (opens `notes.jsonl` with `O_APPEND` and writes
`s`).

**Step 2:** Run `go test ./pkg/learn -run 'Test'` — expected: build failure (package empty).

**Step 3: Implement** `pkg/learn/learn.go`:

- `type Note struct { Key, Target, Text, Quote, Session string; TS int64 }` with json tags `key target text quote session ts`.
- `type Quote struct { Quote, Session string; TS int64 }`, `type Proposal struct { ID, Target, Key, Text string; Quotes []Quote; Sessions int; Since int64 }`, `type KeyInfo struct { Key, Text string; Notes int }`.
- `var ErrMuted = errors.New("the user dismissed this before")`, `var ErrNoProposal = errors.New("no such proposal")`.
- `type Store struct { dir string; mu sync.Mutex }`; `func Open(dir string) *Store`; `func Default() *Store` returning a
  `sync.Once` store at `filepath.Join(wavebase.GetWaveDataDir(), "learn")`.
- `func ID(target, key string) string { return target + "#" + key }`.
- `Add(n Note) error`: validate (key regexp and ≤64 bytes; target prefix `skill:` with a non-empty name or `memory:`
  with a non-empty cwd; text trimmed, 1–200 runes, no `\n`/`\r`; session non-empty; quote trimmed and capped at 300
  runes); if muted return `ErrMuted`; `MkdirAll` the dir; append one JSON line to `notes.jsonl`; then, if the ID is not
  yet proposed and its notes with `TS >= n.TS-30d` come from ≥2 distinct sessions, add the ID to `proposed.json`.
- `readNotes()`: read `notes.jsonl` line by line; skip and `log.Printf("learn: skipping malformed line %d: %v", ...)`
  a line that fails to decode; a missing file is no notes.
- `proposed.json` and `muted.json` are sorted JSON string arrays; a missing file is an empty list.
- `Pending() ([]Proposal, error)`: one proposal per ID in `proposed.json` that is not muted and still has notes, built
  from **all** its notes (no window: proposals do not expire). `Text` is the newest note's text, `Quotes` the notes
  oldest-first (non-empty quotes only), `Sessions` the distinct sessions, `Since` the oldest note's TS. Sort by
  `Since` ascending.
- `Peek(id string) (Proposal, error)`: the proposal for `id` as `Pending` builds it; `ErrNoProposal` when `id` is not
  in `proposed.json` or has no notes.
- `Take(id string) (Proposal, error)`: `Peek`, then rewrite `notes.jsonl` without that ID's notes (write
  `notes.jsonl.tmp`, then `os.Rename`) and drop the ID from `proposed.json`.
- `Mute(id string) error`: add to `muted.json`, drop the ID's notes and its `proposed.json` entry.
- `Keys(target string) ([]KeyInfo, error)`: every key with notes for that target (window ignored), newest text,
  note count; sorted by key.
- Every method takes `s.mu`.

**Step 4:** `go test ./pkg/learn -run 'Test'` — expected: PASS.

**Step 5:** Commit: `git commit -m "feat(learn): notes log, two-session proposals and mute" -- pkg/learn/learn.go pkg/learn/learn_test.go`

---

### Task 2: Skill additions in `pkg/agentsync`

**Depends on:** none
**Files:** `pkg/agentsync/additions.go`, `pkg/agentsync/additions_test.go`, `pkg/agentsync/skills.go`, `pkg/agentsync/skills_test.go`

**Step 1: Write the failing tests** in `pkg/agentsync/additions_test.go` (reuse `seedSkill(t, p, name)` from
`skills_test.go:16` and `testPaths` from `agentsync_test.go:14`; read them first):

```go
func TestUpsertAdditionWritesThenReplacesByKey(t *testing.T) {
	p := testPaths(t, "")
	seedSkill(t, p, "notes")
	if err := UpsertAddition(p.SkillsRoot, "notes", Addition{Key: "notes-vi", Text: "Write notes in Vietnamese", Learned: "2026-10-12", Count: 2}); err != nil {
		t.Fatal(err)
	}
	if err := UpsertAddition(p.SkillsRoot, "notes", Addition{Key: "notes-vi", Text: "Always write notes in Vietnamese", Learned: "2026-10-14", Count: 1}); err != nil {
		t.Fatal(err)
	}
	got, _ := ReadAdditions(p.SkillsRoot, "notes")
	want := []Addition{{Key: "notes-vi", Text: "Always write notes in Vietnamese", Learned: "2026-10-14", Count: 3}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v", got)
	}
}

func TestUpsertAdditionRefusesAMissingSkillAndTheCap(t *testing.T) {
	p := testPaths(t, "")
	if err := UpsertAddition(p.SkillsRoot, "ghost", Addition{Key: "k", Text: "t", Learned: "2026-10-14", Count: 1}); !errors.Is(err, ErrNoSkill) {
		t.Fatalf("want ErrNoSkill, got %v", err)
	}
	seedSkill(t, p, "notes")
	for i := 0; i < MaxAdditions; i++ {
		if err := UpsertAddition(p.SkillsRoot, "notes", Addition{Key: fmt.Sprintf("k%d", i), Text: "t", Learned: "2026-10-14", Count: 1}); err != nil {
			t.Fatal(err)
		}
	}
	if err := UpsertAddition(p.SkillsRoot, "notes", Addition{Key: "one-more", Text: "t", Learned: "2026-10-14", Count: 1}); !errors.Is(err, ErrAdditionsFull) {
		t.Fatalf("want ErrAdditionsFull, got %v", err)
	}
	// replacing an existing key at the cap is still allowed
	if err := UpsertAddition(p.SkillsRoot, "notes", Addition{Key: "k0", Text: "t2", Learned: "2026-10-14", Count: 1}); err != nil {
		t.Fatal(err)
	}
}

func TestRemoveAddition(t *testing.T) {
	p := testPaths(t, "")
	seedSkill(t, p, "notes")
	_ = UpsertAddition(p.SkillsRoot, "notes", Addition{Key: "a", Text: "A", Learned: "2026-10-14", Count: 1})
	_ = UpsertAddition(p.SkillsRoot, "notes", Addition{Key: "b", Text: "B", Learned: "2026-10-14", Count: 1})
	if err := RemoveAddition(p.SkillsRoot, "notes", "a"); err != nil {
		t.Fatal(err)
	}
	got, _ := ReadAdditions(p.SkillsRoot, "notes")
	if len(got) != 1 || got[0].Key != "b" {
		t.Fatalf("got %+v", got)
	}
}

func TestRenderSkillAppendsAdditionsForEveryRuntime(t *testing.T) {
	p := testPaths(t, "")
	seedSkill(t, p, "notes")
	_ = UpsertAddition(p.SkillsRoot, "notes", Addition{Key: "notes-vi", Text: "Write notes in Vietnamese", Learned: "2026-10-14", Count: 3})
	for _, rt := range []string{"claude", "codex"} {
		files, err := renderSkill(p.SkillsRoot, "notes", rt)
		if err != nil {
			t.Fatal(err)
		}
		md := string(files["SKILL.md"])
		want := "\n## Your additions\n<!-- arc:user -->\nThese are the user's own rules; where they conflict with the text above, they win.\n\n- Write notes in Vietnamese (learned 2026-10-14, 3×)\n"
		if !strings.HasSuffix(md, want) {
			t.Fatalf("%s: SKILL.md does not end with the additions:\n%s", rt, md)
		}
		if _, leaked := files[filepath.Join(".arc", "additions.md")]; leaked {
			t.Fatalf("%s: .arc/additions.md must not be copied", rt)
		}
	}
}

func TestApplyWritesAdditionsIntoTheHarnessSkill(t *testing.T) {
	p := testPaths(t, "", ".claude")
	seedSkill(t, p, "notes")
	_ = UpsertAddition(p.SkillsRoot, "notes", Addition{Key: "notes-vi", Text: "Write notes in Vietnamese", Learned: "2026-10-14", Count: 3})
	if _, err := Apply(p, false); err != nil {
		t.Fatal(err)
	}
	md, err := os.ReadFile(filepath.Join(p.Home, ".claude", "skills", "notes", "SKILL.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(md), "\n## Your additions\n<!-- arc:user -->\n") || !strings.HasSuffix(string(md), "- Write notes in Vietnamese (learned 2026-10-14, 3×)\n") {
		t.Fatalf("the projected SKILL.md lacks the additions:\n%s", md)
	}
}

func TestSeedShippedSkillsKeepsAdditions(t *testing.T) {
	// seed a shipped skill, add an addition, seed again: additions.md survives (mirror the setup of
	// TestSeedShippedSkillsFillsAnEmptyRoot at skills_test.go:346 and its shippedFS() helper)
}
```

Fill in `TestSeedShippedSkillsKeepsAdditions` following `TestSeedShippedSkillsFillsAnEmptyRoot`. `testPaths(t,
canonical, configRoots...)` takes the steering text and the harness config roots to create (`.claude` is Claude Code's,
`pkg/harness/catalog.go:57`). `claude` and `codex` are runtimes in `pkg/harness/catalog.go`. The Apply test stands in for
a live check: it proves an accepted line reaches `~/.claude/skills/<skill>/SKILL.md`.

**Step 2:** `go test ./pkg/agentsync -run 'Addition|RenderSkillAppends|SeedShippedSkillsKeepsAdditions|ApplyWritesAdditions'` — expected: build failure.

**Step 3: Implement** `pkg/agentsync/additions.go`:

```go
const (
	additionsFile = "additions.md"
	MaxAdditions  = 20
	additionsHead = "\n## Your additions\n<!-- arc:user -->\nThese are the user's own rules; where they conflict with the text above, they win.\n\n"
)

var (
	ErrNoSkill       = errors.New("no such skill in the vault")
	ErrAdditionsFull = fmt.Errorf("this skill already has %d additions; remove one first", MaxAdditions)
	additionLine     = regexp.MustCompile(`^- (.+) <!-- arc:learn key=([a-z0-9-]+) learned=(\d{4}-\d{2}-\d{2}) count=(\d+) -->$`)
)

// Addition is one line the user accepted into a skill. It lives in <skill>/.arc/additions.md, so the
// shipped-skill seed, which keeps .arc/, never overwrites it.
type Addition struct {
	Key     string `json:"key"`
	Text    string `json:"text"`
	Learned string `json:"learned"`
	Count   int    `json:"count"`
}
```

- `ReadAdditions(skillsRoot, name)`: missing file → `nil, nil`; parse lines with `additionLine`, skip the rest.
- `writeAdditions`: one `- <text> <!-- arc:learn key=… learned=… count=… -->` line each; empty list removes the file.
- `UpsertAddition(skillsRoot, name, a)`: `ErrNoSkill` unless `<root>/<name>/SKILL.md` exists; replace by key (text and
  learned from `a`, count += `a.Count`) or append; `ErrAdditionsFull` when appending at the cap.
- `RemoveAddition(skillsRoot, name, key)`: no-op when absent.
- `renderAdditions(list) string`: `additionsHead` + `- <text> (learned <date>, <n>×)\n` per line; `""` for none.

In `skills.go` `renderSkill`, after `applyOverrides`, read the additions and, when there are any, set
`files[skillFile] = strings.TrimRight(md, "\n") + "\n" + renderAdditions(list)`. Add `Additions []Addition
`json:"additions,omitempty"`` to `SkillRow` and fill it in `SkillRows`.

**Step 4:** the focused tests above plus `go test ./pkg/agentsync -run 'RenderSkill|SeedShipped|SkillRows'` — PASS.

**Step 5:** Commit: `git commit -m "feat(agentsync): render a skill's learned additions after its shipped text" -- pkg/agentsync/additions.go pkg/agentsync/additions_test.go pkg/agentsync/skills.go pkg/agentsync/skills_test.go`

---

### Task 3: Learned Claude memory files in `pkg/learn`

**Depends on:** Task 1
**Files:** `pkg/learn/memory.go`, `pkg/learn/memory_test.go`

Claude names a project dir by `agentobserve.SlugifyCwd(cwd)` (`pkg/agentobserve/slug.go:25`: every non-alphanumeric
rune → `-`; `memroots.ProjectHash` misses dots and underscores, so do not use it).

**Step 1: Failing tests** (`home := t.TempDir()`):

- `TestUpsertMemoryWritesFileAndIndexLine`: `UpsertMemory(home, Memory{Cwd: `D:\w\proj`, Key: "no-push", Text: "Commit, never push", Learned: "2026-10-14", Count: 2}, []string{"đừng push", "commit thôi"})`;
  assert `home/.claude/projects/D--w-proj/memory/learned_no-push.md` exists with frontmatter
  `name: no-push`, `description: Commit, never push`, `metadata:` `type: feedback`, `source: learned`,
  `learned: 2026-10-14`, `count: 2`, `cwd: D:\w\proj` (quote the cwd value as a YAML string), a body holding the text
  and `**Why:**` with both quotes; and `MEMORY.md` holds exactly one line
  `- [Commit, never push](learned_no-push.md) — learned 2026-10-14`.
- `TestUpsertMemoryReplacesAndKeepsOtherIndexLines`: pre-write `MEMORY.md` with an unrelated line; upsert twice;
  the unrelated line survives, the learned line appears once, count is the sum.
- `TestRemoveMemory`: removes the file and only its index line; removing a missing one is not an error.
- `TestListMemories`: two projects with learned files plus one ordinary memory file → only the two learned ones, with
  `Cwd`, `Key`, `Text`, `Learned`, `Count`, `Dir` filled; sorted by `Learned` descending, then key.

**Step 2:** `go test ./pkg/learn -run 'Memor'` — build failure.

**Step 3: Implement** `type Memory struct { Cwd, Dir, Key, Text, Learned string; Count int }` and
`MemoryDir(home, cwd)`, `UpsertMemory(home string, m Memory, why []string) error`, `RemoveMemory(dir, key string) error`,
`ListMemories(home string) ([]Memory, error)` (glob `home/.claude/projects/*/memory/learned_*.md`; parse the
frontmatter with `gopkg.in/yaml.v3`; skip and log a file that fails). Index line text is the memory text cut to 80
runes. Write files with a temp file + rename.

**Step 4:** `go test ./pkg/learn -run 'Memor'` — PASS.

**Step 5:** Commit: `git commit -m "feat(learn): write, list and remove learned Claude memories" -- pkg/learn/memory.go pkg/learn/memory_test.go`

---

### Task 4: wshrpc commands, Needs you items, generated bindings

**Depends on:** Task 2, Task 3
**Files:** `pkg/wshrpc/wshrpctypes_learn.go`, `pkg/wshrpc/wshrpctypes.go`, `pkg/wshrpc/wshrpctypes_agentsync.go`, `pkg/wshrpc/wshrpctypes_channels.go`, `pkg/wshrpc/wshserver/wshserver_learn.go`, `pkg/wshrpc/wshserver/wshserver_agentsync.go`, `pkg/jarvis/attention.go`, `pkg/jarvis/attention_learn_test.go`, `pkg/wshrpc/wshclient/wshclient.go`, `frontend/app/store/wshclientapi.ts`, `frontend/types/gotypes.d.ts`

Follow `AgentSyncCommands` (`pkg/wshrpc/wshrpctypes_agentsync.go:8`, embedded at `pkg/wshrpc/wshrpctypes.go:41`) and
its server `pkg/wshrpc/wshserver/wshserver_agentsync.go`.

**Step 1: Types** in `wshrpctypes_learn.go`:

```go
type LearnCommands interface {
	LearnNoteCommand(ctx context.Context, data CommandLearnNoteData) (*CommandLearnNoteRtnData, error)
	LearnKeysCommand(ctx context.Context, data CommandLearnKeysData) ([]LearnKey, error)
	LearnDecideCommand(ctx context.Context, data CommandLearnDecideData) error
	LearnAcceptedCommand(ctx context.Context) (*CommandLearnAcceptedRtnData, error)
	LearnAmendCommand(ctx context.Context, data CommandLearnAmendData) error
}

type CommandLearnNoteData struct {
	Key     string `json:"key"`
	Skill   string `json:"skill,omitempty"` // a vault skill; empty with Cwd set means memory
	Cwd     string `json:"cwd,omitempty"`
	Text    string `json:"text"`
	Quote   string `json:"quote,omitempty"`
	Session string `json:"session"`
}
type CommandLearnNoteRtnData struct {
	Proposed bool `json:"proposed"` // this note made (or kept) a pending proposal
	Muted    bool `json:"muted"`    // the user dismissed this key before; nothing was noted
}
type CommandLearnKeysData struct {
	Skill string `json:"skill,omitempty"`
	Cwd   string `json:"cwd,omitempty"`
}
type LearnKey struct {
	Key   string `json:"key"`
	Text  string `json:"text"`
	Notes int    `json:"notes"`
}
type CommandLearnDecideData struct {
	ID     string `json:"id"`
	Accept bool   `json:"accept"`         // false dismisses and mutes
	Text   string `json:"text,omitempty"` // the edited line; empty keeps the proposal's
}
type LearnAddition struct {
	Key     string `json:"key"`
	Text    string `json:"text"`
	Learned string `json:"learned"`
	Count   int    `json:"count"`
}
type LearnedSkillLine struct {
	Skill string `json:"skill"`
	LearnAddition
}
type LearnedMemoryLine struct {
	Cwd string `json:"cwd"`
	Dir string `json:"dir"`
	LearnAddition
}
type CommandLearnAcceptedRtnData struct {
	Skills   []LearnedSkillLine  `json:"skills"`
	Memories []LearnedMemoryLine `json:"memories"`
}
type CommandLearnAmendData struct {
	Skill  string `json:"skill,omitempty"` // a skill line, or
	Dir    string `json:"dir,omitempty"`   // a memory dir (with Cwd for the mute id)
	Cwd    string `json:"cwd,omitempty"`
	Key    string `json:"key"`
	Text   string `json:"text,omitempty"`
	Remove bool   `json:"remove"`
}
```

Embed `LearnCommands` next to `AgentSyncCommands`. Add `Additions []LearnAddition `json:"additions,omitempty"`` to
`AgentSyncSkill` and `LearnID string `json:"learnid,omitempty"`` to `AttentionItem`.

**Step 2: Failing test** `pkg/jarvis/attention_learn_test.go`: `learnItems([]learn.Proposal{…})` turns a skill
proposal into `AttentionItem{Kind: "learn-proposal", Key: "learn:skill:notes#notes-vi", LearnID: "skill:notes#notes-vi",
Source: "Skill · notes", Text: <text>, Action: "Accept", WaitingSince: <Since>, Why: "“q1” · “q2”"}` and a memory
proposal's Source into `"Memory · <base name of the cwd>"`; and `BuildAttention` with `AttentionInput{Learn: …}`
includes them. Run `go test ./pkg/jarvis -run 'Learn'` — build failure.

**Step 3: Implement.**

- `pkg/jarvis/attention.go`: `AttentionLearnProposal = "learn-proposal"` beside the other kinds (`:32-48`);
  `Learn []learn.Proposal` on `AttentionInput` (`:79`); `learnItems` appended in `BuildAttention` the way `chunkDueItems`
  is (`:403`); in `GatherAttentionFromLedger` set `in.Learn` from `learn.Default().Pending()`, logging (not
  returning) an error so a bad log never empties Needs you.
- `wshserver_learn.go`:
  - `LearnNote`: a skill target needs `<SkillsRoot>/<skill>/SKILL.md`, else an error naming the vault's skills and
    suggesting `--memory`; neither skill nor cwd is an error. `ErrMuted` → `{Muted: true}`, no error. After `Add`,
    `Proposed` = the ID is in `Pending()`.
  - `LearnKeys`: `Keys(target)` mapped to `[]LearnKey`.
  - `LearnDecide` accept: `Peek`; for a skill, `agentsync.UpsertAddition(SkillsRoot, name, Addition{Key, Text: data.Text
    or p.Text, Learned: today, Count: p.Sessions})` then `agentsync.Apply(agentsync.DefaultPaths(), false)`; for memory,
    `learn.UpsertMemory(wavebase.GetHomeDir(), …, quotes)`; only after the write succeeds, `Take`. A write error
    is returned and the proposal stays: `ErrAdditionsFull` as is, and `ErrNoSkill` (the skill left the vault while the
    proposal waited) as `the skill <name> is no longer in the vault; dismiss this card`. Dismiss: `Mute(id)`.
  - `LearnAccepted`: every canonical skill's `ReadAdditions` plus `ListMemories(home)`; empty slices, never nil.
  - `LearnAmend`: remove → `RemoveAddition` + `Apply`, or `RemoveMemory(dir, key)`; then `Mute` the ID (`memory:<cwd>`
    for memory). Edit → `UpsertAddition` (then `Apply`) or `UpsertMemory` with the new text, `Count: 0` and the existing learned
    date.
- `wshserver_agentsync.go:93`: copy `r.Additions` into `AgentSyncSkill.Additions`.

**Step 4:** `task generate`, then `go test ./pkg/jarvis -run 'Learn|Attention' && go build ./...` — PASS.

**Step 5:** Commit every file in this task's Files line: `git commit -m "feat(learn): wshrpc commands and Needs you proposals" -- <those paths>`

---

### Task 5: `wsh learn` and the shipped `learn` skill

**Depends on:** Task 4
**Files:** `cmd/wsh/cmd/wshcmd-learn.go`, `cmd/wsh/cmd/wshcmd-learn_test.go`, `skills/learn/SKILL.md`, `skills/skills.go`, `AGENTS.md`

Follow `cmd/wsh/cmd/wshcmd-note.go` (cobra parent + subcommands, `PreRunE: preRunSetupRpcClient`,
`wshclient.…Command(RpcClient, …, nil)`, registration in `init()`).

**Step 1: Failing test** `TestLearnSession`: `learnSession("blk-1", time.Date(2026,10,14,…))` → `"blk-1:2026-10-14"`,
and `learnSession("", …)` → `"cli:2026-10-14"`. Run `go test ./cmd/wsh/cmd -run 'TestLearnSession'` — fails.

**Step 2: Implement.**

- `wsh learn note "<text>" --key <k> (--skill <name> | --memory) [--quote <q>]`: exactly one of `--skill`/`--memory`;
  `--memory` sends `Cwd` from `os.Getwd()`; `Session` from `learnSession(os.Getenv("WAVETERM_BLOCKID"), time.Now())`.
  Prints `Noted.`, `Noted; it is waiting for the user's yes in Needs you.` when `Proposed`, or
  `Not noted: the user dismissed this before.` when `Muted` (exit 0 in all three).
- `wsh learn list (--skill <name> | --memory)`: one line per key, `<key>  <notes>×  <text>`; `--json` like `wsh note`.
- `skills/learn/SKILL.md`:

```markdown
---
name: learn
description: Use when the user corrects you, repeats an instruction, or says "from now on…" / "always…" / "never…" — note it with `wsh learn note` so a repeated correction becomes a lasting rule they approve.
---

# Noting what the user teaches you

When the user corrects how you work, repeats something they told you before, or states a lasting preference, note it.
Arcterm counts notes; when the same point comes up in two sessions it asks the user, in Needs you, whether to make it a
rule. Nothing changes until they say yes, so note freely but only real corrections, not one-off task details.

1. Pick the target: the vault skill the rule belongs to (`--skill <name>`, e.g. `notes`, `cockpit-runs`), or
   `--memory` for a rule about this project that no skill owns.
2. Reuse a key: `wsh learn list --skill <name>` (or `--memory`). If a listed key means the same thing, use it.
   Otherwise make a short kebab-case key (`notes-in-vietnamese`).
3. Note it, as one imperative line of at most 200 characters, with the user's own words as the quote:

   wsh learn note "Write notes in Vietnamese" --key notes-in-vietnamese --skill notes --quote "<what they said>"

- "Not noted: the user dismissed this before" means they declined this rule: follow their current instruction, do not
  note it again.
- If `wsh learn` fails, tell the user in one line and carry on; do not retry.
- Plugin skills (superpowers, anthropic-skills) cannot take additions: use `--memory`.
```

- `skills/skills.go:10`: add `learn` to the `//go:embed` list.
- `AGENTS.md`: add `learn` to the list in "arcterm's own skills live in `skills/`".

**Step 3:** `go test ./cmd/wsh/cmd -run 'TestLearnSession' && go build ./cmd/wsh ./skills` — PASS.

**Step 4:** Commit: `git commit -m "feat(learn): wsh learn and the learn skill" -- cmd/wsh/cmd/wshcmd-learn.go cmd/wsh/cmd/wshcmd-learn_test.go skills/learn/SKILL.md skills/skills.go AGENTS.md`

---

### Task 6: The learn row in Needs you

**Depends on:** Task 4
**Files:** `frontend/app/cockpit/palette-needs.ts`, `frontend/app/cockpit/palette-needs.test.ts`, `frontend/app/view/agents/needsyoustripmodel.ts`, `frontend/app/view/agents/needsyoustripmodel.test.ts`, `frontend/app/view/agents/needsyoustrip.tsx`

Read `needsyoustrip.tsx` (183 lines) and `needsyoustripmodel.ts` whole first.

**Step 1: Failing tests.**

- `palette-needs.test.ts` (create it if missing): an item of kind `"learn-proposal"` lands in the `"reviews"` group.
- `needsyoustripmodel.test.ts`: `buildNeedsYouRows` turns a `learn-proposal` item into a row with
  `act: { kind: "learn", learnId }`, `open: null`, text = the item's text, source = the item's source, and `why` = the
  item's Why; the row is not hidden by a project filter (learnings are not tied to a channel).

Run `npx vitest run frontend/app/cockpit/palette-needs.test.ts frontend/app/view/agents/needsyoustripmodel.test.ts` — fails.

**Step 2: Implement.**

- `palette-needs.ts` `KIND_GROUP` (`:23-28`): `"learn-proposal": "reviews"`.
- `needsyoustripmodel.ts`: the `learn` act kind and the row mapping above.
- `needsyoustrip.tsx`: a learn row shows its text, a muted source line, a `Why` toggle that unfolds the quotes
  (folded by default), and three `SMALL_BTN` buttons: **Accept** (`RpcApi.LearnDecideCommand(TabRpcClient, {id, accept: true})`),
  **Edit** (swaps the text for an inline input prefilled with it; Enter accepts with `text`, Escape cancels), and
  **Dismiss** (`accept: false`). Use the strip's `busy` set while a call is in flight, toast a failure with its message
  (e.g. the 20-additions cap), and refresh the attention list after a call the way the other actions do (find how
  `attentionAtom` reloads in `attentionstore.ts`).

**Step 3:** the vitest command above — PASS; then the Check line.

Give the row and its controls stable hooks for the scenarios: `data-learn-id="<learnId>"` on the row, and
`data-testid` `learn-why`, `learn-accept`, `learn-edit`, `learn-edit-input`, `learn-dismiss` on its parts.

**Acceptance:** scenario `needs-you-learn-card` (registered in Task 8) shows the row, unfolds Why, clicks Accept,
accepts an edited line with Enter, shows the failure toast at the 20-additions cap, and dismisses a row.

**Step 4:** Commit: `git commit -m "feat(learn): accept, edit or dismiss a learned rule from Needs you" -- <the files above>`

---

### Task 7: Setup — additions in the Skills rail and the Learned tab

**Depends on:** Task 4
**Files:** `frontend/app/view/agents/learnedmodel.ts`, `frontend/app/view/agents/learnedmodel.test.ts`, `frontend/app/view/agents/learnedtab.tsx`, `frontend/app/view/agents/skillsmatrix.ts`, `frontend/app/view/agents/skillsmatrix.test.ts`, `frontend/app/view/agents/setupstore.ts`, `frontend/app/view/agents/setupsurface.tsx`

**Step 1: Failing tests** in `learnedmodel.test.ts`:

- `isNewLine("2026-10-08", "2026-10-14")` is true, `isNewLine("2026-10-07", "2026-10-14")` is false (7 days
  inclusive of today).
- `lineMeta({learned: "2026-10-14", count: 3})` → `"14/10 · 3×"`.
- `learnedGroups(accepted)` → skill groups (title = skill name, sorted by name) then memory groups (title = the cwd's
  last path segment, `subtitle` = the full cwd), each group's lines newest first.

And in `skillsmatrix.test.ts`: `skillRows` carries a managed skill's `additions` onto its `SkillRow` (default `[]`),
and `additionsChip(row)` is `"+2"` for two additions and `null` for none.

Run `npx vitest run frontend/app/view/agents/learnedmodel.test.ts frontend/app/view/agents/skillsmatrix.test.ts` — fails.

**Step 2: Implement.**

- `learnedmodel.ts`: the three pure functions above.
- `skillsmatrix.ts`: `additions: LearnAddition[]` on `SkillRow` (`:34-43`) filled from `AgentSyncSkill.additions`;
  `additionsChip`.
- `setupstore.ts`: `SetupTab` (`:27`) gains `"learned"`; a `setupLearnedAtom` loaded by `loadLearned()` from
  `LearnAcceptedCommand`; `amendLearned(line, {text} | {remove: true})` calls `LearnAmendCommand` and reloads both the
  learned list and the skills list.
- `setupsurface.tsx`:
  - `TABS` (`:96-100`) gains `{ key: "learned", label: "Learned" }` after Skills.
  - Skill list rows show the `+N` chip (a small mono pill in the accent token) beside the name.
  - `SkillRail` (`:684`) renders, under the SKILL.md preview, a "Your additions" block when the row has additions:
    left border in the accent token, each line its text, `lineMeta` in muted mono, a faint accent background when
    `isNewLine`, and **Edit** (inline input, Enter saves, Escape cancels) and **Remove** buttons.
  - The Learned tab mounts `learnedtab.tsx`: the groups from `learnedGroups`, lines styled exactly like the rail's
    block (share one `LearnedLine` component exported from `learnedtab.tsx`), and an empty state: "Nothing learned
    yet. When you correct an agent the same way in two sessions, it asks you here first."
  - Stable hooks for the scenarios: `data-learned-line="<skill or cwd>#<key>"` on each `LearnedLine`,
    `data-testid` `learned-edit`, `learned-edit-input`, `learned-remove` on its parts, `learned-additions` on the
    rail's block, `skill-additions-chip` on the chip, and `learned-empty` on the empty state.

**Step 3:** the vitest command above — PASS; then the Check line.

**Acceptance:** scenarios `setup-skill-additions` (the rail block, the "new" highlight, the `+1` chip, the rail's Edit
and Remove) and `setup-learned` (the empty state, the Learned tab's groups, its Edit and Remove) from Task 8.

**Step 4:** Commit: `git commit -m "feat(learn): show learned lines in Setup, apart from the shipped text" -- <the files above>`

---

### Task 8: CDP scenarios and changelog

**Depends on:** Task 5, Task 6, Task 7
**Files:** `scripts/cdp/scenarios.mjs`, `CHANGELOG.md`

Read the scenario contract at the top of `scripts/cdp/scenarios.mjs` (`:1-50`) and the `surface-smoke` entry
(`:90-112`). Scenarios call RPCs with `h.rpc("<command lowercased, without Command>", data)` (e.g. `h.rpc("learnnote",
…)`, `h.rpc("agentsyncapply", { dryrun: false })`). There are no Setup Skills fixture scenarios to copy; build the
fixtures below. A failed arrange or teardown step must fail the scenario, not be skipped, and an arrange that fails
part-way runs the teardown for what it made (as `settings-vault-sync` does, `:33307-33323`).

**What the Final app shares with the user, and how the fixtures stay apart.** Final's app has its own data dir
(`ARC_DEV_DATA_DIR`), so `notes.jsonl`, `muted.json` and `proposed.json` are throwaway. It does **not** have its own vault
or home: the vault root is `vaultRoot(h)` (`scripts/cdp/notes-wsh.mjs:27`, the configured path or
`~/.waveterm/vault`), and `agentsync.Apply` writes into the real `~/.claude/skills` (and each other harness's skills
dir). Do not point the app at a temp vault: `Apply` removes from every harness the managed skills that vault lacks.
Instead:

- **Fixture skill** (helpers `arrangeLearnSkill(h)` / `teardownLearnSkill(h, ctx)`, shared by the scenarios that need
  one): `root = await vaultRoot(h)`; throw if `vaultRemote(root)` is non-empty (as `:23166-23168` do, so a fixture is
  never pushed); name `cdp-learn-<Date.now()>`; throw if `<root>/skills/<name>` exists; write
  `<root>/skills/<name>/SKILL.md` (`---\nname: <name>\ndescription: CDP fixture for the learned-additions scenarios\n---\n\nA fixture skill.\n`);
  then `h.rpc("agentsyncapply", { dryrun: false })`. Teardown: `rmSync` `<root>/skills/<name>` (recursive), then
  `agentsyncapply` again, which removes the copies arcterm projected into each harness, then throw if
  `~/.claude/skills/<name>` still exists.
- **Fixture memory**: `cwd = mkdtempSync(join(tmpdir(), "cdp-learn-"))`; a learned memory for it lands in
  `~/.claude/projects/<slug>/memory`, where `<slug>` is `cwd` with every character that is not an ASCII letter or digit
  replaced by `-` (mirrors `agentobserve.SlugifyCwd`, `pkg/agentobserve/slug.go:25`). Teardown removes
  `~/.claude/projects/<slug>` and `cwd`.
- **Proposals**: two `learnnote` calls per key, sessions `cdp-a:<today>` and `cdp-b:<today>`, each with a quote.

**Step 1: Add three scenarios.**

- `needs-you-learn-card` (one fixture skill, one fixture memory cwd): arrange four proposals: memory keys
  `cdp-accept`, `cdp-edit` and `cdp-dismiss`, and skill key `cdp-full` on the fixture skill after writing 20 lines
  straight into `<root>/skills/<name>/.arc/additions.md` in Task 2's line format (`- t<i> <!-- arc:learn key=k<i>
  learned=<today> count=1 -->`). Goto cockpit, then:
  1. the `cdp-accept` row shows its text and Accept / Edit / Dismiss (shot); click Why and assert both quotes (shot);
  2. click Accept: the row leaves, and `learnaccepted` lists the `cdp-accept` memory;
  3. on `cdp-edit`, click Edit and assert the input holds the text (shot); type a new text and press Enter: the row
     leaves, and `learnaccepted` lists `cdp-edit` with the new text;
  4. on `cdp-full`, click Accept: an error toast says to remove one first, and the row stays (shot);
  5. on `cdp-dismiss`, click Dismiss: the row leaves, and a third `learnnote` for it returns `muted: true`.
  Teardown: `learndecide` dismiss on `cdp-full` if still pending, `teardownLearnSkill`, the memory fixture.
- `setup-skill-additions` (one fixture skill): arrange two notes for it, then `learndecide` accept. Goto setup, Skills
  tab, select the skill; assert the `+1` chip, the additions block with the line, `lineMeta` (`<dd/mm> · 2×`) and the
  "new" background (shot); click Edit, type a new text, Enter, and assert the line shows it (shot); click Remove and
  assert the block and the chip are gone (shot). Teardown: `learnamend` remove (a no-op once removed), then
  `teardownLearnSkill`.
- `setup-learned` (one fixture skill, one fixture memory cwd): first, before arranging lines, goto setup → Learned and
  call `learnaccepted`: when it returns no lines, assert the empty-state text (shot); when the machine already has
  learned lines, record the step as passed with the detail `skipped: N learned lines already exist` (the
  empty-state branch is also covered by `learnedGroups([])` in Task 7). Then arrange one accepted skill line and one
  accepted memory line, reload the tab, and assert both groups and lines (shot); Edit the skill line on this tab and
  assert the new text (shot); Remove the memory line and assert it is gone and its file under
  `~/.claude/projects/<slug>/memory` is deleted (shot). Teardown: `learnamend` remove the skill line, then
  `teardownLearnSkill` and the memory fixture.

**Step 2:** `node --check scripts/cdp/scenarios.mjs`.

**Step 3:** `CHANGELOG.md`: the top section is already `## Unreleased`; add this line under its `### Added` (do not
open a second section): "**Agents learn your corrections**: agents now note how you correct them. When the same
correction comes up in two sessions, Needs you asks whether to keep it as a rule, and the lines you accept appear,
highlighted, under Setup → Learned and in each skill." Keep the file's style.

**Step 4:** Commit: `git commit -m "test(learn): CDP scenarios for the learn card, rail and Learned tab" -- scripts/cdp/scenarios.mjs CHANGELOG.md`
