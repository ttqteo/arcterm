// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package memhygiene

import (
	"bytes"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func TestHashFileMissingIsEmpty(t *testing.T) {
	dir := t.TempDir()
	got, err := HashFile(filepath.Join(dir, "gone.md"))
	if err != nil || got != "" {
		t.Fatalf("HashFile(missing) = %q, %v; want empty, nil", got, err)
	}
	path := filepath.Join(dir, "a.md")
	writeFile(t, path, "abc")
	got, err = HashFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if want := "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"; got != want {
		t.Fatalf("HashFile = %q, want %q", got, want)
	}
}

func TestChangeIDOrderIndependent(t *testing.T) {
	a := wshrpc.MemFileRef{Path: "/m/a.md", Sha256: "1"}
	b := wshrpc.MemFileRef{Path: "/m/b.md", Sha256: "2"}
	id := ChangeID("merge", []wshrpc.MemFileRef{a, b})
	if ChangeID("merge", []wshrpc.MemFileRef{b, a}) != id {
		t.Error("the same files in another order gave another id")
	}
	if ChangeID("merge", []wshrpc.MemFileRef{a, {Path: b.Path, Sha256: "3"}}) == id {
		t.Error("a changed hash kept the id")
	}
	if ChangeID("delete", []wshrpc.MemFileRef{a, b}) == id {
		t.Error("another kind kept the id")
	}
}

func TestTextFileRoundTrip(t *testing.T) {
	dir := t.TempDir()
	cases := []struct {
		name, content string
		eol           string
		bom, final    bool
		lines         []string
	}{
		{"lf", "a\nb\n", "\n", false, true, []string{"a", "b"}},
		{"crlf", "a\r\nb\r\n", "\r\n", false, true, []string{"a", "b"}},
		{"bom", "\xEF\xBB\xBFa\r\nb\r\n", "\r\n", true, true, []string{"a", "b"}},
		{"nofinal", "a\nb", "\n", false, false, []string{"a", "b"}},
		{"crlf-nofinal", "a\r\nb", "\r\n", false, false, []string{"a", "b"}},
		{"blank-lines", "a\n\n\nb\n\n", "\n", false, true, []string{"a", "", "", "b", ""}},
		{"empty", "", "\n", false, false, nil},
	}
	for _, c := range cases {
		path := filepath.Join(dir, c.name+".md")
		writeFile(t, path, c.content)
		tf, err := ReadText(path)
		if err != nil {
			t.Fatal(err)
		}
		if tf.EOL != c.eol || tf.BOM != c.bom || tf.FinalEOL != c.final || !reflect.DeepEqual(tf.Lines, c.lines) {
			t.Errorf("%s: parsed %+v", c.name, tf)
		}
		if got := tf.Bytes(); !bytes.Equal(got, []byte(c.content)) {
			t.Errorf("%s: round trip %q, want %q", c.name, got, c.content)
		}
	}
}

func TestReadTextMissingAddsLF(t *testing.T) {
	tf, err := ReadText(filepath.Join(t.TempDir(), "MEMORY.md"))
	if err != nil {
		t.Fatal(err)
	}
	if len(tf.Bytes()) != 0 {
		t.Fatalf("missing file's bytes = %q, want empty", tf.Bytes())
	}
	tf.Lines = append(tf.Lines, "- [a](a.md)")
	if got := string(tf.Bytes()); got != "- [a](a.md)\n" {
		t.Fatalf("a line added to a missing file = %q", got)
	}
}

func TestWriteAtomicReplaces(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "sub", "f.md")
	if err := WriteAtomic(path, []byte("one")); err != nil {
		t.Fatal(err)
	}
	if err := WriteAtomic(path, []byte("two")); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "two" {
		t.Fatalf("content = %q, want two", got)
	}
	entries, err := os.ReadDir(filepath.Dir(path))
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 {
		t.Fatalf("temp files left behind: %d entries", len(entries))
	}
}

func TestIndexLinks(t *testing.T) {
	cases := []struct {
		line string
		want []string
	}{
		{"- [A](a.md) and [B](b.md) — hook", []string{"a.md", "b.md"}},
		{"- [Spaced](my%20note.md) — hook", []string{"my note.md"}},
		{"- [Site](https://x.dev/README.md), [img](pic.png), [doc](guide.MD#part)", []string{"guide.MD"}},
		{"plain text, no links", nil},
	}
	for _, c := range cases {
		if got := IndexLinks(c.line); !reflect.DeepEqual(got, c.want) {
			t.Errorf("IndexLinks(%q) = %q, want %q", c.line, got, c.want)
		}
	}
}
