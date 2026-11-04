// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package council

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

// a council saved while Close existed holds "closed": it loads unpinned, the old value is not read
func TestLoadIgnoresClosed(t *testing.T) {
	root := useTempRoot(t)
	dir := filepath.Join(root, "councils")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	raw := `{"id": "old", "topic": "t", "closed": 123, "experts": [], "state": "done"}`
	if err := os.WriteFile(filepath.Join(dir, "old.json"), []byte(raw), 0o644); err != nil {
		t.Fatal(err)
	}
	c, err := Load("old")
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if c.Pinned != 0 {
		t.Errorf("a closed council loaded with Pinned %d, want 0", c.Pinned)
	}
	b, _ := json.Marshal(c)
	if strings.Contains(string(b), `"closed"`) {
		t.Errorf("the closed field survived the round trip: %s", b)
	}
}

func TestModeOf(t *testing.T) {
	for _, tc := range []struct {
		name string
		c    *Council
		want string
	}{
		{"a council saved before modes", &Council{}, ModeReview},
		{"review", &Council{Mode: ModeReview}, ModeReview},
		{"brainstorm", &Council{Mode: ModeBrainstorm}, ModeBrainstorm},
		{"nil", nil, ModeReview},
	} {
		if got := ModeOf(tc.c); got != tc.want {
			t.Errorf("ModeOf(%s) = %q, want %q", tc.name, got, tc.want)
		}
	}
}

func TestRoundsOf(t *testing.T) {
	for _, tc := range []struct {
		name string
		c    *Council
		want int
	}{
		{"a council saved before rounds", &Council{}, 2},
		{"nil", nil, 2},
		{"one", &Council{Rounds: 1}, 1},
		{"two", &Council{Rounds: 2}, 2},
		{"three", &Council{Rounds: 3}, 3},
		{"above the cap reads as two", &Council{Rounds: 4}, 2},
		{"negative reads as two", &Council{Rounds: -1}, 2},
	} {
		if got := RoundsOf(tc.c); got != tc.want {
			t.Errorf("RoundsOf(%s) = %d, want %d", tc.name, got, tc.want)
		}
	}
}

func TestSynthesisRound(t *testing.T) {
	for rounds, want := range map[int]int{0: 3, 1: 2, 2: 3, 3: 4} {
		if got := SynthesisRound(&Council{Rounds: rounds}); got != want {
			t.Errorf("SynthesisRound(rounds %d) = %d, want %d", rounds, got, want)
		}
	}
}

func TestFirstFollowRound(t *testing.T) {
	for rounds, want := range map[int]int{0: 4, 1: 3, 2: 4, 3: 5} {
		if got := FirstFollowRound(&Council{Rounds: rounds}); got != want {
			t.Errorf("FirstFollowRound(rounds %d) = %d, want %d", rounds, got, want)
		}
	}
}

func TestIsAgent(t *testing.T) {
	if IsAgent(CouncilExpert{Id: "ux"}) {
		t.Error("a role expert is not an agent")
	}
	if !IsAgent(CouncilExpert{Id: "witness", Agent: "tab-1"}) {
		t.Error("a seat with an agent tab is an agent")
	}
}

func TestHasAgents(t *testing.T) {
	experts := []CouncilExpert{{Id: "ux"}, {Id: "chair", Coordinator: true}}
	if HasAgents(&Council{Experts: experts}) {
		t.Error("an expert-only council has no agents")
	}
	if HasAgents(nil) {
		t.Error("nil has no agents")
	}
	seated := append([]CouncilExpert{{Id: "witness", Agent: "tab-1", Harness: "claude"}}, experts...)
	if !HasAgents(&Council{Experts: seated}) {
		t.Error("a council with one agent seated has agents")
	}
}

func TestHoldsDrafts(t *testing.T) {
	experts := []CouncilExpert{{Id: "ux"}, {Id: "chair", Coordinator: true}}
	seated := append([]CouncilExpert{{Id: "witness", Agent: "tab-1", Harness: "claude"}}, experts...)
	for name, tc := range map[string]struct {
		c    *Council
		want bool
	}{
		"nil":                            {nil, false},
		"no agents":                      {&Council{Experts: experts}, false},
		"no agents, started by an agent": {&Council{Experts: experts, ByAgent: true}, false},
		"agents":                         {&Council{Experts: seated}, true},
		"agents, started by an agent":    {&Council{Experts: seated, ByAgent: true}, false},
		// a stored mode is the answer, whatever the seats are now
		"held, no agents now":       {&Council{Experts: experts, DraftMode: DraftModeHeld}, true},
		"held, started by an agent": {&Council{Experts: seated, ByAgent: true, DraftMode: DraftModeHeld}, true},
		"free, agents seated":       {&Council{Experts: seated, DraftMode: DraftModeFree}, false},
	} {
		if got := HoldsDrafts(tc.c); got != tc.want {
			t.Errorf("%s: HoldsDrafts = %v, want %v", name, got, tc.want)
		}
	}
}

