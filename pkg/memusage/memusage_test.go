// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package memusage

import (
	"os"
	"runtime"
	"slices"
	"testing"
)

const mb uint64 = 1 << 20

// host 10 spawns wavesrv 20, which runs the shells 30 and 40; claude 31 runs under shell 30. 50 and 51 are the
// webview's helpers: launchd's children, which the host is responsible for. 60 is an unrelated app.
func fixtureTable() Table {
	return NewTable(map[int32]int32{
		1:  0,
		10: 1,
		20: 10,
		30: 20,
		31: 30,
		40: 20,
		50: 1,
		51: 1,
		60: 1,
	})
}

func sampler(foot map[int32]uint64, responsible map[int32]int32) Sampler {
	return Sampler{
		Footprint: func(pid int32) (uint64, bool) {
			n, ok := foot[pid]
			return n, ok
		},
		Responsible: func(pid int32) (int32, bool) {
			r, ok := responsible[pid]
			return r, ok
		},
	}
}

func TestTreeIsRootThenEveryDescendant(t *testing.T) {
	got := fixtureTable().Tree(20)
	if !slices.Equal(got, []int32{20, 30, 40, 31}) {
		t.Fatalf("Tree(20) = %v, want [20 30 40 31]", got)
	}
	if fixtureTable().Tree(99) != nil {
		t.Fatal("a pid not in the table has no tree")
	}
}

func TestTreeSurvivesAProcessThatIsItsOwnParent(t *testing.T) {
	tb := NewTable(map[int32]int32{0: 0, 1: 0, 2: 1})
	if got := tb.Tree(0); !slices.Equal(got, []int32{0, 1, 2}) {
		t.Fatalf("Tree(0) = %v, want [0 1 2]", got)
	}
}

func TestMeasureSumsEachAgentsTree(t *testing.T) {
	foot := map[int32]uint64{30: 5 * mb, 31: 300 * mb, 40: 4 * mb}
	b := Measure(fixtureTable(), sampler(foot, nil), map[string]int32{"blk-a": 30, "blk-b": 40}, 20, 10, false)
	if b.Agents["blk-a"] != 305*mb || b.Agents["blk-b"] != 4*mb {
		t.Fatalf("agents = %v", b.Agents)
	}
}

func TestMeasureLeavesAnAgentAbsentWhenItsShellIsGone(t *testing.T) {
	b := Measure(fixtureTable(), sampler(map[int32]uint64{31: mb}, nil), map[string]int32{"gone": 77}, 20, 10, false)
	if _, ok := b.Agents["gone"]; ok {
		t.Fatalf("an agent whose root is not running must be absent, got %v", b.Agents)
	}
}

func TestMeasureReadsServerAndHost(t *testing.T) {
	b := Measure(fixtureTable(), sampler(map[int32]uint64{10: 47 * mb, 20: 121 * mb}, nil), nil, 20, 10, false)
	if b.Server == nil || *b.Server != 121*mb || b.Host == nil || *b.Host != 47*mb {
		t.Fatalf("server %v host %v", b.Server, b.Host)
	}
	if b2 := Measure(fixtureTable(), sampler(nil, nil), nil, 20, 10, false); b2.Server != nil || b2.Host != nil {
		t.Fatal("an unread footprint must be absent, not zero")
	}
}

