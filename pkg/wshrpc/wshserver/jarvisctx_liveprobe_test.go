// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build liveprobe

// Live probe timing the run lookup behind every `wsh jarvis dag` command (JarvisCtxCommand ->
// ownerRunForBlock) against a VACUUM INTO snapshot of the real store, alone and under the loads that could
// stall it: the read pool held by whole-channel run reads, and the write connection held by a long write.
//
//	ARC_SNAPSHOT_DIR=<dir holding db/waveterm.db> PROBE_BLOCK=<block oid> PROBE_CHANNEL=<busiest channel oid> \
//	  go test -tags liveprobe -run TestJarvisCtxStallProbe -v ./pkg/wshrpc/wshserver/
package wshserver

import (
	"context"
	"fmt"
	"os"
	"sort"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

func TestJarvisCtxStallProbe(t *testing.T) {
	snap, block, channel := os.Getenv("ARC_SNAPSHOT_DIR"), os.Getenv("PROBE_BLOCK"), os.Getenv("PROBE_CHANNEL")
	if snap == "" || block == "" || channel == "" {
		t.Skip("set ARC_SNAPSHOT_DIR, PROBE_BLOCK and PROBE_CHANNEL")
	}
	wavebase.DataHome_VarCache = snap
	if err := wstore.InitWStore(); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	blockORef := waveobj.MakeORef(waveobj.OType_Block, block).String()
	if _, _, ok := ownerRunForBlock(ctx, blockORef); !ok {
		t.Fatalf("block %s resolves no run in the snapshot", block)
	}
	lookups := func(label string, n int) {
		ds := make([]time.Duration, n)
		for i := range ds {
			start := time.Now()
			ownerRunForBlock(ctx, blockORef)
			ds[i] = time.Since(start)
		}
		sort.Slice(ds, func(i, j int) bool { return ds[i] < ds[j] })
		fmt.Printf("%-44s n=%d p50=%v p95=%v max=%v\n", label, n, ds[n/2].Round(time.Millisecond), ds[n*95/100].Round(time.Millisecond), ds[n-1].Round(time.Millisecond))
	}
	// under runs fn on k goroutines until the lookups are done
	under := func(label string, k int, fn func()) {
		var stop atomic.Bool
		var wg sync.WaitGroup
		var ops atomic.Int64
		for range k {
			wg.Add(1)
			go func() {
				defer wg.Done()
				for !stop.Load() {
					fn()
					ops.Add(1)
				}
			}()
		}
		time.Sleep(200 * time.Millisecond)
		lookups(label, 40)
		stop.Store(true)
		wg.Wait()
		fmt.Printf("%-44s background ops=%d\n", "", ops.Load())
	}

	lookups("lookup alone", 100)

	start := time.Now()
	runs, err := wstore.GetChannelRuns(ctx, channel)
	if err != nil {
		t.Fatal(err)
	}
	fmt.Printf("%-44s %d runs in %v\n", "GetChannelRuns(busiest channel) alone", len(runs), time.Since(start).Round(time.Millisecond))

	channelRuns := func() { wstore.GetChannelRuns(ctx, channel) }
	for _, k := range []int{1, 4, 8, 16, 32} {
		under(fmt.Sprintf("lookup under %d GetChannelRuns readers", k), k, channelRuns)
	}
	// a write transaction held for 3s: WAL readers should not wait on it
	under("lookup under a 3s write transaction", 1, func() {
		wstore.WithTx(ctx, func(tx *wstore.TxWrap) error {
			tx.Exec(`UPDATE db_run SET version = version WHERE oid = (SELECT oid FROM db_run LIMIT 1)`)
			time.Sleep(3 * time.Second)
			return nil
		})
	})
}
