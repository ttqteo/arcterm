// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/claudeaccount"
	"github.com/wavetermdev/waveterm/pkg/claudequota"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/orchestrate"
	"github.com/wavetermdev/waveterm/pkg/runqueue"
	"github.com/wavetermdev/waveterm/pkg/runstart"
	"github.com/wavetermdev/waveterm/pkg/usagestats"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

var _ wshrpc.RunStartCommands = (*WshServer)(nil)

// Choosing when a run starts (spec 2026-11-16-run-start-choice-design.md): this file gathers the live runs and the
// files each edits, answers the launcher's suggestion, and gives the queue's re-check the same gatherer. pkg/runstart
// holds the rules; nothing here decides, it reads the store, git and the quota and hands them over.

const (
	// runStartGitParallel bounds the git processes one gathering runs at once.
	runStartGitParallel = 8
	// runStartQuotaSamples is how many of the project's last done runs of a kind size the next one.
	runStartQuotaSamples = 10
	// runStartTitleMax is the longest title a live run gets, in runes: a goal's first line can be a paragraph.
	runStartTitleMax = 80
	// runStartQuotaWait bounds the quota read: it may ask the usage endpoint, and the launcher is waiting for the line.
	runStartQuotaWait = 3 * time.Second
	// the 5-hour window's length, which a reset closes
	fiveHourWindow = 5 * time.Hour
)

// seams the tests script: what the gatherer reads outside the files themselves
var (
	// runStartGitTimeout bounds each git call: a slow repository costs its run's changed files, never the answer.
	runStartGitTimeout = 2 * time.Second

	// runStartLoadRuns returns the runs that may be live: every run not done or cancelled, and the done ones whose
	// land is not settled. liveRunFiles keeps the ones that are.
	runStartLoadRuns = loadRunStartRuns
	// runStartProjectRuns returns the project's runs, for the quota estimate.
	runStartProjectRuns = loadRunStartProjectRuns
	runStartLoadRun     = func(ctx context.Context, id string) (*waveobj.Run, error) {
		r, err := wstore.DBGet[*waveobj.Run](ctx, id)
		if err == nil && r == nil {
			err = fmt.Errorf("run %s not found", id)
		}
		return r, err
	}
	runStartLoadDag = func(ctx context.Context, id string) (*waveobj.TaskGroup, error) {
		return wstore.GetDagShared(ctx, id)
	}
	// runStartGit runs git in dir and returns the lines it printed.
	runStartGit = func(ctx context.Context, dir string, args ...string) ([]string, error) {
		out, err := exec.CommandContext(ctx, "git", append([]string{"-C", dir}, args...)...).Output()
		if err != nil {
			return nil, fmt.Errorf("git %s in %s: %w", strings.Join(args, " "), dir, err)
		}
		return strings.Split(strings.ReplaceAll(string(out), "\r\n", "\n"), "\n"), nil
	}
	// runStartQuota is the active account's quota reading; empty when there is none to show, and under a token
	// account, as the reading is the /login account's and the run spends the token's.
	runStartQuota = func(ctx context.Context) *wshrpc.CommandGetClaudeQuotaRtnData {
		if claudeaccount.Active() != "" {
			return &wshrpc.CommandGetClaudeQuotaRtnData{}
		}
		ctx, cancel := context.WithTimeout(ctx, runStartQuotaWait)
		defer cancel()
		return claudeQuotaFor(ctx, claudequota.Get)
	}
	runStartWindowTokens = usagestats.WindowTokens
)

