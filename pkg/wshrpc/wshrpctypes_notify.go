// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshrpc

import "context"

// NotifyCommandData is the payload for wsh notify and the wave_notify tool.
type NotifyCommandData struct {
	Title   string `json:"title"`
	Message string `json:"message"`
	Level   string `json:"level"` // info | warn | error (default info)
	// oref of the block the notice came from, so the avatar can name the agent
	ORef string `json:"oref,omitempty"`
	// said once: the avatar speaks it but keeps no copy to read back
	Transient bool `json:"transient,omitempty"`
}

// OpenFileData is the payload for wsh open/view/edit: route a path into the cockpit's code surface.
type OpenFileData struct {
	Path string `json:"path"`
	Edit bool   `json:"edit,omitempty"`
}

// NotifyCommands is the wshrpc domain for cockpit notifications.
type NotifyCommands interface {
	NotifyCommand(ctx context.Context, data NotifyCommandData) error
}
