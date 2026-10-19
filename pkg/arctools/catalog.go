// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package arctools is arcterm's library of terminal tools (TUIs): the built-in catalog, the user's own entries from
// tools.json, and whether each one's command resolves on this machine.
package arctools

import (
	"net/url"
	"sort"

	"github.com/wavetermdev/waveterm/pkg/wconfig"
)

type Install struct {
	Windows string `json:"windows,omitempty"` // a winget command line
	Darwin  string `json:"darwin,omitempty"`  // a brew command line
}

type Tool struct {
	Id       string  `json:"id"`
	Name     string  `json:"name"`
	Category string  `json:"category"` // "Git", "Files", "System", "Containers", "Docs and data", "Yours"
	Purpose  string  `json:"purpose"`
	Command  string  `json:"command"`         // the program, e.g. "lazygit"
	Args     string  `json:"args,omitempty"`  // appended to Command as typed
	Needs    string  `json:"needs,omitempty"` // the program the status check looks up in Command's place, for a tool wsh runs
	OpensIn  string  `json:"opensin"`         // "agent" (the focused agent's folder), "root" (project root), "home"
	Shows    string  `json:"shows"`           // "centre" or "panel"
	Install  Install `json:"install"`
	User     bool    `json:"user,omitempty"`
	Url      string  `json:"url,omitempty"` // a pinned app's page (AppURL): opening the tool shows it once the command serves it
	Dir      string  `json:"dir,omitempty"` // the folder the tool runs in, in place of OpensIn; ~ is home
}

const (
	CategoryYours = "Yours" // the category of a tool that is only in tools.json

	OpensInAgent = "agent"
	OpensInRoot  = "root"
	OpensInHome  = "home"

	ShowsCentre = "centre"
	ShowsPanel  = "panel"
)

// Builtin is the catalog arcterm ships, in the order the library lists it. The winget ids were checked against the
// winget source on 2026-10-13 (`winget show --id <id> --exact`; the btop4win command alias from its manifest). visidata
// and translate-shell are the Mac-only tools, with no Windows line: neither has a winget package. Every other tool has
// a Windows and a Mac line.
// An entry's Command is the executable the status check looks up on PATH, or its Needs when it has one: wsh is on the
// terminal's PATH but not wavesrv's, and what a tool run through wsh needs installed is another program.
func Builtin() []Tool {
	return []Tool{
		{
			Id: "lazygit", Name: "lazygit", Category: "Git", Purpose: "Git: stage single lines, commit, branch, rebase",
			Command: "lazygit", OpensIn: OpensInAgent, Shows: ShowsCentre,
			Install: Install{Windows: "winget install --id JesseDuffield.lazygit -e", Darwin: "brew install lazygit"},
		},
		{
			Id: "gitui", Name: "gitui", Category: "Git", Purpose: "Git: a fast terminal client for status, staging and log",
			Command: "gitui", OpensIn: OpensInAgent, Shows: ShowsCentre,
			Install: Install{Windows: "winget install --id StephanDilly.gitui -e", Darwin: "brew install gitui"},
		},
		{
			Id: "yazi", Name: "yazi", Category: "Files", Purpose: "Files: browse, preview, rename, move",
			Command: "yazi", OpensIn: OpensInAgent, Shows: ShowsCentre,
			Install: Install{Windows: "winget install --id sxyazi.yazi -e", Darwin: "brew install yazi"},
		},
		{
			Id: "broot", Name: "broot", Category: "Files", Purpose: "Files: a fuzzy tree view of a big folder",
			Command: "broot", OpensIn: OpensInAgent, Shows: ShowsCentre,
			Install: Install{Windows: "winget install --id Dystroy.broot -e", Darwin: "brew install broot"},
		},
		{
			Id: "btop", Name: "btop", Category: "System", Purpose: "System: CPU, memory, processes",
			Command: "btop", OpensIn: OpensInHome, Shows: ShowsCentre,
			Install: Install{Windows: "winget install --id aristocratos.btop4win -e", Darwin: "brew install btop"},
		},
		{
			Id: "lazydocker", Name: "lazydocker", Category: "Containers", Purpose: "Docker: containers, images, logs",
			Command: "lazydocker", OpensIn: OpensInAgent, Shows: ShowsCentre,
			Install: Install{Windows: "winget install --id JesseDuffield.Lazydocker -e", Darwin: "brew install lazydocker"},
		},
		{
			Id: "k9s", Name: "k9s", Category: "Containers", Purpose: "Kubernetes: browse and manage a cluster",
			Command: "k9s", OpensIn: OpensInAgent, Shows: ShowsCentre,
			Install: Install{Windows: "winget install --id Derailed.k9s -e", Darwin: "brew install k9s"},
		},
		{
			Id: "glow", Name: "glow", Category: "Docs and data", Purpose: "Markdown: read docs and plans in the terminal",
			Command: "glow", OpensIn: OpensInAgent, Shows: ShowsCentre,
			Install: Install{Windows: "winget install --id charmbracelet.glow -e", Darwin: "brew install glow"},
		},
		{
			Id: "visidata", Name: "visidata", Category: "Docs and data", Purpose: "Data: explore CSV, JSON and SQLite tables",
			Command: "vd", OpensIn: OpensInAgent, Shows: ShowsCentre,
			Install: Install{Darwin: "brew install visidata"},
		},
		{
			Id: "trans", Name: "translate-shell", Category: "Docs and data", Purpose: "Translate: a word with its dictionary entry, or whole sentences",
			Command: "wsh", Needs: "trans", OpensIn: OpensInHome, Shows: ShowsCentre,
			// wsh trans (cmd/wsh/cmd/wshcmd-trans.go) hands each line to translate-shell and prints the answer short;
			// trans's own shell prints a word's whole dictionary entry, each meaning on two lines. It runs itself under
			// rlwrap for history. Into Vietnamese only, as Google Translate's English → Vietnamese, and :en typed at its
			// prompt turns it around
			Args:    "trans :vi",
			Install: Install{Darwin: "brew install translate-shell rlwrap"},
		},
	}
}

