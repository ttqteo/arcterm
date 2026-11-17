// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// SearchSessionsCommand finds the past claude and pi conversations that say the query. Task 3 of the Session search
// plan fills it in over pkg/agentsessions' digests; until then it answers no results, so the server builds and the
// frontend can code against the command.
func (ws *WshServer) SearchSessionsCommand(ctx context.Context, data wshrpc.CommandSearchSessionsData) (*wshrpc.CommandSearchSessionsRtnData, error) {
	return &wshrpc.CommandSearchSessionsRtnData{Results: []wshrpc.SessionSearchResult{}, Terms: []string{}}, nil
}
