// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/jobqueue"
	"github.com/wavetermdev/waveterm/pkg/util/keyedmutex"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wcore"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// Land states (Run.Land.State).
const (
	LandState_Pending   = "pending"
	LandState_Queued    = "queued"    // waiting for its project's turn
	LandState_Resolving = "resolving" // a resolver session is merging the base into wave/<run>
	LandState_Landed    = "landed"
	LandState_Held      = "held"
)

// LandTimeout bounds one land: a re-run of Check and then Verify, each under VerifyTimeout, and the merge.
const LandTimeout = 2*VerifyTimeout + 5*time.Minute

// landLocks keeps the automatic land after completion and a human's `wsh runs land` from merging one run twice.
var landLocks = keyedmutex.New()

// inProgressOps are the git operations a checkout can be stopped in the middle of. A merge on top of one would
// fold the run into the human's half-finished work.
var inProgressOps = []struct{ path, what string }{
	{"MERGE_HEAD", "a merge is in progress"},
	{"rebase-merge", "a rebase is in progress"},
	{"rebase-apply", "a rebase is in progress"},
	{"CHERRY_PICK_HEAD", "a cherry-pick is in progress"},
}

// LandRun merges a finished branch-landed run's wave/<runId> back into the branch the run started from, in the
// project checkout, then removes the landing tree and the branch. Anything that makes the merge unsafe holds it
// with a reason instead, and the checkout is left as it was. A run that landed in the checkout has nothing to
// merge and gets nil. force lands a run whose final stage failed; it is the human's call only.
func LandRun(ctx context.Context, channelID, runID string, force bool) (*waveobj.RunLand, error) {
	landLocks.Lock(runID)
	defer landLocks.Unlock(runID)
	return landRunLocked(ctx, channelID, runID, force)
}

// landRunLocked is LandRun under the run's land lock.
func landRunLocked(ctx context.Context, channelID, runID string, force bool) (*waveobj.RunLand, error) {
	run, err := wstore.GetRun(ctx, channelID, runID)
	if err != nil {
		return nil, fmt.Errorf("loading run: %w", err)
	}
	if run.Land != nil && run.Land.State == LandState_Landed {
		return run.Land, nil
	}
	if run.LandPath == "" {
		return nil, nil
	}
	if run.Status != jarvis.RunStatus_Done {
		return nil, fmt.Errorf("run %s is %s; only a done run lands", runID, run.Status)
	}
	var g *waveobj.TaskGroup
	if run.DagORef != "" {
		if g, err = wstore.GetDag(ctx, run.DagORef); err != nil {
			return nil, fmt.Errorf("loading dag: %w", err)
		}
	}
	if err := saveLand(ctx, channelID, runID, &waveobj.RunLand{State: LandState_Pending}); err != nil {
		return nil, err
	}
	land := landRun(ctx, run, g, force)
	if land.State == LandState_Held {
		// the engine's own retry of a dirty hold must not drop the human's force
		land.Force = force
	}
	if err := saveLand(ctx, channelID, runID, land); err != nil {
		return nil, err
	}
	switch land.State {
	case LandState_Held:
		appendRunEvent(ctx, channelID, runID, waveobj.RunEventKindLandHeld, nil, map[string]any{"reason": land.Reason})
	case LandState_Landed:
		appendRunEvent(ctx, channelID, runID, waveobj.RunEventKindLanded, nil, map[string]any{"commit": land.Commit, "title": landedTitle(ctx, run, g, land.Commit)})
		// the land runs after the lead's `complete`, whose close check saw a run not yet landed: a run landed past
		// a failed final stage keeps its dag blocked, so no later tick would look at its lead again
		if fresh, err := wstore.GetRun(ctx, channelID, runID); err == nil {
			if _, err := MaybeCloseOrchestratorLead(ctx, fresh, g); err != nil {
				log.Printf("run %s landed; closing its lead's tab: %v", runID, err)
			}
		}
	}
	return land, nil
}

