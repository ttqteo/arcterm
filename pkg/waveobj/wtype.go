// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package waveobj

import (
	"encoding/json"
	"fmt"
	"reflect"
)

type UpdatesRtnType = []WaveObjUpdate

type UIContext struct {
	WindowId    string `json:"windowid"`
	ActiveTabId string `json:"activetabid"`
}

const (
	UpdateType_Update = "update"
	UpdateType_Delete = "delete"
)

const (
	OType_Client         = "client"
	OType_Window         = "window"
	OType_Workspace      = "workspace"
	OType_Tab            = "tab"
	OType_Channel        = "channel"
	OType_Block          = "block"
	OType_MainServer     = "mainserver"
	OType_Temp           = "temp"
	OType_RadarReport    = "radarreport"
	OType_Run            = "run"
	OType_ChannelMessage = "channelmessage"
	OType_Effort         = "effort"
	OType_Dag            = "dag"
)

var ValidOTypes = map[string]bool{
	OType_Client:         true,
	OType_Window:         true,
	OType_Workspace:      true,
	OType_Tab:            true,
	OType_Channel:        true,
	OType_Block:          true,
	OType_MainServer:     true,
	OType_Temp:           true,
	OType_RadarReport:    true,
	OType_Run:            true,
	OType_ChannelMessage: true,
	OType_Effort:         true,
	OType_Dag:            true,
}

type WaveObjUpdate struct {
	UpdateType string  `json:"updatetype"`
	OType      string  `json:"otype"`
	OID        string  `json:"oid"`
	Obj        WaveObj `json:"obj,omitempty"`
}

func (update WaveObjUpdate) MarshalJSON() ([]byte, error) {
	rtn := make(map[string]any)
	rtn["updatetype"] = update.UpdateType
	rtn["otype"] = update.OType
	rtn["oid"] = update.OID
	if update.Obj != nil {
		var err error
		rtn["obj"], err = ToJsonMap(update.Obj)
		if err != nil {
			return nil, err
		}
	}
	return json.Marshal(rtn)
}

func (update *WaveObjUpdate) UnmarshalJSON(data []byte) error {
	var objMap map[string]any
	err := json.Unmarshal(data, &objMap)
	if err != nil {
		return err
	}
	var ok1, ok2, ok3 bool
	if _, found := objMap["updatetype"]; !found {
		return fmt.Errorf("missing updatetype (in WaveObjUpdate)")
	}
	update.UpdateType, ok1 = objMap["updatetype"].(string)
	if !ok1 {
		return fmt.Errorf("in WaveObjUpdate bad updatetype type %T", objMap["updatetype"])
	}
	if _, found := objMap["otype"]; !found {
		return fmt.Errorf("missing otype (in WaveObjUpdate)")
	}
	update.OType, ok2 = objMap["otype"].(string)
	if !ok2 {
		return fmt.Errorf("in WaveObjUpdate bad otype type %T", objMap["otype"])
	}
	if _, found := objMap["oid"]; !found {
		return fmt.Errorf("missing oid (in WaveObjUpdate)")
	}
	update.OID, ok3 = objMap["oid"].(string)
	if !ok3 {
		return fmt.Errorf("in WaveObjUpdate bad oid type %T", objMap["oid"])
	}
	if _, found := objMap["obj"]; found {
		objMap, ok := objMap["obj"].(map[string]any)
		if !ok {
			return fmt.Errorf("in WaveObjUpdate bad obj type %T", objMap["obj"])
		}
		waveObj, err := FromJsonMap(objMap)
		if err != nil {
			return fmt.Errorf("in WaveObjUpdate error decoding obj: %w", err)
		}
		update.Obj = waveObj
	}
	return nil
}

type Client struct {
	OID           string      `json:"oid"`
	Version       int         `json:"version"`
	WindowIds     []string    `json:"windowids"`
	Meta          MetaMapType `json:"meta"`
	HasOldHistory bool        `json:"hasoldhistory,omitempty"`
	TempOID       string      `json:"tempoid,omitempty"`
	InstallId     string      `json:"installid,omitempty"`
}

func (*Client) GetOType() string {
	return OType_Client
}

// stores the ui-context of the window, points to a workspace containing the actual data being displayed in the window
type Window struct {
	OID         string      `json:"oid"`
	Version     int         `json:"version"`
	WorkspaceId string      `json:"workspaceid"`
	IsNew       bool        `json:"isnew,omitempty"` // set when a window is created on the backend so the FE can size it properly.  cleared on first resize
	Pos         Point       `json:"pos"`
	WinSize     WinSize     `json:"winsize"`
	LastFocusTs int64       `json:"lastfocusts"`
	Meta        MetaMapType `json:"meta"`
}

func (*Window) GetOType() string {
	return OType_Window
}

type WorkspaceListEntry struct {
	WorkspaceId string `json:"workspaceid"`
	WindowId    string `json:"windowid"`
}

type WorkspaceList []*WorkspaceListEntry

type Workspace struct {
	OID         string      `json:"oid"`
	Version     int         `json:"version"`
	Name        string      `json:"name,omitempty"`
	Icon        string      `json:"icon,omitempty"`
	Color       string      `json:"color,omitempty"`
	TabIds      []string    `json:"tabids"`
	ActiveTabId string      `json:"activetabid"`
	Meta        MetaMapType `json:"meta"`
}

func (*Workspace) GetOType() string {
	return OType_Workspace
}

type Tab struct {
	OID      string      `json:"oid"`
	Version  int         `json:"version"`
	Name     string      `json:"name"`
	BlockIds []string    `json:"blockids"`
	Meta     MetaMapType `json:"meta"`
}

func (*Tab) GetOType() string {
	return OType_Tab
}

type ChannelMessage struct {
	OID        string      `json:"oid"`
	Version    int         `json:"version"`
	ChannelOID string      `json:"channeloid,omitempty"` // parent channel oid; indexed for per-channel list queries (phase 2)
	ID         string      `json:"id"`                   // == OID; retained for embedded-blob consumers until phase 3 contract
	Kind       string      `json:"kind"`
	Author     string      `json:"author"`
	Text       string      `json:"text"`
	RefORef    string      `json:"reforef,omitempty"`
	Ts         int64       `json:"ts"`
	Data       string      `json:"data,omitempty"` // optional JSON payload for rich rendering (e.g. JarvisCardData)
	Meta       MetaMapType `json:"meta"`
}

func (*ChannelMessage) GetOType() string {
	return OType_ChannelMessage
}

// PhaseTriage is an adaptive orchestrator lead's self-reported sizing of the goal: quick (do it
// directly) vs plan (plan first). Recorded on the orchestrate phase, non-blocking — informational.
type PhaseTriage struct {
	Verdict string `json:"verdict"`        // quick | plan
	Note    string `json:"note,omitempty"` // one-line reason
}

