// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentsessions

import (
	"bytes"
	"encoding/json"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

// The sessions that made a canvas, for Agent → Canvases' viewer to offer the last one back: a claude or pi session
// that wrote or edited a file under <project>/.superpowers/design/<topic>/, or revealed the canvas from its project
// (`wsh ui reveal canvas:<topic>`, which design-local runs after every round, so a session that drew its boards with a
// script counts too). Which agent has a canvas open lives only in memory, so the transcripts are the one record of who
// drew it. A Read, or any other shell command naming the folder, is not making it.

// CanvasSession is a session that wrote into a canvas, and when it last did.
type CanvasSession struct {
	SessionInfo
	WroteTs int64 // unix ms of its last write under the topic folder
}

// a transcript is appended a moment after the file its tool call wrote
const canvasSinceSlack = time.Minute

// the transcripts that record a tool call's file path: codex, opencode and agy write through tools this does not read
var canvasRuntimes = map[string]bool{"claude": true, "pi": true}

var canvasWriteTools = map[string]bool{"write": true, "edit": true, "multiedit": true, "notebookedit": true}

// the topic of a reveal in a shell command; its name is a canvas segment (storage's canvasSegmentRe)
var canvasRevealRe = regexp.MustCompile(`\bui\s+reveal\s+canvas:([A-Za-z0-9][A-Za-z0-9._-]*)`)

// CanvasSessions lists the sessions that wrote into the canvas at topicDir, the latest writer first, or nil when
// topicDir is not a topic folder. Only transcripts touched since the canvas's oldest file are read: an older one cannot
// hold a write that is still there.
func CanvasSessions(topicDir string) []CanvasSession {
	topicDir = filepath.Clean(topicDir)
	if got, ok := designTopicOf(filepath.Join(topicDir, "x")); !ok || pathKey(got) != pathKey(topicDir) {
		return nil
	}
	since := oldestFileTime(topicDir)
	if !since.IsZero() {
		since = since.Add(-canvasSinceSlack)
	}
	var providers []provider
	for _, p := range allProviders() {
		if canvasRuntimes[p.runtime] {
			providers = append(providers, p)
		}
	}
	return canvasSessions(providers, topicDir, since)
}

func canvasSessions(providers []provider, topicDir string, since time.Time) []CanvasSession {
	want := pathKey(topicDir)
	var out []CanvasSession
	for _, p := range providers {
		if p.beginScan != nil {
			p.beginScan()
		}
		for _, c := range walkSince(p, since) {
			ts, ok := designWritesCached(c)[want]
			if !ok {
				continue
			}
			info, se := scanSessionCached(c)
			s := asSession(c, parsed{info: info, se: se})
			if s == nil {
				continue
			}
			if ts == 0 {
				ts = c.mtime.UnixMilli()
			}
			out = append(out, CanvasSession{SessionInfo: *s, WroteTs: ts})
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].WroteTs > out[j].WroteTs })
	return out
}

// designTopicOf is the topic folder a file under <project>/.superpowers/design/<topic>/ sits in. The topic folder
// itself is not under it.
func designTopicOf(path string) (string, bool) {
	sep := string(filepath.Separator)
	parts := strings.Split(filepath.Clean(path), sep)
	for i := 0; i+3 < len(parts); i++ {
		if parts[i] == ".superpowers" && parts[i+1] == "design" && parts[i+2] != "" {
			return strings.Join(parts[:i+3], sep), true
		}
	}
	return "", false
}

func oldestFileTime(dir string) time.Time {
	var oldest time.Time
	_ = filepath.WalkDir(dir, func(_ string, d fs.DirEntry, err error) error {
		if err != nil || !d.Type().IsRegular() {
			return nil
		}
		if info, err := d.Info(); err == nil && (oldest.IsZero() || info.ModTime().Before(oldest)) {
			oldest = info.ModTime()
		}
		return nil
	})
	return oldest
}

type designWritesEntry struct {
	mtime  time.Time
	size   int64
	writes map[string]int64
}

var (
	designWritesMu    sync.Mutex
	designWritesCache = map[string]designWritesEntry{}
)

