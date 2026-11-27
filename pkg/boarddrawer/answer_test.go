// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package boarddrawer

import (
	"fmt"
	"strings"
	"testing"
)

// checkScene holds two drawings: f1 (box, note, link, wire) and f2 (other), and the loose shape loose.
var checkScene = Scene{
	Types: map[string]string{
		"box": "rectangle", "note": "text", "link": "arrow", "wire": "line", "f1": "frame",
		"other": "rectangle", "f2": "frame", "loose": "ellipse",
	},
	Frames:  map[string]string{"f1": "Cache", "f2": "API"},
	FrameOf: map[string]string{"box": "f1", "note": "f1", "link": "f1", "wire": "f1", "other": "f2"},
	Shapes:  6,
}

const (
	twelveWords   = "one two three four five six seven eight nine ten eleven twelve"
	thirteenWords = twelveWords + " thirteen"
)

const goodAdd = `[{"type":"rectangle","id":"a","x":0,"y":300,"width":10,"height":10,"label":{"text":"A"}}, {"type":"text","id":"b","x":0,"y":340,"text":"note"},{"type":"arrow","id":"ab","x":0,"y":300,"start":{"id":"a"},"end":{"id":"b"}}]`

func answerWith(fields string) string {
	return `{"title":"wavesrv, opened up"` + fields + `}`
}

func manyAdds(n int) string {
	parts := make([]string, n)
	for i := range parts {
		parts[i] = fmt.Sprintf(`{"type":"text","id":"s%d","x":0,"y":0,"text":"x"}`, i)
	}
	return "[" + strings.Join(parts, ",") + "]"
}

