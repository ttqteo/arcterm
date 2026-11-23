// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package council

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/wavetermdev/waveterm/pkg/util/asciifold"
)

// DocDay is the date a saved document's default file name starts with; a test replaces it.
var DocDay = func() time.Time { return time.Now() }

// docSlugRunes cuts a feature's slug so a long feature does not make a long file name.
const docSlugRunes = 60

// FeatureSlug is a feature as a file name part, plain ASCII so a terminal can open the path as a link: letters and
// digits, lower case, diacritics dropped ("Chế độ" → "che-do"), runs of anything else one dash. A combining mark is
// dropped with no dash (a decomposed "é" folds like the composed one); a letter with no ASCII form counts as a separator.
func FeatureSlug(feature string) string {
	var b strings.Builder
	runes, dash := 0, false
	for _, r := range asciifold.Lower(feature) {
		if r < unicode.MaxASCII && (unicode.IsLetter(r) || unicode.IsDigit(r)) {
			b.WriteRune(r)
			runes++
			dash = false
		} else if !dash && runes > 0 {
			b.WriteByte('-')
			runes++
			dash = true
		}
		if runes >= docSlugRunes {
			break
		}
	}
	if slug := strings.Trim(b.String(), "-"); slug != "" {
		return slug
	}
	return "council"
}

// inside is path made absolute under project when it is relative, and whether it lies strictly inside project.
func inside(project, path string) (string, bool) {
	if !filepath.IsAbs(path) {
		path = filepath.Join(project, path)
	}
	path = filepath.Clean(path)
	rel, err := filepath.Rel(project, path)
	if err != nil || rel == "." || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return path, false
	}
	return path, true
}

// DocPath is where a council's document is written: the path asked for, else the path it was saved at before (so a
// follow-up or a Summarize rewrites the one file), else docs/council/<day>-<slug>.md under the project, with a -2, -3
// suffix when that file is already there. A path outside the project is refused.
func DocPath(c *Council, asked string) (string, error) {
	project := strings.TrimSpace(c.Project)
	if project == "" {
		return "", fmt.Errorf("council %s has no project folder to save a doc into", c.Id)
	}
	project = filepath.Clean(project)
	if path := strings.TrimSpace(asked); path != "" {
		path, ok := inside(project, path)
		if !ok {
			return "", fmt.Errorf("%s is outside the project %s", path, project)
		}
		return path, nil
	}
	if prev := strings.TrimSpace(c.DocPath); prev != "" {
		if path, ok := inside(project, prev); ok {
			return path, nil
		}
	}
	stem := filepath.Join(project, "docs", "council", docStem(c))
	for n := 1; ; n++ {
		path := stem + ".md"
		if n > 1 {
			path = stem + "-" + strconv.Itoa(n) + ".md"
		}
		if _, err := os.Stat(path); errors.Is(err, fs.ErrNotExist) {
			return path, nil
		} else if err != nil {
			return "", fmt.Errorf("checking %s: %w", path, err)
		}
	}
}

// docStem is the default name of a council's document without its extension: the day and the feature's slug.
func docStem(c *Council) string {
	return DocDay().Format("2006-01-02") + "-" + FeatureSlug(c.Feature)
}

// docFileName is the base name of a council's main document: the file it was saved at, else the one a first save would
// pick now (without the -2 DocPath adds when that name is taken, which needs the project's folder). It splits on both
// kinds of slash, since a council saved on Windows can be read on a Mac.
func docFileName(c *Council) string {
	if prev := strings.TrimSpace(c.DocPath); prev != "" {
		return prev[strings.LastIndexAny(prev, `/\`)+1:]
	}
	return docStem(c) + ".md"
}

// WriteDocument writes the council's report at DocPath(c, asked), making the folders, and returns that path: the main
// file there (reportMain) and its side file beside it at SidePath (reportSide). The crops of the screenshot regions are
// copied into `<doc name>-regions/` and embedded in the side file (copyRegions), and every `path:line` the report and the
// discussion cite is checked against the council's folders (citeRoots) into the side file's "Cite check" section, with no
// model. It writes those files and nothing else: it never stages or commits, and it works in a folder that is not a git
// repository. The side file is written first, so a main file that is there never links one that is not.
func WriteDocument(c *Council, asked string) (string, error) {
	path, err := DocPath(c, asked)
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return "", fmt.Errorf("creating %s: %w", filepath.Dir(path), err)
	}
	side := SidePath(path)
	main := reportMain(c, filepath.Base(side))
	sideDoc := reportSide(c, filepath.Base(path), main, copyRegions(c, path), citeRoots(c))
	if err := os.WriteFile(side, []byte(sideDoc), 0o644); err != nil {
		return "", fmt.Errorf("writing %s: %w", side, err)
	}
	if err := os.WriteFile(path, []byte(main), 0o644); err != nil {
		return "", fmt.Errorf("writing %s: %w", path, err)
	}
	return path, nil
}
