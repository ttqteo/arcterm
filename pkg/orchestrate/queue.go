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
// (onlyRunFinished), so the outcome goes on the lines after it and this line stays fixed.
const runFinishedWake = "wake: run finished. wsh jarvis dag status"

// RunFinishedWake states the final stage's outcome, and every reason it could not verify something in full:
// the lead's report has to carry them.
func RunFinishedWake(f *waveobj.FinalStage) string {
	if f == nil {
		return runFinishedWake
	}
	if f.State != FinalState_Unverified {
		return runFinishedWake + "\nThe final stage " + f.State + " on the merged result."
	}
	lines := []string{runFinishedWake, "The final stage finished unverified. What it could not verify:"}
	for _, r := range f.Unverified {
		lines = append(lines, "- "+r)
	}
	return strings.Join(lines, "\n")
}

// landConflictLine goes after the run-finished wake's outcome when the land would hold on a conflict, so the lead
// fixes it before complete closes its tab. Empty when the land merges cleanly or cannot be predicted: the land
// checks again either way.
func landConflictLine(ctx context.Context, run *waveobj.Run) string {
	files, err := LandConflicts(ctx, run)
	if err != nil {
		log.Printf("run %s: %v", run.ID, err)
		return ""
	}
	if len(files) == 0 {
		return ""
	}
	return fmt.Sprintf("\nThe land into %s will conflict in %s: merge %s into this tree, resolve, commit, then complete.", run.BaseBranch, strings.Join(files, ", "), run.BaseBranch)
}

// finalFailedWake carries the final stage's failure whole: the lead writes its fix plan from it. After the
// last round the call is the human's, and the lead must say the land will hold: the land runs after complete
// closes the lead's tab, so nobody else can warn the human first (run dc7d6de0 completed held and unannounced).
func finalFailedWake(round int, runID, detail string, last bool) string {
	if last {
		return fmt.Sprintf("wake: the final stage failed on the merged result in round %d, the last. Put it to the human, and say that completing will not merge the branch: a failed final stage holds the land, and only `wsh runs land %s --force`, the human's call once the run is done, lands it:\n%s", round, runID, detail)
	}
	return fmt.Sprintf("wake: the final stage failed on the merged result in round %d. Write a fix plan and run `wsh jarvis dag submit --round --plan <fix plan>`, or put it to the human if the fix is a product call:\n%s", round, detail)
}

// taskFailedWake names the failure kind so the lead can pick retry, escalate, skip or forward before
// reading the digest. A child run that reported itself blocked carries no kind.
func taskFailedWake(taskID, kind string) string {
	if kind == "" {
		kind = FailureKindUnknown
	}
	return fmt.Sprintf("wake: task %s failed (%s), retry spent. wsh jarvis dag status", taskID, kind)
}

// taskHungWake says how long the worker has been silent, so the lead can weigh a slow task against a
// stuck one before reading the digest.
func taskHungWake(taskID string, silentMin int64) string {
	return fmt.Sprintf("wake: task %s hung: silent %dm, process alive, no ask pending. wsh jarvis dag status", taskID, silentMin)
}

// taskTurnEndedWake is for a worker idle at its prompt with its run still open: its complete may not have
// landed (an EC-TIME), or it stopped on a question asked in prose. Only its last message says which.
func taskTurnEndedWake(taskID string) string {
	return fmt.Sprintf("wake: task %s's worker ended its turn without completing and is idle; its complete may not have landed or it stopped on a question. wsh jarvis dag status", taskID)
}

// taskWorkerGoneWake is for a worker whose process is gone while its task still runs: the exit hook that would
// have failed or retried it never fired (a reboot, a lost exit event).
func taskWorkerGoneWake(taskID string) string {
	return fmt.Sprintf("wake: task %s's worker exited without reporting complete. wsh jarvis dag status", taskID)
}

// taskNeverStartedWake names the retry, because nothing is lost: a worker with no process has written nothing.
func taskNeverStartedWake(taskID string, silentMin int64) string {
	return fmt.Sprintf("wake: task %s never started: no worker process %dm after spawn. wsh jarvis dag retry %s", taskID, silentMin, taskID)
}

// taskSuspectWake hands the lead a worker that is busy but not getting anywhere; the engine does not act on it,
// because only the lead can tell a stuck worker from a hard task.
func taskSuspectWake(taskID, reason string) string {
	return fmt.Sprintf("wake: task %s may be stuck: %s. Tell it (`wsh jarvis dag tell %s \"…\"`), retry, escalate, or let it run. wsh jarvis dag status", taskID, reason, taskID)
}

func mergeConflictWake(taskID string) string {
	return fmt.Sprintf("wake: merge conflict landing lane ending at task %s. git status", taskID)
}

