// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package boarddrawer

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"maps"
	"slices"
	"strings"
)

const (
	// MaxShapes is the most entries one answer may carry across add, update and remove. A new drawing only adds, so
	// only an edit can reach it.
	MaxShapes = 200
	// MaxDrawingAdds and MaxLabelWords refuse only a clear breach of "kept short": the prompt asks for far less.
	MaxDrawingAdds = 40
	MaxLabelWords  = 12
)

const (
	unusableHead = "the drawer's answer is not usable: "
	jsonFence    = "```json"
	plainFence   = "```"
)

// skeletonTypes is the vocabulary the prompt names; anything else would not convert. A chart is no skeleton: ParseAnswer
// expands it into skeletons (chart.go).
var skeletonTypes = map[string]bool{
	"rectangle": true, "ellipse": true, "diamond": true, typeText: true, "line": true, typeArrow: true, typeChart: true,
}

// labelTypes are the elements whose label is bound text: containers and arrows.
var labelTypes = map[string]bool{"rectangle": true, "ellipse": true, "diamond": true, typeArrow: true}

// updateKeys is what an update may patch, by the JSON type its value must have.
var updateKeys = map[string]string{
	"id": "string", "x": "number", "y": "number", "width": "number", "height": "number",
	"text": "string", "label": "string", "strokeColor": "string", "backgroundColor": "string",
}

// Answer is a checked drawer reply: a drawing, or a question flagged for the board's agent. Add and Update are
// compact JSON arrays, "" when empty. A drawing is new, or with Edit, a change to the drawing DrawingId names: the one
// in view, or for the agent's request the one the answer picked. An edit that removes its drawing's frame deletes the
// whole drawing: Remove then holds the frame and every shape in it.
type Answer struct {
	Title, Add, Update      string
	Remove                  []string
	Added, Changed, Removed int
	Question                bool
	Edit                    bool
	DrawingId               string
}

func (a Answer) HasDrawing() bool {
	return a.Added+a.Changed+a.Removed > 0
}

type skeletonEntry struct {
	Type  string  `json:"type"`
	Id    *string `json:"id"`
	Text  string  `json:"text"`
	Label *struct {
		Text string `json:"text"`
	} `json:"label"`
	Start *bindingId `json:"start"`
	End   *bindingId `json:"end"`
}

type bindingId struct {
	Id *string `json:"id"`
}

// ParseAnswer checks the drawer's reply against the scene it was shown and drawing, the frame id of the drawing in
// view (none when it is not a live frame). pick is the agent's request, which has no drawing in view: its edit names
// the drawing it changes with the answer's drawing key, any drawing on the board. Code, not the drawer, decides whether
// an answer is usable: one that would not apply, or reaches outside its drawing, fails the turn with the reason. Keys
// the drawer is not told about (a words reply, elsewhere, a person's ask's drawing key) are ignored.
func ParseAnswer(reply string, scene Scene, drawing string, pick bool) (Answer, error) {
	body := strings.TrimSpace(reply)
	if body == "" {
		return Answer{}, unusable("the drawer ended without a reply")
	}
	var raw struct {
		Title    string            `json:"title"`
		Add      []json.RawMessage `json:"add"`
		Update   []json.RawMessage `json:"update"`
		Remove   []string          `json:"remove"`
		Question bool              `json:"question"`
		Edit     bool              `json:"edit"`
		Drawing  string            `json:"drawing"`
	}
	obj, err := oneObject(unfence(body))
	if err != nil {
		return Answer{}, unusable("%s", err)
	}
	if err := json.Unmarshal(obj, &raw); err != nil {
		return Answer{}, unusable("the reply's fields have the wrong types (%v)", err)
	}
	a := Answer{
		Title: strings.TrimSpace(raw.Title), Remove: raw.Remove,
		Added: len(raw.Add), Changed: len(raw.Update), Removed: len(raw.Remove), Question: raw.Question, Edit: raw.Edit,
	}
	if n := a.Added + a.Changed + a.Removed; n > MaxShapes {
		return Answer{}, unusable("it has %d entries across add, update and remove, more than %d", n, MaxShapes)
	}
	if a.Question && a.HasDrawing() {
		return Answer{}, unusable("it flags a question and also changes the drawing")
	}
	if a.HasDrawing() && a.Title == "" {
		return Answer{}, unusable("it changes the drawing but has no title")
	}
	if err := checkAdd(raw.Add); err != nil {
		return Answer{}, err
	}
	// a chart counts as one entry above, and lands as the shapes it lays out
	if raw.Add, err = expandCharts(raw.Add); err != nil {
		return Answer{}, err
	}
	updated, err := checkUpdate(raw.Update, scene)
	if err != nil {
		return Answer{}, err
	}
	for _, id := range raw.Remove {
		if _, ok := scene.Types[id]; !ok {
			return Answer{}, unusable("remove names %q, which is not on the board", id)
		}
	}
	if pick && a.Edit && a.HasDrawing() {
		if drawing = strings.TrimSpace(raw.Drawing); drawing == "" {
			return Answer{}, unusable("it edits a drawing, but its drawing key names none")
		}
		if _, ok := scene.Frames[drawing]; !ok {
			return Answer{}, unusable("it edits %q, which is no drawing on the board", drawing)
		}
	}
	if err := checkScope(a, updated, raw.Remove, scene, drawing); err != nil {
		return Answer{}, err
	}
	if a.Edit && a.HasDrawing() {
		a.DrawingId = drawing
	}
	if a.Edit && slices.Contains(raw.Remove, drawing) {
		if a.Added+a.Changed > 0 {
			return Answer{}, unusable("it deletes the drawing %q and also adds or updates shapes in it", drawing)
		}
		raw.Remove = wholeDrawing(scene, drawing)
		a.Remove, a.Removed = raw.Remove, len(raw.Remove)-1
	}
	if a.Add, err = compactArray(raw.Add); err != nil {
		return Answer{}, err
	}
	if a.Update, err = compactArray(raw.Update); err != nil {
		return Answer{}, err
	}
	return a, nil
}

