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
	Id          string               `json:"id"`          // "q-" + 4 hex, its own id space
	Data        CommandCreateRunData `json:"data"`        // what wsh runs start would have sent
	Title       string               `json:"title"`       // the plan's title, for rows and messages
	ProjectPath string               `json:"projectpath"` // the channel's project, for the tree's folder
	// After lists what the entry waits for: run ids and queue entry ids. It starts once every run in it has landed.
	// A queue file written before this was a list held one id as a string; pkg/runqueue reads that as a one-element list.
	After     []string `json:"after,omitempty"`
	QueuedTs  int64    `json:"queuedts"`
	State     string   `json:"state"`               // RunQueueState_*
	Reason    string   `json:"reason,omitempty"`    // why a blocked entry is blocked, or why a waiting one waits on (the re-check's reason)
	BlockedOn string   `json:"blockedon,omitempty"` // the run whose outcome blocked it; set only for that kind of block
	// Brainstorm is the brainstorm whose Approve queued this start, so wavesrv can tell its agent the run's id when
	// the entry starts, and the brainstorm's card can find its own entry. Nil for every other entry.
	Brainstorm *RunQueueBrainstorm `json:"brainstorm,omitempty"`
}

// RunQueueBrainstorm names the brainstorm a queued start came from: the agent's tab and its brainstorm.json.
type RunQueueBrainstorm struct {
	Tab  string `json:"tab"`  // the brainstorm agent's tab id: whom wavesrv tells when the entry starts
	Path string `json:"path"` // the absolute path of its brainstorm.json: how the card finds its entry
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
	After []string             `json:"after,omitempty"` // run ids and queue entry ids, or a unique prefix of each; the entry waits for all
	// Brainstorm is set when a brainstorm's Approve queues the start; the entry keeps it (RunQueueEntry.Brainstorm).
	Brainstorm *RunQueueBrainstorm `json:"brainstorm,omitempty"`
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
// Started names the run each entry this change started became, so a view open on that entry can follow it; it is
// empty for every other change.
type RunQueueChangedData struct {
	Entries []RunQueueEntry   `json:"entries"`
	Started []RunQueueStarted `json:"started,omitempty"`
}

// RunQueueStarted pairs a queue entry with the run its start created.
type RunQueueStarted struct {
	EntryId string `json:"entryid"`
	RunId   string `json:"runid"`
}
