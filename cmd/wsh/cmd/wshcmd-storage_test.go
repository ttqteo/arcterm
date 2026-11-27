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

// storageTestNow is the clock the sized texts are read against
var storageTestNow = time.Date(2026, 11, 27, 12, 0, 0, 0, time.UTC)

func daysAgo(n int) int64 { return storageTestNow.Add(-time.Duration(n) * 24 * time.Hour).UnixMilli() }

// storageBuildReport lists build output for three projects: A holds a folder sized 3 days ago and one sized 5 days ago,
// B was sized an hour ago, C never was.
func storageBuildReport() *storage.StorageReport {
	build := func(id, label, project string, bytes, sizedTs int64) storage.StorageItem {
		return storage.StorageItem{ID: id, Kind: storage.KindBuild, Label: label, Detail: project, Bytes: bytes, SizedTs: sizedTs, Cleanable: true}
	}
	return &storage.StorageReport{
		ScannedTs: storageTestNow.UnixMilli(),
		Categories: []storage.StorageCategoryReport{{Category: storage.CategoryBuildOutput, Items: []storage.StorageItem{
			build("C:/a/node_modules", "node_modules", "C:/a", 4<<20, daysAgo(3)),
			build("C:/a/target", "target", "C:/a", 1<<20, daysAgo(5)),
			build("C:/b/node_modules", "node_modules", "C:/b", 8<<20, storageTestNow.Add(-time.Hour).UnixMilli()),
			build("C:/c/dist", "dist", "C:/c", 0, 0),
		}}},
	}
}

func TestFormatStorageReportSaysWhichBuildSizesAreOld(t *testing.T) {
	out := formatStorageReport(storageBuildReport(), time.UTC, storageTestNow)
	for _, want := range []string{
		"node_modules  sized 3 days ago",
		"target  sized 5 days ago",
		"dist  not sized",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("missing %q in:\n%s", want, out)
		}
	}
	// project B's folder was sized an hour ago (and is the biggest, so its line is the first item): a fresh size says
	// nothing, its line ends at the label
	for line := range strings.SplitSeq(out, "\n") {
		if strings.Contains(line, "8.0 MB") && !strings.HasSuffix(line, "cleanable  node_modules") {
			t.Errorf("a fresh size should add nothing to its line, got %q", line)
		}
	}
	if !strings.Contains(out, "8.0 MB    cleanable  node_modules\n") {
		t.Errorf("missing the fresh folder's line in:\n%s", out)
	}
}

func TestFormatStorageReportAddsNoSizedTextOutsideBuildOutput(t *testing.T) {
	r := storageTestReport()
	r.Categories[0].Items[0].SizedTs = daysAgo(9) // a stray stamp on a worktree item is not a build size
	out := formatStorageReport(r, time.UTC, storageTestNow)
	if strings.Contains(out, "sized") {
		t.Errorf("only build output items carry sized text:\n%s", out)
	}
}

func TestStorageSizedNote(t *testing.T) {
	cases := []struct {
		ts   int64
		want string
	}{
		{0, "not sized"},
		{storageTestNow.Add(-23 * time.Hour).UnixMilli(), ""},
		{daysAgo(1), "sized 1 day ago"},
		{storageTestNow.Add(-47 * time.Hour).UnixMilli(), "sized 1 day ago"},
		{daysAgo(3), "sized 3 days ago"},
		{daysAgo(40), "sized 40 days ago"},
	}
	for _, c := range cases {
		if got := storageSizedNote(c.ts, storageTestNow); got != c.want {
			t.Errorf("storageSizedNote(%d) = %q, want %q", c.ts, got, c.want)
		}
	}
}

func TestStorageSizeWaitPrintoutForAFinishedQueue(t *testing.T) {
	out := formatStorageSizes(storageBuildReport(), nil, storageTestNow)
	want := []string{
		"build output sizes, 3 projects:",
		"8.0 MB    C:/b\n",                 // sized an hour ago: no age
		"5.0 MB    C:/a  sized 5 days ago", // the project's oldest kept size, the sum of its folders
		"0 B       C:/c  not sized",
	}
	for _, w := range want {
		if !strings.Contains(out, w) {
			t.Errorf("missing %q in:\n%s", w, out)
		}
	}
	if strings.Index(out, "C:/b") > strings.Index(out, "C:/a") || strings.Index(out, "C:/a") > strings.Index(out, "C:/c") {
		t.Errorf("biggest project first:\n%s", out)
	}
}

