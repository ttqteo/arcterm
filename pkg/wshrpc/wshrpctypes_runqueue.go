// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshrpc

import "context"

// The run queue (pkg/runqueue): plans a session handed to the engine as a queued start. The entry type lives here,
// not in pkg/runqueue, so that package can hold it without importing anything that imports it back.

// RunQueueEntry.State values.
const (
	RunQueueState_Waiting = "waiting"
	RunQueueState_Blocked = "blocked"
)

// RunQueueEntry is one queued run start. The queue's order is the order of the entries in its file.
type RunQueueEntry struct {
	Id          string               `json:"id"`              // "q-" + 4 hex, its own id space
	Data        CommandCreateRunData `json:"data"`            // what wsh runs start would have sent
	Title       string               `json:"title"`           // the plan's title, for rows and messages
	ProjectPath string               `json:"projectpath"`     // the channel's project, for the tree's folder
	After       string               `json:"after,omitempty"` // a run id or a queue entry id
	QueuedTs    int64                `json:"queuedts"`
	State       string               `json:"state"` // RunQueueState_*
	Reason      string               `json:"reason,omitempty"`
	BlockedOn   string               `json:"blockedon,omitempty"` // the run whose outcome blocked it; set only for that kind of block
}

// RunQueueCommands are how `wsh runs` and the cockpit hand a start to the queue and act on what waits in it.
type RunQueueCommands interface {
	RunQueueAddCommand(ctx context.Context, data CommandRunQueueAddData) (*RunQueueEntry, error) // queue a start; the plan and After are checked now
	RunQueueListCommand(ctx context.Context) (*CommandRunQueueListRtnData, error)                // the entries in order, the cap and the active runs
	RunQueueStartNowCommand(ctx context.Context, data CommandRunQueueIdData) error               // start it past the cap and past its After
	RunQueueRunNextCommand(ctx context.Context, data CommandRunQueueIdData) error                // move it to the head, waiting again
	RunQueueRemoveCommand(ctx context.Context, data CommandRunQueueIdData) error                 // drop it; entries after it are blocked
}

type CommandRunQueueAddData struct {
	Data  CommandCreateRunData `json:"data"`
	After string               `json:"after,omitempty"` // a run id or a queue entry id, or a unique prefix of either
}

type CommandRunQueueIdData struct {
	Id string `json:"id"` // an id or a unique prefix
}

type CommandRunQueueListRtnData struct {
	Entries   []RunQueueEntry `json:"entries"`
	MaxActive int             `json:"maxactive"` // runs:maxactive as the loop reads it; 0 is no cap
	Active    int             `json:"active"`    // top-level runs not done or cancelled
}

// RunQueueChangedData is the runqueue:changed event: the whole list, after every change the server makes to it.
type RunQueueChangedData struct {
	Entries []RunQueueEntry `json:"entries"`
}
