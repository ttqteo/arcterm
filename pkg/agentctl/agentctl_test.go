// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentctl

import "testing"

func TestSendReachesTheOpenStream(t *testing.T) {
	ch, done := Register("b1")
	defer done()
	if !Has("b1") || !Send("b1", Msg{Text: "wake"}) {
		t.Fatalf("an open stream did not take the text")
	}
	if got := <-ch; got.Text != "wake" {
		t.Fatalf("got %+v", got)
	}
}

func TestSendWithNoStreamIsRefused(t *testing.T) {
	if Has("none") || Send("none", Msg{Text: "wake"}) {
		t.Fatalf("a block with no stream took the text")
	}
	_, done := Register("b2")
	done()
	if Has("b2") || Send("b2", Msg{Text: "wake"}) {
		t.Fatalf("a closed stream took the text")
	}
}

func TestSendPastTheQueueIsRefused(t *testing.T) {
	_, done := Register("b3")
	defer done()
	for i := 0; i < queueSize; i++ {
		if !Send("b3", Msg{Text: "wake"}) {
			t.Fatalf("send %d refused under the queue size", i)
		}
	}
	if Send("b3", Msg{Text: "wake"}) {
		t.Fatalf("a full stream took the text")
	}
}

// a reload's new stream registers before the old process is gone; the old close must not drop it.
func TestAnOlderStreamsCloseKeepsTheNewer(t *testing.T) {
	_, oldDone := Register("b4")
	ch, done := Register("b4")
	defer done()
	oldDone()
	if !Send("b4", Msg{Text: "wake"}) {
		t.Fatalf("the newer stream was dropped by the older one's close")
	}
	if got := <-ch; got.Text != "wake" {
		t.Fatalf("got %+v", got)
	}
}
