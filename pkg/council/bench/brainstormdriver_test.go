// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package bench

import (
	"strings"
	"testing"
)

// driverExampleJSON is the example file in skills/brainstorm/SKILL.md ("The file"), copied as it stands: it must parse
// clean, since the skill defines what a valid file looks like.
const driverExampleJSON = `{
  "v": 1,
  "title": "Consumer lag alerts",
  "spec": "docs/superpowers/specs/2026-10-18-consumer-lag-alerts-design.md",
  "canvas": "consumer-lag-alerts",
  "question": {
    "n": 4, "text": "When a group stays past its lag threshold, who gets paged first?", "part": "thresholds",
    "why": "Every consumer group names an owning team, and platform keeps the one rota Alertmanager routes to today. I can't tell whether every team keeps a rota.",
    "read": "Owner first wakes the fewest people if teams keep rotas; platform first is the safe fallback if they don't.",
    "options": [
      { "label": "Owning team first, platform after 15 minutes", "detail": "The owning team is paged; platform hears if nobody acks.", "pick": true,
        "pros": ["Pages go to who can fix it.", "Needs no new config: every group already names its team."],
        "cons": ["Needs every team to keep a rota."] },
      { "label": "Platform on-call first", "detail": "Platform is paged and hands off what it can't fix.",
        "pros": ["One rota to keep."], "cons": ["Platform wakes for lag it can't fix."] },
      { "label": "Both at once", "detail": "Owner and platform are paged together.",
        "pros": ["Nothing waits on a hand-off."], "cons": ["Every page wakes two people."] }
    ],
    "approaches": [
      { "name": "Owning team first", "description": "Page the group's owning team; platform hears after 15 minutes without an ack.", "facts": ["Every consumer group names its owning team in services/*/kafka.yaml."] },
      { "name": "Platform on-call first", "description": "Page platform, which hands off what it can't fix.", "facts": ["Platform keeps the one rota Alertmanager routes to today (alertmanager/routes.yml)."] },
      { "name": "Both at once", "description": "Page the owning team and platform together.", "facts": ["An Alertmanager route with continue: true reaches two receivers."] },
      { "name": "By how far behind", "description": "Page the owner below a second, higher threshold, platform above it.", "facts": ["No group has a second threshold; thresholds is still asked."] },
      { "name": "Last deployer", "description": "Page whoever last deployed the consumer.", "facts": ["deploy/log.go records each deploy's author."] }
    ],
    "judge": { "added": [], "dropped": [
      { "name": "By how far behind", "reason": "Every group would need a second threshold, and none has one yet." },
      { "name": "Last deployer", "reason": "A deployer is not on call: a night page reaches someone off shift." }
    ] }
  },
  "working": null,
  "parts": [
    { "id": "intent", "title": "Intent and why", "state": "yours", "from": "answer 1", "gist": "Page before a lagging consumer drops data.", "body": "Page on-call before a consumer falls far enough behind to drop data." },
    { "id": "page", "title": "What on-call sees", "state": "guess", "from": "mockup", "gist": "One page per group, with the lag trend.", "body": "One page per consumer group, with the lag trend.", "boards": ["Page.dc.html"] },
    { "id": "constraints", "title": "Constraints", "state": "guess", "from": "answer 2", "gist": "Prometheus 2.45 or later.", "body": "Prometheus 2.45 or later.",
      "was": "Any Prometheus version.", "why": "your answer 4 named the growth rate, which needs Prometheus 2.45" },
    { "id": "thresholds", "title": "Thresholds", "state": "asked", "body": "" },
    { "id": "today", "title": "What runs today", "kind": "note", "from": "recon", "gist": "Every group names an owning team; nothing pages on lag yet.", "body": "kafka-exporter scrapes 14 consumer groups. Every group names an owning team in services/*/kafka.yaml. There are no lag rules in Alertmanager." },
    { "id": "builder", "title": "Left to the builder", "state": "open", "body": "" }
  ],
  "history": [
    { "kind": "question", "n": 1, "q": "What should this make possible?", "a": "Know before we drop data.", "into": ["intent"] },
    { "kind": "question", "n": 2, "q": "One threshold for every group, or one per group?", "why": "Groups range from a few hundred messages a day to millions an hour.", "a": "Per group, with a default to start from", "into": ["thresholds"],
      "options": [{ "label": "One threshold for every group", "detail": "One number to tune for every group." }, { "label": "Per group, with a default to start from", "detail": "Every group alerts from day one; teams tighten their own.", "pick": true }], "picked": 1 },
    { "kind": "recon", "q": "I offered to look at your Prometheus targets. You said yes.", "a": "Found 2.45 on every target.", "into": ["constraints"] }
  ],
  "done": false,
  "check": null,
  "run": null
}`

