// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package claude holds the Claude Code mods arcterm ships. wsh embeds them straight from these folders and
// `wsh install-agent-hooks` writes them under ~/.arc, so this directory is their only source: there is no copy to
// keep in step, which a build once rewrote on every run whenever a commit changed a mod without its copy.
package claude

import (
	"embed"
	"path"
	"strings"
)

// FS holds every file of the shipped mods. go:embed cannot leave a file out, so their tests and fixtures are in it
// too, and Shipped decides what is installed.
//
//go:embed all:arc-mod all:arc-view-mod all:skim-mod
var FS embed.FS

// Shipped reports whether rel, a slash path inside one mod, is installed: everything but the tests, the test
// fixtures (testdata/) and the types the engine writes into .claude-plugin/types (gitignored, so only a dev
// checkout has them).
func Shipped(rel string) bool {
	if strings.HasPrefix(rel, "testdata/") || strings.HasPrefix(rel, ".claude-plugin/types/") {
		return false
	}
	return !strings.HasSuffix(path.Base(rel), ".test.ts")
}