func TestFreezeDraftMode(t *testing.T) {
	experts := []CouncilExpert{{Id: "ux"}, {Id: "chair", Coordinator: true}}
	seated := append([]CouncilExpert{{Id: "witness", Agent: "tab-1", Harness: "claude"}}, experts...)

	// no chat at start: free, and a chat seated afterwards still reads free
	c := &Council{Experts: experts}
	freezeDraftMode(c)
	if c.DraftMode != DraftModeFree {
		t.Errorf("no chat at start froze %q, want %q", c.DraftMode, DraftModeFree)
	}
	c.Experts = seated
	if HoldsDrafts(c) {
		t.Error("a chat seated after a free start holds drafts")
	}

	// a chat at start: held, unless an agent started the council
	c = &Council{Experts: seated}
	freezeDraftMode(c)
	if c.DraftMode != DraftModeHeld {
		t.Errorf("a chat at start froze %q, want %q", c.DraftMode, DraftModeHeld)
	}
	c = &Council{Experts: seated, ByAgent: true}
	freezeDraftMode(c)
	if c.DraftMode != DraftModeFree {
		t.Errorf("a chat at start of an agent's council froze %q, want %q", c.DraftMode, DraftModeFree)
	}

	// a set mode is never overwritten
	c = &Council{Experts: seated, DraftMode: DraftModeFree}
	freezeDraftMode(c)
	if c.DraftMode != DraftModeFree {
		t.Errorf("a set free mode became %q", c.DraftMode)
	}
	c = &Council{Experts: experts, DraftMode: DraftModeHeld}
	freezeDraftMode(c)
	if c.DraftMode != DraftModeHeld {
		t.Errorf("a set held mode became %q", c.DraftMode)
	}
}

func TestSent(t *testing.T) {
	for draft, want := range map[string]bool{"": true, DraftHeld: false, DraftDropped: false} {
		if got := Sent(draft); got != want {
			t.Errorf("Sent(%q) = %v, want %v", draft, got, want)
		}
	}
}

// strongerJSON is a saved council that holds every field the "Council, stronger" change added: a quote and a checked
// cite on evidence, a proposal's verify runs and label, a reply's label, the per-expert timeline, the language, the
// snapshot commit and a Vietnamese name on an expert. Every value is non-zero, so none of it is dropped by omitempty.
const strongerJSON = `{
  "id": "stronger",
  "project": "/p",
  "feature": "f",
  "experts": [
    {"id": "skeptic", "name": "Bug hunter", "namevi": "Soi lỗi", "brief": "b", "model": "sonnet"}
  ],
  "state": "done",
  "round": 3,
  "proposals": [
    {
      "id": "P1",
      "author": "skeptic",
      "title": "t",
      "argument": "a",
      "evidence": [
        {"ref": "pkg/x/y.go:42", "quote": "if err != nil", "cite": "ok"},
        {"ref": "pkg/x/y.go:900", "cite": "wrong", "citenote": "line 900 is past the end (412 lines)"}
      ],
      "ts": 1,
      "runs": [
        {
          "command": "go test ./pkg/x -run TestY",
          "expect": "fail",
          "why": "the nil check is missing",
          "state": "fail",
          "exit": 1,
          "tail": "--- FAIL: TestY\nFAIL",
          "matched": true,
          "reason": "ran in the council's tree"
        },
        {
          "command": "cargo test slow",
          "expect": "pass",
          "state": "not-run",
          "reason": "timed out after 3 min"
        }
      ],
      "label": "ran"
    }
  ],
  "replies": [
    {
      "id": "r1",
      "proposalid": "P1",
      "author": "skeptic",
      "stance": "accept",
      "text": "t",
      "evidence": [{"ref": "pkg/x/y.go:7", "quote": "return nil", "cite": "wrong", "citenote": "quote not found near line 7"}],
      "round": 2,
      "ts": 2,
      "label": "read"
    }
  ],
  "timeline": {
    "skeptic": [
      {"ts": 10, "kind": "read", "target": "pkg/x/y.go"},
      {"ts": 11, "kind": "search", "target": "IdleSleep", "result": "3 matches"},
      {"ts": 12, "kind": "run", "target": "go test ./pkg/x -run TestY", "result": "fail"},
      {"ts": 13, "kind": "propose", "target": "P1"},
      {"ts": 14, "kind": "reply", "target": "P1"}
    ]
  },
  "lang": "vi",
  "snapshot": "0123456789abcdef0123456789abcdef01234567",
  "tokens": 0,
  "calls": 0,
  "created": 1,
  "updated": 1
}`

