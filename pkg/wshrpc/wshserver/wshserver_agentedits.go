// pkg/wshrpc/wshserver/wshserver_agentedits.go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// GitAgentEditsCommand is a stub until pkg/agentedits lands: it answers "nothing to show" with a reason, and
// an empty (not nil) Files so the wire carries [] rather than null.
func (ws *WshServer) GitAgentEditsCommand(ctx context.Context, data wshrpc.CommandGitAgentEditsData) (*wshrpc.CommandGitAgentEditsRtnData, error) {
	return &wshrpc.CommandGitAgentEditsRtnData{Files: []wshrpc.GitAgentEditFile{}, Reason: "Agent's edits are not built yet"}, nil
}
