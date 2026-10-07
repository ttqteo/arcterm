// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jarvis

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// withTempClaudeConfig points the config seam at a throwaway file. Every test in this file must use
// it — the real config is the operator's live Claude Code install.
func withTempClaudeConfig(t *testing.T, contents string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), ".claude.json")
	if contents != "" {
		if err := os.WriteFile(path, []byte(contents), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	old := claudeConfigPath
	claudeConfigPath = func() (string, error) { return path, nil }
	t.Cleanup(func() { claudeConfigPath = old })
	return path
}

func trustGit(t *testing.T, dir string, args ...string) {
	t.Helper()
	out, err := exec.Command("git", append([]string{"-C", dir}, args...)...).CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
}

// realTempDir is t.TempDir with its symlinks resolved. On macOS the temp root /var is a symlink to
// /private/var, and git writes a worktree's back-references with the resolved path, so a repository
// built under the unresolved one fails claudeCanonicalRoot's exact gitdir check.
func realTempDir(t *testing.T) string {
	t.Helper()
	dir, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	return dir
}

// newTrustRepo builds a real repository with one commit, so worktree resolution runs against git's
// own on-disk shape rather than a hand-built imitation of it.
func newTrustRepo(t *testing.T) string {
	t.Helper()
	dir := realTempDir(t)
	trustGit(t, dir, "init", "-b", "main")
	trustGit(t, dir, "config", "user.email", "t@test")
	trustGit(t, dir, "config", "user.name", "t")
	if err := os.WriteFile(filepath.Join(dir, "base.txt"), []byte("base\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	trustGit(t, dir, "add", ".")
	trustGit(t, dir, "commit", "-m", "base")
	return dir
}

// newTrustWorktree links a worktree where the engine puts one: nested inside the project.
func newTrustWorktree(t *testing.T, repo, name string) string {
	t.Helper()
	wt := filepath.Join(repo, ".waveterm", "worktrees", name)
	trustGit(t, repo, "worktree", "add", "-b", "wave/"+name, wt)
	return wt
}

func decode(t *testing.T, data []byte) map[string]any {
	t.Helper()
	var out map[string]any
	if err := json.Unmarshal(data, &out); err != nil {
		t.Fatalf("result is not valid json: %v\n%s", err, data)
	}
	return out
}

func projectsIn(t *testing.T, data []byte) map[string]any {
	t.Helper()
	projects, _ := decode(t, data)["projects"].(map[string]any)
	return projects
}

func trustedIn(t *testing.T, data []byte, key string) bool {
	t.Helper()
	entry, _ := projectsIn(t, data)[key].(map[string]any)
	v, _ := entry["hasTrustDialogAccepted"].(bool)
	return v
}

func targetFor(dir string) claudeTrustTarget { return resolveClaudeTrust(dir) }

func keyOnly(key string) claudeTrustTarget {
	return claudeTrustTarget{Key: key, Ancestors: []string{key}}
}

// The central finding: Claude Code keys a project by its cwd's canonical git root, and canonicalizing
// a linked worktree resolves it back to the main repository. A run worktree therefore shares its
// project's entry and must never get one of its own.
func TestResolveClaudeTrustKeysWorktreeByMainRepo(t *testing.T) {
	repo := newTrustRepo(t)
	wt := newTrustWorktree(t, repo, "run-1")

	target := targetFor(wt)
	if want := normalizeClaudePath(repo); target.Key != want {
		t.Fatalf("worktree key = %q, want the main repo root %q", target.Key, want)
	}
	if target.Key == normalizeClaudePath(wt) {
		t.Fatal("worktree keyed by its own path")
	}
}

func TestMainCheckout(t *testing.T) {
	repo := newTrustRepo(t)
	wt := newTrustWorktree(t, repo, "run-1")
	// a worktree outside the main checkout, where a channel-path prefix cannot place it
	outside := filepath.Join(realTempDir(t), "elsewhere")
	trustGit(t, repo, "worktree", "add", "-b", "wave/outside", outside)
	sub := filepath.Join(outside, "pkg")
	if err := os.MkdirAll(sub, 0o755); err != nil {
		t.Fatal(err)
	}
	for _, dir := range []string{repo, wt, outside, sub} {
		if got := MainCheckout(dir); normalizeClaudePath(got) != normalizeClaudePath(repo) {
			t.Errorf("MainCheckout(%q) = %q, want %q", dir, got, repo)
		}
	}
	loose := t.TempDir()
	if got := MainCheckout(loose); got != loose {
		t.Errorf("outside a repository: MainCheckout(%q) = %q", loose, got)
	}
	if got := MainCheckout(""); got != "" {
		t.Errorf("MainCheckout of no directory = %q", got)
	}
}

func TestResolveClaudeTrustKeysRepoAndSubdirByRepoRoot(t *testing.T) {
	repo := newTrustRepo(t)
	sub := filepath.Join(repo, "pkg", "deep")
	if err := os.MkdirAll(sub, 0o755); err != nil {
		t.Fatal(err)
	}
	want := normalizeClaudePath(repo)
	for _, dir := range []string{repo, sub} {
		if got := targetFor(dir).Key; got != want {
			t.Errorf("key for %q = %q, want %q", dir, got, want)
		}
	}
	// inside a repo the fallback walk stops at the repo root — it never reaches the repo's parent
	ancestors := targetFor(sub).Ancestors
	if last := ancestors[len(ancestors)-1]; last != want {
		t.Errorf("ancestor walk ended at %q, want the repo root %q", last, want)
	}
}

func TestResolveClaudeTrustNonRepoDirWalksToFilesystemRoot(t *testing.T) {
	dir := t.TempDir()
	target := targetFor(dir)
	if target.Key != normalizeClaudePath(dir) {
		t.Errorf("key = %q, want %q", target.Key, normalizeClaudePath(dir))
	}
	if len(target.Ancestors) < 3 {
		t.Fatalf("walk stopped early: %v", target.Ancestors)
	}
	parent := normalizeClaudePath(filepath.Dir(dir))
	if target.Ancestors[1] != parent {
		t.Errorf("second ancestor = %q, want %q", target.Ancestors[1], parent)
	}
}

// A directory whose parent carries trust needs no entry of its own — this is the accumulation guard.
func TestApplyClaudeTrustSkipsWhenAncestorTrusted(t *testing.T) {
	target := claudeTrustTarget{
		Key:       "C:/Users/x/Projects/newthing",
		Ancestors: []string{"C:/Users/x/Projects/newthing", "C:/Users/x/Projects", "C:/Users/x"},
	}
	src := []byte(`{"projects":{"C:/Users/x/Projects":{"hasTrustDialogAccepted":true}}}`)
	out, changed, err := applyClaudeTrust(src, target)
	if err != nil {
		t.Fatal(err)
	}
	if changed || string(out) != string(src) {
		t.Fatalf("wrote an entry for a dir an ancestor already trusts: changed=%v\n%s", changed, out)
	}
}

func TestApplyClaudeTrustWritesWhenAncestorsAreUntrusted(t *testing.T) {
	target := claudeTrustTarget{
		Key:       "C:/Users/x/Projects/newthing",
		Ancestors: []string{"C:/Users/x/Projects/newthing", "C:/Users/x/Projects"},
	}
	src := []byte(`{"projects":{"C:/Users/x/Projects":{"hasTrustDialogAccepted":false}}}`)
	out, changed, err := applyClaudeTrust(src, target)
	if err != nil || !changed {
		t.Fatalf("changed=%v err=%v", changed, err)
	}
	if !trustedIn(t, out, "C:/Users/x/Projects/newthing") {
		t.Errorf("target not trusted: %s", out)
	}
	if trustedIn(t, out, "C:/Users/x/Projects") {
		t.Errorf("ancestor entry was flipped: %s", out)
	}
}

func TestApplyClaudeTrustPreservesUnknownFields(t *testing.T) {
	src := `{
	  "numStartups": 379,
	  "oauthAccount": {"accountUuid": "abc", "nested": {"deep": [1, 2, 3]}},
	  "someFutureKey": "keep me",
	  "projects": {
	    "C:/other": {"hasTrustDialogAccepted": true, "unknownPerProject": 7}
	  }
	}`
	out, changed, err := applyClaudeTrust([]byte(src), keyOnly("C:/new"))
	if err != nil || !changed {
		t.Fatalf("changed=%v err=%v", changed, err)
	}
	got := decode(t, out)
	if got["numStartups"].(float64) != 379 || got["someFutureKey"] != "keep me" {
		t.Errorf("top-level fields lost: %v", got)
	}
	oauth := got["oauthAccount"].(map[string]any)
	if oauth["accountUuid"] != "abc" || len(oauth["nested"].(map[string]any)["deep"].([]any)) != 3 {
		t.Errorf("nested unknown value not round-tripped: %v", oauth)
	}
	other := got["projects"].(map[string]any)["C:/other"].(map[string]any)
	if other["unknownPerProject"].(float64) != 7 || other["hasTrustDialogAccepted"] != true {
		t.Errorf("sibling project entry mutated: %v", other)
	}
	if !trustedIn(t, out, "C:/new") {
		t.Errorf("target not trusted: %s", out)
	}
}

func TestApplyClaudeTrustKeepsExistingEntrySiblings(t *testing.T) {
	src := `{"projects": {"C:/p": {"allowedTools": ["Bash(git *)"], "mcpServers": {"x": {"command": "y"}}, "hasTrustDialogAccepted": false}}}`
	out, changed, err := applyClaudeTrust([]byte(src), keyOnly("C:/p"))
	if err != nil || !changed {
		t.Fatalf("changed=%v err=%v", changed, err)
	}
	entry := projectsIn(t, out)["C:/p"].(map[string]any)
	if entry["hasTrustDialogAccepted"] != true {
		t.Errorf("trust not flipped: %v", entry)
	}
	if tools := entry["allowedTools"].([]any); len(tools) != 1 || tools[0] != "Bash(git *)" {
		t.Errorf("allowedTools lost: %v", entry)
	}
	if entry["mcpServers"].(map[string]any)["x"].(map[string]any)["command"] != "y" {
		t.Errorf("mcpServers lost: %v", entry)
	}
}

// Claude Code reads a project entry as `projects[key] ?? defaults` — the whole entry or the whole
// default — so a new entry must carry the full default shape, not just the trust flag.
func TestApplyClaudeTrustNewEntryCarriesDefaults(t *testing.T) {
	out, _, err := applyClaudeTrust([]byte(`{}`), keyOnly("C:/p"))
	if err != nil {
		t.Fatal(err)
	}
	entry := projectsIn(t, out)["C:/p"].(map[string]any)
	for _, field := range []string{"allowedTools", "mcpContextUris", "mcpServers", "enabledMcpjsonServers",
		"disabledMcpjsonServers", "hasClaudeMdExternalIncludesApproved", "hasClaudeMdExternalIncludesWarningShown"} {
		if _, ok := entry[field]; !ok {
			t.Errorf("new entry missing default field %q: %v", field, entry)
		}
	}
	if entry["hasTrustDialogAccepted"] != true {
		t.Errorf("new entry not trusted: %v", entry)
	}
}

func TestApplyClaudeTrustAlreadyTrustedIsNoop(t *testing.T) {
	src := []byte(`{"projects":{"C:/p":{"hasTrustDialogAccepted":true}}}`)
	out, changed, err := applyClaudeTrust(src, keyOnly("C:/p"))
	if err != nil {
		t.Fatal(err)
	}
	if changed || string(out) != string(src) {
		t.Fatalf("changed=%v out=%s", changed, out)
	}
}

func TestApplyClaudeTrustToleratesEmptyAndNullShapes(t *testing.T) {
	for name, src := range map[string]string{
		"absent":        "",
		"blank":         "   \n",
		"empty object":  "{}",
		"null projects": `{"projects": null}`,
	} {
		t.Run(name, func(t *testing.T) {
			out, changed, err := applyClaudeTrust([]byte(src), keyOnly("C:/p"))
			if err != nil || !changed {
				t.Fatalf("changed=%v err=%v", changed, err)
			}
			if !trustedIn(t, out, "C:/p") {
				t.Errorf("not trusted: %s", out)
			}
		})
	}
}

func TestApplyClaudeTrustRefusesMalformedConfig(t *testing.T) {
	for name, src := range map[string]string{
		"truncated":        `{"projects": {"C:/p":`,
		"not an object":    `[1,2,3]`,
		"projects is text": `{"projects": "nope"}`,
		"entry is text":    `{"projects": {"C:/p": "nope"}}`,
	} {
		t.Run(name, func(t *testing.T) {
			if _, _, err := applyClaudeTrust([]byte(src), keyOnly("C:/p")); err == nil {
				t.Fatal("malformed config accepted; a write here would clobber the real one")
			}
		})
	}
}

func TestNormalizeClaudePathIsAbsoluteWithForwardSlashes(t *testing.T) {
	dir := realTempDir(t)
	key := normalizeClaudePath(dir)
	if strings.Contains(key, `\`) {
		t.Errorf("key %q still has backslashes", key)
	}
	if !filepath.IsAbs(filepath.FromSlash(key)) {
		t.Errorf("key %q is not absolute", key)
	}
	// a path that does not exist has no symlinks to resolve but must still normalize
	missing := normalizeClaudePath(filepath.Join(dir, "nope", "deeper"))
	if strings.Contains(missing, `\`) || !strings.HasPrefix(missing, key+"/") {
		t.Errorf("missing-path key = %q", missing)
	}
}

// The bug as observed: a lead launched into a project nothing has trusted.
func TestEnsureClaudeDirTrustedRegistersUntrustedProject(t *testing.T) {
	path := withTempClaudeConfig(t, `{"numStartups": 3, "projects": {"C:/other": {"hasTrustDialogAccepted": true}}}`)
	repo := newTrustRepo(t)
	if err := ensureClaudeDirTrusted(repo); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !trustedIn(t, data, normalizeClaudePath(repo)) {
		t.Fatalf("project not registered: %s", data)
	}
	if decode(t, data)["numStartups"].(float64) != 3 || !trustedIn(t, data, "C:/other") {
		t.Errorf("existing config content lost: %s", data)
	}
}

// The case the exact-key check got wrong: a run worktree inside a trusted project already resolves to
// that project's entry, so nothing may be written for it.
func TestEnsureClaudeDirTrustedLeavesWorktreeInTrustedProjectAlone(t *testing.T) {
	repo := newTrustRepo(t)
	wt := newTrustWorktree(t, repo, "run-1")
	path := withTempClaudeConfig(t, `{"projects": {"`+normalizeClaudePath(repo)+`": {"hasTrustDialogAccepted": true}}}`)
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := ensureClaudeDirTrusted(wt); err != nil {
		t.Fatal(err)
	}
	after, _ := os.ReadFile(path)
	if string(before) != string(after) {
		t.Fatalf("config rewritten for a worktree in a trusted project:\n%s\n%s", before, after)
	}
}

// Many worktrees in one untrusted project must converge on one entry — the project's — never one per
// worktree, or a 16-task DAG would leave 16 dead entries behind.
func TestEnsureClaudeDirTrustedRegistersProjectOnceForManyWorktrees(t *testing.T) {
	path := withTempClaudeConfig(t, `{}`)
	repo := newTrustRepo(t)
	for _, name := range []string{"run-1", "run-2", "run-3"} {
		if err := ensureClaudeDirTrusted(newTrustWorktree(t, repo, name)); err != nil {
			t.Fatal(err)
		}
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	projects := projectsIn(t, data)
	if len(projects) != 1 {
		t.Fatalf("wrote %d entries, want exactly the project's: %v", len(projects), projects)
	}
	if !trustedIn(t, data, normalizeClaudePath(repo)) {
		t.Fatalf("project not registered: %s", data)
	}
	for key := range projects {
		if strings.Contains(key, "worktrees") {
			t.Errorf("wrote an entry for a worktree path: %q", key)
		}
	}
}

func TestEnsureClaudeDirTrustedCreatesMissingConfig(t *testing.T) {
	path := withTempClaudeConfig(t, "")
	dir := t.TempDir()
	if err := ensureClaudeDirTrusted(dir); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !trustedIn(t, data, normalizeClaudePath(dir)) {
		t.Fatalf("dir not registered in fresh config: %s", data)
	}
}

func TestEnsureClaudeDirTrustedRefusesMalformedConfig(t *testing.T) {
	path := withTempClaudeConfig(t, `{"projects": {`)
	if err := ensureClaudeDirTrusted(t.TempDir()); err == nil {
		t.Fatal("malformed config accepted")
	}
	data, _ := os.ReadFile(path)
	if string(data) != `{"projects": {` {
		t.Fatalf("malformed config was overwritten: %s", data)
	}
}

// A held lock must surface as an error rather than a forced write — the caller turns that into a
// failed spawn, which is visible, where a worker blocked on the trust prompt is not.
func TestEnsureClaudeDirTrustedFailsWhileLockIsHeld(t *testing.T) {
	path := withTempClaudeConfig(t, `{}`)
	if err := os.Mkdir(path+".lock", 0o700); err != nil {
		t.Fatal(err)
	}
	start := time.Now()
	err := ensureClaudeDirTrusted(t.TempDir())
	if err == nil || !strings.Contains(err.Error(), "held by another process") {
		t.Fatalf("err = %v", err)
	}
	if elapsed := time.Since(start); elapsed > 3*claudeLockTimeout {
		t.Errorf("waited %v on a held lock", elapsed)
	}
}

func TestEnsureClaudeDirTrustedBreaksStaleLock(t *testing.T) {
	path := withTempClaudeConfig(t, `{}`)
	lock := path + ".lock"
	if err := os.Mkdir(lock, 0o700); err != nil {
		t.Fatal(err)
	}
	stale := time.Now().Add(-2 * claudeLockStale)
	if err := os.Chtimes(lock, stale, stale); err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	if err := ensureClaudeDirTrusted(dir); err != nil {
		t.Fatal(err)
	}
	data, _ := os.ReadFile(path)
	if !trustedIn(t, data, normalizeClaudePath(dir)) {
		t.Fatalf("stale lock not broken: %s", data)
	}
	if _, err := os.Stat(lock); err == nil {
		t.Error("lock left behind")
	}
}

func TestLockClaudeConfigReleases(t *testing.T) {
	path := filepath.Join(t.TempDir(), ".claude.json")
	unlock, err := lockClaudeConfig(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(path + ".lock"); err != nil {
		t.Fatalf("lock dir not created: %v", err)
	}
	unlock()
	if _, err := os.Stat(path + ".lock"); err == nil {
		t.Fatal("lock dir survived release")
	}
	unlock2, err := lockClaudeConfig(path)
	if err != nil {
		t.Fatalf("relock failed: %v", err)
	}
	unlock2()
}
