// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"fmt"
	"log"
	"math"
	"time"

	"github.com/shirou/gopsutil/v4/process"
	"github.com/wavetermdev/waveterm/pkg/agentsleep"
	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/blockcontroller"
	"github.com/wavetermdev/waveterm/pkg/memgate"
	"github.com/wavetermdev/waveterm/pkg/memusage"
	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// The once-a-minute check that puts idle agents to sleep. agentsleep decides who may; sleepAgent does it.

const (
	sleepLoopEvery = time.Minute
	// sleepAfterFloorMin is the least "After idle for" the loop honours: under it a pause between two turns would
	// put an agent to sleep
	sleepAfterFloorMin = 5
	sleepAfterDefault  = 30
)

// treeCPUms is the CPU time (ms, user plus system) a block's whole process tree has used so far, and whether
// there is a tree to read. A var so tests script it.
var treeCPUms = func(blockId string) (float64, bool) {
	pid := blockcontroller.GetBlockControllerPid(blockId)
	if pid <= 0 {
		return 0, false
	}
	root, err := process.NewProcess(int32(pid))
	if err != nil {
		return 0, false
	}
	var sec float64
	for _, p := range memusage.ProcessTree(root) {
		if times, err := p.Times(); err == nil {
			sec += times.User + times.System
		}
	}
	return sec * 1000, true
}

// sleepLoop holds what the check keeps between ticks. Its trackers are not safe for concurrent use: tick runs
// on the one goroutine StartAgentSleepLoop starts.
type sleepLoop struct {
	idle     *agentsleep.IdleTracker
	cpu      *agentsleep.CPURing
	now      func() time.Time
	settings func() agentsleep.Settings
	notify   func(wshrpc.NotifyCommandData)
	// sleep puts one agent to sleep: sleepAgent, a seam so a test needs no controller
	sleep func(ctx context.Context, row *agentRow, force bool) (*wshrpc.CommandAgentsSleepRtnData, error)
}

func newSleepLoop(notify func(wshrpc.NotifyCommandData)) *sleepLoop {
	return &sleepLoop{
		idle: agentsleep.NewIdleTracker(),
		cpu:  agentsleep.NewCPURing(),
		now:  time.Now,
		settings: func() agentsleep.Settings {
			return sleepSettings(wconfig.GetWatcher().GetFullConfig().Settings)
		},
		notify: notify,
		sleep:  sleepAgent,
	}
}

// sleepSettings reads the person's two settings: Sleep idle agents (default on) and After idle for (default 30
// minutes, never under sleepAfterFloorMin).
func sleepSettings(st wconfig.SettingsType) agentsleep.Settings {
	after := int64(sleepAfterDefault)
	if st.AgentsSleepAfterMin != nil {
		after = *st.AgentsSleepAfterMin
	}
	after = max(after, sleepAfterFloorMin)
	return agentsleep.Settings{
		Enabled: st.AgentsSleepIdle == nil || *st.AgentsSleepIdle,
		After:   time.Duration(after) * time.Minute,
	}
}

