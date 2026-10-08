// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package usagestats

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func agyPlanner(ts string, in, out, cache int) string {
	return fmt.Sprintf(`{"step_index":1,"source":"MODEL","type":"PLANNER_RESPONSE","status":"DONE","created_at":%q,"content":"hi","input_tokens":%d,"output_tokens":%d,"cache_read_tokens":%d}`, ts, in, out, cache)
}

func localTS(day, clock string) string {
	t, err := time.ParseInLocation("2006-01-02 15:04:05", day+" "+clock, time.Local)
	if err != nil {
		panic(err)
	}
	return t.Format(time.RFC3339)
}

func TestAgyExtractSumsPlannerResponsesPerDay(t *testing.T) {
	lines := []string{
		`{"step_index":0,"source":"USER_EXPLICIT","type":"USER_INPUT","status":"DONE","created_at":"` + localTS("2026-10-06", "09:00:00") + `","content":"<USER_REQUEST>\nhello\n</USER_REQUEST>"}`,
		agyPlanner(localTS("2026-10-06", "09:00:05"), 100, 10, 50),
		`{"step_index":2,"source":"MODEL","type":"GENERIC","status":"DONE","created_at":"` + localTS("2026-10-06", "09:00:06") + `","content":"Created At: x\nCompleted At: y\nok"}`,
		agyPlanner(localTS("2026-10-06", "09:00:09"), 200, 20, 150),
		agyPlanner(localTS("2026-10-07", "10:00:00"), 300, 30, 250),
	}
	recs := extractAgy(lines)
	if len(recs) != 3 {
		t.Fatalf("want 3 records, got %d: %+v", len(recs), recs)
	}
	for _, r := range recs {
		if r.Harness != "agy" || r.Provider != "agy" || r.Model != "" {
			t.Errorf("record identity = harness %q provider %q model %q; want agy/agy/empty", r.Harness, r.Provider, r.Model)
		}
	}
	got := map[string]Bucket{}
	for _, b := range bucket(dedupe(recs)) {
		got[b.Day] = b
	}
	if b := got["2026-10-06"]; b.Input != 300 || b.Output != 30 || b.CacheRead != 200 || b.Msgs != 2 {
		t.Errorf("2026-10-06 bucket = %+v", b)
	}
	if b := got["2026-10-07"]; b.Input != 300 || b.Output != 30 || b.CacheRead != 250 || b.Msgs != 1 {
		t.Errorf("2026-10-07 bucket = %+v", b)
	}
}

// the model is only named in settings-change text, never a field, so a Claude conversation is not priced
func TestAgyExtractCostsZeroWhateverTheModel(t *testing.T) {
	lines := []string{
		`{"step_index":0,"type":"USER_INPUT","created_at":"` + localTS("2026-10-06", "09:00:00") + `","content":"<USER_REQUEST>x</USER_REQUEST><USER_SETTINGS_CHANGE>model is claude-sonnet-4-6</USER_SETTINGS_CHANGE>"}`,
		agyPlanner(localTS("2026-10-06", "09:00:05"), 1000, 100, 0),
	}
	recs := extractAgy(lines)
	if len(recs) != 1 {
		t.Fatalf("want 1 record, got %+v", recs)
	}
	if recs[0].Model != "" || recs[0].ReportedCostUsd != nil {
		t.Errorf("record = %+v; want empty model and no reported cost", recs[0])
	}
}

func TestAgyExtractSkipsWhatIsNotAPlannerResponseWithTokens(t *testing.T) {
	huge := `{"step_index":3,"type":"GENERIC","status":"DONE","created_at":"` + localTS("2026-10-06", "09:00:07") + `","content":"` + strings.Repeat("x", 2<<20) + `"}`
	lines := []string{
		`{"type":"GENERIC","created_at":"` + localTS("2026-10-06", "09:00:00") + `","input_tokens":5}`,
		`{"type":"USER_INPUT","created_at":"` + localTS("2026-10-06", "09:00:00") + `","input_tokens":5}`,
		`{"type":"SOME_FUTURE_TYPE","created_at":"` + localTS("2026-10-06", "09:00:00") + `","input_tokens":5}`,
		`{"type":"PLANNER_RESPONSE","created_at":"` + localTS("2026-10-06", "09:00:00") + `","content":"no token fields"}`,
		`{"type":"PLANNER_RESPONSE","created_at":"not a time","input_tokens":5}`,
		huge,
		`not json at all`,
		agyPlanner(localTS("2026-10-06", "09:00:05"), 7, 0, 0)[:60], // truncated last line
	}
	if recs := extractAgy(lines); len(recs) != 0 {
		t.Fatalf("want nothing, got %+v", recs)
	}
}

