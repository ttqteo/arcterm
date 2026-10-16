// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/agentask"
	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

type deliveredAnswer struct {
	oref, askId string
	answers     []baseds.AgentAnswerItem
}

// stubLeadDelivery replaces the lead-answer seam with one that reports each call and then blocks until
// release is closed, returning err.
func stubLeadDelivery(t *testing.T, err error) (calls chan deliveredAnswer, release chan struct{}) {
	t.Helper()
	calls, release = make(chan deliveredAnswer, 4), make(chan struct{})
	old := deliverLeadAnswerFn
	deliverLeadAnswerFn = func(oref, askId string, answers []baseds.AgentAnswerItem) (bool, error) {
		calls <- deliveredAnswer{oref, askId, answers}
		<-release
		return err == nil, err
	}
	t.Cleanup(func() { deliverLeadAnswerFn = old })
	return calls, release
}

func leadAskOref() string {
	return waveobj.MakeORef(waveobj.OType_Block, wakeLeadBlock).String()
}

func seedLeadOwnAsk(questions ...baseds.AgentAskQuestion) {
	agentask.GlobalRegistry.Set(leadAskOref(), agentask.PendingAsk{AskId: "lead-ask", BlockId: wakeLeadBlock, Questions: questions})
}

func singleSelect() baseds.AgentAskQuestion {
	return baseds.AgentAskQuestion{Question: "Spec review", Options: []baseds.AgentAskOption{{Label: "Approve"}, {Label: "Revise"}}}
}

func previewSelect() baseds.AgentAskQuestion {
	return baseds.AgentAskQuestion{Question: "Which layout?", Options: []baseds.AgentAskOption{{Label: "A", Preview: "a"}, {Label: "B", Preview: "b"}}}
}

