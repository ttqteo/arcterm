// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package bench

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/council"
)

// The pure half of the brainstorm driver: what the driver reads of an agent's brainstorm.json
// (skills/brainstorm/SKILL.md, "The file"), and which line the simulated person sends next. No files, no processes: the
// runner reads the file and the fake wsh's requests, and asks nextStep what to do.

// brainstormState is what the driver reads of brainstorm.json. Everything the file holds past the five rules
// parseBrainstormState checks is read leniently, so a field of the wrong type reads as empty.
type brainstormState struct {
	Question *stateQuestion `json:"question"`
	Working  string         `json:"working"`
	Parts    []statePart    `json:"parts"`
	History  []stateEntry   `json:"history"`
	Done     bool           `json:"done"`
	Check    *stateCheck    `json:"check"`
	Spec     string         `json:"spec"`
}

// stateQuestion is the question the agent waits on. N is a float64 because the file's number may be written 4 or 4.0.
type stateQuestion struct {
	N       float64       `json:"n"`
	Text    string        `json:"text"`
	Options []stateOption `json:"options"`
}

type stateOption struct {
	Label string `json:"label"`
	Pick  bool   `json:"pick"`
}

// stateOptString is a string field that may be absent. Like Arc (brainstormmodel.ts, `str(raw.was) != null`), it is Set
// exactly when the file holds a JSON string there, an empty one included: null, a number or any other type leaves it
// unset. A plain *string would not do: Go allocates the pointer before it finds the type wrong.
type stateOptString struct {
	Set   bool
	Value string
}

// UnmarshalJSON never fails, so a field of the wrong type is read as absent and the rest of the file is still read.
func (o *stateOptString) UnmarshalJSON(b []byte) error {
	var s string
	if rawJSONType(b) == "string" && json.Unmarshal(b, &s) == nil {
		*o = stateOptString{Set: true, Value: s}
	}
	return nil
}

// statePart is one part of the design. A part is a decision unless Kind is "note".
type statePart struct {
	ID    string         `json:"id"`
	Title string         `json:"title"`
	Body  string         `json:"body"`
	State string         `json:"state"`
	Kind  string         `json:"kind"`
	Was   stateOptString `json:"was"`
}

// stateEntry is one finished exchange of the history.
type stateEntry struct {
	Kind       string `json:"kind"`
	A          string `json:"a"`
	Superseded bool   `json:"superseded"`
}

// stateCheck is the builder check's result. An entry of Yours is unanswered while its A is unset; like Arc, an empty
// string counts as an answer.
type stateCheck struct {
	Yours []stateCheckEntry `json:"yours"`
}

type stateCheckEntry struct {
	A stateOptString `json:"a"`
}

var partStates = []string{"yours", "guess", "asked", "open"}

// parseBrainstormState reads brainstorm.json. It applies the rules under which Arc shows an error instead of the
// brainstorm (skills/brainstorm/SKILL.md, "Arc treats the file as broken ... unless"), in the order the skill lists
// them, and the error names the first one broken. Past those the file is read leniently: a field of the wrong type is
// left empty and the rest is read.
func parseBrainstormState(raw []byte) (brainstormState, error) {
	var top map[string]json.RawMessage
	if err := json.Unmarshal(raw, &top); err != nil {
		var typeErr *json.UnmarshalTypeError
		if errors.As(err, &typeErr) {
			return brainstormState{}, errors.New("the file is not a JSON object")
		}
		return brainstormState{}, fmt.Errorf("invalid JSON: %w", err)
	}
	if top == nil {
		return brainstormState{}, errors.New("the file is not a JSON object")
	}

	var v float64
	if rawJSONType(top["v"]) != "number" || json.Unmarshal(top["v"], &v) != nil || v != 1 {
		return brainstormState{}, errors.New("v must be the number 1")
	}
	if rawJSONType(top["title"]) != "string" {
		return brainstormState{}, errors.New("title must be a string")
	}
	if err := checkStateParts(top["parts"]); err != nil {
		return brainstormState{}, err
	}
	if t := rawJSONType(top["question"]); t != "" && t != "null" {
		if t != "object" {
			return brainstormState{}, errors.New("question must be null or an object")
		}
		var q map[string]json.RawMessage
		if err := json.Unmarshal(top["question"], &q); err != nil {
			return brainstormState{}, fmt.Errorf("question must be null or an object: %w", err)
		}
		if rawJSONType(q["n"]) != "number" {
			return brainstormState{}, errors.New("question needs a numeric n")
		}
		if rawJSONType(q["text"]) != "string" {
			return brainstormState{}, errors.New("question needs a string text")
		}
	}
	if t := rawJSONType(top["check"]); t != "" && t != "null" && t != "object" {
		return brainstormState{}, errors.New("check must be null or an object")
	}

	var s brainstormState
	if err := json.Unmarshal(raw, &s); err != nil {
		// a field of the wrong type is the lenient part of the file; only a failure to read it at all is an error
		var typeErr *json.UnmarshalTypeError
		if !errors.As(err, &typeErr) {
			return brainstormState{}, fmt.Errorf("invalid JSON: %w", err)
		}
	}
	return s, nil
}

