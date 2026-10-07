// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/blockcontroller"
	"github.com/wavetermdev/waveterm/pkg/effortstore"
	"github.com/wavetermdev/waveterm/pkg/gitinfo"
	"github.com/wavetermdev/waveterm/pkg/harness"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/jarviscapture"
	"github.com/wavetermdev/waveterm/pkg/jarviscontinuity"
	"github.com/wavetermdev/waveterm/pkg/jarvisstate"
	"github.com/wavetermdev/waveterm/pkg/jarvisvolunteer"
	"github.com/wavetermdev/waveterm/pkg/orchestrate"
	"github.com/wavetermdev/waveterm/pkg/reporadar"
	"github.com/wavetermdev/waveterm/pkg/runroute"
	"github.com/wavetermdev/waveterm/pkg/util/keyedmutex"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wcore"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// runSpawnLocks serializes spawnRunWorkers per runId so the read-back double-spawn guard
// (len(WorkerOrefs) > 0) is effective across concurrent CreateRun/AdvanceRun calls for one run.
var runSpawnLocks = keyedmutex.New()

// evidenceSealTimeout bounds detached evidence sealing (git diff + transcript reads). Generous so the short
// FE-call budget can't cut a git diff short into an empty, immutable snapshot. Worker spawn uses
// jarvis.RunWorkerSpawnTimeout.
const evidenceSealTimeout = 30 * time.Second

// ErrWorkerReportRequired opens the refusal of a task worker's complete that carries no report: the seal
// would otherwise take whatever line preceded `complete` as the worker's summary.
const ErrWorkerReportRequired = "a task worker completes with --report <file>"

// sealAsync dispatches the best-effort evidence seal off the RPC handler's goroutine so a slow git diff
// can't hold the response past the caller's client timeout. A var so tests can run it inline.
var sealAsync = func(fn func()) { go fn() }

// publishRunUpdate broadcasts a mutated run to the frontend on BOTH orefs: run:<id> (the focused-run view
// subscribes to the per-run WOS object — channel-scaling Phase 2) and channel:<id> (the run-list read
// model). These handlers persist via wstore.UpdateRun, but run on a ctx without ContextWithUpdates, so the
// run: waveobj:update that dbUpsertObjTx queues is dropped (ContextAddUpdate is a no-op with no sink). A
// channel: bump alone can't refresh a run: object (WOS updates are per-oref), so an existing run's status
// would freeze at its last-focused state. Re-broadcast run: explicitly to keep the focused view live.
func publishRunUpdate(channelId, runId string) {
	wcore.SendWaveObjUpdate(waveobj.MakeORef(waveobj.OType_Run, runId))
	wcore.SendWaveObjUpdate(waveobj.MakeORef(waveobj.OType_Channel, channelId))
}

// appendRunEvent persists one lifecycle event and broadcasts it scoped to the run (the focused run
// card appends one row live). The broadcast carries the persisted event (id + ts) so the FE dedups and
// sorts the live row exactly like a re-query. Best-effort: a telemetry failure is logged, never fatal
// — the run transition it accompanies has already persisted.
func appendRunEvent(ctx context.Context, channelId, runId, kind string, phaseIdx *int, detail any) {
	if ev, err := wstore.AppendRunEvent(ctx, channelId, runId, kind, phaseIdx, detail); err != nil {
		log.Printf("appendRunEvent(%s): %v", kind, err)
	} else {
		wps.Broker.Publish(wps.WaveEvent{
			Event:  wps.Event_RunEvent,
			Scopes: []string{waveobj.MakeORef(waveobj.OType_Run, runId).String()},
			Data:   wshrpc.RunEventData{ChannelId: channelId, RunId: runId, Event: ev},
		})
	}
}

// phaseIdxOf returns a pointer for a phase index so 0 stays distinguishable from an absent idx (nil
// means run-level — the FE groups by phaseidx == nil).
func phaseIdxOf(idx int) *int { return &idx }

// gatePhaseIdx mirrors jarvis.gateIndex: the completed gate phase a halted run waits on, or -1. Kept
// in-file so the event mapping can stamp gate actions at the engine-resolved gate without exporting
// the jarvis helper.
// captureAsync dispatches the continuity boundary summary (sub-project E) off the RPC handler's
// goroutine — it makes a model call and must never sit on the 5s RPC budget. A seam so tests capture
// the dispatch without running it.
var captureAsync = func(fn func()) { go fn() }

// scheduleDag pokes a dag's scheduler off the caller's goroutine: the tick can merge, run Setup and spawn,
// which neither an RPC budget nor the seal path should wait on, and it takes the dag lock the caller may not
// hold. A seam so tests see which dag is poked, and whose fixture repo is torn down on return don't race the
// engine's git work in it.
var scheduleDag = func(dagID string) {
	go func() {
		if serr := orchestrate.Schedule(context.Background(), dagID); serr != nil {
			log.Printf("dag schedule error: %v", serr)
		}
	}()
}

// continuityCaptureTimeout bounds the detached boundary-summary model call (PLACEHOLDER; see docs/deferred.md).
const continuityCaptureTimeout = 90 * time.Second

// SealDoneRunEvidenceAsync is the seal seam the orchestrate engine calls when it closes a lead-free run
// itself. Same dispatch AdvanceRun uses, so a caller holding the dag mutation lock never waits on a git
// diff. Note the continuity capture AdvanceRun also runs on its done-path is deliberately not here —
// there is no lead transcript to summarize.
func SealDoneRunEvidenceAsync(channelId, runId string) {
	sealAsync(func() { sealThenLand(channelId, runId) })
}

// sealThenLand seals a done run, then merges its branch back. The land comes second so the seal reads the
// branch before the land deletes it, and it is not gated on the seal: a seal left to the backfill is no reason
// to leave the run's work off its base.
func sealThenLand(channelId, runId string) {
	sealDoneRunEvidence(channelId, runId)
	ctx, cancel := context.WithTimeout(context.Background(), orchestrate.LandTimeout)
	defer cancel()
	// a held land is on the run with its reason and raises an attention item; `wsh runs land` retries it
	if _, err := orchestrate.LandRun(ctx, channelId, runId, false); err != nil {
		log.Printf("landing run %s: %v", runId, err)
	}
}

// tabTranscriptPath is the transcript of the agent session in a tab, "" when it has none (a plain shell, or a tab
// the hooks have not reported yet).
func tabTranscriptPath(ctx context.Context, tabId string) string {
	if tabId == "" {
		return ""
	}
	tab, _ := wstore.DBGet[*waveobj.Tab](ctx, tabId)
	if tab == nil {
		return ""
	}
	for _, blockId := range tab.BlockIds {
		block, _ := wstore.DBGet[*waveobj.Block](ctx, blockId)
		if block == nil {
			continue
		}
		if p := block.Meta.GetString(waveobj.MetaKey_AgentTranscriptPath, ""); p != "" {
			return p
		}
	}
	return ""
}

