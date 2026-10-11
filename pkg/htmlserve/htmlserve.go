// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package htmlserve serves the folder of an HTML file being previewed over wavesrv's web listener, so the
// page's relative images, styles and scripts load beside it. The preview is an iframe, which cannot send
// arcterm's auth header, so a folder is reached through an unguessable token in the path instead, as
// canvasserve does for design boards.
package htmlserve

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// PathPrefix is the route the handler is mounted at.
const PathPrefix = "/html-preview/"

const (
	secretBytes = 32
	tokenHexLen = 32
)

var (
	mu     sync.Mutex
	secret []byte
	roots  = map[string]string{} // token -> folder of a previewed page
)

// only ever an HTML file, so a token is never handed out for a folder nobody asked to preview
func validateHTMLFile(path string) (string, error) {
	if !filepath.IsAbs(path) {
		return "", fmt.Errorf("%s is not an absolute path", path)
	}
	// resolved first, so a link named like a page cannot stand in for one
	clean, err := filepath.EvalSymlinks(path)
	if err != nil {
		return "", fmt.Errorf("reading %s: %w", path, err)
	}
	ext := strings.ToLower(filepath.Ext(clean))
	if ext != ".html" && ext != ".htm" {
		return "", fmt.Errorf("%s is not an HTML file", path)
	}
	info, err := os.Stat(clean)
	if err != nil {
		return "", fmt.Errorf("reading %s: %w", path, err)
	}
	if info.IsDir() {
		return "", fmt.Errorf("%s is a folder", path)
	}
	return clean, nil
}

// Register makes an HTML file's folder servable and returns the URL path the file is served at. The token
// is derived from the folder, so every page in it shares one path for the life of the process.
func Register(path string) (string, error) {
	clean, err := validateHTMLFile(path)
	if err != nil {
		return "", err
	}
	dir := filepath.Dir(clean)
	mu.Lock()
	defer mu.Unlock()
	if secret == nil {
		s := make([]byte, secretBytes)
		if _, err := rand.Read(s); err != nil {
			return "", fmt.Errorf("making the preview secret: %w", err)
		}
		secret = s
	}
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(dir))
	token := hex.EncodeToString(mac.Sum(nil))[:tokenHexLen]
	roots[token] = dir
	return PathPrefix + token + "/" + url.PathEscape(filepath.Base(clean)), nil
}

func rootFor(token string) (string, bool) {
	mu.Lock()
	defer mu.Unlock()
	dir, ok := roots[token]
	return dir, ok
}

// a dot-named file or folder (.env, .git) is never served: a page has no business reading one
func hasHiddenSegment(rel string) bool {
	for _, seg := range strings.Split(rel, "/") {
		if strings.HasPrefix(seg, ".") {
			return true
		}
	}
	return false
}

// Handler serves the registered folders at PathPrefix + <token> + "/", files only: an unknown token, a
// folder and a hidden file all get the 404 a missing file gets.
func Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token, rel, _ := strings.Cut(strings.TrimPrefix(r.URL.Path, PathPrefix), "/")
		dir, ok := rootFor(token)
		if !ok || rel == "" || hasHiddenSegment(rel) {
			http.NotFound(w, r)
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		// served directly rather than through http.FileServer, which redirects a request for index.html to its
		// folder (a 404 here) and lists folders
		f, err := os.Open(filepath.Join(dir, filepath.FromSlash(rel)))
		if err != nil {
			http.NotFound(w, r)
			return
		}
		defer f.Close()
		info, err := f.Stat()
		if err != nil || info.IsDir() {
			http.NotFound(w, r)
			return
		}
		// a page is edited between loads, so every load revalidates against the file's Last-Modified
		w.Header().Set("Cache-Control", "no-cache")
		http.ServeContent(w, r, info.Name(), info.ModTime(), f)
	})
}
