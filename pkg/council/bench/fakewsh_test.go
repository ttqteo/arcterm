// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package bench

import (
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"
)

// fakeWshRun is one run of the written script: what it printed, and the exit code.
type fakeWshRun struct {
	stdout, stderr string
	exit           int
}

// wantQuietRun fails the test unless the run exited 0, printed wantStdout and wrote nothing to stderr.
func wantQuietRun(t *testing.T, name string, got fakeWshRun, wantStdout string) {
	t.Helper()
	if got != (fakeWshRun{stdout: wantStdout}) {
		t.Errorf("%s: got %+v, want exit 0, stdout %q and no stderr", name, got, wantStdout)
	}
}

// fakeWshFixture writes the fake wsh into a temp folder and returns a function that runs it with sh, plus the
// requests file's path. The test is skipped when there is no sh (the script is a POSIX one).
func fakeWshFixture(t *testing.T) (run func(args ...string) fakeWshRun, requestsPath string) {
	t.Helper()
	sh, err := exec.LookPath("sh")
	if err != nil {
		t.Skip("the fake wsh is a POSIX sh script and there is no sh on PATH")
	}
	dir := t.TempDir()
	binDir := filepath.Join(dir, "bin")
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		t.Fatal(err)
	}
	requestsPath = filepath.Join(dir, "requests.jsonl")
	if err := writeFakeWsh(binDir, requestsPath); err != nil {
		t.Fatalf("writeFakeWsh: %v", err)
	}
	script := filepath.Join(binDir, "wsh")
	return func(args ...string) fakeWshRun {
		t.Helper()
		cmd := exec.Command(sh, append([]string{filepath.ToSlash(script)}, args...)...)
		var stderr strings.Builder
		cmd.Stderr = &stderr
		out, err := cmd.Output()
		code := 0
		if err != nil {
			ee, ok := err.(*exec.ExitError)
			if !ok {
				t.Fatalf("running the fake wsh %v: %v", args, err)
			}
			code = ee.ExitCode()
		}
		return fakeWshRun{stdout: string(out), stderr: stderr.String(), exit: code}
	}, requestsPath
}

