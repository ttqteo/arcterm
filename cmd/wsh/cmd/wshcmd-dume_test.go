// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func TestDumeStatusText(t *testing.T) {
	now := time.Date(2026, 11, 16, 15, 0, 0, 0, time.UTC)
	pct := 45.0
	reset := now.Add(2*time.Hour + 10*time.Minute).Unix()
	soon := now.Add(45 * time.Minute).Unix()
	past := now.Add(-time.Minute).Unix()
	checked := time.Date(2026, 11, 16, 14, 5, 0, 0, time.UTC).UnixMilli()
	yesterday := time.Date(2026, 11, 15, 23, 30, 0, 0, time.UTC).UnixMilli()
	landed := wshrpc.DumeChunk{Effort: "Docs rewrite", Chunk: "Write the guide", Branch: "wave/dume-a9e0fd4f-lz3k9"}

	tests := map[string]struct {
		in   wshrpc.DumeStatusData
		want string
	}{
		"off": {
			in:   wshrpc.DumeStatusData{},
			want: "DUM-E: off (Settings → Runs & limits → DUM-E)\n",
		},
		"off keeps what is still on the board": {
			in: wshrpc.DumeStatusData{Waiting: 1, ToLand: []wshrpc.DumeChunk{landed}},
			want: "DUM-E: off (Settings → Runs & limits → DUM-E)\n" +
				"waiting 1 · to land 1 · blocked 0 · done 0\n" +
				"  Docs rewrite · Write the guide: git merge wave/dume-a9e0fd4f-lz3k9\n",
		},
		"on, not checked yet": {
			in:   wshrpc.DumeStatusData{Enabled: true},
			want: "DUM-E: on, not checked yet\n",
		},
		"on with a reason and a 5h reading": {
			in: wshrpc.DumeStatusData{
				Enabled: true, Reason: "75% used: over the 70% to start", DecidedTs: checked,
				FiveHourPct: &pct, FiveHourReset: &reset, Waiting: 3, Done: 2,
			},
			want: "DUM-E: on\n" +
				"last check 14:05: 75% used: over the 70% to start\n" +
				"5h window 45% used, resets in 2h10\n" +
				"waiting 3 · to land 0 · blocked 0 · done 2\n",
		},
		"under an hour to the reset": {
			in: wshrpc.DumeStatusData{
				Enabled: true, Reason: "working", DecidedTs: checked, FiveHourPct: &pct, FiveHourReset: &soon,
			},
			want: "DUM-E: on\n" +
				"last check 14:05: working\n" +
				"5h window 45% used, resets in 45 min\n" +
				"waiting 0 · to land 0 · blocked 0 · done 0\n",
		},
		"the reset time has passed": {
			in: wshrpc.DumeStatusData{
				Enabled: true, Reason: "window already reset", DecidedTs: checked, FiveHourPct: &pct, FiveHourReset: &past,
			},
			want: "DUM-E: on\n" +
				"last check 14:05: window already reset\n" +
				"5h window 45% used, resetting now\n" +
				"waiting 0 · to land 0 · blocked 0 · done 0\n",
		},
		"no 5h reading": {
			in: wshrpc.DumeStatusData{Enabled: true, Reason: "no 5h reading", DecidedTs: checked},
			want: "DUM-E: on\n" +
				"last check 14:05: no 5h reading\n" +
				"waiting 0 · to land 0 · blocked 0 · done 0\n",
		},
		"a check from another day names the day": {
			in: wshrpc.DumeStatusData{Enabled: true, Reason: "off", DecidedTs: yesterday},
			want: "DUM-E: on\n" +
				"last check 11-15 23:30: off\n" +
				"waiting 0 · to land 0 · blocked 0 · done 0\n",
		},
		"a reason with no time": {
			in: wshrpc.DumeStatusData{Enabled: true, Reason: "working"},
			want: "DUM-E: on\n" +
				"last check: working\n" +
				"waiting 0 · to land 0 · blocked 0 · done 0\n",
		},
		"running, with chunks to land": {
			in: wshrpc.DumeStatusData{
				Enabled: true, Reason: "working", DecidedTs: checked,
				Running: &wshrpc.DumeChunk{
					Effort: "Docs rewrite", Chunk: "Draft the intro",
					RunId: "5a6d0607-cfaa-4395-bf7a-b28de8608363", Branch: "wave/dume-a9e0fd4f-lz3ka",
				},
				Waiting: 3, ToLand: []wshrpc.DumeChunk{landed, {Effort: "Billing", Chunk: "Retry job", Branch: "wave/dume-77aa1bb2-lz3k1"}},
				Blocked: 0, Done: 2,
			},
			want: "DUM-E: on\n" +
				"last check 14:05: working\n" +
				"running: Docs rewrite · Draft the intro (run 5a6d0607, wave/dume-a9e0fd4f-lz3ka)\n" +
				"waiting 3 · to land 2 · blocked 0 · done 2\n" +
				"  Docs rewrite · Write the guide: git merge wave/dume-a9e0fd4f-lz3k9\n" +
				"  Billing · Retry job: git merge wave/dume-77aa1bb2-lz3k1\n",
		},
		"running with a short run id and no branch": {
			in: wshrpc.DumeStatusData{
				Enabled: true, Reason: "working", DecidedTs: checked,
				Running: &wshrpc.DumeChunk{Effort: "E", Chunk: "C", RunId: "abc"},
			},
			want: "DUM-E: on\n" +
				"last check 14:05: working\n" +
				"running: E · C (run abc)\n" +
				"waiting 0 · to land 0 · blocked 0 · done 0\n",
		},
	}
	for name, tc := range tests {
		t.Run(name, func(t *testing.T) {
			got := dumeStatusText(&tc.in, now)
			if got != tc.want {
				t.Errorf("dumeStatusText:\n got: %q\nwant: %q", got, tc.want)
			}
			if !strings.HasSuffix(got, "\n") {
				t.Errorf("dumeStatusText must end with a newline, got %q", got)
			}
		})
	}
}
