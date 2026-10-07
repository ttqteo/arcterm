// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshrpc

import "context"

type ClaudeAccountCommands interface {
	ClaudeAccountListCommand(ctx context.Context) (*CommandClaudeAccountListRtnData, error)
	ClaudeAccountAddCommand(ctx context.Context, data CommandClaudeAccountAddData) (*ClaudeAccountData, error) // the token is stored, never returned
	ClaudeAccountRenameCommand(ctx context.Context, data CommandClaudeAccountRenameData) error
	ClaudeAccountSetEmailCommand(ctx context.Context, data CommandClaudeAccountSetEmailData) error // "" clears it
	ClaudeAccountRemoveCommand(ctx context.Context, data CommandClaudeAccountRemoveData) error     // switches to Default first when it is the active one
}

type ClaudeAccountData struct {
	Id        string `json:"id"`
	Label     string `json:"label"`
	CreatedTs int64  `json:"createdts"`
	Email     string `json:"email,omitempty"` // the Claude account this token is for; lowercased
}

type CommandClaudeAccountListRtnData struct {
	Accounts   []ClaudeAccountData `json:"accounts"`
	Active     string              `json:"active"`               // the account wavesrv applied; "" = Default
	LoginEmail string              `json:"loginemail,omitempty"` // the account /login stored, lowercased; "" when unknown
}

type CommandClaudeAccountAddData struct {
	Label string `json:"label"`
	Token string `json:"token"`
	Email string `json:"email,omitempty"`
}

type CommandClaudeAccountRenameData struct {
	Id    string `json:"id"`
	Label string `json:"label"`
}

type CommandClaudeAccountSetEmailData struct {
	Id    string `json:"id"`
	Email string `json:"email"`
}

type CommandClaudeAccountRemoveData struct {
	Id string `json:"id"`
}
