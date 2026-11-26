// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentpair

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/agentmsg"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

var ctx = context.Background()

// fakeAgent is one agent of the fake roster.
type fakeAgent struct {
	name, harness, project string
	state                  string // "idle" | "working" | "asking" | "sleeping"; "gone" is an agent not on the roster
	answer                 string
	answerTs               int64
	tokens                 int64
	texts                  []string
	sent                   []string // what the pair sent it, in order
	lastSince              int64    // the sinceMs of the last Tokens call
	transcript             string   // the transcript path Agent reports; add sets "/t/<tab>", so the session id is the tab
	agentReads             int      // how many times Agent was asked for it
}

// fakeLink is a Link over a map of agents. A send starts a turn, as it does on the real roster.
type fakeLink struct {
	mu       sync.Mutex
	agents   map[string]*fakeAgent
	clock    int64
	sendErr  error
	agentErr error // when set, Agent fails with it
}

func newFakeLink() *fakeLink { return &fakeLink{agents: map[string]*fakeAgent{}, clock: 1_000_000} }

func (l *fakeLink) add(tab, name string) *fakeAgent {
	a := &fakeAgent{name: name, harness: "claude", project: "proj", state: "idle", transcript: "/t/" + tab}
	l.mu.Lock()
	l.agents[tab] = a
	l.mu.Unlock()
	return a
}

func (l *fakeLink) agent(tab string) *fakeAgent {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.agents[tab]
}

func (l *fakeLink) State(_ context.Context, tab string) (string, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if a := l.agents[tab]; a != nil {
		return a.state, nil
	}
	return "gone", nil
}

func (l *fakeLink) Send(_ context.Context, tab, text string) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.sendErr != nil {
		return l.sendErr
	}
	a := l.agents[tab]
	if a == nil {
		return fmt.Errorf("no agent %s", tab)
	}
	a.sent = append(a.sent, text)
	a.state = "working"
	return nil
}

func (l *fakeLink) LastAnswer(_ context.Context, tab string) (string, int64, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	a := l.agents[tab]
	if a == nil {
		return "", 0, fmt.Errorf("no agent %s", tab)
	}
	return a.answer, a.answerTs, nil
}

func (l *fakeLink) Tokens(_ context.Context, tab string, sinceMs int64) (int64, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	a := l.agents[tab]
	if a == nil {
		return 0, fmt.Errorf("no agent %s", tab)
	}
	a.lastSince = sinceMs
	return a.tokens, nil
}

func (l *fakeLink) Agent(_ context.Context, tab string) (AgentFacts, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	a := l.agents[tab]
	if a == nil {
		return AgentFacts{}, fmt.Errorf("%s is not an agent", tab)
	}
	a.agentReads++
	if l.agentErr != nil {
		return AgentFacts{}, l.agentErr
	}
	return AgentFacts{Name: a.name, Harness: a.harness, Project: a.project, Cwd: "/work/" + tab, Transcript: a.transcript}, nil
}

// agentReads is how many times the pair asked the roster who the agent at tab is.
func (l *fakeLink) agentReads(tab string) int {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.agents[tab].agentReads
}

func (l *fakeLink) RecentTexts(_ context.Context, tab string, n int) ([]string, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	a := l.agents[tab]
	if a == nil {
		return nil, fmt.Errorf("no agent %s", tab)
	}
	texts := a.texts
	if len(texts) > n {
		texts = texts[len(texts)-n:]
	}
	return append([]string{}, texts...), nil
}

// give makes the agent's latest answer text, a second after the one before, without ending a turn.
func (l *fakeLink) give(tab, text string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.clock += 1000
	a := l.agents[tab]
	a.answer, a.answerTs = text, l.clock
}

func (l *fakeLink) setState(tab, state string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.agents[tab].state = state
}

func (l *fakeLink) sent(tab string) []string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return append([]string{}, l.agents[tab].sent...)
}

// rig is a manager over a fake roster of the working agent "w" and the judge "j1".
type rig struct {
	t    *testing.T
	link *fakeLink
	dir  string
	m    *Manager

	mu   sync.Mutex
	pubs []wshrpc.PairUpdateData
	tick int64
}

func newRig(t *testing.T) *rig {
	t.Helper()
	r := &rig{t: t, link: newFakeLink(), dir: filepath.Join(t.TempDir(), "pairs")}
	r.link.add("w", "Plan oracle")
	r.link.add("j1", "Judge one")
	r.m = r.manager()
	return r
}

// manager is a fresh Manager over the rig's roster and folder, as after a restart.
func (r *rig) manager() *Manager {
	return &Manager{
		Link: r.link,
		Dir:  r.dir,
		Publish: func(u wshrpc.PairUpdateData) {
			r.mu.Lock()
			r.pubs = append(r.pubs, u)
			r.mu.Unlock()
		},
		Now: func() time.Time {
			r.mu.Lock()
			defer r.mu.Unlock()
			r.tick++
			return time.UnixMilli(2_000_000 + r.tick*1000)
		},
	}
}

func (r *rig) published() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.pubs)
}

// reply is an agent finishing a turn: its answer is written and it reports idle.
func (r *rig) reply(tab, text string) {
	r.t.Helper()
	r.link.give(tab, text)
	r.link.setState(tab, "idle")
	r.m.TurnEnded(ctx, tab)
}

// start pairs "w" with "j1" unless d says otherwise.
func (r *rig) start(d wshrpc.CommandPairStartData) *wshrpc.PairView {
	r.t.Helper()
	if d.WorkerTab == "" {
		d.WorkerTab = "w"
	}
	if d.JudgeTab == "" {
		d.JudgeTab = "j1"
	}
	v, err := r.m.Start(ctx, d)
	if err != nil {
		r.t.Fatalf("Start: %v", err)
	}
	return v
}

// pairedWith is the usual start: the worker has answered with a block and the judge, picked live, was briefed by Start.
func (r *rig) paired(workerReply string) *wshrpc.PairView {
	r.t.Helper()
	r.link.give("w", workerReply)
	v := r.start(wshrpc.CommandPairStartData{HoldHeavy: true})
	r.link.setState("j1", "idle") // the judge answered its brief with nothing the pair has taken yet
	return v
}

func (r *rig) view(id string) *wshrpc.PairView {
	r.t.Helper()
	v, err := r.m.Get(id)
	if err != nil {
		r.t.Fatalf("Get(%s): %v", id, err)
	}
	return v
}

// internal is the stored pair itself, for what the view does not show (queues, seen marks, passes).
func (r *rig) internal(id string) Pair {
	r.t.Helper()
	r.m.mu.Lock()
	defer r.m.mu.Unlock()
	p := r.m.pairs[id]
	if p == nil {
		r.t.Fatalf("pair %s is not in the index", id)
	}
	return *p
}

func lastLine(v *wshrpc.PairView) wshrpc.PairMessage { return v.Messages[len(v.Messages)-1] }

func contains(t *testing.T, what, text string, want ...string) {
	t.Helper()
	for _, w := range want {
		if !strings.Contains(text, w) {
			t.Fatalf("%s lacks %q:\n%s", what, w, text)
		}
	}
}

const workerPlan = "Plan v1.\n\n```arc-pair\nO1 lock the threshold\n```"

func TestManagerStartRecordsTheFirstMessage(t *testing.T) {
	r := newRig(t)
	r.link.agent("j1").answer, r.link.agent("j1").answerTs = "an old chat answer", 500
	r.link.give("w", workerPlan)
	v := r.start(wshrpc.CommandPairStartData{HoldHeavy: true, Note: "mind the split"})

	if v.State != StateRelaying || v.Project != "proj" || v.Worker.Tab != "w" || len(v.Judges) != 1 || v.Judges[0].Tab != "j1" || v.Judges[0].Name != "Judge one" {
		t.Fatalf("view = %+v", v)
	}
	if !v.HoldHeavy || v.TokenCap != DefaultTokenCap || v.Note != "mind the split" || v.CreatedTs == 0 {
		t.Fatalf("settings = %+v", v)
	}
	if len(v.Messages) != 1 || v.Messages[0].From != FromWorker || v.Messages[0].Tab != "w" || v.Messages[0].Text != "Plan v1." {
		t.Fatalf("messages = %+v: want the worker's latest answer as the first message, its block taken out", v.Messages)
	}
	if !v.Owed {
		t.Fatal("the judge owes an answer to the first message")
	}
	if len(v.Decided.Open) != 1 || v.Decided.Open[0].Num != 1 {
		t.Fatalf("decided = %+v", v.Decided)
	}

	in := r.internal(v.Id)
	if in.Seen["w"] != r.link.agent("w").answerTs || in.Seen["j1"] != 500 {
		t.Fatalf("seen = %v: the worker's answer and the judge's old one are marked taken", in.Seen)
	}
	sent := r.link.sent("j1")
	if len(sent) != 1 || !agentmsg.IsAgentMessage(sent[0]) {
		t.Fatalf("the judge got %q: want its brief, as one relayed message", sent)
	}
	contains(t, "the judge's first prompt", sent[0], "arc-judge", "Plan v1.", "mind the split", "Plan oracle")
	if len(r.link.sent("w")) != 0 {
		t.Fatalf("the worker was sent %q at pairing", r.link.sent("w"))
	}
	if r.published() == 0 {
		t.Fatal("pairing published no pair:update")
	}
	if got := r.m.List(); len(got) != 1 || got[0].Id != v.Id {
		t.Fatalf("List = %+v", got)
	}
}

func TestManagerStartTakesTheAnswerOfABriefedJudgeAlreadyIdle(t *testing.T) {
	r := newRig(t)
	r.link.give("w", workerPlan)
	r.link.give("j1", "> Plan v1.\nThe threshold is tuned to the pilot.\n```arc-judge\nnew: pilot cases overlap the test split\n```")
	v := r.start(wshrpc.CommandPairStartData{Briefed: true})

	if len(v.Messages) != 2 || v.Messages[1].From != FromJudge || v.Messages[1].Tab != "j1" {
		t.Fatalf("messages = %+v: want the worker's answer, then the judge's answer to its brief", v.Messages)
	}
	if v.Messages[1].ReplyTo != v.Messages[0].Id || v.Messages[1].Quote != "Plan v1." {
		t.Fatalf("the judge's answer = %+v: it answers the first message and quotes its line", v.Messages[1])
	}
	if got := r.link.sent("j1"); len(got) != 0 {
		t.Fatalf("a briefed judge was sent %q: its launch task was the brief", got)
	}
	w := r.link.sent("w")
	if len(w) != 1 {
		t.Fatalf("the worker was sent %q: want the judge's answer once, at rest", w)
	}
	contains(t, "the worker's first prompt", w[0], "arcterm has paired you", "The threshold is tuned to the pilot.", "pilot cases overlap")
	if in := r.internal(v.Id); len(in.Pending["w"]) != 0 || !in.WorkerBriefed {
		t.Fatalf("pending %v, briefed %v: the judge's answer is delivered and the worker briefed", in.Pending, in.WorkerBriefed)
	}
}

