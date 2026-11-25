// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package gitaccount

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const (
	workToken  = "tok-work"
	otherToken = "tok-other"
)

// testEnv is a throwaway machine: a HOME of its own, no system git config, a `store --file` stand-in for the OS
// credential store, backups in the temp dir and an httptest GitHub that knows two tokens.
type testEnv struct {
	t       *testing.T
	tmp     string
	home    string
	creds   string
	backups string
	api     *httptest.Server
	mu      sync.Mutex
	status  int // 0: answer normally; else the HTTP status for every call
}

func newTestEnv(t *testing.T) *testEnv {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Fatal("these tests run real git: install it")
	}
	tmp, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	e := &testEnv{t: t, tmp: tmp, home: filepath.Join(tmp, "home"), creds: filepath.Join(tmp, "creds"), backups: filepath.Join(tmp, "backups")}
	if err := os.MkdirAll(e.home, 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("HOME", e.home)
	t.Setenv("USERPROFILE", e.home)
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(tmp, "xdg"))
	t.Setenv("GIT_CONFIG_NOSYSTEM", "1")
	for _, k := range []string{"GIT_CONFIG_GLOBAL", "GIT_CONFIG_SYSTEM", "GIT_DIR", "GIT_WORK_TREE"} {
		t.Setenv(k, "")
		os.Unsetenv(k)
	}

	e.api = httptest.NewServer(http.HandlerFunc(e.serveUser))
	t.Cleanup(e.api.Close)

	oldStore, oldBackup, oldHelper, oldAPI := storePath, backupDir, osHelper, githubAPI
	storePath = func() string { return filepath.Join(tmp, "git-accounts.json") }
	backupDir = func() string { return e.backups }
	osHelper = "store --file=" + e.creds
	githubAPI = e.api.URL
	t.Cleanup(func() { storePath, backupDir, osHelper, githubAPI = oldStore, oldBackup, oldHelper, oldAPI })

	e.writeHome(".gitconfig", "[user]\n\tname = Global Person\n\temail = global@example.com\n[credential]\n\thelper = store\n")
	return e
}

func (e *testEnv) serveUser(w http.ResponseWriter, r *http.Request) {
	e.mu.Lock()
	status := e.status
	e.mu.Unlock()
	if status != 0 {
		w.WriteHeader(status)
		return
	}
	users := map[string]wshrpc.GitHubUserData{
		workToken:  {Login: "work-user", Name: "Work Person", Email: "work-public@example.com"},
		otherToken: {Login: "other-user"},
	}
	u, ok := users[strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")]
	if r.URL.Path != "/user" || !ok {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	json.NewEncoder(w).Encode(u)
}

func (e *testEnv) setStatus(code int) {
	e.mu.Lock()
	e.status = code
	e.mu.Unlock()
}

func (e *testEnv) writeHome(name, content string) string {
	e.t.Helper()
	return e.write(filepath.Join(e.home, name), content)
}

func (e *testEnv) write(path, content string) string {
	e.t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		e.t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		e.t.Fatal(err)
	}
	return path
}

func (e *testEnv) read(path string) string {
	e.t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		e.t.Fatal(err)
	}
	return string(raw)
}

func (e *testEnv) readHome(name string) string { return e.read(filepath.Join(e.home, name)) }

func (e *testEnv) exists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

// dir makes a folder under the temp dir and returns its path.
func (e *testEnv) dir(parts ...string) string {
	e.t.Helper()
	p := filepath.Join(append([]string{e.tmp}, parts...)...)
	if err := os.MkdirAll(p, 0o755); err != nil {
		e.t.Fatal(err)
	}
	return p
}

// repo makes a git repo at tmp/<parts>.
func (e *testEnv) repo(parts ...string) string {
	e.t.Helper()
	p := e.dir(parts...)
	e.git(p, "init", "-q")
	return p
}

func (e *testEnv) git(dir string, args ...string) string {
	e.t.Helper()
	out, err := runGit(dir, nil, "", args...)
	if err != nil {
		e.t.Fatalf("git %v: %v", args, err)
	}
	return strings.TrimSpace(out)
}

// gitIn runs git with stdin and returns its output and error.
func (e *testEnv) gitIn(dir, stdin string, args ...string) (string, error) {
	return runGit(dir, nil, stdin, args...)
}

func (e *testEnv) add(login, token, root, defaultLogin string) (*wshrpc.GitAccountData, error) {
	return Add(context.Background(), wshrpc.CommandGitAccountAddData{
		Login: login, Token: token, Email: login + "@example.com", Root: root, DefaultLogin: defaultLogin,
	})
}

