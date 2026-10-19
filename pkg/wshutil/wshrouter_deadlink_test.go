// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshutil

import (
	"bytes"
	"fmt"
	"log"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/baseds"
)

// panicLog counts the "[panic] in" lines panichandler.PanicHandler writes to the standard logger.
type panicLog struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (p *panicLog) Write(b []byte) (int, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.buf.Write(b)
}

func (p *panicLog) Load() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return strings.Count(p.buf.String(), "[panic] in ")
}

func capturePanicLogs(t *testing.T) *panicLog {
	p := &panicLog{}
	prev := log.Writer()
	log.SetOutput(p)
	t.Cleanup(func() { log.SetOutput(prev) })
	return p
}

// A connection that dies without anyone calling UnregisterLink (handleDomainSocketClient's teardown
// could miss its link id) left a registered link whose ToRemoteCh was closed. One reply routed to it
// panicked, went to the backlog, and processBacklog retried it every 50ms for the server's lifetime:
// ~20 panics/s, each a stack dump plus a telemetry row (seen in prod as 1M+ debug:panic a day).
func TestDeadLinkIsNotRetriedForever(t *testing.T) {
	panics := capturePanicLogs(t)

	router := NewWshRouter()
	proxy := MakeRpcProxy("test")
	linkId := router.RegisterUntrustedLink(proxy)

	// the connection goes away, but its teardown never unregisters the link
	close(proxy.FromRemoteCh)
	close(proxy.ToRemoteCh)
	// a reply addressed to the dead link arrives afterwards
	router.sendMessageToLink([]byte(`{"resid":"r1"}`), linkId, baseds.NoLinkId)

	// a retry or two can land before the link's recv loop sees EOF; what matters is that they stop
	deadline := time.Now().Add(time.Second)
	for router.getLinkMeta(linkId) != nil {
		if time.Now().After(deadline) {
			t.Fatalf("link whose input closed is still registered after 1s (%d panics so far)", panics.Load())
		}
		time.Sleep(10 * time.Millisecond)
	}
	settled := panics.Load()
	time.Sleep(300 * time.Millisecond) // six backlog rounds
	if n := panics.Load(); n != settled {
		t.Fatalf("panics kept coming after the link was unregistered: %d -> %d", settled, n)
	}
	router.lock.Lock()
	backlog := len(router.linkMsgBacklog[linkId])
	router.lock.Unlock()
	if backlog != 0 {
		t.Fatalf("dead link still holds %d backlogged messages", backlog)
	}
}

func (p *panicLog) Contains(s string) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	return strings.Contains(p.buf.String(), s)
}

// gatedClient accepts `budget` sends and refuses the rest; a negative budget accepts every send.
type gatedClient struct {
	mu     sync.Mutex
	budget int
	got    []string
	done   chan struct{}
}

func newGatedClient(t *testing.T) *gatedClient {
	c := &gatedClient{done: make(chan struct{})}
	t.Cleanup(func() { close(c.done) })
	return c
}

func (c *gatedClient) GetPeerInfo() string { return "gated" }

func (c *gatedClient) SendRpcMessage(msg []byte, ingressLinkId baseds.LinkId, debugStr string) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.budget == 0 {
		return false
	}
	if c.budget > 0 {
		c.budget--
	}
	c.got = append(c.got, string(msg))
	return true
}

func (c *gatedClient) RecvRpcMessage() ([]byte, bool) {
	<-c.done
	return nil, false
}

func (c *gatedClient) setBudget(n int) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.budget = n
}

func (c *gatedClient) received() []string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return slices.Clone(c.got)
}

func waitUntil(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

// a live link's backlog keeps what it could not send, delivers it in order once the link accepts, and
// leaves no backlog state behind
func TestBacklogDrainsInOrderAcrossPartialSends(t *testing.T) {
	router := NewWshRouter()
	client := newGatedClient(t)
	linkId := router.RegisterUntrustedLink(client)

	router.sendMessageToLink([]byte("m1"), linkId, baseds.NoLinkId)
	router.sendMessageToLink([]byte("m2"), linkId, baseds.NoLinkId)
	time.Sleep(120 * time.Millisecond) // two backlog rounds that every send is refused in

	client.setBudget(1)
	waitUntil(t, "m1 delivered", func() bool { return len(client.received()) == 1 })
	router.lock.Lock()
	var pending []string
	for _, msg := range router.linkMsgBacklog[linkId] {
		pending = append(pending, string(msg.msgBytes))
	}
	client.setBudget(-1)
	router.lock.Unlock()
	if !slices.Equal(pending, []string{"m2"}) {
		t.Fatalf("backlog after a partial send = %v, want [m2]", pending)
	}

	waitUntil(t, "m2 delivered", func() bool { return len(client.received()) == 2 })
	if got := client.received(); !slices.Equal(got, []string{"m1", "m2"}) {
		t.Fatalf("delivered %v, want [m1 m2]", got)
	}
	router.lock.Lock()
	_, hasBacklog := router.linkMsgBacklog[linkId]
	_, hasHighWater := router.backlogHighWaterMark[linkId]
	router.lock.Unlock()
	if hasBacklog || hasHighWater {
		t.Fatalf("drained link kept backlog state: backlog %v, highwater %v", hasBacklog, hasHighWater)
	}
}

func TestBacklogOfUnregisteredLinkIsCleared(t *testing.T) {
	logs := capturePanicLogs(t)
	router := NewWshRouter()
	linkId := router.RegisterUntrustedLink(newGatedClient(t))
	router.sendMessageToLink([]byte("m1"), linkId, baseds.NoLinkId)
	router.UnregisterLink(linkId)

	waitUntil(t, "the gone link's backlog to clear", func() bool {
		router.lock.Lock()
		defer router.lock.Unlock()
		_, ok := router.linkMsgBacklog[linkId]
		return !ok
	})
	router.lock.Lock()
	_, hasHighWater := router.backlogHighWaterMark[linkId]
	router.lock.Unlock()
	if hasHighWater {
		t.Fatal("gone link kept its backlog high-water mark")
	}
	want := fmt.Sprintf("backlog for linkid=%d cleared, link gone (highwater mark was 1 messages)", linkId)
	if !logs.Contains(want) {
		t.Fatalf("log is missing %q", want)
	}
}
