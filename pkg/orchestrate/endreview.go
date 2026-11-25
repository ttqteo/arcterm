// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// End review states (FinalStage.EndReview.State).
const (
	EndReviewState_Reviewing = "reviewing"
	EndReviewState_Passed    = "passed"
	EndReviewState_Failed    = "failed"
	EndReviewState_Lost      = "lost"    // lost twice: the stage settles without it
	EndReviewState_Stopped   = "stopped" // the human ended the stage while it reviewed
)

const (
	endReviewerLabel = "end reviewer"
	// endReviewDidNotFinish opens the unverified reason of a stage whose end reviewer was lost twice.
	endReviewDidNotFinish = "the end review did not finish: "
	// endReviewDetail opens a failed end review's block in the stage's Detail.
	endReviewDetail = "[End review] "
	// endReviewUnverified opens a passing end review's --unverified note among the stage's unverified reasons.
	endReviewUnverified = "end review: "
)

// startEndReview starts a fast-track stage's end review once the stage has its tree. The caller holds the dag
// mutation lock.
func startEndReview(ctx, spawnCtx context.Context, g *waveobj.TaskGroup, owner *waveobj.Run, now int64, afterCommit *[]func()) {
	f := g.Final
	if !g.FastTrack || f.Tree == "" || f.EndReview != nil {
		return
	}
	f.EndReview = &waveobj.FinalEndReview{State: EndReviewState_Reviewing}
	tendEndReview(ctx, spawnCtx, g, owner, now, afterCommit)
}

// tendEndReview keeps a reviewing end review's session going, as tendVerifier does the verifier's. Lost past its
// respawn it settles as lost, and a stage that waited on it ends. The caller holds the dag mutation lock.
func tendEndReview(ctx, spawnCtx context.Context, g *waveobj.TaskGroup, owner *waveobj.Run, now int64, afterCommit *[]func()) {
	f := g.Final
	er := f.EndReview
	if er == nil || er.State != EndReviewState_Reviewing {
		return
	}
	session := func() (StageSession, error) {
		return StageSession{Role: jarvis.UsageRole_EndReviewer, Label: endReviewerLabel, Tree: f.Tree, Prompt: endReviewPrompt(ctx, g, owner)}, nil
	}
	reason := tendStageSession(ctx, spawnCtx, g, owner, session, &er.RunID, &er.StartedTs, &er.Respawns, now, afterCommit)
	if reason == "" {
		return
	}
	er.State, er.Text = EndReviewState_Lost, reason
	recordEndReviewStep(g, false, now, afterCommit)
	if er.Waiting {
		finishAndRelease(ctx, g, owner, er.Judged, afterCommit)
	}
}

// endReviewWaiting reports whether the rest of f ended and its outcome waits on the end review.
func endReviewWaiting(f *waveobj.FinalStage) bool {
	return f.EndReview != nil && f.EndReview.Waiting
}

// awaitEndReview holds a stage whose commands and verifier are done while its end review still reviews: the
// review's verdict ends it, with judged as the rest of the stage left it. It reports whether the stage waits.
func awaitEndReview(f *waveobj.FinalStage, judged bool) bool {
	er := f.EndReview
	if er == nil || er.State != EndReviewState_Reviewing {
		return false
	}
	er.Waiting, er.Judged = true, judged
	f.State = FinalState_Verifying
	return true
}

// applyEndReview writes a settled end review onto the stage it ends: a fail's findings after any other Detail, so
// the lead's one fix round covers every failure, and a pass's note or a loss as unverified reasons.
func applyEndReview(f *waveobj.FinalStage) {
	er := f.EndReview
	if er == nil {
		return
	}
	er.Waiting, er.Judged = false, false
	switch er.State {
	case EndReviewState_Failed:
		block := endReviewDetail + er.Text
		if f.Detail == "" {
			f.Detail = block
		} else {
			f.Detail = strings.TrimRight(f.Detail, "\n") + "\n\n" + block
		}
	case EndReviewState_Passed:
		if er.Unverified != "" {
			f.Unverified = append(f.Unverified, endReviewUnverified+er.Unverified)
		}
	case EndReviewState_Lost:
		f.Unverified = append(f.Unverified, endReviewDidNotFinish+er.Text)
	}
}

// stopEndReview stops a reviewing end review of a stage the human ended. A verdict it gave already stays recorded.
func stopEndReview(ctx context.Context, g *waveobj.TaskGroup, afterCommit *[]func()) {
	er := g.Final.EndReview
	if er == nil {
		return
	}
	er.Waiting, er.Judged = false, false
	if er.State != EndReviewState_Reviewing {
		return
	}
	if er.RunID != "" {
		stopReviewer(ctx, g, er.RunID, afterCommit)
	}
	er.State = EndReviewState_Stopped
}

