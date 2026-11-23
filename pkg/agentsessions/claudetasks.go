// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentsessions

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
)

// ClaudeTempRoot is the folder Claude Code makes its temp dir in: CLAUDE_CODE_TMPDIR, else the OS temp dir.
func ClaudeTempRoot() string {
	if d := os.Getenv("CLAUDE_CODE_TMPDIR"); d != "" {
		return d
	}
	return os.TempDir()
}

// claudeTempProjectDir is the folder name Claude Code gives a project under its temp dir: the first 16 hex digits of
// the sha256 of the project's transcript folder name, lowercased (read from Claude Code 2.x, 2026-11-23).
func claudeTempProjectDir(project string) string {
	sum := sha256.Sum256([]byte(strings.ToLower(project)))
	return hex.EncodeToString(sum[:])[:16]
}

// ClaudeTasksDir is where Claude Code writes the output of a session's background tasks and Monitors
// (<root>/claude/<project>/<session>/tasks), for a transcript at <projects>/<project>/<session>.jsonl, or "" when no
// such folder exists. The project folder is the hashed name, or, before Claude Code shortened its temp dirs, the
// project's own name. A Monitor's start result names no output file, so this is the only way to find it while it runs.
func ClaudeTasksDir(transcriptPath, root string) string {
	if root == "" || !strings.HasSuffix(transcriptPath, ".jsonl") {
		return ""
	}
	session := strings.TrimSuffix(filepath.Base(transcriptPath), ".jsonl")
	project := filepath.Base(filepath.Dir(transcriptPath))
	if session == "" || project == "." || project == string(filepath.Separator) {
		return ""
	}
	for _, name := range []string{claudeTempProjectDir(project), project} {
		dir := filepath.Join(root, "claude", name, session, "tasks")
		if fi, err := os.Stat(dir); err == nil && fi.IsDir() {
			return dir
		}
	}
	return ""
}
