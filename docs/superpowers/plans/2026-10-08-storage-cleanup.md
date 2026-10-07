# Storage Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Storage section in Settings that shows what arcterm and its agents leave on disk, per category, and cleans it safely — by button, by a daily auto-clean of the safe parts, and with a once-a-day nudge past a threshold.

**Architecture:** A new `pkg/storage` in `wavesrv` holds one provider per category (run worktrees, old Claude sessions, logs/cache/trash, build output); each measures and cleans, and re-checks every rule at the moment of removal. A `Scanner` keeps the last scan in memory, rescans in the background and publishes a `storage:scan` event; three RPCs read it, rescan and clean. The Tauri host clears the webview cache at launch when the Go side has left a marker. The frontend is a pure model (`storagemodel.ts`) plus a thin section, a store and a nudge mounted in the cockpit shell.

**Tech Stack:** Go 1.25 (`pkg/storage`, wshrpc, wps, wconfig), Rust (Tauri host), React 19 + jotai + Tailwind 4, vitest, the CDP harness.

**Spec:** `docs/superpowers/specs/2026-10-08-storage-cleanup-design.md`

**Verify:** `node scripts/verify.mjs ./pkg/storage/... ./pkg/orchestrate/... ./pkg/wshrpc/... ./pkg/wconfig/... ./pkg/wps/... ./cmd/server/...`

**Final:** `if [ "$(uname -s)" = Darwin ]; then echo "unverified: settings-storage needs CDP, which WKWebView on macOS does not answer"; exit 3; fi; node scripts/cdp/final-verify.mjs settings-storage`

## Global Constraints

- Category ids, exactly: `runworktrees`, `sessions`, `housekeeping`, `buildoutput`; the UI orders the cards in that order.
- Settings keys: `storage:autoclean` (bool, default `true`) and `storage:nudgegb` (number, default `2`), declared in `pkg/wconfig/settingsconfig.go` with defaults in `pkg/wconfig/defaultconfig/settings.json`; `task generate` writes the rest. Never hand-edit a generated file.
- Session ages offered: 7, 30 (default) and 90 days. Sessions go to `~/.arc/trash` through `pkg/sessiontrash` (kept 7 days, `sessiontrash.Retention`). Claude sessions only.
- A finished run is status `done` or `cancelled` (`jarvis.RunStatus_Done`, `jarvis.RunStatus_Cancelled`). A `blocked` run is NOT finished: its failed task can be retried. (The spec says "done, cancelled or failed"; runs have no `failed` status.)
- A run worktree is removed with its branch kept: a new `orchestrate.RemoveWorktreeKeepBranch`. Never `orchestrate.RemoveRunWorktree` (it deletes `wave/<runId>`), and never `os.RemoveAll` on an engine tree (on Windows it can hold junctions into the main checkout).
- Build output names: `node_modules`, `target`, `dist`, `build`, `.next`, `__pycache__`; a `target` only beside a `Cargo.toml`; at most 3 levels below the project; never descending into a match, `.git`, `.waveterm` or `.claude`, or through a link; and only when `git check-ignore` says the project ignores it. No "Clean all" for build output.
- The webview cache is never deleted while the app runs: the clean writes `<data>/clear-webview-cache`; the host removes the cache dirs and the marker in `main()` before the Tauri builder creates the window. macOS: `~/Library/Caches/<identifier>/WebKit/{NetworkCache,CacheStorage}`. Windows: `<app base>/EBWebView/Default/{Cache,Code Cache,GPUCache}`, where `<app base>` is the parent of the data dir (the spec's `<data>/EBWebView` is a slip: EBWebView sits beside `data`, not in it).
- Auto-clean: first pass 2 minutes after start, then every 24 hours, only when `storage:autoclean` is on; it cleans finished run worktrees with no uncommitted changes and rolled logs older than 7 days, nothing else.
- Nudge: an in-app toast at most once a day when the cleanable total passes `storage:nudgegb` GB; it opens Settings → Storage.
- Event name: `storage:scan`, data `storage.StorageReport`.
- Go types that reach TypeScript carry a `Storage` prefix (`StorageReport`, `StorageItem`…): generated TS names a type by its bare Go name, and `Item`/`Report` would collide.
- UI copy is English. Colors only from `@theme` tokens (`text-primary`, `text-muted`, `text-warning`, `bg-surface-raised`, `border-edge-mid`…), never raw hex.
- Never run prettier on `scripts/*.mjs`. `npx tsc` overflows: typecheck with `NODE_OPTIONS=--max-old-space-size=4096 task check:ts` (about 2 minutes).
- Commits carry no Co-Authored-By trailer.

## Review Focus

1. **A project checkout whose `node_modules` is a link or a junction** (a worktree prepared with `task worktree:prepare`, or a symlink to the main checkout's): build output must never list it nor remove through it — removing the target would wipe the main checkout's dependencies. Pinned in Task 5 (`TestBuildOutputNeverFollowsALink`).
2. **A directory under `.waveterm/worktrees` that the engine did not make** (a name without a run id): it is listed as "not a run worktree" and never removed, by Clean all, by its row or by auto-clean. Pinned in Task 2 (`TestWorktreeThatIsNotAnEngineTreeIsNeverCleaned`).
3. **The sessions card's age changed between the view and the click** (ids picked at 7 days, sent with `olderthandays` 30): the server re-checks each file's age and skips the newer ones with the reason. Pinned in Task 3 (`TestCleanSkipsASessionNewerThanTheChosenAge`).
4. **A project path written differently in config and in the roster** (a trailing separator, or a different case on Windows): the busy check must still match, or a build directory under a running build gets removed. Pinned in Task 1 (`TestSamePath`) and Task 5 (`TestBusyProjectMatchesAPathWithATrailingSeparator`).
5. **Rescan or Clean clicked while a scan runs:** the scan in flight finishes, exactly one more follows, and nothing scans twice at once. Pinned in Task 1 (`TestRescanDuringAScanRunsExactlyOneMore`).

## File Structure

- `pkg/storage/storage.go` — types (`StorageCategory`, `StorageItem`, `StorageCategoryReport`, `StorageReport`, `StorageSkipped`, `StorageCleanResult`, `StorageAutoClean`, `CleanOpts`, `RunState`, `Env`), the `provider` interface, `report`, `dirSize`, `SamePath`, `evalOrClean`, `gitOut`, `skip`, `fileExists`.
- `pkg/storage/scanner.go` — `Scanner`: the cached report, background rescans, clean dispatch.
- `pkg/storage/worktrees.go` — run worktrees provider.
- `pkg/storage/sessions.go` — old Claude sessions provider.
- `pkg/storage/housekeeping.go` — rolled logs, the session trash, the webview cache marker; `WebviewCacheDirs`, `CacheMarkerName`.
- `pkg/storage/buildoutput.go` — build output provider.
- `pkg/storage/autoclean.go` — `Scanner.AutoClean`, `Scanner.StartLoop`.
- `pkg/storage/*_test.go` — one test file per source file.
- `pkg/orchestrate/worktree.go` — exports `RemoveWorktreeKeepBranch` and `RunOfWorktree`.
- `pkg/wshrpc/wshrpctypes_storage.go` — `StorageCommands`, `CommandCleanStorageData`.
- `pkg/wshrpc/wshserver/wshserver_storage.go` — handlers, the `Env` wiring, `busyProjectsOf`, `StartStorage`.
- `pkg/wps/wpstypes.go`, `pkg/tsgen/tsgenevent.go` — the `storage:scan` event.
- `pkg/wconfig/settingsconfig.go`, `pkg/wconfig/defaultconfig/settings.json` — the two settings.
- `cmd/server/main-server.go` — starts storage.
- `src-tauri/src/webcache.rs`, `src-tauri/src/paths.rs`, `src-tauri/src/main.rs` — the launch-time cache clear.
- `frontend/app/view/agents/storagemodel.ts` (+ `.test.ts`) — pure model.
- `frontend/app/view/agents/storagestore.ts` — report atom, load, clean, rescan.
- `frontend/app/view/agents/storagesection.tsx` — the cards (`StoragePanel`).
- `frontend/app/view/agents/storagenudge.tsx` — the once-a-day toast.
- `frontend/app/view/agents/settingsmodel.ts` (+ test), `settingssurface.tsx`, `settingsstore.ts`, `cockpitshell.tsx` — section wiring.
- `scripts/cdp/scenarios.mjs` — `settings-storage`.
- `CHANGELOG.md` — one Added line.

---

### Task 1: `pkg/storage` foundation and the Scanner

**Depends on:** none

**Files:**
- Create: `pkg/storage/storage.go`
- Create: `pkg/storage/scanner.go`
- Test: `pkg/storage/storage_test.go`

**Interfaces:**
- Produces (used by Tasks 2–5 and 7):
  - `type StorageCategory string`; consts `CategoryRunWorktrees`, `CategorySessions`, `CategoryHousekeeping`, `CategoryBuildOutput`.
  - Kind consts `KindWorktree`, `KindSession`, `KindLog`, `KindTrash`, `KindWebviewCache`, `KindBuild`.
  - `type StorageItem struct{ ID, Kind, Label, Detail, Path string; Bytes, ModTs int64; Cleanable, Guarded bool; Reason string }`
  - `type StorageCategoryReport struct{ Category StorageCategory; Bytes, CleanableBytes int64; Items []StorageItem; Error string }`
  - `type StorageReport struct{ ScannedTs int64; Scanning bool; Categories []StorageCategoryReport; StoreBytes int64; LastAuto *StorageAutoClean }`
  - `type StorageSkipped struct{ ID, Reason string }`
  - `type StorageCleanResult struct{ Reclaimed, Trashed int64; Deferred bool; Cleaned []string; Skipped []StorageSkipped }`
  - `type StorageAutoClean struct{ Ts, Reclaimed int64; Error string }`
  - `type CleanOpts struct{ OlderThanDays int; AllowGuarded, Auto bool }`
  - `type RunState struct{ Found, Finished bool; Status string }`
  - `type Env struct{ Now func() time.Time; ProjectPaths func() []string; RunOfWorktree func(string) (string, bool); RunState func(context.Context, string) (RunState, error); BusyProjects func(context.Context) (map[string]string, error); LiveTranscripts func(context.Context) ([]string, error); RemoveWorktree func(context.Context, string, string) error; DataDir, TrashDir string; SessionDirs, WebviewCacheDirs []string }`
  - `type provider interface{ category() StorageCategory; measure(ctx, *Env) StorageCategoryReport; clean(ctx, *Env, []string, CleanOpts) StorageCleanResult }`
  - test helpers `writeFile(t, path, size)`, `itemByID(items, id) StorageItem`, `testEnv(t)`, `waitFor(t, cond)` (in `storage_test.go`); helpers `report(cat, items, err) StorageCategoryReport`, `dirSize(root string) int64`, `SamePath(a, b string) bool`, `evalOrClean(p string) string`, `gitOut(ctx, dir string, args ...string) (string, error)`, `skip(res *StorageCleanResult, id, reason string)`, `fileExists(p string) bool`.
  - `func NewScanner(env *Env, publish func(StorageReport)) *Scanner`; methods `Report() StorageReport`, `Rescan(ctx)`, `ScanNow(ctx) StorageReport`, `Clean(ctx, StorageCategory, []string, CleanOpts) (StorageCleanResult, error)`. Fields used by Task 7: `env`, `providers`, `publish`, `mu`, `lastAuto`.
  - `NewScanner` lists the providers `runWorktrees{}`, `oldSessions{}`, `housekeeping{}`, `buildOutput{}` (Tasks 2–5 define them). Until those land, keep the list in one place: Task 1 writes `defaultProviders()` returning an empty slice, and each of Tasks 2–5 appends its provider there in the same order (worktrees, sessions, housekeeping, build output).

- [ ] **Step 1: Write the failing tests**

`pkg/storage/storage_test.go`:

```go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package storage

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"sync/atomic"
	"testing"
	"time"
)

func writeFile(t *testing.T, path string, size int) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, make([]byte, size), 0o644); err != nil {
		t.Fatal(err)
	}
}

func itemByID(items []StorageItem, id string) StorageItem {
	for _, it := range items {
		if it.ID == id {
			return it
		}
	}
	return StorageItem{}
}

func TestDirSizeSumsFilesAndSkipsLinks(t *testing.T) {
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "a", "one"), 3)
	writeFile(t, filepath.Join(root, "a", "b", "two"), 5)
	outside := t.TempDir()
	writeFile(t, filepath.Join(outside, "big"), 1000)
	if err := os.Symlink(filepath.Join(outside, "big"), filepath.Join(root, "link")); err != nil {
		t.Skip("symlinks unavailable:", err)
	}
	if got := dirSize(root); got != 8 {
		t.Fatalf("dirSize = %d, want 8 (two files, the link not followed)", got)
	}
}

func TestDirSizeOfAMissingDirIsZero(t *testing.T) {
	if got := dirSize(filepath.Join(t.TempDir(), "gone")); got != 0 {
		t.Fatalf("dirSize = %d, want 0", got)
	}
}

func TestReportCountsOnlyUnguardedCleanableBytes(t *testing.T) {
	r := report(CategoryRunWorktrees, []StorageItem{
		{ID: "a", Bytes: 10, Cleanable: true},
		{ID: "b", Bytes: 20, Guarded: true},
		{ID: "c", Bytes: 40},
	}, errors.New("half read"))
	if r.Bytes != 70 || r.CleanableBytes != 10 || r.Error != "half read" {
		t.Fatalf("got %+v, want bytes 70, cleanable 10, the error kept", r)
	}
	if empty := report(CategorySessions, nil, nil); empty.Items == nil {
		t.Fatal("no items must be an empty list, not null, on the wire")
	}
}

func TestSamePath(t *testing.T) {
	if !SamePath("/p/proj/", "/p/proj") {
		t.Fatal("a trailing separator is the same path")
	}
	if SamePath("/p/proj", "/p/project") {
		t.Fatal("a longer name is a different path")
	}
	if runtime.GOOS == "windows" && !SamePath(`C:\P\Proj`, `c:\p\proj`) {
		t.Fatal("Windows paths compare without case")
	}
}

type fakeProvider struct {
	cat     StorageCategory
	rep     StorageCategoryReport
	gate    chan struct{}
	scans   atomic.Int32
	cleaned []string
}

func (f *fakeProvider) category() StorageCategory { return f.cat }

func (f *fakeProvider) measure(ctx context.Context, env *Env) StorageCategoryReport {
	f.scans.Add(1)
	if f.gate != nil {
		<-f.gate
	}
	return f.rep
}

func (f *fakeProvider) clean(ctx context.Context, env *Env, ids []string, opts CleanOpts) StorageCleanResult {
	f.cleaned = ids
	return StorageCleanResult{Cleaned: ids}
}

func testEnv(t *testing.T) *Env {
	return &Env{Now: time.Now, DataDir: t.TempDir()}
}

func waitFor(t *testing.T, cond func() bool) {
	t.Helper()
	for end := time.Now().Add(5 * time.Second); time.Now().Before(end); time.Sleep(5 * time.Millisecond) {
		if cond() {
			return
		}
	}
	t.Fatal("condition never held")
}

func TestScanNowKeepsEachCategorysError(t *testing.T) {
	ok := &fakeProvider{cat: CategoryRunWorktrees, rep: report(CategoryRunWorktrees, []StorageItem{{ID: "x", Bytes: 5, Cleanable: true}}, nil)}
	bad := &fakeProvider{cat: CategorySessions, rep: report(CategorySessions, nil, errors.New("unreadable"))}
	s := &Scanner{env: testEnv(t), providers: []provider{ok, bad}}
	r := s.ScanNow(context.Background())
	if len(r.Categories) != 2 || r.Categories[0].CleanableBytes != 5 || r.Categories[1].Error != "unreadable" {
		t.Fatalf("got %+v, want both categories, the second with its error", r.Categories)
	}
	if r.ScannedTs == 0 || s.Report().ScannedTs != r.ScannedTs {
		t.Fatal("the scan must be stamped and kept")
	}
}

func TestRescanDuringAScanRunsExactlyOneMore(t *testing.T) {
	gate := make(chan struct{})
	f := &fakeProvider{cat: CategoryRunWorktrees, gate: gate}
	var published atomic.Int32
	s := &Scanner{env: testEnv(t), providers: []provider{f}, publish: func(StorageReport) { published.Add(1) }}
	s.Rescan(context.Background())
	waitFor(t, func() bool { return f.scans.Load() == 1 })
	if !s.Report().Scanning {
		t.Fatal("the report must say a scan is running")
	}
	s.Rescan(context.Background())
	s.Rescan(context.Background())
	close(gate)
	waitFor(t, func() bool { return published.Load() == 2 && !s.Report().Scanning })
	time.Sleep(50 * time.Millisecond)
	if n := f.scans.Load(); n != 2 {
		t.Fatalf("scanned %d times, want 2: the one in flight and exactly one after it", n)
	}
}

func TestCleanDispatchesToItsCategoryAndRescans(t *testing.T) {
	f := &fakeProvider{cat: CategoryHousekeeping}
	var published atomic.Int32
	s := &Scanner{env: testEnv(t), providers: []provider{f}, publish: func(StorageReport) { published.Add(1) }}
	res, err := s.Clean(context.Background(), CategoryHousekeeping, []string{"trash"}, CleanOpts{})
	if err != nil || len(res.Cleaned) != 1 || len(f.cleaned) != 1 {
		t.Fatalf("got %+v, %v; want the provider to clean trash", res, err)
	}
	waitFor(t, func() bool { return published.Load() == 1 })
	if _, err := s.Clean(context.Background(), "nope", nil, CleanOpts{}); err == nil {
		t.Fatal("an unknown category must be an error")
	}
}
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `go test ./pkg/storage/`
Expected: FAIL to build — `undefined: dirSize`, `report`, `Scanner`, …

- [ ] **Step 3: Write `pkg/storage/storage.go`**

```go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package storage measures what arcterm and its agents leave on disk and cleans it (Settings → Storage):
// finished runs' worktrees, old Claude sessions, rolled logs with the session trash and the webview cache, and
// the projects' build output. Each category is a provider, and every rule a clean depends on is checked again at
// the moment of removal: a run can restart or a session reopen between a scan and a click. The types carry a
// Storage prefix because the generated TypeScript names a type by its bare Go name.
package storage

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

type StorageCategory string

const (
	CategoryRunWorktrees StorageCategory = "runworktrees"
	CategorySessions     StorageCategory = "sessions"
	CategoryHousekeeping StorageCategory = "housekeeping"
	CategoryBuildOutput  StorageCategory = "buildoutput"
)

// what an item is, for the row and for auto-clean's pick
const (
	KindWorktree     = "worktree"
	KindSession      = "session"
	KindLog          = "log"
	KindTrash        = "trash"
	KindWebviewCache = "webviewcache"
	KindBuild        = "build"
)

// StorageItem is one thing a category can clean: a run's worktree, a session, a rolled log, the trash, the
// webview cache, a build directory.
type StorageItem struct {
	ID        string `json:"id"` // what a clean names it by: its path, or "trash" / "webviewcache"
	Kind      string `json:"kind"`
	Label     string `json:"label"`
	Detail    string `json:"detail,omitempty"`
	Path      string `json:"path,omitempty"`
	Bytes     int64  `json:"bytes"`
	ModTs     int64  `json:"modts,omitempty"`     // unix ms of its last change: the sessions card filters by it
	Cleanable bool   `json:"cleanable"`           // a clean may remove it now
	Guarded   bool   `json:"guarded,omitempty"`   // only its own button removes it, after a confirm that says what is lost
	Reason    string `json:"reason,omitempty"`    // why it stays, or what removing it costs
}

type StorageCategoryReport struct {
	Category       StorageCategory `json:"category"`
	Bytes          int64           `json:"bytes"`
	CleanableBytes int64           `json:"cleanablebytes"` // cleanable and not guarded
	Items          []StorageItem   `json:"items"`
	Error          string          `json:"error,omitempty"` // what kept the scan from reading all of it
}

type StorageReport struct {
	ScannedTs  int64                   `json:"scannedts"` // 0 before the first scan
	Scanning   bool                    `json:"scanning"`
	Categories []StorageCategoryReport `json:"categories"`
	StoreBytes int64                   `json:"storebytes"` // arcterm's store (<data>/db): shown, never cleaned
	LastAuto   *StorageAutoClean       `json:"lastauto,omitempty"`
}

type StorageSkipped struct {
	ID     string `json:"id"`
	Reason string `json:"reason"`
}

type StorageCleanResult struct {
	Reclaimed int64            `json:"reclaimed"`          // bytes removed from disk
	Trashed   int64            `json:"trashed,omitempty"`  // bytes moved to ~/.arc/trash
	Deferred  bool             `json:"deferred,omitempty"` // the webview cache clears at the next launch
	Cleaned   []string         `json:"cleaned"`
	Skipped   []StorageSkipped `json:"skipped"`
}

type StorageAutoClean struct {
	Ts        int64  `json:"ts"`
	Reclaimed int64  `json:"reclaimed"`
	Error     string `json:"error,omitempty"`
}

// CleanOpts is how a clean was asked for.
type CleanOpts struct {
	OlderThanDays int  // sessions: the card's age
	AllowGuarded  bool // the item's own button, after its stronger confirm
	Auto          bool // the daily auto-clean: only what needs no one's say
}

// RunState is what a worktree's owner run says about the tree.
type RunState struct {
	Found    bool
	Finished bool   // done or cancelled
	Status   string // for the row
}

// Env is everything a provider reads from outside the filesystem, so tests run against temp dirs and fakes.
type Env struct {
	Now             func() time.Time
	ProjectPaths    func() []string                                    // the projects in config
	RunOfWorktree   func(path string) (runID string, ok bool)          // the run that owns an engine tree; ok false for a name the engine never makes
	RunState        func(ctx context.Context, runID string) (RunState, error)
	BusyProjects    func(ctx context.Context) (map[string]string, error) // project path -> why its build output must stay now
	LiveTranscripts func(ctx context.Context) ([]string, error)          // the transcripts open tabs are writing
	RemoveWorktree  func(ctx context.Context, projectPath, wt string) error
	DataDir         string // <data>: logs, the store, the cache marker
	TrashDir        string
	SessionDirs     []string
	WebviewCacheDirs []string
}

type provider interface {
	category() StorageCategory
	measure(ctx context.Context, env *Env) StorageCategoryReport
	clean(ctx context.Context, env *Env, ids []string, opts CleanOpts) StorageCleanResult
}

// report builds a category's report from its items and the error its scan ended with, if any.
func report(cat StorageCategory, items []StorageItem, err error) StorageCategoryReport {
	r := StorageCategoryReport{Category: cat, Items: items}
	if r.Items == nil {
		r.Items = []StorageItem{}
	}
	for _, it := range items {
		r.Bytes += it.Bytes
		if it.Cleanable && !it.Guarded {
			r.CleanableBytes += it.Bytes
		}
	}
	if err != nil {
		r.Error = err.Error()
	}
	return r
}

// dirSize is the summed size of the regular files under root, not following links. A missing or unreadable
// part counts as nothing: a scan reports what it can read.
func dirSize(root string) int64 {
	var total int64
	_ = filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.Type().IsRegular() {
			if info, ierr := d.Info(); ierr == nil {
				total += info.Size()
			}
		}
		return nil
	})
	return total
}

