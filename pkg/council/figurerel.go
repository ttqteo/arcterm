// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package council

import (
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
)

// Figure relations: a seat may say a figure belongs to a set ("group") and is part of a whole ("of"). Go reads each
// verified figure as a number, checks each relation and keeps only those that hold, so the report can draw a group's
// figures as part-of-whole bars (the cockpit) or a share column (the .md) without reading a number itself. Two shapes:
// counts that split a whole ("94" and "41" of "135", "135" of "947"), stacked in one bar; and rates over a denominator
// ("0.7059" of "170", "120/151 = 79,5%"), one bar each, so two rates of one numerator over different denominators sit
// side by side.

// figureNumber is a figure's value read as a number. A rate is a percentage, a fraction or a decimal between 0 and 1, and
// Share is it as 0..1; a count has Amount. Whole is a fraction's denominator, the whole a rate written "120/151" names.
type figureNumber struct {
	Rate   bool
	Share  float64
	Amount float64
	Whole  float64
	// WholeText is the denominator as the value writes it ("151"); "" for no fraction.
	WholeText string
	// Mismatch says the value writes a fraction and a percentage that disagree ("120/151 = 85%"); it reads the fraction.
	Mismatch string
}

// rateSlack is how far a fraction and the percentage written beside it may differ and still agree: a percentage rounded
// to one decimal (120/151 = 79.47%, written 79,5%) is 0.0003 off, one rounded to a whole percent up to 0.005.
const rateSlack = 0.0051

// sameAs says two values read as the same number: two rates within rateSlack, or two counts that are equal.
func (n figureNumber) sameAs(o figureNumber) bool {
	if n.Rate != o.Rate {
		return false
	}
	if n.Rate {
		return math.Abs(n.Share-o.Share) <= rateSlack
	}
	return nearlyEqual(n.Amount, o.Amount)
}

func nearlyEqual(a, b float64) bool {
	return math.Abs(a-b) <= 1e-9*math.Max(1, math.Max(math.Abs(a), math.Abs(b)))
}

var (
	numberRe   = regexp.MustCompile(`\d[\d.,]*`)
	fractionRe = regexp.MustCompile(`(\d[\d.,]*)\s*/\s*(\d[\d.,]*)`)
	percentRe  = regexp.MustCompile(`(\d[\d.,]*)\s*%`)
)

// readFigureNumber reads a figure's value: its first fraction ("120/151"), else its first percentage ("79,5%"), else its
// first number, which is a rate when it has a decimal part and lies between 0 and 1 ("0.7059"), and a count otherwise
// ("947", "1,248 ms"). A value with a fraction and a percentage reads the fraction and notes a disagreement. ok is false
// for a value with no number, or a fraction over 0.
func readFigureNumber(value string) (figureNumber, bool) {
	if m := fractionRe.FindStringSubmatch(value); m != nil {
		a, oka := parseLocaleNumber(m[1])
		b, okb := parseLocaleNumber(m[2])
		if !oka || !okb || b == 0 {
			return figureNumber{}, false
		}
		n := figureNumber{Rate: true, Share: a / b, Whole: b, WholeText: strings.TrimRight(m[2], ".,")}
		if p := percentRe.FindStringSubmatch(value); p != nil {
			if pct, ok := parseLocaleNumber(p[1]); ok && math.Abs(pct/100-n.Share) > rateSlack {
				n.Mismatch = fmt.Sprintf("%s/%s is %s, not %s%%", strings.TrimRight(m[1], ".,"), n.WholeText, percentText(n.Share), strings.TrimRight(p[1], ".,"))
			}
		}
		return n, true
	}
	if m := percentRe.FindStringSubmatch(value); m != nil {
		pct, ok := parseLocaleNumber(m[1])
		if !ok {
			return figureNumber{}, false
		}
		return figureNumber{Rate: true, Share: pct / 100}, true
	}
	raw := numberRe.FindString(value)
	if raw == "" {
		return figureNumber{}, false
	}
	n, ok := parseLocaleNumber(raw)
	if !ok {
		return figureNumber{}, false
	}
	if n > 0 && n < 1 {
		return figureNumber{Rate: true, Share: n}, true
	}
	return figureNumber{Amount: n}, true
}

