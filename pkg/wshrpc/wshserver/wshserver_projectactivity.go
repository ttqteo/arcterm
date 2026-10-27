// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// GetProjectActivityCommand answers the Overview's Activity card. The interface is final; the daily tally
// that fills it lands in a later task, so for now it reads as a project with no record.
func (ws *WshServer) GetProjectActivityCommand(ctx context.Context, data wshrpc.CommandGetProjectActivityData) (*wshrpc.CommandGetProjectActivityRtnData, error) {
	return &wshrpc.CommandGetProjectActivityRtnData{Days: []wshrpc.ProjectActivityDay{}}, nil
}
