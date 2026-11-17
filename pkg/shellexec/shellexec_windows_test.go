//go:build windows

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package shellexec

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/util/shellutil"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

func startForTest(t *testing.T, cmdStr string, argv []string) CmdWrap {
	t.Helper()
	// the shells' startup files are written under the data dir, which is the working dir when it is unset
	saved := wavebase.DataHome_VarCache
	wavebase.DataHome_VarCache = t.TempDir()
	t.Cleanup(func() { wavebase.DataHome_VarCache = saved })
	opts := CommandOptsType{
		SwapToken: &shellutil.TokenSwapEntry{Token: "test-" + t.Name(), Env: map[string]string{}},
		Argv:      argv,
	}
	sp, err := StartLocalShellProc(context.Background(), waveobj.TermSize{Rows: 24, Cols: 80}, cmdStr, opts, "")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(sp.Close)
	return sp.Cmd.(CmdWrap)
}

// An agent's launch (its program apart from its args) whose program is an .exe runs as the pty's own process: no
// PowerShell host held alive as its parent.
func TestStartLocalShellProcRunsAnExeWithoutTheShell(t *testing.T) {
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv(helperEnv, "sleep")
	cw := startForTest(t, `"`+exe+`" -test.run=^TestHelperProcess$`, []string{exe, "-test.run=^TestHelperProcess$"})
	if !strings.EqualFold(cw.Cmd.Path, exe) {
		t.Fatalf("started %q, want the program itself %q", cw.Cmd.Path, exe)
	}
	if len(cw.Cmd.Args) != 2 || cw.Cmd.Args[1] != "-test.run=^TestHelperProcess$" {
		t.Fatalf("args = %q, want the program's own args unquoted", cw.Cmd.Args)
	}
}

// A program that is not an .exe (not found here, as an alias or a .cmd shim would not be) keeps the shell.
func TestStartLocalShellProcKeepsTheShellForAProgramItCannotStart(t *testing.T) {
	cw := startForTest(t, "no-such-program-for-shellexec-test", []string{"no-such-program-for-shellexec-test"})
	shell := strings.ToLower(filepath.Base(cw.Cmd.Path))
	if shell != "powershell.exe" && shell != "pwsh.exe" && shell != "cmd.exe" {
		t.Fatalf("started %q, want the shell running the line", cw.Cmd.Path)
	}
}
