// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/claudequota"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

const transcriptTailBytes = 64 * 1024

// a hook has 10s in all; the reveal only attaches, so the cockpit answers at once or not at all
const canvasRevealTimeoutMs = 2000

// a design-local board: <project>/.superpowers/design/<topic>/project/<Board>.dc.html. Mirrors BOARD_PATH in
// frontend/app/view/agents/canvasmodel.ts.
var canvasBoardPathRe = regexp.MustCompile(`(?i)^(.+?)[\\/]\.superpowers[\\/]design[\\/]([^\\/]+)[\\/]project[\\/][^\\/]+\.dc\.html$`)

const bashDetailMax = 60
const titleMax = 72 // fallback head-text length cap (rune-safe)

// ccHookEvent is the subset of the Claude Code lifecycle-hook stdin payload we use.
type ccHookEvent struct {
	HookEventName    string          `json:"hook_event_name"`
	SessionID        string          `json:"session_id"`
	ToolName         string          `json:"tool_name"`
	ToolUseID        string          `json:"tool_use_id"`
	TranscriptPath   string          `json:"transcript_path"`
	Cwd              string          `json:"cwd"`
	ToolInput        json.RawMessage `json:"tool_input"`
	Source           string          `json:"source"`
	NotificationType string          `json:"notification_type"`
}

// agentEmission describes what to publish for one hook event. State=="" means no
// parent-state event (a clean no-op).
type agentEmission struct {
	State            string
	Detail           string
	AttachModelTitle bool
}

func planEmission(ev ccHookEvent) agentEmission {
	switch ev.HookEventName {
	case "UserPromptSubmit":
		return agentEmission{State: baseds.AgentState_Working, AttachModelTitle: true}
	case "Stop":
		return agentEmission{State: baseds.AgentState_Idle, AttachModelTitle: true}
	case "Notification":
		switch ev.NotificationType {
		case "idle_prompt":
			return agentEmission{State: baseds.AgentState_Idle}
		// agent_needs_input is not one: Claude Code sends it when a turn ends and the session waits at its prompt (the
		// agents-view signal), right after Stop has reported idle, so mapping it to waiting showed every finished
		// session as asking until idle_prompt a minute later, and raised a false "Needs you"
		case "permission_prompt", "elicitation_dialog", "elicitation_url_dialog", "":
			return agentEmission{State: baseds.AgentState_Waiting}
		default:
			return agentEmission{}
		}
	case "PostToolUse":
		return agentEmission{State: baseds.AgentState_Working, AttachModelTitle: true}
	case "PreToolUse":
		switch ev.ToolName {
		case "Task":
			return agentEmission{State: baseds.AgentState_Working, AttachModelTitle: true}
		case "AskUserQuestion":
			return agentEmission{State: baseds.AgentState_Asking}
		default:
			return agentEmission{State: baseds.AgentState_Working, Detail: detailForTool(ev.ToolName, ev.ToolInput), AttachModelTitle: true}
		}
	case "PreCompact":
		// a compaction is work the session cannot take typed input during, and it confirms a typed /compact
		return agentEmission{State: baseds.AgentState_Working}
	case "SessionStart":
		// the session is back at its prompt once the summary lands. an auto-compaction inside a turn reads
		// idle only until that turn's next tool reports working, and a wake typed then queues behind it.
		// a /clear lands at the prompt too, on a new transcript this event carries
		if ev.Source == "compact" || ev.Source == "clear" {
			return agentEmission{State: baseds.AgentState_Idle}
		}
		// a resumed session waits at its prompt and reports nothing else before its next prompt, so the cockpit
		// would show only its launch placeholder, named for the folder. its transcript already holds the title
		if ev.Source == "resume" {
			return agentEmission{State: baseds.AgentState_Idle, AttachModelTitle: true}
		}
	}
	return agentEmission{}
}

func detailForTool(name string, input json.RawMessage) string {
	switch name {
	case "Edit", "Write", "MultiEdit":
		if fp := stringField(input, "file_path"); fp != "" {
			return "editing " + filepath.Base(fp)
		}
	case "Read":
		if fp := stringField(input, "file_path"); fp != "" {
			return "reading " + filepath.Base(fp)
		}
	case "Bash":
		if cmd := stringField(input, "command"); cmd != "" {
			return "running " + truncate(cmd, bashDetailMax)
		}
	}
	return name
}

