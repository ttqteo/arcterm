// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wcore"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// Final stage states (TaskGroup.Final.State). Empty is a round set up but not started.
const (
	FinalState_Checking   = "checking"  // Check, Verify, then the Final command, are running; with no Final command the verifier works alongside
	FinalState_Final      = "final"     // Check and Verify passed; the Final command is running
	FinalState_Verifying  = "verifying" // the deterministic steps passed; the verifier session judges the result
	FinalState_Passed     = "passed"
	FinalState_Unverified = "unverified" // nothing failed, but something could not be verified
	FinalState_Failed     = "failed"
)

// Final stage steps (FinalStage.Step): the command running while the stage is checking or final.
const (
	FinalStep_Tree   = "tree" // making the stage's tree, with Setup when the stage makes its own
	FinalStep_Check  = "check"
	FinalStep_Verify = "verify"
	FinalStep_Final  = "final"
)

// FinalExitUnverified is the Final command's exit code for "could not verify": its last output line says why.
// Any other non-zero exit is a failure.
const FinalExitUnverified = 3

// MaxFinalRounds is how many times the final stage runs on one dag: the first, and one fix round.
const MaxFinalRounds = 2

// FinalTimeout bounds the Final command. A dev-app check boots the app first (up to 10 minutes) and then
// runs its scenarios, so it is longer than Verify's.
const FinalTimeout = 30 * time.Minute

// finalOutEnv names the directory the Final command writes its screenshots and reports into.
const finalOutEnv = "ARC_FINAL_OUT"

// finalCommandTimeout is FinalTimeout, a var so a test can time a hanging command out in a second.
var finalCommandTimeout = FinalTimeout

// finalFinished is called once a final stage's commands have run and their result is recorded. A var so
// tests can wait for it.
var finalFinished = func(dagID string) {}

// finalRuns holds the cancel of each dag's running final commands, and the verdict of a verifier that finished
// before them. In memory only: a restart loses the commands and the verdict, and the next tick starts the
// commands over from the persisted state and replaces the verifier, whose session ended with its verdict.
var finalRuns = struct {
	sync.Mutex
	byDag    map[string]context.CancelFunc
	verdicts map[string]finalVerdict
}{byDag: make(map[string]context.CancelFunc), verdicts: make(map[string]finalVerdict)}

// finalVerdict is a verifier's verdict on one round, held until the stage's commands finish.
type finalVerdict struct {
	round      int
	runID      string
	verdict    string
	text       string
	unverified string
}

// stopDagFinal kills a dag's running final commands and drops a held verdict: nothing will read either.
func stopDagFinal(dagID string) {
	finalRuns.Lock()
	defer finalRuns.Unlock()
	delete(finalRuns.verdicts, dagID)
	if cancel := finalRuns.byDag[dagID]; cancel != nil {
		cancel()
	}
}

func holdFinalVerdict(dagID string, v finalVerdict) {
	finalRuns.Lock()
	defer finalRuns.Unlock()
	finalRuns.verdicts[dagID] = v
}

// heldFinalVerdict is the verdict f's verifier gave while the commands ran, if it gave one. take drops
// whatever the dag held.
func heldFinalVerdict(dagID string, f *waveobj.FinalStage, take bool) (finalVerdict, bool) {
	finalRuns.Lock()
	defer finalRuns.Unlock()
	v, ok := finalRuns.verdicts[dagID]
	if take {
		delete(finalRuns.verdicts, dagID)
	}
	return v, ok && v.round == f.Round && v.runID == f.VerifierRunID
}

// applyFinalVerdict writes a verdict onto the stage: a fail's defects become its Detail whole, since the lead
// writes its fix plan from them, and a pass's caveat an unverified reason.
func applyFinalVerdict(f *waveobj.FinalStage, v finalVerdict) {
	if v.verdict == ReviewVerdict_Fail {
		f.Detail = v.text
	} else if v.unverified != "" {
		f.Unverified = append(f.Unverified, "verifier: "+v.unverified)
	}
}

// verifierGaveUp reports whether the stage's verifier was lost too often to be replaced again.
func verifierGaveUp(f *waveobj.FinalStage) bool {
	return slices.ContainsFunc(f.Unverified, func(s string) bool { return strings.HasPrefix(s, verifierDidNotFinish) })
}

