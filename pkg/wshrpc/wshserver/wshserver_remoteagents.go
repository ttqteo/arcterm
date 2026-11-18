// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"log"

	"github.com/wavetermdev/waveterm/pkg/remotemode"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

// RemoteAgents is remotemode.AgentsHook: one Agent per roster row. It reads the roster only, never
// remotemode, since remotemode calls it from inside Status.
func RemoteAgents(ctx context.Context) ([]remotemode.Agent, error) {
	facts, err := loadAgentRosterFacts(ctx)
	if err != nil {
		return nil, err
	}
	rows := buildAgentRoster(facts)
	agents := make([]remotemode.Agent, 0, len(rows))
	for i := range rows {
		row := &rows[i]
		tpath, err := agentTranscriptPath(ctx, row)
		if err != nil {
			log.Printf("remote agents: transcript path for tab %s: %v\n", row.TabId, err)
			tpath = ""
		}
		agents = append(agents, remotemode.Agent{
			TabId:          row.TabId,
			BlockId:        row.blockId,
			Name:           row.Name,
			Project:        row.Project,
			Harness:        row.Harness,
			TranscriptPath: tpath,
			Status:         row.status,
			OpenAsk:        row.openAsk,
			HasStream:      row.hasStream,
			RunWorker:      isRunWorker(ownerRun(facts.Runs, row.TabId)),
		})
	}
	return agents, nil
}

// isRunWorker is true for the sessions the engine or a lead started: task workers, task reviewers, stage
// sessions and `wsh jarvis run` children. An orchestrator lead's own run has none of the four, nor does a
// Quick run's agent, so both can be handed over.
func isRunWorker(run *waveobj.Run) bool {
	return run != nil && (run.TaskId != "" || run.Review || run.StageRole != "" || run.ParentLeadORef != "")
}