// parseLocaleNumber reads digits written with either decimal mark: "0.7059", "79,5", "1,248" (a thousands comma: one
// comma, three digits after it, not after a lone 0), "1.248.000" (several dots group thousands), "1,248.5" and
// "1.248,5" (the last mark of two kinds is the decimal one). A mark it ends on is dropped ("170," in a JSON line).
func parseLocaleNumber(s string) (float64, bool) {
	s = strings.TrimRight(s, ".,")
	if s == "" {
		return 0, false
	}
	dots, commas := strings.Count(s, "."), strings.Count(s, ",")
	switch {
	case dots > 0 && commas > 0:
		if strings.LastIndex(s, ",") > strings.LastIndex(s, ".") {
			s = strings.ReplaceAll(strings.ReplaceAll(s, ".", ""), ",", ".")
		} else {
			s = strings.ReplaceAll(s, ",", "")
		}
	case commas > 1:
		s = strings.ReplaceAll(s, ",", "")
	case commas == 1:
		i := strings.Index(s, ",")
		if len(s)-i-1 == 3 && s[:i] != "0" {
			s = strings.ReplaceAll(s, ",", "")
		} else {
			s = strings.ReplaceAll(s, ",", ".")
		}
	case dots > 1:
		s = strings.ReplaceAll(s, ".", "")
	}
	n, err := strconv.ParseFloat(s, 64)
	if err != nil || math.IsNaN(n) || math.IsInf(n, 0) {
		return 0, false
	}
	return n, true
}

// percentText is a share as a percentage with one decimal and no trailing ".0": "79.5%", "70%".
func percentText(share float64) string {
	return strings.TrimSuffix(strconv.FormatFloat(share*100, 'f', 1, 64), ".0") + "%"
}

// numberText is a count as Go writes it in a note: "947", "150.5".
func numberText(n float64) string { return strconv.FormatFloat(n, 'f', -1, 64) }

