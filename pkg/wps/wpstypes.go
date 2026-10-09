// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wps

import (
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
)

// IMPORTANT: When adding a new event constant, you MUST also:
//  1. Add a "// type: <TypeName>" comment (use "none" if no data is sent)
//  2. Add the constant to AllEvents below
//  3. Add an entry to WaveEventDataTypes in pkg/tsgen/tsgenevent.go
//     - Use reflect.TypeOf(YourType{}) for value types
//     - Use reflect.TypeOf((*YourType)(nil)) for pointer types
//     - Use nil if no data is sent for the event
const (
	Event_BlockClose       = "blockclose"       // type: string
	Event_ControllerStatus = "controllerstatus" // type: *blockcontroller.BlockControllerRuntimeStatus
	Event_WaveObjUpdate    = "waveobj:update"   // type: waveobj.WaveObjUpdate
	Event_BlockFile        = "blockfile"        // type: *WSFileEventData
	Event_Config           = "config"           // type: wconfig.WatcherUpdate
	Event_Badge            = "badge"            // type: baseds.BadgeEvent
	Event_AgentStatus      = "agent:status"     // type: baseds.AgentStatusData
	Event_Notify           = "notify"           // type: wshrpc.NotifyCommandData
	Event_OpenFile         = "openfile"         // type: wshrpc.OpenFileData
	Event_AgentAsk         = "agent:ask"        // type: baseds.AgentAskData
	Event_JarvisVolunteer  = "jarvis:volunteer" // type: baseds.VolunteerData
	Event_Slept            = "system:slept"     // type: baseds.SleptData
	// orchestration engine events (pkg/orchestrate publishes these; the cockpit rail mirrors them)
	DagEventChildDone   = "dag:child-done"   // type: string (task id)
	DagEventGateOpen    = "dag:gate-open"    // type: string (gate task id)
	DagEventBlocked     = "dag:dag-blocked"  // type: string (failure count)
	DagEventComplete    = "dag:dag-complete" // type: string ("all tasks done")
	DagEventTaskSpawned = "dag:task-spawned" // type: string (task id)
	DagEventChildAsk    = "dag:child-ask"    // type: string (JSON {taskid, askid})
	DagEventTaskStalled = "dag:task-stalled" // type: string (task id)
	DagEventTaskRetried = "dag:task-retried" // type: string (task id)
	Event_RunEvent      = "run:event"        // type: wshrpc.RunEventData
)

var AllEvents []string = []string{
	Event_BlockClose,
	Event_ControllerStatus,
	Event_WaveObjUpdate,
	Event_BlockFile,
	Event_Config,
	Event_Badge,
	Event_AgentStatus,
	Event_Notify,
	Event_OpenFile,
	Event_AgentAsk,
	Event_JarvisVolunteer,
	Event_Slept,
	DagEventChildDone,
	DagEventGateOpen,
	DagEventBlocked,
	DagEventComplete,
	DagEventTaskSpawned,
	DagEventChildAsk,
	DagEventTaskStalled,
	DagEventTaskRetried,
	Event_RunEvent,
}

type WaveEvent struct {
	Event   string   `json:"event"`
	Scopes  []string `json:"scopes,omitempty"`
	Sender  string   `json:"sender,omitempty"`
	Persist int      `json:"persist,omitempty"`
	Data    any      `json:"data,omitempty"`
}

func (e WaveEvent) HasScope(scope string) bool {
	return utilfn.ContainsStr(e.Scopes, scope)
}

type SubscriptionRequest struct {
	Event     string   `json:"event"`
	Scopes    []string `json:"scopes,omitempty"`
	AllScopes bool     `json:"allscopes,omitempty"`
}

const (
	FileOp_Create     = "create"
	FileOp_Delete     = "delete"
	FileOp_Append     = "append"
	FileOp_Truncate   = "truncate"
	FileOp_Invalidate = "invalidate"
)

type WSFileEventData struct {
	ZoneId   string `json:"zoneid"`
	FileName string `json:"filename"`
	FileOp   string `json:"fileop"`
	Data64   string `json:"data64"`
}
