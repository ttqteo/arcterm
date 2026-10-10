package wshserver

// DAG execution is engine-owned: persisted TaskGroups and waveobj updates drive supervision.
// ScheduleOnce and the watchdog advance tasks from persisted state without the lead worker.
// The lead receives notifications for visibility, but its phase worker is not an execution dependency.

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/agentask"
	"github.com/wavetermdev/waveterm/pkg/effortstore"
	"github.com/wavetermdev/waveterm/pkg/harness"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/orchestrate"
	"github.com/wavetermdev/waveterm/pkg/runroute"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wcore"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// resolvePlanPath roots a relative plan path at the project, the one directory someone typing it into + Run
// can mean. It stays absolute from here on because workers, reviewers and the landing fold each read it from
// their own cwd. With no project the path is returned as is, for readPlanFile to refuse.
func resolvePlanPath(projectPath, path string) string {
	if projectPath == "" || path == "" || filepath.IsAbs(path) {
		return path
	}
	return filepath.Join(projectPath, path)
}

// setupFailedError is a plan's Setup failing in the landing tree. A plan start hands it to the run's lead
// (handSetupToLead) rather than refusing: the Setup line is often wrong for a project the engine is new to.
type setupFailedError struct {
	landPath, command, tail string
	err                     error
}

func (e *setupFailedError) Error() string {
	return fmt.Sprintf("running setup in the landing tree %s: %v\n%s", e.landPath, e.err, e.tail)
}

func (e *setupFailedError) Unwrap() error { return e.err }

// readPlanFile reads and parses the plan at path. wavesrv does not share the caller's cwd, so only an
// absolute path names the file the caller meant.
func readPlanFile(path string) (jarvis.Plan, error) {
	if !filepath.IsAbs(path) {
		return jarvis.Plan{}, fmt.Errorf("planpath %q must be absolute", path)
	}
	src, err := os.ReadFile(path)
	if err != nil {
		return jarvis.Plan{}, fmt.Errorf("reading plan: %w", err)
	}
	plan, err := jarvis.ParsePlan(string(src))
	if err != nil {
		return jarvis.Plan{}, fmt.Errorf("plan %s: %w", path, err)
	}
	return plan, nil
}

// planTitle names a plan by its heading, else by its file.
func planTitle(plan jarvis.Plan, path string) string {
	if plan.Title != "" {
		return plan.Title
	}
	return strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
}

// loadDagPlan fills a submit's tasks, and its title and width when unset, from its plan file, and
// returns the plan for its Verify and Setup commands.
func loadDagPlan(data *wshrpc.CommandDagSubmitData) (jarvis.Plan, error) {
	if len(data.Tasks) > 0 {
		return jarvis.Plan{}, fmt.Errorf("pass tasks or planpath, not both")
	}
	if data.SpecPath != "" {
		if !filepath.IsAbs(data.SpecPath) {
			return jarvis.Plan{}, fmt.Errorf("specpath %q must be absolute", data.SpecPath)
		}
		// checked now: a mistyped path would otherwise surface only as a log line at the first merge
		if _, err := os.Stat(data.SpecPath); err != nil {
			return jarvis.Plan{}, fmt.Errorf("reading spec: %w", err)
		}
	}
	plan, err := readPlanFile(data.PlanPath)
	if err != nil {
		return jarvis.Plan{}, err
	}
	// a plan started from + Run or `wsh runs start --plan` comes with no --spec; its own Spec line names
	// it. A fix round implements the run's spec, so it takes none.
	if data.SpecPath == "" && plan.Spec != "" && !data.Round {
		if spec, ok := resolvePlanSpec(data.PlanPath, plan.Spec); ok {
			data.SpecPath = spec
		} else {
			log.Printf("dag submit: plan %s names spec %q, which is not a file; submitting without a spec\n", data.PlanPath, plan.Spec)
		}
	}
	data.Tasks = plan.Tasks
	if data.Title == "" {
		data.Title = planTitle(plan, data.PlanPath)
	}
	if data.Parallelism == 0 {
		data.Parallelism = orchestrate.DefaultParallelism(plan.Tasks)
	}
	return plan, nil
}