// mergeFailedWake carries git's own refusal, because the fix is almost never in the lane: the squash was
// refused by the state of the tree it lands in (an untracked file in the way, a lock, a dirty index), and
// the error text is the only thing that says which.
func mergeFailedWake(taskID, errText string) string {
	// not merge.go's firstLine: that one substitutes "merge" for empty input, which would read here as
	// git having refused for a reason called "merge"
	line, _, _ := strings.Cut(strings.TrimSpace(errText), "\n")
	return fmt.Sprintf("wake: git refused the merge landing lane ending at task %s (%s). wsh jarvis dag status", taskID, line)
}

// verifyFailedWake names the exit code or the timeout, so the lead knows whether to read a failing test or
// look for a hang before it reads the digest.
func verifyFailedWake(taskID, reason string) string {
	return fmt.Sprintf("wake: Verify failed after merging task %s (%s). wsh jarvis dag status", taskID, reason)
}

// engineStuckWake hands the lead a wait the engine cannot end. The lead cannot end it either: only a restart
// drops the goroutine, and the dag resumes from its persisted state after one.
func engineStuckWake(what string) string {
	return fmt.Sprintf("wake: the engine is stuck: %s. It will not recover by itself: put it to the human, who can restart arcterm (the dag resumes from where it is); the server log holds a goroutine dump. wsh jarvis dag status", what)
}

// reviewFailedWake hands a task's failed review to the lead; the findings are in its status.
func reviewFailedWake(taskID string) string {
	return fmt.Sprintf("wake: review failed for task %s. wsh jarvis dag status", taskID)
}

// planReviewFailedWake carries the plan reviewer's findings whole: the lead revises the plan from them. After
// the last round the call is the human's.
func planReviewFailedWake(round int, findings string, last bool) string {
	if last {
		return fmt.Sprintf("wake: plan review failed in round %d, the last: %s. Put it to the human; %s.", round, flatLine(findings), proceedPastPlanReview)
	}
	return fmt.Sprintf("wake: plan review failed in round %d: %s. Revise the plan (put spec changes to the human) and run `wsh jarvis dag submit` again.", round, flatLine(findings))
}

// planReviewLostWake is for a plan reviewer that twice ended without a verdict: there are no findings to act
// on, so the same plan can be submitted again.
func planReviewLostWake(round int, reason string, last bool) string {
	if last {
		return fmt.Sprintf("wake: the plan reviewer did not finish in round %d, the last (%s). Put it to the human; %s.", round, reason, proceedPastPlanReview)
	}
	return fmt.Sprintf("wake: the plan reviewer did not finish in round %d (%s). Run `wsh jarvis dag submit` again to review the plan once more.", round, reason)
}

// downstreamWake carries what a passed task's reviewer said later tasks must know. A wake is typed as one
// line, so the note is flattened.
func downstreamWake(taskID, note string) string {
	return fmt.Sprintf("wake: task %s passed review with a note for later tasks: %s. wsh jarvis dag status", taskID, flatLine(note))
}

// downstreamMissedWake hands the lead a note the engine could not deliver to the tasks its reviewer named, with why.
func downstreamMissedWake(taskID, note string, missed []string) string {
	return fmt.Sprintf("wake: task %s passed review with a note for later tasks (not delivered to %s): %s. wsh jarvis dag status", taskID, strings.Join(missed, "; "), flatLine(note))
}

// forLaterMissedWake hands the lead a passed worker's section for later tasks that the engine could not deliver, with why.
func forLaterMissedWake(taskID, heading, section string, missed []string) string {
	return fmt.Sprintf("wake: task %s passed review; its worker's %s (not delivered to %s): %s. wsh jarvis dag status", taskID, heading, strings.Join(missed, "; "), flatLine(section))
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
func RaiseChildAsk(ctx context.Context, g *waveobj.TaskGroup, target AskTarget, blockOref, question string) {
	var raised agentask.PendingAsk
	ok := agentask.GlobalRegistry.Update(blockOref, target.AskId, func(p *agentask.PendingAsk) {
		p.Owner = agentask.AskOwner_Lead
		p.Deadline = wakeNow() + LeadAskDeadline.Milliseconds()
		p.ChannelId, p.RunId, p.TaskId, p.DagOID = g.ChannelId, g.RunID, target.TaskId, g.OID
		raised = *p
	})
	if !ok {
		return
	}
	publishChildAsk(raised)
	RecordAskLifecycle(ctx, target, waveobj.RunEventKindChildAsk, question)
	PokeWake(ctx, g.ChannelId, g.RunID)
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
		Data:    baseds.AgentAskData{ORef: oref, AskId: p.AskId, Questions: p.Questions, Ts: p.Ts, Prose: p.Prose, Note: p.Note},
	})
}

// sweepAsks moves lead-owned questions past their deadline to the human, and puts answers that never
// landed back in front of their owner.
func sweepAsks(ctx context.Context) {
	now := wakeNow()
	for oref, p := range agentask.GlobalRegistry.List() {
		if p.Owner == agentask.AskOwner_Lead && p.Deadline > 0 && now >= p.Deadline {
			forwardAskToUser(ctx, oref, p, askDeadlineNote)
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
// TakenOverNote, so a wake would only cost it a turn.
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