// retryDirtyLands lands again each run held only by uncommitted changes in its checkout (RunLand.Dirty), once the
// land's own checkout check passes. The changes are another session's or the human's, so the engine waits for them
// to be committed, stashed or moved aside instead of asking anyone to retry. The watchdog calls it every tick. A
// dismissed hold is the human's to retry, and a run whose land is already under way is skipped.
func retryDirtyLands(ctx context.Context) {
	runs, err := wstore.GetRunsByLandState(ctx, LandState_Held)
	if err != nil {
		log.Printf("listing held lands: %v", err)
		return
	}
	for _, run := range runs {
		if !run.Land.Dirty || run.Land.Dismissed || !landLocks.TryLock(run.ID) {
			continue
		}
		goStage("land retry "+run.ID, func() {
			defer landLocks.Unlock(run.ID)
			if mergedCommit(ctx, run) == "" && landPrecheck(ctx, run) != nil {
				return
			}
			// a merge cut off halfway would leave the checkout mid-merge
			lctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), LandTimeout)
			defer cancel()
			if _, err := landRunLocked(lctx, run.ChannelOID, run.ID, run.Land.Force); err != nil {
				log.Printf("run %s: retrying its land: %v", run.ID, err)
			}
		})
	}
}

func saveLand(ctx context.Context, channelID, runID string, land *waveobj.RunLand) error {
	if err := wstore.UpdateRun(ctx, channelID, runID, func(r *waveobj.Run) error {
		r.Land = land
		return nil
	}); err != nil {
		return fmt.Errorf("saving the land: %w", err)
	}
	wcore.SendWaveObjUpdate(waveobj.MakeORef(waveobj.OType_Run, runID))
	wcore.SendWaveObjUpdate(waveobj.MakeORef(waveobj.OType_Channel, channelID))
	return nil
}

func heldLand(reason string) *waveobj.RunLand {
	return &waveobj.RunLand{State: LandState_Held, Reason: reason}
}

// landPrecheck is the hold the land would meet in the checkout now, nil when there is none: the cheap checks that
// need neither Check nor Verify. The run-finished wake and the dirty-hold retry ask it too.
func landPrecheck(ctx context.Context, run *waveobj.Run) *waveobj.RunLand {
	if run.BaseBranch == "" {
		return heldLand(fmt.Sprintf("the run started on a detached HEAD, so wave/%s has no branch to merge into", run.ID))
	}
	if reason, dirty := checkoutHold(ctx, run); reason != "" {
		return &waveobj.RunLand{State: LandState_Held, Reason: reason, Dirty: dirty}
	}
	return nil
}

// landRun makes the merge, or says why it may not. The cheap checks on the checkout run before the re-run of
// Check and Verify, so a held reason the human can fix at once is not minutes away, and again under the checkout
// claim, since the checkout can change while they run.
func landRun(ctx context.Context, run *waveobj.Run, g *waveobj.TaskGroup, force bool) *waveobj.RunLand {
	if commit := mergedCommit(ctx, run); commit != "" {
		removeLandedTree(ctx, run.ProjectPath, run.ID)
		return &waveobj.RunLand{State: LandState_Landed, Commit: commit}
	}
	if reason := finalHold(g); reason != "" && !force {
		return heldLand(reason)
	}
	if hold := landPrecheck(ctx, run); hold != nil {
		return hold
	}
	project, branch := run.ProjectPath, "wave/"+run.ID
	reason, checkedBase, checkNote := reverifyHold(ctx, run, g)
	if reason != "" {
		return heldLand(reason)
	}
	claim, err := claimProject(project, runDagID(run, g), "land-back")
	if err != nil {
		return heldLand(err.Error())
	}
	defer releaseProject(project, claim)
	if hold := landPrecheck(ctx, run); hold != nil {
		return hold
	}
	if reason := clearUntrackedCopies(ctx, project, branch); reason != "" {
		return heldLand(reason)
	}
	if reason, dirty := clearEditedCopies(ctx, project, branch); reason != "" {
		return &waveobj.RunLand{State: LandState_Held, Reason: reason, Dirty: dirty}
	}
	pre, err := ProjectHeadCommit(ctx, project)
	if err != nil {
		return heldLand("reading the checkout's head: " + err.Error())
	}
	title := landTitle(run, g, branchSubjects(ctx, project, pre, branch))
	if _, err := git(ctx, project, "merge", "--no-ff", "-m", title, "-m", "Arc-Run: "+run.ID, branch); err != nil {
		return heldLand(mergeRefusal(ctx, project, run.BaseBranch, err))
	}
	land := &waveobj.RunLand{State: LandState_Landed}
	if land.Commit, err = ProjectHeadCommit(ctx, project); err != nil {
		log.Printf("run %s: reading the land's merge commit: %v", run.ID, err)
	}
	if checkNote != "" {
		land.Notes = append(land.Notes, checkNote)
	}
	if note := movedBaseNote(ctx, run, pre, checkedBase); note != "" {
		land.Notes = append(land.Notes, note)
	}
	removeLandedTree(ctx, project, run.ID)
	return land
}

