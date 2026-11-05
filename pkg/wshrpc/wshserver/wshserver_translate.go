// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"sync"

	"github.com/wavetermdev/waveterm/pkg/translate"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// one engine for wavesrv's life, so a 429's rest holds across requests; made on the first request, once
// WAVETERM_APP_PATH is read
var translateEngine = sync.OnceValue(func() *translate.Engine {
	return translate.NewEngine(wavebase.GetWaveAppBinPath())
})

// TranslateCommand translates through Google, or, when Google cannot answer, through Apple Translation on a Mac and
// then MyMemory (translate.Engine). Source answers the language detected, or, when none was named and the request did not say
// "auto", the request's own.
func (ws *WshServer) TranslateCommand(ctx context.Context, data wshrpc.CommandTranslateData) (*wshrpc.CommandTranslateRtnData, error) {
	a, err := translateEngine().Translate(ctx, data.Source, data.Target, data.Text)
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
