// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/runroute"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wcore"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

const (
	// MaxReviewRounds is how many failed reviews a task takes before the lead judges it: one round back to a
	// worker with the findings, then the lead.
	MaxReviewRounds = 2
	// MaxReviewRespawns is how many times a round's reviewer is replaced after ending without a verdict.
	MaxReviewRespawns = 1
	// ReviewTimeout bounds one reviewer. Reading a diff against its task takes minutes; one silent past this
	// is stuck whatever its process says.
	ReviewTimeout = 20 * time.Minute
	// MaxReviewNoteLen bounds a verdict's note in runes: it goes into a worker's prompt and the lead's status. A
	// longer note is refused, not clipped.
	MaxReviewNoteLen = 2000
	// reviewEvidenceWait is how long review waits for the worker's evidence seal, which runs off the completion
	// RPC and carries the worker's closing note: the one account of its work the reviewer gets.
	reviewEvidenceWait = time.Minute
)

// reviewTreeHead reads the lane tree's HEAD, and resetReviewTree moves the lane's branch back to the worker's
// commit. Vars so tests need no repo.
var reviewTreeHead = func(ctx context.Context, wt string) (string, error) {
	return git(ctx, wt, "rev-parse", "HEAD")
}

var resetReviewTree = func(ctx context.Context, wt, commit string) error {
	_, err := git(ctx, wt, "reset", "--hard", commit)
	return err
}

func taskByReviewRunID(g *waveobj.TaskGroup, runID string) *waveobj.TaskNode {
	for i := range g.Tasks {
		if g.Tasks[i].ReviewRunID != "" && g.Tasks[i].ReviewRunID == runID {
			return &g.Tasks[i]
		}
	}
	return nil
}

// advanceReviews moves every reviewing task one step: a recorded verdict is applied, a reviewer that ended
// without one is replaced once, and a task with no reviewer gets one. It runs in the tick, before the task-done
// accounting, so a pass is counted done in the tick that applies it.
func advanceReviews(ctx, spawnCtx context.Context, g *waveobj.TaskGroup, owner *waveobj.Run, runs map[string]*waveobj.Run, now int64, afterCommit *[]func()) {
	for i := range g.Tasks {
		t := &g.Tasks[i]
		if t.State != TaskState_Reviewing {
			continue
		}
		worker := runs[t.RunID]
		if worker == nil {
			continue // unreadable this tick; the next one retries
		}
		if t.ReviewRunID != "" && t.ReviewVerdict != "" {
			applyReviewVerdict(ctx, g, t, worker, afterCommit)
			continue
		}
		if t.ReviewRunID != "" {
			reason := reviewerLost(ctx, g, t, now)
			if reason == "" {
				continue
			}
			stopReviewer(ctx, g, t.ReviewRunID, afterCommit)
			t.ReviewRunID = ""
			if !spendReviewRespawn(ctx, g, t, reason, afterCommit) {
				continue
			}
		}
		if worker.Evidence == nil && now-workerDoneTs(worker) < reviewEvidenceWait.Milliseconds() {
			continue
		}
		spawnReviewer(ctx, spawnCtx, g, t, owner, worker, now, afterCommit)
	}
}

// workerDoneTs is when the worker's run finished: its latest phase completion.
func workerDoneTs(run *waveobj.Run) int64 {
	var ts int64
	for _, p := range run.Phases {
		if p.DoneTs > ts {
			ts = p.DoneTs
		}
	}
	return ts
}

