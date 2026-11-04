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
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/consult"
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
// "<expert id>/<kind>", with kind r1, r2, r3, ans, suggest or autogen; the test can hold, fail or rewrite any key.
type fakeCaller struct {
	mu    sync.Mutex
	reqs  []CallReq
	fail  map[string]error
	text  map[string]string
	fn    map[string]func(req CallReq) string
	gates map[string]*gate
	tools map[string][]string
	clean string // a model no failure is set on: a call on it answers even when its key is set to fail
}

func newFake() *fakeCaller {
	return &fakeCaller{
		fail: map[string]error{}, text: map[string]string{}, fn: map[string]func(CallReq) string{},
		gates: map[string]*gate{}, tools: map[string][]string{},
	}
}

var roundLineRe = regexp.MustCompile(`This is round (\d+) of (\d+)`)

// kindOf is what a prompt asks for: r1 (the ideas), r2 (a reply pass), r3 (the synthesis, the last round whatever its
// number), ans (the person's replies), suggest, autogen or route (the router's pick of the seat for a whole-council
// message; its call is keyed "router/route"), precheck (the check before a direction is set) or roundcheck (the check
// after a pass; both are keyed "check/<kind>").
func kindOf(prompt string) string {
	switch {
	case strings.HasPrefix(prompt, "You route one message the person sent"):
		return "route"
	case strings.HasPrefix(prompt, "You check one direction the person wants to set"):
		return "precheck"
	case strings.HasPrefix(prompt, "You read one round of a council discussion"):
		return "roundcheck"
	}
	if m := roundLineRe.FindStringSubmatch(prompt); m != nil {
		switch n, _ := strconv.Atoi(m[1]); {
		case n == 1:
			return "r1"
		case m[1] == m[2]:
			return "r3"
		}
		return "r2"
	}
	switch {
	case strings.Contains(prompt, "The council has already met"):
		return "ans"
	case strings.Contains(prompt, "about to review one feature"):
		return "suggest"
	case strings.Contains(prompt, "You write the opening of a council"):
		return "autogen"
	}
	return "?"
}

var callTokens = map[string]int64{"r1": 100, "r2": 10, "r3": 50, "ans": 5, "suggest": 7, "route": 3, "precheck": 6, "roundcheck": 4}

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
	if failure != nil && (f.clean == "" || req.Expert.Model != f.clean) {
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
	ids := idsIn(replyHeadRe, req.Prompt)
	if len(ids) == 0 { // an agent seat's prompt lists what the person asks it, as round 2 does
		ids = idsIn(askLineRe, sectionText(req.Prompt, "## What the person asks you"))
	}
	return fence(mustJSON(map[string]any{"answers": answersFor(req, ids)}))
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
	case "route":
		return routeJSON(firstSeatIn(req.Prompt))
	case "roundcheck":
		return `{"change": false}`
	case "precheck":
		return fitsReply
	}
	return "no canned reply for " + kind
}

var routerSeatLineRe = regexp.MustCompile(`(?m)^- (\S+) — `)

// firstSeatIn is the first seat the router prompt lists, the one a fake router picks unless the test says otherwise.
func firstSeatIn(prompt string) string {
	return idsIn(routerSeatLineRe, sectionText(prompt, "## The seats you can choose"))[0]
}

// routeJSON is the router's reply naming seats, reading no files.
func routeJSON(seats ...string) string { return routeToolsJSON(false, seats...) }

func routeToolsJSON(tools bool, seats ...string) string {
	return mustJSON(map[string]any{"seats": seats, "tools": tools, "reason": "It is about " + strings.Join(seats, " and ") + "."})
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
	t      *testing.T
	r      *Runner
	f      *fakeCaller
	agents *fakeCaller // answers for the seats that are live agents
	clock  int64

	mu   sync.Mutex
	seen []Council
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	useTempRoot(t)
	useTempConfig(t)
	h := &harness{t: t, f: newFake(), agents: newFake(), clock: 1_700_000_000_000}
	// a test never runs git for Start's snapshot unless it asks (useSnapshot, or takeSnapshot = Snapshot)
	prevSnapshot := takeSnapshot
	takeSnapshot = func(context.Context, string) (string, error) { return "", nil }
	t.Cleanup(func() { takeSnapshot = prevSnapshot })
	h.r = &Runner{Caller: h.f, Agents: h.agents, Now: h.tick, OnChange: func(c *Council) {
		h.mu.Lock()
		defer h.mu.Unlock()
		h.seen = append(h.seen, *c)
	}}
	t.Cleanup(h.drain) // registered last, so it runs before the temp dirs go
	return h
}

func (h *harness) tick() int64 { return atomic.AddInt64(&h.clock, 1000) }

// drain stops every run still going, and waits for the router calls still in flight (ReplyWith and MarkStale start them
// on goroutines of their own), so none writes to a store the test has already removed.
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
	h.idle()
}

