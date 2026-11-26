// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
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
	"github.com/wavetermdev/waveterm/pkg/agentpair"
	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// tab and block ids a status report can name: an oref carries a uuid
const (
	pairWorkerTab   = "a1111111-0000-4000-8000-0000000000a1"
	pairJudgeTab    = "b2222222-0000-4000-8000-0000000000b2"
	pairOtherTab    = "c3333333-0000-4000-8000-0000000000c3"
	pairJudgeBlock  = "d4444444-0000-4000-8000-0000000000d4"
	pairWorkerReply = "Plan: lock the threshold before the pilot.\n```arc-pair\nO1 lock the threshold first\n```"
)

// fakePairLink is the roster the pair manager sees in these tests: a state, a last answer and a log of what it was sent.
type fakePairLink struct {
	mu      sync.Mutex
	states  map[string]string
	answers map[string]fakePairAnswer
	tokens  map[string]int64 // what each tab spent since the cap started; a tab with none spent 0
	sent    []agentsDelivery // blockId holds the tab the prompt went to
	reads   []string         // the tabs whose last answer was read
	slept   []string         // the tabs the pair put to sleep, in order
}

type fakePairAnswer struct {
	text string
	ts   int64
}

func (l *fakePairLink) State(_ context.Context, tab string) (string, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if s, ok := l.states[tab]; ok {
		return s, nil
	}
	return agentpair.LinkGone, nil
}

func (l *fakePairLink) Send(_ context.Context, tab, text string) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.sent = append(l.sent, agentsDelivery{tab, text})
	return nil
}

func (l *fakePairLink) LastAnswer(_ context.Context, tab string) (string, int64, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.reads = append(l.reads, tab)
	a := l.answers[tab]
	return a.text, a.ts, nil
}

// AnswerAt knows no older replies: these tests start every pair from the latest.
func (l *fakePairLink) AnswerAt(_ context.Context, tab, uuid string) (string, int64, error) {
	return "", 0, fmt.Errorf("no reply %s in the transcript of %s", uuid, tab)
}

func (l *fakePairLink) Tokens(_ context.Context, tab string, _ int64) (int64, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.tokens[tab], nil
}

func (l *fakePairLink) setTokens(tab string, n int64) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.tokens[tab] = n
}

func (l *fakePairLink) Agent(_ context.Context, tab string) (agentpair.AgentFacts, error) {
	switch tab {
	case pairWorkerTab:
		return agentpair.AgentFacts{Name: "plan worker", Harness: "claude", Project: "thesis"}, nil
	case pairJudgeTab:
		return agentpair.AgentFacts{Name: "judge", Harness: "claude", Project: "thesis"}, nil
	}
	return agentpair.AgentFacts{}, errNoSeat
}

func (l *fakePairLink) RecentTexts(context.Context, string, int) ([]string, error) { return nil, nil }

// Sleep puts an idle agent to sleep and refuses any other, as the roster's sleep does.
func (l *fakePairLink) Sleep(_ context.Context, tab string) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	if s := l.states[tab]; s != agentpair.LinkIdle {
		return fmt.Errorf("agent %s is not idle (%q); only an idle agent can sleep", tab, s)
	}
	l.states[tab] = agentpair.LinkSleeping
	l.slept = append(l.slept, tab)
	return nil
}

func (l *fakePairLink) sleeps() []string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return append([]string(nil), l.slept...)
}

func (l *fakePairLink) answer(tab, text string, ts int64) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.answers[tab] = fakePairAnswer{text, ts}
}

func (l *fakePairLink) setState(tab, state string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.states[tab] = state
}

func (l *fakePairLink) deliveries() []agentsDelivery {
	l.mu.Lock()
	defer l.mu.Unlock()
	return append([]agentsDelivery(nil), l.sent...)
}

func (l *fakePairLink) readTabs() []string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return append([]string(nil), l.reads...)
}

func (l *fakePairLink) forgetReads() {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.reads = nil
}

// pairWorld is a pair manager over a temp dir and a scripted link, installed as wavesrv's own for the test.
type pairWorld struct {
	t         *testing.T
	link      *fakePairLink
	ownDir    string // the manager's folder of pair files
	syncedDir string // the folder pairs synced from another machine are read from, never the manager
	mu        sync.Mutex
	updates   []wshrpc.PairUpdateData
}

func newPairWorld(t *testing.T) *pairWorld {
	t.Helper()
	w := &pairWorld{t: t, link: &fakePairLink{
		states:  map[string]string{pairWorkerTab: agentpair.LinkIdle, pairJudgeTab: agentpair.LinkIdle},
		answers: map[string]fakePairAnswer{},
		tokens:  map[string]int64{},
	}, ownDir: t.TempDir(), syncedDir: t.TempDir()}
	w.setManager(w.newManager(w.ownDir))
	oldDirs := pairDirs
	pairDirs = func() (string, string) { return w.ownDir, w.syncedDir }
	t.Cleanup(func() { pairDirs = oldDirs })
	return w
}

// syncPair leaves a pair file in the synced folder as the other machine's sync would: the working agent's one reply,
// each side with its session id.
func (w *pairWorld) syncPair(id, project, state string, updated int64) {
	w.t.Helper()
	data, err := json.Marshal(map[string]any{
		"id": id, "project": project, "state": state, "stopreason": agentpair.StopSettled,
		"worker":    map[string]any{"tab": "far-w", "name": "far worker", "harness": "claude", "session": "sess-w"},
		"judges":    []any{map[string]any{"tab": "far-j", "name": "far judge", "harness": "claude", "session": "sess-j"}},
		"createdts": updated - 100, "updated": updated,
		"messages": []any{map[string]any{"id": "m1", "from": agentpair.FromWorker, "tab": "far-w", "ts": updated - 50, "raw": pairWorkerReply}},
	})
	if err != nil {
		w.t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(w.syncedDir, id+".json"), data, 0o600); err != nil {
		w.t.Fatal(err)
	}
}

