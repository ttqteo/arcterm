// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package gitaccount

import (
	"path/filepath"
	"strings"
	"testing"
)

const leakedToken = "ghp_0123456789abcdefghijklmnopqrstuvwxyz"

func TestScanFindsLeaksAndIdentities(t *testing.T) {
	e := newTestEnv(t)
	root := e.dir("work")
	e.mustAdd("work-user", workToken, root, "personal")

	tokenUser := e.repo("work", "a")
	e.git(tokenUser, "remote", "add", "origin", "https://"+leakedToken+"@github.com/org/a.git")
	e.git(tokenUser, "config", "user.name", "Someone Else")

	password := e.repo("work", "deep", "b")
	e.git(password, "remote", "add", "origin", "https://x-access-token:secretvalue@github.com/org/b.git")
	e.git(password, "remote", "add", "mirror", "https://user:secretvalue@github.com/org/b2.git")
	e.git(password, "config", "user.email", "work-user@example.com") // same as the account: not an identity row

	plain := e.repo("work", "c")
	e.git(plain, "remote", "add", "origin", "https://user@github.com/org/c.git")
	e.git(plain, "config", "user.email", "OTHER@example.com")

	clean := e.repo("work", "d")
	e.git(clean, "remote", "add", "origin", "https://github.com/org/d.git")

	otherHost := e.repo("work", "e")
	e.git(otherHost, "remote", "add", "origin", "https://oauth2:secretvalue@gitlab.com/org/e.git")

	tooDeep := e.repo("work", "x", "y", "z")
	e.git(tooDeep, "remote", "add", "origin", "https://"+leakedToken+"@github.com/org/z.git")
	inModules := e.repo("work", "a2", "node_modules")
	e.git(inModules, "remote", "add", "origin", "https://"+leakedToken+"@github.com/org/m.git")
	hidden := e.repo("work", ".cache", "h")
	e.git(hidden, "remote", "add", "origin", "https://"+leakedToken+"@github.com/org/h.git")
	e.git(e.repo("work", "wt-main"), "commit", "--allow-empty", "-q", "-m", "x")
	e.write(filepath.Join(root, "wt", ".git"), "gitdir: "+filepath.Join(root, "wt-main", ".git")+"\n") // a worktree's .git file

	scan, err := Scan()
	if err != nil {
		t.Fatal(err)
	}
	if len(scan.Errors) != 0 {
		t.Fatalf("scan errors: %v", scan.Errors)
	}
	if len(scan.Accounts) != 1 {
		t.Fatalf("accounts = %+v", scan.Accounts)
	}
	a := scan.Accounts[0]
	if a.Login != "work-user" || a.Repos != 6 { // a, deep/b, c, d, e, wt-main
		t.Errorf("repos = %d (%+v)", a.Repos, a)
	}
	leaks := map[string]string{}
	for _, r := range a.TokenRepos {
		leaks[r.Path] = r.Remote + " " + r.MaskedUrl
		if strings.Contains(r.MaskedUrl, leakedToken) || strings.Contains(r.MaskedUrl, "secretvalue") || strings.Contains(r.Remote, "secretvalue") {
			t.Errorf("the masked URL holds the token: %+v", r)
		}
	}
	if len(leaks) != 2 {
		t.Fatalf("leak rows = %v, want a and deep/b", leaks)
	}
	if got := leaks[tokenUser]; got != "origin https://•••@github.com/org/a.git" {
		t.Errorf("token-user row = %q", got)
	}
	if got := leaks[password]; !strings.HasPrefix(got, "origin, mirror https://•••@github.com/org/b.git") {
		t.Errorf("password row = %q", got)
	}
	ids := map[string]string{}
	for _, r := range a.IdentityRepos {
		ids[r.Path] = r.Name + "|" + r.Email
	}
	if len(ids) != 2 || ids[tokenUser] != "Someone Else|" || ids[plain] != "|OTHER@example.com" {
		t.Errorf("identity rows = %v", ids)
	}
	if scan.CredentialsLines != 0 {
		t.Errorf("credentials lines = %d", scan.CredentialsLines)
	}
}

func TestScanCountsGithubCredentialLines(t *testing.T) {
	e := newTestEnv(t)
	e.mustAdd("work-user", workToken, "", "personal")
	e.writeHome(".git-credentials", "https://u:t@github.com\nhttps://u:t2@gitlab.com\nhttps://x:y@github.com\n\n")
	scan, err := Scan()
	if err != nil {
		t.Fatal(err)
	}
	if scan.CredentialsLines != 2 {
		t.Errorf("credentials lines = %d", scan.CredentialsLines)
	}
	a := scan.Accounts[0]
	if a.Repos != 0 || a.TokenRepos == nil || a.IdentityRepos == nil {
		t.Errorf("an account with no folder = %+v: want zero repos and non-nil lists", a)
	}
}

func TestScanReportsAMissingRoot(t *testing.T) {
	e := newTestEnv(t)
	root := e.dir("gone")
	e.mustAdd("work-user", workToken, root, "personal")
	if err := removeAll(root); err != nil {
		t.Fatal(err)
	}
	scan, err := Scan()
	if err != nil || len(scan.Errors) != 1 || !strings.Contains(scan.Errors[0], root) {
		t.Errorf("scan = %+v, %v: want one error naming the root", scan, err)
	}
}

func TestLeakedURL(t *testing.T) {
	cases := []struct {
		raw   string
		leak  bool
		clean string
	}{
		{"https://ghp_abc@github.com/o/r.git", true, "https://github.com/o/r.git"},
		{"https://github_pat_abc@github.com/o/r", true, "https://github.com/o/r"},
		{"https://me:pw@github.com/o/r.git", true, "https://github.com/o/r.git"},
		{"HTTPS://me:pw@GitHub.com:443/o/r?x=1", true, "HTTPS://GitHub.com:443/o/r?x=1"},
		{"https://me:@github.com/o/r", false, ""},
		{"https://me@github.com/o/r", false, ""},
		{"https://github.com/o/r", false, ""},
		{"https://ghp_abc@gitlab.com/o/r", false, ""},
		{"git@github.com:o/r.git", false, ""},
		{"http://me:pw@github.com/o/r", false, ""},
		{"https://me:pw@github.com.evil.example/o/r", false, ""},
		{"", false, ""},
	}
	for _, c := range cases {
		clean, masked, leak := leakedURL(c.raw)
		if leak != c.leak || clean != c.clean {
			t.Errorf("leakedURL(%q) = %q, %v; want %q, %v", c.raw, clean, leak, c.clean, c.leak)
		}
		if leak && (strings.Contains(masked, "pw") || strings.Contains(masked, "ghp_")) {
			t.Errorf("masked %q holds the secret", masked)
		}
	}
}
