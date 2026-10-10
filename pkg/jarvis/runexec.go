// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jarvis

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/blockcontroller"
	"github.com/wavetermdev/waveterm/pkg/harness"
	"github.com/wavetermdev/waveterm/pkg/runroute"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wcore"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// RunWorkerSpec is the unattended launch form for one harness's run worker: the executable plus the
// argument prefix that goes before the prompt. The prompt travels positionally for claude, pi and codex,
// and after -i for agy.
type RunWorkerSpec struct {
	Bin  string
	Args []string
	// BaseArgs is Args without the session id and the prompt: the launch flags resume-on-reopen recomposes
	// as `<bin> --resume <id> <BaseArgs>`. --session-id is left out because a resume names its own session.
	BaseArgs []string
}

// RunWorkerSpecFor resolves the unattended worker launch form from one validated capability. The
// capability authority owns runtime/model compatibility and model selection; this adapter only supplies
// each runtime's unattended base arguments. A non-empty sessionId names the worker's session: claude and pi
// take --session-id and name the transcript by it; agy and codex name their own session, so they never get one.
func RunWorkerSpecFor(cap runroute.Capability, sessionId, prompt string) (RunWorkerSpec, bool) {
	if !runroute.IsValid(cap) {
		return RunWorkerSpec{}, false
	}
	h, ok := harness.Lookup(cap.Runtime)
	if !ok || !h.RunWorkerCapable {
		return RunWorkerSpec{}, false
	}
	var args []string
	// promptFlag precedes the prompt: agy opens its TUI on a prompt only through -i
	var promptFlag []string
	switch cap.Runtime {
	case "claude":
		args = []string{"--dangerously-skip-permissions"}
	case "pi":
		args = nil
	case "agy":
		args = []string{"--dangerously-skip-permissions"}
		promptFlag = []string{"-i"}
	case "codex":
		// a positional prompt opens the interactive TUI on it (never `codex exec`: the worker stays a live
		// terminal). Setting the approval/sandbox mode on the command line also skips the "trust this folder"
		// screen in a fresh worktree. Codex runs a user hook only once the person trusted it with /hooks, and
		// a worker that never reports its session id stalls at the first-token deadline.
		args = []string{"--dangerously-bypass-approvals-and-sandbox", "--dangerously-bypass-hook-trust"}
	default:
		return RunWorkerSpec{}, false
	}
	baseArgs := append(append([]string{}, args...), cap.ModelArgs...)
	if sessionId != "" && !h.AssignsOwnSession {
		args = append(args, "--session-id", sessionId)
	}
	args = append(args, cap.ModelArgs...)
	args = append(args, promptFlag...)
	args = append(args, prompt)
	return RunWorkerSpec{Bin: h.Bin, Args: args, BaseArgs: baseArgs}, true
}

// WorkerSessionId is the session id to hand a new worker of runtime: a fresh UUID for a runtime that takes
// --session-id, "" for one that names its own session (agy, codex), whose id the engine learns from its first
// status report (orchestrate.NoteWorkerSession).
func WorkerSessionId(runtime string) string {
	if spec, ok := harness.Lookup(runtime); ok && spec.AssignsOwnSession {
		return ""
	}
	return uuid.NewString()
}

// ResumeNudge is a resumed worker's first turn. It never restates the task: the session already holds it.
const ResumeNudge = "The app restarted or your process stopped mid-task. Check the working tree and your last steps, then continue the task."

// ResumeWorkerArgs is the command line that reopens a run worker's session, launched with --session-id
// sessionId, and nudges it on: the runtime's resume flag, the worker's launch flags, then nudge as the prompt.
// An empty runtime is a legacy run, which is claude.
func ResumeWorkerArgs(runtime, sessionId string, baseArgs []string, nudge string) ([]string, bool) {
	var flag string
	switch runtime {
	case "", "claude":
		flag = "--resume"
	case "pi":
		flag = "--session" // resolves a session id as well as a path
	case "agy":
		flag = "--conversation"
	case "codex":
		// a subcommand, not a flag: `codex resume <id> <options> <prompt>` (agentResumeFlags in blockcontroller)
		flag = "resume"
	default:
		return nil, false
	}
	args := append([]string{flag, sessionId}, baseArgs...)
	if runtime == "agy" {
		// agy opens its TUI on a prompt only through -i
		args = append(args, "-i")
	}
	return append(args, nudge), true
}

