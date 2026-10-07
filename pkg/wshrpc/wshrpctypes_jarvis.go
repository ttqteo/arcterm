// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshrpc

import (
	"context"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

type JarvisCommands interface {
	ConsultCommand(ctx context.Context, data CommandConsultData) chan RespOrErrorUnion[ConsultChunk]                                       // one-shot headless CLI consult; streams reply chunks, posts a consult-reply on completion
	ListDossiersCommand(ctx context.Context) (*CommandListDossiersRtnData, error)                                                          // list focusable task dossiers (active|paused), newest-updated first
	ResolveFocusScopeCommand(ctx context.Context, data CommandResolveFocusScopeData) (*SpaceScope, error)                                  // resolve a record's scope bundle (runs -> channels + worker tabs)
	VaultGraphCommand(ctx context.Context) (*CommandVaultGraphRtnData, error)                                                              // whole-vault wikilink graph (U3 base canvas): all vault nodes + resolved [[links]], no runs/attribution
	ReadVaultNoteCommand(ctx context.Context, data CommandReadVaultNoteData) (*CommandReadVaultNoteRtnData, error)                         // read one vault note's title and body for the avatar popup's note peek; errors on an unknown id
	ResolveDossierEdgesCommand(ctx context.Context, data CommandResolveDossierEdgesData) (*CommandResolveDossierEdgesRtnData, error)       // a dossier's attributed run nodes + typed attribution edges (U3 focus bloom)
	ResolveAmbientCommand(ctx context.Context) (*CommandResolveAmbientRtnData, error)                                                      // whole-vault ambient attribution: every dossier, its attributed run orefs, and its decisions
	GetDossierCommand(ctx context.Context, data CommandGetDossierData) (*DossierDetail, error)                                             // read one task dossier + its decisions for the Tasks surface
	ListTaskDossiersCommand(ctx context.Context) (*CommandListTaskDossiersRtnData, error)                                                  // list ALL task dossiers (any status) for the Tasks surface, newest-updated first
	AppendDossierDecisionCommand(ctx context.Context, data CommandAppendDossierDecisionData) (*CommandAppendDossierDecisionRtnData, error) // human-append a decision to a dossier (user-attributed) + commit
	SetDossierStatusCommand(ctx context.Context, data CommandSetDossierStatusData) error                                                   // set a dossier's status (active|paused|completed|archived) + commit
	DetachDossierEdgeCommand(ctx context.Context, data CommandDossierEdgeData) error                                                       // human-reject a dossier<->run attribution; suppressed durably via the override log
	AcceptDossierEdgeCommand(ctx context.Context, data CommandDossierEdgeData) error                                                       // human-confirm a dossier<->run attribution and harden it into canonical refs; also restores a detached edge and attaches an unattributed run
	ListDetachedEdgesCommand(ctx context.Context, data CommandListDetachedEdgesData) (*CommandListDetachedEdgesRtnData, error)             // the human-suppressed edges for one dossier or one run, so a detach can be undone
	GetJarvisProfileCommand(ctx context.Context, data CommandGetJarvisProfileData) (*CommandGetJarvisProfileRtnData, error)                // read a channel's Jarvis profile (global + per-project override + resolved)
	GetGlobalProfileCommand(ctx context.Context) (*waveobj.JarvisProfile, error)                                                           // read the global Jarvis profile (builtins if unset)
	SetGlobalProfileCommand(ctx context.Context, data CommandSetGlobalProfileData) error                                                   // write the global Jarvis profile to the vault's config/jarvis-profile.json
	ListHarnessesCommand(ctx context.Context) (*CommandListHarnessesRtnData, error)                                                        // installed coding-agent harnesses (catalog); excludes API-only backends like OpenRouter
	UpdateHarnessCommand(ctx context.Context, data CommandUpdateHarnessData) (*CommandUpdateHarnessRtnData, error)                         // runs the harness's own updater (Settings → About)
	// RefreshRouteCatalogCommand clears the cached run-route model catalog; the next
	// ListHarnessesCommand re-enumerates from the installed harnesses.
	RefreshRouteCatalogCommand(ctx context.Context) error
	JarvisStateCommand(ctx context.Context, data CommandJarvisStateData) (*CommandJarvisStateRtnData, error)             // work-ledger query: per-project active/shipped/timeline/delta + source health
	JarvisStatusCommand(ctx context.Context, data CommandJarvisStatusData) (*CommandJarvisStatusRtnData, error)          // capture accounting: note counts, distill queue
	JarvisCtxCommand(ctx context.Context, data CommandJarvisCtxData) (*CommandJarvisCtxRtnData, error)                   // resolve the run context (channel/run/dag) owning the caller's block
	JarvisRunEventsCommand(ctx context.Context, data CommandJarvisRunEventsData) (*CommandJarvisRunEventsRtnData, error) // run visibility timeline: list a run's lifecycle events, newest-first
	GetLatestResumeCommand(ctx context.Context) (*CommandGetLatestResumeRtnData, error)                                  // the newest rest-transition narrative across all runs — "where we were" at launch
}

// ResumeCardData mirrors jarviscontinuity.ResumeCard field for field, json tags included, so the generated
// TS type is structurally identical to the frontend's existing ResumeVM (view/agents/resume.ts) and
// consuming this command is an adapter rather than a translation.
type ResumeCardData struct {
	TaskId  string `json:"taskId"`
	Summary string `json:"summary"`
	Status  string `json:"status"`
	Updated int64  `json:"updated"`
}

// CommandGetLatestResumeRtnData is the newest rest-transition narrative across every run. No per-run read
// can answer it: the narrative is written into run.Meta, and there is no global runs list on the frontend,
// so "where we were" was unreachable at launch. Card is nil when no run carries an undismissed narrative.
type CommandGetLatestResumeRtnData struct {
	Card       *ResumeCardData `json:"card,omitempty"`
	RunORef    string          `json:"runoref,omitempty"`
	ChannelOid string          `json:"channeloid,omitempty"`
	RunStatus  string          `json:"runstatus,omitempty"` // the run's rest status: awaiting-review | blocked | done
	RunGoal    string          `json:"rungoal,omitempty"`
}

type CommandGetJarvisProfileData struct {
	ChannelId string `json:"channelid"`
}

type CommandGetJarvisProfileRtnData struct {
	Global               waveobj.JarvisProfile         `json:"global"`
	Override             *waveobj.ProfileOverride      `json:"override"`
	Resolved             waveobj.JarvisProfile         `json:"resolved"`
	PrincipleDiagnostics []waveobj.PrincipleDiagnostic `json:"principlediagnostics,omitempty"`
}

type CommandSetGlobalProfileData struct {
	Profile waveobj.JarvisProfile `json:"profile"`
}

type CommandConsultData struct {
	ChannelId string `json:"channelid"`
	Runtime   string `json:"runtime"`
	Prompt    string `json:"prompt"`
	ConsultId string `json:"consultid"`
}

type ConsultChunk struct {
	Text string `json:"text"`
}

type RouteCapabilityInfo struct {
	Runtime       string `json:"runtime"`
	Model         string `json:"model,omitempty"` // exact model id; "" for the runtime default
	ResolvedModel string `json:"resolvedmodel"`
	Provider      string `json:"provider,omitempty"`
	ContextHint   string `json:"contexthint,omitempty"`
	Default       bool   `json:"default,omitempty"`
}

// HarnessInfo is one installed coding-agent harness in the shared catalog. OpenRouter is deliberately
// absent: it is an API-backed utility runtime, not an installable harness an operator chooses for Runs.
type HarnessInfo struct {
	Runtime           string                `json:"runtime"`
	Label             string                `json:"label"`
	Installed         bool                  `json:"installed"`
	Version           string                `json:"version,omitempty"`
	LatestVersion     string                `json:"latestversion,omitempty"` // newest release the update check saw; "" before one, or for a harness it does not check
	ConsultCapable    bool                  `json:"consultcapable"`
	RunWorkerCapable  bool                  `json:"runworkercapable"`
	RouteCapabilities []RouteCapabilityInfo `json:"routecapabilities,omitempty"`
}

type CommandListHarnessesRtnData struct {
	Harnesses []HarnessInfo `json:"harnesses"`
}

type CommandUpdateHarnessData struct {
	Runtime string `json:"runtime"`
}

type CommandUpdateHarnessRtnData struct {
	Version string `json:"version"`
}

// SpaceSummary is one focusable task (Presence C). Objective is the human label; Ticket a secondary tag.
type SpaceSummary struct {
	Id        string `json:"id"`
	Objective string `json:"objective"`
	Ticket    string `json:"ticket"`
	Status    string `json:"status"` // active | paused (the only focusable statuses)
	Updated   int64  `json:"updated"`
}

type CommandListDossiersRtnData struct {
	Spaces []SpaceSummary `json:"spaces"`
}

// CommandResolveFocusScopeData names the record whose scope bundle to resolve. Kind is always task.
type CommandResolveFocusScopeData struct {
	Kind string `json:"kind"`
	Id   string `json:"id"`
}

// SpaceScope is a task's derived scope bundle: its attributed run orefs, their channel oids, and the
// worker tab ids (tab: prefix stripped, so they match the roster's tabId key). Rebuildable, never stored.
type SpaceScope struct {
	RunORefs    []string `json:"runorefs"`
	ChannelOids []string `json:"channeloids"`
	TabIds      []string `json:"tabids"`
}

// GraphNode is one node in the vault graph surface (U3). Kind: task|decision|memory|run.
// Status is frontmatter-derived (absent for memory notes; runs carry their run status).
type GraphNode struct {
	Id      string `json:"id"`
	Kind    string `json:"kind"`
	Label   string `json:"label"`
	Status  string `json:"status,omitempty"`
	Updated int64  `json:"updated,omitempty"`
}

// GraphLink is one edge. Kind: wikilink|attribution. Provenance/Bucket/State are set only on
// attribution edges (dossier->run, from D's EdgesFor); wikilinks leave them empty.
type GraphLink struct {
	From       string `json:"from"`
	To         string `json:"to"`
	Kind       string `json:"kind"`
	Provenance string `json:"provenance,omitempty"`
	Bucket     string `json:"bucket,omitempty"`
	State      string `json:"state,omitempty"`
}

type CommandVaultGraphRtnData struct {
	Nodes []GraphNode `json:"nodes"`
	Links []GraphLink `json:"links"`
}

type CommandReadVaultNoteData struct {
	Id string `json:"id"`
}

// CommandReadVaultNoteRtnData is one note as the note peek shows it. Title is the frontmatter title, else
// the id; Project is the note's project scope, absent for a shared note.
type CommandReadVaultNoteRtnData struct {
	Id      string `json:"id"`
	Title   string `json:"title"`
	Body    string `json:"body"`
	Updated int64  `json:"updated"`
	Project string `json:"project,omitempty"`
}

type CommandResolveDossierEdgesData struct {
	DossierId string `json:"dossierid"`
}

type CommandResolveDossierEdgesRtnData struct {
	Runs  []GraphNode `json:"runs"`
	Links []GraphLink `json:"links"`
}

// AmbientTask is a dossier reduced to what an ambient tag renders: its id and display label. The whole
// set ships (not just attributed ones) so a memory note's [[wikilink]] can resolve to a tag too.
type AmbientTask struct {
	Id    string `json:"id"`
	Label string `json:"label"`
}

// AmbientEdge is one attributed object -> dossier link. ORef is the object the tag renders on (a run
// oref today). Provenance/Bucket/State mirror the U3 attribution encoding so the ambient layer can give
// a provisional edge a distinct treatment — a low-confidence edge must never read as canonical.
type AmbientEdge struct {
	ORef       string `json:"oref"`
	DossierId  string `json:"dossierid"`
	Provenance string `json:"provenance"`
	Bucket     string `json:"bucket"` // weak | medium | strong
	State      string `json:"state"`  // informing | confirmed
}

// CommandDossierEdgeData names one dossier<->run attribution. Both ids are required: an edge is the pair.
type CommandDossierEdgeData struct {
	DossierId string `json:"dossierid"`
	RunORef   string `json:"runoref"`
}

// CommandListDetachedEdgesData asks the inverse question from each end — a record's suppressed runs, or a
// run's suppressed records. Exactly one id is set; setting neither is an error, since an unfiltered read
// would return every correction ever made.
type CommandListDetachedEdgesData struct {
	DossierId string `json:"dossierid,omitempty"`
	RunORef   string `json:"runoref,omitempty"`
}

// CommandListDetachedEdgesRtnData mirrors ResolveAmbient's first two fields so the frontend joins labels
// to edges with the machinery it already has. An edge whose underlying signal is gone (Detach strips a
// hardened ref) carries an empty Provenance and Bucket — absent, never a fabricated "weak".
type CommandListDetachedEdgesRtnData struct {
	Tasks []AmbientTask `json:"tasks"`
	Edges []AmbientEdge `json:"edges"`
}

// AmbientDecision is one decision record reachable from a dossier, projected for the ambient
// "relevant past decisions" card. Title is lifted off the rationale — decisions carry no title field.
type AmbientDecision struct {
	DossierId string `json:"dossierid"`
	Id        string `json:"id"`
	Title     string `json:"title"`
	Created   int64  `json:"created"`
}

// CommandResolveAmbientRtnData is the whole ambient map in one read: the frontend joins Edges to Tasks
// by dossier id and renders Decisions on an object's detail. Loaded once per surface, not per row.
type CommandResolveAmbientRtnData struct {
	Tasks     []AmbientTask     `json:"tasks"`
	Edges     []AmbientEdge     `json:"edges"`
	Decisions []AmbientDecision `json:"decisions"`
}

// DecisionCard is one decision record projected for the Tasks surface. Rationale is human prose;
// every other field is machine-owned. Read-only in the UI (decisions are append-only).
type DecisionCard struct {
	Id         string   `json:"id"`
	Created    int64    `json:"created"`
	Actor      string   `json:"actor"`
	Provenance string   `json:"provenance"`
	Status     string   `json:"status"`
	Links      []string `json:"links"`
	Rationale  string   `json:"rationale"`
}

// DossierDetail is a task dossier projected for the Tasks surface. Every field renders read-only
// except via the write commands (append a decision, set status). Notes is the human ## Notes prose,
// read-only this cycle.
type DossierDetail struct {
	Id         string         `json:"id"`
	Ticket     string         `json:"ticket"`
	Objective  string         `json:"objective"`
	Acceptance []string       `json:"acceptance"`
	Confidence string         `json:"confidence"`
	Status     string         `json:"status"`
	Created    int64          `json:"created"`
	Updated    int64          `json:"updated"`
	State      string         `json:"state"`
	Blockers   []string       `json:"blockers"`
	Refs       []string       `json:"refs"`
	Notes      string         `json:"notes"`
	Decisions  []DecisionCard `json:"decisions"`
}

type CommandGetDossierData struct {
	DossierId string `json:"dossierid"`
}

type CommandListTaskDossiersRtnData struct {
	Dossiers []SpaceSummary `json:"dossiers"`
}

type CommandAppendDossierDecisionData struct {
	DossierId string   `json:"dossierid"`
	Summary   string   `json:"summary"`
	Rationale string   `json:"rationale"`
	Links     []string `json:"links,omitempty"`
}

type CommandAppendDossierDecisionRtnData struct {
	DecisionId string `json:"decisionid"`
}

type CommandSetDossierStatusData struct {
	DossierId string `json:"dossierid"`
	Status    string `json:"status"`
}

// --- Work ledger (Axis 1): wire types for the stateless query surface. --------------------------

// CommandJarvisStateData filters the work-ledger query. Project filters to one project ("" = all);
// SinceMs windows the timeline/delta (0 = unbounded).
type CommandJarvisStateData struct {
	Project string `json:"project,omitempty"`
	SinceMs int64  `json:"sincems,omitempty"`
}

// CommandJarvisStateRtnData is the ledger query response: per-project derivations plus per-leg
// source health (the "never ran vs ran and found nothing" discipline).
type CommandJarvisStateRtnData struct {
	State WorkState `json:"state"`
}

type WorkState struct {
	Projects []ProjectWork   `json:"projects,omitempty"`
	Efforts  []EffortSummary `json:"efforts,omitempty"`
	Sources  SourceHealth    `json:"sources"`
}

type ProjectWork struct {
	Project string           `json:"project"`
	Active  []ActiveWorkItem `json:"active,omitempty"`
	Shipped []ShippedItem    `json:"shipped,omitempty"`
	Events  []TimelineEvent  `json:"events,omitempty"`
	Delta   []TimelineEvent  `json:"delta,omitempty"`
}

// ActiveWorkItem is one thing the operator might want surfaced about in-flight work.
type ActiveWorkItem struct {
	Project     string   `json:"project"`
	Kind        string   `json:"kind"` // "run" | "session" | "attention" | "blocker"
	Title       string   `json:"title"`
	Detail      string   `json:"detail,omitempty"`
	Ts          int64    `json:"ts"`
	NavTarget   string   `json:"navtarget,omitempty"`   // "run:<oid>" | "task:<id>"
	WorkerORefs []string `json:"workerorefs,omitempty"` // run rows only: sorted deduped phase worker orefs ("tab:<id>")
	Mode        string   `json:"mode,omitempty"`        // run rows only: the Run's mode (quick | pipeline | orchestrator)
}

// ShippedItem is one completed, evidence-sealed run within the window.
type ShippedItem struct {
	Project     string                  `json:"project"`
	RunOID      string                  `json:"runoid"`
	Goal        string                  `json:"goal"`
	Summary     string                  `json:"summary,omitempty"`
	Files       []waveobj.EvidenceFile  `json:"files,omitempty"`
	Verifs      []waveobj.EvidenceVerif `json:"verifs,omitempty"`
	CompletedTs int64                   `json:"completedts"`
	HasReport   bool                    `json:"hasreport,omitempty"` // the lead filed a run report (Run.Report)
	EffortOID   string                  `json:"effortoid,omitempty"` // the chunk the run executed, when attributed
	ChunkLabel  string                  `json:"chunklabel,omitempty"`
	Mode        string                  `json:"mode,omitempty"` // the Run's mode (quick | pipeline | orchestrator)
}

// TimelineEvent is one merged, timestamp-descending "what happened when" event.
type TimelineEvent struct {
	Ts        int64  `json:"ts"`
	Kind      string `json:"kind"` // run-created | run-done | session | decision | dossier | attention
	Project   string `json:"project,omitempty"`
	Title     string `json:"title"`
	Detail    string `json:"detail,omitempty"`
	NavTarget string `json:"navtarget,omitempty"`
}

// SourceHealth reports each ledger leg's read status. Attention is always "volatile": the pending-ask
// registry is server-lifetime (a wavesrv restart empties it until agents re-raise), so an empty
// attention read after a restart must never read as a confident "nothing needs you".
type SourceHealth struct {
	Runs      bool   `json:"runs"`
	Sessions  bool   `json:"sessions"`
	Dossiers  bool   `json:"dossiers"`
	Efforts   bool   `json:"efforts"`
	Attention string `json:"attention"` // "ok" | "volatile" | "error"
}

// CommandJarvisStatusData is an empty request: the response is capture-pipeline accounting.
type CommandJarvisStatusData struct{}

// CaptureStatus is the observability answer to "did it skip my session?": vault note counts per
// collection and effort tracker accounting.
type CaptureStatus struct {
	NoteCounts map[string]int       `json:"notecounts,omitempty"`
	Efforts    CaptureEffortsStatus `json:"efforts"`
}

// CaptureEffortsStatus is the tracker accounting for the `wsh jarvis status` efforts line.
type CaptureEffortsStatus struct {
	Active      int `json:"active"`
	ChunksDone  int `json:"chunksdone"`
	ChunksTotal int `json:"chunkstotal"`
}

type CommandJarvisStatusRtnData struct {
	Status CaptureStatus `json:"status"`
}

// CommandJarvisCtxData is the run-context resolve request. BlockORef is the block whose owner run is
// wanted (the caller's own block in the CLI); "" yields an empty result.
type CommandJarvisCtxData struct {
	BlockORef string `json:"blockoref,omitempty"`
}

// CommandJarvisCtxRtnData is the run context owning the caller's block: its channel, its run, and the
// run's dag (when the run is an orchestrator lead). All fields empty when the block resolves to no run.
type CommandJarvisCtxRtnData struct {
	ChannelId string `json:"channelid,omitempty"`
	RunId     string `json:"runid,omitempty"`
	DagOID    string `json:"dagoid,omitempty"`
	Goal      string `json:"goal,omitempty"`
}

// RunEventData is the run:event broadcast payload — the FE appends one row to the focused run's
// timeline without re-querying.
type RunEventData struct {
	ChannelId string           `json:"channelid"`
	RunId     string           `json:"runid"`
	Event     waveobj.RunEvent `json:"event"`
}

// CommandJarvisRunEventsData is the run-event read request; limit 0/absent -> 200, capped at 500.
type CommandJarvisRunEventsData struct {
	ChannelId string `json:"channelid"`
	RunId     string `json:"runid"`
	Limit     int    `json:"limit,omitempty"`
}

// CommandJarvisRunEventsRtnData is the run's event log, newest-first.
type CommandJarvisRunEventsRtnData struct {
	Events []waveobj.RunEvent `json:"events"`
}
