// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package memhygiene

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/agentobserve"
	"github.com/wavetermdev/waveterm/pkg/memroots"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

// discoverMemDir creates <claudeHome>/projects/<name>/memory and returns it.
func discoverMemDir(t *testing.T, claudeHome, name string) string {
	t.Helper()
	dir := filepath.Join(claudeHome, "projects", name, discoverMemoryDirName)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	return dir
}

func discoverMkdir(t *testing.T, dir string) string {
	t.Helper()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	return dir
}

func discoverWriteSetting(t *testing.T, file, value string) {
	t.Helper()
	data, err := json.Marshal(map[string]string{"autoMemoryDirectory": value})
	if err != nil {
		t.Fatal(err)
	}
	writeFile(t, file, string(data))
}

// discoverOnly runs Discover for one project and returns its result.
func discoverOnly(t *testing.T, path, claudeHome string) Resolved {
	t.Helper()
	out := Discover(map[string]string{"p": path}, claudeHome)
	if len(out) != 1 {
		t.Fatalf("Discover returned %d results, want 1", len(out))
	}
	return out[0]
}

func discoverSamePath(a, b string) bool {
	return strings.EqualFold(filepath.Clean(a), filepath.Clean(b))
}

func TestDiscoverUsesGitToplevel(t *testing.T) {
	repo := initRepo(t)
	sub := discoverMkdir(t, filepath.Join(repo, "src", "sub"))
	claudeHome := t.TempDir()
	want := discoverMemDir(t, claudeHome, agentobserve.SlugifyCwd(repo))
	discoverMemDir(t, claudeHome, agentobserve.SlugifyCwd(sub))

	r := discoverOnly(t, sub, claudeHome)
	if r.Skip != "" {
		t.Fatalf("Skip = %q, want none", r.Skip)
	}
	if !discoverSamePath(r.Toplevel, repo) {
		t.Errorf("Toplevel = %q, want %q", r.Toplevel, repo)
	}
	if r.Folder != want {
		t.Errorf("Folder = %q, want the toplevel's %q", r.Folder, want)
	}
}

func TestDiscoverAutoMemoryPrecedence(t *testing.T) {
	repo := initRepo(t)
	claudeHome := t.TempDir()
	discoverMemDir(t, claudeHome, agentobserve.SlugifyCwd(repo))
	scratch := t.TempDir()
	global := discoverMkdir(t, filepath.Join(scratch, "global"))
	project := discoverMkdir(t, filepath.Join(scratch, "project"))
	local := discoverMkdir(t, filepath.Join(scratch, "local"))

	steps := []struct {
		file, value string
	}{
		{filepath.Join(claudeHome, "settings.json"), global},
		{filepath.Join(repo, ".claude", "settings.json"), project},
		{filepath.Join(repo, ".claude", "settings.local.json"), local},
	}
	for _, step := range steps {
		discoverWriteSetting(t, step.file, step.value)
		r := discoverOnly(t, repo, claudeHome)
		if r.Skip != "" {
			t.Fatalf("after %s: Skip = %q, want none", step.file, r.Skip)
		}
		if r.Folder != step.value {
			t.Errorf("after %s: Folder = %q, want %q", step.file, r.Folder, step.value)
		}
	}

	// a lower scope that doesn't set the key leaves the next scope in charge
	writeFile(t, filepath.Join(repo, ".claude", "settings.local.json"), `{"model": "x"}`)
	if r := discoverOnly(t, repo, claudeHome); r.Folder != project {
		t.Errorf("local without the key: Folder = %q, want project's %q", r.Folder, project)
	}
}

func TestDiscoverAutoMemoryExpandsHome(t *testing.T) {
	repo := initRepo(t)
	home := t.TempDir()
	claudeHome := filepath.Join(home, ".claude")
	want := discoverMkdir(t, filepath.Join(home, "mem", "arc"))
	discoverWriteSetting(t, filepath.Join(repo, ".claude", "settings.local.json"), "~/mem/arc")

	if r := discoverOnly(t, repo, claudeHome); r.Folder != want || r.Skip != "" {
		t.Errorf("Folder, Skip = %q, %q, want %q, none", r.Folder, r.Skip, want)
	}
}

func TestDiscoverBadSettingsSkipsWithReason(t *testing.T) {
	repo := initRepo(t)
	claudeHome := t.TempDir()
	discoverMemDir(t, claudeHome, agentobserve.SlugifyCwd(repo))
	file := filepath.Join(repo, ".claude", "settings.local.json")
	writeFile(t, file, `[1, 2]`)

	r := discoverOnly(t, repo, claudeHome)
	if !strings.Contains(r.Skip, file) {
		t.Errorf("Skip = %q, want it to name %s", r.Skip, file)
	}
}

func TestDiscoverSlugCaseInsensitive(t *testing.T) {
	repo := initRepo(t)
	claudeHome := t.TempDir()
	slug := agentobserve.SlugifyCwd(repo)
	// flip the drive letter's (or first rune's) case, as a cwd spelled the other way would
	flipped := strings.ToLower(slug[:1]) + slug[1:]
	if flipped == slug {
		flipped = strings.ToUpper(slug[:1]) + slug[1:]
	}
	want := discoverMemDir(t, claudeHome, flipped)

	r := discoverOnly(t, repo, claudeHome)
	if r.Skip != "" {
		t.Fatalf("Skip = %q, want none", r.Skip)
	}
	if r.Folder != want {
		t.Errorf("Folder = %q, want the on-disk %q", r.Folder, want)
	}
}

