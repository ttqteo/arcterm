// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshrpc

import (
	"context"

	"github.com/wavetermdev/waveterm/pkg/storage"
)

// StorageCommands back Settings → Storage: what arcterm and its agents leave on disk, and cleaning it.
type StorageCommands interface {
	// GetStorageCommand returns the last scan; a scan finishing later arrives as a storage:scan event
	GetStorageCommand(ctx context.Context) (*storage.StorageReport, error)
	// RescanStorageCommand starts a scan in the background
	RescanStorageCommand(ctx context.Context) error
	// CleanStorageCommand cleans the named items of one category, re-checking each, then rescans
	CleanStorageCommand(ctx context.Context, data CommandCleanStorageData) (*storage.StorageCleanResult, error)
	// SizeBuildOutputCommand queues build output to be sized, in the background, and returns at once. A scan lists build
	// folders without walking them: only this (a project's row opening, Size all, wsh storage size) measures them. The
	// queue shows as StorageReport.Sizing in each storage:scan event.
	SizeBuildOutputCommand(ctx context.Context, data CommandSizeBuildOutputData) error
	// StopSizingBuildOutputCommand lets the walk in progress finish and drops the rest of the queue
	StopSizingBuildOutputCommand(ctx context.Context) error
	// ListCanvasesCommand lists every registered project's design canvases, newest first (Agent → Canvases)
	ListCanvasesCommand(ctx context.Context) ([]storage.StorageCanvas, error)
	// ListCanvasSessionsCommand lists the sessions that made one canvas (its topic folder), the latest first: the
	// canvas viewer's Resume
	ListCanvasSessionsCommand(ctx context.Context, dir string) ([]SessionActivity, error)
	// SetCanvasLinkCommand writes one canvas's version link into its canvas.json: which older canvas it replaces and
	// which it was said not to (Agent → Canvas gallery)
	SetCanvasLinkCommand(ctx context.Context, data CommandSetCanvasLinkData) error
}

// CommandSetCanvasLinkData sets both fields of one canvas whole: the caller computes them with the version model, so
// the server stays a guarded writer. An empty Replaces or NotReplaces removes its key.
type CommandSetCanvasLinkData struct {
	Dir         string   `json:"dir"`         // the topic folder: StorageCanvas.Dir
	Replaces    string   `json:"replaces"`    // the older canvas's topic, or "" for none
	NotReplaces []string `json:"notreplaces"` // topics this canvas was said not to replace
}

// CommandSizeBuildOutputData asks for the build folders of Projects to be sized. An empty Projects is every project the
// last scan lists build output for, the oldest size first (Size all); a project the scan does not list is refused.
type CommandSizeBuildOutputData struct {
	Projects []string `json:"projects,omitempty"` // project paths: a build output item's Detail
	Force    bool     `json:"force,omitempty"`    // walk folders sized in the last 24 h too (Size all)
}

type CommandCleanStorageData struct {
	Category      string   `json:"category"`
	ItemIds       []string `json:"itemids"`
	OlderThanDays int      `json:"olderthandays,omitempty"` // the sessions card's age
	AllowGuarded  bool     `json:"allowguarded,omitempty"`  // an item's own button: removes a guarded item too
}
