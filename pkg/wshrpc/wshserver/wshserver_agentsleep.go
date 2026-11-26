// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"fmt"
	"log"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/shirou/gopsutil/v4/process"
	"github.com/wavetermdev/waveterm/pkg/agentctl"
	"github.com/wavetermdev/waveterm/pkg/agentsleep"
	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/blockcontroller"
	"github.com/wavetermdev/waveterm/pkg/orchestrate"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wcore"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// Sleeping an idle agent and waking it. Sleeping writes `--resume <session>` into the block's cmd:args and
// agent:sleeping into its meta, then destroys the controller: the process ends, the block (and so the tab, the
// terminal's stored output and the conversation) stays. The roster keeps a block with agent:sleeping set and no
// process as a sleeping agent. Waking restarts the block, forced, and clears the mark once the agent reports in.

// the side effects, as vars so tests script them without a store, a controller or a process
var (
	// readBlockMeta is a block's meta as the store holds it
	readBlockMeta = func(ctx context.Context, blockId string) (waveobj.MetaMapType, error) {
		block, err := wstore.DBMustGet[*waveobj.Block](ctx, blockId)
		if err != nil {
			return nil, fmt.Errorf("loading block %s: %w", blockId, err)
		}
		return block.Meta, nil
	}
	// updateBlockMeta merges meta into the block's (a nil value deletes a key) and tells the frontend
	updateBlockMeta = func(ctx context.Context, blockId string, meta waveobj.MetaMapType) error {
		oref := waveobj.MakeORef(waveobj.OType_Block, blockId)
		changed, err := wstore.UpdateObjectMeta(ctx, oref, meta, false)
		if err != nil {
			return fmt.Errorf("updating block %s: %w", blockId, err)
		}
		if changed {
			wcore.SendWaveObjUpdate(oref)
		}
		return nil
	}
	destroyBlock = blockcontroller.DestroyBlockController
	// resyncBlock restarts a block's process. nil runtime opts: the PTY starts at the block's stored size, and its
	// pane refits it (a zero size would start it at 0x0).
	resyncBlock = func(ctx context.Context, tabId, blockId string) error {
		return blockcontroller.ResyncController(ctx, tabId, blockId, nil, true)
	}
	latestStatus = orchestrate.LatestAgentStatus
	hasStream    = agentctl.Has
	// controllerExited reports whether a block's process is over, and its exit code (-1 when no controller is left
	// to say)
	controllerExited = func(blockId string) (bool, int) {
		rs := blockcontroller.GetBlockControllerRuntimeStatus(blockId)
		if rs == nil {
			return true, -1
		}
		if rs.ShellProcStatus == blockcontroller.Status_Done {
			return true, rs.ShellProcExitCode
		}
		return false, 0
	}
	// treePids is the pids of a block's process tree, nil when it has none
	treePids = func(blockId string) []int32 {
		root := consumerBlockPid(blockId)
		if root <= 0 {
			return nil
		}
		if table, err := consumerTable(); err == nil {
			if tree := table.Tree(int32(root)); tree != nil {
				return tree
			}
		}
		return []int32{int32(root)}
	}
	// pidsAlive is the pids of pids that still run
	pidsAlive = func(pids []int32) []int32 {
		var live []int32
		for _, pid := range pids {
			if ok, _ := process.PidExists(pid); ok {
				live = append(live, pid)
			}
		}
		return live
	}
	killPids = func(pids []int32) {
		for _, pid := range pids {
			if p, err := process.NewProcess(pid); err == nil {
				_ = p.Kill()
			}
		}
	}
	// pidStarted is when a running pid's process started (ms since the epoch), false when none runs under it. A pid
	// with another start time is another process that took the number after the first one ended.
	pidStarted = func(pid int32) (int64, bool) {
		p, err := process.NewProcess(pid)
		if err != nil {
			return 0, false
		}
		at, err := p.CreateTime()
		if err != nil {
			return 0, false
		}
		return at, true
	}
)

// how long sleep waits for a destroyed tree to be gone, how long for the pids it killed, and how often it looks;
// how long a wake waits for the agent to report in, how often it looks, and how long each of its closing meta writes
// may take. Vars so tests shorten them.
var (
	sleepStopWait     = 3 * time.Second
	sleepKillWait     = 2 * time.Second
	sleepPoll         = 100 * time.Millisecond
	wakeReadyTimeout  = 60 * time.Second
	wakePoll          = 500 * time.Millisecond
	wakeSettleTimeout = 10 * time.Second
)

