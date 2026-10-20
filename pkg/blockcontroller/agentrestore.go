// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package blockcontroller

import (
	"context"
	"log"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// Bringing hand-launched agents back after the server restarts. An update or a crash kills wavesrv outright, and
// nothing else restarts an agent: its terminal starts when its pane first fits, the pane mounts only for an agent on
// the roster, and the roster lists only agents with a status, which only a running agent reports. So no agent left
// running ever came back on its own.
//
// An agent block carries agent:live while this server runs its process: set when the process starts, cleared when
// it exits on its own. The next boot relaunches each block still marked, through the session key resume-on-reopen
// baked into its cmd:args (frontend agentresumestore.ts), so the agent reattaches to its session rather than
// replaying its task. Tabs left by older restarts carry no mark and stay as they are.
//
// A restart also cuts off the turn an agent was in. agent:inturn records, as its status changes, that a tracked agent
// is mid-turn; the boot relaunches such an agent with restoreNudge as its first turn, so it carries on with its work
// instead of waiting at its prompt for someone to type "continue".

// MetaKey_AgentLive holds a token unique to the process start that set it, so the exit of a replaced process
// cannot clear the mark its successor set.
const MetaKey_AgentLive = "agent:live"

// MetaKey_AgentInTurn is true while a tracked agent is mid-turn: working, waiting on a permission, or asking.
const MetaKey_AgentInTurn = "agent:inturn"

// restoreNudge is the first turn of an agent the boot brings back mid-turn.
const restoreNudge = "The app restarted while you were working, and your process stopped with it. Check the working tree and your last steps, then carry on where you left off. If you were waiting on the person, for a permission or an answer, ask again."

// restoreNudgeTTL bounds how long after the boot queued a nudge a start still takes it: the restore's own start
// comes within moments, and a start long after (a pane mounting once the restore's start failed) is not that turn.
const restoreNudgeTTL = time.Minute

// a run's worker: it comes back through its run's Resume or the engine, never here
const metaKeyAgentRunId = "agent:runid"

// restoreAgentStagger spaces the boot's relaunches so a restart does not start every agent at once. A var so tests
// can shorten it.
var restoreAgentStagger = 300 * time.Millisecond

// the flag each harness's resume key sits behind, first in cmd:args (launch.ts resumeArgsFor*)
// codex resumes through a subcommand, `codex resume <id>`, which sits where the others put their flag
var agentResumeFlags = map[string]string{"claude": "--resume", "opencode": "-s", "pi": "--session", "agy": "--conversation", "codex": "resume"}

// what a launch's own args may already say about a session, which must not stack under the one a resume adds: the
// flags that take a value, and the bare ones (launch.ts resumeArgsFor*, which this mirrors)
var agentStaleSessionFlags = map[string]struct{ withValue, bare map[string]bool }{
	"claude":   {map[string]bool{"--resume": true}, map[string]bool{"--continue": true}},
	"opencode": {map[string]bool{"-s": true, "--session": true}, map[string]bool{"-c": true, "--continue": true}},
	"pi":       {map[string]bool{"--session": true}, nil},
	"agy":      {map[string]bool{"--conversation": true}, map[string]bool{"-c": true, "--continue": true}},
}

// ResumeArgs is cmd:args that reopen session in a harness: its resume flag and the session first, then the launch
// flags (baseArgs, never the task prompt) with any session of their own dropped. The flag and session lead because
// shouldRestoreAgent bakes on args[0] and args[1], so a woken agent comes back after a crash or an update. False
// when the harness has no resume flag or session is empty.
func ResumeArgs(harness, session string, baseArgs []string) ([]string, bool) {
	flag, ok := agentResumeFlags[harness]
	if !ok || session == "" {
		return nil, false
	}
	return append([]string{flag, session}, StripSessionArgs(harness, baseArgs)...), true
}

// StripSessionArgs is args without any session the harness's launch flags already name. Never nil, so a caller
// writing it into block meta writes an empty list, not a delete.
func StripSessionArgs(harness string, args []string) []string {
	stale := agentStaleSessionFlags[harness]
	kept := make([]string, 0, len(args))
	for i := 0; i < len(args); i++ {
		switch a := args[i]; {
		case stale.withValue[a]:
			if hasFlagValue(args, i) {
				i++ // its value too
			}
		case stale.bare[a]:
		default:
			kept = append(kept, a)
		}
	}
	return kept
}

// hasFlagValue reports whether the flag at args[i] has its value after it. A bare `claude --resume` opens claude's own
// picker, and what follows it is the next flag, not a session.
func hasFlagValue(args []string, i int) bool {
	return i+1 < len(args) && !strings.HasPrefix(args[i+1], "-")
}

// agentAsleep reports whether a block's agent was put to sleep: its controller is gone on purpose, and a server
// relaunch leaves it so.
func agentAsleep(meta waveobj.MetaMapType) bool {
	return meta.GetFloat(waveobj.MetaKey_AgentSleeping, 0) > 0
}

// Pure: whether a block runs a hand-launched agent whose session can be resumed, so its process is marked live.
func tracksAgentLive(meta waveobj.MetaMapType) bool {
	if meta.GetString(waveobj.MetaKey_Controller, "") != BlockController_Cmd || meta.GetString(metaKeyAgentRunId, "") != "" {
		return false
	}
	_, ok := agentResumeFlags[meta.GetString(waveobj.MetaKey_Cmd, "")]
	return ok
}

// Pure: whether a block the last server left running comes back at boot. Only one whose session key is already in
// its cmd:args: before that, its args still hold the task prompt, and a relaunch would run the task again.
func shouldRestoreAgent(meta waveobj.MetaMapType) bool {
	if meta.GetString(MetaKey_AgentLive, "") == "" || !tracksAgentLive(meta) {
		return false
	}
	return restoreSession(meta) != ""
}

// Pure: the session a block's cmd:args resume, after its harness's resume flag; "" for none, a bare --resume among
// them (claude's picker, which names no session).
func restoreSession(meta waveobj.MetaMapType) string {
	args := meta.GetStringList(waveobj.MetaKey_CmdArgs)
	flag := agentResumeFlags[meta.GetString(waveobj.MetaKey_Cmd, "")]
	if len(args) < 2 || args[0] != flag || !hasFlagValue(args, 0) {
		return ""
	}
	return args[1]
}

// Pure: whether an exited process clears its block's live mark. Not while the server is quitting, which kills
// every agent: those are the ones the next boot brings back.
func shouldClearAgentLive(current, token string, shuttingDown bool) bool {
	return token != "" && current == token && !shuttingDown
}

// Pure: whether a reported state is mid-turn. ok is false for a report with no state (a usage snapshot), which says
// nothing about the turn.
func inTurnForState(state string) (inTurn, ok bool) {
	switch state {
	case baseds.AgentState_Working, baseds.AgentState_Waiting, baseds.AgentState_Asking:
		return true, true
	case baseds.AgentState_Idle:
		return false, true
	}
	return false, false
}

// Pure: cmd:args with nudge as the harness's opening prompt, where a launch puts its task (launch.ts
// buildLaunchMeta): last, behind -i for agy. False for a harness whose positional arg is no prompt (opencode's is a
// project directory).
func withRestoreNudge(harness string, args []string, nudge string) ([]string, bool) {
	switch harness {
	case "claude", "pi", "codex":
		return append(slices.Clone(args), nudge), true
	case "agy":
		return append(slices.Clone(args), "-i", nudge), true
	}
	return args, false
}

type pendingNudge struct {
	at   time.Time
	text string
}

// pendingNudges holds each block's queued nudge and when it was queued, which its next start takes once.
var pendingNudges = struct {
	sync.Mutex
	m map[string]pendingNudge
}{m: map[string]pendingNudge{}}

func queueNudge(blockId, text string, now time.Time) {
	pendingNudges.Lock()
	defer pendingNudges.Unlock()
	pendingNudges.m[blockId] = pendingNudge{at: now, text: text}
}

func queueRestoreNudge(blockId string, now time.Time) {
	queueNudge(blockId, restoreNudge, now)
}

// QueueStartNudge makes text the first turn of the block's next start, the way the boot nudges a restored agent:
// for a respawn that cuts a turn short, such as a Claude account switch's resume. "" queues nothing.
func QueueStartNudge(blockId, text string) {
	if text == "" {
		return
	}
	queueNudge(blockId, text, time.Now())
}

// DropStartNudge forgets a queued nudge whose start failed.
func DropStartNudge(blockId string) {
	takeNudge(blockId, time.Now())
}

// takeNudge is the nudge a block's start owes, "" for none, forgetting it either way.
func takeNudge(blockId string, now time.Time) string {
	pendingNudges.Lock()
	defer pendingNudges.Unlock()
	n, ok := pendingNudges.m[blockId]
	delete(pendingNudges.m, blockId)
	if !ok || now.Sub(n.at) >= restoreNudgeTTL {
		return ""
	}
	return n.text
}

// takeRestoreNudge reports whether a block's start owes a queued nudge, forgetting it either way.
func takeRestoreNudge(blockId string, now time.Time) bool {
	return takeNudge(blockId, now) != ""
}

// restoreStartArgs is the cmd:args a start runs: with the nudge when one is queued for this block. Only the
// process gets it; the block keeps its plain resume, so a later relaunch does not repeat it.
func restoreStartArgs(blockId string, meta waveobj.MetaMapType, args []string) []string {
	nudge := takeNudge(blockId, time.Now())
	if nudge == "" {
		return args
	}
	nudged, ok := withRestoreNudge(meta.GetString(waveobj.MetaKey_Cmd, ""), args, nudge)
	if !ok {
		return args
	}
	return nudged
}

// inTurnNoted is the in-turn mark each block holds as far as this server knows, so a turn's stream of working
// reports reads and writes the store once, not once a tool. Held across the store write so reports cannot land
// their writes out of order.
var inTurnNoted = struct {
	sync.Mutex
	m map[string]bool
}{m: map[string]bool{}}

// NoteAgentState keeps a tracked agent's in-turn mark in step with a state its reporter sent.
func NoteAgentState(blockId, state string) {
	inTurn, ok := inTurnForState(state)
	if !ok || blockId == "" {
		return
	}
	// a quit's last reports (a SessionEnd) must not clear the mark the next boot nudges from
	if !inTurn && shuttingDown.Load() {
		return
	}
	inTurnNoted.Lock()
	defer inTurnNoted.Unlock()
	if prev, seen := inTurnNoted.m[blockId]; seen && prev == inTurn {
		return
	}
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	block, err := wstore.DBGet[*waveobj.Block](ctx, blockId)
	if err != nil || block == nil {
		return
	}
	if !tracksAgentLive(block.Meta) || block.Meta.GetBool(MetaKey_AgentInTurn, false) == inTurn {
		inTurnNoted.m[blockId] = inTurn
		return
	}
	var value any // nil deletes the key
	if inTurn {
		value = true
	}
	oref := waveobj.MakeORef(waveobj.OType_Block, blockId)
	if _, err := wstore.UpdateObjectMeta(ctx, oref, waveobj.MetaMapType{MetaKey_AgentInTurn: value}, false); err != nil {
		log.Printf("marking agent block %s in turn %v: %v\n", blockId, inTurn, err)
		return
	}
	inTurnNoted.m[blockId] = inTurn
}

// markAgentLive marks a just-started agent process and returns its token, "" when the block is not tracked.
func markAgentLive(blockId string, meta waveobj.MetaMapType) string {
	if !tracksAgentLive(meta) {
		return ""
	}
	token := strconv.FormatInt(time.Now().UnixNano(), 10)
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	oref := waveobj.MakeORef(waveobj.OType_Block, blockId)
	if _, err := wstore.UpdateObjectMeta(ctx, oref, waveobj.MetaMapType{MetaKey_AgentLive: token}, false); err != nil {
		log.Printf("marking agent block %s live: %v\n", blockId, err)
		return ""
	}
	return token
}

// clearAgentLive removes the marks an agent process set, once that process has exited on its own: live, and
// in turn, since a turn ends with its process.
func clearAgentLive(blockId, token string) {
	if token == "" {
		return
	}
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	block, err := wstore.DBGet[*waveobj.Block](ctx, blockId)
	if err != nil || block == nil {
		return // closed with its tab
	}
	if !shouldClearAgentLive(block.Meta.GetString(MetaKey_AgentLive, ""), token, shuttingDown.Load()) {
		return
	}
	inTurnNoted.Lock()
	defer inTurnNoted.Unlock()
	delete(inTurnNoted.m, blockId)
	oref := waveobj.MakeORef(waveobj.OType_Block, blockId)
	if _, err := wstore.UpdateObjectMeta(ctx, oref, waveobj.MetaMapType{MetaKey_AgentLive: nil, MetaKey_AgentInTurn: nil}, false); err != nil {
		log.Printf("clearing agent block %s live mark: %v\n", blockId, err)
	}
}

// restartAgentBlock starts one restored agent. A var so tests can stub it.
var restartAgentBlock = func(ctx context.Context, tabId, blockId string) error {
	// nil runtime opts: the PTY starts at the block's stored size, and its pane refits it when it mounts
	return ResyncController(ctx, tabId, blockId, nil, false)
}

// Pure: whether a restored agent's relaunch carries restoreNudge: the last server's process was mid-turn.
func shouldNudgeRestore(meta waveobj.MetaMapType) bool {
	return meta.GetBool(MetaKey_AgentInTurn, false)
}

type restoreAgent struct {
	blockId string
	nudge   bool
	session string // the harness and the session its cmd:args resume
	started int64  // when the last server started its process: its live mark
}

// Pure: one block to restore per session, and the rest. Two tabs on one conversation would run two processes writing
// one transcript: the one cut off mid-turn comes back, else the one started last. Order is kept.
func onePerSession(rs []restoreAgent) (keep, extra []restoreAgent) {
	best := map[string]restoreAgent{}
	for _, r := range rs {
		cur, ok := best[r.session]
		if !ok || r.nudge && !cur.nudge || r.nudge == cur.nudge && r.started > cur.started {
			best[r.session] = r
		}
	}
	for _, r := range rs {
		if best[r.session].blockId == r.blockId {
			keep = append(keep, r)
		} else {
			extra = append(extra, r)
		}
	}
	return keep, extra
}

// RestoreLiveAgents relaunches, one at a time, every agent the last server left running, nudging those it left
// mid-turn to carry on. Every mark is cleared first: it belonged to the last server's processes, and a relaunch sets
// its own.
func RestoreLiveAgents(ctx context.Context) {
	blocks, err := wstore.DBGetAllObjsByType[*waveobj.Block](ctx, waveobj.OType_Block)
	if err != nil {
		log.Printf("listing blocks to restore agents: %v\n", err)
		return
	}
	var restore []restoreAgent
	nudged := 0
	for _, block := range blocks {
		if block.Meta.GetString(MetaKey_AgentLive, "") == "" && !block.Meta.GetBool(MetaKey_AgentInTurn, false) {
			continue
		}
		oref := waveobj.MakeORef(waveobj.OType_Block, block.OID)
		if _, err := wstore.UpdateObjectMeta(ctx, oref, waveobj.MetaMapType{MetaKey_AgentLive: nil, MetaKey_AgentInTurn: nil}, false); err != nil {
			log.Printf("clearing agent block %s live mark: %v\n", block.OID, err)
		}
		if shouldRestoreAgent(block.Meta) {
			started, _ := strconv.ParseInt(block.Meta.GetString(MetaKey_AgentLive, ""), 10, 64)
			restore = append(restore, restoreAgent{
				blockId: block.OID,
				nudge:   shouldNudgeRestore(block.Meta),
				session: block.Meta.GetString(waveobj.MetaKey_Cmd, "") + " " + restoreSession(block.Meta),
				started: started,
			})
		}
	}
	restore, extra := onePerSession(restore)
	for _, r := range extra {
		// asleep, so its pane mounting does not start it either; a Wake finds its session running in the other tab
		oref := waveobj.MakeORef(waveobj.OType_Block, r.blockId)
		asleep := waveobj.MetaMapType{waveobj.MetaKey_AgentSleeping: time.Now().UnixMilli()}
		if _, err := wstore.UpdateObjectMeta(ctx, oref, asleep, false); err != nil {
			log.Printf("putting agent block %s to sleep beside another on its session: %v\n", r.blockId, err)
		}
	}
	for _, r := range restore {
		if r.nudge {
			nudged++
		}
	}
	if len(restore) == 0 {
		return
	}
	log.Printf("restoring %d agents left running by the last server, nudging %d it left mid-turn, %d asleep for a session another runs\n", len(restore), nudged, len(extra))
	go func() {
		defer func() {
			panichandler.PanicHandler("blockcontroller:restore-live-agents", recover())
		}()
		for i, r := range restore {
			if i > 0 {
				time.Sleep(restoreAgentStagger)
			}
			restoreOne(r)
		}
	}()
}

func restoreOne(r restoreAgent) {
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	tabId, err := wstore.DBFindTabForBlockId(ctx, r.blockId)
	if err != nil {
		return // its tab is gone
	}
	if r.nudge {
		queueRestoreNudge(r.blockId, time.Now())
	}
	if err := restartAgentBlock(ctx, tabId, r.blockId); err != nil {
		takeRestoreNudge(r.blockId, time.Now())
		log.Printf("restoring agent block %s: %v\n", r.blockId, err)
	}
}
