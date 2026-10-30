// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Package consult runs a one-shot, headless CLI agent (claude -p / codex exec) and returns
// its reply. It is the backend primitive behind the Channels "ask @runtime" gesture and the future
// orchestrator's review tool. This file holds the pure (process-free) parts: the per-runtime argv map
// and the capped-context prompt builder.

package consult

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/harness"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
)

const (
	MaxContextMessages = 20
	maxContextChars    = 4000
)

// apiBackend runs a model call over an HTTP API instead of a local CLI process.
type apiBackend interface {
	Run(ctx context.Context, spec RuntimeSpec, prompt string, emit func(string)) (string, error)
}

// ParsedEvent is one decoded JSONL event from a runtime's stream. Text carries reply text (empty for
// non-reply events), Complete marks a runtime's settlement/completion signal (pi agent_settled), and
// Err surfaces a runtime-reported assistant error. At most one of Text/Complete/Err is meaningful.
// Tool and Tokens are claude-only additions: Tool describes a tool call the assistant made (it can
// ride on the same event as Text), and Tokens is the call's total token count, set on the Complete
// event that closes it.
type ParsedEvent struct {
	Text     string
	Complete bool
	Err      error
	Tool     string
	Tokens   int64
}

// RuntimeSpec is how to invoke a runtime in one-shot/print mode.
//
// Output handling (see Run in exec.go):
//   - ParseLine != nil => the CLI emits JSONL events on stdout; scan line-by-line and emit the text
//     each reply event carries. This is real incremental streaming (claude stream-json, codex --json).
//   - UsePty => the CLI only renders to a terminal and drops stdout under a pipe/subprocess. Spawn it
//     under a pty and clean the TUI stream.
//   - neither => read raw stdout chunks verbatim (used by tests / plain tools).
//
// PromptViaStdin true => pipe the prompt over stdin; false => append it as the final positional arg.
// pty mode cannot easily feed stdin, so pty runtimes pass the prompt positionally.
type RuntimeSpec struct {
	Bin            string
	BaseArgs       []string
	PromptViaStdin bool
	UsePty         bool
	ParseLine      func(line []byte) ParsedEvent
	ApiBackend     apiBackend // if set, Run() calls the API instead of shelling out
	Model          string     // model id for API backends
}

// runtimeSpecs is keyed by the FE Runtime identifier.
//
// Why each streams the way it does (verified 2026-07-01 by reproducing the exact invocations):
//   - claude/codex plain modes write progress to stderr and only the final answer to stdout at the
//     very end — no incremental streaming. Their JSONL modes (--output-format stream-json / --json)
//     emit structured reply events on stdout as they go, so we parse those.
var runtimeSpecs = map[string]RuntimeSpec{
	"claude":     {Bin: "claude", BaseArgs: []string{"-p", "--output-format", "stream-json", "--verbose"}, PromptViaStdin: true, ParseLine: claudeParseLine},
	"codex":      {Bin: "codex", BaseArgs: []string{"exec", "--json"}, PromptViaStdin: true, ParseLine: codexParseLine},
	"agy":        {Bin: "agy", BaseArgs: []string{"-p"}, PromptViaStdin: false},
	"opencode":   {Bin: "opencode", BaseArgs: []string{"run", "--format", "json"}, PromptViaStdin: false, ParseLine: opencodeParseLine},
	"pi":         {Bin: "pi", BaseArgs: []string{"--mode", "json", "--no-session", "--no-extensions"}, PromptViaStdin: false, ParseLine: piParseLine},
	"openrouter": {ApiBackend: &openrouterBackend{}},
}

