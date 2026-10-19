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
	Windows string `json:"windows,omitempty"` // a winget command line, or scoop for a tool winget lacks
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
	Url      string  `json:"url,omitempty"`      // a pinned app's page (AppURL): opening the tool shows it once the command serves it
	Dir      string  `json:"dir,omitempty"`      // the folder the tool runs in, in place of OpensIn; ~ is home
	Detected bool    `json:"detected,omitempty"` // from Detected(): suggested once its command is found, a library tool once added
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
// a Windows and a Mac line; mole's Windows line is scoop, its only package manager there (its README, 2026-10-19).
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
			Id: "mole", Name: "mole", Category: "System", Purpose: "System: clean caches, uninstall apps, see what fills the disk",
			Command: "mo", OpensIn: OpensInHome, Shows: ShowsCentre,
			Install: Install{Windows: "scoop install mole", Darwin: "brew install mole"},
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

// Detected is the wider list of TUIs the library recognises but does not offer: one shows under "Found on this machine"
// only once its command is found, and joins the library when the user adds it (a tools.json entry of its id, which
// Merge lays over it like any built-in). Only tools that open usefully with no argument are here, and none carries an
// install line: the library never offers to install one.
func Detected() []Tool {
	tool := func(id, category, purpose, command, opensIn string) Tool {
		return Tool{Id: id, Name: id, Category: category, Purpose: purpose, Command: command, OpensIn: opensIn, Shows: ShowsCentre, Detected: true}
	}
	return []Tool{
		tool("tig", "Git", "Git: browse the log, blame and staged changes", "tig", OpensInAgent),
		tool("gitu", "Git", "Git: a Magit-style client for staging and commits", "gitu", OpensInAgent),
		tool("nnn", "Files", "Files: a tiny, fast file manager", "nnn", OpensInAgent),
		tool("lf", "Files", "Files: a ranger-style file manager", "lf", OpensInAgent),
		tool("ranger", "Files", "Files: browse with Vim keys and previews", "ranger", OpensInAgent),
		tool("xplr", "Files", "Files: a hackable file explorer", "xplr", OpensInAgent),
		tool("superfile", "Files", "Files: a file manager with panels", "spf", OpensInAgent),
		tool("serpl", "Files", "Files: search and replace across a project", "serpl", OpensInAgent),
		tool("termscp", "Files", "Files: copy over SCP, SFTP, FTP and S3", "termscp", OpensInHome),
		tool("ncdu", "System", "Disk: see what fills a folder", "ncdu", OpensInAgent),
		tool("gdu", "System", "Disk: a fast disk usage analyser", "gdu", OpensInAgent),
		{Id: "dua", Name: "dua", Category: "System", Purpose: "Disk: see and delete what fills a folder", Command: "dua", Args: "i",
			OpensIn: OpensInAgent, Shows: ShowsCentre, Detected: true},
		tool("bottom", "System", "System: CPU, memory, network and processes", "btm", OpensInHome),
		tool("htop", "System", "System: processes and their load", "htop", OpensInHome),
		tool("glances", "System", "System: everything the machine is doing on one screen", "glances", OpensInHome),
		tool("zenith", "System", "System: processes with charts of their load", "zenith", OpensInHome),
		tool("ctop", "Containers", "Containers: live metrics of each container", "ctop", OpensInHome),
		tool("oxker", "Containers", "Docker: containers, logs and stats", "oxker", OpensInHome),
		tool("podman-tui", "Containers", "Podman: containers, pods and images", "podman-tui", OpensInHome),
		tool("lazysql", "Docs and data", "Data: query and browse SQL databases", "lazysql", OpensInAgent),
		tool("harlequin", "Docs and data", "Data: a SQL IDE for DuckDB, SQLite and more", "harlequin", OpensInAgent),
		tool("posting", "Docs and data", "HTTP: build and send API requests", "posting", OpensInAgent),
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
