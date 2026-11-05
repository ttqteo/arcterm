// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package translate

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// fakeMyMemory points MyMemory at a server answering status and body, and records the query it was sent
func fakeMyMemory(t *testing.T, status int, body string) *string {
	t.Helper()
	var got string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = r.URL.RawQuery
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)
	old := myMemoryURL
	myMemoryURL = srv.URL
	t.Cleanup(func() { myMemoryURL = old })
	return &got
}

func TestMyMemory_answer(t *testing.T) {
	// cut down from a live answer for "drift", en|vi
	q := fakeMyMemory(t, 200, `{"responseData":{"translatedText":"trôi &#39;dạt&#39;","match":0.99},"quotaFinished":false,"responseDetails":"","responseStatus":200}`)
	a, err := MyMemory(context.Background(), "en", "vi", "drift")
	if err != nil || a.Translation != "trôi 'dạt'" || a.Source != "" {
		t.Fatalf("got %+v, %v", a, err)
	}
	if !strings.Contains(*q, "langpair=en%7Cvi") || !strings.Contains(*q, "q=drift") {
		t.Errorf("query %q", *q)
	}
}

func TestMyMemory_detects(t *testing.T) {
	q := fakeMyMemory(t, 200, `{"responseData":{"translatedText":"שלום","detectedLanguage":"en-US"},"quotaFinished":false,"responseStatus":200}`)
	a, err := MyMemory(context.Background(), "auto", "iw", "hello")
	if err != nil || a.Source != "en" {
		t.Fatalf("got %+v, %v", a, err)
	}
	// "auto" and Google's iw go out in MyMemory's form
	if !strings.Contains(*q, "langpair=autodetect%7Che") {
		t.Errorf("query %q", *q)
	}
}

func TestMyMemory_detectedCodes(t *testing.T) {
	for in, want := range map[string]string{"en": "en", "en-GB": "en", "zh-CN": "zh-CN", "zh-TW": "zh-TW", "he": "iw", "jv": "jw"} {
		if got := googleCodeFromMyMemory(in); got != want {
			t.Errorf("%s: %s, want %s", in, got, want)
		}
	}
}

func TestMyMemory_quota(t *testing.T) {
	fakeMyMemory(t, 200, `{"responseData":{"translatedText":"MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY."},"quotaFinished":true,"responseStatus":429}`)
	if _, err := MyMemory(context.Background(), "en", "vi", "x"); err == nil || !strings.Contains(err.Error(), "used up") {
		t.Fatalf("err = %v", err)
	}
}

func TestMyMemory_statusInBody(t *testing.T) {
	// some errors carry the status as a string, with the reason in responseDetails
	fakeMyMemory(t, 200, `{"responseData":{"translatedText":"INVALID LANGUAGE PAIR"},"responseDetails":"'XX' IS AN INVALID TARGET LANGUAGE","responseStatus":"403"}`)
	if _, err := MyMemory(context.Background(), "en", "xx", "x"); err == nil || !strings.Contains(err.Error(), "INVALID TARGET") {
		t.Fatalf("err = %v", err)
	}
}

func TestMyMemory_httpError(t *testing.T) {
	fakeMyMemory(t, 503, `<html>down</html>`)
	if _, err := MyMemory(context.Background(), "en", "vi", "x"); err == nil || !strings.Contains(err.Error(), "503") {
		t.Fatalf("err = %v", err)
	}
}

func TestMyMemory_tooLong(t *testing.T) {
	q := fakeMyMemory(t, 200, `{}`)
	if _, err := MyMemory(context.Background(), "en", "vi", strings.Repeat("ă", 251)); err == nil || !strings.Contains(err.Error(), "500 bytes") {
		t.Fatalf("err = %v", err)
	}
	if *q != "" {
		t.Error("asked MyMemory with text over its limit")
	}
}
