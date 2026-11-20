// pkg/gitinfo/patch_test.go
package gitinfo

import (
	"context"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

func getPatch(t *testing.T, cwd, ref string, ignoreWs bool) *Patch {
	t.Helper()
	return getPathPatch(t, cwd, ref, "", ignoreWs)
}

func getPathPatch(t *testing.T, cwd, ref, path string, ignoreWs bool) *Patch {
	t.Helper()
	p, err := GetPatch(context.Background(), cwd, ref, "", path, ignoreWs)
	if err != nil {
		t.Fatal(err)
	}
	return p
}

// fileSections splits a patch into its per-file sections, keyed by the diff --git line.
func fileSections(patch string) map[string]string {
	out := map[string]string{}
	var key string
	for _, line := range strings.Split(patch, "\n") {
		if strings.HasPrefix(line, "diff --git ") {
			key = line
			out[key] = ""
		}
		if key != "" {
			out[key] += line + "\n"
		}
	}
	return out
}

func countLines(patch, prefix string) int {
	n := 0
	for _, line := range strings.Split(patch, "\n") {
		if strings.HasPrefix(line, prefix) {
			n++
		}
	}
	return n
}

func mkdir(t *testing.T, dir, name string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Join(dir, name), 0o755); err != nil {
		t.Fatal(err)
	}
}

// a modified, a staged new, a deleted and an untracked file, all under sub/, plus one change outside it
func repoWithEveryKind(t *testing.T) string {
	t.Helper()
	dir := initRepo(t)
	mkdir(t, dir, "sub")
	writeFile(t, dir, "sub/mod.txt", "one\ntwo\n")
	writeFile(t, dir, "sub/gone.txt", "bye\n")
	writeFile(t, dir, "outside.txt", "x\n")
	commitAll(t, dir)
	writeFile(t, dir, "sub/mod.txt", "one\ntwo\nthree\n")
	writeFile(t, dir, "sub/staged.txt", "s\n")
	gitRun(t, dir, "add", "sub/staged.txt")
	if err := os.Remove(filepath.Join(dir, "sub", "gone.txt")); err != nil {
		t.Fatal(err)
	}
	writeFile(t, dir, "sub/new.txt", "a\nb\n")
	writeFile(t, dir, "outside.txt", "y\n")
	return dir
}

func TestGetPatchListsEveryKindOnce(t *testing.T) {
	dir := repoWithEveryKind(t)
	cases := []struct {
		cwd   string
		paths []string
	}{
		{dir, []string{"sub/mod.txt", "sub/staged.txt", "sub/gone.txt", "sub/new.txt", "outside.txt"}},
		{filepath.Join(dir, "sub"), []string{"mod.txt", "staged.txt", "gone.txt", "new.txt"}},
	}
	for _, c := range cases {
		p := getPatch(t, c.cwd, "", false)
		if !p.IsRepo || p.Truncated {
			t.Fatalf("cwd %s: isrepo=%v truncated=%v", c.cwd, p.IsRepo, p.Truncated)
		}
		for _, path := range c.paths {
			header := "diff --git a/" + path + " b/" + path
			if n := countLines(p.Patch, header); n != 1 {
				t.Errorf("cwd %s: %q appears %d times, want 1\n%s", c.cwd, header, n, p.Patch)
			}
		}
		if n := countLines(p.Patch, "diff --git "); n != len(c.paths) {
			t.Errorf("cwd %s: %d file entries, want %d\n%s", c.cwd, n, len(c.paths), p.Patch)
		}
	}
}

func TestGetPatchUntrackedEntryIsGitsNewFileForm(t *testing.T) {
	dir := initRepo(t)
	writeFile(t, dir, "base.txt", "b\n")
	commitAll(t, dir)
	writeFile(t, dir, "new.txt", "a\nb\nc\n")
	p := getPatch(t, dir, "", false)
	sec := fileSections(p.Patch)["diff --git a/new.txt b/new.txt"]
	want := "diff --git a/new.txt b/new.txt\nnew file mode 100644\n--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1,3 @@\n+a\n+b\n+c\n"
	if !strings.HasPrefix(sec, want) {
		t.Fatalf("untracked entry =\n%s\nwant prefix\n%s", sec, want)
	}
	if n := countLines(sec, "@@ "); n != 1 {
		t.Errorf("%d hunks, want 1", n)
	}
}

