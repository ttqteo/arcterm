// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package canvasserve

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/htmlserve"
)

const boardBody = "<!doctype html><p>board</p>"

// a project with one topic's Main board, plus a file beside the design folder that must stay unreachable
func designDir(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	design := filepath.Join(root, ".superpowers", "design")
	project := filepath.Join(design, "topic", "project")
	if err := os.MkdirAll(project, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(project, "Main.dc.html"), []byte(boardBody), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(design, "topic", "canvas.json"), []byte(canvasJSON), 0o644); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"secret.txt", "secret.html"} {
		if err := os.WriteFile(filepath.Join(root, name), []byte("secret"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return design
}

const canvasJSON = `{"boards":{}}`

func get(t *testing.T, method, path string) *http.Response {
	t.Helper()
	rec := httptest.NewRecorder()
	Handler().ServeHTTP(rec, httptest.NewRequest(method, path, nil))
	return rec.Result()
}

func TestRegisterRefusesAnythingButADesignFolder(t *testing.T) {
	design := designDir(t)
	for name, dir := range map[string]string{
		"relative":       filepath.Join(".superpowers", "design"),
		"project root":   filepath.Dir(filepath.Dir(design)),
		"a topic folder": filepath.Join(design, "topic"),
		"missing":        filepath.Join(t.TempDir(), ".superpowers", "design"),
		"climbs out":     filepath.Join(design, "..", ".."),
	} {
		if _, err := Register(dir); err == nil {
			t.Errorf("%s: Register(%q) succeeded", name, dir)
		}
	}
}

func TestRegisterIsStablePerFolder(t *testing.T) {
	design := designDir(t)
	first, err := Register(design)
	if err != nil {
		t.Fatal(err)
	}
	again, err := Register(design + string(filepath.Separator))
	if err != nil {
		t.Fatal(err)
	}
	if first != again {
		t.Errorf("the same folder registered as %q then %q", first, again)
	}
	other, err := Register(designDir(t))
	if err != nil {
		t.Fatal(err)
	}
	if other == first {
		t.Errorf("two folders share the path %q", first)
	}
}

func TestHandlerServesARegisteredFolder(t *testing.T) {
	base, err := Register(designDir(t))
	if err != nil {
		t.Fatal(err)
	}
	res := get(t, http.MethodGet, base+"/topic/project/Main.dc.html")
	body, _ := io.ReadAll(res.Body)
	if res.StatusCode != http.StatusOK || string(body) != boardBody+heightScript {
		t.Fatalf("GET board: status %d body %q", res.StatusCode, body)
	}
	if res.Header.Get("Cache-Control") != "no-cache" {
		t.Errorf("Cache-Control %q, want no-cache", res.Header.Get("Cache-Control"))
	}
	if res.Header.Get("Last-Modified") == "" {
		t.Error("no Last-Modified header; the canvas poller reloads boards by it")
	}
	if !strings.HasPrefix(res.Header.Get("Content-Type"), "text/html") {
		t.Errorf("Content-Type %q, want text/html", res.Header.Get("Content-Type"))
	}
	if head := get(t, http.MethodHead, base+"/topic/project/Main.dc.html"); head.StatusCode != http.StatusOK {
		t.Errorf("HEAD board: status %d", head.StatusCode)
	}
	if got := res.Header.Get("Content-Security-Policy"); got != htmlserve.CSP {
		t.Errorf("board Content-Security-Policy %q, want htmlserve.CSP", got)
	}
}

func TestHandlerAddsTheHeightScriptToPagesOnly(t *testing.T) {
	base, err := Register(designDir(t))
	if err != nil {
		t.Fatal(err)
	}
	res := get(t, http.MethodGet, base+"/topic/canvas.json")
	body, _ := io.ReadAll(res.Body)
	if res.StatusCode != http.StatusOK || string(body) != canvasJSON {
		t.Errorf("GET canvas.json: status %d body %q", res.StatusCode, body)
	}
	// a range of a page still reads the file and the script after it as one
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, base+"/topic/project/Main.dc.html", nil)
	req.Header.Set("Range", "bytes=0-14")
	Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusPartialContent || rec.Body.String() != boardBody[:15] {
		t.Errorf("GET a range: status %d body %q", rec.Code, rec.Body.String())
	}
}

func TestHandlerRefusesWhatWasNotRegistered(t *testing.T) {
	base, err := Register(designDir(t))
	if err != nil {
		t.Fatal(err)
	}
	for name, tc := range map[string]struct {
		method, path string
		want         int
	}{
		"unknown token": {http.MethodGet, PathPrefix + "0123456789abcdef0123456789abcdef/topic/project/Main.dc.html", http.StatusNotFound},
		"no token":      {http.MethodGet, PathPrefix, http.StatusNotFound},
		"missing file":  {http.MethodGet, base + "/topic/project/Nope.dc.html", http.StatusNotFound},
		"write":         {http.MethodPost, base + "/topic/project/Main.dc.html", http.StatusMethodNotAllowed},
	} {
		if res := get(t, tc.method, tc.path); res.StatusCode != tc.want {
			t.Errorf("%s: status %d, want %d", name, res.StatusCode, tc.want)
		}
	}
}

func TestHandlerStaysInsideTheFolder(t *testing.T) {
	base, err := Register(designDir(t))
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{
		base + "/../../secret.txt",
		base + "/topic/../../../secret.txt",
		base + "/../../secret.html",
		base + "/topic/../../../secret.html",
	} {
		res := get(t, http.MethodGet, path)
		body, _ := io.ReadAll(res.Body)
		if res.StatusCode == http.StatusOK || strings.Contains(string(body), "secret") {
			t.Errorf("GET %s: status %d body %q", path, res.StatusCode, body)
		}
	}
}
