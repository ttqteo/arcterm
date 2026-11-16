// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jarvis

import (
	"path"
	"regexp"
	"sort"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/gitinfo"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// A chunk not yet done is written against the code of its day. The stale scan measures it against what landed
// since: a file its text names that changed, or went away, is the sign it may no longer hold. Counting commits alone
// flags every chunk of a busy repo; a named file is specific enough to act on.

// StaleHistory is one project checkout's landed commits, newest first, back to FromMs, and the paths tracked at Head.
type StaleHistory struct {
	Head    string
	FromMs  int64
	Commits []gitinfo.LandedCommit
	byName  map[string][]string // base name -> tracked paths
}

// NewStaleHistory indexes a checkout's history for AssessChunk.
func NewStaleHistory(head string, fromMs int64, commits []gitinfo.LandedCommit, tracked []string) *StaleHistory {
	h := &StaleHistory{Head: head, FromMs: fromMs, Commits: commits, byName: map[string][]string{}}
	for _, p := range tracked {
		b := path.Base(p)
		h.byName[b] = append(h.byName[b], p)
	}
	return h
}

// fileMention is a path-like word ending in a source or doc extension: "councilstore.ts", "pkg/x/y.go".
var fileMention = regexp.MustCompile(`(?:[A-Za-z0-9_.\-]+/)*[A-Za-z0-9_.\-]*[A-Za-z0-9_\-]\.(?:tsx|ts|mjs|cjs|jsx|js|go|rs|css|scss|md|json|yml|yaml|sql|sh|ps1|py|toml|html|swift)\b`)

// hubFiles change in nearly every commit, so a chunk naming one ("add a CHANGELOG line") says nothing by it.
var hubFiles = map[string]bool{
	"CHANGELOG.md": true, "AGENTS.md": true, "CLAUDE.md": true, "DESIGN.md": true, "README.md": true,
	"package.json": true, "package-lock.json": true, "go.mod": true, "go.sum": true, "Taskfile.yml": true,
	"open-issues.md": true, "deferred.md": true, "hand-checks.md": true, "SKILL.md": true,
	"gotypes.d.ts": true, "wshclientapi.ts": true, "wshclient.go": true,
}

// FileMentions are the distinct file names texts mention, in first-seen order, hub files left out.
func FileMentions(texts ...string) []string {
	seen := map[string]bool{}
	var out []string
	for _, t := range texts {
		for _, m := range fileMention.FindAllString(t, -1) {
			m = strings.TrimLeft(m, "./")
			if m == "" || seen[m] || hubFiles[path.Base(m)] {
				continue
			}
			seen[m] = true
			out = append(out, m)
		}
	}
	// a bare name another mention spells out with its folder is the same file
	kept := out[:0]
	for _, m := range out {
		covered := false
		for _, o := range out {
			if o != m && strings.HasSuffix(o, "/"+m) {
				covered = true
				break
			}
		}
		if !covered {
			kept = append(kept, m)
		}
	}
	return kept
}

// mentionMatches reports whether repo path p is the file mention m names: the same path, or a path ending in it.
func mentionMatches(p, m string) bool {
	return p == m || strings.HasSuffix(p, "/"+m)
}

// ChunkIsOpen is a chunk the scan measures: not settled as done or skipped.
func ChunkIsOpen(c waveobj.EffortChunk) bool {
	return c.Status != "done" && c.Status != "skipped"
}

// ChunkBasesSinceMs is when chunks began to keep a BaseCommit (commit 781a25a06): add, rename and recheck stamp the
// project's HEAD from then on, and the chunks of an initiative created since are stamped at create.
const ChunkBasesSinceMs = int64(1794739320000)

// Trail notes that mark a chunk's text as written against the code at their time.
const (
	renamedNotePrefix = "renamed from "
	checkedNotePrefix = "checked against "
)

// ChunkWrittenTs is when a chunk's text was last written against the code (unix ms): the latest of its chunk-added
// event under its current label and its rename and recheck notes, else the initiative's creation (a chunk seeded at
// create has none of them). Never UpdatedTs: a note, a status change or a bulk edit moves it, and a chunk dated by
// it hides every change that landed before. The initiative's creation can only date a chunk too early, which flags
// it more often, never less.
func ChunkWrittenTs(e *waveobj.Effort, c waveobj.EffortChunk) int64 {
	var ts int64
	for _, ev := range e.Events {
		if ev.Kind == "chunk-added" && ev.Label == c.Label && ev.Ts > ts {
			ts = ev.Ts
		}
	}
	for _, n := range c.Notes {
		if (strings.HasPrefix(n.Text, renamedNotePrefix) || strings.HasPrefix(n.Text, checkedNotePrefix)) && n.Ts > ts {
			ts = n.Ts
		}
	}
	if ts > 0 {
		return ts
	}
	return e.CreatedTs
}

// BaseFromBackfill reports whether a chunk's BaseCommit can only have come from the backfill, which may have dated
// it by UpdatedTs before ChunkWrittenTs stopped reading it: nothing since ChunkBasesSinceMs stamped it (no add or
// rename since, no recheck ever, and its initiative was created before). Such a base is re-derived from
// ChunkWrittenTs.
func BaseFromBackfill(e *waveobj.Effort, c waveobj.EffortChunk) bool {
	if c.BaseCommit == "" || e.CreatedTs >= ChunkBasesSinceMs {
		return false
	}
	for _, ev := range e.Events {
		if ev.Kind == "chunk-added" && ev.Label == c.Label && ev.Ts >= ChunkBasesSinceMs {
			return false
		}
	}
	for _, n := range c.Notes {
		if strings.HasPrefix(n.Text, checkedNotePrefix) || (strings.HasPrefix(n.Text, renamedNotePrefix) && n.Ts >= ChunkBasesSinceMs) {
			return false
		}
	}
	return true
}

// landedSince is the commits that landed after the chunk was written (writtenTs, ChunkWrittenTs), and the base it was
// measured from. ok is false when the history cannot tell: the chunk's base is not in it, or the chunk is older than
// the history reaches.
func (h *StaleHistory) landedSince(c waveobj.EffortChunk, writtenTs int64) (since []gitinfo.LandedCommit, base string, inferred bool, ok bool) {
	if c.BaseCommit != "" {
		for i, lc := range h.Commits {
			if strings.HasPrefix(lc.SHA, c.BaseCommit) {
				return h.Commits[:i], lc.SHA, false, true
			}
		}
		return nil, c.BaseCommit, false, false
	}
	if writtenTs <= 0 || writtenTs < h.FromMs {
		return nil, "", true, false
	}
	n := 0
	for n < len(h.Commits) && h.Commits[n].Ts > writtenTs {
		n++
	}
	if n < len(h.Commits) {
		base = h.Commits[n].SHA
	}
	return h.Commits[:n], base, true, true
}

// InferredBase is the commit HEAD was at when a chunk with no BaseCommit was written (ChunkWrittenTs), "" when the history does
// not reach back that far.
func (h *StaleHistory) InferredBase(c waveobj.EffortChunk, writtenTs int64) string {
	if c.BaseCommit != "" {
		return c.BaseCommit
	}
	_, base, _, ok := h.landedSince(c, writtenTs)
	if !ok {
		return ""
	}
	return base
}

// AssessChunk measures one chunk: the files its label and notes name that changed or went away since it was written.
// ok is false when the history cannot place the chunk in time.
func (h *StaleHistory) AssessChunk(c waveobj.EffortChunk, writtenTs int64) (wshrpc.EffortChunkStale, bool) {
	since, base, inferred, ok := h.landedSince(c, writtenTs)
	out := wshrpc.EffortChunkStale{Chunk: c.Label, Base: base, Inferred: inferred, Landed: len(since)}
	if !ok {
		return out, false
	}
	texts := []string{c.Label}
	for _, n := range c.Notes {
		texts = append(texts, n.Text)
	}
	for _, m := range FileMentions(texts...) {
		if f, ok := h.assessFile(m, since); ok {
			out.Files = append(out.Files, f)
		}
	}
	// a file gone outranks a file changed
	sort.SliceStable(out.Files, func(i, j int) bool { return out.Files[i].Gone && !out.Files[j].Gone })
	return out, true
}

func (h *StaleHistory) assessFile(m string, since []gitinfo.LandedCommit) (wshrpc.EffortStaleFile, bool) {
	f := wshrpc.EffortStaleFile{Mention: m}
	for _, p := range h.byName[path.Base(m)] {
		if mentionMatches(p, m) {
			f.Path = p
			break
		}
	}
	deleted := ""
	for _, lc := range since {
		touched := false
		for _, lf := range lc.Files {
			now, was := mentionMatches(lf.Path, m), lf.From != "" && mentionMatches(lf.From, m)
			if !now && !was {
				continue
			}
			touched = true
			switch {
			case lf.Status == 'D' && now && deleted == "" && f.RenamedTo == "":
				deleted = lf.Path
			case lf.Status == 'R' && was && !now && deleted == "" && f.RenamedTo == "":
				f.RenamedTo = lf.Path
				deleted = lf.From
			}
		}
		if touched {
			f.Changes++
		}
	}
	if f.Path == "" {
		if deleted == "" {
			// never tracked here, or gone before the chunk was written: nothing to say
			return f, false
		}
		f.Path, f.Gone = deleted, true
		return f, true
	}
	f.RenamedTo = ""
	return f, f.Changes > 0
}