// routeAnswer settles what a parsed answer does to its turn. On the person's own ask (mustDraw ""), an answer that
// draws nothing is a question for the agent, so a question is never dropped. A turn that must be drawn, which mustDraw
// names ("the agent's request"), fails instead when the drawer flags it or draws nothing.
func routeAnswer(a Answer, mustDraw string) (Answer, error) {
	if mustDraw != "" && a.Question {
		return Answer{}, couldNotDraw(mustDraw, "flagged it as a question")
	}
	if mustDraw != "" && !a.HasDrawing() {
		return Answer{}, couldNotDraw(mustDraw, "drew nothing")
	}
	if !a.HasDrawing() {
		a.Question, a.Title = true, ""
	}
	return a, nil
}

func couldNotDraw(what, how string) error {
	return fmt.Errorf("the drawer could not draw %s: it %s", what, how)
}

// checkScope keeps an answer to one drawing: a new drawing only adds, and an edit changes (updates or removes) only
// shapes of the drawing it edits, never a frame but its own, which it may remove to delete the drawing. Both are kept
// short. An answer that draws nothing has no drawing to keep to, so its edit key is moot. updated and removed are the
// ids the answer updates and removes.
func checkScope(a Answer, updated, removed []string, scene Scene, drawing string) error {
	if a.Added > MaxDrawingAdds {
		return unusable("it adds %d shapes, more than %d", a.Added, MaxDrawingAdds)
	}
	if _, ok := scene.Frames[drawing]; a.Edit && a.HasDrawing() && !ok {
		return unusable("it edits the drawing in view, but no drawing is in view")
	}
	if !a.Edit && a.Changed+a.Removed > 0 {
		return unusable("a new drawing only adds shapes, and it updates or removes shapes on the board")
	}
	for _, id := range removed {
		if id == drawing {
			continue // its own frame: the whole drawing goes
		}
		if scene.Types[id] == typeFrame {
			return unusable("it changes %q, a drawing's frame, which only Arc changes", id)
		}
		if scene.FrameOf[id] != drawing {
			return unusable("it changes %q, which is outside the drawing it edits", id)
		}
	}
	for _, id := range updated {
		if scene.Types[id] == typeFrame {
			return unusable("it changes %q, a drawing's frame, which only Arc changes", id)
		}
		if scene.FrameOf[id] != drawing {
			return unusable("it changes %q, which is outside the drawing it edits", id)
		}
	}
	return nil
}

// wholeDrawing is every shape of the drawing, sorted, then its frame: what deleting it removes. A container's bound
// text is no shape of the scene; the board removes it with its container.
func wholeDrawing(scene Scene, drawing string) []string {
	var ids []string
	for _, id := range slices.Sorted(maps.Keys(scene.FrameOf)) {
		if scene.FrameOf[id] == drawing {
			ids = append(ids, id)
		}
	}
	return append(ids, drawing)
}

// tooWordy is the words a text or label has, when over MaxLabelWords; else 0.
func tooWordy(s string) int {
	if n := len(strings.Fields(s)); n > MaxLabelWords {
		return n
	}
	return 0
}