// SamePath compares two paths as the OS does: cleaned, and without case on Windows.
func SamePath(a, b string) bool {
	a, b = filepath.Clean(a), filepath.Clean(b)
	if runtime.GOOS == "windows" {
		return strings.EqualFold(a, b)
	}
	return a == b
}

// evalOrClean resolves the links in p, or cleans it when it cannot (a path that is gone).
func evalOrClean(p string) string {
	if r, err := filepath.EvalSymlinks(p); err == nil {
		return r
	}
	return filepath.Clean(p)
}

// gitOut runs git in dir and returns its stdout, also when git exits non-zero (check-ignore exits 1 for "none").
func gitOut(ctx context.Context, dir string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, "git", append([]string{"-C", dir}, args...)...)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		return string(out), fmt.Errorf("git %s: %w: %s", strings.Join(args, " "), err, strings.TrimSpace(stderr.String()))
	}
	return string(out), nil
}

func skip(res *StorageCleanResult, id, reason string) {
	res.Skipped = append(res.Skipped, StorageSkipped{ID: id, Reason: reason})
}

func fileExists(p string) bool {
	_, err := os.Stat(p)
	return err == nil || !errors.Is(err, fs.ErrNotExist)
}
```

- [ ] **Step 4: Write `pkg/storage/scanner.go`**

```go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package storage

import (
	"context"
	"fmt"
	"path/filepath"
	"sync"

	"github.com/wavetermdev/waveterm/pkg/panichandler"
)

// Scanner keeps the last scan in memory and runs scans in the background: walking node_modules or a cargo
// target takes seconds, longer than an RPC should hold.
type Scanner struct {
	env       *Env
	providers []provider
	publish   func(StorageReport)

	mu       sync.Mutex
	report   StorageReport
	scanning bool
	again    bool
	lastAuto *StorageAutoClean
}

// defaultProviders is every category in the order the Settings section shows them. Tasks 2–5 add theirs here.
func defaultProviders() []provider {
	return []provider{}
}

func NewScanner(env *Env, publish func(StorageReport)) *Scanner {
	return &Scanner{env: env, providers: defaultProviders(), publish: publish}
}

// Report is the last scan, whether one is running, and the last auto-clean.
func (s *Scanner) Report() StorageReport {
	s.mu.Lock()
	defer s.mu.Unlock()
	r := s.report
	r.Scanning = s.scanning
	r.LastAuto = s.lastAuto
	return r
}

// Rescan starts a scan in the background. One asked for while another runs follows it once, however many asks
// came in meanwhile.
func (s *Scanner) Rescan(ctx context.Context) {
	s.mu.Lock()
	if s.scanning {
		s.again = true
		s.mu.Unlock()
		return
	}
	s.scanning = true
	s.mu.Unlock()
	go func() {
		defer func() {
			panichandler.PanicHandler("storage.Rescan", recover())
		}()
		for {
			r := s.scan(ctx)
			s.mu.Lock()
			s.report = r
			again := s.again
			s.again = false
			s.scanning = again
			s.mu.Unlock()
			if s.publish != nil {
				s.publish(s.Report())
			}
			if !again {
				return
			}
		}
	}()
}

// ScanNow scans in the caller's goroutine and keeps the result.
func (s *Scanner) ScanNow(ctx context.Context) StorageReport {
	r := s.scan(ctx)
	s.mu.Lock()
	s.report = r
	s.mu.Unlock()
	return s.Report()
}

func (s *Scanner) scan(ctx context.Context) StorageReport {
	r := StorageReport{ScannedTs: s.env.Now().UnixMilli(), StoreBytes: dirSize(filepath.Join(s.env.DataDir, "db"))}
	for _, p := range s.providers {
		r.Categories = append(r.Categories, p.measure(ctx, s.env))
	}
	return r
}

// Clean cleans the named items of one category, each re-checked by its provider, then rescans.
func (s *Scanner) Clean(ctx context.Context, category StorageCategory, ids []string, opts CleanOpts) (StorageCleanResult, error) {
	for _, p := range s.providers {
		if p.category() != category {
			continue
		}
		res := p.clean(ctx, s.env, ids, opts)
		s.Rescan(context.Background())
		return res, nil
	}
	return StorageCleanResult{}, fmt.Errorf("no storage category %q", category)
}
```

- [ ] **Step 5: Run the tests and see them pass**

Run: `go test ./pkg/storage/ && go vet ./pkg/storage/ && gofmt -l pkg/storage`
Expected: `ok`, no vet output, no file listed by gofmt.

- [ ] **Step 6: Commit**

```bash
git add pkg/storage/storage.go pkg/storage/scanner.go pkg/storage/storage_test.go
git commit -m "feat(storage): the package's types and a background scanner"
```

---

### Task 2: Run worktrees provider (and two engine exports)

**Depends on:** Task 1

**Files:**
- Modify: `pkg/orchestrate/worktree.go` (add two exported functions after `removeWorktreeDir`)
- Test: `pkg/orchestrate/worktree_test.go` (append)
- Create: `pkg/storage/worktrees.go`
- Modify: `pkg/storage/scanner.go` (`defaultProviders`)
- Test: `pkg/storage/worktrees_test.go`

**Interfaces:**
- Consumes: Task 1's `Env`, `StorageItem`, `report`, `dirSize`, `SamePath`, `evalOrClean`, `gitOut`, `skip`, `CleanOpts`.
- Produces: `orchestrate.RemoveWorktreeKeepBranch(ctx context.Context, projectPath, wt string) error`; `orchestrate.RunOfWorktree(path string) (runID string, ok bool)`; `type runWorktrees struct{}` (a `provider`); `func worktreesRoot(project string) string`.

- [ ] **Step 1: Write the failing engine tests**

Append to `pkg/orchestrate/worktree_test.go` (it already has `newGitRepo` and `gitCmd`; add `errors` and `io/fs` to its imports if missing):

```go
func TestRemoveWorktreeKeepBranchKeepsTheBranch(t *testing.T) {
	dir := newGitRepo(t)
	base := gitCmd(t, dir, "rev-parse", "HEAD")
	wt, err := CreateRunWorktree(context.Background(), dir, "run-1", base)
	if err != nil {
		t.Fatal(err)
	}
	if err := RemoveWorktreeKeepBranch(context.Background(), dir, wt); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(wt); !errors.Is(err, fs.ErrNotExist) {
		t.Fatalf("the tree must be gone, stat says %v", err)
	}
	if out := gitCmd(t, dir, "branch", "--list", "wave/run-1"); out == "" {
		t.Fatal("the branch must stay: Storage never deletes a run's commits")
	}
}

func TestRunOfWorktreeNamesTheOwnerRun(t *testing.T) {
	id := "11111111-2222-3333-4444-555555555555"
	for _, key := range []string{id, id + "-t-2", id + "-final", id + "-bisect"} {
		got, ok := RunOfWorktree(filepath.Join("/p", ".waveterm", "worktrees", key))
		if !ok || got != id {
			t.Fatalf("RunOfWorktree(%s) = %q, %v; want %s", key, got, ok, id)
		}
	}
	if _, ok := RunOfWorktree(filepath.Join("/p", ".waveterm", "worktrees", "scratch")); ok {
		t.Fatal("a name the engine never makes has no run")
	}
}
```

- [ ] **Step 2: Run them to see them fail**

Run: `go test ./pkg/orchestrate/ -run 'TestRemoveWorktreeKeepBranch|TestRunOfWorktreeNamesTheOwnerRun'`
Expected: FAIL to build — `undefined: RemoveWorktreeKeepBranch`, `undefined: RunOfWorktree`.

- [ ] **Step 3: Add the exports to `pkg/orchestrate/worktree.go`** (after `removeWorktreeDir`)

```go
// RemoveWorktreeKeepBranch unregisters and deletes a linked worktree and keeps its branch: Settings → Storage
// cleans a finished run's leftover tree without touching the commits on wave/<runId>. RemoveRunWorktree, by
// contrast, deletes the branch too.
func RemoveWorktreeKeepBranch(ctx context.Context, projectPath, wt string) error {
	return removeWorktreeDir(ctx, projectPath, wt)
}

// RunOfWorktree is runOfWorktree for callers outside the engine: the run that owns a path in one of the engine's
// worktrees, ok false for a name the engine never makes.
func RunOfWorktree(path string) (runID string, ok bool) {
	id, _, ok := runOfWorktree(path)
	return id, ok
}
```

- [ ] **Step 4: Run the engine tests to see them pass**

Run: `go test ./pkg/orchestrate/ -run 'TestRemoveWorktreeKeepBranch|TestRunOfWorktreeNamesTheOwnerRun|TestRemoveRunWorktree'`
Expected: PASS.

- [ ] **Step 5: Write the failing provider tests**

`pkg/storage/worktrees_test.go`:

```go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package storage

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
)

const (
	runDone    = "11111111-1111-1111-1111-111111111111"
	runGoing   = "22222222-2222-2222-2222-222222222222"
	runOrphan  = "33333333-3333-3333-3333-333333333333"
	runDirtyID = "44444444-4444-4444-4444-444444444444"
)

func git(t *testing.T, dir string, args ...string) {
	t.Helper()
	if out, err := gitOut(context.Background(), dir, args...); err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
}

