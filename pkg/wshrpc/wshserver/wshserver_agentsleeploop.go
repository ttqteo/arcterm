// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"fmt"
	"io"
	"log"
	"math"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/shirou/gopsutil/v4/process"
	"github.com/wavetermdev/waveterm/pkg/agentctl"
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
	// compactAtFloorK is the least context, in thousands of tokens, the loop compacts: under it a compaction loses
	// detail for little
	compactAtFloorK = 25
	// cacheTailBytes is how much of a transcript's end the cache read takes: the last request and any compaction after
	// it sit there, while a whole transcript runs to tens of MB
	cacheTailBytes = 4 << 20
)

// pendingCompact is a compaction the loop or a person's Sleep asked for that has not landed yet.
type pendingCompact struct {
	sent  time.Time
	then  agentsleep.SleepAfter
	force bool // the person confirmed the Sleep over running background work
}

// compacts holds the compactions waiting to land, by block id. The loop and a person's Sleep both write it.
var (
	compactsMu sync.Mutex
	compacts   = map[string]pendingCompact{}
)

// compactPending is blockId's compaction that has not landed, dropping one older than agentsleep.CompactGiveUp: a
// compaction that never lands holds nothing up for longer.
func compactPending(blockId string, now time.Time) (pendingCompact, bool) {
	compactsMu.Lock()
	defer compactsMu.Unlock()
	pc, ok := compacts[blockId]
	if ok && now.Sub(pc.sent) > agentsleep.CompactGiveUp {
		delete(compacts, blockId)
		return pendingCompact{}, false
	}
	return pc, ok
}

func setCompactPending(blockId string, pc pendingCompact) {
	compactsMu.Lock()
	defer compactsMu.Unlock()
	compacts[blockId] = pc
}

func dropCompactPending(blockId string) {
	compactsMu.Lock()
	defer compactsMu.Unlock()
	delete(compacts, blockId)
}

// forgetCompacts drops the compactions of blocks no longer live, and reports whether any still wait.
func forgetCompacts(keep map[string]bool) bool {
	compactsMu.Lock()
	defer compactsMu.Unlock()
	for id := range compacts {
		if !keep[id] {
			delete(compacts, id)
		}
	}
	return len(compacts) > 0
}

func compactsWaiting() bool {
	compactsMu.Lock()
	defer compactsMu.Unlock()
	return len(compacts) > 0
}

// sendCompact asks a session's mod for a compaction over its control stream, which leaves the composer and any draft in
// it alone; false when the session has no stream. The typed text is for a mod older than the Compact field. A var so
// tests need no stream.
var sendCompact = func(blockId string) bool {
	return agentctl.Send(blockId, agentctl.Msg{
		Text:    "/compact " + agentsleep.CompactInstructions,
		Compact: agentsleep.CompactInstructions,
	})
}

// readTranscriptEnd is the lines in the last maxBytes of a transcript, the first one dropped when the read starts inside
// it. A var so tests script it.
var readTranscriptEnd = func(path string, maxBytes int64) ([]string, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return nil, err
	}
	start := max(0, info.Size()-maxBytes)
	buf := make([]byte, info.Size()-start)
	if _, err := f.ReadAt(buf, start); err != nil && err != io.EOF {
		return nil, err
	}
	lines := strings.Split(string(buf), "\n")
	if start > 0 {
		lines = lines[1:]
	}
	return lines, nil
}

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
		idle:     agentsleep.NewIdleTracker(),
		cpu:      agentsleep.NewCPURing(),
		now:      time.Now,
		settings: func() agentsleep.Settings { return currentSleepSettings() },
		notify:   notify,
		sleep:    sleepAgent,
	}
}

// currentSleepSettings is sleepSettings over the settings in force. A var so tests set them.
var currentSleepSettings = func() agentsleep.Settings {
	return sleepSettings(wconfig.GetWatcher().GetFullConfig().Settings)
}

