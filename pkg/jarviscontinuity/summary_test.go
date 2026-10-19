// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jarviscontinuity

import (
	"strings"
	"testing"
)

func TestBuildSummaryPromptIncludesFactsAndGuardrails(t *testing.T) {
	f := SummaryFacts{
		Objective:  "ship the widget",
		RestReason: restBlocked,
		Blockers:   []string{"token refresh test failing"},
		Decisions:  []string{"chose middleware extraction because it isolates auth"},
		RunGoal:    "ship ABC-7 the widget",
		RunStatus:  "blocked",
	}
	p := buildSummaryPrompt(f)
	for _, want := range []string{
		"ship the widget", "blocked", "token refresh test failing",
		"middleware extraction", "Do not invent decisions",
	} {
		if !strings.Contains(p, want) {
			t.Errorf("prompt missing %q\n---\n%s", want, p)
		}
	}
}

const summaryPromptHead = "You are Jarvis, summarizing where a development task stands so it can be resumed later.\n" +
	"Write one short paragraph describing where the work stands and what remains, using only the facts below. It is read at a glance on a resume card.\n" +
	"Do not invent decisions. Do not claim the task is complete or correct beyond the stated run status. If a fact is absent, omit it — never speculate.\n\n"

func TestBuildSummaryPromptExact(t *testing.T) {
	full := SummaryFacts{
		Objective:  "ship the widget",
		RestReason: restBlocked,
		Blockers:   []string{"token refresh test failing"},
		Decisions:  []string{"chose middleware extraction"},
		RunGoal:    "ship ABC-7 the widget",
		RunStatus:  "blocked",
	}
	want := summaryPromptHead +
		"Objective: ship the widget\n" +
		"State: blocked\n" +
		"Latest run: ship ABC-7 the widget (status: blocked)\n" +
		"Blockers:\n- token refresh test failing\n" +
		"Decisions recorded:\n- chose middleware extraction\n"
	if got := buildSummaryPrompt(full); got != want {
		t.Errorf("full prompt =\n%s\nwant\n%s", got, want)
	}
	// absent facts leave no line behind, not even an empty heading
	bare := SummaryFacts{Objective: "ship the widget", RestReason: restCompleted}
	want = summaryPromptHead + "Objective: ship the widget\nState: completed\n"
	if got := buildSummaryPrompt(bare); got != want {
		t.Errorf("bare prompt =\n%s\nwant\n%s", got, want)
	}
}

func TestHasActivityAndTerseState(t *testing.T) {
	empty := SummaryFacts{RestReason: restBlocked}
	if empty.hasActivity() {
		t.Fatal("no blockers/decisions/endcommit -> no activity")
	}
	if got := terseState(empty); !strings.Contains(got, "no recorded progress") {
		t.Errorf("terse paused state = %q", got)
	}
	if got := terseState(SummaryFacts{RestReason: restCompleted}); !strings.Contains(got, "Completed") {
		t.Errorf("terse completed state = %q", got)
	}
	if !(SummaryFacts{RestReason: restBlocked, Blockers: []string{"x"}}).hasActivity() {
		t.Fatal("a blocker means there is activity to summarize")
	}
	if !(SummaryFacts{RestReason: restCompleted, HasEndCommit: true}).hasActivity() {
		t.Fatal("a completed run with an end commit has activity")
	}
}
