// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"os"
	"strings"
	"time"

	"github.com/shirou/gopsutil/v4/process"
	"github.com/wavetermdev/waveterm/pkg/agentask"
	"github.com/wavetermdev/waveterm/pkg/agentsessions"
	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/blockcontroller"
	"github.com/wavetermdev/waveterm/pkg/harness"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/memusage"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/workercap"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// StallThreshold is how long a running child may go without a transcript write before the engine flags
// it stalled. A headless worker writes its session on every token, so silence this long means the
// child is not progressing (provider hang, dead process) — and nothing else ever notices.
const StallThreshold = 15 * time.Minute

// TurnEndedGrace is how long a worker may sit idle after its turn ends, with its run still open, before the
// engine stops counting it as working. Its `wsh jarvis complete` lands before the Stop hook fires, so this only
// covers an auto-compaction's brief idle inside a turn and hook delivery lag.
const TurnEndedGrace = 3 * time.Minute

// IdleCPUShare is the share of one core a worker's process tree must use between two samples to count as
// working. An idle claude at its prompt still ticks (about 0.5% of a core, measured 2026-09-24), so counting
// any change kept a finished worker "working" forever; a build or a test run is far above this.
const IdleCPUShare = 0.05

// FirstTokenDeadline is how long a running child may go having written NOTHING before the engine
// treats it as dead. It is separate from StallThreshold because the two measure different things:
// StallThreshold ages a transcript that stopped growing, and a child that never wrote one has no
// such clock. Shorter, because "no first token yet" resolves within seconds in the healthy case —
// the pathological one is a provider hang, where every extra minute is wasted wall time. Armed only
// for the runtimes in firstTokenRuntimes.
const FirstTokenDeadline = 5 * time.Minute

// spawnTs is when a child run started working: the earliest StartedTs across its phases. It is the
// only clock available for a child that has produced no transcript at all.
func spawnTs(run *waveobj.Run) int64 {
	if run == nil {
		return 0
	}
	var earliest int64
	for _, p := range run.Phases {
		if p.StartedTs > 0 && (earliest == 0 || p.StartedTs < earliest) {
			earliest = p.StartedTs
		}
	}
	return earliest
}

// sessionsRootFor resolves a worker runtime's transcript root (a var so tests can point the lookup at a
// temp dir). agentsessions owns where every runtime writes, so liveness asks it rather than keeping a
// second copy of those paths.
var sessionsRootFor = agentsessions.SessionRoot

// livenessRuntimes are the worker runtimes whose transcript reads as a heartbeat: an append-only JSONL
// named by the session id the worker was launched with, so the file's mtime is progress.
// agy's transcript is named by the conversation id agy assigned itself, which arrives late (see
// NoteWorkerSession); until then a tracked agy child has no path.
var livenessRuntimes = map[string]bool{"claude": true, "pi": true, "agy": true}

// firstTokenRuntimes are the runtimes whose transcript is written per event, which is the only thing
// that makes "has written nothing yet" mean hung. claude is deliberately absent: in the 2026-09-05
// live run all four children wrote no transcript at all for their entire successful lifetime, two of
// them past this deadline while committing correct work, so arming it there is a per-task coin flip
// that retries and discards a finished worktree. Re-measured 2026-10-06 over the packaged app's 618
// claude children: 611 wrote one within 15 seconds of spawn and none later, so that run is the
// exception, not the rule. It is still a real one: a claude that inherits CLAUDE_CODE_CHILD_SESSION
// (a dev app started from an agent's shell) persists nothing. So a claude that never starts is caught
// by its process instead: workerStuckStarting and workerControllerGone.
// The StallThreshold path is unaffected — it needs a transcript to exist before it can age one.
//
// agy is armed for a different reason than pi: its worker has no session id until its first hook reports
// one, so an agy that is alive but never got that far (stuck in onboarding or signed out) is otherwise
// invisible — the process runs, nothing is written, and no other check fires. It stalls at the deadline
// and hungWake names it.
var firstTokenRuntimes = map[string]bool{"pi": true, "agy": true}

// firstTokenArmed reports whether a child may be judged by the first-token deadline, resolving an
// empty runtime the same way lastActivityForRun does.
func firstTokenArmed(run *waveobj.Run) bool {
	if run == nil {
		return false
	}
	runtime := run.Runtime
	if runtime == "" {
		runtime = defaultWorkerRuntime
	}
	return firstTokenRuntimes[runtime]
}

