// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/util/jobobject"
)

var detachCmd = &cobra.Command{
	Use:   "detach [--log <file>] [--] <command> [args...]",
	Short: "start a command that outlives its terminal and arcterm itself",
	Long: `Start a command outside arcterm's process tree, so closing the terminal, quitting or reinstalling arcterm
leaves it running: a dev server, a database, a watcher. A plain command, or one an agent runs in the background,
dies with its terminal.

Its stdin is empty; its stdout and stderr go to a log file, by default under the temp dir's arc-detach folder.
It prints the pid, the log and the command that stops it.`,
	Args: cobra.MinimumNArgs(1),
	RunE: detachRun,
}

var detachLog string

// a command that dies this soon is reported as failed, with its log's tail
const detachSettle = time.Second

func init() {
	detachCmd.Flags().StringVar(&detachLog, "log", "", "log file for stdout and stderr (default: <temp>/arc-detach/<command>-<time>.log)")
	// flags after the command name belong to the command: `wsh detach npm run dev --port 3000`
	detachCmd.Flags().SetInterspersed(false)
	rootCmd.AddCommand(detachCmd)
}

func detachLogPath(name string, now time.Time) string {
	base := strings.TrimSuffix(filepath.Base(name), filepath.Ext(name))
	return filepath.Join(os.TempDir(), "arc-detach", fmt.Sprintf("%s-%s.log", base, now.Format("20060102-150405")))
}

func detachStopHint(pid int) string {
	if runtime.GOOS == "windows" {
		return fmt.Sprintf("taskkill /PID %d /T /F", pid)
	}
	// setsid made it a group leader
	return fmt.Sprintf("kill -- -%d", pid)
}

func detachRun(cmd *cobra.Command, args []string) error {
	logPath := detachLog
	if logPath == "" {
		logPath = detachLogPath(args[0], time.Now())
	}
	if abs, err := filepath.Abs(logPath); err == nil {
		logPath = abs
	}
	if err := os.MkdirAll(filepath.Dir(logPath), 0o755); err != nil {
		return err
	}
	logFile, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return err
	}
	defer logFile.Close()

	child := exec.Command(args[0], args[1:]...)
	child.Stdout = logFile
	child.Stderr = logFile
	if err := jobobject.StartDetached(child); err != nil {
		if errors.Is(err, jobobject.ErrBreakawayDenied) {
			return fmt.Errorf("%w: this terminal's arcterm predates wsh detach (restart it onto a newer build), or another app's job holds it", err)
		}
		return err
	}
	pid := child.Process.Pid
	exited := make(chan error, 1)
	go func() { exited <- child.Wait() }()
	select {
	case err := <-exited:
		if err == nil {
			// e.g. a launcher that hands off to a process of its own
			WriteStdout("%s finished at once (exit 0)\nlog: %s\n", strings.Join(args, " "), logPath)
			return nil
		}
		return fmt.Errorf("%s exited at once (%v); log %s:\n%s", args[0], err, logPath, detachLogTail(logPath, 20))
	case <-time.After(detachSettle):
	}
	WriteStdout("started pid %d: %s\nlog: %s\nstop: %s\n", pid, strings.Join(args, " "), logPath, detachStopHint(pid))
	return nil
}

func detachLogTail(path string, n int) string {
	data, err := os.ReadFile(path)
	if err != nil || len(strings.TrimSpace(string(data))) == 0 {
		return "(empty)"
	}
	lines := strings.Split(strings.TrimRight(string(data), "\r\n"), "\n")
	if len(lines) > n {
		lines = lines[len(lines)-n:]
	}
	return strings.Join(lines, "\n")
}
