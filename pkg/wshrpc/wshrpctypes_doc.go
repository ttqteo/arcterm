// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshrpc

import "context"

// DocCommands is the document-review domain: the compile behind the doc review's PDF tab.
type DocCommands interface {
	DocCompileCommand(ctx context.Context, data CommandDocCompileData) (*CommandDocCompileRtnData, error)
}

type CommandDocCompileData struct {
	Path string `json:"path"` // absolute path of the .tex file under review; its root is found from it
}

type CommandDocCompileRtnData struct {
	RootPath   string `json:"rootpath"` // "" = no root found
	PdfPath    string `json:"pdfpath,omitempty"`
	Ok         bool   `json:"ok"`
	Engine     string `json:"engine"` // "latexmk" | "tectonic" | "" (none on PATH, or no root)
	DurationMs int64  `json:"durationms"`
	Pages      int    `json:"pages"`
	LogTail    string `json:"logtail,omitempty"`
	FirstError string `json:"firsterror,omitempty"`
}
