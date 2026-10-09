// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

func TestBuildAgentStatusEvent(t *testing.T) {
	oref := &waveobj.ORef{OType: waveobj.OType_Block, OID: "abc"}
	data := baseds.AgentStatusData{ORef: oref.String(), State: baseds.AgentState_Working}

	ev := buildAgentStatusEvent(oref, data, 1)

	if ev.Event != wps.Event_AgentStatus {
		t.Fatalf("event type = %q, want %q", ev.Event, wps.Event_AgentStatus)
	}
	if ev.Persist != 1 {
		t.Fatalf("persist = %d, want 1", ev.Persist)
	}
	if len(ev.Scopes) != 1 || ev.Scopes[0] != "block:abc" {
		t.Fatalf("scopes = %v, want [block:abc]", ev.Scopes)
	}
	if got, ok := ev.Data.(baseds.AgentStatusData); !ok || got.State != baseds.AgentState_Working {
		t.Fatalf("data = %#v, want AgentStatusData{State:working}", ev.Data)
	}
}

// a hook process exits the moment the publish returns, so a publish that returns before wavesrv has the
// event loses it to os.Exit: live, most compaction reports never arrived and the handoff went unconfirmed
func TestPublishAgentStatusDataReturnsOnlyOnceTheServerHasTheEvent(t *testing.T) {
	inputCh := make(chan baseds.RpcInputChType, 1)
	outputCh := make(chan []byte, 1)
	prev := RpcClient
	RpcClient = wshutil.MakeWshRpcWithChannels(inputCh, outputCh, wshrpc.RpcContext{}, nil, "test")
	defer func() { RpcClient = prev }()
	oref := &waveobj.ORef{OType: waveobj.OType_Block, OID: "abc"}

	done := make(chan error, 1)
	go func() {
		done <- publishAgentStatusData(oref, baseds.AgentStatusData{ORef: oref.String(), State: baseds.AgentState_Working}, 1)
	}()
	var req wshutil.RpcMessage
	select {
	case msg := <-outputCh:
		if err := json.Unmarshal(msg, &req); err != nil {
			t.Fatalf("request is not an rpc message: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("no request was sent")
	}
	select {
	case <-done:
		t.Fatal("publish returned before the server replied")
	case <-time.After(100 * time.Millisecond):
	}
	if req.Command != "eventpublish" || req.ReqId == "" {
		t.Fatalf("request = %+v, want an eventpublish that expects a reply", req)
	}

	resp, _ := json.Marshal(wshutil.RpcMessage{ResId: req.ReqId})
	inputCh <- baseds.RpcInputChType{MsgBytes: resp}
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("publish = %v, want nil once the server replies", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("publish did not return after the server replied")
	}
}

func TestValidAgentState(t *testing.T) {
	for _, s := range []string{"working", "waiting", "idle"} {
		if !validAgentState(s) {
			t.Fatalf("validAgentState(%q) = false, want true", s)
		}
	}
	for _, s := range []string{"", "asking", "running", "done"} {
		if validAgentState(s) {
			t.Fatalf("validAgentState(%q) = true, want false", s)
		}
	}
}

func TestBuildAgentStatusData_piPayload(t *testing.T) {
	oref := &waveobj.ORef{OType: waveobj.OType_Block, OID: "abc"}
	transcript := `C:\Users\Jane Doe\.pi\agent\sessions\s.jsonl`
	data := buildAgentStatusData(oref, "working", "running a tool", "pi",
		`C:\Users\Jane Doe\proj`, transcript, "session-1", "fix the bug", "openai-codex", "gpt-5.5", 12345)

	if data.ORef != "block:abc" {
		t.Fatalf("ORef = %q, want block:abc", data.ORef)
	}
	if data.State != "working" {
		t.Fatalf("State = %q, want working", data.State)
	}
	if data.Detail != "running a tool" {
		t.Fatalf("Detail = %q, want running a tool", data.Detail)
	}
	if data.Agent != "pi" {
		t.Fatalf("Agent = %q, want pi", data.Agent)
	}
	if data.Cwd != `C:\Users\Jane Doe\proj` {
		t.Fatalf("Cwd = %q, want the project path unmodified", data.Cwd)
	}
	// the Windows session file path must survive as one string, never split on '\'
	if data.TranscriptPath != transcript {
		t.Fatalf("TranscriptPath = %q, want %q (preserved as one string)", data.TranscriptPath, transcript)
	}
	if data.SessionID != "session-1" {
		t.Fatalf("SessionID = %q, want session-1", data.SessionID)
	}
	if data.Title != "fix the bug" {
		t.Fatalf("Title = %q, want fix the bug", data.Title)
	}
	if data.Provider != "openai-codex" {
		t.Fatalf("Provider = %q, want openai-codex", data.Provider)
	}
	if data.Model != "gpt-5.5" {
		t.Fatalf("Model = %q, want gpt-5.5", data.Model)
	}
	if data.Ts != 12345 {
		t.Fatalf("Ts = %d, want 12345", data.Ts)
	}
	if data.Usage != nil {
		t.Fatalf("Usage = %#v, want nil", data.Usage)
	}
}

// the frontend keys Claude rate-limit snapshots per account, so a usage delta names the account its
// session runs on (wavesrv puts the active one in ARC_CLAUDE_ACCOUNT before spawning anything)
func TestBuildUsageDeltaTagsClaudeAccount(t *testing.T) {
	t.Setenv("ARC_CLAUDE_ACCOUNT", "a1234abcd")
	if got := buildUsageDelta(agentStatusCmd); got.Account != "a1234abcd" {
		t.Fatalf("usage account = %q, want a1234abcd", got.Account)
	}
	t.Setenv("ARC_CLAUDE_ACCOUNT", "")
	if got := buildUsageDelta(agentStatusCmd); got.Account != "" {
		t.Fatalf("usage account = %q, want \"\" (Default)", got.Account)
	}
}

func TestEnrichCodexStatus(t *testing.T) {
	path := filepath.Join(t.TempDir(), "rollout.jsonl")
	transcript := "{\"type\":\"session_meta\",\"payload\":{\"id\":\"thread-1\",\"cwd\":\"/project\"}}\n" +
		"{\"type\":\"turn_context\",\"payload\":{\"model\":\"gpt-5.5\"}}\n" +
		"{\"type\":\"event_msg\",\"payload\":{\"type\":\"user_message\",\"message\":\"Fix sidebar icons\"}}\n"
	if err := os.WriteFile(path, []byte(transcript), 0600); err != nil {
		t.Fatal(err)
	}
	got := enrichCodexStatus(baseds.AgentStatusData{TranscriptPath: path}, "thread-1")
	if got.Agent != "codex" || got.SessionID != "thread-1" || got.Title != "Fix sidebar icons" || got.Model != "gpt-5.5" || got.Cwd != "/project" {
		t.Fatalf("unexpected metadata: %+v", got)
	}
	explicit := baseds.AgentStatusData{Agent: "codex", TranscriptPath: path, Title: "My title", Model: "my-model", Cwd: "/other", SessionID: "explicit"}
	if got := enrichCodexStatus(explicit, "thread-1"); got != explicit {
		t.Fatalf("explicit metadata changed: %+v", got)
	}
	other := baseds.AgentStatusData{Agent: "pi", TranscriptPath: path}
	if got := enrichCodexStatus(other, "thread-1"); got != other {
		t.Fatalf("other runtime changed: %+v", got)
	}
}
