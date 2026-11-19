// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/boarddrawer"
	"github.com/wavetermdev/waveterm/pkg/boardforward"
	"github.com/wavetermdev/waveterm/pkg/boardstore"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// seedForward writes a turn the drawer flagged and left forwarded, waiting for its agent, into the board's talk.
func (w *boardWorld) seedForward(boardId string, forward *wshrpc.BoardForward) wshrpc.BoardTurn {
	w.t.Helper()
	turn := wshrpc.BoardTurn{
		ID: uuid.NewString(), Ts: time.Now().Add(-time.Minute).UnixMilli(), Kind: boarddrawer.KindAsk, Question: "why two stores?",
		On: "Login box, Token store", State: boarddrawer.StateForwarded, Forward: forward,
	}
	_, err := boardstore.UpdateTalk(w.dir(), boardId, func(talk *wshrpc.BoardTalk) error {
		talk.Turns = append(talk.Turns, turn)
		return nil
	})
	if err != nil {
		w.t.Fatal(err)
	}
	return turn
}

func (w *boardWorld) board(info wshrpc.BoardInfo) boarddrawer.Board {
	return boarddrawer.Board{Project: w.project, BoardId: info.ID, Name: info.Name, ProjectPath: w.path}
}

// forwardNow is what the drawer does once it saved a flagged turn: hand it to the forwarder, and wait for that.
func (w *boardWorld) forwardNow(info wshrpc.BoardInfo, turnId string) {
	w.t.Helper()
	forwardBoardTurn(w.board(info), turnId)
	boardForwards.work.Wait()
}

// agentReports is a status report from the world's agent, as the hook delivers it, handled to the end.
func (w *boardWorld) agentReports(state string) {
	w.t.Helper()
	w.agent().Status.State = state
	noteBoardForwardStatus(&wps.WaveEvent{Event: wps.Event_AgentStatus, Data: baseds.AgentStatusData{ORef: blockORef(w.block), State: state}})
	boardForwards.work.Wait()
}

func (w *boardWorld) forward(boardId, turnId string) *wshrpc.BoardForward {
	w.t.Helper()
	for _, t := range w.talk(boardId).Turns {
		if t.ID == turnId {
			if t.Forward == nil {
				w.t.Fatalf("turn %s has no forward", turnId)
			}
			return t.Forward
		}
	}
	w.t.Fatalf("no turn %s", turnId)
	return nil
}

func (w *boardWorld) typedNow() []agentsDelivery {
	return append([]agentsDelivery(nil), *w.typed...)
}

// the question goes to the agent as its next message, headed by the marker Chat draws the chip from
func TestBoardForwardTypesTheQuestionIntoAFreeAgent(t *testing.T) {
	w := newBoardWorld(t)
	info := w.makeBoard("Auth flow")
	turn := w.seedForward(info.ID, &wshrpc.BoardForward{State: boarddrawer.ForwardWaiting})
	w.forwardNow(info, turn.ID)

	fw := w.forward(info.ID, turn.ID)
	if fw.State != boarddrawer.ForwardSent || fw.SentTs == 0 {
		t.Fatalf("forward: %+v", fw)
	}
	want := boardforward.Marker("Auth flow", "Login box, Token store", turn.ID, "why two stores?")
	if got := w.typedNow(); len(got) != 1 || got[0].blockId != w.block || got[0].text != want {
		t.Errorf("typed %+v, want %q into the agent's block", got, want)
	}
}

// an agent mid-turn is typed into as well: the message queues behind its turn, as one the person types would
func TestBoardForwardQueuesBehindARunningTurn(t *testing.T) {
	w := newBoardWorld(t)
	w.agent().Status.State = baseds.AgentState_Working
	info := w.makeBoard("Auth flow")
	turn := w.seedForward(info.ID, &wshrpc.BoardForward{State: boarddrawer.ForwardWaiting})
	w.forwardNow(info, turn.ID)
	if fw := w.forward(info.ID, turn.ID); fw.State != boarddrawer.ForwardSent || len(w.typedNow()) != 1 {
		t.Errorf("a working agent: forward %+v, typed %+v", fw, w.typedNow())
	}
}

