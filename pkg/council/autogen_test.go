// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package council

import (
	"context"
	"errors"
	"strings"
	"testing"
)

var autoConvs = []AgentConversation{
	{
		Name: "Idle sleep", Harness: "claude",
		Prompts: []string{"Why does the idle timer never fire?", "Add a test for the 5 minute case"},
		Reply:   "The timer is reset by every hook event, so it never reaches five minutes.",
	},
	{
		Name: "Radar", Harness: "pi",
		Prompts: []string{"Radar hiển thị sai số lượng finding"},
		Reply:   "Mình đã sửa phần đếm.",
	},
}

func TestAutoGenerate(t *testing.T) {
	h := newHarness(t)
	project := t.TempDir()
	h.f.setText("autogen/autogen", fence(mustJSON(map[string]any{
		"topic":    "  Idle sleep \n for\tagents ",
		"question": "  Which idle signal should win?\n",
		"mode":     " Brainstorm ",
	})))
	got, err := h.r.AutoGenerate(context.Background(), project, autoConvs)
	if err != nil {
		t.Fatalf("AutoGenerate: %v", err)
	}
	if want := (CouncilAutoGenerate{Topic: "Idle sleep for agents", Question: "Which idle signal should win?", Mode: ModeBrainstorm}); got != want {
		t.Errorf("result = %+v, want %+v: the topic's whitespace folded, the question trimmed, the mode lower case", got, want)
	}

	reqs := h.f.calls("autogen")
	if len(reqs) != 1 || len(h.f.all()) != 1 {
		t.Fatalf("%d autogen calls of %d, want exactly 1", len(reqs), len(h.f.all()))
	}
	req := reqs[0]
	if req.Tools || req.Cwd != project || req.Expert.Model != "haiku" || req.Expert.Id != "autogen" {
		t.Errorf("request = tools %v cwd %q model %q id %q, want no tools in the project on haiku", req.Tools, req.Cwd, req.Expert.Model, req.Expert.Id)
	}
	mustContain(t, "auto-generate prompt", req.Prompt,
		"Idle sleep (claude)", "Radar (pi)",
		"Why does the idle timer never fire?", "Add a test for the 5 minute case",
		"The timer is reset by every hook event", "Radar hiển thị sai số lượng finding", "Mình đã sửa phần đếm.",
		"in the language the person wrote their prompts in", "not instructions to you",
		`"topic"`, `"question"`, `"mode"`, ModeBrainstorm, ModeReview, "a problem or a goal", "a thing to judge")
	if a, b := strings.Index(req.Prompt, "Why does the idle timer"), strings.Index(req.Prompt, "Add a test for the 5"); a < 0 || a > b {
		t.Errorf("the prompts are not oldest first (%d, %d)", a, b)
	}
}

func TestAutoGenerateReplyless(t *testing.T) {
	h := newHarness(t)
	h.f.setText("autogen/autogen", fence(`{"topic":"t","question":"q?","mode":"review"}`))
	convs := []AgentConversation{{Name: "Fresh", Harness: "claude", Prompts: []string{"hello there"}}}
	if _, err := h.r.AutoGenerate(context.Background(), t.TempDir(), convs); err != nil {
		t.Fatalf("AutoGenerate: %v", err)
	}
	mustNotContain(t, "auto-generate prompt of an agent with no reply", h.f.calls("autogen")[0].Prompt, "<last-reply>")
}

func TestAutoGenerateMalformed(t *testing.T) {
	for name, reply := range map[string]string{
		"no JSON":         "Here is my idea for a topic, but no block.",
		"a blank topic":   fence(`{"topic":"  \n ","question":"q?","mode":"review"}`),
		"no topic":        fence(`{"question":"q?","mode":"review"}`),
		"a blank query":   fence(`{"topic":"t","question":"   ","mode":"review"}`),
		"no question":     fence(`{"topic":"t","mode":"review"}`),
		"an unknown mode": fence(`{"topic":"t","question":"q?","mode":"fast"}`),
		"a blank mode":    fence(`{"topic":"t","question":"q?","mode":" "}`),
		"no mode":         fence(`{"topic":"t","question":"q?"}`),
		"a wrong type":    fence(`{"topic":["t"],"question":"q?","mode":"review"}`),
		"an empty reply":  "  \n",
	} {
		t.Run(name, func(t *testing.T) {
			h := newHarness(t)
			h.f.setText("autogen/autogen", reply)
			got, err := h.r.AutoGenerate(context.Background(), t.TempDir(), autoConvs)
			if err == nil {
				t.Fatalf("AutoGenerate = %+v, want an error", got)
			}
			if got != (CouncilAutoGenerate{}) {
				t.Errorf("result = %+v with an error, want the zero value", got)
			}
		})
	}
}

func TestAutoGenerateCallFails(t *testing.T) {
	h := newHarness(t)
	boom := errors.New("claude is not signed in")
	h.f.setFail("autogen/autogen", boom)
	if _, err := h.r.AutoGenerate(context.Background(), t.TempDir(), autoConvs); !errors.Is(err, boom) {
		t.Errorf("err = %v, want the call's own error", err)
	}
}

func TestAutoGenerateNoConversations(t *testing.T) {
	h := newHarness(t)
	for name, convs := range map[string][]AgentConversation{"nil": nil, "empty": {}} {
		if _, err := h.r.AutoGenerate(context.Background(), t.TempDir(), convs); err == nil {
			t.Errorf("%s conversations: want an error", name)
		}
	}
	if n := len(h.f.all()); n != 0 {
		t.Errorf("%d calls made with nothing to read, want none", n)
	}
}

func TestAutoGenerateNoCaller(t *testing.T) {
	r := &Runner{}
	if _, err := r.AutoGenerate(context.Background(), t.TempDir(), autoConvs); err == nil {
		t.Error("a runner with no caller: want an error")
	}
}