// git status lists an untracked nested repo as one "nested/" entry, even with -uall
func TestGetPatchSkipsUntrackedNestedRepo(t *testing.T) {
	dir := initRepo(t)
	writeFile(t, dir, "base.txt", "b\n")
	commitAll(t, dir)
	mkdir(t, dir, "nested")
	gitRun(t, filepath.Join(dir, "nested"), "init", "-q")
	writeFile(t, dir, "nested/inner.txt", "i\n")
	writeFile(t, dir, "new.txt", "a\n")
	p := getPatch(t, dir, "", false)
	if _, ok := fileSections(p.Patch)["diff --git a/new.txt b/new.txt"]; !ok {
		t.Errorf("no entry for new.txt\n%s", p.Patch)
	}
	if strings.Contains(p.Patch, "nested") {
		t.Errorf("patch has an entry for nested\n%s", p.Patch)
	}
}

func TestGetPatchUntrackedWithoutFinalNewline(t *testing.T) {
	dir := initRepo(t)
	writeFile(t, dir, "base.txt", "b\n")
	commitAll(t, dir)
	writeFile(t, dir, "new.txt", "a\nb")
	sec := fileSections(getPatch(t, dir, "", false).Patch)["diff --git a/new.txt b/new.txt"]
	if !strings.Contains(sec, "@@ -0,0 +1,2 @@\n+a\n+b\n\\ No newline at end of file\n") {
		t.Fatalf("entry =\n%s", sec)
	}
}

func TestGetPatchHunkCarriesFunctionContext(t *testing.T) {
	dir := initRepo(t)
	body := "package x\n\nfunc Alpha() {\n\ta := 1\n\tb := 2\n\tc := 3\n\td := 4\n\te := 5\n\t_ = a + b + c + d + e\n}\n"
	writeFile(t, dir, "x.go", body)
	commitAll(t, dir)
	writeFile(t, dir, "x.go", strings.Replace(body, "e := 5", "e := 50", 1))
	p := getPatch(t, dir, "", false)
	if !regexp.MustCompile(`(?m)^@@ -\d+(,\d+)? \+\d+(,\d+)? @@ func Alpha\(\) \{$`).MatchString(p.Patch) {
		t.Fatalf("no hunk header carries the func line:\n%s", p.Patch)
	}
}

func TestGetPatchPathNarrowsToModifiedFile(t *testing.T) {
	dir := initRepo(t)
	body := "package x\n\nfunc Alpha() {\n\ta := 1\n\tb := 2\n\tc := 3\n\td := 4\n\te := 5\n\t_ = a + b + c + d + e\n}\n"
	writeFile(t, dir, "x.go", body)
	writeFile(t, dir, "other.txt", "o\n")
	commitAll(t, dir)
	writeFile(t, dir, "x.go", strings.Replace(body, "e := 5", "e := 50", 1))
	writeFile(t, dir, "other.txt", "o2\n")
	writeFile(t, dir, "new.txt", "n\n")
	p := getPathPatch(t, dir, "", "x.go", false)
	if p.Truncated || countLines(p.Patch, "diff --git ") != 1 {
		t.Fatalf("want one entry, truncated=%v\n%s", p.Truncated, p.Patch)
	}
	if !strings.HasPrefix(p.Patch, "diff --git a/x.go b/x.go\n") {
		t.Errorf("entry is not x.go:\n%s", p.Patch)
	}
	if !regexp.MustCompile(`(?m)^@@ -\d+(,\d+)? \+\d+(,\d+)? @@ func Alpha\(\) \{$`).MatchString(p.Patch) {
		t.Errorf("hunk lost git's function context:\n%s", p.Patch)
	}
}

func TestGetPatchPathNarrowsToUntrackedFile(t *testing.T) {
	dir := repoWithEveryKind(t)
	sub := filepath.Join(dir, "sub")
	p := getPathPatch(t, sub, "", "new.txt", false)
	want := "diff --git a/new.txt b/new.txt\nnew file mode 100644\n--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1,2 @@\n+a\n+b\n"
	if p.Patch != want {
		t.Fatalf("patch =\n%s\nwant\n%s", p.Patch, want)
	}
}

