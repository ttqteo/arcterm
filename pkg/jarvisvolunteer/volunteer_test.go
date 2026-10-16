// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jarvisvolunteer

import (
	"context"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/wps"
)

type stubProducer struct {
	name  string
	cands []Candidate
	err   error
}

func (s *stubProducer) Name() string { return s.name }
func (s *stubProducer) Candidates(context.Context, *Trigger) ([]Candidate, error) {
	return s.cands, s.err
}

func withProducers(t *testing.T, ps ...Producer) {
	t.Helper()
	old := producersFor
	producersFor = func(*Trigger) []Producer { return ps }
	t.Cleanup(func() { producersFor = old })
}

func capturePublished(t *testing.T) *[]wps.WaveEvent {
	t.Helper()
	var got []wps.WaveEvent
	restore := SetPublishSinkForTest(func(ev wps.WaveEvent) { got = append(got, ev) })
	t.Cleanup(restore)
	return &got
}

func TestQuietWindowMakesNoModelCall(t *testing.T) {
	resetGateForTest()
	published := capturePublished(t)
	withProducers(t, &stubProducer{name: "x", cands: []Candidate{cand("a", 10)}})

	var judgeCalls int
	defer SetJudgeForTest(func(context.Context, string, string) (string, error) {
		judgeCalls++
		return "1", nil
	})()

	if _, reason := Evaluate(context.Background(), &Trigger{Kind: TriggerSweep}); reason != "" {
		t.Fatalf("first evaluation should speak, got reason %q", reason)
	}
	if judgeCalls != 1 {
		t.Fatalf("want 1 judge call, got %d", judgeCalls)
	}
	// second trigger lands inside the quiet window
	data, reason := Evaluate(context.Background(), &Trigger{Kind: TriggerSweep})
	if data != nil || reason != ReasonRateLimited {
		t.Fatalf("want nil + %q, got %+v + %q", ReasonRateLimited, data, reason)
	}
	if judgeCalls != 1 {
		t.Fatalf("rate-limited trigger must not reach the judge; judge calls = %d", judgeCalls)
	}
	if len(*published) != 1 {
		t.Fatalf("want exactly 1 published event, got %d", len(*published))
	}
}

func TestNoCandidatesMakesNoModelCall(t *testing.T) {
	resetGateForTest()
	capturePublished(t)
	withProducers(t, &stubProducer{name: "x", cands: nil})
	var judgeCalls int
	defer SetJudgeForTest(func(context.Context, string, string) (string, error) {
		judgeCalls++
		return "1", nil
	})()

	data, reason := Evaluate(context.Background(), &Trigger{Kind: TriggerSweep})
	if data != nil || reason != ReasonNoCandidates {
		t.Fatalf("want nil + %q, got %+v + %q", ReasonNoCandidates, data, reason)
	}
	if judgeCalls != 0 {
		t.Fatalf("an empty shortlist must short-circuit before the judge; judge calls = %d", judgeCalls)
	}
}

func TestJudgeDeclineIsSilentAndNamed(t *testing.T) {
	resetGateForTest()
	published := capturePublished(t)
	withProducers(t, &stubProducer{name: "x", cands: []Candidate{cand("a", 10)}})
	defer SetJudgeForTest(func(context.Context, string, string) (string, error) { return "none", nil })()

	data, reason := Evaluate(context.Background(), &Trigger{Kind: TriggerSweep})
	if data != nil || reason != ReasonJudgeDeclined {
		t.Fatalf("want nil + %q, got %+v + %q", ReasonJudgeDeclined, data, reason)
	}
	if len(*published) != 0 {
		t.Fatalf("a decline must publish nothing, got %d events", len(*published))
	}
}

// A decline must not consume the quiet window: nothing was said, so nothing needs silence after it.
func TestDeclineDoesNotStartTheQuietWindow(t *testing.T) {
	resetGateForTest()
	capturePublished(t)
	withProducers(t, &stubProducer{name: "x", cands: []Candidate{cand("a", 10), cand("b", 20)}})
	defer SetJudgeForTest(func(context.Context, string, string) (string, error) { return "none", nil })()

	Evaluate(context.Background(), &Trigger{Kind: TriggerSweep})
	if _, reason := Evaluate(context.Background(), &Trigger{Kind: TriggerSweep}); reason == ReasonRateLimited {
		t.Fatalf("a decline said nothing, so the next trigger must not be rate-limited")
	}
}

func TestJudgeErrorIsSilentNotFatal(t *testing.T) {
	resetGateForTest()
	capturePublished(t)
	withProducers(t, &stubProducer{name: "x", cands: []Candidate{cand("a", 10)}})
	defer SetJudgeForTest(func(context.Context, string, string) (string, error) {
		return "", errNoRuntime
	})()

	data, reason := Evaluate(context.Background(), &Trigger{Kind: TriggerSweep})
	if data != nil || reason != ReasonJudgeError {
		t.Fatalf("want nil + %q, got %+v + %q", ReasonJudgeError, data, reason)
	}
}