// resolvePlanSpec finds the file a plan's Spec line names: an absolute path as written, else the path
// joined to the plan's directory and then each parent, nearest first, so a repo-relative path resolves
// from a plan anywhere in the repo.
func resolvePlanSpec(planPath, spec string) (string, bool) {
	isFile := func(p string) bool {
		info, err := os.Stat(p)
		return err == nil && info.Mode().IsRegular()
	}
	if filepath.IsAbs(spec) {
		return spec, isFile(spec)
	}
	for dir := filepath.Dir(planPath); ; {
		if candidate := filepath.Join(dir, spec); isFile(candidate) {
			return candidate, true
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", false
		}
		dir = parent
	}
}

// DagPlanPreviewCommand parses a plan for + Run before a run exists, so a plan that will not run is refused
// before start and the human sees the shape the engine will run.
func (ws *WshServer) DagPlanPreviewCommand(ctx context.Context, data wshrpc.CommandDagPlanPreviewData) (*wshrpc.CommandDagPlanPreviewRtnData, error) {
	path := resolvePlanPath(data.ProjectPath, data.PlanPath)
	plan, err := readPlanFile(path)
	if err != nil {
		return nil, err
	}
	return &wshrpc.CommandDagPlanPreviewRtnData{
		Title:  planTitle(plan, path),
		Verify: plan.Verify,
		Setup:  plan.Setup,
		Check:  plan.Check,
		Shape:  orchestrate.PlanShapeOf(plan.Tasks),
		Tasks:  planPreviewTasks(plan.Tasks),
	}, nil
}

// planPreviewTasks lists a plan's tasks in plan order, each with its 1-based lane and its Model line.
func planPreviewTasks(tasks []waveobj.TaskNode) []wshrpc.DagPlanPreviewTask {
	laneOf := map[string]int{}
	for i, lane := range jarvis.Lanes(tasks) {
		for _, id := range lane {
			laneOf[id] = i + 1
		}
	}
	out := make([]wshrpc.DagPlanPreviewTask, len(tasks))
	for i, t := range tasks {
		out[i] = wshrpc.DagPlanPreviewTask{Id: t.ID, Title: t.Label, Lane: laneOf[t.ID]}
		if len(t.Deps) > 0 {
			out[i].Deps = t.Deps
		}
		if t.ModelSource == waveobj.TaskModelSource_Plan {
			out[i].Model = planModelLine(t.RunSpec)
		}
	}
	return out
}

// planModelLine is a plan task's Model line as the plan wrote it: runtime:model, a runtime alone, or a bare model.
func planModelLine(spec waveobj.RunSpec) string {
	switch {
	case spec.Runtime == "":
		return spec.Model
	case spec.Model == "":
		return spec.Runtime
	}
	return spec.Runtime + ":" + spec.Model
}

// checkDagEffort refuses a dag whose tasks name effort chunks the engine could not close when they land:
// a chunk with no effort to live in, an effort that does not exist, or a label the effort does not hold.
// Caught at submit, because at landing the only report would be a log line.
func checkDagEffort(ctx context.Context, effortOID string, tasks []waveobj.TaskNode) error {
	if effortOID == "" {
		for _, task := range tasks {
			if len(task.Chunks) > 0 {
				return fmt.Errorf("task %q names chunks but the dag has no effort", task.ID)
			}
		}
		return nil
	}
	effort, err := effortstore.Get(ctx, effortOID)
	if err != nil {
		return fmt.Errorf("effort %q: %w", effortOID, err)
	}
	for _, task := range tasks {
		for _, label := range task.Chunks {
			idx, err := jarvis.ResolveChunkIndex(effort, label)
			if err != nil {
				return fmt.Errorf("task %q: effort %s: %w", task.ID, effortOID, err)
			}
			// a bare number resolves as a position, and the label is what the engine closes by
			if effort.Chunks[idx].Label != label {
				return fmt.Errorf("task %q: effort %s has no chunk labelled %q", task.ID, effortOID, label)
			}
		}
	}
	return nil
}

// postHandoff is a var so tests can see which submits hand a lead its compaction.
var postHandoff = orchestrate.PostHandoff

// postLeadHandoff hands owner's lead its compaction. A run with no lead worker, a human-planned one, has
// nobody to compact, and a handoff queued for it would launch a lead.
func postLeadHandoff(ctx context.Context, channelId string, owner *waveobj.Run) {
	if leadORef(owner) != "" {
		postHandoff(ctx, channelId, owner.ID)
	}
}

