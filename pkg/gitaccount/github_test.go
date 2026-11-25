// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package gitaccount

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func TestAddRefusesToken(t *testing.T) {
	cases := []struct {
		name  string
		login string
		token string
		setup func(e *testEnv)
	}{
		{name: "401", login: "work-user", token: "wrong-token"},
		{name: "login mismatch", login: "work-user", token: otherToken},
		{name: "unreachable", login: "work-user", token: workToken, setup: func(e *testEnv) {
			dead := httptest.NewServer(http.NotFoundHandler())
			dead.Close()
			githubAPI = dead.URL
		}},
		{name: "server error", login: "work-user", token: workToken, setup: func(e *testEnv) { e.setStatus(500) }},
		{name: "rate limited", login: "work-user", token: workToken, setup: func(e *testEnv) { e.setStatus(403) }},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			e := newTestEnv(t)
			if c.setup != nil {
				c.setup(e)
			}
			gitconfig := e.readHome(".gitconfig")
			_, err := e.add(c.login, c.token, e.dir("work"), "personal")
			if err == nil {
				t.Fatal("add was accepted")
			}
			if strings.Contains(err.Error(), c.token) {
				t.Errorf("the error holds the token: %v", err)
			}
			if e.exists(storePath()) {
				t.Error("the list was written")
			}
			if e.readHome(".gitconfig") != gitconfig || e.exists(e.home+"/.gitconfig-work-user") {
				t.Error("a config file was written")
			}
			if e.exists(e.creds) {
				t.Error("a refused token left a store entry")
			}
			if e.exists(e.backups) {
				t.Error("a refused add made a backup")
			}
		})
	}
}

func TestAddNameFallsBackToGitHub(t *testing.T) {
	e := newTestEnv(t)
	a, err := Add(context.Background(), wshrpc.CommandGitAccountAddData{Login: "WORK-user", Token: " " + workToken + "\n", Email: "w@example.com", DefaultLogin: "personal"})
	if err != nil {
		t.Fatal(err)
	}
	if a.Login != "work-user" || a.Name != "Work Person" || len(a.Roots) != 0 {
		t.Errorf("account = %+v: want GitHub's login and name, no folder", a)
	}
	if _, err := e.add("work-user", workToken, "", ""); err == nil {
		t.Error("adding the same login twice was accepted")
	}
}

func TestTokenState(t *testing.T) {
	e := newTestEnv(t)
	ctx := context.Background()
	state := func(login string) string {
		t.Helper()
		s, err := TokenState(ctx, login)
		if err != nil {
			t.Fatal(err)
		}
		return s.State
	}
	e.mustAdd("work-user", workToken, "", "personal")

	if got := state("work-user"); got != StateSaved {
		t.Errorf("saved token = %q", got)
	}
	if got := state("nobody"); got != StateMissing {
		t.Errorf("no token = %q", got)
	}
	if err := storeToken(ctx, "stale-user", "stale-token"); err != nil {
		t.Fatal(err)
	}
	if got := state("stale-user"); got != StateRefused {
		t.Errorf("a token GitHub rejects = %q", got)
	}
	// the store holds work-user's token under another login: GitHub accepts it, but it is not that login's
	if err := storeToken(ctx, "other-user", workToken); err != nil {
		t.Fatal(err)
	}
	if got := state("other-user"); got != StateRefused {
		t.Errorf("a token of another login = %q", got)
	}
	e.setStatus(502)
	if got := state("work-user"); got != StateUnreachable {
		t.Errorf("GitHub down = %q", got)
	}
	e.setStatus(0)
	dead := httptest.NewServer(http.NotFoundHandler())
	dead.Close()
	githubAPI = dead.URL
	if got := state("work-user"); got != StateUnreachable {
		t.Errorf("no network = %q", got)
	}
}

func TestSetTokenChecksAndReplaces(t *testing.T) {
	e := newTestEnv(t)
	ctx := context.Background()
	e.mustAdd("work-user", workToken, "", "personal")
	if err := SetToken(ctx, "work-user", otherToken); err == nil {
		t.Error("a token of another login was accepted")
	}
	if tok, _ := e.tokenFor("work-user"); tok != workToken {
		t.Errorf("a refused replace changed the stored token to %q", tok)
	}
	if err := SetToken(ctx, "ghost", workToken); err == nil {
		t.Error("a token for an unknown account was accepted")
	}
	if err := rejectToken(ctx, "work-user"); err != nil {
		t.Fatal(err)
	}
	if err := SetToken(ctx, "work-user", workToken); err != nil {
		t.Fatal(err)
	}
	if tok, ok := e.tokenFor("work-user"); !ok || tok != workToken {
		t.Errorf("stored token = %q, %v", tok, ok)
	}
}

func TestCleanTokenRefusesWhitespace(t *testing.T) {
	if got, err := cleanToken("  abc \n"); err != nil || got != "abc" {
		t.Errorf("cleanToken = %q, %v", got, err)
	}
	for _, bad := range []string{"", "  ", "a b", "a\nusername=evil", "a\x00b"} {
		if _, err := cleanToken(bad); err == nil {
			t.Errorf("cleanToken(%q) was accepted", bad)
		}
	}
}

func TestCheckTokenReturnsUser(t *testing.T) {
	newTestEnv(t)
	u, err := CheckToken(context.Background(), "work-user", workToken)
	if err != nil || u.Login != "work-user" || u.Name != "Work Person" {
		t.Errorf("CheckToken = %+v, %v", u, err)
	}
	if _, err := CheckToken(context.Background(), "other-user", workToken); err == nil {
		t.Error("CheckToken accepted another login")
	}
}
