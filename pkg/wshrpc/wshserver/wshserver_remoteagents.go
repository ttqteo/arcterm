// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"log"
	"slices"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/wavetermdev/waveterm/pkg/agentask"
	"github.com/wavetermdev/waveterm/pkg/remotemode"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// remoteLineMax is the longest run name or worker line the phone is sent, in characters: a run's goal can
// be kilobytes.
const remoteLineMax = 160

// loadRemoteTaskGroup reads a dag's TaskGroup by its oid. A var so tests script it beside
// loadAgentRosterFacts, with no store.
var loadRemoteTaskGroup = func(ctx context.Context, oid string) (*waveobj.TaskGroup, error) {
	return wstore.DBGet[*waveobj.TaskGroup](ctx, oid)
}

// RemoteAgents is remotemode.AgentsHook: one Agent per roster row. It reads the roster only, never
// remotemode, since remotemode calls it from inside Status.
func RemoteAgents(ctx context.Context) ([]remotemode.Agent, error) {
	facts, err := loadAgentRosterFacts(ctx)
	if err != nil {
		return nil, err
	}
	rows := buildAgentRoster(facts)
	runs := newRemoteRuns(ctx, facts)
	agents := make([]remotemode.Agent, 0, len(rows))
	for i := range rows {
		row := &rows[i]
		tpath, err := agentTranscriptPath(ctx, row)
		if err != nil {
			log.Printf("remote agents: transcript path for tab %s: %v\n", row.TabId, err)
			tpath = ""
		}
		agent := remotemode.Agent{
			TabId:          row.TabId,
			BlockId:        row.blockId,
			Name:           row.Name,
			Project:        row.Project,
			Harness:        row.Harness,
			TranscriptPath: tpath,
			Status:         row.status,
			OpenAsk:        row.openAsk,
			Ask:            remoteAskText(row.blockId),
			HasStream:      row.hasStream,
		}
		if run := ownerRun(facts.Runs, row.TabId); isRunWorker(run) {
			agent.RunWorker = true
			agent.RunKey, agent.RunName, agent.RunLine = runs.fields(run)
		}
		agents = append(agents, agent)
	}
	return agents, nil
}

// isRunWorker is true for the sessions the engine or a lead started: task workers, task reviewers, stage
// sessions and `wsh jarvis run` children. An orchestrator lead's own run has none of the four, nor does a
// Quick run's agent, so both can be handed over.
func isRunWorker(run *waveobj.Run) bool {
	return run != nil && (run.TaskId != "" || run.Review || run.StageRole != "" || run.ParentLeadORef != "")
}

// remoteAskText is the text of the first question of the ask open on the block, "" when none is or it has no
// question. The roster facts keep only whether an ask is open.
func remoteAskText(blockId string) string {
	if blockId == "" {
		return ""
	}
	pending, ok := agentask.GlobalRegistry.Get(waveobj.MakeORef(waveobj.OType_Block, blockId).String())
	if !ok || len(pending.Questions) == 0 {
		return ""
	}
	return strings.TrimSpace(pending.Questions[0].Question)
}

// remoteRuns names the run a worker belongs to for one RemoteAgents call: it loads each distinct TaskGroup
// once, and keeps a run's name so every worker of a run carries the same one.
type remoteRuns struct {
	ctx    context.Context
	facts  *agentRosterFacts
	groups map[string]*waveobj.TaskGroup // by dag oid; nil where the load failed or found nothing
	names  map[string]string             // by run key, set by the run's first worker
}

func newRemoteRuns(ctx context.Context, facts *agentRosterFacts) *remoteRuns {
	return &remoteRuns{ctx: ctx, facts: facts, groups: map[string]*waveobj.TaskGroup{}, names: map[string]string{}}
}

