// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshrpc

import "context"

type AgentCommands interface {
	GetSessionGroupCommand(ctx context.Context, data CommandGetSessionGroupData) (*CommandGetSessionGroupRtnData, error)
	GetAgentTranscriptCommand(ctx context.Context, data CommandGetAgentTranscriptData) (*CommandGetAgentTranscriptRtnData, error)
	GetSubagentsCommand(ctx context.Context, data CommandGetSubagentsData) (*CommandGetSubagentsRtnData, error) // list a parent agent's on-disk subagent transcripts
	GetUsageStatsCommand(ctx context.Context, data CommandGetUsageStatsData) (*CommandGetUsageStatsRtnData, error)
	GetSessionUsageCommand(ctx context.Context, data CommandGetSessionUsageData) (*CommandGetSessionUsageRtnData, error) // Claude usage folded per session, for the Usage surface's By session table and digest
	AnalyzeUsageCommand(ctx context.Context, data CommandAnalyzeUsageData) (*UsageInsights, error)                       // have Claude (Sonnet, headless) read a usage digest and save what it says
	GetUsageInsightsCommand(ctx context.Context) (*UsageInsights, error)                                                 // the last saved usage analysis; the zero value when there is none
	GetRecentSessionsCommand(ctx context.Context, data CommandGetRecentSessionsData) (*CommandGetRecentSessionsRtnData, error)
	GetSessionsActivityCommand(ctx context.Context, data CommandGetSessionsActivityData) (*CommandGetSessionsActivityRtnData, error)
	GetTranscriptUsageCommand(ctx context.Context, data CommandGetTranscriptUsageData) (*CommandGetTranscriptUsageRtnData, error)
	GetWindowTokensCommand(ctx context.Context, data CommandGetWindowTokensData) (*CommandGetWindowTokensRtnData, error)
	GetSessionBurnCommand(ctx context.Context, data CommandGetSessionBurnData) (*CommandGetSessionBurnRtnData, error)                   // a spawn's weighing for the Token burn card
	GetSubagentCostsCommand(ctx context.Context) (*CommandGetSubagentCostsRtnData, error)                                               // what finished subagents cost, by type (Usage)
	ReviewTokenEstimatesCommand(ctx context.Context, data CommandReviewTokenEstimatesData) (*CommandReviewTokenEstimatesRtnData, error) // the logged Token burn estimates against what ran
	GetClaudeQuotaCommand(ctx context.Context) (*CommandGetClaudeQuotaRtnData, error)                                                   // the Claude account's 5-hour and weekly windows with no session running
	RefreshClaudeQuotaCommand(ctx context.Context) (*CommandGetClaudeQuotaRtnData, error)                                               // the same, asking the usage endpoint now (a 429 backoff still holds: RetryAt says until when)
	GetCacheStatusCommand(ctx context.Context, data CommandGetCacheStatusData) (*CommandGetCacheStatusRtnData, error)
	GetBackgroundAgentsCommand(ctx context.Context, data CommandGetBackgroundAgentsData) (*CommandGetBackgroundAgentsRtnData, error)
	// the folders Claude Code has sessions in, for the New project picker
	ScanClaudeProjectsCommand(ctx context.Context) (*CommandScanClaudeProjectsRtnData, error)
	// the project folders on disk near the given ones, for the New project picker's search
	FindProjectFoldersCommand(ctx context.Context, data CommandFindProjectFoldersData) (*CommandFindProjectFoldersRtnData, error)
	RemoveBackgroundAgentCommand(ctx context.Context, data CommandRemoveBackgroundAgentData) error                                        // dismiss a background agent: delete its ~/.claude/jobs record (transcript kept)
	StreamAgentTranscriptCommand(ctx context.Context, data CommandStreamAgentTranscriptData) chan RespOrErrorUnion[AgentTranscriptUpdate] // stream the transcript tail; new lines pushed as appended
	AgentControlCommand(ctx context.Context, data CommandAgentControlData) chan RespOrErrorUnion[AgentControlMsg]                         // stream the cockpit's prompts for a block's agent session to its harness mod
	AgentsListCommand(ctx context.Context) (*CommandAgentsListRtnData, error)                                                             // the live claude and pi agent tabs
	AgentsSendCommand(ctx context.Context, data CommandAgentsSendData) (*CommandAgentsSendRtnData, error)                                 // hand a prompt from one agent to another's live session
	AgentsReadCommand(ctx context.Context, data CommandAgentsReadData) (*CommandAgentsReadRtnData, error)                                 // a live agent's state and last answer
	AgentsSetModelCommand(ctx context.Context, data CommandAgentsSetModelData) (*CommandAgentsSetModelRtnData, error)                     // switch a live Claude session's model with its /model command
	AgentsSleepCommand(ctx context.Context, data CommandAgentsSleepData) (*CommandAgentsSleepRtnData, error)                              // put an idle agent to sleep: its process ends, its tab and conversation stay
	AgentsWakeCommand(ctx context.Context, data CommandAgentsWakeData) error                                                              // relaunch a sleeping agent with --resume; with Message, deliver it once the agent reports in
	AgentsSetViewingCommand(ctx context.Context, data CommandAgentsSetViewingData) error                                                  // the frontend's agents on screen, which the sleep loop never sleeps
	StopProcessCommand(ctx context.Context, data CommandStopProcessData) error                                                            // end one of an agent's descendant processes and its subtree (the tray's Free up)
	GetConsumersCommand(ctx context.Context) (*CommandGetConsumersRtnData, error)                                                         // every live agent's RAM and last-10-minutes tokens, and arcterm's own processes' RAM
}

