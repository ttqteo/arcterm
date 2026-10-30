// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"errors"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/agentmsg"
	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/council"
)

// claudeTurn is an assistant line of a claude transcript: a text answer at ts, from a request that carried the context
// tokens it names (input 10, 90000 read from the cache and 5000 written to it: 95,010).
const claudeTurn = `{"type":"assistant","timestamp":"2026-10-06T10:00:00.000Z","message":{"content":[{"type":"text","text":"ship it"}],"usage":{"input_tokens":10,"cache_read_input_tokens":90000,"cache_creation_input_tokens":5000}}}`

func TestLiveAgentLinkSeatStates(t *testing.T) {
	asking := agentFacts(agentsTabA, "asker", agentsBlockA, "claude", baseds.AgentState_Working)
	asking.OpenAsk = true
	cases := []struct {
		name  string
		facts agentTabFacts
		want  string
	}{
		{"idle", agentFacts(agentsTabA, "a", agentsBlockA, "claude", baseds.AgentState_Idle), council.SeatIdle},
		{"waiting at its prompt reads idle", agentFacts(agentsTabA, "a", agentsBlockA, "claude", baseds.AgentState_Waiting), council.SeatIdle},
		{"working", agentFacts(agentsTabA, "a", agentsBlockA, "pi", baseds.AgentState_Working), council.SeatWorking},
		{"asking by its status", agentFacts(agentsTabA, "a", agentsBlockA, "claude", baseds.AgentState_Asking), council.SeatAsking},
		{"asking by an open question", asking, council.SeatAsking},
		{"sleeping", sleepingClaude(time.Now()), council.SeatSleeping},
		{"a state it does not know is working", agentFacts(agentsTabA, "a", agentsBlockA, "claude", "compacting"), council.SeatWorking},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			scriptAgents(t, &agentRosterFacts{Tabs: []agentTabFacts{c.facts}})
			got, err := liveAgentLink{}.Seat(context.Background(), agentsTabA)
			if err != nil || got.State != c.want {
				t.Errorf("Seat = %+v, %v, want state %q", got, err, c.want)
			}
		})
	}
}

func TestLiveAgentLinkSeatGone(t *testing.T) {
	exited := agentFacts(agentsTabB, "exited", agentsBlockB, "claude", baseds.AgentState_Idle)
	exited.ShellRunning = false
	codex := agentFacts(agentsTabC, "codex", agentsBlockC, "codex", baseds.AgentState_Idle)
	scriptAgents(t, &agentRosterFacts{Tabs: []agentTabFacts{
		agentFacts(agentsTabA, "a", agentsBlockA, "claude", baseds.AgentState_Idle), exited, codex,
	}})
	for _, tab := range []string{"no-such-tab", agentsTabB, agentsTabC} {
		got, err := liveAgentLink{}.Seat(context.Background(), tab)
		if err != nil || got.State != council.SeatGone {
			t.Errorf("Seat(%s) = %+v, %v, want a gone seat and no error", tab, got, err)
		}
	}
	// the other two calls cannot act on a gone seat
	if err := (liveAgentLink{}).Send(context.Background(), "no-such-tab", "hi"); !errors.Is(err, errNoSeat) {
		t.Errorf("Send to a gone seat = %v, want errNoSeat", err)
	}
	if _, _, err := (liveAgentLink{}).LastAnswer(context.Background(), "no-such-tab"); !errors.Is(err, errNoSeat) {
		t.Errorf("LastAnswer of a gone seat = %v, want errNoSeat", err)
	}
	// a read of the roster that fails is not a gone seat
	boom := errors.New("store down")
	swap(t, &loadAgentRosterFacts, func(context.Context) (*agentRosterFacts, error) { return nil, boom })
	if _, err := (liveAgentLink{}).Seat(context.Background(), agentsTabA); !errors.Is(err, boom) {
		t.Errorf("Seat with the roster unreadable = %v, want the failure", err)
	}
}

func TestLiveAgentLinkOnlyClaudeAndPiSit(t *testing.T) {
	scriptAgents(t, &agentRosterFacts{Tabs: []agentTabFacts{
		agentFacts(agentsTabA, "antigravity", agentsBlockA, "agy", baseds.AgentState_Idle),
		agentFacts(agentsTabB, "claude", agentsBlockB, "claude", baseds.AgentState_Idle),
		agentFacts(agentsTabC, "pi", agentsBlockC, "pi", baseds.AgentState_Idle),
	}})
	ctx := context.Background()
	link := liveAgentLink{}
	if st, err := link.Seat(ctx, agentsTabA); err == nil || errors.Is(err, errNoSeat) || !strings.Contains(err.Error(), "only claude and pi") {
		t.Errorf("Seat of an agy tab = %+v, %v, want a refusal that is not a gone seat", st, err)
	}
	if err := link.Send(ctx, agentsTabA, "hi"); err == nil || !strings.Contains(err.Error(), "only claude and pi") {
		t.Errorf("Send to an agy tab = %v, want the refusal", err)
	}
	if _, _, err := link.LastAnswer(ctx, agentsTabA); err == nil || !strings.Contains(err.Error(), "only claude and pi") {
		t.Errorf("LastAnswer of an agy tab = %v, want the refusal", err)
	}
	for _, tab := range []string{agentsTabB, agentsTabC} {
		if st, err := link.Seat(ctx, tab); err != nil || st.State != council.SeatIdle {
			t.Errorf("Seat(%s) = %+v, %v, want it seated", tab, st, err)
		}
	}
}

