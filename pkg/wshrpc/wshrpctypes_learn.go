// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshrpc

import "context"

type LearnCommands interface {
	LearnNoteCommand(ctx context.Context, data CommandLearnNoteData) (*CommandLearnNoteRtnData, error)
	LearnKeysCommand(ctx context.Context, data CommandLearnKeysData) ([]LearnKey, error)
	LearnDecideCommand(ctx context.Context, data CommandLearnDecideData) error
	LearnAcceptedCommand(ctx context.Context) (*CommandLearnAcceptedRtnData, error)
	LearnAmendCommand(ctx context.Context, data CommandLearnAmendData) error
}

type CommandLearnNoteData struct {
	Key     string `json:"key"`
	Skill   string `json:"skill,omitempty"` // a vault skill; empty with Cwd set means memory
	Cwd     string `json:"cwd,omitempty"`
	Text    string `json:"text"`
	Quote   string `json:"quote,omitempty"`
	Session string `json:"session"`
}

type CommandLearnNoteRtnData struct {
	Proposed bool `json:"proposed"` // this note made (or kept) a pending proposal
	Muted    bool `json:"muted"`    // the user dismissed this key before; nothing was noted
}

type CommandLearnKeysData struct {
	Skill string `json:"skill,omitempty"`
	Cwd   string `json:"cwd,omitempty"`
}

type LearnKey struct {
	Key   string `json:"key"`
	Text  string `json:"text"`
	Notes int    `json:"notes"`
}

type CommandLearnDecideData struct {
	ID     string `json:"id"`
	Accept bool   `json:"accept"`         // false dismisses and mutes
	Text   string `json:"text,omitempty"` // the edited line; empty keeps the proposal's
}

// LearnAddition is one accepted line; Learned is a local date (YYYY-MM-DD).
type LearnAddition struct {
	Key     string `json:"key"`
	Text    string `json:"text"`
	Learned string `json:"learned"`
	Count   int    `json:"count"`
}

type LearnedSkillLine struct {
	Skill string `json:"skill"`
	LearnAddition
}

type LearnedMemoryLine struct {
	Cwd string `json:"cwd"`
	Dir string `json:"dir"`
	LearnAddition
}

type CommandLearnAcceptedRtnData struct {
	Skills   []LearnedSkillLine  `json:"skills"`
	Memories []LearnedMemoryLine `json:"memories"`
}

type CommandLearnAmendData struct {
	Skill  string `json:"skill,omitempty"` // a skill line, or
	Dir    string `json:"dir,omitempty"`   // a memory dir (with Cwd for the mute id)
	Cwd    string `json:"cwd,omitempty"`
	Key    string `json:"key"`
	Text   string `json:"text,omitempty"`
	Remove bool   `json:"remove"`
}
