// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jarvisvolunteer

import (
	"context"
	"fmt"

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
			SourceType: "memhygiene",
			SourceRef:  "memhygiene:" + proj.Project,
		})
	}
	return out, nil
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
