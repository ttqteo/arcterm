package agentsessions

import (
	"fmt"
	"os"
	"sort"
	"strconv"
	"strings"
)

// PageOpts asks for one page of the session scan: newest first across every provider, resuming after the transcript
// a Cursor names.
type PageOpts struct {
	WindowDays  int    // 0 = every transcript on disk
	Limit       int    // sessions per page; <= 0 = no limit
	Cursor      string // Page.Next of the page before; "" = start at the newest
	Runtime     string // "" = every runtime; else only that provider's candidates are walked
	ProjectPath string // "" = every project; else normProjectPath(s.ProjectPath) == normProjectPath(ProjectPath)
	Query       string // "" = no filter; else strings.Contains(lower(s.Task), lower(trimmed Query))
}

// Page is one page of sessions and where the next one starts.
type Page struct {
	Sessions []SessionInfo
	Next     string // cursor of the last candidate read; "" when no candidate is left past this page
}

// ScanPage reads one page of sessions from the runtimes' transcript roots. The error is only for a malformed Cursor.
// The filters apply before the limit counts, so a page holds Limit matching sessions, not Limit sessions of which
// some match.
func ScanPage(opts PageOpts) (Page, error) {
	return scanPageFrom(allProviders(), opts, os.TempDir())
}

// candidateLess is the one order every page walks: transcript mtime descending, then path ascending. The path makes
// it total, so a cursor names exactly one position even where many files share an mtime.
func candidateLess(a, b candidate) bool {
	if !a.mtime.Equal(b.mtime) {
		return a.mtime.After(b.mtime)
	}
	return a.path < b.path
}

// cursorOf is the cursor that resumes the scan just after c.
func cursorOf(c candidate) string {
	return strconv.FormatInt(c.mtime.UnixNano(), 10) + "|" + c.path
}

// parseCursor reads a cursor cursorOf made.
func parseCursor(cur string) (mtimeNano int64, path string, err error) {
	ns, p, ok := strings.Cut(cur, "|")
	if !ok {
		return 0, "", fmt.Errorf("malformed session cursor %q", cur)
	}
	n, perr := strconv.ParseInt(ns, 10, 64)
	if perr != nil {
		return 0, "", fmt.Errorf("malformed session cursor %q", cur)
	}
	return n, p, nil
}

// normProjectPath is a project folder as the filter compares it: forward slashes, no trailing slash, lower case.
func normProjectPath(p string) string {
	p = strings.ReplaceAll(p, "\\", "/")
	p = strings.TrimRight(p, "/")
	return strings.ToLower(p)
}

func scanPageFrom(providers []provider, opts PageOpts, tempDir string) (Page, error) {
	var curNano int64
	var curPath string
	hasCursor := opts.Cursor != ""
	if hasCursor {
		var err error
		if curNano, curPath, err = parseCursor(opts.Cursor); err != nil {
			return Page{}, err
		}
	}
	var cands []candidate
	for _, p := range providers {
		if opts.Runtime != "" && p.runtime != opts.Runtime {
			continue
		}
		if p.beginScan != nil {
			p.beginScan()
		}
		cands = append(cands, walkCandidates(p, opts.WindowDays)...)
	}
	sort.Slice(cands, func(i, j int) bool { return candidateLess(cands[i], cands[j]) })
	if hasCursor {
		// the first candidate that comes after the cursor in the one order
		start := sort.Search(len(cands), func(i int) bool {
			n := cands[i].mtime.UnixNano()
			return n < curNano || (n == curNano && cands[i].path > curPath)
		})
		cands = cands[start:]
	}

	var keep func(*SessionInfo) bool
	project := normProjectPath(opts.ProjectPath)
	query := strings.ToLower(strings.TrimSpace(opts.Query))
	if project != "" || query != "" {
		keep = func(s *SessionInfo) bool {
			if project != "" && normProjectPath(s.ProjectPath) != project {
				return false
			}
			return query == "" || strings.Contains(strings.ToLower(s.Task), query)
		}
	}
	out, consumed := parseCandidates(cands, opts.Limit, tempDir, keep)
	sort.SliceStable(out, func(i, j int) bool { return out[i].LastActiveTs > out[j].LastActiveTs })
	page := Page{Sessions: out}
	if consumed > 0 && consumed < len(cands) {
		page.Next = cursorOf(cands[consumed-1])
	}
	return page, nil
}
