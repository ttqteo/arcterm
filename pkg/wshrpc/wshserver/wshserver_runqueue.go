// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"errors"
	"fmt"
	"log"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/runqueue"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// The run queue's loop and commands (spec 2026-10-14-run-handoff-lifecycle-design). pkg/runqueue holds the entries and
// the rules; this file acts on them: it starts the entry the rules name through CreateRunCommand, one at a time, and
// answers the commands that add, move, start and remove entries.

const (
	// runQueueTick is the fallback evaluation. Everything that can make an entry ready pokes the loop (a run write, a
	// queue change, a runs:maxactive change); the tick covers a poke that was dropped while a start held the flag.
	runQueueTick = 15 * time.Second
	// runQueueStartTimeout bounds one start: an engine launch builds a worktree and runs Setup before it replies.
	runQueueStartTimeout = 5 * time.Minute

	// runEventKindQueuedStart is the run event on a run that started from a queue entry (detail "entryid"). It lives
	// here, not with the other kinds in pkg/waveobj, because only this file writes it; the timeline shows an unknown
	// kind by its name.
	runEventKindQueuedStart = "queued-start"
)

// seams the tests script: what the loop reads and calls outside the queue's own file
var (
	// runQueueLoadRuns returns the runs the rules need keyed by id: every run not done or cancelled, plus each run in
	// afterIds, finished or not.
	runQueueLoadRuns = loadRunQueueRuns
	// runQueueCreateRun is the start itself: the same call `wsh runs start` makes.
	runQueueCreateRun = func(ctx context.Context, data wshrpc.CommandCreateRunData) (*wshrpc.CommandCreateRunRtnData, error) {
		return (&WshServer{}).CreateRunCommand(ctx, data)
	}
	runQueueMaxActive = func() int {
		return runqueue.ClampMaxActive(wconfig.GetWatcher().GetFullConfig().Settings.RunsMaxActive)
	}
	runQueuePublish = func(entries []wshrpc.RunQueueEntry) {
		wps.Broker.Publish(wps.WaveEvent{Event: wps.Event_RunQueueChanged, Data: wshrpc.RunQueueChangedData{Entries: entries}})
	}
)

var (
	// runQueuePoke wakes the loop; one slot, so a burst of run writes is one evaluation.
	runQueuePoke = make(chan struct{}, 1)
	// runQueueStarting is set while an entry is being started, by the loop or by Start now: one start at a time, so a
	// second evaluation can never overshoot the cap while the first one's run does not exist yet.
	runQueueStarting atomic.Bool

	// runQueueStarted holds the entries whose run was created but which could not be removed from the file, so a
	// failed write never starts the same plan twice.
	runQueueStartedMu sync.Mutex
	runQueueStarted   = map[string]bool{}
)

var allRunStatuses = []string{
	jarvis.RunStatus_Planning, jarvis.RunStatus_AwaitingReview, jarvis.RunStatus_Executing,
	jarvis.RunStatus_Blocked, jarvis.RunStatus_Done, jarvis.RunStatus_Cancelled,
}

// PokeRunQueue has the loop evaluate the queue now. It never blocks: it is the hook every run write calls.
func PokeRunQueue() {
	select {
	case runQueuePoke <- struct{}{}:
	default:
	}
}

// StartRunQueue runs the loop until ctx ends: an evaluation at start, on every poke, and every runQueueTick.
func StartRunQueue(ctx context.Context) {
	go func() {
		defer func() {
			panichandler.PanicHandler("runqueue", recover())
		}()
		runQueueLoop(ctx, runQueuePoke, runQueueTick, safeEvaluateRunQueue)
	}()
}

func runQueueLoop(ctx context.Context, poke <-chan struct{}, tick time.Duration, eval func(context.Context)) {
	t := time.NewTicker(tick)
	defer t.Stop()
	eval(ctx)
	for {
		select {
		case <-ctx.Done():
			return
		case <-poke:
		case <-t.C:
		}
		eval(ctx)
	}
}

// safeEvaluateRunQueue keeps one bad evaluation from ending the loop.
func safeEvaluateRunQueue(ctx context.Context) {
	defer func() {
		panichandler.PanicHandler("runqueue evaluate", recover())
	}()
	evaluateRunQueue(ctx)
}

