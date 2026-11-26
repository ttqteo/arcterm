// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentpair

import (
	"errors"
	"reflect"
	"slices"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// sameAfterReload checks the live index against what a manager that read every pair file would say: the two must never
// differ, so a restart does not bring a judge back or lose one.
func sameAfterReload(t *testing.T, r *rig) {
	t.Helper()
	live, fresh := r.m.Resting(), r.manager().Resting()
	if !reflect.DeepEqual(live, fresh) {
		t.Fatalf("Resting() = %+v, and %+v after a reload from the files", live, fresh)
	}
}

// restingFrom is the entry of a judge resting from the pair v: the fake link names each agent's transcript after its tab,
// so its session id is the tab
func restingFrom(v *wshrpc.PairView, tab, name string) wshrpc.PairResting {
	return wshrpc.PairResting{
		Tab: tab, Name: name, WorkerTab: v.Worker.Tab, PairId: v.Id, Ts: v.CreatedTs, Session: tab, WorkerSession: v.Worker.Tab,
	}
}

// Resting lists a launched judge whose newest pair has ended, drops it when it joins a new pair, and the same list comes
// back from the files after a restart
func TestRestingLaunchedJudgeComesAndGoesWithItsPairs(t *testing.T) {
	r := newRig(t)
	if got := r.m.Resting(); got == nil || len(got) != 0 {
		t.Fatalf("Resting() = %#v before any pair, want a non-nil empty list (it reaches the frontend as an array)", got)
	}
	r.link.give("w", workerPlan)
	first := r.start(wshrpc.CommandPairStartData{Launched: true})
	if got := r.m.Resting(); len(got) != 0 {
		t.Fatalf("Resting() = %+v while its pair is live", got)
	}
	sameAfterReload(t, r)

	if err := r.m.Unpair(ctx, first.Id); err != nil {
		t.Fatal(err)
	}
	want := []wshrpc.PairResting{restingFrom(first, "j1", "Judge one")}
	if got := r.m.Resting(); !reflect.DeepEqual(got, want) {
		t.Fatalf("Resting() = %+v, want %+v after the pair ended", got, want)
	}
	sameAfterReload(t, r)

	// ⚖ under a reply wakes it: PairStart, not briefed, launched. It is in a pair again, so it rests no more
	r.link.give("w", workerPlan)
	second := r.start(wshrpc.CommandPairStartData{Launched: true})
	if got := r.m.Resting(); len(got) != 0 {
		t.Fatalf("Resting() = %+v after the judge joined a new pair", got)
	}
	sameAfterReload(t, r)

	// and it rests on the newest pair when that one ends
	if err := r.m.Unpair(ctx, second.Id); err != nil {
		t.Fatal(err)
	}
	want = []wshrpc.PairResting{restingFrom(second, "j1", "Judge one")}
	if got := r.m.Resting(); !reflect.DeepEqual(got, want) {
		t.Fatalf("Resting() = %+v, want %+v: the newest pair is the one it rests from", got, want)
	}
	sameAfterReload(t, r)
}

// a worker's resting judges are listed newest first, by the pair each rests from and not by their tab ids (random in
// life): the frontend takes the first of a worker's entries as the judge ⚖ under a reply wakes
func TestRestingListsAWorkersJudgesNewestFirst(t *testing.T) {
	t.Run("the newer pair's judge has the tab that sorts after", func(t *testing.T) {
		r := newRig(t)
		r.link.add("j2", "Judge two")
		r.link.give("w", workerPlan)
		older := r.start(wshrpc.CommandPairStartData{Launched: true}) // j1
		if err := r.m.Unpair(ctx, older.Id); err != nil {
			t.Fatal(err)
		}
		r.link.give("w", workerPlan)
		newer := r.start(wshrpc.CommandPairStartData{JudgeTab: "j2", Launched: true})
		if err := r.m.Unpair(ctx, newer.Id); err != nil {
			t.Fatal(err)
		}
		want := []wshrpc.PairResting{
			restingFrom(newer, "j2", "Judge two"),
			restingFrom(older, "j1", "Judge one"),
		}
		if got := r.m.Resting(); !reflect.DeepEqual(got, want) {
			t.Fatalf("Resting() = %+v, want %+v: the judge of the newer pair first, though its tab sorts after", got, want)
		}
		if got := r.manager().Resting(); !reflect.DeepEqual(got, want) {
			t.Fatalf("Resting() = %+v after a restart, want %+v", got, want)
		}
	})

	t.Run("two judges of one pair tie, and the tab breaks it", func(t *testing.T) {
		r := newRig(t)
		r.link.add("j2", "Judge two")
		r.link.give("w", workerPlan)
		v := r.start(wshrpc.CommandPairStartData{JudgeTab: "j2", Launched: true})
		r.start(wshrpc.CommandPairStartData{Launched: true}) // j1, added to the live pair
		if err := r.m.Unpair(ctx, v.Id); err != nil {
			t.Fatal(err)
		}
		want := []wshrpc.PairResting{
			restingFrom(v, "j1", "Judge one"),
			restingFrom(v, "j2", "Judge two"),
		}
		for range 20 { // the index is a map: a missing tie-break shows as a changing order
			if got := r.manager().Resting(); !reflect.DeepEqual(got, want) {
				t.Fatalf("Resting() = %+v after a restart, want %+v: the same pair, so the tab decides", got, want)
			}
		}
	})
}

// a judge the person picked is no launched judge: when its pair ends it is a plain agent again, and so is one that is gone
func TestRestingLeavesOutAPickedJudgeAndAGoneOne(t *testing.T) {
	r := newRig(t)
	r.link.give("w", workerPlan)
	picked := r.start(wshrpc.CommandPairStartData{})
	if err := r.m.Unpair(ctx, picked.Id); err != nil {
		t.Fatal(err)
	}
	if got := r.m.Resting(); len(got) != 0 {
		t.Fatalf("Resting() = %+v: a picked judge does not rest", got)
	}
	sameAfterReload(t, r)

	// a launched judge whose tab is deleted has nowhere to rest
	r.link.give("w", workerPlan)
	gone := r.start(wshrpc.CommandPairStartData{Launched: true})
	delete(r.link.agents, "j1")
	r.reply("w", "Again.\n"+pairBlock("O1 x"))
	if view := r.view(gone.Id); !view.Judges[0].Gone {
		t.Fatalf("judges = %+v: want the judge marked gone", view.Judges)
	}
	if err := r.m.Unpair(ctx, gone.Id); err != nil {
		t.Fatal(err)
	}
	if got := r.m.Resting(); len(got) != 0 {
		t.Fatalf("Resting() = %+v: a gone judge does not rest", got)
	}
	sameAfterReload(t, r)
}

// the round's end rests the launched judges, each from the pair that just ended, the picked one not at all
func TestRestingAfterARoundEnds(t *testing.T) {
	r := newRig(t)
	r.link.add("j2", "Judge two")
	r.link.give("w", workerPlan)
	v := r.start(wshrpc.CommandPairStartData{Launched: true})
	r.start(wshrpc.CommandPairStartData{JudgeTab: "j2"}) // picked from the live list
	r.link.setState("j1", "idle")
	r.link.setState("j2", "idle")
	r.link.setState("w", "working") // busy on something of its own: neither judge's reply is sent to it before the stop
	r.reply("j1", "> Plan v1.\nNothing to add.\n"+judgeBlock("no new points"))
	r.reply("j2", "> Plan v1.\nNothing to add.\n"+judgeBlock("no new points"))
	if view := r.view(v.Id); view.State != StateStopped {
		t.Fatalf("state %s, want the pair stopped", view.State)
	}

	r.reply("w", "One more thing the person asked me.\n"+pairBlock("O1 more"))
	want := []wshrpc.PairResting{restingFrom(v, "j1", "Judge one")}
	if got := r.m.Resting(); !reflect.DeepEqual(got, want) {
		t.Fatalf("Resting() = %+v, want only the launched judge %+v", got, want)
	}
	sameAfterReload(t, r)
}

// a pair that ended in a file the manager reads at its first call is known too, and the newest of a tab's pairs decides:
// an older ended pair never makes a judge rest while a newer one is live
func TestRestingReadsEndedPairsAtTheFirstLoadAndTheNewestWins(t *testing.T) {
	r := newRig(t)
	r.link.give("w", workerPlan)
	old := r.start(wshrpc.CommandPairStartData{Launched: true})
	if err := r.m.Unpair(ctx, old.Id); err != nil {
		t.Fatal(err)
	}
	r.link.give("w", workerPlan)
	live := r.start(wshrpc.CommandPairStartData{Launched: true})

	fresh := r.manager() // a restart: nothing read yet
	if got := fresh.Resting(); len(got) != 0 {
		t.Fatalf("Resting() = %+v after a restart: the judge is in the live pair %s, the older one's end is not its newest", got, live.Id)
	}
	if err := fresh.Unpair(ctx, live.Id); err != nil {
		t.Fatal(err)
	}
	want := []wshrpc.PairResting{restingFrom(live, "j1", "Judge one")}
	if got := fresh.Resting(); !reflect.DeepEqual(got, want) {
		t.Fatalf("Resting() = %+v, want %+v", got, want)
	}
	if got := r.manager().Resting(); !reflect.DeepEqual(got, want) {
		t.Fatalf("Resting() = %+v after another restart, want %+v", got, want)
	}
}

// a Start that cannot reach its judge is taken back, and the index is what the files say again: the judge woken for a new
// round that failed to start is still resting from the pair it rested from
func TestRestingAfterAStartThatFailed(t *testing.T) {
	t.Run("a new pair whose brief failed", func(t *testing.T) {
		r := newRig(t)
		r.link.give("w", workerPlan)
		first := r.start(wshrpc.CommandPairStartData{Launched: true})
		if err := r.m.Unpair(ctx, first.Id); err != nil {
			t.Fatal(err)
		}
		r.link.give("w", workerPlan)
		r.link.sendErr = errors.New("the judge cannot be reached")
		if _, err := r.m.Start(ctx, wshrpc.CommandPairStartData{WorkerTab: "w", JudgeTab: "j1", Launched: true}); err == nil {
			t.Fatal("Start went through")
		}
		r.link.sendErr = nil
		sameAfterReload(t, r)
		if got := r.m.Resting(); len(got) != 1 || got[0].Tab != "j1" {
			t.Fatalf("Resting() = %+v, want the judge still resting", got)
		}
	})

	t.Run("a judge added to a live pair", func(t *testing.T) {
		r := newRig(t)
		r.link.add("j2", "Judge two")
		r.link.give("w", workerPlan)
		first := r.start(wshrpc.CommandPairStartData{JudgeTab: "j2", Launched: true})
		if err := r.m.Unpair(ctx, first.Id); err != nil {
			t.Fatal(err)
		}
		r.link.give("w", workerPlan)
		live := r.start(wshrpc.CommandPairStartData{}) // j1, picked, on a new pair of the same worker
		r.link.sendErr = errors.New("the judge cannot be reached")
		if _, err := r.m.Start(ctx, wshrpc.CommandPairStartData{WorkerTab: "w", JudgeTab: "j2", Launched: true}); err == nil {
			t.Fatal("Start went through")
		}
		r.link.sendErr = nil
		if view := r.view(live.Id); len(view.Judges) != 1 {
			t.Fatalf("judges = %+v: the judge that could not be reached left the pair", view.Judges)
		}
		sameAfterReload(t, r)
		want := []wshrpc.PairResting{restingFrom(first, "j2", "Judge two")}
		if got := r.m.Resting(); !reflect.DeepEqual(got, want) {
			t.Fatalf("Resting() = %+v, want %+v: the judge rests from the pair it left", got, want)
		}
	})
}

// the working agent's going ends the pair: its launched judges rest, as the files say
func TestRestingWhenTheWorkerIsGone(t *testing.T) {
	r := newRig(t)
	v := r.paired(workerPlan)
	r.m.mu.Lock()
	r.m.pairs[v.Id].Judges[0].Launched = true
	r.m.mu.Unlock()
	delete(r.link.agents, "w")
	r.reply("j1", "> Plan v1.\nA finding.\n"+judgeBlock("new: a"))
	want := []wshrpc.PairResting{restingFrom(v, "j1", "Judge one")}
	if got := r.m.Resting(); !reflect.DeepEqual(got, want) {
		t.Fatalf("Resting() = %+v, want %+v", got, want)
	}
	sameAfterReload(t, r)
}

// closing the working agent's tab ends its live pair without a word to it, and names every judge arcterm launched for it
// (those of that pair and those resting from its ended rounds), never one the person picked; the ended pair keeps each
// side's session, so a resume of the worker finds its judges again
func TestCloseWorkerEndsItsPairAndNamesItsLaunchedJudges(t *testing.T) {
	r := newRig(t)
	r.link.add("j2", "Judge two")
	r.link.add("j3", "Judge three")
	r.link.give("w", workerPlan)
	old := r.start(wshrpc.CommandPairStartData{JudgeTab: "j2", Launched: true})
	if err := r.m.Unpair(ctx, old.Id); err != nil {
		t.Fatal(err)
	}
	r.link.give("w", workerPlan)
	live := r.start(wshrpc.CommandPairStartData{Launched: true}) // j1
	r.start(wshrpc.CommandPairStartData{JudgeTab: "j3"})         // picked from the live list
	sent := len(r.link.sent("w"))

	got := r.m.CloseWorker("w")
	slices.Sort(got)
	if want := []string{"j1", "j2"}; !slices.Equal(got, want) {
		t.Fatalf("CloseWorker = %v, want the launched judges %v", got, want)
	}
	view, err := Read(r.m.Dir, "", live.Id) // ended: it has left the index, and its file says how it ended
	if err != nil {
		t.Fatal(err)
	}
	if view.State != StateEnded {
		t.Fatalf("state %s, want the pair ended", view.State)
	}
	if last := view.Messages[len(view.Messages)-1]; last.From != FromSystem || last.Text != WorkerClosedLine {
		t.Fatalf("last message %+v, want the line %q", last, WorkerClosedLine)
	}
	if n := len(r.link.sent("w")); n != sent {
		t.Fatalf("the closing worker was sent %d message(s)", n-sent)
	}
	want := []wshrpc.PairResting{restingFrom(live, "j1", "Judge one"), restingFrom(old, "j2", "Judge two")}
	if got := r.m.Resting(); !reflect.DeepEqual(got, want) {
		t.Fatalf("Resting() = %+v, want %+v", got, want)
	}
	sameAfterReload(t, r)

	// a tab that is no worker closes nothing, and a second close of the same worker names the same judges
	if got := r.m.CloseWorker("j3"); len(got) != 0 {
		t.Fatalf("CloseWorker(a picked judge) = %v, want none", got)
	}
	if got := r.m.CloseWorker("w"); len(got) != 2 {
		t.Fatalf("CloseWorker again = %v, want the same two judges", got)
	}
}
