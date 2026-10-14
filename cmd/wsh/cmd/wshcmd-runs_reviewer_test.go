// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"slices"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func TestRunsStartDataReviewerFlags(t *testing.T) {
	orch := jarvis.RunMode_Orchestrator
	cases := []struct {
		name    string
		opts    runsStartOpts
		wantErr string
		check   func(t *testing.T, d wshrpc.CommandCreateRunData)
	}{
		{name: "reviewer picks needs orchestrator", opts: runsStartOpts{goal: "g", reviewerPicks: true}, wantErr: "need an orchestrator run"},
		{name: "reviewer runtime needs orchestrator", opts: runsStartOpts{goal: "g", reviewerRuntime: "pi"}, wantErr: "need an orchestrator run"},
		{name: "reviewer model needs orchestrator", opts: runsStartOpts{goal: "g", reviewerRuntime: "pi", reviewerModel: "m"}, wantErr: "need an orchestrator run"},
		{name: "reviewer model needs reviewer runtime", opts: runsStartOpts{goal: "g", mode: orch, reviewerModel: "m"}, wantErr: "--reviewer-model needs --reviewer-runtime"},
		{name: "reviewer picks refused with a worker runtime", opts: runsStartOpts{goal: "g", mode: orch, reviewerPicks: true, workerRuntime: "pi"}, wantErr: "--reviewer-picks"},
		{name: "reviewer picks refused with a worker model", opts: runsStartOpts{goal: "g", mode: orch, reviewerPicks: true, workerModel: "m"}, wantErr: "--reviewer-picks"},
		{name: "reviewer picks is sent", opts: runsStartOpts{goal: "g", mode: orch, reviewerPicks: true}, check: func(t *testing.T, d wshrpc.CommandCreateRunData) {
			if d.ReviewerPicks == nil || !*d.ReviewerPicks || d.WorkerRoute != nil {
				t.Fatalf("picks = %v worker = %+v, want &true and no route", d.ReviewerPicks, d.WorkerRoute)
			}
		}},
		{name: "a worker runtime owns the workers setting", opts: runsStartOpts{goal: "g", mode: orch, workerRuntime: "pi", workerModel: "m"}, check: func(t *testing.T, d wshrpc.CommandCreateRunData) {
			if d.WorkerRoute == nil || *d.WorkerRoute != (waveobj.RoutePin{Runtime: "pi", Model: "m"}) {
				t.Fatalf("worker route = %+v, want {pi m}", d.WorkerRoute)
			}
			if d.ReviewerPicks == nil || *d.ReviewerPicks {
				t.Fatalf("picks = %v, want &false so the profile's picks cannot fill in the workers setting", d.ReviewerPicks)
			}
		}},
		{name: "no workers flag leaves the profile's setting", opts: runsStartOpts{goal: "g", mode: orch}, check: func(t *testing.T, d wshrpc.CommandCreateRunData) {
			if d.ReviewerPicks != nil || d.ReviewerRoute != nil {
				t.Fatalf("picks = %v reviewer = %+v, want nil for the profile to decide", d.ReviewerPicks, d.ReviewerRoute)
			}
		}},
		{name: "reviewer route is sent", opts: runsStartOpts{goal: "g", mode: orch, reviewerRuntime: "claude", reviewerModel: "opus"}, check: func(t *testing.T, d wshrpc.CommandCreateRunData) {
			if d.ReviewerRoute == nil || *d.ReviewerRoute != (waveobj.RoutePin{Runtime: "claude", Model: "opus"}) {
				t.Fatalf("reviewer route = %+v", d.ReviewerRoute)
			}
		}},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			d, err := runsStartData(tt.opts)
			if tt.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
					t.Fatalf("err = %v, want %q", err, tt.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			tt.check(t, d)
		})
	}
}

func TestRunsShowLinesReviewerSettings(t *testing.T) {
	ch := &waveobj.Channel{OID: "ch-1", Name: "waveterm"}
	run := &waveobj.Run{
		ID: "r-1", Status: "executing", Mode: jarvis.RunMode_Orchestrator, Runtime: "claude", CreatedTs: 1,
		ReviewerPicks: true, ReviewerRoute: &waveobj.RoutePin{Runtime: "claude", Model: "opus"},
	}
	lines := runsShowLines(ch, run, nil, 2, nil, nil)
	if !slices.Contains(lines, "route    claude  workers=reviewer-picks  reviewers=claude opus") {
		t.Fatalf("route line missing the workers and reviewers settings:\n%s", strings.Join(lines, "\n"))
	}
	run.ReviewerPicks, run.ReviewerRoute = false, nil
	if lines = runsShowLines(ch, run, nil, 2, nil, nil); !slices.Contains(lines, "route    claude") {
		t.Fatalf("a run without the settings must print today's route line:\n%s", strings.Join(lines, "\n"))
	}
}
