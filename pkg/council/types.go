// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package council runs a panel of expert agents that reviews one feature in three rounds of one-shot
// `claude -p` calls and keeps the result as one JSON file per council, <data dir>/councils/<id>.json.
// Every type that crosses the wire is prefixed Council, so the generated TypeScript does not collide.
package council

import "slices"

type CouncilState string

const (
	StateRunning  CouncilState = "running"
	StateAwaiting CouncilState = "awaiting-you"
	StateDone     CouncilState = "done"
	StateNotRun   CouncilState = "not-run"
	StateStopped  CouncilState = "stopped"
	StateFailed   CouncilState = "failed"
	StateQueued   CouncilState = "queued" // waits for the one council that runs; starts by itself when it ends
)

// The two modes of a council. Review is the default and the mode of every council saved before modes existed, so a
// council with no Mode reads as Review (ModeOf).
const (
	ModeReview     = "review"
	ModeBrainstorm = "brainstorm"
)

// ModeOf is a council's mode, Review when none is set.
func ModeOf(c *Council) string {
	if c == nil || c.Mode == "" {
		return ModeReview
	}
	return c.Mode
}

// The two ratings of a council's report: the person's "Was this useful?" answer. The benchmark's results file takes the
// same two words (bench.RatingUseful, bench.RatingNot).
const (
	RatingUseful = "useful"
	RatingNot    = "not"
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
	Why         string `json:"why,omitempty"`     // a suggested role's reason, Setup only
	Agent       string `json:"agent,omitempty"`   // a live agent seat: the seated agent's tab id; empty for a role expert
	Harness     string `json:"harness,omitempty"` // an agent seat's harness, claude or pi
	Context     int64  `json:"context,omitempty"` // an agent seat's context tokens when it was seated, for the estimate
	// Transcript is an agent seat's session, its transcript's path: when the seat's tab closes and the session is opened
	// again in another tab (Resume, Open asleep), the seat follows it there (Runner.call, SeatRebinder). Empty on a role
	// expert, and on a seat from before it was kept until its next turn reads it.
	Transcript string `json:"transcript,omitempty"`
	// NameVi is a stock role's Vietnamese name, so Setup can show it for a Vietnamese question. Empty on a user role and
	// on an agent seat, which keep the one name they have.
	NameVi string `json:"namevi,omitempty"`
}

// IsAgent says a seat is a live agent's, not a role expert's.
func IsAgent(e CouncilExpert) bool { return e.Agent != "" }

// HasAgents says at least one live agent is seated: the council then honours Rounds, and its estimate counts the
// agents' turns. Whether it also holds every answer as a draft is HoldsDrafts.
func HasAgents(c *Council) bool {
	return c != nil && slices.ContainsFunc(c.Experts, IsAgent)
}

// The two modes a council's answers are held in, stored in Council.DraftMode when its run begins. They are not the
// states of one draft (DraftHeld, DraftDropped): seating a chat later never flips a council that began free to held.
const (
	DraftModeHeld = "held"
	DraftModeFree = "free"
)

// draftModeFromSeats is the mode today's seats give: held when a live chat is seated and the council was not started
// by `wsh council start`, which runs to the report with nothing held; free otherwise.
func draftModeFromSeats(c *Council) string {
	if HasAgents(c) && !c.ByAgent {
		return DraftModeHeld
	}
	return DraftModeFree
}

// freezeDraftMode stores the draft mode when the council has none, from the seats it has now. A set mode is left alone.
// A council's run calls it when it begins, and the seating of a joining chat calls it just before it seats one, so a
// council that began without a chat keeps running free once a chat joins.
func freezeDraftMode(c *Council) {
	if c.DraftMode == "" {
		c.DraftMode = draftModeFromSeats(c)
	}
}

