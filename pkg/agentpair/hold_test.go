// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentpair

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func TestHoldRefusesAHeavyCommandWhileTheJudgeOwes(t *testing.T) {
	r := newRig(t)
	v := r.paired(workerPlan)

	reason, held := r.m.Hold("w", "npm run build")
	want := "Held: arcterm holds heavy commands while your judge has not answered your last reply. " +
		"End your turn now and say in your reply that you mean to run `npm run build`; once the judge answers, run it in your next turn."
	if !held || reason != want {
		t.Fatalf("held %v, reason %q", held, reason)
	}
	if in := r.internal(v.Id); len(in.Held) != 1 || in.Held[0].Command != "npm run build" || in.Held[0].Ts == 0 || in.Held[0].RunTs != 0 {
		t.Fatalf("held = %+v: the refusal is recorded on the pair", in.Held)
	}

	// the agent asks again: refused again, recorded once
	if _, held := r.m.Hold("w", "npm run build"); !held {
		t.Fatal("the same command was let through the second time")
	}
	if in := r.internal(v.Id); len(in.Held) != 1 {
		t.Fatalf("held = %+v: one command, one line", in.Held)
	}

	// and saved: a restart still knows it
	fresh := r.manager()
	fresh.Paired("w")
	fresh.mu.Lock()
	held2 := fresh.pairs[v.Id].Held
	fresh.mu.Unlock()
	if len(held2) != 1 {
		t.Fatalf("after a reload held = %+v", held2)
	}
}

func TestHoldLetsThroughWhatIsNotHeld(t *testing.T) {
	r := newRig(t)
	r.link.add("loner", "Loner")
	r.paired(workerPlan)

	if _, held := r.m.Hold("loner", "make"); held {
		t.Error("an agent in no pair was held")
	}
	if _, held := r.m.Hold("j1", "make"); held {
		t.Error("a judge was held: the hold is the working agent's")
	}

	// the judge answers: nothing is owed any more
	r.reply("j1", "> Plan v1.\nOne point.\n"+judgeBlock("new: a"))
	if _, held := r.m.Hold("w", "make"); held {
		t.Error("held after the judge answered")
	}
}

func TestHoldOffWhenThePairWasStartedWithoutIt(t *testing.T) {
	r := newRig(t)
	r.link.give("w", workerPlan)
	r.start(wshrpc.CommandPairStartData{HoldHeavy: false})
	if _, held := r.m.Hold("w", "make"); held {
		t.Fatal("held although the pair holds nothing")
	}
}

func TestHoldAttachesRefusedCommandsToTheNextWorkerMessage(t *testing.T) {
	r := newRig(t)
	v := r.paired(workerPlan)
	r.m.Hold("w", "npm run build")
	r.m.Hold("w", "go test ./...")

	r.reply("w", "I mean to run npm run build next.\n"+pairBlock("O1 x"))
	view := r.view(v.Id)
	msg := lastWorkerMsg(view)
	if len(msg.Held) != 2 || msg.Held[0].Command != "npm run build" || msg.Held[1].Command != "go test ./..." {
		t.Fatalf("held on the worker's message = %+v", msg.Held)
	}
	if in := r.internal(v.Id); len(in.Held) != 0 {
		t.Fatalf("held on the pair = %+v: the message took them", in.Held)
	}
	if first := view.Messages[0]; len(first.Held) != 0 {
		t.Fatalf("held on the first message = %+v", first.Held)
	}
}

func TestRunNowLetsACommandThroughOnce(t *testing.T) {
	r := newRig(t)
	v := r.paired(workerPlan)
	r.m.Hold("w", "npm run build")
	r.reply("w", "I mean to run npm run build next.\n"+pairBlock("O1 x"))
	msg := lastWorkerMsg(r.view(v.Id))
	if _, held := r.m.Hold("w", "other heavy"); !held {
		t.Fatal("not held")
	}

	if err := r.m.RunNow(ctx, wshrpc.CommandPairRunNowData{PairId: v.Id, MsgId: msg.Id, Command: "npm run build"}); err != nil {
		t.Fatal(err)
	}
	view := r.view(v.Id)
	if got := lastWorkerMsg(view).Held; len(got) != 1 || got[0].RunTs == 0 {
		t.Fatalf("held on the worker's message = %+v: want it marked let through", got)
	}
	line := lastLine(view)
	if line.From != FromPerson || line.To != ToWorker || line.Text != "Run `npm run build` now: the person let it through without waiting for the judge." {
		t.Fatalf("last message = %+v", line)
	}
	w := r.link.sent("w")
	if len(w) != 1 {
		t.Fatalf("the worker was sent %q: it is told the command may run", w)
	}
	contains(t, "the worker's prompt", w[0], "From the person", "Run `npm run build` now")

	if _, held := r.m.Hold("w", "npm run build"); held {
		t.Fatal("the command Run now let through was held")
	}
	if _, held := r.m.Hold("w", "npm run build"); !held {
		t.Fatal("the pass is for one run: the next one is held again")
	}
	if _, held := r.m.Hold("w", "other heavy"); !held {
		t.Fatal("a different command was let through")
	}
	if in := r.internal(v.Id); len(in.Passes) != 0 {
		t.Fatalf("passes = %v: consumed", in.Passes)
	}
}

