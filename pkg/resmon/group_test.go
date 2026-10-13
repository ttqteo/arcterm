// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package resmon

import (
	"fmt"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/util/jobobject"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const (
	testHost = 100
	testSelf = 200
)

// p is a fixture process: create times are seconds so the tables read easily.
func p(pid, ppid int, name string, createSec int64) proc {
	return proc{Pid: pid, Ppid: ppid, Name: name, CreateTs: createSec * 1000, Cpu: 1, Mem: 1 << 20}
}

func table(ps ...proc) map[int]proc {
	t := map[int]proc{}
	for _, x := range ps {
		t[x.Pid] = x
	}
	return t
}

func pids(ps map[int]proc) []int {
	var out []int
	for pid := range ps {
		out = append(out, pid)
	}
	return out
}

// shape renders rows as "pid@depth" in order, with the tag when set.
func shape(rows []wshrpc.ProcessInfo) string {
	var parts []string
	for _, r := range rows {
		s := fmt.Sprintf("%d@%d", r.Pid, r.Depth)
		if r.Tag != "" {
			s += ":" + r.Tag
		}
		parts = append(parts, s)
	}
	return strings.Join(parts, " ")
}

func jobGroup(t *testing.T, procs map[int]proc, root int, agent bool) wshrpc.ResMonGroup {
	t.Helper()
	jv := jobView{
		Job:  jobobject.LiveJob{Owner: jobobject.Owner{Kind: jobobject.OwnerKind_Block, Id: "b1"}, RootPid: root, Members: pids(procs)},
		Info: OwnerInfo{Kind: wshrpc.ResMonOwner_AgentTab, Label: "tab", Agent: agent},
	}
	groups := buildGroups(procs, nil, []jobView{jv}, testHost, testSelf)
	if len(groups) != 2 {
		t.Fatalf("got %d groups, want arc + 1 job", len(groups))
	}
	return groups[1]
}

func TestGroupTreeOrder(t *testing.T) {
	procs := table(
		p(10, testSelf, "bash.exe", 1),
		p(11, 10, "go.exe", 2),
		p(12, 11, "orchestrate.test.exe", 3),
		p(13, 10, "git.exe", 4),
		// parents outside the job: roots after the main root, by create time
		p(31, 999, "late.exe", 9),
		p(30, 998, "early.exe", 5),
	)
	g := jobGroup(t, procs, 10, false)
	if got, want := shape(g.Rows), "10@0:shell 11@1 12@2 13@1 30@0 31@0"; got != want {
		t.Fatalf("rows = %q, want %q", got, want)
	}
}

func TestCoreClaudeRoot(t *testing.T) {
	procs := table(
		p(10, testSelf, "claude.exe", 1),
		p(11, 10, "conhost.exe", 2),
		p(12, 10, "bash.exe", 3),
		p(13, 12, "conhost.exe", 4),
	)
	g := jobGroup(t, procs, 10, true)
	// a console under a non-core process is not core
	if got, want := shape(g.Rows), "10@0:agent 11@1:console 12@1 13@2"; got != want {
		t.Fatalf("rows = %q, want %q", got, want)
	}
}

func TestCorePiLauncherChain(t *testing.T) {
	procs := table(
		p(10, testSelf, "cmd.exe", 1),
		p(11, 10, "conhost.exe", 2),
		p(12, 10, "node.exe", 3),
		p(13, 12, "bash.exe", 4),
		p(14, 12, "bash.exe", 5),
	)
	g := jobGroup(t, procs, 10, true)
	if got, want := shape(g.Rows), "10@0:launcher 11@1:console 12@1:agent 13@2 14@2"; got != want {
		t.Fatalf("rows = %q, want %q", got, want)
	}

	// a launcher with two non-console children stops the chain at itself
	procs[15] = p(15, 10, "node.exe", 6)
	g = jobGroup(t, procs, 10, true)
	if got, want := shape(g.Rows), "10@0:agent 11@1:console 12@1 13@2 14@2 15@1"; got != want {
		t.Fatalf("rows with two children = %q, want %q", got, want)
	}
}

func TestCoreNonAgentBlockIsShellOnly(t *testing.T) {
	procs := table(
		p(10, testSelf, "pwsh.exe", 1),
		p(11, 10, "conhost.exe", 2),
		p(12, 10, "node.exe", 3),
	)
	g := jobGroup(t, procs, 10, false)
	if got, want := shape(g.Rows), "10@0:shell 11@1 12@1"; got != want {
		t.Fatalf("rows = %q, want %q", got, want)
	}
}

func knownCreateTs(tab map[int]proc) func(int) int64 {
	return func(pid int) int64 { return tab[pid].CreateTs }
}

