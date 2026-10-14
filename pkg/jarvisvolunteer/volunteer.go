// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jarvisvolunteer

import (
	"context"
	"log"
	"time"

	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/wps"
)

// volunteerPersist bounds how much of the recent past a late subscriber can replay. Mirrors
// memdistill's memoryActivityPersist: this is a replay window in the broker's memory, never a durable
// log. A wavesrv restart replays nothing, which is harmless because producers are stateless readers -
// the next trigger re-derives anything still true.
const volunteerPersist = 20

// evaluateTimeout bounds the whole pipeline. The judge is a headless CLI process, so this must never
// run on an RPC handler's context: wshutil.DefaultTimeoutMs is 5000 and binds the SERVER's context, so
// slow synchronous handler work returns a timeout to the client even though it completes. Callers
// dispatch Evaluate off-band.
const evaluateTimeout = 90 * time.Second

// publishSink is the transport, swappable so tests observe a real announcement.
var publishSink = func(ev wps.WaveEvent) { wps.Broker.Publish(ev) }

// SetPublishSinkForTest swaps the broker transport. Returns a restore func the caller defers.
func SetPublishSinkForTest(fn func(wps.WaveEvent)) (restore func()) {
	prev := publishSink
	publishSink = fn
	return func() { publishSink = prev }
}

// producersFor selects which producers a trigger consults. A seam so tests inject stubs.
var producersFor = func(t *Trigger) []Producer {
	switch t.Kind {
	case TriggerRunCreated:
		return []Producer{NewLedgerProducer()}
	case TriggerRunRest:
		return []Producer{NewConnectionProducer(), NewLedgerProducer()}
	default:
		return []Producer{NewLooseEndProducer(), NewMemoryHygieneProducer()}
	}
}

var nowFn = func() int64 { return time.Now().UnixMilli() }

// markSpokeForTestReset lets a test re-open the quiet window without clearing the emitted-id map,
// which is what isolates the idempotence property from the rate gate.
func markSpokeForTestReset() {
	gateMu.Lock()
	defer gateMu.Unlock()
	lastSpokeAt = 0
}

// Evaluate runs the whole pipeline and returns the published payload, or nil plus a named reason.
// Never returns an error: a broken vault, dead index, unavailable model or panicking producer yields
// silence, never a failed run and never a visible error.
func Evaluate(ctx context.Context, t *Trigger) (*baseds.VolunteerData, string) {
	now := nowFn()
	if !allowNow(now) {
		return nil, ReasonRateLimited // before any read or model call: a quiet trigger costs nothing
	}
	var all []Candidate
	for _, p := range producersFor(t) {
		all = append(all, collect(ctx, p, t)...)
	}
	short := prefilter(all)
	if len(short) == 0 {
		return nil, ReasonNoCandidates // short-circuit: no model call
	}
	reply, err := judge(ctx, "", buildJudgePrompt(short))
	if err != nil {
		return nil, ReasonJudgeError
	}
	pick := parseJudgeReply(reply, len(short))
	if pick < 0 {
		// nothing was said, so nothing needs silence after it: the quiet window stays open
		return nil, ReasonJudgeDeclined
	}
	c := short[pick]
	markEmitted(c.ID)
	markSpoke(now)
	data := baseds.VolunteerData{
		Class:      c.Class,
		Id:         c.ID,
		At:         c.At,
		Title:      c.Title,
		Text:       c.Snippet,
		SourceType: c.SourceType,
		Ref:        c.SourceRef,
		Anchor:     c.Anchor,
	}
	publishSink(wps.WaveEvent{
		Event:   wps.Event_JarvisVolunteer,
		Persist: volunteerPersist,
		Data:    data,
	})
	return &data, ""
}

// collect runs one producer, containing both its errors and its panics. One broken producer is logged
// and skipped; the others still contribute, because a single bad reader silencing the whole creature
// is exactly the emergent failure this package exists to prevent.
func collect(ctx context.Context, p Producer, t *Trigger) (out []Candidate) {
	defer func() {
		if r := recover(); r != nil {
			panichandler.PanicHandler("jarvisvolunteer.producer."+p.Name(), r)
			out = nil
		}
	}()
	cands, err := p.Candidates(ctx, t)
	if err != nil {
		log.Printf("jarvisvolunteer: producer %s failed (%s, non-fatal): %v", p.Name(), ReasonProducerError, err)
		return nil
	}
	return cands
}

// EvaluateAsync dispatches Evaluate in a detached goroutine. Every caller uses this rather than
// Evaluate directly: the judge is a headless CLI process and must never bind an RPC handler's context.
func EvaluateAsync(t Trigger) {
	go func() {
		defer panichandler.PanicHandler("jarvisvolunteer.evaluate", recover())
		ctx, cancel := context.WithTimeout(context.Background(), evaluateTimeout)
		defer cancel()
		if _, reason := Evaluate(ctx, &t); reason != "" {
			// every terminal path names its reason: counting no-candidates against judge-declined is
			// the cost audit that choosing a model judge obliges us to have
			log.Printf("jarvisvolunteer: %s trigger said nothing (%s)", t.Kind, reason)
		}
	}()
}

// SweepLooseEnds is the hourly unattended entry. Synchronous by contract - StartLooseEndSweep wraps it
// in a panic handler and it is off any RPC budget.
func SweepLooseEnds() {
	ctx, cancel := context.WithTimeout(context.Background(), evaluateTimeout)
	defer cancel()
	if _, reason := Evaluate(ctx, &Trigger{Kind: TriggerSweep}); reason != "" {
		log.Printf("jarvisvolunteer: sweep said nothing (%s)", reason)
	}
}

// sweepInterval is the loose-end backstop cadence. Hourly, carried over from the memdistill sweep hook
// this used to ride: each tick can spend a judge call, so the rate is a cost, not just a latency.
const sweepInterval = time.Hour

// StartLooseEndSweep runs a startup sweep and then an hourly backstop until ctx is cancelled. It
// replaces the memdistill sweep hook that used to drive SweepLooseEnds. Each sweep is wrapped
// individually, as the hook runner was: one panicking sweep must not end the ticker.
func StartLooseEndSweep(ctx context.Context) {
	sweep := func() {
		defer func() { panichandler.PanicHandler("jarvisvolunteer.sweep", recover()) }()
		SweepLooseEnds()
	}
	go func() {
		defer func() { panichandler.PanicHandler("jarvisvolunteer.sweep-loop", recover()) }()
		sweep()
		t := time.NewTicker(sweepInterval)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				sweep()
			}
		}
	}()
}
