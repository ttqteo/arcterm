// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package telebot

import (
	"crypto/rand"
	"crypto/subtle"
	"fmt"
	"math/big"
	"strings"
	"sync"
	"time"
)

// PairTTL is how long a pairing code lasts; a code is used once.
const PairTTL = 10 * time.Minute

// Pairer holds the one pairing code in play. The settings command asks for a code on one goroutine and the poll loop
// matches it on another, so it locks.
type Pairer struct {
	mu      sync.Mutex
	code    string
	expires time.Time
}

// New replaces the code in play with a fresh 6-digit one.
func (p *Pairer) New(now time.Time) (code string, expires time.Time) {
	n, err := rand.Int(rand.Reader, big.NewInt(1_000_000))
	if err != nil {
		// crypto/rand has not returned an error since Go 1.24; it ends the process instead.
		panic(err)
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	p.code = fmt.Sprintf("%06d", n.Int64())
	p.expires = now.Add(PairTTL)
	return p.code, p.expires
}

// Pending returns the live code, or "" when there is none or it has expired.
func (p *Pairer) Pending(now time.Time) (string, time.Time) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.code == "" || !now.Before(p.expires) {
		return "", time.Time{}
	}
	return p.code, p.expires
}

// Match reports whether text is "/start <code>" for the live code, and clears the code when it is.
func (p *Pairer) Match(text string, now time.Time) bool {
	f := strings.Fields(text)
	if len(f) != 2 || f[0] != "/start" {
		return false
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.code == "" || !now.Before(p.expires) {
		return false
	}
	if subtle.ConstantTimeCompare([]byte(f[1]), []byte(p.code)) != 1 {
		return false
	}
	p.code = ""
	p.expires = time.Time{}
	return true
}
