// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentobserve

import "testing"

func TestIsHeadlessEntrypoint(t *testing.T) {
	for entrypoint, want := range map[string]bool{
		HeadlessEntrypoint:    true,
		BoardDrawerEntrypoint: true, // a print-mode run: no hook of it is a session, and history never lists it
		"cli":                 false,
		"bench":               false,
		"":                    false,
	} {
		if got := IsHeadlessEntrypoint(entrypoint); got != want {
			t.Errorf("IsHeadlessEntrypoint(%q) = %v, want %v", entrypoint, got, want)
		}
	}
}

// the board drawer's tokens are the person's spend on their project, so Usage counts them; every other print-mode run
// is arcterm's own maintenance and stays out
func TestCountsInUsage(t *testing.T) {
	for entrypoint, want := range map[string]bool{
		BoardDrawerEntrypoint: true,
		HeadlessEntrypoint:    false,
		"cli":                 false,
		"":                    false,
	} {
		if got := CountsInUsage(entrypoint); got != want {
			t.Errorf("CountsInUsage(%q) = %v, want %v", entrypoint, got, want)
		}
	}
}

// Claude Desktop's Import of CLI sessions hides every sdk-* entrypoint: the drawer's transcripts stay out of its sidebar
func TestBoardDrawerEntrypointHasTheSdkPrefix(t *testing.T) {
	if got := BoardDrawerEntrypoint; len(got) < 4 || got[:4] != "sdk-" || got == HeadlessEntrypoint {
		t.Errorf("BoardDrawerEntrypoint = %q, want an sdk- value other than %q", got, HeadlessEntrypoint)
	}
}
