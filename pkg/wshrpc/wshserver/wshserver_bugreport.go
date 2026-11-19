// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"fmt"
	"log"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/bugreport"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// wavesrv finds a command's handler by reflection on its name, so a renamed or re-typed method would drop out of the
// wire without an error: this keeps all five, with the interface's signatures, compiled in.
var _ wshrpc.BugReportCommands = (*WshServer)(nil)

// The five bug-report commands over pkg/bugreport. The count and the Jarvis row both come from jarvis.GatherBugReports,
// and every command that reads or changes reports first sends the reports of a closed agent back to waiting
// (jarvis.ReconcileBugReports), so no reader sees a report held by an agent that is gone.

// reconcileBugReports is that first step. A reconcile that fails (a report.json that could not be rewritten) is logged
// and the command goes on: it still answers from what is on disk, which is better than a bug button that errors.
func reconcileBugReports(ctx context.Context) {
	if err := jarvis.ReconcileBugReports(ctx); err != nil {
		log.Printf("bugreport: reconcile failed: %v", err)
	}
}

// BugReportSaveCommand saves the report the box sent and answers with the status the box counts from.
func (ws *WshServer) BugReportSaveCommand(ctx context.Context, data wshrpc.CommandBugReportSaveData) (*wshrpc.BugReportStatus, error) {
	store := bugreport.Default()
	saved, err := store.Save(data, wavebase.GetWaveDataDir())
	if err != nil {
		return nil, err
	}
	log.Printf("bugreport: saved %s (%d chars of text, picture: %v)", saved.Id, len(saved.Text), saved.HasScreen)
	status, _, err := jarvis.GatherBugReports(ctx)
	if err != nil {
		// the report is on disk: a count that could not be read must not read as a failed save, or the person sends it twice
		log.Printf("bugreport: saved %s, but its status could not be read: %v", saved.Id, err)
		status = wshrpc.BugReportStatus{}
		if waiting, handling, handler, serr := store.Status(); serr == nil {
			status = wshrpc.BugReportStatus{Waiting: waiting, Handling: handling, Handler: handler}
		}
	}
	return &status, nil
}

// BugReportStatusCommand is the count the box shows and the repo the Jarvis row needs.
func (ws *WshServer) BugReportStatusCommand(ctx context.Context) (*wshrpc.BugReportStatus, error) {
	status, _, err := jarvis.GatherBugReports(ctx)
	if err != nil {
		return nil, err
	}
	return &status, nil
}

// BugReportListCommand lists the reports in a state, oldest first; no state is the ones that wait and are held.
func (ws *WshServer) BugReportListCommand(ctx context.Context, data wshrpc.CommandBugReportListData) ([]wshrpc.BugReport, error) {
	reconcileBugReports(ctx)
	return bugreport.Default().List(data.State)
}

// BugReportClaimCommand gives the listed waiting reports to the agent Process started. A tab: prefix on the id is
// dropped, so an oref and a bare tab id both name the tab.
func (ws *WshServer) BugReportClaimCommand(ctx context.Context, data wshrpc.CommandBugReportClaimData) (*wshrpc.CommandBugReportClaimRtnData, error) {
	reconcileBugReports(ctx)
	claimed, err := bugreport.Default().Claim(strings.TrimPrefix(data.AgentId, "tab:"), data.Ids)
	if err != nil {
		return nil, err
	}
	return &wshrpc.CommandBugReportClaimRtnData{Claimed: claimed}, nil
}

// BugReportDoneCommand records a handled report's outcome and moves it to done/.
func (ws *WshServer) BugReportDoneCommand(ctx context.Context, data wshrpc.CommandBugReportDoneData) error {
	reconcileBugReports(ctx)
	if err := bugreport.Default().Done(data.Id, data.Outcome); err != nil {
		return fmt.Errorf("bug report %s: %w", data.Id, err)
	}
	return nil
}
