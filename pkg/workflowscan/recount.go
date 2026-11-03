// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package workflowscan

import (
	"fmt"
	"sort"
	"strings"
	"unicode/utf8"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

const (
	// Floor is the verified runs a pattern needs to survive.
	Floor = 3
	// MinQuoteChars is the shortest normalized quote that verifies: a shorter one, like "tests fail", matches
	// nearly every run and so verifies nothing.
	MinQuoteChars = 24
)

// Candidate is one pattern the Sonnet pass names.
type Candidate struct {
	Title     string     `json:"title"`
	FixTarget string     `json:"fixtarget"`
	Citations []Citation `json:"citations"`
}

// Citation is a run the pattern was seen in: the 8-char id from its block header, and a quote from its lines.
type Citation struct {
	Run   string `json:"run"`
	Quote string `json:"quote"`
}

func normalize(s string) string {
	return strings.Join(strings.Fields(strings.ToLower(s)), " ")
}

// resolve finds the one block a cited run id names; a prefix two runs share names neither
func resolve(c Corpus, run string) (int, bool) {
	run = strings.ToLower(strings.TrimSpace(run))
	found := -1
	for i, b := range c.Blocks {
		if run != "" && (b.Short == run || b.RunId == run) {
			if found >= 0 {
				return 0, false
			}
			found = i
		}
	}
	return found, found >= 0
}

// Recount keeps, for each candidate, the cited runs whose quote is in that run's own lines, counting each run
// once. Candidates with Floor or more verified runs survive, with ids p1, p2, ... by verified runs, most first;
// the rest come back as under-floor rows with no id.
func Recount(c Corpus, cands []Candidate) (survivors, underFloor []waveobj.WorkflowScanPattern) {
	norm := make([]string, len(c.Blocks))
	for i, b := range c.Blocks {
		norm[i] = normalize(strings.Join(b.Lines, "\n"))
	}
	var all []waveobj.WorkflowScanPattern
	for _, cand := range cands {
		verified := map[int]string{}
		for _, cit := range cand.Citations {
			i, ok := resolve(c, cit.Run)
			if !ok {
				continue
			}
			if _, seen := verified[i]; seen {
				continue
			}
			q := normalize(cit.Quote)
			if utf8.RuneCountInString(q) >= MinQuoteChars && strings.Contains(norm[i], q) {
				verified[i] = strings.TrimSpace(cit.Quote)
			}
		}
		all = append(all, pattern(c, cand, verified))
	}
	sort.SliceStable(all, func(i, j int) bool { return all[i].Runs > all[j].Runs })
	for _, p := range all {
		if p.Runs >= Floor {
			p.Id = fmt.Sprintf("p%d", len(survivors)+1)
			survivors = append(survivors, p)
		} else {
			underFloor = append(underFloor, p)
		}
	}
	return survivors, underFloor
}

func pattern(c Corpus, cand Candidate, verified map[int]string) waveobj.WorkflowScanPattern {
	idx := make([]int, 0, len(verified))
	for i := range verified {
		idx = append(idx, i)
	}
	sort.Ints(idx)
	p := waveobj.WorkflowScanPattern{
		Title:     strings.TrimSpace(cand.Title),
		FixTarget: strings.TrimSpace(cand.FixTarget),
		Runs:      len(idx),
		Projects:  []waveobj.WorkflowScanProject{},
		Quotes:    []waveobj.WorkflowScanQuote{},
	}
	days := map[string]bool{}
	byProject := map[string]int{}
	for _, i := range idx {
		b := c.Blocks[i]
		days[b.Date] = true
		byProject[b.Project]++
		p.Quotes = append(p.Quotes, waveobj.WorkflowScanQuote{RunId: b.RunId, Project: b.Project, Date: b.Date, Text: verified[i]})
	}
	p.Days = len(days)
	for name, runs := range byProject {
		p.Projects = append(p.Projects, waveobj.WorkflowScanProject{Name: name, Runs: runs})
	}
	sort.Slice(p.Projects, func(i, j int) bool {
		if p.Projects[i].Runs != p.Projects[j].Runs {
			return p.Projects[i].Runs > p.Projects[j].Runs
		}
		return p.Projects[i].Name < p.Projects[j].Name
	})
	return p
}
