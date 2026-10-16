// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestProjectSetupReadsTheCheckedInDefault(t *testing.T) {
	write := func(t *testing.T, body string) string {
		t.Helper()
		dir := t.TempDir()
		if err := os.MkdirAll(filepath.Join(dir, ".arc"), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, ".arc", "setup"), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
		return dir
	}
	t.Run("no file is no default", func(t *testing.T) {
		got, err := ProjectSetup(t.TempDir())
		if err != nil || got != "" {
			t.Fatalf("ProjectSetup = %q, %v; want empty, nil", got, err)
		}
	})
	t.Run("one line, trimmed", func(t *testing.T) {
		got, err := ProjectSetup(write(t, "\r\n  cmd arg \r\n\r\n"))
		if err != nil || got != "cmd arg" {
			t.Fatalf("ProjectSetup = %q, %v; want %q", got, err, "cmd arg")
		}
	})
	t.Run("two commands are refused", func(t *testing.T) {
		_, err := ProjectSetup(write(t, "a\nb\n"))
		if err == nil || !strings.Contains(err.Error(), ".arc/setup must hold one command, found 2 lines") {
			t.Fatalf("err = %v, want the one-command refusal", err)
		}
	})
}

func TestPlanCommandPassesQuotedArgumentsThrough(t *testing.T) {
	dir := newGitRepo(t)
	if _, err := execPlanCommandEnv(context.Background(), dir, `git config wave.probe "two words"`, nil, time.Minute, nil); err != nil {
		t.Fatal(err)
	}
	if got := gitCmd(t, dir, "config", "wave.probe"); got != "two words" {
		t.Fatalf("the shell must hand the command over unchanged, got %q", got)
	}
}

func TestPlanCommandRunsInAPosixShell(t *testing.T) {
	dir := newGitRepo(t)
	// an inline VAR=value prefix and $(...), which cmd.exe rejected in acceptance 2, and a /-leading
	// argument Git Bash would otherwise rewrite into a Windows path
	command := `WAVE_PROBE="$(echo two) words" sh -c 'git config wave.one "$WAVE_PROBE"' && git config wave.two /usr`
	if _, err := execPlanCommandEnv(context.Background(), dir, command, nil, time.Minute, nil); err != nil {
		t.Fatal(err)
	}
	if got := gitCmd(t, dir, "config", "wave.one"); got != "two words" {
		t.Fatalf("want the prefixed variable with its substitution, got %q", got)
	}
	if got := gitCmd(t, dir, "config", "wave.two"); got != "/usr" {
		t.Fatalf("want the argument unchanged, got %q", got)
	}
}

func TestPlanCommandReportsExitCodeAndOutput(t *testing.T) {
	_, err := execPlanCommandEnv(context.Background(), newGitRepo(t), "git no-such-subcommand", nil, time.Minute, nil)
	var pe *planCommandError
	if !errors.As(err, &pe) {
		t.Fatalf("want a planCommandError, got %v", err)
	}
	if pe.reason() != "exit 1" || !strings.Contains(pe.output, "no-such-subcommand") {
		t.Fatalf("want exit 1 with git's message, got %q / %q", pe.reason(), pe.output)
	}
}

func TestExecPlanCommandReturnsOutputOnSuccess(t *testing.T) {
	out, err := execPlanCommandEnv(context.Background(), t.TempDir(), "echo all green", nil, time.Minute, nil)
	if err != nil {
		t.Fatal(err)
	}
	if out != "all green" {
		t.Fatalf("a passing command hands back its output tail, got %q", out)
	}
}

func TestPlanCommandTimesOut(t *testing.T) {
	_, err := execPlanCommandEnv(context.Background(), t.TempDir(), "sleep 5", nil, 200*time.Millisecond, nil)
	var pe *planCommandError
	if !errors.As(err, &pe) || pe.reason() != "timed out after 200ms" {
		t.Fatalf("want a timeout, got %v", err)
	}
}

func TestTailBufferKeepsTheEnd(t *testing.T) {
	b := &tailBuffer{max: 5}
	b.Write([]byte("abc"))
	b.Write([]byte("defgh"))
	if got := b.String(); got != "defgh" {
		t.Fatalf("want the last 5 bytes, got %q", got)
	}
}

func TestTailBufferDropsColorCodes(t *testing.T) {
	b := &tailBuffer{max: MaxPlanOutputLen}
	writeAll(b, "    at runTest (file:///repo/node_modules/\x1b[4m@vitest\x1b[24m/runner/dist/index.js:1:2)\n")
	if got := b.String(); got != "at runTest (file:///repo/node_modules/@vitest/runner/dist/index.js:1:2)" {
		t.Fatalf("color codes kept: %q", got)
	}
}

