// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"errors"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

var errWorkflowScanNotBuilt = errors.New("workflow scan: not implemented")

func (ws *WshServer) WorkflowScanStartCommand(ctx context.Context, data wshrpc.CommandWorkflowScanStartData) (*wshrpc.CommandWorkflowScanStartRtnData, error) {
	return nil, errWorkflowScanNotBuilt
}

func (ws *WshServer) WorkflowScanCommand(ctx context.Context, data wshrpc.CommandWorkflowScanData) (*waveobj.WorkflowScan, error) {
	return nil, errWorkflowScanNotBuilt
}

func (ws *WshServer) WorkflowScanResultCommand(ctx context.Context, data wshrpc.CommandWorkflowScanResultData) error {
	return errWorkflowScanNotBuilt
}
