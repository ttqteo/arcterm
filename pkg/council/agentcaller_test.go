// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package council

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"
)

// fakeLink is a seated agent's tab: its state and context, the answer it last gave, and what it was sent. onSeat runs
// on every Seat call with the number of calls so far, and onSend on the send, so a test scripts the agent's turn.
type fakeLink struct {
	mu       sync.Mutex
	state    string
	context  int64
	answer   string
	answerTs int64
	seats    int
	sent     []string
	sentIn   []string // the state each send found the agent in
	seatErr  error
	sendErr  error
	onSeat   func(f *fakeLink, n int)
	onSend   func(f *fakeLink)
}

func (f *fakeLink) Seat(context.Context, string) (AgentSeatState, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.seats++
	if f.onSeat != nil {
		f.onSeat(f, f.seats)
	}
	return AgentSeatState{State: f.state, Context: f.context}, f.seatErr
}

func (f *fakeLink) Send(_ context.Context, _, text string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.sent = append(f.sent, text)
	f.sentIn = append(f.sentIn, f.state)
	if f.sendErr != nil {
		return f.sendErr
	}
	if f.onSend != nil {
		f.onSend(f)
	}
	return nil
}

func (f *fakeLink) LastAnswer(context.Context, string) (string, int64, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.answer, f.answerTs, nil
}

// answers is what the agent does with a sent turn: it works on it for the next `busy` Seat calls, then rests with text
// as its newest answer and `grown` more context.
func answers(busy int, text string, grown int64) func(f *fakeLink) {
	return func(f *fakeLink) {
		sentAt, done := f.seats, false
		f.onSeat = func(f *fakeLink, n int) {
			switch {
			case done:
			case n-sentAt <= busy:
				f.state = SeatWorking
			default:
				done = true
				f.state, f.answer, f.answerTs, f.context = SeatIdle, text, f.answerTs+100, f.context+grown
			}
		}
	}
}

func agentCaller(f *fakeLink) AgentCaller {
	return AgentCaller{Link: f, BusyCap: time.Second, TurnCap: time.Second, Poll: time.Millisecond}
}

func agentReq(onTool func(string)) CallReq {
	return CallReq{Expert: CouncilExpert{Name: "Witness", Agent: "tab-1"}, Prompt: "what do you think?", OnTool: onTool}
}

func wantSkipped(t *testing.T, err error, reason string) {
	t.Helper()
	var skipped SeatSkipped
	if !errors.As(err, &skipped) {
		t.Fatalf("err = %v, want a SeatSkipped", err)
	}
	if !strings.Contains(skipped.Reason, reason) {
		t.Errorf("reason = %q, want it to say %q", skipped.Reason, reason)
	}
}

func TestAgentCallerSentAndAnswered(t *testing.T) {
	f := &fakeLink{state: SeatIdle, context: 5000, answer: "an old answer", answerTs: 100, onSend: answers(2, "the new answer", 700)}
	res, err := agentCaller(f).Call(context.Background(), agentReq(nil))
	if err != nil {
		t.Fatal(err)
	}
	if res.Text != "the new answer" {
		t.Errorf("text = %q, want the answer the agent gave to the turn", res.Text)
	}
	if res.Tokens != 700 {
		t.Errorf("tokens = %d, want the 700 the context grew over the turn", res.Tokens)
	}
	if len(f.sent) != 1 || f.sent[0] != "what do you think?" {
		t.Errorf("sent = %q, want the prompt once", f.sent)
	}
}

func TestAgentCallerBusyThenIdle(t *testing.T) {
	f := &fakeLink{state: SeatWorking, onSend: answers(1, "done", 0)}
	f.onSeat = func(f *fakeLink, n int) {
		if n >= 4 {
			f.state = SeatIdle
		}
	}
	var tools []string
	res, err := agentCaller(f).Call(context.Background(), agentReq(func(s string) { tools = append(tools, s) }))
	if err != nil {
		t.Fatal(err)
	}
	if res.Text != "done" {
		t.Errorf("text = %q", res.Text)
	}
	if len(f.sentIn) != 1 || f.sentIn[0] != SeatIdle {
		t.Errorf("sent while %v, want exactly one send, to an idle agent", f.sentIn)
	}
	if len(tools) == 0 || tools[0] != "Waiting for Witness to finish its task" {
		t.Errorf("activity = %q, want it to name the agent being waited for", tools)
	}
}

