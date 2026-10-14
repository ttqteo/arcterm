// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// landConflictLand answers a land whose merge of the base into wave/<run> conflicted in files: a resolver session in
// the landing tree, one attempt per land, else a hold that names the files for a human. A run with no dag has no
// stage to start a session in. The land driver tends the resolving land (tendResolvingLands); it does not keep the
// project's turn meanwhile.
func landConflictLand(ctx context.Context, run *waveobj.Run, g *waveobj.TaskGroup, force bool, files []string) *waveobj.RunLand {
	held := func(why string) *waveobj.RunLand {
		h := heldLand(fmt.Sprintf("merging %s into wave/%s conflicts in %s; merge it there, then Land again%s", run.BaseBranch, run.ID, strings.Join(files, ", "), why))
		h.Conflicts = files
		return h
	}
	switch {
	case g == nil:
		return held("")
	case resolverTried(run):
		return held("; a resolver already tried")
	}
	id, err := spawnStageSession(ctx, ctx, g, run, StageSession{Role: jarvis.UsageRole_LandResolver, Label: "land resolver", Tree: run.LandPath, Prompt: landResolverPrompt(run, files)})
	if err != nil {
		return held("; the resolver could not start: " + err.Error())
	}
	// where the resolver starts from: its merge is read against it when it ends, by which time the base has moved on
	// if other lands went meanwhile
	if tip, err := WorktreeHeadCommit(ctx, run.ProjectPath, run.ID); err != nil {
		log.Printf("run %s: reading the head its resolver starts from: %v", run.ID, err)
	} else if err := wstore.UpdateRun(ctx, run.ChannelOID, id, func(r *waveobj.Run) error {
		r.BaseCommit = tip
		return nil
	}); err != nil {
		log.Printf("run %s: recording the head its resolver starts from: %v", run.ID, err)
	}
	return &waveobj.RunLand{State: LandState_Resolving, Resolver: id, ResolverTs: time.Now().UnixMilli(), ResolverTried: true, Conflicts: files, QueuedTs: queuedTs(run), Force: force}
}

// landResolverPrompt is the resolver's brief. It opens with landResolverOpener and the run id, so LaunchOriginOf can
// read the role back from a transcript.
func landResolverPrompt(run *waveobj.Run, files []string) string {
	base, branch := run.BaseBranch, "wave/"+run.ID
	var b strings.Builder
	fmt.Fprintf(&b, "%s%s. You are in its landing tree, %s, on %s. The run is done and waits to land on %s, which moved on: merging it conflicts in %s.\n", landResolverOpener, run.ID, run.LandPath, branch, base, strings.Join(files, ", "))
	fmt.Fprintf(&b, "Merge %s into this branch and resolve each conflict, keeping what both sides meant:\n", base)
	fmt.Fprintf(&b, "- run `git merge %s`; it stops on the conflicts.\n", base)
	fmt.Fprintf(&b, "- %s's side already landed. Read what each side did to a file with `git log --oneline <merge-base>..%s -- <file>` and the same with HEAD in place of %s, where <merge-base> is `git merge-base HEAD %s`.\n", base, base, base, base)
	fmt.Fprintf(&b, "- a file listed in %s keeps both sides' added lines.\n", unionMergeFile)
	b.WriteString("- run the narrowest test or typecheck that covers the files you touched, never a whole package or suite.\n")
	fmt.Fprintf(&b, "- commit the merge with git's default message and a second paragraph `Arc-Run: %s`, as `git commit -m \"Merge branch '%s' into %s\" -m \"Arc-Run: %s\"`.\n", run.ID, base, branch, run.ID)
	b.WriteString("Do not push, do not land the run, and do not edit anything the conflicts do not need. Ask no questions: nobody answers a resolver.\n")
	fmt.Fprintf(&b, "You have %s from your start. A session still working then is stopped and the land is held for a human.\n", ReviewTimeout)
	report := WorkerReportPath(run.DagORef, "land-resolver")
	fmt.Fprintf(&b, "Finish by writing your report to %s, saying what each conflict became, then running `wsh jarvis complete --report %s`.\n", report, report)
	b.WriteString("If you cannot resolve a conflict, run `git merge --abort`, and complete with a report that says why.")
	return b.String()
}

// tendResolvingLands moves on each land whose resolver has ended: back in line when its merge of the base is in the
// branch, held when the resolver ended without it or was lost. A resolver still at work is left. A land seeded for a
// CDP scenario (Fixture) is never tended.
func tendResolvingLands(ctx context.Context) {
	runs, err := wstore.GetRunsByLandState(ctx, LandState_Resolving)
	if err != nil {
		log.Printf("listing resolving lands: %v", err)
		return
	}
	for _, run := range runs {
		if run.Land.Fixture || !landLocks.TryLock(run.ID) {
			continue
		}
		tendResolver(ctx, run)
	}
}