// A saved council with every new field loads with all of it, and loading and saving it again leaves its JSON as it was
// (Save stamps Updated, so that one key is set aside).
func TestCouncilStrongerRoundTrip(t *testing.T) {
	root := useTempRoot(t)
	dir := filepath.Join(root, "councils")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "stronger.json")
	if err := os.WriteFile(path, []byte(strongerJSON), 0o644); err != nil {
		t.Fatal(err)
	}

	c, err := Load("stronger")
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	p := c.Proposals[0]
	if p.Label != LabelRan || len(p.Runs) != 2 {
		t.Fatalf("proposal label %q with %d runs, want %q with 2", p.Label, len(p.Runs), LabelRan)
	}
	if ev := p.Evidence[0]; ev.Quote != "if err != nil" || ev.Cite != CiteOK || ev.CiteNote != "" {
		t.Errorf("first cite = %+v", ev)
	}
	if ev := p.Evidence[1]; ev.Cite != CiteWrong || ev.CiteNote != "line 900 is past the end (412 lines)" {
		t.Errorf("second cite = %+v", ev)
	}
	want := CouncilRun{
		Command: "go test ./pkg/x -run TestY", Expect: "fail", Why: "the nil check is missing", State: RunFail,
		Exit: 1, Tail: "--- FAIL: TestY\nFAIL", Matched: true, Reason: "ran in the council's tree",
	}
	if p.Runs[0] != want {
		t.Errorf("first run = %+v, want %+v", p.Runs[0], want)
	}
	if r := p.Runs[1]; r.State != RunNotRun || r.Reason != "timed out after 3 min" || r.Exit != 0 || r.Matched {
		t.Errorf("second run = %+v", r)
	}
	if r := c.Replies[0]; r.Label != LabelRead || r.Evidence[0].Cite != CiteWrong || r.Evidence[0].CiteNote == "" {
		t.Errorf("reply = %+v", r)
	}
	steps := c.Timeline["skeptic"]
	wantKinds := []string{StepRead, StepSearch, StepRun, StepPropose, StepReply}
	if len(steps) != len(wantKinds) {
		t.Fatalf("timeline holds %d steps, want %d", len(steps), len(wantKinds))
	}
	for i, k := range wantKinds {
		if steps[i].Kind != k || steps[i].Ts != int64(10+i) {
			t.Errorf("step %d = %+v, want kind %q at ts %d", i, steps[i], k, 10+i)
		}
	}
	if steps[1].Target != "IdleSleep" || steps[1].Result != "3 matches" {
		t.Errorf("search step = %+v", steps[1])
	}
	if c.Lang != LangVi || c.Snapshot != "0123456789abcdef0123456789abcdef01234567" {
		t.Errorf("lang %q, snapshot %q", c.Lang, c.Snapshot)
	}
	if c.Experts[0].NameVi != "Soi lỗi" {
		t.Errorf("expert namevi = %q", c.Experts[0].NameVi)
	}

	if err := Save(c); err != nil {
		t.Fatalf("Save: %v", err)
	}
	saved, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var before, after map[string]any
	if err := json.Unmarshal([]byte(strongerJSON), &before); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(saved, &after); err != nil {
		t.Fatal(err)
	}
	delete(before, "updated")
	delete(after, "updated")
	if !reflect.DeepEqual(before, after) {
		t.Errorf("the council changed on a load and save:\nbefore %v\nafter  %v", before, after)
	}
}

