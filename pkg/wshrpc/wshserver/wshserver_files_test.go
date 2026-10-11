// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"encoding/base64"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func mkDir(t *testing.T, base, name string, age time.Duration) string {
	t.Helper()
	p := filepath.Join(base, name)
	if err := os.Mkdir(p, 0700); err != nil {
		t.Fatalf("mkdir %s: %v", name, err)
	}
	if age > 0 {
		old := time.Now().Add(-age)
		if err := os.Chtimes(p, old, old); err != nil {
			t.Fatalf("chtimes %s: %v", name, err)
		}
	}
	return p
}

func TestSweepTempAttachments(t *testing.T) {
	base := t.TempDir()
	retention := 24 * time.Hour

	stale := mkDir(t, base, tempAttachPrefix+"stale", 48*time.Hour)
	recent := mkDir(t, base, tempAttachPrefix+"recent", 0)
	socketDir := mkDir(t, base, "waveterm-1000", 48*time.Hour) // socket-dir style; wrong prefix, must survive
	unrelated := mkDir(t, base, "some-other-dir", 48*time.Hour)

	// regression: an attachment written and still within the read window must survive with its file
	recentFile := filepath.Join(recent, "note.txt")
	if err := os.WriteFile(recentFile, []byte("hi"), 0600); err != nil {
		t.Fatalf("write attachment file: %v", err)
	}

	sweepTempAttachments(base, retention)

	if _, err := os.Stat(stale); !os.IsNotExist(err) {
		t.Errorf("expected stale attachment dir removed, stat err=%v", err)
	}
	if _, err := os.Stat(recentFile); err != nil {
		t.Errorf("expected recent attachment (within retention) to survive, stat err=%v", err)
	}
	if _, err := os.Stat(socketDir); err != nil {
		t.Errorf("expected non-attachment waveterm-<uid> dir to survive, stat err=%v", err)
	}
	if _, err := os.Stat(unrelated); err != nil {
		t.Errorf("expected unrelated dir to survive, stat err=%v", err)
	}
}

func TestSweepTempAttachmentsMissingDir(t *testing.T) {
	// must not panic when the temp dir can't be read
	sweepTempAttachments(filepath.Join(t.TempDir(), "does-not-exist"), time.Hour)
}

func writeAged(t *testing.T, path string, age time.Duration) string {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		t.Fatalf("mkdir for %s: %v", path, err)
	}
	if err := os.WriteFile(path, []byte("png"), 0600); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
	old := time.Now().Add(-age)
	if err := os.Chtimes(path, old, old); err != nil {
		t.Fatalf("chtimes %s: %v", path, err)
	}
	return path
}

func exists(p string) bool {
	_, err := os.Stat(p)
	return err == nil
}

func TestSweepCanvasFeedback(t *testing.T) {
	root := t.TempDir()
	retention := 7 * 24 * time.Hour
	old := 8 * 24 * time.Hour
	fb := filepath.Join(root, ".superpowers", "design", "topic", "feedback")

	stale := writeAged(t, filepath.Join(fb, "001.png"), old)
	staleLong := writeAged(t, filepath.Join(fb, "1000.png"), old)
	recent := writeAged(t, filepath.Join(fb, "002.png"), time.Hour)
	// old, but not a name Send writes
	short := writeAged(t, filepath.Join(fb, "01.png"), old)
	named := writeAged(t, filepath.Join(fb, "notes.png"), old)
	text := writeAged(t, filepath.Join(fb, "003.txt"), old)
	// old and well named, but outside feedback/: the boards themselves must never be touched
	board := writeAged(t, filepath.Join(root, ".superpowers", "design", "topic", "project", "004.png"), old)
	if err := os.MkdirAll(filepath.Join(fb, "005.png"), 0700); err != nil {
		t.Fatal(err)
	}

	sweepCanvasFeedback([]string{root, filepath.Join(root, "no-such-project")}, retention)

	for _, p := range []string{stale, staleLong} {
		if exists(p) {
			t.Errorf("expected stale %s removed", filepath.Base(p))
		}
	}
	for _, p := range []string{recent, short, named, text, board, filepath.Join(fb, "005.png")} {
		if !exists(p) {
			t.Errorf("expected %s to survive", p)
		}
	}
}

func TestSweepCanvasFeedbackSkipsLinkedDir(t *testing.T) {
	root := t.TempDir()
	elsewhere := t.TempDir()
	target := writeAged(t, filepath.Join(elsewhere, "001.png"), 30*24*time.Hour)
	topic := filepath.Join(root, ".superpowers", "design", "topic")
	if err := os.MkdirAll(topic, 0700); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(topic, "feedback")
	if err := os.Symlink(elsewhere, link); err != nil {
		// a symlink needs a privilege on Windows; a junction, the likelier link there, does not
		if runtime.GOOS != "windows" {
			t.Skipf("cannot create a symlink here: %v", err)
		}
		if out, err := exec.Command("cmd", "/c", "mklink", "/J", link, elsewhere).CombinedOutput(); err != nil {
			t.Skipf("cannot create a junction here: %v: %s", err, out)
		}
	}

	sweepCanvasFeedback([]string{root}, 7*24*time.Hour)

	if !exists(target) {
		t.Errorf("a feedback dir that is a link must not be swept")
	}
}

// A kept file goes under ~/.arc/attachments, in a dir of its own named by the day, where no temp sweep looks; a plain
// one still goes to the OS temp dir under the prefix the sweep owns.
func TestWriteTempFileKeep(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	data64 := base64.StdEncoding.EncodeToString([]byte("png"))
	kept, err := (&WshServer{}).WriteTempFileCommand(context.Background(), wshrpc.CommandWriteTempFileData{FileName: "shot.png", Data64: data64, Keep: true})
	if err != nil {
		t.Fatal(err)
	}
	dir := filepath.Dir(kept)
	if filepath.Dir(dir) != filepath.Join(home, ".arc", "attachments") || !strings.HasPrefix(filepath.Base(dir), time.Now().Format("2006-01-02")+"-") {
		t.Fatalf("kept at %s, want ~/.arc/attachments/<day>-*/shot.png", kept)
	}
	if b, err := os.ReadFile(kept); err != nil || string(b) != "png" {
		t.Fatalf("read %q, %v", b, err)
	}
	temp, err := (&WshServer{}).WriteTempFileCommand(context.Background(), wshrpc.CommandWriteTempFileData{FileName: "shot.png", Data64: data64})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(filepath.Dir(temp)) })
	if !strings.HasPrefix(filepath.Base(filepath.Dir(temp)), tempAttachPrefix) || strings.HasPrefix(temp, home) {
		t.Fatalf("a plain temp file at %s, want the OS temp dir under %s", temp, tempAttachPrefix)
	}
}