// relateFigures reads each verified figure of the merged list as a number (Amount, Rate, Level) and keeps each relation a
// seat declared only when it holds, rewriting it to the other figure's Value; a dropped one is said in RelNote.
//
// Of (a part of a whole) holds when:
//   - the value is a number, and a fraction in it agrees with any percentage beside it;
//   - the whole is a verified count among the figures (the one in the same group first), other than the figure itself, or,
//     for a value that writes a fraction and names no other whole, the fraction's denominator (Of is then that text);
//   - a value that writes a fraction and an Of names one denominator;
//   - the part is no larger than its whole, and the counts that are parts of one whole add up to no more than it;
//   - following wholes up from a figure never comes back to it.
//
// Was (the value before) and Limit (a threshold) each hold when they name another verified figure of the same kind (both
// counts or both rates), the one in the same group first; a Limit also sets Breach from Bound ("min", else "max"). Two
// figures that are each other's Was keep only the first one's.
//
// Then every figure linked to another by a kept relation takes the first group among the figures so linked, in list
// order, and each group is written as its first spelling (case and spaces folded). An unverified figure is left with no
// relation and no number.
func relateFigures(figs []CouncilFigure) []CouncilFigure {
	parent := make([]int, len(figs))
	wasOf := make([]int, len(figs))
	limitOf := make([]int, len(figs))
	nums := make([]figureNumber, len(figs))
	numeric := make([]bool, len(figs))
	declared := make([][3]string, len(figs)) // the seat's Of, Was and Limit
	notes := make([][]string, len(figs))
	note := func(i int, n string) { notes[i] = append(notes[i], n) }
	for i := range figs {
		parent[i], wasOf[i], limitOf[i] = -1, -1, -1
		f := &figs[i]
		f.Amount, f.Rate, f.Level, f.Share, f.Breach, f.RelNote = 0, false, 0, 0, false, ""
		f.Group, f.Unit, f.At = collapseSpace(f.Group), collapseSpace(f.Unit), collapseSpace(f.At)
		declared[i] = [3]string{strings.TrimSpace(f.Of), strings.TrimSpace(f.Was), strings.TrimSpace(f.Limit)}
		f.Of, f.Was, f.Limit = "", "", ""
		if f.Bound = strings.ToLower(strings.TrimSpace(f.Bound)); f.Bound != "min" {
			f.Bound = ""
		}
		if f.Cite != CiteOK {
			continue
		}
		n, ok := readFigureNumber(f.Value)
		if !ok {
			if declared[i] != [3]string{} {
				note(i, "the value is not a number")
			}
			continue
		}
		nums[i], numeric[i] = n, true
		f.Rate, f.Amount, f.Level = n.Rate, n.Amount, n.Amount
		if n.Rate {
			f.Level = n.Share
		}
	}
	dropOf := func(i int, why string) {
		figs[i].Of, figs[i].Share = "", 0
		parent[i] = -1
		note(i, why)
	}
	for i := range figs {
		f := &figs[i]
		if !numeric[i] || (declared[i][0] == "" && nums[i].WholeText == "") {
			continue
		}
		n := nums[i]
		if n.Mismatch != "" {
			dropOf(i, n.Mismatch)
			continue
		}
		whole, wholeText := n.Whole, n.WholeText
		if ofText := declared[i][0]; ofText != "" {
			w, ok := parseLocaleNumber(strings.TrimSpace(numberRe.FindString(ofText)))
			switch {
			case !ok:
				dropOf(i, fmt.Sprintf("the whole %q is not a number", ofText))
				continue
			case n.WholeText != "" && !nearlyEqual(w, n.Whole):
				dropOf(i, fmt.Sprintf("the value is over %s, not %s", n.WholeText, ofText))
				continue
			}
			whole, wholeText = w, ofText
		}
		if whole <= 0 {
			dropOf(i, fmt.Sprintf("the whole %s is not above 0", wholeText))
			continue
		}
		j := findFigure(figs, nums, numeric, i, "", figureNumber{Amount: whole})
		if j < 0 {
			if n.WholeText == "" {
				dropOf(i, fmt.Sprintf("the whole %s is not a checked figure", wholeText))
				continue
			}
			f.Of = n.WholeText // a fraction over a denominator no figure holds: drawn over it, linked to none
		} else {
			f.Of = figs[j].Value
			parent[i] = j
		}
		f.Share = n.Share
		if !n.Rate {
			f.Share = n.Amount / whole
		}
		if f.Share > 1+1e-9 {
			dropOf(i, fmt.Sprintf("%s is more than the whole %s", collapseSpace(f.Value), wholeText))
		}
	}
	for i := range figs {
		for j, steps := parent[i], 0; j >= 0; j, steps = parent[j], steps+1 {
			if j == i || steps > len(figs) {
				dropOf(i, "the parts and wholes form a loop")
				break
			}
		}
	}
	for j := range figs {
		var sum float64
		var kids []int
		for i := range figs {
			if parent[i] == j && !figs[i].Rate {
				sum += figs[i].Amount
				kids = append(kids, i)
			}
		}
		if len(kids) > 1 && sum > figs[j].Amount*(1+1e-9) {
			for _, i := range kids {
				dropOf(i, fmt.Sprintf("the parts of %s add up to %s, more than it", collapseSpace(figs[j].Value), numberText(sum)))
			}
		}
	}
	// was and limit: another figure of the same kind
	link := func(i int, text, what string) int {
		if text == "" {
			return -1
		}
		if !numeric[i] {
			return -1 // said once above: the value is not a number
		}
		want, ok := readFigureNumber(text)
		if !ok {
			note(i, fmt.Sprintf("the %s %q is not a number", what, text))
			return -1
		}
		if want.Rate != nums[i].Rate {
			note(i, fmt.Sprintf("the %s %s is a %s and the value a %s", what, text, kindWord(want.Rate), kindWord(nums[i].Rate)))
			return -1
		}
		j := findFigure(figs, nums, numeric, i, text, want)
		if j < 0 {
			note(i, fmt.Sprintf("the %s %s is not a checked figure", what, text))
		}
		return j
	}
	for i := range figs {
		if j := link(i, declared[i][1], "earlier value"); j >= 0 {
			if wasOf[j] == i {
				note(i, fmt.Sprintf("%s and %s are each other's earlier value", collapseSpace(figs[i].Value), collapseSpace(figs[j].Value)))
			} else {
				wasOf[i], figs[i].Was = j, figs[j].Value
			}
		}
		if j := link(i, declared[i][2], "limit"); j >= 0 {
			limitOf[i], figs[i].Limit = j, figs[j].Value
			mine, theirs := figs[i].Level, figs[j].Level
			figs[i].Breach = (figs[i].Bound == "min" && mine < theirs-1e-12) || (figs[i].Bound != "min" && mine > theirs+1e-12)
		}
		if limitOf[i] < 0 {
			figs[i].Bound = ""
		}
		figs[i].RelNote = strings.Join(notes[i], "; ")
	}
	groupFigures(figs, parent, wasOf, limitOf)
	return figs
}