func TestFailureOutputDropsColorCodesFromTheBlocks(t *testing.T) {
	b := &tailBuffer{max: MaxPlanOutputLen}
	writeAll(b, "--- FAIL: TestColor (0.00s)\n    color_test.go:3: \x1b[31mwant red\x1b[39m\n", noisyLog(300))
	out := b.failureOutput()
	if !strings.Contains(out, "color_test.go:3: want red") || strings.Contains(out, "\x1b") {
		t.Fatalf("color codes kept: %q", out[:200])
	}
}

// laterStages is what a chained Verify prints after an early stage failed: far more than the detail cap.
func laterStages() string {
	return strings.Repeat("ok  \tgithub.com/wavetermdev/waveterm/pkg/x\t0.123s\n", 100)
}

func TestFirstFailureExcerptFindsAnEarlyStageFailure(t *testing.T) {
	output := "vitest starting\n  --- FAIL: TestEarly (0.00s)\n    early_test.go:9: want 1, got 2\n" + laterStages()
	got := firstFailureExcerpt(output)
	if !strings.HasPrefix(got, "--- FAIL: TestEarly") {
		t.Fatalf("want the excerpt to start at the first failing line, got %q", got)
	}
}

func TestFailureDetailFallsBackToTheTail(t *testing.T) {
	output := strings.Repeat("noise line that is not a failure\n", 30) + "the cause is at the end"
	got := failureDetail(&planCommandError{exitCode: 1, output: output})
	if !strings.HasPrefix(got, "exit 1: ") || !strings.HasSuffix(got, "the cause is at the end") || len(got) > MaxFailureDetailLen {
		t.Fatalf("want the reason and the end of the output within %d bytes, got %q", MaxFailureDetailLen, got)
	}
}

func TestFirstFailureExcerptRespectsTheDetailCap(t *testing.T) {
	got := firstFailureExcerpt("FAIL\tpkg\n" + laterStages())
	if got == "" || len(got) > MaxFailureDetailLen {
		t.Fatalf("want a non-empty excerpt within %d bytes, got %d bytes", MaxFailureDetailLen, len(got))
	}
}

func TestFailureDetailKeepsTheReasonPrefix(t *testing.T) {
	output := "error: stage one broke\n" + laterStages()
	exit := failureDetail(&planCommandError{exitCode: 2, output: output})
	if !strings.HasPrefix(exit, "exit 2: error: stage one broke") || len(exit) > MaxFailureDetailLen {
		t.Fatalf("want the exit prefix then the first failure within the cap, got %q", exit)
	}
	timeout := failureDetail(&planCommandError{timeout: 20 * time.Minute, output: output})
	if !strings.HasPrefix(timeout, "timed out after 20m: error: stage one broke") || len(timeout) > MaxFailureDetailLen {
		t.Fatalf("want the timeout prefix then the first failure within the cap, got %q", timeout)
	}
}

// run c84aa179's land Check was terminated from outside and held as "exit 1073807364", which reads as a failure
func TestKilledFromOutsideNamesAForcedExit(t *testing.T) {
	for _, c := range []struct {
		code  int
		state string
		want  string
	}{
		{1073807364, "exit status 1073807364", "exit 0x40010004"},
		{3221225786, "exit status 3221225786", "exit 0xc000013a"},
		{-1, "signal: killed", "signal: killed"},
		{1, "exit status 1", ""},
		{2, "exit status 2", ""},
	} {
		if got := killedFromOutside(c.code, c.state); got != c.want {
			t.Errorf("killedFromOutside(%d, %q) = %q, want %q", c.code, c.state, got, c.want)
		}
	}
	got := failureDetail(&planCommandError{exitCode: 1073807364, killed: "exit 0x40010004", output: "tsc"})
	if !strings.HasPrefix(got, "killed from outside (exit 0x40010004): ") {
		t.Fatalf("a killed command's detail must say so, got %q", got)
	}
}