// defaultWorkerRuntime mirrors runroute.DefaultRuntime: a child run persisted before the
// route carried a runtime ran claude.
const defaultWorkerRuntime = "claude"

// lastActivityForRun returns the newest write time of the child's own worker transcript (the heartbeat a
// headless agent actually emits) and whether the child is observable at all. A false second return means
// there is no activity source: the caller must report freshness unknown rather than age a frozen
// timestamp into a stall, because a wrong stall verdict costs the lead a retry that kills live work while
// a missed one only costs a timeout. The transcript is the one named by the session id the child was
// launched with, so siblings sharing a cwd never refresh each other's heartbeat, and a child spawned
// before workers carried a session id is unobservable. A dag child runs in its ProjectPath.
func lastActivityForRun(run *waveobj.Run) (int64, bool) {
	path, _, tracked := transcriptForRun(run)
	if !tracked {
		return 0, false
	}
	if path == "" {
		return 0, true
	}
	info, err := os.Stat(path)
	if err != nil {
		return 0, true
	}
	return info.ModTime().UnixMilli(), true
}

// transcriptForRun is the child's own worker transcript and the runtime that wrote it. tracked is false for a child
// with no readable transcript at all; path is "" while a tracked child has written none yet.
func transcriptForRun(run *waveobj.Run) (path, runtime string, tracked bool) {
	if run == nil {
		return "", "", false
	}
	runtime = run.Runtime
	if runtime == "" {
		runtime = defaultWorkerRuntime
	}
	if run.SessionId == "" {
		// an agy worker names its own conversation, so it has no id until its first status report: tracked,
		// with nothing written yet, rather than unobservable. Any other runtime without an id predates
		// session ids.
		if spec, ok := harness.Lookup(runtime); ok && spec.AssignsOwnSession && livenessRuntimes[runtime] {
			return "", runtime, true
		}
		return "", "", false
	}
	if !livenessRuntimes[runtime] {
		return "", "", false
	}
	root := sessionsRootFor(runtime)
	if root == "" {
		return "", "", false
	}
	return agentsessions.TranscriptForSession(root, runtime, run.ProjectPath, run.SessionId), runtime, true
}

// workerBlockFn reads a child's worker block and whether its process runs. A var so tests can script the
// worker without a live block.
var workerBlockFn = readWorkerBlock

func readWorkerBlock(ctx context.Context, run *waveobj.Run) (string, bool) {
	if run == nil {
		return "", false
	}
	tabId := runTabID(run)
	if tabId == "" {
		return "", false
	}
	tab, err := wstore.DBGet[*waveobj.Tab](ctx, tabId)
	if err != nil || tab == nil || len(tab.BlockIds) == 0 {
		return "", false
	}
	blockId := tab.BlockIds[0]
	return blockId, blockRunning(blockId)
}

// blockShellStatus is a block's shell process status, "" when it has no controller. Var so tests need no
// real block controller.
var blockShellStatus = func(blockId string) string {
	if rs := blockcontroller.GetBlockControllerRuntimeStatus(blockId); rs != nil {
		return rs.ShellProcStatus
	}
	return ""
}

// blockRunning reports whether the block's shell process is running. A block still starting is not.
func blockRunning(blockId string) bool {
	return blockShellStatus(blockId) == blockcontroller.Status_Running
}

// treeSample is one reading of a worker's whole process tree: the CPU time (ms) used so far and the resident
// memory now.
type treeSample struct {
	CPUMs int64
	RSS   uint64
}

// childTreeSample reads a block's process tree, and whether a reading exists. A var so tests can script it.
var childTreeSample = sampleChildTree

// observeWorkerRSS feeds the worker-capacity estimate (pkg/workercap). A var so tests can capture it.
var observeWorkerRSS = workercap.Observe

