// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package workflowscan

import (
	"reflect"
	"strings"
	"testing"
)

func TestSonnetPromptAsks(t *testing.T) {
	c := corpusOf(t, fixtureRun{runId(1), 1, "p", failFirst})
	p := SonnetPrompt(c)
	for _, want := range []string{
		"3 or more distinct runs",
		"verbatim",
		"<file> · <symbol or section>",
		`"patterns"`,
		`"fixtarget"`,
		`"citations"`,
		c.Text,
	} {
		if !strings.Contains(p, want) {
			t.Errorf("prompt lacks %q", want)
		}
	}
}

func TestParseSonnetReply(t *testing.T) {
	want := []Candidate{{
		Title:     "skipped red step",
		FixTarget: "pkg/orchestrate/engine.go · workerContract",
		Citations: []Citation{{Run: "abcdef01", Quote: "skipped the red step"}},
	}}
	body := `{"patterns":[{"title":"skipped red step","fixtarget":"pkg/orchestrate/engine.go · workerContract","citations":[{"run":"abcdef01","quote":"skipped the red step"}]}]}`

	fenced := "Here are the patterns.\n\n```json\n{\"patterns\":[]}\n```\n\nRevised:\n\n```json\n" + body + "\n```\nThat is all."
	got, err := ParseSonnetReply(fenced)
	if err != nil || !reflect.DeepEqual(got, want) {
		t.Errorf("fenced: got %+v, %v; want the last block", got, err)
	}

	bare := "I found one pattern: " + body + " and nothing else."
	got, err = ParseSonnetReply(bare)
	if err != nil || !reflect.DeepEqual(got, want) {
		t.Errorf("bare: got %+v, %v", got, err)
	}

	reply := "I could not find any patterns worth naming in this corpus, sorry. " + strings.Repeat("words ", 60)
	_, err = ParseSonnetReply(reply)
	if err == nil || !strings.Contains(err.Error(), reply[:200]) || strings.Contains(err.Error(), reply[:201]) {
		t.Errorf("no block: err = %v, want one quoting the first 200 chars", err)
	}

	_, err = ParseSonnetReply("```json\n{\"patterns\": [\n```")
	if err == nil {
		t.Errorf("bad JSON parsed")
	}
}