func TestStorageSizeWaitPrintoutKeepsTheNamedProjectsOnly(t *testing.T) {
	out := formatStorageSizes(storageBuildReport(), []string{"C:/c"}, storageTestNow)
	if !strings.Contains(out, "1 project:") || !strings.Contains(out, "C:/c  not sized") || strings.Contains(out, "C:/a") {
		t.Errorf("got:\n%s", out)
	}
	if out := formatStorageSizes(storageBuildReport(), []string{"C:/nope"}, storageTestNow); !strings.Contains(out, "no build output") {
		t.Errorf("got:\n%s", out)
	}
}

func TestStorageSizeProjectsAreNotSizedOnlyWhenNoFolderHasASize(t *testing.T) {
	r := storageBuildReport()
	// a project with one sized folder and one never sized: its size is the sized folder's, its age that folder's
	r.Categories[0].Items = append(r.Categories[0].Items, storage.StorageItem{
		ID: "C:/c/node_modules", Kind: storage.KindBuild, Label: "node_modules", Detail: "C:/c", SizedTs: daysAgo(2), Bytes: 1 << 20})
	out := formatStorageSizes(r, []string{"C:/c"}, storageTestNow)
	if !strings.Contains(out, "1.0 MB    C:/c  sized 2 days ago") {
		t.Errorf("got:\n%s", out)
	}
}

func TestStorageSizeQueuedPrintoutNamesTheForce(t *testing.T) {
	if out := formatStorageSizeQueued(1, false); !strings.Contains(out, "sizing 1 project in the background") || !strings.Contains(out, "skipped") {
		t.Errorf("got %q", out)
	}
	if out := formatStorageSizeQueued(12, true); !strings.Contains(out, "sizing 12 projects") || !strings.Contains(out, "--force") {
		t.Errorf("got %q", out)
	}
}

func TestStorageSizeWaitPollsUntilSizingIsNil(t *testing.T) {
	// between two projects of a queue Walking is "" with Queued set: that is not idle
	steps := []*storage.StorageSizing{
		{Queued: []string{"C:/b"}, Walking: "C:/a", Done: 0, Total: 2},
		{Queued: []string{"C:/b"}, Walking: "", Done: 1, Total: 2},
		{Walking: "C:/b", Done: 1, Total: 2},
		nil,
	}
	calls := 0
	next := func() (*storage.StorageReport, error) {
		r := &storage.StorageReport{ScannedTs: 1, Sizing: steps[min(calls, len(steps)-1)]}
		calls++
		return r, nil
	}
	r, err := storageWaitSizing(next, time.Millisecond, time.Minute)
	if err != nil || r.Sizing != nil || calls != len(steps) {
		t.Fatalf("calls %d, sizing %+v, err %v", calls, r.Sizing, err)
	}
}

func TestStorageSizeWaitGivesUpWithTheProgress(t *testing.T) {
	next := func() (*storage.StorageReport, error) {
		return &storage.StorageReport{Sizing: &storage.StorageSizing{Walking: "C:/a", Done: 3, Total: 12}}, nil
	}
	_, err := storageWaitSizing(next, time.Millisecond, 5*time.Millisecond)
	if err == nil || !strings.Contains(err.Error(), "3 of 12") {
		t.Fatalf("want an error with the progress, got %v", err)
	}
}

func TestStorageBuildProjectsKeepTheReportsOrder(t *testing.T) {
	var got []string
	for _, p := range storageBuildProjects(storageBuildReport(), nil) {
		got = append(got, p.path)
	}
	if !slices.Equal(got, []string{"C:/a", "C:/b", "C:/c"}) {
		t.Fatalf("got %v", got)
	}
}

func TestFormatStorageReportListsBiggestFirstWithIdsAndReasons(t *testing.T) {
	out := formatStorageReport(storageTestReport(), time.UTC, storageTestNow)
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
	if out := formatStorageReport(&storage.StorageReport{}, time.UTC, storageTestNow); !strings.Contains(out, "wsh storage scan --wait") {
		t.Fatalf("got %q", out)
	}
	if out := formatStorageReport(&storage.StorageReport{Scanning: true}, time.UTC, storageTestNow); !strings.Contains(out, "first scan is running") {
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
