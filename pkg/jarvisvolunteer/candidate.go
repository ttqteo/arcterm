// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package jarvisvolunteer decides whether Jarvis says something unprompted, and what. It is the only
// place the cadence and precedence rules live: split across producers they would become emergent, and
// an emergent interruption rate is the defect that gets a feature like this switched off.
package jarvisvolunteer

import "context"

// The knowledge classes. Each reads an engine that already computes; none adds a retrieval pass.
const (
	ClassConnection    = "connection"     // an attribution edge that just formed
	ClassLooseEnd      = "loose-end"      // a dossier going quiet
	ClassLedger        = "ledger"         // the state of your work: shipped runs, needs-you items
	ClassMemoryHygiene = "memory-hygiene" // a project's memory check left changes to review
)

// Every terminal path names its reason. Returning nothing on failure is what made six distinct failures
// in the sibling proactive package indistinguishable from never having run; counting no-candidates
// against judge-declined is also the cost audit that choosing a model judge obliges us to have.
const (
	ReasonNoCandidates  = "no-candidates"
	ReasonRateLimited   = "rate-limited"
	ReasonJudgeDeclined = "judge-declined"
	ReasonJudgeError    = "judge-error"
	ReasonVaultError    = "vault-error"
	ReasonProducerError = "producer-error"
)

// Candidate is one thing Jarvis could say.
//
// ID and At are stamped from the FACT, never from time.Now(). The frontend watermark
// (frontend/app/view/jarvis/petstore.ts) compares At first and breaks ties on ID, so a re-emitted
// identical fact carries an identical pair, fails the newer-than check and dies silently. That is the
// whole reason this feature needs no server-side said-log and no database migration.
//
// SourceRef and Anchor are FRONTEND NAVIGATION ADDRESSES. They carry vault node ids inside oref-shaped
// strings (the same thing askAboutRecord already does with "task:"+dossierId) and must never be passed
// to waveobj.ParseORef, which expects a UUID.
type Candidate struct {
	Class      string
	ID         string
	At         int64 // UnixMilli, from the fact
	Title      string
	Snippet    string
	SourceType string // dossier | decision | memory | run | memhygiene
	SourceRef  string
	Anchor     string // optional sub-object to highlight within SourceRef
}

// Trigger is what woke the evaluation. RunID is empty for the unattended sweep.
type Trigger struct {
	Kind      string // "run-created" | "run-rest" | "sweep"
	ChannelID string
	RunID     string
}

// Trigger kinds.
const (
	TriggerRunCreated = "run-created"
	TriggerRunRest    = "run-rest"
	TriggerSweep      = "sweep"
)

// Producer contributes candidates by reading durable state. Producers are STATELESS: none owns a queue,
// an outbox or a cursor. A dropped, failed or rate-limited trigger therefore loses nothing, because the
// next trigger re-reads the same facts and the candidate is still there.
type Producer interface {
	Name() string
	Candidates(ctx context.Context, t *Trigger) ([]Candidate, error)
}
