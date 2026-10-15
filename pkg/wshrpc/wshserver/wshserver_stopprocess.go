// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"fmt"
	"strings"

	"github.com/shirou/gopsutil/v4/process"
	"github.com/wavetermdev/waveterm/pkg/memusage"
	"github.com/wavetermdev/waveterm/pkg/util/shellutil"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// isShellProcess says whether pid runs a shell: the wrapper an agent block's `$SHELL -c` leaves when the shell does
// not exec its command (memusage.AgentPid).
func isShellProcess(pid int32) bool {
	p, err := process.NewProcess(pid)
	if err != nil {
		return false
	}
	name, err := p.Name()
	if err != nil {
		return false
	}
	name = strings.TrimSuffix(strings.ToLower(name), ".exe")
	return name == "sh" || shellutil.GetShellTypeFromShellPath(name) != shellutil.ShellType_unknown
}

// commandOf is a process's command line as a row shows it; its pid when the OS will not say
func commandOf(ctx context.Context, pid int32) string {
	if p, err := process.NewProcessWithContext(ctx, pid); err == nil {
		if args, err := p.CmdlineSliceWithContext(ctx); err == nil && len(args) > 0 {
			return memusage.ShortCommand(args)
		}
	}
	return fmt.Sprintf("process %d", pid)
}

// StopProcessCommand ends one of an agent's descendant processes and its subtree, after checking that the pid is
// still under that agent now: the Free up list can be seconds old, and a pid can exit and be reused meanwhile.
func (ws *WshServer) StopProcessCommand(ctx context.Context, data wshrpc.CommandStopProcessData) error {
	// the same root GetConsumersCommand measures the agent from
	root := consumerBlockPid(data.BlockId)
	if root <= 0 {
		return fmt.Errorf("that agent is no longer running")
	}
	table, err := consumerTable()
	if err != nil {
		return fmt.Errorf("reading the process list: %w", err)
	}
	if !memusage.IsDescendant(table, memusage.AgentPid(table, int32(root), isShellProcess), data.Pid) {
		return fmt.Errorf("process %d is no longer one of that agent's commands", data.Pid)
	}
	return stopProcessTree(ctx, ws, table, data)
}
