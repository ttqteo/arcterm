package brainstormcheck

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"reflect"
	"regexp"
	"slices"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

var judgeApproaches = []Approach{
	{Name: "Poll the file", Description: "Read brainstorm.json every few seconds.", Facts: []string{"brainstormpane.tsx polls every 3000 ms"}},
	{Name: "Watch with fsnotify", Description: "Wavesrv watches the topic folder.", Facts: []string{"pkg/filewatcher wraps fsnotify", "it debounces at 100 ms"}},
	{Name: "Push from the hook", Description: "The write hook tells Arc the file changed.", Facts: []string{"the PostToolUse hook sees every Write"}},
	{Name: "Store it in wavesrv", Description: "The agent writes through an RPC instead of a file.", Facts: []string{"wstore already holds tab meta"}},
	{Name: "Tail the transcript", Description: "Arc reads the agent's transcript for writes.", Facts: []string{"wsh transcript-tail exists"}},
}

// judgeFixture is a brainstorm file with every kind of entry the judge must and must not see. Every *-MARKER string
// is the agent's lean or work, which the judge's prompt must never hold; extra is spliced into the question.
func judgeFixture(t *testing.T, extra string) []byte {
	t.Helper()
	var approaches []string
	for i, a := range judgeApproaches {
		b, err := json.Marshal(a)
		if err != nil {
			t.Fatal(err)
		}
		// the agent's odds, which Arc must never pass on
		approaches = append(approaches, strings.TrimSuffix(string(b), "}")+fmt.Sprintf(`,"probability":0.%d}`, i+1))
	}
	return []byte(`{
  "v": 1, "title": "Live brainstorm pane",
  "question": {
    "n": 4, "text": "How should the pane learn that the file changed?", "part": "sync",
    "why": "WHY-MARKER", "read": "READ-MARKER",
    "approaches": [` + strings.Join(approaches, ",") + `]` + extra + `
  },
  "working": null,
  "parts": [
    { "id": "intent", "title": "Intent", "state": "yours", "body": "Show the brainstorm while it forms." },
    { "id": "look", "title": "Look", "state": "guess", "body": "GUESS-MARKER" },
    { "id": "today", "title": "What runs today", "kind": "note", "state": "yours", "body": "NOTE-MARKER" },
    { "id": "sync", "title": "Sync", "state": "asked", "body": "" }
  ],
  "history": [
    { "kind": "question", "n": 1, "q": "What should this make possible?", "why": "OLD-WHY-MARKER", "a": "See the design as it forms.", "into": ["intent"] },
    { "kind": "question", "n": 2, "q": "SUPERSEDED-Q-MARKER", "a": "SUPERSEDED-A-MARKER", "superseded": true, "part": "look" },
    { "kind": "recon", "q": "You asked: what polls today?", "a": "RECON-MARKER", "into": [] }
  ],
  "done": false,
  "check": { "yours": [
    { "q": "Does a closed pane keep polling?", "why": "CHECK-WHY-MARKER", "a": "No, it stops." },
    { "q": "UNANSWERED-CHECK-MARKER", "why": "the spec is silent" }
  ] },
  "run": null
}`)
}

func TestReadJudgeInputRefusals(t *testing.T) {
	named := func(names ...string) string {
		var as []string
		for _, n := range names {
			as = append(as, fmt.Sprintf(`{"name":%q,"description":"d","facts":["f"]}`, n))
		}
		return `{"v":1,"title":"t","parts":[],"question":{"n":1,"text":"q","approaches":[` + strings.Join(as, ",") + `]}}`
	}
	tests := []struct {
		name string
		raw  string
	}{
		{"invalid JSON", `{"v":1,`},
		{"no question", `{"v":1,"title":"t","parts":[],"question":null}`},
		{"a question with no approaches", `{"v":1,"title":"t","parts":[],"question":{"n":1,"text":"q"}}`},
		{"four named approaches and a nameless one", named("A", "B", "C", "D", "")},
		{"four named approaches and a blank-named one", named("A", "B", "C", "D", "  ")},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := ReadJudgeInput([]byte(tt.raw)); err == nil {
				t.Fatalf("ReadJudgeInput accepted %s", tt.raw)
			}
		})
	}
	_, err := ReadJudgeInput([]byte(named("A", "B", "C", "D", "")))
	if err == nil || !strings.Contains(err.Error(), "at least 5") {
		t.Fatalf("the floor's refusal = %v, want it to name the floor of 5", err)
	}
	in, err := ReadJudgeInput([]byte(named("A", "B", "C", "D", "", "E")))
	if err != nil {
		t.Fatalf("five named approaches beside a nameless one refused: %v", err)
	}
	if len(in.Approaches) != 5 {
		t.Fatalf("Approaches = %+v, want the five named ones", in.Approaches)
	}
}

