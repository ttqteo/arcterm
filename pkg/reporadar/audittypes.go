// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package reporadar

import "time"

const (
	FixAuditsPerScan = 8
	AuditConcurrency = 3
	AuditTimeout     = 10 * time.Minute
	MaxFixDiffBytes  = 60 * 1024

	AuditQueued  = "queued"
	AuditRunning = "running"
	AuditOK      = "ok"
	AuditFailed  = "failed"

	RiskSiblingBug = "sibling-bug"

	AuditRuntimeClaude = "claude"
	AuditRuntimePi     = "pi"
	DefaultAuditModel  = "sonnet" // claude only; pi with no model runs its own default
)

// fixCommit is one selected fix commit. Files are its code files (no docs, no tests), sorted.
type fixCommit struct {
	Hash    string
	Subject string
	Ts      int64 // unix millis
	Files   []string
}

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
	Hits      []auditHit `json:"hits"`
}

// auditRoute is the runtime and model an audit session runs on.
type auditRoute struct{ Runtime, Model string }

// auditSessionResult is what one session returned: its final assistant message and what the runtime reported.
type auditSessionResult struct {
	Reply           string
	Model           string
	TotalTokens     int // input, cache writes and output
	CacheReadTokens int // counted apart: a session re-reads its cached prefix on every turn
}