// loadRunStartRuns reads the runs a live-run check needs from the store: the ones still going, and the done ones whose
// land has not settled (pending, queued, resolving) or ended held, which the person lands by hand.
func loadRunStartRuns(ctx context.Context) ([]*waveobj.Run, error) {
	running, err := wstore.GetRunsByStatus(ctx, jarvis.RunStatus_Planning, jarvis.RunStatus_AwaitingReview, jarvis.RunStatus_Executing, jarvis.RunStatus_Blocked, jarvis.RunStatus_Paused)
	if err != nil {
		return nil, fmt.Errorf("reading the runs: %w", err)
	}
	seen := make(map[string]bool, len(running))
	for _, r := range running {
		seen[r.ID] = true
	}
	for _, state := range []string{orchestrate.LandState_Pending, orchestrate.LandState_Queued, orchestrate.LandState_Resolving, orchestrate.LandState_Held} {
		landing, err := wstore.GetRunsByLandState(ctx, state)
		if err != nil {
			return nil, fmt.Errorf("reading the runs landing (%s): %w", state, err)
		}
		for _, r := range landing {
			if !seen[r.ID] {
				seen[r.ID] = true
				running = append(running, r)
			}
		}
	}
	// Not returned: a done run whose land has not started. Its Land is written when the land begins, so for the moments
	// between the seal and that no query names the run (runStartLive would count it, were it listed). Finding it takes
	// a scan of every done run; the gap is short, and a run missed here only costs a held merge the suggestion exists
	// to avoid, never a wrong start.
	return running, nil
}

// loadRunStartProjectRuns reads every run of the channels that work in projectPath.
func loadRunStartProjectRuns(ctx context.Context, projectPath string) ([]*waveobj.Run, error) {
	channels, err := wstore.GetChannelsShared(ctx)
	if err != nil {
		return nil, fmt.Errorf("reading the channels: %w", err)
	}
	var out []*waveobj.Run
	for _, ch := range channels {
		if !sameProjectPath(ch.ProjectPath, projectPath) {
			continue
		}
		runs, err := wstore.GetChannelRunsShared(ctx, ch.OID)
		if err != nil {
			return nil, fmt.Errorf("reading the runs of channel %s: %w", ch.OID, err)
		}
		out = append(out, runs...)
	}
	return out, nil
}

// sameProjectPath compares two project folders as paths: slashes, trailing slashes and dot segments do not matter, and
// on Windows neither does case.
func sameProjectPath(a, b string) bool {
	if a == "" || b == "" {
		return false
	}
	return samePath(filepath.ToSlash(filepath.Clean(a)), filepath.ToSlash(filepath.Clean(b)))
}

// runStartLive reports whether a run is one a new run could wait for or collide with: a top-level run that has not
// finished, or one that finished but has not landed (its land pending, or held for the person).
func runStartLive(r *waveobj.Run) bool {
	if r == nil || !runqueue.TopLevel(r) || r.Status == jarvis.RunStatus_Cancelled {
		return false
	}
	if r.Status != jarvis.RunStatus_Done {
		return true
	}
	final, landed, _ := runqueue.Outcome(r)
	return !final || (!landed && r.Land != nil && r.Land.State == orchestrate.LandState_Held)
}

// runStartHeld is a land held for the person: waiting for it would block a queued entry at once. A hold only a dirty
// checkout makes clears by itself, so it is not one.
func runStartHeld(r *waveobj.Run) bool {
	return r.Land != nil && r.Land.State == orchestrate.LandState_Held && !r.Land.Dirty
}

// runStartTitle is how a live run is named in a reason line: the first line of its goal, cut short. Empty for a run
// with no goal; the line then falls back to the run's id.
func runStartTitle(r *waveobj.Run) string {
	for line := range strings.SplitSeq(r.Goal, "\n") {
		if line = strings.TrimSpace(line); line != "" {
			if runes := []rune(line); len(runes) > runStartTitleMax {
				return string(runes[:runStartTitleMax]) + "…"
			}
			return line
		}
	}
	return ""
}

// readStartText reads a spec or plan a run is about to be built from. A path with no text to read is no text; one
// that cannot be read is an error naming what it was.
func readStartText(what, path string) (string, error) {
	if path == "" {
		return "", nil
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("reading the %s: %w", what, err)
	}
	return string(raw), nil
}

// liveRunFiles is every live run of projectPath with the files it edits, oldest first.
func liveRunFiles(ctx context.Context, projectPath string) ([]runstart.LiveRun, error) {
	return gatherLiveRuns(ctx, projectPath, nil)
}

