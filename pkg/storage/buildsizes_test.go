// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package storage

import (
	"bytes"
	"context"
	"encoding/json"
	"log"
	"maps"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"
)

// sizingBase is the fixed clock the sizing tests run on: kept sizes are dated against it.
var sizingBase = time.Date(2026, 11, 27, 12, 0, 0, 0, time.UTC)

func keptEnv(t *testing.T) *Env {
	t.Helper()
	return &Env{Now: func() time.Time { return sizingBase }, DataDir: t.TempDir()}
}

func keptFilePath(env *Env) string { return filepath.Join(env.DataDir, "storage", "buildsizes.json") }

// writeKeptRaw is an outside writer: the file's text as the scenario or a person would leave it.
func writeKeptRaw(t *testing.T, env *Env, text string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(keptFilePath(env)), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(keptFilePath(env), []byte(text), 0o644); err != nil {
		t.Fatal(err)
	}
}

func captureStdLog(t *testing.T) *bytes.Buffer {
	t.Helper()
	var buf bytes.Buffer
	prev := log.Writer()
	log.SetOutput(&buf)
	t.Cleanup(func() { log.SetOutput(prev) })
	return &buf
}

func TestBuildSizesReadsTheFileAsAnOutsideWriterLeavesIt(t *testing.T) {
	env := keptEnv(t)
	writeKeptRaw(t, env, `{"/p/a/node_modules":{"bytes":7,"ts":1000},"/p/b/dist":{"bytes":9,"ts":2000}}`)
	want := keptSizes{"/p/a/node_modules": {Bytes: 7, Ts: 1000}, "/p/b/dist": {Bytes: 9, Ts: 2000}}
	if got := readBuildSizes(env); !maps.Equal(got, want) {
		t.Fatalf("read %v, want %v: folder path -> {bytes, ts}", got, want)
	}
}

func TestBuildSizesAMissingFileIsEmpty(t *testing.T) {
	env := keptEnv(t)
	logged := captureStdLog(t)
	if got := readBuildSizes(env); got == nil || len(got) != 0 {
		t.Fatalf("read %v, want an empty map that can be written to", got)
	}
	if logged.Len() != 0 {
		t.Fatalf("a missing file is the normal first run, nothing to log: %q", logged.String())
	}
}

func TestBuildSizesACorruptFileIsEmptyAndLogged(t *testing.T) {
	env := keptEnv(t)
	writeKeptRaw(t, env, `{"/p/a": {"bytes": `)
	logged := captureStdLog(t)
	if got := readBuildSizes(env); got == nil || len(got) != 0 {
		t.Fatalf("read %v, want empty: a corrupt file must never fail a scan", got)
	}
	if !strings.Contains(logged.String(), "buildsizes.json") {
		t.Fatalf("the corrupt file must be logged, got %q", logged.String())
	}
}

func TestBuildSizesIsWrittenOnlyWhenItsContentChanged(t *testing.T) {
	env := keptEnv(t)
	updateBuildSizes(env, func(k keptSizes) { k["/p/a"] = keptSize{Bytes: 5, Ts: 100} })
	raw, err := os.ReadFile(keptFilePath(env))
	if err != nil {
		t.Fatal(err)
	}
	var onDisk map[string]map[string]int64
	if err := json.Unmarshal(raw, &onDisk); err != nil || onDisk["/p/a"]["bytes"] != 5 || onDisk["/p/a"]["ts"] != 100 {
		t.Fatalf("file %s (%v), want folder path -> {bytes, ts}", raw, err)
	}
	old := time.Now().Add(-48 * time.Hour)
	if err := os.Chtimes(keptFilePath(env), old, old); err != nil {
		t.Fatal(err)
	}
	updateBuildSizes(env, func(k keptSizes) { k["/p/a"] = keptSize{Bytes: 5, Ts: 100} })
	updateBuildSizes(env, func(k keptSizes) {})
	dropUnlistedSizes(env, []string{"/p/a"})
	if info, _ := os.Stat(keptFilePath(env)); info.ModTime().After(old.Add(time.Hour)) {
		t.Fatalf("an update that changed nothing rewrote the file (modified %v)", info.ModTime())
	}
	updateBuildSizes(env, func(k keptSizes) { k["/p/a"] = keptSize{Bytes: 6, Ts: 100} })
	if info, _ := os.Stat(keptFilePath(env)); !info.ModTime().After(old.Add(time.Hour)) {
		t.Fatalf("a changed entry must be written (modified %v)", info.ModTime())
	}
	if got := readBuildSizes(env); got["/p/a"].Bytes != 6 {
		t.Fatalf("read %v, want the new size", got)
	}
	if left, _ := filepath.Glob(filepath.Join(env.DataDir, "storage", "*.tmp")); len(left) != 0 {
		t.Fatalf("the temp file of a write must not stay: %v", left)
	}
}

