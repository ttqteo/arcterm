// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"cmp"
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

	"github.com/wavetermdev/waveterm/pkg/effortstore"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/jobqueue"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wcore"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// errProjectBusy is a merge that has to wait: another task's merge or Verify holds the project checkout.
var errProjectBusy = errors.New("project checkout is busy")

// landing is one task's claim on its project checkout, from its squash merge through the Verify after it.
type landing struct {
	dagID  string
	taskID string
	cancel context.CancelFunc // set once Verify starts
	// set with cancel, for the watchdog's report of a Verify that never records a result
	channelID, runID string
	since            time.Time
	reported         bool
}

// landings serializes merges and their Verify runs per project checkout: a merge landing mid-Verify would
// be judged by a test run that started before it. In memory only: a restart kills the Verify the claim
// covered, and AutoMergeReady restarts it from the persisted verifying state.
var landings = struct {
	sync.Mutex
	byProject map[string]*landing
}{byProject: make(map[string]*landing)}

// claimProject reserves projectPath for one landing, or names the landing that holds it.
func claimProject(projectPath, dagID, taskID string) (*landing, error) {
	key := filepath.Clean(projectPath)
	landings.Lock()
	defer landings.Unlock()
	if cur := landings.byProject[key]; cur != nil {
		return nil, fmt.Errorf("%w: task %s of dag %s is landing", errProjectBusy, cur.taskID, cur.dagID)
	}
	l := &landing{dagID: dagID, taskID: taskID}
	landings.byProject[key] = l
	return l, nil
}

func releaseProject(projectPath string, l *landing) {
	key := filepath.Clean(projectPath)
	landings.Lock()
	defer landings.Unlock()
	if landings.byProject[key] == l {
		delete(landings.byProject, key)
	}
}

// stopDagVerify kills a cancelled dag's running Verify: nothing will read its result.
func stopDagVerify(dagID string) {
	landings.Lock()
	defer landings.Unlock()
	for _, l := range landings.byProject {
		if l.dagID == dagID && l.cancel != nil {
			l.cancel()
		}
	}
}

// overdueVerifies claims the report of every Verify that has held its project past verifyOverdue: each is
// returned once.
func overdueVerifies() []landing {
	landings.Lock()
	defer landings.Unlock()
	var out []landing
	for _, l := range landings.byProject {
		if l.cancel != nil && !l.reported && time.Since(l.since) > verifyOverdue {
			l.reported = true
			out = append(out, *l)
		}
	}
	return out
}

// verifyFinished is called once a Verify run has recorded its result and ticked its dag. A var so tests
// can wait for it.
var verifyFinished = func(dagID, taskID string) {}

// verifyChangedEnv names the file a scoped Verify reads: one repo-relative path per line, what the merge
// changed. A Verify that ignores it runs whole, which is what every plan did before it existed.
const verifyChangedEnv = "ARC_VERIFY_CHANGED"

// unscopedEnv runs Verify on everything. Set empty rather than left out, so a value inherited from the server's
// own environment cannot scope it.
var unscopedEnv = []string{verifyChangedEnv + "="}

// verifyFlakyEnv names a fresh, empty file a Verify command may append its flaky tests to, one per line: tests
// that failed and then passed when the command reran them. A pass with lines in it is still a pass, and each line
// becomes an unverified item of the run, so a race that passes on a rerun is never a silent pass. A failed Verify's
// file is not read. The engine reads nothing else from the command, so any test runner can follow it.
const verifyFlakyEnv = "ARC_VERIFY_FLAKY"

// maxFlakyReported bounds the flaky tests kept from one Verify: the file is the command's to write.
const maxFlakyReported = 20

// flakyPrefix opens each flaky item, both on a passed tip's kept Verify output and among the unverified items.
const flakyPrefix = "Verify reported flaky: "

// flakyItem is one flaky test, named as its Verify reported it, and which Verify that was.
func flakyItem(test, where string) string {
	return fmt.Sprintf("%s%s (failed, then passed on a rerun, %s)", flakyPrefix, test, where)
}

