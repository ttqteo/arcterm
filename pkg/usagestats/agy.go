// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Antigravity CLI (agy) usage extraction: each PLANNER_RESPONSE step of an agy conversation's
// transcript_full.jsonl carries the tokens that response was billed. The transcript never names the
// model (only free text in a settings-change block might), so a record has an empty model and the
// frontend prices it at $0, whatever model the conversation ran on.
package usagestats

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// agyPlannerMarker is what an agy transcript line must contain to be a planner response; every other
// step (tool results can run past a megabyte) is dropped before it is read into memory or parsed.
var agyPlannerMarker = []byte(`"PLANNER_RESPONSE"`)

// agyTranscriptSuffix is where a conversation keeps its full transcript, under its brain directory.
const agyTranscriptSuffix = ".system_generated/logs/transcript_full.jsonl"

// extractAgy turns the PLANNER_RESPONSE lines of an agy transcript into usage records, each at the
// local day of its created_at. A line with no token fields, an unparsable line (including a
// truncated last one) and a step type agy adds later yield nothing.
func extractAgy(lines []string) []Record {
	var out []Record
	for _, line := range lines {
		var rec struct {
			Type            string `json:"type"`
			CreatedAt       string `json:"created_at"`
			InputTokens     *int   `json:"input_tokens"`
			OutputTokens    *int   `json:"output_tokens"`
			CacheReadTokens *int   `json:"cache_read_tokens"`
		}
		if json.Unmarshal([]byte(line), &rec) != nil || rec.Type != "PLANNER_RESPONSE" {
			continue
		}
		if rec.InputTokens == nil && rec.OutputTokens == nil && rec.CacheReadTokens == nil {
			continue
		}
		ts, err := time.Parse(time.RFC3339, rec.CreatedAt)
		if err != nil {
			continue
		}
		r := Record{TS: ts, Harness: "agy", Provider: "agy"}
		if rec.InputTokens != nil {
			r.Input = *rec.InputTokens
		}
		if rec.OutputTokens != nil {
			r.Output = *rec.OutputTokens
		}
		if rec.CacheReadTokens != nil {
			r.CacheRead = *rec.CacheReadTokens
		}
		out = append(out, r)
	}
	return out
}

// readAgyLines streams the planner-response lines of an agy transcript.
func readAgyLines(path string) []string {
	return scanLines(path, func(line []byte) bool { return bytes.Contains(line, agyPlannerMarker) })
}

// walkAgyFiles collects the in-window agy transcripts at <root>/<conversationId>/.system_generated/
// logs/transcript_full.jsonl. A transcript is only appended to, so one last modified before the
// cutoff holds nothing inside the window and is skipped unread; the exact per-record cutoff is
// stored on each scanFile.
func walkAgyFiles(root string, cutoff time.Time) []scanFile {
	var files []scanFile
	entries, err := os.ReadDir(root)
	if err != nil {
		return nil
	}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		path := filepath.Join(root, e.Name(), ".system_generated", "logs", "transcript_full.jsonl")
		if inWindow(path, cutoff) {
			files = append(files, scanFile{path: path, kind: scanAgy, cutoff: cutoff})
		}
	}
	return files
}

// isAgyTranscriptPath reports whether path is an agy conversation's transcript_full.jsonl under an
// antigravity-cli/brain directory. Path separators are normalized so the check works on Windows
// and POSIX.
func isAgyTranscriptPath(path string) bool {
	p := strings.ReplaceAll(path, "\\", "/")
	return strings.HasSuffix(p, "/"+agyTranscriptSuffix) && strings.Contains(p, "/antigravity-cli/brain/")
}