func newRepo(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	git(t, dir, "init", "-q")
	git(t, dir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init")
	return dir
}

// addTree links an engine-shaped worktree <repo>/.waveterm/worktrees/<key> on branch wave/<key>
func addTree(t *testing.T, repo, key string) string {
	t.Helper()
	wt := filepath.Join(worktreesRoot(repo), key)
	git(t, repo, "worktree", "add", "-q", "-b", "wave/"+key, wt)
	writeFile(t, filepath.Join(wt, "out.bin"), 100)
	git(t, wt, "add", "out.bin")
	git(t, wt, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "work")
	return wt
}

func worktreeEnv(repo string, runs map[string]RunState) *Env {
	return &Env{
		Now:          time.Now,
		ProjectPaths: func() []string { return []string{repo} },
		RunOfWorktree: func(p string) (string, bool) {
			name := filepath.Base(p)
			if len(name) < 36 {
				return "", false
			}
			return name[:36], true
		},
		RunState: func(_ context.Context, id string) (RunState, error) { return runs[id], nil },
		RemoveWorktree: func(ctx context.Context, project, wt string) error {
			_, _ = gitOut(ctx, project, "worktree", "remove", "--force", wt)
			return os.RemoveAll(wt)
		},
	}
}

func TestRunWorktreesJudgeEachTree(t *testing.T) {
	repo := newRepo(t)
	done := addTree(t, repo, runDone)
	going := addTree(t, repo, runGoing)
	orphan := addTree(t, repo, runOrphan)
	dirty := addTree(t, repo, runDirtyID)
	writeFile(t, filepath.Join(dirty, "uncommitted.txt"), 10)
	env := worktreeEnv(repo, map[string]RunState{
		runDone:    {Found: true, Finished: true, Status: "done"},
		runGoing:   {Found: true, Status: "executing"},
		runDirtyID: {Found: true, Finished: true, Status: "cancelled"},
	})
	rep := runWorktrees{}.measure(context.Background(), env)
	if it := itemByID(rep.Items, done); !it.Cleanable || it.Guarded || it.Bytes < 100 {
		t.Fatalf("a finished, committed tree must be cleanable: %+v", it)
	}
	if it := itemByID(rep.Items, going); it.Cleanable || it.Reason != "run still going" {
		t.Fatalf("a running run's tree must stay: %+v", it)
	}
	if it := itemByID(rep.Items, orphan); !it.Cleanable {
		t.Fatalf("a tree no run claims counts as finished: %+v", it)
	}
	if it := itemByID(rep.Items, dirty); it.Cleanable || !it.Guarded || it.Reason != "has uncommitted changes" {
		t.Fatalf("a finished tree with changes must be guarded: %+v", it)
	}
}

func TestCleanRemovesFinishedTreesAndKeepsTheirBranches(t *testing.T) {
	repo := newRepo(t)
	done := addTree(t, repo, runDone)
	env := worktreeEnv(repo, map[string]RunState{runDone: {Found: true, Finished: true, Status: "done"}})
	res := runWorktrees{}.clean(context.Background(), env, []string{done}, CleanOpts{})
	if len(res.Cleaned) != 1 || res.Reclaimed < 100 {
		t.Fatalf("got %+v, want the tree removed and its bytes counted", res)
	}
	if _, err := os.Stat(done); err == nil {
		t.Fatal("the tree must be gone")
	}
	if out, _ := gitOut(context.Background(), repo, "branch", "--list", "wave/"+runDone); out == "" {
		t.Fatal("the branch must stay")
	}
}

func TestCleanReChecksTheRunAtRemoval(t *testing.T) {
	repo := newRepo(t)
	wt := addTree(t, repo, runDone)
	// the scan saw it done; by the click the run is going again
	env := worktreeEnv(repo, map[string]RunState{runDone: {Found: true, Status: "executing"}})
	res := runWorktrees{}.clean(context.Background(), env, []string{wt}, CleanOpts{})
	if len(res.Cleaned) != 0 || len(res.Skipped) != 1 || res.Skipped[0].Reason != "run still going" {
		t.Fatalf("got %+v, want it skipped because its run is going", res)
	}
}

func TestGuardedTreeNeedsItsOwnButton(t *testing.T) {
	repo := newRepo(t)
	wt := addTree(t, repo, runDirtyID)
	writeFile(t, filepath.Join(wt, "uncommitted.txt"), 10)
	env := worktreeEnv(repo, map[string]RunState{runDirtyID: {Found: true, Finished: true, Status: "done"}})
	if res := (runWorktrees{}).clean(context.Background(), env, []string{wt}, CleanOpts{}); len(res.Cleaned) != 0 {
		t.Fatal("Clean all must leave a tree with uncommitted changes")
	}
	if res := (runWorktrees{}).clean(context.Background(), env, []string{wt}, CleanOpts{AllowGuarded: true, Auto: true}); len(res.Cleaned) != 0 {
		t.Fatal("auto-clean must never remove a tree with uncommitted changes")
	}
	if res := (runWorktrees{}).clean(context.Background(), env, []string{wt}, CleanOpts{AllowGuarded: true}); len(res.Cleaned) != 1 {
		t.Fatalf("its own button removes it: %+v", res)
	}
}

func TestWorktreeThatIsNotAnEngineTreeIsNeverCleaned(t *testing.T) {
	repo := newRepo(t)
	scratch := filepath.Join(worktreesRoot(repo), "scratch")
	writeFile(t, filepath.Join(scratch, "notes.txt"), 7)
	env := worktreeEnv(repo, nil)
	rep := runWorktrees{}.measure(context.Background(), env)
	if it := itemByID(rep.Items, scratch); it.Cleanable || it.Reason != "not a run worktree" {
		t.Fatalf("a directory the engine did not make must stay: %+v", it)
	}
	for _, opts := range []CleanOpts{{}, {AllowGuarded: true}, {Auto: true}} {
		if res := (runWorktrees{}).clean(context.Background(), env, []string{scratch}, opts); len(res.Cleaned) != 0 {
			t.Fatalf("cleaned a non-engine directory with %+v", opts)
		}
	}
	if _, err := os.Stat(scratch); err != nil {
		t.Fatal("it must still be there")
	}
}

func TestCleanRefusesAPathOutsideTheProjectsWorktrees(t *testing.T) {
	repo := newRepo(t)
	env := worktreeEnv(repo, nil)
	res := runWorktrees{}.clean(context.Background(), env, []string{filepath.Join(repo, "src")}, CleanOpts{AllowGuarded: true})
	if len(res.Skipped) != 1 || len(res.Cleaned) != 0 {
		t.Fatalf("got %+v, want the path refused", res)
	}
}
```

- [ ] **Step 6: Run them to see them fail**

Run: `go test ./pkg/storage/ -run 'Worktree|Tree'`
Expected: FAIL to build — `undefined: runWorktrees`, `undefined: worktreesRoot`.

- [ ] **Step 7: Write `pkg/storage/worktrees.go`**

```go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package storage

import (
	"context"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

// runWorktrees lists the engine's trees under each project's .waveterm/worktrees and cleans those of finished
// runs. A finished tree with uncommitted changes is guarded: only its own button removes it. Branches stay; a
// task's cleanup debt clears itself, since the engine's retry (RetryCleanupDebt) succeeds on a tree that is gone.
type runWorktrees struct{}

func (runWorktrees) category() StorageCategory { return CategoryRunWorktrees }

func worktreesRoot(project string) string {
	return filepath.Join(project, ".waveterm", "worktrees")
}

func (w runWorktrees) measure(ctx context.Context, env *Env) StorageCategoryReport {
	var items []StorageItem
	var errs []error
	for _, project := range env.ProjectPaths() {
		entries, err := os.ReadDir(worktreesRoot(project))
		if err != nil {
			if !errors.Is(err, fs.ErrNotExist) {
				errs = append(errs, err)
			}
			continue
		}
		for _, e := range entries {
			if !e.IsDir() {
				continue
			}
			wt := filepath.Join(worktreesRoot(project), e.Name())
			it := StorageItem{ID: wt, Kind: KindWorktree, Label: e.Name(), Detail: filepath.Base(project), Path: wt, Bytes: dirSize(wt)}
			w.judge(ctx, env, wt, &it)
			items = append(items, it)
		}
	}
	return report(CategoryRunWorktrees, items, errors.Join(errs...))
}

// judge decides whether a tree may go: one the engine did not make, or whose run still goes, stays; one with
// uncommitted changes is guarded.
func (runWorktrees) judge(ctx context.Context, env *Env, wt string, it *StorageItem) {
	runID, ok := env.RunOfWorktree(wt)
	if !ok {
		it.Reason = "not a run worktree"
		return
	}
	st, err := env.RunState(ctx, runID)
	switch {
	case err != nil:
		it.Reason = "couldn't read its run: " + err.Error()
		return
	case !st.Found:
		it.Detail += " · no run"
	case !st.Finished:
		it.Detail += " · " + st.Status
		it.Reason = "run still going"
		return
	default:
		it.Detail += " · " + st.Status
	}
	dirty, err := hasChanges(ctx, wt)
	switch {
	case err != nil:
		it.Guarded = true
		it.Reason = "couldn't read its git status"
	case dirty:
		it.Guarded = true
		it.Reason = "has uncommitted changes"
	default:
		it.Cleanable = true
	}
}

// hasChanges reports uncommitted changes in a worktree. A directory that is not a worktree root of its own (git
// unregistered it and then failed to delete it) holds no tracked work; asking git there would answer for the
// project's main tree.
func hasChanges(ctx context.Context, wt string) (bool, error) {
	top, err := gitOut(ctx, wt, "rev-parse", "--show-toplevel")
	if err != nil || !SamePath(evalOrClean(strings.TrimSpace(top)), evalOrClean(wt)) {
		return false, nil
	}
	out, err := gitOut(ctx, wt, "status", "--porcelain")
	if err != nil {
		return false, err
	}
	return strings.TrimSpace(out) != "", nil
}

// ownerProject is the project whose .waveterm/worktrees holds wt directly, "" when none does.
func ownerProject(projects []string, wt string) string {
	for _, p := range projects {
		if SamePath(filepath.Dir(filepath.Clean(wt)), worktreesRoot(p)) {
			return p
		}
	}
	return ""
}

func (w runWorktrees) clean(ctx context.Context, env *Env, ids []string, opts CleanOpts) StorageCleanResult {
	var res StorageCleanResult
	for _, id := range ids {
		project := ownerProject(env.ProjectPaths(), id)
		if project == "" {
			skip(&res, id, "not in a project's .waveterm/worktrees")
			continue
		}
		if _, err := os.Lstat(id); err != nil {
			skip(&res, id, "no longer exists")
			continue
		}
		var it StorageItem
		w.judge(ctx, env, id, &it)
		allowed := it.Cleanable || (it.Guarded && opts.AllowGuarded && !opts.Auto)
		if !allowed {
			skip(&res, id, it.Reason)
			continue
		}
		size := dirSize(id)
		if err := env.RemoveWorktree(ctx, project, id); err != nil {
			skip(&res, id, "couldn't remove: "+err.Error())
			continue
		}
		res.Reclaimed += size
		res.Cleaned = append(res.Cleaned, id)
	}
	return res
}
```

Then register it in `pkg/storage/scanner.go`:

```go
func defaultProviders() []provider {
	return []provider{runWorktrees{}}
}
```

(When another of Tasks 3–5 has already merged, keep the order worktrees, sessions, housekeeping, build output.)

- [ ] **Step 8: Run all storage tests**

Run: `go test ./pkg/storage/ && gofmt -l pkg/storage pkg/orchestrate/worktree.go`
Expected: `ok`, no file listed.

- [ ] **Step 9: Commit**

```bash
git add pkg/orchestrate/worktree.go pkg/orchestrate/worktree_test.go pkg/storage/worktrees.go pkg/storage/worktrees_test.go pkg/storage/scanner.go
git commit -m "feat(storage): finished runs' worktrees, removed with their branches kept"
```

---

### Task 3: Old Claude sessions provider

**Depends on:** Task 1

**Files:**
- Create: `pkg/storage/sessions.go`
- Modify: `pkg/storage/scanner.go` (`defaultProviders`)
- Test: `pkg/storage/sessions_test.go`

**Interfaces:**
- Consumes: Task 1's `Env` (`Now`, `LiveTranscripts`, `SessionDirs`, `TrashDir`), `report`, `dirSize`, `SamePath`, `skip`; `sessiontrash.Delete`, `sessiontrash.Options`.
- Produces: `type oldSessions struct{}` (a `provider`); consts `minSessionAge = 7 * 24 * time.Hour`, `defaultSessionDays = 30`.

- [ ] **Step 1: Write the failing tests**

`pkg/storage/sessions_test.go`:

```go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package storage

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
)

const day = 24 * time.Hour

// session writes <root>/<project>/<id>.jsonl last changed age ago, with a sibling <id>/ directory
func session(t *testing.T, root, id string, size int, age time.Duration) string {
	t.Helper()
	path := filepath.Join(root, "-p-proj", id+".jsonl")
	writeFile(t, path, size)
	writeFile(t, filepath.Join(root, "-p-proj", id, "subagents", "a.jsonl"), 50)
	when := time.Now().Add(-age)
	if err := os.Chtimes(path, when, when); err != nil {
		t.Fatal(err)
	}
	return path
}

func sessionEnv(t *testing.T, root string, live ...string) *Env {
	return &Env{
		Now:             time.Now,
		SessionDirs:     []string{root},
		TrashDir:        filepath.Join(t.TempDir(), "trash"),
		LiveTranscripts: func(context.Context) ([]string, error) { return live, nil },
	}
}

func TestSessionsListsOnlyWeekOldTranscriptsWithTheirDirectory(t *testing.T) {
	root := t.TempDir()
	old := session(t, root, "old-session", 200, 40*day)
	session(t, root, "new-session", 200, 2*day)
	rep := oldSessions{}.measure(context.Background(), sessionEnv(t, root))
	if len(rep.Items) != 1 || rep.Items[0].ID != old {
		t.Fatalf("got %+v, want only the 40-day-old session", rep.Items)
	}
	if it := rep.Items[0]; it.Bytes != 250 || !it.Cleanable || it.ModTs == 0 {
		t.Fatalf("got %+v, want 200 + 50 bytes, cleanable, its time", it)
	}
}

func TestSessionOpenInATabIsNotCleanable(t *testing.T) {
	root := t.TempDir()
	old := session(t, root, "open-session", 10, 40*day)
	rep := oldSessions{}.measure(context.Background(), sessionEnv(t, root, old))
	if it := rep.Items[0]; it.Cleanable || it.Reason != "open in a tab" {
		t.Fatalf("got %+v, want it kept as open", it)
	}
}

func TestCleanMovesSessionsToTheTrash(t *testing.T) {
	root := t.TempDir()
	old := session(t, root, "old-session", 200, 40*day)
	env := sessionEnv(t, root)
	res := oldSessions{}.clean(context.Background(), env, []string{old}, CleanOpts{OlderThanDays: 30})
	if len(res.Cleaned) != 1 || res.Trashed != 250 || res.Reclaimed != 0 {
		t.Fatalf("got %+v, want 250 bytes moved to the trash", res)
	}
	if _, err := os.Stat(old); err == nil {
		t.Fatal("the transcript must have left the projects folder")
	}
	if entries, _ := os.ReadDir(env.TrashDir); len(entries) != 1 {
		t.Fatalf("want one trash entry, have %d", len(entries))
	}
}

func TestCleanSkipsASessionNewerThanTheChosenAge(t *testing.T) {
	root := t.TempDir()
	tenDays := session(t, root, "ten-days", 10, 10*day)
	res := oldSessions{}.clean(context.Background(), sessionEnv(t, root), []string{tenDays}, CleanOpts{OlderThanDays: 30})
	if len(res.Cleaned) != 0 || len(res.Skipped) != 1 || res.Skipped[0].Reason != "changed in the last 30 days" {
		t.Fatalf("got %+v, want it skipped as too new", res)
	}
}

func TestCleanSkipsALiveSessionAndNeverRunsAutomatically(t *testing.T) {
	root := t.TempDir()
	old := session(t, root, "open-session", 10, 40*day)
	if res := (oldSessions{}).clean(context.Background(), sessionEnv(t, root, old), []string{old}, CleanOpts{OlderThanDays: 7}); len(res.Cleaned) != 0 {
		t.Fatalf("cleaned a session a tab has open: %+v", res)
	}
	if res := (oldSessions{}).clean(context.Background(), sessionEnv(t, root), []string{old}, CleanOpts{Auto: true}); len(res.Cleaned) != 0 {
		t.Fatalf("auto-clean must never touch sessions: %+v", res)
	}
}
```

- [ ] **Step 2: Run them to see them fail**

Run: `go test ./pkg/storage/ -run Session`
Expected: FAIL to build — `undefined: oldSessions`.

- [ ] **Step 3: Write `pkg/storage/sessions.go`**

```go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package storage

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/sessiontrash"
)

const (
	// minSessionAge is the youngest a listed session can be: the card's shortest choice
	minSessionAge = 7 * 24 * time.Hour
	// defaultSessionDays is the card's default age, used when a clean names none
	defaultSessionDays = 30
)

// oldSessions lists Claude transcripts untouched for at least a week and moves the chosen ones to the session
// trash through pkg/sessiontrash, whose rules hold: never a session a tab has open or wrote to in the last two
// minutes. pi and other runtimes keep their sessions.
type oldSessions struct{}

func (oldSessions) category() StorageCategory { return CategorySessions }

func (oldSessions) measure(ctx context.Context, env *Env) StorageCategoryReport {
	live, err := env.LiveTranscripts(ctx)
	if err != nil {
		return report(CategorySessions, nil, fmt.Errorf("listing the open sessions: %w", err))
	}
	now := env.Now()
	var items []StorageItem
	var errs []error
	for _, root := range env.SessionDirs {
		projects, err := os.ReadDir(root)
		if err != nil {
			if !errors.Is(err, fs.ErrNotExist) {
				errs = append(errs, err)
			}
			continue
		}
		for _, p := range projects {
			if !p.IsDir() {
				continue
			}
			dir := filepath.Join(root, p.Name())
			files, err := os.ReadDir(dir)
			if err != nil {
				errs = append(errs, err)
				continue
			}
			for _, f := range files {
				if !f.Type().IsRegular() || !strings.HasSuffix(f.Name(), ".jsonl") {
					continue
				}
				info, err := f.Info()
				if err != nil || now.Sub(info.ModTime()) < minSessionAge {
					continue
				}
				path := filepath.Join(dir, f.Name())
				id := strings.TrimSuffix(f.Name(), ".jsonl")
				it := StorageItem{
					ID: path, Kind: KindSession, Label: shortID(id), Detail: p.Name(), Path: path,
					Bytes: info.Size() + dirSize(filepath.Join(dir, id)), ModTs: info.ModTime().UnixMilli(), Cleanable: true,
				}
				if isLive(live, path) {
					it.Cleanable = false
					it.Reason = "open in a tab"
				}
				items = append(items, it)
			}
		}
	}
	return report(CategorySessions, items, errors.Join(errs...))
}

func (oldSessions) clean(ctx context.Context, env *Env, ids []string, opts CleanOpts) StorageCleanResult {
	var res StorageCleanResult
	if opts.Auto {
		for _, id := range ids {
			skip(&res, id, "sessions are cleaned only when you ask")
		}
		return res
	}
	days := opts.OlderThanDays
	if days == 0 {
		days = defaultSessionDays
	}
	days = max(days, int(minSessionAge/(24*time.Hour)))
	live, err := env.LiveTranscripts(ctx)
	if err != nil {
		for _, id := range ids {
			skip(&res, id, "couldn't list the open sessions: "+err.Error())
		}
		return res
	}
	now := env.Now()
	for _, id := range ids {
		info, err := os.Stat(id)
		if err != nil {
			skip(&res, id, "no longer exists")
			continue
		}
		if now.Sub(info.ModTime()) < time.Duration(days)*24*time.Hour {
			skip(&res, id, fmt.Sprintf("changed in the last %d days", days))
			continue
		}
		size := info.Size() + dirSize(strings.TrimSuffix(id, ".jsonl"))
		trashOpts := sessiontrash.Options{ProjectsDirs: env.SessionDirs, TrashDir: env.TrashDir, LiveTranscripts: live, Now: now}
		if _, err := sessiontrash.Delete(trashOpts, id); err != nil {
			skip(&res, id, err.Error())
			continue
		}
		res.Trashed += size
		res.Cleaned = append(res.Cleaned, id)
	}
	return res
}

func shortID(id string) string {
	if len(id) > 8 {
		return id[:8]
	}
	return id
}

func isLive(live []string, path string) bool {
	for _, l := range live {
		if SamePath(l, path) {
			return true
		}
	}
	return false
}
```

Register it in `defaultProviders` in `pkg/storage/scanner.go`, keeping the order worktrees, sessions, housekeeping, build output with whatever has merged, e.g. `return []provider{runWorktrees{}, oldSessions{}}`, or `return []provider{oldSessions{}}` when Task 2 has not merged yet.

- [ ] **Step 4: Run all storage tests**

Run: `go test ./pkg/storage/ && gofmt -l pkg/storage`
Expected: `ok`, no file listed.

- [ ] **Step 5: Commit**

```bash
git add pkg/storage/sessions.go pkg/storage/sessions_test.go pkg/storage/scanner.go
git commit -m "feat(storage): old Claude sessions, moved to the session trash"
```

---

### Task 4: Logs, the session trash and the webview cache marker

**Depends on:** Task 1

**Files:**
- Create: `pkg/storage/housekeeping.go`
- Modify: `pkg/storage/scanner.go` (`defaultProviders`)
- Test: `pkg/storage/housekeeping_test.go`

**Interfaces:**
- Consumes: Task 1's `Env` (`Now`, `DataDir`, `TrashDir`, `WebviewCacheDirs`), `report`, `dirSize`, `SamePath`, `skip`, `fileExists`.
- Produces: `type housekeeping struct{}` (a `provider`); `const CacheMarkerName = "clear-webview-cache"`; `const LogMaxAge = 7 * 24 * time.Hour`; `func WebviewCacheDirs(goos, home, dataDir string) []string`; item ids `"trash"` and `"webviewcache"`.

- [ ] **Step 1: Write the failing tests**

`pkg/storage/housekeeping_test.go`:

```go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package storage

import (
	"context"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"
)

func houseEnv(t *testing.T) *Env {
	base := t.TempDir()
	return &Env{
		Now:              time.Now,
		DataDir:          filepath.Join(base, "data"),
		TrashDir:         filepath.Join(base, "trash"),
		WebviewCacheDirs: []string{filepath.Join(base, "cache", "NetworkCache"), filepath.Join(base, "cache", "CacheStorage")},
	}
}