// runVerifyCommand runs a Verify command with verifyFlakyEnv naming a fresh file, and returns what a pass reported
// flaky. A file it cannot make runs the command without one: the report is worth less than the Verify.
func runVerifyCommand(ctx context.Context, dir, command string, env []string, progress planProgress) (string, []string, error) {
	f, err := os.CreateTemp("", "arc-verify-flaky-*.txt")
	if err != nil {
		log.Printf("creating the flaky report file for Verify in %s: %v", dir, err)
		out, verr := runPlanCommand(ctx, dir, command, env, VerifyTimeout, progress)
		return out, nil, verr
	}
	path := f.Name()
	f.Close()
	defer os.Remove(path)
	// Git Bash eats the backslashes of an unquoted Windows path
	withFlaky := append(slices.Clone(env), verifyFlakyEnv+"="+filepath.ToSlash(path))
	out, verr := runPlanCommand(ctx, dir, command, withFlaky, VerifyTimeout, progress)
	if verr != nil {
		return out, nil, verr
	}
	b, err := os.ReadFile(path)
	if err != nil {
		log.Printf("reading the flaky report of Verify in %s: %v", dir, err)
		return out, nil, nil
	}
	return out, parseFlakyReport(string(b)), nil
}

// parseFlakyReport reads a flaky report's test names, one per line, without blanks or repeats, keeping the first
// maxFlakyReported and counting the rest in a last line.
func parseFlakyReport(text string) []string {
	var tests []string
	seen := map[string]bool{}
	for _, line := range strings.Split(text, "\n") {
		test := flatLine(line)
		if test == "" || seen[test] {
			continue
		}
		seen[test] = true
		tests = append(tests, truncateText(test, MaxAskSummaryLen))
	}
	if len(tests) > maxFlakyReported {
		more := len(tests) - maxFlakyReported
		tests = append(tests[:maxFlakyReported], fmt.Sprintf("%d more tests", more))
	}
	return tests
}

// withFlakyItems appends a passed Verify's flaky items to the output kept on its tips, where the final stage finds
// them (flakyItemsIn) and a human reading the gate sees them.
func withFlakyItems(output string, tests []string, where string) string {
	if len(tests) == 0 {
		return output
	}
	lines := make([]string, len(tests))
	for i, test := range tests {
		lines[i] = flakyItem(test, where)
	}
	return strings.TrimRight(output, "\n") + "\n" + strings.Join(lines, "\n")
}

// afterMerging names a merge Verify in a flaky item by the tips it passed.
func afterMerging(tips []string) string {
	return "in the Verify after merging " + strings.Join(tips, ", ")
}

// flakyItemsIn returns the flaky items withFlakyItems appended to a kept Verify output.
func flakyItemsIn(output string) []string {
	var items []string
	for _, line := range strings.Split(output, "\n") {
		if strings.HasPrefix(line, flakyPrefix) {
			items = append(items, line)
		}
	}
	return items
}

// changedFilesEnv lists the paths that differ between since and to in dir (to "" is the working tree) and
// returns the env entry naming the list. unscopedEnv when they cannot be listed: Verify then runs unscoped,
// which costs time and never a missed test.
func changedFilesEnv(ctx context.Context, dir, since, to, name string) []string {
	if since == "" {
		return unscopedEnv
	}
	args := []string{"diff", "--name-only", "--no-renames", since}
	if to != "" {
		args = append(args, to)
	}
	out, err := git(ctx, dir, args...)
	if err != nil {
		log.Printf("listing the paths changed since %s in %s: %v", since, dir, err)
		return unscopedEnv
	}
	path := filepath.Join(os.TempDir(), "arc-verify", name+".txt")
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		log.Printf("writing the changed-path list %s: %v", path, err)
		return unscopedEnv
	}
	if err := os.WriteFile(path, []byte(out+"\n"), 0o644); err != nil {
		log.Printf("writing the changed-path list %s: %v", path, err)
		return unscopedEnv
	}
	// Git Bash eats the backslashes of an unquoted Windows path
	return []string{verifyChangedEnv + "=" + filepath.ToSlash(path)}
}

