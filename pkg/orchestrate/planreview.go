// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wcore"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// Plan review states (TaskGroup.PlanReview.State).
const (
	PlanReviewState_Reviewing = "reviewing"
	PlanReviewState_Passed    = "passed"
	PlanReviewState_Failed    = "failed"
	PlanReviewState_Accepted  = "accepted" // failed, and the lead proceeded on the human's word
)

// The plan reviewer's model picks (DagModelPick.Model) on a Reviewer picks run: sonnet puts a task on
// LightPickRoute, lead leaves it on the lead's route.
const (
	PickModel_Sonnet = "sonnet"
	PickModel_Lead   = "lead"
)

// MaxPickReasonLen caps a pick's reason, the one line the panel shows beside the task.
const MaxPickReasonLen = 200

// MaxPlanReviewRounds is how many reviews a plan gets before the lead must put it to the human: the first, and
// one after the lead revised it.
const MaxPlanReviewRounds = 2

// proceedPastPlanReview is what the lead does when the human says to go on after the last round. Every task waits
// while the review holds, so an amend made before accept reaches them all; after it, accept may already have
// spawned the task (run 6c7652be).
const proceedPastPlanReview = "as one ask with the header `Plan review`, the plan's absolute path as the question's first line, one line saying what you propose, then one `- ` line per finding you would accept, and the options `Accept all and proceed` and `Request changes`; if they say to proceed, carry each finding you accept into the pending tasks it affects with `wsh jarvis dag amend <task> \"<note>\"` first, then run `wsh jarvis dag planreview accept \"<the human's reason>\"`"

// NewPlanReview is the review a plan-file submit starts with.
func NewPlanReview() *waveobj.PlanReviewStage {
	return &waveobj.PlanReviewStage{State: PlanReviewState_Reviewing, Round: 1}
}

// planReviewHolds reports a plan the engine has not cleared yet. Workers would build on a plan whose gaps a
// reviewer is about to report, so nothing dispatches until the review passed or the lead accepted it.
func planReviewHolds(g *waveobj.TaskGroup) bool {
	pr := g.PlanReview
	return pr != nil && pr.State != PlanReviewState_Passed && pr.State != PlanReviewState_Accepted
}

// advancePlanReview keeps the plan reviewer going while the review is open. A reviewer that could not
// finish twice fails the review for the lead, like a failed verdict.
func advancePlanReview(ctx, spawnCtx context.Context, g *waveobj.TaskGroup, owner *waveobj.Run, now int64, afterCommit *[]func()) {
	pr := g.PlanReview
	if pr == nil || pr.State != PlanReviewState_Reviewing {
		return
	}
	tree := jarvis.LandPath(owner)
	session := func() StageSession {
		return StageSession{Role: jarvis.UsageRole_PlanReviewer, Label: "plan review", Tree: tree, Prompt: planReviewPrompt(g, tree)}
	}
	reason := tendStageSession(ctx, spawnCtx, g, owner, session, &pr.RunID, &pr.StartedTs, &pr.Respawns, now, afterCommit)
	if reason == "" {
		return
	}
	pr.State, pr.Findings = PlanReviewState_Failed, "the plan reviewer did not finish: "+reason
	round, findings, last := pr.Round, pr.Findings, pr.Round >= MaxPlanReviewRounds
	*afterCommit = append(*afterCommit, func() {
		appendRunEvent(ctx, g.ChannelId, g.RunID, waveobj.RunEventKindPlanReviewed, nil, map[string]any{"state": PlanReviewState_Failed, "round": round, "findings": findings})
		PostWake(ctx, g.ChannelId, g.RunID, planReviewLostWake(round, reason, last))
	})
}