// evaluateRunQueue is one pass of the loop: it starts the queued entries that are ready, then tells the origin
// sessions of the runs that ended. The second part runs whether or not the queue holds anything or a start is in
// flight: it is the one place every run write, a session going idle and wavesrv starting up reach.
func evaluateRunQueue(ctx context.Context) {
	startReadyEntries(ctx)
	notifyOrigins(ctx)
}

// startReadyEntries starts the entries the rules name, one after another, until none is ready. It returns at once
// while another start holds the flag: that start's own evaluation, or the poke Start now sends when it ends, covers
// whatever changed meanwhile.
func startReadyEntries(ctx context.Context) {
	if !runQueueStarting.CompareAndSwap(false, true) {
		return
	}
	defer runQueueStarting.Store(false)
	tried := map[string]bool{}
	for ctx.Err() == nil {
		entry, ok := nextQueuedStart(ctx)
		if !ok || tried[entry.Id] {
			return
		}
		tried[entry.Id] = true
		if err := startQueuedEntry(ctx, entry); err != nil {
			log.Printf("runqueue: %s (%s) did not start: %v", entry.Id, entry.Title, err)
		}
	}
}

// nextQueuedStart applies the rules to the queue as it is now: it blocks the entries that can never start, and
// returns the one to start, if any. It reads nothing it cannot see whole: an unreadable queue or run list starts
// nothing and blocks nothing.
func nextQueuedStart(ctx context.Context) (wshrpc.RunQueueEntry, bool) {
	entries, err := runqueue.List()
	if err != nil {
		log.Printf("runqueue: reading the queue: %v", err)
		return wshrpc.RunQueueEntry{}, false
	}
	entries = withoutStartedEntries(entries)
	if len(entries) == 0 {
		return wshrpc.RunQueueEntry{}, false
	}
	afterIds := make([]string, 0, len(entries))
	for _, e := range entries {
		if e.After != "" {
			afterIds = append(afterIds, e.After)
		}
	}
	runs, err := runQueueLoadRuns(ctx, afterIds)
	if err != nil {
		log.Printf("runqueue: reading the runs: %v", err)
		return wshrpc.RunQueueEntry{}, false
	}
	start, block := runqueue.Next(entries, runs, runQueueMaxActive())
	blocked := false
	for id, reason := range block {
		switch err := runqueue.SetBlocked(id, reason); {
		case err == nil:
			blocked = true
		case !errors.Is(err, runqueue.ErrNotFound):
			log.Printf("runqueue: blocking %s: %v", id, err)
		}
	}
	if blocked {
		publishRunQueue()
	}
	for _, e := range entries {
		if e.Id == start {
			return e, true
		}
	}
	return wshrpc.RunQueueEntry{}, false
}

// startQueuedEntry creates the run the entry stands for. On success the entry leaves the queue, any entry chained
// behind it follows it to its run, and the run records where it came from. On failure the entry is blocked with the
// error, so the loop does not try it again until the person moves or starts it; the error is returned too.
func startQueuedEntry(ctx context.Context, e wshrpc.RunQueueEntry) error {
	sctx, cancel := context.WithTimeout(ctx, runQueueStartTimeout)
	defer cancel()
	rtn, err := runQueueCreateRun(sctx, e.Data)
	if err == nil && (rtn == nil || rtn.Run == nil) {
		err = errors.New("the start returned no run")
	}
	if err != nil {
		// a server shutting down or a caller that left is not the entry's fault
		if ctx.Err() != nil {
			return err
		}
		if serr := runqueue.SetBlocked(e.Id, err.Error()); serr != nil && !errors.Is(serr, runqueue.ErrNotFound) {
			log.Printf("runqueue: blocking %s after its start failed: %v", e.Id, serr)
		}
		publishRunQueue()
		return err
	}
	run := rtn.Run
	if err := runqueue.Retarget(e.Id, run.ID); err != nil {
		log.Printf("runqueue: pointing the entries after %s at run %s: %v", e.Id, run.ID, err)
	}
	leaveRunQueue(e.Id, run.ID)
	appendRunEvent(ctx, e.Data.ChannelId, run.ID, runEventKindQueuedStart, nil, map[string]any{"entryid": e.Id})
	publishRunQueue()
	return nil
}