// batchTip is a verifying lane tip and its squash commit, "" when it is not known.
type batchTip struct{ id, commit string }

func tipIDs(batch []batchTip) []string {
	ids := make([]string, len(batch))
	for i, tip := range batch {
		ids[i] = tip.id
	}
	return ids
}

// heldLine is a held tip's output: a later lane in a batch whose earlier lane failed is judged by the Verify
// that follows that lane's fix.
func heldLine(failedID string) string {
	return "held: task " + failedID + "'s Verify failed; verified with its fix"
}

// verifyBatch lists every verifying lane tip, oldest squash commit first. ordered is false when a commit is unknown
// or git cannot order them (a stubbed merge): the order then falls back to when each merged, and nothing may bisect it.
func verifyBatch(ctx context.Context, g *waveobj.TaskGroup, tree string) ([]batchTip, bool) {
	var batch []batchTip
	ordered := true
	for i := range g.Tasks {
		t := &g.Tasks[i]
		if t.State != TaskState_Verifying {
			continue
		}
		tip := batchTip{id: t.ID}
		if t.RunID != "" {
			if child, err := wstore.GetRun(ctx, g.ChannelId, t.RunID); err == nil {
				tip.commit = child.EndCommit
			}
		}
		ordered = ordered && tip.commit != ""
		batch = append(batch, tip)
	}
	started := func(id string) int64 { return taskByID(g, id).VerifyStartedTs }
	slices.SortStableFunc(batch, func(a, b batchTip) int { return cmp.Compare(started(a.id), started(b.id)) })
	if !ordered {
		return batch, false
	}
	byCommit := slices.Clone(batch)
	var gitErr error
	slices.SortStableFunc(byCommit, func(a, b batchTip) int {
		if a.commit == b.commit {
			return 0
		}
		if _, err := git(ctx, tree, "merge-base", "--is-ancestor", a.commit, b.commit); err == nil {
			return -1
		}
		if _, err := git(ctx, tree, "merge-base", "--is-ancestor", b.commit, a.commit); err == nil {
			return 1
		}
		gitErr = fmt.Errorf("%s and %s are not on one line", a.commit, b.commit)
		return 0
	})
	// a sort with a comparator that gave up is half git's order and half the fallback's: keep the fallback whole
	if gitErr != nil {
		return batch, false
	}
	return byCommit, true
}

// batchScopeEnv scopes Verify to everything from the batch's oldest squash commit to HEAD, which also takes in a fix
// committed on top before a --continue. The squash commit has one parent, so <commit>^ is the tree before it landed.
func batchScopeEnv(ctx context.Context, dagID, tree string, batch []batchTip) []string {
	if len(batch) == 0 || batch[0].commit == "" {
		return unscopedEnv
	}
	return changedFilesEnv(ctx, tree, batch[0].commit+"^", "HEAD", dagID+"/"+batch[0].id)
}

// batchRunner is what a Verify of a batch runs with: the landing tree it judged, the project the tree belongs to,
// the plan's Setup and Verify commands and the progress sink.
type batchRunner struct {
	channelID, dagID, runID, project, tree, setup, command string
	progress                                               planProgress
}

// batchOutcome is a batch's verdict: passed tips go done, failed goes verify-failed ("" on a pass), and held tips stay
// verifying with the held line. output and err come from the run that judged failed, or the batch's run on a pass;
// passedOutput comes from the run that passed the passed tips, with that run's flaky items. reason replaces the wake
// reason when it is not empty, and bisect counts the extra Verify runs.
type batchOutcome struct {
	batch, passed []string
	failed        string
	held          []string
	output        string
	passedOutput  string
	err           error
	reason        string
	bisect        int
	cancelled     bool // the claim was cancelled mid-judging: nothing is recorded
}

