// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"log"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/resmon"
	"github.com/wavetermdev/waveterm/pkg/util/jobobject"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

const (
	resMonClosedTab   = "Closed tab"
	resMonRunFallback = "Orchestrator run" // runTitle's fallback in frontend/app/view/agents/runlineage.ts
	resMonLabelSep    = " · "
)

func (ws *WshServer) ResMonSnapshotCommand(ctx context.Context, data wshrpc.CommandResMonSnapshotData) (*wshrpc.ResMonSnapshotData, error) {
	rtn := resmon.Snapshot(ctx, resolveResMonOwner)
	return &rtn, nil
}

func (ws *WshServer) ResMonKillCommand(ctx context.Context, data wshrpc.CommandResMonKillData) (*wshrpc.ResMonKillRtnData, error) {
	rtn := resmon.Kill(ctx, resolveResMonOwner, data)
	return &rtn, nil
}

func (ws *WshServer) ResMonKillChildrenCommand(ctx context.Context, data wshrpc.CommandResMonKillChildrenData) (*wshrpc.ResMonKillRtnData, error) {
	rtn := resmon.KillChildren(ctx, resolveResMonOwner, data)
	return &rtn, nil
}

func (ws *WshServer) ResMonKillShellTaskCommand(ctx context.Context, data wshrpc.CommandResMonKillShellTaskData) (*wshrpc.ResMonKillRtnData, error) {
	rtn := resmon.KillShellTask(ctx, resolveResMonOwner, data)
	return &rtn, nil
}

// resolveResMonOwner names a job's owner from the store; an owner it cannot resolve still gets a group.
func resolveResMonOwner(ctx context.Context, o jobobject.Owner) resmon.OwnerInfo {
	if o.Kind == jobobject.OwnerKind_RunCmd {
		run, err := wstore.DBGet[*waveobj.Run](ctx, o.Id)
		if err != nil {
			log.Printf("resmon: loading run %s: %v", o.Id, err)
		}
		label := resMonRunTitle(ctx, run)
		if o.Task != "" {
			label += resMonLabelSep + "Task " + o.Task + " " + o.Cmd
		} else {
			label += resMonLabelSep + o.Cmd
		}
		return resmon.OwnerInfo{Kind: wshrpc.ResMonOwner_RunCmd, Label: label}
	}
	closed := resmon.OwnerInfo{Kind: wshrpc.ResMonOwner_AgentTab, Label: resMonClosedTab}
	block, err := wstore.DBGet[*waveobj.Block](ctx, o.Id)
	if err != nil || block == nil {
		return closed
	}
	tabORef, err := waveobj.ParseORef(block.ParentORef)
	if err != nil || tabORef.OType != waveobj.OType_Tab {
		return closed
	}
	tab, err := wstore.DBGet[*waveobj.Tab](ctx, tabORef.OID)
	if err != nil || tab == nil {
		return closed
	}
	runtime := tab.Meta.GetString(waveobj.MetaKey_SessionAgent, "")
	info := resmon.OwnerInfo{Kind: wshrpc.ResMonOwner_AgentTab, Label: tab.Name, Runtime: runtime, Agent: runtime != ""}
	if run, _, ok := ownerRunForBlock(ctx, "block:"+o.Id); ok {
		info.Kind, info.Label = wshrpc.ResMonOwner_RunWorker, resMonWorkerLabel(ctx, run)
	}
	return info
}

// resMonWorkerLabel is the owning run's title, then the worker's place in it.
func resMonWorkerLabel(ctx context.Context, run *waveobj.Run) string {
	var dag *waveobj.TaskGroup
	if run.DagORef != "" {
		var err error
		if dag, err = wstore.GetDag(ctx, run.DagORef); err != nil {
			log.Printf("resmon: loading dag %s of run %s: %v", run.DagORef, run.OID, err)
			dag = nil
		}
	}
	link, placed := runLinkOf(run, dag)
	if !placed {
		return resMonRunTitle(ctx, run)
	}
	owner := run
	if link.RunId != run.OID {
		var err error
		if owner, err = wstore.DBGet[*waveobj.Run](ctx, link.RunId); err != nil {
			log.Printf("resmon: loading run %s: %v", link.RunId, err)
		}
	}
	title := resMonDagTitle(dag, owner)
	switch {
	case link.Role == sessionRole_Lead:
		return title + resMonLabelSep + "lead"
	case link.Role == sessionRole_Review:
		return title + resMonLabelSep + "reviewer"
	case link.Role != sessionRole_Worker:
		return title + resMonLabelSep + link.Role // a stage session: plan-reviewer, verifier or land-resolver
	case link.TaskId != "":
		return title + resMonLabelSep + "Task " + link.TaskId
	}
	return title
}

// resMonRunTitle is the run's dag title, else the first line of its goal.
func resMonRunTitle(ctx context.Context, run *waveobj.Run) string {
	var dag *waveobj.TaskGroup
	if run != nil && run.DagORef != "" {
		var err error
		if dag, err = wstore.GetDag(ctx, run.DagORef); err != nil {
			dag = nil
		}
	}
	return resMonDagTitle(dag, run)
}

func resMonDagTitle(dag *waveobj.TaskGroup, run *waveobj.Run) string {
	if dag != nil {
		if title := strings.TrimSpace(dag.Title); title != "" {
			return title
		}
	}
	if run != nil {
		if goal, _, _ := strings.Cut(strings.TrimSpace(run.Goal), "\n"); goal != "" {
			return goal
		}
	}
	return resMonRunFallback
}
