package fileutil

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestAtomicWriteFile(t *testing.T) {
	tmpDir := t.TempDir()
	fileName := filepath.Join(tmpDir, "settings.json")

	err := AtomicWriteFile(fileName, []byte(`{"key":"value"}`), 0644)
	if err != nil {
		t.Fatalf("AtomicWriteFile failed: %v", err)
	}

	data, err := os.ReadFile(fileName)
	if err != nil {
		t.Fatalf("ReadFile failed: %v", err)
	}
	if string(data) != `{"key":"value"}` {
		t.Fatalf("unexpected file contents: %q", string(data))
	}
	if _, err := os.Stat(fileName + TempFileSuffix); !os.IsNotExist(err) {
		t.Fatalf("temporary file should not exist, stat err: %v", err)
	}
}

func TestAtomicWriteFileRenameErrorCleansTempFile(t *testing.T) {
	tmpDir := t.TempDir()
	fileName := filepath.Join(tmpDir, "settings.json")

	if err := os.Mkdir(fileName, 0755); err != nil {
		t.Fatalf("Mkdir failed: %v", err)
	}

	err := AtomicWriteFile(fileName, []byte(`{"key":"value"}`), 0644)
	if err == nil {
		t.Fatalf("AtomicWriteFile expected error")
	}
	if _, statErr := os.Stat(fileName + TempFileSuffix); !os.IsNotExist(statErr) {
		t.Fatalf("temporary file should be removed on rename error, stat err: %v", statErr)
	}
}

// wavesrv's config watcher re-reads projects.json on every change, so a burst of project writes replaces the file
// while it is open for reading; on windows that rename used to fail with "Access is denied"
func TestAtomicWriteFileWhileReaderHoldsFile(t *testing.T) {
	fileName := filepath.Join(t.TempDir(), "projects.json")
	if err := os.WriteFile(fileName, []byte("{}"), 0644); err != nil {
		t.Fatalf("WriteFile failed: %v", err)
	}
	reader, err := os.Open(fileName)
	if err != nil {
		t.Fatalf("Open failed: %v", err)
	}
	released := time.AfterFunc(100*time.Millisecond, func() { reader.Close() })
	defer released.Stop()
	defer reader.Close()

	if err := AtomicWriteFile(fileName, []byte(`{"key":"value"}`), 0644); err != nil {
		t.Fatalf("AtomicWriteFile failed while a reader held the file: %v", err)
	}
	data, err := os.ReadFile(fileName)
	if err != nil || string(data) != `{"key":"value"}` {
		t.Fatalf("file holds %q (err %v), want the new content", data, err)
	}
}