// handOffAfterPlanReview hands the dag's lead its compaction once the plan review cleared the plan.
func handOffAfterPlanReview(ctx context.Context, dagID string) {
	g, err := wstore.GetDag(ctx, dagID)
	if err != nil {
		log.Printf("handoff after plan review: loading dag %s: %v", dagID, err)
		return
	}
	owner, err := wstore.GetRun(ctx, g.ChannelId, g.RunID)
	if err != nil {
		log.Printf("handoff after plan review: loading run %s: %v", g.RunID, err)
		return
	}
	postLeadHandoff(ctx, g.ChannelId, owner)
}

func (ws *WshServer) DagSubmitCommand(ctx context.Context, data wshrpc.CommandDagSubmitData) (*waveobj.TaskGroup, error) {
	var plan jarvis.Plan
	if data.Round {
		// a fix round implements the run's spec; its plan brings no spec of its own
		data.SpecPath = ""
	}
	if data.SpecPath != "" && data.PlanPath == "" {
		return nil, fmt.Errorf("specpath needs planpath: the spec is committed with the plan it produced")
	}
	if data.PlanPath != "" {
		loaded, err := loadDagPlan(&data)
		if err != nil {
			return nil, err
		}
		plan = loaded
	}
	if data.ChannelId == "" || data.RunId == "" || len(data.Tasks) == 0 {
		return nil, fmt.Errorf("channelid, runid and tasks are required")
	}
	run, err := wstore.GetRun(ctx, data.ChannelId, data.RunId)
	if err != nil {
		return nil, fmt.Errorf("loading run: %w", err)
	}
	if run.Mode != jarvis.RunMode_Orchestrator {
		return nil, fmt.Errorf("dag requires an orchestrator-mode run")
	}
	if data.Round {
		return submitFixRound(ctx, run, data, plan)
	}
	// a plan written without a Setup line still gets prepared trees: the project's checked-in default fills it,
	// read from the landing tree, which is at the commit the run builds from
	if plan.Setup == "" {
		setup, err := orchestrate.ProjectSetup(jarvis.LandPath(run))
		if err != nil {
			return nil, err
		}
		plan.Setup = setup
	}
	if err := checkDagEffort(ctx, plan.EffortOID, data.Tasks); err != nil {
		return nil, err
	}
	ownerPin := waveobj.RoutePin{Runtime: runroute.DefaultRuntime(run.Runtime), Model: run.Model}
	for _, task := range data.Tasks {
		// an absent runtime inherits the owner's, exactly as dispatch does; a runtime with no model is
		// that runtime's default
		pin := ownerPin
		if task.RunSpec.Runtime != "" || task.RunSpec.Model != "" {
			runtime := task.RunSpec.Runtime
			if runtime == "" {
				runtime = ownerPin.Runtime
			}
			pin = waveobj.RoutePin{Runtime: runtime, Model: task.RunSpec.Model}
		}
		if _, err := runroute.Resolve(pin); err != nil {
			return nil, fmt.Errorf("task %q: %w", task.ID, err)
		}
		if _, err := validateHarness(pin.Runtime, harness.OperationRunWorker); err != nil {
			return nil, fmt.Errorf("task %q: %w", task.ID, err)
		}
	}
	// the group must never hold picks and a route together: the route would silently win over every pick
	if run.ReviewerPicks && data.WorkerRoute != nil {
		return nil, fmt.Errorf("this run's workers setting is Reviewer picks; submit without a worker route")
	}
	if data.WorkerRoute != nil {
		if _, err := runroute.Resolve(*data.WorkerRoute); err != nil {
			return nil, fmt.Errorf("workerRoute %w", err)
		}
		if _, err := validateHarness(data.WorkerRoute.Runtime, harness.OperationRunWorker); err != nil {
			return nil, fmt.Errorf("workerRoute %w", err)
		}
	}
	workerRoute := data.WorkerRoute
	if workerRoute == nil {
		workerRoute = run.WorkerRoute
	}
	mergeRequired := orchestrate.IsGitRepo(run.ProjectPath)
	// The width is the human's dial, not the lead's: N concurrent children are N live worktrees and N
	// token streams, a cost the human pays. Their choice (Run rail, stored on the run) therefore wins
	// over whatever the lead submits. The prompt already told the lead this number, so a lead that
	// followed it sees no change; one that ignored it does not get to overspend.
	parallelism := data.Parallelism
	if run.Parallelism > 0 {
		parallelism = run.Parallelism
	}
	proposed, err := orchestrate.NewTaskGroup(data.RunId, data.ChannelId, data.Title, parallelism, mergeRequired, data.Tasks, time.Now().UnixMilli(), workerRoute)
	if err != nil {
		return nil, err
	}
	proposed.Verify, proposed.Setup, proposed.Check, proposed.Preamble = plan.Verify, plan.Setup, plan.Check, plan.Preamble
	proposed.FinalCmd, proposed.Prototype = plan.Final, plan.Prototype
	// a prototype the run was started with (Build this… on a canvas) is the human's, not the lead's
	if run.Prototype != "" {
		proposed.Prototype = run.Prototype
	}
	proposed.EffortOID = plan.EffortOID
	proposed.PlanPath, proposed.SpecPath = data.PlanPath, data.SpecPath
	proposed.ReviewerPicks, proposed.ReviewerRoute = run.ReviewerPicks, run.ReviewerRoute
	// a plan file is reviewed before any worker starts; a JSON dag has no plan to review
	if data.PlanPath != "" {
		proposed.PlanReview = orchestrate.NewPlanReview()
		orchestrate.RecomputeDagStatus(&proposed)
	}
	// the landing tree is where Verify runs, and the plan's Setup line is first known here. A run that
	// already has a dag is a resubmit, whose merges may be running in that tree. Setup is bounded by its own
	// timeout, not the caller's RPC deadline, and once it has run the submit finishes even if the caller
	// stopped waiting, so the prepared tree gets its dag.
	if run.LandPath != "" && run.DagORef == "" && plan.Setup != "" {
		ctx = context.WithoutCancel(ctx)
		if tail, err := orchestrate.RunSetup(ctx, run.LandPath, plan.Setup); err != nil {
			return nil, &setupFailedError{landPath: run.LandPath, command: plan.Setup, tail: tail, err: err}
		}
	}
	// a branch-landed run commits its spec and plan before any lane is cut, so every task reads the version
	// it was submitted with and the docs land with the run; the dag keeps their repo-relative paths
	if run.LandPath != "" && data.PlanPath != "" {
		rels, err := orchestrate.SnapshotDocs(ctx, run.LandPath, run.ID, data.Title, data.SpecPath, data.PlanPath)
		if err != nil {
			return nil, fmt.Errorf("committing the spec and plan to wave/%s: %w", run.ID, err)
		}
		proposed.SpecPath, proposed.PlanPath = rels[0], rels[1]
	}
	stored, created, err := wstore.CreateDagForRun(ctx, data.ChannelId, data.RunId, &proposed, func(run *waveobj.Run) error {
		if run.Mode != jarvis.RunMode_Orchestrator {
			return fmt.Errorf("dag requires an orchestrator-mode run")
		}
		// accept both a deferred planning run and a live lead run that publishes its dag mid-run
		// (the adaptive orchestrator flow starts the orchestrate phase immediately). CreateDagForRun
		// rejects a run that already links a dag, so allowing executing cannot double-publish.
		if run.Status != jarvis.RunStatus_Planning && run.Status != jarvis.RunStatus_Executing {
			return fmt.Errorf("dag run %s is %s, want planning or executing", run.ID, run.Status)
		}
		run.Status = jarvis.RunStatus_Executing
		return nil
	})
	if err != nil {
		return nil, err
	}
	switch {
	case !created && orchestrate.PlanReviewReplaceable(stored):
		// the lead revised the plan its review failed: nothing was built on it, so the revision replaces it
		replaced, err := orchestrate.ReplacePlanReviewProposal(ctx, stored.OID, &proposed)
		if err != nil {
			return nil, err
		}
		stored = replaced
	case !created:
		if !orchestrate.SameDagProposal(stored, &proposed) {
			return nil, fmt.Errorf("dag conflict: run %s already holds a different dag; a run holds exactly one dag for its whole lifetime, so remaining work needs a new run, not a second submission", data.RunId)
		}
	default:
		zero := 0
		appendRunEvent(ctx, data.ChannelId, data.RunId, waveobj.RunEventKindPhaseStarted, &zero, map[string]any{})
		// a lead that just handed its plan over compacts at that boundary (spec §7). A reviewed plan is
		// handed over only once its review clears: a failed one comes back to the lead to revise, which needs
		// the context the compaction drops.
		if stored.PlanReview == nil {
			postLeadHandoff(ctx, data.ChannelId, run)
		}
	}
	wcore.SendWaveObjUpdate(waveobj.MakeORef(waveobj.OType_Dag, stored.OID))
	wcore.SendWaveObjUpdate(waveobj.MakeORef(waveobj.OType_Run, data.RunId))
	wcore.SendWaveObjUpdate(waveobj.MakeORef(waveobj.OType_Channel, data.ChannelId))
	// the submitting tick: it derives the group's status, publishes it and dispatches the first layer.
	if serr := orchestrate.Schedule(ctx, stored.OID); serr != nil {
		log.Printf("dag submit schedule error: %v", serr)
	}
	if fresh, err := wstore.GetDag(ctx, stored.OID); err == nil {
		return fresh, nil
	}
	return stored, nil
}

