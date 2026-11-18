// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package remotemode

import (
	"context"
	"errors"
)

// transcriptPageLines is how many raw lines a page of older transcript holds at most.
const transcriptPageLines = 200

// remoteTranscriptPage is Deps.Transcript: the page of lines that ends at byte offset before in a
// handed-over agent's transcript. It returns the *GoneError of a tab that is not handed over.
func remoteTranscriptPage(ctx context.Context, tab string, before int64) (TranscriptChunk, error) {
	a, _, err := LookupHanded(ctx, tab)
	if err != nil {
		return TranscriptChunk{}, err
	}
	if TranscriptPageHook == nil {
		return TranscriptChunk{}, errors.New("transcript pages are not available")
	}
	if a.TranscriptPath == "" {
		return TranscriptChunk{}, errors.New("this agent has no transcript yet")
	}
	return TranscriptPageHook(a.TranscriptPath, before, transcriptPageLines)
}
