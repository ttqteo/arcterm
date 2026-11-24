// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package council

import (
	"context"
	"strings"
	"testing"
)

// refigureCouncil is a finished Review whose one seat declared five figures and no relation: four verified counts
// (947 cases, 135 of them patched, 94 and 41 of those by two tools) and one figure that failed its check.
func refigureCouncil() *Council {
	return &Council{Id: "c1", Project: "/p", Feature: "Bản vá", Question: "Tỉ lệ vá có đủ không?", Lang: LangVi, State: StateDone,
		Proposals: []CouncilProposal{{Id: "P1", Author: "ux", Figures: []CouncilFigure{
			fig("947", "số ca", "a.md:1", CiteOK),
			fig("135", "số ca đã vá", "b.md:1", CiteOK),
			fig("94", "vá bằng X", "c.md:1", CiteOK),
			fig("41", "vá bằng Y", "d.md:1", CiteOK),
			fig("12", "không khớp", "e.md:1", CiteWrong),
		}}}}
}

func TestParseRefigure(t *testing.T) {
	figs := []CouncilFigure{
		{Value: "947", Ref: "a.md:1"}, {Value: "135", Ref: "b.md:1"}, {Value: "94", Ref: "c.md:1"},
	}
	reply := fence(`{"figures": [
		{"n": 2, "group": " Ca  vá ", "of": 1, "unit": "ca"},
		{"n": 3, "of": "2", "was": 3, "limit": 9, "bound": "MIN"},
		{"n": 1, "of": "947"},
		{"n": 2, "group": "again"},
		{"n": 7, "group": "out of range"},
		{"n": 1, "limit": 2, "bound": "Min"}
	]}`)
	got, err := parseRefigure(reply, figs)
	if err != nil {
		t.Fatalf("parseRefigure: %v", err)
	}
	want := []CouncilFigure{
		{Value: "135", Ref: "b.md:1", Group: "Ca vá", Of: "947", Unit: "ca"},
		// "was" naming itself and a limit out of range are dropped, so its bound goes too
		{Value: "94", Ref: "c.md:1", Of: "135"},
		// n 1's first entry names its whole by value, which is not an n: nothing is left, so it is skipped and the
		// later entry for n 1 is read
		{Value: "947", Ref: "a.md:1", Limit: "135", Bound: "min"},
	}
	if len(got) != len(want) {
		t.Fatalf("got %d relations, want %d: %+v", len(got), len(want), got)
	}
	for i := range want {
		if got[i].Value != want[i].Value || got[i].Ref != want[i].Ref || got[i].Group != want[i].Group || got[i].Of != want[i].Of ||
			got[i].Was != want[i].Was || got[i].Limit != want[i].Limit || got[i].Bound != want[i].Bound || got[i].Unit != want[i].Unit {
			t.Errorf("relation %d = %+v, want %+v", i, got[i], want[i])
		}
	}

	if _, err := parseRefigure("no block here", figs); err == nil {
		t.Error("a reply with no JSON parsed")
	}
}

func TestRefigure(t *testing.T) {
	h := newHarness(t)
	c := refigureCouncil()
	RefreshFigures(c)
	h.f.setText("refigure/refigure", fence(`{"figures": [
		{"n": 2, "group": "Ca vá", "of": 1},
		{"n": 3, "group": "Ca vá", "of": 2},
		{"n": 4, "group": "Ca vá", "of": 2},
		{"n": 1, "group": "Ca vá"}
	]}`))
	rels, _, err := h.r.Refigure(context.Background(), c, "")
	if err != nil {
		t.Fatalf("Refigure: %v", err)
	}
	reqs := h.f.calls("refigure")
	if len(reqs) != 1 {
		t.Fatalf("%d refigure calls, want 1", len(reqs))
	}
	req := reqs[0]
	if req.Tools || req.Expert.Model != ModelRefigure || req.Cwd != "/p" {
		t.Errorf("request = tools %v model %q cwd %q, want no tools on %s in the project", req.Tools, req.Expert.Model, req.Cwd, ModelRefigure)
	}
	mustContain(t, "refigure prompt", req.Prompt, "Bản vá", "Tỉ lệ vá có đủ không?", `1. value "947"`, `4. value "41"`, "in Vietnamese")
	mustNotContain(t, "refigure prompt", req.Prompt, `"12"`)

	c.FigureRelations = rels
	RefreshFigures(c)
	byValue := map[string]CouncilFigure{}
	for _, f := range c.Figures {
		byValue[f.Value] = f
	}
	for value, of := range map[string]string{"135": "947", "94": "135", "41": "135"} {
		if f := byValue[value]; f.Of != of || f.Group != "Ca vá" || f.RelNote != "" {
			t.Errorf("figure %s = of %q group %q note %q, want of %s in Ca vá", value, f.Of, f.Group, f.RelNote, of)
		}
	}
	if f := byValue["12"]; f.Group != "" || f.Of != "" {
		t.Errorf("the unverified figure took a relation: %+v", f)
	}
	for _, f := range c.Proposals[0].Figures {
		if f.Group != "" || f.Of != "" {
			t.Errorf("a seat's own figure was changed: %+v", f)
		}
	}
}

