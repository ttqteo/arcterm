// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package services holds arcterm's pinned apps' servers: wavesrv starts each service, gives it a port, restarts it
// when it crashes and starts it again when arcterm opens. This file is the pure model; the supervisor is beside it.
package services

import (
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/arctools"
)

const (
	StateStopped   = "stopped"
	StateStarting  = "starting"
	StateRunning   = "running"
	StateElsewhere = "elsewhere" // its page answers, but arcterm did not start what answers it
	StateRetrying  = "retrying"
	StateCrashed   = "crashed" // gave up after MaxCrashes
	StatePortTaken = "porttaken"
	StateNoPage    = "nopage"   // the process is up but its page never answered within StartTimeout
	StateSleeping  = "sleeping" // stopped by arcterm after its page sat off screen; starts again when shown
)

const (
	MaxCrashes    = 5
	CrashWindow   = 10 * time.Minute
	StartTimeout  = 30 * time.Second
	ProbeInterval = 500 * time.Millisecond
	ProbeTimeout  = 1500 * time.Millisecond
	BootStagger   = 300 * time.Millisecond // between boot starts, like RestoreLiveAgents
	IdleSleep     = 10 * time.Minute       // how long a service without Keep running runs with its page off screen, as APP_FRAME_IDLE_MS

	HomeProject = "Home" // the project of a service whose folder is inside no registered project
)

// Backoff is the wait before restart number crash (1-based): 1 s, 2 s, 4 s, 8 s, 16 s, then 16 s again.
func Backoff(crash int) time.Duration {
	if crash < 1 {
		crash = 1
	}
	if crash > 5 {
		crash = 5
	}
	return time.Duration(1<<(crash-1)) * time.Second
}

// CrashLog counts a service's crashes inside CrashWindow.
type CrashLog struct {
	times []time.Time
}

// Add records a crash at t and returns how many crashes are inside the window, this one included.
func (c *CrashLog) Add(t time.Time) int {
	kept := c.times[:0]
	for _, e := range c.times {
		if t.Sub(e) < CrashWindow {
			kept = append(kept, e)
		}
	}
	c.times = append(kept, t)
	return len(c.times)
}

// Reset forgets every crash, for a run that stayed up long enough to count as healthy.
func (c *CrashLog) Reset() {
	c.times = nil
}

// ExitIsStop reports whether a process's end is a stop the person asked for rather than a crash: a clean exit, or an
// exit after arcterm interrupted it.
func ExitIsStop(exitCode int, interrupted bool) bool {
	return exitCode == 0 || interrupted
}

var (
	ansiRe     = regexp.MustCompile(`\x1b\[[0-9;?]*[A-Za-z]`)
	localURLRe = regexp.MustCompile(`http://(?:127\.0\.0\.1|localhost|0\.0\.0\.0):(\d+)`)
)

// ScanLocalURL finds the first local http url in a service's output (a dev server announcing where it listens) and
// returns its port.
func ScanLocalURL(output string) (int, bool) {
	m := localURLRe.FindStringSubmatch(ansiRe.ReplaceAllString(output, ""))
	if m == nil {
		return 0, false
	}
	port, err := strconv.Atoi(m[1])
	if err != nil || port < 1 || port > 65535 {
		return 0, false
	}
	return port, true
}

// NeedsRestart reports whether a change from old to cur alters how the service runs. A new name, purpose or Keep
// running does not.
func NeedsRestart(old, cur arctools.Tool) bool {
	return old.Command != cur.Command || old.Args != cur.Args || old.Dir != cur.Dir || old.Url != cur.Url || old.Port != cur.Port
}

// ServiceDir is the folder a service runs in: its dir, else home.
func ServiceDir(t arctools.Tool) string {
	if t.Dir != "" {
		return t.Dir
	}
	return "~"
}

// ProjectFor is the registered project whose path holds dir (the longest match), else HomeProject. projects maps a
// project name to its path; home replaces a leading ~ in dir and in the paths.
func ProjectFor(dir string, projects map[string]string, home string) string {
	d := normalizePath(dir, home)
	best, bestLen := HomeProject, -1
	for name, path := range projects {
		p := normalizePath(path, home)
		if p == "" || !within(d, p) {
			continue
		}
		if len(p) > bestLen || (len(p) == bestLen && name < best) {
			best, bestLen = name, len(p)
		}
	}
	return best
}

func normalizePath(p, home string) string {
	if p == "" {
		return ""
	}
	if p == "~" || strings.HasPrefix(p, "~/") || strings.HasPrefix(p, `~\`) {
		p = home + p[1:]
	}
	return filepath.ToSlash(filepath.Clean(p))
}

// within reports whether dir is path or a folder under it; a sibling that only shares a prefix is not inside.
func within(dir, path string) bool {
	if dir == path {
		return true
	}
	return strings.HasPrefix(dir, strings.TrimSuffix(path, "/")+"/")
}