func TestParseBrainstormStateSkillExample(t *testing.T) {
	s, err := parseBrainstormState([]byte(driverExampleJSON))
	if err != nil {
		t.Fatalf("the skill's own example file is refused: %v", err)
	}
	if s.Question == nil || s.Question.N != 4 || !strings.HasPrefix(s.Question.Text, "When a group stays past") {
		t.Fatalf("question = %+v", s.Question)
	}
	if len(s.Question.Options) != 3 || !s.Question.Options[0].Pick || s.Question.Options[1].Pick ||
		s.Question.Options[0].Label != "Owning team first, platform after 15 minutes" {
		t.Errorf("options = %+v", s.Question.Options)
	}
	if len(s.Parts) != 6 {
		t.Fatalf("got %d parts, want 6", len(s.Parts))
	}
	if p := s.Parts[2]; p.ID != "constraints" || p.State != "guess" || !p.Was.Set || p.Was.Value != "Any Prometheus version." {
		t.Errorf("constraints = %+v", p)
	}
	if p := s.Parts[4]; p.ID != "today" || p.Kind != "note" || p.State != "" {
		t.Errorf("today = %+v", p)
	}
	if len(s.History) != 3 || s.History[1].Kind != "question" || s.History[1].A != "Per group, with a default to start from" {
		t.Errorf("history = %+v", s.History)
	}
	if s.Done || s.Check != nil || s.Working != "" {
		t.Errorf("done = %v, check = %+v, working = %q", s.Done, s.Check, s.Working)
	}
	if s.Spec != "docs/superpowers/specs/2026-10-18-consumer-lag-alerts-design.md" {
		t.Errorf("spec = %q", s.Spec)
	}
}

// driverFile is a valid file with the given pieces swapped in: the fields are raw JSON, "" keeps the valid default.
func driverFile(v, title, parts, question, check string) []byte {
	or := func(s, d string) string {
		if s == "" {
			return d
		}
		return s
	}
	return []byte(`{"v": ` + or(v, "1") + `, "title": ` + or(title, `"T"`) + `, "parts": ` + or(parts, `[{"id": "a", "state": "yours"}]`) +
		`, "question": ` + or(question, "null") + `, "check": ` + or(check, "null") + `}`)
}