func TestBuildSizesDropUnlistedKeepsOnlyListedFolders(t *testing.T) {
	env := keptEnv(t)
	updateBuildSizes(env, func(k keptSizes) {
		k["/p/a/node_modules"] = keptSize{Bytes: 1, Ts: 10}
		k["/p/gone/node_modules"] = keptSize{Bytes: 2, Ts: 20}
	})
	dropUnlistedSizes(env, []string{"/p/a/node_modules", "/p/new/dist"})
	want := keptSizes{"/p/a/node_modules": {Bytes: 1, Ts: 10}}
	if got := readBuildSizes(env); !maps.Equal(got, want) {
		t.Fatalf("read %v, want %v: the folder no scan lists is dropped, a listed one never sized adds no entry", got, want)
	}
}

func TestBuildSizesAnEnvWithNoDataDirReadsAndWritesNothing(t *testing.T) {
	cwd := t.TempDir()
	t.Chdir(cwd)
	env := &Env{Now: func() time.Time { return sizingBase }}
	updateBuildSizes(env, func(k keptSizes) { k["/p/a"] = keptSize{Bytes: 1, Ts: 1} })
	dropUnlistedSizes(env, nil)
	dropBuildSizes(env, "/p/a")
	if got := readBuildSizes(env); len(got) != 0 {
		t.Fatalf("read %v, want nothing without a data dir", got)
	}
	if entries, _ := os.ReadDir(cwd); len(entries) != 0 {
		t.Fatalf("a stray file landed in the working dir: %v", entries)
	}
}

func TestBuildSizesAFullScanDropsFoldersItNoLongerListsAndFillsTheRest(t *testing.T) {
	repo := buildRepo(t)
	env := buildEnv(repo, nil)
	env.DataDir = t.TempDir()
	nm := filepath.Join(repo, "frontend", "node_modules")
	ghost := filepath.Join(repo, "old", "node_modules")
	updateBuildSizes(env, func(k keptSizes) {
		k[nm] = keptSize{Bytes: 999, Ts: 1234}
		k[ghost] = keptSize{Bytes: 5, Ts: 1}
	})
	s := &Scanner{env: env, providers: []provider{buildOutput{}}}
	rep := s.ScanNow(context.Background())
	cat, _ := findCategory(rep.Categories, CategoryBuildOutput)
	if it := itemByID(cat.Items, nm); it.Bytes != 999 || it.SizedTs != 1234 {
		t.Fatalf("node_modules = %+v, want its kept size, not a walk's 15", it)
	}
	got := readBuildSizes(env)
	if _, ok := got[ghost]; ok || got[nm].Bytes != 999 {
		t.Fatalf("kept sizes %v, want the unlisted folder dropped and the listed one kept", got)
	}
}