type RoutePin struct {
	Runtime string `json:"runtime"`
	Model   string `json:"model,omitempty"` // exact model id; empty means the runtime's own default
	// Tier is read only by the startup pin migration (runroute.MigrateTierPin), which clears it.
	Tier string `json:"tier,omitempty"`
}

type RunPhase struct {
	Kind        string       `json:"kind"`               // brainstorm | plan | execute | orchestrate | custom
	Skill       string       `json:"skill,omitempty"`    // e.g. "superpowers:writing-plans"
	State       string       `json:"state"`              // pending | running | blocked | done | failed | skipped
	Gate        bool         `json:"gate,omitempty"`     // pipeline: halt after this phase; orchestrator: the lead was told to hold
	FreshCtx    bool         `json:"freshctx,omitempty"` // this phase runs in its own fresh worker (clear-context boundary)
	Held        bool         `json:"held,omitempty"`     // orchestrator: the lead paused itself at the plan gate (runtime)
	Triage      *PhaseTriage `json:"triage,omitempty"`   // orchestrator (adaptive): the lead's quick-vs-plan call (runtime)
	WorkerOrefs []string     `json:"workerorefs,omitempty"`
	Artifacts   []string     `json:"artifacts,omitempty"`
	StartedTs   int64        `json:"startedts,omitempty"` // set when the phase enters running
	DoneTs      int64        `json:"donets,omitempty"`    // set when the phase completes
}

type Run struct {
	OID         string          `json:"oid"`
	Version     int             `json:"version"`
	ChannelOID  string          `json:"channeloid,omitempty"` // parent channel oid; indexed for per-channel run queries (phase 2)
	ID          string          `json:"id"`                   // == OID; retained for embedded-blob consumers until phase 3 contract
	Goal        string          `json:"goal"`
	Runtime     string          `json:"runtime,omitempty"` // the harness running every phase and child; empty means legacy Claude-only
	Model       string          `json:"model,omitempty"`   // exact model id override (flat route); empty means the runtime default
	PlaybookId  string          `json:"playbookid,omitempty"`
	Mode        string          `json:"mode,omitempty"`       // pipeline | orchestrator (empty = pipeline, legacy-safe)
	WorkspaceId string          `json:"workspaceid"`          // where phase-worker tabs are created (frontend supplies at CreateRun)
	ProjectPath string          `json:"projectpath"`          // worker cwd (copied from the channel)
	LandPath    string          `json:"landpath,omitempty"`   // tree the engine lands lanes in (a wave/<runId> worktree); empty = ProjectPath
	BaseBranch  string          `json:"basebranch,omitempty"` // branch ProjectPath had checked out at run creation, which the run merges back into; empty = detached HEAD
	BaseCommit  string          `json:"basecommit,omitempty"` // HEAD of ProjectPath at run creation; anchors the evidence diff
	EndCommit   string          `json:"endcommit,omitempty"`  // commit the worker reported as its finished work; scopes the evidence diff to BaseCommit..EndCommit (else falls back to the working-tree diff)
	Report      string          `json:"report,omitempty"`     // lead's final report, sent with `wsh jarvis complete --report <file>`; the only way it survives the engine closing the lead's tab mid-turn on complete
	Principles  PrincipleList   `json:"principles,omitempty"` // resolved at CreateRun; fed to every phase worker prompt
	Status      string          `json:"status"`               // planning | awaiting-review | executing | blocked | done | cancelled
	Phases      []RunPhase      `json:"phases"`
	RadarOrigin *RunRadarOrigin `json:"radarorigin,omitempty"` // set when started from a Radar finding
	CreatedTs   int64           `json:"createdts"`
	CompletedTs int64           `json:"completedts,omitempty"` // set at seal, when Status becomes done
	Evidence    *RunEvidence    `json:"evidence,omitempty"`    // sealed once at completion; immutable
	// Land is the merge of a branch-landed run's wave/<runId> back into BaseBranch, which runs after the seal.
	// It lives beside the evidence, not in it, because a held land is retried after the seal is frozen.
	Land *RunLand `json:"land,omitempty"`
	// VerificationAckTs is when the human acknowledged an unverified outcome, which clears its attention item.
	VerificationAckTs int64 `json:"verificationackts,omitempty"`
	// ParentLeadORef is the tab oref ("tab:<id>") of the orchestrator lead that spawned this child run
	// via `wsh jarvis run`. Empty for human-started runs. Drives the terminal-status notify-back.
	ParentLeadORef string `json:"parentleadoref,omitempty"`
	// OriginTabId is the tab of the session that started this run with `wsh runs start`, so the cockpit can
	// list the run beside it. Empty for a run started from the cockpit, or outside a Wave tab.
	OriginTabId string `json:"origintabid,omitempty"`
	// EffortRef links a run to the effort chunk it executes (set by the composer's effort picker or
	// `wsh effort chunk attach --run`). Advisory: the run never ticks the chunk automatically.
	EffortRef *RunEffortRef `json:"effortref,omitempty"`
	// DagORef links an orchestrator run to its TaskGroup ("dag:<id>"); set by DagSubmitCommand,
	// copied onto child runs so the engine can resolve the group from any run in the DAG.
	DagORef string `json:"dagoref,omitempty"`
	// SessionId is the session id the engine launched a dag child's worker with (--session-id). The
	// worker's transcript is named by it, so liveness and evidence open that file. Empty for runs the
	// engine did not launch.
	SessionId string `json:"sessionid,omitempty"`
	// LeadSessionIds is every session a lead was launched under, oldest first. A relaunched lead replaces
	// SessionId and its dead predecessor's tab is dropped from the phase, so this is the only record that
	// the earlier sessions spent tokens on the run.
	LeadSessionIds []string `json:"leadsessionids,omitempty"`
	// TaskId is the dag task a child run works, and Review marks the child that reviews it. The task's own
	// links (TaskNode.RunID, ReviewRunID) move on at a retry or a verdict, so an earlier attempt or a finished
	// reviewer is placed only by these. Empty for runs the engine did not launch.
	TaskId string `json:"taskid,omitempty"`
	Review bool   `json:"review,omitempty"`
	// StageRole marks a dag-level judging session, one that works no task: "plan-reviewer" or "verifier".
	StageRole string `json:"stagerole,omitempty"`
	// Branch is the git branch a dag child's worker committed on: its lane's wave/<key>. Cleanup deletes the
	// branch and the worktree, so a finished worker's branch is known only from here. Empty outside a repo.
	Branch string `json:"branch,omitempty"`
	// WorkerRoute is the default worker route for orchestrator children (nil = inherit lead); stored here at CreateRun so a submit can carry it onto the group.
	WorkerRoute *RoutePin `json:"workerroute,omitempty"`
	// ReviewerPicks is the Reviewer picks workers setting, carried onto the group at submit like WorkerRoute:
	// the plan reviewer picks each task's model. false = the WorkerRoute rule stands. Never set with WorkerRoute.
	ReviewerPicks bool `json:"reviewerpicks,omitempty"`
	// ReviewerRoute is the route task reviewers and stage sessions run on (nil = the lead's route). Only the
	// human sets it; a submit carries it onto the group.
	ReviewerRoute *RoutePin `json:"reviewerroute,omitempty"`
	// Orchestration selects which machine an orchestrator lead drives: "engine" publishes a TaskGroup
	// that pkg/orchestrate schedules; "adaptive" dispatches the lead's own subagents with no TaskGroup.
	// Empty preserves the pre-2026-09 fork, where runtime alone decided (pi engine, others adaptive).
	Orchestration string `json:"orchestration,omitempty"`
	// Parallelism is how many DAG children the engine may run at once, chosen by the user in the Run
	// rail before launch. It is a resource dial (N concurrent worktrees and token streams), not a
	// planning decision, so DagSubmit prefers it over the width the lead asks for. 0 = unset: the lead's
	// own width stands, which is what every pre-rail run has.
	Parallelism int `json:"parallelism,omitempty"`
	// Prototype is the design canvas the run was started with (Build this… on a canvas). It wins over the
	// plan's **Prototype:** line at DagSubmit; empty = the plan's stands.
	Prototype string `json:"prototype,omitempty"`
	// historical: slice 5c removed the plan gate; kept so a stored run still decodes as it was written.
	PlanGatePending *bool `json:"plangatepending,omitempty"`
	// historical: what the human wrote when they sent this run's gated plan back. Slice 5c removed the
	// plan gate, so nothing writes or reads this any more; kept so a stored run still decodes as it was
	// written.
	PlanFeedback string      `json:"planfeedback,omitempty"`
	Meta         MetaMapType `json:"meta"`
}

