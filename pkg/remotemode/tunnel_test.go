// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package remotemode

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

const (
	tunnelTestModeEnv = "REMOTEMODE_TUNNEL_HELPER"
	tunnelTestDirEnv  = "REMOTEMODE_TUNNEL_DIR"
	tunnelTestToken   = "eyJ-secret-tunnel-token"
	tunnelTestErrLine = "2026-10-27T10:00:00Z ERR failed to serve tunnel connection error=\"boom\""
	tunnelTestWait    = 5 * time.Second
	tunnelTestBeat    = 10 * time.Millisecond
	tunnelTestLife    = 30 * time.Second
	tunnelTestBackoff = 20 * time.Millisecond
)

// what a fake cloudflared run saw, written by the helper to <dir>/run-<pid>.json
type tunnelTestRun struct {
	Args  []string `json:"args"`
	Token string   `json:"token"`
	Pid   int      `json:"pid"`
}

// TestTunnelHelperProcess is not a test: it is the fake cloudflared the other tests start.
func TestTunnelHelperProcess(t *testing.T) {
	mode := os.Getenv(tunnelTestModeEnv)
	if mode == "" {
		return
	}
	dir := os.Getenv(tunnelTestDirEnv)
	run := tunnelTestRun{Args: os.Args, Token: os.Getenv(tunnelTokenEnv), Pid: os.Getpid()}
	data, _ := json.Marshal(run)
	os.WriteFile(filepath.Join(dir, fmt.Sprintf("run-%d.json", run.Pid)), data, 0o644)
	switch mode {
	case "fail":
		fmt.Fprintf(os.Stderr, "2026-10-27T10:00:00Z INF token is %s\n", run.Token)
		fmt.Fprintln(os.Stderr, "2026-10-27T10:00:00Z INF Registered tunnel connection connIndex=0")
		fmt.Fprintln(os.Stderr, tunnelTestErrLine+" token="+run.Token)
		os.Exit(1)
	case "silent":
		os.Exit(2)
	case "hang":
		fmt.Fprintln(os.Stderr, "2026-10-27T10:00:00Z INF Registered tunnel connection connIndex=0")
		beat := filepath.Join(dir, fmt.Sprintf("beat-%d", run.Pid))
		deadline := time.Now().Add(tunnelTestLife)
		for time.Now().Before(deadline) {
			f, err := os.OpenFile(beat, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
			if err == nil {
				f.WriteString(".")
				f.Close()
			}
			time.Sleep(tunnelTestBeat)
		}
		os.Exit(0)
	}
}

type tunnelTestState struct{ state, lastErr string }

type tunnelTestRecorder struct {
	mu     sync.Mutex
	states []tunnelTestState
	ch     chan tunnelTestState
}

func (r *tunnelTestRecorder) onState(state, lastErr string) {
	r.mu.Lock()
	r.states = append(r.states, tunnelTestState{state, lastErr})
	r.mu.Unlock()
	select {
	case r.ch <- tunnelTestState{state, lastErr}:
	default:
	}
}

func (r *tunnelTestRecorder) next(t *testing.T) tunnelTestState {
	t.Helper()
	select {
	case s := <-r.ch:
		return s
	case <-time.After(tunnelTestWait):
		t.Fatalf("no tunnel state within %v", tunnelTestWait)
		return tunnelTestState{}
	}
}

func (r *tunnelTestRecorder) count() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.states)
}

type tunnelTestLog struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (l *tunnelTestLog) Write(p []byte) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.buf.Write(p)
}

func (l *tunnelTestLog) String() string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.buf.String()
}

// tunnelTestSetup points the tunnel at the test binary in the given helper mode, with a short
// backoff, and captures the log.
func tunnelTestSetup(t *testing.T, mode string) (string, *tunnelTestLog) {
	t.Helper()
	dir := t.TempDir()
	t.Setenv(tunnelTestModeEnv, mode)
	t.Setenv(tunnelTestDirEnv, dir)
	origArgs, origStart, origMax, origReset := tunnelArgs, tunnelBackoffStart, tunnelBackoffMax, tunnelBackoffReset
	tunnelArgs = append([]string{"-test.run=TestTunnelHelperProcess"}, origArgs...)
	tunnelBackoffStart, tunnelBackoffMax, tunnelBackoffReset = tunnelTestBackoff, tunnelTestBackoff, time.Hour
	logs := &tunnelTestLog{}
	log.SetOutput(logs)
	t.Cleanup(func() {
		tunnelArgs, tunnelBackoffStart, tunnelBackoffMax, tunnelBackoffReset = origArgs, origStart, origMax, origReset
		log.SetOutput(os.Stderr)
	})
	return dir, logs
}

func tunnelTestRuns(t *testing.T, dir string) []tunnelTestRun {
	t.Helper()
	paths, _ := filepath.Glob(filepath.Join(dir, "run-*.json"))
	var runs []tunnelTestRun
	for _, p := range paths {
		data, err := os.ReadFile(p)
		if err != nil {
			t.Fatal(err)
		}
		var run tunnelTestRun
		if err := json.Unmarshal(data, &run); err != nil {
			t.Fatalf("%s: %v", p, err)
		}
		runs = append(runs, run)
	}
	return runs
}

func tunnelTestExpect(t *testing.T, got tunnelTestState, state string) {
	t.Helper()
	if got.state != state {
		t.Fatalf("state %q (%q), want %q", got.state, got.lastErr, state)
	}
}