func TestBuildSizesAScanThatWasCancelledDropsNothing(t *testing.T) {
	repo := buildRepo(t)
	env := buildEnv(repo, nil)
	env.DataDir = t.TempDir()
	nm := filepath.Join(repo, "frontend", "node_modules")
	updateBuildSizes(env, func(k keptSizes) { k[nm] = keptSize{Bytes: 15, Ts: 1234} })
	ctx, cancel := context.WithCancel(context.Background())
	cancel() // the server is stopping: git calls fail, and a scan that lists nothing must not forget every size
	s := &Scanner{env: env, providers: []provider{buildOutput{}}}
	s.ScanNow(ctx)
	if got := readBuildSizes(env); got[nm].Bytes != 15 {
		t.Fatalf("kept sizes %v, want the entry kept: a cancelled scan's empty listing is not a full scan's", got)
	}
}

// sizingFx is a Scanner whose last report lists build folders on disk, with a fixed clock, a data dir and a walk that
// records which folders it sized.
type sizingFx struct {
	t     *testing.T
	env   *Env
	s     *Scanner
	pub   *publishedReports
	items []StorageItem

	mu     sync.Mutex
	walked []string
}

func newSizingFx(t *testing.T) *sizingFx {
	t.Helper()
	f := &sizingFx{t: t, env: keptEnv(t), pub: &publishedReports{}}
	f.s = &Scanner{env: f.env, providers: []provider{buildOutput{}}, publish: f.pub.add}
	f.s.sizeWalk = func(p string) int64 {
		f.mu.Lock()
		f.walked = append(f.walked, p)
		f.mu.Unlock()
		return dirSize(p)
	}
	return f
}

// project makes a project dir with one build folder per size (the folder's one file is that big) and lists them the
// way a scan would, never sized.
func (f *sizingFx) project(sizes ...int) (string, []string) {
	f.t.Helper()
	project := f.t.TempDir()
	var folders []string
	for i, n := range sizes {
		dir := filepath.Join(project, []string{"node_modules", "dist", "build"}[i])
		writeFile(f.t, filepath.Join(dir, "f"), n)
		folders = append(folders, dir)
		f.items = append(f.items, StorageItem{ID: dir, Kind: KindBuild, Label: filepath.Base(dir), Detail: project, Path: dir, Cleanable: true})
	}
	f.reseed()
	return project, folders
}

// reseed makes the scanner's last report the listed folders with the kept sizes on disk, as a scan leaves it.
func (f *sizingFx) reseed() {
	f.t.Helper()
	cat := fillKeptSizes(report(CategoryBuildOutput, slices.Clone(f.items), nil), readBuildSizes(f.env))
	f.s.report = StorageReport{ScannedTs: 1, Categories: []StorageCategoryReport{cat}}
}

// keep writes a kept size taken `age` before the clock.
func (f *sizingFx) keep(folder string, bytes int64, age time.Duration) {
	f.t.Helper()
	updateBuildSizes(f.env, func(k keptSizes) { k[folder] = keptSize{Bytes: bytes, Ts: sizingBase.Add(-age).UnixMilli()} })
	f.reseed()
}

func (f *sizingFx) kept(folder string) (keptSize, bool) {
	k, ok := readBuildSizes(f.env)[folder]
	return k, ok
}

func (f *sizingFx) walks() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return slices.Clone(f.walked)
}

func (f *sizingFx) size(projects []string, force bool) error {
	return f.s.SizeBuildOutput(context.Background(), projects, force)
}

// idle waits for the queue to empty, which is when the report's Sizing goes nil.
func (f *sizingFx) idle() {
	f.t.Helper()
	waitFor(f.t, func() bool { return f.s.Report().Sizing == nil })
}

func (f *sizingFx) category() StorageCategoryReport {
	c, _ := findCategory(f.s.Report().Categories, CategoryBuildOutput)
	return c
}

// hold makes every walk after the call wait for release, saying which folder it entered first.
func (f *sizingFx) hold() (entered chan string, release func()) {
	entered = make(chan string, 32)
	gate := make(chan struct{})
	inner := f.s.sizeWalk
	f.s.sizeWalk = func(p string) int64 {
		entered <- p
		<-gate
		return inner(p)
	}
	var once sync.Once
	release = func() { once.Do(func() { close(gate) }) }
	f.t.Cleanup(release)
	return entered, release
}