func checkAdd(add []json.RawMessage) error {
	entries := make([]skeletonEntry, len(add))
	ids := make(map[string]bool, len(add))
	for i, r := range add {
		if json.Unmarshal(r, &entries[i]) != nil {
			return unusable("add entry %d is not a shape", i+1)
		}
		e := entries[i]
		if !skeletonTypes[e.Type] {
			return unusable("add entry %d has type %q, not one of rectangle, ellipse, diamond, text, line, arrow, chart", i+1, e.Type)
		}
		if e.Id == nil || strings.TrimSpace(*e.Id) == "" {
			return unusable("add entry %d has no id", i+1)
		}
		if ids[*e.Id] {
			return unusable("the id %q is used twice in add", *e.Id)
		}
		ids[*e.Id] = true
		words := []string{e.Text}
		if e.Label != nil {
			words = append(words, e.Label.Text)
		}
		for _, s := range words {
			if n := tooWordy(s); n > 0 {
				return unusable("add entry %d's text has %d words, more than %d", i+1, n, MaxLabelWords)
			}
		}
	}
	for _, e := range entries {
		if e.Type != typeArrow {
			continue
		}
		for _, end := range []*bindingId{e.Start, e.End} {
			if end != nil && end.Id != nil && !ids[*end.Id] {
				return unusable("the arrow %q binds to %q, which is not a shape in add", *e.Id, *end.Id)
			}
		}
	}
	return nil
}

// checkUpdate returns the ids the update names.
func checkUpdate(update []json.RawMessage, scene Scene) ([]string, error) {
	ids := make([]string, 0, len(update))
	seen := make(map[string]bool, len(update))
	for i, r := range update {
		var patch map[string]json.RawMessage
		if json.Unmarshal(r, &patch) != nil || patch == nil {
			return nil, unusable("update entry %d is not an object", i+1)
		}
		for k, v := range patch {
			kind, ok := updateKeys[k]
			if !ok {
				return nil, unusable("update entry %d has the key %q, which an update cannot change", i+1, k)
			}
			if !hasKind(v, kind) {
				return nil, unusable("update entry %d's %q is not a %s", i+1, k, kind)
			}
		}
		var id string
		if json.Unmarshal(patch["id"], &id) != nil || id == "" {
			return nil, unusable("update entry %d has no id", i+1)
		}
		typ, ok := scene.Types[id]
		if !ok {
			return nil, unusable("update names %q, which is not on the board", id)
		}
		if seen[id] {
			return nil, unusable("update names %q twice", id)
		}
		seen[id] = true
		if _, ok := patch["text"]; ok && typ != typeText {
			return nil, unusable("update sets text on %q, a %s, not a text element", id, typ)
		}
		if _, ok := patch["label"]; ok && !labelTypes[typ] {
			return nil, unusable("update sets a label on %q, a %s, which has no label", id, typ)
		}
		for _, k := range []string{"text", "label"} {
			var words string
			if json.Unmarshal(patch[k], &words) != nil {
				continue
			}
			if n := tooWordy(words); n > 0 {
				return nil, unusable("update entry %d's %s has %d words, more than %d", i+1, k, n, MaxLabelWords)
			}
		}
		ids = append(ids, id)
	}
	return ids, nil
}

func hasKind(v json.RawMessage, kind string) bool {
	if kind == "number" {
		var f float64
		return json.Unmarshal(v, &f) == nil
	}
	var s string
	return json.Unmarshal(v, &s) == nil
}

func compactArray(entries []json.RawMessage) (string, error) {
	if len(entries) == 0 {
		return "", nil
	}
	// Marshal compacts each raw entry
	b, err := json.Marshal(entries)
	if err != nil {
		return "", unusable("%s", err)
	}
	return string(b), nil
}

// unfence strips one ```json (or bare ```) fence around the whole reply; anything else is left for oneObject to refuse.
func unfence(body string) string {
	if !strings.HasPrefix(body, plainFence) || !strings.HasSuffix(body, plainFence) || len(body) < 2*len(plainFence) {
		return body
	}
	inner := strings.TrimSuffix(body, plainFence)
	inner = strings.TrimPrefix(inner, jsonFence)
	inner = strings.TrimPrefix(inner, plainFence)
	if strings.Contains(inner, plainFence) {
		return body
	}
	return strings.TrimSpace(inner)
}

func oneObject(body string) (json.RawMessage, error) {
	dec := json.NewDecoder(strings.NewReader(body))
	var obj json.RawMessage
	notOne := errors.New("the reply is not one JSON object")
	if err := dec.Decode(&obj); err != nil || !bytes.HasPrefix(obj, []byte("{")) {
		return nil, notOne
	}
	if _, err := dec.Token(); err != io.EOF {
		return nil, notOne
	}
	return obj, nil
}

func unusable(format string, args ...any) error {
	return fmt.Errorf(unusableHead+format, args...)
}