func aged(t *testing.T, path string, age time.Duration) {
	t.Helper()
	when := time.Now().Add(-age)
	if err := os.Chtimes(path, when, when); err != nil {
		t.Fatal(err)
	}
}

func TestHousekeepingListsRolledLogsTrashAndCache(t *testing.T) {
	env := houseEnv(t)
	writeFile(t, filepath.Join(env.DataDir, "waveapp.log"), 30)
	writeFile(t, filepath.Join(env.DataDir, "waveapp.1.log"), 40)
	writeFile(t, filepath.Join(env.TrashDir, "1700000000000-abc", "abc.jsonl"), 60)
	writeFile(t, filepath.Join(env.WebviewCacheDirs[0], "blob"), 5)
	rep := housekeeping{}.measure(context.Background(), env)
	if it := itemByID(rep.Items, filepath.Join(env.DataDir, "waveapp.1.log")); it.Kind != KindLog || it.Bytes != 40 || !it.Cleanable {
		t.Fatalf("rolled log: %+v", it)
	}
	if it := itemByID(rep.Items, filepath.Join(env.DataDir, "waveapp.log")); it.ID != "" {
		t.Fatal("the live log must never be listed")
	}
	if it := itemByID(rep.Items, "trash"); it.Bytes != 60 || !it.Cleanable {
		t.Fatalf("trash: %+v", it)
	}
	if it := itemByID(rep.Items, "webviewcache"); it.Bytes != 5 || !it.Cleanable {
		t.Fatalf("cache: %+v", it)
	}
}

func TestCleaningTheCacheOnlyLeavesTheMarker(t *testing.T) {
	env := houseEnv(t)
	blob := filepath.Join(env.WebviewCacheDirs[0], "blob")
	writeFile(t, blob, 5)
	res := housekeeping{}.clean(context.Background(), env, []string{"webviewcache"}, CleanOpts{})
	if !res.Deferred || res.Reclaimed != 0 || len(res.Cleaned) != 1 {
		t.Fatalf("got %+v, want it deferred to the next launch", res)
	}
	if !fileExists(filepath.Join(env.DataDir, CacheMarkerName)) {
		t.Fatal("the marker must be written")
	}
	if !fileExists(blob) {
		t.Fatal("the cache must not be touched while the app runs")
	}
	if it := itemByID(housekeeping{}.measure(context.Background(), env).Items, "webviewcache"); it.Cleanable || it.Reason != "clears when arcterm next opens" {
		t.Fatalf("a scheduled cache: %+v", it)
	}
}

func TestEmptyingTheTrashKeepsTheTrashDir(t *testing.T) {
	env := houseEnv(t)
	writeFile(t, filepath.Join(env.TrashDir, "1700000000000-abc", "abc.jsonl"), 60)
	res := housekeeping{}.clean(context.Background(), env, []string{"trash"}, CleanOpts{})
	if res.Reclaimed != 60 || len(res.Cleaned) != 1 {
		t.Fatalf("got %+v, want 60 bytes freed", res)
	}
	entries, err := os.ReadDir(env.TrashDir)
	if err != nil || len(entries) != 0 {
		t.Fatalf("the trash dir must stay, empty: %v %v", entries, err)
	}
}

func TestAutoCleanTakesOnlyOldRolledLogs(t *testing.T) {
	env := houseEnv(t)
	oldLog := filepath.Join(env.DataDir, "waveapp.1.log")
	newLog := filepath.Join(env.DataDir, "waveapp.2.log")
	writeFile(t, oldLog, 40)
	writeFile(t, newLog, 40)
	aged(t, oldLog, 8*24*time.Hour)
	writeFile(t, filepath.Join(env.TrashDir, "1700000000000-abc", "abc.jsonl"), 60)
	res := housekeeping{}.clean(context.Background(), env, []string{oldLog, newLog, "trash", "webviewcache"}, CleanOpts{Auto: true})
	if !reflect.DeepEqual(res.Cleaned, []string{oldLog}) {
		t.Fatalf("auto-clean cleaned %v, want only the old rolled log", res.Cleaned)
	}
	if fileExists(filepath.Join(env.DataDir, CacheMarkerName)) {
		t.Fatal("auto-clean must never schedule the cache")
	}
}

func TestCleanRefusesAnythingButARolledLog(t *testing.T) {
	env := houseEnv(t)
	live := filepath.Join(env.DataDir, "waveapp.log")
	writeFile(t, live, 30)
	other := filepath.Join(t.TempDir(), "waveapp.1.log")
	writeFile(t, other, 30)
	res := housekeeping{}.clean(context.Background(), env, []string{live, other, filepath.Join(env.DataDir, "..", "data", "db")}, CleanOpts{})
	if len(res.Cleaned) != 0 || len(res.Skipped) != 3 {
		t.Fatalf("got %+v, want all three refused", res)
	}
	if !fileExists(live) || !fileExists(other) {
		t.Fatal("nothing may be removed")
	}
}

func TestWebviewCacheDirs(t *testing.T) {
	home := filepath.Join("/", "Users", "me")
	mac := filepath.Join(home, "Library", "Application Support", "dev.arc.app-dev", "data")
	wk := filepath.Join(home, "Library", "Caches", "dev.arc.app", "WebKit")
	if got := WebviewCacheDirs("darwin", home, mac); !reflect.DeepEqual(got, []string{filepath.Join(wk, "NetworkCache"), filepath.Join(wk, "CacheStorage")}) {
		t.Fatalf("darwin: %v (a dev base's -dev suffix is not part of the identifier)", got)
	}
	win := filepath.Join("C:", "u", "AppData", "Local", "dev.arc.app", "data")
	d := filepath.Join("C:", "u", "AppData", "Local", "dev.arc.app", "EBWebView", "Default")
	if got := WebviewCacheDirs("windows", home, win); !reflect.DeepEqual(got, []string{filepath.Join(d, "Cache"), filepath.Join(d, "Code Cache"), filepath.Join(d, "GPUCache")}) {
		t.Fatalf("windows: %v (EBWebView sits beside data)", got)
	}
	if got := WebviewCacheDirs("linux", home, win); got != nil {
		t.Fatalf("linux: %v, want none", got)
	}
}
```

- [ ] **Step 2: Run them to see them fail**

Run: `go test ./pkg/storage/ -run 'Housekeeping|Cache|Trash|RolledLog|WebviewCacheDirs'`
Expected: FAIL to build — `undefined: housekeeping`, `CacheMarkerName`, `WebviewCacheDirs`.

- [ ] **Step 3: Write `pkg/storage/housekeeping.go`**

```go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package storage

import (
	"context"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	// CacheMarkerName is the file in the data dir that asks the host (src-tauri/src/webcache.rs) to clear the
	// webview's cache at the next launch, before the window exists; the cache is in use while arcterm runs.
	CacheMarkerName = "clear-webview-cache"
	// LogMaxAge is how old a rolled log must be before auto-clean removes it
	LogMaxAge = 7 * 24 * time.Hour

	trashItemID = "trash"
	cacheItemID = "webviewcache"
)

// housekeeping is the small stuff: logs the host rolled aside, the session trash (removed for good), and the
// webview's cache (cleared at the next launch).
type housekeeping struct{}

func (housekeeping) category() StorageCategory { return CategoryHousekeeping }

// isRolledLog is a log the host rolled aside (waveapp.1.log); the live waveapp.log never is.
func isRolledLog(name string) bool {
	return name != "waveapp.log" && strings.HasPrefix(name, "waveapp.") && strings.HasSuffix(name, ".log")
}

// WebviewCacheDirs is where the webview keeps its cache: WebKit files it under the bundle identifier on macOS, and
// WebView2 under <app base>/EBWebView on Windows, where <app base> holds the data dir. A dev base's "-dev"
// suffix is not part of the identifier. Other platforms have none.
func WebviewCacheDirs(goos, home, dataDir string) []string {
	base := filepath.Dir(filepath.Clean(dataDir))
	switch goos {
	case "darwin":
		id := strings.TrimSuffix(filepath.Base(base), "-dev")
		wk := filepath.Join(home, "Library", "Caches", id, "WebKit")
		return []string{filepath.Join(wk, "NetworkCache"), filepath.Join(wk, "CacheStorage")}
	case "windows":
		d := filepath.Join(base, "EBWebView", "Default")
		return []string{filepath.Join(d, "Cache"), filepath.Join(d, "Code Cache"), filepath.Join(d, "GPUCache")}
	}
	return nil
}

func (housekeeping) measure(ctx context.Context, env *Env) StorageCategoryReport {
	var items []StorageItem
	var errs []error
	entries, err := os.ReadDir(env.DataDir)
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		errs = append(errs, err)
	}
	for _, e := range entries {
		if !e.Type().IsRegular() || !isRolledLog(e.Name()) {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		path := filepath.Join(env.DataDir, e.Name())
		items = append(items, StorageItem{ID: path, Kind: KindLog, Label: e.Name(), Detail: "rolled log", Path: path,
			Bytes: info.Size(), ModTs: info.ModTime().UnixMilli(), Cleanable: true})
	}
	trash := dirSize(env.TrashDir)
	items = append(items, StorageItem{ID: trashItemID, Kind: KindTrash, Label: "Session trash", Detail: "removed for good",
		Path: env.TrashDir, Bytes: trash, Cleanable: trash > 0})
	var cache int64
	for _, d := range env.WebviewCacheDirs {
		cache += dirSize(d)
	}
	cacheItem := StorageItem{ID: cacheItemID, Kind: KindWebviewCache, Label: "Interface cache",
		Detail: "cleared when arcterm next opens", Bytes: cache, Cleanable: cache > 0}
	if fileExists(filepath.Join(env.DataDir, CacheMarkerName)) {
		cacheItem.Cleanable = false
		cacheItem.Reason = "clears when arcterm next opens"
	}
	items = append(items, cacheItem)
	return report(CategoryHousekeeping, items, errors.Join(errs...))
}

func (housekeeping) clean(ctx context.Context, env *Env, ids []string, opts CleanOpts) StorageCleanResult {
	var res StorageCleanResult
	for _, id := range ids {
		switch id {
		case trashItemID:
			if opts.Auto {
				skip(&res, id, "the trash purges itself after 7 days")
				continue
			}
			freed, err := emptyDir(env.TrashDir)
			res.Reclaimed += freed
			if err != nil {
				skip(&res, id, "couldn't remove: "+err.Error())
				continue
			}
			res.Cleaned = append(res.Cleaned, id)
		case cacheItemID:
			if opts.Auto {
				skip(&res, id, "the cache is cleaned only when you ask")
				continue
			}
			if err := os.MkdirAll(env.DataDir, 0o700); err != nil {
				skip(&res, id, "couldn't schedule it: "+err.Error())
				continue
			}
			marker := filepath.Join(env.DataDir, CacheMarkerName)
			if err := os.WriteFile(marker, []byte(env.Now().UTC().Format(time.RFC3339)), 0o600); err != nil {
				skip(&res, id, "couldn't schedule it: "+err.Error())
				continue
			}
			res.Deferred = true
			res.Cleaned = append(res.Cleaned, id)
		default:
			if !SamePath(filepath.Dir(id), env.DataDir) || !isRolledLog(filepath.Base(id)) {
				skip(&res, id, "not a rolled log")
				continue
			}
			info, err := os.Lstat(id)
			if err != nil || !info.Mode().IsRegular() {
				skip(&res, id, "no longer exists")
				continue
			}
			if opts.Auto && env.Now().Sub(info.ModTime()) < LogMaxAge {
				skip(&res, id, "newer than 7 days")
				continue
			}
			if err := os.Remove(id); err != nil {
				skip(&res, id, "couldn't remove: "+err.Error())
				continue
			}
			res.Reclaimed += info.Size()
			res.Cleaned = append(res.Cleaned, id)
		}
	}
	return res
}

// emptyDir removes everything inside dir, keeping dir, and returns the bytes it freed.
func emptyDir(dir string) (int64, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return 0, nil
		}
		return 0, err
	}
	var freed int64
	var errs []error
	for _, e := range entries {
		p := filepath.Join(dir, e.Name())
		size := dirSize(p)
		if err := os.RemoveAll(p); err != nil {
			errs = append(errs, err)
			continue
		}
		freed += size
	}
	return freed, errors.Join(errs...)
}
```

Register it in `defaultProviders` in `pkg/storage/scanner.go` in its place (worktrees, sessions, housekeeping, build output) among the providers that have merged.

- [ ] **Step 4: Run all storage tests**

Run: `go test ./pkg/storage/ && gofmt -l pkg/storage`
Expected: `ok`, no file listed.

- [ ] **Step 5: Commit**

```bash
git add pkg/storage/housekeeping.go pkg/storage/housekeeping_test.go pkg/storage/scanner.go
git commit -m "feat(storage): rolled logs, the session trash and the webview cache marker"
```

---

### Task 5: Build output provider

**Depends on:** Task 1

**Files:**
- Create: `pkg/storage/buildoutput.go`
- Modify: `pkg/storage/scanner.go` (`defaultProviders`)
- Test: `pkg/storage/buildoutput_test.go`

**Interfaces:**
- Consumes: Task 1's `Env` (`ProjectPaths`, `BusyProjects`), `report`, `dirSize`, `SamePath`, `gitOut`, `skip`, `fileExists`.
- Produces: `type buildOutput struct{}` (a `provider`); `func buildCandidates(project string) []string`; `func gitIgnored(ctx, project string, paths []string) map[string]bool`; `func busyReason(busy map[string]string, project string) string`.

- [ ] **Step 1: Write the failing tests**

`pkg/storage/buildoutput_test.go` (it builds without Task 2's test helpers: Tasks 2–5 can merge in any order):

```go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package storage

import (
	"context"
	"os"
	"path/filepath"
	"sort"
	"testing"
	"time"
)

