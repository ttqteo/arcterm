// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package resmon

import (
	"fmt"
	"slices"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/util/jobobject"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const (
	arcGroupKey   = "arc"
	arcGroupLabel = "Arc"

	tagAgent    = "agent"
	tagLauncher = "launcher"
	tagConsole  = "console"
	tagShell    = "shell"

	imageConhost = "conhost.exe"
	imageWebView = "msedgewebview2.exe"

	busyCpuPct     = 80.0
	busyCpuSamples = 3
	busyMemFrac    = 0.75
)

var launcherImages = []string{"cmd.exe", "bash.exe", "sh.exe", "pwsh.exe", "powershell.exe"}

// webview roles in match order: the first flag found in the command line names the process
var webViewRoles = []struct{ flag, role string }{
	{"--utility-sub-type=network.mojom.NetworkService", "Network service"},
	{"--utility-sub-type=storage.mojom.StorageService", "Storage service"},
	{"--type=renderer", "Renderer"},
	{"--type=gpu-process", "GPU"},
	{"--type=crashpad-handler", "Crash handler"},
}

const (
	roleHost    = "Host"
	roleBackend = "Backend"
	roleBrowser = "WebView browser"
)

// proc is one process as a sample saw it. Cpu and Mem are -1 when it could not be opened; CreateTs is 0
// when unknown.
type proc struct {
	Pid      int
	Ppid     int
	Name     string // image name
	Command  string
	CreateTs int64 // epoch ms
	Cpu      float64
	Mem      int64
}

// treeRow places a pid in its group's pre-order tree.
type treeRow struct {
	Pid   int
	Depth int
}

// jobView is a live job plus what the resolver knows about its owner.
type jobView struct {
	Job    jobobject.LiveJob
	Info   OwnerInfo
	RootTs int64 // the root's create time as first seen, so the key outlives the root
}

// isArcChild guards a ppid link against pid reuse: the child must not be older than its parent. An unknown
// create time proves nothing, so it does not link: the walk would otherwise claim a stranger.
func isArcChild(child, parent proc) bool {
	return child.Ppid == parent.Pid && child.Pid != parent.Pid &&
		child.CreateTs != 0 && parent.CreateTs != 0 && child.CreateTs >= parent.CreateTs
}

// isJobChild is the same guard between members of one job, where membership already rules out a stranger,
// so a process that could not be opened still sits under its parent.
func isJobChild(child, parent proc) bool {
	if child.Ppid != parent.Pid || child.Pid == parent.Pid {
		return false
	}
	return child.CreateTs == 0 || parent.CreateTs == 0 || child.CreateTs >= parent.CreateTs
}

func byCreateTs(procs map[int]proc) func(a, b int) int {
	return func(a, b int) int {
		if c := procs[a].CreateTs - procs[b].CreateTs; c != 0 {
			if c < 0 {
				return -1
			}
			return 1
		}
		return a - b
	}
}

// preOrder walks roots in order, each child list by create time, and visits a pid at most once.
func preOrder(roots []int, children map[int][]int) []treeRow {
	var rows []treeRow
	seen := map[int]bool{}
	var walk func(pid, depth int)
	walk = func(pid, depth int) {
		if seen[pid] {
			return
		}
		seen[pid] = true
		rows = append(rows, treeRow{Pid: pid, Depth: depth})
		for _, c := range children[pid] {
			walk(c, depth+1)
		}
	}
	for _, r := range roots {
		walk(r, 0)
	}
	return rows
}

// jobTree orders a job's members: the root first, then each member whose parent is outside the job, by
// create time; children below their parents.
func jobTree(procs map[int]proc, members []int, rootPid int) []treeRow {
	in := make(map[int]bool, len(members))
	for _, m := range members {
		in[m] = true
	}
	children := map[int][]int{}
	var roots []int
	for _, m := range members {
		p := procs[m]
		if m != rootPid && in[p.Ppid] && isJobChild(p, procs[p.Ppid]) {
			children[p.Ppid] = append(children[p.Ppid], m)
		} else if m != rootPid {
			roots = append(roots, m)
		}
	}
	order := byCreateTs(procs)
	for _, c := range children {
		slices.SortFunc(c, order)
	}
	slices.SortFunc(roots, order)
	if in[rootPid] {
		roots = append([]int{rootPid}, roots...)
	}
	return preOrder(roots, children)
}

