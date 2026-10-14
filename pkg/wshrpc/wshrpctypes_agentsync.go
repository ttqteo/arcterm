// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshrpc

import "context"

type AgentSyncCommands interface {
	AgentSyncStatusCommand(ctx context.Context) (*CommandAgentSyncStatusRtnData, error)
	AgentSyncSteeringReadCommand(ctx context.Context) (*CommandAgentSyncSteeringReadRtnData, error)
	AgentSyncSteeringWriteCommand(ctx context.Context, data CommandAgentSyncSteeringWriteData) (*CommandAgentSyncSteeringWriteRtnData, error)
	AgentSyncApplyCommand(ctx context.Context, data CommandAgentSyncApplyData) (*CommandAgentSyncApplyRtnData, error)
	AgentSyncAdoptCommand(ctx context.Context, data CommandAgentSyncAdoptData) (*CommandAgentSyncAdoptRtnData, error)
	AgentSyncSkillsCommand(ctx context.Context) (*CommandAgentSyncSkillsRtnData, error)
	ClaudeContextCommand(ctx context.Context, data CommandClaudeContextData) (*CommandClaudeContextRtnData, error)
}

type AgentSyncHarness struct {
	Runtime         string `json:"runtime"`
	Label           string `json:"label"`
	Path            string `json:"path"`
	Present         bool   `json:"present"`
	Steering        string `json:"steering"`
	SkillsManaged   int    `json:"skillsmanaged"`
	SkillsUnmanaged int    `json:"skillsunmanaged"`
	Note            string `json:"note,omitempty"`
}

type AgentSyncAction struct {
	Kind    string `json:"kind"`
	Runtime string `json:"runtime"`
	Path    string `json:"path"`
	Detail  string `json:"detail,omitempty"`
}

type CommandAgentSyncStatusRtnData struct {
	Harnesses   []AgentSyncHarness `json:"harnesses"`
	SteeringDoc string             `json:"steeringdoc"`
	SkillsRoot  string             `json:"skillsroot"`
}

type CommandAgentSyncApplyData struct {
	DryRun bool `json:"dryrun,omitempty"`
}

type CommandAgentSyncApplyRtnData struct {
	Actions []AgentSyncAction `json:"actions"`
}

type CommandAgentSyncAdoptData struct {
	Apply bool `json:"apply,omitempty"`
	// Keep maps a skill name to the runtime whose copy seeds it; every other copy is set aside.
	Keep map[string]string `json:"keep,omitempty"`
}

// AgentSyncSkillMove is one harness-local skill tree folded into the vault. Seed marks the copy that
// becomes the shared tree; Keys and Files are what a later copy overrides.
type AgentSyncSkillMove struct {
	Runtime  string   `json:"runtime"`
	Name     string   `json:"name"`
	From     string   `json:"from"`
	Seed     bool     `json:"seed"`
	Keys     []string `json:"keys,omitempty"`
	Files    []string `json:"files,omitempty"`
	BodyDiff bool     `json:"bodydiff"`
}

type CommandAgentSyncAdoptRtnData struct {
	Moves      []AgentSyncSkillMove `json:"moves,omitempty"`
	Unresolved []string             `json:"unresolved,omitempty"`
}

type CommandAgentSyncSteeringReadRtnData struct {
	Path    string `json:"path"`
	Content string `json:"content"`
	Mtime   int64  `json:"mtime"`
}

type CommandAgentSyncSteeringWriteData struct {
	Content   string `json:"content"`
	BaseMtime int64  `json:"basemtime"`
}

type CommandAgentSyncSteeringWriteRtnData struct {
	Mtime    int64 `json:"mtime"`
	Conflict bool  `json:"conflict"`
}

// AgentSyncSkill is one canonical skill and its state in each harness that scans a skills directory.
type AgentSyncSkill struct {
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	// States maps runtime -> synced | differs | unmanaged | absent.
	States map[string]string `json:"states"`
	// Deltas maps runtime -> the frontmatter keys and sidecar files it overrides.
	Deltas map[string][]string `json:"deltas,omitempty"`
	// Additions are the lines the user accepted into this skill; the vault's SKILL.md never holds them.
	Additions []LearnAddition `json:"additions,omitempty"`
}

// AgentSyncSkillColumn is one column of the skills matrix: a harness with a fixed skills directory.
type AgentSyncSkillColumn struct {
	Runtime string `json:"runtime"`
	Label   string `json:"label"`
	Present bool   `json:"present"`
}

type CommandAgentSyncSkillsRtnData struct {
	Skills     []AgentSyncSkill       `json:"skills"`
	Columns    []AgentSyncSkillColumn `json:"columns"`
	SkillsRoot string                 `json:"skillsroot"`
	// Unmanaged and Unresolved are what an adopt would do, ungrouped: the frontend groups them.
	Unmanaged  []AgentSyncSkillMove `json:"unmanaged"`
	Unresolved []string             `json:"unresolved"`
}

type CommandClaudeContextData struct {
	Path string `json:"path"`
}

// ClaudeContextFile is one row of Setup → Project (pkg/claudecontext.File).
type ClaudeContextFile struct {
	Group       string `json:"group"` // instructions | memory | settings | skills | setup | global
	Path        string `json:"path"`
	Label       string `json:"label"`
	Exists      bool   `json:"exists"`
	Size        int64  `json:"size,omitempty"`
	ModTs       int64  `json:"modts,omitempty"`
	Note        string `json:"note,omitempty"`
	Description string `json:"description,omitempty"`
}

type CommandClaudeContextRtnData struct {
	Files []ClaudeContextFile `json:"files"`
}