func TestArcRoles(t *testing.T) {
	wv := func(pid int, flags string) proc {
		x := p(pid, 110, "msedgewebview2.exe", 3)
		x.Command = `"C:\WebView2\msedgewebview2.exe" --embedded-browser-webview=1 ` + flags
		return x
	}
	browser := p(110, testHost, "msedgewebview2.exe", 2)
	browser.Command = `"C:\WebView2\msedgewebview2.exe" --embedded-browser-webview=1 --webview-exe-name=wave-tauri.exe`
	all := table(
		p(1, 0, "System", 0),
		p(testHost, 1, "wave-tauri.exe", 1),
		browser,
		wv(111, "--type=renderer --lang=en"),
		wv(112, "--type=gpu-process"),
		wv(113, "--type=utility --utility-sub-type=network.mojom.NetworkService"),
		wv(114, "--type=utility --utility-sub-type=storage.mojom.StorageService"),
		wv(115, "--type=crashpad-handler"),
		wv(116, "--type=utility --utility-sub-type=audio.mojom.AudioService"),
		p(testSelf, testHost, "wavesrv.x64.exe", 4),
		p(201, testSelf, "conhost.exe", 5),
		p(202, testSelf, "git.exe", 6),
		p(203, testSelf, "claude.exe", 7), // a job root
		p(204, 203, "bash.exe", 8),        // in the same job
	)
	inJob := map[int]bool{203: true, 204: true}
	rows := arcTree(all, testHost, testSelf, inJob, knownCreateTs(all))
	groups := buildGroups(all, rows, nil, testHost, testSelf)
	arc := groups[0]
	if arc.Key != "arc" || arc.OwnerKind != wshrpc.ResMonOwner_Arc || arc.Killable {
		t.Fatalf("arc group = %+v", arc)
	}
	var got []string
	for _, r := range arc.Rows {
		got = append(got, fmt.Sprintf("%d@%d %s", r.Pid, r.Depth, r.Role))
	}
	want := []string{
		"100@0 Host",
		"110@1 WebView browser",
		"111@2 Renderer",
		"112@2 GPU",
		"113@2 Network service",
		"114@2 Storage service",
		"115@2 Crash handler",
		"116@2 msedgewebview2.exe",
		"200@1 Backend",
		"201@2 conhost.exe",
		"202@2 git.exe",
	}
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Fatalf("arc rows:\n%s\nwant:\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
	}
}

func TestArcWalkSkipsReusedPid(t *testing.T) {
	all := table(
		p(testHost, 1, "wave-tauri.exe", 10),
		p(testSelf, testHost, "wavesrv.x64.exe", 11),
		// its parent pid now names the host, but it predates the host: a reused pid, not Arc's child
		p(300, testHost, "stranger.exe", 5),
		p(301, 300, "strangerchild.exe", 12),
	)
	rows := arcTree(all, testHost, testSelf, nil, knownCreateTs(all))
	var got []int
	for _, r := range rows {
		got = append(got, r.Pid)
	}
	if fmt.Sprint(got) != fmt.Sprint([]int{testHost, testSelf}) {
		t.Fatalf("arc walk = %v, want host and wavesrv only", got)
	}
}

func TestBusyNeedsThreeSamples(t *testing.T) {
	var b busyState
	for i, cpu := range []float64{85, 90} {
		if busy, _ := b.observe(cpu, 0, 100); busy {
			t.Fatalf("hot sample %d is busy already", i+1)
		}
	}
	if busy, _ := b.observe(80, 0, 100); !busy {
		t.Fatal("third hot sample is not busy")
	}
	if busy, _ := b.observe(79.9, 0, 100); busy {
		t.Fatal("a cool sample keeps busy")
	}
	b.observe(95, 0, 100)
	if busy, _ := b.observe(95, 0, 100); busy {
		t.Fatal("two hot samples after a cool one are busy: the cool sample did not reset")
	}
}

func TestBusyMemory(t *testing.T) {
	var b busyState
	if _, busy := b.observe(0, 74, 100); busy {
		t.Fatal("74% of RAM is busy")
	}
	if _, busy := b.observe(0, 75, 100); !busy {
		t.Fatal("75% of RAM is not busy")
	}
	if _, busy := b.observe(0, 75, 0); busy {
		t.Fatal("unknown total RAM is busy")
	}
}

func TestUnavailableRowKept(t *testing.T) {
	denied := p(11, 10, "elevated.exe", 2)
	denied.Cpu, denied.Mem, denied.CreateTs = -1, -1, 0 // could not be opened: no create time either
	procs := table(p(10, testSelf, "bash.exe", 1), denied)
	procs[10] = proc{Pid: 10, Ppid: testSelf, Name: "bash.exe", CreateTs: 1000, Cpu: 2.5, Mem: 1000}
	g := jobGroup(t, procs, 10, false)
	if len(g.Rows) != 2 {
		t.Fatalf("rows = %+v, want the unavailable row kept", g.Rows)
	}
	row := g.Rows[1]
	if row.Pid != 11 || row.Depth != 1 || row.Cpu != -1 || row.Mem != -1 {
		t.Fatalf("unavailable row = %+v, want it under its parent with -1 cpu and mem", row)
	}
	if g.Cpu != 2.5 || g.Mem != 1000 {
		t.Fatalf("group totals = %v cpu %v mem, want the unavailable row skipped", g.Cpu, g.Mem)
	}
	arc := wshrpc.ResMonGroup{Key: arcGroupKey}
	cpu, mem := sumTotals([]wshrpc.ResMonGroup{arc, g})
	if cpu != 2.5 || mem != 1000 {
		t.Fatalf("snapshot totals = %v %v", cpu, mem)
	}
}
