// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wavevault

import (
	"strings"
	"testing"
)

func TestParseNodeFrontmatterLinksHash(t *testing.T) {
	raw := []byte("---\nid: t-42\nstatus: active\ntags: [a, b]\n---\n\n# The title\n\nbody refs [[m-1]] and [[m-2]] and [[m-1]] again.\n")
	n, body := parseNode("/vault/tasks/active/t-42.md", raw)
	if n.ID != "t-42" {
		t.Fatalf("ID = %q, want t-42", n.ID)
	}
	if n.Frontmatter["status"] != "active" {
		t.Fatalf("status = %v, want active", n.Frontmatter["status"])
	}
	if len(n.Links) != 2 || n.Links[0] != "m-1" || n.Links[1] != "m-2" {
		t.Fatalf("links = %v, want [m-1 m-2] (order-preserving, deduped)", n.Links)
	}
	if n.ContentHash != ContentHash(raw) {
		t.Fatalf("ContentHash on the node must equal ContentHash(raw)")
	}
	if body == "" || body[0] == '-' {
		t.Fatalf("body should be the post-frontmatter content, got %q", body)
	}
}

func TestParseNodeNoFrontmatterFallsBackToFilename(t *testing.T) {
	n, body := parseNode("/vault/memory/note-x.md", []byte("just prose, no frontmatter\n"))
	if n.ID != "note-x" {
		t.Fatalf("ID = %q, want note-x (filename stem)", n.ID)
	}
	if n.Frontmatter != nil {
		t.Fatalf("Frontmatter should be nil when absent, got %v", n.Frontmatter)
	}
	if body != "just prose, no frontmatter\n" {
		t.Fatalf("body = %q", body)
	}
}

func TestContentHashChangesWithContent(t *testing.T) {
	if ContentHash([]byte("a")) == ContentHash([]byte("b")) {
		t.Fatal("different content must hash differently")
	}
	if ContentHash([]byte("a")) != ContentHash([]byte("a")) {
		t.Fatal("hash must be stable")
	}
}

func TestParseNodeCRLF(t *testing.T) {
	const crlf = "---\r\nid: t-1\r\nstatus: completed\r\nobjective: x\r\n---\r\n\r\nbody [[m-1]]\r\n"
	for name, raw := range map[string]string{"crlf": crlf, "bom": "\ufeff" + crlf} {
		n, body := parseNode("/vault/tasks/active/t-1.md", []byte(raw))
		if n.ID != "t-1" || n.Frontmatter["status"] != "completed" {
			t.Fatalf("%s: id=%q fm=%v", name, n.ID, n.Frontmatter)
		}
		if len(n.Links) != 1 || n.Links[0] != "m-1" {
			t.Fatalf("%s: links = %v, want [m-1]", name, n.Links)
		}
		if strings.HasPrefix(body, "---") || strings.Contains(body, "\r") {
			t.Fatalf("%s: body not normalized: %q", name, body)
		}
		if n.ContentHash != ContentHash([]byte(raw)) {
			t.Fatalf("%s: ContentHash must hash the raw bytes", name)
		}
	}
}