// planReviewPrompt is the plan reviewer's brief. It reads the docs in tree, the landing tree, where a
// branch-landed dag committed them at submit.
func planReviewPrompt(g *waveobj.TaskGroup, tree string) string {
	var b strings.Builder
	fmt.Fprintf(&b, "%s%s. Before any worker starts, judge whether the plan can be run as written.\n", planReviewerOpener, g.RunID)
	switch {
	case g.SpecPath != "":
		fmt.Fprintf(&b, "Read the spec at %s, ", DocPath(g, tree, g.SpecPath))
	case g.Prototype != "":
		// a mockup-driven lead writes no spec (leadprompt.go): the canvas is the design the plan answers to
		fmt.Fprintf(&b, "There is no spec file: the design canvas at %s is the spec. Read it, ", DocPath(g, tree, g.Prototype))
	default:
		b.WriteString("There is no spec file. Read ")
	}
	fmt.Fprintf(&b, "the plan at %s, and the files they name.\n", DocPath(g, tree, g.PlanPath))
	b.WriteString("Check that:\n")
	b.WriteString("- every requirement in the spec has a task;\n")
	b.WriteString("- no two tasks edit the same file without a Depends between them, since tasks with nothing between them run at the same time;\n")
	b.WriteString("- types, functions and flags have the same names in every task that mentions them;\n")
	b.WriteString("- each task states its acceptance criteria and names the tests that prove them;\n")
	b.WriteString("- the commands the plan names (its Verify, Setup, Check and Final lines, and those in its tasks) exist;\n")
	b.WriteString("- the Final command checks the running app: every task that adds or changes a rendered view, a visual state (loading, empty, error, gone) or an interaction names in its acceptance the scenario step that shows that view or performs that interaction, and Final runs that scenario. A scenario that only opens the surface or panel the view sits in does not count. A check left to a person has no owner in a run, so a plan that leaves one is a finding.\n")
	if g.Prototype != "" {
		// the final verifier judges only screenshots, so a board no scenario renders ends the run unverified
		fmt.Fprintf(&b, "- every `.dc.html` board in the folder of %s has a step in a scenario Final runs that renders what the board shows; each board without one is a finding.\n", DocPath(g, tree, g.Prototype))
	}
	b.WriteString("Also report gaps in the spec, and places where the spec and the plan contradict each other.\n")
	b.WriteString("Only read: never edit, stage or commit, and ask no questions, since nobody answers a reviewer.\n")
	pickFor := pickableTasks(g)
	pickArgs := ""
	if len(pickFor) > 0 {
		b.WriteString("On a pass, also pick the model for each task the plan gives no Model line:\n")
		for _, t := range pickFor {
			fmt.Fprintf(&b, "- %s: %s\n", t.ID, flatLine(t.Label))
			pickArgs += fmt.Sprintf(" --pick \"%s=<sonnet|lead>: <one-line reason>\"", t.ID)
		}
		b.WriteString("Pick `sonnet` only for a mechanical, tightly specified task (a copy of an existing pattern, a field threaded through, prose against written code); pick `lead` for anything with a design choice. Give one line on why.\n")
	}
	b.WriteString("Finish with exactly one command, which ends your session:\n")
	fmt.Fprintf(&b, "- `wsh jarvis dag planreview pass \"<summary>\"%s`;\n", pickArgs)
	b.WriteString("- `wsh jarvis dag planreview fail \"<findings: each problem, where it is, and the fix>\"`.\n")
	fmt.Fprintf(&b, "Keep the text within %d characters; a longer one is refused.", MaxReviewNoteLen)
	return b.String()
}

// pickableTasks are the tasks the plan reviewer picks a model for: none off Reviewer picks, and never one the
// plan pinned with a Model line.
func pickableTasks(g *waveobj.TaskGroup) []*waveobj.TaskNode {
	if !g.ReviewerPicks {
		return nil
	}
	var out []*waveobj.TaskNode
	for i := range g.Tasks {
		if g.Tasks[i].ModelSource != waveobj.TaskModelSource_Plan {
			out = append(out, &g.Tasks[i])
		}
	}
	return out
}

// validatePicks refuses a pass's picks that do not give exactly one sound pick per pickable task, naming the task
// and the problem so the reviewer can resend.
func validatePicks(g *waveobj.TaskGroup, picks []wshrpc.DagModelPick) error {
	if !g.ReviewerPicks {
		if len(picks) > 0 {
			return fmt.Errorf("run %s is not on Reviewer picks; send the pass without --pick", g.RunID)
		}
		return nil
	}
	want := map[string]bool{}
	var ids []string
	for _, t := range pickableTasks(g) {
		want[t.ID] = true
		ids = append(ids, t.ID)
	}
	seen := map[string]bool{}
	sonnetChecked := false
	for _, p := range picks {
		task := taskByID(g, p.TaskId)
		switch {
		case task == nil:
			return fmt.Errorf("--pick names %q, which is no task in this dag; pick for %s", p.TaskId, strings.Join(ids, ", "))
		case !want[p.TaskId]:
			return fmt.Errorf("%s has a Model line in the plan; send no --pick for it", p.TaskId)
		case seen[p.TaskId]:
			return fmt.Errorf("%s is picked twice; send one --pick per task", p.TaskId)
		case p.Model != PickModel_Sonnet && p.Model != PickModel_Lead:
			return fmt.Errorf("%s: the model must be %s or %s, got %q", p.TaskId, PickModel_Sonnet, PickModel_Lead, p.Model)
		}
		seen[p.TaskId] = true
		reason := strings.TrimSpace(p.Reason)
		switch {
		case reason == "":
			return fmt.Errorf("%s: the pick needs a one-line reason", p.TaskId)
		case strings.ContainsAny(reason, "\r\n"):
			return fmt.Errorf("%s: the reason must be one line", p.TaskId)
		case utf8.RuneCountInString(reason) > MaxPickReasonLen:
			return fmt.Errorf("%s: the reason is %d characters; the limit is %d", p.TaskId, utf8.RuneCountInString(reason), MaxPickReasonLen)
		}
		if p.Model == PickModel_Sonnet && !sonnetChecked {
			if err := validateWorkerHarness(LightPickRoute.Runtime); err != nil {
				return fmt.Errorf("%s: sonnet cannot run a worker on this machine (%v); pick lead", p.TaskId, err)
			}
			sonnetChecked = true
		}
	}
	var missing []string
	for _, id := range ids {
		if !seen[id] {
			missing = append(missing, id)
		}
	}
	if len(missing) > 0 {
		return fmt.Errorf("no pick for %s; send one --pick per task without a Model line", strings.Join(missing, ", "))
	}
	return nil
}

