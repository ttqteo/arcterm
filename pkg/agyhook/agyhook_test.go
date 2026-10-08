// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agyhook

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/baseds"
)

func loadPayload(t *testing.T, name string) Payload {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("testdata", name))
	if err != nil {
		t.Fatal(err)
	}
	var p Payload
	if err := json.Unmarshal(raw, &p); err != nil {
		t.Fatalf("%s: %v", name, err)
	}
	return p
}

func TestPlanFixtures(t *testing.T) {
	cases := []struct {
		name, event, file string
		state, detail     string
		ask, run          bool
	}{
		{"preinvocation", "PreInvocation", "preinvocation.json", baseds.AgentState_Working, "", false, false},
		{"view_file", "PreToolUse", "pretooluse_view_file.json", baseds.AgentState_Working, "Read main.go", false, false},
		{"run_command", "PreToolUse", "pretooluse_run_command.json", baseds.AgentState_Working, "npm run build", false, true},
		{"ask_question", "PreToolUse", "pretooluse_ask_question.json", baseds.AgentState_Asking, "", true, false},
		{"posttooluse", "PostToolUse", "posttooluse.json", baseds.AgentState_Working, "", false, false},
		{"stop idle", "Stop", "stop.json", baseds.AgentState_Idle, "", false, false},
		{"postinvocation", "PostInvocation", "preinvocation.json", "", "", false, false},
		{"unknown event", "SessionStart", "preinvocation.json", "", "", false, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			em := Plan(c.event, loadPayload(t, c.file))
			if em.State != c.state || em.Detail != c.detail || em.Ask != c.ask || (em.Command != "") != c.run {
				t.Fatalf("Plan(%s) = %+v", c.event, em)
			}
		})
	}
}

func TestPlanAskQuestionParsesQuestions(t *testing.T) {
	em := Plan("PreToolUse", loadPayload(t, "pretooluse_ask_question.json"))
	want := []baseds.AgentAskQuestion{{
		Question: "Which color do you prefer?",
		Options:  []baseds.AgentAskOption{{Label: "Red"}, {Label: "Blue"}},
	}}
	if got, _ := json.Marshal(em.Questions); string(got) != mustJSON(t, want) {
		t.Fatalf("questions = %s", got)
	}
}

func mustJSON(t *testing.T, v any) string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestPlanRunCommandDetailIsTheCommandLine(t *testing.T) {
	em := Plan("PreToolUse", loadPayload(t, "pretooluse_run_command.json"))
	if em.Command != "npm run build" || em.Detail != "npm run build" {
		t.Fatalf("%+v", em)
	}
}

func TestPlanToolWithoutSummaryUsesTheName(t *testing.T) {
	p := loadPayload(t, "pretooluse_view_file.json")
	p.ToolCall.Args = json.RawMessage(`{"AbsolutePath":"/x"}`)
	if em := Plan("PreToolUse", p); em.State != baseds.AgentState_Working || em.Detail != "view_file" {
		t.Fatalf("%+v", em)
	}
	p.ToolCall.Args = nil
	if em := Plan("PreToolUse", p); em.Detail != "view_file" {
		t.Fatalf("%+v", em)
	}
}

func TestPlanAskQuestionWithBadArgsIsAnOrdinaryTool(t *testing.T) {
	p := loadPayload(t, "pretooluse_ask_question.json")
	for _, args := range []string{`{"questions":[]}`, `not json`, ``} {
		p.ToolCall.Args = json.RawMessage(args)
		em := Plan("PreToolUse", p)
		if em.Ask || em.State != baseds.AgentState_Working || em.Detail != "ask_question" {
			t.Fatalf("args %q: %+v", args, em)
		}
	}
}

func TestPlanStopNotIdleReportsNothing(t *testing.T) {
	p := loadPayload(t, "stop.json")
	p.FullyIdle = false
	if em := Plan("Stop", p); em.State != "" {
		t.Fatalf("%+v", em)
	}
}

func TestCwdIsTheLastWorkspacePath(t *testing.T) {
	p := loadPayload(t, "preinvocation.json")
	if got := p.Cwd(); got != "/home/u/proj" {
		t.Fatalf("cwd = %q", got)
	}
	if (Payload{}).Cwd() != "" {
		t.Fatal("empty payload has a cwd")
	}
}

func TestPayloadCarriesTheSessionFields(t *testing.T) {
	p := loadPayload(t, "preinvocation.json")
	if p.ConversationID != "3f2a9c1e-7b4d-4e0a-9d51-2c8b6a1f0e77" || p.ModelName != "gemini-3.8-flash-high" ||
		!strings.HasSuffix(p.TranscriptPath, "/logs/transcript_full.jsonl") {
		t.Fatalf("%+v", p)
	}
	if s := loadPayload(t, "stop.json"); s.TerminationReason != "NO_TOOL_CALL" || !s.FullyIdle {
		t.Fatalf("%+v", s)
	}
}

func TestNeutral(t *testing.T) {
	if got := Neutral("PreToolUse"); len(got) != 0 {
		t.Fatalf("PreToolUse neutral = %q, want empty (`{}` would deny)", got)
	}
	for _, ev := range []string{"PreInvocation", "PostToolUse", "PostInvocation", "Stop"} {
		if got := string(Neutral(ev)); got != "{}" {
			t.Fatalf("%s neutral = %q", ev, got)
		}
	}
}

func TestDenyRoundTrips(t *testing.T) {
	reason := "The user answered in the arcterm cockpit:\nĐồng ý <ok> & \"quoted\" -> \\path"
	var got struct{ Decision, Reason string }
	if err := json.Unmarshal(Deny(reason), &got); err != nil {
		t.Fatal(err)
	}
	if got.Decision != "deny" || got.Reason != reason {
		t.Fatalf("%+v", got)
	}
}