// submitFixRound appends a fix plan's tasks to the run's dag after its final stage failed. Only the tasks are
// taken: the dag keeps its Verify, Setup, Check, Final and effort, and the round is not plan-reviewed. A fix plan that
// names a different command is refused, not ignored.
func submitFixRound(ctx context.Context, run *waveobj.Run, data wshrpc.CommandDagSubmitData, plan jarvis.Plan) (*waveobj.TaskGroup, error) {
	if data.PlanPath == "" {
		return nil, fmt.Errorf("a fix round is submitted as a plan file: pass planpath")
	}
	if run.DagORef == "" {
		return nil, fmt.Errorf("run %s has no dag for a fix round to extend", run.ID)
	}
	g, err := wstore.GetDag(ctx, run.DagORef)
	if err != nil {
		return nil, err
	}
	// checked before the snapshot too: a refused round must not commit its plan into a landing tree the final
	// stage may be running in
	if err := orchestrate.CheckFixRound(g); err != nil {
		return nil, err
	}
	if err := orchestrate.CheckFixPlanCommands(g, plan.Verify, plan.Setup, plan.Check, plan.Final); err != nil {
		return nil, err
	}
	if err := checkDagEffort(ctx, g.EffortOID, data.Tasks); err != nil {
		return nil, err
	}
	planPath := data.PlanPath
	// committed like the run's plan, so each fix task reads the version it was submitted with
	if run.LandPath != "" {
		rels, err := orchestrate.SnapshotDocs(ctx, run.LandPath, run.ID, data.Title, data.PlanPath)
		if err != nil {
			return nil, fmt.Errorf("committing the fix plan to wave/%s: %w", run.ID, err)
		}
		planPath = rels[0]
	}
	stored, err := orchestrate.AppendRound(ctx, g.OID, planPath, data.Tasks)
	if err != nil {
		return nil, err
	}
	if serr := orchestrate.Schedule(ctx, stored.OID); serr != nil {
		log.Printf("dag fix round schedule error: %v", serr)
	}
	if fresh, err := wstore.GetDag(ctx, stored.OID); err == nil {
		return fresh, nil
	}
	return stored, nil
}

