// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package council

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/consult"
	"github.com/wavetermdev/waveterm/pkg/jobqueue"
)

// CallReq is one claude call: the expert it speaks as, where it runs, and whether it may read the project.
type CallReq struct {
	Expert CouncilExpert
	Cwd    string
	Prompt string
	Tools  bool // round 1, the Setup suggestion, a follow-up with Let them read files on
	// Web adds WebFetch to a call with Tools: its prompt carries a web address the person gave (a reply's link, or one in
	// the council's question), so the seat opens the page instead of guessing at it. Ignored without Tools.
	Web bool
	// AddDirs are the folders outside Cwd a call with Tools may also read: the folder of each image the person attached
	// to a reply the prompt carries, nothing wider. Empty for every call that carries none.
	AddDirs []string
	OnTool  func(text string)
}

// CallRes is what a call returned: the whole reply, and the tokens it used (cache reads included).
type CallRes struct {
	Text   string
	Tokens int64

	fellBack string // set by the runner: the model a safeguard-flagged call was run again on, and answered
}

// SafeguardFallback is the model a call Claude's safeguards flagged is run again on, once: Opus 4.8, the model Claude
// Code itself falls back to, which the newer models' stronger safeguards (Opus 5.5, Sonnet 5.5) do not cover.
const SafeguardFallback = "claude-opus-4-8"

// IsSafeguardFlag says err is the claude CLI's safeguard refusal: "API Error: Opus 5.5's safeguards flagged this
// session …".
func IsSafeguardFlag(err error) bool {
	return err != nil && strings.Contains(strings.ToLower(err.Error()), "safeguards flagged")
}

// Caller makes the one-shot calls a council is made of. The runner never starts a process itself, so a test hands it a
// fake. A call that is cut off by ctx returns an error; the runner tells that from a failure by ctx.Err().
type Caller interface {
	Call(ctx context.Context, req CallReq) (CallRes, error)
}

// callTimeout bounds one call's run, not the wait for its slot.
var callTimeout = 10 * time.Minute

// toolSlotBytes is the RAM a call with tools claims from the queue: a claude process reading the project, rounded up.
// It goes into open-issues' RAM watch once it is measured.
const toolSlotBytes uint64 = 512 << 20

// readOnlyTools is the tool list a council gives an expert that reads code, the one Radar's audit uses.
var readOnlyTools = []string{"Read", "Grep", "Glob"}

// webTool is the tool a call with Web adds to readOnlyTools: it reads a page, and writes nothing.
const webTool = "WebFetch"

// the seams a test replaces
var (
	runClaude = consult.RunClaude
	holdSlot  = jobqueue.Hold
)

// ConsultCaller is the Caller that runs claude through pkg/consult, with the expert's own model.
type ConsultCaller struct{}

// Call runs req. A call with tools is the heavy kind (it reads the project), so it waits for a slot in the job queue
// first, as the engine's Verify does; one without tools answers from text and starts at once.
func (ConsultCaller) Call(ctx context.Context, req CallReq) (CallRes, error) {
	var tools []string
	if req.Tools {
		tools = readOnlyTools
		if req.Web {
			tools = append(slices.Clone(readOnlyTools), webTool)
		}
		src := jobqueue.SourceFrom(ctx)
		src.Label = "Council · " + req.Expert.Name
		release, err := holdSlot(ctx, jobqueue.Request{Name: src.Label, Bytes: toolSlotBytes, Engine: true, Source: src})
		if err != nil {
			return CallRes{}, fmt.Errorf("waiting for a slot: %w", err)
		}
		defer release()
	}
	runCtx, cancel := context.WithTimeout(ctx, callTimeout)
	defer cancel()
	opts := consult.CallOpts{Model: req.Expert.Model, Tools: tools, AddDirs: req.AddDirs}
	text, usage, err := runClaude(runCtx, req.Cwd, req.Prompt, opts, req.OnTool)
	res := CallRes{Text: text, Tokens: int64(usage.TotalTokens)}
	if errors.Is(runCtx.Err(), context.DeadlineExceeded) {
		return res, fmt.Errorf("timed out after %s", callTimeout)
	}
	return res, err
}