// gatherLiveRuns is liveRunFiles for the runs keep accepts (every one when it is nil). The re-check asks only for the
// runs created after its entry, so it runs no git for the rest.
//
// A live run's files are what its goal and its spec (Run.SpecPath, else its dag's) mention, what its dag's tasks list on
// their **Files:** lines, and the files it changed: for a run landing on a branch, wave/<id> and each of its lanes'
// branches (a finished worker's lane may not be merged yet) against its base; for a quick or checkout run, the working
// tree against its base, uncommitted edits included. A dag's spec is repo-relative when the run lands on a branch, and
// is read in the landing tree, else in the project. A git call that fails or runs past runStartGitTimeout is logged
// with the run's id and adds no files.
func gatherLiveRuns(ctx context.Context, projectPath string, keep func(*waveobj.Run) bool) ([]runstart.LiveRun, error) {
	runs, err := runStartLoadRuns(ctx)
	if err != nil {
		return nil, err
	}
	var mine []*waveobj.Run
	for _, r := range runs {
		if runStartLive(r) && sameProjectPath(r.ProjectPath, projectPath) && (keep == nil || keep(r)) {
			mine = append(mine, r)
		}
	}
	slices.SortStableFunc(mine, func(a, b *waveobj.Run) int {
		if a.CreatedTs != b.CreatedTs {
			if a.CreatedTs < b.CreatedTs {
				return -1
			}
			return 1
		}
		return strings.Compare(a.ID, b.ID)
	})

	type job struct {
		run int // index into mine
		dir string
		rev []string
	}
	named := make([][]string, len(mine)) // what the texts name, per run
	var jobs []job
	for i, r := range mine {
		dag := loadRunStartDag(ctx, r)
		named[i] = namedFiles(r, dag)
		for _, j := range diffJobs(ctx, r, dag) {
			jobs = append(jobs, job{run: i, dir: j.dir, rev: j.rev})
		}
	}

	// every git call at once, each bounded; a result lands in its job's slot so the order never depends on the race
	diffs := make([][]string, len(jobs))
	var wg sync.WaitGroup
	sem := make(chan struct{}, runStartGitParallel)
	for k, j := range jobs {
		wg.Go(func() {
			defer func() {
				if err := recover(); err != nil {
					log.Printf("run start: git diff for run %s panicked: %v", mine[j.run].ID, err)
				}
			}()
			sem <- struct{}{}
			defer func() { <-sem }()
			gctx, cancel := context.WithTimeout(ctx, runStartGitTimeout)
			defer cancel()
			lines, err := runStartGit(gctx, j.dir, j.rev...)
			if err != nil {
				log.Printf("run start: reading what run %s changed: %v", mine[j.run].ID, err)
				return
			}
			diffs[k] = lines
		})
	}
	wg.Wait()

	files := named
	for k, j := range jobs {
		files[j.run] = append(files[j.run], diffs[k]...)
	}
	live := make([]runstart.LiveRun, 0, len(mine))
	for i, r := range mine {
		l := runstart.LiveRun{Id: r.ID, Title: runStartTitle(r), Files: runstart.DiffFiles(files[i]), Held: runStartHeld(r), CreatedTs: r.CreatedTs}
		if l.Held {
			l.HeldReason = r.Land.Reason
		}
		live = append(live, l)
	}
	return live, nil
}

// loadRunStartDag reads the run's dag, nil when it has none or it cannot be read (logged: the run still has the files
// its goal names).
func loadRunStartDag(ctx context.Context, r *waveobj.Run) *waveobj.TaskGroup {
	if r.DagORef == "" {
		return nil
	}
	dag, err := runStartLoadDag(ctx, r.DagORef)
	if err != nil {
		log.Printf("run start: reading the dag of run %s: %v", r.ID, err)
		return nil
	}
	return dag
}

