// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshrpc

import "context"

// MemHygieneCommands is the Setup surface's Memory tab: Arc checks each registered project's Claude
// Code auto memory (pkg/memhygiene), proposes changes with evidence, and applies only the accepted
// ones. These types are also the stored shape of a project's state file.
type MemHygieneCommands interface {
	ListMemoryHygieneCommand(ctx context.Context) (*CommandListMemoryHygieneRtnData, error)
	// starts a check and returns at once: a check runs model calls, which can't fit the rpc budget
	CheckMemoryHygieneCommand(ctx context.Context, data CommandCheckMemoryHygieneData) error
	DecideMemoryChangeCommand(ctx context.Context, data CommandDecideMemoryChangeData) (*MemHygieneProject, error)
}

const (
	MemVerdict_Apply  = "apply"
	MemVerdict_Keep   = "keep"
	MemVerdict_Undo   = "undo"
	MemVerdict_Reopen = "reopen"
)

type CommandListMemoryHygieneRtnData struct {
	Projects []MemHygieneProject `json:"projects"`
}

type CommandCheckMemoryHygieneData struct {
	Project string `json:"project"`
}

type CommandDecideMemoryChangeData struct {
	Project  string `json:"project"`
	ChangeId string `json:"changeid"`
	Verdict  string `json:"verdict"` // apply|keep|undo|reopen
}

type MemHygieneProject struct {
	Project      string         `json:"project"`
	Path         string         `json:"path"`
	CheckedAt    int64          `json:"checkedat"`   // unix ms; 0 = never checked
	NextCheckAt  int64          `json:"nextcheckat"` // unix ms, a week after the last attempt; 0 = never attempted
	Checking     bool           `json:"checking"`
	LastError    string         `json:"lasterror"` // the last failed check's reason; the last good result stays
	Memories     int            `json:"memories"`
	Sessions     int            `json:"sessions"`
	Folder       string         `json:"folder"`       // the memory folder its sessions load today
	SharedWith   []string       `json:"sharedwith"`   // other registered projects loading Folder; empty = its own
	OwnFolder    string         `json:"ownfolder"`    // split target; "" unless sharing or formerly sharing
	FormerShared string         `json:"formershared"` // the shared folder it loaded before switching over
	SwitchedAt   int64          `json:"switchedat"`
	Index        MemIndexStats  `json:"index"`              // Folder's MEMORY.md
	OwnIndex     *MemIndexStats `json:"ownindex,omitempty"` // OwnFolder's, during a split
	Changes      []MemChange    `json:"changes"`
}

type MemIndexStats struct {
	Exists bool `json:"exists"`
	Lines  int  `json:"lines"`
	Bytes  int  `json:"bytes"`
}

type MemChange struct {
	Id            string        `json:"id"`    // sha256 of kind + sorted file paths + their hashes; stable across checks
	Kind          string        `json:"kind"`  // delete|trim|merge|move-to-doc|add-to-index|move-here|copy-here|remove-shared|settings
	Group         string        `json:"group"` // ""|shared|own|switch (the split's three groups)
	Title         string        `json:"title"`
	Note          string        `json:"note"`
	ApplyLabel    string        `json:"applylabel"` // the rail button label
	Effect        string        `json:"effect"`     // the table cell
	Files         []MemFileRef  `json:"files"`      // every file the change touches, with sha256 at check time ("" = must not exist yet)
	Evidence      []MemEvidence `json:"evidence"`
	Diffs         []MemDiff     `json:"diffs"`
	IndexDelta    MemIndexDelta `json:"indexdelta"`    // effect on Folder's MEMORY.md
	OwnIndexDelta MemIndexDelta `json:"ownindexdelta"` // effect on OwnFolder's MEMORY.md
	Op            MemOp         `json:"op"`
	Status        string        `json:"status"`       // open|applied|kept|conflict
	ConflictFile  string        `json:"conflictfile"` // the file whose hash changed since the check
	DecidedAt     int64         `json:"decidedat"`
	BackupUntil   int64         `json:"backupuntil"`
	ApplyId       string        `json:"applyid"`
}

type MemFileRef struct {
	Path   string `json:"path"`
	Sha256 string `json:"sha256"`
}

type MemEvidence struct {
	Tone string `json:"tone"` // ok|warn|none
	Text string `json:"text"`
	Code string `json:"code"` // the monospace tail
}

type MemDiff struct {
	Path  string        `json:"path"`
	Note  string        `json:"note"`
	Lines []MemDiffLine `json:"lines"`
}

type MemDiffLine struct {
	Sign string `json:"sign"` // "-", "+" or " "
	Text string `json:"text"`
}

type MemIndexDelta struct {
	Lines int `json:"lines"`
	Bytes int `json:"bytes"`
}

// MemOp is what apply writes; folders are absolute.
type MemOp struct {
	Folder         string   `json:"folder"`      // the folder the memory files live in (the source, for split moves)
	Memories       []string `json:"memories"`    // memory file names in Folder the change acts on
	Old            string   `json:"old"`         // trim: the exact passage
	New            string   `json:"new"`         // trim: its replacement
	IndexRemove    []string `json:"indexremove"` // exact index lines removed from Folder's MEMORY.md
	IndexAdd       string   `json:"indexadd"`    // one index line added to IndexFolder's MEMORY.md
	IndexFolder    string   `json:"indexfolder"` // defaults to Folder
	WriteName      string   `json:"writename"`   // merge: the file written
	WriteBody      string   `json:"writebody"`
	DocPath        string   `json:"docpath"` // move-to-doc
	DocSection     string   `json:"docsection"`
	DocPassage     string   `json:"docpassage"`
	ToFolder       string   `json:"tofolder"`       // move-here / copy-here destination
	SettingsPath   string   `json:"settingspath"`   // settings: the file
	SettingsValue  string   `json:"settingsvalue"`  // settings: the autoMemoryDirectory value
	StripHarvester bool     `json:"stripharvester"` // add-to-index: drop source/source_hash/harvested_at
}
