// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"fmt"
	"log"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/agentask"
	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// askDeadlineNote is why a question the lead sat on past LeadAskDeadline moved to the human.
const askDeadlineNote = "lead did not answer in time"

// TakenOverNote is why a question the human took from the lead is theirs. The lead reads it too, in the
// refusal of an answer it had already started.
const TakenOverNote = "taken over from the lead"

// ForwardedByHuman marks a task-forwarded row the human made by taking a question over, rather than one
// the lead or the engine handed on.
const ForwardedByHuman = "human"

// runFinishedWake is the first line of every run-finished wake. A run with no lead is not given one for it
// (nothingToLaunchFor), so the outcome goes on the lines after it and this line stays fixed.
const runFinishedWake = "wake: run finished. wsh jarvis dag status"

// finalRerunWakeHead opens the wake that tells a lead the human reran the failed final stage. It asks a lead only to
// drop a fix plan, so a run with no lead is not given one for it (nothingToLaunchFor).
const finalRerunWakeHead = "wake: the human reran the final stage"

func finalRerunWake(round int) string {
	return fmt.Sprintf("%s of round %d; its failure was outside the code. Drop any fix plan for it; the stage's outcome wakes you.", finalRerunWakeHead, round)
}

// finalRerunAnswer answers the lead's open question when the human reran the stage instead: the held rerun wake would
// arrive only after the lead acted on whatever the human answered.
func finalRerunAnswer(round int) string {
	return fmt.Sprintf("The human reran the final stage of round %d in the cockpit; its failure was outside the code. Drop any fix plan for it; the stage's outcome wakes you.", round)
}

// RunFinishedWake states the final stage's outcome, and every reason it could not verify something in full:
// the lead's report has to carry them.
func RunFinishedWake(f *waveobj.FinalStage) string {
	if f == nil {
		return runFinishedWake
	}
	if f.State != FinalState_Passed && f.State != FinalState_Unverified {
		return runFinishedWake + "\nThe final stage " + f.State + " on the merged result."
	}
	lines := []string{runFinishedWake, "The final stage passed on the merged result."}
	if f.State == FinalState_Unverified {
		lines = []string{runFinishedWake, "The final stage finished unverified. What it could not verify:"}
		for _, r := range f.Unverified {
			lines = append(lines, "- "+r)
		}
	}
	if f.Round < MaxFinalRounds {
		lines = append(lines, roundLeftLine)
	} else {
		lines = append(lines, noRoundLeftLine)
	}
	return strings.Join(lines, "\n")
}

// roundLeftLine and noRoundLeftLine end a passed or unverified run-finished wake: the engine counts the rounds,
// so the lead only judges which open issues are round work.
const (
	roundLeftLine   = "One round is left for the open issues that are round work: `wsh jarvis dag submit --round --plan <fix plan>`."
	noRoundLeftLine = "No round is left: every open issue is an effort chunk."
)

// landBlockerLines go after the run-finished wake's outcome, one per thing the land would hold on now, each with
// what the lead may do about it, so it acts or reports before complete closes its tab. Only a conflict is the
// lead's to fix; the checkout is the human's and other sessions', and the lead never touches uncommitted changes
// that are not its own. Empty when the land would merge, or cannot be predicted: the land checks again either way.
// A failed final stage is not repeated here: the wake's outcome line already says it.
func landBlockerLines(ctx context.Context, run *waveobj.Run) string {
	if run.LandPath == "" {
		return ""
	}
	var lines []string
	if hold := landPrecheck(ctx, run); hold != nil {
		switch {
		case hold.Dirty:
			lines = append(lines, fmt.Sprintf("The land will hold: %s. That is not yours: it belongs to another session or the human. Do not commit, stash, restore, delete, continue or abort anything in the checkout; say in your report that the land waits on it. The engine lands the run by itself once it is gone.", hold.Reason))
		default:
			lines = append(lines, fmt.Sprintf("The land will hold: %s. That is the human's to clear, not yours: leave the checkout as it is and say it in your report.", hold.Reason))
		}
	}
	changed, err := landingTreeChanges(ctx, run, false)
	if err != nil {
		log.Printf("run %s: %v", run.ID, err)
	}
	if len(changed) > 0 {
		lines = append(lines, fmt.Sprintf("The land will hold: this tree has uncommitted changes to %s, and the land removes the tree. They are this run's: commit them, or drop them, before you complete.", strings.Join(changed, ", ")))
	}
	files, err := LandConflicts(ctx, run)
	if err != nil {
		log.Printf("run %s: %v", run.ID, err)
	}
	if len(files) > 0 {
		lines = append(lines, fmt.Sprintf("The land into %s will conflict in %s: merge %s into this tree, resolve, commit, then complete.", run.BaseBranch, strings.Join(files, ", "), run.BaseBranch))
	}
	if len(lines) == 0 {
		return ""
	}
	return "\n" + strings.Join(lines, "\n")
}

