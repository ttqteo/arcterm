// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"reflect"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func TestParsePick(t *testing.T) {
	good := []struct {
		in   string
		want wshrpc.DagModelPick
	}{
		{"t-2=sonnet: a field threaded through", wshrpc.DagModelPick{TaskId: "t-2", Model: "sonnet", Reason: "a field threaded through"}},
		{"  t-13 = lead :  the store shape: a design choice  ", wshrpc.DagModelPick{TaskId: "t-13", Model: "lead", Reason: "the store shape: a design choice"}},
	}
	for _, c := range good {
		got, err := parsePick(c.in)
		if err != nil {
			t.Fatalf("parsePick(%q): %v", c.in, err)
		}
		if !reflect.DeepEqual(got, c.want) {
			t.Fatalf("parsePick(%q) = %+v, want %+v", c.in, got, c.want)
		}
	}
	for _, in := range []string{"Task 2=sonnet: x", "t-2 sonnet", "t-2=opus: x", "t-2=sonnet:", "t-2=sonnet x", "=sonnet: x"} {
		_, err := parsePick(in)
		if err == nil || !strings.Contains(err.Error(), `--pick wants "t-N=<sonnet|lead>: <reason>"`) {
			t.Errorf("parsePick(%q) must be refused with the expected shape, got %v", in, err)
		}
	}
}

func TestDagPlanReviewDataCarriesPicks(t *testing.T) {
	cmd := newDagEscalateTestCmd(t, map[string]string{"channel": "ch", "runid": "plan-reviewer-run"})
	cmd.Flags().StringArray("pick", nil, "")
	for _, v := range []string{"t-1=sonnet: copy, then rename", "t-2=lead: a design choice"} {
		if err := cmd.Flags().Set("pick", v); err != nil {
			t.Fatal(err)
		}
	}
	got, err := dagPlanReviewData(cmd, []string{"pass", "fine"})
	if err != nil {
		t.Fatal(err)
	}
	want := []wshrpc.DagModelPick{{TaskId: "t-1", Model: "sonnet", Reason: "copy, then rename"}, {TaskId: "t-2", Model: "lead", Reason: "a design choice"}}
	if !reflect.DeepEqual(got.Picks, want) {
		t.Fatalf("picks = %+v, want %+v", got.Picks, want)
	}
	if err := cmd.Flags().Set("pick", "t-3 sonnet"); err != nil {
		t.Fatal(err)
	}
	if _, err := dagPlanReviewData(cmd, []string{"pass", "fine"}); err == nil {
		t.Fatal("a malformed --pick must be refused before the RPC")
	}
}

func TestDagPlanReviewPickGoesWithAVerdictOnly(t *testing.T) {
	cmd := newDagEscalateTestCmd(t, map[string]string{"channel": "ch", "runid": "run"})
	cmd.Flags().StringArray("pick", nil, "")
	if err := cmd.Flags().Set("pick", "t-1=lead: x"); err != nil {
		t.Fatal(err)
	}
	if _, err := dagPlanReviewData(cmd, []string{"accept", "text"}); err == nil {
		t.Error("planreview accept must refuse --pick")
	}
	got, err := dagPlanReviewData(cmd, []string{"fail", "text"})
	if err != nil || len(got.Picks) != 1 {
		t.Errorf("planreview fail carries its picks, got %+v, %v", got.Picks, err)
	}
}

func TestDagPlanReviewExposesPickFlag(t *testing.T) {
	if f := dagPlanReviewCmd.Flags().Lookup("pick"); f == nil || f.Value.Type() != "stringArray" {
		t.Fatal("planreview needs a repeatable --pick that keeps commas in a reason")
	}
}
