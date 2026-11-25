// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentsessions

import (
	"errors"
	"io/fs"
	"log"

	"github.com/wavetermdev/waveterm/pkg/pisession"
)

// TokensSince is what a claude or pi session's transcript at path bills for the requests it records at sinceMs
// (UnixMilli) or later: Input + CacheRead + CacheCreation + Output, the sum council run facts count
// (pkg/consult/consult.go). It reads the transcript once and caches nothing. The transcript is the session's own: a
// Claude Task subagent's transcripts under <session>/subagents are not counted. A record with no readable time
// counts as time 0, so it is in only when sinceMs is 0. Any other harness, a missing file or an unreadable one gives 0;
// an unreadable one is logged.
func TokensSince(path, harness string, sinceMs int64) int64 {
	switch harness {
	case "claude":
		lines, err := readLines(path)
		if err != nil {
			log.Printf("agentsessions: counting the tokens of %q: %v", path, err)
			return 0
		}
		var recs []claudeLine
		for _, rec := range parseClaudeLines(lines) {
			if parseTs(rec.Timestamp) >= sinceMs {
				recs = append(recs, rec)
			}
		}
		return int64(claudeTokens(recs)) // the dedupe of the session's total: one count per message and request
	case "pi":
		file, err := pisession.Read(path)
		if errors.Is(err, fs.ErrNotExist) {
			return 0
		}
		if err != nil {
			log.Printf("agentsessions: counting the tokens of %q: %v", path, err)
			return 0
		}
		return piTokensSince(file, sinceMs)
	}
	return 0
}

// piTokensSince sums every entry that carries billed usage, an abandoned branch's too (usagestats bills those: the
// tokens were spent). Output already holds its reasoning subset, and a cache write its 1h subset, so neither is added
// again.
func piTokensSince(file *pisession.File, sinceMs int64) int64 {
	var total int64
	for _, e := range file.Entries {
		if e.Usage == nil || parseTs(e.Timestamp) < sinceMs {
			continue
		}
		u := e.Usage
		total += int64(u.Input + u.CacheRead + u.CacheWrite + u.Output)
	}
	return total
}
