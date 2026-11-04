// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package council

import (
	"strings"
	"testing"
	"time"
)

const repeatNow = int64(1_762_250_000_000) // 2025-11-04, any fixed instant

func doneCouncil(id, feature string, ago time.Duration) *Council {
	return &Council{Id: id, Feature: feature, State: StateDone, Harness: HarnessVersion,
		Updated: repeatNow - ago.Milliseconds(), DocPath: `D:\thesis\docs\council\` + id + ".md"}
}

// the thesis councils of 2026-10-31 to 11-04 were one direction under several wordings
func TestRecentLikeFindsTheSameTopicReworded(t *testing.T) {
	list := []*Council{
		doneCouncil("old", "Hướng harness harnesspov: vòng ngoài thích nghi quanh LLM để sinh PoV npm", 3*24*time.Hour),
		doneCouncil("new", "Hướng harness harnesspov vòng ngoài thích nghi quanh LLM", 24*time.Hour),
		doneCouncil("other", "Thiết kế giao diện cockpit cho agent", time.Hour),
	}
	got := RecentLike(list, "Hướng harness (harnesspov): vòng ngoài thích nghi quanh LLM", "", repeatNow)
	if got == nil || got.Id != "new" {
		t.Fatalf("RecentLike = %+v, want the newest like it", got)
	}
	if got := RecentLike(list, "Bảng giá cổ phiếu theo thời gian thực", "", repeatNow); got != nil {
		t.Errorf("an unrelated topic matched %s", got.Id)
	}
}

func TestRecentLikeSkipsOldFailedAndBenchCouncils(t *testing.T) {
	topic := "Chốt bài toán cho harnesspov solo sau M5 âm"
	old := doneCouncil("old", topic, 8*24*time.Hour)
	failed := doneCouncil("failed", topic, time.Hour)
	failed.State = StateFailed
	bench := doneCouncil("bench", topic, time.Hour)
	bench.Bench = true
	if got := RecentLike([]*Council{old, failed, bench}, topic, "", repeatNow); got != nil {
		t.Errorf("RecentLike = %s, want none", got.Id)
	}
}

func TestRepeatTextSaysWhatTheLastOneSaidAndWhetherTheCouncilChanged(t *testing.T) {
	prev := doneCouncil("c-0411", "Chốt bài toán cho harnesspov", time.Hour)
	prev.Summary = &CouncilSummary{Directions: []CouncilDirection{{Title: "Patch M5 to the full 60 cases",
		FirstStep: "Save each run's PoV code, then a 3-case pilot"}}}
	s := RepeatText(prev)
	for _, want := range []string{"c-0411", `D:\thesis\docs\council\c-0411.md`, "Patch M5 to the full 60 cases",
		"Its first step: Save each run's PoV code", "has not changed since", "--new-evidence", "--rerun-upgraded"} {
		if !strings.Contains(s, want) {
			t.Errorf("RepeatText lacks %q:\n%s", want, s)
		}
	}
	prev.Harness = "2026-11-02.1"
	if s := RepeatText(prev); !strings.Contains(s, "upgraded since: it ran on 2026-11-02.1, this one is "+HarnessVersion) {
		t.Errorf("an older harness is not named:\n%s", s)
	}
}

// new evidence is put in front of the panel with the earlier report; an upgrade re-run judges afresh
func TestRound1PromptCarriesTheNewEvidenceOnly(t *testing.T) {
	c := promptCouncil()
	c.RepeatOf, c.RepeatDoc = "c-0411", `D:\proj\docs\council\c-0411.md`
	c.RepeatWhy, c.RepeatEvidence = RepeatNewEvidence, "M5 now has all 60 cases"
	p := Round1Prompt(c, c.Experts[0])
	mustContain(t, "round 1", p, `its report is D:\proj\docs\council\c-0411.md`, "what is new since: M5 now has all 60 cases")
	c.RepeatWhy, c.RepeatEvidence = RepeatUpgraded, ""
	mustNotContain(t, "round 1", Round1Prompt(c, c.Experts[0]), "ran before")
	var b strings.Builder
	writeRunFacts(&b, c)
	mustContain(t, "run facts", b.String(), "- Repeats: c-0411, the council was upgraded since")
}