// verifierAlongside reports whether g's verifier works while Check and Verify run. The verifier does not use
// their output, but it reads the Final command's, so a plan with one keeps the verifier after it.
func verifierAlongside(g *waveobj.TaskGroup) bool {
	return g.FinalCmd == ""
}

func finalTerminal(state string) bool {
	return state == FinalState_Passed || state == FinalState_Unverified || state == FinalState_Failed
}

// finalOutDir is ARC_FINAL_OUT for one round, in the app's data dir so the cockpit can show its screenshots until
// SweepFinalShots removes them, and outside every tree so nothing it writes can be committed. Forward slashes,
// because Git Bash eats the backslashes of an unquoted Windows path.
func finalOutDir(dagID string, round int) string {
	return filepath.ToSlash(filepath.Join(finalShotsRoot(), dagID, fmt.Sprint(round)))
}

// finalTreeFailed opens the unverified reason of a stage that could not make its tree.
const finalTreeFailed = "the final stage could not check the merged result: "

// notGitRepo is why a dag outside git gets no final checks: its tree is the shared checkout, where the stage
// never runs.
func notGitRepo(path string) error {
	return fmt.Errorf("%s is not a git repository, so the final stage has no tree of its own to run in", path)
}

// advanceFinal moves the final stage along once every task landed (RecomputeDagStatus says finalizing). It
// starts a round that has not started. With no Check and no Final command there is nothing to run, so the
// stage goes straight on to the verifier in this tick; otherwise the commands run off the tick, as Verify does,
// because they take minutes and hold no dag lock while they run. Each tick tends the verifier: while the
// commands run, when it works alongside them, and once they pass. The caller holds the dag mutation lock.
func advanceFinal(ctx, spawnCtx context.Context, g *waveobj.TaskGroup, owner *waveobj.Run, now int64, afterCommit *[]func()) {
	if g.Status != DagStatus_Finalizing {
		return
	}
	if g.Final == nil {
		g.Final = &waveobj.FinalStage{Round: 1}
	}
	f := g.Final
	if f.State == "" {
		*f = waveobj.FinalStage{State: FinalState_Checking, Round: f.Round, OutDir: finalOutDir(g.OID, f.Round), StartedTs: now}
		if g.Check == "" && g.Verify == "" && g.FinalCmd == "" {
			switch {
			case owner.LandPath != "":
				f.Tree = owner.LandPath
				head, err := landingHead(ctx, owner)
				if err != nil {
					log.Printf("dag %s: reading the landing head for the final stage: %v", g.OID, err)
				}
				f.Commit = head
			case !IsGitRepo(owner.ProjectPath):
				f.Unverified = append(f.Unverified, notGitRepo(owner.ProjectPath).Error())
			default:
				// the verifier reads a detached tree, never the shared checkout; releaseFinalTree removes it
				tree, _, err := finalTree(ctx, g, owner)
				if err != nil {
					f.Unverified = append(f.Unverified, finalTreeFailed+err.Error())
					break
				}
				f.Tree = tree
				if f.Commit, err = git(ctx, tree, "rev-parse", "HEAD"); err != nil {
					log.Printf("dag %s: reading the final tree's head: %v", g.OID, err)
				}
			}
			f.State = FinalState_Verifying
			startVerifier(ctx, spawnCtx, g, owner, afterCommit)
			RecomputeDagStatus(g)
			return
		}
	}
	switch f.State {
	case FinalState_Checking, FinalState_Final:
		// the commands' goroutine sets the tree when it starts the verifier alongside them; until then there is none
		if f.State == FinalState_Checking && f.Tree != "" && !verifierGaveUp(f) {
			if _, held := heldFinalVerdict(g.OID, f, false); !held {
				tendVerifier(ctx, spawnCtx, g, owner, now, afterCommit)
			}
		}
		dagID, ownerCopy := g.OID, *owner
		*afterCommit = append(*afterCommit, func() { startFinalCommands(dagID, &ownerCopy) })
	case FinalState_Verifying:
		tendVerifier(ctx, spawnCtx, g, owner, now, afterCommit)
		RecomputeDagStatus(g)
	}
}