// HoldsDrafts says the council holds every answer as a draft for the person's Send, Edit or Drop. A stored DraftMode is
// the answer; a council with none (one saved before the field) reads it from its seats: a chat is seated and the council
// was not started by `wsh council start`.
func HoldsDrafts(c *Council) bool {
	if c == nil {
		return false
	}
	switch c.DraftMode {
	case DraftModeHeld:
		return true
	case DraftModeFree:
		return false
	}
	return draftModeFromSeats(c) == DraftModeHeld
}

type CouncilGroup struct {
	Id          string   `json:"id"`
	Name        string   `json:"name"`
	NameVi      string   `json:"namevi,omitempty"` // the group's Vietnamese name; empty on a group the person saved
	Roles       []string `json:"roles"`
	Coordinator string   `json:"coordinator"`
}

// The checked state of a cite (CouncilEvidence.Cite). Go sets it, never a model; empty is a cite nothing checked: a
// screenshot named with no box, a link, or anything in a Brainstorm.
const (
	// the file exists, the line is in range, and a quoted text was found at or near the line; for a screenshot cite, the
	// image is one the council was given and the box lies inside it
	CiteOK = "ok"
	// a missing file, a line past the end, a quote not found near the line, or a screenshot box Go cannot place
	// (CiteNote says which)
	CiteWrong = "wrong"
)

type CouncilEvidence struct {
	Ref  string `json:"ref"`            // "path:line", or "screenshot:<file>#<name>@x,y,w,h"
	Weak bool   `json:"weak,omitempty"` // a claim that cites nothing
	Note string `json:"note,omitempty"` // why it is weak: `"about 3 s" has no measurement`
	// Quote is the exact text the expert says the cited line holds, which the citation check looks for at or near the line.
	Quote string `json:"quote,omitempty"`
	// Cite is CiteOK or CiteWrong once Go has checked the ref; empty when it was not checked.
	Cite string `json:"cite,omitempty"`
	// CiteNote says why a cite is wrong: "line 900 is past the end (412 lines)", "quote not found near line 42".
	CiteNote string `json:"citenote,omitempty"`
	// Region is the boxed part of a screenshot a `screenshot:<file>#<name>@x,y,w,h` cite names, once Go has found the
	// image and drawn the crop (regions.go); nil for every other cite, and for a boxed one Go could not draw.
	Region *CouncilRegion `json:"region,omitempty"`
}

// CouncilRegion is a screenshot cite Go located: the image it boxes, the box as fractions (0..1) of that image's width
// and height (clamped into it), and the PNG Go drew of the box with a red rectangle on it and a margin around it. Once
// drawn, the PNG stands: Image may since have left the disk.
type CouncilRegion struct {
	Image string  `json:"image"` // the absolute path of the screenshot or the pasted image
	Crop  string  `json:"crop"`  // the absolute path of the drawn PNG, under the council's regions folder
	X     float64 `json:"x"`
	Y     float64 `json:"y"`
	W     float64 `json:"w"`
	H     float64 `json:"h"`
}

// The label Go gives a claim, a proposal or a reply that takes a stance (CouncilProposal.Label, CouncilReply.Label). It
// is set from what Go checked, never from a model. Empty is a claim nothing labels: a plain reply, or anything in a
// Brainstorm.
const (
	LabelRan       = "ran"       // a verify command ran for it and its result matched what the expert expected
	LabelDisproved = "disproved" // a verify command ran for it and its result contradicts what the expert expected
	LabelRead      = "read"      // at least one cite resolves
	LabelGuess     = "guess"     // it cites nothing, or nothing that resolves
)

// The state of a CouncilRun. Empty is a request that has not been handled yet. Only pass and fail tested the claim: a
// run that did not (off the list, over the cap, timed out, matched no test, did not build) is RunNotRun, with its
// Reason, and never makes a claim Ran or Disproved.
const (
	RunPass   = "pass"
	RunFail   = "fail"
	RunNotRun = "not-run"
)