// sleepMu keeps two sleeps (the loop's, a person's Sleep) from racing on one block.
var sleepMu sync.Mutex

// An agent asleep while pids of its old tree still run: they outlived its controller and a kill, most often a process
// still ending on a machine that pages hard (2026-11-26: two pids of a Claude tree took longer than the 5s, and undoing
// the sleep left the tab with no process and no Wake). Each pid is kept with its start time, so a wake ends only the
// process that slept and never one that took its number since.
var (
	leftoverMu sync.Mutex
	leftovers  = map[string]map[int32]int64{} // block id -> pid -> start time
)

// noteLeftovers records the pids of blockId's slept tree that still run, with their start times.
func noteLeftovers(blockId string, pids []int32) {
	started := map[int32]int64{}
	for _, pid := range pids {
		if at, ok := pidStarted(pid); ok {
			started[pid] = at
		}
	}
	leftoverMu.Lock()
	defer leftoverMu.Unlock()
	if len(started) == 0 {
		delete(leftovers, blockId)
		return
	}
	leftovers[blockId] = started
}

// liveLeftovers is the pids of blockId's slept tree that still run as the same processes, forgetting the block once
// none does.
func liveLeftovers(blockId string) []int32 {
	leftoverMu.Lock()
	defer leftoverMu.Unlock()
	var live []int32
	for pid, at := range leftovers[blockId] {
		if now, ok := pidStarted(pid); ok && now == at {
			live = append(live, pid)
		}
	}
	if len(live) == 0 {
		delete(leftovers, blockId)
	}
	slices.Sort(live)
	return live
}

// endLeftovers ends what still runs of blockId's slept tree before a wake starts a new process on its conversation, so
// two never write one transcript. An error names the pids that would not end.
func endLeftovers(blockId string) error {
	left := liveLeftovers(blockId)
	if len(left) == 0 {
		return nil
	}
	log.Printf("agent wake: block %s: ending pids %v left from its sleep\n", blockId, left)
	killPids(left)
	if left = pidsGone(left, sleepKillWait); len(left) > 0 {
		return fmt.Errorf("its old process (pids %v) is still ending; wake it again in a moment", left)
	}
	liveLeftovers(blockId)
	return nil
}