// what a live agent session is doing, as AgentInfo.State and CommandAgentsReadRtnData.State carry it.
const (
	AgentsState_Idle     = "idle"
	AgentsState_Working  = "working"
	AgentsState_Asking   = "asking"
	AgentsState_Sleeping = "sleeping"
)

// AgentInfo is one live agent tab. RunId is the run that owns it, empty for a session no run started.
// SleptAt (unix ms) and FreedBytes are set only on a sleeping agent.
type AgentInfo struct {
	TabId       string `json:"tabid"`
	Name        string `json:"name"`
	ProjectPath string `json:"projectpath"`
	Project     string `json:"project"`
	RunId       string `json:"runid"`
	Harness     string `json:"harness"`
	State       string `json:"state"`
	SleptAt     int64  `json:"sleptat,omitempty"`
	FreedBytes  uint64 `json:"freedbytes,omitempty"`
}

type CommandAgentsListRtnData struct {
	Agents []AgentInfo `json:"agents"`
}

type CommandAgentsSendData struct {
	Tab      string `json:"tab"` // a tab id or a unique prefix of one
	Text     string `json:"text"`
	FromORef string `json:"fromoref"` // the sender's block oref
}

type CommandAgentsSendRtnData struct {
	TabId   string `json:"tabid"`
	SentTs  int64  `json:"sentts"`  // server unix ms the prompt was handed over
	MidTurn bool   `json:"midturn"` // the target was not at its prompt
}

type CommandAgentsReadData struct {
	Tab string `json:"tab"` // a tab id or a unique prefix of one
}

type CommandAgentsReadRtnData struct {
	TabId    string `json:"tabid"`
	State    string `json:"state"`
	Answer   string `json:"answer"`   // empty when the session has not answered yet
	AnswerTs int64  `json:"answerts"` // transcript time of Answer, unix ms
}

type CommandGetSessionGroupData struct {
	Cwd string `json:"cwd"`
}

type CommandGetSessionGroupRtnData struct {
	Root  string `json:"root"`
	Label string `json:"label"`
}

type CommandGetAgentTranscriptData struct {
	Path     string `json:"path"`
	MaxLines int    `json:"maxlines,omitempty"`
	// FromStart reads the first MaxLines lines (head) instead of the last (tail); used to resolve
	// Codex cwd, which lives only on the first-line session_meta record.
	FromStart bool `json:"fromstart,omitempty"`
}

type CommandGetAgentTranscriptRtnData struct {
	Lines []string `json:"lines"`
}

type CommandGetSubagentsData struct {
	Path string `json:"path"` // the PARENT agent transcript path; its subagents/ dir is derived from it
}

type CommandGetSubagentsRtnData struct {
	Subagents []SubagentFileInfo `json:"subagents"`
}

type CommandGetUsageStatsData struct {
	WindowDays int `json:"windowdays,omitempty"`
}

type CommandGetUsageStatsRtnData struct {
	Buckets  []UsageBucket      `json:"buckets"`
	Sessions []UsageSessionMeta `json:"sessions"`
}