// CouncilRun is one verify command an expert asked Go to run for a proposal, and what came of it. The expert's request
// fills Command, Expect and Why; Go fills the rest.
type CouncilRun struct {
	Command string `json:"command"`           // `go test ./pkg/x -run TestY`: one of the three allowed forms, run with no shell
	Expect  string `json:"expect"`            // what the expert expects: RunPass or RunFail
	Why     string `json:"why,omitempty"`     // the expert's one-line reason for the expectation
	State   string `json:"state,omitempty"`   // RunPass, RunFail or RunNotRun; empty while it is only a request
	Exit    int    `json:"exit,omitempty"`    // the exit code; 0 when absent
	Tail    string `json:"tail,omitempty"`    // the last 40 lines of its output
	Matched bool   `json:"matched,omitempty"` // the result is what the expert expected (State equals Expect)
	Reason  string `json:"reason,omitempty"`  // why a run did not run: "not on the list", "over the 2-command cap", "timed out after 3 min", "not a git repo"
}

// The kinds of one CouncilStep.
const (
	StepRead    = "read"    // a Read of a file
	StepSearch  = "search"  // a Grep or Glob
	StepRun     = "run"     // a verify command
	StepPropose = "propose" // the expert posted an idea
	StepReply   = "reply"   // the expert posted a reply
)

// MaxTimelineSteps caps one expert's timeline: the oldest row goes first.
const MaxTimelineSteps = 200

// CouncilStep is one row of an expert's timeline: what it did, when, and what came of it when that is known.
type CouncilStep struct {
	Ts     int64  `json:"ts"`               // when, in ms
	Kind   string `json:"kind"`             // a Step* kind; an unrecognised tool keeps its own first word
	Target string `json:"target"`           // the file, the search pattern, the command, or the idea or reply it posted
	Result string `json:"result,omitempty"` // "pass", "fail", "3 matches"; empty when the step has no result
}

// The two languages a council is held in, stored in Council.Lang at Start from the question (LangOf).
const (
	LangEn = "en"
	LangVi = "vi"
)

type CouncilProposal struct {
	Id        string            `json:"id"` // P1, P2, ... in arrival order
	Author    string            `json:"author"`
	Title     string            `json:"title"`
	Argument  string            `json:"argument"`
	Evidence  []CouncilEvidence `json:"evidence,omitempty"`
	Ts        int64             `json:"ts"`
	Withdrawn bool              `json:"withdrawn,omitempty"`
	Cut       bool              `json:"cut,omitempty"`    // unticked by the person at the pause
	Wild      bool              `json:"wild,omitempty"`   // a Brainstorm wild idea
	Draft     string            `json:"draft,omitempty"`  // DraftHeld or DraftDropped; empty once sent, and on an idea that was never held
	Edited    bool              `json:"edited,omitempty"` // the person edited it before sending
	Thumb     string            `json:"thumb,omitempty"`  // the person's ThumbLike or ThumbDislike; empty for none
	// Runs are the verify commands the author asked Go to run for this idea, and what each came to. Only a proposal in a
	// Review council carries any.
	Runs []CouncilRun `json:"runs,omitempty"`
	// Label is the claim's check label, one of the Label* values; empty when nothing labels it.
	Label string `json:"label,omitempty"`
	// Checker is the seat the cross-check sends this proposal to in full (the other seats read its title and first line):
	// ParseRound1 leaves the one its author named, and the runner replaces it with the seat routeChecker settles on. Empty
	// on a proposal from before checkers, which every seat reads in full. CheckWhy is the author's line on why that seat.
	Checker  string `json:"checker,omitempty"`
	CheckWhy string `json:"checkwhy,omitempty"`
	// Zone is the stored zone name (CouncilZone.Name) a Brainstorm idea fits; empty for none, and on every Review idea.
	Zone string `json:"zone,omitempty"`
}

// CouncilZone is the part of a Brainstorm's feature one panel seat explores: Name is a few words, Covers one sentence
// on the part of the feature it covers.
type CouncilZone struct {
	Seat   string `json:"seat"` // the panel seat's expert id
	Name   string `json:"name"`
	Covers string `json:"covers"`
}

