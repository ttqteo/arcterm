// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pi usage aggregation tests: every billed native entry becomes a usagestats.Record with harness
// "pi", separate provider/model, normalized reasoning (a subset of output), cache metadata, and
// reported cost. Abandoned branches stay billed while the transcript projection hides them (Task 7).
package usagestats

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/pisession"
)

// piFixture is one Pi v3 session carrying an active assistant, an abandoned assistant, a
// tool-result, a compaction, and a branch-summary — the five usage sources the extractor must bill.
// Message entries carry usage nested inside the message payload (entry.message.usage, the real pi
// shape); compaction/branch_summary carry it top-level. The final record is intentionally not
// newline-terminated (a live partial write) yet well-formed, so pisession keeps it.
const piFixture = `{"type":"session","version":3,"id":"s1","timestamp":"2026-08-11T03:00:00Z","cwd":"C:\\repo"}` + "\n" +
	`{"type":"model_change","id":"mc1","parentId":null,"timestamp":"2026-08-11T03:00:01Z","provider":"openai-codex","modelId":"gpt-5.5"}` + "\n" +
	`{"type":"message","id":"u1","parentId":null,"timestamp":"2026-08-11T03:00:02Z","message":{"role":"user","content":"implement it"}}` + "\n" +
	`{"type":"message","id":"a1","parentId":"u1","timestamp":"2026-08-11T03:00:03Z","message":{"role":"assistant","content":"active answer","usage":{"input":100,"output":50,"reasoning":20,"cacheRead":10,"cacheWrite":5,"cacheWrite1h":3,"totalTokens":165,"cost":{"input":0.004,"output":0.003,"cacheRead":0.001,"cacheWrite":0.002,"total":0.01}}}}` + "\n" +
	`{"type":"message","id":"ab1","parentId":"u1","timestamp":"2026-08-11T03:00:04Z","message":{"role":"assistant","content":"abandoned answer","usage":{"input":40,"output":12,"reasoning":4,"cacheRead":0,"cacheWrite":2,"totalTokens":54,"cost":{"total":0.005}}}}` + "\n" +
	`{"type":"message","id":"t1","parentId":"a1","timestamp":"2026-08-11T03:00:05Z","message":{"role":"toolResult","content":"ls output","usage":{"input":5,"output":8,"reasoning":0,"cacheRead":0,"cacheWrite":0,"totalTokens":13,"cost":{"total":0.001}}}}` + "\n" +
	`{"type":"compaction","id":"c1","parentId":"t1","timestamp":"2026-08-11T03:01:00Z","usage":{"input":300,"output":1,"reasoning":0,"cacheRead":200,"cacheWrite":0,"totalTokens":501,"cost":{"total":0.05}}}` + "\n" +
	`{"type":"branch_summary","id":"bs1","parentId":"c1","timestamp":"2026-08-11T03:02:00Z","usage":{"input":15,"output":3,"reasoning":1,"cacheRead":0,"cacheWrite":0,"totalTokens":18,"cost":{"total":0.002}}}`

func parsePiFixture(t *testing.T, content string) *pisession.File {
	t.Helper()
	file, err := pisession.Parse("pi.jsonl", []byte(content))
	if err != nil {
		t.Fatalf("pisession.Parse: %v", err)
	}
	return file
}

func recordByTS(records []Record, ts time.Time) Record {
	for _, r := range records {
		if r.TS.Equal(ts) {
			return r
		}
	}
	return Record{}
}

