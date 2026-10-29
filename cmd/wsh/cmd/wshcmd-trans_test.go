// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/translate"
)

func TestFormatTransAnswer(t *testing.T) {
	a := translate.Answer{
		Translation: "vàng",
		Phonetics:   "ɡōld",
		Classes: []translate.Class{
			{Pos: "noun", Words: []string{"kim", "màu vàng", "tiền vàng", "vàng"}},
			{Pos: "adjective", Words: []string{"hoàng kim"}},
		},
	}
	want := "\x1b[1mvàng\x1b[22m  /ɡōld/\n" +
		"  n.    kim · màu vàng · tiền vàng · vàng\n" +
		"  adj.  hoàng kim\n"
	if got := formatTransAnswer(a, 0); got != want {
		t.Fatalf("got\n%q\nwant\n%q", got, want)
	}
	// a sentence is one line
	if got := formatTransAnswer(translate.Answer{Translation: "cái này cũ nhưng vàng"}, 80); got != "\x1b[1mcái này cũ nhưng vàng\x1b[22m\n" {
		t.Fatalf("sentence: %q", got)
	}
}

func TestFormatTransAnswer_wrapsUnderTheFirstMeaning(t *testing.T) {
	a := translate.Answer{Translation: "chạy", Classes: []translate.Class{
		{Pos: "verb", Words: []string{"chạy", "chạy trốn", "điều khiển", "đuổi theo", "chảy"}},
	}}
	want := "\x1b[1mchạy\x1b[22m\n" +
		"  v.  chạy · chạy trốn · điều khiển\n" +
		"      đuổi theo · chảy\n"
	if got := formatTransAnswer(a, 36); got != want {
		t.Fatalf("got\n%s\nwant\n%s", got, want)
	}
	for _, line := range strings.Split(strings.TrimSuffix(want, "\n"), "\n")[1:] {
		if n := len([]rune(line)); n > 36 {
			t.Errorf("%q is %d columns", line, n)
		}
	}
}

func TestTransLangLine(t *testing.T) {
	for line, want := range map[string]string{":vi": "vi", ":en": "en", ":zh-CN": "zh-CN", ":fil": "fil"} {
		if m := transLangLine.FindStringSubmatch(line); m == nil || m[1] != want {
			t.Errorf("%s: %v", line, m)
		}
	}
	for _, line := range []string{":q", "vi", ":vi now", ": en", ":english"} {
		if transLangLine.MatchString(line) {
			t.Errorf("%q read as a language", line)
		}
	}
}