func (w *pairWorld) newManager(dir string) *agentpair.Manager {
	return &agentpair.Manager{Link: w.link, Dir: dir, Publish: func(u wshrpc.PairUpdateData) {
		w.mu.Lock()
		defer w.mu.Unlock()
		w.updates = append(w.updates, u)
	}}
}

// setManager makes m wavesrv's pair manager until the test ends
func (w *pairWorld) setManager(m *agentpair.Manager) {
	pairManagerMu.Lock()
	old := pairManager
	pairManager = m
	pairManagerMu.Unlock()
	w.t.Cleanup(func() {
		pairWork.Wait()
		pairManagerMu.Lock()
		pairManager = old
		pairManagerMu.Unlock()
	})
}

func (w *pairWorld) start(hold bool) *wshrpc.PairView {
	w.t.Helper()
	w.link.answer(pairWorkerTab, pairWorkerReply, 1000)
	view, err := (&WshServer{}).PairStartCommand(context.Background(), wshrpc.CommandPairStartData{
		WorkerTab: pairWorkerTab, JudgeTab: pairJudgeTab, HoldHeavy: hold,
	})
	if err != nil {
		w.t.Fatal(err)
	}
	return view
}

func (w *pairWorld) view(id string) *wshrpc.PairView {
	w.t.Helper()
	view, err := (&WshServer{}).PairGetCommand(context.Background(), wshrpc.CommandPairGetData{PairId: id})
	if err != nil {
		w.t.Fatal(err)
	}
	return view
}

func (w *pairWorld) updated() []wshrpc.PairUpdateData {
	w.mu.Lock()
	defer w.mu.Unlock()
	return append([]wshrpc.PairUpdateData(nil), w.updates...)
}

func statusOf(tabOrBlockORef, state string) *wps.WaveEvent {
	return &wps.WaveEvent{Event: wps.Event_AgentStatus, Data: baseds.AgentStatusData{ORef: tabOrBlockORef, State: state}}
}

func tabORef(tab string) string { return waveobj.MakeORef(waveobj.OType_Tab, tab).String() }

// the handlers drive the real manager: a pair is made, talked to, given a held command to let through, and ended
func TestPairHandlers(t *testing.T) {
	ctx := context.Background()
	ws := &WshServer{}
	w := newPairWorld(t)

	w.link.answer(pairWorkerTab, pairWorkerReply, 1000)
	brief, err := ws.PairBriefCommand(ctx, wshrpc.CommandPairBriefData{WorkerTab: pairWorkerTab})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(brief.Text, "lock the threshold before the pilot") || !strings.Contains(brief.Text, "plan worker") {
		t.Errorf("the brief names neither the worker nor its latest reply:\n%s", brief.Text)
	}

	empty, err := ws.PairListCommand(ctx)
	if err != nil || empty.Pairs == nil || len(empty.Pairs) != 0 {
		t.Fatalf("an empty list = %+v, %v, want a non-nil empty one (it reaches the frontend as an array)", empty, err)
	}

	view := w.start(true)
	if view.Worker.Tab != pairWorkerTab || len(view.Judges) != 1 || view.Judges[0].Tab != pairJudgeTab || view.State != agentpair.StateRelaying {
		t.Fatalf("started view = %+v", view.PairInfo)
	}
	if len(view.Messages) != 1 || view.Messages[0].From != agentpair.FromWorker {
		t.Fatalf("messages = %+v, want the working agent's reply as the first", view.Messages)
	}
	if sent := w.link.deliveries(); len(sent) != 1 || sent[0].blockId != pairJudgeTab || !agentmsg.IsAgentMessage(sent[0].text) {
		t.Fatalf("the judge was sent %+v, want its brief in the pair's envelope", sent)
	}
	list, err := ws.PairListCommand(ctx)
	if err != nil || len(list.Pairs) != 1 || list.Pairs[0].Id != view.Id {
		t.Fatalf("list = %+v, %v", list, err)
	}
	updates := w.updated()
	if len(updates) == 0 {
		t.Fatal("no pair:update was published")
	}
	for _, u := range updates {
		if u.PairId != view.Id || u.WorkerTab != pairWorkerTab {
			t.Errorf("update %+v names another pair or tab than %s / %s", u, view.Id, pairWorkerTab)
		}
	}

	if err := ws.PairSayCommand(ctx, wshrpc.CommandPairSayData{PairId: view.Id, Text: "  "}); err == nil {
		t.Error("an empty message was accepted")
	}
	if err := ws.PairSayCommand(ctx, wshrpc.CommandPairSayData{PairId: view.Id, Text: "go on", To: "worker"}); err != nil {
		t.Fatal(err)
	}
	sent := w.link.deliveries()
	if last := sent[len(sent)-1]; last.blockId != pairWorkerTab || !strings.Contains(last.text, "go on") {
		t.Fatalf("the working agent was sent %+v, want the person's message", last)
	}

	// the working agent proposes a heavy command: held while the judge owes, and shown on its next reply
	if reason, held := getPairManager().Hold(pairWorkerTab, "task check:ts"); !held || !strings.Contains(reason, "`task check:ts`") {
		t.Fatalf("Hold = %q, %v, want the command held", reason, held)
	}
	w.link.answer(pairWorkerTab, "I mean to run `task check:ts`.\n```arc-pair\nO1 lock the threshold first\n```", 3000)
	getPairManager().TurnEnded(ctx, pairWorkerTab)
	var heldMsg string
	for _, m := range w.view(view.Id).Messages {
		if len(m.Held) == 1 {
			heldMsg = m.Id
		}
	}
	if heldMsg == "" {
		t.Fatalf("no message carries the held command: %+v", w.view(view.Id).Messages)
	}
	if err := ws.PairRunNowCommand(ctx, wshrpc.CommandPairRunNowData{PairId: view.Id, MsgId: heldMsg, Command: "task check:ts"}); err != nil {
		t.Fatal(err)
	}
	if _, held := getPairManager().Hold(pairWorkerTab, "task check:ts"); held {
		t.Error("the command Run now let through was held again")
	}
	sent = w.link.deliveries()
	if last := sent[len(sent)-1]; last.blockId != pairWorkerTab || !strings.Contains(last.text, "Run `task check:ts` now") {
		t.Fatalf("the working agent was sent %+v, want the Run now message", last)
	}

	if err := ws.PairUnpairCommand(ctx, wshrpc.CommandPairGetData{PairId: view.Id}); err != nil {
		t.Fatal(err)
	}
	if list, _ := ws.PairListCommand(ctx); len(list.Pairs) != 0 {
		t.Errorf("an ended pair is still listed: %+v", list.Pairs)
	}
	// an ended pair is no longer the manager's, but its file still reads: PairGet serves it from there
	if ended, err := ws.PairGetCommand(ctx, wshrpc.CommandPairGetData{PairId: view.Id}); err != nil || ended.State != agentpair.StateEnded {
		t.Errorf("an ended pair reads as %+v, %v, want it from its file, ended", ended, err)
	}
	if _, err := ws.PairGetCommand(ctx, wshrpc.CommandPairGetData{PairId: "no-such-pair"}); !errors.Is(err, agentpair.ErrNoPair) {
		t.Errorf("a pair that never was reads as %v, want ErrNoPair", err)
	}
	if err := ws.PairSayCommand(ctx, wshrpc.CommandPairSayData{PairId: "no-such-pair", Text: "hi"}); err == nil {
		t.Error("a message to no pair was accepted")
	}
}

