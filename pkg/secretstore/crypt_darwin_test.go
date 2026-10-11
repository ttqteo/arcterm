// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build darwin

package secretstore

import (
	"bytes"
	"os"
	"testing"
)

// every test in the package runs against an in-memory Keychain: the real one would gain an item per temp
// config dir. TestRealKeychainRoundTrip opts back in.
var fakeKeychain = map[string]string{}

func init() {
	findKey = func(account string) (string, error) {
		k, ok := fakeKeychain[account]
		if !ok {
			return "", errKeyNotFound
		}
		return k, nil
	}
	storeKey = func(account, hexKey string) error {
		fakeKeychain[account] = hexKey
		return nil
	}
}

func resetKeys(t *testing.T) {
	t.Helper()
	fakeKeychain = map[string]string{}
	resetKeyCache()
}

func TestSealRoundTrip(t *testing.T) {
	useConfigDir(t)
	resetKeys(t)
	sealed, err := protect([]byte(`{"a":"b"}`))
	if err != nil {
		t.Fatal(err)
	}
	resetKeyCache() // a new process reads the key back from the Keychain
	plain, err := unprotect(sealed)
	if err != nil || string(plain) != `{"a":"b"}` {
		t.Fatalf("unprotect = %q, %v", plain, err)
	}
	if len(fakeKeychain) != 1 {
		t.Fatalf("keys made = %d, want 1", len(fakeKeychain))
	}
}

func TestOneKeyPerConfigDir(t *testing.T) {
	useConfigDir(t)
	resetKeys(t)
	if _, err := protect([]byte("x")); err != nil {
		t.Fatal(err)
	}
	if _, err := protect([]byte("y")); err != nil {
		t.Fatal(err)
	}
	useConfigDir(t)
	if _, err := protect([]byte("z")); err != nil {
		t.Fatal(err)
	}
	if len(fakeKeychain) != 2 {
		t.Fatalf("keys = %d, want one per config dir (2)", len(fakeKeychain))
	}
}

// a file sealed under a key the Keychain no longer holds must error, never read as an empty store, and
// reading must not mint a new key over it
func TestMissingKeyFailsLoudly(t *testing.T) {
	useConfigDir(t)
	resetKeys(t)
	sealed, err := protect([]byte("x"))
	if err != nil {
		t.Fatal(err)
	}
	resetKeys(t)
	if _, err := unprotect(sealed); err == nil {
		t.Fatal("unsealed without its key")
	}
	if len(fakeKeychain) != 0 {
		t.Fatal("reading made a key")
	}
}

func TestWrongKeyFails(t *testing.T) {
	useConfigDir(t)
	resetKeys(t)
	sealed, err := protect([]byte("x"))
	if err != nil {
		t.Fatal(err)
	}
	for k := range fakeKeychain {
		fakeKeychain[k] = "00000000000000000000000000000000000000000000000000000000000000ff"
	}
	resetKeyCache()
	if _, err := unprotect(sealed); err == nil {
		t.Fatal("unsealed under another key")
	}
}

func TestSealedBytesHideThePlaintext(t *testing.T) {
	useConfigDir(t)
	resetKeys(t)
	sealed, err := protect([]byte("sk-ant-oat01-secret"))
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(sealed, []byte("sk-ant")) {
		t.Fatal("plaintext in the sealed bytes")
	}
}

// ARC_TEST_KEYCHAIN=1 runs the real `security` round trip once, under a throwaway account it deletes after
func TestRealKeychainRoundTrip(t *testing.T) {
	if os.Getenv("ARC_TEST_KEYCHAIN") != "1" {
		t.Skip("set ARC_TEST_KEYCHAIN=1 to touch the login Keychain")
	}
	const account = "arcterm-test-0000"
	t.Cleanup(func() { _ = keychainDelete(account) })
	if _, err := keychainFind(account); err != errKeyNotFound {
		t.Fatalf("find before store = %v, want errKeyNotFound", err)
	}
	if err := keychainStore(account, "00112233"); err != nil {
		t.Fatal(err)
	}
	if got, err := keychainFind(account); err != nil || got != "00112233" {
		t.Fatalf("find = %q, %v", got, err)
	}
}
