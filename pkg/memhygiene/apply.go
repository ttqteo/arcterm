// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package memhygiene

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const (
	applyIndexName    = "MEMORY.md"
	applyManifestName = "manifest.json"
	applyFilesDir     = "files"
	applyFileMode     = 0o644
)

var applyHarvesterKeys = []string{"source", "source_hash", "harvested_at"}

type applyManifest struct {
	ApplyId   string              `json:"applyid"`
	Kind      string              `json:"kind"`
	Title     string              `json:"title"`
	CreatedAt int64               `json:"createdat"` // unix ms; the backup's age for PruneBackups
	Files     []applyManifestFile `json:"files"`
}

type applyManifestFile struct {
	Path   string `json:"path"`
	Pre    string `json:"pre"`    // sha256 before the apply; "" = it didn't exist
	Post   string `json:"post"`   // sha256 after the apply; "" = the apply deleted it
	Backup string `json:"backup"` // the original's copy, relative to the backup dir; "" when Pre is ""
}

type applyWrite struct {
	data   []byte
	remove bool
}

// applyPlan is every file an apply writes, in order, built before anything is written so a bad op
// fails with the disk untouched.
type applyPlan struct {
	order  []string
	writes map[string]applyWrite
}

func (p *applyPlan) set(path string, w applyWrite) {
	if _, ok := p.writes[path]; !ok {
		p.order = append(p.order, path)
	}
	p.writes[path] = w
}

func (p *applyPlan) put(path string, data []byte) { p.set(path, applyWrite{data: data}) }
func (p *applyPlan) remove(path string)           { p.set(path, applyWrite{remove: true}) }

// Apply writes a change. When a file differs from its check-time hash it returns that path as the
// conflict and writes nothing. Otherwise it backs up every file it touches under
// <backupRoot>/<applyID>/ first.
func Apply(change wshrpc.MemChange, backupRoot string, now time.Time) (applyID string, conflict string, err error) {
	for _, f := range change.Files {
		hash, err := HashFile(f.Path)
		if err != nil {
			return "", "", err
		}
		if hash != f.Sha256 {
			return "", f.Path, nil
		}
	}
	plan, err := applyBuild(change)
	if err != nil {
		return "", "", fmt.Errorf("applying %s %q: %w", change.Kind, change.Title, err)
	}
	applyID, err = applyNewID(now)
	if err != nil {
		return "", "", err
	}
	dir := filepath.Join(backupRoot, applyID)
	manifest := applyManifest{ApplyId: applyID, Kind: change.Kind, Title: change.Title, CreatedAt: now.UnixMilli()}
	for i, path := range plan.order {
		entry, err := applyBackup(dir, i, path)
		if err != nil {
			return "", "", err
		}
		manifest.Files = append(manifest.Files, entry)
	}
	for _, path := range plan.order {
		if err := applyExecute(path, plan.writes[path]); err != nil {
			return "", "", fmt.Errorf("applying %s %q stopped part way, the originals are in %s: %w", change.Kind, change.Title, dir, err)
		}
	}
	for i := range manifest.Files {
		if manifest.Files[i].Post, err = HashFile(manifest.Files[i].Path); err != nil {
			return "", "", err
		}
	}
	data, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return "", "", fmt.Errorf("encoding backup manifest %s: %w", applyID, err)
	}
	if err := WriteAtomic(filepath.Join(dir, applyManifestName), data); err != nil {
		return "", "", err
	}
	return applyID, "", nil
}