func TestManagerStartRefuses(t *testing.T) {
	r := newRig(t)
	r.link.add("j2", "Judge two")
	r.link.add("x", "Other")
	r.link.agent("x").harness = "agy"
	r.link.give("w", workerPlan)
	v := r.start(wshrpc.CommandPairStartData{})

	for name, d := range map[string]wshrpc.CommandPairStartData{
		"the same agent on both sides":   {WorkerTab: "x", JudgeTab: "x"},
		"no judge":                       {WorkerTab: "x"},
		"a judge already in a pair":      {WorkerTab: "x", JudgeTab: "j1"},
		"a judge that is the worker":     {WorkerTab: "j2", JudgeTab: "w"},
		"a worker that is a judge":       {WorkerTab: "j1", JudgeTab: "j2"},
		"a harness that is not pairable": {WorkerTab: "j2", JudgeTab: "x"},
		"a tab that is no agent":         {WorkerTab: "j2", JudgeTab: "nobody"},
	} {
		if _, err := r.m.Start(ctx, d); err == nil {
			t.Errorf("%s: Start took it", name)
		}
	}
	if got := r.m.List(); len(got) != 1 || got[0].Id != v.Id {
		t.Fatalf("List = %+v: the refused starts left no pair", got)
	}
}

func TestManagerStartAddsAJudgeToTheWorkersPair(t *testing.T) {
	r := newRig(t)
	r.link.add("j2", "Judge two")
	r.link.give("w", workerPlan)
	first := r.start(wshrpc.CommandPairStartData{})
	second := r.start(wshrpc.CommandPairStartData{JudgeTab: "j2"})

	if second.Id != first.Id || len(r.m.List()) != 1 {
		t.Fatalf("ids %s and %s, %d pairs: adding a judge makes no second pair", first.Id, second.Id, len(r.m.List()))
	}
	if len(second.Judges) != 2 || second.Judges[1].Tab != "j2" {
		t.Fatalf("judges = %+v", second.Judges)
	}
	sent := r.link.sent("j2")
	if len(sent) != 1 {
		t.Fatalf("the new judge got %q", sent)
	}
	contains(t, "the new judge's brief", sent[0], "Plan v1.")
	if len(second.Messages) != 1 {
		t.Fatalf("messages = %+v: the first message is not added twice", second.Messages)
	}
}

// the brief could not be sent: no pair is left behind, and the error comes back
func TestManagerStartUndoesAPairWhoseBriefFailed(t *testing.T) {
	r := newRig(t)
	r.link.give("w", workerPlan)
	r.link.sendErr = fmt.Errorf("the judge is not listening")
	if _, err := r.m.Start(ctx, wshrpc.CommandPairStartData{WorkerTab: "w", JudgeTab: "j1"}); err == nil {
		t.Fatal("Start hid a failed brief")
	}
	if len(r.m.List()) != 0 || r.m.Paired("w") || r.m.Paired("j1") {
		t.Fatal("a pair whose judge never got its brief is still there")
	}
	r.link.sendErr = nil
	r.start(wshrpc.CommandPairStartData{}) // the same two can pair again
}

func TestManagerRelayPassesEachReplyToTheOther(t *testing.T) {
	r := newRig(t)
	v := r.paired(workerPlan)

	r.reply("j1", "> Plan v1.\nThe threshold is picked after the pilot measures.\n```arc-judge\nnew: pilot cases overlap the split\n```")
	w := r.link.sent("w")
	if len(w) != 1 {
		t.Fatalf("the worker was sent %q: want the judge's reply as one prompt", w)
	}
	if !agentmsg.IsAgentMessage(w[0]) {
		t.Fatalf("the prompt is not a relayed message: %q", w[0])
	}
	contains(t, "the worker's prompt", w[0], "arcterm has paired you", `From the judge "Judge one"`, "The threshold is picked after the pilot measures.", "pilot cases overlap the split")

	r.reply("w", "> The threshold is picked after the pilot measures.\nMoved it before.\n```arc-pair\nD1 threshold locked first\nO2 pilot cases outside the split\n```")
	j := r.link.sent("j1")
	if len(j) != 2 {
		t.Fatalf("the judge was sent %d prompts: want its brief and then the worker's reply", len(j))
	}
	contains(t, "the judge's second prompt", j[1], `From the working agent "Plan oracle"`, "Moved it before.", "D1 threshold locked first")
	if strings.Contains(j[1], "arcterm has paired you") {
		t.Fatal("the judge was given the worker brief")
	}
	if got := r.link.sent("w"); len(got) != 1 {
		t.Fatalf("the worker was sent %d prompts: the reply it just wrote is not sent back to it", len(got))
	}

	view := r.view(v.Id)
	if len(view.Messages) != 3 {
		t.Fatalf("messages = %+v", view.Messages)
	}
	if view.Messages[1].ReplyTo != view.Messages[0].Id || view.Messages[2].ReplyTo != view.Messages[1].Id {
		t.Fatalf("replyto = %q, %q: each reply answers the newest message relayed to its author", view.Messages[1].ReplyTo, view.Messages[2].ReplyTo)
	}
	if view.Messages[2].Quote != "The threshold is picked after the pilot measures." {
		t.Fatalf("quote = %q", view.Messages[2].Quote)
	}
	if in := r.internal(v.Id); len(in.Pending["w"])+len(in.Pending["j1"]) != 0 {
		t.Fatalf("pending = %v: everything was delivered", in.Pending)
	}
	if view.Owed != true {
		t.Fatal("the judge owes an answer to the worker's second message")
	}
}

func TestManagerRelayWaitsForABusyAgent(t *testing.T) {
	r := newRig(t)
	v := r.paired(workerPlan)
	r.link.setState("j1", "working") // still on its brief

	r.link.give("w", "Second thought.\n"+pairBlock("O1 changed"))
	r.link.setState("w", "idle")
	r.m.TurnEnded(ctx, "w")
	if got := r.link.sent("j1"); len(got) != 1 {
		t.Fatalf("the judge was sent %d prompts while it was busy", len(got))
	}
	if in := r.internal(v.Id); len(in.Pending["j1"]) != 1 {
		t.Fatalf("pending = %v: the worker's message waits for the judge", in.Pending)
	}

	r.link.setState("j1", "asking") // asking is busy too
	r.m.TurnEnded(ctx, "w")
	if got := r.link.sent("j1"); len(got) != 1 {
		t.Fatalf("the judge was sent %d prompts while it was asking", len(got))
	}

	r.reply("j1", "> Plan v1.\nFine.") // its turn ends: the waiting message goes
	j := r.link.sent("j1")
	if len(j) != 2 {
		t.Fatalf("the judge was sent %d prompts: want the waiting message at its turn end", len(j))
	}
	contains(t, "the judge's prompt", j[1], "Second thought.")
}

func TestManagerRelayWakesASleepingAgent(t *testing.T) {
	r := newRig(t)
	r.paired(workerPlan)
	r.link.setState("j1", "sleeping")
	r.reply("w", "Again.\n"+pairBlock("O1 x"))
	if got := r.link.sent("j1"); len(got) != 2 {
		t.Fatalf("the judge was sent %d prompts: a sleeping agent is at rest and a send wakes it", len(got))
	}
}

func TestManagerRelayKeepsAFailedSendForTheNextTry(t *testing.T) {
	r := newRig(t)
	v := r.paired(workerPlan)
	r.link.sendErr = fmt.Errorf("the pipe is closed")
	r.reply("w", "Again.\n"+pairBlock("O1 x"))
	if got := r.link.sent("j1"); len(got) != 1 {
		t.Fatalf("the judge was sent %d prompts through a failing link", len(got))
	}
	if in := r.internal(v.Id); len(in.Pending["j1"]) != 1 {
		t.Fatalf("pending = %v: a failed send leaves the queue", in.Pending)
	}

	r.link.sendErr = nil
	r.link.setState("j1", "idle")
	r.m.TurnEnded(ctx, "j1") // any turn end of a member tries the queues again
	j := r.link.sent("j1")
	if len(j) != 2 {
		t.Fatalf("the judge was sent %d prompts: want the kept message on the next try", len(j))
	}
	contains(t, "the judge's prompt", j[1], "Again.")
	if in := r.internal(v.Id); len(in.Pending["j1"]) != 0 {
		t.Fatalf("pending = %v: delivered, so out of the queue", in.Pending)
	}
}

func TestManagerBatchJudgeRepliesIntoOnePromptForABusyWorker(t *testing.T) {
	r := newRig(t)
	r.link.add("j2", "Judge two")
	r.link.give("w", workerPlan)
	v := r.start(wshrpc.CommandPairStartData{})
	r.start(wshrpc.CommandPairStartData{JudgeTab: "j2"})
	r.link.setState("j1", "idle")
	r.link.setState("j2", "idle")
	r.link.setState("w", "working") // the worker is busy: whatever the judges say waits

	r.reply("j1", "> Plan v1.\nFirst finding.\n"+judgeBlock("new: a"))
	if got := r.link.sent("j2"); len(got) != 1 {
		t.Fatalf("judge two was sent %q: another judge's reply is context and starts no turn", got)
	}
	r.reply("j2", "> Plan v1.\nSecond finding.\n"+judgeBlock("new: b"))
	if got := r.link.sent("w"); len(got) != 0 {
		t.Fatalf("the busy worker was sent %q", got)
	}
	if in := r.internal(v.Id); len(in.Pending["w"]) != 2 {
		t.Fatalf("pending = %v: both replies wait for the worker", in.Pending)
	}

	r.reply("w", "Handled both.\n"+pairBlock("O1 a", "O2 b"))
	w := r.link.sent("w")
	if len(w) != 1 {
		t.Fatalf("the worker was sent %d prompts: want both judges' replies in one", len(w))
	}
	contains(t, "the worker's prompt", w[0], "arcterm has paired you", "judges", "First finding.", "Second finding.")
	if strings.Index(w[0], "First finding.") > strings.Index(w[0], "Second finding.") {
		t.Fatal("the replies are out of order")
	}
	// each judge gets the worker's reply; judge two's prompt carries judge one's reply before it, as context
	j2 := r.link.sent("j2")
	if len(j2) != 2 {
		t.Fatalf("judge two was sent %d prompts", len(j2))
	}
	contains(t, "judge two's prompt", j2[1], "Handled both.")
}

func TestManagerStopOnNoNewPoints(t *testing.T) {
	r := newRig(t)
	v := r.paired(workerPlan)
	r.reply("j1", "> Plan v1.\nNothing to add.\n"+judgeBlock("no new points"))

	view := r.view(v.Id)
	if view.State != StateStopped || view.StopReason != StopNoNewPoints {
		t.Fatalf("state %s / %s", view.State, view.StopReason)
	}
	if line := lastLine(view); line.From != FromSystem || line.Text != "Paused: the judge has no new points" {
		t.Fatalf("last line = %+v", line)
	}
	if got := r.link.sent("w"); len(got) != 0 {
		t.Fatalf("the worker was sent %q: a judge's reply behind a stop asks nothing of it", got)
	}
	if in := r.internal(v.Id); len(in.Pending["w"]) != 0 {
		t.Fatalf("pending = %v", in.Pending)
	}
	if view.Owed {
		t.Fatal("the judge answered")
	}
}

