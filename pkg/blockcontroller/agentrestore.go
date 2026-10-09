// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package blockcontroller

import (
	"context"
	"log"
	"strconv"
	"time"

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

// MetaKey_AgentLive holds a token unique to the process start that set it, so the exit of a replaced process
// cannot clear the mark its successor set.
const MetaKey_AgentLive = "agent:live"

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
			i++ // its value too
		case stale.bare[a]:
		default:
			kept = append(kept, a)
		}
	}
	return kept
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
	args := meta.GetStringList(waveobj.MetaKey_CmdArgs)
	flag := agentResumeFlags[meta.GetString(waveobj.MetaKey_Cmd, "")]
	return len(args) >= 2 && args[0] == flag && args[1] != ""
}

// Pure: whether an exited process clears its block's live mark. Not while the server is quitting, which kills
// every agent: those are the ones the next boot brings back.
func shouldClearAgentLive(current, token string, shuttingDown bool) bool {
	return token != "" && current == token && !shuttingDown
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

// clearAgentLive removes the mark an agent process set, once that process has exited on its own.
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
	oref := waveobj.MakeORef(waveobj.OType_Block, blockId)
	if _, err := wstore.UpdateObjectMeta(ctx, oref, waveobj.MetaMapType{MetaKey_AgentLive: nil}, false); err != nil {
		log.Printf("clearing agent block %s live mark: %v\n", blockId, err)
	}
}

// restartAgentBlock starts one restored agent. A var so tests can stub it.
var restartAgentBlock = func(ctx context.Context, tabId, blockId string) error {
	// nil runtime opts: the PTY starts at the block's stored size, and its pane refits it when it mounts
	return ResyncController(ctx, tabId, blockId, nil, false)
}

// RestoreLiveAgents relaunches, one at a time, every agent the last server left running. Every mark is cleared
// first: it belonged to the last server's processes, and a relaunch sets its own.
func RestoreLiveAgents(ctx context.Context) {
	blocks, err := wstore.DBGetAllObjsByType[*waveobj.Block](ctx, waveobj.OType_Block)
	if err != nil {
		log.Printf("listing blocks to restore agents: %v\n", err)
		return
	}
	var restore []string
	for _, block := range blocks {
		if block.Meta.GetString(MetaKey_AgentLive, "") == "" {
			continue
		}
		oref := waveobj.MakeORef(waveobj.OType_Block, block.OID)
		if _, err := wstore.UpdateObjectMeta(ctx, oref, waveobj.MetaMapType{MetaKey_AgentLive: nil}, false); err != nil {
			log.Printf("clearing agent block %s live mark: %v\n", block.OID, err)
		}
		if shouldRestoreAgent(block.Meta) {
			restore = append(restore, block.OID)
		}
	}
	if len(restore) == 0 {
		return
	}
	log.Printf("restoring %d agents left running by the last server\n", len(restore))
	go func() {
		defer func() {
			panichandler.PanicHandler("blockcontroller:restore-live-agents", recover())
		}()
		for i, blockId := range restore {
			if i > 0 {
				time.Sleep(restoreAgentStagger)
			}
			restoreOne(blockId)
		}
	}()
}

func restoreOne(blockId string) {
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	tabId, err := wstore.DBFindTabForBlockId(ctx, blockId)
	if err != nil {
		return // its tab is gone
	}
	if err := restartAgentBlock(ctx, tabId, blockId); err != nil {
		log.Printf("restoring agent block %s: %v\n", blockId, err)
	}
}
