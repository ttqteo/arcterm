// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package memhygiene

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const (
	inventoryIndexName = "MEMORY.md"
	inventoryFence     = "---"
)

// ReadInventory reads a memory folder: the index's lines and links, and each topic file's frontmatter,
// body, size and sha256. A missing MEMORY.md is an index that doesn't exist, not an error.
func ReadInventory(folder string) (*Inventory, error) {
	inv := &Inventory{Folder: folder, IndexPath: filepath.Join(folder, inventoryIndexName)}
	entries, err := os.ReadDir(folder)
	if err != nil {
		return nil, fmt.Errorf("reading memory folder %s: %w", folder, err)
	}
	if err := inventoryReadIndex(inv); err != nil {
		return nil, err
	}

	byName := map[string]*Memory{}
	var names []string
	for _, e := range entries {
		name := e.Name()
		if e.IsDir() || !strings.EqualFold(filepath.Ext(name), ".md") || strings.EqualFold(name, inventoryIndexName) {
			continue
		}
		mem, err := inventoryReadMemory(filepath.Join(folder, name))
		if err != nil {
			return nil, err
		}
		byName[name] = mem
		names = append(names, name)
	}

	placed := map[string]bool{}
	deadSeen := map[string]bool{}
	for _, line := range inv.IndexLines {
		for _, link := range IndexLinks(line) {
			name := filepath.ToSlash(filepath.Clean(link))
			mem := byName[name]
			if mem == nil {
				if !deadSeen[name] && !inventoryExists(filepath.Join(folder, filepath.FromSlash(name))) {
					deadSeen[name] = true
					inv.DeadLinks = append(inv.DeadLinks, name)
				}
				continue
			}
			if placed[name] {
				continue
			}
			placed[name] = true
			mem.IndexLine = line
			inv.Memories = append(inv.Memories, *mem)
		}
	}
	sort.Strings(names)
	for _, name := range names {
		if !placed[name] {
			inv.Memories = append(inv.Memories, *byName[name])
		}
	}
	return inv, nil
}

func inventoryReadIndex(inv *Inventory) error {
	if !inventoryExists(inv.IndexPath) {
		return nil
	}
	tf, err := ReadText(inv.IndexPath)
	if err != nil {
		return err
	}
	inv.IndexLines = tf.Lines
	// claude code counts the file as it reads it: every line, and every byte (BOM and CRs included)
	inv.Index = wshrpc.MemIndexStats{Exists: true, Lines: len(tf.Lines), Bytes: len(tf.Bytes())}
	return nil
}

func inventoryReadMemory(path string) (*Memory, error) {
	tf, err := ReadText(path)
	if err != nil {
		return nil, err
	}
	hash, err := HashFile(path)
	if err != nil {
		return nil, err
	}
	fm, bodyLines := inventoryFrontmatter(tf.Lines)
	return &Memory{
		Name:        filepath.Base(path),
		Path:        path,
		Sha256:      hash,
		Size:        len(tf.Bytes()),
		Frontmatter: fm,
		Description: fm["description"],
		Body:        strings.Join(bodyLines, "\n"),
	}, nil
}

// inventoryFrontmatter splits a leading `---` block off the lines and reads its `key: value` pairs.
// a nested key (the harvester writes `metadata:` then `  source: codex`) is read by its own name, but
// never overrides a top-level key of the same name.
func inventoryFrontmatter(lines []string) (map[string]string, []string) {
	fm := map[string]string{}
	if len(lines) == 0 || strings.TrimSpace(lines[0]) != inventoryFence {
		return fm, lines
	}
	end := -1
	for i := 1; i < len(lines); i++ {
		if strings.TrimSpace(lines[i]) == inventoryFence {
			end = i
			break
		}
	}
	if end < 0 {
		return fm, lines
	}
	nested := map[string]string{}
	for _, line := range lines[1:end] {
		key, value, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		k := strings.TrimSpace(key)
		if k == "" || strings.HasPrefix(k, "-") || strings.HasPrefix(k, "#") {
			continue
		}
		v := strings.Trim(strings.TrimSpace(value), `"'`)
		if line[0] == ' ' || line[0] == '\t' {
			if _, seen := nested[k]; !seen {
				nested[k] = v
			}
			continue
		}
		fm[k] = v
	}
	for k, v := range nested {
		if _, ok := fm[k]; !ok {
			fm[k] = v
		}
	}
	return fm, lines[end+1:]
}

func inventoryExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}
