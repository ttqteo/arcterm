// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package gitaccount

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const scanDepth = 2

var tokenPrefixes = []string{"ghp_", "gho_", "ghu_", "ghs_", "ghr_", "github_pat_"}

// Scan reads every account's folders: the repos under them, the ones with a token in a remote URL, and the ones whose
// own identity differs from the account's. Nothing is changed.
func Scan() (*wshrpc.GitAccountScanRtnData, error) {
	cfg, err := load()
	if err != nil {
		return nil, err
	}
	rtn := &wshrpc.GitAccountScanRtnData{Accounts: make([]wshrpc.GitAccountScanData, 0, len(cfg.Accounts))}
	for _, a := range cfg.Accounts {
		d := wshrpc.GitAccountScanData{Login: a.Login, TokenRepos: []wshrpc.GitRepoRemoteData{}, IdentityRepos: []wshrpc.GitRepoIdentityData{}}
		seen := map[string]bool{}
		for _, root := range a.Roots {
			repos, err := findRepos(root)
			if err != nil {
				rtn.Errors = append(rtn.Errors, fmt.Sprintf("%s: %v", root, err))
				continue
			}
			for _, repo := range repos {
				if seen[repo] {
					continue
				}
				seen[repo] = true
				d.Repos++
				leaks, err := repoLeaks(repo)
				if err != nil {
					rtn.Errors = append(rtn.Errors, fmt.Sprintf("%s: %v", repo, err))
					continue
				}
				if len(leaks) > 0 {
					names := []string{}
					for _, l := range leaks {
						names = append(names, l.remote)
					}
					d.TokenRepos = append(d.TokenRepos, wshrpc.GitRepoRemoteData{Path: repo, Remote: strings.Join(uniq(names), ", "), MaskedUrl: leaks[0].masked})
				}
				name, email, err := repoIdentity(repo)
				if err != nil {
					rtn.Errors = append(rtn.Errors, fmt.Sprintf("%s: %v", repo, err))
					continue
				}
				if (name != "" && name != a.Name) || (email != "" && !strings.EqualFold(email, a.Email)) {
					d.IdentityRepos = append(d.IdentityRepos, wshrpc.GitRepoIdentityData{Path: repo, Name: name, Email: email})
				}
			}
		}
		rtn.Accounts = append(rtn.Accounts, d)
	}
	n, err := countGithubCredentials()
	if err != nil {
		rtn.Errors = append(rtn.Errors, err.Error())
	}
	rtn.CredentialsLines = n
	return rtn, nil
}

func uniq(in []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, s := range in {
		if !seen[s] {
			seen[s] = true
			out = append(out, s)
		}
	}
	return out
}

func isRepo(dir string) bool {
	st, err := os.Lstat(filepath.Join(dir, ".git"))
	return err == nil && st.IsDir() // a .git file is a worktree or submodule: it shares its main repo's config
}

// findRepos walks the root and two levels below it, skipping node_modules and dot directories. A repo is not entered.
func findRepos(root string) ([]string, error) {
	if _, err := os.Stat(root); err != nil {
		return nil, err
	}
	var repos []string
	var walk func(dir string, depth int)
	walk = func(dir string, depth int) {
		if isRepo(dir) {
			repos = append(repos, dir)
			return
		}
		if depth == scanDepth {
			return
		}
		entries, err := os.ReadDir(dir)
		if err != nil {
			return // a folder git could not look into either
		}
		for _, e := range entries {
			if !e.IsDir() || e.Name() == "node_modules" || strings.HasPrefix(e.Name(), ".") {
				continue
			}
			walk(filepath.Join(dir, e.Name()), depth+1)
		}
	}
	walk(root, 0)
	return repos, nil
}

type leak struct {
	key    string // remote.<name>.url or .pushurl
	remote string
	url    string // as written: holds the token, never logged or returned
	clean  string
	masked string
}

func repoConfigPath(repo string) string { return filepath.Join(repo, ".git", "config") }

func repoLeaks(repo string) ([]leak, error) {
	out, err := runGit("", nil, "", "config", "--file", repoConfigPath(repo), "-z", "--get-regexp", `^remote\..*\.(url|pushurl)$`)
	if gitExit(err) == 1 {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var leaks []leak
	for _, rec := range strings.Split(out, "\x00") {
		key, raw, ok := strings.Cut(rec, "\n")
		if !ok {
			continue
		}
		clean, masked, isLeak := leakedURL(raw)
		if !isLeak {
			continue
		}
		name := strings.TrimPrefix(key, "remote.")
		name = name[:strings.LastIndex(name, ".")]
		leaks = append(leaks, leak{key: key, remote: name, url: raw, clean: clean, masked: masked})
	}
	return leaks, nil
}

func repoIdentity(repo string) (name, email string, err error) {
	get := func(key string) (string, error) {
		out, err := runGit("", nil, "", "config", "--file", repoConfigPath(repo), "--get", key)
		if gitExit(err) == 1 {
			return "", nil
		}
		return strings.TrimSpace(out), err
	}
	if name, err = get("user.name"); err != nil {
		return "", "", err
	}
	email, err = get("user.email")
	return name, email, err
}

// leakedURL says whether an https github.com URL carries a credential: a password, or a username shaped like a GitHub
// token. A plain https://user@github.com is not one. clean is the URL without userinfo, masked the one to show.
func leakedURL(raw string) (clean, masked string, ok bool) {
	const scheme = "https://"
	if len(raw) < len(scheme) || !strings.EqualFold(raw[:len(scheme)], scheme) {
		return "", "", false
	}
	rest := raw[len(scheme):]
	end := strings.IndexAny(rest, "/?#")
	if end < 0 {
		end = len(rest)
	}
	authority, tail := rest[:end], rest[end:]
	at := strings.LastIndex(authority, "@")
	if at < 0 {
		return "", "", false
	}
	host, _, _ := strings.Cut(authority[at+1:], ":")
	if !strings.EqualFold(host, "github.com") {
		return "", "", false
	}
	user, pass, hasPass := strings.Cut(authority[:at], ":")
	if !(hasPass && pass != "") && !tokenShaped(user) {
		return "", "", false
	}
	hostPort := authority[at+1:]
	return raw[:len(scheme)] + hostPort + tail, raw[:len(scheme)] + "•••@" + hostPort + tail, true
}

func tokenShaped(user string) bool {
	for _, p := range tokenPrefixes {
		if strings.HasPrefix(user, p) {
			return true
		}
	}
	return false
}

// ---- ~/.git-credentials ----

func credentialsPath() (string, error) {
	home, err := homeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".git-credentials"), nil
}

func githubCredentialLine(line string) bool {
	u, err := url.Parse(strings.TrimSpace(line))
	return err == nil && strings.EqualFold(u.Hostname(), "github.com")
}

func countGithubCredentials() (int, error) {
	path, err := credentialsPath()
	if err != nil {
		return 0, err
	}
	raw, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	n := 0
	for _, line := range strings.Split(string(raw), "\n") {
		if githubCredentialLine(line) {
			n++
		}
	}
	return n, nil
}
