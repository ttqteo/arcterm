// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"fmt"
	"log"

	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/orchestrate"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

const (
	sessionRole_Lead   = "lead"
	sessionRole_Worker = "worker"
	sessionRole_Review = "review"
)

type sessionRunLink struct {
	RunId     string
	ChannelId string
	TaskId    string
	Role      string
}

// runLinkOf places a run launched under a session: the lead of an orchestrator run, or a child working one of
// its dag's tasks, or a stage session judging the whole dag. A plain run, or a child whose dag is gone, is not placed.
func runLinkOf(run *waveobj.Run, dag *waveobj.TaskGroup) (sessionRunLink, bool) {
	if run.DagORef != "" && dag != nil {
		if dag.RunID == run.OID {
			return sessionRunLink{RunId: run.OID, ChannelId: run.ChannelOID, Role: sessionRole_Lead}, true
		}
		link := sessionRunLink{RunId: dag.RunID, ChannelId: dag.ChannelId, TaskId: run.TaskId, Role: sessionRole_Worker}
		if run.StageRole != "" {
			// a plan reviewer or final verifier works no task: its stage is its place in the run
			link.Role = run.StageRole
			return link, true
		}
		if run.Review {
			link.Role = sessionRole_Review
		}
		if link.TaskId == "" {
			// launched before the task was recorded on the run: only the task's current links place it
			for _, t := range dag.Tasks {
				if t.RunID == run.OID {
					link.TaskId = t.ID
					break
				}
				if t.ReviewRunID == run.OID {
					link.TaskId, link.Role = t.ID, sessionRole_Review
					break
				}
			}
		}
		return link, true
	}
	if run.Mode == jarvis.RunMode_Orchestrator {
		return sessionRunLink{RunId: run.OID, ChannelId: run.ChannelOID, Role: sessionRole_Lead}, true
	}
	return sessionRunLink{}, false
}

// linkSessionsToRuns stamps each session an orchestrator run launched with its place in that run: from the run
// recorded under its session id, else from what its transcript says (orchestrate.LaunchOriginOf), which places it
// in the run with no channel when this store never saw the run.
func linkSessionsToRuns(ctx context.Context, sessions []wshrpc.SessionActivity) error {
	defer linkSessionsByOrigin(sessions)
	ids := make([]string, 0, len(sessions))
	for _, s := range sessions {
		ids = append(ids, s.ID)
	}
	runs, err := wstore.GetRunsBySessionIds(ctx, ids)
	if err != nil {
		return fmt.Errorf("loading runs by session: %w", err)
	}
	bySession := make(map[string]*waveobj.Run, len(runs))
	for _, r := range runs {
		bySession[r.SessionId] = r
	}
	dags := map[string]*waveobj.TaskGroup{}
	for i := range sessions {
		run := bySession[sessions[i].ID]
		if run == nil {
			continue
		}
		var dag *waveobj.TaskGroup
		if run.DagORef != "" {
			var ok bool
			if dag, ok = dags[run.DagORef]; !ok {
				if dag, err = wstore.GetDag(ctx, run.DagORef); err != nil {
					log.Printf("sessions: loading dag %s of run %s: %v", run.DagORef, run.OID, err)
					dag = nil
				}
				dags[run.DagORef] = dag
			}
		}
		link, ok := runLinkOf(run, dag)
		if !ok {
			continue
		}
		sessions[i].RunId, sessions[i].ChannelId = link.RunId, link.ChannelId
		sessions[i].TaskId, sessions[i].Role = link.TaskId, link.Role
	}
	return nil
}

// linkSessionsByOrigin places the sessions no recorded run claimed by their own transcript. It also runs when the
// store read fails, so the run's sessions stay out of the plain list either way.
func linkSessionsByOrigin(sessions []wshrpc.SessionActivity) {
	for i := range sessions {
		if sessions[i].RunId != "" {
			continue
		}
		if o, ok := orchestrate.LaunchOriginOf(sessions[i].ProjectPath, sessions[i].Task); ok {
			sessions[i].RunId, sessions[i].TaskId, sessions[i].Role = o.RunID, o.TaskID, o.Role
		}
	}
}