func TestQuestionsConversion(t *testing.T) {
	raw := json.RawMessage(`{"questions":[
		{"question":"Chọn một?","options":["Đồng ý","Không"],"is_multi_select":false},
		{"question":"Line one\nline two","options":["a","b","c"],"is_multi_select":true}],"toolAction":"x"}`)
	qs, err := Questions(raw)
	if err != nil {
		t.Fatal(err)
	}
	if len(qs) != 2 || qs[0].Question != "Chọn một?" || qs[0].MultiSelect || qs[1].Question != "Line one\nline two" || !qs[1].MultiSelect {
		t.Fatalf("%+v", qs)
	}
	if len(qs[0].Options) != 2 || qs[0].Options[0] != (baseds.AgentAskOption{Label: "Đồng ý"}) || qs[0].Header != "" {
		t.Fatalf("%+v", qs[0])
	}
	for _, bad := range []string{``, `nope`, `{}`, `{"questions":[]}`} {
		if _, err := Questions(json.RawMessage(bad)); err == nil {
			t.Fatalf("Questions(%q) accepted", bad)
		}
	}
}

func TestAnswerReasonKeepsEveryByte(t *testing.T) {
	qs := []baseds.AgentAskQuestion{
		{Question: "Chọn một?", Options: []baseds.AgentAskOption{{Label: "Đồng ý"}, {Label: "Không"}}},
		{Question: "Line one\nline two", MultiSelect: true, Options: []baseds.AgentAskOption{{Label: "a, b"}, {Label: "c"}, {Label: "d"}}},
		{Question: "Free?", Options: []baseds.AgentAskOption{{Label: "x"}}},
	}
	answers := []baseds.AgentAnswerItem{
		{SelectedIndexes: []int{0}},
		{SelectedIndexes: []int{0, 2}},
		{Text: "tùy ý\nhai dòng"},
	}
	want := "The user answered in the arcterm cockpit:\n" +
		"Chọn một? -> Đồng ý\n" +
		"Line one\nline two -> a, b, d\n" +
		"Free? -> tùy ý\nhai dòng"
	if got := AnswerReason(qs, answers); got != want {
		t.Fatalf("got %q\nwant %q", got, want)
	}
}

func TestAnswerReasonToleratesShortAndOutOfRangeAnswers(t *testing.T) {
	qs := []baseds.AgentAskQuestion{
		{Question: "A?", Options: []baseds.AgentAskOption{{Label: "x"}}},
		{Question: "B?", Options: []baseds.AgentAskOption{{Label: "y"}}},
	}
	got := AnswerReason(qs, []baseds.AgentAnswerItem{{SelectedIndexes: []int{7, -1, 0}}})
	if !strings.Contains(got, "A? -> x\n") || !strings.Contains(got, "B? -> ") {
		t.Fatalf("%q", got)
	}
}

func TestDismissedReason(t *testing.T) {
	if DismissedReason != "The user dismissed the question." {
		t.Fatal(DismissedReason)
	}
}

func TestHookTimeoutOutlivesTheBound(t *testing.T) {
	if time.Duration(HookTimeoutSeconds)*time.Second-PreToolUseBound < time.Minute {
		t.Fatalf("hook timeout %ds does not clear the %s bound by 60s", HookTimeoutSeconds, PreToolUseBound)
	}
	if PreToolUseBound != 60*time.Minute || HookTimeoutSeconds != 3720 {
		t.Fatal("the bound and timeout are pinned by the spec")
	}
}

func TestOwnsBlock(t *testing.T) {
	cases := []struct {
		controller, cmd string
		want            bool
	}{
		{"cmd", "claude", false},
		{"cmd", "pi", false},
		{"cmd", "agy", true},
		{"cmd", `C:\Users\x\.local\bin\agy.exe`, true},
		{"cmd", "/Users/a b/.local/bin/agy", true},
		{"cmd", "", false},
		{"shell", "", true},
		{"", "", true},
	}
	for _, c := range cases {
		if got := OwnsBlock(c.controller, c.cmd); got != c.want {
			t.Errorf("OwnsBlock(%q, %q) = %v, want %v", c.controller, c.cmd, got, c.want)
		}
	}
}

func TestFirstUserRequest(t *testing.T) {
	head := "{\"step_index\":0,\"type\":\"SYSTEM\",\"content\":\"boot\"}\n" +
		"{\"step_index\":1,\"type\":\"FUTURE_THING\",\"extra\":[1,2]}\n" +
		"not json\n" +
		"{\"step_index\":2,\"source\":\"USER_EXPLICIT\",\"type\":\"USER_INPUT\",\"content\":\"<USER_REQUEST>\\nTạo một ứng dụng\\nline 2\\n</USER_REQUEST>\\n<ADDITIONAL_METADATA>\\nx\\n</ADDITIONAL_METADATA>\"}\n" +
		"{\"step_index\":3,\"type\":\"USER_INPUT\",\"content\":\"<USER_REQUEST>second</USER_REQUEST>\"}\n"
	if got := FirstUserRequest([]byte(head)); got != "Tạo một ứng dụng\nline 2" {
		t.Fatalf("got %q", got)
	}
	// a head cut mid-line never yields a half record
	cut := head[:strings.Index(head, "\"content\":\"<USER_REQUEST>")+30]
	if got := FirstUserRequest([]byte(cut)); got != "" {
		t.Fatalf("partial line gave %q", got)
	}
	if FirstUserRequest(nil) != "" {
		t.Fatal("empty head gave a title")
	}
}