// removeLandedTree drops a landed run's tree and branch; the evidence keeps the branch's tip, so neither is needed.
func removeLandedTree(ctx context.Context, project, runID string) {
	if err := RemoveRunWorktree(ctx, project, runID); err != nil {
		log.Printf("run %s landed; removing its landing tree: %v; retrying until its lead lets go of it", runID, err)
		go retryLandTreeRemoval(project, runID)
	}
}

// mergedCommit is the base's commit that took in a run's work already there, as when the human merged the branch
// by hand after a held land; empty when the work is not in the base. The work is the branch's tip, or, once the
// branch is gone, the commit the run completed on. The commit is the merge that has the tip as a parent, else the
// tip itself (a fast-forward, or a run with nothing to merge).
func mergedCommit(ctx context.Context, run *waveobj.Run) string {
	if run.BaseBranch == "" {
		return ""
	}
	tip, err := WorktreeHeadCommit(ctx, run.ProjectPath, run.ID)
	if err != nil {
		tip = run.EndCommit
	}
	if tip == "" {
		return ""
	}
	if tip, err = git(ctx, run.ProjectPath, "rev-parse", tip); err != nil {
		return ""
	}
	if _, err := git(ctx, run.ProjectPath, "merge-base", "--is-ancestor", tip, run.BaseBranch); err != nil {
		return ""
	}
	merges, _ := git(ctx, run.ProjectPath, "rev-list", "--merges", "--parents", "--ancestry-path", tip+".."+run.BaseBranch)
	for _, line := range strings.Split(merges, "\n") {
		if f := strings.Fields(line); len(f) > 2 && slices.Contains(f[2:], tip) {
			return f[0]
		}
	}
	return tip
}

// landTreeRetryEvery and landTreeRetryAttempts pace retryLandTreeRemoval over about five minutes; vars so a test
// can shorten them.
var (
	landTreeRetryEvery    = 10 * time.Second
	landTreeRetryAttempts = 30
)

// retryLandTreeRemoval removes a landed run's tree once its lead lets go of it. The land runs as the lead
// completes, while the tree is still its working directory, and on Windows only the lead's exit frees it.
func retryLandTreeRemoval(project, runID string) {
	var err error
	for range landTreeRetryAttempts {
		time.Sleep(landTreeRetryEvery)
		if err = RemoveRunWorktree(context.Background(), project, runID); err == nil {
			return
		}
	}
	log.Printf("run %s: gave up removing its landing tree after %d attempts: %v", runID, landTreeRetryAttempts, err)
}

func runDagID(run *waveobj.Run, g *waveobj.TaskGroup) string {
	if g != nil {
		return g.OID
	}
	return run.ID
}

// finalHold is why the final stage keeps a run from landing: only passed and unverified land. A run with no dag
// had no final stage, and the lead's own work lands.
func finalHold(g *waveobj.TaskGroup) string {
	switch {
	case g == nil:
		return ""
	case g.Final == nil || !finalTerminal(g.Final.State):
		return "the final stage has not finished"
	case g.Final.State == FinalState_Failed:
		return "the final stage failed"
	}
	return ""
}