func TestFakeWshRecordsJudgeCheckAndIgnoresTheRest(t *testing.T) {
	run, requestsPath := fakeWshFixture(t)

	tricky := "say \"no\" to C:\\dir\\x\nthen\tgo\r\nback"
	wantQuietRun(t, "judge with --line", run("brainstorm", "judge", "bs/brainstorm.json", "--line", tricky), "judge started\n")
	wantQuietRun(t, "judge without --line", run("brainstorm", "judge", "bs/brainstorm.json"), "judge started\n")
	wantQuietRun(t, "check", run("brainstorm", "check", "bs/brainstorm.json"), "builder check started\n")
	wantQuietRun(t, "ui reveal", run("ui", "reveal", "x"), "")
	wantQuietRun(t, "jarvis complete", run("jarvis", "complete", "--report", "r"), "")
	wantQuietRun(t, "no arguments", run(), "")
	wantQuietRun(t, "an unknown brainstorm subcommand", run("brainstorm", "status", "a.json"), "")

	got, err := readRequests(requestsPath)
	if err != nil {
		t.Fatalf("readRequests: %v", err)
	}
	want := []wshRequest{
		{Cmd: "judge", File: "bs/brainstorm.json", Line: "say \"no\" to C:\\dir\\x then go  back"},
		{Cmd: "judge", File: "bs/brainstorm.json"},
		{Cmd: "check", File: "bs/brainstorm.json"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("requests:\n got  %+v\n want %+v", got, want)
	}
}

func TestFakeWshReadsTheLineFlagAnywhereAndWithEquals(t *testing.T) {
	run, requestsPath := fakeWshFixture(t)

	run("brainstorm", "judge", "--line", "first", "a.json")
	run("brainstorm", "judge", "b.json", "--line=second")
	got, err := readRequests(requestsPath)
	if err != nil {
		t.Fatalf("readRequests: %v", err)
	}
	want := []wshRequest{
		{Cmd: "judge", File: "a.json", Line: "first"},
		{Cmd: "judge", File: "b.json", Line: "second"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("requests:\n got  %+v\n want %+v", got, want)
	}
}

func TestFakeWshOtherControlCharactersBecomeSpaces(t *testing.T) {
	run, requestsPath := fakeWshFixture(t)

	run("brainstorm", "judge", "a.json", "--line", "a\x01b\x1bc")
	got, err := readRequests(requestsPath)
	if err != nil {
		t.Fatalf("a control character broke the request line: %v", err)
	}
	want := []wshRequest{{Cmd: "judge", File: "a.json", Line: "a b c"}}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("requests:\n got  %+v\n want %+v", got, want)
	}
}

func TestFakeWshRefusesAJudgeOrCheckWithoutExactlyOnePath(t *testing.T) {
	run, requestsPath := fakeWshFixture(t)

	for _, args := range [][]string{
		{"brainstorm", "judge"},
		{"brainstorm", "judge", "--line", "x"},
		{"brainstorm", "check"},
		{"brainstorm", "check", "a.json", "b.json"},
	} {
		got := run(args...)
		if got.exit != 1 || got.stdout != "" {
			t.Errorf("%v: want exit 1 and no stdout, got %+v", args, got)
		}
		if !strings.Contains(got.stderr, "accepts 1 arg(s)") {
			t.Errorf("%v: the refusal does not say why: %q", args, got.stderr)
		}
	}
	got, err := readRequests(requestsPath)
	if err != nil || len(got) != 0 {
		t.Errorf("a refused call was recorded: %+v, %v", got, err)
	}
}

func TestFakeWshWritesAnExecutableScriptNamedWsh(t *testing.T) {
	dir := t.TempDir()
	if err := writeFakeWsh(dir, filepath.Join(dir, "requests.jsonl")); err != nil {
		t.Fatalf("writeFakeWsh: %v", err)
	}
	info, err := os.Stat(filepath.Join(dir, "wsh"))
	if err != nil {
		t.Fatal(err)
	}
	if info.IsDir() {
		t.Fatal("wsh is a directory")
	}
	// Windows has no execute bit to read back
	if runtime.GOOS != "windows" && info.Mode().Perm() != 0o755 {
		t.Errorf("wsh has mode %v, want 0755", info.Mode().Perm())
	}
	body, err := os.ReadFile(filepath.Join(dir, "wsh"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(string(body), "#!/bin/sh\n") {
		t.Errorf("the script does not start with a sh shebang: %.40q", body)
	}
	if strings.Contains(string(body), "\r") {
		t.Error("the script holds a carriage return: sh would choke on it")
	}
}

func TestFakeWshBakesTheRequestsPathWithForwardSlashesAndQuoting(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "it's here", "requests.jsonl")
	if err := writeFakeWsh(dir, path); err != nil {
		t.Fatalf("writeFakeWsh: %v", err)
	}
	body, err := os.ReadFile(filepath.Join(dir, "wsh"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(body), "\\it") || strings.Contains(string(body), "\\requests") {
		t.Errorf("the baked path keeps a backslash separator:\n%s", body)
	}
	if !strings.Contains(string(body), filepath.ToSlash(dir)) {
		t.Errorf("the script does not name the requests path under %q", filepath.ToSlash(dir))
	}
}

func TestFakeWshQuotesAPathWithASingleQuote(t *testing.T) {
	sh, err := exec.LookPath("sh")
	if err != nil {
		t.Skip("no sh on PATH")
	}
	dir := t.TempDir()
	binDir := filepath.Join(dir, "bin")
	requestsDir := filepath.Join(dir, "it's a dir")
	for _, d := range []string{binDir, requestsDir} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	requestsPath := filepath.Join(requestsDir, "requests.jsonl")
	if err := writeFakeWsh(binDir, requestsPath); err != nil {
		t.Fatalf("writeFakeWsh: %v", err)
	}
	if out, err := exec.Command(sh, filepath.ToSlash(filepath.Join(binDir, "wsh")), "brainstorm", "check", "a.json").CombinedOutput(); err != nil {
		t.Fatalf("running the script: %v: %s", err, out)
	}
	got, err := readRequests(requestsPath)
	if err != nil {
		t.Fatalf("readRequests: %v", err)
	}
	if want := []wshRequest{{Cmd: "check", File: "a.json"}}; !reflect.DeepEqual(got, want) {
		t.Errorf("requests: got %+v, want %+v", got, want)
	}
}

func TestFakeWshReadRequests(t *testing.T) {
	dir := t.TempDir()

	t.Run("a missing file is no requests", func(t *testing.T) {
		got, err := readRequests(filepath.Join(dir, "nope.jsonl"))
		if err != nil || len(got) != 0 {
			t.Errorf("got %+v, %v; want no requests and no error", got, err)
		}
	})

	t.Run("an empty line is skipped", func(t *testing.T) {
		path := filepath.Join(dir, "blank.jsonl")
		body := "{\"cmd\":\"check\",\"file\":\"a\"}\n\n{\"cmd\":\"judge\",\"file\":\"b\",\"line\":\"x\"}\n"
		if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
		got, err := readRequests(path)
		if err != nil {
			t.Fatalf("readRequests: %v", err)
		}
		want := []wshRequest{{Cmd: "check", File: "a"}, {Cmd: "judge", File: "b", Line: "x"}}
		if !reflect.DeepEqual(got, want) {
			t.Errorf("got %+v, want %+v", got, want)
		}
	})

	t.Run("a line that is not JSON is an error naming the line", func(t *testing.T) {
		path := filepath.Join(dir, "bad.jsonl")
		body := "{\"cmd\":\"check\",\"file\":\"a\"}\nnot json at all\n"
		if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
		_, err := readRequests(path)
		if err == nil {
			t.Fatal("want an error for a line that is not JSON")
		}
		if !strings.Contains(err.Error(), "line 2") || !strings.Contains(err.Error(), "not json at all") {
			t.Errorf("the error does not name the line: %v", err)
		}
	})
}
