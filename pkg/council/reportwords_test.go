// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package council

import (
	"reflect"
	"strings"
	"testing"
)

// The main file's words follow the council's language: the one it stored at Start; for a council saved before the field,
// the question's; with no question, the feature's.
func TestReportWordsPickTheCouncilsLanguage(t *testing.T) {
	vi, en := "Nên làm gì trước?", "What first?"
	for name, tc := range map[string]struct {
		c    Council
		want string
	}{
		"stored vi":                  {Council{Lang: LangVi, Question: en}, LangVi},
		"stored en wins":             {Council{Lang: LangEn, Question: vi}, LangEn},
		"no lang, question is vi":    {Council{Question: vi, Feature: "Idle sleep"}, LangVi},
		"no lang, question is en":    {Council{Question: en, Feature: "Chế độ ngủ"}, LangEn},
		"no lang, no question, vi":   {Council{Feature: "Chế độ ngủ"}, LangVi},
		"no lang, no question, en":   {Council{Feature: "Idle sleep"}, LangEn},
		"a language nothing reads":   {Council{Lang: "fr", Question: en}, LangEn},
		"a language nothing reads 2": {Council{Lang: "fr", Question: vi}, LangVi},
	} {
		if got := reportLang(&tc.c); got != tc.want {
			t.Errorf("%s: reportLang = %q, want %q", name, got, tc.want)
		}
	}
	if wordsOf(&Council{Lang: LangVi}).todo != "Việc cần làm" || wordsOf(&Council{Lang: LangEn}).todo != "To do" {
		t.Error("wordsOf did not pick the table of the council's language")
	}
}

// Every word of both tables is filled in: a field left out of one language would draw an empty heading or column.
func TestReportWordsAreAllFilledIn(t *testing.T) {
	for name, w := range map[string]reportWords{"English": englishWords, "Vietnamese": vietnameseWords} {
		v := reflect.ValueOf(w)
		for i := range v.NumField() {
			if strings.TrimSpace(v.Field(i).String()) == "" {
				t.Errorf("%s words: %s is empty", name, v.Type().Field(i).Name)
			}
		}
	}
	// the words the spec names for a Vietnamese council
	w := vietnameseWords
	for got, want := range map[string]string{
		w.todo: "Việc cần làm", w.colTask: "Việc", w.colWhy: "Vì sao", w.colFiles: "File đụng tới", w.colKind: "Loại",
		w.kindNew: "việc mới", w.kindEdit: "sửa chữ", w.kindDecision: "quyết định",
		w.figures: "Số liệu", w.colValue: "Giá trị", w.colMeasures: "Đo gì", w.colSource: "Nguồn",
		w.agreed: "Đã chốt", w.ruledOut: "Đã loại", w.open: "Còn mở",
	} {
		if got != want {
			t.Errorf("Vietnamese word %q, want %q", got, want)
		}
	}
	e := englishWords
	for got, want := range map[string]string{
		e.todo: "To do", e.colTask: "Task", e.colWhy: "Why", e.colFiles: "Files", e.colKind: "Kind",
		e.kindNew: "new work", e.kindEdit: "text edit", e.kindDecision: "decision",
		e.figures: "Figures", e.colValue: "Value", e.colMeasures: "Measures", e.colSource: "Source",
		e.agreed: "Agreed", e.ruledOut: "Ruled out", e.open: "Open",
	} {
		if got != want {
			t.Errorf("English word %q, want %q", got, want)
		}
	}
}

func TestReportWordsKindWord(t *testing.T) {
	for _, tc := range []struct {
		w    reportWords
		kind string
		want string
	}{
		{vietnameseWords, TaskNew, "việc mới"}, {vietnameseWords, TaskEdit, "sửa chữ"}, {vietnameseWords, TaskDecision, "quyết định"},
		{englishWords, TaskNew, "new work"}, {englishWords, TaskEdit, "text edit"}, {englishWords, TaskDecision, "decision"},
		{vietnameseWords, "", "—"}, {englishWords, "refactor", "—"},
	} {
		if got := tc.w.kindWord(tc.kind); got != tc.want {
			t.Errorf("kindWord(%q) = %q, want %q", tc.kind, got, tc.want)
		}
	}
}

// A Vietnamese council's memory words are Vietnamese too, whichever way a direction was set or left.
func TestReportWordsMemoryWordsInVietnamese(t *testing.T) {
	w := vietnameseWords
	if got := w.how(CouncilMemoryDirection{How: DirectionSuggested, Source: SourceCheck, Round: 2}); got != "Nhận từ lần kiểm tra sau vòng 2" {
		t.Errorf("how = %q", got)
	}
	if got := w.how(CouncilMemoryDirection{How: DirectionPin}); got != "Bạn ghim" {
		t.Errorf("how(pin) = %q", got)
	}
	if got := w.ended(CouncilMemoryDirection{Ended: EndUnpinned}); got != "đã bỏ ghim" {
		t.Errorf("ended = %q", got)
	}
	if got := w.ended(CouncilMemoryDirection{}); got != "đã thay" {
		t.Errorf("ended(none) = %q, want replaced", got)
	}
}
