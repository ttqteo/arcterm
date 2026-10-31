// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func b64(s string) string { return base64.StdEncoding.EncodeToString([]byte(s)) }

func readString(t *testing.T, p string) string {
	t.Helper()
	b, err := os.ReadFile(p)
	if err != nil {
		t.Fatalf("read %s: %v", p, err)
	}
	return string(b)
}

func TestDropNameAt(t *testing.T) {
	cases := []struct {
		name string
		n    int
		want string
	}{
		{"a.txt", 0, "a.txt"},
		{"a.txt", 1, "a (1).txt"},
		{"a.txt", 2, "a (2).txt"},
		{"src", 1, "src (1)"},
		{".env", 1, ".env (1)"},
		{"a.b.c", 1, "a.b (1).c"},
		{"logs.tar.gz", 1, "logs (1).tar.gz"},
		{"LOGS.TAR.GZ", 3, "LOGS (3).TAR.GZ"},
		{".tar.gz", 1, ".tar (1).gz"},
	}
	dir := t.TempDir()
	for _, c := range cases {
		got := dropNameAt(filepath.Join(dir, c.name), c.n)
		if got != filepath.Join(dir, c.want) {
			t.Errorf("dropNameAt(%q, %d) = %q, want %q", c.name, c.n, filepath.Base(got), c.want)
		}
	}
}

// a file comes in chunks: offset 0 makes it (and its folders), each later chunk lands at the end
func TestFileDropWriteChunks(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "deep", "er", "a.txt")
	got, err := fileDropWrite(wshrpc.CommandFileDropWriteData{Path: p, Data64: b64("hello ")})
	if err != nil || got != p {
		t.Fatalf("first chunk: %q, %v", got, err)
	}
	if _, err := fileDropWrite(wshrpc.CommandFileDropWriteData{Path: p, Data64: b64("world"), Offset: 6}); err != nil {
		t.Fatalf("second chunk: %v", err)
	}
	if s := readString(t, p); s != "hello world" {
		t.Fatalf("content %q", s)
	}
	// a chunk at the wrong offset is refused and changes nothing
	if _, err := fileDropWrite(wshrpc.CommandFileDropWriteData{Path: p, Data64: b64("!"), Offset: 3}); err == nil {
		t.Fatal("a chunk at offset 3 of an 11-byte file was taken")
	}
	if s := readString(t, p); s != "hello world" {
		t.Fatalf("content after a refused chunk %q", s)
	}
}

// what is there is never replaced: a plain write refuses, a unique one takes "a (1).txt", then "a (2).txt"
func TestFileDropWriteNeverReplaces(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "a.txt")
	if err := os.WriteFile(p, []byte("mine"), 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := fileDropWrite(wshrpc.CommandFileDropWriteData{Path: p, Data64: b64("theirs")}); err == nil {
		t.Fatal("a plain write replaced a file")
	}
	for i, want := range []string{"a (1).txt", "a (2).txt"} {
		got, err := fileDropWrite(wshrpc.CommandFileDropWriteData{Path: p, Data64: b64("theirs"), Unique: true})
		if err != nil || got != filepath.Join(dir, want) {
			t.Fatalf("unique write %d: %q, %v; want %s", i, got, err, want)
		}
	}
	if s := readString(t, p); s != "mine" {
		t.Fatalf("the file that was there now reads %q", s)
	}
	// an empty file is a write with no data
	empty, err := fileDropWrite(wshrpc.CommandFileDropWriteData{Path: filepath.Join(dir, "empty")})
	if err != nil {
		t.Fatal(err)
	}
	if s := readString(t, empty); s != "" {
		t.Fatalf("empty file reads %q", s)
	}
}

func TestFileDropWriteDir(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "src")
	if err := os.Mkdir(p, 0755); err != nil {
		t.Fatal(err)
	}
	got, err := fileDropWrite(wshrpc.CommandFileDropWriteData{Path: p, Dir: true, Unique: true})
	if err != nil || got != filepath.Join(dir, "src (1)") {
		t.Fatalf("unique folder: %q, %v", got, err)
	}
	// a folder inside a dropped one takes what is there
	inner := filepath.Join(got, "a", "b")
	if got, err := fileDropWrite(wshrpc.CommandFileDropWriteData{Path: inner, Dir: true}); err != nil || got != inner {
		t.Fatalf("inner folder: %q, %v", got, err)
	}
	if got, err := fileDropWrite(wshrpc.CommandFileDropWriteData{Path: inner, Dir: true}); err != nil || got != inner {
		t.Fatalf("inner folder again: %q, %v", got, err)
	}
	// a file named like a folder that is there gets a free name too
	f, err := fileDropWrite(wshrpc.CommandFileDropWriteData{Path: p, Data64: b64("x"), Unique: true})
	if err != nil || f != filepath.Join(dir, "src (2)") {
		t.Fatalf("file over a folder: %q, %v", f, err)
	}
}

func TestFileDropWriteRefuses(t *testing.T) {
	dir := t.TempDir()
	bad := []wshrpc.CommandFileDropWriteData{
		{Path: "rel/a.txt"},
		{Path: ""},
		{Path: filepath.Join(dir, "a"), Offset: -1},
		{Path: filepath.Join(dir, "a"), Offset: 4, Unique: true},
		{Path: filepath.Join(dir, "a"), Offset: 4, Dir: true},
		{Path: filepath.Join(dir, "a"), Data64: "not base64!"},
		{Path: filepath.Join(dir, "missing"), Data64: b64("x"), Offset: 1},
	}
	for i, d := range bad {
		if _, err := fileDropWrite(d); err == nil {
			t.Errorf("case %d (%+v) was taken", i, d)
		}
	}
}