func TestParseBrainstormStateBroken(t *testing.T) {
	cases := []struct {
		name string
		raw  []byte
		want string // a substring of the error, which names the rule broken
	}{
		{"not JSON", []byte(`{"v": 1,`), "invalid JSON"},
		{"empty file", []byte(``), "invalid JSON"},
		{"a JSON array", []byte(`[1]`), "not a JSON object"},
		{"v missing", []byte(`{"title": "T", "parts": []}`), "v must be the number 1"},
		{"v a string", driverFile(`"1"`, "", "", "", ""), "v must be the number 1"},
		{"v is 2", driverFile("2", "", "", "", ""), "v must be the number 1"},
		{"title missing", []byte(`{"v": 1, "parts": []}`), "title must be a string"},
		{"title a number", driverFile("", "7", "", "", ""), "title must be a string"},
		{"parts missing", []byte(`{"v": 1, "title": "T"}`), "parts must be an array"},
		{"parts null", driverFile("", "", "null", "", ""), "parts must be an array"},
		{"parts an object", driverFile("", "", `{"id": "a"}`, "", ""), "parts must be an array"},
		{"a part that is not an object", driverFile("", "", `["a"]`, "", ""), "parts[0] is not an object"},
		{"a part with no id", driverFile("", "", `[{"state": "yours"}]`, "", ""), "parts[0] needs a non-empty string id"},
		{"a part with an empty id", driverFile("", "", `[{"id": "", "state": "yours"}]`, "", ""), "parts[0] needs a non-empty string id"},
		{"a part with a numeric id", driverFile("", "", `[{"id": 3, "state": "yours"}]`, "", ""), "parts[0] needs a non-empty string id"},
		{"a repeated id", driverFile("", "", `[{"id": "a", "state": "yours"}, {"id": "b", "state": "guess"}, {"id": "a", "state": "open"}]`, "", ""), `parts[2] repeats the id "a"`},
		{"a decision with no state", driverFile("", "", `[{"id": "a"}]`, "", ""), `part "a" needs a state`},
		{"a decision with an unknown state", driverFile("", "", `[{"id": "a", "state": "done"}]`, "", ""), `part "a" needs a state`},
		{"a state in the wrong case", driverFile("", "", `[{"id": "a", "state": "Yours"}]`, "", ""), `part "a" needs a state`},
		{"a state that is not a string", driverFile("", "", `[{"id": "a", "state": 1}]`, "", ""), `part "a" needs a state`},
		{"question a string", driverFile("", "", "", `"why?"`, ""), "question must be null or an object"},
		{"question without n", driverFile("", "", "", `{"text": "q"}`, ""), "question needs a numeric n"},
		{"question with a string n", driverFile("", "", "", `{"n": "4", "text": "q"}`, ""), "question needs a numeric n"},
		{"question without text", driverFile("", "", "", `{"n": 1}`, ""), "question needs a string text"},
		{"question with a numeric text", driverFile("", "", "", `{"n": 1, "text": 5}`, ""), "question needs a string text"},
		{"check a string", driverFile("", "", "", "", `"ok"`), "check must be null or an object"},
		{"check an array", driverFile("", "", "", "", `[]`), "check must be null or an object"},
		{"the first rule broken is the one named", []byte(`{"v": 3, "title": 1, "parts": null}`), "v must be the number 1"},
		{"title comes before parts", []byte(`{"v": 1, "title": 1, "parts": null}`), "title must be a string"},
		{"parts come before question", driverFile("", "", "null", `"q"`, ""), "parts must be an array"},
		{"question comes before check", driverFile("", "", "", `"q"`, `"c"`), "question must be null or an object"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := parseBrainstormState(tc.raw)
			if err == nil {
				t.Fatalf("parsed clean, want an error naming %q", tc.want)
			}
			if !strings.Contains(err.Error(), tc.want) {
				t.Errorf("error = %q, want it to contain %q", err, tc.want)
			}
		})
	}
}

func TestParseBrainstormStateAccepts(t *testing.T) {
	cases := []struct {
		name string
		raw  []byte
	}{
		{"v written 1.0", driverFile("1.0", "", "", "", "")},
		{"no parts at all", driverFile("", "", "[]", "", "")},
		{"a note with no state", driverFile("", "", `[{"id": "n", "kind": "note"}]`, "", "")},
		{"a note with a state the rules do not know", driverFile("", "", `[{"id": "n", "kind": "note", "state": "whatever"}]`, "", "")},
		{"an empty check object", driverFile("", "", "", "", `{}`)},
		{"a question with no options", driverFile("", "", "", `{"n": 1, "text": "q"}`, "")},
		{"a fractional question number", driverFile("", "", "", `{"n": 1.5, "text": "q"}`, "")},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := parseBrainstormState(tc.raw); err != nil {
				t.Errorf("refused: %v", err)
			}
		})
	}
}

