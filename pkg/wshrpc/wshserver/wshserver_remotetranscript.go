// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"

	"github.com/wavetermdev/waveterm/pkg/remotemode"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// RemoteTranscript is remotemode.TranscriptHook: it drains streamTranscript into send as chunks, the first
// one the backlog (Backlog true), and returns the first error from send or from the stream, nil once ctx is
// done.
//
// The chunks carry no offsets yet (Cursor and End stay 0), and from is not honoured: every stream starts
// with the last defaultTranscriptTailLines lines, as the phone's stream always has.
func RemoteTranscript(ctx context.Context, path string, from int64, send func(remotemode.TranscriptChunk) error) error {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	ch := make(chan wshrpc.RespOrErrorUnion[wshrpc.AgentTranscriptUpdate], 16)
	streamDone := make(chan error, 1)
	go func() {
		streamDone <- streamTranscript(ctx, path, 0, ch)
	}()
	var first error
	// after the first failure, cancel and keep reading until the stream returns: it sends on ch
	// unguarded, so a reader that left would strand it
	fail := func(err error) {
		if first == nil {
			first = err
			cancel()
		}
	}
	// streamTranscript's first message is its backlog
	backlog := true
	deliver := func(lines []string) {
		chunk := remotemode.TranscriptChunk{Lines: lines, Backlog: backlog}
		backlog = false
		if err := send(chunk); err != nil {
			fail(err)
		}
	}
	for {
		select {
		case msg := <-ch:
			if first != nil {
				continue
			}
			if msg.Error != nil {
				fail(msg.Error)
			} else {
				deliver(msg.Response.Lines)
			}
		case err := <-streamDone:
			if err != nil {
				fail(err)
			}
			for {
				select {
				case msg := <-ch:
					if first == nil && msg.Error == nil {
						deliver(msg.Response.Lines)
					}
				default:
					return first
				}
			}
		}
	}
}