// isSubagentDispatch reports whether ev is about to start a subagent: Claude Code's Agent tool, named Task
// before it.
func isSubagentDispatch(ev ccHookEvent) bool {
	return ev.HookEventName == "PreToolUse" && (ev.ToolName == "Agent" || ev.ToolName == "Task")
}

// subagentLedgerDir holds a file per claude session with a line per Agent call its hook saw. A parallel
// batch's hooks all run before any of its subagents has a transcript, so counting the session's
// subagents/ dir would let the whole batch past the cap; the order of the ledger's lines settles it.
func subagentLedgerDir() string {
	return filepath.Join(os.TempDir(), "arc-subagents")
}

// subagentCallAllowed records an Agent call in its session's ledger and reports whether it falls within
// max. A call already recorded keeps its first place. Any failure allows the call: the hook's own
// bookkeeping must never break the turn.
func subagentCallAllowed(dir, sessionID, toolUseID string, max int) bool {
	if sessionID == "" || toolUseID == "" || filepath.Base(sessionID) != sessionID {
		return true
	}
	if os.MkdirAll(dir, 0o755) != nil {
		return true
	}
	path := filepath.Join(dir, sessionID+".log")
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return true
	}
	// one append per call: concurrent hooks interleave whole lines, never parts of one
	_, err = f.WriteString(toolUseID + "\n")
	f.Close()
	if err != nil {
		return true
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return true
	}
	seen := map[string]bool{}
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == toolUseID {
			return len(seen) < max
		}
		if line != "" {
			seen[line] = true
		}
	}
	return true
}

// subagentCapDenial is the PreToolUse decision that refuses an Agent call past jarvis.MaxSubagents.
func subagentCapDenial() []byte {
	reason := fmt.Sprintf("arcterm caps a session at %d subagents, and this one has dispatched them all. Do the rest of this work yourself, in this session. A plan too big for that is an engine run (`wsh runs start --plan <file>`), not a subagent per task.", jarvis.MaxSubagents)
	out, _ := json.Marshal(map[string]any{
		"hookSpecificOutput": map[string]any{
			"hookEventName":            "PreToolUse",
			"permissionDecision":       "deny",
			"permissionDecisionReason": reason,
		},
	})
	return out
}

// canvasRevealFor names the canvas an agent just wrote a board of, and the project it sits in, so the
// cockpit attaches it without the agent asking. ok is false for every other event.
func canvasRevealFor(ev ccHookEvent) (address string, cwd string, ok bool) {
	if ev.HookEventName != "PostToolUse" {
		return "", "", false
	}
	switch ev.ToolName {
	case "Write", "Edit", "MultiEdit":
	default:
		return "", "", false
	}
	m := canvasBoardPathRe.FindStringSubmatch(stringField(ev.ToolInput, "file_path"))
	if m == nil || !filepath.IsAbs(m[1]) {
		return "", "", false
	}
	return "canvas:" + m[2], m[1], true
}

func stringField(raw json.RawMessage, field string) string {
	if len(raw) == 0 {
		return ""
	}
	var m map[string]any
	if json.Unmarshal(raw, &m) != nil {
		return ""
	}
	if s, ok := m[field].(string); ok {
		return s
	}
	return ""
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}

// tailLines returns the lines in the last transcriptTailBytes of path, dropping the
// partial leading line that a mid-file read produces. Any error yields nil.
func tailLines(path string) []string {
	f, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		return nil
	}
	start := int64(0)
	if st.Size() > transcriptTailBytes {
		start = st.Size() - transcriptTailBytes
	}
	if _, err := f.Seek(start, io.SeekStart); err != nil {
		return nil
	}
	data, err := io.ReadAll(f)
	if err != nil {
		return nil
	}
	lines := strings.Split(string(data), "\n")
	if start > 0 && len(lines) > 0 {
		lines = lines[1:]
	}
	return lines
}

func readLastModel(path string) string {
	model := ""
	for _, ln := range tailLines(path) {
		ln = strings.TrimSpace(ln)
		if ln == "" {
			continue
		}
		var rec struct {
			Message struct {
				Model string `json:"model"`
			} `json:"message"`
		}
		if json.Unmarshal([]byte(ln), &rec) == nil && rec.Message.Model != "" {
			model = rec.Message.Model
		}
	}
	return model
}

