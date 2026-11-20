// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentedits

import (
	"context"
	"fmt"
	"path/filepath"
	"testing"
)

// minEditCalls is the size the large fixture must keep to stay a realistic long session.
const minEditCalls = 100

func benchReplay(b *testing.B, transcript, historyDir, repo string, base Reader) {
	b.ReportAllocs()
	for b.Loop() {
		l, err := Parse(transcript, historyDir)
		if err != nil {
			b.Fatal(err)
		}
		root := repo
		if root == "" {
			root = l.SessionCwd
		}
		if _, err := Replay(l, root, nil, base, none); err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkBuildCommits(b *testing.B) {
	// a session-sized commit build: 20 edited files, one of them new
	repo, parent := tempRepo(b, map[string]string{"keep.txt": "k\n"})
	var files []File
	for i := range 20 {
		f := File{Path: fmt.Sprintf("pkg/f%d.go", i), Pre: []byte("package x\n\nvar a = 1\n"), PreExists: i > 0}
		f.Post, f.PostExists = []byte("package x\n\nvar a = 2\n"), true
		files = append(files, f)
	}
	for b.Loop() {
		if _, _, err := BuildCommits(context.Background(), repo, parent, t0.Unix(), files); err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkParseReplay(b *testing.B) {
	b.Run("large", func(b *testing.B) {
		// testdata/large.jsonl: 10 created files, each written then edited 15 times, plus 20 Bash calls
		transcript := filepath.Join("testdata", "large.jsonl")
		l, err := Parse(transcript, b.TempDir())
		if err != nil {
			b.Fatal(err)
		}
		if l.EditCalls < minEditCalls {
			b.Fatalf("fixture has %d edit calls, want %d+", l.EditCalls, minEditCalls)
		}
		benchReplay(b, transcript, b.TempDir(), "", none)
	})
	b.Run("backups", func(b *testing.B) {
		// a short session over existing files: backups for half, the base reader for the rest
		s := newSession(b)
		base := map[string]string{}
		var lines []string
		for i := range 10 {
			rel := fmt.Sprintf("pkg/f%d.go", i)
			if i%2 == 0 {
				name := fmt.Sprintf("h%d@v1", i)
				s.backup(b, name, "package x\n\nvar a = 1\n")
				lines = append(lines, delta(b, i, s.abs(rel), backupRef{name, 1}))
			} else {
				base[rel] = "package x\n\nvar a = 1\n"
			}
			lines = append(lines, call(b, 100+2*i, s.repo, fmt.Sprintf("e%d", i), "Edit", edit(s.abs(rel), "a = 1", "a = 2"))...)
		}
		writeLines(b, s.transcript, lines)
		benchReplay(b, s.transcript, s.historyDir, s.repo, mapReader(base))
	})
}
