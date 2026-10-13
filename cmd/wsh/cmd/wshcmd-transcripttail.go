// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/google/uuid"
	"github.com/spf13/cobra"
)

// the Claude mod's file read rejects a file over 4 MiB and its process output keeps only the first 4 MiB,
// so a long session's transcript reaches the mod through this, cut to its end
const modTranscriptTailBytes = 3 << 20

var transcriptTailCmd = &cobra.Command{
	Use:                   "transcript-tail <session-id>",
	Short:                 "print the whole lines in the last 3 MiB of a claude session's transcript (the Claude mod)",
	Args:                  cobra.ExactArgs(1),
	RunE:                  transcriptTailRun,
	Hidden:                true,
	DisableFlagsInUseLine: true,
}

func init() {
	rootCmd.AddCommand(transcriptTailCmd)
}

func transcriptTailRun(cmd *cobra.Command, args []string) error {
	path, err := claudeTranscriptPath(args[0])
	if err != nil {
		return err
	}
	lines, err := readTailLines(path, modTranscriptTailBytes)
	if err != nil {
		return fmt.Errorf("reading the transcript: %w", err)
	}
	if _, err := io.WriteString(os.Stdout, strings.Join(lines, "\n")); err != nil {
		return fmt.Errorf("writing the transcript: %w", err)
	}
	return nil
}

// claudeTranscriptPath finds a claude session's transcript, <config dir>/projects/<project>/<id>.jsonl. the mod
// is not told the path: Claude Code withholds the hook events that carry it from a plugin the user installed
func claudeTranscriptPath(sessionID string) (string, error) {
	// a parsed id holds no separator or glob character
	if _, err := uuid.Parse(sessionID); err != nil {
		return "", fmt.Errorf("session id %q: %w", sessionID, err)
	}
	configDir := os.Getenv("CLAUDE_CONFIG_DIR")
	if configDir == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", fmt.Errorf("resolving home dir: %w", err)
		}
		configDir = filepath.Join(home, ".claude")
	}
	matches, err := filepath.Glob(filepath.Join(configDir, "projects", "*", sessionID+".jsonl"))
	if err != nil {
		return "", fmt.Errorf("finding the transcript: %w", err)
	}
	if len(matches) == 0 {
		return "", fmt.Errorf("no transcript for session %s under %s", sessionID, configDir)
	}
	return matches[0], nil
}
