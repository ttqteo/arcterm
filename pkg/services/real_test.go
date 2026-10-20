// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build darwin

package services

import (
	"context"
	"fmt"
	"net"
	"os"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/arctools"
	"github.com/wavetermdev/waveterm/pkg/blockcontroller"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func waitFor(t *testing.T, what string, within time.Duration, ok func() bool) {
	t.Helper()
	deadline := time.Now().Add(within)
	for !ok() {
		if time.Now().After(deadline) {
			t.Fatalf("%s: not within %v", what, within)
		}
		time.Sleep(50 * time.Millisecond)
	}
}

func refused(port int) bool {
	c, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", port), 300*time.Millisecond)
	if err != nil {
		return true
	}
	c.Close()
	return false
}

// A service's listener is the PTY's grandchild, as npm's node is: Stop must free the port, showing the log in a pane
// (an unforced resync) must not start it again, and Start must come back on the same port.
func TestRealServiceStopsWithItsChild(t *testing.T) {
	self, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	state := &memState{m: map[string]Remembered{}}
	deps := realDeps(state)
	var published []wshrpc.ServicesData
	deps.Publish = func(d wshrpc.ServicesData) { published = append(published, d) }
	sup := New(deps)
	old := blockcontroller.ServiceExitHook
	blockcontroller.ServiceExitHook = func(blockId string, exitCode int) { sup.OnExit(blockId, exitCode, false) }
	t.Cleanup(func() { blockcontroller.ServiceExitHook = old })

	tool := arctools.Tool{
		Id: "svc-real", Name: "svc-real", Command: "sh", Port: arctools.PortAuto, Autostart: false,
		// the trap makes the listener ignore the hangup that closing the pty sends, as a server that outlives its
		// parent does: only the sweep of the block's leftovers ends it
		Args: fmt.Sprintf(`-c 'trap "" HUP; ARC_TEST_SERVE=1 "%s" & wait'`, self),
	}
	sup.SetTools(ctx, []arctools.Tool{tool}, nil, os.Getenv("HOME"))
	sup.Boot(ctx)
	t.Cleanup(func() { _ = sup.Stop(ctx, "svc-real") })

	status := func() wshrpc.ServiceStatus { return sup.Status()[0] }
	if err := sup.Start(ctx, "svc-real"); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "running", 15*time.Second, func() bool { return status().State == StateRunning })
	port := status().Port
	if port == 0 || refused(port) {
		t.Fatalf("running on port %d but nothing answers", port)
	}
	st := status()

	if err := sup.Stop(ctx, "svc-real"); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "the port refusing after Stop", 3*time.Second, func() bool { return refused(port) })

	// a pane mounting the log resyncs without force: the service that was stopped stays asleep
	rtopts := &waveobj.RuntimeOpts{TermSize: waveobj.TermSize{Rows: 30, Cols: 120}}
	if err := blockcontroller.ResyncController(ctx, st.TabId, st.BlockId, rtopts, false); err != nil {
		t.Fatal(err)
	}
	time.Sleep(2 * time.Second)
	if !refused(port) {
		t.Fatal("an unforced resync started the sleeping service")
	}
	if got := status().State; got != StateSleeping {
		t.Fatalf("state after Stop = %q", got)
	}

	if err := sup.Start(ctx, "svc-real"); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "running again", 15*time.Second, func() bool { return status().State == StateRunning })
	if status().Port != port {
		t.Errorf("port after Start = %d, want the remembered %d", status().Port, port)
	}
	if len(published) == 0 {
		t.Error("nothing was published")
	}
}

// The tree a service's idle timer reads is the block controller's process tree, with each process's start time: a
// server that starts work after its page answers (a chat's claude -p, a script run) reads as busy.
func TestRealProcsSeesWorkInProgress(t *testing.T) {
	self, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	deps := realDeps(&memState{m: map[string]Remembered{}})
	deps.Publish = func(wshrpc.ServicesData) {}
	sup := New(deps)
	old := blockcontroller.ServiceExitHook
	blockcontroller.ServiceExitHook = func(blockId string, exitCode int) { sup.OnExit(blockId, exitCode, false) }
	t.Cleanup(func() { blockcontroller.ServiceExitHook = old })

	tool := arctools.Tool{
		Id: "svc-procs", Name: "svc-procs", Command: "sh", Port: arctools.PortAuto, Autostart: false,
		// the server stays up while the loop keeps starting short children, as a dashboard does for each run
		Args: fmt.Sprintf(`-c 'trap "" HUP; ARC_TEST_SERVE=1 "%s" & while :; do sleep 1; done'`, self),
	}
	sup.SetTools(ctx, []arctools.Tool{tool}, nil, os.Getenv("HOME"))
	sup.Boot(ctx)
	t.Cleanup(func() { _ = sup.Stop(ctx, "svc-procs") })

	status := func() wshrpc.ServiceStatus { return sup.Status()[0] }
	if err := sup.Start(ctx, "svc-procs"); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "running", 15*time.Second, func() bool { return status().State == StateRunning })

	got := procs(status().BlockId)
	if len(got) == 0 {
		t.Fatal("procs of a running service is empty")
	}
	for _, p := range got {
		if p.StartMs <= 0 {
			t.Errorf("process %d has StartMs %d", p.Pid, p.StartMs)
		}
	}
	waitFor(t, "work in progress", 5*time.Second, func() bool {
		return Busy(procs(status().BlockId), status().StartedMs, time.Now().UnixMilli())
	})
}
