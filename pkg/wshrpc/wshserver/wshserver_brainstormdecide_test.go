// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"encoding/json"
	"reflect"
	"slices"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/brainstormcheck"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

func TestDecide(t *testing.T) {
	tests := []struct {
		name string
		run  *waveobj.Run
		lost string
		want sessionAction
	}{
		{"done with a report delivers", &waveobj.Run{Status: jarvis.RunStatus_Done, Report: "1. what?"}, "", sessionAction{Kind: sessionDeliver}},
		{"done with an empty report fails", &waveobj.Run{Status: jarvis.RunStatus_Done}, "", sessionAction{Kind: sessionFail, Reason: builderEmptyReportReason}},
		{"done with a blank report fails", &waveobj.Run{Status: jarvis.RunStatus_Done, Report: " \n\t"}, "", sessionAction{Kind: sessionFail, Reason: builderEmptyReportReason}},
		{"done with a report beats a lost reason", &waveobj.Run{Status: jarvis.RunStatus_Done, Report: "q"}, "worker exited", sessionAction{Kind: sessionDeliver}},
		{"a lost reason fails with it", &waveobj.Run{Status: jarvis.RunStatus_Executing}, "the route refused it", sessionAction{Kind: sessionFail, Reason: "the route refused it"}},
		{"a lost reason with no run fails with it", nil, "gone", sessionAction{Kind: sessionFail, Reason: "gone"}},
		{"a working run waits", &waveobj.Run{Status: jarvis.RunStatus_Executing}, "", sessionAction{Kind: sessionWait}},
		{"no run yet waits", nil, "", sessionAction{Kind: sessionWait}},
		{"a report on an unfinished run waits", &waveobj.Run{Status: jarvis.RunStatus_Executing, Report: "q"}, "", sessionAction{Kind: sessionWait}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := decideBuilderCheck(tt.run, tt.lost); got != tt.want {
				t.Fatalf("decideBuilderCheck = %+v, want %+v", got, tt.want)
			}
		})
	}
}

