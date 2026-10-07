// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package claudequota reads the Claude account's rate-limit windows (5-hour, weekly) with no claude
// session running: from Anthropic's usage endpoint, asked with the OAuth token Claude Code stored,
// else from the copy of that answer Claude Code caches in its config file. A session only learns
// its windows from its first response, so without this the cockpit knew nothing until one ran.
//
// The token is read, never refreshed: rotating it would sign Claude Code out. An expired one is
// left for Claude Code to refresh on its next run, and the cache answers until then.
package claudequota

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	usageEndpoint = "https://api.anthropic.com/api/oauth/usage"
	// the endpoint is rate-limited, and every window of the app asks: one call per interval answers all
	minInterval  = 5 * time.Minute
	firstBackoff = 10 * time.Minute
	maxBackoff   = time.Hour
	fetchTimeout = 10 * time.Second
	// a live answer this recent outranks Claude Code's cached copy, however new the copy is
	liveFreshness = time.Hour
	// a token this close to expiring is treated as expired
	expirySlack = time.Minute
)

const (
	SourceLive  = "live"  // the endpoint answered
	SourceCache = "cache" // Claude Code's cached copy of an earlier answer
)

// Quota is the account's two windows as of CapturedAt; a nil pct is a window the answer left out.
type Quota struct {
	FiveHourPct   *float64
	FiveHourReset *int64 // epoch seconds
	WeekPct       *float64
	WeekReset     *int64 // epoch seconds
	CapturedAt    time.Time
	Source        string
}

type usageWindow struct {
	Utilization *float64 `json:"utilization"`
	ResetsAt    string   `json:"resets_at"`
}

// the endpoint's answer, and the `utilization` Claude Code caches; only the two windows are read
type usageBody struct {
	FiveHour *usageWindow `json:"five_hour"`
	SevenDay *usageWindow `json:"seven_day"`
}

type credentialsFile struct {
	ClaudeAiOauth *struct {
		AccessToken string `json:"accessToken"`
		ExpiresAt   int64  `json:"expiresAt"` // epoch ms
	} `json:"claudeAiOauth"`
}

type configFile struct {
	CachedUsageUtilization *struct {
		FetchedAtMs int64     `json:"fetchedAtMs"`
		Utilization usageBody `json:"utilization"`
	} `json:"cachedUsageUtilization"`
	// the account /login stored
	OauthAccount *struct {
		EmailAddress string `json:"emailAddress"`
	} `json:"oauthAccount"`
}

type rateLimitedError struct {
	retryAfter time.Duration
}

func (e *rateLimitedError) Error() string {
	return fmt.Sprintf("usage endpoint rate-limited (retry after %s)", e.retryAfter)
}

// Reader keeps the last live answer and when the endpoint may be asked again.
type Reader struct {
	endpoint string
	client   *http.Client
	now      func() time.Time
	// the credentials file and the config file holding the cache
	paths func() (credentials string, config string, err error)

	// held across a fetch, so callers asking at once make one call
	mu      sync.Mutex
	live    *Quota
	nextTry time.Time
	backoff time.Duration
	// when the endpoint's last 429 lets it be asked again; zero once an answer came
	limitedUntil time.Time
}

var defaultReader = &Reader{
	endpoint: usageEndpoint,
	client:   &http.Client{Timeout: fetchTimeout},
	now:      time.Now,
	paths:    defaultPaths,
}

// Get answers the reading to show: a live one, asking the endpoint when the interval allows, or the
// cached one. nil when neither exists.
func Get(ctx context.Context) *Quota {
	return defaultReader.Get(ctx)
}

func (r *Reader) Get(ctx context.Context) *Quota {
	r.mu.Lock()
	defer r.mu.Unlock()
	now := r.now()
	if !now.Before(r.nextTry) {
		r.tryFetch(ctx, now)
	}
	return r.best(now)
}

// Refresh asks the endpoint now, whatever the interval since the last ask, and answers as Get does.
// A 429 backoff is not an interval: while one holds, the endpoint is not asked and retryAt says when it
// may be (zero otherwise, also when the ask was itself refused with a 429, which sets a new backoff).
func Refresh(ctx context.Context) (q *Quota, retryAt time.Time) {
	return defaultReader.Refresh(ctx)
}

func (r *Reader) Refresh(ctx context.Context) (q *Quota, retryAt time.Time) {
	r.mu.Lock()
	defer r.mu.Unlock()
	now := r.now()
	if !now.Before(r.limitedUntil) {
		r.tryFetch(ctx, now)
	}
	if now.Before(r.limitedUntil) {
		retryAt = r.limitedUntil
	}
	return r.best(now), retryAt
}

// the live reading while it is recent, since the cache may have been written by a session on another
// account; else the newer of the two
func (r *Reader) best(now time.Time) *Quota {
	if r.live != nil && now.Sub(r.live.CapturedAt) < liveFreshness {
		return r.live
	}
	return newer(r.live, r.cached())
}

