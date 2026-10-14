// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jarvis

import (
	"testing"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

func engineRun() waveobj.Run {
	return waveobj.Run{
		OID: "r1", ID: "r1", Mode: RunMode_Orchestrator,
		Orchestration: Orchestration_Engine, Runtime: "pi",
		Status: RunStatus_Executing,
	}
}

// A launched engine run's scheduler settings stay mutable while it is live — the session sheet's one
// genuinely changeable surface.
func TestEngineSettingsBlockerAllowsLiveEngineRun(t *testing.T) {
	for _, status := range []string{RunStatus_Planning, RunStatus_Executing, RunStatus_Blocked, RunStatus_AwaitingReview} {
		r := engineRun()
		r.Status = status
		if got := EngineSettingsBlocker(&r); got != "" {
			t.Errorf("status %q: blocker = %q, want none", status, got)
		}
	}
}

// Terminal is terminal: nothing is scheduled any more, so offering a dial that changes nothing is a lie.
func TestEngineSettingsBlockerRejectsTerminalRun(t *testing.T) {
	for _, status := range []string{RunStatus_Done, RunStatus_Cancelled} {
		r := engineRun()
		r.Status = status
		if got := EngineSettingsBlocker(&r); got == "" {
			t.Errorf("status %q: want a blocker", status)
		}
	}
}

// Only an orchestrator run has a scheduler to reconfigure.
func TestEngineSettingsBlockerRejectsNonOrchestratorRun(t *testing.T) {
	pipeline := engineRun()
	pipeline.Mode = RunMode_Pipeline
	pipeline.Orchestration = ""
	if got := EngineSettingsBlocker(&pipeline); got == "" {
		t.Error("pipeline mode: want a blocker")
	}
	quick := engineRun()
	quick.Mode = RunMode_Quick
	quick.Orchestration = ""
	if got := EngineSettingsBlocker(&quick); got == "" {
		t.Error("quick mode: want a blocker")
	}
}

// Pre-DAG the run is the pending carrier: DagSubmit reads exactly these fields, so writing them here is
// the same single source of truth the pre-rail runs already used.
func TestApplyPendingEngineSettingsWritesRun(t *testing.T) {
	r := engineRun()
	route := &waveobj.RoutePin{Runtime: "pi"}
	got := ApplyPendingEngineSettings(r, PendingEngineSettings{Parallelism: intPtr(3), WorkerRoute: route})
	if got.Parallelism != 3 {
		t.Errorf("parallelism = %d, want 3", got.Parallelism)
	}
	if got.WorkerRoute == nil || *got.WorkerRoute != *route {
		t.Errorf("worker route = %+v, want %+v", got.WorkerRoute, route)
	}
}

// An omitted width is not a request to clear one: the field is optional precisely so a sheet that only
// touched the route cannot silently forget the width the scheduler is running at.
func TestApplyPendingEngineSettingsLeavesOmittedWidth(t *testing.T) {
	r := engineRun()
	r.Parallelism = 5
	got := ApplyPendingEngineSettings(r, PendingEngineSettings{WorkerRoute: &waveobj.RoutePin{Runtime: "pi"}})
	if got.Parallelism != 5 {
		t.Errorf("parallelism = %d, want the run's existing 5", got.Parallelism)
	}
}

// A nil route clears the pending worker default rather than leaving the previous one in place.
func TestApplyPendingEngineSettingsClearsRoute(t *testing.T) {
	r := engineRun()
	r.WorkerRoute = &waveobj.RoutePin{Runtime: "pi"}
	got := ApplyPendingEngineSettings(r, PendingEngineSettings{Parallelism: intPtr(2)})
	if got.WorkerRoute != nil {
		t.Errorf("worker route = %+v, want nil", got.WorkerRoute)
	}
}

// Post-DAG the group is the scheduler's source of truth; the run keeps its launch snapshot.
func TestApplyLiveEngineSettingsWritesGroupOnly(t *testing.T) {
	g := waveobj.TaskGroup{OID: "d1", Parallelism: 2}
	route := &waveobj.RoutePin{Runtime: "pi"}
	got := ApplyLiveEngineSettings(g, PendingEngineSettings{Parallelism: intPtr(5), WorkerRoute: route})
	if got.Parallelism != 5 {
		t.Errorf("parallelism = %d, want 5", got.Parallelism)
	}
	if got.WorkerRoute == nil || *got.WorkerRoute != *route {
		t.Errorf("worker route = %+v, want %+v", got.WorkerRoute, route)
	}
}

// The same omission rule holds on the live side.
func TestApplyLiveEngineSettingsLeavesOmittedWidth(t *testing.T) {
	g := waveobj.TaskGroup{OID: "d1", Parallelism: 6}
	got := ApplyLiveEngineSettings(g, PendingEngineSettings{})
	if got.Parallelism != 6 {
		t.Errorf("parallelism = %d, want the group's existing 6", got.Parallelism)
	}
}

// A stored adaptive lead ran its own subagents: there is no engine scheduler behind it, so its width and
// worker route are not dials this sheet can move. The frontend's sheetFace applies the same rule, and the
// server is the one that has to enforce it.
func TestEngineSettingsBlockerRejectsAStoredAdaptiveRun(t *testing.T) {
	adaptive := engineRun()
	adaptive.Orchestration = "adaptive"
	if got := EngineSettingsBlocker(&adaptive); got == "" {
		t.Error("a stored adaptive orchestrator has no scheduler to reconfigure")
	}
	// an empty orchestration predates the control: the runtime decided then, and only pi led an engine run
	legacyClaude := engineRun()
	legacyClaude.Orchestration, legacyClaude.Runtime = "", "claude"
	if got := EngineSettingsBlocker(&legacyClaude); got == "" {
		t.Error("a pre-control claude orchestrator was adaptive, so it has no scheduler either")
	}
	legacyPi := engineRun()
	legacyPi.Orchestration, legacyPi.Runtime = "", "pi"
	if got := EngineSettingsBlocker(&legacyPi); got != "" {
		t.Errorf("a pre-control pi orchestrator drove the engine: blocker = %q, want none", got)
	}
}

// Autonomous is applied only when sent, on either carrier. That each apply leaves the other carrier alone is
// checked end to end by TestSetRunSettingsAutonomousCarrier.
func TestApplyEngineSettingsAutonomous(t *testing.T) {
	r := engineRun()
	r.Autonomous = true
	if got := ApplyPendingEngineSettings(r, PendingEngineSettings{}); !got.Autonomous {
		t.Error("pending: a nil value cleared the run's autonomous")
	}
	if got := ApplyPendingEngineSettings(r, PendingEngineSettings{Autonomous: boolPtr(false)}); got.Autonomous {
		t.Error("pending: false did not turn the run's autonomous off")
	}
	off := engineRun()
	if got := ApplyPendingEngineSettings(off, PendingEngineSettings{Autonomous: boolPtr(true)}); !got.Autonomous {
		t.Error("pending: true did not turn the run's autonomous on")
	}

	g := waveobj.TaskGroup{OID: "d1", RunID: "r1", Autonomous: true}
	if got := ApplyLiveEngineSettings(g, PendingEngineSettings{}); !got.Autonomous {
		t.Error("live: a nil value cleared the group's autonomous")
	}
	if got := ApplyLiveEngineSettings(g, PendingEngineSettings{Autonomous: boolPtr(false)}); got.Autonomous {
		t.Error("live: false did not turn the group's autonomous off")
	}
	if got := ApplyLiveEngineSettings(waveobj.TaskGroup{OID: "d1"}, PendingEngineSettings{Autonomous: boolPtr(true)}); !got.Autonomous {
		t.Error("live: true did not turn the group's autonomous on")
	}
}

func TestEffectiveAutonomous(t *testing.T) {
	r := engineRun()
	r.Autonomous = true
	if !EffectiveAutonomous(&r, nil) {
		t.Error("no group: the run's value should stand")
	}
	owned := &waveobj.TaskGroup{RunID: r.ID, Autonomous: false}
	if EffectiveAutonomous(&r, owned) {
		t.Error("an owning group's value should win over the run's")
	}
	owned.Autonomous = true
	r.Autonomous = false
	if !EffectiveAutonomous(&r, owned) {
		t.Error("an owning group's true should win over the run's false")
	}
	foreign := &waveobj.TaskGroup{RunID: "parent", Autonomous: true}
	if EffectiveAutonomous(&r, foreign) {
		t.Error("a group another run owns must be ignored")
	}
	if EffectiveAutonomous(nil, nil) {
		t.Error("no run is not autonomous")
	}
}

func TestRunSettingsLightReviewerRoutePending(t *testing.T) {
	route := &waveobj.RoutePin{Runtime: "claude", Model: "haiku"}
	r := ApplyPendingEngineSettings(engineRun(), PendingEngineSettings{LightReviewerRoute: route})
	if r.LightReviewerRoute == nil || *r.LightReviewerRoute != *route {
		t.Fatalf("pending: light reviewer route = %+v, want %+v", r.LightReviewerRoute, route)
	}
	if got := ApplyPendingEngineSettings(r, PendingEngineSettings{}); got.LightReviewerRoute != nil {
		t.Fatalf("a nil value must clear the run's: %+v", got.LightReviewerRoute)
	}
}

func TestRunSettingsLightReviewerRouteLive(t *testing.T) {
	route := &waveobj.RoutePin{Runtime: "claude", Model: "haiku"}
	g := ApplyLiveEngineSettings(waveobj.TaskGroup{OID: "d1"}, PendingEngineSettings{LightReviewerRoute: route})
	if g.LightReviewerRoute == nil || *g.LightReviewerRoute != *route {
		t.Fatalf("live: light reviewer route = %+v, want %+v", g.LightReviewerRoute, route)
	}
	if got := ApplyLiveEngineSettings(g, PendingEngineSettings{}); got.LightReviewerRoute != nil {
		t.Fatalf("a nil value must clear the group's: %+v", got.LightReviewerRoute)
	}
}
