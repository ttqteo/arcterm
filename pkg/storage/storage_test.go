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
