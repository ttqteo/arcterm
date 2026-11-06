// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jarvis

import (
	"cmp"
	"fmt"
	"slices"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

// MaxPinnedEfforts caps the initiatives pinned to the Brief's cards.
const MaxPinnedEfforts = 6

// PinPlan is what one pin or unpin call does: the efforts whose PinnedTs is cleared, the one stamped with
// the call's time, and whether the cap refused it. A refused plan clears and stamps nothing.
type PinPlan struct {
	Clear      []string        // oids to unpin (the oldest pins, when replacing)
	Stamp      string          // the oid to pin; "" when nothing is pinned by this call
	StampTs    int64           // the PinnedTs Stamp gets: the call's time
	Pinned     bool            // the target's pin state after the call
	CapReached bool            // the pin was refused: MaxPinnedEfforts are pinned already
	Oldest     *waveobj.Effort // the oldest pin, when CapReached
}

// PlanPin decides a pin (pin true) or an unpin of targetOID over every effort. Archived efforts neither
// count toward the cap nor get pinned. Pinning an effort already pinned keeps its time. At the cap, a pin
// without replaceOldest changes nothing and names the oldest pin (smallest PinnedTs); with replaceOldest it
// unpins the oldest pins until the new one fits.
func PlanPin(all []*waveobj.Effort, targetOID string, pin, replaceOldest bool, now int64) (PinPlan, error) {
	var target *waveobj.Effort
	var pinned []*waveobj.Effort
	for _, e := range all {
		if e.OID == targetOID {
			target = e
			continue
		}
		if e.Status != "archived" && e.PinnedTs > 0 {
			pinned = append(pinned, e)
		}
	}
	if target == nil {
		return PinPlan{}, fmt.Errorf("EC-NOT-FOUND: effort %s not found", targetOID)
	}
	if !pin {
		if target.PinnedTs == 0 {
			return PinPlan{}, nil
		}
		return PinPlan{Clear: []string{target.OID}}, nil
	}
	if target.Status == "archived" {
		return PinPlan{}, fmt.Errorf("EC-ARCHIVED: an archived initiative can't be pinned")
	}
	if target.PinnedTs > 0 {
		return PinPlan{Pinned: true}, nil
	}
	// oldest first; the oid breaks a tie so the answer does not depend on the listing's order
	slices.SortFunc(pinned, func(a, b *waveobj.Effort) int {
		return cmp.Or(cmp.Compare(a.PinnedTs, b.PinnedTs), cmp.Compare(a.OID, b.OID))
	})
	over := len(pinned) - MaxPinnedEfforts + 1
	if over <= 0 {
		return PinPlan{Stamp: target.OID, StampTs: now, Pinned: true}, nil
	}
	if !replaceOldest {
		return PinPlan{CapReached: true, Oldest: pinned[0]}, nil
	}
	plan := PinPlan{Stamp: target.OID, StampTs: now, Pinned: true}
	for _, e := range pinned[:over] {
		plan.Clear = append(plan.Clear, e.OID)
	}
	return plan, nil
}
