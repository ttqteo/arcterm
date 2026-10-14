// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package memhygiene

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io/fs"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

var utf8BOM = []byte{0xEF, 0xBB, 0xBF}

const (
	eolLF   = "\n"
	eolCRLF = "\r\n"
)

// HashFile returns the hex sha256 of a file's bytes, or "" when the file doesn't exist.
func HashFile(path string) (string, error) {
	data, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("hashing %s: %w", path, err)
	}
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:]), nil
}

// ChangeID is a change's identity: the same kind over the same files at the same hashes is the same
// change across checks, so a verdict survives a re-check until one of its files changes.
func ChangeID(kind string, files []wshrpc.MemFileRef) string {
	sorted := append([]wshrpc.MemFileRef(nil), files...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].Path < sorted[j].Path })
	h := sha256.New()
	h.Write([]byte(kind))
	for _, f := range sorted {
		h.Write([]byte{0})
		h.Write([]byte(f.Path))
		h.Write([]byte{0})
		h.Write([]byte(f.Sha256))
	}
	return hex.EncodeToString(h.Sum(nil))
}

// TextFile is a text file split into lines, keeping what a rewrite must preserve: its line ending,
// a leading BOM, and whether the last line ends with a newline.
type TextFile struct {
	Lines    []string
	EOL      string
	BOM      bool
	FinalEOL bool
}

// ReadText reads a text file. A missing file is an empty TextFile whose added lines end with "\n".
func ReadText(path string) (TextFile, error) {
	data, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return TextFile{EOL: eolLF, FinalEOL: true}, nil
	}
	if err != nil {
		return TextFile{}, fmt.Errorf("reading %s: %w", path, err)
	}
	return parseText(data), nil
}

func parseText(data []byte) TextFile {
	tf := TextFile{EOL: eolLF}
	if bytes.HasPrefix(data, utf8BOM) {
		tf.BOM = true
		data = data[len(utf8BOM):]
	}
	// the first line's ending is the file's; splitting on it keeps Bytes an exact inverse
	if i := bytes.IndexByte(data, '\n'); i > 0 && data[i-1] == '\r' {
		tf.EOL = eolCRLF
	}
	if len(data) == 0 {
		return tf
	}
	text := string(data)
	tf.FinalEOL = strings.HasSuffix(text, tf.EOL)
	tf.Lines = strings.Split(strings.TrimSuffix(text, tf.EOL), tf.EOL)
	return tf
}

// Bytes is the file's content; for a TextFile from ReadText it is byte-identical to the file.
func (tf TextFile) Bytes() []byte {
	var buf bytes.Buffer
	if tf.BOM {
		buf.Write(utf8BOM)
	}
	if len(tf.Lines) == 0 {
		return buf.Bytes()
	}
	buf.WriteString(strings.Join(tf.Lines, tf.EOL))
	if tf.FinalEOL {
		buf.WriteString(tf.EOL)
	}
	return buf.Bytes()
}

// WriteAtomic writes a temp file beside path and renames it over path, so a reader never sees a
// half-written file. It creates the parent dir.
func WriteAtomic(path string, data []byte) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("writing %s: %w", path, err)
	}
	tmp, err := os.CreateTemp(dir, "."+filepath.Base(path)+".tmp-*")
	if err != nil {
		return fmt.Errorf("writing %s: %w", path, err)
	}
	tmpPath := tmp.Name()
	_, werr := tmp.Write(data)
	cerr := tmp.Close()
	if err := errors.Join(werr, cerr); err != nil {
		os.Remove(tmpPath)
		return fmt.Errorf("writing %s: %w", path, err)
	}
	if err := os.Rename(tmpPath, path); err != nil {
		os.Remove(tmpPath)
		return fmt.Errorf("writing %s: %w", path, err)
	}
	return nil
}

var mdLinkRe = regexp.MustCompile(`\]\(([^)\s]+)\)`)

// IndexLinks returns the *.md link targets of one index line, in order, URL-decoded.
func IndexLinks(line string) []string {
	var out []string
	for _, m := range mdLinkRe.FindAllStringSubmatch(line, -1) {
		target := m[1]
		if strings.Contains(target, "://") {
			continue
		}
		if i := strings.IndexAny(target, "#?"); i >= 0 {
			target = target[:i]
		}
		if !strings.EqualFold(filepath.Ext(target), ".md") {
			continue
		}
		if decoded, err := url.PathUnescape(target); err == nil {
			target = decoded
		}
		out = append(out, target)
	}
	return out
}