// ResumeRunWorker restarts the worker in tabORef in its own session, in the same tab so the human keeps its
// scrollback, with nudge as its first turn. A var so tests can stub the restart.
var ResumeRunWorker = func(ctx context.Context, tabORef, runtime, sessionId, nudge string) error {
	oref, err := waveobj.ParseORef(tabORef)
	if err != nil || oref.OType != waveobj.OType_Tab {
		return fmt.Errorf("bad worker oref %q", tabORef)
	}
	tab, err := wstore.DBGet[*waveobj.Tab](ctx, oref.OID)
	if err != nil {
		return fmt.Errorf("loading worker tab: %w", err)
	}
	if tab == nil || len(tab.BlockIds) == 0 {
		return fmt.Errorf("the worker's tab is gone")
	}
	blockId := tab.BlockIds[0]
	block, err := wstore.DBMustGet[*waveobj.Block](ctx, blockId)
	if err != nil {
		return fmt.Errorf("loading worker block: %w", err)
	}
	if !block.Meta.HasKey("agent:baseargs") {
		return fmt.Errorf("the worker was launched before resume support")
	}
	args, ok := ResumeWorkerArgs(runtime, sessionId, block.Meta.GetStringList("agent:baseargs"), nudge)
	if !ok {
		return fmt.Errorf("runtime %q cannot resume a session", runtime)
	}
	return configureAndStartWorker(ctx, oref.OID, blockId, waveobj.MetaMapType{waveobj.MetaKey_CmdArgs: args})
}

// SpawnRunWorker creates a background tab set up to run the runtime's unattended worker form in cwd and
// returns its tab oref ("tab:<id>"). It starts nothing: the caller records the worker (its run row, the
// owner stamp on the tab) and then calls StartRunWorker. The exit hook finds a worker's run through those
// records, so a worker started before them that dies at launch fails nothing (run d8fe96ab's t-2 exited a
// second after its spawn and its task read running for 15 minutes).
//
// Mirrors the frontend launchAgent path, but the permission-skip flag is mandatory here (opt-in in the
// launcher): a run worker is headless with no human attached, so without it the agent blocks forever on
// per-tool prompts — alive but never running, never firing the hooks that report agent:status (the
// "worker never starts" symptom). The flag stops there, so claude's separate first-run folder-trust
// prompt is handled by ensureClaudeDirTrusted (see claudetrust.go).
// Configure the new tab's default block as a cmd worker and tag the tab for the roster. It broadcasts
// its tab's workspace update itself when the caller's ctx isn't already collecting updates (the engine's
// dispatch collects none); a caller that does collect — like spawnRunWorkersWithPrompt — flushes them
// itself, on its own schedule.
//
// It is a var so tests can stub the tab-creating boundary without a live tab.

type RunWorkerOptions struct {
	KeepOnExit bool
	// SessionId, when set, is passed as --session-id so the worker's transcript is named by it. It is empty
	// for a runtime that names its own session (WorkerSessionId).
	SessionId string
	// Label, when set, is the tab's session:label: the name every surface shows ahead of the agent's ai-title.
	Label string
	// RunId and TaskId, when set, are stamped on the worker block so the frontend can tell a dead run's
	// worker from a live one before relaunching it. TaskId is empty for a lead.
	RunId  string
	TaskId string
}

// createWorkerTab is the tab-creation seam, so tests make a tab without a layout or a live workspace.
var createWorkerTab = wcore.CreateTab

