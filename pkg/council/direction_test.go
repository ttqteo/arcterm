// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package council

import (
	"strings"
	"testing"
)

// TestDirectionRefusesAnUnknownAction: a word that is not one of the eight actions is refused with an error naming it,
// and nothing is saved, so a typo never reads as a silent no-op.
func TestDirectionRefusesAnUnknownAction(t *testing.T) {
	t.Cleanup(UseRootForTest(t.TempDir()))
	if err := Save(&Council{Id: "c1", State: StateDone}); err != nil {
		t.Fatal(err)
	}
	r := &Runner{}
	for _, action := range []string{"", "chot", "SETX", "replace"} {
		c, err := r.Direction("c1", DirectionIn{Action: action, Text: "ship the small one"})
		if err == nil {
			t.Fatalf("action %q should be refused", action)
		}
		if c != nil {
			t.Errorf("action %q: a refused direction returned a council", action)
		}
		if !strings.Contains(err.Error(), "direction action") {
			t.Errorf("action %q: error %q should say it is an unknown direction action", action, err)
		}
	}
	got, err := Load("c1")
	if err != nil {
		t.Fatal(err)
	}
	if got.Memory != nil {
		t.Errorf("a refused direction left a memory behind: %+v", got.Memory)
	}
}

// TestDirectionActionWordsAreTheEightTheWireNames: the constants are the words the command and the frontend send.
func TestDirectionActionWordsAreTheEightTheWireNames(t *testing.T) {
	want := map[string]string{
		ActionSet: "set", ActionPin: "pin", ActionEdit: "edit", ActionAccept: "accept",
		ActionDismiss: "dismiss", ActionSetAnyway: "setanyway", ActionDiscard: "discard", ActionUnpin: "unpin",
	}
	for got, w := range want {
		if got != w {
			t.Errorf("action constant = %q, want %q", got, w)
		}
	}
	if len(want) != 8 {
		t.Errorf("%d distinct action words, want 8", len(want))
	}
}
