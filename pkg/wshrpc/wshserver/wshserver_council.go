// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/council"
	"github.com/wavetermdev/waveterm/pkg/council/bench"
	"github.com/wavetermdev/waveterm/pkg/effortstore"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// councilRunner runs every council in wavesrv, through the real claude caller. A test replaces it with a fake caller.
var councilRunner = newCouncilRunner(council.ConsultCaller{})

func newCouncilRunner(caller council.Caller) *council.Runner {
	return &council.Runner{Caller: caller, Agents: council.AgentCaller{Link: liveAgentLink{}}, OnChange: publishCouncilChanged}
}

// publishCouncilChanged tells the cockpit and `wsh council wait` that a council was saved.
func publishCouncilChanged(c *council.Council) {
	wps.Broker.Publish(wps.WaveEvent{Event: wps.Event_CouncilChanged, Data: wshrpc.CouncilChangedData{Id: c.Id, Project: c.Project}})
}

// StartCouncilRunner is called once at startup: a council left running when wavesrv last quit has no run behind it, so
// it is marked stopped. A council with a live run is left alone. A council that was queued when wavesrv quit stays
// queued, and the oldest one starts now.
func StartCouncilRunner() {
	councilRunner.MarkStale()
	stopQueuedBenchCouncils()
	councilRunner.StartNext()
}

// stopQueuedBenchCouncils stops the bench councils left queued when wavesrv last quit. The bench that queued them ended
// with it, so one started now would spend a panel's tokens with nothing to score it and nobody to read it.
func stopQueuedBenchCouncils() {
	list, err := council.List("")
	if err != nil {
		log.Printf("[council-bench] queued bench councils not stopped: %v", err)
		return
	}
	for _, c := range list {
		if !c.Bench || c.State != council.StateQueued {
			continue
		}
		if _, err := councilRunner.Stop(c.Id); err != nil {
			log.Printf("[council-bench] council %s not stopped: %v", c.Id, err)
		}
	}
}

// councilPanel is the experts of a new council: the ones named, else the panel of the group (the coordinator last).
// An unknown group is an error.
func councilPanel(group string, experts []council.CouncilExpert) ([]council.CouncilExpert, error) {
	if len(experts) > 0 {
		return experts, nil
	}
	if strings.TrimSpace(group) == "" {
		return nil, errors.New("a council needs a group or a list of experts")
	}
	return council.ExpertsFor(group)
}

// CouncilStartCommand starts a council and returns it as saved: the rounds run in the background, so the council it
// returns is running at round 1 (or not-run), and the council:changed events carry the rest. Id alone starts the saved
// not-run council of that id.
func (ws *WshServer) CouncilStartCommand(ctx context.Context, data wshrpc.CommandCouncilStartData) (*council.Council, error) {
	// the rounds outlive this request, so they get their own context: Stop is what ends them
	if data.Id != "" {
		return councilRunner.StartSaved(context.Background(), data.Id)
	}
	if data.Mode != "" && data.Mode != council.ModeReview && data.Mode != council.ModeBrainstorm {
		return nil, fmt.Errorf("unknown council mode %q: use %s or %s", data.Mode, council.ModeReview, council.ModeBrainstorm)
	}
	experts, err := councilPanel(data.Group, data.Experts)
	if err != nil {
		return nil, err
	}
	c := &council.Council{
		Project:          data.Project,
		Feature:          data.Feature,
		Question:         data.Question,
		Files:            data.Files,
		Screenshots:      data.Screenshots,
		Group:            data.Group,
		Mode:             data.Mode,
		ModeWhy:          data.ModeWhy,
		Experts:          experts,
		PauseAfterRound1: data.Pause,
		Rounds:           data.Rounds,
		SessionId:        data.SessionId,
	}
	if data.NotRun {
		return councilRunner.Record(c)
	}
	return councilRunner.Start(context.Background(), c)
}