// tick is one check: it watches every live agent's idleness and CPU, and puts to sleep the ones agentsleep.Pick
// names.
func (l *sleepLoop) tick(ctx context.Context) {
	s := l.settings()
	now := l.now()
	if !s.Enabled {
		// the clocks start over when it is switched back on: an agent that worked while it was off was not idle
		// for that stretch, whatever the trackers last saw
		l.idle.Forget(nil)
		l.cpu.Forget(nil)
		return
	}
	facts, err := loadAgentRosterFacts(ctx)
	if err != nil {
		log.Printf("agent sleep: loading the roster: %v\n", err)
		return
	}
	viewing := viewingTabs(now)
	live := map[string]bool{}    // blocks the idle clock keeps
	sampled := map[string]bool{} // blocks whose CPU was read this check
	var cands []agentsleep.Candidate
	rows := map[string]*agentRow{} // by tab id
	roster := buildAgentRoster(facts)
	for i := range roster {
		row := &roster[i]
		// a sleeping agent has no clock to keep: when it wakes its idle stretch and its CPU start over
		if row.State == wshrpc.AgentsState_Sleeping || !agentsleep.Harnesses[row.Harness] {
			continue
		}
		live[row.blockId] = true
		rows[row.TabId] = row
		// raw state: agentsState folds a permission prompt into idle, and an agent waiting on one is not idle
		idle := row.status.State == baseds.AgentState_Idle
		c := agentsleep.Candidate{
			TabId:     row.TabId,
			BlockId:   row.blockId,
			Harness:   row.Harness,
			Idle:      idle,
			IdleSince: l.idle.Observe(row.blockId, idle, now),
			RunOwned:  row.RunId != "",
			Viewing:   viewing[row.TabId],
		}
		// every live agent, idle or not: a quiet tree is one whose last 5 minutes were quiet, which an agent that
		// only just stopped working has not had yet
		if ms, ok := treeCPUms(row.blockId); ok {
			sampled[row.blockId] = true
			l.cpu.Add(row.blockId, now, ms)
			c.CPUIdle = l.cpu.Idle(row.blockId, now)
		}
		// the transcript reads are the costly facts; an agent that fails a cheap rule is spared whatever they say
		if idle && !c.RunOwned && !c.Viewing && c.CPUIdle {
			l.readTranscriptFacts(ctx, row, &c)
		}
		cands = append(cands, c)
	}
	l.idle.Forget(live)
	l.cpu.Forget(sampled)

	free := uint64(math.MaxUint64) // free RAM that could not be read does not trigger the RAM path
	if vm, err := virtualMemory(ctx); err != nil {
		log.Printf("agent sleep: reading free RAM: %v\n", err)
	} else {
		free = vm.Available
	}

	var slept int
	var freed uint64
	for _, tabId := range agentsleep.Pick(cands, now, s, free) {
		if ctx.Err() != nil {
			break
		}
		row := rows[tabId]
		rtn, err := l.sleep(ctx, row, false)
		switch {
		case err != nil:
			log.Printf("agent sleep: %q (block %s): %v\n", row.Name, row.blockId, err)
		case len(rtn.Background) > 0:
			// background work started since the check read the transcript: the agent stays up and is looked at
			// again next check
		default:
			slept++
			freed += rtn.FreedBytes
		}
	}
	if slept > 0 {
		l.notify(wshrpc.NotifyCommandData{
			Title:   fmt.Sprintf("Put %s to sleep", plural(slept, "agent", "agents")),
			Message: "freed " + formatFreed(freed),
			Level:   "info",
		})
	}
}

// readTranscriptFacts fills in what only the agent's transcript says: whether there is a session to resume, and
// whether background tasks or subagents still run under it.
func (l *sleepLoop) readTranscriptFacts(ctx context.Context, row *agentRow, c *agentsleep.Candidate) {
	tpath, err := agentTranscriptPath(ctx, row)
	if err != nil {
		log.Printf("agent sleep: reading the transcript path of %q: %v\n", row.Name, err)
		return
	}
	c.SessionKnown = sessionKey(row.Harness, tpath, row.status.SessionID) != ""
	background, subagents := runningWork(tpath)
	c.BackgroundRunning = len(background) > 0
	c.SubagentsRunning = len(subagents) > 0
}

func plural(n int, one, many string) string {
	if n == 1 {
		return fmt.Sprintf("%d %s", n, one)
	}
	return fmt.Sprintf("%d %s", n, many)
}

// formatFreed is the RAM a sleep freed as the Consumers panel prints it: whole MB, GB from 1 GiB up.
func formatFreed(bytes uint64) string {
	if bytes < 1<<30 {
		return fmt.Sprintf("%d MB", (bytes+1<<19)>>20)
	}
	return memgate.FormatGB(bytes)
}

// StartAgentSleepLoop starts the sleep check, once a minute for the life of ctx. notify raises the one notice a
// check that slept anything makes.
func StartAgentSleepLoop(ctx context.Context, notify func(wshrpc.NotifyCommandData)) {
	loop := newSleepLoop(notify)
	go func() {
		ticker := time.NewTicker(sleepLoopEvery)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
			// one bad check must not end the loop
			func() {
				defer func() { panichandler.PanicHandler("agentsleep:loop", recover()) }()
				loop.tick(ctx)
			}()
		}
	}()
}