// fixEveryFailure keeps a lead from reading the run-finished exemptions into a failed final: a step that
// already failed on the base holds the land as much as one the run broke (run 72262859 held on four).
const fixEveryFailure = "Fix every failing step, one already on the base or outside the goal included, since any of them holds the land."

// finalFailedWake carries the final stage's failure whole: the lead writes its fix plan from it. After the
// last round the call is the human's, and the lead must say the land will hold: the land runs after complete
// closes the lead's tab, so nobody else can warn the human first (run dc7d6de0 completed held and unannounced).
// An autonomous run has nobody to put it to: the lead completes with the land held, and its report is the warning.
func finalFailedWake(round int, runID, detail string, last, autonomous bool) string {
	switch {
	case last && autonomous:
		return fmt.Sprintf("wake: the final stage failed on the merged result in round %d, the last. The run is autonomous and nobody is at the cockpit, so the call is yours: complete with the plain `wsh jarvis complete --report <file>`, never `--force-land`. A failed final stage holds the land, so the branch stays unmerged until `wsh runs land %s --force`, the human's call once the run is done; say in your report that the land is held and why:\n%s", round, runID, detail)
	case autonomous:
		return fmt.Sprintf("wake: the final stage failed on the merged result in round %d. Write a fix plan and run `wsh jarvis dag submit --round --plan <fix plan>`. %s If the fix is a product call, make the call you would recommend and record it and why in your report:\n%s", round, fixEveryFailure, detail)
	case last:
		return fmt.Sprintf("wake: the final stage failed on the merged result in round %d, the last. Put it to the human, and say that completing will not merge the branch: a failed final stage holds the land, and only `wsh runs land %s --force`, the human's call once the run is done, lands it:\n%s", round, runID, detail)
	}
	return fmt.Sprintf("wake: the final stage failed on the merged result in round %d. Write a fix plan and run `wsh jarvis dag submit --round --plan <fix plan>`. %s Put it to the human if the fix is a product call:\n%s", round, fixEveryFailure, detail)
}

// finalKilledWake hands the lead a final stage whose step something outside killed: it judged nothing, so a fix plan
// would chase a defect nobody found. A rerun spends no round, and whoever killed it decides when to run it again.
func finalKilledWake(round int, runID, detail string, autonomous bool) string {
	if autonomous {
		return fmt.Sprintf("wake: a step of the final stage was killed from outside in round %d, before it judged anything. Write no fix plan. The run is autonomous and nobody is at the cockpit: complete with the plain `wsh jarvis complete --report <file>`; the land stays held until the human reruns the stage with `wsh runs rerun-final %s`, so say that in your report:\n%s", round, runID, detail)
	}
	return fmt.Sprintf("wake: a step of the final stage was killed from outside in round %d, before it judged anything. Write no fix plan: put it to the human, who reruns the stage with `wsh runs rerun-final %s` once whatever killed it is gone; a rerun spends no round, and the land holds until a run of the stage passes:\n%s", round, runID, detail)
}

// taskStatusCmd prints one task's status: a task wake names it, so the lead reads that task and not the whole dag.
func taskStatusCmd(taskID string) string {
	return "wsh jarvis dag status " + taskID
}

// wakeFact is the first line of what a wake carries, within MaxFailureDetailLen: the one fact the lead acts on
// first, before it reads the task's status. "" when there is none.
func wakeFact(s string) string {
	for _, line := range strings.Split(s, "\n") {
		if line = strings.TrimSpace(line); line != "" {
			return truncateText(line, MaxFailureDetailLen)
		}
	}
	return ""
}

