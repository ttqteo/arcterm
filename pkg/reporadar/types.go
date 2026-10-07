// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package reporadar scans a single registered repository for bugs a recent fix left behind at sibling
// sites. It picks the window's fix commits deterministically, runs one read-only agent session per commit
// that reads the code for the same bug elsewhere, keeps only the hits that name a real file, line and
// trigger, and tracks the findings across scans. It never mutates the repository and never runs tests,
// builds or the app. Persisted types live in pkg/waveobj.
package reporadar

import "time"

func nowMilli() int64 { return time.Now().UnixMilli() }

// scan status (mirrors waveobj.RadarReport.Status). The wire values predate the audit pipeline:
// collecting is fix-commit selection, clustering is the audit sessions.
const (
	StatusCollecting = "collecting"
	StatusClustering = "clustering"
	StatusCompleted  = "completed"
	StatusPartial    = "partial"
	StatusFailed     = "failed"
	StatusCancelled  = "cancelled"
)

// finding lifecycle group
const (
	GroupNew        = "new"
	GroupRecurring  = "recurring"
	GroupNoLonger   = "nolonger"
	GroupDismissed  = "dismissed"
	GroupSuppressed = "suppressed"
)

// CollectorGit is the one signal kind left (RadarSignal.Collector): a finding's source fix commit.
const CollectorGit = "git"

const (
	SeverityLow    = "low"
	SeverityMedium = "medium"
	SeverityHigh   = "high"
)

var severityRank = map[string]int{SeverityHigh: 3, SeverityMedium: 2, SeverityLow: 1}

func normalizeSeverity(s string) string {
	switch s {
	case SeverityHigh, SeverityMedium, SeverityLow:
		return s
	default:
		return SeverityMedium
	}
}

// maxEvidenceTextLen bounds a commit subject quoted in a signal summary.
const maxEvidenceTextLen = 160

// maxRawResponseBytes bounds a stored session reply; it is an audit trail, not a transcript.
const maxRawResponseBytes = 64 * 1024

// EvidenceWindow is how far back every scan looks for fix commits. It is rolling rather than
// since-last-scan, so a commit whose audit failed is still in reach of the next scan.
const EvidenceWindow = 30 * 24 * time.Hour

// NoLongerAfterMisses is how many consecutive scans must miss an open finding before it moves to
// No longer detected.
const NoLongerAfterMisses = 2

// ReportsKeptPerProject bounds stored reports per project; attention triage loads every report.
const ReportsKeptPerProject = 20

// InvestigationOrphaned marks an investigation whose run no longer exists, so it can never finish.
const InvestigationOrphaned = "orphaned"