// CouncilListCommand is the cockpit's list, so it leaves out the councils the benchmark started: they raise no notice,
// tree row or Needs you item. The queue reads council.List itself and still sees them; CouncilGetCommand still loads one.
func (ws *WshServer) CouncilListCommand(ctx context.Context, data wshrpc.CommandCouncilListData) ([]*council.Council, error) {
	all, err := council.List(data.Project)
	if err != nil {
		return nil, err
	}
	shown := make([]*council.Council, 0, len(all))
	for _, c := range all {
		if !c.Bench {
			shown = append(shown, c)
		}
	}
	return shown, nil
}

func (ws *WshServer) CouncilGetCommand(ctx context.Context, data wshrpc.CommandCouncilIdData) (*council.Council, error) {
	if data.Id == "" {
		return nil, errors.New("a council id is required")
	}
	return council.Load(data.Id)
}

// CouncilReplyCommand posts the person's reply; the runner checks the proposal and the parent exist and answers it.
func (ws *WshServer) CouncilReplyCommand(ctx context.Context, data wshrpc.CommandCouncilReplyData) error {
	_, err := councilRunner.Reply(data.Id, data.ProposalId, data.ParentId, data.Text, data.Tools)
	return err
}

func (ws *WshServer) CouncilContinueCommand(ctx context.Context, data wshrpc.CommandCouncilContinueData) error {
	_, err := councilRunner.Continue(data.Id, data.Cut, data.Question)
	return err
}

// CouncilDraftCommand sends, edits or drops one held draft; the runner checks the council, the item and the action.
func (ws *WshServer) CouncilDraftCommand(ctx context.Context, data wshrpc.CommandCouncilDraftData) error {
	_, err := councilRunner.Draft(data.Id, data.ItemId, data.Action, data.Text)
	return err
}

func (ws *WshServer) CouncilSummarizeCommand(ctx context.Context, data wshrpc.CommandCouncilIdData) error {
	_, err := councilRunner.Summarize(data.Id)
	return err
}

// CouncilStopCommand returns once the run has saved the council as stopped, which waits for the calls in flight to be
// cancelled: 15 seconds at the longest.
func (ws *WshServer) CouncilStopCommand(ctx context.Context, data wshrpc.CommandCouncilIdData) error {
	_, err := councilRunner.Stop(data.Id)
	return err
}

// CouncilDeleteCommand removes an ended council from the list; the runner refuses one still running, waiting on the
// person or queued.
func (ws *WshServer) CouncilDeleteCommand(ctx context.Context, data wshrpc.CommandCouncilIdData) error {
	c, err := councilRunner.Delete(data.Id)
	if err != nil {
		return err
	}
	wps.Broker.Publish(wps.WaveEvent{Event: wps.Event_CouncilChanged, Data: wshrpc.CouncilChangedData{Id: c.Id, Project: c.Project, Deleted: true}})
	return nil
}

func (ws *WshServer) CouncilRetryCommand(ctx context.Context, data wshrpc.CommandCouncilRetryData) error {
	_, err := councilRunner.Retry(data.Id, data.ExpertId)
	return err
}

// CouncilSuggestCommand makes the one claude call behind Setup's suggestion. It answers the request, so it ends with it.
func (ws *WshServer) CouncilSuggestCommand(ctx context.Context, data wshrpc.CommandCouncilSuggestData) (*council.CouncilSuggestion, error) {
	s, err := councilRunner.Suggest(ctx, data.Project, data.Feature, data.Question, data.Files)
	if err != nil {
		return nil, err
	}
	return &s, nil
}

// CouncilAutoGenerateCommand writes Setup's topic, question and mode from the seated agents' recent conversations.
func (ws *WshServer) CouncilAutoGenerateCommand(ctx context.Context, data wshrpc.CommandCouncilAutoGenerateData) (*council.CouncilAutoGenerate, error) {
	return nil, errors.New("auto-generate is not built yet")
}

