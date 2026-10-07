// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"testing"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

func TestRunsWorkersSettingRules(t *testing.T) {
	cases := []struct {
		name    string
		o       runsRouteOpts
		wantErr bool
		route   *waveobj.RoutePin
		picks   bool
	}{
		{name: "worker route", o: runsRouteOpts{workerRuntime: "claude", workerModel: "sonnet"}, route: &waveobj.RoutePin{Runtime: "claude", Model: "sonnet"}},
		{name: "reviewer picks", o: runsRouteOpts{reviewerPicks: true}, picks: true},
		{name: "same as lead", o: runsRouteOpts{sameAsLead: true}},
		{name: "model without runtime", o: runsRouteOpts{workerModel: "sonnet"}, wantErr: true},
		{name: "two settings", o: runsRouteOpts{workerRuntime: "claude", reviewerPicks: true}, wantErr: true},
		{name: "nothing to set", o: runsRouteOpts{}, wantErr: true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			route, picks, err := runsWorkersSetting(c.o)
			if (err != nil) != c.wantErr {
				t.Fatalf("err = %v, wantErr %v", err, c.wantErr)
			}
			if c.wantErr {
				return
			}
			if picks != c.picks || (route == nil) != (c.route == nil) || (route != nil && *route != *c.route) {
				t.Fatalf("got route %+v picks %v, want %+v %v", route, picks, c.route, c.picks)
			}
		})
	}
}

func TestRunsRouteSetKeepsTheRestOfTheProfile(t *testing.T) {
	g := waveobj.JarvisProfile{DefaultMode: "orchestrator", Parallelism: 3, ReviewerPicks: true}
	got := applyGlobalWorkers(g, &waveobj.RoutePin{Runtime: "claude", Model: "sonnet"}, false)
	if got.ReviewerPicks || got.WorkerRoute == nil || got.WorkerRoute.Model != "sonnet" {
		t.Fatalf("workers not replaced: %+v", got)
	}
	if got.DefaultMode != "orchestrator" || got.Parallelism != 3 {
		t.Fatalf("other sections changed: %+v", got)
	}

	o := applyOverrideWorkers(nil, nil, true)
	if o == nil || o.WorkerRoute != nil || o.ReviewerPicks == nil || !*o.ReviewerPicks {
		t.Fatalf("override workers = %+v", o)
	}
	keep := "branch"
	o = applyOverrideWorkers(&waveobj.ProfileOverride{Landing: &keep}, &waveobj.RoutePin{Runtime: "claude", Model: "sonnet"}, false)
	if o.Landing == nil || *o.Landing != "branch" || o.ReviewerPicks == nil || *o.ReviewerPicks {
		t.Fatalf("override = %+v", o)
	}
}

func TestDescribeWorkers(t *testing.T) {
	if got := describeWorkers(&waveobj.RoutePin{Runtime: "claude", Model: "sonnet"}, false); got != "claude / sonnet" {
		t.Fatalf("got %q", got)
	}
	if got := describeWorkers(nil, true); got != "reviewer picks each task's model" {
		t.Fatalf("got %q", got)
	}
	if got := describeWorkers(nil, false); got != "same as lead" {
		t.Fatalf("got %q", got)
	}
}
