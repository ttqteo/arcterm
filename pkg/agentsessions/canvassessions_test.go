// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentsessions

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// a claude transcript line: one assistant tool call at ts, in cwd
func claudeToolLine(cwd, ts, name, input string) string {
	return `{"type":"assistant","cwd":"` + cwd + `","timestamp":"` + ts + `","message":{"role":"assistant","content":[{"type":"tool_use","name":"` + name + `","input":` + input + `}]}}`
}

func claudeTaskLine(cwd, task string) string {
	return `{"type":"user","cwd":"` + cwd + `","message":{"role":"user","content":"` + task + `"}}`
}

func canvasIDs(got []CanvasSession) []string {
	var ids []string
	for _, s := range got {
		ids = append(ids, s.ID)
	}
	return ids
}

func TestCanvasSessions_listsTheSessionsThatWroteIntoTheTopicLatestWriterFirst(t *testing.T) {
	root := t.TempDir()
	project := "/work/web"
	topic := filepath.Join(project, ".superpowers", "design", "rail")
	board := filepath.Join(topic, "project", "Main.dc.html")
	writeJSONL(t, root, "made.jsonl",
		claudeTaskLine(project, "Draw the rail"),
		claudeToolLine(project, "2026-10-15T08:00:00Z", "Write", `{"file_path":"`+board+`","content":"<html>"}`),
	)
	writeJSONL(t, root, "edited.jsonl",
		claudeTaskLine(project, "Tweak the rail"),
		claudeToolLine(project, "2026-10-15T09:30:00Z", "Edit",
			`{"file_path":"`+filepath.Join(topic, "project", "canvas.json")+`","old_string":"a","new_string":"b"}`),
	)
	// reading the canvas, or naming it in a shell command, is not making it
	writeJSONL(t, root, "looked.jsonl",
		claudeTaskLine(project, "Why no thumbnail"),
		claudeToolLine(project, "2026-10-15T10:00:00Z", "Read", `{"file_path":"`+board+`"}`),
		claudeToolLine(project, "2026-10-15T10:01:00Z", "Bash", `{"command":"grep -l rail `+topic+`/project"}`),
	)
	// another topic whose name starts the same
	writeJSONL(t, root, "other.jsonl",
		claudeTaskLine(project, "Draw the rail sections"),
		claudeToolLine(project, "2026-10-15T11:00:00Z", "Write",
			`{"file_path":"`+filepath.Join(project, ".superpowers", "design", "rail-sections", "project", "Main.dc.html")+`","content":"x"}`),
	)

	got := canvasSessions([]provider{claudeProvider(root)}, topic, time.Time{})
	if ids := canvasIDs(got); strings.Join(ids, ",") != "edited,made" {
		t.Fatalf("sessions = %v, want [edited made]", ids)
	}
	if want := parseTs("2026-10-15T09:30:00Z"); got[0].WroteTs != want {
		t.Errorf("WroteTs = %d, want %d (the session's last write there)", got[0].WroteTs, want)
	}
	if got[1].Task != "Draw the rail" || got[1].ResumeCommand != "claude --resume made" {
		t.Errorf("session = %q / %q, want its task and resume command", got[1].Task, got[1].ResumeCommand)
	}
	if got[1].TranscriptPath != filepath.Join(root, "made.jsonl") {
		t.Errorf("TranscriptPath = %q", got[1].TranscriptPath)
	}
}

