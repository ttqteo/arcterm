// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package usagestats scans agent transcript JSONL on disk and aggregates per-message token
// usage into per-(provider, model, day) buckets for the Usage cockpit surface. Pure
// token-counting only — no pricing (the frontend prices via usagepricing.ts) and no
// presentation. Sibling to pkg/gitinfo.
package usagestats

import (
	"bufio"
	"bytes"
	"encoding/json"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/agentobserve"
	"github.com/wavetermdev/waveterm/pkg/pisession"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

// Record is one parsed usage event. Token fields mirror the four Claude classes; Codex maps
// its cumulative totals onto the same shape (CacheCreate stays 0).
type Record struct {
	ID              string // "message.id:requestId" dedup key; empty when either is absent
	TS              time.Time
	Harness         string
	Provider        string
	Model           string
	Input           int
	Output          int
	Reasoning       int
	CacheRead       int
	CacheCreate     int
	CacheCreate1h   int // subset of CacheCreate billed at the 1h extended-cache rate
	ReportedCostUsd *float64
}

// Bucket is one (harness, provider, model, local-day) aggregate. The frontend prices and rolls these up.
type Bucket struct {
	Harness         string
	Provider        string
	Model           string
	Day             string // "YYYY-MM-DD", server-local timezone
	Input           int
	Output          int
	Reasoning       int
	CacheRead       int
	CacheCreate     int
	CacheCreate1h   int
	ReportedCostUsd *float64
	Msgs            int
}

// extractClaude parses Claude Code transcript lines: one record per type:"assistant" line that
// carries message.usage + message.model + a parseable timestamp. Malformed/incomplete lines are
// skipped, as are print-mode records: those tokens are real, but they are Wave's own backend model
// calls rather than the user's agent activity, and several of them run inside a real project directory
// where the headless-directory prune in walkClaudeFiles cannot reach them.
func extractClaude(lines []string) []Record {
	var out []Record
	for _, line := range lines {
		var rec struct {
			Type       string `json:"type"`
			Timestamp  string `json:"timestamp"`
			RequestID  string `json:"requestId"`
			Entrypoint string `json:"entrypoint"`
			Message    struct {
				ID    string `json:"id"`
				Model string `json:"model"`
				Usage *struct {
					InputTokens              int `json:"input_tokens"`
					OutputTokens             int `json:"output_tokens"`
					CacheReadInputTokens     int `json:"cache_read_input_tokens"`
					CacheCreationInputTokens int `json:"cache_creation_input_tokens"`
					CacheCreation            *struct {
						Ephemeral1h int `json:"ephemeral_1h_input_tokens"`
					} `json:"cache_creation"`
				} `json:"usage"`
			} `json:"message"`
		}
		if err := json.Unmarshal([]byte(line), &rec); err != nil {
			continue
		}
		if rec.Type != "assistant" || rec.Message.Usage == nil || rec.Message.Model == "" {
			continue
		}
		if agentobserve.IsHeadlessEntrypoint(rec.Entrypoint) {
			continue
		}
		ts, err := time.Parse(time.RFC3339, rec.Timestamp)
		if err != nil {
			continue
		}
		id := ""
		if rec.Message.ID != "" && rec.RequestID != "" {
			id = rec.Message.ID + ":" + rec.RequestID
		}
		c1h := 0
		if rec.Message.Usage.CacheCreation != nil {
			c1h = rec.Message.Usage.CacheCreation.Ephemeral1h
		}
		out = append(out, Record{
			ID: id, TS: ts, Harness: "claude", Provider: "anthropic", Model: rec.Message.Model,
			Input: rec.Message.Usage.InputTokens, Output: rec.Message.Usage.OutputTokens,
			CacheRead: rec.Message.Usage.CacheReadInputTokens, CacheCreate: rec.Message.Usage.CacheCreationInputTokens,
			CacheCreate1h: c1h,
		})
	}
	return out
}

// extractCodex parses a Codex rollout file. Token usage is in event_msg/token_count lines as a
// CUMULATIVE total_token_usage; the model is on a preceding turn_context line. We take the MAX
// cumulative (Codex's own session total), and cached_input_tokens is a subset of input_tokens
// (so Input = input - cached). One record per file. Mirrors extractCodexUsage in usagestats.ts.
func extractCodex(lines []string) []Record {
	model := "codex"
	var best *Record
	bestTotal := 0
	for _, line := range lines {
		var rec struct {
			Type      string `json:"type"`
			Timestamp string `json:"timestamp"`
			Payload   struct {
				Type  string `json:"type"`
				Model string `json:"model"`
				Info  struct {
					TotalTokenUsage *struct {
						InputTokens       int `json:"input_tokens"`
						CachedInputTokens int `json:"cached_input_tokens"`
						OutputTokens      int `json:"output_tokens"`
						TotalTokens       int `json:"total_tokens"`
					} `json:"total_token_usage"`
				} `json:"info"`
			} `json:"payload"`
		}
		if err := json.Unmarshal([]byte(line), &rec); err != nil {
			continue
		}
		if rec.Type == "turn_context" {
			if rec.Payload.Model != "" {
				model = rec.Payload.Model
			}
			continue
		}
		if rec.Type != "event_msg" || rec.Payload.Type != "token_count" {
			continue
		}
		tu := rec.Payload.Info.TotalTokenUsage
		if tu == nil {
			continue
		}
		ts, err := time.Parse(time.RFC3339, rec.Timestamp)
		if err != nil {
			continue
		}
		total := tu.TotalTokens
		if total == 0 {
			total = tu.InputTokens + tu.OutputTokens
		}
		if best == nil || total > bestTotal {
			input := tu.InputTokens - tu.CachedInputTokens
			if input < 0 {
				input = 0
			}
			best = &Record{TS: ts, Harness: "codex", Provider: "openai", Model: model, Input: input, Output: tu.OutputTokens, CacheRead: tu.CachedInputTokens}
			bestTotal = total
		}
	}
	if best == nil {
		return nil
	}
	return []Record{*best}
}

// extractOpencode parses a current-format OpenCode assistant-message file. A record is accepted
// only when the message is an assistant turn with a valid creation epoch, non-empty provider and
// model IDs, and a token object. Reported cost uses a *float64 so an absent report differs from a
// reported zero. Assistant messages are final records rather than cumulative streaming snapshots,
// so no dedup key is needed here.
func extractOpencode(data []byte) (Record, bool) {
	var msg struct {
		Role       string   `json:"role"`
		ProviderID string   `json:"providerID"`
		ModelID    string   `json:"modelID"`
		Cost       *float64 `json:"cost"`
		Time       struct {
			Created int64 `json:"created"`
		} `json:"time"`
		Tokens *struct {
			Input     int `json:"input"`
			Output    int `json:"output"`
			Reasoning int `json:"reasoning"`
			Cache     struct {
				Read  int `json:"read"`
				Write int `json:"write"`
			} `json:"cache"`
		} `json:"tokens"`
	}
	if json.Unmarshal(data, &msg) != nil || msg.Role != "assistant" || msg.Time.Created <= 0 ||
		msg.ProviderID == "" || msg.ModelID == "" || msg.Tokens == nil {
		return Record{}, false
	}
	return Record{
		TS: time.UnixMilli(msg.Time.Created), Harness: "opencode", Provider: msg.ProviderID, Model: msg.ModelID,
		Input: msg.Tokens.Input, Output: msg.Tokens.Output, Reasoning: msg.Tokens.Reasoning,
		CacheRead: msg.Tokens.Cache.Read, CacheCreate: msg.Tokens.Cache.Write, ReportedCostUsd: msg.Cost,
	}, true
}

// extractOpencodeShadow parses the usage records the opencode status plugin appends to its shadow
// transcript. Each record is an assistant-message object (the plugin echoes the message.updated info,
// so extractOpencode's validation applies) plus a messageID. The plugin re-emits a message's
// accumulated usage on every step-finish, so the ID is the dedup key — dedupe keeps the largest
// output, i.e. the final snapshot. Records without a messageID are not dedupable and are skipped.
func extractOpencodeShadow(lines []string) []Record {
	var out []Record
	for _, line := range lines {
		var rec struct {
			MessageID string `json:"messageID"`
		}
		if json.Unmarshal([]byte(line), &rec) != nil || rec.MessageID == "" {
			continue
		}
		r, ok := extractOpencode([]byte(line))
		if !ok {
			continue
		}
		r.ID = rec.MessageID
		out = append(out, r)
	}
	return out
}

// isOpencodeShadowPath reports whether path is an opencode shadow transcript (the plugin's JSONL
// under <opencode root>/waveterm). The parent-dir name plus an opencode segment keeps the check
// specific without coupling to the machine's data-home layout.
func isOpencodeShadowPath(path string) bool {
	return strings.HasSuffix(path, ".jsonl") &&
		strings.EqualFold(filepath.Base(filepath.Dir(path)), "waveterm") &&
		strings.Contains(strings.ToLower(path), "opencode")
}

// dedupe collapses records sharing an ID to the one with the largest Output (the final
// streaming snapshot; input/cache are constant across snapshots). Keyless records pass through.
// Mirrors dedupeUsage in usagestats.ts.
func dedupe(records []Record) []Record {
	byKey := map[string]Record{}
	var out []Record
	for _, r := range records {
		if r.ID == "" {
			out = append(out, r)
			continue
		}
		if cur, ok := byKey[r.ID]; !ok || r.Output > cur.Output {
			byKey[r.ID] = r
		}
	}
	for _, r := range byKey {
		out = append(out, r)
	}
	return out
}

// bucket groups deduped records by (harness, provider, model, local day), summing token classes,
// reported cost (preserving presence), and a message count. Records with model "<synthetic>"
// (Claude's non-billable internal turns) are dropped here so they never reach the wire.
func bucket(records []Record) []Bucket {
	type key struct{ harness, provider, model, day string }
	m := map[key]*Bucket{}
	for _, r := range records {
		if r.Model == "<synthetic>" {
			continue
		}
		day := r.TS.Local().Format("2006-01-02")
		k := key{r.Harness, r.Provider, r.Model, day}
		b := m[k]
		if b == nil {
			b = &Bucket{Harness: r.Harness, Provider: r.Provider, Model: r.Model, Day: day}
			m[k] = b
		}
		b.Input += r.Input
		b.Output += r.Output
		b.Reasoning += r.Reasoning
		b.CacheRead += r.CacheRead
		b.CacheCreate += r.CacheCreate
		b.CacheCreate1h += r.CacheCreate1h
		if r.ReportedCostUsd != nil {
			if b.ReportedCostUsd == nil {
				b.ReportedCostUsd = new(float64)
			}
			*b.ReportedCostUsd += *r.ReportedCostUsd
		}
		b.Msgs++
	}
	out := make([]Bucket, 0, len(m))
	for _, b := range m {
		out = append(out, *b)
	}
	return out
}

// maxLineBytes bounds one transcript line. A tool result can run to many megabytes; the scanner's
// buffer only grows to the longest line it meets.
const maxLineBytes = 1 << 30

// usageMarker is what a Claude line must contain to carry token usage.
var usageMarker = []byte(`"usage"`)

// scanLines returns the non-blank lines of path that keep accepts (nil keeps all). It streams: a scan
// reads transcripts in parallel, and holding each one whole made that burst, not the live heap, the
// size wavesrv stayed at.
func scanLines(path string, keep func(line []byte) bool) []string {
	file, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	scanner.Buffer(nil, maxLineBytes)
	var lines []string
	for scanner.Scan() {
		ln := scanner.Bytes()
		if len(bytes.TrimSpace(ln)) == 0 || (keep != nil && !keep(ln)) {
			continue
		}
		lines = append(lines, string(ln))
	}
	if err := scanner.Err(); err != nil {
		log.Printf("usagestats: reading %s stopped early: %v", path, err)
	}
	return lines
}

func readLines(path string) []string {
	return scanLines(path, nil)
}

// filterUsageLines returns the subset of lines that could carry Claude token usage — only assistant
// messages hold a "usage" object, so a line lacking that substring can never produce a record
// (extractClaude would skip it anyway). Dropping them avoids a full json.Unmarshal of every
// user/tool/summary line, the dominant per-file cost. Non-destructive: the input is left intact for
// callers that also try a Codex parse on the same lines. Output through extractClaude is identical
// to parsing every line (Codex-shaped lines never match: "total_token_usage" has no leading quote
// before "usage", and any stray match isn't type:"assistant" so it yields no record).
func filterUsageLines(lines []string) []string {
	var out []string
	for _, ln := range lines {
		if strings.Contains(ln, string(usageMarker)) {
			out = append(out, ln)
		}
	}
	return out
}

// readClaudeLines reads a Claude transcript, keeping only usage-bearing lines (see filterUsageLines)
// as they stream past, so the rest of the file is never held.
func readClaudeLines(path string) []string {
	return scanLines(path, func(line []byte) bool { return bytes.Contains(line, usageMarker) })
}

// inWindow reports whether the file at path was modified at/after cutoff. A zero cutoff
// (windowDays <= 0) means all-time — always true. Unstatable files are excluded.
func inWindow(path string, cutoff time.Time) bool {
	if cutoff.IsZero() {
		return true
	}
	info, err := os.Stat(path)
	if err != nil {
		return false
	}
	return !info.ModTime().Before(cutoff)
}

// scanKind identifies which parser a scanFile needs.
type scanKind uint8

const (
	scanClaude scanKind = iota
	scanCodex
	scanOpencode
	scanPi
	scanAgy
)

// scanFile is one transcript to parse, tagged with the parser it needs. cutoff is the authoritative
// timestamp window for the file (used by the OpenCode walker, which cannot prune by modtime).
type scanFile struct {
	path   string
	kind   scanKind
	cutoff time.Time
}

// walkClaudeFiles collects in-window Claude transcript files (recursively, so subagent dirs are
// included), pruning by modtime against cutoff and skipping the backend's own headless passes —
// those tokens are real, but they are Wave's maintenance work rather than the user's agent activity.
func walkClaudeFiles(root string, cutoff time.Time) []scanFile {
	var files []scanFile
	headlessSlug := agentobserve.HeadlessAgentSlug()
	_ = filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			if headlessSlug != "" && d.Name() == headlessSlug {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(path, ".jsonl") {
			return nil
		}
		if inWindow(path, cutoff) {
			files = append(files, scanFile{path: path, kind: scanClaude})
		}
		return nil
	})
	return files
}