func TestTunnelRestartsAfterExit(t *testing.T) {
	dir, logs := tunnelTestSetup(t, "fail")
	rec := &tunnelTestRecorder{ch: make(chan tunnelTestState, 64)}
	tun, err := StartTunnel(os.Args[0], tunnelTestToken, rec.onState)
	if err != nil {
		t.Fatal(err)
	}
	tunnelTestExpect(t, rec.next(t), TunnelStarting)
	tunnelTestExpect(t, rec.next(t), TunnelUp)
	down := rec.next(t)
	tunnelTestExpect(t, down, TunnelDown)
	if !strings.HasPrefix(down.lastErr, tunnelTestErrLine) {
		t.Errorf("down error %q, want the fake's ERR line", down.lastErr)
	}
	if strings.Contains(down.lastErr, tunnelTestToken) {
		t.Errorf("down error carries the token: %q", down.lastErr)
	}
	tunnelTestExpect(t, rec.next(t), TunnelStarting)
	tun.Stop()

	runs := tunnelTestRuns(t, dir)
	if len(runs) == 0 {
		t.Fatal("the fake cloudflared never ran")
	}
	for _, run := range runs {
		if run.Token != tunnelTestToken {
			t.Errorf("child TUNNEL_TOKEN %q, want the token", run.Token)
		}
		if strings.Contains(strings.Join(run.Args, " "), tunnelTestToken) {
			t.Errorf("token in the child's arguments: %q", run.Args)
		}
		if got := strings.Join(run.Args[len(run.Args)-3:], " "); got != "tunnel --no-autoupdate run" {
			t.Errorf("child args end %q", got)
		}
	}
	out := logs.String()
	if strings.Contains(out, tunnelTestToken) {
		t.Errorf("log carries the token:\n%s", out)
	}
	if !strings.Contains(out, "INF token is "+tunnelRedacted) {
		t.Errorf("log lacks the redacted cloudflared line:\n%s", out)
	}
}

func TestTunnelDownReportsExitStatus(t *testing.T) {
	tunnelTestSetup(t, "silent")
	rec := &tunnelTestRecorder{ch: make(chan tunnelTestState, 64)}
	tun, err := StartTunnel(os.Args[0], tunnelTestToken, rec.onState)
	if err != nil {
		t.Fatal(err)
	}
	defer tun.Stop()
	tunnelTestExpect(t, rec.next(t), TunnelStarting)
	down := rec.next(t)
	tunnelTestExpect(t, down, TunnelDown)
	if !strings.Contains(down.lastErr, "exit status 2") {
		t.Errorf("down error %q, want the exit status", down.lastErr)
	}
}

func TestTunnelStopKillsChildAndRestarts(t *testing.T) {
	dir, _ := tunnelTestSetup(t, "hang")
	rec := &tunnelTestRecorder{ch: make(chan tunnelTestState, 64)}
	tun, err := StartTunnel(os.Args[0], tunnelTestToken, rec.onState)
	if err != nil {
		t.Fatal(err)
	}
	tunnelTestExpect(t, rec.next(t), TunnelStarting)
	tunnelTestExpect(t, rec.next(t), TunnelUp)
	runs := tunnelTestRuns(t, dir)
	if len(runs) != 1 {
		t.Fatalf("%d runs, want 1", len(runs))
	}
	beat := filepath.Join(dir, fmt.Sprintf("beat-%d", runs[0].Pid))
	beatSize := func() int64 {
		fi, err := os.Stat(beat)
		if err != nil {
			return 0
		}
		return fi.Size()
	}
	// the heartbeat must be seen growing first, or a stalled helper would pass the check below
	before := beatSize()
	time.Sleep(10 * tunnelTestBeat)
	if beatSize() == before {
		t.Fatal("the fake cloudflared is not beating")
	}

	tun.Stop()
	if got := rec.next(t); got.state != TunnelOff {
		t.Fatalf("state after Stop %q, want off", got.state)
	}
	statesAtStop := rec.count()
	afterStop := beatSize()
	time.Sleep(10 * tunnelTestBackoff)
	if beatSize() != afterStop {
		t.Error("the fake cloudflared still runs after Stop")
	}
	if n := len(tunnelTestRuns(t, dir)); n != 1 {
		t.Errorf("%d runs after Stop, want no restart", n)
	}
	if rec.count() != statesAtStop {
		t.Errorf("states after Stop: %v", rec.states)
	}
	tun.Stop()
}

func TestTunnelStartFails(t *testing.T) {
	rec := &tunnelTestRecorder{ch: make(chan tunnelTestState, 64)}
	if _, err := StartTunnel(filepath.Join(t.TempDir(), "no-cloudflared.exe"), tunnelTestToken, rec.onState); err == nil {
		t.Fatal("StartTunnel with a missing binary succeeded")
	}
}

func TestTunnelBackoff(t *testing.T) {
	var got []time.Duration
	var d time.Duration
	for range 9 {
		d = tunnelNextBackoff(d, 0)
		got = append(got, d)
	}
	want := []time.Duration{1, 2, 4, 8, 16, 32, 60, 60, 60}
	for i := range want {
		if got[i] != want[i]*time.Second {
			t.Fatalf("backoff %v, want seconds %v", got, want)
		}
	}
	if d := tunnelNextBackoff(time.Minute, 4*time.Minute); d != time.Minute {
		t.Errorf("after 4 min up: %v, want the 60 s cap kept", d)
	}
	if d := tunnelNextBackoff(time.Minute, 5*time.Minute); d != time.Second {
		t.Errorf("after 5 min up: %v, want the reset to 1 s", d)
	}
}
