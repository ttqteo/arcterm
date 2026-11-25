// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package gitaccount

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestAccountFileBackupWhenForeign(t *testing.T) {
	e := newTestEnv(t)
	e.writeHome(".gitconfig-work-user", "[user]\n\tname = Mine\n")
	e.mustAdd("work-user", workToken, "", "personal")

	if got := e.readHome(".gitconfig-work-user"); !strings.HasPrefix(got, accountHeader+"\n") || !strings.Contains(got, "work-user@example.com") {
		t.Errorf("account file = %q", got)
	}
	var found string
	filepath.Walk(e.backups, func(p string, info os.FileInfo, err error) error {
		if err == nil && info.Name() == "gitconfig-work-user" {
			found = p
		}
		return nil
	})
	if found == "" {
		t.Fatal("the foreign file was not backed up")
	}
	if got := e.read(found); got != "[user]\n\tname = Mine\n" {
		t.Errorf("backup = %q", got)
	}

	// an arcterm-written file is replaced without a second backup folder
	before := countDirs(t, e.backups)
	if err := SetDefault("other-person"); err != nil {
		t.Fatal(err)
	}
	if err := Update(wshrpcUpdate("work-user", "Renamed")); err != nil {
		t.Fatal(err)
	}
	if after := countDirs(t, e.backups); after != before+1 { // the SetDefault rewrite of ~/.gitconfig only
		t.Errorf("backup folders went from %d to %d", before, after)
	}
}

func TestSymlinkedGitconfigKeepsItsLink(t *testing.T) {
	e := newTestEnv(t)
	target := e.write(filepath.Join(e.tmp, "dotfiles", "gitconfig"), e.readHome(".gitconfig"))
	if err := os.Remove(filepath.Join(e.home, ".gitconfig")); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, filepath.Join(e.home, ".gitconfig")); err != nil {
		t.Skip("cannot make symlinks here")
	}
	e.mustAdd("work-user", workToken, e.dir("work"), "personal")
	if st, err := os.Lstat(filepath.Join(e.home, ".gitconfig")); err != nil || st.Mode()&os.ModeSymlink == 0 {
		t.Error("~/.gitconfig stopped being a symlink")
	}
	if !strings.Contains(e.read(target), blockBegin) {
		t.Error("the block did not reach the link's target")
	}
}

func TestBrokenBlockIsRefusedNotCut(t *testing.T) {
	e := newTestEnv(t)
	broken := e.readHome(".gitconfig") + blockBegin + "\n[alias]\n\tco = checkout\n"
	e.writeHome(".gitconfig", broken)
	if _, err := e.add("work-user", workToken, "", "personal"); err == nil {
		t.Fatal("a ~/.gitconfig with a begin marker and no end was rewritten")
	}
	if e.readHome(".gitconfig") != broken {
		t.Error("the person's lines were changed")
	}
	if l, err := List(); err != nil || len(l.Accounts) != 0 {
		t.Errorf("the list was kept after a failed render: %+v, %v", l, err)
	}
	if _, ok := e.tokenFor("work-user"); ok {
		t.Error("the token was kept after a failed add")
	}
}

func TestKeepHelpers(t *testing.T) {
	cases := []struct {
		name string
		in   []string
		want []string
	}{
		{"none", nil, []string{}},
		{"store dropped", []string{"store", "!gh auth git-credential"}, []string{"!gh auth git-credential"}},
		{"reset in order", []string{"store", "", "manager", "store --file=/x", "osxkeychain"}, []string{"manager", "osxkeychain"}},
		{"reset last", []string{"osxkeychain", ""}, []string{}},
		{"store paths", []string{"/usr/lib/git-core/git-credential-store", "credential-store --file x", "cache"}, []string{"cache"}},
	}
	for _, c := range cases {
		if got := keepHelpers(c.in); !reflect.DeepEqual(got, c.want) {
			t.Errorf("%s: keepHelpers(%q) = %q, want %q", c.name, c.in, got, c.want)
		}
	}
	for h, want := range map[string]string{
		"!gh auth git-credential": "gh", "osxkeychain": "osxkeychain", "manager": "manager",
		`C:\Program Files\Git\git-credential-manager.exe get`: "manager", "": "",
	} {
		if got := helperName(h); got != want {
			t.Errorf("helperName(%q) = %q, want %q", h, got, want)
		}
	}
}

func TestStripBlockText(t *testing.T) {
	block := blockBegin + "\n[x]\n" + blockEnd + "\n"
	got, found, err := stripBlockText("a\r\n" + block + "b\n")
	if err != nil || !found || got != "a\r\nb\n" {
		t.Errorf("strip = %q, %v, %v", got, found, err)
	}
	if got, found, err := stripBlockText("a\nb"); err != nil || found || got != "a\nb" {
		t.Errorf("strip without a block = %q, %v, %v", got, found, err)
	}
}

func TestBlockHelperResetOnlyAfterFix(t *testing.T) {
	cfg := config{DefaultLogin: "me", Accounts: []account{{Login: "w", Roots: []string{"/r/one"}}}}
	if text := blockText(cfg, "/home/u"); strings.Contains(text, "helper =") || !strings.Contains(text, `username = "me"`) ||
		!strings.Contains(text, `[includeIf "gitdir/i:/r/one/"]`) || !strings.Contains(text, `path = "/home/u/.gitconfig-w"`) {
		t.Errorf("block before Fix:\n%s", text)
	}
	cfg.GithubHelpers = []string{"!gh auth git-credential"}
	text := blockText(cfg, "/home/u")
	reset := strings.Index(text, "helper =\n")
	restored := strings.Index(text, `helper = "!gh auth git-credential"`)
	user := strings.Index(text, "username")
	include := strings.Index(text, "[includeIf")
	if !(reset >= 0 && reset < restored && restored < user && user < include) {
		t.Errorf("block after Fix has the wrong order:\n%s", text)
	}
	cfg.GithubHelpers = []string{}
	if text := blockText(cfg, "/home/u"); !strings.Contains(text, "helper =\n") || strings.Contains(text, "helper = \"") {
		t.Errorf("a reset with nothing to restore:\n%s", text)
	}
}

func TestGitConfigValuesAreQuoted(t *testing.T) {
	e := newTestEnv(t)
	root := e.dir("work")
	e.mustAdd("work-user", workToken, root, "personal")
	if err := Update(wshrpcUpdate("work-user", `Dr. "Q" \ #Person`)); err != nil {
		t.Fatal(err)
	}
	repo := e.repo("work", "r")
	if got := e.git(repo, "config", "user.name"); got != `Dr. "Q" \ #Person` {
		t.Errorf("name = %q", got)
	}
}
