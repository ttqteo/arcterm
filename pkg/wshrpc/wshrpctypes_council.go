// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshrpc

import (
	"context"

	"github.com/wavetermdev/waveterm/pkg/council"
)

// CouncilCommands are the Council: a panel of expert agents that reviews one feature in three rounds. The cockpit
// starts one from Setup, an agent with `wsh council start`; both read it back through Get and List and learn of every
// change from the council:changed event. A command that changes a council returns once the change is saved: the
// rounds run in wavesrv after it.
type CouncilCommands interface {
	CouncilStartCommand(ctx context.Context, data CommandCouncilStartData) (*council.Council, error)
	CouncilListCommand(ctx context.Context, data CommandCouncilListData) ([]*council.Council, error)
	CouncilGetCommand(ctx context.Context, data CommandCouncilIdData) (*council.Council, error)
	CouncilReplyCommand(ctx context.Context, data CommandCouncilReplyData) error
	CouncilContinueCommand(ctx context.Context, data CommandCouncilContinueData) error
	CouncilSummarizeCommand(ctx context.Context, data CommandCouncilIdData) error
	CouncilStopCommand(ctx context.Context, data CommandCouncilIdData) error
	CouncilRetryCommand(ctx context.Context, data CommandCouncilRetryData) error
	CouncilSuggestCommand(ctx context.Context, data CommandCouncilSuggestData) (*council.CouncilSuggestion, error)
	CouncilEstimateCommand(ctx context.Context, data CommandCouncilEstimateData) (*CouncilEstimateRtnData, error)
	CouncilSaveDocCommand(ctx context.Context, data CommandCouncilSaveDocData) (*CouncilSaveDocRtnData, error)
	CouncilRolesCommand(ctx context.Context) (*CouncilRolesRtnData, error)
	CouncilSaveGroupCommand(ctx context.Context, data council.CouncilGroup) error
}

// CommandCouncilStartData starts a council. Id alone starts the saved not-run council of that id and every other
// field is ignored. Otherwise Experts is the panel (the coordinator last, as council.ExpertsFor builds it) and, when
// empty, the panel of Group. NotRun saves the council as not-run and starts nothing, for a start the token gate
// refused: Start council in the app runs it later. Mode is council.ModeReview or council.ModeBrainstorm (empty is
// review; any other word is refused) and ModeWhy the one-line reason it was picked.
type CommandCouncilStartData struct {
	Id          string                  `json:"id,omitempty"`
	Project     string                  `json:"project,omitempty"`
	Feature     string                  `json:"feature,omitempty"`
	Question    string                  `json:"question,omitempty"`
	Files       []string                `json:"files,omitempty"`
	Screenshots []string                `json:"screenshots,omitempty"`
	Group       string                  `json:"group,omitempty"`
	Experts     []council.CouncilExpert `json:"experts,omitempty"`
	Pause       bool                    `json:"pause,omitempty"`
	SessionId   string                  `json:"sessionid,omitempty"`
	NotRun      bool                    `json:"notrun,omitempty"`
	Mode        string                  `json:"mode,omitempty"`
	ModeWhy     string                  `json:"modewhy,omitempty"`
}

// CommandCouncilListData lists the councils of one project, newest first; an empty project lists them all.
type CommandCouncilListData struct {
	Project string `json:"project,omitempty"`
}

// CommandCouncilIdData names one council: Get, Summarize and Stop take it.
type CommandCouncilIdData struct {
	Id string `json:"id"`
}

// CommandCouncilReplyData is the person's reply. ProposalId and ParentId empty is "Ask the whole council"; a
// ParentId answers that reply, else the proposal itself. Tools turns on Let them read code for the answers.
type CommandCouncilReplyData struct {
	Id         string `json:"id"`
	ProposalId string `json:"proposalid,omitempty"`
	ParentId   string `json:"parentid,omitempty"`
	Text       string `json:"text"`
	Tools      bool   `json:"tools,omitempty"`
}

// CommandCouncilContinueData resumes a council paused after round 1: Cut lists the proposals the person unticked
// and Question, when set, is asked of the whole council.
type CommandCouncilContinueData struct {
	Id       string   `json:"id"`
	Cut      []string `json:"cut,omitempty"`
	Question string   `json:"question,omitempty"`
}

// CommandCouncilRetryData reruns the failed call of one expert; the coordinator's is the synthesis.
type CommandCouncilRetryData struct {
	Id       string `json:"id"`
	ExpertId string `json:"expertid"`
}

// CommandCouncilSuggestData asks for Setup's suggestion: the files to read and the roles that fit the feature.
type CommandCouncilSuggestData struct {
	Project  string   `json:"project"`
	Feature  string   `json:"feature"`
	Question string   `json:"question,omitempty"`
	Files    []string `json:"files,omitempty"`
}

// CommandCouncilEstimateData prices a council. With Id and Followup (a count of experts) it prices a follow-up round
// of that many calls, Tools being Let them read code; with Id alone it prices what a saved council has left to run;
// otherwise it prices the whole of a new council of Experts, reading the size of Files under Project.
type CommandCouncilEstimateData struct {
	Project  string                  `json:"project,omitempty"`
	Files    []string                `json:"files,omitempty"`
	Experts  []council.CouncilExpert `json:"experts,omitempty"`
	Id       string                  `json:"id,omitempty"`
	Followup int                     `json:"followup,omitempty"`
	Tools    bool                    `json:"tools,omitempty"`
}

// CouncilEstimateRtnData is council.CouncilEstimate on the wire: counted, not priced.
type CouncilEstimateRtnData struct {
	Calls   int   `json:"calls"`
	Tokens  int64 `json:"tokens"`
	Minutes int   `json:"minutes"`
}

// CommandCouncilSaveDocData writes a council's Summary and Matrix as markdown. An empty Path is
// docs/council/YYYY-MM-DD-<feature>.md in the project; a relative Path is under the project, and a Path outside it
// is refused.
type CommandCouncilSaveDocData struct {
	Id   string `json:"id"`
	Path string `json:"path,omitempty"`
}

// CouncilSaveDocRtnData is the absolute path the document was written to.
type CouncilSaveDocRtnData struct {
	Path string `json:"path"`
}

// CouncilRolesRtnData is the role library and the groups, the built-ins with the person's councilroles.json applied.
type CouncilRolesRtnData struct {
	Roles  []council.CouncilExpert `json:"roles"`
	Groups []council.CouncilGroup  `json:"groups"`
}

// CouncilChangedData is the data of the council:changed event: the council that was saved, and its project.
type CouncilChangedData struct {
	Id      string `json:"id"`
	Project string `json:"project"`
}
