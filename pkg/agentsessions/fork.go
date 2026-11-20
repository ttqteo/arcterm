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

// ForkResult is the command line that starts a fork, the folder to start it in and the transcript it resumes.
type ForkResult struct {
	Command     string
	ProjectPath string
	ResumedPath string
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

// isDir reports whether p is a folder on this machine.
func isDir(p string) bool {
	info, err := os.Stat(p)
	return err == nil && info.IsDir()
}

// lastCwd is the last folder a record of lines names that `ok` accepts, and the last one named at all.
func lastCwd(lines []string, ok func(string) bool) (found, named string) {
	for i := len(lines) - 1; i >= 0; i-- {
		if !strings.Contains(lines[i], `"cwd"`) {
			continue
		}
		var rec forkRecord
		if json.Unmarshal([]byte(lines[i]), &rec) != nil || rec.Cwd == "" {
			continue
		}
		if named == "" {
			named = rec.Cwd
		}
		if ok(rec.Cwd) {
			return rec.Cwd, named
		}
	}
	return "", named
}

// forkCwd is the folder a fork starts in: the last folder the kept part ran in that is on this machine, else the last
// such folder in the whole session. A session synced from another machine names that machine's folders
// (/Users/…/thesis on a Mac) for the turns it ran there; a fork cut among them would otherwise start where the tab
// falls back to, the home folder, and claude asks to trust it. It fails when no folder the session names is here.
func forkCwd(kept, all []string, ok func(string) bool) (string, error) {
	if cwd, _ := lastCwd(kept, ok); cwd != "" {
		return cwd, nil
	}
	cwd, named := lastCwd(all, ok)
	if cwd != "" {
		return cwd, nil
	}
	if named == "" {
		return "", fmt.Errorf("the transcript names no folder to start the fork in")
	}
	return "", fmt.Errorf("the folder this session ran in is not on this machine: %s", named)
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
	all := strings.Split(strings.TrimRight(string(data), "\r\n"), "\n")
	kept := all
	if uuid != "" {
		if kept, err = CutTranscript(all, uuid, keep); err != nil {
			return ForkResult{}, err
		}
	}
	project, err := forkCwd(kept, all, isDir)
	if err != nil {
		return ForkResult{}, err
	}
	from := path
	if uuid != "" {
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
	return ForkResult{
		Command:     claudeResumeCommand(quotedPath(from), project, home) + " --fork-session",
		ProjectPath: project,
		ResumedPath: from,
	}, nil
}