// leaveRunQueue drops a started entry. If the file cannot be written the entry is remembered as started, so no
// evaluation starts its plan a second time.
func leaveRunQueue(entryId, runId string) {
	err := runqueue.Remove(entryId)
	if err == nil || errors.Is(err, runqueue.ErrNotFound) {
		return
	}
	log.Printf("runqueue: %s started run %s but could not leave the queue: %v", entryId, runId, err)
	runQueueStartedMu.Lock()
	defer runQueueStartedMu.Unlock()
	runQueueStarted[entryId] = true
}

func withoutStartedEntries(entries []wshrpc.RunQueueEntry) []wshrpc.RunQueueEntry {
	runQueueStartedMu.Lock()
	defer runQueueStartedMu.Unlock()
	if len(runQueueStarted) == 0 {
		return entries
	}
	kept := make([]wshrpc.RunQueueEntry, 0, len(entries))
	for _, e := range entries {
		if !runQueueStarted[e.Id] {
			kept = append(kept, e)
			continue
		}
		if err := runqueue.Remove(e.Id); err == nil || errors.Is(err, runqueue.ErrNotFound) {
			delete(runQueueStarted, e.Id)
		}
	}
	return kept
}

func publishRunQueue() {
	entries, err := runqueue.List()
	if err != nil {
		log.Printf("runqueue: publishing the queue: %v", err)
		return
	}
	runQueuePublish(entries)
}

// loadRunQueueRuns is the loop's view of the runs: those that count against the cap (not done or cancelled), and the
// runs an entry waits After, which may be long finished.
func loadRunQueueRuns(ctx context.Context, afterIds []string) (map[string]*waveobj.Run, error) {
	live, err := wstore.GetRunsByStatus(ctx, jarvis.RunStatus_Planning, jarvis.RunStatus_AwaitingReview, jarvis.RunStatus_Executing, jarvis.RunStatus_Blocked)
	if err != nil {
		return nil, err
	}
	runs := make(map[string]*waveobj.Run, len(live)+len(afterIds))
	for _, r := range live {
		runs[r.ID] = r
	}
	for _, id := range afterIds {
		if id == "" || runs[id] != nil {
			continue
		}
		r, err := wstore.DBGet[*waveobj.Run](ctx, id)
		if err != nil {
			return nil, err
		}
		if r != nil {
			runs[id] = r
		}
	}
	return runs, nil
}

// RunQueueAddCommand queues a start. What a start would refuse for its plan is refused now, so a plan that cannot
// run never waits in the queue; the rest of the start's checks (the route, the effort) run when it starts.
func (ws *WshServer) RunQueueAddCommand(ctx context.Context, data wshrpc.CommandRunQueueAddData) (*wshrpc.RunQueueEntry, error) {
	d := data.Data
	if d.ChannelId == "" || d.WorkspaceId == "" {
		return nil, errors.New("channelid and workspaceid are required")
	}
	if d.PlanPath == "" && d.Goal == "" {
		return nil, errors.New("a goal or a planpath is required")
	}
	ch, err := wstore.DBMustGet[*waveobj.Channel](ctx, d.ChannelId)
	if err != nil {
		return nil, fmt.Errorf("loading channel: %w", err)
	}
	// a goal names the run when one is given, with or without a plan, so it names the entry too
	title := d.Goal
	if d.PlanPath != "" {
		if d.Mode != jarvis.RunMode_Orchestrator {
			return nil, errors.New("planpath needs an orchestrator run: only the engine runs a plan")
		}
		d.PlanPath = resolvePlanPath(ch.ProjectPath, d.PlanPath)
		plan, err := readPlanFile(d.PlanPath)
		if err != nil {
			return nil, err
		}
		if title == "" {
			title = planTitle(plan, d.PlanPath)
		}
	}
	after, err := resolveQueueAfter(ctx, data.After)
	if err != nil {
		return nil, err
	}
	entry, err := runqueue.Add(wshrpc.RunQueueEntry{Data: d, Title: title, ProjectPath: ch.ProjectPath, After: after})
	if err != nil {
		return nil, fmt.Errorf("queueing: %w", err)
	}
	publishRunQueue()
	PokeRunQueue()
	return &entry, nil
}