// The whole fixture bills all five usage sources, with the active assistant carrying the exact
// normalized classes from the brief. The user message and model_change produce no records.
func TestExtractPi_OneFixtureBillsAllSources(t *testing.T) {
	native := &pisession.Usage{
		Input: 100, Output: 50, Reasoning: 20,
		CacheRead: 10, CacheWrite: 5, CacheWrite1h: 3,
		TotalTokens: 165, Cost: pisession.Cost{Total: 0.01},
	}
	records := extractPi(parsePiFixture(t, piFixture), time.Time{})
	if len(records) != 5 {
		t.Fatalf("want 5 billing records, got %d: %+v", len(records), records)
	}
	for _, r := range records {
		if r.Harness != "pi" {
			t.Errorf("harness = %q, want pi", r.Harness)
		}
	}
	active := recordByTS(records, time.Date(2026, 8, 11, 3, 0, 3, 0, time.UTC))
	if active.Provider != "openai-codex" || active.Model != "gpt-5.5" {
		t.Errorf("active provider/model = %q/%q, want openai-codex/gpt-5.5", active.Provider, active.Model)
	}
	if active.Input != native.Input {
		t.Errorf("active input = %d, want %d", active.Input, native.Input)
	}
	if active.Output != native.Output-native.Reasoning {
		t.Errorf("active output = %d, want %d (native.Output-native.Reasoning)", active.Output, native.Output-native.Reasoning)
	}
	if active.Reasoning != native.Reasoning {
		t.Errorf("active reasoning = %d, want %d", active.Reasoning, native.Reasoning)
	}
	if active.CacheRead != native.CacheRead {
		t.Errorf("active cacheRead = %d, want %d", active.CacheRead, native.CacheRead)
	}
	if active.CacheCreate != native.CacheWrite {
		t.Errorf("active cacheCreate = %d, want %d (native.CacheWrite)", active.CacheCreate, native.CacheWrite)
	}
	if active.CacheCreate1h != native.CacheWrite1h {
		t.Errorf("active cacheCreate1h = %d, want %d (native.CacheWrite1h)", active.CacheCreate1h, native.CacheWrite1h)
	}
	if active.ReportedCostUsd == nil || *active.ReportedCostUsd != native.Cost.Total {
		t.Errorf("active reported cost = %#v, want present %g", active.ReportedCostUsd, native.Cost.Total)
	}

	// abandoned assistant stays billed (tokens were consumed even off the active branch)
	abandoned := recordByTS(records, time.Date(2026, 8, 11, 3, 0, 4, 0, time.UTC))
	if abandoned.Output != 8 || abandoned.Reasoning != 4 {
		t.Errorf("abandoned output/reasoning = %d/%d, want 8/4", abandoned.Output, abandoned.Reasoning)
	}

	// tool-result, compaction, branch-summary each bill with the tracked provider/model
	for _, ts := range []time.Time{
		time.Date(2026, 8, 11, 3, 0, 5, 0, time.UTC),
		time.Date(2026, 8, 11, 3, 1, 0, 0, time.UTC),
		time.Date(2026, 8, 11, 3, 2, 0, 0, time.UTC),
	} {
		r := recordByTS(records, ts)
		if r.Provider != "openai-codex" || r.Model != "gpt-5.5" {
			t.Errorf("record at %v provider/model = %q/%q, want tracked openai-codex/gpt-5.5", ts, r.Provider, r.Model)
		}
	}
}