// sealDoneRunEvidence seals a done run's immutable evidence snapshot (a git diff + transcript reads that can
// take many seconds) detached from any RPC budget. Self-contained and idempotent: it re-loads the run, and
// SealEvidence refuses to seal on a git failure/timeout — leaving the run unsealed for the backfill
// (SealRunEvidenceCommand) to retry rather than freezing an empty file list into the immutable snapshot.
func sealDoneRunEvidence(channelId, runId string) {
	ctx, cancel := context.WithTimeout(context.Background(), evidenceSealTimeout)
	defer cancel()
	run, err := wstore.GetRun(ctx, channelId, runId)
	if err != nil || run.Status != jarvis.RunStatus_Done || run.Evidence != nil {
		return
	}
	if serr := jarvis.SealEvidence(ctx, run); serr != nil {
		log.Printf("AdvanceRun: sealing evidence for run %s deferred to backfill: %v", runId, serr)
		return
	}
	if run.Evidence == nil {
		return
	}
	ev, completedTs := run.Evidence, run.CompletedTs
	if uerr := wstore.UpdateRun(ctx, channelId, runId, func(r *waveobj.Run) error {
		if r.Evidence == nil { // idempotent under concurrent advances / backfill
			r.Evidence = ev
			r.CompletedTs = completedTs
		}
		return nil
	}); uerr != nil {
		log.Printf("AdvanceRun: persisting evidence for run %s failed: %v", runId, uerr)
		return
	}
	if run.DagORef != "" && run.TaskId != "" && !run.Review {
		// the task's reviewer waits on this evidence; without a poke it starts on the next watchdog tick
		scheduleDag(run.DagORef)
	}
	if run.EffortRef != nil {
		// same seal-ctx expiry concern as the event append below: the note is a quick write.
		noteFinishedRunOnChunk(context.WithoutCancel(ctx), run, "AdvanceRun")
	}
	if run.RadarOrigin != nil {
		inv := reporadar.InvestigationFromRun(run, channelId, "done", run.CompletedTs)
		if rerr := reporadar.RecordInvestigation(ctx, run.ProjectPath, run.RadarOrigin.Fingerprint, inv); rerr != nil {
			log.Printf("AdvanceRun: recording radar investigation (done) failed: %v", rerr)
		}
	}
	// run: carries the sealed evidence to the focused view (RunCompletion needs status==done && evidence).
	publishRunUpdate(channelId, runId)
	if run.Evidence != nil {
		// the seal ctx may be near its deadline after the slow git diff; the append is a quick insert that
		// should not inherit that expiry.
		actx := context.WithoutCancel(ctx)
		appendRunEvent(actx, channelId, runId, waveobj.RunEventKindEvidenceSealed, nil, map[string]any{
			"files": len(run.Evidence.Files), "addtotal": run.Evidence.AddTotal, "deltotal": run.Evidence.DelTotal,
		})
	}
	// the connection producer stamps its candidate from the run's CompletedTs, which the UpdateRun above
	// is what makes durable. Triggering at the rest transition instead would race this seal and always
	// read an unstamped run. Detached: the judge is a headless CLI process.
	jarvisvolunteer.EvaluateAsync(jarvisvolunteer.Trigger{
		Kind: jarvisvolunteer.TriggerRunRest, ChannelID: channelId, RunID: runId,
	})
}

// noteFinishedRunOnChunk leaves the sealed run's note (and its oref, which the Chunk sidebar renders the
// report from) on the chunk it executed. Non-fatal: the note is a pointer, the run itself holds the record.
func noteFinishedRunOnChunk(ctx context.Context, run *waveobj.Run, logPrefix string) {
	if nerr := jarvisstate.NoteRunFinished(ctx, *run.EffortRef, "run:"+run.ID, jarvisstate.RunFinishedText(run)); nerr != nil {
		log.Printf("%s: noting the finished run on its chunk failed (non-fatal): %v", logPrefix, nerr)
	}
}

// spawnRunWorkers starts each newly running phase's worker on the prompt its phase derives.
func spawnRunWorkers(ctx context.Context, channelId, runId, projectName string) error {
	return spawnRunWorkersWithPrompt(ctx, channelId, runId, projectName, "")
}

// LaunchPlanLead is the engine's lead spawner for a run submitted with no lead: the run's own lead route,
// the tree its lanes land in, and prompt in place of the goal-run launch prompt. It fails when no lead was
// attached, so the wake adapter hands the judgment to the human rather than waiting on nobody.
func LaunchPlanLead(ctx context.Context, channelId, runId, prompt string) error {
	ch, err := wstore.DBMustGet[*waveobj.Channel](ctx, channelId)
	if err != nil {
		return fmt.Errorf("loading channel: %w", err)
	}
	if err := spawnRunWorkersWithPrompt(ctx, channelId, runId, ch.Name, prompt); err != nil {
		return err
	}
	run, err := wstore.GetRun(ctx, channelId, runId)
	if err != nil {
		return fmt.Errorf("loading run: %w", err)
	}
	if leadORef(run) == "" {
		return fmt.Errorf("run %s has no running phase to start a lead in", runId)
	}
	return nil
}

// spawnRunWorkersWithPrompt reads the run back, spawns workers for any newly-running phase, and persists the
// attached orefs — a second write, so tab-creation never nests inside the run's state-transition write.
//
// EnsureWorkers creates a tab + block per worker (via wcore.CreateTab), which mutates the workspace's
// tab list and inserts new objects. Those mutations only reach the frontend if this ctx collects and
// flushes their update events — without that, the workspace atom never gains the worker's tab, the tab
// never enters the session roster, and the run renders a false "worker exited" until a full reload.
func spawnRunWorkersWithPrompt(ctx context.Context, channelId, runId, projectName, prompt string) error {
	runSpawnLocks.Lock(runId)
	defer runSpawnLocks.Unlock(runId)
	// detach from the caller's RPC budget (a 5s FE-call ctx): worker spawning calls wcore.CreateTab, and a
	// mid-flight cancellation would orphan a half-created tab. keep parent values, bound with our own deadline.
	ctx = context.WithoutCancel(ctx)
	ctx, cancel := context.WithTimeout(ctx, jarvis.RunWorkerSpawnTimeout)
	defer cancel()
	ctx = waveobj.ContextWithUpdates(ctx)
	run, err := wstore.GetRun(ctx, channelId, runId)
	if err != nil {
		return err
	}
	pin := waveobj.RoutePin{Runtime: runroute.DefaultRuntime(run.Runtime), Model: run.Model}
	cap, routeErr := runroute.Resolve(pin)
	if routeErr != nil {
		return routeErr
	}
	if _, harnessErr := validateHarness(pin.Runtime, harness.OperationRunWorker); harnessErr != nil {
		return harnessErr
	}
	spawned, spawnErr := jarvis.EnsureWorkers(ctx, run, cap, projectName, prompt)
	if len(spawned) > 0 {
		if uerr := wstore.UpdateRun(ctx, channelId, runId, func(r *waveobj.Run) error {
			for idx, w := range spawned {
				if idx >= 0 && idx < len(r.Phases) {
					r.Phases[idx].WorkerOrefs = append(r.Phases[idx].WorkerOrefs, w.ORef)
					r.SessionId = w.SessionId
					r.LeadSessionIds = append(r.LeadSessionIds, w.SessionId)
				}
			}
			return nil
		}); uerr != nil {
			return uerr
		}
		// stamp the owning run/channel oref onto each worker tab so the phase-2 worker→run lookup is a
		// direct meta read (channel-scaling design call 1); best-effort, never fatal to the spawn.
		channelORef := waveobj.MakeORef(waveobj.OType_Channel, channelId).String()
		runORef := waveobj.MakeORef(waveobj.OType_Run, runId).String()
		for _, w := range spawned {
			if serr := wstore.StampWorkerOwner(ctx, w.ORef, runORef, channelORef); serr != nil {
				log.Printf("spawnRunWorkers: stamp worker %s: %v", w.ORef, serr)
			}
		}
	}
	wps.Broker.SendUpdateEvents(waveobj.ContextGetUpdatesRtn(ctx))
	return spawnErr // surfaced but non-fatal to already-persisted state
}

// stopWorkerORef terminates one worker the run owns via the shared jarvis stop implementation.
func stopWorkerORef(ctx context.Context, workerORef string) error {
	return jarvis.StopRunWorker(ctx, workerORef)
}

// stopRunWorkers terminates every live worker the run owns (best-effort; each worker's failure is logged,
// never fatal — the run's cancelled state is already persisted).
func stopRunWorkers(ctx context.Context, run *waveobj.Run) {
	if err := jarvis.StopRunWorkers(ctx, run); err != nil {
		log.Printf("stopRunWorkers: %v", err)
	}
}