func TestAgyIsTranscriptPath(t *testing.T) {
	yes := []string{
		"/Users/x/.gemini/antigravity-cli/brain/abc-123/.system_generated/logs/transcript_full.jsonl",
		`C:\Users\x\.gemini\antigravity-cli\brain\abc-123\.system_generated\logs\transcript_full.jsonl`,
	}
	no := []string{
		"/Users/x/.gemini/antigravity-cli/brain/abc-123/.system_generated/logs/transcript.jsonl",
		"/Users/x/.gemini/other/brain/abc-123/.system_generated/logs/transcript_full.jsonl",
		"/Users/x/.claude/projects/p/transcript_full.jsonl",
		"",
	}
	for _, p := range yes {
		if !isAgyTranscriptPath(p) {
			t.Errorf("isAgyTranscriptPath(%q) = false; want true", p)
		}
	}
	for _, p := range no {
		if isAgyTranscriptPath(p) {
			t.Errorf("isAgyTranscriptPath(%q) = true; want false", p)
		}
	}
}

func writeAgyTranscript(t *testing.T, root, id string, lines ...string) string {
	t.Helper()
	dir := filepath.Join(root, id, ".system_generated", "logs")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "transcript_full.jsonl")
	if err := os.WriteFile(path, []byte(strings.Join(lines, "\n")+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestScanRootsIncludesAgy(t *testing.T) {
	dir := t.TempDir()
	agyRoot := filepath.Join(dir, ".gemini", "antigravity-cli", "brain")
	writeAgyTranscript(t, agyRoot, "conv-1", agyPlanner(time.Now().Format(time.RFC3339), 11, 2, 3))
	writeAgyTranscript(t, agyRoot, "conv-2", agyPlanner(time.Now().Format(time.RFC3339), 20, 4, 5))
	// a sibling that is not a transcript_full.jsonl must never be read
	lossy := filepath.Join(agyRoot, "conv-1", ".system_generated", "logs", "transcript.jsonl")
	if err := os.WriteFile(lossy, []byte(agyPlanner(time.Now().Format(time.RFC3339), 999, 999, 999)+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	got := scanRoots(filepath.Join(dir, "claude-missing"), filepath.Join(dir, "codex-missing"), filepath.Join(dir, "opencode-missing"), filepath.Join(dir, "pi-missing"), agyRoot, 7)
	if len(got) != 1 {
		t.Fatalf("want 1 agy bucket, got %+v", got)
	}
	if b := got[0]; b.Harness != "agy" || b.Provider != "agy" || b.Model != "" || b.Input != 31 || b.Output != 6 || b.CacheRead != 8 || b.Msgs != 2 {
		t.Errorf("agy bucket = %+v", b)
	}

	// a transcript last written before the window is pruned unread
	old := time.Now().AddDate(0, 0, -30)
	stale := writeAgyTranscript(t, agyRoot, "conv-old", agyPlanner(old.Format(time.RFC3339), 500, 0, 0))
	if err := os.Chtimes(stale, old, old); err != nil {
		t.Fatal(err)
	}
	got = scanRoots(filepath.Join(dir, "claude-missing"), filepath.Join(dir, "codex-missing"), filepath.Join(dir, "opencode-missing"), filepath.Join(dir, "pi-missing"), agyRoot, 7)
	if len(got) != 1 || got[0].Input != 31 {
		t.Errorf("windowed scan = %+v; want only the two fresh conversations", got)
	}
}

func TestTranscriptUsageAndSumTranscriptCountAgy(t *testing.T) {
	root := filepath.Join(t.TempDir(), ".gemini", "antigravity-cli", "brain")
	path := writeAgyTranscript(t, root, "conv-1",
		`{"type":"USER_INPUT","created_at":"`+localTS("2026-10-06", "09:00:00")+`","content":"x"}`,
		agyPlanner(localTS("2026-10-06", "09:00:05"), 100, 10, 50),
		`{"type":"GENERIC","created_at":"`+localTS("2026-10-06", "09:00:06")+`","content":"`+strings.Repeat("x", 2<<20)+`"}`,
		agyPlanner(localTS("2026-10-07", "09:00:05"), 200, 20, 150),
		agyPlanner(localTS("2026-10-07", "09:00:09"), 999, 99, 99)[:70], // truncated last line
	)
	buckets, err := TranscriptUsage(path)
	if err != nil || len(buckets) != 2 {
		t.Fatalf("TranscriptUsage = %+v, %v; want 2 day buckets", buckets, err)
	}
	for _, b := range buckets {
		if b.Harness != "agy" || b.Provider != "agy" {
			t.Errorf("bucket %+v is not agy's", b)
		}
	}
	total, err := SumTranscript(path)
	if err != nil || total != 100+10+50+200+20+150 {
		t.Errorf("SumTranscript = %d, %v; want 530", total, err)
	}
}