// The person's thumb on a seat's sent idea or reply. The seats' later prompts and the summary read it (writeThumbs),
// as the person's view.
const (
	ThumbLike    = "like"
	ThumbDislike = "dislike"
)

// The two states of a held draft. A proposal or reply with no Draft is sent (Sent), and only a sent one reaches a seat's
// prompt or the synthesis.
const (
	DraftHeld    = "held"
	DraftDropped = "dropped"
)

// Sent says an idea or reply is out in the room: it was never held, or the person sent it.
func Sent(draft string) bool { return draft == "" }

type CouncilReply struct {
	Id         string            `json:"id"` // r1, r2, ...
	ProposalId string            `json:"proposalid"`
	ParentId   string            `json:"parentid,omitempty"` // a reply id; empty answers the proposal itself
	Author     string            `json:"author"`             // an expert id, or YouId
	Stance     CouncilStance     `json:"stance,omitempty"`
	Revised    bool              `json:"revised,omitempty"`   // the author revised its own proposal here
	Withdraws  bool              `json:"withdraws,omitempty"` // with Revised: the author withdrew it here, Text its reason or ""
	Retitled   string            `json:"retitled,omitempty"`  // with Revised: the new title the author gave it here; Text is its change line or ""
	Builds     bool              `json:"builds,omitempty"`    // a Brainstorm reply that builds on the idea
	Text       string            `json:"text"`
	Evidence   []CouncilEvidence `json:"evidence,omitempty"`
	To         []string          `json:"to,omitempty"`    // the person's reply: the experts who answer it
	Tools      bool              `json:"tools,omitempty"` // the person's follow-up: Let them read files was on
	Answered   bool              `json:"answered,omitempty"`
	Round      int               `json:"round"` // the round it was posted in; FirstFollowRound and up for follow-ups after done
	Ts         int64             `json:"ts"`
	Draft      string            `json:"draft,omitempty"`  // DraftHeld or DraftDropped; empty once sent, and on a reply that was never held
	Edited     bool              `json:"edited,omitempty"` // the person edited it before sending
	Thumb      string            `json:"thumb,omitempty"`  // the person's ThumbLike or ThumbDislike on a seat's reply; empty for none
	// Attachments are the absolute paths of the images the person attached to this reply, in the order they were added,
	// each a file the composer kept under ~/.arc/attachments. Only the person's replies carry any; a reply with any is
	// stored and answered with Tools on, and each seat's tools prompt lists them after the reply's text.
	Attachments []string `json:"attachments,omitempty"`
	// Asks are a seat's answer's suggestions: up to MaxReplyAsks short replies the person might send next, which the
	// thread offers above its reply box. Only a seat's answer to the person carries any.
	Asks []string `json:"asks,omitempty"`
	// Revision is the change to its own idea a held reply carries: it takes effect when the reply is sent, and a dropped
	// reply cancels it. Nil on every reply that is sent or never held.
	Revision *CouncilRevision `json:"revision,omitempty"`
	// Routed is set on a whole-council message of the person's that the router takes up (no proposal, no parent, no
	// seat @-mentioned, no @all): To then holds the seats it chose, or stays empty while Pending. Nil on every other reply.
	Routed *CouncilRouted `json:"routed,omitempty"`
	// Label is the check label of a reply that takes a stance, one of the Label* values; empty on a plain reply (an
	// answer to the person) and on every reply in a Brainstorm.
	Label string `json:"label,omitempty"`
}

// CouncilRouted records that a reply's To came from the router, for the router line and the Ask <seat> too chips under
// the answer. To stays the one source of who answers; Chose is what the router picked, kept apart from To so that Ask
// <seat> too can add a seat to To without the line forgetting whom the router chose.
type CouncilRouted struct {
	Pending   bool     `json:"pending,omitempty"`   // the router has not answered yet: To is empty meanwhile
	Chose     []string `json:"chose,omitempty"`     // the seats the router (or its fallback) picked, in its order
	Reason    string   `json:"reason,omitempty"`    // the router's one sentence; on Failed, why it failed
	Failed    bool     `json:"failed,omitempty"`    // the router failed: Chose is the fallback seat
	AutoTools bool     `json:"autotools,omitempty"` // Let them read files was Auto (no image, no @file): the router sets Tools
}