func validOpensIn(v string) bool {
	return v == OpensInAgent || v == OpensInRoot || v == OpensInHome
}

func validShows(v string) bool {
	return v == ShowsCentre || v == ShowsPanel
}

// AppURL reports whether u is a page a pinned app may show: http on 127.0.0.1 with a port. arcterm embeds only what
// this machine serves (the CSP's frame-src is http://127.0.0.1:*), so localhost, another host and https are refused.
func AppURL(u string) bool {
	parsed, err := url.Parse(u)
	if err != nil {
		return false
	}
	return parsed.Scheme == "http" && parsed.Hostname() == "127.0.0.1" && parsed.Port() != "" && parsed.User == nil
}

// Merge lays the user's tools.json entries over the built-in catalog and returns a new slice (builtin is not
// changed). A user entry whose id matches a built-in overrides it in the built-in's slot: the fields the entry sets
// win, the ones it leaves empty stay the built-in's, and User is true. Entries with no matching built-in follow, sorted
// by id, as the "Yours" category; their empty name falls back to the id, an empty or unknown opensin to "agent" and
// an empty or unknown shows to "centre".
func Merge(builtin []Tool, user map[string]wconfig.ToolKeywords) []Tool {
	out := make([]Tool, 0, len(builtin)+len(user))
	isBuiltin := make(map[string]bool, len(builtin))
	for _, b := range builtin {
		isBuiltin[b.Id] = true
		if u, ok := user[b.Id]; ok {
			b = override(b, u)
		}
		out = append(out, b)
	}
	var ids []string
	for id := range user {
		if !isBuiltin[id] {
			ids = append(ids, id)
		}
	}
	sort.Strings(ids)
	for _, id := range ids {
		out = append(out, override(Tool{Id: id, Name: id, Category: CategoryYours, OpensIn: OpensInAgent, Shows: ShowsCentre}, user[id]))
	}
	return out
}

// override applies a tools.json entry to base, the built-in it overrides or the defaults of a user-only tool.
func override(base Tool, u wconfig.ToolKeywords) Tool {
	base.User = true
	if u.Name != "" {
		base.Name = u.Name
	}
	// a command of the user's own needs only itself: the built-in's Needs went with the built-in's command
	if u.Command != "" {
		base.Command = u.Command
		base.Needs = ""
	}
	if u.Args != "" {
		base.Args = u.Args
	}
	if u.Purpose != "" {
		base.Purpose = u.Purpose
	}
	if validOpensIn(u.OpensIn) {
		base.OpensIn = u.OpensIn
	}
	if validShows(u.Shows) {
		base.Shows = u.Shows
	}
	if u.InstallWindows != "" {
		base.Install.Windows = u.InstallWindows
	}
	if u.InstallDarwin != "" {
		base.Install.Darwin = u.InstallDarwin
	}
	// a url arcterm would not embed is dropped, so the tool opens as a plain terminal rather than a page that never loads
	if AppURL(u.Url) {
		base.Url = u.Url
	}
	if u.Dir != "" {
		base.Dir = u.Dir
	}
	return base
}