// top-level launches opt into the orchestrator explicitly; an unset mode is a quick run. A profile's
// defaultmode reaches a launch through the launcher's own hydrated control, which sends its choice
// explicitly — it cannot reach this fallback, which is why no profile is in scope here. Only childRunPlan
// consults a stored default, and it resolves it before calling in.
func resolveRunPlan(reqMode string) (string, []waveobj.RunPhase) {
	if reqMode == jarvis.RunMode_Orchestrator {
		return reqMode, jarvis.DefaultOrchestratorPlaybook()
	}
	return jarvis.RunMode_Quick, jarvis.QuickPlaybook()
}

// childRunPlan resolves a child's shape from the requested (or inherited) mode. Neither surviving
// playbook gates a phase, so a child never halts for human review; any consequential pause must be an
// explicit task decision gate.
func childRunPlan(resolved waveobj.JarvisProfile, reqMode string) (string, []waveobj.RunPhase) {
	// child inheritance is independent of the top-level launch default.
	if reqMode == "" {
		reqMode = resolved.DefaultMode
	}
	return resolveRunPlan(reqMode)
}

// landRunOnBranch gives an engine run a tree of its own, wave/<runId> at the run's base, and stamps it as
// the run's LandPath. The engine merges that branch back when the run completes (orchestrate.LandRun); its
// lanes never land in the project checkout.
func landRunOnBranch(ctx context.Context, channelId string, run *waveobj.Run) error {
	wt, err := orchestrate.CreateRunWorktree(ctx, run.ProjectPath, run.ID, run.BaseCommit)
	if err != nil {
		return err
	}
	run.LandPath = wt
	return wstore.UpdateRun(ctx, channelId, run.ID, func(r *waveobj.Run) error {
		r.LandPath = wt
		return nil
	})
}

// readCreatedRun reads a just-created run back for the reply. A var so a test can fail the read.
var readCreatedRun = wstore.GetRun

func (ws *WshServer) CreateRunCommand(ctx context.Context, data wshrpc.CommandCreateRunData) (*wshrpc.CommandCreateRunRtnData, error) {
	// a plan start is refused before anything persists: a plan that will not parse, or a shape that cannot
	// run one, must not leave a run behind
	if data.PlanPath != "" {
		if data.Mode != jarvis.RunMode_Orchestrator {
			return nil, fmt.Errorf("planpath needs an orchestrator run: only the engine runs a plan")
		}
		ch, err := wstore.DBMustGet[*waveobj.Channel](ctx, data.ChannelId)
		if err != nil {
			return nil, fmt.Errorf("loading channel: %w", err)
		}
		data.PlanPath = resolvePlanPath(ch.ProjectPath, data.PlanPath)
		plan, err := readPlanFile(data.PlanPath)
		if err != nil {
			return nil, err
		}
		if data.Goal == "" {
			data.Goal = planTitle(plan, data.PlanPath)
		}
		data.Orchestration = jarvis.Orchestration_Engine
	}
	if err := jarvis.ValidateLanding(data.Landing); err != nil {
		return nil, err
	}
	if data.ChannelId == "" || data.WorkspaceId == "" || data.Goal == "" {
		return nil, fmt.Errorf("channelid, workspaceid and goal are required")
	}
	// effortref validated up front so its error path never depends on harness setup
	var effortRef *waveobj.RunEffortRef
	if data.EffortOID != "" {
		eff, err := effortstore.Get(ctx, data.EffortOID)
		if err != nil {
			return nil, fmt.Errorf("EC-UNKNOWN-EFFORT: %v", err)
		}
		if data.ChunkLabel == "" {
			return nil, fmt.Errorf("EC-UNKNOWN-CHUNK: chunklabel is required when effortoid is set")
		}
		if _, err := jarvis.ResolveChunkIndex(eff, data.ChunkLabel); err != nil {
			return nil, err
		}
		effortRef = &waveobj.RunEffortRef{EffortOID: data.EffortOID, ChunkLabel: data.ChunkLabel}
	}
	// Resolve and validate the complete route before loading or persisting any run state.
	cap, err := runroute.Resolve(waveobj.RoutePin{Runtime: data.Runtime, Model: data.Model})
	if err != nil {
		return nil, err
	}
	if _, err := validateHarness(cap.Runtime, harness.OperationRunWorker); err != nil {
		return nil, err
	}
	ch, err := wstore.DBMustGet[*waveobj.Channel](ctx, data.ChannelId)
	if err != nil {
		return nil, fmt.Errorf("loading channel: %w", err)
	}
	global := jarvis.LoadGlobalProfile()
	resolved := jarvis.ResolveProfile(global, jarvis.OverrideFromMeta(ch))
	// Shape first, then machine: the engine dials exist only on an engine launch, so a profile's stored
	// worker route (which can name a harness this machine does not have) must not be hydrated onto a
	// quick or pipeline run and refuse it.
	mode, playbook := resolveRunPlan(data.Mode)
	engineLaunch := mode == jarvis.RunMode_Orchestrator
	if data.Prototype != "" && !engineLaunch {
		return nil, fmt.Errorf("prototype needs an orchestrator run: only the engine's final verifier reads it")
	}
	orchestration := ""
	if engineLaunch {
		orchestration = jarvis.Orchestration_Engine
	}
	if engineLaunch {
		if data.Parallelism == 0 {
			data.Parallelism = resolved.Parallelism
		}
		// a caller that sends the workers setting owns it as sent, so a nil route there is Same as lead
		if data.ReviewerPicks == nil {
			if data.WorkerRoute == nil {
				data.WorkerRoute = resolved.WorkerRoute
			}
			data.ReviewerPicks = &resolved.ReviewerPicks
		}
		if data.ReviewerRoute == nil {
			data.ReviewerRoute = resolved.ReviewerRoute
		}
	}
	reviewerPicks := data.ReviewerPicks != nil && *data.ReviewerPicks
	if err := validateWorkersSetting(data.WorkerRoute, reviewerPicks); err != nil {
		return nil, err
	}
	if err := validateRoute("workerRoute", data.WorkerRoute, true); err != nil {
		return nil, err
	}
	if err := validateRoute("reviewerRoute", data.ReviewerRoute, true); err != nil {
		return nil, err
	}
	run := jarvis.NewRun(data.Goal, data.WorkspaceId, ch.ProjectPath, resolved.Principles, mode, playbook, time.Now().UnixMilli())
	if data.DeferStart {
		run.Status = jarvis.RunStatus_Planning
	}
	run.Runtime = cap.Runtime // immutable after Start; every phase and child inherits this
	run.Model = cap.Model
	run.WorkerRoute = data.WorkerRoute
	run.ReviewerPicks = reviewerPicks
	run.ReviewerRoute = data.ReviewerRoute
	run.Orchestration = orchestration // prompt-shaping only; DagSubmit stays open to either choice
	// out-of-band widths are rejected rather than clamped: a caller asking for 40 workers has a wrong
	// model of the engine, and silently running 8 would hide that.
	if err := validateParallelism(data.Parallelism, true); err != nil {
		return nil, err
	}
	run.Parallelism = data.Parallelism
	run.Prototype = data.Prototype
	// capture the repo baseline so the evidence diff survives the worker committing its changes;
	// non-fatal — an unborn/absent repo just leaves BaseCommit "" and the diff falls back to HEAD.
	if head, herr := gitinfo.HeadCommit(ctx, ch.ProjectPath); herr == nil {
		run.BaseCommit = head
		// the branch the run merges back into; a detached head has none, so its run is never merged back
		run.BaseBranch, _ = gitinfo.CurrentBranch(ctx, ch.ProjectPath)
	}
	run.RadarOrigin = data.RadarOrigin // nil for normal runs; set only from a Radar handoff
	run.OriginTabId = data.OriginTabId
	run.OriginTranscript = tabTranscriptPath(ctx, data.OriginTabId)
	run.EffortRef = effortRef
	if err := wstore.AppendRun(ctx, data.ChannelId, run); err != nil {
		return nil, fmt.Errorf("appending run: %w", err)
	}
	// AppendRun stamps identity on its own copy (it takes the run by value), so mirror it locally:
	// the dossier capture below links [[run-<oid>]] by that key.
	run.OID = run.ID
	run.ChannelOID = data.ChannelId
	// lifecycle log seeded before worker spawn, so a spawn failure still shows the run was created.
	appendRunEvent(ctx, data.ChannelId, run.ID, waveobj.RunEventKindCreated, nil, map[string]any{"runtime": run.Runtime, "mode": run.Mode})
	// an unborn repo has no base to branch from, and a non-git project has no lanes to land
	if engineLaunch && jarvis.EffectiveLanding(data.Landing, resolved.Landing) == jarvis.Landing_Branch && run.BaseCommit != "" {
		if err := landRunOnBranch(ctx, data.ChannelId, &run); err != nil {
			// a run that asked for its own branch must not fall back to landing in the checkout
			if cerr := ws.CancelRunCommand(ctx, wshrpc.CommandCancelRunData{ChannelId: data.ChannelId, RunId: run.ID}); cerr != nil {
				log.Printf("CreateRun: cancelling run %s after its landing tree failed: %v", run.ID, cerr)
			}
			return nil, fmt.Errorf("creating landing tree: %w", err)
		}
	}
	if effortRef != nil {
		// non-fatal: the run is already persisted; a failed attach only loses the live marker, the
		// ref stays on the run itself.
		go func() {
			actx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			if aerr := jarvisstate.AttachRunToChunk(actx, effortRef.EffortOID, effortRef.ChunkLabel, "run:"+run.ID); aerr != nil {
				log.Printf("CreateRun: attaching effort workref failed (non-fatal): %v", aerr)
			}
		}()
	}
	if run.RadarOrigin != nil {
		inv := reporadar.InvestigationFromRun(&run, data.ChannelId, "executing", run.CreatedTs)
		if rerr := reporadar.RecordInvestigation(ctx, run.ProjectPath, run.RadarOrigin.Fingerprint, inv); rerr != nil {
			log.Printf("CreateRun: recording radar investigation (executing) failed: %v", rerr)
		}
	}
	if err := jarviscapture.CaptureRunDispatch(ctx, &run); err != nil {
		log.Printf("CreateRun: capturing dossier failed (non-fatal): %v", err)
	}
	// detached: the volunteer judge is a headless CLI process
	jarvisvolunteer.EvaluateAsync(jarvisvolunteer.Trigger{
		Kind: jarvisvolunteer.TriggerRunCreated, ChannelID: data.ChannelId, RunID: run.ID,
	})
	switch {
	case data.PlanPath != "":
		// the engine starts on the plan now; the lead comes at the first judgment event (spec §1, G5)
		if _, err := ws.DagSubmitCommand(ctx, wshrpc.CommandDagSubmitData{ChannelId: data.ChannelId, RunId: run.ID, PlanPath: data.PlanPath}); err != nil {
			if handSetupToLead(ctx, data.ChannelId, run, data.PlanPath, err) {
				break
			}
			// a run with no dag and no lead would wait in planning forever
			if cerr := ws.CancelRunCommand(ctx, wshrpc.CommandCancelRunData{ChannelId: data.ChannelId, RunId: run.ID}); cerr != nil {
				log.Printf("CreateRun: cancelling run %s after its plan was refused: %v", run.ID, cerr)
			}
			// no dag means no lane ever landed there, so the tree holds nothing but Setup's output
			if run.LandPath != "" {
				if rerr := orchestrate.RemoveRunWorktree(ctx, run.ProjectPath, run.ID); rerr != nil {
					log.Printf("CreateRun: removing run %s's landing tree after its plan was refused: %v", run.ID, rerr)
				}
			}
			return nil, fmt.Errorf("submitting plan: %w", err)
		}
	case !data.DeferStart:
		phaseZero := 0
		appendRunEvent(ctx, data.ChannelId, run.ID, waveobj.RunEventKindPhaseStarted, &phaseZero, map[string]any{})
		if err := spawnRunWorkers(ctx, data.ChannelId, run.ID, ch.Name); err != nil {
			// the run is persisted; surface the spawn failure but return the run so the UI can show blocked/retry
			wcore.SendWaveObjUpdate(waveobj.MakeORef(waveobj.OType_Channel, data.ChannelId))
			return nil, fmt.Errorf("spawning first worker: %w", err)
		}
	}
	out, err := readCreatedRun(ctx, data.ChannelId, run.ID)
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
		// an engine launch can outlast the handler's budget, and the ctx that expired cannot also be the
		// thing that reports a durable run as a failed launch. Key off the error, not ctx.Err().
		out, err = readCreatedRun(context.WithoutCancel(ctx), data.ChannelId, run.ID)
	}
	// the run exists either way, so its channel's run list must still refresh
	wcore.SendWaveObjUpdate(waveobj.MakeORef(waveobj.OType_Channel, data.ChannelId))
	if err != nil {
		// A run that is persisted and whose workers are spawned has launched, so a failed read-back is
		// not a failed launch. Replying with the copy we hold keeps the launcher from telling the user
		// the run failed while the run is running in front of them; run.OID and run.ChannelOID were
		// mirrored above, which is everything the caller needs to open it.
		log.Printf("CreateRun: run %s was created, but reading it back failed (non-fatal): %v", run.ID, err)
		out = &run
	}
	return &wshrpc.CommandCreateRunRtnData{Run: out}, nil
}