// TendResolvingLandsForTest runs a pass of tendResolvingLands for tests in other packages, which have no land driver.
func TendResolvingLandsForTest(ctx context.Context) { tendResolvingLands(ctx) }

// tendResolver reads run again under the land lock tendResolvingLands took, and releases it.
func tendResolver(ctx context.Context, listed *waveobj.Run) {
	defer landLocks.Unlock(listed.ID)
	run, err := wstore.GetRun(ctx, listed.ChannelOID, listed.ID)
	if err != nil || run.Land == nil || run.Land.State != LandState_Resolving || run.Land.Fixture {
		return
	}
	g, err := wstore.GetDag(ctx, run.DagORef)
	if err != nil {
		log.Printf("run %s: loading the dag of the resolver of its land: %v", run.ID, err)
		return
	}
	land := run.Land
	if resolver, err := wstore.GetRun(ctx, run.ChannelOID, land.Resolver); err == nil && resolver.Status == jarvis.RunStatus_Done {
		// the resolver's tab holds the landing tree as its working directory until the watchdog closes it
		queueFinishedSession(run.ChannelOID, land.Resolver)
		if !resolverMergedBase(ctx, run, resolver) {
			holdResolving(ctx, run, fmt.Sprintf("the resolver ended without merging %s: see its report", run.BaseBranch))
			return
		}
		ts := land.QueuedTs
		if ts == 0 {
			ts = time.Now().UnixMilli()
		}
		if _, err := queueLand(ctx, run, land.Force, ts); err != nil {
			log.Printf("run %s: putting its land back in line after the resolver: %v", run.ID, err)
		}
		return
	}
	reason, _ := stageSessionLost(ctx, g, land.Resolver, land.ResolverTs, time.Now().UnixMilli())
	if reason == "" {
		return
	}
	var afterCommit []func()
	stopReviewer(ctx, g, land.Resolver, &afterCommit)
	for _, stop := range afterCommit {
		stop()
	}
	holdResolving(ctx, run, fmt.Sprintf("merging %s into wave/%s conflicts in %s, and the resolver %s; merge it there, then Land again",
		run.BaseBranch, run.ID, strings.Join(land.Conflicts, ", "), resolverFates.Replace(reason)))
}

// resolverFates words a stage session's lost reason for a resolver, which gives no verdict.
var resolverFates = strings.NewReplacer(
	"it ended without a verdict", "ended without finishing",
	"it exited without a verdict", "exited without finishing",
	"it gave no verdict within", "did not finish within",
	"its route refused it", "was refused by its route",
)

// holdResolving holds a resolving land for a human. The conflicts stay on the hold, and so does the force and the
// resolver's try: one resolver per land.
func holdResolving(ctx context.Context, run *waveobj.Run, reason string) {
	held := heldLand(reason)
	held.Force, held.ResolverTried, held.Conflicts = run.Land.Force, true, run.Land.Conflicts
	if err := saveLand(ctx, run.ChannelOID, run.ID, held); err != nil {
		log.Printf("run %s: holding its land after the resolver: %v", run.ID, err)
		return
	}
	appendRunEvent(ctx, run.ChannelOID, run.ID, waveobj.RunEventKindLandHeld, nil, map[string]any{"reason": reason})
}

// resolverMergedBase says whether the resolver's merge of the base is in the run's branch: the base is an ancestor of
// its head, or, when the base moved on while the resolver worked, a merge since the head the resolver started from
// takes in a commit the base holds.
func resolverMergedBase(ctx context.Context, run, resolver *waveobj.Run) bool {
	head, err := WorktreeHeadCommit(ctx, run.ProjectPath, run.ID)
	if err != nil {
		log.Printf("run %s: reading its branch after the resolver: %v", run.ID, err)
		return false
	}
	base, err := git(ctx, run.ProjectPath, "rev-parse", run.BaseBranch)
	if err != nil {
		log.Printf("run %s: reading %s after the resolver: %v", run.ID, run.BaseBranch, err)
		return false
	}
	if _, err := git(ctx, run.ProjectPath, "merge-base", "--is-ancestor", base, head); err == nil {
		return true
	}
	if resolver.BaseCommit == "" {
		return false
	}
	merges, err := git(ctx, run.ProjectPath, "rev-list", "--merges", "--parents", resolver.BaseCommit+".."+head)
	if err != nil {
		return false
	}
	for line := range strings.SplitSeq(merges, "\n") {
		fields := strings.Fields(line)
		if len(fields) < 3 {
			continue
		}
		for _, merged := range fields[2:] {
			if _, err := git(ctx, run.ProjectPath, "merge-base", "--is-ancestor", merged, base); err == nil {
				return true
			}
		}
	}
	return false
}
