// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"

	"github.com/wavetermdev/waveterm/pkg/notestore"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func (ws *WshServer) NoteAddCommand(ctx context.Context, data wshrpc.CommandNoteAddData) (*waveobj.UserNote, error) {
	return notestore.Add(data.Title, data.Body)
}

func (ws *WshServer) NoteListCommand(ctx context.Context) ([]*waveobj.UserNote, error) {
	return notestore.List()
}

func (ws *WshServer) NoteUpdateCommand(ctx context.Context, data wshrpc.CommandNoteUpdateData) error {
	return notestore.Update(data.ID, data.Title, data.Body)
}

func (ws *WshServer) NoteDeleteCommand(ctx context.Context, data wshrpc.CommandNoteDeleteData) error {
	return notestore.Delete(data.ID)
}

func (ws *WshServer) NoteScratchReadCommand(ctx context.Context) (string, error) {
	return notestore.ReadScratch()
}

func (ws *WshServer) NoteScratchWriteCommand(ctx context.Context, data wshrpc.CommandNoteScratchWriteData) error {
	return notestore.WriteScratch(data.Body)
}
