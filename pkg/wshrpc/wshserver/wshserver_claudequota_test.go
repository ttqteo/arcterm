// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/claudequota"
)

func TestClaudeQuotaOnlyForDefault(t *testing.T) {
	oldEmail := loginEmail
	loginEmail = func() string { return "mozox@example.com" }
	t.Cleanup(func() { loginEmail = oldEmail })
	called := false
	pct := 42.0
	get := func(context.Context) *claudequota.Quota {
		called = true
		return &claudequota.Quota{FiveHourPct: &pct, CapturedAt: time.UnixMilli(1000)}
	}
	if got := claudeQuotaFor(context.Background(), "a1234abcd", get); called || got.FiveHourPct != nil || got.Email != "" {
		t.Fatalf("non-Default account: called=%v got=%+v", called, got)
	}
	got := claudeQuotaFor(context.Background(), "", get)
	if !called || got.FiveHourPct == nil || *got.FiveHourPct != 42 {
		t.Fatalf("Default: called=%v got=%+v", called, got)
	}
	if got.Email != "mozox@example.com" {
		t.Fatalf("Default answer should name the /login account, got %q", got.Email)
	}
}

func TestClaudeQuotaNothingKnownHasNoEmail(t *testing.T) {
	oldEmail := loginEmail
	loginEmail = func() string { return "mozox@example.com" }
	t.Cleanup(func() { loginEmail = oldEmail })
	got := claudeQuotaFor(context.Background(), "", func(context.Context) *claudequota.Quota { return nil })
	if got.FiveHourPct != nil || got.Email != "" {
		t.Fatalf("no quota: got %+v", got)
	}
}

func TestRefreshClaudeQuotaOnlyForDefault(t *testing.T) {
	oldEmail := loginEmail
	loginEmail = func() string { return "mozox@example.com" }
	t.Cleanup(func() { loginEmail = oldEmail })
	called := false
	pct := 42.0
	refresh := func(context.Context) (*claudequota.Quota, time.Time) {
		called = true
		return &claudequota.Quota{FiveHourPct: &pct, CapturedAt: time.UnixMilli(1000)}, time.Time{}
	}
	if got := refreshClaudeQuotaFor(context.Background(), "a1234abcd", refresh); called || got.FiveHourPct != nil || got.RetryAt != 0 {
		t.Fatalf("non-Default account: called=%v got=%+v", called, got)
	}
	got := refreshClaudeQuotaFor(context.Background(), "", refresh)
	if !called || got.FiveHourPct == nil || *got.FiveHourPct != 42 || got.Email != "mozox@example.com" || got.RetryAt != 0 {
		t.Fatalf("Default: called=%v got=%+v", called, got)
	}
}

func TestRefreshClaudeQuotaHeldByABackoffCarriesRetryAt(t *testing.T) {
	oldEmail := loginEmail
	loginEmail = func() string { return "mozox@example.com" }
	t.Cleanup(func() { loginEmail = oldEmail })
	retry := time.UnixMilli(5_000_000)
	// the held answer still carries the reading the reader kept
	pct := 7.0
	got := refreshClaudeQuotaFor(context.Background(), "", func(context.Context) (*claudequota.Quota, time.Time) {
		return &claudequota.Quota{FiveHourPct: &pct, CapturedAt: time.UnixMilli(1000)}, retry
	})
	if got.RetryAt != 5_000_000 || got.FiveHourPct == nil || got.Email != "mozox@example.com" {
		t.Fatalf("held with a reading: got %+v", got)
	}
	// and with no reading at all it still says when to retry, with no email to file anything under
	got = refreshClaudeQuotaFor(context.Background(), "", func(context.Context) (*claudequota.Quota, time.Time) {
		return nil, retry
	})
	if got.RetryAt != 5_000_000 || got.FiveHourPct != nil || got.Email != "" {
		t.Fatalf("held with no reading: got %+v", got)
	}
}
