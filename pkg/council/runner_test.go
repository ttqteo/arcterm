// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package council

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/consult"
	"github.com/wavetermdev/waveterm/pkg/ideastore"
	"github.com/wavetermdev/waveterm/pkg/jobqueue"
)

// ---- the fake caller ----

// gate holds a call at its start until the test releases it, and says when the call got there.
type gate struct {
	entered chan struct{}
	release chan struct{}
	once    sync.Once
	freed   sync.Once
}

func newGate() *gate { return &gate{entered: make(chan struct{}), release: make(chan struct{})} }

// fakeCaller answers every call with canned JSON for its round, and records the requests. A call is keyed
// "<expert id>/<kind>", with kind r1, r2, r3, ans or suggest; the test can hold, fail or rewrite any key.
type fakeCaller struct {
	mu    sync.Mutex
	reqs  []CallReq
	fail  map[string]error
	text  map[string]string
	fn    map[string]func(req CallReq) string
	gates map[string]*gate
	tools map[string][]string
}

func newFake() *fakeCaller {
	return &fakeCaller{
		fail: map[string]error{}, text: map[string]string{}, fn: map[string]func(CallReq) string{},
		gates: map[string]*gate{}, tools: map[string][]string{},
	}
}

func kindOf(prompt string) string {
	switch {
	case strings.Contains(prompt, "This is round 1 of 3"):
		return "r1"
	case strings.Contains(prompt, "This is round 2 of 3"):
		return "r2"
	case strings.Contains(prompt, "This is round 3 of 3"):
		return "r3"
	case strings.Contains(prompt, "The council has already met"):
		return "ans"
	case strings.Contains(prompt, "about to review one feature"):
		return "suggest"
	}
	return "?"
}

var callTokens = map[string]int64{"r1": 100, "r2": 10, "r3": 50, "ans": 5, "suggest": 7}

func (f *fakeCaller) Call(ctx context.Context, req CallReq) (CallRes, error) {
	kind := kindOf(req.Prompt)
	key := req.Expert.Id + "/" + kind
	f.mu.Lock()
	f.reqs = append(f.reqs, req)
	g, failure, override, fn, tools := f.gates[key], f.fail[key], f.text[key], f.fn[key], f.tools[key]
	_, hasOverride := f.text[key]
	f.mu.Unlock()
	if req.OnTool != nil {
		for _, t := range tools {
			req.OnTool(t)
		}
	}
	if g != nil {
		g.once.Do(func() { close(g.entered) })
		select {
		case <-g.release:
		case <-ctx.Done():
			return CallRes{}, ctx.Err()
		}
	}
	if failure != nil {
		return CallRes{}, failure
	}
	switch {
	case hasOverride:
		return CallRes{Text: override, Tokens: callTokens[kind]}, nil
	case fn != nil:
		return CallRes{Text: fn(req), Tokens: callTokens[kind]}, nil
	}
	return CallRes{Text: canned(req, kind), Tokens: callTokens[kind]}, nil
}

func (f *fakeCaller) gate(key string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.gates[key] = newGate()
}

func (f *fakeCaller) gateOf(key string) *gate {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.gates[key]
}

func (f *fakeCaller) entered(t *testing.T, key string) {
	t.Helper()
	select {
	case <-f.gateOf(key).entered:
	case <-time.After(10 * time.Second):
		t.Fatalf("the call %s never started", key)
	}
}

func (f *fakeCaller) release(key string) {
	g := f.gateOf(key)
	g.freed.Do(func() { close(g.release) })
}

func (f *fakeCaller) setFail(key string, err error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if err == nil {
		delete(f.fail, key)
		return
	}
	f.fail[key] = err
}

func (f *fakeCaller) setText(key, text string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.text[key] = text
}

func (f *fakeCaller) clearText(key string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.text, key)
}

func (f *fakeCaller) setFn(key string, fn func(req CallReq) string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.fn[key] = fn
}

func (f *fakeCaller) setTools(key string, events ...string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.tools[key] = events
}

func (f *fakeCaller) all() []CallReq {
	f.mu.Lock()
	defer f.mu.Unlock()
	return slices.Clone(f.reqs)
}

func (f *fakeCaller) calls(kind string) []CallReq {
	var out []CallReq
	for _, r := range f.all() {
		if kindOf(r.Prompt) == kind {
			out = append(out, r)
		}
	}
	return out
}

// indexes are the positions of the calls of kind in the order they were made.
func (f *fakeCaller) indexes(kind string) []int {
	var out []int
	for i, r := range f.all() {
		if kindOf(r.Prompt) == kind {
			out = append(out, i)
		}
	}
	return out
}

// ---- canned replies ----

var (
	proposalHeadRe = regexp.MustCompile(`(?m)^### (P\d+) · `)
	askLineRe      = regexp.MustCompile(`(?m)^- \[(r\d+)\]`)
	replyHeadRe    = regexp.MustCompile(`(?m)^## Reply (r\d+)$`)
)

func mustJSON(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	return string(b)
}

func fence(body string) string { return "My review follows.\n\n```json\n" + body + "\n```\n" }

// sectionText is the body of a "## heading" section of a prompt, or "" when it has none.
func sectionText(prompt, heading string) string {
	_, rest, ok := strings.Cut(prompt, heading+"\n")
	if !ok {
		return ""
	}
	body, _, _ := strings.Cut(rest, "\n## ")
	return body
}

func idsIn(re *regexp.Regexp, text string) []string {
	var out []string
	for _, m := range re.FindAllStringSubmatch(text, -1) {
		out = append(out, m[1])
	}
	return out
}

func round1JSON(expert string) string {
	return fence(mustJSON(map[string]any{
		"overview": "Looks fine.",
		"proposals": []map[string]any{{
			"title": "Title from " + expert, "argument": "Argument from " + expert,
			"evidence": []map[string]string{{"ref": "pkg/" + expert + ".go:1"}},
		}},
	}))
}

// stancesFor is one stance per proposal in the prompt's review section, cycling accept, challenge, oppose.
func stancesFor(req CallReq) []map[string]any {
	stances := []map[string]any{}
	for i, pid := range idsIn(proposalHeadRe, sectionText(req.Prompt, "## Proposals to review")) {
		stances = append(stances, map[string]any{
			"proposalid": pid, "stance": []string{"accept", "challenge", "oppose"}[i%3],
			"reason": "Reason from " + req.Expert.Id + " on " + pid,
		})
	}
	return stances
}

func answersFor(req CallReq, ids []string) []map[string]any {
	answers := []map[string]any{}
	for _, id := range ids {
		answers = append(answers, map[string]any{"replyid": id, "text": "Answer from " + req.Expert.Id})
	}
	return answers
}

func round2JSON(req CallReq) string {
	asks := idsIn(askLineRe, sectionText(req.Prompt, "## What the person asks you"))
	return fence(mustJSON(map[string]any{"stances": stancesFor(req), "revisions": []any{}, "answers": answersFor(req, asks)}))
}

func answersJSON(req CallReq) string {
	return fence(mustJSON(map[string]any{"answers": answersFor(req, idsIn(replyHeadRe, req.Prompt))}))
}

func cannedSynthesis(text string) string {
	return fence(mustJSON(map[string]any{
		"text": text,
		"directions": []map[string]any{
			{
				"rank": 1, "title": "Show the sleep state", "reasoning": "Cheap and clear. It also helps new users.",
				"from":    []string{"P1", "P2", "P99"},
				"stances": map[string]string{"newuser": "accept", "skeptic": "challenge", "ghost": "accept", "lead": "accept"},
				"agreed":  false,
			},
			{"rank": 2, "title": "Poll less", "reasoning": "Saves RAM.", "from": []string{"P3"}, "stances": map[string]string{"ux": "accept"}, "agreed": true},
		},
		"outcomes": map[string]string{"P1": "Direction 1", "P2": "Merged into direction 1", "P3": "Direction 2", "P4": "Withdrawn in round 2", "P99": "ghost"},
		"weak":     []map[string]string{{"ref": "P4", "note": "\"about 3 s\" has no measurement"}},
	}))
}

// titledSynthesis is a synthesis of directions with the given titles, all from P1.
func titledSynthesis(text string, titles ...string) string {
	dirs := []map[string]any{}
	for i, title := range titles {
		dirs = append(dirs, map[string]any{
			"rank": i + 1, "title": title, "reasoning": "Reason for " + title + ". More.", "from": []string{"P1"},
			"stances": map[string]string{}, "agreed": true,
		})
	}
	return fence(mustJSON(map[string]any{"text": text, "directions": dirs, "outcomes": map[string]string{"P1": "Direction 1"}, "weak": []any{}}))
}

func canned(req CallReq, kind string) string {
	switch kind {
	case "r1":
		return round1JSON(req.Expert.Id)
	case "r2":
		return round2JSON(req)
	case "r3":
		return cannedSynthesis("The panel prefers showing the state.")
	case "ans":
		return answersJSON(req)
	}
	return "no canned reply for " + kind
}

// ---- the harness ----

func testCouncil(id string) *Council {
	return &Council{
		Id: id, Project: `D:\proj`, Feature: "Idle sleep for services", Question: "Which direction first?",
		Files: []string{"pkg/services/idle.go"},
		Experts: []CouncilExpert{
			{Id: "ux", Name: "UX", Brief: "Can someone use it without being told how?", Model: "sonnet"},
			{Id: "ram", Name: "RAM", Brief: "What stays in memory?", Model: "sonnet"},
			{Id: "newuser", Name: "New user", Brief: "You know none of its names.", Model: "sonnet"},
			{Id: "skeptic", Name: "Skeptic", Brief: "Name what breaks.", Model: "sonnet"},
			{Id: "lead", Name: "Lead", Brief: "Merge and rank.", Model: "opus", Coordinator: true},
		},
	}
}

