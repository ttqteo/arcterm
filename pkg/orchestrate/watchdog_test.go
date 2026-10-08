// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/blockcontroller"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/runroute"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

func TestScheduleOnceFlagsStalledChild(t *testing.T) {
	allowWorkerHarnessForTest(t)
	// a live lead judges a stall; with none the engine retries the task itself (autoRetryStalled)
	newFakeLead(t)
	ctx := context.Background()
	cc := &captureClient{}
	prevClient := wps.Broker.GetClient()
	wps.Broker.SetClient(cc)
	defer wps.Broker.SetClient(prevClient)
	wps.Broker.Subscribe("stall-events", wps.SubscriptionRequest{Event: DagEventTaskStalled, AllScopes: true})
	defer wps.Broker.Unsubscribe("stall-events", DagEventTaskStalled)

	// the child wrote a transcript, then went quiet past the threshold
	oldRoot := sessionsRootFor
	root := t.TempDir()
	sessionsRootFor = func(string) string { return root }
	defer func() { sessionsRootFor = oldRoot }()

	ch, err := wstore.CreateChannel(ctx, "stall", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	owner := jarvis.NewRun("owner", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Orchestrator, jarvis.DefaultOrchestratorPlaybook(), 1)
	if err := wstore.AppendRun(ctx, ch.OID, owner); err != nil {
		t.Fatal(err)
	}
	g, err := NewTaskGroup(owner.ID, ch.OID, "g", 1, false, []waveobj.TaskNode{
		{ID: "t-0", Label: "a"},
	}, 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	quiet := time.Now().Add(-StallThreshold - time.Minute)
	g.Tasks[0].LastActivity = quiet.UnixMilli()
	if err := wstore.AppendDag(ctx, &g); err != nil {
		t.Fatal(err)
	}
	writeClaudeSession(t, root, ch.ProjectPath, liveSession, quiet)
	child := jarvis.NewRun("child", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Quick, jarvis.QuickPlaybook(), 1)
	child.ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
	// as childRunFromSpec builds it: a tracked runtime launched under a session id, so the probe has a
	// file to read and its silence is a real verdict. claude, because the first-token deadline is not
	// armed for it: only the aging transcript can flag this child.
	child.Runtime = "claude"
	child.DagORef = g.OID
	child.SessionId = liveSession
	if err := wstore.AppendRun(ctx, ch.OID, child); err != nil {
		t.Fatal(err)
	}
	g.Tasks[0].RunID = child.ID
	g.Tasks[0].State = TaskState_Running
	if err := wstore.UpdateDag(ctx, g.OID, func(cur *waveobj.TaskGroup) error {
		*cur = g
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	if err := ScheduleOnce(ctx, &g); err != nil {
		t.Fatal(err)
	}
	if g.Tasks[0].State != TaskState_Stalled {
		t.Fatalf("stale running task must flag stalled, got %s", g.Tasks[0].State)
	}
	if !cc.saw(DagEventTaskStalled, waveobj.MakeORef(waveobj.OType_Dag, g.OID).String()) {
		t.Fatal("task-stalled event not published")
	}

	// a stalled task whose child completes derives done (no stale-stall forever)
	if err := wstore.UpdateRun(ctx, ch.OID, child.ID, func(r *waveobj.Run) error {
		r.Status = jarvis.RunStatus_Done
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := ScheduleOnce(ctx, &g); err != nil {
		t.Fatal(err)
	}
	if g.Tasks[0].State != TaskState_Done {
		t.Fatalf("completed child must derive done even from stalled, got %s", g.Tasks[0].State)
	}
}

func TestScheduleOnceDoesNotStallActiveChild(t *testing.T) {
	allowWorkerHarnessForTest(t)
	ctx := context.Background()
	oldRoot := sessionsRootFor
	root := t.TempDir()
	sessionsRootFor = func(string) string { return root }
	defer func() { sessionsRootFor = oldRoot }()

	ch, err := wstore.CreateChannel(ctx, "active", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	owner := jarvis.NewRun("owner", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Orchestrator, jarvis.DefaultOrchestratorPlaybook(), 1)
	if err := wstore.AppendRun(ctx, ch.OID, owner); err != nil {
		t.Fatal(err)
	}
	g, err := NewTaskGroup(owner.ID, ch.OID, "g", 1, false, []waveobj.TaskNode{
		{ID: "t-0", Label: "a"},
	}, 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	g.Tasks[0].LastActivity = time.Now().Add(-StallThreshold - time.Minute).UnixMilli()
	if err := wstore.AppendDag(ctx, &g); err != nil {
		t.Fatal(err)
	}
	writePiSession(t, root, liveSession, time.Now().Add(-1*time.Minute))
	child := jarvis.NewRun("child", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Quick, jarvis.QuickPlaybook(), 1)
	child.ID = "11111111-1111-4111-8111-111111111111"
	child.Runtime = "pi"
	child.DagORef = g.OID
	child.SessionId = liveSession
	if err := wstore.AppendRun(ctx, ch.OID, child); err != nil {
		t.Fatal(err)
	}
	g.Tasks[0].RunID = child.ID
	g.Tasks[0].State = TaskState_Running
	if err := wstore.UpdateDag(ctx, g.OID, func(cur *waveobj.TaskGroup) error {
		*cur = g
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	if err := ScheduleOnce(ctx, &g); err != nil {
		t.Fatal(err)
	}
	if g.Tasks[0].State != TaskState_Running {
		t.Fatalf("child with fresh transcript writes must stay running, got %s", g.Tasks[0].State)
	}
	if g.Tasks[0].LastActivity <= time.Now().Add(-StallThreshold).UnixMilli() {
		t.Fatalf("lastactivity must refresh from the session probe, got %d", g.Tasks[0].LastActivity)
	}
}

// F18 regression: the liveness scan used to read pi sessions only, so a claude child — the composer's
// default worker route for a claude lead — never moved off its spawn-time seed and flipped stalled at
// the threshold no matter how hard it was working. Its own transcript must refresh the heartbeat.
func TestScheduleOnceDoesNotStallActiveClaudeChild(t *testing.T) {
	allowWorkerHarnessForTest(t)
	ctx := context.Background()
	oldRoot := sessionsRootFor
	root := t.TempDir()
	sessionsRootFor = func(string) string { return root }
	defer func() { sessionsRootFor = oldRoot }()

	worktree := filepath.Join(t.TempDir(), "wt-claude")
	ch, err := wstore.CreateChannel(ctx, "claude-active", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	owner := jarvis.NewRun("owner", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Orchestrator, jarvis.DefaultOrchestratorPlaybook(), 1)
	if err := wstore.AppendRun(ctx, ch.OID, owner); err != nil {
		t.Fatal(err)
	}
	g, err := NewTaskGroup(owner.ID, ch.OID, "g", 1, false, []waveobj.TaskNode{{ID: "t-0", Label: "a"}}, 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	g.Tasks[0].LastActivity = time.Now().Add(-StallThreshold - time.Minute).UnixMilli()
	if err := wstore.AppendDag(ctx, &g); err != nil {
		t.Fatal(err)
	}
	fresh := time.Now().Add(-1 * time.Minute)
	writeClaudeSession(t, root, worktree, liveSession, fresh)

	child := jarvis.NewRun("child", "ws-1", worktree, nil, jarvis.RunMode_Quick, jarvis.QuickPlaybook(), 1)
	child.ID = "22222222-2222-4222-8222-222222222222"
	child.Runtime = "claude"
	child.DagORef = g.OID
	child.SessionId = liveSession
	if err := wstore.AppendRun(ctx, ch.OID, child); err != nil {
		t.Fatal(err)
	}
	g.Tasks[0].RunID = child.ID
	g.Tasks[0].State = TaskState_Running
	if err := wstore.UpdateDag(ctx, g.OID, func(cur *waveobj.TaskGroup) error {
		*cur = g
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	if err := ScheduleOnce(ctx, &g); err != nil {
		t.Fatal(err)
	}
	if g.Tasks[0].State != TaskState_Running {
		t.Fatalf("claude child with fresh transcript writes must stay running, got %s", g.Tasks[0].State)
	}
	if g.Tasks[0].LastActivity != fresh.UnixMilli() {
		t.Fatalf("lastactivity must refresh from the claude transcript, want %d got %d", fresh.UnixMilli(), g.Tasks[0].LastActivity)
	}
}

// A child liveness cannot read has no heartbeat to age, so its task must report freshness unknown
// rather than stall: the lead's answer to a stall is retry, which kills the child it was told about.
// The first-token deadline is no exception - an unreadable pi child has written nothing as far as the
// probe can tell, however hard it is working. A child launched without a session id has no file to open.
func TestScheduleOnceLeavesUntrackedRuntimeFreshnessUnknown(t *testing.T) {
	allowWorkerHarnessForTest(t)
	ctx := context.Background()
	cases := []struct {
		name    string
		runtime string
		root    string
		session string
	}{
		{name: "runtime without a transcript reader", runtime: "opencode", root: t.TempDir(), session: liveSession},
		{name: "pi child with no session root", runtime: "pi", root: "", session: liveSession},
		{name: "pi child launched without a session id", runtime: "pi", root: t.TempDir(), session: ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			oldRoot := sessionsRootFor
			sessionsRootFor = func(string) string { return tc.root }
			defer func() { sessionsRootFor = oldRoot }()

			ch, err := wstore.CreateChannel(ctx, "untracked-"+tc.runtime, t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			owner := jarvis.NewRun("owner", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Orchestrator, jarvis.DefaultOrchestratorPlaybook(), 1)
			if err := wstore.AppendRun(ctx, ch.OID, owner); err != nil {
				t.Fatal(err)
			}
			g, err := NewTaskGroup(owner.ID, ch.OID, "g", 1, false, []waveobj.TaskNode{{ID: "t-0", Label: "a"}}, 1, nil)
			if err != nil {
				t.Fatal(err)
			}
			g.Tasks[0].LastActivity = time.Now().Add(-StallThreshold - time.Minute).UnixMilli()
			if err := wstore.AppendDag(ctx, &g); err != nil {
				t.Fatal(err)
			}
			// spawned long past both deadlines
			child := jarvis.NewRun("child", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Quick, jarvis.QuickPlaybook(), 1)
			child.Runtime = tc.runtime
			child.DagORef = g.OID
			child.SessionId = tc.session
			if err := wstore.AppendRun(ctx, ch.OID, child); err != nil {
				t.Fatal(err)
			}
			g.Tasks[0].RunID = child.ID
			g.Tasks[0].State = TaskState_Running
			if err := wstore.UpdateDag(ctx, g.OID, func(cur *waveobj.TaskGroup) error {
				*cur = g
				return nil
			}); err != nil {
				t.Fatal(err)
			}

			if err := ScheduleOnce(ctx, &g); err != nil {
				t.Fatal(err)
			}
			if g.Tasks[0].State != TaskState_Running {
				t.Fatalf("an unobservable child must not be flagged stalled, got %s", g.Tasks[0].State)
			}
			if g.Tasks[0].LastActivity != 0 {
				t.Fatalf("freshness must read unknown, got %d", g.Tasks[0].LastActivity)
			}
		})
	}
}

func TestWatchdogTickAdvancesDag(t *testing.T) {
	allowWorkerHarnessForTest(t)
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "watchdog", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	owner := jarvis.NewRun("owner", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Orchestrator, jarvis.DefaultOrchestratorPlaybook(), 1)
	if err := wstore.AppendRun(ctx, ch.OID, owner); err != nil {
		t.Fatal(err)
	}
	g, err := NewTaskGroup(owner.ID, ch.OID, "g", 1, false, []waveobj.TaskNode{{ID: "t-0", Label: "a"}}, 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := wstore.AppendDag(ctx, &g); err != nil {
		t.Fatal(err)
	}
	old := spawnWorker
	spawnWorker = func(ctx context.Context, cap runroute.Capability, workspaceId, projectName, cwd, prompt string, _ jarvis.RunWorkerOptions) (string, error) {
		return "tab:worker", nil
	}
	defer func() { spawnWorker = old }()

	// the tick lists running dags and advances each — the fresh dag gets its ready task spawned
	watchdogTick(ctx)
	persisted, err := wstore.GetDag(ctx, g.OID)
	if err != nil {
		t.Fatal(err)
	}
	if persisted.Tasks[0].State != TaskState_Running {
		t.Fatalf("watchdog tick must advance a running dag, got %s", persisted.Tasks[0].State)
	}
}

func TestSafeTickSurvivesPanic(t *testing.T) {
	old := watchdogTick
	defer func() { watchdogTick = old }()

	// a panicking tick must not take the loop down: recover is per-tick, not per-loop
	watchdogTick = func(ctx context.Context) { panic("boom") }
	safeTick(context.Background(), watchdogTick)

	ticked := false
	watchdogTick = func(ctx context.Context) { ticked = true }
	safeTick(context.Background(), watchdogTick)
	if !ticked {
		t.Fatal("watchdog must keep ticking after a panicking tick")
	}
}

// A child that never writes a first token has no transcript mtime to age, so before the first-token
// deadline existed it could never stall: the whole stall path is gated on LastActivity > 0. This is
// the hang case specifically - a child that DIED is caught in seconds by the worker-exit hook. The
// deadline is armed per runtime: pi writes its transcript per event, so silence past it is real,
// while a claude child routinely commits correct work having written no transcript at all. Dispatch
// seeds LastActivity with the spawn time, and that seed must not read as a write: it would hide the pi
// child from the deadline and age the claude child into a 15m stall.
func TestScheduleOnceFirstTokenDeadlineIsPerRuntime(t *testing.T) {
	allowWorkerHarnessForTest(t)
	// a live lead judges a stall; with none the engine retries the task itself (autoRetryStalled)
	newFakeLead(t)
	ctx := context.Background()

	// no sessions anywhere: the probe is tracked (liveness-capable runtime, launched under a session id)
	// but finds nothing
	oldRoot := sessionsRootFor
	sessionsRootFor = func(string) string { return t.TempDir() }
	defer func() { sessionsRootFor = oldRoot }()

	cases := []struct {
		name    string
		runtime string
		age     time.Duration
		want    string
	}{
		{name: "pi child stalls", runtime: "pi", age: FirstTokenDeadline + time.Minute, want: TaskState_Stalled},
		{name: "claude child keeps running", runtime: "claude", age: FirstTokenDeadline + time.Minute, want: TaskState_Running},
		// the false stall: the spawn seed aged into a stall on a child that had written nothing
		{name: "claude child keeps running past the stall threshold", runtime: "claude", age: StallThreshold + time.Minute, want: TaskState_Running},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ch, err := wstore.CreateChannel(ctx, "first-token-"+tc.runtime+"-"+tc.age.String(), t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			owner := jarvis.NewRun("owner", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Orchestrator, jarvis.DefaultOrchestratorPlaybook(), 1)
			if err := wstore.AppendRun(ctx, ch.OID, owner); err != nil {
				t.Fatal(err)
			}
			g, err := NewTaskGroup(owner.ID, ch.OID, "g", 1, false, []waveobj.TaskNode{{ID: "t-0", Label: "a"}}, 1, nil)
			if err != nil {
				t.Fatal(err)
			}
			if err := wstore.AppendDag(ctx, &g); err != nil {
				t.Fatal(err)
			}
			spawnedTs := time.Now().Add(-tc.age).UnixMilli()
			child := jarvis.NewRun("child", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Quick, jarvis.QuickPlaybook(), spawnedTs)
			child.Runtime = tc.runtime
			child.DagORef = g.OID
			child.SessionId = liveSession
			if err := wstore.AppendRun(ctx, ch.OID, child); err != nil {
				t.Fatal(err)
			}
			g.Tasks[0].RunID = child.ID
			g.Tasks[0].State = TaskState_Running
			g.Tasks[0].LastActivity = spawnedTs // dispatch seeds the spawn time
			if err := wstore.UpdateDag(ctx, g.OID, func(cur *waveobj.TaskGroup) error {
				*cur = g
				return nil
			}); err != nil {
				t.Fatal(err)
			}

			if err := ScheduleOnce(ctx, &g); err != nil {
				t.Fatal(err)
			}
			if g.Tasks[0].State != tc.want {
				t.Fatalf("%s child silent for %s: want %s, got %s", tc.runtime, tc.age, tc.want, g.Tasks[0].State)
			}
			if g.Tasks[0].LastActivity != 0 {
				t.Fatalf("a child that wrote nothing must read freshness unknown, got %d", g.Tasks[0].LastActivity)
			}
		})
	}
}

// The first-token deadline is off for claude, but a claude worker whose shell never came up is not the
// silent-but-working case that keeps it off: there is no process to be working. Run 700db496's t-5 sat
// running like this for 45 minutes.
func TestScheduleOnceStallsClaudeChildWhoseWorkerNeverStarted(t *testing.T) {
	allowWorkerHarnessForTest(t)
	newFakeLead(t).state.Alive = true // a lead-free stall would be auto-retried, which this test is not about
	ctx := context.Background()
	oldRoot := sessionsRootFor
	sessionsRootFor = func(string) string { return t.TempDir() }
	defer func() { sessionsRootFor = oldRoot }()
	prevBlock, prevStatus := workerBlockFn, blockShellStatus
	t.Cleanup(func() { workerBlockFn, blockShellStatus = prevBlock, prevStatus })

	cases := []struct {
		name   string
		status string
		age    time.Duration
		want   string
	}{
		{name: "shell never came up", status: blockcontroller.Status_Init, age: FirstTokenDeadline + time.Minute, want: TaskState_Stalled},
		{name: "shell still coming up inside the deadline", status: blockcontroller.Status_Init, age: time.Minute, want: TaskState_Running},
		{name: "shell running", status: blockcontroller.Status_Running, age: FirstTokenDeadline + time.Minute, want: TaskState_Running},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			workerBlockFn = func(context.Context, *waveobj.Run) (string, bool) {
				return "worker-block", tc.status == blockcontroller.Status_Running
			}
			blockShellStatus = func(string) string { return tc.status }
			ch, err := wstore.CreateChannel(ctx, "never-started-"+tc.name, t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			owner := jarvis.NewRun("owner", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Orchestrator, jarvis.DefaultOrchestratorPlaybook(), 1)
			if err := wstore.AppendRun(ctx, ch.OID, owner); err != nil {
				t.Fatal(err)
			}
			g, err := NewTaskGroup(owner.ID, ch.OID, "g", 1, false, []waveobj.TaskNode{{ID: "t-0", Label: "a"}}, 1, nil)
			if err != nil {
				t.Fatal(err)
			}
			if err := wstore.AppendDag(ctx, &g); err != nil {
				t.Fatal(err)
			}
			spawnedTs := time.Now().Add(-tc.age).UnixMilli()
			child := jarvis.NewRun("child", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Quick, jarvis.QuickPlaybook(), spawnedTs)
			child.Runtime = "claude"
			child.DagORef = g.OID
			child.SessionId = liveSession
			if err := wstore.AppendRun(ctx, ch.OID, child); err != nil {
				t.Fatal(err)
			}
			g.Tasks[0].RunID = child.ID
			g.Tasks[0].State = TaskState_Running
			g.Tasks[0].LastActivity = spawnedTs
			if err := wstore.UpdateDag(ctx, g.OID, func(cur *waveobj.TaskGroup) error {
				*cur = g
				return nil
			}); err != nil {
				t.Fatal(err)
			}

			if err := ScheduleOnce(ctx, &g); err != nil {
				t.Fatal(err)
			}
			if g.Tasks[0].State != tc.want {
				t.Fatalf("claude child spawned %s ago, shell %s: want %s, got %s", tc.age, tc.status, tc.want, g.Tasks[0].State)
			}
		})
	}
}

// A child spawned moments ago that has not written yet is simply starting up, not dead.
func TestScheduleOnceLeavesFreshSpawnRunning(t *testing.T) {
	allowWorkerHarnessForTest(t)
	ctx := context.Background()
	oldRoot := sessionsRootFor
	sessionsRootFor = func(string) string { return t.TempDir() }
	defer func() { sessionsRootFor = oldRoot }()

	ch, err := wstore.CreateChannel(ctx, "fresh-spawn", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	owner := jarvis.NewRun("owner", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Orchestrator, jarvis.DefaultOrchestratorPlaybook(), 1)
	if err := wstore.AppendRun(ctx, ch.OID, owner); err != nil {
		t.Fatal(err)
	}
	g, err := NewTaskGroup(owner.ID, ch.OID, "g", 1, false, []waveobj.TaskNode{{ID: "t-0", Label: "a"}}, 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := wstore.AppendDag(ctx, &g); err != nil {
		t.Fatal(err)
	}
	child := jarvis.NewRun("child", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Quick, jarvis.QuickPlaybook(), time.Now().UnixMilli())
	child.ID = "ffffffff-ffff-4fff-8fff-ffffffffffff"
	child.Runtime = "pi"
	child.DagORef = g.OID
	child.SessionId = liveSession
	if err := wstore.AppendRun(ctx, ch.OID, child); err != nil {
		t.Fatal(err)
	}
	g.Tasks[0].RunID = child.ID
	g.Tasks[0].State = TaskState_Running
	g.Tasks[0].LastActivity = 0
	if err := wstore.UpdateDag(ctx, g.OID, func(cur *waveobj.TaskGroup) error {
		*cur = g
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	if err := ScheduleOnce(ctx, &g); err != nil {
		t.Fatal(err)
	}
	if g.Tasks[0].State != TaskState_Running {
		t.Fatalf("a just-spawned child must stay running, got %s", g.Tasks[0].State)
	}
}

// An agy worker is spawned with no session id and learns one at its first hook. One that is alive but never
// got that far (onboarding, signed out) writes nothing and binds nothing, so only the first-token deadline
// can name it: unbound, it stalls once the deadline has passed since spawn, and not before.
func TestAgyFirstTokenStall(t *testing.T) {
	allowWorkerHarnessForTest(t)
	newFakeLead(t)
	ctx := context.Background()
	stubSessionsRoot(t, t.TempDir())

	for _, tc := range []struct {
		name string
		age  time.Duration
		want string
	}{
		{name: "before the deadline", age: FirstTokenDeadline - time.Minute, want: TaskState_Running},
		{name: "past the deadline", age: FirstTokenDeadline + time.Minute, want: TaskState_Stalled},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ch, err := wstore.CreateChannel(ctx, "agy-first-token-"+tc.age.String(), t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			owner := jarvis.NewRun("owner", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Orchestrator, jarvis.DefaultOrchestratorPlaybook(), 1)
			if err := wstore.AppendRun(ctx, ch.OID, owner); err != nil {
				t.Fatal(err)
			}
			g, err := NewTaskGroup(owner.ID, ch.OID, "g", 1, false, []waveobj.TaskNode{{ID: "t-0", Label: "a"}}, 1, nil)
			if err != nil {
				t.Fatal(err)
			}
			if err := wstore.AppendDag(ctx, &g); err != nil {
				t.Fatal(err)
			}
			spawnedTs := time.Now().Add(-tc.age).UnixMilli()
			child := jarvis.NewRun("child", "ws-1", ch.ProjectPath, nil, jarvis.RunMode_Quick, jarvis.QuickPlaybook(), spawnedTs)
			child.Runtime = "agy"
			child.DagORef = g.OID // no SessionId: agy has not reported one
			if err := wstore.AppendRun(ctx, ch.OID, child); err != nil {
				t.Fatal(err)
			}
			g.Tasks[0].RunID = child.ID
			g.Tasks[0].State = TaskState_Running
			g.Tasks[0].LastActivity = spawnedTs
			if err := wstore.UpdateDag(ctx, g.OID, func(cur *waveobj.TaskGroup) error {
				*cur = g
				return nil
			}); err != nil {
				t.Fatal(err)
			}
			if err := ScheduleOnce(ctx, &g); err != nil {
				t.Fatal(err)
			}
			if g.Tasks[0].State != tc.want {
				t.Fatalf("an unbound agy child silent for %s: want %s, got %s", tc.age, tc.want, g.Tasks[0].State)
			}
		})
	}
}