// Undo restores an apply's backup. When a file no longer has the hash the apply left it returns that
// path as the conflict and writes nothing.
func Undo(backupRoot, applyID string) (conflict string, err error) {
	if applyID == "" || applyID != filepath.Base(applyID) || applyID == "." || applyID == ".." {
		return "", fmt.Errorf("undo: invalid apply id %q", applyID)
	}
	dir := filepath.Join(backupRoot, applyID)
	manifest, err := applyReadManifest(dir)
	if err != nil {
		return "", err
	}
	for _, f := range manifest.Files {
		hash, err := HashFile(f.Path)
		if err != nil {
			return "", err
		}
		if hash != f.Post {
			return f.Path, nil
		}
	}
	for _, f := range manifest.Files {
		if f.Pre == "" {
			if err := applyExecute(f.Path, applyWrite{remove: true}); err != nil && !errors.Is(err, fs.ErrNotExist) {
				return "", fmt.Errorf("undoing %s: %w", applyID, err)
			}
			continue
		}
		data, err := os.ReadFile(filepath.Join(dir, f.Backup))
		if err != nil {
			return "", fmt.Errorf("undoing %s: %w", applyID, err)
		}
		if err := applyExecute(f.Path, applyWrite{data: data}); err != nil {
			return "", fmt.Errorf("undoing %s: %w", applyID, err)
		}
	}
	return "", nil
}

// PruneBackups deletes the backups older than keep. A backup without a readable manifest (an apply
// that stopped part way) is judged by its dir's time.
func PruneBackups(backupRoot string, now time.Time, keep time.Duration) error {
	entries, err := os.ReadDir(backupRoot)
	if errors.Is(err, fs.ErrNotExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("pruning backups in %s: %w", backupRoot, err)
	}
	var errs []error
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		dir := filepath.Join(backupRoot, e.Name())
		var created time.Time
		if m, err := applyReadManifest(dir); err == nil {
			created = time.UnixMilli(m.CreatedAt)
		} else if info, err := e.Info(); err == nil {
			created = info.ModTime()
		} else {
			errs = append(errs, fmt.Errorf("pruning backup %s: %w", dir, err))
			continue
		}
		if now.Sub(created) > keep {
			if err := os.RemoveAll(dir); err != nil {
				errs = append(errs, fmt.Errorf("pruning backup %s: %w", dir, err))
			}
		}
	}
	return errors.Join(errs...)
}

func applyNewID(now time.Time) (string, error) {
	var b [4]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", fmt.Errorf("making an apply id: %w", err)
	}
	return now.UTC().Format("20060102-150405") + "-" + hex.EncodeToString(b[:]), nil
}

func applyReadManifest(dir string) (applyManifest, error) {
	var m applyManifest
	data, err := os.ReadFile(filepath.Join(dir, applyManifestName))
	if err != nil {
		return m, fmt.Errorf("reading backup manifest: %w", err)
	}
	if err := json.Unmarshal(data, &m); err != nil {
		return m, fmt.Errorf("parsing backup manifest in %s: %w", dir, err)
	}
	return m, nil
}

// applyBackup copies path's original into the backup dir byte for byte.
func applyBackup(dir string, i int, path string) (applyManifestFile, error) {
	entry := applyManifestFile{Path: path}
	var err error
	if entry.Pre, err = HashFile(path); err != nil || entry.Pre == "" {
		return entry, err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return entry, fmt.Errorf("backing up %s: %w", path, err)
	}
	entry.Backup = filepath.Join(applyFilesDir, strconv.Itoa(i))
	return entry, WriteAtomic(filepath.Join(dir, entry.Backup), data)
}

// applyExecute writes or deletes one file. WriteAtomic's temp file is owner-only, so the file gets
// its old mode back (or the usual mode when it's new).
func applyExecute(path string, w applyWrite) error {
	if w.remove {
		return os.Remove(path)
	}
	mode := os.FileMode(applyFileMode)
	if info, err := os.Stat(path); err == nil {
		mode = info.Mode().Perm()
	}
	if err := WriteAtomic(path, w.data); err != nil {
		return err
	}
	if err := os.Chmod(path, mode); err != nil {
		return fmt.Errorf("writing %s: %w", path, err)
	}
	return nil
}

