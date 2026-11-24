// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package council

import (
	"math"
	"slices"
	"strings"
	"testing"
)

func TestParseLocaleNumber(t *testing.T) {
	cases := []struct {
		in   string
		want float64
		ok   bool
	}{
		{"947", 947, true},
		{"0.7059", 0.7059, true},
		{"79,5", 79.5, true},   // a Vietnamese decimal comma
		{"0,705", 0.705, true}, // three digits after a lone 0 are decimals, not thousands
		{"1,248", 1248, true},  // a thousands comma
		{"1,248,000", 1248000, true},
		{"1.248.000", 1248000, true}, // dots grouping thousands
		{"1,248.5", 1248.5, true},
		{"1.248,5", 1248.5, true},
		{"170,", 170, true}, // a JSON line's trailing comma
		{"", 0, false},
		{",", 0, false},
	}
	for _, c := range cases {
		got, ok := parseLocaleNumber(c.in)
		if ok != c.ok || math.Abs(got-c.want) > 1e-9 {
			t.Errorf("parseLocaleNumber(%q) = %v, %v; want %v, %v", c.in, got, ok, c.want, c.ok)
		}
	}
}

func TestReadFigureNumber(t *testing.T) {
	cases := []struct {
		in        string
		rate      bool
		share     float64
		amount    float64
		wholeText string
		mismatch  bool
		ok        bool
	}{
		{"947", false, 0, 947, "", false, true},
		{"1,248 ms", false, 0, 1248, "", false, true},
		{"0.7059", true, 0.7059, 0, "", false, true},
		{"79,5%", true, 0.795, 0, "", false, true},
		{"120/151 = 79,5%", true, 120.0 / 151, 0, "151", false, true},
		{"120/151 = 85%", true, 120.0 / 151, 0, "151", true, true},
		{"1", false, 0, 1, "", false, true}, // a whole number is a count, even 1
		{"n/a", false, 0, 0, "", false, false},
		{"3/0", false, 0, 0, "", false, false},
	}
	for _, c := range cases {
		n, ok := readFigureNumber(c.in)
		if ok != c.ok {
			t.Errorf("readFigureNumber(%q) ok = %v, want %v", c.in, ok, c.ok)
			continue
		}
		if !ok {
			continue
		}
		if n.Rate != c.rate || math.Abs(n.Share-c.share) > 1e-9 || n.Amount != c.amount || n.WholeText != c.wholeText ||
			(n.Mismatch != "") != c.mismatch {
			t.Errorf("readFigureNumber(%q) = %+v; want rate %v share %v amount %v whole %q mismatch %v", c.in, n, c.rate, c.share,
				c.amount, c.wholeText, c.mismatch)
		}
	}
}

// ok is a verified figure for relateFigures, which reads only the merged list.
func ok(value, group, of string) CouncilFigure {
	return CouncilFigure{Value: value, Measures: "m " + value, Ref: "a.md:1", Quote: value, Cite: CiteOK, Group: group, Of: of}
}

func TestRelateFigures(t *testing.T) {
	byValue := func(figs []CouncilFigure) map[string]CouncilFigure {
		m := map[string]CouncilFigure{}
		for _, f := range figs {
			m[f.Value] = f
		}
		return m
	}

	t.Run("counts split a whole, nested, and take the top whole's group", func(t *testing.T) {
		got := byValue(relateFigures([]CouncilFigure{
			ok("947", "Bản vá X.js", ""), ok("135", "", "947"), ok("94", "x.js", "135"), ok("41", "", "135"),
		}))
		if f := got["135"]; f.Of != "947" || math.Abs(f.Share-135.0/947) > 1e-9 || f.RelNote != "" {
			t.Errorf("135 = %+v, want a part of 947", f)
		}
		if f := got["94"]; f.Of != "135" || math.Abs(f.Share-94.0/135) > 1e-9 || f.Amount != 94 || f.Rate {
			t.Errorf("94 = %+v, want a count part of 135", f)
		}
		for _, v := range []string{"947", "135", "94", "41"} {
			if got[v].Group != "Bản vá X.js" {
				t.Errorf("%s's group = %q, want the top whole's", v, got[v].Group)
			}
		}
	})

	t.Run("rates over two denominators, one written as a fraction", func(t *testing.T) {
		got := byValue(relateFigures([]CouncilFigure{
			ok("0.7059", "Tỉ lệ chặn", "170"), ok("120/151 = 79,5%", "tỉ lệ  chặn", ""), ok("170", "", ""), ok("151", "", ""),
		}))
		if f := got["0.7059"]; !f.Rate || f.Of != "170" || f.Share != 0.7059 {
			t.Errorf("0.7059 = %+v, want a rate over 170", f)
		}
		if f := got["120/151 = 79,5%"]; !f.Rate || f.Of != "151" || math.Abs(f.Share-120.0/151) > 1e-9 || f.Group != "Tỉ lệ chặn" {
			t.Errorf("120/151 = %+v, want a rate over the figure 151, its group spelled as first written", f)
		}
		if got["170"].Group != "Tỉ lệ chặn" || got["151"].Group != "Tỉ lệ chặn" {
			t.Errorf("the denominators' groups = %q, %q; want the group of the rates over them", got["170"].Group, got["151"].Group)
		}
	})

	t.Run("a fraction over a denominator no figure holds is drawn over it", func(t *testing.T) {
		f := relateFigures([]CouncilFigure{ok("120/151", "", "")})[0]
		if f.Of != "151" || f.RelNote != "" || math.Abs(f.Share-120.0/151) > 1e-9 {
			t.Errorf("120/151 = %+v, want a rate over 151", f)
		}
	})

	t.Run("relations that do not hold are dropped with why", func(t *testing.T) {
		cases := []struct {
			figs []CouncilFigure
			note string // a substring of the first figure's RelNote
		}{
			{[]CouncilFigure{ok("94", "", "135")}, "the whole 135 is not a checked figure"},
			{[]CouncilFigure{ok("200", "", "135"), ok("135", "", "")}, "more than the whole 135"},
			{[]CouncilFigure{ok("120/151 = 85%", "", "")}, "120/151 is 79.5%, not 85%"},
			{[]CouncilFigure{ok("120/151", "", "170"), ok("170", "", "")}, "the value is over 151, not 170"},
			{[]CouncilFigure{ok("100", "", "150"), ok("60", "", "150"), ok("150", "", "")}, "add up to 160, more than it"},
			{[]CouncilFigure{ok("n/a", "", "150"), ok("150", "", "")}, "not a number"},
			{[]CouncilFigure{ok("5", "", "many"), ok("150", "", "")}, "is not a number"},
		}
		for _, c := range cases {
			f := relateFigures(c.figs)[0]
			if f.Of != "" || f.Share != 0 || !strings.Contains(f.RelNote, c.note) {
				t.Errorf("%+v: first = %+v, want no relation and a note holding %q", c.figs, f, c.note)
			}
		}
	})

	t.Run("an unverified figure gets no number and no relation", func(t *testing.T) {
		bad := ok("94", "g", "135")
		bad.Cite = CiteWrong
		f := relateFigures([]CouncilFigure{bad, ok("135", "", "")})[0]
		if f.Of != "" || f.Amount != 0 || f.RelNote != "" || f.Group != "g" {
			t.Errorf("unverified = %+v, want no relation, no number, its group kept", f)
		}
	})

	t.Run("two figures with the same amount cannot be each other's whole", func(t *testing.T) {
		// one may stand as the other's part; never both
		got := relateFigures([]CouncilFigure{ok("50", "", "50"), {Value: "50", Ref: "b.md:9", Quote: "50", Cite: CiteOK, Of: "50"}})
		if got[0].Of != "" && got[1].Of != "" {
			t.Errorf("both 50s are parts of each other: %+v", got)
		}
	})
}

