// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package claudeaccount

import (
	"context"
	"errors"
	"log"
	"net/http"
	"regexp"
	"strings"
	"time"
	"unicode"
)

// inside the add RPC's default 5s, so a slow check lets the token through rather than timing the call out
// while the account is added anyway
const checkTimeout = 4 * time.Second

// swapped by tests
var checkEndpoint = "https://api.anthropic.com/v1/messages"

var tokenRe = regexp.MustCompile(`sk-ant-oat[0-9]+-[A-Za-z0-9_-]+`)

// NormalizeToken takes the token out of what was pasted. A token holds no whitespace, but one copied from a
// terminal can: claude setup-token prints it with a one-column margin, so a wrapped one comes back with a
// line break and the next row's margin in the middle, and a copy may take some of the text around it.
// A value with no setup-token in it is returned trimmed, for Add to refuse.
func NormalizeToken(s string) string {
	joined := strings.Map(func(r rune) rune {
		if unicode.IsSpace(r) {
			return -1
		}
		return r
	}, s)
	if m := tokenRe.FindString(joined); m != "" {
		return m
	}
	return strings.TrimSpace(s)
}

// CheckToken asks the Messages API whether it accepts token, so a token cut short or mistyped is refused
// when it is added instead of failing every claude run afterwards with a 401. The request has an empty
// body: a token the API accepts gets 400 for the body, one it rejects gets 401, and nothing is generated,
// so no quota is spent. (The usage endpoint can't serve: it answered 429, not 401, for a cut-off token.)
// Only a 401 is an error; a check that cannot decide (offline, rate limit, outage) lets the token through.
func CheckToken(ctx context.Context, token string) error {
	ctx, cancel := context.WithTimeout(ctx, checkTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, checkEndpoint, strings.NewReader("{}"))
	if err != nil {
		return nil
	}
	req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(token))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("anthropic-version", "2023-06-01")
	req.Header.Set("anthropic-beta", "oauth-2025-04-20")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		log.Printf("claude account: could not check the token, adding it unchecked: %v\n", err)
		return nil
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusUnauthorized {
		// the shape only, never the token: a real one is 108 characters ending in AA
		t := strings.TrimSpace(token)
		log.Printf("claude account: token refused (401), %d characters, ends %q\n", len(t), t[max(0, len(t)-2):])
		return errors.New("Claude refused this token (401): it is wrong or was cut short. Run claude setup-token again and add it again")
	}
	return nil
}
