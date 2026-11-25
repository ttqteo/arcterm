// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentmsg

import (
	"strings"
	"sync"
	"testing"
)

func TestEnvelopeNamesTheSenderAndKeepsTheText(t *testing.T) {
	text := "rename the helper\nand rerun the tests"
	got := Envelope("design lead", "tab-1234", text)
	if !IsAgentMessage(got) {
		t.Fatalf("Envelope output is not an agent message: %q", got)
	}
	header, body, found := strings.Cut(got, "\n")
	if !found || body != text {
		t.Fatalf("body = %q, want the text unchanged after one header line", body)
	}
	for _, want := range []string{`"design lead"`, "tab tab-1234", "Not typed by the user"} {
		if !strings.Contains(header, want) {
			t.Errorf("header %q does not hold %q", header, want)
		}
	}
}

// a message is typed into the receiver's prompt, where a leading slash would run a command
func TestEnvelopeNeverStartsWithASlash(t *testing.T) {
	got := Envelope("a", "t1", "/clear")
	if strings.HasPrefix(got, "/") {
		t.Fatalf("envelope starts with a slash: %q", got)
	}
	if !strings.HasSuffix(got, "\n/clear") {
		t.Fatalf("envelope does not end with the text: %q", got)
	}
}

// a pair's relayed prompt reads as an agent message, not something the person typed, and says it was not sent with
// wsh agents send: the receiver's reply passes back on its own
func TestPairEnvelopeIsAnAgentMessageFromThePair(t *testing.T) {
	text := "From the judge \"x\", 14:05:\nreopen it\n\nFrom the person, 14:09:\nok"
	got := PairEnvelope(text)
	if !IsAgentMessage(got) {
		t.Fatalf("PairEnvelope output is not an agent message: %q", got)
	}
	header, body, found := strings.Cut(got, "\n")
	if !found || body != text {
		t.Fatalf("body = %q, want the text unchanged after one header line", body)
	}
	for _, want := range []string{"arcterm pair", "Not typed by the user", "passes back on its own", "answer here", "do not use wsh agents send"} {
		if !strings.Contains(header, want) {
			t.Errorf("header %q does not hold %q", header, want)
		}
	}
	// it is not Envelope's "sent with wsh agents send" form, which names an agent and its tab
	if strings.Contains(header, "sent with wsh agents send") || strings.Contains(header, "(tab ") {
		t.Errorf("header %q reads like an agent's envelope", header)
	}
}

func TestPairEnvelopeNeverStartsWithASlash(t *testing.T) {
	got := PairEnvelope("/clear")
	if strings.HasPrefix(got, "/") || !strings.HasSuffix(got, "\n/clear") {
		t.Fatalf("envelope = %q", got)
	}
}

func TestEnvelopeOrdinaryTextIsNotAnAgentMessage(t *testing.T) {
	for _, text := range []string{"", "fix the bug", "/compact", "[Request interrupted by user]", `he said [Message from agent "x"`} {
		if IsAgentMessage(text) {
			t.Errorf("IsAgentMessage(%q) = true", text)
		}
	}
}

func TestSendBackLockedUntilTheTurnEnds(t *testing.T) {
	t.Cleanup(func() { TurnEnded("b") })
	NoteSent("a", "b")
	if !SendBackLocked("b", "a") {
		t.Fatal("b may message a back within the turn a messaged it in")
	}
	if SendBackLocked("a", "b") {
		t.Fatal("a is locked from messaging b again")
	}
	if SendBackLocked("b", "c") {
		t.Fatal("b is locked from messaging c, which never messaged it")
	}
	TurnEnded("b")
	if SendBackLocked("b", "a") {
		t.Fatal("b is still locked after its turn ended")
	}
}

func TestSendBackLockIsSafeForConcurrentUse(t *testing.T) {
	t.Cleanup(func() { TurnEnded("x"); TurnEnded("y") })
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			NoteSent("x", "y")
			SendBackLocked("y", "x")
			TurnEnded("y")
			NoteSent("y", "x")
		}()
	}
	wg.Wait()
}

// a second sender in the same turn does not open the lock on the first
func TestSendBackLockedForEverySenderOfTheTurn(t *testing.T) {
	t.Cleanup(func() { TurnEnded("b") })
	NoteSent("a", "b")
	NoteSent("c", "b")
	for _, sender := range []string{"a", "c"} {
		if !SendBackLocked("b", sender) {
			t.Errorf("b may message %s, which messaged it this turn", sender)
		}
	}
	TurnEnded("b")
	for _, sender := range []string{"a", "c"} {
		if SendBackLocked("b", sender) {
			t.Errorf("b is still locked against %s after its turn ended", sender)
		}
	}
}
