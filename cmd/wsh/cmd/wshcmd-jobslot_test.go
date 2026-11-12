// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func TestRpcWithContextGivesUpWhenTheContextEnds(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	release := make(chan struct{})
	defer close(release)
	_, err := rpcWithContext(ctx, func() (int, error) {
		<-release
		return 1, nil
	})
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("err = %v", err)
	}
	if v, err := rpcWithContext(context.Background(), func() (int, error) { return 7, nil }); v != 7 || err != nil {
		t.Fatalf("%d %v", v, err)
	}
}

func TestJobslotTurnLightCommandRunsWithoutRpc(t *testing.T) {
	saved := RpcClient
	RpcClient = nil
	defer func() { RpcClient = saved }()
	t.Setenv("WAVETERM_JWT", "") // a light command must not even try to connect
	run, reason, err := jobslotTurn(context.Background(), "ls -la")
	if err != nil || !run || reason != "" {
		t.Fatalf("run %v reason %q err %v", run, reason, err)
	}
}

func TestJobslotTurnReturnsPromptlyOnADoneContext(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	start := time.Now()
	_, _, err := jobslotTurn(ctx, "cargo build --release")
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v, want context.Canceled", err)
	}
	if time.Since(start) > time.Second {
		t.Fatalf("took %s", time.Since(start))
	}
}

// the hooks read these lines: a queued place has no run key, a refusal carries run false
func TestJobslotLinesAreWhatTheHooksRead(t *testing.T) {
	no := false
	yes := true
	cases := []struct {
		update wshrpc.JobSlotUpdate
		line   string
	}{
		{wshrpc.JobSlotUpdate{Queued: 2, Behind: "task check:ts", For: "run 700db4"}, `{"queued":2,"behind":"task check:ts","for":"run 700db4"}`},
		{wshrpc.JobSlotUpdate{Run: &yes}, `{"run":true}`},
		{wshrpc.JobSlotUpdate{Run: &no, Reason: "Not run: skipped"}, `{"run":false,"reason":"Not run: skipped"}`},
	}
	for _, c := range cases {
		var buf bytes.Buffer
		if err := json.NewEncoder(&buf).Encode(c.update); err != nil {
			t.Fatal(err)
		}
		if got := buf.String(); got != c.line+"\n" {
			t.Fatalf("line = %q, want %q", got, c.line)
		}
	}
}

func TestJobslotTakesSlotMatchesTheServer(t *testing.T) {
	cases := map[string]bool{
		"task check:ts":                 true,
		"cd frontend && npx vitest run": true,
		"ls -la":                        false,
		"task dev":                      false, // a dev server runs on for good and never queues
		"wsh agents wait e9f6af44":      false,
	}
	for command, want := range cases {
		if got := jobslotTakesSlot(command); got != want {
			t.Errorf("jobslotTakesSlot(%q) = %v, want %v", command, got, want)
		}
	}
}

func jobslotStream(updates ...wshrpc.RespOrErrorUnion[wshrpc.JobSlotUpdate]) chan wshrpc.RespOrErrorUnion[wshrpc.JobSlotUpdate] {
	ch := make(chan wshrpc.RespOrErrorUnion[wshrpc.JobSlotUpdate], len(updates))
	for _, u := range updates {
		ch <- u
	}
	close(ch)
	return ch
}

func connected() error { return nil }

func streamOf(ch chan jobslotMsg) func(time.Time) chan jobslotMsg {
	return func(time.Time) chan jobslotMsg { return ch }
}

// a stuck wavesrv must never hold an agent's command: silence past the deadline, a connect that hangs past its own
// bound or fails, and a stream that ends with no word all give nil, which runs the command without a slot
func TestJobslotOpenGivesUpOnASilentQueue(t *testing.T) {
	silent := make(chan jobslotMsg)
	start := time.Now()
	if msgs, _ := jobslotOpen(connected, streamOf(silent), time.Second, 30*time.Millisecond); msgs != nil {
		t.Fatal("a silent queue gave a stream")
	}
	if time.Since(start) > time.Second {
		t.Fatalf("took %s", time.Since(start))
	}
	hung := make(chan struct{})
	defer close(hung)
	if msgs, _ := jobslotOpen(func() error { <-hung; return nil }, streamOf(jobslotStream()), 30*time.Millisecond, time.Second); msgs != nil {
		t.Fatal("a hung connect gave a stream")
	}
	if msgs, _ := jobslotOpen(func() error { return errors.New("no socket") }, streamOf(jobslotStream()), time.Second, time.Second); msgs != nil {
		t.Fatal("a failed connect gave a stream")
	}
	if msgs, _ := jobslotOpen(connected, streamOf(jobslotStream()), time.Second, time.Second); msgs != nil {
		t.Fatal("an empty stream gave a stream")
	}
}

// under swap the connect alone can take longer than the first-word deadline: that wait must not use it up, and
// the request names when the caller gives up, a deadline counted from the connect
func TestJobslotOpenStartsTheDeadlineOnceConnected(t *testing.T) {
	yes := true
	var connectedAt, giveUp time.Time
	msgs, _ := jobslotOpen(func() error {
		time.Sleep(80 * time.Millisecond)
		connectedAt = time.Now()
		return nil
	}, func(g time.Time) chan jobslotMsg {
		giveUp = g
		time.Sleep(30 * time.Millisecond)
		return jobslotStream(jobslotMsg{Response: wshrpc.JobSlotUpdate{Run: &yes}})
	}, time.Second, 50*time.Millisecond)
	if msgs == nil {
		t.Fatal("a slow connect used up the first-word deadline")
	}
	if d := giveUp.Sub(connectedAt); d < 40*time.Millisecond || d > 200*time.Millisecond {
		t.Fatalf("gives up %s after the connect, want the 50ms deadline", d)
	}
}