// resolveQueueAfter turns what --after was given into a full id: a run by its id or a unique prefix of it, else a
// queued entry the same way. An After that is neither is refused, so a typo never waits forever.
func resolveQueueAfter(ctx context.Context, after string) (string, error) {
	after = strings.TrimSpace(after)
	if after == "" {
		return "", nil
	}
	exact, err := wstore.DBGet[*waveobj.Run](ctx, after)
	if err != nil {
		return "", fmt.Errorf("looking up run %s: %w", after, err)
	}
	if exact != nil {
		return exact.ID, nil
	}
	runs, err := wstore.GetRunsByStatus(ctx, allRunStatuses...)
	if err != nil {
		return "", fmt.Errorf("listing runs: %w", err)
	}
	var matches []string
	for _, r := range runs {
		if strings.HasPrefix(r.ID, after) {
			matches = append(matches, r.ID)
		}
	}
	switch len(matches) {
	case 1:
		return matches[0], nil
	case 0:
	default:
		return "", fmt.Errorf("%q matches %d runs: %s", after, len(matches), strings.Join(matches, ", "))
	}
	e, err := runqueue.Resolve(after)
	if err == nil {
		return e.Id, nil
	}
	if !errors.Is(err, runqueue.ErrNotFound) {
		return "", err
	}
	return "", fmt.Errorf("--after %q is neither a run nor a queued entry", after)
}

func (ws *WshServer) RunQueueListCommand(ctx context.Context) (*wshrpc.CommandRunQueueListRtnData, error) {
	entries, err := runqueue.List()
	if err != nil {
		return nil, err
	}
	runs, err := runQueueLoadRuns(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("reading the runs: %w", err)
	}
	all := make([]*waveobj.Run, 0, len(runs))
	for _, r := range runs {
		all = append(all, r)
	}
	return &wshrpc.CommandRunQueueListRtnData{Entries: entries, MaxActive: runQueueMaxActive(), Active: runqueue.Active(all)}, nil
}

// RunQueueStartNowCommand starts the entry past the cap and past its After. If the start fails the entry is blocked
// with the error, as the loop would have it, and the error is returned to the caller.
func (ws *WshServer) RunQueueStartNowCommand(ctx context.Context, data wshrpc.CommandRunQueueIdData) error {
	e, err := runqueue.Resolve(data.Id)
	if err != nil {
		return err
	}
	if !runQueueStarting.CompareAndSwap(false, true) {
		return errors.New("another queued run is starting; try again in a moment")
	}
	defer func() {
		runQueueStarting.Store(false)
		PokeRunQueue() // the loop returned early while this held the flag, and the new run changes the count
	}()
	// the loop may have started it between the lookup and the claim
	if e, err = runqueue.Resolve(e.Id); err != nil {
		return err
	}
	return startQueuedEntry(ctx, e)
}

// RunQueueRunNextCommand moves the entry to the head of the queue, where it still waits for room and for its After.
// A blocked entry waits again: moving it is the person saying to try it.
func (ws *WshServer) RunQueueRunNextCommand(ctx context.Context, data wshrpc.CommandRunQueueIdData) error {
	e, err := runqueue.Resolve(data.Id)
	if err != nil {
		return err
	}
	if err := runqueue.MoveFirst(e.Id); err != nil {
		return err
	}
	if e.State == wshrpc.RunQueueState_Blocked {
		if err := runqueue.SetWaiting(e.Id); err != nil {
			return err
		}
	}
	publishRunQueue()
	PokeRunQueue()
	return nil
}

// RunQueueRemoveCommand drops the entry. The entries that waited After it can never start by waiting, so they are
// blocked, before it goes: the loop must not see them waiting on an entry that is gone and give them its own reason.
func (ws *WshServer) RunQueueRemoveCommand(ctx context.Context, data wshrpc.CommandRunQueueIdData) error {
	e, err := runqueue.Resolve(data.Id)
	if err != nil {
		return err
	}
	entries, err := runqueue.List()
	if err != nil {
		return err
	}
	for _, dep := range entries {
		if dep.After != e.Id {
			continue
		}
		if err := runqueue.SetBlocked(dep.Id, e.Title+" was removed"); err != nil && !errors.Is(err, runqueue.ErrNotFound) {
			return err
		}
	}
	if err := runqueue.Remove(e.Id); err != nil {
		return err
	}
	publishRunQueue()
	return nil
}