func TestManagerStopWhenBothAgree(t *testing.T) {
	r := newRig(t)
	v := r.paired("All settled.\n" + pairBlock("D1 threshold first", "D2 split outside"))

	// a reply with no arc-judge fence is no word on the list: the exchange goes on
	r.reply("j1", "> All settled.\nLooks fine to me.")
	if view := r.view(v.Id); view.State != StateRelaying {
		t.Fatalf("state %s after a reply without the fence", view.State)
	}
	if got := r.link.sent("w"); len(got) != 1 {
		t.Fatalf("the worker was sent %d prompts: that reply is delivered", len(got))
	}

	r.reply("w", "Thanks.\n"+pairBlock("D1 threshold first", "D2 split outside"))
	r.reply("j1", "> Thanks.\nAgreed.\n```arc-judge\n```")
	view := r.view(v.Id)
	if view.State != StateStopped || view.StopReason != StopSettled {
		t.Fatalf("state %s / %s", view.State, view.StopReason)
	}
	if line := lastLine(view); line.Text != "Paused: both agree" {
		t.Fatalf("last line = %+v", line)
	}
	if got := r.link.sent("w"); len(got) != 1 {
		t.Fatalf("the worker was sent %d prompts: the first reply only, the one behind the stop is not delivered", len(got))
	}
}

func TestManagerResumeByThePerson(t *testing.T) {
	r := newRig(t)
	v := r.paired(workerPlan)
	r.reply("j1", "> Plan v1.\nNothing to add.\n"+judgeBlock("no new points"))

	if err := r.m.Say(ctx, wshrpc.CommandPairSayData{PairId: v.Id, Text: "Carry on with the pilot."}); err != nil {
		t.Fatal(err)
	}
	view := r.view(v.Id)
	if view.State != StateRelaying || view.StopReason != "" {
		t.Fatalf("state %s / %s after the person's message", view.State, view.StopReason)
	}
	p := lastLine(view)
	if p.From != FromPerson || p.Text != "Carry on with the pilot." || p.To != ToBoth {
		t.Fatalf("the person's message = %+v", p)
	}
	w := r.link.sent("w")
	if len(w) != 1 {
		t.Fatalf("the worker was sent %q", w)
	}
	contains(t, "the worker's prompt", w[0], "From the person", "Carry on with the pilot.")
	if strings.Contains(w[0], "Nothing to add.") {
		t.Fatal("the judge's reply behind the stop was delivered with the person's message")
	}
	// the person's message goes to both, but the judge only reads it with the worker's answer: it stays queued
	if got := r.link.sent("j1"); len(got) != 1 {
		t.Fatalf("the judge was sent %d prompts: want its brief alone, the person's message waits for the worker's answer", len(got))
	}
	if in := r.internal(v.Id); !reflect.DeepEqual(in.Pending["j1"], []string{p.Id}) {
		t.Fatalf("the judge's queue = %v, want the person's message %s kept", in.Pending["j1"], p.Id)
	}

	// the worker answers it, and the judge gets the message and the answer in one prompt
	r.reply("w", "On it.\n"+pairBlock("O1 pilot"))
	j := r.link.sent("j1")
	if len(j) != 2 {
		t.Fatalf("the judge was sent %d prompts: want the person's message with the worker's answer", len(j))
	}
	contains(t, "the judge's prompt", j[1], "From the person", "Carry on with the pilot.", `From the working agent "Plan oracle"`, "On it.")
}

func TestManagerResumeByAWorkerReply(t *testing.T) {
	r := newRig(t)
	v := r.paired(workerPlan)
	r.reply("j1", "> Plan v1.\nNothing to add.\n"+judgeBlock("no new points"))

	r.reply("w", "The person asked me for one more thing.\n"+pairBlock("O1 more"))
	view := r.view(v.Id)
	if view.State != StateRelaying || view.StopReason != "" {
		t.Fatalf("state %s / %s after the worker's reply", view.State, view.StopReason)
	}
	j := r.link.sent("j1")
	if len(j) != 2 {
		t.Fatalf("the judge was sent %d prompts: the worker's new reply passes on", len(j))
	}
	if got := r.link.sent("w"); len(got) != 0 {
		t.Fatalf("the worker was sent %q: the stopped judge's reply is not delivered now either", got)
	}
}

// pausedByNoNewPoints is a pair whose judge said no new points: both agents are idle and nothing waits in either queue
// (the plan reached the judge inside its brief). It is the state the person speaks into in pair df763872.
func pausedByNoNewPoints(t *testing.T, r *rig) *wshrpc.PairView {
	t.Helper()
	v := r.paired(workerPlan)
	r.reply("j1", "> Plan v1.\nNothing to add.\n"+judgeBlock("no new points"))
	view := r.view(v.Id)
	if view.State != StateStopped || view.StopReason != StopNoNewPoints {
		t.Fatalf("state %s / %s", view.State, view.StopReason)
	}
	if in := r.internal(v.Id); len(in.Pending["w"])+len(in.Pending["j1"]) != 0 {
		t.Fatalf("pending = %v: want empty queues", in.Pending)
	}
	if got := r.link.sent("j1"); len(got) != 1 {
		t.Fatalf("the judge was sent %d prompts: want its brief alone", len(got))
	}
	return view
}

// the shape of pair df763872: the person's message to both went to the worker and the judge at once, so the judge answered
// the person instead of judging the worker. Now the judge gets it with the worker's answer, in one prompt.
func TestPersonToBothWaitsForWorker(t *testing.T) {
	r := newRig(t)
	v := pausedByNoNewPoints(t, r)

	if err := r.m.Say(ctx, wshrpc.CommandPairSayData{PairId: v.Id, Text: "Why is the threshold 50%?"}); err != nil {
		t.Fatal(err)
	}
	person := lastLine(r.view(v.Id))
	if person.From != FromPerson || person.To != ToBoth {
		t.Fatalf("the person's message = %+v", person)
	}
	if w := r.link.sent("w"); len(w) != 1 {
		t.Fatalf("the worker was sent %q: the message goes to it at once", w)
	} else {
		contains(t, "the worker's prompt", w[0], "Why is the threshold 50%?")
	}
	if got := r.link.sent("j1"); len(got) != 1 {
		t.Fatalf("the judge was sent %d prompts: the person's message is only context until the worker answers it", len(got))
	}
	if in := r.internal(v.Id); !reflect.DeepEqual(in.Pending["j1"], []string{person.Id}) {
		t.Fatalf("the judge's queue = %v, want the message kept as context", in.Pending["j1"])
	}

	// the worker answers the person: the judge now gets the question and the answer in one prompt
	r.reply("w", "Because the pilot says so.\n"+pairBlock("O1 pilot threshold"))
	answer := lastWorkerMsg(r.view(v.Id))
	if answer.ReplyTo != person.Id {
		t.Fatalf("the worker's answer replies to %q, want %s", answer.ReplyTo, person.Id)
	}
	j := r.link.sent("j1")
	if len(j) != 2 {
		t.Fatalf("the judge was sent %d prompts: want the person's message with the worker's answer in one", len(j))
	}
	contains(t, "the judge's prompt", j[1], "From the person", "Why is the threshold 50%?", `From the working agent "Plan oracle"`, "Because the pilot says so.")
	if strings.Index(j[1], "Why is the threshold 50%?") > strings.Index(j[1], "Because the pilot says so.") {
		t.Fatal("the answer comes before the question")
	}
	if in := r.internal(v.Id); len(in.Pending["j1"]) != 0 {
		t.Fatalf("the judge's queue = %v: both were delivered", in.Pending["j1"])
	}

	// the judge's reply answers the worker's answer, not the person
	r.reply("j1", "> Because the pilot says so.\nThe pilot was never checked.\n"+judgeBlock("new: the pilot was never checked"))
	if reply := lastLine(r.view(v.Id)); reply.From != FromJudge || reply.ReplyTo != answer.Id {
		t.Fatalf("the judge's reply = %+v, want it to answer the worker's message %s", reply, answer.Id)
	}
}

// a judge's queue that holds a message that calls (the worker's reply) and a person's message to both that does not call
// yet sends the first alone: the person's message would otherwise go out ahead of the worker's answer to it
func TestPersonToBothNotSentWithACallingMessage(t *testing.T) {
	r := newRig(t)
	v := r.paired(workerPlan)
	r.link.setState("j1", "working") // the judge is still on the plan: what comes now waits in its queue

	r.reply("w", "Second thought.\n"+pairBlock("O1 changed")) // m2: calls the judge
	if err := r.m.Say(ctx, wshrpc.CommandPairSayData{PairId: v.Id, Text: "Why 50%?"}); err != nil {
		t.Fatal(err)
	}
	person := lastLine(r.view(v.Id)) // m3: to both, and the worker has it and has not answered
	if in := r.internal(v.Id); !reflect.DeepEqual(in.Pending["j1"], []string{"m2", person.Id}) {
		t.Fatalf("the judge's queue = %v, want the worker's reply and the person's message", in.Pending["j1"])
	}
	if got := r.link.sent("j1"); len(got) != 1 {
		t.Fatalf("the judge was sent %d prompts while it was working", len(got))
	}

	// its turn ends: the worker's reply goes alone, and the person's message is not among the ids removed
	r.reply("j1", "> Plan v1.\nFine.")
	j := r.link.sent("j1")
	if len(j) != 2 {
		t.Fatalf("the judge was sent %d prompts: want the worker's reply at its turn end", len(j))
	}
	contains(t, "the judge's prompt", j[1], "Second thought.")
	if strings.Contains(j[1], "Why 50%?") {
		t.Fatalf("the person's message went out ahead of the worker's answer to it:\n%s", j[1])
	}
	if in := r.internal(v.Id); !reflect.DeepEqual(in.Pending["j1"], []string{person.Id}) {
		t.Fatalf("the judge's queue = %v, want only %s left", in.Pending["j1"], person.Id)
	}

	// the worker answers the person while the judge works; the next turn end takes the question and the answer in one
	r.reply("w", "Because.\n"+pairBlock("O1 x"))
	if got := r.link.sent("j1"); len(got) != 2 {
		t.Fatalf("the judge was sent %d prompts while it was working", len(got))
	}
	r.reply("j1", "> Second thought.\nOk.")
	j = r.link.sent("j1")
	if len(j) != 3 {
		t.Fatalf("the judge was sent %d prompts: want the question and the answer at its turn end", len(j))
	}
	contains(t, "the judge's prompt", j[2], "Why 50%?", "Because.")
	if in := r.internal(v.Id); len(in.Pending["j1"]) != 0 {
		t.Fatalf("the judge's queue = %v: both were delivered", in.Pending["j1"])
	}
}

// @judge and a judge's own tab call the judge at once, with no waiting for the worker
func TestPersonToJudgeCallsAtOnce(t *testing.T) {
	for _, to := range []string{ToJudge, "j1"} {
		t.Run(to, func(t *testing.T) {
			r := newRig(t)
			v := pausedByNoNewPoints(t, r)
			if err := r.m.Say(ctx, wshrpc.CommandPairSayData{PairId: v.Id, Text: "Judge, is 50% right?", To: to}); err != nil {
				t.Fatal(err)
			}
			j := r.link.sent("j1")
			if len(j) != 2 {
				t.Fatalf("the judge was sent %d prompts: want the message at once", len(j))
			}
			contains(t, "the judge's prompt", j[1], "From the person", "Judge, is 50% right?")
			if got := r.link.sent("w"); len(got) != 0 {
				t.Fatalf("the worker was sent %q: the message was not for it", got)
			}
			if view := r.view(v.Id); view.State != StateRelaying {
				t.Fatalf("state %s: a message to the judge resumes the pair", view.State)
			}
		})
	}
}