// spawnReviewer starts a task's reviewer in the worker's lane tree, on the reviewer route: the model picked
// for judgment, and not the worker's own.
func spawnReviewer(ctx, spawnCtx context.Context, g *waveobj.TaskGroup, t *waveobj.TaskNode, owner, worker *waveobj.Run, now int64, afterCommit *[]func()) {
	pin := reviewerRoute(owner, g)
	capability, err := runroute.Resolve(pin)
	if err == nil {
		err = validateLeadHarness(pin.Runtime)
	}
	if err != nil {
		failReview(ctx, g, t, "reviewer could not start: "+err.Error(), afterCommit)
		return
	}
	prompt := reviewPrompt(g, t, worker, toldToTask(ctx, g, t.ID))
	runID, sessionId := uuid.NewString(), jarvis.WorkerSessionId(pin.Runtime)
	oref, err := spawnWorker(spawnCtx, capability, owner.WorkspaceId, "", worker.ProjectPath, prompt,
		jarvis.RunWorkerOptions{SessionId: sessionId, RunId: runID, TaskId: t.ID, Label: "review " + t.ID})
	if err != nil {
		spendReviewRespawn(ctx, g, t, "reviewer could not start: "+err.Error(), afterCommit)
		return
	}
	child := childRunFromSpec(g, t, owner, pin, worker.ProjectPath, worker.EndCommit, prompt)
	child.ID = runID
	child.SessionId = sessionId
	child.Review = true
	for i := range child.Phases {
		if child.Phases[i].State == jarvis.PhaseState_Running {
			child.Phases[i].WorkerOrefs = []string{oref}
			break
		}
	}
	if err := appendChildRun(spawnCtx, g.ChannelId, child); err != nil {
		if serr := stopSpawnedWorker(spawnCtx, oref); serr != nil {
			log.Printf("dag %s task %s: stopping unrecorded reviewer %s: %v", g.OID, t.ID, oref, serr)
		}
		spendReviewRespawn(ctx, g, t, "recording the reviewer failed: "+err.Error(), afterCommit)
		return
	}
	runORef := waveobj.MakeORef(waveobj.OType_Run, runID).String()
	channelORef := waveobj.MakeORef(waveobj.OType_Channel, g.ChannelId).String()
	if err := stampSpawnedWorker(spawnCtx, oref, runORef, channelORef); err != nil {
		log.Printf("dag %s task %s: stamp reviewer %s: %v", g.OID, t.ID, oref, err)
	}
	if err := startWorker(spawnCtx, oref); err != nil {
		abandonUnstartedWorker(spawnCtx, g.ChannelId, runID, oref)
		spendReviewRespawn(ctx, g, t, "reviewer could not start: "+err.Error(), afterCommit)
		return
	}
	t.ReviewRunID, t.ReviewSpawnedTs = runID, now
	taskID := t.ID
	*afterCommit = append(*afterCommit, func() {
		wcore.SendWaveObjUpdate(waveobj.MakeORef(waveobj.OType_Run, runID))
		wcore.SendWaveObjUpdate(waveobj.MakeORef(waveobj.OType_Channel, g.ChannelId))
		appendRunEvent(ctx, g.ChannelId, g.RunID, waveobj.RunEventKindTaskReviewStarted, nil, map[string]any{"taskid": taskID, "runid": runID})
	})
}

// reviewerLost says why a reviewer with no verdict is done for, or "" while it is still working.
func reviewerLost(ctx context.Context, g *waveobj.TaskGroup, t *waveobj.TaskNode, now int64) string {
	if now-t.ReviewSpawnedTs > ReviewTimeout.Milliseconds() {
		return fmt.Sprintf("reviewer gave no verdict within %s", ReviewTimeout)
	}
	run, err := wstore.GetRun(ctx, g.ChannelId, t.ReviewRunID)
	if err != nil {
		return "" // unreadable this tick; the timeout still bounds it
	}
	switch run.Status {
	case jarvis.RunStatus_Done, jarvis.RunStatus_Cancelled, jarvis.RunStatus_Blocked:
		return "reviewer ended without a verdict"
	}
	if workerControllerGone(ctx, run) {
		return "reviewer exited without a verdict"
	}
	return ""
}