func recv(t *testing.T, ch chan string) string {
	t.Helper()
	select {
	case s := <-ch:
		return s
	case <-time.After(5 * time.Second):
		t.Fatal("no walk began")
		return ""
	}
}

func TestSizingWalksAProjectsFoldersAndLandsTheirSizes(t *testing.T) {
	f := newSizingFx(t)
	p, folders := f.project(10, 5)
	if err := f.size([]string{p}, false); err != nil {
		t.Fatal(err)
	}
	f.idle()
	cat := f.category()
	for i, want := range []int64{10, 5} {
		it := itemByID(cat.Items, folders[i])
		if it.Bytes != want || it.SizedTs != sizingBase.UnixMilli() {
			t.Fatalf("%s = %+v, want %d bytes sized at the clock", folders[i], it, want)
		}
		if k, ok := f.kept(folders[i]); !ok || k.Bytes != want || k.Ts != sizingBase.UnixMilli() {
			t.Fatalf("kept %s = %+v, want %d bytes at the clock", folders[i], k, want)
		}
	}
	if cat.Bytes != 15 || cat.CleanableBytes != 15 {
		t.Fatalf("category totals %d / %d, want 15 / 15 (rebuilt with the kept sizes)", cat.Bytes, cat.CleanableBytes)
	}
	pubs := f.pub.all()
	if !slices.ContainsFunc(pubs, func(r StorageReport) bool { return r.Sizing != nil && r.Sizing.Walking == p }) {
		t.Fatal("no published report named the project being walked: the row's spinner reads it")
	}
	if last := pubs[len(pubs)-1]; last.Sizing != nil {
		t.Fatalf("the last published report has Sizing %+v, want nil once idle", last.Sizing)
	}
	if landed, _ := findCategory(pubs[len(pubs)-1].Categories, CategoryBuildOutput); itemByID(landed.Items, folders[0]).Bytes != 10 {
		t.Fatal("the report published after a project lands carries its sizes")
	}
}

func TestSizingSkipsFreshSizesUnlessForced(t *testing.T) {
	f := newSizingFx(t)
	p, folders := f.project(10, 5)
	f.keep(folders[0], 111, 23*time.Hour) // sized in the last day
	f.keep(folders[1], 222, 25*time.Hour) // sized more than a day ago
	if err := f.size([]string{p}, false); err != nil {
		t.Fatal(err)
	}
	f.idle()
	if got := f.walks(); !slices.Equal(got, []string{folders[1]}) {
		t.Fatalf("walked %v, want only the folder sized over 24 h ago", got)
	}
	if k, _ := f.kept(folders[0]); k.Bytes != 111 {
		t.Fatalf("a fresh size is shown as is, got %+v", k)
	}
	if k, _ := f.kept(folders[1]); k.Bytes != 5 || k.Ts != sizingBase.UnixMilli() {
		t.Fatalf("the stale folder is walked again, got %+v", k)
	}
	// both fresh now: a plain ask walks nothing
	if err := f.size([]string{p}, false); err != nil {
		t.Fatal(err)
	}
	f.idle()
	if got := f.walks(); len(got) != 1 {
		t.Fatalf("walked %v, a project of fresh sizes must not be walked", got)
	}
	// force walks every folder, whatever the age
	if err := f.size([]string{p}, true); err != nil {
		t.Fatal(err)
	}
	f.idle()
	if got := f.walks(); !slices.Equal(got, []string{folders[1], folders[0], folders[1]}) {
		t.Fatalf("walked %v, want force to walk both folders again", got)
	}
	if k, _ := f.kept(folders[0]); k.Bytes != 10 {
		t.Fatalf("a forced walk replaces a fresh size, got %+v", k)
	}
}

