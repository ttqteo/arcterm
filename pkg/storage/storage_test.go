// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package storage

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"sync"
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

func TestRescanPublishesEachCategoryAsItLands(t *testing.T) {
	fast := &fakeProvider{cat: CategoryRunWorktrees, rep: report(CategoryRunWorktrees, []StorageItem{{ID: "x", Bytes: 5}}, nil)}
	gate := make(chan struct{})
	slow := &fakeProvider{cat: CategoryBuildOutput, gate: gate, rep: report(CategoryBuildOutput, nil, nil)}
	got := make(chan StorageReport, 4)
	s := &Scanner{env: testEnv(t), providers: []provider{fast, slow}, publish: func(r StorageReport) { got <- r }}
	s.Rescan(context.Background())
	first := <-got
	if !first.Scanning || first.ScannedTs != 0 || len(first.Categories) != 1 || first.Categories[0].Category != CategoryRunWorktrees {
		t.Fatalf("got %+v, want the fast category alone, still scanning and not yet stamped", first)
	}
	close(gate)
	last := <-got
	if last.Scanning || last.ScannedTs == 0 || len(last.Categories) != 2 {
		t.Fatalf("got %+v, want both categories, stamped, the scan over", last)
	}
	if len(first.Categories) != 1 {
		t.Fatal("a published report must not change after it went out")
	}
}

func TestScanParallelMapKeepsTheOrderOfItsItemsAndBoundsItsWorkers(t *testing.T) {
	items := make([]int, 60)
	for i := range items {
		items[i] = i
	}
	var active, peak atomic.Int32
	got := parallelMap(items, 3, func(n int) int {
		cur := active.Add(1)
		for p := peak.Load(); cur > p && !peak.CompareAndSwap(p, cur); p = peak.Load() {
		}
		runtime.Gosched()
		active.Add(-1)
		return n * n
	})
	if len(got) != len(items) {
		t.Fatalf("got %d results, want %d", len(got), len(items))
	}
	for i, g := range got {
		if g != i*i {
			t.Fatalf("result %d = %d, want %d: results follow the items, not the order they finished", i, g, i*i)
		}
	}
	if p := peak.Load(); p > 3 {
		t.Fatalf("%d at once, want at most 3", p)
	}
	if got := parallelMap([]int(nil), 3, func(n int) int { return n }); len(got) != 0 {
		t.Fatalf("no items gave %v", got)
	}
}

func TestScanParallelMapRunsUpToItsLimitAtOnce(t *testing.T) {
	var begun sync.WaitGroup
	begun.Add(3)
	all := make(chan struct{})
	go func() { begun.Wait(); close(all) }()
	got := parallelMap([]int{1, 2, 3}, 3, func(n int) int {
		begun.Done()
		select {
		case <-all:
			return n
		case <-time.After(5 * time.Second):
			return -1 // the others never began: the items ran one after another
		}
	})
	if !slices.Equal(got, []int{1, 2, 3}) {
		t.Fatalf("got %v, want all three to run at once", got)
	}
}

func TestScanParallelMapAPanicInOneItemLeavesItsResultZeroAndFinishesTheRest(t *testing.T) {
	got := parallelMap([]int{1, 2, 3, 4}, 2, func(n int) int {
		if n == 2 {
			panic("boom")
		}
		return n
	})
	if !slices.Equal(got, []int{1, 0, 3, 4}) {
		t.Fatalf("got %v, want the panicking item zero and the rest done", got)
	}
}

// walkFake is a background category (the package caches' kind: a Rescan does not wait for it) whose walk a test holds
// by its gate.
type walkFake struct{ fakeProvider }

func (*walkFake) background() string { return "fake caches" }

func newWalkFake(gate chan struct{}) *walkFake {
	return &walkFake{fakeProvider{cat: CategoryPackageCaches, gate: gate, rep: report(CategoryPackageCaches,
		[]StorageItem{{ID: "npm", Kind: KindCache, Label: "npm cache", Bytes: 30, Cleanable: true}}, nil)}}
}

// onceClose closes ch the first time it is called, and again is a no-op; a test's cleanup calls it too, so no walk is
// left held.
func onceClose(t *testing.T, ch chan struct{}) func() {
	t.Helper()
	var once sync.Once
	release := func() { once.Do(func() { close(ch) }) }
	t.Cleanup(release)
	return release
}

