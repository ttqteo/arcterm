// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package council runs a panel of expert agents that reviews one feature in three rounds of one-shot
// `claude -p` calls and keeps the result as one JSON file per council, <data dir>/councils/<id>.json.
// Every type that crosses the wire is prefixed Council, so the generated TypeScript does not collide.
package council

type CouncilState string

const (
	StateRunning  CouncilState = "running"
	StateAwaiting CouncilState = "awaiting-you"
	StateDone     CouncilState = "done"
	StateNotRun   CouncilState = "not-run"
	StateStopped  CouncilState = "stopped"
	StateFailed   CouncilState = "failed"
)

type CouncilStance string

const (
	StanceAccept    CouncilStance = "accept"
	StanceChallenge CouncilStance = "challenge"
	StanceOppose    CouncilStance = "oppose"
)

const YouId = "you" // the person, as a reply author

type CouncilExpert struct {
	Id          string `json:"id"`
	Name        string `json:"name"`
	Brief       string `json:"brief"`
	Model       string `json:"model"`
	Coordinator bool   `json:"coordinator,omitempty"`
	Why         string `json:"why,omitempty"` // a suggested role's reason, Setup only
}

type CouncilGroup struct {
	Id          string   `json:"id"`
	Name        string   `json:"name"`
	Roles       []string `json:"roles"`
	Coordinator string   `json:"coordinator"`
}

type CouncilEvidence struct {
	Ref  string `json:"ref"`            // "path:line", or "screenshot:<file>#<region>"
	Weak bool   `json:"weak,omitempty"` // a claim that cites nothing
	Note string `json:"note,omitempty"` // why it is weak: `"about 3 s" has no measurement`
}

type CouncilProposal struct {
	Id        string            `json:"id"` // P1, P2, ... in arrival order
	Author    string            `json:"author"`
	Title     string            `json:"title"`
	Argument  string            `json:"argument"`
	Evidence  []CouncilEvidence `json:"evidence,omitempty"`
	Ts        int64             `json:"ts"`
	Withdrawn bool              `json:"withdrawn,omitempty"`
	Cut       bool              `json:"cut,omitempty"` // unticked by the person at the pause
}

type CouncilReply struct {
	Id         string            `json:"id"` // r1, r2, ...
	ProposalId string            `json:"proposalid"`
	ParentId   string            `json:"parentid,omitempty"` // a reply id; empty answers the proposal itself
	Author     string            `json:"author"`             // an expert id, or YouId
	Stance     CouncilStance     `json:"stance,omitempty"`
	Revised    bool              `json:"revised,omitempty"` // the author revised its own proposal here
	Text       string            `json:"text"`
	Evidence   []CouncilEvidence `json:"evidence,omitempty"`
	To         []string          `json:"to,omitempty"`    // the person's reply: the experts who answer it
	Tools      bool              `json:"tools,omitempty"` // the person's follow-up: Let them read code was on
	Answered   bool              `json:"answered,omitempty"`
	Round      int               `json:"round"` // the round it was posted in; 4+ for follow-ups after done
	Ts         int64             `json:"ts"`
}

type CouncilDirection struct {
	Rank      int                      `json:"rank"`
	Title     string                   `json:"title"`
	Reasoning string                   `json:"reasoning"`
	From      []string                 `json:"from"`    // proposal ids
	Stances   map[string]CouncilStance `json:"stances"` // expert id -> stance; the authors are left out
	Agreed    bool                     `json:"agreed"`
	IdeaId    string                   `json:"ideaid,omitempty"` // the line ideastore.Add made in the session's Ideas
}

type CouncilSummary struct {
	Text       string             `json:"text"`
	Directions []CouncilDirection `json:"directions"`
	Outcomes   map[string]string  `json:"outcomes"`         // proposal id -> "Direction 1", "Merged into direction 3", "Withdrawn in round 2"
	Answer     string             `json:"answer,omitempty"` // the one-sentence answer to the person's question; empty without a question
	At         int64              `json:"at"`
}

type CouncilActivity struct {
	Text       string `json:"text"`                 // `Grep "IdleSleep" in pkg/services`, `Replying to UX on P2`
	ProposalId string `json:"proposalid,omitempty"` // set while it writes a reply there
	ParentId   string `json:"parentid,omitempty"`
}

type CouncilFailure struct {
	Round int    `json:"round"`
	Error string `json:"error"`
}

type CouncilExpertStat struct {
	Ms     int64 `json:"ms"`     // time spent in this expert's calls, the running one included at its last save
	Tokens int64 `json:"tokens"` // tokens its finished calls used
	Calls  int   `json:"calls"`
}

// CouncilSuggestion is Setup's suggestion: the files to put in front of the panel and the roles that fit the feature.
type CouncilSuggestion struct {
	Files []string        `json:"files"`
	Roles []CouncilExpert `json:"roles"`
	Group string          `json:"group,omitempty"`
}

type Council struct {
	Id               string                       `json:"id"`
	Project          string                       `json:"project"` // the project folder, the experts' cwd
	Feature          string                       `json:"feature"`
	Question         string                       `json:"question,omitempty"`
	Files            []string                     `json:"files,omitempty"`
	Screenshots      []string                     `json:"screenshots,omitempty"`
	Group            string                       `json:"group,omitempty"`
	Experts          []CouncilExpert              `json:"experts"` // the coordinator last
	PauseAfterRound1 bool                         `json:"pauseafterround1,omitempty"`
	SessionId        string                       `json:"sessionid,omitempty"` // the agent session that started it
	State            CouncilState                 `json:"state"`
	Round            int                          `json:"round"`
	Error            string                       `json:"error,omitempty"`
	Proposals        []CouncilProposal            `json:"proposals,omitempty"`
	Replies          []CouncilReply               `json:"replies,omitempty"`
	Picks            map[string][]string          `json:"picks,omitempty"` // expert id -> up to 3 proposal ids, in the order the expert gave them
	Summary          *CouncilSummary              `json:"summary,omitempty"`
	Activity         map[string]CouncilActivity   `json:"activity,omitempty"` // expert id -> what it is doing now
	Failed           map[string]CouncilFailure    `json:"failed,omitempty"`   // expert id -> its failed call
	Stats            map[string]CouncilExpertStat `json:"stats,omitempty"`    // expert id -> time and tokens so far
	Tokens           int64                        `json:"tokens"`
	Calls            int                          `json:"calls"`
	Started          int64                        `json:"started,omitempty"` // when round 1 began; 0 while not run
	Created          int64                        `json:"created"`
	Updated          int64                        `json:"updated"`
}