func TestSizingAFreshProjectWhileIdlePublishesNothing(t *testing.T) {
	f := newSizingFx(t)
	p, folders := f.project(10)
	f.keep(folders[0], 10, time.Hour)
	if err := f.size([]string{p}, false); err != nil {
		t.Fatal(err)
	}
	f.idle()
	if len(f.walks()) != 0 {
		t.Fatalf("walked %v, want nothing", f.walks())
	}
	if pubs := f.pub.all(); len(pubs) != 0 {
		t.Fatalf("published %d reports for a row open that changed nothing: the Stop sizing button would flash", len(pubs))
	}
}

func TestSizingAnEmptyListIsEveryListedProjectOldestFirst(t *testing.T) {
	f := newSizingFx(t)
	_, fa := f.project(1)    // sized 5 days ago
	_, fb := f.project(2)    // never sized
	_, fc := f.project(3, 3) // one folder 4 days old, one never sized: its age is the never
	_, fd := f.project(4)    // sized 2 days ago
	f.keep(fa[0], 1, 5*24*time.Hour)
	f.keep(fc[0], 3, 4*24*time.Hour)
	f.keep(fd[0], 4, 2*24*time.Hour)
	if err := f.size(nil, true); err != nil {
		t.Fatal(err)
	}
	f.idle()
	want := []string{fb[0], fc[0], fc[1], fa[0], fd[0]}
	if got := f.walks(); !slices.Equal(got, want) {
		t.Fatalf("walked %v, want %v: never sized first (ties in the report's order), then the oldest size", got, want)
	}
}

func TestSizingAnEmptyListWithNothingListedIsNotAnError(t *testing.T) {
	s := &Scanner{env: keptEnv(t)}
	if err := s.SizeBuildOutput(context.Background(), nil, false); err != nil {
		t.Fatal(err)
	}
	s.StopSizing()
	if s.Report().Sizing != nil {
		t.Fatalf("a zero-value scanner has nothing to size, got %+v", s.Report().Sizing)
	}
	if err := s.SizeBuildOutput(context.Background(), []string{"/nowhere"}, false); err == nil {
		t.Fatal("a project the report does not list must be refused")
	}
}

func TestSizingRefusesAProjectTheReportDoesNotListAndQueuesTheRest(t *testing.T) {
	f := newSizingFx(t)
	p, folders := f.project(7)
	ghost := filepath.Join(t.TempDir(), "ghost")
	err := f.size([]string{ghost, p}, true)
	if err == nil || !strings.Contains(err.Error(), ghost) {
		t.Fatalf("got %v, want an error naming %s", err, ghost)
	}
	f.idle()
	if got := f.walks(); !slices.Equal(got, folders) {
		t.Fatalf("walked %v, want the listed project queued anyway", got)
	}
}

func TestSizingANonForceAskMovesAheadOfAForceQueue(t *testing.T) {
	f := newSizingFx(t)
	pa, fa := f.project(1)
	pb, fb := f.project(2)
	pc, fc := f.project(3)
	pd, fd := f.project(4)
	entered, release := f.hold()
	if err := f.size(nil, true); err != nil {
		t.Fatal(err)
	}
	if first := recv(t, entered); first != fa[0] {
		t.Fatalf("walking %s first, want %s", first, fa[0])
	}
	before := f.s.Report().Sizing
	if before == nil || before.Walking != pa || !slices.Equal(before.Queued, []string{pb, pc, pd}) || before.Done != 0 || before.Total != 4 {
		t.Fatalf("sizing %+v, want %s walking, [b c d] queued, 0 of 4", before, pa)
	}
	if err := f.size([]string{pd}, false); err != nil {
		t.Fatal(err)
	}
	after := f.s.Report().Sizing
	if after.Walking != pa || !slices.Equal(after.Queued, []string{pd, pb, pc}) || after.Total != 4 {
		t.Fatalf("sizing %+v, want the row-open ask ahead of the force queue, behind the walk in progress, still 4 in all", after)
	}
	if !slices.Equal(before.Queued, []string{pb, pc, pd}) {
		t.Fatalf("a report already read changed: %v", before.Queued)
	}
	release()
	f.idle()
	if got, want := f.walks(), []string{fa[0], fd[0], fb[0], fc[0]}; !slices.Equal(got, want) {
		t.Fatalf("walked %v, want %v", got, want)
	}
}