func applyBuild(change wshrpc.MemChange) (*applyPlan, error) {
	op := change.Op
	p := &applyPlan{writes: map[string]applyWrite{}}
	var err error
	switch change.Kind {
	case "delete", "remove-shared":
		applyRemoveMemories(p, op, "")
	case "trim":
		err = applyTrim(p, op)
	case "merge":
		err = applyMerge(p, op)
	case "move-to-doc":
		if err = applyDocPassage(p, op); err == nil {
			applyRemoveMemories(p, op, "")
		}
	case "add-to-index":
		if op.StripHarvester {
			err = applyStripHarvester(p, op)
		}
	case "move-here", "copy-here":
		err = applyCopyMemories(p, op, change.Kind == "move-here")
	case "settings":
		var data []byte
		if data, err = settingsEdit(op.SettingsPath, op.SettingsValue); err == nil {
			p.put(op.SettingsPath, data)
		}
		return p, err
	default:
		return nil, fmt.Errorf("unknown change kind %q", change.Kind)
	}
	if err != nil {
		return nil, err
	}
	if err := applyIndexEdit(p, op); err != nil {
		return nil, err
	}
	return p, nil
}

func applyRemoveMemories(p *applyPlan, op wshrpc.MemOp, except string) {
	for _, name := range op.Memories {
		if name != except {
			p.remove(filepath.Join(op.Folder, name))
		}
	}
}

func applyTrim(p *applyPlan, op wshrpc.MemOp) error {
	if len(op.Memories) != 1 {
		return fmt.Errorf("a trim names one memory, got %d", len(op.Memories))
	}
	path := filepath.Join(op.Folder, op.Memories[0])
	tf, err := ReadText(path)
	if err != nil {
		return err
	}
	text := strings.Join(tf.Lines, "\n")
	old := applyNormalize(op.Old)
	if n := strings.Count(text, old); old == "" || n != 1 {
		return fmt.Errorf("the passage to trim appears %d times in %s, not once", n, path)
	}
	tf.Lines = strings.Split(strings.Replace(text, old, applyNormalize(op.New), 1), "\n")
	p.put(path, tf.Bytes())
	return nil
}

// applyMerge writes the merged file in place of WriteName, keeping that file's line ending and BOM,
// and deletes the other merged files.
func applyMerge(p *applyPlan, op wshrpc.MemOp) error {
	if op.WriteName == "" {
		return errors.New("a merge names no file to write")
	}
	path := filepath.Join(op.Folder, op.WriteName)
	tf, err := ReadText(path)
	if err != nil {
		return err
	}
	tf.Lines = applyLines(op.WriteBody)
	p.put(path, tf.Bytes())
	applyRemoveMemories(p, op, op.WriteName)
	return nil
}

// applyDocPassage appends the passage after the last non-blank line of the named section.
func applyDocPassage(p *applyPlan, op wshrpc.MemOp) error {
	if _, err := os.Stat(op.DocPath); err != nil {
		return fmt.Errorf("reading %s: %w", op.DocPath, err)
	}
	tf, err := ReadText(op.DocPath)
	if err != nil {
		return err
	}
	start, end, err := applyFindSection(tf.Lines, op.DocSection)
	if err != nil {
		return fmt.Errorf("%s: %w", op.DocPath, err)
	}
	at := end
	for at > start+1 && strings.TrimSpace(tf.Lines[at-1]) == "" {
		at--
	}
	tf.Lines = slices.Insert(tf.Lines, at, applyLines(op.DocPassage)...)
	p.put(op.DocPath, tf.Bytes())
	return nil
}

// applyFindSection returns the heading line of the one section named section (with or without its
// leading #s) and the line its section ends before: the next heading of the same or a higher level.
// Headings inside code fences don't count.
func applyFindSection(lines []string, section string) (start, end int, err error) {
	want := applyHeadingText(section)
	start, level, matches := -1, 0, 0
	end = len(lines)
	fenced := false
	for i, line := range lines {
		if strings.HasPrefix(strings.TrimSpace(line), "```") {
			fenced = !fenced
			continue
		}
		lv := applyHeadingLevel(line)
		if fenced || lv == 0 {
			continue
		}
		if start >= 0 && end == len(lines) && lv <= level {
			end = i
		}
		if applyHeadingText(line) == want {
			matches++
			if start < 0 {
				start, level = i, lv
			}
		}
	}
	if matches != 1 {
		return 0, 0, fmt.Errorf("section %q appears %d times, not once", section, matches)
	}
	return start, end, nil
}

