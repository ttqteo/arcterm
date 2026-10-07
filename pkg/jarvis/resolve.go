// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package jarvis is the home for the Jarvis manager's acting tiers. This tier (Gatekeeper) watches
// for worker asks on gatekeeper-enabled channels, classifies them with a headless claude, and either
// auto-answers routine ones or escalates genuine forks. Concierge (read+post) is separate for now.
package jarvis

import (
	"context"
	"fmt"
	"log"
	"slices"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// MetaKey_GatekeeperEnabled is the per-channel bool flag toggling Gatekeeper for that channel.
const MetaKey_GatekeeperEnabled = "gatekeeper:enabled"

// The two autonomy tiers a channel can be set to.
const (
	Tier_Concierge  = "concierge"
	Tier_Gatekeeper = "gatekeeper"
)

// GatekeeperOn reports whether the Gatekeeper judges asks for the channel. It is on unless the channel
// was explicitly set to concierge: a project nobody has configured gets routine asks answered, and
// only an explicit concierge pick sends every ask to you.
func GatekeeperOn(ch *waveobj.Channel) bool {
	return ch.Meta.GetBool(MetaKey_GatekeeperEnabled, true)
}

// GatekeeperForTier maps a tier name to the channel's gatekeeper flag. An unknown tier is an error
// rather than a silent concierge, which would quietly stop the Gatekeeper for that project.
func GatekeeperForTier(tier string) (bool, error) {
	switch tier {
	case Tier_Gatekeeper:
		return true, nil
	case Tier_Concierge:
		return false, nil
	default:
		return false, fmt.Errorf("unknown autonomy tier %q (want %s or %s)", tier, Tier_Concierge, Tier_Gatekeeper)
	}
}

// workerMessages returns every message that references the worker at workerORef ("tab:<id>"), across
// channels, oldest first. A read failure is logged and reads as no messages.
func workerMessages(ctx context.Context, workerORef string) []*waveobj.ChannelMessage {
	msgs, err := wstore.GetMessagesByRef(ctx, workerORef)
	if err != nil {
		log.Printf("jarvis: reading the messages of worker %s: %v", workerORef, err)
		return nil
	}
	return msgs
}

// earliestOwner returns the channel of the earliest of msgs whose kind is one of kinds and whose channel
// passes ok. A message whose channel is gone is skipped.
func earliestOwner(ctx context.Context, msgs []*waveobj.ChannelMessage, ok func(*waveobj.Channel) bool, kinds ...string) *waveobj.Channel {
	for _, m := range msgs {
		if !slices.Contains(kinds, m.Kind) {
			continue
		}
		ch, err := wstore.DBGet[*waveobj.Channel](ctx, m.ChannelOID)
		if err != nil {
			log.Printf("jarvis: loading channel %s of message %s: %v", m.ChannelOID, m.ID, err)
			continue
		}
		if ch != nil && ok(ch) {
			return ch
		}
	}
	return nil
}

// resolveGatekeeperChannel returns the gatekeeper-enabled channel that dispatched the worker whose
// messages are msgs, or nil. A channel owns a worker if it has a dispatch/directive message for it. The
// earliest such message in an enabled channel wins (a worker in one channel is the norm).
func resolveGatekeeperChannel(ctx context.Context, msgs []*waveobj.ChannelMessage) *waveobj.Channel {
	return earliestOwner(ctx, msgs, GatekeeperOn, "dispatch", "directive")
}

// ResolveDispatchChannel returns the channel that dispatched the worker at workerORef ("tab:<id>"),
// or nil. Unlike resolveGatekeeperChannel it is NOT gated by MetaKey_GatekeeperEnabled: a worker's
// outcome belongs in its channel regardless of the channel's autonomy tier. The earliest dispatch wins.
func ResolveDispatchChannel(ctx context.Context, workerORef string) *waveobj.Channel {
	anyChannel := func(*waveobj.Channel) bool { return true }
	return earliestOwner(ctx, workerMessages(ctx, workerORef), anyChannel, "dispatch")
}

// workerTaskFor returns the text of the worker's first dispatch in the channel (its task), or "" if
// there is none. msgs are the worker's own messages.
func workerTaskFor(msgs []*waveobj.ChannelMessage, channelId string) string {
	for _, m := range msgs {
		if m.Kind == "dispatch" && m.ChannelOID == channelId {
			return m.Text
		}
	}
	return ""
}

// RunWorkerMatch locates a run phase worker: the channel/run it belongs to and the phase index.
type RunWorkerMatch struct {
	Channel  *waveobj.Channel
	Run      *waveobj.Run
	PhaseIdx int
}

// ResolveRunWorkerFromMeta resolves the run/channel/phase owning a worker oref by reading the owner
// stamp (jarvis:runoref/channeloref) off the worker tab, then loading the run + channel rows. It is NOT
// gated by the tier: it answers "whose worker is this", and handleAsk applies the tier to the channel it
// returns. On any miss (unstamped worker, empty runoref, load error) it falls back to the run-row scan so
// a best-effort stamp gap can never regress resolution. nil = no run.
func ResolveRunWorkerFromMeta(ctx context.Context, askingORef string) *RunWorkerMatch {
	runORef, channelORef, err := wstore.GetWorkerOwner(ctx, askingORef)
	if err != nil || runORef == "" || channelORef == "" {
		return resolveRunWorkerByScan(ctx, askingORef)
	}
	runRef, err1 := waveobj.ParseORef(runORef)
	chRef, err2 := waveobj.ParseORef(channelORef)
	if err1 != nil || err2 != nil {
		return resolveRunWorkerByScan(ctx, askingORef)
	}
	run, err := wstore.GetRun(ctx, chRef.OID, runRef.OID)
	if err != nil || run == nil {
		return resolveRunWorkerByScan(ctx, askingORef)
	}
	ch, err := wstore.DBMustGet[*waveobj.Channel](ctx, chRef.OID)
	if err != nil || ch == nil {
		return resolveRunWorkerByScan(ctx, askingORef)
	}
	phaseIdx := phaseIdxForWorker(run, askingORef)
	if phaseIdx < 0 {
		// stamp is stale (worker no longer in a phase) — trust the scan
		return resolveRunWorkerByScan(ctx, askingORef)
	}
	return &RunWorkerMatch{Channel: ch, Run: run, PhaseIdx: phaseIdx}
}

func phaseIdxForWorker(run *waveobj.Run, workerORef string) int {
	for pi := range run.Phases {
		for _, wo := range run.Phases[pi].WorkerOrefs {
			if wo == workerORef {
				return pi
			}
		}
	}
	return -1
}

// resolveRunWorkerByScan is the fallback for a worker with no usable stamp: the oldest run row one of
// whose phases lists the oref. The store only narrows the rows to those whose text contains the oref, so
// a run that merely quotes it (in its goal, say) is ruled out here. A run whose channel is gone is skipped.
func resolveRunWorkerByScan(ctx context.Context, askingORef string) *RunWorkerMatch {
	runs, err := wstore.GetRunCandidatesByWorker(ctx, askingORef)
	if err != nil {
		log.Printf("jarvis: finding the run of worker %s: %v", askingORef, err)
		return nil
	}
	for _, run := range runs {
		phaseIdx := phaseIdxForWorker(run, askingORef)
		if phaseIdx < 0 {
			continue
		}
		ch, err := wstore.DBGet[*waveobj.Channel](ctx, run.ChannelOID)
		if err != nil {
			log.Printf("jarvis: loading channel %s of run %s: %v", run.ChannelOID, run.ID, err)
			continue
		}
		if ch != nil {
			return &RunWorkerMatch{Channel: ch, Run: run, PhaseIdx: phaseIdx}
		}
	}
	return nil
}

// resolveGatekeeperChannelByMeta resolves the gatekeeper-enabled channel that dispatched a concierge
// worker via the channeloref stamp, returning the channel + its dispatch task text. Falls back to the
// worker's dispatch/directive messages on a stamp miss. Returns (nil, "") when no gatekeeper-enabled
// channel owns it.
func resolveGatekeeperChannelByMeta(ctx context.Context, ownerORef string) (*waveobj.Channel, string) {
	msgs := workerMessages(ctx, ownerORef)
	_, channelORef, err := wstore.GetWorkerOwner(ctx, ownerORef)
	if err == nil && channelORef != "" {
		if chRef, perr := waveobj.ParseORef(channelORef); perr == nil {
			if ch, gerr := wstore.DBMustGet[*waveobj.Channel](ctx, chRef.OID); gerr == nil && ch != nil {
				if GatekeeperOn(ch) {
					return ch, workerTaskFor(msgs, ch.OID)
				}
				return nil, "" // owned by a non-gatekeeper channel: not gatekept
			}
		}
	}
	ch := resolveGatekeeperChannel(ctx, msgs)
	if ch == nil {
		return nil, ""
	}
	return ch, workerTaskFor(msgs, ch.OID)
}

// RunOwnsWorker reports whether workerORef ("tab:<id>") is a recorded worker of the run — it appears in
// some phase's WorkerOrefs. Guards per-worker stop actions so only a worker the run actually owns can be
// targeted (never an arbitrary tab).
func RunOwnsWorker(run *waveobj.Run, workerORef string) bool {
	if run == nil {
		return false
	}
	for pi := range run.Phases {
		for _, wo := range run.Phases[pi].WorkerOrefs {
			if wo == workerORef {
				return true
			}
		}
	}
	return false
}

// runWorkerTask is the classifier "task" context for a run worker: the phase it is executing, framed
// against the whole run goal. Falls back to the bare goal for an out-of-range index.
func runWorkerTask(run *waveobj.Run, phaseIdx int) string {
	return runWorkerFrame(run, phaseIdx, run.Goal)
}

// runWorkerSource is the same frame around the goal's headline, for an attention row: the row's text is
// the worker's question, and a whole goal in front of it hides it.
func runWorkerSource(run *waveobj.Run, phaseIdx int) string {
	return runWorkerFrame(run, phaseIdx, goalHeadline(run.Goal))
}

func runWorkerFrame(run *waveobj.Run, phaseIdx int, goal string) string {
	if phaseIdx < 0 || phaseIdx >= len(run.Phases) {
		return goal
	}
	p := run.Phases[phaseIdx]
	skill := p.Skill
	if skill == "" {
		skill = p.Kind
	}
	return fmt.Sprintf("%s phase (%s) of run goal: %s", p.Kind, skill, goal)
}
