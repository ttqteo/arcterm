//go:build !windows

package shellcomplete

import (
	"os/exec"
	"syscall"
)

// bashPath is the first bash on PATH, or "" when there is none.
func bashPath() string {
	p, err := exec.LookPath("bash")
	if err != nil {
		return ""
	}
	return p
}

// hideWindow has nothing to hide off Windows.
func hideWindow(*exec.Cmd) {}

// stopTree runs the command in a process group of its own and, when its context ends, kills the whole group, so a
// child the shell started (a test runner, a server) stops with it.
func stopTree(c *exec.Cmd) {
	c.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	c.Cancel = func() error {
		if c.Process == nil {
			return nil
		}
		return syscall.Kill(-c.Process.Pid, syscall.SIGKILL)
	}
}