func readLastTitle(path string) string {
	title := ""
	for _, ln := range tailLines(path) {
		ln = strings.TrimSpace(ln)
		if ln == "" {
			continue
		}
		var rec struct {
			Type    string `json:"type"`
			AiTitle string `json:"aiTitle"`
		}
		if json.Unmarshal([]byte(ln), &rec) == nil && rec.Type == "ai-title" && rec.AiTitle != "" {
			title = rec.AiTitle
		}
	}
	return title
}

// userText extracts the human prose from a transcript user record's `content`, which is either a bare
// string or an array of content blocks. Only `text` blocks count; tool_result blocks are skipped, so a
// tool_result-only user turn yields "" (it isn't something the human typed).
func userText(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return strings.TrimSpace(s)
	}
	var blocks []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	}
	if json.Unmarshal(raw, &blocks) == nil {
		parts := make([]string, 0, len(blocks))
		for _, b := range blocks {
			if b.Type == "text" && strings.TrimSpace(b.Text) != "" {
				parts = append(parts, strings.TrimSpace(b.Text))
			}
		}
		return strings.TrimSpace(strings.Join(parts, " "))
	}
	return ""
}

// lastUserPrompt returns the text of the most recent user turn that carries human prose. Drives the
// head-text fallback when a turn (e.g. a skill/slash-command dispatch) produced no ai-title record.
func lastUserPrompt(lines []string) string {
	prompt := ""
	for _, ln := range lines {
		ln = strings.TrimSpace(ln)
		if ln == "" {
			continue
		}
		var rec struct {
			Type    string `json:"type"`
			Message struct {
				Content json.RawMessage `json:"content"`
			} `json:"message"`
		}
		if json.Unmarshal([]byte(ln), &rec) != nil || rec.Type != "user" {
			continue
		}
		if txt := userText(rec.Message.Content); txt != "" {
			prompt = txt
		}
	}
	return prompt
}

func readLastUserPrompt(path string) string {
	return lastUserPrompt(tailLines(path))
}

// shadowSessionRecord is the `session` line of an opencode shadow transcript.
type shadowSessionRecord struct {
	Type  string `json:"type"`
	Model string `json:"model"`
	Title string `json:"title"`
}

// readShadowSessionInfo returns the model + title from the last `session` record in an opencode
// shadow transcript (the plugin refreshes it as the session gains a model/title).
func readShadowSessionInfo(path string) (model, title string) {
	for _, ln := range tailLines(path) {
		ln = strings.TrimSpace(ln)
		if ln == "" {
			continue
		}
		var rec shadowSessionRecord
		if json.Unmarshal([]byte(ln), &rec) == nil && rec.Type == "session" {
			if rec.Model != "" {
				model = rec.Model
			}
			if rec.Title != "" {
				title = rec.Title
			}
		}
	}
	return model, title
}

// readShadowFirstUser returns the first `user` record's text in an opencode shadow transcript.
func readShadowFirstUser(path string) string {
	for _, ln := range tailLines(path) {
		ln = strings.TrimSpace(ln)
		if ln == "" {
			continue
		}
		var rec struct {
			Type string `json:"type"`
			Text string `json:"text"`
		}
		if json.Unmarshal([]byte(ln), &rec) == nil && rec.Type == "user" && strings.TrimSpace(rec.Text) != "" {
			return rec.Text
		}
	}
	return ""
}

func truncateRunes(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n])
}

// xmlTagContent returns the trimmed text between <tag>…</tag> in s, or "" if absent.
func xmlTagContent(s, tag string) string {
	open, closeTag := "<"+tag+">", "</"+tag+">"
	i := strings.Index(s, open)
	if i < 0 {
		return ""
	}
	i += len(open)
	j := strings.Index(s[i:], closeTag)
	if j < 0 {
		return ""
	}
	return strings.TrimSpace(s[i : i+j])
}

// unwrapSlashCommand turns Claude Code's transcript encoding of a slash-command turn
//   <command-name>/foo</command-name> … <command-args>bar baz</command-args>
// into the clean "/foo bar baz" a human would recognize. Returns "" when the prompt isn't a
// slash-command blob, so callers fall through to plain head-text.
func unwrapSlashCommand(prompt string) string {
	name := xmlTagContent(prompt, "command-name")
	if name == "" {
		return ""
	}
	if args := xmlTagContent(prompt, "command-args"); args != "" {
		return name + " " + args
	}
	return name
}