// checkoutHold is why the project checkout cannot take the merge now: it is on another branch, stopped inside a
// git operation, has staged changes the merge commit would sweep in, has unstaged edits the merge would overwrite,
// or has an untracked file where the branch adds a different one. dirty is set when only uncommitted changes stand
// in the way. Those belong to another session or the human, so nothing of the engine's touches them: the land
// retries by itself once they are gone (retryDirtyLands).
func checkoutHold(ctx context.Context, run *waveobj.Run) (reason string, dirty bool) {
	project, branch := run.ProjectPath, "wave/"+run.ID
	cur, err := git(ctx, project, "rev-parse", "--abbrev-ref", "HEAD")
	if err != nil {
		return "reading the checkout's branch: " + err.Error(), false
	}
	if cur != run.BaseBranch {
		return fmt.Sprintf("the checkout is on %s, not %s", cur, run.BaseBranch), false
	}
	args := []string{"rev-parse"}
	for _, op := range inProgressOps {
		args = append(args, "--git-path", op.path)
	}
	out, err := git(ctx, project, args...)
	if err != nil {
		return "reading the checkout's git state: " + err.Error(), false
	}
	for i, p := range strings.Split(out, "\n") {
		p = strings.TrimSpace(p)
		if !filepath.IsAbs(p) {
			p = filepath.Join(project, p)
		}
		if _, err := os.Stat(p); err == nil && i < len(inProgressOps) {
			return "the checkout is stopped mid-operation: " + inProgressOps[i].what, false
		}
	}
	if clean, _ := IndexClean(ctx, project); !clean {
		return "the checkout has staged changes", true
	}
	overlap, _, err := unstagedOverlap(ctx, project, branch)
	if err != nil {
		return err.Error(), false
	}
	if len(overlap) > 0 {
		return "the checkout has unstaged edits to files the run changes: " + strings.Join(overlap, ", "), true
	}
	_, differs, err := untrackedCopies(ctx, project, branch)
	if err != nil {
		return err.Error(), false
	}
	if differs != "" {
		return untrackedDiffersReason(differs), true
	}
	return "", false
}

// unstagedOverlap names the checkout's unstaged edits to files the run's branch changes, which git merge refuses
// to overwrite only after the re-run of Check and Verify. Edits to other files stay: git merges past them. An edit
// that is already the branch's version is a copy, not an overlap: a generated file every build rewrites (the
// embedded claude-mod), synced from a source the run committed, held run ee18a780 with nobody's work at stake.
func unstagedOverlap(ctx context.Context, project, branch string) (overlap, copies []string, err error) {
	edited, err := git(ctx, project, "diff", "--name-only", "--no-renames", "-z")
	if err != nil {
		return nil, nil, fmt.Errorf("listing the checkout's unstaged edits: %w", err)
	}
	if edited == "" {
		return nil, nil, nil
	}
	base, err := git(ctx, project, "merge-base", "HEAD", branch)
	if err != nil {
		return nil, nil, fmt.Errorf("finding where the run's branch forked: %w", err)
	}
	changed, err := git(ctx, project, "diff", "--name-only", "--no-renames", "-z", base, branch)
	if err != nil {
		return nil, nil, fmt.Errorf("listing what the run changes: %w", err)
	}
	theirs := strings.Split(changed, "\x00")
	for _, p := range strings.Split(edited, "\x00") {
		if p == "" || !slices.Contains(theirs, p) {
			continue
		}
		if sameAsBranch(ctx, project, branch, p) {
			copies = append(copies, p)
		} else {
			overlap = append(overlap, p)
		}
	}
	return overlap, copies, nil
}

// sameAsBranch says whether the checkout's file p holds the branch's version of it, a missing file matching one the
// branch deletes. hash-object applies the checkout's filters, so a CRLF copy of an LF file reads as the same.
func sameAsBranch(ctx context.Context, project, branch, p string) bool {
	theirs, theirErr := git(ctx, project, "rev-parse", branch+":"+p)
	if _, err := os.Lstat(filepath.Join(project, filepath.FromSlash(p))); os.IsNotExist(err) {
		return theirErr != nil
	}
	if theirErr != nil {
		return false
	}
	mine, err := git(ctx, project, "hash-object", "--", p)
	return err == nil && mine == theirs
}

// clearEditedCopies puts back the checkout's unstaged copies of the branch's version, which git merge would refuse
// to overwrite. Nothing is lost: the branch holds the same content, and the merge takes it in. It reads them again
// under the checkout claim, so an edit made since the precheck holds the land instead, as a dirty hold.
func clearEditedCopies(ctx context.Context, project, branch string) (reason string, dirty bool) {
	overlap, copies, err := unstagedOverlap(ctx, project, branch)
	if err != nil {
		return err.Error(), false
	}
	if len(overlap) > 0 {
		return "the checkout has unstaged edits to files the run changes: " + strings.Join(overlap, ", "), true
	}
	if len(copies) == 0 {
		return "", false
	}
	if _, err := git(ctx, project, append([]string{"checkout", "--"}, copies...)...); err != nil {
		return "putting back the checkout's copies of what the run changes: " + err.Error(), false
	}
	return "", false
}

