// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshrpc

import (
	"context"

	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

type RunCommands interface {
	CreateRunCommand(ctx context.Context, data CommandCreateRunData) (*CommandCreateRunRtnData, error)                // create + start a goal Run (spawns phase 1's worker)
	AdvanceRunCommand(ctx context.Context, data CommandAdvanceRunData) error                                          // complete a phase / approve or send back a gate (spawns the next worker)
	CancelRunCommand(ctx context.Context, data CommandCancelRunData) error                                            // cancel a Run
	StopRunWorkerCommand(ctx context.Context, data CommandStopRunWorkerData) error                                    // stop one surviving worker of a cancelled run
	SealRunEvidenceCommand(ctx context.Context, data CommandSealRunEvidenceData) error                                // derive+seal a done run's evidence if absent (idempotent backfill)
	LandRunCommand(ctx context.Context, data CommandLandRunData) (*waveobj.RunLand, error)                            // merge a done branch-landed run's wave/<runId> back into its base, or hold it with the reason
	AckRunCommand(ctx context.Context, data CommandAckRunData) error                                                  // acknowledge a done run's unverified outcome, which clears its attention item
	RunAsksCommand(ctx context.Context, data CommandRunAskData) (*CommandDagAsksRtnData, error)                       // the pending question on a run's own session (a lead's, or a quick run's)
	RunAnswerCommand(ctx context.Context, data CommandRunAnswerData) error                                            // answer a run's own pending question
	ReportRunPhaseCommand(ctx context.Context, data CommandReportRunPhaseData) error                                  // lead self-reports hold/complete; resolves run/phase from its own oref
	CreateChildRunCommand(ctx context.Context, data CommandCreateChildRunData) (*CommandCreateChildRunRtnData, error) // orchestrator lead spawns a hands-off child run for one backlog unit; parent resolved from the caller's oref
	SetRunSettingsCommand(ctx context.Context, data CommandSetRunSettingsData) error                                  // change a live engine run's scheduler settings (pending on the Run before a DAG exists, live on its TaskGroup after)
	RunTranscriptPathCommand(ctx context.Context, data CommandRunTranscriptPathData) (string, error)                  // the transcript of a run launched under a session id, "" when none was written
	RunUsageCommand(ctx context.Context, data CommandRunUsageData) (*CommandRunUsageRtnData, error)                   // a run's tokens per role, task and model: sealed when the run has evidence, else read from its transcripts now
}

type CommandCreateRunData struct {
	ChannelId     string                  `json:"channelid"`
	WorkspaceId   string                  `json:"workspaceid"` // where phase-worker tabs are created
	Goal          string                  `json:"goal"`
	Runtime       string                  `json:"runtime"`                 // the harness that runs every phase and child run; immutable after Start
	Model         string                  `json:"model,omitempty"`         // exact model id; empty = runtime default
	WorkerRoute   *waveobj.RoutePin       `json:"workerroute,omitempty"`   // B1b default worker route (nil = inherit lead)
	ReviewerPicks *bool                   `json:"reviewerpicks,omitempty"` // Reviewer picks; nil = the profile's workers setting, non-nil = the caller owns it and a nil WorkerRoute means Same as lead
	ReviewerRoute *waveobj.RoutePin       `json:"reviewerroute,omitempty"` // route for task reviewers and stage sessions (nil = the profile's, else the lead's)
	Orchestration string                  `json:"orchestration,omitempty"` // engine | adaptive (empty = legacy runtime fork)
	Parallelism   int                     `json:"parallelism,omitempty"`   // engine width the user picked in the Run rail; 0 = let the lead choose
	PlaybookId    string                  `json:"playbookid,omitempty"`
	Mode          string                  `json:"mode,omitempty"`        // quick | pipeline | orchestrator (empty = resolved profile default)
	Landing       string                  `json:"landing,omitempty"`     // branch | checkout for an engine run; wins over the profile (empty = the profile's, else branch)
	RadarOrigin   *waveobj.RunRadarOrigin `json:"radarorigin,omitempty"` // set when started from a Radar finding
	EffortOID     string                  `json:"effortoid,omitempty"`   // optional effort tracker link (composer picker)
	ChunkLabel    string                  `json:"chunklabel,omitempty"`
	// DeferStart persists the run in planning without spawning phase workers; the caller (the
	// draft-first composer) submits the TaskGroup explicitly and DagSubmit transitions it to executing.
	DeferStart bool `json:"deferstart,omitempty"`
	// PlanPath starts an orchestrator run from a plan in jarvis.PlanFormat, absolute or relative to the
	// channel's project: the engine submits it at start and no lead runs until something needs judgment.
	// Goal defaults to the plan's name.
	PlanPath string `json:"planpath,omitempty"`
	// Prototype is the design canvas the run's final verifier compares against. It wins over the plan's
	// **Prototype:** line; an orchestrator run only.
	Prototype string `json:"prototype,omitempty"`
	// OriginTabId is the tab of the session that ran `wsh runs start`; empty from the cockpit.
	OriginTabId string `json:"origintabid,omitempty"`
}

type CommandCreateRunRtnData struct {
	Run *waveobj.Run `json:"run"`
}

type CommandAdvanceRunData struct {
	ChannelId string   `json:"channelid"`
	RunId     string   `json:"runid"`
	PhaseIdx  int      `json:"phaseidx"`            // the phase being completed (ignored for approve/sendback)
	Action    string   `json:"action"`              // complete | approve | sendback | hold | triage
	Artifacts []string `json:"artifacts,omitempty"` // artifacts to record on complete
	Verdict   string   `json:"verdict,omitempty"`   // triage: quick | plan
	Note      string   `json:"note,omitempty"`      // triage: one-line reason
	Commit    string   `json:"commit,omitempty"`    // reported result commit; stored on Run.EndCommit for the complete action
	Report    string   `json:"report,omitempty"`    // lead's final report; stored on Run.Report for the complete action
	HoldLand  bool     `json:"holdland,omitempty"`  // complete: finish even though the land would conflict, leaving it held
	ForceLand bool     `json:"forceland,omitempty"` // complete: land even though the final stage failed; the human's call, carried by the lead
}

type CommandCancelRunData struct {
	ChannelId string `json:"channelid"`
	RunId     string `json:"runid"`
}

type CommandStopRunWorkerData struct {
	ChannelId  string `json:"channelid"`
	RunId      string `json:"runid"`
	WorkerORef string `json:"workeroref"` // the worker tab oref ("tab:<id>") to stop
}

type CommandRunTranscriptPathData struct {
	ChannelId string `json:"channelid"`
	RunId     string `json:"runid"`
}

type CommandRunUsageData struct {
	ChannelId string `json:"channelid"`
	RunId     string `json:"runid"`
}

type CommandRunUsageRtnData struct {
	Usage  []waveobj.UsageRow `json:"usage,omitempty"`
	Sealed bool               `json:"sealed,omitempty"` // the total is the sealed one and will not change
}

type CommandSealRunEvidenceData struct {
	ChannelId string `json:"channelid"`
	RunId     string `json:"runid"`
}

type CommandLandRunData struct {
	ChannelId string `json:"channelid"`
	RunId     string `json:"runid"`
	Force     bool   `json:"force,omitempty"` // land even though the final stage failed; the human's call only
}

type CommandAckRunData struct {
	ChannelId string `json:"channelid"`
	RunId     string `json:"runid"`
	Land      bool   `json:"land,omitempty"` // dismiss the run's held land instead of its unverified outcome
}

type CommandRunAskData struct {
	ChannelId string `json:"channelid"`
	RunId     string `json:"runid"`
}

type CommandRunAnswerData struct {
	ChannelId string                   `json:"channelid"`
	RunId     string                   `json:"runid"`
	Answers   []baseds.AgentAnswerItem `json:"answers"`
}

type CommandReportRunPhaseData struct {
	ORef      string   `json:"oref"`                // caller's tab oref ("tab:<id>")
	Action    string   `json:"action"`              // hold | complete | triage
	Artifacts []string `json:"artifacts,omitempty"` // recorded on complete
	Verdict   string   `json:"verdict,omitempty"`   // triage: quick | plan
	Note      string   `json:"note,omitempty"`      // triage: one-line reason
	Commit    string   `json:"commit,omitempty"`    // reported result commit; forwarded to AdvanceRun, stored on Run.EndCommit
	Report    string   `json:"report,omitempty"`    // lead's final report; forwarded to AdvanceRun, stored on Run.Report
	HoldLand  bool     `json:"holdland,omitempty"`  // forwarded to AdvanceRun
	ForceLand bool     `json:"forceland,omitempty"` // forwarded to AdvanceRun
}

type CommandCreateChildRunData struct {
	ORef string `json:"oref"`           // caller = the orchestrator lead's tab oref ("tab:<id>")
	Goal string `json:"goal"`           // the unit of work for the child run
	Mode string `json:"mode,omitempty"` // quick|pipeline|orchestrator; empty = inherit the parent run's mode
}

type CommandCreateChildRunRtnData struct {
	RunId string `json:"runid"`
}

// CommandSetRunSettingsData is the session sheet's prospective engine configuration. Parallelism is a
// pointer because omission is how a caller says "leave the width alone": a supplied value is always a real
// width and must be inside 1..orchestrate.MaxParallelism. The
// launched shape, machine and lead route are absent on purpose: they are immutable after launch, so there
// is nothing to send.
type CommandSetRunSettingsData struct {
	ChannelId   string            `json:"channelid"`
	RunId       string            `json:"runid"`
	Parallelism *int              `json:"parallelism,omitempty"`
	WorkerRoute *waveobj.RoutePin `json:"workerroute,omitempty"`
	// ReviewerPicks and ReviewerRoute are always applied, like WorkerRoute: false = the WorkerRoute rule stands,
	// nil ReviewerRoute = the lead's route.
	ReviewerPicks bool              `json:"reviewerpicks,omitempty"`
	ReviewerRoute *waveobj.RoutePin `json:"reviewerroute,omitempty"`
}