func (ws *WshServer) CouncilEstimateCommand(ctx context.Context, data wshrpc.CommandCouncilEstimateData) (*wshrpc.CouncilEstimateRtnData, error) {
	var est council.CouncilEstimate
	switch {
	case data.Id != "" && data.Followup > 0:
		est = council.EstimateFollowup(data.Followup, data.Tools)
	case data.Id != "":
		c, err := council.Load(data.Id)
		if err != nil {
			return nil, err
		}
		est = council.EstimateRemaining(c)
	default:
		est = council.Estimate(data.Experts, councilFileBytes(data.Project, data.Files), data.Rounds)
	}
	return &wshrpc.CouncilEstimateRtnData{Calls: est.Calls, Tokens: est.Tokens, Minutes: est.Minutes, AgentTokens: est.AgentTokens}, nil
}

// councilSkipDirs are folders a council's file list never reads into: a folder in the list counts the files in it,
// and these would count a whole repository's history or dependencies.
var councilSkipDirs = map[string]bool{".git": true, "node_modules": true}

// councilFileBytes is the size of what a council puts in front of its experts: a path is under the project unless it
// is absolute, and a folder counts the files in it. A path that cannot be read counts for nothing.
func councilFileBytes(project string, files []string) int64 {
	var total int64
	for _, f := range files {
		path := f
		if !filepath.IsAbs(path) {
			path = filepath.Join(project, path)
		}
		info, err := os.Stat(path)
		if err != nil {
			continue
		}
		if !info.IsDir() {
			total += info.Size()
			continue
		}
		filepath.WalkDir(path, func(p string, d fs.DirEntry, err error) error {
			if err != nil {
				return nil
			}
			if d.IsDir() {
				if p != path && councilSkipDirs[d.Name()] {
					return fs.SkipDir
				}
				return nil
			}
			if fi, err := d.Info(); err == nil && fi.Mode().IsRegular() {
				total += fi.Size()
			}
			return nil
		})
	}
	return total
}

// CouncilSaveDocCommand writes the council's document (the report, the whole discussion and the run facts) into its
// project, at the path asked for or the default one. It writes the file and nothing else: it never stages or commits.
// The path is kept on the council (DocPath) and announced, so the report can open the document, and the next save,
// like the one a finished council makes by itself, rewrites the same file instead of starting a -2 copy.
func (ws *WshServer) CouncilSaveDocCommand(ctx context.Context, data wshrpc.CommandCouncilSaveDocData) (*wshrpc.CouncilSaveDocRtnData, error) {
	if data.Id == "" {
		return nil, errors.New("a council id is required")
	}
	c, err := council.Load(data.Id)
	if err != nil {
		return nil, err
	}
	path, err := council.WriteDocument(c, data.Path)
	if err != nil {
		return nil, err
	}
	if path != c.DocPath {
		saved, err := council.Update(c.Id, func(c *council.Council) error {
			c.DocPath = path
			return nil
		})
		if err != nil {
			log.Printf("[council] %s: document path not kept: %v", c.Id, err)
		} else {
			publishCouncilChanged(saved)
		}
	}
	return &wshrpc.CouncilSaveDocRtnData{Path: path}, nil
}

func (ws *WshServer) CouncilRolesCommand(ctx context.Context) (*wshrpc.CouncilRolesRtnData, error) {
	return &wshrpc.CouncilRolesRtnData{Roles: council.Roles(), Groups: council.Groups()}, nil
}

func (ws *WshServer) CouncilSaveGroupCommand(ctx context.Context, data council.CouncilGroup) error {
	return council.SaveGroup(data)
}

// CouncilRateCommand keeps the person's "Was this useful?" answer on the council and adds it to the benchmark's results
// file with the council's harness version and mode. The council is saved first and announced, so the report shows the
// thanks line; if the file then cannot be written the call fails, and rating again writes it.
func (ws *WshServer) CouncilRateCommand(ctx context.Context, data wshrpc.CommandCouncilRateData) error {
	if data.Id == "" {
		return errors.New("a council id is required")
	}
	at := time.Now()
	c, err := council.SetRating(data.Id, data.Rating, at.UnixMilli())
	if err != nil {
		return err
	}
	publishCouncilChanged(c)
	return bench.AppendRating(wavebase.GetWaveDataDir(), bench.CouncilBenchRating{
		RatedAt: at.UTC().Format(time.RFC3339),
		Harness: c.Harness,
		Mode:    council.ModeOf(c),
		Council: c.Id,
		Rating:  c.Rating,
	})
}