// reverifyHold checks what the final stage never saw before the run lands: the lead's wrap-up commits after it,
// and the base's commits since the run forked. It merges the base into the landing tree without committing, runs
// Check, then Verify scoped to what differs from the verified commit, and puts the tree back. A docs-only wrap-up
// on an unmoved base skips Check, which cannot scope itself and would re-run whole for Markdown; Verify still runs.
// checkedBase is the base commit the run was checked against, so the land notes only base commits that arrived
// after it.
func reverifyHold(ctx context.Context, run *waveobj.Run, g *waveobj.TaskGroup) (reason, checkedBase, note string) {
	if g == nil || (g.Check == "" && g.Verify == "") {
		return "", "", ""
	}
	head, err := WorktreeHeadCommit(ctx, run.ProjectPath, run.ID)
	if err != nil {
		return "reading the run's branch: " + err.Error(), "", ""
	}
	base, err := git(ctx, run.ProjectPath, "rev-parse", run.BaseBranch)
	if err != nil {
		return "reading " + run.BaseBranch + ": " + err.Error(), "", ""
	}
	verified := ""
	if g.Final != nil {
		verified = g.Final.Commit
	}
	_, ancestorErr := git(ctx, run.ProjectPath, "merge-base", "--is-ancestor", base, head)
	baseMoved := ancestorErr != nil
	if head == verified && !baseMoved {
		return "", base, ""
	}
	if err := checkLandingTree(ctx, run); err != nil {
		return "the run changed after the final stage verified it, and it cannot be checked again: " + err.Error(), "", ""
	}
	// a merge someone left open would be checked as if it were the run's
	if _, err := git(ctx, run.LandPath, "rev-parse", "-q", "--verify", "MERGE_HEAD"); err == nil {
		return "the landing tree " + run.LandPath + " is stopped mid-merge; finish or abort that merge there, then land again", "", ""
	}
	if baseMoved {
		if _, err := git(ctx, run.LandPath, "merge", "--no-commit", "--no-ff", base); err != nil {
			return "checking the run merged with " + run.BaseBranch + " in its landing tree: " + mergeRefusal(ctx, run.LandPath, run.BaseBranch, err), "", ""
		}
		defer func() {
			if _, err := git(context.Background(), run.LandPath, "merge", "--abort"); err != nil {
				log.Printf("run %s: putting the landing tree back after the land's check: %v", run.ID, err)
			}
		}()
	}
	env := changedFilesEnv(ctx, run.LandPath, verified, "", run.ID+"-land")
	skipCheck := !baseMoved && verified != "" && onlyMarkdown(ctx, run.ProjectPath, verified, head)
	for _, c := range []struct {
		name, cmd string
		env       []string
	}{{PlanCmd_Check, g.Check, nil}, {PlanCmd_Verify, g.Verify, env}} {
		if c.cmd == "" || (c.name == PlanCmd_Check && skipCheck) {
			continue
		}
		checkCtx := jobqueue.WithSource(ctx, jobqueue.Source{RunId: run.ID, Label: c.name + " · land", Always: c.name == "Verify"})
		if _, err := runPlanCommand(withRunCmdOwner(checkCtx, run.ID, c.name, ""), run.LandPath, c.cmd, c.env, VerifyTimeout, nil); err != nil {
			// the final stage let this through as unverified; holding here would leave no way to land
			if c.name == PlanCmd_Check && baseCheckFailed(g) {
				note = sharedCheckFailure(g, "the run merged with "+run.BaseBranch, failureDetail(err))
				continue
			}
			if planCommandKilled(err) {
				return fmt.Sprintf("the run changed after the final stage verified it, and %s `%s` did not finish on the run merged with %s (%s); `wsh runs land %s` runs it again", c.name, c.cmd, run.BaseBranch, failureDetail(err), run.ID), "", ""
			}
			return fmt.Sprintf("the run changed after the final stage verified it, and %s `%s` failed on the run merged with %s (%s)", c.name, c.cmd, run.BaseBranch, failureDetail(err)), "", ""
		}
	}
	return "", base, note
}

