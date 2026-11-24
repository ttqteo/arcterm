// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package council

import "fmt"

// reportWords are the words the report's main file writes itself, in the language of the council: its headings, the
// columns of its two tables, the words of its memory and the line that links the side file. The side file keeps English
// headings whatever the language (see labelWord); only the main file, the part the person reads, follows the question.
// frontend/app/view/agents/councilreporttables.ts holds the same table words for the cockpit's Report (reportWords).
type reportWords struct {
	title, asked, noSummary string // "Council: " and "You asked: " end with their space

	chosen, earlier, noChosen, outranks string // the direction the person settled on, and the ones it replaced
	agreed, ruledOut, open, why         string // the memory's entries; why is "(why: …)" after a ruled-out one
	from                                string // "from P1", on a direction and on a pinned final proposal

	todo, colNo, colTask, colWhy, colFiles, colKind string // the to-do table
	kindNew, kindEdit, kindDecision                 string // what a row's Loại column says; a row with none says "—"

	figures, colValue, colMeasures, colSource string // the figures table
	colRelation, otherFigures                 string // the column of how a figure relates to others; the ungrouped figures' heading
	// the words of that column: "14.3% of 947", "from 60, +20", "−8.9 pts", "over the max 1000", "at v2"
	ofWhole, fromWas, points, overMax, withinMax, underMin, meetsMin, atTime string
	decimalComma                                                             bool // numbers are written with a decimal comma ("79,5%")

	finalProposal, fromSeat string // fromSeat opens the line that names who wrote it: "From UX"
	sideLink                string // a format with the side file's name twice: the link's text and its target

	// the words of how a direction was set (memoryHow) and how one left (memoryEnded)
	pinned, written, setByYou, fromSuggestion, fromCheck, fromCheckRound, fromGreen string // fromCheckRound holds the round's %d
	replaced, edited, unpinned                                                      string
}

var englishWords = reportWords{
	title: "Council: ", asked: "You asked: ", noSummary: "_No summary yet._",

	chosen: "Chosen direction", earlier: "Earlier directions", noChosen: "None is chosen now.",
	outranks: "_The person settled on this: it outranks the report below wherever the two differ._",
	agreed:   "Agreed", ruledOut: "Ruled out", open: "Open", why: "why", from: "from",

	todo: "To do", colNo: "#", colTask: "Task", colWhy: "Why", colFiles: "Files", colKind: "Kind",
	kindNew: "new work", kindEdit: "text edit", kindDecision: "decision",

	figures: "Figures", colValue: "Value", colMeasures: "Measures", colSource: "Source",
	colRelation: "Relation", otherFigures: "Other figures",
	ofWhole: "of", fromWas: "from", points: "pts", overMax: "over the max", withinMax: "within the max",
	underMin: "under the min", meetsMin: "meets the min", atTime: "at",

	finalProposal: "Final proposal", fromSeat: "From",
	sideLink: "The full reasoning, the discussion and how the council worked: [%[1]s](%[1]s).",

	pinned: "Pinned by you", written: "Written by you", setByYou: "Set by you",
	fromSuggestion: "Accepted from a suggestion", fromCheck: "Accepted from the check",
	fromCheckRound: "Accepted from the check after round %d", fromGreen: "Accepted from all green",
	replaced: "replaced", edited: "edited", unpinned: "unpinned",
}

var vietnameseWords = reportWords{
	title: "Hội đồng: ", asked: "Bạn hỏi: ", noSummary: "_Chưa có tóm tắt._",

	chosen: "Hướng đã chọn", earlier: "Các hướng trước đó", noChosen: "Hiện chưa chọn hướng nào.",
	outranks: "_Người dùng đã chốt hướng này: nó đứng trên báo cáo bên dưới ở chỗ hai bên khác nhau._",
	agreed:   "Đã chốt", ruledOut: "Đã loại", open: "Còn mở", why: "vì sao", from: "từ",

	todo: "Việc cần làm", colNo: "#", colTask: "Việc", colWhy: "Vì sao", colFiles: "File đụng tới", colKind: "Loại",
	kindNew: "việc mới", kindEdit: "sửa chữ", kindDecision: "quyết định",

	figures: "Số liệu", colValue: "Giá trị", colMeasures: "Đo gì", colSource: "Nguồn",
	colRelation: "Liên hệ", otherFigures: "Số khác",
	ofWhole: "của", fromWas: "từ", points: "điểm", overMax: "vượt ngưỡng tối đa", withinMax: "trong ngưỡng tối đa",
	underMin: "dưới mức tối thiểu", meetsMin: "đạt mức tối thiểu", atTime: "lúc", decimalComma: true,

	finalProposal: "Đề xuất cuối cùng", fromSeat: "Từ",
	sideLink: "Lập luận đầy đủ, cuộc thảo luận và cách hội đồng làm việc: [%[1]s](%[1]s).",

	pinned: "Bạn ghim", written: "Bạn tự viết", setByYou: "Bạn đặt",
	fromSuggestion: "Nhận từ một gợi ý", fromCheck: "Nhận từ lần kiểm tra",
	fromCheckRound: "Nhận từ lần kiểm tra sau vòng %d", fromGreen: "Nhận từ lúc tất cả đều xanh",
	replaced: "đã thay", edited: "đã sửa", unpinned: "đã bỏ ghim",
}

// reportLang is the language the main file is written in: the council's (Lang), else, for one saved before the field
// (an older Brainstorm), the question's, else the feature's. Anything but Vietnamese reads as English.
func reportLang(c *Council) string {
	if c.Lang == LangVi || c.Lang == LangEn {
		return c.Lang
	}
	return councilLang(c.Question, c.Feature)
}

// reportWordsFor is the words of lang: Vietnamese for LangVi, English for any other.
func reportWordsFor(lang string) reportWords {
	if lang == LangVi {
		return vietnameseWords
	}
	return englishWords
}

// wordsOf is the words c's main file is written in.
func wordsOf(c *Council) reportWords { return reportWordsFor(reportLang(c)) }

// kindWord is the word for a direction's kind (CouncilDirection.Kind): "—" for none, and for a word that is not one of
// the three Task* values.
func (w reportWords) kindWord(kind string) string {
	switch kind {
	case TaskNew:
		return w.kindNew
	case TaskEdit:
		return w.kindEdit
	case TaskDecision:
		return w.kindDecision
	}
	return "—"
}

// how is how a direction was set, in words: "Pinned by you", "Written by you", or "Accepted from the check after round N"
// / "Accepted from all green" for a suggestion the person accepted.
func (w reportWords) how(d CouncilMemoryDirection) string {
	switch d.How {
	case DirectionPin:
		return w.pinned
	case DirectionWritten:
		return w.written
	case DirectionSuggested:
		switch {
		case d.Source == SourceCheck && d.Round > 0:
			return fmt.Sprintf(w.fromCheckRound, d.Round)
		case d.Source == SourceCheck:
			return w.fromCheck
		case d.Source == SourceGreen:
			return w.fromGreen
		}
		return w.fromSuggestion
	}
	return w.setByYou
}

// ended is the word for how a replaced direction left: "replaced", "edited" or "unpinned".
func (w reportWords) ended(d CouncilMemoryDirection) string {
	switch d.Ended {
	case EndEdited:
		return w.edited
	case EndUnpinned:
		return w.unpinned
	}
	return w.replaced
}