// PairResume puts a pair stopped at its token cap back to relaying and sends the judge what was held, with no message of
// the person's; each pair it cannot resume gets an error, and none is changed
func TestPairHandlersResume(t *testing.T) {
	ctx := context.Background()
	ws := &WshServer{}
	w := newPairWorld(t)
	resume := func(id string) error { return ws.PairResumeCommand(ctx, wshrpc.CommandPairGetData{PairId: id}) }

	view := w.start(true)
	if err := resume(view.Id); err == nil || !strings.Contains(err.Error(), "not stopped") {
		t.Fatalf("Resume of a relaying pair = %v, want a refusal that says it is not stopped", err)
	}

	// the judge is at work, so the worker's next reply waits in its queue; the judge is over the cap when the worker ends the
	// turn (the cap counts the judge's tokens only)
	w.link.setState(pairJudgeTab, agentpair.LinkWorking)
	w.link.setTokens(pairJudgeTab, agentpair.DefaultTokenCap+1)
	w.link.answer(pairWorkerTab, "Held reply.\n```arc-pair\nO1 lock the threshold first\n```", 2000)
	getPairManager().TurnEnded(ctx, pairWorkerTab)
	stopped := w.view(view.Id)
	if stopped.State != agentpair.StateStopped || stopped.StopReason != agentpair.StopTokenCap || !stopped.CanResume {
		t.Fatalf("state %s / %s, canresume %v: want a token-cap stop that can resume", stopped.State, stopped.StopReason, stopped.CanResume)
	}
	sentBefore := len(w.link.deliveries())

	w.link.setState(pairJudgeTab, agentpair.LinkIdle)
	w.link.setTokens(pairJudgeTab, 0)
	if err := resume(view.Id); err != nil {
		t.Fatalf("Resume of a pair stopped at the token cap: %v", err)
	}
	resumed := w.view(view.Id)
	if resumed.State != agentpair.StateRelaying || resumed.StopReason != "" || resumed.CanResume || resumed.Tokens != 0 {
		t.Fatalf("state %s / %s, canresume %v, tokens %d after Resume", resumed.State, resumed.StopReason, resumed.CanResume, resumed.Tokens)
	}
	if len(resumed.Messages) != len(stopped.Messages) {
		t.Fatalf("%d messages after Resume, %d before: it writes none", len(resumed.Messages), len(stopped.Messages))
	}
	sent := w.link.deliveries()
	if len(sent) != sentBefore+1 || sent[sentBefore].blockId != pairJudgeTab || !strings.Contains(sent[sentBefore].text, "Held reply.") {
		t.Fatalf("after Resume the judge was sent %+v, want the held reply", sent[sentBefore:])
	}
	if err := resume(view.Id); err == nil || !strings.Contains(err.Error(), "not stopped") {
		t.Fatalf("a second Resume = %v, want a refusal: the pair already relays", err)
	}

	// a pair that is not the manager's cannot be resumed: one that never was, one that ended, one synced from another machine
	if err := resume("no-such-pair"); !errors.Is(err, agentpair.ErrNoPair) {
		t.Fatalf("Resume of a pair that never was = %v, want ErrNoPair", err)
	}
	w.syncPair("far1", "thesis", agentpair.StateStopped, 5000)
	if err := resume("far1"); !errors.Is(err, agentpair.ErrNoPair) {
		t.Fatalf("Resume of a synced pair = %v, want ErrNoPair", err)
	}
	if far := w.view("far1"); !far.Synced || far.CanResume {
		t.Fatalf("a synced pair reads synced %v, canresume %v: want synced, not resumable", far.Synced, far.CanResume)
	}
	if err := ws.PairUnpairCommand(ctx, wshrpc.CommandPairGetData{PairId: view.Id}); err != nil {
		t.Fatal(err)
	}
	if err := resume(view.Id); !errors.Is(err, agentpair.ErrNoPair) {
		t.Fatalf("Resume of an ended pair = %v, want ErrNoPair", err)
	}
}