// stopReviewer cancels a reviewer being replaced and stops its process once the tick commits. A reviewer
// that already finished keeps the status it finished with.
func stopReviewer(ctx context.Context, g *waveobj.TaskGroup, runID string, afterCommit *[]func()) {
	*afterCommit = append(*afterCommit, func() {
		if err := wstore.UpdateRun(ctx, g.ChannelId, runID, func(r *waveobj.Run) error {
			if r.Status == jarvis.RunStatus_Executing || r.Status == jarvis.RunStatus_Planning {
				*r = jarvis.CancelRun(*r)
			}
			return nil
		}); err != nil {
			log.Printf("dag %s: cancelling reviewer run %s: %v", g.OID, runID, err)
			return
		}
		run, err := wstore.GetRun(ctx, g.ChannelId, runID)
		if err != nil {
			return
		}
		if err := stopRunWorkers(ctx, run); err != nil {
			log.Printf("dag %s: stopping reviewer run %s: %v", g.OID, runID, err)
		}
	})
}

// spendReviewRespawn allows one more reviewer this round; past the limit the review fails for the lead with
// reason. It reports whether another reviewer may be spawned.
func spendReviewRespawn(ctx context.Context, g *waveobj.TaskGroup, t *waveobj.TaskNode, reason string, afterCommit *[]func()) bool {
	if t.ReviewRespawns >= MaxReviewRespawns {
		failReview(ctx, g, t, reason, afterCommit)
		return false
	}
	t.ReviewRespawns++
	return true
}

// applyReviewVerdict acts on a recorded verdict. The reviewer completes its own run after the verdict, so it
// is not stopped here.
func applyReviewVerdict(ctx context.Context, g *waveobj.TaskGroup, t *waveobj.TaskNode, worker *waveobj.Run, afterCommit *[]func()) {
	t.ReviewRunID = ""
	t.ReviewCommit = worker.EndCommit
	// a reviewer's commit would land with the lane; its uncommitted edits cannot, since a lane lands by squashing
	// its branch and the next dispatch rebuilds a dirty tree
	head, err := reviewTreeHead(ctx, worker.ProjectPath)
	if err != nil || head != worker.EndCommit {
		reason := "reviewer modified the worktree"
		if err != nil {
			reason = "reading the worktree after review: " + err.Error()
		} else if rerr := resetReviewTree(ctx, worker.ProjectPath, worker.EndCommit); rerr != nil {
			reason += "; resetting it failed: " + rerr.Error()
		}
		// the discarded verdict must not read as the review's outcome
		t.ReviewVerdict, t.ReviewDownstream, t.ReviewUnverified, t.ReviewDownstreamFor = "", "", "", nil
		failReview(ctx, g, t, reason, afterCommit)
		return
	}
	taskID, note, downstream, unverified := t.ID, t.ReviewNote, t.ReviewDownstream, t.ReviewUnverified
	if t.ReviewVerdict == ReviewVerdict_Pass {
		t.State = TaskState_Done
		t.LeadGuidance = ""
		line := fmt.Sprintf("%s passed review: %s", taskID, truncateNote(note, handoffMaxSummaryLen))
		sections := leadSectionLines(taskID, worker)
		later, named := unfinishedDescendants(g, taskID), t.ReviewDownstreamFor
		detail := map[string]any{"taskid": taskID, "note": note, "downstream": downstream, "unverified": unverified}
		rep, _ := workerReportOf(worker)
		forLater := ""
		if rep.ForLater != "" {
			forLater = capSection(taskID, jarvis.ReportKeyForLater, rep.ForLater)
		}
		// nobody after this task to read it, so it is the lead's to act on with the rest
		forLead := forLater != "" && len(later) == 0 && len(named) == 0
		if forLead {
			sections = append(sections, fmt.Sprintf("%s %s: %s", taskID, sectionHeading(jarvis.ReportKeyForLater), forLater))
			detail["forlead"] = true
		}
		*afterCommit = append(*afterCommit, func() {
			appendRunEvent(ctx, g.ChannelId, g.RunID, waveobj.RunEventKindTaskReviewPassed, nil, detail)
			PostQuiet(ctx, g.ChannelId, g.RunID, line)
			// the caveats are what the lead must act on, so they travel whole apart from the recap's cut
			for _, s := range sections {
				PostCaveat(ctx, g.ChannelId, g.RunID, flatLine(s))
			}
			if unverified != "" {
				PostCaveat(ctx, g.ChannelId, g.RunID, fmt.Sprintf("%s reviewer: %s", taskID, flatLine(unverified)))
			}
		})
		if forLater != "" && !forLead {
			routeForLater(ctx, g, taskID, forLater, later, named, afterCommit)
		}
		if downstream != "" {
			routeDownstream(ctx, g, taskID, downstream, unionIDs(later, named), afterCommit)
		}
		return
	}
	t.ReviewRound++
	if t.ReviewRound >= MaxReviewRounds {
		failReview(ctx, g, t, note, afterCommit)
		return
	}
	round := t.ReviewRound
	// back to a worker in the same lane tree, which still holds the rejected commit; taskPrompt carries the findings
	t.State = TaskState_Pending
	t.RunID = ""
	*afterCommit = append(*afterCommit, func() {
		appendRunEvent(ctx, g.ChannelId, g.RunID, waveobj.RunEventKindTaskReviewFailed, nil, map[string]any{"taskid": taskID, "note": note, "round": round, "final": false})
	})
}

