// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/resmon"
	"github.com/wavetermdev/waveterm/pkg/util/jobobject"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// seedResMonTab stores a tab named name with one block and returns the block id and the tab oref.
func seedResMonTab(t *testing.T, name, agent string) (blockId, tabORef string) {
	t.Helper()
	ctx := context.Background()
	tab := &waveobj.Tab{OID: uuid.NewString(), Name: name, Meta: waveobj.MetaMapType{}}
	if agent != "" {
		tab.Meta[waveobj.MetaKey_SessionAgent] = agent
	}
	if err := wstore.DBInsert(ctx, tab); err != nil {
		t.Fatal(err)
	}
	block := &waveobj.Block{OID: uuid.NewString(), ParentORef: "tab:" + tab.OID}
	if err := wstore.DBInsert(ctx, block); err != nil {
		t.Fatal(err)
	}
	return block.OID, "tab:" + tab.OID
}

func workerPhase(tabORef string) []waveobj.RunPhase {
	return []waveobj.RunPhase{{Kind: "execute", State: "running", WorkerOrefs: []string{tabORef}}}
}

func TestResMonResolverLabels(t *testing.T) {
	ctx := context.Background()
	blockOwner := func(id string) jobobject.Owner { return jobobject.Owner{Kind: jobobject.OwnerKind_Block, Id: id} }

	agentBlock, _ := seedResMonTab(t, "waveterm", "claude")
	shellBlock, _ := seedResMonTab(t, "scratch", "")
	leadBlock, leadTab := seedResMonTab(t, "lead tab", "pi")
	workerBlock, workerTab := seedResMonTab(t, "worker tab", "pi")

	lead := seedUsageRun(t, "", waveobj.Run{Mode: "orchestrator", Goal: "the goal\nmore", DagORef: uuid.NewString(), Phases: workerPhase(leadTab)})
	dag := waveobj.TaskGroup{OID: lead.DagORef, ID: lead.DagORef, RunID: lead.ID, ChannelId: lead.ChannelOID, Title: "cache-miss notice",
		Tasks: []waveobj.TaskNode{{ID: "2"}}}
	if err := wstore.AppendDag(ctx, &dag); err != nil {
		t.Fatal(err)
	}
	seedUsageRun(t, lead.ChannelOID, waveobj.Run{TaskId: "2", DagORef: lead.DagORef, Phases: workerPhase(workerTab)})
	quick := seedUsageRun(t, "", waveobj.Run{Mode: "quick", Goal: "fix the cache\nthen tidy"})

	cases := []struct {
		name  string
		owner jobobject.Owner
		want  resmon.OwnerInfo
	}{
		{"agent tab", blockOwner(agentBlock), resmon.OwnerInfo{Kind: wshrpc.ResMonOwner_AgentTab, Label: "waveterm", Runtime: "claude", Agent: true}},
		{"terminal tab", blockOwner(shellBlock), resmon.OwnerInfo{Kind: wshrpc.ResMonOwner_AgentTab, Label: "scratch"}},
		{"run worker", blockOwner(workerBlock), resmon.OwnerInfo{Kind: wshrpc.ResMonOwner_RunWorker, Label: "cache-miss notice · Task 2", Runtime: "pi", Agent: true}},
		{"run lead", blockOwner(leadBlock), resmon.OwnerInfo{Kind: wshrpc.ResMonOwner_RunWorker, Label: "cache-miss notice · lead", Runtime: "pi", Agent: true}},
		{"run command", jobobject.Owner{Kind: jobobject.OwnerKind_RunCmd, Id: lead.ID, Cmd: "Verify"},
			resmon.OwnerInfo{Kind: wshrpc.ResMonOwner_RunCmd, Label: "cache-miss notice · Verify"}},
		{"run command at a merge", jobobject.Owner{Kind: jobobject.OwnerKind_RunCmd, Id: lead.ID, Cmd: "Verify", Task: "2"},
			resmon.OwnerInfo{Kind: wshrpc.ResMonOwner_RunCmd, Label: "cache-miss notice · Task 2 Verify"}},
		{"run command without a dag", jobobject.Owner{Kind: jobobject.OwnerKind_RunCmd, Id: quick.ID, Cmd: "Setup"},
			resmon.OwnerInfo{Kind: wshrpc.ResMonOwner_RunCmd, Label: "fix the cache · Setup"}},
		{"run command of a gone run", jobobject.Owner{Kind: jobobject.OwnerKind_RunCmd, Id: uuid.NewString(), Cmd: "Final"},
			resmon.OwnerInfo{Kind: wshrpc.ResMonOwner_RunCmd, Label: "Orchestrator run · Final"}},
		{"unresolvable block", blockOwner(uuid.NewString()), resmon.OwnerInfo{Kind: wshrpc.ResMonOwner_AgentTab, Label: "Closed tab"}},
	}
	for _, c := range cases {
		if got := resolveResMonOwner(ctx, c.owner); got != c.want {
			t.Errorf("%s: got %+v, want %+v", c.name, got, c.want)
		}
	}
}
