// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The exec half of pkg/consult: runPipe's drain contract (keep draining after Complete, append only
// non-empty text, surface the first parse error) and Pi's JSONL parse/argv contract. The fake Pi CLI
// is the test binary itself re-executed with WAVE_FAKE_PI_HELPER set, so no fixture binary has to be
// compiled (see TestMain).

package consult

import (
	"context"
	"fmt"
	"os"
	"reflect"
	"slices"
	"strings"
	"testing"
)

const fakePiHelperEnv = "WAVE_FAKE_PI_HELPER"

func TestMain(m *testing.M) {
	if os.Getenv(fakePiHelperEnv) != "" {
		runFakePiHelper(os.Args[1:])
		os.Exit(0)
	}
	os.Exit(m.Run())
}

// runFakePiHelper emits the JSONL script selected by the first positional argument. The prompt
// positional arg is ignored; the script is deterministic so runPipe tests assert exact output.
func runFakePiHelper(args []string) {
	if len(args) == 0 {
		return
	}
	switch args[0] {
	case "drain":
		// text deltas, then a settlement event, then more text: proves runPipe keeps draining after Complete.
		fmt.Println(`{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"hello "},{"type":"text","text":"world"}],"stopReason":"stop"}}`)
		fmt.Println(`{"type":"agent_settled"}`)
		fmt.Println(`{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"tail"}],"stopReason":"stop"}}`)
	case "error":
		fmt.Println(`{"type":"message_end","message":{"role":"assistant","stopReason":"error","errorMessage":"provider failed"}}`)
		fmt.Println(`{"type":"agent_settled"}`)
	case "blank":
		fmt.Println(`{"type":"other_event"}`)
		fmt.Println()
	case "claude":
		// a claude stream-json session: a tool call, the reply, then the result with usage
		fmt.Println(`{"type":"system","subtype":"init"}`)
		fmt.Println(`{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Grep","input":{"pattern":"IdleSleep","path":"pkg/services"}}]}}`)
		fmt.Println(`{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"pkg/services/idle.go"}}]}}`)
		fmt.Println(`{"type":"assistant","message":{"content":[{"type":"text","text":"found "},{"type":"text","text":"it"}]}}`)
		fmt.Println(`{"type":"result","subtype":"success","result":"found it","usage":{"input_tokens":10,"cache_read_input_tokens":900,"cache_creation_input_tokens":40,"output_tokens":50}}`)
	case "two-errors":
		fmt.Println(`{"type":"message_end","message":{"role":"assistant","stopReason":"error","errorMessage":"first failure"}}`)
		fmt.Println(`{"type":"message_end","message":{"role":"assistant","stopReason":"error","errorMessage":"second failure"}}`)
	}
}

// fakePiSpec returns a spec that runs the test binary as a fake Pi CLI emitting the given script.
func fakePiSpec(script string) RuntimeSpec {
	exe, err := os.Executable()
	if err != nil {
		panic(err)
	}
	return RuntimeSpec{Bin: exe, BaseArgs: []string{script}, PromptViaStdin: false, ParseLine: piParseLine}
}

func TestSpecFor_pi(t *testing.T) {
	spec, ok := SpecFor("pi")
	if !ok {
		t.Fatal("expected pi to resolve")
	}
	if spec.Bin != "pi" {
		t.Errorf("bin = %q, want pi", spec.Bin)
	}
	want := []string{"--mode", "json", "--no-session", "--no-extensions"}
	if !reflect.DeepEqual(spec.BaseArgs, want) {
		t.Errorf("BaseArgs = %v, want %v", spec.BaseArgs, want)
	}
	if spec.PromptViaStdin {
		t.Error("pi must pass the prompt positionally")
	}
	if spec.ParseLine == nil {
		t.Fatal("pi must have a ParseLine")
	}
}

func TestPiParseLine(t *testing.T) {
	spec, _ := SpecFor("pi")
	event := spec.ParseLine([]byte(`{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"hello "},{"type":"text","text":"world"}],"stopReason":"stop"}}`))
	if event.Text != "hello world" || event.Err != nil {
		t.Fatalf("event = %+v, want text 'hello world', no err", event)
	}
	event = spec.ParseLine([]byte(`{"type":"message_end","message":{"role":"assistant","stopReason":"error","errorMessage":"provider failed"}}`))
	if event.Err == nil || !strings.Contains(event.Err.Error(), "provider failed") {
		t.Fatalf("event = %+v, want err containing 'provider failed'", event)
	}
	event = spec.ParseLine([]byte(`{"type":"agent_settled"}`))
	if !event.Complete {
		t.Fatalf("event = %+v, want Complete", event)
	}
}

func TestRunClaudeSpec_reportsToolsReplyAndUsage(t *testing.T) {
	os.Setenv(fakePiHelperEnv, "1")
	t.Cleanup(func() { os.Unsetenv(fakePiHelperEnv) })
	spec := fakePiSpec("claude")
	spec.ParseLine = claudeParseLine
	var tools []string
	full, usage, err := runClaudeSpec(context.Background(), spec, "", "prompt", "sonnet", func(d string) { tools = append(tools, d) })
	if err != nil {
		t.Fatalf("runClaudeSpec error: %v", err)
	}
	if full != "found it" {
		t.Errorf("reply = %q, want %q", full, "found it")
	}
	if want := []string{`Grep "IdleSleep" in pkg/services`, "Read idle.go"}; !reflect.DeepEqual(tools, want) {
		t.Errorf("tools = %v, want %v", tools, want)
	}
	if want := (Usage{Model: "sonnet", TotalTokens: 1000}); usage != want {
		t.Errorf("usage = %+v, want %+v", usage, want)
	}
	// a nil onTool is allowed
	if _, _, err := runClaudeSpec(context.Background(), spec, "", "prompt", "", nil); err != nil {
		t.Fatalf("runClaudeSpec with no onTool: %v", err)
	}
}

