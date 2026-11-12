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
	"sync"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/memgate"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// no test reads the learned file of whoever runs it: a test that wants one points the path at its own
func init() {
	jobslotLearnedPath = func() string { return "" }
}

// learnedAt makes wsh read the learned file at path for the rest of the test, and read it afresh
func learnedAt(t *testing.T, path string) {
	t.Helper()
	savedPath := jobslotLearnedPath
	jobslotLearnedPath = func() string { return path }
	jobslotLearnedOnce = sync.Once{}
	t.Cleanup(func() {
		jobslotLearnedPath = savedPath
		jobslotLearnedOnce = sync.Once{}
	})
}

// learnedWith writes a learned file holding patterns and points wsh at it
func learnedWith(t *testing.T, patterns ...string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), ".arc", "jobslot-learned.json")
	if err := memgate.WriteLearned(path, patterns); err != nil {
		t.Fatal(err)
	}
	learnedAt(t, path)
}

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

// a pattern wavesrv learned from a measured run takes a slot, in any command that holds it as a step
func TestJobslotLearnedPatternTakesASlot(t *testing.T) {
	learnedWith(t, "make build", "gradle build")
	cases := map[string]bool{
		"make build":                              true,
		"cd web && make build 2>&1 | tail -5":     true,
		"bash -c 'make build'":                    true,
		"env FOO=1 nice -n 5 gradle build --info": true,
		"make build && make test":                 true,
		"make test":                               false,
		"make":                                    false,
		"ls -la":                                  false,
		"echo make build":                         false,
		// the table keeps its verdicts, learned or not
		"task check:ts":              true,
		"task dev":                   false, // a dev server never queues
		"go test ./pkg/x -run X":     false,
		"npx vitest run foo.test.ts": false,
	}
	for command, want := range cases {
		if got := jobslotTakesSlot(command); got != want {
			t.Errorf("jobslotTakesSlot(%q) = %v, want %v", command, got, want)
		}
	}
}

// a missing file, a broken one and no home directory all read as nothing learned: an unknown command runs without a
// slot, as it did before the file existed
func TestJobslotLearnedMissingOrBrokenFileLeavesAnUnknownCommandLight(t *testing.T) {
	dir := t.TempDir()
	broken := filepath.Join(dir, "broken.json")
	if err := os.WriteFile(broken, []byte("{not json"), 0o644); err != nil {
		t.Fatal(err)
	}
	wrongShape := filepath.Join(dir, "wrong.json")
	if err := os.WriteFile(wrongShape, []byte(`{"patterns": "make build"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	cases := map[string]string{
		"missing":     filepath.Join(dir, "nope", "jobslot-learned.json"),
		"broken":      broken,
		"wrong shape": wrongShape,
		"no home":     "",
		"a directory": dir,
	}
	for name, path := range cases {
		t.Run(name, func(t *testing.T) {
			learnedAt(t, path)
			if jobslotTakesSlot("make build") {
				t.Fatal("an unknown command took a slot with nothing learned")
			}
			// the table is unaffected by the file
			if !jobslotTakesSlot("task check:ts") {
				t.Fatal("a command in the table lost its slot")
			}
		})
	}
}

// the file is read once per wsh run: a change to it after the first read is the next run's
func TestJobslotLearnedIsReadOncePerRun(t *testing.T) {
	path := filepath.Join(t.TempDir(), "jobslot-learned.json")
	if err := memgate.WriteLearned(path, []string{"make build"}); err != nil {
		t.Fatal(err)
	}
	learnedAt(t, path)
	if !jobslotTakesSlot("make build") {
		t.Fatal("a learned pattern did not take a slot")
	}
	if err := memgate.WriteLearned(path, nil); err != nil {
		t.Fatal(err)
	}
	if !jobslotTakesSlot("make build") {
		t.Fatal("the file was read again within one run")
	}
	learnedAt(t, path) // the next run
	if jobslotTakesSlot("make build") {
		t.Fatal("a pattern that left the file still takes a slot")
	}
}

// --heavy answers from the same classification: exit 0 for a command that takes a slot, 1 for one that does not
func TestJobslotLearnedHeavyFlag(t *testing.T) {
	learnedWith(t, "make build")
	savedHeavy, savedExit := jobslotHeavy, WshExitCode
	defer func() { jobslotHeavy, WshExitCode = savedHeavy, savedExit }()
	jobslotHeavy = true
	for command, wantExit := range map[string]int{"cd web && make build": 0, "make test": 1, "task check:ts": 0, "ls": 1} {
		WshExitCode = 0
		if err := jobslotRun(jobslotCmd, []string{command}); err != nil {
			t.Fatalf("jobslotRun(%q): %v", command, err)
		}
		if WshExitCode != wantExit {
			t.Errorf("--heavy %q exits %d, want %d", command, WshExitCode, wantExit)
		}
	}
}

// the agy hook's turn connects for a learned command and, like any light one, not for the rest
func TestJobslotLearnedTurnConnectsOnlyForAHeavyCommand(t *testing.T) {
	learnedWith(t, "make build")
	saved := RpcClient
	RpcClient = nil
	defer func() { RpcClient = saved }()
	t.Setenv("WAVETERM_JWT", "") // a light command must not even try to connect
	if run, reason, err := jobslotTurn(context.Background(), "make test"); err != nil || !run || reason != "" {
		t.Fatalf("an unlearned command: run %v reason %q err %v", run, reason, err)
	}
	// a learned one goes for the queue: with its context already done it stops there, which a light command never does
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, _, err := jobslotTurn(ctx, "cd web && make build"); !errors.Is(err, context.Canceled) {
		t.Fatalf("a learned command: err = %v, want context.Canceled (it was sent to the queue)", err)
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