// dagDigestChildRunLimit bounds the child runs a status snapshot loads; the digest never pages the
// list, so this is a cost bound on one snapshot, not a limit on how large a plan may be.
const dagDigestChildRunLimit = 64

// dagDigestRetainedKinds are the lifecycle rows the digest derives durations, retries, the report's counts,
// what the human told workers and the run's timing from. The UI's 200-row window is not consulted.
var dagDigestRetainedKinds = []string{
	waveobj.RunEventKindTaskRetried,
	waveobj.RunEventKindTaskSpawned,
	waveobj.RunEventKindTaskDone,
	waveobj.RunEventKindTaskFailed,
	waveobj.RunEventKindTaskReviewStarted,
	waveobj.RunEventKindTaskReviewPassed,
	waveobj.RunEventKindTaskReviewFailed,
	waveobj.RunEventKindTaskMergeStarted,
	waveobj.RunEventKindTaskMerged,
	waveobj.RunEventKindTaskVerifyPassed,
	waveobj.RunEventKindTaskVerifyFailed,
	waveobj.RunEventKindFinalStep,
	waveobj.RunEventKindTaskCleanupPending,
	waveobj.RunEventKindTaskCleanupCompleted,
	waveobj.RunEventKindTaskCleanupFailed,
	waveobj.RunEventKindDagDone,
	waveobj.RunEventKindDagCancelled,
	waveobj.RunEventKindChildAnswered,
	waveobj.RunEventKindTaskForwarded,
	waveobj.RunEventKindTaskTold,
}

