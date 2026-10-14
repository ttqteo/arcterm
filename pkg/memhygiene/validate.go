// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package memhygiene

import (
	"fmt"
	"log"
	"path/filepath"
	"slices"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// Validate drops every change that can't be applied as proposed, and logs why. invs is keyed by
// folder, docs by instruction doc path (as InstructionDocs gives them). A kept move-to-doc change
// carries the doc's exact heading line in Op.DocSection, so apply matches it byte for byte.
func Validate(changes []wshrpc.MemChange, invs map[string]*Inventory, docs map[string]string) (kept []wshrpc.MemChange, dropped []string) {
	for _, c := range changes {
		reason := validateChange(&c, invs, docs)
		if reason == "" {
			kept = append(kept, c)
			continue
		}
		msg := fmt.Sprintf("dropped %s %q (%s): %s", c.Kind, c.Title, validateShortID(c.Id), reason)
		log.Printf("[memhygiene] %s\n", msg)
		dropped = append(dropped, msg)
	}
	return kept, dropped
}

// validateChange returns why c can't be applied, or "" when it can.
func validateChange(c *wshrpc.MemChange, invs map[string]*Inventory, docs map[string]string) string {
	op := &c.Op
	inv := invs[op.Folder]
	if len(op.Memories) > 0 && inv == nil {
		return fmt.Sprintf("its folder %s wasn't read", op.Folder)
	}
	for _, name := range op.Memories {
		if validateMemory(inv, name) == nil {
			return fmt.Sprintf("names %s, which isn't in %s", name, op.Folder)
		}
	}
	switch c.Kind {
	case judgeKindDelete, judgeKindTrim, judgeKindMoveToDoc, judgeKindAddToIndex:
		if len(op.Memories) != 1 {
			return fmt.Sprintf("a %s acts on one memory, and this names %d", c.Kind, len(op.Memories))
		}
	case judgeKindMerge:
		if len(op.Memories) < 2 {
			return fmt.Sprintf("a merge needs two or more files, and this names %d", len(op.Memories))
		}
		if reason := validateMergeTarget(inv, op); reason != "" {
			return reason
		}
	}
	switch c.Kind {
	case judgeKindTrim:
		if reason := validateTrim(validateMemory(inv, op.Memories[0]), op.Old); reason != "" {
			return reason
		}
	case judgeKindMoveToDoc:
		if reason := validateSection(op, docs); reason != "" {
			return reason
		}
	case judgeKindMerge, judgeKindAddToIndex:
		if op.IndexAdd == "" {
			return "it writes no index line"
		}
	}
	if strings.ContainsAny(op.IndexAdd, "\r\n") {
		return "the index line it writes is more than one line"
	}
	return validateNotLinked(op, invs)
}

func validateMemory(inv *Inventory, name string) *Memory {
	if inv == nil {
		return nil
	}
	for i := range inv.Memories {
		if inv.Memories[i].Name == name {
			return &inv.Memories[i]
		}
	}
	return nil
}

// validateMergeTarget refuses a merge that writes outside the folder, or over a memory it doesn't merge.
func validateMergeTarget(inv *Inventory, op *wshrpc.MemOp) string {
	name := op.WriteName
	if name != filepath.Base(name) || name == ".." || !strings.EqualFold(filepath.Ext(name), ".md") || strings.EqualFold(name, judgeIndexName) {
		return fmt.Sprintf("it writes %q, which isn't a memory file name", name)
	}
	if validateMemory(inv, name) != nil && !slices.Contains(op.Memories, name) {
		return fmt.Sprintf("it writes %s, a memory it doesn't merge", name)
	}
	return ""
}

// validateTrim counts the passage in the file as ReadText gives it, line endings read as "\n".
func validateTrim(m *Memory, old string) string {
	if old == "" {
		return "its old passage is empty"
	}
	tf, err := ReadText(m.Path)
	if err != nil {
		return err.Error()
	}
	if n := strings.Count(strings.Join(tf.Lines, "\n"), old); n != 1 {
		return fmt.Sprintf("its old passage appears %d times in %s, not once", n, m.Name)
	}
	return ""
}

// validateSection finds the heading the passage goes under; it must appear once in the doc.
func validateSection(op *wshrpc.MemOp, docs map[string]string) string {
	if strings.TrimSpace(op.DocPassage) == "" {
		return "its passage is empty"
	}
	want := validateHeadingText(op.DocSection)
	var found []string
	for _, line := range strings.Split(docs[op.DocPath], "\n") {
		line = strings.TrimRight(line, "\r")
		if strings.HasPrefix(line, "#") && want != "" && validateHeadingText(line) == want {
			found = append(found, line)
		}
	}
	if len(found) != 1 {
		return fmt.Sprintf("the section %q appears %d times in %s, not once", op.DocSection, len(found), op.DocPath)
	}
	op.DocSection = found[0]
	return ""
}

// validateHeadingText is a heading without its leading #s, so "## Design docs" and "Design docs" match.
func validateHeadingText(s string) string {
	return strings.TrimSpace(strings.TrimLeft(strings.TrimSpace(s), "#"))
}

// validateNotLinked refuses an index line that links a file another index line already links.
func validateNotLinked(op *wshrpc.MemOp, invs map[string]*Inventory) string {
	if op.IndexAdd == "" {
		return ""
	}
	folder := op.IndexFolder
	if folder == "" {
		folder = op.Folder
	}
	inv := invs[folder]
	if inv == nil {
		return fmt.Sprintf("its index folder %s wasn't read", folder)
	}
	for _, line := range inv.IndexLines {
		if slices.Contains(op.IndexRemove, line) {
			continue
		}
		for _, linked := range IndexLinks(line) {
			for _, added := range IndexLinks(op.IndexAdd) {
				if strings.EqualFold(linked, added) {
					return fmt.Sprintf("it adds an index line for %s, which the index already links", added)
				}
			}
		}
	}
	return ""
}

func validateShortID(id string) string {
	if len(id) > 12 {
		return id[:12]
	}
	return id
}