// sendWorkerTabUpdates broadcasts the object updates a spawn collected. A var so tests can record them.
var sendWorkerTabUpdates = func(updates waveobj.UpdatesRtnType) { wps.Broker.SendUpdateEvents(updates) }

var persistWorkerBlockMeta = func(ctx context.Context, blockID string, meta waveobj.MetaMapType) error {
    _, err := wstore.UpdateObjectMeta(ctx, waveobj.MakeORef(waveobj.OType_Block, blockID), meta, false)
    return err
}

var startWorkerController = func(ctx context.Context, tabID, blockID string) error {
    return blockcontroller.ResyncController(ctx, tabID, blockID, &waveobj.RuntimeOpts{}, true)
}

func configureAndStartWorker(ctx context.Context, tabID, blockID string, meta waveobj.MetaMapType) error {
    if err := persistWorkerBlockMeta(ctx, blockID, meta); err != nil {
        return fmt.Errorf("setting worker block meta: %w", err)
    }
    if err := startWorkerController(ctx, tabID, blockID); err != nil {
        return fmt.Errorf("starting worker controller: %w", err)
    }
    return nil
}

// makeWorkerBlockMeta builds the block meta for a run worker. keepOnExit is true for
// orchestrator leads, whose tab must outlive the lead process while DAG children run.
func makeWorkerBlockMeta(spec RunWorkerSpec, cwd string, keepOnExit bool) waveobj.MetaMapType {
	// non-nil even when empty: a missing agent:baseargs reads as "launched before resume support"
	baseArgs := spec.BaseArgs
	if baseArgs == nil {
		baseArgs = []string{}
	}
	m := waveobj.MetaMapType{
		waveobj.MetaKey_View:       "term",
		waveobj.MetaKey_Controller: "cmd",
		waveobj.MetaKey_Cmd:        spec.Bin,
		waveobj.MetaKey_CmdArgs:    spec.Args,
		"agent:baseargs":           baseArgs,
		waveobj.MetaKey_CmdShell:   false,
		waveobj.MetaKey_CmdJwt:     true,
	}
	if cwd != "" {
		m[waveobj.MetaKey_CmdCwd] = cwd
	}
	if keepOnExit {
		m[waveobj.MetaKey_CmdKeepOnExit] = true
	}
	return m
}

// maxInlinePromptBytes is the largest prompt passed on the worker's command line. Windows caps a whole
// command line at 32,767 UTF-16 units and the pwsh wrapper escapes every quote, so a prompt can nearly
// double; half the cap always fits. UTF-8 bytes never undercount UTF-16 units.
const maxInlinePromptBytes = 16 * 1024

// promptFileDir holds the prompts too long for a command line. Resolved per call because the data dir is
// only known once the server has started; a var so tests write to a temp dir.
var promptFileDir = func() string { return filepath.Join(wavebase.GetWaveDataDir(), "jarvis", "prompts") }

// launchPrompt is the prompt to put on the command line: the prompt itself when it fits, otherwise a
// pointer to a file holding it. Only long prompts move, because claude titles a session from its first
// message and a pointer would give every worker the same title.
func launchPrompt(prompt, sessionId string) (string, error) {
	if len(prompt) <= maxInlinePromptBytes {
		return prompt, nil
	}
	name := sessionId
	if name == "" {
		name = uuid.NewString()
	}
	dir := promptFileDir()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", fmt.Errorf("creating prompt dir: %w", err)
	}
	path := filepath.Join(dir, name+".md")
	if err := os.WriteFile(path, []byte(prompt), 0o644); err != nil {
		return "", fmt.Errorf("writing prompt file: %w", err)
	}
	return fmt.Sprintf("Your instructions are in the file %s (too long for a command line). Read the whole file now and follow it exactly, as if it were this message.", path), nil
}