// applyPicks sets each picked task's route; validatePicks passed them.
func applyPicks(g *waveobj.TaskGroup, picks []wshrpc.DagModelPick) []wshrpc.DagModelPick {
	applied := make([]wshrpc.DagModelPick, 0, len(picks))
	for _, p := range picks {
		task := taskByID(g, p.TaskId)
		task.RunSpec.Runtime, task.RunSpec.Model = "", ""
		if p.Model == PickModel_Sonnet {
			task.RunSpec.Runtime, task.RunSpec.Model = LightPickRoute.Runtime, LightPickRoute.Model
		}
		task.ModelSource, task.PickReason = waveobj.TaskModelSource_Reviewer, strings.TrimSpace(p.Reason)
		applied = append(applied, wshrpc.DagModelPick{TaskId: p.TaskId, Model: p.Model, Reason: task.PickReason})
	}
	return applied
}

// RecordPlanReviewVerdict applies the plan reviewer's verdict. A pass lets dispatch start; a fail goes to the
// lead with the findings whole, since it has to revise the plan from them. It does not schedule: the caller
// does, off the reviewer's RPC. On a Reviewer picks run a pass carries a model pick per task without a Model
// line, applied in the same write that passes the review, so no worker starts without its pick.
func RecordPlanReviewVerdict(ctx context.Context, dagID, reviewerRunID, verdict, text string, picks []wshrpc.DagModelPick) error {
	text = strings.TrimSpace(text)
	switch {
	case verdict != ReviewVerdict_Pass && verdict != ReviewVerdict_Fail:
		return fmt.Errorf("verdict must be %s or %s, got %q", ReviewVerdict_Pass, ReviewVerdict_Fail, verdict)
	case text == "":
		return fmt.Errorf("a %s verdict needs its text: the summary for a pass, the findings for a fail", verdict)
	case verdict == ReviewVerdict_Fail && len(picks) > 0:
		return fmt.Errorf("--pick goes with a pass only; send the fail without it")
	}
	// refused rather than clipped: the lead revises the plan from these findings
	if count := utf8.RuneCountInString(text); count > MaxReviewNoteLen {
		return fmt.Errorf("the text is %d characters; the limit is %d. Shorten it and send the verdict again", count, MaxReviewNoteLen)
	}
	return mutatePlanReview(ctx, dagID, func(g *waveobj.TaskGroup, pr *waveobj.PlanReviewStage, afterCommit *[]func()) error {
		if pr.State != PlanReviewState_Reviewing || pr.RunID != reviewerRunID {
			return fmt.Errorf("run %s is not reviewing this dag's plan", reviewerRunID)
		}
		if verdict == ReviewVerdict_Pass {
			if err := validatePicks(g, picks); err != nil {
				return err
			}
		}
		pr.Findings = text
		round, last := pr.Round, pr.Round >= MaxPlanReviewRounds
		if verdict == ReviewVerdict_Pass {
			pr.State = PlanReviewState_Passed
			detail := map[string]any{"state": PlanReviewState_Passed, "round": round, "findings": text}
			if len(picks) > 0 {
				detail["picks"] = applyPicks(g, picks)
			}
			*afterCommit = append(*afterCommit, func() {
				appendRunEvent(ctx, g.ChannelId, g.RunID, waveobj.RunEventKindPlanReviewed, nil, detail)
				PostQuiet(ctx, g.ChannelId, g.RunID, "plan review passed; workers are starting: "+flatLine(text))
			})
			return nil
		}
		pr.State = PlanReviewState_Failed
		*afterCommit = append(*afterCommit, func() {
			appendRunEvent(ctx, g.ChannelId, g.RunID, waveobj.RunEventKindPlanReviewed, nil, map[string]any{"state": PlanReviewState_Failed, "round": round, "findings": text})
			PostWake(ctx, g.ChannelId, g.RunID, planReviewFailedWake(round, text, last))
		})
		return nil
	})
}