func TestReadJudgeInputKeepsOnlyWhatTheJudgeMaySee(t *testing.T) {
	in, err := ReadJudgeInput(judgeFixture(t, ""))
	if err != nil {
		t.Fatal(err)
	}
	if in.Question != "How should the pane learn that the file changed?" {
		t.Errorf("Question = %q", in.Question)
	}
	wantAnswers := []QA{
		{Q: "What should this make possible?", A: "See the design as it forms."},
		{Q: "Does a closed pane keep polling?", A: "No, it stops."},
	}
	if !reflect.DeepEqual(in.Answers, wantAnswers) {
		t.Errorf("Answers = %+v, want %+v", in.Answers, wantAnswers)
	}
	wantConfirmed := []ConfirmedPart{{Title: "Intent", Body: "Show the brainstorm while it forms."}}
	if !reflect.DeepEqual(in.Confirmed, wantConfirmed) {
		t.Errorf("Confirmed = %+v, want %+v", in.Confirmed, wantConfirmed)
	}
	if !reflect.DeepEqual(in.Approaches, judgeApproaches) {
		t.Errorf("Approaches = %+v, want %+v", in.Approaches, judgeApproaches)
	}
	if in.Earlier != nil {
		t.Errorf("Earlier = %+v with no judge record, want nil", in.Earlier)
	}

	options := `,
    "options": [
      { "label": "Poll the file", "detail": "Keep the 3 s poll.", "pros": ["exists"], "cons": ["lags 3 s"], "pick": true },
      { "label": "Watch with fsnotify", "detail": "Wavesrv watches the folder." }
    ]`
	wantEarlier := []JudgeOption{
		{Label: "Poll the file", Detail: "Keep the 3 s poll.", Pros: []string{"exists"}, Cons: []string{"lags 3 s"}, Pick: true},
		{Label: "Watch with fsnotify", Detail: "Wavesrv watches the folder."},
	}
	weighed := options + `, "judge": { "added": [], "dropped": [{ "name": "Tail the transcript", "reason": "slow" }] }`
	in, err = ReadJudgeInput(judgeFixture(t, weighed))
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(in.Earlier, wantEarlier) {
		t.Errorf("Earlier = %+v with a weighed record, want question.options %+v", in.Earlier, wantEarlier)
	}

	for _, judge := range []string{`{ "failed": "Arc restarted." }`, `"x"`, `{}`, `{ "added": 3, "dropped": [] }`, `null`} {
		in, err = ReadJudgeInput(judgeFixture(t, options+`, "judge": `+judge))
		if err != nil {
			t.Fatalf("judge %s: %v", judge, err)
		}
		if in.Earlier != nil {
			t.Errorf("Earlier = %+v with judge %s, want nil: only a weighed record's options are the judge's", in.Earlier, judge)
		}
	}
}

func reverse(n int, swap func(i, j int)) {
	for i := 0; i < n/2; i++ {
		swap(i, n-1-i)
	}
}

func keep(int, func(i, j int)) {}