// handSetupToLead starts a plan start's lead on its failed Setup, and reports whether it did. The run and its
// landing tree stay for the lead's resubmit. Any other refusal, or a lead that cannot start, stays a refusal.
func handSetupToLead(ctx context.Context, channelId string, run waveobj.Run, planPath string, err error) bool {
	var failed *setupFailedError
	if !errors.As(err, &failed) {
		return false
	}
	wake := setupRepairWake(planPath, failed)
	if lerr := LaunchPlanLead(ctx, channelId, run.ID, jarvis.PlanLeadPrompt(run.Principles, run.ID, "", planPath, wake)); lerr != nil {
		log.Printf("CreateRun: no lead to take run %s's failed setup: %v", run.ID, lerr)
		return false
	}
	appendRunEvent(ctx, channelId, run.ID, waveobj.RunEventKindLeadLaunched, nil, map[string]any{"text": wake})
	return true
}

// setupRepairWake is the lead's brief: nothing has started, and whether the fix is the plan's Setup line or
// the project is the lead's call, or the user's when the lead cannot tell
func setupRepairWake(planPath string, failed *setupFailedError) string {
	return fmt.Sprintf("The plan's Setup failed in the landing tree %s, so no task has started.\n"+
		"Setup: `%s`\nIts output ends:\n%s\n\n"+
		"Find the cause. If the Setup line is wrong for this project, change that line (and only that line: the "+
		"tasks stay as written) in the plan at %s and resubmit with `wsh jarvis dag submit --plan %s`, then stop; "+
		"a resubmit runs Setup again in the same tree, and the engine wakes you when something needs judgment. "+
		"If the project itself needs a fix, or you cannot tell which, ask the human rather than guess.",
		failed.landPath, failed.command, failed.tail, planPath, planPath)
}

