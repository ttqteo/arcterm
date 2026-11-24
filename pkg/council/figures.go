// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package council

import (
	"fmt"
	"reflect"
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

// figureKey is the place and value of a figure: the ref's path (slashes, lower case) and line or range, and the value with
// its spaces collapsed. "pkg/x.go:42", "PKG\x.go:L42" and "pkg/x.go:42:7" are one place.
func figureKey(f CouncilFigure) string {
	r := splitCiteRef(strings.TrimSpace(f.Ref))
	return fmt.Sprintf("%s:%d-%d|%s", refPath(r), r.From, r.To, collapseSpace(f.Value))
}

// refPath is a ref's path as two refs are compared: slashes, lower case.
func refPath(r citeRef) string { return strings.ToLower(strings.ReplaceAll(r.Path, `\`, "/")) }

// folded is s with its runs of spaces collapsed and its case folded, as two quotes or values are compared.
func folded(s string) string { return strings.ToLower(collapseSpace(s)) }

// sameFigure says two declared figures are one number, so the report lists it once. They are when they sit at one place
// with one value (figureKey); when they quote the same line text with the same value, wherever it sits (a file and its
// copy in the council's inputs); or when they sit in one file within quoteSlack lines of each other, one quote holds the
// other and the two values read as the same number ("79,5%" and "120/151 = 79,5%" on the line that writes both).
func sameFigure(a, b CouncilFigure) bool {
	if figureKey(a) == figureKey(b) {
		return true
	}
	qa, qb, va, vb := folded(a.Quote), folded(b.Quote), folded(a.Value), folded(b.Value)
	if qa == "" || qb == "" || va == "" || vb == "" {
		return false
	}
	if qa == qb && va == vb {
		return true
	}
	ra, rb := splitCiteRef(strings.TrimSpace(a.Ref)), splitCiteRef(strings.TrimSpace(b.Ref))
	if !ra.HasLine || !rb.HasLine || refPath(ra) != refPath(rb) || ra.From-rb.To > quoteSlack || rb.From-ra.To > quoteSlack {
		return false
	}
	if !strings.Contains(qa, qb) && !strings.Contains(qb, qa) {
		return false
	}
	na, oka := readFigureNumber(a.Value)
	nb, okb := readFigureNumber(b.Value)
	return oka && okb && na.sameAs(nb)
}

// collectFigures is Council.Figures: the figures of the sent proposals as ApplyChecks checked them, with the copies of one
// figure (sameFigure) merged into one, in the order each figure was first declared, then related (relateFigures). The
// merged figure is verified when any copy is; its value, ref, quote and verdict are those of the verified copy with the
// longest value (the first of equals), else of the copy with the longest value; Refs holds the other copies' refs, once
// each; its Measures is the first non-empty one in proposal order among the verified copies, else among all of them, and
// its Group, Of, Was, Limit, Bound, Unit and At the first non-empty ones among all; and From lists the proposals that declared it, once each. It is nil
// for a Brainstorm, which asks for none, and when there is nothing to collect. It reads the proposals' figures and leaves
// them as they are.
func collectFigures(c *Council) []CouncilFigure {
	if c == nil || isBrainstorm(c) {
		return nil
	}
	type merged struct {
		copies []CouncilFigure
		from   []string
	}
	var all []*merged
	for _, p := range c.Proposals {
		if !Sent(p.Draft) {
			continue
		}
		for _, f := range p.Figures {
			var m *merged
			for _, cand := range all {
				if slices.ContainsFunc(cand.copies, func(g CouncilFigure) bool { return sameFigure(f, g) }) {
					m = cand
					break
				}
			}
			if m == nil {
				m = &merged{}
				all = append(all, m)
			}
			m.copies = append(m.copies, f)
			if !slices.Contains(m.from, p.Id) {
				m.from = append(m.from, p.Id)
			}
		}
	}
	var out []CouncilFigure
	for _, m := range all {
		verified := func(f CouncilFigure) bool { return f.Cite == CiteOK }
		chosen := longestValue(m.copies, verified)
		if chosen < 0 {
			chosen = longestValue(m.copies, func(CouncilFigure) bool { return true })
		}
		f := m.copies[chosen]
		f.Measures = firstNonEmpty(m.copies, verified, func(g CouncilFigure) string { return g.Measures })
		if f.Measures == "" {
			f.Measures = firstNonEmpty(m.copies, nil, func(g CouncilFigure) string { return g.Measures })
		}
		f.Group = firstNonEmpty(m.copies, nil, func(g CouncilFigure) string { return g.Group })
		f.Of = firstNonEmpty(m.copies, nil, func(g CouncilFigure) string { return g.Of })
		f.Was = firstNonEmpty(m.copies, nil, func(g CouncilFigure) string { return g.Was })
		f.Limit = firstNonEmpty(m.copies, nil, func(g CouncilFigure) string { return g.Limit })
		f.Bound = firstNonEmpty(m.copies, nil, func(g CouncilFigure) string { return g.Bound })
		f.Unit = firstNonEmpty(m.copies, nil, func(g CouncilFigure) string { return g.Unit })
		f.At = firstNonEmpty(m.copies, nil, func(g CouncilFigure) string { return g.At })
		f.Refs = nil
		seen := map[string]bool{refKey(f.Ref): true}
		for _, g := range m.copies {
			for _, r := range append([]string{g.Ref}, g.Refs...) {
				if k := refKey(r); r != "" && !seen[k] {
					seen[k] = true
					f.Refs = append(f.Refs, strings.TrimSpace(r))
				}
			}
		}
		f.From = m.from
		out = append(out, f)
	}
	return relateFigures(out)
}

// refKey is a ref as two refs are compared: its path (slashes, lower case) and line or range.
func refKey(ref string) string {
	r := splitCiteRef(strings.TrimSpace(ref))
	return fmt.Sprintf("%s:%d-%d", refPath(r), r.From, r.To)
}

// longestValue is the index of the copy, among those that pass keep, whose value is longest (the first of equals), or -1.
func longestValue(copies []CouncilFigure, keep func(CouncilFigure) bool) int {
	best := -1
	for i, f := range copies {
		if keep(f) && (best < 0 || len(collapseSpace(f.Value)) > len(collapseSpace(copies[best].Value))) {
			best = i
		}
	}
	return best
}

// firstNonEmpty is the first non-empty field (trimmed) among the copies that pass keep (all, when keep is nil), in order,
// or "".
func firstNonEmpty(copies []CouncilFigure, keep func(CouncilFigure) bool, field func(CouncilFigure) string) string {
	for _, f := range copies {
		if keep != nil && !keep(f) {
			continue
		}
		if v := strings.TrimSpace(field(f)); v != "" {
			return v
		}
	}
	return ""
}

// RefreshFigures rewrites c.Figures from its proposals' checked figures (collectFigures), so a council checked before the
// merge or relation rules changed reads by today's, and says whether the list changed. It reads no file: the verdicts are
// the ones ApplyChecks left on the proposals.
func RefreshFigures(c *Council) bool {
	if c == nil {
		return false
	}
	figs := collectFigures(c)
	changed := !reflect.DeepEqual(figs, c.Figures)
	c.Figures = figs
	return changed
}