// withFact appends a wake's fact after a colon, or nothing when there is none.
func withFact(head, fact string) string {
	if fact = wakeFact(fact); fact != "" {
		return head + ": " + strings.TrimRight(fact, ". ")
	}
	return head
}

// taskFailedWake names the failure kind and the first line of what failed, so the lead can pick retry, escalate,
// skip or forward before reading the task's status. A child run that reported itself blocked carries no kind. A
// worker-stopped task was never retried and never judged, so its wake leaves the call to the lead.
func taskFailedWake(taskID, kind, detail string) string {
	if kind == "" {
		kind = FailureKindUnknown
	}
	head := withFact(fmt.Sprintf("wake: task %s failed (%s)", taskID, kind), detail)
	if kind == FailureKindWorkerStopped {
		return fmt.Sprintf("%s. Its worker was stopped and not judged, and nothing retried it: retry, escalate, skip or forward it as you judge. %s", head, taskStatusCmd(taskID))
	}
	return fmt.Sprintf("%s, retry spent. %s", head, taskStatusCmd(taskID))
}

// taskHungWake says how long the worker has been silent, so the lead can weigh a slow task against a
// stuck one before reading the digest.
func taskHungWake(taskID string, silentMin int64) string {
	return fmt.Sprintf("wake: task %s hung: silent %dm, process alive, no ask pending. %s", taskID, silentMin, taskStatusCmd(taskID))
}

// taskTurnEndedWake is for a worker idle at its prompt with its run still open: its complete may not have
// landed (an EC-TIME), or it stopped on a question asked in prose. Only its last message says which.
func taskTurnEndedWake(taskID string) string {
	return fmt.Sprintf("wake: task %s's worker ended its turn without completing and is idle; its complete may not have landed or it stopped on a question. %s", taskID, taskStatusCmd(taskID))
}

// taskTurnFailedWake is for a worker idle after its provider refused its last turn. A lapsed subscription or a model
// the account cannot run refuses a retry on the same route too, so the lead needs the provider's own words.
func taskTurnFailedWake(taskID, failure string) string {
	return fmt.Sprintf("wake: task %s's worker is idle after its last turn failed: %s. %s", taskID, strings.TrimRight(failure, ". "), taskStatusCmd(taskID))
}

// taskWorkerGoneWake is for a worker whose process is gone while its task still runs: the exit hook that would
// have failed or retried it never fired (a reboot, a lost exit event).
func taskWorkerGoneWake(taskID string) string {
	return fmt.Sprintf("wake: task %s's worker exited without reporting complete. %s", taskID, taskStatusCmd(taskID))
}

// taskNeverStartedWake names the retry, because nothing is lost: a worker with no process has written nothing.
func taskNeverStartedWake(taskID string, silentMin int64) string {
	return fmt.Sprintf("wake: task %s never started: no worker process %dm after spawn. wsh jarvis dag retry %s", taskID, silentMin, taskID)
}

// taskSuspectWake hands the lead a worker that is busy but not getting anywhere; the engine does not act on it,
// because only the lead can tell a stuck worker from a hard task.
func taskSuspectWake(taskID, reason string) string {
	return fmt.Sprintf("wake: task %s may be stuck: %s. Tell it (`wsh jarvis dag tell %s \"…\"`), retry, escalate, or let it run. %s", taskID, reason, taskID, taskStatusCmd(taskID))
}

// mergeConflictWake names the conflicted files, which the lead resolves first; git status lists them when the
// merge path could not read them.
func mergeConflictWake(taskID string, files []string) string {
	if len(files) == 0 {
		return fmt.Sprintf("wake: merge conflict landing lane ending at task %s. git status, then %s", taskID, taskStatusCmd(taskID))
	}
	return fmt.Sprintf("wake: merge conflict landing lane ending at task %s in %s. %s", taskID, strings.Join(files, ", "), taskStatusCmd(taskID))
}