// fixtureCouncil is a council as a run would leave it, saved without running anything: two proposals and a challenge
// with an answer on the first.
func fixtureCouncil(id string, state CouncilState, round int) *Council {
	c := testCouncil(id)
	c.State, c.Round, c.Created, c.Started = state, round, 1, 1
	c.Proposals = []CouncilProposal{
		{Id: "P1", Author: "ux", Title: "Title from ux", Argument: "Argument from ux", Evidence: []CouncilEvidence{{Ref: "a.go:1"}}, Ts: 1},
		{Id: "P2", Author: "ram", Title: "Title from ram", Argument: "Argument from ram", Evidence: []CouncilEvidence{{Ref: "b.go:2"}}, Ts: 1},
	}
	if round >= 2 {
		c.Replies = []CouncilReply{
			{Id: "r1", ProposalId: "P1", Author: "skeptic", Stance: StanceChallenge, Text: "It breaks.", Round: 2, Ts: 2},
			{Id: "r2", ProposalId: "P1", ParentId: "r1", Author: "ux", Text: "Fair.", Round: 2, Ts: 3},
		}
	}
	return c
}

type harness struct {
	t     *testing.T
	r     *Runner
	f     *fakeCaller
	ideas string // the root the ideas store uses
	clock int64

	mu   sync.Mutex
	seen []Council
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	useTempRoot(t)
	useTempConfig(t)
	h := &harness{t: t, f: newFake(), ideas: t.TempDir(), clock: 1_700_000_000_000}
	t.Cleanup(ideastore.UseRootForTest(h.ideas))
	h.r = &Runner{Caller: h.f, Now: h.tick, OnChange: func(c *Council) {
		h.mu.Lock()
		defer h.mu.Unlock()
		h.seen = append(h.seen, *c)
	}}
	t.Cleanup(h.drain) // registered last, so it runs before the temp dirs go
	return h
}

func (h *harness) tick() int64 { return atomic.AddInt64(&h.clock, 1000) }

// drain stops every run still going, so none writes to a store the test has already removed.
func (h *harness) drain() {
	h.r.mu.Lock()
	var runs []*run
	for _, rn := range h.r.active {
		runs = append(runs, rn)
	}
	h.r.mu.Unlock()
	for _, rn := range runs {
		rn.cancel()
		select {
		case <-rn.done:
		case <-time.After(10 * time.Second):
		}
	}
}

func (h *harness) start(c *Council) *Council {
	h.t.Helper()
	saved, err := h.r.Start(context.Background(), c)
	if err != nil {
		h.t.Fatalf("Start: %v", err)
	}
	return saved
}

func (h *harness) wait(id string) *Council {
	h.t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	c, err := h.r.Wait(ctx, id)
	if err != nil {
		h.t.Fatalf("Wait(%s): %v", id, err)
	}
	return c
}

func (h *harness) load(id string) *Council {
	h.t.Helper()
	c, err := Load(id)
	if err != nil {
		h.t.Fatalf("Load(%s): %v", id, err)
	}
	return c
}

func (h *harness) save(c *Council) {
	h.t.Helper()
	if err := Save(c); err != nil {
		h.t.Fatalf("Save: %v", err)
	}
}

// run starts a council and waits for it to stop.
func (h *harness) run(c *Council) *Council {
	h.t.Helper()
	h.start(c)
	return h.wait(c.Id)
}

func waitFor(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func proposalOf(t *testing.T, c *Council, id string) CouncilProposal {
	t.Helper()
	p := findProposal(c, id)
	if p == nil {
		t.Fatalf("council has no proposal %s", id)
	}
	return *p
}

func replyOf(t *testing.T, c *Council, id string) CouncilReply {
	t.Helper()
	r := findReply(c, id)
	if r == nil {
		t.Fatalf("council has no reply %s", id)
	}
	return *r
}

func repliesBy(c *Council, author string) []CouncilReply {
	var out []CouncilReply
	for _, r := range c.Replies {
		if r.Author == author {
			out = append(out, r)
		}
	}
	return out
}

func panelIds() []string { return []string{"ux", "ram", "newuser", "skeptic"} }

// ---- the rounds ----

func TestStartRunsThreeRounds(t *testing.T) {
	h := newHarness(t)
	order := []string{"ram", "ux", "skeptic", "newuser"}
	for _, id := range order {
		h.f.gate(id + "/r1")
	}
	saved := h.start(testCouncil("c1"))
	if saved.State != StateRunning || saved.Round != 1 || saved.Started == 0 || saved.Created == 0 {
		t.Fatalf("Start returned %s round %d started %d created %d, want a running council in round 1", saved.State, saved.Round, saved.Started, saved.Created)
	}

	// every expert's call is in flight before any returns
	for _, id := range order {
		h.f.entered(t, id+"/r1")
	}
	// proposals get ids in the order the replies arrive
	for i, id := range order {
		h.f.release(id + "/r1")
		waitFor(t, "proposal "+id, func() bool { return len(h.load("c1").Proposals) == i+1 })
		if p := h.load("c1").Proposals[i]; p.Id != fmt.Sprintf("P%d", i+1) || p.Author != id || p.Title != "Title from "+id || p.Ts == 0 {
			t.Fatalf("proposal %d = %+v, want P%d by %s", i+1, p, i+1, id)
		}
	}

	c := h.wait("c1")
	if c.State != StateDone || c.Round != 3 || c.Error != "" || c.Summary == nil || c.Summary.At == 0 {
		t.Fatalf("final = %s round %d error %q summary %v, want done in round 3 with a summary", c.State, c.Round, c.Error, c.Summary)
	}
	if c.Calls != 9 || c.Tokens != 4*100+4*10+50 {
		t.Errorf("calls %d tokens %d, want 9 and 490", c.Calls, c.Tokens)
	}
	if c.Started == 0 || len(c.Activity) != 0 || len(c.Failed) != 0 {
		t.Errorf("started %d activity %v failed %v, want it set and the others empty", c.Started, c.Activity, c.Failed)
	}
	for _, id := range panelIds() {
		st := c.Stats[id]
		if st.Calls != 2 || st.Tokens != 110 || st.Ms <= 0 {
			t.Errorf("stats[%s] = %+v, want 2 calls, 110 tokens and some time", id, st)
		}
	}
	if st := c.Stats["lead"]; st.Calls != 1 || st.Tokens != 50 || st.Ms <= 0 {
		t.Errorf("stats[lead] = %+v, want the synthesis alone", st)
	}

	// the requests: round 1 reads the project, rounds 2 and 3 read text, the coordinator runs on its own model
	r1, r2, r3 := h.f.calls("r1"), h.f.calls("r2"), h.f.calls("r3")
	if len(r1) != 4 || len(r2) != 4 || len(r3) != 1 {
		t.Fatalf("calls per round = %d, %d, %d, want 4, 4, 1", len(r1), len(r2), len(r3))
	}
	for _, req := range r1 {
		if !req.Tools || req.Cwd != `D:\proj` || req.Expert.Model != "sonnet" || req.OnTool == nil {
			t.Errorf("round 1 request = tools %v cwd %q model %q, want tools in the project folder on sonnet", req.Tools, req.Cwd, req.Expert.Model)
		}
	}
	for _, req := range r2 {
		if req.Tools || req.OnTool != nil {
			t.Errorf("round 2 request for %s has tools", req.Expert.Id)
		}
	}
	if req := r3[0]; req.Expert.Id != "lead" || req.Expert.Model != "opus" || req.Tools {
		t.Errorf("synthesis request = %s on %s, tools %v, want the coordinator on opus without tools", req.Expert.Id, req.Expert.Model, req.Tools)
	}
	if h.f.indexes("r1")[3] > h.f.indexes("r2")[0] || h.f.indexes("r2")[3] > h.f.indexes("r3")[0] {
		t.Errorf("the rounds ran out of order: %v %v %v", h.f.indexes("r1"), h.f.indexes("r2"), h.f.indexes("r3"))
	}

	// round 2 gave every proposal a stance from each of the other three experts
	stances := 0
	for _, r := range c.Replies {
		if r.ParentId == "" && r.Stance != "" {
			stances++
			if r.Round != 2 || r.Ts == 0 || r.Author == proposalOf(t, c, r.ProposalId).Author {
				t.Errorf("stance %+v: want round 2, a time, and not by the proposal's author", r)
			}
		}
	}
	if stances != 12 || len(c.Replies) != 12 {
		t.Errorf("%d stances in %d replies, want 12 and 12", stances, len(c.Replies))
	}

	// the summary keeps only what is on the council
	d := c.Summary.Directions[0]
	if slices.Contains(d.From, "P99") || len(d.From) != 2 {
		t.Errorf("direction 1 from %v, want P1 and P2 without the unknown P99", d.From)
	}
	for _, gone := range []string{"ghost", "lead"} {
		if _, ok := d.Stances[gone]; ok {
			t.Errorf("direction 1 stances %v hold %s, who is not on the panel", d.Stances, gone)
		}
	}
	if _, ok := c.Summary.Outcomes["P99"]; ok || c.Summary.Outcomes["P1"] != "Direction 1" {
		t.Errorf("outcomes = %v, want P1's and not the unknown P99's", c.Summary.Outcomes)
	}
	// the weak note landed on the proposal it names
	if ev := proposalOf(t, c, "P4").Evidence; !slices.ContainsFunc(ev, func(e CouncilEvidence) bool { return e.Weak && strings.Contains(e.Note, "no measurement") }) {
		t.Errorf("P4 evidence = %+v, want the coordinator's weak note on it", ev)
	}

	// OnChange followed every save
	h.mu.Lock()
	defer h.mu.Unlock()
	if len(h.seen) < 10 {
		t.Fatalf("OnChange fired %d times, want one per save", len(h.seen))
	}
	if first, last := h.seen[0], h.seen[len(h.seen)-1]; first.State != StateRunning || last.State != StateDone || last.Summary == nil {
		t.Errorf("first event %s, last %s, want running then done with the summary", first.State, last.State)
	}
	for i, s := range h.seen {
		if s.Updated == 0 {
			t.Errorf("event %d has no Updated: it was reported before it was saved", i)
		}
	}
}

func TestRecordAndStartSaved(t *testing.T) {
	h := newHarness(t)
	rec, err := h.r.Record(testCouncil("c1"))
	if err != nil {
		t.Fatalf("Record: %v", err)
	}
	if rec.State != StateNotRun || rec.Round != 0 || rec.Started != 0 || rec.Created == 0 {
		t.Fatalf("Record = %s round %d, want not-run", rec.State, rec.Round)
	}
	if got := h.load("c1"); got.State != StateNotRun {
		t.Fatalf("saved state %s, want not-run", got.State)
	}
	if n := len(h.f.all()); n != 0 {
		t.Fatalf("Record made %d calls, want none", n)
	}
	h.mu.Lock()
	if len(h.seen) != 1 || h.seen[0].State != StateNotRun {
		t.Errorf("OnChange saw %d events, want the one save", len(h.seen))
	}
	h.mu.Unlock()
	if _, err := h.r.Record(testCouncil("c1")); err == nil {
		t.Errorf("Record over a saved council worked, want an error")
	}
	if _, err := h.r.StartSaved(context.Background(), "nope"); !errors.Is(err, fs.ErrNotExist) {
		t.Errorf("StartSaved of an unknown council = %v, want not-exist", err)
	}

	started, err := h.r.StartSaved(context.Background(), "c1")
	if err != nil {
		t.Fatalf("StartSaved: %v", err)
	}
	if started.State != StateRunning || started.Round != 1 || started.Started == 0 {
		t.Fatalf("StartSaved = %s round %d, want running in round 1", started.State, started.Round)
	}
	if c := h.wait("c1"); c.State != StateDone || c.Calls != 9 || c.Summary == nil {
		t.Fatalf("after StartSaved: %s with %d calls, want done with 9", c.State, c.Calls)
	}
	if _, err := h.r.StartSaved(context.Background(), "c1"); err == nil {
		t.Errorf("StartSaved of a done council worked, want an error")
	}
}

func TestStartRefusesACouncilThatCannotRun(t *testing.T) {
	h := newHarness(t)
	h.run(testCouncil("taken"))
	cases := []struct {
		name string
		edit func(c *Council)
		want string
	}{
		{"no feature", func(c *Council) { c.Feature = "  " }, "feature"},
		{"no project", func(c *Council) { c.Project = "" }, "project"},
		{"no coordinator", func(c *Council) { c.Experts = c.Experts[:4] }, "coordinator"},
		{"two coordinators", func(c *Council) { c.Experts[0].Coordinator = true }, "coordinator"},
		{"no panel", func(c *Council) { c.Experts = c.Experts[4:] }, "besides the coordinator"},
		{"a repeated expert", func(c *Council) { c.Experts[1].Id = "ux" }, "twice"},
		{"the person as an expert", func(c *Council) { c.Experts[0].Id = YouId }, "person"},
		{"an id in use", func(c *Council) { c.Id = "taken" }, "already exists"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c := testCouncil("fresh")
			tc.edit(c)
			if _, err := h.r.Start(context.Background(), c); err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Errorf("Start = %v, want an error naming %q", err, tc.want)
			}
			if _, err := h.r.Record(c); err == nil {
				t.Errorf("Record worked, want the same refusal")
			}
		})
	}
	if _, err := (&Runner{}).Start(context.Background(), testCouncil("x")); err == nil {
		t.Errorf("a runner with no caller started a council")
	}
}

