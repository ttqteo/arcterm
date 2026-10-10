// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package waveobj

import (
	"strings"
)

const Entity_Any = "any"

// for typescript typing
type MetaTSType struct {
	// shared
	View       string   `json:"view,omitempty"`
	Controller string   `json:"controller,omitempty"`
	File       string   `json:"file,omitempty"`
	Connection string   `json:"connection,omitempty"`
	Edit       bool     `json:"edit,omitempty"`
	History    []string `json:"history,omitempty"`

	DisplayName  string  `json:"display:name,omitempty"`
	DisplayOrder float64 `json:"display:order,omitempty"`

	Icon string `json:"icon,omitempty"`

	CmdClear            bool     `json:"cmd:*,omitempty"`
	Cmd                 string   `json:"cmd,omitempty"`
	CmdInteractive      bool     `json:"cmd:interactive,omitempty"`
	CmdRunOnStart       bool     `json:"cmd:runonstart,omitempty"`
	CmdClearOnStart     bool     `json:"cmd:clearonstart,omitempty"`
	CmdRunOnce          bool     `json:"cmd:runonce,omitempty"`
	CmdCloseOnExit      bool     `json:"cmd:closeonexit,omitempty"`
	CmdCloseOnExitForce bool     `json:"cmd:closeonexitforce,omitempty"`
	CmdKeepOnExit       bool     `json:"cmd:keeponexit,omitempty"` // agent blocks close on exit unless they opt out
	CmdCloseOnExitDelay float64  `json:"cmd:closeonexitdelay,omitempty"`
	CmdNoWsh            bool     `json:"cmd:nowsh,omitempty"`
	CmdArgs             []string `json:"cmd:args,omitempty"`  // args for cmd (only if cmd:shell is false)
	CmdShell            bool     `json:"cmd:shell,omitempty"` // shell expansion for cmd+args (defaults to true)
	CmdJwt              bool     `json:"cmd:jwt,omitempty"`   // force adding JWT to environment

	// these can be nested under "[conn]"
	CmdEnv            map[string]string `json:"cmd:env,omitempty"`
	CmdCwd            string            `json:"cmd:cwd,omitempty"`
	CmdInitScript     string            `json:"cmd:initscript,omitempty"`
	CmdInitScriptSh   string            `json:"cmd:initscript.sh,omitempty"`
	CmdInitScriptBash string            `json:"cmd:initscript.bash,omitempty"`
	CmdInitScriptZsh  string            `json:"cmd:initscript.zsh,omitempty"`
	CmdInitScriptPwsh string            `json:"cmd:initscript.pwsh,omitempty"`
	CmdInitScriptFish string            `json:"cmd:initscript.fish,omitempty"`

	EditorClear               bool    `json:"editor:*,omitempty"`
	EditorMinimapEnabled      bool    `json:"editor:minimapenabled,omitempty"`
	EditorStickyScrollEnabled bool    `json:"editor:stickyscrollenabled,omitempty"`
	EditorWordWrap            bool    `json:"editor:wordwrap,omitempty"`
	EditorFontSize            float64 `json:"editor:fontsize,omitempty"`

	TermClear               bool     `json:"term:*,omitempty"`
	TermFontSize            int      `json:"term:fontsize,omitempty"`
	TermFontFamily          string   `json:"term:fontfamily,omitempty"`
	TermLocalShellPath      string   `json:"term:localshellpath,omitempty"` // matches settings
	TermLocalShellOpts      []string `json:"term:localshellopts,omitempty"` // matches settings
	TermScrollback          *int     `json:"term:scrollback,omitempty"`
	TermAllowBracketedPaste *bool    `json:"term:allowbracketedpaste,omitempty"`
	TermShiftEnterNewline   *bool    `json:"term:shiftenternewline,omitempty"`
	TermMacOptionIsMeta     *bool    `json:"term:macoptionismeta,omitempty"`
	TermCursor              string   `json:"term:cursor,omitempty"`
	TermCursorBlink         *bool    `json:"term:cursorblink,omitempty"`
	TermConnDebug           string   `json:"term:conndebug,omitempty"` // null, info, debug
	TermBellIndicator       *bool    `json:"term:bellindicator,omitempty"`
	TermOsc52               string   `json:"term:osc52,omitempty"`

	// for session sidebar (Wave Agent Sessions fork)
	SessionPinned          bool             `json:"session:pinned,omitempty"`          // tab
	SessionAgent           string           `json:"session:agent,omitempty"`           // tab
	SessionLabel           string           `json:"session:label,omitempty"`           // tab (user-set custom name; overrides the agent-derived row label)
	SessionProject         string           `json:"session:project,omitempty"`         // tab (launch-time project name; roster group + boot label below the ai-title)
	SessionEffort          string           `json:"session:effort,omitempty"`          // tab ("effort:<oid>": the initiative the session was launched from, or last read or wrote through `wsh effort`)
	SessionCollapsedGroups []string         `json:"session:collapsedgroups,omitempty"` // workspace
	SessionLater           map[string]int64 `json:"session:later,omitempty"`           // workspace (session id, its transcript's file stem -> when it was marked for later)
	SessionHelper          bool             `json:"session:helper,omitempty"`          // tab (a short-lived helper terminal, e.g. the Claude sign-in dialog's; the sidebar skips it)

	// for loom git client (Wave Agent Sessions fork)
	AppLoom bool `json:"app:loom,omitempty"` // block (marks the live loom block for toggle)

	// for agent hook-stamped metadata (Wave Agent Sessions fork)
	AgentTranscriptPath string `json:"agent:transcriptpath,omitempty"` // block (path to the running agent's transcript file)
	AgentLoginEmail     string `json:"agent:loginemail,omitempty"`     // block (a Default claude session's /login email at SessionStart, lowercased; its usage belongs to that account)
	AgentSleeping       int64  `json:"agent:sleeping,omitempty"`       // block (unix ms the agent was put to sleep; 0 or absent = awake)
	AgentSleepFreed     int64  `json:"agent:sleepfreed,omitempty"`     // block (bytes of RAM its sleep freed)
	AgentWakeFailed     string `json:"agent:wakefailed,omitempty"`     // block (why the last wake did not come back; the agent stays sleeping while it is set)

	Count int `json:"count,omitempty"` // temp for cpu plot. will remove later
}

// returns a clean copy of meta with mergeMeta merged in
// if mergeSpecial is false, then special keys will not be merged (like display:*)
func MergeMeta(meta MetaMapType, metaUpdate MetaMapType, mergeSpecial bool) MetaMapType {
	rtn := make(MetaMapType)
	for k, v := range meta {
		rtn[k] = v
	}
	// deal with "section:*" keys
	for k := range metaUpdate {
		if !strings.HasSuffix(k, ":*") {
			continue
		}
		if !metaUpdate.GetBool(k, false) {
			continue
		}
		prefix := strings.TrimSuffix(k, ":*")
		if prefix == "" {
			continue
		}
		// delete "[prefix]" and all keys that start with "[prefix]:"
		prefixColon := prefix + ":"
		for k2 := range rtn {
			if k2 == prefix || strings.HasPrefix(k2, prefixColon) {
				delete(rtn, k2)
			}
		}
	}
	// now deal with regular keys
	for k, v := range metaUpdate {
		if !mergeSpecial && strings.HasPrefix(k, "display:") {
			continue
		}
		if strings.HasSuffix(k, ":*") {
			continue
		}
		if v == nil {
			delete(rtn, k)
			continue
		}
		rtn[k] = v
	}
	return rtn
}