func kindWord(rate bool) string {
	if rate {
		return "rate"
	}
	return "count"
}

// findFigure is the index of the verified figure other than i that a seat's text names: one whose value is that text
// (case and spaces folded), else one whose number is the text's exactly, else one within rateSlack of it (a rounded
// percentage); at each step the first in i's group, else the first anywhere; -1 for none. text "" looks by number only.
func findFigure(figs []CouncilFigure, nums []figureNumber, numeric []bool, i int, text string, want figureNumber) int {
	exact := func(n figureNumber) bool {
		if n.Rate != want.Rate {
			return false
		}
		if n.Rate {
			return nearlyEqual(n.Share, want.Share)
		}
		return nearlyEqual(n.Amount, want.Amount)
	}
	tests := []func(j int) bool{
		func(j int) bool { return text != "" && folded(figs[j].Value) == folded(text) },
		func(j int) bool { return exact(nums[j]) },
		func(j int) bool { return nums[j].sameAs(want) },
	}
	for _, test := range tests {
		first := -1
		for j := range figs {
			if j == i || !numeric[j] || !test(j) {
				continue
			}
			if folded(figs[j].Group) == folded(figs[i].Group) {
				return j
			}
			if first < 0 {
				first = j
			}
		}
		if first >= 0 {
			return first
		}
	}
	return -1
}

// groupFigures gives every figure linked to others (by a part's whole, an earlier value or a limit) the first group among
// them in list order, then writes each group as its first spelling in the list.
func groupFigures(figs []CouncilFigure, links ...[]int) {
	comp := make([]int, len(figs))
	for i := range comp {
		comp[i] = i
	}
	var find func(i int) int
	find = func(i int) int {
		for comp[i] != i {
			comp[i] = comp[comp[i]]
			i = comp[i]
		}
		return i
	}
	for _, l := range links {
		for i, j := range l {
			if j >= 0 {
				a, b := find(i), find(j)
				if a < b {
					comp[b] = a
				} else {
					comp[a] = b
				}
			}
		}
	}
	group := map[int]string{}
	for i := range figs {
		if r := find(i); group[r] == "" && figs[i].Group != "" {
			group[r] = figs[i].Group
		}
	}
	spelling := map[string]string{}
	for i := range figs {
		figs[i].Group = group[find(i)]
		if k := folded(figs[i].Group); k != "" {
			if s, ok := spelling[k]; ok {
				figs[i].Group = s
			} else {
				spelling[k] = figs[i].Group
			}
		}
	}
}