func TestPauseAfterRound1ThenContinue(t *testing.T) {
	h := newHarness(t)
	c := testCouncil("c1")
	c.PauseAfterRound1 = true
	got := h.run(c)
	if got.State != StateAwaiting || got.Round != 1 || got.Calls != 4 || len(got.Proposals) != 4 || got.Summary != nil {
		t.Fatalf("after round 1: %s round %d, %d calls, %d proposals, want awaiting-you with round 1 only", got.State, got.Round, got.Calls, len(got.Proposals))
	}
	if n := len(h.f.calls("r2")); n != 0 {
		t.Fatalf("%d round 2 calls before Continue", n)
	}
	cutTitle := got.Proposals[1].Title

	if _, err := h.r.Continue("c1", []string{"P9"}, "x"); err == nil {
		t.Errorf("Continue with an unknown proposal worked, want an error")
	}
	if now := h.load("c1"); now.State != StateAwaiting || len(now.Replies) != 0 {
		t.Fatalf("a refused Continue changed the council: %s with %d replies", now.State, len(now.Replies))
	}

	saved, err := h.r.Continue("c1", []string{"P2"}, "  What about Mac?  ")
	if err != nil {
		t.Fatalf("Continue: %v", err)
	}
	if saved.State != StateRunning || saved.Round != 2 || !proposalOf(t, saved, "P2").Cut {
		t.Fatalf("Continue returned %s round %d, P2 cut %v, want running in round 2 with P2 cut", saved.State, saved.Round, proposalOf(t, saved, "P2").Cut)
	}
	c = h.wait("c1")
	if c.State != StateDone || c.Summary == nil || c.Round != 3 {
		t.Fatalf("after Continue: %s round %d", c.State, c.Round)
	}
	r2 := h.f.calls("r2")
	if len(r2) != 4 {
		t.Fatalf("%d round 2 calls, want 4", len(r2))
	}
	for _, req := range r2 {
		if strings.Contains(req.Prompt, cutTitle) {
			t.Errorf("%s's round 2 prompt holds the cut proposal %q", req.Expert.Id, cutTitle)
		}
		mustContain(t, req.Expert.Id+" round 2 prompt", req.Prompt, "What about Mac?")
	}
	mustContain(t, "synthesis prompt", h.f.calls("r3")[0].Prompt, "The person cut this proposal at the pause")

	// the question is the person's reply to the whole council, answered by every expert in round 2
	var ask CouncilReply
	for _, r := range c.Replies {
		if r.Author == YouId {
			ask = r
		}
	}
	if ask.ProposalId != "" || ask.Text != "What about Mac?" || ask.Round != 1 || !ask.Answered || !reflect.DeepEqual(ask.To, panelIds()) {
		t.Fatalf("the question = %+v, want a whole-council reply to every expert, posted in round 1 and answered", ask)
	}
	for _, id := range panelIds() {
		answers := 0
		for _, r := range c.Replies {
			if r.Author == id && r.ParentId == ask.Id {
				answers++
				if r.Round != 2 || r.Text != "Answer from "+id {
					t.Errorf("%s's answer = %+v", id, r)
				}
			}
		}
		if answers != 1 {
			t.Errorf("%s answered the question %d times, want once", id, answers)
		}
	}

	if _, err := h.r.Continue("c1", nil, ""); err == nil {
		t.Errorf("Continue on a done council worked, want an error")
	}
}

func TestReplyBeforeRound2IsAnsweredInRound2(t *testing.T) {
	h := newHarness(t)
	c := testCouncil("c1")
	c.PauseAfterRound1 = true
	h.run(c)
	author := h.load("c1").Proposals[0].Author

	rep, err := h.r.Reply("c1", "P1", "", "Why is that first?", false)
	if err != nil {
		t.Fatalf("Reply: %v", err)
	}
	if rep.State != StateAwaiting || len(h.f.calls("r2")) != 0 {
		t.Fatalf("a reply at the pause ran something: %s, %d round 2 calls", rep.State, len(h.f.calls("r2")))
	}
	posted := replyOf(t, rep, "r1")
	if posted.Round != 1 || !reflect.DeepEqual(posted.To, []string{author}) || posted.Answered {
		t.Fatalf("the reply = %+v, want round 1, to %s, unanswered", posted, author)
	}

	if _, err := h.r.Continue("c1", nil, ""); err != nil {
		t.Fatalf("Continue: %v", err)
	}
	got := h.wait("c1")
	for _, req := range h.f.calls("r2") {
		has := strings.Contains(req.Prompt, "Why is that first?")
		if has != (req.Expert.Id == author) {
			t.Errorf("%s's round 2 prompt has the reply: %v, want it only for %s", req.Expert.Id, has, author)
		}
	}
	if !replyOf(t, got, "r1").Answered {
		t.Errorf("the reply is still open after round 2")
	}
	if n := len(h.f.calls("ans")); n != 0 {
		t.Errorf("%d answers-pass calls, want round 2 to have answered it", n)
	}
	answered := false
	for _, r := range got.Replies {
		answered = answered || (r.Author == author && r.ParentId == "r1" && r.Text == "Answer from "+author)
	}
	if !answered {
		t.Errorf("%s's answer is not under the reply", author)
	}
}

func TestReplyDuringRound1WaitsForRound2(t *testing.T) {
	h := newHarness(t)
	h.f.gate("ux/r1")
	h.start(testCouncil("c1"))
	h.f.entered(t, "ux/r1")
	rep, err := h.r.Reply("c1", "", "", "Does it work on a Mac?", false)
	if err != nil {
		t.Fatalf("Reply: %v", err)
	}
	if posted := repliesBy(rep, YouId)[0]; posted.Round != 1 || !reflect.DeepEqual(posted.To, panelIds()) {
		t.Fatalf("the reply = %+v, want round 1, to every expert", posted)
	}
	h.f.release("ux/r1")
	c := h.wait("c1")
	for _, req := range h.f.calls("r2") {
		mustContain(t, req.Expert.Id+" round 2 prompt", req.Prompt, "Does it work on a Mac?")
	}
	if n := len(h.f.calls("ans")); n != 0 || !repliesBy(c, YouId)[0].Answered {
		t.Errorf("%d answers-pass calls, answered %v, want round 2 to have answered it", n, repliesBy(c, YouId)[0].Answered)
	}
}

// A reply posted while a run is ending must be answered by that run or by a follow-up of its own, never dropped.
func TestRepliesPostedAsARunEndsAreNeverLost(t *testing.T) {
	h := newHarness(t)
	h.start(testCouncil("c1"))
	const n = 40
	for i := range n {
		if _, err := h.r.Reply("c1", "", "", fmt.Sprintf("Question %d?", i), false); err != nil {
			t.Fatalf("Reply %d: %v", i, err)
		}
		time.Sleep(time.Millisecond)
	}
	c := h.wait("c1")
	if c.State != StateDone || c.Round != 3 {
		t.Fatalf("final %s round %d, want done in round 3", c.State, c.Round)
	}
	asks := repliesBy(c, YouId)
	if len(asks) != n {
		t.Fatalf("%d replies stored, want %d", len(asks), n)
	}
	for _, ask := range asks {
		if !ask.Answered {
			t.Errorf("%s (%q) is still open", ask.Id, ask.Text)
		}
		for _, id := range panelIds() {
			if !answeredBy(c, ask.Id, id) {
				t.Errorf("%s never answered %s (%q, round %d)", id, ask.Id, ask.Text, ask.Round)
			}
		}
	}
}