func (ws *WshServer) CreateChildRunCommand(ctx context.Context, data wshrpc.CommandCreateChildRunData) (*wshrpc.CommandCreateChildRunRtnData, error) {
	if data.ORef == "" || data.Goal == "" {
		return nil, fmt.Errorf("oref and goal are required")
	}
	m := jarvis.ResolveRunWorkerFromMeta(ctx, data.ORef)
	if m == nil {
		return nil, fmt.Errorf("no run owns oref %q", data.ORef)
	}
	channelId := m.Channel.OID
	parent := m.Run
	mode := data.Mode
	if mode == "" {
		mode = parent.Mode // inherit the channel strategy the parent run was created with
	}
	resolved := jarvis.ResolveProfile(jarvis.LoadGlobalProfile(), jarvis.OverrideFromMeta(m.Channel))
	pin := waveobj.RoutePin{Runtime: runroute.DefaultRuntime(parent.Runtime), Model: parent.Model}
	cap, err := runroute.Resolve(pin)
	if err != nil {
		return nil, err
	}
	if _, err := validateHarness(pin.Runtime, harness.OperationRunWorker); err != nil {
		return nil, err
	}
	childMode, playbook := childRunPlan(resolved, mode)
	child := jarvis.NewRun(data.Goal, parent.WorkspaceId, parent.ProjectPath, parent.Principles, childMode, playbook, time.Now().UnixMilli())
	// Children inherit the parent's route server-side; an empty parent runtime becomes explicit claude
	// so the child is never re-resolved as a legacy object.
	child.Runtime = cap.Runtime
	child.Model = cap.Model
	child.ParentLeadORef = data.ORef
	if head, herr := gitinfo.HeadCommit(ctx, parent.ProjectPath); herr == nil {
		child.BaseCommit = head
	}
	if err := wstore.AppendRun(ctx, channelId, child); err != nil {
		return nil, fmt.Errorf("appending child run: %w", err)
	}
	if err := spawnRunWorkers(ctx, channelId, child.ID, m.Channel.Name); err != nil {
		wcore.SendWaveObjUpdate(waveobj.MakeORef(waveobj.OType_Channel, channelId))
		return nil, fmt.Errorf("spawning child worker: %w", err)
	}
	phaseZero := 0
	appendRunEvent(ctx, channelId, child.ID, waveobj.RunEventKindChildCreated, nil, map[string]any{
		"childrunid": child.ID, "goal": child.Goal, "mode": child.Mode,
	})
	appendRunEvent(ctx, channelId, child.ID, waveobj.RunEventKindPhaseStarted, &phaseZero, map[string]any{})
	wcore.SendWaveObjUpdate(waveobj.MakeORef(waveobj.OType_Channel, channelId))
	return &wshrpc.CommandCreateChildRunRtnData{RunId: child.ID}, nil
}

// steerRunLead sends a line of input into the block of a run worker (tab oref "tab:<id>"), resuming a
// long-lived lead in place. Best-effort: resolution/send failures are logged, never fatal. It is a var so
// tests can observe the parent notify-back without a live PTY.
var steerRunLead = func(ctx context.Context, tabORef, text string) {
	oref, err := waveobj.ParseORef(tabORef)
	if err != nil || oref.OType != waveobj.OType_Tab {
		log.Printf("steerRunLead: bad oref %q: %v", tabORef, err)
		return
	}
	tab, err := wstore.DBMustGet[*waveobj.Tab](ctx, oref.OID)
	if err != nil || len(tab.BlockIds) == 0 {
		log.Printf("steerRunLead: no block for %q: %v", tabORef, err)
		return
	}
	if err := blockcontroller.SendInput(tab.BlockIds[0], &blockcontroller.BlockInputUnion{InputData: []byte(text)}); err != nil {
		log.Printf("steerRunLead: sending input to %q: %v", tabORef, err)
	}
}

// applyRunAction dispatches a run action to the matching engine transition (pure; no persistence).
// Triage is non-blocking — it records the lead's verdict and leaves progress untouched.
func applyRunAction(r waveobj.Run, data wshrpc.CommandAdvanceRunData, ts int64) (waveobj.Run, error) {
	switch data.Action {
	case jarvis.RunAction_Complete:
		next, err := jarvis.CompletePhase(r, data.PhaseIdx, data.Artifacts, ts)
		if err == nil && data.Commit != "" {
			next.EndCommit = data.Commit // the run's reported result commit; scopes the sealed evidence diff
		}
		if err == nil && data.Report != "" {
			next.Report = data.Report // the lead's final report; SealEvidence uses it as the summary
		}
		return next, err
	default:
		return r, fmt.Errorf("unknown run action %q", data.Action)
	}
}

// ownsDag reports whether run is the one its dag belongs to, not one of the dag's task runs, which carry
// the same DagORef.
func ownsDag(ctx context.Context, run *waveobj.Run) bool {
	if run.DagORef == "" {
		return false
	}
	g, err := wstore.GetDag(ctx, run.DagORef)
	return err == nil && g.RunID == run.ID
}

// resumeRefusal is why a run's failed phase cannot be resumed, or "" when it can. The worker's tab is
// checked by the restart itself.
func resumeRefusal(run *waveobj.Run, phaseIdx int) string {
	switch {
	case run.DagORef != "":
		return "a run with a submitted plan is the engine's to restart"
	case phaseIdx < 0 || phaseIdx >= len(run.Phases):
		return fmt.Sprintf("phase index %d out of range", phaseIdx)
	case run.Phases[phaseIdx].State != jarvis.PhaseState_Failed:
		return fmt.Sprintf("phase %d is %q, not failed", phaseIdx, run.Phases[phaseIdx].State)
	case len(run.Phases[phaseIdx].WorkerOrefs) == 0:
		return "the phase never had a worker"
	case run.SessionId == "":
		return "the run has no session to resume"
	}
	if _, ok := jarvis.ResumeWorkerArgs(run.Runtime, run.SessionId, nil); !ok {
		return fmt.Sprintf("runtime %q cannot resume a session", run.Runtime)
	}
	return ""
}

// resumeRun puts a failed phase back to running and restarts its worker in its own session and tab. The phase
// is running before the worker starts, so a worker that exits at once, or never starts, fails it again through
// the exit hook like any other exit; a restart that errors outright is rolled back to failed.
func resumeRun(ctx context.Context, channelId, runId string, phaseIdx int) error {
	var worker, runtime, sessionId string
	err := wstore.UpdateRun(ctx, channelId, runId, func(r *waveobj.Run) error {
		if reason := resumeRefusal(r, phaseIdx); reason != "" {
			return errors.New(reason)
		}
		workers := r.Phases[phaseIdx].WorkerOrefs
		worker, runtime, sessionId = workers[len(workers)-1], r.Runtime, r.SessionId
		next, e := jarvis.ResumePhase(*r, phaseIdx)
		if e != nil {
			return e
		}
		*r = next
		return nil
	})
	if err != nil {
		return fmt.Errorf("cannot resume run %s: %w", runId, err)
	}
	if rerr := jarvis.ResumeRunWorker(ctx, worker, runtime, sessionId); rerr != nil {
		if err := wstore.UpdateRun(ctx, channelId, runId, func(r *waveobj.Run) error {
			if r.Phases[phaseIdx].State != jarvis.PhaseState_Running {
				return nil // the exit hook already failed it
			}
			next, e := jarvis.FailPhase(*r, phaseIdx, time.Now().UnixMilli())
			if e != nil {
				return e
			}
			*r = next
			return nil
		}); err != nil {
			log.Printf("resume: rolling back run %s phase %d: %v", runId, phaseIdx, err)
		}
		publishRunUpdate(channelId, runId)
		return fmt.Errorf("resuming run %s: %w", runId, rerr)
	}
	appendRunEvent(ctx, channelId, runId, waveobj.RunEventKindWorkerResumed, phaseIdxOf(phaseIdx), map[string]any{})
	publishRunUpdate(channelId, runId)
	return nil
}

