// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package sessionideas

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/agentsessions"
	"github.com/wavetermdev/waveterm/pkg/brainstormcheck"
)

func TestIsMachine(t *testing.T) {
	openings := brainstormcheck.Openings()
	cases := []struct {
		name, entrypoint, prompt string
		want                     bool
	}{
		{"interactive person", "cli", "check the initiative Session ideas", false},
		{"vscode person", "claude-vscode", "fix the build", false},
		{"no entrypoint (older Claude Code)", "", "pull về và build", false},
		{"print-mode pass", "sdk-cli", "You are UX, one expert on a council", true},
		{"board drawer", "sdk-arc-board", "draw this", true},
		{"another sdk entrypoint", "sdk-ts", "", true},
		{"engine session", "bench", "You are a worker", true},
		{"builder check", "cli", openings[0] + " put together a plan", true},
		{"brainstorm judge", "cli", "  " + openings[1] + " A user is designing", true},
		{"person quoting the judge mid-prompt", "cli", "why did it say: " + openings[1], false},
	}
	for _, c := range cases {
		if got := IsMachine(c.entrypoint, c.prompt); got != c.want {
			t.Errorf("%s: IsMachine(%q, %q) = %v, want %v", c.name, c.entrypoint, c.prompt, got, c.want)
		}
	}
}

func TestReadOrigin(t *testing.T) {
	huge := `{"type":"user","message":{"content":[{"type":"image","source":"` + strings.Repeat("A", 2<<20) + `"}]}}`
	cases := []struct {
		name, body, entrypoint, prompt string
	}{
		{
			"string prompt",
			`{"type":"summary","summary":"x"}
{"type":"user","entrypoint":"cli","message":{"content":"hello there"}}
`,
			"cli", "hello there",
		},
		{
			"tags and meta skipped, text blocks joined",
			`{"type":"user","isMeta":true,"entrypoint":"cli","message":{"content":"Caveat: meta"}}
{"type":"user","message":{"content":"<command-name>/clear</command-name>"}}
{"type":"user","message":{"content":[{"type":"tool_result","content":"x"}]}}
{"type":"user","message":{"content":[{"type":"text","text":"first"},{"type":"text","text":"second"}]}}
`,
			"cli", "first second",
		},
		{"image line before the prompt", huge + "\n" + `{"type":"user","entrypoint":"sdk-cli","message":{"content":"go"}}`, "sdk-cli", "go"},
		{
			"a machine entrypoint stops the read before any prompt",
			`{"type":"system","entrypoint":"sdk-cli"}
{"type":"user","message":{"content":"never read"}}
`,
			"sdk-cli", "",
		},
		{"bad lines and no newline at the end", "not json\n{\"type\":\"user\",\"entrypoint\":\"bench\",\"message\":{\"content\":\"work\"}}", "bench", "work"},
		{"empty", "", "", ""},
	}
	for _, c := range cases {
		o, err := readOrigin(strings.NewReader(c.body))
		if err != nil {
			t.Errorf("%s: error %v", c.name, err)
		}
		if o.entrypoint != c.entrypoint || o.firstPrompt != c.prompt {
			t.Errorf("%s: got (%q, %q), want (%q, %q)", c.name, o.entrypoint, o.firstPrompt, c.entrypoint, c.prompt)
		}
	}
}

// The cwd is the first one the records carry, read past the first prompt when the prompt's record has none.
func TestReadOriginCwd(t *testing.T) {
	body := `{"type":"summary","summary":"x"}
{"type":"user","entrypoint":"cli","message":{"content":"hello"}}
{"type":"assistant","cwd":"D:\\work\\thesis","entrypoint":"cli"}
{"type":"user","cwd":"D:\\work\\thesis\\paper","entrypoint":"cli","message":{"content":"next"}}
`
	o, err := readOrigin(strings.NewReader(body))
	if err != nil || o.cwd != `D:\work\thesis` || o.firstPrompt != "hello" {
		t.Fatalf("readOrigin = %+v, %v; want the first cwd and the first prompt", o, err)
	}
}

func writeTranscript(t *testing.T, path, entrypoint, prompt string) agentsessions.DigestSession {
	t.Helper()
	body := `{"type":"user","cwd":"/work/arc","entrypoint":"` + entrypoint + `","message":{"content":"` + prompt + `"}}` + "\n"
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	fi, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	return agentsessions.DigestSession{Path: path, Stem: filepath.Base(path), Size: fi.Size(), Mtime: fi.ModTime()}
}

func TestPersonSessions(t *testing.T) {
	dir := t.TempDir()
	person := writeTranscript(t, filepath.Join(dir, "a.jsonl"), "cli", "plan the sync")
	seat := writeTranscript(t, filepath.Join(dir, "b.jsonl"), "sdk-cli", "You are UX, one expert")
	worker := writeTranscript(t, filepath.Join(dir, "c.jsonl"), "bench", "do task 3")
	judge := writeTranscript(t, filepath.Join(dir, "d.jsonl"), "cli", brainstormcheck.Openings()[1])
	archived := seat
	archived.Path, archived.Archived = filepath.Join(dir, "archived-unread.jsonl"), true // never read: no file there
	missing := agentsessions.DigestSession{Path: filepath.Join(dir, "gone.jsonl"), Mtime: time.Now()}

	got := PersonSessions([]agentsessions.DigestSession{person, seat, worker, judge, archived, missing})
	var paths []string
	for _, c := range got {
		paths = append(paths, filepath.Base(c.Path))
	}
	if want := "a.jsonl archived-unread.jsonl gone.jsonl"; strings.Join(paths, " ") != want {
		t.Fatalf("PersonSessions kept %v, want %s", paths, want)
	}
	if got[0].Cwd != "/work/arc" {
		t.Fatalf("a kept session carries the cwd its head names: %q", got[0].Cwd)
	}

	// the cache holds a file until its size or mtime changes
	if err := os.WriteFile(person.Path, []byte(`{"type":"user","entrypoint":"sdk-cli","message":{"content":"x"}}`+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if IsMachineTranscript(person.Path, person.Size, person.Mtime.UnixMilli()) {
		t.Fatal("a cached person's session was read again though its size and mtime were the cached ones")
	}
	if !IsMachineTranscript(person.Path, person.Size+1, person.Mtime.UnixMilli()) {
		t.Fatal("a changed file was not read again")
	}
}
