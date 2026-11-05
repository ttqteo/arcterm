// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package memhygiene

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const (
	reviewKind = "review"
	// the arc mod's session-start memory lint flags a memory at the same age (STALE_DAYS in
	// claude/arc-mod/hooks/memlint-core.ts), and Still true resets both
	reviewStaleDays = 30
	reviewDateFmt   = "2006-01-02"
)

// a frontmatter `modified: 2026-07-01` line, which the lint reads before the file's mtime
var reviewModifiedRe = regexp.MustCompile(`^(\s*modified:\s*["']?)(\d{4}-\d{2}-\d{2})`)

// reviewTouched is when a memory was last touched: its frontmatter `modified:` date, else the file's
// mtime, the same reading as the session-start lint.
func reviewTouched(path string, fm map[string]string) (int64, error) {
	if v := fm["modified"]; len(v) >= len(reviewDateFmt) {
		if t, err := time.ParseInLocation(reviewDateFmt, v[:len(reviewDateFmt)], time.Local); err == nil {
			return t.UnixMilli(), nil
		}
	}
	info, err := os.Stat(path)
	if err != nil {
		return 0, fmt.Errorf("reading %s: %w", path, err)
	}
	return info.ModTime().UnixMilli(), nil
}

// ReviewChanges proposes a Review, built in code with no model, for each memory untouched for 30
// days or more and, when the judge didn't run, for each memory with a warning in its evidence. A
// memory another change already acts on gets none. A review never edits the memory: Still true only
// marks it touched today.
func ReviewChanges(inv *Inventory, others []wshrpc.MemChange, judged bool, now time.Time) []wshrpc.MemChange {
	taken := map[string]bool{}
	for _, c := range others {
		if c.Kind == reviewKind || !Pending(c) || !checkSameFolder(c.Op.Folder, inv.Folder) {
			continue
		}
		for _, name := range c.Op.Memories {
			taken[strings.ToLower(name)] = true
		}
	}
	var out []wshrpc.MemChange
	for _, m := range inv.Memories {
		if taken[strings.ToLower(m.Name)] {
			continue
		}
		days := 0
		if m.Touched > 0 {
			days = int(now.Sub(time.UnixMilli(m.Touched)).Hours() / 24)
		}
		stale := days >= reviewStaleDays
		var warns []wshrpc.MemEvidence
		for _, ev := range m.Evidence {
			if ev.Tone == evidenceToneWarn {
				warns = append(warns, ev)
			}
		}
		if !stale && (judged || len(warns) == 0) {
			continue
		}
		out = append(out, reviewChange(inv, m, days, stale, now))
	}
	return out
}

func reviewChange(inv *Inventory, m Memory, days int, stale bool, now time.Time) wshrpc.MemChange {
	files := []wshrpc.MemFileRef{{Path: m.Path, Sha256: m.Sha256}}
	var evidence []wshrpc.MemEvidence
	effect := ""
	if stale {
		evidence = append(evidence, wshrpc.MemEvidence{
			Tone: evidenceToneWarn, Text: fmt.Sprintf("Untouched for %d days, since ", days),
			Code: time.UnixMilli(m.Touched).Format(reviewDateFmt),
		})
		effect = fmt.Sprintf("untouched %d days", days)
	}
	evidence = append(evidence, m.Evidence...)
	if !stale {
		n := 0
		for _, ev := range m.Evidence {
			if ev.Tone == evidenceToneWarn {
				n++
			}
		}
		effect = fmt.Sprintf("%d %s", n, map[bool]string{true: "finding", false: "findings"}[n == 1])
	}
	title := m.Description
	if title == "" {
		title = strings.TrimSuffix(m.Name, filepath.Ext(m.Name))
	}
	c := wshrpc.MemChange{
		Id:         ChangeID(reviewKind, files),
		Kind:       reviewKind,
		Title:      title,
		Note:       "Is it still true, and still needed? Still true marks it reviewed today and changes nothing else, so it isn't flagged again for " + fmt.Sprint(reviewStaleDays) + " days. To delete or trim it, edit the file or ask an agent.",
		ApplyLabel: "Still true",
		Effect:     effect,
		Files:      files,
		Evidence:   evidence,
		Op:         wshrpc.MemOp{Folder: inv.Folder, Memories: []string{m.Name}},
		Status:     splitStatusOpen,
	}
	if line, ok := reviewModifiedLine(m.Path); ok {
		c.Diffs = []wshrpc.MemDiff{{
			Path: m.Path, Note: "frontmatter date",
			Lines: []wshrpc.MemDiffLine{
				{Sign: "-", Text: line},
				{Sign: "+", Text: reviewModifiedRe.ReplaceAllString(line, "${1}"+now.Format(reviewDateFmt))},
			},
		}}
	}
	return c
}

// reviewModifiedLine is the memory's frontmatter `modified:` line, if it has one.
func reviewModifiedLine(path string) (string, bool) {
	tf, err := ReadText(path)
	if err != nil {
		return "", false
	}
	fm := reviewFrontmatterEnd(tf.Lines)
	for _, line := range tf.Lines[:fm] {
		if reviewModifiedRe.MatchString(line) {
			return line, true
		}
	}
	return "", false
}

// reviewFrontmatterEnd is the index of the frontmatter's closing fence, or 0 with no frontmatter.
func reviewFrontmatterEnd(lines []string) int {
	if len(lines) == 0 || strings.TrimSpace(lines[0]) != inventoryFence {
		return 0
	}
	if i := slices.IndexFunc(lines[1:], func(l string) bool { return strings.TrimSpace(l) == inventoryFence }); i >= 0 {
		return i + 1
	}
	return 0
}

// applyReview marks each memory touched today: it moves a frontmatter `modified:` date to today, and
// otherwise rewrites the same bytes, which moves the file's mtime.
func applyReview(p *applyPlan, op wshrpc.MemOp, now time.Time) error {
	for _, name := range op.Memories {
		path := filepath.Join(op.Folder, name)
		tf, err := ReadText(path)
		if err != nil {
			return err
		}
		dated := false
		for i := 0; i < reviewFrontmatterEnd(tf.Lines); i++ {
			if reviewModifiedRe.MatchString(tf.Lines[i]) {
				tf.Lines[i] = reviewModifiedRe.ReplaceAllString(tf.Lines[i], "${1}"+now.Format(reviewDateFmt))
				dated = true
				break
			}
		}
		if dated {
			p.put(path, tf.Bytes())
			continue
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return fmt.Errorf("reading %s: %w", path, err)
		}
		p.put(path, data)
	}
	return nil
}
