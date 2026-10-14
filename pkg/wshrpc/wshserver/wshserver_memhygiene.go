// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"

	"github.com/wavetermdev/waveterm/pkg/memhygiene"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func (ws *WshServer) ListMemoryHygieneCommand(ctx context.Context) (*wshrpc.CommandListMemoryHygieneRtnData, error) {
	projects, err := memhygiene.ListProjects()
	if err != nil {
		return nil, err
	}
	return &wshrpc.CommandListMemoryHygieneRtnData{Projects: projects}, nil
}

func (ws *WshServer) CheckMemoryHygieneCommand(ctx context.Context, data wshrpc.CommandCheckMemoryHygieneData) error {
	return memhygiene.StartCheck(data.Project)
}

func (ws *WshServer) DecideMemoryChangeCommand(ctx context.Context, data wshrpc.CommandDecideMemoryChangeData) (*wshrpc.MemHygieneProject, error) {
	return memhygiene.Decide(data.Project, data.ChangeId, data.Verdict)
}
