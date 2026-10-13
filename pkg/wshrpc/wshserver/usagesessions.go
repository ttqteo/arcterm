// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"fmt"
	"log"
	"regexp"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/usagestats"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

const (
	usageHarness_Claude = "claude"
	usageHarness_Pi     = "pi"
)

// a worktree folder directly under one of the roots that hold them: git's, claude's, and the engine's lanes
var worktreeTailRe = regexp.MustCompile(`[\\/](?:\.worktrees|\.claude[\\/]worktrees|\.waveterm[\\/]worktrees)[\\/][^\\/]+[\\/]?$`)

// repoRootOf cuts a worktree path back to the repo that holds it. Any other path is returned as it is.
func repoRootOf(path string) string {
	return worktreeTailRe.ReplaceAllString(path, "")
}

// usageSessions builds the usage directory: one entry per scanned session, with the run and project it was
// spent on. Only claude and pi sessions are launched by runs, so only they are looked up.
func usageSessions(ctx context.Context, metas []usagestats.SessionMeta) ([]wshrpc.UsageSessionMeta, error) {
	var ids []string
	for _, m := range metas {
		if runHarness(m.Harness) {
			ids = append(ids, m.Session)
		}
	}
	bySession, err := runsBySession(ctx, ids)
	if err != nil {
		return nil, err
	}
	dags := map[string]*waveobj.TaskGroup{}
	owners := map[string]*waveobj.Run{}
	out := make([]wshrpc.UsageSessionMeta, len(metas))
	for i, m := range metas {
		s := wshrpc.UsageSessionMeta{Harness: m.Harness, Session: m.Session, Title: m.Title, Project: repoRootOf(m.Cwd)}
		if run := bySession[m.Session]; run != nil && runHarness(m.Harness) {
			if err := linkUsageSession(ctx, &s, run, dags, owners); err != nil {
				return nil, err
			}
		}
		out[i] = s
	}
	return out, nil
}

func runHarness(harness string) bool {
	return harness == usageHarness_Claude || harness == usageHarness_Pi
}

// linkUsageSession fills s's run fields from the run launched under it. dags and owners cache the store
// reads across one call, a nil entry included.
func linkUsageSession(ctx context.Context, s *wshrpc.UsageSessionMeta, run *waveobj.Run, dags map[string]*waveobj.TaskGroup, owners map[string]*waveobj.Run) error {
	var dag *waveobj.TaskGroup
	if run.DagORef != "" {
		var ok bool
		if dag, ok = dags[run.DagORef]; !ok {
			var err error
			if dag, err = wstore.GetDag(ctx, run.DagORef); err != nil {
				log.Printf("usage: loading dag %s of run %s: %v", run.DagORef, run.OID, err)
				dag = nil
			}
			dags[run.DagORef] = dag
		}
	}
	link, placed := runLinkOf(run, dag)
	if !placed {
		if run.DagORef != "" {
			// a child whose dag is gone: nothing says which run it worked for
			return nil
		}
		// a quick run is its own work item
		link = sessionRunLink{RunId: run.OID, ChannelId: run.ChannelOID}
	}
	owner := run
	if link.RunId != run.OID {
		var ok bool
		if owner, ok = owners[link.RunId]; !ok {
			var err error
			if owner, err = wstore.DBGet[*waveobj.Run](ctx, link.RunId); err != nil {
				return fmt.Errorf("loading run %s that owns session %s: %w", link.RunId, s.Session, err)
			}
			owners[link.RunId] = owner
		}
		if owner == nil {
			log.Printf("usage: run %s that owns session %s is gone", link.RunId, s.Session)
			return nil
		}
	}
	s.RunId, s.ChannelId, s.TaskId = link.RunId, link.ChannelId, link.TaskId
	s.RunMode = owner.Mode
	goal, _, _ := strings.Cut(strings.TrimSpace(owner.Goal), "\n")
	s.RunGoal = strings.TrimSpace(goal)
	if placed {
		s.Role = jarvis.UsageRole(run)
		if s.Role == jarvis.UsageRole_Lead && link.Role != sessionRole_Lead {
			// a legacy child carries no task on its run, so only the dag's link says what it did
			s.Role = jarvis.UsageRole_Worker
			if link.Role == sessionRole_Review {
				s.Role = jarvis.UsageRole_Reviewer
			}
		}
	}
	if owner.ProjectPath != "" {
		s.Project = repoRootOf(owner.ProjectPath)
	}
	return nil
}
