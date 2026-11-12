// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentsessions

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// forkCopyTTL is how long a cut copy stays: claude reads it once, when the fork starts.
const forkCopyTTL = 24 * time.Hour

// ForkResult is the command line that starts a fork and the folder to start it in.
type ForkResult struct {
	Command     string
	ProjectPath string
}

// forkRecord is the part of a transcript line a fork reads.
type forkRecord struct {
	Type string `json:"type"`
	UUID string `json:"uuid"`
	Cwd  string `json:"cwd"`
}

// CutTranscript returns the lines a fork from the record `uuid` keeps: those before it (keep "before", a message of
// yours) or up to and including it (keep "through", a reply). A line prefix keeps the parentUuid chain valid. It fails
// when the record is not in the lines or nothing said is left.
func CutTranscript(lines []string, uuid, keep string) ([]string, error) {
	if keep != "before" && keep != "through" {
		return nil, fmt.Errorf("keep must be before or through, got %q", keep)
	}
	at := -1
	for i, l := range lines {
		if !strings.Contains(l, uuid) {
			continue
		}
		var rec forkRecord
		if json.Unmarshal([]byte(l), &rec) == nil && rec.UUID == uuid {
			at = i
			break
		}
	}
	if at < 0 {
		return nil, fmt.Errorf("that message is no longer in the transcript")
	}
	end := at
	if keep == "through" {
		end = at + 1
	}
	kept := lines[:end]
	for _, l := range kept {
		var rec forkRecord
		if json.Unmarshal([]byte(l), &rec) == nil && (rec.Type == "user" || rec.Type == "assistant") {
			return kept, nil
		}
	}
	return nil, fmt.Errorf("nothing before this message to fork from")
}

// forkCwd is the folder the session ran in: the last record that names one.
func forkCwd(lines []string) string {
	for i := len(lines) - 1; i >= 0; i-- {
		var rec forkRecord
		if json.Unmarshal([]byte(lines[i]), &rec) == nil && rec.Cwd != "" {
			return rec.Cwd
		}
	}
	return ""
}

// quotedPath is a path as one shell word in any shell a tab starts: forward slashes, double quotes.
func quotedPath(p string) string {
	return `"` + filepath.ToSlash(p) + `"`
}

// pruneForkCopies removes the cut copies older than forkCopyTTL.
func pruneForkCopies(dir string, now time.Time) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	for _, e := range entries {
		info, err := e.Info()
		if err == nil && now.Sub(info.ModTime()) > forkCopyTTL {
			os.RemoveAll(filepath.Join(dir, e.Name()))
		}
	}
}

// ForkCommand builds the command line that forks the Claude session at `path`: the whole of it when uuid is "", else
// the part CutTranscript keeps, written to ~/.arc/forks/<random>/<same file name> and resumed from there. The source
// transcript is never written.
func ForkCommand(path, uuid, keep, home string) (ForkResult, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return ForkResult{}, fmt.Errorf("reading the transcript: %w", err)
	}
	lines := strings.Split(strings.TrimRight(string(data), "\r\n"), "\n")
	from := path
	if uuid != "" {
		kept, err := CutTranscript(lines, uuid, keep)
		if err != nil {
			return ForkResult{}, err
		}
		lines = kept
		root := filepath.Join(home, ".arc", "forks")
		pruneForkCopies(root, time.Now())
		var b [8]byte
		if _, err := rand.Read(b[:]); err != nil {
			return ForkResult{}, err
		}
		dir := filepath.Join(root, hex.EncodeToString(b[:]))
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return ForkResult{}, fmt.Errorf("making the fork's copy: %w", err)
		}
		from = filepath.Join(dir, filepath.Base(path))
		if err := os.WriteFile(from, []byte(strings.Join(kept, "\n")+"\n"), 0o644); err != nil {
			return ForkResult{}, fmt.Errorf("writing the fork's copy: %w", err)
		}
	}
	project := forkCwd(lines)
	return ForkResult{
		Command:     claudeResumeCommand(quotedPath(from), project, home) + " --fork-session",
		ProjectPath: project,
	}, nil
}