var SpawnRunWorker = func(ctx context.Context, cap runroute.Capability, workspaceId, projectName, cwd, prompt string, opts RunWorkerOptions) (string, error) {
	if workspaceId == "" {
		return "", fmt.Errorf("workspaceId is required to spawn a worker")
	}
	prompt, err := launchPrompt(prompt, opts.SessionId)
	if err != nil {
		return "", err
	}
	spec, ok := RunWorkerSpecFor(cap, opts.SessionId, prompt)
	if !ok {
		return "", fmt.Errorf("no unattended run worker adapter for runtime %q model %q", cap.Runtime, cap.Model)
	}
	// --dangerously-skip-permissions covers tool prompts, not the first-run folder-trust prompt, so a
	// worker launched into an untrusted project would park there forever with no signal. Every claude
	// spawn is checked, not just leads: a run can pin a non-claude lead with claude workers, making a
	// DAG child the first claude process to touch the project. The check costs one config read and
	// writes at most one entry per project (never per worktree — see claudetrust.go); when it cannot
	// register the trust the spawn fails visibly instead of returning a worker that can never start.
	if cap.Runtime == "claude" && cwd != "" {
		if err := ensureClaudeDirTrusted(cwd); err != nil {
			return "", fmt.Errorf("registering claude folder trust for %s: %w", cwd, err)
		}
	}
	// the new tab reaches the app only as a broadcast workspace update. A caller that collects updates
	// (spawnRunWorkersWithPrompt) flushes them itself; the engine's dispatch collects nothing, so the spawn
	// does, even when it fails part-way, because the tab may already exist.
	if waveobj.ContextGetUpdates(ctx) == nil {
		ctx = waveobj.ContextWithUpdates(ctx)
		defer func() { sendWorkerTabUpdates(waveobj.ContextGetUpdatesRtn(ctx)) }()
	}
	tabId, err := createWorkerTab(ctx, workspaceId, projectName, false, false)
	if err != nil {
		return "", fmt.Errorf("creating worker tab: %w", err)
	}
	tab, err := wstore.DBMustGet[*waveobj.Tab](ctx, tabId)
	if err != nil {
		return "", fmt.Errorf("loading worker tab: %w", err)
	}
	if len(tab.BlockIds) == 0 {
		return "", fmt.Errorf("worker tab %s has no block", tabId)
	}
	blockId := tab.BlockIds[0]

	blockMeta := makeWorkerBlockMeta(spec, cwd, opts.KeepOnExit)
	if opts.RunId != "" {
		blockMeta["agent:runid"] = opts.RunId
	}
	if opts.TaskId != "" {
		blockMeta["agent:taskid"] = opts.TaskId
	}
	// Tab meta: put the worker in the agent roster (and route the external status reporter). These keys
	// have no generated constants; the literals match the frontend (see launchAgent).
	tabMeta := waveobj.MetaMapType{
		"session:agent":   cap.Runtime,
		"session:project": projectName,
	}
	if opts.Label != "" {
		tabMeta["session:label"] = opts.Label
	}
	if _, err := wstore.UpdateObjectMeta(ctx, waveobj.MakeORef(waveobj.OType_Tab, tabId), tabMeta, false); err != nil {
		return "", fmt.Errorf("setting worker tab meta: %w", err)
	}
	if err := persistWorkerBlockMeta(ctx, blockId, blockMeta); err != nil {
		return "", fmt.Errorf("setting worker block meta: %w", err)
	}
	return waveobj.MakeORef(waveobj.OType_Tab, tabId).String(), nil
}