// descendants is every task that transitively depends on id, in dag order.
func descendants(g *waveobj.TaskGroup, id string) []string {
	in := map[string]bool{id: true}
	// dag order need not be topological, so sweep until nothing joins
	for grew := true; grew; {
		grew = false
		for i := range g.Tasks {
			t := &g.Tasks[i]
			if in[t.ID] {
				continue
			}
			for _, d := range t.Deps {
				if in[d] {
					in[t.ID], grew = true, true
					break
				}
			}
		}
	}
	var out []string
	for i := range g.Tasks {
		if g.Tasks[i].ID != id && in[g.Tasks[i].ID] {
			out = append(out, g.Tasks[i].ID)
		}
	}
	return out
}

// unfinishedDescendants are the descendants a note for later tasks can still reach.
func unfinishedDescendants(g *waveobj.TaskGroup, id string) []string {
	var out []string
	for _, d := range descendants(g, id) {
		if t := taskByID(g, d); amendable(t.State) || tellRunID(t) != "" {
			out = append(out, d)
		}
	}
	return out
}

func unionIDs(a, b []string) []string {
	out := append([]string{}, a...)
	for _, id := range b {
		if !slices.Contains(out, id) {
			out = append(out, id)
		}
	}
	return out
}

// laterNote is one note for a later task as each delivery spells it.
type laterNote struct {
	amend string // joins the prompt of a task not started
	typed string // is typed to the worker of a task at work
}

// deliverLater hands a note to one later task: into the prompt of one not started, typed to the worker or reviewer of
// one at work. It says where the note went, or why it could not go, for the lead.
func deliverLater(ctx context.Context, g *waveobj.TaskGroup, from, id string, n laterNote, afterCommit *[]func()) (reached, missed string) {
	target := taskByID(g, id)
	if target == nil {
		return "", id + ", which is not in the dag"
	}
	if amendable(target.State) {
		target.LeadNotes = append(target.LeadNotes, n.amend)
		*afterCommit = append(*afterCommit, func() {
			appendRunEvent(ctx, g.ChannelId, g.RunID, waveobj.RunEventKindTaskAmended, nil, map[string]any{"taskid": id, "text": toldText(n.amend), "from": from})
		})
		return id + " (added to its prompt)", ""
	}
	if tellRunID(target) == "" {
		return "", fmt.Sprintf("%s, which is %s", id, target.State)
	}
	// typed text and its enter would land in the question's picker and choose for the worker
	if _, _, asking := taskPendingAsk(ctx, g, target); asking && target.State != TaskState_Reviewing {
		return "", id + ", which is waiting on a question"
	}
	blockId, err := taskTerminal(ctx, g, target)
	if err != nil {
		return "", id + ", which has no live terminal"
	}
	target.LeadTold = append(target.LeadTold, n.typed)
	*afterCommit = append(*afterCommit, func() {
		sendWakeFn(blockId, n.typed)
		appendRunEvent(ctx, g.ChannelId, g.RunID, waveobj.RunEventKindTaskLeadTold, nil, map[string]any{"taskid": id, "text": toldText(n.typed), "from": from})
	})
	return id + " (typed to its worker)", ""
}

