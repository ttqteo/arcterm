// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

var memoryTestChanges = []wshrpc.MemChange{
	{Id: "2177c699aa", Kind: "trim", Title: "Drop shipped-fix narrative", Status: "open"},
	{Id: "2177d000bb", Kind: "delete", Title: "Repeats the global rule", Status: "applied", IndexDelta: wshrpc.MemIndexDelta{Lines: -1, Bytes: -194}},
	{Id: "748a33aacc", Kind: "move-to-doc", Title: "Belongs in AGENTS.md", Status: "conflict", ConflictFile: "MEMORY.md"},
	{Id: "0678ab0fdd", Kind: "delete", Title: "Shipped-feature record", Status: "kept"},
}

func TestResolveMemoryChange(t *testing.T) {
	c, err := resolveMemoryChange(memoryTestChanges, "2177c")
	if err != nil || c.Id != "2177c699aa" {
		t.Fatalf("unique prefix: %v %v", c.Id, err)
	}
	if _, err := resolveMemoryChange(memoryTestChanges, "2177"); err == nil || !strings.Contains(err.Error(), "matches 2") {
		t.Fatalf("ambiguous prefix: %v", err)
	}
	if _, err := resolveMemoryChange(memoryTestChanges, "ffff"); err == nil {
		t.Fatal("unknown id resolved")
	}
}

func TestFindMemoryProjectNamesKnownOnMiss(t *testing.T) {
	projects := []wshrpc.MemHygieneProject{{Project: "waveterm"}, {Project: "opal"}}
	if p, err := findMemoryProject(projects, "opal"); err != nil || p.Project != "opal" {
		t.Fatalf("hit: %v %v", p, err)
	}
	_, err := findMemoryProject(projects, "nope")
	if err == nil || !strings.Contains(err.Error(), "waveterm, opal") {
		t.Fatalf("miss: %v", err)
	}
}

func TestFormatMemoryChangesHidesDecidedUnlessAll(t *testing.T) {
	got := formatMemoryChanges(memoryTestChanges, false)
	if !strings.Contains(got, "2177c699  open") || !strings.Contains(got, "748a33aa  conflict") {
		t.Fatalf("pending missing:\n%s", got)
	}
	if strings.Contains(got, "applied") || strings.Contains(got, "kept") {
		t.Fatalf("decided shown without --all:\n%s", got)
	}
	all := formatMemoryChanges(memoryTestChanges, true)
	if !strings.Contains(all, "2177d000  applied   delete        Repeats the global rule  (index -1 lines, -194 bytes)") {
		t.Fatalf("--all row:\n%s", all)
	}
	if got := formatMemoryChanges(memoryTestChanges[1:2], false); got != "no pending changes\n" {
		t.Fatalf("none pending: %q", got)
	}
}

func TestFormatMemoryProjects(t *testing.T) {
	ts := time.Date(2026, 10, 14, 6, 33, 0, 0, time.UTC)
	got := formatMemoryProjects([]wshrpc.MemHygieneProject{{
		Project:   "waveterm",
		Memories:  60,
		Index:     wshrpc.MemIndexStats{Exists: true, Lines: 90, Bytes: 12774},
		CheckedAt: ts.UnixMilli(),
		LastError: "model call timed out",
		Changes:   memoryTestChanges,
	}, {Project: "opal", Checking: true}}, time.UTC)
	for _, want := range []string{
		"waveterm: 60 memories, index 90 lines / 12774 bytes, checked 2026-10-14 06:33, 2 pending\n",
		"  last check failed: model call timed out\n",
		"opal: 0 memories, index 0 lines / 0 bytes, never checked, 0 pending\n  checking now\n",
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("missing %q:\n%s", want, got)
		}
	}
}

func TestFormatMemoryChangeShowsEvidenceAndDiff(t *testing.T) {
	got := formatMemoryChange(wshrpc.MemChange{
		Id: "823643edee", Kind: "delete", Status: "open", Title: "Repeats the global rule",
		Evidence: []wshrpc.MemEvidence{{Text: "Read in 0 sessions"}, {Text: "Global CLAUDE.md has it", Code: "~/.claude/CLAUDE.md"}},
		Diffs:    []wshrpc.MemDiff{{Path: "MEMORY.md", Lines: []wshrpc.MemDiffLine{{Sign: "-", Text: "- [Cheap model](cheap.md)"}, {Text: "kept"}}}},
	})
	for _, want := range []string{
		"823643ed  delete  open\nRepeats the global rule\n",
		"  - Read in 0 sessions\n",
		"  - Global CLAUDE.md has it `~/.claude/CLAUDE.md`\n",
		"--- MEMORY.md\n- - [Cheap model](cheap.md)\n  kept\n",
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("missing %q:\n%s", want, got)
		}
	}
}

func TestFormatMemoryDecisionReportsConflict(t *testing.T) {
	got := formatMemoryDecision(memoryTestChanges, "748a33aacc")
	if !strings.Contains(got, "not applied, MEMORY.md changed since the check") {
		t.Fatalf("conflict: %s", got)
	}
	if got := formatMemoryDecision(memoryTestChanges, "2177d000bb"); got != "2177d000: applied  Repeats the global rule" {
		t.Fatalf("applied: %s", got)
	}
}