// onlyMarkdown reports whether every path that differs between from and to is a Markdown file. A listing that
// fails is not, so the caller checks in full.
func onlyMarkdown(ctx context.Context, dir, from, to string) bool {
	out, err := git(ctx, dir, "diff", "--name-only", "--no-renames", from, to)
	if err != nil {
		log.Printf("listing the paths changed between %s and %s in %s: %v", from, to, dir, err)
		return false
	}
	for _, p := range strings.Split(out, "\n") {
		if p = strings.TrimSpace(p); p != "" && !strings.EqualFold(filepath.Ext(p), ".md") {
			return false
		}
	}
	return true
}

// clearUntrackedCopies removes an untracked file in the checkout that is the same as one the branch adds: the
// lead wrote its spec or plan there before submit, and the engine committed that file on the branch. git would
// refuse to overwrite it. One that differs is the human's, and holds the land.
func clearUntrackedCopies(ctx context.Context, project, branch string) string {
	copies, differs, err := untrackedCopies(ctx, project, branch)
	if err != nil {
		return err.Error()
	}
	if differs != "" {
		return untrackedDiffersReason(differs)
	}
	for _, full := range copies {
		if err := os.Remove(full); err != nil {
			return "removing an untracked copy of what the run adds: " + err.Error()
		}
	}
	return ""
}

func untrackedDiffersReason(path string) string {
	return fmt.Sprintf("an untracked %s in the checkout differs from the one the run adds", path)
}

// untrackedCopies lists, as full paths, the untracked files in the checkout that are the same as ones the branch
// adds, or names the first that differs instead. It changes nothing.
func untrackedCopies(ctx context.Context, project, branch string) (copies []string, differs string, err error) {
	base, err := git(ctx, project, "merge-base", "HEAD", branch)
	if err != nil {
		return nil, "", fmt.Errorf("finding where the run's branch forked: %w", err)
	}
	added, err := git(ctx, project, "diff", "--name-only", "--no-renames", "--diff-filter=A", "-z", base, branch)
	if err != nil {
		return nil, "", fmt.Errorf("listing what the run adds: %w", err)
	}
	for _, p := range strings.Split(added, "\x00") {
		if p == "" {
			continue
		}
		full := filepath.Join(project, filepath.FromSlash(p))
		if info, err := os.Stat(full); err != nil || !info.Mode().IsRegular() {
			continue
		}
		if _, err := git(ctx, project, "ls-files", "--error-unmatch", "--", p); err == nil {
			continue // tracked: git merges it or refuses on its own
		}
		// hash-object applies the checkout's filters, so a CRLF copy of an LF file still reads as the same
		theirs, err := git(ctx, project, "rev-parse", branch+":"+p)
		if err != nil {
			return nil, "", fmt.Errorf("reading %s on the run's branch: %w", p, err)
		}
		mine, err := git(ctx, project, "hash-object", "--", p)
		if err != nil {
			return nil, "", fmt.Errorf("reading the untracked %s: %w", p, err)
		}
		if mine != theirs {
			return nil, p, nil
		}
		copies = append(copies, full)
	}
	return copies, "", nil
}

// LandConflicts names the files the land of a branch-landed run would conflict in, sorted, while its lead can
// still fix them: the land itself runs after the lead's complete has closed its tab. git merge-tree merges the
// two commits in memory, so neither the checkout nor the landing tree is touched. A run that lands in the
// checkout, or started on a detached HEAD, has no land to predict.
func LandConflicts(ctx context.Context, run *waveobj.Run) ([]string, error) {
	if run.LandPath == "" || run.BaseBranch == "" {
		return nil, nil
	}
	cmd := exec.CommandContext(ctx, "git", "-C", run.ProjectPath, "merge-tree", "--write-tree", "--name-only", "--no-messages", "-z", run.BaseBranch, "wave/"+run.ID)
	out, err := cmd.Output()
	if err == nil {
		return nil, nil
	}
	var exit *exec.ExitError
	if !errors.As(err, &exit) {
		return nil, fmt.Errorf("predicting the land of wave/%s into %s: %w", run.ID, run.BaseBranch, err)
	}
	fields := strings.Split(string(out), "\x00")
	// exit 1 is a conflict only with the merged tree's id first; a bad ref also exits 1, with nothing on stdout
	if exit.ExitCode() != 1 || !objectID.MatchString(fields[0]) {
		return nil, fmt.Errorf("predicting the land of wave/%s into %s: %w: %s", run.ID, run.BaseBranch, err, strings.TrimSpace(string(exit.Stderr)))
	}
	var files []string
	for _, p := range fields[1:] {
		if p != "" {
			files = append(files, p)
		}
	}
	slices.Sort(files)
	return slices.Compact(files), nil
}