// callsFor is the waiting rule alone: on a judge's side a person's message to both (a To of "" reads as both) calls only
// once the worker has answered it
func TestCallsForThePersonsMessage(t *testing.T) {
	p := &Pair{
		Worker: Side{Tab: "w"},
		Judges: []Side{{Tab: "j1"}},
		Messages: []Message{
			{Id: "m1", From: FromWorker, Tab: "w"},
			{Id: "m2", From: FromPerson, To: ToBoth},
		},
		Pending: map[string][]string{"w": {"m2"}, "j1": {"m2"}},
	}
	for _, to := range []string{ToBoth, ""} {
		p.Messages[1].To = to
		person := p.Messages[1]
		if !callsFor(p, "w", person) {
			t.Errorf("to %q: the worker is not called by the person's message", to)
		}
		if callsFor(p, "j1", person) {
			t.Errorf("to %q: the judge is called while the message waits in the worker's queue", to)
		}
		p.Pending["w"] = nil // delivered: the worker has it and has not answered
		if callsFor(p, "j1", person) {
			t.Errorf("to %q: the judge is called before any worker message follows it", to)
		}
		p.Messages = append(p.Messages, Message{Id: "m3", From: FromWorker, Tab: "w"})
		if !callsFor(p, "j1", person) {
			t.Errorf("to %q: the judge is not called once the worker answered", to)
		}
		p.Messages, p.Pending["w"] = p.Messages[:2], []string{"m2"} // back to the start
	}

	// the same message to the judge alone, or to a judge's tab, calls at once; so does the worker's reply
	for _, to := range []string{ToJudge, "j1"} {
		if !callsFor(p, "j1", Message{Id: "m2", From: FromPerson, To: to}) {
			t.Errorf("to %q: the judge is not called at once", to)
		}
	}
	if !callsFor(p, "j1", p.Messages[0]) {
		t.Error("the worker's message does not call the judge")
	}
	if callsFor(p, "j1", Message{Id: "mj", From: FromJudge, Tab: "j2"}) {
		t.Error("another judge's message calls the judge")
	}
}

func TestPauseSnapshot(t *testing.T) {
	// the pause message keeps today's line as its text, and the lists and the judge's summary as they were
	t.Run("no new points", func(t *testing.T) {
		r := newRig(t)
		v := r.paired("Checked.\n" + pairBlock("D1 threshold first", "O2 pilot split", "A3 Is 50% fine? [Yes | No]"))
		r.reply("j1", "> Checked.\nNothing to add.\n"+judgeBlock("summary: D1 is agreed, O2 is open, A3 waits on you.", "no new points"))
		view := r.view(v.Id)
		line := lastLine(view)
		if line.From != FromSystem || line.Text != "Paused: the judge has no new points" || line.Pause == nil {
			t.Fatalf("last line = %+v", line)
		}
		got := *line.Pause
		if got.Reason != StopNoNewPoints || got.Summary != "D1 is agreed, O2 is open, A3 waits on you." {
			t.Fatalf("pause = %+v", got)
		}
		if len(got.Decided.Agreed) != 1 || len(got.Decided.Open) != 1 || len(got.Decided.Asks) != 1 || got.Decided.Asks[0].Num != 3 {
			t.Fatalf("decided = %+v", got.Decided)
		}
		if !reflect.DeepEqual(got.Decided, view.Decided) {
			t.Fatalf("the snapshot %+v is not the lists at that moment %+v", got.Decided, view.Decided)
		}
		if back := r.manager().mustGet(t, v.Id); lastLine(back).Pause == nil || !reflect.DeepEqual(*lastLine(back).Pause, got) {
			t.Fatalf("the file holds %+v, want %+v", lastLine(back).Pause, got)
		}

		// a later list does not move an older pause's snapshot
		r.reply("w", "More.\n"+pairBlock("D1 threshold first", "D2 pilot split", "A3 Is 50% fine? [Yes | No]", "O4 new thing"))
		later := r.view(v.Id)
		if len(later.Decided.Agreed) != 2 {
			t.Fatalf("decided = %+v", later.Decided)
		}
		for _, m := range later.Messages {
			if m.Pause != nil && !reflect.DeepEqual(*m.Pause, got) {
				t.Fatalf("the pause now reads %+v, want the snapshot %+v", *m.Pause, got)
			}
		}
	})

	t.Run("both agree", func(t *testing.T) {
		r := newRig(t)
		v := r.paired("All settled.\n" + pairBlock("D1 threshold first"))
		r.reply("j1", "> All settled.\nAgreed.\n```arc-judge\nsummary: nothing is open.\n```")
		line := lastLine(r.view(v.Id))
		if line.Text != "Paused: both agree" || line.Pause == nil || line.Pause.Reason != StopSettled || line.Pause.Summary != "nothing is open." ||
			len(line.Pause.Decided.Agreed) != 1 {
			t.Fatalf("last line = %+v / %+v", line, line.Pause)
		}
	})

	// the cap is hit at the worker's turn end: no judge message follows its newest, so there is no summary, even though an
	// older judge message wrote one
	t.Run("token cap", func(t *testing.T) {
		r := newRig(t)
		r.link.agent("w").tokens, r.link.agent("j1").tokens = 600_000, 500_000
		r.link.give("w", workerPlan)
		v := r.start(wshrpc.CommandPairStartData{TokenCap: 2_000_000})
		r.link.setState("j1", "idle")
		r.reply("j1", "> Plan v1.\nOne finding.\n"+judgeBlock("summary: an older summary", "new: a"))
		r.link.agent("w").tokens = 1_500_000
		r.reply("w", "More.\n"+pairBlock("O1 a"))
		line := lastLine(r.view(v.Id))
		if line.Text != "Paused: token cap reached (2.0M)" || line.Pause == nil || line.Pause.Reason != StopTokenCap || line.Pause.Summary != "" {
			t.Fatalf("last line = %+v / %+v", line, line.Pause)
		}
		if len(line.Pause.Decided.Open) != 1 {
			t.Fatalf("decided = %+v", line.Pause.Decided)
		}
	})

	// the summary is the newest judge message's after the worker's newest, whatever the reason: here the cap came with the
	// judge's reply
	t.Run("token cap at a judge's reply", func(t *testing.T) {
		r := newRig(t)
		r.link.give("w", workerPlan)
		v := r.start(wshrpc.CommandPairStartData{})
		r.link.setState("j1", "idle")
		r.link.agent("w").tokens = 3_500_000 // over the default cap by the time the judge's reply is counted
		r.reply("j1", "> Plan v1.\nA finding.\n"+judgeBlock("summary: the budget is spent", "new: a"))
		line := lastLine(r.view(v.Id))
		if line.Pause == nil || line.Pause.Reason != StopTokenCap || line.Pause.Summary != "the budget is spent" {
			t.Fatalf("last line = %+v / %+v", line, line.Pause)
		}
	})

	// no list at all: the snapshot's lists are empty slices, so the wire carries [] and not null
	t.Run("no judge is left", func(t *testing.T) {
		r := newRig(t)
		v := r.paired("A plan with no list.")
		delete(r.link.agents, "j1")
		r.reply("w", "Again, still none.")
		line := lastLine(r.view(v.Id))
		if line.Text != "Paused: no judge is left" || line.Pause == nil || line.Pause.Reason != StopJudgesGone || line.Pause.Summary != "" {
			t.Fatalf("last line = %+v / %+v", line, line.Pause)
		}
		data, err := json.Marshal(line.Pause)
		if err != nil {
			t.Fatal(err)
		}
		if bytes.Contains(data, []byte("null")) {
			t.Fatalf("the snapshot holds a null: %s", data)
		}
	})
}

func TestManagerTokenCapStopsTheExchange(t *testing.T) {
	r := newRig(t)
	r.link.agent("w").tokens, r.link.agent("j1").tokens = 600_000, 500_000
	r.link.give("w", workerPlan)
	v := r.start(wshrpc.CommandPairStartData{TokenCap: 2_000_000})
	r.link.setState("j1", "idle")

	r.reply("j1", "> Plan v1.\nOne finding.\n"+judgeBlock("new: a"))
	if view := r.view(v.Id); view.State != StateRelaying || view.Tokens != 1_100_000 {
		t.Fatalf("state %s, tokens %d: below the cap", view.State, view.Tokens)
	}
	if r.link.agent("w").lastSince != r.internal(v.Id).CapFromTs || r.internal(v.Id).CapFromTs == 0 {
		t.Fatalf("tokens counted since %d, the cap counts from %d", r.link.agent("w").lastSince, r.internal(v.Id).CapFromTs)
	}

	r.link.agent("w").tokens = 1_500_000
	r.reply("w", "More.\n"+pairBlock("O1 a"))
	view := r.view(v.Id)
	if view.State != StateStopped || view.StopReason != StopTokenCap || view.Tokens != 2_000_000 {
		t.Fatalf("state %s / %s, tokens %d: want a stop at the cap", view.State, view.StopReason, view.Tokens)
	}
	if line := lastLine(view); line.From != FromSystem || line.Text != "Paused: token cap reached (2.0M)" {
		t.Fatalf("last line = %+v", line)
	}
	if got := r.link.sent("j1"); len(got) != 1 {
		t.Fatalf("the judge was sent %d prompts: the stop holds the worker's reply", len(got))
	}
}

func TestManagerResumeNotByAWorkerReplyAfterTheTokenCap(t *testing.T) {
	r := newRig(t)
	r.link.agent("w").tokens = 3_500_000
	r.link.give("w", workerPlan)
	v := r.start(wshrpc.CommandPairStartData{})
	r.link.setState("j1", "idle")
	r.reply("j1", "> Plan v1.\nA finding.\n"+judgeBlock("new: a"))
	if view := r.view(v.Id); view.StopReason != StopTokenCap {
		t.Fatalf("stop = %q: the worker's tokens are over the default cap", view.StopReason)
	}
	pubs := r.published()

	r.reply("w", "Another reply.\n"+pairBlock("O1 a"))
	view := r.view(v.Id)
	if view.State != StateStopped || view.StopReason != StopTokenCap {
		t.Fatalf("state %s / %s: a worker's reply resumes no token-cap stop", view.State, view.StopReason)
	}
	if n := countSystem(view, "Paused: token cap reached (3.0M)"); n != 1 {
		t.Fatalf("the stop was written %d times", n)
	}
	if got := r.link.sent("j1"); len(got) != 1 {
		t.Fatalf("the judge was sent %d prompts", len(got))
	}
	// the pair does not follow the worker while it is stopped at the cap: the reply is not in the conversation
	for _, m := range view.Messages {
		if strings.Contains(m.Text, "Another reply.") {
			t.Fatalf("the worker's reply after the cap is in the conversation: %+v", m)
		}
	}
	if r.published() == pubs {
		t.Fatal("the worker's reply moved the seen mark and published nothing")
	}

	// the person resumes it; the cap counts again from now
	r.link.agent("w").tokens = 0
	if err := r.m.Say(ctx, wshrpc.CommandPairSayData{PairId: v.Id, Text: "Spend a bit more."}); err != nil {
		t.Fatal(err)
	}
	view = r.view(v.Id)
	if view.State != StateRelaying || view.StopReason != "" || view.Tokens != 0 {
		t.Fatalf("state %s / %s, tokens %d after the person's message", view.State, view.StopReason, view.Tokens)
	}
	person := lastLine(view)
	if in := r.internal(v.Id); in.CapFromTs <= in.CreatedTs {
		t.Fatalf("the cap counts from %d, pairing was at %d", in.CapFromTs, in.CreatedTs)
	}
	// the worker gets the judge's finding and the person's message; the judge nothing yet, because the person's message
	// waits for the worker's answer
	if w := r.link.sent("w"); len(w) != 1 {
		t.Fatalf("the worker was sent %d prompts: want the judge's finding and the person's message in one", len(w))
	} else {
		contains(t, "the worker's prompt", w[0], "A finding.", "Spend a bit more.")
		if strings.Contains(w[0], "Another reply.") {
			t.Fatal("the worker was sent its own reply")
		}
	}
	if got := r.link.sent("j1"); len(got) != 1 {
		t.Fatalf("the judge was sent %d prompts: the person's message waits for the worker's answer", len(got))
	}

	// it reaches the judge with the worker's next answer, in one prompt
	r.reply("w", "Noted, spending more.\n"+pairBlock("O1 a"))
	j := r.link.sent("j1")
	if len(j) != 2 {
		t.Fatalf("the judge was sent %d prompts: want the person's message and the worker's answer", len(j))
	}
	contains(t, "the judge's prompt", j[1], "Spend a bit more.", "Noted, spending more.")
	if strings.Contains(j[1], "Another reply.") {
		t.Fatal("the reply after the cap reached the judge")
	}
	if got := r.view(v.Id); !hasMessage(got, FromWorker, "Noted, spending more.") || lastWorkerMsg(got).ReplyTo != person.Id {
		t.Fatalf("the worker's answer = %+v, want it to answer the person's message %s", lastWorkerMsg(got), person.Id)
	}
}

