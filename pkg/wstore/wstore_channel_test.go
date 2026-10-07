// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wstore

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

func TestNewChannelMessageSetsFieldsAndID(t *testing.T) {
	m := NewChannelMessage("dispatch", "codex", "build the auth refactor", "tab:abc", 1717000000000)
	if m.ID == "" {
		t.Fatalf("expected a generated ID")
	}
	if m.Kind != "dispatch" || m.Author != "codex" || m.Text != "build the auth refactor" {
		t.Errorf("unexpected message: %+v", m)
	}
	if m.RefORef != "tab:abc" || m.Ts != 1717000000000 {
		t.Errorf("unexpected ref/ts: %+v", m)
	}
}

func TestUpdateRunMutatesOnlyTheMatch(t *testing.T) {
	ctx := context.Background()
	ch, err := CreateChannel(ctx, "update-run", "/p")
	if err != nil {
		t.Fatal(err)
	}
	other, err := CreateChannel(ctx, "update-run-other", "/p")
	if err != nil {
		t.Fatal(err)
	}
	first, second, foreign := uuid.NewString(), uuid.NewString(), uuid.NewString()
	for id, channelId := range map[string]string{first: ch.OID, second: ch.OID, foreign: other.OID} {
		if err := AppendRun(ctx, channelId, waveobj.Run{ID: id, Status: "planning"}); err != nil {
			t.Fatal(err)
		}
	}
	markDone := func(r *waveobj.Run) error {
		r.Status = "done"
		return nil
	}
	if err := UpdateRun(ctx, ch.OID, second, markDone); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	for id, want := range map[string]string{first: "planning", second: "done"} {
		got, err := GetRun(ctx, ch.OID, id)
		if err != nil || got.Status != want {
			t.Errorf("run %s status = %+v (err %v), want %s", id, got, err, want)
		}
	}
	if err := UpdateRun(ctx, ch.OID, uuid.NewString(), markDone); err == nil {
		t.Errorf("expected error for missing run id")
	}
	// a run that exists under another channel is not this channel's
	if err := UpdateRun(ctx, ch.OID, foreign, markDone); err == nil {
		t.Errorf("expected error for a run in another channel")
	}
	if got, err := GetRun(ctx, other.OID, foreign); err != nil || got.Status != "planning" {
		t.Errorf("the other channel's run changed: %+v (err %v)", got, err)
	}
	if err := UpdateRun(ctx, uuid.NewString(), second, markDone); err == nil {
		t.Errorf("expected error for a missing channel")
	}
}

func TestChannelAtPath(t *testing.T) {
	ctx := context.Background()
	a, err := CreateChannel(ctx, "alpha", "/repo/alpha")
	if err != nil {
		t.Fatalf("CreateChannel alpha: %v", err)
	}
	if _, err := CreateChannel(ctx, "beta", "/repo/beta"); err != nil {
		t.Fatalf("CreateChannel beta: %v", err)
	}

	got, err := ChannelAtPath(ctx, "/repo/alpha")
	if err != nil {
		t.Fatalf("ChannelAtPath: %v", err)
	}
	if got == nil || got.OID != a.OID {
		t.Fatalf("ChannelAtPath(/repo/alpha) = %v, want %s", got, a.OID)
	}

	// a Windows spelling and a trailing slash are the same project
	got, err = ChannelAtPath(ctx, "/repo/alpha/")
	if err != nil {
		t.Fatalf("ChannelAtPath trailing slash: %v", err)
	}
	if got == nil || got.OID != a.OID {
		t.Fatalf("ChannelAtPath(/repo/alpha/) = %v, want %s", got, a.OID)
	}

	got, err = ChannelAtPath(ctx, "/repo/nothing")
	if err != nil {
		t.Fatalf("ChannelAtPath miss: %v", err)
	}
	if got != nil {
		t.Fatalf("ChannelAtPath(/repo/nothing) = %v, want nil", got)
	}

	// an empty path is not "every channel with no path" — it is no answer
	got, err = ChannelAtPath(ctx, "")
	if err != nil {
		t.Fatalf("ChannelAtPath empty: %v", err)
	}
	if got != nil {
		t.Fatalf("ChannelAtPath(\"\") = %v, want nil", got)
	}
}