func TestJobslotOpenReplaysTheFirstWordThenTheRest(t *testing.T) {
	yes := true
	msgs, _ := jobslotOpen(connected, streamOf(jobslotStream(
		jobslotMsg{Response: wshrpc.JobSlotUpdate{Queued: 1}},
		jobslotMsg{Response: wshrpc.JobSlotUpdate{Run: &yes}},
	)), time.Second, time.Second)
	if msgs == nil {
		t.Fatal("no stream")
	}
	var got []wshrpc.JobSlotUpdate
	for m := range msgs {
		got = append(got, m.Response)
	}
	if len(got) != 2 || got[0].Queued != 1 || got[1].Run == nil || !*got[1].Run {
		t.Fatalf("got %+v", got)
	}
}

func TestJobslotHandRunsAfterItsTurnAndSaysWhereItWaited(t *testing.T) {
	yes := true
	var out bytes.Buffer
	code := jobslotHand(jobslotStream(
		wshrpc.RespOrErrorUnion[wshrpc.JobSlotUpdate]{Response: wshrpc.JobSlotUpdate{Queued: 1, Behind: "task check:ts", For: "run 700db4"}},
		wshrpc.RespOrErrorUnion[wshrpc.JobSlotUpdate]{Response: wshrpc.JobSlotUpdate{Run: &yes}},
	), &out)
	if code != 0 {
		t.Fatalf("exit %d, want 0", code)
	}
	if want := "arc: queued #1 in arcterm's heavy-job queue — waiting behind task check:ts (run 700db4)\n"; out.String() != want {
		t.Fatalf("output %q, want %q", out.String(), want)
	}
}

func TestJobslotHandStopsTheShellOnlyOnARefusal(t *testing.T) {
	no := false
	var out bytes.Buffer
	code := jobslotHand(jobslotStream(
		wshrpc.RespOrErrorUnion[wshrpc.JobSlotUpdate]{Response: wshrpc.JobSlotUpdate{Run: &no, Reason: "Not run: skipped"}},
	), &out)
	if code != jobslotRefusedExit || out.String() != "Not run: skipped\n" {
		t.Fatalf("exit %d output %q, want %d and the reason", code, out.String(), jobslotRefusedExit)
	}
	// a broken queue, or a stream that ends with no verdict, lets the command run
	if code := jobslotHand(jobslotStream(wshrpc.RespOrErrorUnion[wshrpc.JobSlotUpdate]{Error: errors.New("no route")}), io.Discard); code != 0 {
		t.Fatalf("exit %d on an error, want 0", code)
	}
	if code := jobslotHand(jobslotStream(), io.Discard); code != 0 {
		t.Fatalf("exit %d on an empty stream, want 0", code)
	}
}

// wavesrv counts a request it reads late itself; one that never got through is the caller's to note
func TestJobslotOpenSaysWhetherItGotThrough(t *testing.T) {
	if _, reached := jobslotOpen(func() error { return errors.New("no socket") }, streamOf(jobslotStream()), time.Second, time.Second); reached {
		t.Fatal("a failed connect reads as reached")
	}
	hung := make(chan struct{})
	defer close(hung)
	if _, reached := jobslotOpen(func() error { <-hung; return nil }, streamOf(jobslotStream()), 30*time.Millisecond, time.Second); reached {
		t.Fatal("a hung connect reads as reached")
	}
	if msgs, reached := jobslotOpen(connected, streamOf(make(chan jobslotMsg)), time.Second, 30*time.Millisecond); msgs != nil || !reached {
		t.Fatalf("a silent queue after a connect: stream %v reached %v, want nil and true", msgs != nil, reached)
	}
}

func TestJobslotMissedAreHandedOverOnce(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "missed")
	if got := jobslotTakeMissed(dir); got != nil {
		t.Fatalf("no dir gave %+v", got)
	}
	jobslotNoteMissed(dir, wshrpc.JobSlotMissed{Name: "task check:ts", Ts: 1, BlockId: "b1"})
	jobslotNoteMissed(dir, wshrpc.JobSlotMissed{Name: "npm test", Ts: 2})
	if err := os.WriteFile(filepath.Join(dir, "half.tmp"), []byte("{"), 0o644); err != nil {
		t.Fatal(err)
	}
	got := jobslotTakeMissed(dir)
	if len(got) != 2 {
		t.Fatalf("took %+v, want both notes and not the half-written file", got)
	}
	names := map[string]bool{got[0].Name: true, got[1].Name: true}
	if !names["task check:ts"] || !names["npm test"] {
		t.Fatalf("took %+v", got)
	}
	if again := jobslotTakeMissed(dir); len(again) != 0 {
		t.Fatalf("handed over twice: %+v", again)
	}
	for i := 0; i < jobslotMissedMax+3; i++ {
		jobslotNoteMissed(dir, wshrpc.JobSlotMissed{Name: "x", Ts: int64(i)})
	}
	if n := len(jobslotTakeMissed(dir)); n != jobslotMissedMax {
		t.Fatalf("took %d, want at most %d", n, jobslotMissedMax)
	}
	if n := len(jobslotTakeMissed(dir)); n != 3 {
		t.Fatalf("the rest: %d, want 3", n)
	}
}