func TestJudgePromptHoldsTheListShuffledAndNoFavorite(t *testing.T) {
	in, err := ReadJudgeInput(judgeFixture(t, ""))
	if err != nil {
		t.Fatal(err)
	}
	report := filepath.Join("tmp", "judge-report.json")
	got := JudgePrompt(in, "", report, reverse)

	want := []string{in.Question, report, "What should this make possible?", "See the design as it forms.",
		"Does a closed pane keep polling?", "No, it stops.", "Intent", "Show the brainstorm while it forms."}
	for _, a := range judgeApproaches {
		want = append(want, a.Name, a.Description)
		want = append(want, a.Facts...)
	}
	for _, w := range want {
		if !strings.Contains(got, w) {
			t.Errorf("prompt lacks %q", w)
		}
	}
	if m := regexp.MustCompile(`[A-Z]+(-[A-Z]+)*-MARKER`).FindString(got); m != "" {
		t.Errorf("prompt holds %s, which the judge must never see", m)
	}
	if strings.Contains(strings.ToLower(got), "probability") {
		t.Errorf("prompt passes on the agent's odds")
	}
	if m := regexp.MustCompile(`\[[A-Z_]+\]`).FindString(got); m != "" {
		t.Errorf("prompt left placeholder %s", m)
	}

	order := func(prompt string) []int {
		var at []int
		for _, a := range judgeApproaches {
			at = append(at, strings.Index(prompt, a.Name))
		}
		return at
	}
	reversed := order(got)
	if !slices.IsSortedFunc(reversed, func(a, b int) int { return b - a }) {
		t.Errorf("with a reversing shuffle the approaches sit at %v, want reverse file order", reversed)
	}
	if kept := order(JudgePrompt(in, "", report, keep)); !slices.IsSorted(kept) {
		t.Errorf("with no shuffle the approaches sit at %v, want file order", kept)
	}
	if !reflect.DeepEqual(in.Approaches, judgeApproaches) {
		t.Errorf("JudgePrompt shuffled the caller's list: %+v", in.Approaches)
	}
}

func TestJudgePromptOnARerun(t *testing.T) {
	in, err := ReadJudgeInput(judgeFixture(t, ""))
	if err != nil {
		t.Fatal(err)
	}
	report := filepath.Join("tmp", "judge-report.json")
	if got := JudgePrompt(in, "", report, keep); strings.Contains(got, rerunHead) {
		t.Fatalf("a first judge's prompt holds the rerun section")
	}

	in.Earlier = []JudgeOption{
		{Label: "Earlier poll", Detail: "Keep the poll."},
		{Label: "Earlier fsnotify", Detail: "Watch the folder.", Pick: true},
	}
	line := `double check`
	got := JudgePrompt(in, line, report, keep)
	for _, w := range []string{rerunHead, "Earlier poll", "Earlier fsnotify (the pick)", line} {
		if !strings.Contains(got, w) {
			t.Errorf("rerun prompt lacks %q", w)
		}
	}
	if strings.Contains(got, "Earlier poll (the pick)") {
		t.Errorf("rerun prompt marks an option the judge did not pick")
	}

	pushback := `what about "a socket"? it's cheaper`
	if got := JudgePrompt(JudgeInput{Approaches: judgeApproaches}, pushback, report, keep); !strings.Contains(got, rerunHead) || !strings.Contains(got, pushback) {
		t.Errorf("a rerun with only the user's line does not carry it verbatim")
	}
}