// namedFiles are the files a live run's texts name: its goal, its spec, and its dag's task lines.
func namedFiles(r *waveobj.Run, dag *waveobj.TaskGroup) []string {
	specPath := r.SpecPath
	if specPath == "" && dag != nil && dag.SpecPath != "" {
		// a branch-landed dag keeps its spec repo-relative: it lives in the landing tree, else in the project
		root := r.LandPath
		if root == "" {
			root = r.ProjectPath
		}
		specPath = resolvePlanPath(root, dag.SpecPath)
	}
	specText, err := readStartText("spec", specPath)
	if err != nil {
		log.Printf("run start: run %s: %v", r.ID, err)
	}
	files := jarvis.FileMentions(r.Goal, specText)
	if dag != nil {
		for _, t := range dag.Tasks {
			files = append(files, jarvis.TaskFiles(t.Description)...)
		}
	}
	return files
}

type diffJob struct {
	dir string
	rev []string
}

// diffJobs are the git calls that name what a live run changed. A run with no base commit is in no repository git can
// read.
func diffJobs(ctx context.Context, r *waveobj.Run, dag *waveobj.TaskGroup) []diffJob {
	if r.BaseCommit == "" {
		return nil
	}
	if r.Mode != jarvis.RunMode_Orchestrator || r.LandPath == "" {
		// a quick run, or one landing in the checkout: its tree against its base, uncommitted edits included
		dir := r.LandPath
		if dir == "" {
			dir = r.ProjectPath
		}
		return []diffJob{{dir: dir, rev: []string{"diff", "--name-only", r.BaseCommit}}}
	}
	jobs := []diffJob{{dir: r.ProjectPath, rev: []string{"diff", "--name-only", r.BaseCommit + "..." + runBranchPrefix + r.ID}}}
	if dag == nil {
		return jobs
	}
	// a done worker's lane may not be merged into the run's branch yet, and a merged one's files are already there
	for _, t := range dag.Tasks {
		if t.RunID == "" {
			continue
		}
		child, err := runStartLoadRun(ctx, t.RunID)
		if err != nil {
			log.Printf("run start: reading task %s's run of run %s: %v", t.ID, r.ID, err)
			continue
		}
		if child.Branch != "" {
			jobs = append(jobs, diffJob{dir: r.ProjectPath, rev: []string{"diff", "--name-only", r.BaseCommit + "..." + child.Branch}})
		}
	}
	return jobs
}

// RunStartSuggestCommand answers the launcher's When row: what Jarvis suggests for the run about to start, why, the
// live runs of the project for its After list, and a quota note when the window is nearly spent. It reads no model:
// the rules are pkg/runstart's. An unreadable spec or plan is an error, which the launcher shows as "Couldn't check".
func (ws *WshServer) RunStartSuggestCommand(ctx context.Context, data wshrpc.CommandRunStartSuggestData) (*wshrpc.RunStartSuggestion, error) {
	projectPath := strings.TrimSpace(data.ProjectPath)
	if projectPath == "" && data.ChannelId != "" {
		ch, err := wstore.DBMustGet[*waveobj.Channel](ctx, data.ChannelId)
		if err != nil {
			return nil, fmt.Errorf("loading channel: %w", err)
		}
		projectPath = ch.ProjectPath
	}
	if projectPath == "" {
		return nil, errors.New("a project path is required")
	}
	specText, err := readStartText("spec", resolvePlanPath(projectPath, data.SpecPath))
	if err != nil {
		return nil, err
	}
	planText, err := readStartText("plan", resolvePlanPath(projectPath, data.PlanPath))
	if err != nil {
		return nil, err
	}
	source := runstart.SourceGoal
	switch {
	case data.PlanPath != "":
		source = runstart.SourcePlan
	case data.SpecPath != "":
		source = runstart.SourceSpec
	}
	files := runstart.NewRunFiles(data.Goal, specText, planText)

	live, err := liveRunFiles(ctx, projectPath)
	if err != nil {
		return nil, err
	}
	// the cap counts every project's runs, as the queue does
	all, err := runQueueLoadRuns(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("reading the runs: %w", err)
	}
	runs := make([]*waveobj.Run, 0, len(all))
	for _, r := range all {
		runs = append(runs, r)
	}
	active, maxActive := runqueue.Active(runs), runQueueMaxActive()

	sug := runstart.Suggest(runstart.SuggestInput{Files: files, Source: source, Live: live, Active: active, MaxActive: maxActive})
	out := &wshrpc.RunStartSuggestion{
		Choice: sug.Choice, After: sug.After, Reason: sug.Reason,
		QuotaNote: quotaNoteFor(ctx, projectPath, data.PlanPath != "" || data.SpecPath != ""),
		Live:      make([]wshrpc.RunStartLiveRun, 0, len(live)),
		Active:    active, MaxActive: maxActive,
	}
	for _, o := range runstart.Overlaps(files, live) {
		out.Live = append(out.Live, wshrpc.RunStartLiveRun{RunId: o.RunId, Title: o.Title, Files: o.Files, Held: o.Held, HeldReason: o.HeldReason})
	}
	return out, nil
}

