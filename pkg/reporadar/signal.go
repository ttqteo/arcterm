// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package reporadar

import (
	"crypto/sha256"
	"encoding/hex"
	"sort"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

// newSignal builds a canonical signal. The ID derives from (collector, sourceRef) — the canonical
// source+event identity — NOT from presentation, so the same commit surfaced many ways is one
// signal. The content hash derives from the semantic payload.
func newSignal(collector, sourceRef string, observedTs int64, paths []string, summary string, facts map[string]any, snippet string) waveobj.RadarSignal {
	sort.Strings(paths)
	id := shortHash(collector + "\x00" + sourceRef)
	content := strings.Join([]string{collector, sourceRef, strings.Join(paths, ","), summary, snippet}, "\x1f")
	return waveobj.RadarSignal{
		ID:          id,
		Collector:   collector,
		SourceRef:   sourceRef,
		ObservedTs:  observedTs,
		Paths:       paths,
		Subsystem:   subsystemForPaths(paths),
		Summary:     summary,
		Facts:       facts,
		Snippet:     snippet,
		ContentHash: shortHash(content),
	}
}

func shortHash(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])[:16]
}
