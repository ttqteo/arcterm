// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jarvis

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/util/fileutil"
)

// Claude Code gates a directory it has never been run in behind an interactive folder-trust prompt
// ("Is this a project you created or one you trust?"). --dangerously-skip-permissions does not cover
// it — that flag is about tool permissions — so a headless run worker launched into an untrusted
// directory parks on the prompt forever: alive, waiting on stdin, which looks healthy to the engine
// and reports nothing.
//
// Claude Code's own diagnostics name the non-interactive remedy: "accept the trust dialog here once
// interactively, or set projects[<dir>].hasTrustDialogAccepted in <config>". This registers that
// entry before the worker starts, under the same lock Claude Code takes on the file.
//
// Getting the key right is the whole game, because Claude Code does not key a project by the cwd. It
// keys by the cwd's *canonical git root*, and canonicalization resolves a linked worktree back to its
// main repository. A run worktree therefore shares its project's entry and needs none of its own —
// which is why this writes at most one entry per project and never one per worktree.

const (
	claudeProjectsKey = "projects"
	claudeTrustField  = "hasTrustDialogAccepted"

	// proper-lockfile's default staleness threshold, which Claude Code takes as-is: a holder
	// refreshes the lock's mtime every 5s, so an older one belongs to a process that died.
	claudeLockStale   = 10 * time.Second
	claudeLockTimeout = 3 * time.Second
	claudeLockPoll    = 50 * time.Millisecond
)

// claudeConfigPath resolves the user config file Claude Code reads. Package var so tests never touch
// the real one.
var claudeConfigPath = defaultClaudeConfigPath

func defaultClaudeConfigPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("resolving home dir: %w", err)
	}
	// mirrors Claude Code's own resolution: <config dir>/.config.json wins when it exists, else
	// .claude.json under CLAUDE_CONFIG_DIR or the home dir.
	override := os.Getenv("CLAUDE_CONFIG_DIR")
	configDir := override
	if configDir == "" {
		configDir = filepath.Join(home, ".claude")
	}
	if alt := filepath.Join(configDir, ".config.json"); fileExists(alt) {
		return alt, nil
	}
	if override != "" {
		return filepath.Join(override, ".claude.json"), nil
	}
	return filepath.Join(home, ".claude.json"), nil
}

func fileExists(path string) bool {
	st, err := os.Stat(path)
	return err == nil && !st.IsDir()
}

// claudeTrustTarget is one directory resolved against Claude Code's trust rules: the config key it
// would read and write, plus the ancestor chain whose entries also confer trust.
type claudeTrustTarget struct {
	Key       string
	Ancestors []string
}

// normalizeClaudePath renders a path the way Claude Code keys it: absolute, symlinks resolved,
// forward slashes even on Windows.
func normalizeClaudePath(path string) string {
	abs, err := filepath.Abs(path)
	if err != nil {
		abs = filepath.Clean(path)
	}
	if real, err := filepath.EvalSymlinks(abs); err == nil {
		abs = real
	}
	return filepath.ToSlash(abs)
}

// claudeGitRoot walks up from dir for a `.git` entry, matching Claude Code's own finder: a `.git`
// *file* counts as much as a directory, so a linked worktree is its own git root. Returns "" when
// there is no repository above dir.
func claudeGitRoot(dir string) string {
	cur, err := filepath.Abs(dir)
	if err != nil {
		return ""
	}
	for {
		if _, err := os.Lstat(filepath.Join(cur, ".git")); err == nil {
			return cur
		}
		parent := filepath.Dir(cur)
		if parent == cur {
			return ""
		}
		cur = parent
	}
}

// MainCheckout is the main checkout of the repository holding dir: projects are registered there, so a
// session in a linked worktree or a subfolder still belongs to its project. Outside a repository it is dir.
func MainCheckout(dir string) string {
	if dir == "" {
		return ""
	}
	root := claudeGitRoot(dir)
	if root == "" {
		return dir
	}
	return claudeCanonicalRoot(root)
}