func TestSizingANonForceAskForANewProjectGoesToTheFrontKeepingItsOwnOrder(t *testing.T) {
	f := newSizingFx(t)
	pa, fa := f.project(1)
	pb, fb := f.project(2)
	pc, fc := f.project(3)
	pd, fd := f.project(4)
	entered, release := f.hold()
	if err := f.size([]string{pa}, false); err != nil {
		t.Fatal(err)
	}
	recv(t, entered)
	if err := f.size([]string{pb}, true); err != nil { // queued behind, force
		t.Fatal(err)
	}
	if err := f.size([]string{pc, pd}, false); err != nil {
		t.Fatal(err)
	}
	if q := f.s.Report().Sizing.Queued; !slices.Equal(q, []string{pc, pd, pb}) {
		t.Fatalf("queued %v, want [c d b]: a non-force ask in front, in its own order", q)
	}
	release()
	f.idle()
	if got, want := f.walks(), []string{fa[0], fc[0], fd[0], fb[0]}; !slices.Equal(got, want) {
		t.Fatalf("walked %v, want %v", got, want)
	}
}

func TestSizingAForceAskOnAQueuedProjectMakesItForce(t *testing.T) {
	f := newSizingFx(t)
	pa, fa := f.project(1)
	pb, fb := f.project(2)
	f.keep(fb[0], 2, time.Hour) // fresh: a plain ask skips it
	entered, release := f.hold()
	if err := f.size([]string{pa}, false); err != nil {
		t.Fatal(err)
	}
	recv(t, entered)
	if err := f.size([]string{pb}, false); err != nil {
		t.Fatal(err)
	}
	if err := f.size([]string{pb}, true); err != nil {
		t.Fatal(err)
	}
	if s := f.s.Report().Sizing; !slices.Equal(s.Queued, []string{pb}) || s.Total != 2 {
		t.Fatalf("sizing %+v, want b queued once, 2 in all", s)
	}
	release()
	f.idle()
	if got, want := f.walks(), []string{fa[0], fb[0]}; !slices.Equal(got, want) {
		t.Fatalf("walked %v, want the forced fresh project walked too", got)
	}
}

func TestSizingAnAskForTheWalkingProjectJoinsItInsteadOfWalkingTwice(t *testing.T) {
	f := newSizingFx(t)
	pa, fa := f.project(8)
	entered, release := f.hold()
	if err := f.size([]string{pa}, false); err != nil {
		t.Fatal(err)
	}
	if got := recv(t, entered); got != fa[0] {
		t.Fatalf("walking %s, want %s", got, fa[0])
	}
	for _, force := range []bool{false, true} {
		if err := f.size([]string{pa}, force); err != nil {
			t.Fatal(err)
		}
	}
	if s := f.s.Report().Sizing; s == nil || s.Walking != pa || len(s.Queued) != 0 || s.Total != 1 {
		t.Fatalf("sizing %+v, want the walk joined: nothing queued, still 1 in all", s)
	}
	release()
	f.idle()
	if got := f.walks(); !slices.Equal(got, fa) {
		t.Fatalf("walked %v, want exactly one walk of %v", got, fa)
	}
	select {
	case again := <-entered:
		t.Fatalf("a second walk began on %s", again)
	default:
	}
}