func TestChannelAtPathMatchesSeparatorStyles(t *testing.T) {
	ctx := context.Background()
	ch, err := CreateChannel(ctx, "wave", `C:\Users\k\wave`)
	if err != nil {
		t.Fatalf("CreateChannel: %v", err)
	}
	got, err := ChannelAtPath(ctx, "C:/Users/k/wave")
	if err != nil {
		t.Fatalf("ChannelAtPath: %v", err)
	}
	if got == nil || got.OID != ch.OID {
		t.Fatalf("ChannelAtPath forward-slash = %v, want %s", got, ch.OID)
	}
}

func TestGetRunsBySessionIds(t *testing.T) {
	ctx := context.Background()
	ch, err := CreateChannel(ctx, "runs-by-session", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range []waveobj.Run{
		{ID: uuid.NewString(), Goal: "a", SessionId: "s-a"},
		{ID: uuid.NewString(), Goal: "b", SessionId: "s-b"},
		{ID: uuid.NewString(), Goal: "none"},
	} {
		if err := AppendRun(ctx, ch.OID, r); err != nil {
			t.Fatal(err)
		}
	}
	got, err := GetRunsBySessionIds(ctx, []string{"s-a", "s-missing"})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].Goal != "a" {
		t.Fatalf("want only the run launched under s-a, got %+v", got)
	}
	if none, err := GetRunsBySessionIds(ctx, nil); err != nil || len(none) != 0 {
		t.Fatalf("no ids: want nothing, got %v %v", none, err)
	}
}

func TestGetRunsByStatus(t *testing.T) {
	ctx := context.Background()
	ch, err := CreateChannel(ctx, "runs-by-status", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range []waveobj.Run{
		{ID: uuid.NewString(), Goal: "executing", Status: "executing"},
		{ID: uuid.NewString(), Goal: "planning", Status: "planning"},
		{ID: uuid.NewString(), Goal: "done", Status: "done"},
	} {
		if err := AppendRun(ctx, ch.OID, r); err != nil {
			t.Fatal(err)
		}
	}
	got, err := GetRunsByStatus(ctx, "executing", "planning")
	if err != nil {
		t.Fatal(err)
	}
	goals := map[string]bool{}
	for _, r := range got {
		if r.ChannelOID == ch.OID {
			goals[r.Goal] = true
		}
	}
	if len(goals) != 2 || !goals["executing"] || !goals["planning"] {
		t.Fatalf("want the executing and planning runs only, got %v", goals)
	}
	if none, err := GetRunsByStatus(ctx); err != nil || len(none) != 0 {
		t.Fatalf("no statuses: want nothing, got %v %v", none, err)
	}
}

func TestEnsureChannelAtPathCreatesOnceAndRefusesNoPath(t *testing.T) {
	ctx := context.Background()
	first, err := EnsureChannelAtPath(ctx, "ensure", "/repo/ensure")
	if err != nil {
		t.Fatalf("first ensure: %v", err)
	}
	second, err := EnsureChannelAtPath(ctx, "ensure renamed", `\repo\ensure\`)
	if err != nil {
		t.Fatalf("second ensure: %v", err)
	}
	if second.OID != first.OID || second.Name != "ensure" {
		t.Fatalf("second ensure = %s %q, want the existing %s \"ensure\"", second.OID, second.Name, first.OID)
	}
	if _, err := EnsureChannelAtPath(ctx, "none", ""); err == nil {
		t.Fatalf("ensure with no path succeeded; a pathless channel is not a project's")
	}
}