func TestRefigureChecksAndSeatWins(t *testing.T) {
	c := refigureCouncil()
	// the seat said 94 is part of 947 itself; refigure says of 135, and 135 of 94, a part larger than its whole
	c.Proposals[0].Figures[2].Of = "947"
	c.FigureRelations = []CouncilFigure{
		{Value: "94", Ref: "c.md:1", Of: "135", Group: "Ca vá"},
		{Value: "135", Ref: "b.md:1", Of: "94"},
	}
	RefreshFigures(c)
	for _, f := range c.Figures {
		switch f.Value {
		case "94":
			if f.Of != "947" || f.Group != "Ca vá" {
				t.Errorf("94 = of %q group %q, want the seat's of 947 and refigure's group", f.Of, f.Group)
			}
		case "135":
			if f.Of != "" || f.RelNote == "" {
				t.Errorf("135 = of %q note %q, want its of 94 dropped with a reason", f.Of, f.RelNote)
			}
		}
	}
}

func TestRefigureRefused(t *testing.T) {
	h := newHarness(t)
	one := &Council{Id: "c2", Proposals: []CouncilProposal{{Id: "P1", Figures: []CouncilFigure{fig("947", "số ca", "a.md:1", CiteOK)}}}}
	RefreshFigures(one)
	if _, _, err := h.r.Refigure(context.Background(), one, ""); err == nil {
		t.Error("a council with one verified figure was refigured")
	}
	storm := refigureCouncil()
	storm.Mode = ModeBrainstorm
	if _, _, err := h.r.Refigure(context.Background(), storm, ""); err == nil {
		t.Error("a brainstorm was refigured")
	}
	if n := len(h.f.all()); n != 0 {
		t.Errorf("%d calls made, want none", n)
	}
}

func TestRelateWasAndOfOnOnePair(t *testing.T) {
	c := refigureCouncil()
	// 135 is said to be a part of 947 and its earlier value too (the whole side of the pair), 41 a part of 135 that 135
	// also had as its earlier value (the part side), and 94 only a part of 135
	c.FigureRelations = []CouncilFigure{
		{Value: "135", Ref: "b.md:1", Of: "947", Was: "947"},
		{Value: "94", Ref: "c.md:1", Of: "135"},
		{Value: "41", Ref: "d.md:1", Of: "135"},
	}
	c.Proposals[0].Figures[1].Was = "41" // the seat said 135 was 41; a seat's own field wins over refigure's
	RefreshFigures(c)
	got := map[string]CouncilFigure{}
	for _, f := range c.Figures {
		got[f.Value] = f
	}
	// 135's own field Was is the seat's 41, so refigure's "was 947" is not used; its of 947 stands
	if f := got["135"]; f.Of != "947" || f.Was != "41" {
		t.Errorf("135 = of %q was %q, want of 947 (refigure) and was 41 (the seat's)", f.Of, f.Was)
	}
	if f := got["41"]; f.Of != "" || !strings.Contains(f.RelNote, "also the earlier value of 135") {
		t.Errorf("41 = of %q note %q, want its of 135 dropped: 41 is 135's earlier value", f.Of, f.RelNote)
	}
	if f := got["94"]; f.Of != "135" || f.RelNote != "" {
		t.Errorf("94 = of %q note %q, want of 135: no was links the pair", f.Of, f.RelNote)
	}

	// the whole side: a figure whose was is also its whole
	c = refigureCouncil()
	c.FigureRelations = []CouncilFigure{{Value: "135", Ref: "b.md:1", Of: "947", Was: "947"}}
	RefreshFigures(c)
	for _, f := range c.Figures {
		if f.Value == "135" && (f.Of != "" || f.Was != "947" || !strings.Contains(f.RelNote, "also its earlier value")) {
			t.Errorf("135 = of %q was %q note %q, want the was kept and the of dropped with a reason", f.Of, f.Was, f.RelNote)
		}
	}
}