func (ws *WshServer) AdvanceRunCommand(ctx context.Context, data wshrpc.CommandAdvanceRunData) error {
	if data.ChannelId == "" || data.RunId == "" {
		return fmt.Errorf("channelid and runid are required")
	}
	if data.Action == jarvis.RunAction_Resume {
		return resumeRun(ctx, data.ChannelId, data.RunId, data.PhaseIdx)
	}
	preStatus := ""
	var preRun *waveobj.Run
	if pre, perr := wstore.GetRun(ctx, data.ChannelId, data.RunId); perr == nil {
		preStatus = pre.Status
		preRun = pre
	}
	// the engine already closed this run (its lead could not be woken when the DAG finished), so the
	// done transition's side effects have run: only the report is new
	if data.Action == jarvis.RunAction_Complete && data.Report != "" && preStatus == jarvis.RunStatus_Done {
		return attachLateReport(ctx, data)
	}
	// a lead ends its plan run with a bare `wsh jarvis complete`. Every task landed through the engine's
	// merges, so the head of the tree they land in is the run's work, as it is for a run the engine closes with no lead
	// (orchestrate.MaybeCompleteLeadFreeRun). Without it the seal diffs the working tree, where the
	// engine's own .waveterm files sit untracked.
	if data.Action == jarvis.RunAction_Complete && data.Commit == "" && preRun != nil && ownsDag(ctx, preRun) {
		if head, herr := gitinfo.HeadCommit(ctx, jarvis.LandPath(preRun)); herr == nil {
			data.Commit = head
		}
	}
	if data.Action == jarvis.RunAction_Complete && preRun != nil && preRun.TaskId != "" && !preRun.Review && strings.TrimSpace(data.Report) == "" {
		path := orchestrate.WorkerReportPath(preRun.DagORef, preRun.TaskId)
		return fmt.Errorf("%s: write your report to %s as:\n%s\nthen run wsh jarvis complete --commit <sha> --report %s", ErrWorkerReportRequired, path, jarvis.WorkerReportTemplate, path)
	}
	if data.Action == jarvis.RunAction_Complete && preRun != nil && preRun.TaskId != "" && !preRun.Review {
		if _, perr := jarvis.ParseWorkerReport(data.Report); perr != nil {
			path := orchestrate.WorkerReportPath(preRun.DagORef, preRun.TaskId)
			return fmt.Errorf("%s: %s: %v. Rewrite it as:\n%s\nthen run wsh jarvis complete --commit <sha> --report %s", ErrWorkerReportRequired, path, perr, jarvis.WorkerReportTemplate, path)
		}
	}
	// the land runs after complete has closed the lead's tab, so a conflict it would hold on is the lead's to fix now
	if data.Action == jarvis.RunAction_Complete && !data.HoldLand && preRun != nil && preRun.TaskId == "" && preStatus != jarvis.RunStatus_Done {
		if files, cerr := orchestrate.LandConflicts(ctx, preRun); cerr != nil {
			log.Printf("AdvanceRun: run %s: %v", preRun.ID, cerr)
		} else if len(files) > 0 {
			return fmt.Errorf("run %s would not land: wave/%s conflicts with %s in %s. Merge %s into this tree, resolve, commit, then complete again. If the human decides to leave the conflict for later, complete with --hold-land", preRun.ID, preRun.ID, preRun.BaseBranch, strings.Join(files, ", "), preRun.BaseBranch)
		}
	}
	ts := time.Now().UnixMilli()
	err := wstore.UpdateRun(ctx, data.ChannelId, data.RunId, func(r *waveobj.Run) error {
		next, e := applyRunAction(*r, data, ts)
		if e != nil {
			return e
		}
		*r = next
		return nil
	})
	if err != nil {
		return fmt.Errorf("advancing run: %w", err)
	}
	post, _ := wstore.GetRun(ctx, data.ChannelId, data.RunId)
	switch data.Action {
	case jarvis.RunAction_Complete:
		appendRunEvent(ctx, data.ChannelId, data.RunId, waveobj.RunEventKindPhaseComplete, phaseIdxOf(data.PhaseIdx), map[string]any{"artifacts": data.Artifacts, "commit": data.Commit})
	}
	// record phase-started for every phase the transition just put in the running state (complete
	// auto-starts the successor; approve starts the phase after the gate). The rows land under the
	// phase group, so a group without its started row would narrate an empty phase.
	if post != nil {
		for i := range post.Phases {
			if post.Phases[i].State != jarvis.PhaseState_Running {
				continue
			}
			if preRun == nil || i >= len(preRun.Phases) || preRun.Phases[i].State != jarvis.PhaseState_Running {
				appendRunEvent(ctx, data.ChannelId, data.RunId, waveobj.RunEventKindPhaseStarted, phaseIdxOf(i), map[string]any{})
			}
		}
	}
	// on the non-done -> done transition: dispatch the evidence seal off the RPC budget, then notify the
	// parent lead (if this is a child run). The notify is keyed on Done, not on evidence, so an empty-diff
	// run still wakes its parent. Reached once per run: applyRunAction errors on an already-done run.
	if run, gerr := wstore.GetRun(ctx, data.ChannelId, data.RunId); gerr == nil && run.Status == jarvis.RunStatus_Done {
		if run.Evidence == nil {
			// the seal runs a git diff + transcript reads that can outlast the caller's short client timeout;
			// blocking the handler on it surfaced as EC-TIME even though the transition above had already
			// persisted. It's best-effort and idempotent, with SealRunEvidenceCommand as the backfill — so
			// dispatch it off-band and let the RPC return as soon as the transition is durable.
			channelId, runId := data.ChannelId, data.RunId
			sealAsync(func() { sealThenLand(channelId, runId) })
		}
		// parent-notify stays synchronous: it's a cheap PTY input send, and a child's parent must learn its
		// child is done as soon as the transition lands, not whenever the background seal happens to finish.
		if line, ok := jarvis.ParentNotifyLine(run); ok {
			steerRunLead(ctx, run.ParentLeadORef, line)
			// record the child's terminal state on the PARENT run's log so the lead's timeline shows it.
			if m := jarvis.ResolveRunWorkerFromMeta(ctx, run.ParentLeadORef); m != nil && m.Run != nil {
				kind := waveobj.RunEventKindChildDone
				summary := ""
				if run.Status == jarvis.RunStatus_Cancelled {
					kind = waveobj.RunEventKindChildCancelled
				} else if run.Evidence != nil {
					summary = fmt.Sprintf("%d files +%d/-%d", len(run.Evidence.Files), run.Evidence.AddTotal, run.Evidence.DelTotal)
				}
				appendRunEvent(ctx, m.Channel.OID, m.Run.ID, kind, nil, map[string]any{
					"childrunid": run.ID, "goal": run.Goal, "summary": summary,
				})
			}
		}
		// engine-owned DAGs: a terminal child wakes its group's scheduler (derive + next spawns).
		if grp, gerr := orchestrate.GroupForRun(ctx, run.ChannelOID, run.ID); gerr == nil {
			// the transition is durable; the tick it pokes can merge, run Setup and spawn, which outlasts the
			// child's RPC budget and reads to the child as a failed complete (run 28caa81f's t-4)
			scheduleDag(grp.OID)
		}
	}
	// continuity (sub-project E): on entering a rest state (awaiting-review | blocked | done), write the
	// dossier's narrative "where it stands" summary off the RPC budget. Non-fatal; a detached context so
	// it outlives this handler.
	if postRun, gerr := wstore.GetRun(ctx, data.ChannelId, data.RunId); gerr == nil &&
		jarviscontinuity.IsRestState(postRun.Status) && postRun.Status != preStatus {
		run := *postRun
		channelId, runId := data.ChannelId, data.RunId
		captureAsync(func() {
			cctx, cancel := context.WithTimeout(context.Background(), continuityCaptureTimeout)
			defer cancel()
			card, cerr := jarviscontinuity.CaptureRunBoundary(cctx, &run)
			if cerr != nil {
				log.Printf("AdvanceRun: continuity capture failed (non-fatal): %v", cerr)
				return
			}
			if card == nil {
				return // no dossier references this run, or it has no narrative yet
			}
			// persist the narrative onto the run so returning to it resurfaces where it stands with no
			// second model call.
			if uerr := wstore.UpdateRun(cctx, channelId, runId, func(r *waveobj.Run) error {
				if r.Meta == nil {
					r.Meta = waveobj.MetaMapType{}
				}
				r.Meta[jarviscontinuity.MetaKeyResume] = *card
				// a later boundary means the narrative changed, so an earlier dismissal is stale.
				delete(r.Meta, jarviscontinuity.MetaKeyResumeDismissed)
				return nil
			}); uerr != nil {
				log.Printf("AdvanceRun: persisting resume card failed (non-fatal): %v", uerr)
				return
			}
			wcore.SendWaveObjUpdate(waveobj.MakeORef(waveobj.OType_Channel, channelId))
		})
	}
	ch, err := wstore.DBMustGet[*waveobj.Channel](ctx, data.ChannelId)
	if err != nil {
		return fmt.Errorf("loading channel: %w", err)
	}
	if err := spawnRunWorkers(ctx, data.ChannelId, data.RunId, ch.Name); err != nil {
		publishRunUpdate(data.ChannelId, data.RunId)
		return fmt.Errorf("spawning next worker: %w", err)
	}
	publishRunUpdate(data.ChannelId, data.RunId)
	// auto-close orchestrator lead when both run and DAG are terminal
	if freshRun, err := wstore.GetRun(ctx, data.ChannelId, data.RunId); err == nil && freshRun.DagORef != "" && (freshRun.Status == jarvis.RunStatus_Done || freshRun.Status == jarvis.RunStatus_Cancelled) {
		if dag, err := wstore.GetDag(ctx, freshRun.DagORef); err == nil {
			_, _ = orchestrate.MaybeCloseOrchestratorLead(ctx, freshRun, dag)
		}
	}
	return nil
}

