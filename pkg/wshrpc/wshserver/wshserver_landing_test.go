// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/harness"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/orchestrate"
	"github.com/wavetermdev/waveterm/pkg/runroute"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// newLandingRepo is a git project with one commit on main.
func newLandingRepo(t *testing.T) (string, func(args ...string) string) {
	t.Helper()
	// resolved: on macOS the temp dir is under /var, a link to /private/var, and git prints the resolved path
	dir, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	execGit := func(args ...string) string {
		t.Helper()
		out, err := exec.Command("git", append([]string{"-C", dir}, args...)...).CombinedOutput()
		if err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
		return strings.TrimSpace(string(out))
	}
	execGit("init", "-b", "main")
	execGit("config", "user.email", "t@test")
	execGit("config", "user.name", "t")
	if err := os.WriteFile(filepath.Join(dir, "base.txt"), []byte("base\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	execGit("add", ".")
	execGit("commit", "-m", "base")
	return dir, execGit
}

// a lead's bare `wsh jarvis complete` records the landing branch's tip, not the checkout's head, which is
// the human's work
func TestLeadCompletingABranchRunRecordsTheLandingTip(t *testing.T) {
	f := newLeadCompleteFixture(t)
	ctx := context.Background()
	tree, err := orchestrate.CreateRunWorktree(ctx, f.projectDir, f.owner.ID, "")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(tree, "landed.txt"), []byte("lane\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	f.git(t, "-C", tree, "add", "landed.txt")
	f.git(t, "-C", tree, "commit", "-m", "run t-1: landed")
	if err := wstore.UpdateRun(ctx, f.channelId, f.owner.ID, func(r *waveobj.Run) error {
		r.LandPath = tree
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	run := f.complete(t, f.owner.ID)
	if tip := f.git(t, "rev-parse", "wave/"+f.owner.ID); run.EndCommit != tip {
		t.Fatalf("EndCommit = %q, want the landing tip %s", run.EndCommit, tip)
	}
}

// writeProjectSetup checks body in as dir's .arc/setup.
func writeProjectSetup(t *testing.T, dir, body string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Join(dir, ".arc"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, ".arc", "setup"), []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestDagSubmitRunsSetupInTheLandingTree(t *testing.T) {
	ctx := context.Background()
	// newRun returns the run's project, a submit of the plan whose Setup is setup (no Setup line when empty) in
	// the given context, and a read of the dag that submit stored
	newRun := func(t *testing.T, landPath, setup string) (string, func(context.Context) error, func() *waveobj.TaskGroup) {
		t.Helper()
		ch, err := wstore.CreateChannel(ctx, "landing-setup", t.TempDir())
		if err != nil {
			t.Fatal(err)
		}
		run := jarvis.NewRun("g", "ws", ch.ProjectPath, nil, jarvis.RunMode_Orchestrator, jarvis.DefaultOrchestratorPlaybook(), 1)
		run.Status = jarvis.RunStatus_Planning
		run.LandPath = landPath
		if err := wstore.AppendRun(ctx, ch.OID, run); err != nil {
			t.Fatal(err)
		}
		// a branch-landed submit commits its plan in the landing tree, so the plan is written there
		planDir := t.TempDir()
		if landPath != "" {
			planDir = landPath
		}
		plan := filepath.Join(planDir, "plan.md")
		body := "### Task 1: input\n"
		if setup != "" {
			body = "**Setup:** `" + setup + "`\n\n" + body
		}
		if err := os.WriteFile(plan, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
		do := func(c context.Context) error {
			_, err := (&WshServer{}).DagSubmitCommand(c, wshrpc.CommandDagSubmitData{ChannelId: ch.OID, RunId: run.ID, PlanPath: plan})
			return err
		}
		dag := func() *waveobj.TaskGroup {
			t.Helper()
			stored, err := wstore.GetRun(ctx, ch.OID, run.ID)
			if err != nil {
				t.Fatal(err)
			}
			g, err := wstore.GetDag(ctx, stored.DagORef)
			if err != nil {
				t.Fatal(err)
			}
			return g
		}
		return ch.ProjectPath, do, dag
	}
	submit := func(t *testing.T, landPath, setup string) (string, error) {
		t.Helper()
		project, do, _ := newRun(t, landPath, setup)
		return project, do(ctx)
	}
	// c84aa179: a plan with no Setup line left the landing tree without node_modules
	t.Run("a plan with no Setup line runs the project's default", func(t *testing.T) {
		tree, _ := newLandingRepo(t)
		writeProjectSetup(t, tree, "echo ok > default.txt")
		_, do, dag := newRun(t, tree, "")
		if err := do(ctx); err != nil {
			t.Fatalf("submit: %v", err)
		}
		if _, err := os.Stat(filepath.Join(tree, "default.txt")); err != nil {
			t.Fatalf("the default Setup did not run in the landing tree: %v", err)
		}
		// and the dag carries it, so worker, bisect, base-check and final trees run it too
		if g := dag(); g.Setup != "echo ok > default.txt" {
			t.Fatalf("dag Setup = %q, want the project default", g.Setup)
		}
	})

	t.Run("the plan's Setup line wins over the project default", func(t *testing.T) {
		tree, _ := newLandingRepo(t)
		writeProjectSetup(t, tree, "echo ok > default.txt")
		_, do, dag := newRun(t, tree, "echo ok > plan.txt")
		if err := do(ctx); err != nil {
			t.Fatalf("submit: %v", err)
		}
		if _, err := os.Stat(filepath.Join(tree, "plan.txt")); err != nil {
			t.Fatalf("the plan's Setup did not run: %v", err)
		}
		if _, err := os.Stat(filepath.Join(tree, "default.txt")); err == nil {
			t.Fatal("the project default ran although the plan names a Setup")
		}
		if g := dag(); g.Setup != "echo ok > plan.txt" {
			t.Fatalf("dag Setup = %q, want the plan's", g.Setup)
		}
	})

	t.Run("a malformed default fails the submit", func(t *testing.T) {
		tree, _ := newLandingRepo(t)
		writeProjectSetup(t, tree, "a\nb\n")
		_, do, _ := newRun(t, tree, "")
		if err := do(ctx); err == nil || !strings.Contains(err.Error(), "must hold one command") {
			t.Fatalf("submit err = %v, want the one-command refusal", err)
		}
	})

	// a lead's `dag submit` carries a short RPC deadline; a Setup such as a fresh install outlives it
	t.Run("setup is not bound by the submit's deadline", func(t *testing.T) {
		tree, _ := newLandingRepo(t)
		_, do, _ := newRun(t, tree, "sleep 2 && echo ok > prepared.txt")
		short, cancel := context.WithTimeout(ctx, 500*time.Millisecond)
		defer cancel()
		if err := do(short); err != nil {
			t.Fatalf("submit: %v", err)
		}
		if _, err := os.Stat(filepath.Join(tree, "prepared.txt")); err != nil {
			t.Fatalf("setup did not finish: %v", err)
		}
	})

	// a resubmit after a client timeout finds the dag stored and merges possibly running in the tree
	t.Run("a resubmit does not run setup again", func(t *testing.T) {
		tree, _ := newLandingRepo(t)
		_, do, _ := newRun(t, tree, "echo run >> setup.log")
		if err := do(ctx); err != nil {
			t.Fatal(err)
		}
		_ = do(ctx)
		out, err := os.ReadFile(filepath.Join(tree, "setup.log"))
		if err != nil {
			t.Fatal(err)
		}
		if n := strings.Count(string(out), "run"); n != 1 {
			t.Fatalf("setup ran %d times, want once", n)
		}
	})

	t.Run("setup prepares the landing tree, not the checkout", func(t *testing.T) {
		tree, _ := newLandingRepo(t)
		project, err := submit(t, tree, "echo ok > prepared.txt")
		if err != nil {
			t.Fatal(err)
		}
		if _, err := os.Stat(filepath.Join(tree, "prepared.txt")); err != nil {
			t.Fatalf("setup did not run in the landing tree: %v", err)
		}
		if _, err := os.Stat(filepath.Join(project, "prepared.txt")); err == nil {
			t.Fatal("setup ran in the project checkout")
		}
	})

	t.Run("a failing setup refuses the submit", func(t *testing.T) {
		if _, err := submit(t, t.TempDir(), "exit 3"); err == nil || !strings.Contains(err.Error(), "setup") {
			t.Fatalf("error %v should refuse the submit over setup", err)
		}
	})

	t.Run("a run landing in the checkout runs no setup at submit", func(t *testing.T) {
		project, err := submit(t, "", "echo ok > prepared.txt")
		if err != nil {
			t.Fatal(err)
		}
		if _, err := os.Stat(filepath.Join(project, "prepared.txt")); err == nil {
			t.Fatal("setup ran at submit for a run with no landing tree")
		}
	})
}

// a branch-landed submit commits the spec and plan on the run's branch before any lane is cut, and keeps
// their repo-relative paths; a retried submit with the same docs commits nothing and still succeeds
// a plan started from + Run or `wsh runs start --plan` passes no --spec: the plan's own **Spec:** line names it
func TestDagSubmitTakesTheSpecFromThePlansSpecLine(t *testing.T) {
	ctx := context.Background()
	projectDir, execGit := newLandingRepo(t)
	ch, err := wstore.CreateChannel(ctx, "landing-plan-spec", projectDir)
	if err != nil {
		t.Fatal(err)
	}
	newRun := func() waveobj.Run {
		run := jarvis.NewRun("g", "ws", projectDir, nil, jarvis.RunMode_Orchestrator, jarvis.DefaultOrchestratorPlaybook(), 1)
		run.Status = jarvis.RunStatus_Planning
		tree, err := orchestrate.CreateRunWorktree(ctx, projectDir, run.ID, "")
		if err != nil {
			t.Fatal(err)
		}
		run.LandPath = tree
		if err := wstore.AppendRun(ctx, ch.OID, run); err != nil {
			t.Fatal(err)
		}
		return run
	}
	write := func(path, text string) {
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(text), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write(filepath.Join(projectDir, "docs", "specs", "coupons.md"), "# spec\n")
	plan := filepath.Join(projectDir, "docs", "plans", "coupons.md")
	write(plan, "# Coupons\n\n**Spec:** `docs/specs/coupons.md` — read it first.\n\n### Task 1: input\n")

	run := newRun()
	g, err := (&WshServer{}).DagSubmitCommand(ctx, wshrpc.CommandDagSubmitData{ChannelId: ch.OID, RunId: run.ID, PlanPath: plan})
	if err != nil {
		t.Fatal(err)
	}
	if g.SpecPath != "docs/specs/coupons.md" {
		t.Fatalf("specpath %q; want the plan's Spec line, repo-relative", g.SpecPath)
	}
	if got := execGit("show", "wave/"+run.ID+":docs/specs/coupons.md"); got != "# spec" {
		t.Fatalf("the branch holds spec %q", got)
	}

	// a Spec line naming no file is prose: the plan still runs, without a spec
	write(plan, "# Coupons\n\n**Spec:** `docs/specs/missing.md`\n\n### Task 1: input\n")
	run = newRun()
	g, err = (&WshServer{}).DagSubmitCommand(ctx, wshrpc.CommandDagSubmitData{ChannelId: ch.OID, RunId: run.ID, PlanPath: plan})
	if err != nil {
		t.Fatalf("a Spec line naming a missing file must not refuse the plan: %v", err)
	}
	if g.SpecPath != "" {
		t.Fatalf("specpath %q for a spec that does not exist", g.SpecPath)
	}
}

func TestDagSubmitCommitsTheSpecAndPlanOnTheRunsBranch(t *testing.T) {
	ctx := context.Background()
	projectDir, execGit := newLandingRepo(t)
	ch, err := wstore.CreateChannel(ctx, "landing-snapshot", projectDir)
	if err != nil {
		t.Fatal(err)
	}
	run := jarvis.NewRun("g", "ws", projectDir, nil, jarvis.RunMode_Orchestrator, jarvis.DefaultOrchestratorPlaybook(), 1)
	run.Status = jarvis.RunStatus_Planning
	tree, err := orchestrate.CreateRunWorktree(ctx, projectDir, run.ID, "")
	if err != nil {
		t.Fatal(err)
	}
	run.LandPath = tree
	if err := wstore.AppendRun(ctx, ch.OID, run); err != nil {
		t.Fatal(err)
	}
	// the spec in the project checkout, the plan in the landing tree where the lead wrote it
	spec := filepath.Join(projectDir, "docs", "specs", "coupons.md")
	plan := filepath.Join(tree, "docs", "plans", "coupons.md")
	for path, text := range map[string]string{spec: "# spec\n", plan: "# Coupons\n\n### Task 1: input\n"} {
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(text), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	submit := func() (*waveobj.TaskGroup, error) {
		return (&WshServer{}).DagSubmitCommand(ctx, wshrpc.CommandDagSubmitData{ChannelId: ch.OID, RunId: run.ID, PlanPath: plan, SpecPath: spec})
	}

	g, err := submit()
	if err != nil {
		t.Fatal(err)
	}
	if g.PlanPath != "docs/plans/coupons.md" || g.SpecPath != "docs/specs/coupons.md" {
		t.Fatalf("planpath %q, specpath %q; want repo-relative", g.PlanPath, g.SpecPath)
	}
	branch := "wave/" + run.ID
	if msg := execGit("log", "-1", "--format=%B", branch); !strings.HasPrefix(msg, "docs: spec and plan for ") || !strings.HasSuffix(msg, "Arc-Run: "+run.ID) {
		t.Fatalf("branch tip message = %q", msg)
	}
	if got := execGit("show", branch+":docs/specs/coupons.md"); got != "# spec" {
		t.Fatalf("the branch holds spec %q", got)
	}
	tip := execGit("rev-parse", branch)
	if _, err := submit(); err != nil {
		t.Fatalf("a retried submit with the same docs must succeed: %v", err)
	}
	if got := execGit("rev-parse", branch); got != tip {
		t.Fatalf("a retried submit moved the branch from %s to %s", tip, got)
	}
}

// a fix round's plan is committed on the run's branch like the run's own, but only once the round is accepted:
// the landing tree may be running the final stage
func TestDagSubmitRoundCommitsTheFixPlanOnTheRunsBranch(t *testing.T) {
	ctx := context.Background()
	projectDir, execGit := newLandingRepo(t)
	ch, err := wstore.CreateChannel(ctx, "landing-round", projectDir)
	if err != nil {
		t.Fatal(err)
	}
	run := jarvis.NewRun("g", "ws", projectDir, nil, jarvis.RunMode_Orchestrator, jarvis.DefaultOrchestratorPlaybook(), 1)
	run.Status = jarvis.RunStatus_Planning
	tree, err := orchestrate.CreateRunWorktree(ctx, projectDir, run.ID, "")
	if err != nil {
		t.Fatal(err)
	}
	run.LandPath = tree
	if err := wstore.AppendRun(ctx, ch.OID, run); err != nil {
		t.Fatal(err)
	}
	plan, fix := filepath.Join(tree, "docs", "plans", "board.md"), filepath.Join(tree, "docs", "plans", "board-fix.md")
	for path, text := range map[string]string{plan: "# Board\n\n### Task 1: layout\n", fix: "# Board fix\n\n### Task 1: widen\n"} {
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(text), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	submit := func(data wshrpc.CommandDagSubmitData) (*waveobj.TaskGroup, error) {
		data.ChannelId, data.RunId = ch.OID, run.ID
		return (&WshServer{}).DagSubmitCommand(ctx, data)
	}
	g, err := submit(wshrpc.CommandDagSubmitData{PlanPath: plan})
	if err != nil {
		t.Fatal(err)
	}
	branch := "wave/" + run.ID
	tip := execGit("rev-parse", branch)
	if _, err := submit(wshrpc.CommandDagSubmitData{PlanPath: fix, Round: true}); err == nil || !strings.Contains(err.Error(), "the final stage has not failed") {
		t.Fatalf("want the round refused, got %v", err)
	}
	if got := execGit("rev-parse", branch); got != tip {
		t.Fatalf("a refused round moved the branch from %s to %s", tip, got)
	}
	if err := wstore.UpdateDag(ctx, g.OID, func(cur *waveobj.TaskGroup) error {
		cur.Tasks[0].State, cur.Tasks[0].Merged = orchestrate.TaskState_Done, true
		cur.PlanReview = &waveobj.PlanReviewStage{State: orchestrate.PlanReviewState_Passed, Round: 1}
		cur.Final = &waveobj.FinalStage{State: orchestrate.FinalState_Failed, Round: 1, Detail: "FAIL"}
		orchestrate.RecomputeDagStatus(cur)
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	got, err := submit(wshrpc.CommandDagSubmitData{PlanPath: fix, Round: true})
	if err != nil {
		t.Fatal(err)
	}
	if msg := execGit("log", "-1", "--format=%B", branch); !strings.HasPrefix(msg, "docs: spec and plan for Board fix") || !strings.HasSuffix(msg, "Arc-Run: "+run.ID) {
		t.Fatalf("branch tip message = %q", msg)
	}
	if !strings.HasPrefix(got.Tasks[1].Description, "Fix round 2: this is task 1 of the fix plan at docs/plans/board-fix.md;") || got.PlanPath != "docs/plans/board.md" {
		t.Fatalf("the fix task names the repo-relative fix plan and the dag keeps its plan, got %q / %q", got.Tasks[1].Description, got.PlanPath)
	}
}

func createLandingRun(t *testing.T, ctx context.Context, projectDir, mode string, landing *string) (*waveobj.Channel, *waveobj.Run, error) {
	t.Helper()
	stubRunServer(t, "pi", nil)
	ch, err := wstore.CreateChannel(ctx, "landing", projectDir)
	if err != nil {
		t.Fatal(err)
	}
	if landing != nil {
		seedProfileMeta(t, ctx, ch.OID, &waveobj.ProfileOverride{Landing: landing})
	}
	rtn, err := (&WshServer{}).CreateRunCommand(ctx, wshrpc.CommandCreateRunData{
		ChannelId: ch.OID, WorkspaceId: "ws", Goal: "g", Runtime: "pi", Mode: mode, DeferStart: true,
	})
	if err != nil {
		return ch, nil, err
	}
	return ch, rtn.Run, nil
}

// newSetupPlanRun is a branch-landed channel on a fresh repository and a plan whose Setup line is setup
func newSetupPlanRun(t *testing.T, setup string) (ch *waveobj.Channel, projectDir, plan string, execGit func(args ...string) string) {
	t.Helper()
	ctx := context.Background()
	projectDir, execGit = newLandingRepo(t)
	stubRunServer(t, "pi", nil)
	ch, err := wstore.CreateChannel(ctx, "landing", projectDir)
	if err != nil {
		t.Fatal(err)
	}
	seedProfileMeta(t, ctx, ch.OID, &waveobj.ProfileOverride{Landing: strPtr(jarvis.Landing_Branch)})
	plan = filepath.Join(t.TempDir(), "plan.md")
	if err := os.WriteFile(plan, []byte("**Setup:** `"+setup+"`\n\n### Task 1: input\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	return ch, projectDir, plan, execGit
}

// stubLeadSpawn replaces the lead's spawn: it records the prompt, and fails when fail is set
func stubLeadSpawn(t *testing.T, fail error) *string {
	t.Helper()
	prompt := new(string)
	stubbed := jarvis.SpawnRunWorker
	jarvis.SpawnRunWorker = func(_ context.Context, _ runroute.Capability, _, _, _, p string, _ jarvis.RunWorkerOptions) (string, error) {
		*prompt = p
		if fail != nil {
			return "", fail
		}
		return waveobj.MakeORef(waveobj.OType_Tab, "lead-tab").String(), nil
	}
	t.Cleanup(func() { jarvis.SpawnRunWorker = stubbed })
	return prompt
}

func startPlanRun(ctx context.Context, ch *waveobj.Channel, plan string) (*wshrpc.CommandCreateRunRtnData, error) {
	return (&WshServer{}).CreateRunCommand(ctx, wshrpc.CommandCreateRunData{
		ChannelId: ch.OID, WorkspaceId: "ws", Goal: "g", Runtime: "pi", Mode: jarvis.RunMode_Orchestrator, PlanPath: plan,
	})
}

// assertRunTornDown checks the one run is cancelled, with its landing tree and branch gone: they would
// otherwise pile up with every retry
func assertRunTornDown(t *testing.T, ch *waveobj.Channel, projectDir string, execGit func(args ...string) string) {
	t.Helper()
	runs, err := wstore.GetChannelRuns(context.Background(), ch.OID)
	if err != nil || len(runs) != 1 {
		t.Fatalf("runs = %+v, %v; want the one cancelled run", runs, err)
	}
	if runs[0].Status != jarvis.RunStatus_Cancelled {
		t.Fatalf("status = %q, want cancelled", runs[0].Status)
	}
	if _, err := os.Stat(filepath.Join(projectDir, ".waveterm", "worktrees", runs[0].ID)); !os.IsNotExist(err) {
		t.Fatalf("the landing tree is still there: %v", err)
	}
	if branches := execGit("branch", "--list", "wave/*"); branches != "" {
		t.Fatalf("branches left behind: %q", branches)
	}
}

// a plan the engine refused leaves a cancelled run with no dag and no work. The refusal is a task pin the
// harness rejects once the run exists, the one refusal that lands only after the landing tree is made.
func TestCreateRunRemovesTheLandingTreeOfARefusedPlan(t *testing.T) {
	ctx := context.Background()
	ch, projectDir, plan, execGit := newSetupPlanRun(t, "echo ok")
	oldValidate := validateHarness
	validateHarness = func(runtime string, op harness.Operation) (harness.Spec, error) {
		if runs, _ := wstore.GetChannelRuns(ctx, ch.OID); len(runs) > 0 {
			return harness.Spec{}, fmt.Errorf("harness %q cannot run workers here", runtime)
		}
		spec, _ := harness.Lookup(runtime)
		return spec, nil
	}
	t.Cleanup(func() { validateHarness = oldValidate })

	if _, err := startPlanRun(ctx, ch, plan); err == nil || !strings.Contains(err.Error(), "submitting plan") {
		t.Fatalf("the refused plan must be reported, got %v", err)
	}
	assertRunTornDown(t, ch, projectDir, execGit)
}

// A Setup that fails in the landing tree is a judgment, not a refusal: a new project's Setup line is often
// wrong for it (a stale lockfile, a missing tool), and a run that vanished with one error line showed the
// user nothing to act on. The run stays, its landing tree stays for the retry, and its lead starts on the
// failure: it can fix the Setup line and resubmit, or ask the user.
func TestCreateRunHandsAFailedSetupToTheLead(t *testing.T) {
	ctx := context.Background()
	setup := "echo lockfile is stale && exit 3"
	ch, _, plan, execGit := newSetupPlanRun(t, setup)
	prompt := stubLeadSpawn(t, nil)

	rtn, err := startPlanRun(ctx, ch, plan)
	if err != nil {
		t.Fatalf("a failed Setup goes to the lead, not back to the launcher as a failed start: %v", err)
	}
	run, err := wstore.GetRun(ctx, ch.OID, rtn.Run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if run.Status == jarvis.RunStatus_Cancelled || run.DagORef != "" {
		t.Fatalf("the run waits on its lead with no dag yet: status %q dag %q", run.Status, run.DagORef)
	}
	if leadORef(run) != "tab:lead-tab" {
		t.Fatalf("the lead is attached to the run, got %q", leadORef(run))
	}
	for _, want := range []string{setup, "lockfile is stale", run.LandPath, "wsh jarvis dag submit --plan " + plan} {
		if !strings.Contains(*prompt, want) {
			t.Fatalf("the lead's prompt must name %q:\n%s", want, *prompt)
		}
	}
	if _, err := os.Stat(run.LandPath); err != nil {
		t.Fatalf("the landing tree is kept for the retry: %v", err)
	}
	if got := execGit("branch", "--list", "wave/"+run.ID); got == "" {
		t.Fatal("the landing branch is kept for the retry")
	}
}

// with no lead to judge it, a failed Setup is the refusal it was before
func TestCreateRunCancelsAFailedSetupWhenNoLeadStarts(t *testing.T) {
	ctx := context.Background()
	ch, projectDir, plan, execGit := newSetupPlanRun(t, "exit 3")
	stubLeadSpawn(t, fmt.Errorf("no harness"))

	_, err := startPlanRun(ctx, ch, plan)
	if err == nil || !strings.Contains(err.Error(), "running setup") {
		t.Fatalf("the Setup failure must be reported, got %v", err)
	}
	assertRunTornDown(t, ch, projectDir, execGit)
}

func TestCreateRunLandsOnItsOwnBranch(t *testing.T) {
	ctx := context.Background()
	projectDir, execGit := newLandingRepo(t)
	base := execGit("rev-parse", "HEAD")
	_, run, err := createLandingRun(t, ctx, projectDir, jarvis.RunMode_Orchestrator, strPtr(jarvis.Landing_Branch))
	if err != nil {
		t.Fatalf("CreateRunCommand: %v", err)
	}
	want := filepath.Join(projectDir, ".waveterm", "worktrees", run.ID)
	if run.LandPath != want {
		t.Fatalf("landpath = %q, want %q", run.LandPath, want)
	}
	if got := execGit("-C", run.LandPath, "rev-parse", "--abbrev-ref", "HEAD"); got != "wave/"+run.ID {
		t.Fatalf("landing tree is on %q, want wave/%s", got, run.ID)
	}
	if got := execGit("rev-parse", "wave/"+run.ID); got != base {
		t.Fatalf("landing branch starts at %s, want the run's base %s", got, base)
	}
	if got := execGit("rev-parse", "--abbrev-ref", "HEAD"); got != "main" {
		t.Fatalf("the project checkout moved to %q", got)
	}
}

// the run's own --landing wins over the profile, a landing no one chose is a branch, and the run records
// the branch it will merge back into
func TestCreateRunLandingRequest(t *testing.T) {
	ctx := context.Background()
	create := func(t *testing.T, projectDir, requested string, profile *string) (*waveobj.Channel, *waveobj.Run, error) {
		t.Helper()
		stubRunServer(t, "pi", nil)
		ch, err := wstore.CreateChannel(ctx, "landing-request", projectDir)
		if err != nil {
			t.Fatal(err)
		}
		if profile != nil {
			seedProfileMeta(t, ctx, ch.OID, &waveobj.ProfileOverride{Landing: profile})
		}
		rtn, err := (&WshServer{}).CreateRunCommand(ctx, wshrpc.CommandCreateRunData{
			ChannelId: ch.OID, WorkspaceId: "ws", Goal: "g", Runtime: "pi", Mode: jarvis.RunMode_Orchestrator,
			DeferStart: true, Landing: requested,
		})
		if err != nil {
			return ch, nil, err
		}
		return ch, rtn.Run, nil
	}

	t.Run("an unknown landing is refused before anything persists", func(t *testing.T) {
		projectDir, _ := newLandingRepo(t)
		ch, _, err := create(t, projectDir, "sideways", nil)
		if err == nil || !strings.Contains(err.Error(), "unknown landing") {
			t.Fatalf("error %v should refuse the landing", err)
		}
		if runs, _ := wstore.GetChannelRuns(ctx, ch.OID); len(runs) != 0 {
			t.Fatalf("a refused landing left runs behind: %+v", runs)
		}
	})

	t.Run("no landing anywhere lands on a branch", func(t *testing.T) {
		projectDir, _ := newLandingRepo(t)
		_, run, err := create(t, projectDir, "", nil)
		if err != nil {
			t.Fatal(err)
		}
		if run.LandPath != filepath.Join(projectDir, ".waveterm", "worktrees", run.ID) {
			t.Fatalf("landpath = %q, want the run's own tree", run.LandPath)
		}
		if run.BaseBranch != "main" {
			t.Fatalf("basebranch = %q, want main", run.BaseBranch)
		}
	})

	t.Run("a requested checkout wins over a branch profile", func(t *testing.T) {
		projectDir, _ := newLandingRepo(t)
		_, run, err := create(t, projectDir, jarvis.Landing_Checkout, strPtr(jarvis.Landing_Branch))
		if err != nil {
			t.Fatal(err)
		}
		if run.LandPath != "" {
			t.Fatalf("landpath = %q, want the checkout", run.LandPath)
		}
	})

	t.Run("a detached head records no base branch", func(t *testing.T) {
		projectDir, execGit := newLandingRepo(t)
		execGit("checkout", "--detach")
		_, run, err := create(t, projectDir, "", nil)
		if err != nil {
			t.Fatal(err)
		}
		if run.BaseBranch != "" {
			t.Fatalf("basebranch = %q, want empty on a detached head", run.BaseBranch)
		}
		if run.LandPath == "" {
			t.Fatal("a detached run still lands on its own branch")
		}
	})
}

func TestCreateRunLandingLeavesLandPathEmpty(t *testing.T) {
	ctx := context.Background()
	cases := []struct {
		name    string
		git     bool
		mode    string
		landing *string
	}{
		{"checkout landing", true, jarvis.RunMode_Orchestrator, strPtr(jarvis.Landing_Checkout)},
		{"quick run", true, jarvis.RunMode_Quick, strPtr(jarvis.Landing_Branch)},
		{"not a git project", false, jarvis.RunMode_Orchestrator, strPtr(jarvis.Landing_Branch)},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			projectDir := t.TempDir()
			if c.git {
				projectDir, _ = newLandingRepo(t)
			}
			_, run, err := createLandingRun(t, ctx, projectDir, c.mode, c.landing)
			if err != nil {
				t.Fatalf("CreateRunCommand: %v", err)
			}
			if run.LandPath != "" {
				t.Fatalf("landpath = %q, want empty", run.LandPath)
			}
			if _, err := os.Stat(filepath.Join(projectDir, ".waveterm", "worktrees")); !os.IsNotExist(err) {
				t.Fatalf("no landing tree should be created, stat err %v", err)
			}
		})
	}
}

// A run that asked for its own branch and cannot have one must not land in the checkout instead.
func TestCreateRunCancelsWhenTheLandingTreeFails(t *testing.T) {
	ctx := context.Background()
	projectDir, _ := newLandingRepo(t)
	// a file where the worktrees dir belongs makes `git worktree add` fail
	if err := os.MkdirAll(filepath.Join(projectDir, ".waveterm"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(projectDir, ".waveterm", "worktrees"), nil, 0o644); err != nil {
		t.Fatal(err)
	}
	ch, _, err := createLandingRun(t, ctx, projectDir, jarvis.RunMode_Orchestrator, strPtr(jarvis.Landing_Branch))
	if err == nil || !strings.Contains(err.Error(), "landing") {
		t.Fatalf("error %v should name the landing tree", err)
	}
	runs, gerr := wstore.GetChannelRuns(ctx, ch.OID)
	if gerr != nil {
		t.Fatal(gerr)
	}
	if len(runs) != 1 || runs[0].Status != jarvis.RunStatus_Cancelled {
		t.Fatalf("the failed launch leaves one cancelled run, got %+v", runs)
	}
}

func TestSetChannelProfileRejectsUnknownLanding(t *testing.T) {
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "profile-landing", "/repo")
	if err != nil {
		t.Fatalf("CreateChannel: %v", err)
	}
	// an empty override would read as inheriting in the modal and as branch on the server
	for _, landing := range []string{"elsewhere", ""} {
		if err := (&WshServer{}).SetChannelProfileCommand(ctx, wshrpc.CommandSetChannelProfileData{
			ChannelId: ch.OID, Override: &waveobj.ProfileOverride{Landing: strPtr(landing)},
		}); err == nil {
			t.Fatalf("expected landing %q to be rejected", landing)
		}
		if channelHasProfileMeta(t, ctx, ch.OID) {
			t.Fatalf("a rejected landing %q must not write channel meta", landing)
		}
	}
}