// routeForLater delivers a passed worker's For later tasks to its unfinished descendants and the tasks its reviewer
// named. A descendant not started reads it from the report at dispatch (predecessorHandoff), so nothing is stored on it;
// a named task off the plan's edges has no such read, so the section joins its prompt.
func routeForLater(ctx context.Context, g *waveobj.TaskGroup, from, section string, later, named []string, afterCommit *[]func()) {
	heading := sectionHeading(jarvis.ReportKeyForLater)
	n := laterNote{
		amend: fmt.Sprintf("%s's worker, %s: %s", from, heading, section),
		typed: fmt.Sprintf("%s passed review; its worker's %s: %s", from, heading, section),
	}
	var reached, missed []string
	for _, id := range unionIDs(later, named) {
		if t := taskByID(g, id); t != nil && amendable(t.State) && slices.Contains(later, id) {
			reached = append(reached, id+" (at dispatch)")
			continue
		}
		r, m := deliverLater(ctx, g, from, id, n, afterCommit)
		if r != "" {
			reached = append(reached, r)
		} else {
			missed = append(missed, m)
		}
	}
	*afterCommit = append(*afterCommit, func() {
		if len(reached) > 0 {
			PostQuiet(ctx, g.ChannelId, g.RunID, fmt.Sprintf("%s's %s reached %s", from, heading, strings.Join(reached, ", ")))
		}
		if len(missed) > 0 {
			PostWake(ctx, g.ChannelId, g.RunID, forLaterMissedWake(from, heading, section, missed))
		}
	})
}

// routeDownstream delivers a passed review's note for later tasks to its targets, the task's unfinished descendants
// and the tasks its reviewer named. The lead hears where it went on its next wake; what could not be delivered, and a
// note with no task to reach, wakes it to route by hand. The lead was the only relay once, and a note it did not act
// on never reached the task that needed it (run ad78cbcb).
func routeDownstream(ctx context.Context, g *waveobj.TaskGroup, from, note string, targets []string, afterCommit *[]func()) {
	if len(targets) == 0 {
		*afterCommit = append(*afterCommit, func() { PostWake(ctx, g.ChannelId, g.RunID, downstreamWake(from, note)) })
		return
	}
	n := laterNote{
		amend: toldText(from + "'s reviewer: " + note),
		typed: fmt.Sprintf("%s passed review with a note for your task: %s", from, note),
	}
	var reached, missed []string
	for _, id := range targets {
		r, m := deliverLater(ctx, g, from, id, n, afterCommit)
		if r != "" {
			reached = append(reached, r)
		} else {
			missed = append(missed, m)
		}
	}
	*afterCommit = append(*afterCommit, func() {
		if len(reached) > 0 {
			PostQuiet(ctx, g.ChannelId, g.RunID, fmt.Sprintf("%s's review note reached %s: %s", from, strings.Join(reached, ", "), flatLine(note)))
		}
		if len(missed) > 0 {
			PostWake(ctx, g.ChannelId, g.RunID, downstreamMissedWake(from, note, missed))
		}
	})
}

// failReview hands a task's review to the lead: failed rounds spent, or a reviewer that could not do its job.
// The worker's run stays on the task, so the lead's approve can land it as it is.
func failReview(ctx context.Context, g *waveobj.TaskGroup, t *waveobj.TaskNode, reason string, afterCommit *[]func()) {
	t.State = TaskState_ReviewFailed
	t.ReviewNote = reason
	taskID, round := t.ID, t.ReviewRound
	*afterCommit = append(*afterCommit, func() {
		appendRunEvent(ctx, g.ChannelId, g.RunID, waveobj.RunEventKindTaskReviewFailed, nil, map[string]any{"taskid": taskID, "note": reason, "round": round, "final": true})
		PostWake(ctx, g.ChannelId, g.RunID, reviewFailedWake(taskID))
	})
}