func hasCategory(r StorageReport, c StorageCategory) bool {
	_, ok := findCategory(r.Categories, c)
	return ok
}

// walkScanner is a Scanner over a fast category and a held background walk.
func walkScanner(t *testing.T) (s *Scanner, fast *fakeProvider, caches *walkFake, pub *publishedReports, release func()) {
	t.Helper()
	gate := make(chan struct{})
	release = onceClose(t, gate)
	fast = &fakeProvider{cat: CategoryRunWorktrees, rep: report(CategoryRunWorktrees, []StorageItem{{ID: "x", Bytes: 5}}, nil)}
	caches = newWalkFake(gate)
	pub = &publishedReports{}
	s = &Scanner{env: testEnv(t), providers: []provider{fast, caches}, publish: pub.add}
	t.Cleanup(func() { waitFor(t, func() bool { return !s.Report().Scanning }) })
	return s, fast, caches, pub, release
}

func TestScanEndsWhileTheCachesWalkIsHeldAndPublishesTheirCategoryWhenItLands(t *testing.T) {
	s, _, caches, pub, release := walkScanner(t)
	s.Rescan(context.Background())
	waitFor(t, func() bool { return caches.scans.Load() == 1 && !s.Report().Scanning })

	r := s.Report()
	if r.ScannedTs == 0 {
		t.Fatal("the scan ended with the walk held: it must be stamped")
	}
	if want := []StorageCategory{CategoryRunWorktrees}; !slices.Equal(categoryNames(r.Categories), want) {
		t.Fatalf("categories %v, want %v: a first scan has no package caches until the walk lands", categoryNames(r.Categories), want)
	}
	pubs := pub.all()
	if last := pubs[len(pubs)-1]; last.Scanning || last.ScannedTs != r.ScannedTs || hasCategory(last, CategoryPackageCaches) {
		t.Fatalf("last published %+v, want the scan's end: stamped, not scanning, no package caches", last)
	}

	release()
	waitFor(t, func() bool { return hasCategory(s.Report(), CategoryPackageCaches) })
	waitFor(t, func() bool {
		pubs := pub.all()
		return hasCategory(pubs[len(pubs)-1], CategoryPackageCaches)
	})
	got := s.Report()
	if want := []StorageCategory{CategoryRunWorktrees, CategoryPackageCaches}; !slices.Equal(categoryNames(got.Categories), want) {
		t.Fatalf("categories %v, want %v (provider order)", categoryNames(got.Categories), want)
	}
	if got.ScannedTs != r.ScannedTs || got.Scanning {
		t.Fatalf("report %+v: the walk landing leaves the scan's time and does not start a scan", got)
	}
	if c, _ := findCategory(got.Categories, CategoryPackageCaches); c.Bytes != 30 || len(c.Items) != 1 {
		t.Fatalf("package caches %+v, want the walk's measure", c)
	}
}

func TestScanDuringAHeldCachesWalkStartsNoSecondWalk(t *testing.T) {
	s, fast, caches, _, release := walkScanner(t)
	s.Rescan(context.Background())
	waitFor(t, func() bool { return caches.scans.Load() == 1 && !s.Report().Scanning })
	s.Rescan(context.Background())
	s.Rescan(context.Background()) // a second ask during the scan only follows it once
	waitFor(t, func() bool { return fast.scans.Load() == 3 && !s.Report().Scanning })
	if n := caches.scans.Load(); n != 1 {
		t.Fatalf("the caches were walked %d times while the first walk was held, want 1", n)
	}

	release()
	waitFor(t, func() bool { return hasCategory(s.Report(), CategoryPackageCaches) })
	// the walk is over: the next scan hands the caches to a new one
	s.Rescan(context.Background())
	waitFor(t, func() bool { return caches.scans.Load() == 2 })
}

