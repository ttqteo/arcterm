// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentpair

import (
	"context"
	"fmt"
	"path/filepath"
	"reflect"
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
}

// fakeLink is a Link over a map of agents. A send starts a turn, as it does on the real roster.
type fakeLink struct {
	mu      sync.Mutex
	agents  map[string]*fakeAgent
	clock   int64
	sendErr error
}

func newFakeLink() *fakeLink { return &fakeLink{agents: map[string]*fakeAgent{}, clock: 1_000_000} }

func (l *fakeLink) add(tab, name string) *fakeAgent {
	a := &fakeAgent{name: name, harness: "claude", project: "proj", state: "idle"}
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
	return AgentFacts{Name: a.name, Harness: a.harness, Project: a.project, Cwd: "/work/" + tab, Transcript: "/t/" + tab}, nil
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
	if got := r.link.sent("j1"); len(got) != 2 {
		t.Fatalf("the judge was sent %d prompts: it gets the person's message too", len(got))
	}
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
	if r.published() == pubs {
		t.Fatal("the worker's reply changed the pair and published nothing")
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
	if in := r.internal(v.Id); in.CapFromTs <= in.CreatedTs {
		t.Fatalf("the cap counts from %d, pairing was at %d", in.CapFromTs, in.CreatedTs)
	}
	j := r.link.sent("j1")
	if len(j) != 2 {
		t.Fatalf("the judge was sent %d prompts: want the held reply and the person's message in one", len(j))
	}
	contains(t, "the judge's prompt", j[1], "Another reply.", "Spend a bit more.")
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
