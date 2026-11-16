// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package runstart holds the pure decisions behind the "When" row of a run launcher: which files a run is about to
// edit, which live runs edit the same ones, and whether Jarvis suggests Run now, After those runs or Queue. It reads
// no store and runs no git; the caller gathers each live run's files and the project's quota and passes them in.
package runstart

import (
	"fmt"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/jarvis"
)

// The three ways a run can start.
const (
	ChoiceNow   = "now"
	ChoiceAfter = "after"
	ChoiceQueue = "queue"
)

// What a new run's files were read from, for the reason line when it names none.
const (
	SourceSpec = "spec"
	SourcePlan = "plan"
	SourceGoal = "goal"
)

// NewRunFiles are the files a run about to start will edit, as far as its texts say: the files its goal and spec
// mention, the files every plan task lists on a **Files:** line, and the files the plan's text mentions. Distinct, in
// that order, hub files (CHANGELOG.md and the like) left out.
func NewRunFiles(goal, specText, planText string) []string {
	var out []string
	seen := map[string]bool{}
	add := func(files []string) {
		for _, f := range files {
			f = strings.TrimSpace(f)
			if f == "" || seen[f] || jarvis.HubFile(f) {
				continue
			}
			seen[f] = true
			out = append(out, f)
		}
	}
	add(jarvis.FileMentions(goal, specText))
	if strings.TrimSpace(planText) != "" {
		add(planTaskFiles(planText))
		add(jarvis.FileMentions(planText))
	}
	return out
}

// planTaskFiles are the paths the plan's task headings' Files lines list. A plan that does not parse (the launcher
// may be shown a draft) is read line by line instead, so its Files lines still count.
func planTaskFiles(planText string) []string {
	plan, err := jarvis.ParsePlan(planText)
	if err != nil {
		return jarvis.TaskFiles(planText)
	}
	var files []string
	for _, t := range plan.Tasks {
		files = append(files, jarvis.TaskFiles(t.Description)...)
	}
	return files
}

