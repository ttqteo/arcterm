// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// the hooks send every agent command as `wsh jobslot -- <command>`: past `--` cobra looks for no subcommand, so a
// command named forget is queued like any other, and only `wsh jobslot forget …` reaches the subcommand
func TestJobslotForgetIsReachedOnlyBeforeTheDoubleDash(t *testing.T) {
	for _, tc := range []struct {
		args []string
		want string
	}{
		{[]string{"jobslot", "forget", "scripts/verify.mjs"}, "forget"},
		{[]string{"jobslot", "--", "forget"}, "jobslot"},
		{[]string{"jobslot", "--hold-parent", "--", "forget"}, "jobslot"},
		{[]string{"jobslot", "--", "task check:ts"}, "jobslot"},
	} {
		got, _, err := rootCmd.Find(tc.args)
		if err != nil {
			t.Fatalf("%v: %v", tc.args, err)
		}
		if got.Name() != tc.want {
			t.Errorf("%v runs %q, want %q", tc.args, got.Name(), tc.want)
		}
	}
}

func TestJobslotForgetReport(t *testing.T) {
	const gb = uint64(1) << 30
	var b strings.Builder
	jobslotForgetReport(&b, &wshrpc.JobPeaksForgetResult{
		Pattern: "scripts/verify.mjs", Project: `D:\repo`, Dropped: []uint64{10*gb + gb/2},
		Left: []uint64{2 * gb, gb / 2}, Bytes: 2*gb + 2*gb/5, Measured: true,
	})
	want := "scripts/verify.mjs in D:\\repo: dropped 10.5 GB\nkept, newest first: 2 GB, 0.5 GB\nthe next run is admitted on 2.4 GB\n"
	if b.String() != want {
		t.Fatalf("report =\n%s\nwant\n%s", b.String(), want)
	}
	b.Reset()
	jobslotForgetReport(&b, &wshrpc.JobPeaksForgetResult{Pattern: "task check:ts", Dropped: []uint64{3 * gb, 2 * gb}})
	want = "task check:ts outside any repository: dropped 3 GB, 2 GB\nthe next run is admitted on memgate's table figure\n"
	if b.String() != want {
		t.Fatalf("report =\n%s\nwant\n%s", b.String(), want)
	}
}
