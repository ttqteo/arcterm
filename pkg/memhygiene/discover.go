// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package memhygiene

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/agentobserve"
	"github.com/wavetermdev/waveterm/pkg/memroots"
)

const discoverMemoryDirName = "memory"

// Discover resolves each registered project (name -> path) to the memory folder its Claude Code
// sessions load, the projects it shares that folder with, and its transcript dirs.
// claudeHome is ~/.claude; tests pass a temp dir.
func Discover(registry map[string]string, claudeHome string) []Resolved {
	projectsDir := filepath.Join(claudeHome, "projects")
	dirNames := discoverDirNames(projectsDir)
	out := make([]Resolved, 0, len(registry))
	for project, path := range registry {
		out = append(out, discoverOne(project, filepath.Clean(path), claudeHome, projectsDir, dirNames))
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Project < out[j].Project })
	discoverMarkShared(out, claudeHome)
	return out
}

// OwnFolderFor is the folder a sharing project splits into: the old harvester's ProjectHash folder
// when it exists, since it already holds the project's leftovers, else the SlugifyCwd folder.
func OwnFolderFor(path, claudeHome string) string {
	path = filepath.Clean(path)
	hashFolder := filepath.Join(claudeHome, "projects", memroots.ProjectHash(path), discoverMemoryDirName)
	if discoverIsDir(hashFolder) {
		return hashFolder
	}
	return filepath.Join(claudeHome, "projects", agentobserve.SlugifyCwd(path), discoverMemoryDirName)
}

func discoverOne(project, path, claudeHome, projectsDir string, dirNames []string) Resolved {
	r := Resolved{Project: project, Path: path}
	if !discoverIsDir(path) {
		r.Skip = fmt.Sprintf("path missing: %s", path)
		return r
	}
	r.TranscriptDirs = discoverTranscriptDirs(path, projectsDir, dirNames)
	toplevel, err := discoverToplevel(path)
	if err != nil {
		r.Skip = err.Error()
		return r
	}
	r.Toplevel = toplevel
	folder, err := discoverAutoMemoryDirectory(path, claudeHome)
	if err != nil {
		r.Skip = err.Error()
		return r
	}
	if folder == "" {
		folder = discoverSlugFolder(projectsDir, dirNames, agentobserve.SlugifyCwd(toplevel))
	}
	r.Folder = folder
	if !discoverIsDir(folder) {
		r.Skip = fmt.Sprintf("no memory folder: %s", folder)
	}
	return r
}

// discoverToplevel is the path's git toplevel, or the path itself when it's not in a repo.
func discoverToplevel(path string) (string, error) {
	out, err := runGit(path, "rev-parse", "--show-toplevel")
	if err == nil {
		return filepath.Clean(filepath.FromSlash(out)), nil
	}
	if strings.Contains(err.Error(), "not a git repository") {
		return path, nil
	}
	return "", fmt.Errorf("git toplevel of %s: %w", path, err)
}

// discoverAutoMemoryDirectory returns the autoMemoryDirectory of the first settings scope that
// sets it (local, then project, then user), or "" when none does.
func discoverAutoMemoryDirectory(path, claudeHome string) (string, error) {
	for _, file := range []string{
		filepath.Join(path, ".claude", "settings.local.json"),
		filepath.Join(path, ".claude", "settings.json"),
		filepath.Join(claudeHome, "settings.json"),
	} {
		value, err := discoverSettingsValue(file)
		if err != nil {
			return "", err
		}
		if value != "" {
			return discoverExpandPath(value, path, claudeHome), nil
		}
	}
	return "", nil
}

func discoverSettingsValue(file string) (string, error) {
	data, err := os.ReadFile(file)
	if errors.Is(err, os.ErrNotExist) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("read settings %s: %w", file, err)
	}
	var settings struct {
		AutoMemoryDirectory string `json:"autoMemoryDirectory"`
	}
	if err := json.Unmarshal(bytes.TrimPrefix(data, utf8BOM), &settings); err != nil {
		return "", fmt.Errorf("parse settings %s: %w", file, err)
	}
	return settings.AutoMemoryDirectory, nil
}

// discoverExpandPath expands a leading ~ to the home that holds claudeHome and resolves a
// relative value against the launch folder.
func discoverExpandPath(value, path, claudeHome string) string {
	if value == "~" || strings.HasPrefix(value, "~/") || strings.HasPrefix(value, `~\`) {
		return filepath.Join(filepath.Dir(claudeHome), value[1:])
	}
	if !filepath.IsAbs(value) {
		return filepath.Join(path, value)
	}
	return filepath.Clean(value)
}

// discoverSlugFolder finds the slug's memory folder, matching the dir name case-insensitively since
// the drive letter's case follows how the session's cwd was spelled. It returns the on-disk name,
// and an exact match wins where the filesystem lets both spellings exist.
func discoverSlugFolder(projectsDir string, dirNames []string, slug string) string {
	found := ""
	for _, name := range dirNames {
		folder := filepath.Join(projectsDir, name, discoverMemoryDirName)
		if !strings.EqualFold(name, slug) || !discoverIsDir(folder) {
			continue
		}
		if name == slug {
			return folder
		}
		if found == "" {
			found = folder
		}
	}
	if found != "" {
		return found
	}
	return filepath.Join(projectsDir, slug, discoverMemoryDirName)
}

// discoverTranscriptDirs are the launch folder's own dir and its worktrees' (slug + "--..."),
// minus the backend's headless passes.
func discoverTranscriptDirs(path, projectsDir string, dirNames []string) []string {
	slug := strings.ToLower(agentobserve.SlugifyCwd(path))
	headless := strings.ToLower(agentobserve.HeadlessAgentSlug())
	var out []string
	for _, name := range dirNames {
		lower := strings.ToLower(name)
		if headless != "" && lower == headless {
			continue
		}
		if lower == slug || strings.HasPrefix(lower, slug+"--") {
			out = append(out, filepath.Join(projectsDir, name))
		}
	}
	return out
}

// discoverMarkShared fills SharedWith and OwnFolder for every project whose folder another
// project also loads.
func discoverMarkShared(out []Resolved, claudeHome string) {
	byFolder := map[string][]int{}
	for i, r := range out {
		if r.Skip == "" {
			key := strings.ToLower(filepath.Clean(r.Folder))
			byFolder[key] = append(byFolder[key], i)
		}
	}
	for _, idxs := range byFolder {
		if len(idxs) < 2 {
			continue
		}
		for _, i := range idxs {
			for _, j := range idxs {
				if j != i {
					out[i].SharedWith = append(out[i].SharedWith, out[j].Project)
				}
			}
			out[i].OwnFolder = OwnFolderFor(out[i].Path, claudeHome)
		}
	}
}

// discoverDirNames lists the dirs under ~/.claude/projects; none when it doesn't exist yet.
func discoverDirNames(projectsDir string) []string {
	entries, err := os.ReadDir(projectsDir)
	if err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			log.Printf("memhygiene: list %s: %v\n", projectsDir, err)
		}
		return nil
	}
	var names []string
	for _, e := range entries {
		if e.IsDir() {
			names = append(names, e.Name())
		}
	}
	return names
}

func discoverIsDir(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}