// claudeCanonicalRoot resolves a linked worktree's git root back to its main repository, the way
// Claude Code canonicalizes a root before using it as a config key. A worktree's `.git` is a file
// pointing at <main>/.git/worktrees/<name>; the commondir and gitdir back-reference are verified
// exactly as Claude verifies them, and any mismatch falls back to root unchanged.
func claudeCanonicalRoot(root string) string {
	gitDir, ok := readGitDirPointer(root)
	if !ok {
		return root
	}
	commonDir, ok := resolveRelativeTo(gitDir, filepath.Join(gitDir, "commondir"))
	if !ok {
		return root
	}
	if filepath.Clean(filepath.Dir(gitDir)) != filepath.Join(commonDir, "worktrees") {
		return root
	}
	back, ok := resolveRelativeTo(gitDir, filepath.Join(gitDir, "gitdir"))
	if !ok || !strings.EqualFold(back, filepath.Join(root, ".git")) {
		return root
	}
	if filepath.Base(commonDir) != ".git" {
		return commonDir
	}
	return filepath.Dir(commonDir)
}

// readGitDirPointer reads a linked worktree's `.git` file and returns the admin dir it points at.
// A real repository's `.git` is a directory, so the read fails and ok is false.
func readGitDirPointer(root string) (string, bool) {
	data, err := os.ReadFile(filepath.Join(root, ".git"))
	if err != nil {
		return "", false
	}
	rest, found := strings.CutPrefix(strings.TrimSpace(string(data)), "gitdir:")
	if !found {
		return "", false
	}
	return resolveAgainst(root, strings.TrimSpace(rest))
}

// resolveRelativeTo reads a git pointer file and resolves its contents against base.
func resolveRelativeTo(base, file string) (string, bool) {
	data, err := os.ReadFile(file)
	if err != nil {
		return "", false
	}
	return resolveAgainst(base, strings.TrimSpace(string(data)))
}

func resolveAgainst(base, path string) (string, bool) {
	if path == "" {
		return "", false
	}
	if !filepath.IsAbs(path) {
		path = filepath.Join(base, path)
	}
	return filepath.Clean(path), true
}

// resolveClaudeTrust works out which config entries govern dir. The key is dir's canonical git root
// (dir itself when it is not in a repository); the ancestor chain is dir up to and including its git
// root, or up to the filesystem root when there is none — the fallback walk Claude Code performs when
// the key itself carries no entry.
func resolveClaudeTrust(dir string) claudeTrustTarget {
	abs, err := filepath.Abs(dir)
	if err != nil {
		abs = filepath.Clean(dir)
	}
	root := claudeGitRoot(abs)
	key := abs
	if root != "" {
		key = claudeCanonicalRoot(root)
	}
	target := claudeTrustTarget{Key: normalizeClaudePath(key)}
	boundary := normalizeClaudePath(root)
	for cur := abs; ; {
		norm := normalizeClaudePath(cur)
		target.Ancestors = append(target.Ancestors, norm)
		if root != "" && norm == boundary {
			break
		}
		parent := filepath.Dir(cur)
		if parent == cur {
			break
		}
		cur = parent
	}
	return target
}

// newClaudeProjectEntry mirrors the default entry Claude Code writes for a new project. The full
// shape matters: Claude reads an entry as `projects[key] ?? defaults` — the whole entry or the whole
// default, never field-by-field — so a partial entry leaves its siblings undefined.
func newClaudeProjectEntry() map[string]json.RawMessage {
	return map[string]json.RawMessage{
		"allowedTools":                            json.RawMessage(`[]`),
		"mcpContextUris":                          json.RawMessage(`[]`),
		"mcpServers":                              json.RawMessage(`{}`),
		"enabledMcpjsonServers":                   json.RawMessage(`[]`),
		"disabledMcpjsonServers":                  json.RawMessage(`[]`),
		"hasClaudeMdExternalIncludesApproved":     json.RawMessage(`false`),
		"hasClaudeMdExternalIncludesWarningShown": json.RawMessage(`false`),
	}
}