// walkCodexFiles collects in-window Codex rollout files (rollout-*.jsonl), pruning by modtime.
func walkCodexFiles(root string, cutoff time.Time) []scanFile {
	var files []scanFile
	_ = filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		name := d.Name()
		if !strings.HasPrefix(name, "rollout-") || !strings.HasSuffix(name, ".jsonl") {
			return nil
		}
		if inWindow(path, cutoff) {
			files = append(files, scanFile{path: path, kind: scanCodex})
		}
		return nil
	})
	return files
}

// walkOpencodeFiles collects OpenCode assistant-message JSON files under the message root. Message
// timestamps are the authoritative window (a file may be written long after the message it holds),
// so every file is walked without inWindow pruning and the exact timestamp cutoff is stored on each
// scanFile for the parser to apply.
func walkOpencodeFiles(root string, cutoff time.Time) []scanFile {
	var files []scanFile
	_ = filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(path, ".json") {
			return nil
		}
		files = append(files, scanFile{path: path, kind: scanOpencode, cutoff: cutoff})
		return nil
	})
	return files
}

// parseFiles reads + parses each transcript concurrently (through parseCache, so an unchanged file
// is not read again), bounded to NumCPU workers, and returns the concatenated records, each file's
// cut to its scanFile cutoff and not deduped across files. The all-time corpus is GBs across thousands of files, and
// a single-threaded json.Unmarshal per line dominated load time; fanning the per-file parse across
// cores is the bulk of the speedup. Result order is unspecified — callers dedupe + bucket, both
// order-independent. Codex files are read whole (the model lives on a turn_context line, so they
// can't be pre-filtered); Claude files skip lines that can't carry usage (readClaudeLines). OpenCode
// files are whole-file JSON with the message timestamp as the window, and Pi files are whole
// v3 sessions read via pisession with the entry timestamp as the window.
func parseFiles(files []scanFile) []Record {
	workers := runtime.NumCPU()
	if workers < 1 {
		workers = 1
	}
	results := make([][]Record, len(files))
	sem := make(chan struct{}, workers)
	var wg sync.WaitGroup
	for i, f := range files {
		wg.Add(1)
		sem <- struct{}{}
		go func(i int, f scanFile) {
			defer wg.Done()
			defer func() { <-sem }()
			results[i] = cachedFileRecords(f)
		}(i, f)
	}
	wg.Wait()
	var records []Record
	for i, recs := range results {
		cutoff := files[i].cutoff
		for _, r := range recs {
			if cutoff.IsZero() || !r.TS.Before(cutoff) {
				records = append(records, r)
			}
		}
	}
	return records
}

