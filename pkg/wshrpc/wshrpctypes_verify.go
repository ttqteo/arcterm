// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshrpc

import "context"

// VerifyCommands is the wire of Verify (pkg/verifyruns): the CDP scenario results an agent's harness reports, kept per
// agent block and read by the cockpit's rail tile, `wsh verify` and the arc mod's merge gate.
type VerifyCommands interface {
	// VerifyReportCommand stores one report of a harness run (scripts/cdp/report.mjs, through `wsh verify report`).
	VerifyReportCommand(ctx context.Context, data CommandVerifyReportData) error
	// GetVerifyStateCommand derives the agent's rows, warning and verdict; empty when the repo at cwd has no
	// .arc/verify.json.
	GetVerifyStateCommand(ctx context.Context, data CommandVerifyStateData) (*VerifyStateData, error)
	// VerifySkipCommand sets one scenario (or, with an empty scenario, the not-run warning) aside, or takes it back.
	VerifySkipCommand(ctx context.Context, data CommandVerifySkipData) error
	// VerifyGateCommand says whether a Bash command is a merge into the default branch that wants an ask.
	VerifyGateCommand(ctx context.Context, data CommandVerifyGateData) (*VerifyGateData, error)
}

// VerifyStepData is one step of a scenario as the harness printed it.
type VerifyStepData struct {
	Step   string `json:"step"`
	State  string `json:"state"` // pass | fail | skip
	Detail string `json:"detail,omitempty"`
}

// VerifyScenarioData is one scenario in a report: its screenshots and, once it ended, its steps.
type VerifyScenarioData struct {
	Name  string           `json:"name"`
	Files []string         `json:"files,omitempty"` // screenshot file names, relative to the report's shotsdir
	Steps []VerifyStepData `json:"steps,omitempty"`
	Done  bool             `json:"done,omitempty"`
}

// CommandVerifyReportData is one report of a run. There is no watch list: wavesrv reads .arc/verify.json itself.
type CommandVerifyReportData struct {
	BlockId   string               `json:"blockid"`
	RunId     string               `json:"runid"`
	Phase     string               `json:"phase"` // start | progress | end
	Pid       int                  `json:"pid,omitempty"`
	Cwd       string               `json:"cwd,omitempty"`
	Command   string               `json:"command,omitempty"`
	ShotsDir  string               `json:"shotsdir,omitempty"` // absolute
	Scenarios []VerifyScenarioData `json:"scenarios,omitempty"`
	Reason    string               `json:"reason,omitempty"` // why the run ended without results
}

type CommandVerifyStateData struct {
	BlockId string `json:"blockid"`
	Cwd     string `json:"cwd"`
}

// VerifyRowData is one scenario's newest run, derived: its state is running | passed | failed | noresult | outofdate |
// skipped.
type VerifyRowData struct {
	Scenario    string   `json:"scenario"`
	State       string   `json:"state"`
	Passed      int      `json:"passed"`
	Total       int      `json:"total"`
	Failed      []string `json:"failed,omitempty"` // the failed steps' texts
	Done        int      `json:"done"`             // scenarios finished in its run, of Of: for a running row
	Of          int      `json:"of"`
	Command     string   `json:"command,omitempty"`
	ShotsDir    string   `json:"shotsdir,omitempty"`
	Reason      string   `json:"reason,omitempty"`
	Shots       int      `json:"shots"` // that scenario's screenshot count
	Started     int64    `json:"started"`
	Ended       int64    `json:"ended"`
	ChangedFile string   `json:"changedfile,omitempty"` // out of date: the newest watched file that changed
}

// VerifyStateData is what the cockpit draws the Verify tile from.
type VerifyStateData struct {
	Rows          []VerifyRowData `json:"rows"`
	Verdict       string          `json:"verdict"` // "" | running | passed | amber | red
	NotRun        bool            `json:"notrun"`  // watched files changed and no run ended after them
	NotRunSkipped bool            `json:"notrunskipped"`
	Changed       []string        `json:"changed,omitempty"` // the watched files that changed
	Rerun         string          `json:"rerun,omitempty"`   // the command the not-run line names, from .arc/verify.json
}

type CommandVerifySkipData struct {
	BlockId  string `json:"blockid"`
	Scenario string `json:"scenario"` // empty for the not-run warning
	Undo     bool   `json:"undo,omitempty"`
}

type CommandVerifyGateData struct {
	BlockId string `json:"blockid"`
	Cwd     string `json:"cwd"`
	Command string `json:"command"`
}

// VerifyGateData answers the merge gate: Ask is true when the person should be asked, and Reason is the sentence.
type VerifyGateData struct {
	Ask    bool   `json:"ask"`
	Reason string `json:"reason,omitempty"`
}

// VerifyChangedData is the verify:changed event: the block whose Verify state a stored report or a skip changed.
type VerifyChangedData struct {
	BlockId string `json:"blockid"`
}
