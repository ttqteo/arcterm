// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"fmt"
	"log"
	"path"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/consult"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/workflowscan"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

const (
	workflowScanWindowDays = 14
	// the one Sonnet pass reads up to ~160k tokens of corpus
	workflowScanModelTimeout = 15 * time.Minute
	workflowScanRuntime      = "claude"
	workflowScanModelId      = "opus"
)

// workflowScanModel is the Sonnet pass. A var so tests script the reply and read the spec and cwd it got.
var workflowScanModel = func(ctx context.Context, spec consult.RuntimeSpec, cwd, prompt string) (string, error) {
	return consult.Run(ctx, spec, cwd, prompt, func(string) {})
}

// workflowScanNow is the scan's clock, the end of its window. A var so tests can place the window.
var workflowScanNow = time.Now

// runProjectName is the project a run belongs to: its channel's name, else the base name of its project path, split on
// either separator so a run made on Windows names its project on the Mac too.
func runProjectName(run *waveobj.Run, channels map[string]*waveobj.Channel) string {
	if ch := channels[run.ChannelOID]; ch != nil && ch.Name != "" {
		return ch.Name
	}
	return path.Base(strings.ReplaceAll(run.ProjectPath, `\`, "/"))
}

func windowDaysOr(days int) int {
	if days <= 0 {
		return workflowScanWindowDays
	}
	return days
}

// activeWorkflowScan is the scan, in any project, that is still live, nil when none is: one scan runs at a time.
// A scan whose run ended keeps the state it had, so a run that died mid-scan must not block the next one. A
// scan stays picking while its agent asks the owner, so the run's own Done or Cancelled is what ends it.
func activeWorkflowScan(ctx context.Context) (*waveobj.Run, error) {
	runs, err := wstore.GetWorkflowScanRuns(ctx)
	if err != nil {
		return nil, fmt.Errorf("loading scan runs: %w", err)
	}
	for _, r := range runs {
		if r.WorkflowScan == nil || r.Status == jarvis.RunStatus_Done || r.Status == jarvis.RunStatus_Cancelled {
			continue
		}
		switch r.WorkflowScan.State {
		case waveobj.WorkflowScanState_Scanning, waveobj.WorkflowScanState_Picking:
			return r, nil
		}
	}
	return nil, nil
}

func (ws *WshServer) WorkflowScanStartCommand(ctx context.Context, data wshrpc.CommandWorkflowScanStartData) (*wshrpc.CommandWorkflowScanStartRtnData, error) {
	if data.ChannelId == "" || data.WorkspaceId == "" {
		return nil, fmt.Errorf("channelid and workspaceid are required")
	}
	ch, err := wstore.DBMustGet[*waveobj.Channel](ctx, data.ChannelId)
	if err != nil {
		return nil, fmt.Errorf("loading channel: %w", err)
	}
	active, err := activeWorkflowScan(ctx)
	if err != nil {
		return nil, err
	}
	if active != nil {
		return nil, fmt.Errorf("a workflow scan is already %s in %s: run %s", active.WorkflowScan.State, active.WorkflowScan.Project, active.ID)
	}
	days := windowDaysOr(data.WindowDays)
	project := runProjectName(&waveobj.Run{ChannelOID: ch.OID, ProjectPath: ch.ProjectPath}, map[string]*waveobj.Channel{ch.OID: ch})
	rtn, err := ws.createRun(ctx, wshrpc.CommandCreateRunData{
		ChannelId: ch.OID, WorkspaceId: data.WorkspaceId, Goal: workflowscan.Goal(project, days),
		Mode: jarvis.RunMode_Quick, Runtime: workflowScanRuntime, Model: workflowScanModelId,
	}, &waveobj.WorkflowScan{
		State: waveobj.WorkflowScanState_Scanning, Stage: waveobj.WorkflowScanStage_Read, Project: project, WindowDays: days,
	})
	if err != nil {
		return nil, err
	}
	return &wshrpc.CommandWorkflowScanStartRtnData{Run: rtn.Run}, nil
}

// resolveScanRun is the scan run the calling agent's tab works.
func resolveScanRun(ctx context.Context, oref string) (*waveobj.Run, error) {
	m := jarvis.ResolveRunWorkerFromMeta(ctx, oref)
	if m == nil {
		return nil, fmt.Errorf("%s works no run", oref)
	}
	if m.Run.WorkflowScan == nil {
		return nil, fmt.Errorf("run %s is not a workflow scan", m.Run.ID)
	}
	return m.Run, nil
}

// updateScan writes fn's change to the run's scan and tells the cockpit; it returns the scan as written.
func updateScan(ctx context.Context, run *waveobj.Run, fn func(s *waveobj.WorkflowScan)) (*waveobj.WorkflowScan, error) {
	var out waveobj.WorkflowScan
	err := wstore.UpdateRun(ctx, run.ChannelOID, run.ID, func(r *waveobj.Run) error {
		if r.WorkflowScan == nil {
			return fmt.Errorf("run %s is not a workflow scan", r.ID)
		}
		fn(r.WorkflowScan)
		out = *r.WorkflowScan
		return nil
	})
	if err != nil {
		return nil, err
	}
	publishRunUpdate(run.ChannelOID, run.ID)
	return &out, nil
}

func (ws *WshServer) WorkflowScanCommand(ctx context.Context, data wshrpc.CommandWorkflowScanData) (*waveobj.WorkflowScan, error) {
	run, err := resolveScanRun(ctx, data.ORef)
	if err != nil {
		return nil, err
	}
	scan, err := runWorkflowScan(ctx, run, windowDaysOr(data.WindowDays))
	if err != nil {
		// the scan's own ctx may be what failed it, and the cockpit must still learn why
		if _, ferr := updateScan(context.WithoutCancel(ctx), run, func(s *waveobj.WorkflowScan) {
			s.State, s.Error = waveobj.WorkflowScanState_Failed, err.Error()
		}); ferr != nil {
			log.Printf("workflow scan %s: recording its failure: %v", run.ID, ferr)
		}
		return nil, err
	}
	return scan, nil
}

// runWorkflowScan steps the scan run through read, patterns, recount and checking, writing each stage and its
// counts to the record as it goes.
func runWorkflowScan(ctx context.Context, run *waveobj.Run, days int) (*waveobj.WorkflowScan, error) {
	now := workflowScanNow()
	from := now.Add(-time.Duration(days) * 24 * time.Hour)
	if _, err := updateScan(ctx, run, func(s *waveobj.WorkflowScan) {
		*s = waveobj.WorkflowScan{
			State: waveobj.WorkflowScanState_Scanning, Stage: waveobj.WorkflowScanStage_Read, Project: s.Project,
			WindowDays: days, FromTs: from.UnixMilli(), ToTs: now.UnixMilli(),
		}
	}); err != nil {
		return nil, err
	}

	corpus, err := readWorkflowCorpus(ctx, now, from, days)
	if err != nil {
		return nil, err
	}
	sessionId := uuid.NewString()
	if _, err := updateScan(ctx, run, func(s *waveobj.WorkflowScan) {
		s.Stage, s.Runs, s.Projects, s.Dropped = waveobj.WorkflowScanStage_Patterns, corpus.Runs, corpus.Projects, corpus.Dropped
	}); err != nil {
		return nil, err
	}
	// recorded before the call, so the usage linker places the pass's tokens even when the scan fails after it
	if err := wstore.UpdateRun(ctx, run.ChannelOID, run.ID, func(r *waveobj.Run) error {
		r.ConsultSessions = append(r.ConsultSessions, waveobj.ConsultSession{SessionId: sessionId, Role: jarvis.UsageRole_WorkflowScan})
		return nil
	}); err != nil {
		return nil, err
	}

	spec, ok := consult.SpecForTier(workflowScanRuntime, consult.TierMid)
	if !ok {
		return nil, fmt.Errorf("no %s runtime for the patterns pass", workflowScanRuntime)
	}
	spec.BaseArgs = append(append([]string{}, spec.BaseArgs...), "--session-id", sessionId)
	mctx, cancel := context.WithTimeout(ctx, workflowScanModelTimeout)
	defer cancel()
	reply, err := workflowScanModel(mctx, spec, run.ProjectPath, workflowscan.SonnetPrompt(corpus))
	if err != nil {
		return nil, fmt.Errorf("the patterns pass: %w", err)
	}
	cands, err := workflowscan.ParseSonnetReply(reply)
	if err != nil {
		return nil, err
	}

	if _, err := updateScan(ctx, run, func(s *waveobj.WorkflowScan) {
		s.Stage, s.Candidates = waveobj.WorkflowScanStage_Recount, len(cands)
	}); err != nil {
		return nil, err
	}
	survivors, underFloor := workflowscan.Recount(corpus, cands)
	return updateScan(ctx, run, func(s *waveobj.WorkflowScan) {
		s.Stage, s.Kept, s.Survivors, s.UnderFloor = waveobj.WorkflowScanStage_Checking, len(survivors), survivors, underFloor
	})
}

// readWorkflowCorpus builds the corpus from every project's runs created in the window.
func readWorkflowCorpus(ctx context.Context, now, from time.Time, days int) (workflowscan.Corpus, error) {
	runs, err := wstore.GetRunsCreatedSince(ctx, from.UnixMilli())
	if err != nil {
		return workflowscan.Corpus{}, fmt.Errorf("loading runs: %w", err)
	}
	chans, err := wstore.GetChannels(ctx)
	if err != nil {
		return workflowscan.Corpus{}, fmt.Errorf("loading projects: %w", err)
	}
	byId := make(map[string]*waveobj.Channel, len(chans))
	for _, ch := range chans {
		byId[ch.OID] = ch
	}
	infos := make([]workflowscan.RunInfo, 0, len(runs))
	for _, r := range runs {
		infos = append(infos, workflowscan.RunInfo{Run: r, Project: runProjectName(r, byId)})
	}
	events, err := wstore.QueryRunEventsSince(ctx, from.UnixMilli(), workflowscan.EventKinds)
	if err != nil {
		return workflowscan.Corpus{}, fmt.Errorf("loading run events: %w", err)
	}
	return workflowscan.BuildCorpus(infos, events, now, days), nil
}

// WorkflowScanResultCommand stores the agent's verdicts on the record. The scan stays picking from here: the
// agent asks the owner itself, so nothing else is written until the run ends.
func (ws *WshServer) WorkflowScanResultCommand(ctx context.Context, data wshrpc.CommandWorkflowScanResultData) error {
	run, err := resolveScanRun(ctx, data.ORef)
	if err != nil {
		return err
	}
	if err := workflowscan.ValidateVerdicts(run.WorkflowScan.Survivors, data.Verdicts); err != nil {
		return err
	}
	_, err = updateScan(ctx, run, func(s *waveobj.WorkflowScan) {
		s.Verdicts, s.State = data.Verdicts, waveobj.WorkflowScanState_Picking
	})
	return err
}