func (*Run) GetOType() string {
	return OType_Run
}

// RunLand is where a run's branch stands on its way back into the branch it started from.
type RunLand struct {
	State  string   `json:"state"`            // pending | landed | held
	Reason string   `json:"reason,omitempty"` // why it is held
	Commit string   `json:"commit,omitempty"` // the merge commit
	Notes  []string `json:"notes,omitempty"`  // what the landed result was not verified against, e.g. a moved base
}

// TaskNode.ModelSource values: who set the task's RunSpec model.
const (
	TaskModelSource_Plan       = "plan"
	TaskModelSource_Reviewer   = "reviewer"
	TaskModelSource_Owner      = "owner"
	TaskModelSource_Escalation = "escalation"
)

// TaskNode is one unit of work in a TaskGroup DAG. State is derived by the engine
// (pkg/orchestrate), never hand-set — mirrors the RunStatus discipline.
type TaskNode struct {
	ID          string   `json:"id"` // "t-1", unique within the group
	Label       string   `json:"label,omitempty"`
	Description string   `json:"description,omitempty"` // plan context for the child (pins decisions the child must not re-ask)
	Deps        []string `json:"deps,omitempty"`
	Chunks      []string `json:"chunks,omitempty"`   // labels of the dag's effort chunks this task closes when it lands
	Gate        bool     `json:"gate,omitempty"`     // halt the DAG at completion for review
	State       string   `json:"state"`              // pending|ready|running|stalled|done|failed|cancelled|skipped|blocked-merge|verifying|verify-failed
	RunID       string   `json:"runid,omitempty"`    // child run once spawned
	Released    bool     `json:"released,omitempty"` // gate released by human approval
	Merged      bool     `json:"merged,omitempty"`   // successful squash-merge back into the project branch
	RunSpec     RunSpec  `json:"runspec,omitempty"`
	// ModelSource is who set RunSpec's model: plan | reviewer | owner | escalation (TaskModelSource_*). Empty is
	// a typed-JSON RunSpec pin, or no pin at all. On a group not on Reviewer picks, a plan or reviewer pin is ignored.
	ModelSource string `json:"modelsource,omitempty"`
	// PickReason is the plan reviewer's one-line reason for its pick. Kept after the owner changes the pick, so
	// the panel can still say why the reviewer chose it.
	PickReason string `json:"pickreason,omitempty"`
	// LastActivity is the newest observed child transcript write (UnixMilli). The watchdog flags a
	// running task stalled when this goes quiet past the stall threshold; 0 = never observed.
	LastActivity int64 `json:"lastactivity,omitempty"`
	// CPUSample is the child's process-tree CPU time (ms), read on every tick while the task runs (throttled),
	// and CPUSampleTs when (UnixMilli). The next reading compares against it: a worker sitting in a
	// foreground test run writes nothing but its tree is busy.
	CPUSample   int64 `json:"cpusample,omitempty"`
	CPUSampleTs int64 `json:"cpusamplets,omitempty"`
	// BusyTs is the last CPU sample that showed the worker's tree working (UnixMilli). It is kept apart from
	// LastActivity, which is the transcript's, so status can tell a long command from silence.
	BusyTs int64 `json:"busyts,omitempty"`
	// LatestTool is the worker's in-progress tool call from its status hook, "" between calls.
	LatestTool string `json:"latesttool,omitempty"`
	// ProgressHash is the worktree's last fingerprint and ProgressTs when it last changed (seeded at spawn): a
	// worker can write its transcript for an hour while its tree stays put, and liveness alone calls that healthy.
	// ProgressCheckTs throttles the git probe to once per check interval.
	ProgressHash    string `json:"progresshash,omitempty"`
	ProgressTs      int64  `json:"progressts,omitempty"`
	ProgressCheckTs int64  `json:"progresscheckts,omitempty"`
	// SuspectTs is when the task was last flagged as busy but not progressing, 0 while the stagnation flag is
	// armed, so one stuck stretch wakes the lead once; a tree change re-arms it. SuspectReason is the flag's text.
	SuspectTs     int64  `json:"suspectts,omitempty"`
	SuspectReason string `json:"suspectreason,omitempty"`
	// FlaggedFailures are the repeated-failure keys that already woke the lead in this attempt: they stay in the
	// transcript tail after a re-arm and must not wake it again.
	FlaggedFailures []string `json:"flaggedfailures,omitempty"`
	// StallRetries counts the times the engine retried this task itself after it stalled with no live
	// lead to judge it; MaxAutoStallRetries in orchestrate caps it.
	StallRetries int `json:"stallretries,omitempty"`
	// FirstActivity is the FIRST observed child transcript write (UnixMilli), stamped once and never
	// revised. Against the task-spawned row it measures how long a child took to produce anything at
	// all, which is the span that separates environment setup from cold orientation; 0 = not yet
	// observed. It is an upper bound, not the true first token: the watchdog samples an mtime.
	FirstActivity int64 `json:"firstactivity,omitempty"`
	// ToldTs is the transcript time of the newest message the human typed into the child's own session that
	// the owning run already records as task-told, so each message is recorded once; 0 = none yet.
	ToldTs int64 `json:"toldts,omitempty"`
	// Attempts is the consecutive count for LastFailureKind.
	Attempts int `json:"attempts,omitempty"`
	// LastFailureKind is the classifier output for the latest failed attempt.
	LastFailureKind string `json:"lastfailurekind,omitempty"`
	// Escalations is the judged-hop count; one is the terminal cap for this phase.
	Escalations    int    `json:"escalations,omitempty"`
	CleanupPending bool   `json:"cleanuppending,omitempty"`
	CleanupError   string `json:"cleanuperror,omitempty"`
	// CleanupAttempts counts consecutive failed worktree removals; past the cap the debt stops blocking
	// the dag from finishing. Reset on success and when a merge lands.
	CleanupAttempts int `json:"cleanupattempts,omitempty"`
	// VerifyError is why the plan's Verify failed after this task merged: the exit code or the timeout,
	// then the tail of the command's output. Cleared when Verify passes.
	VerifyError string `json:"verifyerror,omitempty"`
	// VerifyOutput is the tail of the plan's Verify output, kept on a pass as well as a failure so a human
	// can read the gate. Cleared when the task's Verify is re-run.
	VerifyOutput string `json:"verifyoutput,omitempty"`
	// VerifyStartedTs is when the task last moved to verifying (UnixMilli); the UI ticks elapsed from it.
	VerifyStartedTs int64 `json:"verifystartedts,omitempty"`
	// MergeError is why git refused this lane's squash merge, for a refusal that is not a conflict (a
	// conflict leaves the tree mid-merge and is its own state). MergeFailures is the consecutive count
	// of those refusals; the automatic path stops retrying and blocks at the limit. Both are cleared
	// when the merge lands.
	MergeError    string `json:"mergeerror,omitempty"`
	MergeFailures int    `json:"mergefailures,omitempty"`
	// The review loop (spec 2026-09-23-orchestrator-review-and-lead-link): a worker's finished commit is judged
	// by a reviewer before the task counts as done. ReviewRunID is the reviewer's child run while the task is
	// reviewing, ReviewSpawnedTs when it was spawned (UnixMilli; the review timeout runs from it), and
	// ReviewRespawns how many of this round's reviewers were replaced after ending without a verdict.
	ReviewRunID     string `json:"reviewrunid,omitempty"`
	ReviewSpawnedTs int64  `json:"reviewspawnedts,omitempty"`
	ReviewRespawns  int    `json:"reviewrespawns,omitempty"`
	// ReviewRound counts failed reviews; at the limit the lead judges the task.
	ReviewRound int `json:"reviewround,omitempty"`
	// ReviewVerdict (pass | fail), ReviewNote (the summary, the findings, or why the review itself failed),
	// ReviewDownstream (what later tasks must know, from a pass) and ReviewDownstreamFor (the tasks the reviewer
	// named for it, which the engine delivers it to) are the latest review's outcome. ReviewUnverified is a
	// pass's caveat: a check the task asked for that was not done, printed whole to the lead.
	ReviewVerdict       string   `json:"reviewverdict,omitempty"`
	ReviewNote          string   `json:"reviewnote,omitempty"`
	ReviewDownstream    string   `json:"reviewdownstream,omitempty"`
	ReviewUnverified    string   `json:"reviewunverified,omitempty"`
	ReviewDownstreamFor []string `json:"reviewdownstreamfor,omitempty"`
	// ReviewBase is the commit the task's first reviewed attempt started from, so a fix after a failed round
	// is judged together with the work it fixes; ReviewCommit is the worker commit the latest verdict judged.
	ReviewBase   string `json:"reviewbase,omitempty"`
	ReviewCommit string `json:"reviewcommit,omitempty"`
	// LeadGuidance is the lead's note for the attempt after a sendback, LeadNotes what the lead added with
	// `dag amend` before the task started, and LeadTold what the lead typed with `dag tell` that the scan
	// for the human's messages has not matched yet.
	LeadGuidance string   `json:"leadguidance,omitempty"`
	LeadNotes    []string `json:"leadnotes,omitempty"`
	LeadTold     []string `json:"leadtold,omitempty"`
}

