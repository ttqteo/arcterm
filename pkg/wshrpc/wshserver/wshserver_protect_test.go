// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// a Protect request queues even for a command memgate calls light, named for its command, and holds the heavy jobs
// behind it; once handed to its child (JobSlotHold) the slot outlives the stream until the child exits
func TestJobSlotProtectHoldsHeavyJobsUntilItsChildExits(t *testing.T) {
	q := installQueue(t, 2)
	exit := fakePids(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	ws := &WshServer{}
	protect := ws.JobSlotCommand(ctx, wshrpc.CommandJobSlotData{Command: "python   scripts/audit_guard.py", Protect: true})
	started := nextSlotUpdate(t, protect)
	requireRun(t, started)
	if started.Job == "" {
		t.Fatal("run true carried no job id for JobSlotHold")
	}
	if err := ws.JobSlotHoldCommand(ctx, wshrpc.CommandJobSlotHoldData{Job: started.Job, Pid: 5151}); err != nil {
		t.Fatal(err)
	}
	data := JobQueueData(q.Snapshot())
	if len(data.Jobs) != 1 || !data.Jobs[0].Protected || data.Jobs[0].Name != "python scripts/audit_guard.py" {
		t.Fatalf("jobs = %+v, want the one Protected job named for its command", data.Jobs)
	}
	cancel() // wsh protect went away; its child still runs

	heavy := openJobSlot(context.Background(), "task check:ts")
	if got := nextSlotUpdate(t, heavy); got.Queued != 1 {
		t.Fatalf("heavy's first line = %+v, want queued", got)
	}
	waiting := JobQueueData(q.Snapshot()).Jobs
	if len(waiting) != 2 || waiting[1].Reason != "protected: python scripts/audit_guard.py is running" {
		t.Fatalf("jobs = %+v, want the heavy job waiting on the Protect job", waiting)
	}
	exit(5151)
	requireRun(t, nextSlotUpdate(t, heavy))
}

func TestJobSlotHoldRefusesAJobThatIsNotARunningProtect(t *testing.T) {
	installQueue(t, 1)
	ws := &WshServer{}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	ch := openJobSlot(ctx, "task check:ts")
	requireRun(t, nextSlotUpdate(t, ch))
	for _, d := range []wshrpc.CommandJobSlotHoldData{{Job: "j1", Pid: 1}, {Job: "nope", Pid: 1}, {Job: "j1"}} {
		if err := ws.JobSlotHoldCommand(ctx, d); err == nil {
			t.Fatalf("JobSlotHold(%+v) accepted", d)
		}
	}
}

func TestProtectName(t *testing.T) {
	if got := protectName("python\tx.py  --n 3"); got != "python x.py --n 3" {
		t.Fatalf("got %q", got)
	}
	long := protectName(strings.Repeat("a", 100))
	if r := []rune(long); len(r) != protectNameMax || !strings.HasSuffix(long, "…") {
		t.Fatalf("got %q (%d runes)", long, len(r))
	}
}
