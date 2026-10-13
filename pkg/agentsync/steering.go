// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package agentsync projects the Wave Vault's canonical steering document and skills into every
// installed harness: a delimited region in each harness's home-level steering file, and one
// directory junction per skill in each harness's skills directory. One direction only — nothing is
// harvested back, and no harness's own enable/disable state is ever written.
// See docs/superpowers/specs/2026-09-07-harness-config-sync-design.md; its own-rules, memory and fold
// handling has since been removed.
package agentsync

import "strings"

const (
	steeringBegin = "<!-- ARC-STEERING:BEGIN (generated — do not edit; managed by Arc) -->"
	steeringEnd   = "<!-- ARC-STEERING:END -->"
)

// renderRegion wraps body in the markers. A body that carries markers of its own (a harness file copied
// into the shared doc, region and all) would nest a region that the next sync closes at its first end
// marker, leaving one more stray end marker in every harness file per sync, so its marker lines are dropped.
func renderRegion(body string) string {
	return steeringBegin + "\n" + strings.TrimRight(withoutMarkers(body), "\n") + "\n" + steeringEnd + "\n"
}

func withoutMarkers(body string) string {
	lines := strings.SplitAfter(body, "\n")
	kept := lines[:0]
	for _, line := range lines {
		if t := strings.TrimSpace(line); t == steeringBegin || t == steeringEnd {
			continue
		}
		kept = append(kept, line)
	}
	return strings.Join(kept, "")
}

// applyRegion returns existing with the ARC-STEERING region set to body. Content outside the markers
// is untouched, except stray end markers right after the region, which only a nested region leaves; a
// file with no region gets one appended.
func applyRegion(existing, body string) string {
	region := renderRegion(body)
	if start := strings.Index(existing, steeringBegin); start >= 0 {
		rest := existing[start:]
		if endIdx := strings.Index(rest, steeringEnd); endIdx >= 0 {
			tail := withoutStrayEnds(rest[endIdx+len(steeringEnd):])
			return existing[:start] + region + strings.TrimPrefix(tail, "\n")
		}
	}
	if strings.TrimSpace(existing) == "" {
		return region
	}
	return strings.TrimRight(existing, "\n") + "\n\n" + region
}

func withoutStrayEnds(tail string) string {
	for {
		next := strings.TrimLeft(tail, "\r\n")
		if !strings.HasPrefix(next, steeringEnd) {
			return tail
		}
		tail = next[len(steeringEnd):]
	}
}

// steeringState reports the harness's region against the shared doc: current when a re-render would
// change nothing, stale when it would, absent when there is no region to compare.
func steeringState(existing, shared string) string {
	if !strings.Contains(existing, steeringBegin) || strings.TrimSpace(shared) == "" {
		return "absent"
	}
	if applyRegion(existing, shared) == existing {
		return "current"
	}
	return "stale"
}
