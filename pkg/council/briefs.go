// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package council

import (
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// Briefs: the files a council is given from outside its project are copied into it when the council starts, so the
// report's cites name a file the repository holds and resolve on every machine that syncs it. On 2026-11-18 a council's
// seven briefs sat in a Mac's home folder, and its report read on Windows cited seven files that were not there.

// briefCap is the most a brief may hold, a single file or a folder in all: a big PDF or a dump folder would otherwise
// land in the repository.
const briefCap = 1 << 20

// briefsDir is the project folder the copies go into, with forward slashes.
const briefsDir = "docs/council/briefs"

// takeBriefs brings c's files into its project before it runs. An absolute path inside the project becomes
// project-relative, with forward slashes. A file or folder outside it is copied (a folder whole, its tree kept) to
// docs/council/briefs/<day>-<id>-<base name>, numbered -2, -3 when that name is taken; its `files` entry then names the
// copy and c.Briefs records {Source, Copy}. One over briefCap, one that cannot be read, or every one when the project
// folder is not there, stays in `files` as it was, and c.Briefs records why it was skipped. A source that already has a
// copy (a saved council run again) keeps it and is not copied again; a source skipped before is tried again.
// Screenshots are not touched.
func takeBriefs(c *Council, day time.Time) {
	project := filepath.Clean(strings.TrimSpace(c.Project))
	if strings.TrimSpace(c.Project) == "" || len(c.Files) == 0 {
		return
	}
	var kept []CouncilBrief
	copies := map[string]string{} // source -> copy
	taken := map[string]bool{}    // copy names this council holds
	for _, b := range c.Briefs {
		if b.Copy != "" {
			kept = append(kept, b)
			copies[b.Source] = b.Copy
			taken[b.Copy] = true
		}
	}
	c.Briefs = kept
	projectErr := ""
	if info, err := os.Stat(project); err != nil || !info.IsDir() {
		projectErr = "the project folder " + project + " is not there"
	}
	files := make([]string, len(c.Files)) // a new slice: Start's copy of a council shares its caller's
	for i, f := range c.Files {
		files[i] = f
		if strings.TrimSpace(f) == "" {
			continue
		}
		abs, in := inside(project, strings.TrimSpace(f))
		if in {
			if filepath.IsAbs(strings.TrimSpace(f)) {
				rel, _ := filepath.Rel(project, abs)
				files[i] = filepath.ToSlash(rel)
			}
			continue
		}
		if cp, ok := copies[abs]; ok {
			files[i] = cp
			continue
		}
		brief := CouncilBrief{Source: abs}
		if projectErr != "" {
			brief.Skipped = projectErr
		} else {
			rel := briefName(project, day, c.Id, abs, taken)
			if err := copyBrief(abs, filepath.Join(project, filepath.FromSlash(rel))); err != nil {
				brief.Skipped = err.Error()
			} else {
				brief.Copy, files[i], taken[rel], copies[abs] = rel, rel, true, rel
			}
		}
		if brief.Skipped != "" {
			log.Printf("[council] %s: %s was not copied into %s: %s", c.Id, abs, briefsDir, brief.Skipped)
		}
		c.Briefs = append(c.Briefs, brief)
	}
	c.Files = files
}

// briefName is where the copy of source goes, project-relative: briefsDir/<day>-<id>-<base name>, with -2, -3 before a
// file's extension (after a folder's name) when the council holds that name already or the project has a file there.
func briefName(project string, day time.Time, id, source string, taken map[string]bool) string {
	base := filepath.Base(source)
	stem, ext := base, ""
	if info, err := os.Stat(source); err == nil && !info.IsDir() {
		ext = filepath.Ext(base)
		stem = strings.TrimSuffix(base, ext)
	}
	prefix := day.Format("2006-01-02") + "-" + id + "-"
	for n := 1; ; n++ {
		name := stem + ext
		if n > 1 {
			name = stem + "-" + strconv.Itoa(n) + ext
		}
		rel := path.Join(briefsDir, prefix+name)
		if taken[rel] {
			continue
		}
		// a name the disk cannot answer for is returned too: the copy into it then fails and says why
		if _, err := os.Lstat(filepath.Join(project, filepath.FromSlash(rel))); err != nil {
			return rel
		}
	}
}

// copyBrief copies the file or folder at source to dest after checking it is under briefCap in all. A copy that fails
// midway removes what it wrote. The error says why in words the person reads in a warning.
func copyBrief(source, dest string) error {
	info, err := os.Stat(source)
	if err != nil {
		return fmt.Errorf("it cannot be read: %w", err)
	}
	size, err := briefSize(source, info)
	if err != nil {
		return fmt.Errorf("it cannot be read: %w", err)
	}
	if size > briefCap {
		return fmt.Errorf("it holds %d KB, over the 1 MB cap", (size+1023)/1024)
	}
	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		return fmt.Errorf("creating %s: %w", filepath.Dir(dest), err)
	}
	if !info.IsDir() {
		err = copyBriefFile(source, dest)
	} else {
		err = filepath.WalkDir(source, func(p string, d fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			rel, err := filepath.Rel(source, p)
			if err != nil {
				return err
			}
			to := filepath.Join(dest, rel)
			switch {
			case d.IsDir():
				return os.MkdirAll(to, 0o755)
			case d.Type().IsRegular():
				return copyBriefFile(p, to)
			}
			return nil // a link or a device is not a brief's content (briefSize did not count it either)
		})
	}
	if err != nil {
		if rmErr := os.RemoveAll(dest); rmErr != nil {
			log.Printf("[council] removing the partial copy %s: %v", dest, rmErr)
		}
		return fmt.Errorf("the copy failed: %w", err)
	}
	return nil
}

// briefSize is the bytes a brief holds: a file's size, or the regular files of a folder in all, the walk stopping once
// past briefCap.
func briefSize(source string, info fs.FileInfo) (int64, error) {
	if !info.IsDir() {
		return info.Size(), nil
	}
	var total int64
	errOver := errors.New("over")
	err := filepath.WalkDir(source, func(_ string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if !d.Type().IsRegular() {
			return nil
		}
		fi, err := d.Info()
		if err != nil {
			return err
		}
		if total += fi.Size(); total > briefCap {
			return errOver
		}
		return nil
	})
	if errors.Is(err, errOver) {
		err = nil
	}
	return total, err
}

// copyBriefFile copies one file's bytes from src to dst.
func copyBriefFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	return out.Close()
}
