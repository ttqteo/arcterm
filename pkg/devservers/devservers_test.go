// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package devservers

import (
	"reflect"
	"testing"
)

func procMap(ps ...Proc) map[int32]Proc {
	m := map[int32]Proc{}
	for _, p := range ps {
		m[p.Pid] = p
	}
	return m
}

func TestSelectInProjectByCwd(t *testing.T) {
	procs := procMap(
		Proc{Pid: 100, Ppid: 1, Name: "node.exe", Cmdline: "node vite", Cwd: `d:/W/Site\web`, CreateMs: 5},
		Proc{Pid: 1, Ppid: 0, Name: "explorer.exe"},
	)
	got := Select(`D:\w\site\`, 0, procs, []Listener{{Pid: 100, Port: 5173}})
	want := []Server{{Pid: 100, CreateMs: 5, Ports: []int{5173}, Name: "node.exe", Cmdline: "node vite", Cwd: `d:/W/Site\web`}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v, want %+v", got, want)
	}
	if got[0].ByAgent || got[0].LauncherCmdline != "" {
		t.Fatalf("a cwd match is not by-agent and has no launcher: %+v", got[0])
	}
}

func TestSelectDescendantOfAgent(t *testing.T) {
	procs := procMap(
		Proc{Pid: 10, Ppid: 1, Name: "claude.exe", Cwd: `D:\w\site`},
		Proc{Pid: 20, Ppid: 10, Name: "bash", Cmdline: "bash -c npm run dev", Cwd: `D:\elsewhere`},
		Proc{Pid: 30, Ppid: 20, Name: "npm", Cmdline: "npm run dev", Cwd: `D:\elsewhere`},
		Proc{Pid: 40, Ppid: 30, Name: "node.exe", Cmdline: "node server.js", Cwd: `D:\elsewhere`, CreateMs: 9},
	)
	got := Select(`D:\w\site`, 10, procs, []Listener{{Pid: 40, Port: 3000}})
	if len(got) != 1 || got[0].Pid != 40 {
		t.Fatalf("got %+v, want only pid 40", got)
	}
	if !got[0].ByAgent {
		t.Fatalf("a descendant of the agent is by-agent: %+v", got[0])
	}
	if got[0].LauncherCmdline != "bash -c npm run dev" {
		t.Fatalf("launcher = %q, want the agent's direct child's cmdline", got[0].LauncherCmdline)
	}
}

func TestSelectDirectChildOfAgentIsItsOwnLauncher(t *testing.T) {
	procs := procMap(
		Proc{Pid: 10, Ppid: 1, Name: "claude.exe"},
		Proc{Pid: 20, Ppid: 10, Name: "node.exe", Cmdline: "node a.js", Cwd: `D:\elsewhere`},
	)
	got := Select("", 10, procs, []Listener{{Pid: 20, Port: 80}})
	if len(got) != 1 || !got[0].ByAgent || got[0].LauncherCmdline != "node a.js" {
		t.Fatalf("got %+v", got)
	}
}

func TestSelectDropsOutsideAndUnrelated(t *testing.T) {
	procs := procMap(
		Proc{Pid: 10, Ppid: 1, Name: "claude.exe"},
		Proc{Pid: 50, Ppid: 1, Name: "postgres.exe", Cwd: `C:\Program Files\pg`},
		Proc{Pid: 1, Ppid: 0, Name: "explorer.exe"},
	)
	got := Select(`D:\w\site`, 10, procs, []Listener{{Pid: 50, Port: 5432}})
	if got == nil || len(got) != 0 {
		t.Fatalf("got %#v, want an empty non-nil slice", got)
	}
}

func TestSelectRootNeedsSeparator(t *testing.T) {
	procs := procMap(
		Proc{Pid: 60, Ppid: 1, Name: "node.exe", Cwd: `D:\w\site-old`},
		Proc{Pid: 61, Ppid: 1, Name: "node.exe", Cwd: `D:\w\site`},
	)
	got := Select(`D:\w\site`, 0, procs, []Listener{{Pid: 60, Port: 1}, {Pid: 61, Port: 2}})
	if len(got) != 1 || got[0].Pid != 61 {
		t.Fatalf("got %+v, want only pid 61 (site-old is a different folder)", got)
	}
}

func TestSelectEmptyRootMatchesNothingByCwd(t *testing.T) {
	procs := procMap(Proc{Pid: 60, Ppid: 1, Name: "node.exe", Cwd: `D:\w\site`})
	if got := Select("", 0, procs, []Listener{{Pid: 60, Port: 1}}); len(got) != 0 {
		t.Fatalf("got %+v, want none: no root, no agent", got)
	}
}

func TestSelectOnePidManyPortsIsOneServer(t *testing.T) {
	procs := procMap(Proc{Pid: 70, Ppid: 1, Name: "node.exe", Cwd: `D:\w\site`})
	got := Select(`D:\w\site`, 0, procs, []Listener{{Pid: 70, Port: 24678}, {Pid: 70, Port: 4321}, {Pid: 70, Port: 24678}})
	if len(got) != 1 {
		t.Fatalf("got %+v, want one server", got)
	}
	if !reflect.DeepEqual(got[0].Ports, []int{4321, 24678}) {
		t.Fatalf("ports = %v, want [4321 24678]", got[0].Ports)
	}
}

func TestSelectDropsClaudeAndTheAgent(t *testing.T) {
	procs := procMap(
		Proc{Pid: 10, Ppid: 1, Name: "claude.exe", Cwd: `D:\w\site`},
		Proc{Pid: 11, Ppid: 10, Name: "Claude", Cwd: `D:\w\site`},
		Proc{Pid: 12, Ppid: 10, Name: "node.exe", Cwd: `D:\w\site`},
	)
	got := Select(`D:\w\site`, 10, procs, []Listener{{Pid: 10, Port: 1}, {Pid: 11, Port: 2}, {Pid: 12, Port: 3}})
	if len(got) != 1 || got[0].Pid != 12 {
		t.Fatalf("got %+v, want only pid 12", got)
	}
	// no agent known: a claude.exe in the project is still not a dev server
	got = Select(`D:\w\site`, 0, procs, []Listener{{Pid: 10, Port: 1}})
	if len(got) != 0 {
		t.Fatalf("got %+v, want none", got)
	}
}

func TestSelectSkipsUnreadAndZeroPids(t *testing.T) {
	procs := procMap(Proc{Pid: 80, Ppid: 1, Name: "node.exe", Cwd: `D:\w\site`})
	got := Select(`D:\w\site`, 0, procs, []Listener{{Pid: 0, Port: 1}, {Pid: 99, Port: 2}, {Pid: 80, Port: 3}})
	if len(got) != 1 || got[0].Pid != 80 {
		t.Fatalf("got %+v, want only pid 80", got)
	}
}

func TestSelectPpidLoopTerminates(t *testing.T) {
	procs := procMap(
		Proc{Pid: 90, Ppid: 91, Name: "node.exe", Cwd: `D:\w\site`},
		Proc{Pid: 91, Ppid: 90, Name: "sh"},
	)
	got := Select(`D:\w\site`, 7, procs, []Listener{{Pid: 90, Port: 1}})
	if len(got) != 1 || got[0].ByAgent {
		t.Fatalf("got %+v, want pid 90 by cwd, not by agent", got)
	}
}

func TestSelectLongChainStopsAtHopLimit(t *testing.T) {
	// the agent sits 40 parents above the listener: past the hop limit, so it is not found
	procs := map[int32]Proc{}
	const agent int32 = 1000
	procs[agent] = Proc{Pid: agent, Ppid: 1, Name: "claude.exe"}
	prev := agent
	for i := int32(1); i <= 40; i++ {
		procs[agent+i] = Proc{Pid: agent + i, Ppid: prev, Name: "sh"}
		prev = agent + i
	}
	got := Select("", agent, procs, []Listener{{Pid: prev, Port: 1}})
	if len(got) != 0 {
		t.Fatalf("got %+v, want none past the hop limit", got)
	}
	// 20 parents is within it
	got = Select("", agent, procs, []Listener{{Pid: agent + 20, Port: 1}})
	if len(got) != 1 || !got[0].ByAgent {
		t.Fatalf("got %+v, want pid %d by agent", got, agent+20)
	}
}

func TestSelectOrderedByFirstPort(t *testing.T) {
	procs := procMap(
		Proc{Pid: 1, Ppid: 0, Name: "a", Cwd: `D:\w\site`},
		Proc{Pid: 2, Ppid: 0, Name: "b", Cwd: `D:\w\site`},
		Proc{Pid: 3, Ppid: 0, Name: "c", Cwd: `D:\w\site`},
	)
	got := Select(`D:\w\site`, 0, procs, []Listener{{Pid: 1, Port: 9000}, {Pid: 2, Port: 3000}, {Pid: 2, Port: 9999}, {Pid: 3, Port: 5000}})
	var pids []int32
	for _, s := range got {
		pids = append(pids, s.Pid)
	}
	if !reflect.DeepEqual(pids, []int32{2, 3, 1}) {
		t.Fatalf("order = %v, want [2 3 1]", pids)
	}
}

func TestCheckStop(t *testing.T) {
	if err := CheckStop(123, 123); err != nil {
		t.Fatalf("equal create times: %v", err)
	}
	err := CheckStop(123, 456)
	if err == nil {
		t.Fatal("different create times: want an error")
	}
	if want := "the process is no longer the server that was listed (its PID was reused)"; err.Error() != want {
		t.Fatalf("error = %q, want %q", err.Error(), want)
	}
}
