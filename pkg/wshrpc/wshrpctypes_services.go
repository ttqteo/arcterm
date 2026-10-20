// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshrpc

import "context"

// ServicesCommands is the wire of held services (pkg/services): a tool with a page that wavesrv keeps running.
type ServicesCommands interface {
	ServicesStatusCommand(ctx context.Context) (*ServicesData, error)
	// ServiceOpenCommand makes sure the service has its tab and block, without starting it, and returns its status.
	ServiceOpenCommand(ctx context.Context, data CommandServiceData) (*ServiceStatus, error)
	ServiceStartCommand(ctx context.Context, data CommandServiceData) error
	ServiceStopCommand(ctx context.Context, data CommandServiceData) error
	ServiceRestartCommand(ctx context.Context, data CommandServiceData) error
	// ServiceSeenCommand reports the whole set of services on screen; each report replaces the last.
	ServiceSeenCommand(ctx context.Context, data CommandServiceSeenData) error
}

// ServiceStatus is one service as the cockpit shows it. It lives here, not in pkg/services, because wshrpc may not
// import a package that imports blockcontroller.
type ServiceStatus struct {
	Id        string `json:"id"`
	Name      string `json:"name"`
	Command   string `json:"command"` // the command line: command plus args
	Dir       string `json:"dir"`
	Project   string `json:"project"` // computed once in Go; the frontend never recomputes it
	State     string `json:"state"`
	Port      int    `json:"port,omitempty"`
	Url       string `json:"url,omitempty"`
	TabId     string `json:"tabid,omitempty"`
	BlockId   string `json:"blockid,omitempty"`
	StartedMs int64  `json:"startedms,omitempty"`
	ExitCode  int    `json:"exitcode,omitempty"`
	RetryAtMs int64  `json:"retryatms,omitempty"`
	Holder    string `json:"holder,omitempty"`
	Autostart bool   `json:"autostart"`
}

type ServicesData struct {
	Services []ServiceStatus `json:"services"`
}

type CommandServiceData struct {
	Id string `json:"id"`
}

type CommandServiceSeenData struct {
	Ids []string `json:"ids"`
}