// UsageSessionMeta is the directory entry for one session that has usage in the window.
type UsageSessionMeta struct {
	Harness   string `json:"harness"`
	Session   string `json:"session"`
	Title     string `json:"title,omitempty"`
	Project   string `json:"project,omitempty"` // repo root path
	RunId     string `json:"runid,omitempty"`   // the owning top-level run
	ChannelId string `json:"channelid,omitempty"`
	RunGoal   string `json:"rungoal,omitempty"` // first line
	RunMode   string `json:"runmode,omitempty"` // orchestrator | quick
	Role      string `json:"role,omitempty"`    // lead | worker | reviewer | a stage role
	TaskId    string `json:"taskid,omitempty"`
}

// UsageSessionModel is one (model, subagent or not) slice of a session's tokens; CacheCreate1h is a
// subset of CacheCreate, as in UsageBucket.
type UsageSessionModel struct {
	Model         string `json:"model"`
	Sub           bool   `json:"sub,omitempty"`
	Input         int    `json:"input"`
	Output        int    `json:"output"`
	CacheRead     int    `json:"cacheread"`
	CacheCreate   int    `json:"cachecreate"`
	CacheCreate1h int    `json:"cachecreate1h"`
}

// UsageSession is one Claude session's usage. A session with Turns 0 has only subagent records in the
// window, so its Title and Project are empty. Times are unix ms.
type UsageSession struct {
	ID          string              `json:"id"`
	Title       string              `json:"title"`
	Project     string              `json:"project"`
	Models      []UsageSessionModel `json:"models"`
	Turns       int                 `json:"turns"`
	SubTurns    int                 `json:"subturns"`
	AvgCtx      int                 `json:"avgctx"`
	MaxCtx      int                 `json:"maxctx"`
	ColdResumes int                 `json:"coldresumes"`
	ColdTokens  int                 `json:"coldtokens"`
	FirstTs     int64               `json:"firstts"`
	LastTs      int64               `json:"lastts"`
	BigResults  []UsageBigResults   `json:"bigresults,omitempty"` // most characters first

	FiveHourTokens int `json:"fivehourtokens"` // this session's tokens since FiveHourCutoff, subagents included
	WeekTokens     int `json:"weektokens"`
}

// UsageBigResults is one tool's oversized results in a session: tool results over usagestats.BigResultChars
// characters, a subagent's apart from the main conversation's.
type UsageBigResults struct {
	Tool         string `json:"tool"`
	Sub          bool   `json:"sub,omitempty"`
	Count        int    `json:"count"`
	Chars        int    `json:"chars"`
	RereadTokens int    `json:"rereadtokens,omitempty"` // tokens of these results read back on later main turns, see usagestats.SessionBigResults
}

type CommandGetSessionUsageData struct {
	WindowDays     int   `json:"windowdays,omitempty"`
	FiveHourCutoff int64 `json:"fivehourcutoff,omitempty"` // epoch seconds; 0 = the trailing 5 hours
	WeekCutoff     int64 `json:"weekcutoff,omitempty"`     // epoch seconds; 0 = the trailing 7 days
}

type CommandGetSessionUsageRtnData struct {
	Sessions             []UsageSession `json:"sessions"`
	WindowFiveHourTokens int            `json:"windowfivehourtokens"` // every session's tokens since FiveHourCutoff
	WindowWeekTokens     int            `json:"windowweektokens"`
}

// UsageLeverSession is one session a usage lever could recover spend from; Ref ("S1") is how the digest and Claude name it.
type UsageLeverSession struct {
	Ref     string  `json:"ref"`
	ID      string  `json:"id"`
	Title   string  `json:"title"`
	SaveUsd float64 `json:"saveusd"` // the most this session's spend could drop by under this lever
}

// UsageLever is one fix the frontend priced (usagelevers.ts). Count and Tokens are the evidence the card shows; what
// they count depends on Key. Fix and Tabs are Claude's words, set only on a saved result.
type UsageLever struct {
	Key      string              `json:"key"`
	Count    int                 `json:"count,omitempty"`
	Tokens   int                 `json:"tokens,omitempty"`
	Sessions []UsageLeverSession `json:"sessions"`
	Fix      string              `json:"fix,omitempty"`
	Tabs     []string            `json:"tabs,omitempty"` // session refs, most telling first
}

type CommandAnalyzeUsageData struct {
	WindowDays int          `json:"windowdays"`
	Digest     string       `json:"digest"`             // the numbers-only digest the frontend builds (usagedigest.ts)
	Lang       string       `json:"lang,omitempty"`     // the language to answer in; "" falls back to the usage:insightslang setting
	Levers     []UsageLever `json:"levers,omitempty"`   // the candidates the frontend priced; Claude's answer is checked against them and they are saved with it
	SpendUsd   float64      `json:"spendusd,omitempty"` // the window's Claude spend, the levers' denominator
}

