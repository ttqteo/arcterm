// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"fmt"
	"os"

	"github.com/wavetermdev/waveterm/pkg/agentsync"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func (ws *WshServer) AgentSyncStatusCommand(ctx context.Context) (*wshrpc.CommandAgentSyncStatusRtnData, error) {
	p := agentsync.DefaultPaths()
	rows, err := agentsync.Status(p)
	if err != nil {
		return nil, fmt.Errorf("reading harness sync status: %w", err)
	}
	out := make([]wshrpc.AgentSyncHarness, len(rows))
	for i, r := range rows {
		out[i] = wshrpc.AgentSyncHarness{
			Runtime: r.Runtime, Label: r.Label, Present: r.Present, Path: r.Path, Steering: r.Steering,
			SkillsManaged: r.SkillsManaged, SkillsUnmanaged: r.SkillsUnmanaged, Note: r.Note,
		}
	}
	return &wshrpc.CommandAgentSyncStatusRtnData{Harnesses: out, SteeringDoc: p.SteeringDoc, SkillsRoot: p.SkillsRoot}, nil
}

func (ws *WshServer) AgentSyncApplyCommand(ctx context.Context, data wshrpc.CommandAgentSyncApplyData) (*wshrpc.CommandAgentSyncApplyRtnData, error) {
	actions, err := agentsync.Apply(agentsync.DefaultPaths(), data.DryRun)
	if err != nil {
		return nil, fmt.Errorf("syncing harness config: %w", err)
	}
	out := make([]wshrpc.AgentSyncAction, len(actions))
	for i, a := range actions {
		out[i] = wshrpc.AgentSyncAction{Kind: a.Kind, Runtime: a.Runtime, Path: a.Path, Detail: a.Detail}
	}
	return &wshrpc.CommandAgentSyncApplyRtnData{Actions: out}, nil
}

func (ws *WshServer) AgentSyncAdoptCommand(ctx context.Context, data wshrpc.CommandAgentSyncAdoptData) (*wshrpc.CommandAgentSyncAdoptRtnData, error) {
	plan, err := agentsync.Adopt(agentsync.DefaultPaths(), data.Apply, data.Keep)
	rtn := &wshrpc.CommandAgentSyncAdoptRtnData{Moves: skillMoves(plan.Moves), Unresolved: plan.Unresolved}
	if err != nil {
		// a partial plan is data the caller must see, not just an error string
		return rtn, fmt.Errorf("adopting harness skills: %w", err)
	}
	return rtn, nil
}

func (ws *WshServer) AgentSyncSteeringReadCommand(ctx context.Context) (*wshrpc.CommandAgentSyncSteeringReadRtnData, error) {
	path := agentsync.DefaultPaths().SteeringDoc
	content, err := os.ReadFile(path)
	if err != nil && !os.IsNotExist(err) {
		return nil, fmt.Errorf("reading the shared steering doc: %w", err)
	}
	var mtime int64
	if st, statErr := os.Stat(path); statErr == nil {
		mtime = st.ModTime().UnixMilli()
	}
	return &wshrpc.CommandAgentSyncSteeringReadRtnData{Path: path, Content: string(content), Mtime: mtime}, nil
}

func (ws *WshServer) AgentSyncSteeringWriteCommand(ctx context.Context, data wshrpc.CommandAgentSyncSteeringWriteData) (*wshrpc.CommandAgentSyncSteeringWriteRtnData, error) {
	res, err := agentsync.WriteSteering(agentsync.DefaultPaths(), data.Content, data.BaseMtime)
	if err != nil {
		return nil, fmt.Errorf("writing the shared steering doc: %w", err)
	}
	return &wshrpc.CommandAgentSyncSteeringWriteRtnData{Mtime: res.Mtime, Conflict: res.Conflict}, nil
}

func skillMoves(moves []agentsync.SkillMove) []wshrpc.AgentSyncSkillMove {
	out := make([]wshrpc.AgentSyncSkillMove, 0, len(moves))
	for _, m := range moves {
		out = append(out, wshrpc.AgentSyncSkillMove{
			Runtime: m.Runtime, Name: m.Name, From: m.From, Seed: m.Seed,
			Keys: m.Keys, Files: m.Files, BodyDiff: m.BodyDiff,
		})
	}
	return out
}

func (ws *WshServer) AgentSyncSkillsCommand(ctx context.Context) (*wshrpc.CommandAgentSyncSkillsRtnData, error) {
	p := agentsync.DefaultPaths()
	rows, err := agentsync.SkillRows(p)
	if err != nil {
		return nil, fmt.Errorf("reading canonical skills: %w", err)
	}
	out := make([]wshrpc.AgentSyncSkill, len(rows))
	for i, r := range rows {
		out[i] = wshrpc.AgentSyncSkill{Name: r.Name, Description: r.Description, States: r.States, Deltas: r.Deltas}
		for _, a := range r.Additions {
			out[i].Additions = append(out[i].Additions, learnAddition(a.Key, a.Text, a.Learned, a.Count))
		}
	}
	cols := make([]wshrpc.AgentSyncSkillColumn, 0)
	for _, c := range agentsync.SkillColumns(p) {
		cols = append(cols, wshrpc.AgentSyncSkillColumn{Runtime: c.Runtime, Label: c.Label, Present: c.Present})
	}
	plan, err := agentsync.PlanAdopt(p, nil)
	if err != nil {
		return nil, fmt.Errorf("planning skill adoption: %w", err)
	}
	unresolved := plan.Unresolved
	if unresolved == nil {
		unresolved = []string{}
	}
	return &wshrpc.CommandAgentSyncSkillsRtnData{
		Skills: out, Columns: cols, SkillsRoot: p.SkillsRoot,
		Unmanaged: skillMoves(plan.Moves), Unresolved: unresolved,
	}, nil
}
