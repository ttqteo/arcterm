// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package blockcontroller

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

type jm = map[string]any

// jsonLine encodes a transcript record the way Claude Code writes it: no HTML escaping, so "<task-notification>"
// stays literal.
func jsonLine(t *testing.T, v any) string {
	t.Helper()
	var b strings.Builder
	enc := json.NewEncoder(&b)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		t.Fatal(err)
	}
	return b.String()
}

// bgStart is the two records of a Bash call run in the background: the call, and its result naming the task id.
func bgStart(t *testing.T, toolUseId, taskId, description string) string {
	call := jm{"type": "assistant", "message": jm{"content": []any{jm{
		"type": "tool_use", "id": toolUseId, "name": "Bash",
		"input": jm{"command": "task dev", "description": description, "run_in_background": true},
	}}}}
	result := jm{
		"type":          "user",
		"message":       jm{"content": []any{jm{"type": "tool_result", "tool_use_id": toolUseId, "content": "Command running in background with ID: " + taskId}}},
		"toolUseResult": jm{"backgroundTaskId": taskId},
	}
	return jsonLine(t, call) + jsonLine(t, result)
}

func bgDoneLine(t *testing.T, toolUseId, taskId string) string {
	return jsonLine(t, jm{"type": "user", "message": jm{
		"content": "<task-notification>\n<task-id>" + taskId + "</task-id>\n<tool-use-id>" + toolUseId + "</tool-use-id>\n<status>completed</status>\n<summary>done</summary>\n</task-notification>",
	}})
}

func writeTranscript(t *testing.T, session, content string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), session+".jsonl")
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestRestoreTranscript(t *testing.T) {
	path := filepath.Join("C:", "p", "abc.jsonl")
	cases := []struct {
		name string
		meta waveobj.MetaMapType
		want string
	}{
		{"claude on its session", withMeta(agentMeta("claude", "--resume", "abc"), waveobj.MetaKey_AgentTranscriptPath, path), path},
		{"another session's transcript", withMeta(agentMeta("claude", "--resume", "xyz"), waveobj.MetaKey_AgentTranscriptPath, path), ""},
		{"no transcript recorded", agentMeta("claude", "--resume", "abc"), ""},
		{"not claude", withMeta(agentMeta("pi", "--session", "abc"), waveobj.MetaKey_AgentTranscriptPath, path), ""},
	}
	for _, c := range cases {
		if got := restoreTranscript(c.meta); got != c.want {
			t.Errorf("%s: got %q, want %q", c.name, got, c.want)
		}
	}
}

func TestReadRestoreTailDropsTheLineTheWindowCuts(t *testing.T) {
	old := restoreTailBytes
	restoreTailBytes = 12
	t.Cleanup(func() { restoreTailBytes = old })
	path := writeTranscript(t, "s", "first line\nsecond\nthird\n")
	got, err := readRestoreTail(path)
	if err != nil {
		t.Fatal(err)
	}
	// the last 12 bytes are "cond\nthird\n": "cond" is the cut end of a line
	if !slices.Equal(got, []string{"third"}) {
		t.Errorf("got %q, want only the whole line", got)
	}
	restoreTailBytes = 1 << 20
	if got, _ = readRestoreTail(path); !slices.Equal(got, []string{"first line", "second", "third"}) {
		t.Errorf("a file inside the window read %q", got)
	}
}

func TestRestoreNudgeText(t *testing.T) {
	if got := restoreNudgeText(false, nil); got != "" {
		t.Errorf("an idle agent with nothing stopped was nudged: %q", got)
	}
	if got := restoreNudgeText(true, nil); got != restoreNudge {
		t.Errorf("a mid-turn agent got %q", got)
	}
	idle := restoreNudgeText(false, []string{"Start the  dev\napp"})
	if !strings.Contains(idle, `"Start the dev app"`) || !strings.Contains(idle, "If you were waiting on them") {
		t.Errorf("an idle agent waiting on a command got %q", idle)
	}
	busy := restoreNudgeText(true, []string{"build"})
	if !strings.HasPrefix(busy, restoreNudge) || !strings.Contains(busy, `"build"`) {
		t.Errorf("a mid-turn agent with a command got %q", busy)
	}
	many := restoreNudgeText(false, []string{"a", "b", "c", "d", "e", "f", "g", strings.Repeat("x", 200)})
	if !strings.Contains(many, `"e", and 3 more`) || strings.Contains(many, `"f"`) {
		t.Errorf("eight commands read %q, want five named and the rest counted", many)
	}
	long := restoreNudgeText(false, []string{strings.Repeat("x", 200)})
	if !strings.Contains(long, strings.Repeat("x", nudgeMaxLabel)+"…") || strings.Contains(long, strings.Repeat("x", nudgeMaxLabel+1)) {
		t.Errorf("a long label was not cut: %q", long)
	}
}

// the case this exists for: an agent ended its turn waiting on a dev app it started in the background; the restart
// killed both, and the agent must be told rather than left idle on a wake that never comes
func TestRestoreLiveAgentsNudgesAnIdleAgentItsRestartLeftWaiting(t *testing.T) {
	var mu sync.Mutex
	nudges := map[string]string{}
	done := make(chan struct{}, 8)
	oldRestart, oldStagger := restartAgentBlock, restoreAgentStagger
	restartAgentBlock = func(_ context.Context, _, blockId string) error {
		mu.Lock()
		nudges[blockId] = takeNudge(blockId, time.Now())
		mu.Unlock()
		done <- struct{}{}
		return nil
	}
	restoreAgentStagger = time.Millisecond
	t.Cleanup(func() { restartAgentBlock, restoreAgentStagger = oldRestart, oldStagger })

	agent := func(session, transcript string) waveobj.MetaMapType {
		m := withMeta(agentMeta("claude", "--resume", session), MetaKey_AgentLive, "1")
		return withMeta(m, waveobj.MetaKey_AgentTranscriptPath, transcript)
	}
	waiting, _ := insertAgentBlock(t, agent("waiting", writeTranscript(t, "waiting",
		bgStart(t, "tu1", "b1", "Start the worktree dev app"))))
	finished, _ := insertAgentBlock(t, agent("finished", writeTranscript(t, "finished",
		bgStart(t, "tu2", "b2", "Build")+bgDoneLine(t, "tu2", "b2"))))
	// a second restart: the resumed session already recorded the command stopped
	again, _ := insertAgentBlock(t, agent("again", writeTranscript(t, "again",
		bgStart(t, "tu3", "b3", "Watch")+jsonLine(t, jm{"type": "user", "message": jm{
			"content": "<task-notification>\n<task-id>b3</task-id>\n<task-id>__orphan_summary__:shell</task-id>\n<status>stopped</status>\n<summary>1 background shell command task didn't finish before the previous session ended.</summary>\n</task-notification>",
		}}))))

	RestoreLiveAgents(context.Background())
	for range 3 {
		select {
		case <-done:
		case <-time.After(5 * time.Second):
			t.Fatal("restored agents did not start")
		}
	}
	mu.Lock()
	defer mu.Unlock()
	if !strings.Contains(nudges[waiting], `"Start the worktree dev app"`) {
		t.Errorf("the agent waiting on its dev app got %q", nudges[waiting])
	}
	if nudges[finished] != "" || nudges[again] != "" {
		t.Errorf("an agent with nothing left running was nudged: finished %q, again %q", nudges[finished], nudges[again])
	}
}