func TestRoundTwoRevisionsAndWithdrawals(t *testing.T) {
	h := newHarness(t)
	ownIds := func(req CallReq) []string {
		return idsIn(proposalHeadRe, sectionText(req.Prompt, "## Your own proposals"))
	}
	h.f.setFn("ux/r2", func(req CallReq) string {
		stances := stancesFor(req)
		own := ownIds(req)
		// a stance on its own proposal and on one that does not exist are the model's slips
		stances = append(stances,
			map[string]any{"proposalid": own[0], "stance": "accept", "reason": "mine"},
			map[string]any{"proposalid": "P99", "stance": "oppose", "reason": "ghost"})
		return fence(mustJSON(map[string]any{
			"stances": stances,
			"revisions": []map[string]any{
				{"proposalid": own[0], "withdraw": false, "title": "A better title", "argument": "A better argument."},
				{"proposalid": "P99", "withdraw": true},
			},
		}))
	})
	h.f.setFn("ram/r2", func(req CallReq) string {
		return fence(mustJSON(map[string]any{
			"stances":   stancesFor(req),
			"revisions": []map[string]any{{"proposalid": ownIds(req)[0], "withdraw": true}},
		}))
	})
	c := h.run(testCouncil("c1"))
	if c.State != StateDone {
		t.Fatalf("state %s, want done", c.State)
	}
	var uxP, ramP CouncilProposal
	for _, p := range c.Proposals {
		switch p.Author {
		case "ux":
			uxP = p
		case "ram":
			ramP = p
		}
	}
	if uxP.Title != "A better title" || uxP.Argument != "A better argument." || uxP.Withdrawn {
		t.Errorf("ux's proposal = %+v, want it revised in place", uxP)
	}
	if !ramP.Withdrawn {
		t.Errorf("ram's proposal = %+v, want it withdrawn", ramP)
	}
	revised := func(p CouncilProposal) *CouncilReply {
		for _, r := range c.Replies {
			if r.ProposalId == p.Id && r.Author == p.Author && r.Revised {
				return &r
			}
		}
		return nil
	}
	if r := revised(uxP); r == nil || r.Text != "Retitled: A better title. A better argument." || r.Stance != "" {
		t.Errorf("ux's revision reply = %+v, want the author's reply saying what changed", r)
	}
	if r := revised(ramP); r == nil || r.Text != "Withdrawn." {
		t.Errorf("ram's withdrawal reply = %+v", r)
	}
	stances := 0
	for _, r := range repliesBy(c, "ux") {
		if r.ParentId == "" && r.Stance != "" {
			stances++
		}
	}
	if stances != 3 {
		t.Errorf("ux has %d stances, want the 3 on the others' proposals and none on its own or P99", stances)
	}
	mustContain(t, "synthesis prompt", h.f.calls("r3")[0].Prompt, "Its author withdrew it in round 2", "revised its proposal")
}

// ---- failures ----

func TestRoundOneFailureGoesOnAndRetryRerunsIt(t *testing.T) {
	h := newHarness(t)
	h.f.setFail("ram/r1", errors.New("claude exited 1: boom"))
	c := h.run(testCouncil("c1"))
	if c.State != StateDone {
		t.Fatalf("state %s, want the round to go on to done", c.State)
	}
	if f := c.Failed["ram"]; f.Round != 1 || !strings.Contains(f.Error, "boom") {
		t.Fatalf("Failed[ram] = %+v, want round 1 with the error", f)
	}
	if len(c.Failed) != 1 || len(c.Proposals) != 3 || c.Calls != 8 {
		t.Fatalf("failed %v, %d proposals, %d calls, want only ram failed, 3 proposals and 4+3+1 calls", c.Failed, len(c.Proposals), c.Calls)
	}
	if st := c.Stats["ram"]; st.Calls != 1 {
		t.Errorf("stats[ram] = %+v, want the failed call counted", st)
	}
	for _, req := range h.f.calls("r2") {
		if req.Expert.Id == "ram" {
			t.Errorf("ram, who failed round 1, was called in round 2")
		}
	}
	mustContain(t, "synthesis prompt", h.f.calls("r3")[0].Prompt, "RAM (its round 1 call failed)")

	if _, err := h.r.Retry("c1", "ux"); err == nil || !strings.Contains(err.Error(), "no failed call") {
		t.Errorf("Retry of an expert with no failure = %v, want an error saying so", err)
	}
	if _, err := h.r.Retry("c1", "nobody"); err == nil {
		t.Errorf("Retry of an unknown expert worked")
	}
	h.f.setFail("ram/r1", nil)
	before := len(h.f.calls("r1"))
	saved, err := h.r.Retry("c1", "ram")
	if err != nil {
		t.Fatalf("Retry: %v", err)
	}
	if saved.State != StateRunning {
		t.Fatalf("Retry returned %s, want running", saved.State)
	}
	c = h.wait("c1")
	r1 := h.f.calls("r1")
	if len(r1) != before+1 || r1[before].Expert.Id != "ram" || !r1[before].Tools {
		t.Fatalf("round 1 calls %d, last for %q, want one more, for ram, with tools", len(r1), r1[len(r1)-1].Expert.Id)
	}
	if c.State != StateDone || len(c.Failed) != 0 || len(c.Proposals) != 4 || c.Calls != 9 {
		t.Fatalf("after Retry: %s, failed %v, %d proposals, %d calls", c.State, c.Failed, len(c.Proposals), c.Calls)
	}
	if p := proposalOf(t, c, "P4"); p.Author != "ram" || p.Title != "Title from ram" {
		t.Errorf("P4 = %+v, want ram's proposal added after the others'", p)
	}
	if n := len(h.f.calls("r3")); n != 1 {
		t.Errorf("Retry of a round 1 call reran the synthesis (%d calls)", n)
	}
}

func TestRoundTwoFailureRetryRerunsRoundTwo(t *testing.T) {
	h := newHarness(t)
	h.f.setFail("skeptic/r2", errors.New("timed out"))
	c := h.run(testCouncil("c1"))
	if f := c.Failed["skeptic"]; f.Round != 2 || c.State != StateDone {
		t.Fatalf("Failed[skeptic] = %+v, state %s, want a round 2 failure in a done council", f, c.State)
	}
	if n := len(repliesBy(c, "skeptic")); n != 0 {
		t.Fatalf("skeptic has %d replies, want none from its failed call", n)
	}
	mustContain(t, "synthesis prompt", h.f.calls("r3")[0].Prompt, "Skeptic (its round 2 call failed)")

	h.f.setFail("skeptic/r2", nil)
	if _, err := h.r.Retry("c1", "skeptic"); err != nil {
		t.Fatalf("Retry: %v", err)
	}
	c = h.wait("c1")
	r2 := h.f.calls("r2")
	if len(r2) != 5 || r2[4].Expert.Id != "skeptic" || r2[4].Tools {
		t.Fatalf("round 2 calls %d, want skeptic's rerun as the fifth, without tools", len(r2))
	}
	mustContain(t, "retried prompt", r2[4].Prompt, "This is round 2 of 3")
	if len(c.Failed) != 0 || len(repliesBy(c, "skeptic")) != 3 || c.State != StateDone {
		t.Fatalf("after Retry: failed %v, skeptic replies %d, state %s, want 3 stances and no failure", c.Failed, len(repliesBy(c, "skeptic")), c.State)
	}
	if n := len(h.f.calls("r3")); n != 1 {
		t.Errorf("Retry of a round 2 call reran the synthesis (%d calls)", n)
	}
}

func TestACallThatReturnsNothingUsableIsAFailure(t *testing.T) {
	for _, tc := range []struct{ name, text, want string }{
		{"an empty reply", "", "empty reply"},
		{"no json", "I could not decide.", "no JSON block"},
		{"a cut-off block", "```json\n{\"proposals\": [", "round 1 reply"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			h := newHarness(t)
			h.f.setText("ux/r1", tc.text)
			c := h.run(testCouncil("c1"))
			if f := c.Failed["ux"]; f.Round != 1 || !strings.Contains(f.Error, tc.want) {
				t.Fatalf("Failed[ux] = %+v, want a round 1 failure naming %q", f, tc.want)
			}
			if len(c.Proposals) != 3 || c.State != StateDone {
				t.Errorf("%d proposals, state %s, want the others' and done", len(c.Proposals), c.State)
			}
		})
	}
}

func TestEveryExpertFailingRoundOneFailsTheCouncil(t *testing.T) {
	h := newHarness(t)
	for _, id := range panelIds() {
		h.f.setFail(id+"/r1", errors.New("no network"))
	}
	c := h.run(testCouncil("c1"))
	if c.State != StateFailed || !strings.Contains(c.Error, "round 1") || len(c.Failed) != 4 || c.Summary != nil {
		t.Fatalf("%s %q failed %d summary %v, want failed in round 1 with nothing to summarize", c.State, c.Error, len(c.Failed), c.Summary)
	}
	if len(h.f.calls("r2"))+len(h.f.calls("r3")) != 0 {
		t.Errorf("rounds ran after every expert had failed")
	}
}

func TestSynthesisFailureLeavesTheCouncilFailedAndCanBeRerun(t *testing.T) {
	reruns := map[string]func(h *harness) error{
		"Retry":     func(h *harness) error { _, err := h.r.Retry("c1", "lead"); return err },
		"Summarize": func(h *harness) error { _, err := h.r.Summarize("c1"); return err },
	}
	for name, rerun := range reruns {
		t.Run(name, func(t *testing.T) {
			h := newHarness(t)
			h.f.setFail("lead/r3", errors.New("opus overloaded"))
			c := h.run(testCouncil("c1"))
			if c.State != StateFailed || c.Round != 3 || !strings.Contains(c.Error, "opus overloaded") || c.Summary != nil {
				t.Fatalf("%s round %d error %q summary %v, want failed in round 3", c.State, c.Round, c.Error, c.Summary)
			}
			if f := c.Failed["lead"]; f.Round != 3 || !strings.Contains(f.Error, "opus overloaded") {
				t.Fatalf("Failed[lead] = %+v, want the synthesis failure", f)
			}
			if st := c.Stats["lead"]; st.Calls != 1 || c.Calls != 9 {
				t.Errorf("stats[lead] %+v, calls %d, want the failed call counted", st, c.Calls)
			}
			h.f.setFail("lead/r3", nil)
			if err := rerun(h); err != nil {
				t.Fatalf("%s: %v", name, err)
			}
			c = h.wait("c1")
			if c.State != StateDone || c.Error != "" || len(c.Failed) != 0 || c.Summary == nil || c.Round != 3 {
				t.Fatalf("after %s: %s %q failed %v summary %v, want a done council with a summary", name, c.State, c.Error, c.Failed, c.Summary)
			}
			if n := len(h.f.calls("r3")); n != 2 {
				t.Errorf("%d synthesis calls, want the first and the rerun", n)
			}
			if len(h.f.calls("r1")) != 4 || len(h.f.calls("r2")) != 4 {
				t.Errorf("the rerun repeated earlier rounds")
			}
		})
	}
}