func TestScanKeepsACachesWalkThatLandedDuringIt(t *testing.T) {
	s, fast, caches, pub, release := walkScanner(t)
	s.Rescan(context.Background())
	waitFor(t, func() bool { return caches.scans.Load() == 1 && !s.Report().Scanning })

	held := make(chan struct{})
	releaseScan := onceClose(t, held)
	fast.gate = held // the next scan stops in its first category
	s.Rescan(context.Background())
	waitFor(t, func() bool { return fast.scans.Load() == 2 })
	if !s.Report().Scanning {
		t.Fatal("the second scan must still be running: nothing below proves the point otherwise")
	}

	release() // the first walk lands while the second scan runs
	waitFor(t, func() bool { return hasCategory(s.Report(), CategoryPackageCaches) })
	releaseScan()
	waitFor(t, func() bool { return !s.Report().Scanning })

	got := s.Report()
	if c, ok := findCategory(got.Categories, CategoryPackageCaches); !ok || c.Bytes != 30 {
		t.Fatalf("categories %v: the scan's end undid the walk that landed during it", categoryNames(got.Categories))
	}
	pubs := pub.all()
	if last := pubs[len(pubs)-1]; !hasCategory(last, CategoryPackageCaches) || last.Scanning {
		t.Fatalf("the last report out is %+v, want the scan's end with the walk's caches", last)
	}
}

func TestScanNowMeasuresTheCachesInlineAndStartsNoWalk(t *testing.T) {
	s, _, caches, _, release := walkScanner(t)
	release() // ScanNow waits for the caches: there is no walk to hold it apart from
	r := s.ScanNow(context.Background())
	if want := []StorageCategory{CategoryRunWorktrees, CategoryPackageCaches}; !slices.Equal(categoryNames(r.Categories), want) {
		t.Fatalf("categories %v, want %v", categoryNames(r.Categories), want)
	}
	if n := caches.scans.Load(); n != 1 {
		t.Fatalf("measured %d times, want once, inline", n)
	}
}

func TestScanHandsOnlyThePackageCachesToABackgroundWalk(t *testing.T) {
	var background []StorageCategory
	for _, p := range defaultProviders() {
		if _, ok := p.(backgroundProvider); ok {
			background = append(background, p.category())
		}
	}
	if want := []StorageCategory{CategoryPackageCaches}; !slices.Equal(background, want) {
		t.Fatalf("background categories %v, want %v", background, want)
	}
}

func TestPackageCachesCleanMeasuresThemInlineAndLandsThem(t *testing.T) {
	s, fast, caches, pub, release := walkScanner(t)
	release() // the rescan Clean starts hands the caches to a walk that is not held
	res, err := s.Clean(context.Background(), CategoryPackageCaches, []string{"npm"}, CleanOpts{})
	if err != nil || len(res.Cleaned) != 1 {
		t.Fatalf("got %+v, %v; want the cache cleaned", res, err)
	}
	// the inline re-measure lands before Clean returns: no wait for a walk
	pubs := pub.all()
	if len(pubs) == 0 || !hasCategory(pubs[0], CategoryPackageCaches) {
		t.Fatalf("first published %+v, want Clean's own re-measure of the caches", pubs)
	}
	waitFor(t, func() bool { return fast.scans.Load() == 1 && caches.scans.Load() >= 2 && !s.Report().Scanning })
}

// cleanedWalkFake is a background category whose first measure (the walk) holds a snapshot from before a clean, and
// whose later ones (Clean's own re-measure) see what the clean left.
type cleanedWalkFake struct {
	fakeProvider
	before, after StorageCategoryReport
}

func (*cleanedWalkFake) background() string { return "fake caches" }

func (f *cleanedWalkFake) measure(ctx context.Context, env *Env) StorageCategoryReport {
	if f.scans.Add(1) == 1 {
		<-f.gate
		return f.before
	}
	return f.after
}