// mergeFailedWake carries git's own refusal, because the fix is almost never in the lane: the squash was
// refused by the state of the tree it lands in (an untracked file in the way, a lock, a dirty index), and
// the error text is the only thing that says which.
func mergeFailedWake(taskID, errText string) string {
	// not merge.go's firstLine: that one substitutes "merge" for empty input, which would read here as
	// git having refused for a reason called "merge"
	line, _, _ := strings.Cut(strings.TrimSpace(errText), "\n")
	return fmt.Sprintf("wake: git refused the merge landing lane ending at task %s (%s). %s", taskID, line, taskStatusCmd(taskID))
}

// verifyFailedWake names the exit code or the timeout and the first line of output that names a failure, so the
// lead knows which test to read, or that it should look for a hang, before it reads the task's status.
func verifyFailedWake(taskID, reason, failure string) string {
	return fmt.Sprintf("%s. %s", withFact(fmt.Sprintf("wake: Verify failed after merging task %s (%s)", taskID, reason), failure), taskStatusCmd(taskID))
}

// landFailedWake tells the lead a merge or --continue it ran failed after its call had timed out, so the error the
// call returned reached nobody.
func landFailedWake(command, taskID string, err error) string {
	return fmt.Sprintf("%s. %s", withFact(fmt.Sprintf("wake: your `wsh jarvis %s %s` failed after the call timed out", command, taskID), err.Error()), taskStatusCmd(taskID))
}

// engineStuckWake hands the lead a wait the engine cannot end. The lead cannot end it either: only a restart
// drops the goroutine, and the dag resumes from its persisted state after one.
func engineStuckWake(what string) string {
	return fmt.Sprintf("wake: the engine is stuck: %s. It will not recover by itself: put it to the human, who can restart arcterm (the dag resumes from where it is); the server log holds a goroutine dump. wsh jarvis dag status", what)
}

// reviewFailedWake hands a task's failed review to the lead with the first line of the note, its first finding or
// why the review itself failed; the whole note is in the task's status.
func reviewFailedWake(taskID, note string) string {
	return fmt.Sprintf("%s. %s", withFact("wake: review failed for task "+taskID, note), taskStatusCmd(taskID))
}

// planReviewFindingsCmd prints a failed plan review's findings whole.
const planReviewFindingsCmd = "wsh jarvis dag planreview findings"

// planReviewFailedWake carries the round's merged findings, the lead revises the plan from them, up to
// reportSectionMaxLen: five reviewers at their note cap would fill the lead's composer, so past it the wake names
// planReviewFindingsCmd. After the last round the call is the human's, or on an autonomous run the lead's.
func planReviewFailedWake(round int, findings string, last, autonomous bool) string {
	findings = capText(findings, reportSectionMaxLen, planReviewFindingsCmd)
	switch {
	case last && autonomous:
		return fmt.Sprintf("wake: plan review failed in round %d, the last: %s. %s.", round, flatLine(findings), autonomousPastPlanReview)
	case autonomous:
		return fmt.Sprintf("wake: plan review failed in round %d: %s. Revise the plan (make any spec change yourself and record it in your report) and run `wsh jarvis dag submit` again.", round, flatLine(findings))
	case last:
		return fmt.Sprintf("wake: plan review failed in round %d, the last: %s. Put it to the human; %s.", round, flatLine(findings), proceedPastPlanReview)
	}
	return fmt.Sprintf("wake: plan review failed in round %d: %s. Revise the plan (put spec changes to the human) and run `wsh jarvis dag submit` again.", round, flatLine(findings))
}

// specPlanReviewFailedWake is the last round's failure on an asking run whose plan answers to a spec: the lead
// takes the findings that leave the spec's decisions standing, and only the rest go to the human.
func specPlanReviewFailedWake(round int, findings string) string {
	findings = capText(findings, reportSectionMaxLen, planReviewFindingsCmd)
	return fmt.Sprintf("wake: plan review failed in round %d, the last: %s. %s. When a finding does need the human, put it to them %s.", round, flatLine(findings), jarvis.SpecPastPlanReview, proceedPastPlanReview)
}

// planReviewLostWake is for a round whose required reviewer twice ended without a verdict and no reviewer failed:
// there are no findings to act on, so the same plan can be submitted again.
func planReviewLostWake(round int, reason string, last, autonomous bool) string {
	switch {
	case last && autonomous:
		return fmt.Sprintf("wake: the plan reviewer did not finish in round %d, the last (%s). %s.", round, reason, autonomousPastPlanReview)
	case last:
		return fmt.Sprintf("wake: the plan reviewer did not finish in round %d, the last (%s). Put it to the human; %s.", round, reason, proceedPastPlanReview)
	}
	return fmt.Sprintf("wake: the plan reviewer did not finish in round %d (%s). Run `wsh jarvis dag submit` again to review the plan once more.", round, reason)
}