func TestBusyCouncilRefusesOtherWork(t *testing.T) {
	h := newHarness(t)
	h.f.gate("ux/r1")
	h.start(testCouncil("c1"))
	h.f.entered(t, "ux/r1")
	for name, err := range map[string]error{
		"Retry":      second(h.r.Retry("c1", "ux")),
		"Summarize":  second(h.r.Summarize("c1")),
		"Continue":   second(h.r.Continue("c1", nil, "")),
		"StartSaved": second(h.r.StartSaved(context.Background(), "c1")),
		"Start":      second(h.r.Start(context.Background(), testCouncil("c1"))),
	} {
		if err == nil {
			t.Errorf("%s on a running council worked, want an error", name)
		}
	}
	if c := h.load("c1"); c.State != StateRunning {
		t.Errorf("state %s, want the refused calls to leave it running", c.State)
	}
}

func second(_ *Council, err error) error { return err }

// ---- activity ----

func TestActivityShowsWhatAnExpertDoes(t *testing.T) {
	h := newHarness(t)
	h.f.setTools("ux/r1", `Grep "IdleSleep" in pkg/services`, "Read idle.go")
	h.f.gate("ux/r1")
	h.f.gate("skeptic/r2")
	h.start(testCouncil("c1"))
	h.f.entered(t, "ux/r1")

	c := h.load("c1")
	if got := c.Activity["ux"]; got.Text != "Read idle.go" {
		t.Errorf("Activity[ux] = %+v, want the latest tool event", got)
	}
	if st := c.Stats["ux"]; st.Ms <= 0 || st.Calls != 0 {
		t.Errorf("stats[ux] = %+v while its call runs, want the time so far and no finished call", st)
	}
	if got := c.Activity["newuser"].Text; got != "" && got != actStarting {
		t.Errorf("Activity[newuser] = %q, want it starting or already cleared", got)
	}

	h.f.release("ux/r1")
	h.f.entered(t, "skeptic/r2")
	c = h.load("c1")
	if c.Round != 2 {
		t.Fatalf("round %d, want 2", c.Round)
	}
	var target CouncilProposal
	for _, p := range c.Proposals {
		if p.Author != "skeptic" {
			target = p
			break
		}
	}
	want := CouncilActivity{Text: "Replying to " + speaker(c, target.Author) + " on " + target.Id, ProposalId: target.Id}
	if got := c.Activity["skeptic"]; got != want {
		t.Errorf("Activity[skeptic] = %+v, want %+v", got, want)
	}
	h.f.release("skeptic/r2")
	if c := h.wait("c1"); len(c.Activity) != 0 {
		t.Errorf("activity %v left after the run, want it cleared", c.Activity)
	}
}

// ---- the person's replies ----

func TestReplyTargets(t *testing.T) {
	cases := []struct {
		name             string
		proposal, parent string
		text             string
		to               []string
		wantProposal     string
	}{
		{"on a proposal", "P1", "", "why?", []string{"ux"}, "P1"},
		{"under a challenge", "P1", "r1", "why?", []string{"ux", "skeptic"}, "P1"},
		{"deeper in the branch", "P1", "r2", "why?", []string{"ux", "skeptic"}, "P1"},
		{"on the other proposal", "P2", "", "why?", []string{"ram"}, "P2"},
		{"the proposal comes from the parent", "", "r1", "why?", []string{"ux", "skeptic"}, "P1"},
		{"the whole council", "", "", "what about Mac?", []string{"ux", "ram", "newuser", "skeptic"}, ""},
		{"one expert by name", "P1", "r1", "@RAM what do you think?", []string{"ram"}, "P1"},
		{"one expert by id", "", "", "@newuser what do you think?", []string{"newuser"}, ""},
		{"a name with a space", "", "", "@New user, please", []string{"newuser"}, ""},
		{"two experts", "P1", "", "@skeptic and @ram?", []string{"ram", "skeptic"}, "P1"},
		{"an address is no mention", "P1", "", "mail me at x@ram.com", []string{"ux"}, "P1"},
		{"a longer word is no mention", "P1", "", "@rams are animals", []string{"ux"}, "P1"},
		{"the coordinator answers nothing", "P1", "", "@Lead, thoughts?", []string{"ux"}, "P1"},
	}
	for i, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			h := newHarness(t)
			id := fmt.Sprintf("c%d", i)
			h.save(fixtureCouncil(id, StateAwaiting, 2))
			got, err := h.r.Reply(id, tc.proposal, tc.parent, "  "+tc.text+"  ", true)
			if err != nil {
				t.Fatalf("Reply: %v", err)
			}
			if got.State != StateAwaiting || len(h.f.all()) != 0 {
				t.Fatalf("a reply to a paused council ran something: %s, %d calls", got.State, len(h.f.all()))
			}
			r := got.Replies[len(got.Replies)-1]
			if r.Id != "r3" || r.Author != YouId || r.Text != tc.text || r.ProposalId != tc.wantProposal || r.ParentId != tc.parent ||
				!r.Tools || r.Answered || r.Round != got.Round || r.Ts == 0 || !reflect.DeepEqual(r.To, tc.to) {
				t.Errorf("reply = %+v, want To %v on %q, parent %q", r, tc.to, tc.wantProposal, tc.parent)
			}
		})
	}
}

func TestReplyRefusesWhatIsNotThere(t *testing.T) {
	h := newHarness(t)
	h.save(fixtureCouncil("c1", StateAwaiting, 2))
	if _, err := h.r.Record(testCouncil("notrun")); err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		name, id, proposal, parent, text, want string
	}{
		{"no text", "c1", "P1", "", "   ", "some text"},
		{"an unknown proposal", "c1", "P9", "", "x", "no proposal P9"},
		{"an unknown parent", "c1", "P1", "r9", "x", "no reply r9"},
		{"a parent on another proposal", "c1", "P2", "r1", "x", "not on proposal P2"},
		{"an unknown council", "nope", "", "", "x", "nope"},
		{"a council that has not run", "notrun", "", "", "x", "not started"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := h.r.Reply(tc.id, tc.proposal, tc.parent, tc.text, false); err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Errorf("Reply = %v, want an error naming %q", err, tc.want)
			}
		})
	}
	if c := h.load("c1"); len(c.Replies) != 2 {
		t.Errorf("a refused reply was stored: %d replies", len(c.Replies))
	}
}

func TestReplyDuringRound2IsAnsweredAfterTheSummary(t *testing.T) {
	h := newHarness(t)
	h.f.gate("skeptic/r2")
	h.start(testCouncil("c1"))
	h.f.entered(t, "skeptic/r2")
	author := h.load("c1").Proposals[0].Author

	rep, err := h.r.Reply("c1", "P1", "", "Why is this first?", false)
	if err != nil {
		t.Fatalf("Reply: %v", err)
	}
	if rep.State != StateRunning || rep.Round != 2 {
		t.Fatalf("a reply to a running council returned %s round %d, want it left running", rep.State, rep.Round)
	}
	posted := repliesBy(rep, YouId)[0] // the other experts' stances may be in already, so its id is not r1
	if posted.Round != 2 || !reflect.DeepEqual(posted.To, []string{author}) {
		t.Fatalf("the reply = %+v, want round 2 and to %s", posted, author)
	}
	h.f.release("skeptic/r2")
	c := h.wait("c1")

	for _, req := range h.f.calls("r2") {
		if strings.Contains(req.Prompt, "Why is this first?") {
			t.Errorf("round 2 prompt of %s holds a reply posted after round 2 began", req.Expert.Id)
		}
	}
	ans := h.f.calls("ans")
	if len(ans) != 1 || ans[0].Expert.Id != author || ans[0].Tools {
		t.Fatalf("answers-pass calls = %d, want one to %s without tools", len(ans), author)
	}
	mustContain(t, "answers prompt", ans[0].Prompt, "Why is this first?")
	if h.f.indexes("ans")[0] < h.f.indexes("r3")[0] {
		t.Errorf("the answers came before the synthesis")
	}
	if n := len(h.f.calls("r3")); n != 1 {
		t.Errorf("the synthesis ran %d times, want the Summary left alone", n)
	}
	if !replyOf(t, c, posted.Id).Answered {
		t.Errorf("the reply is still open")
	}
	var answer CouncilReply
	for _, r := range c.Replies {
		if r.ParentId == posted.Id {
			answer = r
		}
	}
	if answer.Author != author || answer.ProposalId != "P1" || answer.Round != 3 || answer.Ts <= c.Summary.At {
		t.Errorf("answer = %+v, summary at %d, want %s's answer in round 3, later than the Summary (which now reads Outdated)", answer, c.Summary.At, author)
	}
	if c.State != StateDone || c.Round != 3 {
		t.Errorf("final %s round %d", c.State, c.Round)
	}
}

