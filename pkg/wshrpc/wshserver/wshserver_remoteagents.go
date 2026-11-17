// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"log"

	"github.com/wavetermdev/waveterm/pkg/remotemode"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
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

// RemoteTranscript is remotemode.TranscriptHook: it drains streamTranscript into send, and returns the
// first error from send or from the stream, nil once ctx is done.
func RemoteTranscript(ctx context.Context, path string, tail int, send func(lines []string) error) error {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	ch := make(chan wshrpc.RespOrErrorUnion[wshrpc.AgentTranscriptUpdate], 16)
	streamDone := make(chan error, 1)
	go func() {
		streamDone <- streamTranscript(ctx, path, tail, ch)
	}()
	var first error
	// after the first failure, cancel and keep reading until the stream returns: it sends on ch
	// unguarded, so a reader that left would strand it
	fail := func(err error) {
		if first == nil {
			first = err
			cancel()
		}
	}
	for {
		select {
		case msg := <-ch:
			if first != nil {
				continue
			}
			if msg.Error != nil {
				fail(msg.Error)
			} else if err := send(msg.Response.Lines); err != nil {
				fail(err)
			}
		case err := <-streamDone:
			if err != nil {
				fail(err)
			}
			for {
				select {
				case msg := <-ch:
					if first == nil && msg.Error == nil {
						if err := send(msg.Response.Lines); err != nil {
							fail(err)
						}
					}
				default:
					return first
				}
			}
		}
	}
}
