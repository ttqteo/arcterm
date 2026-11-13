// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package claude

import (
	"io/fs"
	"strings"
	"testing"
)

// the mods are embedded straight from these folders, so the tests and fixtures beside them are in the binary; only
// Shipped keeps them out of ~/.arc
func TestShippedLeavesOutTestsAndFixtures(t *testing.T) {
	for rel, want := range map[string]bool{
		"hooks/register.ts":               true,
		"hooks/wake-row.tsx":              true,
		".claude-plugin/plugin.json":      true,
		"types/index.d.ts":                true,
		"hooks/register.test.ts":          false,
		"testdata/wake.jsonl":             false,
		".claude-plugin/types/index.d.ts": false,
	} {
		if got := Shipped(rel); got != want {
			t.Errorf("Shipped(%q) = %v, want %v", rel, got, want)
		}
	}
}

func TestFSHoldsEveryModsManifestAndHooks(t *testing.T) {
	for _, mod := range []string{"arc-mod", "arc-view-mod", "skim-mod"} {
		for _, rel := range []string{".claude-plugin/plugin.json", "hooks/hooks.json", "hooks/register.ts"} {
			if _, err := fs.Stat(FS, mod+"/"+rel); err != nil {
				t.Errorf("%s/%s is not embedded: %v", mod, rel, err)
			}
		}
	}
}

// a node_modules folder inside a mod would be embedded whole into every wsh
func TestFSHoldsNoNodeModules(t *testing.T) {
	_ = fs.WalkDir(FS, ".", func(p string, d fs.DirEntry, err error) error {
		if err == nil && d.IsDir() && strings.HasSuffix(p, "node_modules") {
			t.Errorf("%s is embedded", p)
			return fs.SkipDir
		}
		return nil
	})
}