// RecordReviewVerdict records a reviewer's verdict on the task it reviews. It does not schedule: the caller
// does, off the reviewer's RPC, because the tick that applies a fail can spawn the next worker.
func RecordReviewVerdict(ctx context.Context, dagID, reviewerRunID, verdict, note, downstream, unverified string, downstreamFor []string) error {
	note, downstream, unverified = strings.TrimSpace(note), strings.TrimSpace(downstream), strings.TrimSpace(unverified)
	switch {
	case verdict != ReviewVerdict_Pass && verdict != ReviewVerdict_Fail:
		return fmt.Errorf("verdict must be %s or %s, got %q", ReviewVerdict_Pass, ReviewVerdict_Fail, verdict)
	case note == "":
		return fmt.Errorf("a %s verdict needs its note: the summary for a pass, the findings for a fail", verdict)
	case verdict == ReviewVerdict_Fail && downstream != "":
		return fmt.Errorf("--downstream goes with a pass; put what later tasks need in the findings")
	case verdict == ReviewVerdict_Fail && unverified != "":
		return fmt.Errorf("--unverified goes with a pass; a fail's findings already say what is missing")
	}
	// refused rather than clipped: a clipped note silently drops the findings the next worker must fix
	for _, n := range []struct{ name, text string }{{"note", note}, {"--downstream note", downstream}, {"--unverified note", unverified}} {
		if count := utf8.RuneCountInString(n.text); count > MaxReviewNoteLen {
			return fmt.Errorf("the %s is %d characters; the limit is %d. Shorten it and send the verdict again", n.name, count, MaxReviewNoteLen)
		}
	}
	return withDagMutation(dagID, func() error {
		g, err := wstore.GetDag(ctx, dagID)
		if err != nil {
			return fmt.Errorf("loading dag: %w", err)
		}
		t := taskByReviewRunID(g, reviewerRunID)
		if t == nil || t.State != TaskState_Reviewing {
			return fmt.Errorf("run %s is not reviewing a task of this dag", reviewerRunID)
		}
		if t.ReviewVerdict != "" {
			return fmt.Errorf("task %s already has a %s verdict", t.ID, t.ReviewVerdict)
		}
		targets, err := downstreamTargets(g, t.ID, downstreamFor)
		if err != nil {
			return err
		}
		// --for alone forwards the worker's For later tasks, so there must be one to forward
		if len(targets) > 0 && downstream == "" {
			worker, err := wstore.GetRun(ctx, g.ChannelId, t.RunID)
			if err != nil {
				return fmt.Errorf("loading the worker's run %s: %w", t.RunID, err)
			}
			heading := sectionHeading(jarvis.ReportKeyForLater)
			rep, unstructured := workerReportOf(worker)
			if unstructured != "" {
				return fmt.Errorf("the worker's report is unstructured, so it has no %s to forward; give --downstream with what they must know", heading)
			}
			if rep.ForLater == "" {
				return fmt.Errorf("the worker's %s is None; give --downstream with what they must know", heading)
			}
		}
		t.ReviewDownstreamFor = targets
		t.ReviewVerdict = verdict
		t.ReviewNote = note
		t.ReviewDownstream = downstream
		t.ReviewUnverified = unverified
		g.UpdatedTs = time.Now().UnixMilli()
		if err := wstore.UpdateDag(ctx, dagID, func(cur *waveobj.TaskGroup) error {
			*cur = *g
			return nil
		}); err != nil {
			return err
		}
		wcore.SendWaveObjUpdate(waveobj.MakeORef(waveobj.OType_Dag, g.OID))
		return nil
	})
}