// RunSpec is the child-run launch form a task wants (runtime/mode/goal override).
type RunSpec struct {
	Runtime string `json:"runtime,omitempty"` // harness; empty = run default
	Model   string `json:"model,omitempty"`   // exact model id; empty = runtime default
	Mode    string `json:"mode,omitempty"`    // quick | pipeline | orchestrator
	Goal    string `json:"goal,omitempty"`    // per-task goal; empty = task label
}

// TaskGroup is the persisted DAG attached to an orchestrator run (oref dag:<id>).
type TaskGroup struct {
	OID           string      `json:"oid"`
	Version       int         `json:"version"`
	ID            string      `json:"id"`        // == OID; retained for embedded-blob consumers until phase 3 contract
	RunID         string      `json:"runid"`     // owning orchestrator run
	ChannelId     string      `json:"channelid"` // owning run's channel (run lookups are channel-scoped)
	Title         string      `json:"title,omitempty"`
	Parallelism   int         `json:"parallelism"`
	Tasks         []TaskNode  `json:"tasks"`
	Status        string      `json:"status"`                  // awaiting-plan|running|awaiting-review|blocked|done|cancelled (derived)
	Failures      int         `json:"failures"`                // consecutive task failures; circuit-break at 3
	WorkerRoute   *RoutePin   `json:"workerroute,omitempty"`   // default worker route (nil = inherit owner); task RunSpec wins
	ReviewerPicks bool        `json:"reviewerpicks,omitempty"` // the plan reviewer picks task models (false = the WorkerRoute rule stands)
	ReviewerRoute *RoutePin   `json:"reviewerroute,omitempty"` // route for task reviewers and stage sessions (nil = the lead's route)
	MergeRequired bool        `json:"mergerequired,omitempty"`
	CreatedTs     int64       `json:"createdts"`
	UpdatedTs     int64       `json:"updatedts"`
	Meta          MetaMapType `json:"meta"`

	// historical: slice 5c removed the plan gate; kept so a stored dag still decodes as it was written.
	PlanGate       bool  `json:"plangate,omitempty"`
	PlanApprovedTs int64 `json:"planapprovedts,omitempty"`

	// NotifiedCondition is the condition the lead was last woken about (the status, plus the gate task
	// or blocking kind it is about). Engine bookkeeping: it is what keeps a re-entered Schedule from
	// re-announcing a condition that has not changed. Kept in its own block so its name does not
	// rewiden the alignment of every field above it.
	NotifiedCondition string `json:"notifiedcondition,omitempty"`

	// Usage is the run's tokens per session and model (jarvis.RunUsage), totalled once when the dag is done.
	Usage []UsageRow `json:"usage,omitempty"`

	// Verify, Setup and Check are the plan's commands (jarvis.PlanFormat). Setup runs in each new task
	// worktree before its worker spawns; Verify runs where lanes land after each squash merge, scoped by
	// ARC_VERIFY_CHANGED, and once unscoped in the final stage; Check
	// is a fast whole-project static check each worker runs itself instead of Verify. All three are empty
	// for a dag submitted as JSON, which is then prepared by nobody and reported unverified.
	Verify string `json:"verify,omitempty"`
	Setup  string `json:"setup,omitempty"`
	Check  string `json:"check,omitempty"`
	// BaseCheck is the plan's Check run once on the commit the lanes start from, at submit, before any task.
	// A failure there is the base's, not a task's. Nil for a dag with no Check.
	BaseCheck *BaseCheck `json:"basecheck,omitempty"`

	// FinalCmd is the plan's Final command, run once on the merged result by the final stage; Prototype is the
	// design canvas path the final verifier compares against. Both empty when the plan names none.
	FinalCmd  string `json:"finalcmd,omitempty"`
	Prototype string `json:"prototype,omitempty"`

	// Preamble is the plan's header prose (jarvis.Plan.Preamble): everything before the first task other
	// than the title and the Verify/Setup/Check lines. Every worker's prompt carries it, so a rule stated
	// once in the header reaches every task instead of only whichever task happens to read the plan file.
	Preamble string `json:"preamble,omitempty"`

	// EffortOID is the effort tracker (jarvis.Plan.EffortOID) whose chunks the tasks' Chunks name. When a
	// task's merge passes Verify the engine marks those chunks done there.
	EffortOID string `json:"effortoid,omitempty"`

	// PlanPath and SpecPath are the plan a dag was submitted from and the spec it implements. A branch-landed
	// dag commits both on its branch at submit and keeps them repo-relative, so each reader resolves them in
	// its own tree. A checkout-landed dag keeps them absolute and uncommitted in the project checkout until
	// its first squash merge, which stages both so the docs land with the work they describe. Empty for a dag
	// submitted as JSON.
	PlanPath string `json:"planpath,omitempty"`
	SpecPath string `json:"specpath,omitempty"`

	// PlanReview is the engine's review of the spec and plan at submit. Nothing dispatches until it has
	// passed or the lead accepted it on the human's word. Nil for a dag submitted as JSON.
	PlanReview *PlanReviewStage `json:"planreview,omitempty"`

	// Final is the stage that judges the merged result once every task landed: the plan's Check, its Final
	// command, then a verifier session. The dag is done only once it passed or came out unverified. Nil
	// until the stage first starts.
	Final *FinalStage `json:"final,omitempty"`

	// PastFinals are the finished earlier rounds of the final stage, oldest first: a fix round keeps the round it
	// fixes here instead of overwriting it.
	PastFinals []FinalStage `json:"pastfinals,omitempty"`
}

