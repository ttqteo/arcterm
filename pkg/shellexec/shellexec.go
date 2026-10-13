// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package shellexec

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"sync"
	"time"

	"maps"

	"github.com/creack/pty"
	"github.com/wavetermdev/waveterm/pkg/blocklogger"
	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/util/pamparse"
	"github.com/wavetermdev/waveterm/pkg/util/shellutil"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

const DefaultGracefulKillWait = 400 * time.Millisecond

type CommandOptsType struct {
	Interactive bool                      `json:"interactive,omitempty"`
	Login       bool                      `json:"login,omitempty"`
	Cwd         string                    `json:"cwd,omitempty"`
	ShellPath   string                    `json:"shellPath,omitempty"`
	ShellOpts   []string                  `json:"shellOpts,omitempty"`
	SwapToken   *shellutil.TokenSwapEntry `json:"swapToken,omitempty"`
	ForceJwt    bool                      `json:"forcejwt,omitempty"`
	BlockId     string                    `json:"-"` // registers the shell's job as owned by this block
}

type ShellProc struct {
	ConnName  string
	Cmd       ConnInterface
	CloseOnce *sync.Once
	DoneCh    chan any // closed after proc.Wait() returns
	WaitErr   error    // WaitErr is synchronized by DoneCh (written before DoneCh is closed) and CloseOnce
}

func (sp *ShellProc) Close() {
	sp.Cmd.KillGraceful(DefaultGracefulKillWait)
	go func() {
		defer func() {
			panichandler.PanicHandler("ShellProc.Close", recover())
		}()
		waitErr := sp.Cmd.Wait()
		sp.SetWaitErrorAndSignalDone(waitErr)

		// windows cannot handle the pty being
		// closed twice, so we let the pty
		// close itself instead
		if runtime.GOOS != "windows" {
			sp.Cmd.Close()
		}
	}()
}

func (sp *ShellProc) SetWaitErrorAndSignalDone(waitErr error) {
	sp.CloseOnce.Do(func() {
		sp.WaitErr = waitErr
		close(sp.DoneCh)
	})
}

func (sp *ShellProc) Wait() error {
	<-sp.DoneCh
	return sp.WaitErr
}

// returns (done, waitError)
func (sp *ShellProc) WaitNB() (bool, error) {
	select {
	case <-sp.DoneCh:
		return true, sp.WaitErr
	default:
		return false, nil
	}
}

func checkCwd(cwd string) error {
	if cwd == "" {
		return fmt.Errorf("cwd is empty")
	}
	if _, err := os.Stat(cwd); err != nil {
		return fmt.Errorf("error statting cwd %q: %w", cwd, err)
	}
	return nil
}

// ensureWshOnPath prepends WAVETERM_WSHBINDIR to the command's PATH so `wsh` is resolvable.
// Interactive shells get this from the rc-file shell integration, but a forced-JWT agent runs as
// `shell -c "..."` which skips that bootstrap — leaving wsh off PATH so hook-driven tools that shell
// out to `wsh` (e.g. the external agent-status reporter) silently fail and the cockpit never
// receives agent status. Idempotent: a no-op if the bin dir is already on PATH.
func ensureWshOnPath(ecmd *exec.Cmd) {
	var binDir string
	for _, kv := range ecmd.Env {
		if name, val, ok := strings.Cut(kv, "="); ok && name == "WAVETERM_WSHBINDIR" {
			binDir = val
			break
		}
	}
	if binDir == "" {
		return
	}
	sep := string(os.PathListSeparator)
	for i, kv := range ecmd.Env {
		name, val, _ := strings.Cut(kv, "=")
		if strings.EqualFold(name, "PATH") {
			for _, p := range strings.Split(val, sep) {
				if strings.EqualFold(p, binDir) {
					return
				}
			}
			ecmd.Env[i] = name + "=" + binDir + sep + val
			return
		}
	}
	ecmd.Env = append(ecmd.Env, "PATH="+binDir)
}