func sampleChildTree(blockId string) (treeSample, bool) {
	pid := blockcontroller.GetBlockControllerPid(blockId)
	if pid <= 0 {
		return treeSample{}, false
	}
	root, err := process.NewProcess(int32(pid))
	if err != nil {
		return treeSample{}, false
	}
	var totalSec float64
	var rss uint64
	// one walk for both: listing the tree is the costly part (on darwin Children() reads every process)
	for _, p := range memusage.ProcessTree(root) {
		if times, err := p.Times(); err == nil {
			totalSec += times.User + times.System
		}
		if m, err := p.MemoryInfo(); err == nil {
			rss += m.RSS
		}
	}
	return treeSample{CPUMs: int64(totalSec * 1000), RSS: rss}, true
}

// cpuSampleEvery is the least time between two CPU readings of a worker: event-driven Schedule calls land
// seconds apart, and a delta over a few seconds says little. A var so tests that tick back to back can zero it.
var cpuSampleEvery = 20 * time.Second

// BusyWindow is how recent a busy CPU sample must be for status to call a worker busy: two sample intervals,
// so one skipped sample doesn't flip a busy worker to idle.
const BusyWindow = 2 * 20 * time.Second

// MaxLatestToolLen bounds the in-progress tool call a task carries.
const MaxLatestToolLen = 80

// cpuVerdict is what one sampleWorkerCPU call showed.
type cpuVerdict int

const (
	cpuNone cpuVerdict = iota
	cpuSkipped
	cpuBaseline
	cpuBusy
	cpuIdle
)

// sampleWorkerCPU reads the worker's process-tree CPU at most once per cpuSampleEvery and says what it showed.
// cpuSkipped means too soon since the last reading; cpuBaseline, a first reading with nothing to compare; cpuNone,
// no worker or no reading. A worker sitting in a foreground test run writes no transcript for as long as the run
// lasts, so the mtime cannot see it; this can. A first reading defers the stall verdict a tick rather than
// guessing it: a wrong stall costs a retry that kills live work, a late one costs a tick. A total that fell counts
// as busy, because a child that finished and exited lowers the tree's sum; a rise counts only above IdleCPUShare,
// because an idle harness at its prompt still ticks.
func sampleWorkerCPU(ctx context.Context, t *waveobj.TaskNode, run *waveobj.Run, now int64) cpuVerdict {
	if t.CPUSampleTs > 0 && now-t.CPUSampleTs < cpuSampleEvery.Milliseconds() {
		return cpuSkipped
	}
	blockId, alive := workerBlockFn(ctx, run)
	if !alive {
		return cpuNone
	}
	s, ok := childTreeSample(blockId)
	if !ok {
		return cpuNone
	}
	observeWorkerRSS(blockId, s.RSS)
	cpu := s.CPUMs
	prev, prevTs := t.CPUSample, t.CPUSampleTs
	t.CPUSample, t.CPUSampleTs = cpu, now
	if prevTs == 0 {
		return cpuBaseline
	}
	if delta := cpu - prev; delta < 0 || (delta > 0 && float64(delta) >= IdleCPUShare*float64(now-prevTs)) {
		t.BusyTs = now
		return cpuBusy
	}
	return cpuIdle
}

// workerLatestTool is the tool call a worker has in progress, from its latest status: the PreToolUse hook (claude)
// and the status extension (pi) report working with a detail, and PostToolUse reports working without one.
var workerLatestTool = func(ctx context.Context, run *waveobj.Run) string {
	blockId, alive := workerBlockFn(ctx, run)
	if blockId == "" || !alive {
		return ""
	}
	st := LatestAgentStatus(blockId, runTabID(run))
	if st.State != baseds.AgentState_Working {
		return ""
	}
	// a byte cut can split a rune
	return strings.ToValidUTF8(truncateText(st.Detail, MaxLatestToolLen), "")
}

// workerControllerGone is readWorkerGone, a var so tests can script it.
var workerControllerGone = readWorkerGone

// SetWorkerGoneForTest stubs the worker-gone check for tests whose fixture workers have no tab.
func SetWorkerGoneForTest(fn func(context.Context, *waveobj.Run) bool) func() {
	old := workerControllerGone
	workerControllerGone = fn
	return func() { workerControllerGone = old }
}

