//go:build windows

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/util/jobobject"
)

func ownerLive(o jobobject.Owner) bool {
	for _, j := range jobobject.LiveJobs() {
		if j.Owner == o && len(j.Members) > 0 {
			return true
		}
	}
	return false
}

func TestPlanCommandRegistersRunOwner(t *testing.T) {
	want := jobobject.Owner{Kind: jobobject.OwnerKind_RunCmd, Id: "run-1", Cmd: PlanCmd_Verify, Task: "3"}
	ctx := withRunCmdOwner(context.Background(), want.Id, want.Cmd, want.Task)
	done := make(chan error, 1)
	go func() {
		_, err := execPlanCommandEnv(ctx, t.TempDir(), "sleep 2", nil, time.Minute, nil)
		done <- err
	}()

	seen := false
	for !seen {
		select {
		case err := <-done:
			t.Fatalf("the command returned (err %v) before its owner was ever live", err)
		case <-time.After(50 * time.Millisecond):
			seen = ownerLive(want)
		}
	}
	if err := <-done; err != nil {
		t.Fatalf("the command failed: %v", err)
	}
	if ownerLive(want) {
		t.Fatalf("owner %+v is still registered after the command returned", want)
	}
}

// a detached tree's Setup must not show as the command the tree is for: a bisect tree's Setup is not its Verify
func TestDetachedTreeSetupKeepsOwnerAsSetup(t *testing.T) {
	var got jobobject.Owner
	var ok bool
	orig := runPlanCommand
	runPlanCommand = func(ctx context.Context, dir, command string, env []string, _ time.Duration, progress planProgress) (string, error) {
		got, ok = jobobject.OwnerFrom(ctx)
		return "", nil
	}
	t.Cleanup(func() { runPlanCommand = orig })

	dir := newGitRepo(t)
	base := gitCmd(t, dir, "rev-parse", "HEAD")
	ctx := withRunCmdOwner(context.Background(), "run-1", PlanCmd_Verify, "3")
	if err := withDetachedTree(ctx, dir, "bisect", "bisect tree", base, "setup", func(string) error { return nil }); err != nil {
		t.Fatal(err)
	}
	want := jobobject.Owner{Kind: jobobject.OwnerKind_RunCmd, Id: "run-1", Cmd: PlanCmd_Setup, Task: "3"}
	if !ok || got != want {
		t.Fatalf("Setup ran with owner %+v (present %v), want %+v", got, ok, want)
	}
}
