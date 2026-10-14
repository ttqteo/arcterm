// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jarvisvolunteer

import (
	"context"
	"fmt"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/memhygiene"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// MemoryHygieneProducer reports a project whose memory check left changes to review. The function
// field is the seam for tests.
type MemoryHygieneProducer struct {
	listProjects func() ([]wshrpc.MemHygieneProject, error)
}

func NewMemoryHygieneProducer() *MemoryHygieneProducer {
	return &MemoryHygieneProducer{listProjects: memhygiene.ListProjects}
}

func (p *MemoryHygieneProducer) Name() string { return ClassMemoryHygiene }

func (p *MemoryHygieneProducer) Candidates(_ context.Context, _ *Trigger) ([]Candidate, error) {
	projects, err := p.listProjects()
	if err != nil {
		return nil, fmt.Errorf("jarvisvolunteer: listing memory hygiene projects: %w", err)
	}
	var out []Candidate
	for _, proj := range projects {
		n := pendingChanges(proj.Changes)
		// a CheckedAt of 0 has no fact to stamp from; the gate's prefilter would drop it anyway
		if n == 0 || proj.CheckedAt == 0 {
			continue
		}
		noun := "changes"
		if n == 1 {
			noun = "change"
		}
		out = append(out, Candidate{
			Class: ClassMemoryHygiene,
			// stamped from the check, so an unchanged result re-emits the same pair and dies at the watermark
			ID:         fmt.Sprintf("memory-hygiene:%s:%d", proj.Project, proj.CheckedAt),
			At:         proj.CheckedAt,
			Title:      fmt.Sprintf("%s's memory has %d %s to review", proj.Project, n, noun),
			Snippet:    hygieneSnippet(proj),
			SourceType: "memhygiene",
			SourceRef:  "memhygiene:" + proj.Project,
		})
	}
	return out, nil
}

// hygieneSnippet gives the judge what the title can't: what kind of changes wait, and how close the
// index is to the lines Claude Code loads. "2 move here, 1 copy here · MEMORY.md at 6 of 200 lines"
func hygieneSnippet(proj wshrpc.MemHygieneProject) string {
	var kinds []string
	count := map[string]int{}
	for _, c := range proj.Changes {
		if !memhygiene.Pending(c) {
			continue
		}
		if count[c.Kind] == 0 {
			kinds = append(kinds, c.Kind)
		}
		count[c.Kind]++
	}
	parts := make([]string, len(kinds))
	for i, k := range kinds {
		parts[i] = fmt.Sprintf("%d %s", count[k], strings.ReplaceAll(k, "-", " "))
	}
	return fmt.Sprintf("%s · MEMORY.md at %d of %d lines", strings.Join(parts, ", "), proj.Index.Lines, memhygiene.LimitLines)
}

func pendingChanges(changes []wshrpc.MemChange) int {
	n := 0
	for _, c := range changes {
		if memhygiene.Pending(c) {
			n++
		}
	}
	return n
}
