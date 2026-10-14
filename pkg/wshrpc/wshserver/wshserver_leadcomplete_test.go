// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/orchestrate"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

type leadCompleteFixture struct {
	projectDir string
	channelId  string
	owner      waveobj.Run
	child      waveobj.Run
	seal       func()
}

func gitIn(t *testing.T, dir string, args ...string) string {
	t.Helper()
	out, err := exec.Command("git", append([]string{"-C", dir}, args...)...).CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
	return strings.TrimSpace(string(out))
}

func (f *leadCompleteFixture) git(t *testing.T, args ...string) string {
	t.Helper()
	return gitIn(t, f.projectDir, args...)
}

func (f *leadCompleteFixture) write(t *testing.T, rel, content string) {
	t.Helper()
	path := filepath.Join(f.projectDir, rel)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

// landingTree gives the owner run its landing tree, with a commit on wave/<run> that changes base.txt. A conflict
// changes base.txt on main too, so merging main into the branch stops.
func (f *leadCompleteFixture) landingTree(t *testing.T, conflict bool) string {
	t.Helper()
	ctx := context.Background()
	tree, err := orchestrate.CreateRunWorktree(ctx, f.projectDir, f.owner.ID, f.git(t, "rev-parse", "HEAD"))
	if err != nil {
		t.Fatal(err)
	}
	if err := wstore.UpdateRun(ctx, f.channelId, f.owner.ID, func(r *waveobj.Run) error {
		r.LandPath, r.BaseBranch = tree, "main"
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(tree, "base.txt"), []byte("branch\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if out, err := exec.Command("git", "-C", tree, "commit", "-am", "branch").CombinedOutput(); err != nil {
		t.Fatalf("committing on the branch: %v\n%s", err, out)
	}
	if conflict {
		f.write(t, "base.txt", "main\n")
		f.git(t, "commit", "-m", "main", "--", "base.txt")
	}
	return tree
}

// a plan-driven run whose task landed through the engine's merge, with the untracked recovery patch a
// cancelled earlier attempt left in the project tree
func newLeadCompleteFixture(t *testing.T) *leadCompleteFixture {
	ctx := context.Background()
	f := &leadCompleteFixture{projectDir: t.TempDir()}
	useTestWorktreeRoot(t)
	f.git(t, "init", "-b", "main")
	f.git(t, "config", "user.email", "t@test")
	f.git(t, "config", "user.name", "t")
	f.write(t, "base.txt", "base\n")
	f.git(t, "add", ".")
	f.git(t, "commit", "-m", "base")
	base := f.git(t, "rev-parse", "HEAD")

	ch, err := wstore.CreateChannel(ctx, "lead-complete", f.projectDir)
	if err != nil {
		t.Fatal(err)
	}
	f.channelId = ch.OID
	f.owner = jarvis.NewRun("ship it", "ws-1", f.projectDir, nil, jarvis.RunMode_Orchestrator, jarvis.DefaultOrchestratorPlaybook(), 1)
	f.owner.BaseCommit = base
	f.child = jarvis.NewRun("task 1", "ws-1", f.projectDir, nil, jarvis.RunMode_Quick, jarvis.QuickPlaybook(), 1)
	f.child.BaseCommit = base
	dag, err := orchestrate.NewTaskGroup(f.owner.ID, ch.OID, "g", 1, true, []waveobj.TaskNode{{ID: "t-1", Label: "task 1"}}, 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	f.owner.DagORef, f.child.DagORef = dag.OID, dag.OID
	for _, r := range []waveobj.Run{f.owner, f.child} {
		if err := wstore.AppendRun(ctx, ch.OID, r); err != nil {
			t.Fatal(err)
		}
	}
	if err := wstore.AppendDag(ctx, &dag); err != nil {
		t.Fatal(err)
	}

	f.write(t, "t-1.txt", "hello\n")
	f.git(t, "add", ".")
	f.git(t, "commit", "-m", "run t-1: task 1", "-m", jarvis.RunTrailerKey+": "+f.owner.ID+"-t-1")
	f.write(t, ".waveterm/recovery/earlier-attempt-t-1.patch", "")

	origSeal, origCapture := sealAsync, captureAsync
	sealAsync = func(fn func()) { f.seal = fn }
	captureAsync = func(func()) {}
	t.Cleanup(func() { sealAsync, captureAsync = origSeal, origCapture })
	return f
}

func (f *leadCompleteFixture) complete(t *testing.T, runId string) *waveobj.Run {
	t.Helper()
	ctx := context.Background()
	if err := (&WshServer{}).AdvanceRunCommand(ctx, wshrpc.CommandAdvanceRunData{
		ChannelId: f.channelId, RunId: runId, PhaseIdx: 0, Action: jarvis.RunAction_Complete,
	}); err != nil {
		t.Fatalf("AdvanceRunCommand: %v", err)
	}
	run, err := wstore.GetRun(ctx, f.channelId, runId)
	if err != nil {
		t.Fatal(err)
	}
	return run
}

// the lead's rules end the run with a bare `wsh jarvis complete`: every task landed through the engine's
// merges, so the project head is the run's work, as it is for a run the engine closes with no lead.
// Without it the seal diffed the working tree and counted the engine's own .waveterm files.
func TestLeadCompletingItsPlanRunRecordsTheProjectHead(t *testing.T) {
	f := newLeadCompleteFixture(t)
	run := f.complete(t, f.owner.ID)
	if head := f.git(t, "rev-parse", "HEAD"); run.EndCommit != head {
		t.Fatalf("EndCommit = %q, want the project head %s", run.EndCommit, head)
	}
	if f.seal == nil {
		t.Fatal("completing the run dispatched no evidence seal")
	}
	f.seal()
	sealed, err := wstore.GetRun(context.Background(), f.channelId, f.owner.ID)
	if err != nil || sealed.Evidence == nil {
		t.Fatalf("evidence not sealed: %v", err)
	}
	var files []string
	for _, ef := range sealed.Evidence.Files {
		files = append(files, ef.Path)
	}
	if len(files) != 1 || files[0] != "t-1.txt" {
		t.Fatalf("sealed files = %v, want only the landed t-1.txt", files)
	}
}

// a task's worker completes in its own worktree and reports its commit itself; the project head is not its
// work, and the engine records the lane's merge commit on it later
func TestATaskCompletingWithoutACommitGetsNoProjectHead(t *testing.T) {
	f := newLeadCompleteFixture(t)
	if run := f.complete(t, f.child.ID); run.EndCommit != "" {
		t.Fatalf("a task run must not be credited with the project head, got %q", run.EndCommit)
	}
}

// run a088e568: the lead completed, its tab closed, and only then did the land hold on a conflict with main
func TestLeadCompleteRefusesALandThatWouldConflict(t *testing.T) {
	setup := func(t *testing.T, conflict bool) *leadCompleteFixture {
		t.Helper()
		f := newLeadCompleteFixture(t)
		f.landingTree(t, conflict)
		return f
	}
	advance := func(f *leadCompleteFixture, holdLand bool) error {
		return (&WshServer{}).AdvanceRunCommand(context.Background(), wshrpc.CommandAdvanceRunData{
			ChannelId: f.channelId, RunId: f.owner.ID, PhaseIdx: 0, Action: jarvis.RunAction_Complete, HoldLand: holdLand,
		})
	}

	t.Run("a conflict is refused, naming its files and the way out", func(t *testing.T) {
		f := setup(t, true)
		err := advance(f, false)
		if err == nil || !strings.Contains(err.Error(), "base.txt") || !strings.Contains(err.Error(), "--hold-land") {
			t.Fatalf("complete = %v, want a refusal naming base.txt and --hold-land", err)
		}
		if run, _ := wstore.GetRun(context.Background(), f.channelId, f.owner.ID); run.Status == jarvis.RunStatus_Done {
			t.Fatal("a refused complete still finished the run")
		}
	})
	t.Run("--hold-land completes anyway", func(t *testing.T) {
		f := setup(t, true)
		if err := advance(f, true); err != nil {
			t.Fatalf("complete --hold-land: %v", err)
		}
		if run, _ := wstore.GetRun(context.Background(), f.channelId, f.owner.ID); run.Status != jarvis.RunStatus_Done {
			t.Fatalf("run is %s, want done", run.Status)
		}
	})
	t.Run("a clean land completes", func(t *testing.T) {
		f := setup(t, false)
		if err := advance(f, false); err != nil {
			t.Fatalf("complete: %v", err)
		}
	})
}

// the land runs after complete has closed the lead's tab, so the human's "land anyway" has to ride on complete
func TestLeadCompleteCarriesTheForceLandToTheLand(t *testing.T) {
	for _, force := range []bool{false, true} {
		f := newLeadCompleteFixture(t)
		got, calls := false, 0
		orig := landRun
		landRun = func(_ context.Context, _, _ string, force bool) (*waveobj.RunLand, error) {
			got, calls = force, calls+1
			return nil, nil
		}
		t.Cleanup(func() { landRun = orig })
		if err := (&WshServer{}).AdvanceRunCommand(context.Background(), wshrpc.CommandAdvanceRunData{
			ChannelId: f.channelId, RunId: f.owner.ID, PhaseIdx: 0, Action: jarvis.RunAction_Complete, ForceLand: force,
		}); err != nil {
			t.Fatalf("AdvanceRunCommand: %v", err)
		}
		if f.seal == nil {
			t.Fatal("completing the run dispatched no seal and land")
		}
		f.seal()
		if calls != 1 || got != force {
			t.Fatalf("land called %d times with force=%v, want once with force=%v", calls, got, force)
		}
	}
}

// run 1409ee43: the land held after the lead's complete had returned, so the lead's report never said so and
// nobody saw the hold. A lead's complete now waits on the land and returns where it stands.
func TestLeadCompleteReportsTheLandItWaitedOn(t *testing.T) {
	cases := []struct {
		name string
		land *waveobj.RunLand
	}{
		{"held", &waveobj.RunLand{State: orchestrate.LandState_Held, Reason: "the checkout has unstaged edits to files the run changes: scenarios.mjs", Dirty: true}},
		{"landed", &waveobj.RunLand{State: orchestrate.LandState_Landed, Commit: "9910d928b72a3607e8b2a24e06460d097a551a9e"}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			f := newLeadCompleteFixture(t)
			tab := waveobj.MakeORef(waveobj.OType_Tab, uuid.NewString()).String()
			if err := wstore.UpdateRun(context.Background(), f.channelId, f.owner.ID, func(r *waveobj.Run) error {
				r.LandPath = f.projectDir
				r.Phases[0].WorkerOrefs = []string{tab}
				return nil
			}); err != nil {
				t.Fatal(err)
			}
			calls := 0
			orig := landRun
			landRun = func(_ context.Context, _, runId string, _ bool) (*waveobj.RunLand, error) {
				calls++
				if runId != f.owner.ID {
					t.Errorf("landed run %s, want %s", runId, f.owner.ID)
				}
				return c.land, nil
			}
			t.Cleanup(func() { landRun = orig })

			rtn, err := (&WshServer{}).ReportRunPhaseCommand(context.Background(), wshrpc.CommandReportRunPhaseData{ORef: tab, Action: jarvis.RunAction_Complete})
			if err != nil {
				t.Fatalf("ReportRunPhaseCommand: %v", err)
			}
			if f.seal != nil {
				t.Fatal("the lead's land was dispatched off the complete instead of waited on")
			}
			if calls != 1 || rtn == nil || !reflect.DeepEqual(rtn.Land, c.land) || rtn.LandError != "" {
				t.Fatalf("land called %d times, complete returned %+v, want the land %+v", calls, rtn, c.land)
			}
		})
	}
}

// a task's worker lands through the engine's merge: its complete returns at once, with the seal left off-band for
// its reviewer
func TestWorkerCompleteDoesNotWaitOnALand(t *testing.T) {
	f := newLeadCompleteFixture(t)
	tab := waveobj.MakeORef(waveobj.OType_Tab, uuid.NewString()).String()
	if err := wstore.UpdateRun(context.Background(), f.channelId, f.child.ID, func(r *waveobj.Run) error {
		r.TaskId = "t-1"
		r.Review = true // a reviewer needs no worker report
		r.Phases[0].WorkerOrefs = []string{tab}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	rtn, err := (&WshServer{}).ReportRunPhaseCommand(context.Background(), wshrpc.CommandReportRunPhaseData{ORef: tab, Action: jarvis.RunAction_Complete})
	if err != nil {
		t.Fatalf("ReportRunPhaseCommand: %v", err)
	}
	if rtn != nil {
		t.Fatalf("complete returned %+v, want no land", rtn)
	}
	if f.seal == nil {
		t.Fatal("the worker's seal was not dispatched")
	}
}

// run 1409ee43 landed by hand with `wsh runs land` as "Shared Surface Toolbar": the human's land, from the CLI or
// the cockpit, goes through LandRunCommand and gets the same conventional subject as the engine's own land
func TestAManualLandGetsAConventionalSubject(t *testing.T) {
	ctx := context.Background()
	f := newLeadCompleteFixture(t)
	base := f.git(t, "rev-parse", "HEAD")
	tree, err := orchestrate.CreateRunWorktree(ctx, f.projectDir, f.owner.ID, base)
	if err != nil {
		t.Fatal(err)
	}
	for _, args := range [][]string{
		{"commit", "--allow-empty", "-m", "feat(cockpit): add SurfaceToolbar"},
		{"commit", "--allow-empty", "-m", "docs: spec and plan for Shared Surface Toolbar"},
	} {
		if out, err := exec.Command("git", append([]string{"-C", tree}, args...)...).CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}
	head, err := exec.Command("git", "-C", tree, "rev-parse", "HEAD").Output()
	if err != nil {
		t.Fatal(err)
	}
	if err := wstore.UpdateRun(ctx, f.channelId, f.owner.ID, func(r *waveobj.Run) error {
		r.LandPath, r.BaseBranch, r.Status = tree, "main", jarvis.RunStatus_Done
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := wstore.UpdateDag(ctx, f.owner.DagORef, func(g *waveobj.TaskGroup) error {
		g.Title = "Shared Surface Toolbar Implementation Plan"
		g.Final = &waveobj.FinalStage{State: orchestrate.FinalState_Passed, Round: 1, Commit: strings.TrimSpace(string(head))}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	// the engine's recovery patch is untracked in the checkout and would not stop a land
	f.git(t, "clean", "-fdq")

	land, err := (&WshServer{}).LandRunCommand(ctx, wshrpc.CommandLandRunData{ChannelId: f.channelId, RunId: f.owner.ID})
	if err != nil || land.State != orchestrate.LandState_Landed {
		t.Fatalf("land = %+v, %v, want landed", land, err)
	}
	if got := f.git(t, "log", "-1", "--format=%s"); got != "feat(cockpit): Shared Surface Toolbar" {
		t.Fatalf("merge subject %q, want the conventional feat(cockpit): Shared Surface Toolbar", got)
	}
}

// landResolverFixture is a done plan run whose land is resolving: main moved on with a change that conflicts with the
// run's own, and the resolver's stage run is seeded as the engine's spawn leaves it (the dag, a stage role, the landing
// tree as its directory, the branch head it started from, no task and no lead). The resolver has merged main into
// wave/<run> as its prompt tells it to, and has yet to complete.
type landResolverFixture struct {
	*leadCompleteFixture
	tree, tab string
	resolver  waveobj.Run
	land      *waveobj.RunLand
}

func newLandResolverFixture(t *testing.T) *landResolverFixture {
	t.Helper()
	ctx := context.Background()
	f := &landResolverFixture{leadCompleteFixture: newLeadCompleteFixture(t)}
	f.tree = f.landingTree(t, true)
	f.tab = waveobj.MakeORef(waveobj.OType_Tab, uuid.NewString()).String()
	f.resolver = jarvis.NewRun("resolve main into wave/"+f.owner.ID, "ws-1", f.tree, nil, jarvis.RunMode_Quick, jarvis.QuickPlaybook(), 1)
	f.resolver.Runtime, f.resolver.SessionId = "claude", jarvis.WorkerSessionId("claude")
	f.resolver.DagORef, f.resolver.StageRole = f.owner.DagORef, jarvis.UsageRole_LandResolver
	f.resolver.BaseCommit = gitIn(t, f.tree, "rev-parse", "HEAD")
	f.resolver.Phases[0].WorkerOrefs = []string{f.tab}
	if err := wstore.AppendRun(ctx, f.channelId, f.resolver); err != nil {
		t.Fatal(err)
	}
	f.land = &waveobj.RunLand{State: orchestrate.LandState_Resolving, Resolver: f.resolver.ID, ResolverTs: time.Now().UnixMilli(), ResolverTried: true, Conflicts: []string{"base.txt"}, QueuedTs: 10, Force: true}
	if err := wstore.UpdateRun(ctx, f.channelId, f.owner.ID, func(r *waveobj.Run) error {
		r.Status, r.Land = jarvis.RunStatus_Done, f.land
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	// the store outlives the test, and the land driver tends and lands every resolving or queued land it finds
	t.Cleanup(func() {
		_ = wstore.UpdateRun(ctx, f.channelId, f.owner.ID, func(r *waveobj.Run) error {
			r.Land = &waveobj.RunLand{State: orchestrate.LandState_Held, Reason: "the test is over"}
			return nil
		})
	})
	return f
}

// mergeMain does what the resolver's prompt tells it to: merge main into the branch, settle the conflict, commit.
func (f *landResolverFixture) mergeMain(t *testing.T) {
	t.Helper()
	// the merge stops on the conflict, which is its exit status
	_ = exec.Command("git", "-C", f.tree, "merge", "--no-commit", "--no-ff", "main").Run()
	if err := os.WriteFile(filepath.Join(f.tree, "base.txt"), []byte("branch\nmain\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	gitIn(t, f.tree, "add", "--", "base.txt")
	gitIn(t, f.tree, "commit", "-m", "Merge branch 'main' into wave/"+f.owner.ID, "-m", "Arc-Run: "+f.owner.ID)
}

func (f *landResolverFixture) run(t *testing.T, id string) *waveobj.Run {
	t.Helper()
	run, err := wstore.GetRun(context.Background(), f.channelId, id)
	if err != nil {
		t.Fatal(err)
	}
	return run
}

// a resolver ends with `wsh jarvis complete --report`: the complete of a stage run of a done plan run's dag, which has
// no task and no lead and works in that run's landing tree. It must neither be refused as the owner's complete would
// (a conflict with main), nor be given the owner's head commit, nor seal or land as the owner; the owner's land stays
// resolving until the land driver tends it, and then goes back in line with the place and the force it asked with.
func TestAResolverCompletingMovesItsLandOn(t *testing.T) {
	report := "base.txt: kept the branch's line and main's\n"
	// advanceRun is what both entry points reach: the RPC a script sends, and the report a session's tab sends
	entries := []struct {
		name     string
		complete func(t *testing.T, f *landResolverFixture)
	}{
		{"advanceRun", func(t *testing.T, f *landResolverFixture) {
			sealDue, err := advanceRun(context.Background(), wshrpc.CommandAdvanceRunData{
				ChannelId: f.channelId, RunId: f.resolver.ID, PhaseIdx: 0, Action: jarvis.RunAction_Complete, Report: report,
			})
			if err != nil {
				t.Fatalf("advanceRun: %v", err)
			}
			if !sealDue {
				t.Fatal("the resolver's complete owes no seal")
			}
			// what AdvanceRunCommand dispatches off the call
			if land, err := sealThenLand(f.channelId, f.resolver.ID, false); land != nil || err != nil {
				t.Fatalf("the resolver's seal and land returned %+v, %v, want neither: a stage run has no branch to land", land, err)
			}
		}},
		{"the session's own complete", func(t *testing.T, f *landResolverFixture) {
			rtn, err := (&WshServer{}).ReportRunPhaseCommand(context.Background(), wshrpc.CommandReportRunPhaseData{ORef: f.tab, Action: jarvis.RunAction_Complete, Report: report})
			if err != nil || rtn != nil {
				t.Fatalf("ReportRunPhaseCommand = %+v, %v, want a plain complete: a stage run's land is not waited on", rtn, err)
			}
			if f.seal == nil {
				t.Fatal("the resolver's seal was not dispatched")
			}
			f.seal()
		}},
	}
	for _, e := range entries {
		t.Run(e.name, func(t *testing.T) {
			ctx := context.Background()
			f := newLandResolverFixture(t)

			f.mergeMain(t)
			orchestrate.TendResolvingLandsForTest(ctx)
			if got := f.run(t, f.owner.ID).Land; !reflect.DeepEqual(got, f.land) {
				t.Fatalf("a tend pass moved the land to %+v while its resolver still worked", got)
			}

			e.complete(t, f)

			resolver := f.run(t, f.resolver.ID)
			if resolver.Status != jarvis.RunStatus_Done || resolver.Report != report {
				t.Fatalf("resolver run = %s with report %q, want done with its report", resolver.Status, resolver.Report)
			}
			if resolver.Land != nil || resolver.EndCommit != "" {
				t.Fatalf("resolver run has land %+v and end commit %q: it was taken for the plan run", resolver.Land, resolver.EndCommit)
			}
			if ev := resolver.Evidence; ev == nil || ev.Dag != nil || ev.Verification != nil {
				t.Fatalf("resolver evidence = %+v, want sealed without the plan run's record or verification", ev)
			}
			owner := f.run(t, f.owner.ID)
			if !reflect.DeepEqual(owner.Land, f.land) || owner.Status != jarvis.RunStatus_Done || owner.Evidence != nil || owner.EndCommit != "" {
				t.Fatalf("plan run = %s, land %+v, evidence %v, end commit %q after the resolver's complete, want it untouched", owner.Status, owner.Land, owner.Evidence, owner.EndCommit)
			}
			landKinds := []string{waveobj.RunEventKindLandQueued, waveobj.RunEventKindLandHeld, waveobj.RunEventKindLanded}
			if events, err := wstore.QueryRunEventsByKind(ctx, f.channelId, f.owner.ID, landKinds, 0); err != nil || len(events) != 0 {
				t.Fatalf("the plan run logged %d land events (%v) from the resolver's complete, want none", len(events), err)
			}

			orchestrate.TendResolvingLandsForTest(ctx)
			land := f.run(t, f.owner.ID).Land
			if land == nil || land.State != orchestrate.LandState_Queued || land.QueuedTs != f.land.QueuedTs || land.Force != f.land.Force || !land.ResolverTried {
				t.Fatalf("land = %+v after a tend pass, want queued at place %d with its force and its resolver's try kept", land, f.land.QueuedTs)
			}
		})
	}
}
