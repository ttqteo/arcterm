// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package bench

import (
	"errors"
	"regexp"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/council"
)

// The lines of the report a team's lead ends with (teamprompt.go asks for this shape):
//
//	Answer: <one sentence>
//
//	## What to do, most important first
//	1. <title>
//	   Why: <why, with path:line>
//	   Disagrees: <who and why, or "no one">
var (
	reportAnswerRe    = regexp.MustCompile(`(?i)^\s*\**\s*answer\**\s*:\s*\**\s*(\S.*)$`)
	reportItemRe      = regexp.MustCompile(`^ {0,2}\d+[.)]\s+(\S.*)$`)
	reportWhyRe       = regexp.MustCompile(`(?i)^\s*\**\s*why\**\s*:\s*\**\s*(.*)$`)
	reportDisagreesRe = regexp.MustCompile(`(?i)^\s*\**\s*disagrees\**\s*:\s*\**\s*(.*)$`)
	reportHeadingRe   = regexp.MustCompile(`^\s*#{1,6}\s`)
)

// reportItem is one numbered item while the report is read: where a continuation line goes is the field last written.
type reportItem struct {
	title, why, disagrees string
	last                  *string
}

// parseTeamReport reads a lead's final message into the summary the judge reads: the answer, and one direction per
// numbered item, its reasoning the Why line then the Disagrees line. Text around the report is skipped, a missing Why or
// Disagrees line is tolerated, and a report with no numbered item is an error.
func parseTeamReport(text string) (*council.CouncilSummary, error) {
	s := &council.CouncilSummary{}
	var items []*reportItem
	var cur *reportItem
	for line := range strings.SplitSeq(strings.ReplaceAll(text, "\r\n", "\n"), "\n") {
		if m := reportItemRe.FindStringSubmatch(line); m != nil {
			cur = &reportItem{title: strings.TrimSpace(m[1])}
			cur.last = &cur.title
			items = append(items, cur)
			continue
		}
		if cur == nil {
			// before the first item only the answer matters
			if m := reportAnswerRe.FindStringSubmatch(line); m != nil && s.Answer == "" {
				s.Answer = strings.TrimSpace(m[1])
			}
			continue
		}
		switch {
		case reportHeadingRe.MatchString(line):
			cur = nil // a heading after the items ends the report
		case reportWhyRe.MatchString(line):
			cur.why = strings.TrimSpace(reportWhyRe.FindStringSubmatch(line)[1])
			cur.last = &cur.why
		case reportDisagreesRe.MatchString(line):
			cur.disagrees = strings.TrimSpace(reportDisagreesRe.FindStringSubmatch(line)[1])
			cur.last = &cur.disagrees
		case strings.TrimSpace(line) == "":
			// a blank line between items says nothing
		case line[0] == ' ' || line[0] == '\t':
			// a wrapped line of the field above
			if cur.last != nil {
				*cur.last = strings.TrimSpace(*cur.last + " " + strings.TrimSpace(line))
			}
		default:
			cur.last = nil // text after the report: it belongs to no field
		}
	}
	if len(items) == 0 {
		return nil, errors.New("the report holds no numbered item")
	}
	for i, it := range items {
		var reasoning []string
		if it.why != "" {
			reasoning = append(reasoning, "Why: "+it.why)
		}
		if it.disagrees != "" {
			reasoning = append(reasoning, "Disagrees: "+it.disagrees)
		}
		title := it.title
		if len(title) > 4 && strings.HasPrefix(title, "**") && strings.HasSuffix(title, "**") {
			title = strings.TrimSpace(title[2 : len(title)-2])
		}
		s.Directions = append(s.Directions, council.CouncilDirection{Rank: i + 1, Title: title, Reasoning: strings.Join(reasoning, "\n")})
	}
	return s, nil
}
