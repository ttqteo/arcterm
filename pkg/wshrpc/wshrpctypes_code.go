// pkg/wshrpc/wshrpctypes_code.go
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshrpc

import "context"

// CodeCommands is the Code surface's own writes, apart from the git reads in GitCommands.
type CodeCommands interface {
	CodeReviewWriteCommand(ctx context.Context, data CommandCodeReviewWriteData) (*CommandCodeReviewWriteRtnData, error)
}

type CommandCodeReviewWriteData struct {
	Project  string `json:"project"`
	Markdown string `json:"markdown"`
}

type CommandCodeReviewWriteRtnData struct {
	Path string `json:"path"` // absolute path of the written file
}
