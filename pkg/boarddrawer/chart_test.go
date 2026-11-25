// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package boarddrawer

import (
	"encoding/json"
	"math"
	"strings"
	"testing"
)

func chartAdd(t *testing.T, add string) []map[string]any {
	t.Helper()
	a, err := ParseAnswer(answerWith(`,"add":`+add), checkScene, "")
	if err != nil {
		t.Fatalf("chart refused: %v", err)
	}
	var shapes []map[string]any
	if err := json.Unmarshal([]byte(a.Add), &shapes); err != nil {
		t.Fatalf("expanded add is not a list: %v", err)
	}
	return shapes
}

func byId(shapes []map[string]any) map[string]map[string]any {
	m := map[string]map[string]any{}
	for _, s := range shapes {
		m[s["id"].(string)] = s
	}
	return m
}

func num(s map[string]any, k string) float64 {
	return s[k].(float64)
}

func TestChartBarExpandsToScale(t *testing.T) {
	shapes := chartAdd(t, `[{"type":"chart","id":"c","kind":"bar","x":0,"y":0,"title":"Tỉ lệ đúng","data":[["baseline",0.4],["LLM",0.8],["agent",0.2]]}]`)
	m := byId(shapes)
	for _, id := range []string{"c", "c-title", "c-axis", "c-bar-0", "c-bar-1", "c-bar-2", "c-value-1", "c-label-2"} {
		if m[id] == nil {
			t.Fatalf("no %q among %d shapes", id, len(shapes))
		}
	}
	if m["c"]["type"] != "rectangle" || num(m["c"], "width") != defaultChartW || num(m["c"], "height") != defaultChartH {
		t.Errorf("frame: %v", m["c"])
	}
	// the bars are to scale and stand on the zero line
	h0, h1, h2 := num(m["c-bar-0"], "height"), num(m["c-bar-1"], "height"), num(m["c-bar-2"], "height")
	if math.Abs(h1-2*h0) > 0.05 || math.Abs(h0-2*h2) > 0.05 {
		t.Errorf("bar heights not to scale: %v %v %v", h0, h1, h2)
	}
	axisY := num(m["c-axis"], "y")
	for _, id := range []string{"c-bar-0", "c-bar-1", "c-bar-2"} {
		if bottom := num(m[id], "y") + num(m[id], "height"); math.Abs(bottom-axisY) > 0.05 {
			t.Errorf("%s ends at %v, not on the zero line %v", id, bottom, axisY)
		}
	}
	if m["c-value-1"]["text"] != "0.8" || m["c-label-2"]["text"] != "agent" || m["c-title"]["text"] != "Tỉ lệ đúng" {
		t.Errorf("texts: %v %v %v", m["c-value-1"]["text"], m["c-label-2"]["text"], m["c-title"]["text"])
	}
	// one group for the whole chart, the same on every shape, and not the bare id (another answer's "c" would share it)
	group := m["c"]["groupIds"].([]any)[0].(string)
	if !strings.HasPrefix(group, "c-") {
		t.Errorf("group %q", group)
	}
	for _, s := range shapes {
		if g := s["groupIds"].([]any); len(g) != 1 || g[0] != group {
			t.Errorf("%v is not in the chart's group", s["id"])
		}
	}
}

