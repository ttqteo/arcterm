// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

func TestCreateProjectCommandRejectsMissingPath(t *testing.T) {
	ws := &WshServer{}
	err := ws.CreateProjectCommand(context.Background(), wshrpc.CommandCreateProjectData{
		Name: "x", Path: "/no/such/dir/definitely-missing",
	})
	if err == nil {
		t.Fatal("expected error for a non-existent path")
	}
}

func TestCreateProjectCommandRejectsEmptyName(t *testing.T) {
	ws := &WshServer{}
	err := ws.CreateProjectCommand(context.Background(), wshrpc.CommandCreateProjectData{
		Name: "  ", Path: t.TempDir(),
	})
	if err == nil {
		t.Fatal("expected error for an empty name")
	}
}

func TestCreateProjectCommandWritesValid(t *testing.T) {
	withConfigHome(t, t.TempDir())
	ws := &WshServer{}
	dir := t.TempDir()
	if err := ws.CreateProjectCommand(context.Background(), wshrpc.CommandCreateProjectData{
		Name: "proj", Path: dir,
	}); err != nil {
		t.Fatalf("expected success, got %v", err)
	}
	// the channel exists when the command returns, so the caller's channel refresh finds the new project
	ch, err := wstore.ChannelAtPath(context.Background(), dir)
	if err != nil || ch == nil {
		t.Fatalf("no channel for the registered project (err %v)", err)
	}
}

// A second project at a path already registered is what made the channel named "waveterm" file under the
// group header RW-TEST-CHECKPOINT: the frontend resolves a channel's project by path, and two names at one
// path leave it picking an arbitrary winner. Refuse the registration instead.
func TestCreateProjectCommandRejectsADuplicatePath(t *testing.T) {
	withConfigHome(t, t.TempDir())
	ws := &WshServer{}
	dir := t.TempDir()
	if err := ws.CreateProjectCommand(context.Background(), wshrpc.CommandCreateProjectData{Name: "waveterm", Path: dir}); err != nil {
		t.Fatalf("first registration: %v", err)
	}

	err := ws.CreateProjectCommand(context.Background(), wshrpc.CommandCreateProjectData{Name: "rw-test-checkpoint", Path: dir})
	if err == nil {
		t.Fatal("expected a second project at the same path to be refused")
	}
	// the message has to name the project holding the path — otherwise the user cannot tell what to delete.
	if !strings.Contains(err.Error(), "waveterm") {
		t.Fatalf("error must name the project already there, got %q", err)
	}
}

// re-registering the same project at its own path is an update, not a collision: the launcher persists a
// live-derived project on first launch and must not start failing once it is registered.
func TestCreateProjectCommandAllowsReregisteringItself(t *testing.T) {
	withConfigHome(t, t.TempDir())
	ws := &WshServer{}
	dir := t.TempDir()
	for i := 0; i < 2; i++ {
		if err := ws.CreateProjectCommand(context.Background(), wshrpc.CommandCreateProjectData{Name: "proj", Path: dir}); err != nil {
			t.Fatalf("registration %d: %v", i+1, err)
		}
	}
}

func TestDeleteProjectCommandRejectsEmptyName(t *testing.T) {
	ws := &WshServer{}
	err := ws.DeleteProjectCommand(context.Background(), wshrpc.CommandDeleteProjectData{Name: "  "})
	if err == nil {
		t.Fatal("expected error for an empty name")
	}
}