// the live list carries the judges that rest (launched ones whose newest pair ended); the history read leaves them out
func TestPairListCarriesTheRestingJudges(t *testing.T) {
	ctx := context.Background()
	ws := &WshServer{}
	w := newPairWorld(t)

	w.link.answer(pairWorkerTab, pairWorkerReply, 1000)
	view, err := ws.PairStartCommand(ctx, wshrpc.CommandPairStartData{WorkerTab: pairWorkerTab, JudgeTab: pairJudgeTab, Launched: true})
	if err != nil {
		t.Fatal(err)
	}
	if list, err := ws.PairListCommand(ctx); err != nil || len(list.Resting) != 0 || len(list.Pairs) != 1 {
		t.Fatalf("list = %+v, %v: want the live pair and nobody resting", list, err)
	}
	if err := ws.PairUnpairCommand(ctx, wshrpc.CommandPairGetData{PairId: view.Id}); err != nil {
		t.Fatal(err)
	}
	list, err := ws.PairListCommand(ctx)
	if err != nil {
		t.Fatal(err)
	}
	want := []wshrpc.PairResting{{Tab: pairJudgeTab, Name: "judge", WorkerTab: pairWorkerTab, PairId: view.Id}}
	if len(list.Pairs) != 0 || !reflect.DeepEqual(list.Resting, want) {
		t.Fatalf("list = %+v, want no pair and %+v resting", list, want)
	}
	history, err := ws.PairHistoryCommand(ctx, wshrpc.CommandPairHistoryData{})
	if err != nil || len(history.Pairs) != 1 || len(history.Resting) != 0 {
		t.Fatalf("history = %+v, %v: want the ended pair, and the resting list left to the live read", history, err)
	}
}

// a launched judge that was working when the round ended is in no pair any more, and its later idle still reaches the
// manager and puts it to sleep, once
func TestPairStatusHookSleepsAWorkingLaunchedJudgeAtItsNextIdle(t *testing.T) {
	ctx := context.Background()
	w := newPairWorld(t)
	report := func(tab, state string) {
		notePairStatus(statusOf(tabORef(tab), state))
		pairWork.Wait()
	}

	w.link.answer(pairWorkerTab, pairWorkerReply, 1000)
	view, err := (&WshServer{}).PairStartCommand(ctx, wshrpc.CommandPairStartData{WorkerTab: pairWorkerTab, JudgeTab: pairJudgeTab, Launched: true})
	if err != nil {
		t.Fatal(err)
	}
	w.link.answer(pairJudgeTab, "> Plan\nNothing to add.\n```arc-judge\nno new points\n```", 2000)
	report(pairJudgeTab, baseds.AgentState_Idle)
	if stopped := w.view(view.Id); stopped.State != agentpair.StateStopped || stopped.StopReason != agentpair.StopNoNewPoints {
		t.Fatalf("state %s / %s, want the pair stopped at no new points", stopped.State, stopped.StopReason)
	}

	// the judge is working again (a turn of its own), and the person goes back to the working agent
	w.link.setState(pairJudgeTab, agentpair.LinkWorking)
	w.link.answer(pairWorkerTab, "The person asked me for something else.", 5000)
	report(pairWorkerTab, baseds.AgentState_Idle)
	if ended := w.view(view.Id); ended.State != agentpair.StateEnded {
		t.Fatalf("state %s, want the round ended", ended.State)
	}
	if got := w.link.sleeps(); len(got) != 0 {
		t.Fatalf("slept %v at the round's end, while the judge was working", got)
	}
	if getPairManager().Paired(pairJudgeTab) || !getPairManager().Watches(pairJudgeTab) {
		t.Fatal("the judge is in a pair, or its next idle is not the manager's")
	}

	w.link.setState(pairJudgeTab, agentpair.LinkIdle)
	report(pairJudgeTab, baseds.AgentState_Idle)
	if got := w.link.sleeps(); !reflect.DeepEqual(got, []string{pairJudgeTab}) {
		t.Fatalf("slept %v at its next idle, want the judge once", got)
	}
	w.link.setState(pairJudgeTab, agentpair.LinkIdle)
	report(pairJudgeTab, baseds.AgentState_Idle)
	if got := w.link.sleeps(); len(got) != 1 {
		t.Fatalf("slept %v: the judge was put to sleep again at a later idle", got)
	}
}

func pairIds(pairs []wshrpc.PairInfo) []string {
	ids := []string{}
	for _, p := range pairs {
		ids = append(ids, p.Id)
	}
	return ids
}

// the history lists a project's pairs of both folders in every state, newest first, and puts none in the manager
func TestPairHistoryCommandListsBothFolders(t *testing.T) {
	ctx := context.Background()
	ws := &WshServer{}
	w := newPairWorld(t)
	live := w.start(true) // relaying, in project "thesis"; its time is its last message's (1000), or the clock's once saves stamp it
	w.syncPair("far1", "thesis", agentpair.StateEnded, 400)
	w.syncPair("far2", "elsewhere", agentpair.StateRelaying, 500)

	all, err := ws.PairHistoryCommand(ctx, wshrpc.CommandPairHistoryData{})
	if err != nil {
		t.Fatal(err)
	}
	if got, want := pairIds(all.Pairs), []string{live.Id, "far2", "far1"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("every project listed %v, want %v (newest first)", got, want)
	}
	byId := map[string]wshrpc.PairInfo{}
	for _, p := range all.Pairs {
		byId[p.Id] = p
	}
	if p := byId[live.Id]; p.Synced || p.State != agentpair.StateRelaying {
		t.Errorf("the live pair = %+v, want relaying and not synced", p)
	}
	if p := byId["far1"]; !p.Synced || p.State != agentpair.StateEnded || p.Worker.Session != "sess-w" || p.Judges[0].Session != "sess-j" {
		t.Errorf("the synced ended pair = %+v, want synced and ended, with its sides' sessions", p)
	}
	if p := byId["far2"]; !p.Synced || p.State != agentpair.StateRelaying {
		t.Errorf("the synced relaying pair = %+v, want it as the file left it", p)
	}

	thesis, err := ws.PairHistoryCommand(ctx, wshrpc.CommandPairHistoryData{Project: "thesis"})
	if err != nil {
		t.Fatal(err)
	}
	if got, want := pairIds(thesis.Pairs), []string{live.Id, "far1"}; !reflect.DeepEqual(got, want) {
		t.Errorf("the thesis project listed %v, want %v", got, want)
	}
	none, err := ws.PairHistoryCommand(ctx, wshrpc.CommandPairHistoryData{Project: "no-project"})
	if err != nil || none.Pairs == nil || len(none.Pairs) != 0 {
		t.Errorf("a project with no pairs = %+v, %v, want a non-nil empty list", none, err)
	}

	// the live list is the manager's alone: neither a synced pair nor, once it ends, the live one is in it
	if list, _ := ws.PairListCommand(ctx); !reflect.DeepEqual(pairIds(list.Pairs), []string{live.Id}) || getPairManager().Paired("far-w") {
		t.Errorf("the live list = %v, want only the live pair", pairIds(list.Pairs))
	}
	if err := ws.PairUnpairCommand(ctx, wshrpc.CommandPairGetData{PairId: live.Id}); err != nil {
		t.Fatal(err)
	}
	after, err := ws.PairHistoryCommand(ctx, wshrpc.CommandPairHistoryData{Project: "thesis"})
	if err != nil {
		t.Fatal(err)
	}
	if byId := after.Pairs[0]; byId.Id != live.Id || byId.State != agentpair.StateEnded || byId.Synced {
		t.Errorf("after Unpair the pair is %+v, want it still listed, ended, not synced", byId)
	}
	if list, _ := ws.PairListCommand(ctx); len(list.Pairs) != 0 {
		t.Errorf("the live list holds %v after Unpair, want none", pairIds(list.Pairs))
	}
}