func TestChartLineAndNegatives(t *testing.T) {
	m := byId(chartAdd(t, `[{"type":"chart","id":"l","kind":"line","x":100,"y":50,"width":300,"height":200,"data":[["T1",-2],["T2",0],["T3",4]]}]`))
	line := m["l-line"]
	if line == nil || m["l-dot-0"] == nil || m["l-dot-2"] == nil || m["l-bar-0"] != nil {
		t.Fatalf("a line chart is a line with dots: %v", m)
	}
	pts := line["points"].([]any)
	if len(pts) != 3 {
		t.Fatalf("points: %v", pts)
	}
	// y grows downward: -2 sits below the zero line, 4 above, twice as far
	axisY := num(m["l-axis"], "y")
	y0 := num(line, "y")
	yAt := func(i int) float64 { return y0 + pts[i].([]any)[1].(float64) }
	if !(yAt(0) > axisY && yAt(2) < axisY) || math.Abs((axisY-yAt(2))-2*(yAt(0)-axisY)) > 0.05 {
		t.Errorf("line not to scale around zero: axis %v, points %v %v", axisY, yAt(0), yAt(2))
	}
	if math.Abs(yAt(1)-axisY) > 0.05 {
		t.Errorf("0 is not on the zero line: %v vs %v", yAt(1), axisY)
	}
	if m["l-value-0"]["text"] != "-2" {
		t.Errorf("value text %v", m["l-value-0"]["text"])
	}
}

func TestChartKeepsOtherEntriesAndBindings(t *testing.T) {
	shapes := chartAdd(t, `[{"type":"rectangle","id":"r","x":-300,"y":0,"width":100,"height":60},{"type":"chart","id":"c","kind":"bar","x":0,"y":0,"data":[["a",1]]},{"type":"arrow","id":"rc","x":-200,"y":30,"start":{"id":"r"},"end":{"id":"c"}}]`)
	if shapes[0]["id"] != "r" || shapes[len(shapes)-1]["id"] != "rc" {
		t.Errorf("order: first %v, last %v", shapes[0]["id"], shapes[len(shapes)-1]["id"])
	}
	a, err := ParseAnswer(answerWith(`,"add":[{"type":"chart","id":"c","kind":"bar","x":0,"y":0,"data":[["a",1]]}]`), checkScene, "")
	if err != nil || a.Added != 1 {
		t.Errorf("a chart counts as one entry: %+v %v", a, err)
	}
}

func TestChartRefusals(t *testing.T) {
	many := make([]string, maxChartPoints+1)
	for i := range many {
		many[i] = `["x",1]`
	}
	cases := []struct{ name, add, wantErr string }{
		{"kind", `[{"type":"chart","id":"c","kind":"pie","x":0,"y":0,"data":[["a",1]]}]`, `kind "pie", not bar or line`},
		{"no position", `[{"type":"chart","id":"c","kind":"bar","data":[["a",1]]}]`, "has no x and y"},
		{"no data", `[{"type":"chart","id":"c","kind":"bar","x":0,"y":0,"data":[]}]`, "0 data points"},
		{"too many", `[{"type":"chart","id":"c","kind":"bar","x":0,"y":0,"data":[` + strings.Join(many, ",") + `]}]`, "25 data points"},
		{"not a pair", `[{"type":"chart","id":"c","kind":"bar","x":0,"y":0,"data":[["a","1"]]}]`, "data point 1 is not a [label, number] pair"},
		{"id clash", `[{"type":"text","id":"c-bar-0","x":0,"y":0,"text":"x"},{"type":"chart","id":"c","kind":"bar","x":0,"y":0,"data":[["a",1]]}]`, `makes the id "c-bar-0"`},
	}
	for _, tc := range cases {
		_, err := ParseAnswer(answerWith(`,"add":`+tc.add), checkScene, "")
		if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
			t.Errorf("%s: got %v, want %q", tc.name, err, tc.wantErr)
		}
	}
}

func TestSceneSummaryShowsGroup(t *testing.T) {
	file := `{"elements":[{"id":"b1","type":"rectangle","x":0,"y":0,"width":10,"height":10,"backgroundColor":"transparent","groupIds":["inner","c-1a2b"]},{"id":"r","type":"rectangle","x":0,"y":0,"width":10,"height":10,"backgroundColor":"transparent"}]}`
	scene, err := SceneSummary([]byte(file), nil)
	if err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(scene.Text, "\n")
	if !strings.Contains(lines[0], `"group":"c-1a2b"`) || strings.Contains(lines[1], "group") {
		t.Errorf("summary: %s", scene.Text)
	}
}