func TestParseAnswer(t *testing.T) {
	// an edit whose add, update and remove stay in the drawing in view
	a, err := ParseAnswer("```json\n"+answerWith(`,"edit":true,"add":`+goodAdd+`,"update":[{"id":"box", "x":40,"label":"wavesrv"},{"id":"note","text":"hi","strokeColor":"#e03131"}],"remove":["wire"]`)+"\n```", checkScene, "f1", false)
	if err != nil {
		t.Fatalf("valid answer refused: %v", err)
	}
	if !a.Edit || a.Title != "wavesrv, opened up" || a.Added != 3 || a.Changed != 2 || a.Removed != 1 || a.Question {
		t.Errorf("answer: %+v", a)
	}
	for name, s := range map[string]string{"add": a.Add, "update": a.Update} {
		if !strings.HasPrefix(s, "[") || strings.Contains(s, ", ") || strings.Contains(s, "\n") {
			t.Errorf("%s is not a compact array: %q", name, s)
		}
	}
	if len(a.Remove) != 1 || a.Remove[0] != "wire" {
		t.Errorf("remove: %v", a.Remove)
	}

	// a reply key (words) and an elsewhere key are ignored: words alone draw nothing and flag nothing, and the turn
	// decides what that means
	words, err := ParseAnswer(`{"reply":"No drawing needed.","elsewhere":true}`, checkScene, "", false)
	if err != nil || words.HasDrawing() || words.Question || words.Add != "" || words.Update != "" || words.Title != "" {
		t.Errorf("words only must be valid with no drawing and no question: %+v %v", words, err)
	}
	q, err := ParseAnswer(`{"question":true}`, checkScene, "", false)
	if err != nil || !q.Question || q.HasDrawing() {
		t.Errorf("a question flag must pass as a question: %+v %v", q, err)
	}
	// a new drawing that only adds, with or without a drawing in view
	for _, inView := range []string{"", "f1"} {
		if a, err := ParseAnswer(`{"title":"x","add":`+goodAdd+`}`, checkScene, inView, false); err != nil || a.Added != 3 || a.Edit {
			t.Errorf("a new drawing (in view %q) must pass: %+v %v", inView, a, err)
		}
	}
	at := fmt.Sprintf(`,"add":[{"type":"rectangle","id":"a","label":{"text":%q}},{"type":"text","id":"b","text":%q}],"update":[{"id":"note","text":%q},{"id":"box","label":%q}]`,
		twelveWords, twelveWords, twelveWords, twelveWords)
	if _, err := ParseAnswer(answerWith(`,"edit":true`+at), checkScene, "f1", false); err != nil {
		t.Errorf("%d words must pass: %v", MaxLabelWords, err)
	}

	edit := func(fields string) string { return answerWith(`,"edit":true` + fields) }
	cases := []struct {
		name, reply, drawing, wantErr string
	}{
		{"blank output", "  \n", "", "without a reply"},
		{"question with a drawing", `{"question":true,"title":"x","add":` + goodAdd + `}`, "", "flags a question and also changes"},
		{"question of the wrong type", `{"question":"yes"}`, "", "wrong types"},
		{"prose around", "Here:\n" + answerWith(""), "", "not one JSON object"},
		{"two objects", answerWith("") + answerWith(""), "", "not one JSON object"},
		{"an array", `[` + answerWith("") + `]`, "", "not one JSON object"},
		{"update id not in scene", answerWith(`,"update":[{"id":"nope","x":1}]`), "", `"nope", which is not on the board`},
		{"text on a non-text element", answerWith(`,"update":[{"id":"box","text":"hi"}]`), "", `text on "box"`},
		{"label on a text element", answerWith(`,"update":[{"id":"note","label":"hi"}]`), "", `label on "note"`},
		{"label on a line", answerWith(`,"update":[{"id":"wire","label":"hi"}]`), "", `label on "wire"`},
		{"unknown update key", answerWith(`,"update":[{"id":"box","angle":2}]`), "", `"angle"`},
		{"update key of the wrong type", answerWith(`,"update":[{"id":"box","x":"left"}]`), "", `"x" is not a number`},
		{"update without id", answerWith(`,"update":[{"x":1}]`), "", "has no id"},
		{"update twice", answerWith(`,"update":[{"id":"box","x":1},{"id":"box","y":1}]`), "", `"box" twice`},
		{"remove id not in scene", answerWith(`,"remove":["gone"]`), "", `remove names "gone"`},
		{"arrow binding outside add", answerWith(`,"add":[{"type":"arrow","id":"x","start":{"id":"box"}}]`), "", `binds to "box"`},
		{"bad add type", answerWith(`,"add":[{"type":"star","id":"a"}]`), "", `type "star"`},
		{"add without id", answerWith(`,"add":[{"type":"text","text":"x"}]`), "", "has no id"},
		{"add id twice", answerWith(`,"add":[{"type":"text","id":"a"},{"type":"ellipse","id":"a"}]`), "", "used twice"},
		{"drawing without a title", `{"add":` + goodAdd + `}`, "", "no title"},
		{"wrong field types", `{"remove":[1]}`, "", "wrong types"},
		{"edit with no drawing in view", edit(`,"add":` + goodAdd), "", "no drawing is in view"},
		{"edit of a drawing no longer on the board", edit(`,"add":` + goodAdd), "gone", "no drawing is in view"},
		{"edit of a shape's id as the drawing", edit(`,"add":` + goodAdd), "box", "no drawing is in view"},
		{"edit updating another drawing's shape", edit(`,"update":[{"id":"other","x":1}]`), "f1", `"other", which is outside the drawing`},
		{"edit removing a loose shape", edit(`,"remove":["loose"]`), "f1", `"loose", which is outside the drawing`},
		{"edit updating its frame", edit(`,"update":[{"id":"f1","x":1}]`), "f1", `"f1", a drawing's frame`},
		{"edit removing a frame", edit(`,"remove":["f2"]`), "f1", `"f2", a drawing's frame`},
		{"new drawing that updates", answerWith(`,"update":[{"id":"box","x":1}]`), "f1", "a new drawing only adds"},
		{"new drawing that removes", answerWith(`,"remove":["loose"]`), "", "a new drawing only adds"},
		{"41 adds", answerWith(`,"add":` + manyAdds(MaxDrawingAdds+1)), "", "adds 41 shapes"},
		{"41 adds in an edit", edit(`,"add":` + manyAdds(MaxDrawingAdds+1)), "f1", "adds 41 shapes"},
		{"added text over 12 words", answerWith(`,"add":[{"type":"text","id":"t","text":"` + thirteenWords + `"}]`), "", "13 words"},
		{"added label over 12 words", answerWith(`,"add":[{"type":"ellipse","id":"e","label":{"text":"` + thirteenWords + `"}}]`), "", "13 words"},
		{"updated label over 12 words", edit(`,"update":[{"id":"box","label":"` + thirteenWords + `"}]`), "f1", "13 words"},
		{"updated text over 12 words", edit(`,"update":[{"id":"note","text":"` + thirteenWords + `"}]`), "f1", "13 words"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, err := ParseAnswer(c.reply, checkScene, c.drawing, false)
			if err == nil || !strings.Contains(err.Error(), c.wantErr) {
				t.Fatalf("want error containing %q, got %v", c.wantErr, err)
			}
			if !strings.HasPrefix(err.Error(), unusableHead) {
				t.Errorf("error %q must start %q", err, unusableHead)
			}
		})
	}

	if _, err := ParseAnswer(answerWith(`,"add":`+manyAdds(MaxDrawingAdds)), checkScene, "", false); err != nil {
		t.Errorf("%d adds must pass: %v", MaxDrawingAdds, err)
	}
	// an edit that touches no shape draws nothing, so it has no drawing to keep to, wherever it points
	if a, err := ParseAnswer(`{"edit":true,"question":true}`, checkScene, "", false); err != nil || !a.Question || a.HasDrawing() {
		t.Errorf("a flagged question with a stray edit key must pass as a question: %+v %v", a, err)
	}
}

