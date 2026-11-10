// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"strings"

	"github.com/wavetermdev/waveterm/pkg/brainstormcheck"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

// The watcher half of the brainstorm sessions: what one tick does about a builder check's or a judge's run. It lives
// here, not in pkg/brainstormcheck, because it judges a waveobj.Run, and that package stays a leaf (the bench imports
// it, and jarvis imports the bench through wshrpc).

const (
	// builderEmptyReportReason is why a check fails when the reviewer ended its session with no report.
	builderEmptyReportReason = "The builder ended without its questions."

	// judgeEmptyReason is why a judge fails when it ended its session with no result.
	judgeEmptyReason = "The judge ended without its result."

	judgeUnusableHead = "The judge's result is not usable: "
)

type sessionActionKind int

const (
	sessionWait sessionActionKind = iota
	sessionDeliver
	sessionFail
)

// sessionAction is what one watcher tick does. Reason is set for sessionFail.
type sessionAction struct {
	Kind   sessionActionKind
	Reason string
}

// decideBuilderCheck judges the reviewer's run. lostReason is JudgingSessionLost's verdict, "" while the session still
// works. A finished run is judged before a lost reason: a reviewer that reported and then exited is not lost.
func decideBuilderCheck(run *waveobj.Run, lostReason string) sessionAction {
	return decideSession(run, lostReason, builderEmptyReportReason)
}

// decideSession is decideBuilderCheck for any session Arc launches; emptyReason is why a finished run with no report
// fails.
func decideSession(run *waveobj.Run, lostReason, emptyReason string) sessionAction {
	if run != nil && run.Status == jarvis.RunStatus_Done {
		if strings.TrimSpace(run.Report) == "" {
			return sessionAction{Kind: sessionFail, Reason: emptyReason}
		}
		return sessionAction{Kind: sessionDeliver}
	}
	if lostReason != "" {
		return sessionAction{Kind: sessionFail, Reason: lostReason}
	}
	return sessionAction{Kind: sessionWait}
}

// decideJudge judges the judge's run as decideBuilderCheck judges the reviewer's, then checks its result. A deliver
// carries judge.json's bytes; a result that fails the check fails the judge with the check's error as the reason.
func decideJudge(run *waveobj.Run, lostReason string) (sessionAction, []byte) {
	action := decideSession(run, lostReason, judgeEmptyReason)
	if action.Kind != sessionDeliver {
		return action, nil
	}
	out, err := brainstormcheck.JudgeFileBytes(run.Report)
	if err != nil {
		return sessionAction{Kind: sessionFail, Reason: judgeUnusableHead + err.Error()}, nil
	}
	return action, out
}