// checkStateParts applies the rules about parts: an array, every part an object with a non-empty string id that no other part
// has, and every part that is not a note with a state that is exactly yours, guess, asked or open.
func checkStateParts(raw json.RawMessage) error {
	if rawJSONType(raw) != "array" {
		return errors.New("parts must be an array")
	}
	var parts []json.RawMessage
	if err := json.Unmarshal(raw, &parts); err != nil {
		return fmt.Errorf("parts must be an array: %w", err)
	}
	seen := map[string]bool{}
	for i, p := range parts {
		if rawJSONType(p) != "object" {
			return fmt.Errorf("parts[%d] is not an object", i)
		}
		var fields map[string]json.RawMessage
		if err := json.Unmarshal(p, &fields); err != nil {
			return fmt.Errorf("parts[%d] is not an object: %w", i, err)
		}
		var id string
		if rawJSONType(fields["id"]) != "string" || json.Unmarshal(fields["id"], &id) != nil || id == "" {
			return fmt.Errorf("parts[%d] needs a non-empty string id", i)
		}
		if seen[id] {
			return fmt.Errorf("parts[%d] repeats the id %q", i, id)
		}
		seen[id] = true

		var kind string
		if rawJSONType(fields["kind"]) == "string" {
			_ = json.Unmarshal(fields["kind"], &kind) // checked to be a string just above
		}
		if kind == "note" {
			continue
		}
		var state string
		if rawJSONType(fields["state"]) != "string" || json.Unmarshal(fields["state"], &state) != nil || !slices.Contains(partStates, state) {
			got := strings.TrimSpace(string(fields["state"]))
			if got == "" {
				got = "missing"
			}
			return fmt.Errorf("part %q needs a state of yours, guess, asked or open (got %s)", id, got)
		}
	}
	return nil
}

// rawJSONType names the type of a JSON value taken from a decoded object: "" for a missing one, else string, number,
// object, array, bool or null. The document is already known to be valid JSON, so its first byte says which.
func rawJSONType(raw json.RawMessage) string {
	raw = bytes.TrimSpace(raw)
	if len(raw) == 0 {
		return ""
	}
	switch raw[0] {
	case '"':
		return "string"
	case '{':
		return "object"
	case '[':
		return "array"
	case 'n':
		return "null"
	case 't', 'f':
		return "bool"
	default:
		return "number"
	}
}

type stepKind string

const (
	stepJudge    stepKind = "judge"    // a judge request is recorded: run the judge
	stepCheck    stepKind = "check"    // a check request is recorded: run the builder reviewer
	stepSend     stepKind = "send"     // send Line as the person
	stepFinished stepKind = "finished" // the builder check is sorted and nothing is left
	stepStuck    stepKind = "stuck"    // no step applies: send the reminder in Line, and Reason says what is missing
)

// step is what the driver does next. Line is set for stepSend and stepStuck only; Reason for stepStuck only.
// ScoreDone is set on the step that sends `brainstorm: check`: the design is done and every decision is yours, so the
// driver snapshots the done mark (once; the same step comes round again if the agent never starts the check).
type step struct {
	Kind      stepKind
	Line      string
	ScoreDone bool
	Reason    string
}