func attachLateReport(ctx context.Context, data wshrpc.CommandAdvanceRunData) error {
	err := wstore.UpdateRun(ctx, data.ChannelId, data.RunId, func(r *waveobj.Run) error {
		next, e := jarvis.AttachReport(*r, data.Report)
		if e != nil {
			return e
		}
		*r = next
		return nil
	})
	if err != nil {
		return fmt.Errorf("attaching report: %w", err)
	}
	publishRunUpdate(data.ChannelId, data.RunId)
	// `complete` promises to close the lead's tab; a lead reporting late is still sitting in it
	if run, gerr := wstore.GetRun(ctx, data.ChannelId, data.RunId); gerr == nil && run.DagORef != "" {
		if dag, derr := wstore.GetDag(ctx, run.DagORef); derr == nil {
			_, _ = orchestrate.MaybeCloseOrchestratorLead(ctx, run, dag)
		}
	}
	return nil
}

func (ws *WshServer) ReportRunPhaseCommand(ctx context.Context, data wshrpc.CommandReportRunPhaseData) error {
	if data.ORef == "" {
		return fmt.Errorf("oref is required")
	}
	m := jarvis.ResolveRunWorkerFromMeta(ctx, data.ORef)
	if m == nil {
		log.Printf("ReportRunPhase: no run owns oref %q (ignoring)", data.ORef)
		return nil // fail safe: a stray report is a no-op, not an error
	}
	return ws.AdvanceRunCommand(ctx, wshrpc.CommandAdvanceRunData{
		ChannelId: m.Channel.OID,
		RunId:     m.Run.ID,
		PhaseIdx:  m.PhaseIdx,
		Action:    data.Action,
		Artifacts: data.Artifacts,
		Verdict:   data.Verdict,
		Note:      data.Note,
		Commit:    data.Commit,
		Report:    data.Report,
		HoldLand:  data.HoldLand,
	})
}

func (ws *WshServer) CancelRunCommand(ctx context.Context, data wshrpc.CommandCancelRunData) error {
	if data.ChannelId == "" || data.RunId == "" {
		return fmt.Errorf("channelid and runid are required")
	}
	// owner DAG run cancellation goes through the DAG authority
	linkedRun, err := wstore.GetRun(ctx, data.ChannelId, data.RunId)
	if err != nil {
		return fmt.Errorf("loading run: %w", err)
	}
	// done is terminal and the rewrite to cancelled cannot be undone, so a stale caller must not get it
	if linkedRun.Status == jarvis.RunStatus_Done {
		return fmt.Errorf("run %s is done; a finished run cannot be cancelled", data.RunId)
	}
	if linkedRun.DagORef != "" {
		grp, err := wstore.GetDag(ctx, linkedRun.DagORef)
		if err != nil {
			return fmt.Errorf("loading linked dag %s: %w", linkedRun.DagORef, err)
		}
		if grp.RunID == linkedRun.ID {
			cerr := orchestrate.Cancel(ctx, linkedRun.DagORef)
			appendRunEvent(ctx, data.ChannelId, data.RunId, waveobj.RunEventKindRunCancelled, nil, map[string]any{})
			if linkedRun.RadarOrigin != nil {
				inv := reporadar.InvestigationFromRun(linkedRun, data.ChannelId, "cancelled", time.Now().UnixMilli())
				if rerr := reporadar.RecordInvestigation(ctx, linkedRun.ProjectPath, linkedRun.RadarOrigin.Fingerprint, inv); rerr != nil {
					log.Printf("CancelRun: recording radar investigation (cancelled) failed: %v", rerr)
				}
			}
			publishRunUpdate(data.ChannelId, data.RunId)
			if cerr == nil {
				if dag, err := wstore.GetDag(ctx, linkedRun.DagORef); err == nil {
					if freshRun, err := wstore.GetRun(ctx, data.ChannelId, data.RunId); err == nil {
						_, _ = orchestrate.MaybeCloseOrchestratorLead(ctx, freshRun, dag)
					}
				}
			}
			if cerr != nil {
				return fmt.Errorf("cancelling dag: %w", cerr)
			}
			return nil
		}
	}
	err = wstore.UpdateRun(ctx, data.ChannelId, data.RunId, func(r *waveobj.Run) error {
		*r = jarvis.CancelRun(*r)
		return nil
	})
	if err != nil {
		return fmt.Errorf("cancelling run: %w", err)
	}
	if run, gerr := wstore.GetRun(ctx, data.ChannelId, data.RunId); gerr == nil {
		appendRunEvent(ctx, data.ChannelId, data.RunId, waveobj.RunEventKindRunCancelled, nil, map[string]any{})
		stopRunWorkers(ctx, run)
		if line, ok := jarvis.ParentNotifyLine(run); ok {
			steerRunLead(ctx, run.ParentLeadORef, line)
		}
		if grp, gerr := orchestrate.GroupForRun(ctx, run.ChannelOID, run.ID); gerr == nil {
			if serr := orchestrate.Schedule(ctx, grp.OID); serr != nil {
				log.Printf("dag schedule error: %v", serr)
			}
		}
		if run.RadarOrigin != nil {
			inv := reporadar.InvestigationFromRun(run, data.ChannelId, "cancelled", time.Now().UnixMilli())
			if rerr := reporadar.RecordInvestigation(ctx, run.ProjectPath, run.RadarOrigin.Fingerprint, inv); rerr != nil {
				log.Printf("CancelRun: recording radar investigation (cancelled) failed: %v", rerr)
			}
		}
	} else {
		log.Printf("CancelRun: reload for worker stop failed: %v", gerr)
	}
	publishRunUpdate(data.ChannelId, data.RunId)
	if run, err := wstore.GetRun(ctx, data.ChannelId, data.RunId); err == nil && run.DagORef != "" {
		if dag, err := wstore.GetDag(ctx, run.DagORef); err == nil {
			_, _ = orchestrate.MaybeCloseOrchestratorLead(ctx, run, dag)
		}
	}
	return nil
}

// StopRunWorkerCommand stops one worker the run owns — the per-worker action of the cancelled-run
// partial-failure surface (its only caller). The guard is ownership only (RunOwnsWorker), not a
// run-status check: the command is a general owned-worker stop, and the cancelled-ness lives in the FE
// that calls it. The kill's success is observed via the roster flipping to idle (the FE re-derives
// survivors); this returns an error only for validation / ownership failures.
func (ws *WshServer) StopRunWorkerCommand(ctx context.Context, data wshrpc.CommandStopRunWorkerData) error {
	if data.ChannelId == "" || data.RunId == "" || data.WorkerORef == "" {
		return fmt.Errorf("channelid, runid and workeroref are required")
	}
	run, err := wstore.GetRun(ctx, data.ChannelId, data.RunId)
	if err != nil {
		return fmt.Errorf("loading run: %w", err)
	}
	if !jarvis.RunOwnsWorker(run, data.WorkerORef) {
		return fmt.Errorf("run %s does not own worker %s", data.RunId, data.WorkerORef)
	}
	if serr := stopWorkerORef(ctx, data.WorkerORef); serr != nil {
		return fmt.Errorf("stopping worker: %w", serr)
	}
	wcore.SendWaveObjUpdate(waveobj.MakeORef(waveobj.OType_Channel, data.ChannelId))
	return nil
}

