// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshrpc

import "context"

type AgentCommands interface {
	GetSessionGroupCommand(ctx context.Context, data CommandGetSessionGroupData) (*CommandGetSessionGroupRtnData, error)
	GetAgentTranscriptCommand(ctx context.Context, data CommandGetAgentTranscriptData) (*CommandGetAgentTranscriptRtnData, error)
	GetSubagentsCommand(ctx context.Context, data CommandGetSubagentsData) (*CommandGetSubagentsRtnData, error) // list a parent agent's on-disk subagent transcripts
	GetUsageStatsCommand(ctx context.Context, data CommandGetUsageStatsData) (*CommandGetUsageStatsRtnData, error)
	GetRecentSessionsCommand(ctx context.Context, data CommandGetRecentSessionsData) (*CommandGetRecentSessionsRtnData, error)
	GetSessionsActivityCommand(ctx context.Context, data CommandGetSessionsActivityData) (*CommandGetSessionsActivityRtnData, error)
	GetTranscriptTokensCommand(ctx context.Context, data CommandGetTranscriptTokensData) (*CommandGetTranscriptTokensRtnData, error)
	GetTranscriptUsageCommand(ctx context.Context, data CommandGetTranscriptUsageData) (*CommandGetTranscriptUsageRtnData, error)
	GetWindowTokensCommand(ctx context.Context, data CommandGetWindowTokensData) (*CommandGetWindowTokensRtnData, error)
	GetClaudeQuotaCommand(ctx context.Context) (*CommandGetClaudeQuotaRtnData, error) // the Claude account's 5-hour and weekly windows with no session running
	GetCacheStatusCommand(ctx context.Context, data CommandGetCacheStatusData) (*CommandGetCacheStatusRtnData, error)
	GetBackgroundAgentsCommand(ctx context.Context, data CommandGetBackgroundAgentsData) (*CommandGetBackgroundAgentsRtnData, error)
	// the folders Claude Code has sessions in, for the New project picker
	ScanClaudeProjectsCommand(ctx context.Context) (*CommandScanClaudeProjectsRtnData, error)
	RemoveBackgroundAgentCommand(ctx context.Context, data CommandRemoveBackgroundAgentData) error // dismiss a background agent: delete its ~/.claude/jobs record (transcript kept)
	StreamAgentTranscriptCommand(ctx context.Context, data CommandStreamAgentTranscriptData) chan RespOrErrorUnion[AgentTranscriptUpdate] // stream the transcript tail; new lines pushed as appended
	AgentControlCommand(ctx context.Context, data CommandAgentControlData) chan RespOrErrorUnion[AgentControlMsg]                         // stream the cockpit's prompts for a block's agent session to its harness mod
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

// AgentControlMsg is one prompt for the session, as it would be typed: a leading slash is a command.
type AgentControlMsg struct {
	Text string `json:"text"`
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
