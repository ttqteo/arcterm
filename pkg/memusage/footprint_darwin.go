// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build darwin && cgo

package memusage

/*
#include <libproc.h>
#include <sys/resource.h>
extern int responsibility_get_pid_responsible_for_pid(pid_t);
*/
import "C"

import "unsafe"

// footprint is the process's physical footprint, the figure Activity Monitor shows: it counts compressed memory,
// which the resident set misses. It needs no privilege for the user's own processes.
func footprint(pid int32) (uint64, bool) {
	var ri C.struct_rusage_info_v2
	if C.proc_pid_rusage(C.int(pid), C.RUSAGE_INFO_V2, (*C.rusage_info_t)(unsafe.Pointer(&ri))) != 0 {
		return 0, false
	}
	return uint64(ri.ri_phys_footprint), true
}

// responsiblePid is the process macOS holds responsible for pid, the one Activity Monitor groups it under: the
// app for its WebKit XPC services, which launchd starts and so are no child of it.
func responsiblePid(pid int32) (int32, bool) {
	r := C.responsibility_get_pid_responsible_for_pid(C.pid_t(pid))
	if r <= 0 {
		return 0, false
	}
	return int32(r), true
}
