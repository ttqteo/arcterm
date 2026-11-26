// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package gitaccount

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func removeAll(p string) error { return os.RemoveAll(p) }

// backupFiles returns every file under the backup dir by its path relative to its folder.
func backupFiles(t *testing.T, dir string) map[string]string {
	t.Helper()
	out := map[string]string{}
	filepath.Walk(dir, func(p string, info os.FileInfo, err error) error {
		if err == nil && !info.IsDir() {
			rel, _ := filepath.Rel(dir, p)
			out[rel], _ = readFile(p)
		}
		return nil
	})
	return out
}

func readFile(p string) (string, error) {
	raw, err := os.ReadFile(p)
	return string(raw), err
}

func TestFixRewritesAndBacksUp(t *testing.T) {
	e := newTestEnv(t)
	ctx := context.Background()
	root := e.dir("work")
	e.mustAdd("work-user", workToken, root, "personal")

	a := e.repo("work", "a")
	e.git(a, "remote", "add", "origin", "https://"+leakedToken+"@github.com/org/a.git")
	e.git(a, "config", "user.name", "Old Name")
	e.git(a, "config", "user.email", "old@example.com")
	b := e.repo("work", "b")
	e.git(b, "remote", "add", "origin", "https://u:secretvalue@github.com/org/b.git")
	e.git(b, "config", "remote.origin.pushurl", "https://u:secretvalue@github.com/org/b.git")
	untouched := e.repo("work", "c")
	e.git(untouched, "remote", "add", "origin", "https://"+leakedToken+"@github.com/org/c.git")
	notRepo := e.dir("work", "plain")
	outside := e.repo("elsewhere")
	e.git(outside, "remote", "add", "origin", "https://"+leakedToken+"@github.com/org/o.git")

	configs := func() string {
		return e.read(repoConfigPath(a)) + e.read(repoConfigPath(b)) + e.read(repoConfigPath(untouched)) + e.read(repoConfigPath(outside))
	}
	before := configs()
	backupsBefore := countDirs(t, e.backups) // the add rewrote ~/.gitconfig
	req := wshrpc.CommandGitAccountFixData{Login: "work-user", TokenRepos: []string{a, b, notRepo, outside}, IdentityRepos: []string{a}}

	// refused: no token in the store, then a token GitHub rejects
	if err := rejectToken(ctx, "work-user"); err != nil {
		t.Fatal(err)
	}
	if _, err := Fix(ctx, req); err == nil || !strings.Contains(err.Error(), "No token saved") {
		t.Errorf("fix without a token: %v", err)
	}
	if err := storeToken(ctx, "work-user", "stale-token"); err != nil {
		t.Fatal(err)
	}
	if _, err := Fix(ctx, req); err == nil || !strings.Contains(err.Error(), "refused") {
		t.Errorf("fix with a refused token: %v", err)
	}
	e.setStatus(500)
	if _, err := Fix(ctx, req); err == nil || !strings.Contains(err.Error(), "reach GitHub") {
		t.Errorf("fix with GitHub down: %v", err)
	}
	e.setStatus(0)
	if configs() != before || countDirs(t, e.backups) != backupsBefore {
		t.Fatal("a refused fix changed a repo or made a backup")
	}

	// a backup folder per older operation: only the newest 20 stay
	for i := 0; i < 25; i++ {
		e.dir("backups", fmt.Sprintf("2020010%d-0000%02d", i%9, i))
	}
	if err := SetToken(ctx, "work-user", workToken); err != nil {
		t.Fatal(err)
	}
	rtn, err := Fix(ctx, req)
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]string{}
	for _, r := range rtn.Results {
		got[r.Kind+":"+r.Path] = r.Error
	}
	if len(rtn.Results) != 5 {
		t.Fatalf("results = %+v", rtn.Results)
	}
	if got["token:"+a] != "" || got["token:"+b] != "" || got["identity:"+a] != "" {
		t.Errorf("the repos that could be fixed reported errors: %+v", rtn.Results)
	}
	if !strings.Contains(got["token:"+notRepo], "not a git repo") || !strings.Contains(got["token:"+outside], "not under a folder") {
		t.Errorf("failures not reported per row: %+v", rtn.Results)
	}

	if u := e.git(a, "config", "--get", "remote.origin.url"); u != "https://github.com/org/a.git" {
		t.Errorf("a's url = %q", u)
	}
	if u := e.git(b, "config", "--get", "remote.origin.url"); u != "https://github.com/org/b.git" {
		t.Errorf("b's url = %q", u)
	}
	if u := e.git(b, "config", "--get", "remote.origin.pushurl"); u != "https://github.com/org/b.git" {
		t.Errorf("b's pushurl = %q", u)
	}
	if cfg := e.read(repoConfigPath(a)); strings.Contains(cfg, "Old Name") || strings.Contains(cfg, "old@example.com") || strings.Contains(cfg, leakedToken) {
		t.Errorf("a's config after the fix:\n%s", cfg)
	}
	if !strings.Contains(e.read(repoConfigPath(untouched)), leakedToken) || !strings.Contains(e.read(repoConfigPath(outside)), leakedToken) {
		t.Error("a repo that was not ticked, or is outside the roots, was changed")
	}

	files := backupFiles(t, e.backups)
	var cfgBackups []string
	for rel, content := range files {
		if strings.HasPrefix(rel, "2020") {
			continue
		}
		if strings.Contains(rel, "repos"+string(filepath.Separator)) && strings.HasSuffix(rel, ".config") {
			cfgBackups = append(cfgBackups, content)
		}
	}
	if len(cfgBackups) != 2 {
		t.Fatalf("repo config backups = %d, want a and b", len(cfgBackups))
	}
	for _, c := range cfgBackups {
		if !strings.Contains(c, leakedToken) && !strings.Contains(c, "secretvalue") {
			t.Errorf("a backup does not hold the original config:\n%s", c)
		}
	}
	if n := countDirs(t, e.backups); n != keepBackups {
		t.Errorf("backup folders = %d, want %d", n, keepBackups)
	}

	// a second fix finds nothing left to do and reports success
	again, err := Fix(ctx, wshrpc.CommandGitAccountFixData{Login: "work-user", TokenRepos: []string{a}})
	if err != nil || again.Results[0].Error != "" {
		t.Errorf("second fix = %+v, %v", again, err)
	}
}

