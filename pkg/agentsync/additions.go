// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentsync

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

const (
	additionsFile = "additions.md"
	// MaxAdditions caps the lines one skill holds, so a skill the user keeps correcting stays readable.
	MaxAdditions  = 20
	additionsHead = "\n## Your additions\n<!-- arc:user -->\nThese are the user's own rules; where they conflict with the text above, they win.\n\n"
)

var (
	ErrNoSkill       = errors.New("no such skill in the vault")
	ErrAdditionsFull = fmt.Errorf("this skill already has %d additions; remove one first", MaxAdditions)
	additionLine     = regexp.MustCompile(`^- (.+) <!-- arc:learn key=([a-z0-9-]+) learned=(\d{4}-\d{2}-\d{2}) count=(\d+) -->$`)
	learnedDate      = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
	additionKey      = regexp.MustCompile(`^[a-z0-9-]+$`)
)

// Addition is one line the user accepted into a skill. It lives in <skill>/.arc/additions.md, so the
// shipped-skill seed, which keeps .arc/, never overwrites it.
type Addition struct {
	Key     string `json:"key"`
	Text    string `json:"text"`
	Learned string `json:"learned"`
	Count   int    `json:"count"`
}

func additionsPath(skillsRoot, name string) string {
	return filepath.Join(skillsRoot, name, deltaDirName, additionsFile)
}

// ReadAdditions lists a skill's additions in file order. A skill with no additions.md has none; a line
// that is not an addition is skipped.
func ReadAdditions(skillsRoot, name string) ([]Addition, error) {
	data, err := os.ReadFile(additionsPath(skillsRoot, name))
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("reading the additions of %s: %w", name, err)
	}
	var out []Addition
	for _, line := range strings.Split(string(data), "\n") {
		m := additionLine.FindStringSubmatch(strings.TrimRight(line, "\r"))
		if m == nil {
			continue
		}
		count, err := strconv.Atoi(m[4])
		if err != nil {
			continue
		}
		out = append(out, Addition{Key: m[2], Text: m[1], Learned: m[3], Count: count})
	}
	return out, nil
}

// writeAdditions replaces additions.md with list; an empty list removes the file.
func writeAdditions(skillsRoot, name string, list []Addition) error {
	path := additionsPath(skillsRoot, name)
	if len(list) == 0 {
		if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
			return fmt.Errorf("removing the additions of %s: %w", name, err)
		}
		return nil
	}
	var b strings.Builder
	for _, a := range list {
		fmt.Fprintf(&b, "- %s <!-- arc:learn key=%s learned=%s count=%d -->\n", a.Text, a.Key, a.Learned, a.Count)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("creating %s: %w", filepath.Dir(path), err)
	}
	if err := os.WriteFile(path, []byte(b.String()), 0o644); err != nil {
		return fmt.Errorf("writing the additions of %s: %w", name, err)
	}
	return nil
}

// validAddition refuses a line ReadAdditions could not read back: the file is one line per addition, so
// a line break in the text, or a key, date or count outside the marker's shape, would be lost on the next read.
func validAddition(a Addition) error {
	switch {
	case a.Text == "" || strings.ContainsAny(a.Text, "\r\n"):
		return errors.New("an addition's text is one non-empty line")
	case !additionKey.MatchString(a.Key):
		return fmt.Errorf("addition key %q is not lowercase words joined by hyphens", a.Key)
	case !learnedDate.MatchString(a.Learned):
		return fmt.Errorf("addition date %q is not YYYY-MM-DD", a.Learned)
	case a.Count < 0:
		return fmt.Errorf("addition count %d is negative", a.Count)
	}
	return nil
}

// UpsertAddition adds a to the skill's additions, or replaces the line with the same key: the text and the
// date come from a, and the count grows by a.Count.
func UpsertAddition(skillsRoot, name string, a Addition) error {
	if _, err := os.Stat(filepath.Join(skillsRoot, name, skillFile)); err != nil {
		if os.IsNotExist(err) {
			return fmt.Errorf("%w: %s", ErrNoSkill, name)
		}
		return fmt.Errorf("reading skill %s: %w", name, err)
	}
	if err := validAddition(a); err != nil {
		return err
	}
	list, err := ReadAdditions(skillsRoot, name)
	if err != nil {
		return err
	}
	replaced := false
	for i := range list {
		if list[i].Key == a.Key {
			a.Count += list[i].Count
			list[i] = a
			replaced = true
			break
		}
	}
	if !replaced {
		if len(list) >= MaxAdditions {
			return ErrAdditionsFull
		}
		list = append(list, a)
	}
	return writeAdditions(skillsRoot, name, list)
}

// RemoveAddition drops the line with key; a key the skill does not hold changes nothing.
func RemoveAddition(skillsRoot, name, key string) error {
	list, err := ReadAdditions(skillsRoot, name)
	if err != nil {
		return err
	}
	kept := list[:0:0]
	for _, a := range list {
		if a.Key != key {
			kept = append(kept, a)
		}
	}
	if len(kept) == len(list) {
		return nil
	}
	return writeAdditions(skillsRoot, name, kept)
}

// renderAdditions is the block a harness's SKILL.md ends with; "" when there are none.
func renderAdditions(list []Addition) string {
	if len(list) == 0 {
		return ""
	}
	var b strings.Builder
	b.WriteString(additionsHead)
	for _, a := range list {
		fmt.Fprintf(&b, "- %s (learned %s, %d×)\n", a.Text, a.Learned, a.Count)
	}
	return b.String()
}