// fields are the run's group key, the run's name and the worker's own line.
func (rr *remoteRuns) fields(run *waveobj.Run) (key, name, line string) {
	key = remoteRunKey(run)
	name, ok := rr.names[key]
	if !ok {
		name = rr.runName(run)
		rr.names[key] = name
	}
	return key, name, rr.workerLine(run)
}

// remoteRunKey groups a run's workers: the dag they share, else the lead that spawned them, else the run.
func remoteRunKey(run *waveobj.Run) string {
	switch {
	case run.DagORef != "":
		return run.DagORef
	case run.ParentLeadORef != "":
		return "lead:" + run.ParentLeadORef
	}
	return run.OID
}

// runName is the goal of the dag's lead run, that is the run sharing its DagORef that works no task, reviews
// none and holds no stage; for a lead's `wsh jarvis run` child the lead tab's name. A run with neither is
// named by the goal of the worker asking, which is the first of its workers.
func (rr *remoteRuns) runName(run *waveobj.Run) string {
	switch {
	case run.DagORef != "":
		var lead *waveobj.Run
		for _, r := range rr.facts.Runs {
			if r.DagORef == run.DagORef && r.TaskId == "" && !r.Review && r.StageRole == "" &&
				(lead == nil || r.CreatedTs > lead.CreatedTs) {
				lead = r
			}
		}
		if lead != nil {
			return remoteGoalLine(lead.Goal)
		}
	case run.ParentLeadORef != "":
		leadTab := strings.TrimPrefix(run.ParentLeadORef, "tab:")
		for _, tf := range rr.facts.Tabs {
			if tf.Tab.OID == leadTab && tf.Tab.Name != "" {
				return tf.Tab.Name
			}
		}
	}
	return remoteGoalLine(run.Goal)
}

// workerLine is what the worker is for: a stage session's role, a task worker's task label, "Review: " and
// the label for its reviewer. A worker whose task cannot be read has its run's goal.
func (rr *remoteRuns) workerLine(run *waveobj.Run) string {
	if run.StageRole != "" {
		return stageRoleLine(run.StageRole)
	}
	if run.TaskId != "" && run.DagORef != "" {
		if g := rr.taskGroup(run.DagORef); g != nil {
			if i := slices.IndexFunc(g.Tasks, func(t waveobj.TaskNode) bool { return t.ID == run.TaskId }); i >= 0 {
				label := g.Tasks[i].Label
				if label == "" {
					label = run.TaskId
				}
				if run.Review {
					return "Review: " + label
				}
				return label
			}
		}
	}
	return remoteGoalLine(run.Goal)
}

// taskGroup is the dag's group, loaded at most once per call; a failed load is logged and reads as none.
func (rr *remoteRuns) taskGroup(oid string) *waveobj.TaskGroup {
	if g, ok := rr.groups[oid]; ok {
		return g
	}
	g, err := loadRemoteTaskGroup(rr.ctx, oid)
	if err != nil {
		log.Printf("remote agents: load task group %s: %v\n", oid, err)
		g = nil
	}
	rr.groups[oid] = g
	return g
}

// stageRoleLine words a dag stage session's role.
func stageRoleLine(role string) string {
	switch role {
	case "plan-reviewer":
		return "Plan reviewer"
	case "verifier":
		return "Verifier"
	case "land-resolver":
		return "Land resolver"
	}
	role = strings.ReplaceAll(role, "-", " ")
	r, n := utf8.DecodeRuneInString(role)
	if n == 0 {
		return role
	}
	return string(unicode.ToUpper(r)) + role[n:]
}

// remoteGoalLine is the first non-empty line of a goal, cut to remoteLineMax characters.
func remoteGoalLine(goal string) string {
	var line string
	for l := range strings.Lines(goal) {
		if line = strings.TrimSpace(l); line != "" {
			break
		}
	}
	if r := []rune(line); len(r) > remoteLineMax {
		return strings.TrimRight(string(r[:remoteLineMax-1]), " \t") + "…"
	}
	return line
}