// ---- the benchmark ----

// councilBenchWiring is what bench.Run is given beside the data dir and the options: the real calls. A test replaces
// them with fakes, so no council runs and no claude is called.
type councilBenchWiring struct {
	start  bench.StartFunc
	wait   bench.WaitFunc
	judge  bench.JudgeFunc
	remind bench.RemindFunc
}

var councilBenchWire = func() councilBenchWiring {
	return councilBenchWiring{start: benchStartCouncil, wait: benchWaitCouncil, judge: bench.Judge, remind: benchRemind}
}

// benchStartCouncil starts the council a plan item built. The bench leaves the panel empty, so it is filled from the
// council's group here; without it the runner refuses the council and every row would be a failed one.
func benchStartCouncil(ctx context.Context, c *council.Council) (*council.Council, error) {
	experts, err := councilPanel(c.Group, nil)
	if err != nil {
		return nil, err
	}
	c.Experts = experts
	return councilRunner.Start(ctx, c)
}

// benchWaitCouncil waits through the queue, behind the person's own council, to the end of the bench council's run.
// A bench council never pauses; one found waiting on the person is stopped, since nobody reads it. When ctx ends the
// council is stopped too: a queued one starts on a background context and would otherwise spend tokens later with
// nobody reading it.
func benchWaitCouncil(ctx context.Context, id string) (*council.Council, error) {
	c, err := councilRunner.Wait(ctx, id)
	if ctx.Err() != nil {
		if _, serr := councilRunner.Stop(id); serr != nil {
			log.Printf("[council-bench] council %s not stopped: %v", id, serr)
		}
		return c, err
	}
	if err == nil && c.State == council.StateAwaiting {
		return councilRunner.Stop(id)
	}
	return c, err
}

// councilBenchRun is the bench running in this wavesrv. There is at most one: it spends the tokens of a whole panel
// for every item of its plan.
type councilBenchRun struct {
	cancel context.CancelFunc
	done   chan struct{} // closed once the run has ended and the next bench may start

	mu       sync.Mutex
	inflight string // the council the bench is on, "" between councils
}

var (
	councilBenchMu  sync.Mutex
	councilBenchCur *councilBenchRun
)

// councilBenchStopWait is how long Stop waits for the bench to end after cancelling it: the council in flight saves
// itself stopped within 15 seconds.
const councilBenchStopWait = 20 * time.Second

func (b *councilBenchRun) setInflight(id string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.inflight = id
}

func (b *councilBenchRun) inflightId() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.inflight
}

// tracking wraps the start and wait of a bench so Stop knows which council is in flight.
func (b *councilBenchRun) tracking(w councilBenchWiring) (bench.StartFunc, bench.WaitFunc) {
	start := func(ctx context.Context, c *council.Council) (*council.Council, error) {
		started, err := w.start(ctx, c)
		if err == nil && started != nil {
			b.setInflight(started.Id)
		}
		return started, err
	}
	wait := func(ctx context.Context, id string) (*council.Council, error) {
		defer b.setInflight("")
		return w.wait(ctx, id)
	}
	return start, wait
}