// Everything past the five rules is read leniently: a field of the wrong type is left empty, and the rest is read.
func TestParseBrainstormStateIsLenient(t *testing.T) {
	raw := []byte(`{
	  "v": 1, "title": "T", "spec": 7, "working": {"x": 1}, "done": "yes",
	  "question": {"n": 2, "text": "q", "options": [{"label": "A", "pick": "yes"}, {"label": "B", "pick": true}, "C"]},
	  "parts": [{"id": "a", "state": "guess", "was": 5, "body": 9, "title": "A"}, {"id": "b", "state": "guess", "was": null}, {"id": "c", "state": "guess", "was": ""}],
	  "history": [{"kind": "question", "a": 3}, {"kind": "question", "a": "x", "superseded": "no"}, "stray"],
	  "check": {"yours": [{"q": "x", "a": null}, {"a": ""}, {"a": 4}]}
	}`)
	s, err := parseBrainstormState(raw)
	if err != nil {
		t.Fatalf("a lenient field broke the file: %v", err)
	}
	if s.Spec != "" || s.Working != "" || s.Done {
		t.Errorf("wrong-typed fields were not left empty: spec %q, working %q, done %v", s.Spec, s.Working, s.Done)
	}
	if len(s.Question.Options) < 2 || s.Question.Options[0].Pick || s.Question.Options[0].Label != "A" || !s.Question.Options[1].Pick {
		t.Errorf("options = %+v", s.Question.Options)
	}
	if s.Parts[0].Was.Set || s.Parts[0].Title != "A" || s.Parts[0].Body != "" {
		t.Errorf("a part with a numeric was and body = %+v", s.Parts[0])
	}
	if s.Parts[1].Was.Set {
		t.Errorf("was: null must read as no was, got %+v", s.Parts[1].Was)
	}
	// Arc reads was and a as present when they are strings, an empty one included
	if w := s.Parts[2].Was; !w.Set || w.Value != "" {
		t.Errorf("was: \"\" must read as present, got %+v", w)
	}
	if got := s.Check.Yours; len(got) != 3 || got[0].A.Set || !got[1].A.Set || got[1].A.Value != "" || got[2].A.Set {
		t.Errorf("check.yours = %+v", got)
	}
}

// ---- nextStep ----

// dpart is a decision part, with the state a driver test cares about.
func dpart(id, state string) statePart {
	return statePart{ID: id, Title: id, Body: "body of " + id, State: state}
}

func dnote(id string) statePart { return statePart{ID: id, Kind: "note", Body: "background"} }

func dwas(p statePart, was string) statePart {
	p.Was = stateOptString{Set: true, Value: was}
	return p
}

func dans(s string) stateCheckEntry { return stateCheckEntry{A: stateOptString{Set: true, Value: s}} }

// dstate is a file with every decision yours, done and no check: the one step 6 acts on. A test changes what it needs.
func dstate(edit func(s *brainstormState)) brainstormState {
	s := brainstormState{
		Parts: []statePart{dpart("intent", "yours"), dnote("recon"), dpart("builder", "yours")},
		Done:  true,
	}
	if edit != nil {
		edit(&s)
	}
	return s
}

func dquestion(opts ...stateOption) *stateQuestion {
	return &stateQuestion{N: 3, Text: "Which?", Options: opts}
}