// arcTree walks the host's descendants by ppid, skipping job members and their subtrees. createTs reads a
// candidate's create time only when the walk reaches it. wavesrv is walked as its own root if the host walk
// does not reach it.
func arcTree(table map[int]proc, hostPid, selfPid int, inJob map[int]bool, createTs func(pid int) int64) []treeRow {
	byPpid := map[int][]int{}
	for pid, p := range table {
		if !inJob[pid] {
			byPpid[p.Ppid] = append(byPpid[p.Ppid], pid)
		}
	}
	known := map[int]proc{}
	get := func(pid int) proc {
		if p, ok := known[pid]; ok {
			return p
		}
		p := table[pid]
		p.Pid = pid
		p.CreateTs = createTs(pid)
		known[pid] = p
		return p
	}
	children := map[int][]int{}
	reached := map[int]bool{}
	var collect func(pid int)
	collect = func(pid int) {
		if reached[pid] {
			return
		}
		reached[pid] = true
		parent := get(pid)
		var kids []int
		for _, c := range byPpid[pid] {
			if isArcChild(get(c), parent) {
				kids = append(kids, c)
			}
		}
		slices.SortFunc(kids, byCreateTs(known))
		children[pid] = kids
		for _, c := range kids {
			collect(c)
		}
	}
	var roots []int
	if _, ok := table[hostPid]; ok {
		roots = append(roots, hostPid)
		collect(hostPid)
	}
	if _, ok := table[selfPid]; ok && !reached[selfPid] {
		roots = append(roots, selfPid)
		collect(selfPid)
	}
	return preOrder(roots, children)
}

func isLauncher(name string) bool {
	return slices.Contains(launcherImages, strings.ToLower(name))
}

func isConhost(name string) bool {
	return strings.EqualFold(name, imageConhost)
}

// coreTags names the agent's core processes in one job, which are never killed. In an agent block it is the
// root, extended down while a core process is a launcher with exactly one non-console child, plus the consoles
// of core processes. Otherwise only the root, as the shell.
func coreTags(procs map[int]proc, members []int, rootPid int, agent bool) map[int]string {
	tags := map[int]string{}
	if !slices.Contains(members, rootPid) {
		return tags
	}
	if !agent {
		tags[rootPid] = tagShell
		return tags
	}
	kids := map[int][]int{}
	for _, m := range members {
		p := procs[m]
		if m != rootPid && isJobChild(p, procs[p.Ppid]) {
			kids[p.Ppid] = append(kids[p.Ppid], m)
		}
	}
	chain := []int{rootPid}
	for cur := rootPid; isLauncher(procs[cur].Name); {
		var next []int
		for _, c := range kids[cur] {
			if !isConhost(procs[c].Name) {
				next = append(next, c)
			}
		}
		if len(next) != 1 {
			break
		}
		cur = next[0]
		chain = append(chain, cur)
	}
	for i, pid := range chain {
		tags[pid] = tagLauncher
		if i == len(chain)-1 {
			tags[pid] = tagAgent
		}
		for _, c := range kids[pid] {
			if isConhost(procs[c].Name) {
				tags[c] = tagConsole
			}
		}
	}
	return tags
}

func arcRole(p proc, hostPid, selfPid int) string {
	switch {
	case p.Pid == hostPid:
		return roleHost
	case p.Pid == selfPid:
		return roleBackend
	case strings.EqualFold(p.Name, imageWebView):
		for _, r := range webViewRoles {
			if strings.Contains(p.Command, r.flag) {
				return r.role
			}
		}
		if !strings.Contains(p.Command, "--type=") {
			return roleBrowser
		}
	}
	return p.Name
}