func TestDiscoverSharedFolder(t *testing.T) {
	repo := initRepo(t)
	subA := discoverMkdir(t, filepath.Join(repo, "sub_a"))
	subB := discoverMkdir(t, filepath.Join(repo, "sub_b"))
	other := initRepo(t)
	claudeHome := t.TempDir()
	shared := discoverMemDir(t, claudeHome, agentobserve.SlugifyCwd(repo))
	discoverMemDir(t, claudeHome, agentobserve.SlugifyCwd(other))
	hashA := discoverMemDir(t, claudeHome, memroots.ProjectHash(subA))
	slugB := filepath.Join(claudeHome, "projects", agentobserve.SlugifyCwd(subB), discoverMemoryDirName)

	out := Discover(map[string]string{"a": subA, "b": subB, "other": other}, claudeHome)
	byName := map[string]Resolved{}
	for _, r := range out {
		byName[r.Project] = r
	}
	a, b, o := byName["a"], byName["b"], byName["other"]
	if a.Folder != shared || b.Folder != shared {
		t.Fatalf("Folders = %q, %q, want both %q", a.Folder, b.Folder, shared)
	}
	if !reflect.DeepEqual(a.SharedWith, []string{"b"}) || !reflect.DeepEqual(b.SharedWith, []string{"a"}) {
		t.Errorf("SharedWith = %v, %v, want [b], [a]", a.SharedWith, b.SharedWith)
	}
	if a.OwnFolder != hashA {
		t.Errorf("a.OwnFolder = %q, want the existing ProjectHash folder %q", a.OwnFolder, hashA)
	}
	if b.OwnFolder != slugB {
		t.Errorf("b.OwnFolder = %q, want the slug folder %q", b.OwnFolder, slugB)
	}
	if len(o.SharedWith) != 0 || o.OwnFolder != "" {
		t.Errorf("other: SharedWith, OwnFolder = %v, %q, want none", o.SharedWith, o.OwnFolder)
	}
}

func TestDiscoverTranscriptPrefixes(t *testing.T) {
	repo := initRepo(t)
	oldDataDir := wavebase.DataHome_VarCache
	// a data dir inside the project puts the headless slug under the project's "--" prefix
	wavebase.DataHome_VarCache = filepath.Join(repo, ".arc")
	t.Cleanup(func() { wavebase.DataHome_VarCache = oldDataDir })
	headless := agentobserve.HeadlessAgentSlug()
	slug := agentobserve.SlugifyCwd(repo)
	if !strings.HasPrefix(headless, slug+"--") {
		t.Fatalf("headless slug %q doesn't carry the project prefix %q", headless, slug+"--")
	}
	claudeHome := t.TempDir()
	discoverMemDir(t, claudeHome, slug)
	worktree := strings.ToLower(slug) + "--claude-worktrees-x"
	for _, name := range []string{worktree, slug + "-other", headless} {
		discoverMkdir(t, filepath.Join(claudeHome, "projects", name))
	}

	r := discoverOnly(t, repo, claudeHome)
	var got []string
	for _, dir := range r.TranscriptDirs {
		got = append(got, filepath.Base(dir))
	}
	want := map[string]bool{slug: true, worktree: true}
	if len(got) != len(want) {
		t.Fatalf("TranscriptDirs = %v, want %v", got, want)
	}
	for _, name := range got {
		if !want[name] {
			t.Errorf("TranscriptDirs = %v, want %v", got, want)
		}
	}
}

func TestDiscoverSkipsMissingPathAndFolder(t *testing.T) {
	gone := filepath.Join(t.TempDir(), "gone")
	noFolder := initRepo(t)
	claudeHome := t.TempDir()

	out := Discover(map[string]string{"gone": gone, "nofolder": noFolder}, claudeHome)
	if len(out) != 2 {
		t.Fatalf("Discover returned %d results, want 2", len(out))
	}
	if g := out[0]; g.Project != "gone" || !strings.Contains(g.Skip, "path missing") || !strings.Contains(g.Skip, gone) {
		t.Errorf("gone: Project, Skip = %q, %q, want a missing-path reason naming %s", g.Project, g.Skip, gone)
	}
	if n := out[1]; n.Project != "nofolder" || !strings.Contains(n.Skip, "no memory folder") {
		t.Errorf("nofolder: Project, Skip = %q, %q, want a no-memory-folder reason", n.Project, n.Skip)
	}
}

func TestDiscoverNotARepoUsesPath(t *testing.T) {
	path := t.TempDir()
	claudeHome := t.TempDir()
	want := discoverMemDir(t, claudeHome, agentobserve.SlugifyCwd(path))

	r := discoverOnly(t, path, claudeHome)
	if r.Skip != "" {
		t.Fatalf("Skip = %q, want none", r.Skip)
	}
	if r.Toplevel != path || r.Folder != want {
		t.Errorf("Toplevel, Folder = %q, %q, want %q, %q", r.Toplevel, r.Folder, path, want)
	}
}