func TestAgentCallerBusyPastTheCapIsSkipped(t *testing.T) {
	f := &fakeLink{state: SeatWorking}
	c := AgentCaller{Link: f, BusyCap: 20 * time.Millisecond, TurnCap: time.Second, Poll: time.Millisecond}
	_, err := c.Call(context.Background(), agentReq(nil))
	wantSkipped(t, err, "still working on its own task after 20ms")
	if len(f.sent) != 0 {
		t.Errorf("sent %q into a running turn", f.sent)
	}
}

func TestAgentCallerAskingWaits(t *testing.T) {
	f := &fakeLink{state: SeatAsking, onSend: answers(0, "after the question", 0)}
	f.onSeat = func(f *fakeLink, n int) {
		if n >= 5 {
			f.state = SeatIdle
		}
	}
	res, err := agentCaller(f).Call(context.Background(), agentReq(nil))
	if err != nil || res.Text != "after the question" {
		t.Fatalf("Call = %+v, %v, want the answer once the question was answered", res, err)
	}
	if len(f.sentIn) != 1 || f.sentIn[0] != SeatIdle {
		t.Errorf("sent while %v, want no send into a question", f.sentIn)
	}

	stuck := &fakeLink{state: SeatAsking}
	c := AgentCaller{Link: stuck, BusyCap: 20 * time.Millisecond, Poll: time.Millisecond}
	_, err = c.Call(context.Background(), agentReq(nil))
	wantSkipped(t, err, "a question waits for you in its terminal")
	if len(stuck.sent) != 0 {
		t.Errorf("sent %q to an agent with a question open", stuck.sent)
	}
}

func TestAgentCallerTurnPastTheCapIsSkipped(t *testing.T) {
	f := &fakeLink{state: SeatIdle, onSend: func(f *fakeLink) { f.onSeat = func(f *fakeLink, n int) { f.state = SeatWorking } }}
	c := AgentCaller{Link: f, BusyCap: time.Second, TurnCap: 20 * time.Millisecond, Poll: time.Millisecond}
	res, err := c.Call(context.Background(), agentReq(nil))
	wantSkipped(t, err, "gave no answer within 20ms")
	if res.Text != "" {
		t.Errorf("text = %q, want none for a skipped turn", res.Text)
	}
}

func TestAgentCallerGoneIsAnError(t *testing.T) {
	f := &fakeLink{state: SeatGone}
	_, err := agentCaller(f).Call(context.Background(), agentReq(nil))
	var skipped SeatSkipped
	if err == nil || errors.As(err, &skipped) || !strings.Contains(err.Error(), "gone") {
		t.Fatalf("err = %v, want a failure that says the agent is gone, not a skip", err)
	}
	if len(f.sent) != 0 {
		t.Errorf("sent %q to a gone agent", f.sent)
	}

	// closed mid-turn
	mid := &fakeLink{state: SeatIdle, onSend: func(f *fakeLink) { f.onSeat = func(f *fakeLink, n int) { f.state = SeatGone } }}
	_, err = agentCaller(mid).Call(context.Background(), agentReq(nil))
	if err == nil || errors.As(err, &skipped) || !strings.Contains(err.Error(), "gone") {
		t.Fatalf("err = %v, want a failure for a tab that closed mid-turn", err)
	}
}

func TestAgentCallerAnOlderAnswerIsNotTaken(t *testing.T) {
	// the agent rests again but its newest answer is still the one from before the send
	f := &fakeLink{state: SeatIdle, answer: "yesterday's answer", answerTs: 100}
	c := AgentCaller{Link: f, BusyCap: time.Second, TurnCap: 20 * time.Millisecond, Poll: time.Millisecond}
	res, err := c.Call(context.Background(), agentReq(nil))
	wantSkipped(t, err, "gave no answer")
	if res.Text != "" {
		t.Errorf("took %q, an answer older than the send", res.Text)
	}
}

func TestAgentCallerAnIdleReadRightAfterTheSendIsNotTheEnd(t *testing.T) {
	// the seat still reads idle for a few polls after the send, before the agent starts its turn
	f := &fakeLink{state: SeatIdle, answer: "old", answerTs: 100}
	f.onSend = func(f *fakeLink) {
		sentAt := f.seats
		f.onSeat = func(f *fakeLink, n int) {
			switch {
			case n-sentAt <= 3: // still idle
			case n-sentAt <= 5:
				f.state = SeatWorking
			default:
				f.state, f.answer, f.answerTs = SeatIdle, "late start", 200
			}
		}
	}
	res, err := agentCaller(f).Call(context.Background(), agentReq(nil))
	if err != nil || res.Text != "late start" {
		t.Fatalf("Call = %+v, %v, want the answer of the turn the agent started late", res, err)
	}
}

