// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package jarvisstate is the work-ledger query engine (Axis 1): deterministic derivations over the
// two lossless legs (wstore runs + sealed evidence, agentsessions scans) plus the derived layers
// (dossiers, attention). The functions here are pure over already-fetched inputs so tests need no
// OS or RPC; fetch.go is the thin wire layer that fetches the legs.
package jarvisstate

import (
	"sort"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/agentsessions"
	"github.com/wavetermdev/waveterm/pkg/jarvisdossier"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// runTerminalStatuses are the statuses a run can end in; everything else is in-flight.
var runTerminalStatuses = map[string]bool{"done": true, "cancelled": true}

// ActiveWork derives the per-project needs-you surface: in-flight runs with status, live sessions
// (Status is "done" only after the transcript finished), attention items (project resolved
// through the run they wait on), and dossier blockers (dossiers carry no project label — they group
// under "").
// workerORefsFor returns the sorted, deduplicated union of a run's phase worker orefs. Runs carry no
// identity for their workers elsewhere on the wire; this is what lets the frontend suppress a live
// agent already represented by its Run.
func workerORefsFor(r *waveobj.Run) []string {
	var all []string
	for _, p := range r.Phases {
		all = append(all, p.WorkerOrefs...)
	}
	return sortedUnique(all)
}

// sortedUnique drops empties and duplicates and sorts; nil when nothing is left, so the wire omits it.
func sortedUnique(orefs []string) []string {
	seen := make(map[string]bool)
	var out []string
	for _, oref := range orefs {
		if oref != "" && !seen[oref] {
			seen[oref] = true
			out = append(out, oref)
		}
	}
	sort.Strings(out)
	return out
}

// isDagWorker reports a run the engine launched for one task of an orchestrator's DAG. Its lead's run
// stands for it in the ledger; listed on its own it reads as a run you started, one per task.
func isDagWorker(r *waveobj.Run) bool {
	return r.DagORef != "" && r.Mode != "orchestrator"
}

func ActiveWork(runs []*waveobj.Run, sessions []agentsessions.SessionInfo, attention []wshrpc.AttentionItem, dossiers []jarvisdossier.Dossier) []wshrpc.ActiveWorkItem {
	// a worker's tabs ride on its lead's row, which is what keeps them from surfacing as direct agents
	crewTabs := map[string][]string{}
	for _, r := range runs {
		if isDagWorker(r) {
			crewTabs[r.DagORef] = append(crewTabs[r.DagORef], workerORefsFor(r)...)
		}
	}
	var out []wshrpc.ActiveWorkItem
	for _, r := range runs {
		if runTerminalStatuses[r.Status] || isDagWorker(r) {
			continue
		}
		tabs := workerORefsFor(r)
		if r.DagORef != "" && len(crewTabs[r.DagORef]) > 0 {
			tabs = sortedUnique(append(tabs, crewTabs[r.DagORef]...))
		}
		out = append(out, wshrpc.ActiveWorkItem{
			Project: r.ProjectPath, Kind: "run", Title: r.Goal,
			Detail: "status: " + r.Status, Ts: r.CreatedTs, NavTarget: "run:" + r.OID,
			WorkerORefs: tabs, Mode: r.Mode,
		})
	}
	runByID := make(map[string]*waveobj.Run, len(runs))
	for _, r := range runs {
		runByID[r.OID] = r
	}
	for _, a := range attention {
		proj := ""
		if r, ok := runByID[a.RunId]; ok {
			proj = r.ProjectPath
		}
		out = append(out, wshrpc.ActiveWorkItem{
			Project: proj, Kind: "attention", Title: a.Source,
			Detail: a.Action + ": " + a.Text, Ts: a.WaitingSince, NavTarget: "run:" + a.RunId,
		})
	}
	for _, s := range sessions {
		if s.Status == "done" {
			continue
		}
		title := s.Task
		if title == "" {
			title = s.ID
		}
		out = append(out, wshrpc.ActiveWorkItem{
			Project: s.ProjectPath, Kind: "session", Title: title,
			Detail: s.Runtime + " " + s.Model, Ts: s.LastActiveTs,
		})
	}
	for _, d := range dossiers {
		if len(d.Blockers) == 0 {
			continue
		}
		out = append(out, wshrpc.ActiveWorkItem{
			Kind: "blocker", Title: d.Objective, Detail: joinBlockers(d.Blockers),
			Ts: d.Updated, NavTarget: "task:" + d.ID,
		})
	}
	return out
}

func joinBlockers(bs []string) string {
	out := ""
	for i, b := range bs {
		if i > 0 {
			out += ", "
		}
		out += b
	}
	return out
}

// Shipped returns the completed, evidence-sealed runs within the window, newest first.
// windowStartMs 0 means unbounded. A done run without sealed evidence is not "shipped" — the seal
// is the lossless record and its absence means the run's outcome is not trustworthy.
func Shipped(runs []*waveobj.Run, windowStartMs int64) []wshrpc.ShippedItem {
	var out []wshrpc.ShippedItem
	for _, r := range runs {
		if r.Status != "done" || r.Evidence == nil || isDagWorker(r) {
			continue
		}
		if windowStartMs > 0 && r.CompletedTs < windowStartMs {
			continue
		}
		item := wshrpc.ShippedItem{
			Project: r.ProjectPath, RunOID: r.OID, Goal: r.Goal, Summary: r.Evidence.Summary,
			Files: r.Evidence.Files, Verifs: r.Evidence.Verifs, CompletedTs: r.CompletedTs,
			HasReport: strings.TrimSpace(r.Report) != "", Mode: r.Mode,
		}
		if r.EffortRef != nil {
			item.EffortOID, item.ChunkLabel = r.EffortRef.EffortOID, r.EffortRef.ChunkLabel
		}
		out = append(out, item)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].CompletedTs > out[j].CompletedTs })
	return out
}

