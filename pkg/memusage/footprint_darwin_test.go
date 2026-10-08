// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build darwin && cgo

package memusage

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"os/exec"
	"regexp"
	"runtime"
	"strconv"
	"testing"
)

// the summary line of footprint(1): "memusage.test [4242]: 64-bit    Footprint: 71 MB (16384 bytes per page)"
var footprintLine = regexp.MustCompile(`Footprint: ([0-9.]+) (KB|MB|GB)`)

// The panel's figure for a process is the one macOS shows for it: footprint(1), Activity Monitor's Memory column
// and top's MEM all read the physical footprint. Checked on a live child holding 64 MB, so a wrong field or unit
// cannot hide in a rounding error.
func TestLiveFootprintMatchesTheFootprintTool(t *testing.T) {
	tool, err := exec.LookPath("footprint")
	if err != nil {
		t.Skip("this Mac has no footprint tool")
	}
	child := exec.Command(os.Args[0], "-test.run=^TestHoldMemoryHelper$")
	child.Env = append(os.Environ(), "MEMUSAGE_HOLD=1")
	stdin, err := child.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	stdout, err := child.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := child.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		stdin.Close()
		child.Wait()
	})
	if line, err := bufio.NewReader(stdout).ReadString('\n'); err != nil || line != "holding\n" {
		t.Fatalf("helper said %q, %v; want holding", line, err)
	}
	pid := int32(child.Process.Pid)

	got, ok := Live().Footprint(pid)
	if !ok {
		t.Fatalf("Live().Footprint(%d) could not read a live child", pid)
	}
	out, err := exec.Command(tool, "-p", strconv.Itoa(int(pid))).CombinedOutput()
	if err != nil {
		t.Fatalf("footprint -p %d: %v\n%s", pid, err, out)
	}
	m := footprintLine.FindSubmatch(out)
	if m == nil {
		t.Fatalf("no Footprint line in:\n%s", out)
	}
	n, err := strconv.ParseFloat(string(m[1]), 64)
	if err != nil {
		t.Fatal(err)
	}
	want := uint64(n * map[string]float64{"KB": 1 << 10, "MB": 1 << 20, "GB": 1 << 30}[string(m[2])])
	// the tool reads a moment later and rounds to its unit: 5%, and at least 1 MB
	tol := max(want/20, 1<<20)
	diff := max(got, want) - min(got, want)
	if want < 64<<20 || diff > tol {
		t.Fatalf("Live().Footprint = %d bytes; footprint(1) says %s %s (%d bytes): off by %d, tolerance %d", got, m[1], m[2], want, diff, tol)
	}
}

// TestHoldMemoryHelper is TestLiveFootprintMatchesTheFootprintTool's child: it dirties 64 MB, says so, and holds
// it until its stdin closes.
func TestHoldMemoryHelper(t *testing.T) {
	if os.Getenv("MEMUSAGE_HOLD") != "1" {
		t.Skip("the child of TestLiveFootprintMatchesTheFootprintTool")
	}
	buf := make([]byte, 64<<20)
	for i := 0; i < len(buf); i += 4096 {
		buf[i] = 1
	}
	fmt.Println("holding")
	io.Copy(io.Discard, os.Stdin)
	runtime.KeepAlive(buf)
}