// hasMessage reports whether the conversation holds a message of the author whose shown text starts with text.
func hasMessage(v *wshrpc.PairView, from, text string) bool {
	for _, m := range v.Messages {
		if m.From == from && strings.HasPrefix(m.Text, text) {
			return true
		}
	}
	return false
}

// a pair stopped at the token cap does not follow the worker: its turns are not recorded, not queued for the judge and do not
// take the held commands, but the pair marks them seen so they are not taken as new once it resumes
func TestWorkerAfterTokenCapNotFollowed(t *testing.T) {
	r := newRig(t)
	r.link.agent("w").tokens = 3_500_000
	r.link.give("w", workerPlan)
	v := r.start(wshrpc.CommandPairStartData{})
	r.link.setState("j1", "idle")
	r.reply("j1", "> Plan v1.\nA finding.\n"+judgeBlock("new: a"))
	if view := r.view(v.Id); view.StopReason != StopTokenCap {
		t.Fatalf("stop = %q", view.StopReason)
	}
	r.m.mu.Lock()
	r.m.pairs[v.Id].Held = []wshrpc.PairHeld{{Command: "go test ./...", Ts: 1}}
	r.m.mu.Unlock()
	before := r.internal(v.Id)
	count, seenBefore := len(before.Messages), before.Seen["w"]
	pendingBefore := map[string][]string{}
	for tab, ids := range before.Pending { // internal copies the struct, not its maps
		pendingBefore[tab] = slices.Clone(ids)
	}

	// two turns the person started in the worker's own Chat
	r.reply("w", "Off-topic one.\n"+pairBlock("O1 a"))
	r.reply("w", "Off-topic two.\n"+pairBlock("O1 a"))

	after := r.internal(v.Id)
	if len(after.Messages) != count {
		t.Fatalf("the conversation holds %d messages, had %d: a worker turn after the cap is not recorded", len(after.Messages), count)
	}
	if !reflect.DeepEqual(after.Pending, pendingBefore) {
		t.Fatalf("pending = %v, was %v: the turns are not queued for the judge", after.Pending, pendingBefore)
	}
	if !reflect.DeepEqual(after.Held, before.Held) || len(after.Held) != 1 {
		t.Fatalf("held = %+v, was %+v: the held commands wait for a message that is recorded", after.Held, before.Held)
	}
	if after.State != StateStopped || after.StopReason != StopTokenCap {
		t.Fatalf("state %s / %s", after.State, after.StopReason)
	}
	if after.Seen["w"] <= seenBefore {
		t.Fatalf("seen mark %d, was %d: the turns are marked seen", after.Seen["w"], seenBefore)
	}
	if got := r.link.sent("j1"); len(got) != 1 {
		t.Fatalf("the judge was sent %d prompts", len(got))
	}
	// the mark is saved: the file a fresh manager reads holds it
	fresh := r.manager()
	fresh.mustGet(t, v.Id)
	fresh.mu.Lock()
	savedSeen := fresh.pairs[v.Id].Seen["w"]
	fresh.mu.Unlock()
	if savedSeen != after.Seen["w"] {
		t.Fatalf("the file holds seen mark %d, want %d", savedSeen, after.Seen["w"])
	}

	// the pair follows again once it resumes, and the turns it passed are not taken then
	r.link.agent("w").tokens = 0
	if err := r.m.Say(ctx, wshrpc.CommandPairSayData{PairId: v.Id, Text: "Go on.", To: ToWorker}); err != nil {
		t.Fatal(err)
	}
	r.m.TurnEnded(ctx, "w")
	if view := r.view(v.Id); hasMessage(view, FromWorker, "Off-topic") {
		t.Fatalf("a turn passed during the stop was taken after the resume: %+v", view.Messages)
	}
	r.reply("w", "Back on topic.\n"+pairBlock("O1 a"))
	if view := r.view(v.Id); !hasMessage(view, FromWorker, "Back on topic.") {
		t.Fatalf("the worker's first turn after the resume is not recorded: %+v", view.Messages)
	}
}

// the judge's fixes were sent to the worker and the cap stopped the pair while the worker was still on that turn: its answer
// arrives after the stop and is kept, as the answer to the judge's message and queued for the judge, but it does not resume
// the pair. A turn after it has nothing left to answer and is passed over as any turn after the cap.
func TestWorkerAnswerUnderWayAtTokenCapKept(t *testing.T) {
	r := newRig(t)
	r.link.give("w", workerPlan)
	v := r.start(wshrpc.CommandPairStartData{})
	r.link.setState("j1", "idle")
	// the worker is under the cap and idle, so the judge's fixes are delivered at once and it starts the turn
	r.reply("j1", "> Plan v1.\nA finding.\n"+judgeBlock("new: a"))
	fixes := lastLine(r.view(v.Id))
	if fixes.From != FromJudge {
		t.Fatalf("the last line = %+v, want the judge's fixes", fixes)
	}
	if w := r.link.sent("w"); len(w) != 1 {
		t.Fatalf("the worker was sent %d prompts: want the judge's fixes", len(w))
	}
	if in := r.internal(v.Id); slices.Contains(in.Pending["w"], fixes.Id) {
		t.Fatalf("pending = %v: the fixes were delivered, so they are not queued for the worker", in.Pending)
	}

	// the cap is reached while the worker is on that turn: a turn end of the judge settles it
	r.link.agent("w").tokens = 3_500_000
	r.m.TurnEnded(ctx, "j1")
	if view := r.view(v.Id); view.State != StateStopped || view.StopReason != StopTokenCap {
		t.Fatalf("state %s / %s: want a stop at the cap", view.State, view.StopReason)
	}
	r.m.mu.Lock()
	r.m.pairs[v.Id].Held = []wshrpc.PairHeld{{Command: "go test ./...", Ts: 1}}
	r.m.mu.Unlock()

	// its answer to the fixes arrives after the stop
	r.reply("w", "Fixed it.\n"+pairBlock("O1 a"))
	view := r.view(v.Id)
	if view.State != StateStopped || view.StopReason != StopTokenCap {
		t.Fatalf("state %s / %s: the answer resumes no token-cap stop", view.State, view.StopReason)
	}
	answer := lastWorkerMsg(view)
	if !strings.HasPrefix(answer.Text, "Fixed it.") || answer.ReplyTo != fixes.Id {
		t.Fatalf("the worker's answer = %+v, want it recorded as the answer to the judge's fixes %s", answer, fixes.Id)
	}
	if n := countSystem(view, "Paused: token cap reached (3.0M)"); n != 1 {
		t.Fatalf("the stop was written %d times", n)
	}
	in := r.internal(v.Id)
	if !slices.Contains(in.Pending["j1"], answer.Id) {
		t.Fatalf("pending = %v: the answer is queued for the judge", in.Pending)
	}
	if len(in.Held) != 0 {
		t.Fatalf("held = %+v: a recorded worker message takes the held commands", in.Held)
	}
	if got := r.link.sent("j1"); len(got) != 1 {
		t.Fatalf("the judge was sent %d prompts: a stopped pair delivers nothing", len(got))
	}

	// a second turn of its own: nothing it was sent is left to answer, so it is not recorded and only moves the seen mark
	count, seenBefore, pubs := len(in.Messages), in.Seen["w"], r.published()
	r.reply("w", "An aside.\n"+pairBlock("O1 a"))
	after := r.internal(v.Id)
	if len(after.Messages) != count {
		t.Fatalf("the conversation holds %d messages, had %d: a turn with nothing to answer is not recorded", len(after.Messages), count)
	}
	if !reflect.DeepEqual(after.Pending["j1"], in.Pending["j1"]) {
		t.Fatalf("pending for the judge = %v, was %v", after.Pending["j1"], in.Pending["j1"])
	}
	if after.State != StateStopped || after.StopReason != StopTokenCap {
		t.Fatalf("state %s / %s", after.State, after.StopReason)
	}
	if after.Seen["w"] <= seenBefore {
		t.Fatalf("seen mark %d, was %d: the turn is marked seen", after.Seen["w"], seenBefore)
	}
	if r.published() == pubs {
		t.Fatal("the seen mark moved and nothing was published")
	}

	// the person resumes: the judge gets the kept answer and not the aside
	r.link.agent("w").tokens = 0
	if err := r.m.Resume(ctx, v.Id); err != nil {
		t.Fatalf("Resume: %v", err)
	}
	j := r.link.sent("j1")
	if len(j) != 2 {
		t.Fatalf("the judge was sent %d prompts: want the kept answer delivered", len(j))
	}
	contains(t, "the judge's prompt", j[1], "Fixed it.")
	if strings.Contains(j[1], "An aside.") {
		t.Fatal("the aside reached the judge")
	}
}

