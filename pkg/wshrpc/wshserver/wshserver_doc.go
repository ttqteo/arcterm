// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"fmt"

	"github.com/wavetermdev/waveterm/pkg/doccompile"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func (ws *WshServer) DocCompileCommand(ctx context.Context, data wshrpc.CommandDocCompileData) (*wshrpc.CommandDocCompileRtnData, error) {
	if data.Path == "" {
		return nil, fmt.Errorf("path is required")
	}
	res, err := doccompile.Compile(ctx, data.Path)
	if err != nil {
		return nil, err
	}
	return &wshrpc.CommandDocCompileRtnData{
		RootPath:   res.RootPath,
		PdfPath:    res.PdfPath,
		Ok:         res.Ok,
		Engine:     res.Engine,
		DurationMs: res.DurationMs,
		Pages:      res.Pages,
		LogTail:    res.LogTail,
		FirstError: res.FirstError,
	}, nil
}

func (ws *WshServer) DocPdfFindCommand(ctx context.Context, data wshrpc.CommandDocPdfFindData) (*wshrpc.CommandDocPdfFindRtnData, error) {
	if data.Path == "" {
		return nil, fmt.Errorf("path is required")
	}
	found, err := doccompile.FindPdf(data.Path)
	if err != nil {
		return nil, err
	}
	return &wshrpc.CommandDocPdfFindRtnData{
		RootPath: found.RootPath,
		PdfPath:  found.PdfPath,
		Source:   found.Source,
		ModTime:  found.ModTime,
	}, nil
}
