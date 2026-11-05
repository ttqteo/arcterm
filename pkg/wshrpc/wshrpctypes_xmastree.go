// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshrpc

import "context"

// XmasTreeCommands is the wire of the Office hall's Christmas tree (pkg/xmastree).
type XmasTreeCommands interface {
	XmasTreeCommand(ctx context.Context) (*XmasTreeData, error)
}

// XmasTreeData is the season's ledger as the tree reads it. Phase is "season", "newyear" or "off"; Done is each counted
// task's finish time in ms, oldest first (ties by runid, taskid), and empty in off. The xmastree:changed event carries
// the same data.
type XmasTreeData struct {
	Season int     `json:"season"`
	Phase  string  `json:"phase"`
	Done   []int64 `json:"done"`
}