// parseFile reads one transcript into its records, whatever their age: the window is applied by the
// caller, so one parse serves every window. Records are deduped within the file, which a later
// corpus-wide dedupe leaves unchanged (it keeps the largest output per ID either way) and which
// keeps the streaming snapshots out of the cache.
func parseFile(f scanFile) []Record {
	switch f.kind {
	case scanCodex:
		return extractCodex(readLines(f.path))
	case scanOpencode:
		data, err := os.ReadFile(f.path)
		if err != nil {
			return nil
		}
		rec, ok := extractOpencode(data)
		if !ok {
			return nil
		}
		return []Record{rec}
	case scanPi:
		file, err := pisession.Read(f.path)
		if err != nil {
			return nil
		}
		return extractPi(file, time.Time{})
	case scanAgy:
		return extractAgy(readAgyLines(f.path))
	default:
		return dedupe(extractClaude(readClaudeLines(f.path)))
	}
}

// fileParse is one file's parsed records and the modtime and size they were read at.
type fileParse struct {
	mod     time.Time
	size    int64
	records []Record
}

// parseCache holds each scanned file's records by path. Reading and parsing the transcripts is nearly
// all of a scan and most of them are finished sessions that never change, so a repeat scan re-reads
// only the files written since the last one.
// ponytail: unbounded, an all-time scan keeps every record of the corpus until wavesrv exits; evict
// entries no recent scan read if its memory matters.
var parseCache sync.Map