// a session that drew its boards with a script still reveals the canvas, as design-local says, from its own project
func TestCanvasSessions_countsARevealOfTheTopicFromTheSessionsProject(t *testing.T) {
	root := t.TempDir()
	project := "/work/web"
	writeJSONL(t, root, "scripted.jsonl",
		claudeTaskLine(project, "Draw it with a script"),
		claudeToolLine(project, "2026-10-15T08:00:00Z", "Bash",
			`{"command":"node gen.js .superpowers/design/rail/project && wsh ui reveal canvas:rail"}`),
	)
	// the same topic name in another project is another canvas
	writeJSONL(t, root, "elsewhere.jsonl",
		claudeTaskLine("/work/api", "Another rail"),
		claudeToolLine("/work/api", "2026-10-15T09:00:00Z", "Bash", `{"command":"wsh ui reveal canvas:rail"}`),
	)
	// a reveal of a topic whose name starts the same
	writeJSONL(t, root, "longer.jsonl",
		claudeTaskLine(project, "Rail sections"),
		claudeToolLine(project, "2026-10-15T10:00:00Z", "Bash", `{"command":"wsh ui reveal canvas:rail-sections"}`),
	)

	got := canvasSessions([]provider{claudeProvider(root)}, filepath.Join(project, ".superpowers", "design", "rail"), time.Time{})
	if ids := canvasIDs(got); strings.Join(ids, ",") != "scripted" {
		t.Fatalf("sessions = %v, want [scripted]", ids)
	}
}

// pi writes with a path relative to the session's cwd
func TestCanvasSessions_resolvesPiRelativeWritesAgainstTheHeaderCwd(t *testing.T) {
	root := t.TempDir()
	project := "/work/web"
	writeJSONL(t, root, "2026-10-15_pi-1.jsonl",
		`{"type":"session","version":3,"id":"pi-1","timestamp":"2026-10-15T08:00:00Z","cwd":"`+project+`"}`,
		`{"type":"message","id":"u1","parentId":null,"message":{"role":"user","content":"draw it"}}`,
		`{"type":"message","id":"a1","parentId":"u1","timestamp":"2026-10-15T08:05:00Z","message":{"role":"assistant","content":[{"type":"toolCall","id":"c1","name":"write","arguments":{"path":".superpowers/design/rail/project/Main.dc.html","content":"x"}}]}}`,
	)

	got := canvasSessions([]provider{piProvider(root)}, filepath.Join(project, ".superpowers", "design", "rail"), time.Time{})
	if ids := canvasIDs(got); strings.Join(ids, ",") != "pi-1" {
		t.Fatalf("sessions = %v, want [pi-1]", ids)
	}
	if want := parseTs("2026-10-15T08:05:00Z"); got[0].WroteTs != want {
		t.Errorf("WroteTs = %d, want %d", got[0].WroteTs, want)
	}
}

// a transcript last touched before the canvas's oldest file cannot hold a write that is still there
func TestCanvasSessions_skipsTranscriptsOlderThanSince(t *testing.T) {
	root := t.TempDir()
	project := "/work/web"
	topic := filepath.Join(project, ".superpowers", "design", "rail")
	line := claudeToolLine(project, "2026-10-01T08:00:00Z", "Write",
		`{"file_path":"`+filepath.Join(topic, "project", "Main.dc.html")+`","content":"x"}`)
	old := writeJSONL(t, root, "old.jsonl", claudeTaskLine(project, "old"), line)
	writeJSONL(t, root, "new.jsonl", claudeTaskLine(project, "new"), line)
	since := time.Now().Add(-time.Hour)
	if err := os.Chtimes(old, since.Add(-time.Hour), since.Add(-time.Hour)); err != nil {
		t.Fatal(err)
	}

	got := canvasSessions([]provider{claudeProvider(root)}, topic, since)
	if ids := canvasIDs(got); strings.Join(ids, ",") != "new" {
		t.Fatalf("sessions = %v, want [new]", ids)
	}
}

func TestDesignTopicOf(t *testing.T) {
	design := filepath.Join("/work/web", ".superpowers", "design")
	cases := []struct {
		path string
		want string
	}{
		{filepath.Join(design, "rail", "project", "Main.dc.html"), filepath.Join(design, "rail")},
		{filepath.Join(design, "rail", "canvas.json"), filepath.Join(design, "rail")},
		// the design folder itself, or a topic folder with nothing named under it, is not a write into a topic
		{filepath.Join(design, "rail"), ""},
		{filepath.Join("/work/web", "src", "design", "rail", "x.ts"), ""},
	}
	for _, c := range cases {
		got, ok := designTopicOf(c.path)
		if got != c.want || ok != (c.want != "") {
			t.Errorf("designTopicOf(%q) = %q, %v; want %q", c.path, got, ok, c.want)
		}
	}
}
