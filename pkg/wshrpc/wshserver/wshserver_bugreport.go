// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"fmt"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// wavesrv finds a command's handler by reflection on its name, so a renamed or re-typed method would drop out of the
// wire without an error: this keeps all five, with the interface's signatures, compiled in.
var _ wshrpc.BugReportCommands = (*WshServer)(nil)

// The five bug-report commands. The wire (types, bindings) lands first; the report store (pkg/bugreport) replaces
// these bodies.

func (ws *WshServer) BugReportSaveCommand(ctx context.Context, data wshrpc.CommandBugReportSaveData) (*wshrpc.BugReportStatus, error) {
	return nil, fmt.Errorf("bug reports: not implemented yet")
}

func (ws *WshServer) BugReportStatusCommand(ctx context.Context) (*wshrpc.BugReportStatus, error) {
	return nil, fmt.Errorf("bug reports: not implemented yet")
}

func (ws *WshServer) BugReportListCommand(ctx context.Context, data wshrpc.CommandBugReportListData) ([]wshrpc.BugReport, error) {
	return nil, fmt.Errorf("bug reports: not implemented yet")
}

func (ws *WshServer) BugReportClaimCommand(ctx context.Context, data wshrpc.CommandBugReportClaimData) (*wshrpc.CommandBugReportClaimRtnData, error) {
	return nil, fmt.Errorf("bug reports: not implemented yet")
}

func (ws *WshServer) BugReportDoneCommand(ctx context.Context, data wshrpc.CommandBugReportDoneData) error {
	return fmt.Errorf("bug reports: not implemented yet")
}