// idle waits until no router call is in flight. A test that gated the router (h.f.gate("router/route")) releases it first.
func (h *harness) idle() {
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		h.r.mu.Lock()
		n := len(h.r.routing)
		h.r.mu.Unlock()
		if n == 0 {
			return
		}
		time.Sleep(5 * time.Millisecond)
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

// waitRouted waits for the router's pick on the person's reply replyId of council id to be saved (Routed no longer
// pending), and returns the reply as saved.
func (h *harness) waitRouted(id, replyId string) CouncilReply {
	h.t.Helper()
	var got CouncilReply
	waitFor(h.t, "the router's pick on "+replyId, func() bool {
		c, err := Load(id)
		if err != nil {
			return false
		}
		pr := findReply(c, replyId)
		if pr == nil {
			return false
		}
		got = *pr
		return pr.Routed != nil && !pr.Routed.Pending
	})
	return got
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
	// 4 ideas, 4 replies, the round check after the reply pass, and the synthesis
	if c.Calls != 10 || c.Tokens != 4*100+4*10+callTokens["roundcheck"]+50 {
		t.Errorf("calls %d tokens %d, want 10 and 494", c.Calls, c.Tokens)
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
	if c := h.wait("c1"); c.State != StateDone || c.Calls != 10 || c.Summary == nil {
		t.Fatalf("after StartSaved: %s with %d calls, want done with 10 (9 and the round check)", c.State, c.Calls)
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

	rep, err := h.r.Reply("c1", "P1", "", "Why is that first?", false, nil)
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
	rep, err := h.r.Reply("c1", "", "", "@all Does it work on a Mac?", false, nil)
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
		if _, err := h.r.Reply("c1", "", "", fmt.Sprintf("@all Question %d?", i), false, nil); err != nil {
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
	applyRound2(c, ux, Round2Result{Picks: []string{"P3", "P1", "P99", "P4", "P5", "P3", "P2", "P6", "P7"}}, 2, 5)
	if got, want := c.Picks["ux"], []string{"P3", "P2", "P6"}; !slices.Equal(got, want) {
		t.Errorf("picks = %v, want %v", got, want)
	}
	applyRound2(c, c.Experts[1], Round2Result{Picks: []string{"P2", "P99"}}, 2, 5)
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
	}}, 2, 5)
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

// The new argument shows on the proposal; the revision's reply says what changed, never the argument again.
func TestApplyRound2ARevisionRepliesWithTheChangeNotTheArgument(t *testing.T) {
	for name, tc := range map[string]struct {
		rv       Round2Revision
		reply    bool   // a revised reply is posted
		text     string // its text: the seat's change line only
		retitled string // its new title, a field of its own
	}{
		"a new argument with its change":   {Round2Revision{Argument: "New.", Change: "Dropped the Mac case."}, true, "Dropped the Mac case.", ""},
		"a new argument with no change":    {Round2Revision{Argument: "New."}, true, "", ""},
		"a new title and argument":         {Round2Revision{Title: "Uno", Argument: "New."}, true, "", "Uno"},
		"a new title with its change":      {Round2Revision{Title: "Uno", Change: "Shorter."}, true, "Shorter.", "Uno"},
		"the same argument, a change only": {Round2Revision{Argument: "Old.", Change: "Nothing really."}, false, "", ""},
	} {
		c := picksCouncil()
		c.Proposals[0].Argument = "Old."
		tc.rv.ProposalId = "P1"
		applyRound2(c, c.Experts[0], Round2Result{Revisions: []Round2Revision{tc.rv}}, 2, 5)
		if !tc.reply {
			if len(c.Replies) != 0 {
				t.Errorf("%s: replies %+v, want none", name, c.Replies)
			}
			continue
		}
		if len(c.Replies) != 1 || !c.Replies[0].Revised || c.Replies[0].Text != tc.text || c.Replies[0].Retitled != tc.retitled {
			t.Errorf("%s: replies %+v, want one revised reply reading %q, retitled %q", name, c.Replies, tc.text, tc.retitled)
		}
		if tc.rv.Argument != "" && c.Proposals[0].Argument != tc.rv.Argument {
			t.Errorf("%s: argument %q, want it revised in place", name, c.Proposals[0].Argument)
		}
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
				{"proposalid": own[0], "withdraw": false, "title": "A better title", "argument": "A better argument.", "change": "Narrowed it to the Mac."},
				{"proposalid": "P99", "withdraw": true},
			},
		}))
	})
	h.f.setFn("ram/r2", func(req CallReq) string {
		return fence(mustJSON(map[string]any{
			"stances":   stancesFor(req),
			"revisions": []map[string]any{{"proposalid": ownIds(req)[0], "withdraw": true, "change": "UX's idea covers it."}},
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
	if r := revised(uxP); r == nil || r.Text != "Narrowed it to the Mac." || r.Retitled != "A better title" || r.Stance != "" {
		t.Errorf("ux's revision reply = %+v, want the author's reply saying what changed, not the new argument again", r)
	}
	if r := revised(ramP); r == nil || !r.Withdraws || r.Text != "UX's idea covers it." {
		t.Errorf("ram's withdrawal reply = %+v, want it marked a withdrawal with the seat's reason as its text", r)
	}
	if r := revised(uxP); r == nil || r.Withdraws {
		t.Errorf("ux's revision reply = %+v, want it not marked a withdrawal", r)
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
	if len(c.Failed) != 1 || len(c.Proposals) != 3 || c.Calls != 9 {
		t.Fatalf("failed %v, %d proposals, %d calls, want only ram failed, 3 proposals and 4+3+1 calls and the round check", c.Failed, len(c.Proposals), c.Calls)
	}
	if st := c.Stats["ram"]; st.Calls != 1 {
		t.Errorf("stats[ram] = %+v, want the failed call counted", st)
	}
	for _, req := range h.f.calls("r2") {
		if req.Expert.Id == "ram" {
			t.Errorf("ram, who failed round 1, was called in round 2")
		}
	}
	mustContain(t, "synthesis prompt", h.f.calls("r3")[0].Prompt, "Memory watcher (its round 1 call failed)") // Start names the RAM seat for its council

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
	if c.State != StateDone || len(c.Failed) != 0 || len(c.Proposals) != 4 || c.Calls != 10 {
		t.Fatalf("after Retry: %s, failed %v, %d proposals, %d calls (want 10: the first run's 9 and the retried idea)", c.State, c.Failed, len(c.Proposals), c.Calls)
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
	mustContain(t, "synthesis prompt", h.f.calls("r3")[0].Prompt, "Bug hunter (its round 2 call failed)") // Start names the Skeptic seat for its council

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

func TestRetryAllRerunsEveryFailedSeatInOneRun(t *testing.T) {
	h := newHarness(t)
	h.f.setFail("ram/r1", errors.New("boom"))
	h.f.setFail("skeptic/r2", errors.New("timed out"))
	c := h.run(testCouncil("c1"))
	if len(c.Failed) != 2 || c.State != StateDone {
		t.Fatalf("failed %v, state %s, want ram and skeptic failed in a done council", c.Failed, c.State)
	}
	if _, err := h.r.RetryAll("c1", map[string]string{"nobody": "sonnet"}); err == nil || !strings.Contains(err.Error(), "no expert nobody") {
		t.Errorf("RetryAll with an unknown seat = %v, want an error naming it", err)
	}
	if _, err := h.r.RetryAll("c1", map[string]string{"ram": "not a model"}); err == nil {
		t.Errorf("RetryAll with a malformed model worked")
	}
	h.f.setFail("ram/r1", nil)
	h.f.setFail("skeptic/r2", nil)
	r1, r2 := len(h.f.calls("r1")), len(h.f.calls("r2"))
	saved, err := h.r.RetryAll("c1", map[string]string{"ram": " fable ", "skeptic": "sonnet"})
	if err != nil {
		t.Fatalf("RetryAll: %v", err)
	}
	if saved.State != StateRunning {
		t.Fatalf("RetryAll returned %s, want running", saved.State)
	}
	// a single Retry while that run is on is refused, which is why the seats go in one run
	if _, err := h.r.Retry("c1", "skeptic"); err == nil || !strings.Contains(err.Error(), "is running") {
		t.Errorf("Retry during RetryAll = %v, want the council busy", err)
	}
	c = h.wait("c1")
	if got := h.f.calls("r1"); len(got) != r1+1 || got[r1].Expert.Id != "ram" || got[r1].Expert.Model != "fable" {
		t.Fatalf("round 1 calls %d, want ram's rerun on fable", len(got))
	}
	if got := h.f.calls("r2"); len(got) != r2+1 || got[r2].Expert.Id != "skeptic" {
		t.Fatalf("round 2 calls %d, want skeptic's rerun", len(got))
	}
	if len(c.Failed) != 0 || c.State != StateDone {
		t.Fatalf("after RetryAll: failed %v, state %s, want none and done", c.Failed, c.State)
	}
	if len(c.Retries) != 1 || c.Retries[0].Expert != "ram" || c.Retries[0].Model != "fable" || c.Retries[0].Round != 1 {
		t.Errorf("retries %+v, want ram's on fable kept and skeptic's own-model retry not", c.Retries)
	}
	if n := len(h.f.calls("r3")); n != 1 {
		t.Errorf("RetryAll reran the synthesis (%d calls)", n)
	}
	if _, err := h.r.RetryAll("c1", nil); err == nil || !strings.Contains(err.Error(), "no failed seat") {
		t.Errorf("RetryAll with nothing failed = %v, want an error saying so", err)
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
			if st := c.Stats["lead"]; st.Calls != 1 || c.Calls != 10 {
				t.Errorf("stats[lead] %+v, calls %d, want the failed call counted (10: the round check is one of them)", st, c.Calls)
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

func TestRetryOnAnotherModelRunsOnceOnItAndKeepsTheSeat(t *testing.T) {
	t.Run("coordinator", func(t *testing.T) {
		h := newHarness(t)
		h.f.setFail("lead/r3", errors.New("opus overloaded"))
		h.run(testCouncil("c1"))
		// a retry on another model that fails again leaves no retry on the council
		if _, err := h.r.RetryOn("c1", "lead", "sonnet"); err != nil {
			t.Fatalf("RetryOn: %v", err)
		}
		c := h.wait("c1")
		if c.State != StateFailed || len(c.Retries) != 0 {
			t.Fatalf("after a failed retry: %s, retries %+v, want failed and none kept", c.State, c.Retries)
		}
		h.f.setFail("lead/r3", nil)
		if _, err := h.r.RetryOn("c1", "lead", "sonnet"); err != nil {
			t.Fatalf("RetryOn: %v", err)
		}
		c = h.wait("c1")
		r3 := h.f.calls("r3")
		if len(r3) != 3 || r3[2].Expert.Model != "sonnet" || r3[1].Expert.Model != "sonnet" || r3[0].Expert.Model != "opus" {
			t.Fatalf("synthesis calls %d, want the first on opus and both retries on sonnet", len(r3))
		}
		if c.State != StateDone || c.Summary == nil || len(c.Failed) != 0 {
			t.Fatalf("after RetryOn: %s summary %v failed %v, want done with a summary", c.State, c.Summary, c.Failed)
		}
		if lead := c.Experts[len(c.Experts)-1]; lead.Model != "opus" {
			t.Errorf("the coordinator's model is %q, want its seat kept on opus", lead.Model)
		}
		if len(c.Retries) != 1 || c.Retries[0] != (CouncilRetry{Expert: "lead", Round: 3, Model: "sonnet", Was: "opus", Ts: c.Retries[0].Ts}) {
			t.Fatalf("retries %+v, want the one that worked", c.Retries)
		}
		mustContain(t, "document", Document(c), "- Retried: Lead in round 3 on sonnet (its seat is opus)")
	})
	t.Run("expert", func(t *testing.T) {
		h := newHarness(t)
		h.f.setFail("ram/r1", errors.New("claude exited 1: boom"))
		h.run(testCouncil("c1"))
		h.f.setFail("ram/r1", nil)
		if _, err := h.r.RetryOn("c1", "ram", " fable "); err != nil {
			t.Fatalf("RetryOn: %v", err)
		}
		c := h.wait("c1")
		r1 := h.f.calls("r1")
		if last := r1[len(r1)-1]; last.Expert.Id != "ram" || last.Expert.Model != "fable" {
			t.Fatalf("last round 1 call %s on %q, want ram on fable", last.Expert.Id, last.Expert.Model)
		}
		if c.Experts[1].Model != "sonnet" || len(c.Failed) != 0 {
			t.Fatalf("ram's model %q, failed %v, want the seat kept on sonnet and no failure", c.Experts[1].Model, c.Failed)
		}
		if len(c.Retries) != 1 || c.Retries[0].Expert != "ram" || c.Retries[0].Round != 1 || c.Retries[0].Model != "fable" || c.Retries[0].Was != "sonnet" {
			t.Fatalf("retries %+v, want ram's round 1 on fable", c.Retries)
		}
	})
	t.Run("the seat's own model is a plain retry", func(t *testing.T) {
		h := newHarness(t)
		h.f.setFail("ram/r1", errors.New("boom"))
		h.run(testCouncil("c1"))
		h.f.setFail("ram/r1", nil)
		if _, err := h.r.RetryOn("c1", "ram", "sonnet"); err != nil {
			t.Fatalf("RetryOn: %v", err)
		}
		if c := h.wait("c1"); len(c.Failed) != 0 || len(c.Retries) != 0 {
			t.Fatalf("failed %v retries %+v, want the failure cleared and no retry kept", c.Failed, c.Retries)
		}
	})
	t.Run("a name that is not a model is refused", func(t *testing.T) {
		h := newHarness(t)
		h.f.setFail("ram/r1", errors.New("boom"))
		h.run(testCouncil("c1"))
		before := len(h.f.calls("r1"))
		for _, m := range []string{"so net", "--dangerously-skip-permissions", "a;b"} {
			if _, err := h.r.RetryOn("c1", "ram", m); err == nil {
				t.Errorf("RetryOn with %q worked, want it refused", m)
			}
		}
		if len(h.f.calls("r1")) != before {
			t.Errorf("a refused retry made a call")
		}
	})
}

var flagged = errors.New("API Error: Opus 5.5's safeguards flagged this session (https://www.anthropic.com/legal/aup). You may be seeing this for the first time …")

func TestSafeguardFlagRunsTheCallAgainOnOpus48(t *testing.T) {
	t.Run("coordinator", func(t *testing.T) {
		h := newHarness(t)
		h.f.clean = SafeguardFallback
		h.f.setFail("lead/r3", flagged)
		c := h.run(testCouncil("c1"))
		r3 := h.f.calls("r3")
		if len(r3) != 2 || r3[0].Expert.Model != "opus" || r3[1].Expert.Model != SafeguardFallback {
			t.Fatalf("synthesis calls %d, want one on opus then one on %s", len(r3), SafeguardFallback)
		}
		if c.State != StateDone || c.Summary == nil || len(c.Failed) != 0 {
			t.Fatalf("%s summary %v failed %v, want done with a summary", c.State, c.Summary, c.Failed)
		}
		if lead := c.Experts[len(c.Experts)-1]; lead.Model != "opus" {
			t.Errorf("the coordinator's model is %q, want its seat kept on opus", lead.Model)
		}
		if len(c.Retries) != 1 || c.Retries[0] != (CouncilRetry{Expert: "lead", Round: 3, Model: SafeguardFallback, Was: "opus", Ts: c.Retries[0].Ts, Auto: true}) {
			t.Fatalf("retries %+v, want the fallback kept", c.Retries)
		}
		mustContain(t, "document", Document(c), "- Retried: Lead in round 3 on claude-opus-4-8 (its seat is opus; Claude's safeguards flagged it)")
	})
	t.Run("expert", func(t *testing.T) {
		h := newHarness(t)
		h.f.clean = SafeguardFallback
		h.f.setFail("ram/r1", flagged)
		c := h.run(testCouncil("c1"))
		if len(c.Failed) != 0 || len(c.Retries) != 1 || c.Retries[0].Expert != "ram" || c.Retries[0].Round != 1 || !c.Retries[0].Auto {
			t.Fatalf("failed %v retries %+v, want ram's round 1 answered on the fallback", c.Failed, c.Retries)
		}
	})
	t.Run("flagged on the fallback too is one failure", func(t *testing.T) {
		h := newHarness(t)
		h.f.setFail("lead/r3", flagged)
		c := h.run(testCouncil("c1"))
		if n := len(h.f.calls("r3")); n != 2 {
			t.Fatalf("synthesis calls %d, want 2: the call and one fallback", n)
		}
		f, ok := c.Failed["lead"]
		if c.State != StateFailed || !ok || !strings.Contains(f.Error, "again on claude-opus-4-8") || len(c.Retries) != 0 {
			t.Fatalf("%s failed %+v retries %+v, want failed naming the fallback, no retry kept", c.State, f, c.Retries)
		}
	})
	t.Run("another error is not run again", func(t *testing.T) {
		h := newHarness(t)
		h.f.clean = SafeguardFallback
		h.f.setFail("lead/r3", errors.New("opus overloaded"))
		h.run(testCouncil("c1"))
		if n := len(h.f.calls("r3")); n != 1 {
			t.Fatalf("synthesis calls %d, want 1", n)
		}
	})
	t.Run("a retry by hand that falls back keeps one retry", func(t *testing.T) {
		h := newHarness(t)
		h.f.setFail("ram/r1", flagged)
		h.run(testCouncil("c1"))
		h.f.clean = SafeguardFallback
		if _, err := h.r.RetryOn("c1", "ram", "fable"); err != nil {
			t.Fatalf("RetryOn: %v", err)
		}
		c := h.wait("c1")
		if len(c.Failed) != 0 || len(c.Retries) != 1 || c.Retries[0].Model != SafeguardFallback || !c.Retries[0].Auto {
			t.Fatalf("failed %v retries %+v, want only the fallback kept", c.Failed, c.Retries)
		}
	})
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
		{"the whole council, by @all", "", "", "@all what about Mac?", []string{"ux", "ram", "newuser", "skeptic"}, ""},
		{"the whole council, by @everyone in any case", "", "", "what about Mac, @Everyone?", []string{"ux", "ram", "newuser", "skeptic"}, ""},
		{"@all beside a seat's name", "", "", "@all, and @RAM first", []string{"ux", "ram", "newuser", "skeptic"}, ""},
		{"@all in a branch", "P1", "", "@all why?", []string{"ux", "ram", "newuser", "skeptic"}, "P1"},
		{"an address is no @all", "P1", "", "mail me at x@all.com", []string{"ux"}, "P1"},
		{"a longer word is no @all", "P1", "", "@allies are good", []string{"ux"}, "P1"},
		{"a file is no @all", "P1", "", "see @all.md", []string{"ux"}, "P1"},
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
			got, err := h.r.Reply(id, tc.proposal, tc.parent, "  "+tc.text+"  ", true, nil)
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

	// A chat seat is reached by @ and a whole word of 8 characters or more that starts its tab id and starts no other
	// chat seat's. A word runs over letters, digits, _ and -, so the key that tells two UUID tab ids apart runs past the
	// dash at their 9th character. A miss falls back to the branch of P1, which is UX.
	const (
		scoutTab  = "82faafca-1111-4222-8333-444455556666"
		designTab = "5065bd8c-2222-4333-8444-555566667777"
		twinA     = "3e19c0d2-a1b2-4c3d-8e9f-000000000001"
		twinB     = "3e19c0d2-b7c8-4d9e-8f01-000000000002"
		kinA      = "9f8e7d6c1aaaa"
		kinB      = "9f8e7d6c2bbbb"
	)
	chatCases := []struct {
		name string
		tabs []string // the chats already seated, in order, named Scout and Design
		text string
		to   []string
	}{
		{"the first 8 of its tab id", []string{scoutTab}, "@82faafca what do you think?", []string{"agent-" + scoutTab}},
		{"upper case", []string{scoutTab}, "@82FAAFCA what do you think?", []string{"agent-" + scoutTab}},
		{"its whole tab id", []string{scoutTab}, "@" + scoutTab + " what do you think?", []string{"agent-" + scoutTab}},
		{"a longer prefix, past the dash", []string{scoutTab}, "@82faafca-1111-42 what do you think?", []string{"agent-" + scoutTab}},
		{"at the end of a sentence", []string{scoutTab}, "What would @82faafca.", []string{"agent-" + scoutTab}},
		{"7 characters are too few", []string{scoutTab}, "@82faafc what do you think?", []string{"ux"}},
		{"a word that is no prefix", []string{scoutTab}, "@82faafca1 what do you think?", []string{"ux"}},
		{"a word that runs on", []string{scoutTab}, "@82faafca-x what do you think?", []string{"ux"}},
		{"an address is no mention", []string{scoutTab}, "mail x@82faafca.com", []string{"ux"}},
		{"its name still reaches it", []string{scoutTab}, "@Scout what do you think?", []string{"agent-" + scoutTab}},
		{"its seat id still reaches it", []string{scoutTab}, "@agent-" + scoutTab + " what do you think?", []string{"agent-" + scoutTab}},
		{"two chats and a role, in the council's order", []string{scoutTab, designTab}, "@5065bd8c and @82faafca and @ram", []string{"ram", "agent-" + scoutTab, "agent-" + designTab}},
		{"UUIDs that share 8 characters: the 8 reach neither", []string{twinA, twinB}, "@3e19c0d2 thoughts?", []string{"ux"}},
		{"UUIDs that share 8 characters: the dash reaches neither", []string{twinA, twinB}, "@3e19c0d2- thoughts?", []string{"ux"}},
		{"UUIDs that share 8 characters: the first one's key", []string{twinA, twinB}, "@3e19c0d2-a thoughts?", []string{"agent-" + twinA}},
		{"UUIDs that share 8 characters: the second one's key", []string{twinA, twinB}, "@3e19c0d2-b thoughts?", []string{"agent-" + twinB}},
		{"UUIDs that share 8 characters: each by its key", []string{twinA, twinB}, "@3e19c0d2-b and @3e19c0d2-a", []string{"agent-" + twinA, "agent-" + twinB}},
		{"ids that share 8 characters: the 8 reach neither", []string{kinA, kinB}, "@9f8e7d6c thoughts?", []string{"ux"}},
		{"ids that share 8 characters: the 9 reach their own", []string{kinA, kinB}, "@9f8e7d6c1 thoughts?", []string{"agent-" + kinA}},
		{"ids that share 8 characters: the other's 9", []string{kinA, kinB}, "@9f8e7d6c2 thoughts?", []string{"agent-" + kinB}},
	}
	for i, tc := range chatCases {
		t.Run(tc.name, func(t *testing.T) {
			h := newHarness(t)
			id := fmt.Sprintf("k%d", i)
			c := fixtureCouncil(id, StateAwaiting, 2)
			for j, tab := range tc.tabs {
				withChatSeats(c, chatSeat(tab, []string{"Scout", "Design"}[j]))
			}
			h.save(c)
			got, err := h.r.Reply(id, "P1", "", tc.text, false, nil)
			if err != nil {
				t.Fatalf("Reply: %v", err)
			}
			if to := got.Replies[len(got.Replies)-1].To; !reflect.DeepEqual(to, tc.to) {
				t.Errorf("%q reaches %v, want %v", tc.text, to, tc.to)
			}
		})
	}
}

// chatSeat is a live chat's seat as the wshserver builds it from a roster row: its seat id is "agent-" and its tab id.
func chatSeat(tab, name string) CouncilExpert {
	return CouncilExpert{Id: "agent-" + tab, Name: name, Agent: tab, Harness: HarnessClaude}
}

// withChatSeats seats the chats in c in front of its coordinator, as a start does.
func withChatSeats(c *Council, seats ...CouncilExpert) *Council {
	c.Experts = slices.Insert(c.Experts, len(c.Experts)-1, seats...)
	return c
}

// TestRouteCandidates: the seats the router may pick are the panel's, in panel order, less the coordinator and any seat
// whose call failed.
func TestRouteCandidates(t *testing.T) {
	const scoutTab = "82faafca-1111-4222-8333-444455556666"
	cases := []struct {
		name   string
		failed map[string]CouncilFailure
		chats  bool
		want   []string
	}{
		{"every panel seat, never the coordinator", nil, false, []string{"ux", "ram", "newuser", "skeptic"}},
		{"a seat with a failed call is left out", map[string]CouncilFailure{"ram": {Round: 1, Error: "boom"}}, false, []string{"ux", "newuser", "skeptic"}},
		{"the coordinator's failure changes nothing", map[string]CouncilFailure{"lead": {Round: 3, Error: "boom"}}, false, []string{"ux", "ram", "newuser", "skeptic"}},
		{"a chat sits after the role seats, in panel order", nil, true, []string{"ux", "ram", "newuser", "skeptic", "agent-" + scoutTab}},
		{"a chat that failed is left out too", map[string]CouncilFailure{"agent-" + scoutTab: {Round: 2, Error: "gone"}}, true, []string{"ux", "ram", "newuser", "skeptic"}},
		{"every seat failed", map[string]CouncilFailure{
			"ux": {Error: "x"}, "ram": {Error: "x"}, "newuser": {Error: "x"}, "skeptic": {Error: "x"},
		}, false, []string{}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c := testCouncil("rc")
			if tc.chats {
				withChatSeats(c, chatSeat(scoutTab, "Scout"))
			}
			c.Failed = tc.failed
			got := idsOf(routeCandidates(c))
			if !reflect.DeepEqual(got, tc.want) {
				t.Errorf("routeCandidates = %v, want %v", got, tc.want)
			}
		})
	}
}

// ---- routing a whole-council message ----

const wholeAsk = "What stays in memory when it sleeps?"

// routerCall is the one router call the fake caller saw.
func routerCall(t *testing.T, f *fakeCaller) CallReq {
	t.Helper()
	calls := f.calls("route")
	if len(calls) != 1 {
		t.Fatalf("%d router calls, want exactly 1", len(calls))
	}
	return calls[0]
}

// answerIds are the seats the answers pass called, in the order it called them.
func answerIds(f *fakeCaller) []string {
	var out []string
	for _, req := range f.calls("ans") {
		out = append(out, req.Expert.Id)
	}
	return out
}

// leavePending saves council id with one more message of the person's that the router never answered (wavesrv quit while
// it worked): To empty, Routed pending. It returns the reply's id; mod may change the council before it is saved.
func (h *harness) leavePending(id string, mod ...func(c *Council)) string {
	h.t.Helper()
	c := h.load(id)
	replyId := nextReplyId(c)
	c.Replies = append(c.Replies, CouncilReply{
		Id: replyId, Author: YouId, Text: wholeAsk, Round: followRound(c), Ts: h.tick(), Routed: &CouncilRouted{Pending: true},
	})
	for _, m := range mod {
		m(c)
	}
	h.save(c)
	return replyId
}

// A whole-council message of the person's goes to the router, which picks the seat that answers it: only that seat is
// called, the council books the router's call and tokens, and the pick is stored beside To.
func TestReplyRoutedOneSeat(t *testing.T) {
	h := newHarness(t)
	done := h.run(testCouncil("c1"))
	h.f.setText("router/route", routeJSON("ram"))

	rep, err := h.r.Reply("c1", "", "", wholeAsk, false, nil)
	if err != nil {
		t.Fatalf("Reply: %v", err)
	}
	if posted := replyOf(t, rep, "r13"); len(posted.To) != 0 || posted.Routed == nil || !posted.Routed.Pending {
		t.Fatalf("the reply as posted = %+v, want To empty and the router pending", posted)
	}
	c := h.wait("c1")

	req := routerCall(t, h.f)
	if req.Tools || req.Expert.Id != "router" || req.Expert.Model != "haiku" {
		t.Errorf("router call = tools %v, %s on %s, want no tools, the router on haiku", req.Tools, req.Expert.Id, req.Expert.Model)
	}
	mustContain(t, "the router's prompt", req.Prompt, wholeAsk)
	if got := answerIds(h.f); !slices.Equal(got, []string{"ram"}) {
		t.Errorf("answer calls to %v, want ram alone", got)
	}
	reply := replyOf(t, c, "r13")
	if want := (&CouncilRouted{Chose: []string{"ram"}, Reason: "It is about ram."}); !reflect.DeepEqual(reply.Routed, want) ||
		!slices.Equal(reply.To, []string{"ram"}) || !reply.Answered {
		t.Errorf("the reply = %+v routed %+v, want To ram, answered, and %+v", reply, reply.Routed, want)
	}
	if !answeredBy(c, "r13", "ram") || answeredBy(c, "r13", "ux") {
		t.Errorf("ram answered %v, ux answered %v, want ram only", answeredBy(c, "r13", "ram"), answeredBy(c, "r13", "ux"))
	}
	// the router is no seat: its call and tokens are the council's, and no seat's Stats nor a card of its own; the round
	// check after the answer is the council's too
	if c.Calls != done.Calls+3 || c.Tokens != done.Tokens+3+5+callTokens["roundcheck"] {
		t.Errorf("calls %d tokens %d, want %d and %d: the router's call, the one answer and the round check", c.Calls, c.Tokens, done.Calls+3, done.Tokens+3+5+callTokens["roundcheck"])
	}
	if _, ok := c.Stats["router"]; ok {
		t.Errorf("Stats has a router entry %+v, want none: it is no seat", c.Stats["router"])
	}
	for _, id := range panelIds() {
		want := done.Stats[id].Calls
		if id == "ram" {
			want++
		}
		if got := c.Stats[id].Calls; got != want {
			t.Errorf("stats[%s].Calls = %d, want %d", id, got, want)
		}
	}
	if c.State != StateDone || c.Round != 3 {
		t.Errorf("after the follow-up: %s round %d, want done as it was", c.State, c.Round)
	}
}

// Two seats, in the router's order (not panel order): the first answers alone, and the second is shown its answer.
func TestReplyRoutedTwoSeats(t *testing.T) {
	h := newHarness(t)
	h.run(testCouncil("c1"))
	h.f.setText("router/route", routeJSON("skeptic", "ux"))

	if _, err := h.r.Reply("c1", "", "", wholeAsk, false, nil); err != nil {
		t.Fatalf("Reply: %v", err)
	}
	c := h.wait("c1")

	ans := h.f.calls("ans")
	if len(ans) != 2 || ans[0].Expert.Id != "skeptic" || ans[1].Expert.Id != "ux" {
		t.Fatalf("answer calls to %v, want the skeptic first and then ux, and no third seat", answerIds(h.f))
	}
	mustNotContain(t, "the first seat's prompt", ans[0].Prompt, othersAnsweredRule)
	mustContain(t, "the second seat's prompt", ans[1].Prompt, "- Bug hunter: Answer from skeptic", othersAnsweredRule)
	reply := replyOf(t, c, "r13")
	if !slices.Equal(reply.To, []string{"skeptic", "ux"}) || !slices.Equal(reply.Routed.Chose, []string{"skeptic", "ux"}) || !reply.Answered {
		t.Errorf("the reply = To %v routed %+v, want the router's two seats in its order, answered", reply.To, reply.Routed)
	}
	if !answeredBy(c, "r13", "skeptic") || !answeredBy(c, "r13", "ux") || answeredBy(c, "r13", "ram") {
		t.Errorf("answers under r13 are not the skeptic's and ux's alone")
	}
}

// Small talk the router answers itself: its answer is posted under the message as the router's reply, no seat is called,
// the message is answered with no seat in To, and Ask <seat> too still brings a seat in under it.
func TestReplyRouterAnswersItself(t *testing.T) {
	h := newHarness(t)
	done := h.run(testCouncil("c1"))
	h.f.setText("router/route", mustJSON(map[string]any{"seats": []string{}, "answer": "  Chào bạn! Bạn muốn xem phần nào?  ", "reason": "a greeting"}))

	if _, err := h.r.Reply("c1", "", "", "hello", false, nil); err != nil {
		t.Fatalf("Reply: %v", err)
	}
	c := h.wait("c1")

	if got := answerIds(h.f); len(got) != 0 {
		t.Errorf("answer calls to %v, want none: the router answered", got)
	}
	reply := replyOf(t, c, "r13")
	if want := (&CouncilRouted{Reason: "a greeting"}); !reflect.DeepEqual(reply.Routed, want) || len(reply.To) != 0 || !reply.Answered {
		t.Errorf("the message = To %v routed %+v answered %v, want To empty, answered, routed %+v", reply.To, reply.Routed, reply.Answered, want)
	}
	answer := replyOf(t, c, "r14")
	if answer.Author != "router" || answer.ParentId != "r13" || answer.Text != "Chào bạn! Bạn muốn xem phần nào?" || answer.Draft != "" {
		t.Errorf("the router's answer = %+v, want the router's sent reply under r13, trimmed", answer)
	}
	if c.Calls != done.Calls+1 {
		t.Errorf("calls %d, want %d: the router's call alone", c.Calls, done.Calls+1)
	}
	if _, ok := c.Stats["router"]; ok {
		t.Errorf("Stats has a router entry %+v, want none: it is no seat", c.Stats["router"])
	}

	// Ask RAM too: RAM answers under the same message and is shown the router's answer
	if _, err := h.r.AskToo("c1", "r13", "ram"); err != nil {
		t.Fatalf("AskToo: %v", err)
	}
	c = h.wait("c1")
	if got := answerIds(h.f); !slices.Equal(got, []string{"ram"}) {
		t.Errorf("answer calls to %v, want ram alone", got)
	}
	if !answeredBy(c, "r13", "ram") {
		t.Errorf("ram did not answer r13")
	}
}

// A message that @-mentions a seat, one in a thread, one that seats a chat and Continue's question go where they always
// went, with no router call.
func TestReplyMentionSkipsRouter(t *testing.T) {
	h := newHarness(t)
	h.run(testCouncil("c1"))
	rep, err := h.r.Reply("c1", "", "", "@RAM and @UX, "+wholeAsk, false, nil)
	if err != nil {
		t.Fatalf("Reply: %v", err)
	}
	if posted := replyOf(t, rep, "r13"); posted.Routed != nil || !slices.Equal(posted.To, []string{"ux", "ram"}) {
		t.Errorf("the reply = To %v routed %+v, want the two seats it names, unrouted", posted.To, posted.Routed)
	}
	h.wait("c1")
	if n := len(h.f.calls("route")); n != 0 {
		t.Errorf("%d router calls, want none for a message that names its seats", n)
	}
	if got := answerIds(h.f); !slices.Equal(got, []string{"ux", "ram"}) {
		t.Errorf("answer calls to %v, want ux first and then ram", got)
	}
}

func TestReplyInThreadSkipsRouter(t *testing.T) {
	h := newHarness(t)
	author := proposalOf(t, h.run(testCouncil("c1")), "P1").Author
	rep, err := h.r.Reply("c1", "P1", "", wholeAsk, false, nil)
	if err != nil {
		t.Fatalf("Reply: %v", err)
	}
	if posted := replyOf(t, rep, "r13"); posted.Routed != nil || !slices.Equal(posted.To, []string{author}) {
		t.Errorf("the reply = To %v routed %+v, want the proposal's author %s, unrouted", posted.To, posted.Routed, author)
	}
	h.wait("c1")
	if n := len(h.f.calls("route")); n != 0 {
		t.Errorf("%d router calls, want none for a reply in a thread", n)
	}
	if got := answerIds(h.f); !slices.Equal(got, []string{author}) {
		t.Errorf("answer calls to %v, want %s alone", got, author)
	}
}

func TestReplyJoiningChatSkipsRouter(t *testing.T) {
	h := newHarness(t)
	h.run(testCouncil("c1"))
	scout := chatSeat("tab-9", "Scout")
	rep, err := h.r.Reply("c1", "", "", wholeAsk, false, []CouncilExpert{scout})
	if err != nil {
		t.Fatalf("Reply: %v", err)
	}
	posted := replyOf(t, rep, "r13")
	if want := append(panelIds(), "agent-tab-9"); posted.Routed != nil || !slices.Equal(posted.To, want) {
		t.Errorf("the reply = To %v routed %+v, want the whole panel and the chat it seated, unrouted", posted.To, posted.Routed)
	}
	h.wait("c1")
	if n := len(h.f.calls("route")); n != 0 {
		t.Errorf("%d router calls, want none for a message that seats a chat", n)
	}
}

func TestContinueQuestionNotRouted(t *testing.T) {
	h := newHarness(t)
	c := testCouncil("c1")
	c.PauseAfterRound1 = true
	h.run(c)
	if _, err := h.r.Continue("c1", nil, "What about Mac?"); err != nil {
		t.Fatalf("Continue: %v", err)
	}
	got := h.wait("c1")
	ask := repliesBy(got, YouId)[0]
	if ask.Routed != nil || !slices.Equal(ask.To, panelIds()) || !ask.Answered {
		t.Errorf("the question = To %v routed %+v answered %v, want every seat, unrouted, answered in round 2", ask.To, ask.Routed, ask.Answered)
	}
	if n := len(h.f.calls("route")); n != 0 {
		t.Errorf("%d router calls, want none for Continue's own question", n)
	}
}

// @all (or @everyone, in any case) asks every seat on purpose: no router, the first seat answers, and the rest answer
// after it, shown its answer.
func TestAtAllReachesEverySeat(t *testing.T) {
	for _, text := range []string{"@all " + wholeAsk, wholeAsk + " @EVERYONE", "@everyone, and @RAM first: " + wholeAsk} {
		t.Run(text, func(t *testing.T) {
			h := newHarness(t)
			h.run(testCouncil("c1"))
			rep, err := h.r.Reply("c1", "", "", text, false, nil)
			if err != nil {
				t.Fatalf("Reply: %v", err)
			}
			if posted := replyOf(t, rep, "r13"); posted.Routed != nil || !slices.Equal(posted.To, panelIds()) {
				t.Fatalf("the reply = To %v routed %+v, want every seat, unrouted", posted.To, posted.Routed)
			}
			h.wait("c1")
			if n := len(h.f.calls("route")); n != 0 {
				t.Errorf("%d router calls, want none for a message to everyone", n)
			}
			ans := h.f.calls("ans")
			if len(ans) != 4 || ans[0].Expert.Id != "ux" {
				t.Fatalf("answer calls to %v, want all four with ux first", answerIds(h.f))
			}
			mustNotContain(t, "the first seat's prompt", ans[0].Prompt, othersAnsweredRule)
			for _, req := range ans[1:] {
				mustContain(t, req.Expert.Id+"'s prompt", req.Prompt, "- Ease of use: Answer from ux", othersAnsweredRule)
			}
		})
	}
}

// A router that errors, answers nothing usable or names no seat on the panel falls back to the first seat that can
// answer, in panel order, which answers alone: no second pass. The line says the router failed and why.
func TestReplyRouterFailsFallsBack(t *testing.T) {
	cases := []struct {
		name       string
		set        func(f *fakeCaller)
		reason     string
		routerToks int64 // the failed call's tokens the council still books
	}{
		{"the call errors", func(f *fakeCaller) { f.setFail("router/route", errors.New("claude is not signed in")) }, "claude is not signed in", 0},
		{"it names an unknown seat", func(f *fakeCaller) { f.setText("router/route", routeJSON("ghost")) }, "no seat", 3},
		{"it answers with no JSON", func(f *fakeCaller) { f.setText("router/route", "I would ask UX.") }, "router", 3},
		{"it answers with nothing", func(f *fakeCaller) { f.setText("router/route", "  ") }, "empty reply", 3},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			h := newHarness(t)
			done := h.run(testCouncil("c1"))
			tc.set(h.f)
			if _, err := h.r.Reply("c1", "", "", wholeAsk, false, nil); err != nil {
				t.Fatalf("Reply: %v", err)
			}
			c := h.wait("c1")
			reply := replyOf(t, c, "r13")
			if reply.Routed == nil || !reply.Routed.Failed || reply.Routed.Pending || !slices.Equal(reply.Routed.Chose, []string{"ux"}) ||
				!strings.Contains(reply.Routed.Reason, tc.reason) || !slices.Equal(reply.To, []string{"ux"}) || !reply.Answered {
				t.Errorf("the reply = To %v routed %+v, want the first seat, failed, with a reason holding %q, answered", reply.To, reply.Routed, tc.reason)
			}
			if got := answerIds(h.f); !slices.Equal(got, []string{"ux"}) {
				t.Errorf("answer calls to %v, want the first seat alone and no second pass", got)
			}
			// the failed router call, the one answer, and the round check after it
			wantTokens := done.Tokens + tc.routerToks + 5 + callTokens["roundcheck"]
			if c.Calls != done.Calls+3 || c.Tokens != wantTokens {
				t.Errorf("calls %d tokens %d, want %d and %d: the failed router call is booked too", c.Calls, c.Tokens, done.Calls+3, wantTokens)
			}
		})
	}

	t.Run("a seat that failed is passed over", func(t *testing.T) {
		h := newHarness(t)
		h.f.setFail("ux/r1", errors.New("boom"))
		h.run(testCouncil("c1"))
		h.f.setFail("router/route", errors.New("down"))
		if _, err := h.r.Reply("c1", "", "", wholeAsk, false, nil); err != nil {
			t.Fatalf("Reply: %v", err)
		}
		h.wait("c1")
		if got := answerIds(h.f); !slices.Equal(got, []string{"ram"}) {
			t.Errorf("answer calls to %v, want ram: the first seat whose call did not fail", got)
		}
	})
}

// Let them read files, Auto: the router decides it for a message it routes. The person's On or Off, an attachment and an
// @file are never overridden, and a failed router leaves the composer's guess.
func TestReplyRouterTools(t *testing.T) {
	const file = "Check @pkg/services/idle.go: " + wholeAsk
	cases := []struct {
		name       string
		in         ReplyIn
		routerSays bool
		routerFail bool
		wantTools  bool
		wantAuto   bool
	}{
		{"Auto, the router says read", ReplyIn{Text: wholeAsk, ToolsAuto: true}, true, false, true, true},
		{"Auto, the router says do not, over the composer's guess", ReplyIn{Text: wholeAsk, ToolsAuto: true, Tools: true}, false, false, false, true},
		{"On stays on when the router says no", ReplyIn{Text: wholeAsk, Tools: true}, false, false, true, false},
		{"Off stays off when the router says yes", ReplyIn{Text: wholeAsk}, true, false, false, false},
		{"an attachment keeps it on", ReplyIn{Text: wholeAsk, ToolsAuto: true, Attachments: []string{attached("2026-11-03-a1", "one.png")}}, false, false, true, false},
		{"an @file keeps it on", ReplyIn{Text: file, ToolsAuto: true}, false, false, true, false},
		{"a failed router keeps the composer's guess: on", ReplyIn{Text: wholeAsk, ToolsAuto: true, Tools: true}, false, true, true, true},
		{"a failed router keeps the composer's guess: off", ReplyIn{Text: wholeAsk, ToolsAuto: true}, true, true, false, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			h := newHarness(t)
			h.run(testCouncil("c1"))
			if tc.routerFail {
				h.f.setFail("router/route", errors.New("down"))
			} else {
				h.f.setText("router/route", routeToolsJSON(tc.routerSays, "ux"))
			}
			if _, err := h.r.ReplyWith("c1", tc.in); err != nil {
				t.Fatalf("ReplyWith: %v", err)
			}
			c := h.wait("c1")
			reply := replyOf(t, c, "r13")
			if reply.Tools != tc.wantTools || reply.Routed == nil || reply.Routed.AutoTools != tc.wantAuto {
				t.Errorf("the reply = Tools %v routed %+v, want Tools %v and AutoTools %v", reply.Tools, reply.Routed, tc.wantTools, tc.wantAuto)
			}
			ans := h.f.calls("ans")
			if len(ans) != 1 || ans[0].Tools != tc.wantTools || (ans[0].OnTool != nil) != tc.wantTools {
				t.Fatalf("answer calls = %d, the seat's with tools %v, want one with tools %v", len(ans), len(ans) > 0 && ans[0].Tools, tc.wantTools)
			}
		})
	}
}

// A message at the pause after round 1 is routed at once, though no run is on, and round 2 takes it up only for the seat
// the router chose.
func TestReplyRoutedBeforeRound2(t *testing.T) {
	h := newHarness(t)
	c := testCouncil("c1")
	c.PauseAfterRound1 = true
	h.run(c)
	h.f.setText("router/route", routeJSON("ram"))

	rep, err := h.r.Reply("c1", "", "", wholeAsk, false, nil)
	if err != nil {
		t.Fatalf("Reply: %v", err)
	}
	if rep.State != StateAwaiting {
		t.Fatalf("a reply at the pause left the council %s, want awaiting-you", rep.State)
	}
	got := h.waitRouted("c1", "r1")
	if !slices.Equal(got.To, []string{"ram"}) || !slices.Equal(got.Routed.Chose, []string{"ram"}) || got.Answered {
		t.Fatalf("the reply = To %v routed %+v answered %v, want ram chosen with no run on, still open", got.To, got.Routed, got.Answered)
	}
	if n := len(h.f.calls("r2")) + len(h.f.calls("ans")); n != 0 {
		t.Fatalf("%d seat calls before Continue, want none", n)
	}

	if _, err := h.r.Continue("c1", nil, ""); err != nil {
		t.Fatalf("Continue: %v", err)
	}
	done := h.wait("c1")
	for _, req := range h.f.calls("r2") {
		if has := strings.Contains(req.Prompt, wholeAsk); has != (req.Expert.Id == "ram") {
			t.Errorf("%s's round 2 prompt has the message: %v, want it only for ram", req.Expert.Id, has)
		}
	}
	if n := len(h.f.calls("route")); n != 1 {
		t.Errorf("%d router calls, want the one made at the pause", n)
	}
	if n := len(h.f.calls("ans")); n != 0 || !replyOf(t, done, "r1").Answered || !answeredBy(done, "r1", "ram") || answeredBy(done, "r1", "ux") {
		t.Errorf("%d answers-pass calls, answered %v, want round 2 to have answered it, for ram alone", n, replyOf(t, done, "r1").Answered)
	}
}

// A pass that finds a reply still pending while the router is in flight waits for that call rather than make another.
func TestRoutePendingOnce(t *testing.T) {
	h := newHarness(t)
	h.run(testCouncil("c1"))
	h.f.gate("router/route")
	h.f.setText("router/route", routeJSON("ram"))

	rep, err := h.r.Reply("c1", "", "", wholeAsk, false, nil)
	if err != nil {
		t.Fatalf("Reply: %v", err)
	}
	if rep.State != StateRunning {
		t.Fatalf("Reply returned %s, want a running follow-up whose pass meets the router in flight", rep.State)
	}
	h.f.entered(t, "router/route")
	time.Sleep(100 * time.Millisecond) // the follow-up's pass has reached the reply that is still pending
	if n, a := len(h.f.calls("route")), len(h.f.calls("ans")); n != 1 || a != 0 {
		t.Fatalf("%d router calls and %d answer calls while the router works, want 1 and 0: the pass waits for it", n, a)
	}
	h.f.release("router/route")
	c := h.wait("c1")
	if n := len(h.f.calls("route")); n != 1 {
		t.Errorf("%d router calls, want 1 and not one from the pass too", n)
	}
	if got := answerIds(h.f); !slices.Equal(got, []string{"ram"}) || !replyOf(t, c, "r13").Answered {
		t.Errorf("answer calls to %v, answered %v, want ram alone, and the reply answered", got, replyOf(t, c, "r13").Answered)
	}
}

// However many callers ask for one reply to be routed at once, the router is called once.
func TestRouteReplyOneCallPerReply(t *testing.T) {
	h := newHarness(t)
	h.save(fixtureCouncil("c1", StateAwaiting, 2))
	id := h.leavePending("c1")
	h.f.gate("router/route")
	h.f.setText("router/route", routeJSON("ram"))

	var wg sync.WaitGroup
	for range 6 {
		wg.Go(func() { h.r.routeReply(context.Background(), "c1", id) })
	}
	h.f.entered(t, "router/route")
	time.Sleep(50 * time.Millisecond)
	h.f.release("router/route")
	wg.Wait()

	if n := len(h.f.calls("route")); n != 1 {
		t.Fatalf("%d router calls, want 1", n)
	}
	got := h.load("c1")
	if reply := replyOf(t, got, id); reply.Routed.Pending || !slices.Equal(reply.To, []string{"ram"}) || got.Calls != 1 {
		t.Errorf("the reply = %+v routed %+v, council calls %d, want it routed to ram and one call booked", reply, reply.Routed, got.Calls)
	}
}

// A call cut off because its run was stopped is no failed router: the reply stays pending, and the next caller routes it.
func TestRouteReplyCancelledStaysPending(t *testing.T) {
	h := newHarness(t)
	h.save(fixtureCouncil("c1", StateAwaiting, 2))
	id := h.leavePending("c1")
	h.f.gate("router/route")
	h.f.setText("router/route", routeJSON("ram"))

	ctx, cancel := context.WithCancel(context.Background())
	stopped := make(chan struct{})
	go func() {
		defer close(stopped)
		h.r.routeReply(ctx, "c1", id)
	}()
	h.f.entered(t, "router/route")
	cancel()
	<-stopped
	got := h.load("c1")
	if reply := replyOf(t, got, id); !reply.Routed.Pending || len(reply.To) != 0 || got.Calls != 0 {
		t.Fatalf("after the cancel: %+v routed %+v, council calls %d, want it still pending, with nothing booked", reply, reply.Routed, got.Calls)
	}

	h.f.release("router/route")
	h.r.routeReply(context.Background(), "c1", id)
	if reply := replyOf(t, h.load("c1"), id); reply.Routed.Pending || reply.Routed.Failed || !slices.Equal(reply.To, []string{"ram"}) {
		t.Errorf("after the next call: %+v routed %+v, want it routed to ram", reply, reply.Routed)
	}
}

// A runner with no caller makes no call: the reply is the fallback's, not left pending, and nothing is booked.
func TestRouteReplyNoCaller(t *testing.T) {
	h := newHarness(t)
	h.save(fixtureCouncil("c1", StateAwaiting, 2))
	id := h.leavePending("c1")
	(&Runner{}).routeReply(context.Background(), "c1", id)
	got := h.load("c1")
	reply := replyOf(t, got, id)
	if reply.Routed.Pending || !reply.Routed.Failed || !slices.Equal(reply.To, []string{"ux"}) || !strings.Contains(reply.Routed.Reason, "no caller") || got.Calls != 0 {
		t.Errorf("the reply = To %v routed %+v, council calls %d, want the first seat, failed for want of a caller, nothing booked", reply.To, reply.Routed, got.Calls)
	}
}

// Seats that failed since the message was sent can leave nothing to choose between: one is the answerer, none sends it
// to the whole panel as before, and the router is not called.
func TestRouteReplySeatsFailedMeanwhile(t *testing.T) {
	failed := func(ids ...string) func(c *Council) {
		return func(c *Council) {
			c.Failed = map[string]CouncilFailure{}
			for _, id := range ids {
				c.Failed[id] = CouncilFailure{Round: 2, Error: "boom"}
			}
		}
	}
	for name, tc := range map[string]struct {
		failed []string
		to     []string
		called bool
	}{
		"one seat left":  {[]string{"ux", "ram", "newuser"}, []string{"skeptic"}, false},
		"no seat left":   {[]string{"ux", "ram", "newuser", "skeptic"}, panelIds(), false},
		"two seats left": {[]string{"ux", "ram"}, []string{"newuser"}, true},
	} {
		t.Run(name, func(t *testing.T) {
			h := newHarness(t)
			h.save(fixtureCouncil("c1", StateAwaiting, 2))
			id := h.leavePending("c1", failed(tc.failed...))
			h.f.setText("router/route", routeJSON("newuser"))
			h.r.routeReply(context.Background(), "c1", id)
			reply := replyOf(t, h.load("c1"), id)
			if !slices.Equal(reply.To, tc.to) {
				t.Errorf("the reply goes to %v, want %v", reply.To, tc.to)
			}
			if n := len(h.f.calls("route")); (n == 1) != tc.called || (reply.Routed != nil) != tc.called {
				t.Errorf("%d router calls, routed %+v, want a call and the pick kept: %v", n, reply.Routed, tc.called)
			}
			if reply.Routed != nil && reply.Routed.Pending {
				t.Errorf("the reply is still pending: %+v", reply.Routed)
			}
		})
	}
}

// With one seat that can answer (a panel of one, or every other seat failed) there is nothing to choose: the message
// goes to it, unrouted. With none it goes to the whole panel.
func TestReplyOneCandidateNotRouted(t *testing.T) {
	t.Run("a panel of one", func(t *testing.T) {
		h := newHarness(t)
		c := fixtureCouncil("c1", StateAwaiting, 2)
		c.Experts = []CouncilExpert{c.Experts[0], c.Experts[len(c.Experts)-1]}
		h.save(c)
		got, err := h.r.Reply("c1", "", "", wholeAsk, false, nil)
		if err != nil {
			t.Fatalf("Reply: %v", err)
		}
		if posted := got.Replies[len(got.Replies)-1]; posted.Routed != nil || !slices.Equal(posted.To, []string{"ux"}) {
			t.Errorf("the reply = To %v routed %+v, want ux, unrouted", posted.To, posted.Routed)
		}
		if n := len(h.f.all()); n != 0 {
			t.Errorf("%d calls, want none", n)
		}
	})
	t.Run("every other seat failed", func(t *testing.T) {
		h := newHarness(t)
		h.f.setFail("ux/r1", errors.New("boom"))
		h.f.setFail("ram/r1", errors.New("boom"))
		h.f.setFail("newuser/r1", errors.New("boom"))
		h.run(testCouncil("c1"))
		rep, err := h.r.Reply("c1", "", "", wholeAsk, false, nil)
		if err != nil {
			t.Fatalf("Reply: %v", err)
		}
		if posted := rep.Replies[len(rep.Replies)-1]; posted.Routed != nil || !slices.Equal(posted.To, []string{"skeptic"}) {
			t.Errorf("the reply = To %v routed %+v, want the one seat left, unrouted", posted.To, posted.Routed)
		}
		h.wait("c1")
		if n := len(h.f.calls("route")); n != 0 {
			t.Errorf("%d router calls, want none", n)
		}
		if got := answerIds(h.f); !slices.Equal(got, []string{"skeptic"}) {
			t.Errorf("answer calls to %v, want the skeptic alone", got)
		}
	})
	t.Run("no seat can answer", func(t *testing.T) {
		h := newHarness(t)
		c := fixtureCouncil("c1", StateAwaiting, 2)
		c.Failed = map[string]CouncilFailure{"ux": {Round: 1}, "ram": {Round: 1}, "newuser": {Round: 1}, "skeptic": {Round: 1}}
		h.save(c)
		got, err := h.r.Reply("c1", "", "", wholeAsk, false, nil)
		if err != nil {
			t.Fatalf("Reply: %v", err)
		}
		if posted := got.Replies[len(got.Replies)-1]; posted.Routed != nil || !slices.Equal(posted.To, panelIds()) {
			t.Errorf("the reply = To %v routed %+v, want the whole panel, unrouted", posted.To, posted.Routed)
		}
	})
}

// Replies posted while a run ends, each routed: none is lost, none is left pending, and each is routed exactly once.
func TestRoutedRepliesPostedAsARunEndsAreNeverLost(t *testing.T) {
	h := newHarness(t)
	h.start(testCouncil("c1"))
	const n = 20
	for i := range n {
		if _, err := h.r.Reply("c1", "", "", fmt.Sprintf("Question %d?", i), false, nil); err != nil {
			t.Fatalf("Reply %d: %v", i, err)
		}
		time.Sleep(time.Millisecond)
	}
	h.wait("c1")
	h.idle()
	c := h.load("c1")
	asks := repliesBy(c, YouId)
	if len(asks) != n {
		t.Fatalf("%d replies stored, want %d", len(asks), n)
	}
	for _, ask := range asks {
		if ask.Routed == nil || ask.Routed.Pending || !slices.Equal(ask.To, []string{"ux"}) {
			t.Errorf("%s (%q) = To %v routed %+v, want routed to ux and not pending", ask.Id, ask.Text, ask.To, ask.Routed)
		}
		if !ask.Answered || !answeredBy(c, ask.Id, "ux") || answeredBy(c, ask.Id, "ram") {
			t.Errorf("%s (%q) answered %v, by ux %v, want it answered by ux alone", ask.Id, ask.Text, ask.Answered, answeredBy(c, ask.Id, "ux"))
		}
	}
	if got := len(h.f.calls("route")); got != n {
		t.Errorf("%d router calls for %d replies, want one each", got, n)
	}
}

// The answers pass routes a reply that was left pending (wavesrv quit while the router worked) before it answers, so the
// follow-up that a later message starts picks it up with the rest.
func TestAnswersPassRoutesAPendingReplyFirst(t *testing.T) {
	h := newHarness(t)
	h.run(testCouncil("c1"))
	old := h.leavePending("c1")
	h.f.setText("router/route", routeJSON("ram"))

	if _, err := h.r.Reply("c1", "", "", "@all And in the long run?", false, nil); err != nil {
		t.Fatalf("Reply: %v", err)
	}
	c := h.wait("c1")

	if n := len(h.f.calls("route")); n != 1 {
		t.Errorf("%d router calls, want the one for the old reply and none for @all", n)
	}
	reply := replyOf(t, c, old)
	if reply.Routed.Pending || !slices.Equal(reply.To, []string{"ram"}) || !reply.Answered {
		t.Errorf("the old reply = To %v routed %+v answered %v, want it routed to ram and answered", reply.To, reply.Routed, reply.Answered)
	}
	if !answeredBy(c, old, "ram") || answeredBy(c, old, "ux") {
		t.Errorf("the old reply was answered by ram %v and ux %v, want ram alone", answeredBy(c, old, "ram"), answeredBy(c, old, "ux"))
	}
	for _, id := range panelIds() {
		if !answeredBy(c, "r14", id) {
			t.Errorf("%s never answered the @all message", id)
		}
	}
}

// MarkStale (wavesrv's startup) routes every reply still pending, in a council in any state, and only that: the reply stays
// open and unanswered.
func TestMarkStaleRoutesPending(t *testing.T) {
	h := newHarness(t)
	h.run(testCouncil("done"))
	h.run(testCouncil("gone"))
	doneReply := h.leavePending("done")
	goneReply := h.leavePending("gone", func(c *Council) { c.State = StateRunning })
	h.f.setText("router/route", routeJSON("ram"))

	h.r.MarkStale()

	for id, replyId := range map[string]string{"done": doneReply, "gone": goneReply} {
		got := h.waitRouted(id, replyId)
		if got.Routed.Pending || got.Routed.Failed || !slices.Equal(got.Routed.Chose, []string{"ram"}) || !slices.Equal(got.To, []string{"ram"}) || got.Answered {
			t.Errorf("%s's reply = To %v routed %+v answered %v, want ram chosen and the reply left open", id, got.To, got.Routed, got.Answered)
		}
	}
	h.idle()
	if n := len(h.f.calls("route")); n != 2 {
		t.Errorf("%d router calls, want one for each council's pending reply", n)
	}
	if n := len(h.f.calls("ans")); n != 0 {
		t.Errorf("%d answer calls, want none: MarkStale settles the pick and answers nothing", n)
	}
	if c := h.load("done"); c.State != StateDone {
		t.Errorf("done council = %s, want it still done", c.State)
	}
	if c := h.load("gone"); c.State != StateStopped || !strings.Contains(c.Error, "arcterm closed") {
		t.Errorf("gone council = %s %q, want it stopped by MarkStale as before", c.State, c.Error)
	}
}

// firstAnswerers walks the reply's To in its order, so a routed reply's first pick answers first; it skips a seat that is
// not on the panel or has a failed call, and a reply already answered or answered by someone.
func TestFirstAnswerersWalksTo(t *testing.T) {
	c := testCouncil("c1")
	c.Failed = map[string]CouncilFailure{"skeptic": {Round: 2, Error: "boom"}}
	c.Replies = []CouncilReply{
		{Id: "r1", Author: YouId, Text: "routed", To: []string{"ram", "ux"}},
		{Id: "r2", Author: YouId, Text: "panel order", To: []string{"ux", "ram", "newuser", "skeptic"}},
		{Id: "r3", Author: YouId, Text: "the first failed, the second is off the panel", To: []string{"skeptic", "ghost", "newuser"}},
		{Id: "r4", Author: YouId, Text: "answered", To: []string{"ux"}, Answered: true},
		{Id: "r5", Author: YouId, Text: "one seat answered", To: []string{"ram", "ux"}},
		{Id: "r6", Author: "ux", ParentId: "r5", Text: "an answer"},
		{Id: "r7", Author: YouId, Text: "pending", Routed: &CouncilRouted{Pending: true}},
		{Id: "r8", Author: YouId, Text: "the coordinator", To: []string{"lead", "ram"}},
	}
	want := map[string]string{"r1": "ram", "r2": "ux", "r3": "newuser", "r8": "ram"}
	if got := firstAnswerers(c); !reflect.DeepEqual(got, want) {
		t.Errorf("firstAnswerers = %v, want %v", got, want)
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
			if _, err := h.r.Reply(tc.id, tc.proposal, tc.parent, tc.text, false, nil); err == nil || !strings.Contains(err.Error(), tc.want) {
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

	rep, err := h.r.Reply("c1", "P1", "", "Why is this first?", false, nil)
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
	rep, err := h.r.Reply("c1", "", "", "@all What would you do about Mac?", true, nil)
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
			t.Errorf("answer call for %s: tools %v, want Let them read files on", req.Expert.Id, req.Tools)
		}
	}
	// four answers, and a round check after each of the two batches (the first answerer, then the other three)
	if !replyOf(t, c, "r13").Answered || c.Calls != callsBefore+4+2 {
		t.Errorf("answered %v, calls %d, want it answered and 6 more calls", replyOf(t, c, "r13").Answered, c.Calls)
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

	// a second follow-up is round 5, and without tools when the person leaves Let them read files off
	if _, err := h.r.Reply("c1", "P1", "", "And this one?", false, nil); err != nil {
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

// A reply that names chats seats them: they sit after the seats that were there and before the coordinator, are targets
// of that reply whether or not it @s them, and answer it in the follow-up round. A later reply reaches a seated chat only
// when it @s it.
func TestReplySeatsChatsOnADoneCouncil(t *testing.T) {
	h := newHarness(t)
	done := h.run(testCouncil("c1"))
	if HasAgents(done) || HoldsDrafts(done) {
		t.Fatalf("the council began with a chat (%v) or holding drafts (%v), want neither", HasAgents(done), HoldsDrafts(done))
	}
	scout, design := chatSeat("tab-9", "Scout"), chatSeat("tab-8", "Design")

	h.agents.gate("agent-tab-9/ans")
	rep, err := h.r.Reply("c1", "", "", "What would you do about Mac?", false, []CouncilExpert{scout, design})
	if err != nil {
		t.Fatalf("Reply: %v", err)
	}
	if rep.State != StateRunning || rep.Round != 4 {
		t.Fatalf("Reply returned %s round %d, want a running follow-up in round 4", rep.State, rep.Round)
	}
	wantSeats := []string{"ux", "ram", "newuser", "skeptic", "agent-tab-9", "agent-tab-8", "lead"}
	if got := idsOf(rep.Experts); !slices.Equal(got, wantSeats) || !rep.Experts[len(rep.Experts)-1].Coordinator {
		t.Fatalf("seats after the reply = %v, want %v with the coordinator last", got, wantSeats)
	}
	if got := idsOf(h.load("c1").Experts); !slices.Equal(got, wantSeats) {
		t.Errorf("saved seats = %v, want %v", got, wantSeats)
	}
	if seat := rep.Experts[4]; seat.Agent != "tab-9" || seat.Harness != HarnessClaude || seat.Name != "Scout" {
		t.Errorf("first new seat = %+v, want the chat as it was passed in", seat)
	}
	posted := replyOf(t, rep, "r13")
	wantTo := append(panelIds(), "agent-tab-9", "agent-tab-8")
	if !slices.Equal(posted.To, wantTo) || posted.Round != 4 {
		t.Fatalf("the reply = %+v, want round 4, to the panel and both new chats %v", posted, wantTo)
	}

	h.agents.entered(t, "agent-tab-9/ans")
	h.agents.release("agent-tab-9/ans")
	c := h.wait("c1")
	if c.State != StateDone || c.Error != "" {
		t.Fatalf("after the follow-up: %s %q, want done", c.State, c.Error)
	}
	if HoldsDrafts(c) || HeldDrafts(c) != 0 {
		t.Errorf("a council that began free holds drafts now: %v, %d held", HoldsDrafts(c), HeldDrafts(c))
	}
	asked := h.agents.calls("ans")
	for _, id := range []string{"agent-tab-9", "agent-tab-8"} {
		i := slices.IndexFunc(asked, func(req CallReq) bool { return req.Expert.Id == id })
		if i < 0 {
			t.Fatalf("%s was not asked for its turn: %d agent calls", id, len(asked))
		}
		mustContain(t, id+"'s first prompt", asked[i].Prompt, "What would you do about Mac?", "The council has already met")
		answered := false
		for _, x := range repliesBy(c, id) {
			answered = answered || (x.ParentId == "r13" && x.Round == 4 && x.Draft == "")
		}
		if !answered {
			t.Errorf("%s has no sent answer under r13: %+v", id, repliesBy(c, id))
		}
	}

	// a seated chat is a target of a later reply only when it is @ed, and handing it over again adds nothing
	if _, err := h.r.Reply("c1", "", "", "@UX and Scout, and the rest?", false, []CouncilExpert{scout}); err != nil {
		t.Fatalf("second Reply: %v", err)
	}
	c = h.wait("c1")
	if mine := repliesBy(c, YouId); len(mine) != 2 || !slices.Equal(mine[1].To, []string{"ux"}) {
		t.Errorf("the person's replies = %+v, want a second that reaches UX only, not the chat already seated", mine)
	}
	if got := idsOf(c.Experts); !slices.Equal(got, wantSeats) {
		t.Errorf("seats after the second reply = %v, want them unchanged", got)
	}
}

// A chat seated while round 1 runs sits that round out (the round's panel was read when it began) and is asked in round
// 2; one seated on a council paused after round 1 is asked in round 2 after Continue. The coordinator reads what it said.
func TestReplySeatsAChatMidRun(t *testing.T) {
	h := newHarness(t)
	scout := chatSeat("tab-9", "Scout")

	h.f.gate("ux/r1")
	h.start(testCouncil("c1"))
	h.f.entered(t, "ux/r1")
	rep, err := h.r.Reply("c1", "", "", "Scout, join us on the Mac question.", false, []CouncilExpert{scout})
	if err != nil {
		t.Fatalf("Reply during round 1: %v", err)
	}
	if rep.State != StateRunning || rep.Round != 1 || !slices.Equal(idsOf(rep.Experts), []string{"ux", "ram", "newuser", "skeptic", "agent-tab-9", "lead"}) {
		t.Fatalf("after the reply: %s round %d, seats %v, want a running round 1 with the chat before the coordinator", rep.State, rep.Round, idsOf(rep.Experts))
	}
	h.f.release("ux/r1")
	c := h.wait("c1")
	if c.State != StateDone || c.Round != 3 {
		t.Fatalf("council ended %s round %d (%s), want done", c.State, c.Round, c.Error)
	}
	if n := len(h.agents.calls("r1")); n != 0 {
		t.Errorf("the chat was asked %d times in round 1, want it to sit round 1 out", n)
	}
	r2 := h.agents.calls("r2")
	if len(r2) != 1 || r2[0].Expert.Id != "agent-tab-9" {
		t.Fatalf("the chat's round 2 calls = %d, want one to agent-tab-9", len(r2))
	}
	mustContain(t, "the chat's round 2 prompt", r2[0].Prompt, "## What the person asks you", "join us on the Mac question")
	mustContain(t, "the coordinator's input", h.f.calls("r3")[0].Prompt, "Reason from agent-tab-9 on P1")
	if HoldsDrafts(c) || HeldDrafts(c) != 0 {
		t.Errorf("a council that began free holds drafts after a chat joined: %v, %d held", HoldsDrafts(c), HeldDrafts(c))
	}

	// paused after round 1: the chat joins while the council waits, and Continue runs round 2 with it
	paused := testCouncil("c2")
	paused.PauseAfterRound1 = true
	if got := h.run(paused); got.State != StateAwaiting || got.Round != 1 {
		t.Fatalf("council = %s round %d, want it paused after round 1", got.State, got.Round)
	}
	if _, err := h.r.Reply("c2", "", "", "Scout, join us on the Mac question.", false, []CouncilExpert{scout}); err != nil {
		t.Fatalf("Reply on the pause: %v", err)
	}
	if n := len(h.agents.calls("r1")) + len(h.agents.calls("r2")); n != 1 {
		t.Fatalf("the chat was asked %d times before Continue, want no new call", n-1)
	}
	if _, err := h.r.Continue("c2", nil, ""); err != nil {
		t.Fatalf("Continue: %v", err)
	}
	c = h.wait("c2")
	if c.State != StateDone || c.Summary == nil {
		t.Fatalf("after Continue: %s %q, want done with a summary", c.State, c.Error)
	}
	if n := len(h.agents.calls("r1")); n != 0 {
		t.Errorf("the chat was asked %d times in round 1, want none", n)
	}
	if r2 = h.agents.calls("r2"); len(r2) != 2 || r2[1].Expert.Id != "agent-tab-9" {
		t.Fatalf("round 2 calls to the chat = %d, want a second one, after Continue", len(r2))
	}
	mustContain(t, "the coordinator's input", h.f.calls("r3")[1].Prompt, "Reason from agent-tab-9 on P1")
}

func TestReplySeatsNoDuplicate(t *testing.T) {
	h := newHarness(t)
	witness, scout := chatSeat("tab-1", "Witness"), chatSeat("tab-9", "Scout")
	h.save(withChatSeats(fixtureCouncil("c1", StateAwaiting, 2), witness))
	last := func(c *Council) CouncilReply { return c.Replies[len(c.Replies)-1] }

	// a chat that sits already: no error, no second seat, and no new target for the reply
	got, err := h.r.Reply("c1", "P1", "", "Witness, are you still there?", false, []CouncilExpert{witness})
	if err != nil {
		t.Fatalf("Reply with a seated chat: %v", err)
	}
	seats := []string{"ux", "ram", "newuser", "skeptic", "agent-tab-1", "lead"}
	if ids := idsOf(got.Experts); !slices.Equal(ids, seats) || !slices.Equal(last(got).To, []string{"ux"}) {
		t.Errorf("seats = %v, reply to %v, want %v and UX only", ids, last(got).To, seats)
	}

	// the same chat twice in one reply
	got, err = h.r.Reply("c1", "P1", "", "Scout?", false, []CouncilExpert{scout, scout})
	if err != nil {
		t.Fatalf("Reply with a chat twice: %v", err)
	}
	seats = []string{"ux", "ram", "newuser", "skeptic", "agent-tab-1", "agent-tab-9", "lead"}
	if ids := idsOf(got.Experts); !slices.Equal(ids, seats) || !slices.Equal(last(got).To, []string{"ux", "agent-tab-9"}) {
		t.Errorf("seats = %v, reply to %v, want %v and UX with the one new chat", ids, last(got).To, seats)
	}

	// a seated chat and a new one together, the seated one handed over again
	again := chatSeat("tab-7", "Review")
	got, err = h.r.Reply("c1", "P1", "", "All of you?", false, []CouncilExpert{witness, again, scout, again})
	if err != nil {
		t.Fatalf("Reply with both: %v", err)
	}
	seats = []string{"ux", "ram", "newuser", "skeptic", "agent-tab-1", "agent-tab-9", "agent-tab-7", "lead"}
	if ids := idsOf(got.Experts); !slices.Equal(ids, seats) || !slices.Equal(last(got).To, []string{"ux", "agent-tab-7"}) {
		t.Errorf("seats = %v, reply to %v, want %v and UX with the one chat that is new", ids, last(got).To, seats)
	}
	if saved := h.load("c1"); !slices.Equal(idsOf(saved.Experts), seats) || len(saved.Replies) != 5 {
		t.Errorf("saved seats = %v with %d replies, want %v and 5", idsOf(saved.Experts), len(saved.Replies), seats)
	}
}

// Seating a chat never changes whether a council holds drafts: the mode it had stays, and an old record that stored none
// has it read from the seats it had just before the chat joined.
func TestReplySeatFreezesDraftMode(t *testing.T) {
	h := newHarness(t)
	witness, scout := chatSeat("tab-1", "Witness"), chatSeat("tab-9", "Scout")

	// an old record with no chat reads free, and still does after one joins
	h.save(fixtureCouncil("free", StateAwaiting, 2))
	if HoldsDrafts(h.load("free")) {
		t.Fatal("an old record with no chat holds drafts before anything joins")
	}
	got, err := h.r.Reply("free", "", "", "Join us?", false, []CouncilExpert{scout})
	if err != nil {
		t.Fatalf("Reply: %v", err)
	}
	if got.DraftMode != DraftModeFree || !HasAgents(got) || HoldsDrafts(got) {
		t.Errorf("after a chat joined an old chat-free record: mode %q, a chat %v, holds %v, want free and not holding", got.DraftMode, HasAgents(got), HoldsDrafts(got))
	}
	if saved := h.load("free"); saved.DraftMode != DraftModeFree || HoldsDrafts(saved) {
		t.Errorf("saved mode = %q, holds %v, want free", saved.DraftMode, HoldsDrafts(saved))
	}

	// an old record with a chat at its start held drafts, and still does
	h.save(withChatSeats(fixtureCouncil("held", StateAwaiting, 2), witness))
	got, err = h.r.Reply("held", "", "", "Join us?", false, []CouncilExpert{scout})
	if err != nil {
		t.Fatalf("Reply: %v", err)
	}
	if got.DraftMode != DraftModeHeld || !HoldsDrafts(got) {
		t.Errorf("after a chat joined an old record with a chat at start: mode %q, holds %v, want held", got.DraftMode, HoldsDrafts(got))
	}

	// a mode that is stored is left alone: this one began free, with a chat, and the seats would say held
	stored := withChatSeats(fixtureCouncil("stored", StateAwaiting, 2), witness)
	stored.DraftMode = DraftModeFree
	h.save(stored)
	got, err = h.r.Reply("stored", "", "", "Join us?", false, []CouncilExpert{scout})
	if err != nil || got.DraftMode != DraftModeFree || HoldsDrafts(got) {
		t.Errorf("a council that stored free = mode %q, holds %v, %v, want free", got.DraftMode, HoldsDrafts(got), err)
	}

	// a reply that seats nobody leaves the mode as it was: an old record keeps reading from its seats
	h.save(fixtureCouncil("plain", StateAwaiting, 2))
	if got, err = h.r.Reply("plain", "", "", "Anyone?", false, nil); err != nil || got.DraftMode != "" {
		t.Errorf("a reply with no chat left mode %q, %v, want it unset", got.DraftMode, err)
	}

	// on a done council the follow-up runs freely: the chat's answer is sent, not held
	h.save(fixtureCouncil("done", StateDone, 3))
	if _, err = h.r.Reply("done", "", "", "Join us?", false, []CouncilExpert{scout}); err != nil {
		t.Fatalf("Reply on a done council: %v", err)
	}
	c := h.wait("done")
	if c.State != StateDone || c.DraftMode != DraftModeFree || HeldDrafts(c) != 0 {
		t.Fatalf("done council after a chat joined: %s, mode %q, %d held, want done, free, none held", c.State, c.DraftMode, HeldDrafts(c))
	}
	if mine := repliesBy(c, "agent-tab-9"); len(mine) != 1 || mine[0].Draft != "" {
		t.Errorf("the chat's replies = %+v, want one that was sent as written", mine)
	}
}

// One Update seats the chats and posts the reply, so a reply that fails seats nobody, and a chat that cannot be a seat is
// refused before anything is saved.
func TestReplyThatFailsSeatsNothing(t *testing.T) {
	h := newHarness(t)
	scout := chatSeat("tab-9", "Scout")
	for _, state := range []CouncilState{StateAwaiting, StateDone} {
		id := string(state)
		h.save(fixtureCouncil(id, state, 3))
		before := h.load(id)
		for _, tc := range []struct {
			name           string
			proposal, want string
			parent         string
			seats          []CouncilExpert
		}{
			{"an unknown proposal", "P9", "no proposal P9", "", []CouncilExpert{scout}},
			{"an unknown parent", "P1", "no reply r9", "r9", []CouncilExpert{scout}},
			{"a role expert as a seat", "", "not a live chat", "", []CouncilExpert{{Id: "extra", Name: "Extra", Model: "sonnet"}}},
			{"a coordinator as a seat", "", "not a live chat", "", []CouncilExpert{{Id: "agent-x", Name: "X", Agent: "x", Harness: HarnessClaude, Coordinator: true}}},
			{"another harness", "", "only a claude or pi", "", []CouncilExpert{{Id: "agent-x", Name: "X", Agent: "x", Harness: "gemini"}}},
			{"a seat id that is taken", "", "listed twice", "", []CouncilExpert{{Id: "ux", Name: "X", Agent: "x", Harness: HarnessClaude}}},
		} {
			if _, err := h.r.Reply(id, tc.proposal, tc.parent, "Join us?", false, tc.seats); err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Errorf("%s council, %s: Reply = %v, want an error naming %q", state, tc.name, err, tc.want)
			}
			if after := h.load(id); !reflect.DeepEqual(after, before) {
				t.Errorf("%s council, %s: the refused reply changed the council:\n%+v\nwas\n%+v", state, tc.name, after, before)
			}
		}
		if len(h.f.all())+len(h.agents.all()) != 0 {
			t.Fatalf("%s council: a refused reply made calls", state)
		}
	}
	// the refusals left the done council free to run: no run was left registered
	if _, err := h.r.Reply("done", "", "", "Join us?", false, []CouncilExpert{scout}); err != nil {
		t.Fatalf("Reply after the refusals: %v", err)
	}
	h.wait("done")
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
			if _, err := h.r.Reply("c1", "P2", "", "Why?", false, nil); err != nil {
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

// A question to everyone (@all) is answered by the first seat on the panel first; the others answer after it, shown its
// answer, and one with nothing to add answers with no words, which is sent at once as agreement.
func TestAFollowUpToEveryoneIsAnsweredByOneSeatFirst(t *testing.T) {
	h := newHarness(t)
	h.run(testCouncil("c1"))
	h.f.setFn("ram/ans", func(req CallReq) string {
		answers := []map[string]any{}
		for _, id := range idsIn(replyHeadRe, req.Prompt) {
			answers = append(answers, map[string]any{"replyid": id, "text": ""})
		}
		return fence(mustJSON(map[string]any{"answers": answers}))
	})
	if _, err := h.r.Reply("c1", "", "", "@all You keep missing my point.", false, nil); err != nil {
		t.Fatalf("Reply: %v", err)
	}
	c := h.wait("c1")
	ans := h.f.calls("ans")
	if len(ans) != 4 || ans[0].Expert.Id != "ux" {
		t.Fatalf("%d answer calls, the first to %s, want 4 with UX first", len(ans), ans[0].Expert.Id)
	}
	mustNotContain(t, "UX's prompt", ans[0].Prompt, "Already answered", othersAnsweredRule)
	for _, req := range ans[1:] {
		mustContain(t, req.Expert.Id+"'s prompt", req.Prompt, "- Ease of use: Answer from ux", othersAnsweredRule)
	}
	ask := repliesBy(c, YouId)[0]
	var nod *CouncilReply
	for _, r := range repliesBy(c, "ram") {
		if r.ParentId == ask.Id {
			nod = &r
		}
	}
	if nod == nil || nod.Text != "" || !Sent(nod.Draft) || !ask.Answered {
		t.Errorf("RAM's answer = %+v, the ask answered %v, want a sent answer with no words", nod, ask.Answered)
	}
}

// In a council with an agent seated each answer with words is held for the person; one with none applies at once, as an
// agreement in round 2 does.
func TestAnAnswerWithNoWordsIsNotHeld(t *testing.T) {
	c := &Council{
		Experts: []CouncilExpert{{Id: "witness", Name: "Witness", Agent: "tab-1"}, {Id: "ux", Name: "UX"}, {Id: "ram", Name: "RAM"}},
		Replies: []CouncilReply{{Id: "r1", Author: YouId, Text: "Why?", To: []string{"witness", "ux", "ram"}}},
	}
	applyAnswers(c, c.Experts[1], []Answer{{ReplyId: "r1", Text: "Because."}}, 4, 1)
	applyAnswers(c, c.Experts[2], []Answer{{ReplyId: "r1"}}, 4, 2)
	if got := c.Replies[1]; got.Author != "ux" || got.Draft != DraftHeld {
		t.Errorf("UX's answer = %+v, want held", got)
	}
	if got := c.Replies[2]; got.Author != "ram" || got.Text != "" || !Sent(got.Draft) {
		t.Errorf("RAM's answer = %+v, want sent with no words", got)
	}
}

// An answer's asks are stored on its reply, for the thread to offer.
func TestAnAnswerKeepsItsAsks(t *testing.T) {
	c := &Council{
		Experts: []CouncilExpert{{Id: "ux", Name: "UX"}},
		Replies: []CouncilReply{{Id: "r1", Author: YouId, Text: "Why?", To: []string{"ux"}}},
	}
	applyAnswers(c, c.Experts[0], []Answer{{ReplyId: "r1", Text: "Because.", Asks: []string{"And on M5?"}}}, 4, 1)
	if got := c.Replies[1]; !reflect.DeepEqual(got.Asks, []string{"And on M5?"}) {
		t.Errorf("UX's answer = %+v, want its asks kept", got)
	}
}

func TestAnExpertThatFailedSitsTheAnswersPassOut(t *testing.T) {
	h := newHarness(t)
	h.f.setFail("ram/r1", errors.New("boom"))
	c := h.run(testCouncil("c1"))
	if _, err := h.r.Reply("c1", "", "", "@all Anyone?", false, nil); err != nil {
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
	if _, err := h.r.Reply("c1", "", "", "@all Anyone?", false, nil); err != nil {
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
	if _, err := h.r.Reply("c1", "P1", "", "One more thought.", false, nil); err != nil {
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
	if _, err := h.r.Reply("c1", "P1", "", "Queued for round 2.", false, nil); err != nil {
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

// A council whose ideas are all held drafts has nothing out in the room to summarize: the synthesis would see no idea.
func TestSummarizeNeedsASentIdea(t *testing.T) {
	h := newHarness(t)
	c := h.run(agentCouncil("a"))
	if c.State != StateAwaiting || len(heldIds(c)) != 2 {
		t.Fatalf("after round 1: %s holding %v, want awaiting-you with both ideas held", c.State, heldIds(c))
	}
	if _, err := h.r.Summarize("a"); err == nil || err.Error() != "council a has no sent idea to summarize" {
		t.Fatalf("Summarize with every idea held = %v, want the refusal", err)
	}
	if got := h.load("a"); got.State != StateAwaiting || got.Summary != nil || len(h.f.calls("r3")) != 0 {
		t.Errorf("the refused Summarize left %s, summary %v, %d synthesis calls", got.State, got.Summary, len(h.f.calls("r3")))
	}

	// a dropped idea is not out in the room either
	d := fixtureCouncil("b", StateAwaiting, 1)
	d.Proposals[0].Draft, d.Proposals[1].Draft = DraftHeld, DraftDropped
	h.save(d)
	if _, err := h.r.Summarize("b"); err == nil || err.Error() != "council b has no sent idea to summarize" {
		t.Fatalf("Summarize with one idea held and one dropped = %v, want the refusal", err)
	}

	// one sent idea is enough, and the council goes on waiting on the draft still held
	if _, err := h.r.Draft("a", ideaBy(t, c, "witness"), "send", ""); err != nil {
		t.Fatal(err)
	}
	if _, err := h.r.Summarize("a"); err != nil {
		t.Fatalf("Summarize with a sent idea: %v", err)
	}
	got := h.wait("a")
	if got.State != StateAwaiting || got.Summary == nil || len(h.f.calls("r3")) != 1 {
		t.Errorf("after Summarize: %s, summary %v, %d synthesis calls, want it awaiting-you with one synthesis", got.State, got.Summary, len(h.f.calls("r3")))
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

func TestDeleteRemovesAnEndedCouncilAndRefusesALiveOne(t *testing.T) {
	h := newHarness(t)
	c := testCouncil("paused")
	c.PauseAfterRound1 = true
	h.run(c)
	if _, err := h.r.Delete("paused"); err == nil {
		t.Fatalf("Delete of a council waiting on the person worked")
	}
	if _, err := Load("paused"); err != nil {
		t.Fatalf("a refused Delete removed the council: %v", err)
	}
	h.run(testCouncil("done"))
	got, err := h.r.Delete("done")
	if err != nil || got.Id != "done" {
		t.Fatalf("Delete of a done council = %v, %v", got, err)
	}
	if _, err := Load("done"); !errors.Is(err, fs.ErrNotExist) {
		t.Errorf("Load after Delete = %v, want not exist", err)
	}
	if _, err := h.r.Delete("done"); !errors.Is(err, fs.ErrNotExist) {
		t.Errorf("a second Delete = %v, want not exist", err)
	}
	// the file went to the trash, beside a meta.json naming where it came from, not away for good
	moved, _ := filepath.Glob(filepath.Join(trashDir(), "*-council-done", "done.json"))
	meta, _ := filepath.Glob(filepath.Join(trashDir(), "*-council-done", "meta.json"))
	if len(moved) != 1 || len(meta) != 1 {
		t.Fatalf("trash after Delete: council %v, meta %v; want one of each", moved, meta)
	}
	if b, err := os.ReadFile(moved[0]); err != nil || !strings.Contains(string(b), `"id": "done"`) {
		t.Errorf("the trashed file does not hold the council: %v", err)
	}
}

func TestSetPinnedOnAnEndedCouncil(t *testing.T) {
	h := newHarness(t)
	h.run(testCouncil("c1"))
	c, err := h.r.SetPinned("c1", true)
	if err != nil || c.Pinned == 0 {
		t.Fatalf("SetPinned(c1, true) = %+v, %v; want it pinned", c, err)
	}
	at := h.load("c1").Pinned
	if at == 0 {
		t.Fatalf("the pin was not saved")
	}
	if c, _ := h.r.SetPinned("c1", true); c.Pinned != at {
		t.Errorf("pinning it again moved Pinned from %d to %d", at, c.Pinned)
	}
	if last := h.seen[len(h.seen)-1]; last.Id != "c1" || last.Pinned == 0 {
		t.Errorf("the pin was not reported: last change %s pinned %d", last.Id, last.Pinned)
	}

	// a new run (a summary) leaves the pin as it was
	saved, err := h.r.Summarize("c1")
	if err != nil {
		t.Fatalf("Summarize: %v", err)
	}
	if saved.Pinned != at {
		t.Errorf("a pinned council that runs again has Pinned %d, want %d", saved.Pinned, at)
	}
	if done := h.wait("c1"); done.Pinned != at || done.State != StateDone {
		t.Errorf("after the run: %s, pinned %d; want done and pinned %d", done.State, done.Pinned, at)
	}

	if c, err := h.r.SetPinned("c1", false); err != nil || c.Pinned != 0 || h.load("c1").Pinned != 0 {
		t.Fatalf("unpinning = %+v, %v; want it unpinned", c, err)
	}
	// unpinned, a new run leaves it unpinned
	if _, err := h.r.Summarize("c1"); err != nil {
		t.Fatalf("Summarize: %v", err)
	}
	if done := h.wait("c1"); done.Pinned != 0 {
		t.Errorf("an unpinned council that ran again is pinned (%d)", done.Pinned)
	}
}

// The pin is the person's mark, not a change to the discussion: it must not move Updated, which is the ended time
// of a council with no summary (a failed, stopped or not-run one), or Pin and Unpin would keep it in the tree a day.
func TestSetPinnedKeepsUpdated(t *testing.T) {
	h := newHarness(t)
	tickClock(t) // every stamping save sees a later time, so a restamp shows
	h.save(fixtureCouncil("c1", StateStopped, 1))
	before := h.load("c1")
	if before.Summary != nil || before.Updated == 0 {
		t.Fatalf("fixture: summary %v, updated %d; want no summary and a known Updated", before.Summary, before.Updated)
	}
	for _, pinned := range []bool{true, false} {
		c, err := h.r.SetPinned("c1", pinned)
		if err != nil {
			t.Fatalf("SetPinned(c1, %v): %v", pinned, err)
		}
		saved := h.load("c1")
		if c.Updated != before.Updated || saved.Updated != before.Updated {
			t.Errorf("SetPinned(c1, %v) moved Updated from %d to %d (saved %d)", pinned, before.Updated, c.Updated, saved.Updated)
		}
		if (c.Pinned != 0) != pinned || (saved.Pinned != 0) != pinned {
			t.Errorf("SetPinned(c1, %v): returned Pinned %d, saved %d", pinned, c.Pinned, saved.Pinned)
		}
	}
}

func TestSetPinnedOnARunningCouncil(t *testing.T) {
	h := newHarness(t)
	h.f.gate("ux/r1")
	if _, err := h.r.Start(context.Background(), testCouncil("c1")); err != nil {
		t.Fatal(err)
	}
	h.f.entered(t, "ux/r1")
	c, err := h.r.SetPinned("c1", true)
	if err != nil || c.Pinned == 0 {
		t.Fatalf("SetPinned on a running council = %+v, %v; want it pinned", c, err)
	}
	at := c.Pinned
	h.f.release("ux/r1")
	if done := h.wait("c1"); done.Pinned != at {
		t.Errorf("after the run: pinned %d, want %d (the run dropped the pin)", done.Pinned, at)
	}
	if c, err := h.r.SetPinned("c1", false); err != nil || c.Pinned != 0 {
		t.Fatalf("unpinning the ended council = %+v, %v; want it unpinned", c, err)
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

// ---- the time rounds ran ----

// stillClock makes the runner's clock read a time the test sets, so a run's span is known.
func stillClock(h *harness, at int64) *atomic.Int64 {
	var clock atomic.Int64
	clock.Store(at)
	h.r.Now = clock.Load
	return &clock
}

func TestRanMsAddsTheSpansOfTwoRuns(t *testing.T) {
	h := newHarness(t)
	clock := stillClock(h, 10_000)
	h.f.gate("ux/r1")
	h.start(testCouncil("c1"))
	h.f.entered(t, "ux/r1")
	if c := h.load("c1"); c.RunStarted != 10_000 || c.RanMs != 0 {
		t.Fatalf("while round 1 runs: runstarted %d ranms %d, want 10000 and 0", c.RunStarted, c.RanMs)
	}
	clock.Store(15_000)
	h.f.release("ux/r1")
	if c := h.wait("c1"); c.State != StateDone || c.RanMs != 5_000 || c.RunStarted != 0 {
		t.Fatalf("after the rounds: %s ranms %d runstarted %d, want done, 5000 and 0", c.State, c.RanMs, c.RunStarted)
	}

	// the clock moves while the council rests: that time is not counted
	clock.Store(100_000)
	h.f.gate("lead/r3")
	if _, err := h.r.Summarize("c1"); err != nil {
		t.Fatalf("Summarize: %v", err)
	}
	h.f.entered(t, "lead/r3")
	if c := h.load("c1"); c.RunStarted != 100_000 || c.RanMs != 5_000 {
		t.Fatalf("while the summary runs: runstarted %d ranms %d, want 100000 and 5000", c.RunStarted, c.RanMs)
	}
	clock.Store(107_000)
	h.f.release("lead/r3")
	if c := h.wait("c1"); c.RanMs != 12_000 || c.RunStarted != 0 {
		t.Fatalf("after the summary: ranms %d runstarted %d, want 12000 and 0", c.RanMs, c.RunStarted)
	}
}

func TestRanMsCountsAStoppedRun(t *testing.T) {
	h := newHarness(t)
	clock := stillClock(h, 20_000)
	h.f.gate("ux/r1")
	h.start(testCouncil("c1"))
	h.f.entered(t, "ux/r1")
	clock.Store(23_000)
	c, err := h.r.Stop("c1")
	if err != nil {
		t.Fatalf("Stop: %v", err)
	}
	if c.State != StateStopped || c.RanMs != 3_000 || c.RunStarted != 0 {
		t.Fatalf("after Stop: %s ranms %d runstarted %d, want stopped, 3000 and 0", c.State, c.RanMs, c.RunStarted)
	}
}

func TestRanMsAddsNothingForAStaleCouncil(t *testing.T) {
	h := newHarness(t)
	stillClock(h, 900_000)
	c := fixtureCouncil("stale", StateRunning, 2)
	c.RanMs, c.RunStarted = 4_000, 50_000
	h.save(c)
	h.r.MarkStale()
	if got := h.load("stale"); got.State != StateStopped || got.RanMs != 4_000 || got.RunStarted != 0 {
		t.Fatalf("after MarkStale: %s ranms %d runstarted %d, want stopped, 4000 and 0", got.State, got.RanMs, got.RunStarted)
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
		"Reply":      second(h.r.Reply("b", "", "", "Anyone?", false, nil)),
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
		"Reply":     {"done", func() (*Council, error) { return h.r.Reply("done", "P1", "", "And on a Mac?", false, nil) }},
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
	if saved, err := h.r.Reply("done", "P1", "", "Still true?", false, nil); err != nil || saved.State != StateRunning {
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
	if _, err := h.r.Reply("a", "P1", "", "What about the Mac?", false, nil); err != nil {
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

// A council stores the draft mode its seats give at its start: a chat seated makes it held, unless an agent started it.
func TestStartStoresDraftMode(t *testing.T) {
	for name, tc := range map[string]struct {
		build func() *Council
		want  string
	}{
		"a chat seated":              {func() *Council { return agentCouncil("a") }, DraftModeHeld},
		"a chat seated, by an agent": {func() *Council { c := agentCouncil("a"); c.ByAgent = true; return c }, DraftModeFree},
		"no chat":                    {func() *Council { return testCouncil("a") }, DraftModeFree},
	} {
		t.Run(name, func(t *testing.T) {
			h := newHarness(t)
			saved := h.start(tc.build())
			if saved.DraftMode != tc.want {
				t.Errorf("Start returned draft mode %q, want %q", saved.DraftMode, tc.want)
			}
			h.wait("a")
			if got := h.load("a"); got.DraftMode != tc.want {
				t.Errorf("the saved council has draft mode %q, want %q", got.DraftMode, tc.want)
			}
		})
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
		"ui-feature: Review a UI feature (Ease of use, Memory watcher, New user, Bug hunter)", "paper: Paper review", suggestShape)

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

func TestSuggestLeavesOutAgentGroups(t *testing.T) {
	h := newHarness(t)
	project := t.TempDir()
	for _, named := range []string{"agents", "agents-ideas"} {
		h.f.setText("suggest/suggest", fence(mustJSON(map[string]any{"files": []string{}, "roles": []any{}, "group": named})))
		got, err := h.r.Suggest(context.Background(), project, "Idle sleep", "Which first?", nil)
		if err != nil || got.Group != "" {
			t.Errorf("a reply naming %q = group %q, %v, want it empty: with no chat seated the group is a panel of one", named, got.Group, err)
		}
	}
	prompt := h.f.calls("suggest")[0].Prompt
	mustContain(t, "suggest prompt", prompt, "ui-feature: Review a UI feature", "product-ideas: Product ideas")
	mustNotContain(t, "suggest prompt", prompt, "agents:", "agents-ideas:", "Chats with")
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

func TestAReviewDropsTheBrainstormFlags(t *testing.T) {
	h := newHarness(t)
	// a Review model that wanders into Brainstorm words: the wild and builds flags are dropped, the weak chip stays
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
	if c.Summary == nil || c.Summary.Directions[0].FirstStep != "Start" || len(c.Summary.Kept) != 1 || c.Summary.Kept[0].Title != "A mascot" {
		t.Errorf("summary = %+v, want the first step and the direction also raised kept in a Review", c.Summary)
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
	applyRound2(brainstorm, brainstorm.Experts[0], res, 2, 5)
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

	applyRound2(review, review.Experts[0], res, 2, 5)
	for _, r := range review.Replies {
		if r.Builds {
			t.Errorf("reply %+v builds in a Review", r)
		}
	}
}

func TestCleanSummaryKeepsThreeAsksForThePanel(t *testing.T) {
	c := fixtureCouncil("c1", StateDone, 3)
	in := CouncilSummary{Asks: []CouncilAsk{
		{Text: "Does it hold on a Mac?", To: "ux"},
		{Text: "Does it hold on a Mac?", To: "ram"}, // the same question twice
		{Text: "Who checks the RAM?", To: "ghost"},  // not on the panel: the whole panel answers
		{Text: "What first?"},
		{Text: "One too many", To: "ux"},
	}}
	want := []CouncilAsk{{Text: "Does it hold on a Mac?", To: "ux"}, {Text: "Who checks the RAM?"}, {Text: "What first?"}}
	if got := cleanSummary(c, in).Asks; !reflect.DeepEqual(got, want) {
		t.Errorf("asks = %+v, want %+v", got, want)
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
	if len(got.Directions) != maxDirections || got.Directions[2].Title != "c" {
		t.Errorf("directions = %+v, want the first %d", got.Directions, maxDirections)
	}
	if len(got.Kept) != 2 || !slices.Equal(got.Kept[0].From, []string{"P2"}) || len(got.Kept[1].From) != 0 {
		t.Errorf("kept = %+v, want the known ids once; a kept idea that cites nothing real stays (it is the model's idea)", got.Kept)
	}
	if want := map[string]CouncilStance{"ux": StanceAccept}; !reflect.DeepEqual(got.Kept[0].Stances, want) {
		t.Errorf("kept stances = %v, want %v", got.Kept[0].Stances, want)
	}

}

func TestCleanSummaryForAReview(t *testing.T) {
	c := fixtureCouncil("c1", StateDone, 3) // P1 by ux, P2 by ram
	dir := func(title, from string) CouncilDirection {
		return CouncilDirection{
			Title: title, Reasoning: "why " + title, From: []string{from}, FirstStep: "Start " + title,
			Stances: map[string]CouncilStance{"ram": StanceChallenge},
		}
	}
	in := CouncilSummary{
		Directions: []CouncilDirection{dir("a", "P1"), dir("b", "P1"), dir("c", "P1"), dir("d", "P2")},
		Kept:       []CouncilDirection{{Title: "wording", Reasoning: "rename the chip", From: []string{"P1"}}},
		Outcomes:   map[string]string{"P1": "Direction 1", "P2": "Merged into direction 4"},
	}
	got := cleanSummary(c, in)
	if len(got.Directions) != maxDirections || got.Directions[2].Title != "c" || got.Directions[0].FirstStep != "Start a" {
		t.Errorf("directions = %+v, want the first %d with their first steps", got.Directions, maxDirections)
	}
	if len(got.Kept) != 2 || got.Kept[0].Title != "d" || got.Kept[0].Rank != 1 || got.Kept[0].Reasoning != "why d" ||
		got.Kept[0].FirstStep != "" || len(got.Kept[0].Stances) != 0 || got.Kept[1].Title != "wording" || got.Kept[1].Rank != 2 {
		t.Errorf("kept = %+v, want the direction past the cap as one line, ahead of the model's own", got.Kept)
	}
	if got.Outcomes["P1"] != "Direction 1" || got.Outcomes["P2"] != "Also raised" {
		t.Errorf("outcomes = %v, want a direction past the cap to read Also raised", got.Outcomes)
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

// fileMentionTable is the one example table of the file-mention rule, the same rows the frontend's tests hold: an @ that
// does not follow a letter, digit or _, then the longest run of letters, digits, _ - . / ~ with its trailing dots
// dropped, is a file mention when what is left holds a / or a . A seat or a chat is never named by one.
var fileMentionTable = []struct {
	text string
	path string // the file mention's path; "" when the text holds none
	seat string // "ux" for the UX seat, "chat" for the chat keyed 3e19c0d2-a, "" for nothing
}{
	{"@ux/plan.md", "ux/plan.md", ""},
	{"@ram.go", "ram.go", ""},
	{"@./x", "./x", ""},
	{"@~/x", "~/x", ""},
	{"@3e19c0d2-a/x.ts", "3e19c0d2-a/x.ts", ""},
	{"@UX", "", "ux"},
	{"@UX.", "", "ux"},
	{"@UX..", "", "ux"},
	{"@UX,", "", "ux"},
	{"@3e19c0d2-a", "", "chat"},
}

func TestFileMentioned(t *testing.T) {
	for _, row := range fileMentionTable {
		for _, text := range []string{row.text, "see " + row.text + " first", row.text + " and more", "(" + row.text + ")"} {
			var want []string
			if row.path != "" {
				want = []string{row.path}
			}
			if got := fileMentions(text); !slices.Equal(got, want) {
				t.Errorf("fileMentions(%q) = %q, want %q", text, got, want)
			}
			if got := fileMentioned(text); got != (row.path != "") {
				t.Errorf("fileMentioned(%q) = %v, want %v", text, got, row.path != "")
			}
		}
	}
	for text, want := range map[string]bool{
		"mail x@ram.com":                false, // an @ after a letter is an address
		"a_@b.c":                        false, // and after _, and after a digit
		"1@b.c":                         false,
		"@.":                            false, // nothing but dots is nothing
		"@":                             false,
		"no mention, just a file.go":    false,
		"@@a/b":                         true, // the second @ follows an @, which is no word character
		"first @UX, then @docs/spec.md": true,
		"@src/área.go":                  true, // letters are any script's
		"look at @a/b.md":               true,
	} {
		if got := fileMentioned(text); got != want {
			t.Errorf("fileMentioned(%q) = %v, want %v", text, got, want)
		}
	}
	if got := fileMentions("@a/b.md, then @c.go. and @d/e/f.ts.."); !slices.Equal(got, []string{"a/b.md", "c.go", "d/e/f.ts"}) {
		t.Errorf("fileMentions of three = %q, want the paths in order, sentence dots dropped", got)
	}
}

func TestMentionsSkipFileMentions(t *testing.T) {
	const chatTab = "3e19c0d2-a1b2-4c3d-8e9f-000000000001"
	c := withChatSeats(testCouncil("c1"), chatSeat(chatTab, "Scout"))
	chat := "agent-" + chatTab
	for _, row := range fileMentionTable {
		var want []string
		switch row.seat {
		case "ux":
			want = []string{"ux"}
		case "chat":
			want = []string{chat}
		}
		for _, text := range []string{row.text, "see " + row.text + " first", row.text + " and more"} {
			if got := mentioned(c, text); !slices.Equal(got, want) {
				t.Errorf("mentioned(%q) reaches %v, want %v", text, got, want)
			}
		}
	}

	// the whole-word check is the same: a file's path never counts as the seat's name
	for text, want := range map[string]bool{
		"@ux/plan.md":      false,
		"@ux.md":           false,
		"@ux":              true,
		"@ux.":             true,
		"@ux/plan.md @ux":  true, // a real mention beside the file
		"@ux,@ux/plan.md":  true,
		"x@ux/plan.md":     false,
		"@ux/plan.md in @": false,
	} {
		if got := mentions(strings.ToLower(text), "@ux"); got != want {
			t.Errorf("mentions(%q, @ux) = %v, want %v", text, got, want)
		}
	}

	// the same through a reply: a path never narrows who answers by naming a seat, so the whole council goes to the
	// router, which is offered every seat
	h := newHarness(t)
	h.save(fixtureCouncil("c2", StateAwaiting, 2))
	got, err := h.r.Reply("c2", "", "", "What about @ux/plan.md and @ram.go?", false, nil)
	if err != nil {
		t.Fatalf("Reply: %v", err)
	}
	if r := got.Replies[len(got.Replies)-1]; r.Routed == nil || !r.Tools {
		t.Errorf("a reply naming two files = %+v, want it taken up by the router, with Let them read files on", r)
	}
	h.waitRouted("c2", "r3")
	route := h.f.calls("route")
	if len(route) != 1 {
		t.Fatalf("%d router calls, want 1", len(route))
	}
	for _, id := range panelIds() {
		mustContain(t, "the router's prompt", route[0].Prompt, "- "+id+" — ")
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

// ---- attachments ----

// attached is a path of an image the composer kept: <root>/<folder>/<name>. Nothing checks it exists here: the server does.
func attached(folder, name string) string {
	return filepath.Join(os.TempDir(), "arc-attachments", folder, name)
}

func TestReplyStoresAttachments(t *testing.T) {
	h := newHarness(t)
	h.save(fixtureCouncil("c1", StateAwaiting, 2))
	one, two := attached("2026-11-02-a1", "one.png"), attached("2026-11-02-b2", "two.png")

	got, err := h.r.Reply("c1", "P1", "", "What is wrong in these?", false, nil, one, two)
	if err != nil {
		t.Fatalf("Reply: %v", err)
	}
	stored := replyOf(t, h.load("c1"), "r3")
	if !slices.Equal(stored.Attachments, []string{one, two}) || stored.Author != YouId || stored.Text != "What is wrong in these?" {
		t.Errorf("stored reply = %+v, want the two paths in the order sent", stored)
	}
	if !reflect.DeepEqual(replyOf(t, got, "r3").Attachments, stored.Attachments) {
		t.Errorf("Reply returned %v, want what was stored %v", replyOf(t, got, "r3").Attachments, stored.Attachments)
	}

	// a reply with none stores none, and the caller's slice is not kept by reference
	if _, err := h.r.Reply("c1", "P1", "", "And without?", false, nil); err != nil {
		t.Fatalf("Reply: %v", err)
	}
	if plain := replyOf(t, h.load("c1"), "r4"); plain.Attachments != nil || plain.Tools {
		t.Errorf("a reply with no attachment stored %+v, want none and Tools as sent", plain)
	}
	sent := []string{one}
	if _, err := h.r.Reply("c1", "P1", "", "Mutate after?", false, nil, sent...); err != nil {
		t.Fatalf("Reply: %v", err)
	}
	sent[0] = "changed"
	if kept := replyOf(t, h.load("c1"), "r5").Attachments; !slices.Equal(kept, []string{one}) {
		t.Errorf("stored attachments = %v, want them unchanged by the caller", kept)
	}
}

// A reply with an attachment is stored with Tools on whatever the client sent, in a round and in a follow-up alike, so
// every seat that answers it can read the file.
func TestReplyForcesToolsForAttachments(t *testing.T) {
	h := newHarness(t)
	h.save(fixtureCouncil("c1", StateAwaiting, 2))
	img := attached("2026-11-02-a1", "one.png")

	got, err := h.r.Reply("c1", "P1", "", "Look at this?", false, nil, img)
	if err != nil {
		t.Fatalf("Reply: %v", err)
	}
	if posted := replyOf(t, got, "r3"); !posted.Tools {
		t.Errorf("a reply with an attachment sent with Tools false was stored %+v, want Tools on", posted)
	}

	// a follow-up of a council that is done: the call that answers it has the tools
	done := h.run(testCouncil("c2"))
	rep, err := h.r.Reply("c2", "", "", "What do you see here?", false, nil, img)
	if err != nil {
		t.Fatalf("follow-up Reply: %v", err)
	}
	posted := repliesBy(rep, YouId)[0]
	if !posted.Tools || posted.Round != followRound(done) {
		t.Fatalf("follow-up reply = %+v, want Tools on in round %d", posted, followRound(done))
	}
	h.wait("c2")
	ans := h.f.calls("ans")
	if len(ans) == 0 {
		t.Fatal("the follow-up made no answer call")
	}
	for _, req := range ans {
		if !req.Tools {
			t.Errorf("answer call for %s had Tools false, want the files readable", req.Expert.Id)
		}
	}
}

// An @ file in the text forces Tools too, by the same rule the seat matcher uses to leave it out.
// A web address in a message is found whole, http or https, and a bare host or a word with :// inside is not one. The
// frontend's linkIn test holds the same table.
func TestLinkMentioned(t *testing.T) {
	for _, tc := range []struct {
		text string
		want bool
	}{
		{"hiện tại các cập nhật đã lên https://blackdiamond.biglabs.net/", true},
		{"see http://localhost:5174/x?y=1.", true},
		{"(HTTPS://Example.com)", true},
		{"blackdiamond.biglabs.net with no scheme", false},
		{"ftp://files.example.com", false},
		{"xhttps://not.one", false},
		{"https://", false},
		{"", false},
	} {
		if got := linkMentioned(tc.text); got != tc.want {
			t.Errorf("linkMentioned(%q) = %v, want %v", tc.text, got, tc.want)
		}
	}
}

// A message with a link is stored with tools on whatever the composer sent, its router leaves them alone, and the calls
// that answer it have WebFetch and are told so; the next message with no link has neither.
func TestReplyWithLinkGetsWebFetch(t *testing.T) {
	h := newHarness(t)
	h.run(testCouncil("c1"))
	if _, err := h.r.Reply("c1", "", "", "@all The update is live at https://blackdiamond.biglabs.net/", false, nil); err != nil {
		t.Fatalf("Reply: %v", err)
	}
	c := h.wait("c1")
	if posted := repliesBy(c, YouId)[0]; !posted.Tools {
		t.Errorf("a reply with a link stored Tools false, want it on")
	}
	ans := h.f.calls("ans")
	if len(ans) == 0 {
		t.Fatal("no answer calls")
	}
	for _, req := range ans {
		if !req.Tools || !req.Web {
			t.Errorf("answer call for %s: tools %v, web %v, want both", req.Expert.Id, req.Tools, req.Web)
		}
		mustContain(t, "answer prompt for "+req.Expert.Id, req.Prompt, readWhenNeeded+"\n"+webNote+"\n\n")
	}

	if _, err := h.r.Reply("c1", "", "", "@all And without the page?", false, nil); err != nil {
		t.Fatalf("Reply: %v", err)
	}
	h.wait("c1")
	for _, req := range h.f.calls("ans")[len(ans):] {
		if req.Web {
			t.Errorf("a follow-up with no link ran %s with WebFetch", req.Expert.Id)
		}
		mustNotContain(t, "answer prompt for "+req.Expert.Id, req.Prompt, webNote)
	}
}

// A link locks the tools on, so a routed message with one in Auto keeps AutoTools off: the router cannot turn them off.
func TestRoutedLinkLocksTools(t *testing.T) {
	c := fixtureCouncil("c1", StateDone, 2)
	if err := appendPersonReply(c, "", "", "What do you make of https://example.com/v5?", false, true, nil, nil, 1); err != nil {
		t.Fatalf("appendPersonReply: %v", err)
	}
	pr := c.Replies[len(c.Replies)-1]
	if !pr.Tools {
		t.Errorf("stored Tools false, want the link to lock it on")
	}
	if pr.Routed != nil && pr.Routed.AutoTools {
		t.Errorf("Routed.AutoTools true, want false: a link locks the tools")
	}
}

// Round 1 calls have WebFetch when the council's question holds a link, and not otherwise.
func TestRound1WebFetchFromQuestion(t *testing.T) {
	for _, tc := range []struct {
		question string
		want     bool
	}{
		{"Review the live build at https://blackdiamond.biglabs.net/", true},
		{"Which direction first?", false},
	} {
		h := newHarness(t)
		c := testCouncil("c1")
		c.Question = tc.question
		h.run(c)
		r1 := h.f.calls("r1")
		if len(r1) == 0 {
			t.Fatalf("%q: no round 1 calls", tc.question)
		}
		for _, req := range r1 {
			if req.Web != tc.want || strings.Contains(req.Prompt, webNote) != tc.want {
				t.Errorf("%q: round 1 call for %s has web %v, want %v (and the WebFetch line with it)", tc.question, req.Expert.Id, req.Web, tc.want)
			}
		}
	}
}

func TestReplyForcesToolsForFileMention(t *testing.T) {
	for _, tc := range []struct {
		name, text string
		want       bool
	}{
		{"a path", "Is @a/b.md still right?", true},
		{"a file with no folder", "What does @main.go do?", true},
		{"a seat's name", "@UX is it findable?", false},
		{"an address", "mail x@ram.com", false},
		{"a path after a real mention", "@UX and @docs/spec.md?", true},
		{"no @ at all", "Is a/b.md still right?", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			h := newHarness(t)
			h.save(fixtureCouncil("c1", StateAwaiting, 2))
			got, err := h.r.Reply("c1", "P1", "", tc.text, false, nil)
			if err != nil {
				t.Fatalf("Reply: %v", err)
			}
			if posted := replyOf(t, got, "r3"); posted.Tools != tc.want {
				t.Errorf("%q stored Tools %v, want %v", tc.text, posted.Tools, tc.want)
			}
		})
	}

	// and a follow-up with a file in its text is answered with the tools
	h := newHarness(t)
	h.run(testCouncil("c1"))
	if _, err := h.r.Reply("c1", "", "", "Check @pkg/services/idle.go for me.", false, nil); err != nil {
		t.Fatalf("Reply: %v", err)
	}
	h.wait("c1")
	for _, req := range h.f.calls("ans") {
		if !req.Tools {
			t.Errorf("answer call for %s had Tools false, want it on for a file in the text", req.Expert.Id)
		}
	}
}

// The call that answers a reply may read the folder of each image attached to it, once each, and nothing else.
func TestCallAddDirsFromAttachments(t *testing.T) {
	h := newHarness(t)
	h.run(testCouncil("c1"))
	one, two, three := attached("2026-11-02-a1", "one.png"), attached("2026-11-02-b2", "two.png"), attached("2026-11-02-a1", "three.png")

	if _, err := h.r.Reply("c1", "", "", "@all Compare these.", false, nil, one, two, three); err != nil {
		t.Fatalf("Reply: %v", err)
	}
	asked := repliesBy(h.wait("c1"), YouId)[0].Id
	want := []string{filepath.Dir(one), filepath.Dir(two)}
	ans := h.f.calls("ans")
	if len(ans) != 4 {
		t.Fatalf("%d answer calls, want one per expert", len(ans))
	}
	for _, req := range ans {
		if !req.Tools || !slices.Equal(req.AddDirs, want) {
			t.Errorf("answer call for %s: tools %v, folders %v, want tools and exactly %v", req.Expert.Id, req.Tools, req.AddDirs, want)
		}
		mustContain(t, "answer prompt for "+req.Expert.Id, req.Prompt,
			"The person's reply ["+asked+"]: @all Compare these.\nAttachments (read these files):\n- "+one+"\n- "+two+"\n- "+three+"\n")
	}

	// the next follow-up has no attachment: no folder, and the tools are off as the client sent
	if _, err := h.r.Reply("c1", "", "", "@all Thanks, and without them?", false, nil); err != nil {
		t.Fatalf("Reply: %v", err)
	}
	h.wait("c1")
	for _, req := range h.f.calls("ans")[4:] {
		if req.Tools || len(req.AddDirs) != 0 {
			t.Errorf("a follow-up with no attachment ran with tools %v and folders %v, want neither", req.Tools, req.AddDirs)
		}
		mustNotContain(t, "answer prompt for "+req.Expert.Id, req.Prompt, "read these files", "arc-attachments")
	}
}

// An answer that prints an ancestor reply of the person's with an image may read that image's folder too, and shows its
// block, even when the new reply itself carries nothing.
func TestCallAddDirsFromAncestorReply(t *testing.T) {
	h := newHarness(t)
	h.run(testCouncil("c1"))
	img := attached("2026-11-02-a1", "one.png")
	if _, err := h.r.Reply("c1", "P1", "", "What is wrong in this?", false, nil, img); err != nil {
		t.Fatalf("Reply: %v", err)
	}
	c := h.wait("c1")
	you := repliesBy(c, YouId)
	var answer CouncilReply
	for _, x := range c.Replies {
		if x.ParentId == you[0].Id {
			answer = x
		}
	}
	if answer.Id == "" {
		t.Fatal("the first reply got no answer to reply under")
	}
	before := len(h.f.calls("ans"))

	if _, err := h.r.Reply("c1", "P1", answer.Id, "And the second part?", false, nil); err != nil {
		t.Fatalf("second Reply: %v", err)
	}
	second := repliesBy(h.wait("c1"), YouId)[1].Id
	calls := h.f.calls("ans")[before:]
	if len(calls) == 0 {
		t.Fatal("the second reply made no answer call")
	}
	for _, req := range calls {
		if !req.Tools || !slices.Equal(req.AddDirs, []string{filepath.Dir(img)}) {
			t.Errorf("answer call for %s: tools %v, folders %v, want tools and the first reply's folder", req.Expert.Id, req.Tools, req.AddDirs)
		}
		above := section(t, req.Prompt, "## Reply "+second)
		mustContain(t, "the replies above it", above, "The replies above it", "Attachments (read these files):\n- "+img+"\n")
		if n := strings.Count(req.Prompt, "read these files"); n != 1 {
			t.Errorf("the prompt names the block %d times, want once, under the ancestor", n)
		}
	}
}

// A reply sent at the pause is answered in round 2: the seats it is addressed to get the tools and its folders, the
// others none, and a round 2 with no such ask stays without tools.
func TestRound2ReadsAttachedAsk(t *testing.T) {
	h := newHarness(t)
	c := testCouncil("c1")
	c.PauseAfterRound1 = true
	if got := h.run(c); got.State != StateAwaiting {
		t.Fatalf("council = %s, want it paused after round 1", got.State)
	}
	img := attached("2026-11-02-a1", "one.png")
	if _, err := h.r.Reply("c1", "", "", "@UX what does this show?", false, nil, img); err != nil {
		t.Fatalf("Reply: %v", err)
	}
	if _, err := h.r.Continue("c1", nil, ""); err != nil {
		t.Fatalf("Continue: %v", err)
	}
	h.wait("c1")

	r2 := h.f.calls("r2")
	if len(r2) != 4 {
		t.Fatalf("%d round 2 calls, want one per expert", len(r2))
	}
	for _, req := range r2 {
		if req.Expert.Id == "ux" {
			if !req.Tools || !slices.Equal(req.AddDirs, []string{filepath.Dir(img)}) {
				t.Errorf("UX's round 2 call: tools %v, folders %v, want tools and %v", req.Tools, req.AddDirs, filepath.Dir(img))
			}
			mustContain(t, "UX's round 2 prompt", req.Prompt, "Attachments (read these files):\n- "+img+"\n")
			mustNotContain(t, "UX's round 2 prompt", req.Prompt, "You have no tools in this round", "You cannot read the code in this round, so")
			continue
		}
		if req.Tools || len(req.AddDirs) != 0 {
			t.Errorf("%s's round 2 call: tools %v, folders %v, want none: nothing was asked of it", req.Expert.Id, req.Tools, req.AddDirs)
		}
		mustContain(t, req.Expert.Id+"'s round 2 prompt", req.Prompt, "You have no tools in this round")
		mustNotContain(t, req.Expert.Id+"'s round 2 prompt", req.Prompt, "read these files")
	}
	if r := replyOf(t, h.load("c1"), "r1"); !r.Answered || !r.Tools {
		t.Errorf("the ask = %+v, want it answered, stored with Tools on", r)
	}

	// a round 2 with no ask keeps no tools and no folder
	plain := testCouncil("c2")
	plain.PauseAfterRound1 = true
	h.run(plain)
	if _, err := h.r.Continue("c2", nil, ""); err != nil {
		t.Fatalf("Continue: %v", err)
	}
	h.wait("c2")
	for _, req := range h.f.calls("r2")[4:] {
		if req.Tools || len(req.AddDirs) != 0 {
			t.Errorf("a round 2 with no ask ran %s with tools %v and folders %v", req.Expert.Id, req.Tools, req.AddDirs)
		}
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

// The folders a request may read outside the project reach claude as the call's --add-dir list, exactly: the attached
// images' own folders, nothing wider, and none for a request that names none.
func TestConsultCallerPassesAddDirs(t *testing.T) {
	var opts consult.CallOpts
	swapCaller(t,
		func(ctx context.Context, c, prompt string, o consult.CallOpts, onTool func(string)) (string, consult.Usage, error) {
			opts = o
			return "the reply", consult.Usage{}, nil
		},
		func(ctx context.Context, req jobqueue.Request) (func(), error) { return func() {}, nil })
	e := CouncilExpert{Id: "ux", Name: "UX", Model: "opus"}
	dirs := []string{filepath.Join("home", ".arc", "attachments", "2026-11-02-a1"), filepath.Join("home", ".arc", "attachments", "2026-11-02-b2")}

	if _, err := (ConsultCaller{}).Call(context.Background(), CallReq{Expert: e, Cwd: `D:\proj`, Prompt: "p", Tools: true, AddDirs: dirs}); err != nil {
		t.Fatalf("Call: %v", err)
	}
	if !reflect.DeepEqual(opts.AddDirs, dirs) || !reflect.DeepEqual(opts.Tools, []string{"Read", "Grep", "Glob"}) {
		t.Errorf("claude was run with %+v, want Read, Grep and Glob and exactly the folders %v", opts, dirs)
	}

	if _, err := (ConsultCaller{}).Call(context.Background(), CallReq{Expert: e, Cwd: `D:\proj`, Prompt: "p", Tools: true}); err != nil {
		t.Fatalf("Call with none: %v", err)
	}
	if len(opts.AddDirs) != 0 {
		t.Errorf("a request with no folders ran claude with --add-dir %v", opts.AddDirs)
	}

	// Web adds WebFetch to the read-only tools, without changing the shared list; without Tools it adds nothing
	if _, err := (ConsultCaller{}).Call(context.Background(), CallReq{Expert: e, Cwd: `D:\proj`, Prompt: "p", Tools: true, Web: true}); err != nil {
		t.Fatalf("Call with web: %v", err)
	}
	if !reflect.DeepEqual(opts.Tools, []string{"Read", "Grep", "Glob", "WebFetch"}) {
		t.Errorf("a request with Web ran claude with tools %v, want Read, Grep, Glob and WebFetch", opts.Tools)
	}
	if !reflect.DeepEqual(readOnlyTools, []string{"Read", "Grep", "Glob"}) {
		t.Errorf("readOnlyTools became %v", readOnlyTools)
	}
	if _, err := (ConsultCaller{}).Call(context.Background(), CallReq{Expert: e, Cwd: `D:\proj`, Prompt: "p", Web: true}); err != nil {
		t.Fatalf("Call with web and no tools: %v", err)
	}
	if len(opts.Tools) != 0 {
		t.Errorf("a request with Web and no Tools ran claude with tools %v, want none", opts.Tools)
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

// ---- live agent seats ----

// agentCouncil is a council with a live agent, Witness, seated beside the expert UX: every answer is held for the person.
func agentCouncil(id string) *Council {
	return &Council{
		Id: id, Project: `D:\proj`, Feature: "Idle sleep for services", Question: "Which direction first?",
		Experts: []CouncilExpert{
			{Id: "witness", Name: "Witness", Agent: "tab-1", Harness: HarnessClaude},
			{Id: "ux", Name: "UX", Brief: "Can someone use it without being told how?", Model: "sonnet"},
			{Id: "lead", Name: "Lead", Brief: "Merge and rank.", Model: "opus", Coordinator: true},
		},
	}
}

// heldIds are the ideas and replies waiting for the person, the ideas first.
func heldIds(c *Council) []string {
	var out []string
	for _, p := range c.Proposals {
		if p.Draft == DraftHeld {
			out = append(out, p.Id)
		}
	}
	for _, x := range c.Replies {
		if x.Draft == DraftHeld {
			out = append(out, x.Id)
		}
	}
	return out
}

// ideaBy is the id of the idea the seat posted.
func ideaBy(t *testing.T, c *Council, author string) string {
	t.Helper()
	for _, p := range c.Proposals {
		if p.Author == author {
			return p.Id
		}
	}
	t.Fatalf("%s posted no idea: %+v", author, c.Proposals)
	return ""
}

// settle sends every draft held now. The last one starts the next round, which the caller waits for.
func (h *harness) settle(id string) {
	h.t.Helper()
	held := heldIds(h.load(id))
	if len(held) == 0 {
		h.t.Fatalf("council %s holds no draft to send", id)
	}
	for _, item := range held {
		if _, err := h.r.Draft(id, item, "send", ""); err != nil {
			h.t.Fatalf("Draft(%s, send): %v", item, err)
		}
	}
}

// prompts are the prompts of every call so far, the live agents' and the experts'.
func (h *harness) prompts() []string {
	var out []string
	for _, req := range append(h.f.all(), h.agents.all()...) {
		out = append(out, req.Prompt)
	}
	return out
}

// agreeOnly answers a reply pass with an agreement, and nothing to add, on every proposal it was shown.
func agreeOnly(req CallReq) string {
	stances := []map[string]any{}
	for _, pid := range idsIn(proposalHeadRe, sectionText(req.Prompt, "## Proposals to review")) {
		stances = append(stances, map[string]any{"proposalid": pid, "stance": "accept", "reason": ""})
	}
	return fence(mustJSON(map[string]any{"stances": stances, "revisions": []any{}, "answers": []any{}, "picks": []string{}}))
}

func TestAgentSeatsHoldDrafts(t *testing.T) {
	h := newHarness(t)
	c := h.run(agentCouncil("a"))
	if c.State != StateAwaiting || c.Round != 1 {
		t.Fatalf("after round 1: %s at round %d, want awaiting-you at round 1", c.State, c.Round)
	}
	if len(c.Proposals) != 2 {
		t.Fatalf("proposals = %+v, want an idea from each seat", c.Proposals)
	}
	for _, p := range c.Proposals {
		if p.Draft != DraftHeld {
			t.Errorf("idea %s is %q, want it held for the person", p.Id, p.Draft)
		}
	}
	rounds2 := func() int { return len(h.f.calls("r2")) + len(h.agents.calls("r2")) }
	if rounds2() != 0 || c.Activity != nil {
		t.Fatalf("round 2 began, or the council shows work, with every draft still held")
	}

	// one draft settled and one held: the round keeps waiting
	witness, ux := ideaBy(t, c, "witness"), ideaBy(t, c, "ux")
	got, err := h.r.Draft("a", witness, "send", "")
	if err != nil || got.State != StateAwaiting || got.Round != 1 || proposalOf(t, got, witness).Draft != "" {
		t.Fatalf("after sending one: %+v, %v, want it sent and the council still awaiting-you at round 1", got.State, err)
	}
	if rounds2() != 0 {
		t.Fatal("round 2 began with a draft held")
	}

	// the last one settled (dropped) starts round 2 at once, on what was sent
	got, err = h.r.Draft("a", ux, "drop", "")
	if err != nil || got.State != StateRunning || got.Round != 2 {
		t.Fatalf("after the last draft: %s at round %d, %v, want round 2 running", got.State, got.Round, err)
	}
	c = h.wait("a")
	if c.State != StateAwaiting || c.Round != 2 {
		t.Fatalf("after round 2: %s at round %d, want awaiting-you at round 2", c.State, c.Round)
	}
	if len(c.Replies) != 1 || c.Replies[0].Author != "ux" || c.Replies[0].ProposalId != witness || c.Replies[0].Draft != DraftHeld {
		t.Fatalf("replies = %+v, want UX's held reply to Witness's idea (Witness had nobody's idea to review)", c.Replies)
	}
	if len(h.agents.calls("r2")) != 0 {
		t.Error("the agent was sent a turn with nothing to answer")
	}

	// the last draft of the last reply pass starts the synthesis
	h.settle("a")
	c = h.wait("a")
	if c.State != StateDone || c.Round != 3 || c.Summary == nil {
		t.Fatalf("after the last draft: %s at round %d (summary %v), want done at round 3", c.State, c.Round, c.Summary != nil)
	}
	if len(c.Picks["ux"]) != 1 || c.Picks["ux"][0] != witness {
		t.Errorf("picks = %v, want UX's pick of Witness's idea", c.Picks)
	}
}

func TestDraftEditIsSent(t *testing.T) {
	h := newHarness(t)
	c := h.run(agentCouncil("a"))
	witness, ux := ideaBy(t, c, "witness"), ideaBy(t, c, "ux")
	if _, err := h.r.Draft("a", witness, "edit", "  "); err == nil {
		t.Error("an edit with no text was taken")
	}
	if _, err := h.r.Draft("a", ux, "send", ""); err != nil {
		t.Fatal(err)
	}
	const edited = "Edited by the person: cache the sleep state."
	if got, err := h.r.Draft("a", witness, "edit", edited); err != nil || got.Round != 2 {
		t.Fatalf("editing the last draft: round %d, %v, want round 2 started", got.Round, err)
	}
	c = h.wait("a")
	if p := proposalOf(t, c, witness); p.Argument != edited || !p.Edited || p.Draft != "" {
		t.Errorf("the idea = %+v, want the edited argument, marked edited and sent", p)
	}
	// UX is a fresh call that reads every proposal in its prompt: it got the edited words, never the original
	r2 := h.f.calls("r2")
	if len(r2) != 1 {
		t.Fatalf("UX's round 2 calls = %d, want 1", len(r2))
	}
	mustContain(t, "UX's round 2 prompt", r2[0].Prompt, edited)
	mustNotContain(t, "UX's round 2 prompt", r2[0].Prompt, "Argument from witness")
}

func TestDroppedDraftReachesNoOne(t *testing.T) {
	h := newHarness(t)
	// a dropped idea
	c := h.run(agentCouncil("a"))
	witness, ux := ideaBy(t, c, "witness"), ideaBy(t, c, "ux")
	if _, err := h.r.Draft("a", witness, "send", ""); err != nil {
		t.Fatal(err)
	}
	if _, err := h.r.Draft("a", ux, "drop", ""); err != nil {
		t.Fatal(err)
	}
	h.wait("a")
	h.settle("a")
	c = h.wait("a")
	if c.State != StateDone {
		t.Fatalf("council ended %s, want done", c.State)
	}
	for _, p := range h.prompts() {
		if strings.Contains(p, "Title from ux") || strings.Contains(p, "Argument from ux") {
			t.Errorf("a prompt carries the dropped idea:\n%s", p)
		}
	}
	for _, picks := range c.Picks {
		if slices.Contains(picks, ux) {
			t.Errorf("picks = %v, name the dropped idea", c.Picks)
		}
	}
	if _, ok := c.Summary.Outcomes[ux]; ok {
		t.Errorf("outcomes = %v, give the dropped idea a fate", c.Summary.Outcomes)
	}
	for what, doc := range map[string]string{"document": Document(c), "report": Markdown(c)} {
		mustNotContain(t, "the "+what, doc, "Title from ux", "Argument from ux")
	}

	// a dropped reply
	c = h.run(agentCouncil("b"))
	h.settle("b")
	c = h.wait("b")
	var fromUx, fromWitness string
	for _, x := range c.Replies {
		if x.Draft == DraftHeld && x.Author == "ux" {
			fromUx = x.Id
		}
		if x.Draft == DraftHeld && x.Author == "witness" {
			fromWitness = x.Id
		}
	}
	if fromUx == "" || fromWitness == "" {
		t.Fatalf("replies = %+v, want a held reply from each seat", c.Replies)
	}
	if _, err := h.r.Draft("b", fromUx, "drop", ""); err != nil {
		t.Fatal(err)
	}
	if got := h.load("b"); len(got.Picks["ux"]) != 0 || len(got.Picks["witness"]) != 1 {
		t.Errorf("picks = %v, want UX's gone with its whole answer and Witness's kept", got.Picks)
	}
	if _, err := h.r.Draft("b", fromWitness, "send", ""); err != nil {
		t.Fatal(err)
	}
	c = h.wait("b")
	synth := h.f.calls("r3")
	if c.State != StateDone || len(synth) != 2 {
		t.Fatalf("council b = %s with %d syntheses, want done", c.State, len(synth))
	}
	mustContain(t, "the synthesis prompt", synth[1].Prompt, "Reason from witness on")
	mustNotContain(t, "the synthesis prompt", synth[1].Prompt, "Reason from ux on")
	mustNotContain(t, "the document", Document(c), "Reason from ux on")
	mustContain(t, "the document", Document(c), "Reason from witness on")
}

func TestAgreeAppliesAtOnce(t *testing.T) {
	h := newHarness(t)
	h.agents.setFn("witness/r2", agreeOnly)
	h.f.setFn("ux/r2", agreeOnly)
	h.run(agentCouncil("a"))
	h.settle("a")
	c := h.wait("a")
	// both seats agreed with nothing to add, so round 2 left nothing held: no second wait, and the summary was written
	if c.State != StateDone || c.Round != 3 {
		t.Fatalf("after round 2: %s at round %d, want done at round 3", c.State, c.Round)
	}
	if len(c.Replies) != 2 {
		t.Fatalf("replies = %+v, want one agreement from each seat", c.Replies)
	}
	for _, x := range c.Replies {
		if x.Stance != StanceAccept || x.Text != "" || x.Draft != "" {
			t.Errorf("reply %+v, want an agreement with no words, out at once", x)
		}
	}
}

func TestWithdrawRidesOnReply(t *testing.T) {
	h := newHarness(t)
	revises := func(id string, rv func(pid string) map[string]any) {
		h.agents.setFn("witness/r2", func(req CallReq) string {
			c, err := Load(id)
			if err != nil {
				t.Errorf("Load(%s): %v", id, err)
				return ""
			}
			mine := ""
			for _, p := range c.Proposals {
				if p.Author == "witness" {
					mine = p.Id
				}
			}
			return fence(mustJSON(map[string]any{"stances": []any{}, "revisions": []any{rv(mine)}, "answers": []any{}, "picks": []string{}}))
		})
	}
	// toRound2 runs a council to the held revision and returns the idea and the reply that carries the change to it
	toRound2 := func(id string) (idea string, reply CouncilReply) {
		h.run(agentCouncil(id))
		h.settle(id)
		c := h.wait(id)
		idea = ideaBy(t, c, "witness")
		for _, x := range c.Replies {
			if x.Revised {
				reply = x
			}
		}
		if reply.Id == "" || reply.Draft != DraftHeld || reply.Revision == nil {
			t.Fatalf("replies = %+v, want a held reply that carries the revision", c.Replies)
		}
		if p := proposalOf(t, c, idea); p.Withdrawn || p.Title != "Title from witness" || p.Argument != "Argument from witness" {
			t.Fatalf("the idea = %+v while its revision is held, want it as it was", p)
		}
		return idea, reply
	}

	// sent: the withdrawal takes effect
	revises("a", func(pid string) map[string]any { return map[string]any{"proposalid": pid, "withdraw": true} })
	idea, reply := toRound2("a")
	if !reply.Revision.Withdraw || !reply.Withdraws || reply.Text != "" {
		t.Errorf("held reply = %+v, want a withdrawal with no reason", reply)
	}
	h.settle("a")
	c := h.wait("a")
	if p := proposalOf(t, c, idea); !p.Withdrawn {
		t.Errorf("the idea = %+v after the reply was sent, want it withdrawn", p)
	}
	if x := replyOf(t, c, reply.Id); x.Draft != "" || x.Revision != nil {
		t.Errorf("sent reply = %+v, want nothing left to apply", x)
	}

	// dropped: the reply cancels it
	revises("b", func(pid string) map[string]any { return map[string]any{"proposalid": pid, "withdraw": true} })
	idea, reply = toRound2("b")
	if _, err := h.r.Draft("b", reply.Id, "drop", ""); err != nil {
		t.Fatal(err)
	}
	h.settle("b") // UX's reply to Witness's idea is still held
	c = h.wait("b")
	if p := proposalOf(t, c, idea); p.Withdrawn {
		t.Errorf("the idea = %+v, want it standing after its withdrawal was dropped", p)
	}
	if x := replyOf(t, c, reply.Id); x.Draft != DraftDropped || x.Revision != nil {
		t.Errorf("dropped reply = %+v, want it dropped with nothing to apply", x)
	}

	// a new title and argument ride on the reply the same way
	revises("c", func(pid string) map[string]any {
		return map[string]any{"proposalid": pid, "title": "Cache the sleep state", "argument": "A narrower argument.", "change": "Narrowed to the sleep state."}
	})
	idea, reply = toRound2("c")
	if reply.Text != "Narrowed to the sleep state." || reply.Retitled != "Cache the sleep state" {
		t.Errorf("held reply = %+v, want the change line as its text and the new title apart", reply)
	}
	h.settle("c")
	c = h.wait("c")
	if p := proposalOf(t, c, idea); p.Title != "Cache the sleep state" || p.Argument != "A narrower argument." {
		t.Errorf("the idea = %+v after the reply was sent, want the new title and argument", p)
	}
}

func TestMixedSeats(t *testing.T) {
	h := newHarness(t)
	h.run(agentCouncil("a"))
	h.settle("a")
	h.wait("a")
	h.settle("a")
	c := h.wait("a")
	if c.State != StateDone {
		t.Fatalf("council ended %s, want done", c.State)
	}
	// the live agent's turns went through the agent caller, the expert's and the coordinator's through the other
	for _, req := range h.agents.all() {
		if req.Expert.Id != "witness" {
			t.Errorf("the agent caller was asked for %s", req.Expert.Id)
		}
		if req.OnTool == nil { // a busy seat's wait is shown as what it is doing
			t.Errorf("the agent's %s call carries no way to show what it waits for", kindOf(req.Prompt))
		}
	}
	for _, req := range h.f.all() {
		if IsAgent(req.Expert) {
			t.Errorf("the expert caller was asked for the agent %s", req.Expert.Id)
		}
	}
	if len(h.agents.calls("r1")) != 1 || len(h.agents.calls("r2")) != 1 || len(h.agents.all()) != 2 {
		t.Errorf("agent calls = %d, want its ideas and its reply pass", len(h.agents.all()))
	}
	if len(h.f.calls("r1")) != 1 || len(h.f.calls("r2")) != 1 || len(h.f.calls("r3")) != 1 {
		t.Errorf("expert calls = %d, want UX's two and the coordinator's summary", len(h.f.all()))
	}
	if st := c.Stats["witness"]; st.Calls != 2 || st.Tokens != callTokens["r1"]+callTokens["r2"] {
		t.Errorf("Witness's stats = %+v, want its two calls and their tokens", st)
	}
}

func TestAgentSeatWithoutAnAgentCallerFails(t *testing.T) {
	h := newHarness(t)
	h.r.Agents = nil
	c := h.run(agentCouncil("a"))
	if f, ok := c.Failed["witness"]; !ok || f.Round != 1 || !strings.Contains(f.Error, "live agents") {
		t.Errorf("failed = %+v, want Witness's seat failed with a clear reason", c.Failed)
	}
	if len(c.Proposals) != 1 || c.Proposals[0].Author != "ux" {
		t.Errorf("proposals = %+v, want the expert's idea all the same", c.Proposals)
	}
}

func TestSkippedTurnGoesOn(t *testing.T) {
	h := newHarness(t)
	const why = "still working on its own task after 10 min"
	h.agents.setFail("witness/r1", SeatSkipped{Reason: why})
	c := h.run(agentCouncil("a"))
	if len(c.Skips) != 1 || c.Skips[0].Expert != "witness" || c.Skips[0].Round != 1 || c.Skips[0].Reason != why || c.Skips[0].Ts == 0 {
		t.Fatalf("skips = %+v, want Witness's skipped round 1", c.Skips)
	}
	if _, failed := c.Failed["witness"]; failed {
		t.Errorf("failed = %+v: a skipped turn is not a failure, and has no Retry", c.Failed)
	}
	if st := c.Stats["witness"]; st.Calls != 0 || c.Calls != 1 {
		t.Errorf("stats = %+v, calls %d, want the skipped turn to count as no call", st, c.Calls)
	}
	if c.State != StateAwaiting || len(heldIds(c)) != 1 {
		t.Fatalf("council = %s with %v held, want it to go on with UX's idea held", c.State, heldIds(c))
	}

	// Witness takes its first turn in round 2, and is brought into the council whole
	h.settle("a")
	c = h.wait("a")
	w := h.agents.calls("r2")
	if len(w) != 1 {
		t.Fatalf("Witness's round 2 calls = %d, want 1", len(w))
	}
	mustContain(t, "Witness's first turn", w[0].Prompt, "Question for the council: Which direction first?", "## Who sits in the council", "Title from ux")
	h.settle("a")
	c = h.wait("a")
	if c.State != StateDone || len(c.Skips) != 1 {
		t.Fatalf("council = %s with skips %+v, want done", c.State, c.Skips)
	}
	mustContain(t, "the synthesis prompt", h.f.calls("r3")[0].Prompt, "Witness (it skipped round 1: "+why+")")
	mustContain(t, "the document", Document(c), "- Skipped: Witness in round 1: "+why)
}

func TestSeatSkipIsReadWhetherItIsAValueOrAPointer(t *testing.T) {
	for _, err := range []error{SeatSkipped{Reason: "r"}, &SeatSkipped{Reason: "r"}, fmt.Errorf("wrapped: %w", SeatSkipped{Reason: "r"})} {
		if s, ok := seatSkip(err); !ok || s.Reason != "r" {
			t.Errorf("seatSkip(%v) = %+v, %v, want the skip", err, s, ok)
		}
	}
	for _, err := range []error{nil, errors.New("gave no answer")} {
		if _, ok := seatSkip(err); ok {
			t.Errorf("seatSkip(%v) took it for a skip", err)
		}
	}
}

func TestEveryoneSkippingRound1FailsTheCouncil(t *testing.T) {
	h := newHarness(t)
	h.agents.setFail("witness/r1", SeatSkipped{Reason: "a question waits for you in its terminal"})
	h.f.setFail("ux/r1", SeatSkipped{Reason: "gave no answer within 20 min"})
	c := h.run(agentCouncil("a"))
	if c.State != StateFailed || c.Error != "every expert failed or skipped round 1" {
		t.Errorf("council = %s (%q), want it failed: nobody answered", c.State, c.Error)
	}
}

func TestAgentRounds1And3(t *testing.T) {
	h := newHarness(t)

	// one round: the ideas, then the summary
	one := agentCouncil("one")
	one.Rounds = 1
	h.run(one)
	h.settle("one")
	c := h.wait("one")
	if c.State != StateDone || c.Round != 2 || c.Summary == nil {
		t.Fatalf("one round: %s at round %d, want done at round 2", c.State, c.Round)
	}
	if len(h.f.calls("r2"))+len(h.agents.calls("r2")) != 0 || len(c.Picks) != 0 {
		t.Errorf("one round ran a reply pass or took picks: %v", c.Picks)
	}
	mustContain(t, "the summary prompt", h.f.calls("r3")[0].Prompt, "This is round 2 of 2")
	mustContain(t, "UX's ideas prompt", h.f.calls("r1")[0].Prompt, "This is round 1 of 2")

	// three rounds: a second reply pass, and picks only from the last
	h.agents.setFn("witness/r2", func(req CallReq) string {
		if !strings.Contains(req.Prompt, "round 3 of 4") {
			return round2JSON(req)
		}
		c, err := Load("three")
		if err != nil {
			t.Errorf("Load: %v", err)
			return ""
		}
		rv := map[string]any{"proposalid": ideaBy(t, c, "witness"), "title": "Retitled in round 3", "change": "Narrowed."}
		return fence(mustJSON(map[string]any{"stances": []any{}, "revisions": []any{rv}, "answers": []any{}, "picks": []string{}}))
	})
	three := agentCouncil("three")
	three.Rounds = 3
	c = h.run(three)
	if c.State != StateAwaiting || c.Round != 1 {
		t.Fatalf("three rounds, after 1: %s at round %d", c.State, c.Round)
	}
	h.settle("three")
	c = h.wait("three")
	if c.State != StateAwaiting || c.Round != 2 || len(c.Replies) != 2 {
		t.Fatalf("three rounds, after 2: %s at round %d with %d replies, want awaiting-you at round 2", c.State, c.Round, len(c.Replies))
	}
	if len(c.Picks) != 0 {
		t.Errorf("picks = %v after round 2 of 3, want none: picks are taken in the last reply pass", c.Picks)
	}
	h.settle("three")
	c = h.wait("three")
	if c.State != StateAwaiting || c.Round != 3 {
		t.Fatalf("three rounds, after 3: %s at round %d, want awaiting-you at round 3", c.State, c.Round)
	}
	if len(c.Picks["ux"]) != 1 {
		t.Errorf("picks = %v, want UX's pick from the last reply pass", c.Picks)
	}
	held := heldIds(c)
	if len(held) != 1 || replyOf(t, c, held[0]).Round != 3 || !replyOf(t, c, held[0]).Revised {
		t.Fatalf("held after round 3 = %v, want Witness's revision of its idea", held)
	}
	// Witness saw what was sent since its last turn, and the later pass's note, but none of its own words
	var pass2 []CallReq
	for _, req := range h.agents.calls("r2") {
		if strings.Contains(req.Prompt, "round 3 of 4") {
			pass2 = append(pass2, req)
		}
	}
	if len(pass2) != 1 {
		t.Fatalf("Witness's calls in round 3 = %d, want 1", len(pass2))
	}
	mustContain(t, "Witness's round 3 prompt", pass2[0].Prompt, "Reason from ux on", laterPassNote)
	mustNotContain(t, "Witness's round 3 prompt", pass2[0].Prompt, "Reason from witness on")

	h.settle("three")
	c = h.wait("three")
	if c.State != StateDone || c.Round != 4 {
		t.Fatalf("three rounds, after the last draft: %s at round %d, want done at round 4", c.State, c.Round)
	}
	if p := proposalOf(t, c, ideaBy(t, c, "witness")); p.Title != "Retitled in round 3" {
		t.Errorf("the idea = %+v, want the revision sent in round 3 to apply", p)
	}
	mustContain(t, "the summary prompt", h.f.calls("r3")[1].Prompt, "This is round 4 of 4")
}

func TestFollowupDraftKeepsDone(t *testing.T) {
	h := newHarness(t)
	h.run(agentCouncil("a"))
	h.settle("a")
	h.wait("a")
	h.settle("a")
	c := h.wait("a")
	if c.State != StateDone {
		t.Fatalf("council ended %s, want done", c.State)
	}
	if _, err := h.r.Reply("a", "", "", "@all What about the Mac?", false, nil); err != nil {
		t.Fatal(err)
	}
	c = h.wait("a")
	if c.State != StateDone || c.Round != 3 {
		t.Fatalf("after the follow-up: %s at round %d, want the council done as it was", c.State, c.Round)
	}
	held := heldIds(c)
	if len(held) != 2 {
		t.Fatalf("held = %v, want both seats' answers held", held)
	}
	for _, id := range held {
		if x := replyOf(t, c, id); x.Round != FirstFollowRound(c) || x.ParentId == "" {
			t.Errorf("held answer %+v, want a follow-up answer under the person's reply", x)
		}
	}
	calls := len(h.prompts())
	for _, id := range held {
		got, err := h.r.Draft("a", id, "send", "")
		if err != nil || got.State != StateDone {
			t.Fatalf("settling %s: %v, %v, want the council to stay done", id, got.State, err)
		}
	}
	if c = h.wait("a"); c.State != StateDone || HeldDrafts(c) != 0 || len(h.prompts()) != calls {
		t.Errorf("after settling: %s with %d held and %d new calls, want done, settled and nothing rerun", c.State, HeldDrafts(c), len(h.prompts())-calls)
	}
}

// ranToTheReport checks a council that holds nothing ran its rounds to the report: done, nothing held or dropped, every
// seat's idea and the reply pass sent, and it never stopped awaiting-you on the way.
func (h *harness) ranToTheReport(c *Council) {
	h.t.Helper()
	if c.State != StateDone || c.Round != SynthesisRound(c) || c.Summary == nil {
		h.t.Fatalf("council = %s at round %d (summary %v), want done at the synthesis round", c.State, c.Round, c.Summary != nil)
	}
	if len(c.Proposals) != 2 || len(c.Replies) == 0 || HeldDrafts(c) != 0 {
		h.t.Errorf("proposals %d, replies %d, held %d: want an idea from each seat, a reply pass and nothing held", len(c.Proposals), len(c.Replies), HeldDrafts(c))
	}
	for _, p := range c.Proposals {
		if p.Draft != "" {
			h.t.Errorf("idea %s is %q, want it sent as written", p.Id, p.Draft)
		}
	}
	for _, x := range c.Replies {
		if x.Draft != "" {
			h.t.Errorf("reply %s is %q, want it sent as written", x.Id, x.Draft)
		}
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	for _, seen := range h.seen {
		if seen.Id == c.Id && seen.State == StateAwaiting {
			h.t.Errorf("council %s stopped awaiting-you at round %d", c.Id, seen.Round)
		}
	}
}

// A council an agent started (ByAgent) holds no draft with a chat seated: its rounds run to the report by themselves,
// also when it was saved not-run and started later. TestAgentSeatsHoldDrafts is the same council without ByAgent.
func TestAgentCouncilByAgentHoldsNothing(t *testing.T) {
	h := newHarness(t)
	c := agentCouncil("a")
	c.ByAgent = true
	h.ranToTheReport(h.run(c))
	// the chat took its turn in the reply pass: it reviewed UX's idea, which nobody dropped
	if len(h.agents.calls("r2")) != 1 || len(h.f.calls("r2")) != 1 {
		t.Errorf("reply pass calls: Witness %d, UX %d, want one each", len(h.agents.calls("r2")), len(h.f.calls("r2")))
	}

	saved := agentCouncil("b")
	saved.ByAgent = true
	rec, err := h.r.Record(saved)
	if err != nil || rec.State != StateNotRun || !rec.ByAgent {
		t.Fatalf("Record = %+v, %v, want it saved not-run and still started by an agent", rec, err)
	}
	if _, err := h.r.StartSaved(context.Background(), "b"); err != nil {
		t.Fatalf("StartSaved: %v", err)
	}
	h.ranToTheReport(h.wait("b"))
}

// --pause pauses an agent council after round 1 as it does an expert-only one: with nothing held, a Continue ends it.
func TestAgentCouncilByAgentPausesAfterRound1(t *testing.T) {
	h := newHarness(t)
	c := agentCouncil("a")
	c.ByAgent, c.PauseAfterRound1 = true, true
	got := h.run(c)
	if got.State != StateAwaiting || got.Round != 1 || HeldDrafts(got) != 0 || len(got.Proposals) != 2 {
		t.Fatalf("after round 1: %s at round %d with %d held and %d ideas, want the pause with both ideas sent", got.State, got.Round, HeldDrafts(got), len(got.Proposals))
	}
	if _, err := h.r.Continue("a", nil, ""); err != nil {
		t.Fatalf("Continue: %v", err)
	}
	if got = h.wait("a"); got.State != StateDone || got.Summary == nil || HeldDrafts(got) != 0 {
		t.Errorf("after Continue: %s with %d held, want done", got.State, HeldDrafts(got))
	}
}

func TestContinueRefusesHeldDrafts(t *testing.T) {
	h := newHarness(t)
	h.run(agentCouncil("a"))
	if _, err := h.r.Continue("a", nil, ""); err == nil || !strings.Contains(err.Error(), "drafts waiting for you") {
		t.Fatalf("Continue = %v, want it refused for the held drafts", err)
	}
	if c := h.load("a"); c.State != StateAwaiting || c.Round != 1 || len(h.f.calls("r2")) != 0 {
		t.Errorf("council = %s at round %d, want it still waiting at round 1", c.State, c.Round)
	}
}

func TestPauseAfterRound1IsIgnoredWithAgents(t *testing.T) {
	h := newHarness(t)
	nothing := fence(mustJSON(map[string]any{"overview": "Nothing to add.", "proposals": []any{}}))
	h.agents.setText("witness/r1", nothing)
	h.f.setText("ux/r1", nothing)
	c := agentCouncil("a")
	c.PauseAfterRound1 = true
	if got := h.run(c); got.State != StateDone {
		t.Errorf("council = %s at round %d, want it to go on to the summary: held drafts are the pause, and there are none", got.State, got.Round)
	}
}

func TestPostReachesNextTurn(t *testing.T) {
	h := newHarness(t)
	// posted while the round runs, to Witness only
	h.agents.gate("witness/r1")
	h.start(agentCouncil("a"))
	h.agents.entered(t, "witness/r1")
	const ask = "@Witness does this hold on a Mac?"
	if _, err := h.r.Reply("a", "", "", ask, false, nil); err != nil {
		t.Fatal(err)
	}
	h.agents.release("witness/r1")
	c := h.wait("a")
	you := repliesBy(c, YouId)
	if len(you) != 1 || !slices.Equal(you[0].To, []string{"witness"}) || you[0].Round != 1 || you[0].Draft != "" {
		t.Fatalf("the person's replies = %+v, want one to Witness, never held", you)
	}
	h.settle("a")
	c = h.wait("a")
	w, ux := h.agents.calls("r2"), h.f.calls("r2")
	if len(w) != 1 || len(ux) != 1 {
		t.Fatalf("round 2 calls: Witness %d, UX %d, want one each", len(w), len(ux))
	}
	mustContain(t, "Witness's round 2 prompt", w[0].Prompt, "## What the person asks you", "does this hold on a Mac?")
	mustNotContain(t, "UX's round 2 prompt", ux[0].Prompt, "does this hold on a Mac?")
	var answer *CouncilReply
	for _, x := range c.Replies {
		if x.Author == "witness" && x.ParentId == you[0].Id {
			answer = &x
		}
	}
	if answer == nil || answer.Draft != DraftHeld {
		t.Errorf("replies = %+v, want Witness's held answer under the person's reply", c.Replies)
	}
	if !replyOf(t, c, you[0].Id).Answered {
		t.Error("the person's reply is not marked answered after its seat's turn")
	}

	// posted while the council waits, to UX only
	h.run(agentCouncil("b"))
	if _, err := h.r.Reply("b", "", "", "@UX is it findable?", false, nil); err != nil {
		t.Fatal(err)
	}
	h.settle("b")
	h.wait("b")
	w, ux = h.agents.calls("r2"), h.f.calls("r2")
	if len(w) != 2 || len(ux) != 2 {
		t.Fatalf("round 2 calls so far: Witness %d, UX %d, want two each", len(w), len(ux))
	}
	mustContain(t, "UX's round 2 prompt", ux[1].Prompt, "is it findable?")
	mustNotContain(t, "Witness's round 2 prompt", w[1].Prompt, "is it findable?")
}

func TestValidateAgentSeats(t *testing.T) {
	withSeat := func(mod func(c *Council)) *Council {
		c := agentCouncil("v")
		mod(c)
		return c
	}
	for _, tc := range []struct {
		name string
		c    *Council
		want string // a part of the refusal; empty means the council is fine
	}{
		{"one agent beside an expert", agentCouncil("v"), ""},
		{"a pi agent", withSeat(func(c *Council) { c.Experts[0].Harness = HarnessPi }), ""},
		{"three rounds", withSeat(func(c *Council) { c.Rounds = 3 }), ""},
		{"the same agent twice", withSeat(func(c *Council) {
			c.Experts = slices.Insert(c.Experts, 1, CouncilExpert{Id: "second", Name: "Second", Agent: "tab-1", Harness: HarnessClaude})
		}), "twice"},
		{"two different agents", withSeat(func(c *Council) {
			c.Experts = slices.Insert(c.Experts, 1, CouncilExpert{Id: "second", Name: "Second", Agent: "tab-2", Harness: HarnessClaude})
		}), ""},
		{"an agent as the coordinator", withSeat(func(c *Council) { c.Experts[2].Agent, c.Experts[2].Harness = "tab-9", HarnessClaude }), "coordinator"},
		{"another harness", withSeat(func(c *Council) { c.Experts[0].Harness = "gemini" }), "only a claude or pi agent"},
		{"no harness", withSeat(func(c *Council) { c.Experts[0].Harness = "" }), "only a claude or pi agent"},
		{"rounds below 0", withSeat(func(c *Council) { c.Rounds = -1 }), "1 to 3 rounds"},
		{"rounds above 3", withSeat(func(c *Council) { c.Rounds = 4 }), "1 to 3 rounds"},
	} {
		err := validateCouncil(tc.c)
		switch {
		case tc.want == "" && err != nil:
			t.Errorf("%s: refused: %v", tc.name, err)
		case tc.want != "" && (err == nil || !strings.Contains(err.Error(), tc.want)):
			t.Errorf("%s: error = %v, want one that says %q", tc.name, err, tc.want)
		}
	}

	// Start refuses them all the same, and saves nothing
	h := newHarness(t)
	bad := agentCouncil("bad")
	bad.Experts[0].Harness = "gemini"
	if _, err := h.r.Start(context.Background(), bad); err == nil {
		t.Error("Start took a council with a gemini agent")
	}
	if _, err := Load("bad"); err == nil {
		t.Error("a refused council was saved")
	}

	// Rounds is honoured only when an agent is seated: an expert-only council runs today's two rounds
	experts := testCouncil("e")
	experts.Rounds = 3
	c := h.run(experts)
	if c.State != StateDone || c.Round != 3 || c.Rounds != 0 || HeldDrafts(c) != 0 || len(h.f.calls("r2")) != 4 {
		t.Errorf("expert-only council with Rounds 3 = %s at round %d, Rounds %d, %d reply calls; want today's shape",
			c.State, c.Round, c.Rounds, len(h.f.calls("r2")))
	}
}

func TestUnparsedAgentAnswerIsPlainReply(t *testing.T) {
	h := newHarness(t)
	const words = "I would cache the sleep state, since the polling is what keeps it awake."
	h.agents.setText("witness/r1", words+"\n\n```json\n{ this is not json\n```")
	c := h.run(agentCouncil("a"))
	if _, failed := c.Failed["witness"]; failed {
		t.Fatalf("failed = %+v, want an agent's free words heard, not failed", c.Failed)
	}
	if len(c.Proposals) != 1 || c.Proposals[0].Author != "ux" {
		t.Errorf("proposals = %+v, want only UX's idea", c.Proposals)
	}
	plain := repliesBy(c, "witness")
	if len(plain) != 1 || plain[0].Text != words || plain[0].ProposalId != "" || plain[0].ParentId != "" || plain[0].Round != 1 || plain[0].Draft != DraftHeld {
		t.Fatalf("Witness's replies = %+v, want one plain reply to the whole council, held", plain)
	}

	// a reply pass too
	h.agents.setText("witness/r2", "Agreed, with one caveat about Macs.")
	h.settle("a")
	c = h.wait("a")
	if len(c.Failed) != 0 {
		t.Errorf("failed = %+v, want none", c.Failed)
	}
	if got := repliesBy(c, "witness"); len(got) != 2 || got[1].Text != "Agreed, with one caveat about Macs." || got[1].Round != 2 || got[1].Draft != DraftHeld {
		t.Errorf("Witness's replies = %+v, want its round 2 words as a plain reply", got)
	}
}

func TestDraftRefusals(t *testing.T) {
	h := newHarness(t)
	c := h.run(agentCouncil("a"))
	witness := ideaBy(t, c, "witness")
	if _, err := h.r.Draft("a", "P99", "send", ""); err == nil || !strings.Contains(err.Error(), "no idea or reply P99") {
		t.Errorf("an unknown item: %v", err)
	}
	if _, err := h.r.Draft("a", witness, "approve", ""); err == nil || !strings.Contains(err.Error(), "unknown draft action") {
		t.Errorf("an unknown action: %v", err)
	}
	if _, err := h.r.Draft("nope", witness, "send", ""); err == nil {
		t.Error("an unknown council was taken")
	}
	if _, err := h.r.Draft("a", witness, "send", ""); err != nil {
		t.Fatal(err)
	}
	if _, err := h.r.Draft("a", witness, "drop", ""); err == nil || !strings.Contains(err.Error(), "not a held draft") {
		t.Errorf("a draft that was sent: %v", err)
	}
	if got := proposalOf(t, h.load("a"), witness); got.Draft != "" {
		t.Errorf("the refused drop changed the idea: %+v", got)
	}
}

func TestDraftOnACouncilThatIsNotWaitingOnlySettles(t *testing.T) {
	h := newHarness(t)

	// running: the person settles Witness's idea while UX is still at work, and the round goes on by itself when it ends
	h.f.gate("ux/r1")
	h.f.setText("ux/r1", fence(mustJSON(map[string]any{"overview": "Nothing to add.", "proposals": []any{}})))
	h.f.setFn("ux/r2", agreeOnly)
	h.start(agentCouncil("a"))
	waitFor(t, "Witness's idea", func() bool { return len(h.load("a").Proposals) == 1 })
	idea := h.load("a").Proposals[0].Id
	got, err := h.r.Draft("a", idea, "send", "")
	if err != nil || got.State != StateRunning || got.Round != 1 || len(h.f.calls("r2")) != 0 {
		t.Fatalf("settling during the round: %s at round %d, %v, want it only settled", got.State, got.Round, err)
	}
	h.f.release("ux/r1")
	if c := h.wait("a"); c.State != StateDone {
		t.Errorf("council = %s at round %d, want it to go on to the summary: nothing was left held", c.State, c.Round)
	}

	// stopped: a draft is settled and nothing starts
	h.run(agentCouncil("b"))
	if _, err := h.r.Stop("b"); err != nil {
		t.Fatal(err)
	}
	calls := len(h.prompts())
	held := heldIds(h.load("b"))
	got, err = h.r.Draft("b", held[0], "send", "")
	if err != nil || got.State != StateStopped || len(h.prompts()) != calls {
		t.Errorf("settling a stopped council: %s, %v, %d new calls; want it settled and left stopped", got.State, err, len(h.prompts())-calls)
	}
}

// ---- checked claims, verify requests and the timeline ----

// useSnapshot replaces the snapshot Start takes with one that answers commit and err, and counts its calls.
func useSnapshot(t *testing.T, commit string, err error) *atomic.Int32 {
	t.Helper()
	var n atomic.Int32
	prev := takeSnapshot
	takeSnapshot = func(context.Context, string) (string, error) {
		n.Add(1)
		return commit, err
	}
	t.Cleanup(func() { takeSnapshot = prev })
	return &n
}

// checkProject is a project folder holding pkg/ux.go (4 lines) and pkg/ram.go (3 lines), for cites that resolve.
func checkProject(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "pkg"), 0o755); err != nil {
		t.Fatal(err)
	}
	vWriteFile(t, filepath.Join(dir, "pkg", "ux.go"), "package ux\n\nfunc Sleep() {}\nfunc Wake() {}\n")
	vWriteFile(t, filepath.Join(dir, "pkg", "ram.go"), "package ram\n\nvar Cache = map[string]int{}\n")
	return dir
}

// claimCouncil is testCouncil in a real project folder, with no files attached.
func claimCouncil(id, project string) *Council {
	c := testCouncil(id)
	c.Project, c.Files = project, nil
	return c
}

func cite(ref, quote string) map[string]string {
	m := map[string]string{"ref": ref}
	if quote != "" {
		m["quote"] = quote
	}
	return m
}

func askRun(command, expect string) map[string]string {
	return map[string]string{"command": command, "expect": expect, "why": "to see it"}
}

// claimJSON is a round 1 reply with one idea that cites evidence and asks Go to run verify.
func claimJSON(title string, evidence []map[string]string, verify ...map[string]string) string {
	if evidence == nil {
		evidence = []map[string]string{}
	}
	p := map[string]any{"title": title, "argument": "Argument for " + title, "evidence": evidence}
	if len(verify) > 0 {
		p["verify"] = verify
	}
	return fence(mustJSON(map[string]any{"overview": "ok", "proposals": []any{p}}))
}

// r2Citing is a reply pass that takes the canned stance on every proposal it was shown and cites ev under each.
func r2Citing(ev ...map[string]string) func(CallReq) string {
	return func(req CallReq) string {
		stances := stancesFor(req)
		for _, s := range stances {
			s["evidence"] = ev
		}
		return fence(mustJSON(map[string]any{"stances": stances, "revisions": []any{}, "answers": []any{}, "picks": []string{}}))
	}
}

func TestRunnerChecksLabelAfterRound1AndTheReplyPass(t *testing.T) {
	h := newHarness(t)
	proj := checkProject(t)
	h.f.setText("ux/r1", claimJSON("Sleep first", []map[string]string{cite("pkg/ux.go:3", "func Sleep()")}))
	h.f.setText("ram/r1", claimJSON("Cache less", []map[string]string{cite("pkg/ram.go:900", "")}))
	h.f.setText("newuser/r1", claimJSON("Say nothing", nil))
	h.f.setText("skeptic/r1", claimJSON("Mixed", []map[string]string{cite("pkg/ux.go:4", "func Wake()"), cite("pkg/nope.go:1", "")}))
	c := claimCouncil("c1", proj)
	c.PauseAfterRound1 = true

	paused := h.run(c)
	if paused.State != StateAwaiting || paused.Round != 1 {
		t.Fatalf("after round 1: %s at round %d, want awaiting-you at round 1", paused.State, paused.Round)
	}
	idea := func(c *Council, author string) CouncilProposal { return proposalOf(t, c, ideaBy(t, c, author)) }
	if p := idea(paused, "ux"); p.Label != LabelRead || p.Evidence[0].Cite != CiteOK {
		t.Errorf("ux's idea = label %q cite %q, want read and ok at the pause", p.Label, p.Evidence[0].Cite)
	}
	if p := idea(paused, "ram"); p.Label != LabelGuess || p.Evidence[0].Cite != CiteWrong || !strings.Contains(p.Evidence[0].CiteNote, "past the end") {
		t.Errorf("ram's idea = label %q, evidence %+v, want guess and a cite past the end of the file", p.Label, p.Evidence[0])
	}
	if p := idea(paused, "newuser"); p.Label != LabelGuess || p.Evidence[0].Cite != "" {
		t.Errorf("newuser's idea = label %q cite %q, want guess and nothing checked", p.Label, p.Evidence[0].Cite)
	}
	if p := idea(paused, "skeptic"); p.Label != LabelRead || p.Evidence[0].Cite != CiteOK || p.Evidence[1].Cite != CiteWrong || p.Evidence[1].CiteNote != "file not found" {
		t.Errorf("skeptic's idea = label %q evidence %+v, want read, with the second cite still wrong", p.Label, p.Evidence)
	}

	h.f.setFn("ux/r2", r2Citing(cite("pkg/ux.go:3", "func Sleep()")))
	h.f.setFn("ram/r2", r2Citing(cite("pkg/ram.go:50", "")))
	if _, err := h.r.Continue("c1", nil, ""); err != nil {
		t.Fatalf("Continue: %v", err)
	}
	done := h.wait("c1")
	if done.State != StateDone {
		t.Fatalf("council = %s %q, want done", done.State, done.Error)
	}
	stances := 0
	for _, x := range done.Replies {
		if (x.Stance != "") != (x.Label != "") {
			t.Errorf("reply %s by %s has stance %q and label %q, want a label on a stance and on nothing else", x.Id, x.Author, x.Stance, x.Label)
		}
		if x.Stance == "" {
			continue
		}
		stances++
		switch x.Author {
		case "ux":
			if x.Label != LabelRead || x.Evidence[0].Cite != CiteOK {
				t.Errorf("ux's reply %s = label %q evidence %+v, want read", x.Id, x.Label, x.Evidence)
			}
		case "ram":
			if x.Label != LabelGuess || x.Evidence[0].Cite != CiteWrong {
				t.Errorf("ram's reply %s = label %q evidence %+v, want guess with a wrong cite", x.Id, x.Label, x.Evidence)
			}
		default:
			if x.Label != LabelGuess {
				t.Errorf("%s's reply %s cites nothing: label %q, want guess", x.Author, x.Id, x.Label)
			}
		}
	}
	if stances != 12 {
		t.Errorf("%d replies took a stance, want 12", stances)
	}
	if p := idea(done, "ux"); p.Label != LabelRead {
		t.Errorf("ux's idea after the pass = %q, want it still read", p.Label)
	}
}

func TestRunnerChecksCitesIntoAttachedFilesAndFolders(t *testing.T) {
	h := newHarness(t)
	proj := checkProject(t)
	outside := t.TempDir()
	notes := filepath.Join(outside, "notes.md")
	vWriteFile(t, notes, "# Notes\nthe spec says wake on demand\n")
	folder := t.TempDir()
	vWriteFile(t, filepath.Join(folder, "design.txt"), "one\ntwo\n")
	c := claimCouncil("c1", proj)
	c.Files = []string{notes, folder, "pkg/ram.go"} // a file and a folder outside the project, and a project file as written in Setup
	c.PauseAfterRound1 = true
	h.f.setText("ux/r1", claimJSON("The attached file", []map[string]string{cite(notes+":2", "wake on demand")}))
	h.f.setText("ram/r1", claimJSON("Its bare name", []map[string]string{cite("notes.md:2", "")}))
	h.f.setText("newuser/r1", claimJSON("A file in the attached folder", []map[string]string{cite("design.txt:2", "two")}))
	h.f.setText("skeptic/r1", claimJSON("A file nothing attached", []map[string]string{cite(filepath.Join(outside, "other.md")+":1", "")}))

	paused := h.run(c)
	got := func(author string) CouncilEvidence {
		return proposalOf(t, paused, ideaBy(t, paused, author)).Evidence[0]
	}
	if e := got("ux"); e.Cite != CiteOK {
		t.Errorf("a cite of an attached file by its absolute path = %+v, want ok", e)
	}
	if e := got("ram"); e.Cite != CiteWrong {
		t.Errorf("a cite of an attached file by its bare name = %+v, want wrong: a file root matches only its own path", e)
	}
	if e := got("newuser"); e.Cite != CiteOK {
		t.Errorf("a cite of a file in an attached folder = %+v, want ok", e)
	}
	if e := got("skeptic"); e.Cite != CiteWrong || !strings.Contains(e.CiteNote, "outside") {
		t.Errorf("a cite of a file beside an attached file = %+v, want wrong and outside", e)
	}
}

// seatLink is a seated agent that answers each turn at once with what reply makes of the prompt, and works in the folder
// its tab maps to in cwds.
type seatLink struct {
	mu    sync.Mutex
	cwds  map[string]string
	reply func(tab, prompt string) string
	text  map[string]string
	ts    map[string]int64
	// gone are the tabs that closed; sessions the session each live tab runs (Transcript, Holder)
	gone     map[string]bool
	sessions map[string]string
}

func newSeatLink(cwds map[string]string, reply func(tab, prompt string) string) *seatLink {
	return &seatLink{cwds: cwds, reply: reply, text: map[string]string{}, ts: map[string]int64{}}
}

func (l *seatLink) Seat(_ context.Context, tab string) (AgentSeatState, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.gone[tab] {
		return AgentSeatState{State: SeatGone}, nil
	}
	return AgentSeatState{State: SeatIdle, Cwd: l.cwds[tab]}, nil
}

func (l *seatLink) Transcript(_ context.Context, tab string) (string, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.sessions[tab], nil
}

func (l *seatLink) Holder(_ context.Context, transcript string) (string, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	for tab, s := range l.sessions {
		if s == transcript && !l.gone[tab] {
			return tab, nil
		}
	}
	return "", nil
}

func (l *seatLink) Send(_ context.Context, tab, text string) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.text[tab] = l.reply(tab, text)
	l.ts[tab] += 100
	return nil
}

func (l *seatLink) LastAnswer(_ context.Context, tab string) (string, int64, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.text[tab], l.ts[tab], nil
}

func TestRunnerChecksAnAgentSeatsCitesAgainstItsCwd(t *testing.T) {
	h := newHarness(t)
	proj := checkProject(t)
	seatDir := t.TempDir()
	vWriteFile(t, filepath.Join(seatDir, "seat.go"), "package seat\n\nfunc Here() {}\n")
	useSnapshot(t, "snap", nil)
	trees := &fakeTrees{}
	h.r.Trees = trees
	link := newSeatLink(map[string]string{"tab-1": seatDir, "tab-2": ""}, func(tab, prompt string) string {
		if kindOf(prompt) != "r1" {
			return agreeOnly(CallReq{Prompt: prompt})
		}
		if tab == "tab-1" { // asks for a command too, which no agent seat gets
			return claimJSON("From the seat", []map[string]string{cite("seat.go:3", "func Here()"), cite("pkg/ux.go:3", "func Sleep()")},
				askRun("go test ./pkg/services -run TestSeat", RunPass))
		}
		return claimJSON("From the guest", []map[string]string{cite("pkg/ux.go:3", "func Sleep()")})
	})
	h.r.Agents = AgentCaller{Link: link, BusyCap: time.Second, TurnCap: 5 * time.Second, Poll: time.Millisecond}
	h.f.setText("ux/r1", claimJSON("Sleep first", []map[string]string{cite("seat.go:3", "")}))
	c := claimCouncil("c1", proj)
	c.ByAgent, c.PauseAfterRound1 = true, true
	c.Experts = []CouncilExpert{
		{Id: "witness", Name: "Witness", Agent: "tab-1", Harness: HarnessClaude},
		{Id: "guest", Name: "Guest", Agent: "tab-2", Harness: HarnessClaude},
		{Id: "ux", Name: "UX", Brief: "Can someone use it?", Model: "sonnet"},
		{Id: "lead", Name: "Lead", Brief: "Merge and rank.", Model: "opus", Coordinator: true},
	}

	paused := h.run(c)
	if paused.State != StateAwaiting {
		t.Fatalf("council = %s %q, want awaiting-you after round 1", paused.State, paused.Error)
	}
	witness := proposalOf(t, paused, ideaBy(t, paused, "witness"))
	if witness.Label != LabelRead || witness.Evidence[0].Cite != CiteOK || witness.Evidence[1].Cite != CiteOK {
		t.Errorf("the seat's idea = label %q evidence %+v, want its own folder's file ok, and the project's file ok too", witness.Label, witness.Evidence)
	}
	if len(witness.Runs) != 0 {
		t.Errorf("the seat's idea kept %+v: an agent seat sends no verify request", witness.Runs)
	}
	if guest := proposalOf(t, paused, ideaBy(t, paused, "guest")); guest.Label != LabelRead || guest.Evidence[0].Cite != CiteOK {
		t.Errorf("a seat with no known folder = label %q evidence %+v, want its cite read against the project", guest.Label, guest.Evidence)
	}
	if ux := proposalOf(t, paused, ideaBy(t, paused, "ux")); ux.Label != LabelGuess || ux.Evidence[0].Cite != CiteWrong {
		t.Errorf("a role expert citing the seat's file = label %q evidence %+v, want wrong: it reads the project, not the seat's folder", ux.Label, ux.Evidence)
	}
	if len(trees.events) != 0 {
		t.Errorf("the tree was touched (%v) though only an agent seat asked for a command", trees.events)
	}
}

// a chat seat whose tab closed, its session opened again in another tab, takes its turn there, and the council keeps the
// new tab; a live seat from before seats kept their session gains it
func TestRunnerAgentSeatFollowsItsSessionToANewTab(t *testing.T) {
	h := newHarness(t)
	proj := checkProject(t)
	useSnapshot(t, "snap", nil)
	h.r.Trees = &fakeTrees{}
	link := newSeatLink(map[string]string{}, func(tab, prompt string) string {
		if kindOf(prompt) != "r1" {
			return agreeOnly(CallReq{Prompt: prompt})
		}
		return claimJSON("From "+tab, []map[string]string{cite("pkg/ux.go:3", "func Sleep()")})
	})
	link.gone = map[string]bool{"tab-old": true}
	link.sessions = map[string]string{"tab-new": "/s/notes.jsonl", "tab-2": "/s/guest.jsonl"}
	h.r.Agents = AgentCaller{Link: link, BusyCap: time.Second, TurnCap: 5 * time.Second, Poll: time.Millisecond}
	h.f.setText("ux/r1", claimJSON("Sleep first", []map[string]string{cite("pkg/ux.go:3", "")}))
	c := claimCouncil("c1", proj)
	c.ByAgent, c.PauseAfterRound1 = true, true
	c.Experts = []CouncilExpert{
		{Id: "agent-old", Name: "notes", Agent: "tab-old", Harness: HarnessClaude, Transcript: "/s/notes.jsonl"},
		{Id: "guest", Name: "Guest", Agent: "tab-2", Harness: HarnessClaude},
		{Id: "ux", Name: "UX", Brief: "Can someone use it?", Model: "sonnet"},
		{Id: "lead", Name: "Lead", Brief: "Merge and rank.", Model: "opus", Coordinator: true},
	}

	paused := h.run(c)
	if paused.State != StateAwaiting {
		t.Fatalf("council = %s %q, want awaiting-you after round 1", paused.State, paused.Error)
	}
	if f, failed := paused.Failed["agent-old"]; failed {
		t.Fatalf("the moved seat failed: %+v, want it answered from its new tab", f)
	}
	if p := proposalOf(t, paused, ideaBy(t, paused, "agent-old")); p.Title != "From tab-new" {
		t.Errorf("the moved seat's idea = %q, want the one its new tab gave", p.Title)
	}
	var moved, guest CouncilExpert
	for _, e := range paused.Experts {
		switch e.Id {
		case "agent-old":
			moved = e
		case "guest":
			guest = e
		}
	}
	if moved.Agent != "tab-new" || moved.Transcript != "/s/notes.jsonl" {
		t.Errorf("the moved seat = tab %q session %q, want tab-new and its session", moved.Agent, moved.Transcript)
	}
	if guest.Agent != "tab-2" || guest.Transcript != "/s/guest.jsonl" {
		t.Errorf("the live seat from before = tab %q session %q, want tab-2 with its session read off it", guest.Agent, guest.Transcript)
	}
}

func TestRunnerVerifyRunsBeforeThePauseAndReachesEverySeatsRound2(t *testing.T) {
	h := newHarness(t)
	proj := checkProject(t)
	useSnapshot(t, "snap123", nil)
	g := newVerifyRig(t)
	trees := &fakeTrees{dir: "TREE"}
	h.r.Trees = trees
	g.run = func(_ context.Context, _ string, argv []string) (string, int, error) {
		switch cmd := strings.Join(argv, " "); {
		case strings.HasSuffix(cmd, "TestSleeps"):
			return "ok  \tgithub.com/x/pkg/services\t0.01s\n", 0, nil
		default:
			return "--- FAIL: " + argv[len(argv)-1] + " (0.00s)\n    idle_test.go:9: nobody woke\nFAIL\nFAIL\tgithub.com/x/pkg/services\t0.01s\n", 1, nil
		}
	}
	h.f.setText("ux/r1", claimJSON("Sleep first", []map[string]string{cite("pkg/ux.go:3", "func Sleep()")}, askRun("go test ./pkg/services -run TestSleeps", RunPass)))
	h.f.setText("ram/r1", claimJSON("Cache less", []map[string]string{cite("pkg/ram.go:3", "")}, askRun("go test ./pkg/services -run TestCache", RunPass)))
	h.f.setText("skeptic/r1", claimJSON("It never wakes", []map[string]string{cite("pkg/ux.go:4", "func Wake()")}, askRun("go test ./pkg/services -run TestWakes", RunFail)))
	h.f.setText("newuser/r1", claimJSON("A shell trick", []map[string]string{cite("pkg/ux.go:3", "")}, askRun("go test ./pkg/services -run TestA | tail", RunPass)))
	c := claimCouncil("c1", proj)
	c.PauseAfterRound1 = true

	paused := h.run(c)
	if paused.State != StateAwaiting || paused.Round != 1 {
		t.Fatalf("after round 1: %s %q at round %d, want awaiting-you at round 1", paused.State, paused.Error, paused.Round)
	}
	if paused.Snapshot != "snap123" {
		t.Errorf("snapshot = %q, want the one Start took", paused.Snapshot)
	}
	// every result is in front of the person at the pause, and the tree is gone by then
	if !reflect.DeepEqual(trees.events, []string{"make", "remove"}) || !reflect.DeepEqual(trees.makes, []treeMake{{proj, "snap123", "council-c1"}}) {
		t.Errorf("tree events %v, makes %+v, want one tree at the snapshot, made and removed", trees.events, trees.makes)
	}
	if n := len(h.f.calls("r2")); n != 0 {
		t.Errorf("%d round 2 calls before the pause ended, want none", n)
	}
	cmds := g.commands()
	slices.Sort(cmds)
	if want := []string{"go test ./pkg/services -run TestCache", "go test ./pkg/services -run TestSleeps", "go test ./pkg/services -run TestWakes"}; !reflect.DeepEqual(cmds, want) {
		t.Errorf("commands run = %q, want %q: the piped one never starts", cmds, want)
	}
	idea := func(author string) CouncilProposal { return proposalOf(t, paused, ideaBy(t, paused, author)) }
	if p := idea("ux"); p.Label != LabelRan || p.Runs[0].State != RunPass || !p.Runs[0].Matched {
		t.Errorf("ux's idea = label %q run %+v, want ran: it passed as expected", p.Label, p.Runs[0])
	}
	if p := idea("ram"); p.Label != LabelDisproved || p.Runs[0].State != RunFail || p.Runs[0].Matched || !strings.Contains(p.Runs[0].Tail, "nobody woke") {
		t.Errorf("ram's idea = label %q run %+v, want disproved: it failed where a pass was expected", p.Label, p.Runs[0])
	}
	if p := idea("skeptic"); p.Label != LabelRan || p.Runs[0].State != RunFail || !p.Runs[0].Matched {
		t.Errorf("skeptic's idea = label %q run %+v, want ran: it failed as expected", p.Label, p.Runs[0])
	}
	if p := idea("newuser"); p.Label != LabelRead || p.Runs[0].State != RunNotRun || !strings.HasPrefix(p.Runs[0].Reason, "not on the list") {
		t.Errorf("newuser's idea = label %q run %+v, want read: its command was never run", p.Label, p.Runs[0])
	}

	// the person cuts ram's idea; round 2 argues over the others' results, in every seat's prompt
	if _, err := h.r.Continue("c1", []string{ideaBy(t, paused, "ram")}, ""); err != nil {
		t.Fatalf("Continue: %v", err)
	}
	done := h.wait("c1")
	if done.State != StateDone {
		t.Fatalf("council = %s %q, want done", done.State, done.Error)
	}
	r2 := h.f.calls("r2")
	if len(r2) != 4 {
		t.Fatalf("%d round 2 calls, want 4", len(r2))
	}
	for _, req := range append(r2, h.f.calls("r3")...) {
		mustContain(t, req.Expert.Id+"'s prompt", req.Prompt,
			"`go test ./pkg/services -run TestSleeps`: passed, as its author expected",
			"`go test ./pkg/services -run TestWakes`: failed (exit 1), as its author expected", "nobody woke",
			"not run (not on the list")
		mustNotContain(t, req.Expert.Id+"'s prompt", req.Prompt, "TestCache")
	}
	if p := proposalOf(t, done, ideaBy(t, done, "ram")); p.Runs[0].State != RunFail {
		t.Errorf("the cut idea's run = %+v, want its result kept on the record", p.Runs[0])
	}
}

func TestRunnerVerifyOneRoundCouncilReachesTheSynthesis(t *testing.T) {
	h := newHarness(t)
	proj := checkProject(t)
	useSnapshot(t, "snap1", nil)
	g := newVerifyRig(t)
	h.r.Trees = &fakeTrees{dir: "TREE"}
	g.run = func(context.Context, string, []string) (string, int, error) {
		return "ok  \tgithub.com/x/pkg/services\t0.01s\n", 0, nil
	}
	h.f.setText("ux/r1", claimJSON("Sleep first", []map[string]string{cite("pkg/ux.go:3", "")}, askRun("go test ./pkg/services -run TestSleeps", RunPass)))
	c := claimCouncil("c1", proj)
	c.ByAgent, c.Rounds = true, 1
	c.Experts = slices.Insert(c.Experts, 0, CouncilExpert{Id: "witness", Name: "Witness", Agent: "tab-1", Harness: HarnessClaude})

	done := h.run(c)
	if done.State != StateDone || done.Round != 2 {
		t.Fatalf("council = %s %q at round %d, want done after the synthesis in round 2", done.State, done.Error, done.Round)
	}
	if n := len(h.f.calls("r2")) + len(h.agents.calls("r2")); n != 0 {
		t.Errorf("%d reply-pass calls in a 1-round council, want none", n)
	}
	r3 := h.f.calls("r3")
	if len(r3) != 1 {
		t.Fatalf("%d synthesis calls, want 1", len(r3))
	}
	mustContain(t, "synthesis prompt", r3[0].Prompt, "`go test ./pkg/services -run TestSleeps`: passed, as its author expected")
	if p := proposalOf(t, done, ideaBy(t, done, "ux")); p.Label != LabelRan {
		t.Errorf("ux's idea = %q, want ran", p.Label)
	}
}

func TestRunnerChecksNothingInABrainstorm(t *testing.T) {
	h := newHarness(t)
	proj := checkProject(t)
	snaps := useSnapshot(t, "snap", nil)
	g := newVerifyRig(t)
	trees := &fakeTrees{}
	h.r.Trees = trees
	for _, id := range []string{"ux", "ram", "newuser", "skeptic"} {
		// even a model that was not asked for them may send a verify list and quotes
		h.f.setText(id+"/r1", claimJSON("Idea from "+id, []map[string]string{cite("pkg/ux.go:3", "func Sleep()"), cite("pkg/nope.go:1", "")},
			askRun("go test ./pkg/services -run TestIdea", RunPass)))
	}
	c := claimCouncil("c1", proj)
	c.Mode = ModeBrainstorm

	done := h.run(c)
	if done.State != StateDone {
		t.Fatalf("council = %s %q, want done", done.State, done.Error)
	}
	if n := snaps.Load(); n != 0 || done.Snapshot != "" {
		t.Errorf("snapshot taken %d times, kept %q: a Brainstorm has no tree to run anything in", n, done.Snapshot)
	}
	if len(trees.events) != 0 || len(g.commands()) != 0 {
		t.Errorf("tree events %v, commands %q: a Brainstorm runs nothing", trees.events, g.commands())
	}
	for _, p := range done.Proposals {
		if p.Label != "" || len(p.Runs) != 0 {
			t.Errorf("idea %s = label %q runs %+v, want neither in a Brainstorm", p.Id, p.Label, p.Runs)
		}
		for _, e := range p.Evidence {
			if e.Cite != "" || e.CiteNote != "" {
				t.Errorf("idea %s evidence %+v was checked, want it left alone", p.Id, e)
			}
		}
	}
	for _, x := range done.Replies {
		if x.Label != "" {
			t.Errorf("reply %s has label %q in a Brainstorm", x.Id, x.Label)
		}
	}
}

func TestRunnerVerifyStopMidVerifyRemovesTheTree(t *testing.T) {
	h := newHarness(t)
	proj := checkProject(t)
	useSnapshot(t, "snap", nil)
	g := newVerifyRig(t)
	trees := &fakeTrees{dir: "TREE"}
	h.r.Trees = trees
	started := make(chan struct{})
	var once sync.Once
	g.run = func(ctx context.Context, _ string, _ []string) (string, int, error) {
		once.Do(func() { close(started) })
		<-ctx.Done()
		return "", 0, ctx.Err()
	}
	const cmd = "go test ./pkg/services -run TestSleeps"
	h.f.setText("ux/r1", claimJSON("Sleep first", []map[string]string{cite("pkg/ux.go:3", "")}, askRun(cmd, RunPass)))
	h.start(claimCouncil("c1", proj))
	select {
	case <-started:
	case <-time.After(10 * time.Second):
		t.Fatal("the verify command never started")
	}

	// while it runs, ux's card shows the command and its timeline has the row without a result
	mid := h.load("c1")
	if act := mid.Activity["ux"]; act.Text != cmd {
		t.Errorf("ux's activity while its command runs = %q, want the command", act.Text)
	}
	var open []CouncilStep
	for _, s := range mid.Timeline["ux"] {
		if s.Kind == StepRun {
			open = append(open, s)
		}
	}
	if len(open) != 1 || open[0].Target != cmd || open[0].Result != "" {
		t.Errorf("run rows while it runs = %+v, want one for the command with no result yet", open)
	}

	stopped, err := h.r.Stop("c1")
	if err != nil {
		t.Fatalf("Stop: %v", err)
	}
	if stopped.State != StateStopped || len(stopped.Activity) != 0 {
		t.Errorf("after Stop: %s with activity %v, want stopped and nothing showing", stopped.State, stopped.Activity)
	}
	trees.mu.Lock()
	removed, ctxErrs := slices.Clone(trees.removed), slices.Clone(trees.removeCtxErr)
	trees.mu.Unlock()
	if !reflect.DeepEqual(removed, []string{"TREE"}) || len(ctxErrs) != 1 || ctxErrs[0] != nil {
		t.Errorf("tree removed %v (ctx errors %v), want it removed once, by a context that Stop had not ended", removed, ctxErrs)
	}
	if p := proposalOf(t, stopped, ideaBy(t, stopped, "ux")); p.Runs[0].State != "" {
		t.Errorf("the cut-off command = %+v, want it left as a request", p.Runs[0])
	}
}

func TestRunnerVerifyActivityShowsTheCommandThatRuns(t *testing.T) {
	h := newHarness(t)
	proj := checkProject(t)
	useSnapshot(t, "snap", nil)
	g := newVerifyRig(t)
	h.r.Trees = &fakeTrees{dir: "TREE"}
	inSecond, release := make(chan struct{}), make(chan struct{})
	g.run = func(ctx context.Context, _ string, argv []string) (string, int, error) {
		if strings.HasSuffix(argv[len(argv)-1], "TestSecond") {
			close(inSecond)
			select {
			case <-release:
			case <-ctx.Done():
				return "", 0, ctx.Err()
			}
		}
		return "ok  \tgithub.com/x/pkg/services\t0.01s\n", 0, nil
	}
	first, second := "go test ./pkg/services -run TestFirst", "go test ./pkg/services -run TestSecond"
	h.f.setText("ux/r1", claimJSON("Sleep first", []map[string]string{cite("pkg/ux.go:3", "")}, askRun(first, RunPass), askRun(second, RunPass)))
	h.start(claimCouncil("c1", proj))
	select {
	case <-inSecond:
	case <-time.After(10 * time.Second):
		t.Fatal("the second command never started")
	}
	mid := h.load("c1")
	if act := mid.Activity["ux"]; act.Text != second {
		t.Errorf("activity while the second runs = %q, want %q", act.Text, second)
	}
	var runs []CouncilStep
	for _, s := range mid.Timeline["ux"] {
		if s.Kind == StepRun {
			runs = append(runs, s)
		}
	}
	if len(runs) != 2 || runs[0].Target != first || runs[0].Result != RunPass || runs[1].Target != second || runs[1].Result != "" {
		t.Errorf("run rows = %+v, want the first with its result and the second open: a result replaces its row, never adds one", runs)
	}
	close(release)
	done := h.wait("c1")
	runs = nil
	for _, s := range done.Timeline["ux"] {
		if s.Kind == StepRun {
			runs = append(runs, s)
		}
	}
	if len(runs) != 2 || runs[1].Result != RunPass {
		t.Errorf("run rows at the end = %+v, want two, both with their result", runs)
	}
	// between the two commands the card showed nothing: the first one's line was cleared when it ended
	h.mu.Lock()
	defer h.mu.Unlock()
	cleared := false
	for _, ev := range h.seen {
		n, passed := 0, false
		for _, s := range ev.Timeline["ux"] {
			if s.Kind == StepRun {
				n++
				passed = s.Result == RunPass
			}
		}
		if _, showing := ev.Activity["ux"]; n == 1 && passed && !showing {
			cleared = true
		}
	}
	if !cleared {
		t.Errorf("no saved state shows the first command done with its line cleared")
	}
}

func TestRunnerVerifyRunsAHeldIdeasRequestsOnceItIsSent(t *testing.T) {
	h := newHarness(t)
	proj := checkProject(t)
	useSnapshot(t, "snap9", nil)
	g := newVerifyRig(t)
	trees := &fakeTrees{dir: "TREE"}
	h.r.Trees = trees
	g.run = func(context.Context, string, []string) (string, int, error) {
		return "ok  \tgithub.com/x/pkg/services\t0.01s\n", 0, nil
	}
	h.f.setText("ux/r1", claimJSON("Sleep first", []map[string]string{cite("pkg/ux.go:3", "func Sleep()")}, askRun("go test ./pkg/services -run TestSleeps", RunPass)))
	h.f.setFn("ux/r2", agreeOnly)
	h.agents.setFn("witness/r2", agreeOnly)
	c := agentCouncil("a")
	c.Project = proj

	held := h.run(c)
	if held.State != StateAwaiting {
		t.Fatalf("council = %s %q, want awaiting-you with held ideas", held.State, held.Error)
	}
	ux := ideaBy(t, held, "ux")
	if p := proposalOf(t, held, ux); p.Label != "" || p.Runs[0].State != "" || p.Evidence[0].Cite != "" {
		t.Errorf("a held idea = label %q run %+v cite %q, want it neither labelled nor run before the person sends it", p.Label, p.Runs[0], p.Evidence[0].Cite)
	}
	if len(g.commands()) != 0 || len(trees.events) != 0 {
		t.Errorf("commands %q, tree events %v while the idea was held, want none", g.commands(), trees.events)
	}

	sent, err := h.r.Draft("a", ux, "send", "")
	if err != nil {
		t.Fatalf("Draft: %v", err)
	}
	if p := proposalOf(t, sent, ux); p.Label != LabelRead || p.Evidence[0].Cite != CiteOK {
		t.Errorf("the idea once sent = label %q cite %q, want read at once", p.Label, p.Evidence[0].Cite)
	}

	h.settle("a") // the last draft starts round 2, which runs what the sent idea asked for first
	done := h.wait("a")
	if done.State != StateDone {
		t.Fatalf("council = %s %q, want done", done.State, done.Error)
	}
	if p := proposalOf(t, done, ux); p.Runs[0].State != RunPass || p.Label != LabelRan {
		t.Errorf("the idea after round 2 started = label %q run %+v, want its command run and the idea ran", p.Label, p.Runs[0])
	}
	for _, req := range h.f.calls("r2") {
		mustContain(t, req.Expert.Id+"'s round 2 prompt", req.Prompt, "`go test ./pkg/services -run TestSleeps`: passed, as its author expected")
	}
}

func TestRunnerChecksAndRunsTheIdeaOfARetriedSeat(t *testing.T) {
	h := newHarness(t)
	proj := checkProject(t)
	useSnapshot(t, "snap", nil)
	g := newVerifyRig(t)
	h.r.Trees = &fakeTrees{dir: "TREE"}
	g.run = func(context.Context, string, []string) (string, int, error) {
		return "ok  \tgithub.com/x/pkg/services\t0.01s\n", 0, nil
	}
	h.f.setFail("ux/r1", errors.New("offline"))
	c := claimCouncil("c1", proj)
	c.PauseAfterRound1 = true
	paused := h.run(c)
	if _, failed := paused.Failed["ux"]; !failed {
		t.Fatalf("failed = %v, want ux's round 1 call failed", paused.Failed)
	}

	h.f.setFail("ux/r1", nil)
	h.f.setText("ux/r1", claimJSON("Sleep first", []map[string]string{cite("pkg/ux.go:3", "func Sleep()")}, askRun("go test ./pkg/services -run TestSleeps", RunPass)))
	if _, err := h.r.Retry("c1", "ux"); err != nil {
		t.Fatalf("Retry: %v", err)
	}
	got := h.wait("c1")
	p := proposalOf(t, got, ideaBy(t, got, "ux"))
	if p.Label != LabelRan || p.Runs[0].State != RunPass || p.Evidence[0].Cite != CiteOK {
		t.Errorf("the retried idea = label %q run %+v cite %q, want checked, run and labelled", p.Label, p.Runs[0], p.Evidence[0].Cite)
	}
}

func TestRunnerTimelineRecordsToolsIdeasRepliesAndRuns(t *testing.T) {
	h := newHarness(t)
	proj := checkProject(t)
	useSnapshot(t, "snap", nil)
	g := newVerifyRig(t)
	h.r.Trees = &fakeTrees{dir: "TREE"}
	g.run = func(context.Context, string, []string) (string, int, error) {
		return "ok  \tgithub.com/x/pkg/services\t0.01s\n", 0, nil
	}
	h.f.setText("ux/r1", claimJSON("Sleep first", []map[string]string{cite("pkg/ux.go:3", "")}, askRun("go test ./pkg/services -run TestSleeps", RunPass)))
	h.f.setTools("ux/r1", "Read idle.go", `Grep "IdleSleep" in pkg/services`, "Glob **/*.go", "WebSearch hello", "  ")
	done := h.run(claimCouncil("c1", proj))
	if done.State != StateDone {
		t.Fatalf("council = %s %q, want done", done.State, done.Error)
	}

	type row struct{ kind, target, result string }
	var got []row
	for _, s := range done.Timeline["ux"] {
		if s.Ts == 0 {
			t.Errorf("row %+v has no time", s)
		}
		got = append(got, row{s.Kind, s.Target, s.Result})
	}
	want := []row{
		{StepRead, "idle.go", ""},
		{StepSearch, `"IdleSleep" in pkg/services`, ""},
		{StepSearch, "**/*.go", ""},
		{"WebSearch", "hello", ""}, // a tool it does not know keeps its own first word
		{StepPropose, "Sleep first", ""},
		{StepRun, "go test ./pkg/services -run TestSleeps", RunPass}, // one row: the result replaced the opening row
	}
	if len(got) < len(want) || !reflect.DeepEqual(got[:len(want)], want) {
		t.Fatalf("ux's timeline = %+v, want it to begin %+v (a blank tool line adds no row)", got, want)
	}
	replies := 0
	for _, r := range got[len(want):] {
		if r.kind != StepReply || !strings.HasPrefix(r.target, "P") {
			t.Errorf("row %+v after the run, want a reply naming the idea it answers", r)
		}
		replies++
	}
	if replies != 3 {
		t.Errorf("%d reply rows, want 3: one per idea ux reviewed", replies)
	}
	// the other experts have a row for their idea and for each reply, and none for tools they were not shown using
	if rows := done.Timeline["ram"]; len(rows) != 4 || rows[0].Kind != StepPropose || rows[1].Kind != StepReply {
		t.Errorf("ram's timeline = %+v, want its idea then its three replies", rows)
	}
	if rows := done.Timeline["lead"]; len(rows) != 0 {
		t.Errorf("the coordinator's timeline = %+v, want none: its summary is not an idea or a reply", rows)
	}
}

func TestRunnerTimelineCapsAtTwoHundredRows(t *testing.T) {
	h := newHarness(t)
	var tools []string
	for i := range 250 {
		tools = append(tools, fmt.Sprintf("Read f%d.go", i))
	}
	h.f.setTools("ux/r1", tools...)
	done := h.run(testCouncil("c1"))
	rows := done.Timeline["ux"]
	if len(rows) != MaxTimelineSteps {
		t.Fatalf("%d rows, want the cap of %d", len(rows), MaxTimelineSteps)
	}
	// 250 reads, the idea and 3 replies were recorded: the oldest 54 are gone
	if rows[0].Kind != StepRead || rows[0].Target != "f54.go" {
		t.Errorf("oldest row = %+v, want the 55th read: the oldest went first", rows[0])
	}
	if last := rows[len(rows)-1]; last.Kind != StepReply {
		t.Errorf("newest row = %+v, want the last reply", last)
	}
	for i := 1; i < len(rows); i++ {
		if rows[i].Ts < rows[i-1].Ts {
			t.Errorf("row %d is older than the one before it: %d < %d", i, rows[i].Ts, rows[i-1].Ts)
			break
		}
	}
}

func TestRunnerTimelineOfAnAgentSeatComesFromItsActivity(t *testing.T) {
	h := newHarness(t)
	h.agents.setTools("witness/r1", "reading seat.go", "Waiting for Witness to finish its task", "Task")
	held := h.run(agentCouncil("a"))
	type row struct{ kind, target string }
	var got []row
	for _, s := range held.Timeline["witness"] {
		got = append(got, row{s.Kind, s.Target})
	}
	want := []row{
		{"reading", "seat.go"}, // the roster's words: the kind is the first word, kept as it came
		{"Waiting", "for Witness to finish its task"},
		{"Task", ""}, // a bare tool name
		{StepPropose, "Title from witness"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("Witness's timeline = %+v, want %+v", got, want)
	}
}

func TestStartLangNamesTheSeatsForTheQuestion(t *testing.T) {
	experts := func() []CouncilExpert {
		return []CouncilExpert{
			{Id: "ux", Name: "UX", Brief: "b", Model: "sonnet"},
			{Id: "skeptic", Name: "Skeptic", Brief: "b", Model: "sonnet"},
			{Id: "mac-user", Name: "Mac user", Brief: "b", Model: "sonnet"},
			{Id: "ram", Name: "Watch the heap", Brief: "b", Model: "sonnet"},
			{Id: "coordinator", Name: "Coordinator", Brief: "b", Model: "opus", Coordinator: true},
		}
	}
	cases := []struct {
		what, feature, question, lang string
		names                         []string
	}{
		{"a Vietnamese question", "Idle sleep", "Nên làm gì trước?", LangVi,
			[]string{"UX", "Tìm bug", "Mac user", "Watch the heap", "Thư ký"}},
		{"an English question", "Idle sleep", "Which first?", LangEn,
			[]string{"Ease of use", "Bug hunter", "Mac user", "Watch the heap", "Summarizer"}},
		{"no question, a Vietnamese feature", "Chế độ ngủ của dịch vụ", "  ", LangVi,
			[]string{"UX", "Tìm bug", "Mac user", "Watch the heap", "Thư ký"}},
		{"an English question about a Vietnamese feature", "Chế độ ngủ", "Which first?", LangEn,
			[]string{"Ease of use", "Bug hunter", "Mac user", "Watch the heap", "Summarizer"}},
	}
	for _, tc := range cases {
		t.Run(tc.what, func(t *testing.T) {
			h := newHarness(t)
			c := testCouncil("c1")
			c.Feature, c.Question, c.Experts = tc.feature, tc.question, experts()
			saved := h.start(c)
			if saved.Lang != tc.lang {
				t.Errorf("Start returned lang %q, want %q", saved.Lang, tc.lang)
			}
			var names []string
			for _, e := range saved.Experts {
				names = append(names, e.Name)
			}
			if !reflect.DeepEqual(names, tc.names) {
				t.Errorf("seat names = %q, want %q", names, tc.names)
			}
			done := h.wait("c1")
			if done.Lang != tc.lang || done.Experts[1].Name != tc.names[1] {
				t.Errorf("saved council = lang %q, second seat %q, want %q and %q", done.Lang, done.Experts[1].Name, tc.lang, tc.names[1])
			}
			// the calls name each seat the way the council shows it
			byId := map[string]string{}
			for _, e := range done.Experts {
				byId[e.Id] = e.Name
			}
			r1 := h.f.calls("r1")
			if len(r1) == 0 {
				t.Fatalf("no round 1 call was made")
			}
			for _, req := range r1 {
				if req.Expert.Name != byId[req.Expert.Id] || !strings.Contains(req.Prompt, req.Expert.Name) {
					t.Errorf("round 1 call for %s names the seat %q, want %q", req.Expert.Id, req.Expert.Name, byId[req.Expert.Id])
				}
			}
		})
	}
}

func TestStartLangNamesTheSeatsOfASavedCouncilWhenItStarts(t *testing.T) {
	h := newHarness(t)
	c := testCouncil("c1")
	c.Question = "Nên làm gì trước?"
	rec, err := h.r.Record(c)
	if err != nil {
		t.Fatalf("Record: %v", err)
	}
	if rec.Lang != "" || rec.Experts[0].Name != "UX" {
		t.Errorf("a recorded council = lang %q, first seat %q, want it as it was sent: nothing has started", rec.Lang, rec.Experts[0].Name)
	}
	started, err := h.r.StartSaved(context.Background(), "c1")
	if err != nil {
		t.Fatalf("StartSaved: %v", err)
	}
	if started.Lang != LangVi || started.Experts[0].Name != "UX" || started.Experts[3].Name != "Tìm bug" {
		t.Errorf("a started council = lang %q, seats %q and %q, want Vietnamese", started.Lang, started.Experts[0].Name, started.Experts[3].Name)
	}
	h.wait("c1")
}

func TestStartLangSuggestAsksForRoleNamesInTheQuestionsLanguage(t *testing.T) {
	h := newHarness(t)
	project := t.TempDir()
	h.f.setText("suggest/suggest", fence(`{"files": [], "roles": []}`))
	ask := func(question string) string {
		t.Helper()
		if _, err := h.r.Suggest(context.Background(), project, "Idle sleep", question, nil); err != nil {
			t.Fatalf("Suggest: %v", err)
		}
		reqs := h.f.calls("suggest")
		return reqs[len(reqs)-1].Prompt
	}
	mustContain(t, "a Vietnamese question's prompt", ask("Nên làm gì trước?"), LangLine(LangVi))
	mustNotContain(t, "an English question's prompt", ask("Which first?"), LangLine(LangVi), "Tìm bug")
	// with no question the feature decides
	if _, err := h.r.Suggest(context.Background(), project, "Chế độ ngủ", "", nil); err != nil {
		t.Fatalf("Suggest: %v", err)
	}
	reqs := h.f.calls("suggest")
	mustContain(t, "a Vietnamese feature's prompt", reqs[len(reqs)-1].Prompt, LangLine(LangVi))
}

func TestStartSnapshotIsTakenOnceBesideRound1ForAReview(t *testing.T) {
	h := newHarness(t)
	var calls atomic.Int32
	var seen atomic.Value
	release := make(chan struct{})
	takeSnapshot = func(ctx context.Context, project string) (string, error) {
		calls.Add(1)
		seen.Store(project)
		select {
		case <-release:
		case <-ctx.Done():
			return "", ctx.Err()
		}
		return "abc123", nil
	}
	proj := checkProject(t)
	h.start(claimCouncil("c1", proj))
	// a snapshot that is slow to hash the tree does not hold round 1 back: all four experts are called while it is held
	waitFor(t, "round 1's four calls", func() bool { return len(h.f.calls("r1")) == 4 })
	if got := h.load("c1"); got.Snapshot != "" {
		t.Errorf("snapshot %q kept before the snapshot ended", got.Snapshot)
	}
	close(release)
	done := h.wait("c1")
	if project, _ := seen.Load().(string); calls.Load() != 1 || project != proj || done.State != StateDone || done.Snapshot != "abc123" {
		t.Errorf("snapshot taken %d times of %q, kept %q, council %s; want once, of the project, kept", calls.Load(), project, done.Snapshot, done.State)
	}

	// a failing snapshot is no reason to fail the council: it runs, and no command will
	takeSnapshot = func(context.Context, string) (string, error) { return "", errors.New("git is not installed") }
	done = h.run(claimCouncil("c2", proj))
	if done.State != StateDone || done.Snapshot != "" {
		t.Errorf("council = %s %q snapshot %q, want done with no snapshot", done.State, done.Error, done.Snapshot)
	}
}

func TestStartSnapshotHoldsTheUncommittedWorkAndLeavesTheCheckoutAlone(t *testing.T) {
	h := newHarness(t)
	takeSnapshot = Snapshot
	repo := snapshotRepo(t)
	vWriteFile(t, repo+"/a.txt", "two\n")
	vWriteFile(t, repo+"/b.txt", "new\n")
	status := testGit(t, repo, "status", "--porcelain=v1", "-uall")
	head := strings.TrimSpace(testGit(t, repo, "rev-parse", "HEAD"))

	done := h.run(claimCouncil("c1", repo))
	if done.State != StateDone || done.Snapshot == "" || done.Snapshot == head {
		t.Fatalf("council = %s %q snapshot %q (HEAD %s), want done with a snapshot of its own", done.State, done.Error, done.Snapshot, head)
	}
	if got := testGit(t, repo, "show", done.Snapshot+":a.txt"); got != "two\n" {
		t.Errorf("a.txt in the snapshot = %q, want the uncommitted edit", got)
	}
	if got := testGit(t, repo, "show", done.Snapshot+":b.txt"); got != "new\n" {
		t.Errorf("b.txt in the snapshot = %q, want the untracked file", got)
	}
	// the checkout is as it was, bar the council's own document, which a finished council writes into its project
	var after []string
	for _, line := range strings.SplitAfter(testGit(t, repo, "status", "--porcelain=v1", "-uall"), "\n") {
		if !strings.Contains(line, "docs/council/") {
			after = append(after, line)
		}
	}
	if got := strings.Join(after, ""); got != status {
		t.Errorf("git status changed:\nbefore %q\nafter  %q", status, got)
	}

	// a project that is not a repo has none
	plain := t.TempDir()
	t.Setenv("GIT_CEILING_DIRECTORIES", filepath.Dir(plain))
	if got := h.run(claimCouncil("c2", plain)); got.State != StateDone || got.Snapshot != "" {
		t.Errorf("a council in a plain folder = %s snapshot %q, want done with none", got.State, got.Snapshot)
	}
}

// ---- the direction memory's checks ----

var roundCheckIdRe = regexp.MustCompile(`(?m)^- \[(\w+)\]`)

// roundsMessages are the ids the round check's prompt lists as what the seats said this round.
func roundsMessages(req CallReq) []string {
	return idsIn(roundCheckIdRe, sectionText(req.Prompt, "## What the seats said this round, oldest first"))
}

// suggestRoundCheck makes the fake's round check suggest text, citing the first message it was shown.
func suggestRoundCheck(h *harness, text string) {
	h.f.setFn("check/roundcheck", func(req CallReq) string {
		ids := roundsMessages(req)
		return mustJSON(map[string]any{"change": true, "direction": text, "reason": "The seats moved.", "messages": ids[:min(1, len(ids))]})
	})
}

// acceptAll makes every seat accept every idea of the others in its reply pass: each idea turns all green.
func acceptAll(h *harness) {
	for _, seat := range panelIds() {
		h.f.setFn(seat+"/r2", func(req CallReq) string {
			stances := []map[string]any{}
			for _, pid := range idsIn(proposalHeadRe, sectionText(req.Prompt, "## Proposals to review")) {
				stances = append(stances, map[string]any{"proposalid": pid, "stance": "accept", "reason": "Yes on " + pid})
			}
			return fence(mustJSON(map[string]any{"stances": stances, "revisions": []any{}, "answers": []any{}, "picks": []string{}}))
		})
	}
}

// checkSuggestion is the round check's waiting suggestion; nil when none waits or the one that waits is all green's. The
// fake's reply pass has every seat accept the first idea it reviews, so in a default run P1 is all green: a run's
// Memory is not nil just because its round check changed nothing.
func checkSuggestion(c *Council) *CouncilMemoryCard {
	if c.Memory != nil && c.Memory.Suggestion != nil && c.Memory.Suggestion.Source == SourceCheck {
		return c.Memory.Suggestion
	}
	return nil
}

// makeGreen has every panel seat but the author of idea take the latest stance accept on it.
func makeGreen(c *Council, idea string) {
	author := findProposal(c, idea).Author
	for i, e := range panelOf(c) {
		if e.Id != author {
			c.Replies = append(c.Replies, CouncilReply{Id: nextReplyId(c), ProposalId: idea, Author: e.Id, Stance: StanceAccept, Text: "Yes", Round: 2, Ts: int64(1000 + i)})
		}
	}
}

// TestRoundCheckRunsAfterAReplyPass: one no-tools haiku call after the reply pass, before the synthesis, that reads what
// the pass added; its suggestion waits on the council with the round it follows, and its tokens are in the totals.
func TestRoundCheckRunsAfterAReplyPass(t *testing.T) {
	h := newHarness(t)
	suggestRoundCheck(h, "Show the sleep state first")
	c := h.run(testCouncil("c1"))

	checks := h.f.calls("roundcheck")
	if len(checks) != 1 {
		t.Fatalf("%d round checks, want one for the one reply pass", len(checks))
	}
	if req := checks[0]; req.Tools || req.Expert.Model != ModelRouter || req.Cwd != `D:\proj` || req.Expert.Id != "check" {
		t.Errorf("round check = tools %v model %q cwd %q seat %q, want no tools on haiku in the project", req.Tools, req.Expert.Model, req.Cwd, req.Expert.Id)
	}
	mustContain(t, "the round check's prompt", checks[0].Prompt, "Reason from", "(none chosen yet)") // the pass's replies, no direction yet
	if at, r2, r3 := h.f.indexes("roundcheck")[0], h.f.indexes("r2"), h.f.indexes("r3"); at < r2[len(r2)-1] || at > r3[0] {
		t.Errorf("the round check ran at call %d, want after the last reply (%d) and before the synthesis (%d)", at, r2[len(r2)-1], r3[0])
	}
	if c.Memory == nil || c.Memory.Suggestion == nil {
		t.Fatalf("memory = %+v, want the round check's suggestion waiting", c.Memory)
	}
	s := c.Memory.Suggestion
	shown := roundsMessages(checks[0])
	if s.Text != "Show the sleep state first" || s.Reason != "The seats moved." || s.Source != SourceCheck || s.Round != 2 || s.Kind != CardSuggestion ||
		len(s.Messages) != 1 || s.Messages[0] != shown[0] || s.At == 0 {
		t.Errorf("suggestion = %+v, want the check's text, reason and the first message %v, after round 2", s, shown)
	}
	if c.Memory.Chosen != nil || c.Memory.Held != nil {
		t.Errorf("chosen %+v held %+v, want a suggestion alone: it needs the person to accept", c.Memory.Chosen, c.Memory.Held)
	}
	// 4 ideas, 4 replies, the round check, the synthesis: the check's call and tokens are the council's, no seat's
	if c.Calls != 10 || c.Tokens != 4*callTokens["r1"]+4*callTokens["r2"]+callTokens["roundcheck"]+callTokens["r3"] {
		t.Errorf("calls %d tokens %d, want the check counted in both", c.Calls, c.Tokens)
	}
	if _, ok := c.Stats["check"]; ok {
		t.Errorf("Stats has a check entry %+v, want none: it is no seat", c.Stats["check"])
	}
}

// TestRoundCheckNoChangeRaisesNothing: "no change" raises nothing of the check's own and sets no direction. What waits is
// all green's P1 alone (every seat accepts the first idea it reviews).
func TestRoundCheckNoChangeRaisesNothing(t *testing.T) {
	h := newHarness(t)
	c := h.run(testCouncil("c1"))
	if len(h.f.calls("roundcheck")) != 1 || checkSuggestion(c) != nil {
		t.Errorf("%d round checks, suggestion %+v, want one check and none from it", len(h.f.calls("roundcheck")), checkSuggestion(c))
	}
	if s := c.Memory.Suggestion; s == nil || s.Source != SourceGreen || s.From != "P1" || c.Memory.Chosen != nil || c.Memory.Held != nil {
		t.Errorf("memory = %+v, want all green's P1 waiting and nothing chosen or held", c.Memory)
	}
}

// TestRoundCheckThatFailsIsLoggedRaisesNothingAndNeverFailsTheRound: an error, a reply that is no answer and a timeout
// each leave a done council with no suggestion; what the call spent is booked; the failure is logged.
func TestRoundCheckThatFailsIsLoggedRaisesNothingAndNeverFailsTheRound(t *testing.T) {
	for name, tc := range map[string]struct {
		set     func(f *fakeCaller)
		tokens  int64
		logged  string
		timeout time.Duration
	}{
		"an error":   {func(f *fakeCaller) { f.setFail("check/roundcheck", errors.New("claude is not signed in")) }, 0, "claude is not signed in", time.Minute},
		"no JSON":    {func(f *fakeCaller) { f.setText("check/roundcheck", "Nothing changed.") }, callTokens["roundcheck"], "no JSON", time.Minute},
		"no answer":  {func(f *fakeCaller) { f.setText("check/roundcheck", `{"change": true}`) }, callTokens["roundcheck"], "suggests no direction", time.Minute},
		"a hung one": {func(f *fakeCaller) { f.gate("check/roundcheck") }, 0, "deadline", 50 * time.Millisecond},
	} {
		t.Run(name, func(t *testing.T) {
			var logs bytes.Buffer
			log.SetOutput(&logs)
			t.Cleanup(func() { log.SetOutput(os.Stderr) })
			prev := checkTimeout
			checkTimeout = tc.timeout
			t.Cleanup(func() { checkTimeout = prev })
			h := newHarness(t)
			tc.set(h.f)
			c := h.run(testCouncil("c1"))
			if c.State != StateDone || c.Error != "" || c.Summary == nil || len(c.Failed) != 0 {
				t.Fatalf("council = %s %q failed %v, want a done council: a failed round check never fails the round", c.State, c.Error, c.Failed)
			}
			if s := checkSuggestion(c); s != nil {
				t.Errorf("suggestion = %+v, want none from a check that did not answer", s)
			}
			if c.Calls != 10 || c.Tokens != 4*callTokens["r1"]+4*callTokens["r2"]+tc.tokens+callTokens["r3"] {
				t.Errorf("calls %d tokens %d, want the check's call booked with %d tokens", c.Calls, c.Tokens, tc.tokens)
			}
			if got := logs.String(); !strings.Contains(got, "round check failed") || !strings.Contains(got, tc.logged) {
				t.Errorf("log = %q, want a round check failed line holding %q", got, tc.logged)
			}
		})
	}
}

// TestRoundCheckRunsAfterAnAnswerBatch: the post-Report chat is the main case. One seat's answer is one batch, so one
// check, which reads that answer; its call and tokens are the council's.
func TestRoundCheckRunsAfterAnAnswerBatch(t *testing.T) {
	h := newHarness(t)
	done := h.run(testCouncil("c1"))
	suggestRoundCheck(h, "Ask the RAM seat first")
	if _, err := h.r.Reply("c1", "", "", "@RAM "+wholeAsk, false, nil); err != nil {
		t.Fatalf("Reply: %v", err)
	}
	c := h.wait("c1")

	checks := h.f.calls("roundcheck")
	if len(checks) != 2 {
		t.Fatalf("%d round checks, want the reply pass's and the one batch's", len(checks))
	}
	mustContain(t, "the batch's round check", checks[1].Prompt, "Answer from ram")
	// the reply pass's replies are not this round's: they are in the context section, if anywhere
	mustNotContain(t, "the batch's round check", sectionText(checks[1].Prompt, "## What the seats said this round, oldest first"), "Reason from")
	if c.Calls != done.Calls+2 || c.Tokens != done.Tokens+callTokens["ans"]+callTokens["roundcheck"] {
		t.Errorf("calls %d tokens %d, want %d and %d: the one answer and its round check", c.Calls, c.Tokens, done.Calls+2, done.Tokens+callTokens["ans"]+callTokens["roundcheck"])
	}
	// the round is the batch's own: the answers it read carry Round 4, the first follow-up round
	if s := c.Memory.Suggestion; s == nil || s.Text != "Ask the RAM seat first" || s.Source != SourceCheck || s.Round != FirstFollowRound(c) ||
		s.Round != replyOf(t, c, "r14").Round {
		t.Errorf("suggestion = %+v, want the batch's, after round %d like the answer it read", s, FirstFollowRound(c))
	}
	if c.State != StateDone {
		t.Errorf("state = %s, want done as it was", c.State)
	}
}

// TestRoundCheckSkipsAPassThatAddedNothing: a seat that fails to answer leaves nothing sent to read, so no call is made.
func TestRoundCheckSkipsAPassThatAddedNothing(t *testing.T) {
	h := newHarness(t)
	done := h.run(testCouncil("c1"))
	h.f.setFail("ram/ans", errors.New("boom"))
	if _, err := h.r.Reply("c1", "", "", "@RAM "+wholeAsk, false, nil); err != nil {
		t.Fatalf("Reply: %v", err)
	}
	c := h.wait("c1")
	if n := len(h.f.calls("roundcheck")); n != 1 {
		t.Errorf("%d round checks, want only the reply pass's: an answer that failed leaves nothing to read", n)
	}
	if c.Calls != done.Calls+1 {
		t.Errorf("calls %d, want %d: the failed answer alone", c.Calls, done.Calls+1)
	}
}

// TestRoundCheckADismissedSuggestionIsNotRaisedAgain: the person turns a suggestion away; the same words from the next
// round's check, in another case and spacing, wait on nothing.
func TestRoundCheckADismissedSuggestionIsNotRaisedAgain(t *testing.T) {
	h := newHarness(t)
	suggestRoundCheck(h, "Show the sleep state first")
	c := h.run(testCouncil("c1"))
	if c.Memory == nil || c.Memory.Suggestion == nil {
		t.Fatalf("memory = %+v, want the first suggestion", c.Memory)
	}
	if _, err := h.r.Direction("c1", DirectionIn{Action: ActionDismiss}); err != nil {
		t.Fatalf("dismiss: %v", err)
	}
	suggestRoundCheck(h, "  show the SLEEP state   first ")
	if _, err := h.r.Reply("c1", "", "", "@RAM "+wholeAsk, false, nil); err != nil {
		t.Fatalf("Reply: %v", err)
	}
	c = h.wait("c1")
	if len(h.f.calls("roundcheck")) != 2 {
		t.Fatalf("%d round checks, want the second to have run", len(h.f.calls("roundcheck")))
	}
	if s := checkSuggestion(c); s != nil || len(c.Memory.Dismissed) != 1 {
		t.Errorf("suggestion %+v dismissed %v, want none from the check and the one key kept", s, c.Memory.Dismissed)
	}
	// a different suggestion is raised as usual
	suggestRoundCheck(h, "Poll less")
	if _, err := h.r.Reply("c1", "", "", "@RAM and more", false, nil); err != nil {
		t.Fatalf("Reply: %v", err)
	}
	if c = h.wait("c1"); checkSuggestion(c) == nil || checkSuggestion(c).Text != "Poll less" {
		t.Errorf("suggestion = %+v, want the new one", c.Memory.Suggestion)
	}
}

// TestRoundCheckASuggestionThatSaysWhatIsChosenIsNotRaised: a check that suggests the direction already in force raises
// nothing.
func TestRoundCheckASuggestionThatSaysWhatIsChosenIsNotRaised(t *testing.T) {
	h := newHarness(t)
	done := h.run(testCouncil("c1"))
	c := h.load("c1")
	MemoryOf(c).Choose(CouncilMemoryDirection{Text: "Poll less", How: DirectionWritten}, "", 5)
	h.save(c)
	suggestRoundCheck(h, "poll LESS")
	if _, err := h.r.Reply("c1", "", "", "@RAM "+wholeAsk, false, nil); err != nil {
		t.Fatalf("Reply: %v", err)
	}
	got := h.wait("c1")
	mustContain(t, "the round check's prompt", h.f.calls("roundcheck")[1].Prompt, "Poll less")
	if s := checkSuggestion(got); s != nil || got.Calls != done.Calls+2 {
		t.Errorf("suggestion %+v calls %d, want none raised by the check and its call still booked", s, got.Calls)
	}
	if got.Memory.Chosen == nil || got.Memory.Chosen.Text != "Poll less" {
		t.Errorf("chosen = %+v, want the direction as it was", got.Memory.Chosen)
	}
}

// TestAllGreenIsRaisedAfterAReplyPassWithNoModelCall: every seat accepts every idea of the others, so the first idea is
// raised as an all-green suggestion even though the round check fails: it needs no model call.
func TestAllGreenIsRaisedAfterAReplyPassWithNoModelCall(t *testing.T) {
	h := newHarness(t)
	acceptAll(h)
	h.f.setFail("check/roundcheck", errors.New("down"))
	c := h.run(testCouncil("c1"))
	if c.Memory == nil || c.Memory.Suggestion == nil {
		t.Fatalf("memory = %+v, want the all-green suggestion", c.Memory)
	}
	s := c.Memory.Suggestion
	p1 := proposalOf(t, c, "P1")
	if s.Source != SourceGreen || s.From != "P1" || s.Text != p1.Title || s.Round != 2 || s.Kind != CardSuggestion || len(s.Messages) != 0 {
		t.Errorf("suggestion = %+v, want P1's title as an all-green suggestion after round 2", s)
	}
	if n := len(h.f.calls("precheck")); n != 0 {
		t.Errorf("%d pre-set checks, want none: all green needs no check", n)
	}
	if c.State != StateDone {
		t.Errorf("state = %s, want done", c.State)
	}
}

// TestAllGreenThenTheRoundChecksSuggestionIsTheOneThatWaits: all green is raised first, and the round check's suggestion
// after it replaces it, pushed out and not dismissed.
func TestAllGreenThenTheRoundChecksSuggestionIsTheOneThatWaits(t *testing.T) {
	h := newHarness(t)
	acceptAll(h)
	suggestRoundCheck(h, "Back P3 and drop the rest")
	c := h.run(testCouncil("c1"))
	if s := c.Memory.Suggestion; s == nil || s.Source != SourceCheck || s.Text != "Back P3 and drop the rest" {
		t.Errorf("suggestion = %+v, want the round check's: it follows all green and replaces it", s)
	}
	if len(c.Memory.Dismissed) != 0 {
		t.Errorf("dismissed = %v, want none: a suggestion pushed out is not a dismissed one", c.Memory.Dismissed)
	}
}

// TestAllGreenADismissedIdeaIsNotRaisedAgain: dismissing an all-green suggestion keeps the idea out of later passes.
func TestAllGreenADismissedIdeaIsNotRaisedAgain(t *testing.T) {
	h := newHarness(t)
	acceptAll(h)
	c := h.run(testCouncil("c1"))
	if c.Memory == nil || c.Memory.Suggestion == nil || c.Memory.Suggestion.From != "P1" {
		t.Fatalf("memory = %+v, want P1 all green", c.Memory)
	}
	if _, err := h.r.Direction("c1", DirectionIn{Action: ActionDismiss}); err != nil {
		t.Fatal(err)
	}
	if _, err := h.r.Reply("c1", "", "", "@RAM "+wholeAsk, false, nil); err != nil {
		t.Fatalf("Reply: %v", err)
	}
	got := h.wait("c1")
	// P1 is dismissed, the other ideas are not: the next one takes its place
	if s := got.Memory.Suggestion; s == nil || s.From == "P1" {
		t.Errorf("suggestion = %+v, want another idea than the dismissed P1", s)
	}
	if !slices.Contains(got.Memory.Dismissed, "idea:P1") {
		t.Errorf("dismissed = %v, want idea:P1", got.Memory.Dismissed)
	}
}

// greenRig saves a done council in the state a pass found it (before) and the state it left (the saved one): P1 turned
// all green when wasGreen is false, was green already when true. waiting is the suggestion on the council throughout.
func greenRig(t *testing.T, wasGreen bool, waiting *CouncilMemoryCard) (h *harness, before *Council) {
	t.Helper()
	h = newHarness(t)
	c := fixtureCouncil("c1", StateDone, 2)
	if wasGreen {
		makeGreen(c, "P1")
	}
	if waiting != nil {
		MemoryOf(c).Raise(*waiting)
	}
	h.save(c)
	before = h.load("c1")
	if !wasGreen {
		makeGreen(c, "P1")
		h.save(c)
	}
	return h, before
}

// TestAllGreenOnlyANewlyGreenIdeaDisplacesAWaitingSuggestion: a suggestion that waits is replaced by an idea that turned
// green in this pass (a newer one), not by one that was green already; with nothing waiting an idea that was green already
// is raised; an idea already waiting is left as raised.
func TestAllGreenOnlyANewlyGreenIdeaDisplacesAWaitingSuggestion(t *testing.T) {
	check := CouncilMemoryCard{Text: "Back P2 instead", Source: SourceCheck, Round: 2, At: 5}
	t.Run("newly green replaces a waiting suggestion", func(t *testing.T) {
		h, before := greenRig(t, false, &check)
		h.r.checkMemory(context.Background(), nil, "c1", before, 3)
		if s := h.load("c1").Memory.Suggestion; s == nil || s.Source != SourceGreen || s.From != "P1" || s.Round != 3 {
			t.Errorf("suggestion = %+v, want P1 all green after round 3", s)
		}
	})
	t.Run("an idea green before does not displace it", func(t *testing.T) {
		h, before := greenRig(t, true, &check)
		h.r.checkMemory(context.Background(), nil, "c1", before, 3)
		if s := h.load("c1").Memory.Suggestion; s == nil || s.Text != "Back P2 instead" || s.At != 5 {
			t.Errorf("suggestion = %+v, want the waiting one untouched", s)
		}
	})
	t.Run("an idea green before is raised when nothing waits", func(t *testing.T) {
		h, before := greenRig(t, true, nil)
		// the pass added no message: all green still looks at the council, the round check has nothing to read
		h.r.checkMemory(context.Background(), nil, "c1", before, 3)
		if s := h.load("c1").Memory.Suggestion; s == nil || s.From != "P1" || s.Source != SourceGreen {
			t.Errorf("suggestion = %+v, want P1 all green", s)
		}
		if n := len(h.f.calls("roundcheck")); n != 0 {
			t.Errorf("%d round checks, want none: the pass added nothing", n)
		}
	})
	t.Run("an idea already waiting is not raised again", func(t *testing.T) {
		waiting := CouncilMemoryCard{Kind: CardSuggestion, Text: "Title from ux", Source: SourceGreen, Round: 2, From: "P1", At: 5}
		h, before := greenRig(t, false, &waiting)
		h.r.checkMemory(context.Background(), nil, "c1", before, 3)
		if s := h.load("c1").Memory.Suggestion; s == nil || s.At != 5 || s.Round != 2 {
			t.Errorf("suggestion = %+v, want the waiting card as it was raised", s)
		}
	})
}

// TestRoundCheckAStoppedRunBooksNothing: a check cut off by its run being stopped is no failure and books nothing, as a
// router call cut off does not.
func TestRoundCheckAStoppedRunBooksNothing(t *testing.T) {
	h := newHarness(t)
	done := h.run(testCouncil("c1"))
	h.f.gate("check/roundcheck")
	if _, err := h.r.Reply("c1", "", "", "@RAM "+wholeAsk, false, nil); err != nil {
		t.Fatalf("Reply: %v", err)
	}
	h.f.entered(t, "check/roundcheck")
	if _, err := h.r.Stop("c1"); err != nil {
		t.Fatalf("Stop: %v", err)
	}
	c := h.wait("c1")
	if c.Calls != done.Calls+1 || c.Tokens != done.Tokens+callTokens["ans"] {
		t.Errorf("calls %d tokens %d, want %d and %d: the answer alone, the cut-off check unbooked", c.Calls, c.Tokens, done.Calls+1, done.Tokens+callTokens["ans"])
	}
	if s := checkSuggestion(c); s != nil {
		t.Errorf("suggestion = %+v, want none from a check that was cut off", s)
	}
}