func buildRepo(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	run := func(args ...string) {
		if out, err := gitOut(context.Background(), dir, args...); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}
	run("init", "-q")
	writeFile(t, filepath.Join(dir, ".gitignore"), 0)
	if err := os.WriteFile(filepath.Join(dir, ".gitignore"), []byte("node_modules/\ntarget/\nbuild/\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	writeFile(t, filepath.Join(dir, "dist", "keep.txt"), 3) // tracked: never build output
	run("add", ".gitignore", "dist/keep.txt")
	run("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "init")

	writeFile(t, filepath.Join(dir, "frontend", "node_modules", "x.js"), 10)
	writeFile(t, filepath.Join(dir, "frontend", "node_modules", "pkg", "node_modules", "y.js"), 5)
	writeFile(t, filepath.Join(dir, "src-tauri", "Cargo.toml"), 1)
	writeFile(t, filepath.Join(dir, "src-tauri", "target", "a.bin"), 20)
	writeFile(t, filepath.Join(dir, "loose", "target", "b.bin"), 20)         // no Cargo.toml beside it
	writeFile(t, filepath.Join(dir, "a", "b", "c", "node_modules", "z"), 9) // four levels down
	writeFile(t, filepath.Join(dir, ".waveterm", "worktrees", "k", "node_modules", "w"), 9)
	return dir
}

func buildEnv(project string, busy map[string]string) *Env {
	return &Env{
		Now:          time.Now,
		ProjectPaths: func() []string { return []string{project} },
		BusyProjects: func(context.Context) (map[string]string, error) { return busy, nil },
	}
}

func itemIDs(items []StorageItem) []string {
	var out []string
	for _, it := range items {
		out = append(out, it.ID)
	}
	sort.Strings(out)
	return out
}

func TestBuildOutputFindsIgnoredBuildDirs(t *testing.T) {
	repo := buildRepo(t)
	rep := buildOutput{}.measure(context.Background(), buildEnv(repo, nil))
	want := []string{filepath.Join(repo, "frontend", "node_modules"), filepath.Join(repo, "src-tauri", "target")}
	sort.Strings(want)
	if got := itemIDs(rep.Items); len(got) != 2 || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("found %v, want %v", got, want)
	}
	if it := itemByID(rep.Items, filepath.Join(repo, "frontend", "node_modules")); it.Bytes != 15 || !it.Cleanable || it.Label != "frontend/node_modules" {
		t.Fatalf("node_modules: %+v (nested node_modules counted in it, not listed apart)", it)
	}
}

func TestBuildOutputNeverFollowsALink(t *testing.T) {
	repo := buildRepo(t)
	link := filepath.Join(repo, "other", "node_modules")
	if err := os.MkdirAll(filepath.Dir(link), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(repo, "frontend", "node_modules"), link); err != nil {
		t.Skip("symlinks unavailable:", err)
	}
	env := buildEnv(repo, nil)
	if it := itemByID(buildOutput{}.measure(context.Background(), env).Items, link); it.ID != "" {
		t.Fatal("a linked node_modules must never be listed")
	}
	res := buildOutput{}.clean(context.Background(), env, []string{link}, CleanOpts{})
	if len(res.Cleaned) != 0 {
		t.Fatal("a link must never be removed through")
	}
	if !fileExists(filepath.Join(repo, "frontend", "node_modules", "x.js")) {
		t.Fatal("the link's target must be untouched")
	}
}

func TestBusyProjectMatchesAPathWithATrailingSeparator(t *testing.T) {
	repo := buildRepo(t)
	env := buildEnv(repo, map[string]string{repo + string(filepath.Separator): "an agent is working in this project"})
	nm := filepath.Join(repo, "frontend", "node_modules")
	if it := itemByID(buildOutput{}.measure(context.Background(), env).Items, nm); it.Cleanable || it.Reason != "an agent is working in this project" {
		t.Fatalf("a busy project's output must stay: %+v", it)
	}
	if res := (buildOutput{}).clean(context.Background(), env, []string{nm}, CleanOpts{}); len(res.Cleaned) != 0 {
		t.Fatal("clean must refuse a busy project")
	}
}

func TestCleanRemovesBuildOutputAndRefusesTheRest(t *testing.T) {
	repo := buildRepo(t)
	env := buildEnv(repo, nil)
	nm := filepath.Join(repo, "frontend", "node_modules")
	dist := filepath.Join(repo, "dist")
	src := filepath.Join(repo, "frontend")
	res := buildOutput{}.clean(context.Background(), env, []string{nm, dist, src}, CleanOpts{})
	if len(res.Cleaned) != 1 || res.Cleaned[0] != nm || res.Reclaimed != 15 {
		t.Fatalf("got %+v, want only node_modules removed, 15 bytes", res)
	}
	if !fileExists(filepath.Join(dist, "keep.txt")) || !fileExists(src) {
		t.Fatal("a tracked dir and a source dir must stay")
	}
	if res := (buildOutput{}).clean(context.Background(), env, []string{filepath.Join(repo, "src-tauri", "target")}, CleanOpts{Auto: true}); len(res.Cleaned) != 0 {
		t.Fatal("auto-clean must never touch build output")
	}
}
```

- [ ] **Step 2: Run them to see them fail**

Run: `go test ./pkg/storage/ -run 'BuildOutput|Busy|CleanRemovesBuildOutput'`
Expected: FAIL to build — `undefined: buildOutput`.

- [ ] **Step 3: Write `pkg/storage/buildoutput.go`**

```go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package storage

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

var (
	// buildDirNames are the directory names that mark build output; a target counts only beside a Cargo.toml
	buildDirNames = map[string]bool{"node_modules": true, "target": true, "dist": true, "build": true, ".next": true, "__pycache__": true}
	// buildSkipDirs are never descended into: git's own, the engine's worktrees, Claude Code's worktrees
	buildSkipDirs = map[string]bool{".git": true, ".waveterm": true, ".claude": true}
)

// buildScanDepth is how far below a project build output is looked for: enough for src-tauri/target and
// frontend/node_modules
const buildScanDepth = 3

// buildOutput lists each project's build directories that git ignores and removes the one a row asks for. Never
// all at once, never automatically, and never while an agent works in the project or one of its runs goes.
type buildOutput struct{}

func (buildOutput) category() StorageCategory { return CategoryBuildOutput }

// buildCandidates lists the directories under project, at most buildScanDepth levels down, whose name marks build
// output. It never descends into a match, into buildSkipDirs, or through a link: a link or a Windows junction is
// not a directory entry here.
func buildCandidates(project string) []string {
	var out []string
	var walk func(dir string, depth int)
	walk = func(dir string, depth int) {
		entries, err := os.ReadDir(dir)
		if err != nil {
			return
		}
		for _, e := range entries {
			if !e.IsDir() {
				continue
			}
			name := e.Name()
			full := filepath.Join(dir, name)
			if buildDirNames[name] && (name != "target" || fileExists(filepath.Join(dir, "Cargo.toml"))) {
				out = append(out, full)
				continue
			}
			if buildSkipDirs[name] || depth >= buildScanDepth {
				continue
			}
			walk(full, depth+1)
		}
	}
	walk(filepath.Clean(project), 1)
	return out
}

// gitIgnored is the subset of paths (absolute, under project) that git ignores in project. A project that is not
// a git repo ignores nothing, so none of its directories qualify.
func gitIgnored(ctx context.Context, project string, paths []string) map[string]bool {
	ignored := map[string]bool{}
	if len(paths) == 0 {
		return ignored
	}
	args := []string{"check-ignore", "--"}
	byRel := map[string]string{}
	for _, p := range paths {
		rel, err := filepath.Rel(project, p)
		if err != nil || strings.HasPrefix(rel, "..") {
			continue
		}
		// the trailing slash tells git it is a directory, which a "node_modules/" pattern needs
		rel = filepath.ToSlash(rel) + "/"
		byRel[rel] = p
		args = append(args, rel)
	}
	// exit 1 means none is ignored and 128 not a repo: either way the output lists only what is ignored
	out, _ := gitOut(ctx, project, args...)
	for _, line := range strings.Split(out, "\n") {
		if p, ok := byRel[strings.TrimSpace(line)]; ok {
			ignored[p] = true
		}
	}
	return ignored
}

// busyReason is why a project's build output must stay now, "" when nothing runs there.
func busyReason(busy map[string]string, project string) string {
	for p, why := range busy {
		if SamePath(p, project) {
			return why
		}
	}
	return ""
}

// projectOf is the project p lies inside, "" when none holds it.
func projectOf(projects []string, p string) string {
	for _, project := range projects {
		rel, err := filepath.Rel(project, p)
		if err == nil && rel != "." && !strings.HasPrefix(rel, "..") {
			return project
		}
	}
	return ""
}

// isPlainDir is a directory that is not a link: Lstat reports a symlink as one, and a Windows junction as
// irregular, so neither passes.
func isPlainDir(p string) bool {
	info, err := os.Lstat(p)
	return err == nil && info.IsDir()
}

func (buildOutput) measure(ctx context.Context, env *Env) StorageCategoryReport {
	busy, busyErr := env.BusyProjects(ctx)
	var items []StorageItem
	for _, project := range env.ProjectPaths() {
		cands := buildCandidates(project)
		ignored := gitIgnored(ctx, project, cands)
		why := busyReason(busy, project)
		if busyErr != nil {
			why = "couldn't tell whether anything runs here"
		}
		for _, c := range cands {
			if !ignored[c] {
				continue
			}
			rel, _ := filepath.Rel(project, c)
			items = append(items, StorageItem{ID: c, Kind: KindBuild, Label: filepath.ToSlash(rel), Detail: filepath.Base(project),
				Path: c, Bytes: dirSize(c), Cleanable: why == "", Reason: why})
		}
	}
	var err error
	if busyErr != nil {
		err = fmt.Errorf("reading what runs in each project: %w", busyErr)
	}
	return report(CategoryBuildOutput, items, err)
}

func (buildOutput) clean(ctx context.Context, env *Env, ids []string, opts CleanOpts) StorageCleanResult {
	var res StorageCleanResult
	if opts.Auto {
		for _, id := range ids {
			skip(&res, id, "build output is cleaned only when you ask")
		}
		return res
	}
	busy, err := env.BusyProjects(ctx)
	if err != nil {
		for _, id := range ids {
			skip(&res, id, "couldn't tell whether anything runs here: "+err.Error())
		}
		return res
	}
	for _, id := range ids {
		id = filepath.Clean(id)
		project := projectOf(env.ProjectPaths(), id)
		switch {
		case project == "":
			skip(&res, id, "not in a project")
			continue
		case busyReason(busy, project) != "":
			skip(&res, id, busyReason(busy, project))
			continue
		case !isPlainDir(id):
			skip(&res, id, "not a directory (a link is never removed)")
			continue
		}
		found := false
		for _, c := range buildCandidates(project) {
			found = found || SamePath(c, id)
		}
		if !found {
			skip(&res, id, "not build output")
			continue
		}
		if !gitIgnored(ctx, project, []string{id})[id] {
			skip(&res, id, "git does not ignore it")
			continue
		}
		size := dirSize(id)
		if err := os.RemoveAll(id); err != nil {
			skip(&res, id, "couldn't remove: "+err.Error())
			continue
		}
		res.Reclaimed += size
		res.Cleaned = append(res.Cleaned, id)
	}
	return res
}
```

Register it last in `defaultProviders` in `pkg/storage/scanner.go` (worktrees, sessions, housekeeping, build output) among those that have merged.

- [ ] **Step 4: Run all storage tests**

Run: `go test ./pkg/storage/ && gofmt -l pkg/storage`
Expected: `ok`, no file listed.

- [ ] **Step 5: Commit**

```bash
git add pkg/storage/buildoutput.go pkg/storage/buildoutput_test.go pkg/storage/scanner.go
git commit -m "feat(storage): the projects' build output, removed one directory at a time"
```

---

### Task 6: The host clears the webview cache at launch

**Depends on:** none

**Files:**
- Create: `src-tauri/src/webcache.rs`
- Modify: `src-tauri/src/paths.rs` (add `app_local_data_dir_for` and its tests)
- Modify: `src-tauri/src/main.rs` (`mod webcache;`, the call in `main()`, one log line in `setup`)

**Interfaces:**
- Consumes: the marker contract from Task 4: the file `<data home>/clear-webview-cache`, where `<data home>` is `paths::data_home_dirs(base).0`.
- Produces: `webcache::MARKER_NAME`, `webcache::clear_if_marked(data_home: &Path, cache_dirs: &[PathBuf]) -> std::io::Result<bool>`, `webcache::cache_dirs(identifier: &str, home: &Path, app_base: &Path) -> Vec<PathBuf>`, `paths::app_local_data_dir_for(identifier: &str, home: Option<&Path>, local_app_data: Option<&Path>) -> Option<PathBuf>`.

- [ ] **Step 1: Write the failing tests**

`src-tauri/src/webcache.rs` (tests first; the functions follow in Step 3):

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("arc-webcache-{}-{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn a_marker_clears_the_cache_dirs_and_itself() {
        let dir = temp_dir("marked");
        let data = dir.join("data");
        let cache = dir.join("cache").join("NetworkCache");
        fs::create_dir_all(&data).unwrap();
        fs::create_dir_all(&cache).unwrap();
        fs::write(cache.join("blob"), b"x").unwrap();
        fs::write(data.join(MARKER_NAME), b"2026-10-08T00:00:00Z").unwrap();
        let missing = dir.join("cache").join("CacheStorage");
        assert!(clear_if_marked(&data, &[cache.clone(), missing]).unwrap());
        assert!(!cache.exists());
        assert!(!data.join(MARKER_NAME).exists());
    }

    #[test]
    fn no_marker_leaves_the_cache_alone() {
        let dir = temp_dir("unmarked");
        let data = dir.join("data");
        let cache = dir.join("cache");
        fs::create_dir_all(&data).unwrap();
        fs::create_dir_all(&cache).unwrap();
        assert!(!clear_if_marked(&data, &[cache.clone()]).unwrap());
        assert!(cache.exists());
    }

    #[test]
    fn cache_dirs_match_the_go_side() {
        let dirs = cache_dirs("dev.arc.app", Path::new("/Users/me"), Path::new("/base"));
        if cfg!(target_os = "macos") {
            let wk = Path::new("/Users/me").join("Library").join("Caches").join("dev.arc.app").join("WebKit");
            assert_eq!(dirs, vec![wk.join("NetworkCache"), wk.join("CacheStorage")]);
        } else if cfg!(windows) {
            let d = Path::new("/base").join("EBWebView").join("Default");
            assert_eq!(dirs, vec![d.join("Cache"), d.join("Code Cache"), d.join("GPUCache")]);
        } else {
            assert!(dirs.is_empty());
        }
    }
}
```

Append to the `tests` module in `src-tauri/src/paths.rs`:

```rust
    #[test]
    fn app_local_data_dir_matches_tauris() {
        let got = app_local_data_dir_for("dev.arc.app", Some(Path::new("/Users/me")), Some(Path::new("C:/u/AppData/Local")));
        if cfg!(windows) {
            assert_eq!(got, Some(Path::new("C:/u/AppData/Local").join("dev.arc.app")));
        } else if cfg!(target_os = "macos") {
            assert_eq!(got, Some(Path::new("/Users/me").join("Library").join("Application Support").join("dev.arc.app")));
        } else {
            assert_eq!(got, None);
        }
    }
```

Add `mod webcache;` after `mod shellenv;` in `src-tauri/src/main.rs`.

- [ ] **Step 2: Run them to see them fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml webcache app_local_data_dir`
Expected: FAIL to compile — `cannot find function clear_if_marked`, `cache_dirs`, `app_local_data_dir_for`.

- [ ] **Step 3: Write the functions**

Top of `src-tauri/src/webcache.rs`, above the tests:

```rust
// Clearing the webview's cache at launch. Its files are in use while arcterm runs, so Settings → Storage
// (pkg/storage, CacheMarkerName) only leaves a marker in the data dir; main() calls this before the Tauri builder
// creates the window, and it removes the cache dirs and then the marker.
use std::path::{Path, PathBuf};

/// The file pkg/storage writes in the data dir to ask for a clear.
pub const MARKER_NAME: &str = "clear-webview-cache";

/// When `<data_home>/clear-webview-cache` exists, removes every dir in `cache_dirs` (a missing one is fine) and
/// then the marker. Returns whether it ran. On an error the marker stays, so the next launch tries again.
pub fn clear_if_marked(data_home: &Path, cache_dirs: &[PathBuf]) -> std::io::Result<bool> {
    let marker = data_home.join(MARKER_NAME);
    if !marker.exists() {
        return Ok(false);
    }
    for dir in cache_dirs {
        match std::fs::remove_dir_all(dir) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e),
        }
    }
    std::fs::remove_file(&marker)?;
    Ok(true)
}

/// The webview's cache dirs, the same pkg/storage.WebviewCacheDirs lists: WebKit's under
/// ~/Library/Caches/<identifier>/WebKit on macOS, WebView2's under <app base>/EBWebView/Default on Windows.
pub fn cache_dirs(identifier: &str, home: &Path, app_base: &Path) -> Vec<PathBuf> {
    if cfg!(target_os = "macos") {
        let wk = home.join("Library").join("Caches").join(identifier).join("WebKit");
        vec![wk.join("NetworkCache"), wk.join("CacheStorage")]
    } else if cfg!(windows) {
        let d = app_base.join("EBWebView").join("Default");
        vec![d.join("Cache"), d.join("Code Cache"), d.join("GPUCache")]
    } else {
        Vec::new()
    }
}
```

In `src-tauri/src/paths.rs`, after `data_home_dirs`:

```rust
// Tauri's app_local_data_dir for `identifier`, for code that runs before the app exists (main, before the
// builder): %LOCALAPPDATA%\<identifier> on Windows, ~/Library/Application Support/<identifier> on macOS.
pub fn app_local_data_dir_for(identifier: &str, home: Option<&Path>, local_app_data: Option<&Path>) -> Option<PathBuf> {
    if cfg!(windows) {
        return local_app_data.map(|d| d.join(identifier));
    }
    if cfg!(target_os = "macos") {
        return home.map(|h| h.join("Library").join("Application Support").join(identifier));
    }
    None
}
```

In `src-tauri/src/main.rs`, add before `fn main()`:

```rust
// Clears the webview cache when Settings → Storage asked for it (webcache.rs). Runs before the builder, since the
// window exists by the time setup runs. Returns the line to log once applog is open.
fn clear_webview_cache_at_launch(identifier: &str) -> Option<String> {
    let is_dev = cfg!(debug_assertions);
    let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")).map(PathBuf::from);
    let local = std::env::var_os("LOCALAPPDATA").map(PathBuf::from);
    let app_local = paths::app_local_data_dir_for(identifier, home.as_deref(), local.as_deref())?;
    let base = paths::dev_data_base(
        paths::data_base_for(&app_local, is_dev),
        is_dev,
        std::env::var_os(paths::DEV_DATA_DIR_ENV),
    );
    let dirs = webcache::cache_dirs(identifier, home.as_deref().unwrap_or(std::path::Path::new("")), &base);
    match webcache::clear_if_marked(&paths::data_home_dirs(&base).0, &dirs) {
        Ok(true) => Some("[tauri] cleared the webview cache, as Settings → Storage asked".to_string()),
        Ok(false) => None,
        Err(e) => Some(format!("[tauri] clearing the webview cache failed: {}", e)),
    }
}
```

In `fn main()`, right after `let context = tauri::generate_context!();`:

```rust
    let cache_note = clear_webview_cache_at_launch(&context.config().identifier);
```

In the `setup` closure, right after `applog::init(&paths::data_home_dirs(&data_base).0);`:

```rust
            if let Some(note) = &cache_note {
                applog::log_line(note);
            }
```

- [ ] **Step 4: Run the Rust tests and a build check**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all pass, including `a_marker_clears_the_cache_dirs_and_itself`, `no_marker_leaves_the_cache_alone`, `cache_dirs_match_the_go_side`, `app_local_data_dir_matches_tauris`.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/webcache.rs src-tauri/src/paths.rs src-tauri/src/main.rs
git commit -m "feat(tauri): clear the webview cache at launch when Storage left its marker"
```

---

### Task 7: Wire it up — RPCs, event, settings, auto-clean, server start

**Depends on:** Task 2, Task 3, Task 4, Task 5

**Files:**
- Create: `pkg/storage/autoclean.go`, `pkg/storage/autoclean_test.go`
- Create: `pkg/wshrpc/wshrpctypes_storage.go`
- Modify: `pkg/wshrpc/wshrpctypes.go` (embed `StorageCommands` in `WshRpcInterface`)
- Create: `pkg/wshrpc/wshserver/wshserver_storage.go`, `pkg/wshrpc/wshserver/wshserver_storage_test.go`
- Modify: `pkg/wps/wpstypes.go`, `pkg/tsgen/tsgenevent.go`
- Modify: `pkg/wconfig/settingsconfig.go`, `pkg/wconfig/defaultconfig/settings.json`
- Modify: `cmd/server/main-server.go`
- Generated by `task generate` (commit them, never hand-edit): `frontend/app/store/wshclientapi.ts`, `frontend/types/gotypes.d.ts`, `frontend/types/waveevent.d.ts`, `pkg/wshrpc/wshclient/wshclient.go`, `pkg/wconfig/metaconsts.go`

**Interfaces:**
- Consumes: everything from Tasks 1–5; `orchestrate.RemoveWorktreeKeepBranch`, `orchestrate.RunOfWorktree`; `sessiontrash.TrashDir`, `sessiontrash.ProjectsDirs`; `wshserver`'s `openTabTranscripts`, `loadAgentRosterFacts`, `buildAgentRoster`.
- Produces: `Scanner.AutoClean(ctx) StorageAutoClean`, `Scanner.StartLoop(ctx, enabled func() bool, delay, every time.Duration)`, consts `AutoCleanDelay`, `AutoCleanEvery`; RPCs `GetStorageCommand(ctx) (*storage.StorageReport, error)`, `RescanStorageCommand(ctx) error`, `CleanStorageCommand(ctx, CommandCleanStorageData) (*storage.StorageCleanResult, error)`; TS: `RpcApi.GetStorageCommand`, `RpcApi.RescanStorageCommand`, `RpcApi.CleanStorageCommand`, types `StorageReport`, `StorageCategoryReport`, `StorageItem`, `StorageCleanResult`, `StorageSkipped`, `StorageAutoClean`, `CommandCleanStorageData`; event `"storage:scan"`; settings `storage:autoclean`, `storage:nudgegb`; `wshserver.StartStorage(ctx)`.

- [ ] **Step 1: Write the failing auto-clean test**

`pkg/storage/autoclean_test.go`:

```go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package storage

import (
	"context"
	"path/filepath"
	"testing"
	"time"
)

func TestAutoCleanTakesOnlyTheSafeParts(t *testing.T) {
	repo := newRepo(t)
	done := addTree(t, repo, runDone)
	dirty := addTree(t, repo, runDirtyID)
	writeFile(t, filepath.Join(dirty, "uncommitted.txt"), 10)
	env := worktreeEnv(repo, map[string]RunState{
		runDone:    {Found: true, Finished: true, Status: "done"},
		runDirtyID: {Found: true, Finished: true, Status: "done"},
	})
	base := t.TempDir()
	env.DataDir = filepath.Join(base, "data")
	env.TrashDir = filepath.Join(base, "trash")
	env.SessionDirs = []string{filepath.Join(base, "projects")}
	env.LiveTranscripts = func(context.Context) ([]string, error) { return nil, nil }
	env.BusyProjects = func(context.Context) (map[string]string, error) { return nil, nil }
	oldLog := filepath.Join(env.DataDir, "waveapp.1.log")
	writeFile(t, oldLog, 40)
	aged(t, oldLog, 8*24*time.Hour)
	writeFile(t, filepath.Join(env.TrashDir, "1700000000000-abc", "abc.jsonl"), 60)
	writeFile(t, filepath.Join(repo, "frontend", "node_modules", "x.js"), 10)

	s := NewScanner(env, nil)
	res := s.AutoClean(context.Background())
	if res.Reclaimed < 140 || res.Error != "" {
		t.Fatalf("got %+v, want the done tree and the old log reclaimed", res)
	}
	if fileExists(done) || fileExists(oldLog) {
		t.Fatal("the finished clean tree and the old rolled log must be gone")
	}
	if !fileExists(dirty) || !fileExists(filepath.Join(env.TrashDir, "1700000000000-abc")) ||
		!fileExists(filepath.Join(repo, "frontend", "node_modules")) || fileExists(filepath.Join(env.DataDir, CacheMarkerName)) {
		t.Fatal("auto-clean touched a dirty tree, the trash, build output or the cache")
	}
	if r := s.Report(); r.LastAuto == nil || r.LastAuto.Reclaimed != res.Reclaimed {
		t.Fatalf("the report must carry the last auto-clean: %+v", r.LastAuto)
	}
}
```

- [ ] **Step 2: Run it to see it fail**

Run: `go test ./pkg/storage/ -run TestAutoCleanTakesOnlyTheSafeParts`
Expected: FAIL to build — `s.AutoClean undefined`.

- [ ] **Step 3: Write `pkg/storage/autoclean.go`**

```go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package storage

import (
	"context"
	"log"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/panichandler"
)

const (
	// AutoCleanDelay is how long after start the first scan, and the first auto-clean, wait
	AutoCleanDelay = 2 * time.Minute
	// AutoCleanEvery is the pause between auto-cleans
	AutoCleanEvery = 24 * time.Hour
)

// AutoClean cleans what needs no one's say: finished run worktrees with no uncommitted changes, and rolled logs
// older than LogMaxAge. The session trash purges itself (sessiontrash.StartPurgeLoop). Sessions, build output, a
// tree with changes and the webview cache are never touched. It keeps its result for the report and rescans.
func (s *Scanner) AutoClean(ctx context.Context) StorageAutoClean {
	res := StorageAutoClean{Ts: s.env.Now().UnixMilli()}
	var failures []string
	for _, p := range []provider{runWorktrees{}, housekeeping{}} {
		var ids []string
		for _, it := range p.measure(ctx, s.env).Items {
			if it.Cleanable && !it.Guarded && (it.Kind == KindWorktree || it.Kind == KindLog) {
				ids = append(ids, it.ID)
			}
		}
		if len(ids) == 0 {
			continue
		}
		cr := p.clean(ctx, s.env, ids, CleanOpts{Auto: true})
		res.Reclaimed += cr.Reclaimed
		for _, sk := range cr.Skipped {
			if strings.HasPrefix(sk.Reason, "couldn't") {
				failures = append(failures, sk.ID+": "+sk.Reason)
			}
		}
	}
	res.Error = strings.Join(failures, "; ")
	if res.Reclaimed > 0 || res.Error != "" {
		log.Printf("storage auto-clean reclaimed %d bytes; failures: %q\n", res.Reclaimed, res.Error)
	}
	s.mu.Lock()
	s.lastAuto = &res
	s.mu.Unlock()
	s.Rescan(ctx)
	return res
}

// StartLoop waits delay, then every `every` auto-cleans when enabled says so, else only rescans, until ctx ends.
func (s *Scanner) StartLoop(ctx context.Context, enabled func() bool, delay, every time.Duration) {
	go func() {
		defer func() {
			panichandler.PanicHandler("storage.Loop", recover())
		}()
		select {
		case <-ctx.Done():
			return
		case <-time.After(delay):
		}
		for {
			if enabled() {
				s.AutoClean(ctx)
			} else {
				s.Rescan(ctx)
			}
			select {
			case <-ctx.Done():
				return
			case <-time.After(every):
			}
		}
	}()
}
```

Make `defaultProviders` in `pkg/storage/scanner.go` the full list now that Tasks 2–5 have merged:

```go
func defaultProviders() []provider {
	return []provider{runWorktrees{}, oldSessions{}, housekeeping{}, buildOutput{}}
}
```

Run: `go test ./pkg/storage/`
Expected: `ok`.

- [ ] **Step 4: Declare the RPCs, the event and the settings**

`pkg/wshrpc/wshrpctypes_storage.go`:

```go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshrpc

import (
	"context"

	"github.com/wavetermdev/waveterm/pkg/storage"
)

// StorageCommands back Settings → Storage: what arcterm and its agents leave on disk, and cleaning it.
type StorageCommands interface {
	// GetStorageCommand returns the last scan; a scan finishing later arrives as a storage:scan event
	GetStorageCommand(ctx context.Context) (*storage.StorageReport, error)
	// RescanStorageCommand starts a scan in the background
	RescanStorageCommand(ctx context.Context) error
	// CleanStorageCommand cleans the named items of one category, re-checking each, then rescans
	CleanStorageCommand(ctx context.Context, data CommandCleanStorageData) (*storage.StorageCleanResult, error)
}

type CommandCleanStorageData struct {
	Category      string   `json:"category"`
	ItemIds       []string `json:"itemids"`
	OlderThanDays int      `json:"olderthandays,omitempty"` // the sessions card's age
	AllowGuarded  bool     `json:"allowguarded,omitempty"`  // an item's own button: removes a guarded item too
}
```

In `pkg/wshrpc/wshrpctypes.go`, add `StorageCommands` to `WshRpcInterface` after `SessionCommands`.

In `pkg/wps/wpstypes.go`, add after `Event_JarvisVolunteer` in the const block:

```go
	Event_StorageScan     = "storage:scan"     // type: storage.StorageReport
```

and `Event_StorageScan,` to `AllEvents` after `Event_JarvisVolunteer,`.

In `pkg/tsgen/tsgenevent.go`, add to `WaveEventDataTypes` (and import `github.com/wavetermdev/waveterm/pkg/storage`):

```go
	wps.Event_StorageScan:      reflect.TypeOf(storage.StorageReport{}),
```

In `pkg/wconfig/settingsconfig.go`, in `SettingsType` after the `Notify*` fields:

```go
	StorageClear     bool     `json:"storage:*,omitempty"`
	StorageAutoClean *bool    `json:"storage:autoclean,omitempty"`
	StorageNudgeGb   *float64 `json:"storage:nudgegb,omitempty"`
```

In `pkg/wconfig/defaultconfig/settings.json`, after `"notify:reply": true,`:

```json
    "storage:autoclean": true,
    "storage:nudgegb": 2,
```

- [ ] **Step 5: Write the failing server test**

`pkg/wshrpc/wshserver/wshserver_storage_test.go`:

```go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func TestBusyProjectsOfNamesWorkingAgentsAndGoingRuns(t *testing.T) {
	agents := []wshrpc.AgentInfo{
		{ProjectPath: "/p/a", State: baseds.AgentState_Working},
		{ProjectPath: "/p/b", State: baseds.AgentState_Idle},
	}
	runs := []*waveobj.Run{
		{ProjectPath: "/p/c", Status: jarvis.RunStatus_Executing},
		{ProjectPath: "/p/d", Status: jarvis.RunStatus_Done},
		{ProjectPath: "/p/e", Status: jarvis.RunStatus_Blocked},
	}
	busy := busyProjectsOf(agents, runs)
	if busy["/p/a"] != "an agent is working in this project" || busy["/p/c"] != "a run is going in this project" {
		t.Fatalf("got %v", busy)
	}
	for _, idle := range []string{"/p/b", "/p/d", "/p/e"} {
		if _, ok := busy[idle]; ok {
			t.Fatalf("%s is not busy: %v", idle, busy)
		}
	}
}

func TestStorageCommandsBeforeStartSayItIsNotStarted(t *testing.T) {
	prev := storageScanner
	storageScanner = nil
	t.Cleanup(func() { storageScanner = prev })
	if _, err := (&WshServer{}).GetStorageCommand(context.Background()); err == nil {
		t.Fatal("want an error before StartStorage")
	}
}
```

Run: `go test ./pkg/wshrpc/wshserver/ -run 'BusyProjectsOf|StorageCommandsBeforeStart'`
Expected: FAIL to build — `undefined: busyProjectsOf`, `storageScanner`.

- [ ] **Step 6: Write `pkg/wshrpc/wshserver/wshserver_storage.go`**

```go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"errors"
	"path/filepath"
	"runtime"
	"sort"
	"time"

	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/orchestrate"
	"github.com/wavetermdev/waveterm/pkg/sessiontrash"
	"github.com/wavetermdev/waveterm/pkg/storage"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// storageScanner backs Settings → Storage; StartStorage creates it when the server starts.
var storageScanner *storage.Scanner

var errStorageNotStarted = errors.New("storage is not started")

// StartStorage builds the scanner from the config, the store and the roster, and starts its loop: after
// storage.AutoCleanDelay, then daily, it auto-cleans when storage:autoclean allows it, else only rescans.
func StartStorage(ctx context.Context) {
	dataDir := wavebase.GetWaveDataDir()
	env := &storage.Env{
		Now:              time.Now,
		ProjectPaths:     configProjectPaths,
		RunOfWorktree:    orchestrate.RunOfWorktree,
		RunState:         storageRunState,
		BusyProjects:     storageBusyProjects,
		LiveTranscripts:  openTabTranscripts,
		RemoveWorktree:   orchestrate.RemoveWorktreeKeepBranch,
		DataDir:          dataDir,
		TrashDir:         sessiontrash.TrashDir(),
		SessionDirs:      sessiontrash.ProjectsDirs(),
		WebviewCacheDirs: storage.WebviewCacheDirs(runtime.GOOS, wavebase.GetHomeDir(), dataDir),
	}
	storageScanner = storage.NewScanner(env, publishStorageScan)
	storageScanner.StartLoop(ctx, storageAutoCleanOn, storage.AutoCleanDelay, storage.AutoCleanEvery)
}

func publishStorageScan(r storage.StorageReport) {
	wps.Broker.Publish(wps.WaveEvent{Event: wps.Event_StorageScan, Data: r})
}

func storageAutoCleanOn() bool {
	v := wconfig.GetWatcher().GetFullConfig().Settings.StorageAutoClean
	return v == nil || *v
}

// configProjectPaths is every project path in config, "~" expanded.
func configProjectPaths() []string {
	var paths []string
	for _, p := range wconfig.GetWatcher().GetFullConfig().Projects {
		if p.Path != "" {
			paths = append(paths, wavebase.ExpandHomeDirSafe(p.Path))
		}
	}
	sort.Strings(paths)
	return paths
}

func storageRunState(ctx context.Context, runID string) (storage.RunState, error) {
	run, err := wstore.DBGet[*waveobj.Run](ctx, runID)
	if err != nil {
		return storage.RunState{}, err
	}
	if run == nil {
		return storage.RunState{}, nil
	}
	finished := run.Status == jarvis.RunStatus_Done || run.Status == jarvis.RunStatus_Cancelled
	return storage.RunState{Found: true, Finished: finished, Status: run.Status}, nil
}

func storageBusyProjects(ctx context.Context) (map[string]string, error) {
	facts, err := loadAgentRosterFacts(ctx)
	if err != nil {
		return nil, err
	}
	var agents []wshrpc.AgentInfo
	for _, row := range buildAgentRoster(facts) {
		agents = append(agents, row.AgentInfo)
	}
	return busyProjectsOf(agents, facts.Runs), nil
}

// busyProjectsOf names the projects whose build output must stay now, with why: an agent working there, or a run of
// the project still going. A blocked run waits on a retry and builds nothing.
func busyProjectsOf(agents []wshrpc.AgentInfo, runs []*waveobj.Run) map[string]string {
	busy := map[string]string{}
	for _, r := range runs {
		switch r.Status {
		case jarvis.RunStatus_Planning, jarvis.RunStatus_AwaitingReview, jarvis.RunStatus_Executing:
			if r.ProjectPath != "" {
				busy[filepath.Clean(r.ProjectPath)] = "a run is going in this project"
			}
		}
	}
	for _, a := range agents {
		if a.State == baseds.AgentState_Working && a.ProjectPath != "" {
			busy[filepath.Clean(a.ProjectPath)] = "an agent is working in this project"
		}
	}
	return busy
}

func (ws *WshServer) GetStorageCommand(ctx context.Context) (*storage.StorageReport, error) {
	if storageScanner == nil {
		return nil, errStorageNotStarted
	}
	r := storageScanner.Report()
	return &r, nil
}

func (ws *WshServer) RescanStorageCommand(ctx context.Context) error {
	if storageScanner == nil {
		return errStorageNotStarted
	}
	// not the RPC's context: the scan outlives the call
	storageScanner.Rescan(context.Background())
	return nil
}

func (ws *WshServer) CleanStorageCommand(ctx context.Context, data wshrpc.CommandCleanStorageData) (*storage.StorageCleanResult, error) {
	if storageScanner == nil {
		return nil, errStorageNotStarted
	}
	// a removal half done must finish even if the caller stops waiting
	res, err := storageScanner.Clean(context.WithoutCancel(ctx), storage.StorageCategory(data.Category), data.ItemIds,
		storage.CleanOpts{OlderThanDays: data.OlderThanDays, AllowGuarded: data.AllowGuarded})
	if err != nil {
		return nil, err
	}
	return &res, nil
}
```

In `cmd/server/main-server.go`, after `sessiontrash.StartPurgeLoop(context.Background())`:

```go
	// Settings → Storage: a scan after a short delay, then the daily auto-clean when storage:autoclean is on
	wshserver.StartStorage(context.Background())
```

- [ ] **Step 7: Generate the bindings and build everything**

Run: `task generate && go build ./... && go vet ./pkg/storage/ ./pkg/wshrpc/... ./pkg/wps/ ./pkg/tsgen/ ./pkg/wconfig/ && gofmt -l pkg/storage pkg/wshrpc/wshrpctypes_storage.go pkg/wshrpc/wshserver/wshserver_storage.go pkg/wps/wpstypes.go pkg/tsgen/tsgenevent.go pkg/wconfig/settingsconfig.go cmd/server/main-server.go`
Expected: generation writes `RpcApi.GetStorageCommand`/`RescanStorageCommand`/`CleanStorageCommand` into `frontend/app/store/wshclientapi.ts`, the `Storage*` types and `CommandCleanStorageData` into `frontend/types/gotypes.d.ts`, `"storage:scan"` into `frontend/types/waveevent.d.ts`, `ConfigKey_StorageAutoClean` and `ConfigKey_StorageNudgeGb` into `pkg/wconfig/metaconsts.go`; the build and vet pass and gofmt lists no file (if it does, `gofmt -w` that file only).

- [ ] **Step 8: Run the tests**

Run: `go test ./pkg/storage/ ./pkg/wconfig/ ./pkg/wps/ && go test ./pkg/wshrpc/wshserver/ -run 'BusyProjectsOf|StorageCommandsBeforeStart'`
Expected: all `ok`.

Run: `NODE_OPTIONS=--max-old-space-size=4096 task check:ts`
Expected: exit 0 (the generated TS typechecks).

- [ ] **Step 9: Commit**

```bash
git add pkg/storage/autoclean.go pkg/storage/autoclean_test.go pkg/storage/scanner.go pkg/wshrpc/wshrpctypes_storage.go pkg/wshrpc/wshrpctypes.go pkg/wshrpc/wshserver/wshserver_storage.go pkg/wshrpc/wshserver/wshserver_storage_test.go pkg/wps/wpstypes.go pkg/tsgen/tsgenevent.go pkg/wconfig/settingsconfig.go pkg/wconfig/defaultconfig/settings.json pkg/wconfig/metaconsts.go cmd/server/main-server.go frontend/app/store/wshclientapi.ts frontend/types/gotypes.d.ts frontend/types/waveevent.d.ts pkg/wshrpc/wshclient/wshclient.go
git commit -m "feat(storage): RPCs, the storage:scan event, the settings and the daily auto-clean"
```

---

### Task 8: The Storage model (pure)

**Depends on:** Task 7

**Files:**
- Create: `frontend/app/view/agents/storagemodel.ts`
- Test: `frontend/app/view/agents/storagemodel.test.ts`

**Interfaces:**
- Consumes: the generated global types `StorageReport`, `StorageCategoryReport`, `StorageItem`, `StorageCleanResult`.
- Produces: `SESSION_DAYS`, `type SessionDays`, `DEFAULT_SESSION_DAYS`, `NUDGE_GB_CHOICES`, `DEFAULT_NUDGE_GB`, `CARD_ORDER`, `type StorageRow`, `type StorageCard`, `sessionRows`, `storageCards`, `cleanAllIds`, `cleanableTotal`, `usedTotal`, `shouldNudge`, `dayKey`, `formatSize`, `cleanToast`, `skippedOf`, `confirmFor`.

- [ ] **Step 1: Write the failing tests**