// UsageInsights is one saved usage analysis. The zero value (no headline and empty Markdown) means none has run yet;
// a result saved before the levers shipped has Markdown and no Headline.
type UsageInsights struct {
	Markdown   string       `json:"markdown"`
	Headline   string       `json:"headline,omitempty"`
	Levers     []UsageLever `json:"levers,omitempty"`
	OpusClear  []string     `json:"opusclear,omitempty"` // refs of the opus lever's sessions Claude judged clear work for Sonnet
	Tips       []string     `json:"tips,omitempty"`
	SpendUsd   float64      `json:"spendusd,omitempty"` // the window's Claude spend when it ran
	AnalyzedTs int64        `json:"analyzedts"`         // unix ms
	WindowDays int          `json:"windowdays"`         // the window the digest covered
	Model      string       `json:"model"`
	Lang       string       `json:"lang,omitempty"` // the language code it answered in; "" in one saved before this was kept
}

// A windowdays of 0 reads every transcript on disk; cursor is the nextcursor of the page before ("" starts at the
// newest); runtime, projectpath and query filter before the limit counts.
type CommandGetRecentSessionsData struct {
	WindowDays  int    `json:"windowdays,omitempty"`
	Limit       int    `json:"limit,omitempty"`
	Cursor      string `json:"cursor,omitempty"`
	Runtime     string `json:"runtime,omitempty"`
	ProjectPath string `json:"projectpath,omitempty"`
	Query       string `json:"query,omitempty"`
}

type CommandGetRecentSessionsRtnData struct {
	Sessions   []SessionInfo `json:"sessions"`
	NextCursor string        `json:"nextcursor,omitempty"` // "" when no older session is left
}

type CommandGetSessionsActivityData struct {
	WindowDays int    `json:"windowdays,omitempty"`
	Limit      int    `json:"limit,omitempty"`
	Cursor     string `json:"cursor,omitempty"`
}

type CommandGetSessionsActivityRtnData struct {
	Sessions   []SessionActivity `json:"sessions"`
	NextCursor string            `json:"nextcursor,omitempty"` // "" when no older session is left
}

type CommandGetTranscriptUsageData struct {
	Path string `json:"path"`
}

type CommandGetTranscriptUsageRtnData struct {
	Buckets []UsageBucket `json:"buckets"`
}

type CommandGetWindowTokensData struct {
	FiveHourCutoff int64 `json:"fivehourcutoff,omitempty"` // epoch seconds; 0 = all-time
	WeekCutoff     int64 `json:"weekcutoff,omitempty"`     // epoch seconds; 0 = all-time
}

type CommandGetWindowTokensRtnData struct {
	FiveHourTokens int `json:"fivehourtokens"`
	WeekTokens     int `json:"weektokens"`
}

// what finished subagents of one type cost (usagestats.SubagentCost); type "all" is every type at once
type SubagentCostData struct {
	Type    string `json:"type"`
	Samples int    `json:"samples"`
	Mean    int64  `json:"mean"`
	P25     int64  `json:"p25"`
	P90     int64  `json:"p90"`
}

type CommandGetSessionBurnData struct {
	Path           string `json:"path,omitempty"`           // the session's transcript, or one of its subagents'; "" = no session
	FiveHourCutoff int64  `json:"fivehourcutoff,omitempty"` // epoch seconds; 0 = the trailing 5 hours (not all-time, unlike GetWindowTokens)
	WeekCutoff     int64  `json:"weekcutoff,omitempty"`     // epoch seconds; 0 = the trailing 7 days
}

// usagestats.Burn on the wire: WindowTokens' sums for both windows and for the session inside them (its subagents
// included), and what finished subagents cost by type
type CommandGetSessionBurnRtnData struct {
	Session         string             `json:"session"`
	WindowFiveHour  int                `json:"windowfivehour"`
	WindowWeek      int                `json:"windowweek"`
	SessionFiveHour int                `json:"sessionfivehour"`
	SessionWeek     int                `json:"sessionweek"`
	Subagents       int                `json:"subagents"`
	Costs           []SubagentCostData `json:"costs"`
}

type CommandGetSubagentCostsRtnData struct {
	Costs []SubagentCostData `json:"costs"`
}

type CommandReviewTokenEstimatesData struct {
	Days int `json:"days,omitempty"` // 0 = 7
}

type TokenEstimateTypeReview struct {
	Type        string  `json:"type"`
	Matched     int     `json:"matched"`
	MedianRatio float64 `json:"medianratio"`
}

