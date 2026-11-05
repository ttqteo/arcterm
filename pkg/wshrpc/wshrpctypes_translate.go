// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshrpc

import "context"

// TranslateCommands is the rail's Quick translate: wavesrv asks Google for the text's translation, or, when Google
// cannot answer, Apple Translation on a Mac and then MyMemory (pkg/translate.Engine), and answers it with the source
// language detected.
type TranslateCommands interface {
	TranslateCommand(ctx context.Context, data CommandTranslateData) (*CommandTranslateRtnData, error)
}

// CommandTranslateData is one request. Source is a language code (Google's), or "auto" to detect it.
type CommandTranslateData struct {
	Source string `json:"source"`
	Target string `json:"target"`
	Text   string `json:"text"`
}

// CommandTranslateRtnData is the answer. Source is the language detected when the request said
// "auto", else the request's own.
type CommandTranslateRtnData struct {
	Translation string           `json:"translation"`
	Source      string           `json:"source"`
	Phonetics   string           `json:"phonetics,omitempty"`
	Classes     []TranslateClass `json:"classes,omitempty"`
}

// TranslateClass is one part of speech with the words Google lists for it (a one-word lookup).
type TranslateClass struct {
	Pos   string   `json:"pos"`
	Words []string `json:"words"`
}