// StartRunWorker launches the process of a worker SpawnRunWorker set up, force-starting its controller
// (controllers otherwise start lazily on a frontend terminal resync — force=true launches it headlessly).
// A var so tests can stub the process-spawning boundary without a live tab/PTY.
var StartRunWorker = func(ctx context.Context, tabORef string) error {
	oref, err := waveobj.ParseORef(tabORef)
	if err != nil || oref.OType != waveobj.OType_Tab {
		return fmt.Errorf("bad worker oref %q", tabORef)
	}
	tab, err := wstore.DBMustGet[*waveobj.Tab](ctx, oref.OID)
	if err != nil {
		return fmt.Errorf("loading worker tab: %w", err)
	}
	if len(tab.BlockIds) == 0 {
		return fmt.Errorf("worker tab %s has no block", oref.OID)
	}
	blockId := tab.BlockIds[0]
	if err := startWorkerController(ctx, oref.OID, blockId); err != nil {
		return fmt.Errorf("starting worker controller: %w", err)
	}
	// Make the worker visible in the roster immediately. The roster keys off agent:status, which
	// otherwise arrives only from the external reporter hook — unreliable for a headless worker (the
	// hook may be owned by a coexisting install and route to the wrong wavesrv). A real hook event
	// later refines this (detail/model, idle-on-stop).
	wps.Broker.Publish(initialWorkerStatusEvent(blockId, tab.Meta.GetString("session:agent", ""), time.Now().UnixMilli()))
	return nil
}

// initialWorkerStatusEvent is the retained agent:status the backend emits at spawn so a run worker
// enters the cockpit roster without waiting on the external reporter hook. Delegates to the shared
// constructor so spawn (working) and exit (idle) events share one shape.
func initialWorkerStatusEvent(blockId, runtime string, ts int64) wps.WaveEvent {
	return blockcontroller.AgentStatusEvent(blockId, baseds.AgentState_Working, runtime, ts)
}

// phasePrompt builds the initial worker prompt for a run's phase: an orchestrator run gets the lead
// prompt, every other shape the bare worker prompt.
func phasePrompt(run *waveobj.Run) string {
	if run.Mode == RunMode_Orchestrator {
		return BuildOrchestratePrompt(run.Goal, run.Principles, run.Runtime)
	}
	return BuildQuickPrompt(run.Goal, run.Principles, run.Runtime)
}

// SpawnedWorker is one worker EnsureWorkers launched: its tab oref and the session id its transcript is
// named by.
type SpawnedWorker struct {
	ORef      string
	SessionId string
}

// EnsureWorkers spawns a worker for each running phase that has none yet, returning the phase
// index -> worker it created. It does not mutate/persist the run or start a process; the caller attaches
// the orefs, records the session id, and then starts each worker (StartRunWorker). The runtime comes from
// the persisted run; an empty runtime (legacy Run) resolves to Claude, the historical worker
// implementation. On a spawn error it returns what it has so far plus the
// error (the caller still persists partial work). A non-empty prompt replaces the phase's own: a lead
// started after its plan was submitted works from the orchestration rules, not the goal-run launch prompt.
func EnsureWorkers(ctx context.Context, run *waveobj.Run, cap runroute.Capability, projectName, prompt string) (map[int]SpawnedWorker, error) {
	spawned := map[int]SpawnedWorker{}
	for i := range run.Phases {
		p := run.Phases[i]
		if p.State != PhaseState_Running || len(p.WorkerOrefs) > 0 {
			continue
		}
		workerPrompt := prompt
		if workerPrompt == "" {
			workerPrompt = phasePrompt(run)
		}
		// without a session id the evidence seal can only guess the transcript from the worker's cwd, where
		// another agent's session may be newer
		opts := RunWorkerOptions{KeepOnExit: run.Mode == RunMode_Orchestrator, SessionId: WorkerSessionId(cap.Runtime), RunId: run.ID}
		if run.Mode == RunMode_Orchestrator || len(workerPrompt) > maxInlinePromptBytes {
			// named after its run: its ai-title would come from its first prompt, which on a plan run is a wake,
			// and for a prompt too long for a command line is the pointer to the file holding it
			opts.Label = strings.TrimSpace(strings.SplitN(run.Goal, "\n", 2)[0])
		}
		oref, err := SpawnRunWorker(ctx, cap, run.WorkspaceId, projectName, LandPath(run), workerPrompt, opts)
		if err != nil {
			return spawned, fmt.Errorf("spawning worker for phase %d: %w", i, err)
		}
		spawned[i] = SpawnedWorker{ORef: oref, SessionId: opts.SessionId}
	}
	return spawned, nil
}