func TestGetPatchPathUnchangedFileIsEmpty(t *testing.T) {
	dir := repoWithEveryKind(t)
	writeFile(t, dir, "calm.txt", "c\n")
	gitRun(t, dir, "add", "calm.txt")
	gitRun(t, dir, "commit", "-q", "-m", "calm")
	p := getPathPatch(t, dir, "", "calm.txt", false)
	if p.Patch != "" || p.Truncated || !p.IsRepo {
		t.Fatalf("patch=%q truncated=%v isrepo=%v, want empty repo patch", p.Patch, p.Truncated, p.IsRepo)
	}
}

func TestGetPatchPathIsLiteralNotGlob(t *testing.T) {
	dir := initRepo(t)
	writeFile(t, dir, "a.txt", "1\n")
	writeFile(t, dir, "b.txt", "1\n")
	commitAll(t, dir)
	writeFile(t, dir, "a.txt", "2\n")
	writeFile(t, dir, "b.txt", "2\n")
	writeFile(t, dir, "u1.txt", "u\n")
	writeFile(t, dir, "u2.txt", "u\n")
	for _, glob := range []string{"*.txt", "[ab].txt", "u?.txt"} {
		if p := getPathPatch(t, dir, "", glob, false); p.Patch != "" {
			t.Errorf("path %q matched as a glob:\n%s", glob, p.Patch)
		}
	}
}

// fileHeaders lists a patch's file entries, one diff --git line each, in order.
func fileHeaders(patch string) []string {
	var headers []string
	for _, line := range strings.Split(patch, "\n") {
		if strings.HasPrefix(line, fileHeaderPrefix) {
			headers = append(headers, line)
		}
	}
	return headers
}

// without the literal magic git reads "[ab].txt" as a glob for a.txt and b.txt
func TestGetPatchPathFindsTrackedFileNamedLikeGlob(t *testing.T) {
	dir := initRepo(t)
	writeFile(t, dir, "[ab].txt", "1\n")
	writeFile(t, dir, "a.txt", "1\n")
	writeFile(t, dir, "b.txt", "1\n")
	commitAll(t, dir)
	writeFile(t, dir, "[ab].txt", "2\n")
	writeFile(t, dir, "a.txt", "2\n")
	writeFile(t, dir, "b.txt", "2\n")
	p := getPathPatch(t, dir, "", "[ab].txt", false)
	want := "diff --git a/[ab].txt b/[ab].txt"
	if got := fileHeaders(p.Patch); len(got) != 1 || got[0] != want {
		t.Fatalf("files = %q, want [%q]\n%s", got, want, p.Patch)
	}
	if !strings.Contains(p.Patch, "@@ -1 +1 @@\n-1\n+2\n") {
		t.Errorf("entry lacks its hunk:\n%s", p.Patch)
	}
}

func TestGetPatchPathFindsUntrackedFileNamedLikeGlob(t *testing.T) {
	dir := initRepo(t)
	writeFile(t, dir, "base.txt", "b\n")
	commitAll(t, dir)
	writeFile(t, dir, "[ab].txt", "u\n")
	writeFile(t, dir, "a.txt", "a\n")
	p := getPathPatch(t, dir, "", "[ab].txt", false)
	want := "diff --git a/[ab].txt b/[ab].txt\nnew file mode 100644\n--- /dev/null\n+++ b/[ab].txt\n@@ -0,0 +1,1 @@\n+u\n"
	if p.Patch != want {
		t.Fatalf("patch =\n%s\nwant\n%s", p.Patch, want)
	}
}

// main's ref..end range and this run's pathspec meet in one git call
func TestGetPatchPathNarrowsRange(t *testing.T) {
	dir := initRepo(t)
	writeFile(t, dir, "x.go", "package x\n")
	writeFile(t, dir, "y.go", "package y\n")
	commitAll(t, dir)
	base := gitRun(t, dir, "rev-parse", "HEAD")
	writeFile(t, dir, "x.go", "package x\n\nvar X = 1\n")
	writeFile(t, dir, "y.go", "package y\n\nvar Y = 1\n")
	commitAll(t, dir)
	end := gitRun(t, dir, "rev-parse", "HEAD")
	cases := []struct {
		path string
		want []string
	}{
		{"x.go", []string{"diff --git a/x.go b/x.go"}},
		{"", []string{"diff --git a/x.go b/x.go", "diff --git a/y.go b/y.go"}},
	}
	for _, c := range cases {
		p, err := GetPatch(context.Background(), dir, base, end, c.path, false)
		if err != nil {
			t.Fatal(err)
		}
		if got := fileHeaders(p.Patch); strings.Join(got, "|") != strings.Join(c.want, "|") {
			t.Errorf("path %q: files = %q, want %q", c.path, got, c.want)
		}
	}
}

