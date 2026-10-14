// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package memhygiene

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

// the package's shared test helpers: every task's tests use these and define no git or temp-repo
// helper of their own.

// fakeGitEnv makes the test binary act as a git outside any repo whose messages follow the locale, as
// a translated git's do, so a test needn't find a translated git installed.
const fakeGitEnv = "MEMHYGIENE_FAKE_GIT"

func TestMain(m *testing.M) {
	if os.Getenv(fakeGitEnv) != "" {
		msg := "fatal: kein Git-Repository (oder irgendeines der Elternverzeichnisse): .git"
		if os.Getenv("LC_ALL") == "C" {
			msg = "fatal: not a git repository (or any of the parent directories): .git"
		}
		fmt.Fprintln(os.Stderr, msg)
		os.Exit(128)
	}
	os.Exit(m.Run())
}

// useLocalizedGit puts a copy of the test binary first on PATH as git, run as the fake above, with a
// German locale set.
func useLocalizedGit(t *testing.T) {
	t.Helper()
	self, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	bin := t.TempDir()
	name := "git"
	if runtime.GOOS == "windows" {
		name = "git.exe"
	}
	src, err := os.Open(self)
	if err != nil {
		t.Fatal(err)
	}
	defer src.Close()
	dst, err := os.OpenFile(filepath.Join(bin, name), os.O_CREATE|os.O_WRONLY, 0o755)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := io.Copy(dst, src); err != nil {
		dst.Close()
		t.Fatal(err)
	}
	if err := dst.Close(); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
	t.Setenv(fakeGitEnv, "1")
	t.Setenv("LC_ALL", "de_DE.UTF-8")
	t.Setenv("LANGUAGE", "de")
}

// initRepo makes a temp repo on branch main, hermetic against the user's git config, with one
// initial commit.
func initRepo(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	for _, args := range [][]string{
		{"init", "-q", "--initial-branch=main"},
		{"config", "user.name", "dana k"},
		{"config", "user.email", "dana@example.com"},
		{"config", "commit.gpgsign", "false"},
		// git for windows defaults core.autocrlf=true, which would rewrite line endings the tests assert
		{"config", "core.autocrlf", "false"},
	} {
		if _, err := runGit(dir, args...); err != nil {
			t.Fatal(err)
		}
	}
	commit(t, dir, "initial", map[string]string{"README.md": "init\n"})
	return dir
}

// commit writes files (paths relative to dir), commits them, and returns the commit hash.
func commit(t *testing.T, dir, msg string, files map[string]string) string {
	t.Helper()
	for rel, content := range files {
		writeFile(t, filepath.Join(dir, rel), content)
	}
	if _, err := runGit(dir, "add", "-A"); err != nil {
		t.Fatal(err)
	}
	if _, err := runGit(dir, "commit", "-q", "--allow-empty", "-m", msg); err != nil {
		t.Fatal(err)
	}
	hash, err := runGit(dir, "rev-parse", "HEAD")
	if err != nil {
		t.Fatal(err)
	}
	return hash
}

// writeFile writes content to path, creating its parent dirs.
func writeFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}
