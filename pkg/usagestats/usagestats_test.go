package usagestats

import (
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/agentobserve"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

func TestExtractClaude(t *testing.T) {
	line := `{"type":"assistant","timestamp":"2026-06-26T10:00:00.000Z","requestId":"req_1","message":{"id":"msg_1","model":"claude-opus-4-8","usage":{"input_tokens":100,"output_tokens":50,"cache_read_input_tokens":1000,"cache_creation_input_tokens":200,"cache_creation":{"ephemeral_1h_input_tokens":150}}}}`
	got := extractClaude([]string{line})
	if len(got) != 1 {
		t.Fatalf("want 1 record, got %d", len(got))
	}
	r := got[0]
	if r.Harness != "claude" || r.Provider != "anthropic" || r.Model != "claude-opus-4-8" {
		t.Errorf("harness/provider/model = %q/%q/%q", r.Harness, r.Provider, r.Model)
	}
	if r.Input != 100 || r.Output != 50 || r.CacheRead != 1000 || r.CacheCreate != 200 || r.CacheCreate1h != 150 {
		t.Errorf("tokens = %+v", r)
	}
	if r.ID != "msg_1:req_1" {
		t.Errorf("id = %q", r.ID)
	}
	if !r.TS.Equal(time.Date(2026, 6, 26, 10, 0, 0, 0, time.UTC)) {
		t.Errorf("ts = %v", r.TS)
	}
}

func TestExtractClaudeSkips(t *testing.T) {
	cases := []string{
		`{"type":"user","message":{}}`, // non-assistant
		`{not json`,                    // malformed
		`{"type":"assistant","message":{"model":"claude-opus-4"}}`, // no usage/timestamp
	}
	if got := extractClaude(cases); len(got) != 0 {
		t.Fatalf("want 0, got %d", len(got))
	}
}

func TestFilterUsageLines(t *testing.T) {
	in := []string{
		`{"type":"assistant","message":{"usage":{"input_tokens":1}}}`,   // kept
		`{"type":"user","message":{}}`,                                  // dropped
		`{"payload":{"info":{"total_token_usage":{"input_tokens":9}}}}`, // Codex: dropped (no "usage" match)
	}
	orig := append([]string(nil), in...) // snapshot to assert non-destructiveness
	got := filterUsageLines(in)
	if len(got) != 1 || got[0] != in[0] {
		t.Fatalf("want only the assistant-usage line, got %+v", got)
	}
	for i := range orig {
		if in[i] != orig[i] {
			t.Fatalf("filterUsageLines mutated its input at %d: %q != %q", i, in[i], orig[i])
		}
	}
}

func TestReadClaudeLinesKeepsOnlyUsageLines(t *testing.T) {
	usage := `{"type":"assistant","message":{"usage":{"input_tokens":1}}}`
	long := `{"type":"assistant","message":{"usage":{}},"pad":"` + strings.Repeat("x", 200_000) + `"}` // past the scanner's default 64 KB line cap
	path := filepath.Join(t.TempDir(), "t.jsonl")
	body := strings.Join([]string{
		usage,
		`{"type":"user","message":{}}`, // dropped
		`{"payload":{"info":{"total_token_usage":{"input_tokens":9}}}}`, // Codex: dropped (no "usage" match)
		"   ",
		long, // no trailing newline
	}, "\r\n")
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := readClaudeLines(path); !slices.Equal(got, []string{usage, long}) {
		t.Fatalf("want the two usage lines, got %d lines", len(got))
	}
	if got := readLines(path); len(got) != 4 {
		t.Fatalf("readLines: want the 4 non-blank lines, got %d", len(got))
	}
}

func TestExtractClaudeNoDedupKeyWhenMissing(t *testing.T) {
	line := `{"type":"assistant","timestamp":"2026-06-26T10:00:00.000Z","message":{"id":"msg_1","model":"claude-opus-4","usage":{"output_tokens":5}}}`
	got := extractClaude([]string{line})
	if got[0].ID != "" {
		t.Errorf("want empty id, got %q", got[0].ID)
	}
}

func TestExtractorsSetHarnessAndProvider(t *testing.T) {
	claude := extractClaude([]string{`{"type":"assistant","timestamp":"2026-08-10T10:00:00Z","requestId":"r1","message":{"id":"m1","model":"claude-opus-4-1","usage":{"input_tokens":1}}}`})
	if len(claude) != 1 || claude[0].Harness != "claude" || claude[0].Provider != "anthropic" {
		t.Fatalf("claude identity = %#v", claude)
	}

	codex := extractCodex([]string{
		`{"type":"turn_context","payload":{"model":"gpt-5-codex"}}`,
		`{"type":"event_msg","timestamp":"2026-08-10T10:00:00Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":2,"output_tokens":3,"total_tokens":5}}}}`,
	})
	if len(codex) != 1 || codex[0].Harness != "codex" || codex[0].Provider != "openai" {
		t.Fatalf("codex identity = %#v", codex)
	}
}

func TestBucketSeparatesHarnessProviderModelAndDay(t *testing.T) {
	ts := time.Date(2026, 8, 10, 12, 0, 0, 0, time.Local)
	records := []Record{
		{TS: ts, Harness: "claude", Provider: "anthropic", Model: "opus", Input: 1},
		{TS: ts, Harness: "opencode", Provider: "anthropic", Model: "opus", Input: 2},
		{TS: ts, Harness: "opencode", Provider: "openai", Model: "gpt-5.6-sol", Input: 3},
	}
	got := bucket(records)
	if len(got) != 3 {
		t.Fatalf("got %d buckets: %#v", len(got), got)
	}
}

func TestExtractOpencodeCurrentAssistantMessage(t *testing.T) {
	data := []byte(`{
		"id":"msg_1","role":"assistant",
		"time":{"created":1786356000000},
		"providerID":"openai","modelID":"gpt-5.6-sol","cost":0,
		"tokens":{"input":11,"output":12,"reasoning":13,"cache":{"read":14,"write":15}}
	}`)
	r, ok := extractOpencode(data)
	if !ok {
		t.Fatal("record was not extracted")
	}
	if r.Harness != "opencode" || r.Provider != "openai" || r.Model != "gpt-5.6-sol" {
		t.Fatalf("identity = %#v", r)
	}
	if r.Input != 11 || r.Output != 12 || r.Reasoning != 13 || r.CacheRead != 14 || r.CacheCreate != 15 {
		t.Fatalf("tokens = %#v", r)
	}
	if r.ReportedCostUsd == nil || *r.ReportedCostUsd != 0 {
		t.Fatalf("reported cost = %#v", r.ReportedCostUsd)
	}
}

func TestExtractOpencodeRejectsIncompleteMessages(t *testing.T) {
	cases := [][]byte{
		[]byte(`not json`),
		[]byte(`{"role":"user","time":{"created":1786356000000},"providerID":"openai","modelID":"gpt"}`),
		[]byte(`{"role":"assistant","time":{"created":1786356000000},"modelID":"gpt","tokens":{}}`),
		[]byte(`{"role":"assistant","time":{"created":1786356000000},"providerID":"openai","modelID":"gpt"}`),
	}
	for _, data := range cases {
		if _, ok := extractOpencode(data); ok {
			t.Fatalf("accepted %s", data)
		}
	}
}

func TestExtractCodex(t *testing.T) {
	turn := `{"timestamp":"2026-06-26T03:07:50.000Z","type":"turn_context","payload":{"model":"gpt-5.5"}}`
	count := `{"timestamp":"2026-06-26T03:08:00.663Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":9458,"cached_input_tokens":7040,"output_tokens":89,"total_tokens":9547}}}}`
	got := extractCodex([]string{turn, count})
	if len(got) != 1 {
		t.Fatalf("want 1, got %d", len(got))
	}
	r := got[0]
	if r.Harness != "codex" || r.Provider != "openai" || r.Model != "gpt-5.5" {
		t.Errorf("harness/provider/model = %q/%q/%q", r.Harness, r.Provider, r.Model)
	}
	if r.Input != 9458-7040 || r.CacheRead != 7040 || r.Output != 89 || r.CacheCreate != 0 {
		t.Errorf("tokens = %+v", r)
	}
	if total := r.Input + r.Output + r.CacheRead + r.CacheCreate; total != 9547 {
		t.Errorf("tokensOf = %d, want 9547", total)
	}
}

func TestExtractCodexMaxCumulative(t *testing.T) {
	turn := `{"type":"turn_context","payload":{"model":"gpt-5.5"}}`
	small := `{"timestamp":"2026-06-26T03:08:00.000Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":100,"output_tokens":10,"total_tokens":110}}}}`
	big := `{"timestamp":"2026-06-26T03:20:00.000Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":5000,"cached_input_tokens":1000,"output_tokens":500,"total_tokens":5500}}}}`
	got := extractCodex([]string{turn, small, big})
	if len(got) != 1 {
		t.Fatalf("want 1, got %d", len(got))
	}
	if total := got[0].Input + got[0].Output + got[0].CacheRead; total != 5500 {
		t.Errorf("want total 5500, got %d", total)
	}
}

func TestExtractCodexFallbackModelAndJunk(t *testing.T) {
	count := `{"timestamp":"2026-06-26T03:08:00.000Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":10,"output_tokens":1,"total_tokens":11}}}}`
	if got := extractCodex([]string{count}); got[0].Model != "codex" {
		t.Errorf("want fallback model codex, got %q", got[0].Model)
	}
	junk := []string{`{not json`, `{"type":"event_msg","payload":{"type":"token_count","info":null}}`, `{"type":"response_item","payload":{}}`}
	if got := extractCodex(junk); len(got) != 0 {
		t.Fatalf("want 0 from junk, got %d", len(got))
	}
}

func TestDedupe(t *testing.T) {
	mk := func(id string, out int) Record {
		return Record{ID: id, Provider: "claude", Model: "claude-opus-4", Input: 100, Output: out}
	}
	// same key -> keep max output
	got := dedupe([]Record{mk("k", 10), mk("k", 50), mk("k", 30)})
	if len(got) != 1 || got[0].Output != 50 {
		t.Fatalf("want 1 record out=50, got %+v", got)
	}
	// keyless records are all kept; distinct keys kept separate
	got = dedupe([]Record{mk("", 1), mk("", 2), mk("a", 1), mk("b", 1)})
	if len(got) != 4 {
		t.Fatalf("want 4, got %d", len(got))
	}
}

func TestBucketDropsSyntheticAndGroups(t *testing.T) {
	day := time.Date(2026, 6, 26, 10, 0, 0, 0, time.Local)
	recs := []Record{
		{Provider: "claude", Model: "claude-opus-4-8", TS: day, Input: 100, Output: 50},
		{Provider: "claude", Model: "claude-opus-4-8", TS: day, CacheRead: 10},
		{Provider: "claude", Model: "<synthetic>", TS: day, Output: 999},
	}
	got := bucket(recs)
	if len(got) != 1 {
		t.Fatalf("want 1 bucket (synthetic dropped, opus merged), got %d", len(got))
	}
	b := got[0]
	if b.Model != "claude-opus-4-8" || b.Input != 100 || b.Output != 50 || b.CacheRead != 10 || b.Msgs != 2 {
		t.Errorf("bucket = %+v", b)
	}
	if b.Day != day.Format("2006-01-02") {
		t.Errorf("day = %q", b.Day)
	}
}

func TestScanRootsPrunesByModtime(t *testing.T) {
	dir := t.TempDir()
	claude := filepath.Join(dir, "claude")
	proj := filepath.Join(claude, "proj")
	if err := os.MkdirAll(proj, 0o755); err != nil {
		t.Fatal(err)
	}
	line := `{"type":"assistant","timestamp":"` + time.Now().UTC().Format(time.RFC3339) + `","message":{"id":"m","model":"claude-haiku-4-5","usage":{"input_tokens":7}}}`
	fresh := filepath.Join(proj, "fresh.jsonl")
	stale := filepath.Join(proj, "stale.jsonl")
	for _, p := range []string{fresh, stale} {
		if err := os.WriteFile(p, []byte(line+"\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	old := time.Now().AddDate(0, 0, -30)
	if err := os.Chtimes(stale, old, old); err != nil {
		t.Fatal(err)
	}
	// window 7d (+1d margin) => stale (30d old) pruned, fresh kept
	got := scanRoots(claude, filepath.Join(dir, "codex-missing"), filepath.Join(dir, "opencode-missing"), filepath.Join(dir, "pi-missing"), 7)
	if len(got) != 1 || got[0].Model != "claude-haiku-4-5" {
		t.Fatalf("want 1 haiku bucket from fresh file only, got %+v", got)
	}
	// windowDays 0 => no prune => both files counted (2 msgs, same model/day bucket)
	all := scanRoots(claude, filepath.Join(dir, "codex-missing"), filepath.Join(dir, "opencode-missing"), filepath.Join(dir, "pi-missing"), 0)
	if len(all) != 1 || all[0].Msgs != 2 {
		t.Fatalf("want 1 bucket msgs=2 with no prune, got %+v", all)
	}
}

func TestScanRootsDropsTurnsBeforeWindowFromFreshTranscript(t *testing.T) {
	dir := t.TempDir()
	proj := filepath.Join(dir, "claude", "proj")
	if err := os.MkdirAll(proj, 0o755); err != nil {
		t.Fatal(err)
	}
	since := windowStart(time.Now(), 7)
	turn := func(id string, ts time.Time, input int) string {
		return `{"type":"assistant","timestamp":"` + ts.UTC().Format(time.RFC3339Nano) + `","message":{"id":"` + id +
			`","model":"claude-haiku-4-5","usage":{"input_tokens":` + fmt.Sprintf("%d", input) + `}}}` + "\n"
	}
	// one long-running session: written today, but its first turns are older than the window
	body := turn("old", time.Now().AddDate(0, 0, -20), 1) +
		turn("edge", since.Add(-time.Second), 10) +
		turn("first", since, 100) +
		turn("now", time.Now(), 1000)
	if err := os.WriteFile(filepath.Join(proj, "s.jsonl"), []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	got := scanRoots(filepath.Join(dir, "claude"), filepath.Join(dir, "codex-missing"), filepath.Join(dir, "opencode-missing"), filepath.Join(dir, "pi-missing"), 7)
	total := 0
	for _, b := range got {
		total += b.Input
	}
	if total != 1100 {
		t.Fatalf("want only the in-window turns (1100 input tokens), got %d from %+v", total, got)
	}
}

func TestSumTranscript(t *testing.T) {
	dir := t.TempDir()

	// Claude file: two assistant lines, second is a streaming re-emit of the first
	// (same message.id + requestId) so dedupe must keep only the larger-output copy.
	claude := filepath.Join(dir, "claude.jsonl")
	lines := "" +
		`{"type":"assistant","timestamp":"2026-06-26T10:00:00.000Z","requestId":"r1","message":{"id":"m1","model":"claude-opus-4-8","usage":{"input_tokens":100,"output_tokens":10,"cache_read_input_tokens":1000,"cache_creation_input_tokens":200}}}` + "\n" +
		`{"type":"assistant","timestamp":"2026-06-26T10:00:01.000Z","requestId":"r1","message":{"id":"m1","model":"claude-opus-4-8","usage":{"input_tokens":100,"output_tokens":50,"cache_read_input_tokens":1000,"cache_creation_input_tokens":200}}}` + "\n"
	if err := os.WriteFile(claude, []byte(lines), 0o644); err != nil {
		t.Fatal(err)
	}
	// deduped to the output:50 copy → 100+50+1000+200 = 1350
	got, err := SumTranscript(claude)
	if err != nil || got != 1350 {
		t.Fatalf("claude sum = %d, err = %v; want 1350", got, err)
	}

	// Codex file: one token_count with a cumulative total; Input = input - cached.
	codex := filepath.Join(dir, "rollout-x.jsonl")
	codexLines := "" +
		`{"timestamp":"2026-06-26T03:07:50.000Z","type":"turn_context","payload":{"model":"gpt-5.5"}}` + "\n" +
		`{"timestamp":"2026-06-26T03:08:00.000Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":9458,"cached_input_tokens":7040,"output_tokens":89,"total_tokens":9547}}}}` + "\n"
	if err := os.WriteFile(codex, []byte(codexLines), 0o644); err != nil {
		t.Fatal(err)
	}
	// Input = 9458-7040 = 2418; Output = 89; CacheRead = 7040; CacheCreate = 0 → 9547
	gotCodex, err := SumTranscript(codex)
	if err != nil || gotCodex != 9547 {
		t.Fatalf("codex sum = %d, err = %v; want 9547", gotCodex, err)
	}

	// Missing/unreadable file → 0, no error.
	gotMissing, err := SumTranscript(filepath.Join(dir, "does-not-exist.jsonl"))
	if err != nil || gotMissing != 0 {
		t.Fatalf("missing sum = %d, err = %v; want 0", gotMissing, err)
	}
}

func TestTranscriptUsage(t *testing.T) {
	dir := t.TempDir()

	// Claude file: two models (opus + haiku), opus streamed twice on one id → dedupe keeps output:50.
	claude := filepath.Join(dir, "claude.jsonl")
	lines := "" +
		`{"type":"assistant","timestamp":"2026-06-26T10:00:00.000Z","requestId":"r1","message":{"id":"m1","model":"claude-opus-4-8","usage":{"input_tokens":100,"output_tokens":10,"cache_read_input_tokens":1000,"cache_creation_input_tokens":200}}}` + "\n" +
		`{"type":"assistant","timestamp":"2026-06-26T10:00:01.000Z","requestId":"r1","message":{"id":"m1","model":"claude-opus-4-8","usage":{"input_tokens":100,"output_tokens":50,"cache_read_input_tokens":1000,"cache_creation_input_tokens":200}}}` + "\n" +
		`{"type":"assistant","timestamp":"2026-06-26T10:01:00.000Z","requestId":"r2","message":{"id":"m2","model":"claude-haiku-4-5","usage":{"input_tokens":12,"output_tokens":2}}}` + "\n"
	if err := os.WriteFile(claude, []byte(lines), 0o644); err != nil {
		t.Fatal(err)
	}
	got, err := TranscriptUsage(claude)
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("want 2 buckets (opus, haiku), got %d: %+v", len(got), got)
	}
	byModel := map[string]Bucket{}
	for _, b := range got {
		byModel[b.Model] = b
	}
	opus := byModel["claude-opus-4-8"]
	if opus.Input != 100 || opus.Output != 50 || opus.CacheRead != 1000 || opus.CacheCreate != 200 || opus.Msgs != 1 {
		t.Errorf("opus bucket = %+v", opus)
	}
	if h := byModel["claude-haiku-4-5"]; h.Input != 12 || h.Output != 2 {
		t.Errorf("haiku bucket = %+v", h)
	}

	// Codex rollout: one cumulative record, no cache-write class.
	codex := filepath.Join(dir, "rollout-x.jsonl")
	codexLines := "" +
		`{"timestamp":"2026-06-26T03:07:50.000Z","type":"turn_context","payload":{"model":"gpt-5.5"}}` + "\n" +
		`{"timestamp":"2026-06-26T03:08:00.000Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":9458,"cached_input_tokens":7040,"output_tokens":89,"total_tokens":9547}}}}` + "\n"
	if err := os.WriteFile(codex, []byte(codexLines), 0o644); err != nil {
		t.Fatal(err)
	}
	cg, err := TranscriptUsage(codex)
	if err != nil || len(cg) != 1 {
		t.Fatalf("codex buckets = %+v, err = %v; want 1", cg, err)
	}
	if cg[0].Harness != "codex" || cg[0].Provider != "openai" || cg[0].Input != 2418 || cg[0].CacheRead != 7040 || cg[0].Output != 89 || cg[0].CacheCreate != 0 {
		t.Errorf("codex bucket = %+v", cg[0])
	}

	// Missing/empty → nil, no error.
	if mg, err := TranscriptUsage(filepath.Join(dir, "nope.jsonl")); err != nil || mg != nil {
		t.Fatalf("missing = %+v, err = %v; want nil/nil", mg, err)
	}
}

func TestTranscriptUsageIncludesSubagents(t *testing.T) {
	dir := t.TempDir()

	// Parent Claude session: one opus turn.
	parent := filepath.Join(dir, "sess.jsonl")
	parentLine := `{"type":"assistant","timestamp":"2026-06-26T10:00:00.000Z","requestId":"r1","message":{"id":"m1","model":"claude-opus-4-8","usage":{"input_tokens":100,"output_tokens":50}}}` + "\n"
	if err := os.WriteFile(parent, []byte(parentLine), 0o644); err != nil {
		t.Fatal(err)
	}

	// Subagent transcript: <parent-without-.jsonl>/subagents/agent-1.jsonl (one haiku turn).
	subDir := filepath.Join(dir, "sess", "subagents")
	if err := os.MkdirAll(subDir, 0o755); err != nil {
		t.Fatal(err)
	}
	subLine := `{"type":"assistant","timestamp":"2026-06-26T10:01:00.000Z","requestId":"r2","message":{"id":"m2","model":"claude-haiku-4-5","usage":{"input_tokens":30,"output_tokens":8}}}` + "\n"
	if err := os.WriteFile(filepath.Join(subDir, "agent-1.jsonl"), []byte(subLine), 0o644); err != nil {
		t.Fatal(err)
	}

	// Nested subagent (a subagent that itself spawned one) must be included via the recursive walk.
	nestedDir := filepath.Join(subDir, "agent-1", "subagents")
	if err := os.MkdirAll(nestedDir, 0o755); err != nil {
		t.Fatal(err)
	}
	nestedLine := `{"type":"assistant","timestamp":"2026-06-26T10:02:00.000Z","requestId":"r3","message":{"id":"m3","model":"claude-haiku-4-5","usage":{"input_tokens":5,"output_tokens":1}}}` + "\n"
	if err := os.WriteFile(filepath.Join(nestedDir, "agent-2.jsonl"), []byte(nestedLine), 0o644); err != nil {
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
		t.Fatalf("want 2 buckets (parent opus + subagent haiku), got %d: %+v", len(got), got)
	}
	if op := byModel["claude-opus-4-8"]; op.Input != 100 || op.Output != 50 || op.Msgs != 1 {
		t.Errorf("parent opus bucket = %+v", op)
	}
	// Both haiku turns (subagent + nested) share model+day → one merged bucket.
	if h := byModel["claude-haiku-4-5"]; h.Input != 35 || h.Output != 9 || h.Msgs != 2 {
		t.Errorf("subagent haiku bucket = %+v, want input=35 output=9 msgs=2", h)
	}

	// SumTranscript folds parent + both subagents: (100+50) + (30+8) + (5+1) = 194.
	sum, err := SumTranscript(parent)
	if err != nil || sum != 194 {
		t.Fatalf("sum = %d, err = %v; want 194", sum, err)
	}
}

func TestLastCacheWrite(t *testing.T) {
	dir := t.TempDir()

	// Two cache-writing assistant messages: an earlier one on the default (5m) bucket, a later
	// one on the extended 1h bucket. LastCacheWrite must report the later one.
	path := filepath.Join(dir, "claude.jsonl")
	lines := "" +
		`{"type":"assistant","timestamp":"2026-06-26T10:00:00.000Z","requestId":"r1","message":{"id":"m1","model":"claude-opus-4-8","usage":{"input_tokens":10,"output_tokens":5,"cache_creation_input_tokens":200}}}` + "\n" +
		`{"type":"assistant","timestamp":"2026-06-26T10:05:00.000Z","requestId":"r2","message":{"id":"m2","model":"claude-opus-4-8","usage":{"input_tokens":10,"output_tokens":5,"cache_creation_input_tokens":300,"cache_creation":{"ephemeral_1h_input_tokens":300}}}}` + "\n" +
		`{"type":"assistant","timestamp":"2026-06-26T10:02:00.000Z","requestId":"r3","message":{"id":"m3","model":"claude-opus-4-8","usage":{"input_tokens":10,"output_tokens":5}}}` + "\n" // no cache write, in between -- must not win on TS ordering alone
	if err := os.WriteFile(path, []byte(lines), 0o644); err != nil {
		t.Fatal(err)
	}

	got, err := LastCacheWrite(path)
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if got == nil {
		t.Fatal("want non-nil CacheWrite")
	}
	if !got.OneHour {
		t.Errorf("want OneHour=true (the 10:05 write used the extended bucket), got false")
	}
	if !got.TS.Equal(time.Date(2026, 6, 26, 10, 5, 0, 0, time.UTC)) {
		t.Errorf("ts = %v, want 10:05:00", got.TS)
	}

	// No cache-write activity at all -> nil, no error.
	noCache := filepath.Join(dir, "no-cache.jsonl")
	noCacheLine := `{"type":"assistant","timestamp":"2026-06-26T10:00:00.000Z","message":{"id":"m1","model":"claude-opus-4-8","usage":{"input_tokens":10,"output_tokens":5}}}`
	if err := os.WriteFile(noCache, []byte(noCacheLine+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	got2, err := LastCacheWrite(noCache)
	if err != nil || got2 != nil {
		t.Fatalf("want nil/no-error for no cache activity, got %+v, err=%v", got2, err)
	}

	// Codex-shaped transcript -> nil (extractClaude yields nothing for it), no error.
	codex := filepath.Join(dir, "rollout-x.jsonl")
	codexLine := `{"timestamp":"2026-06-26T03:08:00.000Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":100,"output_tokens":10,"total_tokens":110}}}}`
	if err := os.WriteFile(codex, []byte(codexLine+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	got3, err := LastCacheWrite(codex)
	if err != nil || got3 != nil {
		t.Fatalf("want nil/no-error for codex transcript, got %+v, err=%v", got3, err)
	}

	// Missing file -> nil, no error (mirrors SumTranscript's missing-file behavior).
	got4, err := LastCacheWrite(filepath.Join(dir, "does-not-exist.jsonl"))
	if err != nil || got4 != nil {
		t.Fatalf("want nil/no-error for missing file, got %+v, err=%v", got4, err)
	}
}

func TestWindowTokens(t *testing.T) {
	// Two records straddling a cutoff. WindowTokens sums records with TS >= cutoff.
	older := Record{TS: time.Date(2026, 6, 26, 8, 0, 0, 0, time.UTC), Provider: "claude", Model: "claude-opus-4-8", Input: 100, Output: 10}
	newer := Record{TS: time.Date(2026, 6, 26, 12, 0, 0, 0, time.UTC), Provider: "claude", Model: "claude-opus-4-8", Input: 200, Output: 20, CacheRead: 5}
	recs := []Record{older, newer}

	cutoffs := []time.Time{
		time.Date(2026, 6, 26, 10, 0, 0, 0, time.UTC), // excludes older, includes newer
		time.Time{}, // all-time: includes both
	}
	got := sumRecordsSinceCutoffs(recs, cutoffs)
	// cutoff[0]: only newer → 200+20+5 = 225 ; cutoff[1]: both → 110 + 225 = 335
	if got[0] != 225 || got[1] != 335 {
		t.Fatalf("window sums = %v; want [225 335]", got)
	}
}

func TestScanRootsWindowsOpencodeByMessageTimestamp(t *testing.T) {
	dir := t.TempDir()
	msgRoot := filepath.Join(dir, "opencode-message")
	if err := os.MkdirAll(msgRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	msg := func(created int64, cost float64, input int) []byte {
		return []byte(`{"id":"m","role":"assistant","time":{"created":` +
			fmt.Sprintf("%d", created) +
			`},"providerID":"openai","modelID":"gpt-5.6-sol","cost":` +
			fmt.Sprintf("%g", cost) +
			`,"tokens":{"input":` +
			fmt.Sprintf("%d", input) +
			`,"output":0,"reasoning":0,"cache":{"read":0,"write":0}}}`)
	}
	// old message (30 days ago), file freshly written
	oldMsg := filepath.Join(msgRoot, "old.json")
	oldTS := time.Now().AddDate(0, 0, -30)
	if err := os.WriteFile(oldMsg, msg(oldTS.UnixMilli(), 1.0, 100), 0o644); err != nil {
		t.Fatal(err)
	}
	// recent message (today), file freshly written
	newMsg := filepath.Join(msgRoot, "new.json")
	if err := os.WriteFile(newMsg, msg(time.Now().UnixMilli(), 0.5, 200), 0o644); err != nil {
		t.Fatal(err)
	}
	got := scanRoots(filepath.Join(dir, "claude-missing"), filepath.Join(dir, "codex-missing"), msgRoot, filepath.Join(dir, "pi-missing"), 7)
	if len(got) != 1 {
		t.Fatalf("want 1 bucket (old excluded by timestamp despite fresh modtime), got %+v", got)
	}
	b := got[0]
	if b.Harness != "opencode" || b.Provider != "openai" || b.Model != "gpt-5.6-sol" || b.Input != 200 {
		t.Fatalf("bucket = %+v", b)
	}
	if b.ReportedCostUsd == nil || *b.ReportedCostUsd != 0.5 {
		t.Fatalf("reported cost = %#v, want present 0.5", b.ReportedCostUsd)
	}
}

func TestBucketSumsReportedCostPreservingPresence(t *testing.T) {
	ts := time.Date(2026, 8, 10, 12, 0, 0, 0, time.Local)
	zero := 0.0
	half := 0.5
	records := []Record{
		{TS: ts, Harness: "opencode", Provider: "openai", Model: "gpt-5.6-sol", Input: 1, ReportedCostUsd: &zero},
		{TS: ts, Harness: "opencode", Provider: "openai", Model: "gpt-5.6-sol", Input: 1, ReportedCostUsd: &half},
		{TS: ts, Harness: "opencode", Provider: "openai", Model: "gpt-5.6-sol", Input: 1},
	}
	got := bucket(records)
	if len(got) != 1 {
		t.Fatalf("want 1 bucket, got %d: %#v", len(got), got)
	}
	if got[0].ReportedCostUsd == nil || *got[0].ReportedCostUsd != 0.5 {
		t.Fatalf("reported cost = %#v, want present sum 0.5", got[0].ReportedCostUsd)
	}
	if got[0].Input != 3 {
		t.Fatalf("input = %d, want 3", got[0].Input)
	}
}

// extractOpencodeShadow parses the usage records the opencode status plugin appends to the shadow
// transcript. Each record is an assistant-message object (reusing extractOpencode's validation) plus
// a messageID used as the dedup key: the plugin re-emits a message's accumulated usage on every
// step-finish, so snapshots for one message must collapse to the final one.
func TestExtractOpencodeShadow(t *testing.T) {
	lines := []string{
		`{"type":"usage","messageID":"msg_1","role":"assistant","providerID":"openai","modelID":"gpt-5.2-codex","cost":0.5,"time":{"created":1786334672800},"tokens":{"input":1000,"output":50,"reasoning":30,"cache":{"read":200,"write":10}}}`,
		// a later step-finish snapshot of the same message accumulates tokens
		`{"type":"usage","messageID":"msg_1","role":"assistant","providerID":"openai","modelID":"gpt-5.2-codex","cost":0.6,"time":{"created":1786334673000},"tokens":{"input":1200,"output":80,"reasoning":40,"cache":{"read":300,"write":10}}}`,
		`{"type":"usage","messageID":"msg_2","role":"assistant","providerID":"anthropic","modelID":"claude-sonnet-4-6","time":{"created":1786334674000},"tokens":{"input":10,"output":5,"reasoning":0,"cache":{"read":0,"write":0}}}`,
		// non-assistant, malformed, and usage-less shadow lines must be skipped
		`{"type":"usage","messageID":"msg_3","role":"user","providerID":"openai","modelID":"gpt","time":{"created":1},"tokens":{"input":1}}`,
		`not json`,
		`{"type":"session","id":"ses_x","title":"t"}`,
		`{"type":"assistant","text":"no tokens on this one","ts":1}`,
	}
	got := extractOpencodeShadow(lines)
	if len(got) != 3 {
		t.Fatalf("want 3 records, got %d: %#v", len(got), got)
	}
	// dedupe collapses msg_1's snapshots to the largest-output (final) copy
	ded := dedupe(got)
	if len(ded) != 2 {
		t.Fatalf("dedupe want 2, got %d: %#v", len(ded), ded)
	}
	byID := map[string]Record{}
	for _, r := range ded {
		byID[r.ID] = r
	}
	m1 := byID["msg_1"]
	if m1.Harness != "opencode" || m1.Provider != "openai" || m1.Model != "gpt-5.2-codex" {
		t.Errorf("msg_1 identity = %#v", m1)
	}
	if m1.Input != 1200 || m1.Output != 80 || m1.Reasoning != 40 || m1.CacheRead != 300 || m1.CacheCreate != 10 {
		t.Errorf("msg_1 tokens = %#v", m1)
	}
	if m1.ReportedCostUsd == nil || *m1.ReportedCostUsd != 0.6 {
		t.Errorf("msg_1 reported cost = %#v, want 0.6", m1.ReportedCostUsd)
	}
	if !m1.TS.Equal(time.UnixMilli(1786334673000)) {
		t.Errorf("msg_1 ts = %v", m1.TS)
	}
	m2 := byID["msg_2"]
	if m2.Harness != "opencode" || m2.Provider != "anthropic" || m2.Model != "claude-sonnet-4-6" {
		t.Errorf("msg_2 identity = %#v", m2)
	}
	if m2.ReportedCostUsd != nil {
		t.Errorf("msg_2 reported cost = %#v, want absent", m2.ReportedCostUsd)
	}
}

// A shadow transcript is a JSONL mix of session/user/assistant/tool/state lines plus the plugin's
// usage records. TranscriptUsage must route it to the opencode parser and ignore everything that is
// not a usage record, producing one bucket per (provider, model, day).
func TestTranscriptUsageOpencodeShadow(t *testing.T) {
	dir := t.TempDir()
	shadow := filepath.Join(dir, "opencode", "waveterm", "ses_x.jsonl")
	if err := os.MkdirAll(filepath.Dir(shadow), 0o755); err != nil {
		t.Fatal(err)
	}
	content := "" +
		`{"type":"session","id":"ses_x","title":"new session","ts":1}` + "\n" +
		`{"type":"state","state":"working","ts":2}` + "\n" +
		`{"type":"user","text":"fix the flaky test","ts":3}` + "\n" +
		`{"type":"tool","name":"bash","state":"running","input":"go test ./...","ts":4}` + "\n" +
		`{"type":"assistant","text":"on it","ts":5}` + "\n" +
		`{"type":"usage","messageID":"msg_1","role":"assistant","providerID":"openai","modelID":"gpt-5.2-codex","cost":0.4,"time":{"created":1786334673000},"tokens":{"input":1000,"output":50,"reasoning":30,"cache":{"read":200,"write":10}}}` + "\n" +
		`{"type":"usage","messageID":"msg_1","role":"assistant","providerID":"openai","modelID":"gpt-5.2-codex","cost":0.4,"time":{"created":1786334673000},"tokens":{"input":1200,"output":80,"reasoning":40,"cache":{"read":300,"write":10}}}` + "\n"
	if err := os.WriteFile(shadow, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}

	got, err := TranscriptUsage(shadow)
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("want 1 bucket, got %d: %#v", len(got), got)
	}
	b := got[0]
	if b.Harness != "opencode" || b.Provider != "openai" || b.Model != "gpt-5.2-codex" {
		t.Errorf("bucket identity = %#v", b)
	}
	// deduped msg_1 final snapshot: input 1200, output 80, reasoning 40, cacheRead 300, cacheWrite 10
	if b.Input != 1200 || b.Output != 80 || b.Reasoning != 40 || b.CacheRead != 300 || b.CacheCreate != 10 || b.Msgs != 1 {
		t.Errorf("bucket = %#v", b)
	}
	if b.ReportedCostUsd == nil || *b.ReportedCostUsd != 0.4 {
		t.Errorf("reported cost = %#v, want 0.4", b.ReportedCostUsd)
	}

	// SumTranscript totals all five classes on the deduped final snapshot.
	sum, err := SumTranscript(shadow)
	if err != nil || sum != 1200+80+40+300+10 {
		t.Fatalf("sum = %d, err = %v; want %d", sum, err, 1200+80+40+300+10)
	}
}

// A claude transcript path never routes to the opencode parser (unchanged behavior); a path that is
// NOT under opencode/waveterm is not treated as a shadow even when it carries usage records.
func TestTranscriptUsageIgnoresNonShadowOpencodeRecords(t *testing.T) {
	dir := t.TempDir()
	claude := filepath.Join(dir, "proj", "sess.jsonl")
	if err := os.MkdirAll(filepath.Dir(claude), 0o755); err != nil {
		t.Fatal(err)
	}
	claudeLine := `{"type":"assistant","timestamp":"2026-06-26T10:00:00.000Z","requestId":"r1","message":{"id":"m1","model":"claude-opus-4-8","usage":{"input_tokens":100,"output_tokens":50}}}` + "\n"
	if err := os.WriteFile(claude, []byte(claudeLine), 0o644); err != nil {
		t.Fatal(err)
	}
	got, err := TranscriptUsage(claude)
	if err != nil || len(got) != 1 || got[0].Harness != "claude" {
		t.Fatalf("claude bucket = %#v, err = %v; want one claude bucket", got, err)
	}

	// A plain .jsonl outside opencode/waveterm carrying usage-shaped lines stays on the claude/codex
	// path and yields nothing (the lines are neither claude nor codex shape).
	other := filepath.Join(dir, "misc", "x.jsonl")
	if err := os.MkdirAll(filepath.Dir(other), 0o755); err != nil {
		t.Fatal(err)
	}
	usageLine := `{"type":"usage","messageID":"m1","role":"assistant","providerID":"openai","modelID":"gpt-5.2-codex","time":{"created":1786334673000},"tokens":{"input":1,"output":1,"reasoning":0,"cache":{"read":0,"write":0}}}`
	if err := os.WriteFile(other, []byte(usageLine+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if got2, err := TranscriptUsage(other); err != nil || got2 != nil {
		t.Fatalf("non-shadow usage-only file = %#v, err = %v; want nil/nil", got2, err)
	}
}

// The Usage scan must not count the backend's own headless maintenance passes as the user's agent
// activity, and it skips their directory outright so the files are never parsed. The planted
// transcript is a normal assistant/usage line — only the directory skip can exclude it.
func TestWalkClaudeFiles_SkipsHeadlessDir(t *testing.T) {
	saved := wavebase.DataHome_VarCache
	wavebase.DataHome_VarCache = filepath.Join(t.TempDir(), "data")
	t.Cleanup(func() { wavebase.DataHome_VarCache = saved })

	slug := agentobserve.HeadlessAgentSlug()
	if slug == "" {
		t.Fatal("HeadlessAgentSlug is empty with a data home set")
	}
	root := t.TempDir()
	for _, dir := range []string{slug, "C--Users-x-repo"} {
		if err := os.MkdirAll(filepath.Join(root, dir), 0700); err != nil {
			t.Fatal(err)
		}
		line := `{"type":"assistant","timestamp":"2026-06-26T10:00:00.000Z","message":{"model":"m","usage":{"input_tokens":1}}}`
		if err := os.WriteFile(filepath.Join(root, dir, "s.jsonl"), []byte(line), 0600); err != nil {
			t.Fatal(err)
		}
	}

	files := walkClaudeFiles(root, time.Time{})
	if len(files) != 1 {
		t.Fatalf("expected 1 file after pruning the headless dir, got %d: %+v", len(files), files)
	}
	if filepath.Base(filepath.Dir(files[0].path)) == slug {
		t.Error("headless transcript was not pruned")
	}
}

// Wave's own backend model calls are print-mode runs. Their tokens are real but they are not the
// user's agent activity, and several of them run with a real project as their working directory, so
// the headless-directory prune cannot catch those — the entrypoint field is what does.
func TestExtractClaude_SkipsPrintModeRecords(t *testing.T) {
	const usage = `"usage":{"input_tokens":100,"output_tokens":50}`
	headless := `{"type":"assistant","timestamp":"2026-06-26T10:00:00.000Z","entrypoint":"` +
		agentobserve.HeadlessEntrypoint + `","message":{"model":"m",` + usage + `}}`
	if got := extractClaude([]string{headless}); len(got) != 0 {
		t.Errorf("print-mode usage should not be counted, got %+v", got)
	}
	interactive := `{"type":"assistant","timestamp":"2026-06-26T10:00:00.000Z","entrypoint":"cli","message":{"model":"m",` + usage + `}}`
	if got := extractClaude([]string{interactive}); len(got) != 1 {
		t.Fatalf("interactive usage should be counted, got %+v", got)
	}
}

// parseFiles re-reads a file only when its modtime or size changed: an unchanged file is served from
// the cache, and one that grew is parsed again.
func TestParseFilesReparsesOnlyChangedFiles(t *testing.T) {
	path := filepath.Join(t.TempDir(), "s.jsonl")
	turn := func(input int) string {
		return fmt.Sprintf(`{"type":"assistant","timestamp":"2026-06-26T10:00:00Z","message":{"model":"claude-haiku-4-5","usage":{"input_tokens":%d}}}`+"\n", input)
	}
	inputs := func() []int {
		var out []int
		for _, r := range parseFiles([]scanFile{{path: path, kind: scanClaude}}) {
			out = append(out, r.Input)
		}
		return out
	}
	if err := os.WriteFile(path, []byte(turn(1)), 0o644); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if got := inputs(); !slices.Equal(got, []int{1}) {
		t.Fatalf("first parse = %v, want [1]", got)
	}
	// same size, same modtime, different content: only a cached parse still answers 1
	if err := os.WriteFile(path, []byte(turn(2)), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(path, info.ModTime(), info.ModTime()); err != nil {
		t.Fatal(err)
	}
	if got := inputs(); !slices.Equal(got, []int{1}) {
		t.Fatalf("unchanged file = %v, want the cached [1]", got)
	}
	if err := os.WriteFile(path, []byte(turn(2)+turn(3)), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := inputs(); !slices.Equal(got, []int{2, 3}) {
		t.Fatalf("grown file = %v, want [2 3]", got)
	}
}
