// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path"
	"path/filepath"
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

// Plan reviewer lenses (PlanReviewer.Lens): full is today's reviewer, the next four split its checklist, and
// followup is round 2's one reviewer.
const (
	PlanReviewLens_Full     = "full"
	PlanReviewLens_Spec     = "spec"
	PlanReviewLens_Order    = "order"
	PlanReviewLens_Tests    = "tests"
	PlanReviewLens_Final    = "final"
	PlanReviewLens_Followup = "followup"
)

// Plan reviewer states (PlanReviewer.State).
const (
	PlanReviewerState_Reviewing = "reviewing"
	PlanReviewerState_Passed    = "passed"
	PlanReviewerState_Failed    = "failed"
	PlanReviewerState_Lost      = "lost" // ended twice without a verdict
)

var planReviewLensTitles = map[string]string{
	PlanReviewLens_Full:     "Full review",
	PlanReviewLens_Spec:     "Spec coverage",
	PlanReviewLens_Order:    "Task order and files",
	PlanReviewLens_Tests:    "Tests and commands",
	PlanReviewLens_Final:    "Final coverage",
	PlanReviewLens_Followup: "Round-2 follow-up",
}

// PlanReviewLensTitle is a lens's title, or the key itself for one this build does not know.
func PlanReviewLensTitle(lens string) string {
	if title, ok := planReviewLensTitles[lens]; ok {
		return title
	}
	return lens
}

// planRoundOneLenses are round 1's reviewers, in the order the merged findings list them.
var planRoundOneLenses = []string{PlanReviewLens_Full, PlanReviewLens_Spec, PlanReviewLens_Order, PlanReviewLens_Tests, PlanReviewLens_Final}

// planReviewerPicks reports the reviewer whose verdict carries the model picks and whose loss fails the round.
func planReviewerPicks(lens string) bool {
	return lens == PlanReviewLens_Full || lens == PlanReviewLens_Followup
}

// planReviewItem is one checklist item, worded as the full reviewer's prompt has it, and the lens that owns it.
type planReviewItem struct{ lens, text string }

// planReviewBoardItem applies only with a Prototype; %s is the canvas path.
const planReviewBoardItem = "every `.dc.html` board in the folder of %s has a step in a scenario Final runs that renders what the board shows; each board without one is a finding."

// planReviewSpecGap closes the checklist as a sentence of its own, not a bullet.
const planReviewSpecGap = "Also report gaps in the spec, and places where the spec and the plan contradict each other."

// planReviewChecklist is the one source of the checklist: the full prompt lists every item in this order, a lens
// prompt only its own.
var planReviewChecklist = []planReviewItem{
	{PlanReviewLens_Spec, "every requirement in the spec has a task;"},
	{PlanReviewLens_Order, "no two tasks edit the same file without a Depends between them, since tasks with nothing between them run at the same time. Submit already refused any path two such tasks both list on their Files lines, so look for what those lines leave out: a task with no Files line, and a file a task's text edits that its Files line omits;"},
	{PlanReviewLens_Order, "types, functions and flags have the same names in every task that mentions them;"},
	{PlanReviewLens_Order, "no task waits for another's long implementation when it needs only that task's interface (a type, a wire field, a table, a function's signature): the interface can land first as its own small task, so the implementation and the tasks that use it run beside each other;"},
	{PlanReviewLens_Tests, "each task states its acceptance criteria and names the tests that prove them;"},
	{PlanReviewLens_Tests, "the commands the plan names (its Verify, Setup, Check and Final lines, and those in its tasks) exist;"},
	{PlanReviewLens_Final, "the Final command checks the running app: every task that adds or changes a rendered view, a visual state (loading, empty, error, gone) or an interaction names in its acceptance the scenario step that shows that view or performs that interaction, and Final runs that scenario. A scenario that only opens the surface or panel the view sits in does not count. A check left to a person has no owner in a run, so a plan that leaves one is a finding."},
	// the final verifier judges only screenshots, so a board no scenario renders ends the run unverified
	{PlanReviewLens_Final, planReviewBoardItem},
	{PlanReviewLens_Spec, planReviewSpecGap},
}

