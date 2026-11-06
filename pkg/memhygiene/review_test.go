// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package memhygiene

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func TestReviewReadsModifiedDateAndMovesIt(t *testing.T) {
	folder := t.TempDir()
	path := filepath.Join(folder, "a.md")
	writeFile(t, path, "---\nname: a\nmodified: 2026-01-02\n---\nrule\n")
	inv, err := ReadInventory(folder)
	if err != nil {
		t.Fatal(err)
	}
	want, _ := time.ParseInLocation(reviewDateFmt, "2026-01-02", time.Local)
	if inv.Memories[0].Touched != want.UnixMilli() {
		t.Fatalf("touched %d, want the modified date %d", inv.Memories[0].Touched, want.UnixMilli())
	}

	now := want.Add(60 * 24 * time.Hour)
	changes := ReviewChanges(inv, nil, true, now, nil, nil)
	if len(changes) != 1 || len(changes[0].Diffs) != 1 {
		t.Fatalf("want one review with the date's diff: %+v", changes)
	}
	if _, conflict, err := Apply(changes[0], t.TempDir(), now); err != nil || conflict != "" {
		t.Fatalf("apply: %v %q", err, conflict)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(got), "modified: "+now.Format(reviewDateFmt)+"\n") || !strings.HasSuffix(string(got), "---\nrule\n") {
		t.Fatalf("Still true didn't move only the date: %q", got)
	}
}

func TestReviewSkipsFreshAndTakenMemories(t *testing.T) {
	now := time.Now()
	old := now.Add(-31 * 24 * time.Hour).UnixMilli()
	inv := &Inventory{Folder: "f", Memories: []Memory{
		{Name: "fresh.md", Touched: now.UnixMilli()},
		{Name: "old.md", Touched: old},
		{Name: "taken.md", Touched: old},
		{Name: "warned.md", Touched: now.UnixMilli(), Evidence: []wshrpc.MemEvidence{{Tone: evidenceToneWarn, Text: "gone"}}},
	}}
	taken := []wshrpc.MemChange{{Kind: "trim", Status: splitStatusOpen, Op: wshrpc.MemOp{Folder: "f", Memories: []string{"taken.md"}}}}

	names := func(cs []wshrpc.MemChange) string {
		var out []string
		for _, c := range cs {
			out = append(out, c.Op.Memories[0])
		}
		return strings.Join(out, ",")
	}
	if got := names(ReviewChanges(inv, taken, true, now, nil, nil)); got != "old.md" {
		t.Fatalf("judged: reviews for %q, want old.md", got)
	}
	if got := names(ReviewChanges(inv, taken, false, now, nil, nil)); got != "old.md,warned.md" {
		t.Fatalf("not judged: reviews for %q, want old.md,warned.md", got)
	}
}