// quotaNoteFor is the quota line for a run about to start, "" when quota is fine or unknown. It is advice: nothing here
// fails the suggestion. The wire carries no run mode, so the kind of run that sizes the estimate is read from what the
// launcher sends: a plan or a spec is built by an orchestrator run, a plain goal is a quick one.
func quotaNoteFor(ctx context.Context, projectPath string, orchestrator bool) string {
	q := runStartQuota(ctx)
	if q == nil || (q.FiveHourPct == nil && q.WeekPct == nil) {
		return ""
	}
	in := runstart.QuotaInput{FiveHourPct: q.FiveHourPct, FiveHourReset: q.FiveHourReset, WeekPct: q.WeekPct, WeekReset: q.WeekReset, Now: time.Now(), Loc: time.Local}
	if projectRuns, err := runStartProjectRuns(ctx, projectPath); err != nil {
		log.Printf("run start: reading the project's earlier runs: %v", err)
	} else {
		in.Samples = quotaSamples(projectRuns, projectPath, orchestrator)
	}
	// the transcripts are summed only for an estimate that will be used
	if len(in.Samples) >= runstart.MinQuotaSamples && q.FiveHourPct != nil && q.FiveHourReset != nil {
		cutoff := time.Unix(*q.FiveHourReset, 0).Add(-fiveHourWindow)
		if sums, err := runStartWindowTokens([]time.Time{cutoff}); err != nil {
			log.Printf("run start: summing the 5-hour window's tokens: %v", err)
		} else if len(sums) > 0 {
			in.WindowTokens = int64(sums[0])
		}
	}
	return runstart.QuotaNote(in)
}

// quotaSamples are the summed tokens of the project's last runStartQuotaSamples done top-level runs of one kind
// (orchestrator, or every other mode), newest first. A run that recorded no usage rows (a quick run, an older one) is
// no sample: it would size the next run at zero.
func quotaSamples(runs []*waveobj.Run, projectPath string, orchestrator bool) []int64 {
	var done []*waveobj.Run
	for _, r := range runs {
		if r == nil || r.Status != jarvis.RunStatus_Done || !runqueue.TopLevel(r) || !sameProjectPath(r.ProjectPath, projectPath) {
			continue
		}
		if (r.Mode == jarvis.RunMode_Orchestrator) != orchestrator {
			continue
		}
		done = append(done, r)
	}
	slices.SortStableFunc(done, func(a, b *waveobj.Run) int { return int(finishedTs(b) - finishedTs(a)) })
	if len(done) > runStartQuotaSamples {
		done = done[:runStartQuotaSamples]
	}
	var samples []int64
	for _, r := range done {
		if r.Evidence == nil {
			continue
		}
		var sum int64
		for _, u := range r.Evidence.Usage {
			sum += int64(u.Input + u.Output + u.CacheRead + u.CacheWrite + u.CacheWrite1h)
		}
		if sum > 0 {
			samples = append(samples, sum)
		}
	}
	return samples
}

func finishedTs(r *waveobj.Run) int64 {
	if r.CompletedTs != 0 {
		return r.CompletedTs
	}
	return r.CreatedTs
}