// applyClaudeTrust marks target trusted in a Claude Code config document, returning the new document
// and whether anything changed. Nothing is written when the key or any ancestor already confers
// trust. Everything this does not own round-trips as raw JSON, so unknown fields — auth, telemetry,
// other projects — survive untouched. Empty input yields a minimal valid config; malformed input is
// an error, never a clobber.
func applyClaudeTrust(cfg []byte, target claudeTrustTarget) ([]byte, bool, error) {
	root := map[string]json.RawMessage{}
	if err := unmarshalObject(cfg, &root); err != nil {
		return nil, false, fmt.Errorf("parsing claude config: %w", err)
	}
	projects := map[string]json.RawMessage{}
	if err := unmarshalObject(root[claudeProjectsKey], &projects); err != nil {
		return nil, false, fmt.Errorf("parsing claude config projects: %w", err)
	}
	for _, path := range append([]string{target.Key}, target.Ancestors...) {
		trusted, err := entryIsTrusted(projects, path)
		if err != nil {
			return nil, false, err
		}
		if trusted {
			return cfg, false, nil
		}
	}
	entry := newClaudeProjectEntry()
	if raw, ok := projects[target.Key]; ok {
		existing := map[string]json.RawMessage{}
		if err := unmarshalObject(raw, &existing); err != nil {
			return nil, false, fmt.Errorf("parsing claude config entry for %q: %w", target.Key, err)
		}
		entry = existing
	}
	entry[claudeTrustField] = json.RawMessage(`true`)

	entryJSON, err := json.Marshal(entry)
	if err != nil {
		return nil, false, err
	}
	projects[target.Key] = entryJSON
	projectsJSON, err := json.Marshal(projects)
	if err != nil {
		return nil, false, err
	}
	root[claudeProjectsKey] = projectsJSON
	// 2-space indent matches how Claude Code writes the file; key order is not preserved, which JSON
	// does not care about and Claude Code re-derives on its next write anyway.
	out, err := json.MarshalIndent(root, "", "  ")
	if err != nil {
		return nil, false, err
	}
	return out, true, nil
}

func entryIsTrusted(projects map[string]json.RawMessage, path string) (bool, error) {
	raw, ok := projects[path]
	if !ok {
		return false, nil
	}
	entry := map[string]json.RawMessage{}
	if err := unmarshalObject(raw, &entry); err != nil {
		return false, fmt.Errorf("parsing claude config entry for %q: %w", path, err)
	}
	var trusted bool
	if v, ok := entry[claudeTrustField]; ok && json.Unmarshal(v, &trusted) == nil {
		return trusted, nil
	}
	return false, nil
}

// unmarshalObject decodes a JSON object, treating absent/blank/null as an empty object.
func unmarshalObject(raw []byte, into *map[string]json.RawMessage) error {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
		return nil
	}
	return json.Unmarshal(trimmed, into)
}

// lockClaudeConfig takes the lock Claude Code takes on its own config: proper-lockfile's protocol,
// where the lock is a directory beside the file whose mtime the holder refreshes while it works.
func lockClaudeConfig(path string) (func(), error) {
	lock := path + ".lock"
	deadline := time.Now().Add(claudeLockTimeout)
	for {
		if err := os.Mkdir(lock, 0o700); err == nil {
			return func() { os.Remove(lock) }, nil
		} else if !errors.Is(err, fs.ErrExist) {
			return nil, err
		}
		if time.Now().After(deadline) {
			return nil, fmt.Errorf("config lock %s is held by another process", lock)
		}
		if st, err := os.Stat(lock); err == nil && time.Since(st.ModTime()) > claudeLockStale {
			os.Remove(lock)
		}
		time.Sleep(claudeLockPoll)
	}
}

// ensureClaudeDirTrusted registers dir's project as a trusted folder for Claude Code unless it, or an
// ancestor that confers trust, already is. The common case — any directory inside a project the
// operator has opened before, run worktrees included — reads the config and writes nothing.
func ensureClaudeDirTrusted(dir string) error {
	target := resolveClaudeTrust(dir)
	path, err := claudeConfigPath()
	if err != nil {
		return err
	}
	if cfg, err := os.ReadFile(path); err == nil {
		if _, changed, err := applyClaudeTrust(cfg, target); err == nil && !changed {
			return nil
		}
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("creating claude config dir: %w", err)
	}
	unlock, err := lockClaudeConfig(path)
	if err != nil {
		return err
	}
	defer unlock()

	perm := fs.FileMode(0o600)
	if st, err := os.Stat(path); err == nil {
		perm = st.Mode().Perm()
	}
	cfg, err := os.ReadFile(path)
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return fmt.Errorf("reading claude config: %w", err)
	}
	out, changed, err := applyClaudeTrust(cfg, target)
	if err != nil {
		return err
	}
	if !changed {
		return nil
	}
	if err := fileutil.AtomicWriteFile(path, out, perm); err != nil {
		return fmt.Errorf("writing claude config: %w", err)
	}
	return nil
}
