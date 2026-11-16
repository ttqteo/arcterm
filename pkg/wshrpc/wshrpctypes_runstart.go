// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshrpc

import "context"

// Choosing when a run starts (spec 2026-11-16-run-start-choice-design.md): the launcher asks what Jarvis suggests for
// the run it is about to start (now, after the live runs that edit the same files, or in the queue) and why.

// RunStartSuggestion.Choice values.
const (
	RunStartChoice_Now   = "now"   // start at once
	RunStartChoice_After = "after" // queue, waiting for the runs in After
	RunStartChoice_Queue = "queue" // queue, waiting only for room under the cap
)

// RunStartCommands is how the run launcher asks for the suggestion.
type RunStartCommands interface {
	RunStartSuggestCommand(ctx context.Context, data CommandRunStartSuggestData) (*RunStartSuggestion, error) // what to suggest for a run about to start, with the live runs the After list draws
}

// CommandRunStartSuggestData describes the run about to start. The launcher may have no channel yet (it is minted at
// Start), so ProjectPath is the key.
type CommandRunStartSuggestData struct {
	ChannelId   string `json:"channelid,omitempty"`
	ProjectPath string `json:"projectpath"`
	Goal        string `json:"goal"`
	PlanPath    string `json:"planpath,omitempty"` // absolute, or relative to ProjectPath
	SpecPath    string `json:"specpath,omitempty"` // absolute
}

// RunStartSuggestion is what the launcher's When row shows: the choice Jarvis preselects, why, and every live run of
// the project for the After list.
type RunStartSuggestion struct {
	Choice    string            `json:"choice"`              // RunStartChoice_*
	After     []string          `json:"after,omitempty"`     // the run ids After starts out ticked on
	Reason    string            `json:"reason"`              // one line, shown under the buttons
	QuotaNote string            `json:"quotanote,omitempty"` // empty when quota is fine; never changes Choice
	Live      []RunStartLiveRun `json:"live"`                // every live run of the same project
	Active    int               `json:"active"`              // top-level runs not done or cancelled, across every project
	MaxActive int               `json:"maxactive"`           // runs:maxactive as the queue reads it; 0 is no cap
}

// RunStartLiveRun is a live run the new one could wait for.
type RunStartLiveRun struct {
	RunId      string   `json:"runid"`
	Title      string   `json:"title"`
	Files      []string `json:"files,omitempty"`      // the files it shares with the new run
	Held       bool     `json:"held,omitempty"`       // its land is held: it cannot be waited for until it lands
	HeldReason string   `json:"heldreason,omitempty"` // why it is held
}
