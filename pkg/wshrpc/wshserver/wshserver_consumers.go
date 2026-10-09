// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"fmt"
	"log"
	"os"
	"regexp"
	"runtime"
	"time"

	"github.com/wavetermdev/waveterm/pkg/blockcontroller"
	"github.com/wavetermdev/waveterm/pkg/memusage"
	"github.com/wavetermdev/waveterm/pkg/usagestats"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// ConsumersTokenWindow is how far back a GetConsumers reading counts each agent's tokens.
const ConsumersTokenWindow = 10 * time.Minute

// consumersTokens keeps each transcript's read offset between polls, so a poll parses only what was appended.
var consumersTokens = usagestats.NewWindowReader()

// seams, so tests script the shell pids, the process table, the sampler and the dag store
var (
	consumerBlockPid = blockcontroller.GetBlockControllerPid
	consumerTable    = memusage.ReadTable
	consumerSampler  = memusage.Live
	consumerLoadDag  = wstore.GetDag
)

// consumerDag is the dag task a run worker works on, nil for any other agent. run is the worker's own run, the
// roster's ownerRun over the runs it already loaded; a dag child's run carries its dag (DagORef), and that dag the
// task whose run it is. dags keeps each dag this reading read, so the workers of one run share a read. A dag that
// cannot be read is logged and leaves the row without its task (the panel then offers the plain close); the next
// reading tries it again.
func consumerDag(ctx context.Context, dags map[string]*waveobj.TaskGroup, run *waveobj.Run) *wshrpc.ConsumerDag {
	if run == nil || run.DagORef == "" {
		return nil
	}
	g, seen := dags[run.DagORef]
	if !seen {
		var err error
		if g, err = consumerLoadDag(ctx, run.DagORef); err != nil {
			log.Printf("consumers: reading dag %s of run %s: %v", run.DagORef, run.OID, err)
			g = nil
		}
		dags[run.DagORef] = g
	}
	if g == nil {
		return nil
	}
	for i := range g.Tasks {
		if g.Tasks[i].RunID == run.OID {
			return &wshrpc.ConsumerDag{ChannelId: g.ChannelId, RunId: g.RunID, TaskId: g.Tasks[i].ID}
		}
	}
	return nil
}

// GetConsumersCommand is one reading of the Consumers panel: every live agent's RAM and its tokens of the last
// ConsumersTokenWindow, and the RAM of the webview, wavesrv, the host and the plain terminals. The process list
// is read once.
func (ws *WshServer) GetConsumersCommand(ctx context.Context) (*wshrpc.CommandGetConsumersRtnData, error) {
	vm, err := virtualMemory(ctx)
	if err != nil {
		return nil, fmt.Errorf("reading system memory: %w", err)
	}
	facts, err := loadAgentRosterFacts(ctx)
	if err != nil {
		return nil, err
	}
	rows := buildAgentRoster(facts)
	roots := make(map[string]int32, len(rows))
	for _, r := range rows {
		if pid := consumerBlockPid(r.blockId); pid > 0 {
			roots[r.blockId] = int32(pid)
		}
	}
	var bd memusage.Breakdown
	if table, terr := consumerTable(); terr == nil {
		// wavesrv's parent is the Tauri host, which spawned it
		bd = memusage.Measure(table, consumerSampler(), roots, int32(os.Getpid()), int32(os.Getppid()), runtime.GOOS == "darwin")
	}
	now := time.Now()
	out := &wshrpc.CommandGetConsumersRtnData{
		TotalBytes:     vm.Total,
		AvailableBytes: vm.Available,
		WindowMs:       ConsumersTokenWindow.Milliseconds(),
		Agents:         []wshrpc.ConsumerAgent{},
		InterfaceBytes: bd.Interface,
		ServerBytes:    bd.Server,
		HostBytes:      bd.Host,
		TerminalsBytes: bd.Terminals,
	}
	dags := map[string]*waveobj.TaskGroup{}
	for i := range rows {
		r := &rows[i]
		a := wshrpc.ConsumerAgent{TabId: r.TabId, BlockId: r.blockId, Dag: consumerDag(ctx, dags, ownerRun(facts.Runs, r.TabId))}
		if n, ok := bd.Agents[r.blockId]; ok {
			a.RamBytes = &n
		}
		if tpath, terr := agentTranscriptPath(ctx, r); terr == nil && tpath != "" {
			if buckets, ok := consumersTokens.Window(tpath, now, ConsumersTokenWindow); ok {
				a.TokensRead = true
				for _, b := range buckets {
					a.Tokens = append(a.Tokens, usageBucketToWire(b))
				}
			}
		}
		out.Agents = append(out.Agents, a)
	}
	// a transcript no agent named this poll is not polled again; a minute's grace covers a slow roster
	consumersTokens.Forget(now.Add(-time.Minute))
	return out, nil
}

// modelArg is one word `/model` takes: an alias or a model id ("claude-sonnet-4-6[1m]")
var modelArg = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._\[\]-]*$`)

// AgentsSetModelCommand sends `/model <model>` into a live Claude session. Over the mod's control stream the mod
// runs it as the session's own slash command (claude/arc-mod/hooks/control-core.ts deliver); without one it is
// typed into the terminal.
func (ws *WshServer) AgentsSetModelCommand(ctx context.Context, data wshrpc.CommandAgentsSetModelData) (*wshrpc.CommandAgentsSetModelRtnData, error) {
	if !modelArg.MatchString(data.Model) {
		return nil, fmt.Errorf("model %q is not one word /model takes", data.Model)
	}
	facts, err := loadAgentRosterFacts(ctx)
	if err != nil {
		return nil, err
	}
	target, err := resolveAgentTab(buildAgentRoster(facts), data.Tab)
	if err != nil {
		return nil, err
	}
	if target.State == wshrpc.AgentsState_Sleeping {
		return nil, fmt.Errorf("agent %q is asleep; wake it first: the /model line would go to no process", target.Name)
	}
	if target.Harness != "claude" {
		return nil, fmt.Errorf("agent %q runs %s; only a Claude session switches its model with /model", target.Name, target.Harness)
	}
	// AgentsSendCommand's guard: typed into the terminal, the command would answer the open question
	if target.State == wshrpc.AgentsState_Asking && !target.hasStream {
		return nil, fmt.Errorf("agent %q has a question open in its terminal, and a typed /model would answer it; switch it once the question is answered", target.Name)
	}
	deliverAgentMessage(target.blockId, "/model "+data.Model)
	return &wshrpc.CommandAgentsSetModelRtnData{
		TabId:      target.TabId,
		MidTurn:    target.State != wshrpc.AgentsState_Idle,
		OverStream: target.hasStream,
	}, nil
}
