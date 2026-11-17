// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package web embeds the phone page. Only static/ is ever served.
package web

import (
	"embed"
	"io/fs"
)

//go:embed static
var staticFS embed.FS

// FS is the static subtree, so "/" maps to static/index.html.
var FS fs.FS = mustSub()

func mustSub() fs.FS {
	sub, err := fs.Sub(staticFS, "static")
	if err != nil {
		panic(err)
	}
	return sub
}