// nextStep takes the first step that applies, in the order of the spec's "The driver loop" (with its "Agent's call
// (builder question 5)": confirm every guess whenever no question is open, the builder check included, and finish only
// once every decision is yours). pending is the command of the first request the fake wsh recorded and the driver has
// not handled: "judge", "check", or "" for none; anything else counts as none.
//
// A question that is open is the only thing the person can answer (Arc shows nothing else while one is open), so it
// decides the step on its own: its pick, or a guess when it has no options, or stuck when its options have no pick.
func nextStep(s brainstormState, pending string) step {
	switch pending {
	case "judge":
		return step{Kind: stepJudge}
	case "check":
		return step{Kind: stepCheck}
	}

	if q := s.Question; q != nil {
		if len(q.Options) == 0 {
			return step{Kind: stepSend, Line: "brainstorm: guess"}
		}
		for _, o := range q.Options {
			if o.Pick && strings.TrimSpace(o.Label) != "" {
				return step{Kind: stepSend, Line: o.Label}
			}
		}
		return stuckStep(stuckReason{
			reason: "the open question's options have no pick",
			line:   `The open question's options have no recommended pick. Under arc:brainstorm, mark your recommendation with "pick": true on exactly one option, and say how the options compare in read.`,
		})
	}

	decisions := stateDecisions(s)
	hasWas, hasGuess, allYours := false, false, true
	var undecided []string
	for _, p := range decisions {
		hasWas = hasWas || p.Was.Set
		hasGuess = hasGuess || p.State == "guess"
		if p.State != "yours" {
			allYours = false
		}
		if p.State == "asked" || p.State == "open" {
			undecided = append(undecided, fmt.Sprintf("%q (%s)", p.ID, p.State))
		}
	}

	switch {
	case hasWas:
		return step{Kind: stepSend, Line: "brainstorm: keep every change"}
	case hasGuess:
		return step{Kind: stepSend, Line: "brainstorm: confirm every guess"}
	case s.Done && s.Check == nil && allYours:
		return step{Kind: stepSend, Line: "brainstorm: check", ScoreDone: true}
	case s.Check != nil && hasUnansweredBuilderQuestion(s.Check):
		return step{Kind: stepSend, Line: "brainstorm: builder decide"}
	case s.Check != nil && allYours:
		return step{Kind: stepFinished}
	}

	// no step applies: the file is valid, but the agent ended its turn somewhere the person has nothing to do
	var shapes []stuckReason
	if !s.Done {
		shapes = append(shapes, stuckReason{
			reason: "no question is open and done is not true",
			line:   "brainstorm.json has no open question and done is not true. Under arc:brainstorm, a turn that waits on the user ends on a question written to `question` with the next `n`, and `done` is true only once nothing is left to ask and `question` is null. Write the file so it says which.",
		})
	}
	if s.Working != "" {
		shapes = append(shapes, stuckReason{
			reason: "working is set and no judge or builder check was started",
			line:   "brainstorm.json has `working` set, but no judge or builder check was started. Under arc:brainstorm, `working` is set only while background work runs, and the write that delivers the result sets it back to null: run `wsh brainstorm judge <path>` (or `wsh brainstorm check <path>`) for that work, or set `working` to null, and end the turn.",
		})
	}
	if s.Done && len(undecided) > 0 {
		ids := make([]string, 0, len(undecided))
		for _, p := range decisions {
			if p.State == "asked" || p.State == "open" {
				ids = append(ids, fmt.Sprintf("%q", p.ID))
			}
		}
		shapes = append(shapes, stuckReason{
			reason: "done is true with decisions still asked or open: " + strings.Join(undecided, ", "),
			line: "brainstorm.json says `done` is true, but these decisions are still asked or open: " + strings.Join(ids, ", ") +
				". Under arc:brainstorm, `done` is true only when nothing is left to ask: ask for each of them as a question under the next `n` with `done` set to false, or write the part.",
		})
	}
	if len(shapes) == 0 {
		// every state the steps skip is one of the shapes above; this keeps a Reason and a Line if one is ever missed
		shapes = append(shapes, stuckReason{
			reason: "no step applies to the file",
			line:   "brainstorm.json is in a state where nothing is waiting on the user. Under arc:brainstorm, a turn ends on the question you wait on in `question`, or on `done` true with `question` null once nothing is left to ask.",
		})
	}
	return stuckStep(shapes...)
}

// stuckReason is one way a turn can end with no step to take: what the run's failure names, and the line sent to the agent.
type stuckReason struct{ reason, line string }

// stuckStep joins the shapes that hold at once into one step: their reasons with "; ", their reminders with a space.
func stuckStep(shapes ...stuckReason) step {
	reasons := make([]string, len(shapes))
	lines := make([]string, len(shapes))
	for i, sh := range shapes {
		reasons[i], lines[i] = sh.reason, sh.line
	}
	return step{Kind: stepStuck, Reason: strings.Join(reasons, "; "), Line: strings.Join(lines, " ")}
}

// hasUnansweredBuilderQuestion reports whether an entry of check.yours has no a.
func hasUnansweredBuilderQuestion(c *stateCheck) bool {
	for _, y := range c.Yours {
		if !y.A.Set {
			return true
		}
	}
	return false
}

// stateDecisions is every part that is not a note, in file order, the builder part included: it has to be yours before
// the builder check like any other decision.
func stateDecisions(s brainstormState) []statePart {
	var out []statePart
	for _, p := range s.Parts {
		if p.Kind != "note" {
			out = append(out, p)
		}
	}
	return out
}

// decisionItems is the design as the bench judge reads it: one item per decision part, in file order, its title and its
// body. The part with id "builder" ("Left to the builder") is neither judged nor counted.
func decisionItems(s brainstormState) []council.CouncilDirection {
	var items []council.CouncilDirection
	for _, p := range stateDecisions(s) {
		if p.ID == "builder" {
			continue
		}
		items = append(items, council.CouncilDirection{Rank: len(items) + 1, Title: p.Title, Reasoning: p.Body})
	}
	return items
}

// answeredQuestions counts the questions the person answered: a question entry of the history with an answer, that was
// not dropped after pushback.
func answeredQuestions(s brainstormState) int {
	n := 0
	for _, h := range s.History {
		if h.Kind == "question" && h.A != "" && !h.Superseded {
			n++
		}
	}
	return n
}