// PairGet serves the manager's pairs as ever, and an ended pair or a synced one from its file
func TestPairGetFallsBackToTheFiles(t *testing.T) {
	ctx := context.Background()
	ws := &WshServer{}
	w := newPairWorld(t)
	get := func(id string) (*wshrpc.PairView, error) {
		return ws.PairGetCommand(ctx, wshrpc.CommandPairGetData{PairId: id})
	}

	view := w.start(true)
	if got, err := get(view.Id); err != nil || got.State != agentpair.StateRelaying || got.Synced {
		t.Fatalf("a live pair = %+v, %v, want the manager's", got, err)
	}
	if err := ws.PairUnpairCommand(ctx, wshrpc.CommandPairGetData{PairId: view.Id}); err != nil {
		t.Fatal(err)
	}
	ended, err := get(view.Id)
	if err != nil || ended.State != agentpair.StateEnded || ended.Synced || len(ended.Messages) != 1 || ended.Worker.Tab != pairWorkerTab {
		t.Fatalf("an ended pair = %+v, %v, want its file's thread, ended, not synced", ended, err)
	}

	w.syncPair("far1", "thesis", agentpair.StateEnded, 5000)
	synced, err := get("far1")
	if err != nil || !synced.Synced || synced.Worker.Session != "sess-w" || len(synced.Messages) != 1 || len(synced.Decided.Open) != 1 {
		t.Fatalf("a synced pair = %+v, %v, want the synced folder's, with its thread and Decided list", synced, err)
	}
	if getPairManager().Paired("far-w") {
		t.Error("reading a synced pair put it in the manager's index")
	}

	if _, err := get("never-was"); !errors.Is(err, agentpair.ErrNoPair) {
		t.Errorf("an unknown id = %v, want ErrNoPair", err)
	}
	if _, err := get("../far1"); err == nil || errors.Is(err, agentpair.ErrNoPair) {
		t.Errorf("an id that is a path = %v, want it refused", err)
	}
}

// wavesrv's boot reads the pair files off its own goroutine and sends what waited for an agent that is idle now
func TestStartPairManagerLoadsPairsAndDeliversQueues(t *testing.T) {
	w := newPairWorld(t)
	w.link.setState(pairJudgeTab, agentpair.LinkWorking)
	view := w.start(true)
	w.link.answer(pairWorkerTab, "next reply", 2000)
	getPairManager().TurnEnded(context.Background(), pairWorkerTab) // queues for the judge, which is busy
	before := len(w.link.deliveries())

	// a restart: a manager that has read nothing over the same files, and the judge at rest
	w.link.setState(pairJudgeTab, agentpair.LinkIdle)
	w.setManager(w.newManager(getPairManagerDir(t)))
	StartPairManager()

	deadline := time.Now().Add(2 * time.Second)
	for len(w.link.deliveries()) == before && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	sent := w.link.deliveries()
	if len(sent) != before+1 || sent[before].blockId != pairJudgeTab || !strings.Contains(sent[before].text, "next reply") {
		t.Fatalf("after boot the judge was sent %+v, want the reply that waited for it", sent[before:])
	}
	if !getPairManager().Paired(pairWorkerTab) || w.view(view.Id).Worker.Tab != pairWorkerTab {
		t.Error("the pair is not there after boot")
	}
}

// getPairManagerDir is the folder the current pair manager keeps its files in
func getPairManagerDir(t *testing.T) string {
	t.Helper()
	pairManagerMu.Lock()
	defer pairManagerMu.Unlock()
	return pairManager.Dir
}

