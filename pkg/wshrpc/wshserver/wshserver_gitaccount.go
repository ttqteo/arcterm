// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"

	"github.com/wavetermdev/waveterm/pkg/gitaccount"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

var _ wshrpc.GitAccountCommands = (*WshServer)(nil)

func (ws *WshServer) GitAccountListCommand(ctx context.Context) (*wshrpc.GitAccountListRtnData, error) {
	return gitaccount.List()
}

func (ws *WshServer) GitAccountCheckTokenCommand(ctx context.Context, data wshrpc.CommandGitAccountTokenData) (*wshrpc.GitHubUserData, error) {
	return gitaccount.CheckToken(ctx, data.Login, data.Token)
}

func (ws *WshServer) GitAccountAddCommand(ctx context.Context, data wshrpc.CommandGitAccountAddData) (*wshrpc.GitAccountData, error) {
	return gitaccount.Add(ctx, data)
}

func (ws *WshServer) GitAccountUpdateCommand(ctx context.Context, data wshrpc.CommandGitAccountUpdateData) error {
	return gitaccount.Update(data)
}

func (ws *WshServer) GitAccountSetTokenCommand(ctx context.Context, data wshrpc.CommandGitAccountTokenData) error {
	return gitaccount.SetToken(ctx, data.Login, data.Token)
}

func (ws *WshServer) GitAccountRemoveCommand(ctx context.Context, data wshrpc.CommandGitAccountLoginData) error {
	return gitaccount.Remove(ctx, data.Login)
}

func (ws *WshServer) GitAccountSetDefaultCommand(ctx context.Context, data wshrpc.CommandGitAccountLoginData) error {
	return gitaccount.SetDefault(data.Login)
}

func (ws *WshServer) GitAccountAddRootCommand(ctx context.Context, data wshrpc.CommandGitAccountRootData) error {
	return gitaccount.AddRoot(data.Login, data.Root)
}

func (ws *WshServer) GitAccountRemoveRootCommand(ctx context.Context, data wshrpc.CommandGitAccountRootData) error {
	return gitaccount.RemoveRoot(data.Login, data.Root)
}

func (ws *WshServer) GitAccountTokenStateCommand(ctx context.Context, data wshrpc.CommandGitAccountLoginData) (*wshrpc.GitAccountTokenStateData, error) {
	return gitaccount.TokenState(ctx, data.Login)
}

func (ws *WshServer) GitAccountScanCommand(ctx context.Context) (*wshrpc.GitAccountScanRtnData, error) {
	return gitaccount.Scan()
}

func (ws *WshServer) GitAccountFixCommand(ctx context.Context, data wshrpc.CommandGitAccountFixData) (*wshrpc.GitAccountFixRtnData, error) {
	return gitaccount.Fix(ctx, data)
}
