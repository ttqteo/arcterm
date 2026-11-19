// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package boarddrawer

import (
	"fmt"
	"strings"
	"testing"
)

var checkScene = Scene{Types: map[string]string{"box": "rectangle", "note": "text", "link": "arrow", "wire": "line"}, Shapes: 4}

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
	a, err := ParseAnswer("```json\n"+answerWith(`,"add":`+goodAdd+`,"update":[{"id":"box", "x":40,"label":"wavesrv"},{"id":"note","text":"hi","strokeColor":"#e03131"}],"remove":["wire"]`)+"\n```", checkScene)
	if err != nil {
		t.Fatalf("valid answer refused: %v", err)
	}
	if a.Title != "wavesrv, opened up" || a.Added != 3 || a.Changed != 2 || a.Removed != 1 || a.Question {
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
	words, err := ParseAnswer(`{"reply":"No drawing needed.","elsewhere":true}`, checkScene)
	if err != nil || words.HasDrawing() || words.Question || words.Add != "" || words.Update != "" || words.Title != "" {
		t.Errorf("words only must be valid with no drawing and no question: %+v %v", words, err)
	}
	q, err := ParseAnswer(`{"question":true}`, checkScene)
	if err != nil || !q.Question || q.HasDrawing() {
		t.Errorf("a question flag must pass as a question: %+v %v", q, err)
	}
	if a, err := ParseAnswer(`{"title":"x","add":`+goodAdd+`}`, checkScene); err != nil || a.Added != 3 {
		t.Errorf("a drawing must pass: %+v %v", a, err)
	}

	cases := []struct {
		name, reply, wantErr string
	}{
		{"blank output", "  \n", "without a reply"},
		{"question with a drawing", `{"question":true,"title":"x","add":` + goodAdd + `}`, "flags a question and also changes"},
		{"question of the wrong type", `{"question":"yes"}`, "wrong types"},
		{"prose around", "Here:\n" + answerWith(""), "not one JSON object"},
		{"two objects", answerWith("") + answerWith(""), "not one JSON object"},
		{"an array", `[` + answerWith("") + `]`, "not one JSON object"},
		{"update id not in scene", answerWith(`,"update":[{"id":"nope","x":1}]`), `"nope", which is not on the board`},
		{"text on a non-text element", answerWith(`,"update":[{"id":"box","text":"hi"}]`), `text on "box"`},
		{"label on a text element", answerWith(`,"update":[{"id":"note","label":"hi"}]`), `label on "note"`},
		{"label on a line", answerWith(`,"update":[{"id":"wire","label":"hi"}]`), `label on "wire"`},
		{"unknown update key", answerWith(`,"update":[{"id":"box","angle":2}]`), `"angle"`},
		{"update key of the wrong type", answerWith(`,"update":[{"id":"box","x":"left"}]`), `"x" is not a number`},
		{"update without id", answerWith(`,"update":[{"x":1}]`), "has no id"},
		{"update twice", answerWith(`,"update":[{"id":"box","x":1},{"id":"box","y":1}]`), `"box" twice`},
		{"remove id not in scene", answerWith(`,"remove":["gone"]`), `remove names "gone"`},
		{"arrow binding outside add", answerWith(`,"add":[{"type":"arrow","id":"x","start":{"id":"box"}}]`), `binds to "box"`},
		{"bad add type", answerWith(`,"add":[{"type":"star","id":"a"}]`), `type "star"`},
		{"add without id", answerWith(`,"add":[{"type":"text","text":"x"}]`), "has no id"},
		{"add id twice", answerWith(`,"add":[{"type":"text","id":"a"},{"type":"ellipse","id":"a"}]`), "used twice"},
		{"201 entries", answerWith(`,"add":` + manyAdds(MaxShapes) + `,"remove":["wire"]`), "201 entries"},
		{"drawing without a title", `{"add":` + goodAdd + `}`, "no title"},
		{"wrong field types", `{"remove":[1]}`, "wrong types"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, err := ParseAnswer(c.reply, checkScene)
			if err == nil || !strings.Contains(err.Error(), c.wantErr) {
				t.Fatalf("want error containing %q, got %v", c.wantErr, err)
			}
			if !strings.HasPrefix(err.Error(), unusableHead) {
				t.Errorf("error %q must start %q", err, unusableHead)
			}
		})
	}

	if _, err := ParseAnswer(answerWith(`,"add":`+manyAdds(MaxShapes)), checkScene); err != nil {
		t.Errorf("200 entries must pass: %v", err)
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
