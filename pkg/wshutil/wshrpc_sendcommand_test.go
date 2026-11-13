// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshutil

import (
	"sync"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// a request racing the input's close passed the server-done check, then sent on the output runServer had just
// closed: the recovered panic returned (nil, nil), and the caller dereferenced the nil handler. A request
// registered after the pending calls were failed would have waited on its response forever.
func TestRequestRacingCloseFailsCleanly(t *testing.T) {
	const rounds, senders = 200, 8
	for range rounds {
		inputCh := make(chan baseds.RpcInputChType)
		outputCh := make(chan []byte, 1)
		w := MakeWshRpcWithChannels(inputCh, outputCh, wshrpc.RpcContext{}, nil, "test")
		go func() {
			for range outputCh {
			}
		}()
		var wg sync.WaitGroup
		start := make(chan struct{})
		for range senders {
			wg.Go(func() {
				<-start
				for {
					h, err := w.SendComplexRequest("test", nil, &wshrpc.RpcOpts{Timeout: 60000})
					if err != nil {
						return
					}
					if h == nil {
						t.Error("SendComplexRequest returned no handler and no error")
						return
					}
					wg.Go(func() {
						got := make(chan error, 1)
						go func() {
							_, err := h.NextResponse()
							got <- err
						}()
						select {
						case err := <-got:
							h.finalize()
							if err == nil {
								t.Error("a call no one answered returned no error")
							}
						case <-time.After(5 * time.Second):
							t.Error("a call sent around the close still waits 5s on")
						}
					})
				}
			})
		}
		close(start)
		time.Sleep(50 * time.Microsecond)
		close(inputCh)
		wg.Wait()
		if t.Failed() {
			return
		}
	}
}
