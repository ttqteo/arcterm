// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package telebot

import (
	"regexp"
	"testing"
	"time"
)

var sixDigits = regexp.MustCompile(`^[0-9]{6}$`)

func TestPairMatchOnceAndExpires(t *testing.T) {
	now := time.Date(2026, 10, 16, 9, 0, 0, 0, time.UTC)
	var p Pairer
	if p.Match("/start 000000", now) {
		t.Fatalf("matched with no code in play")
	}
	code, expires := p.New(now)
	if !sixDigits.MatchString(code) {
		t.Fatalf("code = %q, want 6 digits", code)
	}
	if !expires.Equal(now.Add(PairTTL)) {
		t.Fatalf("expires = %v, want %v", expires, now.Add(PairTTL))
	}
	if got, exp := p.Pending(now.Add(time.Minute)); got != code || !exp.Equal(expires) {
		t.Fatalf("Pending = %q %v, want %q %v", got, exp, code, expires)
	}

	wrong := "000000"
	if code == wrong {
		wrong = "111111"
	}
	for _, text := range []string{"/start " + wrong, "/start", code, "start " + code, "/start " + code + " x", "hello /start " + code} {
		if p.Match(text, now.Add(time.Minute)) {
			t.Errorf("Match(%q) = true, want false", text)
		}
	}
	if !p.Match("  /start   "+code+" \n", now.Add(time.Minute)) {
		t.Fatalf("the right code did not match")
	}
	if p.Match("/start "+code, now.Add(time.Minute)) {
		t.Fatalf("a code matched twice")
	}
	if got, _ := p.Pending(now); got != "" {
		t.Fatalf("Pending after a match = %q, want none", got)
	}

	code, _ = p.New(now)
	if p.Match("/start "+code, now.Add(PairTTL+time.Second)) {
		t.Fatalf("an expired code matched")
	}
	if got, _ := p.Pending(now.Add(PairTTL + time.Second)); got != "" {
		t.Fatalf("Pending past the TTL = %q, want none", got)
	}
}

func TestPairNewReplacesTheCode(t *testing.T) {
	now := time.Date(2026, 10, 16, 9, 0, 0, 0, time.UTC)
	var p Pairer
	first, _ := p.New(now)
	var second string
	for i := 0; i < 20 && (second == "" || second == first); i++ {
		second, _ = p.New(now)
	}
	if second == first {
		t.Skip("20 draws in a row matched the first code")
	}
	if p.Match("/start "+first, now) {
		t.Fatalf("the replaced code still matched")
	}
	if !p.Match("/start "+second, now) {
		t.Fatalf("the current code did not match")
	}
}
