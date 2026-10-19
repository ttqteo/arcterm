// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package secretstore

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

// useConfigDir points the store at a temp config dir and clears in-memory state, so each test starts
// from a cold store. Returns the dir.
func useConfigDir(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	prev := wavebase.ConfigHome_VarCache
	wavebase.ConfigHome_VarCache = dir
	t.Cleanup(func() { wavebase.ConfigHome_VarCache = prev })
	clearMemory()
	return dir
}

// clearMemory drops in-memory state but leaves whatever is on disk — this is what a freshly started
// wavesrv sees, and it is the only way to tell real persistence from a process-lifetime cache.
func clearMemory() {
	lock.Lock()
	defer lock.Unlock()
	secrets = make(map[string]string)
	initialized = false
	writeRequestChan = nil
	lastInitTryTime = time.Time{}
	lastInitErr = nil
}

func readSecretsFileWithin(t *testing.T, dir string, d time.Duration) []byte {
	t.Helper()
	path := filepath.Join(dir, SecretsFileName)
	deadline := time.Now().Add(d)
	for time.Now().Before(deadline) {
		if b, err := os.ReadFile(path); err == nil {
			return b
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("secrets file never appeared at %s", path)
	return nil
}

// waitForSecretsFile waits out the write debounce (WriteDebounceMs).
func waitForSecretsFile(t *testing.T, dir string) []byte {
	t.Helper()
	return readSecretsFileWithin(t, dir, 10*time.Second)
}

func waitForSecretsFileChange(t *testing.T, dir string, prev []byte) {
	t.Helper()
	path := filepath.Join(dir, SecretsFileName)
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		if b, err := os.ReadFile(path); err == nil && !bytes.Equal(b, prev) {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("secrets file never changed")
}

// requirePersistence skips on platforms with no at-rest encryption, where in-memory-only is the
// documented behavior rather than a bug.
func requirePersistence(t *testing.T) {
	t.Helper()
	if _, err := protect([]byte("probe")); errors.Is(err, ErrPersistUnsupported) {
		t.Skip("at-rest encryption not implemented on this platform")
	}
}

func TestSecretSurvivesRestart(t *testing.T) {
	requirePersistence(t)
	dir := useConfigDir(t)
	const name, value = "jarvis_embedapikey", "sk-test-durable-value"

	if err := SetSecret(name, value); err != nil {
		t.Fatalf("SetSecret: %v", err)
	}
	waitForSecretsFile(t, dir)

	clearMemory() // a new wavesrv process

	got, ok, err := GetSecret(name)
	if err != nil {
		t.Fatalf("GetSecret: %v", err)
	}
	if !ok {
		t.Fatal("secret did not survive restart")
	}
	if got != value {
		t.Fatalf("GetSecret = %q, want %q", got, value)
	}
}

func TestSecretsFileIsNotCleartext(t *testing.T) {
	requirePersistence(t)
	dir := useConfigDir(t)
	const name, value = "jarvis_embedapikey", "sk-must-not-appear-verbatim"

	if err := SetSecret(name, value); err != nil {
		t.Fatalf("SetSecret: %v", err)
	}
	raw := waitForSecretsFile(t, dir)

	if bytes.Contains(raw, []byte(value)) {
		t.Fatal("secret value is stored in cleartext on disk")
	}
	if bytes.Contains(raw, []byte(name)) {
		t.Fatal("secret name is stored in cleartext on disk")
	}
}

func TestDeletedSecretDoesNotSurviveRestart(t *testing.T) {
	requirePersistence(t)
	dir := useConfigDir(t)
	const name = "jarvis_embedapikey"

	if err := SetSecret(name, "sk-first"); err != nil {
		t.Fatalf("SetSecret: %v", err)
	}
	afterSet := waitForSecretsFile(t, dir)

	if err := DeleteSecret(name); err != nil {
		t.Fatalf("DeleteSecret: %v", err)
	}
	waitForSecretsFileChange(t, dir, afterSet)

	clearMemory()

	if _, ok, err := GetSecret(name); err != nil {
		t.Fatalf("GetSecret: %v", err)
	} else if ok {
		t.Fatal("deleted secret came back after restart")
	}
}

// An unreadable secrets file must surface an error, never an empty store: reading it as "no secrets"
// would let the very next write persist that emptiness over the user's real ones.
func TestUnreadableSecretsFileFailsLoudly(t *testing.T) {
	dir := useConfigDir(t)
	if err := os.WriteFile(filepath.Join(dir, SecretsFileName), []byte("not a valid blob"), 0600); err != nil {
		t.Fatal(err)
	}

	_, _, err := GetSecret("jarvis_embedapikey")
	if err == nil {
		t.Fatal("corrupt secrets file read as an empty store instead of erroring")
	}
}

// A failed load is not retried until InitRetryMs has passed: a retry inside the window answers with the
// failure it already saw, even if the file was fixed meanwhile, and the first call after the window loads.
func TestFailedLoadRetriesOnlyAfterTheRetryWindow(t *testing.T) {
	dir := useConfigDir(t)
	path := filepath.Join(dir, SecretsFileName)
	if err := os.WriteFile(path, []byte("not a valid blob"), 0600); err != nil {
		t.Fatal(err)
	}
	_, _, first := GetSecret("jarvis_embedapikey")
	if first == nil {
		t.Fatal("corrupt secrets file read as an empty store instead of erroring")
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if _, _, err := GetSecret("jarvis_embedapikey"); err != first {
		t.Fatalf("retry inside the window: err = %v, want the first failure %v", err, first)
	}
	time.Sleep(InitRetryMs*time.Millisecond + 100*time.Millisecond)
	if _, ok, err := GetSecret("jarvis_embedapikey"); err != nil || ok {
		t.Fatalf("retry after the window: (ok=%v, err=%v), want an empty store and no error", ok, err)
	}
}
