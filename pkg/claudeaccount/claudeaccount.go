// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package claudeaccount keeps the Claude accounts added with `claude setup-token` and puts the active one
// into wavesrv's environment, so every claude started afterwards (shells, agents, headless runs) inherits
// it. The list lives in a local file; the tokens live in the secretstore and are never returned by an RPC.
// Default ("") is whatever `/login` stored: no token in the environment.
package claudeaccount

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/secretstore"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

const (
	tokenVar    = "CLAUDE_CODE_OAUTH_TOKEN"
	accountVar  = "ARC_CLAUDE_ACCOUNT"
	TokenPrefix = "sk-ant-oat"
)

type Account struct {
	Id        string `json:"id"`
	Label     string `json:"label"`
	CreatedTs int64  `json:"createdts"`
	// the Claude account this token belongs to, lowercased; optional. Quota snapshots are keyed by it, so
	// a token for an account that was once the /login one shows that account's last snapshot.
	Email string `json:"email,omitempty"`
}

func normalizeEmail(email string) string { return strings.ToLower(strings.TrimSpace(email)) }

// swapped by tests
var (
	storePath    = func() string { return filepath.Join(wavebase.GetWaveDataDir(), "claude-accounts.json") }
	setSecret    = secretstore.SetSecret
	getSecret    = secretstore.GetSecret
	deleteSecret = secretstore.DeleteSecret
)

var (
	mu        sync.Mutex
	active    string
	inherited = map[string]*string{}
)

func secretName(id string) string { return "CLAUDE_ACCOUNT_" + id }

func newId() string {
	b := make([]byte, 4)
	_, _ = rand.Read(b)
	return "a" + hex.EncodeToString(b)
}

func load() ([]Account, error) {
	raw, err := os.ReadFile(storePath())
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var list []Account
	if err := json.Unmarshal(raw, &list); err != nil {
		return nil, fmt.Errorf("reading %s: %w", storePath(), err)
	}
	return list, nil
}

func save(list []Account) error {
	raw, err := json.MarshalIndent(list, "", "  ")
	if err != nil {
		return err
	}
	tmp := storePath() + ".tmp"
	if err := os.WriteFile(tmp, raw, 0600); err != nil {
		return err
	}
	return os.Rename(tmp, storePath())
}

func List() ([]Account, error) {
	mu.Lock()
	defer mu.Unlock()
	return load()
}

func Add(label, token, email string) (Account, error) {
	token = strings.TrimSpace(token)
	if !strings.HasPrefix(token, TokenPrefix) {
		return Account{}, fmt.Errorf("not a setup-token (want a value starting with %s)", TokenPrefix)
	}
	mu.Lock()
	defer mu.Unlock()
	list, err := load()
	if err != nil {
		return Account{}, err
	}
	a := Account{Id: newId(), Label: strings.TrimSpace(label), CreatedTs: time.Now().UnixMilli(), Email: normalizeEmail(email)}
	if a.Label == "" {
		a.Label = fmt.Sprintf("Account %d", len(list)+1)
	}
	if err := setSecret(secretName(a.Id), token); err != nil {
		return Account{}, err
	}
	if err := save(append(list, a)); err != nil {
		_ = deleteSecret(secretName(a.Id))
		return Account{}, err
	}
	return a, nil
}

func Rename(id, label string) error {
	mu.Lock()
	defer mu.Unlock()
	list, err := load()
	if err != nil {
		return err
	}
	for i := range list {
		if list[i].Id == id {
			list[i].Label = strings.TrimSpace(label)
			return save(list)
		}
	}
	return fmt.Errorf("no account %q", id)
}

// SetEmail ties account id to a Claude account's email; "" clears it.
func SetEmail(id, email string) error {
	mu.Lock()
	defer mu.Unlock()
	list, err := load()
	if err != nil {
		return err
	}
	for i := range list {
		if list[i].Id == id {
			list[i].Email = normalizeEmail(email)
			return save(list)
		}
	}
	return fmt.Errorf("no account %q", id)
}

func Remove(id string) error {
	mu.Lock()
	defer mu.Unlock()
	list, err := load()
	if err != nil {
		return err
	}
	kept := list[:0]
	for _, a := range list {
		if a.Id != id {
			kept = append(kept, a)
		}
	}
	if err := save(kept); err != nil {
		return err
	}
	return deleteSecret(secretName(id))
}

// CaptureInherited records the values wavesrv was started with, so Default can restore them (including
// "unset"). Call once at startup, before the first ApplyEnv.
func CaptureInherited() { captureInherited() }

func captureInherited() {
	mu.Lock()
	defer mu.Unlock()
	for _, k := range []string{tokenVar, accountVar} {
		if v, ok := os.LookupEnv(k); ok {
			inherited[k] = &v
		} else {
			inherited[k] = nil
		}
	}
}

func restore(k string) {
	if v := inherited[k]; v != nil {
		os.Setenv(k, *v)
	} else {
		os.Unsetenv(k)
	}
}

// ApplyEnv puts account id's token into the environment, or restores the inherited values for Default
// or for an account whose token is gone. It returns the account actually applied ("" = Default).
func ApplyEnv(id string) string {
	token := ""
	if id != "" {
		t, ok, err := getSecret(secretName(id))
		if err != nil || !ok || t == "" {
			log.Printf("claude account %q has no token, using Default: %v\n", id, err)
			id = ""
		} else {
			token = t
		}
	}
	mu.Lock()
	defer mu.Unlock()
	if id == "" {
		restore(tokenVar)
		restore(accountVar)
	} else {
		os.Setenv(tokenVar, token)
		os.Setenv(accountVar, id)
	}
	active = id
	return id
}

// Active is the account ApplyEnv last applied ("" = Default).
func Active() string {
	mu.Lock()
	defer mu.Unlock()
	return active
}
