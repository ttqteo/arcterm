// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/jobqueue"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

const testGB = uint64(1) << 30

// installQueue swaps in a queue with the given slots and plenty of RAM, restoring the default when the test ends.
func installQueue(t *testing.T, slots int) *jobqueue.Queue {
	t.Helper()
	saved := jobqueue.Default
	q := jobqueue.New(jobqueue.Config{
		Slots:     func() int { return slots },
		Available: func(context.Context) (uint64, error) { return 64 * testGB, nil },
	})
	jobqueue.Default = q
	t.Cleanup(func() { jobqueue.Default = saved })
	return q
}

func openJobSlot(ctx context.Context, command string) chan wshrpc.RespOrErrorUnion[wshrpc.JobSlotUpdate] {
	return (&WshServer{}).JobSlotCommand(ctx, wshrpc.CommandJobSlotData{Command: command})
}

func nextSlotUpdate(t *testing.T, ch chan wshrpc.RespOrErrorUnion[wshrpc.JobSlotUpdate]) wshrpc.JobSlotUpdate {
	t.Helper()
	select {
	case msg, open := <-ch:
		if !open {
			t.Fatal("the stream closed before the next update")
		}
		if msg.Error != nil {
			t.Fatalf("stream error: %v", msg.Error)
		}
		return msg.Response
	case <-time.After(2 * time.Second):
		t.Fatal("no update within 2s")
	}
	return wshrpc.JobSlotUpdate{}
}

func requireRun(t *testing.T, u wshrpc.JobSlotUpdate) {
	t.Helper()
	if u.Run == nil || !*u.Run || u.Reason != "" {
		t.Fatalf("update = %+v, want run true", u)
	}
}

