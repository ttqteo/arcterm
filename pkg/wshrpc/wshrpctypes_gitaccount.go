// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshrpc

import "context"

type GitAccountCommands interface {
	GitAccountListCommand(ctx context.Context) (*GitAccountListRtnData, error)
	GitAccountCheckTokenCommand(ctx context.Context, data CommandGitAccountTokenData) (*GitHubUserData, error) // asks GitHub who the token belongs to; stores nothing
	GitAccountAddCommand(ctx context.Context, data CommandGitAccountAddData) (*GitAccountData, error)          // the token is stored, never returned
	GitAccountUpdateCommand(ctx context.Context, data CommandGitAccountUpdateData) error                       // "" keeps a field
	GitAccountSetTokenCommand(ctx context.Context, data CommandGitAccountTokenData) error
	GitAccountRemoveCommand(ctx context.Context, data CommandGitAccountLoginData) error
	GitAccountSetDefaultCommand(ctx context.Context, data CommandGitAccountLoginData) error
	GitAccountAddRootCommand(ctx context.Context, data CommandGitAccountRootData) error
	GitAccountRemoveRootCommand(ctx context.Context, data CommandGitAccountRootData) error
	GitAccountTokenStateCommand(ctx context.Context, data CommandGitAccountLoginData) (*GitAccountTokenStateData, error)
	GitAccountScanCommand(ctx context.Context) (*GitAccountScanRtnData, error)
	GitAccountFixCommand(ctx context.Context, data CommandGitAccountFixData) (*GitAccountFixRtnData, error)
}

type GitAccountData struct {
	Login string   `json:"login"`
	Name  string   `json:"name,omitempty"`
	Email string   `json:"email,omitempty"`
	Roots []string `json:"roots"`
}

type GitAccountListRtnData struct {
	Accounts      []GitAccountData `json:"accounts"`
	DefaultLogin  string           `json:"defaultlogin,omitempty"`
	GlobalName    string           `json:"globalname,omitempty"`
	GlobalEmail   string           `json:"globalemail,omitempty"`
	DefaultHelper string           `json:"defaulthelper,omitempty"`
}

type GitHubUserData struct {
	Login string `json:"login"`
	Name  string `json:"name,omitempty"`
	Email string `json:"email,omitempty"`
}

type CommandGitAccountTokenData struct {
	Login string `json:"login"`
	Token string `json:"token"`
}

type CommandGitAccountAddData struct {
	Login        string `json:"login"`
	Token        string `json:"token"`
	Name         string `json:"name,omitempty"`
	Email        string `json:"email,omitempty"`
	Root         string `json:"root,omitempty"`
	DefaultLogin string `json:"defaultlogin,omitempty"`
}

type CommandGitAccountUpdateData struct {
	Login string `json:"login"`
	Name  string `json:"name,omitempty"`
	Email string `json:"email,omitempty"`
}

type CommandGitAccountLoginData struct {
	Login string `json:"login"`
}

type CommandGitAccountRootData struct {
	Login string `json:"login"`
	Root  string `json:"root"`
}

type GitAccountTokenStateData struct {
	State  string `json:"state"` // saved | refused | missing | unreachable
	Detail string `json:"detail,omitempty"`
}

type GitRepoRemoteData struct {
	Path      string `json:"path"`
	Remote    string `json:"remote"`
	MaskedUrl string `json:"maskedurl"`
}

type GitRepoIdentityData struct {
	Path  string `json:"path"`
	Name  string `json:"name,omitempty"`
	Email string `json:"email,omitempty"`
}

type GitAccountScanData struct {
	Login         string                `json:"login"`
	Repos         int                   `json:"repos"`
	TokenRepos    []GitRepoRemoteData   `json:"tokenrepos"`
	IdentityRepos []GitRepoIdentityData `json:"identityrepos"`
}

type GitAccountScanRtnData struct {
	Accounts         []GitAccountScanData `json:"accounts"`
	CredentialsLines int                  `json:"credentialslines"`
	Errors           []string             `json:"errors,omitempty"`
}

type CommandGitAccountFixData struct {
	Login         string   `json:"login"`
	TokenRepos    []string `json:"tokenrepos,omitempty"`
	IdentityRepos []string `json:"identityrepos,omitempty"`
	Credentials   bool     `json:"credentials,omitempty"`
}

type GitFixResultData struct {
	Kind  string `json:"kind"` // token | identity | credentials
	Path  string `json:"path,omitempty"`
	Error string `json:"error,omitempty"`
}

type GitAccountFixRtnData struct {
	Results []GitFixResultData `json:"results"`
}
