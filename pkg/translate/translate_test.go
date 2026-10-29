// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package translate

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
)

// the shape of Google's answer for "gold" into Vietnamese, as trans -dump prints it, cut down
const goldJSON = `[[["vàng","gold",null,null,10],[null,null,null,"ɡōld"]],[["noun",["kim","màu vàng","tiền vàng","vàng"],[["kim",["gold"],null,0.001],["màu vàng",["gold","amber","aurora"]]],"gold",1],["adjective",["hoàng kim"],[["hoàng kim",["gold"]]],"gold",3]],"en",null,null,[["gold",null,[["vàng",null,true,false,[10]]]]]]`

var goldAnswer = Answer{
	Translation: "vàng",
	Source:      "en",
	Phonetics:   "ɡōld",
	Classes: []Class{
		{Pos: "noun", Words: []string{"kim", "màu vàng", "tiền vàng", "vàng"}},
		{Pos: "adjective", Words: []string{"hoàng kim"}},
	},
}

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

func TestParse_word(t *testing.T) {
	for name, raw := range map[string]string{
		"plain":            goldJSON + "\n",
		"one chunk":        chunked(goldJSON, 4096),
		"chunks of 40":     chunked(goldJSON, 40), // cuts inside a multi-byte rune too
		"no trailing line": strings.TrimRight(chunked(goldJSON, 4096), "\r\n"),
	} {
		got, err := Parse([]byte(raw))
		if err != nil {
			t.Errorf("%s: %v", name, err)
			continue
		}
		if !reflect.DeepEqual(got, goldAnswer) {
			t.Errorf("%s: got %+v", name, got)
		}
	}
}

func TestParse_sentence(t *testing.T) {
	raw := chunked(`[[["Chào thế giới. ","hello world.",null,null,10],["Bạn khỏe không?","how are you?",null,null,10]],null,"en"]`, 4096)
	got, err := Parse([]byte(raw))
	if err != nil {
		t.Fatal(err)
	}
	want := Answer{Translation: "Chào thế giới. Bạn khỏe không?", Source: "en"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v", got)
	}
}

func TestParse_noSource(t *testing.T) {
	for name, raw := range map[string]string{
		"missing": `[[["vàng","gold",null,null,10]]]`,
		"null":    `[[["vàng","gold",null,null,10]],null,null]`,
		"number":  `[[["vàng","gold",null,null,10]],null,7]`,
	} {
		got, err := Parse([]byte(raw))
		if err != nil {
			t.Errorf("%s: %v", name, err)
			continue
		}
		if got.Translation != "vàng" || got.Source != "" {
			t.Errorf("%s: got %+v", name, got)
		}
	}
}

func TestParse_unreadable(t *testing.T) {
	for _, raw := range []string{"zz\r\n[]\r\n0\r\n", "ff\r\n[[\r\n0\r\n", "<html>blocked</html>"} {
		if _, err := Parse([]byte(raw)); err == nil {
			t.Errorf("%q: no error", raw)
		}
	}
}

// googleAt points Google at a test server for the test and counts the requests it takes.
func googleAt(t *testing.T, h http.HandlerFunc) *atomic.Int32 {
	t.Helper()
	var n atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n.Add(1)
		h(w, r)
	}))
	old := googleURL
	googleURL = srv.URL
	t.Cleanup(func() {
		googleURL = old
		srv.Close()
	})
	return &n
}

func TestGoogle_query(t *testing.T) {
	var got http.Request
	googleAt(t, func(w http.ResponseWriter, r *http.Request) {
		got = *r
		w.Write([]byte(goldJSON))
	})
	a, err := Google(context.Background(), "auto", "vi", "gold & more")
	if err != nil {
		t.Fatal(err)
	}
	if got.Method != http.MethodGet {
		t.Errorf("method %s", got.Method)
	}
	q := got.URL.Query()
	for key, want := range map[string]string{"client": "gtx", "sl": "auto", "tl": "vi", "q": "gold & more"} {
		if v := q.Get(key); v != want {
			t.Errorf("%s = %q, want %q", key, v, want)
		}
	}
	if !reflect.DeepEqual(q["dt"], []string{"t", "rm", "bd"}) {
		t.Errorf("dt = %v", q["dt"])
	}
	if !reflect.DeepEqual(a, goldAnswer) {
		t.Errorf("got %+v", a)
	}
}

func TestGoogle_httpError(t *testing.T) {
	googleAt(t, func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "slow down", http.StatusTooManyRequests)
	})
	_, err := Google(context.Background(), "en", "vi", "gold")
	if err == nil || !strings.Contains(err.Error(), "429") {
		t.Fatalf("err = %v", err)
	}
}

func TestGoogle_unreadable(t *testing.T) {
	googleAt(t, func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("<html>blocked</html>"))
	})
	if _, err := Google(context.Background(), "en", "vi", "gold"); err == nil || !strings.Contains(err.Error(), "unreadable") {
		t.Fatalf("err = %v", err)
	}
}

func TestGoogle_unreachable(t *testing.T) {
	old := googleURL
	t.Cleanup(func() { googleURL = old })
	srv := httptest.NewServer(http.NotFoundHandler())
	googleURL = srv.URL
	srv.Close() // nothing listens there now
	if _, err := Google(context.Background(), "en", "vi", "gold"); err == nil || !strings.Contains(err.Error(), "reach Google") {
		t.Fatalf("err = %v", err)
	}
}

func TestGoogle_tooLong(t *testing.T) {
	n := googleAt(t, func(w http.ResponseWriter, r *http.Request) { w.Write([]byte(goldJSON)) })
	// 5,000 characters is the limit, in characters rather than bytes: "à" is two bytes
	if _, err := Google(context.Background(), "en", "vi", strings.Repeat("à", MaxChars)); err != nil {
		t.Fatalf("5,000 characters: %v", err)
	}
	n.Store(0)
	_, err := Google(context.Background(), "en", "vi", strings.Repeat("a", MaxChars+1))
	if err == nil || !strings.Contains(err.Error(), "5000") {
		t.Fatalf("err = %v", err)
	}
	if n.Load() != 0 {
		t.Errorf("%d requests for text that is too long", n.Load())
	}
}

func TestGoogle_empty(t *testing.T) {
	n := googleAt(t, func(w http.ResponseWriter, r *http.Request) { w.Write([]byte(goldJSON)) })
	for _, text := range []string{"", "  \n\t"} {
		a, err := Google(context.Background(), "auto", "vi", text)
		if err != nil || !reflect.DeepEqual(a, Answer{}) {
			t.Errorf("%q: %+v, %v", text, a, err)
		}
	}
	if n.Load() != 0 {
		t.Errorf("%d requests for empty text", n.Load())
	}
}