// PlanReviewStage is one dag's plan review: its round, the reviewer session judging it, and the verdict's text.
type PlanReviewStage struct {
	State     string `json:"state"` // reviewing | passed | failed | accepted
	Round     int    `json:"round"`
	RunID     string `json:"runid,omitempty"`    // the reviewer session's child run
	Findings  string `json:"findings,omitempty"` // fail findings or pass summary, whole
	Respawns  int    `json:"respawns,omitempty"`
	StartedTs int64  `json:"startedts,omitempty"`
}

// BaseCheck is one dag's Check on its base commit.
type BaseCheck struct {
	State  string `json:"state"`            // running | passed | failed | skipped (it could not run; Detail says why)
	Commit string `json:"commit,omitempty"` // the commit it checked
	Detail string `json:"detail,omitempty"` // the failure's reason and first failing lines
}

// FinalStage is one dag's final stage: the round it is in, where it runs, and what it found.
type FinalStage struct {
	State         string   `json:"state"`                   // checking | final | verifying | passed | unverified | failed; empty is a round not started yet
	Round         int      `json:"round"`                   // 1-based; a fix round increments it
	Tree          string   `json:"tree,omitempty"`          // where it runs
	Commit        string   `json:"commit,omitempty"`        // the tree HEAD it verified
	OutDir        string   `json:"outdir,omitempty"`        // ARC_FINAL_OUT
	Detail        string   `json:"detail,omitempty"`        // the failure's output tail or defects, whole
	Unverified    []string `json:"unverified,omitempty"`    // what could not be verified, and why
	VerifierRunID string   `json:"verifierrunid,omitempty"` // the verifier session's child run
	Respawns      int      `json:"respawns,omitempty"`
	StartedTs     int64    `json:"startedts,omitempty"` // when the verifier session started
	Step          string   `json:"step,omitempty"`      // the command running: tree | check | verify | final; empty when none is
	StepTs        int64    `json:"stepts,omitempty"`    // when Step started
	Output        string   `json:"output,omitempty"`    // the running command's output tail
	// Shots is what the Final command wrote into OutDir, read once it exited
	Shots         []FinalShot `json:"shots,omitempty"`
	ShotsManifest bool        `json:"shotsmanifest,omitempty"` // Shots came from shots.json (verdicts and steps); false is a plain PNG listing
}

// FinalShot is one scenario of a Final command's screenshots: its files, and the steps it ran when the command
// wrote a shots.json manifest.
type FinalShot struct {
	Name  string          `json:"name"`
	Files []string        `json:"files"` // relative to FinalStage.OutDir, forward slashes
	Steps []FinalShotStep `json:"steps,omitempty"`
}

// FinalShotStep is one step of a FinalShot's scenario.
type FinalShotStep struct {
	Step   string `json:"step"`
	State  string `json:"state"` // pass | fail | skip
	Detail string `json:"detail,omitempty"`
}

func (*TaskGroup) GetOType() string {
	return OType_Dag
}

