// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshrpc

import "context"

// DUM-E (pkg/dume): what it last decided and where its chunks stand, for `wsh dume status` and the Brief.
type DumeCommands interface {
	DumeStatusCommand(ctx context.Context) (*DumeStatusData, error)
}

type DumeChunk struct {
	EffortOID string `json:"effortoid"`
	Effort    string `json:"effort"` // the initiative's title
	Chunk     string `json:"chunk"`
	RunId     string `json:"runid,omitempty"`
	Branch    string `json:"branch,omitempty"`
}

type DumeStatusData struct {
	Enabled       bool        `json:"enabled"`
	Reason        string      `json:"reason,omitempty"` // the gate's last reason; "" before the first check
	DecidedTs     int64       `json:"decidedts,omitempty"`
	FiveHourPct   *float64    `json:"fivehourpct,omitempty"`
	FiveHourReset *int64      `json:"fivehourreset,omitempty"` // epoch s
	Running       *DumeChunk  `json:"running,omitempty"`
	Waiting       int         `json:"waiting"`
	ToLand        []DumeChunk `json:"toland,omitempty"`
	Blocked       int         `json:"blocked"`
	Done          int         `json:"done"`
}