// writeChecklist writes "Check that:" and the items keep accepts, the spec-gap sentence last.
func writeChecklist(b *strings.Builder, g *waveobj.TaskGroup, tree string, keep func(lens string) bool) {
	b.WriteString("Check that:\n")
	gap := false
	for _, it := range planReviewChecklist {
		switch {
		case !keep(it.lens):
		case it.text == planReviewSpecGap:
			gap = true
		case it.text == planReviewBoardItem:
			if g.Prototype != "" {
				fmt.Fprintf(b, "- "+planReviewBoardItem+"\n", DocPath(g, tree, g.Prototype))
			}
		default:
			b.WriteString("- " + it.text + "\n")
		}
	}
	if gap {
		b.WriteString(planReviewSpecGap + "\n")
	}
}

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
const proceedPastPlanReview = "as one ask with the header `Plan review`, the plan's absolute path as the question's first line, one line saying what you propose, then one `- ` line per finding you would accept, and the options `Accept all and proceed` and `Request changes`; the human can quote passages of the plan with a note on each, so an answer that starts with `Accept all and proceed` is an approval, and its `> ` quoted notes are applied before proceeding, while any other text is a change request; if they say to proceed, carry each finding you accept into the pending tasks it affects with `wsh jarvis dag amend <task> \"<note>\"` first, then run `wsh jarvis dag planreview accept \"<the human's reason>\"`"

// autonomousPastPlanReview is what an autonomous run's lead does after the last round instead of putting it to the
// human: the same amend-then-accept, on its own call.
const autonomousPastPlanReview = "The run is autonomous and nobody is at the cockpit, so the call is yours: carry each finding into the pending tasks it affects with `wsh jarvis dag amend <task> \"<note>\"` first, then run `wsh jarvis dag planreview accept \"autonomous run\"`, and record in your report that you proceeded and why; a finding no pending task can take is an open issue in your report"

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

// advancePlanReview keeps the round's reviewers going while the review is open. The round's first tick reads
// the docs its reviewers judge and starts them; a reviewer that could not finish twice is lost. The round
// settles once none is still reviewing.
func advancePlanReview(ctx, spawnCtx context.Context, g *waveobj.TaskGroup, owner *waveobj.Run, now int64, afterCommit *[]func()) {
	pr := g.PlanReview
	if pr == nil || pr.State != PlanReviewState_Reviewing {
		return
	}
	tree := jarvis.LandPath(owner)
	// a stage stored before reviewers existed has none either, and starts its round afresh
	if len(pr.Reviewers) == 0 {
		pr.PlanText, pr.SpecText = readPlanReviewDoc(g, tree, g.PlanPath), readPlanReviewDoc(g, tree, g.SpecPath)
		lenses := planRoundOneLenses
		if pr.Prior != nil {
			lenses = []string{PlanReviewLens_Followup}
		}
		for _, lens := range lenses {
			pr.Reviewers = append(pr.Reviewers, waveobj.PlanReviewer{Lens: lens, State: PlanReviewerState_Reviewing})
		}
	}
	for i := range pr.Reviewers {
		r := &pr.Reviewers[i]
		if r.State != PlanReviewerState_Reviewing {
			continue
		}
		session := func() (StageSession, error) { return planReviewSession(ctx, g, tree, r.Lens) }
		if reason := tendStageSession(ctx, spawnCtx, g, owner, session, &r.RunID, &r.StartedTs, &r.Respawns, now, afterCommit); reason != "" {
			r.State, r.Text = PlanReviewerState_Lost, reason
		}
	}
	settlePlanReviewRound(ctx, g, pr, afterCommit)
}

