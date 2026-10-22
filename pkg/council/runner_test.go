// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package council

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log"
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
	picks := idsIn(proposalHeadRe, sectionText(req.Prompt, "## Proposals to review"))
	if len(picks) > 3 {
		picks = picks[:3]
	}
	return fence(mustJSON(map[string]any{"stances": stancesFor(req), "revisions": []any{}, "answers": answersFor(req, asks), "picks": picks}))
}

func answersJSON(req CallReq) string {
	return fence(mustJSON(map[string]any{"answers": answersFor(req, idsIn(replyHeadRe, req.Prompt))}))
}

func cannedSynthesis(text string) string {
	return fence(mustJSON(map[string]any{
		"text":   text,
		"answer": "Show the sleep state first.",
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
		{"an unknown mode", func(c *Council) { c.Mode = "fast" }, "mode"},
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

// picksCouncil is a council mid round 2 with five proposals: P1 ux, P2 ram, P3 skeptic, P4 ram (cut), P5 skeptic
// (withdrawn).
func picksCouncil() *Council {
	c := testCouncil("c1")
	c.Proposals = []CouncilProposal{
		{Id: "P1", Author: "ux", Title: "One"}, {Id: "P2", Author: "ram", Title: "Two"},
		{Id: "P3", Author: "skeptic", Title: "Three"}, {Id: "P4", Author: "ram", Title: "Four", Cut: true},
		{Id: "P5", Author: "skeptic", Title: "Five", Withdrawn: true}, {Id: "P6", Author: "newuser", Title: "Six"},
		{Id: "P7", Author: "newuser", Title: "Seven"},
	}
	return c
}

func TestARunKeepsEachExpertsPicksAndTheSummarysAnswer(t *testing.T) {
	h := newHarness(t)
	c := h.run(testCouncil("c1"))
	if c.State != StateDone {
		t.Fatalf("state %s, want done", c.State)
	}
	for _, id := range []string{"ux", "ram", "newuser", "skeptic"} {
		picks := c.Picks[id]
		if len(picks) == 0 || len(picks) > 3 {
			t.Errorf("Picks[%s] = %v, want 1 to 3", id, picks)
		}
		for _, pid := range picks {
			if p := findProposal(c, pid); p == nil || p.Author == id {
				t.Errorf("Picks[%s] holds %s, want another expert's proposal", id, pid)
			}
		}
	}
	if _, ok := c.Picks["lead"]; ok {
		t.Errorf("Picks[lead] = %v, want none: the coordinator reviews nothing", c.Picks["lead"])
	}
	if c.Summary == nil || c.Summary.Answer != "Show the sleep state first." {
		t.Errorf("summary = %+v, want the answer kept", c.Summary)
	}
}

func TestApplyRound2KeepsOnlyValidPicks(t *testing.T) {
	c := picksCouncil()
	ux := c.Experts[0]
	// its own P1, a ghost, a cut, a withdrawn and a repeat are dropped; the rest keep the expert's order
	applyRound2(c, ux, Round2Result{Picks: []string{"P3", "P1", "P99", "P4", "P5", "P3", "P2", "P6", "P7"}}, 5)
	if got, want := c.Picks["ux"], []string{"P3", "P2", "P6"}; !slices.Equal(got, want) {
		t.Errorf("picks = %v, want %v", got, want)
	}
	applyRound2(c, c.Experts[1], Round2Result{Picks: []string{"P2", "P99"}}, 5)
	if _, ok := c.Picks["ram"]; ok {
		t.Errorf("Picks[ram] = %v, want no entry when nothing valid is picked", c.Picks["ram"])
	}
}

func TestApplyRound2AnAcceptNeedsNoReasonButADoubtDoes(t *testing.T) {
	c := picksCouncil()
	applyRound2(c, c.Experts[0], Round2Result{Stances: []Round2Stance{
		{ProposalId: "P2", Stance: StanceAccept},
		{ProposalId: "P3", Stance: StanceChallenge, Reason: "  "},
		{ProposalId: "P6", Stance: StanceOppose},
		{ProposalId: "P7", Stance: StanceChallenge, Reason: "Breaks."},
	}}, 5)
	if len(c.Replies) != 2 {
		t.Fatalf("replies = %+v, want the empty accept and the reasoned challenge", c.Replies)
	}
	if r := c.Replies[0]; r.ProposalId != "P2" || r.Stance != StanceAccept || r.Text != "" {
		t.Errorf("reply 0 = %+v, want an accept on P2 with no text", r)
	}
	if r := c.Replies[1]; r.ProposalId != "P7" || r.Text != "Breaks." {
		t.Errorf("reply 1 = %+v, want the challenge on P7", r)
	}
}

func TestCleanSummaryDropsTheAnswerWhenNothingWasAsked(t *testing.T) {
	c := picksCouncil()
	if got := cleanSummary(c, CouncilSummary{Answer: "Do P2."}).Answer; got != "Do P2." {
		t.Errorf("answer = %q, want it kept with a question", got)
	}
	c.Question = ""
	if got := cleanSummary(c, CouncilSummary{Answer: "Do P2."}).Answer; got != "" {
		t.Errorf("answer = %q, want none without a question", got)
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
	want := CouncilActivity{Text: "Replying to " + speaker(c, target.Author), ProposalId: target.Id}
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

// ---- one council at a time ----

// councilAs is a council whose experts' ids start with prefix, in a project folder of its own: several councils can then
// be held at their own gates at once, and each saves its document into its own folder.
func councilAs(t *testing.T, id, prefix string) *Council {
	t.Helper()
	c := testCouncil(id)
	c.Project = t.TempDir()
	for i := range c.Experts {
		c.Experts[i].Id = prefix + c.Experts[i].Id
	}
	return c
}

// r1CallsBy counts the round 1 calls made by experts whose id starts with prefix.
func r1CallsBy(h *harness, prefix string) int {
	n := 0
	for _, req := range h.f.calls("r1") {
		if strings.HasPrefix(req.Expert.Id, prefix) {
			n++
		}
	}
	return n
}

// holdFirst starts council a, held in its round 1 at the gate of its first expert.
func (h *harness) holdFirst(a *Council) {
	h.t.Helper()
	gate := a.Experts[0].Id + "/r1"
	h.f.gate(gate)
	h.start(a)
	h.f.entered(h.t, gate)
}

func TestQueueSecondStart(t *testing.T) {
	h := newHarness(t)
	h.holdFirst(councilAs(t, "a", ""))

	// a Start while a council runs queues behind it, whatever the project
	saved := h.start(councilAs(t, "b", "b-"))
	if saved.State != StateQueued || saved.QueuedAfter != "a" || saved.Round != 0 || saved.Started != 0 || saved.Created == 0 || saved.Error != "" {
		t.Fatalf("Start while another runs returned %s after %q round %d started %d, want queued after a", saved.State, saved.QueuedAfter, saved.Round, saved.Started)
	}
	if got := h.load("b"); got.State != StateQueued || got.QueuedAfter != "a" || len(got.Proposals) != 0 {
		t.Fatalf("saved b = %s after %q with %d proposals", got.State, got.QueuedAfter, len(got.Proposals))
	}

	// so does a council saved as not run when the person presses Start council
	if _, err := h.r.Record(councilAs(t, "n", "n-")); err != nil {
		t.Fatal(err)
	}
	queued, err := h.r.StartSaved(context.Background(), "n")
	if err != nil {
		t.Fatalf("StartSaved: %v", err)
	}
	if queued.State != StateQueued || queued.QueuedAfter != "a" || queued.Round != 0 {
		t.Fatalf("StartSaved while another runs returned %s after %q, want queued after a", queued.State, queued.QueuedAfter)
	}
	if _, err := h.r.StartSaved(context.Background(), "n"); err == nil {
		t.Error("a queued council started a second time")
	}

	// a queued council made no call, and the cockpit was told about its save
	for _, req := range h.f.all() {
		if strings.HasPrefix(req.Expert.Id, "b-") || strings.HasPrefix(req.Expert.Id, "n-") {
			t.Fatalf("a queued council's expert %s was called", req.Expert.Id)
		}
	}
	h.mu.Lock()
	told := map[string]bool{}
	for _, c := range h.seen {
		if c.State == StateQueued {
			told[c.Id] = true
		}
	}
	h.mu.Unlock()
	if !told["b"] || !told["n"] {
		t.Errorf("OnChange was told of queued saves for %v, want b and n", told)
	}

	// first come, first served: b before n
	h.f.release("ux/r1")
	for _, id := range []string{"a", "b", "n"} {
		if c := h.wait(id); c.State != StateDone || c.QueuedAfter != "" {
			t.Fatalf("%s ended %s (%s) after %q, want done", id, c.State, c.Error, c.QueuedAfter)
		}
	}
	first := map[string]int{}
	for i, req := range h.f.all() {
		for _, prefix := range []string{"b-", "n-"} {
			if _, seen := first[prefix]; !seen && strings.HasPrefix(req.Expert.Id, prefix) {
				first[prefix] = i
			}
		}
	}
	if first["b-"] > first["n-"] {
		t.Errorf("n ran before b, which was queued first (first calls at %v)", first)
	}
}

func TestQueueTwoStartsAtOnce(t *testing.T) {
	for i := range 5 {
		t.Run(fmt.Sprint(i), func(t *testing.T) {
			h := newHarness(t)
			h.f.gate("x-ux/r1")
			h.f.gate("y-ux/r1")
			start := make(chan struct{})
			results := make([]*Council, 2)
			errs := make([]error, 2)
			var wg sync.WaitGroup
			for i, c := range []*Council{councilAs(t, "x", "x-"), councilAs(t, "y", "y-")} {
				wg.Go(func() {
					<-start
					results[i], errs[i] = h.r.Start(context.Background(), c)
				})
			}
			close(start)
			wg.Wait()
			for _, err := range errs {
				if err != nil {
					t.Fatalf("Start: %v", err)
				}
			}
			states := []CouncilState{results[0].State, results[1].State}
			slices.Sort(states)
			if !slices.Equal(states, []CouncilState{StateQueued, StateRunning}) {
				t.Fatalf("two starts at once = %v, want one running and one queued", states)
			}
			running, waiting := results[0], results[1]
			if running.State != StateRunning {
				running, waiting = waiting, running
			}
			if waiting.QueuedAfter != running.Id {
				t.Errorf("the queued council waits on %q, want %q", waiting.QueuedAfter, running.Id)
			}
			prefix := map[string]string{"x": "x-", "y": "y-"}
			h.f.entered(t, prefix[running.Id]+"ux/r1")
			if n := r1CallsBy(h, prefix[waiting.Id]); n != 0 {
				t.Errorf("the queued council made %d calls while the other ran", n)
			}
			h.f.release(prefix[running.Id] + "ux/r1")
			h.f.entered(t, prefix[waiting.Id]+"ux/r1") // the queued one starts when the first ends
			h.f.release(prefix[waiting.Id] + "ux/r1")
			for _, id := range []string{running.Id, waiting.Id} {
				if c := h.wait(id); c.State != StateDone {
					t.Errorf("%s ended %s (%s), want done: neither start may be lost", id, c.State, c.Error)
				}
			}
			for _, p := range []string{"x-", "y-"} {
				if n := r1CallsBy(h, p); n != 4 {
					t.Errorf("%s council made %d round 1 calls, want 4: it ran once", p, n)
				}
			}
		})
	}
}

func TestQueueNextStartsOnce(t *testing.T) {
	release := func(h *harness) { h.f.release("ux/r1") }
	for name, tc := range map[string]struct {
		setup func(h *harness, a *Council)
		end   func(h *harness)
		want  CouncilState
	}{
		"done": {nil, release, StateDone},
		"failed": {func(h *harness, a *Council) {
			for _, id := range panelIds() {
				h.f.setFail(id+"/r1", errors.New("no network"))
			}
		}, release, StateFailed},
		"awaiting-you": {func(h *harness, a *Council) { a.PauseAfterRound1 = true }, release, StateAwaiting},
		"stopped":      {nil, func(h *harness) { h.r.Stop("a") }, StateStopped},
	} {
		t.Run(name, func(t *testing.T) {
			h := newHarness(t)
			a := councilAs(t, "a", "")
			if tc.setup != nil {
				tc.setup(h, a)
			}
			h.holdFirst(a)
			h.f.gate("b-ux/r1")
			h.start(councilAs(t, "b", "b-"))
			h.start(councilAs(t, "c", "c-"))
			for _, id := range []string{"b", "c"} {
				if got := h.load(id); got.State != StateQueued || got.QueuedAfter != "a" {
					t.Fatalf("%s is %s after %q, want queued after a", id, got.State, got.QueuedAfter)
				}
			}

			tc.end(h)
			if got := h.wait("a"); got.State != tc.want {
				t.Fatalf("a ended %s (%s), want %s", got.State, got.Error, tc.want)
			}
			// the oldest queued council starts, and only it
			h.f.entered(t, "b-ux/r1")
			waitFor(t, "b's round 1 calls", func() bool { return r1CallsBy(h, "b-") == 4 })
			if got := h.load("b"); got.State != StateRunning || got.QueuedAfter != "" || got.Round != 1 || got.Started == 0 {
				t.Errorf("b = %s after %q round %d, want running with no queue left", got.State, got.QueuedAfter, got.Round)
			}
			if got := h.load("c"); got.State != StateQueued || got.QueuedAfter != "b" {
				t.Errorf("c = %s after %q, want it queued behind b, the council that runs now", got.State, got.QueuedAfter)
			}
			if n := r1CallsBy(h, "c-"); n != 0 {
				t.Errorf("c made %d calls while b ran", n)
			}

			h.f.release("b-ux/r1")
			if got := h.wait("b"); got.State != StateDone || got.DocPath == "" {
				t.Errorf("b ended %s with the document at %q, want done and saved", got.State, got.DocPath)
			}
			if got := h.wait("c"); got.State != StateDone {
				t.Errorf("c ended %s (%s), want done", got.State, got.Error)
			}
			for _, p := range []string{"b-", "c-"} {
				if n := r1CallsBy(h, p); n != 4 {
					t.Errorf("%s council made %d round 1 calls, want 4: it started once", p, n)
				}
			}
		})
	}
}

func TestQueueStopRemoves(t *testing.T) {
	h := newHarness(t)
	h.holdFirst(councilAs(t, "a", ""))
	b, c := councilAs(t, "b", "b-"), councilAs(t, "c", "c-")
	h.start(b)
	h.start(c)

	got, err := h.r.Stop("b")
	if err != nil || got.State != StateStopped || got.QueuedAfter != "" || got.Error != "" {
		t.Fatalf("Stop of a queued council = %+v, %v, want stopped and off the queue", got, err)
	}
	if w := h.wait("b"); w.State != StateStopped {
		t.Errorf("Wait on the removed council = %s, want it stopped at once", w.State)
	}
	if again, err := h.r.Stop("b"); err != nil || again.State != StateStopped {
		t.Errorf("a second Stop = %v, %v", again, err)
	}

	// the council behind it is not held up, and the removed one never runs and writes no document
	h.f.release("ux/r1")
	if got := h.wait("c"); got.State != StateDone {
		t.Fatalf("c ended %s (%s), want done", got.State, got.Error)
	}
	if got := h.load("b"); got.State != StateStopped || got.Round != 0 || got.DocPath != "" {
		t.Errorf("b = %s round %d doc %q after the queue ran, want it still stopped and never run", got.State, got.Round, got.DocPath)
	}
	if n := r1CallsBy(h, "b-"); n != 0 {
		t.Errorf("the removed council made %d calls", n)
	}
	if _, err := os.Stat(filepath.Join(b.Project, "docs")); err == nil {
		t.Error("a council that never ran saved a document")
	}
	h.r.StartNext()
	if n := r1CallsBy(h, "b-"); n != 0 {
		t.Errorf("StartNext started the removed council (%d calls)", n)
	}
}

func TestQueuedCouncilRefusesWhatNeedsARun(t *testing.T) {
	h := newHarness(t)
	h.holdFirst(councilAs(t, "a", ""))
	h.start(councilAs(t, "b", "b-"))
	for name, err := range map[string]error{
		"Reply":      second(h.r.Reply("b", "", "", "Anyone?", false)),
		"Continue":   second(h.r.Continue("b", nil, "")),
		"Summarize":  second(h.r.Summarize("b")),
		"Retry":      second(h.r.Retry("b", "b-ux")),
		"StartSaved": second(h.r.StartSaved(context.Background(), "b")),
	} {
		if err == nil {
			t.Errorf("%s on a queued council worked", name)
		}
	}
	if got := h.load("b"); got.State != StateQueued || len(got.Replies) != 0 {
		t.Errorf("b = %s with %d replies after the refusals, want it queued and untouched", got.State, len(got.Replies))
	}
	h.f.release("ux/r1")
	h.wait("b")
}

func TestQueuePersonActsNotQueued(t *testing.T) {
	h := newHarness(t)
	h.holdFirst(councilAs(t, "a", "")) // a runs the whole time

	fixture := func(id string, state CouncilState, round int) *Council {
		c := fixtureCouncil(id, state, round)
		c.Project = t.TempDir()
		return c
	}
	paused := fixture("paused", StateAwaiting, 1)
	paused.PauseAfterRound1 = true
	failed := fixture("failed", StateDone, 3)
	failed.Failed = map[string]CouncilFailure{"ram": {Round: 2, Error: "timed out"}}
	for _, c := range []*Council{paused, fixture("done", StateDone, 3), failed, fixture("summed", StateDone, 3)} {
		h.save(c)
	}

	for name, act := range map[string]struct {
		id string
		do func() (*Council, error)
	}{
		"Continue":  {"paused", func() (*Council, error) { return h.r.Continue("paused", nil, "") }},
		"Reply":     {"done", func() (*Council, error) { return h.r.Reply("done", "P1", "", "And on a Mac?", false) }},
		"Retry":     {"failed", func() (*Council, error) { return h.r.Retry("failed", "ram") }},
		"Summarize": {"summed", func() (*Council, error) { return h.r.Summarize("summed") }},
	} {
		saved, err := act.do()
		if err != nil {
			t.Fatalf("%s while another council runs: %v", name, err)
		}
		if saved.State != StateRunning || saved.QueuedAfter != "" {
			t.Errorf("%s returned %s after %q, want it running at once", name, saved.State, saved.QueuedAfter)
		}
		if got := h.wait(act.id); got.State != StateDone && got.State != StateAwaiting {
			t.Errorf("%s ended %s (%s), want it to finish while a is still running", name, got.State, got.Error)
		}
		if got := h.load("a"); got.State != StateRunning {
			t.Fatalf("a is %s after %s, want it still running", got.State, name)
		}
	}
	if q := queuedCouncils(); len(q) != 0 {
		t.Errorf("the person's own actions queued %d councils", len(q))
	}
	h.f.release("ux/r1")
	h.wait("a")
}

// TestQueueOldCouncils: councils saved before modes and the queue existed (no mode, no queue fields, a state of their
// own) read as Review, open as before, and are never queued or started by the queue.
func TestQueueOldCouncils(t *testing.T) {
	h := newHarness(t)
	old := func(id, state string) {
		body := fmt.Sprintf(`{"id":%q,"project":%q,"feature":"Idle sleep","state":%q,"round":3,"experts":[
			{"id":"ux","name":"UX","brief":"b","model":"sonnet"},{"id":"lead","name":"Lead","brief":"b","model":"opus","coordinator":true}],
			"proposals":[{"id":"P1","author":"ux","title":"T","argument":"A","ts":1}],"tokens":0,"calls":0,"created":1,"updated":1}`,
			id, t.TempDir(), state)
		if err := os.MkdirAll(Dir(), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(Dir(), id+".json"), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	for _, state := range []string{"done", "not-run", "stopped", "failed", "awaiting-you"} {
		old(strings.ReplaceAll(state, "-", ""), state)
	}
	for id, state := range map[string]CouncilState{"done": StateDone, "notrun": StateNotRun, "stopped": StateStopped, "failed": StateFailed, "awaitingyou": StateAwaiting} {
		c := h.load(id)
		if c.State != state || ModeOf(c) != ModeReview || c.QueuedAfter != "" || c.DocPath != "" {
			t.Errorf("%s = %s mode %q after %q doc %q, want it read as it was, as a review", id, c.State, ModeOf(c), c.QueuedAfter, c.DocPath)
		}
	}

	// the queue and a restart leave them alone
	h.r.MarkStale()
	h.r.StartNext()
	if n := len(h.f.all()); n != 0 {
		t.Errorf("StartNext started an old council (%d calls)", n)
	}
	for id, state := range map[string]CouncilState{"done": StateDone, "notrun": StateNotRun, "stopped": StateStopped, "failed": StateFailed, "awaitingyou": StateAwaiting} {
		if c := h.load(id); c.State != state {
			t.Errorf("%s = %s after StartNext, want %s", id, c.State, state)
		}
	}
	if q := queuedCouncils(); len(q) != 0 {
		t.Errorf("%d old councils read as queued", len(q))
	}

	// a council with no mode starts at once on a free runner, and an old done one takes a follow-up while another runs
	started := h.start(councilAs(t, "new", "n-"))
	if started.State != StateRunning || started.QueuedAfter != "" || ModeOf(started) != ModeReview {
		t.Errorf("a council with no mode on a free runner = %s after %q mode %q", started.State, started.QueuedAfter, ModeOf(started))
	}
	h.wait("new")
	h.f.gate("ux/ans")
	if saved, err := h.r.Reply("done", "P1", "", "Still true?", false); err != nil || saved.State != StateRunning {
		t.Fatalf("a follow-up on an old done council = %+v, %v", saved, err)
	}
	h.f.entered(t, "ux/ans")
	h.f.release("ux/ans")
	h.wait("done")
}

func TestQueueStartNextAfterRestart(t *testing.T) {
	h := newHarness(t)
	queuedBefore := func(id, prefix string, created int64) {
		c := councilAs(t, id, prefix)
		c.State, c.Round, c.Created, c.QueuedAfter = StateQueued, 0, created, "gone"
		h.save(c)
	}
	queuedBefore("q2", "q2-", 2) // saved first, but asked later: the oldest by Created starts
	queuedBefore("q1", "q1-", 1)
	h.save(fixtureCouncil("stale", StateRunning, 2))

	h.r.MarkStale()
	for id, state := range map[string]CouncilState{"q1": StateQueued, "q2": StateQueued, "stale": StateStopped} {
		if got := h.load(id); got.State != state {
			t.Errorf("%s = %s after MarkStale, want %s", id, got.State, state)
		}
	}
	if n := len(h.f.all()); n != 0 {
		t.Fatalf("MarkStale made %d calls", n)
	}

	h.f.gate("q1-ux/r1")
	h.r.StartNext()
	h.f.entered(t, "q1-ux/r1")
	if got := h.load("q1"); got.State != StateRunning || got.QueuedAfter != "" {
		t.Errorf("q1 = %s after %q, want the oldest running", got.State, got.QueuedAfter)
	}
	if got := h.load("q2"); got.State != StateQueued || got.QueuedAfter != "q1" {
		t.Errorf("q2 = %s after %q, want it queued behind q1", got.State, got.QueuedAfter)
	}
	h.r.StartNext() // once is enough: a second call while q1 runs starts nobody
	if n := r1CallsBy(h, "q2-"); n != 0 {
		t.Errorf("a second StartNext started q2 (%d calls)", n)
	}
	h.f.release("q1-ux/r1")
	for _, id := range []string{"q1", "q2"} {
		if got := h.wait(id); got.State != StateDone {
			t.Errorf("%s ended %s (%s), want done", id, got.State, got.Error)
		}
	}
}

// ---- the saved document ----

// syncBuf is a log sink the council goroutines can write to while the test reads it.
type syncBuf struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (s *syncBuf) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.buf.Write(p)
}

func (s *syncBuf) String() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.buf.String()
}

func TestDocPathSavedOnEnd(t *testing.T) {
	useDocDay(t)
	h := newHarness(t)

	// done: the document lands under the project's docs/council and its path is kept on the council
	a := councilAs(t, "a", "")
	c := h.run(a)
	want := filepath.Join(a.Project, "docs", "council", "2026-10-21-idle-sleep-for-services.md")
	if c.State != StateDone || c.DocPath != want {
		t.Fatalf("done council: %s with the document at %q, want %q", c.State, c.DocPath, want)
	}
	body, err := os.ReadFile(want)
	if err != nil {
		t.Fatalf("the document was not written: %v", err)
	}
	for _, w := range []string{"# Council: Idle sleep for services", "The panel prefers showing the state.", "## The discussion", "proposes · P1 · Title from ", "## Run facts", "- Ended: done"} {
		if !strings.Contains(string(body), w) {
			t.Errorf("the document lacks %q\n%s", w, body)
		}
	}
	h.mu.Lock()
	lastSeen := h.seen[len(h.seen)-1]
	h.mu.Unlock()
	if lastSeen.DocPath != want {
		t.Errorf("the last OnChange carried DocPath %q, want %q: the cockpit hears of the document", lastSeen.DocPath, want)
	}

	// a follow-up on the done council rewrites the same file, with the new reply in it
	if _, err := h.r.Reply("a", "P1", "", "What about the Mac?", false); err != nil {
		t.Fatal(err)
	}
	c = h.wait("a")
	body, _ = os.ReadFile(want)
	files, _ := os.ReadDir(filepath.Dir(want))
	if c.DocPath != want || len(files) != 1 || !strings.Contains(string(body), "What about the Mac?") {
		t.Errorf("after a follow-up: document %q, %d files, new reply in it %v; want the same file rewritten", c.DocPath, len(files), strings.Contains(string(body), "What about the Mac?"))
	}

	// stopped: what the finished rounds hold is saved too
	b := councilAs(t, "b", "b-")
	h.holdFirst(b)
	if got, err := h.r.Stop("b"); err != nil || got.State != StateStopped || got.DocPath == "" {
		t.Fatalf("Stop = %+v, %v, want stopped with a document", got, err)
	}
	if body, err := os.ReadFile(h.load("b").DocPath); err != nil || !strings.Contains(string(body), "- Ended: stopped") {
		t.Errorf("the stopped council's document = %q, %v", body, err)
	}
	// a council that ended paused is stopped by Stop with no run behind it: it saves its document there
	p := councilAs(t, "p", "p-")
	p.PauseAfterRound1 = true
	h.run(p)
	if got, err := h.r.Stop("p"); err != nil || got.State != StateStopped || got.DocPath == "" {
		t.Errorf("Stop at the pause = %+v, %v, want stopped with a document", got, err)
	}

	// failed and paused councils have no document: only done and stopped save
	f := councilAs(t, "f", "f-")
	for _, e := range panelOf(f) {
		h.f.setFail(e.Id+"/r1", errors.New("no network"))
	}
	if got := h.run(f); got.State != StateFailed || got.DocPath != "" {
		t.Errorf("failed council: %s with a document at %q", got.State, got.DocPath)
	}
	if _, err := os.Stat(filepath.Join(f.Project, "docs")); err == nil {
		t.Error("a failed council saved a document")
	}
}

// ---- the harness version and the bench mark ----

func TestStartRecordsHarness(t *testing.T) {
	h := newHarness(t)
	h.f.gate("ux/r1")
	saved := h.start(councilAs(t, "a", ""))
	if saved.Harness != HarnessVersion {
		t.Errorf("Start returned a council with harness %q, want %q", saved.Harness, HarnessVersion)
	}
	h.f.entered(t, "ux/r1")
	if got := h.load("a"); got.Harness != HarnessVersion {
		t.Errorf("the running council was saved with harness %q, want %q", got.Harness, HarnessVersion)
	}

	// a council that waits in the queue records it when its own run begins
	queued := h.start(councilAs(t, "b", "b-"))
	if queued.State != StateQueued {
		t.Fatalf("second Start = %s, want queued", queued.State)
	}
	h.f.release("ux/r1")
	for _, id := range []string{"a", "b"} {
		if c := h.wait(id); c.State != StateDone || c.Harness != HarnessVersion {
			t.Errorf("%s ended %s with harness %q, want done with %q", id, c.State, c.Harness, HarnessVersion)
		}
	}
}

func TestStartSavedRecordsHarness(t *testing.T) {
	h := newHarness(t)
	rec, err := h.r.Record(councilAs(t, "n", ""))
	if err != nil {
		t.Fatalf("Record: %v", err)
	}
	if rec.Harness != "" {
		t.Errorf("a council that has not run has harness %q, want none: nothing ran it", rec.Harness)
	}
	started, err := h.r.StartSaved(context.Background(), "n")
	if err != nil {
		t.Fatalf("StartSaved: %v", err)
	}
	if started.Harness != HarnessVersion {
		t.Errorf("StartSaved returned a council with harness %q, want %q", started.Harness, HarnessVersion)
	}
	if c := h.wait("n"); c.State != StateDone || c.Harness != HarnessVersion {
		t.Errorf("after StartSaved: %s with harness %q, want done with %q", c.State, c.Harness, HarnessVersion)
	}
}

func TestBenchCouncilSavesNoDocument(t *testing.T) {
	useDocDay(t)
	h := newHarness(t)

	// done
	a := councilAs(t, "a", "")
	a.Bench = true
	if c := h.run(a); c.State != StateDone || !c.Bench || c.DocPath != "" {
		t.Errorf("bench council: %s, bench %v, document at %q; want done, bench, no document", c.State, c.Bench, c.DocPath)
	}
	if _, err := os.Stat(filepath.Join(a.Project, "docs")); err == nil {
		t.Error("a bench council that ended done wrote into its project's docs folder")
	}

	// stopped
	b := councilAs(t, "b", "b-")
	b.Bench = true
	h.holdFirst(b)
	if got, err := h.r.Stop("b"); err != nil || got.State != StateStopped || got.DocPath != "" {
		t.Errorf("Stop of a bench council = %+v, %v, want stopped with no document", got, err)
	}
	if _, err := os.Stat(filepath.Join(b.Project, "docs")); err == nil {
		t.Error("a bench council that was stopped wrote into its project's docs folder")
	}

	// the same councils without the mark do save one
	n := councilAs(t, "n", "n-")
	if c := h.run(n); c.State != StateDone || c.DocPath == "" {
		t.Errorf("council without the bench mark: %s, document at %q; want done with a document", c.State, c.DocPath)
	}
	s := councilAs(t, "s", "s-")
	h.holdFirst(s)
	if got, err := h.r.Stop("s"); err != nil || got.State != StateStopped || got.DocPath == "" {
		t.Errorf("Stop of a council without the bench mark = %+v, %v, want stopped with a document", got, err)
	}
}

func TestDocPathWriteErrorStillEndsTheCouncil(t *testing.T) {
	h := newHarness(t)
	logs := &syncBuf{}
	log.SetOutput(logs)
	t.Cleanup(func() { log.SetOutput(os.Stderr) })

	// docs is a file, so docs/council cannot be made
	a := councilAs(t, "a", "")
	if err := os.WriteFile(filepath.Join(a.Project, "docs"), []byte("not a folder"), 0o644); err != nil {
		t.Fatal(err)
	}
	c := h.run(a)
	if c.State != StateDone || c.DocPath != "" || c.Summary == nil {
		t.Errorf("council = %s with the document at %q, want it done with no document", c.State, c.DocPath)
	}
	if !strings.Contains(logs.String(), "document not saved") {
		t.Errorf("the failed write was not logged: %q", logs.String())
	}

	// a project folder that is not there is not made for the document
	gone := councilAs(t, "g", "g-")
	gone.Project = filepath.Join(t.TempDir(), "gone")
	if got := h.run(gone); got.State != StateDone || got.DocPath != "" {
		t.Errorf("council with no project folder = %s, document %q", got.State, got.DocPath)
	}
	if _, err := os.Stat(gone.Project); err == nil {
		t.Error("the project folder was created to hold the document")
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

func TestSuggestMode(t *testing.T) {
	h := newHarness(t)
	project := t.TempDir()
	suggest := func(raw map[string]any) CouncilSuggestion {
		t.Helper()
		raw["files"], raw["roles"] = []string{}, []any{}
		h.f.setText("suggest/suggest", fence(mustJSON(raw)))
		got, err := h.r.Suggest(context.Background(), project, "Council is hard for a newcomer", "How do we fix it?", nil)
		if err != nil {
			t.Fatalf("Suggest: %v", err)
		}
		return got
	}

	for name, tc := range map[string]struct {
		raw     map[string]any
		mode    string
		modeWhy string
	}{
		"a brainstorm":          {map[string]any{"mode": "brainstorm", "modewhy": " a goal with no answer yet "}, ModeBrainstorm, "a goal with no answer yet"},
		"a review":              {map[string]any{"mode": "review", "modewhy": "a spec to judge"}, ModeReview, "a spec to judge"},
		"another case":          {map[string]any{"mode": " Brainstorm ", "modewhy": "x"}, ModeBrainstorm, "x"},
		"a mode with no reason": {map[string]any{"mode": "brainstorm"}, ModeBrainstorm, ""},
		"no mode":               {map[string]any{"group": "ui-feature"}, "", ""},
		"an unknown mode":       {map[string]any{"mode": "fast", "modewhy": "because"}, "", ""},
		"a reason with no mode": {map[string]any{"modewhy": "because"}, "", ""},
	} {
		t.Run(name, func(t *testing.T) {
			got := suggest(tc.raw)
			if got.Mode != tc.mode || got.ModeWhy != tc.modeWhy {
				t.Errorf("mode %q why %q, want %q and %q", got.Mode, got.ModeWhy, tc.mode, tc.modeWhy)
			}
		})
	}

	req := h.f.calls("suggest")[0]
	mustContain(t, "suggest prompt", req.Prompt, `"mode"`, `"modewhy"`, ModeBrainstorm, ModeReview, "a problem or a goal", "a thing to judge", "product-ideas: Product ideas")
}

// ---- Brainstorm ----

func brainstormTestCouncil(id string) *Council {
	c := testCouncil(id)
	c.Mode, c.ModeWhy = ModeBrainstorm, "a goal with no answer yet"
	c.Feature = "Make Council easy for a newcomer"
	return c
}

var wildHeadRe = regexp.MustCompile(`(?m)^### (P\d+) · .* \(wild idea\)$`)

// brainstormRound1 gives an idea with no evidence, and flags it wild when the expert is ram.
func brainstormRound1(req CallReq) string {
	idea := map[string]any{"title": "Idea from " + req.Expert.Id, "argument": "Argument from " + req.Expert.Id}
	if req.Expert.Id == "ram" {
		idea["wild"] = true
	}
	return fence(mustJSON(map[string]any{"overview": "x", "proposals": []map[string]any{idea}}))
}

// brainstormRound2 builds on the first idea it reviews, accepts the others, and picks all it reviewed.
func brainstormRound2(req CallReq) string {
	ids := idsIn(proposalHeadRe, sectionText(req.Prompt, "## Proposals to review"))
	stances := []map[string]any{}
	for i, pid := range ids {
		s := map[string]any{"proposalid": pid, "stance": "accept"}
		if i == 0 {
			s["builds"], s["reason"] = true, "Build from "+req.Expert.Id+" on "+pid
		}
		stances = append(stances, s)
	}
	return fence(mustJSON(map[string]any{"stances": stances, "picks": ids}))
}

func TestBrainstormRunKeepsKept(t *testing.T) {
	h := newHarness(t)
	for _, id := range panelIds() {
		h.f.setFn(id+"/r1", brainstormRound1)
		h.f.setFn(id+"/r2", brainstormRound2)
	}
	h.f.setFn("lead/r3", func(req CallReq) string {
		wild := idsIn(wildHeadRe, req.Prompt)
		dirs := []map[string]any{}
		for i, title := range []string{"Idea one", "Idea two", "Idea three", "Idea four"} {
			dirs = append(dirs, map[string]any{
				"rank": i + 1, "title": title, "reasoning": "Why " + title + ".", "firststep": "Start " + title,
				"from": []string{"P1"}, "stances": map[string]string{"ux": "accept"},
			})
		}
		return fence(mustJSON(map[string]any{
			"text": "Four ideas.", "answer": "Start with the tour.", "directions": dirs,
			"kept":     []map[string]any{{"title": "A mascot", "reasoning": "Odd but kind.", "from": append(wild, "P99")}},
			"outcomes": map[string]string{"P1": "Direction 1", wild[0]: "Kept aside"},
			"weak":     []map[string]string{{"ref": "P1", "note": "no evidence"}},
		}))
	})

	c := h.run(brainstormTestCouncil("b1"))
	if c.State != StateDone || c.Round != 3 || c.Error != "" || c.Summary == nil {
		t.Fatalf("final = %s round %d error %q summary %v, want done with a summary", c.State, c.Round, c.Error, c.Summary)
	}
	if c.Mode != ModeBrainstorm || c.ModeWhy != "a goal with no answer yet" {
		t.Errorf("mode %q why %q, want both kept", c.Mode, c.ModeWhy)
	}

	// round 1: ram's idea is wild, and no idea carries the "cites no evidence" chip a Review gives
	wild := 0
	for _, p := range c.Proposals {
		if p.Wild {
			wild++
			if p.Author != "ram" {
				t.Errorf("%s by %s is wild, want only ram's", p.Id, p.Author)
			}
		}
		if len(p.Evidence) != 0 {
			t.Errorf("%s evidence = %+v, want none: a Brainstorm asks for none", p.Id, p.Evidence)
		}
	}
	if wild != 1 || len(c.Proposals) != 4 {
		t.Errorf("%d wild of %d ideas, want 1 of 4", wild, len(c.Proposals))
	}

	// round 2: the first idea each expert reviewed is built on, the rest are plain agreements
	builds, accepts := 0, 0
	for _, r := range c.Replies {
		switch {
		case r.Builds:
			builds++
			if !strings.HasPrefix(r.Text, "Build from "+r.Author) || r.Stance != StanceAccept || r.Round != 2 {
				t.Errorf("build %+v, want its text, an accept in round 2", r)
			}
		case r.Stance == StanceAccept:
			accepts++
			if r.Text != "" {
				t.Errorf("accept %+v, want a bare reaction", r)
			}
		}
	}
	if builds != 4 || accepts != 8 {
		t.Errorf("%d builds and %d accepts, want 4 and 8", builds, accepts)
	}
	for _, id := range panelIds() {
		if len(c.Picks[id]) != 3 {
			t.Errorf("Picks[%s] = %v, want 3", id, c.Picks[id])
		}
	}

	// round 3: three ideas worth trying (the fourth is cut), each with a first step; the wild idea is kept aside
	s := c.Summary
	if len(s.Directions) != 3 || s.Directions[0].Title != "Idea one" || s.Directions[0].FirstStep != "Start Idea one" || s.Directions[2].FirstStep != "Start Idea three" {
		t.Errorf("directions = %+v, want the first three with their first steps", s.Directions)
	}
	var wildId string
	for _, p := range c.Proposals {
		if p.Wild {
			wildId = p.Id
		}
	}
	if len(s.Kept) != 1 || s.Kept[0].Title != "A mascot" || !slices.Equal(s.Kept[0].From, []string{wildId}) {
		t.Errorf("kept = %+v, want the mascot from %s only (P99 is not on the council)", s.Kept, wildId)
	}
	if s.Outcomes[wildId] != "Kept aside" || s.Answer != "Start with the tour." {
		t.Errorf("outcomes %v answer %q", s.Outcomes, s.Answer)
	}
	for _, p := range c.Proposals {
		if len(p.Evidence) != 0 {
			t.Errorf("%s evidence = %+v after the synthesis, want none: a Brainstorm marks nothing weak", p.Id, p.Evidence)
		}
	}

	// the prompts the experts got were the Brainstorm's
	for _, kind := range []string{"r1", "r2", "r3"} {
		reqs := h.f.calls(kind)
		if len(reqs) == 0 {
			t.Fatalf("no %s calls", kind)
		}
		for _, req := range reqs {
			mustContain(t, kind+" prompt", req.Prompt, "brainstorms ideas")
			mustNotContain(t, kind+" prompt", req.Prompt, evidenceRule)
		}
	}
}

func TestBrainstormRunLeavesNoKeptSectionWhenThereAreNoWildIdeas(t *testing.T) {
	h := newHarness(t)
	h.f.setFn("lead/r3", func(CallReq) string {
		return fence(`{"text": "One idea.", "directions": [{"rank": 1, "title": "Idea one", "reasoning": "Why.", "firststep": "Start", "from": ["P1"]}], "kept": [], "outcomes": {}}`)
	})
	c := h.run(brainstormTestCouncil("b2"))
	if c.Summary == nil || len(c.Summary.Kept) != 0 || len(c.Summary.Directions) != 1 {
		t.Fatalf("summary = %+v, want one idea and nothing kept", c.Summary)
	}
	raw, err := json.Marshal(c.Summary)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), `"kept"`) {
		t.Errorf("summary JSON = %s, want no kept field", raw)
	}
}

func TestAReviewKeepsNothingOfABrainstorm(t *testing.T) {
	h := newHarness(t)
	// a Review model that wanders into Brainstorm words: the flags and fields are dropped, the weak chip stays
	h.f.setFn("ux/r1", func(CallReq) string {
		return fence(`{"overview": "x", "proposals": [{"title": "Idea from ux", "argument": "a", "wild": true}]}`)
	})
	h.f.setFn("ram/r2", func(req CallReq) string {
		ids := idsIn(proposalHeadRe, sectionText(req.Prompt, "## Proposals to review"))
		return fence(mustJSON(map[string]any{"stances": []map[string]any{{"proposalid": ids[0], "stance": "accept", "builds": true, "reason": "Build."}}}))
	})
	h.f.setFn("lead/r3", func(CallReq) string {
		return fence(`{"text": "x", "directions": [{"rank": 1, "title": "One", "firststep": "Start", "from": ["P1"]}], "kept": [{"title": "A mascot"}], "outcomes": {}}`)
	})
	c := h.run(testCouncil("r1"))
	ux := repliesBy(c, "ram")
	if len(ux) != 1 || ux[0].Builds {
		t.Errorf("ram's replies = %+v, want one that does not build", ux)
	}
	for _, p := range c.Proposals {
		if p.Wild {
			t.Errorf("%s is wild in a Review", p.Id)
		}
		if p.Author == "ux" && (len(p.Evidence) != 1 || !p.Evidence[0].Weak || p.Evidence[0].Note != noEvidenceNote) {
			t.Errorf("%s evidence = %+v, want the weak chip a Review gives", p.Id, p.Evidence)
		}
	}
	if c.Summary == nil || len(c.Summary.Kept) != 0 || c.Summary.Directions[0].FirstStep != "" {
		t.Errorf("summary = %+v, want no kept ideas and no first step in a Review", c.Summary)
	}
}

func TestApplyRound2Builds(t *testing.T) {
	brainstorm := picksCouncil()
	brainstorm.Mode = ModeBrainstorm
	review := picksCouncil()
	res := Round2Result{Stances: []Round2Stance{
		{ProposalId: "P2", Stance: StanceAccept, Builds: true, Reason: "Add a badge."},
		{ProposalId: "P3", Stance: StanceAccept, Builds: true},
		{ProposalId: "P6", Stance: StanceAccept},
	}}
	applyRound2(brainstorm, brainstorm.Experts[0], res, 5)
	if len(brainstorm.Replies) != 3 {
		t.Fatalf("replies = %+v, want three", brainstorm.Replies)
	}
	if r := brainstorm.Replies[0]; !r.Builds || r.Text != "Add a badge." || r.Stance != StanceAccept {
		t.Errorf("reply 0 = %+v, want a build with its text", r)
	}
	if r := brainstorm.Replies[1]; r.Builds || r.Text != "" {
		t.Errorf("reply 1 = %+v, want a build with no words to read as a plain accept", r)
	}
	if r := brainstorm.Replies[2]; r.Builds {
		t.Errorf("reply 2 = %+v, want a plain accept", r)
	}

	applyRound2(review, review.Experts[0], res, 5)
	for _, r := range review.Replies {
		if r.Builds {
			t.Errorf("reply %+v builds in a Review", r)
		}
	}
}

func TestCleanSummaryForABrainstorm(t *testing.T) {
	c := fixtureCouncil("c1", StateDone, 3) // P1 by ux, P2 by ram
	c.Mode = ModeBrainstorm
	dir := func(title string) CouncilDirection {
		return CouncilDirection{Title: title, From: []string{"P1"}, FirstStep: "Start " + title}
	}
	in := CouncilSummary{
		Directions: []CouncilDirection{dir("a"), dir("b"), dir("c"), dir("d")},
		Kept: []CouncilDirection{
			{Title: "wild", From: []string{"P2", "P2", "P9"}, Stances: map[string]CouncilStance{"ux": StanceAccept, "ghost": StanceAccept}},
			{Title: "gone", From: []string{"P9"}},
		},
	}
	got := cleanSummary(c, in)
	if len(got.Directions) != maxIdeas || got.Directions[2].Title != "c" {
		t.Errorf("directions = %+v, want the first %d", got.Directions, maxIdeas)
	}
	if len(got.Kept) != 2 || !slices.Equal(got.Kept[0].From, []string{"P2"}) || len(got.Kept[1].From) != 0 {
		t.Errorf("kept = %+v, want the known ids once; a kept idea that cites nothing real stays (it is the model's idea)", got.Kept)
	}
	if want := map[string]CouncilStance{"ux": StanceAccept}; !reflect.DeepEqual(got.Kept[0].Stances, want) {
		t.Errorf("kept stances = %v, want %v", got.Kept[0].Stances, want)
	}

	c.Mode = ModeReview
	got = cleanSummary(c, in)
	if len(got.Directions) != 4 || len(got.Kept) != 0 || got.Directions[0].FirstStep != "" {
		t.Errorf("review summary = %+v, want no cap, no kept ideas and no first steps", got)
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