// an agent with a question open would take the text as its answer: the forward waits on its turn, and goes once the
// agent is not asking
func TestBoardForwardWaitsWhileAskingThenGoes(t *testing.T) {
	for _, tc := range []struct {
		name  string
		asked func(tf *agentTabFacts)
	}{
		{"an open question", func(tf *agentTabFacts) { tf.OpenAsk = true }},
		{"a permission prompt", func(tf *agentTabFacts) { tf.Status.State = baseds.AgentState_Waiting }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			w := newBoardWorld(t)
			tc.asked(w.agent())
			info := w.makeBoard("Auth flow")
			turn := w.seedForward(info.ID, &wshrpc.BoardForward{State: boarddrawer.ForwardWaiting})
			w.forwardNow(info, turn.ID)
			if fw := w.forward(info.ID, turn.ID); fw.State != boarddrawer.ForwardWaiting || len(w.typedNow()) != 0 {
				t.Fatalf("an asking agent: forward %+v, typed %+v, want it waiting and nothing typed", fw, w.typedNow())
			}

			// an event while it still asks changes nothing
			w.agentReports(baseds.AgentState_Waiting)
			if len(w.typedNow()) != 0 {
				t.Fatal("typed into an agent that still has a prompt open")
			}

			// answered: its next report finds it free
			w.agent().OpenAsk = false
			w.agentReports(baseds.AgentState_Working)
			fw := w.forward(info.ID, turn.ID)
			if fw.State != boarddrawer.ForwardSent || len(w.typedNow()) != 1 || !strings.HasPrefix(w.typedNow()[0].text, `[From board "Auth flow"`) {
				t.Errorf("once the prompt was answered: forward %+v, typed %+v", fw, w.typedNow())
			}
			// and it is sent once, however many reports follow
			w.agentReports(baseds.AgentState_Working)
			if len(w.typedNow()) != 1 {
				t.Errorf("typed %d times", len(w.typedNow()))
			}
		})
	}
}

// a sleeping agent is woken by the forward, as a message the person types in Chat wakes it
func TestBoardForwardWakesASleeper(t *testing.T) {
	w := newBoardWorld(t)
	tf := w.agent()
	tf.ShellRunning, tf.Cmd, tf.Sleeping = false, "claude", time.Now().UnixMilli()
	// a wake in flight, which the forward joins and then delivers its message after: the real wake needs a block
	call := &wakeCall{done: make(chan struct{})}
	close(call.done)
	wakeMu.Lock()
	wakeCalls[w.block] = call
	wakeMu.Unlock()
	t.Cleanup(func() {
		wakeMu.Lock()
		delete(wakeCalls, w.block)
		wakeMu.Unlock()
	})

	info := w.makeBoard("Auth flow")
	turn := w.seedForward(info.ID, &wshrpc.BoardForward{State: boarddrawer.ForwardWaiting})
	w.forwardNow(info, turn.ID)
	if fw := w.forward(info.ID, turn.ID); fw.State != boarddrawer.ForwardSent {
		t.Fatalf("a sleeping agent: forward %+v", fw)
	}
	if got := w.typedNow(); len(got) != 1 || got[0].blockId != w.block || !strings.HasPrefix(got[0].text, `[From board "Auth flow"`) {
		t.Errorf("typed after the wake: %+v", got)
	}
}

// a tab that is gone leaves the forward agentgone, with the reason on it, and nothing typed anywhere
func TestBoardForwardToAGoneTabIsAgentGone(t *testing.T) {
	w := newBoardWorld(t)
	info := w.makeBoard("Auth flow")
	turn := w.seedForward(info.ID, &wshrpc.BoardForward{State: boarddrawer.ForwardWaiting})
	w.facts.Tabs = nil
	w.forwardNow(info, turn.ID)

	fw := w.forward(info.ID, turn.ID)
	if fw.State != boarddrawer.ForwardAgentGone || !strings.Contains(fw.Reason, "lead is no longer a live agent") {
		t.Errorf("forward to a gone tab: %+v", fw)
	}
	if len(w.typedNow()) != 0 {
		t.Errorf("typed %+v", w.typedNow())
	}
	// the question stays on the turn: nothing is lost
	if got := w.talk(info.ID).Turns[0]; got.Question != "why two stores?" || got.State != boarddrawer.StateForwarded {
		t.Errorf("the turn: %+v", got)
	}
}

