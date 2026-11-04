// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package canvasserve serves design-local canvas folders over wavesrv's web listener, so no agent has
// to run a server of its own. A board loads in an iframe, which cannot send arcterm's auth header, so a
// folder is reached through an unguessable token in the path instead.
package canvasserve

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync"

	"github.com/wavetermdev/waveterm/pkg/htmlserve"
)

// PathPrefix is the route the handler is mounted at.
const PathPrefix = "/canvas/"

const (
	designDirName = "design"
	designParent  = ".superpowers"
	secretBytes   = 32
	tokenHexLen   = 32
)

var (
	mu     sync.Mutex
	secret []byte
	roots  = map[string]string{} // token -> design dir
)

// only ever a design-local root, never an arbitrary folder
func validateDesignDir(dir string) (string, error) {
	if !filepath.IsAbs(dir) {
		return "", fmt.Errorf("%s is not an absolute path", dir)
	}
	// resolved first, so a link named like a design folder cannot stand in for one
	clean, err := filepath.EvalSymlinks(dir)
	if err != nil {
		return "", fmt.Errorf("reading %s: %w", dir, err)
	}
	if filepath.Base(clean) != designDirName || filepath.Base(filepath.Dir(clean)) != designParent {
		return "", fmt.Errorf("%s is not a %s/%s folder", dir, designParent, designDirName)
	}
	info, err := os.Stat(clean)
	if err != nil {
		return "", fmt.Errorf("reading %s: %w", dir, err)
	}
	if !info.IsDir() {
		return "", fmt.Errorf("%s is not a folder", dir)
	}
	return clean, nil
}

// Register makes a design folder servable and returns the URL path it is served under. The token is
// derived from the folder, so registering it again returns the same path for the life of the process.
func Register(dir string) (string, error) {
	clean, err := validateDesignDir(dir)
	if err != nil {
		return "", err
	}
	mu.Lock()
	defer mu.Unlock()
	if secret == nil {
		s := make([]byte, secretBytes)
		if _, err := rand.Read(s); err != nil {
			return "", fmt.Errorf("making the canvas secret: %w", err)
		}
		secret = s
	}
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(clean))
	token := hex.EncodeToString(mac.Sum(nil))[:tokenHexLen]
	roots[token] = clean
	return PathPrefix + token, nil
}

func rootFor(token string) (string, bool) {
	mu.Lock()
	defer mu.Unlock()
	dir, ok := roots[token]
	return dir, ok
}

// Handler serves the registered folders at PathPrefix + <token> + "/". An unknown token is a 404, the
// same answer a missing file gets.
func Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token, _, _ := strings.Cut(strings.TrimPrefix(r.URL.Path, PathPrefix), "/")
		dir, ok := rootFor(token)
		if !ok {
			http.NotFound(w, r)
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		// a board is edited between loads, so every load revalidates against the file's Last-Modified
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Content-Security-Policy", htmlserve.CSP)
		rel := strings.TrimPrefix(r.URL.Path, PathPrefix+token)
		if isHTMLName(rel) {
			serveBoard(w, r, http.Dir(dir), rel)
			return
		}
		http.StripPrefix(PathPrefix+token, http.FileServer(http.Dir(dir))).ServeHTTP(w, r)
	})
}

func isHTMLName(name string) bool {
	ext := strings.ToLower(path.Ext(name))
	return ext == ".html" || ext == ".htm"
}

// serveBoard serves a page with heightScript after it. http.Dir keeps rel inside the folder, as the FileServer
// every other file goes through does.
func serveBoard(w http.ResponseWriter, r *http.Request, dir http.Dir, rel string) {
	f, err := dir.Open(rel)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer f.Close()
	info, err := f.Stat()
	ra, ok := f.(io.ReaderAt)
	if err != nil || info.IsDir() || !ok {
		http.NotFound(w, r)
		return
	}
	http.ServeContent(w, r, info.Name(), info.ModTime(), htmlserve.WithSuffix(ra, info.Size(), heightScript))
}

// heightScript goes after every board page served, so arcterm can draw the board as tall as its page: the page runs at
// this listener's origin, which arcterm's window cannot reach into, so it reports its own height to the frame's parent
// (frontend canvasHeightReport) when it loads and each time it changes size (images, fonts, a section shown). After
// </html> the parser still runs it, as part of the body. A page whose own Content-Security-Policy refuses inline
// scripts keeps the height canvas.json gives it.
const heightScript = `<script>(function () {
  var p = window.parent;
  if (p === window) return;
  var last = 0, raf = 0;
  function report() {
    raf = 0;
    var b = document.body;
    var h = Math.ceil(Math.max(document.documentElement.scrollHeight, b ? b.scrollHeight : 0));
    if (h === last) return;
    last = h;
    p.postMessage({ type: "arc-canvas-height", h: h }, "*");
  }
  function soon() { if (!raf) raf = requestAnimationFrame(report); }
  addEventListener("load", soon);
  if (window.ResizeObserver) {
    var ro = new ResizeObserver(soon);
    ro.observe(document.documentElement);
    if (document.body) ro.observe(document.body);
  }
  soon();
})();</script>
`