// model_change entries drive the tracked provider/model for records that carry none of their own —
// real pi message entries carry neither, so the tracking comes from the model_change stream.
func TestExtractPi_TracksProviderModelFromModelChange(t *testing.T) {
	content := `{"type":"session","version":3,"id":"s2","timestamp":"2026-08-11T03:00:00Z","cwd":"C:\\repo"}` + "\n" +
		`{"type":"model_change","id":"mc1","parentId":null,"timestamp":"2026-08-11T03:00:01Z","provider":"openai-codex","modelId":"gpt-5.5"}` + "\n" +
		`{"type":"message","id":"a1","parentId":null,"timestamp":"2026-08-11T03:00:02Z","message":{"role":"assistant","content":"x","usage":{"input":10,"output":5,"reasoning":1,"cacheRead":0,"cacheWrite":0,"totalTokens":14,"cost":{"total":0}}}}` + "\n" +
		`{"type":"message","id":"t1","parentId":"a1","timestamp":"2026-08-11T03:00:03Z","message":{"role":"toolResult","content":"out","usage":{"input":1,"output":1,"reasoning":0,"cacheRead":0,"cacheWrite":0,"totalTokens":2,"cost":{"total":0}}}}` + "\n" +
		`{"type":"model_change","id":"mc2","parentId":"t1","timestamp":"2026-08-11T03:00:04Z","provider":"anthropic","modelId":"claude-sonnet-4-6"}` + "\n" +
		`{"type":"compaction","id":"c1","parentId":"t1","timestamp":"2026-08-11T03:00:05Z","usage":{"input":2,"output":2,"reasoning":0,"cacheRead":0,"cacheWrite":0,"totalTokens":4,"cost":{"total":0}}}`
	records := extractPi(parsePiFixture(t, content), time.Time{})
	if len(records) != 3 {
		t.Fatalf("want 3 records, got %d: %+v", len(records), records)
	}
	a := recordByTS(records, time.Date(2026, 8, 11, 3, 0, 2, 0, time.UTC))
	if a.Provider != "openai-codex" || a.Model != "gpt-5.5" {
		t.Errorf("assistant provider/model = %q/%q", a.Provider, a.Model)
	}
	tr := recordByTS(records, time.Date(2026, 8, 11, 3, 0, 3, 0, time.UTC))
	if tr.Provider != "openai-codex" || tr.Model != "gpt-5.5" {
		t.Errorf("tool-result provider/model = %q/%q, want inherited openai-codex/gpt-5.5", tr.Provider, tr.Model)
	}
	c := recordByTS(records, time.Date(2026, 8, 11, 3, 0, 5, 0, time.UTC))
	if c.Provider != "anthropic" || c.Model != "claude-sonnet-4-6" {
		t.Errorf("compaction provider/model = %q/%q, want the post-switch anthropic/claude-sonnet-4-6", c.Provider, c.Model)
	}
}

// Buckets keep provider, model, and local day separate for Pi records, like every other harness.
func TestExtractPiBucketsSeparateProviderModelAndDay(t *testing.T) {
	content := `{"type":"session","version":3,"id":"s3","timestamp":"2026-08-11T03:00:00Z","cwd":"C:\\repo"}` + "\n" +
		`{"type":"model_change","id":"mc1","parentId":null,"timestamp":"2026-08-11T03:00:01Z","provider":"openai-codex","modelId":"gpt-5.5"}` + "\n" +
		`{"type":"message","id":"a1","parentId":null,"timestamp":"2026-08-11T03:00:03Z","message":{"role":"assistant","content":"x","usage":{"input":10,"output":5,"reasoning":1,"cacheRead":0,"cacheWrite":0,"totalTokens":14,"cost":{"total":0}}}}` + "\n" +
		`{"type":"model_change","id":"mc2","parentId":"a1","timestamp":"2026-08-11T03:10:00Z","provider":"anthropic","modelId":"claude-sonnet-4-6"}` + "\n" +
		`{"type":"message","id":"a2","parentId":"a1","timestamp":"2026-08-12T03:00:00Z","message":{"role":"assistant","content":"y","usage":{"input":20,"output":6,"reasoning":2,"cacheRead":0,"cacheWrite":0,"totalTokens":24,"cost":{"total":0}}}}`
	got := bucket(extractPi(parsePiFixture(t, content), time.Time{}))
	if len(got) != 2 {
		t.Fatalf("want 2 buckets, got %d: %+v", len(got), got)
	}
	byModel := map[string]Bucket{}
	for _, b := range got {
		byModel[b.Model] = b
	}
	if b := byModel["gpt-5.5"]; b.Provider != "openai-codex" || b.Input != 10 || b.Msgs != 1 {
		t.Errorf("gpt-5.5 bucket = %+v", b)
	}
	if b := byModel["claude-sonnet-4-6"]; b.Provider != "anthropic" || b.Input != 20 || b.Msgs != 1 {
		t.Errorf("claude-sonnet bucket = %+v", b)
	}
	if byModel["gpt-5.5"].Day == byModel["claude-sonnet-4-6"].Day {
		t.Errorf("days must differ, both %q", byModel["gpt-5.5"].Day)
	}
}

