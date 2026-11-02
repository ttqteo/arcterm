// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// The sleep of a brainstorm's agent once the run its Approve started is going: the frontend arms it as the run starts,
// and the agent sleeps 15 seconds after the turn that writes the run's id into its brainstorm.json. Everything that
// stops a person's Sleep (sleepRefusal, no session, background work) stops this one too, and the 30-minute rule then
// covers the agent. Armed entries live in memory only: a wavesrv restart drops them.

const (
	// sleepAfterRunWait is how long the agent stays up once it has recorded its run and gone idle
	sleepAfterRunWait = 15 * time.Second
	// sleepAfterRunGiveUp drops an entry whose agent has not recorded its run by then
	sleepAfterRunGiveUp = 10 * time.Minute
	// sleepAfterRunTimeout bounds one sleep: sleepAgent waits for the process tree to end
	sleepAfterRunTimeout = time.Minute
)

// runSleep is one armed agent.
type runSleep struct {
	tabId   string
	runId   string
	path    string
	armedAt time.Time
	stop    func() bool // the running 15-second countdown; nil until the run is recorded
}

var (
	runSleepsMu sync.Mutex
	runSleeps   = map[string]*runSleep{} // by block id
	// runSleepNotify raises the notice of an agent this put to sleep; StartAgentSleepLoop sets it
	runSleepNotify func(wshrpc.NotifyCommandData)
)

// afterRunTimer runs f after d and returns what stops it. A var so tests run a fake clock.
var afterRunTimer = func(d time.Duration, f func()) func() bool {
	return time.AfterFunc(d, f).Stop
}

// afterRunNow is the clock the 10-minute drop reads. A var so tests move it.
var afterRunNow = time.Now

// sleepAfterRunAgent puts the agent to sleep: sleepAgent, a var so a test needs no controller.
var sleepAfterRunAgent = sleepAgent

func setRunSleepNotify(notify func(wshrpc.NotifyCommandData)) {
	runSleepsMu.Lock()
	defer runSleepsMu.Unlock()
	runSleepNotify = notify
}

// brainstormRun is the run id a brainstorm.json records, "" when it records none.
func brainstormRun(path string) (string, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	var f struct {
		Run *string `json:"run"`
	}
	if err := json.Unmarshal(raw, &f); err != nil {
		return "", err
	}
	if f.Run == nil {
		return "", nil
	}
	return *f.Run, nil
}

// recordsRun reports whether the brainstorm.json at path names runId, logging a file that cannot be read.
func recordsRun(path, runId string) bool {
	got, err := brainstormRun(path)
	if err != nil {
		log.Printf("agent sleep after run: reading %s: %v\n", path, err)
		return false
	}
	return got == runId
}

// endsTurn reports whether a status is the end of a turn: an idle that is not a SessionStart (a resume or a
// compaction reports one without a turn having run).
func endsTurn(st baseds.AgentStatusData) bool {
	return st.State == baseds.AgentState_Idle && st.Hook != baseds.AgentHook_SessionStart
}

func (ws *WshServer) AgentsSleepAfterRunCommand(ctx context.Context, data wshrpc.CommandAgentsSleepAfterRunData) error {
	if data.RunId == "" {
		return fmt.Errorf("a run id is required")
	}
	if filepath.Base(data.Path) != "brainstorm.json" {
		return fmt.Errorf("%q is not a brainstorm.json", data.Path)
	}
	if !currentSleepSettings().Enabled {
		log.Printf("agent sleep after run: Sleep idle agents is off; tab %s stays awake after run %s\n", data.Tab, data.RunId)
		return nil
	}
	facts, err := loadAgentRosterFacts(ctx)
	if err != nil {
		return err
	}
	row, err := resolveAgentTab(buildAgentRoster(facts), data.Tab)
	if err != nil {
		return err
	}
	e := &runSleep{tabId: row.TabId, runId: data.RunId, path: data.Path, armedAt: afterRunNow()}
	runSleepsMu.Lock()
	// entries whose agents never reported again: nothing else would drop them
	for id, old := range runSleeps {
		if old.stop == nil && e.armedAt.Sub(old.armedAt) > sleepAfterRunGiveUp {
			delete(runSleeps, id)
		}
	}
	if old := runSleeps[row.blockId]; old != nil && old.stop != nil {
		old.stop()
	}
	runSleeps[row.blockId] = e
	runSleepsMu.Unlock()
	log.Printf("agent sleep after run: armed %q (block %s) for run %s\n", row.Name, row.blockId, data.RunId)
	// the agent may have recorded the run and gone idle before the arm landed
	if endsTurn(row.status) && recordsRun(e.path, e.runId) {
		startRunSleep(row.blockId, e)
	}
	return nil
}