func StartLocalShellProc(logCtx context.Context, termSize waveobj.TermSize, cmdStr string, cmdOpts CommandOptsType, connName string) (*ShellProc, error) {
	if cmdOpts.SwapToken == nil {
		return nil, fmt.Errorf("SwapToken is required in CommandOptsType")
	}
	shellutil.InitCustomShellStartupFiles()
	var ecmd *exec.Cmd
	var shellOpts []string
	shellPath := cmdOpts.ShellPath
	if shellPath == "" {
		shellPath = shellutil.DetectLocalShellPath()
	}
	shellType := shellutil.GetShellTypeFromShellPath(shellPath)
	shellOpts = append(shellOpts, cmdOpts.ShellOpts...)
	var isShell bool
	if cmdStr == "" {
		isShell = true
		if shellType == shellutil.ShellType_bash {
			// add --rcfile
			// cant set -l or -i with --rcfile
			shellOpts = append(shellOpts, "--rcfile", shellutil.GetLocalBashRcFileOverride())
		} else if shellType == shellutil.ShellType_fish {
			if cmdOpts.Login {
				shellOpts = append(shellOpts, "-l")
			}
			waveFishPath := shellutil.GetLocalWaveFishFilePath()
			carg := fmt.Sprintf("source %s", shellutil.HardQuoteFish(waveFishPath))
			shellOpts = append(shellOpts, "-C", carg)
		} else if shellType == shellutil.ShellType_pwsh {
			shellOpts = append(shellOpts, "-ExecutionPolicy", "Bypass", "-NoExit", "-File", shellutil.GetLocalWavePowershellEnv())
		} else {
			if cmdOpts.Login {
				shellOpts = append(shellOpts, "-l")
			}
			if cmdOpts.Interactive {
				shellOpts = append(shellOpts, "-i")
			}
		}
		blocklogger.Debugf(logCtx, "[conndebug] shell:%s shellOpts:%v\n", shellPath, shellOpts)
		ecmd = exec.Command(shellPath, shellOpts...)
		ecmd.Env = os.Environ()
		if shellType == shellutil.ShellType_zsh {
			shellutil.UpdateCmdEnv(ecmd, map[string]string{"ZDOTDIR": shellutil.GetLocalZshZDotDir()})
		}
	} else {
		isShell = false
		shellOpts = append(shellOpts, "-c", cmdStr)
		ecmd = exec.Command(shellPath, shellOpts...)
		ecmd.Env = os.Environ()
	}

	packedToken, err := cmdOpts.SwapToken.PackForClient()
	if err != nil {
		blocklogger.Infof(logCtx, "error packing swap token: %v", err)
	} else {
		blocklogger.Debugf(logCtx, "packed swaptoken %s\n", packedToken)
		shellutil.UpdateCmdEnv(ecmd, map[string]string{wavebase.WaveSwapTokenVarName: packedToken})
	}
	jwtToken := cmdOpts.SwapToken.Env[wavebase.WaveJwtTokenVarName]
	if jwtToken != "" && cmdOpts.ForceJwt {
		// cmd:shell=false runs the command non-interactively, so the shell-integration bootstrap
		// that exchanges the swap token for the session env never runs. Inject that env directly —
		// not just WAVETERM_JWT but WAVETERM_BLOCKID/TABID/etc — so wsh (and hook-driven tools such
		// as the external agent-status reporter, which gates on WAVETERM_BLOCKID) route to THIS
		// wavesrv and resolve the right block.
		blocklogger.Debugf(logCtx, "force-injecting swap-token session env\n")
		shellutil.UpdateCmdEnv(ecmd, cmdOpts.SwapToken.Env)
	}

	/*
	  For Snap installations, we need to correct the XDG environment variables as Snap
	  overrides them to point to snap directories. We will get the correct values, if
	  set, from the PAM environment. If the XDG variables are set in profile or in an
	  RC file, it will be overridden when the shell initializes.
	*/
	if os.Getenv("SNAP") != "" {
		log.Printf("Detected Snap installation, correcting XDG environment variables")
		varsToReplace := map[string]string{"XDG_CONFIG_HOME": "", "XDG_DATA_HOME": "", "XDG_CACHE_HOME": "", "XDG_RUNTIME_DIR": "", "XDG_CONFIG_DIRS": "", "XDG_DATA_DIRS": ""}
		pamEnvs := tryGetPamEnvVars()
		if len(pamEnvs) > 0 {
			// We only want to set the XDG variables from the PAM environment, all others should already be correct or may have been overridden by something else out of our control
			for k := range pamEnvs {
				if _, ok := varsToReplace[k]; ok {
					varsToReplace[k] = pamEnvs[k]
				}
			}
		}
		log.Printf("Setting XDG environment variables to: %v", varsToReplace)
		shellutil.UpdateCmdEnv(ecmd, varsToReplace)
	}

	if cmdOpts.Cwd != "" {
		ecmd.Dir = cmdOpts.Cwd
	}
	if cwdErr := checkCwd(ecmd.Dir); cwdErr != nil {
		ecmd.Dir = wavebase.GetHomeDir()
	}
	envToAdd := shellutil.WaveshellLocalEnvVars(shellutil.DefaultTermType)
	if os.Getenv("LANG") == "" {
		envToAdd["LANG"] = wavebase.DetermineLang()
	}
	shellutil.UpdateCmdEnv(ecmd, envToAdd)
	if cmdOpts.ForceJwt {
		// Agents launch non-interactively (shell -c), skipping the rc integration that adds wsh to
		// PATH; do it here so hook-driven tools can find wsh and report status to the cockpit.
		ensureWshOnPath(ecmd)
	}
	if termSize.Rows == 0 || termSize.Cols == 0 {
		termSize.Rows = shellutil.DefaultTermRows
		termSize.Cols = shellutil.DefaultTermCols
	}
	if termSize.Rows <= 0 || termSize.Cols <= 0 {
		return nil, fmt.Errorf("invalid term size: %v", termSize)
	}
	shellutil.AddTokenSwapEntry(cmdOpts.SwapToken)
	cmdPty, err := pty.StartWithSize(ecmd, &pty.Winsize{Rows: uint16(termSize.Rows), Cols: uint16(termSize.Cols)})
	if err != nil {
		return nil, err
	}
	cmdWrap := MakeCmdWrap(ecmd, cmdPty, isShell, cmdOpts.BlockId)
	return &ShellProc{Cmd: cmdWrap, ConnName: connName, CloseOnce: &sync.Once{}, DoneCh: make(chan any)}, nil
}