// cachedFileRecords returns f's records, parsing the file only when its modtime or size differs from
// the cached parse. The returned slice is shared with the cache and must not be modified.
func cachedFileRecords(f scanFile) []Record {
	info, err := os.Stat(f.path)
	if err != nil {
		parseCache.Delete(f.path)
		return nil
	}
	if v, ok := parseCache.Load(f.path); ok {
		if c := v.(fileParse); c.size == info.Size() && c.mod.Equal(info.ModTime()) {
			return c.records
		}
	}
	records := parseFile(f)
	parseCache.Store(f.path, fileParse{mod: info.ModTime(), size: info.Size(), records: records})
	return records
}

// scanRoots walks the Claude, Codex, OpenCode, Pi, and agy transcript roots, prunes Claude/Codex files by
// modtime to the window (with a 1-day margin), parses + dedups the records, keeps those inside the
// window, and returns buckets. Missing roots yield nothing.
func scanRoots(claudeRoot, codexRoot, opencodeRoot, piRoot, agyRoot string, windowDays int) []Bucket {
	var cutoff, since time.Time
	if windowDays > 0 {
		cutoff = time.Now().AddDate(0, 0, -windowDays-1)
		since = windowStart(time.Now(), windowDays)
	}
	files := append(walkClaudeFiles(claudeRoot, cutoff), walkCodexFiles(codexRoot, cutoff)...)
	files = append(files, walkOpencodeFiles(opencodeRoot, since)...)
	files = append(files, walkPiFiles(piRoot, since)...)
	files = append(files, walkAgyFiles(agyRoot, since)...)
	// a transcript modified inside the window still holds every earlier turn of its session, so the
	// modtime prune alone let a long-running session pull days from before the window into it
	var records []Record
	for _, r := range parseFiles(files) {
		if since.IsZero() || !r.TS.Before(since) {
			records = append(records, r)
		}
	}
	return bucket(dedupe(records))
}

