// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshrpc

import (
	"context"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

type BlockCommands interface {
	ControllerInputCommand(ctx context.Context, data CommandBlockInputData) error
	ControllerDestroyCommand(ctx context.Context, blockId string) error
	ControllerResyncCommand(ctx context.Context, data CommandControllerResyncData) error
	ControllerAppendOutputCommand(ctx context.Context, data CommandControllerAppendOutputData) error
	CreateBlockCommand(ctx context.Context, data CommandCreateBlockData) (waveobj.ORef, error)
	DeleteBlockCommand(ctx context.Context, data CommandDeleteBlockData) error
	BlocksListCommand(ctx context.Context, data BlocksListRequest) ([]BlocksListEntry, error)
	WorkspaceListCommand(ctx context.Context) ([]WorkspaceInfoData, error)
	// screenshot
	// block focus
	// terminal
	TermGetScrollbackLinesCommand(ctx context.Context, data CommandTermGetScrollbackLinesData) (*CommandTermGetScrollbackLinesRtnData, error)
}

type CommandCreateBlockData struct {
	TabId    string               `json:"tabid"`
	BlockDef *waveobj.BlockDef    `json:"blockdef"`
	RtOpts   *waveobj.RuntimeOpts `json:"rtopts,omitempty"`
}

type CommandControllerResyncData struct {
	ForceRestart bool                 `json:"forcerestart,omitempty"`
	TabId        string               `json:"tabid"`
	BlockId      string               `json:"blockid"`
	RtOpts       *waveobj.RuntimeOpts `json:"rtopts,omitempty"`
	Nudge        string               `json:"nudge,omitempty"` // a first turn the started agent takes, never saved in its cmd:args
}

type CommandControllerAppendOutputData struct {
	BlockId string `json:"blockid"`
	Data64  string `json:"data64"`
}

type CommandBlockInputData struct {
	BlockId     string            `json:"blockid"`
	InputData64 string            `json:"inputdata64,omitempty"`
	SigName     string            `json:"signame,omitempty"`
	TermSize    *waveobj.TermSize `json:"termsize,omitempty"`
}

type CommandDeleteBlockData struct {
	BlockId string `json:"blockid"`
}

type WorkspaceInfoData struct {
	WindowId      string             `json:"windowid"`
	WorkspaceData *waveobj.Workspace `json:"workspacedata"`
}

type BlocksListRequest struct {
	WindowId    string `json:"windowid,omitempty"`
	WorkspaceId string `json:"workspaceid,omitempty"`
}

type BlocksListEntry struct {
	WindowId    string              `json:"windowid"`
	WorkspaceId string              `json:"workspaceid"`
	TabId       string              `json:"tabid"`
	BlockId     string              `json:"blockid"`
	Meta        waveobj.MetaMapType `json:"meta"`
}

type CommandTermGetScrollbackLinesData struct {
	LineStart   int  `json:"linestart"`
	LineEnd     int  `json:"lineend"`
	LastCommand bool `json:"lastcommand"`
}

type CommandTermGetScrollbackLinesRtnData struct {
	TotalLines  int      `json:"totallines"`
	LineStart   int      `json:"linestart"`
	Lines       []string `json:"lines"`
	LastUpdated int64    `json:"lastupdated"`
}
