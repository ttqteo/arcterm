// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pi usage extraction: folds every billed native Pi v3 entry into ordinary usagestats.Record
// values. Unlike the transcript projection (which follows only the active parent branch), usage
// intentionally bills abandoned branches too — those tokens were consumed even though the branch
// is not shown.
package usagestats

import (
	"encoding/json"
	"io/fs"
	"path/filepath"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/pisession"
)

// piMessageRole returns the role of a Pi message entry ("assistant", "toolResult", "user"), or ""
// when the entry is not a message / the payload is unreadable.
func piMessageRole(e pisession.Entry) string {
	var m struct {
		Role string `json:"role"`
	}
	if len(e.Message) == 0 || json.Unmarshal(e.Message, &m) != nil {
		return ""
	}
	return m.Role
}

// extractPi parses every physical entry of one Pi v3 session into usage records. Billing sources
// are assistant messages, tool-result messages, compaction, and branch-summary records — exactly
// the four entry kinds that carry billed usage. The current provider/model is tracked forward
// through the file: model_change entries switch it, and assistant messages that carry their own
// provider/model update it (a record inherits the current provider/model when it lacks one).
// Reasoning is a subset of output and cacheWrite1h a subset of cache-write usage, so both are
// normalized out of the classes they duplicate: output is reported minus its reasoning subset, and
// CacheCreate1h rides as metadata inside CacheCreate (never added to total tokens separately).
// Reported cost uses the entry's cost.total. cutoff (zero = all-time) filters per entry timestamp.
func extractPi(file *pisession.File, cutoff time.Time) []Record {
	var provider, model string
	var out []Record
	for _, e := range file.Entries {
		switch e.Type {
		case "model_change":
			if e.Provider != "" {
				provider = e.Provider
			}
			if e.ModelID != "" {
				model = e.ModelID
			}
			continue
		case "message":
			role := piMessageRole(e)
			if role != "assistant" && role != "toolResult" {
				continue
			}
			if e.Provider != "" {
				provider = e.Provider
			}
			if e.ModelID != "" {
				model = e.ModelID
			}
		case "compaction", "branch_summary":
			// inherit the current provider/model
		default:
			continue
		}
		if e.Usage == nil {
			continue
		}
		ts, err := time.Parse(time.RFC3339, e.Timestamp)
		if err != nil {
			continue
		}
		if !cutoff.IsZero() && ts.Before(cutoff) {
			continue
		}
		reasoning := e.Usage.Reasoning
		if reasoning < 0 {
			reasoning = 0
		}
		output := e.Usage.Output - reasoning
		if output < 0 {
			output = 0
		}
		cost := e.Usage.Cost.Total
		out = append(out, Record{
			TS: ts, Harness: "pi", Provider: provider, Model: model,
			Input: e.Usage.Input, Output: output, Reasoning: reasoning,
			CacheRead: e.Usage.CacheRead, CacheCreate: e.Usage.CacheWrite,
			CacheCreate1h: e.Usage.CacheWrite1h, ReportedCostUsd: &cost,
		})
	}
	return out
}

// walkPiFiles collects Pi session files under root. The authoritative window is each entry's own
// timestamp, so the exact cutoff is stored per scanFile for the parser to apply. A session file is
// only ever appended to, so one last modified before the cutoff holds no entry inside the window and
// is skipped unread: parsing every session ever written was half the 7-day scan's time.
func walkPiFiles(root string, cutoff time.Time) []scanFile {
	var files []scanFile
	_ = filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(path, ".jsonl") || !inWindow(path, cutoff) {
			return nil
		}
		files = append(files, scanFile{path: path, kind: scanPi, cutoff: cutoff})
		return nil
	})
	return files
}

// isPiTranscriptPath reports whether path is a native Pi v3 session transcript (under
// .pi/agent/sessions). Path separators are normalized so the check works on Windows and POSIX.
func isPiTranscriptPath(path string) bool {
	return strings.Contains(strings.ReplaceAll(path, "\\", "/"), "/.pi/agent/sessions/")
}
