// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package wavevault is the git-backed Wave Vault storage substrate for Jarvis v1: a deterministic
// read API (frontmatter query, full-text, wikilink expansion, content hash), a region-aware
// diff-validated write path, and ownership-staged commits. It calls no model and exposes no RPC.
package wavevault

import (
	"crypto/sha256"
	"encoding/hex"
	"path/filepath"
	"regexp"
	"strings"

	"gopkg.in/yaml.v3"
)

// Node is one parsed vault file. Body is returned separately by parseNode (the graph stores it
// alongside). Collection, Source, Scope and UpdatedTs are filled in by the scanner, not by parseNode.
type Node struct {
	ID          string         `json:"id"`
	Path        string         `json:"path"`
	Collection  string         `json:"collection"`
	Source      string         `json:"source"` // "vault" | "claude" | "codex" — which root it came from
	Scope       string         `json:"scope"`  // memory only: project label for a mirrored hub note, else "shared"
	Frontmatter map[string]any `json:"frontmatter"`
	Links       []string       `json:"links"`
	ContentHash string         `json:"contenthash"`
	UpdatedTs   int64          `json:"updatedts"`
}

var linkRe = regexp.MustCompile(`\[\[([^\]]+)\]\]`)

// ContentHash is the sha256 (hex) of the raw file bytes — the per-node invalidation key C keys on.
func ContentHash(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

// utf8BOM is the UTF-8 byte order mark (U+FEFF) a Windows editor may put at the start of a file.
const utf8BOM = "\xef\xbb\xbf"

// normalizeEOL is the one place a file's line endings are reconciled with the "---\n" front matter
// grammar the parser, splice and write guard all speak: it drops a leading UTF-8 BOM and turns CRLF
// into LF. bom and crlf say what to put back (restoreEOL) so a write keeps the file's style; crlf is
// the majority style, so a CRLF file with an odd bare LF stays CRLF and an LF file with one pasted
// CRLF line stays LF, rather than one stray line flipping the whole file.
func normalizeEOL(s string) (text string, bom, crlf bool) {
	if strings.HasPrefix(s, utf8BOM) {
		s = s[len(utf8BOM):]
		bom = true
	}
	if n := strings.Count(s, "\r\n"); n > 0 {
		crlf = n > strings.Count(s, "\n")-n
		s = strings.ReplaceAll(s, "\r\n", "\n")
	}
	return s, bom, crlf
}

// restoreEOL undoes normalizeEOL on text that has only LF line ends.
func restoreEOL(text string, bom, crlf bool) string {
	if crlf {
		text = strings.ReplaceAll(text, "\n", "\r\n")
	}
	if bom {
		text = utf8BOM + text
	}
	return text
}

// parseNode splits frontmatter from body, unmarshals the frontmatter into a map (order does not
// matter for querying; the write path preserves order by splicing raw text, not re-serializing this
// map), extracts deduped [[wikilinks]] in order, and hashes the raw bytes. ID is frontmatter id,
// else name, else the filename stem. Front matter and body are line-ending normalized (CRLF, BOM).
func parseNode(path string, data []byte) (Node, string) {
	n := Node{Path: path, ContentHash: ContentHash(data)}
	body, _, _ := normalizeEOL(string(data))
	if strings.HasPrefix(body, "---\n") {
		if end := strings.Index(body[4:], "\n---"); end >= 0 {
			fmText := body[4 : 4+end]
			rest := body[4+end+4:]
			rest = strings.TrimLeft(rest, "\n")
			var fm map[string]any
			if err := yaml.Unmarshal([]byte(fmText), &fm); err == nil {
				n.Frontmatter = fm
			}
			body = rest
		}
	}
	if s, ok := n.Frontmatter["id"].(string); ok {
		n.ID = s
	}
	if n.ID == "" {
		if s, ok := n.Frontmatter["name"].(string); ok {
			n.ID = s
		}
	}
	if n.ID == "" {
		n.ID = strings.TrimSuffix(filepath.Base(path), ".md")
	}
	seen := map[string]bool{}
	for _, m := range linkRe.FindAllStringSubmatch(body, -1) {
		t := strings.TrimSpace(m[1])
		if t != "" && !seen[t] {
			seen[t] = true
			n.Links = append(n.Links, t)
		}
	}
	return n, body
}