// planCouncilBench is a bench's plan over the cases in dataDir. A case named with --case that LoadCases left out comes
// back from Plan as an unknown case, so the cases it skipped, and why, travel with the error.
func planCouncilBench(dataDir string, opts bench.Options) (*wshrpc.CouncilBenchRtnData, error) {
	cases, skipped, err := bench.LoadCases(dataDir)
	if err != nil {
		return nil, err
	}
	items, estimate, err := bench.Plan(cases, opts)
	if err == nil && len(items) == 0 {
		err = errors.New("no benchmark cases to run")
	}
	if err != nil {
		if len(skipped) > 0 {
			err = fmt.Errorf("%w (%s)", err, strings.Join(skipped, "; "))
		}
		return nil, err
	}
	return &wshrpc.CouncilBenchRtnData{Items: items, Estimate: estimate, Skipped: skipped}, nil
}

// CouncilBenchCommand plans a benchmark and, without DryRun, starts it in the background and returns at once: the
// councils run one at a time, each ends in a line of the results file, and `wsh council bench results` reads them. A
// dry run prices the plan and starts nothing, so the caller asks the Token burn gate between the two calls. Only one
// bench runs at a time; a dry run still answers while it does.
func (ws *WshServer) CouncilBenchCommand(ctx context.Context, data wshrpc.CommandCouncilBenchData) (*wshrpc.CouncilBenchRtnData, error) {
	dataDir := wavebase.GetWaveDataDir()
	opts := bench.Options{Cases: data.Cases, Variants: data.Variants, Runs: data.Runs}
	if data.DryRun {
		return planCouncilBench(dataDir, opts)
	}

	councilBenchMu.Lock()
	defer councilBenchMu.Unlock()
	if councilBenchCur != nil {
		return nil, errors.New("a bench is already running; `wsh council bench stop` ends it")
	}
	plan, err := planCouncilBench(dataDir, opts)
	if err != nil {
		return nil, err
	}
	// the run outlives this request, so it gets its own context: Stop is what ends it
	runCtx, cancel := context.WithCancel(context.Background())
	run := &councilBenchRun{cancel: cancel, done: make(chan struct{})}
	councilBenchCur = run
	wire := councilBenchWire()
	start, wait := run.tracking(wire)
	go func() {
		defer close(run.done)
		defer func() {
			councilBenchMu.Lock()
			councilBenchCur = nil
			councilBenchMu.Unlock()
		}()
		defer func() { panichandler.PanicHandler("council bench", recover()) }()
		defer cancel()
		if err := bench.Run(runCtx, dataDir, opts, start, wait, wire.judge, wire.remind); err != nil {
			log.Printf("[council-bench] the bench ended early: %v", err)
			return
		}
		log.Printf("[council-bench] the bench finished: %d councils", len(plan.Items))
	}()
	return plan, nil
}

// CouncilBenchStopCommand cancels the bench and stops the council it is on, then returns once the bench has ended. The
// councils it already scored keep their lines in the results file; the one interrupted gets none. With no bench running
// it says so.
func (ws *WshServer) CouncilBenchStopCommand(ctx context.Context) (*wshrpc.CouncilBenchStopRtnData, error) {
	councilBenchMu.Lock()
	run := councilBenchCur
	councilBenchMu.Unlock()
	if run == nil {
		return &wshrpc.CouncilBenchStopRtnData{}, nil
	}
	run.cancel()
	if id := run.inflightId(); id != "" {
		if _, err := councilRunner.Stop(id); err != nil {
			log.Printf("[council-bench] council %s not stopped: %v", id, err)
		}
	}
	select {
	case <-run.done:
	case <-ctx.Done():
	case <-time.After(councilBenchStopWait):
	}
	return &wshrpc.CouncilBenchStopRtnData{Stopped: true}, nil
}

// CouncilBenchResultsCommand reads the results file back as the table: a row per harness version and variant for the
// bench runs, and per harness version and mode for the ratings.
func (ws *WshServer) CouncilBenchResultsCommand(ctx context.Context) (*wshrpc.CouncilBenchResultsRtnData, error) {
	runs, ratings, err := bench.LoadResults(wavebase.GetWaveDataDir())
	if err != nil {
		return nil, err
	}
	rtn := &wshrpc.CouncilBenchResultsRtnData{Runs: bench.Summarize(runs), Ratings: bench.SummarizeRatings(ratings)}
	if rtn.Runs == nil {
		rtn.Runs = []bench.CouncilBenchRow{}
	}
	if rtn.Ratings == nil {
		rtn.Ratings = []bench.CouncilBenchRatingRow{}
	}
	return rtn, nil
}