func toRow(p proc, depth int) wshrpc.ProcessInfo {
	return wshrpc.ProcessInfo{
		Pid:        int32(p.Pid),
		Ppid:       int32(p.Ppid),
		Name:       p.Name,
		Command:    p.Command,
		CreateTs:   p.CreateTs,
		Depth:      depth,
		Mem:        p.Mem,
		MemPct:     -1,
		Cpu:        p.Cpu,
		NumThreads: -1,
	}
}

// addTotals sums the rows that have values; an unavailable (-1) row is shown but not counted.
func addTotals(g *wshrpc.ResMonGroup) {
	for _, r := range g.Rows {
		if r.Cpu > 0 {
			g.Cpu += r.Cpu
		}
		if r.Mem > 0 {
			g.Mem += r.Mem
		}
	}
}

func jobKey(rootPid int, rootTs int64) string {
	return fmt.Sprintf("job:%d:%d", rootPid, rootTs)
}

func isKillable(kind string) bool {
	return kind == wshrpc.ResMonOwner_AgentTab || kind == wshrpc.ResMonOwner_RunWorker
}

// buildGroups makes the Arc group and one group per job from one sample. A pid already placed in an earlier
// group (a nested job) is not repeated.
func buildGroups(procs map[int]proc, arcRows []treeRow, jobs []jobView, hostPid, selfPid int) []wshrpc.ResMonGroup {
	placed := map[int]bool{}
	arc := wshrpc.ResMonGroup{Key: arcGroupKey, OwnerKind: wshrpc.ResMonOwner_Arc, Label: arcGroupLabel}
	for _, tr := range arcRows {
		p, ok := procs[tr.Pid]
		if !ok {
			continue
		}
		placed[tr.Pid] = true
		row := toRow(p, tr.Depth)
		row.Role = arcRole(p, hostPid, selfPid)
		arc.Rows = append(arc.Rows, row)
	}
	addTotals(&arc)
	groups := []wshrpc.ResMonGroup{arc}
	for _, jv := range jobs {
		g := wshrpc.ResMonGroup{
			Key:       jobKey(jv.Job.RootPid, jv.RootTs),
			OwnerKind: jv.Info.Kind,
			OwnerId:   jv.Job.Owner.Id,
			Label:     jv.Info.Label,
			Runtime:   jv.Info.Runtime,
			Killable:  isKillable(jv.Info.Kind),
		}
		// a member the sample did not see has exited since the membership read
		members := slices.DeleteFunc(slices.Clone(jv.Job.Members), func(pid int) bool { _, ok := procs[pid]; return !ok })
		tags := coreTags(procs, members, jv.Job.RootPid, jv.Info.Agent)
		for _, tr := range jobTree(procs, members, jv.Job.RootPid) {
			if placed[tr.Pid] {
				continue
			}
			placed[tr.Pid] = true
			row := toRow(procs[tr.Pid], tr.Depth)
			row.Tag = tags[tr.Pid]
			g.Rows = append(g.Rows, row)
		}
		if len(g.Rows) == 0 {
			continue
		}
		addTotals(&g)
		groups = append(groups, g)
	}
	return groups
}

// busyState counts consecutive hot samples, so one CPU spike does not raise the busy pill.
type busyState struct {
	hotSamples int
}

func (b *busyState) observe(cpu float64, mem, totalMem int64) (busyCpu, busyMem bool) {
	if cpu >= busyCpuPct {
		b.hotSamples++
	} else {
		b.hotSamples = 0
	}
	busyMem = totalMem > 0 && float64(mem) >= busyMemFrac*float64(totalMem)
	return b.hotSamples >= busyCpuSamples, busyMem
}

// sumTotals adds every group's totals: the snapshot's whole Arc figure.
func sumTotals(groups []wshrpc.ResMonGroup) (float64, int64) {
	var cpu float64
	var mem int64
	for _, g := range groups {
		cpu += g.Cpu
		mem += g.Mem
	}
	return cpu, mem
}