// RunEvidence is the sealed, immutable snapshot of what a run produced, derived server-side and frozen at
// completion (SealEvidence). Presence gates the frontend completion view; it is never recomputed once set.
type RunEvidence struct {
	CapturedTs int64              `json:"capturedts"`
	Hash       string             `json:"hash"`
	Summary    string             `json:"summary,omitempty"`
	Files      []EvidenceFile     `json:"files,omitempty"`
	AddTotal   int                `json:"addtotal"`
	DelTotal   int                `json:"deltotal"`
	Verifs     []EvidenceVerif    `json:"verifs,omitempty"`
	Artifacts  []EvidenceArtifact `json:"artifacts,omitempty"`
	RuntimeMs  int64              `json:"runtimems"`         // Σ phase active spans (active compute)
	DurationMs int64              `json:"durationms"`        // wall clock (CompletedTs - CreatedTs)
	Harness    string             `json:"harness,omitempty"` // the runtime that ran the work
	Model      string             `json:"model,omitempty"`   // the model the transcript reports, else the route's pin; empty when neither is known
	Usage      []UsageRow         `json:"usage,omitempty"`   // a dag owner's tokens per session and model, the lead's wrap-up included

	// Verification is a dag owner's final-stage outcome, sealed from TaskGroup.Final.
	Verification *RunVerification `json:"verification,omitempty"`

	// Dag is a dag owner's account of its tasks, snapshotted at the seal.
	Dag *EvidenceDag `json:"dag,omitempty"`
}

// EvidenceDag is what a dag's workers reported, by task, sealed with the lead's run. Sections are whole: this is
// the record, not a prompt.
type EvidenceDag struct {
	Tasks      []EvidenceDagTask `json:"tasks,omitempty"` // dag order; done, skipped and failed tasks
	Answered   int               `json:"answered"`
	Forwarded  int               `json:"forwarded"`
	Told       []string          `json:"told,omitempty"`       // what the human typed to workers
	LeftBehind []string          `json:"leftbehind,omitempty"` // task ids whose tree is retry-cleanup
}

// EvidenceDagTask is one task's row of EvidenceDag. Done is left out; `wsh jarvis dag report` reads it.
type EvidenceDagTask struct {
	TaskId             string `json:"taskid"`
	Label              string `json:"label,omitempty"`
	State              string `json:"state"`
	Commit             string `json:"commit,omitempty"`
	ReviewRounds       int    `json:"reviewrounds,omitempty"`
	Differs            string `json:"differs,omitempty"`
	NotVerified        string `json:"notverified,omitempty"`
	ReviewerUnverified string `json:"reviewerunverified,omitempty"`
	FoundNotFixed      string `json:"foundnotfixed,omitempty"`
	ForLead            string `json:"forlead,omitempty"`      // For later tasks, only where it went to the lead
	Unstructured       string `json:"unstructured,omitempty"` // a legacy report, whole
}

// RunVerification is how the final stage judged a run's merged result.
type RunVerification struct {
	State   string   `json:"state"` // passed | unverified | failed
	Reasons []string `json:"reasons,omitempty"`
}

// UsageRow is one session's tokens on one model, for a run's per-role totals. Tokens only: prices stay in
// the frontend's single price table.
type UsageRow struct {
	Role         string `json:"role"` // lead | worker | reviewer | plan-reviewer | verifier
	TaskId       string `json:"taskid,omitempty"`
	Model        string `json:"model,omitempty"`
	Input        int    `json:"input"`
	Output       int    `json:"output"`
	CacheRead    int    `json:"cacheread"`
	CacheWrite   int    `json:"cachewrite"` // 5-minute writes
	CacheWrite1h int    `json:"cachewrite1h"`
	Msgs         int    `json:"msgs"`
	Missing      bool   `json:"missing,omitempty"` // the transcript could not be read
}

type EvidenceFile struct {
	Path string `json:"path"`
	Stat string `json:"stat"` // "A" | "M" | "D"
	Add  int    `json:"add"`
	Del  int    `json:"del"`
}

type EvidenceVerif struct {
	Cmd    string `json:"cmd"`
	Result string `json:"result"` // "pass" | "fail": the engine's Verify; "ran": a worker's transcript; "unknown": older evidence
	Detail string `json:"detail,omitempty"`
}

type EvidenceArtifact struct {
	Path string `json:"path"`
	Kind string `json:"kind"` // "doc" | "report" | "image" | "file"
	Size int64  `json:"size"`
}

// RunEffortRef links a Run to the Effort chunk it executes.
type RunEffortRef struct {
	EffortOID  string `json:"effortoid"`
	ChunkLabel string `json:"chunklabel"`
}

// RunRadarOrigin links a Run back to the Radar finding it was started from. The Run lifecycle acts on it:
// create/done/cancel write a RadarInvestigation back onto the finding, keyed by Fingerprint (the durable key
// across scan reconciliation) — see reporadar.RecordInvestigation.
type RunRadarOrigin struct {
	ReportID    string `json:"reportid"`
	FindingID   string `json:"findingid"`
	Fingerprint string `json:"fingerprint"`
}

// Effort is a Wave-owned tracker for work too big for one Run: ordered chunks with statuses,
// owners, an append-only note trail, and a lightweight event log that drives ledger delta events.
// The trail is the record; Events are the delta source — never the reverse.
type Effort struct {
	OID       string        `json:"oid"`
	Version   int           `json:"version"`
	Title     string        `json:"title"`
	Project   string        `json:"project,omitempty"` // free string; "" = unscoped
	Ticket    string        `json:"ticket,omitempty"`
	Status    string        `json:"status"` // active | paused | done | archived
	ParentOID string        `json:"parentoid,omitempty"`
	Chunks    []EffortChunk `json:"chunks"` // ordered; may be empty (agents create first, plan chunks after)
	Notes     []EffortNote  `json:"notes,omitempty"`
	Events    []EffortEvent `json:"events,omitempty"` // delta-source event log (six kinds)
	CreatedTs int64         `json:"createdts"`
	UpdatedTs int64         `json:"updatedts"`
	Meta      MetaMapType   `json:"meta"`
}

func (*Effort) GetOType() string { return OType_Effort }

type EffortChunk struct {
	Label  string `json:"label"`  // unique within the effort; reference key
	Status string `json:"status"` // pending | active | done | deferred | blocked | skipped
	// Stage is a grouping label, not a container: consecutive chunks sharing one stage render under
	// a single header. Every chunk keeps its own status and its own right to block, so nothing about
	// counts, ordering or the attention queue changes when a stage is set.
	Stage     string         `json:"stage,omitempty"`
	Owner     string         `json:"owner,omitempty"`
	WorkRefs  []ChunkWorkRef `json:"workrefs,omitempty"` // runs/agent sessions currently working this chunk (populated by Task 9+)
	Notes     []EffortNote   `json:"notes,omitempty"`    // append-only trail
	UpdatedTs int64          `json:"updatedts"`
}