// verifyReason is the short cause a Verify failure's wake carries.
func verifyReason(err error) string {
	var pe *planCommandError
	if errors.As(err, &pe) {
		return pe.reason()
	}
	return "error"
}

// judgeBatch turns the batch's Verify result into its outcome. A failure of an ordered batch of two or more, with
// nothing committed on top, is bisected over its prefixes in a detached tree to the tip that broke it; otherwise it
// blames the oldest tip and holds the rest.
func judgeBatch(ctx context.Context, batch []batchTip, ordered bool, output string, flaky []string, verr error, run batchRunner) batchOutcome {
	out := batchOutcome{batch: tipIDs(batch), output: output, err: verr}
	if verr == nil {
		out.passed, out.passedOutput = out.batch, withFlakyItems(output, flaky, afterMerging(out.batch))
		return out
	}
	out.failed, out.held = out.batch[0], out.batch[1:]
	if !ordered || len(batch) < 2 {
		return out
	}
	// a fix committed on top before a --continue is not any prefix's: the continued tip owns the failure
	if head, err := git(ctx, run.tree, "rev-parse", "HEAD"); err != nil || head != batch[len(batch)-1].commit {
		return out
	}
	lo, hi := 0, len(batch) // prefix i is the tree at batch[i-1].commit; prefix 0 passed its own Verify, prefix n just failed
	failOut, failErr := output, verr
	passOut := ""
	var passFlaky []string
	steps := 0
	first := batch[len(batch)/2-1].commit
	// the run id travels in the ctx, for the Setup withDetachedTree runs
	stepErr := withDetachedTree(jobqueue.WithSource(ctx, jobqueue.Source{RunId: run.runID}), run.project, run.runID+"-bisect", "bisect tree", first, run.setup, func(wt string) error {
		for hi-lo > 1 {
			if err := ctx.Err(); err != nil {
				return err
			}
			mid := (lo + hi) / 2
			commit := batch[mid-1].commit
			if _, err := git(ctx, wt, "checkout", "--detach", "--force", commit); err != nil {
				return &treeStepError{"moving the bisect tree to " + commit, err}
			}
			if run.progress != nil {
				run.progress(fmt.Sprintf("verify: bisecting: testing %s at %.8s", strings.Join(tipIDs(batch[:mid]), ", "), commit))
			}
			env := changedFilesEnv(ctx, wt, batch[0].commit+"^", commit, run.dagID+"/bisect")
			stepOut, stepFlaky, err := runVerifyCommand(jobqueue.WithSource(ctx, jobqueue.Source{RunId: run.runID, Label: "Verify · bisect", Always: true}), wt, run.command, env, run.progress)
			steps++
			if err == nil {
				lo, passOut, passFlaky = mid, stepOut, stepFlaky
				continue
			}
			var pe *planCommandError
			if !errors.As(err, &pe) {
				return &treeStepError{"running Verify in the bisect tree", err}
			}
			hi, failOut, failErr = mid, stepOut, err
		}
		return nil
	})
	if ctx.Err() != nil {
		return batchOutcome{batch: out.batch, cancelled: true}
	}
	out.bisect = steps
	if stepErr != nil {
		// only prefixes a Verify passed may land: the oldest tip past them is blamed
		out.passed, out.failed, out.held = out.batch[:lo], out.batch[lo], out.batch[lo+1:]
		out.passedOutput = withFlakyItems(passOut, passFlaky, afterMerging(out.passed))
		out.reason = verifyReason(verr) + "; bisect stopped: " + stepErr.Error()
		return out
	}
	out.passed, out.failed, out.held = out.batch[:hi-1], out.batch[hi-1], out.batch[hi:]
	out.passedOutput, out.output, out.err = withFlakyItems(passOut, passFlaky, afterMerging(out.passed)), failOut, failErr
	out.reason = verifyReason(failErr) + "; bisected from " + strings.Join(out.batch, ", ")
	return out
}