// designWritesCached is designWrites over a candidate's file, read again only when it has changed: transcripts only
// grow, and a viewer opened twice should not read them all twice.
func designWritesCached(c candidate) map[string]int64 {
	designWritesMu.Lock()
	e, ok := designWritesCache[c.path]
	designWritesMu.Unlock()
	if ok && e.mtime.Equal(c.mtime) && e.size == c.size {
		return e.writes
	}
	data, err := os.ReadFile(c.path)
	if err != nil {
		return nil
	}
	writes := designWrites(data)
	designWritesMu.Lock()
	if len(designWritesCache) >= scanCacheMax {
		clear(designWritesCache)
	}
	designWritesCache[c.path] = designWritesEntry{mtime: c.mtime, size: c.size, writes: writes}
	designWritesMu.Unlock()
	return writes
}

type designWriteLine struct {
	Type      string `json:"type"`
	Cwd       string `json:"cwd"`
	Timestamp string `json:"timestamp"`
	Message   struct {
		Content json.RawMessage `json:"content"`
	} `json:"message"`
}

// a claude tool_use block (input) or a pi toolCall block (arguments)
type designWriteBlock struct {
	Type  string `json:"type"`
	Name  string `json:"name"`
	Input struct {
		FilePath     string `json:"file_path"`
		NotebookPath string `json:"notebook_path"`
		Command      string `json:"command"`
	} `json:"input"`
	Arguments struct {
		Path    string `json:"path"`
		Command string `json:"command"`
	} `json:"arguments"`
}

var designNeedles = [][]byte{[]byte("superpowers"), []byte("canvas:")}

func namesDesign(b []byte) bool {
	for _, n := range designNeedles {
		if bytes.Contains(b, n) {
			return true
		}
	}
	return false
}

// designWrites maps each design topic folder a transcript wrote into or revealed (by pathKey) to the last time it did,
// unix ms (0 when the record carries none). Only the lines naming a design folder or a canvas are parsed, and the
// first, which is pi's header: it holds the cwd a pi tool call's relative path is against; a claude record carries its
// own.
func designWrites(data []byte) map[string]int64 {
	out := map[string]int64{}
	if !namesDesign(data) {
		return out
	}
	headerCwd := ""
	for i, raw := range bytes.Split(data, []byte("\n")) {
		if i > 0 && !namesDesign(raw) {
			continue
		}
		var rec designWriteLine
		if json.Unmarshal(raw, &rec) != nil {
			continue
		}
		if i == 0 && rec.Type == "session" {
			headerCwd = rec.Cwd
		}
		var blocks []designWriteBlock
		if len(rec.Message.Content) == 0 || json.Unmarshal(rec.Message.Content, &blocks) != nil {
			continue
		}
		cwd := rec.Cwd
		if cwd == "" {
			cwd = headerCwd
		}
		ts := parseTs(rec.Timestamp)
		note := func(topic string) {
			key := pathKey(topic)
			if ts >= out[key] {
				out[key] = ts
			}
		}
		for _, b := range blocks {
			if b.Type != "tool_use" && b.Type != "toolCall" {
				continue
			}
			if strings.EqualFold(b.Name, "bash") {
				if cwd == "" {
					continue
				}
				for _, m := range canvasRevealRe.FindAllStringSubmatch(firstNonEmpty(b.Input.Command, b.Arguments.Command), -1) {
					if !strings.Contains(m[1], "..") {
						note(filepath.Join(cwd, ".superpowers", "design", m[1]))
					}
				}
				continue
			}
			if !canvasWriteTools[strings.ToLower(b.Name)] {
				continue
			}
			path := firstNonEmpty(b.Input.FilePath, b.Input.NotebookPath, b.Arguments.Path)
			if path == "" {
				continue
			}
			if !filepath.IsAbs(path) {
				if cwd == "" {
					continue
				}
				path = filepath.Join(cwd, path)
			}
			if topic, ok := designTopicOf(path); ok {
				note(topic)
			}
		}
	}
	return out
}

func firstNonEmpty(ss ...string) string {
	for _, s := range ss {
		if s != "" {
			return s
		}
	}
	return ""
}