func TestNextStep(t *testing.T) {
	picked := dquestion(stateOption{Label: "Alpha"}, stateOption{Label: "Beta", Pick: true}, stateOption{Label: "Gamma"})
	cases := []struct {
		name      string
		s         brainstormState
		pending   string
		want      stepKind
		wantLine  string
		scoreDone bool
	}{
		// 1 and 2: a recorded request
		{name: "1 a judge request", s: dstate(nil), pending: "judge", want: stepJudge},
		{name: "2 a check request", s: dstate(nil), pending: "check", want: stepCheck},
		{name: "a pending judge beats an open question", s: dstate(func(s *brainstormState) { s.Question = picked }), pending: "judge", want: stepJudge},
		{name: "a pending check beats an open question", s: dstate(func(s *brainstormState) { s.Question = picked }), pending: "check", want: stepCheck},
		{name: "a pending judge beats a part with was", s: dstate(func(s *brainstormState) { s.Parts[0] = dwas(dpart("intent", "guess"), "old") }), pending: "judge", want: stepJudge},

		// 3: a question is open
		{name: "3 options: the picked label", s: dstate(func(s *brainstormState) { s.Question = picked }), want: stepSend, wantLine: "Beta"},
		{name: "3 options: a pick in the first slot", s: dstate(func(s *brainstormState) {
			s.Question = dquestion(stateOption{Label: "Alpha", Pick: true}, stateOption{Label: "Beta"})
		}), want: stepSend, wantLine: "Alpha"},
		{name: "3 no options: guess", s: dstate(func(s *brainstormState) { s.Question = dquestion() }), want: stepSend, wantLine: "brainstorm: guess"},
		{name: "3 an open question beats a part with was", s: dstate(func(s *brainstormState) {
			s.Question = picked
			s.Parts[0] = dwas(dpart("intent", "guess"), "old")
		}), want: stepSend, wantLine: "Beta"},
		{name: "3 an open question beats a guess", s: dstate(func(s *brainstormState) {
			s.Question = dquestion()
			s.Parts[0] = dpart("intent", "guess")
		}), want: stepSend, wantLine: "brainstorm: guess"},
		{name: "3 an open question while the judge is weighing still gets its answer", s: dstate(func(s *brainstormState) {
			s.Question = dquestion()
			s.Working = "The judge is weighing 5 approaches."
		}), want: stepSend, wantLine: "brainstorm: guess"},

		// 4: a part carries was
		{name: "4 was: keep every change", s: dstate(func(s *brainstormState) { s.Parts[0] = dwas(dpart("intent", "guess"), "old") }), want: stepSend, wantLine: "brainstorm: keep every change"},
		{name: "4 was beats confirm every guess", s: dstate(func(s *brainstormState) {
			s.Parts = []statePart{dpart("a", "guess"), dwas(dpart("b", "guess"), "old"), dpart("builder", "guess")}
			s.Done = false
		}), want: stepSend, wantLine: "brainstorm: keep every change"},
		{name: "4 an empty was is still a was", s: dstate(func(s *brainstormState) { s.Parts[0] = dwas(dpart("intent", "guess"), "") }), want: stepSend, wantLine: "brainstorm: keep every change"},
		{name: "4 a note's was is not a decision's", s: dstate(func(s *brainstormState) {
			n := dnote("recon")
			n.Was = stateOptString{Set: true}
			s.Parts[1] = n
		}), want: stepSend, wantLine: "brainstorm: check", scoreDone: true},

		// 5: no question is open and a decision is a guess
		{name: "5 done and a guess", s: dstate(func(s *brainstormState) { s.Parts[0] = dpart("intent", "guess") }), want: stepSend, wantLine: "brainstorm: confirm every guess"},
		{name: "5 not done and a guess", s: dstate(func(s *brainstormState) {
			s.Parts[0] = dpart("intent", "guess")
			s.Done = false
		}), want: stepSend, wantLine: "brainstorm: confirm every guess"},
		{name: "5 a note that is a guess is no decision", s: dstate(func(s *brainstormState) {
			n := dnote("recon")
			n.State = "guess"
			s.Parts[1] = n
		}), want: stepSend, wantLine: "brainstorm: check", scoreDone: true},
		{name: "5 a guess left by builder decide gets confirmed, not finished", s: dstate(func(s *brainstormState) {
			s.Parts[0] = dpart("intent", "guess")
			s.Check = &stateCheck{Yours: []stateCheckEntry{dans("x")}}
		}), want: stepSend, wantLine: "brainstorm: confirm every guess"},
		{name: "5 the builder part is a decision too", s: dstate(func(s *brainstormState) { s.Parts[2] = dpart("builder", "guess") }), want: stepSend, wantLine: "brainstorm: confirm every guess"},

		// 6: done, no check, every decision yours
		{name: "6 check, and score the done mark", s: dstate(nil), want: stepSend, wantLine: "brainstorm: check", scoreDone: true},
		{name: "6 notes in any state do not hold it back", s: dstate(func(s *brainstormState) {
			n := dnote("recon")
			n.State = "open"
			s.Parts = append(s.Parts, n)
		}), want: stepSend, wantLine: "brainstorm: check", scoreDone: true},

		// 7: a builder question with no answer
		{name: "7 builder decide", s: dstate(func(s *brainstormState) {
			s.Check = &stateCheck{Yours: []stateCheckEntry{dans("answered"), {}}}
		}), want: stepSend, wantLine: "brainstorm: builder decide"},
		{name: "7 an empty answer is an answer", s: dstate(func(s *brainstormState) {
			s.Check = &stateCheck{Yours: []stateCheckEntry{dans("")}}
		}), want: stepFinished},

		// 8: finished
		{name: "8 check with nothing left", s: dstate(func(s *brainstormState) { s.Check = &stateCheck{} }), want: stepFinished},
		{name: "8 check with every question answered", s: dstate(func(s *brainstormState) {
			s.Check = &stateCheck{Yours: []stateCheckEntry{dans("a"), dans("b")}}
		}), want: stepFinished},
		{name: "8 check set while done is false still finishes", s: dstate(func(s *brainstormState) {
			s.Check = &stateCheck{}
			s.Done = false
		}), want: stepFinished},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := nextStep(tc.s, tc.pending)
			if got.Kind != tc.want {
				t.Fatalf("kind = %q (line %q, reason %q), want %q", got.Kind, got.Line, got.Reason, tc.want)
			}
			if got.Line != tc.wantLine {
				t.Errorf("line = %q, want %q", got.Line, tc.wantLine)
			}
			if got.ScoreDone != tc.scoreDone {
				t.Errorf("ScoreDone = %v, want %v", got.ScoreDone, tc.scoreDone)
			}
		})
	}
}