// The figures of council 5186f93c (2026-11-24, mit-thesis): 16 declared, four of them copies of another (a file and its
// copy in local/council_inputs, or a line and the next on the same table row). They read as 12.
func TestCollectFiguresMergesCopiesAcrossFiles(t *testing.T) {
	f := func(value, measures, ref, quote string) CouncilFigure {
		return CouncilFigure{Value: value, Measures: measures, Ref: ref, Quote: quote, Cite: CiteOK}
	}
	xjs613 := "inspection. Patches are available for 947 advisories, of which 812 (86%) are confirmed to"
	xjs614 := "PoC. For the remaining, 94 patches do not block the PoC, and 41 fail installation or are n"
	c := &Council{Proposals: []CouncilProposal{
		{Id: "P1", Figures: []CouncilFigure{
			f("0.7059", "tỉ lệ blocked_clean", "local/council_inputs/replay.json:57", `"ratio": 0.7059,`),
			f("120/151 = 79,5%", "tỉ lệ chặn trong HTML", "obsidian/paper.html:566", `<td class="num">120/151 = 79,5%</td>`),
			f("94", "bản vá không chặn PoC", "wiki/xjs.md:614", xjs614),
			f("947", "advisory có bản vá", "wiki/xjs.md:613", xjs613),
		}},
		{Id: "P6", Figures: []CouncilFigure{
			f("94", "bản vá X.js không chặn PoC", "local/council_inputs/xjs_excerpt.md:87", xjs614),
			f("41", "bản vá cài lỗi", "local/council_inputs/xjs_excerpt.md:87", xjs614),
			f("947", "advisory X.js có bản vá", "local/council_inputs/xjs_excerpt.md:86", xjs613),
			f("170", "mẫu số trong file replay", "local/council_inputs/replay.json:55", `"denominator": 170,`),
		}},
		{Id: "P9", Figures: []CouncilFigure{
			f("170", "mẫu số blocked_clean", "harnesspov/results/replay.json:54", `"denominator": 170,`),
			f("79,5%", "tỉ lệ cách 1", "obsidian/paper.html:567", "120/151 = 79,5%"),
		}},
	}}
	got := collectFigures(c)
	var values []string
	for _, g := range got {
		values = append(values, g.Value)
	}
	if want := []string{"0.7059", "120/151 = 79,5%", "94", "947", "41", "170"}; !slices.Equal(values, want) {
		t.Fatalf("values = %v, want %v", values, want)
	}
	if g := got[1]; !slices.Equal(g.Refs, []string{"obsidian/paper.html:567"}) || !slices.Equal(g.From, []string{"P1", "P9"}) {
		t.Errorf("79,5%% = %+v, want the longer value kept, also at line 567, from P1 and P9", g)
	}
	if g := got[2]; !slices.Equal(g.Refs, []string{"local/council_inputs/xjs_excerpt.md:87"}) || g.Measures != "bản vá không chặn PoC" {
		t.Errorf("94 = %+v, want the paper's line with the copy's in Refs", g)
	}
	if g := got[5]; !slices.Equal(g.Refs, []string{"harnesspov/results/replay.json:54"}) {
		t.Errorf("170 = %+v, want the original file in Refs", g)
	}
}
