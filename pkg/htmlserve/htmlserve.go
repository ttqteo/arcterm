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
	"io"
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
	if !isHTMLName(clean) {
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

// cdns are the hosts a previewed page may load code and styles from: the design runtime's React and Babel come from
// unpkg, and pages commonly take libraries from the others and fonts from Google Fonts.
const cdns = "https://unpkg.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://esm.sh " +
	"https://cdn.tailwindcss.com https://code.jquery.com"

// CSP goes with every file a preview serves (and canvasserve's boards). A page is written by an agent, or by a skill
// someone else wrote, and runs at wavesrv's origin, so it may not send what it holds to a host of its own: fetch,
// XHR, WebSocket and beacons reach only its own folder and the CDNs, forms post nowhere, frames and workers load
// only from the folder. Inline scripts and eval stay allowed, since the scroll and height scripts are inline and
// the design runtime compiles boards with Babel. Images and media still load from any https host, so a page that
// shows a remote photo keeps working; that leaves a page able to name a URL it requests, as it can by navigating
// itself, which no policy blocks.
const CSP = "default-src 'self' data: blob:; " +
	"script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: " + cdns + "; " +
	"style-src 'self' 'unsafe-inline' " + cdns + " https://fonts.googleapis.com; " +
	"font-src 'self' data: " + cdns + " https://fonts.gstatic.com; " +
	"img-src 'self' data: blob: https:; " +
	"media-src 'self' data: blob: https:; " +
	"connect-src 'self' data: blob: " + cdns + "; " +
	"frame-src 'self' data: blob:; " +
	"worker-src 'self' blob:; " +
	"object-src 'none'; " +
	"base-uri 'self'; " +
	"form-action 'none'"

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
		w.Header().Set("Content-Security-Policy", CSP)
		if !isHTMLName(info.Name()) {
			http.ServeContent(w, r, info.Name(), info.ModTime(), f)
			return
		}
		http.ServeContent(w, r, info.Name(), info.ModTime(), WithSuffix(f, info.Size(), scrollScript))
	})
}

func isHTMLName(name string) bool {
	ext := strings.ToLower(filepath.Ext(name))
	return ext == ".html" || ext == ".htm"
}

// scrollScript goes after every page served, so a preview left for another file or surface reopens where the reader
// was. The page runs at this listener's origin, which arcterm's window cannot reach into, so the page reports its own
// scroll to the frame's parent and takes a kept one back (frontend htmlframe.tsx). After </html> the parser still runs
// it, as part of the body. A restore waits for the page to grow tall enough (images, fonts) for about half a second,
// and gives way to the reader's first wheel, key or click. The File tab's Top button sends arc-html-top. A page whose
// own Content-Security-Policy refuses inline scripts simply opens at the top.
const scrollScript = `<script>(function () {
  var p = window.parent;
  if (p === window) return;
  var raf = 0;
  addEventListener("scroll", function () {
    if (raf) return;
    raf = requestAnimationFrame(function () {
      raf = 0;
      p.postMessage({ type: "arc-html-scroll", y: Math.round(scrollY) }, "*");
    });
  }, { passive: true });
  addEventListener("message", function (e) {
    var d = e.data;
    if (e.source !== p || !d) return;
    if (d.type === "arc-html-top") { scrollTo({ top: 0, behavior: "smooth" }); return; }
    if (d.type !== "arc-html-restore" || !(d.y > 0)) return;
    var n = 0, stop = false;
    var halt = function () { stop = true; };
    addEventListener("wheel", halt, { once: true, passive: true });
    addEventListener("keydown", halt, { once: true });
    addEventListener("pointerdown", halt, { once: true });
    (function step() {
      if (stop) return;
      var el = document.scrollingElement || document.documentElement;
      if (el.scrollHeight - innerHeight >= d.y || ++n >= 30) { scrollTo(0, d.y); return; }
      requestAnimationFrame(step);
    })();
  });
})();</script>
`

// WithSuffix reads as a file of size bytes with suffix after it, for http.ServeContent's ranges and length. It
// streams from the file, never reads it whole: an exported deck can run to tens of MB.
func WithSuffix(f io.ReaderAt, size int64, suffix string) *io.SectionReader {
	page := withSuffix{f: f, size: size, suffix: []byte(suffix)}
	return io.NewSectionReader(page, 0, page.len())
}

type withSuffix struct {
	f      io.ReaderAt
	size   int64
	suffix []byte
}

func (s withSuffix) len() int64 {
	return s.size + int64(len(s.suffix))
}

func (s withSuffix) ReadAt(p []byte, off int64) (int, error) {
	n := 0
	if off < s.size {
		k := min(int64(len(p)), s.size-off)
		m, err := s.f.ReadAt(p[:k], off)
		n = m
		if int64(m) < k {
			// the file shrank under the read
			if err == nil || err == io.EOF {
				err = io.ErrUnexpectedEOF
			}
			return n, err
		}
	}
	if n < len(p) {
		i := off + int64(n) - s.size
		if i < int64(len(s.suffix)) {
			n += copy(p[n:], s.suffix[i:])
		}
	}
	if n < len(p) {
		return n, io.EOF
	}
	return n, nil
}