// startFinalCommands runs a dag's Check and Final command on their own goroutine, unless they are running
// already: every tick while the stage runs asks, and only a restart finds nothing running.
func startFinalCommands(dagID string, owner *waveobj.Run) {
	ctx, cancel := context.WithCancel(context.Background())
	finalRuns.Lock()
	if finalRuns.byDag[dagID] != nil {
		finalRuns.Unlock()
		cancel()
		return
	}
	finalRuns.byDag[dagID] = cancel
	finalRuns.Unlock()
	goStage("final "+dagID, func() {
		defer finalFinished(dagID)
		res := runFinalSteps(ctx, dagID, owner)
		cancel()
		bg := context.Background()
		spawnCtx, spawnCancel := context.WithTimeout(bg, jarvis.RunWorkerSpawnTimeout)
		removeTree := !res.onStage
		if err := WithDagMutation(dagID, func() error {
			var rerr error
			removeTree, rerr = recordFinalLocked(bg, spawnCtx, dagID, owner, res)
			return rerr
		}); err != nil {
			log.Printf("dag %s: recording the final stage: %v", dagID, err)
		}
		spawnCancel()
		if removeTree {
			removeFinalTree(dagID, owner, res.tree)
		}
		finalRuns.Lock()
		delete(finalRuns.byDag, dagID)
		finalRuns.Unlock()
		// the outcome makes the dag done or blocked, which the tick announces
		if err := Schedule(bg, dagID); err != nil {
			log.Printf("dag %s: schedule after the final stage: %v", dagID, err)
		}
	})
}

// finalResult is what the deterministic steps found: a failure's Detail, or what they could not verify, and the
// screenshots the Final command wrote. onStage is set once the stage recorded the tree for a verifier working
// alongside the commands: from then on the stage releases it, not the commands' goroutine.
type finalResult struct {
	round         int
	tree          string
	commit        string
	detail        string
	unverified    []string
	onStage       bool
	shots         []waveobj.FinalShot
	shotsManifest bool
}

// runFinalSteps runs Check, Verify, then the Final command, in the final tree. With no Final command it starts
// the verifier on the tree first, so it works while they run. It reads the dag without the lock: the commands
// and the round it is for were fixed when the round started.
func runFinalSteps(ctx context.Context, dagID string, owner *waveobj.Run) finalResult {
	g, err := wstore.GetDag(ctx, dagID)
	if err != nil || g.Final == nil {
		return finalResult{round: -1}
	}
	res := finalResult{round: g.Final.Round}
	step := func(name string, run func(planProgress) bool) bool {
		return runFinalStep(ctx, g, res.round, name, run)
	}
	if g.Final.Tree != "" {
		// the server restarted mid-stage: the verifier alongside may still be reading the tree the stage recorded
		res.tree, res.commit, res.onStage = g.Final.Tree, g.Final.Commit, true
	} else {
		var tree string
		if !step(FinalStep_Tree, func(planProgress) bool {
			tree, _, err = finalTree(ctx, g, owner)
			return err == nil
		}) {
			res.unverified = []string{finalTreeFailed + err.Error()}
			return res
		}
		res.tree = tree
		if res.commit, err = git(ctx, tree, "rev-parse", "HEAD"); err != nil {
			log.Printf("dag %s: reading the final tree's head: %v", dagID, err)
		}
		if verifierAlongside(g) {
			spawnCtx, spawnCancel := context.WithTimeout(context.Background(), jarvis.RunWorkerSpawnTimeout)
			if err := WithDagMutation(dagID, func() error {
				var rerr error
				res.onStage, rerr = startVerifierAlongsideLocked(context.Background(), spawnCtx, dagID, owner, res)
				return rerr
			}); err != nil {
				log.Printf("dag %s: starting the verifier alongside the final commands: %v", dagID, err)
			}
			spawnCancel()
		}
	}
	tree := res.tree
	if g.Check != "" {
		var out string
		if !step(FinalStep_Check, func(progress planProgress) bool {
			out, err = runPlanCommand(ctx, tree, g.Check, nil, VerifyTimeout, progress)
			return err == nil
		}) {
			if !baseCheckFailed(g) {
				res.detail = fmt.Sprintf("Check `%s` failed (%s):\n%s", g.Check, commandReason(err), out)
				return res
			}
			// a fix round cannot fix someone else's commit, so it goes on as unverified
			res.unverified = append(res.unverified, sharedCheckFailure(g, "the merged result", failureDetail(err)))
		}
	}
	// per merge Verify tested only what each merge changed; the whole suite runs once, here, on the merged result
	if g.Verify != "" {
		var out string
		var flaky []string
		if !step(FinalStep_Verify, func(progress planProgress) bool {
			out, flaky, err = runVerifyCommand(ctx, tree, g.Verify, unscopedEnv, progress)
			return err == nil
		}) {
			res.detail = fmt.Sprintf("Verify `%s` failed on the merged result (%s):\n%s", g.Verify, commandReason(err), out)
			return res
		}
		for _, test := range flaky {
			res.unverified = append(res.unverified, flakyItem(test, finalVerifyWhere))
		}
	}
	if g.FinalCmd == "" {
		return res
	}
	var exit int
	var tail string
	step(FinalStep_Final, func(progress planProgress) bool {
		exit, tail, err = runFinalCommand(ctx, tree, g.FinalCmd, g.Final.OutDir, finalCommandTimeout, progress)
		return err == nil && exit == 0
	})
	// whatever the exit: a failing scenario's screenshots are the ones worth seeing
	res.shots, res.shotsManifest = readFinalShots(dagID, g.Final.OutDir)
	switch {
	case err != nil:
		res.detail = fmt.Sprintf("Final `%s` failed (%s):\n%s", g.FinalCmd, err, tail)
	case exit == FinalExitUnverified:
		reason := lastOutputLine(tail)
		if reason == "" {
			reason = fmt.Sprintf("Final `%s` exited %d, could not verify, and gave no reason", g.FinalCmd, exit)
		}
		res.unverified = append(res.unverified, reason)
	case exit != 0:
		res.detail = fmt.Sprintf("Final `%s` failed (exit %d):\n%s", g.FinalCmd, exit, tail)
	}
	return res
}