func TestRunPipe_drainsAfterComplete(t *testing.T) {
	os.Setenv(fakePiHelperEnv, "1")
	t.Cleanup(func() { os.Unsetenv(fakePiHelperEnv) })
	spec := fakePiSpec("drain")
	var chunks []string
	full, err := Run(context.Background(), spec, "", "prompt", func(c string) { chunks = append(chunks, c) })
	if err != nil {
		t.Fatalf("Run error: %v", err)
	}
	if full != "hello worldtail" {
		t.Errorf("full = %q, want %q", full, "hello worldtail")
	}
	want := []string{"hello world", "tail"}
	if !reflect.DeepEqual(chunks, want) {
		t.Errorf("chunks = %v, want %v", chunks, want)
	}
}

func TestRunPipe_returnsParseErrorWithBinContext(t *testing.T) {
	os.Setenv(fakePiHelperEnv, "1")
	t.Cleanup(func() { os.Unsetenv(fakePiHelperEnv) })
	spec := fakePiSpec("error")
	full, err := Run(context.Background(), spec, "", "prompt", func(string) {})
	if err == nil {
		t.Fatal("expected a parse error")
	}
	if !strings.Contains(err.Error(), "provider failed") {
		t.Errorf("err = %v, want 'provider failed'", err)
	}
	if !strings.Contains(err.Error(), spec.Bin) {
		t.Errorf("err = %v, want bin context %q", err, spec.Bin)
	}
	if full != "" {
		t.Errorf("full = %q, want empty (error events carry no reply text)", full)
	}
}

func TestRunPipe_nonReplyEventsProduceEmptyReply(t *testing.T) {
	os.Setenv(fakePiHelperEnv, "1")
	t.Cleanup(func() { os.Unsetenv(fakePiHelperEnv) })
	spec := fakePiSpec("blank")
	full, err := Run(context.Background(), spec, "", "prompt", func(string) {})
	if err != nil {
		t.Fatalf("Run error: %v", err)
	}
	if full != "" {
		t.Errorf("full = %q, want empty", full)
	}
}

func TestRunPipe_keepsTheFirstParseError(t *testing.T) {
	os.Setenv(fakePiHelperEnv, "1")
	t.Cleanup(func() { os.Unsetenv(fakePiHelperEnv) })
	spec := fakePiSpec("two-errors")
	_, err := Run(context.Background(), spec, "", "prompt", func(string) {})
	want := spec.Bin + ": Pi assistant error: first failure"
	if err == nil || err.Error() != want {
		t.Fatalf("err = %v, want %q", err, want)
	}
}

// without a ParseLine stdout is emitted verbatim, chunk by chunk, and never as an empty chunk
func TestRunPipe_rawStdoutEmitsNoEmptyChunk(t *testing.T) {
	os.Setenv(fakePiHelperEnv, "1")
	t.Cleanup(func() { os.Unsetenv(fakePiHelperEnv) })
	spec := fakePiSpec("blank")
	spec.ParseLine = nil
	var chunks []string
	full, err := Run(context.Background(), spec, "", "prompt", func(c string) { chunks = append(chunks, c) })
	if err != nil {
		t.Fatalf("Run error: %v", err)
	}
	if want := "{\"type\":\"other_event\"}\n\n"; full != want {
		t.Fatalf("full = %q, want %q", full, want)
	}
	if strings.Join(chunks, "") != full {
		t.Fatalf("chunks %q do not make up the reply %q", chunks, full)
	}
	for i, c := range chunks {
		if c == "" {
			t.Fatalf("chunk %d of %q is empty", i, chunks)
		}
	}
}

// the stderr capture file is the run's own: it is closed and removed when the run returns
func TestRunPipe_removesTheStderrCapture(t *testing.T) {
	os.Setenv(fakePiHelperEnv, "1")
	t.Cleanup(func() { os.Unsetenv(fakePiHelperEnv) })
	tmp := t.TempDir()
	for _, k := range []string{"TMP", "TEMP", "TMPDIR"} {
		t.Setenv(k, tmp)
	}
	if _, err := Run(context.Background(), fakePiSpec("drain"), "", "prompt", func(string) {}); err != nil {
		t.Fatalf("Run error: %v", err)
	}
	entries, err := os.ReadDir(tmp)
	if err != nil {
		t.Fatal(err)
	}
	var left []string
	for _, e := range entries {
		left = append(left, e.Name())
	}
	if left != nil {
		t.Fatalf("temp dir holds %v after the run, want nothing", left)
	}
}

// a consult call is a few back-to-back turns, so its claude takes the 5-minute prompt cache
func TestStartCmdPassesTheRuntimeEnv(t *testing.T) {
	spec := runtimeSpecs["claude"]
	spec.Bin = "go" // any binary on PATH: startCmd only builds the command
	cmd, stderr, err := startCmd(context.Background(), spec, "", "hi")
	if err != nil {
		t.Fatal(err)
	}
	if stderr != nil {
		defer os.Remove(stderr.Name())
		defer stderr.Close()
	}
	want := PromptCacheTTLEnv + "=" + ShortSessionCacheTTL
	if !slices.Contains(cmd.Env, want) || len(cmd.Env) <= 1 {
		t.Fatalf("cmd.Env lacks %q on top of the inherited environment: %v", want, cmd.Env)
	}
}