func TestReplyToADoneCouncilStartsAFollowUp(t *testing.T) {
	h := newHarness(t)
	done := h.run(testCouncil("c1"))
	summary := *done.Summary
	callsBefore := done.Calls

	h.f.gate("ux/ans")
	rep, err := h.r.Reply("c1", "", "", "What would you do about Mac?", true)
	if err != nil {
		t.Fatalf("Reply: %v", err)
	}
	if rep.State != StateRunning || rep.Round != 4 {
		t.Fatalf("Reply returned %s round %d, want a running follow-up in round 4", rep.State, rep.Round)
	}
	posted := replyOf(t, rep, "r13")
	if posted.Round != 4 || !posted.Tools || !reflect.DeepEqual(posted.To, panelIds()) {
		t.Fatalf("the reply = %+v, want round 4 with tools, to every expert", posted)
	}
	h.f.entered(t, "ux/ans")
	if mid := h.load("c1"); mid.State != StateRunning || mid.Round != 4 {
		t.Errorf("during the follow-up: %s round %d, want running in round 4", mid.State, mid.Round)
	}
	h.f.release("ux/ans")
	c := h.wait("c1")

	if c.State != StateDone || c.Round != 3 || c.Error != "" {
		t.Fatalf("after the follow-up: %s round %d %q, want it back to done in round 3", c.State, c.Round, c.Error)
	}
	if !reflect.DeepEqual(*c.Summary, summary) {
		t.Errorf("the follow-up changed the Summary")
	}
	ans := h.f.calls("ans")
	if len(ans) != 4 {
		t.Fatalf("%d answer calls, want one per expert", len(ans))
	}
	for _, req := range ans {
		if !req.Tools || req.OnTool == nil || req.Cwd != `D:\proj` {
			t.Errorf("answer call for %s: tools %v, want Let them read code on", req.Expert.Id, req.Tools)
		}
	}
	if !replyOf(t, c, "r13").Answered || c.Calls != callsBefore+4 {
		t.Errorf("answered %v, calls %d, want it answered and 4 more calls", replyOf(t, c, "r13").Answered, c.Calls)
	}
	for _, id := range panelIds() {
		found := false
		for _, r := range repliesBy(c, id) {
			found = found || (r.ParentId == "r13" && r.Round == 4)
		}
		if !found {
			t.Errorf("%s has no round 4 answer under the question", id)
		}
	}

	// a second follow-up is round 5, and without tools when the person leaves Let them read code off
	if _, err := h.r.Reply("c1", "P1", "", "And this one?", false); err != nil {
		t.Fatalf("second Reply: %v", err)
	}
	c = h.wait("c1")
	ans = h.f.calls("ans")
	if len(ans) != 5 || ans[4].Tools {
		t.Fatalf("%d answer calls, last with tools %v, want one more, without tools", len(ans), ans[len(ans)-1].Tools)
	}
	if r := replyOf(t, c, "r18"); r.Round != 5 || r.Author != YouId {
		t.Errorf("second reply = %+v, want round 5", r)
	}
}

func TestFollowUpBringsBackTheStateItFound(t *testing.T) {
	cases := []struct {
		name  string
		state CouncilState
		round int
		err   string
	}{
		{"stopped", StateStopped, 2, "arcterm closed during round 2"},
		{"failed", StateFailed, 3, "round 3: opus overloaded"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			h := newHarness(t)
			c := fixtureCouncil("c1", tc.state, tc.round)
			c.Error = tc.err
			c.Failed = map[string]CouncilFailure{"lead": {Round: 3, Error: "opus overloaded"}}
			h.save(c)
			if _, err := h.r.Reply("c1", "P2", "", "Why?", false); err != nil {
				t.Fatalf("Reply: %v", err)
			}
			got := h.wait("c1")
			if got.State != tc.state || got.Round != tc.round || got.Error != tc.err || len(got.Failed) != 1 {
				t.Errorf("after the follow-up: %s round %d %q failed %v, want %s round %d %q as before", got.State, got.Round, got.Error, got.Failed, tc.state, tc.round, tc.err)
			}
			ans := h.f.calls("ans")
			if len(ans) != 1 || ans[0].Expert.Id != "ram" {
				t.Fatalf("answer calls = %d, want one to ram, whose proposal P2 it is", len(ans))
			}
			if got.Summary != nil {
				t.Errorf("the follow-up made a Summary")
			}
		})
	}
}

func TestAnExpertThatFailedSitsTheAnswersPassOut(t *testing.T) {
	h := newHarness(t)
	h.f.setFail("ram/r1", errors.New("boom"))
	c := h.run(testCouncil("c1"))
	if _, err := h.r.Reply("c1", "", "", "Anyone?", false); err != nil {
		t.Fatalf("Reply: %v", err)
	}
	c = h.wait("c1")
	for _, req := range h.f.calls("ans") {
		if req.Expert.Id == "ram" {
			t.Errorf("ram, who failed round 1, was asked in the follow-up")
		}
	}
	ask := repliesBy(c, YouId)[0]
	if len(h.f.calls("ans")) != 3 || !ask.Answered || c.Failed["ram"].Round != 1 {
		t.Errorf("answer calls %d, answered %v, Failed[ram] %+v, want 3 calls, the reply answered and ram's failure left alone",
			len(h.f.calls("ans")), ask.Answered, c.Failed["ram"])
	}
}

func TestAnAnswersPassFailureCanBeRetried(t *testing.T) {
	h := newHarness(t)
	h.run(testCouncil("c1"))
	h.f.setFail("ux/ans", errors.New("rate limited"))
	if _, err := h.r.Reply("c1", "", "", "Anyone?", false); err != nil {
		t.Fatalf("Reply: %v", err)
	}
	c := h.wait("c1")
	if f := c.Failed["ux"]; f.Round != 4 || !strings.Contains(f.Error, "rate limited") || c.State != StateDone {
		t.Fatalf("Failed[ux] = %+v, state %s, want a round 4 failure in a done council", f, c.State)
	}
	if !replyOf(t, c, "r13").Answered {
		t.Errorf("the reply stays open for an expert that failed: it would be asked again and again")
	}
	h.f.setFail("ux/ans", nil)
	if _, err := h.r.Retry("c1", "ux"); err != nil {
		t.Fatalf("Retry: %v", err)
	}
	c = h.wait("c1")
	ans := h.f.calls("ans")
	if len(ans) != 5 || ans[4].Expert.Id != "ux" {
		t.Fatalf("%d answer calls, want ux's rerun last", len(ans))
	}
	if len(c.Failed) != 0 || c.State != StateDone || c.Round != 3 || !answeredBy(c, "r13", "ux") {
		t.Errorf("after Retry: failed %v, %s round %d, ux answered %v", c.Failed, c.State, c.Round, answeredBy(c, "r13", "ux"))
	}
}

// ---- summarize ----

func TestSummarizeRerunsTheSynthesis(t *testing.T) {
	h := newHarness(t)
	first := h.run(testCouncil("c1"))
	h.f.setText("lead/r3", titledSynthesis("Second take.", "Only direction"))
	saved, err := h.r.Summarize("c1")
	if err != nil {
		t.Fatalf("Summarize: %v", err)
	}
	if saved.State != StateRunning || saved.Round != 3 {
		t.Fatalf("Summarize returned %s round %d, want running in round 3", saved.State, saved.Round)
	}
	c := h.wait("c1")
	if c.State != StateDone || c.Round != 3 || c.Summary.Text != "Second take." || len(c.Summary.Directions) != 1 {
		t.Fatalf("after Summarize: %s round %d summary %+v, want the new Summary in place of the old", c.State, c.Round, c.Summary)
	}
	if c.Summary.At <= first.Summary.At {
		t.Errorf("Summary.At %d is not later than the first Summary's %d", c.Summary.At, first.Summary.At)
	}
	if len(h.f.calls("r3")) != 2 || len(h.f.calls("r1")) != 4 || c.Calls != first.Calls+1 {
		t.Errorf("synthesis calls %d, calls %d, want only the synthesis rerun", len(h.f.calls("r3")), c.Calls)
	}
	// the synthesis reads everything said so far, replies included
	if _, err := h.r.Reply("c1", "P1", "", "One more thought.", false); err != nil {
		t.Fatal(err)
	}
	h.wait("c1")
	h.f.setText("lead/r3", titledSynthesis("Third take.", "Another"))
	if _, err := h.r.Summarize("c1"); err != nil {
		t.Fatal(err)
	}
	h.wait("c1")
	mustContain(t, "third synthesis prompt", h.f.calls("r3")[2].Prompt, "One more thought.")
}

func TestSummarizeAStoppedCouncilKeepsItStopped(t *testing.T) {
	h := newHarness(t)
	c := fixtureCouncil("c1", StateStopped, 1) // stopped in round 1: proposals only
	c.Error = "arcterm closed during round 1"
	h.save(c)
	if _, err := h.r.Summarize("c1"); err != nil {
		t.Fatalf("Summarize: %v", err)
	}
	got := h.wait("c1")
	if got.State != StateStopped || got.Round != 1 || got.Error != c.Error || got.Summary == nil {
		t.Fatalf("after Summarize: %s round %d %q summary %v, want it stopped as before, with a Summary", got.State, got.Round, got.Error, got.Summary)
	}
	r3 := h.f.calls("r3")
	if len(r3) != 1 || len(h.f.all()) != 1 {
		t.Fatalf("%d calls, want the synthesis alone", len(h.f.all()))
	}
	mustContain(t, "synthesis prompt", r3[0].Prompt, "Title from ux", "Title from ram")
}

func TestSummarizeAPausedCouncilStaysPaused(t *testing.T) {
	h := newHarness(t)
	c := testCouncil("c1")
	c.PauseAfterRound1 = true
	h.run(c)
	if _, err := h.r.Reply("c1", "P1", "", "Queued for round 2.", false); err != nil {
		t.Fatal(err)
	}
	if _, err := h.r.Summarize("c1"); err != nil {
		t.Fatalf("Summarize: %v", err)
	}
	got := h.wait("c1")
	if got.State != StateAwaiting || got.Round != 1 || got.Summary == nil {
		t.Fatalf("after Summarize at the pause: %s round %d, want it still waiting on the person", got.State, got.Round)
	}
	if n := len(h.f.calls("ans")); n != 0 || got.Replies[0].Answered {
		t.Errorf("a reply meant for round 2 was answered by the Summarize (%d calls)", n)
	}
}

func TestSummarizeRefusesACouncilThatIsNotThere(t *testing.T) {
	h := newHarness(t)
	if _, err := h.r.Record(testCouncil("notrun")); err != nil {
		t.Fatal(err)
	}
	if _, err := h.r.Summarize("notrun"); err == nil {
		t.Errorf("Summarize of a council that has not run worked")
	}
	if _, err := h.r.Summarize("nope"); !errors.Is(err, fs.ErrNotExist) {
		t.Errorf("Summarize of an unknown council = %v, want not-exist", err)
	}
}

// ---- stop ----

