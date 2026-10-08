// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/shirou/gopsutil/v4/mem"
	"github.com/wavetermdev/waveterm/pkg/memusage"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const consumersMB uint64 = 1 << 20

// the run whose dag the scripted workers' tasks are in: B works on t-3 (child run run-b), C on t-4 (run-c)
var consumersDag = &waveobj.TaskGroup{
	OID: "dag-1", ChannelId: "ch-1", RunID: "run-owner",
	Tasks: []waveobj.TaskNode{{ID: "t-3", RunID: "run-b"}, {ID: "t-4", RunID: "run-c"}},
}

// consumersRuns are the roster's runs: the worker runs of B and C, which carry their dag, and A's own run, a
// quick run with no dag
func consumersRuns() []*waveobj.Run {
	worker := func(id, tab, dag string) *waveobj.Run {
		return &waveobj.Run{OID: id, DagORef: dag, Phases: []waveobj.RunPhase{{WorkerOrefs: []string{"tab:" + tab}}}}
	}
	return []*waveobj.Run{worker("run-a", agentsTabA, ""), worker("run-b", agentsTabB, "dag-1"), worker("run-c", agentsTabC, "dag-1")}
}

// scriptConsumers scripts the shell pids, the process table, the sampler, the dag store and the system memory. It
// returns how many times a dag was read.
func scriptConsumers(t *testing.T, pids map[string]int, table memusage.Table, foot map[int32]uint64) *int {
	t.Helper()
	oldPid, oldTable, oldSampler, oldDag, oldVM := consumerBlockPid, consumerTable, consumerSampler, consumerLoadDag, virtualMemory
	consumerBlockPid = func(blockId string) int { return pids[blockId] }
	consumerTable = func() (memusage.Table, error) { return table, nil }
	consumerSampler = func() memusage.Sampler {
		return memusage.Sampler{
			Footprint: func(pid int32) (uint64, bool) {
				n, ok := foot[pid]
				return n, ok
			},
			Responsible: func(int32) (int32, bool) { return 0, false },
		}
	}
	dagReads := 0
	consumerLoadDag = func(_ context.Context, dagId string) (*waveobj.TaskGroup, error) {
		dagReads++
		if dagId != consumersDag.OID {
			return nil, fmt.Errorf("no dag %q", dagId)
		}
		return consumersDag, nil
	}
	virtualMemory = func(context.Context) (*mem.VirtualMemoryStat, error) {
		return &mem.VirtualMemoryStat{Total: 8 << 30, Available: 2 << 30}, nil
	}
	t.Cleanup(func() {
		consumerBlockPid, consumerTable, consumerSampler, consumerLoadDag, virtualMemory = oldPid, oldTable, oldSampler, oldDag, oldVM
	})
	return &dagReads
}

func recentOpusLine(output int) string {
	return fmt.Sprintf(`{"type":"assistant","timestamp":%q,"requestId":"req_c","message":{"id":"msg_c","model":"claude-opus-4-8","usage":{"input_tokens":0,"output_tokens":%d,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}}`,
		time.Now().UTC().Format(time.RFC3339), output)
}

