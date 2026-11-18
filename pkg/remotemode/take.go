// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package remotemode

import (
	"context"
	"fmt"
)

// remoteTake is Deps.Take: it hands the tab to the phone, or returns an error wrapping ErrRefused with the
// reason the phone shows on the agent's row. It runs Hand's rule (resolve, Eligible, handAdd) but takes the
// tab exactly, not by prefix, and never starts remote mode: the phone is already talking to it. The hand-over
// is a phone take the owner has not acted on; a tab already handed over keeps the flags it has.
func remoteTake(ctx context.Context, tab string) error {
	agents, err := handAgents(ctx)
	if err != nil {
		return err
	}
	for _, a := range agents {
		if a.TabId != tab {
			continue
		}
		if err := Eligible(a); err != nil {
			return fmt.Errorf("%w: %s", ErrRefused, err)
		}
		handAddFrom(a, true)
		publishStatus()
		return nil
	}
	return fmt.Errorf("%w: its tab is gone", ErrRefused)
}

// remoteRelease is Deps.Release: it ends a take the owner never acted on, with reason EndTaken. For a tab
// that is not handed over, a hand-over made with Hand, or a take the owner has acted on, it does nothing and
// answers nil: the page leaves the agent view whatever became of the take.
func remoteRelease(_ context.Context, tab string) error {
	handMu.Lock()
	h := handed[tab]
	released := h != nil && h.phone && !h.acted
	if released {
		delete(handed, tab)
		handEnded[tab] = EndTaken
	}
	handMu.Unlock()
	if released {
		publishStatus()
	}
	return nil
}

// handMarkActed records that the owner acted on a handed-over tab from the phone, so leaving the agent view
// no longer releases it. remoteAct calls it after every action that succeeds.
func handMarkActed(tab string) {
	handMu.Lock()
	defer handMu.Unlock()
	if h := handed[tab]; h != nil {
		h.acted = true
	}
}