// ChunkWorkRef links live work to a chunk. Advisory, never causal: nothing auto-ticks on detach.
type ChunkWorkRef struct {
	Kind string `json:"kind"` // "run" | "agent"
	ORef string `json:"oref"` // "run:<oid>" | "agent:<tabid>"
	Ts   int64  `json:"ts"`
}

type EffortNote struct {
	Ts     int64  `json:"ts"`
	Text   string `json:"text"`
	Edited bool   `json:"edited,omitempty"`
	// Author is who wrote the note: "you" from the cockpit, "agent" from `wsh effort` in a terminal.
	// Empty on notes written before authorship was recorded; those render without one.
	Author string `json:"author,omitempty"`
	// Session and Run are the agent session ("agent:<tabid>") and the run ("run:<oid>") an agent note
	// came from, when they resolve. They back "open agent session ↗" and the run report on the card.
	Session string `json:"session,omitempty"`
	Run     string `json:"run,omitempty"`
}

type EffortEvent struct {
	Ts    int64  `json:"ts"`
	Kind  string `json:"kind"`            // effort-created | chunk-done | chunk-added | chunk-status | effort-status | effort-note
	Label string `json:"label,omitempty"` // chunk label for chunk-level events, "" for effort-level
	Text  string `json:"text,omitempty"`
}

// JarvisProfile is a resolved (or the global) Jarvis profile: the principles (free-text judgment;
// injected into worker/orchestrator/quick prompts and the Gatekeeper) plus the engine's launch defaults.
type JarvisProfile struct {
	Principles  PrincipleList `json:"principles,omitempty"`
	DefaultMode string        `json:"defaultmode,omitempty"` // pipeline | orchestrator (empty = pipeline)
	// Parallelism is the engine width a new run defaults to. 0 = let the lead choose, which is what
	// every profile written before this field has.
	Parallelism int `json:"parallelism,omitempty"`
	// WorkerRoute is the default route for engine children of a new run (nil = inherit the lead).
	WorkerRoute *RoutePin `json:"workerroute,omitempty"`
	// ReviewerPicks defaults a new run to Reviewer picks: the plan reviewer picks each task's model. false = the
	// WorkerRoute rule stands. Never set with WorkerRoute.
	ReviewerPicks bool `json:"reviewerpicks,omitempty"`
	// ReviewerRoute is the default route for a new run's task reviewers and stage sessions (nil = the lead's route).
	ReviewerRoute *RoutePin `json:"reviewerroute,omitempty"`
	// Landing is where an engine run's lanes land: checkout | branch (empty = branch).
	Landing string `json:"landing,omitempty"`
}

// ProfileOverride is a channel's per-project override, stored as JSON on channel meta. Pointer fields:
// nil = inherit the global section, non-nil = replace it (section-level resolution).
type ProfileOverride struct {
	Principles  *PrinciplePatch `json:"principles,omitempty"`
	Route       *RoutePin       `json:"route,omitempty"`
	DefaultMode *string         `json:"defaultmode,omitempty"`
	Parallelism *int            `json:"parallelism,omitempty"`
	WorkerRoute *RoutePin       `json:"workerroute,omitempty"`
	// ReviewerPicks is one section with WorkerRoute: when either is non-nil, both come from the override, and
	// nil here then reads as false.
	ReviewerPicks *bool     `json:"reviewerpicks,omitempty"`
	ReviewerRoute *RoutePin `json:"reviewerroute,omitempty"`
	Landing       *string   `json:"landing,omitempty"`
}

type Channel struct {
	OID         string           `json:"oid"`
	Version     int              `json:"version"`
	Name        string           `json:"name"`
	ProjectPath string           `json:"projectpath,omitempty"`
	CreatedTs   int64            `json:"createdts"`
	Messages    []ChannelMessage `json:"messages,omitempty"`
	Runs        []Run            `json:"runs,omitempty"`
	Meta        MetaMapType      `json:"meta"`
}

func (*Channel) GetOType() string {
	return OType_Channel
}

type RadarSignal struct {
	ID          string         `json:"id"`
	Collector   string         `json:"collector"` // structure|git|runs|transcript|memory|config
	SourceRef   string         `json:"sourceref"`
	ObservedTs  int64          `json:"observedts"`
	Paths       []string       `json:"paths,omitempty"`
	Subsystem   string         `json:"subsystem,omitempty"`
	Summary     string         `json:"summary"`
	Facts       map[string]any `json:"facts,omitempty"`
	Snippet     string         `json:"snippet,omitempty"`
	ContentHash string         `json:"contenthash"`
}

type RadarDisposition struct {
	Action      string `json:"action"` // dismiss|suppress
	Reason      string `json:"reason,omitempty"`
	Note        string `json:"note,omitempty"`
	Ts          int64  `json:"ts"`
	User        string `json:"user,omitempty"`
	EvidenceRev string `json:"evidencerev,omitempty"`
}

type RadarFinding struct {
	ID            string              `json:"id"`
	Fingerprint   string              `json:"fingerprint"`
	Group         string              `json:"group"`          // new|recurring|nolonger|dismissed|suppressed
	Mode          string              `json:"mode,omitempty"` // correctness|security|debt (empty reads as correctness)
	RiskKind      string              `json:"riskkind"`
	Subsystem     string              `json:"subsystem"`               // deterministic canonical subsystem
	BoundaryLabel string              `json:"boundarylabel,omitempty"` // model advisory display label
	Risk          string              `json:"risk"`
	Why           string              `json:"why"`
	Severity      string              `json:"severity"` // low|medium|high
	Strength      string              `json:"strength"` // strong|moderate|limited
	SignalIDs     []string            `json:"signalids"`
	Files         []string            `json:"files"`
	Mission       string              `json:"mission"`
	Disposition   *RadarDisposition   `json:"disposition,omitempty"`
	Investigation *RadarInvestigation `json:"investigation,omitempty"`
	MissCount     int                 `json:"misscount,omitempty"` // consecutive scans that did not detect it (0 = detected this scan)
}

// RadarInvestigation is the latest Run outcome recorded against a finding (by fingerprint). It closes the
// Radar -> Run -> outcome loop WITHOUT asserting the risk is fixed: it says "an investigation ran, here is
// what it produced." Disposition (dismiss/keep) stays a human decision. Evidence essentials are denormalized
// so the finding is self-contained across scan reconciliation and channel archive; RunID/ChannelID exist only
// for an "Open run" deep-link.
type RadarInvestigation struct {
	RunID        string `json:"runid"`
	ChannelID    string `json:"channelid"`
	Status       string `json:"status"` // executing | done | cancelled | failed | orphaned (run no longer exists)
	StartedTs    int64  `json:"startedts"`
	CompletedTs  int64  `json:"completedts,omitempty"`
	Summary      string `json:"summary,omitempty"`
	FilesTouched int    `json:"filestouched,omitempty"`
	AddTotal     int    `json:"addtotal,omitempty"`
	DelTotal     int    `json:"deltotal,omitempty"`
	VerifsPass   int    `json:"verifspass,omitempty"`
	VerifsFail   int    `json:"verifsfail,omitempty"`
}

