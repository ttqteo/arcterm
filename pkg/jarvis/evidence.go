// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jarvis

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/agentobserve"
	"github.com/wavetermdev/waveterm/pkg/agentsessions"
	"github.com/wavetermdev/waveterm/pkg/gitinfo"
	"github.com/wavetermdev/waveterm/pkg/pisession"
	"github.com/wavetermdev/waveterm/pkg/runroute"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// verifPattern matches a shell command that is a verification step (test / lint / typecheck / build).
// Evidence-only: a command that does not match is simply not reported (we never invent expected steps).
var verifPattern = regexp.MustCompile(`\b(test|typecheck|tsc|lint|vitest|jest|pytest|go test|cargo test|build|vet|check|e2e|smoke)\b`)

// VerifResult_Ran marks a verification line read from a worker's transcript. The command ran, but its exit
// status is no verdict: a pipe to tail reports tail's, and a grep that finds nothing fails. Only the
// engine's own Verify results (dagVerifs) are pass or fail.
const VerifResult_Ran = "ran"

// verifRunners are the programs that run a test, build, lint or typecheck. A command counts only when one of
// them leads a simple command in it, so a runner word elsewhere (a grep's --include=*.go) does not.
var verifRunners = map[string]bool{
	"npm": true, "pnpm": true, "yarn": true, "bun": true, "npx": true, "node": true, "go": true, "cargo": true,
	"dotnet": true, "make": true, "task": true, "mvn": true, "gradle": true, "python": true, "pytest": true,
	"vitest": true, "jest": true, "tsc": true, "eslint": true, "prettier": true, "tox": true, "flutter": true,
}

// shellSegmentSep splits a command into the simple commands it chains or pipes. A separator inside a quoted
// argument splits there too; at worst that drops a line, it never invents one.
var shellSegmentSep = regexp.MustCompile(`&&|\|\||[;|\n]`)

// leadingEnv matches the env assignments before a simple command's runner, quoted values included, so
// CC="zig cc -target ..." does not hide the runner behind its value's words.
var leadingEnv = regexp.MustCompile(`^\s*(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)\s+)*`)

// inlineScriptFlags make a runner run a script given inline or on stdin. That is an edit or a probe, never a
// check, even when the script names a test file.
var inlineScriptFlags = map[string]map[string]bool{
	"node":   {"-e": true, "--eval": true, "-p": true, "--print": true, "-": true},
	"bun":    {"-e": true, "--eval": true, "-p": true, "--print": true, "-": true},
	"python": {"-c": true, "-": true},
}

func inlineScript(runner string, args []string) bool {
	for _, a := range args {
		if inlineScriptFlags[runner][a] {
			return true
		}
		if !strings.HasPrefix(a, "-") {
			return false
		}
	}
	return false
}

// heredocStart opens a heredoc; a <<< herestring does not.
var heredocStart = regexp.MustCompile(`(?:^|[^<])<<-?\s*['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?`)

// stripHeredocs drops heredoc bodies, so a script's lines are never read as commands. An unterminated heredoc
// drops the rest.
func stripHeredocs(command string) string {
	lines := strings.Split(command, "\n")
	var out []string
	for i := 0; i < len(lines); i++ {
		out = append(out, lines[i])
		m := heredocStart.FindStringSubmatch(lines[i])
		if m == nil {
			continue
		}
		for i+1 < len(lines) && strings.TrimSpace(lines[i+1]) != m[1] {
			i++
		}
		i++
	}
	return strings.Join(out, "\n")
}