// The entry timestamp is the window: records before the cutoff are dropped, at/after kept.
func TestExtractPi_FiltersByEntryTimestamp(t *testing.T) {
	records := extractPi(parsePiFixture(t, piFixture), time.Date(2026, 8, 11, 3, 0, 4, 500, time.UTC))
	if len(records) != 3 {
		t.Fatalf("want 3 records at/after cutoff, got %d: %+v", len(records), records)
	}
	// the earliest kept is the 03:00:05 tool-result
	if !records[0].TS.Equal(time.Date(2026, 8, 11, 3, 0, 5, 0, time.UTC)) {
		t.Errorf("first record ts = %v, want 03:00:05", records[0].TS)
	}
}

// walkPiFiles collects native Pi sessions under a root (recursively, through encoded-cwd dirs)
// and tags each for the Pi parser.
func TestWalkPiFiles(t *testing.T) {
	sessions := filepath.Join(t.TempDir(), "pi", "agent", "sessions")
	if err := os.MkdirAll(filepath.Join(sessions, "proj"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sessions, "proj", "s.jsonl"), []byte(piFixture), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sessions, "proj", "ignore.txt"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	files := walkPiFiles(sessions, time.Time{})
	if len(files) != 1 {
		t.Fatalf("want 1 pi scanFile, got %d: %+v", len(files), files)
	}
	if files[0].kind != scanPi || filepath.Base(files[0].path) != "s.jsonl" {
		t.Errorf("scanFile = %+v", files[0])
	}
}

// a session last written before the window cannot hold an entry inside it, so the walk skips it
// unread; one written inside the window is kept.
func TestWalkPiFilesSkipsSessionsLastWrittenBeforeTheWindow(t *testing.T) {
	sessions := t.TempDir()
	cutoff := time.Now().AddDate(0, 0, -7)
	for name, mod := range map[string]time.Time{
		"stale.jsonl": cutoff.Add(-time.Hour),
		"fresh.jsonl": cutoff.Add(time.Hour),
	} {
		path := filepath.Join(sessions, name)
		if err := os.WriteFile(path, []byte(piFixture), 0o644); err != nil {
			t.Fatal(err)
		}
		if err := os.Chtimes(path, mod, mod); err != nil {
			t.Fatal(err)
		}
	}
	files := walkPiFiles(sessions, cutoff)
	if len(files) != 1 || filepath.Base(files[0].path) != "fresh.jsonl" {
		t.Fatalf("want only fresh.jsonl, got %+v", files)
	}
}

// TranscriptUsage routes a /.pi/agent/sessions/ path to the Pi parser (before the Claude/Codex
// heuristics), producing one per-(provider,model,day) bucket that sums every billed record.
func TestTranscriptUsageRoutesPiPath(t *testing.T) {
	path := filepath.Join(t.TempDir(), ".pi", "agent", "sessions", "proj", "s.jsonl")
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(piFixture+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	got, err := TranscriptUsage(path)
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("want 1 bucket, got %d: %+v", len(got), got)
	}
	b := got[0]
	if b.Harness != "pi" || b.Provider != "openai-codex" || b.Model != "gpt-5.5" {
		t.Errorf("bucket identity = %#v", b)
	}
	if b.Input != 100+40+5+300+15 || b.Output != 30+8+8+1+2 || b.Reasoning != 20+4+1 || b.CacheRead != 10+200 || b.CacheCreate != 5+2 || b.CacheCreate1h != 3 || b.Msgs != 5 {
		t.Errorf("bucket = %#v", b)
	}
	if b.ReportedCostUsd == nil || *b.ReportedCostUsd != 0.01+0.005+0.001+0.05+0.002 {
		t.Errorf("reported cost = %#v, want 0.068", b.ReportedCostUsd)
	}

	// SumTranscript totals Input+Output+Reasoning+CacheRead+CacheCreate; CacheCreate1h is metadata
	// inside CacheCreate and is not added separately.
	sum, err := SumTranscript(path)
	if err != nil || sum != 165+54+13+501+18 {
		t.Fatalf("sum = %d, err = %v; want 751", sum, err)
	}
}

// A truncated final record (live partial write) is dropped by pisession while every complete record
// still bills, and the whole read still routes through the Pi parser.
func TestTranscriptUsagePiPartialFinalRecord(t *testing.T) {
	path := filepath.Join(t.TempDir(), ".pi", "agent", "sessions", "proj", "s.jsonl")
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	content := `{"type":"session","version":3,"id":"s1","timestamp":"2026-08-11T03:00:00Z","cwd":"C:\\repo"}` + "\n" +
		`{"type":"model_change","id":"mc1","parentId":null,"timestamp":"2026-08-11T03:00:01Z","provider":"openai-codex","modelId":"gpt-5.5"}` + "\n" +
		`{"type":"message","id":"a1","parentId":null,"timestamp":"2026-08-11T03:00:03Z","message":{"role":"assistant","content":"x","usage":{"input":10,"output":5,"reasoning":1,"cacheRead":0,"cacheWrite":0,"totalTokens":14,"cost":{"total":0}}}}` + "\n" +
		`{"type":"message","id":"half"`
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	got, err := TranscriptUsage(path)
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("want 1 bucket, got %d: %+v", len(got), got)
	}
	if got[0].Harness != "pi" || got[0].Input != 10 || got[0].Output != 4 || got[0].Reasoning != 1 || got[0].Msgs != 1 {
		t.Errorf("bucket = %#v", got[0])
	}
}

