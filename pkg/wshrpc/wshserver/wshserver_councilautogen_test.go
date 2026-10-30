// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"unicode/utf8"

	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/council"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// autogenJSON is s as a JSON string literal, for a fixture line that carries Vietnamese or quotes.
func autogenJSON(t *testing.T, s string) string {
	t.Helper()
	b, err := json.Marshal(s)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

// claudeUser and claudeText are the records of a claude transcript: a prompt the person typed, and an assistant's text.
func claudeUser(t *testing.T, n int, text string) string {
	return fmt.Sprintf(`{"type":"user","timestamp":"2026-10-30T10:%02d:00.000Z","origin":{"kind":"human"},"message":{"role":"user","content":%s}}`, n, autogenJSON(t, text))
}

func claudeText(t *testing.T, n int, text string) string {
	return fmt.Sprintf(`{"type":"assistant","timestamp":"2026-10-30T10:%02d:30.000Z","message":{"content":[{"type":"text","text":%s}]}}`, n, autogenJSON(t, text))
}

// claudeSession is a claude transcript of prompts and replies, with the records claude writes between them that are no
// prompt (a tool result, a harness notice) and a reply that only calls a tool.
func claudeSession(t *testing.T, prompts, replies []string) string {
	t.Helper()
	var lines []string
	for i, p := range prompts {
		lines = append(lines,
			claudeUser(t, i, p),
			`{"type":"assistant","timestamp":"2026-10-30T10:00:10.000Z","message":{"content":[{"type":"tool_use","id":"toolu_1","name":"Bash","input":{"command":"ls"}}]}}`,
			`{"type":"user","timestamp":"2026-10-30T10:00:20.000Z","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_1","content":"a.go"}]}}`,
			claudeText(t, i, replies[i]),
		)
	}
	lines = append(lines,
		`{"type":"user","timestamp":"2026-10-30T11:59:00.000Z","message":{"role":"user","content":"<command-name>/compact</command-name>\n<command-args></command-args>"}}`,
		`{"type":"assistant","timestamp":"2026-10-30T11:59:30.000Z","message":{"content":[{"type":"tool_use","id":"toolu_2","name":"Bash","input":{"command":"ls"}}]}}`,
	)
	return writeTranscript(t, "claude-session", lines...)
}

// piSession is a pi transcript: one active branch of alternating prompts and replies.
func piSession(t *testing.T, prompts, replies []string) string {
	t.Helper()
	lines := []string{`{"type":"session","version":3,"id":"s1","timestamp":"2026-10-30T09:00:00Z","cwd":"/work/radar"}`}
	parent := "null"
	for i, p := range prompts {
		u, a := fmt.Sprintf("u%d", i), fmt.Sprintf("a%d", i)
		lines = append(lines,
			fmt.Sprintf(`{"type":"message","id":%q,"parentId":%s,"timestamp":"2026-10-30T09:%02d:01Z","message":{"role":"user","content":%s}}`, u, parent, i, autogenJSON(t, p)),
			fmt.Sprintf(`{"type":"message","id":%q,"parentId":%q,"timestamp":"2026-10-30T09:%02d:02Z","message":{"role":"assistant","content":[{"type":"text","text":%s}]}}`, a, u, i, autogenJSON(t, replies[i])),
		)
		parent = fmt.Sprintf("%q", a)
	}
	return writeTranscript(t, "pi-session", lines...)
}

// numbered returns n distinct texts, "<tag> 1", "<tag> 2", …
func numbered(tag string, n int) []string {
	out := make([]string, n)
	for i := range out {
		out[i] = fmt.Sprintf("%s %d", tag, i+1)
	}
	return out
}

func TestClipAutogenHead(t *testing.T) {
	vi := strings.Repeat("ế", 600) // 3 bytes a rune: the clip counts runes, not bytes
	if got := clipAutogenHead(vi, autoPromptRunes); got != vi {
		t.Errorf("600 runes of 1,800 bytes were cut to %d runes", utf8.RuneCountInString(got))
	}
	if got := clipAutogenHead("short", autoPromptRunes); got != "short" {
		t.Errorf("a short text came back as %q", got)
	}
	long := strings.Repeat("Tiếng Việt có dấu. ", 60) // 1,140 runes
	got := clipAutogenHead(long, autoPromptRunes)
	if !utf8.ValidString(got) || !strings.HasSuffix(got, "…") || utf8.RuneCountInString(got) != autoPromptRunes+1 {
		t.Fatalf("clipped to %d runes (valid %v), want %d runes and the mark", utf8.RuneCountInString(got), utf8.ValidString(got), autoPromptRunes+1)
	}
	if want := string([]rune(long)[:autoPromptRunes]); !strings.HasPrefix(got, want) {
		t.Error("the clip does not keep the first 600 runes")
	}
	if one := clipAutogenHead(vi+"ế", autoPromptRunes); one != vi+"…" {
		t.Errorf("601 runes clipped to %d runes, want the first 600 and the mark", utf8.RuneCountInString(one))
	}
}

func TestClipAutogenTail(t *testing.T) {
	vi := strings.Repeat("ệ", autoReplyRunes)
	if got := clipAutogenTail(vi, autoReplyRunes); got != vi {
		t.Errorf("1,500 runes of 4,500 bytes were cut to %d runes", utf8.RuneCountInString(got))
	}
	if got := clipAutogenTail("short", autoReplyRunes); got != "short" {
		t.Errorf("a short text came back as %q", got)
	}
	long := strings.Repeat("Kết luận: nên giữ nguyên. ", 120) // 3,120 runes
	got := clipAutogenTail(long, autoReplyRunes)
	if !utf8.ValidString(got) || !strings.HasPrefix(got, "…") || utf8.RuneCountInString(got) != autoReplyRunes+1 {
		t.Fatalf("clipped to %d runes (valid %v), want %d runes and the mark first", utf8.RuneCountInString(got), utf8.ValidString(got), autoReplyRunes+1)
	}
	runes := []rune(long)
	if want := string(runes[len(runes)-autoReplyRunes:]); !strings.HasSuffix(got, want) {
		t.Error("the clip does not keep the last 1,500 runes")
	}
	if one := clipAutogenTail("ệ"+vi, autoReplyRunes); one != "…"+vi {
		t.Errorf("1,501 runes clipped to %d runes, want the mark and the last 1,500", utf8.RuneCountInString(one))
	}
}

func TestConversationFromClaude(t *testing.T) {
	prompts := numbered("prompt", 5)
	replies := numbered("reply", 5)
	prompts[1] = "  " + prompts[1] + "  \n" // trimmed
	path := claudeSession(t, prompts, replies)

	got, ok := conversationFrom("idle-sleep", "claude", path)
	if !ok {
		t.Fatal("a session with prompts was skipped")
	}
	want := council.AgentConversation{
		Name: "idle-sleep", Harness: "claude",
		Prompts: []string{"prompt 3", "prompt 4", "prompt 5"},
		Reply:   "reply 5",
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("conversation = %+v\nwant %+v: the last three prompts, oldest first, and the last reply", got, want)
	}

	// two prompts is all there are: both are kept
	got, ok = conversationFrom("idle-sleep", "claude", claudeSession(t, prompts[:2], replies[:2]))
	if !ok || !reflect.DeepEqual(got.Prompts, []string{"prompt 1", "prompt 2"}) || got.Reply != "reply 2" {
		t.Errorf("two prompts: conversation = %+v, %v", got, ok)
	}
}

func TestConversationFromPi(t *testing.T) {
	path := piSession(t, numbered("pi prompt", 4), numbered("pi reply", 4))
	got, ok := conversationFrom("radar", "pi", path)
	want := council.AgentConversation{
		Name: "radar", Harness: "pi",
		Prompts: []string{"pi prompt 2", "pi prompt 3", "pi prompt 4"},
		Reply:   "pi reply 4",
	}
	if !ok || !reflect.DeepEqual(got, want) {
		t.Errorf("conversation = %+v, %v\nwant %+v", got, ok, want)
	}
}

func TestConversationFromClipsMultibyteText(t *testing.T) {
	longPrompt := strings.Repeat("Hiển thị sai số lượng. ", 40) // 920 runes
	longReply := strings.Repeat("Đã sửa phần đếm xong. ", 100)  // 2,200 runes
	path := claudeSession(t, []string{longPrompt}, []string{longReply})

	got, ok := conversationFrom("radar", "claude", path)
	if !ok || len(got.Prompts) != 1 {
		t.Fatalf("conversation = %+v, %v", got, ok)
	}
	p := got.Prompts[0]
	if !utf8.ValidString(p) || !strings.HasSuffix(p, "…") || utf8.RuneCountInString(p) != autoPromptRunes+1 {
		t.Errorf("prompt is %d runes (valid %v), want the first %d and the mark", utf8.RuneCountInString(p), utf8.ValidString(p), autoPromptRunes)
	}
	r := got.Reply
	if !utf8.ValidString(r) || !strings.HasPrefix(r, "…") || utf8.RuneCountInString(r) != autoReplyRunes+1 {
		t.Errorf("reply is %d runes (valid %v), want the mark and the last %d", utf8.RuneCountInString(r), utf8.ValidString(r), autoReplyRunes)
	}
	if !strings.HasSuffix(strings.TrimSpace(longReply), strings.TrimPrefix(r, "…")) {
		t.Error("the reply is not the end of the answer")
	}
}

func TestConversationFromWithoutPromptsIsSkipped(t *testing.T) {
	noPrompt := writeTranscript(t, "no-prompt",
		claudeText(t, 0, "an answer to nothing"),
		`{"type":"user","timestamp":"2026-10-30T10:00:20.000Z","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_1","content":"a.go"}]}}`,
	)
	for name, c := range map[string]struct{ harness, path string }{
		"a session with no prompt": {"claude", noPrompt},
		"a missing transcript":     {"claude", filepath.Join(t.TempDir(), "gone.jsonl")},
		"a missing pi transcript":  {"pi", filepath.Join(t.TempDir(), "gone.jsonl")},
		"a harness it cannot read": {"codex", noPrompt},
	} {
		if got, ok := conversationFrom("a", c.harness, c.path); ok {
			t.Errorf("%s: conversation = %+v, want it skipped", name, got)
		}
	}
}

func TestConversationFromWithoutAReplyKeepsThePrompts(t *testing.T) {
	path := writeTranscript(t, "unanswered", claudeUser(t, 0, "where do we start?"))
	got, ok := conversationFrom("fresh", "claude", path)
	if !ok || !reflect.DeepEqual(got.Prompts, []string{"where do we start?"}) || got.Reply != "" {
		t.Errorf("conversation = %+v, %v, want the prompt and no reply", got, ok)
	}
}

// autogenCaller is the council runner's caller in a handler test: it records the requests and answers each with text.
type autogenCaller struct {
	mu   sync.Mutex
	reqs []council.CallReq
	text string
}

func (c *autogenCaller) Call(_ context.Context, req council.CallReq) (council.CallRes, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.reqs = append(c.reqs, req)
	return council.CallRes{Text: c.text, Tokens: 10}, nil
}

func (c *autogenCaller) calls() []council.CallReq {
	c.mu.Lock()
	defer c.mu.Unlock()
	return append([]council.CallReq(nil), c.reqs...)
}

// useAutogenRunner runs the council commands of a test through a caller that answers with reply.
func useAutogenRunner(t *testing.T, reply string) *autogenCaller {
	t.Helper()
	caller := &autogenCaller{text: reply}
	swap(t, &councilRunner, newCouncilRunner(caller))
	return caller
}

const autogenReply = "Here it is.\n\n```json\n" + `{"topic":"Idle sleep","question":"Which signal first?","mode":"Brainstorm"}` + "\n```\n"

func TestCouncilAutoGenerateReadsTheSeatedAgents(t *testing.T) {
	claudePath := claudeSession(t, numbered("claude prompt", 5), numbered("claude reply", 5))
	piPath := piSession(t, numbered("pi prompt", 2), numbered("pi reply", 2))
	idle := agentFacts(agentsTabA, "idle-sleep", agentsBlockA, "claude", baseds.AgentState_Idle)
	idle.Status.TranscriptPath = claudePath
	radar := agentFacts(agentsTabB, "radar", agentsBlockB, "pi", baseds.AgentState_Working)
	radar.Status.TranscriptPath = piPath
	// seated, but neither can be read: an agy session cannot sit, and a tab that is gone has no seat
	agy := agentFacts(agentsTabC, "agy", agentsBlockC, "agy", baseds.AgentState_Idle)
	agy.Status.TranscriptPath = claudePath
	scriptAgents(t, &agentRosterFacts{Tabs: []agentTabFacts{idle, radar, agy}})
	caller := useAutogenRunner(t, autogenReply)

	project := t.TempDir()
	got, err := (&WshServer{}).CouncilAutoGenerateCommand(context.Background(), wshrpc.CommandCouncilAutoGenerateData{
		Project: project, Agents: []string{agentsTabA, "no-such-tab", agentsTabC, agentsTabB},
	})
	if err != nil {
		t.Fatalf("CouncilAutoGenerateCommand: %v", err)
	}
	if want := (&council.CouncilAutoGenerate{Topic: "Idle sleep", Question: "Which signal first?", Mode: council.ModeBrainstorm}); !reflect.DeepEqual(got, want) {
		t.Errorf("result = %+v, want %+v", got, want)
	}

	reqs := caller.calls()
	if len(reqs) != 1 {
		t.Fatalf("%d calls, want 1", len(reqs))
	}
	req := reqs[0]
	if req.Tools || req.Cwd != project || req.Expert.Model != "haiku" {
		t.Errorf("request = tools %v cwd %q model %q, want no tools in the project on haiku", req.Tools, req.Cwd, req.Expert.Model)
	}
	for _, want := range []string{
		"idle-sleep (claude)", "claude prompt 3", "claude prompt 4", "claude prompt 5", "claude reply 5",
		"radar (pi)", "pi prompt 1", "pi prompt 2", "pi reply 2",
	} {
		if !strings.Contains(req.Prompt, want) {
			t.Errorf("prompt lacks %q", want)
		}
	}
	for _, not := range []string{"claude prompt 1", "claude prompt 2", "claude reply 4", "agy ("} {
		if strings.Contains(req.Prompt, not) {
			t.Errorf("prompt carries %q, which is not one of the last three prompts, the last reply or a readable seat", not)
		}
	}
	if a, b := strings.Index(req.Prompt, "idle-sleep (claude)"), strings.Index(req.Prompt, "radar (pi)"); a < 0 || a > b {
		t.Error("the agents are not in seat order")
	}
}

func TestCouncilAutoGenerateWithNothingToReadMakesNoCall(t *testing.T) {
	unanswered := agentFacts(agentsTabA, "fresh", agentsBlockA, "claude", baseds.AgentState_Idle) // no transcript yet
	noPrompt := agentFacts(agentsTabB, "silent", agentsBlockB, "claude", baseds.AgentState_Idle)
	noPrompt.Status.TranscriptPath = writeTranscript(t, "no-prompt", claudeText(t, 0, "an answer to nothing"))
	missing := agentFacts(agentsTabC, "missing", agentsBlockC, "pi", baseds.AgentState_Idle)
	missing.Status.TranscriptPath = filepath.Join(t.TempDir(), "gone.jsonl")
	scriptAgents(t, &agentRosterFacts{Tabs: []agentTabFacts{unanswered, noPrompt, missing}})
	caller := useAutogenRunner(t, autogenReply)

	for name, agents := range map[string][]string{
		"unreadable seats": {agentsTabA, agentsTabB, agentsTabC, "no-such-tab"},
		"no seats":         nil,
	} {
		got, err := (&WshServer{}).CouncilAutoGenerateCommand(context.Background(), wshrpc.CommandCouncilAutoGenerateData{Project: t.TempDir(), Agents: agents})
		if err == nil || err.Error() != "none of the seated agents has a conversation to read" || got != nil {
			t.Errorf("%s: result = %+v, err = %v, want the none-of-the-seated-agents error", name, got, err)
		}
	}
	if n := len(caller.calls()); n != 0 {
		t.Errorf("%d calls made with nothing to read, want none", n)
	}
}

func TestCouncilAutoGenerateReportsAMalformedReply(t *testing.T) {
	path := claudeSession(t, numbered("prompt", 1), numbered("reply", 1))
	idle := agentFacts(agentsTabA, "idle-sleep", agentsBlockA, "claude", baseds.AgentState_Idle)
	idle.Status.TranscriptPath = path
	scriptAgents(t, &agentRosterFacts{Tabs: []agentTabFacts{idle}})
	useAutogenRunner(t, "I could not decide.")

	got, err := (&WshServer{}).CouncilAutoGenerateCommand(context.Background(), wshrpc.CommandCouncilAutoGenerateData{Project: t.TempDir(), Agents: []string{agentsTabA}})
	if err == nil || got != nil {
		t.Errorf("result = %+v, err = %v, want the parse error and no result", got, err)
	}
}
