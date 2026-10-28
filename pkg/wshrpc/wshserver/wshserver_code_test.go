// pkg/wshrpc/wshserver/wshserver_code_test.go
package wshserver

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

var reviewNow = time.Date(2026, 10, 28, 9, 30, 15, 123_000_000, time.UTC)

func TestWriteReviewPathAndContent(t *testing.T) {
	root := t.TempDir()
	got, err := writeReview(root, "myproj", "# review\n- a\n", reviewNow)
	if err != nil {
		t.Fatal(err)
	}
	want := filepath.Join(root, "myproj", "20261028T093015.123Z.md")
	if got != want {
		t.Fatalf("path = %q, want %q", got, want)
	}
	b, err := os.ReadFile(got)
	if err != nil {
		t.Fatal(err)
	}
	if string(b) != "# review\n- a\n" {
		t.Fatalf("content = %q", b)
	}
}

func TestWriteReviewSanitizesProject(t *testing.T) {
	root := t.TempDir()
	got, err := writeReview(root, "../a b/c", "x", reviewNow)
	if err != nil {
		t.Fatal(err)
	}
	rel, err := filepath.Rel(root, got)
	if err != nil || strings.HasPrefix(rel, "..") {
		t.Fatalf("%q escapes root %q", got, root)
	}
	if parts := strings.Split(filepath.ToSlash(rel), "/"); len(parts) != 2 {
		t.Fatalf("rel = %q, want <project>/<file>", rel)
	}
}

func TestWriteReviewRejects(t *testing.T) {
	root := t.TempDir()
	if _, err := writeReview(root, "...", "x", reviewNow); err == nil {
		t.Error("a project that sanitizes to nothing must be an error")
	}
	if _, err := writeReview(root, "p", "", reviewNow); err == nil {
		t.Error("empty markdown must be an error")
	}
	if _, err := writeReview(root, "p", strings.Repeat("x", reviewMaxBytes+1), reviewNow); err == nil {
		t.Error("over-cap markdown must be an error")
	}
}

func TestWriteReviewPrunes(t *testing.T) {
	root := t.TempDir()
	other := filepath.Join(root, "other")
	if err := os.MkdirAll(other, 0o755); err != nil {
		t.Fatal(err)
	}
	old := filepath.Join(other, "old.md")
	recent := filepath.Join(other, "recent.md")
	for p, age := range map[string]time.Duration{old: 8 * 24 * time.Hour, recent: 6 * 24 * time.Hour} {
		if err := os.WriteFile(p, []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
		mt := reviewNow.Add(-age)
		if err := os.Chtimes(p, mt, mt); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := writeReview(root, "p", "x", reviewNow); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(old); !os.IsNotExist(err) {
		t.Errorf("8-day-old review should be pruned, stat err = %v", err)
	}
	if _, err := os.Stat(recent); err != nil {
		t.Errorf("6-day-old review should be kept: %v", err)
	}
}
