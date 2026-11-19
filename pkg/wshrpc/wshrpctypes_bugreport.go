// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshrpc

import "context"

// The bug-report states (pkg/bugreport): a report waits for Jarvis, is held by the agent Process started, or is done.
const (
	BugReportState_Waiting  = "waiting"
	BugReportState_Handling = "handling"
	BugReportState_Done     = "done"
)

// BugReportAgent is the agent that was in focus when the person pressed the bug button.
type BugReportAgent struct {
	Id   string `json:"id"`
	Name string `json:"name"`
}

// BugReportOutcome is what the Jarvis agent says it did with a report, written by `wsh bugreport done`.
type BugReportOutcome struct {
	Text      string `json:"text"`
	RunId     string `json:"runid,omitempty"`
	EffortOID string `json:"effortoid,omitempty"`
}

// BugReport is report.json plus where it lives; Dir and HasScreen are never written to the file.
type BugReport struct {
	Id        string            `json:"id"`
	Ts        int64             `json:"ts"` // the press, unix ms
	Text      string            `json:"text"`
	Version   string            `json:"version"`
	Commit    string            `json:"commit,omitempty"`
	Surface   string            `json:"surface,omitempty"`
	Agent     *BugReportAgent   `json:"agent,omitempty"`
	State     string            `json:"state"`
	Handler   string            `json:"handler,omitempty"` // the Jarvis agent's tab id
	ClaimedTs int64             `json:"claimedts,omitempty"`
	Outcome   *BugReportOutcome `json:"outcome,omitempty"`
	DoneTs    int64             `json:"donets,omitempty"`
	Dir       string            `json:"dir,omitempty"`       // absolute folder (wire only)
	HasScreen bool              `json:"hasscreen,omitempty"` // screen.png exists (wire only)
}

// BugReportStatus is what the box's count and the Jarvis row read.
type BugReportStatus struct {
	Waiting     int    `json:"waiting"`
	Handling    int    `json:"handling"`
	Handler     string `json:"handler,omitempty"`     // the tab id holding the handling reports
	RepoPath    string `json:"repopath,omitempty"`    // arcterm's checkout, when found
	RepoProject string `json:"repoproject,omitempty"` // the registered project at RepoPath, when one is
}

type CommandBugReportSaveData struct {
	Text     string          `json:"text"`
	Ts       int64           `json:"ts"`
	Version  string          `json:"version"`
	Commit   string          `json:"commit,omitempty"`
	Surface  string          `json:"surface,omitempty"`
	Agent    *BugReportAgent `json:"agent,omitempty"`
	Screen64 string          `json:"screen64,omitempty"` // the PNG, base64; empty when the capture failed
}

type CommandBugReportListData struct {
	State string `json:"state,omitempty"` // empty lists waiting and handling
}

type CommandBugReportClaimData struct {
	AgentId string   `json:"agentid"`
	Ids     []string `json:"ids"`
}

type CommandBugReportClaimRtnData struct {
	Claimed []string `json:"claimed"`
}

type CommandBugReportDoneData struct {
	Id      string           `json:"id"`
	Outcome BugReportOutcome `json:"outcome"`
}

// BugReportCommands is "Report an arcterm bug": the bug button in the footer saves a report folder (pkg/bugreport),
// Jarvis's Waiting on you shows one row while reports wait, and the agent Process starts holds them (claim) and marks
// each finished one (done).
type BugReportCommands interface {
	BugReportSaveCommand(ctx context.Context, data CommandBugReportSaveData) (*BugReportStatus, error)
	BugReportStatusCommand(ctx context.Context) (*BugReportStatus, error)
	BugReportListCommand(ctx context.Context, data CommandBugReportListData) ([]BugReport, error)
	BugReportClaimCommand(ctx context.Context, data CommandBugReportClaimData) (*CommandBugReportClaimRtnData, error)
	BugReportDoneCommand(ctx context.Context, data CommandBugReportDoneData) error
}
