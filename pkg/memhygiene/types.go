// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package memhygiene checks each registered project's Claude Code auto memory, proposes changes
// with evidence, and applies only the ones the user accepts. Every applied change can be undone.
package memhygiene

import "github.com/wavetermdev/waveterm/pkg/wshrpc"

// claude code loads only this much of MEMORY.md; memorymodel.ts mirrors the two values.
const LimitLines, LimitBytes = 200, 25000

type Memory struct {
	Name, Path, Sha256 string
	Size               int
	Frontmatter        map[string]string
	Description, Body  string
	IndexLine          string               // "" when the index doesn't link it
	Evidence           []wshrpc.MemEvidence // filled by evidence.go
	Reads              int                  // sessions with a Read tool call on the file
	LastRead           int64
}

type Inventory struct {
	Folder, IndexPath string
	IndexLines        []string // index content lines, endings stripped
	Index             wshrpc.MemIndexStats
	Memories          []Memory // index order first, then unlinked by name
	DeadLinks         []string // index links to missing files
	Sessions          int
}

type Resolved struct {
	Project, Path, Toplevel, Folder string
	SharedWith                      []string
	OwnFolder                       string
	TranscriptDirs                  []string
	Skip                            string // non-empty: why there's nothing to check (missing path, no folder)
}

// State is a project's state file.
type State struct {
	wshrpc.MemHygieneProject
	Seen map[string]string    `json:"seen"` // memory name -> sha256+evidence fingerprint at the last check (the hash gate)
	Sort map[string]SortEntry `json:"sort"` // shared memory name -> its last sort, so a check re-sorts only new or changed ones
}

type SortEntry struct {
	Sha256   string   `json:"sha256"`
	Projects []string `json:"projects"`
}
