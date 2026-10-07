// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"fmt"

	"github.com/wavetermdev/waveterm/pkg/claudeaccount"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func toClaudeAccountData(a claudeaccount.Account) wshrpc.ClaudeAccountData {
	return wshrpc.ClaudeAccountData{Id: a.Id, Label: a.Label, CreatedTs: a.CreatedTs}
}

func (ws *WshServer) ClaudeAccountListCommand(ctx context.Context) (*wshrpc.CommandClaudeAccountListRtnData, error) {
	list, err := claudeaccount.List()
	if err != nil {
		return nil, fmt.Errorf("listing claude accounts: %w", err)
	}
	accounts := make([]wshrpc.ClaudeAccountData, 0, len(list))
	for _, a := range list {
		accounts = append(accounts, toClaudeAccountData(a))
	}
	return &wshrpc.CommandClaudeAccountListRtnData{Accounts: accounts, Active: claudeaccount.Active()}, nil
}

func (ws *WshServer) ClaudeAccountAddCommand(ctx context.Context, data wshrpc.CommandClaudeAccountAddData) (*wshrpc.ClaudeAccountData, error) {
	a, err := claudeaccount.Add(data.Label, data.Token)
	if err != nil {
		return nil, err
	}
	rtn := toClaudeAccountData(a)
	return &rtn, nil
}

func (ws *WshServer) ClaudeAccountRenameCommand(ctx context.Context, data wshrpc.CommandClaudeAccountRenameData) error {
	return claudeaccount.Rename(data.Id, data.Label)
}

func (ws *WshServer) ClaudeAccountRemoveCommand(ctx context.Context, data wshrpc.CommandClaudeAccountRemoveData) error {
	// switch to Default first, so nothing spawned after this runs on a token that is about to be deleted
	settings := wconfig.GetWatcher().GetFullConfig().Settings
	if claudeaccount.Active() == data.Id || settings.ClaudeActiveAccount == data.Id {
		err := wconfig.SetBaseConfigValue(waveobj.MetaMapType{wconfig.ConfigKey_ClaudeActiveAccount: ""})
		if err != nil {
			return fmt.Errorf("switching to the Default claude account: %w", err)
		}
		// the config watcher applies the change asynchronously; don't leave the token in the
		// environment until it catches up
		claudeaccount.ApplyEnv("")
	}
	return claudeaccount.Remove(data.Id)
}
