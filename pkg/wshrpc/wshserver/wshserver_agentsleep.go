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
)

// how long sleep waits for a destroyed tree to be gone, how long for the pids it killed, and how often it looks;
// how long a wake waits for the agent to report in, and how often it looks. Vars so tests shorten them.
var (
	sleepStopWait    = 3 * time.Second
	sleepKillWait    = 2 * time.Second
	sleepPoll        = 100 * time.Millisecond
	wakeReadyTimeout = 60 * time.Second
	wakePoll         = 500 * time.Millisecond
)

// sleepMu keeps two sleeps (the loop's, a person's Sleep) from racing on one block.
var sleepMu sync.Mutex

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
// Background instead, for the person to confirm. A tree that will not die is an error and the agent is left
// as it was, except that its process is gone.
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
		return nil, fmt.Errorf("agent %q is already asleep", row.Name)
	}
	args, ok := blockcontroller.ResumeArgs(row.Harness, session, meta.GetStringList("agent:baseargs"))
	if !ok {
		return nil, fmt.Errorf("agent %q runs %s, which cannot resume a conversation; it cannot sleep", row.Name, row.Harness)
	}

	pids := treePids(row.blockId)
	freed := treeBytes(pids)
	oldArgs := meta[waveobj.MetaKey_CmdArgs]
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
		log.Printf("agent sleep: %q (block %s) did not stop, pids %v still run\n", row.Name, row.blockId, left)
		// the controller is gone and cannot be brought back: undo the sleep marks so the row is not a sleeping
		// agent holding a process
		undo, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
		defer cancel()
		if uerr := updateBlockMeta(undo, row.blockId, waveobj.MetaMapType{
			waveobj.MetaKey_CmdArgs:         oldArgs, // nil when it had none: a delete
			waveobj.MetaKey_AgentSleeping:   nil,
			waveobj.MetaKey_AgentSleepFreed: nil,
		}); uerr != nil {
			log.Printf("agent sleep: restoring block %s after a failed sleep: %v\n", row.blockId, uerr)
		}
		return nil, fmt.Errorf("agent %q did not stop (pids %v); it was not put to sleep", row.Name, left)
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
	return sleepAgent(ctx, target, data.Force)
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
		select {
		case <-call.done:
		case <-ctx.Done():
			return ctx.Err()
		}
		if call.err != nil {
			return call.err
		}
		if message != "" {
			deliverAgentMessage(row.blockId, message)
		}
		return nil
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

func runWake(ctx context.Context, row *agentRow, message string, fresh bool) error {
	// what happens after the wait must not die with a caller that gave up
	settle, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
	defer cancel()

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
		if err := updateBlockMeta(settle, row.blockId, waveobj.MetaMapType{waveobj.MetaKey_AgentWakeFailed: reason}); err != nil {
			log.Printf("agent wake: recording why block %s did not wake: %v\n", row.blockId, err)
		}
		return fmt.Errorf("agent %q: %s", row.Name, reason)
	}
	// awake clears the marks of an agent that is running even though it has not reported in
	awake := func() {
		err := updateBlockMeta(settle, row.blockId, waveobj.MetaMapType{
			waveobj.MetaKey_AgentSleeping:   nil,
			waveobj.MetaKey_AgentSleepFreed: nil,
		})
		if err != nil {
			log.Printf("agent wake: clearing the sleep marks of block %s: %v\n", row.blockId, err)
		}
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
	target, err := resolveAgentTab(buildAgentRoster(facts), data.Tab)
	if err != nil {
		return err
	}
	if target.State != wshrpc.AgentsState_Sleeping {
		return fmt.Errorf("agent %q is not asleep", target.Name)
	}
	return wakeAgent(ctx, target, strings.TrimSpace(data.Message), data.Fresh)
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
