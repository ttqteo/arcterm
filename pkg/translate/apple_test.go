// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package translate

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// fakeHelper writes a shell script standing in for apple-translate
func fakeHelper(t *testing.T, script string) string {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("the helper is a shell script")
	}
	path := filepath.Join(t.TempDir(), AppleHelperName)
	if err := os.WriteFile(path, []byte("#!/bin/sh\n"+script), 0o755); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestApple_answer(t *testing.T) {
	// echoes its arguments and stdin back, and names the source in Apple's form
	helper := fakeHelper(t, `text=$(cat); printf '{"translation":" %s|%s|%s ","source":"he"}' "$1" "$2" "$text"`)
	a, err := Apple(context.Background(), helper, "zh-CN", "iw", "shalom & more")
	if err != nil {
		t.Fatal(err)
	}
	// Google's codes go out in Apple's form; the source comes back in Google's
	if a.Translation != "zh-Hans|he|shalom & more" || a.Source != "iw" {
		t.Errorf("got %+v", a)
	}
	if a.Phonetics != "" || a.Classes != nil {
		t.Errorf("Apple has no phonetics or word classes: %+v", a)
	}
}

func TestApple_codesPassThrough(t *testing.T) {
	helper := fakeHelper(t, `printf '{"translation":"%s %s","source":"vi"}' "$1" "$2"`)
	a, err := Apple(context.Background(), helper, "auto", "vi", "x")
	if err != nil || a.Translation != "auto vi" || a.Source != "vi" {
		t.Errorf("got %+v, %v", a, err)
	}
}

func TestApple_reason(t *testing.T) {
	helper := fakeHelper(t, `echo "the English → Thai language pack isn't downloaded" >&2; exit 2`)
	_, err := Apple(context.Background(), helper, "en", "th", "x")
	if err == nil || err.Error() != "the English → Thai language pack isn't downloaded" {
		t.Errorf("err = %v", err)
	}
}

func TestApple_noReason(t *testing.T) {
	helper := fakeHelper(t, `exit 1`)
	if _, err := Apple(context.Background(), helper, "en", "vi", "x"); err == nil || !strings.Contains(err.Error(), "exit status 1") {
		t.Errorf("err = %v", err)
	}
}

func TestApple_unreadable(t *testing.T) {
	helper := fakeHelper(t, `echo not json`)
	if _, err := Apple(context.Background(), helper, "en", "vi", "x"); err == nil || !strings.Contains(err.Error(), "unreadable") {
		t.Errorf("err = %v", err)
	}
}

func TestApple_missingHelper(t *testing.T) {
	if _, err := Apple(context.Background(), filepath.Join(t.TempDir(), "none"), "en", "vi", "x"); err == nil {
		t.Error("no error")
	}
}