// A council saved before the change loads with every new field empty, and writes none of their keys back.
func TestCouncilStrongerOldCouncilLoadsEmpty(t *testing.T) {
	root := useTempRoot(t)
	dir := filepath.Join(root, "councils")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	raw := `{"id": "old", "project": "/p", "feature": "f",
	  "experts": [{"id": "ux", "name": "UX", "brief": "b", "model": "sonnet"}],
	  "state": "done", "round": 3,
	  "proposals": [{"id": "P1", "author": "ux", "title": "t", "argument": "a", "evidence": [{"ref": "a.go:1"}], "ts": 1}],
	  "replies": [{"id": "r1", "proposalid": "P1", "author": "ux", "stance": "accept", "text": "t", "round": 2, "ts": 2}],
	  "tokens": 0, "calls": 0, "created": 1, "updated": 1}`
	if err := os.WriteFile(filepath.Join(dir, "old.json"), []byte(raw), 0o644); err != nil {
		t.Fatal(err)
	}
	c, err := Load("old")
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	p, r := c.Proposals[0], c.Replies[0]
	if p.Label != "" || p.Runs != nil || r.Label != "" {
		t.Errorf("an old claim loads with label %q, runs %v, reply label %q", p.Label, p.Runs, r.Label)
	}
	if ev := p.Evidence[0]; ev.Quote != "" || ev.Cite != "" || ev.CiteNote != "" {
		t.Errorf("an old cite loads with %+v", ev)
	}
	if c.Timeline != nil || c.Lang != "" || c.Snapshot != "" || c.Experts[0].NameVi != "" {
		t.Errorf("an old council loads with timeline %v, lang %q, snapshot %q, namevi %q", c.Timeline, c.Lang, c.Snapshot, c.Experts[0].NameVi)
	}
	b, err := json.Marshal(c)
	if err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{`"quote"`, `"cite"`, `"citenote"`, `"runs"`, `"label"`, `"timeline"`, `"lang"`, `"snapshot"`, `"namevi"`} {
		if strings.Contains(string(b), key) {
			t.Errorf("an old council writes %s: %s", key, b)
		}
	}
}

// A group's Vietnamese name is omitted until set, and the step cap is the spec's 200.
func TestCouncilStrongerGroupAndCap(t *testing.T) {
	b, err := json.Marshal(CouncilGroup{Id: "g", Name: "G", Roles: []string{"ux"}, Coordinator: "coordinator"})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(b), "namevi") {
		t.Errorf("a group with no Vietnamese name writes it: %s", b)
	}
	b, err = json.Marshal(CouncilGroup{Id: "g", Name: "G", NameVi: "Nhóm", Roles: []string{"ux"}, Coordinator: "coordinator"})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(b), `"namevi":"Nhóm"`) {
		t.Errorf("a group with a Vietnamese name writes %s", b)
	}
	if MaxTimelineSteps != 200 {
		t.Errorf("MaxTimelineSteps = %d, want 200", MaxTimelineSteps)
	}
	// the agent seat state carries the working directory and the current tool line
	if st := (AgentSeatState{State: SeatWorking, Cwd: "/w", Activity: `Grep "x"`}); st.Cwd != "/w" || st.Activity != `Grep "x"` {
		t.Errorf("seat state = %+v", st)
	}
}

// A council saved before agents, drafts and rounds existed must read back and write out unchanged: every new field is
// omitempty, so none of them appears until it is set.
func TestNewFieldsLeaveAnOldCouncilsJSONAlone(t *testing.T) {
	c := &Council{
		Id:        "c1",
		Experts:   []CouncilExpert{{Id: "ux"}},
		Proposals: []CouncilProposal{{Id: "P1", Author: "ux"}},
		Replies:   []CouncilReply{{Id: "r1", ProposalId: "P1", Author: "ux"}},
	}
	b, err := json.Marshal(c)
	if err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{`"agent"`, `"harness"`, `"context"`, `"rounds"`, `"skips"`, `"draft"`, `"edited"`, `"draftmode"`, `"attachments"`} {
		if strings.Contains(string(b), key) {
			t.Errorf("an old council writes %s: %s", key, b)
		}
	}

	// An old council's JSON (no attachments key) reads back with none, and writes out again with no attachments key.
	var back Council
	if err := json.Unmarshal(b, &back); err != nil {
		t.Fatal(err)
	}
	if len(back.Replies) != 1 || back.Replies[0].Attachments != nil {
		t.Errorf("an old reply reads back with attachments %v", back.Replies)
	}
	again, err := json.Marshal(&back)
	if err != nil {
		t.Fatal(err)
	}
	if string(again) != string(b) {
		t.Errorf("an old council changed on a round trip:\n%s\n%s", b, again)
	}

	// A reply that carries attachments writes them, in order.
	r := CouncilReply{Id: "r2", Author: YouId, Attachments: []string{"/a/1.png", "/a/2.png"}}
	rb, err := json.Marshal(r)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(rb), `"attachments":["/a/1.png","/a/2.png"]`) {
		t.Errorf("a reply with attachments writes %s", rb)
	}

	held := CouncilProposal{Id: "P2", Draft: DraftHeld, Edited: true}
	b, err = json.Marshal(held)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(b), `"draft":"held"`) || !strings.Contains(string(b), `"edited":true`) {
		t.Errorf("a held, edited idea writes %s", b)
	}
}