// DecisionEntry is one vault decision's ledger-relevant projection (a pure input; the fetch layer
// loads it from the decisions collection).
type DecisionEntry struct {
	ID        string
	Summary   string
	CreatedTs int64
}

// Timeline merges run, session, decision, and dossier events into one timestamp-descending stream,
// optionally windowed (windowStartMs 0 = unbounded). Status changes are not event-logged anywhere,
// so a dossier's current status is reported on its UpdatedTs event — the honest shape of the data.
func Timeline(runs []*waveobj.Run, sessions []agentsessions.SessionInfo, decisions []DecisionEntry, dossiers []jarvisdossier.Dossier, efforts []*waveobj.Effort, windowStartMs int64) []wshrpc.TimelineEvent {
	var evs []wshrpc.TimelineEvent
	add := func(ev wshrpc.TimelineEvent) {
		if windowStartMs > 0 && ev.Ts < windowStartMs {
			return
		}
		evs = append(evs, ev)
	}
	for _, r := range runs {
		if isDagWorker(r) {
			continue
		}
		add(wshrpc.TimelineEvent{Ts: r.CreatedTs, Kind: "run-created", Project: r.ProjectPath, Title: r.Goal, Detail: "status: " + r.Status, NavTarget: "run:" + r.OID})
		if r.CompletedTs > 0 {
			detail := ""
			if r.Evidence != nil {
				detail = r.Evidence.Summary
			}
			add(wshrpc.TimelineEvent{Ts: r.CompletedTs, Kind: "run-done", Project: r.ProjectPath, Title: r.Goal, Detail: detail, NavTarget: "run:" + r.OID})
		}
	}
	for _, s := range sessions {
		add(wshrpc.TimelineEvent{Ts: s.StartedTs, Kind: "session", Project: s.ProjectPath, Title: s.Task, Detail: s.Runtime + " " + s.Model})
	}
	for _, d := range decisions {
		add(wshrpc.TimelineEvent{Ts: d.CreatedTs, Kind: "decision", Title: d.Summary})
	}
	for _, d := range dossiers {
		add(wshrpc.TimelineEvent{Ts: d.Updated, Kind: "dossier", Title: d.Objective, Detail: "status: " + d.Status, NavTarget: "task:" + d.ID})
	}
	for _, e := range efforts {
		if e.Status == "archived" {
			continue
		}
		for _, ev := range e.Events {
			detail := ev.Text
			if ev.Label != "" {
				detail = ev.Label + " · " + detail
			}
			add(wshrpc.TimelineEvent{Ts: ev.Ts, Kind: ev.Kind, Project: e.Project, Title: e.Title, Detail: detail, NavTarget: "effort:" + e.OID})
		}
	}
	sort.SliceStable(evs, func(i, j int) bool { return evs[i].Ts > evs[j].Ts })
	return evs
}

