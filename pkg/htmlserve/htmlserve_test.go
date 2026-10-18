// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package htmlserve

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const pageBody = "<!doctype html><img src=\"img/a.png\">"

// a folder with a page, an image beside it, a hidden file and a subfolder, inside a parent holding a
// file that must stay unreachable
func pageDir(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	dir := filepath.Join(root, "slides")
	for rel, body := range map[string]string{
		"slide deck.html": pageBody,
		"index.html":      "<p>index</p>",
		"img/a.png":       "png",
		".env":            "SECRET=1",
		".git/config":     "[core]",
		"notes.txt":       "notes",
	} {
		p := filepath.Join(dir, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(root, "secret.txt"), []byte("secret"), 0o644); err != nil {
		t.Fatal(err)
	}
	return dir
}

func get(t *testing.T, method, path string) *http.Response {
	t.Helper()
	rec := httptest.NewRecorder()
	Handler().ServeHTTP(rec, httptest.NewRequest(method, path, nil))
	return rec.Result()
}

// the folder part of a page's served path: PathPrefix + token
func base(t *testing.T, page string) string {
	t.Helper()
	p, err := Register(page)
	if err != nil {
		t.Fatal(err)
	}
	return p[:strings.LastIndex(p, "/")]
}

func TestRegisterRefusesAnythingButAnHTMLFile(t *testing.T) {
	dir := pageDir(t)
	for name, path := range map[string]string{
		"relative": filepath.Join("slides", "slide deck.html"),
		"a folder": dir,
		"not html": filepath.Join(dir, "notes.txt"),
		"missing":  filepath.Join(dir, "nope.html"),
	} {
		if _, err := Register(path); err == nil {
			t.Errorf("%s: Register(%q) succeeded", name, path)
		}
	}
}

func TestRegisterServesTheFileInItsFolder(t *testing.T) {
	dir := pageDir(t)
	page, err := Register(filepath.Join(dir, "slide deck.html"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(page, PathPrefix) || !strings.HasSuffix(page, "/slide%20deck.html") {
		t.Fatalf("Register returned %q", page)
	}
	if other := base(t, filepath.Join(dir, "index.html")); !strings.HasPrefix(page, other+"/") {
		t.Errorf("two pages in one folder got different folders: %q and %q", page, other)
	}
	if other := base(t, filepath.Join(pageDir(t), "index.html")); strings.HasPrefix(page, other+"/") {
		t.Errorf("two folders share the path %q", other)
	}
}

func TestHandlerServesThePageAndWhatSitsBesideIt(t *testing.T) {
	dir := pageDir(t)
	page, err := Register(filepath.Join(dir, "slide deck.html"))
	if err != nil {
		t.Fatal(err)
	}
	res := get(t, http.MethodGet, page)
	body, _ := io.ReadAll(res.Body)
	if res.StatusCode != http.StatusOK || string(body) != pageBody+scrollScript {
		t.Fatalf("GET page: status %d body %q", res.StatusCode, body)
	}
	if !strings.HasPrefix(res.Header.Get("Content-Type"), "text/html") {
		t.Errorf("Content-Type %q, want text/html", res.Header.Get("Content-Type"))
	}
	if res.Header.Get("Last-Modified") == "" {
		t.Error("no Last-Modified header")
	}
	b := page[:strings.LastIndex(page, "/")]
	for _, rel := range []string{"/img/a.png", "/index.html", "/notes.txt"} {
		if res := get(t, http.MethodGet, b+rel); res.StatusCode != http.StatusOK {
			t.Errorf("GET %s: status %d", rel, res.StatusCode)
		}
	}
	if head := get(t, http.MethodHead, page); head.StatusCode != http.StatusOK {
		t.Errorf("HEAD page: status %d", head.StatusCode)
	}
}

func TestHandlerRefusesWhatWasNotRegistered(t *testing.T) {
	b := base(t, filepath.Join(pageDir(t), "index.html"))
	for name, tc := range map[string]struct {
		method, path string
		want         int
	}{
		"unknown token": {http.MethodGet, PathPrefix + "0123456789abcdef0123456789abcdef/index.html", http.StatusNotFound},
		"no token":      {http.MethodGet, PathPrefix, http.StatusNotFound},
		"the folder":    {http.MethodGet, b + "/", http.StatusNotFound},
		"a subfolder":   {http.MethodGet, b + "/img", http.StatusNotFound},
		"missing file":  {http.MethodGet, b + "/nope.html", http.StatusNotFound},
		"hidden file":   {http.MethodGet, b + "/.env", http.StatusNotFound},
		"hidden folder": {http.MethodGet, b + "/.git/config", http.StatusNotFound},
		"climbs out":    {http.MethodGet, b + "/../secret.txt", http.StatusNotFound},
		"escaped climb": {http.MethodGet, b + "/%2e%2e/secret.txt", http.StatusNotFound},
		"write":         {http.MethodPost, b + "/index.html", http.StatusMethodNotAllowed},
	} {
		if res := get(t, tc.method, tc.path); res.StatusCode != tc.want {
			t.Errorf("%s: status %d, want %d", name, res.StatusCode, tc.want)
		}
	}
}

func TestHandlerAddsTheScrollScriptToPagesOnly(t *testing.T) {
	dir := pageDir(t)
	b := base(t, filepath.Join(dir, "index.html"))
	res := get(t, http.MethodGet, b+"/index.html")
	body, _ := io.ReadAll(res.Body)
	if string(body) != "<p>index</p>"+scrollScript {
		t.Errorf("GET index.html: body %q", body)
	}
	if res.ContentLength != int64(len(body)) {
		t.Errorf("Content-Length %d for a %d-byte body", res.ContentLength, len(body))
	}
	for rel, want := range map[string]string{"/notes.txt": "notes", "/img/a.png": "png"} {
		body, _ := io.ReadAll(get(t, http.MethodGet, b+rel).Body)
		if string(body) != want {
			t.Errorf("GET %s: body %q, want %q", rel, body, want)
		}
	}
	// a range across the end of the file reads on into the script
	req := httptest.NewRequest(http.MethodGet, b+"/index.html", nil)
	req.Header.Set("Range", "bytes=8-20")
	rec := httptest.NewRecorder()
	Handler().ServeHTTP(rec, req)
	full := "<p>index</p>" + scrollScript
	if rec.Code != http.StatusPartialContent || rec.Body.String() != full[8:21] {
		t.Errorf("range: status %d body %q, want %q", rec.Code, rec.Body.String(), full[8:21])
	}
}

func TestWithSuffixReadsTheFileThenTheSuffix(t *testing.T) {
	s := withSuffix{f: strings.NewReader("abcdef"), size: 6, suffix: []byte("XYZ")}
	for _, tc := range []struct {
		off     int64
		n       int
		want    string
		wantEOF bool
	}{
		{0, 9, "abcdefXYZ", false},
		{0, 4, "abcd", false},
		{4, 4, "efXY", false},
		{6, 3, "XYZ", false},
		{7, 5, "YZ", true},
		{9, 2, "", true},
	} {
		p := make([]byte, tc.n)
		n, err := s.ReadAt(p, tc.off)
		if string(p[:n]) != tc.want || (err == io.EOF) != tc.wantEOF || (err != nil && err != io.EOF) {
			t.Errorf("ReadAt(%d bytes at %d) = %q, %v; want %q (EOF %v)", tc.n, tc.off, p[:n], err, tc.want, tc.wantEOF)
		}
	}
	short := withSuffix{f: strings.NewReader("abc"), size: 6, suffix: []byte("XYZ")}
	if _, err := short.ReadAt(make([]byte, 9), 0); err != io.ErrUnexpectedEOF {
		t.Errorf("a file shorter than its size: err %v, want io.ErrUnexpectedEOF", err)
	}
}