`frontend/app/view/agents/storagemodel.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
    cleanableTotal,
    cleanAllIds,
    cleanToast,
    confirmFor,
    dayKey,
    formatSize,
    sessionRows,
    shouldNudge,
    skippedOf,
    storageCards,
    usedTotal,
} from "./storagemodel";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 8, 12);
const MB = 1024 * 1024;
const GB = 1024 * MB;

const item = (id: string, over: Partial<StorageItem> = {}): StorageItem => ({
    id,
    kind: "worktree",
    label: id,
    bytes: 10 * MB,
    cleanable: true,
    ...over,
});

const report: StorageReport = {
    scannedts: NOW,
    scanning: false,
    storebytes: 43 * MB,
    categories: [
        { category: "buildoutput", bytes: 3 * GB, cleanablebytes: 3 * GB, items: [item("/p/target", { kind: "build", bytes: 3 * GB })] },
        {
            category: "runworktrees",
            bytes: 30 * MB,
            cleanablebytes: 10 * MB,
            items: [item("a"), item("b", { cleanable: false, guarded: true, reason: "has uncommitted changes" }), item("c", { cleanable: false, reason: "run still going" })],
        },
        {
            category: "sessions",
            bytes: 30 * MB,
            cleanablebytes: 30 * MB,
            items: [
                item("s40", { kind: "session", modts: NOW - 40 * DAY }),
                item("s10", { kind: "session", modts: NOW - 10 * DAY }),
                item("s95", { kind: "session", modts: NOW - 95 * DAY }),
            ],
        },
        { category: "housekeeping", bytes: 0, cleanablebytes: 0, items: [], error: "couldn't read the trash" },
    ],
};

describe("storageCards", () => {
    it("orders the cards worktrees, sessions, housekeeping, build output", () => {
        expect(storageCards(report, "30", NOW, {}).map((c) => c.category)).toEqual([
            "runworktrees",
            "sessions",
            "housekeeping",
            "buildoutput",
        ]);
    });
    it("keeps the sessions older than the chosen age", () => {
        const sessions = (days: "7" | "30" | "90") => storageCards(report, days, NOW, {}).find((c) => c.category === "sessions")!;
        expect(sessions("7").rows.map((r) => r.id)).toEqual(["s40", "s10", "s95"]);
        expect(sessions("30").rows.map((r) => r.id)).toEqual(["s40", "s95"]);
        expect(sessions("90").rows.map((r) => r.id)).toEqual(["s95"]);
        expect(sessions("30").bytes).toBe(20 * MB);
    });
    it("joins a clean's skipped reasons onto their rows and keeps a card's error", () => {
        const cards = storageCards(report, "30", NOW, { a: "run still going" });
        expect(cards[0].rows.find((r) => r.id === "a")!.skipped).toBe("run still going");
        expect(cards.find((c) => c.category === "housekeeping")!.error).toBe("couldn't read the trash");
    });
    it("is empty before the first report", () => {
        expect(storageCards(null, "30", NOW, {})).toEqual([]);
    });
});

describe("cleanAllIds", () => {
    it("takes only cleanable, unguarded rows", () => {
        expect(cleanAllIds(storageCards(report, "30", NOW, {})[0])).toEqual(["a"]);
    });
});

describe("totals", () => {
    it("counts what can be cleaned at the chosen age, build output included", () => {
        expect(cleanableTotal(report, "30", NOW)).toBe(10 * MB + 20 * MB + 3 * GB);
    });
    it("counts everything arcterm uses, the store included", () => {
        expect(usedTotal(report)).toBe(3 * GB + 30 * MB + 30 * MB + 43 * MB);
    });
});

describe("shouldNudge", () => {
    it("nudges past the threshold once a day", () => {
        expect(shouldNudge(3 * GB, 2, null, "2026-10-08")).toBe(true);
        expect(shouldNudge(3 * GB, 2, "2026-10-08", "2026-10-08")).toBe(false);
        expect(shouldNudge(3 * GB, 2, "2026-10-07", "2026-10-08")).toBe(true);
        expect(shouldNudge(1 * GB, 2, null, "2026-10-08")).toBe(false);
        expect(shouldNudge(3 * GB, 0, null, "2026-10-08")).toBe(false);
    });
    it("keys a day by the local date", () => {
        expect(dayKey(new Date(2026, 9, 8, 23, 59).getTime())).toBe("2026-10-08");
    });
});

describe("formatSize", () => {
    it("reads at a glance", () => {
        expect(formatSize(0)).toBe("0 KB");
        expect(formatSize(512 * 1024)).toBe("512 KB");
        expect(formatSize(152 * MB)).toBe("152 MB");
        expect(formatSize(3.44 * GB)).toBe("3.4 GB");
        expect(formatSize(2 * GB)).toBe("2 GB");
    });
});

describe("clean results", () => {
    it("says what was reclaimed, trashed, deferred and skipped", () => {
        expect(cleanToast({ reclaimed: 152 * MB, cleaned: ["a"], skipped: [] })).toBe("Reclaimed 152 MB");
        expect(cleanToast({ reclaimed: 0, trashed: 20 * MB, cleaned: ["s"], skipped: [{ id: "x", reason: "open in a tab" }] })).toBe(
            "Moved 20 MB to the trash; 1 skipped"
        );
        expect(cleanToast({ reclaimed: 0, deferred: true, cleaned: ["webviewcache"], skipped: [] })).toBe(
            "The interface cache clears when arcterm next opens"
        );
        expect(cleanToast({ reclaimed: 0, cleaned: [], skipped: [] })).toBe("Nothing was cleaned");
        expect(skippedOf({ reclaimed: 0, cleaned: [], skipped: [{ id: "x", reason: "why" }] })).toEqual({ x: "why" });
    });
});

describe("confirmFor", () => {
    it("names what goes and what it costs", () => {
        const cards = storageCards(report, "30", NOW, {});
        const wt = confirmFor(cards[0], [cards[0].rows[0]], "30", false);
        expect(wt.message).toContain("1 run worktree");
        expect(wt.message).toContain("branches stay");
        const guarded = confirmFor(cards[0], [cards[0].rows[1]], "30", true);
        expect(guarded.message).toContain("uncommitted changes");
        const sessions = cards[1];
        expect(confirmFor(sessions, sessions.rows, "30", false).message).toContain("older than 30 days");
        expect(confirmFor(cards[3], cards[3].rows, "30", false).message).toContain("recreates it");
    });
});

describe("sessionRows", () => {
    it("treats a missing time as old", () => {
        expect(sessionRows([item("x", { kind: "session" })], "90", NOW).map((r) => r.id)).toEqual(["x"]);
    });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run frontend/app/view/agents/storagemodel.test.ts`
Expected: FAIL — `Failed to load ./storagemodel`.

- [ ] **Step 3: Write `frontend/app/view/agents/storagemodel.ts`**

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Pure: Settings → Storage as data. Orders the categories pkg/storage reports into cards, applies the sessions
// card's age, joins the reasons a clean skipped onto their rows, words the confirms and the toasts, and decides when
// the nudge shows. storagesection.tsx draws it; storagenudge.tsx toasts it. No React, no store.

export const SESSION_DAYS = ["7", "30", "90"] as const;
export type SessionDays = (typeof SESSION_DAYS)[number];
export const DEFAULT_SESSION_DAYS: SessionDays = "30";
export const NUDGE_GB_CHOICES = ["1", "2", "5", "10"] as const;
export const DEFAULT_NUDGE_GB = 2;

const DAY_MS = 24 * 60 * 60 * 1000;
const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

export const CARD_ORDER = ["runworktrees", "sessions", "housekeeping", "buildoutput"] as const;

const CARD_COPY: Record<string, { title: string; blurb: string; action: string | null }> = {
    runworktrees: {
        title: "Run worktrees",
        blurb: "Trees that finished orchestrator runs left in .waveterm/worktrees. Their branches stay.",
        action: "Clean all",
    },
    sessions: {
        title: "Old Claude sessions",
        blurb: "Transcripts not touched in a while. They go to ~/.arc/trash for 7 days, then for good.",
        action: "Move to trash",
    },
    housekeeping: {
        title: "Logs, cache and trash",
        blurb: "Rolled logs, the session trash and the interface's cache.",
        action: "Clean",
    },
    buildoutput: {
        title: "Build output",
        blurb: "node_modules, target, dist and the like that git ignores in your projects. The next build recreates them.",
        action: null,
    },
};

export type StorageRow = StorageItem & { skipped?: string };

export type StorageCard = {
    category: string;
    title: string;
    blurb: string;
    action: string | null; // the card's own button; null for build output, cleaned row by row
    bytes: number;
    cleanableBytes: number;
    rows: StorageRow[];
    error?: string;
};

const sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0);
const isCleanAll = (r: StorageItem) => r.cleanable && !r.guarded;

/** The sessions older than the card's age; an item without a time counts as old. */
export function sessionRows(items: StorageItem[], days: SessionDays, nowMs: number): StorageItem[] {
    const cutoff = nowMs - Number(days) * DAY_MS;
    return items.filter((i) => (i.modts ?? 0) <= cutoff);
}

export function storageCards(
    report: StorageReport | null,
    days: SessionDays,
    nowMs: number,
    skipped: Record<string, string>
): StorageCard[] {
    if (report == null) {
        return [];
    }
    const byCat = new Map((report.categories ?? []).map((c) => [c.category, c]));
    return CARD_ORDER.flatMap((cat) => {
        const c = byCat.get(cat);
        if (c == null) {
            return [];
        }
        const items = cat === "sessions" ? sessionRows(c.items ?? [], days, nowMs) : (c.items ?? []);
        const rows: StorageRow[] = items.map((i) => (skipped[i.id] ? { ...i, skipped: skipped[i.id] } : i));
        return [
            {
                category: cat,
                ...CARD_COPY[cat],
                bytes: sum(rows.map((r) => r.bytes)),
                cleanableBytes: sum(rows.filter(isCleanAll).map((r) => r.bytes)),
                rows,
                error: c.error || undefined,
            },
        ];
    });
}

/** What the card's own button cleans: its cleanable rows that need no stronger confirm. */
export function cleanAllIds(card: StorageCard): string[] {
    return card.rows.filter(isCleanAll).map((r) => r.id);
}

export function cleanableTotal(report: StorageReport | null, days: SessionDays, nowMs: number): number {
    return sum(storageCards(report, days, nowMs, {}).map((c) => c.cleanableBytes));
}

/** Everything the scan saw, arcterm's store included. */
export function usedTotal(report: StorageReport | null): number {
    if (report == null) {
        return 0;
    }
    return sum((report.categories ?? []).map((c) => c.bytes)) + (report.storebytes ?? 0);
}

export function shouldNudge(cleanableBytes: number, nudgeGb: number, lastDay: string | null, today: string): boolean {
    return nudgeGb > 0 && cleanableBytes > nudgeGb * GIB && lastDay !== today;
}

/** The local date, YYYY-MM-DD: the nudge's once-a-day key. */
export function dayKey(ms: number): string {
    const d = new Date(ms);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function formatSize(bytes: number): string {
    if (bytes < MIB) {
        return `${Math.round(bytes / 1024)} KB`;
    }
    if (bytes < GIB) {
        return `${Math.round(bytes / MIB)} MB`;
    }
    return `${Number((bytes / GIB).toFixed(1))} GB`;
}

export function cleanToast(result: StorageCleanResult): string {
    const parts: string[] = [];
    if (result.reclaimed > 0) {
        parts.push(`Reclaimed ${formatSize(result.reclaimed)}`);
    }
    if ((result.trashed ?? 0) > 0) {
        parts.push(`Moved ${formatSize(result.trashed ?? 0)} to the trash`);
    }
    if (result.deferred) {
        parts.push("The interface cache clears when arcterm next opens");
    }
    let text = parts.length > 0 ? parts.join(". ") : "Nothing was cleaned";
    const skipped = result.skipped?.length ?? 0;
    if (skipped > 0) {
        text += `; ${skipped} skipped`;
    }
    return text;
}

export function skippedOf(result: StorageCleanResult): Record<string, string> {
    return Object.fromEntries((result.skipped ?? []).map((s) => [s.id, s.reason]));
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** The confirm a clean opens: what goes, how much, and what it costs. */
export function confirmFor(
    card: StorageCard,
    rows: StorageRow[],
    days: SessionDays,
    guarded: boolean
): { title: string; message: string; confirmLabel: string } {
    const size = formatSize(sum(rows.map((r) => r.bytes)));
    switch (card.category) {
        case "runworktrees":
            return guarded
                ? {
                      title: "Remove run worktree",
                      message: `Remove run worktree ${rows[0]?.label ?? ""} (${size})? It has uncommitted changes, which are lost. Its branch stays.`,
                      confirmLabel: "Remove",
                  }
                : {
                      title: "Clean run worktrees",
                      message: `Remove ${plural(rows.length, "run worktree")} (${size})? Their branches stay.`,
                      confirmLabel: "Remove",
                  };
        case "sessions":
            return {
                title: "Move sessions to the trash",
                message: `Move ${plural(rows.length, "session")} older than ${days} days (${size}) to ~/.arc/trash? They are removed for good after 7 days and no longer resume with claude --resume.`,
                confirmLabel: "Move to trash",
            };
        case "housekeeping":
            return {
                title: "Clean logs, cache and trash",
                message: `Remove rolled logs and empty the session trash for good (${size})? The interface cache clears when arcterm next opens.`,
                confirmLabel: "Clean",
            };
        default:
            return {
                title: "Remove build output",
                message: `Remove ${rows[0]?.label ?? ""} in ${rows[0]?.detail ?? ""} (${size})? The next build or install recreates it.`,
                confirmLabel: "Remove",
            };
    }
}
```

- [ ] **Step 4: Run them to see them pass**

Run: `npx vitest run frontend/app/view/agents/storagemodel.test.ts && npx prettier --check frontend/app/view/agents/storagemodel.ts frontend/app/view/agents/storagemodel.test.ts`
Expected: all tests pass; prettier clean (if not, `npx prettier --write` on these two files only).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/view/agents/storagemodel.ts frontend/app/view/agents/storagemodel.test.ts
git commit -m "feat(storage): the Storage section's model"
```

---

### Task 9: The Storage section, the nudge, the scenario

**Depends on:** Task 8

**Files:**
- Create: `frontend/app/view/agents/storagestore.ts`
- Create: `frontend/app/view/agents/storagesection.tsx`
- Create: `frontend/app/view/agents/storagenudge.tsx`
- Modify: `frontend/app/view/agents/settingsstore.ts` (add `openSettingsSection`)
- Test: `frontend/app/view/agents/settingsstore.test.ts` (append)
- Modify: `frontend/app/view/agents/settingsmodel.ts` (the `storage` section)
- Test: `frontend/app/view/agents/settingsmodel.test.ts` (the config-rows list)
- Modify: `frontend/app/view/agents/settingssurface.tsx` (the `storage` case, `StorageSection`, the pending-section effect)
- Modify: `frontend/app/view/agents/cockpitshell.tsx` (mount `StorageNudge`)
- Modify: `scripts/cdp/scenarios.mjs` (`settings-storage`)
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: Task 8's model; Task 7's `RpcApi.GetStorageCommand`, `RpcApi.RescanStorageCommand`, `RpcApi.CleanStorageCommand`, the `"storage:scan"` event, the settings `storage:autoclean` and `storage:nudgegb`.
- Produces: `storageReportAtom`, `storageSkippedAtom`, `loadStorage()`, `useStorageReport()`, `cleanStorage(category, itemids, opts)`, `rescanStorage()`; `StoragePanel`; `StorageNudge`; `openSettingsSection(model, id)`. DOM hooks for the scenario: `[data-storage-section]`, `[data-storage-head]`, `[data-storage-card="<category>"]`, `[data-storage-clean="<category>"]`, `[data-storage-row]`.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/app/view/agents/settingsstore.test.ts` (add `openSettingsSection` to its import from `./settingsstore`, and `import { atom } from "jotai";` if absent):

```ts
describe("openSettingsSection", () => {
    it("asks Settings for the section, then switches to it", () => {
        const surfaceAtom = atom<string>("cockpit");
        openSettingsSection({ surfaceAtom } as never, "storage");
        expect(globalStore.get(pendingSettingsSectionAtom)).toBe("storage");
        expect(globalStore.get(surfaceAtom)).toBe("settings");
    });
});
```

In `frontend/app/view/agents/settingsmodel.test.ts`, in "marks exactly the wconfig-backed rows as config rows", insert after `"memory:vaultpath",`:

```ts
            "storage:autoclean",
            "storage:nudgegb",
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run frontend/app/view/agents/settingsstore.test.ts frontend/app/view/agents/settingsmodel.test.ts`
Expected: FAIL — `openSettingsSection is not a function`; the config-rows list lacks the two storage keys.

- [ ] **Step 3: Add `openSettingsSection` and the section definition**

Append to `frontend/app/view/agents/settingsstore.ts` (add `import type { AgentsViewModel } from "./agents";`):

```ts
/** Opens Settings on a section. Settings reads the pending section when it mounts and whenever it changes, so this
 *  works whichever surface is showing. */
export function openSettingsSection(model: Pick<AgentsViewModel, "surfaceAtom">, id: string): void {
    globalStore.set(pendingSettingsSectionAtom, id);
    globalStore.set(model.surfaceAtom, "settings");
}
```

In `frontend/app/view/agents/settingsmodel.ts`, inside `settingsSections`, insert this section object right before the one with `id: "headless"`:

```ts
        {
            id: "storage",
            name: "Storage",
            blurb: "What arcterm and its agents leave on disk, and cleaning it.",
            group: "Data",
            rows: [
                {
                    id: "storage.autoclean",
                    title: "Clean the safe parts daily",
                    desc: "Finished run worktrees with no uncommitted changes, and rolled logs older than 7 days. Sessions, build output and the cache wait for you.",
                    key: "storage:autoclean",
                    scope: "synced",
                    config: true,
                },
                {
                    id: "storage.nudge",
                    title: "Remind me above",
                    desc: "A toast, at most once a day, when this much can be cleaned.",
                    key: "storage:nudgegb",
                    scope: "synced",
                    config: true,
                },
            ],
        },
```

Run: `npx vitest run frontend/app/view/agents/settingsstore.test.ts frontend/app/view/agents/settingsmodel.test.ts`
Expected: PASS.

- [ ] **Step 4: Write the store**

`frontend/app/view/agents/storagestore.ts`:

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Storage report the section and the nudge share: one atom, loaded on mount and replaced by every storage:scan
// event, and the reasons the last cleans skipped items, by item id.

import { globalStore } from "@/app/store/jotaiStore";
import { waveEventSubscribeSingle } from "@/app/store/wps";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { fireAndForget } from "@/util/util";
import { atom, useAtomValue, type PrimitiveAtom } from "jotai";
import { useEffect } from "react";
import { skippedOf } from "./storagemodel";

export const storageReportAtom = atom<StorageReport | null>(null) as PrimitiveAtom<StorageReport | null>;
export const storageSkippedAtom = atom<Record<string, string>>({}) as PrimitiveAtom<Record<string, string>>;

// removing a cargo target or node_modules can take a while: the RPC must outlast it
const CLEAN_TIMEOUT_MS = 10 * 60_000;

export async function loadStorage(): Promise<void> {
    try {
        const report = await RpcApi.GetStorageCommand(TabRpcClient);
        globalStore.set(storageReportAtom, report);
        // the server scans 2 minutes after start: an earlier look asks for one now
        if (report.scannedts === 0 && !report.scanning) {
            rescanStorage();
        }
    } catch (e) {
        console.warn("storage:", e);
    }
}

/** Keeps storageReportAtom current while mounted: a load now, then each storage:scan event's report. */
export function useStorageReport(): StorageReport | null {
    useEffect(() => {
        void loadStorage();
        return waveEventSubscribeSingle({
            eventType: "storage:scan",
            handler: (event) => {
                if (event?.data != null) {
                    globalStore.set(storageReportAtom, event.data as StorageReport);
                }
            },
        });
    }, []);
    return useAtomValue(storageReportAtom);
}

export async function cleanStorage(
    category: string,
    itemids: string[],
    opts: { olderthandays?: number; allowguarded?: boolean } = {}
): Promise<StorageCleanResult> {
    const result = await RpcApi.CleanStorageCommand(TabRpcClient, { category, itemids, ...opts }, { timeout: CLEAN_TIMEOUT_MS });
    globalStore.set(storageSkippedAtom, (prev) => ({ ...prev, ...skippedOf(result) }));
    return result;
}

export function rescanStorage(): void {
    fireAndForget(() => RpcApi.RescanStorageCommand(TabRpcClient));
}
```

- [ ] **Step 5: Write the section**

`frontend/app/view/agents/storagesection.tsx`:

```tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Settings → Storage's cards: one per category, with its size, its rows and its clean button. The settings rows
// (auto-clean, the nudge threshold) stay in settingssurface.tsx, which owns SettingRow.

import { Segmented } from "@/app/element/segmented";
import { pushToast } from "@/app/cockpit/notificationstore";
import { modalsModel } from "@/app/store/modalmodel";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { useState } from "react";
import { formatAgo } from "./agentsviewmodel";
import {
    cleanableTotal,
    cleanAllIds,
    cleanToast,
    confirmFor,
    DEFAULT_SESSION_DAYS,
    formatSize,
    SESSION_DAYS,
    storageCards,
    usedTotal,
    type SessionDays,
    type StorageCard,
    type StorageRow,
} from "./storagemodel";
import { cleanStorage, rescanStorage, storageSkippedAtom, useStorageReport } from "./storagestore";

const BUTTON =
    "rounded-md border border-edge-mid bg-surface-raised px-2.5 py-1 text-[12px] text-muted hover:border-edge-strong hover:bg-surface-hover disabled:opacity-50";
const ROWS_SHOWN = 5;

function runClean(card: StorageCard, rows: StorageRow[], days: SessionDays, guarded: boolean) {
    const c = confirmFor(card, rows, days, guarded);
    modalsModel.pushModal("ConfirmModal", {
        title: c.title,
        message: c.message,
        confirmLabel: c.confirmLabel,
        destructive: true,
        onConfirm: () =>
            fireAndForget(async () => {
                try {
                    const result = await cleanStorage(
                        card.category,
                        rows.map((r) => r.id),
                        { olderthandays: card.category === "sessions" ? Number(days) : undefined, allowguarded: guarded || undefined }
                    );
                    pushToast({ title: "Storage", message: cleanToast(result), level: result.skipped?.length ? "warn" : "info" });
                } catch (e) {
                    pushToast({ title: "Storage", message: `Couldn't clean: ${String(e)}`, level: "error" });
                }
            }),
    });
}