// RadarModeRun is one mode's outcome within a scan. A scan runs each mode in V1Modes; recording per
// mode lets one lens fail to cluster (clustering-failed) while others deliver, so the report degrades
// to partial instead of appearing empty.
type RadarModeRun struct {
	Mode            string `json:"mode"`
	Status          string `json:"status"` // completed|clustering-failed|skipped
	ClusterError    string `json:"clustererror,omitempty"`
	PayloadTokens   int    `json:"payloadtokens,omitempty"`
	TotalTokens     int    `json:"totaltokens,omitempty"`
	TokensEstimated bool   `json:"tokensestimated,omitempty"`
	ResolvedModel   string `json:"resolvedmodel,omitempty"`
	FindingCount    int    `json:"findingcount,omitempty"`
	RawResponse     string `json:"rawresponse,omitempty"` // model output before validation, capped; the audit trail for rejected proposals
}

type RadarReport struct {
	OID                  string            `json:"oid"`
	Version              int               `json:"version"`
	ProjectName          string            `json:"projectname"`
	ProjectPath          string            `json:"projectpath"`
	Status               string            `json:"status"` // collecting|clustering|completed|partial|failed|cancelled
	Phase                string            `json:"phase,omitempty"`
	StartHead            string            `json:"starthead,omitempty"`
	EndHead              string            `json:"endhead,omitempty"`
	StartDirty           string            `json:"startdirty,omitempty"`
	EndDirty             string            `json:"enddirty,omitempty"`
	PrevReportId         string            `json:"prevreportid,omitempty"`
	PrevHead             string            `json:"prevhead,omitempty"`
	WindowStartTs        int64             `json:"windowstartts,omitempty"`
	WindowEndTs          int64             `json:"windowendts,omitempty"`
	StartedTs            int64             `json:"startedts"`
	CompletedTs          int64             `json:"completedts,omitempty"`
	Coverage             map[string]string `json:"coverage,omitempty"` // collector -> ok|partial|failed
	PartialSources       []string          `json:"partialsources,omitempty"`
	FatalError           string            `json:"fatalerror,omitempty"`
	ClusterError         string            `json:"clustererror,omitempty"`
	ConfiguredModel      string            `json:"configuredmodel,omitempty"`
	ResolvedModel        string            `json:"resolvedmodel,omitempty"`
	PayloadTokens        int               `json:"payloadtokens,omitempty"`
	TotalTokens          int               `json:"totaltokens,omitempty"`
	TotalTokensEstimated bool              `json:"totaltokensestimated,omitempty"`
	Candidates           []RadarSignal     `json:"candidates,omitempty"` // retained while clustering is retryable
	Signals              []RadarSignal     `json:"signals,omitempty"`    // referenced-by-findings after prune
	Findings             []RadarFinding    `json:"findings,omitempty"`
	ModeRuns             []RadarModeRun    `json:"moderuns,omitempty"`
	LensProgress         map[string]string `json:"lensprogress,omitempty"` // lens -> queued|running|ok|failed, streamed while clustering
	ClusterStartedTs     int64             `json:"clusterstartedts,omitempty"`
	Meta                 MetaMapType       `json:"meta"`
}

func (*RadarReport) GetOType() string {
	return OType_RadarReport
}

func (t *Tab) GetBlockORefs() []ORef {
	rtn := make([]ORef, 0, len(t.BlockIds))
	for _, blockId := range t.BlockIds {
		rtn = append(rtn, ORef{OType: OType_Block, OID: blockId})
	}
	return rtn
}

type FileDef struct {
	Content string         `json:"content,omitempty"`
	Meta    map[string]any `json:"meta,omitempty"`
}

type BlockDef struct {
	Files map[string]*FileDef `json:"files,omitempty"`
	Meta  MetaMapType         `json:"meta,omitempty"`
}

type StickerClickOptsType struct {
	SendInput   string    `json:"sendinput,omitempty"`
	CreateBlock *BlockDef `json:"createblock,omitempty"`
}

type StickerDisplayOptsType struct {
	Icon    string `json:"icon"`
	ImgSrc  string `json:"imgsrc"`
	SvgBlob string `json:"svgblob,omitempty"`
}

type StickerType struct {
	StickerType string                  `json:"stickertype"`
	Style       map[string]any          `json:"style"`
	ClickOpts   *StickerClickOptsType   `json:"clickopts,omitempty"`
	Display     *StickerDisplayOptsType `json:"display"`
}

type RuntimeOpts struct {
	TermSize TermSize `json:"termsize,omitempty"`
	WinSize  WinSize  `json:"winsize,omitempty"`
}

type Point struct {
	X int `json:"x"`
	Y int `json:"y"`
}

type WinSize struct {
	Width  int `json:"width"`
	Height int `json:"height"`
}

type Block struct {
	OID         string         `json:"oid"`
	ParentORef  string         `json:"parentoref,omitempty"`
	Version     int            `json:"version"`
	RuntimeOpts *RuntimeOpts   `json:"runtimeopts,omitempty"`
	Stickers    []*StickerType `json:"stickers,omitempty"`
	Meta        MetaMapType    `json:"meta"`
	SubBlockIds []string       `json:"subblockids,omitempty"`
}

func (*Block) GetOType() string {
	return OType_Block
}

type MainServer struct {
	OID           string      `json:"oid"`
	Version       int         `json:"version"`
	Meta          MetaMapType `json:"meta"`
	JwtPrivateKey string      `json:"jwtprivatekey"` // base64
	JwtPublicKey  string      `json:"jwtpublickey"`  // base64
}

func (*MainServer) GetOType() string {
	return OType_MainServer
}

func AllWaveObjTypes() []reflect.Type {
	return []reflect.Type{
		reflect.TypeOf(&Client{}),
		reflect.TypeOf(&Window{}),
		reflect.TypeOf(&Workspace{}),
		reflect.TypeOf(&Tab{}),
		reflect.TypeOf(&Channel{}),
		reflect.TypeOf(&RadarReport{}),
		reflect.TypeOf(&Block{}),
		reflect.TypeOf(&MainServer{}),
		reflect.TypeOf(&Run{}),
		reflect.TypeOf(&ChannelMessage{}),
		reflect.TypeOf(&Effort{}),
		reflect.TypeOf(&TaskGroup{}),
	}
}

type TermSize struct {
	Rows int `json:"rows"`
	Cols int `json:"cols"`
}
