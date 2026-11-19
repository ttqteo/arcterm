// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package resmon

import (
	"cmp"
	"errors"
	"log"
	"maps"
	"os"
	"slices"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/util/jobobject"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// keepRunning is the image names Sidecar's resource view never offers to end, lowercased: the system's own processes,
// which take the session or the machine down with them (and which Windows mostly refuses anyway), and arcterm's, since
// a dev app's wave-tauri.exe and wavesrv list the person's packaged arcterm, every agent in it, among the others.
// msedgewebview2.exe is shared: the same image draws arcterm's windows and other apps' panes.
var keepRunning = map[string]bool{
	// Windows
	"system": true, "registry": true, "memory compression": true, "secure system": true, "vmmem": true,
	"vmmemwsl": true, "smss.exe": true, "csrss.exe": true, "wininit.exe": true, "winlogon.exe": true,
	"services.exe": true, "lsass.exe": true, "lsaiso.exe": true, "svchost.exe": true, "dwm.exe": true,
	"fontdrvhost.exe": true, "explorer.exe": true, "sihost.exe": true, "ctfmon.exe": true, "msmpeng.exe": true,
	"searchhost.exe": true, "startmenuexperiencehost.exe": true, "shellexperiencehost.exe": true,
	"runtimebroker.exe": true, "taskhostw.exe": true, "audiodg.exe": true, "spoolsv.exe": true,
	"msedgewebview2.exe": true, "wave-tauri.exe": true, "wavesrv.x64.exe": true, "arcterm.exe": true,
	// macOS
	"kernel_task": true, "launchd": true, "windowserver": true, "loginwindow": true, "finder": true, "dock": true,
	"systemuiserver": true, "mds": true, "mds_stores": true, "mdworker": true, "mdworker_shared": true,
	"coreaudiod": true, "wavesrv": true, "wavesrv.arm64": true, "arcterm": true, "wave-tauri": true,
}

// Endable reports whether Sidecar may offer to end every process of an image name: not one of keepRunning, nor any
// wsh (an agent hook in flight), nor a name it could not read.
func Endable(name string) bool {
	key := strings.ToLower(strings.TrimSpace(name))
	return key != "" && !keepRunning[key] && !strings.HasPrefix(key, "wsh")
}

// endTarget is one process EndApp will end: its pid and the create time that tells it from a later process given the
// same pid.
type endTarget struct {
	Pid      int
	CreateTs int64
}

// endTargets is the processes of name in table outside tracked (arcterm's own tree and every job's members, which the
// other apps never list), named as groupOthers names them, the pid ending this wavesrv and its host left out too.
// Sorted by pid, so a test reads a stable order.
func endTargets(table map[int]proc, tracked map[int]bool, name string, self ...int) []endTarget {
	key := strings.ToLower(name)
	var out []endTarget
	for pid, p := range table {
		if pid <= 4 || tracked[pid] || slices.Contains(self, pid) {
			continue
		}
		if strings.ToLower(cmp.Or(p.App, p.Name)) == key {
			out = append(out, endTarget{Pid: pid, CreateTs: p.CreateTs})
		}
	}
	slices.SortFunc(out, func(a, b endTarget) int { return cmp.Compare(a.Pid, b.Pid) })
	return out
}

var errReused = errors.New("pid reused")

// terminate ends one process unless its pid now names another one.
func terminate(t endTarget) error {
	if t.CreateTs != 0 {
		if s := readStat(t.Pid); !s.ok || s.createTs != t.CreateTs {
			return errReused
		}
	}
	p, err := os.FindProcess(t.Pid)
	if err != nil {
		return err
	}
	defer p.Release()
	return p.Kill()
}

// EndApp ends every process of one image name outside arcterm and its agents, as Task Manager's End task ends an app's
// group: the name Sidecar's resource view listed under the other apps. A name Endable refuses is refused; a name with
// no process left is gone. One the OS refuses (another user's, an elevated one) is counted out: Killed says how many
// ended, and Error carries the first refusal when none did.
func EndApp(name string) wshrpc.ResMonKillRtnData {
	if !Endable(name) {
		return refused
	}
	table, err := readTable()
	if err != nil {
		return wshrpc.ResMonKillRtnData{Outcome: wshrpc.ResMonKill_Failed, Error: err.Error()}
	}
	// fresh, as a tick reads them: arcterm's tree and the jobs' members are never others
	inJob := map[int]bool{}
	for _, j := range jobobject.LiveJobs() {
		for _, m := range j.Members {
			inJob[m] = true
		}
	}
	host, self := os.Getppid(), os.Getpid()
	tracked := maps.Clone(inJob)
	for _, r := range arcTree(table, host, self, inJob, func(pid int) int64 { return readStat(pid).createTs }) {
		tracked[r.Pid] = true
	}
	targets := endTargets(table, tracked, name, host, self)
	for i := range targets {
		// the create time pins each pid to the process read here; a table that has none reads it now (0 where the
		// process cannot be opened, which then cannot be ended either)
		if targets[i].CreateTs == 0 {
			targets[i].CreateTs = readStat(targets[i].Pid).createTs
		}
	}
	if len(targets) == 0 {
		return wshrpc.ResMonKillRtnData{Outcome: wshrpc.ResMonKill_Gone}
	}
	killed := 0
	var first error
	for _, t := range targets {
		switch err := terminate(t); {
		case err == nil:
			killed++
		case errors.Is(err, errReused), errors.Is(err, os.ErrProcessDone):
			// exited since the read: nothing to end
		default:
			if first == nil {
				first = err
			}
		}
	}
	log.Printf("resmon: end %s: %d of %d ended", name, killed, len(targets))
	switch {
	case killed > 0:
		return wshrpc.ResMonKillRtnData{Outcome: wshrpc.ResMonKill_Killed, Killed: killed}
	case first != nil:
		return wshrpc.ResMonKillRtnData{Outcome: wshrpc.ResMonKill_Failed, Error: osText(first)}
	default:
		return wshrpc.ResMonKillRtnData{Outcome: wshrpc.ResMonKill_Gone}
	}
}
