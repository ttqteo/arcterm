// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/wavetermdev/waveterm/pkg/sessiontrash"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// openTabTranscripts is the transcript every block's agent has reported: while a tab holds the block, its
// agent may still be writing the file, whatever its mtime says.
func openTabTranscripts(ctx context.Context) ([]string, error) {
	blocks, err := wstore.DBGetAllObjsByType[*waveobj.Block](ctx, waveobj.OType_Block)
	if err != nil {
		return nil, err
	}
	var paths []string
	for _, b := range blocks {
		if p := b.Meta.GetString(waveobj.MetaKey_AgentTranscriptPath, ""); p != "" {
			paths = append(paths, p)
		}
	}
	return paths, nil
}

func (ws *WshServer) DeleteAgentSessionCommand(ctx context.Context, data wshrpc.CommandDeleteAgentSessionData) error {
	live, err := openTabTranscripts(ctx)
	if err != nil {
		return fmt.Errorf("listing the open sessions: %w", err)
	}
	entry, err := sessiontrash.Delete(sessiontrash.Options{
		ProjectsDirs:    sessiontrash.ProjectsDirs(),
		TrashDir:        sessiontrash.TrashDir(),
		LiveTranscripts: live,
		Now:             time.Now(),
	}, data.TranscriptPath)
	if err != nil {
		return err
	}
	log.Printf("moved session %s to %s\n", data.TranscriptPath, entry)
	return nil
}
