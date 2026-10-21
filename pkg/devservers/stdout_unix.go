// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build !windows

package devservers

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"time"
)

// lsofTimeout bounds one lsof call; a hung network mount can stall it
const lsofTimeout = 3 * time.Second

// stdoutFile is the regular file pid's stdout (else its stderr) writes to, "" when it writes to a terminal or a pipe,
// or pid can't be read. Linux reads /proc; macOS asks lsof.
func stdoutFile(pid int32) string {
	if runtime.GOOS == "linux" {
		for _, fd := range []int{1, 2} {
			path, err := os.Readlink(fmt.Sprintf("/proc/%d/fd/%d", pid, fd))
			if err != nil {
				continue
			}
			if st, err := os.Stat(path); err == nil && st.Mode().IsRegular() {
				return path
			}
		}
		return ""
	}
	ctx, cancel := context.WithTimeout(context.Background(), lsofTimeout)
	defer cancel()
	// -F f t n: one line per field, "f1", "tREG", "n/path"
	out, err := exec.CommandContext(ctx, "lsof", "-w", "-n", "-P", "-a", "-p", fmt.Sprint(pid), "-d", "1,2", "-Fftn").Output()
	if err != nil {
		return ""
	}
	return lsofRegularFile(string(out))
}

// lsofRegularFile is the first regular file in lsof -Fftn output for fds 1 and 2, fd 1 first.
func lsofRegularFile(out string) string {
	files := map[string]string{}
	fd, typ := "", ""
	for _, line := range strings.Split(out, "\n") {
		if line == "" {
			continue
		}
		switch line[0] {
		case 'f':
			fd, typ = line[1:], ""
		case 't':
			typ = line[1:]
		case 'n':
			if typ == "REG" && files[fd] == "" {
				files[fd] = line[1:]
			}
		}
	}
	if files["1"] != "" {
		return files["1"]
	}
	return files["2"]
}