func (e *testEnv) mustAdd(login, token, root, defaultLogin string) {
	e.t.Helper()
	if _, err := e.add(login, token, root, defaultLogin); err != nil {
		e.t.Fatalf("add %s: %v", login, err)
	}
}

func wshrpcUpdate(login, name string) wshrpc.CommandGitAccountUpdateData {
	return wshrpc.CommandGitAccountUpdateData{Login: login, Name: name}
}

func countDirs(t *testing.T, dir string) int {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	return len(entries)
}

func (e *testEnv) includeCount() int {
	return strings.Count(e.readHome(".gitconfig"), "[includeIf ")
}

func (e *testEnv) tokenFor(login string) (string, bool) {
	e.t.Helper()
	tok, ok, err := readToken(login)
	if err != nil {
		e.t.Fatal(err)
	}
	return tok, ok
}

func TestIncludeAppliesUnderRoot(t *testing.T) {
	e := newTestEnv(t)
	root := e.dir("work")
	e.mustAdd("work-user", workToken, root, "personal")

	repo := e.repo("work", "a", "b")
	if got := e.git(repo, "config", "user.email"); got != "work-user@example.com" {
		t.Errorf("email under the root = %q", got)
	}
	if got := e.git(repo, "config", "user.name"); got != "Work Person" {
		t.Errorf("name under the root = %q", got)
	}
	out, err := e.gitIn(repo, "protocol=https\nhost=github.com\n\n", "credential", "fill")
	if err != nil {
		t.Fatalf("credential fill under the root: %v", err)
	}
	if !strings.Contains(out, "username=work-user\n") || !strings.Contains(out, "password="+workToken+"\n") {
		t.Errorf("credential fill under the root = %q", out)
	}

	outside := e.repo("elsewhere", "x")
	if got := e.git(outside, "config", "--get-urlmatch", "credential.username", "https://github.com"); got != "personal" {
		t.Errorf("credential.username outside every root = %q", got)
	}
	if got := e.git(outside, "config", "user.email"); got != "global@example.com" {
		t.Errorf("email outside every root = %q", got)
	}
}

func TestRenderRemovesRootAndAccount(t *testing.T) {
	e := newTestEnv(t)
	original := e.readHome(".gitconfig") + "[alias]\n\tco = checkout\n"
	e.writeHome(".gitconfig", original)
	r1, r2 := e.dir("work1"), e.dir("work2")

	e.mustAdd("work-user", workToken, r1, "personal")
	if err := AddRoot("work-user", r2); err != nil {
		t.Fatal(err)
	}
	if n := e.includeCount(); n != 2 {
		t.Fatalf("includes after two roots = %d", n)
	}
	if !strings.HasPrefix(e.readHome(".gitconfig"), original) {
		t.Errorf("the person's lines moved:\n%s", e.readHome(".gitconfig"))
	}

	if err := RemoveRoot("work-user", r2); err != nil {
		t.Fatal(err)
	}
	if n := e.includeCount(); n != 1 {
		t.Errorf("includes after removing a root = %d", n)
	}

	if err := Remove(context.Background(), "work-user"); err != nil {
		t.Fatal(err)
	}
	if got := e.readHome(".gitconfig"); got != original {
		t.Errorf("~/.gitconfig after removing the last account:\n%q\nwant\n%q", got, original)
	}
	if e.exists(filepath.Join(e.home, ".gitconfig-work-user")) {
		t.Error("the account file is still there")
	}
	if _, ok := e.tokenFor("work-user"); ok {
		t.Error("the token is still in the store")
	}
}

func TestRootOverlapRefused(t *testing.T) {
	e := newTestEnv(t)
	outer := e.dir("work")
	inner := e.dir("work", "deep", "er")
	e.mustAdd("work-user", workToken, inner, "personal")

	if _, err := e.add("other-user", otherToken, e.dir("work", "deep", "er", "x"), ""); err == nil {
		t.Error("a root inside another account's root was accepted")
	}
	if _, err := e.add("other-user", otherToken, outer, ""); err == nil {
		t.Error("a root containing another account's root was accepted")
	}
	if _, ok := e.tokenFor("other-user"); ok {
		t.Error("a refused add left a token in the store")
	}
	e.mustAdd("other-user", otherToken, e.dir("side"), "")
	if err := AddRoot("other-user", outer); err == nil {
		t.Error("AddRoot accepted a root containing another account's root")
	}
	if err := AddRoot("other-user", inner); err == nil {
		t.Error("AddRoot accepted another account's root")
	}
	if err := AddRoot("other-user", "relative/path"); err == nil {
		t.Error("AddRoot accepted a relative path")
	}
	if err := AddRoot("other-user", filepath.Join(e.tmp, "nope")); err == nil {
		t.Error("AddRoot accepted a folder that does not exist")
	}
}