// A pi-shaped file outside /.pi/agent/sessions/ must not route to the Pi parser — it falls to the
// Claude/Codex heuristics and yields nothing, mirroring the opencode-shadow negative test.
func TestTranscriptUsageIgnoresPiRecordsOutsidePiRoot(t *testing.T) {
	path := filepath.Join(t.TempDir(), "misc", "s.jsonl")
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(piFixture+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	got, err := TranscriptUsage(path)
	if err != nil || got != nil {
		t.Fatalf("non-pi-root usage file = %+v, err = %v; want nil/nil", got, err)
	}
}

// scanRoots now includes the Pi root: a windowed scan picks up a fresh Pi session alongside Claude,
// and buckets the two harnesses separately.
func TestScanRootsIncludesPi(t *testing.T) {
	dir := t.TempDir()
	claude := filepath.Join(dir, "claude")
	if err := os.MkdirAll(claude, 0o755); err != nil {
		t.Fatal(err)
	}
	claudeLine := `{"type":"assistant","timestamp":"2026-08-11T10:00:00.000Z","requestId":"r1","message":{"id":"m1","model":"claude-opus-4-8","usage":{"input_tokens":100,"output_tokens":50}}}` + "\n"
	if err := os.WriteFile(filepath.Join(claude, "s.jsonl"), []byte(claudeLine), 0o644); err != nil {
		t.Fatal(err)
	}
	piRoot := filepath.Join(dir, "pi", "agent", "sessions")
	if err := os.MkdirAll(piRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(piRoot, "s.jsonl"), []byte(piFixture+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	got := scanRoots(claude, filepath.Join(dir, "codex-missing"), filepath.Join(dir, "opencode-missing"), piRoot, filepath.Join(dir, "agy-missing"), 0)
	if len(got) != 2 {
		t.Fatalf("want 2 buckets (claude + pi), got %d: %+v", len(got), got)
	}
	byHarness := map[string]Bucket{}
	for _, b := range got {
		byHarness[b.Harness] = b
	}
	if b := byHarness["claude"]; b.Model != "claude-opus-4-8" || b.Input != 100 {
		t.Errorf("claude bucket = %+v", b)
	}
	if b := byHarness["pi"]; b.Provider != "openai-codex" || b.Model != "gpt-5.5" || b.Msgs != 5 {
		t.Errorf("pi bucket = %+v", b)
	}
}

// pi-subagents writes a parent's child sessions under <parent-without-.jsonl>/<runId>/run-<idx>/session.jsonl
// (its child-session root). TranscriptUsage must fold those in exactly like Claude's subagents dir —
// the rail's per-session total would otherwise under-report any pi session that fanned out. A run dir's
// non-session jsonl (events/status logs) must be skipped, and a parent that spawned no children yields
// just its own records.
func TestTranscriptUsageFoldsPiSubagentSessions(t *testing.T) {
	dir := filepath.Join(t.TempDir(), ".pi", "agent", "sessions", "proj")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}

	// Parent pi session: one assistant turn (nested message.usage), openai-codex/gpt-5.5.
	parent := filepath.Join(dir, "parent.jsonl")
	parentContent := `{"type":"session","version":3,"id":"p1","timestamp":"2026-08-11T03:00:00Z","cwd":"C:\repo"}` + "\n" +
		`{"type":"model_change","id":"pmc","parentId":null,"timestamp":"2026-08-11T03:00:01Z","provider":"openai-codex","modelId":"gpt-5.5"}` + "\n" +
		`{"type":"message","id":"pa1","parentId":null,"timestamp":"2026-08-11T03:00:02Z","message":{"role":"assistant","content":"x","usage":{"input":100,"output":50,"totalTokens":150,"cost":{"total":0.01}}}}` + "\n"
	if err := os.WriteFile(parent, []byte(parentContent), 0o644); err != nil {
		t.Fatal(err)
	}

	// Child session in the pi-subagents layout, same model+day (merges into one bucket).
	childDir := filepath.Join(dir, "parent", "runAbc", "run-0")
	if err := os.MkdirAll(childDir, 0o755); err != nil {
		t.Fatal(err)
	}
	childContent := `{"type":"session","version":3,"id":"c1","timestamp":"2026-08-11T03:05:00Z","cwd":"C:\repo"}` + "\n" +
		`{"type":"model_change","id":"cmc","parentId":null,"timestamp":"2026-08-11T03:05:01Z","provider":"openai-codex","modelId":"gpt-5.5"}` + "\n" +
		`{"type":"message","id":"ca1","parentId":null,"timestamp":"2026-08-11T03:05:02Z","message":{"role":"assistant","content":"y","usage":{"input":30,"output":8,"totalTokens":38,"cost":{"total":0.002}}}}` + "\n"
	if err := os.WriteFile(filepath.Join(childDir, "session.jsonl"), []byte(childContent), 0o644); err != nil {
		t.Fatal(err)
	}

	// A parallel child (run-1) on a different model, and a nested child of the first child (its own
	// child-session root at run-0/session/...) — the recursive walk must include both.
	parDir := filepath.Join(dir, "parent", "runDef", "run-1")
	if err := os.MkdirAll(parDir, 0o755); err != nil {
		t.Fatal(err)
	}
	parContent := `{"type":"session","version":3,"id":"c2","timestamp":"2026-08-11T03:06:00Z","cwd":"C:\repo"}` + "\n" +
		`{"type":"model_change","id":"cmc2","parentId":null,"timestamp":"2026-08-11T03:06:01Z","provider":"anthropic","modelId":"claude-sonnet-4-6"}` + "\n" +
		`{"type":"message","id":"ca2","parentId":null,"timestamp":"2026-08-11T03:06:02Z","message":{"role":"assistant","content":"z","usage":{"input":15,"output":3,"totalTokens":18,"cost":{"total":0.001}}}}` + "\n"
	if err := os.WriteFile(filepath.Join(parDir, "session.jsonl"), []byte(parContent), 0o644); err != nil {
		t.Fatal(err)
	}
	nestedDir := filepath.Join(childDir, "session", "runNest", "run-0")
	if err := os.MkdirAll(nestedDir, 0o755); err != nil {
		t.Fatal(err)
	}
	nestedContent := `{"type":"session","version":3,"id":"c3","timestamp":"2026-08-11T03:07:00Z","cwd":"C:\repo"}` + "\n" +
		`{"type":"model_change","id":"cmc3","parentId":null,"timestamp":"2026-08-11T03:07:01Z","provider":"openai-codex","modelId":"gpt-5.5"}` + "\n" +
		`{"type":"message","id":"ca3","parentId":null,"timestamp":"2026-08-11T03:07:02Z","message":{"role":"assistant","content":"w","usage":{"input":5,"output":1,"totalTokens":6,"cost":{"total":0}}}}` + "\n"
	if err := os.WriteFile(filepath.Join(nestedDir, "session.jsonl"), []byte(nestedContent), 0o644); err != nil {
		t.Fatal(err)
	}

	// A run dir can hold non-session jsonl (status/events logs) — never a bucket.
	if err := os.WriteFile(filepath.Join(childDir, "events.jsonl"), []byte(`{"type":"status","id":"s1"}`+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	got, err := TranscriptUsage(parent)
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	byModel := map[string]Bucket{}
	for _, b := range got {
		byModel[b.Model] = b
	}
	if len(got) != 2 {
		t.Fatalf("want 2 buckets (gpt-5.5 merged, claude-sonnet), got %d: %+v", len(got), got)
	}
	// parent (100/50) + child (30/8) + nested (5/1) share model+day → one merged bucket.
	if b := byModel["gpt-5.5"]; b.Provider != "openai-codex" || b.Input != 135 || b.Output != 59 || b.Msgs != 3 {
		t.Errorf("gpt-5.5 bucket = %+v, want input=135 output=59 msgs=3", b)
	}
	if b := byModel["claude-sonnet-4-6"]; b.Provider != "anthropic" || b.Input != 15 || b.Output != 3 || b.Msgs != 1 {
		t.Errorf("claude-sonnet bucket = %+v", b)
	}

	// SumTranscript folds parent + all children: 150 + 38 + 18 + 6 = 212.
	sum, err := SumTranscript(parent)
	if err != nil || sum != 212 {
		t.Fatalf("sum = %d, err = %v; want 212", sum, err)
	}
}

// A pi session that spawned no subagents has no child-session root: TranscriptUsage must yield its
// own records unchanged (the sibling <stem>/ dir missing is not an error).
func TestTranscriptUsagePiNoSubagents(t *testing.T) {
	dir := filepath.Join(t.TempDir(), ".pi", "agent", "sessions", "proj")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	parent := filepath.Join(dir, "parent.jsonl")
	content := `{"type":"session","version":3,"id":"p1","timestamp":"2026-08-11T03:00:00Z","cwd":"C:\repo"}` + "\n" +
		`{"type":"model_change","id":"pmc","parentId":null,"timestamp":"2026-08-11T03:00:01Z","provider":"openai-codex","modelId":"gpt-5.5"}` + "\n" +
		`{"type":"message","id":"pa1","parentId":null,"timestamp":"2026-08-11T03:00:02Z","message":{"role":"assistant","content":"x","usage":{"input":100,"output":50,"totalTokens":150,"cost":{"total":0.01}}}}` + "\n"
	if err := os.WriteFile(parent, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	// a same-stem FILE (not dir) must not confuse the walk
	if err := os.WriteFile(filepath.Join(dir, "parent.extra.jsonl"), []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	got, err := TranscriptUsage(parent)
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if len(got) != 1 || got[0].Input != 100 || got[0].Output != 50 || got[0].Msgs != 1 {
		t.Fatalf("buckets = %+v, want the parent's single 100/50 bucket", got)
	}
}
