// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package asciifold turns Latin letters with diacritics into their plain ASCII letters, so a slug made from a title
// keeps its words: "Cải tiến" → "cai tien", "đường" → "duong". A slug regexp that keeps only [a-z0-9] runs after it.
package asciifold

import (
	"strings"
	"unicode"
)

// latin maps a lower-case Latin letter with diacritics to its plain ASCII letters.
var latin = func() map[rune]string {
	m := map[rune]string{'ß': "ss", 'æ': "ae", 'œ': "oe"}
	for base, letters := range map[string]string{
		"a": "àáảãạăằắẳẵặâầấẩẫậäåāą",
		"c": "çćč",
		"d": "đď",
		"e": "èéẻẽẹêềếểễệëēęě",
		"g": "ğ",
		"i": "ìíỉĩịïîī",
		"l": "ł",
		"n": "ñńň",
		"o": "òóỏõọôồốổỗộơờớởỡợöøō",
		"r": "ř",
		"s": "śšş",
		"t": "ť",
		"u": "ùúủũụưừứửữựüûūů",
		"y": "ỳýỷỹỵÿ",
		"z": "źżž",
	} {
		for _, r := range letters {
			m[r] = base
		}
	}
	return m
}()

// Lower is s in lower case with each Latin letter's diacritics dropped: a composed letter folds through the table, and
// a combining mark (a decomposed "é" is "e" plus one) is dropped. Every other rune stays as it is, so a script with no
// ASCII form (日本) is left for the caller's slug rule to treat as a separator.
func Lower(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	for _, r := range strings.ToLower(s) {
		if unicode.IsMark(r) {
			continue
		}
		if plain, ok := latin[r]; ok {
			b.WriteString(plain)
			continue
		}
		b.WriteRune(r)
	}
	return b.String()
}