// the agent's request has no drawing in view: its edit names the drawing it changes, any drawing on the board
func TestParseAnswerRequestPicksTheDrawing(t *testing.T) {
	a, err := ParseAnswer(answerWith(`,"edit":true,"drawing":"f2","update":[{"id":"other","x":1}]`), checkScene, "", true)
	if err != nil || !a.Edit || a.DrawingId != "f2" || a.Changed != 1 {
		t.Fatalf("a request's edit of f2 must pass: %+v %v", a, err)
	}
	// a new drawing still only adds, and stays new
	if a, err := ParseAnswer(answerWith(`,"add":`+goodAdd), checkScene, "", true); err != nil || a.Edit || a.DrawingId != "" {
		t.Errorf("a request's new drawing must pass: %+v %v", a, err)
	}
	// a person's ask edits only the drawing in view: a drawing key there is ignored
	if a, err := ParseAnswer(answerWith(`,"edit":true,"drawing":"f2","update":[{"id":"box","x":1}]`), checkScene, "f1", false); err != nil || a.DrawingId != "f1" {
		t.Errorf("an ask's edit stays on the drawing in view: %+v %v", a, err)
	}
	edit := func(fields string) string { return answerWith(`,"edit":true` + fields) }
	cases := []struct{ name, reply, wantErr string }{
		{"no drawing key", edit(`,"update":[{"id":"other","x":1}]`), "names none"},
		{"a drawing that is gone", edit(`,"drawing":"gone","update":[{"id":"other","x":1}]`), `"gone", which is no drawing`},
		{"a shape as the drawing", edit(`,"drawing":"box","update":[{"id":"other","x":1}]`), `"box", which is no drawing`},
		{"a shape of another drawing", edit(`,"drawing":"f2","update":[{"id":"box","x":1}]`), `"box", which is outside the drawing`},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if _, err := ParseAnswer(c.reply, checkScene, "", true); err == nil || !strings.Contains(err.Error(), c.wantErr) {
				t.Fatalf("want error containing %q, got %v", c.wantErr, err)
			}
		})
	}
}

// an edit that removes its own frame deletes the whole drawing: every shape in it, then the frame
func TestParseAnswerDeletesAWholeDrawing(t *testing.T) {
	a, err := ParseAnswer(answerWith(`,"edit":true,"drawing":"f1","remove":["f1"]`), checkScene, "", true)
	if err != nil || a.DrawingId != "f1" || a.Removed != 4 {
		t.Fatalf("deleting f1: %+v %v", a, err)
	}
	if want := []string{"box", "link", "note", "wire", "f1"}; strings.Join(a.Remove, ",") != strings.Join(want, ",") {
		t.Errorf("remove: %v, want %v", a.Remove, want)
	}
	// the person's ask deletes the drawing in view the same way
	if a, err := ParseAnswer(answerWith(`,"edit":true,"remove":["f2","other"]`), checkScene, "f2", false); err != nil || a.Removed != 1 ||
		strings.Join(a.Remove, ",") != "other,f2" {
		t.Errorf("deleting f2 in view: %+v %v", a, err)
	}
	cases := []struct{ name, reply, drawing, wantErr string }{
		{"and adds to it", answerWith(`,"edit":true,"add":` + goodAdd + `,"remove":["f1"]`), "f1", "deletes the drawing"},
		{"and updates it", answerWith(`,"edit":true,"update":[{"id":"box","x":1}],"remove":["f1"]`), "f1", "deletes the drawing"},
		{"another drawing", answerWith(`,"edit":true,"remove":["f2"]`), "f1", `"f2", a drawing's frame`},
		{"as a new drawing", answerWith(`,"remove":["f1"]`), "f1", "a new drawing only adds"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if _, err := ParseAnswer(c.reply, checkScene, c.drawing, false); err == nil || !strings.Contains(err.Error(), c.wantErr) {
				t.Fatalf("want error containing %q, got %v", c.wantErr, err)
			}
		})
	}
}

// bigScene is one drawing, f1, of n shapes s0..s(n-1): a whole answer can reach MaxShapes only as an edit of it.
func bigScene(n int) Scene {
	s := Scene{
		Types: map[string]string{"f1": "frame"}, Frames: map[string]string{"f1": "Big"}, FrameOf: map[string]string{}, Shapes: n,
	}
	for i := 0; i < n; i++ {
		id := fmt.Sprintf("s%d", i)
		s.Types[id], s.FrameOf[id] = "rectangle", "f1"
	}
	return s
}