func TestTailBufferPublishesOnlyAChangedTailOncePerInterval(t *testing.T) {
	var published []string
	b := &tailBuffer{
		max:          MaxPlanOutputLen,
		publish:      func(tail string) bool { published = append(published, tail); return true },
		publishEvery: time.Minute,
	}
	base := time.Now()

	// the first write publishes at once, so a command that prints and then thinks is not read as silent
	b.Write([]byte("running pkg/one\n"))
	if len(published) != 1 || published[0] != "running pkg/one" {
		t.Fatalf("want the first tail published immediately, got %q", published)
	}
	// inside the interval, however much is written
	b.Write([]byte("running pkg/two\n"))
	if len(published) != 1 {
		t.Fatalf("want no second publish inside the interval, got %q", published)
	}
	// past it, the grown tail goes out once
	b.lastPublish = base.Add(-2 * time.Minute)
	b.maybePublish(base)
	if len(published) != 2 || published[1] != "running pkg/one\nrunning pkg/two" {
		t.Fatalf("want the grown tail published, got %q", published)
	}
	// a silent command costs no write, however many intervals pass
	b.lastPublish = base.Add(-2 * time.Minute)
	b.maybePublish(base)
	if len(published) != 2 {
		t.Fatalf("an unchanged tail must not be published again, got %q", published)
	}
}

func TestTailBufferWithNoSinkKeepsItsTail(t *testing.T) {
	b := &tailBuffer{max: MaxPlanOutputLen}
	b.Write([]byte("setup output\n"))
	if got := b.String(); got != "setup output" {
		t.Fatalf("a command with no progress sink still keeps its tail, got %q", got)
	}
}

func TestLastOutputLineIsTheLastNonBlankLine(t *testing.T) {
	if got := lastOutputLine("ok pkg/one\nok pkg/two\n\n  \n"); got != "ok pkg/two" {
		t.Fatalf("want the last line with content, got %q", got)
	}
	if got := lastOutputLine("  \n\n"); got != "" {
		t.Fatalf("output with no content has no line to show, got %q", got)
	}
}

// A sink that declines must leave the tail unsent, or it goes unpublished until the output changes
// again — which for a Verify that has gone quiet means never.
func TestTailBufferRepublishesATailTheSinkDeclined(t *testing.T) {
	var published []string
	accept := false
	b := &tailBuffer{
		max: MaxPlanOutputLen,
		publish: func(tail string) bool {
			published = append(published, tail)
			return accept
		},
		publishEvery: time.Minute,
	}
	base := time.Now()

	b.Write([]byte("running pkg/one\n"))
	if len(published) != 1 {
		t.Fatalf("want one offer, got %q", published)
	}
	accept = true
	b.lastPublish = base.Add(-2 * time.Minute)
	b.maybePublish(base)
	if len(published) != 2 || published[1] != "running pkg/one" {
		t.Fatalf("a declined tail must be offered again unchanged, got %q", published)
	}
	// once taken, it is not offered a third time
	b.lastPublish = base.Add(-2 * time.Minute)
	b.maybePublish(base)
	if len(published) != 2 {
		t.Fatalf("an accepted tail must not be republished, got %q", published)
	}
}

// noisyLog is what a failing, chatty Go package prints around its failing test: unindented log lines.
func noisyLog(n int) string {
	return strings.Repeat("2026/09/25 11:40:01 CreateRun: capturing dossier failed: no such file\n", n)
}

func writeAll(b *tailBuffer, parts ...string) {
	for _, p := range parts {
		b.Write([]byte(p))
	}
}

func TestFailureOutputKeepsTheFailingTestPastTheTail(t *testing.T) {
	b := &tailBuffer{max: MaxPlanOutputLen}
	writeAll(b, noisyLog(20), "--- FAIL: TestLeadComplete (0.03s)\n", "    leadcomplete_test.go:41: want done, got running\n",
		noisyLog(300), "FAIL\n", "FAIL\tgithub.com/wavetermdev/waveterm/pkg/wshrpc/wshserver\t26.299s\n")
	out := b.failureOutput()
	for _, want := range []string{"--- FAIL: TestLeadComplete", "want done, got running", "FAIL\tgithub.com/wavetermdev/waveterm/pkg/wshrpc/wshserver"} {
		if !strings.Contains(out, want) {
			t.Fatalf("output lost %q", want)
		}
	}
	if len(out) > MaxPlanOutputLen {
		t.Fatalf("output is %d bytes, over %d", len(out), MaxPlanOutputLen)
	}
	got := failureDetail(&planCommandError{exitCode: 1, output: out})
	if !strings.HasPrefix(got, "exit 1: --- FAIL: TestLeadComplete") {
		t.Fatalf("detail = %q", got)
	}
}

