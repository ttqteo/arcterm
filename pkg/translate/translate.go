// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package translate asks Google Translate for a text's translation and reads its answer. The rail's Quick translate
// (wavesrv's translate command) fetches through Google; `wsh trans` fetches through translate-shell and reads the same
// answer with Parse.
package translate

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

// MaxChars is the longest text one request takes: the limit Google's own page has.
const MaxChars = 5000

const googleTimeout = 10 * time.Second

// maxAnswerBytes bounds what is read of an answer: 5,000 characters of text come back well under it.
const maxAnswerBytes = 4 << 20

// googleURL is a variable so a test can point Google at httptest.
var googleURL = "https://translate.googleapis.com/translate_a/single"

// Answer is what Google says about a text.
type Answer struct {
	Translation string
	Source      string // the language Google took the text to be in; empty when it said none
	Phonetics   string // of the text typed
	Classes     []Class
}

// Class is one part of speech with the words Google lists for it (a one-word lookup).
type Class struct {
	Pos   string // "noun", "verb"…
	Words []string
}

// Google translates text from source (a language code, or "auto" to have Google detect it) into target. Empty text
// answers an empty Answer with no request; text over MaxChars is refused without one.
func Google(ctx context.Context, source, target, text string) (Answer, error) {
	if strings.TrimSpace(text) == "" {
		return Answer{}, nil
	}
	if n := utf8.RuneCountInString(text); n > MaxChars {
		return Answer{}, fmt.Errorf("the text is %d characters; Google translates at most %d at a time", n, MaxChars)
	}
	ctx, cancel := context.WithTimeout(ctx, googleTimeout)
	defer cancel()
	q := url.Values{"client": {"gtx"}, "sl": {source}, "tl": {target}, "q": {text}, "dt": {"t", "rm", "bd"}}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, googleURL+"?"+q.Encode(), nil)
	if err != nil {
		return Answer{}, fmt.Errorf("couldn't build the request to Google: %v", err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return Answer{}, fmt.Errorf("couldn't reach Google: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return Answer{}, fmt.Errorf("Google answered %s", resp.Status)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxAnswerBytes))
	if err != nil {
		return Answer{}, fmt.Errorf("couldn't read Google's answer: %v", err)
	}
	return Parse(body)
}

// Parse reads Google's answer, a JSON array, as it came over the wire: either the array itself or the array in HTTP
// chunks (a hex size line before each piece, a 0 after the last), which is how trans -dump prints it.
func Parse(raw []byte) (Answer, error) {
	body := bytes.TrimSpace(raw)
	if len(body) > 0 && body[0] != '[' {
		var err error
		if body, err = dechunk(body); err != nil {
			return Answer{}, err
		}
	}
	var top []json.RawMessage
	if err := json.Unmarshal(body, &top); err != nil {
		return Answer{}, fmt.Errorf("unreadable answer: %v", err)
	}
	var a Answer
	// [0]: the translation in segments, ["vàng","gold",…]; one segment [null,null,…,"ɡōld"] holds the phonetics
	var segs [][]any
	if len(top) > 0 {
		json.Unmarshal(top[0], &segs)
	}
	var sb strings.Builder
	for _, s := range segs {
		if len(s) > 0 {
			if t, ok := s[0].(string); ok {
				sb.WriteString(t)
				continue
			}
		}
		if len(s) > 3 {
			if p, ok := s[3].(string); ok {
				a.Phonetics = p
			}
		}
	}
	a.Translation = strings.TrimSpace(sb.String())
	// [1]: the dictionary, one entry per word class, ["noun",["kim","màu vàng",…],…]
	var dict [][]any
	if len(top) > 1 {
		json.Unmarshal(top[1], &dict)
	}
	for _, e := range dict {
		if len(e) < 2 {
			continue
		}
		pos, _ := e[0].(string)
		words, _ := e[1].([]any)
		c := Class{Pos: pos}
		for _, w := range words {
			if s, ok := w.(string); ok {
				c.Words = append(c.Words, s)
			}
		}
		if len(c.Words) > 0 {
			a.Classes = append(a.Classes, c)
		}
	}
	// [2]: the source language Google detected ("en"); null or another type leaves Source empty
	if len(top) > 2 {
		json.Unmarshal(top[2], &a.Source)
	}
	return a, nil
}

func dechunk(b []byte) ([]byte, error) {
	var out []byte
	for {
		// the last size line, 0, may end the dump with no newline after it
		line, rest, _ := bytes.Cut(b, []byte("\n"))
		n, err := strconv.ParseInt(string(bytes.TrimSpace(line)), 16, 64)
		if err != nil || n < 0 || n > int64(len(rest)) {
			return nil, fmt.Errorf("unreadable answer: bad chunk size %q", bytes.TrimSpace(line))
		}
		if n == 0 {
			return out, nil
		}
		out = append(out, rest[:n]...)
		b = bytes.TrimLeft(rest[n:], "\r\n")
	}
}
