// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/council"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func TestCouncilCitesRoots(t *testing.T) {
	project := t.TempDir()
	doc := filepath.Join(project, "docs", "council", "2026-11-04-x.md")
	if got, err := councilCitesRoots(doc, nil); err != nil || len(got) != 1 || got[0] != project {
		t.Errorf("a saved report: %v, %v, want [%s]", got, err, project)
	}
	loose := filepath.Join(project, "notes", "x.md")
	if got, err := councilCitesRoots(loose, nil); err != nil || len(got) != 1 || got[0] != filepath.Dir(loose) {
		t.Errorf("a report elsewhere: %v, %v, want its folder", got, err)
	}
	other := t.TempDir()
	if got, err := councilCitesRoots(doc, []string{other, " ", project}); err != nil || len(got) != 2 || got[0] != other || got[1] != project {
		t.Errorf("--root: %v, %v, want [%s %s]", got, err, other, project)
	}
}

// A saved report is two files, the report and its .discussion.md side file: `wsh council cites` given either one reads the
// other too, the report first, and audits the two as one text, so the cites in the discussion count.
func TestCouncilCitesReadsTheSiblingFile(t *testing.T) {
	project := t.TempDir()
	dir := filepath.Join(project, "docs", "council")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	write := func(path, text string) {
		t.Helper()
		if err := os.WriteFile(path, []byte(text), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write(filepath.Join(project, "a.go"), "package a\n// the wake timer\n")
	write(filepath.Join(project, "b.go"), "package b\n// the idle sleep\n")
	report := filepath.Join(dir, "2026-11-23-x.md")
	side := council.SidePath(report)
	write(report, "# Council: x\n\n## Việc cần làm\n\nThe wake timer lives in a.go:2.\n")
	write(side, "# Council discussion: x\n\n## The discussion\n\n- **UX** proposes · P1 · Sleep\n  The idle sleep is in b.go:2.\n")

	want := "The wake timer lives in a.go:2.\n\n" // the report's text comes first, whichever file was given
	for _, given := range []string{report, side} {
		text, err := councilCitesText(given)
		if err != nil {
			t.Fatalf("%s: %v", given, err)
		}
		mainAt, sideAt := strings.Index(text, "a.go:2"), strings.Index(text, "b.go:2")
		if mainAt < 0 || sideAt < mainAt || !strings.Contains(text, want) {
			t.Errorf("given %s the text is not the report then the side file:\n%s", filepath.Base(given), text)
		}
		roots, err := councilCitesRoots(given, nil)
		if err != nil {
			t.Fatal(err)
		}
		if section := council.CiteCheckSection(text, roots); !strings.Contains(section, "2 places, cited 2 times") {
			t.Errorf("given %s the cite check read %q, want both files' cites", filepath.Base(given), section)
		}
	}

	// a report with no side file, as saved before the split, is read alone; one that does not exist is an error
	alone := filepath.Join(dir, "2026-11-01-old.md")
	write(alone, "# Council: old\n\nIt cites a.go:2.\n")
	if text, err := councilCitesText(alone); err != nil || text != "# Council: old\n\nIt cites a.go:2.\n" {
		t.Errorf("a report with no side file = %q, %v, want it alone", text, err)
	}
	if _, err := councilCitesText(filepath.Join(dir, "nope.md")); err == nil {
		t.Error("a report that is not there should be an error")
	}
	if _, err := councilCitesText(filepath.Join(dir, "nope.discussion.md")); err == nil {
		t.Error("a side file that is not there should be an error")
	}
}

func TestCouncilRepeatDecide(t *testing.T) {
	now := int64(1_762_250_000_000)
	prev := &council.Council{Id: "c-0411", Feature: "Chốt bài toán cho harnesspov solo", State: council.StateDone,
		Updated: now - 3_600_000, DocPath: "D:/thesis/docs/council/c.md", Harness: council.HarnessVersion}
	list := []*council.Council{prev}
	fresh := func() *wshrpc.CommandCouncilStartData {
		return &wshrpc.CommandCouncilStartData{Feature: "Chốt bài toán harnesspov solo"}
	}

	data := fresh()
	if text, err := councilRepeatDecide(list, data, "", false, now); err != nil || !strings.Contains(text, "Not started") {
		t.Fatalf("no reason: %q, %v, want a refusal", text, err)
	}
	data = fresh()
	if text, _ := councilRepeatDecide(list, data, "M5 has 60 cases now", false, now); text != "" ||
		data.RepeatOf != "c-0411" || data.RepeatWhy != council.RepeatNewEvidence || data.RepeatEvidence != "M5 has 60 cases now" ||
		data.RepeatDoc != prev.DocPath {
		t.Errorf("new evidence: %q, %+v", text, data)
	}
	data = fresh()
	if text, _ := councilRepeatDecide(list, data, "", true, now); text != "" || data.RepeatWhy != council.RepeatUpgraded {
		t.Errorf("upgraded: %q, %+v", text, data)
	}
	data = &wshrpc.CommandCouncilStartData{Feature: "Thiết kế giao diện cockpit"}
	if text, _ := councilRepeatDecide(list, data, "", false, now); text != "" || data.RepeatOf != "" {
		t.Errorf("another topic: %q, %+v", text, data)
	}
}