// readPlanReviewDoc is a doc's text as the round's reviewers read it, or "" with no doc. A read error leaves it
// empty: the reviewers meet the same missing file and report it.
func readPlanReviewDoc(g *waveobj.TaskGroup, tree, p string) string {
	if p == "" {
		return ""
	}
	data, err := os.ReadFile(DocPath(g, tree, p))
	if err != nil {
		log.Printf("dag %s: reading %s for the plan review: %v", g.OID, p, err)
		return ""
	}
	return string(data)
}

// planReviewSession is the session of the reviewer with lens: the full reviewer on the reviewer route, a lens and
// the follow-up on the Light reviewers route.
func planReviewSession(ctx context.Context, g *waveobj.TaskGroup, tree, lens string) (StageSession, error) {
	s := StageSession{Role: jarvis.UsageRole_PlanReviewer, Label: "plan review", Tree: tree, Lens: lens}
	if lens == PlanReviewLens_Full {
		s.Prompt = planReviewPrompt(g, tree)
		return s, nil
	}
	s.Label += ": " + PlanReviewLensTitle(lens)
	s.Route = lightReviewerRoute(g)
	if lens != PlanReviewLens_Followup {
		s.Prompt = planLensPrompt(g, tree, lens)
		return s, nil
	}
	prompt, err := planFollowupPrompt(ctx, g, tree)
	if err != nil {
		return StageSession{}, err
	}
	s.Prompt = prompt
	return s, nil
}

// writePlanReviewOpening is the opening and doc lines every plan reviewer's brief starts with. It reads the docs
// in tree, the landing tree, where a branch-landed dag committed them at submit.
func writePlanReviewOpening(b *strings.Builder, g *waveobj.TaskGroup, tree string) {
	fmt.Fprintf(b, "%s%s. Before any worker starts, judge whether the plan can be run as written.\n", planReviewerOpener, g.RunID)
	switch {
	case g.SpecPath != "":
		fmt.Fprintf(b, "Read the spec at %s, ", DocPath(g, tree, g.SpecPath))
	case g.Prototype != "":
		// a mockup-driven lead writes no spec (leadprompt.go): the canvas is the design the plan answers to
		fmt.Fprintf(b, "There is no spec file: the design canvas at %s is the spec. Read it, ", DocPath(g, tree, g.Prototype))
	default:
		b.WriteString("There is no spec file. Read ")
	}
	fmt.Fprintf(b, "the plan at %s, and the files they name.\n", DocPath(g, tree, g.PlanPath))
}

// planReviewReadOnly is the line every plan reviewer's brief ends its checks with.
const planReviewReadOnly = "Only read: never edit, stage or commit, and ask no questions, since nobody answers a reviewer.\n"

// writePlanReviewVerdict is the verdict command a brief finishes with; pickArgs is the --pick tail, "" for none.
func writePlanReviewVerdict(b *strings.Builder, pickArgs string) {
	b.WriteString("Finish with exactly one command, which ends your session:\n")
	fmt.Fprintf(b, "- `wsh jarvis dag planreview pass \"<summary>\"%s`;\n", pickArgs)
	fmt.Fprintf(b, "- `wsh jarvis dag planreview fail \"<findings: each problem, where it is, and the fix>\"%s`.\n", pickArgs)
	fmt.Fprintf(b, "Keep the text within %d characters; a longer one is refused.", MaxReviewNoteLen)
}

// planLensPrompt is a lens reviewer's brief: its own checklist items, and the verdict without picks, which are
// the full reviewer's.
func planLensPrompt(g *waveobj.TaskGroup, tree, lens string) string {
	var b strings.Builder
	writePlanReviewOpening(&b, g, tree)
	fmt.Fprintf(&b, "You are one of %d plan reviewers working at the same time. Yours is %s. ", len(planRoundOneLenses), PlanReviewLensTitle(lens))
	writeChecklist(&b, g, tree, func(l string) bool { return l == lens })
	var others []string
	for _, l := range planRoundOneLenses {
		if l != lens && l != PlanReviewLens_Full {
			others = append(others, PlanReviewLensTitle(l))
		}
	}
	fmt.Fprintf(&b, "Report only problems in your area; the full reviewer and the other lens reviewers cover %s. A plan with no problem in your area passes.\n", joinAnd(others))
	b.WriteString(planReviewReadOnly)
	writePlanReviewVerdict(&b, "")
	return b.String()
}

