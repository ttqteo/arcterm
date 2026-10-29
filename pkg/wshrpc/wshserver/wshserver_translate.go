// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"

	"github.com/wavetermdev/waveterm/pkg/translate"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// TranslateCommand asks Google for the text's translation. Source answers the language Google detected, or, when it
// named none and the request did not say "auto", the request's own.
func (ws *WshServer) TranslateCommand(ctx context.Context, data wshrpc.CommandTranslateData) (*wshrpc.CommandTranslateRtnData, error) {
	a, err := translate.Google(ctx, data.Source, data.Target, data.Text)
	if err != nil {
		return nil, err
	}
	rtn := &wshrpc.CommandTranslateRtnData{Translation: a.Translation, Source: a.Source, Phonetics: a.Phonetics}
	if rtn.Source == "" && data.Source != "auto" {
		rtn.Source = data.Source
	}
	for _, c := range a.Classes {
		rtn.Classes = append(rtn.Classes, wshrpc.TranslateClass{Pos: c.Pos, Words: c.Words})
	}
	return rtn, nil
}
