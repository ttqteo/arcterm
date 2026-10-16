// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package memhygiene

import (
	"encoding/json"
	"fmt"
	"log"
	"path/filepath"
	"slices"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const (
	splitKindMove     = "move-here"
	splitKindCopy     = "copy-here"
	splitKindRemove   = "remove-shared"
	splitKindSettings = "settings"

	splitGroupShared = "shared"
	splitGroupSwitch = "switch"

	splitStatusOpen     = "open"
	splitStatusConflict = "conflict"

	// the sort's name for an unregistered part of the repo
	splitSortOther = "other"
)

// splitGroup is the memories one index line links (or one unlinked memory): they move together, so
// the line is never left pointing at a file that's gone.
type splitGroup struct {
	IndexLine string
	Memories  []Memory
	Projects  []string // the union of the members' sorts
}

// SplitChanges turns the model's sort of a shared folder into a sharing project's changes: move or
// copy each memory that applies to it into its own folder, then one settings change to switch over.
// The own folder's leftovers get ordinary judge changes elsewhere.
func SplitChanges(project string, shared, own *Inventory, sort map[string][]string, ownFolder, settingsPath string) []wshrpc.MemChange {
	var out []wshrpc.MemChange
	for _, g := range splitGroups(shared, sort) {
		if !slices.Contains(g.Projects, project) || splitAlreadyThere(g, own) {
			continue
		}
		others := splitWithout(g.Projects, project)
		c, err := splitMoveOrCopy(project, shared.Folder, ownFolder, g, others)
		if err != nil {
			log.Printf("memhygiene: split of %s: %v\n", project, err)
			continue
		}
		out = append(out, c)
	}
	c, err := splitSettingsChange(project, ownFolder, settingsPath)
	if err != nil {
		log.Printf("memhygiene: split of %s: %v\n", project, err)
		return out
	}
	return append(out, c)
}

// RemoveShared gives remove-shared for each shared memory every project it applies to has switched
// away from. It's listed only under the last of those projects to switch, so it appears once.
func RemoveShared(project string, shared *Inventory, sort map[string][]string, stillLoading []string, switchedAt map[string]int64) []wshrpc.MemChange {
	var out []wshrpc.MemChange
	for _, g := range splitGroups(shared, sort) {
		if slices.Contains(g.Projects, splitSortOther) || splitAnyIn(g.Projects, stillLoading) {
			continue
		}
		if splitLastSwitched(g.Projects, switchedAt) != project {
			continue
		}
		c, err := splitRemoveChange(shared.Folder, g)
		if err != nil {
			log.Printf("memhygiene: remove-shared for %s: %v\n", project, err)
			continue
		}
		out = append(out, c)
	}
	return out
}

// Pending: the change is still to review, open or changed on disk since the check. memorymodel.ts
// isPending mirrors it.
func Pending(c wshrpc.MemChange) bool {
	return c.Status == "" || c.Status == splitStatusOpen || c.Status == splitStatusConflict
}

// OpenSharedChanges counts the shared-memory changes still to review. Switching over while it's
// above 0 would drop those memories from the project's sessions.
func OpenSharedChanges(changes []wshrpc.MemChange) int {
	n := 0
	for _, c := range changes {
		if c.Group == splitGroupShared && Pending(c) {
			n++
		}
	}
	return n
}

// splitGroups groups the shared memories by index line, in index order. A group with a member the
// sort lacks is left out: moving its line would leave that member behind.
func splitGroups(shared *Inventory, sorted map[string][]string) []splitGroup {
	var all []splitGroup
	unsorted := map[int]bool{}
	byLine := map[string]int{}
	for _, m := range shared.Memories {
		i, seen := byLine[m.IndexLine]
		if !seen {
			all = append(all, splitGroup{IndexLine: m.IndexLine})
			i = len(all) - 1
			if m.IndexLine != "" {
				byLine[m.IndexLine] = i
			}
		}
		g := &all[i]
		g.Memories = append(g.Memories, m)
		projects, ok := sorted[m.Name]
		if !ok {
			unsorted[i] = true
		}
		for _, p := range projects {
			if !slices.Contains(g.Projects, p) {
				g.Projects = append(g.Projects, p)
			}
		}
	}
	var out []splitGroup
	for i, g := range all {
		if !unsorted[i] {
			out = append(out, g)
		}
	}
	return out
}

func splitMoveOrCopy(project, sharedFolder, ownFolder string, g splitGroup, others []string) (wshrpc.MemChange, error) {
	files, err := splitSourceRefs(g)
	if err != nil {
		return wshrpc.MemChange{}, err
	}
	for _, m := range g.Memories {
		// "" hash: the copy must not exist yet, so apply never overwrites one already in the own folder
		files = append(files, wshrpc.MemFileRef{Path: filepath.Join(ownFolder, m.Name)})
	}
	kind, label := splitKindMove, "Move here"
	evidence := []wshrpc.MemEvidence{{Tone: "none", Text: "Applies only to " + project}}
	if len(others) > 0 {
		kind, label = splitKindCopy, "Copy here"
		evidence = []wshrpc.MemEvidence{{Tone: "none", Text: "Also applies to " + strings.Join(others, ", ") + ", so the shared copy stays"}}
	}
	if len(g.Memories) > 1 {
		evidence = append(evidence, wshrpc.MemEvidence{Tone: "none", Text: fmt.Sprintf("Its index line links %d files, so they move together", len(g.Memories))})
	}
	c := wshrpc.MemChange{
		Id:         ChangeID(kind, files),
		Kind:       kind,
		Group:      splitGroupShared,
		Title:      splitTitle(g),
		ApplyLabel: label,
		Effect:     splitEffect(g),
		Files:      files,
		Evidence:   append(evidence, splitMemberEvidence(g)...),
		Op: wshrpc.MemOp{
			Folder:      sharedFolder,
			Memories:    splitNames(g),
			ToFolder:    ownFolder,
			IndexAdd:    g.IndexLine,
			IndexFolder: ownFolder,
		},
		Status: splitStatusOpen,
	}
	if g.IndexLine == "" {
		c.Note = "The index doesn't link it, so it stays unlinked in " + project + "'s folder too."
		return c, nil
	}
	c.Diffs = append(c.Diffs, wshrpc.MemDiff{
		Path: filepath.Join(ownFolder, "MEMORY.md"), Note: "+1 line",
		Lines: []wshrpc.MemDiffLine{{Sign: "+", Text: g.IndexLine}},
	})
	c.OwnIndexDelta = splitLineDelta(g.IndexLine, 1)
	if kind == splitKindMove {
		c.Op.IndexRemove = []string{g.IndexLine}
		c.IndexDelta = splitLineDelta(g.IndexLine, -1)
		c.Diffs = append([]wshrpc.MemDiff{{
			Path: filepath.Join(sharedFolder, "MEMORY.md"), Note: "−1 line",
			Lines: []wshrpc.MemDiffLine{{Sign: "-", Text: g.IndexLine}},
		}}, c.Diffs...)
	} else {
		c.Note = "Once every project that needs it has a copy, a later check offers to delete it from the shared memory."
	}
	return c, nil
}

func splitRemoveChange(sharedFolder string, g splitGroup) (wshrpc.MemChange, error) {
	files, err := splitSourceRefs(g)
	if err != nil {
		return wshrpc.MemChange{}, err
	}
	c := wshrpc.MemChange{
		Id:         ChangeID(splitKindRemove, files),
		Kind:       splitKindRemove,
		Group:      splitGroupShared,
		Title:      splitTitle(g),
		ApplyLabel: "Remove from shared memory",
		Effect:     splitEffect(g),
		Files:      files,
		Evidence: append([]wshrpc.MemEvidence{{
			Tone: "ok", Text: "Every project it applies to now loads its own memory: " + strings.Join(g.Projects, ", "),
		}}, splitMemberEvidence(g)...),
		Op:     wshrpc.MemOp{Folder: sharedFolder, Memories: splitNames(g)},
		Status: splitStatusOpen,
	}
	if g.IndexLine != "" {
		c.Op.IndexRemove = []string{g.IndexLine}
		c.IndexDelta = splitLineDelta(g.IndexLine, -1)
		c.Diffs = []wshrpc.MemDiff{{
			Path: filepath.Join(sharedFolder, "MEMORY.md"), Note: "−1 line",
			Lines: []wshrpc.MemDiffLine{{Sign: "-", Text: g.IndexLine}},
		}}
	}
	return c, nil
}

func splitSettingsChange(project, ownFolder, settingsPath string) (wshrpc.MemChange, error) {
	hash, err := HashFile(settingsPath)
	if err != nil {
		return wshrpc.MemChange{}, err
	}
	value, err := json.Marshal(ownFolder)
	if err != nil {
		return wshrpc.MemChange{}, fmt.Errorf("encoding %s: %w", ownFolder, err)
	}
	files := []wshrpc.MemFileRef{{Path: settingsPath, Sha256: hash}}
	return wshrpc.MemChange{
		Id:         ChangeID(splitKindSettings, files),
		Kind:       splitKindSettings,
		Group:      splitGroupSwitch,
		Title:      "Point Claude Code at " + project + "’s memory",
		Note:       "Sessions started in " + project + " after this load its own memory. Running sessions keep the shared memory until they restart.",
		ApplyLabel: "Switch memory",
		Effect:     "1 setting",
		Files:      files,
		Evidence: []wshrpc.MemEvidence{
			{Tone: "none", Text: "Every other setting in the file stays as it is"},
			{Tone: "none", Text: "Sessions started at the repo root keep the shared memory"},
		},
		Diffs: []wshrpc.MemDiff{{
			Path: settingsPath, Note: "+1 key",
			Lines: []wshrpc.MemDiffLine{{Sign: "+", Text: `  "autoMemoryDirectory": ` + string(value) + ","}},
		}},
		Op:     wshrpc.MemOp{SettingsPath: settingsPath, SettingsValue: ownFolder},
		Status: splitStatusOpen,
	}, nil
}

func splitSourceRefs(g splitGroup) ([]wshrpc.MemFileRef, error) {
	var refs []wshrpc.MemFileRef
	for _, m := range g.Memories {
		hash, err := HashFile(m.Path)
		if err != nil {
			return nil, err
		}
		refs = append(refs, wshrpc.MemFileRef{Path: m.Path, Sha256: hash})
	}
	return refs, nil
}

// splitAlreadyThere: every member is already in the own folder with the same content.
func splitAlreadyThere(g splitGroup, own *Inventory) bool {
	if own == nil {
		return false
	}
	have := map[string]string{}
	for _, m := range own.Memories {
		have[m.Name] = m.Sha256
	}
	for _, m := range g.Memories {
		if sha, ok := have[m.Name]; !ok || sha != m.Sha256 {
			return false
		}
	}
	return true
}

// splitLastSwitched is the project among projects that switched last; "" when none did. Ties go to
// the later name so the choice is stable.
func splitLastSwitched(projects []string, switchedAt map[string]int64) string {
	sorted := append([]string(nil), projects...)
	slices.Sort(sorted)
	last, lastAt := "", int64(0)
	for _, p := range sorted {
		if at := switchedAt[p]; at > 0 && at >= lastAt {
			last, lastAt = p, at
		}
	}
	return last
}

func splitTitle(g splitGroup) string {
	first := g.Memories[0]
	title := first.Description
	if title == "" {
		title = first.Name
	}
	if n := len(g.Memories) - 1; n > 0 {
		title = fmt.Sprintf("%s, and %d more on its index line", title, n)
	}
	return title
}

func splitEffect(g splitGroup) string {
	size := 0
	for _, m := range g.Memories {
		size += m.Size
	}
	unit := "files"
	if len(g.Memories) == 1 {
		unit = "file"
	}
	return fmt.Sprintf("%d %s · %s", len(g.Memories), unit, splitFormatSize(size))
}

func splitFormatSize(n int) string {
	switch {
	case n < 1000:
		return fmt.Sprintf("%d B", n)
	case n < 10000:
		return fmt.Sprintf("%.1f KB", float64(n)/1000)
	default:
		return fmt.Sprintf("%d KB", (n+500)/1000)
	}
}

func splitMemberEvidence(g splitGroup) []wshrpc.MemEvidence {
	var out []wshrpc.MemEvidence
	for _, m := range g.Memories {
		out = append(out, m.Evidence...)
	}
	return out
}

func splitNames(g splitGroup) []string {
	names := make([]string, len(g.Memories))
	for i, m := range g.Memories {
		names[i] = m.Name
	}
	return names
}

// splitLineDelta is one index line's effect on MEMORY.md, its newline included.
func splitLineDelta(line string, sign int) wshrpc.MemIndexDelta {
	return wshrpc.MemIndexDelta{Lines: sign, Bytes: sign * (len(line) + 1)}
}

func splitAnyIn(list, set []string) bool {
	return slices.ContainsFunc(list, func(v string) bool { return slices.Contains(set, v) })
}

func splitWithout(list []string, s string) []string {
	var out []string
	for _, v := range list {
		if v != s {
			out = append(out, v)
		}
	}
	return out
}