// objectID is a git object id, sha1 or sha256.
var objectID = regexp.MustCompile(`^[0-9a-f]{40}([0-9a-f]{24})?$`)

// mergeRefusal says why git would not make the merge. A conflict is aborted, so the checkout is left with no
// merge state; a refusal to overwrite uncommitted edits never started one, and the edits are untouched.
func mergeRefusal(ctx context.Context, project, base string, merr error) string {
	if conflicted, err := git(ctx, project, "diff", "--name-only", "--diff-filter=U"); err == nil && conflicted != "" {
		files := strings.Join(strings.Fields(conflicted), ", ")
		if _, err := git(ctx, project, "merge", "--abort"); err != nil {
			return fmt.Sprintf("the merge conflicts with %s in %s, and aborting it failed: %v", base, files, err)
		}
		return fmt.Sprintf("the merge conflicts with %s in %s; it was aborted", base, files)
	}
	if files, untracked := overwrittenFiles(merr.Error()); len(files) > 0 {
		what := "uncommitted changes"
		if untracked {
			what = "untracked files"
		}
		return fmt.Sprintf("git refused the merge because it would overwrite %s in the checkout: %s", what, strings.Join(files, ", "))
	}
	return "git refused the merge: " + merr.Error()
}

// overwrittenFiles reads the files git names under its "would be overwritten by merge:" line, up to its "Please
// commit" (or "Please move or remove") line. The lines are matched by those bounds, not git's tab indent, which
// git() trims; untracked is git's untracked-files form of the refusal.
func overwrittenFiles(out string) (files []string, untracked bool) {
	in := false
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		switch {
		case strings.HasSuffix(line, "would be overwritten by merge:"):
			in = true
			untracked = untracked || strings.Contains(line, "untracked")
		case !in || line == "":
		case strings.HasPrefix(line, "Please ") || line == "Aborting":
			in = false
		default:
			files = append(files, line)
		}
	}
	return files, untracked
}

// planTitleSuffix ends the H1 of a plan written from the writing-plans template; a commit subject names the
// change, not the plan.
const planTitleSuffix = " Implementation Plan"

// changeTitle is a dag title as a commit subject names it, without planTitleSuffix.
func changeTitle(title string) string {
	return strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(title), planTitleSuffix))
}

// maxLandTitleLen keeps the merge subject to one line of `git log --oneline`: a one-line goal can run to
// a thousand characters.
const maxLandTitleLen = 72

// landTitle is the merge commit's subject: the plan's title, else the goal's first line, as a conventional
// subject typed from the branch's own commit subjects.
func landTitle(run *waveobj.Run, g *waveobj.TaskGroup, subjects []string) string {
	if g != nil {
		if title := changeTitle(g.Title); title != "" {
			return conventionalTitle(title, subjects)
		}
	}
	if goal, _, _ := strings.Cut(strings.TrimSpace(run.Goal), "\n"); strings.TrimSpace(goal) != "" {
		return conventionalTitle(strings.TrimSpace(goal), subjects)
	}
	return conventionalTitle("Land run "+run.ID, subjects)
}

// landedTitle is the subject the land committed. The branch is gone by then, so landTitle could no longer type it.
func landedTitle(ctx context.Context, run *waveobj.Run, g *waveobj.TaskGroup, commit string) string {
	if commit != "" {
		if s, err := git(ctx, run.ProjectPath, "log", "-1", "--format=%s", commit); err == nil && s != "" {
			return s
		}
	}
	return landTitle(run, g, nil)
}

// branchSubjects are the subjects of the commits branch adds over base, merges left out.
func branchSubjects(ctx context.Context, project, base, branch string) []string {
	out, err := git(ctx, project, "log", "--no-merges", "--format=%s", base+".."+branch)
	if err != nil {
		log.Printf("reading the subjects of %s: %v", branch, err)
		return nil
	}
	return strings.Split(out, "\n")
}

// conventionalSubjectRe matches a conventional-commit subject's "type(scope)!: " head.
var conventionalSubjectRe = regexp.MustCompile(`^([a-z]+)(?:\(([^()\s]+)\))?!?: \S`)