func TestNextStepStuck(t *testing.T) {
	cases := []struct {
		name       string
		s          brainstormState
		wantReason []string // each is in the reason
		wantLine   []string // each is in the reminder line
	}{
		{
			name: "no question open and done is false",
			s: dstate(func(s *brainstormState) {
				s.Done = false
				s.Parts[0] = dpart("intent", "open")
			}),
			wantReason: []string{"no question is open", "done is not true"},
			wantLine:   []string{"arc:brainstorm", "question", "done"},
		},
		{
			name: "working is set and no request was made",
			s: dstate(func(s *brainstormState) {
				s.Done = false
				s.Parts[0] = dpart("intent", "yours")
				s.Working = "A builder is reading the design."
			}),
			wantReason: []string{"working is set", "no judge or builder check was started"},
			wantLine:   []string{"arc:brainstorm", "working", "wsh brainstorm"},
		},
		{
			name: "done with an asked part",
			s: dstate(func(s *brainstormState) {
				s.Parts = []statePart{dpart("intent", "yours"), dpart("limits", "asked"), dpart("builder", "yours")}
			}),
			wantReason: []string{"done is true", `"limits"`, "asked"},
			wantLine:   []string{"arc:brainstorm", "limits", "done"},
		},
		{
			name: "done with an open part, and a second one named too",
			s: dstate(func(s *brainstormState) {
				s.Parts = []statePart{dpart("intent", "open"), dpart("limits", "open"), dpart("builder", "yours")}
			}),
			wantReason: []string{"done is true", `"intent"`, `"limits"`, "open"},
			wantLine:   []string{"arc:brainstorm", "intent", "limits"},
		},
		{
			name: "done with an open part after the builder check was sorted",
			s: dstate(func(s *brainstormState) {
				s.Parts[0] = dpart("intent", "open")
				s.Check = &stateCheck{}
			}),
			wantReason: []string{"done is true", `"intent"`},
			wantLine:   []string{"arc:brainstorm", "intent"},
		},
		{
			name: "options with no pick",
			s: dstate(func(s *brainstormState) {
				s.Question = dquestion(stateOption{Label: "Alpha"}, stateOption{Label: "Beta"})
			}),
			wantReason: []string{"options", "no pick"},
			wantLine:   []string{"arc:brainstorm", "pick"},
		},
		{
			name: "options whose pick has no label",
			s: dstate(func(s *brainstormState) {
				s.Question = dquestion(stateOption{Label: "Alpha"}, stateOption{Label: "  ", Pick: true})
			}),
			wantReason: []string{"options", "no pick"},
			wantLine:   []string{"arc:brainstorm", "pick"},
		},
		{
			name: "options with no pick beat a part with was: the pane shows only the question",
			s: dstate(func(s *brainstormState) {
				s.Question = dquestion(stateOption{Label: "Alpha"})
				s.Parts[0] = dwas(dpart("intent", "guess"), "old")
			}),
			wantReason: []string{"no pick"},
			wantLine:   []string{"pick"},
		},
		{
			name: "two shapes at once are both named",
			s: dstate(func(s *brainstormState) {
				s.Done = false
				s.Parts[0] = dpart("intent", "open")
				s.Working = "still going"
			}),
			wantReason: []string{"no question is open", "working is set"},
			wantLine:   []string{"question", "working"},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := nextStep(tc.s, "")
			if got.Kind != stepStuck {
				t.Fatalf("kind = %q (line %q), want %q", got.Kind, got.Line, stepStuck)
			}
			for _, w := range tc.wantReason {
				if !strings.Contains(got.Reason, w) {
					t.Errorf("reason %q lacks %q", got.Reason, w)
				}
			}
			for _, w := range tc.wantLine {
				if !strings.Contains(got.Line, w) {
					t.Errorf("reminder %q lacks %q", got.Line, w)
				}
			}
			if strings.ContainsAny(got.Line, "\r\n") {
				t.Errorf("a reminder is one line, got %q", got.Line)
			}
			if strings.Contains(strings.ToLower(got.Line+got.Reason), "bench") {
				t.Errorf("the agent is never told about a benchmark: %q / %q", got.Line, got.Reason)
			}
			if got.ScoreDone {
				t.Error("a stuck step scores nothing")
			}
		})
	}
}

