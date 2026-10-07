// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"errors"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// newFailedQuickRun stores a quick run whose worker "tab:worker" exited, failing its phase, after mutate.
func newFailedQuickRun(t *testing.T, mutate func(*waveobj.Run)) (string, waveobj.Run) {
	t.Helper()
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "resume", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	run := jarvis.NewRun("goal", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Quick, jarvis.QuickPlaybook(), 1)
	run.Runtime = "claude"
	run.SessionId = "sess-1"
	run.Phases[0].WorkerOrefs = []string{"tab:worker"}
	if run, err = jarvis.FailPhase(run, 0, 2); err != nil {
		t.Fatal(err)
	}
	if mutate != nil {
		mutate(&run)
	}
	if err := wstore.AppendRun(ctx, ch.OID, run); err != nil {
		t.Fatal(err)
	}
	return ch.OID, run
}

type resumeCall struct{ worker, runtime, sessionId string }

func stubResumeRunWorker(t *testing.T, err error) *[]resumeCall {
	t.Helper()
	old := jarvis.ResumeRunWorker
	t.Cleanup(func() { jarvis.ResumeRunWorker = old })
	var calls []resumeCall
	jarvis.ResumeRunWorker = func(_ context.Context, worker, runtime, sessionId, _ string) error {
		calls = append(calls, resumeCall{worker, runtime, sessionId})
		return err
	}
	return &calls
}

func resume(channelId, runId string) error {
	return (&WshServer{}).AdvanceRunCommand(context.Background(), wshrpc.CommandAdvanceRunData{
		ChannelId: channelId, RunId: runId, PhaseIdx: 0, Action: jarvis.RunAction_Resume,
	})
}

func TestResumeRestartsTheWorkerAndReopensThePhase(t *testing.T) {
	calls := stubResumeRunWorker(t, nil)
	channelId, run := newFailedQuickRun(t, nil)
	if err := resume(channelId, run.ID); err != nil {
		t.Fatalf("resume: %v", err)
	}
	if len(*calls) != 1 || (*calls)[0] != (resumeCall{"tab:worker", "claude", "sess-1"}) {
		t.Fatalf("want the worker resumed once in its session, got %+v", *calls)
	}
	ctx := context.Background()
	got, err := wstore.GetRun(ctx, channelId, run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != jarvis.RunStatus_Executing || got.Phases[0].State != jarvis.PhaseState_Running {
		t.Fatalf("status=%q phase=%q, want executing and running", got.Status, got.Phases[0].State)
	}
	events, err := wstore.QueryRunEvents(ctx, channelId, run.ID, 0)
	if err != nil {
		t.Fatal(err)
	}
	resumed := 0
	for _, ev := range events {
		if ev.Kind == waveobj.RunEventKindWorkerResumed {
			resumed++
		}
	}
	if resumed != 1 {
		t.Fatalf("want one worker-resumed event, got %d in %+v", resumed, events)
	}
}

// a worker that exits at once, or never starts, is reconciled by the exit hook only if the phase already
// reads running when it starts
func TestResumeReopensThePhaseBeforeTheWorkerStarts(t *testing.T) {
	channelId, run := newFailedQuickRun(t, nil)
	old := jarvis.ResumeRunWorker
	t.Cleanup(func() { jarvis.ResumeRunWorker = old })
	var stateAtStart string
	jarvis.ResumeRunWorker = func(ctx context.Context, _, _, _, _ string) error {
		cur, err := wstore.GetRun(ctx, channelId, run.ID)
		if err != nil {
			return err
		}
		stateAtStart = cur.Phases[0].State
		return nil
	}
	if err := resume(channelId, run.ID); err != nil {
		t.Fatalf("resume: %v", err)
	}
	if stateAtStart != jarvis.PhaseState_Running {
		t.Fatalf("phase was %q when the worker started, want running", stateAtStart)
	}
}

func TestResumeRefusesARunItCannotResume(t *testing.T) {
	for name, mutate := range map[string]func(*waveobj.Run){
		"dag run":    func(r *waveobj.Run) { r.DagORef = "dag:1" },
		"not failed": func(r *waveobj.Run) { r.Phases[0].State = jarvis.PhaseState_Running },
		"no session": func(r *waveobj.Run) { r.SessionId = "" },
		"codex":      func(r *waveobj.Run) { r.Runtime = "codex" },
	} {
		t.Run(name, func(t *testing.T) {
			calls := stubResumeRunWorker(t, nil)
			channelId, run := newFailedQuickRun(t, mutate)
			if err := resume(channelId, run.ID); err == nil {
				t.Fatal("want a refusal")
			}
			if len(*calls) != 0 {
				t.Fatalf("a refused resume must not restart the worker, got %+v", *calls)
			}
		})
	}
}

func TestResumeLeavesThePhaseFailedWhenTheRestartFails(t *testing.T) {
	stubResumeRunWorker(t, errors.New("the worker's tab is gone"))
	channelId, run := newFailedQuickRun(t, nil)
	if err := resume(channelId, run.ID); err == nil {
		t.Fatal("want the restart's error")
	}
	got, err := wstore.GetRun(context.Background(), channelId, run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != jarvis.RunStatus_Blocked || got.Phases[0].State != jarvis.PhaseState_Failed {
		t.Fatalf("status=%q phase=%q, want blocked and failed", got.Status, got.Phases[0].State)
	}
}