func (r *Reader) tryFetch(ctx context.Context, now time.Time) {
	r.nextTry = now.Add(minInterval)
	token := r.token(now)
	if token == "" {
		return
	}
	body, err := r.fetch(ctx, token)
	if limited, ok := err.(*rateLimitedError); ok {
		r.backoff = min(max(2*r.backoff, firstBackoff), maxBackoff)
		r.nextTry = now.Add(max(r.backoff, limited.retryAfter))
		r.limitedUntil = r.nextTry
		log.Printf("claudequota: %v; next try at %s\n", err, r.nextTry.Format(time.RFC3339))
		return
	}
	if err != nil {
		log.Printf("claudequota: %v\n", err)
		return
	}
	r.backoff = 0
	r.limitedUntil = time.Time{}
	r.live = quotaFrom(body, now, SourceLive)
}

// the stored access token, or "" when there is none or it has expired
func (r *Reader) token(now time.Time) string {
	credPath, _, err := r.paths()
	if err != nil {
		return ""
	}
	raw, err := os.ReadFile(credPath)
	if err != nil {
		return ""
	}
	var creds credentialsFile
	if err := json.Unmarshal(raw, &creds); err != nil || creds.ClaudeAiOauth == nil {
		return ""
	}
	oauth := creds.ClaudeAiOauth
	if oauth.ExpiresAt != 0 && !now.Add(expirySlack).Before(time.UnixMilli(oauth.ExpiresAt)) {
		return ""
	}
	return oauth.AccessToken
}

func (r *Reader) fetch(ctx context.Context, token string) (usageBody, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, r.endpoint, nil)
	if err != nil {
		return usageBody{}, fmt.Errorf("building usage request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("anthropic-beta", "oauth-2025-04-20")
	resp, err := r.client.Do(req)
	if err != nil {
		return usageBody{}, fmt.Errorf("usage request failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusTooManyRequests {
		secs, _ := strconv.Atoi(resp.Header.Get("Retry-After"))
		return usageBody{}, &rateLimitedError{retryAfter: time.Duration(secs) * time.Second}
	}
	if resp.StatusCode != http.StatusOK {
		return usageBody{}, fmt.Errorf("usage endpoint answered %d", resp.StatusCode)
	}
	var body usageBody
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&body); err != nil {
		return usageBody{}, fmt.Errorf("decoding usage answer: %w", err)
	}
	return body, nil
}

// Claude Code's cached copy, as of when it fetched it; nil when it keeps none
func (r *Reader) cached() *Quota {
	_, configPath, err := r.paths()
	if err != nil {
		return nil
	}
	raw, err := os.ReadFile(configPath)
	if err != nil {
		return nil
	}
	var cfg configFile
	if err := json.Unmarshal(raw, &cfg); err != nil || cfg.CachedUsageUtilization == nil {
		return nil
	}
	c := cfg.CachedUsageUtilization
	return quotaFrom(c.Utilization, time.UnixMilli(c.FetchedAtMs), SourceCache)
}

// LoginEmail is the email of the account `/login` stored, lowercased; "" when it is not known.
func LoginEmail() string {
	return defaultReader.loginEmail()
}

func (r *Reader) loginEmail() string {
	_, configPath, err := r.paths()
	if err != nil {
		return ""
	}
	raw, err := os.ReadFile(configPath)
	if err != nil {
		return ""
	}
	var cfg configFile
	if err := json.Unmarshal(raw, &cfg); err != nil || cfg.OauthAccount == nil {
		return ""
	}
	return strings.ToLower(strings.TrimSpace(cfg.OauthAccount.EmailAddress))
}

// nil when the answer carries neither window
func quotaFrom(body usageBody, at time.Time, source string) *Quota {
	q := &Quota{CapturedAt: at, Source: source}
	q.FiveHourPct, q.FiveHourReset = readWindow(body.FiveHour)
	q.WeekPct, q.WeekReset = readWindow(body.SevenDay)
	if q.FiveHourPct == nil && q.WeekPct == nil {
		return nil
	}
	return q
}

func readWindow(w *usageWindow) (*float64, *int64) {
	if w == nil || w.Utilization == nil {
		return nil, nil
	}
	resetsAt, err := time.Parse(time.RFC3339Nano, w.ResetsAt)
	if err != nil {
		return w.Utilization, nil
	}
	reset := resetsAt.Unix()
	return w.Utilization, &reset
}

func newer(a, b *Quota) *Quota {
	if a == nil {
		return b
	}
	if b == nil || !b.CapturedAt.After(a.CapturedAt) {
		return a
	}
	return b
}

// mirrors Claude Code's own resolution, as jarvis.defaultClaudeConfigPath does: the credentials sit in
// the config dir (CLAUDE_CONFIG_DIR, else ~/.claude); the config file is <config dir>/.config.json when
// it exists, else .claude.json under CLAUDE_CONFIG_DIR or the home dir
func defaultPaths() (string, string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", "", fmt.Errorf("resolving home dir: %w", err)
	}
	override := os.Getenv("CLAUDE_CONFIG_DIR")
	configDir := override
	if configDir == "" {
		configDir = filepath.Join(home, ".claude")
	}
	credentials := filepath.Join(configDir, ".credentials.json")
	if alt := filepath.Join(configDir, ".config.json"); fileExists(alt) {
		return credentials, alt, nil
	}
	if override != "" {
		return credentials, filepath.Join(override, ".claude.json"), nil
	}
	return credentials, filepath.Join(home, ".claude.json"), nil
}

func fileExists(path string) bool {
	st, err := os.Stat(path)
	return err == nil && !st.IsDir()
}