func TestStopKeepsFinishedRounds(t *testing.T) {
	h := newHarness(t)
	h.f.gate("ux/r1")
	h.f.gate("ram/r1")
	h.start(testCouncil("c1"))
	h.f.entered(t, "ux/r1")
	h.f.entered(t, "ram/r1")
	waitFor(t, "the two finished experts", func() bool { return len(h.load("c1").Proposals) == 2 })

	c, err := h.r.Stop("c1")
	if err != nil {
		t.Fatalf("Stop: %v", err)
	}
	if c.State != StateStopped || c.Error != "" || len(c.Failed) != 0 || len(c.Activity) != 0 {
		t.Fatalf("after Stop: %s %q failed %v activity %v, want stopped with nothing blamed on the experts", c.State, c.Error, c.Failed, c.Activity)
	}
	authors := []string{c.Proposals[0].Author, c.Proposals[1].Author}
	slices.Sort(authors)
	if len(c.Proposals) != 2 || !reflect.DeepEqual(authors, []string{"newuser", "skeptic"}) || c.Calls != 4 || c.Tokens != 200 {
		t.Errorf("proposals by %v, %d calls, %d tokens, want the two finished experts' proposals and 4 calls", authors, c.Calls, c.Tokens)
	}
	if n := len(h.f.calls("r2")); n != 0 {
		t.Errorf("%d round 2 calls after Stop", n)
	}
	if again, err := h.r.Stop("c1"); err != nil || again.State != StateStopped {
		t.Errorf("a second Stop = %v, %v, want it to change nothing", again, err)
	}

	// what finished can still be summarized, and the council stays stopped
	if _, err := h.r.Summarize("c1"); err != nil {
		t.Fatalf("Summarize: %v", err)
	}
	got := h.wait("c1")
	if got.State != StateStopped || got.Summary == nil {
		t.Fatalf("after Summarize: %s summary %v", got.State, got.Summary)
	}
	mustContain(t, "synthesis prompt", h.f.calls("r3")[0].Prompt, "Title from skeptic", "Title from newuser")
}

func TestStopEndsAPausedCouncilAndLeavesAFinishedOneAlone(t *testing.T) {
	h := newHarness(t)
	c := testCouncil("paused")
	c.PauseAfterRound1 = true
	h.run(c)
	if got, err := h.r.Stop("paused"); err != nil || got.State != StateStopped {
		t.Fatalf("Stop at the pause = %v, %v, want stopped", got, err)
	}
	h.run(testCouncil("done"))
	if got, err := h.r.Stop("done"); err != nil || got.State != StateDone {
		t.Fatalf("Stop of a done council = %v, %v, want it left done", got, err)
	}
	if _, err := h.r.Stop("nope"); err == nil {
		t.Errorf("Stop of an unknown council worked")
	}
}

func TestCancellingTheContextStopsTheCouncil(t *testing.T) {
	h := newHarness(t)
	h.f.gate("ux/r1")
	ctx, cancel := context.WithCancel(context.Background())
	if _, err := h.r.Start(ctx, testCouncil("c1")); err != nil {
		t.Fatal(err)
	}
	h.f.entered(t, "ux/r1")
	cancel()
	if c := h.wait("c1"); c.State != StateStopped || len(c.Failed) != 0 {
		t.Fatalf("after cancel: %s failed %v, want stopped", c.State, c.Failed)
	}
}

// ---- ideas ----

func TestDirectionsBecomeIdeasInTheStartingSession(t *testing.T) {
	h := newHarness(t)
	c := testCouncil("c1")
	c.SessionId = "sess1"
	c = h.run(c)
	list, err := ideastore.List("sess1")
	if err != nil || len(list.Ideas) != 2 {
		t.Fatalf("ideas = %+v, %v, want one per direction", list.Ideas, err)
	}
	want := []string{"Show the sleep state: Cheap and clear.", "Poll less: Saves RAM."}
	for i, idea := range list.Ideas {
		if idea.Text != want[i] || idea.Kind != ideastore.KindIdea || idea.By != ideastore.ByAgent || idea.Topic != "Council · Idle sleep for services" {
			t.Errorf("idea %d = %+v, want %q as an agent's idea under the council topic", i, idea, want[i])
		}
		if got := c.Summary.Directions[i].IdeaId; got != idea.ID {
			t.Errorf("direction %d IdeaId %q, want %q", i, got, idea.ID)
		}
	}

	// a second Summarize adds only the directions whose title is new
	h.f.setText("lead/r3", titledSynthesis("Again.", "SHOW the sleep  state", "Brand new"))
	if _, err := h.r.Summarize("c1"); err != nil {
		t.Fatal(err)
	}
	c2 := h.wait("c1")
	list, _ = ideastore.List("sess1")
	if len(list.Ideas) != 3 || list.Ideas[2].Text != "Brand new: Reason for Brand new." {
		t.Fatalf("ideas after the second Summarize = %+v, want one new idea", list.Ideas)
	}
	if d := c2.Summary.Directions; d[0].IdeaId != list.Ideas[0].ID || d[1].IdeaId != list.Ideas[2].ID {
		t.Errorf("direction idea ids = %q, %q, want the first kept and the second new", d[0].IdeaId, d[1].IdeaId)
	}
}

func TestACouncilWithoutASessionAddsNoIdeas(t *testing.T) {
	h := newHarness(t)
	c := h.run(testCouncil("c1"))
	if c.Summary == nil || c.Summary.Directions[0].IdeaId != "" {
		t.Fatalf("summary %+v, want directions with no idea id", c.Summary)
	}
	if _, err := os.Stat(filepath.Join(h.ideas, ideastore.IdeasDir)); !errors.Is(err, fs.ErrNotExist) {
		t.Errorf("the ideas dir exists (%v): a council with no session wrote to some session's Ideas", err)
	}
}

func TestIdeaTopicFitsTheLimit(t *testing.T) {
	long := strings.Repeat("a long feature name ", 10)
	topic := ideaTopic(long)
	if n := len([]rune(topic)); n > 40 || !strings.HasPrefix(topic, "Council · a long feature") || !strings.HasSuffix(topic, "…") {
		t.Errorf("ideaTopic = %q (%d runes), want it cut to 40 with an ellipsis", topic, n)
	}
	if got := ideaTopic("  Idle   sleep "); got != "Council · Idle sleep" {
		t.Errorf("ideaTopic = %q, want whitespace folded", got)
	}
	if got := firstSentence("Saves  RAM. It also helps.\nA third."); got != "Saves RAM." {
		t.Errorf("firstSentence = %q", got)
	}
	if got := firstSentence("v1.2 is out and no stop at the end"); got != "v1.2 is out and no stop at the end" {
		t.Errorf("firstSentence = %q, want a dot inside a word passed over", got)
	}
}

// ---- stale councils ----