func (ws *WshServer) DagStatusCommand(ctx context.Context, data wshrpc.CommandDagStatusData) (*wshrpc.CommandDagStatusRtnData, error) {
	run, err := wstore.GetRun(ctx, data.ChannelId, data.RunId)
	if err != nil {
		return nil, fmt.Errorf("loading run: %w", err)
	}
	if run.DagORef == "" {
		return nil, fmt.Errorf("run has no dag")
	}
	g, err := wstore.GetDag(ctx, run.DagORef)
	if err != nil {
		return nil, err
	}
	sn := orchestrate.DagDigestSnapshot{
		Group:    g,
		Owner:    run,
		Runs:     dagDigestChildRuns(ctx, data.ChannelId, g),
		Asks:     gatherDagAsks(ctx, run),
		Retained: dagDigestRetained(ctx, data.ChannelId, data.RunId),
		Now:      time.Now(),
	}
	return &wshrpc.CommandDagStatusRtnData{Group: g, Digest: orchestrate.BuildDigest(sn)}, nil
}

// dagDigestChildRuns loads at most dagDigestChildRunLimit unique child runs of the group's tasks;
// per-run load failures degrade to partial durations, never a status error.
func dagDigestChildRuns(ctx context.Context, channelId string, g *waveobj.TaskGroup) []*waveobj.Run {
	var out []*waveobj.Run
	seen := map[string]bool{}
	for i := range g.Tasks {
		runId := g.Tasks[i].RunID
		if runId == "" || seen[runId] || len(out) >= dagDigestChildRunLimit {
			continue
		}
		seen[runId] = true
		child, err := wstore.GetRun(ctx, channelId, runId)
		if err != nil {
			continue
		}
		out = append(out, child)
	}
	return out
}

// dagDigestRetained loads the bounded retained lifecycle rows the digest needs. A query failure
// degrades durations to partial rather than failing the status request.
func dagDigestRetained(ctx context.Context, channelId, runId string) []waveobj.RunEvent {
	ev, err := wstore.QueryRunEventsByKind(ctx, channelId, runId, dagDigestRetainedKinds, 0)
	if err != nil {
		log.Printf("dag digest retained events: %v", err)
		return nil
	}
	return ev
}