func TestScanDiscardsACachesWalkThatCategoryWasCleanedDuring(t *testing.T) {
	gate := make(chan struct{})
	release := onceClose(t, gate)
	fast := &fakeProvider{cat: CategoryRunWorktrees, rep: report(CategoryRunWorktrees, nil, nil)}
	caches := &cleanedWalkFake{
		fakeProvider: fakeProvider{cat: CategoryPackageCaches, gate: gate},
		before:       report(CategoryPackageCaches, []StorageItem{{ID: "npm", Bytes: 30}, {ID: "pip", Bytes: 4}}, nil),
		after:        report(CategoryPackageCaches, []StorageItem{{ID: "pip", Bytes: 4}}, nil),
	}
	s := &Scanner{env: testEnv(t), providers: []provider{fast, caches}}
	t.Cleanup(func() { waitFor(t, func() bool { return !s.Report().Scanning }) })
	s.Rescan(context.Background())
	waitFor(t, func() bool { return caches.scans.Load() == 1 && !s.Report().Scanning }) // the walk is held

	if _, err := s.Clean(context.Background(), CategoryPackageCaches, []string{"npm"}, CleanOpts{}); err != nil {
		t.Fatal(err)
	}
	waitFor(t, func() bool { return fast.scans.Load() == 2 && !s.Report().Scanning }) // the rescan Clean started is over
	cats := func() []StorageItem {
		c, _ := findCategory(s.Report().Categories, CategoryPackageCaches)
		return c.Items
	}
	if got := cats(); len(got) != 1 || got[0].ID != "pip" {
		t.Fatalf("package caches %v after Clean, want its re-measure (pip alone)", got)
	}
	release()
	waitFor(t, func() bool {
		s.mu.Lock()
		defer s.mu.Unlock()
		return !s.walking[CategoryPackageCaches]
	})
	if got := cats(); len(got) != 1 || got[0].ID != "pip" {
		t.Fatalf("package caches %v after the old walk ended, want the clean's re-measure kept: that walk read the tree before the clean", got)
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
	// Clean publishes the re-measured category at once, then the rescan publishes when it ends.
	waitFor(t, func() bool { return published.Load() == 2 && !s.Report().Scanning })
	if _, err := s.Clean(context.Background(), "nope", nil, CleanOpts{}); err == nil {
		t.Fatal("an unknown category must be an error")
	}
}

// shrinkingProvider measures `after` once it has cleaned, like a category whose cleaned items are gone.
type shrinkingProvider struct {
	fakeProvider
	after StorageCategoryReport
}

func (p *shrinkingProvider) clean(ctx context.Context, env *Env, ids []string, opts CleanOpts) StorageCleanResult {
	res := p.fakeProvider.clean(ctx, env, ids, opts)
	p.rep = p.after
	return res
}

// publishedReports records what a scanner published, in order.
type publishedReports struct {
	mu   sync.Mutex
	reps []StorageReport
}

func (p *publishedReports) add(r StorageReport) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.reps = append(p.reps, r)
}

func (p *publishedReports) all() []StorageReport {
	p.mu.Lock()
	defer p.mu.Unlock()
	return slices.Clone(p.reps)
}

func categoryNames(cats []StorageCategoryReport) []StorageCategory {
	names := make([]StorageCategory, len(cats))
	for i, c := range cats {
		names[i] = c.Category
	}
	return names
}

// cleanWithBlockedRescan seeds a report, cleans category `cleaned` of providers (the first one's measure blocks, so
// the rescan Clean starts cannot end), and returns the scanner and what it published, the rescan still running.
func cleanWithBlockedRescan(t *testing.T, providers []provider, gate chan struct{}, seed StorageReport, cleaned StorageCategory) (*Scanner, *publishedReports) {
	t.Helper()
	pub := &publishedReports{}
	s := &Scanner{env: testEnv(t), providers: providers, publish: pub.add, report: seed}
	t.Cleanup(func() {
		select {
		case <-gate:
		default:
			close(gate)
		}
		waitFor(t, func() bool { return !s.Report().Scanning })
	})
	if _, err := s.Clean(context.Background(), cleaned, []string{"x"}, CleanOpts{}); err != nil {
		t.Fatal(err)
	}
	first, ok := providers[0].(*fakeProvider)
	if !ok {
		t.Fatal("the first provider must be the blocking fakeProvider")
	}
	waitFor(t, func() bool { return first.scans.Load() == 1 })
	if !s.Report().Scanning {
		t.Fatal("the rescan must still be running: nothing below proves the point otherwise")
	}
	return s, pub
}