func TestApplyAutonomousSwitchOnAnswersLeadQuestionInBackground(t *testing.T) {
	f := newFakeLead(t)
	f.state.State = baseds.AgentState_Asking
	seedLeadOwnAsk(singleSelect())
	calls, release := stubLeadDelivery(t, nil)

	if err := ApplyAutonomousSwitch(context.Background(), wakeChannel, wakeRun, true); err != nil {
		t.Fatalf("a single-select lead question takes the ON answer, got %v", err)
	}
	// the seam is still blocked here, so returning proves the typing does not hold the save
	select {
	case got := <-calls:
		if got.oref != leadAskOref() || got.askId != "lead-ask" {
			t.Fatalf("the answer goes to the lead's own ask, got %s/%s", got.oref, got.askId)
		}
		if len(got.answers) != 1 || got.answers[0].Text != jarvis.AutonomousOnAnswer {
			t.Fatalf("the answer is AutonomousOnAnswer as text, got %+v", got.answers)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the delivery seam was never called")
	}
	close(release)
	if len(f.sends) != 0 {
		t.Fatalf("the ON wake waits while the lead's own question is open, got %q", f.sends)
	}
	if rw := wakes.runs[wakeRun]; rw == nil || len(rw.lines) != 1 || rw.lines[0] != jarvis.AutonomousOnWake {
		t.Fatalf("the ON wake is held for the lead, got %+v", rw)
	}
}

func TestApplyAutonomousSwitchOnRefusedAnswerLeavesQuestionToHuman(t *testing.T) {
	f := newFakeLead(t)
	f.state.State = baseds.AgentState_Asking
	seedLeadOwnAsk(previewSelect(), singleSelect())
	calls, release := stubLeadDelivery(t, nil)
	defer close(release)

	err := ApplyAutonomousSwitch(context.Background(), wakeChannel, wakeRun, true)
	if err == nil || !strings.Contains(err.Error(), "still needs an answer in its terminal") || !strings.Contains(err.Error(), "free-text") {
		t.Fatalf("a preview batch refuses free text: the error says the question is still open and why, got %v", err)
	}
	select {
	case got := <-calls:
		t.Fatalf("a refused answer is never delivered, got %+v", got)
	case <-time.After(50 * time.Millisecond):
	}
	if _, ok := agentask.GlobalRegistry.Get(leadAskOref()); !ok {
		t.Fatal("the lead's question stays pending for the human")
	}
	if rw := wakes.runs[wakeRun]; rw == nil || len(rw.lines) != 1 || rw.lines[0] != jarvis.AutonomousOnWake {
		t.Fatalf("the ON wake is still posted, got %+v", rw)
	}
}

func TestApplyAutonomousSwitchOnWithoutLeadQuestionWakesOnly(t *testing.T) {
	f := newFakeLead(t)
	calls, release := stubLeadDelivery(t, nil)
	defer close(release)

	if err := ApplyAutonomousSwitch(context.Background(), wakeChannel, wakeRun, true); err != nil {
		t.Fatalf("ON with nothing waiting: %v", err)
	}
	if len(f.sends) != 1 || f.sends[0] != jarvis.AutonomousOnWake {
		t.Fatalf("an idle lead gets the ON wake at once, got %q", f.sends)
	}
	select {
	case got := <-calls:
		t.Fatalf("nothing to answer, got %+v", got)
	default:
	}
}

func TestApplyAutonomousSwitchOnReturnsHumansWorkerAsksToLead(t *testing.T) {
	f := newFakeLead(t)
	f.state.State = baseds.AgentState_Working // the wake waits, so the asks are observable as moved
	stubLeadDelivery(t, nil)
	mine, other := "block:mine", "block:other"
	agentask.GlobalRegistry.Set(mine, agentask.PendingAsk{
		AskId: "a-1", BlockId: "child", Questions: []baseds.AgentAskQuestion{singleSelect()},
		Owner: agentask.AskOwner_User, Note: "lead forwarded it", Deadline: 5,
		ChannelId: wakeChannel, RunId: wakeRun, TaskId: "t-1", DagOID: "dag-1",
	})
	agentask.GlobalRegistry.Set(other, agentask.PendingAsk{
		AskId: "a-2", BlockId: "child2", Questions: []baseds.AgentAskQuestion{singleSelect()},
		Owner: agentask.AskOwner_User, Note: "elsewhere", Deadline: 5,
		ChannelId: wakeChannel, RunId: "run-other", TaskId: "t-1", DagOID: "dag-2",
	})
	// told before it moved to the human: it must be named again
	wakes.runLocked(wakeChannel, wakeRun).told["a-1/0"] = true

	if err := ApplyAutonomousSwitch(context.Background(), wakeChannel, wakeRun, true); err != nil {
		t.Fatalf("ON: %v", err)
	}
	got, _ := agentask.GlobalRegistry.Get(mine)
	if got.Owner != agentask.AskOwner_Lead || got.Note != "" || got.Deadline != f.now+LeadAskDeadline.Milliseconds() {
		t.Fatalf("the run's human-held ask goes back to the lead with a fresh deadline and no note, got %+v", got)
	}
	if wakes.runs[wakeRun].told["a-1/0"] {
		t.Fatal("the returned ask is news to the lead again")
	}
	untouched, _ := agentask.GlobalRegistry.Get(other)
	if untouched.Owner != agentask.AskOwner_User || untouched.Note != "elsewhere" || untouched.Deadline != 5 {
		t.Fatalf("another run's ask is untouched, got %+v", untouched)
	}

	f.state.State = baseds.AgentState_Idle
	NoteLeadStatus(context.Background(), f.status(baseds.AgentState_Idle))
	if len(f.sends) != 1 || !strings.Contains(f.sends[0], jarvis.AutonomousOnWake) || !strings.Contains(f.sends[0], "1 question waiting") {
		t.Fatalf("the ON wake names the returned question, got %q", f.sends)
	}
}

func TestApplyAutonomousSwitchOffWakesAndMovesNothing(t *testing.T) {
	f := newFakeLead(t)
	f.state.State = baseds.AgentState_Asking
	seedLeadOwnAsk(singleSelect())
	calls, release := stubLeadDelivery(t, nil)
	defer close(release)
	held := "block:held"
	agentask.GlobalRegistry.Set(held, agentask.PendingAsk{
		AskId: "a-1", BlockId: "child", Questions: []baseds.AgentAskQuestion{singleSelect()},
		Owner: agentask.AskOwner_User, Note: "lead forwarded it", Deadline: 5,
		ChannelId: wakeChannel, RunId: wakeRun, TaskId: "t-1", DagOID: "dag-1",
	})

	if err := ApplyAutonomousSwitch(context.Background(), wakeChannel, wakeRun, false); err != nil {
		t.Fatalf("OFF: %v", err)
	}
	if rw := wakes.runs[wakeRun]; rw == nil || len(rw.lines) != 1 || rw.lines[0] != jarvis.AutonomousOffWake {
		t.Fatalf("OFF posts AutonomousOffWake, got %+v", rw)
	}
	got, _ := agentask.GlobalRegistry.Get(held)
	if got.Owner != agentask.AskOwner_User || got.Note != "lead forwarded it" || got.Deadline != 5 {
		t.Fatalf("OFF moves no ask, got %+v", got)
	}
	if _, ok := agentask.GlobalRegistry.Get(leadAskOref()); !ok {
		t.Fatal("OFF leaves the lead's question alone")
	}
	select {
	case got := <-calls:
		t.Fatalf("OFF answers nothing, got %+v", got)
	default:
	}
}

func TestApplyAutonomousSwitchRecordsDeliveryFailure(t *testing.T) {
	f := newFakeLead(t)
	f.state.State = baseds.AgentState_Asking
	seedLeadOwnAsk(singleSelect())
	recorded := make(chan map[string]any, 1)
	appendRunEvent = func(_ context.Context, _, runId, kind string, _ *int, detail any) {
		if kind == waveobj.RunEventKindLeadWakeFailed && runId == wakeRun {
			recorded <- detail.(map[string]any)
		}
	}
	_, release := stubLeadDelivery(t, errors.New("pty closed"))
	close(release)

	if err := ApplyAutonomousSwitch(context.Background(), wakeChannel, wakeRun, true); err != nil {
		t.Fatalf("the save returns before delivery fails: %v", err)
	}
	select {
	case d := <-recorded:
		if reason, _ := d["reason"].(string); !strings.Contains(reason, "pty closed") {
			t.Fatalf("the row carries the delivery error, got %+v", d)
		}
	case <-time.After(5 * time.Second):
		t.Fatalf("a failed delivery is recorded on the run, rows %+v", f.rows)
	}
}

func TestApplyAutonomousSwitchWithoutLeadPostsNoWake(t *testing.T) {
	for _, st := range []leadState{{}, {NoLead: true}} {
		f := newFakeLead(t)
		f.state = st
		launched := stubLaunch(t)
		for _, on := range []bool{true, false} {
			if err := ApplyAutonomousSwitch(context.Background(), wakeChannel, wakeRun, on); err != nil {
				t.Fatalf("lead state %+v, on %v: %v", st, on, err)
			}
		}
		if rw := wakes.runs[wakeRun]; rw != nil && (rw.dead || len(rw.lines) > 0 || len(rw.missed) > 0) {
			t.Fatalf("lead state %+v: a run with no lead is not woken, got %+v", st, rw)
		}
		if len(*launched) != 0 || f.countKind(waveobj.RunEventKindLeadWakeFailed) != 0 {
			t.Fatalf("lead state %+v: nothing is launched or failed, launched %q rows %+v", st, *launched, f.rows)
		}
	}
}

func TestApplyAutonomousSwitchWithoutLeadStartsOneForReturnedAsks(t *testing.T) {
	f := newFakeLead(t)
	f.state = leadState{NoLead: true}
	launched := stubLaunch(t)
	agentask.GlobalRegistry.Set("block:mine", agentask.PendingAsk{
		AskId: "a-1", BlockId: "child", Questions: []baseds.AgentAskQuestion{singleSelect()},
		Owner: agentask.AskOwner_User, ChannelId: wakeChannel, RunId: wakeRun, TaskId: "t-1", DagOID: "dag-1",
	})

	if err := ApplyAutonomousSwitch(context.Background(), wakeChannel, wakeRun, true); err != nil {
		t.Fatalf("ON: %v", err)
	}
	if len(*launched) != 1 || !strings.Contains((*launched)[0], "1 question waiting") {
		t.Fatalf("a returned question starts a lead to answer it, got %q", *launched)
	}
}