func TestSizingCountsDoneAndTotalSinceTheQueueWasLastIdle(t *testing.T) {
	f := newSizingFx(t)
	pa, _ := f.project(1)
	pb, _ := f.project(2)
	pc, _ := f.project(3)
	entered, release := f.hold()
	if err := f.size([]string{pa, pb}, true); err != nil {
		t.Fatal(err)
	}
	recv(t, entered)
	if s := f.s.Report().Sizing; s.Done != 0 || s.Total != 2 {
		t.Fatalf("sizing %+v, want 0 of 2", s)
	}
	if err := f.size([]string{pc}, false); err != nil { // a row open not in the queue adds one
		t.Fatal(err)
	}
	if s := f.s.Report().Sizing; s.Done != 0 || s.Total != 3 {
		t.Fatalf("sizing %+v, want 0 of 3", s)
	}
	release()
	f.idle()
	entered2, release2 := f.hold()
	if err := f.size([]string{pa}, true); err != nil {
		t.Fatal(err)
	}
	recv(t, entered2)
	if s := f.s.Report().Sizing; s.Done != 0 || s.Total != 1 {
		t.Fatalf("sizing %+v, want both counts reset when the queue emptied: 0 of 1", s)
	}
	release2()
	f.idle()
}

func TestSizingStopLetsTheWalkInProgressFinishAndEmptiesTheQueue(t *testing.T) {
	f := newSizingFx(t)
	pa, fa := f.project(6)
	_, fb := f.project(7)
	_, fc := f.project(8)
	entered, release := f.hold()
	if err := f.size(nil, true); err != nil {
		t.Fatal(err)
	}
	recv(t, entered)
	f.s.StopSizing()
	s := f.s.Report().Sizing
	if s == nil || s.Walking != pa || len(s.Queued) != 0 || s.Done != 0 || s.Total != 1 {
		t.Fatalf("sizing %+v, want the walk in progress kept and the queue empty: 0 of 1", s)
	}
	if pubs := f.pub.all(); pubs[len(pubs)-1].Sizing == nil || len(pubs[len(pubs)-1].Sizing.Queued) != 0 {
		t.Fatal("Stop must publish the emptied queue at once, not when the walk ends")
	}
	release()
	f.idle()
	if got := f.walks(); !slices.Equal(got, fa) {
		t.Fatalf("walked %v, want only the walk in progress", got)
	}
	if k, _ := f.kept(fa[0]); k.Bytes != 6 {
		t.Fatalf("the walk in progress must land its size, got %+v", k)
	}
	if _, ok := f.kept(fb[0]); ok {
		t.Fatal("a project dropped from the queue must not be sized")
	}
	if _, ok := f.kept(fc[0]); ok {
		t.Fatal("a project dropped from the queue must not be sized")
	}
	if pubs := f.pub.all(); pubs[len(pubs)-1].Sizing != nil {
		t.Fatalf("last published Sizing %+v, want nil once the walk ended", pubs[len(pubs)-1].Sizing)
	}
	// a Stop with nothing running does nothing
	f.s.StopSizing()
	if f.s.Report().Sizing != nil {
		t.Fatal("Stop with nothing queued must leave the queue idle")
	}
}

func TestSizingIsNilOnceIdleAndLeftOutOfTheReportJSON(t *testing.T) {
	f := newSizingFx(t)
	p, _ := f.project(2)
	if f.s.Report().Sizing != nil {
		t.Fatal("nothing queued: Sizing must be nil")
	}
	entered, release := f.hold()
	if err := f.size([]string{p}, false); err != nil {
		t.Fatal(err)
	}
	recv(t, entered)
	busy, err := json.Marshal(f.s.Report())
	if err != nil || !strings.Contains(string(busy), `"sizing":{"queued":[],"walking":`) {
		t.Fatalf("busy report %s (%v), want sizing with queued as an empty list and the walking project", busy, err)
	}
	release()
	f.idle()
	raw, err := json.Marshal(f.s.Report())
	if err != nil || strings.Contains(string(raw), `"sizing"`) {
		t.Fatalf("idle report %s (%v), want no sizing key", raw, err)
	}
}

