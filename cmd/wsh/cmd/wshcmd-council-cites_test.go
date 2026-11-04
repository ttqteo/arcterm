// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
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
