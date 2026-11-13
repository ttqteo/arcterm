//go:build !windows

package ctxbreakdown

import "os/exec"

func hideWindow(cmd *exec.Cmd) {}