// CouncilRevision is what a seat's revision of its own idea changes: a withdrawal, or a new title and argument (an
// empty one stays as it is).
type CouncilRevision struct {
	Withdraw bool   `json:"withdraw,omitempty"`
	Title    string `json:"title,omitempty"`
	Argument string `json:"argument,omitempty"`
}

type CouncilDirection struct {
	Rank      int                      `json:"rank"`
	Title     string                   `json:"title"`
	Reasoning string                   `json:"reasoning"`
	From      []string                 `json:"from"`    // proposal ids
	Stances   map[string]CouncilStance `json:"stances"` // expert id -> stance; the authors are left out
	Agreed    bool                     `json:"agreed"`
	FirstStep string                   `json:"firststep,omitempty"` // the one thing to do first
}

type CouncilSummary struct {
	Text       string             `json:"text"`
	Directions []CouncilDirection `json:"directions"`
	Kept       []CouncilDirection `json:"kept,omitempty"`   // one line each: a Brainstorm's wild ideas kept aside, a Review's Also raised
	Outcomes   map[string]string  `json:"outcomes"`         // proposal id -> "Direction 1", "Merged into direction 3", "Withdrawn in round 2"
	Answer     string             `json:"answer,omitempty"` // the one-sentence answer to the person's question; empty without a question
	Asks       []CouncilAsk       `json:"asks,omitempty"`   // up to MaxAsks questions the person could ask next
	At         int64              `json:"at"`
}

// The council's memory: the one direction the person has chosen for the discussion, the ones it replaced, and the two
// cards that wait on the person (a suggestion, and a direction held back). How a direction was set, why a card is held,
// how one ended and where a suggestion came from are these names.
const (
	DirectionPin       = "pin"       // Chốt on a message or idea
	DirectionWritten   = "written"   // typed in Set the direction…
	DirectionSuggested = "suggested" // accepted from a suggestion

	EndReplaced = "replaced" // another direction was set over it
	EndEdited   = "edited"   // Edit changed it and the new text was set
	EndUnpinned = "unpinned" // the person took it off with no replacement

	CardSuggestion = "suggestion"
	CardHeld       = "held"

	SourceCheck = "check" // a suggestion's source: the check after a round
	SourceGreen = "green" // or all green: the seats agreed on an idea
)

// The memory's entries: what the discussion has reached besides the direction. By says who wrote one: the round check
// (auto) or the person (you).
const (
	EntryAgreed   = "agreed"   // settled as true
	EntryRuledOut = "ruledout" // dropped
	EntryOpen     = "open"     // still to settle

	EntryByAuto = "auto"
	EntryByYou  = "you"

	MemoryEntriesMax = 40
)

// CouncilMemoryEntry is one thing the discussion has reached: Agreed, Ruled out or Open. Why is kept for Ruled out only.
type CouncilMemoryEntry struct {
	Id       string   `json:"id"`   // m1, m2…, numbered by CouncilMemory.NextEntry and never reused
	Kind     string   `json:"kind"` // EntryAgreed / EntryRuledOut / EntryOpen
	Text     string   `json:"text"`
	Why      string   `json:"why,omitempty"`      // Ruled out only: the reason it was dropped
	By       string   `json:"by"`                 // EntryByAuto / EntryByYou
	Round    int      `json:"round,omitempty"`    // the round an automatic entry came after
	Messages []string `json:"messages,omitempty"` // the message ids it rests on (Show the messages)
	At       int64    `json:"at"`                 // when it was added, in ms
}