// verifChecks returns the simple commands in command that run a check: led by a known runner, naming a
// verification action, and not an inline script. The edits, cds and pipes around them are not checks.
func verifChecks(command string) []string {
	var checks []string
	for _, seg := range shellSegmentSep.Split(stripHeredocs(command), -1) {
		fields := strings.Fields(leadingEnv.ReplaceAllString(seg, ""))
		if len(fields) == 0 {
			continue
		}
		runner := strings.TrimSuffix(path.Base(strings.ReplaceAll(fields[0], `\`, "/")), ".exe")
		if verifRunners[runner] && !inlineScript(runner, fields[1:]) && verifPattern.MatchString(seg) {
			checks = append(checks, strings.TrimSpace(seg))
		}
	}
	return checks
}

// evBlock is a content block with the fields evidence needs (superset of agentobserve's internal block).
type evBlock struct {
	Type      string          `json:"type"`
	ID        string          `json:"id"`
	Name      string          `json:"name"`
	Text      string          `json:"text"`
	ToolUseID string          `json:"tool_use_id"`
	IsError   bool            `json:"is_error"`
	Content   json.RawMessage `json:"content"` // tool_result body (string or blocks)
	Input     struct {
		Command string `json:"command"`
	} `json:"input"`
	Arguments struct {
		Command string `json:"command"`
	} `json:"arguments"` // pi's toolCall input
}

type evRecord struct {
	Type    string `json:"type"`
	Message struct {
		Role       string          `json:"role"`
		ToolCallID string          `json:"toolCallId"`
		IsError    bool            `json:"isError"`
		Content    json.RawMessage `json:"content"`
	} `json:"message"`
}

// evBlocks reads a transcript line in claude's shape: the record type and its content blocks. A pi
// message entry is mapped onto that shape, so the summary and verification scans read both runtimes.
func evBlocks(line string) (string, []evBlock) {
	var rec evRecord
	if json.Unmarshal([]byte(strings.TrimSpace(line)), &rec) != nil {
		return "", nil
	}
	if rec.Type == "message" {
		return piBlocks(rec)
	}
	var blocks []evBlock
	if json.Unmarshal(rec.Message.Content, &blocks) != nil {
		return rec.Type, nil
	}
	return rec.Type, blocks
}

// piBlocks maps a pi message entry onto claude's shape. pi returns a tool's output as its own toolResult
// message instead of a tool_result block, and names its shell tool bash with the command in arguments.
func piBlocks(rec evRecord) (string, []evBlock) {
	if rec.Message.Role == "toolResult" {
		return "user", []evBlock{{Type: "tool_result", ToolUseID: rec.Message.ToolCallID, IsError: rec.Message.IsError, Content: rec.Message.Content}}
	}
	var blocks []evBlock
	if json.Unmarshal(rec.Message.Content, &blocks) != nil {
		return rec.Message.Role, nil
	}
	for i := range blocks {
		if blocks[i].Type != "toolCall" {
			continue
		}
		blocks[i].Type = "tool_use"
		blocks[i].Input.Command = blocks[i].Arguments.Command
		if blocks[i].Name == "bash" {
			blocks[i].Name = "Bash"
		}
	}
	return rec.Message.Role, blocks
}

// finalAssistantText returns the text of the last assistant message that carried a text block.
func finalAssistantText(lines []string) string {
	for i := len(lines) - 1; i >= 0; i-- {
		typ, blocks := evBlocks(lines[i])
		if typ != "assistant" {
			continue
		}
		var text strings.Builder
		for _, b := range blocks {
			if b.Type == "text" && strings.TrimSpace(b.Text) != "" {
				if text.Len() > 0 {
					text.WriteString("\n")
				}
				text.WriteString(strings.TrimSpace(b.Text))
			}
		}
		if text.Len() > 0 {
			return text.String()
		}
	}
	return ""
}

// resultText flattens a tool_result content (string or [{type:text,text}]) to plain text.
func resultText(raw json.RawMessage) (string, bool) {
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return s, false
	}
	var blocks []evBlock
	if json.Unmarshal(raw, &blocks) == nil {
		var b strings.Builder
		for _, blk := range blocks {
			b.WriteString(blk.Text)
		}
		return b.String(), false
	}
	return "", false
}

// verifAccum merges verification results across transcripts: a command keeps the slot of its first
// appearance and the result of its last completion. Pending tool_use ids are per-transcript — each
// worker reuses ids like "b1" — so only the result map is shared.
type verifAccum struct {
	idx map[string]int // command -> position in out
	out []waveobj.EvidenceVerif
}

func newVerifAccum() *verifAccum {
	return &verifAccum{idx: map[string]int{}}
}

func (a *verifAccum) addTranscript(lines []string) {
	byToolID := map[string]string{} // tool_use id -> command awaiting a result (this transcript)
	for _, line := range lines {
		_, blocks := evBlocks(line)
		for _, b := range blocks {
			switch b.Type {
			case "tool_use":
				// the accumulator keys on the checks alone, so the same test after different edits merges
				if b.Name == "Bash" {
					if checks := verifChecks(b.Input.Command); len(checks) > 0 {
						byToolID[b.ID] = strings.Join(checks, "; ")
					}
				}
			case "tool_result":
				command, live := byToolID[b.ToolUseID]
				if !live {
					continue
				}
				delete(byToolID, b.ToolUseID)
				txt, _ := resultText(b.Content)
				// tool output is captured with a TTY attached, so it carries ANSI color codes
				v := waveobj.EvidenceVerif{Cmd: command, Result: VerifResult_Ran, Detail: verifSummaryLine(utilfn.StripANSI(txt))}
				if i, seen := a.idx[command]; seen {
					a.out[i] = v
				} else {
					a.idx[command] = len(a.out)
					a.out = append(a.out, v)
				}
			}
		}
	}
	// a verification tool_use with no result at all still ran
	for _, command := range byToolID {
		if _, seen := a.idx[command]; !seen {
			a.idx[command] = len(a.out)
			a.out = append(a.out, waveobj.EvidenceVerif{Cmd: command, Result: VerifResult_Ran})
		}
	}
}

// verifSummaryRe recognizes a test-runner result summary: a counted outcome (pytest/vitest "12 passed",
// tsc "Found 1 error") or a go-test verdict line. Applied per line, so ^ anchors to that line. The
// trailing .*\S keeps a bare "FAIL" from winning over go test's informative "FAIL\tpkg\t0.4s" above it.
var verifSummaryRe = regexp.MustCompile(`(?i)\b\d+ (passed|failed|error|errors|skipped)\b|^(ok|pass|fail)\b.*\S`)

// verifSummaryLine picks the line of captured output that states the result. Workers routinely pipe
// verification through `| tail -N`, so the captured stdout already starts mid-run: its first line is an
// arbitrary fragment (a test-fn signature, pytest's rootdir header) while every runner prints its summary
// last. Scans backward for a recognized summary, falling back to the last non-empty line.
func verifSummaryLine(s string) string {
	lines := strings.Split(s, "\n")
	last := ""
	for i := len(lines) - 1; i >= 0; i-- {
		line := strings.TrimSpace(lines[i])
		if line == "" {
			continue
		}
		if verifSummaryRe.MatchString(line) {
			return line
		}
		if last == "" {
			last = line
		}
	}
	return last
}

// parseNumstatStatus joins `git diff --numstat` rows (adds\tdels\tpath) with `git status --porcelain -z`
// entries (XY path) into per-file evidence. Numstat drives the file set (it covers tracked + the
// synthetic untracked rows gitinfo appends); status supplies the A/M/D letter. Binary numstat ("-")
// counts as 0.
func parseNumstatStatus(numstat, statusZ string) []waveobj.EvidenceFile {
	stat := map[string]string{}
	for _, entry := range strings.Split(statusZ, "\x00") {
		if len(entry) < 3 {
			continue
		}
		xy, path := entry[:2], entry[3:]
		stat[path] = statusLetter(xy)
	}
	var out []waveobj.EvidenceFile
	for _, row := range strings.Split(numstat, "\n") {
		cols := strings.SplitN(row, "\t", 3)
		if len(cols) != 3 {
			continue
		}
		add, _ := strconv.Atoi(cols[0]) // "-" (binary) -> 0
		del, _ := strconv.Atoi(cols[1])
		path := cols[2]
		letter := stat[path]
		if letter == "" {
			letter = "M"
		}
		out = append(out, waveobj.EvidenceFile{Path: path, Stat: letter, Add: add, Del: del})
	}
	return out
}

func statusLetter(xy string) string {
	for _, c := range xy {
		switch c {
		case 'A', '?':
			return "A"
		case 'D':
			return "D"
		case 'M', 'R', 'C':
			return "M"
		}
	}
	return "M"
}

var imageExt = map[string]bool{".png": true, ".jpg": true, ".jpeg": true, ".gif": true, ".svg": true, ".webp": true}

func artifactKind(path string) string {
	switch ext := strings.ToLower(filepath.Ext(path)); {
	case ext == ".md" || ext == ".txt":
		return "doc"
	case ext == ".html" || ext == ".htm":
		return "report"
	case imageExt[ext]:
		return "image"
	default:
		return "file"
	}
}

// evidenceRoute is the route a run actually ran on: its harness, and the model its transcript reports, else the
// model its route pinned. An empty model is honest: the runtime default ran and the transcript never named it.
func evidenceRoute(run *waveobj.Run, observedModel string) (harness, model string) {
	harness = runroute.DefaultRuntime(run.Runtime)
	model = observedModel
	if model == "" {
		model = run.Model
	}
	return harness, model
}

// RunRoute is the harness and model a run worked on: the model its last transcript reports, else its pinned one.
func RunRoute(run *waveobj.Run) (harness, model string) {
	return evidenceRoute(run, observedModelFn(run))
}

func evidenceHash(ev waveobj.RunEvidence) string {
	ev.Hash = "" // hash excludes itself
	ev.CapturedTs = 0
	b, _ := json.Marshal(ev)
	sum := sha256.Sum256(b)
	return fmt.Sprintf("ev·%x", sum[:3])
}

// dagVerifs is the plan's Verify as the engine ran it, for a run that owns a dag: one entry per task it ran
// after, carrying that task's newest result (a timed-out Verify whose re-run passed reads as passed), in dag
// order. A child run shares its owner's DagORef but is sealed before its Verify runs, so it gets none. A
// read error fails the seal, so the backfill retries rather than freezing a snapshot missing its checks. A
// stale DagORef naming no stored dag reads as "no Verify recorded" rather than failing the seal.
func dagVerifs(ctx context.Context, run *waveobj.Run) ([]waveobj.EvidenceVerif, error) {
	if run.DagORef == "" {
		return nil, nil
	}
	g, err := wstore.GetDag(ctx, run.DagORef)
	if errors.Is(err, wstore.ErrNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("evidence: loading dag %s: %w", run.DagORef, err)
	}
	if g.RunID != run.ID || g.Verify == "" {
		return nil, nil
	}
	kinds := []string{waveobj.RunEventKindTaskVerifyPassed, waveobj.RunEventKindTaskVerifyFailed}
	events, err := wstore.QueryRunEventsByKind(ctx, run.ChannelOID, run.ID, kinds, 0)
	if err != nil {
		return nil, fmt.Errorf("evidence: reading Verify results: %w", err)
	}
	type result struct {
		failed bool
		reason string
	}
	newest := map[string]result{}
	for _, ev := range events { // newest first
		var d struct {
			TaskId string `json:"taskid"`
			Reason string `json:"reason"`
		}
		if json.Unmarshal(ev.Detail, &d) != nil || d.TaskId == "" {
			continue
		}
		if _, seen := newest[d.TaskId]; !seen {
			newest[d.TaskId] = result{failed: ev.Kind == waveobj.RunEventKindTaskVerifyFailed, reason: d.Reason}
		}
	}
	var out []waveobj.EvidenceVerif
	for _, t := range g.Tasks {
		r, ok := newest[t.ID]
		if !ok {
			continue
		}
		v := waveobj.EvidenceVerif{Cmd: g.Verify, Result: "pass", Detail: "after " + t.ID}
		if r.failed {
			v.Result = "fail"
			if r.reason != "" {
				v.Detail += ": " + r.reason
			}
		}
		out = append(out, v)
	}
	return out, nil
}

// dagVerification is how the final stage judged the merged result of the dag run owns, or nil while the stage
// has not reached an outcome (or the run owns no dag). Read errors fail the seal, as dagVerifs' do.
func dagVerification(ctx context.Context, run *waveobj.Run) (*waveobj.RunVerification, error) {
	if run.DagORef == "" {
		return nil, nil
	}
	g, err := wstore.GetDag(ctx, run.DagORef)
	if errors.Is(err, wstore.ErrNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("evidence: loading dag %s: %w", run.DagORef, err)
	}
	if g.RunID != run.ID || g.Final == nil {
		return nil, nil
	}
	switch g.Final.State {
	case "passed":
		return &waveobj.RunVerification{State: g.Final.State}, nil
	case "unverified":
		return &waveobj.RunVerification{State: g.Final.State, Reasons: g.Final.Unverified}, nil
	case "failed":
		return &waveobj.RunVerification{State: g.Final.State, Reasons: []string{g.Final.Detail}}, nil
	}
	return nil, nil
}

// dagRecord is the dag owner's account of its tasks, snapshotted so a later change to the dag cannot rewrite it.
// Sections are whole: this is the record, not a prompt. Done is left out; `wsh jarvis dag report` reads it. A
// worker's run gets none, and read errors fail the seal, as dagVerifs' do.
func dagRecord(ctx context.Context, run *waveobj.Run) (*waveobj.EvidenceDag, error) {
	if run.DagORef == "" || run.TaskId != "" {
		return nil, nil
	}
	g, err := wstore.GetDag(ctx, run.DagORef)
	if errors.Is(err, wstore.ErrNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("evidence: loading dag %s: %w", run.DagORef, err)
	}
	if g.RunID != run.ID {
		return nil, nil
	}
	kinds := []string{waveobj.RunEventKindChildAnswered, waveobj.RunEventKindTaskForwarded, waveobj.RunEventKindTaskTold, waveobj.RunEventKindTaskReviewPassed}
	events, err := wstore.QueryRunEventsByKind(ctx, run.ChannelOID, run.ID, kinds, 0)
	if err != nil {
		return nil, fmt.Errorf("evidence: reading the dag's events: %w", err)
	}
	tally := TallyDagEvents(events)
	rec := &waveobj.EvidenceDag{Answered: tally.Answered, Forwarded: tally.Forwarded}
	for _, m := range tally.Told {
		rec.Told = append(rec.Told, m.TaskId+": "+m.Text)
	}
	// the newest pass decides whether For later tasks went to the lead: a sendback's later pass may route it elsewhere
	forLead := map[string]bool{}
	for _, ev := range events { // newest first
		var d struct {
			TaskId  string `json:"taskid"`
			ForLead bool   `json:"forlead"`
		}
		if ev.Kind != waveobj.RunEventKindTaskReviewPassed || json.Unmarshal(ev.Detail, &d) != nil || d.TaskId == "" {
			continue
		}
		if _, seen := forLead[d.TaskId]; !seen {
			forLead[d.TaskId] = d.ForLead
		}
	}
	workers := map[string]*waveobj.Run{}
	for _, r := range DagChildRuns(ctx, run.ChannelOID, run.DagORef, run.ID) {
		workers[r.ID] = r
	}
	for i := range g.Tasks {
		t := &g.Tasks[i]
		if t.CleanupError != "" {
			rec.LeftBehind = append(rec.LeftBehind, t.ID)
		}
		switch t.State {
		case taskStateDone, taskStateSkipped, taskStateFailed:
			rec.Tasks = append(rec.Tasks, dagRecordTask(t, workers[t.RunID], forLead[t.ID]))
		}
	}
	return rec, nil
}

func dagRecordTask(t *waveobj.TaskNode, worker *waveobj.Run, forLead bool) waveobj.EvidenceDagTask {
	row := waveobj.EvidenceDagTask{TaskId: t.ID, Label: t.Label, State: t.State, ReviewRounds: t.ReviewRound, ReviewerUnverified: t.ReviewUnverified}
	if worker == nil {
		return row
	}
	row.Commit = worker.EndCommit
	if worker.Evidence == nil {
		return row
	}
	rep, unstructured := ReadWorkerReport(worker.Evidence.Summary)
	row.Unstructured = unstructured
	row.Differs, row.NotVerified, row.FoundNotFixed = rep.Differs, rep.NotVerified, rep.FoundNotFixed
	if forLead {
		row.ForLead = rep.ForLater
	}
	return row
}

// RunTrailerKey is the commit trailer that marks a commit as a run's own: the engine writes
// `Arc-Run: <runId>-t-N` on each lane it lands and the lead ends its own commits with `Arc-Run: <runId>`.
const RunTrailerKey = "Arc-Run"

// landsOnCheckout reports whether run is an engine run landing straight on its checkout. Its commits
// interleave there with other sessions', so BaseCommit..EndCommit is not its own history; a run landing
// on its own branch, and a dag child in its own worktree, keep the plain range.
func landsOnCheckout(run *waveobj.Run) bool {
	return run.DagORef != "" && run.TaskId == "" && run.LandPath == ""
}

// ownsRunMarker accepts the trailer values run runID wrote. The "-" keeps run R2 out of run R.
func ownsRunMarker(runID string) func(string) bool {
	return func(v string) bool { return v == runID || strings.HasPrefix(v, runID+"-") }
}

// SealEvidence derives and freezes a run's evidence snapshot. Idempotent: a run that already has
// Evidence is left untouched (immutability). Locates transcripts from phase WorkerOrefs and git data
// from ProjectPath — everything it needs is on the run. A transcript I/O failure degrades that section
// to empty, but a git failure or a context timeout fails the seal (returns an error, leaves Evidence nil)
// so the backfill can retry rather than freezing an empty file list into the immutable snapshot.
func SealEvidence(ctx context.Context, run *waveobj.Run) error {
	if run == nil || run.Evidence != nil {
		return nil
	}
	completedTs := lastPhaseDoneTs(run)
	if completedTs == 0 {
		completedTs = time.Now().UnixMilli()
	}
	run.CompletedTs = completedTs

	// transcript-derived: summary (the lead's report, else the last worker's final text) + verifications
	// (all workers)
	summary := run.Report
	var verifs []waveobj.EvidenceVerif
	transcripts := workerTranscripts(run)
	if len(transcripts) > 0 {
		if summary == "" {
			summary = finalAssistantText(transcripts[len(transcripts)-1])
		}
		acc := newVerifAccum()
		for _, lines := range transcripts {
			acc.addTranscript(lines)
		}
		verifs = acc.out
	}
	dv, err := dagVerifs(ctx, run)
	if err != nil {
		return err
	}
	verifs = append(verifs, dv...)
	verification, err := dagVerification(ctx, run)
	if err != nil {
		return err
	}
	record, err := dagRecord(ctx, run)
	if err != nil {
		return err
	}

	// git-derived: files touched. prefer the run's own commit range (BaseCommit..EndCommit) — under
	// delegator fan-out the shared ProjectPath tree holds every sibling merged since BaseCommit, so a
	// working-tree diff over-attributes. fall back to the working-tree-vs-baseline diff when the worker
	// reported no commit (the common single-run case, unchanged) or the reported SHA is unresolvable.
	// a git failure or context timeout must NOT seal an empty file list into the immutable snapshot —
	// return an error and leave Evidence nil so the backfill (SealRunEvidenceCommand) retries. a clean
	// non-repo result (IsRepo false, no error) is a legitimate empty.
	var files []waveobj.EvidenceFile
	var addTotal, delTotal int
	var ch *gitinfo.Changes
	var gerr error
	if run.EndCommit != "" && run.EndCommit != run.BaseCommit {
		rangeChanges := gitinfo.GetRangeChanges
		if landsOnCheckout(run) {
			rangeChanges = func(ctx context.Context, cwd, from, to string) (*gitinfo.Changes, error) {
				return gitinfo.GetTrailerCommitsChanges(ctx, cwd, from, to, RunTrailerKey, ownsRunMarker(run.ID))
			}
		}
		if ch, gerr = rangeChanges(ctx, run.ProjectPath, run.BaseCommit, run.EndCommit); gerr != nil {
			ch, gerr = gitinfo.GetChanges(ctx, run.ProjectPath, run.BaseCommit) // reported SHA unresolvable
		}
	} else {
		ch, gerr = gitinfo.GetChanges(ctx, run.ProjectPath, run.BaseCommit)
	}
	if gerr != nil {
		return fmt.Errorf("evidence: computing git changes: %w", gerr)
	}
	if ctx.Err() != nil {
		return fmt.Errorf("evidence: computing git changes: %w", ctx.Err())
	}
	if ch.IsRepo {
		files = parseNumstatStatus(ch.Numstat, ch.StatusZ)
		for i := range files {
			addTotal += files[i].Add
			delTotal += files[i].Del
		}
	}

	// artifacts: aggregate phase artifacts, classify + size
	var artifacts []waveobj.EvidenceArtifact
	seen := map[string]bool{}
	for _, p := range run.Phases {
		for _, a := range p.Artifacts {
			if a == "" || seen[a] {
				continue
			}
			seen[a] = true
			art := waveobj.EvidenceArtifact{Path: a, Kind: artifactKind(a)}
			if info, err := os.Stat(resolveUnder(LandPath(run), a)); err == nil {
				art.Size = info.Size()
			}
			artifacts = append(artifacts, art)
		}
	}

	ev := waveobj.RunEvidence{
		CapturedTs: completedTs,
		Summary:    summary,
		Files:      files, AddTotal: addTotal, DelTotal: delTotal,
		Verifs:     verifs,
		Artifacts:  artifacts,
		RuntimeMs:  activeSpanMs(run),
		DurationMs: completedTs - run.CreatedTs,
	}
	ev.Verification = verification
	ev.Dag = record
	// recomputed here rather than copied from the dag, whose total froze before the lead wrote its report
	if run.DagORef != "" && UsageRole(run) == UsageRole_Lead {
		ev.Usage = RunUsage(ctx, run, DagChildRuns(ctx, run.ChannelOID, run.DagORef, run.ID))
	}
	ev.Harness, ev.Model = RunRoute(run)
	ev.Hash = evidenceHash(ev)
	run.Evidence = &ev
	return nil
}

func lastPhaseDoneTs(run *waveobj.Run) int64 {
	var ts int64
	for _, p := range run.Phases {
		if p.DoneTs > ts {
			ts = p.DoneTs
		}
	}
	return ts
}

// activeSpanMs sums each phase's [StartedTs, DoneTs] span — active compute vs wall clock.
func activeSpanMs(run *waveobj.Run) int64 {
	var sum int64
	for _, p := range run.Phases {
		if p.StartedTs > 0 && p.DoneTs > p.StartedTs {
			sum += p.DoneTs - p.StartedTs
		}
	}
	return sum
}

// transcriptRootFor resolves a runtime's transcript root (a var so tests can point it at a temp dir).
var transcriptRootFor = agentsessions.SessionRoot

// SessionTranscriptPath is the transcript written by a run launched under a session id, or "" when it has
// no session id or its runtime has not written one.
func SessionTranscriptPath(run *waveobj.Run) string {
	return agentsessions.TranscriptForSession(transcriptRootFor(run.Runtime), run.Runtime, run.ProjectPath, run.SessionId)
}

// sessionTranscriptLines reads the transcript named by a run's session id. pi's is read along its active
// branch through pisession, so turns on an abandoned branch are not counted.
func sessionTranscriptLines(run *waveobj.Run) []string {
	path := SessionTranscriptPath(run)
	if path == "" {
		return nil
	}
	if run.Runtime != "pi" {
		return readTranscriptLines(path)
	}
	file, err := pisession.Read(path)
	if err != nil {
		log.Printf("evidence: reading pi session: %v", err)
		return nil
	}
	branch, err := file.ActiveBranch()
	if err != nil {
		log.Printf("evidence: pi session branch: %v", err)
		return nil
	}
	lines := make([]string, len(branch))
	for i, e := range branch {
		lines[i] = string(e.Raw)
	}
	return lines
}

// workerTranscripts returns every non-skipped phase worker's transcript lines, in phase order with
// workers in oref order. A run the engine launched under a session id has one worker, whose transcript
// is named by that id; other runs (leads, quick runs) resolve each worker tab's cwd. Unresolvable
// transcripts (a torn-down worker tab) are skipped; an empty result means no worker transcript was
// readable.
func workerTranscripts(run *waveobj.Run) [][]string {
	if run.SessionId != "" {
		if lines := sessionTranscriptLines(run); len(lines) > 0 {
			return [][]string{lines}
		}
		return nil
	}
	var out [][]string
	for _, p := range run.Phases {
		if p.State == PhaseState_Skipped {
			continue
		}
		for _, oref := range p.WorkerOrefs {
			if !strings.HasPrefix(oref, "tab:") {
				continue
			}
			id := strings.TrimPrefix(oref, "tab:")
			if path := TranscriptPathForTab(id); path != "" {
				if lines := readTranscriptLines(path); len(lines) > 0 {
					out = append(out, lines)
				}
			}
		}
	}
	return out
}

// observedModelFn reads the model a run's last worker transcript reports ("" when unreadable). A var so tests
// can seal evidence without a transcript on disk.
var observedModelFn = observedRunModel

// observedRunModel resolves the same last transcript workerTranscripts would read and extracts the model its
// last assistant message reports. A transcript I/O failure or unreadable path degrades to "" — evidence still
// falls back to the run's pinned model, so this never blocks a seal.
func observedRunModel(run *waveobj.Run) string {
	var path string
	if run.SessionId != "" {
		path = SessionTranscriptPath(run)
	} else {
		for i := len(run.Phases) - 1; i >= 0; i-- {
			p := run.Phases[i]
			if p.State == PhaseState_Skipped {
				continue
			}
			for j := len(p.WorkerOrefs) - 1; j >= 0; j-- {
				oref := p.WorkerOrefs[j]
				if !strings.HasPrefix(oref, "tab:") {
					continue
				}
				if path = TranscriptPathForTab(strings.TrimPrefix(oref, "tab:")); path != "" {
					break
				}
			}
			if path != "" {
				break
			}
		}
	}
	if path == "" {
		return ""
	}
	sess, err := agentsessions.ExtractSession(path, runroute.DefaultRuntime(run.Runtime))
	if err != nil || sess == nil {
		return ""
	}
	return sess.Model
}

func readTranscriptLines(path string) []string {
	f, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer f.Close()
	var lines []string
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 1024*1024), 16*1024*1024) // transcripts have long JSONL records
	for sc.Scan() {
		if t := strings.TrimSpace(sc.Text()); t != "" {
			lines = append(lines, t)
		}
	}
	return lines
}

func resolveUnder(projectPath, artifact string) string {
	if filepath.IsAbs(artifact) {
		return artifact
	}
	return filepath.Join(projectPath, artifact)
}

// TranscriptPathForTab resolves a worker tab's on-disk Claude transcript via the block's cwd. Returns ""
// when the tab/block/transcript can't be resolved (a torn-down worker) — the caller degrades gracefully.
func TranscriptPathForTab(tabId string) string {
	ctx := context.Background()
	tab, err := wstore.DBMustGet[*waveobj.Tab](ctx, tabId)
	if err != nil || len(tab.BlockIds) == 0 {
		return ""
	}
	block, err := wstore.DBMustGet[*waveobj.Block](ctx, tab.BlockIds[0])
	if err != nil {
		return ""
	}
	cwd := block.Meta.GetString(waveobj.MetaKey_CmdCwd, "")
	if cwd == "" {
		cwd = block.Meta.GetString(waveobj.MetaKey_File, "")
	}
	if cwd == "" {
		return ""
	}
	projectsRoot := filepath.Join(wavebase.GetHomeDir(), ".claude", "projects")
	return agentobserve.ActiveTranscript(projectsRoot, cwd)
}