function RowView({ card, row, days }: { card: StorageCard; row: StorageRow; days: SessionDays }) {
    const ownButton = card.category === "buildoutput" || card.category === "runworktrees";
    const why = row.skipped ?? row.reason;
    return (
        <div data-storage-row className="flex min-w-0 items-center gap-3 py-1 text-[12px]">
            <span className="min-w-0 flex-1 truncate font-mono text-primary">{row.label}</span>
            <span className="shrink-0 truncate text-muted">{row.detail}</span>
            <span className="w-[64px] shrink-0 text-right tabular-nums text-muted">{formatSize(row.bytes)}</span>
            {why ? <span className={cn("shrink-0", row.guarded ? "text-warning" : "text-muted")}>{why}</span> : null}
            {ownButton && (row.cleanable || row.guarded) ? (
                <button type="button" className={BUTTON} onClick={() => runClean(card, [row], days, !!row.guarded)}>
                    Remove
                </button>
            ) : null}
        </div>
    );
}

function CardView({ card, days, onDays }: { card: StorageCard; days: SessionDays; onDays: (d: SessionDays) => void }) {
    const [open, setOpen] = useState(false);
    const ids = cleanAllIds(card);
    const rows = open ? card.rows : card.rows.slice(0, ROWS_SHOWN);
    return (
        <div data-storage-card={card.category} className="rounded-lg border border-edge-mid bg-surface-raised px-4 py-3">
            <div className="flex items-center gap-3">
                <span className="text-[13.5px] font-semibold text-primary">{card.title}</span>
                <span className="text-[12px] tabular-nums text-muted">{formatSize(card.bytes)}</span>
                <span className="flex-1" />
                {card.category === "sessions" ? (
                    <Segmented<SessionDays>
                        value={days}
                        onChange={onDays}
                        options={SESSION_DAYS.map((d) => ({ key: d, label: `${d} days` }))}
                        ariaLabel="Older than"
                    />
                ) : null}
                {card.action != null ? (
                    <button
                        type="button"
                        data-storage-clean={card.category}
                        className={BUTTON}
                        disabled={ids.length === 0}
                        onClick={() => runClean(card, card.rows.filter((r) => ids.includes(r.id)), days, false)}
                    >
                        {card.action}
                        {ids.length > 0 ? ` · ${formatSize(card.cleanableBytes)}` : ""}
                    </button>
                ) : null}
            </div>
            <div className="mt-1 text-[12px] leading-[1.5] text-muted">{card.blurb}</div>
            {card.error ? <div className="mt-1 text-[12px] text-warning">Couldn't scan: {card.error}</div> : null}
            {card.rows.length > 0 ? (
                <div className="mt-2">
                    {rows.map((r) => (
                        <RowView key={r.id} card={card} row={r} days={days} />
                    ))}
                    {card.rows.length > ROWS_SHOWN ? (
                        <button type="button" className="mt-1 text-[12px] text-muted hover:text-primary" onClick={() => setOpen(!open)}>
                            {open ? "Show fewer" : `Show all ${card.rows.length}`}
                        </button>
                    ) : null}
                </div>
            ) : (
                <div className="mt-2 text-[12px] text-muted">Nothing here.</div>
            )}
        </div>
    );
}

export function StoragePanel() {
    const report = useStorageReport();
    const skipped = useAtomValue(storageSkippedAtom);
    const [days, setDays] = useState<SessionDays>(DEFAULT_SESSION_DAYS);
    if (report == null) {
        return (
            <div data-storage-section className="text-[12px] text-muted">
                Reading what arcterm keeps on disk…
            </div>
        );
    }
    const now = Date.now();
    const cards = storageCards(report, days, now, skipped);
    return (
        <div data-storage-section className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
                <span data-storage-head className="text-[13.5px] font-semibold text-primary">
                    arcterm uses {formatSize(usedTotal(report))} · {formatSize(cleanableTotal(report, days, now))} can be cleaned
                </span>
                <span className="text-[11.5px] text-muted">
                    {report.scanning ? "Scanning…" : report.scannedts ? `scanned ${formatAgo(now - report.scannedts)}` : ""}
                </span>
                <span className="flex-1" />
                <button type="button" className={BUTTON} disabled={report.scanning} onClick={rescanStorage}>
                    Rescan
                </button>
            </div>
            {cards.map((card) => (
                <CardView key={card.category} card={card} days={days} onDays={setDays} />
            ))}
            {report.lastauto ? (
                <div className="text-[11.5px] text-muted">
                    Last auto-clean {formatAgo(now - report.lastauto.ts)}: reclaimed {formatSize(report.lastauto.reclaimed)}
                    {report.lastauto.error ? ` · ${report.lastauto.error}` : ""}
                </div>
            ) : null}
        </div>
    );
}
```

In `frontend/app/view/agents/settingssurface.tsx`:
- add `import { StoragePanel } from "./storagesection";` and change the settingsstore import to `import { pendingSettingsSectionAtom, takePendingSettingsSection } from "./settingsstore";`;
- in `SettingsSurface`, replace the mount-only pending effect with one that also follows the atom:

```tsx
    const pendingSection = useAtomValue(pendingSettingsSectionAtom);
    useEffect(() => {
        const want = takePendingSettingsSection();
        if (want != null) {
            setWanted(want);
        }
    }, [pendingSection]);
```

- in the section switch, before `case "about":`:

```tsx
        case "storage":
            return <StorageSection />;
```

- next to `NotificationsSection`:

```tsx
function StorageSection() {
    const auto = (useAtomValue(getSettingsKeyAtom("storage:autoclean")) as boolean | undefined) ?? true;
    const nudge = (useAtomValue(getSettingsKeyAtom("storage:nudgegb")) as number | undefined) ?? 2;
    return (
        <div>
            <div className="mb-4">
                <StoragePanel />
            </div>
            <SettingRow id="storage.autoclean">
                <Toggle on={auto} onToggle={() => writeConfig({ "storage:autoclean": !auto })} label="Clean the safe parts daily" />
            </SettingRow>
            <SettingRow id="storage.nudge">
                <Segmented<string>
                    value={String(nudge)}
                    onChange={(v) => writeConfig({ "storage:nudgegb": Number(v) })}
                    options={["1", "2", "5", "10"].map((v) => ({ id: v, label: `${v} GB` }))}
                />
            </SettingRow>
        </div>
    );
}
```

(`Segmented` here is the surface's local one with `{ id, label }` options; `Toggle`, `SettingRow` and `writeConfig` are the surface's own.)

- [ ] **Step 6: Write the nudge and mount it**

`frontend/app/view/agents/storagenudge.tsx`:

```tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The once-a-day toast when more than storage:nudgegb GB can be cleaned. Lives in the cockpit shell, since a scan
// can finish while any surface shows; its click opens Settings → Storage.

import { pushToast } from "@/app/cockpit/notificationstore";
import { getSettingsKeyAtom } from "@/app/store/global";
import { useAtomValue } from "jotai";
import { useEffect } from "react";
import type { AgentsViewModel } from "./agents";
import { openSettingsSection } from "./settingsstore";
import { cleanableTotal, dayKey, DEFAULT_NUDGE_GB, DEFAULT_SESSION_DAYS, formatSize, shouldNudge } from "./storagemodel";
import { useStorageReport } from "./storagestore";

// per-viewer convenience: losing it only means one more nudge that day
const NUDGE_DAY_KEY = "storage.nudge.lastday";

function readLastDay(): string | null {
    try {
        return localStorage.getItem(NUDGE_DAY_KEY);
    } catch {
        return null;
    }
}

function writeLastDay(day: string): void {
    try {
        localStorage.setItem(NUDGE_DAY_KEY, day);
    } catch {
        // storage blocked: the nudge may repeat today
    }
}

export function StorageNudge({ model }: { model: AgentsViewModel }): null {
    const report = useStorageReport();
    const nudgeGb = (useAtomValue(getSettingsKeyAtom("storage:nudgegb")) as number | undefined) ?? DEFAULT_NUDGE_GB;
    useEffect(() => {
        if (report == null || !report.scannedts || report.scanning) {
            return;
        }
        const now = Date.now();
        const total = cleanableTotal(report, DEFAULT_SESSION_DAYS, now);
        const today = dayKey(now);
        if (!shouldNudge(total, nudgeGb, readLastDay(), today)) {
            return;
        }
        writeLastDay(today);
        pushToast({
            title: "Storage",
            message: `${formatSize(total)} can be cleaned`,
            level: "info",
            onOpen: () => openSettingsSection(model, "storage"),
        });
    }, [report, nudgeGb, model]);
    return null;
}
```

In `frontend/app/view/agents/cockpitshell.tsx`, import `StorageNudge` from `./storagenudge` and mount it right after `<NotifySync model={model} />`:

```tsx
            {/* a scan can finish while any surface shows */}
            <StorageNudge model={model} />
```

- [ ] **Step 7: Add the CDP scenario**

In `scripts/cdp/scenarios.mjs`, before `export const SCENARIOS = [` (4-space indent, no prettier on this file):

```js
// --- Settings → Storage: the section, its four cards in order and its head ------------------------------------
const settingsStorage = {
    name: "settings-storage",
    surface: "settings",
    async arrange(h) {
        await h.rpc("rescanstorage", null);
        return {};
    },
    async assert(h) {
        const steps = [];
        const rec = (step, ok, detail) => steps.push({ step, ok, detail });
        await h.goto("settings");
        await h.ev(`document.querySelector('[data-section="storage"]')?.click()`);
        const up = await polishWaitFor(h, `document.querySelector('[data-storage-section]') != null`, 5000);
        rec("1. Settings opens on the Storage section", up, `section=${up}`);
        const four = await polishWaitFor(h, `document.querySelectorAll('[data-storage-card]').length === 4`, 30000);
        const order = await h.ev(`[...document.querySelectorAll('[data-storage-card]')].map((c) => c.getAttribute('data-storage-card'))`);
        rec(
            "2. the four category cards render in order",
            four && JSON.stringify(order) === JSON.stringify(["runworktrees", "sessions", "housekeeping", "buildoutput"]),
            `cards=${JSON.stringify(order)}`
        );
        const head = await h.ev(`(document.querySelector('[data-storage-head]')?.textContent || '')`);
        rec("3. the head says what arcterm uses and what can be cleaned", /uses .+ · .+ can be cleaned/.test(head), `head="${head}"`);
        const noBuildButton = await h.ev(`document.querySelector('[data-storage-clean="buildoutput"]') == null`);
        rec("4. build output has no clean-all button", noBuildButton === true, `absent=${noBuildButton}`);
        await h.shot("cdp-shots/settings-storage.png");
        return steps;
    },
    async teardown(h) {
        await h.goto("cockpit");
    },
};
```

and add `settingsStorage,` at the end of the `SCENARIOS` array.

- [ ] **Step 8: Add the CHANGELOG line**

In `CHANGELOG.md`, under `## Unreleased` → `### Added` (open the headings if the top section has a date, per the file's header):

```markdown
- **Settings → Storage** shows what arcterm and its agents leave on disk (finished runs' worktrees, old Claude
  sessions, logs, cache and trash, your projects' build output) and cleans each with a button; the safe parts clean
  themselves daily, and a toast says when more than 2 GB can go.
```

- [ ] **Step 9: Verify**

Run: `npx vitest run frontend/app/view/agents/ && NODE_OPTIONS=--max-old-space-size=4096 task check:ts && npx prettier --check frontend/app/view/agents/storagestore.ts frontend/app/view/agents/storagesection.tsx frontend/app/view/agents/storagenudge.tsx frontend/app/view/agents/settingsstore.ts frontend/app/view/agents/settingsmodel.ts frontend/app/view/agents/settingssurface.tsx frontend/app/view/agents/cockpitshell.tsx && npx eslint frontend/app/view/agents/storagestore.ts frontend/app/view/agents/storagesection.tsx frontend/app/view/agents/storagenudge.tsx`
Expected: tests pass, typecheck exit 0, prettier clean on these files (fix only these with `--write`), eslint clean. On Windows also run `task verify:ui -- settings-storage` against the dev app; on a Mac say it is unverified (WKWebView answers no CDP).

- [ ] **Step 10: Commit**

```bash
git add frontend/app/view/agents/storagestore.ts frontend/app/view/agents/storagesection.tsx frontend/app/view/agents/storagenudge.tsx frontend/app/view/agents/settingsstore.ts frontend/app/view/agents/settingsstore.test.ts frontend/app/view/agents/settingsmodel.ts frontend/app/view/agents/settingsmodel.test.ts frontend/app/view/agents/settingssurface.tsx frontend/app/view/agents/cockpitshell.tsx scripts/cdp/scenarios.mjs CHANGELOG.md
git commit -m "feat(storage): Settings → Storage, its cleans and the once-a-day nudge"
```

---

## Self-Review

- **Spec coverage.** Decision 1 (section, head, Rescan, cards, auto-clean switch): Tasks 8–9. Decision 2 (confirms, toast, skipped reasons): Tasks 8–9. Decision 3 (providers, re-check at removal): Tasks 1–5. Decision 4.1–4.4: Tasks 2, 3, 4 (+6), 5. Decision 5 (two RPCs + rescan + event): Task 7. Decision 6 (background scan, cached, rescans after clean and auto-clean): Tasks 1 and 7. Decision 7 (pure model): Task 8. Decision 8 (settings, auto-clean, nudge): Tasks 7 and 9. Decision 9 (errors): card error (Tasks 1, 8–9), partial clean (all providers' `Skipped`), auto-clean failures to the log and the last-auto line (Task 7, 9). Testing section: each task's tests; CDP in Task 9; the by-hand checks are the executor's on the Mac.
- **Deviations from the spec, on purpose:** `RemoveRunWorktree` deletes the branch, so a new `RemoveWorktreeKeepBranch` keeps it as the spec wants; runs have no `failed` status and a `blocked` run is not finished; the task's cleanup debt is not written by Storage (the engine's `RetryCleanupDebt` clears a debt whose tree is gone); Windows' EBWebView is beside the data dir, not inside it; a directory under `.waveterm/worktrees` whose name the engine never makes is listed and never cleaned.
- **Placeholders:** none; every code step has its code.
- **Type consistency:** `StorageItem`/`StorageReport`/`StorageCleanResult`/`CleanOpts`/`Env` are defined in Task 1 and used unchanged after; `defaultProviders` grows in Tasks 2–5 and is final in Task 7; TS names come from `task generate` in Task 7 (`storagemodel.ts` uses `modts`, `cleanable`, `guarded`, `reclaimed`, `trashed`, `deferred`, `skipped` — the JSON tags of Task 1).
- **Review Focus** lines each have their test in the owning task (Tasks 1, 2, 3, 5).