// a reply never quotes a message its author has already answered: a second turn of the worker after one that answered the
// person's message has no ReplyTo, and the view draws no quote for it
func TestReplyNeverQuotesAnAnsweredMessage(t *testing.T) {
	r := newRig(t)
	v := pausedByNoNewPoints(t, r)
	if err := r.m.Say(ctx, wshrpc.CommandPairSayData{PairId: v.Id, Text: "Why is the threshold 50%?"}); err != nil {
		t.Fatal(err)
	}
	person := lastLine(r.view(v.Id))

	r.reply("w", "Because the pilot says so.\n"+pairBlock("O1 pilot"))
	first := lastWorkerMsg(r.view(v.Id))
	if first.ReplyTo != person.Id || first.Quote != "Why is the threshold 50%?" {
		t.Fatalf("the first answer = %+v, want it to answer and quote the person's message %s", first, person.Id)
	}

	// a turn of its own, started in the worker's Chat: nothing it was sent is left to answer. The judge's reply behind the
	// earlier stop was never sent to it, and it must not be quoted either.
	r.reply("w", "An aside, on something else.\n"+pairBlock("O1 pilot", "O2 aside"))
	second := lastWorkerMsg(r.view(v.Id))
	if second.Id == first.Id || second.ReplyTo != "" || second.Quote != "" {
		t.Fatalf("the second turn = %+v, want no ReplyTo and no quote", second)
	}

	// the same rule for a judge. It was sent the person's message and the first answer together, and its reply answers the
	// newest of them; the aside was sent after, and its next reply answers that
	r.reply("j1", "> Because the pilot says so.\nFine.")
	if got := lastLine(r.view(v.Id)); got.From != FromJudge || got.ReplyTo != first.Id {
		t.Fatalf("the judge's reply = %+v, want it to answer the worker's first answer %s", got, first.Id)
	}
	r.reply("j1", "Now the aside.")
	if got := lastLine(r.view(v.Id)); got.From != FromJudge || got.ReplyTo != second.Id {
		t.Fatalf("the judge's reply = %+v, want it to answer the aside %s", got, second.Id)
	}
	// a turn of its own: the aside is answered, and neither is the person's message that came in with the first answer
	r.reply("j1", "One more thought of mine.")
	if got := lastLine(r.view(v.Id)); got.From != FromJudge || got.ReplyTo != "" || got.Quote != "" {
		t.Fatalf("the judge's own turn = %+v, want no ReplyTo and no quote", got)
	}
}

// after a stop that is not the cap, a worker's answer still resumes the pair and is recorded and passed to the judge
func TestWorkerAnswerResumesNoNewPoints(t *testing.T) {
	cases := map[string]struct {
		worker, judge, reason string
	}{
		"no new points": {workerPlan, judgeBlock("no new points"), StopNoNewPoints},
		"both agree":    {"Settled.\n" + pairBlock("D1 a"), "```arc-judge\n```", StopSettled},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			r := newRig(t)
			v := r.paired(c.worker)
			r.reply("j1", "> Plan v1.\nNothing to add.\n"+c.judge)
			if view := r.view(v.Id); view.State != StateStopped || view.StopReason != c.reason {
				t.Fatalf("state %s / %s, want a %s stop", view.State, view.StopReason, c.reason)
			}

			r.reply("w", "One more thing the person asked me.\n"+pairBlock("O1 more"))
			view := r.view(v.Id)
			if view.State != StateRelaying || view.StopReason != "" {
				t.Fatalf("state %s / %s after the worker's answer", view.State, view.StopReason)
			}
			if !hasMessage(view, FromWorker, "One more thing the person asked me.") {
				t.Fatalf("the worker's answer is not recorded: %+v", view.Messages)
			}
			j := r.link.sent("j1")
			if len(j) != 2 {
				t.Fatalf("the judge was sent %d prompts: the worker's new answer passes on", len(j))
			}
			contains(t, "the judge's prompt", j[1], "One more thing the person asked me.")
		})
	}
}

func countSystem(v *wshrpc.PairView, text string) int {
	n := 0
	for _, m := range v.Messages {
		if m.From == FromSystem && m.Text == text {
			n++
		}
	}
	return n
}

func TestManagerGoneJudgeIsMarkedAndStopsAPairWithNone(t *testing.T) {
	r := newRig(t)
	v := r.paired(workerPlan)
	delete(r.link.agents, "j1") // the judge's tab was deleted

	r.reply("w", "Again.\n"+pairBlock("O1 x"))
	view := r.view(v.Id)
	if !view.Judges[0].Gone {
		t.Fatalf("judges = %+v: want the judge marked gone", view.Judges)
	}
	if view.State != StateStopped || view.StopReason != StopJudgesGone {
		t.Fatalf("state %s / %s: a pair with no judge left stops", view.State, view.StopReason)
	}
	if n := countSystem(view, `The judge "Judge one" is gone`); n != 1 {
		t.Fatalf("messages = %+v: want one line saying it", view.Messages)
	}
	if view.Owed {
		t.Fatal("a gone judge owes nothing")
	}
}

func TestManagerGoneJudgeLeavesTheOthersRelaying(t *testing.T) {
	r := newRig(t)
	r.link.add("j2", "Judge two")
	r.link.give("w", workerPlan)
	v := r.start(wshrpc.CommandPairStartData{})
	r.start(wshrpc.CommandPairStartData{JudgeTab: "j2"})
	r.link.setState("j2", "idle")
	delete(r.link.agents, "j1")

	r.reply("w", "Again.\n"+pairBlock("O1 x"))
	view := r.view(v.Id)
	if view.State != StateRelaying || !view.Judges[0].Gone || view.Judges[1].Gone {
		t.Fatalf("state %s, judges %+v", view.State, view.Judges)
	}
	if got := r.link.sent("j2"); len(got) != 2 {
		t.Fatalf("judge two was sent %d prompts: it still gets the reply", len(got))
	}
	// the gone judge is out of the pair for good: a new judge can come in
	r.link.add("j3", "Judge three")
	if _, err := r.m.Start(ctx, wshrpc.CommandPairStartData{WorkerTab: "w", JudgeTab: "j3"}); err != nil {
		t.Fatal(err)
	}
}

// what a judge spent before it went still counts: its session is no longer read, so the pair keeps its last count
func TestManagerGoneJudgeTokensStillCount(t *testing.T) {
	r := newRig(t)
	r.link.add("j2", "Judge two")
	r.link.agent("w").tokens, r.link.agent("j1").tokens = 600_000, 900_000
	r.link.give("w", workerPlan)
	v := r.start(wshrpc.CommandPairStartData{TokenCap: 2_000_000})
	r.start(wshrpc.CommandPairStartData{JudgeTab: "j2"})
	r.link.setState("j1", "idle")
	r.link.setState("j2", "idle")
	r.reply("j1", "> Plan v1.\nOne finding.\n"+judgeBlock("new: a"))
	if view := r.view(v.Id); view.Tokens != 1_500_000 {
		t.Fatalf("tokens %d: want the worker's and judge one's", view.Tokens)
	}

	delete(r.link.agents, "j1")
	r.m.memberGone(v.Id, "j1")
	r.link.agent("w").tokens = 1_100_000
	r.reply("w", "Again.\n"+pairBlock("O1 a"))
	view := r.view(v.Id)
	if !view.Judges[0].Gone {
		t.Fatalf("judges %+v: want judge one gone", view.Judges)
	}
	if view.State != StateStopped || view.StopReason != StopTokenCap || view.Tokens != 2_000_000 {
		t.Fatalf("state %s / %s, tokens %d: judge one's 900k still counts, so the pair is at its cap", view.State, view.StopReason, view.Tokens)
	}

	// the person's message resumes the stop, and the cap counts again from it: the gone judge's spend is behind it
	r.link.agent("w").tokens = 0
	if err := r.m.Say(ctx, wshrpc.CommandPairSayData{PairId: v.Id, Text: "Go on."}); err != nil {
		t.Fatal(err)
	}
	if view := r.view(v.Id); view.State != StateRelaying || view.Tokens != 0 {
		t.Fatalf("state %s, tokens %d after the person's message", view.State, view.Tokens)
	}
	if in := r.internal(v.Id); in.Judges[0].Tokens != 0 {
		t.Fatalf("the gone judge still holds %d from before the resume", in.Judges[0].Tokens)
	}
}

func TestManagerResumeAJudgeAddedToAPairWithNoJudgeLeft(t *testing.T) {
	r := newRig(t)
	v := r.paired(workerPlan)
	delete(r.link.agents, "j1")
	r.reply("w", "Again.\n"+pairBlock("O1 x"))
	if view := r.view(v.Id); view.StopReason != StopJudgesGone {
		t.Fatalf("stop = %q", view.StopReason)
	}
	r.link.add("j2", "Judge two")
	view := r.start(wshrpc.CommandPairStartData{JudgeTab: "j2"})
	if view.State != StateRelaying || view.StopReason != "" || view.Id != v.Id {
		t.Fatalf("state %s / %s: a new judge puts the pair back to work", view.State, view.StopReason)
	}
}

func TestManagerGoneWorkerEndsThePair(t *testing.T) {
	r := newRig(t)
	v := r.paired(workerPlan)
	delete(r.link.agents, "w")

	r.reply("j1", "> Plan v1.\nA finding.\n"+judgeBlock("new: a"))
	if len(r.m.List()) != 0 || r.m.Paired("j1") {
		t.Fatalf("List = %+v: a pair whose worker is gone has ended", r.m.List())
	}
	if _, err := r.m.Get(v.Id); err == nil {
		t.Fatal("Get found an ended pair")
	}
	// its file stays, ended
	reloaded := r.manager()
	if reloaded.Paired("j1") {
		t.Fatal("an ended pair came back after a restart")
	}
}

func TestManagerRelaySayAnswersAnItemAndQuotesAReply(t *testing.T) {
	r := newRig(t)
	v := r.paired("Checked.\n" + pairBlock("A3 Is a 50% threshold fine? [Yes | No]", "O1 more"))
	first := v.Messages[0].Id

	if err := r.m.Say(ctx, wshrpc.CommandPairSayData{PairId: v.Id, Text: "Yes", Item: 3, To: ToWorker}); err != nil {
		t.Fatal(err)
	}
	view := r.view(v.Id)
	if len(view.Decided.Asks) != 1 || view.Decided.Asks[0].Answer != "Yes" {
		t.Fatalf("asks = %+v: the answer shows until the next block", view.Decided.Asks)
	}
	w := r.link.sent("w")
	if len(w) != 1 {
		t.Fatalf("the worker was sent %q", w)
	}
	contains(t, "the worker's prompt", w[0], "Answer to A3: Yes")
	if got := r.link.sent("j1"); len(got) != 1 {
		t.Fatalf("the judge was sent %q: @worker talks to the worker alone", got)
	}

	r.link.setState("w", "idle")
	if err := r.m.Say(ctx, wshrpc.CommandPairSayData{PairId: v.Id, Text: "Why this one?", ReplyTo: first, To: ToJudge}); err != nil {
		t.Fatal(err)
	}
	j := r.link.sent("j1")
	if len(j) != 2 {
		t.Fatalf("the judge was sent %q", j)
	}
	contains(t, "the judge's prompt", j[1], "From the person", "> Checked.", "Why this one?")
	if m := lastLine(r.view(v.Id)); m.ReplyTo != first || m.Quote != "Checked." || m.To != ToJudge {
		t.Fatalf("the person's reply = %+v", m)
	}
}

func TestManagerRelaySayToOneJudgeOfSeveral(t *testing.T) {
	r := newRig(t)
	r.link.add("j2", "Judge two")
	r.link.give("w", workerPlan)
	v := r.start(wshrpc.CommandPairStartData{})
	r.start(wshrpc.CommandPairStartData{JudgeTab: "j2"})
	r.link.setState("j1", "idle")
	r.link.setState("j2", "idle")

	if err := r.m.Say(ctx, wshrpc.CommandPairSayData{PairId: v.Id, Text: "Only you, judge two.", To: "j2"}); err != nil {
		t.Fatal(err)
	}
	if got := r.link.sent("j2"); len(got) != 2 {
		t.Fatalf("judge two was sent %d prompts", len(got))
	}
	if got := r.link.sent("j1"); len(got) != 1 {
		t.Fatalf("judge one was sent %d prompts: the message was not for it", len(got))
	}
	if got := r.link.sent("w"); len(got) != 0 {
		t.Fatalf("the worker was sent %q", got)
	}
}