// a member of a pair that reports idle has ended a turn; any other report, or an agent outside every pair, ends none
func TestPairStatusHook(t *testing.T) {
	w := newPairWorld(t)
	view := w.start(true)
	w.link.forgetReads()
	messages := func() int { return w.view(view.Id).MessageCount }
	if messages() != 1 {
		t.Fatalf("a new pair holds %d messages, want 1", messages())
	}

	w.link.answer(pairWorkerTab, "second reply", 2000)
	report := func(ev *wps.WaveEvent) {
		notePairStatus(ev)
		pairWork.Wait()
	}

	report(statusOf(tabORef(pairWorkerTab), baseds.AgentState_Working))
	report(statusOf(tabORef(pairWorkerTab), "")) // a usage-only report carries no state
	if reads := w.link.readTabs(); len(reads) != 0 || messages() != 1 {
		t.Fatalf("a working report ended a turn: reads %v, %d messages", reads, messages())
	}

	w.link.answer(pairOtherTab, "an answer of an agent in no pair", 2000)
	report(statusOf(tabORef(pairOtherTab), baseds.AgentState_Idle))
	if reads := w.link.readTabs(); len(reads) != 0 {
		t.Fatalf("an agent outside every pair had its answer read: %v", reads)
	}

	report(statusOf(tabORef(pairWorkerTab), baseds.AgentState_Idle))
	if messages() != 2 {
		t.Fatalf("an idle report of the working agent left %d messages, want its new reply taken", messages())
	}
	if sent := w.link.deliveries(); sent[len(sent)-1].blockId != pairJudgeTab || !strings.Contains(sent[len(sent)-1].text, "second reply") {
		t.Fatalf("the reply was not relayed to the judge: %+v", sent)
	}

	// a report that names the agent's block finds its tab
	oldTab := blockTabId
	blockTabId = func(_ context.Context, blockId string) (string, error) {
		if blockId == pairJudgeBlock {
			return pairJudgeTab, nil
		}
		return "", fmt.Errorf("no block %s", blockId)
	}
	t.Cleanup(func() { blockTabId = oldTab })
	w.link.answer(pairJudgeTab, "> Plan\nA finding.\n```arc-judge\nnew: the pilot overlaps the test split\n```", 3000)
	report(statusOf(blockORef(pairJudgeBlock), baseds.AgentState_Idle))
	if messages() != 3 {
		t.Fatalf("an idle report of the judge's block left %d messages, want its reply taken", messages())
	}

	// and the report the publish path handles reaches the pairs the same way
	w.link.answer(pairWorkerTab, "third reply", 4000)
	publishEvent(context.Background(), wps.WaveEvent{Event: wps.Event_AgentStatus, Data: baseds.AgentStatusData{
		ORef: tabORef(pairWorkerTab), State: baseds.AgentState_Idle, Ts: time.Now().UnixMilli(),
	}})
	pairWork.Wait()
	if messages() != 4 {
		t.Fatalf("an idle report published through publishEvent left %d messages, want the working agent's reply taken", messages())
	}
}

// the hold refuses a heavy command of a working agent whose judge owes an answer, with the pair's reason and before the
// queue; anything else runs as it did
func TestJobSlotPairHold(t *testing.T) {
	const workerBlock, otherBlock = "e5555555-0000-4000-8000-0000000000e5", "f6666666-0000-4000-8000-0000000000f6"
	q := installQueue(t, 8) // a slot a finished job has not given back yet must never queue the next
	oldTab := blockTabId
	blockTabId = func(_ context.Context, blockId string) (string, error) {
		switch blockId {
		case workerBlock:
			return pairWorkerTab, nil
		case otherBlock:
			return pairOtherTab, nil
		}
		return "", fmt.Errorf("no block %s", blockId)
	}
	t.Cleanup(func() { blockTabId = oldTab })
	w := newPairWorld(t)
	w.start(true)

	open := func(ctx context.Context, block, command string, protect bool) chan wshrpc.RespOrErrorUnion[wshrpc.JobSlotUpdate] {
		return (&WshServer{}).JobSlotCommand(ctx, wshrpc.CommandJobSlotData{Command: command, BlockId: block, Protect: protect})
	}
	runs := func(block, command string, protect bool) {
		t.Helper()
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()
		ch := open(ctx, block, command, protect)
		requireRun(t, nextSlotUpdate(t, ch))
		cancel()
		// a finished job gives its slot back a moment later, and a Protect job runs alone: the next one waits for both
		for deadline := time.Now().Add(2 * time.Second); len(q.Snapshot().Jobs) > 0 && time.Now().Before(deadline); {
			time.Sleep(time.Millisecond)
		}
	}

	ch := open(context.Background(), workerBlock, "task check:ts", false)
	got := nextSlotUpdate(t, ch)
	if got.Run == nil || *got.Run || !strings.HasPrefix(got.Reason, "Held:") || !strings.Contains(got.Reason, "`task check:ts`") {
		t.Fatalf("a heavy command of the working agent got %+v, want it refused with the pair's reason", got)
	}
	requireStreamClosed(t, ch)
	if n := len(q.Snapshot().Jobs); n != 0 {
		t.Fatalf("%d jobs queued for a held command", n)
	}

	runs(workerBlock, "echo hi", false)      // light
	runs(workerBlock, "task dev", false)     // long-running: it never queues
	runs(workerBlock, "task check:ts", true) // a Protect job is the person's own, never held
	runs(otherBlock, "task check:ts", false) // an agent in no pair
	runs("", "task check:ts", false)         // a caller with no block
	runs("0000", "task check:ts", false)     // a block with no tab

	// the judge answers: nothing is owed, nothing is held
	w.link.answer(pairJudgeTab, "> Plan\nAgreed.\n```arc-judge\nno new points\n```", 2000)
	getPairManager().TurnEnded(context.Background(), pairJudgeTab)
	runs(workerBlock, "task check:ts", false)
}

// livePairLink reads the live roster: a member's state folds into the pair's five, and one the roster does not list is
// gone only when its tab is deleted or its session reported its end, never because wavesrv just restarted
func TestPairLinkState(t *testing.T) {
	asking := agentFacts(agentsTabA, "asking", agentsBlockA, "claude", baseds.AgentState_Working)
	asking.OpenAsk = true
	asleep := sleepingClaude(time.Now())
	asleep.Tab.OID, asleep.BlockId, asleep.Tab.BlockIds = "dddd4444-tab", "d0000000-0000-4000-8000-000000000004", []string{"d0000000-0000-4000-8000-000000000004"}
	// the agent's process is not there yet: wavesrv restarted and RestoreLiveAgents has not relaunched it
	restarting := agentFacts("eeee5555-tab", "restarting", "e0000000-0000-4000-8000-000000000005", "claude", baseds.AgentState_Idle)
	restarting.ShellRunning = false
	ended := agentFacts("ffff6666-tab", "ended", "f0000000-0000-4000-8000-000000000006", "claude", baseds.AgentState_Idle)
	ended.Status.Ended = true
	scriptAgents(t, &agentRosterFacts{Tabs: []agentTabFacts{
		agentFacts(agentsTabB, "idle", agentsBlockB, "claude", baseds.AgentState_Idle),
		agentFacts(agentsTabC, "working", agentsBlockC, "pi", baseds.AgentState_Working),
		asking, asleep, restarting, ended,
	}})
	cases := []struct{ tab, want string }{
		{agentsTabB, agentpair.LinkIdle},
		{agentsTabC, agentpair.LinkWorking},
		{agentsTabA, agentpair.LinkAsking},
		{asleep.Tab.OID, agentpair.LinkSleeping},
		{restarting.Tab.OID, agentpair.LinkWorking}, // in the store, not on the roster
		{ended.Tab.OID, agentpair.LinkGone},         // its session reported its end
		{"zzzz9999-tab", agentpair.LinkGone},        // no such tab: deleted
	}
	for _, c := range cases {
		got, err := livePairLink{}.State(context.Background(), c.tab)
		if err != nil || got != c.want {
			t.Errorf("State(%s) = %q, %v, want %q", c.tab, got, err, c.want)
		}
	}
}