func TestMarkStaleStopsWhatWavesrvLeftRunning(t *testing.T) {
	h := newHarness(t)
	running := fixtureCouncil("running", StateRunning, 2)
	running.Activity = map[string]CouncilActivity{"ux": {Text: "Replying to RAM on P2"}}
	h.save(running)
	followup := fixtureCouncil("followup", StateRunning, 4)
	h.save(followup)
	for _, c := range []*Council{
		fixtureCouncil("done", StateDone, 3), fixtureCouncil("paused", StateAwaiting, 1),
		fixtureCouncil("stopped", StateStopped, 2), fixtureCouncil("failed", StateFailed, 3),
	} {
		c.Error = "kept"
		h.save(c)
	}
	h.r.MarkStale()

	for id, round := range map[string]int{"running": 2, "followup": 4} {
		c := h.load(id)
		if c.State != StateStopped || c.Error != fmt.Sprintf("arcterm closed during round %d", round) || len(c.Activity) != 0 || len(c.Proposals) != 2 {
			t.Errorf("%s = %s %q activity %v, want stopped with the round it closed in", id, c.State, c.Error, c.Activity)
		}
	}
	for id, state := range map[string]CouncilState{"done": StateDone, "paused": StateAwaiting, "stopped": StateStopped, "failed": StateFailed} {
		if c := h.load(id); c.State != state || c.Error != "kept" {
			t.Errorf("%s = %s %q, want it left alone", id, c.State, c.Error)
		}
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if len(h.seen) != 2 {
		t.Errorf("OnChange fired %d times, want once for each council marked", len(h.seen))
	}
}

// ---- wait ----

func TestWait(t *testing.T) {
	h := newHarness(t)
	if _, err := h.r.Record(testCouncil("notrun")); err != nil {
		t.Fatal(err)
	}
	if c := h.wait("notrun"); c.State != StateNotRun {
		t.Errorf("Wait on a council that has not run = %s", c.State)
	}
	if _, err := h.r.Wait(context.Background(), "nope"); !errors.Is(err, fs.ErrNotExist) {
		t.Errorf("Wait on an unknown council = %v", err)
	}

	h.f.gate("ux/r1")
	h.start(testCouncil("c1"))
	h.f.entered(t, "ux/r1")
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	if _, err := h.r.Wait(ctx, "c1"); !errors.Is(err, context.DeadlineExceeded) {
		t.Errorf("Wait on a running council = %v, want the context's deadline", err)
	}
	h.f.release("ux/r1")
	if c := h.wait("c1"); c.State != StateDone {
		t.Errorf("Wait returned %s, want done", c.State)
	}

	h.save(fixtureCouncil("stale", StateRunning, 2))
	if _, err := h.r.Wait(context.Background(), "stale"); err == nil {
		t.Errorf("Wait on a council marked running with nothing behind it returned no error")
	}
}

// ---- the suggestion ----

func TestSuggest(t *testing.T) {
	h := newHarness(t)
	project := t.TempDir()
	h.f.setText("suggest/suggest", fence(mustJSON(map[string]any{
		"files": []string{"pkg/services/idle.go", " pkg/services/idle.go ", "docs/spec.md", ""},
		"roles": []map[string]any{
			{"name": "Mac user", "brief": "You use arcterm on a Mac.", "why": "the frame reload is Windows-only for now"},
			{"name": "UX", "brief": "already in the library"},
			{"name": "A11y", "brief": "", "why": "keyboard only"},
			{"name": "A third", "brief": "over the limit", "why": "x"},
		},
		"group": "ui-feature",
	})))
	got, err := h.r.Suggest(context.Background(), project, "Idle sleep", "Which first?", []string{"pkg/a.go"})
	if err != nil {
		t.Fatalf("Suggest: %v", err)
	}
	if !reflect.DeepEqual(got.Files, []string{"pkg/services/idle.go", "docs/spec.md"}) || got.Group != "ui-feature" {
		t.Errorf("files %v group %q, want the paths trimmed and de-duplicated, and the group", got.Files, got.Group)
	}
	if len(got.Roles) != 2 {
		t.Fatalf("roles = %+v, want two: the library's UX and anything past two left out", got.Roles)
	}
	mac, a11y := got.Roles[0], got.Roles[1]
	if mac.Id != "mac-user" || mac.Name != "Mac user" || mac.Model != ModelExpert || mac.Why != "the frame reload is Windows-only for now" ||
		!strings.HasPrefix(mac.Brief, "You use arcterm on a Mac.") || !strings.Contains(mac.Brief, evidenceSentence) || mac.Coordinator {
		t.Errorf("role 1 = %+v", mac)
	}
	if a11y.Id != "a11y" || !strings.Contains(a11y.Brief, "A11y") || a11y.Why != "keyboard only" {
		t.Errorf("role 2 = %+v, want a brief made from the name and the reason", a11y)
	}

	reqs := h.f.calls("suggest")
	if len(reqs) != 1 {
		t.Fatalf("%d suggest calls, want 1", len(reqs))
	}
	req := reqs[0]
	if !req.Tools || req.Cwd != project || req.Expert.Model != "sonnet" {
		t.Errorf("request = tools %v cwd %q model %q, want read-only tools in the project on sonnet", req.Tools, req.Cwd, req.Expert.Model)
	}
	mustContain(t, "suggest prompt", req.Prompt, "Idle sleep", "Which first?", project, "pkg/a.go",
		"ui-feature: Review a UI feature (UX, RAM, New user, Skeptic)", "paper: Paper review", suggestShape)

	// a group that does not exist comes back empty
	h.f.setText("suggest/suggest", fence(`{"files": [], "roles": [], "group": "nope"}`))
	got, err = h.r.Suggest(context.Background(), project, "Idle sleep", "", nil)
	if err != nil || got.Group != "" || got.Files == nil || got.Roles == nil {
		t.Errorf("Suggest with an unknown group = %+v, %v, want the group empty and no nil lists", got, err)
	}
	h.f.setText("suggest/suggest", "I have no idea.")
	if _, err := h.r.Suggest(context.Background(), project, "Idle sleep", "", nil); err == nil {
		t.Errorf("Suggest of a reply with no JSON worked")
	}
	h.f.setFail("suggest/suggest", errors.New("offline"))
	h.f.clearText("suggest/suggest")
	if _, err := h.r.Suggest(context.Background(), project, "Idle sleep", "", nil); err == nil || !strings.Contains(err.Error(), "offline") {
		t.Errorf("Suggest of a failed call = %v, want its error", err)
	}
	if _, err := h.r.Suggest(context.Background(), "", "Idle sleep", "", nil); err == nil {
		t.Errorf("Suggest with no project worked")
	}
}

// ---- pieces ----

func TestCleanSummaryDropsWhatIsNotOnTheCouncil(t *testing.T) {
	c := fixtureCouncil("c1", StateDone, 3) // P1 by ux, P2 by ram
	got := cleanSummary(c, CouncilSummary{
		Directions: []CouncilDirection{{
			Title: "d", From: []string{"P1", "P1", "P9", "P2"},
			Stances: map[string]CouncilStance{"ux": StanceAccept, "ram": StanceAccept, "skeptic": StanceChallenge, "newuser": StanceAccept, "lead": StanceAccept, "ghost": StanceOppose},
		}},
		Outcomes: map[string]string{"P1": " Direction 1 ", "P2": "", "P9": "Direction 2"},
	})
	d := got.Directions[0]
	if !reflect.DeepEqual(d.From, []string{"P1", "P2"}) {
		t.Errorf("from = %v, want the known ids once", d.From)
	}
	if want := map[string]CouncilStance{"skeptic": StanceChallenge, "newuser": StanceAccept}; !reflect.DeepEqual(d.Stances, want) {
		t.Errorf("stances = %v, want %v: the authors, the coordinator and the stranger left out", d.Stances, want)
	}
	if want := map[string]string{"P1": "Direction 1"}; !reflect.DeepEqual(got.Outcomes, want) {
		t.Errorf("outcomes = %v, want %v", got.Outcomes, want)
	}
}

func TestMentions(t *testing.T) {
	for text, want := range map[string]bool{
		"@ram":              true,
		"hi @ram, hi":       true,
		"(@ram)":            true,
		"@ram's idea":       true,
		"a@ram":             false,
		"x@ram.com":         false,
		"@rams":             false,
		"@ram_2":            false,
		"ram":               false,
		"@@ram":             true,
		"@ramx @ram":        true,
		"no mention at all": false,
	} {
		if got := mentions(text, "@ram"); got != (want) {
			t.Errorf("mentions(%q) = %v, want %v", text, got, want)
		}
	}
}

func TestNextIdsIgnoreGapsAndStrangers(t *testing.T) {
	if got := nextNumbered("P", nil); got != "P1" {
		t.Errorf("first = %s", got)
	}
	if got := nextNumbered("r", []string{"r1", "r7", "x9", "r3", "rx"}); got != "r8" {
		t.Errorf("next = %s, want one past the largest r<n>", got)
	}
}

// ---- the consult caller ----

func swapCaller(t *testing.T,
	run func(ctx context.Context, cwd, prompt string, o consult.CallOpts, onTool func(string)) (string, consult.Usage, error),
	hold func(ctx context.Context, req jobqueue.Request) (func(), error)) {
	t.Helper()
	prevRun, prevHold, prevTimeout := runClaude, holdSlot, callTimeout
	runClaude, holdSlot = run, hold
	t.Cleanup(func() { runClaude, holdSlot, callTimeout = prevRun, prevHold, prevTimeout })
}

func TestConsultCallerGivesToolsAndASlotToTheCallsThatReadCode(t *testing.T) {
	var (
		opts      consult.CallOpts
		cwd, text string
		deadline  time.Time
		held      []jobqueue.Request
		released  int
		slotInUse bool
		tools     []string
	)
	swapCaller(t,
		func(ctx context.Context, c, prompt string, o consult.CallOpts, onTool func(string)) (string, consult.Usage, error) {
			opts, cwd, text = o, c, prompt
			deadline, _ = ctx.Deadline()
			slotInUse = len(held) > released
			if onTool != nil {
				onTool("Read idle.go")
			}
			return "the reply", consult.Usage{Model: o.Model, TotalTokens: 1234}, nil
		},
		func(ctx context.Context, req jobqueue.Request) (func(), error) {
			held = append(held, req)
			return func() { released++ }, nil
		})
	e := CouncilExpert{Id: "ux", Name: "UX", Model: "opus"}

	res, err := ConsultCaller{}.Call(context.Background(), CallReq{Expert: e, Cwd: `D:\proj`, Prompt: "p", Tools: true, OnTool: func(s string) { tools = append(tools, s) }})
	if err != nil || res.Text != "the reply" || res.Tokens != 1234 {
		t.Fatalf("Call = %+v, %v", res, err)
	}
	if !reflect.DeepEqual(opts.Tools, []string{"Read", "Grep", "Glob"}) || opts.Model != "opus" || cwd != `D:\proj` || text != "p" {
		t.Errorf("claude was run with %+v in %q, want opus with Read, Grep and Glob in the project", opts, cwd)
	}
	if len(held) != 1 || released != 1 || !slotInUse {
		t.Errorf("slots held %d, released %d, held while running %v, want one slot held for the call and released after", len(held), released, slotInUse)
	}
	if r := held[0]; r.Name != "Council · UX" || r.Bytes != toolSlotBytes || !r.Engine || r.Source.Label != "Council · UX" {
		t.Errorf("slot request = %+v", r)
	}
	if until := time.Until(deadline); until > callTimeout || until < callTimeout-time.Minute {
		t.Errorf("the call's deadline is %v away, want about %v", until, callTimeout)
	}
	if !reflect.DeepEqual(tools, []string{"Read idle.go"}) {
		t.Errorf("tool events = %v, want them passed through", tools)
	}

	// a call from text takes no slot and gets no tools
	if _, err := (ConsultCaller{}).Call(context.Background(), CallReq{Expert: e, Prompt: "p"}); err != nil {
		t.Fatalf("Call without tools: %v", err)
	}
	if len(opts.Tools) != 0 || len(held) != 1 {
		t.Errorf("tools %v, slots %d, want none of either", opts.Tools, len(held))
	}
}

func TestConsultCallerFailures(t *testing.T) {
	swapCaller(t,
		func(ctx context.Context, c, prompt string, o consult.CallOpts, onTool func(string)) (string, consult.Usage, error) {
			<-ctx.Done()
			return "partial", consult.Usage{TotalTokens: 7}, ctx.Err()
		},
		func(ctx context.Context, req jobqueue.Request) (func(), error) { return func() {}, nil })
	callTimeout = 20 * time.Millisecond
	res, err := ConsultCaller{}.Call(context.Background(), CallReq{Expert: CouncilExpert{Id: "ux"}, Prompt: "p"})
	if err == nil || !strings.Contains(err.Error(), "timed out") || res.Tokens != 7 {
		t.Errorf("a call past its timeout = %+v, %v, want a timed out error that keeps its tokens", res, err)
	}

	// a stop is not a timeout
	callTimeout = time.Minute
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := (ConsultCaller{}).Call(ctx, CallReq{Expert: CouncilExpert{Id: "ux"}, Prompt: "p"}); !errors.Is(err, context.Canceled) {
		t.Errorf("a cancelled call = %v, want the cancellation", err)
	}

	// a slot that never comes (the person skipped the job, or ctx ended) fails the call without running claude
	ran := false
	swapCaller(t,
		func(ctx context.Context, c, prompt string, o consult.CallOpts, onTool func(string)) (string, consult.Usage, error) {
			ran = true
			return "", consult.Usage{}, nil
		},
		func(ctx context.Context, req jobqueue.Request) (func(), error) { return nil, jobqueue.ErrSkipped })
	_, err = ConsultCaller{}.Call(context.Background(), CallReq{Expert: CouncilExpert{Id: "ux"}, Prompt: "p", Tools: true})
	if err == nil || !errors.Is(err, jobqueue.ErrSkipped) || ran {
		t.Errorf("a call whose slot was refused = %v (ran %v), want the refusal and no claude", err, ran)
	}
}
