// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshrpc

import "context"

// RemoteCommands is remote mode: the phone page behind a Cloudflare tunnel (pkg/remotemode).
type RemoteCommands interface {
	RemoteStatusCommand(ctx context.Context) (*RemoteStatusData, error)
	RemoteSetupCommand(ctx context.Context, data CommandRemoteSetupData) (*RemoteStatusData, error)
	RemoteOnCommand(ctx context.Context) (*RemoteStatusData, error)
	RemoteOffCommand(ctx context.Context) (*RemoteStatusData, error)
	RemoteHandCommand(ctx context.Context, data CommandRemoteHandData) (*RemoteStatusData, error)
	RemoteTakeBackCommand(ctx context.Context, data CommandRemoteHandData) (*RemoteStatusData, error)
}

// CommandRemoteHandData names an agent's tab by id or unique prefix; an empty Tab means the tab FromORef's
// block is in, so an agent can hand itself over.
type CommandRemoteHandData struct {
	Tab      string `json:"tab,omitempty"`
	FromORef string `json:"fromoref,omitempty"`
}

// CommandRemoteSetupData: Port 0 means the default port. A re-setup replaces every field it carries.
type CommandRemoteSetupData struct {
	TunnelToken string `json:"tunneltoken"`
	Team        string `json:"team"`
	Aud         string `json:"aud"`
	Email       string `json:"email"`
	Hostname    string `json:"hostname"`
	Port        int    `json:"port,omitempty"`
}

// RemoteStatusData never carries the tunnel token. Missing lists the setup fields not stored yet;
// Tunnel is "off", "starting", "up" or "down". Handed is the sorted tab ids handed to the phone.
type RemoteStatusData struct {
	On                 bool     `json:"on"`
	Missing            []string `json:"missing,omitempty"`
	Team               string   `json:"team,omitempty"`
	Aud                string   `json:"aud,omitempty"`
	Email              string   `json:"email,omitempty"`
	Hostname           string   `json:"hostname,omitempty"`
	Port               int      `json:"port,omitempty"`
	Tunnel             string   `json:"tunnel"`
	TunnelError        string   `json:"tunnelerror,omitempty"`
	Subscriptions      int      `json:"subscriptions"`
	CloudflaredMissing bool     `json:"cloudflaredmissing,omitempty"`
	Handed             []string `json:"handed,omitempty"`
}