func TestJudgePromptSaysWhatTheJudgeMustDo(t *testing.T) {
	report := filepath.Join("tmp", "judge-report.json")
	got := JudgePrompt(JudgeInput{Approaches: judgeApproaches}, "", report, keep)
	for _, w := range []string{".superpowers/", "Change no file", "Verify", "would beat every listed", "Ground every pro and con",
		"Write only the JSON object to " + report} {
		if !strings.Contains(got, w) {
			t.Errorf("prompt lacks %q", w)
		}
	}
	if want := "wsh jarvis complete --report " + report; !strings.HasSuffix(strings.TrimSpace(got), want) {
		t.Errorf("prompt does not end with %q", want)
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
			got, out := DecideJudge(done(tt.report), "")
			if got.Kind != Fail || !strings.HasPrefix(got.Reason, "The judge's result is not usable: ") {
				t.Fatalf("DecideJudge = %+v, want Fail naming the unusable result", got)
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
		want Action
	}{
		{"a working run waits", &waveobj.Run{Status: jarvis.RunStatus_Executing}, "", Action{Kind: Wait}},
		{"no run yet waits", nil, "", Action{Kind: Wait}},
		{"done with an empty report fails", done(""), "", Action{Kind: Fail, Reason: JudgeEmptyReason}},
		{"done with a blank report fails", done(" \n\t"), "", Action{Kind: Fail, Reason: JudgeEmptyReason}},
		{"a lost reason fails with it", &waveobj.Run{Status: jarvis.RunStatus_Executing, Report: good}, "worker exited", Action{Kind: Fail, Reason: "worker exited"}},
		{"a lost reason with no run fails with it", nil, "gone", Action{Kind: Fail, Reason: "gone"}},
	}
	for _, tt := range plain {
		t.Run(tt.name, func(t *testing.T) {
			got, out := DecideJudge(tt.run, tt.lost)
			if got != tt.want || out != nil {
				t.Fatalf("DecideJudge = %+v, %s; want %+v and no bytes", got, out, tt.want)
			}
		})
	}

	t.Run("a good report delivers judge.json", func(t *testing.T) {
		for _, lost := range []string{"", "worker exited"} {
			got, out := DecideJudge(done("\n"+good+"\n"), lost)
			if got != (Action{Kind: Deliver}) {
				t.Fatalf("DecideJudge(lost %q) = %+v, want Deliver", lost, got)
			}
			var file map[string]json.RawMessage
			if err := json.Unmarshal(out, &file); err != nil {
				t.Fatalf("judge.json is not an object: %v (%s)", err, out)
			}
			if keys := sortedKeys(file); !reflect.DeepEqual(keys, []string{"judge", "options", "read"}) {
				t.Fatalf("judge.json keys = %v, want judge, options, read", keys)
			}
			var judge map[string]json.RawMessage
			if err := json.Unmarshal(file["judge"], &judge); err != nil {
				t.Fatal(err)
			}
			if keys := sortedKeys(judge); !reflect.DeepEqual(keys, []string{"added", "dropped"}) {
				t.Fatalf("judge.json judge keys = %v, want added, dropped", keys)
			}
			var parsed struct {
				Options []JudgeOption `json:"options"`
				Read    string        `json:"read"`
				Judge   struct {
					Added   []string            `json:"added"`
					Dropped []map[string]string `json:"dropped"`
				} `json:"judge"`
			}
			if err := json.Unmarshal(out, &parsed); err != nil {
				t.Fatal(err)
			}
			wantOptions := []JudgeOption{
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

	t.Run("a report with nothing added or dropped writes empty lists", func(t *testing.T) {
		got, out := DecideJudge(done(judgeReport(t, func(r map[string]any) {
			delete(r, "added")
			r["dropped"] = nil
		})), "")
		if got.Kind != Deliver {
			t.Fatalf("DecideJudge = %+v, want Deliver", got)
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

func TestJudgePathsAndLines(t *testing.T) {
	file := filepath.Join("proj", ".superpowers", "brainstorm", "topic", "brainstorm.json")
	if got, want := JudgeResultPath(file), filepath.Join("proj", ".superpowers", "brainstorm", "topic", "judge.json"); got != want {
		t.Errorf("JudgeResultPath = %q, want %q", got, want)
	}
	if got, want := JudgedLine("/p/topic/judge.json"), "brainstorm: judged /p/topic/judge.json"; got != want {
		t.Errorf("JudgedLine = %q, want %q", got, want)
	}
	if got, want := JudgeFailedLine("Arc restarted before the judge started."), "brainstorm: judge failed: Arc restarted before the judge started."; got != want {
		t.Errorf("JudgeFailedLine = %q, want %q", got, want)
	}
}