// downstreamWake carries what a passed task's reviewer said later tasks must know. A wake is typed as one
// line, so the note is flattened.
func downstreamWake(taskID, note string) string {
	return fmt.Sprintf("wake: task %s passed review with a note for later tasks: %s. %s", taskID, flatLine(note), taskStatusCmd(taskID))
}

// downstreamMissedWake hands the lead a note the engine could not deliver to the tasks its reviewer named, with why.
func downstreamMissedWake(taskID, note string, missed []string) string {
	return fmt.Sprintf("wake: task %s passed review with a note for later tasks (not delivered to %s): %s. %s", taskID, strings.Join(missed, "; "), flatLine(note), taskStatusCmd(taskID))
}

// forLaterMissedWake hands the lead a passed worker's section for later tasks that the engine could not deliver, with why.
func forLaterMissedWake(taskID, heading, section string, missed []string) string {
	return fmt.Sprintf("wake: task %s passed review; its worker's %s (not delivered to %s): %s. %s", taskID, heading, strings.Join(missed, "; "), flatLine(section), taskStatusCmd(taskID))
}

// flatLine joins a note onto one line, since a wake or quiet line is typed as one.
func flatLine(s string) string {
	return strings.Join(strings.Fields(s), " ")
}

// noCommitLine tells the lead a worker finished with nothing for review to judge: it did nothing, or it committed and
// never passed the commit to `wsh jarvis complete`. Either way the task reads as done.
// forLead adds its For later tasks: with no unfinished task after it nothing reads the section at dispatch, so it
// is the lead's, as a passed review's is.
func noCommitLine(taskID string, run *waveobj.Run, forLead bool) string {
	line := taskID + " finished without reporting a commit"
	lines := leadSectionLines(taskID, run)
	if rep, _ := workerReportOf(run); forLead && rep.ForLater != "" {
		lines = append(lines, fmt.Sprintf("%s %s: %s", taskID, sectionHeading(jarvis.ReportKeyForLater), capSection(taskID, jarvis.ReportKeyForLater, rep.ForLater)))
	}
	// a wake line is typed as one, so the sections are flattened and joined
	var parts []string
	for _, l := range lines {
		parts = append(parts, flatLine(l))
	}
	if len(parts) > 0 {
		line += ": " + strings.Join(parts, "; ")
	}
	return line
}

// RaiseChildAsk puts a dag child's question in its lead's queue and wakes the lead. question is the
// first question's text, for the child-ask row.
//
// A held card (Hold: the Token burn card of `wsh tokengate` or `wsh council start`, memgate's) is arcterm's question
// about the person's quota, not the child's about its task: it is the human's from the start, with no lead deadline
// and no wake. Handed to the lead, it sat in `dag asks` for 10 minutes, or for good in an autonomous run, while the
// spawn behind it waited out the card's 30 minutes and was refused (two council bench runs lost, one start hung 26 min).
func RaiseChildAsk(ctx context.Context, g *waveobj.TaskGroup, target AskTarget, blockOref, question string) {
	var raised agentask.PendingAsk
	ok := agentask.GlobalRegistry.Update(blockOref, target.AskId, func(p *agentask.PendingAsk) {
		if p.Hold {
			p.Owner, p.Deadline = agentask.AskOwner_User, 0
		} else {
			p.Owner = agentask.AskOwner_Lead
			p.Deadline = wakeNow() + LeadAskDeadline.Milliseconds()
		}
		p.ChannelId, p.RunId, p.TaskId, p.DagOID = g.ChannelId, g.RunID, target.TaskId, g.OID
		raised = *p
	})
	if !ok {
		return
	}
	publishChildAsk(raised)
	RecordAskLifecycle(ctx, target, waveobj.RunEventKindChildAsk, question)
	if !raised.Hold {
		PokeWake(ctx, g.ChannelId, g.RunID)
	}
}