func TestFixLeavesAReadOnlyRepoReported(t *testing.T) {
	e := newTestEnv(t)
	if os.Geteuid() == 0 {
		t.Skip("root writes anywhere")
	}
	ctx := context.Background()
	e.mustAdd("work-user", workToken, e.dir("work"), "personal")
	locked := e.repo("work", "locked")
	e.git(locked, "remote", "add", "origin", "https://"+leakedToken+"@github.com/org/l.git")
	fine := e.repo("work", "fine")
	e.git(fine, "remote", "add", "origin", "https://"+leakedToken+"@github.com/org/f.git")
	if err := os.Chmod(filepath.Join(locked, ".git"), 0o555); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.Chmod(filepath.Join(locked, ".git"), 0o755) })

	rtn, err := Fix(ctx, wshrpc.CommandGitAccountFixData{Login: "work-user", TokenRepos: []string{locked, fine}})
	if err != nil {
		t.Fatal(err)
	}
	if rtn.Results[0].Error == "" || rtn.Results[1].Error != "" {
		t.Errorf("results = %+v: want the locked repo to fail and the next one to be fixed", rtn.Results)
	}
	if strings.Contains(rtn.Results[0].Error, leakedToken) {
		t.Error("the error holds the token")
	}
	if u := e.git(fine, "config", "--get", "remote.origin.url"); u != "https://github.com/org/f.git" {
		t.Errorf("fine's url = %q", u)
	}
}

func TestCredentialsFixKeepsOtherHosts(t *testing.T) {
	e := newTestEnv(t)
	ctx := context.Background()
	e.writeHome(".gitconfig", e.readHome(".gitconfig")+"[credential \"https://github.com\"]\n\thelper = !gh auth git-credential\n")
	original := "https://u:t@github.com\nhttps://u:t2@gitlab.com\nhttps://x:y@github.com\n"
	creds := e.writeHome(".git-credentials", original)
	e.mustAdd("work-user", workToken, e.dir("work"), "personal")

	if e.read(creds) != original {
		t.Fatal("adding an account wrote ~/.git-credentials")
	}
	if got, err := effectiveHelpers(false); err != nil || strings.Join(got, "|") != "store|!gh auth git-credential" {
		t.Fatalf("helpers before the fix = %q, %v", got, err)
	}
	if scan, _ := Scan(); scan.CredentialsLines != 2 {
		t.Errorf("credentials lines before = %d", scan.CredentialsLines)
	}

	rtn, err := Fix(ctx, wshrpc.CommandGitAccountFixData{Login: "work-user", Credentials: true})
	if err != nil || len(rtn.Results) != 1 || rtn.Results[0].Kind != "credentials" || rtn.Results[0].Error != "" {
		t.Fatalf("fix = %+v, %v", rtn, err)
	}
	if got := e.read(creds); got != "https://u:t2@gitlab.com\n" {
		t.Errorf("~/.git-credentials after = %q", got)
	}
	if files := backupFiles(t, e.backups); !hasBackup(files, "git-credentials", original) || !hasBackup(files, "gitconfig", "") {
		t.Errorf("backups = %v", files)
	}
	gitconfig := e.readHome(".gitconfig")
	if !strings.Contains(gitconfig, "\thelper =\n\thelper = \"!gh auth git-credential\"\n") {
		t.Errorf("the block does not reset and restore:\n%s", gitconfig)
	}
	if got, err := effectiveHelpers(false); err != nil || strings.Join(got, "|") != "!gh auth git-credential" {
		t.Errorf("helpers after the fix = %q, %v: want store gone for github.com", got, err)
	}
	if scan, _ := Scan(); scan.CredentialsLines != 0 {
		t.Errorf("credentials lines after = %d", scan.CredentialsLines)
	}

	// a token arcterm approves now never reaches the plain-text file, and `store` still serves other hosts
	if err := SetToken(ctx, "work-user", workToken); err != nil {
		t.Fatal(err)
	}
	if got := e.read(creds); got != "https://u:t2@gitlab.com\n" {
		t.Errorf("approve wrote ~/.git-credentials: %q", got)
	}
	repo := e.repo("elsewhere", "r")
	out, err := e.gitIn(repo, "protocol=https\nhost=gitlab.com\n\n", "credential", "fill")
	if err != nil || !strings.Contains(out, "password=t2") {
		t.Errorf("fill for gitlab.com = %q, %v", out, err)
	}

	// removing the last account puts git back as it was: the block, its reset and the helper list go
	if err := SetDefault("other-person"); err != nil {
		t.Fatal(err)
	}
	if err := Remove(ctx, "work-user"); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(e.readHome(".gitconfig"), blockBegin) {
		t.Error("the block stayed")
	}
	if got, err := effectiveHelpers(false); err != nil || strings.Join(got, "|") != "store|!gh auth git-credential" {
		t.Errorf("helpers after removing the last account = %q, %v", got, err)
	}
}

func hasBackup(files map[string]string, name, content string) bool {
	for rel, c := range files {
		if filepath.Base(rel) == name && (content == "" || c == content) {
			return true
		}
	}
	return false
}