func TestFailureOutputJoinsALineSplitAcrossWrites(t *testing.T) {
	b := &tailBuffer{max: MaxPlanOutputLen}
	writeAll(b, "--- FA", "IL: TestSplit (0.00s)\r\n    split_test.go:9: bro", "ken\r\n", noisyLog(300))
	out := b.failureOutput()
	if !strings.Contains(out, "--- FAIL: TestSplit") || !strings.Contains(out, "split_test.go:9: broken") || strings.Contains(out, "\r") {
		t.Fatalf("split or CRLF block not kept whole: %q", out[:200])
	}
}

func TestFailureOutputKeepsAPanicTrace(t *testing.T) {
	b := &tailBuffer{max: MaxPlanOutputLen}
	writeAll(b, "panic: runtime error: index out of range [3] with length 3\n\ngoroutine 7 [running]:\n",
		"github.com/wavetermdev/waveterm/pkg/orchestrate.pick(...)\n\t/src/pkg/orchestrate/pick.go:12 +0x1d\n", noisyLog(300))
	out := b.failureOutput()
	if !strings.Contains(out, "panic: runtime error") || !strings.Contains(out, "pick.go:12") {
		t.Fatalf("panic trace not kept: %q", out[:300])
	}
}

func TestFailureOutputCapsTheBlocks(t *testing.T) {
	b := &tailBuffer{max: MaxPlanOutputLen}
	for i := 0; i < 400; i++ {
		writeAll(b, fmt.Sprintf("--- FAIL: TestMany%d (0.00s)\n    many_test.go:1: nope\n", i))
	}
	writeAll(b, noisyLog(300))
	out := b.failureOutput()
	head, _, _ := strings.Cut(out, "\n…\n")
	if len(head) > MaxFailureBlocksLen || !strings.HasPrefix(head, "--- FAIL: TestMany0 ") {
		t.Fatalf("blocks = %d bytes, starting %q", len(head), head[:40])
	}
}

func TestFailureOutputBoundsAHugeUnterminatedLine(t *testing.T) {
	b := &tailBuffer{max: MaxPlanOutputLen}
	writeAll(b, strings.Repeat("x", 1<<20))
	if len(b.partial) > MaxFailureBlocksLen {
		t.Fatalf("partial line grew to %d bytes", len(b.partial))
	}
	if out := b.failureOutput(); len(out) > MaxPlanOutputLen {
		t.Fatalf("output %d bytes", len(out))
	}
}

func TestFailureOutputIsTheTailWhenNothingWasDropped(t *testing.T) {
	b := &tailBuffer{max: MaxPlanOutputLen}
	writeAll(b, "--- FAIL: TestSmall (0.00s)\n    small_test.go:3: nope\nFAIL\n")
	if out := b.failureOutput(); out != b.String() || strings.Count(out, "TestSmall") != 1 {
		t.Fatalf("short output must not be duplicated: %q", out)
	}
}

func TestFirstFailureExcerptPrefersTheFailingTest(t *testing.T) {
	output := "FAIL\tpkg/a\t0.1s\n" + noisyLog(2) + "--- FAIL: TestLater (0.00s)\n"
	if got := firstFailureExcerpt(output); !strings.HasPrefix(got, "--- FAIL: TestLater") {
		t.Fatalf("excerpt = %q", got)
	}
}

func TestPlanCommandFailureKeepsTheFailingTest(t *testing.T) {
	script := `printf -- '--- FAIL: TestReal (0.00s)\n    real_test.go:5: bad\n'; i=0; while [ $i -lt 300 ]; do echo "noise line $i of the package log"; i=$((i+1)); done; exit 1`
	_, err := execPlanCommandEnv(context.Background(), t.TempDir(), script, nil, time.Minute, nil)
	var pe *planCommandError
	if !errors.As(err, &pe) || !strings.Contains(pe.output, "--- FAIL: TestReal") || !strings.HasPrefix(failureDetail(err), "exit 1: --- FAIL: TestReal") {
		t.Fatalf("err = %v", err)
	}
}

// a plan command in a tree whose node_modules links into the main checkout must not let pnpm reinstall it
func TestExecPlanCommandTurnsOffPnpmsInstallBeforeRun(t *testing.T) {
	out, err := execPlanCommandEnv(context.Background(), t.TempDir(), `echo "[$pnpm_config_verify_deps_before_run]"`, nil, time.Minute, nil)
	if err != nil {
		t.Fatal(err)
	}
	if out != "[false]" {
		t.Fatalf("pnpm_config_verify_deps_before_run = %s, want [false]", out)
	}
}
