// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jarvis

import (
	"context"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/agentsessions"
	"github.com/wavetermdev/waveterm/pkg/blockcontroller"
	"github.com/wavetermdev/waveterm/pkg/filestore"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

func init() {
	blockcontroller.AgentOutcomeHook = OnWorkerExit
}

// exitReadTimeout bounds an exit's own reads. The child-outcome hook runs past it: it can wait on a dag lock.
var exitReadTimeout = 10 * time.Second

func notifyChildOutcome(ctx context.Context, workerORef string, data OutcomeData) {
	if ChildOutcomeHook == nil {
		return
	}
	if err := ChildOutcomeHook(ctx, workerORef, data); err != nil {
		log.Printf("jarvis child outcome for %s: %v", workerORef, err)
	}
}

// WorkerExit is how an agent worker's process ended: its exit code and, for a failing one, the end of what
// it printed.
type WorkerExit struct {
	ExitCode int
	Output   string
}

// RunWorkerExitHook, when set (by pkg/orchestrate at init), hears every agent worker tab exit before its
// transcript is read: a worker that exits without completing its phase must fail the run whether or not its
// transcript parses, and a Claude session may not have written one yet.
var RunWorkerExitHook func(context.Context, string, WorkerExit) error

func notifyRunWorkerExit(ctx context.Context, workerORef string, exit WorkerExit) {
	if RunWorkerExitHook == nil {
		return
	}
	if err := RunWorkerExitHook(ctx, workerORef, exit); err != nil {
		log.Printf("jarvis run worker exit for %s: %v", workerORef, err)
	}
}

// what a failed worker's exit keeps of its terminal: enough for a launcher's error, not a session's scrollback
const (
	workerOutputReadBytes = 8 * 1024
	workerOutputMaxLines  = 20
	workerOutputMaxBytes  = 2000
)

// readWorkerTerminal reads the end of a block's terminal file. A var so tests need no filestore.
var readWorkerTerminal = func(ctx context.Context, blockId string) ([]byte, error) {
	file, err := filestore.WFS.Stat(ctx, blockId, wavebase.BlockFile_Term)
	if err != nil {
		return nil, err
	}
	_, data, err := filestore.WFS.ReadAt(ctx, blockId, wavebase.BlockFile_Term, max(0, file.Size-workerOutputReadBytes), workerOutputReadBytes)
	return data, err
}

// workerOutputTail is the last lines a worker printed, as plain text. An agent worker's tab closes itself two
// seconds after its process exits and its terminal goes with it, so a worker that died at launch left no
// account of why (run d8fe96ab's t-2); the exit is the only moment the terminal can still be read.
func workerOutputTail(ctx context.Context, blockId string) string {
	raw, err := readWorkerTerminal(ctx, blockId)
	if err != nil {
		log.Printf("jarvis onexit: reading the terminal of block %s: %v", blockId, err)
		return ""
	}
	return outputTail(string(raw))
}

func outputTail(raw string) string {
	var lines []string
	for _, line := range strings.FieldsFunc(utilfn.StripANSI(raw), func(r rune) bool { return r == '\n' || r == '\r' }) {
		if line = strings.TrimSpace(line); line != "" {
			lines = append(lines, line)
		}
	}
	if len(lines) > workerOutputMaxLines {
		lines = lines[len(lines)-workerOutputMaxLines:]
	}
	out := strings.Join(lines, "\n")
	if len(out) > workerOutputMaxBytes {
		out = out[len(out)-workerOutputMaxBytes:]
	}
	// a byte cut, here or at the start of the read, can split a rune
	return strings.ToValidUTF8(out, "")
}

// OnWorkerExit posts a channel "outcome" message when a dispatched agent worker's process exits: it
// reads the transcript path stamped on the block by the hook, derives status+summary from the
// transcript (agentsessions), and posts to the dispatching channel (PostOutcome). No-op for a
// non-agent block or a block with no stamped transcript; every other failure logs — a silent exit
// is indistinguishable from "worker produced nothing". The run-worker-exit hook fires for every agent
// session exit before the transcript is even considered, so a run still gets reconciled (F26) when the
// transcript never parses or the clean-exit/no-transcript case leaves nothing to post.
// Fire-and-forget; injected into blockcontroller.AgentOutcomeHook at init to avoid an import cycle.
func OnWorkerExit(blockId string, exitCode int) {
	ctx, cancel := context.WithTimeout(context.Background(), exitReadTimeout)
	defer cancel()
	blockData, err := wstore.DBMustGet[*waveobj.Block](ctx, blockId)
	if err != nil {
		log.Printf("jarvis onexit: block %s unreadable: %v", blockId, err)
		return
	}
	tabId, err := wstore.DBFindTabForBlockId(ctx, blockId)
	if err != nil {
		log.Printf("jarvis onexit: tab lookup for block %s failed: %v", blockId, err)
		return
	}
	tab, err := wstore.DBMustGet[*waveobj.Tab](ctx, tabId)
	if err != nil {
		log.Printf("jarvis onexit: tab %s unreadable: %v", tabId, err)
		return
	}
	runtime := tab.Meta.GetString("session:agent", "")
	if runtime == "" {
		return // not an agent session
	}
	workerORef := waveobj.MakeORef(waveobj.OType_Tab, tabId).String()
	exit := WorkerExit{ExitCode: exitCode}
	if exitCode != 0 {
		exit.Output = workerOutputTail(ctx, blockId)
	}
	notifyRunWorkerExit(ctx, workerORef, exit)

	tpath := blockData.Meta.GetString(waveobj.MetaKey_AgentTranscriptPath, "")
	if !reportableExit(tpath, exitCode) {
		return
	}
	data, ok := exitOutcome(tpath, runtime, exitCode)
	if !ok {
		return
	}
	// resolved before the hook, which can wait on a dag lock past this context's deadline
	ch := resolveDispatchChannelForWorker(ctx, workerORef)
	notifyChildOutcome(ctx, workerORef, data)
	// nil is a worker no channel dispatched, an engine worker's normal case: there is no channel outcome to post
	if ch == nil {
		return
	}
	PostOutcome(ch, workerORef, runtime, data)
}

// reportableExit reports whether an exited worker's outcome is worth resolving at all. A clean exit
// that stamped no transcript is a runtime whose reporter hook is not installed — the documented
// normal case, and by far the most common — so it is taken before the tab lookup and stays silent.
func reportableExit(tpath string, exitCode int) bool {
	return tpath != "" || exitCode != 0
}

// exitOutcome derives the outcome of an exited agent worker, and whether there is one to report.
// The transcript is the normal source. An agent that exited NON-ZERO having never stamped one is the
// case no watcher can see: it died before its first token (rejected model, missing entitlement, auth
// failure), so liveness has no mtime to age and the work reads healthy until the stall threshold
// expires. A clean exit with no transcript is left alone as before — that is a runtime whose reporter
// hook is not installed, not a failure.
func exitOutcome(tpath, runtime string, exitCode int) (OutcomeData, bool) {
	if !reportableExit(tpath, exitCode) {
		return OutcomeData{}, false
	}
	if tpath == "" {
		return OutcomeData{
			Status:       "failed",
			Summary:      fmt.Sprintf("exited with code %d before writing a transcript — the agent died before its first token", exitCode),
			ExitCode:     exitCode,
			NoTranscript: true,
		}, true
	}
	sess, err := agentsessions.ExtractSession(tpath, runtime)
	if err != nil || sess == nil {
		log.Printf("jarvis onexit: transcript %s parse failed: %v", tpath, err)
		return OutcomeData{}, false
	}
	return OutcomeData{
		Status:     OutcomeStatus(sess.Status),
		Summary:    outcomeSummary(sess),
		DurationMs: sess.DurationMs,
		ExitCode:   exitCode,
	}, true
}

// outcomeSummary picks a short "what came of it" line from a session: the last event's text (the
// events list ends with a "finished" entry for a done session), falling back to the task, trimmed.
func outcomeSummary(sess *agentsessions.SessionInfo) string {
	text := sess.Task
	if n := len(sess.Events); n > 0 && sess.Events[n-1].Text != "" {
		text = sess.Events[n-1].Text
	}
	const maxLen = 160
	if len(text) > maxLen {
		text = text[:maxLen]
	}
	return text
}