// commandReason is a plan command's exit code or timeout, or the error that kept it from running.
func commandReason(err error) string {
	var pe *planCommandError
	if errors.As(err, &pe) {
		return pe.reason()
	}
	return err.Error()
}

// runFinalStep runs one step of the stage, which run does, reporting whether it passed. The stage shows the step and
// its output tail while it runs, so the cockpit can say which of the stage's minutes this is, and a final-step event
// records how long it took.
func runFinalStep(ctx context.Context, g *waveobj.TaskGroup, round int, step string, run func(planProgress) bool) bool {
	if err := WithDagMutation(g.OID, func() error { return markFinalStepLocked(ctx, g.OID, round, step) }); err != nil {
		log.Printf("dag %s: marking the final stage's %s step: %v", g.OID, step, err)
	}
	// a tail is cosmetic, so it skips a beat rather than waiting for the lock
	progress := func(tail string) bool {
		ran, err := TryWithDagMutation(g.OID, func() error { return recordFinalOutputLocked(ctx, g.OID, round, step, tail) })
		if err != nil {
			log.Printf("dag %s: publishing the final stage's %s output: %v", g.OID, step, err)
		}
		return ran && err == nil
	}
	start := time.Now()
	ok := run(progress)
	appendRunEvent(ctx, g.ChannelId, g.RunID, waveobj.RunEventKindFinalStep, nil, map[string]any{
		"round": round, "step": step, "ms": time.Since(start).Milliseconds(), "ok": ok,
	})
	return ok
}

// clearFinalStep drops the step of a stage whose commands are no longer running.
func clearFinalStep(f *waveobj.FinalStage) {
	f.Step, f.StepTs, f.Output = "", 0, ""
}

// markFinalStepLocked shows step running, with no output yet. The Final command also moves the stage to final:
// Check and Verify passed.
func markFinalStepLocked(ctx context.Context, dagID string, round int, step string) error {
	err := wstore.UpdateDag(ctx, dagID, func(cur *waveobj.TaskGroup) error {
		if cur.Status == DagStatus_Cancelled || cur.Final == nil || cur.Final.Round != round || cur.Final.State != FinalState_Checking {
			return errVerifyProgressStale
		}
		cur.Final.Step, cur.Final.StepTs, cur.Final.Output = step, time.Now().UnixMilli(), ""
		if step == FinalStep_Final {
			cur.Final.State = FinalState_Final
		}
		cur.UpdatedTs = time.Now().UnixMilli()
		return nil
	})
	if errors.Is(err, errVerifyProgressStale) {
		return nil
	}
	if err != nil {
		return err
	}
	wcore.SendWaveObjUpdate(waveobj.MakeORef(waveobj.OType_Dag, dagID))
	return nil
}

