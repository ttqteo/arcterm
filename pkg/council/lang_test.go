// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package council

import "testing"

// langCases is one table of cases for LangOf. frontend/app/view/agents/councillang.test.ts holds the same table for the
// TypeScript copy of the rule: change a row in one, change it in the other.
var langCases = []struct {
	name, text, want string
}{
	{"tone marks", "Có nên ghim ứng dụng vào thanh ray không?", LangVi},
	{"a short question", "Cái này ổn không?", LangVi},
	{"upper case", "ĐƯỜNG DẪN CỦA HỘI ĐỒNG", LangVi},
	{"đ alone, no tone mark", "Đo RAM", LangVi},
	{"ă alone, no tone mark", "Ăn com", LangVi},
	{"ơ alone, no tone mark", "Dơn", LangVi},
	{"ê alone, no tone mark", "Thêm cot", LangVi},
	{"a tone mark alone", "Rail ảo", LangVi},
	{"a decomposed tone mark", "Cai này có", LangVi},
	{"a decomposed horn and tone mark", "ghim ứng dung", LangVi},
	{"Vietnamese typed with no marks at all cannot be told from English", "co nen ghim ung dung khong", LangEn},
	{"English", "Is the pin worth it?", LangEn},
	{"English with code", "Does pkg/council/runner.go:42 hold on a Mac?", LangEn},
	{"mixed, a Vietnamese phrase in English", "Is the pin có đáng không?", LangVi},
	{"mixed, an English term in Vietnamese", "Review tính năng rail apps", LangVi},
	{"accents that are not Vietnamese", "Müller und señor", LangEn},
	{"a decomposed umlaut", "Müller", LangEn},
	{"a decomposed tilde on a consonant", "señor", LangEn},
	{"empty", "", LangEn},
	{"blank", "  \n\t ", LangEn},
}

func TestLangOf(t *testing.T) {
	for _, tc := range langCases {
		t.Run(tc.name, func(t *testing.T) {
			if got := LangOf(tc.text); got != tc.want {
				t.Errorf("LangOf(%q) = %q, want %q", tc.text, got, tc.want)
			}
		})
	}
}