// AcceptPlanReview proceeds past a failed plan review on the human's word, which reason records.
func AcceptPlanReview(ctx context.Context, dagID, reason string) error {
	reason = strings.TrimSpace(reason)
	if reason == "" {
		return fmt.Errorf("accept needs the human's reason for proceeding")
	}
	return mutatePlanReview(ctx, dagID, func(g *waveobj.TaskGroup, pr *waveobj.PlanReviewStage, afterCommit *[]func()) error {
		if pr.State != PlanReviewState_Failed {
			return fmt.Errorf("the plan review is %s; accept proceeds past a failed one only", pr.State)
		}
		pr.State = PlanReviewState_Accepted
		round := pr.Round
		*afterCommit = append(*afterCommit, func() {
			appendRunEvent(ctx, g.ChannelId, g.RunID, waveobj.RunEventKindPlanReviewed, nil, map[string]any{"state": PlanReviewState_Accepted, "round": round, "reason": reason})
		})
		return nil
	})
}

// PlanReviewReplaceable reports a dag whose proposal a resubmit replaces: its plan review failed and no task
// ever dispatched, so nothing has been built on the plan being revised.
func PlanReviewReplaceable(g *waveobj.TaskGroup) bool {
	if g.PlanReview == nil || g.PlanReview.State != PlanReviewState_Failed {
		return false
	}
	for i := range g.Tasks {
		if g.Tasks[i].RunID != "" || g.Tasks[i].State != TaskState_Pending || g.Tasks[i].Attempts != 0 {
			return false
		}
	}
	return true
}

// ReplacePlanReviewProposal puts a revised plan in place of one whose review failed, and opens the next
// review round on it. The run keeps its one dag; only the proposal changes.
func ReplacePlanReviewProposal(ctx context.Context, dagID string, proposed *waveobj.TaskGroup) (*waveobj.TaskGroup, error) {
	if proposed.PlanPath == "" {
		return nil, fmt.Errorf("resubmit the revised plan as a plan file, so it is reviewed again")
	}
	var out *waveobj.TaskGroup
	err := mutatePlanReview(ctx, dagID, func(g *waveobj.TaskGroup, pr *waveobj.PlanReviewStage, _ *[]func()) error {
		if !PlanReviewReplaceable(g) {
			return fmt.Errorf("dag conflict: run %s's plan review is %s, so its dag can no longer be replaced", g.RunID, pr.State)
		}
		if pr.Round >= MaxPlanReviewRounds {
			return fmt.Errorf("the plan review failed %d rounds, the most it gets; put it to the human, and %s", pr.Round, proceedPastPlanReview)
		}
		// the group keeps its workers setting and reviewer route: the run sheet edits them on the group only, and the
		// proposal carries the run's launch snapshot
		g.Title, g.Parallelism, g.Tasks = proposed.Title, proposed.Parallelism, proposed.Tasks
		// the base was checked with the old commands; nothing has started, so the next tick checks it again
		if proposed.Check != g.Check || proposed.Setup != g.Setup {
			g.BaseCheck = nil
		}
		g.Verify, g.Setup, g.Check, g.Preamble = proposed.Verify, proposed.Setup, proposed.Check, proposed.Preamble
		g.FinalCmd, g.Prototype = proposed.FinalCmd, proposed.Prototype
		g.EffortOID, g.PlanPath, g.SpecPath = proposed.EffortOID, proposed.PlanPath, proposed.SpecPath
		g.PlanReview = &waveobj.PlanReviewStage{State: PlanReviewState_Reviewing, Round: pr.Round + 1}
		out = g
		return nil
	})
	return out, err
}

// mutatePlanReview changes a dag's plan review under the dag mutation lock, persists it, and then runs what
// fn queued for after the write.
func mutatePlanReview(ctx context.Context, dagID string, fn func(g *waveobj.TaskGroup, pr *waveobj.PlanReviewStage, afterCommit *[]func()) error) error {
	var afterCommit []func()
	err := withDagMutation(dagID, func() error {
		g, err := wstore.GetDag(ctx, dagID)
		if err != nil {
			return fmt.Errorf("loading dag: %w", err)
		}
		if g.PlanReview == nil {
			return fmt.Errorf("dag %s has no plan review", dagID)
		}
		if g.Status == DagStatus_Cancelled {
			return fmt.Errorf("dag %s is cancelled", dagID)
		}
		if err := fn(g, g.PlanReview, &afterCommit); err != nil {
			return err
		}
		RecomputeDagStatus(g)
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
	if err != nil {
		return err
	}
	for _, f := range afterCommit {
		f()
	}
	return nil
}

// planReviewOpen reports a plan review whose reviewer is still at work.
func planReviewOpen(g *waveobj.TaskGroup) bool {
	return g.PlanReview != nil && g.PlanReview.State == PlanReviewState_Reviewing
}