// recordFinalOutputLocked stores a running step's output tail. A step that is no longer the stage's (it finished,
// or the stage ended or moved on to another round) takes nothing, so a late tail cannot land on the next step.
func recordFinalOutputLocked(ctx context.Context, dagID string, round int, step, tail string) error {
	err := wstore.UpdateDag(ctx, dagID, func(cur *waveobj.TaskGroup) error {
		f := cur.Final
		if cur.Status == DagStatus_Cancelled || f == nil || f.Round != round || f.Step != step || f.Output == tail {
			return errVerifyProgressStale
		}
		f.Output = tail
		cur.UpdatedTs = time.Now().UnixMilli()
		return nil
	})
	if errors.Is(err, errVerifyProgressStale) {
		return nil
	}
	if err != nil {
		return err
	}
	wcore.SendWaveObjUpdate(waveobj.MakeORef(waveobj.OType_Dag, dagID))
	return nil
}

// startVerifierAlongsideLocked records the stage's tree and starts the verifier on it before Check and Verify
// run. It reports whether the stage took the tree: a stage cancelled or ended meanwhile does not. The caller
// holds the dag mutation lock.
func startVerifierAlongsideLocked(ctx, spawnCtx context.Context, dagID string, owner *waveobj.Run, res finalResult) (bool, error) {
	g, err := wstore.GetDag(ctx, dagID)
	if err != nil {
		return false, err
	}
	f := g.Final
	if g.Status == DagStatus_Cancelled || f == nil || f.Round != res.round || f.State != FinalState_Checking || f.Tree != "" {
		return false, nil
	}
	f.Tree, f.Commit = res.tree, res.commit
	var afterCommit []func()
	startVerifier(ctx, spawnCtx, g, owner, &afterCommit)
	if err := persistDag(ctx, g); err != nil {
		return false, err
	}
	for _, fn := range afterCommit {
		fn()
	}
	return true, nil
}

// recordFinalLocked writes what the deterministic steps found. A failure ends the stage, and stops a verifier
// working alongside whatever it said; otherwise the verifier's verdict, given already or still to come, judges
// the result. A dag that was cancelled, or moved to another round meanwhile, takes nothing. It reports whether
// the caller must remove the tree: one the stage never took, or any on a cancelled dag, whose stage stopped
// before it could release it. The caller holds the dag mutation lock.
func recordFinalLocked(ctx, spawnCtx context.Context, dagID string, owner *waveobj.Run, res finalResult) (bool, error) {
	g, err := wstore.GetDag(ctx, dagID)
	if err != nil {
		return !res.onStage, err
	}
	f := g.Final
	if g.Status == DagStatus_Cancelled {
		return true, nil
	}
	if f == nil || f.Round != res.round || (f.State != FinalState_Checking && f.State != FinalState_Final) {
		return !res.onStage, nil
	}
	f.Tree, f.Commit = res.tree, res.commit
	f.Shots, f.ShotsManifest = res.shots, res.shotsManifest
	f.Unverified = append(f.Unverified, res.unverified...)
	clearFinalStep(f)
	var afterCommit []func()
	verdict, held := heldFinalVerdict(dagID, f, true)
	switch {
	case res.detail != "":
		f.Detail = res.detail
		if res.onStage && !held && f.VerifierRunID != "" {
			stopReviewer(ctx, g, f.VerifierRunID, &afterCommit)
		}
		finishFinal(ctx, g, false, &afterCommit)
		releaseFinalTree(g, owner, &afterCommit)
	case !res.onStage:
		f.State = FinalState_Verifying
		startVerifier(ctx, spawnCtx, g, owner, &afterCommit)
	case held:
		applyFinalVerdict(f, verdict)
		finishFinal(ctx, g, true, &afterCommit)
		releaseFinalTree(g, owner, &afterCommit)
	case verifierGaveUp(f):
		finishFinal(ctx, g, false, &afterCommit)
		releaseFinalTree(g, owner, &afterCommit)
	default:
		// the verifier alongside has not given its verdict; RecordFinalVerdict ends the stage on it
		f.State = FinalState_Verifying
	}
	RecomputeDagStatus(g)
	if err := persistDag(ctx, g); err != nil {
		return false, err
	}
	for _, fn := range afterCommit {
		fn()
	}
	return false, nil
}

// startVerifier is startVerifierSession, a var so the tests of everything but the final stage can end the stage
// without a session.
var startVerifier = startVerifierSession

