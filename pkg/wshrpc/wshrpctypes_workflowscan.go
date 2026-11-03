// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshrpc

import (
	"context"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

// WorkflowScanCommands is the workflow scan: a quick Opus run reads the recent run records, a Sonnet pass names
// recurring problems, code recounts them, and the agent asks the owner which drafted fixes to apply. The scan's
// state lives on the scan run's own record (waveobj.WorkflowScan).
type WorkflowScanCommands interface {
	WorkflowScanStartCommand(ctx context.Context, data CommandWorkflowScanStartData) (*CommandWorkflowScanStartRtnData, error)
	// run by the scan agent: reads the corpus, has Sonnet name patterns, recounts, and returns the survivors
	WorkflowScanCommand(ctx context.Context, data CommandWorkflowScanData) (*waveobj.WorkflowScan, error)
	// run by the scan agent: stores its verdicts, one per survivor
	WorkflowScanResultCommand(ctx context.Context, data CommandWorkflowScanResultData) error
}

type CommandWorkflowScanStartData struct {
	ChannelId   string `json:"channelid"`
	WorkspaceId string `json:"workspaceid"`
	WindowDays  int    `json:"windowdays,omitempty"` // 0 = the 14-day default
}

type CommandWorkflowScanStartRtnData struct {
	Run *waveobj.Run `json:"run"`
}

type CommandWorkflowScanData struct {
	ORef       string `json:"oref"` // the calling agent's tab:<id>
	WindowDays int    `json:"windowdays,omitempty"`
}

type CommandWorkflowScanResultData struct {
	ORef     string                        `json:"oref"` // the calling agent's tab:<id>
	Verdicts []waveobj.WorkflowScanVerdict `json:"verdicts"`
}