func TestRemoveDefaultRefused(t *testing.T) {
	e := newTestEnv(t)
	e.mustAdd("work-user", workToken, e.dir("work"), "work-user")
	before := e.readHome(".gitconfig")

	if err := Remove(context.Background(), "work-user"); err == nil {
		t.Fatal("removing the default login was accepted")
	}
	if e.readHome(".gitconfig") != before || !e.exists(filepath.Join(e.home, ".gitconfig-work-user")) {
		t.Error("a refused remove changed files")
	}
	if tok, ok := e.tokenFor("work-user"); !ok || tok != workToken {
		t.Error("a refused remove touched the token")
	}
	l, err := List()
	if err != nil || len(l.Accounts) != 1 {
		t.Fatalf("list after a refused remove = %+v, %v", l, err)
	}

	if err := SetDefault("personal"); err != nil {
		t.Fatal(err)
	}
	if err := Remove(context.Background(), "work-user"); err != nil {
		t.Fatalf("remove after changing the default: %v", err)
	}
}

func TestRemoveLastRoot(t *testing.T) {
	e := newTestEnv(t)
	root := e.dir("work")
	e.mustAdd("work-user", workToken, root, "personal")
	if err := RemoveRoot("work-user", root); err != nil {
		t.Fatal(err)
	}
	if n := e.includeCount(); n != 0 {
		t.Errorf("includes = %d, want none", n)
	}
	if !e.exists(filepath.Join(e.home, ".gitconfig-work-user")) {
		t.Error("the account file went with its last root")
	}
	if _, ok := e.tokenFor("work-user"); !ok {
		t.Error("the token went with the last root")
	}
	l, err := List()
	if err != nil || len(l.Accounts) != 1 || len(l.Accounts[0].Roots) != 0 || l.Accounts[0].Roots == nil {
		t.Errorf("list = %+v, %v: want the account with an empty, non-nil roots", l, err)
	}
	if err := RemoveRoot("work-user", root); err == nil {
		t.Error("removing a folder the account does not have was accepted")
	}
}

func TestListShowsGlobalIdentityAndHelper(t *testing.T) {
	e := newTestEnv(t)
	e.mustAdd("work-user", workToken, e.dir("work"), "personal")
	l, err := List()
	if err != nil {
		t.Fatal(err)
	}
	if l.DefaultLogin != "personal" || l.GlobalName != "Global Person" || l.GlobalEmail != "global@example.com" || l.DefaultHelper != "store" {
		t.Errorf("list = %+v", l)
	}
	empty := newTestEnv(t)
	empty.writeHome(".gitconfig", "")
	if l, err := List(); err != nil || l.Accounts == nil || len(l.Accounts) != 0 || l.GlobalName != "" {
		t.Errorf("empty list = %+v, %v", l, err)
	}
}

func TestUpdateChangesNameAndEmail(t *testing.T) {
	e := newTestEnv(t)
	root := e.dir("work")
	e.mustAdd("work-user", workToken, root, "personal")
	if err := Update(wshrpc.CommandGitAccountUpdateData{Login: "work-user", Name: "New Name", Email: "new@example.com"}); err != nil {
		t.Fatal(err)
	}
	repo := e.repo("work", "r")
	if got := e.git(repo, "config", "user.name"); got != "New Name" {
		t.Errorf("name = %q", got)
	}
	if err := Update(wshrpc.CommandGitAccountUpdateData{Login: "work-user", Email: "a b"}); err == nil {
		t.Error("an email with a space was accepted")
	}
	if err := Update(wshrpc.CommandGitAccountUpdateData{Login: "ghost", Name: "x"}); err == nil {
		t.Error("updating an unknown account was accepted")
	}
}

func TestFirstAddNeedsDefaultLogin(t *testing.T) {
	e := newTestEnv(t)
	if _, err := e.add("work-user", workToken, e.dir("work"), ""); err == nil {
		t.Fatal("the first add without a default login was accepted")
	}
	if e.exists(storePath()) {
		t.Error("a refused add wrote the list")
	}
	if _, ok := e.tokenFor("work-user"); ok {
		t.Error("a refused add left a token")
	}
	if _, err := e.add("work-user; rm", workToken, "", "personal"); err == nil {
		t.Error("a login with odd characters was accepted")
	}
}