// startVerify runs Verify in the project checkout for every lane tip the caller left verifying, and releases l
// once the result is recorded. It runs on its own goroutine because Verify takes minutes and neither the
// watchdog tick nor an RPC handler can wait on it, and it holds no dag lock while the command runs.
func startVerify(channelID, dagID, runID, projectPath, command string, l *landing) {
	ctx, cancel := context.WithCancel(context.Background())
	landings.Lock()
	l.cancel, l.channelID, l.runID, l.since = cancel, channelID, runID, time.Now()
	landings.Unlock()
	goStage("verify "+dagID, func() {
		bg := context.Background()
		var batch []batchTip
		ordered := false
		setup := ""
		stepLabel := "Verify"
		if g, err := wstore.GetDag(bg, dagID); err == nil {
			batch, ordered = verifyBatch(bg, g, projectPath)
			setup = g.Setup
			if len(batch) > 0 {
				stepLabel = taskStepLabel("Verify", g, batch[0].id)
			}
		}
		first := ""
		if len(batch) > 0 {
			first = batch[0].id
		}
		defer verifyFinished(dagID, first)
		if len(batch) == 0 {
			cancel()
			releaseProject(projectPath, l)
			return
		}
		ids := tipIDs(batch)
		started := map[string]any{"taskid": first}
		if len(ids) > 1 {
			started["batch"] = ids
		}
		appendRunEvent(ctx, channelID, runID, waveobj.RunEventKindTaskVerifyStarted, nil, started)
		project := projectPath
		if owner, err := wstore.GetRun(bg, channelID, runID); err == nil {
			project = owner.ProjectPath
		}
		start := time.Now()
		// a tail is cosmetic, so it skips a beat rather than queueing behind a Setup: waiting here would
		// stall the command's own completion, and with it the project claim every other lane's merge needs
		progress := func(tail string) bool {
			ran, err := TryWithDagMutation(dagID, func() error {
				return recordVerifyProgressLocked(bg, dagID, ids, tail)
			})
			if err != nil {
				log.Printf("dag %s task %s: publishing verify progress: %v", dagID, first, err)
			}
			return ran && err == nil
		}
		env := batchScopeEnv(bg, dagID, projectPath, batch)
		output, flaky, verr := runVerifyCommand(jobqueue.WithSource(ctx, jobqueue.Source{RunId: runID, Label: stepLabel, Always: true}), projectPath, command, env, progress)
		run := batchRunner{channelID: channelID, dagID: dagID, runID: runID, project: project, tree: projectPath,
			setup: setup, command: command, progress: progress}
		// judged on the claim's context, so a cancelled dag also stops whatever judging runs
		out := judgeBatch(ctx, batch, ordered, output, flaky, verr, run)
		cancel()
		if err := WithDagMutation(dagID, func() error {
			return recordBatchVerifyLocked(bg, dagID, out, time.Since(start).Milliseconds())
		}); err != nil {
			log.Printf("dag %s task %s: recording verify: %v", dagID, first, err)
		}
		releaseProject(projectPath, l)
		// the next merge was held for this Verify, and a pass unblocks dependents
		if err := Schedule(bg, dagID); err != nil {
			log.Printf("dag %s: schedule after verify: %v", dagID, err)
		}
	})
}

// errVerifyProgressStale abandons a progress write with nothing to record. UpdateDag persists whatever
// its callback leaves and bumps the version either way, and that version is the cockpit's digest-freshness
// signal — so a no-op publish would cost a status refetch for output nobody changed.
var errVerifyProgressStale = errors.New("verify progress no longer applies")

