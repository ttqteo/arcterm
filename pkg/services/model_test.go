// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package services

import (
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/arctools"
)

func TestBackoff(t *testing.T) {
	want := []time.Duration{1, 2, 4, 8, 16, 16}
	for i, w := range want {
		if got := Backoff(i + 1); got != w*time.Second {
			t.Errorf("Backoff(%d) = %v, want %v", i+1, got, w*time.Second)
		}
	}
}

func TestCrashLogWindow(t *testing.T) {
	t0 := time.Date(2026, 10, 20, 9, 0, 0, 0, time.UTC)
	var c CrashLog
	for i := 0; i < 5; i++ {
		if got := c.Add(t0.Add(time.Duration(i) * time.Minute)); got != i+1 {
			t.Fatalf("Add #%d = %d, want %d", i+1, got, i+1)
		}
	}
	if got := c.Add(t0.Add(11 * time.Minute)); got != 4 {
		t.Errorf("Add after the window = %d, want 4 (the early crashes fell out)", got)
	}
	c.Reset()
	if got := c.Add(t0.Add(12 * time.Minute)); got != 1 {
		t.Errorf("Add after Reset = %d, want 1", got)
	}
}

func TestExitIsStop(t *testing.T) {
	cases := []struct {
		code        int
		interrupted bool
		want        bool
	}{{0, false, true}, {1, false, false}, {130, true, true}, {127, false, false}}
	for _, c := range cases {
		if got := ExitIsStop(c.code, c.interrupted); got != c.want {
			t.Errorf("ExitIsStop(%d, %v) = %v, want %v", c.code, c.interrupted, got, c.want)
		}
	}
}

func TestScanLocalURL(t *testing.T) {
	cases := []struct {
		in   string
		port int
		ok   bool
	}{
		{"  ➜  Local:   http://localhost:5173/", 5173, true},
		{"\x1b[32mhttp://127.0.0.1:41207\x1b[0m", 41207, true},
		{"on http://0.0.0.0:3000", 3000, true},
		{"https://example.com:443", 0, false},
		{"no url here", 0, false},
		{"http://localhost:5173/ and http://127.0.0.1:9000", 5173, true},
	}
	for _, c := range cases {
		port, ok := ScanLocalURL(c.in)
		if port != c.port || ok != c.ok {
			t.Errorf("ScanLocalURL(%q) = %d, %v; want %d, %v", c.in, port, ok, c.port, c.ok)
		}
	}
}

func TestNeedsRestart(t *testing.T) {
	base := arctools.Tool{Name: "a", Purpose: "p", Command: "npm", Args: "run dash", Dir: "~/x", Url: "http://127.0.0.1:8386/", Autostart: true}
	for name, mutate := range map[string]func(*arctools.Tool){
		"name":      func(t *arctools.Tool) { t.Name = "b" },
		"purpose":   func(t *arctools.Tool) { t.Purpose = "q" },
		"autostart": func(t *arctools.Tool) { t.Autostart = false },
	} {
		cur := base
		mutate(&cur)
		if NeedsRestart(base, cur) {
			t.Errorf("a changed %s restarts the service", name)
		}
	}
	for name, mutate := range map[string]func(*arctools.Tool){
		"command": func(t *arctools.Tool) { t.Command = "pnpm" },
		"args":    func(t *arctools.Tool) { t.Args = "dev" },
		"dir":     func(t *arctools.Tool) { t.Dir = "~/y" },
		"url":     func(t *arctools.Tool) { t.Url = "http://127.0.0.1:9000/" },
		"port":    func(t *arctools.Tool) { t.Port = arctools.PortAuto },
	} {
		cur := base
		mutate(&cur)
		if !NeedsRestart(base, cur) {
			t.Errorf("a changed %s does not restart the service", name)
		}
	}
}

func TestServiceDir(t *testing.T) {
	if got := ServiceDir(arctools.Tool{Dir: "~/Workspaces/dev/portfolio-journal"}); got != "~/Workspaces/dev/portfolio-journal" {
		t.Errorf("ServiceDir with a dir = %q", got)
	}
	if got := ServiceDir(arctools.Tool{}); got != "~" {
		t.Errorf("ServiceDir without a dir = %q, want ~", got)
	}
}

func TestProjectFor(t *testing.T) {
	projects := map[string]string{"arcterm": "/h/dev/arcterm", "dev": "/h/dev"}
	cases := []struct{ dir, want string }{
		{"~/dev/arcterm/app", "arcterm"},
		{"/h/dev/other", "dev"},
		{"/h/dev/arcterm2", "dev"},
		{"~", HomeProject},
		{"/tmp/x", HomeProject},
	}
	for _, c := range cases {
		if got := ProjectFor(c.dir, projects, "/h"); got != c.want {
			t.Errorf("ProjectFor(%q) = %q, want %q", c.dir, got, c.want)
		}
	}
}

func TestBusy(t *testing.T) {
	up := int64(1_000_000) // when the page first answered
	now := up + int64(5*time.Minute/time.Millisecond)
	late := up + 2*BusyMaxAge.Milliseconds() // long enough after up that an old helper still started after it
	cases := []struct {
		name  string
		procs []Proc
		now   int64
		want  bool
	}{
		{"nothing runs", nil, now, false},
		{"only what was there when the page answered", []Proc{{Pid: 1, StartMs: up - 2000}, {Pid: 2, StartMs: up - 10}}, now, false},
		{"a run the server started after", []Proc{{Pid: 1, StartMs: up - 2000}, {Pid: 9, StartMs: now - 30_000}}, now, true},
		{"a helper started after up but older than BusyMaxAge is the server's own", []Proc{{Pid: 9, StartMs: late - BusyMaxAge.Milliseconds() - 1}}, late, false},
		{"one younger than BusyMaxAge at the same late time is work", []Proc{{Pid: 9, StartMs: late - BusyMaxAge.Milliseconds() + 1000}}, late, true},
	}
	for _, c := range cases {
		if got := Busy(c.procs, up, c.now); got != c.want {
			t.Errorf("%s: Busy = %v, want %v", c.name, got, c.want)
		}
	}
	if Busy([]Proc{{Pid: 9, StartMs: now}}, 0, now) {
		t.Error("a service that never answered is never busy")
	}
}