// conventionalTypes ranks the types by what a reader of the log most needs to know: a commit gathering a
// feature and its fixes is a feature.
var conventionalTypes = []string{"feat", "fix", "perf", "refactor", "test", "docs", "build", "ci", "style", "chore"}

// fallbackType types a commit whose gathered subjects name no known type.
const fallbackType = "chore"

// conventionalTitle makes title a conventional subject, cut to maxLandTitleLen. A title that already is one is
// kept; otherwise the prefix comes from conventionalPrefix.
func conventionalTitle(title string, subjects []string) string {
	if conventionalSubjectRe.MatchString(title) {
		return landSubject(title, maxLandTitleLen)
	}
	prefix := conventionalPrefix(subjects)
	return prefix + landSubject(title, maxLandTitleLen-len([]rune(prefix)))
}

// conventionalPrefix is the "type(scope): " of the highest-ranked type among subjects, with the scope its
// subjects use most; a tie names none, since the change spans them.
func conventionalPrefix(subjects []string) string {
	type head struct{ typ, scope string }
	var heads []head
	rank := len(conventionalTypes)
	for _, s := range subjects {
		m := conventionalSubjectRe.FindStringSubmatch(strings.TrimSpace(s))
		if m == nil {
			continue
		}
		if i := slices.Index(conventionalTypes, m[1]); i >= 0 {
			heads = append(heads, head{m[1], m[2]})
			rank = min(rank, i)
		}
	}
	if rank == len(conventionalTypes) {
		return fallbackType + ": "
	}
	typ := conventionalTypes[rank]
	counts := map[string]int{}
	for _, h := range heads {
		if h.typ == typ && h.scope != "" {
			counts[h.scope]++
		}
	}
	scope, top := "", 0
	for s, n := range counts {
		switch {
		case n > top:
			scope, top = s, n
		case n == top:
			scope = ""
		}
	}
	if scope == "" {
		return typ + ": "
	}
	return typ + "(" + scope + "): "
}

// absPathToken is a word that is an absolute path (a drive, a share, root or home); trailing punctuation belongs
// to the sentence around it.
var absPathToken = regexp.MustCompile(`^([A-Za-z]:[\\/]|\\\\|/|~/)(.*?)([.,;:)]*)$`)

var sentenceEnd = regexp.MustCompile(`[.?!]\s`)

// landSubject makes one line of text a merge subject: absolute paths shrink to their base name, the text stops at
// its first sentence, and a subject over limit runes is cut at a word, so it never ends inside a path.
func landSubject(s string, limit int) string {
	words := strings.Fields(s)
	for i, w := range words {
		m := absPathToken.FindStringSubmatch(w)
		if m == nil {
			continue
		}
		p := strings.TrimRight(m[1]+m[2], `\/`)
		if base := p[strings.LastIndexAny(p, `\/`)+1:]; base != "" {
			words[i] = base + m[3]
		}
	}
	s = strings.Join(words, " ")
	if loc := sentenceEnd.FindStringIndex(s); loc != nil {
		s = strings.TrimSuffix(s[:loc[0]+1], ".")
	}
	r := []rune(s)
	if len(r) <= limit {
		return s
	}
	head := string(r[:limit])
	if i := strings.LastIndex(head, " "); i > 0 {
		return strings.TrimRight(head[:i], ",;: ") + "…"
	}
	return clipRunes(s, limit)
}

// movedBaseNote is set when the base branch took commits the land's check did not see: all of them when nothing
// was checked, else those after the base commit the check merged. The run's own commits are excluded, should any
// reach the base.
func movedBaseNote(ctx context.Context, run *waveobj.Run, pre, checkedBase string) string {
	from := run.BaseCommit
	if checkedBase != "" {
		from = checkedBase
	}
	if from == "" {
		return ""
	}
	out, err := git(ctx, run.ProjectPath, "rev-list", "--count", pre, "^"+from, "^wave/"+run.ID)
	if err != nil {
		log.Printf("run %s: counting the base's new commits: %v", run.ID, err)
		return ""
	}
	n, err := strconv.Atoi(out)
	if err != nil || n == 0 {
		return ""
	}
	commits := "commits that"
	if n == 1 {
		commits = "commit that"
	}
	return fmt.Sprintf("merged onto %d %s landed on %s during the run; the combination was not verified", n, commits, run.BaseBranch)
}
