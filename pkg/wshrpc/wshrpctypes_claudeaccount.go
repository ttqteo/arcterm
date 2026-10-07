// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshrpc

import "context"

type ClaudeAccountCommands interface {
	ClaudeAccountListCommand(ctx context.Context) (*CommandClaudeAccountListRtnData, error)
	ClaudeAccountAddCommand(ctx context.Context, data CommandClaudeAccountAddData) (*ClaudeAccountData, error) // the token is stored, never returned
	ClaudeAccountRenameCommand(ctx context.Context, data CommandClaudeAccountRenameData) error
	ClaudeAccountRemoveCommand(ctx context.Context, data CommandClaudeAccountRemoveData) error // switches to Default first when it is the active one
}

type ClaudeAccountData struct {
	Id        string `json:"id"`
	Label     string `json:"label"`
	CreatedTs int64  `json:"createdts"`
}

type CommandClaudeAccountListRtnData struct {
	Accounts []ClaudeAccountData `json:"accounts"`
	Active   string              `json:"active"` // the account wavesrv applied; "" = Default
}

type CommandClaudeAccountAddData struct {
	Label string `json:"label"`
	Token string `json:"token"`
}

type CommandClaudeAccountRenameData struct {
	Id    string `json:"id"`
	Label string `json:"label"`
}

type CommandClaudeAccountRemoveData struct {
	Id string `json:"id"`
}