func TestMeasureCountsWhatPlainTerminalsRun(t *testing.T) {
	tb := NewTable(map[int32]int32{10: 1, 20: 10, 30: 20, 31: 30, 40: 20, 41: 40})
	foot := map[int32]uint64{20: 121 * mb, 30: 5 * mb, 31: 300 * mb, 40: 3 * mb, 41: 500 * mb}
	b := Measure(tb, sampler(foot, nil), map[string]int32{"blk-a": 30}, 20, 10, false)
	if b.Terminals == nil || *b.Terminals != 503*mb {
		t.Fatalf("terminals = %v, want 503 MB (40 + 41)", b.Terminals)
	}
	if b.Server == nil || *b.Server != 121*mb || b.Agents["blk-a"] != 305*mb {
		t.Fatalf("server %v, agents %v", b.Server, b.Agents)
	}

	// every shell is an agent's: no plain terminal, a real zero
	b = Measure(tb, sampler(foot, nil), map[string]int32{"blk-a": 30, "blk-b": 40}, 20, 10, false)
	if b.Terminals == nil || *b.Terminals != 0 {
		t.Fatalf("with every shell an agent's, terminals = %v, want a non-nil 0", b.Terminals)
	}

	// wavesrv not running: nothing to measure under it
	b = Measure(NewTable(map[int32]int32{10: 1, 30: 20, 40: 20}), sampler(foot, nil), nil, 20, 10, false)
	if b.Terminals != nil {
		t.Fatalf("with the server absent from the table, terminals = %v, want nil", *b.Terminals)
	}

	// no footprint readable: absent, never zero
	b = Measure(tb, sampler(nil, nil), map[string]int32{"blk-a": 30}, 20, 10, false)
	if b.Terminals != nil {
		t.Fatalf("with no footprint readable, terminals = %v, want nil", *b.Terminals)
	}
}

func TestInterfaceByResponsibilityLeavesOutHostServerAndAgents(t *testing.T) {
	foot := map[int32]uint64{10: 47 * mb, 20: 121 * mb, 30: mb, 31: 300 * mb, 50: 684 * mb, 51: 62 * mb, 60: 900 * mb}
	// every process the host spawned is its responsibility too, wavesrv's tree included
	resp := map[int32]int32{10: 10, 20: 10, 30: 10, 31: 10, 40: 10, 50: 10, 51: 10, 60: 60}
	b := Measure(fixtureTable(), sampler(foot, resp), map[string]int32{"blk-a": 30}, 20, 10, true)
	if b.Interface == nil || *b.Interface != 746*mb {
		t.Fatalf("interface = %v, want 746 MB (50 + 51)", b.Interface)
	}
}

func TestInterfaceByTreeOnOtherPlatforms(t *testing.T) {
	// on Windows the webview's processes are the host's children
	tb := NewTable(map[int32]int32{10: 1, 20: 10, 30: 20, 70: 10, 71: 70})
	foot := map[int32]uint64{70: 400 * mb, 71: 100 * mb, 30: 9 * mb}
	b := Measure(tb, sampler(foot, nil), nil, 20, 10, false)
	if b.Interface == nil || *b.Interface != 500*mb {
		t.Fatalf("interface = %v, want 500 MB", b.Interface)
	}
}

func TestInterfaceAbsentWhenNothingIsFound(t *testing.T) {
	if b := Measure(fixtureTable(), sampler(map[int32]uint64{50: mb}, nil), nil, 20, 10, true); b.Interface != nil {
		t.Fatalf("no responsible process found must leave interface absent, got %v", *b.Interface)
	}
}

func TestLiveFootprintReadsThisProcess(t *testing.T) {
	n, ok := Live().Footprint(int32(os.Getpid()))
	if !ok || n == 0 {
		t.Fatalf("footprint of this test = %d, %v", n, ok)
	}
}

func TestLiveResponsibleOnDarwin(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("responsibility is a darwin call")
	}
	if _, ok := Live().Responsible(int32(os.Getpid())); !ok {
		t.Skip("built without cgo: the fallback has no responsibility call")
	}
}

func TestReadTableFindsThisProcess(t *testing.T) {
	tb, err := ReadTable()
	if err != nil {
		t.Fatal(err)
	}
	if !tb.Has(int32(os.Getpid())) {
		t.Fatal("the process table must list this test")
	}
}

func TestTableParent(t *testing.T) {
	tb := NewTable(map[int32]int32{1: 0, 5: 1})
	if p, ok := tb.Parent(5); !ok || p != 1 {
		t.Fatalf("Parent(5) = %d, %v; want 1, true", p, ok)
	}
	if _, ok := tb.Parent(9); ok {
		t.Fatal("Parent(9) found a pid that was not running")
	}
}
