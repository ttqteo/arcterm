//go:build !windows

package shellcomplete

import "os/exec"

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
