//go:build darwin

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package resmon

/*
#include <libproc.h>
#include <sys/proc_info.h>
#include <sys/resource.h>
#include <mach/mach_time.h>

// private, but what Activity Monitor groups by; weak, so a macOS without it starts wavesrv and reads no app
extern pid_t responsibility_get_pid_responsible_for_pid(pid_t) __attribute__((weak_import));

static int arc_responsible(pid_t pid) {
	if (responsibility_get_pid_responsible_for_pid == NULL) {
		return -1;
	}
	return responsibility_get_pid_responsible_for_pid(pid);
}

static int arc_rusage(pid_t pid, struct rusage_info_v2 *ri) {
	return proc_pid_rusage(pid, RUSAGE_INFO_V2, (rusage_info_t *)ri);
}
*/
import "C"

import (
	"os"
	"path/filepath"
	"strings"
	"sync"
	"unsafe"

	"github.com/shirou/gopsutil/v4/process"
	"golang.org/x/sys/unix"
)

const supported = true

// WebKit runs a WKWebView's page, GPU and network work in XPC services launchd starts (ppid 1), so the host's ppid walk
// never reaches them; the kernel still names the app they work for (its responsible pid)
const webKitPrefix = "com.apple.WebKit"

// arcterm's host, whose WebKit services readTable places under it; a var so a probe can point it at a running arcterm
var webKitHost = os.Getppid()

// procName is pid's name as Activity Monitor shows it, up to 32 bytes (the kinfo's own stops at 16:
// "com.apple.WebKit" for every WebKit service); comm when proc_name cannot read it.
func procName(pid int, comm []byte) string {
	var buf [2 * C.MAXCOMLEN]C.char
	if n := C.proc_name(C.int(pid), unsafe.Pointer(&buf[0]), C.uint32_t(len(buf))); n > 0 {
		return C.GoStringN(&buf[0], n)
	}
	return unix.ByteSliceToString(comm)
}

// isVersionName: Claude Code's native binary is the file of its version (~/.local/share/claude/versions/2.1.327), so
// proc_name reads "2.1.327" where the person ran "claude"
func isVersionName(name string) bool {
	return name != "" && strings.Trim(name, "0123456789.") == "" && strings.Contains(name, ".")
}

type startKey struct {
	pid   int
	start int64
}

// argv0Names keeps, per process (pid and start), the argv[0] name a version-named binary was given, so a tick reads
// the arguments once per process; each readTable keeps only the live ones. readTable runs on the sampler and on a kill.
var argv0Names = struct {
	mu    sync.Mutex
	names map[startKey]string
}{names: map[startKey]string{}}

// readTable lists every process from one sysctl, with its name and the name of the app it works for. A WebKit
// service working for arcterm's host is placed under the host, so it counts as arcterm's, not as another app.
func readTable() (map[int]proc, error) {
	kps, err := unix.SysctlKinfoProcSlice("kern.proc.all")
	if err != nil {
		return nil, err
	}
	host := webKitHost
	table := make(map[int]proc, len(kps))
	resp := make(map[int]int, len(kps))
	argv0Names.mu.Lock()
	defer argv0Names.mu.Unlock()
	names := map[startKey]string{}
	for i := range kps {
		k := &kps[i]
		pid := int(k.Proc.P_pid)
		p := proc{Pid: pid, Ppid: int(k.Eproc.Ppid), Name: procName(pid, k.Proc.P_comm[:])}
		if isVersionName(p.Name) {
			key := startKey{pid, k.Proc.P_starttime.Sec*1000 + int64(k.Proc.P_starttime.Usec)/1000}
			name, ok := argv0Names.names[key]
			if !ok {
				if argv := ReadArgv(pid); len(argv) > 0 {
					name = filepath.Base(argv[0])
				}
			}
			names[key] = name
			if name != "" {
				p.Name = name
			}
		}
		r := int(C.arc_responsible(C.pid_t(pid)))
		resp[pid] = r
		if r == host && pid != host && strings.HasPrefix(p.Name, webKitPrefix) {
			p.Ppid = host
		}
		table[pid] = p
	}
	for pid, r := range resp {
		if r > 0 && r != pid {
			if app, ok := table[r]; ok {
				p := table[pid]
				p.App = app.Name
				table[pid] = p
			}
		}
	}
	argv0Names.names = names
	return table, nil
}

var timebase = sync.OnceValue(func() float64 {
	var tb C.mach_timebase_info_data_t
	if C.mach_timebase_info(&tb) != 0 || tb.denom == 0 {
		return 1
	}
	return float64(tb.numer) / float64(tb.denom)
})

// readStat reads pid's CPU time, memory and start; a process of another user (root's daemons) cannot be read and
// comes back not ok. The memory is its physical footprint: Activity Monitor's Memory column, and like the private
// working set on Windows it leaves out the pages shared with other processes.
func readStat(pid int) procStat {
	var ri C.struct_rusage_info_v2
	if C.arc_rusage(C.pid_t(pid), &ri) != 0 {
		return procStat{}
	}
	var bi C.struct_proc_bsdinfo
	n := C.proc_pidinfo(C.int(pid), C.PROC_PIDTBSDINFO, 0, unsafe.Pointer(&bi), C.int(unsafe.Sizeof(bi)))
	var created int64
	if n == C.int(unsafe.Sizeof(bi)) {
		created = int64(bi.pbi_start_tvsec)*1000 + int64(bi.pbi_start_tvusec)/1000
	}
	// rusage times are mach ticks: to ns by the timebase, then to the sampler's 100ns units
	ns := float64(uint64(ri.ri_user_time)+uint64(ri.ri_system_time)) * timebase()
	return procStat{ok: true, createTs: created, cpuTime: uint64(ns / 100), mem: int64(ri.ri_phys_footprint)}
}

// readCmdline is pid's argv joined by spaces; "" when it cannot be read.
func readCmdline(pid int) string {
	return strings.Join(ReadArgv(pid), " ")
}

// readListenPorts: gopsutil reads macOS's sockets by running lsof, too slow for a 2 s tick, so no ports chip.
func readListenPorts() map[int][]int {
	return nil
}

// splitCmdline undoes readCmdline as far as it can: an argument that held a space comes back split.
func splitCmdline(cmdline string) []string {
	if cmdline == "" {
		return nil
	}
	return strings.Fields(cmdline)
}

// ReadArgv is pid's argv, read from the kernel's process arguments (claude code starts a Bash-tool command as
// `<shell> -c -l <script>`); nil when it cannot be read.
func ReadArgv(pid int) []string {
	p, err := process.NewProcess(int32(pid))
	if err != nil {
		return nil
	}
	argv, err := p.CmdlineSlice()
	if err != nil {
		return nil
	}
	return argv
}
