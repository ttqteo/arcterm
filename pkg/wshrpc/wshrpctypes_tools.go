// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshrpc

import (
	"context"

	"github.com/wavetermdev/waveterm/pkg/arctools"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
)

type ToolsCommands interface {
	ToolsStatusCommand(ctx context.Context) (*CommandToolsStatusRtnData, error)
	ToolsSetUserCommand(ctx context.Context, data CommandToolsSetUserData) error
}

type CommandToolsStatusRtnData struct {
	Tools []arctools.ToolStatus `json:"tools"`
}

type CommandToolsSetUserData struct {
	Id   string                `json:"id"`
	Tool *wconfig.ToolKeywords `json:"tool,omitempty"` // nil removes the user entry
}