func TestManagerRelaySayRefuses(t *testing.T) {
	r := newRig(t)
	v := r.paired(workerPlan)
	for name, d := range map[string]wshrpc.CommandPairSayData{
		"an empty message":      {PairId: v.Id, Text: "  "},
		"no such pair":          {PairId: "nope", Text: "hi"},
		"a recipient not in it": {PairId: v.Id, Text: "hi", To: "stranger"},
		"a reply to no message": {PairId: v.Id, Text: "hi", ReplyTo: "m99"},
	} {
		if err := r.m.Say(ctx, d); err == nil {
			t.Errorf("%s: Say took it", name)
		}
	}
	if got := r.view(v.Id).Messages; len(got) != 1 {
		t.Fatalf("messages = %+v: the refused ones left no trace", got)
	}
}

func TestManagerStartBriefNamesTheWorkersPlan(t *testing.T) {
	r := newRig(t)
	r.link.agent("w").texts = []string{"old turn", "see docs/superpowers/plans/2026-11-25-x.md first"}
	r.link.give("w", "Latest reply.")
	text, err := r.m.Brief(ctx, "w")
	if err != nil {
		t.Fatal(err)
	}
	contains(t, "the brief", text, "Plan oracle", "Latest reply.", "docs/superpowers/plans/2026-11-25-x.md", "arc-judge")
	if _, err := r.m.Brief(ctx, "nobody"); err == nil {
		t.Fatal("Brief took a tab that is no agent")
	}
}

// a restarted wavesrv: a fresh manager sees the pairs before anyone asks for the list
func TestReloadAnswersPairedAndHoldWithNoListFirst(t *testing.T) {
	r := newRig(t)
	r.paired(workerPlan)
	fresh := r.manager()

	if !fresh.Paired("w") || !fresh.Paired("j1") || fresh.Paired("elsewhere") {
		t.Fatal("a fresh manager does not know its pairs")
	}
	fresh = r.manager()
	if reason, held := fresh.Hold("w", "npm run build"); !held || reason == "" {
		t.Fatal("a fresh manager's hold did not see the pair")
	}
}

func TestReloadKeepsQueuesSeenMarksAndPasses(t *testing.T) {
	r := newRig(t)
	v := r.paired(workerPlan)
	r.link.setState("j1", "working")
	if _, held := r.m.Hold("w", "make build"); !held {
		t.Fatal("not held")
	}
	r.reply("w", "Second.\n"+pairBlock("O1 x")) // waits for the busy judge; the refused command hangs on it
	if err := r.m.RunNow(ctx, wshrpc.CommandPairRunNowData{PairId: v.Id, MsgId: lastWorkerMsg(r.view(v.Id)).Id, Command: "make build"}); err != nil {
		t.Fatal(err)
	}
	before := r.internal(v.Id)

	fresh := r.manager()
	fresh.Paired("w")
	fresh.mu.Lock()
	after := *fresh.pairs[v.Id]
	fresh.mu.Unlock()
	if !reflect.DeepEqual(before.Pending, after.Pending) || !reflect.DeepEqual(before.Seen, after.Seen) || !reflect.DeepEqual(before.Passes, after.Passes) || before.WorkerBriefed != after.WorkerBriefed {
		t.Fatalf("reloaded pending %v seen %v passes %v\nbefore   pending %v seen %v passes %v", after.Pending, after.Seen, after.Passes, before.Pending, before.Seen, before.Passes)
	}
	if len(after.Pending["j1"]) != 1 || len(after.Passes) != 1 {
		t.Fatalf("pending %v, passes %v: the test holds nothing to keep", after.Pending, after.Passes)
	}
	if !reflect.DeepEqual(fresh.mustGet(t, v.Id), r.view(v.Id)) {
		t.Fatal("the reloaded pair reads differently")
	}
}

func (m *Manager) mustGet(t *testing.T, id string) *wshrpc.PairView {
	t.Helper()
	v, err := m.Get(id)
	if err != nil {
		t.Fatal(err)
	}
	return v
}

func lastWorkerMsg(v *wshrpc.PairView) wshrpc.PairMessage {
	for i := len(v.Messages) - 1; i >= 0; i-- {
		if v.Messages[i].From == FromWorker {
			return v.Messages[i]
		}
	}
	return wshrpc.PairMessage{}
}

func TestLoadDeliversAQueueToAnAgentThatIsAlreadyIdle(t *testing.T) {
	r := newRig(t)
	v := r.paired(workerPlan)
	r.link.setState("j1", "working")
	r.reply("w", "Second.\n"+pairBlock("O1 x")) // queued for the judge, which is busy
	r.link.setState("j1", "idle")               // wavesrv was down while the judge finished: no status event reached it

	fresh := r.manager()
	fresh.Load(ctx)
	j := r.link.sent("j1")
	if len(j) != 2 {
		t.Fatalf("the judge was sent %d prompts: Load delivers the queue to an idle agent", len(j))
	}
	contains(t, "the judge's prompt", j[1], "Second.")
	fresh.mu.Lock()
	left := fresh.pairs[v.Id].Pending["j1"]
	fresh.mu.Unlock()
	if len(left) != 0 {
		t.Fatalf("pending = %v", left)
	}
}

func TestLoadTakesAnAnswerGivenWhileWavesrvWasDown(t *testing.T) {
	r := newRig(t)
	v := r.paired(workerPlan)
	r.link.give("j1", "> Plan v1.\nDone while you were away.\n"+judgeBlock("new: a")) // no TurnEnded was seen
	r.link.setState("j1", "idle")

	fresh := r.manager()
	fresh.Load(ctx)
	view := fresh.mustGet(t, v.Id)
	if len(view.Messages) != 2 || view.Messages[1].From != FromJudge {
		t.Fatalf("messages = %+v: want the judge's answer taken", view.Messages)
	}
	if w := r.link.sent("w"); len(w) != 1 {
		t.Fatalf("the worker was sent %d prompts: the taken answer is delivered", len(w))
	}
}

// at boot the roster is empty, so every member reads gone: that is no news, and it ends nothing
func TestLoadWhenEveryMemberReadsGoneChangesNothing(t *testing.T) {
	r := newRig(t)
	v := r.paired(workerPlan)
	r.link.setState("j1", "working")
	r.reply("w", "Second.\n"+pairBlock("O1 x")) // waits in the judge's queue
	sentBefore := len(r.link.sent("j1"))
	r.link.setState("w", "gone")
	r.link.setState("j1", "gone")

	fresh := r.manager()
	fresh.Load(ctx)
	view := fresh.mustGet(t, v.Id)
	if view.State != StateRelaying || view.Judges[0].Gone || view.Worker.Gone {
		t.Fatalf("state %s, worker %+v, judges %+v: Load marked a member gone", view.State, view.Worker, view.Judges)
	}
	if n := countSystem(view, `The judge "Judge one" is gone`); n != 0 || lastLine(view).From == FromSystem {
		t.Fatalf("messages = %+v: Load wrote a line", view.Messages)
	}
	fresh.mu.Lock()
	left := len(fresh.pairs[v.Id].Pending["j1"])
	fresh.mu.Unlock()
	if left != 1 {
		t.Fatalf("pending[j1] has %d: the queue is kept", left)
	}
	if len(r.link.sent("j1")) != sentBefore {
		t.Fatal("Load sent to a member that reads gone")
	}

	// the roster comes back as the agents are restored; the first idle of a member delivers
	r.link.setState("w", "idle")
	r.link.setState("j1", "idle")
	fresh.TurnEnded(ctx, "w")
	j := r.link.sent("j1")
	if len(j) != sentBefore+1 {
		t.Fatalf("the judge was sent %d prompts: its queue goes on the first idle after the restore", len(j))
	}
	contains(t, "the judge's prompt", j[len(j)-1], "Second.")
	if view := fresh.mustGet(t, v.Id); view.Judges[0].Gone {
		t.Fatal("the judge was marked gone")
	}
}

func TestManagerRelayTurnEndedOfAnUnpairedTabDoesNothing(t *testing.T) {
	r := newRig(t)
	r.paired(workerPlan)
	r.link.add("loner", "Loner")
	n := r.published()
	r.m.TurnEnded(ctx, "loner")
	if r.published() != n {
		t.Fatal("a turn end of an agent in no pair published")
	}
}

// a turn end twice for one answer (a status replayed, or Start and the hook racing) takes the answer once
func TestManagerRelayTakesAnAnswerOnce(t *testing.T) {
	r := newRig(t)
	v := r.paired(workerPlan)
	r.reply("j1", "> Plan v1.\nA finding.\n"+judgeBlock("new: a"))
	r.m.TurnEnded(ctx, "j1")
	r.m.TurnEnded(ctx, "j1")
	if got := r.view(v.Id).Messages; len(got) != 2 {
		t.Fatalf("messages = %+v: the same answer taken again", got)
	}
}

// the status hook runs TurnEnded off the publishing goroutine, so two can overlap: one answer, one message, one prompt
func TestManagerRelayConcurrentTurnEndsTakeAndSendOnce(t *testing.T) {
	r := newRig(t)
	v := r.paired(workerPlan)
	r.link.give("j1", "> Plan v1.\nA finding.\n"+judgeBlock("new: a"))
	r.link.setState("j1", "idle")

	var wg sync.WaitGroup
	for range 8 {
		wg.Go(func() { r.m.TurnEnded(ctx, "j1") })
	}
	wg.Wait()
	if got := r.view(v.Id).Messages; len(got) != 2 {
		t.Fatalf("messages = %+v: the one answer was taken more than once", got)
	}
	if got := r.link.sent("w"); len(got) != 1 {
		t.Fatalf("the worker was sent %d prompts: want the judge's reply once", len(got))
	}
}

// a nil slice reaches the frontend as null
func TestManagerStartListsAreNeverNil(t *testing.T) {
	r := newRig(t)
	if got := r.m.List(); got == nil || len(got) != 0 {
		t.Fatalf("List = %#v: want an empty slice, not null", got)
	}
	v := r.paired(workerPlan)
	view := r.view(v.Id)
	if view.Judges == nil || view.Messages == nil || view.Decided.Asks == nil || view.Decided.Agreed == nil || view.Decided.Open == nil {
		t.Fatalf("a nil list reaches the wire as null: %+v", view)
	}
	if list := r.m.List(); len(list) != 1 || list[0].Judges == nil {
		t.Fatalf("List = %+v", list)
	}
}