// planReviewPrompt is the full plan reviewer's brief: the whole checklist, and the model picks on a Reviewer
// picks run.
func planReviewPrompt(g *waveobj.TaskGroup, tree string) string {
	var b strings.Builder
	writePlanReviewOpening(&b, g, tree)
	writeChecklist(&b, g, tree, func(string) bool { return true })
	b.WriteString(planReviewReadOnly)
	writePlanReviewVerdict(&b, writePlanReviewPicks(&b, g, nil))
	return b.String()
}

// writePlanReviewPicks writes the pick block on a Reviewer picks run and returns the verdict's --pick tail. With
// prior, round 1's pick is listed beside each task it picked.
func writePlanReviewPicks(b *strings.Builder, g *waveobj.TaskGroup, prior []waveobj.PlanReviewPriorPick) string {
	pickFor := pickableTasks(g)
	if len(pickFor) == 0 {
		return ""
	}
	pickArgs := ""
	b.WriteString("Whatever your verdict, also pick the model for each task the plan gives no Model line:\n")
	for _, t := range pickFor {
		fmt.Fprintf(b, "- %s: %s%s\n", t.ID, flatLine(t.Label), priorPickNote(prior, t))
		pickArgs += fmt.Sprintf(" --pick \"%s=<sonnet|lead>: <one-line reason>\"", t.ID)
	}
	if prior != nil {
		b.WriteString("Beside a task is round 1's pick for it: keep it unless the diff changed that task; a task round 1 did not pick needs a fresh pick.\n")
	}
	b.WriteString("Pick `sonnet` only for a mechanical, tightly specified task (a copy of an existing pattern, a field threaded through, prose against written code); pick `lead` for anything with a design choice. Give one line on why.\n")
	b.WriteString("A pass needs a pick for every listed task. A fail takes the ones you can judge: they hold if the human proceeds on the plan as it stands.\n")
	return pickArgs
}

// priorPickNote is round 1's pick for t's id, naming round 1's task when the lead retitled it, or "".
func priorPickNote(prior []waveobj.PlanReviewPriorPick, t *waveobj.TaskNode) string {
	for _, p := range prior {
		if p.TaskId != t.ID {
			continue
		}
		if flatLine(p.Title) != flatLine(t.Label) {
			return fmt.Sprintf(" (round 1 picked %s for %q: %s)", p.Model, flatLine(p.Title), p.Reason)
		}
		return fmt.Sprintf(" (round 1 picked %s: %s)", p.Model, p.Reason)
	}
	return ""
}

// planFollowupPrompt is round 2's one reviewer's brief: confirm round 1's findings against the lead's changes,
// and check only the changed lines against the whole checklist.
func planFollowupPrompt(ctx context.Context, g *waveobj.TaskGroup, tree string) (string, error) {
	pr := g.PlanReview
	prior := pr.Prior
	if prior == nil {
		prior = &waveobj.PlanReviewPrior{}
	}
	planDiff, err := docDiff(ctx, prior.PlanText, pr.PlanText, path.Base(filepath.ToSlash(g.PlanPath)))
	if err != nil {
		return "", fmt.Errorf("diffing the plan: %w", err)
	}
	specDiff, err := docDiff(ctx, prior.SpecText, pr.SpecText, specDiffName(g))
	if err != nil {
		return "", fmt.Errorf("diffing the spec: %w", err)
	}
	var b strings.Builder
	writePlanReviewOpening(&b, g, tree)
	if findings := strings.TrimSpace(prior.Findings); findings != "" {
		fmt.Fprintf(&b, "This is round %d. Round 1 failed with these findings, and the lead revised the plan to answer them:\n\n%s\n\n", pr.Round, findings)
	} else {
		fmt.Fprintf(&b, "This is round %d. Round 1 failed, and the lead revised the plan; round 1's findings were not kept, so there are none to confirm.\n\n", pr.Round)
	}
	writeDocDiff(&b, "plan", planDiff)
	writeDocDiff(&b, "spec", specDiff)
	b.WriteString("Do two things, and do not re-review text the diffs leave unchanged:\n")
	b.WriteString("1. For each round-1 finding, confirm the revised plan fixes it, or explicitly and soundly declines it. A finding that is neither is a finding again.\n")
	b.WriteString("2. Check only the changed lines against the round-1 checklist, and report any problem they introduce or still carry. ")
	writeChecklist(&b, g, tree, func(string) bool { return true })
	b.WriteString(planReviewReadOnly)
	pickArgs := writePlanReviewPicks(&b, g, prior.Picks)
	b.WriteString("Write the verdict's text as one line per round-1 finding (fixed, declined or not fixed, and why), then any new findings: each problem, where it is, and the fix.\n")
	writePlanReviewVerdict(&b, pickArgs)
	return b.String(), nil
}

