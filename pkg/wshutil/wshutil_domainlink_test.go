// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshutil

import (
	"net"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/baseds"
)

// A wsh that disconnects from the domain socket must end the streaming RPCs that entered on its link
// (a held job slot), as the websocket teardown in pkg/web/ws.go does: DomainLinkClosedHook is how wavesrv
// gets the link id at that moment.
func TestDomainLinkClosedHook(t *testing.T) {
	prevRouter, prev := DefaultRouter, DomainLinkClosedHook
	t.Cleanup(func() { DefaultRouter, DomainLinkClosedHook = prevRouter, prev })
	DefaultRouter = NewWshRouter() // only wavesrv's main sets one
	closed := make(chan baseds.LinkId, 4)
	DomainLinkClosedHook = func(linkId baseds.LinkId) { closed <- linkId }

	serverEnd, clientEnd := net.Pipe()
	handleDomainSocketClient(serverEnd, nil)
	clientEnd.Close()

	select {
	case linkId := <-closed:
		if linkId == baseds.NoLinkId {
			t.Fatal("hook got baseds.NoLinkId, want the link's id")
		}
	case <-time.After(time.Second):
		t.Fatal("DomainLinkClosedHook did not run within 1s of the client closing")
	}
	select {
	case linkId := <-closed:
		t.Fatalf("hook ran twice for one link (second call: link %d)", linkId)
	case <-time.After(100 * time.Millisecond):
	}
}
