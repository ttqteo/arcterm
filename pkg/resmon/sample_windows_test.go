//go:build windows

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package resmon

import (
	"fmt"
	"os"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/util/jobobject"
)

const (
	benchJobs = 10
	benchKids = "3" // a root and three kids: four long-lived processes per job
)

// BenchmarkSample measures one sampler tick over 10 registered jobs; the result is recorded on sampleInterval.
func BenchmarkSample(b *testing.B) {
	for i := range benchJobs {
		startTree(b, jobobject.Owner{Kind: jobobject.OwnerKind_Block, Id: fmt.Sprintf("bench-%d", i)}, benchKids)
	}
	st := newTickState()
	if s := st.tick(); len(s.jobs) < benchJobs {
		b.Fatalf("tick saw %d jobs, want %d", len(s.jobs), benchJobs)
	}
	// wall time includes waits in the kernel; the CPU this process spends is what costs a core
	before := readStat(os.Getpid()).cpuTime
	b.ResetTimer()
	for range b.N {
		st.tick()
	}
	b.StopTimer()
	cpuMs := float64(readStat(os.Getpid()).cpuTime-before) / 1e4 / float64(b.N)
	b.ReportMetric(cpuMs, "cpu-ms/tick")
	b.ReportMetric(cpuMs/float64(sampleInterval.Milliseconds())*100, "%core")
}
