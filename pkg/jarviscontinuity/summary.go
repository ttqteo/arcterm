// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package jarviscontinuity writes a task dossier's narrative "where it stands" summary at Run rest
// boundaries (paused/completed), so recall (sub-project C) can serve continuity. It is the mirror of
// pkg/jarviscapture (which writes the dossier at dispatch) and stays a lifecycle-boundary writer only.
package jarviscontinuity

import (
	"fmt"
	"strings"
)

// Rest-reason phrases used in the narrative (human-readable, decoupled from jarvis.RunStatus_* strings).
const (
	restAwaitingReview = "awaiting review"
	restBlocked        = "blocked"
	restCompleted      = "completed"
)

// SummaryFacts are the deterministic inputs to the boundary narrative, assembled from the dossier, its
// referenced decisions, and the triggering run. No transcript, no diff (meta-spec non-goal).
type SummaryFacts struct {
	Objective    string
	RestReason   string   // restAwaitingReview | restBlocked | restCompleted
	Blockers     []string // non-empty blocker lines from the dossier
	Decisions    []string // referenced decision rationale snippets
	RunGoal      string
	RunStatus    string
	HasEndCommit bool
}

// hasActivity reports whether there is anything worth a model summary. With no blockers, no decisions,
// and no run outcome signal, E writes a terse deterministic line instead of paying for a model call.
func (f SummaryFacts) hasActivity() bool {
	return len(f.Blockers) > 0 || len(f.Decisions) > 0 || f.HasEndCommit
}

// terseState is the deterministic no-activity narrative — a rewarded "nothing to say" state, never
// confabulation (invariant 7). No model call.
func terseState(f SummaryFacts) string {
	if f.RestReason == restCompleted {
		return "Completed; no recorded details."
	}
	return fmt.Sprintf("Paused (%s); no recorded progress yet.", f.RestReason)
}

// buildSummaryPrompt renders the deterministic facts into the one-shot summary prompt. Invariant 6
// guardrails are explicit.
func buildSummaryPrompt(f SummaryFacts) string {
	var b strings.Builder
	b.WriteString("You are Jarvis, summarizing where a development task stands so it can be resumed later.\n")
	b.WriteString("Write one short paragraph describing where the work stands and what remains, using only the facts below. It is read at a glance on a resume card.\n")
	b.WriteString("Do not invent decisions. Do not claim the task is complete or correct beyond the stated run status. If a fact is absent, omit it — never speculate.\n\n")
	b.WriteString("Objective: " + f.Objective + "\n")
	b.WriteString("State: " + f.RestReason + "\n")
	if f.RunGoal != "" {
		b.WriteString("Latest run: " + f.RunGoal + " (status: " + f.RunStatus + ")\n")
	}
	if len(f.Blockers) > 0 {
		b.WriteString("Blockers:\n")
		for _, bl := range f.Blockers {
			b.WriteString("- " + bl + "\n")
		}
	}
	if len(f.Decisions) > 0 {
		b.WriteString("Decisions recorded:\n")
		for _, d := range f.Decisions {
			b.WriteString("- " + d + "\n")
		}
	}
	return b.String()
}
