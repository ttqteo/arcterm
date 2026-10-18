// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"fmt"
	"reflect"
	"strings"
	"testing"
)

// the shape of Google's answer for "gold" into Vietnamese, as trans -dump prints it, cut down
const transGoldJSON = `[[["vàng","gold",null,null,10],[null,null,null,"ɡōld"]],[["noun",["kim","màu vàng","tiền vàng","vàng"],[["kim",["gold"],null,0.001],["màu vàng",["gold","amber","aurora"]]],"gold",1],["adjective",["hoàng kim"],[["hoàng kim",["gold"]]],"gold",3]],"en",null,null,[["gold",null,[["vàng",null,true,false,[10]]]]]]`

// chunked splits s into HTTP chunks of at most n bytes, the way trans -dump prints a chunked answer
func chunked(s string, n int) string {
	var sb strings.Builder
	for len(s) > 0 {
		part := s[:min(n, len(s))]
		s = s[len(part):]
		fmt.Fprintf(&sb, "%x\r\n%s\r\n", len(part), part)
	}
	sb.WriteString("0\r\n\r\n")
	return sb.String()
}

func TestParseTransDump_word(t *testing.T) {
	want := transAnswer{
		Translation: "vàng",
		Phonetics:   "ɡōld",
		Classes: []transClass{
			{Pos: "noun", Words: []string{"kim", "màu vàng", "tiền vàng", "vàng"}},
			{Pos: "adjective", Words: []string{"hoàng kim"}},
		},
	}
	for name, raw := range map[string]string{
		"plain":            transGoldJSON + "\n",
		"one chunk":        chunked(transGoldJSON, 4096),
		"chunks of 40":     chunked(transGoldJSON, 40), // cuts inside a multi-byte rune too
		"no trailing line": strings.TrimRight(chunked(transGoldJSON, 4096), "\r\n"),
	} {
		got, err := parseTransDump([]byte(raw))
		if err != nil {
			t.Errorf("%s: %v", name, err)
			continue
		}
		if !reflect.DeepEqual(got, want) {
			t.Errorf("%s: got %+v", name, got)
		}
	}
}

func TestParseTransDump_sentence(t *testing.T) {
	raw := chunked(`[[["Chào thế giới. ","hello world.",null,null,10],["Bạn khỏe không?","how are you?",null,null,10]],null,"en"]`, 4096)
	got, err := parseTransDump([]byte(raw))
	if err != nil {
		t.Fatal(err)
	}
	if got.Translation != "Chào thế giới. Bạn khỏe không?" || got.Phonetics != "" || len(got.Classes) != 0 {
		t.Fatalf("got %+v", got)
	}
}

func TestParseTransDump_unreadable(t *testing.T) {
	for _, raw := range []string{"zz\r\n[]\r\n0\r\n", "ff\r\n[[\r\n0\r\n", "<html>blocked</html>"} {
		if _, err := parseTransDump([]byte(raw)); err == nil {
			t.Errorf("%q: no error", raw)
		}
	}
}

func TestFormatTransAnswer(t *testing.T) {
	a, err := parseTransDump([]byte(transGoldJSON))
	if err != nil {
		t.Fatal(err)
	}
	want := "\x1b[1mvàng\x1b[22m  /ɡōld/\n" +
		"  n.    kim · màu vàng · tiền vàng · vàng\n" +
		"  adj.  hoàng kim\n"
	if got := formatTransAnswer(a, 0); got != want {
		t.Fatalf("got\n%q\nwant\n%q", got, want)
	}
	// a sentence is one line
	if got := formatTransAnswer(transAnswer{Translation: "cái này cũ nhưng vàng"}, 80); got != "\x1b[1mcái này cũ nhưng vàng\x1b[22m\n" {
		t.Fatalf("sentence: %q", got)
	}
}

func TestFormatTransAnswer_wrapsUnderTheFirstMeaning(t *testing.T) {
	a := transAnswer{Translation: "chạy", Classes: []transClass{
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