// sessionKey is what a harness's resume flag takes to reopen a conversation: Claude's session id is its
// transcript's file stem, pi takes the transcript path whole, and agy names its own conversation (its
// transcripts are all transcript_full.jsonl). "" when there is none yet, or the harness cannot resume.
func sessionKey(harness, transcriptPath, sessionID string) string {
	switch harness {
	case "claude":
		if i := strings.LastIndexAny(transcriptPath, `/\`); i >= 0 {
			transcriptPath = transcriptPath[i+1:]
		}
		return strings.TrimSuffix(transcriptPath, ".jsonl")
	case "pi":
		return transcriptPath
	case "agy":
		return sessionID
	}
	return ""
}

// backgroundWork names what an agent still has running that ending its process would kill: Claude shell tasks
// started in the background, and subagents that have not finished.
func backgroundWork(transcriptPath string) []string {
	background, subagents := runningWork(transcriptPath)
	return append(background, subagents...)
}

// runningWork is backgroundWork told apart: the shell tasks started in the background, then the subagents.
func runningWork(transcriptPath string) (background, subagents []string) {
	if transcriptPath == "" {
		return nil, nil
	}
	if lines, err := readTranscriptTail(transcriptPath, 2000); err == nil {
		background = agentsleep.BackgroundRunning(lines)
	}
	if subs, err := listSubagents(transcriptPath); err == nil {
		for _, sub := range subs {
			if sub.Done {
				continue
			}
			label := strings.Join(strings.Fields(sub.FirstPrompt), " ")
			if r := []rune(label); len(r) > 60 {
				label = string(r[:60]) + "…"
			}
			subagents = append(subagents, strings.TrimSpace("subagent "+label))
		}
	}
	return background, subagents
}

// treeBytes is the RAM the pids hold, as the Consumers panel measures it.
func treeBytes(pids []int32) uint64 {
	sampler := consumerSampler()
	if sampler.Footprint == nil {
		return 0
	}
	var sum uint64
	for _, pid := range pids {
		if n, ok := sampler.Footprint(pid); ok {
			sum += n
		}
	}
	return sum
}

// pidsGone waits up to wait for every pid to end and returns the ones still running.
func pidsGone(pids []int32, wait time.Duration) []int32 {
	deadline := time.Now().Add(wait)
	for {
		live := pidsAlive(pids)
		if len(live) == 0 || !time.Now().Before(deadline) {
			return live
		}
		time.Sleep(sleepPoll)
	}
}

// sleepRefusal is why a person's Sleep cannot apply to row, "" when it can. The time, the CPU and the
// not-looking-at-it conditions are the loop's: a person who chose Sleep has waived them.
func sleepRefusal(row *agentRow) error {
	switch {
	case row.State == wshrpc.AgentsState_Sleeping:
		return fmt.Errorf("agent %q is already asleep", row.Name)
	case row.RunId != "":
		return fmt.Errorf("agent %q works for run %s, which the engine owns; it cannot sleep", row.Name, row.RunId)
	case !agentsleep.Harnesses[row.Harness]:
		return fmt.Errorf("agent %q runs %s, which cannot resume a conversation; it cannot sleep", row.Name, row.Harness)
	case row.State != wshrpc.AgentsState_Idle || row.status.State != baseds.AgentState_Idle:
		what := row.State
		if row.status.State == baseds.AgentState_Waiting {
			what = "waiting for a permission"
		}
		return fmt.Errorf("agent %q is not idle (%s); only an idle agent can sleep", row.Name, what)
	}
	return nil
}

// sleepAgent puts an idle agent to sleep: its process ends and its RAM is freed, and its tab and conversation
// stay. Unless force is set, an agent with background work running is not slept; the work is returned in
// Background instead, for the person to confirm. A tree that has not ended once destroyed and killed still leaves the
// agent asleep, with its pids remembered for the wake to end (endLeftovers).
func sleepAgent(ctx context.Context, row *agentRow, force bool) (*wshrpc.CommandAgentsSleepRtnData, error) {
	// read the session before the controller goes: the exit publishes a bare idle with no transcript path
	tpath, err := agentTranscriptPath(ctx, row)
	if err != nil {
		return nil, err
	}
	session := sessionKey(row.Harness, tpath, row.status.SessionID)
	if session == "" {
		return nil, fmt.Errorf("agent %q has no session to resume yet; it cannot sleep", row.Name)
	}
	if !force {
		if work := backgroundWork(tpath); len(work) > 0 {
			return &wshrpc.CommandAgentsSleepRtnData{Background: work}, nil
		}
	}

	sleepMu.Lock()
	defer sleepMu.Unlock()
	meta, err := readBlockMeta(ctx, row.blockId)
	if err != nil {
		return nil, err
	}
	if metaMillis(meta, waveobj.MetaKey_AgentSleeping) > 0 {
		// a mark with a process still running is stale: a forced restart that was no wake left it (a Claude account
		// switch restarted sleeping agents, 2026-11-26), and refusing here failed the loop's sleep every minute
		if exited, _ := controllerExited(row.blockId); exited {
			return nil, fmt.Errorf("agent %q is already asleep", row.Name)
		}
		log.Printf("agent sleep: %q (block %s) runs with a stale sleeping mark; sleeping it over the mark\n", row.Name, row.blockId)
	}
	// a service's block holds no agent of its own: a Claude its process ran reported into it before ARC_SERVICE marked
	// that process, and sleeping it would stop the service (its supervisor sleeps and starts it)
	if meta.GetBool(waveobj.MetaKey_ToolService, false) {
		return nil, fmt.Errorf("%q is a service, not an agent; it cannot sleep", row.Name)
	}
	args, ok := blockcontroller.ResumeArgs(row.Harness, session, meta.GetStringList("agent:baseargs"))
	if !ok {
		return nil, fmt.Errorf("agent %q runs %s, which cannot resume a conversation; it cannot sleep", row.Name, row.Harness)
	}

	pids := treePids(row.blockId)
	freed := treeBytes(pids)
	err = updateBlockMeta(ctx, row.blockId, waveobj.MetaMapType{
		waveobj.MetaKey_CmdArgs:         args,
		waveobj.MetaKey_AgentSleeping:   time.Now().UnixMilli(),
		waveobj.MetaKey_AgentSleepFreed: int64(freed),
	})
	if err != nil {
		return nil, err
	}
	destroyBlock(row.blockId)

	// DestroyBlockController returns nothing, so the proof it worked is that its pids are gone
	left := pidsGone(pids, sleepStopWait)
	if len(left) > 0 {
		killPids(left)
		left = pidsGone(left, sleepKillWait)
	}
	if len(left) > 0 {
		// the controller is gone and cannot be brought back, so the agent stays asleep: undoing the marks left a tab with
		// no process and no Wake. What still runs is remembered, and the wake ends it before it starts a new process.
		log.Printf("agent sleep: %q (block %s) is asleep, but pids %v had not ended %s after its stop; its wake ends them\n",
			row.Name, row.blockId, left, sleepStopWait+sleepKillWait)
		noteLeftovers(row.blockId, left)
		if held := treeBytes(left); held < freed {
			freed -= held
		} else {
			freed = 0
		}
		mctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
		defer cancel()
		if err := updateBlockMeta(mctx, row.blockId, waveobj.MetaMapType{waveobj.MetaKey_AgentSleepFreed: int64(freed)}); err != nil {
			log.Printf("agent sleep: block %s: recording what its sleep freed: %v\n", row.blockId, err)
		}
	}
	return &wshrpc.CommandAgentsSleepRtnData{FreedBytes: freed}, nil
}

func (ws *WshServer) AgentsSleepCommand(ctx context.Context, data wshrpc.CommandAgentsSleepData) (*wshrpc.CommandAgentsSleepRtnData, error) {
	facts, err := loadAgentRosterFacts(ctx)
	if err != nil {
		return nil, err
	}
	target, err := resolveAgentTab(buildAgentRoster(facts), data.Tab)
	if err != nil {
		return nil, err
	}
	if err := sleepRefusal(target); err != nil {
		return nil, err
	}
	if rtn := sleepAfterCompaction(ctx, target, data.Force, time.Now()); rtn != nil {
		return rtn, nil
	}
	return sleepAgent(ctx, target, data.Force)
}

// sleepAfterCompaction starts the person's Sleep with a compaction when one pays off (agentsleep.CompactBeforeSleep),
// so waking the agent later reads a summary instead of the whole conversation. Background work is asked about first,
// as a sleep would; the sleep loop puts the agent to sleep once the summary lands. nil when the Sleep goes ahead as it
// is, sleepAgent reporting any trouble.
func sleepAfterCompaction(ctx context.Context, row *agentRow, force bool, now time.Time) *wshrpc.CommandAgentsSleepRtnData {
	if row.Harness != "claude" || !row.hasStream {
		return nil
	}
	if pc, ok := compactPending(row.blockId, now); ok {
		// a compaction is already on its way (the loop's, or a second click): this Sleep waits on it too
		pc.then, pc.force = agentsleep.SleepAfterPerson, pc.force || force
		setCompactPending(row.blockId, pc)
		return &wshrpc.CommandAgentsSleepRtnData{Compacting: true}
	}
	tpath, err := agentTranscriptPath(ctx, row)
	if err != nil || tpath == "" {
		return nil
	}
	lines, err := readTranscriptEnd(tpath, cacheTailBytes)
	if err != nil {
		return nil
	}
	c := agentsleep.Candidate{Harness: row.Harness, HasStream: true, Cache: agentsleep.ReadCacheState(lines)}
	c.CompactFailed = compactFailed(row.blockId, c.Cache.LastTurn)
	if !agentsleep.CompactBeforeSleep(c, now, currentSleepSettings()) {
		return nil
	}
	if !force {
		if work := backgroundWork(tpath); len(work) > 0 {
			return &wshrpc.CommandAgentsSleepRtnData{Background: work}
		}
	}
	if !sendCompact(row.blockId) {
		return nil
	}
	setCompactPending(row.blockId, pendingCompact{sent: now, then: agentsleep.SleepAfterPerson, force: force, turn: c.Cache.LastTurn})
	log.Printf("agent sleep: compacting %q (block %s) before the person's Sleep\n", row.Name, row.blockId)
	return &wshrpc.CommandAgentsSleepRtnData{Compacting: true}
}

// wakeCall is a wake in flight for a block: a second wake of it (a double click, a message sent while the
// first still waits) joins that one rather than restarting a process that is starting.
type wakeCall struct {
	done chan struct{}
	err  error // set before done is closed
}

var (
	wakeMu    sync.Mutex
	wakeCalls = map[string]*wakeCall{}
)

// wakeAgent relaunches a sleeping agent and waits for it to report in. With a message, the message is delivered
// once it has. A wake of a block already waking waits for that wake and then delivers its own message.
func wakeAgent(ctx context.Context, row *agentRow, message string, fresh bool) error {
	wakeMu.Lock()
	if call, ok := wakeCalls[row.blockId]; ok {
		wakeMu.Unlock()
		return joinWake(ctx, call, row.blockId, message)
	}
	call := &wakeCall{done: make(chan struct{})}
	wakeCalls[row.blockId] = call
	wakeMu.Unlock()

	call.err = runWake(ctx, row, message, fresh)
	wakeMu.Lock()
	delete(wakeCalls, row.blockId)
	wakeMu.Unlock()
	close(call.done)
	return call.err
}

// joinWake waits for a wake in flight and then delivers its own message.
func joinWake(ctx context.Context, call *wakeCall, blockId, message string) error {
	select {
	case <-call.done:
	case <-ctx.Done():
		return ctx.Err()
	}
	if call.err != nil {
		return call.err
	}
	if message != "" {
		deliverAgentMessage(blockId, message)
	}
	return nil
}

// wakeMarkedAwake is a wake of an agent whose process runs while its block still says asleep: a wake in flight (its
// process starts before it reports in), which it joins, or marks a wake could not clear, which it clears. The message
// is delivered as to any awake agent. The cockpit reads the marks, so without this the row reads asleep over a running
// agent and its Wake and its composer are refused.
func wakeMarkedAwake(ctx context.Context, row *agentRow, message string) error {
	wakeMu.Lock()
	call, waking := wakeCalls[row.blockId]
	wakeMu.Unlock()
	if waking {
		return joinWake(ctx, call, row.blockId, message)
	}
	err := updateBlockMeta(ctx, row.blockId, waveobj.MetaMapType{
		waveobj.MetaKey_AgentSleeping:   nil,
		waveobj.MetaKey_AgentSleepFreed: nil,
		waveobj.MetaKey_AgentWakeFailed: nil,
	})
	if err != nil {
		return err
	}
	if message != "" {
		deliverAgentMessage(row.blockId, message)
	}
	return nil
}

func runWake(ctx context.Context, row *agentRow, message string, fresh bool) error {
	// what happens after the wait must not die with a caller that gave up, and each write gets its own clock: one
	// started before the wait (up to wakeReadyTimeout) had run out by the time a slow resume reported in, which left
	// the marks on a running agent
	settle := func(meta waveobj.MetaMapType) error {
		sctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), wakeSettleTimeout)
		defer cancel()
		return updateBlockMeta(sctx, row.blockId, meta)
	}

	meta, err := readBlockMeta(ctx, row.blockId)
	if err != nil {
		return err
	}
	update := waveobj.MetaMapType{waveobj.MetaKey_AgentWakeFailed: nil}
	if fresh {
		// Start fresh: the launch flags without any session, so it does not resume the one that failed
		update[waveobj.MetaKey_CmdArgs] = blockcontroller.StripSessionArgs(row.Harness, meta.GetStringList("agent:baseargs"))
	}
	wokeAt := time.Now().UnixMilli()
	if err := updateBlockMeta(ctx, row.blockId, update); err != nil {
		return err
	}
	// failed keeps the agent asleep with the reason, which the card shows beside Start fresh and Close
	failed := func(reason string) error {
		if err := settle(waveobj.MetaMapType{waveobj.MetaKey_AgentWakeFailed: reason}); err != nil {
			log.Printf("agent wake: recording why block %s did not wake: %v\n", row.blockId, err)
		}
		return fmt.Errorf("agent %q: %s", row.Name, reason)
	}
	// awake clears the marks of an agent that is running even though it has not reported in
	awake := func() {
		err := settle(waveobj.MetaMapType{
			waveobj.MetaKey_AgentSleeping:   nil,
			waveobj.MetaKey_AgentSleepFreed: nil,
		})
		if err != nil {
			log.Printf("agent wake: clearing the sleep marks of block %s: %v\n", row.blockId, err)
		}
	}

	if err := endLeftovers(row.blockId); err != nil {
		return failed(err.Error())
	}
	if err := resyncBlock(ctx, row.TabId, row.blockId); err != nil {
		return failed(fmt.Sprintf("it could not start: %v", err))
	}
	secs := int(wakeReadyTimeout.Seconds())
	deadline := time.Now().Add(wakeReadyTimeout)
	for {
		// first, so that the bare idle a dying process publishes cannot read as the agent coming back
		if exited, code := controllerExited(row.blockId); exited {
			if code < 0 {
				return failed("it exited before it came back; its output is in the terminal")
			}
			return failed(fmt.Sprintf("it exited (code %d) before it came back; its output is in the terminal", code))
		}
		if latestStatus(row.blockId, row.TabId).Ts > wokeAt || hasStream(row.blockId) {
			break
		}
		if !time.Now().Before(deadline) {
			awake()
			if message != "" {
				return fmt.Errorf("agent %q did not come back within %ds; your message was not sent", row.Name, secs)
			}
			return fmt.Errorf("agent %q did not report in within %ds", row.Name, secs)
		}
		select {
		case <-time.After(wakePoll):
		case <-ctx.Done():
			awake()
			return fmt.Errorf("agent %q: the wake was interrupted before it reported in; it is running", row.Name)
		}
	}
	awake()
	if message != "" {
		deliverAgentMessage(row.blockId, message)
	}
	return nil
}

func (ws *WshServer) AgentsWakeCommand(ctx context.Context, data wshrpc.CommandAgentsWakeData) error {
	facts, err := loadAgentRosterFacts(ctx)
	if err != nil {
		return err
	}
	rows := buildAgentRoster(facts)
	target, err := resolveAgentTab(rows, data.Tab)
	if err != nil {
		return err
	}
	if target.State != wshrpc.AgentsState_Sleeping {
		if meta, err := readBlockMeta(ctx, target.blockId); err == nil && metaMillis(meta, waveobj.MetaKey_AgentSleeping) > 0 {
			return wakeMarkedAwake(ctx, target, strings.TrimSpace(data.Message))
		}
		// an agent whose process exited on its own (/exit, a crash) has nothing to type into either: its cmd:args
		// resume its session, so it comes back the way a sleeping one does, and the message is delivered once it
		// reports in. Chat sends here when typing into its terminal found no process.
		if exited, _ := controllerExited(target.blockId); exited {
			if err := heldElsewhere(rows, target); err != nil {
				return err
			}
			return wakeAgent(ctx, target, strings.TrimSpace(data.Message), false)
		}
		return fmt.Errorf("agent %q is not asleep", target.Name)
	}
	if !data.Fresh {
		if err := heldElsewhere(rows, target); err != nil {
			return err
		}
	}
	return wakeAgent(ctx, target, strings.TrimSpace(data.Message), data.Fresh)
}

// heldElsewhere refuses to wake a sleeping agent whose conversation another tab runs awake: the wake would start a
// second process writing the same transcript. The two came from before a resume looked for the tab holding its
// session; the person closes one.
func heldElsewhere(rows []agentRow, target *agentRow) error {
	want := sessionKey(target.Harness, target.status.TranscriptPath, target.status.SessionID)
	if want == "" {
		return nil
	}
	for i := range rows {
		row := &rows[i]
		if row.TabId == target.TabId || row.State == wshrpc.AgentsState_Sleeping || row.Harness != target.Harness {
			continue
		}
		if sessionKey(row.Harness, row.status.TranscriptPath, row.status.SessionID) == want {
			return fmt.Errorf("agent %q: its conversation is already open in %q (tab %s); go to that tab, or close this one", target.Name, row.Name, row.TabId)
		}
	}
	return nil
}

// the agents the frontend has on screen, as its last push said, and when it said so
type viewingPush struct {
	tabs []string
	at   time.Time
}

// viewingTTL is how long a push counts: the frontend repeats it while its window is up, so one older than this
// is a window that closed or a frontend that died, and the loop must not keep sparing agents on its word.
const viewingTTL = 3 * time.Minute

var (
	viewingMu sync.Mutex
	viewing   viewingPush
)

func (ws *WshServer) AgentsSetViewingCommand(ctx context.Context, data wshrpc.CommandAgentsSetViewingData) error {
	viewingMu.Lock()
	defer viewingMu.Unlock()
	viewing = viewingPush{tabs: slices.Clone(data.TabIds), at: time.Now()}
	return nil
}

// viewingTabs is the tab ids the frontend last said it shows, none when that was more than viewingTTL before now.
// The sleep loop never sleeps one of them.
func viewingTabs(now time.Time) map[string]bool {
	viewingMu.Lock()
	defer viewingMu.Unlock()
	if viewing.at.IsZero() || now.Sub(viewing.at) > viewingTTL {
		return nil
	}
	tabs := make(map[string]bool, len(viewing.tabs))
	for _, id := range viewing.tabs {
		tabs[id] = true
	}
	return tabs
}
