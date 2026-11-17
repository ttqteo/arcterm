// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jarvis

import (
	"cmp"
	"context"
	"slices"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// runWorkerIndex maps each worker oref a run's phase lists to the ids of those runs, oldest run first. A tab with
// no owner stamp (every agent a person opened by hand) is looked up on each ask, attention pass, effort update and
// resmon owner read, and the substring scan of db_run it replaces (instr over every row's data) read every run row
// to answer each one: on a store of 3,392 runs (36 MB) that kept wavesrv reading ~175 MB/s and the store's calls timing out
// (2026-11-17). The index is rebuilt only when a run was written since it was built (wstore.RunGen), from the shared
// run rows, which decode only the rows that changed; runWorkerIndexMaxAge is a backstop for a write the count missed.
type runWorkerIndex struct {
	mu       sync.Mutex
	built    bool
	gen      uint64
	at       time.Time
	byWorker map[string][]string
}

const runWorkerIndexMaxAge = 5 * time.Minute

var runWorkers = &runWorkerIndex{}

// loadIndexRuns reads every run row for a rebuild. A var so tests count the rebuilds.
var loadIndexRuns = func(ctx context.Context) ([]*waveobj.Run, error) {
	return wstore.DBGetAllObjsByTypeShared[*waveobj.Run](ctx, waveobj.OType_Run)
}

// candidates returns, oldest first, fresh copies of the runs whose phases list workerORef: callers may change
// them, so they are read from their rows rather than handed the shared objects the index was built from.
func (x *runWorkerIndex) candidates(ctx context.Context, workerORef string) ([]*waveobj.Run, error) {
	if workerORef == "" {
		return nil, nil
	}
	ids, err := x.lookup(ctx, workerORef)
	if err != nil {
		return nil, err
	}
	runs := make([]*waveobj.Run, 0, len(ids))
	for _, id := range ids {
		run, err := wstore.DBGet[*waveobj.Run](ctx, id)
		if err != nil {
			return nil, err
		}
		if run != nil {
			runs = append(runs, run)
		}
	}
	return runs, nil
}

// lookup is the ids of the runs listing workerORef, rebuilding the index first when a run was written since it
// was built or it has aged past runWorkerIndexMaxAge.
func (x *runWorkerIndex) lookup(ctx context.Context, workerORef string) ([]string, error) {
	x.mu.Lock()
	defer x.mu.Unlock()
	// read before the rows, so a write that lands while they are read leaves the count ahead of the index
	gen := wstore.RunGen()
	if !x.built || x.gen != gen || time.Since(x.at) >= runWorkerIndexMaxAge {
		runs, err := loadIndexRuns(ctx)
		if err != nil {
			return nil, err
		}
		x.byWorker = indexRunWorkers(runs)
		x.built, x.gen, x.at = true, gen, time.Now()
	}
	return slices.Clone(x.byWorker[workerORef]), nil
}

// indexRunWorkers maps each worker oref to the ids of the runs whose phases list it, oldest run first; runs
// created at the same time keep the order they came in. It only reads the runs, which may be shared.
func indexRunWorkers(runs []*waveobj.Run) map[string][]string {
	sorted := slices.Clone(runs)
	slices.SortStableFunc(sorted, func(a, b *waveobj.Run) int {
		return cmp.Compare(a.CreatedTs, b.CreatedTs)
	})
	idx := map[string][]string{}
	for _, run := range sorted {
		for _, phase := range run.Phases {
			for _, wo := range phase.WorkerOrefs {
				if wo == "" {
					continue
				}
				if ids := idx[wo]; len(ids) > 0 && ids[len(ids)-1] == run.OID {
					continue
				}
				idx[wo] = append(idx[wo], run.OID)
			}
		}
	}
	return idx
}
