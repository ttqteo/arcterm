// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package shellexec

import (
	"io"
	"log"
	"os/exec"
	"runtime"
	"sync"
	"syscall"
	"time"

	"github.com/creack/pty"
	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/util/jobobject"
	"github.com/wavetermdev/waveterm/pkg/util/unixutil"
)

type ConnInterface interface {
	Kill()
	KillGraceful(time.Duration)
	Wait() error
	Start() error
	ExitCode() int
	ExitSignal() string
	StdinPipe() (io.WriteCloser, error)
	StdoutPipe() (io.ReadCloser, error)
	StderrPipe() (io.ReadCloser, error)
	SetSize(w int, h int) error
	pty.Pty
}

type CmdWrap struct {
	Cmd          *exec.Cmd
	IsShell      bool
	WaitOnce     *sync.Once
	WaitErr      error
	jobHandle    uintptr // windows job object (0 when not attached / not windows)
	jobCloseOnce *sync.Once
	pty.Pty
}

func MakeCmdWrap(cmd *exec.Cmd, cmdPty pty.Pty, isShell bool, blockId string) CmdWrap {
	cw := CmdWrap{
		Cmd:      cmd,
		IsShell:  isShell,
		WaitOnce: &sync.Once{},
		Pty:      cmdPty,
	}
	// the process is already started by pty.StartWithSize; put it in a job object so
	// closing the block kills the whole tree (shell + descendants), not just the shell
	if cmd != nil && cmd.Process != nil {
		if job, err := jobobject.Attach(cmd.Process); err != nil {
			log.Printf("MakeCmdWrap: job attach failed for pid %d: %v", cmd.Process.Pid, err)
		} else {
			cw.jobHandle = job
			cw.jobCloseOnce = &sync.Once{}
			if blockId != "" {
				jobobject.Register(job, cmd.Process.Pid, jobobject.Owner{Kind: jobobject.OwnerKind_Block, Id: blockId})
			}
		}
	}
	return cw
}

func (cw CmdWrap) Kill() {
	jobobject.KillTree(cw.jobHandle)
	cw.Cmd.Process.Kill()
}

func (cw CmdWrap) Wait() error {
	cw.WaitOnce.Do(func() {
		cw.WaitErr = cw.Cmd.Wait()
	})
	// the direct process exited; close the job handle so KILL_ON_JOB_CLOSE reaps any
	// descendants that outlived it (terminal-close semantics for the block's tree)
	if cw.jobCloseOnce != nil {
		cw.jobCloseOnce.Do(func() { jobobject.Close(cw.jobHandle) })
	}
	return cw.WaitErr
}

// only valid once Wait() has returned (or you know Cmd is done)
func (cw CmdWrap) ExitCode() int {
	state := cw.Cmd.ProcessState
	if state == nil {
		return -1
	}
	return state.ExitCode()
}

func (cw CmdWrap) ExitSignal() string {
	state := cw.Cmd.ProcessState
	if state == nil {
		return ""
	}
	if ws, ok := state.Sys().(syscall.WaitStatus); ok {
		if ws.Signaled() {
			return unixutil.GetSignalName(ws.Signal())
		}
	}
	return ""
}

func (cw CmdWrap) KillGraceful(timeout time.Duration) {
	if cw.Cmd.Process == nil {
		return
	}
	if cw.Cmd.ProcessState != nil && cw.Cmd.ProcessState.Exited() {
		return
	}
	if runtime.GOOS == "windows" {
		jobobject.KillTree(cw.jobHandle) // terminates the whole tree when the job is attached
		cw.Cmd.Process.Kill()            // direct-process fallback if job attach failed
		if cw.jobCloseOnce != nil {
			cw.jobCloseOnce.Do(func() { jobobject.Close(cw.jobHandle) })
		}
		return
	}
	if cw.IsShell {
		unixutil.SignalHup(cw.Cmd.Process.Pid)
	} else {
		unixutil.SignalTerm(cw.Cmd.Process.Pid)
	}
	go func() {
		defer func() {
			panichandler.PanicHandler("KillGraceful:Kill", recover())
		}()
		time.Sleep(timeout)
		if cw.Cmd.ProcessState == nil || !cw.Cmd.ProcessState.Exited() {
			cw.Cmd.Process.Kill() // force kill if it is already not exited
		}
	}()
}

func (cw CmdWrap) Start() error {
	defer func() {
		for _, extraFile := range cw.Cmd.ExtraFiles {
			if extraFile != nil {
				extraFile.Close()
			}
		}
	}()
	return cw.Cmd.Start()
}

func (cw CmdWrap) StdinPipe() (io.WriteCloser, error) {
	return cw.Cmd.StdinPipe()
}

func (cw CmdWrap) StdoutPipe() (io.ReadCloser, error) {
	return cw.Cmd.StdoutPipe()
}

func (cw CmdWrap) StderrPipe() (io.ReadCloser, error) {
	return cw.Cmd.StderrPipe()
}

func (cw CmdWrap) SetSize(w int, h int) error {
	err := pty.Setsize(cw.Pty, &pty.Winsize{Rows: uint16(w), Cols: uint16(h)})
	if err != nil {
		return err
	}
	return nil
}