func TestGetConsumersReportsEachAgentsRamTokensAndTask(t *testing.T) {
	transcript := filepath.Join(t.TempDir(), "a.jsonl")
	if err := os.WriteFile(transcript, []byte(recentOpusLine(4200)+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	facts := threeAgents()
	facts.Tabs[0].Status.TranscriptPath = transcript
	facts.Runs = consumersRuns()
	scriptAgents(t, facts)
	// the shells sit under wavesrv (this process): A's shell 100 runs claude 101; B's shell is 200; C's shell has
	// exited (no pid); 300 is a plain terminal's shell
	self := int32(os.Getpid())
	dagReads := scriptConsumers(t,
		map[string]int{agentsBlockA: 100, agentsBlockB: 200},
		memusage.NewTable(map[int32]int32{self: 1, 100: self, 101: 100, 200: self, 300: self}),
		map[int32]uint64{self: 121 * consumersMB, 100: 5 * consumersMB, 101: 300 * consumersMB, 200: 1024 * consumersMB, 300: 50 * consumersMB})

	rtn, err := (&WshServer{}).GetConsumersCommand(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if rtn.TotalBytes != 8<<30 || rtn.AvailableBytes != 2<<30 || rtn.WindowMs != ConsumersTokenWindow.Milliseconds() {
		t.Fatalf("memory/window = %+v", rtn)
	}
	if rtn.TerminalsBytes == nil || *rtn.TerminalsBytes != 50*consumersMB {
		t.Fatalf("terminals = %v, want 50 MB (the plain shell 300)", rtn.TerminalsBytes)
	}
	if rtn.ServerBytes == nil || *rtn.ServerBytes != 121*consumersMB {
		t.Fatalf("server = %v, want 121 MB", rtn.ServerBytes)
	}
	byTab := map[string]wshrpc.ConsumerAgent{}
	for _, a := range rtn.Agents {
		byTab[a.TabId] = a
	}
	a, b, c := byTab[agentsTabA], byTab[agentsTabB], byTab[agentsTabC]
	if a.RamBytes == nil || *a.RamBytes != 305*consumersMB {
		t.Fatalf("A's RAM = %v, want 305 MB (shell + claude)", a.RamBytes)
	}
	if !a.TokensRead || len(a.Tokens) != 1 || a.Tokens[0].Output != 4200 || a.Tokens[0].Model != "claude-opus-4-8" {
		t.Fatalf("A's tokens = %+v (read %v)", a.Tokens, a.TokensRead)
	}
	if b.RamBytes == nil || *b.RamBytes != 1024*consumersMB || b.Dag == nil || *b.Dag != (wshrpc.ConsumerDag{ChannelId: "ch-1", RunId: "run-owner", TaskId: "t-3"}) {
		t.Fatalf("B = %+v (dag %+v), want 1 GB and task t-3 of the owner run", b, b.Dag)
	}
	if c.TabId != agentsTabC || c.RamBytes != nil {
		t.Fatalf("C's shell is gone: its RAM must be absent, got %+v", c)
	}
	if a.Dag != nil || c.Dag == nil || c.Dag.TaskId != "t-4" {
		t.Fatalf("A's run has no dag, C works on t-4: A %+v, C %+v", a.Dag, c.Dag)
	}
	// B and C share one dag: it is read once a reading, from the runs the roster already loaded
	if *dagReads != 1 {
		t.Fatalf("dag reads = %d, want 1", *dagReads)
	}
}

func TestAgentsSetModelSendsTheSlashCommand(t *testing.T) {
	sent := scriptAgents(t, threeAgents())
	rtn, err := (&WshServer{}).AgentsSetModelCommand(context.Background(), wshrpc.CommandAgentsSetModelData{Tab: agentsTabA, Model: "sonnet"})
	if err != nil {
		t.Fatal(err)
	}
	if len(*sent) != 1 || (*sent)[0].blockId != agentsBlockA || (*sent)[0].text != "/model sonnet" {
		t.Fatalf("sent = %+v, want /model sonnet to block A", *sent)
	}
	if rtn.TabId != agentsTabA || !rtn.MidTurn {
		t.Fatalf("rtn = %+v, want tab A mid-turn (it is working)", rtn)
	}
}

func TestAgentsSetModelRefusesPi(t *testing.T) {
	sent := scriptAgents(t, threeAgents())
	_, err := (&WshServer{}).AgentsSetModelCommand(context.Background(), wshrpc.CommandAgentsSetModelData{Tab: agentsTabC, Model: "sonnet"})
	if err == nil || !strings.Contains(err.Error(), "only a Claude session") || len(*sent) != 0 {
		t.Fatalf("pi: err=%v sent=%v, want a refusal and nothing sent", err, *sent)
	}
}

// AgentsSendCommand's guard: with no control stream the command is typed into the terminal, where an open question
// would take it as its answer
func TestAgentsSetModelRefusesAnAskingAgentWithNoStream(t *testing.T) {
	asking := threeAgents()
	asking.Tabs[1].OpenAsk = true // B is a Claude agent with a question open and no stream
	sent := scriptAgents(t, asking)
	_, err := (&WshServer{}).AgentsSetModelCommand(context.Background(), wshrpc.CommandAgentsSetModelData{Tab: agentsTabB, Model: "sonnet"})
	if err == nil || !strings.Contains(err.Error(), "question open") || len(*sent) != 0 {
		t.Fatalf("asking with no stream: err=%v sent=%v, want a refusal and nothing sent", err, *sent)
	}
}

func TestAgentsSetModelRefusesAMultiWordModel(t *testing.T) {
	sent := scriptAgents(t, threeAgents())
	for _, model := range []string{"", "sonnet; rm -rf ~", "son net"} {
		if _, err := (&WshServer{}).AgentsSetModelCommand(context.Background(), wshrpc.CommandAgentsSetModelData{Tab: agentsTabA, Model: model}); err == nil {
			t.Errorf("model %q accepted", model)
		}
	}
	if len(*sent) != 0 {
		t.Fatalf("a refused model was sent: %v", *sent)
	}
}
