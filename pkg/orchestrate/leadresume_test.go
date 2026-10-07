// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"errors"
	"reflect"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

type leadResume struct{ tab, runtime, sessionId, nudge string }

// interruptedLeadFixture is a dag's owner run whose lead tab has no controller, the way a restart leaves it.
type interruptedLeadFixture struct {
	fake      *fakeLead
	channelId string
	run       waveobj.Run
	resumes   []leadResume
}

// newInterruptedLead stores the run after mutate and scripts the lead's restart to return resumeErr.
func newInterruptedLead(t *testing.T, mutate func(*waveobj.Run), resumeErr error) *interruptedLeadFixture {
	t.Helper()
	f := &interruptedLeadFixture{fake: newFakeLead(t)}
	ch, err := wstore.CreateChannel(context.Background(), "leadresume", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	f.channelId = ch.OID
	f.run = jarvis.NewRun("goal", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Orchestrator, jarvis.DefaultOrchestratorPlaybook(), 1)
	f.run.Phases[0].WorkerOrefs = []string{"tab:lead"}
	f.run.DagORef, f.run.Runtime, f.run.SessionId = "dag-1", "claude", "sess-1"
	if mutate != nil {
		mutate(&f.run)
	}
	if err := wstore.AppendRun(context.Background(), ch.OID, f.run); err != nil {
		t.Fatal(err)
	}
	oldGone, oldResume := workerControllerGone, jarvis.ResumeRunWorker
	// the store is shared with every other test's runs, so only this one's lead reads as gone
	workerControllerGone = func(_ context.Context, r *waveobj.Run) bool { return r.ID == f.run.ID }
	jarvis.ResumeRunWorker = func(_ context.Context, tab, runtime, sessionId, nudge string) error {
		f.resumes = append(f.resumes, leadResume{tab, runtime, sessionId, nudge})
		return resumeErr
	}
	restoreAfterStages(t, func() { workerControllerGone, jarvis.ResumeRunWorker = oldGone, oldResume })
	return f
}

// The engine picks a dag's workers back up at boot, but nothing restarted its lead: the tab outlived the
// process, and the first wake found it dead and handed the run to the human (run 0354da6a).
func TestResumeInterruptedLeadsRestartsADagRunsLeadInItsOwnSession(t *testing.T) {
	f := newInterruptedLead(t, nil, nil)
	ResumeInterruptedLeads(context.Background())
	want := []leadResume{{"tab:lead", "claude", "sess-1", leadResumeNudge}}
	if !reflect.DeepEqual(f.resumes, want) {
		t.Fatalf("resumes = %+v, want %+v", f.resumes, want)
	}
	if n := f.fake.countKind(waveobj.RunEventKindLeadLaunched); n != 1 {
		t.Fatalf("want one lead-launched row, got %d in %v", n, f.fake.rows)
	}
}

func TestResumeInterruptedLeadsLeavesOtherRunsAlone(t *testing.T) {
	for name, mutate := range map[string]func(*waveobj.Run){
		// a lead that exits before submitting is MarkInterruptedRuns's to fail
		"no plan submitted": func(r *waveobj.Run) { r.DagORef = "" },
		"a dag's task run":  func(r *waveobj.Run) { r.Mode = jarvis.RunMode_Quick },
		"no session":        func(r *waveobj.Run) { r.SessionId = "" },
		"finished":          func(r *waveobj.Run) { r.Status = jarvis.RunStatus_Done },
	} {
		t.Run(name, func(t *testing.T) {
			f := newInterruptedLead(t, mutate, nil)
			ResumeInterruptedLeads(context.Background())
			if len(f.resumes) != 0 || len(f.fake.rows) != 0 {
				t.Fatalf("want nothing resumed or recorded, got %+v and %v", f.resumes, f.fake.rows)
			}
		})
	}
}

func TestResumeInterruptedLeadsLeavesALeadThatStillRuns(t *testing.T) {
	f := newInterruptedLead(t, nil, nil)
	workerControllerGone = func(context.Context, *waveobj.Run) bool { return false }
	ResumeInterruptedLeads(context.Background())
	if len(f.resumes) != 0 {
		t.Fatalf("a lead with a controller is not restarted, got %+v", f.resumes)
	}
}

// A lead that cannot be resumed stays what it was before this pass existed: dead at its first wake.
func TestResumeInterruptedLeadsRecordsNothingWhenTheRestartFails(t *testing.T) {
	f := newInterruptedLead(t, nil, errors.New("the worker's tab is gone"))
	ResumeInterruptedLeads(context.Background())
	if len(f.resumes) != 1 || len(f.fake.rows) != 0 {
		t.Fatalf("want one attempt and no row, got %+v and %v", f.resumes, f.fake.rows)
	}
}

// The restart returns before the process runs, and the watchdog's first tick follows at once: a wake in that
// window must wait for the lead, not give up on it.
func TestAWakeWhileTheResumedLeadStartsWaitsForIt(t *testing.T) {
	f := newInterruptedLead(t, nil, nil)
	ctx := context.Background()
	ResumeInterruptedLeads(ctx)
	f.fake.state = leadState{BlockId: wakeLeadBlock, TabId: wakeLeadTab, Starting: true}
	PostWake(ctx, f.channelId, f.run.ID, failedLine)
	if LeadDead(f.run.ID) {
		t.Fatal("a resumed lead whose process is still starting is not dead")
	}
}