func (ws *WshServer) DagActionCommand(ctx context.Context, data wshrpc.CommandDagActionData) error {
	if data.ChannelId == "" || data.RunId == "" || data.Action == "" {
		return fmt.Errorf("channelid, runid and action are required")
	}
	run, err := wstore.GetRun(ctx, data.ChannelId, data.RunId)
	if err != nil {
		return fmt.Errorf("loading run: %w", err)
	}
	if run.DagORef == "" {
		return fmt.Errorf("run has no dag")
	}
	switch data.Action {
	case "cancel":
		return orchestrate.Cancel(ctx, run.DagORef)
	case "retry-cleanup":
		return orchestrate.RetryCleanup(ctx, run.DagORef, data.TaskId)
	case "forward":
		return orchestrate.ForwardTask(ctx, run.DagORef, data.TaskId, data.Notes)
	case "takeover":
		return orchestrate.TakeOverAsk(ctx, run.DagORef, data.TaskId)
	case "relaunch-lead":
		return orchestrate.RelaunchLead(ctx, data.ChannelId, data.RunId)
	case "review-pass", "review-fail":
		// RunId is the reviewer's own run: `dag review` resolves it from the reviewer's terminal
		verdict := strings.TrimPrefix(data.Action, "review-")
		if err := orchestrate.RecordReviewVerdict(ctx, run.DagORef, data.RunId, verdict, data.Notes, data.Downstream, data.Unverified, data.DownstreamFor); err != nil {
			return err
		}
		// the verdict is durable; the tick that applies it can spawn a worker, which outlasts the reviewer's RPC budget
		scheduleDag(run.DagORef)
		return nil
	case "planreview-pass", "planreview-fail", "planreview-accept":
		var err error
		switch {
		case data.Action == "planreview-accept" && len(data.Picks) > 0:
			err = fmt.Errorf("--pick goes with the plan reviewer's verdict only")
		case data.Action == "planreview-accept":
			err = orchestrate.AcceptPlanReview(ctx, run.DagORef, data.Notes)
		default:
			// RunId is the plan reviewer's own run, resolved from its terminal as `dag review` does
			err = orchestrate.RecordPlanReviewVerdict(ctx, run.DagORef, data.RunId, strings.TrimPrefix(data.Action, "planreview-"), data.Notes, data.Picks)
		}
		if err != nil {
			return err
		}
		dagID := run.DagORef
		if data.Action != "planreview-fail" {
			handOffAfterPlanReview(ctx, dagID)
		}
		// the verdict is durable; the tick it clears dispatches the first layer, which outlasts the caller's RPC budget
		scheduleDag(dagID)
		return nil
	case "final-pass", "final-fail":
		// RunId is the verifier's own run, resolved from its terminal as `dag review` does
		if err := orchestrate.RecordFinalVerdict(ctx, run.DagORef, data.RunId, strings.TrimPrefix(data.Action, "final-"), data.Notes, data.Unverified); err != nil {
			return err
		}
		// the tick announces the dag done, which totals the run's usage from every transcript
		scheduleDag(run.DagORef)
		return nil
	case "final-end-unverified", "final-end-failed":
		// the human's end: RunId is the orchestrator run, so no verifier run id is needed, and no tab is marked complete
		outcome := orchestrate.FinalState_Unverified
		if data.Action == "final-end-failed" {
			outcome = orchestrate.FinalState_Failed
		}
		if err := orchestrate.EndFinalStage(ctx, run.DagORef, outcome, data.Notes); err != nil {
			return err
		}
		// the tick announces the dag done, or hands a failed stage to the lead
		scheduleDag(run.DagORef)
		return nil
	case "amend":
		return orchestrate.AmendTask(ctx, run.DagORef, data.TaskId, data.Notes)
	case "tell":
		return orchestrate.TellTask(ctx, run.DagORef, data.TaskId, data.Notes)
	case "sendback":
		return orchestrate.SendBack(ctx, run.DagORef, data.TaskId, data.Notes)
	}
	target := waveobj.RoutePin{Runtime: data.Runtime, Model: data.Model}
	return orchestrate.ApplyAction(ctx, run.DagORef, data.TaskId, data.Action, target)
}

// leadORef is the tab oref of the worker driving the run's running phase, or "" when there is none.
// An orchestrator run has exactly one phase, so this is the lead. Empty is a normal answer (the lead
// exited, or the run is deferred) and steerRunLead treats it as a no-op.
func leadORef(run *waveobj.Run) string {
	for i := range run.Phases {
		p := &run.Phases[i]
		if p.State == jarvis.PhaseState_Running && len(p.WorkerOrefs) > 0 {
			return p.WorkerOrefs[0]
		}
	}
	return ""
}

// gatherDagAsks lists the dag's question queue: every pending ask of its children, whoever holds it.
// Children block on one ask at a time and their own cards are invisible on the child sessions, so this
// is how the lead (`dag asks`) and the run cockpit see them. Shared by the asks RPC and the status
// digest.
func gatherDagAsks(ctx context.Context, run *waveobj.Run) []wshrpc.DagAskItem {
	g, err := wstore.GetDag(ctx, run.DagORef)
	if err != nil {
		return nil
	}
	var items []wshrpc.DagAskItem
	for i := range g.Tasks {
		task := &g.Tasks[i]
		if task.RunID == "" {
			continue
		}
		child, cerr := wstore.GetRun(ctx, run.ChannelOID, task.RunID)
		if cerr != nil {
			continue
		}
		for _, bo := range orchestrate.RunBlockORefs(ctx, child) {
			pending, ok := agentask.GlobalRegistry.Get(bo)
			if !ok || len(pending.Questions) == 0 {
				continue
			}
			items = append(items, wshrpc.DagAskItem{
				TaskId:    task.ID,
				AskId:     pending.AskId,
				Owner:     pending.Owner,
				Deadline:  pending.Deadline,
				Note:      pending.Note,
				Questions: pending.Questions,
				BlockORef: bo,
				Ts:        pending.Ts,
			})
		}
	}
	return items
}

