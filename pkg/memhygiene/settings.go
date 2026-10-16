// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package memhygiene

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"strings"
)

const settingsKey = "autoMemoryDirectory"

// SetAutoMemoryDirectory inserts or replaces the top-level autoMemoryDirectory key of a Claude Code
// settings file, leaving every other byte as it was. It creates the file when it's missing.
func SetAutoMemoryDirectory(path, value string) error {
	data, err := settingsEdit(path, value)
	if err != nil {
		return err
	}
	return WriteAtomic(path, data)
}

// settingsEdit returns the settings file's bytes with the key set, without writing them, so apply
// can back the file up first.
func settingsEdit(path, value string) ([]byte, error) {
	tf, err := ReadText(path)
	if err != nil {
		return nil, err
	}
	quoted := settingsQuote(value)
	if _, err := os.Stat(path); errors.Is(err, fs.ErrNotExist) {
		tf.Lines = []string{"{", "  " + settingsMember(quoted), "}"}
		return tf.Bytes(), nil
	}
	bom := tf.BOM
	tf.BOM = false
	out, err := settingsSetMember(tf.Bytes(), quoted, tf.EOL)
	if err != nil {
		return nil, fmt.Errorf("setting %s in %s: %w", settingsKey, path, err)
	}
	edited := parseText(out)
	edited.BOM = bom
	return edited.Bytes(), nil
}

// settingsSetMember edits src in place by byte offsets rather than re-encoding it, which would
// reorder keys and lose the file's formatting.
func settingsSetMember(src []byte, quoted, eol string) ([]byte, error) {
	var obj map[string]json.RawMessage
	if err := json.Unmarshal(src, &obj); err != nil {
		return nil, fmt.Errorf("the file is not a JSON object: %w", err)
	}
	if obj == nil {
		return nil, errors.New("the file is not a JSON object: null")
	}
	dec := json.NewDecoder(bytes.NewReader(src))
	if _, err := dec.Token(); err != nil {
		return nil, err
	}
	open := int(dec.InputOffset())
	type span struct{ start, end int }
	var values []span
	lastEnd := open
	for dec.More() {
		tok, err := dec.Token()
		if err != nil {
			return nil, err
		}
		afterKey := int(dec.InputOffset())
		var raw json.RawMessage
		if err := dec.Decode(&raw); err != nil {
			return nil, err
		}
		lastEnd = int(dec.InputOffset())
		if tok == settingsKey {
			start := afterKey + len(src[afterKey:]) - len(bytes.TrimLeft(src[afterKey:], " \t\r\n:"))
			values = append(values, span{start, lastEnd})
		}
	}
	if _, err := dec.Token(); err != nil {
		return nil, err
	}
	closeEnd := int(dec.InputOffset())
	member := settingsMember(quoted)
	var out []byte
	switch {
	case len(values) > 0:
		out = append([]byte(nil), src...)
		for i := len(values) - 1; i >= 0; i-- {
			v := values[i]
			out = append(out[:v.start], append([]byte(quoted), out[v.end:]...)...)
		}
	case len(obj) == 0:
		out = append(out, src[:open-1]...)
		out = append(out, "{"+eol+"  "+member+eol+"}"...)
		out = append(out, src[closeEnd:]...)
	default:
		// the new member follows the last one, spaced like the first member is from the brace
		first := open + len(src[open:]) - len(bytes.TrimLeft(src[open:], " \t\r\n"))
		out = append(out, src[:lastEnd]...)
		out = append(out, ","...)
		out = append(out, src[open:first]...)
		out = append(out, member...)
		out = append(out, src[lastEnd:]...)
	}
	return out, nil
}

func settingsMember(quoted string) string {
	return `"` + settingsKey + `": ` + quoted
}

func settingsQuote(value string) string {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	enc.Encode(value) // a string always encodes
	return strings.TrimSuffix(buf.String(), "\n")
}