// titleFromPrompt turns a user prompt into a head-text title: the first non-empty line, rune-truncated.
// A slash-command turn (e.g. "/brainstorming design X") is stored XML-wrapped in the transcript, so it
// is unwrapped to "/skill args" first. Empty prompt -> "".
func titleFromPrompt(prompt string) string {
	if cmd := unwrapSlashCommand(prompt); cmd != "" {
		prompt = cmd
	}
	for _, line := range strings.Split(prompt, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		return truncateRunes(line, titleMax)
	}
	return ""
}

var agentHookCmd = &cobra.Command{
	Use:                   "agent-hook",
	Short:                 "Claude Code lifecycle hook: report agent status to the arcterm cockpit",
	Args:                  cobra.NoArgs,
	RunE:                  agentHookRun,
	Hidden:                true,
	DisableFlagsInUseLine: true,
	SilenceErrors:         true,
	SilenceUsage:          true,
}

var (
	agentHookAgent  string
	agentHookShadow string
	agentHookState  string
)

func init() {
	rootCmd.AddCommand(agentHookCmd)
	agentHookCmd.Flags().StringVar(&agentHookAgent, "agent", "claude", "agent identity to stamp (claude | opencode)")
	agentHookCmd.Flags().StringVar(&agentHookShadow, "shadow", "", "opencode shadow transcript path to report as the transcript")
	agentHookCmd.Flags().StringVar(&agentHookState, "state", "", "explicit agent state (opencode path; claude derives it from the hook payload)")
}

// hookDebugLine appends one diagnostic line to ~/.claude/arc-hook-debug.log when WAVETERM_HOOK_DEBUG
// is set. Best-effort and silent: a lifecycle hook must never write to stdout/stderr or fail the turn.
// The path is home-relative (not data-dir) so logging works even when the JWT/socket is unavailable —
// which is exactly the failure being diagnosed.
func hookDebugLine(msg string) {
	if os.Getenv("WAVETERM_HOOK_DEBUG") == "" {
		return
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return
	}
	dir := filepath.Join(home, ".claude")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return
	}
	f, err := os.OpenFile(filepath.Join(dir, "arc-hook-debug.log"), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return
	}
	defer f.Close()
	_, _ = f.WriteString(time.Now().Format(time.RFC3339) + " " + msg + "\n")
}