// expireClearsFn puts typed answers no agent confirmed back in the queue and returns them. A var so
// tests can hand the sweep a restored ask without typing into a real block.
var expireClearsFn = func(now int64) map[string]agentask.PendingAsk {
	return agentask.GlobalRegistry.ExpireClears(now, agentask.AnswerClearTimeout)
}

// publishSessionAskFn puts a session ask whose typed answer never landed back in front of the human. It
// publishes the ask event directly: jarvis.PublishAgentAsk would hand the ask to the Gatekeeper a second
// time. A var for tests.
var publishSessionAskFn = func(oref string, p agentask.PendingAsk) {
	wps.Broker.Publish(wps.WaveEvent{
		Event:   wps.Event_AgentAsk,
		Scopes:  []string{oref},
		Persist: 1,
		Data:    baseds.AgentAskData{ORef: oref, AskId: p.AskId, Questions: p.Questions, Ts: p.Ts, Prose: p.Prose, Note: p.Note, Hold: p.Hold},
	})
}

// sweepAsks moves lead-owned questions past their deadline to the human, and puts answers that never
// landed back in front of their owner.
func sweepAsks(ctx context.Context) {
	now := wakeNow()
	for oref, p := range agentask.GlobalRegistry.List() {
		if p.Owner == agentask.AskOwner_Lead && p.Deadline > 0 && now >= p.Deadline {
			if !askDagAutonomous(ctx, p) {
				forwardAskToUser(ctx, oref, p, askDeadlineNote)
				continue
			}
			// nobody is at the cockpit to take it: the lead keeps it and is told again
			agentask.GlobalRegistry.Update(oref, p.AskId, func(cur *agentask.PendingAsk) {
				cur.Deadline = now + LeadAskDeadline.Milliseconds()
			})
			publishChildAsk(p)
			reannounceAsk(p)
			PokeWake(ctx, p.ChannelId, p.RunId)
		}
	}
	for oref, p := range expireClearsFn(now) {
		if p.DagOID == "" {
			publishSessionAskFn(oref, p)
			continue
		}
		if p.Owner != agentask.AskOwner_Lead {
			forwardAskToUser(ctx, oref, p, p.Note)
			continue
		}
		// the deadline restarts: the lead answered in time, and it was the delivery that failed.
		agentask.GlobalRegistry.Update(oref, p.AskId, func(cur *agentask.PendingAsk) {
			cur.Deadline = now + LeadAskDeadline.Milliseconds()
		})
		publishChildAsk(p)
		PokeWake(ctx, p.ChannelId, p.RunId)
	}
}

// askDagAutonomous reports a dag child's question whose run is autonomous. A dag that cannot be loaded is not.
func askDagAutonomous(ctx context.Context, p agentask.PendingAsk) bool {
	if p.DagOID == "" {
		return false
	}
	g, err := wstore.GetDag(ctx, p.DagOID)
	return err == nil && g.Autonomous
}

// ForwardTask hands a task's open judgment to the human with the lead's note (`dag forward`): its
// pending question when it has one, otherwise the failure, stall or merge conflict the lead was woken
// for, which then waits on the timeline for the human.
func ForwardTask(ctx context.Context, dagID, taskID, note string) error {
	note = strings.TrimSpace(note)
	if note == "" {
		return fmt.Errorf("forward needs a note saying what the human should decide")
	}
	g, err := wstore.GetDag(ctx, dagID)
	if err != nil {
		return fmt.Errorf("loading dag: %w", err)
	}
	if g.Autonomous {
		return fmt.Errorf("run %s is autonomous and nobody is at the cockpit, so nothing is forwarded: decide task %s yourself (answer, retry, escalate, skip or send back) and record the call and why in your report", g.RunID, taskID)
	}
	task := taskByID(g, taskID)
	if task == nil {
		return fmt.Errorf("no task %q", taskID)
	}
	if oref, p, ok := taskPendingAsk(ctx, g, task); ok {
		p.ChannelId, p.RunId, p.TaskId, p.DagOID = g.ChannelId, g.RunID, task.ID, g.OID
		if !forwardAskToUser(ctx, oref, p, note) {
			return fmt.Errorf("task %s's question was answered before it could be forwarded", taskID)
		}
		return nil
	}
	switch task.State {
	case TaskState_Failed, TaskState_Stalled, TaskState_BlockedMerge, TaskState_VerifyFailed, TaskState_ReviewFailed:
		appendRunEvent(ctx, g.ChannelId, g.RunID, waveobj.RunEventKindTaskForwarded, nil, map[string]any{
			"taskid": task.ID,
			"note":   truncateText(note, MaxAskSummaryLen),
		})
		return nil
	}
	return fmt.Errorf("task %s has no question, failure, stall, merge conflict, failed Verify or failed review to forward (state %q)", taskID, task.State)
}