// usagestats.EstimateReview on the wire, with the subagent costs as they stand now
type CommandReviewTokenEstimatesRtnData struct {
	Days        int                       `json:"days"`
	Logged      int                       `json:"logged"`
	Run         int                       `json:"run"`
	Matched     int                       `json:"matched"`
	MedianRatio float64                   `json:"medianratio"`
	WithRange   int                       `json:"withrange"`
	InRange     int                       `json:"inrange"`
	ByType      []TokenEstimateTypeReview `json:"bytype"`
	Costs       []SubagentCostData        `json:"costs"`
}

// the windows as AgentUsage spells them, from Anthropic's usage endpoint or Claude Code's cache of it;
// empty when neither is known
type CommandGetClaudeQuotaRtnData struct {
	FiveHourPct   *float64 `json:"fivehourpct,omitempty"`
	FiveHourReset *int64   `json:"fivehourreset,omitempty"` // epoch seconds
	WeekPct       *float64 `json:"weekpct,omitempty"`
	WeekReset     *int64   `json:"weekreset,omitempty"`  // epoch seconds
	CapturedAt    int64    `json:"capturedat,omitempty"` // epoch ms the reading is as of
	Source        string   `json:"source,omitempty"`     // "live" or "cache"
	Email         string   `json:"email,omitempty"`      // the /login account these numbers belong to, lowercased
	RetryAt       int64    `json:"retryat,omitempty"`    // epoch ms the usage endpoint may be asked again, set when a 429 backoff holds it

	// one model's weekly window each (a Team Premium seat's Fable share), never the week itself; absent when
	// the answer has none
	ScopedWeeks []ClaudeScopedWeek `json:"scopedweeks,omitempty"`
}

// a weekly window that counts one model's use alone
type ClaudeScopedWeek struct {
	Model string  `json:"model"` // the model's display name, e.g. "Fable"
	Pct   float64 `json:"pct"`
	Reset *int64  `json:"reset,omitempty"` // epoch seconds
}

type CommandGetCacheStatusData struct {
	Path string `json:"path"`
}

type CommandGetCacheStatusRtnData struct {
	LastWriteTs int64 `json:"lastwritets,omitempty"` // epoch seconds; absent = no cache-write found
	OneHour     bool  `json:"onehour,omitempty"`
}

type CommandStreamAgentTranscriptData struct {
	Path      string `json:"path"`
	TailLines int    `json:"taillines,omitempty"`
}

type AgentTranscriptUpdate struct {
	Lines []string `json:"lines"`
}

type CommandAgentControlData struct {
	ORef string `json:"oref"`
}

// AgentControlMsg is one thing for the session to do. Text is a prompt as it would be typed: a leading
// slash is a command. Compact asks for a compaction instead, with these instructions, and wins over Text.
// MidTurn asks for Text to join the turn the session is running instead of waiting for it to end.
type AgentControlMsg struct {
	Text    string `json:"text,omitempty"`
	Compact string `json:"compact,omitempty"`
	MidTurn bool   `json:"midturn,omitempty"`
}

type CommandScanClaudeProjectsRtnData struct {
	Projects []ClaudeProjectData `json:"projects"`
}

// ClaudeProjectData is one project Claude Code has sessions in, read back from its transcripts' cwd: a session begun
// in a repo's subfolder counts for the repo. Run and agent worktrees, temp folders, folders that no longer exist, home,
// the filesystem root and folders with no project marker (a .git, a package.json…) are already left out.
type ClaudeProjectData struct {
	Path         string `json:"path"`
	Name         string `json:"name"`
	LastActiveTs int64  `json:"lastactivets"` // newest transcript's mtime, epoch ms
	Sessions     int    `json:"sessions"`
}

// CommandFindProjectFoldersData names the folders to search near: the search looks in each one's parent and
// grandparent ("~" expanded), never in home itself.
type CommandFindProjectFoldersData struct {
	Near []string `json:"near"`
}

type CommandFindProjectFoldersRtnData struct {
	Folders []ProjectFolderData `json:"folders"`
}

// ProjectFolderData is a project folder found on disk, newest first.
type ProjectFolderData struct {
	Path  string `json:"path"`
	Name  string `json:"name"`
	Kind  string `json:"kind"`  // what its marker says: "Node", "Maven", "Python"… or "git" for a bare repo
	ModTs int64  `json:"modts"` // its .git's mtime, else its own, epoch ms
}