// a side's session id is its transcript's file name, with either kind of separator
func TestStartStoresSessions(t *testing.T) {
	r := newRig(t)
	r.link.agent("w").transcript = "/home/u/.claude/projects/p/sess-w.jsonl"
	r.link.agent("j1").transcript = `C:\Users\u\.claude\projects\p\sess-j1.jsonl`
	v := r.paired(workerPlan)

	if v.Worker.Session != "sess-w" || len(v.Judges) != 1 || v.Judges[0].Session != "sess-j1" {
		t.Fatalf("worker %+v, judges %+v: want each side's session id from its transcript", v.Worker, v.Judges)
	}
	// the ids are in the file: a fresh manager, as after a restart, reads them back
	back := r.manager().mustGet(t, v.Id)
	if back.Worker.Session != "sess-w" || back.Judges[0].Session != "sess-j1" {
		t.Fatalf("reloaded worker %+v, judges %+v: the ids were not saved", back.Worker, back.Judges)
	}
}

func TestJudgeJoinStoresSession(t *testing.T) {
	r := newRig(t)
	r.link.add("j2", "Judge two").transcript = "/c/sess-j2.jsonl"
	r.link.give("w", workerPlan)
	r.start(wshrpc.CommandPairStartData{})
	v := r.start(wshrpc.CommandPairStartData{JudgeTab: "j2"})

	if len(v.Judges) != 2 || v.Judges[1].Session != "sess-j2" {
		t.Fatalf("judges = %+v: the joining judge carries its own session id", v.Judges)
	}
	if v.Worker.Session != "w" || v.Judges[0].Session != "j1" {
		t.Fatalf("worker %+v, first judge %+v: joining a judge leaves the other ids as they were", v.Worker, v.Judges[0])
	}
	if back := r.manager().mustGet(t, v.Id); back.Judges[1].Session != "sess-j2" {
		t.Fatalf("reloaded judges = %+v: the joining judge's id was not saved", back.Judges)
	}
}

// a side whose agent had no transcript when it joined takes its id at its first turn end
func TestSessionAtFirstTurnEnd(t *testing.T) {
	r := newRig(t)
	r.link.agent("w").transcript, r.link.agent("j1").transcript = "", ""
	v := r.paired(workerPlan)
	if v.Worker.Session != "" || v.Judges[0].Session != "" {
		t.Fatalf("worker %+v, judges %+v: a transcript-less agent has no id to store", v.Worker, v.Judges)
	}

	// a read that fails is logged, the turn goes on, and the next turn end asks again
	r.link.agentErr = errors.New("the roster is not answering")
	reads := r.link.agentReads("j1")
	r.reply("j1", "> Plan v1.\nA finding.\n"+judgeBlock("new: a"))
	view := r.view(v.Id)
	if view.Judges[0].Session != "" || len(view.Messages) != 2 {
		t.Fatalf("judges %+v, messages %d: a failed read must not stop the turn from being taken", view.Judges, len(view.Messages))
	}
	if r.link.agentReads("j1") != reads+1 {
		t.Fatalf("the judge's turn end read the roster %d times, want once", r.link.agentReads("j1")-reads)
	}
	r.link.agentErr = nil

	// the agent still reports no transcript: no id, and the next turn end asks again
	r.m.TurnEnded(ctx, "j1")
	if r.view(v.Id).Judges[0].Session != "" || r.link.agentReads("j1") != reads+2 {
		t.Fatalf("judges %+v, reads %d: an agent with no transcript is asked again", r.view(v.Id).Judges, r.link.agentReads("j1"))
	}

	// the transcript appears: the next turn end stores the id, saves and publishes it
	r.link.agent("j1").transcript = "/c/sess-j1.jsonl"
	published := r.published()
	r.m.TurnEnded(ctx, "j1")
	if got := r.view(v.Id).Judges[0].Session; got != "sess-j1" {
		t.Fatalf("judge session = %q, want sess-j1", got)
	}
	if r.published() <= published {
		t.Fatal("storing the id published no pair:update")
	}
	if r.view(v.Id).Worker.Session != "" {
		t.Fatal("a judge's turn end gave the worker an id")
	}

	// the worker takes its own at its own first turn end
	r.link.agent("w").transcript = "/c/sess-w.jsonl"
	r.m.TurnEnded(ctx, "w")
	back := r.manager().mustGet(t, v.Id)
	if back.Worker.Session != "sess-w" || back.Judges[0].Session != "sess-j1" {
		t.Fatalf("reloaded worker %+v, judges %+v: both ids are in the file", back.Worker, back.Judges)
	}
}

// the first id a side gets is kept for good, and a side that has one is not read again
func TestSessionKept(t *testing.T) {
	r := newRig(t)
	r.link.add("j2", "Judge two").transcript = ""
	r.link.give("w", workerPlan)
	r.start(wshrpc.CommandPairStartData{})
	v := r.start(wshrpc.CommandPairStartData{JudgeTab: "j2"})

	// j1 was paired with an id: the roster later names another session, and no turn end asks
	readsJ1 := r.link.agentReads("j1")
	r.link.agent("j1").transcript = "/c/resumed.jsonl"
	r.reply("j1", "> Plan v1.\nA finding.\n"+judgeBlock("new: a"))
	r.m.TurnEnded(ctx, "j1")
	if got := r.view(v.Id).Judges[0].Session; got != "j1" {
		t.Fatalf("judge session = %q, want j1: the first one stays", got)
	}
	if r.link.agentReads("j1") != readsJ1 {
		t.Fatalf("a side that has an id was read %d more times", r.link.agentReads("j1")-readsJ1)
	}

	// j2 found its id at its first turn end: that one stays too
	r.link.agent("j2").transcript = "/c/first.jsonl"
	r.m.TurnEnded(ctx, "j2")
	readsJ2 := r.link.agentReads("j2")
	r.link.agent("j2").transcript = "/c/second.jsonl"
	r.m.TurnEnded(ctx, "j2")
	r.reply("j2", "> Plan v1.\nAnother.\n"+judgeBlock("new: b"))
	if got := r.view(v.Id).Judges[1].Session; got != "first" {
		t.Fatalf("judge two session = %q, want first", got)
	}
	if r.link.agentReads("j2") != readsJ2 {
		t.Fatalf("a side that has an id was read %d more times", r.link.agentReads("j2")-readsJ2)
	}
}

// every change saves through one place, and that place stamps the pair with the manager's clock
func TestSaveStampsUpdated(t *testing.T) {
	r := newRig(t)
	now := int64(5_000_000)
	r.m.Now = func() time.Time { return time.UnixMilli(now) }
	r.link.give("w", workerPlan)
	v := r.start(wshrpc.CommandPairStartData{})
	if v.UpdatedTs != 5_000_000 {
		t.Fatalf("UpdatedTs = %d after Start, want 5000000", v.UpdatedTs)
	}

	now = 6_000_000
	if err := r.m.Say(ctx, wshrpc.CommandPairSayData{PairId: v.Id, Text: "keep going"}); err != nil {
		t.Fatal(err)
	}
	if got := r.view(v.Id).UpdatedTs; got != 6_000_000 {
		t.Fatalf("UpdatedTs = %d after a message, want 6000000", got)
	}

	now = 7_000_000
	r.reply("j1", "> Plan v1.\nA finding.\n"+judgeBlock("new: a"))
	if got := r.view(v.Id).UpdatedTs; got != 7_000_000 {
		t.Fatalf("UpdatedTs = %d after a taken answer, want 7000000", got)
	}
	if back := r.manager().mustGet(t, v.Id); back.UpdatedTs != 7_000_000 {
		t.Fatalf("the file holds UpdatedTs %d, want 7000000", back.UpdatedTs)
	}

	// a turn end that changes nothing leaves the stamp alone
	now = 7_500_000
	r.m.TurnEnded(ctx, "j1")
	if got := r.view(v.Id).UpdatedTs; got != 7_000_000 {
		t.Fatalf("UpdatedTs = %d after a turn end with nothing new, want it unchanged", got)
	}

	// a start that is taken back saves its pair ended, and stamps that save too
	r.link.add("w2", "Other worker")
	r.link.add("j2", "Judge two")
	now = 8_000_000
	r.m.Publish = func(wshrpc.PairUpdateData) { now += 500_000 } // the clock moves between Start's save and its undo
	r.link.sendErr = errors.New("the judge is not listening")
	if _, err := r.m.Start(ctx, wshrpc.CommandPairStartData{WorkerTab: "w2", JudgeTab: "j2"}); err == nil {
		t.Fatal("Start hid a failed brief")
	}
	entries, err := os.ReadDir(r.dir)
	if err != nil {
		t.Fatal(err)
	}
	var ended []Pair
	for _, e := range entries {
		if e.Name() == v.Id+".json" {
			continue
		}
		data, err := os.ReadFile(filepath.Join(r.dir, e.Name()))
		if err != nil {
			t.Fatal(err)
		}
		var p Pair
		if err := json.Unmarshal(data, &p); err != nil {
			t.Fatal(err)
		}
		ended = append(ended, p)
	}
	if len(ended) != 1 || ended[0].State != StateEnded || ended[0].UpdatedTs != 8_500_000 {
		t.Fatalf("the taken-back pair = %+v, want one ended pair stamped 8500000 by its undo", ended)
	}
}

// a pair that came from another machine lives in a sibling folder the manager is never given: it is never listed, never
// delivered to, and its file is never written
func TestSyncedNeverLoaded(t *testing.T) {
	r := newRig(t)
	own := r.paired(workerPlan)
	r.link.add("sw", "Synced worker")
	r.link.add("sj", "Synced judge")
	syncedDir := filepath.Join(filepath.Dir(r.dir), SyncedDirName)
	synced := &Pair{
		Id: "synced-1", Project: "proj", TokenCap: DefaultTokenCap, CreatedTs: 1, UpdatedTs: 2, CapFromTs: 1, State: StateRelaying,
		Worker:   Side{Tab: "sw", Name: "Synced worker", Harness: "claude", Session: "sess-sw"},
		Judges:   []Side{{Tab: "sj", Name: "Synced judge", Harness: "claude", Session: "sess-sj"}},
		Messages: []Message{{Id: "m1", From: FromWorker, Tab: "sw", Ts: 1, Raw: "Plan v1."}},
		Pending:  map[string][]string{"sj": {"m1"}}, Seen: map[string]int64{"sw": 1},
	}
	file := store{dir: syncedDir}.path(synced.Id)
	if err := (store{dir: syncedDir}).save(synced); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	// its agents are on the roster, idle, with answers newer than the file knows: a manager that read the file would act
	r.link.give("sw", "Plan v2.\n"+pairBlock("O1 x"))
	r.link.give("sj", "> Plan v1.\nA finding.\n"+judgeBlock("new: a"))

	m := r.manager()
	m.Load(ctx)
	if got := m.List(); len(got) != 1 || got[0].Id != own.Id {
		t.Fatalf("List = %+v, want only the own folder's pair", got)
	}
	if m.Paired("sw") || m.Paired("sj") {
		t.Fatal("a synced pair's agents read as paired")
	}
	m.TurnEnded(ctx, "sw")
	m.TurnEnded(ctx, "sj")
	if after, err := os.ReadFile(file); err != nil || !bytes.Equal(before, after) {
		t.Fatalf("the synced file changed (read error %v)", err)
	}
	if len(r.link.sent("sw")) != 0 || len(r.link.sent("sj")) != 0 {
		t.Fatal("a synced pair's agents were sent a prompt")
	}
	if entries, err := os.ReadDir(r.dir); err != nil || len(entries) != 1 {
		t.Fatalf("the own folder holds %d entries (error %v), want its one pair file", len(entries), err)
	}
}
