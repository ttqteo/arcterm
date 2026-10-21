// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package council

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/wavetermdev/waveterm/pkg/consult"
	"github.com/wavetermdev/waveterm/pkg/jobqueue"
)

// CallReq is one claude call: the expert it speaks as, where it runs, and whether it may read the project.
type CallReq struct {
	Expert CouncilExpert
	Cwd    string
	Prompt string
	Tools  bool // round 1, the Setup suggestion, a follow-up with Let them read code on
	OnTool func(text string)
}

// CallRes is what a call returned: the whole reply, and the tokens it used (cache reads included).
type CallRes struct {
	Text   string
	Tokens int64
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
	text, usage, err := runClaude(runCtx, req.Cwd, req.Prompt, consult.CallOpts{Model: req.Expert.Model, Tools: tools}, req.OnTool)
	res := CallRes{Text: text, Tokens: int64(usage.TotalTokens)}
	if errors.Is(runCtx.Err(), context.DeadlineExceeded) {
		return res, fmt.Errorf("timed out after %s", callTimeout)
	}
	return res, err
}