func TestGetPatchRefIncludesCommittedSince(t *testing.T) {
	dir := initRepo(t)
	writeFile(t, dir, "a.txt", "1\n")
	commitAll(t, dir)
	base := gitRun(t, dir, "rev-parse", "HEAD")
	writeFile(t, dir, "later.txt", "2\n")
	commitAll(t, dir)
	header := "diff --git a/later.txt b/later.txt"
	if n := countLines(getPatch(t, dir, base, false).Patch, header); n != 1 {
		t.Errorf("with ref: %q appears %d times, want 1", header, n)
	}
	if n := countLines(getPatch(t, dir, "", false).Patch, header); n != 0 {
		t.Errorf("without ref: %q appears %d times, want 0", header, n)
	}
}

// an agent's edits range: only ref..end, never what else sits in the working tree
func TestGetPatchEndBoundsToRange(t *testing.T) {
	dir := initRepo(t)
	writeFile(t, dir, "other.txt", "1\n")
	commitAll(t, dir)
	base := gitRun(t, dir, "rev-parse", "HEAD")
	writeFile(t, dir, "mine.txt", "2\n")
	commitAll(t, dir)
	end := gitRun(t, dir, "rev-parse", "HEAD")
	writeFile(t, dir, "other.txt", "changed\n")
	writeFile(t, dir, "stray.txt", "untracked\n")
	p, err := GetPatch(context.Background(), dir, base, end, "", false)
	if err != nil {
		t.Fatal(err)
	}
	var headers []string
	for _, line := range strings.Split(p.Patch, "\n") {
		if strings.HasPrefix(line, fileHeaderPrefix) {
			headers = append(headers, line)
		}
	}
	if want := []string{"diff --git a/mine.txt b/mine.txt"}; strings.Join(headers, "|") != strings.Join(want, "|") {
		t.Errorf("files = %q, want %q", headers, want)
	}
}

func TestGetPatchIgnoreWs(t *testing.T) {
	dir := initRepo(t)
	writeFile(t, dir, "a.txt", "one\ntwo\n")
	commitAll(t, dir)
	writeFile(t, dir, "a.txt", "one\n  two\n")
	if n := countLines(getPatch(t, dir, "", false).Patch, "@@ "); n != 1 {
		t.Errorf("without ignorews: %d hunks, want 1", n)
	}
	if n := countLines(getPatch(t, dir, "", true).Patch, "@@ "); n != 0 {
		t.Errorf("with ignorews: %d hunks, want 0", n)
	}
}

func TestGetPatchBinary(t *testing.T) {
	dir := initRepo(t)
	writeFile(t, dir, "tracked.bin", "a\x00b")
	commitAll(t, dir)
	writeFile(t, dir, "tracked.bin", "a\x00c")
	writeFile(t, dir, "untracked.bin", "x\x00y")
	p := getPatch(t, dir, "", false)
	for _, want := range []string{
		"Binary files a/tracked.bin and b/tracked.bin differ",
		"Binary files /dev/null and b/untracked.bin differ",
	} {
		if !strings.Contains(p.Patch, want+"\n") {
			t.Errorf("missing %q in\n%s", want, p.Patch)
		}
	}
	if sec := fileSections(p.Patch)["diff --git a/untracked.bin b/untracked.bin"]; strings.Contains(sec, "@@") {
		t.Errorf("binary entry has a hunk:\n%s", sec)
	}
}

// numbered lines totalling about n bytes, so a rewrite of one diffs every line
func bigText(n int, tag string) string {
	var b strings.Builder
	for i := 0; b.Len() < n; i++ {
		b.WriteString(tag)
		b.WriteString(strings.Repeat("x", 60))
		b.WriteString("\n")
	}
	return b.String()
}

