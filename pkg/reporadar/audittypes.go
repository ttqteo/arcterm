// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package reporadar

import "time"

const (
	AuditConcurrency = 3
	AuditTimeout     = 10 * time.Minute
	MaxFixDiffBytes  = 60 * 1024

	SiblingAuditsPerScan    = 8
	IntroducedAuditsPerScan = 3
	HotspotAuditsPerScan    = 2

	IntroducedMinLines = 50   // below this a change rarely carries a defect worth a session
	IntroducedMaxLines = 1500 // above this the diff passes MaxFixDiffBytes and the session reads instead of reviewing
	HotspotMinFixes    = 2
	HotspotMaxLines    = 1500 // the probe's 1101-line file already cost 123k tokens

	AuditQueued  = "queued"
	AuditRunning = "running"
	AuditOK      = "ok"
	AuditFailed  = "failed"

	RiskSiblingBug = "sibling-bug"

	AuditRuntimeClaude = "claude"
	AuditRuntimePi     = "pi"
	DefaultAuditModel  = "sonnet" // claude only; pi with no model runs its own default
)

// auditHit and auditReply are the session's JSON reply contract.
type auditHit struct {
	File          string `json:"file"`
	Line          int    `json:"line"`
	Title         string `json:"title"`
	Trigger       string `json:"trigger"`
	Actual        string `json:"actual"`
	Expected      string `json:"expected"`
	WhyNotCovered string `json:"whynotcovered"`
	Severity      string `json:"severity"`
}

type auditReply struct {
	RootCause string     `json:"rootcause"`
	Siblings  []string   `json:"siblings"`
	Checked   []string   `json:"checked"`
	Hits      []auditHit `json:"hits"`
}

// auditRoute is the runtime and model an audit session runs on. ClassifyModel is the scan's commit
// classifier model on the same runtime; empty takes classifyRoute's default.
type auditRoute struct{ Runtime, Model, ClassifyModel string }

// auditSessionResult is what one session returned: its final assistant message and what the runtime reported.
type auditSessionResult struct {
	Reply           string
	Model           string
	TotalTokens     int // input, cache writes and output
	CacheReadTokens int // counted apart: a session re-reads its cached prefix on every turn
}