// windowStart is local midnight windowDays-1 days before now: the window is whole local days with
// today included, the same days the frontend's per-week totals count.
func windowStart(now time.Time, windowDays int) time.Time {
	y, m, d := now.AddDate(0, 0, -(windowDays - 1)).Date()
	return time.Date(y, m, d, 0, 0, 0, 0, now.Location())
}

// ScanUsage aggregates usage from the user's Claude, Codex, OpenCode, Pi, and agy transcripts within
// the last windowDays (0 = all-time). It is the only exported entry point.
func ScanUsage(windowDays int) ([]Bucket, error) {
	home := wavebase.GetHomeDir()
	return scanRoots(
		filepath.Join(home, ".claude", "projects"),
		filepath.Join(home, ".codex", "sessions"),
		filepath.Join(home, ".local", "share", "opencode", "storage", "message"),
		filepath.Join(home, ".pi", "agent", "sessions"),
		filepath.Join(home, ".gemini", "antigravity-cli", "brain"),
		windowDays,
	), nil
}

// sumRecords totals the five token classes across deduped records.
func sumRecords(records []Record) int {
	total := 0
	for _, r := range dedupe(records) {
		total += r.Input + r.Output + r.Reasoning + r.CacheRead + r.CacheCreate
	}
	return total
}