// startRunSleep starts e's 15-second countdown, unless e is no longer the block's entry or already counts down.
func startRunSleep(blockId string, e *runSleep) {
	runSleepsMu.Lock()
	defer runSleepsMu.Unlock()
	if runSleeps[blockId] != e || e.stop != nil {
		return
	}
	e.stop = afterRunTimer(sleepAfterRunWait, func() { fireRunSleep(blockId, e) })
}

// noteRunSleepStatus moves an armed agent's countdown along with its agent:status reports: a turn's end that finds the
// run recorded starts the countdown, and a working report while it counts down (the person typed to the agent) drops
// the entry.
func noteRunSleepStatus(ctx context.Context, ev *wps.WaveEvent) {
	runSleepsMu.Lock()
	none := len(runSleeps) == 0
	runSleepsMu.Unlock()
	if none {
		return
	}
	var st baseds.AgentStatusData
	if utilfn.ReUnmarshal(&st, ev.Data) != nil {
		return
	}
	blockId := statusBlockId(ctx, st.ORef)
	if blockId == "" {
		return
	}
	runSleepsMu.Lock()
	e := runSleeps[blockId]
	if e == nil {
		runSleepsMu.Unlock()
		return
	}
	if e.stop == nil && afterRunNow().Sub(e.armedAt) > sleepAfterRunGiveUp {
		delete(runSleeps, blockId)
		runSleepsMu.Unlock()
		log.Printf("agent sleep after run: block %s did not record run %s within %v; dropped\n", blockId, e.runId, sleepAfterRunGiveUp)
		return
	}
	if st.State == baseds.AgentState_Working && e.stop != nil {
		e.stop()
		delete(runSleeps, blockId)
		runSleepsMu.Unlock()
		log.Printf("agent sleep after run: block %s started working again; it stays awake\n", blockId)
		return
	}
	counting := e.stop != nil
	runSleepsMu.Unlock()
	if !counting && endsTurn(st) && recordsRun(e.path, e.runId) {
		startRunSleep(blockId, e)
	}
}

// fireRunSleep puts the agent to sleep once its 15 seconds are up, rechecking everything a person's Sleep checks.
func fireRunSleep(blockId string, e *runSleep) {
	defer func() { panichandler.PanicHandler("agentsleep:afterrun", recover()) }()
	runSleepsMu.Lock()
	if runSleeps[blockId] != e {
		runSleepsMu.Unlock()
		return
	}
	delete(runSleeps, blockId)
	notify := runSleepNotify
	runSleepsMu.Unlock()

	if !currentSleepSettings().Enabled {
		log.Printf("agent sleep after run: Sleep idle agents is off; block %s stays awake\n", blockId)
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), sleepAfterRunTimeout)
	defer cancel()
	facts, err := loadAgentRosterFacts(ctx)
	if err != nil {
		log.Printf("agent sleep after run: loading the roster: %v\n", err)
		return
	}
	row, err := resolveAgentTab(buildAgentRoster(facts), e.tabId)
	if err != nil || row.blockId != blockId {
		log.Printf("agent sleep after run: block %s is no longer tab %s's agent; it stays as it is\n", blockId, e.tabId)
		return
	}
	if err := sleepRefusal(row); err != nil {
		log.Printf("agent sleep after run: %v\n", err)
		return
	}
	rtn, err := sleepAfterRunAgent(ctx, row, false)
	switch {
	case err != nil:
		log.Printf("agent sleep after run: %q (block %s): %v\n", row.Name, blockId, err)
	case len(rtn.Background) > 0:
		log.Printf("agent sleep after run: %q (block %s) still runs %v; it stays awake\n", row.Name, blockId, rtn.Background)
	default:
		log.Printf("agent sleep after run: put %q (block %s) to sleep after run %s\n", row.Name, blockId, e.runId)
		if notify != nil {
			notify(wshrpc.NotifyCommandData{
				Title:   fmt.Sprintf("Put %s to sleep", row.Name),
				Message: "freed " + formatFreed(rtn.FreedBytes),
				Level:   "info",
			})
		}
	}
}