const etcEnvironmentPath = "/etc/environment"
const etcSecurityPath = "/etc/security/pam_env.conf"
const userEnvironmentPath = "~/.pam_environment"

var pamParseOpts *pamparse.PamParseOpts = pamparse.ParsePasswdSafe()

/*
tryGetPamEnvVars tries to get the environment variables from /etc/environment,
/etc/security/pam_env.conf, and ~/.pam_environment.

It then returns a map of the environment variables, overriding duplicates with
the following order of precedence:
1. /etc/environment
2. /etc/security/pam_env.conf
3. ~/.pam_environment
*/
func tryGetPamEnvVars() map[string]string {
	envVars, err := pamparse.ParseEnvironmentFile(etcEnvironmentPath)
	if err != nil {
		log.Printf("error parsing %s: %v", etcEnvironmentPath, err)
	}
	envVars2, err := pamparse.ParseEnvironmentConfFile(etcSecurityPath, pamParseOpts)
	if err != nil {
		log.Printf("error parsing %s: %v", etcSecurityPath, err)
	}
	envVars3, err := pamparse.ParseEnvironmentConfFile(wavebase.ExpandHomeDirSafe(userEnvironmentPath), pamParseOpts)
	if err != nil {
		log.Printf("error parsing %s: %v", userEnvironmentPath, err)
	}
	maps.Copy(envVars, envVars2)
	maps.Copy(envVars, envVars3)
	if runtime_dir, ok := envVars["XDG_RUNTIME_DIR"]; !ok || runtime_dir == "" {
		envVars["XDG_RUNTIME_DIR"] = "/run/user/" + fmt.Sprint(os.Getuid())
	}
	if configDirs, ok := envVars["XDG_CONFIG_DIRS"]; !ok || configDirs == "" {
		envVars["XDG_CONFIG_DIRS"] = "/etc/xdg"
	}
	if dataDirs, ok := envVars["XDG_DATA_DIRS"]; !ok || dataDirs == "" {
		envVars["XDG_DATA_DIRS"] = "/usr/local/share:/usr/share"
	}
	return envVars
}