// The initiative a full bench reminds through, and the chunk it adds: due a month after the bench, so the council is
// measured again whenever its prompts or models have changed since.
const (
	councilBenchEffortTitle = "Council benchmark"
	councilBenchChunkLabel  = "Re-measure the council: wsh council bench"
	councilBenchRemindDays  = 30
	councilBenchRemindNote  = "Run `wsh council bench` and compare `wsh council bench results` with the row before: " +
		"recall falling at the same tokens means a prompt or model change hurt."
)

// councilBenchEfforts is the three initiative calls the reminder makes; a test fakes them.
type councilBenchEfforts struct {
	list   func(ctx context.Context) ([]*waveobj.Effort, error)
	create func(ctx context.Context, data wshrpc.CommandEffortCreateData) (*wshrpc.CommandEffortCreateRtnData, error)
	mutate func(ctx context.Context, data wshrpc.CommandEffortMutateData) (*wshrpc.CommandEffortMutateRtnData, error)
}

// benchRemind is the reminder a full bench ends with, through the same code `wsh effort` runs.
func benchRemind(ctx context.Context) error {
	ws := &WshServer{}
	return addBenchReminder(ctx, councilBenchEfforts{list: effortstore.GetAll, create: ws.EffortCreateCommand, mutate: ws.EffortMutateCommand}, time.Now())
}

// addBenchReminder puts the re-measure chunk, due councilBenchRemindDays after now, on the Council benchmark initiative,
// creating the initiative when no live one has that title. When the chunk is already there (an earlier bench's) it moves
// that one's due date and reopens it if it was closed: a chunk label is unique in an initiative, and one reminder is
// all the council needs.
func addBenchReminder(ctx context.Context, api councilBenchEfforts, now time.Time) error {
	due := now.AddDate(0, 0, councilBenchRemindDays).Format(jarvis.DueLayout)
	all, err := api.list(ctx)
	if err != nil {
		return fmt.Errorf("listing the initiatives: %w", err)
	}
	var effort *waveobj.Effort
	for _, e := range all {
		if e.Status != "archived" && strings.TrimSpace(e.Title) == councilBenchEffortTitle {
			effort = e
			break
		}
	}
	var oid string
	var ops []wshrpc.EffortOp
	if effort == nil {
		created, err := api.create(ctx, wshrpc.CommandEffortCreateData{Title: councilBenchEffortTitle})
		if err != nil {
			return fmt.Errorf("creating the %s initiative: %w", councilBenchEffortTitle, err)
		}
		oid = created.EffortOID
		ops = []wshrpc.EffortOp{{Op: "addChunk", Label: councilBenchChunkLabel, Due: due}}
	} else {
		oid = effort.OID
		idx := slices.IndexFunc(effort.Chunks, func(c waveobj.EffortChunk) bool { return c.Label == councilBenchChunkLabel })
		switch {
		case idx < 0:
			ops = []wshrpc.EffortOp{{Op: "addChunk", Label: councilBenchChunkLabel, Due: due}}
		default:
			if s := effort.Chunks[idx].Status; s == "done" || s == "skipped" {
				ops = append(ops, wshrpc.EffortOp{Op: "setChunkStatus", Chunk: councilBenchChunkLabel, Status: "pending"})
			}
			ops = append(ops, wshrpc.EffortOp{Op: "setChunkDue", Chunk: councilBenchChunkLabel, Due: due})
		}
	}
	if _, err := api.mutate(ctx, wshrpc.CommandEffortMutateData{EffortOID: oid, Ops: ops, Note: councilBenchRemindNote}); err != nil {
		return fmt.Errorf("adding the re-measure chunk to %s: %w", councilBenchEffortTitle, err)
	}
	return nil
}