// downstreamTargets resolves the tasks a reviewer named for its note ("t-3" or "3"), refusing one the dag does not have
// and the reviewed task itself, so a typo comes back to the reviewer instead of reaching the wrong task.
func downstreamTargets(g *waveobj.TaskGroup, reviewed string, names []string) ([]string, error) {
	var out []string
	for _, name := range names {
		id := strings.TrimSpace(name)
		if id == "" {
			continue
		}
		if !strings.HasPrefix(id, "t-") {
			id = "t-" + id
		}
		if taskByID(g, id) == nil {
			return nil, fmt.Errorf("--for %s: the dag has no task %s", name, id)
		}
		if id == reviewed {
			return nil, fmt.Errorf("--for %s: that is the task under review; name the later tasks the note is for", name)
		}
		if !slices.Contains(out, id) {
			out = append(out, id)
		}
	}
	return out, nil
}

// reviewPrompt is a reviewer's whole brief: what the task asked for, where the spec and plan are, what the
// worker said it did, and the one diff to judge. It checks intent, not tests: Verify runs those at the merge.
// The reviewer works in the worker's tree, so that is where it reads the docs.
func reviewPrompt(g *waveobj.TaskGroup, task *waveobj.TaskNode, worker *waveobj.Run, told []string) string {
	var b strings.Builder
	fmt.Fprintf(&b, "You are the reviewer for task %s", task.ID)
	if g.PlanPath != "" {
		fmt.Fprintf(&b, " of the plan at %s", DocPath(g, worker.ProjectPath, g.PlanPath))
	}
	if g.SpecPath != "" {
		fmt.Fprintf(&b, " (spec: %s)", DocPath(g, worker.ProjectPath, g.SpecPath))
	}
	b.WriteString(". A worker finished it; judge its change against what the task asked for before it lands.\n")
	fmt.Fprintf(&b, "The change: `git diff %s..%s` in this directory.\n", task.ReviewBase, worker.EndCommit)
	b.WriteString("Check it against the task below and the spec: every requirement met, nothing that contradicts the spec, no corners cut (stubs, skipped cases, weakened or deleted tests, TODOs), nothing outside the task's scope. The plan's Verify runs the tests after the merge, so don't run the full suite; run a focused test only to settle a doubt.\n")
	done, differs := sectionHeading(jarvis.ReportKeyDone), sectionHeading(jarvis.ReportKeyDiffers)
	notVerified, forLater := sectionHeading(jarvis.ReportKeyNotVerified), sectionHeading(jarvis.ReportKeyForLater)
	fmt.Fprintf(&b, "Check the worker's report against the diff too: %s matches the diff; %s names every departure the diff shows; %s names every check the task asked for that neither the diff nor %s shows done.\n", done, differs, notVerified, done)
	b.WriteString("Only read: never edit, stage or commit, and ask no questions, since nobody answers a reviewer.\n")
	b.WriteString("Finish with exactly one command, which ends your session:\n")
	fmt.Fprintf(&b, "- `wsh jarvis dag review pass \"<one paragraph: what landed>\"`. The worker's report sections already reach the lead and later tasks whole (%s to every unfinished task that depends on this one), so don't restate them. Add `--unverified \"<what was not verified, and why>\"` only for a check the task asked for (a test, a screenshot, a live run) that %s omits: the lead reads it whole, ahead of your note. Add `--downstream \"<what a later task must know>\"` only for what %s omits or gets wrong (a renamed API, a plan assumption that turned out wrong): the engine hands it to the tasks that depend on this one, and to the tasks `--for <task ids>` names. `--for <task ids>` alone forwards the worker's %s to the tasks you name;\n", forLater, notVerified, forLater, forLater)
	b.WriteString("- `wsh jarvis dag review fail \"<findings: each problem, where it is, and the fix>\"`.\n")
	fmt.Fprintf(&b, "Keep each note within %d characters; a longer one is refused.\n", MaxReviewNoteLen)
	if ahead := tasksAhead(g, task.ID); ahead != "" {
		fmt.Fprintf(&b, "Tasks not finished yet, which --for can name: %s.\n", ahead)
	}
	b.WriteString("\n")
	if g.Preamble != "" {
		b.WriteString("The plan's header applies to every task:\n")
		b.WriteString(g.Preamble)
		b.WriteString("\n\n")
	}
	b.WriteString("The task:\n")
	goal := task.RunSpec.Goal
	if goal == "" {
		goal = task.Label
	}
	b.WriteString(goal)
	if task.Description != "" {
		b.WriteString("\n\n")
		b.WriteString(roundDescription(g, task.Description, worker.ProjectPath))
	}
	// whole, unlike a dependent's handoff: the report is the reviewer's one account of what was and was not checked
	if worker.Evidence != nil {
		if note := strings.TrimSpace(worker.Evidence.Summary); note != "" {
			fmt.Fprintf(&b, "\n\nThe worker reported: %s", note)
		}
	}
	if extra := reviewAdditions(task, told); extra != "" {
		b.WriteString("\n\n")
		b.WriteString(extra)
	}
	return b.String()
}