// sleepSettings reads the person's settings: Sleep idle agents (default on), After idle for (default 30 minutes, never
// under sleepAfterFloorMin), Compact before the cache goes cold (default on) and its least context (default 100k,
// never under compactAtFloorK).
func sleepSettings(st wconfig.SettingsType) agentsleep.Settings {
	after := int64(sleepAfterDefault)
	if st.AgentsSleepAfterMin != nil {
		after = *st.AgentsSleepAfterMin
	}
	after = max(after, sleepAfterFloorMin)
	atK := int64(agentsleep.CompactAtDefault / 1000)
	if st.AgentsCompactAtK != nil {
		atK = *st.AgentsCompactAtK
	}
	atK = max(atK, compactAtFloorK)
	return agentsleep.Settings{
		Enabled:   st.AgentsSleepIdle == nil || *st.AgentsSleepIdle,
		After:     time.Duration(after) * time.Minute,
		Compact:   st.AgentsCompactIdle == nil || *st.AgentsCompactIdle,
		CompactAt: int(atK) * 1000,
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
		// compaction still runs without sleep, and a person's Sleep waiting on one still ends in a sleep
		if !s.Compact && !compactsWaiting() {
			return
		}
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
			HasStream: row.hasStream,
		}
		pc, pending := compactPending(row.blockId, now)
		if pending {
			c.CompactSent, c.AfterCompact = pc.sent, pc.then
		}
		// every live agent, idle or not: a quiet tree is one whose last 5 minutes were quiet, which an agent that
		// only just stopped working has not had yet
		if ms, ok := treeCPUms(row.blockId); ok {
			sampled[row.blockId] = true
			l.cpu.Add(row.blockId, now, ms)
			c.CPUIdle = l.cpu.Idle(row.blockId, now)
		}
		// the transcript reads are the costly facts; an agent that fails a cheap rule is spared whatever they say
		sleepFacts := s.Enabled && idle && !c.RunOwned && !c.Viewing && c.CPUIdle
		cacheFacts := idle && !c.RunOwned && c.HasStream && row.Harness == "claude" && (s.Compact || pending)
		if sleepFacts || cacheFacts {
			l.readTranscriptFacts(ctx, row, &c, sleepFacts, cacheFacts)
		}
		if pending && pc.then == agentsleep.SleepAfterNone && c.Cache.Compacted {
			// an awake agent's compaction landed, and no sleep waits on it
			dropCompactPending(row.blockId)
			c.CompactSent = time.Time{}
		}
		cands = append(cands, c)
	}
	l.idle.Forget(live)
	l.cpu.Forget(sampled)
	forgetCompacts(live)

	free := uint64(math.MaxUint64) // free RAM that could not be read does not trigger the RAM path
	if vm, err := virtualMemory(ctx); err != nil {
		log.Printf("agent sleep: reading free RAM: %v\n", err)
	} else {
		free = vm.Available
	}

	plan := agentsleep.Decide(cands, now, s, free)
	for _, cp := range plan.Compact {
		row := rows[cp.TabId]
		if !sendCompact(row.blockId) {
			log.Printf("agent sleep: %q (block %s) took no compaction over its stream\n", row.Name, row.blockId)
			continue
		}
		pc := pendingCompact{sent: now}
		why := "its cache is about to go cold"
		if cp.ThenSleep {
			pc.then, why = agentsleep.SleepAfterLoop, "it sleeps"
		}
		setCompactPending(row.blockId, pc)
		log.Printf("agent sleep: compacting %q (block %s) before %s\n", row.Name, row.blockId, why)
	}

	var slept int
	var freed uint64
	for _, tabId := range plan.Sleep {
		if ctx.Err() != nil {
			break
		}
		row := rows[tabId]
		pc, _ := compactPending(row.blockId, now)
		dropCompactPending(row.blockId)
		rtn, err := l.sleep(ctx, row, pc.force)
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

// readTranscriptFacts fills in what only the agent's transcript says. For sleep: whether there is a session to resume,
// and whether background tasks or subagents still run under it. For compaction: the state of its prompt cache.
func (l *sleepLoop) readTranscriptFacts(ctx context.Context, row *agentRow, c *agentsleep.Candidate, sleep, cache bool) {
	tpath, err := agentTranscriptPath(ctx, row)
	if err != nil {
		log.Printf("agent sleep: reading the transcript path of %q: %v\n", row.Name, err)
		return
	}
	if sleep {
		c.SessionKnown = sessionKey(row.Harness, tpath, row.status.SessionID) != ""
		background, subagents := runningWork(tpath)
		c.BackgroundRunning = len(background) > 0
		c.SubagentsRunning = len(subagents) > 0
	}
	if cache && tpath != "" {
		if lines, err := readTranscriptEnd(tpath, cacheTailBytes); err == nil {
			c.Cache = agentsleep.ReadCacheState(lines)
		}
	}
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
