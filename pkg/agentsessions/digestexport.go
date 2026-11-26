// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentsessions

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// DigestSession is one claude transcript as another package reads it: the file's own fields, and what its digest
// holds. ClaudeDigestCandidates fills the file's fields only; ReadDigestFor fills Session and Turns too.
type DigestSession struct {
	Path     string
	Stem     string
	Mtime    time.Time
	Size     int64
	Archived bool         // the transcript sits in the folder arcterm moved its runs' and temp folders' sessions to
	Session  *SessionInfo // as search shows it; nil from ClaudeDigestCandidates, and for a transcript that carries no session
	Turns    []Turn       // the prompts and replies Query.Match reads; nil from ClaudeDigestCandidates
}

// ClaudeDigestCandidates lists the claude transcripts of the last windowDays (all of them when windowDays is 0 or
// less), newest first, from claude's live folder and its archive. The walk is stat only: it reads no transcript and
// builds no digest.
func ClaudeDigestCandidates(windowDays int) []DigestSession {
	cands := collectCandidates(digestProviders(), "claude", "", windowDays)
	sort.Slice(cands, func(i, j int) bool { return candidateLess(cands[i], cands[j]) })
	out := make([]DigestSession, len(cands))
	for i, c := range cands {
		out[i] = DigestSession{Path: c.path, Stem: c.stem, Mtime: c.mtime, Size: c.size, Archived: c.p.archive}
	}
	return out
}

// ReadDigestFor is the digest of the claude transcript at path: the one on disk while it still stands for the
// transcript, else one built now and written, as a search does. A transcript that carries no session answers with a
// nil Session and no error; one that cannot be read, or that lies under no claude folder, is an error.
func ReadDigestFor(path string) (DigestSession, error) {
	c, err := claudeCandidateAt(filepath.Clean(path))
	if err != nil {
		return DigestSession{}, err
	}
	d, fresh := readDigest(c)
	if !fresh {
		if d, err = buildDigest(c); err != nil {
			return DigestSession{}, err
		}
	}
	out := DigestSession{Path: c.path, Stem: c.stem, Mtime: c.mtime, Size: c.size, Archived: c.p.archive}
	if d.Session != nil {
		se := sessionEvents{Events: d.Session.Events, Status: d.Session.Status, StartedTs: d.Session.StartedTs, DurationMs: d.Session.DurationMs}
		out.Session, out.Turns = asSession(c, parsed{info: d.Session, se: se}), d.Turns
	}
	return out, nil
}

// claudeCandidateAt is the candidate the walk would make of the transcript at path, found by stat: the claude
// provider whose folder holds it names its provider. The path stays as given, since the digest file is named by it.
func claudeCandidateAt(path string) (candidate, error) {
	for _, p := range digestProviders() {
		if p.runtime != "claude" || !isUnderDir(path, p.root) {
			continue
		}
		info, err := os.Stat(path)
		if err != nil {
			return candidate{}, fmt.Errorf("digest of %s: %w", path, err)
		}
		if info.IsDir() || !p.matches(info.Name()) {
			return candidate{}, fmt.Errorf("digest of %s: not a transcript", path)
		}
		stem := strings.TrimSuffix(strings.TrimSuffix(info.Name(), ".jsonl"), ".json") // as walkSince names it
		return candidate{path: path, stem: stem, mtime: info.ModTime(), size: info.Size(), p: p}, nil
	}
	return candidate{}, fmt.Errorf("digest of %s: not under a claude transcript folder", path)
}