// CouncilMemoryDirection is one direction the person chose: the one in force (Chosen) or one it left (Replaced).
type CouncilMemoryDirection struct {
	Text     string `json:"text"`
	How      string `json:"how"`                // DirectionPin / DirectionWritten / DirectionSuggested
	Source   string `json:"source,omitempty"`   // for How suggested: SourceCheck or SourceGreen
	Round    int    `json:"round,omitempty"`    // the round a check suggestion came after ("after round N")
	From     string `json:"from,omitempty"`     // the idea (P3) or message (r7) it came from
	At       int64  `json:"at"`                 // when it was set, in ms
	Replaced int64  `json:"replaced,omitempty"` // when it left Chosen, in ms; 0 while chosen
	Ended    string `json:"ended,omitempty"`    // EndReplaced / EndEdited / EndUnpinned
}

// CouncilMemoryCard is a direction waiting on the person: a suggestion the check or all green raised, or one held back
// because it clashes with what the panel said.
type CouncilMemoryCard struct {
	Kind     string   `json:"kind"` // CardSuggestion or CardHeld
	Text     string   `json:"text"`
	Reason   string   `json:"reason,omitempty"`   // the check's one line; for a held card, why it is held
	How      string   `json:"how,omitempty"`      // a held card: how the person set it (pin / written), kept when set anyway
	Source   string   `json:"source,omitempty"`   // a suggestion: SourceCheck or SourceGreen
	Round    int      `json:"round,omitempty"`    // the round a check suggestion came after
	From     string   `json:"from,omitempty"`     // an idea id (all green) or the message it was pinned from
	Messages []string `json:"messages,omitempty"` // a check suggestion: the message ids it rests on (Show the messages)
	Edited   bool     `json:"edited,omitempty"`   // a held card that came from Edit: setting it ends the old one as EndEdited
	Entry    string   `json:"entry,omitempty"`    // the memory entry (m3) a Chốt on it set this card from
	At       int64    `json:"at"`                 // when it was raised, in ms
}

// CouncilMemory is a council's direction memory. The memory's directions are named CouncilMemory* so they never meet
// CouncilDirection, the Report's.
type CouncilMemory struct {
	Chosen     *CouncilMemoryDirection  `json:"chosen,omitempty"`
	Replaced   []CouncilMemoryDirection `json:"replaced,omitempty"`   // newest first
	Suggestion *CouncilMemoryCard       `json:"suggestion,omitempty"` // one slot
	Held       *CouncilMemoryCard       `json:"held,omitempty"`       // a second slot: a suggestion never drops it
	Dismissed  []string                 `json:"dismissed,omitempty"`  // suggestion keys never raised again
	Changed    int64                    `json:"changed,omitempty"`    // when Chosen last changed (set, edit, unpin): the Report's Outdated cause
	Entries    []CouncilMemoryEntry     `json:"entries,omitempty"`    // arrival order
	Removed    []string                 `json:"removed,omitempty"`    // keys (EntryKey) of automatic entries the person removed: never added again
	NextEntry  int                      `json:"nextentry,omitempty"`  // the number the last entry took; ids are never reused
}

// CouncilAsk is a question the coordinator suggests the person ask the panel next: Text as the person would type it, in
// their language, and To the seat best placed to answer it, empty for the whole panel.
type CouncilAsk struct {
	Text string `json:"text"`
	To   string `json:"to,omitempty"`
}

type CouncilActivity struct {
	Text       string `json:"text"`                 // `Grep "IdleSleep" in pkg/services`, `Replying to UX`
	ProposalId string `json:"proposalid,omitempty"` // set while it writes a reply there
	ParentId   string `json:"parentid,omitempty"`
}

type CouncilFailure struct {
	Round int    `json:"round"`
	Error string `json:"error"`
}

// CouncilSkip is one agent turn that did not happen: the seat was busy too long or gave no answer. The chat draws it as
// a line with Open its terminal.
type CouncilSkip struct {
	Expert string `json:"expert"` // the seat's expert id
	Round  int    `json:"round"`
	Reason string `json:"reason"` // "still working on its own task after 10 min"
	Ts     int64  `json:"ts"`
}