// judgeReport is a judge's report: a good one, changed by edit.
func judgeReport(t *testing.T, edit func(r map[string]any)) string {
	t.Helper()
	r := map[string]any{
		"options": []any{
			map[string]any{"label": "Poll the file", "detail": "Keep the 3 s poll.", "pros": []any{"brainstormpane.tsx already polls"}, "cons": []any{"lags up to 3 s"}, "pick": true},
			map[string]any{"label": "Watch with fsnotify", "detail": "Wavesrv watches the folder.", "pros": []any{"no lag"}, "cons": []any{"a new watcher per tab"}},
		},
		"read":    "The poll already exists in brainstormpane.tsx, so it costs nothing.",
		"added":   []any{"Ask the hook"},
		"dropped": []any{map[string]any{"name": "Tail the transcript", "reason": "A transcript lags the file."}},
	}
	if edit != nil {
		edit(r)
	}
	b, err := json.Marshal(r)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func option(r map[string]any, i int) map[string]any { return r["options"].([]any)[i].(map[string]any) }

func TestDecideJudge(t *testing.T) {
	done := func(report string) *waveobj.Run { return &waveobj.Run{Status: jarvis.RunStatus_Done, Report: report} }
	good := judgeReport(t, nil)
	third := map[string]any{"label": "Push from the hook", "detail": "The hook says when.", "pick": true}
	unusable := []struct {
		name   string
		report string
	}{
		{"prose around the JSON", "Here is my result:\n" + good + "\nThat's all."},
		{"a markdown json fence", "```json\n" + good + "\n```"},
		{"a JSON array", "[" + good + "]"},
		{"a field of the wrong type", judgeReport(t, func(r map[string]any) { r["added"] = "Ask the hook" })},
		{"one option", judgeReport(t, func(r map[string]any) { r["options"] = r["options"].([]any)[:1] })},
		{"five options", judgeReport(t, func(r map[string]any) {
			o := r["options"].([]any)
			r["options"] = append(o, o[1], o[1], o[1])
		})},
		{"no pick", judgeReport(t, func(r map[string]any) { delete(option(r, 0), "pick") })},
		{"two picks", judgeReport(t, func(r map[string]any) { r["options"] = append(r["options"].([]any), third) })},
		{"an empty read", judgeReport(t, func(r map[string]any) { r["read"] = "" })},
		{"a blank read", judgeReport(t, func(r map[string]any) { r["read"] = " \n" })},
		{"no read", judgeReport(t, func(r map[string]any) { delete(r, "read") })},
		{"an option with no label", judgeReport(t, func(r map[string]any) { delete(option(r, 1), "label") })},
		{"an option with no detail", judgeReport(t, func(r map[string]any) { option(r, 1)["detail"] = "" })},
		{"a dropped entry with no reason", judgeReport(t, func(r map[string]any) {
			r["dropped"] = []any{map[string]any{"name": "Tail the transcript"}}
		})},
		{"a dropped entry with no name", judgeReport(t, func(r map[string]any) {
			r["dropped"] = []any{map[string]any{"reason": "slow"}}
		})},
	}
	for _, tt := range unusable {
		t.Run(tt.name, func(t *testing.T) {
			got, out := decideJudge(done(tt.report), "")
			if got.Kind != sessionFail || !strings.HasPrefix(got.Reason, "The judge's result is not usable: ") {
				t.Fatalf("decideJudge = %+v, want a fail naming the unusable result", got)
			}
			if out != nil {
				t.Fatalf("a failed judge delivered %s", out)
			}
		})
	}

	plain := []struct {
		name string
		run  *waveobj.Run
		lost string
		want sessionAction
	}{
		{"a working run waits", &waveobj.Run{Status: jarvis.RunStatus_Executing}, "", sessionAction{Kind: sessionWait}},
		{"no run yet waits", nil, "", sessionAction{Kind: sessionWait}},
		{"done with an empty report fails", done(""), "", sessionAction{Kind: sessionFail, Reason: judgeEmptyReason}},
		{"done with a blank report fails", done(" \n\t"), "", sessionAction{Kind: sessionFail, Reason: judgeEmptyReason}},
		{"a lost reason fails with it", &waveobj.Run{Status: jarvis.RunStatus_Executing, Report: good}, "worker exited", sessionAction{Kind: sessionFail, Reason: "worker exited"}},
		{"a lost reason with no run fails with it", nil, "gone", sessionAction{Kind: sessionFail, Reason: "gone"}},
	}
	for _, tt := range plain {
		t.Run(tt.name, func(t *testing.T) {
			got, out := decideJudge(tt.run, tt.lost)
			if got != tt.want || out != nil {
				t.Fatalf("decideJudge = %+v, %s; want %+v and no bytes", got, out, tt.want)
			}
		})
	}

	t.Run("a good report delivers judge.json", func(t *testing.T) {
		for _, lost := range []string{"", "worker exited"} {
			got, out := decideJudge(done("\n"+good+"\n"), lost)
			if got != (sessionAction{Kind: sessionDeliver}) {
				t.Fatalf("decideJudge(lost %q) = %+v, want a deliver", lost, got)
			}
			var file map[string]json.RawMessage
			if err := json.Unmarshal(out, &file); err != nil {
				t.Fatalf("judge.json is not an object: %v (%s)", err, out)
			}
			if keys := sortedKeys(file); !reflect.DeepEqual(keys, []string{"judge", "multi", "options", "read"}) {
				t.Fatalf("judge.json keys = %v, want judge, multi, options, read", keys)
			}
			if string(file["multi"]) != "false" {
				t.Errorf("multi = %s, want false for a report that leaves it out", file["multi"])
			}
			var judge map[string]json.RawMessage
			if err := json.Unmarshal(file["judge"], &judge); err != nil {
				t.Fatal(err)
			}
			if keys := sortedKeys(judge); !reflect.DeepEqual(keys, []string{"added", "dropped"}) {
				t.Fatalf("judge.json judge keys = %v, want added, dropped", keys)
			}
			var parsed struct {
				Options []brainstormcheck.JudgeOption `json:"options"`
				Read    string                        `json:"read"`
				Judge   struct {
					Added   []string            `json:"added"`
					Dropped []map[string]string `json:"dropped"`
				} `json:"judge"`
			}
			if err := json.Unmarshal(out, &parsed); err != nil {
				t.Fatal(err)
			}
			wantOptions := []brainstormcheck.JudgeOption{
				{Label: "Poll the file", Detail: "Keep the 3 s poll.", Pros: []string{"brainstormpane.tsx already polls"}, Cons: []string{"lags up to 3 s"}, Pick: true},
				{Label: "Watch with fsnotify", Detail: "Wavesrv watches the folder.", Pros: []string{"no lag"}, Cons: []string{"a new watcher per tab"}},
			}
			if !reflect.DeepEqual(parsed.Options, wantOptions) {
				t.Errorf("options = %+v, want %+v", parsed.Options, wantOptions)
			}
			if parsed.Read != "The poll already exists in brainstormpane.tsx, so it costs nothing." {
				t.Errorf("read = %q", parsed.Read)
			}
			if !reflect.DeepEqual(parsed.Judge.Added, []string{"Ask the hook"}) {
				t.Errorf("added = %v", parsed.Judge.Added)
			}
			if want := []map[string]string{{"name": "Tail the transcript", "reason": "A transcript lags the file."}}; !reflect.DeepEqual(parsed.Judge.Dropped, want) {
				t.Errorf("dropped = %v, want %v", parsed.Judge.Dropped, want)
			}
		}
	})

	t.Run("a report whose options combine says so in judge.json", func(t *testing.T) {
		got, out := decideJudge(done(judgeReport(t, func(r map[string]any) { r["multi"] = true })), "")
		if got.Kind != sessionDeliver {
			t.Fatalf("decideJudge = %+v, want a deliver", got)
		}
		if !strings.Contains(string(out), `"multi":true`) {
			t.Fatalf("judge.json = %s, want multi true", out)
		}
	})

	t.Run("a report with nothing added or dropped writes empty lists", func(t *testing.T) {
		got, out := decideJudge(done(judgeReport(t, func(r map[string]any) {
			delete(r, "added")
			r["dropped"] = nil
		})), "")
		if got.Kind != sessionDeliver {
			t.Fatalf("decideJudge = %+v, want a deliver", got)
		}
		if !strings.Contains(string(out), `"judge":{"added":[],"dropped":[]}`) {
			t.Fatalf("judge.json = %s, want added and dropped as empty lists", out)
		}
	})
}

func sortedKeys(m map[string]json.RawMessage) []string {
	var keys []string
	for k := range m {
		keys = append(keys, k)
	}
	slices.Sort(keys)
	return keys
}
