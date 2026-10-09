// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshrpc

import "context"

// JobQueueCommands is the heavy-job queue (pkg/jobqueue): agents hold a slot through JobSlot, the cockpit reads
// and steers the queue.
type JobQueueCommands interface {
	JobSlotCommand(ctx context.Context, data CommandJobSlotData) chan RespOrErrorUnion[JobSlotUpdate] // wait for a slot for one shell command and hold it while the stream lives
	GetJobQueueCommand(ctx context.Context) (*JobQueueData, error)                                    // the running and queued heavy jobs
	JobQueueRunNowCommand(ctx context.Context, data CommandJobQueueActData) error                     // start a queued job past both gates
	JobQueueSkipCommand(ctx context.Context, data CommandJobQueueActData) error                       // refuse a queued agent job
}

type CommandJobSlotData struct {
	Command string `json:"command"`
	BlockId string `json:"blockid,omitempty"`
}

// JobSlotUpdate is one line of `wsh jobslot`: a queued place while it waits (the job ahead and who it is
// for), then run true (held) or false with the reason the agent reads.
type JobSlotUpdate struct {
	Queued int    `json:"queued,omitempty"`
	Behind string `json:"behind,omitempty"`
	For    string `json:"for,omitempty"`
	Run    *bool  `json:"run,omitempty"`
	Reason string `json:"reason,omitempty"`
}

type JobQueueJob struct {
	Id        string `json:"id"`
	Name      string `json:"name"`
	Bytes     uint64 `json:"bytes"`
	Running   bool   `json:"running,omitempty"`
	Forced    bool   `json:"forced,omitempty"`
	Engine    bool   `json:"engine,omitempty"`
	Position  int    `json:"position,omitempty"`
	Reason    string `json:"reason,omitempty"`
	QueuedTs  int64  `json:"queuedts"`
	StartedTs int64  `json:"startedts,omitempty"`
	BlockId   string `json:"blockid,omitempty"`
	TabId     string `json:"tabid,omitempty"`
	RunId     string `json:"runid,omitempty"`
	Label     string `json:"label,omitempty"`
}

type JobQueueData struct {
	Slots int           `json:"slots"`
	Jobs  []JobQueueJob `json:"jobs"`
}

type CommandJobQueueActData struct {
	Id string `json:"id"`
}
