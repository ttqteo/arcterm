// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package remotemode

import (
	"context"
	"slices"
	"strings"
	"testing"
)

// The phone page's volume buttons send exactly these steps; the handler validates against the same list.
func TestPCVolumeStepsAreTheButtons(t *testing.T) {
	if want := []string{"down", "mute", "up"}; !slices.Equal(pcVolumeSteps, want) {
		t.Fatalf("pcVolumeSteps = %v, want %v", pcVolumeSteps, want)
	}
}

func TestPCCheckStep(t *testing.T) {
	for _, step := range pcVolumeSteps {
		if err := pcCheckStep(step); err != nil {
			t.Errorf("pcCheckStep(%q) = %v, want nil", step, err)
		}
	}
	for _, step := range []string{"", "louder", "Up", "up ", "DOWN", "0xAF", "down,up"} {
		err := pcCheckStep(step)
		if err == nil {
			t.Errorf("pcCheckStep(%q) = nil, want an error", step)
			continue
		}
		// the error names the step it refused and the steps it takes, so the page's error line says what was wrong
		if !strings.Contains(err.Error(), `"`+step+`"`) || !strings.Contains(err.Error(), "down, mute, up") {
			t.Errorf("pcCheckStep(%q) = %q, want it to name the step and the allowed steps", step, err)
		}
	}
}

// A bad step is refused before any platform code runs: nothing is pressed, no command runs.
func TestPCVolumeRefusesABadStep(t *testing.T) {
	for _, step := range []string{"", "louder", "Up"} {
		err := pcVolume(context.Background(), step)
		if err == nil {
			t.Errorf("pcVolume(%q) = nil, want an error", step)
		} else if !strings.Contains(err.Error(), "down, mute, up") {
			t.Errorf("pcVolume(%q) = %q, want it to list the allowed steps", step, err)
		}
	}
}