// reviewAdditions is what the task gained after the plan was written: notes the lead or an earlier reviewer
// added (LeadNotes), the lead's guidance after a sendback, and what was typed to its worker. The worker was
// asked to act on them, so a reviewer judging against the plan alone reads a requested change as scope creep.
func reviewAdditions(task *waveobj.TaskNode, told []string) string {
	lines := append([]string{}, task.LeadNotes...)
	if task.LeadGuidance != "" {
		lines = append(lines, "the lead's guidance after a sendback: "+task.LeadGuidance)
	}
	for _, s := range told {
		lines = append(lines, "typed to the worker: "+s)
	}
	if len(lines) == 0 {
		return ""
	}
	var b strings.Builder
	b.WriteString("The worker was also told these after the plan was written; judge the change against them too:")
	for _, l := range lines {
		fmt.Fprintf(&b, "\n- %s", l)
	}
	return b.String()
}

// toldToTask is what was typed into a task's worker, oldest first: the lead's `dag tell` and a reviewer's
// downstream note typed to a live worker (task-lead-told), and the human's own messages (task-told). A tell
// that went to a reviewer is left out. A failed read leaves the brief without them rather than failing the
// review.
func toldToTask(ctx context.Context, g *waveobj.TaskGroup, taskID string) []string {
	kinds := []string{waveobj.RunEventKindTaskLeadTold, waveobj.RunEventKindTaskTold}
	evs, err := wstore.QueryRunEventsByKind(ctx, g.ChannelId, g.RunID, kinds, 0)
	if err != nil {
		log.Printf("dag %s task %s: reading what its worker was told: %v", g.OID, taskID, err)
		return nil
	}
	var out []string
	for i := len(evs) - 1; i >= 0; i-- {
		var d struct {
			TaskId string `json:"taskid"`
			Text   string `json:"text"`
			To     string `json:"to"`
		}
		if json.Unmarshal(evs[i].Detail, &d) != nil || d.TaskId != taskID || d.Text == "" || d.To == "reviewer" {
			continue
		}
		out = append(out, d.Text)
	}
	return out
}

// tasksAhead lists the tasks a downstream note can still reach, each with its title, for the reviewer to name.
func tasksAhead(g *waveobj.TaskGroup, reviewed string) string {
	var out []string
	for i := range g.Tasks {
		t := &g.Tasks[i]
		if t.ID == reviewed || (!amendable(t.State) && tellRunID(t) == "") {
			continue
		}
		out = append(out, fmt.Sprintf("%s (%s)", t.ID, t.Label))
	}
	return strings.Join(out, ", ")
}

// reviewFeedback is what a re-dispatched task is told about the attempt a reviewer rejected: the findings, and
// the lead's guidance when the lead sent it back. Empty for a task no reviewer has failed.
func reviewFeedback(task *waveobj.TaskNode) string {
	var parts []string
	if task.ReviewVerdict == ReviewVerdict_Fail && task.ReviewCommit != "" {
		parts = append(parts, fmt.Sprintf("A reviewer rejected the previous attempt (commit %s): %s\nFix these on top of that commit; don't restart.", task.ReviewCommit, task.ReviewNote))
	}
	if task.LeadGuidance != "" {
		parts = append(parts, "The lead's guidance: "+task.LeadGuidance)
	}
	return strings.Join(parts, "\n")
}
