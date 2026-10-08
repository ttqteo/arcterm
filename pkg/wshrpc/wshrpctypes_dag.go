// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshrpc

import (
	"context"

	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

// DagCommands is the deterministic orchestration engine surface (pkg/orchestrate).
type DagCommands interface {
	DagSubmitCommand(ctx context.Context, data CommandDagSubmitData) (*waveobj.TaskGroup, error)                      // validate + persist a TaskGroup for an orchestrator run
	DagPlanPreviewCommand(ctx context.Context, data CommandDagPlanPreviewData) (*CommandDagPlanPreviewRtnData, error) // parse a plan file for + Run before any run exists
	DagStatusCommand(ctx context.Context, data CommandDagStatusData) (*CommandDagStatusRtnData, error)                // engine-owned status snapshot: group + typed digest
	DagActionCommand(ctx context.Context, data CommandDagActionData) error                                            // approve | sendback | retry | skip | escalate | cancel | forward | relaunch-lead
	DagMergeCommand(ctx context.Context, data CommandDagMergeData) error                                              // squash-merge a finished child's worktree back
	DagMergeContinueCommand(ctx context.Context, data CommandDagMergeData) error                                      // finish a resolved squash merge, or re-run a failed Verify
	DagAsksCommand(ctx context.Context, data CommandDagStatusData) (*CommandDagAsksRtnData, error)                    // pending child asks (children block on one at a time)
	DagAnswerCommand(ctx context.Context, data CommandDagAnswerData) error                                            // deliver an answer to a child's pending ask
	GetWorkerCapacityCommand(ctx context.Context) (*CommandGetWorkerCapacityRtnData, error)                           // free RAM and how many more workers it holds (pkg/workercap)
}

// A submission is a plan file or a typed task list. Every shipped caller sends a plan file — `wsh jarvis
// dag submit --plan` and + Run are the only two, and slice 5c removed the rest. A plan can pin a task's
// model (`**Model:**`); the typed form stays because it is the only one that can pin a task's runtime,
// and the engine validates and dispatches on that pin. Deleting it would delete that capability, not
// dead code.
type CommandDagSubmitData struct {
	ChannelId   string             `json:"channelid"`
	RunId       string             `json:"runid"`
	Title       string             `json:"title,omitempty"`
	Parallelism int                `json:"parallelism"`
	Tasks       []waveobj.TaskNode `json:"tasks"`                 // per-task RunSpec routing; a plan file can pin only the model
	WorkerRoute *waveobj.RoutePin  `json:"workerroute,omitempty"` // nil = inherit lead; B1b workers default
	PlanPath    string             `json:"planpath,omitempty"`    // absolute path to a plan in jarvis.PlanFormat; replaces tasks
	SpecPath    string             `json:"specpath,omitempty"`    // absolute path to the spec the plan implements; only with planpath
	Round       bool               `json:"round,omitempty"`       // append the plan's tasks to the run's dag as a fix round after its final stage failed
}

type CommandDagPlanPreviewData struct {
	PlanPath    string `json:"planpath"`              // path to a plan in jarvis.PlanFormat; absolute, or relative to projectpath
	ProjectPath string `json:"projectpath,omitempty"` // the project the run will start in
}

// CommandDagPlanPreviewRtnData is what + Run shows before it starts a plan: its name, its two plan-level
// commands, its shape, and its tasks.
type CommandDagPlanPreviewRtnData struct {
	Title  string               `json:"title,omitempty"`
	Verify string               `json:"verify,omitempty"`
	Setup  string               `json:"setup,omitempty"`
	Check  string               `json:"check,omitempty"`
	Shape  DagPlanShape         `json:"shape"`
	Tasks  []DagPlanPreviewTask `json:"tasks,omitempty"`
}

// DagPlanPreviewTask is one task of a previewed plan. Lane is 1-based, in jarvis.Lanes order; Model is the
// task's Model line, empty when it has none.
type DagPlanPreviewTask struct {
	Id    string   `json:"id"`
	Title string   `json:"title"`
	Lane  int      `json:"lane"`
	Deps  []string `json:"deps,omitempty"`
	Model string   `json:"model,omitempty"`
}

// DagPlanShape is how a plan decomposes: how many tasks, how many lanes they run in, and the longest chain
// of tasks that wait on one another.
type DagPlanShape struct {
	Tasks        int `json:"tasks"`
	Lanes        int `json:"lanes"`
	LongestChain int `json:"longestchain"`
}

type CommandDagStatusData struct {
	ChannelId string `json:"channelid"`
	RunId     string `json:"runid"`
}

type CommandDagActionData struct {
	ChannelId  string `json:"channelid"`
	RunId      string `json:"runid"`
	TaskId     string `json:"taskid"`
	Action     string `json:"action"`               // approve | sendback | retry | skip | stop | escalate | cancel | forward | takeover | relaunch-lead | review-pass | review-fail | planreview-pass | planreview-fail | planreview-accept | final-pass | final-fail | amend | tell | final-end-unverified | final-end-failed | setmodel | leadmodels
	Model      string `json:"model,omitempty"`      // escalate, setmodel target model (exact id); required
	Runtime    string `json:"runtime,omitempty"`    // escalate, setmodel target runtime; empty = task's current runtime
	Notes      string `json:"notes,omitempty"`      // forward: what the lead checked; review, planreview: summary or findings; final: summary or defects; final-end-*: the human's reason; planreview-accept: the human's reason; amend: the note; tell: the text; sendback: guidance
	Downstream string `json:"downstream,omitempty"` // review-pass: what later tasks must know
	Unverified string `json:"unverified,omitempty"` // review-pass, final-pass: what was not verified, and why
	// DownstreamFor names the tasks a review-pass's Downstream is for; the engine delivers it to them
	DownstreamFor []string `json:"downstreamfor,omitempty"`
	// Picks are a planreview-pass's model picks, one per task without a Model line, sent only on Reviewer picks
	Picks []DagModelPick `json:"picks,omitempty"`
}

// DagModelPick is the plan reviewer's model for one task: Model is sonnet or lead, Reason one line on why.
type DagModelPick struct {
	TaskId string `json:"taskid"`
	Model  string `json:"model"`
	Reason string `json:"reason"`
}

type CommandDagMergeData struct {
	ChannelId string `json:"channelid"`
	RunId     string `json:"runid"`  // the dag's owning (lead) run
	TaskId    string `json:"taskid"` // selects the child whose worktree merges
}

// DagAskItem is one entry in a dag's question queue: the task that raised it, the registry's ask id (so
// the digest and lifecycle events can correlate one ask across raise/answer/clear), who holds it and
// why, every question with its options, the child block the answer is delivered to, and when it was
// raised.
type DagAskItem struct {
	TaskId    string                    `json:"taskid"`
	AskId     string                    `json:"askid,omitempty"`
	Owner     string                    `json:"owner,omitempty"`    // lead | user; empty when the raise could not resolve the dag
	Deadline  int64                     `json:"deadline,omitempty"` // UnixMilli past which a lead-held ask moves to the human
	Note      string                    `json:"note,omitempty"`     // why the holder has it: a forward note, a missed deadline, a failed delivery
	Questions []baseds.AgentAskQuestion `json:"questions"`
	BlockORef string                    `json:"blockoref"`
	Ts        int64                     `json:"ts"`
}

type CommandDagAsksRtnData struct {
	Asks []DagAskItem `json:"asks"`
}

type CommandDagAnswerData struct {
	ChannelId string                   `json:"channelid"`
	RunId     string                   `json:"runid"`
	TaskId    string                   `json:"taskid"`
	Answers   []baseds.AgentAnswerItem `json:"answers"`
	// Lead is set by `wsh jarvis dag answer`, the lead's way to answer. A question the human holds refuses
	// it, so a lead mid-answer cannot race the human who took the question over or was forwarded it.
	Lead bool `json:"lead,omitempty"`
}

// DagStatus contract — the complete typed status digest promoted from the raw group (spec §5.1).
// The frontend must never re-derive scheduler policy from task state; it renders this digest as-is.

type CommandDagStatusRtnData struct {
	Group  *waveobj.TaskGroup `json:"group"`
	Digest DagStatusDigest    `json:"digest"`
}

type DagStatusDigest struct {
	DagVersion int               `json:"dagversion"`
	Health     string            `json:"health"` // needs-you | stalled | healthy | done | cancelled
	Counts     DagStatusCounts   `json:"counts"`
	Next       DagNextStep       `json:"next"`
	Tasks      []DagTaskDigest   `json:"tasks"`
	Durations  DagDurationDigest `json:"durations"`
	Report     DagReportDigest   `json:"report"`
	// omitempty makes the generated TS field optional, so the typed digest fixtures in the frontend tests
	// keep compiling; Go still sends it
	Shape DagPlanShape `json:"shape,omitempty"`
	// Final is the dag's final stage once every task landed: its state, and what it found, whole
	Final *waveobj.FinalStage `json:"final,omitempty"`
	// Lanes are the plan's lanes in plan order, each its task ids in run order: the same derivation the
	// engine dispatches and merges by.
	Lanes [][]string `json:"lanes,omitempty"`
	// Told is what the human typed into the workers' own terminals, oldest first
	Told []DagTold `json:"told,omitempty"`
	// Timing is where the run's wall clock went; pointer + omitempty keeps the typed digest fixtures in
	// the frontend tests compiling, like Shape
	Timing *DagTimingDigest `json:"timing,omitempty"`
}

// DagTimingDigest is where the run's wall clock went: activities on a since-launch axis.
type DagTimingDigest struct {
	StartTs    int64               `json:"startts"`              // the owner run's launch
	EndTs      int64               `json:"endts,omitempty"`      // the run's end; 0 while it is live
	Activities []DagTimingActivity `json:"activities,omitempty"` // started activities, in display order
	Partial    bool                `json:"partial,omitempty"`    // a needed boundary was pruned by retention
}

// DagTimingActivity is one activity's span; an end of 0 means it is still open.
type DagTimingActivity struct {
	Key     string `json:"key"` // planning | execution | review | merge | final | landing
	StartTs int64  `json:"startts"`
	EndTs   int64  `json:"endts,omitempty"` // 0 while open
}

// DagTold is one message the human typed into a task's worker, read from its task-told row.
type DagTold struct {
	TaskId string `json:"taskid"`
	Ts     int64  `json:"ts"`
	Text   string `json:"text"`
}

// DagReportDigest is what the lead writes its run-end report from, and what the run card shows.
type DagReportDigest struct {
	WorkerMs   int64             `json:"workerms"`             // the tasks' run time, summed
	Commits    []DagLandedCommit `json:"commits,omitempty"`    // merged tasks' squash commits, in dag order
	Unverified bool              `json:"unverified,omitempty"` // no merge point ran a Verify: no Verify line, or nothing to merge into
	// UnverifiedNotes are the reviewers' caveats on passed tasks, in dag order
	UnverifiedNotes []DagUnverifiedNote `json:"unverifiednotes,omitempty"`
	Answered        int                 `json:"answered"`  // child questions answered, by the lead or the human
	Forwarded       int                 `json:"forwarded"` // judgments handed to the human

	// Usage is the run's tokens per session and model, set once the dag is done. In its own block so its
	// wider type does not realign the fields above it.
	Usage []waveobj.UsageRow `json:"usage,omitempty"`
}

type DagLandedCommit struct {
	TaskId string `json:"taskid"`
	Commit string `json:"commit"`
}

type DagUnverifiedNote struct {
	TaskId string `json:"taskid"`
	Text   string `json:"text"`
}

type DagStatusCounts struct {
	Total             int `json:"total"`
	Done              int `json:"done"`
	Running           int `json:"running"`
	Stalled           int `json:"stalled"`
	DependencyWaiting int `json:"dependencywaiting"`
	Attention         int `json:"attention"`
	RecoveredRetry    int `json:"recoveredretry"`
	MergeReady        int `json:"mergeready"`
}

type DagNextStep struct {
	Kind            string   `json:"kind"` // human-action | lead-action | merge-ready | dispatch | parallelism-wait | verify-wait | dependency-wait | final-wait | cleanup-wait | terminal
	TaskIds         []string `json:"taskids,omitempty"`
	BlockingTaskIds []string `json:"blockingtaskids,omitempty"`
	Actions         []string `json:"actions,omitempty"` // answer | approve | sendback | merge | resolve-merge | retry | skip | escalate | retry-cleanup | fix-round
	TerminalStatus  string   `json:"terminalstatus,omitempty"`
}

type DagTaskDigest struct {
	TaskId           string   `json:"taskid"`
	WaitReason       string   `json:"waitreason"` // none | dependency | parallelism | gate | ask | lead-ask | failure | merge | verify | review | cleanup | terminal
	BlockingTaskIds  []string `json:"blockingtaskids,omitempty"`
	HumanActions     []string `json:"humanactions,omitempty"` // answer | approve | sendback | merge | resolve-merge | retry | skip | escalate | retry-cleanup
	AskId            string   `json:"askid,omitempty"`
	AskSummary       string   `json:"asksummary,omitempty"`
	AskTs            int64    `json:"askts,omitempty"`
	AskDeadline      int64    `json:"askdeadline,omitempty"` // UnixMilli past which a lead-held ask moves to the human
	FreshnessTs      int64    `json:"freshnessts,omitempty"`
	Busy             bool     `json:"busy,omitempty"`            // the worker's tree was using CPU within BusyWindow
	LatestTool       string   `json:"latesttool,omitempty"`      // the worker's in-progress tool call
	Suspect          string   `json:"suspect,omitempty"`         // why the running worker may be stuck, while it is flagged
	VerifyStartedTs  int64    `json:"verifystartedts,omitempty"` // UnixMilli a RUNNING merge-point Verify started; 0 in every other state
	VerifyLastLine   string   `json:"verifylastline,omitempty"`  // the last line that running Verify has printed
	MergeGateTs      int64    `json:"mergegatets,omitempty"`     // UnixMilli an open merge gate's clock started (the lane tip's task-done); 0 with no gate or no clock
	RecoveredRetry   bool     `json:"recoveredretry,omitempty"`
	MergeState       string   `json:"mergestate"`                 // not-required | waiting | ready | blocked | merged
	CleanupState     string   `json:"cleanupstate"`               // not-required | clear | pending | failed
	ReportSections   []string `json:"reportsections,omitempty"`   // the worker's report sections with content, Done aside; ["unstructured"] for a legacy report
	ReviewVerdict    string   `json:"reviewverdict,omitempty"`    // pass | fail: the latest review
	ReviewRound      int      `json:"reviewround,omitempty"`      // failed reviews so far
	ReviewNote       string   `json:"reviewnote,omitempty"`       // the reviewer's summary or findings, or why the review failed
	ReviewDownstream string   `json:"reviewdownstream,omitempty"` // what later tasks must know, from a pass
	ReviewUnverified string   `json:"reviewunverified,omitempty"` // what a pass's reviewer could not verify, whole
}

type DagDurationDigest struct {
	ElapsedMs int64             `json:"elapsedms"`
	Partial   bool              `json:"partial,omitempty"`
	Tasks     []DagTaskDuration `json:"tasks,omitempty"`
}

type DagTaskDuration struct {
	TaskId      string `json:"taskid"`
	RunMs       int64  `json:"runms,omitempty"`
	MergeWaitMs int64  `json:"mergewaitms,omitempty"`
	CleanupMs   int64  `json:"cleanupms,omitempty"`
	Partial     bool   `json:"partial,omitempty"`
}

// CommandGetWorkerCapacityRtnData is the app bar chip's and the worker steppers' reading (pkg/workercap).
type CommandGetWorkerCapacityRtnData struct {
	TotalBytes     uint64 `json:"totalbytes"`
	AvailableBytes uint64 `json:"availablebytes"` // gopsutil Available: darwin free+inactive, Windows ullAvailPhys
	PerWorkerBytes uint64 `json:"perworkerbytes"` // a typical worker: the mean of the workers' means
	HeavyBytes     uint64 `json:"heavybytes"`     // the heaviest job: the highest peak (a tsc run)
	Measured       bool   `json:"measured"`       // false: PerWorkerBytes and HeavyBytes are the defaults, no worker sampled yet
	LiveWorkers    int    `json:"liveworkers"`
	ReserveBytes   uint64 `json:"reservebytes"` // room the live workers may still grow into, plus one heavy job's extra
	MoreWorkers    int    `json:"moreworkers"`
}
