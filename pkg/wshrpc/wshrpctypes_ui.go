// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshrpc

import "context"

// UiCommands is the cockpit UI API behind `wsh ui`. The frontend serves it on wshutil.RouteId_Cockpit and
// wavesrv never does: workers each run in their own tab, and only the cockpit window can read or move
// its own view.
type UiCommands interface {
	UiStateCommand(ctx context.Context) (*UiState, error)
	UiRevealCommand(ctx context.Context, data CommandUiRevealData) (string, error)
	UiInvokeCommand(ctx context.Context, data CommandUiInvokeData) (string, error)
	UiBrainstormCloseCommand(ctx context.Context, data CommandUiBrainstormCloseData) (string, error)
}

type UiState struct {
	Surface   string     `json:"surface"`
	Busy      bool       `json:"busy"`
	ModalOpen bool       `json:"modalopen"`
	Selection []string   `json:"selection"` // cockpit addresses, the same dialect reveal accepts
	Actions   []UiAction `json:"actions"`
}

type UiAction struct {
	Id          string `json:"id"`
	Label       string `json:"label"`
	Group       string `json:"group"`
	Destructive bool   `json:"destructive,omitempty"`
}

type CommandUiRevealData struct {
	Address       string `json:"address"`
	Anchor        string `json:"anchor,omitempty"`
	CallerBlockId string `json:"callerblockid,omitempty"`
	CallerCwd     string `json:"callercwd,omitempty"` // the wsh caller's working dir; a canvas address resolves against it
}

type CommandUiInvokeData struct {
	ActionId      string `json:"actionid"`
	CallerBlockId string `json:"callerblockid,omitempty"`
}

// CommandUiBrainstormCloseData closes the brainstorm the caller's agent has attached: its pane and Chat card go,
// the file stays, and the agent's next write of it brings the pane back.
type CommandUiBrainstormCloseData struct {
	File          string `json:"file"` // the brainstorm.json, absolute
	CallerBlockId string `json:"callerblockid"`
}