// codexParseLine extracts assistant text from a `codex exec --json` JSONL event. The reply arrives as
// item.completed events whose item.type is "agent_message"; reasoning/thread/turn events are skipped.
func codexParseLine(line []byte) ParsedEvent {
	var ev struct {
		Type string `json:"type"`
		Item struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"item"`
	}
	if json.Unmarshal(line, &ev) != nil {
		return ParsedEvent{}
	}
	if ev.Type == "item.completed" && ev.Item.Type == "agent_message" && ev.Item.Text != "" {
		return ParsedEvent{Text: ev.Item.Text}
	}
	return ParsedEvent{}
}

// claudeParseLine extracts assistant text from a `claude -p --output-format stream-json` JSONL event.
// The reply arrives as assistant events carrying text content blocks (accumulating them is the reply),
// and a tool_use block in the same event is reported as Tool. The final result event repeats the reply,
// so it carries no Text: it only settles the call (Complete) and reports its token usage.
// System/hook/init and rate-limit events are skipped.
func claudeParseLine(line []byte) ParsedEvent {
	var ev struct {
		Type    string `json:"type"`
		Subtype string `json:"subtype"`
		IsError bool   `json:"is_error"`
		Result  string `json:"result"`
		Message struct {
			StopReason string `json:"stop_reason"`
			Content    []struct {
				Type  string          `json:"type"`
				Text  string          `json:"text"`
				Name  string          `json:"name"`
				Input json.RawMessage `json:"input"`
			} `json:"content"`
		} `json:"message"`
		Usage struct {
			Input         int64 `json:"input_tokens"`
			CacheRead     int64 `json:"cache_read_input_tokens"`
			CacheCreation int64 `json:"cache_creation_input_tokens"`
			Output        int64 `json:"output_tokens"`
		} `json:"usage"`
	}
	if json.Unmarshal(line, &ev) != nil {
		return ParsedEvent{}
	}
	switch ev.Type {
	case "result":
		u := ev.Usage
		pe := ParsedEvent{Complete: true, Tokens: u.Input + u.CacheRead + u.CacheCreation + u.Output}
		// A result that reports an error (a safeguard refusal, a run that hit a limit) carries the
		// reason in result/subtype; surface it so the caller reports it instead of a bare exit code.
		if ev.IsError || strings.HasPrefix(ev.Subtype, "error") {
			msg := strings.TrimSpace(ev.Result)
			if msg == "" {
				msg = ev.Subtype
			}
			if msg == "" {
				msg = "the model reported an error"
			}
			pe.Err = errors.New(msg)
		}
		return pe
	case "assistant":
		var text strings.Builder
		var tool string
		for _, c := range ev.Message.Content {
			switch c.Type {
			case "text":
				text.WriteString(c.Text)
			case "tool_use":
				if tool == "" {
					tool = describeClaudeTool(c.Name, c.Input)
				}
			}
		}
		// A model refusal arrives as an assistant turn with stop_reason "refusal" (and the CLI then
		// exits non-zero). Surface the refusal text as the error rather than letting it ride as reply
		// text that would read as a successful, if terse, answer.
		if ev.Message.StopReason == "refusal" {
			msg := strings.TrimSpace(text.String())
			if msg == "" {
				msg = "the model declined to respond (refusal)"
			}
			return ParsedEvent{Err: errors.New(msg), Tool: tool}
		}
		return ParsedEvent{Text: text.String(), Tool: tool}
	}
	return ParsedEvent{}
}

// describeClaudeTool is the one-line description of a claude tool call the Council shows while an
// expert works: `Grep "pattern" in path`, `Read file.ts` (base name only), `Glob **/*.ts`. A tool
// without a summary field is named alone.
func describeClaudeTool(name string, rawInput json.RawMessage) string {
	var in struct {
		Pattern  string `json:"pattern"`
		Path     string `json:"path"`
		FilePath string `json:"file_path"`
	}
	_ = json.Unmarshal(rawInput, &in)
	switch name {
	case "Grep":
		if in.Pattern == "" {
			return name
		}
		// quoted by hand, not %q: a regex's backslashes would show doubled
		if in.Path == "" {
			return name + ` "` + in.Pattern + `"`
		}
		return name + ` "` + in.Pattern + `" in ` + in.Path
	case "Read":
		if in.FilePath == "" {
			return name
		}
		return name + " " + baseName(in.FilePath)
	case "Glob":
		if in.Pattern == "" {
			return name
		}
		return name + " " + in.Pattern
	}
	return name
}

// baseName is the last element of a path written with either separator: a transcript can carry a
// Windows path while the server runs elsewhere, so filepath.Base is not enough.
func baseName(p string) string {
	if i := strings.LastIndexAny(p, `/\`); i >= 0 {
		return p[i+1:]
	}
	return p
}

// opencodeParseLine extracts assistant text from an `opencode run --format json` JSONL event.
// Verified 2026-08-07: run --format json emits one event per line; assistant text arrives as a
// `text` event whose part.type is "text". step_start/step_finish/reasoning/tool events carry no
// reply text and are skipped. Streaming is incremental — each text event carries its own delta.
func opencodeParseLine(line []byte) ParsedEvent {
	var ev struct {
		Type string `json:"type"`
		Part struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"part"`
	}
	if json.Unmarshal(line, &ev) != nil {
		return ParsedEvent{}
	}
	if ev.Type != "text" || ev.Part.Type != "text" {
		return ParsedEvent{}
	}
	if strings.TrimSpace(ev.Part.Text) == "" {
		return ParsedEvent{}
	}
	return ParsedEvent{Text: ev.Part.Text}
}

// piParseLine extracts Pi's stream from a `pi --mode json --no-session --no-extensions` session.
// Assistant text arrives in message_end events with text content blocks; the final agent_settled
// event marks completion, and a message_end with stopReason "error" carries the failure message.
func piParseLine(line []byte) ParsedEvent {
	var ev struct {
		Type    string `json:"type"`
		Message struct {
			Role         string `json:"role"`
			StopReason   string `json:"stopReason"`
			ErrorMessage string `json:"errorMessage"`
			Content      []struct {
				Type string `json:"type"`
				Text string `json:"text"`
			} `json:"content"`
		} `json:"message"`
	}
	if err := json.Unmarshal(line, &ev); err != nil {
		return ParsedEvent{}
	}
	if ev.Type == "agent_settled" {
		return ParsedEvent{Complete: true}
	}
	if ev.Type != "message_end" || ev.Message.Role != "assistant" {
		return ParsedEvent{}
	}
	if ev.Message.StopReason == "error" {
		return ParsedEvent{Err: fmt.Errorf("Pi assistant error: %s", ev.Message.ErrorMessage)}
	}
	var text strings.Builder
	for _, block := range ev.Message.Content {
		if block.Type == "text" {
			text.WriteString(block.Text)
		}
	}
	return ParsedEvent{Text: text.String()}
}

// SpecFor resolves a one-shot runtime spec, falling back to the shared harness catalog for the
// executable name. The OpenRouter entry is API-only and stays out of the catalog.
func SpecFor(runtime string) (RuntimeSpec, bool) {
	spec, ok := runtimeSpecs[runtime]
	if !ok {
		return RuntimeSpec{}, false
	}
	if h, found := harness.Lookup(runtime); found {
		spec.Bin = h.Bin
	}
	return spec, true
}

// Tier is the model class for a one-shot call, ordered by task difficulty: cheap for mechanical
// grunt work, mid for bounded work whose prose a human reads, capable for open-ended synthesis.
// TierCapable deliberately adds no --model flag — it keeps whatever default the operator configured
// for the CLI, which is exactly what every call did before tiering existed, so selecting it
// explicitly is a no-op rather than a downgrade.
type Tier string

const (
	TierCapable Tier = "capable"
	TierMid     Tier = "mid"
	TierCheap   Tier = "cheap"
)

// The claude aliases each tier selects. Exported so callers that need the alias itself rather than a
// tiered spec (runroute pins a route's model by alias) share these definitions instead of re-hardcoding
// the strings.
const (
	// CheapModel is the cheap tier's alias. Haiku 4.5 is the cheapest current alias (~1/5 of Opus
	// per input token). Note "fable" is not a small model despite the naming — Claude Fable 5 prices
	// above Opus — so it is the wrong alias for a cost-driven tier.
	CheapModel = "haiku"
	// MidModel is the mid tier's alias: bounded, grounded work where a cheap model's mistakes would
	// be visible to the human reading the output, but the operator's default (Opus-class) is more
	// than the task needs.
	MidModel = "sonnet"
)

// modelForTier maps a tier to its claude --model alias. TierCapable maps to "" on purpose: passing
// no flag is what keeps the operator's configured default (see Tier).
func modelForTier(tier Tier) string {
	switch tier {
	case TierCheap:
		return CheapModel
	case TierMid:
		return MidModel
	default:
		return ""
	}
}

// SpecForTier resolves a runtime spec with the tier's model selection applied.
// For claude, it appends a --model alias to BaseArgs. pi/codex/opencode keep their own default.
// For openrouter, every tier sets spec.Model to the one configured model.
// Other runtimes are returned unchanged.
func SpecForTier(runtime string, tier Tier) (RuntimeSpec, bool) {
	spec, ok := SpecFor(runtime)
	if !ok {
		return spec, false
	}
	if runtime == "openrouter" {
		spec.Model = OpenrouterCheapModel()
		return spec, true
	}
	// pi takes no tier model: its ids are provider-namespaced, so a bare id is ambiguous across every
	// authenticated provider and pi refuses it. Tiered pi calls run on pi's own configured default.
	if runtime == "pi" {
		return spec, true
	}
	model := modelForTier(tier)
	if model == "" || runtime != "claude" {
		return spec, ok
	}
	spec.BaseArgs = append(append([]string{}, spec.BaseArgs...), "--model", model)
	return spec, true
}

// CallOpts is what one claude call picks for itself, where a tier only picks a model class: the
// model alias (empty keeps the operator's default) and the tools it may use (empty gives it none).
type CallOpts struct {
	Model string
	Tools []string
}

// ClaudeArgs is claude's argument list for one call (prompt excluded): the one-shot base, then
// --model when set, then --tools and --strict-mcp-config. --tools "" is the empty list, which gives
// the run no tools; --strict-mcp-config stops the account's connector tools loading despite --tools
// (Radar's audit and the memory judge pass the same pair).
func ClaudeArgs(o CallOpts) []string {
	args := append([]string{}, runtimeSpecs["claude"].BaseArgs...)
	if o.Model != "" {
		args = append(args, "--model", o.Model)
	}
	return append(args, "--tools", strings.Join(o.Tools, ","), "--strict-mcp-config")
}

// HeadlessRuntime returns the runtime the background AI features (gatekeeper, recall, gardener,
// pi titles, ...) use for one-shot consults. The headless:runtime setting is the single source of
// truth; an empty or unknown value falls back to openrouter because these features run unattended —
// a misconfigured value must degrade to the known default, never silently disable the feature.
func HeadlessRuntime() string {
	configured := wconfig.GetWatcher().GetFullConfig().Settings.HeadlessRuntime
	return resolveHeadlessRuntime(configured)
}

func resolveHeadlessRuntime(configured string) string {
	if configured == "" {
		return "openrouter"
	}
	if _, ok := SpecFor(configured); !ok {
		log.Printf("[consult] headless runtime %q not recognized, falling back to openrouter\n", configured)
		return "openrouter"
	}
	return configured
}

// HeadlessSpecForTier resolves a spec for the configured headless runtime at the given tier. Every
// background AI feature calls this instead of hardcoding a runtime, so the headless:runtime setting
// is honored uniformly. Tier→model mapping is SpecForTier's job: openrouter sets Model from the
// configured tier IDs, claude appends a --model alias, pi/codex/opencode use the harness's own default.
func HeadlessSpecForTier(tier Tier) (RuntimeSpec, bool) {
	return SpecForTier(HeadlessRuntime(), tier)
}

// OperatorPrinciples returns the operator's global ~/.claude/CLAUDE.md, or "" if there is none. A
// missing file is normal (not every operator keeps global principles); only a real read error propagates.
func OperatorPrinciples() (string, error) {
	path := filepath.Join(wavebase.GetHomeDir(), ".claude", "CLAUDE.md")
	b, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// BuildPrompt folds a capped tail of channel history into the user's prompt as context, and — when
// principles is non-empty — prepends the operator's global principles verbatim (not capped: truncating
// a principles document mid-sentence would mislead the consulted agent).
func BuildPrompt(history []waveobj.ChannelMessage, userPrompt, principles string) string {
	start := 0
	if len(history) > MaxContextMessages {
		start = len(history) - MaxContextMessages
	}
	var b strings.Builder
	for _, m := range history[start:] {
		b.WriteString(m.Author)
		b.WriteString(": ")
		b.WriteString(m.Text)
		b.WriteByte('\n')
	}
	ctxStr := b.String()
	if len(ctxStr) > maxContextChars {
		ctxStr = ctxStr[len(ctxStr)-maxContextChars:]
		if i := strings.IndexByte(ctxStr, '\n'); i >= 0 {
			ctxStr = ctxStr[i+1:] // drop the partial leading line after slicing
		}
	}
	var body string
	if strings.TrimSpace(ctxStr) == "" {
		body = userPrompt
	} else {
		body = "Recent channel conversation for context:\n" + ctxStr + "\nRequest:\n" + userPrompt
	}
	if strings.TrimSpace(principles) != "" {
		return "Operator principles (follow these):\n" + principles + "\n\n" + body
	}
	return body
}
