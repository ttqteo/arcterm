// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package council

import "strings"

// The letters LangOf reads as Vietnamese, besides the whole of U+1EA0 to U+1EF9 (Latin Extended Additional, where almost
// every tone-marked vowel lives: ạ ả ấ ầ … ỹ): đ ă ơ ư, the circumflex vowels â ê ô, and the tone-marked vowels that
// sit in Latin-1 and Latin Extended-A (à á ã è é ì í ĩ ò ó õ ù ú ũ ý). frontend/app/view/agents/councillang.ts holds
// the same two sets; both copies are tested on one table of cases.
const (
	viLetters      = "àáâãèéêìíĩòóôõùúũýăđơư"
	viBlockFirst   = 0x1EA0
	viBlockLast    = 0x1EF9
	viVowels       = "aeiouy"
	viCombiningSet = "̛̣̀́̂̃̆̉" // grave, acute, circumflex, tilde, breve, hook above, horn, dot below
)

// LangOf reads the language of a question: LangVi when it holds a letter only Vietnamese writes (đ, ă, â, ê, ô, ơ, ư, or
// a vowel with a Vietnamese tone mark, precomposed or as a base vowel and a combining mark), else LangEn. A question
// typed in Vietnamese with no marks at all reads as English: nothing in it says otherwise. The council stores the answer
// at Start, from the question, else the feature.
func LangOf(text string) string {
	var prev rune
	for _, r := range strings.ToLower(text) {
		if strings.ContainsRune(viLetters, r) || (r >= viBlockFirst && r <= viBlockLast) ||
			(strings.ContainsRune(viCombiningSet, r) && strings.ContainsRune(viVowels, prev)) {
			return LangVi
		}
		prev = r
	}
	return LangEn
}
