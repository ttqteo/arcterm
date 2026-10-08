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
	GetTranscriptTokensCommand(ctx context.Context, data CommandGetTranscriptTokensData) (*CommandGetTranscriptTokensRtnData, error)
	GetTranscriptUsageCommand(ctx context.Context, data CommandGetTranscriptUsageData) (*CommandGetTranscriptUsageRtnData, error)
	GetWindowTokensCommand(ctx context.Context, data CommandGetWindowTokensData) (*CommandGetWindowTokensRtnData, error)
	GetClaudeQuotaCommand(ctx context.Context) (*CommandGetClaudeQuotaRtnData, error)     // the Claude account's 5-hour and weekly windows with no session running
	RefreshClaudeQuotaCommand(ctx context.Context) (*CommandGetClaudeQuotaRtnData, error) // the same, asking the usage endpoint now (a 429 backoff still holds: RetryAt says until when)
	GetCacheStatusCommand(ctx context.Context, data CommandGetCacheStatusData) (*CommandGetCacheStatusRtnData, error)
	GetBackgroundAgentsCommand(ctx context.Context, data CommandGetBackgroundAgentsData) (*CommandGetBackgroundAgentsRtnData, error)
	// the folders Claude Code has sessions in, for the New project picker
	ScanClaudeProjectsCommand(ctx context.Context) (*CommandScanClaudeProjectsRtnData, error)
	RemoveBackgroundAgentCommand(ctx context.Context, data CommandRemoveBackgroundAgentData) error                                        // dismiss a background agent: delete its ~/.claude/jobs record (transcript kept)
	StreamAgentTranscriptCommand(ctx context.Context, data CommandStreamAgentTranscriptData) chan RespOrErrorUnion[AgentTranscriptUpdate] // stream the transcript tail; new lines pushed as appended
	AgentControlCommand(ctx context.Context, data CommandAgentControlData) chan RespOrErrorUnion[AgentControlMsg]                         // stream the cockpit's prompts for a block's agent session to its harness mod
	AgentsListCommand(ctx context.Context) (*CommandAgentsListRtnData, error)                                                             // the live claude and pi agent tabs
	AgentsSendCommand(ctx context.Context, data CommandAgentsSendData) (*CommandAgentsSendRtnData, error)                                 // hand a prompt from one agent to another's live session
	AgentsReadCommand(ctx context.Context, data CommandAgentsReadData) (*CommandAgentsReadRtnData, error)                                 // a live agent's state and last answer
	AgentsSetModelCommand(ctx context.Context, data CommandAgentsSetModelData) (*CommandAgentsSetModelRtnData, error)                     // switch a live Claude session's model with its /model command
	GetConsumersCommand(ctx context.Context) (*CommandGetConsumersRtnData, error)                                                         // every live agent's RAM and last-10-minutes tokens, and arcterm's own processes' RAM
}

// what a live agent session is doing, as AgentInfo.State and CommandAgentsReadRtnData.State carry it.
const (
	AgentsState_Idle    = "idle"
	AgentsState_Working = "working"
	AgentsState_Asking  = "asking"
)

// AgentInfo is one live agent tab. RunId is the run that owns it, empty for a session no run started.
type AgentInfo struct {
	TabId       string `json:"tabid"`
	Name        string `json:"name"`
	ProjectPath string `json:"projectpath"`
	Project     string `json:"project"`
	RunId       string `json:"runid"`
	Harness     string `json:"harness"`
	State       string `json:"state"`
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
	Buckets []UsageBucket `json:"buckets"`
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
}

type CommandGetSessionUsageData struct {
	WindowDays int `json:"windowdays,omitempty"`
}

type CommandGetSessionUsageRtnData struct {
	Sessions []UsageSession `json:"sessions"`
}

type CommandAnalyzeUsageData struct {
	WindowDays int    `json:"windowdays"`
	Digest     string `json:"digest"` // the numbers-only digest the frontend builds (usagedigest.ts)
}

// UsageInsights is one saved usage analysis. The zero value (empty Markdown) means none has run yet.
type UsageInsights struct {
	Markdown   string `json:"markdown"`
	AnalyzedTs int64  `json:"analyzedts"` // unix ms
	WindowDays int    `json:"windowdays"` // the window the digest covered
	Model      string `json:"model"`
}

type CommandGetRecentSessionsData struct {
	WindowDays int `json:"windowdays,omitempty"`
	Limit      int `json:"limit,omitempty"`
}

type CommandGetRecentSessionsRtnData struct {
	Sessions []SessionInfo `json:"sessions"`
}

type CommandGetSessionsActivityData struct {
	WindowDays int `json:"windowdays,omitempty"`
	Limit      int `json:"limit,omitempty"`
}

type CommandGetSessionsActivityRtnData struct {
	Sessions []SessionActivity `json:"sessions"`
}

type CommandGetTranscriptTokensData struct {
	Path string `json:"path"`
}

type CommandGetTranscriptTokensRtnData struct {
	Tokens int `json:"tokens"`
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

// ClaudeProjectData is one folder from ~/.claude/projects, read back from its transcripts' cwd. Run and
// agent worktrees, temp folders and folders that no longer exist are already left out.
type ClaudeProjectData struct {
	Path         string `json:"path"`
	Name         string `json:"name"`
	LastActiveTs int64  `json:"lastactivets"` // newest transcript's mtime, epoch ms
	Sessions     int    `json:"sessions"`
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

// ConsumerDag is where a run worker's task lives: the dag action that stops it takes these.
type ConsumerDag struct {
	ChannelId string `json:"channelid"`
	RunId     string `json:"runid"` // the owner (orchestrator) run
	TaskId    string `json:"taskid"`
}

// ConsumerAgent is one live agent in a GetConsumers reading. RamBytes is absent when its process tree could
// not be read; Tokens are its transcript's usage buckets inside the window, read only when TokensRead.
type ConsumerAgent struct {
	TabId      string        `json:"tabid"`
	BlockId    string        `json:"blockid"`
	RamBytes   *uint64       `json:"rambytes,omitempty"`
	TokensRead bool          `json:"tokensread"`
	Tokens     []UsageBucket `json:"tokens,omitempty"`
	Dag        *ConsumerDag  `json:"dag,omitempty"`
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
}