// a tab that is not on the roster can neither be sent into nor read: the errors are the manager's cue to keep the queue
func TestPairLinkTabOffTheRoster(t *testing.T) {
	restarting := agentFacts(agentsTabA, "restarting", agentsBlockA, "claude", baseds.AgentState_Idle)
	restarting.ShellRunning = false
	sent := scriptAgents(t, &agentRosterFacts{Tabs: []agentTabFacts{restarting}})
	ctx := context.Background()
	link := livePairLink{}

	checks := map[string]error{}
	checks["Send"] = link.Send(ctx, agentsTabA, "hello")
	_, _, checks["LastAnswer"] = link.LastAnswer(ctx, agentsTabA)
	_, _, checks["AnswerAt"] = link.AnswerAt(ctx, agentsTabA, "a1")
	_, checks["Tokens"] = link.Tokens(ctx, agentsTabA, 0)
	_, checks["Agent"] = link.Agent(ctx, agentsTabA)
	_, checks["RecentTexts"] = link.RecentTexts(ctx, agentsTabA, 3)
	checks["Sleep"] = link.Sleep(ctx, agentsTabA)
	for name, err := range checks {
		if !errors.Is(err, errNoSeat) {
			t.Errorf("%s on a tab off the roster = %v, want errNoSeat", name, err)
		}
	}
	if len(*sent) != 0 {
		t.Errorf("a prompt reached a tab that is not on the roster: %+v", *sent)
	}
}

// the pair's Sleep is a person's Sleep without the compaction and without the auto-sleep setting: an idle agent sleeps at
// once, an agent that runs background work does not (an error that names the work, never a nil that reads as a sleep), and
// the refusals of a person's Sleep apply
func TestPairLinkSleep(t *testing.T) {
	ctx := context.Background()
	link := livePairLink{}

	t.Run("an idle agent sleeps", func(t *testing.T) {
		w := newSleepWorld(t, claudeMeta())
		scriptAgents(t, &agentRosterFacts{Tabs: []agentTabFacts{idleClaude(writeTranscript(t, "abc"))}})
		if err := link.Sleep(ctx, agentsTabA); err != nil {
			t.Fatalf("Sleep = %v, want the agent slept", err)
		}
		if got := w.eventLog(); !slices.Equal(got, []string{"meta", "destroy"}) {
			t.Fatalf("events = %v, want the meta write and then the destroy", got)
		}
		if w.metaValue(waveobj.MetaKey_AgentSleeping) == nil {
			t.Error("agent:sleeping was not written")
		}
	})

	t.Run("background work stops it", func(t *testing.T) {
		w := newSleepWorld(t, claudeMeta())
		scriptAgents(t, &agentRosterFacts{Tabs: []agentTabFacts{idleClaude(writeTranscript(t, "abc", backgroundTaskLine))}})
		err := link.Sleep(ctx, agentsTabA)
		if err == nil || !strings.Contains(err.Error(), "dev server") || !strings.Contains(err.Error(), "not put to sleep") {
			t.Fatalf("Sleep = %v, want an error that names the background work and says nothing slept", err)
		}
		if got := w.eventLog(); len(got) != 0 {
			t.Fatalf("events = %v, want nothing slept", got)
		}
	})

	for _, c := range []struct {
		name string
		tf   agentTabFacts
		want string
	}{
		{"a working agent", agentFacts(agentsTabA, "design", agentsBlockA, "claude", baseds.AgentState_Working), "not idle"},
		{"an agent that asks the person", agentFacts(agentsTabA, "design", agentsBlockA, "claude", baseds.AgentState_Asking), "not idle"},
		{"an agent that is asleep", sleepingClaude(time.Now()), "already asleep"},
	} {
		t.Run("refuses "+c.name, func(t *testing.T) {
			w := newSleepWorld(t, claudeMeta())
			scriptAgents(t, &agentRosterFacts{Tabs: []agentTabFacts{c.tf}})
			if err := link.Sleep(ctx, agentsTabA); err == nil || !strings.Contains(err.Error(), c.want) {
				t.Fatalf("Sleep = %v, want a refusal that says %q", err, c.want)
			}
			if got := w.eventLog(); len(got) != 0 {
				t.Fatalf("events = %v, want nothing touched", got)
			}
		})
	}
}

