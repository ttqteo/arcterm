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

// A reader that opened the file with OpenShared never holds a replace back, however long it keeps it open: readers that
// reopen a council back to back starved its Save past the retry above on a loaded machine. The reader keeps reading
// the file it opened, so it never sees half of the new one.
func TestRenameReplacingLandsUnderASharedReader(t *testing.T) {
	dir := t.TempDir()
	target, tmp := filepath.Join(dir, "c1.json"), filepath.Join(dir, "c1.json.tmp")
	if err := os.WriteFile(target, []byte("old"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(tmp, []byte("new"), 0644); err != nil {
		t.Fatal(err)
	}
	reader, err := OpenShared(target)
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()

	start := time.Now()
	if err := RenameReplacing(tmp, target); err != nil {
		t.Fatalf("RenameReplacing under a shared reader: %v", err)
	}
	if waited := time.Since(start); waited > renameRetryFor/2 {
		t.Errorf("the replace waited %v, want it to land without waiting for the reader", waited)
	}
	if got, err := ReadFileShared(target); err != nil || string(got) != "new" {
		t.Errorf("the file holds %q (err %v), want the new content", got, err)
	}
	held := make([]byte, 8)
	n, _ := reader.Read(held)
	if string(held[:n]) != "old" {
		t.Errorf("the open reader read %q, want the file it opened", held[:n])
	}
}

func TestReadFileSharedReportsAMissingFile(t *testing.T) {
	_, err := ReadFileShared(filepath.Join(t.TempDir(), "gone.json"))
	if !os.IsNotExist(err) {
		t.Fatalf("err = %v, want one that reads as not existing", err)
	}
}