func TestRunNowRefuses(t *testing.T) {
	r := newRig(t)
	v := r.paired(workerPlan)
	r.m.Hold("w", "npm run build")
	r.reply("w", "Next.\n"+pairBlock("O1 x"))
	msg := lastWorkerMsg(r.view(v.Id))

	for name, d := range map[string]wshrpc.CommandPairRunNowData{
		"no such pair":                       {PairId: "nope", MsgId: msg.Id, Command: "npm run build"},
		"no such message":                    {PairId: v.Id, MsgId: "m99", Command: "npm run build"},
		"a command the message did not hold": {PairId: v.Id, MsgId: msg.Id, Command: "rm -rf /"},
		"a message that held nothing":        {PairId: v.Id, MsgId: v.Messages[0].Id, Command: "npm run build"},
	} {
		if err := r.m.RunNow(ctx, d); err == nil {
			t.Errorf("%s: RunNow took it", name)
		}
	}
	if err := r.m.RunNow(ctx, wshrpc.CommandPairRunNowData{PairId: v.Id, MsgId: msg.Id, Command: "npm run build"}); err != nil {
		t.Fatal(err)
	}
	if err := r.m.RunNow(ctx, wshrpc.CommandPairRunNowData{PairId: v.Id, MsgId: msg.Id, Command: "npm run build"}); err == nil {
		t.Error("RunNow let one command through twice")
	}
	if in := r.internal(v.Id); len(in.Passes) != 1 {
		t.Fatalf("passes = %v: one pass for one run", in.Passes)
	}
}

func TestUnpairLiftsTheHoldAndTellsTheWorkerWhatItMayRun(t *testing.T) {
	r := newRig(t)
	v := r.paired(workerPlan)
	r.m.Hold("w", "make a")
	r.reply("w", "Next.\n"+pairBlock("O1 x")) // "make a" is on this message
	r.m.Hold("w", "make b")                   // not yet on any message
	msg := lastWorkerMsg(r.view(v.Id))
	if err := r.m.RunNow(ctx, wshrpc.CommandPairRunNowData{PairId: v.Id, MsgId: msg.Id, Command: "make a"}); err != nil {
		t.Fatal(err)
	}
	r.link.setState("w", "idle")
	before := len(r.link.sent("w"))

	if err := r.m.Unpair(ctx, v.Id); err != nil {
		t.Fatal(err)
	}
	w := r.link.sent("w")
	if len(w) != before+1 {
		t.Fatalf("the worker was sent %d prompts: want one line about what it may run", len(w)-before)
	}
	contains(t, "the worker's prompt", w[len(w)-1], "make b")
	if got := w[len(w)-1]; strings.Contains(got, "make a") {
		t.Fatalf("the prompt names a command that was already let through: %q", got)
	}
	if _, held := r.m.Hold("w", "make c"); held {
		t.Fatal("held after Unpair")
	}
	if len(r.m.List()) != 0 || r.m.Paired("w") || r.m.Paired("j1") {
		t.Fatal("the pair is still listed")
	}
	if _, err := r.m.Get(v.Id); err == nil {
		t.Fatal("Get found an unpaired pair")
	}
	if r.published() == 0 {
		t.Fatal("no pair:update")
	}

	// the file stays, ended, so the history is not lost; a restart does not bring the pair back
	b, err := os.ReadFile(filepath.Join(r.dir, v.Id+".json"))
	if err != nil {
		t.Fatalf("an unpaired pair keeps its file: %v", err)
	}
	var stored Pair
	if err := json.Unmarshal(b, &stored); err != nil || stored.State != StateEnded {
		t.Fatalf("stored state %q, %v", stored.State, err)
	}
	if r.manager().Paired("w") {
		t.Fatal("an ended pair came back after a restart")
	}
	// and the two can pair again
	r.link.give("w", workerPlan)
	r.start(wshrpc.CommandPairStartData{})
}

// A command held on an earlier message and freed when the judge answered is not "still held": the agent has very likely
// run it, and Unpair must not wake it to run it again.
func TestUnpairAfterTheJudgeAnsweredTellsNoOneToRunAFreedCommand(t *testing.T) {
	r := newRig(t)
	v := r.paired(workerPlan)
	r.m.Hold("w", "make a")
	r.reply("w", "I mean to run make a next.\n"+pairBlock("O1 x")) // "make a" now sits on this message
	r.reply("j1", "> I mean to run make a next.\nOne point.\n"+judgeBlock("new: a"))
	if _, held := r.m.Hold("w", "make a"); held {
		t.Fatal("held after the judge answered")
	}
	r.link.setState("w", "idle")
	before := len(r.link.sent("w"))

	if err := r.m.Unpair(ctx, v.Id); err != nil {
		t.Fatal(err)
	}
	if got := r.link.sent("w"); len(got) != before {
		t.Fatalf("the worker was sent %q: nothing was held any more", got[before:])
	}
}

func TestUnpairWithNothingHeldTellsNoOne(t *testing.T) {
	r := newRig(t)
	v := r.paired(workerPlan)
	if err := r.m.Unpair(ctx, v.Id); err != nil {
		t.Fatal(err)
	}
	if got := r.link.sent("w"); len(got) != 0 {
		t.Fatalf("the worker was sent %q", got)
	}
	if got := r.link.sent("j1"); len(got) != 1 {
		t.Fatalf("the judge was sent %d prompts: only its brief", len(got))
	}
	if err := r.m.Unpair(ctx, v.Id); err == nil {
		t.Fatal("Unpair of an ended pair took it")
	}
}
