// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package gitaccount

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// Fix applies the ticked rows. It refuses before touching anything unless the account's token reads back from the
// store and GitHub accepts it, so taking a token out of a URL never breaks the next push. Each row reports its own
// result: one failure does not stop the rest.
func Fix(ctx context.Context, data wshrpc.CommandGitAccountFixData) (*wshrpc.GitAccountFixRtnData, error) {
	if err := checkLogin(data.Login); err != nil {
		return nil, err
	}
	state, err := TokenState(ctx, data.Login)
	if err != nil {
		return nil, err
	}
	switch state.State {
	case StateSaved:
	case StateMissing:
		return nil, fmt.Errorf("No token saved for %s: nothing was changed. Replace its token first", data.Login)
	case StateUnreachable:
		return nil, fmt.Errorf("Couldn't reach GitHub to check the token of %s: nothing was changed (%s)", data.Login, state.Detail)
	default:
		return nil, fmt.Errorf("GitHub refused the token of %s: nothing was changed. Replace its token first", data.Login)
	}

	mu.Lock()
	defer mu.Unlock()
	old, err := load()
	if err != nil {
		return nil, err
	}
	i := old.find(data.Login)
	if i < 0 {
		return nil, fmt.Errorf("no account %s", data.Login)
	}
	a := old.Accounts[i]
	b := &backup{}
	defer b.prune()

	results := []wshrpc.GitFixResultData{}
	for _, p := range data.TokenRepos {
		results = append(results, result("token", p, fixTokenRepo(a, p, b)))
	}
	for _, p := range data.IdentityRepos {
		results = append(results, result("identity", p, fixIdentityRepo(a, p, b)))
	}
	if data.Credentials {
		results = append(results, result("credentials", "", fixCredentials(old, b)))
	}
	return &wshrpc.GitAccountFixRtnData{Results: results}, nil
}

func result(kind, path string, err error) wshrpc.GitFixResultData {
	r := wshrpc.GitFixResultData{Kind: kind, Path: path}
	if err != nil {
		r.Error = err.Error()
	}
	return r
}

// checkRepo refuses a path that is not a repo found under the account's own folders: the request is not trusted to
// name any config on the disk.
func checkRepo(a account, path string) error {
	ok := false
	for _, root := range a.Roots {
		if within(path, root) {
			ok = true
		}
	}
	if !ok {
		return fmt.Errorf("%s is not under a folder of %s", path, a.Login)
	}
	if !isRepo(path) {
		return fmt.Errorf("%s is not a git repo", path)
	}
	return nil
}

func backupRepoConfig(b *backup, repo string) error {
	name := strings.NewReplacer("/", "_", "\\", "_", ":", "_").Replace(filepath.Clean(repo))
	return b.save(filepath.Join("repos", name+".config"), repoConfigPath(repo))
}

func fixTokenRepo(a account, repo string, b *backup) error {
	if err := checkRepo(a, repo); err != nil {
		return err
	}
	leaks, err := repoLeaks(repo)
	if err != nil {
		return err
	}
	if len(leaks) == 0 {
		return nil // fixed since the scan
	}
	if err := backupRepoConfig(b, repo); err != nil {
		return err
	}
	for _, l := range leaks {
		if _, err := runGit("", nil, "", "config", "--file", repoConfigPath(repo), "--fixed-value", "--replace-all", l.key, l.clean, l.url); err != nil {
			return err
		}
	}
	left, err := repoLeaks(repo)
	if err != nil {
		return err
	}
	if len(left) > 0 {
		return errors.New("a remote URL still carries credentials after the rewrite")
	}
	return nil
}

func fixIdentityRepo(a account, repo string, b *backup) error {
	if err := checkRepo(a, repo); err != nil {
		return err
	}
	if err := backupRepoConfig(b, repo); err != nil {
		return err
	}
	for _, key := range []string{"user.name", "user.email"} {
		// exit 5: the key is not set, which is the state wanted
		if _, err := runGit("", nil, "", "config", "--file", repoConfigPath(repo), "--unset-all", key); err != nil && gitExit(err) != 5 {
			return err
		}
	}
	return nil
}

// fixCredentials saves the github.com helpers in effect outside arcterm's block, minus the `store` family, into the
// list (which turns the block's helper reset on) and then drops the github.com lines from ~/.git-credentials. The
// reset goes first: if the file edit then fails, the lines are still there and nothing reads them for github.com.
func fixCredentials(old config, b *backup) error {
	helpers, err := effectiveHelpers(true)
	if err != nil {
		return fmt.Errorf("reading the github.com helpers: %w", err)
	}
	cfg := old.clone()
	cfg.GithubHelpers = keepHelpers(helpers)
	if err := apply(old, cfg, b); err != nil {
		return err
	}
	path, err := credentialsPath()
	if err != nil {
		return err
	}
	raw, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	lines := strings.SplitAfter(string(raw), "\n")
	kept := make([]string, 0, len(lines))
	for _, line := range lines {
		if !githubCredentialLine(line) {
			kept = append(kept, line)
		}
	}
	if len(kept) == len(lines) {
		return nil
	}
	if err := b.save("git-credentials", path); err != nil {
		return err
	}
	if err := writeFileAtomic(path, []byte(strings.Join(kept, "")), 0o600); err != nil {
		return fmt.Errorf("rewriting %s: %w", path, err)
	}
	return nil
}