// Delta is the bring-up answer: everything new since sinceMs (Timeline windowed) plus attention
// items raised inside the window — the one leg Timeline does not see.
func Delta(sinceMs int64, runs []*waveobj.Run, sessions []agentsessions.SessionInfo, decisions []DecisionEntry, attention []wshrpc.AttentionItem, dossiers []jarvisdossier.Dossier, efforts []*waveobj.Effort) []wshrpc.TimelineEvent {
	evs := Timeline(runs, sessions, decisions, dossiers, efforts, sinceMs)
	runByID := make(map[string]string, len(runs))
	for _, r := range runs {
		runByID[r.OID] = r.ProjectPath
	}
	for _, a := range attention {
		if a.WaitingSince < sinceMs {
			continue
		}
		evs = append(evs, wshrpc.TimelineEvent{
			Ts: a.WaitingSince, Kind: "attention", Project: runByID[a.RunId],
			Title: a.Source, Detail: a.Action + ": " + a.Text, NavTarget: "run:" + a.RunId,
		})
	}
	sort.SliceStable(evs, func(i, j int) bool { return evs[i].Ts > evs[j].Ts })
	return evs
}

// EffortSummaryOf projects one effort into its ledger shape (no trails; the detail RPC serves those).
func EffortSummaryOf(e *waveobj.Effort) wshrpc.EffortSummary {
	s := wshrpc.EffortSummary{
		ORef: "effort:" + e.OID, Title: e.Title, Project: e.Project, Ticket: e.Ticket,
		Status: e.Status, ParentOID: e.ParentOID, UpdatedTs: e.UpdatedTs,
	}
	for _, c := range e.Chunks {
		s.Chunks = append(s.Chunks, wshrpc.EffortChunkSummary{
			Label: c.Label, Status: c.Status, Stage: c.Stage, Owner: c.Owner, WorkRefs: c.WorkRefs,
		})
		if c.Status == "done" {
			s.Done++
		}
		// a proposed chunk is the agent's suggestion until accepted: not part of the work yet
		if c.Status != "proposed" {
			s.Total++
		}
	}
	for _, c := range e.Chunks {
		if c.Status == "active" {
			s.ActiveChunk = c.Label
			break
		}
	}
	if s.ActiveChunk == "" {
		for _, c := range e.Chunks {
			if c.Status != "done" && c.Status != "skipped" && c.Status != "proposed" {
				s.ActiveChunk = c.Label
				break
			}
		}
	}
	s.LastNote = lastNoteOf(e)
	return s
}

// LastNoteMaxChars caps the newest note a summary carries. Agent notes run to several paragraphs, and every
// summary ships in every ledger snapshot; the Brief shows one truncated line of it.
const LastNoteMaxChars = 240

func lastNoteOf(e *waveobj.Effort) *wshrpc.EffortLastNote {
	var newest *waveobj.EffortNote
	chunk := ""
	consider := func(notes []waveobj.EffortNote, label string) {
		for i := range notes {
			if newest == nil || notes[i].Ts > newest.Ts {
				newest = &notes[i]
				chunk = label
			}
		}
	}
	consider(e.Notes, "")
	for _, c := range e.Chunks {
		consider(c.Notes, c.Label)
	}
	if newest == nil {
		return nil
	}
	text, _, _ := strings.Cut(strings.TrimSpace(newest.Text), "\n")
	if r := []rune(text); len(r) > LastNoteMaxChars {
		text = string(r[:LastNoteMaxChars])
	}
	return &wshrpc.EffortLastNote{
		Ts: newest.Ts, Text: strings.TrimSpace(text), Chunk: chunk, Author: newest.Author, Session: newest.Session,
	}
}

// Efforts projects the non-archived efforts, newest-updated first (input already sorted).
func Efforts(es []*waveobj.Effort) []wshrpc.EffortSummary {
	var out []wshrpc.EffortSummary
	for _, e := range es {
		if e.Status == "archived" {
			continue
		}
		out = append(out, EffortSummaryOf(e))
	}
	return out
}