func TestLiveAgentLinkSeatContext(t *testing.T) {
	tpath := writeTranscript(t, "session", claudeTurn)
	claude := agentFacts(agentsTabA, "claude", agentsBlockA, "claude", baseds.AgentState_Idle)
	claude.Status.TranscriptPath = tpath
	busy := agentFacts(agentsTabB, "busy", agentsBlockB, "claude", baseds.AgentState_Working)
	busy.Status.TranscriptPath = tpath
	pi := agentFacts(agentsTabC, "pi", agentsBlockC, "pi", baseds.AgentState_Idle)
	pi.Status.TranscriptPath = tpath
	scriptAgents(t, &agentRosterFacts{Tabs: []agentTabFacts{claude, busy, pi}})

	reads := 0
	real := readTranscriptEnd
	swap(t, &readTranscriptEnd, func(path string, max int64) ([]string, error) { reads++; return real(path, max) })

	ctx := context.Background()
	if st, _ := (liveAgentLink{}).Seat(ctx, agentsTabA); st.Context != 95_010 {
		t.Errorf("idle claude seat context = %d, want the 95,010 tokens its last request carried", st.Context)
	}
	if reads != 1 {
		t.Errorf("transcript reads = %d, want one", reads)
	}
	if st, _ := (liveAgentLink{}).Seat(ctx, agentsTabB); st.Context != 0 || reads != 1 {
		t.Errorf("working seat context = %d after %d reads, want it left unread", st.Context, reads)
	}
	if st, _ := (liveAgentLink{}).Seat(ctx, agentsTabC); st.Context != 0 || reads != 1 {
		t.Errorf("pi seat context = %d after %d reads, want 0: its transcript carries no such figure here", st.Context, reads)
	}

	// no transcript, or one that cannot be read, is an unknown context and no failure
	claude.Status.TranscriptPath = ""
	scriptAgents(t, &agentRosterFacts{Tabs: []agentTabFacts{claude}})
	if st, err := (liveAgentLink{}).Seat(ctx, agentsTabA); err != nil || st.Context != 0 || st.State != council.SeatIdle {
		t.Errorf("seat with no transcript = %+v, %v, want idle and an unknown context", st, err)
	}
	claude.Status.TranscriptPath = "no-such-file.jsonl"
	scriptAgents(t, &agentRosterFacts{Tabs: []agentTabFacts{claude}})
	if st, err := (liveAgentLink{}).Seat(ctx, agentsTabA); err != nil || st.Context != 0 {
		t.Errorf("seat with an unreadable transcript = %+v, %v, want an unknown context and no failure", st, err)
	}
}

func TestLiveAgentLinkSendDeliversTheCouncilsEnvelope(t *testing.T) {
	sent := scriptAgents(t, threeAgents())
	ctx := context.Background()
	if err := (liveAgentLink{}).Send(ctx, agentsTabB, "  Round 2: what do you think?\n"); err != nil {
		t.Fatal(err)
	}
	if len(*sent) != 1 || (*sent)[0].blockId != agentsBlockB {
		t.Fatalf("deliveries = %+v, want one to block %s", *sent, agentsBlockB)
	}
	text := (*sent)[0].text
	if !agentmsg.IsAgentMessage(text) || !strings.Contains(text, `"council"`) || !strings.HasSuffix(text, "\nRound 2: what do you think?") {
		t.Errorf("delivered %q, want an agent message from the council that carries the trimmed turn", text)
	}
	// nobody sent it, so no agent is locked out of answering by message
	for _, block := range []string{agentsBlockA, agentsBlockB, agentsBlockC} {
		for _, other := range []string{agentsBlockA, agentsBlockB, agentsBlockC} {
			if agentmsg.SendBackLocked(block, other) {
				t.Errorf("block %s is locked from messaging %s after a council turn", block, other)
			}
		}
	}

	if err := (liveAgentLink{}).Send(ctx, agentsTabB, " \n"); err == nil {
		t.Error("an empty turn was sent")
	}
	asking := threeAgents()
	asking.Tabs[1].OpenAsk = true
	sent = scriptAgents(t, asking)
	if err := (liveAgentLink{}).Send(ctx, agentsTabB, "hi"); err == nil || !strings.Contains(err.Error(), "question open") {
		t.Errorf("Send into a question with no stream = %v, want the refusal agents send gives", err)
	}
	if len(*sent) != 0 {
		t.Errorf("a refused turn delivered %+v", *sent)
	}
}