// TakeOverAsk hands a task's question to the human who took it from the lead in the cockpit. The lead is
// not woken: `dag asks` stops listing the question, and an answer it had already started is refused with
// TakenOverNote, so a wake would only cost it a turn. A relay of the question the lead already put to the
// human (its own ask, every header the task id) is answered, since the lead would block on it otherwise.
func TakeOverAsk(ctx context.Context, dagID, taskID string) error {
	g, err := wstore.GetDag(ctx, dagID)
	if err != nil {
		return fmt.Errorf("loading dag: %w", err)
	}
	task := taskByID(g, taskID)
	if task == nil {
		return fmt.Errorf("no task %q", taskID)
	}
	oref, p, ok := taskPendingAsk(ctx, g, task)
	if !ok {
		return fmt.Errorf("task %s has no question to take over", taskID)
	}
	if p.Owner == agentask.AskOwner_User {
		return fmt.Errorf("task %s's question is already waiting on you", taskID)
	}
	p.ChannelId, p.RunId, p.TaskId, p.DagOID = g.ChannelId, g.RunID, task.ID, g.OID
	if !moveAskToUser(ctx, oref, p, TakenOverNote, ForwardedByHuman) {
		return fmt.Errorf("task %s's question was answered before it could be taken over", taskID)
	}
	lead := leadStateFn(ctx, g.ChannelId, g.RunID)
	isRelay := func(q baseds.AgentAskQuestion) bool { return q.Header == taskID }
	// the worker's question did move, so a relay that cannot be answered is recorded, not returned
	if _, err := answerLeadQuestionWith(ctx, g.ChannelId, g.RunID, lead.BlockId, jarvis.TakenOverRelayAnswer, isRelay, nil); err != nil {
		log.Printf("orchestrate: run %s: answering the lead's relay of task %s: %v", g.RunID, taskID, err)
		appendRunEvent(ctx, g.ChannelId, g.RunID, waveobj.RunEventKindLeadWakeFailed, nil, map[string]any{
			"reason": "the lead's relay of task " + taskID + "'s question could not be answered: " + err.Error(),
			"lines":  []string{jarvis.TakenOverRelayAnswer},
		})
	}
	return nil
}

func taskPendingAsk(ctx context.Context, g *waveobj.TaskGroup, task *waveobj.TaskNode) (string, agentask.PendingAsk, bool) {
	if task.RunID == "" {
		return "", agentask.PendingAsk{}, false
	}
	child, err := wstore.GetRun(ctx, g.ChannelId, task.RunID)
	if err != nil {
		return "", agentask.PendingAsk{}, false
	}
	for _, oref := range runBlockORefs(ctx, child) {
		if p, ok := agentask.GlobalRegistry.Get(oref); ok {
			return oref, p, true
		}
	}
	return "", agentask.PendingAsk{}, false
}

// RunBlockORefs lists the worker block orefs of a run's phases, the keys the ask registry holds the
// run's questions under.
func RunBlockORefs(ctx context.Context, run *waveobj.Run) []string {
	var out []string
	seen := map[string]bool{}
	for _, p := range run.Phases {
		for _, oref := range p.WorkerOrefs {
			if !strings.HasPrefix(oref, "tab:") {
				continue
			}
			tab, terr := wstore.DBMustGet[*waveobj.Tab](ctx, strings.TrimPrefix(oref, "tab:"))
			if terr != nil || len(tab.BlockIds) == 0 {
				continue
			}
			bo := waveobj.MakeORef(waveobj.OType_Block, tab.BlockIds[0]).String()
			if !seen[bo] {
				seen[bo] = true
				out = append(out, bo)
			}
		}
	}
	return out
}