// agentHookRun always returns nil: a hook must never break the agent's turn.
func agentHookRun(cmd *cobra.Command, args []string) error {
	if os.Getenv("WAVETERM_BLOCKID") == "" {
		return nil // not inside an arcterm block; near-instant no-op (not logged: not an error)
	}
	// stamped before any rpc: the per-tool hooks run in the background, and wavesrv orders their reports
	// by when the hook started, not by when a slow one got through
	startedTs := time.Now().UnixMilli()
	// The opencode path (--shadow) supplies its state explicitly — the plugin derives it from
	// opencode events. The claude path derives state from the lifecycle-hook payload on stdin.
	ev := ccHookEvent{}
	if agentHookShadow == "" {
		raw, err := io.ReadAll(os.Stdin)
		if err != nil {
			hookDebugLine("skip: read stdin failed")
			return nil
		}
		if json.Unmarshal(raw, &ev) != nil {
			hookDebugLine("skip: unmarshal hook event failed")
			return nil
		}
	}
	// decided before any rpc, so the cap holds while wavesrv is down. stdout carries only this decision
	if isSubagentDispatch(ev) && !subagentCallAllowed(subagentLedgerDir(), ev.SessionID, ev.ToolUseID, jarvis.MaxSubagents) {
		os.Stdout.Write(subagentCapDenial())
		hookDebugLine("denied subagent past the cap session=" + ev.SessionID)
	}
	em := planEmission(ev)
	if agentHookShadow != "" {
		em = agentEmission{State: agentHookState, AttachModelTitle: true}
	}
	// a claude SessionStart reports no state of its own, but still tells the block which account it runs on
	loginEmail, stampLoginEmail := loginEmailStamp(ev, agentHookAgent, agentHookShadow, os.Getenv("ARC_CLAUDE_ACCOUNT"), claudequota.LoginEmail)
	if em.State == "" && !stampLoginEmail {
		hookDebugLine("skip: no emission for event=" + ev.HookEventName)
		return nil
	}
	jwt := os.Getenv(wshutil.WaveJwtTokenVarName)
	if jwt == "" {
		hookDebugLine("skip: no jwt in env (WAVETERM_BLOCKID set) event=" + ev.HookEventName)
		return nil
	}
	if setupRpcClient(nil, jwt) != nil {
		hookDebugLine("skip: setupRpcClient failed event=" + ev.HookEventName)
		return nil
	}
	envORef, err := resolveBlockArg()
	if err != nil {
		hookDebugLine("skip: resolveBlockArg failed event=" + ev.HookEventName)
		return nil
	}
	transcriptPath := ev.TranscriptPath
	if agentHookShadow != "" {
		transcriptPath = agentHookShadow
	}
	oref := envORef
	if agentHookShadow == "" {
		// a session the Claude daemon hosts reports into the tab attached to it, not the tab that started the daemon
		target, drop := statusTarget(envORef)
		if drop {
			hookDebugLine("skip: daemon-hosted session with no tab attached event=" + ev.HookEventName)
			return nil
		}
		oref = target
	}
	if stampLoginEmail {
		// best-effort like the transcript path below; a nil value clears the key
		_ = wshclient.SetMetaCommand(RpcClient, wshrpc.CommandSetMetaData{
			ORef: *oref,
			Meta: waveobj.MetaMapType{waveobj.MetaKey_AgentLoginEmail: loginEmail},
		}, &wshrpc.RpcOpts{Timeout: 2000})
	}
	if em.State == "" {
		hookDebugLine("stamped login email, no emission for event=" + ev.HookEventName)
		return nil
	}
	if agentHookShadow == "" {
		releaseStaleStatus(envORef, oref, transcriptPath)
	}
	// stamp the transcript path so a gone-worker exit can derive its outcome from the transcript.
	// best-effort: a hook must never fail the turn.
	if transcriptPath != "" {
		_ = wshclient.SetMetaCommand(RpcClient, wshrpc.CommandSetMetaData{
			ORef: *oref,
			Meta: waveobj.MetaMapType{waveobj.MetaKey_AgentTranscriptPath: transcriptPath},
		}, &wshrpc.RpcOpts{Timeout: 2000})
	}
	data := baseds.AgentStatusData{
		ORef:           oref.String(),
		State:          em.State,
		Detail:         em.Detail,
		Agent:          agentHookAgent,
		Cwd:            ev.Cwd,
		TranscriptPath: transcriptPath,
		Ts:             startedTs,
	}
	if em.AttachModelTitle && transcriptPath != "" {
		if agentHookShadow != "" {
			data.Model, data.Title = readShadowSessionInfo(transcriptPath)
			if data.Title == "" {
				data.Title = titleFromPrompt(readShadowFirstUser(transcriptPath))
			}
		} else {
			data.Model = readLastModel(transcriptPath)
			data.Title = readLastTitle(transcriptPath)
			// no ai-title yet (e.g. a skill/slash-command turn) -> fall back to the user's prompt so
			// the row still gets a head-text summary instead of the bare agent name
			if data.Title == "" {
				data.Title = titleFromPrompt(readLastUserPrompt(transcriptPath))
			}
		}
	}
	// a turn that stops on part 1/3 of something waits on a reply, and the cockpit row shows the step until it gets
	// one. Every idle event carries it: the step is transient, so an idle_prompt without it would clear it. A turn that
	// asks "Phần 1/4 ổn chưa?" through AskUserQuestion waits the same way, so the ask carries it too
	// a turn that ended on a git commit is likely the end of the work, so the cockpit offers to close the agent
	if em.State == baseds.AgentState_Idle && agentHookShadow == "" && transcriptPath != "" {
		data.Step = readLastStep(transcriptPath)
		data.Committed = readTurnCommitted(transcriptPath)
	} else if em.State == baseds.AgentState_Asking && agentHookShadow == "" {
		data.Step = askStep(ev.ToolInput, transcriptPath)
	}
	_ = publishAgentStatusData(oref, data, 1)
	if address, cwd, ok := canvasRevealFor(ev); ok {
		// best-effort like the rest: a closed cockpit or a topic it refuses must not fail the turn
		_, err := wshclient.UiRevealCommand(RpcClient, wshrpc.CommandUiRevealData{
			Address:       address,
			CallerBlockId: os.Getenv("WAVETERM_BLOCKID"),
			CallerCwd:     cwd,
		}, &wshrpc.RpcOpts{Route: wshutil.RouteId_Cockpit, Timeout: canvasRevealTimeoutMs})
		if err != nil {
			hookDebugLine("canvas reveal failed address=" + address + " err=" + err.Error())
		}
	}
	hookDebugLine("published event=" + ev.HookEventName + " state=" + em.State + " oref=" + oref.String())
	return nil
}
