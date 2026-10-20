// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"fmt"
	"os/exec"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/arctools"
	"github.com/wavetermdev/waveterm/pkg/util/envutil"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// ToolsStatusCommand reports the built-in catalog and the detected tools with the user's tools.json laid over them, and
// whether each tool's command resolves on this machine's PATH (a detected tool not added only when it does).
func (ws *WshServer) ToolsStatusCommand(ctx context.Context) (*wshrpc.CommandToolsStatusRtnData, error) {
	tools := arctools.Merge(append(arctools.Builtin(), arctools.Detected()...), wconfig.GetWatcher().GetFullConfig().Tools)
	// a tool installed from the library (winget adds its folder to the user's PATH) reads installed straight away
	envutil.RefreshPath()
	return &wshrpc.CommandToolsStatusRtnData{Tools: arctools.Status(tools, exec.LookPath)}, nil
}

// ToolsSetUserCommand writes (or, with no tool, removes) one entry of tools.json. The config watcher reloads the
// file, so a ToolsStatus call straight after may still show the old list until the config event lands.
func (ws *WshServer) ToolsSetUserCommand(ctx context.Context, data wshrpc.CommandToolsSetUserData) error {
	id := strings.TrimSpace(data.Id)
	if id == "" {
		return fmt.Errorf("tool id is required")
	}
	if data.Tool == nil {
		return wconfig.SetUserTool(id, nil)
	}
	tool := *data.Tool
	tool.Command = strings.TrimSpace(tool.Command)
	if tool.Command == "" {
		return fmt.Errorf("tool command is required")
	}
	return wconfig.SetUserTool(id, &tool)
}
