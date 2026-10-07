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
	called := false
	pct := 42.0
	get := func(context.Context) *claudequota.Quota {
		called = true
		return &claudequota.Quota{FiveHourPct: &pct, CapturedAt: time.UnixMilli(1000)}
	}
	if got := claudeQuotaFor(context.Background(), "a1234abcd", get); called || got.FiveHourPct != nil {
		t.Fatalf("non-Default account: called=%v got=%+v", called, got)
	}
	got := claudeQuotaFor(context.Background(), "", get)
	if !called || got.FiveHourPct == nil || *got.FiveHourPct != 42 {
		t.Fatalf("Default: called=%v got=%+v", called, got)
	}
}