type CommandGetBackgroundAgentsData struct{}

type CommandGetBackgroundAgentsRtnData struct {
	Agents []BackgroundAgentData `json:"agents"`
}

type CommandRemoveBackgroundAgentData struct {
	SessionId string `json:"sessionid"`
}

// BackgroundAgentData is one entry from `claude agents --json`, normalized. No PR/model/token
// fields — the listing carries none.
type BackgroundAgentData struct {
	SessionId string `json:"sessionid"`
	Cwd       string `json:"cwd"`
	Kind      string `json:"kind"` // "background" | "interactive"
	Name      string `json:"name"`
	State     string `json:"state"`
	StartedTs int64  `json:"startedts"` // epoch ms
}

type CommandAgentsSetModelData struct {
	Tab   string `json:"tab"`   // a tab id or a unique prefix of one
	Model string `json:"model"` // one word `/model` takes: an alias ("sonnet") or a model id
}

type CommandAgentsSetModelRtnData struct {
	TabId      string `json:"tabid"`
	MidTurn    bool   `json:"midturn"`    // the session was not at its prompt
	OverStream bool   `json:"overstream"` // its mod took the command; else it was typed into the terminal
}

type CommandAgentsSleepData struct {
	Tab   string `json:"tab"`
	Force bool   `json:"force,omitempty"` // stop its background tasks too (the person confirmed)
}

type CommandAgentsSleepRtnData struct {
	FreedBytes uint64   `json:"freedbytes,omitempty"`
	Background []string `json:"background,omitempty"` // set, and nothing slept, when it has running background work and Force is false
}

type CommandAgentsWakeData struct {
	Tab     string `json:"tab"`
	Message string `json:"message,omitempty"`
	Fresh   bool   `json:"fresh,omitempty"` // Start fresh: relaunch without --resume (the resume failed)
}

type CommandAgentsSetViewingData struct {
	TabIds []string `json:"tabids"`
}

// ConsumerDag is where a run worker's task lives: the dag action that stops it takes these.
type ConsumerDag struct {
	ChannelId string `json:"channelid"`
	RunId     string `json:"runid"` // the owner (orchestrator) run
	TaskId    string `json:"taskid"`
}

// ConsumerAgent is one live agent in a GetConsumers reading. RamBytes is absent when its process tree could
// not be read; Tokens are its transcript's usage buckets inside the window, read only when TokensRead.
type ConsumerAgent struct {
	TabId      string           `json:"tabid"`
	BlockId    string           `json:"blockid"`
	RamBytes   *uint64          `json:"rambytes,omitempty"`
	TokensRead bool             `json:"tokensread"`
	Tokens     []UsageBucket    `json:"tokens,omitempty"`
	Dag        *ConsumerDag     `json:"dag,omitempty"`
	Heaviest   *ConsumerProcess `json:"heaviest,omitempty"` // its heaviest descendant; absent when it runs nothing but itself
}

// ConsumerProcess is an agent's heaviest descendant process: what the tray's Free up offers to stop.
type ConsumerProcess struct {
	Pid     int32  `json:"pid"`
	Command string `json:"command"` // memusage.ShortCommand of its command line
	Bytes   uint64 `json:"bytes"`
}

type CommandStopProcessData struct {
	BlockId string `json:"blockid"` // the agent's block: the pid must still be under its process
	Pid     int32  `json:"pid"`
}

// CommandGetConsumersRtnData is one reading of the Consumers panel. A nil byte count is one that could not be read.
type CommandGetConsumersRtnData struct {
	TotalBytes     uint64          `json:"totalbytes"`
	AvailableBytes uint64          `json:"availablebytes"`
	WindowMs       int64           `json:"windowms"`
	Agents         []ConsumerAgent `json:"agents"`
	InterfaceBytes *uint64         `json:"interfacebytes,omitempty"`
	ServerBytes    *uint64         `json:"serverbytes,omitempty"`
	HostBytes      *uint64         `json:"hostbytes,omitempty"`
	TerminalsBytes *uint64         `json:"terminalsbytes,omitempty"` // what plain terminal tabs run: wavesrv's tree minus wavesrv and the agents
	// what all of the above holds in RAM now, the RAM bar's share: on macOS the footprints also count what was
	// compressed or swapped out, which under memory pressure sum past the RAM in use
	InRamBytes    *uint64 `json:"inrambytes,omitempty"`
	SwapUsedBytes uint64  `json:"swapusedbytes"` // every app's, swapped out to disk; 0 when it could not be read
}
