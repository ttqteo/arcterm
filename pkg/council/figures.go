// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package council

import (
	"fmt"
	"slices"
	"strings"
)

// Figures: the numbers a Review's seats declared in round 1 (CouncilProposal.Figures) that a project file holds. Go
// checks each one with the cite check and a test of its own, then writes the deduplicated list to Council.Figures, which
// the report's Figures table and the cockpit both read. A model never says whether a figure is verified, and no model
// call is spent on the table.

// checkFigure is f with Go's verdict on it (Cite, CiteNote), from scratch: the figure needs a value, a line in its ref and
// a quote, and the quote must be at or near that line in a file under one of roots (checkCite, the evidence check), and the
// value must appear in the quote (compared with case and runs of spaces folded). A figure that fails is CiteWrong with
// the first reason found. Those three needs are read from the figure alone, so a figure missing one is wrong even with no
// roots; a well-formed figure with no roots (no tree to check against) is left unchecked, as evidence is.
func checkFigure(f CouncilFigure, roots []string) CouncilFigure {
	f.Cite, f.CiteNote = "", ""
	wrong := func(note string) CouncilFigure {
		f.Cite, f.CiteNote = CiteWrong, note
		return f
	}
	ref := strings.TrimSpace(f.Ref)
	r := splitCiteRef(ref)
	switch {
	case collapseSpace(f.Value) == "":
		return wrong("no value")
	case !checkable(ref):
		return wrong("ref is not a path:line in a project file")
	case !r.HasLine:
		return wrong("ref has no line")
	case collapseSpace(f.Quote) == "":
		return wrong("no quote")
	case len(roots) == 0:
		return f
	}
	if cite, note := checkCite(r, f.Quote, roots); cite != CiteOK {
		return wrong(note)
	}
	if !strings.Contains(strings.ToLower(collapseSpace(f.Quote)), strings.ToLower(collapseSpace(f.Value))) {
		return wrong("value not in the quote")
	}
	f.Cite = CiteOK
	return f
}

// figureKey is what makes two figures one: the ref's path (slashes, lower case) and line or range, and the value with its
// spaces collapsed. "pkg/x.go:42", "PKG\x.go:L42" and "pkg/x.go:42:7" are one place.
func figureKey(f CouncilFigure) string {
	r := splitCiteRef(strings.TrimSpace(f.Ref))
	path := strings.ToLower(strings.ReplaceAll(r.Path, `\`, "/"))
	return fmt.Sprintf("%s:%d-%d|%s", path, r.From, r.To, collapseSpace(f.Value))
}

// collectFigures is Council.Figures: the figures of the sent proposals as ApplyChecks checked them, with the copies of one
// figure (figureKey) merged into one, in the order each figure was first declared. The merged figure is verified when any
// copy is; its ref, quote and verdict are the first verified copy's, else the first copy's; its Measures is the first
// non-empty one in proposal order among the verified copies, else among all of them; and From lists the proposals that
// declared it, once each. It is nil for a Brainstorm, which asks for none, and when there is nothing to collect. It reads
// the proposals' figures and leaves them as they are.
func collectFigures(c *Council) []CouncilFigure {
	if c == nil || isBrainstorm(c) {
		return nil
	}
	type merged struct {
		copies []CouncilFigure
		from   []string
	}
	var order []string
	byKey := map[string]*merged{}
	for _, p := range c.Proposals {
		if !Sent(p.Draft) {
			continue
		}
		for _, f := range p.Figures {
			k := figureKey(f)
			m := byKey[k]
			if m == nil {
				m = &merged{}
				byKey[k] = m
				order = append(order, k)
			}
			m.copies = append(m.copies, f)
			if !slices.Contains(m.from, p.Id) {
				m.from = append(m.from, p.Id)
			}
		}
	}
	var out []CouncilFigure
	for _, k := range order {
		m := byKey[k]
		verified := func(f CouncilFigure) bool { return f.Cite == CiteOK }
		chosen := m.copies[0]
		if i := slices.IndexFunc(m.copies, verified); i >= 0 {
			chosen = m.copies[i]
		}
		chosen.Measures = firstMeasures(m.copies, verified)
		if chosen.Measures == "" {
			chosen.Measures = firstMeasures(m.copies, func(CouncilFigure) bool { return true })
		}
		chosen.From = m.from
		out = append(out, chosen)
	}
	return out
}

// firstMeasures is the first non-empty Measures among the copies that pass keep, in order, or "".
func firstMeasures(copies []CouncilFigure, keep func(CouncilFigure) bool) string {
	for _, f := range copies {
		if keep(f) && strings.TrimSpace(f.Measures) != "" {
			return f.Measures
		}
	}
	return ""
}
