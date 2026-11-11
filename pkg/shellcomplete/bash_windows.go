//go:build windows

package shellcomplete

import (
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"

	"github.com/wavetermdev/waveterm/pkg/util/shellutil"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"golang.org/x/sys/windows"
)

// bashPath is Git Bash, as plan commands find it (term:gitbashpath, then the usual Git for Windows places). Where the
// config watcher is not running (a test) the setting is unread, and a bash on PATH stands in, unless it is the
// System32 one, the WSL launcher, which would run the word in a Linux distro instead.
func bashPath() string {
	var fullConfig wconfig.FullConfigType
	if w, err := wconfig.InitWatcher(); err == nil {
		fullConfig = w.GetFullConfig()
	}
	if p := shellutil.FindGitBash(&fullConfig, false); p != "" {
		return p
	}
	p, err := exec.LookPath("bash")
	if err != nil || strings.Contains(strings.ToLower(filepath.ToSlash(p)), "/system32/") {
		return ""
	}
	return p
}

// hideWindow keeps a console from flashing up for the shell.
func hideWindow(c *exec.Cmd) {
	c.SysProcAttr = &syscall.SysProcAttr{CreationFlags: windows.CREATE_NO_WINDOW}
}