// subagentsDir derives the Claude Code subagents directory for a parent transcript path:
// <dir>/<basename without .jsonl>/subagents. Mirrors the unexported helper in
// pkg/wshrpc/wshserver; kept local rather than shared to avoid a cross-package dependency for a
// two-line path join.
func subagentsDir(parentPath string) string {
	base := strings.TrimSuffix(filepath.Base(parentPath), ".jsonl")
	return filepath.Join(filepath.Dir(parentPath), base, "subagents")
}

// piSubagentRecords walks the pi-subagents child-session root for a parent session file:
// <parent-without-.jsonl>/<runId>/run-<idx>/session.jsonl, recursively so a nested subagent (its
// own children live under its run-0/session dir) is included too. A parent that spawned none has
// no such dir and yields nothing. Only files that parse as Pi v3 sessions are kept — a run dir can
// hold other jsonl (status/events logs) that must never bill.
func piSubagentRecords(parentPath string) []Record {
	var recs []Record
	root := strings.TrimSuffix(parentPath, ".jsonl")
	_ = filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(path, ".jsonl") {
			return nil
		}
		file, err := pisession.Read(path)
		if err != nil {
			return nil
		}
		recs = append(recs, extractPi(file, time.Time{})...)
		return nil
	})
	return recs
}

// Subagents are separate Claude Code transcript files under the parent's subagents dir, walked
// recursively so a nested subagent (one that itself spawned children) is included too. A parent
// that spawned none has no such dir and yields nothing. Subagents are a Claude-only concept, so
// only the Claude parser runs here.
func subagentRecords(parentPath string) []Record {
	var recs []Record
	_ = filepath.WalkDir(subagentsDir(parentPath), func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(path, ".jsonl") {
			return nil
		}
		recs = append(recs, extractClaude(readClaudeLines(path))...)
		return nil
	})
	return recs
}

// transcriptRecords parses one transcript file — plus any subagent transcripts a Claude parent
// spawned — into raw (un-deduped) records. Claude parser first; Codex fallback when the Claude
// parse is empty. A subagent's tokens bill to the account exactly like the parent's, so a
// per-session total that omitted them would under-report any session that fanned out to subagents.
// Codex rollouts have no subagent dir, so the fallback path returns the parent's records unchanged.
func transcriptRecords(path string) []Record {
	// an agy transcript is read through its planner-response filter: its other steps are never
	// usage and a tool result can run past a megabyte.
	if isAgyTranscriptPath(path) {
		return extractAgy(readAgyLines(path))
	}
	lines := readLines(path)
	if len(lines) == 0 {
		return nil
	}
	// opencode shadows are the plugin's usage records, none of which the claude/codex parsers
	// understand — route them to the opencode parser before the claude/codex attempts run.
	if isOpencodeShadowPath(path) {
		return extractOpencodeShadow(lines)
	}
	// native Pi sessions are their own versioned JSONL shape that neither the claude nor codex
	// heuristics can parse — route them to the Pi parser before those fallbacks run. Like Claude,
	// the parent's total folds in its subagent sessions (pi-subagents writes them under the parent's
	// own file stem) so a fan-out session does not under-report.
	if isPiTranscriptPath(path) {
		file, err := pisession.Read(path)
		if err != nil {
			return nil
		}
		return append(extractPi(file, time.Time{}), piSubagentRecords(path)...)
	}
	// Claude parse runs on the usage-filtered subset; the Codex fallback needs the full lines (its
	// model + token counts live on non-usage lines), so filterUsageLines must not mutate `lines`.
	recs := extractClaude(filterUsageLines(lines))
	if len(recs) == 0 {
		return extractCodex(lines)
	}
	return append(recs, subagentRecords(path)...)
}

