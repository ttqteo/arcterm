// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package consult

import (
	"context"
	"slices"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

func TestSpecFor_knownRuntimes(t *testing.T) {
	cases := map[string]struct {
		bin  string
		arg0 string
	}{
		"claude":   {"claude", "-p"},
		"codex":    {"codex", "exec"},
		"opencode": {"opencode", "run"},
		"agy":      {"agy", "-p"},
	}
	for rt, want := range cases {
		spec, ok := SpecFor(rt)
		if !ok {
			t.Fatalf("%s: expected ok", rt)
		}
		if spec.Bin != want.bin || len(spec.BaseArgs) == 0 || spec.BaseArgs[0] != want.arg0 {
			t.Errorf("%s: got bin=%q args=%v", rt, spec.Bin, spec.BaseArgs)
		}
	}
	// agy takes the prompt as the value of -p and answers on plain stdout: no pty, no stdin, no parser.
	agy, _ := SpecFor("agy")
	if agy.UsePty || agy.PromptViaStdin || agy.ParseLine != nil || !slices.Equal(agy.BaseArgs, []string{"-p"}) {
		t.Errorf("agy: got %+v", agy)
	}
	// openrouter is an API runtime — no Bin, but ApiBackend must be set
	spec, ok := SpecFor("openrouter")
	if !ok {
		t.Fatal("openrouter: expected ok")
	}
	if spec.ApiBackend == nil {
		t.Error("openrouter: expected ApiBackend to be set")
	}
}

func TestSpecFor_unsupported(t *testing.T) {
	if _, ok := SpecFor("terminal"); ok {
		t.Error("terminal should be unsupported")
	}
	if _, ok := SpecFor("antigravity"); ok {
		t.Error("the old antigravity id has no alias")
	}
	if _, ok := SpecFor("gemini"); ok {
		t.Error("gemini should be unsupported in v1")
	}
}

func TestBuildPrompt_emptyHistoryReturnsPromptVerbatim(t *testing.T) {
	got := BuildPrompt(nil, "what is 2+2?", "")
	if got != "what is 2+2?" {
		t.Errorf("expected verbatim prompt, got %q", got)
	}
}

func TestBuildPrompt_includesRecentHistoryAndRequest(t *testing.T) {
	hist := []waveobj.ChannelMessage{
		{Author: "you", Text: "we are refactoring auth"},
		{Author: "codex", Text: "done, +40 -10"},
	}
	got := BuildPrompt(hist, "does it have races?", "")
	if !strings.Contains(got, "you: we are refactoring auth") {
		t.Errorf("missing history line: %q", got)
	}
	if !strings.Contains(got, "does it have races?") {
		t.Errorf("missing request: %q", got)
	}
}

func TestBuildPrompt_capsMessageCount(t *testing.T) {
	var hist []waveobj.ChannelMessage
	for i := 0; i < 50; i++ {
		hist = append(hist, waveobj.ChannelMessage{Author: "you", Text: "OLDLINE"})
	}
	hist = append(hist, waveobj.ChannelMessage{Author: "you", Text: "NEWEST"})
	got := BuildPrompt(hist, "q", "")
	// only the last MaxContextMessages are kept; with 51 total, the count of OLDLINE is bounded
	if strings.Count(got, "OLDLINE") > MaxContextMessages {
		t.Errorf("kept too many history lines: %d", strings.Count(got, "OLDLINE"))
	}
	if !strings.Contains(got, "NEWEST") {
		t.Errorf("dropped the newest message: %q", got)
	}
}

func TestRun_streamsAndCapturesOutput(t *testing.T) {
	var chunks []string
	spec := RuntimeSpec{Bin: "git", BaseArgs: []string{"version"}, PromptViaStdin: false}
	full, err := Run(context.Background(), spec, "", "", func(c string) { chunks = append(chunks, c) })
	if err != nil {
		t.Fatalf("Run error: %v", err)
	}
	if !strings.Contains(full, "git version") {
		t.Errorf("expected git version in output, got %q", full)
	}
	if len(chunks) == 0 {
		t.Error("expected at least one streamed chunk")
	}
}

func TestRun_missingBinaryErrors(t *testing.T) {
	spec := RuntimeSpec{Bin: "definitely-not-a-real-binary-xyz", BaseArgs: nil}
	_, err := Run(context.Background(), spec, "", "", func(string) {})
	if err == nil {
		t.Error("expected an error for a missing binary")
	}
}

func TestCodexParseLine_extractsAgentMessage(t *testing.T) {
	// real codex `exec --json` events (captured 2026-07-01)
	skip := []string{
		`{"type":"thread.started","thread_id":"019f"}`,
		`{"type":"turn.started"}`,
		`{"type":"turn.completed","usage":{"output_tokens":63}}`,
		`{"type":"item.completed","item":{"type":"reasoning","text":"thinking..."}}`,
	}
	for _, line := range skip {
		if ev := codexParseLine([]byte(line)); ev.Text != "" || ev.Complete || ev.Err != nil {
			t.Errorf("expected skip for %q, got %+v", line, ev)
		}
	}
	reply := `{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"pong"}}`
	ev := codexParseLine([]byte(reply))
	if ev.Text != "pong" {
		t.Errorf("expected agent_message text 'pong', got %+v", ev)
	}
	if ev := codexParseLine([]byte("not json")); ev.Text != "" {
		t.Error("garbage line should not parse as a reply")
	}
}

func TestClaudeParseLine_extractsAssistantText(t *testing.T) {
	// real claude `-p --output-format stream-json --verbose` events (captured 2026-07-01)
	skip := []string{
		`{"type":"system","subtype":"init","session_id":"b16"}`,
		`{"type":"system","subtype":"hook_started","hook_name":"SessionStart:startup"}`,
		`{"type":"rate_limit_event","rate_limit_info":{"status":"allowed"}}`,
		`{"type":"result","subtype":"success","result":"pong"}`, // final result is redundant with the assistant delta
	}
	for _, line := range skip {
		if ev := claudeParseLine([]byte(line)); ev.Text != "" || ev.Complete || ev.Err != nil {
			t.Errorf("expected skip for %q, got %+v", line, ev)
		}
	}
	reply := `{"type":"assistant","message":{"model":"claude-opus-4-8","content":[{"type":"text","text":"pong"}]},"session_id":"b16"}`
	ev := claudeParseLine([]byte(reply))
	if ev.Text != "pong" {
		t.Errorf("expected assistant text 'pong', got %+v", ev)
	}
}

func TestOpencodeParseLine_extractsText(t *testing.T) {
	// real `opencode run --format json` events (captured 2026-08-07)
	skip := []string{
		`{"type":"step_start","timestamp":1786080035726,"sessionID":"ses_x","part":{"id":"p1","messageID":"m1","sessionID":"ses_x","snapshot":"s","type":"step-start"}}`,
		`{"type":"reasoning","timestamp":1786080035800,"sessionID":"ses_x","part":{"id":"p2","messageID":"m1","sessionID":"ses_x","type":"reasoning","text":"thinking..."}}`,
		`{"type":"step_finish","timestamp":1786080036726,"sessionID":"ses_x","part":{"id":"p3","messageID":"m1","sessionID":"ses_x","type":"step-finish","reason":"stop","cost":0,"tokens":{"input":1,"output":1,"reasoning":0,"cache":{"read":0,"write":0}}}}`,
	}
	for _, line := range skip {
		if ev := opencodeParseLine([]byte(line)); ev.Text != "" || ev.Complete || ev.Err != nil {
			t.Errorf("expected skip for %q, got %+v", line, ev)
		}
	}
	reply := `{"type":"text","timestamp":1786080036000,"sessionID":"ses_x","part":{"id":"p4","messageID":"m1","sessionID":"ses_x","type":"text","text":"pong"}}`
	ev := opencodeParseLine([]byte(reply))
	if ev.Text != "pong" {
		t.Errorf("expected text part 'pong', got %+v", ev)
	}
	if ev := opencodeParseLine([]byte("not json")); ev.Text != "" {
		t.Error("garbage line should not parse as a reply")
	}
}

func TestCleanTUI_stripsAnsiAndBoxDrawing(t *testing.T) {
	// a TUI-style runtime repaints: ANSI CSI, OSC, box-drawing, CR repaints.
	raw := "\x1b[2J\x1b[H┌────────┐\r\n│ working…│\r\x1b[32mpong\x1b[0m\r\n└────────┘"
	got := cleanTUI(raw)
	if !strings.Contains(got, "pong") {
		t.Errorf("expected 'pong' to survive cleaning, got %q", got)
	}
	if strings.ContainsRune(got, '\x1b') {
		t.Errorf("ANSI escape leaked through: %q", got)
	}
	if strings.ContainsAny(got, "┌┐└┘│─") {
		t.Errorf("box-drawing leaked through: %q", got)
	}
}

func TestSpecFor_streamingModes(t *testing.T) {
	codex, _ := SpecFor("codex")
	if codex.ParseLine == nil {
		t.Error("codex should use JSONL line parsing (--json)")
	}
	claude, _ := SpecFor("claude")
	if claude.ParseLine == nil {
		t.Error("claude should use JSONL line parsing (stream-json)")
	}

	opencode, _ := SpecFor("opencode")
	if opencode.ParseLine == nil {
		t.Error("opencode should use JSONL line parsing (run --format json)")
	}
}

func TestSpecForTier_capableKeepsTheCLIDefault(t *testing.T) {
	base, _ := SpecFor("claude")
	spec, ok := SpecForTier("claude", TierCapable)
	if !ok {
		t.Fatal("expected claude to resolve")
	}
	if strings.Join(spec.BaseArgs, " ") != strings.Join(base.BaseArgs, " ") {
		t.Errorf("capable must add no --model flag (it keeps the operator's default), got %v", spec.BaseArgs)
	}
}

func TestSpecForTier_cheapSelectsTheCheapModel(t *testing.T) {
	spec, ok := SpecForTier("claude", TierCheap)
	if !ok {
		t.Fatal("expected claude to resolve")
	}
	if !strings.Contains(strings.Join(spec.BaseArgs, " "), "--model "+CheapModel) {
		t.Errorf("cheap tier must select --model %s, got %v", CheapModel, spec.BaseArgs)
	}
}

func TestSpecForTier_neverMutatesTheSharedSpec(t *testing.T) {
	before, _ := SpecFor("claude")
	want := strings.Join(before.BaseArgs, " ")
	SpecForTier("claude", TierCheap)
	SpecForTier("claude", TierCheap)
	after, _ := SpecFor("claude")
	if got := strings.Join(after.BaseArgs, " "); got != want {
		t.Errorf("shared claude spec mutated: %q -> %q", want, got)
	}
}

func TestSpecForTier_nonClaudeRuntimesAreUnchanged(t *testing.T) {
	// only claude and pi have a --model contract here; a tier must not invent flags for the others.
	for _, rt := range []string{"codex", "opencode"} {
		base, _ := SpecFor(rt)
		spec, ok := SpecForTier(rt, TierCheap)
		if !ok {
			t.Fatalf("%s: expected it to resolve", rt)
		}
		if strings.Join(spec.BaseArgs, " ") != strings.Join(base.BaseArgs, " ") {
			t.Errorf("%s: args changed to %v", rt, spec.BaseArgs)
		}
	}
}

func TestSpecForTier_unsupportedRuntime(t *testing.T) {
	if _, ok := SpecForTier("gemini", TierCheap); ok {
		t.Error("gemini should be unsupported")
	}
}

func TestSpecForTier_midSelectsTheMidModel(t *testing.T) {
	spec, ok := SpecForTier("claude", TierMid)
	if !ok {
		t.Fatal("expected claude to resolve")
	}
	// adjacency, not substring: a bare --model check would also pass on the cheap tier's flag
	for i, a := range spec.BaseArgs {
		if a == "--model" && i+1 < len(spec.BaseArgs) && spec.BaseArgs[i+1] == MidModel {
			return
		}
	}
	t.Fatalf("mid tier must select --model %s, got %v", MidModel, spec.BaseArgs)
}

// The three tiers must stay distinguishable. Collapsing mid into either neighbour is otherwise a
// silent change: cheap and mid both pass a --model flag, and capable passes none.
func TestSpecForTier_tiersAreDistinct(t *testing.T) {
	if CheapModel == MidModel {
		t.Fatalf("cheap and mid must not resolve to the same alias (%q)", CheapModel)
	}
	capable, _ := SpecForTier("claude", TierCapable)
	base, _ := SpecFor("claude")
	if len(capable.BaseArgs) != len(base.BaseArgs) {
		t.Errorf("capable must add no flag, got %v", capable.BaseArgs)
	}
	for _, tier := range []Tier{TierCheap, TierMid} {
		spec, _ := SpecForTier("claude", tier)
		if len(spec.BaseArgs) == len(base.BaseArgs) {
			t.Errorf("%s tier must add a --model flag, got %v", tier, spec.BaseArgs)
		}
	}
}

// pi ids are provider-namespaced (provider/model), so there is no bare id a tier could pin that pi
// can resolve on its own — a bare one is ambiguous across every authenticated provider. Tiered pi
// calls therefore pass no --model at all and run on pi's own configured default.
func TestSpecForTier_piNeverPinsAModel(t *testing.T) {
	for _, tier := range []Tier{TierCheap, TierMid, TierCapable} {
		spec, ok := SpecForTier("pi", tier)
		if !ok {
			t.Fatalf("pi: expected tier %s to resolve", tier)
		}
		if slices.Contains(spec.BaseArgs, "--model") {
			t.Errorf("%s tier must not pin a model, got %v", tier, spec.BaseArgs)
		}
	}
}

func TestSpecForTier_piNeverMutatesTheSharedSpec(t *testing.T) {
	before, _ := SpecFor("pi")
	want := strings.Join(before.BaseArgs, " ")
	SpecForTier("pi", TierCheap)
	SpecForTier("pi", TierMid)
	after, _ := SpecFor("pi")
	if got := strings.Join(after.BaseArgs, " "); got != want {
		t.Errorf("shared pi spec mutated: %q -> %q", want, got)
	}
}

func TestSpecForTier_openrouterSetsModel(t *testing.T) {
	spec, ok := SpecForTier("openrouter", TierCheap)
	if !ok {
		t.Fatal("expected openrouter to resolve")
	}
	if spec.Model == "" {
		t.Fatal("cheap tier must set a model on the spec")
	}
	if spec.ApiBackend == nil {
		t.Fatal("openrouter spec must have an ApiBackend")
	}
	// openrouter has one configured model: the mid and capable tiers resolve to it too
	for _, tier := range []Tier{TierCheap, TierMid, TierCapable} {
		got, ok := SpecForTier("openrouter", tier)
		if !ok || got.Model != OpenrouterCheapModel() {
			t.Errorf("%s tier model = %q (ok=%v), want the cheap model %q", tier, got.Model, ok, OpenrouterCheapModel())
		}
	}
}

func TestBuildPromptNoPrinciplesMatchesLegacy(t *testing.T) {
	history := []waveobj.ChannelMessage{{Author: "you", Text: "hello"}}
	got := BuildPrompt(history, "do the thing", "")
	if !strings.Contains(got, "Recent channel conversation") || !strings.Contains(got, "do the thing") {
		t.Fatalf("expected context + request body, got: %q", got)
	}
	if strings.Contains(got, "Operator principles") {
		t.Fatalf("empty principles must not add a preamble, got: %q", got)
	}
}

func TestBuildPromptEmptyHistoryEmptyPrinciplesIsBarePrompt(t *testing.T) {
	if got := BuildPrompt(nil, "just this", ""); got != "just this" {
		t.Fatalf("expected bare prompt, got: %q", got)
	}
}

func TestBuildPromptPrependsPrinciples(t *testing.T) {
	got := BuildPrompt(nil, "review this", "Always prefer KISS.")
	if !strings.HasPrefix(got, "Operator principles (follow these):\nAlways prefer KISS.") {
		t.Fatalf("expected principles preamble first, got: %q", got)
	}
	if !strings.Contains(got, "review this") {
		t.Fatalf("expected the request to survive, got: %q", got)
	}
}

func TestResolveHeadlessRuntime(t *testing.T) {
	cases := []struct {
		configured string
		want       string
	}{
		{"", "openrouter"},
		{"openrouter", "openrouter"},
		{"pi", "pi"},
		{"claude", "claude"},
		{"codex", "codex"},
		{"opencode", "opencode"},
		{"bogus", "openrouter"},
	}
	for _, tc := range cases {
		if got := resolveHeadlessRuntime(tc.configured); got != tc.want {
			t.Errorf("resolveHeadlessRuntime(%q) = %q, want %q", tc.configured, got, tc.want)
		}
	}
}

// HeadlessSpecForTier resolves the default runtime (openrouter) with a tier model applied. The
// headless:runtime setting is brand new, so an untouched config must behave exactly like the
// hardcoded openrouter calls it replaces.
func TestHeadlessSpecForTier_defaultsToOpenRouter(t *testing.T) {
	spec, ok := HeadlessSpecForTier(TierCheap)
	if !ok {
		t.Fatal("expected the default headless runtime to resolve")
	}
	if spec.ApiBackend == nil {
		t.Error("expected the default openrouter ApiBackend to be set")
	}
	if spec.Model != OpenrouterCheapModel() {
		t.Errorf("cheap tier model = %q, want %q", spec.Model, OpenrouterCheapModel())
	}
}