func TestSizingPublishesNilWhenTheLastProjectLeftTheQueueSkipped(t *testing.T) {
	f := newSizingFx(t)
	pa, fa := f.project(3) // stale: never sized
	pb, fb := f.project(4)
	f.keep(fb[0], 44, time.Hour) // fresh
	entered, release := f.hold()
	if err := f.size([]string{pa}, false); err != nil {
		t.Fatal(err)
	}
	recv(t, entered)
	if err := f.size([]string{pb}, false); err != nil {
		t.Fatal(err)
	}
	if s := f.s.Report().Sizing; s.Walking != pa || !slices.Equal(s.Queued, []string{pb}) || s.Total != 2 {
		t.Fatalf("sizing %+v, want a walking and b queued behind it", s)
	}
	release()
	f.idle()
	pubs := f.pub.all()
	if last := pubs[len(pubs)-1]; last.Sizing != nil {
		t.Fatalf("last published Sizing %+v, want nil: the queue ended on a skipped project and Stop sizing would stay stuck", last.Sizing)
	}
	if !slices.ContainsFunc(pubs, func(r StorageReport) bool { return r.Sizing != nil && r.Sizing.Done == 1 && r.Sizing.Total == 2 }) {
		t.Fatal("no published report counted the first project done")
	}
	if got := f.walks(); !slices.Equal(got, fa) {
		t.Fatalf("walked %v, want only the stale project", got)
	}
	if k, _ := f.kept(fb[0]); k.Bytes != 44 {
		t.Fatalf("the fresh size must stay as it was, got %+v", k)
	}
}

func TestSizingAnEnvWithNoDataDirWritesNoFile(t *testing.T) {
	cwd := t.TempDir()
	t.Chdir(cwd)
	f := newSizingFx(t)
	f.env.DataDir = ""
	p, _ := f.project(3)
	if err := f.size([]string{p}, true); err != nil {
		t.Fatal(err)
	}
	f.idle()
	if entries, _ := os.ReadDir(cwd); len(entries) != 0 {
		t.Fatalf("a stray file landed in the working dir: %v", entries)
	}
	if got := f.walks(); len(got) != 0 {
		t.Fatalf("walked %v: with nowhere to keep a size a walk is wasted", got)
	}
}

func TestSizingAWalkThatLandsDuringAScanSurvivesTheScansResult(t *testing.T) {
	f := newSizingFx(t)
	p, folders := f.project(12)
	gate := make(chan struct{})
	slow := &fakeProvider{cat: CategoryBuildOutput, gate: gate, rep: report(CategoryBuildOutput,
		[]StorageItem{{ID: folders[0], Kind: KindBuild, Label: "node_modules", Detail: p, Path: folders[0]}}, nil)}
	f.s.providers = []provider{slow}
	f.s.Rescan(context.Background())
	waitFor(t, func() bool { return slow.scans.Load() == 1 })
	if err := f.size([]string{p}, false); err != nil {
		t.Fatal(err)
	}
	f.idle()
	if it := itemByID(f.category().Items, folders[0]); it.Bytes != 12 {
		t.Fatalf("%+v, want the walk's size in the report while the scan still runs", it)
	}
	close(gate)
	waitFor(t, func() bool { return !f.s.Report().Scanning })
	if it := itemByID(f.category().Items, folders[0]); it.Bytes != 12 || it.SizedTs != sizingBase.UnixMilli() {
		t.Fatalf("%+v, want the scan's older read (0 bytes) not to undo the walk", it)
	}
	if k, ok := f.kept(folders[0]); !ok || k.Bytes != 12 {
		t.Fatalf("kept %+v, want the walk's entry to outlive the scan's drop of unlisted folders", k)
	}
	pubs := f.pub.all()
	last, _ := findCategory(pubs[len(pubs)-1].Categories, CategoryBuildOutput)
	if last.Bytes != 12 {
		t.Fatalf("the report the scan ends on has %d bytes, want 12", last.Bytes)
	}
}
