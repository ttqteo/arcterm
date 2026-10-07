// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jarvis

import (
	"context"
	"reflect"
	"testing"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

func TestResumePhasePutsAFailedPhaseBackToRunning(t *testing.T) {
	run := NewRun("goal", "ws-1", "/p", nil, RunMode_Quick, QuickPlaybook(), 1000)
	failed, err := FailPhase(run, 0, 2000)
	if err != nil {
		t.Fatal(err)
	}
	resumed, err := ResumePhase(failed, 0)
	if err != nil {
		t.Fatalf("ResumePhase: %v", err)
	}
	if resumed.Status != RunStatus_Executing || resumed.Phases[0].State != PhaseState_Running || resumed.Phases[0].DoneTs != 0 {
		t.Fatalf("status=%q phase=%q donets=%d, want executing, running, 0", resumed.Status, resumed.Phases[0].State, resumed.Phases[0].DoneTs)
	}
}

func TestResumePhaseRefusesEveryOtherPhaseState(t *testing.T) {
	for _, state := range []string{PhaseState_Pending, PhaseState_Running, PhaseState_Done, PhaseState_Blocked, PhaseState_Skipped} {
		run := NewRun("goal", "ws-1", "/p", nil, RunMode_Quick, QuickPlaybook(), 1000)
		run.Phases[0].State = state
		if _, err := ResumePhase(run, 0); err == nil {
			t.Errorf("phase %q: want a refusal", state)
		}
	}
	run := NewRun("goal", "ws-1", "/p", nil, RunMode_Quick, QuickPlaybook(), 1000)
	if _, err := ResumePhase(run, 5); err == nil {
		t.Error("out of range phase: want a refusal")
	}
}

func TestResumeWorkerArgs(t *testing.T) {
	base := []string{"--dangerously-skip-permissions", "--model", "opus"}
	for runtime, flag := range map[string]string{"claude": "--resume", "": "--resume", "pi": "--session"} {
		got, ok := ResumeWorkerArgs(runtime, "sess-1", base, ResumeNudge)
		want := []string{flag, "sess-1", "--dangerously-skip-permissions", "--model", "opus", ResumeNudge}
		if !ok || !reflect.DeepEqual(got, want) {
			t.Errorf("runtime %q: got %v %v, want %v", runtime, got, ok, want)
		}
	}
	got, ok := ResumeWorkerArgs("agy", "conv-1", base, ResumeNudge)
	wantAgy := []string{"--conversation", "conv-1", "--dangerously-skip-permissions", "--model", "opus", "-i", ResumeNudge}
	if !ok || !reflect.DeepEqual(got, wantAgy) {
		t.Errorf("agy: got %v %v, want %v", got, ok, wantAgy)
	}
	if _, ok := ResumeWorkerArgs("codex", "sess-1", base, ResumeNudge); ok {
		t.Error("codex cannot resume a session")
	}
}

// newWorkerTab stores a worker tab whose block carries meta, returning the tab oref and block id.
func newWorkerTab(t *testing.T, meta waveobj.MetaMapType) (string, string) {
	t.Helper()
	ctx := context.Background()
	block := &waveobj.Block{OID: uuid.NewString(), Meta: meta}
	tab := &waveobj.Tab{OID: uuid.NewString(), BlockIds: []string{block.OID}, Meta: waveobj.MetaMapType{}}
	if err := wstore.DBInsert(ctx, block); err != nil {
		t.Fatal(err)
	}
	if err := wstore.DBInsert(ctx, tab); err != nil {
		t.Fatal(err)
	}
	return waveobj.MakeORef(waveobj.OType_Tab, tab.OID).String(), block.OID
}

func stubWorkerStart(t *testing.T, err error) *[]string {
	t.Helper()
	old := startWorkerController
	t.Cleanup(func() { startWorkerController = old })
	var started []string
	startWorkerController = func(_ context.Context, _, blockId string) error {
		started = append(started, blockId)
		return err
	}
	return &started
}

func TestResumeRunWorkerRestartsTheBlockInItsSession(t *testing.T) {
	started := stubWorkerStart(t, nil)
	tabORef, blockId := newWorkerTab(t, waveobj.MetaMapType{
		waveobj.MetaKey_CmdArgs: []string{"--dangerously-skip-permissions", "--session-id", "sess-1", "the task"},
		"agent:baseargs":        []string{"--dangerously-skip-permissions"},
	})
	if err := ResumeRunWorker(context.Background(), tabORef, "claude", "sess-1", ResumeNudge); err != nil {
		t.Fatalf("ResumeRunWorker: %v", err)
	}
	block, err := wstore.DBMustGet[*waveobj.Block](context.Background(), blockId)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"--resume", "sess-1", "--dangerously-skip-permissions", ResumeNudge}
	if got := block.Meta.GetStringList(waveobj.MetaKey_CmdArgs); !reflect.DeepEqual(got, want) {
		t.Fatalf("cmd:args = %v, want %v", got, want)
	}
	if len(*started) != 1 || (*started)[0] != blockId {
		t.Fatalf("want the worker's own block started once, got %v", *started)
	}
}

func TestResumeRunWorkerRefusesWithoutATabOrBaseArgs(t *testing.T) {
	started := stubWorkerStart(t, nil)
	gone := waveobj.MakeORef(waveobj.OType_Tab, uuid.NewString()).String()
	if err := ResumeRunWorker(context.Background(), gone, "claude", "sess-1", ResumeNudge); err == nil {
		t.Error("a missing tab: want an error")
	}
	legacy, _ := newWorkerTab(t, waveobj.MetaMapType{waveobj.MetaKey_CmdArgs: []string{"the task"}})
	if err := ResumeRunWorker(context.Background(), legacy, "claude", "sess-1", ResumeNudge); err == nil {
		t.Error("a block launched before resume support: want an error")
	}
	if len(*started) != 0 {
		t.Fatalf("nothing may start on a refusal, got %v", *started)
	}
}