func TestGetPatchCapCutsAtFileBoundary(t *testing.T) {
	dir := initRepo(t)
	writeFile(t, dir, "a_small.txt", "1\n")
	writeFile(t, dir, "b_big.txt", bigText(maxPatchBytes*2/3, "old"))
	commitAll(t, dir)
	writeFile(t, dir, "a_small.txt", "2\n")
	writeFile(t, dir, "b_big.txt", bigText(maxPatchBytes*2/3, "new"))
	writeFile(t, dir, "c_new.txt", "n\n")
	p := getPatch(t, dir, "", false)
	if !p.Truncated {
		t.Fatal("truncated = false, want true")
	}
	if len(p.Patch) > maxPatchBytes {
		t.Errorf("patch is %d bytes, over the cap", len(p.Patch))
	}
	if got := countLines(p.Patch, "diff --git "); got != 1 || !strings.HasPrefix(p.Patch, "diff --git a/a_small.txt b/a_small.txt\n") {
		t.Errorf("want only a_small.txt, got %d entries:\n%.300s", got, p.Patch)
	}
	if !strings.HasSuffix(p.Patch, "+2\n") {
		t.Errorf("patch does not end at the end of a_small.txt's entry:\n%s", p.Patch)
	}
}

func TestGetPatchCapCutsBetweenUntrackedFiles(t *testing.T) {
	dir := initRepo(t)
	writeFile(t, dir, "base.txt", "b\n")
	commitAll(t, dir)
	writeFile(t, dir, "a.txt", bigText(maxPatchBytes/2, "a"))
	writeFile(t, dir, "b.txt", bigText(maxPatchBytes/2, "b"))
	writeFile(t, dir, "c.txt", "c\n")
	p := getPatch(t, dir, "", false)
	if !p.Truncated {
		t.Fatal("truncated = false, want true")
	}
	if countLines(p.Patch, "diff --git a/a.txt b/a.txt") != 1 || countLines(p.Patch, "diff --git ") != 1 {
		t.Errorf("want only a.txt's entry, got %d entries", countLines(p.Patch, "diff --git "))
	}
}

func TestGetPatchBigUntrackedBinaryIsOneLine(t *testing.T) {
	dir := initRepo(t)
	writeFile(t, dir, "base.txt", "b\n")
	commitAll(t, dir)
	writeFile(t, dir, "a.bin", "\x00"+strings.Repeat("x", maxPatchBytes+1))
	writeFile(t, dir, "b.txt", "b\n")
	p := getPatch(t, dir, "", false)
	if p.Truncated {
		t.Fatal("truncated = true, want false")
	}
	if !strings.Contains(p.Patch, "Binary files /dev/null and b/a.bin differ\n") {
		t.Errorf("no binary line for a.bin:\n%.300s", p.Patch)
	}
	if !strings.Contains(p.Patch, "diff --git a/b.txt b/b.txt\n") || !strings.HasSuffix(p.Patch, "+b\n") {
		t.Errorf("b.txt's entry is missing:\n%.300s", p.Patch)
	}
}

// an agent's temp file can vanish between the status read and the file read
func TestUntrackedEntryVanishedFileIsSkipped(t *testing.T) {
	entry, tooBig, err := untrackedEntry(filepath.Join(t.TempDir(), "gone.txt"), "gone.txt", maxPatchBytes)
	if err != nil || tooBig || entry != "" {
		t.Fatalf("got entry=%q tooBig=%v err=%v, want a silent skip", entry, tooBig, err)
	}
}

func TestGetPatchNotARepo(t *testing.T) {
	p, err := GetPatch(context.Background(), t.TempDir(), "", "", "", false)
	if err != nil {
		t.Fatal(err)
	}
	if p.IsRepo || p.Patch != "" {
		t.Fatalf("got %+v, want isrepo false and no patch", p)
	}
}

func TestGetPatchNoCommitsReturnsUntracked(t *testing.T) {
	dir := initRepo(t)
	writeFile(t, dir, "a.txt", "a\n")
	p := getPatch(t, dir, "", false)
	if !p.IsRepo {
		t.Fatal("isrepo = false")
	}
	if n := countLines(p.Patch, "diff --git a/a.txt b/a.txt"); n != 1 {
		t.Fatalf("a.txt appears %d times, want 1:\n%s", n, p.Patch)
	}
}

func TestGetPatchUnknownRefErrorsWithStderr(t *testing.T) {
	dir := initRepo(t)
	writeFile(t, dir, "a.txt", "a\n")
	commitAll(t, dir)
	_, err := GetPatch(context.Background(), dir, "no-such-ref", "", "", false)
	if err == nil {
		t.Fatal("want an error for an unknown ref")
	}
	if !strings.Contains(err.Error(), "git ") || !strings.Contains(err.Error(), "no-such-ref") {
		t.Errorf("error %q names neither the command nor the ref", err)
	}
}
