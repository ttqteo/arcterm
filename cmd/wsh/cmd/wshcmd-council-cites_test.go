// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"path/filepath"
	"testing"
)

func TestCouncilCitesRoots(t *testing.T) {
	project := t.TempDir()
	doc := filepath.Join(project, "docs", "council", "2026-11-04-x.md")
	if got, err := councilCitesRoots(doc, nil); err != nil || len(got) != 1 || got[0] != project {
		t.Errorf("a saved report: %v, %v, want [%s]", got, err, project)
	}
	loose := filepath.Join(project, "notes", "x.md")
	if got, err := councilCitesRoots(loose, nil); err != nil || len(got) != 1 || got[0] != filepath.Dir(loose) {
		t.Errorf("a report elsewhere: %v, %v, want its folder", got, err)
	}
	other := t.TempDir()
	if got, err := councilCitesRoots(doc, []string{other, " ", project}); err != nil || len(got) != 2 || got[0] != other || got[1] != project {
		t.Errorf("--root: %v, %v, want [%s %s]", got, err, other, project)
	}
}
