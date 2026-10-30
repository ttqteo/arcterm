// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"errors"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const goalpostJSON = `[{"rule":"test-skip","file":"a.test.ts","title":"test skipped","before":["it('adds'"],"after":["it.skip('adds'"]}]`

// stubGoalpost stands in for wavesrv: a caller run, and the goalpost call's answer. Either one failing the
// test when called shows a command that reached wavesrv when it should not have.
func stubGoalpost(t *testing.T, lookup func(int64) (*wshrpc.CommandJarvisCtxRtnData, error), send func(wshrpc.CommandDagGoalpostData) (*wshrpc.CommandDagGoalpostRtnData, error)) {
	t.Helper()
	stubWavesrv(t)
	old := sendDagGoalpost
	t.Cleanup(func() { sendDagGoalpost = old })
	lookupRunCtx, sendDagGoalpost = lookup, send
}

func noLookup(t *testing.T) func(int64) (*wshrpc.CommandJarvisCtxRtnData, error) {
	return func(int64) (*wshrpc.CommandJarvisCtxRtnData, error) {
		t.Fatal("no lookup expected")
		return nil, nil
	}
}

func noSend(t *testing.T) func(wshrpc.CommandDagGoalpostData) (*wshrpc.CommandDagGoalpostRtnData, error) {
	return func(wshrpc.CommandDagGoalpostData) (*wshrpc.CommandDagGoalpostRtnData, error) {
		t.Fatal("no goalpost call expected")
		return nil, nil
	}
}

func inRun(int64) (*wshrpc.CommandJarvisCtxRtnData, error) {
	return &wshrpc.CommandJarvisCtxRtnData{ChannelId: "ch", RunId: "run-1"}, nil
}

func TestDagGoalpostRejectsBadFindingsBeforeAnyRpc(t *testing.T) {
	for name, raw := range map[string]string{
		"malformed JSON": `[{"rule":`,
		"not an array":   `{"rule":"test-skip","title":"t"}`,
		"an empty array": `[]`,
		"no title":       `[{"rule":"test-skip"}]`,
	} {
		t.Run(name, func(t *testing.T) {
			stubGoalpost(t, noLookup(t), noSend(t))
			if _, err := dagGoalpostLine(dagGoalpostCmd, raw); err == nil {
				t.Fatal("want an error")
			}
		})
	}
}

func TestDagGoalpostWithNoRunIsNotATaskWorker(t *testing.T) {
	stubGoalpost(t, func(int64) (*wshrpc.CommandJarvisCtxRtnData, error) {
		return &wshrpc.CommandJarvisCtxRtnData{}, nil
	}, noSend(t))
	line, err := dagGoalpostLine(dagGoalpostCmd, goalpostJSON)
	if err != nil || line != goalpostNotTaskWorker {
		t.Fatalf("want %q, got %q, %v", goalpostNotTaskWorker, line, err)
	}
}

func TestDagGoalpostPrintsTheServersAnswer(t *testing.T) {
	for _, tc := range []struct {
		recorded bool
		want     string
	}{{true, "recorded"}, {false, "not a task worker"}} {
		var sent wshrpc.CommandDagGoalpostData
		stubGoalpost(t, inRun, func(data wshrpc.CommandDagGoalpostData) (*wshrpc.CommandDagGoalpostRtnData, error) {
			sent = data
			return &wshrpc.CommandDagGoalpostRtnData{Recorded: tc.recorded}, nil
		})
		line, err := dagGoalpostLine(dagGoalpostCmd, goalpostJSON)
		if err != nil || line != tc.want {
			t.Fatalf("want %q, got %q, %v", tc.want, line, err)
		}
		if sent.ChannelId != "ch" || sent.RunId != "run-1" || len(sent.Findings) != 1 || sent.Findings[0].After[0] != "it.skip('adds'" {
			t.Fatalf("want the caller's run and the findings sent, got %+v", sent)
		}
	}
}

func TestDagGoalpostRpcFailureIsAnError(t *testing.T) {
	stubGoalpost(t, inRun, func(wshrpc.CommandDagGoalpostData) (*wshrpc.CommandDagGoalpostRtnData, error) {
		return nil, errors.New(rpcTimeoutText)
	})
	if _, err := dagGoalpostLine(dagGoalpostCmd, goalpostJSON); err == nil {
		t.Fatal("want an error")
	}
}