// RunTranscriptPathCommand finds a run's transcript by the session id it was launched under, so a worker
// whose tab is gone can still be read.
func (ws *WshServer) RunTranscriptPathCommand(ctx context.Context, data wshrpc.CommandRunTranscriptPathData) (string, error) {
	if data.ChannelId == "" || data.RunId == "" {
		return "", fmt.Errorf("channelid and runid are required")
	}
	run, err := wstore.GetRun(ctx, data.ChannelId, data.RunId)
	if err != nil {
		return "", fmt.Errorf("loading run: %w", err)
	}
	return jarvis.SessionTranscriptPath(run), nil
}

// RunUsageCommand totals a run's tokens the way its sealed evidence does, so a live run and a finished one
// read from one accounting.
func (ws *WshServer) RunUsageCommand(ctx context.Context, data wshrpc.CommandRunUsageData) (*wshrpc.CommandRunUsageRtnData, error) {
	if data.ChannelId == "" || data.RunId == "" {
		return nil, fmt.Errorf("channelid and runid are required")
	}
	run, err := wstore.GetRun(ctx, data.ChannelId, data.RunId)
	if err != nil {
		return nil, fmt.Errorf("loading run: %w", err)
	}
	if run.Evidence != nil && len(run.Evidence.Usage) > 0 {
		return &wshrpc.CommandRunUsageRtnData{Usage: run.Evidence.Usage, Sealed: true}, nil
	}
	children := jarvis.DagChildRuns(ctx, data.ChannelId, run.DagORef, run.ID)
	return &wshrpc.CommandRunUsageRtnData{Usage: jarvis.RunUsage(ctx, run, children)}, nil
}

// LandRunCommand merges a done branch-landed run's branch back into its base, the retry for a held land. It
// runs detached from the caller's budget: a land can re-run Check and Verify, and a merge cut off halfway
// would leave the human's checkout mid-merge.
func (ws *WshServer) LandRunCommand(ctx context.Context, data wshrpc.CommandLandRunData) (*waveobj.RunLand, error) {
	if data.ChannelId == "" || data.RunId == "" {
		return nil, fmt.Errorf("channelid and runid are required")
	}
	lctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), orchestrate.LandTimeout)
	defer cancel()
	land, err := orchestrate.LandRun(lctx, data.ChannelId, data.RunId, data.Force)
	if err != nil {
		return nil, err
	}
	if land == nil {
		return nil, fmt.Errorf("run %s landed in the checkout, so it has no branch to merge back", data.RunId)
	}
	return land, nil
}

// AckRunCommand records that the human read a done run's unverified outcome, which clears its attention item.
func (ws *WshServer) AckRunCommand(ctx context.Context, data wshrpc.CommandAckRunData) error {
	if data.ChannelId == "" || data.RunId == "" {
		return fmt.Errorf("channelid and runid are required")
	}
	if err := wstore.UpdateRun(ctx, data.ChannelId, data.RunId, func(r *waveobj.Run) error {
		r.VerificationAckTs = time.Now().UnixMilli()
		return nil
	}); err != nil {
		return fmt.Errorf("acknowledging run: %w", err)
	}
	publishRunUpdate(data.ChannelId, data.RunId)
	return nil
}

// RunAsksCommand lists the pending question on a run's own session, for `wsh runs show`. A task's asks are its
// dag's (`dag asks`); this is the lead's own AskUserQuestion, which no dag command reaches.
func (ws *WshServer) RunAsksCommand(ctx context.Context, data wshrpc.CommandRunAskData) (*wshrpc.CommandDagAsksRtnData, error) {
	run, err := wstore.GetRun(ctx, data.ChannelId, data.RunId)
	if err != nil {
		return nil, fmt.Errorf("loading run: %w", err)
	}
	rtn := &wshrpc.CommandDagAsksRtnData{Asks: []wshrpc.DagAskItem{}}
	if bo, p, ok := pendingRunAsk(ctx, run); ok && len(p.Questions) > 0 {
		rtn.Asks = append(rtn.Asks, wshrpc.DagAskItem{AskId: p.AskId, Owner: p.Owner, Deadline: p.Deadline, Note: p.Note, Questions: p.Questions, BlockORef: bo, Ts: p.Ts})
	}
	return rtn, nil
}

// RunAnswerCommand answers a run's own pending question through the same delivery as the cockpit's ask card.
func (ws *WshServer) RunAnswerCommand(ctx context.Context, data wshrpc.CommandRunAnswerData) error {
	run, err := wstore.GetRun(ctx, data.ChannelId, data.RunId)
	if err != nil {
		return fmt.Errorf("loading run: %w", err)
	}
	bo, _, ok := pendingRunAsk(ctx, run)
	if !ok {
		return fmt.Errorf("run %s has no pending question", data.RunId)
	}
	return ws.AnswerAgentCommand(ctx, wshrpc.CommandAnswerAgentData{ORef: bo, Answers: data.Answers})
}

// SealRunEvidenceCommand derives and persists a done run's evidence snapshot if it has none yet — the
// lazy backfill for runs completed before the feature existed (new runs seal at completion in
// AdvanceRun). Idempotent: a run already sealed is a no-op. Only seals runs in the done state.
func (ws *WshServer) SealRunEvidenceCommand(ctx context.Context, data wshrpc.CommandSealRunEvidenceData) error {
	if data.ChannelId == "" || data.RunId == "" {
		return fmt.Errorf("channelid and runid are required")
	}
	run, err := wstore.GetRun(ctx, data.ChannelId, data.RunId)
	if err != nil {
		return fmt.Errorf("loading run: %w", err)
	}
	if run.Status != jarvis.RunStatus_Done || run.Evidence != nil {
		return nil // nothing to seal
	}
	// detach from the FE-call budget so a slow git diff isn't canceled into an empty snapshot; on a git
	// failure/timeout SealEvidence returns an error and leaves Evidence nil, so this backfill can retry.
	sealCtx, sealCancel := context.WithTimeout(context.WithoutCancel(ctx), evidenceSealTimeout)
	serr := jarvis.SealEvidence(sealCtx, run)
	sealCancel()
	if serr != nil || run.Evidence == nil {
		return serr
	}
	ev, completedTs := run.Evidence, run.CompletedTs
	if uerr := wstore.UpdateRun(ctx, data.ChannelId, data.RunId, func(r *waveobj.Run) error {
		if r.Evidence == nil {
			r.Evidence = ev
			r.CompletedTs = completedTs
		}
		return nil
	}); uerr != nil {
		return fmt.Errorf("persisting evidence: %w", uerr)
	}
	if run.EffortRef != nil {
		// a sealed run no longer claims its chunk; the workref is advisory, so a failure here only
		// leaves a stale marker, and the next seal attempt (idempotent backfill) re-runs the detach.
		if derr := jarvisstate.DetachRunFromChunk(ctx, run.EffortRef.EffortOID, "run:"+run.ID); derr != nil {
			log.Printf("SealRunEvidence: detaching effort workref failed (non-fatal): %v", derr)
		}
		noteFinishedRunOnChunk(ctx, run, "SealRunEvidence")
	}
	if run.RadarOrigin != nil {
		inv := reporadar.InvestigationFromRun(run, data.ChannelId, "done", run.CompletedTs)
		if rerr := reporadar.RecordInvestigation(ctx, run.ProjectPath, run.RadarOrigin.Fingerprint, inv); rerr != nil {
			log.Printf("SealRunEvidence: recording radar investigation (done) failed: %v", rerr)
		}
	}
	publishRunUpdate(data.ChannelId, data.RunId)
	return nil
}
