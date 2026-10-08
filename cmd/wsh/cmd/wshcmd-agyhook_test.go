// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/baseds"
)

func agyFixtures(t *testing.T) map[string][]byte {
	t.Helper()
	paths, err := filepath.Glob(filepath.Join("..", "..", "..", "pkg", "agyhook", "testdata", "*.json"))
	if err != nil || len(paths) < 6 {
		t.Fatalf("fixtures: %v %v", paths, err)
	}
	out := map[string][]byte{}
	for _, p := range paths {
		raw, err := os.ReadFile(p)
		if err != nil {
			t.Fatal(err)
		}
		out[filepath.Base(p)] = raw
	}
	return out
}

// outside an arcterm block (the Antigravity desktop app, a plain terminal) every event answers neutral at once:
// nothing for PreToolUse, `{}` for the rest, and no tool is ever denied
func TestAgyHookOutsideABlockIsNeutral(t *testing.T) {
	t.Setenv("WAVETERM_BLOCKID", "")
	t.Setenv("WAVETERM_JWT", "")
	events := []string{"PreInvocation", "PreToolUse", "PostToolUse", "PostInvocation", "Stop"}
	for name, raw := range agyFixtures(t) {
		for _, event := range events {
			var out bytes.Buffer
			if err := runAgyHook(event, bytes.NewReader(raw), &out); err != nil {
				t.Fatalf("%s %s: %v", name, event, err)
			}
			want := "{}"
			if event == "PreToolUse" {
				want = ""
			}
			if out.String() != want {
				t.Fatalf("%s %s printed %q, want %q", name, event, out.String(), want)
			}
		}
	}
}

// a payload that is not JSON, or stdin that is empty, still never fails the turn
func TestAgyHookGarbageStdinIsNeutral(t *testing.T) {
	t.Setenv("WAVETERM_BLOCKID", "")
	for _, in := range []string{"", "not json", "[1,2"} {
		var out bytes.Buffer
		if err := runAgyHook("Stop", strings.NewReader(in), &out); err != nil || out.String() != "{}" {
			t.Fatalf("%q -> %q %v", in, out.String(), err)
		}
	}
}

// with a block id but no JWT there is no cockpit to reach: still neutral, and no denial
func TestAgyHookWithoutAJwtIsNeutral(t *testing.T) {
	t.Setenv("WAVETERM_BLOCKID", "b0b0b0b0-0000-0000-0000-000000000000")
	t.Setenv("WAVETERM_JWT", "")
	raw := agyFixtures(t)["pretooluse_run_command.json"]
	var out bytes.Buffer
	if err := runAgyHook("PreToolUse", bytes.NewReader(raw), &out); err != nil || out.Len() != 0 {
		t.Fatalf("%q %v", out.String(), err)
	}
}

func TestAgyAskDataHoldsTheCard(t *testing.T) {
	qs := []baseds.AgentAskQuestion{{Question: "Q?", Options: []baseds.AgentAskOption{{Label: "A"}}}}
	d := agyAskData("block:abc", qs)
	if !d.Hold || !d.Wait || d.Prose || d.ORef != "block:abc" || len(d.Questions) != 1 || d.Questions[0].Question != "Q?" {
		t.Fatalf("%+v", d)
	}
}

func TestAgyTitleReadsTheFirstRequestFromTheHead(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "transcript_full.jsonl")
	body := `{"step_index":0,"type":"USER_INPUT","content":"<USER_REQUEST>\nFix the login bug\nplease\n</USER_REQUEST>\n<ADDITIONAL_METADATA>\nx\n</ADDITIONAL_METADATA>"}` + "\n" +
		`{"step_index":1,"type":"PLANNER_RESPONSE","content":"ok"}` + "\n"
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := agyTitle(path); got != "Fix the login bug" {
		t.Fatalf("title = %q", got)
	}
	if agyTitle("") != "" || agyTitle(filepath.Join(dir, "missing.jsonl")) != "" {
		t.Fatal("a missing transcript gave a title")
	}
}
