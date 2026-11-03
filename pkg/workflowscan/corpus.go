// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package workflowscan is the pure part of a workflow scan: it builds the corpus of run-record signals, recounts
// the patterns a model names in it, and holds the prompts and the rules the scan's results must meet. It takes
// runs and events as values; the store, the model call and the RPC live in wavesrv.
package workflowscan

import (
	"bytes"
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

const (
	// MaxField is where one signal line is cut.
	MaxField = 1500
	// MaxCorpusChars caps the whole corpus, about 160k tokens, so a busy window cannot push the one Sonnet
	// prompt past its context.
	MaxCorpusChars = 640000
	maxGoalChars   = 100
	dateLayout     = "2006-01-02"
	shortIdLen     = 8
	// mirrors jarvis.IsBrainstormSession, which this package cannot import without pulling in the store
	stageRoleBuilderCheck    = "builder-check"
	stageRoleBrainstormJudge = "brainstorm-judge"
)

// RunInfo is a run with its project name, which the caller resolves: the channel's name, else the base name of
// the run's project path.
type RunInfo struct {
	Run     *waveobj.Run
	Project string
}

// Block is one run's signal lines.
type Block struct {
	RunId   string
	Short   string // the first 8 chars of RunId, as the header shows it
	Project string
	Date    string // the run's UTC creation date
	Lines   []string
}

type Corpus struct {
	Text     string
	Blocks   []Block // in creation order
	Runs     int     // blocks kept
	Projects int     // distinct projects of the kept blocks
	Dropped  int     // blocks cut for the size cap, oldest first
}

type eventPick func(d map[string]any) string

// eventPicks is the text each signal-bearing event kind contributes; child-answered (an ask id only) and
// task-lead-told (hand-off notes, not corrections) are left out on purpose
var eventPicks = map[string]eventPick{
	waveobj.RunEventKindPlanReviewed:     func(d map[string]any) string { return str(d, "findings") },
	waveobj.RunEventKindTaskReviewFailed: func(d map[string]any) string { return withTask(d, str(d, "note")) },
	waveobj.RunEventKindTaskReviewPassed: func(d map[string]any) string {
		if u := str(d, "unverified"); !isNone(u) {
			return withTask(d, "reviewer-unverified: "+u)
		}
		return ""
	},
	waveobj.RunEventKindChildAsk: func(d map[string]any) string { return withTask(d, str(d, "question")) },
	waveobj.RunEventKindTaskTold: func(d map[string]any) string { return withTask(d, str(d, "text")) },
	waveobj.RunEventKindLandHeld: func(d map[string]any) string { return str(d, "reason") },
	waveobj.RunEventKindTaskFailed: func(d map[string]any) string {
		return withTask(d, joinNonEmpty(" ", str(d, "lastfailurekind"), str(d, "detail")))
	},
	waveobj.RunEventKindTaskVerifyFailed: func(d map[string]any) string { return withTask(d, str(d, "detail")) },
	waveobj.RunEventKindLeadWakeFailed: func(d map[string]any) string {
		var lines []string
		if raw, ok := d["lines"].([]any); ok {
			for _, l := range raw {
				if s, ok := l.(string); ok {
					lines = append(lines, s)
				}
			}
		}
		return strings.Join(lines, " / ")
	},
	// nil: the event's whole data is its text
	waveobj.RunEventKindTaskRetried:     nil,
	waveobj.RunEventKindReviewOverruled: nil,
}

// EventKinds are the run event kinds the corpus reads, for the caller's query.
var EventKinds = func() []string {
	kinds := make([]string, 0, len(eventPicks))
	for k := range eventPicks {
		kinds = append(kinds, k)
	}
	sort.Strings(kinds)
	return kinds
}()

var noneRe = regexp.MustCompile(`(?i)^\s*(none|undefined)\.?\s*$`)

func isNone(s string) bool {
	return strings.TrimSpace(s) == "" || noneRe.MatchString(s)
}

func str(d map[string]any, key string) string {
	s, _ := d[key].(string)
	return s
}

// withTask prefixes a task's text with its id, and yields nothing when the text itself is empty or "none"
func withTask(d map[string]any, text string) string {
	if isNone(text) {
		return ""
	}
	return joinNonEmpty(" ", str(d, "taskid"), text)
}

func joinNonEmpty(sep string, parts ...string) string {
	var kept []string
	for _, p := range parts {
		if strings.TrimSpace(p) != "" {
			kept = append(kept, p)
		}
	}
	return strings.Join(kept, sep)
}

func cut(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	return string([]rune(s)[:n]) + " …"
}

func line(tag, text string) (string, bool) {
	if isNone(text) {
		return "", false
	}
	return fmt.Sprintf("[%s] %s", tag, cut(strings.TrimSpace(text), MaxField)), true
}

func eventText(e waveobj.RunEvent) string {
	pick, ok := eventPicks[e.Kind]
	if !ok {
		return ""
	}
	if pick == nil {
		var buf bytes.Buffer
		if json.Compact(&buf, e.Detail) != nil {
			return ""
		}
		return buf.String()
	}
	var d map[string]any
	if json.Unmarshal(e.Detail, &d) != nil {
		return ""
	}
	return pick(d)
}

func evidenceLines(r *waveobj.Run) []string {
	var out []string
	add := func(tag, text string) {
		if l, ok := line(tag, text); ok {
			out = append(out, l)
		}
	}
	if ev := r.Evidence; ev != nil {
		if dag := ev.Dag; dag != nil {
			for _, t := range dag.Tasks {
				add(t.TaskId+" differs", t.Differs)
				add(t.TaskId+" found-not-fixed", t.FoundNotFixed)
				add(t.TaskId+" not-verified", t.NotVerified)
			}
			for _, told := range dag.Told {
				add("human-told", told)
			}
		}
		if v := ev.Verification; v != nil {
			for _, reason := range v.Reasons {
				add("final-"+v.State, reason)
			}
		}
	}
	return out
}

func skipped(r *waveobj.Run) bool {
	return r.WorkflowScan != nil || r.StageRole == stageRoleBuilderCheck || r.StageRole == stageRoleBrainstormJudge
}

func (b Block) text(goal string) string {
	goal = cut(strings.Join(strings.Fields(goal), " "), maxGoalChars)
	header := fmt.Sprintf("### run %s · %s · %s · %s", b.Short, b.Date, b.Project, goal)
	return header + "\n" + strings.Join(b.Lines, "\n")
}

// BuildCorpus turns the signal-bearing records of the runs created in the last windowDays into one block per
// run, oldest first. Events of runs outside the window are ignored.
func BuildCorpus(runs []RunInfo, events []waveobj.RunEvent, now time.Time, windowDays int) Corpus {
	since := now.Add(-time.Duration(windowDays) * 24 * time.Hour).UnixMilli()
	var inWindow []RunInfo
	for _, ri := range runs {
		if ri.Run != nil && ri.Run.CreatedTs >= since && !skipped(ri.Run) {
			inWindow = append(inWindow, ri)
		}
	}
	sort.SliceStable(inWindow, func(i, j int) bool { return inWindow[i].Run.CreatedTs < inWindow[j].Run.CreatedTs })
	byId := map[string]int{}
	for i, ri := range inWindow {
		byId[ri.Run.OID] = i
	}

	sorted := append([]waveobj.RunEvent(nil), events...)
	sort.SliceStable(sorted, func(i, j int) bool { return sorted[i].Ts < sorted[j].Ts })
	lines := make([][]string, len(inWindow))
	for _, e := range sorted {
		i, ok := byId[e.RunID]
		if !ok {
			continue
		}
		if l, ok := line(e.Kind, eventText(e)); ok {
			lines[i] = append(lines[i], l)
		}
	}

	var blocks []Block
	var texts []string
	for i, ri := range inWindow {
		all := append(lines[i], evidenceLines(ri.Run)...)
		if len(all) == 0 {
			continue
		}
		b := Block{
			RunId:   ri.Run.OID,
			Short:   ri.Run.OID[:min(shortIdLen, len(ri.Run.OID))],
			Project: ri.Project,
			Date:    time.UnixMilli(ri.Run.CreatedTs).UTC().Format(dateLayout),
			Lines:   all,
		}
		blocks = append(blocks, b)
		texts = append(texts, b.text(ri.Run.Goal))
	}

	// blocks are joined by a blank line, so each after the first costs two more chars
	total := 0
	for i, t := range texts {
		total += utf8.RuneCountInString(t)
		if i > 0 {
			total += 2
		}
	}
	dropped := 0
	for total > MaxCorpusChars && dropped < len(texts) {
		total -= utf8.RuneCountInString(texts[dropped])
		if dropped < len(texts)-1 {
			total -= 2
		}
		dropped++
	}
	blocks, texts = blocks[dropped:], texts[dropped:]

	projects := map[string]bool{}
	for _, b := range blocks {
		projects[b.Project] = true
	}
	return Corpus{
		Text:     strings.Join(texts, "\n\n"),
		Blocks:   blocks,
		Runs:     len(blocks),
		Projects: len(projects),
		Dropped:  dropped,
	}
}