// DiffFiles are the repo paths a git diff names, distinct and in order, hub files left out as FileMentions leaves
// them out of a text. Blank lines are skipped and a backslash is read as a slash.
func DiffFiles(paths []string) []string {
	var out []string
	seen := map[string]bool{}
	for _, p := range paths {
		p = strings.ReplaceAll(strings.TrimSpace(p), `\`, "/")
		if p == "" || seen[p] || jarvis.HubFile(p) {
			continue
		}
		seen[p] = true
		out = append(out, p)
	}
	return out
}

// SameFile reports whether two spellings name one file: either is the other, or a path ending in it. Both sides can
// be a bare mention ("land.go") as well as a repo path.
func SameFile(a, b string) bool {
	if a == "" || b == "" {
		return false
	}
	return jarvis.MentionMatches(a, b) || jarvis.MentionMatches(b, a)
}

// LiveRun is a run that has not finished landing, with the files it edits.
type LiveRun struct {
	Id, Title  string
	Files      []string
	Held       bool // its land is held: waiting on it would block the entry at once
	HeldReason string
	CreatedTs  int64
}

// Overlap is one live run against a new run's files. Files are the ones both name, the fuller spelling when one side
// is a bare name; empty when they share none.
type Overlap struct {
	RunId, Title string
	Files        []string
	Held         bool
	HeldReason   string
}

// Overlaps returns one Overlap per live run, in live's order.
func Overlaps(files []string, live []LiveRun) []Overlap {
	out := make([]Overlap, 0, len(live))
	for _, l := range live {
		out = append(out, Overlap{RunId: l.Id, Title: l.Title, Files: sharedFiles(files, l.Files), Held: l.Held, HeldReason: l.HeldReason})
	}
	return out
}

func sharedFiles(mine, theirs []string) []string {
	var out []string
	seen := map[string]bool{}
	for _, f := range mine {
		for _, g := range theirs {
			if !SameFile(f, g) {
				continue
			}
			name := f
			if len(g) > len(f) {
				name = g
			}
			if !seen[name] {
				seen[name] = true
				out = append(out, name)
			}
		}
	}
	return out
}

// runName is how a run is called in a reason line: its title, else its id.
func runName(o Overlap) string {
	if o.Title != "" {
		return o.Title
	}
	return o.RunId
}

// SuggestInput is what the suggestion reads. MaxActive 0 means the run cap is off.
type SuggestInput struct {
	Files     []string // the new run's files (NewRunFiles)
	Source    string   // what they were read from: SourceSpec, SourcePlan or SourceGoal
	Live      []LiveRun
	Active    int // runs active now, across projects, as the queue counts them
	MaxActive int
}

// Suggestion is what Jarvis preselects: a choice, the runs to wait for when it is After, and why.
type Suggestion struct {
	Choice string
	After  []string
	Reason string
}

// Suggest picks the start for a new run. A live run that is not held and edits one of the same files is waited for
// (After); a held one never is, since the queue would block the entry at once, so it is named in the reason to land
// first. With no such run the run starts now if the cap has room, else it queues. Nothing here looks at quota.
func Suggest(in SuggestInput) Suggestion {
	room := in.MaxActive <= 0 || in.Active < in.MaxActive
	if len(in.Files) == 0 {
		source := in.Source
		if source == "" {
			source = SourceGoal
		}
		return Suggestion{Choice: nowOrQueue(room), Reason: fmt.Sprintf("The %s names no files: only the run cap was checked", source)}
	}
	var waits []Overlap
	var heldLines []string
	overlapping := false
	for _, o := range Overlaps(in.Files, in.Live) {
		if len(o.Files) == 0 {
			continue
		}
		overlapping = true
		if o.Held {
			heldLines = append(heldLines, fmt.Sprintf("%s is held and edits %s: land it first, or this run will conflict", runName(o), o.Files[0]))
			continue
		}
		waits = append(waits, o)
	}
	var out Suggestion
	var parts []string
	switch {
	case len(waits) > 0:
		out.Choice = ChoiceAfter
		for _, o := range waits {
			out.After = append(out.After, o.RunId)
		}
		line := fmt.Sprintf("Edits %s like %s", waits[0].Files[0], runName(waits[0]))
		switch more := len(waits) - 1; {
		case more == 1:
			line += " and 1 more run"
		case more > 1:
			line += fmt.Sprintf(" and %d more runs", more)
		}
		parts = append(parts, line)
	case !room:
		out.Choice = ChoiceQueue
		parts = append(parts, activeLine(in.Active))
	default:
		out.Choice = ChoiceNow
		// a held run that overlaps is a live run that edits the same files: the line below says so instead
		if !overlapping {
			parts = append(parts, "No live run edits the same files")
		}
	}
	out.Reason = strings.Join(append(parts, heldLines...), "; ")
	return out
}

func nowOrQueue(room bool) string {
	if room {
		return ChoiceNow
	}
	return ChoiceQueue
}

func activeLine(n int) string {
	if n == 1 {
		return "1 run is already active"
	}
	return fmt.Sprintf("%d runs are already active", n)
}

// RecheckAdds are the live runs a queued entry has to wait for as well when its turn comes: created after it was
// queued (so a run the person saw and passed over is never added back), not held, not already in after, and editing
// one of files. reason names the first run and the first shared file; both are empty when there is nothing to add.
func RecheckAdds(files []string, live []LiveRun, queuedTs int64, after []string) (add []string, reason string) {
	listed := map[string]bool{}
	for _, id := range after {
		listed[id] = true
	}
	var fresh []LiveRun
	for _, l := range live {
		if l.CreatedTs > queuedTs && !l.Held && !listed[l.Id] {
			fresh = append(fresh, l)
		}
	}
	for _, o := range Overlaps(files, fresh) {
		if len(o.Files) == 0 {
			continue
		}
		if reason == "" {
			reason = fmt.Sprintf("Waiting for %s too: both edit %s", runName(o), o.Files[0])
		}
		add = append(add, o.RunId)
	}
	return add, reason
}
