// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/usageinsights"
	"github.com/wavetermdev/waveterm/pkg/usagestats"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func TestAnalyzeUsageRejectsEmptyDigest(t *testing.T) {
	ws := &WshServer{}
	for _, digest := range []string{"", "  \n\t"} {
		ins, err := ws.AnalyzeUsageCommand(context.Background(), wshrpc.CommandAnalyzeUsageData{WindowDays: 7, Digest: digest})
		if err == nil || !strings.Contains(err.Error(), "digest") {
			t.Fatalf("digest %q: want an error naming the digest, got ins=%+v err=%v", digest, ins, err)
		}
		if ins != nil {
			t.Fatalf("digest %q: want no result alongside the error, got %+v", digest, ins)
		}
	}
}

func TestGetUsageInsightsReturnsTheSavedAnalysis(t *testing.T) {
	ws := &WshServer{}
	insightsFile := filepath.Join(usageinsights.Dir(), "insights", "usage.json")
	_ = os.Remove(insightsFile)

	none, err := ws.GetUsageInsightsCommand(context.Background())
	if err != nil {
		t.Fatalf("nothing saved: %v", err)
	}
	if none == nil || none.Markdown != "" || none.AnalyzedTs != 0 {
		t.Fatalf("nothing saved: want the zero value, got %+v", none)
	}

	want := usageinsights.Insights{Markdown: "## Where the quota goes\n", AnalyzedTs: 1_700_000_000_000, WindowDays: 30, Model: "sonnet"}
	if err := usageinsights.Save(usageinsights.Dir(), want); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Remove(insightsFile) })
	got, err := ws.GetUsageInsightsCommand(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if *got != (wshrpc.UsageInsights{Markdown: want.Markdown, AnalyzedTs: want.AnalyzedTs, WindowDays: want.WindowDays, Model: want.Model}) {
		t.Fatalf("saved analysis: got %+v", got)
	}
}

func TestSessionUsageToWireCarriesEveryField(t *testing.T) {
	in := usagestats.SessionUsage{
		ID: "s1", Title: "Fix the thing", Project: "arcterm",
		Models: []usagestats.SessionModelTokens{
			{Model: "claude-opus-4-1", Input: 1, Output: 2, CacheRead: 3, CacheCreate: 4, CacheCreate1h: 5},
			{Model: "claude-haiku-4-5", Sub: true, Input: 6, Output: 7, CacheRead: 8, CacheCreate: 9, CacheCreate1h: 0},
		},
		Turns: 10, SubTurns: 11, AvgCtx: 12, MaxCtx: 13, ColdResumes: 14, ColdTokens: 15, FirstTs: 16, LastTs: 17,
	}
	want := wshrpc.UsageSession{
		ID: "s1", Title: "Fix the thing", Project: "arcterm",
		Models: []wshrpc.UsageSessionModel{
			{Model: "claude-opus-4-1", Input: 1, Output: 2, CacheRead: 3, CacheCreate: 4, CacheCreate1h: 5},
			{Model: "claude-haiku-4-5", Sub: true, Input: 6, Output: 7, CacheRead: 8, CacheCreate: 9, CacheCreate1h: 0},
		},
		Turns: 10, SubTurns: 11, AvgCtx: 12, MaxCtx: 13, ColdResumes: 14, ColdTokens: 15, FirstTs: 16, LastTs: 17,
	}
	if got := sessionUsageToWire(in); !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v, want %+v", got, want)
	}
	// a session with no models still lists them as [], not null, so the frontend can map it unguarded
	if got := sessionUsageToWire(usagestats.SessionUsage{ID: "s2"}); got.Models == nil {
		t.Fatal("Models should be a non-nil empty slice")
	}
}