// specDiffName names the spec in its diff; a round 2 with no spec file may still drop round 1's.
func specDiffName(g *waveobj.TaskGroup) string {
	if g.SpecPath == "" {
		return "spec.md"
	}
	return path.Base(filepath.ToSlash(g.SpecPath))
}

// writeDocDiff writes a doc's changes since round 1 as a diff block, or that it did not change.
func writeDocDiff(b *strings.Builder, doc, diff string) {
	if diff == "" {
		fmt.Fprintf(b, "The %s did not change.\n\n", doc)
		return
	}
	fmt.Fprintf(b, "The lead's changes to the %s since round 1, as a diff:\n\n```diff\n%s\n```\n\n", doc, strings.TrimRight(diff, "\n"))
}

// docDiff is the unified diff from oldText to newText, as round1/<name> and round2/<name>, or "" when they match.
// git is the engine's existing dependency, and --no-index diffs two files outside any repo.
func docDiff(ctx context.Context, oldText, newText, name string) (string, error) {
	if oldText == newText {
		return "", nil
	}
	dir, err := os.MkdirTemp("", "arc-plandiff-")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(dir)
	for round, text := range map[string]string{"round1": oldText, "round2": newText} {
		if err := os.MkdirAll(filepath.Join(dir, round), 0o755); err != nil {
			return "", err
		}
		if err := os.WriteFile(filepath.Join(dir, round, name), []byte(text), 0o644); err != nil {
			return "", err
		}
	}
	// relative paths keep the temp dir out of the headers
	cmd := exec.CommandContext(ctx, "git", "diff", "--no-index", "--no-color", "--no-ext-diff", "round1/"+name, "round2/"+name)
	cmd.Dir, cmd.WaitDelay = dir, gitWaitDelay
	var stdout, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	err = cmd.Run()
	var exit *exec.ExitError
	switch {
	case err == nil:
		return "", nil
	case errors.As(err, &exit) && exit.ExitCode() == 1:
		out := strings.ReplaceAll(stdout.String(), filepath.ToSlash(dir)+"/", "")
		return strings.ReplaceAll(out, dir+string(filepath.Separator), ""), nil
	}
	return "", fmt.Errorf("git diff --no-index: %w: %s", err, strings.TrimSpace(stderr.String()))
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

// validatePicks refuses picks that are not sound, naming the task and the problem so the reviewer can resend. A
// pass needs exactly one per pickable task (complete); a fail may leave tasks out, and those stay on the lead.
func validatePicks(g *waveobj.TaskGroup, picks []wshrpc.DagModelPick, complete bool) error {
	if !g.ReviewerPicks {
		if len(picks) > 0 {
			return fmt.Errorf("run %s is not on Reviewer picks; send the verdict without --pick", g.RunID)
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
		if complete && !seen[id] {
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

// RecordPlanReviewVerdict records one reviewer's verdict, and settles the round when it was the last one out. It
// does not schedule: the caller does, off the reviewer's RPC. On a Reviewer picks run the full reviewer's pass
// carries a model pick per task without a Model line, applied in the same write, so no worker starts without its
// pick. A fail's picks are applied too: every task waits while the review holds, a resubmit replaces the tasks and
// so drops them, and an accept dispatches on them instead of putting every worker on the lead's model.
func RecordPlanReviewVerdict(ctx context.Context, dagID, reviewerRunID, verdict, text string, picks []wshrpc.DagModelPick) error {
	text = strings.TrimSpace(text)
	switch {
	case verdict != ReviewVerdict_Pass && verdict != ReviewVerdict_Fail:
		return fmt.Errorf("verdict must be %s or %s, got %q", ReviewVerdict_Pass, ReviewVerdict_Fail, verdict)
	case text == "":
		return fmt.Errorf("a %s verdict needs its text: the summary for a pass, the findings for a fail", verdict)
	}
	// refused rather than clipped: the lead revises the plan from these findings
	if count := utf8.RuneCountInString(text); count > MaxReviewNoteLen {
		return fmt.Errorf("the text is %d characters; the limit is %d. Shorten it and send the verdict again", count, MaxReviewNoteLen)
	}
	return mutatePlanReview(ctx, dagID, func(g *waveobj.TaskGroup, pr *waveobj.PlanReviewStage, afterCommit *[]func()) error {
		r := reviewingReviewer(pr, reviewerRunID)
		if r == nil {
			return fmt.Errorf("run %s is not reviewing this dag's plan", reviewerRunID)
		}
		if !planReviewerPicks(r.Lens) {
			if len(picks) > 0 {
				return fmt.Errorf("only the full reviewer picks models; send the verdict without --pick")
			}
		} else if err := validatePicks(g, picks, verdict == ReviewVerdict_Pass); err != nil {
			return err
		}
		// its session ends with this verdict, but its process stays at the prompt: the watchdog closes it
		channelID := g.ChannelId
		*afterCommit = append(*afterCommit, func() { queueFinishedSession(channelID, reviewerRunID) })
		applyPicks(g, picks)
		r.State, r.Text = PlanReviewerState_Failed, text
		if verdict == ReviewVerdict_Pass {
			r.State = PlanReviewerState_Passed
		}
		settlePlanReviewRound(ctx, g, pr, afterCommit)
		return nil
	})
}

// reviewingReviewer is the round's reviewer with runID that has no verdict yet, or nil.
func reviewingReviewer(pr *waveobj.PlanReviewStage, runID string) *waveobj.PlanReviewer {
	if pr.State != PlanReviewState_Reviewing || runID == "" {
		return nil
	}
	for i := range pr.Reviewers {
		if r := &pr.Reviewers[i]; r.RunID == runID && r.State == PlanReviewerState_Reviewing {
			return r
		}
	}
	return nil
}

// settlePlanReviewRound ends the round once no reviewer is still reviewing; it is the only place a round ends, so
// the round's event, wake and handoff go out once. The round passes when the reviewer that picks passed and every
// other passed or was lost: the full reviewer covers a lost lens's area. Otherwise it fails with the attributed
// findings of every reviewer, whole, for the lead to revise from.
func settlePlanReviewRound(ctx context.Context, g *waveobj.TaskGroup, pr *waveobj.PlanReviewStage, afterCommit *[]func()) {
	if pr.State != PlanReviewState_Reviewing || len(pr.Reviewers) == 0 {
		return
	}
	var required *waveobj.PlanReviewer
	failed := false
	reviewers := make([]map[string]any, 0, len(pr.Reviewers))
	for i := range pr.Reviewers {
		r := &pr.Reviewers[i]
		switch {
		case r.State == PlanReviewerState_Reviewing:
			return
		case planReviewerPicks(r.Lens):
			required = r
		}
		failed = failed || r.State == PlanReviewerState_Failed
		reviewers = append(reviewers, map[string]any{"lens": r.Lens, "state": r.State, "text": r.Text})
	}
	passed := required != nil && required.State == PlanReviewerState_Passed && !failed
	pr.State, pr.Findings = PlanReviewState_Failed, mergedPlanReviewFindings(pr.Reviewers)
	if passed {
		pr.State, pr.Findings = PlanReviewState_Passed, passedPlanReviewSummary(required, pr.Reviewers)
		pr.PlanText, pr.SpecText, pr.Prior = "", "", nil
	}
	detail := map[string]any{"state": pr.State, "round": pr.Round, "findings": pr.Findings, "reviewers": reviewers}
	if picks := reviewerPicks(g); len(picks) > 0 {
		detail["picks"] = picks
	}
	round, findings, last := pr.Round, pr.Findings, pr.Round >= MaxPlanReviewRounds
	*afterCommit = append(*afterCommit, func() {
		appendRunEvent(ctx, g.ChannelId, g.RunID, waveobj.RunEventKindPlanReviewed, nil, detail)
		switch {
		case passed:
			PostQuiet(ctx, g.ChannelId, g.RunID, "plan review passed; workers are starting: "+flatLine(findings))
			handOffLead(ctx, g)
		case failed:
			PostWake(ctx, g.ChannelId, g.RunID, planReviewFailedWake(round, findings, last, g.Autonomous))
		default:
			// no reviewer failed, so only the required one was lost: there are no findings, and the same plan goes again
			why := ""
			if required != nil {
				why = required.Text
			}
			PostWake(ctx, g.ChannelId, g.RunID, planReviewLostWake(round, why, last, g.Autonomous))
		}
	})
}

// passedPlanReviewSummary is a passed round's text: the required reviewer's summary, and each lens that did not
// finish.
func passedPlanReviewSummary(required *waveobj.PlanReviewer, reviewers []waveobj.PlanReviewer) string {
	lines := []string{required.Text}
	for _, r := range reviewers {
		if r.State == PlanReviewerState_Lost {
			lines = append(lines, fmt.Sprintf("Did not finish: %s (%s).", PlanReviewLensTitle(r.Lens), r.Text))
		}
	}
	return strings.Join(lines, "\n")
}

// mergedPlanReviewFindings is a failed round's text: each failing reviewer's findings as a block attributed to its
// title, then a block naming the required reviewer if it was lost, the reviewers that passed, and the lenses that
// did not finish. Nothing is clipped or merged across reviewers: the lead dedups.
func mergedPlanReviewFindings(reviewers []waveobj.PlanReviewer) string {
	var blocks, tail, passed, lost []string
	for _, r := range reviewers {
		title := PlanReviewLensTitle(r.Lens)
		switch r.State {
		case PlanReviewerState_Failed:
			blocks = append(blocks, fmt.Sprintf("[%s] %s", title, r.Text))
		case PlanReviewerState_Passed:
			passed = append(passed, title)
		case PlanReviewerState_Lost:
			if planReviewerPicks(r.Lens) {
				tail = append(tail, fmt.Sprintf("[%s] did not finish: %s", title, r.Text))
			} else {
				lost = append(lost, fmt.Sprintf("Did not finish: %s (%s).", title, r.Text))
			}
		}
	}
	if len(passed) > 0 {
		tail = append(tail, "Passed: "+strings.Join(passed, ", ")+".")
	}
	tail = append(tail, lost...)
	if len(tail) > 0 {
		blocks = append(blocks, strings.Join(tail, "\n"))
	}
	return strings.Join(blocks, "\n\n")
}

// reviewerPicks are the models the plan reviewer set, read off the tasks, for the round's event.
func reviewerPicks(g *waveobj.TaskGroup) []wshrpc.DagModelPick {
	var out []wshrpc.DagModelPick
	for i := range g.Tasks {
		t := &g.Tasks[i]
		if t.ModelSource != waveobj.TaskModelSource_Reviewer {
			continue
		}
		model := PickModel_Lead
		if t.RunSpec.Runtime == LightPickRoute.Runtime && t.RunSpec.Model == LightPickRoute.Model {
			model = PickModel_Sonnet
		}
		out = append(out, wshrpc.DagModelPick{TaskId: t.ID, Model: model, Reason: t.PickReason})
	}
	return out
}

// postHandoffFn is PostHandoff, a var so tests can see which plan reviews hand the lead its compaction.
var postHandoffFn = PostHandoff

// SetPostHandoffForTest stubs the plan review's lead handoff for tests in other packages.
func SetPostHandoffForTest(fn func(ctx context.Context, channelId, runId string)) (restore func()) {
	old := postHandoffFn
	postHandoffFn = fn
	return func() { postHandoffFn = old }
}

// LeadWorkerORef is the tab oref of the worker driving the run's running phase, or "" when there is none.
// An orchestrator run has exactly one phase, so this is the lead. Empty is a normal answer (the lead
// exited, or the run is deferred).
func LeadWorkerORef(run *waveobj.Run) string {
	for i := range run.Phases {
		p := &run.Phases[i]
		if p.State == jarvis.PhaseState_Running && len(p.WorkerOrefs) > 0 {
			return p.WorkerOrefs[0]
		}
	}
	return ""
}

// handOffLead hands the dag's lead its compaction once the plan review cleared the plan. A run with no lead
// worker, a human-planned one, has nobody to compact, and a handoff queued for it would launch a lead.
func handOffLead(ctx context.Context, g *waveobj.TaskGroup) {
	owner, err := wstore.GetRun(ctx, g.ChannelId, g.RunID)
	if err != nil {
		log.Printf("dag %s: handoff after plan review: loading run %s: %v", g.OID, g.RunID, err)
		return
	}
	if LeadWorkerORef(owner) != "" {
		postHandoffFn(ctx, g.ChannelId, owner.ID)
	}
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
		// the docs serve only a next round, which an accept rules out
		pr.PlanText, pr.SpecText, pr.Prior = "", "", nil
		round := pr.Round
		*afterCommit = append(*afterCommit, func() {
			appendRunEvent(ctx, g.ChannelId, g.RunID, waveobj.RunEventKindPlanReviewed, nil, map[string]any{"state": PlanReviewState_Accepted, "round": round, "reason": reason})
			handOffLead(ctx, g)
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
		if pr.Round >= MaxPlanReviewRounds && g.Autonomous {
			return fmt.Errorf("the plan review failed %d rounds, the most it gets. %s", pr.Round, autonomousPastPlanReview)
		}
		if pr.Round >= MaxPlanReviewRounds {
			return fmt.Errorf("the plan review failed %d rounds, the most it gets; put it to the human, and %s", pr.Round, proceedPastPlanReview)
		}
		// round 2's reviewer confirms round 1's findings against the lead's changes, and sees its picks
		prior := &waveobj.PlanReviewPrior{Findings: pr.Findings, PlanText: pr.PlanText, SpecText: pr.SpecText}
		for _, p := range reviewerPicks(g) {
			prior.Picks = append(prior.Picks, waveobj.PlanReviewPriorPick{TaskId: p.TaskId, Title: taskByID(g, p.TaskId).Label, Model: p.Model, Reason: p.Reason})
		}
		// the group keeps its workers setting and reviewer routes: the run sheet edits them on the group only, and the
		// proposal carries the run's launch snapshot
		g.Title, g.Parallelism, g.Tasks = proposed.Title, proposed.Parallelism, proposed.Tasks
		// the base was checked with the old commands; nothing has started, so the next tick checks it again
		if proposed.Check != g.Check || proposed.Setup != g.Setup {
			g.BaseCheck = nil
		}
		g.Verify, g.Setup, g.Check, g.Preamble = proposed.Verify, proposed.Setup, proposed.Check, proposed.Preamble
		g.FinalCmd, g.Prototype = proposed.FinalCmd, proposed.Prototype
		g.EffortOID, g.PlanPath, g.SpecPath = proposed.EffortOID, proposed.PlanPath, proposed.SpecPath
		g.PlanReview = &waveobj.PlanReviewStage{State: PlanReviewState_Reviewing, Round: pr.Round + 1, Prior: prior}
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