// startVerifierSession hands the merged result to the verifier session once the deterministic steps passed.
// With no tree there is nothing for it to read, and why is already an unverified reason, so the stage ends on it.
func startVerifierSession(ctx, spawnCtx context.Context, g *waveobj.TaskGroup, owner *waveobj.Run, afterCommit *[]func()) {
	if g.Final.Tree == "" {
		finishFinal(ctx, g, false, afterCommit)
		return
	}
	tendVerifier(ctx, spawnCtx, g, owner, time.Now().UnixMilli(), afterCommit)
}

// finalVerifyWhere names the final stage's Verify in a flaky item.
const finalVerifyWhere = "in the final stage's Verify on the merged result"

// finishFinal decides the stage's outcome: failed on a Detail, unverified when anything could not be verified,
// else passed. The tests a merge Verify reported flaky and a plan with no Verify are reasons too, since nothing
// checked them cleanly. The tasks' caveats (taskCaveats) are reasons only when no verifier judged the result: the
// verifier is briefed with them, so its verdict, and its own --unverified, already answer them. A done outcome wakes the
// lead from the tick that announces the dag done; a failure wakes it here, with the Detail whole, because the fix
// plan is written from it.
func finishFinal(ctx context.Context, g *waveobj.TaskGroup, judged bool, afterCommit *[]func()) {
	f := g.Final
	// a human ending the stage stops its commands before they could clear their step
	clearFinalStep(f)
	// a batch's tips each keep the one Verify's output
	seen := map[string]bool{}
	for _, t := range g.Tasks {
		if t.State != TaskState_Done {
			continue
		}
		for _, item := range flakyItemsIn(t.VerifyOutput) {
			if !seen[item] {
				seen[item] = true
				f.Unverified = append(f.Unverified, item)
			}
		}
	}
	if !judged {
		f.Unverified = append(f.Unverified, dagCaveatLines(ctx, g)...)
	}
	if g.Verify == "" {
		f.Unverified = append(f.Unverified, "the plan has no Verify")
	}
	switch {
	case f.Detail != "":
		f.State = FinalState_Failed
	case len(f.Unverified) > 0:
		f.State = FinalState_Unverified
	default:
		f.State = FinalState_Passed
	}
	if f.State != FinalState_Failed {
		return
	}
	round, detail, last := f.Round, f.Detail, f.Round >= MaxFinalRounds
	channelID, runID := g.ChannelId, g.RunID
	*afterCommit = append(*afterCommit, func() {
		PostWake(context.Background(), channelID, runID, finalFailedWake(round, runID, detail, last))
	})
}

// settleFinalLocked ends a stage whose outcome is decided and persists the dag: the verifier's verdict (judged)
// and a human's end both finish through it. The caller holds the dag mutation lock and runs afterCommit after it.
func settleFinalLocked(ctx context.Context, g *waveobj.TaskGroup, owner *waveobj.Run, judged bool, afterCommit *[]func()) error {
	finishFinal(ctx, g, judged, afterCommit)
	releaseFinalTree(g, owner, afterCommit)
	RecomputeDagStatus(g)
	return persistDag(ctx, g)
}

// finalEndedByHuman opens the reason a human gave for ending a running final stage.
const finalEndedByHuman = "ended by the human: "

// EndFinalStage ends a running final stage on the human's word, as unverified or failed, with reason recorded
// where every final outcome is: failed is the stage's Detail and wakes the lead as a verifier's fail does. It
// stops what is running: the stage's commands, or its verifier. The caller schedules the dag afterwards.
func EndFinalStage(ctx context.Context, dagID, outcome, reason string) error {
	reason = strings.TrimSpace(reason)
	switch {
	case outcome != FinalState_Unverified && outcome != FinalState_Failed:
		return fmt.Errorf("the outcome must be %s or %s, got %q", FinalState_Unverified, FinalState_Failed, outcome)
	case reason == "":
		return fmt.Errorf("ending the final stage needs the human's reason")
	}
	if count := utf8.RuneCountInString(reason); count > MaxReviewNoteLen {
		return fmt.Errorf("the reason is %d characters; the limit is %d", count, MaxReviewNoteLen)
	}
	var afterCommit []func()
	err := withDagMutation(dagID, func() error {
		g, err := wstore.GetDag(ctx, dagID)
		if err != nil {
			return fmt.Errorf("loading dag: %w", err)
		}
		f := g.Final
		switch {
		case g.Status == DagStatus_Cancelled:
			return fmt.Errorf("run %s is cancelled; its final stage is not running", g.RunID)
		case f == nil || f.State == "":
			return fmt.Errorf("run %s's final stage has not started; only a running one can be ended", g.RunID)
		case finalTerminal(f.State):
			return fmt.Errorf("run %s's final stage is %s; only a running one can be ended", g.RunID, f.State)
		}
		owner, err := wstore.GetRun(ctx, g.ChannelId, g.RunID)
		if err != nil {
			return fmt.Errorf("loading the dag's run: %w", err)
		}
		if f.State == FinalState_Checking || f.State == FinalState_Final {
			// the commands' goroutine finds the stage ended when it comes back, and records nothing
			afterCommit = append(afterCommit, func() { stopDagFinal(dagID) })
		}
		// a verifier works alongside the commands, or after them
		if f.VerifierRunID != "" {
			stopReviewer(ctx, g, f.VerifierRunID, &afterCommit)
		}
		if outcome == FinalState_Failed {
			f.Detail = finalEndedByHuman + reason
		} else {
			f.Unverified = append(f.Unverified, finalEndedByHuman+reason)
			channelID, runID := g.ChannelId, g.RunID
			afterCommit = append(afterCommit, func() {
				PostQuiet(ctx, channelID, runID, "the human ended the final stage unverified: "+flatLine(reason))
			})
		}
		return settleFinalLocked(ctx, g, owner, false, &afterCommit)
	})
	if err != nil {
		return err
	}
	for _, fn := range afterCommit {
		fn()
	}
	return nil
}