// recordEndReviewStep records the end review settling as the stage's review step.
func recordEndReviewStep(g *waveobj.TaskGroup, ok bool, now int64, afterCommit *[]func()) {
	channelID, runID := g.ChannelId, g.RunID
	detail := map[string]any{"round": g.Final.Round, "step": FinalStep_Review, "ms": max(now-g.Final.StartedTs, 0), "ok": ok}
	*afterCommit = append(*afterCommit, func() {
		appendRunEvent(context.Background(), channelID, runID, waveobj.RunEventKindFinalStep, nil, detail)
	})
}

// recordEndReviewVerdictLocked stores the end review's verdict, and ends a stage that waited on it. A verdict given
// while the rest still runs is kept on the stage, so a restart does not lose it. The caller holds the dag mutation
// lock and runs afterCommit after it.
func recordEndReviewVerdictLocked(ctx context.Context, g *waveobj.TaskGroup, callerRunID, verdict, text, unverified string, afterCommit *[]func()) error {
	f := g.Final
	er := f.EndReview
	if finalTerminal(f.State) || f.State == "" {
		return fmt.Errorf("run %s is not reviewing this dag's result", callerRunID)
	}
	if er.State != EndReviewState_Reviewing {
		return fmt.Errorf("run %s already gave its verdict", callerRunID)
	}
	var owner *waveobj.Run
	if er.Waiting {
		var err error
		if owner, err = wstore.GetRun(ctx, g.ChannelId, g.RunID); err != nil {
			return fmt.Errorf("loading the dag's run: %w", err)
		}
	}
	er.State, er.Text, er.Unverified = EndReviewState_Failed, text, unverified
	channelID, runID := g.ChannelId, g.RunID
	// its session ends with this verdict, but its process stays at the prompt, holding the final tree: the watchdog closes it
	*afterCommit = append(*afterCommit, func() { queueFinishedSession(channelID, callerRunID) })
	if verdict == ReviewVerdict_Pass {
		er.State = EndReviewState_Passed
		*afterCommit = append(*afterCommit, func() {
			PostQuiet(ctx, channelID, runID, "the end review passed the merged result: "+flatLine(text))
		})
	}
	recordEndReviewStep(g, verdict == ReviewVerdict_Pass, time.Now().UnixMilli(), afterCommit)
	if er.Waiting {
		return settleFinalLocked(ctx, g, owner, er.Judged, afterCommit)
	}
	return persistDag(ctx, g)
}

// endReviewPrompt is the end reviewer's brief: the run's whole change, each task with what its lane changed off its
// Files lines and what its worker reported it departed from or left unverified, and every goalpost finding.
func endReviewPrompt(ctx context.Context, g *waveobj.TaskGroup, owner *waveobj.Run) string {
	f := g.Final
	var b strings.Builder
	fmt.Fprintf(&b, "%s%s. Every task has landed, none of them reviewed on its own; review the run's whole change in this tree, %s, before the run is done.\n", endReviewerOpener, g.RunID, f.Tree)
	if g.SpecPath != "" {
		fmt.Fprintf(&b, "The spec is at %s.\n", DocPath(g, f.Tree, g.SpecPath))
	}
	if g.PlanPath != "" {
		fmt.Fprintf(&b, "The plan is at %s.\n", DocPath(g, f.Tree, g.PlanPath))
	}
	writeFixRoundTasks(&b, g)
	head := f.Commit
	if head == "" {
		head = "HEAD"
	}
	if owner.BaseCommit != "" {
		fmt.Fprintf(&b, "The run's change is `git diff %s..%s`.\n", owner.BaseCommit, head)
	}
	b.WriteString("The engine runs the plan's Check, Verify and Final itself while you work: do not run them, or any whole package or test suite. To settle a specific doubt about behavior, run one named test with `-run '^TestName$'` (or its vitest equivalent).\n")
	fmt.Fprintf(&b, "You have %s from your start to give a verdict. A session that gives none is stopped and replaced %s, and then the result is left unverified.\n", ReviewTimeout, timesWord(MaxReviewRespawns))
	b.WriteString("Look for:\n")
	b.WriteString("- real bugs;\n")
	b.WriteString("- weak or missing tests: a test that cannot fail when the behavior breaks, or a behavior no test covers;\n")
	b.WriteString("- acceptance criteria a task states that the change does not meet, or that nothing proves;\n")
	b.WriteString("- edits outside a task's files;\n")
	b.WriteString("- mismatches with the spec or the design. A difference the spec's Deviations section lists is allowed.\n")
	b.WriteString("\nThe tasks:\n")
	writeEndReviewTasks(ctx, &b, g)
	if section := endReviewGoalposts(ctx, g); section != "" {
		b.WriteString("\n")
		b.WriteString(section)
		b.WriteString("\n")
	}
	b.WriteString("\nOnly read: never edit, stage or commit, and ask no questions, since nobody answers a reviewer.\n")
	b.WriteString("Finish with exactly one command, which ends your session:\n")
	b.WriteString("- `wsh jarvis dag final pass \"<summary>\"`, adding `--unverified \"<what you could not verify, and why>\"` when something could not be checked;\n")
	b.WriteString("- `wsh jarvis dag final fail \"<findings: each problem, where it is, and the fix>\"`.\n")
	b.WriteString(unverifiedGuidance + "\n")
	fmt.Fprintf(&b, "Keep each text within %d characters; a longer one is refused.", MaxReviewNoteLen)
	return b.String()
}