// Only the steps that send a line carry one, and a request's step carries none: the driver builds what it sends from the
// request itself.
func TestNextStepCarriesOnlyWhatItNeeds(t *testing.T) {
	for _, pending := range []string{"judge", "check"} {
		if got := nextStep(dstate(nil), pending); got.Line != "" || got.Reason != "" || got.ScoreDone {
			t.Errorf("pending %q: step = %+v", pending, got)
		}
	}
	if got := nextStep(dstate(func(s *brainstormState) { s.Check = &stateCheck{} }), ""); got.Line != "" || got.Reason != "" || got.ScoreDone {
		t.Errorf("finished: step = %+v", got)
	}
}

// ---- decisionItems, answeredQuestions ----

func TestDecisionItems(t *testing.T) {
	s := brainstormState{Parts: []statePart{
		{ID: "intent", Title: "Intent and why", Body: "Page before data drops.", State: "yours"},
		dnote("today"),
		{ID: "page", Title: "What on-call sees", Body: "One page per group.", State: "yours"},
		{ID: "builder", Title: "Left to the builder", Body: "Names and file layout.", State: "yours"},
		{ID: "thresholds", Title: "Thresholds", Body: "Per group, with a default.", State: "yours"},
	}}
	got := decisionItems(s)
	if len(got) != 3 {
		t.Fatalf("got %d items, want 3 (the note and the builder part are left out): %+v", len(got), got)
	}
	want := []struct{ title, body string }{
		{"Intent and why", "Page before data drops."},
		{"What on-call sees", "One page per group."},
		{"Thresholds", "Per group, with a default."},
	}
	for i, w := range want {
		if got[i].Title != w.title || got[i].Reasoning != w.body {
			t.Errorf("item %d = %q / %q, want %q / %q", i, got[i].Title, got[i].Reasoning, w.title, w.body)
		}
		if got[i].Rank != i+1 {
			t.Errorf("item %d has rank %d, want %d", i, got[i].Rank, i+1)
		}
	}
}

func TestDecisionItemsNoDecisions(t *testing.T) {
	if got := decisionItems(brainstormState{}); len(got) != 0 {
		t.Errorf("an empty file gave %+v", got)
	}
	if got := decisionItems(brainstormState{Parts: []statePart{dnote("n"), dpart("builder", "yours")}}); len(got) != 0 {
		t.Errorf("only a note and the builder part gave %+v", got)
	}
}

func TestAnsweredQuestions(t *testing.T) {
	s := brainstormState{History: []stateEntry{
		{Kind: "question", A: "Know before we drop data."},
		{Kind: "question", A: "Per group"},
		{Kind: "question"},                                      // asked, never answered
		{Kind: "question", Superseded: true},                    // dropped after pushback
		{Kind: "question", A: "stale answer", Superseded: true}, // dropped, whatever it holds
		{Kind: "recon", A: "Found 2.45 on every target."},       // recon is no question
	}}
	if got := answeredQuestions(s); got != 2 {
		t.Errorf("answeredQuestions = %d, want 2", got)
	}
	if got := answeredQuestions(brainstormState{}); got != 0 {
		t.Errorf("an empty history = %d, want 0", got)
	}
}
