// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshrpc

import "context"

// ResMonCommands is the Resource Manager API: a sampled snapshot of the CPU and memory of Arc itself and
// of every agent's process tree (pkg/resmon), plus kill actions for agent subprocesses.
type ResMonCommands interface {
	ResMonSnapshotCommand(ctx context.Context, data CommandResMonSnapshotData) (*ResMonSnapshotData, error)
	ResMonKillCommand(ctx context.Context, data CommandResMonKillData) (*ResMonKillRtnData, error)
	ResMonKillChildrenCommand(ctx context.Context, data CommandResMonKillChildrenData) (*ResMonKillRtnData, error)
	ResMonKillShellTaskCommand(ctx context.Context, data CommandResMonKillShellTaskData) (*ResMonKillRtnData, error) // kill one of a claude agent's background shell tasks
}

const (
	ResMonOwner_Arc       = "arc"
	ResMonOwner_AgentTab  = "agenttab"
	ResMonOwner_RunWorker = "runworker"
	ResMonOwner_RunCmd    = "runcmd"

	ResMonKill_Killed    = "killed"
	ResMonKill_Gone      = "gone"      // the target had already exited
	ResMonKill_Refused   = "refused"   // not a member of a killable job of that owner (it left the job, or the owner is gone or read-only)
	ResMonKill_Protected = "protected" // the pid is a core process of the agent (agent, launcher, console or shell)
	ResMonKill_Failed    = "failed"    // the OS refused; Error holds its text
)

type CommandResMonSnapshotData struct {
	// Others also measures the processes that are not arcterm's or an agent's, grouped by image name: Sidecar's
	// resource panel asks for them while it is open. The first snapshot that asks has none yet (the sampler reads
	// them from its next tick on).
	Others bool `json:"others,omitempty"`
}

// ResMonOther is the processes of one image name outside arcterm and its agents, summed (chrome.exe, 12 of them).
type ResMonOther struct {
	Name  string  `json:"name"` // image name
	Count int     `json:"count"`
	Cpu   float64 `json:"cpu"`
	Mem   int64   `json:"mem"`
	Gpu   float64 `json:"gpu,omitempty"` // the busiest GPU engine any of them holds, as Task Manager sums a group
}

// ResMonMachine is the whole machine, read with the others: what Sidecar's resource charts plot.
type ResMonMachine struct {
	Cpu      float64  `json:"cpu"`           // percent of all cores; 0 before the second sample
	MemUsed  int64    `json:"memused"`       // bytes: total less available
	MemTotal int64    `json:"memtotal"`      // bytes
	Gpu      *float64 `json:"gpu,omitempty"` // percent of the busiest engine; none where the GPU counters cannot be read
}

type ResMonGroup struct {
	Key       string        `json:"key"`               // "arc", or "job:<rootpid>:<root createts>"; stable for the job's life
	OwnerKind string        `json:"ownerkind"`         // ResMonOwner_*
	OwnerId   string        `json:"ownerid,omitempty"` // block id (agenttab, runworker), run id (runcmd), "" for arc
	Label     string        `json:"label"`
	Runtime   string        `json:"runtime,omitempty"` // claude | pi: the tab's session:agent, for the swatch
	Killable  bool          `json:"killable"`
	Cpu       float64       `json:"cpu"`
	Mem       int64         `json:"mem"`
	Rows      []ProcessInfo `json:"rows"` // pre-order tree; Depth from 0
}

type ResMonSnapshotData struct {
	Supported bool          `json:"supported"` // false off Windows: the readout hides
	Ready     bool          `json:"ready"`     // false until a second sample gives CPU deltas
	Ts        int64         `json:"ts"`
	Cpu       float64       `json:"cpu"` // sum over every group
	Mem       int64         `json:"mem"`
	TotalMem  int64         `json:"totalmem"`
	BusyCpu   bool          `json:"busycpu"`
	BusyMem   bool          `json:"busymem"`
	Groups    []ResMonGroup `json:"groups"`
	// asked for with Others: the image names holding at least OthersMin bytes, heaviest first
	Others    []ResMonOther  `json:"others,omitempty"`
	OthersMin int64          `json:"othersmin,omitempty"`
	Machine   *ResMonMachine `json:"machine,omitempty"`
}

type CommandResMonKillData struct {
	OwnerId string `json:"ownerid"` // the block id of the group the row was shown in
	Pid     int32  `json:"pid"`
	Tree    bool   `json:"tree"` // also kill the pid's descendants inside the same job
}

type CommandResMonKillChildrenData struct {
	OwnerId string `json:"ownerid"`
}

// CommandResMonKillShellTaskData names a background shell task as the agent's transcript records it.
type CommandResMonKillShellTaskData struct {
	OwnerId   string `json:"ownerid"` // the agent's block id
	TaskId    string `json:"taskid"`
	Command   string `json:"command"`   // the Bash tool's command, verbatim
	StartedTs int64  `json:"startedts"` // epoch ms; picks between two tasks running the same command
}

type ResMonKillRtnData struct {
	Outcome string `json:"outcome"`         // ResMonKill_*
	Killed  int    `json:"killed"`          // processes terminated
	Error   string `json:"error,omitempty"` // set only for failed: the OS error text. The frontend builds every other note itself
}