// CouncilRetry is one failed call that a retry on another model answered, by hand or, after a safeguard flag, on its own: the seat keeps its own Model for the calls
// after it, and the document names the model that wrote this round.
type CouncilRetry struct {
	Expert string `json:"expert"` // the seat's expert id
	Round  int    `json:"round"`
	Model  string `json:"model"` // the model the retry ran on
	Was    string `json:"was"`   // the seat's own model
	Ts     int64  `json:"ts"`
	Auto   bool   `json:"auto,omitempty"` // the runner ran it again on SafeguardFallback after Claude's safeguards flagged it
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
	// Mode is the mode the coordinator reads from the question, and ModeWhy its one-line reason.
	Mode    string `json:"mode,omitempty"`
	ModeWhy string `json:"modewhy,omitempty"`
}

// CouncilAutoGenerate is Setup's Auto-generate result: the topic, one question and the mode, written from the seated
// agents' recent conversations. Mode is always ModeReview or ModeBrainstorm.
type CouncilAutoGenerate struct {
	Topic    string `json:"topic"`
	Question string `json:"question"`
	Mode     string `json:"mode"`
}

type Council struct {
	Id               string                       `json:"id"`
	Project          string                       `json:"project"` // the project folder, the experts' cwd
	Feature          string                       `json:"feature"`
	Question         string                       `json:"question,omitempty"`
	Files            []string                     `json:"files,omitempty"`
	Screenshots      []string                     `json:"screenshots,omitempty"`
	Group            string                       `json:"group,omitempty"`
	Mode             string                       `json:"mode,omitempty"`           // ModeReview or ModeBrainstorm; empty reads as review
	ModeWhy          string                       `json:"modewhy,omitempty"`        // why the mode was picked: the suggestion's, the agent's --mode-why, or "picked by hand"
	QueuedAfter      string                       `json:"queuedafter,omitempty"`    // the id of the council this one waits on while queued
	Harness          string                       `json:"harness,omitempty"`        // HarnessVersion when its run began; empty before it ran, and on a council saved before versions existed
	RepeatOf         string                       `json:"repeatof,omitempty"`       // the recent council on the same topic this one was started over (repeat.go); empty when none resembled it
	RepeatDoc        string                       `json:"repeatdoc,omitempty"`      // that council's report
	RepeatWhy        string                       `json:"repeatwhy,omitempty"`      // RepeatNewEvidence or RepeatUpgraded: why it was run again
	RepeatEvidence   string                       `json:"repeatevidence,omitempty"` // what is new since, in the person's words
	Bench            bool                         `json:"bench,omitempty"`          // a council the benchmark started: no document in its project, and the cockpit never lists it
	DocPath          string                       `json:"docpath,omitempty"`        // the absolute path of the saved document
	Rating           string                       `json:"rating,omitempty"`         // RatingUseful or RatingNot: the person's latest answer to "Was this useful?"; empty until given
	RatedAt          int64                        `json:"ratedat,omitempty"`        // when Rating was given, in ms
	Pinned           int64                        `json:"pinned,omitempty"`         // when the person pinned it, in ms: the tree keeps it at the top of its project; 0 is not pinned. Only the person sets it: a run never touches it (a file's old "closed" is not read)
	FinalPick        string                       `json:"finalpick,omitempty"`      // the id of the idea (P1) or seat reply (r3) the person pinned to the Report as its Final proposal; empty when none. Display only: no prompt reads it, and a re-summarize keeps it. Not Pinned, which pins the whole council in the tree
	RanMs            int64                        `json:"ranms,omitempty"`          // how long its runs took altogether, in ms
	RunStarted       int64                        `json:"runstarted,omitempty"`     // when its current run began, in ms; 0 while it rests
	Experts          []CouncilExpert              `json:"experts"`                  // the coordinator last
	PauseAfterRound1 bool                         `json:"pauseafterround1,omitempty"`
	Rounds           int                          `json:"rounds,omitempty"`    // 1 to 3 seat rounds, the ideas round included; 0 reads as 2 (RoundsOf)
	SessionId        string                       `json:"sessionid,omitempty"` // the agent session that started it
	ByAgent          bool                         `json:"byagent,omitempty"`   // started by `wsh council start`: it never holds an answer as a draft, agents seated or not
	DraftMode        string                       `json:"draftmode,omitempty"` // DraftModeHeld or DraftModeFree, stored when its run begins (HoldsDrafts reads it); empty on a record from before the field
	State            CouncilState                 `json:"state"`
	Round            int                          `json:"round"`
	Error            string                       `json:"error,omitempty"`
	Proposals        []CouncilProposal            `json:"proposals,omitempty"`
	Replies          []CouncilReply               `json:"replies,omitempty"`
	Picks            map[string][]string          `json:"picks,omitempty"` // expert id -> up to 3 proposal ids, in the order the expert gave them
	Summary          *CouncilSummary              `json:"summary,omitempty"`
	Memory           *CouncilMemory               `json:"memory,omitempty"`   // the direction the person chose; nil until one is set or suggested
	Activity         map[string]CouncilActivity   `json:"activity,omitempty"` // expert id -> what it is doing now
	Failed           map[string]CouncilFailure    `json:"failed,omitempty"`   // expert id -> its failed call
	Skips            []CouncilSkip                `json:"skips,omitempty"`    // the agent turns that did not happen
	Retries          []CouncilRetry               `json:"retries,omitempty"`  // the retries that worked on another model than the seat's
	Stats            map[string]CouncilExpertStat `json:"stats,omitempty"`    // expert id -> time and tokens so far
	Tokens           int64                        `json:"tokens"`
	Calls            int                          `json:"calls"`
	Started          int64                        `json:"started,omitempty"` // when round 1 began; 0 while not run
	Created          int64                        `json:"created"`
	Updated          int64                        `json:"updated"`
	// Timeline is every step each expert took, expert id -> rows oldest first, at most MaxTimelineSteps each: the
	// Seats popover and the Map's expert cards read it.
	Timeline map[string][]CouncilStep `json:"timeline,omitempty"`
	// Lang is the council's language, LangEn or LangVi, read from the question at Start (LangOf). Empty on a council
	// saved before the field, which reads as English.
	Lang string `json:"lang,omitempty"`
	// Snapshot is the commit Start took of the project's tree as it was (HEAD plus uncommitted changes and untracked
	// files), which the verify commands run on; empty for a Brainstorm and for a project that is not a git repo.
	Snapshot string `json:"snapshot,omitempty"`
	// Zones is a Brainstorm's zones, one per panel seat in panel order, set by the zone call before round 1. Nil when
	// the council has none: a Review, a panel of one seat, a failed zone call, or a council saved before zones.
	Zones []CouncilZone `json:"zones,omitempty"`
}

// The rounds a council with agents may run: the ideas round and up to two reply passes. A council with no Rounds, and
// every council saved before the field, runs two: today's ideas round and one reply pass.
const (
	DefaultRounds = 2
	MaxRounds     = 3
)

// RoundsOf is how many rounds the seats answer before the summary: Rounds, with 0 or a number out of range read as 2.
func RoundsOf(c *Council) int {
	if c == nil || c.Rounds < 1 || c.Rounds > MaxRounds {
		return DefaultRounds
	}
	return c.Rounds
}

// SynthesisRound is the round number of the coordinator's summary, the one after the last seat round: 3 for 2 rounds.
func SynthesisRound(c *Council) int { return RoundsOf(c) + 1 }

// FirstFollowRound is the round number of the first follow-up after done: 4 for 2 rounds. Each later one is one more.
func FirstFollowRound(c *Council) int { return RoundsOf(c) + 2 }
