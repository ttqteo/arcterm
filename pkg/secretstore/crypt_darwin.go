// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build darwin

package secretstore

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os/exec"
	"strings"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

// On macOS the secrets file is sealed with AES-256-GCM under a random key kept in the login Keychain, one
// item per config dir, so a dev build and the installed app each keep their own. The key is written and
// read with /usr/bin/security: the item's access list then holds that tool, so reading it asks the user
// nothing, and the key goes in over stdin (`security -i`), never in argv where `ps` would show it.
// Without this the store lived in wavesrv's memory and every restart lost what it held.

const (
	keychainService  = "arcterm-secretstore"
	keychainTimeout  = 10 * time.Second
	keychainNotFound = 44 // what `security` exits with when the item does not exist
	sealMagic        = "ARCS1"
)

var errKeyNotFound = errors.New("secretstore: the Keychain holds no key for this config dir")

// swapped by tests
var (
	findKey  = keychainFind
	storeKey = keychainStore
)

var (
	keyMu    sync.Mutex
	keyCache = map[string][]byte{}
)

func resetKeyCache() {
	keyMu.Lock()
	defer keyMu.Unlock()
	keyCache = map[string][]byte{}
}

// the Keychain account naming this config dir's key: a hash, so the item needs no quoting on stdin
func keyAccount() string {
	sum := sha256.Sum256([]byte(wavebase.GetWaveConfigDir()))
	return "cfg-" + hex.EncodeToString(sum[:8])
}

// the config dir's key; create makes and stores one when the Keychain has none. Reading never creates:
// a new key would make the file it failed to open unreadable for good.
func sealingKey(create bool) ([]byte, error) {
	account := keyAccount()
	keyMu.Lock()
	defer keyMu.Unlock()
	if k := keyCache[account]; k != nil {
		return k, nil
	}
	hexKey, err := findKey(account)
	if err == nil {
		k, derr := hex.DecodeString(hexKey)
		if derr != nil || len(k) != 32 {
			return nil, fmt.Errorf("secretstore: the Keychain key for this config dir is malformed")
		}
		keyCache[account] = k
		return k, nil
	}
	if !errors.Is(err, errKeyNotFound) || !create {
		return nil, err
	}
	k := make([]byte, 32)
	if _, err := rand.Read(k); err != nil {
		return nil, fmt.Errorf("secretstore: making a key: %w", err)
	}
	if err := storeKey(account, hex.EncodeToString(k)); err != nil {
		return nil, err
	}
	keyCache[account] = k
	return k, nil
}

func newGCM(key []byte) (cipher.AEAD, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}

func protect(plain []byte) ([]byte, error) {
	key, err := sealingKey(true)
	if err != nil {
		return nil, err
	}
	gcm, err := newGCM(key)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, fmt.Errorf("secretstore: making a nonce: %w", err)
	}
	out := append([]byte(sealMagic), nonce...)
	return gcm.Seal(out, nonce, plain, []byte(sealMagic)), nil
}

func unprotect(sealed []byte) ([]byte, error) {
	if !bytes.HasPrefix(sealed, []byte(sealMagic)) {
		return nil, errors.New("secretstore: the secrets file is not sealed by this platform")
	}
	key, err := sealingKey(false)
	if err != nil {
		return nil, err
	}
	gcm, err := newGCM(key)
	if err != nil {
		return nil, err
	}
	body := sealed[len(sealMagic):]
	if len(body) < gcm.NonceSize() {
		return nil, errors.New("secretstore: the secrets file is truncated")
	}
	plain, err := gcm.Open(nil, body[:gcm.NonceSize()], body[gcm.NonceSize():], []byte(sealMagic))
	if err != nil {
		return nil, fmt.Errorf("secretstore: the secrets file does not open with the Keychain key: %w", err)
	}
	return plain, nil
}

func runSecurity(stdin string, args ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), keychainTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, "/usr/bin/security", args...)
	if stdin != "" {
		cmd.Stdin = strings.NewReader(stdin)
	}
	return cmd.Output()
}

func keychainFind(account string) (string, error) {
	out, err := runSecurity("", "find-generic-password", "-s", keychainService, "-a", account, "-w")
	var exit *exec.ExitError
	if errors.As(err, &exit) && exit.ExitCode() == keychainNotFound {
		return "", errKeyNotFound
	}
	if err != nil {
		return "", fmt.Errorf("secretstore: reading the Keychain: %w", err)
	}
	return strings.TrimSpace(string(out)), nil
}

func keychainStore(account, hexKey string) error {
	line := fmt.Sprintf("add-generic-password -U -s %s -a %s -w %s\n", keychainService, account, hexKey)
	if _, err := runSecurity(line, "-i"); err != nil {
		return fmt.Errorf("secretstore: writing the Keychain: %w", err)
	}
	// `security -i` exits 0 even when a command in it failed, so read the key back
	if got, err := keychainFind(account); err != nil || got != hexKey {
		return fmt.Errorf("secretstore: the Keychain did not keep the key: %v", err)
	}
	return nil
}

func keychainDelete(account string) error {
	_, err := runSecurity("", "delete-generic-password", "-s", keychainService, "-a", account)
	return err
}
