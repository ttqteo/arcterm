// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"errors"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

var _ wshrpc.RunStartCommands = (*WshServer)(nil)

// RunStartSuggestCommand is a stub until the suggestion is built (spec 2026-11-16-run-start-choice-design.md, Task 4
// of its plan): the launcher shows the error as "Couldn't check: …" and leaves Run now.
func (ws *WshServer) RunStartSuggestCommand(ctx context.Context, data wshrpc.CommandRunStartSuggestData) (*wshrpc.RunStartSuggestion, error) {
	return nil, errors.New("run start suggestions are not built yet")
}
