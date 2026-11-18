//go:build darwin

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package resmon

import (
	"os"
	"os/exec"
	"testing"
	"time"
)

func TestReadTableAndStatDarwin(t *testing.T) {
	table, err := readTable()
	if err != nil {
		t.Fatal(err)
	}
	self, ok := table[os.Getpid()]
	if !ok {
		t.Fatalf("the table has no row for this process (%d)", os.Getpid())
	}
	if self.Ppid != os.Getppid() || self.Name == "" {
		t.Fatalf("self row = %+v, want ppid %d and a name", self, os.Getppid())
	}
	s := readStat(os.Getpid())
	if !s.ok || s.mem <= 0 || s.cpuTime == 0 {
		t.Fatalf("readStat(self) = %+v", s)
	}
	if age := time.Since(time.UnixMilli(s.createTs)); age < 0 || age > time.Hour {
		t.Fatalf("readStat(self).createTs is %v ago", age)
	}
	if readStat(1).ok {
		t.Log("launchd reads: this test runs as root")
	}
}

func TestReadStatCountsCpuDarwin(t *testing.T) {
	before := readStat(os.Getpid()).cpuTime
	deadline := time.Now().Add(150 * time.Millisecond)
	for x := 0; time.Now().Before(deadline); x++ {
		_ = x * x
	}
	after := readStat(os.Getpid()).cpuTime
	// 100 ms of spinning is 1,000,000 units of 100ns; a wrong timebase is off by ~40x either way
	if d := after - before; d < 500_000 || d > 3_000_000 {
		t.Fatalf("150 ms of spinning read as %d units of 100ns", d)
	}
}

func TestReadArgvDarwin(t *testing.T) {
	cmd := exec.Command("sleep", "30")
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	defer cmd.Process.Kill()
	time.Sleep(50 * time.Millisecond)
	if got := readCmdline(cmd.Process.Pid); got != "sleep 30" {
		t.Fatalf("readCmdline(sleep) = %q", got)
	}
}

func TestIsVersionName(t *testing.T) {
	for name, want := range map[string]bool{"2.1.327": true, "1.0": true, "claude": false, "2": false, "": false, "node22.1": false} {
		if got := isVersionName(name); got != want {
			t.Errorf("isVersionName(%q) = %v, want %v", name, got, want)
		}
	}
}

func TestOuterBundle(t *testing.T) {
	cases := map[string]string{
		"/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Versions/1/Helpers/Google Chrome Helper (Renderer).app/Contents/MacOS/Google Chrome Helper (Renderer)": "/Applications/Google Chrome.app",
		"/Applications/Zalo.app/Contents/MacOS/Zalo": "/Applications/Zalo.app",
		"/System/Library/CoreServices/Finder.app":    "/System/Library/CoreServices/Finder.app",
		"/opt/homebrew/bin/node":                     "",
		"":                                           "",
	}
	for path, want := range cases {
		if got := outerBundle(path); got != want {
			t.Errorf("outerBundle(%q) = %q, want %q", path, got, want)
		}
	}
	if got := bundleName("/Applications/Google Chrome.app"); got != "Google Chrome" {
		t.Errorf("bundleName = %q", got)
	}
}

func TestReadIconOfAnAppDarwin(t *testing.T) {
	finder := "/System/Library/CoreServices/Finder.app"
	if _, err := os.Stat(finder); err != nil {
		t.Skip("no Finder.app")
	}
	data, err := os.ReadFile(bundleIconPath(finder))
	if err != nil {
		t.Skipf("Finder's icon is not an .icns here: %v", err)
	}
	img := icnsImage(data, iconSide)
	if img == nil {
		t.Fatal("Finder's .icns read as no image")
	}
	if b := img.Bounds(); b.Dx() != iconSide || b.Dy() != iconSide {
		t.Fatalf("icon is %v, want %dx%d", b, iconSide, iconSide)
	}
}

func TestSipsIconDarwin(t *testing.T) {
	icns := "/Applications/Zalo.app/Contents/Resources/icon.icns"
	if _, err := os.Stat(icns); err != nil {
		t.Skip("no Zalo here, whose .icns holds only JPEG 2000")
	}
	if got := sipsIcon(icns, iconSide); len(got) == 0 {
		t.Fatal("sips read no icon")
	}
}