// DagAsksCommand lists the pending asks of the dag's running children.
func (ws *WshServer) DagAsksCommand(ctx context.Context, data wshrpc.CommandDagStatusData) (*wshrpc.CommandDagAsksRtnData, error) {
	run, err := wstore.GetRun(ctx, data.ChannelId, data.RunId)
	if err != nil {
		return nil, fmt.Errorf("loading run: %w", err)
	}
	if run.DagORef == "" {
		return nil, fmt.Errorf("run has no dag")
	}
	return &wshrpc.CommandDagAsksRtnData{Asks: gatherDagAsks(ctx, run)}, nil
}

// DagAnswerCommand delivers an answer to a child's pending ask: the lead's, after a `wake: N questions
// waiting` line, or the human's, for a question the lead forwarded. The child blocks until the answer
// resolves, so this is what unblocks a question-raised child.
func (ws *WshServer) DagAnswerCommand(ctx context.Context, data wshrpc.CommandDagAnswerData) error {
	run, err := wstore.GetRun(ctx, data.ChannelId, data.RunId)
	if err != nil {
		return fmt.Errorf("loading run: %w", err)
	}
	if run.DagORef == "" {
		return fmt.Errorf("run has no dag")
	}
	g, err := wstore.GetDag(ctx, run.DagORef)
	if err != nil {
		return err
	}
	for i := range g.Tasks {
		if g.Tasks[i].ID != data.TaskId || g.Tasks[i].RunID == "" {
			continue
		}
		child, cerr := wstore.GetRun(ctx, data.ChannelId, g.Tasks[i].RunID)
		if cerr != nil {
			return fmt.Errorf("loading child run: %w", cerr)
		}
		blocks := orchestrate.RunBlockORefs(ctx, child)
		if len(blocks) == 0 {
			return fmt.Errorf("task %s has no worker blocks", data.TaskId)
		}
		bo, p, pending := pendingRunAsk(ctx, child)
		if !pending {
			return fmt.Errorf("task %s has no pending ask", data.TaskId)
		}
		if data.Lead && p.Owner == agentask.AskOwner_User {
			return leadAnswerRefused(data.TaskId, p.Note)
		}
		// child-answered is recorded by the shared answer hook inside DeliverAnswer, so
		// this path cannot diverge from a cockpit or Gatekeeper answer.
		return ws.AnswerAgentCommand(ctx, wshrpc.CommandAnswerAgentData{ORef: bo, Answers: data.Answers})
	}
	return fmt.Errorf("no task %q", data.TaskId)
}

// pendingRunAsk finds the pending ask on one of a run's own blocks: a lead's own question, or a task worker's.
func pendingRunAsk(ctx context.Context, run *waveobj.Run) (string, agentask.PendingAsk, bool) {
	for _, bo := range orchestrate.RunBlockORefs(ctx, run) {
		if p, ok := agentask.GlobalRegistry.Get(bo); ok {
			return bo, p, true
		}
	}
	return "", agentask.PendingAsk{}, false
}

// leadAnswerRefused tells a lead why the question it answered is not its own any more, in the words the
// human's card shows.
func leadAnswerRefused(taskId, note string) error {
	if note == "" {
		return fmt.Errorf("task %s's question is with the human; leave it to them", taskId)
	}
	return fmt.Errorf("task %s's question is with the human (%s); leave it to them", taskId, note)
}

// DagMergeCommand squash-merges one finished task's worktree back into the project branch. RunId is
// the dag's owning run (which has no worktree of its own); TaskId selects the child — the branch is
// keyed by the composite worktree key the engine spawned, never by a run id.
// DagMergeCommand lands a task's merge on a human's instruction. The engine lands a clean merge on
// its own (orchestrate.AutoMergeReady); this stays the way to land one it declined to — a project
// tree with staged edits, or a conflict the caller has since made mergeable.
func (ws *WshServer) DagMergeCommand(ctx context.Context, data wshrpc.CommandDagMergeData) error {
	return orchestrate.MergeTask(ctx, data.ChannelId, data.RunId, data.TaskId)
}

// DagMergeContinueCommand is `dag merge <task> --continue`: it finishes a squash merge the caller
// resolved after a conflict, or re-runs Verify after the caller committed a fix.
func (ws *WshServer) DagMergeContinueCommand(ctx context.Context, data wshrpc.CommandDagMergeData) error {
	return orchestrate.ContinueMerge(ctx, data.ChannelId, data.RunId, data.TaskId)
}