func TestAgentCallerWakesASleepingSeatBySending(t *testing.T) {
	f := &fakeLink{state: SeatSleeping, answerTs: 0, onSend: func(f *fakeLink) {
		f.state, f.answer, f.answerTs = SeatIdle, "back from sleep", 500
	}}
	res, err := agentCaller(f).Call(context.Background(), agentReq(nil))
	if err != nil || res.Text != "back from sleep" {
		t.Fatalf("Call = %+v, %v", res, err)
	}
	if len(f.sentIn) != 1 || f.sentIn[0] != SeatSleeping {
		t.Errorf("sent while %v, want the one send to find the agent asleep, as a send wakes it", f.sentIn)
	}
}

func TestAgentCallerTokens(t *testing.T) {
	cases := []struct {
		name               string
		start, grown, want int64
	}{
		{"the context grown over the turn", 100_000, 4_000, 4_000},
		{"no growth reported: a tenth of the start", 100_000, 0, 10_000},
		{"no context reported at all", 0, 0, 0},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			f := &fakeLink{state: SeatIdle, context: c.start, onSend: answers(1, "ok", c.grown)}
			res, err := agentCaller(f).Call(context.Background(), agentReq(nil))
			if err != nil {
				t.Fatal(err)
			}
			if res.Tokens != c.want {
				t.Errorf("tokens = %d, want %d", res.Tokens, c.want)
			}
		})
	}
}

func TestAgentCallerTokensWhenTheSeatReportsNoContext(t *testing.T) {
	// no context at the start: what the council saw when it seated the agent stands in, and the end's context is not
	// the turn's growth
	f := &fakeLink{state: SeatIdle, onSend: answers(1, "ok", 80_000)}
	req := agentReq(nil)
	req.Expert.Context = 250_000
	res, err := agentCaller(f).Call(context.Background(), req)
	if err != nil {
		t.Fatal(err)
	}
	if res.Tokens != 25_000 {
		t.Errorf("tokens = %d, want a tenth of the 250k the seat was seated with", res.Tokens)
	}
}

func TestAgentCallerCancelEndsTheWait(t *testing.T) {
	f := &fakeLink{state: SeatWorking}
	ctx, cancel := context.WithCancel(context.Background())
	time.AfterFunc(20*time.Millisecond, cancel)
	c := AgentCaller{Link: f, BusyCap: time.Minute, Poll: time.Millisecond}
	_, err := c.Call(ctx, agentReq(nil))
	var skipped SeatSkipped
	if !errors.Is(err, context.Canceled) || errors.As(err, &skipped) {
		t.Fatalf("err = %v, want the cancellation, not a skip", err)
	}
}

func TestAgentCallerFailures(t *testing.T) {
	boom := errors.New("boom")
	if _, err := agentCaller(&fakeLink{state: SeatIdle, sendErr: boom}).Call(context.Background(), agentReq(nil)); !errors.Is(err, boom) {
		t.Errorf("a failed send = %v, want it carried", err)
	}
	if _, err := agentCaller(&fakeLink{seatErr: boom}).Call(context.Background(), agentReq(nil)); !errors.Is(err, boom) {
		t.Errorf("a failed state read = %v, want it carried", err)
	}
	noTab := CallReq{Expert: CouncilExpert{Name: "Witness"}}
	if _, err := agentCaller(&fakeLink{state: SeatIdle}).Call(context.Background(), noTab); err == nil {
		t.Error("a seat with no agent tab took a turn")
	}
}

func TestAgentCallerCapWords(t *testing.T) {
	for d, want := range map[time.Duration]string{10 * time.Minute: "10 min", 20 * time.Minute: "20 min", 90 * time.Second: "1m30s", 20 * time.Millisecond: "20ms"} {
		if got := capText(d); got != want {
			t.Errorf("capText(%v) = %q, want %q", d, got, want)
		}
	}
	busy, turn, poll := AgentCaller{}.caps()
	if busy != 10*time.Minute || turn != 20*time.Minute || poll <= 0 {
		t.Errorf("default caps = %v, %v, %v, want 10 min busy, 20 min turn and a positive poll", busy, turn, poll)
	}
}
