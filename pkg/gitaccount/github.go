// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package gitaccount

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const (
	StateSaved       = "saved"
	StateRefused     = "refused"
	StateMissing     = "missing"
	StateUnreachable = "unreachable"
	apiTimeout       = 10 * time.Second
)

var (
	errRefused     = errors.New("GitHub refused the token")
	errUnreachable = errors.New("couldn't reach GitHub")
)

// cleanToken trims the pasted token and refuses anything that is not one word: the token goes to git on stdin as a
// line of the credential protocol, and a newline in it would add fields.
func cleanToken(token string) (string, error) {
	token = strings.TrimSpace(token)
	if token == "" {
		return "", errors.New("paste a token")
	}
	if strings.IndexFunc(token, func(r rune) bool { return r <= ' ' || r == 0x7f }) >= 0 {
		return "", errors.New("that is not a token: it has spaces or line breaks in it")
	}
	return token, nil
}

// apiUser asks GitHub who the token belongs to. 401 is errRefused; offline, 5xx, a rate limit are errUnreachable.
func apiUser(ctx context.Context, token string) (*wshrpc.GitHubUserData, error) {
	ctx, cancel := context.WithTimeout(ctx, apiTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, githubAPI+"/user", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	req.Header.Set("User-Agent", "arcterm")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", errUnreachable, err)
	}
	defer resp.Body.Close()
	switch {
	case resp.StatusCode == http.StatusOK:
	case resp.StatusCode == http.StatusUnauthorized:
		return nil, errRefused
	default:
		return nil, fmt.Errorf("%w: HTTP %d", errUnreachable, resp.StatusCode)
	}
	var user wshrpc.GitHubUserData
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&user); err != nil {
		return nil, fmt.Errorf("%w: unreadable answer: %v", errUnreachable, err)
	}
	return &user, nil
}

// checkToken is apiUser plus the rule that the token belongs to the login being added.
func checkToken(ctx context.Context, login, token string) (*wshrpc.GitHubUserData, error) {
	user, err := apiUser(ctx, token)
	if err != nil {
		return nil, err
	}
	if !strings.EqualFold(user.Login, login) {
		return nil, fmt.Errorf("that token belongs to %s, not %s", user.Login, login)
	}
	return user, nil
}

// CheckToken asks GitHub who the token belongs to and stores nothing.
func CheckToken(ctx context.Context, login, token string) (*wshrpc.GitHubUserData, error) {
	if err := checkLogin(login); err != nil {
		return nil, err
	}
	token, err := cleanToken(token)
	if err != nil {
		return nil, err
	}
	return checkToken(ctx, login, token)
}

// ---- the OS credential store ----

// credentialArgs makes every store call name its own helper: the empty value first resets whatever the global config
// set (store, gh), so a token arcterm stores never reaches a plain-text file.
func credentialArgs(op string) []string {
	return []string{"-c", "credential.helper=", "-c", "credential.helper=" + osHelper, "credential", op}
}

func credentialInput(login, token string) string {
	in := "protocol=https\nhost=github.com\nusername=" + login + "\n"
	if token != "" {
		in += "password=" + token + "\n"
	}
	return in + "\n"
}

func homeRun(stdin string, args ...string) (string, error) {
	home, err := homeDir()
	if err != nil {
		return "", err
	}
	return runGit(home, nil, stdin, args...)
}

func storeToken(_ context.Context, login, token string) error {
	if _, err := homeRun(credentialInput(login, token), credentialArgs("approve")...); err != nil {
		return fmt.Errorf("storing the token for %s: %w", login, err)
	}
	return nil
}

func rejectToken(_ context.Context, login string) error {
	if _, err := homeRun(credentialInput(login, ""), credentialArgs("reject")...); err != nil {
		return fmt.Errorf("removing the token of %s from the credential store: %w", login, err)
	}
	return nil
}

// readToken reads the token back with prompts off. A store with no entry makes fill fail (it would have asked), which
// is "missing"; a git that cannot run at all is an error.
func readToken(login string) (string, bool, error) {
	out, err := homeRun(credentialInput(login, ""), credentialArgs("fill")...)
	if err != nil {
		if gitExit(err) > 0 {
			return "", false, nil
		}
		return "", false, err
	}
	for _, line := range strings.Split(out, "\n") {
		if v, ok := strings.CutPrefix(strings.TrimRight(line, "\r"), "password="); ok && v != "" {
			return v, true, nil
		}
	}
	return "", false, nil
}

// TokenState reads the token back and asks GitHub about it, holding it only for that call.
func TokenState(ctx context.Context, login string) (*wshrpc.GitAccountTokenStateData, error) {
	if err := checkLogin(login); err != nil {
		return nil, err
	}
	token, ok, err := readToken(login)
	if err != nil {
		return nil, err
	}
	if !ok {
		return &wshrpc.GitAccountTokenStateData{State: StateMissing}, nil
	}
	_, err = checkToken(ctx, login, token)
	switch {
	case err == nil:
		return &wshrpc.GitAccountTokenStateData{State: StateSaved}, nil
	case errors.Is(err, errUnreachable):
		return &wshrpc.GitAccountTokenStateData{State: StateUnreachable, Detail: err.Error()}, nil
	default: // refused, or a token that belongs to another login
		return &wshrpc.GitAccountTokenStateData{State: StateRefused, Detail: err.Error()}, nil
	}
}

// SetToken replaces an account's token after the same check as Add.
func SetToken(ctx context.Context, login, token string) error {
	token, err := cleanToken(token)
	if err != nil {
		return err
	}
	cfg, err := load()
	if err != nil {
		return err
	}
	i := cfg.find(login)
	if i < 0 {
		return fmt.Errorf("no account %s", login)
	}
	if _, err := checkToken(ctx, cfg.Accounts[i].Login, token); err != nil {
		return err
	}
	mu.Lock()
	defer mu.Unlock()
	return storeToken(ctx, cfg.Accounts[i].Login, token)
}