// recordVerifyProgressLocked stores a still-running Verify's output tail on each tip of its batch so the cockpit
// can show what it is doing. It records output only, never state: a task that stopped verifying (its dag was
// cancelled, or the run already recorded its result) takes nothing, so a late publish cannot overwrite a final
// output or resurrect a finished task. The caller holds the dag mutation lock.
func recordVerifyProgressLocked(ctx context.Context, dagID string, taskIDs []string, tail string) error {
	err := wstore.UpdateDag(ctx, dagID, func(cur *waveobj.TaskGroup) error {
		changed := false
		for _, id := range taskIDs {
			task := taskByID(cur, id)
			if task == nil || task.State != TaskState_Verifying || task.VerifyOutput == tail {
				continue
			}
			task.VerifyOutput = tail
			changed = true
		}
		if !changed {
			return errVerifyProgressStale
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

// recordBatchVerifyLocked records a batch's outcome, keeping the command's output tail on the tips it judged. Only
// tips still verifying are touched, and a cancelled dag records nothing. The caller holds the dag mutation lock.
func recordBatchVerifyLocked(ctx context.Context, dagID string, out batchOutcome, ms int64) error {
	g, err := wstore.GetDag(ctx, dagID)
	if err != nil {
		return err
	}
	if g.Status == DagStatus_Cancelled || out.cancelled {
		return nil
	}
	verifying := func(id string) *waveobj.TaskNode {
		if t := taskByID(g, id); t != nil && t.State == TaskState_Verifying {
			return t
		}
		return nil
	}
	var passed []string
	for _, id := range out.passed {
		if t := verifying(id); t != nil {
			t.State, t.VerifyError, t.VerifyOutput = TaskState_Done, "", out.passedOutput
			passed = append(passed, id)
		}
	}
	failed := verifying(out.failed)
	if failed != nil {
		failed.State, failed.VerifyError, failed.VerifyOutput = TaskState_VerifyFailed, out.err.Error(), out.output
	}
	for _, id := range out.held {
		if t := verifying(id); t != nil {
			t.VerifyOutput = heldLine(out.failed)
		}
	}
	RecomputeDagStatus(g)
	g.UpdatedTs = time.Now().UnixMilli()
	if err := wstore.UpdateDag(ctx, dagID, func(cur *waveobj.TaskGroup) error {
		*cur = *g
		return nil
	}); err != nil {
		return err
	}
	wcore.SendWaveObjUpdate(waveobj.MakeORef(waveobj.OType_Dag, dagID))
	withBatch := func(data map[string]any) map[string]any {
		if len(out.batch) > 1 {
			data["batch"] = out.batch
		}
		return data
	}
	for _, id := range passed {
		data := withBatch(map[string]any{"taskid": id, "ms": ms})
		if out.bisect > 0 {
			data["bisect"] = true
		}
		appendRunEvent(ctx, g.ChannelId, g.RunID, waveobj.RunEventKindTaskVerifyPassed, nil, data)
		closeLandedChunks(ctx, g, id)
	}
	if failed == nil {
		return nil
	}
	reason := out.reason
	if reason == "" {
		reason = verifyReason(out.err)
	}
	data := withBatch(map[string]any{"taskid": out.failed, "reason": reason, "detail": failureDetail(out.err)})
	if out.bisect > 0 {
		data["bisect"] = out.bisect
	}
	appendRunEvent(ctx, g.ChannelId, g.RunID, waveobj.RunEventKindTaskVerifyFailed, nil, data)
	PostWake(ctx, g.ChannelId, g.RunID, verifyFailedWake(out.failed, reason))
	return nil
}

// closeLandedChunks marks the effort chunks of every task the merge that just passed Verify landed as done:
// a lane lands as one squash commit recorded on its tip, and each task in it may name its own chunks. It
// never fails the Verify or the merge, which already happened: a chunk it cannot close is logged with the
// effort, chunk and task, and left for the human to close.
func closeLandedChunks(ctx context.Context, g *waveobj.TaskGroup, tipID string) {
	if g.EffortOID == "" {
		return
	}
	commit := ""
	if tip := taskByID(g, tipID); tip != nil && tip.RunID != "" {
		if child, err := wstore.GetRun(ctx, g.ChannelId, tip.RunID); err == nil {
			commit = child.EndCommit
		}
	}
	landed := "landed"
	if commit != "" {
		landed += " " + commit
	}
	for _, id := range laneOf(g, tipID) {
		task := taskByID(g, id)
		if task == nil || task.State == TaskState_Skipped {
			continue
		}
		for _, chunk := range task.Chunks {
			note := fmt.Sprintf("%s (run %s, task %s)", landed, g.RunID, task.ID)
			op := wshrpc.EffortOp{Op: "setChunkStatus", Chunk: chunk, Status: "done"}
			err := effortstore.Update(ctx, g.EffortOID, func(e *waveobj.Effort) error {
				return jarvis.ApplyEffortOps(e, []wshrpc.EffortOp{op}, note, time.Now().UnixMilli())
			})
			if err != nil {
				log.Printf("dag %s task %s: closing chunk %q of effort %s: %v", g.OID, task.ID, chunk, g.EffortOID, err)
			}
		}
	}
}

// resumeVerify restarts a batch's Verify the server lost: its tips were persisted verifying and nothing holds
// their project. A Verify still running holds the claim, so this starts nothing.
func resumeVerify(ctx context.Context, g *waveobj.TaskGroup) {
	ids := tasksInState(g, TaskState_Verifying)
	if len(ids) == 0 {
		return
	}
	owner, err := wstore.GetRun(ctx, g.ChannelId, g.RunID)
	if err != nil {
		return
	}
	l, err := claimProject(jarvis.LandPath(owner), g.OID, ids[0])
	if err != nil {
		return
	}
	// g predates the claim: a Verify that recorded its result and released in between must not run again, and
	// a failed tip or a conflict waiting for --continue holds its held tips until the lead acts
	fresh, err := wstore.GetDag(ctx, g.OID)
	if err != nil || fresh.Status == DagStatus_Cancelled || len(tasksInState(fresh, TaskState_Verifying)) == 0 ||
		len(tasksInState(fresh, TaskState_VerifyFailed)) > 0 || conflictAwaitingContinue(fresh, "") != "" {
		releaseProject(jarvis.LandPath(owner), l)
		return
	}
	startVerify(g.ChannelId, g.OID, g.RunID, jarvis.LandPath(owner), fresh.Verify, l)
}

// rerunVerify re-runs Verify for a task whose Verify failed, after the caller committed a fix.
func rerunVerify(ctx context.Context, channelID string, owner *waveobj.Run, taskID string) error {
	l, err := claimProject(jarvis.LandPath(owner), owner.DagORef, taskID)
	if err != nil {
		return err
	}
	var verify string
	err = WithDagMutation(owner.DagORef, func() error {
		g, gerr := wstore.GetDag(ctx, owner.DagORef)
		if gerr != nil {
			return gerr
		}
		task := taskByID(g, taskID)
		if task == nil || task.State != TaskState_VerifyFailed {
			return fmt.Errorf("task %s is no longer verify-failed", taskID)
		}
		task.State, task.VerifyError, task.VerifyOutput = TaskState_Verifying, "", ""
		task.VerifyStartedTs = time.Now().UnixMilli()
		RecomputeDagStatus(g)
		g.UpdatedTs = time.Now().UnixMilli()
		if uerr := wstore.UpdateDag(ctx, g.OID, func(cur *waveobj.TaskGroup) error {
			*cur = *g
			return nil
		}); uerr != nil {
			return uerr
		}
		wcore.SendWaveObjUpdate(waveobj.MakeORef(waveobj.OType_Dag, g.OID))
		verify = g.Verify
		return nil
	})
	if err != nil {
		releaseProject(jarvis.LandPath(owner), l)
		return err
	}
	startVerify(channelID, owner.DagORef, owner.ID, jarvis.LandPath(owner), verify, l)
	return nil
}
