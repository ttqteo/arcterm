// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/storage"
)

func storageTestReport() *storage.StorageReport {
	return &storage.StorageReport{
		ScannedTs: time.Date(2026, 10, 28, 14, 2, 0, 0, time.UTC).UnixMilli(),
		Categories: []storage.StorageCategoryReport{
			{Category: storage.CategoryRunWorktrees, Bytes: 3<<30 + 2048 + 10, CleanableBytes: 2048, Items: []storage.StorageItem{
				{ID: "C:/wt/a", Kind: storage.KindWorktree, Label: "fix x", Bytes: 2048, Cleanable: true},
				{ID: "C:/wt/c", Kind: storage.KindWorktree, Label: "half done", Bytes: 3 << 30, Guarded: true, Reason: "has uncommitted changes"},
				{ID: "C:/wt/live", Kind: storage.KindWorktree, Label: "live", Bytes: 10, Reason: "run still running"},
			}},
			{Category: storage.CategorySessions},
		},
	}
}

func TestStorageCleanableIdsSkipsGuardedAndKept(t *testing.T) {
	r := storageTestReport()
	c := &r.Categories[0]
	c.Items = append(c.Items, storage.StorageItem{ID: "both", Cleanable: true, Guarded: true})
	if got := storageCleanableIds(c); !slices.Equal(got, []string{"C:/wt/a"}) {
		t.Fatalf("got %v", got)
	}
}

func TestStorageCategoryNamesAnUnknownOne(t *testing.T) {
	r := storageTestReport()
	if _, err := storageCategory(r, "runworktrees"); err != nil {
		t.Fatal(err)
	}
	_, err := storageCategory(r, "trees")
	if err == nil || !strings.Contains(err.Error(), "runworktrees") {
		t.Fatalf("want an error listing the categories, got %v", err)
	}
}

func TestFormatStorageSize(t *testing.T) {
	cases := map[int64]string{0: "0 B", 1023: "1023 B", 1024: "1.0 KB", 1536: "1.5 KB", 3 << 30: "3.0 GB"}
	for n, want := range cases {
		if got := formatStorageSize(n); got != want {
			t.Errorf("formatStorageSize(%d) = %q, want %q", n, got, want)
		}
	}
}

func TestFormatStorageReportListsBiggestFirstWithIdsAndReasons(t *testing.T) {
	out := formatStorageReport(storageTestReport(), time.UTC)
	for _, want := range []string{
		"scanned 2026-10-28 14:02",
		"runworktrees: 3.0 GB, 2.0 KB cleanable",
		"guarded (delete only)  half done",
		"id C:/wt/c",
		"has uncommitted changes",
		"cleanable  fix x",
		"kept  live",
		"sessions: 0 B, 0 B cleanable",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("missing %q in:\n%s", want, out)
		}
	}
	if strings.Index(out, "half done") > strings.Index(out, "fix x") {
		t.Errorf("biggest item should come first:\n%s", out)
	}
}

func TestFormatStorageReportBeforeTheFirstScan(t *testing.T) {
	if out := formatStorageReport(&storage.StorageReport{}, time.UTC); !strings.Contains(out, "wsh storage scan --wait") {
		t.Fatalf("got %q", out)
	}
	if out := formatStorageReport(&storage.StorageReport{Scanning: true}, time.UTC); !strings.Contains(out, "first scan is running") {
		t.Fatalf("got %q", out)
	}
}

func TestFormatStorageCleanNamesSkips(t *testing.T) {
	out := formatStorageClean(&storage.StorageCleanResult{
		Reclaimed: 2048,
		Cleaned:   []string{"C:/wt/a"},
		Skipped:   []storage.StorageSkipped{{ID: "C:/wt/c", Reason: "has uncommitted changes"}},
	})
	if !strings.Contains(out, "cleaned 1, freed 2.0 KB") || !strings.Contains(out, "skipped C:/wt/c: has uncommitted changes") {
		t.Fatalf("got %q", out)
	}
}