func requireStreamClosed(t *testing.T, ch chan wshrpc.RespOrErrorUnion[wshrpc.JobSlotUpdate]) {
	t.Helper()
	select {
	case msg, open := <-ch:
		if open {
			t.Fatalf("a further update %+v", msg)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("the stream stayed open")
	}
}

func TestJobSlotRunsALightCommandAtOnce(t *testing.T) {
	installQueue(t, 1)
	ch := openJobSlot(context.Background(), "echo hi")
	requireRun(t, nextSlotUpdate(t, ch))
	requireStreamClosed(t, ch)
}

func TestJobSlotNeverQueuesALongRunningCommand(t *testing.T) {
	q := installQueue(t, 1)
	ch := openJobSlot(context.Background(), "task dev")
	requireRun(t, nextSlotUpdate(t, ch))
	requireStreamClosed(t, ch)
	if n := len(q.Snapshot().Jobs); n != 0 {
		t.Fatalf("%d jobs queued for a dev server", n)
	}
}

func TestJobSlotQueuesBehindTheHolderAndStartsWhenItLeaves(t *testing.T) {
	q := installQueue(t, 1)
	ctx1, cancel1 := context.WithCancel(context.Background())
	defer cancel1()
	first := openJobSlot(ctx1, "task check:ts")
	requireRun(t, nextSlotUpdate(t, first))

	second := openJobSlot(context.Background(), "task check:ts")
	got := nextSlotUpdate(t, second)
	if got.Queued != 1 || got.Behind != "task check:ts" || got.For != "" || got.Run != nil {
		t.Fatalf("queued line = %+v, want position 1 behind task check:ts with no for", got)
	}
	if n := len(q.Snapshot().Jobs); n != 2 {
		t.Fatalf("%d jobs, want the holder and the waiter", n)
	}

	cancel1()
	requireRun(t, nextSlotUpdate(t, second))
}

func TestJobSlotNamesTheRunWhenAnEngineStepHoldsTheSlot(t *testing.T) {
	q := installQueue(t, 1)
	step, err := q.Acquire(context.Background(), jobqueue.Request{
		Name: "scripts/verify.mjs", Bytes: testGB, Engine: true,
		Source: jobqueue.Source{RunId: "700db4a1-xx", Label: "Verify"},
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer step.Release()
	ch := openJobSlot(context.Background(), "task check:ts")
	got := nextSlotUpdate(t, ch)
	if got.Queued != 1 || got.Behind != "scripts/verify.mjs" || got.For != "run 700db4" {
		t.Fatalf("queued line = %+v", got)
	}
}

func TestJobSlotSkippedStreamRefusesTheCommand(t *testing.T) {
	q := installQueue(t, 1)
	held, err := q.Acquire(context.Background(), jobqueue.Request{Name: "scripts/verify.mjs", Bytes: testGB, Engine: true}, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer held.Release()
	ch := openJobSlot(context.Background(), "task check:ts")
	nextSlotUpdate(t, ch) // queued
	var id string
	for _, j := range q.Snapshot().Jobs {
		if !j.Running {
			id = j.Id
		}
	}
	if err := (&WshServer{}).JobQueueSkipCommand(context.Background(), wshrpc.CommandJobQueueActData{Id: id}); err != nil {
		t.Fatal(err)
	}
	got := nextSlotUpdate(t, ch)
	if got.Run == nil || *got.Run || !strings.Contains(got.Reason, "Do not retry") {
		t.Fatalf("update = %+v, want run false with a do-not-retry reason", got)
	}
	requireStreamClosed(t, ch)
}

func TestJobQueueActionsNameAnUnknownId(t *testing.T) {
	installQueue(t, 1)
	ws := &WshServer{}
	data := wshrpc.CommandJobQueueActData{Id: "j99"}
	if err := ws.JobQueueSkipCommand(context.Background(), data); err == nil || !strings.Contains(err.Error(), "j99") {
		t.Fatalf("skip err = %v", err)
	}
	if err := ws.JobQueueRunNowCommand(context.Background(), data); err == nil || !strings.Contains(err.Error(), "j99") {
		t.Fatalf("run now err = %v", err)
	}
}

func TestJobQueueRunNowStartsAQueuedJobPastTheSlot(t *testing.T) {
	q := installQueue(t, 1)
	held, err := q.Acquire(context.Background(), jobqueue.Request{Name: "scripts/verify.mjs", Bytes: testGB, Engine: true}, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer held.Release()
	ch := openJobSlot(context.Background(), "task check:ts")
	nextSlotUpdate(t, ch) // queued
	var id string
	for _, j := range q.Snapshot().Jobs {
		if !j.Running {
			id = j.Id
		}
	}
	if err := (&WshServer{}).JobQueueRunNowCommand(context.Background(), wshrpc.CommandJobQueueActData{Id: id}); err != nil {
		t.Fatal(err)
	}
	requireRun(t, nextSlotUpdate(t, ch))
}

func TestGetJobQueueListsJobsWithUnixMillisecondTimes(t *testing.T) {
	q := installQueue(t, 1)
	empty, err := (&WshServer{}).GetJobQueueCommand(context.Background())
	if err != nil || empty.Slots != 1 || empty.Mode != jobqueue.ModeSlots || empty.Jobs == nil || len(empty.Jobs) != 0 {
		t.Fatalf("empty queue = %+v, %v; want slots 1, mode slots and a non-nil empty list", empty, err)
	}
	before := time.Now().UnixMilli()
	held, err := q.Acquire(context.Background(), jobqueue.Request{
		Name: "scripts/verify.mjs", Bytes: testGB, Engine: true,
		Source: jobqueue.Source{RunId: "700db4a1-xx", Label: "Verify · Task 3"},
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer held.Release()
	ch := openJobSlot(context.Background(), "task check:ts")
	nextSlotUpdate(t, ch) // queued
	data, err := (&WshServer{}).GetJobQueueCommand(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(data.Jobs) != 2 {
		t.Fatalf("jobs = %+v", data.Jobs)
	}
	running, queued := data.Jobs[0], data.Jobs[1]
	if !running.Running || !running.Engine || running.RunId != "700db4a1-xx" || running.Label != "Verify · Task 3" ||
		running.StartedTs < before || running.QueuedTs < before {
		t.Fatalf("running job = %+v", running)
	}
	if queued.Running || queued.Position != 1 || queued.Reason != "slot busy" || queued.Name != "task check:ts" ||
		queued.QueuedTs < before || queued.StartedTs != 0 {
		t.Fatalf("queued job = %+v", queued)
	}
}

func TestGetJobQueueCarriesTheMode(t *testing.T) {
	saved := jobqueue.Default
	t.Cleanup(func() { jobqueue.Default = saved })
	jobqueue.Default = nil
	none, err := (&WshServer{}).GetJobQueueCommand(context.Background())
	if err != nil || none.Mode != jobqueue.ModeAuto {
		t.Fatalf("no queue = %+v, %v; want the setting's default, auto", none, err)
	}
	jobqueue.Default = jobqueue.New(jobqueue.Config{Mode: func() string { return jobqueue.ModeOff }})
	off, err := (&WshServer{}).GetJobQueueCommand(context.Background())
	if err != nil || off.Mode != jobqueue.ModeOff {
		t.Fatalf("queue = %+v, %v; want mode off", off, err)
	}
}

func TestGetJobQueueCarriesThePause(t *testing.T) {
	saved := jobqueue.Default
	t.Cleanup(func() { jobqueue.Default = saved })
	until := time.Now().Add(time.Hour).Truncate(time.Millisecond)
	jobqueue.Default = jobqueue.New(jobqueue.Config{PausedUntil: func() time.Time { return until }})
	data, err := (&WshServer{}).GetJobQueueCommand(context.Background())
	if err != nil || data.PausedUntil != until.UnixMilli() {
		t.Fatalf("queue = %+v, %v; want paused until %d", data, err, until.UnixMilli())
	}
}

// the wire framing of one stream response: the update sits in Data of a message answering ResId
type streamReader struct {
	t       *testing.T
	updates map[string]chan wshrpc.JobSlotUpdate
}

func newStreamReader(t *testing.T, w *wshutil.WshRpc, reqIds ...string) *streamReader {
	r := &streamReader{t: t, updates: map[string]chan wshrpc.JobSlotUpdate{}}
	for _, id := range reqIds {
		r.updates[id] = make(chan wshrpc.JobSlotUpdate, 16)
	}
	go func() {
		for raw := range w.OutputCh {
			var msg wshutil.RpcMessage
			if json.Unmarshal(raw, &msg) != nil || msg.Data == nil {
				continue
			}
			ch := r.updates[msg.ResId]
			if ch == nil {
				continue
			}
			var u wshrpc.JobSlotUpdate
			if b, err := json.Marshal(msg.Data); err == nil && json.Unmarshal(b, &u) == nil {
				ch <- u
			}
		}
	}()
	return r
}

func (r *streamReader) next(reqId string) wshrpc.JobSlotUpdate {
	r.t.Helper()
	select {
	case u := <-r.updates[reqId]:
		return u
	case <-time.After(time.Second):
		r.t.Fatalf("no update for %s within 1s", reqId)
	}
	return wshrpc.JobSlotUpdate{}
}

func TestJobSlotFreedWhenItsLinkCloses(t *testing.T) {
	q := installQueue(t, 1)
	w := wshutil.MakeWshRpc(wshrpc.RpcContext{}, &WshServer{}, "jobqueue-test")
	reader := newStreamReader(t, w, "r1", "r2")
	send := func(reqId string, link baseds.LinkId) {
		b, err := json.Marshal(wshutil.RpcMessage{
			Command: "jobslot", ReqId: reqId, Timeout: 60000,
			Data: wshrpc.CommandJobSlotData{Command: "task check:ts"},
		})
		if err != nil {
			t.Fatal(err)
		}
		if !w.SendRpcMessage(b, link, "test") {
			t.Fatal("the rpc refused the request")
		}
	}

	send("r1", baseds.LinkId(7))
	requireRun(t, reader.next("r1"))
	send("r2", baseds.LinkId(8))
	if got := reader.next("r2"); got.Queued != 1 || got.Run != nil {
		t.Fatalf("r2's first line = %+v, want queued 1", got)
	}

	// what wavesrv does when a domain-socket link closes
	w.CancelRequestsForLink(baseds.LinkId(7))
	requireRun(t, reader.next("r2"))
	jobs := q.Snapshot().Jobs
	if len(jobs) != 1 || !jobs[0].Running {
		t.Fatalf("jobs after the link closed = %+v, want r2 running alone", jobs)
	}

	w.CancelRequestsForLink(baseds.LinkId(8))
	deadline := time.Now().Add(time.Second)
	for len(q.Snapshot().Jobs) != 0 {
		if time.Now().After(deadline) {
			t.Fatal("r2's slot outlived its link")
		}
		time.Sleep(5 * time.Millisecond)
	}
}