// an agent killed at its shell prompt is listed as live and takes no message: the forward says so instead of waiting
func TestBoardForwardToAKilledAgentIsAgentGone(t *testing.T) {
	w := newBoardWorld(t)
	old := shellHoldsNothing
	shellHoldsNothing = func(string) bool { return true }
	t.Cleanup(func() { shellHoldsNothing = old })
	info := w.makeBoard("Auth flow")
	turn := w.seedForward(info.ID, &wshrpc.BoardForward{State: boarddrawer.ForwardWaiting})
	w.forwardNow(info, turn.ID)
	if fw := w.forward(info.ID, turn.ID); fw.State != boarddrawer.ForwardAgentGone || !strings.Contains(fw.Reason, "back at its shell prompt") || len(w.typedNow()) != 0 {
		t.Errorf("forward to a killed agent: %+v, typed %+v", fw, w.typedNow())
	}
}

// the agent's reply is copied from its transcript at its turn end, not while it still works
func TestBoardForwardCopiesTheReplyAtTurnEnd(t *testing.T) {
	w := newBoardWorld(t)
	info := w.makeBoard("Auth flow")
	turn := w.seedForward(info.ID, &wshrpc.BoardForward{State: boarddrawer.ForwardWaiting})
	w.forwardNow(info, turn.ID)
	if w.forward(info.ID, turn.ID).State != boarddrawer.ForwardSent {
		t.Fatal("not sent")
	}

	// the agent got the message and wrote part of a reply; its turn is not over
	now := time.Now().UnixMilli()
	marker := boardforward.Marker("Auth flow", turn.On, turn.ID, turn.Question)
	w.writeTranscript(
		claudeLine(t, "agent", "an earlier answer", now-5000),
		claudeLine(t, "user", marker, now-3000),
		claudeLine(t, "agent", "Two stores because the token outlives the session.", now-2000),
	)
	w.agentReports(baseds.AgentState_Working)
	if fw := w.forward(info.ID, turn.ID); fw.State != boarddrawer.ForwardSent || fw.Reply != "" {
		t.Fatalf("the reply was copied mid-turn: %+v", fw)
	}

	w.agentReports(baseds.AgentState_Idle)
	fw := w.forward(info.ID, turn.ID)
	if fw.State != boarddrawer.ForwardReplied || fw.Reply != "Two stores because the token outlives the session." || fw.ReplyTs != now-2000 {
		t.Fatalf("at the turn's end: %+v", fw)
	}
	// replied is the end: a later report leaves it alone
	w.agentReports(baseds.AgentState_Idle)
	if again := w.forward(info.ID, turn.ID); again.ReplyTs != fw.ReplyTs {
		t.Errorf("the reply was rewritten: %+v", again)
	}
}

// a turn end that holds no reply to this forward (the message is still queued) waits for the next
func TestBoardForwardWaitsForTheMarkedMessageBeforeReading(t *testing.T) {
	w := newBoardWorld(t)
	info := w.makeBoard("Auth flow")
	turn := w.seedForward(info.ID, &wshrpc.BoardForward{State: boarddrawer.ForwardWaiting})
	w.forwardNow(info, turn.ID)
	now := time.Now().UnixMilli()
	w.writeTranscript(claudeLine(t, "agent", "the turn that was running when the message queued", now-1000))
	w.agentReports(baseds.AgentState_Idle)
	if fw := w.forward(info.ID, turn.ID); fw.State != boarddrawer.ForwardSent || fw.Reply != "" {
		t.Errorf("the reply of another turn was taken: %+v", fw)
	}
}