// what a member says and spends is read from its transcript, and a prompt goes to its block as it is: already in the
// pair's envelope, with no send-back lock
func TestPairLinkReadsTheTranscriptAndSends(t *testing.T) {
	transcript := writeTranscript(t, "pair-link",
		`{"type":"user","timestamp":"2026-11-25T10:00:00.000Z","message":{"content":"write the plan in docs/superpowers/plans/2026-11-25-x.md"}}`,
		`{"type":"assistant","timestamp":"2026-11-25T10:00:05.000Z","requestId":"r1","message":{"id":"m1","content":[{"type":"text","text":"The plan is in docs/superpowers/plans/2026-11-25-x.md"}],"usage":{"input_tokens":10,"output_tokens":5,"cache_read_input_tokens":100,"cache_creation_input_tokens":50}}}`,
	)
	tf := agentFacts(agentsTabB, "design", agentsBlockB, "claude", baseds.AgentState_Idle)
	tf.Status.TranscriptPath = transcript
	tf.ProjectPath = `C:\work\thesis`
	sent := scriptAgents(t, &agentRosterFacts{Tabs: []agentTabFacts{tf}})
	ctx := context.Background()
	link := livePairLink{}

	text, ts, err := link.LastAnswer(ctx, agentsTabB)
	if err != nil || text != "The plan is in docs/superpowers/plans/2026-11-25-x.md" || ts != 1795600805000 {
		t.Errorf("LastAnswer = %q, %d, %v", text, ts, err)
	}
	if n, err := link.Tokens(ctx, agentsTabB, 0); err != nil || n != 165 {
		t.Errorf("Tokens from the start = %d, %v, want 165", n, err)
	}
	if n, err := link.Tokens(ctx, agentsTabB, 1795600806000); err != nil || n != 0 {
		t.Errorf("Tokens after the reply = %d, %v, want 0", n, err)
	}
	texts, err := link.RecentTexts(ctx, agentsTabB, 5)
	if err != nil || len(texts) != 2 || !strings.HasPrefix(texts[0], "write the plan") || !strings.HasPrefix(texts[1], "The plan is in") {
		t.Errorf("RecentTexts = %q, %v, want the prompt and then the reply", texts, err)
	}
	if texts, _ := link.RecentTexts(ctx, agentsTabB, 1); len(texts) != 1 || !strings.HasPrefix(texts[0], "The plan is in") {
		t.Errorf("RecentTexts(1) = %q, want the last turn only", texts)
	}
	facts, err := link.Agent(ctx, agentsTabB)
	if err != nil || facts.Name != "design" || facts.Harness != "claude" || facts.Project != "thesis" || facts.Transcript != transcript || facts.Cwd != "/work/design" {
		t.Errorf("Agent = %+v, %v", facts, err)
	}

	prompt := agentmsg.PairEnvelope("From the judge:\nlock the threshold first")
	if err := link.Send(ctx, agentsTabB, prompt); err != nil {
		t.Fatal(err)
	}
	if len(*sent) != 1 || (*sent)[0].blockId != agentsBlockB || (*sent)[0].text != prompt {
		t.Errorf("deliveries = %+v, want the prompt as it was handed over", *sent)
	}
	if err := link.Send(ctx, agentsTabB, " \n"); err == nil {
		t.Error("an empty prompt was sent")
	}
}

// a reply of a claude agent is read by the uuid of its transcript record: its text and time, never the latest reply in
// the place of one that is not there; a pi agent's replies, and a record that says nothing, are errors
func TestPairLinkAnswerAtReadsAClaudeTranscript(t *testing.T) {
	transcript := writeTranscript(t, "pair-link-answer-at",
		`{"type":"user","uuid":"u1","timestamp":"2026-11-25T10:00:00.000Z","message":{"content":"write the plan"}}`,
		`{"type":"assistant","uuid":"a1","parentUuid":"u1","timestamp":"2026-11-25T10:00:05.000Z","message":{"id":"m1","content":[{"type":"text","text":"Plan v1."}]}}`,
		`{"type":"assistant","uuid":"a2","parentUuid":"a1","timestamp":"2026-11-25T10:00:09.000Z","message":{"id":"m2","content":[{"type":"tool_use","id":"toolu_1","name":"Bash","input":{"command":"ls"}}]}}`,
		`{"type":"assistant","uuid":"a3","parentUuid":"a2","timestamp":"2026-11-25T10:00:20.000Z","message":{"id":"m3","content":[{"type":"text","text":"Plan v2."}]}}`,
	)
	claude := agentFacts(agentsTabB, "design", agentsBlockB, "claude", baseds.AgentState_Idle)
	claude.Status.TranscriptPath = transcript
	pi := agentFacts(agentsTabC, "pi worker", agentsBlockC, "pi", baseds.AgentState_Idle)
	pi.Status.TranscriptPath = transcript
	scriptAgents(t, &agentRosterFacts{Tabs: []agentTabFacts{claude, pi}})
	ctx := context.Background()
	link := livePairLink{}

	text, ts, err := link.AnswerAt(ctx, agentsTabB, "a1")
	if err != nil || text != "Plan v1." || ts != 1795600805000 {
		t.Errorf("AnswerAt(a1) = %q, %d, %v; want Plan v1. at 1795600805000", text, ts, err)
	}
	text, ts, err = link.AnswerAt(ctx, agentsTabB, "a3")
	latest, latestTs, _ := link.LastAnswer(ctx, agentsTabB)
	if err != nil || text != "Plan v2." || text != latest || ts != latestTs {
		t.Errorf("AnswerAt(a3) = %q, %d, %v; want the latest reply, %q at %d", text, ts, err, latest, latestTs)
	}
	for name, c := range map[string]struct{ tab, uuid string }{
		"a record with no text":   {agentsTabB, "a2"},
		"a uuid no record has":    {agentsTabB, "a9"},
		"a user record":           {agentsTabB, "u1"},
		"a pi agent's transcript": {agentsTabC, "a1"},
	} {
		if text, ts, err := link.AnswerAt(ctx, c.tab, c.uuid); err == nil || text != "" || ts != 0 || !strings.Contains(err.Error(), c.uuid) {
			t.Errorf("%s: AnswerAt = %q, %d, %v; want an error that names the uuid", name, text, ts, err)
		}
	}
}

func TestPairAgentNameTakesTheTitle(t *testing.T) {
	if got := pairAgentName(wshrpc.AgentInfo{Name: "mit-thesis", Title: "Plan oracle-tightening"}); got != "Plan oracle-tightening" {
		t.Fatalf("with a title: got %q", got)
	}
	if got := pairAgentName(wshrpc.AgentInfo{Name: "mit-thesis", Title: "  "}); got != "mit-thesis" {
		t.Fatalf("with no title: got %q", got)
	}
}
