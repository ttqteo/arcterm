// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package claudequota

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"testing"
	"time"
)

const liveBody = `{"five_hour":{"utilization":50,"resets_at":"2026-10-06T06:59:59.919223+00:00"},` +
	`"seven_day":{"utilization":41.5,"resets_at":"2026-10-11T12:59:59.919243+00:00"},"limits":[]}`

const cacheFile = `{"numStartups":3,"cachedUsageUtilization":{"fetchedAtMs":1759660115928,"accountUuid":"a",` +
	`"utilization":{"five_hour":{"utilization":20,"resets_at":"2026-10-05T14:40:00.348343+00:00"},` +
	`"seven_day":{"utilization":3,"resets_at":"2026-10-11T13:00:00.348368+00:00"}}}}`

type fixture struct {
	reader *Reader
	calls  int
	status int
	header http.Header
	auth   string
	now    time.Time
}

// a reader over a temp config dir and a test server standing in for the endpoint
func newFixture(t *testing.T, credentials, config string) *fixture {
	t.Helper()
	dir := t.TempDir()
	if credentials != "" {
		if err := os.WriteFile(filepath.Join(dir, ".credentials.json"), []byte(credentials), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	configPath := filepath.Join(dir, "claude.json")
	if config != "" {
		if err := os.WriteFile(configPath, []byte(config), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	f := &fixture{status: http.StatusOK, now: time.Date(2026, 10, 6, 3, 0, 0, 0, time.UTC)}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.calls++
		f.auth = r.Header.Get("Authorization")
		for k, v := range f.header {
			w.Header()[k] = v
		}
		w.WriteHeader(f.status)
		if f.status == http.StatusOK {
			_, _ = w.Write([]byte(liveBody))
		}
	}))
	t.Cleanup(srv.Close)
	f.reader = &Reader{
		endpoint: srv.URL,
		client:   srv.Client(),
		now:      func() time.Time { return f.now },
		paths: func() (string, string, error) {
			return filepath.Join(dir, ".credentials.json"), configPath, nil
		},
	}
	return f
}

func token(expiresAt time.Time) string {
	return `{"claudeAiOauth":{"accessToken":"tok-1","refreshToken":"never-used","expiresAt":` +
		strconv.FormatInt(expiresAt.UnixMilli(), 10) + `}}`
}

func TestLiveReadingFromTheEndpoint(t *testing.T) {
	f := newFixture(t, token(time.Date(2026, 10, 6, 10, 0, 0, 0, time.UTC)), "")
	q := f.reader.Get(context.Background())
	if q == nil || q.Source != SourceLive {
		t.Fatalf("want a live reading, got %+v", q)
	}
	if f.auth != "Bearer tok-1" {
		t.Errorf("authorization = %q", f.auth)
	}
	if *q.FiveHourPct != 50 || *q.WeekPct != 41.5 {
		t.Errorf("pcts = %v, %v", *q.FiveHourPct, *q.WeekPct)
	}
	if *q.FiveHourReset != time.Date(2026, 10, 6, 6, 59, 59, 0, time.UTC).Unix() {
		t.Errorf("five-hour reset = %v", *q.FiveHourReset)
	}
	if !q.CapturedAt.Equal(f.now) {
		t.Errorf("captured at %v, want %v", q.CapturedAt, f.now)
	}
}

func TestOneCallPerInterval(t *testing.T) {
	f := newFixture(t, token(time.Date(2026, 10, 6, 10, 0, 0, 0, time.UTC)), "")
	f.reader.Get(context.Background())
	f.now = f.now.Add(minInterval - time.Second)
	if q := f.reader.Get(context.Background()); q == nil || q.Source != SourceLive {
		t.Fatalf("want the kept live reading, got %+v", q)
	}
	if f.calls != 1 {
		t.Fatalf("calls = %d within the interval, want 1", f.calls)
	}
	f.now = f.now.Add(time.Second)
	f.reader.Get(context.Background())
	if f.calls != 2 {
		t.Fatalf("calls = %d after the interval, want 2", f.calls)
	}
}

func TestRateLimitedBacksOffAndFallsBackToTheCache(t *testing.T) {
	f := newFixture(t, token(time.Date(2026, 10, 6, 10, 0, 0, 0, time.UTC)), cacheFile)
	f.status = http.StatusTooManyRequests
	f.header = http.Header{"Retry-After": []string{"1800"}}
	q := f.reader.Get(context.Background())
	if q == nil || q.Source != SourceCache || *q.FiveHourPct != 20 {
		t.Fatalf("want the cached reading, got %+v", q)
	}
	if q.CapturedAt.UnixMilli() != 1759660115928 {
		t.Errorf("cache captured at %v", q.CapturedAt.UnixMilli())
	}
	f.status = http.StatusOK
	f.now = f.now.Add(29 * time.Minute)
	f.reader.Get(context.Background())
	if f.calls != 1 {
		t.Fatalf("calls = %d inside Retry-After, want 1", f.calls)
	}
	f.now = f.now.Add(time.Minute)
	if q := f.reader.Get(context.Background()); q == nil || q.Source != SourceLive {
		t.Fatalf("want a live reading once the backoff passed, got %+v", q)
	}
}

func TestExpiredTokenIsNeverSent(t *testing.T) {
	f := newFixture(t, token(time.Date(2026, 10, 6, 2, 0, 0, 0, time.UTC)), cacheFile)
	q := f.reader.Get(context.Background())
	if f.calls != 0 {
		t.Fatalf("calls = %d with an expired token, want 0", f.calls)
	}
	if q == nil || q.Source != SourceCache {
		t.Fatalf("want the cached reading, got %+v", q)
	}
}

func TestNothingKnown(t *testing.T) {
	f := newFixture(t, "", "")
	if q := f.reader.Get(context.Background()); q != nil {
		t.Fatalf("want nil, got %+v", q)
	}
	if f.calls != 0 {
		t.Fatalf("calls = %d without credentials, want 0", f.calls)
	}
}

func TestNewerOfLiveAndCache(t *testing.T) {
	f := newFixture(t, token(time.Date(2026, 10, 6, 10, 0, 0, 0, time.UTC)), cacheFile)
	if q := f.reader.Get(context.Background()); q == nil || q.Source != SourceLive {
		t.Fatalf("want the live reading over an older cache, got %+v", q)
	}
}

func TestLoginEmailFromTheConfigFile(t *testing.T) {
	cfg := `{"numStartups":3,"oauthAccount":{"accountUuid":"u","emailAddress":"  Mozox@Example.COM ","displayName":"M"}}`
	f := newFixture(t, "", cfg)
	if got := f.reader.loginEmail(); got != "mozox@example.com" {
		t.Fatalf("login email = %q", got)
	}
}

func TestLoginEmailEmptyWhenUnknown(t *testing.T) {
	for name, cfg := range map[string]string{
		"no file":        "",
		"no account":     `{"numStartups":3}`,
		"no email":       `{"oauthAccount":{"accountUuid":"u"}}`,
		"not json":       `{oops`,
		"cache only":     cacheFile,
		"email wrong ty": `{"oauthAccount":{"emailAddress":5}}`,
	} {
		f := newFixture(t, "", cfg)
		if got := f.reader.loginEmail(); got != "" {
			t.Errorf("%s: login email = %q, want empty", name, got)
		}
	}
	r := &Reader{paths: func() (string, string, error) { return "", "", os.ErrNotExist }}
	if got := r.loginEmail(); got != "" {
		t.Errorf("paths error: login email = %q", got)
	}
}

// Claude Code's cached copy is written by any session on any account, so a live answer from the last
// hour outranks it even when the copy is newer; an older live answer does not
func TestLiveWithinTheHourBeatsANewerCache(t *testing.T) {
	cacheAt := time.Date(2026, 10, 6, 3, 1, 0, 0, time.UTC)
	cache := `{"cachedUsageUtilization":{"fetchedAtMs":` + strconv.FormatInt(cacheAt.UnixMilli(), 10) +
		`,"utilization":{"five_hour":{"utilization":20,"resets_at":"2026-10-05T14:40:00+00:00"}}}}`
	f := newFixture(t, token(time.Date(2026, 10, 6, 10, 0, 0, 0, time.UTC)), cache)
	if q := f.reader.Get(context.Background()); q == nil || q.Source != SourceLive || *q.FiveHourPct != 50 {
		t.Fatalf("want the live reading over a newer cache, got %+v", q)
	}
	f.now = f.now.Add(2 * time.Minute)
	if q := f.reader.Get(context.Background()); q == nil || q.Source != SourceLive {
		t.Fatalf("want the kept live reading, got %+v", q)
	}
}

func TestLiveOlderThanAnHourLosesToANewerCache(t *testing.T) {
	cacheAt := time.Date(2026, 10, 6, 4, 30, 0, 0, time.UTC)
	cache := `{"cachedUsageUtilization":{"fetchedAtMs":` + strconv.FormatInt(cacheAt.UnixMilli(), 10) +
		`,"utilization":{"five_hour":{"utilization":20,"resets_at":"2026-10-05T14:40:00+00:00"}}}}`
	f := newFixture(t, token(time.Date(2026, 10, 6, 10, 0, 0, 0, time.UTC)), cache)
	f.reader.Get(context.Background())
	f.status = http.StatusInternalServerError
	f.now = f.now.Add(time.Hour + time.Minute)
	if q := f.reader.Get(context.Background()); q == nil || q.Source != SourceCache {
		t.Fatalf("want the newer cache once the live reading is over an hour old, got %+v", q)
	}
}

func TestRefreshAsksAgainInsideTheInterval(t *testing.T) {
	f := newFixture(t, token(time.Date(2026, 10, 6, 10, 0, 0, 0, time.UTC)), "")
	f.reader.Get(context.Background())
	f.now = f.now.Add(time.Second)
	q, retryAt := f.reader.Refresh(context.Background())
	if f.calls != 2 {
		t.Fatalf("calls = %d after a refresh inside the interval, want 2", f.calls)
	}
	if q == nil || q.Source != SourceLive || !q.CapturedAt.Equal(f.now) {
		t.Fatalf("want a reading as of now, got %+v", q)
	}
	if !retryAt.IsZero() {
		t.Errorf("retryAt = %v after an answer, want zero", retryAt)
	}
	// the refresh counts as the latest ask: a poll right behind it does not ask again
	f.reader.Get(context.Background())
	if f.calls != 2 {
		t.Fatalf("calls = %d for a poll behind a refresh, want 2", f.calls)
	}
}

func TestRefreshNeverBreaksABackoff(t *testing.T) {
	f := newFixture(t, token(time.Date(2026, 10, 6, 10, 0, 0, 0, time.UTC)), cacheFile)
	f.status = http.StatusTooManyRequests
	f.header = http.Header{"Retry-After": []string{"1800"}}
	f.reader.Get(context.Background())
	limitedAt := f.now
	f.status = http.StatusOK
	f.now = f.now.Add(time.Minute)
	q, retryAt := f.reader.Refresh(context.Background())
	if f.calls != 1 {
		t.Fatalf("calls = %d for a refresh inside the backoff, want 1", f.calls)
	}
	if want := limitedAt.Add(30 * time.Minute); !retryAt.Equal(want) {
		t.Errorf("retryAt = %v, want %v", retryAt, want)
	}
	if q == nil || q.Source != SourceCache {
		t.Fatalf("want the cached reading while held, got %+v", q)
	}
	f.now = limitedAt.Add(30 * time.Minute)
	q, retryAt = f.reader.Refresh(context.Background())
	if f.calls != 2 || q == nil || q.Source != SourceLive || !retryAt.IsZero() {
		t.Fatalf("after the backoff: calls=%d q=%+v retryAt=%v", f.calls, q, retryAt)
	}
}

func TestRefreshThatIsRateLimitedSaysWhenToRetry(t *testing.T) {
	f := newFixture(t, token(time.Date(2026, 10, 6, 10, 0, 0, 0, time.UTC)), cacheFile)
	f.reader.Get(context.Background())
	f.status = http.StatusTooManyRequests
	f.now = f.now.Add(time.Minute)
	q, retryAt := f.reader.Refresh(context.Background())
	if f.calls != 2 {
		t.Fatalf("calls = %d, want 2", f.calls)
	}
	if want := f.now.Add(firstBackoff); !retryAt.Equal(want) {
		t.Errorf("retryAt = %v, want %v", retryAt, want)
	}
	if q == nil || q.Source != SourceLive || *q.FiveHourPct != 50 {
		t.Fatalf("want the kept live reading, got %+v", q)
	}
}

func TestRefreshWithoutCredentialsAnswersTheCache(t *testing.T) {
	f := newFixture(t, "", cacheFile)
	q, retryAt := f.reader.Refresh(context.Background())
	if f.calls != 0 || !retryAt.IsZero() {
		t.Fatalf("calls=%d retryAt=%v, want none", f.calls, retryAt)
	}
	if q == nil || q.Source != SourceCache {
		t.Fatalf("want the cached reading, got %+v", q)
	}
}
