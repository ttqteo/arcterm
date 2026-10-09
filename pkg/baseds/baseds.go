// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// used for shared datastructures
package baseds

type LinkId int32

const NoLinkId = 0

type RpcInputChType struct {
	MsgBytes      []byte
	IngressLinkId LinkId
}

type Badge struct {
	BadgeId   string  `json:"badgeid"` // must be a uuidv7
	Icon      string  `json:"icon"`
	Color     string  `json:"color,omitempty"`
	Priority  float64 `json:"priority"`
	PidLinked bool    `json:"pidlinked,omitempty"`
}

type BadgeEvent struct {
	ORef      string `json:"oref"`
	Clear     bool   `json:"clear,omitempty"`
	ClearAll  bool   `json:"clearall,omitempty"`
	ClearById string `json:"clearbyid,omitempty"`
	Badge     *Badge `json:"badge,omitempty"`
}

const (
	AgentState_Working = "working"
	AgentState_Waiting = "waiting"
	// AgentState_Asking is a pending question (AskUserQuestion) — distinct from Waiting
	// (a generic Notification nudge) so the cockpit can surface it as "asking", not "working".
	AgentState_Asking = "asking"
	AgentState_Idle   = "idle"
)

// AgentUsage is an optional usage snapshot carried on AgentStatusData, sourced from the Claude
// Code statusLine JSON. Like the usage delta it rides a stateless (State-empty) Persist:0 event.
// The rate-limit fields are pointers because they are populated only for Claude.ai Pro/Max sessions
// and may be independently absent — nil means "unknown", which must render differently from 0%.
type AgentUsage struct {
	ContextPct    float64  `json:"contextpct,omitempty"`    // context_window.used_percentage
	ContextMax    int      `json:"contextmax,omitempty"`    // context_window_size (200000 | 1000000)
	CostUSD       float64  `json:"costusd,omitempty"`       // cost.total_cost_usd
	FiveHourPct   *float64 `json:"fivehourpct,omitempty"`   // rate_limits.five_hour.used_percentage
	FiveHourReset *int64   `json:"fivehourreset,omitempty"` // rate_limits.five_hour.resets_at (epoch seconds)
	WeekPct       *float64 `json:"weekpct,omitempty"`       // rate_limits.seven_day.used_percentage
	WeekReset     *int64   `json:"weekreset,omitempty"`     // rate_limits.seven_day.resets_at (epoch seconds)
	Account       string   `json:"account,omitempty"`       // the Claude account the reporting session runs on (ARC_CLAUDE_ACCOUNT); "" = Default
}

// AgentStatusData is the payload of Event_AgentStatus. ORef is the block (or tab)
// the status applies to; State is one of the AgentState_* constants. When Usage is
// non-nil the event carries a usage snapshot, in which case State may be empty.
type AgentStatusData struct {
	ORef           string      `json:"oref"`
	State          string      `json:"state"`
	Detail         string      `json:"detail,omitempty"`
	Agent          string      `json:"agent,omitempty"`
	Model          string      `json:"model,omitempty"`
	Cwd            string      `json:"cwd,omitempty"`
	SessionID      string      `json:"sessionid,omitempty"`
	Provider       string      `json:"provider,omitempty"`
	Title          string      `json:"title,omitempty"`     // agent's ai-title (task summary), used as the sidebar label
	Step           string      `json:"step,omitempty"`      // idle: the "n/m" part its last message stopped on, e.g. "1/3"
	Committed      bool        `json:"committed,omitempty"` // idle: its last turn ended on a git commit (offers Close)
	TranscriptPath string      `json:"transcriptpath,omitempty"`
	Ts             int64       `json:"ts"`
	Usage          *AgentUsage `json:"usage,omitempty"`
}

// VolunteerData is the payload of Event_JarvisVolunteer: one thing Jarvis chose to say unprompted.
// Id and At are stamped from the FACT (a run's end time, a dossier's last-touched time), never from
// the moment of emission — the frontend watermark compares At first and breaks ties on Id, so a
// re-emitted identical fact must carry an identical pair or the creature repeats itself forever.
// Ref/Anchor are frontend navigation addresses only; they carry vault node ids and must never be
// passed to waveobj.ParseORef.
// SleptData is the payload of Event_Slept: the machine slept from From to To (UnixMilli), each within the
// watcher's tick of the real moment (pkg/sleepwatch).
type SleptData struct {
	From int64 `json:"from"`
	To   int64 `json:"to"`
}

type VolunteerData struct {
	Class      string `json:"class"` // recall | connection | loose-end
	Id         string `json:"id"`
	At         int64  `json:"at"` // UnixMilli
	Title      string `json:"title"`
	Text       string `json:"text"`
	SourceType string `json:"sourcetype,omitempty"` // dossier | decision | memory | run
	Ref        string `json:"ref,omitempty"`
	Anchor     string `json:"anchor,omitempty"`
}

type AgentAskOption struct {
	Label       string `json:"label"`
	Description string `json:"description,omitempty"`
	// Preview is a markdown string rendered beside the option list (pi's rpiv-shaped
	// preview panels, and CC's AskUserQuestion preview field); the cockpit ask UI renders it when present.
	Preview string `json:"preview,omitempty"`
}

type AgentAskQuestion struct {
	Question    string           `json:"question"`
	Header      string           `json:"header,omitempty"`
	MultiSelect bool             `json:"multiselect,omitempty"`
	Options     []AgentAskOption `json:"options,omitempty"`
}

// AgentAskData is the payload of Event_AgentAsk. ORef is the block the ask applies to;
// AskId keys the pending request in the agentask registry (for routing the answer back).
// A Cleared event (same ORef+AskId, Cleared=true, no questions) removes a resolved/cancelled ask.
type AgentAskData struct {
	ORef      string             `json:"oref"`
	AskId     string             `json:"askid"`
	Questions []AgentAskQuestion `json:"questions,omitempty"`
	Ts        int64              `json:"ts,omitempty"` // UnixMilli the ask was raised (for the "asking · 4m" age)
	Cleared   bool               `json:"cleared,omitempty"`
	// Prose marks a projected bare-prose question (pi prose bridge); the FE submits chip
	// labels as text answers instead of picker indexes.
	Prose bool `json:"prose,omitempty"`
	// Note says why the ask is back in front of the human (e.g. a typed answer that never cleared).
	Note string `json:"note,omitempty"`
	// Hold marks a held command's card (`wsh memgate`): its question is on arcterm's card, not in the
	// agent's terminal, so the cockpit offers the answer beside the terminal.
	Hold bool `json:"hold,omitempty"`
}

// AgentAnswerItem is one question's answer in a panel-submitted reply. Exactly one of Text or
// SelectedIndexes is set: SelectedIndexes indexes into that question's Options (single-select uses
// one); Text is a free-text answer delivered to Claude Code's "Type something" row.
type AgentAnswerItem struct {
	SelectedIndexes []int  `json:"selectedindexes,omitempty"`
	Text            string `json:"text,omitempty"`
}