// writeEndReviewTasks lists each landed task: its text, the paths its lane's merged commit changes that no Files
// line of the lane lists (on the lane's tip, which the merge is recorded on), and the worker's Differs from plan and
// Not verified sections.
func writeEndReviewTasks(ctx context.Context, b *strings.Builder, g *waveobj.TaskGroup) {
	unlisted := laneUnlistedPaths(ctx, g)
	for i := range g.Tasks {
		t := &g.Tasks[i]
		if t.State != TaskState_Done {
			continue
		}
		fmt.Fprintf(b, "\n### %s: %s\n", t.ID, t.Label)
		if t.RunSpec.Goal != "" {
			b.WriteString(t.RunSpec.Goal + "\n")
		}
		if t.Description != "" {
			b.WriteString(roundDescription(g, t.Description, g.Final.Tree) + "\n")
		}
		if section := unlistedSection(unlisted[t.ID]); section != "" {
			b.WriteString(section + "\n")
		}
		for _, line := range endReviewReportLines(ctx, g, t) {
			b.WriteString(line + "\n")
		}
	}
}

// laneUnlistedPaths is, per lane tip, what the lane's merged commit changes that the lane's Files lines don't list.
// A lane with no recorded merge commit has none.
func laneUnlistedPaths(ctx context.Context, g *waveobj.TaskGroup) map[string][]string {
	merged := mergedCommits(ctx, g)
	out := map[string][]string{}
	for _, lane := range jarvis.Lanes(g.Tasks) {
		tip := laneTip(g, lane)
		if tip == nil || merged[tip.ID] == "" {
			continue
		}
		var descs []string
		for _, id := range lane {
			if t := taskByID(g, id); t != nil {
				descs = append(descs, t.Description)
			}
		}
		sha := merged[tip.ID]
		if paths := unlistedFiles(ctx, g.Final.Tree, sha+"^", sha, strings.Join(descs, "\n")); len(paths) > 0 {
			out[tip.ID] = paths
		}
	}
	return out
}

// mergedCommits is each lane tip's latest merge commit, from its task-merged events. A failed read gives none.
func mergedCommits(ctx context.Context, g *waveobj.TaskGroup) map[string]string {
	evs, err := wstore.QueryRunEventsByKind(ctx, g.ChannelId, g.RunID, []string{waveobj.RunEventKindTaskMerged}, 0)
	if err != nil {
		log.Printf("dag %s: reading its merges for the end review: %v", g.OID, err)
		return nil
	}
	out := map[string]string{}
	// newest first: the first commit seen for a task is its latest merge
	for _, ev := range evs {
		var d struct {
			TaskId string `json:"taskid"`
			Commit string `json:"commit"`
		}
		if json.Unmarshal(ev.Detail, &d) != nil || d.Commit == "" || out[d.TaskId] != "" {
			continue
		}
		out[d.TaskId] = d.Commit
	}
	return out
}

// endReviewReportLines are the worker's Differs from plan and Not verified sections, or its unstructured report.
func endReviewReportLines(ctx context.Context, g *waveobj.TaskGroup, t *waveobj.TaskNode) []string {
	if t.RunID == "" {
		return nil
	}
	run, err := wstore.GetRun(ctx, g.ChannelId, t.RunID)
	if err != nil {
		log.Printf("dag %s: reading %s's worker run for the end review: %v", g.OID, t.ID, err)
		return nil
	}
	rep, unstructured := workerReportOf(run)
	if unstructured != "" {
		return []string{"Its worker reported: " + capSection(t.ID, "", unstructured)}
	}
	var out []string
	for _, key := range []string{jarvis.ReportKeyDiffers, jarvis.ReportKeyNotVerified} {
		if body, _ := rep.Section(key); body != "" {
			out = append(out, fmt.Sprintf("Its worker's %s: %s", sectionHeading(key), capSection(t.ID, key, body)))
		}
	}
	return out
}

// endReviewGoalposts lists every task's goalpost findings, each to be judged by name. Empty with none.
func endReviewGoalposts(ctx context.Context, g *waveobj.TaskGroup) string {
	var lines []string
	for i := range g.Tasks {
		t := &g.Tasks[i]
		if t.State != TaskState_Done {
			continue
		}
		for _, f := range distinctGoalposts(goalpostsForTask(ctx, g, t.ID)) {
			lines = append(lines, fmt.Sprintf("- %s %s", t.ID, goalpostLine(f)))
		}
	}
	if len(lines) == 0 {
		return ""
	}
	return "While they worked, the workers made edits that lower a check (found by the goalpost guard as the edits were made):\n" +
		strings.Join(lines, "\n") +
		"\nPass or fail each one by name in your verdict. Pass one when its task or the spec calls for it, when the worker's report explains it and you agree, or when the merged diff no longer shows it. Otherwise fail the review."
}