func applyHeadingLevel(line string) int {
	n := len(line) - len(strings.TrimLeft(line, "#"))
	if n == 0 || n > 6 || (len(line) > n && line[n] != ' ' && line[n] != '\t') {
		return 0
	}
	return n
}

func applyHeadingText(line string) string {
	return strings.TrimSpace(strings.TrimLeft(strings.TrimSpace(line), "#"))
}

// applyStripHarvester drops the harvester's frontmatter keys from each memory.
func applyStripHarvester(p *applyPlan, op wshrpc.MemOp) error {
	for _, name := range op.Memories {
		path := filepath.Join(op.Folder, name)
		tf, err := ReadText(path)
		if err != nil {
			return err
		}
		if len(tf.Lines) == 0 || tf.Lines[0] != "---" {
			continue
		}
		closing := slices.Index(tf.Lines[1:], "---")
		if closing < 0 {
			continue
		}
		front := slices.DeleteFunc(slices.Clone(tf.Lines[1:closing+1]), func(line string) bool {
			key, _, ok := strings.Cut(line, ":")
			return ok && slices.Contains(applyHarvesterKeys, strings.TrimSpace(key))
		})
		if len(front) == closing {
			continue
		}
		tf.Lines = slices.Concat(tf.Lines[:1], front, tf.Lines[closing+1:])
		p.put(path, tf.Bytes())
	}
	return nil
}

// applyCopyMemories copies each memory to ToFolder byte for byte and, for a move, deletes the source.
func applyCopyMemories(p *applyPlan, op wshrpc.MemOp, move bool) error {
	if op.ToFolder == "" {
		return errors.New("no destination folder")
	}
	for _, name := range op.Memories {
		src := filepath.Join(op.Folder, name)
		data, err := os.ReadFile(src)
		if err != nil {
			return fmt.Errorf("reading %s: %w", src, err)
		}
		p.put(filepath.Join(op.ToFolder, name), data)
		if move {
			p.remove(src)
		}
	}
	return nil
}

// applyIndexEdit removes IndexRemove from Folder's MEMORY.md and adds IndexAdd to IndexFolder's
// (Folder when unset). In the same index the added line takes the first removed line's place, so a
// trim or merge keeps the entry where it was; otherwise it goes after the last non-blank line.
func applyIndexEdit(p *applyPlan, op wshrpc.MemOp) error {
	add := op.IndexAdd
	addFolder := op.IndexFolder
	if addFolder == "" {
		addFolder = op.Folder
	}
	if len(op.IndexRemove) > 0 {
		path := filepath.Join(op.Folder, applyIndexName)
		tf, err := ReadText(path)
		if err != nil {
			return err
		}
		at := -1
		for _, line := range op.IndexRemove {
			i := slices.Index(tf.Lines, line)
			if i < 0 {
				return fmt.Errorf("index line not in %s: %q", path, line)
			}
			tf.Lines = slices.Delete(tf.Lines, i, i+1)
			if at < 0 || i < at {
				at = i
			}
		}
		if add != "" && filepath.Clean(addFolder) == filepath.Clean(op.Folder) {
			tf.Lines = slices.Insert(tf.Lines, at, add)
			add = ""
		}
		p.put(path, tf.Bytes())
	}
	if add == "" {
		return nil
	}
	path := filepath.Join(addFolder, applyIndexName)
	tf, err := ReadText(path)
	if err != nil {
		return err
	}
	at := len(tf.Lines)
	for at > 0 && strings.TrimSpace(tf.Lines[at-1]) == "" {
		at--
	}
	tf.Lines = slices.Insert(tf.Lines, at, add)
	p.put(path, tf.Bytes())
	return nil
}

// applyNormalize drops \r so model text, which has LF endings, matches a CRLF file's lines.
func applyNormalize(s string) string {
	return strings.ReplaceAll(s, "\r\n", "\n")
}

// applyLines splits model text into lines; the file's ending is put back on write.
func applyLines(s string) []string {
	return strings.Split(strings.TrimSuffix(applyNormalize(s), "\n"), "\n")
}