func TestCleanReMeasuresTheCleanedCategoryBeforeTheRescanEnds(t *testing.T) {
	gate := make(chan struct{})
	a := &fakeProvider{cat: CategoryRunWorktrees, gate: gate, rep: report(CategoryRunWorktrees, []StorageItem{{ID: "a", Bytes: 1}}, nil)}
	oldB := report(CategorySessions, []StorageItem{{ID: "x", Bytes: 50, Cleanable: true}}, nil)
	newB := report(CategorySessions, []StorageItem{{ID: "y", Bytes: 7}}, nil)
	b := &shrinkingProvider{fakeProvider: fakeProvider{cat: CategorySessions, rep: oldB}, after: newB}
	seed := StorageReport{ScannedTs: 123, Categories: []StorageCategoryReport{
		report(CategoryRunWorktrees, []StorageItem{{ID: "old-a", Bytes: 9}}, nil), oldB,
	}}
	s, pub := cleanWithBlockedRescan(t, []provider{a, b}, gate, seed, CategorySessions)

	got := s.Report()
	if want := []StorageCategory{CategoryRunWorktrees, CategorySessions}; !slices.Equal(categoryNames(got.Categories), want) {
		t.Fatalf("categories %v, want %v (provider order)", categoryNames(got.Categories), want)
	}
	if gotA := got.Categories[0]; gotA.Bytes != 9 {
		t.Fatalf("category A = %+v, want the last scan's entry kept, not the blocked rescan's", gotA)
	}
	if gotB := got.Categories[1]; gotB.Bytes != 7 || len(gotB.Items) != 1 || gotB.Items[0].ID != "y" {
		t.Fatalf("category B = %+v, want its new measure (7 bytes, item y)", gotB)
	}
	reps := pub.all()
	if len(reps) != 1 {
		t.Fatalf("published %d reports before the rescan ended, want exactly the re-measure's", len(reps))
	}
	if cats := reps[0].Categories; len(cats) != 2 || cats[1].Bytes != 7 {
		t.Fatalf("published %+v, want B's new measure in the re-measure's report", cats)
	}
}

func TestCleanAddsTheCleanedCategoryInItsPlaceWhenTheReportHadNone(t *testing.T) {
	gate := make(chan struct{})
	a := &fakeProvider{cat: CategoryRunWorktrees, gate: gate, rep: report(CategoryRunWorktrees, nil, nil)}
	newB := report(CategorySessions, []StorageItem{{ID: "y", Bytes: 7}}, nil)
	b := &shrinkingProvider{fakeProvider: fakeProvider{cat: CategorySessions}, after: newB}
	c := &fakeProvider{cat: CategoryHousekeeping, rep: report(CategoryHousekeeping, nil, nil)}
	seed := StorageReport{ScannedTs: 123, Categories: []StorageCategoryReport{
		report(CategoryRunWorktrees, []StorageItem{{ID: "old-a", Bytes: 9}}, nil),
		report(CategoryHousekeeping, []StorageItem{{ID: "old-c", Bytes: 3}}, nil),
	}}
	s, _ := cleanWithBlockedRescan(t, []provider{a, b, c}, gate, seed, CategorySessions)

	got := s.Report().Categories
	if want := []StorageCategory{CategoryRunWorktrees, CategorySessions, CategoryHousekeeping}; !slices.Equal(categoryNames(got), want) {
		t.Fatalf("categories %v, want %v (B added between A and C)", categoryNames(got), want)
	}
	if got[1].Bytes != 7 {
		t.Fatalf("category B = %+v, want its new measure", got[1])
	}
	if got[0].Bytes != 9 || got[2].Bytes != 3 {
		t.Fatalf("categories A, C = %+v, %+v; want the last scan's entries kept", got[0], got[2])
	}
}

func TestCleanKeepsTheLastFullScansTime(t *testing.T) {
	gate := make(chan struct{})
	a := &fakeProvider{cat: CategoryRunWorktrees, gate: gate, rep: report(CategoryRunWorktrees, nil, nil)}
	b := &shrinkingProvider{fakeProvider: fakeProvider{cat: CategorySessions}, after: report(CategorySessions, []StorageItem{{ID: "y", Bytes: 7}}, nil)}
	seed := StorageReport{ScannedTs: 123}
	s, pub := cleanWithBlockedRescan(t, []provider{a, b}, gate, seed, CategorySessions)

	if ts := s.Report().ScannedTs; ts != 123 {
		t.Fatalf("ScannedTs = %d after Clean's re-measure, want the last full scan's 123", ts)
	}
	if reps := pub.all(); len(reps) != 1 || reps[0].ScannedTs != 123 {
		t.Fatalf("published %+v, want one report still stamped 123", reps)
	}
}
