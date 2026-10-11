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
}

type CommandCleanStorageData struct {
	Category      string   `json:"category"`
	ItemIds       []string `json:"itemids"`
	OlderThanDays int      `json:"olderthandays,omitempty"` // the sessions card's age
	AllowGuarded  bool     `json:"allowguarded,omitempty"`  // an item's own button: removes a guarded item too
}