func TestLiveAgentLinkSendWakesASleepingSeat(t *testing.T) {
	w := newSleepWorld(t, sleepingMeta(time.Now()))
	w.install(&agentRosterFacts{Tabs: []agentTabFacts{sleepingClaude(time.Now())}})
	w.status = func(int) baseds.AgentStatusData { return readyStatus() }

	if err := (liveAgentLink{}).Send(context.Background(), agentsTabA, "tabs, not spaces"); err != nil {
		t.Fatal(err)
	}
	if w.resyncs != 1 {
		t.Errorf("restarts = %d, want the turn to wake the agent", w.resyncs)
	}
	got := w.deliveries()
	if len(got) != 1 || got[0].blockId != agentsBlockA || !strings.Contains(got[0].text, "tabs, not spaces") {
		t.Fatalf("delivered %+v, want the envelope to the woken agent once", got)
	}

	// an agent that does not come back fails the turn
	dead := newSleepWorld(t, sleepingMeta(time.Now()))
	dead.install(&agentRosterFacts{Tabs: []agentTabFacts{sleepingClaude(time.Now())}})
	dead.exited = func() (bool, int) { return true, 1 }
	if err := (liveAgentLink{}).Send(context.Background(), agentsTabA, "hi"); err == nil {
		t.Error("a turn sent to an agent that did not wake reported success")
	}
	if len(dead.deliveries()) != 0 {
		t.Errorf("delivered %+v, want nothing", dead.deliveries())
	}
}

func TestLiveAgentLinkLastAnswer(t *testing.T) {
	tpath := writeTranscript(t, "session", claudeTurn)
	answered := agentFacts(agentsTabA, "answered", agentsBlockA, "claude", baseds.AgentState_Idle)
	answered.Status.TranscriptPath = tpath
	fresh := agentFacts(agentsTabB, "fresh", agentsBlockB, "claude", baseds.AgentState_Idle)
	scriptAgents(t, &agentRosterFacts{Tabs: []agentTabFacts{answered, fresh}})

	text, ts, err := (liveAgentLink{}).LastAnswer(context.Background(), agentsTabA)
	wantTs := time.Date(2026, 10, 6, 10, 0, 0, 0, time.UTC).UnixMilli()
	if err != nil || text != "ship it" || ts != wantTs {
		t.Errorf("LastAnswer = %q, %d, %v, want the transcript's last answer at %d", text, ts, err, wantTs)
	}
	// no transcript path says nothing yet: no answer, and no failure
	if text, ts, err = (liveAgentLink{}).LastAnswer(context.Background(), agentsTabB); err != nil || text != "" || ts != 0 {
		t.Errorf("LastAnswer with no transcript = %q, %d, %v, want none", text, ts, err)
	}
}

// the AgentCaller over the real link: the turn is delivered, the agent works on it, and its transcript gains the answer
func TestLiveAgentLinkCarriesAnAgentCallerTurn(t *testing.T) {
	tpath := writeTranscript(t, "session", claudeTurn)
	scriptAgents(t, &agentRosterFacts{})
	var mu sync.Mutex
	state, delivered := baseds.AgentState_Idle, ""
	swap(t, &loadAgentRosterFacts, func(context.Context) (*agentRosterFacts, error) {
		mu.Lock()
		defer mu.Unlock()
		tf := agentFacts(agentsTabA, "Witness", agentsBlockA, "claude", state)
		tf.Status.TranscriptPath = tpath
		return &agentRosterFacts{Tabs: []agentTabFacts{tf}}, nil
	})
	swap(t, &deliverAgentMessage, func(blockId, text string) {
		mu.Lock()
		delivered, state = text, baseds.AgentState_Working
		mu.Unlock()
		go func() {
			time.Sleep(15 * time.Millisecond)
			answer := `{"type":"assistant","timestamp":"` + time.Now().UTC().Format("2006-01-02T15:04:05.000Z") +
				`","message":{"content":[{"type":"text","text":"the turn's answer"}],"usage":{"input_tokens":10,"cache_read_input_tokens":95000,"cache_creation_input_tokens":5000}}}` + "\n"
			f, err := os.OpenFile(tpath, os.O_APPEND|os.O_WRONLY, 0)
			if err == nil {
				_, err = f.WriteString(answer)
				f.Close()
			}
			if err != nil {
				t.Errorf("appending the agent's answer: %v", err)
			}
			mu.Lock()
			state = baseds.AgentState_Idle
			mu.Unlock()
		}()
	})

	caller := council.AgentCaller{Link: liveAgentLink{}, BusyCap: time.Second, TurnCap: 5 * time.Second, Poll: time.Millisecond}
	res, err := caller.Call(context.Background(), council.CallReq{Expert: council.CouncilExpert{Name: "Witness", Agent: agentsTabA}, Prompt: "Round 1"})
	if err != nil {
		t.Fatal(err)
	}
	mu.Lock()
	defer mu.Unlock()
	if res.Text != "the turn's answer" {
		t.Errorf("text = %q, want the answer the agent gave to the turn, not the one from before it", res.Text)
	}
	if res.Tokens != 5_000 {
		t.Errorf("tokens = %d, want the 5,000 its context grew over the turn", res.Tokens)
	}
	if !strings.Contains(delivered, "Round 1") {
		t.Errorf("delivered %q, want the prompt", delivered)
	}
}