func TestOneFailingProducerDoesNotSuppressTheOthers(t *testing.T) {
	resetGateForTest()
	capturePublished(t)
	withProducers(t,
		&stubProducer{name: "broken", err: context.DeadlineExceeded},
		&stubProducer{name: "ok", cands: []Candidate{cand("survivor", 10)}},
	)
	defer SetJudgeForTest(func(context.Context, string, string) (string, error) { return "1", nil })()

	data, reason := Evaluate(context.Background(), &Trigger{Kind: TriggerSweep})
	if data == nil {
		t.Fatalf("a healthy producer must still contribute; reason was %q", reason)
	}
	if data.Id != "survivor" {
		t.Fatalf("published the wrong candidate: %+v", data)
	}
}

// A producer that panics must not take wavesrv's goroutine down with it, and must not silence the rest.
func TestPanickingProducerIsContained(t *testing.T) {
	resetGateForTest()
	capturePublished(t)
	withProducers(t, &panicProducer{}, &stubProducer{name: "ok", cands: []Candidate{cand("survivor", 10)}})
	defer SetJudgeForTest(func(context.Context, string, string) (string, error) { return "1", nil })()

	data, reason := Evaluate(context.Background(), &Trigger{Kind: TriggerSweep})
	if data == nil || data.Id != "survivor" {
		t.Fatalf("a panicking producer must be contained and the healthy one still heard; got %+v (%s)", data, reason)
	}
}

type panicProducer struct{}

func (p *panicProducer) Name() string { return "panicky" }
func (p *panicProducer) Candidates(context.Context, *Trigger) ([]Candidate, error) {
	panic("producer blew up")
}

// The idempotence property: the same fact evaluated twice publishes at most one NEW payload, and any
// second publish carries a byte-identical (At, Id) pair so the frontend watermark discards it. This is
// the entire justification for having no server-side said-log and no database migration.
func TestSameFactYieldsIdenticalPair(t *testing.T) {
	resetGateForTest()
	published := capturePublished(t)
	fact := Candidate{Class: ClassLooseEnd, ID: "loose-end:task-a:900", At: 900, Title: "t", Snippet: "s"}
	withProducers(t, &stubProducer{name: "x", cands: []Candidate{fact}})
	defer SetJudgeForTest(func(context.Context, string, string) (string, error) { return "1", nil })()

	if _, reason := Evaluate(context.Background(), &Trigger{Kind: TriggerSweep}); reason != "" {
		t.Fatalf("first evaluation should speak, got %q", reason)
	}
	markSpokeForTestReset()
	data, reason := Evaluate(context.Background(), &Trigger{Kind: TriggerSweep})
	if data != nil {
		t.Fatalf("an already-emitted fact must not reach the judge again, got %+v (reason %q)", data, reason)
	}
	if reason != ReasonNoCandidates {
		t.Fatalf("want %q after the prefilter drops the seen id, got %q", ReasonNoCandidates, reason)
	}
	if len(*published) != 1 {
		t.Fatalf("want exactly 1 published event across two evaluations, got %d", len(*published))
	}
	first := (*published)[0].Data.(baseds.VolunteerData)
	if first.At != 900 || first.Id != "loose-end:task-a:900" {
		t.Fatalf("published pair must be the fact's own, got At=%d Id=%q", first.At, first.Id)
	}
}

// The event must be published scope-less: it is a fact about your work, not about one object, and
// petsources.tsx reads its history with scope "".
func TestPublishedEventIsScopelessAndReplayable(t *testing.T) {
	resetGateForTest()
	published := capturePublished(t)
	withProducers(t, &stubProducer{name: "x", cands: []Candidate{cand("a", 10)}})
	defer SetJudgeForTest(func(context.Context, string, string) (string, error) { return "1", nil })()

	Evaluate(context.Background(), &Trigger{Kind: TriggerSweep})
	if len(*published) != 1 {
		t.Fatalf("want 1 published event, got %d", len(*published))
	}
	ev := (*published)[0]
	if ev.Event != wps.Event_JarvisVolunteer {
		t.Fatalf("event = %q, want %q", ev.Event, wps.Event_JarvisVolunteer)
	}
	if len(ev.Scopes) != 0 {
		t.Fatalf("event must be scope-less so the creature's scope-\"\" history read finds it, got %v", ev.Scopes)
	}
	if ev.Persist != volunteerPersist {
		t.Fatalf("persist = %d, want %d so a late subscriber can replay", ev.Persist, volunteerPersist)
	}
}

func TestProducersForSelectsByTriggerKind(t *testing.T) {
	cases := []struct {
		kind string
		want []string
	}{
		{TriggerRunCreated, []string{ClassLedger}},
		{TriggerRunRest, []string{ClassConnection, ClassLedger}},
		{TriggerSweep, []string{ClassLooseEnd, ClassMemoryHygiene}},
	}
	for _, c := range cases {
		ps := producersFor(&Trigger{Kind: c.kind})
		var names []string
		for _, p := range ps {
			names = append(names, p.Name())
		}
		if len(names) != len(c.want) {
			t.Fatalf("trigger %q selected %v, want %v", c.kind, names, c.want)
		}
		for i := range c.want {
			if names[i] != c.want[i] {
				t.Fatalf("trigger %q selected %v, want %v", c.kind, names, c.want)
			}
		}
	}
}
