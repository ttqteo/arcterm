// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package sessionideas

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"log"
	"os"
	"strings"
	"sync"

	"github.com/wavetermdev/waveterm/pkg/agentobserve"
	"github.com/wavetermdev/waveterm/pkg/agentsessions"
	"github.com/wavetermdev/waveterm/pkg/brainstormcheck"
)

// A machine session is a transcript arcterm's own machinery left in a project's folder, one no person typed into: a
// print-mode pass (council seats, routing, the board drawer: entrypoint sdk-*), an engine session that has not gone to
// the archive yet (entrypoint bench), or one of the two sessions Arc runs on a brainstorm (the builder check and the
// judge, which run as claude in a tab and record "cli", so only their first prompt tells them). Ideas are never floated
// in one, so a scan does not read it and the session list does not count it: on 2026-11-27 they were about a third of
// the transcripts on disk.

const (
	// originMaxLines and originMaxBytes bound the read of a transcript's head: the entrypoint is on its first record and
	// the first prompt within a few lines, but a line that pastes an image runs to megabytes.
	originMaxLines = 200
	originMaxBytes = 8 << 20
	// originMaxParse is the longest line decoded: a longer one is an image or a tool's output, never a typed prompt
	// (a brainstorm check's prompt is a few KB), and the shorter records around it carry the entrypoint too.
	originMaxParse = 256 << 10
)

// machineEntrypoint says an entrypoint alone marks a machine session: a print-mode pass or an engine session.
func machineEntrypoint(entrypoint string) bool {
	return strings.HasPrefix(entrypoint, "sdk-") || agentobserve.IsHeadlessEntrypoint(entrypoint) ||
		entrypoint == agentobserve.EngineEntrypoint
}

// IsMachine says whether a transcript with this entrypoint (the first one its records carry, "" when none does) and
// this first prompt of a person's (the first user text that is not a tag Claude Code writes) is a machine session.
func IsMachine(entrypoint, firstPrompt string) bool {
	if machineEntrypoint(entrypoint) {
		return true
	}
	p := strings.TrimSpace(firstPrompt)
	for _, o := range brainstormcheck.Openings() {
		if o != "" && strings.HasPrefix(p, o) {
			return true
		}
	}
	return false
}

// originLine is the part of a transcript record readOrigin looks at.
type originLine struct {
	Type       string `json:"type"`
	IsMeta     bool   `json:"isMeta"`
	Entrypoint string `json:"entrypoint"`
	Cwd        string `json:"cwd"`
	Message    struct {
		Content json.RawMessage `json:"content"`
	} `json:"message"`
}

// origin is what a transcript's head says: the first entrypoint its records carry, its first prompt of a person's, and
// the first cwd (the folder the session was started in, which names its project).
type origin struct {
	entrypoint, firstPrompt, cwd string
}

// readOrigin reads a transcript's head for its origin. It stops once it has all three, once the entrypoint alone marks
// a machine session, or at the bounds.
func readOrigin(r io.Reader) (origin, error) {
	var o origin
	br := bufio.NewReader(r)
	read := 0
	for n := 0; n < originMaxLines && read < originMaxBytes; n++ {
		line, rerr := br.ReadBytes('\n')
		read += len(line)
		if len(line) <= originMaxParse && len(bytes.TrimSpace(line)) > 0 {
			var rec originLine
			if json.Unmarshal(line, &rec) == nil {
				if o.entrypoint == "" {
					o.entrypoint = rec.Entrypoint
				}
				if o.cwd == "" {
					o.cwd = rec.Cwd
				}
				if o.firstPrompt == "" && rec.Type == "user" && !rec.IsMeta {
					o.firstPrompt = promptText(rec.Message.Content)
				}
			}
		}
		if (o.entrypoint != "" && o.firstPrompt != "" && o.cwd != "") || machineEntrypoint(o.entrypoint) {
			return o, nil
		}
		if rerr != nil {
			if errors.Is(rerr, io.EOF) {
				return o, nil
			}
			return o, rerr
		}
	}
	return o, nil
}

// promptText is a user record's text when a person could have typed it: a plain string, or the text blocks of a list,
// and "" for a tool result or a tag Claude Code writes (a slash command, its output, a reminder).
func promptText(raw json.RawMessage) string {
	var text string
	var s string
	if json.Unmarshal(raw, &s) == nil {
		text = s
	} else {
		var blocks []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		}
		if json.Unmarshal(raw, &blocks) != nil {
			return ""
		}
		var parts []string
		for _, b := range blocks {
			if b.Type == "text" {
				parts = append(parts, b.Text)
			}
		}
		text = strings.Join(parts, " ")
	}
	text = strings.TrimSpace(text)
	if strings.HasPrefix(text, "<") {
		return ""
	}
	return text
}

// originEntry is what the cache holds of one transcript: the file as it was read, and what it was.
type originEntry struct {
	size    int64
	mtimeMs int64
	machine bool
	cwd     string
}

// origins caches what a transcript's head says, so the session list (read on every Brief refresh) and Storage's count
// (one ask per session) read a transcript's head once until the file changes.
var origins = struct {
	sync.Mutex
	m map[string]originEntry
}{m: map[string]originEntry{}}

// transcriptOrigin is what the head of the transcript at path says, as it stands at size and mtimeMs. A transcript that
// cannot be read is a person's: one left out by mistake would never be offered, one kept by mistake costs one call.
func transcriptOrigin(path string, size, mtimeMs int64) originEntry {
	origins.Lock()
	e, ok := origins.m[path]
	origins.Unlock()
	if ok && e.size == size && e.mtimeMs == mtimeMs {
		return e
	}
	e = originEntry{size: size, mtimeMs: mtimeMs}
	if f, err := os.Open(path); err != nil {
		log.Printf("sessionideas: reading the head of %s: %v; counted as a person's session", path, err)
	} else {
		o, rerr := readOrigin(f)
		f.Close()
		if rerr != nil {
			log.Printf("sessionideas: reading the head of %s: %v; judged on what was read", path, rerr)
		}
		e.machine, e.cwd = IsMachine(o.entrypoint, o.firstPrompt), o.cwd
	}
	origins.Lock()
	origins.m[path] = e
	origins.Unlock()
	return e
}

// IsMachineTranscript is IsMachine for the transcript at path, as it stands at size and mtimeMs.
func IsMachineTranscript(path string, size, mtimeMs int64) bool {
	return transcriptOrigin(path, size, mtimeMs).machine
}

// PersonSessions is the candidates without the machine sessions, each with the cwd its head names. An archived
// candidate is kept as it is: the scan and the list leave it out on their own, and its head is never read.
func PersonSessions(cands []agentsessions.DigestSession) []agentsessions.DigestSession {
	out := make([]agentsessions.DigestSession, 0, len(cands))
	for _, c := range cands {
		if !c.Archived {
			e := transcriptOrigin(c.Path, c.Size, c.Mtime.UnixMilli())
			if e.machine {
				continue
			}
			c.Cwd = e.cwd
		}
		out = append(out, c)
	}
	return out
}