// finalTree is where the final stage runs: the landing tree for a dag landing on its own branch. A dag landing
// in the checkout gets a detached worktree at the checkout's HEAD, prepared with Setup, because the stage never
// runs in the shared checkout. cleanup removes a tree the stage made.
func finalTree(ctx context.Context, g *waveobj.TaskGroup, owner *waveobj.Run) (string, func(), error) {
	if owner.LandPath != "" {
		if err := checkLandingTree(ctx, owner); err != nil {
			return "", nil, err
		}
		return owner.LandPath, func() {}, nil
	}
	if !IsGitRepo(owner.ProjectPath) {
		return "", nil, notGitRepo(owner.ProjectPath)
	}
	wt := worktreeDir(owner.ProjectPath, FinalWorktreeKey(owner.ID))
	// a tree a lost stage left behind would refuse the add
	if _, err := os.Stat(wt); err == nil {
		if err := removeWorktreeDir(ctx, owner.ProjectPath, wt); err != nil {
			return "", nil, fmt.Errorf("removing a stale final tree: %w", err)
		}
	}
	if _, err := addWorktree(ctx, owner.ProjectPath, "--detach", wt, "HEAD"); err != nil {
		return "", nil, fmt.Errorf("creating the final tree: %w", err)
	}
	cleanup := func() {
		if err := removeWorktreeDir(context.Background(), owner.ProjectPath, wt); err != nil {
			log.Printf("dag %s: removing the final tree: %v", g.OID, err)
		}
	}
	if g.Setup != "" {
		if _, err := runPlanCommand(ctx, wt, g.Setup, nil, SetupTimeout, nil); err != nil {
			cleanup()
			return "", nil, fmt.Errorf("Setup failed in the final tree: %s", failureDetail(err))
		}
	}
	return wt, cleanup, nil
}

// runFinalCommand runs the plan's Final command in tree with ARC_FINAL_OUT set to a fresh outDir, and returns
// its exit code and output tail, handing progress the tail while it runs. err is set only when there is no exit
// code to judge: the command timed out, or could not start.
func runFinalCommand(ctx context.Context, tree, cmd, outDir string, timeout time.Duration, progress planProgress) (int, string, error) {
	// a stage the server lost runs again into the same round's directory; the old screenshots would pass for new ones
	if err := os.RemoveAll(outDir); err != nil {
		return -1, "", fmt.Errorf("clearing %s %s: %w", finalOutEnv, outDir, err)
	}
	if err := os.MkdirAll(outDir, 0o755); err != nil {
		return -1, "", fmt.Errorf("creating %s %s: %w", finalOutEnv, outDir, err)
	}
	out, err := execPlanCommandEnv(ctx, tree, cmd, []string{finalOutEnv + "=" + outDir}, timeout, progress)
	if err == nil {
		return 0, out, nil
	}
	var pe *planCommandError
	if !errors.As(err, &pe) {
		return -1, out, err
	}
	if pe.timeout == 0 && pe.exitCode >= 0 {
		return pe.exitCode, out, nil
	}
	return -1, out, errors.New(pe.reason())
}
