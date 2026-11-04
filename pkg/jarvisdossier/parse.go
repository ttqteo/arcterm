// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package jarvisdossier is the typed task-dossier and decision-record layer over the Wave Vault
// (pkg/wavevault). It owns the dossier/decision schemas as wavevault.RegionSpecs, renders the
// Markdown A can splice, and exposes typed create/load/update operations. It calls no model.
package jarvisdossier

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/util/asciifold"
)

// nowFn returns the current time in Unix millis. A package var so tests can pin it.
var nowFn = func() int64 { return time.Now().UnixMilli() }

var slugRe = regexp.MustCompile(`[^a-z0-9]+`)
var linkRe = regexp.MustCompile(`\[\[([^\]]+)\]\]`)

const maxSlugLen = 48

// boundedSlug lowercases s and drops its diacritics ("Cải tiến" → "cai-tien"), replaces runs of non-alphanumerics with '-', trims, substitutes fallback
// when empty, and caps length so a generated filename never overruns Windows MAX_PATH.
func boundedSlug(s, fallback string) string {
	slug := strings.Trim(slugRe.ReplaceAllString(asciifold.Lower(strings.TrimSpace(s)), "-"), "-")
	if slug == "" {
		return fallback
	}
	if len(slug) > maxSlugLen {
		slug = strings.Trim(slug[:maxSlugLen], "-")
	}
	return slug
}

// emptyBlock renders an empty machine block with begin/end markers on their own lines. A's setBlock
// requires the markers to pre-exist, so every scaffold lays them down.
func emptyBlock(name string) string {
	return "<!-- jarvis:begin " + name + " -->\n<!-- jarvis:end " + name + " -->\n"
}

// extractBlock returns the trimmed text between a block's begin/end markers, or "" if absent.
func extractBlock(body, name string) string {
	begin := "<!-- jarvis:begin " + name + " -->"
	end := "<!-- jarvis:end " + name + " -->"
	bi := strings.Index(body, begin)
	if bi < 0 {
		return ""
	}
	after := bi + len(begin)
	rel := strings.Index(body[after:], end)
	if rel < 0 {
		return ""
	}
	return strings.TrimSpace(body[after : after+rel])
}

func fmString(fm map[string]any, key string) string {
	if v, ok := fm[key]; ok {
		return strings.TrimSpace(fmt.Sprintf("%v", v))
	}
	return ""
}

func fmStrings(fm map[string]any, key string) []string {
	raw, ok := fm[key].([]any)
	if !ok {
		return nil
	}
	out := make([]string, 0, len(raw))
	for _, e := range raw {
		out = append(out, strings.TrimSpace(fmt.Sprintf("%v", e)))
	}
	return out
}

func fmInt(fm map[string]any, key string) int64 {
	switch v := fm[key].(type) {
	case int:
		return int64(v)
	case int64:
		return v
	case float64:
		return int64(v)
	case string:
		n, _ := strconv.ParseInt(strings.TrimSpace(v), 10, 64)
		return n
	}
	return 0
}

// parseLinks returns the [[targets]] found in s, in order.
func parseLinks(s string) []string {
	var out []string
	for _, m := range linkRe.FindAllStringSubmatch(s, -1) {
		if t := strings.TrimSpace(m[1]); t != "" {
			out = append(out, t)
		}
	}
	return out
}

// splitLines returns the non-empty lines of s, stripping a leading "- " list marker.
func splitLines(s string) []string {
	var out []string
	for _, ln := range strings.Split(s, "\n") {
		ln = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(ln), "- "))
		if ln != "" {
			out = append(out, ln)
		}
	}
	return out
}

// flowList renders a []string as a single-line YAML flow sequence, each element double-quoted.
// Single-line is mandatory — A splices frontmatter values one physical line at a time.
func flowList(items []string) string {
	if len(items) == 0 {
		return "[]"
	}
	qs := make([]string, len(items))
	for i, it := range items {
		qs[i] = strconv.Quote(it)
	}
	return "[" + strings.Join(qs, ", ") + "]"
}

// stripBlocks removes the named machine blocks (markers included) from body, leaving the human prose.
func stripBlocks(body string, names ...string) string {
	out := body
	for _, name := range names {
		begin := "<!-- jarvis:begin " + name + " -->"
		end := "<!-- jarvis:end " + name + " -->"
		for {
			bi := strings.Index(out, begin)
			if bi < 0 {
				break
			}
			rel := strings.Index(out[bi:], end)
			if rel < 0 {
				break
			}
			out = out[:bi] + out[bi+rel+len(end):]
		}
	}
	return out
}

// yamlScalar returns s as a bare scalar when safe, else double-quoted, so free-text values never
// break single-line frontmatter (a colon, hash, quote, or edge whitespace would).
func yamlScalar(s string) string {
	if s == "" {
		return `""`
	}
	if s != strings.TrimSpace(s) || strings.ContainsAny(s, ":#\"'{}[]&*!|>%@`\n") || strings.HasPrefix(s, "- ") {
		return strconv.Quote(s)
	}
	return s
}