// readWorkerGone reports whether a child's worker can no longer be running: its tab is deleted, or its
// block is in the store with no controller. A machine restart leaves the second. An exit nothing heard
// leaves the first, because an exited worker's tab closes itself: run d8fe96ab's t-2 died a second after
// its spawn and its exit failed nothing (most likely it beat the tick's owner stamp on its tab, so the exit
// hook resolved no run), and the task read running for 15 minutes. A run records its worker's tab only once
// the tab exists, so a missing one was deleted. An unresolvable worker (a run without a tab, an unreadable store) is
// not gone, only unknown.
func readWorkerGone(ctx context.Context, run *waveobj.Run) bool {
	if run == nil {
		return false
	}
	tabId := runTabID(run)
	if tabId == "" {
		return false
	}
	tab, err := wstore.DBGet[*waveobj.Tab](ctx, tabId)
	if err != nil {
		return false
	}
	if tab == nil {
		return true
	}
	if len(tab.BlockIds) == 0 {
		return false
	}
	return blockcontroller.GetBlockControllerRuntimeStatus(tab.BlockIds[0]) == nil
}

// childStillOpen re-reads a child run and reports whether it is still working. Its `wsh jarvis complete`
// lands just before its process exits, so the snapshot a tick loaded can be older than the exit it judges.
func childStillOpen(ctx context.Context, channelId, runID string) bool {
	fresh, err := wstore.GetRun(ctx, channelId, runID)
	return err == nil && (fresh.Status == jarvis.RunStatus_Executing || fresh.Status == jarvis.RunStatus_Planning)
}

// workerTurnEndedAt is when a worker last reported its turn over (the Stop hook's idle), 0 while its latest
// report is anything else, it has none, or its process is gone: the exit path publishes idle too, and a dead
// worker is not sitting at a prompt with finished work. A var so tests can script it.
var workerTurnEndedAt = func(ctx context.Context, run *waveobj.Run) int64 {
	blockId, alive := workerBlockFn(ctx, run)
	if blockId == "" || !alive {
		return 0
	}
	st := LatestAgentStatus(blockId, runTabID(run))
	if st.State != baseds.AgentState_Idle {
		return 0
	}
	return st.Ts
}

// turnEndedPast reports a worker idle at its prompt for longer than TurnEndedGrace.
func turnEndedPast(ctx context.Context, run *waveobj.Run, now int64) bool {
	ended := workerTurnEndedAt(ctx, run)
	return ended > 0 && now-ended > TurnEndedGrace.Milliseconds()
}

// workerStuckStarting reports whether a child's worker block has a controller whose shell never came up.
// Nothing else catches it for claude: no process means no exit hook, no transcript means no stall clock,
// and the first-token deadline is off for claude. Run 700db496's t-5 sat like this for 45 minutes. A
// child doing real work has a process, so this cannot fire on the silent-but-working case that keeps the
// deadline off.
func workerStuckStarting(ctx context.Context, run *waveobj.Run) bool {
	blockId, _ := workerBlockFn(ctx, run)
	return shellStuckStarting(blockId)
}

func shellStuckStarting(blockId string) bool {
	return blockId != "" && blockShellStatus(blockId) == blockcontroller.Status_Init
}

// workerAsking reports a worker with a question open in the registry.
func workerAsking(ctx context.Context, run *waveobj.Run) bool {
	blockId, _ := workerBlockFn(ctx, run)
	if blockId == "" {
		return false
	}
	_, asking := agentask.GlobalRegistry.Get(waveobj.MakeORef(waveobj.OType_Block, blockId).String())
	return asking
}

// hungWake is the judgment line for a task that just stalled, or "" when its worker is waiting on an answer,
// which belongs to the question queue. Every other stalled worker is the lead's: one whose process never
// started, one whose process is gone while its task still runs (the exit path missed it), one idle at its
// prompt with its run still open, and one alive and silent.
func hungWake(ctx context.Context, taskID string, run *waveobj.Run, silentMs int64) string {
	blockId, alive := workerBlockFn(ctx, run)
	if !alive {
		if shellStuckStarting(blockId) {
			return taskNeverStartedWake(taskID, silentMs/time.Minute.Milliseconds())
		}
		return taskWorkerGoneWake(taskID)
	}
	if _, asking := agentask.GlobalRegistry.Get(waveobj.MakeORef(waveobj.OType_Block, blockId).String()); asking {
		return ""
	}
	if workerTurnEndedAt(ctx, run) > 0 {
		return taskTurnEndedWake(taskID)
	}
	return taskHungWake(taskID, silentMs/time.Minute.Milliseconds())
}