// SumTranscript reads one transcript file — and the subagent transcripts it spawned — and returns
// the deduped cumulative token total (Input+Output+CacheRead+CacheCreate), matching the Usage
// surface's accounting. Empty/unreadable/unknown-shape files return 0.
func SumTranscript(path string) (int, error) {
	return sumRecords(transcriptRecords(path)), nil
}

// TranscriptUsage parses one transcript file — and the subagent transcripts it spawned — into
// per-(provider, model, day) buckets, reusing the same dedup + bucket accounting as the Usage
// surface. The per-session analogue of ScanUsage. Empty/unreadable/unknown-shape files return nil.
func TranscriptUsage(path string) ([]Bucket, error) {
	recs := transcriptRecords(path)
	if len(recs) == 0 {
		return nil, nil
	}
	return bucket(dedupe(recs)), nil
}

// CacheWrite is the most recent prompt-cache-writing message in a transcript.
type CacheWrite struct {
	TS      time.Time
	OneHour bool // true if this write used the extended 1h TTL bucket (else the default 5m bucket)
}

// LastCacheWrite finds the most recent assistant record with cache-write activity in the
// transcript at path, and reports which TTL bucket it used. Only Claude transcripts carry this
// concept (extractClaude yields nothing for a Codex-shaped file, so this returns nil for those).
// Returns nil (no error) when the transcript has no cache-write activity, is empty, or is missing.
func LastCacheWrite(path string) (*CacheWrite, error) {
	lines := readLines(path)
	if len(lines) == 0 {
		return nil, nil
	}
	var last *Record
	for _, r := range extractClaude(filterUsageLines(lines)) {
		if r.CacheCreate <= 0 {
			continue
		}
		if last == nil || r.TS.After(last.TS) {
			rc := r
			last = &rc
		}
	}
	if last == nil {
		return nil, nil
	}
	return &CacheWrite{TS: last.TS, OneHour: last.CacheCreate1h > 0}, nil
}

// sumRecordsSinceCutoffs returns, per cutoff (positionally), the summed token total of
// records at/after that cutoff. A zero cutoff means all-time (every record counts).
func sumRecordsSinceCutoffs(records []Record, cutoffs []time.Time) []int {
	out := make([]int, len(cutoffs))
	for _, r := range records {
		tokens := r.Input + r.Output + r.Reasoning + r.CacheRead + r.CacheCreate
		for i, c := range cutoffs {
			if c.IsZero() || !r.TS.Before(c) {
				out[i] += tokens
			}
		}
	}
	return out
}

// WindowTokens sums Claude-only deduped token totals for records at/after each cutoff,
// across the Claude transcript root. Codex is excluded — rate-limit windows are
// Claude.ai-specific. Returns one total per cutoff, positionally.
func WindowTokens(cutoffs []time.Time) ([]int, error) {
	home := wavebase.GetHomeDir()
	claudeRoot := filepath.Join(home, ".claude", "projects")

	var earliest time.Time
	for _, c := range cutoffs {
		if !c.IsZero() && (earliest.IsZero() || c.Before(earliest)) {
			earliest = c
		}
	}
	// prune files by modtime against the earliest cutoff (with the existing 1-day margin)
	var prune time.Time
	if !earliest.IsZero() {
		prune = earliest.AddDate(0, 0, -1)
	}

	records := parseFiles(walkClaudeFiles(claudeRoot, prune))
	return sumRecordsSinceCutoffs(dedupe(records), cutoffs), nil
}
