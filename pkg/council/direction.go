// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package council

import (
	"errors"
	"fmt"
	"slices"
	"strings"
)

// The actions of Direction, the words CouncilDirectionCommand carries: set types a direction, pin (Chốt) takes one from
// an idea or a message, edit rewrites the chosen one, accept takes the waiting suggestion, dismiss turns it away,
// setanyway and discard settle the held card, and unpin takes the chosen direction off.
const (
	ActionSet       = "set"
	ActionPin       = "pin"
	ActionEdit      = "edit"
	ActionAccept    = "accept"
	ActionDismiss   = "dismiss"
	ActionSetAnyway = "setanyway"
	ActionDiscard   = "discard"
	ActionUnpin     = "unpin"
)

// directionActions is every action word, in the order the refusal lists them.
var directionActions = []string{
	ActionSet, ActionPin, ActionEdit, ActionAccept, ActionDismiss, ActionSetAnyway, ActionDiscard, ActionUnpin,
}

// DirectionIn is what a direction action carries. Text is the direction for set, pin and edit; From is the idea (P3) or
// message (r7) a pin comes from.
type DirectionIn struct {
	Action, Text, From string
}

// Direction applies one action to the council's direction memory and returns the council as saved. It refuses an action
// it does not know, naming it. It does not call r.changed: CouncilDirectionCommand publishes council:changed with what
// it returns, so doing both would announce one change twice.
func (r *Runner) Direction(id string, in DirectionIn) (*Council, error) {
	action := strings.ToLower(strings.TrimSpace(in.Action))
	if !slices.Contains(directionActions, action) {
		return nil, fmt.Errorf("unknown direction action %q: use %s", in.Action, strings.Join(directionActions, ", "))
	}
	return nil, errors.New("directions are not built yet")
}