// MaxShapes caps the whole answer across add, update and remove; a new drawing (40 adds, nothing else) never gets there
func TestParseAnswerCapsTheWholeAnswer(t *testing.T) {
	scene := bigScene(MaxShapes)
	entries := func(adds, updates, removes int) string {
		upd := make([]string, updates)
		for i := range upd {
			upd[i] = fmt.Sprintf(`{"id":"s%d","x":1}`, i)
		}
		rem := make([]string, removes)
		for i := range rem {
			rem[i] = fmt.Sprintf("%q", fmt.Sprintf("s%d", updates+i))
		}
		return fmt.Sprintf(`,"edit":true,"add":%s,"update":[%s],"remove":[%s]`, manyAdds(adds), strings.Join(upd, ","), strings.Join(rem, ","))
	}
	// 40 + 80 + 80
	a, err := ParseAnswer(answerWith(entries(MaxDrawingAdds, 80, 80)), scene, "f1", false)
	if err != nil || a.Added+a.Changed+a.Removed != MaxShapes {
		t.Errorf("%d entries in an edit must pass: %+v %v", MaxShapes, a, err)
	}
	_, err = ParseAnswer(answerWith(entries(MaxDrawingAdds, 81, 80)), scene, "f1", false)
	if err == nil || !strings.Contains(err.Error(), "201 entries") || !strings.HasPrefix(err.Error(), unusableHead) {
		t.Errorf("201 entries in an edit: %v", err)
	}
	// a new drawing past 40 adds is refused, however far under 200 it is
	_, err = ParseAnswer(answerWith(`,"add":`+manyAdds(MaxDrawingAdds+1)), scene, "", false)
	if err == nil || !strings.Contains(err.Error(), "adds 41 shapes") {
		t.Errorf("41 adds in a new drawing: %v", err)
	}
}

// the 40 counts what the drawer wrote: a chart is one entry, however many shapes Arc lays out for it
func TestParseAnswerChartCountsOnceTowardTheAddLimit(t *testing.T) {
	chart := `{"type":"chart","id":"c%d","kind":"bar","x":0,"y":0,"data":[["a",1],["b",2],["c",3],["d",4]]}`
	parts := make([]string, MaxDrawingAdds)
	for i := range parts {
		parts[i] = fmt.Sprintf(chart, i)
	}
	a, err := ParseAnswer(answerWith(`,"add":[`+strings.Join(parts, ",")+`]`), checkScene, "", false)
	if err != nil || a.Added != MaxDrawingAdds {
		t.Fatalf("%d charts must pass as %d adds: %+v %v", MaxDrawingAdds, MaxDrawingAdds, a, err)
	}
	if n := strings.Count(a.Add, `"type":"rectangle"`); n <= MaxDrawingAdds {
		t.Errorf("the charts must still land as the shapes they lay out, got %d rectangles", n)
	}
	more := append(parts, fmt.Sprintf(chart, MaxDrawingAdds))
	if _, err := ParseAnswer(answerWith(`,"add":[`+strings.Join(more, ",")+`]`), checkScene, "", false); err == nil || !strings.Contains(err.Error(), "adds 41 shapes") {
		t.Errorf("41 charts: %v", err)
	}
	// a chart's title is laid out by Arc, not written as a label: the 12 words are the drawer's own text
	title := fmt.Sprintf(`[{"type":"chart","id":"c","kind":"bar","x":0,"y":0,"title":%q,"data":[["a",1]]}]`, thirteenWords)
	if _, err := ParseAnswer(answerWith(`,"add":`+title), checkScene, "", false); err != nil {
		t.Errorf("a chart's title is not counted in words: %v", err)
	}
}

// what a parsed answer does to its turn: the person's own ask may be flagged, a line that must be drawn never is
func TestParseAnswerRoutes(t *testing.T) {
	drawing := Answer{Title: "t", Add: "[]", Added: 1}
	question := Answer{Question: true}
	words := Answer{}

	if got, err := routeAnswer(drawing, ""); err != nil || !got.HasDrawing() || got.Question {
		t.Errorf("a drawing stays a drawing: %+v %v", got, err)
	}
	if got, err := routeAnswer(question, ""); err != nil || !got.Question {
		t.Errorf("a flagged ask is a question: %+v %v", got, err)
	}
	if got, err := routeAnswer(words, ""); err != nil || !got.Question || got.HasDrawing() {
		t.Errorf("an ask answered with nothing is a question, never dropped: %+v %v", got, err)
	}

	const what = "the agent's request"
	if got, err := routeAnswer(drawing, what); err != nil || !got.HasDrawing() {
		t.Errorf("a request answered with a drawing passes: %+v %v", got, err)
	}
	for name, a := range map[string]Answer{"a question flag": question, "nothing": words} {
		_, err := routeAnswer(a, what)
		if err == nil || !strings.Contains(err.Error(), "could not draw "+what) {
			t.Errorf("a request answered with %s must fail as undrawable, got %v", name, err)
		}
	}
}