// the index is in memory and rebuilt from the talk files, so a restart loses no forward
func TestBoardForwarderIndexSurvivesAReset(t *testing.T) {
	w := newBoardWorld(t)
	info := w.makeBoard("Auth flow")
	now := time.Now().UnixMilli()
	waiting := w.seedForward(info.ID, &wshrpc.BoardForward{State: boarddrawer.ForwardWaiting})
	sent := w.seedForward(info.ID, &wshrpc.BoardForward{State: boarddrawer.ForwardSent, SentTs: now - 2000})
	w.writeTranscript(
		claudeLine(t, "user", boardforward.Marker("Auth flow", sent.On, sent.ID, sent.Question), now-1500),
		claudeLine(t, "agent", "because of the refresh token", now-1000),
	)

	boardForwards.work.Wait()
	boardForwards = &boardForwarder{} // as a restart: nothing in memory

	w.agentReports(baseds.AgentState_Idle)
	if fw := w.forward(info.ID, sent.ID); fw.State != boarddrawer.ForwardReplied || fw.Reply != "because of the refresh token" {
		t.Errorf("the sent forward after a restart: %+v", fw)
	}
	if fw := w.forward(info.ID, waiting.ID); fw.State != boarddrawer.ForwardSent || len(w.typedNow()) != 1 {
		t.Errorf("the waiting forward after a restart: %+v, typed %+v", fw, w.typedNow())
	}
}

// however it is asked to (the drawer, a reroute, a status report at once), one forward is typed once
func TestBoardForwardIsTypedOnce(t *testing.T) {
	w := newBoardWorld(t)
	info := w.makeBoard("Auth flow")
	turn := w.seedForward(info.ID, &wshrpc.BoardForward{State: boarddrawer.ForwardWaiting})
	var wg sync.WaitGroup
	for range 4 {
		wg.Add(2)
		go func() {
			defer wg.Done()
			boardForwards.forward(w.ctx, w.board(info), turn.ID)
		}()
		go func() {
			defer wg.Done()
			noteBoardForwardStatus(&wps.WaveEvent{Event: wps.Event_AgentStatus, Data: baseds.AgentStatusData{ORef: blockORef(w.block), State: baseds.AgentState_Idle}})
		}()
	}
	wg.Wait()
	boardForwards.work.Wait()
	if got := w.typedNow(); len(got) != 1 {
		t.Fatalf("typed %d times: %+v", len(got), got)
	}
	if w.forward(info.ID, turn.ID).State != boarddrawer.ForwardSent {
		t.Error("not sent")
	}
}

// the whole path: the drawer flags the person's ask, the forwarder sends it, the agent replies, the reply is copied
func TestBoardAskFlaggedIsForwardedAndAnswered(t *testing.T) {
	w := newBoardWorld(t)
	info := w.makeBoard("Auth flow")
	w.model.reply = func(boarddrawer.Call) (string, error) { return boardQuestion, nil }
	if err := w.ask(info.ID, "why two stores?"); err != nil {
		t.Fatal(err)
	}
	turnId := w.lastTurn(info.ID).ID
	w.waitTurn(info.ID, turnId, boarddrawer.StateForwarded)
	waitFor(t, func() bool { return w.forwardOf(info.ID, turnId) == boarddrawer.ForwardSent }, "the forward to be sent")
	if got := w.typedNow(); len(got) != 1 || !strings.Contains(got[0].text, "turn "+turnId) || !strings.HasSuffix(got[0].text, "why two stores?") {
		t.Fatalf("typed %+v", got)
	}

	// the forward is typed after its turn was made, so its transcript lines are stamped after the turn
	made := w.lastTurn(info.ID).Ts
	w.writeTranscript(claudeLine(t, "user", w.typedNow()[0].text, made+1000), claudeLine(t, "agent", "Because tokens outlive sessions.", made+2000))
	boardForwards.work.Wait()
	w.agentReports(baseds.AgentState_Idle)
	if fw := w.forward(info.ID, turnId); fw.State != boarddrawer.ForwardReplied || fw.Reply != "Because tokens outlive sessions." {
		t.Errorf("forward: %+v", fw)
	}
}

func (w *boardWorld) forwardOf(boardId, turnId string) string {
	for _, t := range w.talk(boardId).Turns {
		if t.ID == turnId && t.Forward != nil {
			return t.Forward.State
		}
	}
	return ""
}
