// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jarvis

import (
	"fmt"
	"slices"
	"strings"
)

// WorkerReport is a dag worker's report split into its five fixed sections. Each field is the trimmed
// section body, empty when the worker wrote None.
type WorkerReport struct {
	Done          string
	Differs       string
	NotVerified   string
	ForLater      string
	FoundNotFixed string
}

// WorkerReportSection pairs a section's heading with the key `wsh jarvis dag report` pulls it by.
type WorkerReportSection struct {
	Key     string
	Heading string
}

// the keys readers compare against: Done is the one section never sent inline, and a report that predates the
// format is a single section of its own.
const (
	ReportKeyDone          = "done"
	ReportKeyDiffers       = "differs"
	ReportKeyNotVerified   = "not-verified"
	ReportKeyForLater      = "for-later"
	ReportKeyFoundNotFixed = "found-not-fixed"
	ReportKeyUnstructured  = "unstructured"
)

// WorkerReportSections lists the sections in report order. It is the one place a heading or key is spelled.
var WorkerReportSections = []WorkerReportSection{
	{Key: ReportKeyDone, Heading: "Done"},
	{Key: ReportKeyDiffers, Heading: "Differs from plan"},
	{Key: ReportKeyNotVerified, Heading: "Not verified"},
	{Key: ReportKeyForLater, Heading: "For later tasks"},
	{Key: ReportKeyFoundNotFixed, Heading: "Found not fixed"},
}

// WorkerReportTemplate is the report shape handed to the worker and repeated in the refusal.
const WorkerReportTemplate = `## Done
<what landed, and the checks you ran with their results>

## Differs from plan
<each departure from the task or plan, and why; or None>

## Not verified
<checks the task or plan asked for that you did not do, and why; or None>

## For later tasks
<what a later task must know, including a departure that changes what it builds on; or None>

## Found not fixed
<failures already on the base, and defects outside your task, but not formatter or lint findings already on the base; or None>`

const (
	reportHeadingPrefix = "## "
	reportFence         = "```"
	reportNone          = "none"
	reportBOM           = "\xef\xbb\xbf"
	strayQuoteMaxRunes  = 60
)

func (r *WorkerReport) field(key string) *string {
	switch key {
	case ReportKeyDone:
		return &r.Done
	case ReportKeyDiffers:
		return &r.Differs
	case ReportKeyNotVerified:
		return &r.NotVerified
	case ReportKeyForLater:
		return &r.ForLater
	case ReportKeyFoundNotFixed:
		return &r.FoundNotFixed
	}
	return nil
}

// Section returns the body for a pull key. ok is false only for an unknown key; a None section is ("", true).
func (r WorkerReport) Section(key string) (string, bool) {
	p := r.field(key)
	if p == nil {
		return "", false
	}
	return *p, true
}

func sectionByHeading(name string) (WorkerReportSection, bool) {
	for _, s := range WorkerReportSections {
		if strings.EqualFold(s.Heading, name) {
			return s, true
		}
	}
	return WorkerReportSection{}, false
}

func isNoneBody(body string) bool {
	return strings.EqualFold(strings.TrimSuffix(body, "."), reportNone)
}

func quoteStray(s string) string {
	if r := []rune(s); len(r) > strayQuoteMaxRunes {
		return string(r[:strayQuoteMaxRunes]) + "…"
	}
	return s
}

// ParseWorkerReport splits a report into its five sections. Every problem is named in one error so a single
// retry can fix the report.
func ParseWorkerReport(text string) (WorkerReport, error) {
	text = strings.TrimPrefix(text, reportBOM)
	text = strings.ReplaceAll(text, "\r\n", "\n")

	var (
		rep      WorkerReport
		stray    []string
		unknown  []string
		dupes    []string
		bodies   = map[string][]string{}
		seen     = map[string]bool{}
		cur      string // key of the section being read; "" before the first heading, "?" under an unknown one
		inFence  bool
		started  bool
		preamble []string
	)
	for _, line := range strings.Split(text, "\n") {
		if strings.HasPrefix(strings.TrimSpace(line), reportFence) {
			inFence = !inFence
		} else if !inFence && strings.HasPrefix(line, reportHeadingPrefix) {
			started = true
			name := strings.TrimSpace(strings.TrimPrefix(line, reportHeadingPrefix))
			sec, ok := sectionByHeading(name)
			switch {
			case !ok:
				unknown = append(unknown, fmt.Sprintf("unknown heading %q", reportHeadingPrefix+name))
				cur = "?"
			case seen[sec.Key]:
				if !slices.Contains(dupes, sec.Heading) {
					dupes = append(dupes, sec.Heading)
				}
				cur = "?"
			default:
				seen[sec.Key] = true
				cur = sec.Key
			}
			continue
		}
		switch {
		case !started:
			preamble = append(preamble, line)
		case cur != "?":
			bodies[cur] = append(bodies[cur], line)
		}
	}
	if pre := strings.TrimSpace(strings.Join(preamble, "\n")); pre != "" {
		stray = append(stray, fmt.Sprintf("text before the first heading: %q", quoteStray(pre)))
	}

	var missing, empty []string
	for _, sec := range WorkerReportSections {
		if !seen[sec.Key] {
			missing = append(missing, sec.Heading)
			continue
		}
		body := strings.TrimSpace(strings.Join(bodies[sec.Key], "\n"))
		if body == "" {
			empty = append(empty, sec.Heading)
			continue
		}
		if isNoneBody(body) {
			body = ""
		}
		*rep.field(sec.Key) = body
	}

	var problems []string
	if len(missing) > 0 {
		problems = append(problems, "missing: "+strings.Join(missing, ", "))
	}
	if len(dupes) > 0 {
		problems = append(problems, "duplicate: "+strings.Join(dupes, ", "))
	}
	problems = append(problems, unknown...)
	if len(empty) > 0 {
		problems = append(problems, "empty (write None): "+strings.Join(empty, ", "))
	}
	problems = append(problems, stray...)
	if len(problems) > 0 {
		return WorkerReport{}, fmt.Errorf("%s", strings.Join(problems, "; "))
	}
	return rep, nil
}

// ReadWorkerReport is the one reader every consumer uses: a report that parses comes back as sections, one
// written before the format existed comes back as its trimmed text in unstructured.
func ReadWorkerReport(summary string) (rep WorkerReport, unstructured string) {
	rep, err := ParseWorkerReport(summary)
	if err == nil {
		return rep, ""
	}
	return WorkerReport{}, strings.TrimSpace(summary)
}
