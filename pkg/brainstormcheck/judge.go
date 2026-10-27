package brainstormcheck

import (
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"slices"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

const (
	// MinApproaches is the fewest named approaches a question lists before the judge weighs it.
	MinApproaches = 5

	// JudgeEmptyReason is why a judge fails when it ended its session with no result.
	JudgeEmptyReason = "The judge ended without its result."

	minJudgeOptions = 2
	maxJudgeOptions = 4

	judgeFileName   = "judge.json"
	judgedLineHead  = "brainstorm: judged "
	judgeFailedHead = "brainstorm: judge failed: "
	unusableHead    = "The judge's result is not usable: "
	rerunHead       = "This decision was put to the user before."
	pickMark        = " (the pick)"

	// the brainstorm file's values that decide what the judge may see
	historyQuestion = "question"
	stateYours      = "yours"
	kindNote        = "note"
)

//go:embed judge-prompt.md
var judgePromptTemplate string

// Approach is one entry of the agent's list in question.approaches: facts only, no odds and no verdict.
type Approach struct {
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Facts       []string `json:"facts"`
}

// JudgeOption is one answer the judge offers, shaped as a question's option in brainstorm.json.
type JudgeOption struct {
	Label  string   `json:"label"`
	Detail string   `json:"detail"`
	Pros   []string `json:"pros,omitempty"`
	Cons   []string `json:"cons,omitempty"`
	Pick   bool     `json:"pick,omitempty"`
}

// QA is one answer the user gave: the question and their answer.
type QA struct {
	Q, A string
}

// ConfirmedPart is one part of the design the user made theirs.
type ConfirmedPart struct {
	Title, Body string
}

// JudgeInput is what the judge may see of a brainstorm. It holds nothing the agent wrote about its own lean: no
// why, read, guess, note, recon finding or odds.
type JudgeInput struct {
	Question   string
	Answers    []QA
	Confirmed  []ConfirmedPart
	Approaches []Approach
	// Earlier is question.options when question.judge is a weighed record: the last judge's options, for a rerun.
	Earlier []JudgeOption
}

type judgeDrop struct {
	Name   string `json:"name"`
	Reason string `json:"reason"`
}

// judgeResult is the one JSON object the judge writes to its report.
type judgeResult struct {
	Options []JudgeOption `json:"options"`
	Read    string        `json:"read"`
	Added   []string      `json:"added"`
	Dropped []judgeDrop   `json:"dropped"`
}

// judgeFile is judge.json, in the shape the agent merges onto question as is.
type judgeFile struct {
	Options []JudgeOption `json:"options"`
	Read    string        `json:"read"`
	Judge   judgeWork     `json:"judge"`
}

// judgeWork is question.judge's weighed record.
type judgeWork struct {
	Added   []string    `json:"added"`
	Dropped []judgeDrop `json:"dropped"`
}

// brainstormSource is the part of brainstorm.json ReadJudgeInput reads.
type brainstormSource struct {
	Question *struct {
		Text       string          `json:"text"`
		Approaches []Approach      `json:"approaches"`
		Options    []JudgeOption   `json:"options"`
		Judge      json.RawMessage `json:"judge"`
	} `json:"question"`
	Parts []struct {
		Title string `json:"title"`
		Body  string `json:"body"`
		State string `json:"state"`
		Kind  string `json:"kind"`
	} `json:"parts"`
	History []struct {
		Kind       string `json:"kind"`
		Q          string `json:"q"`
		A          string `json:"a"`
		Superseded bool   `json:"superseded"`
	} `json:"history"`
	Check *struct {
		Yours []struct {
			Q string `json:"q"`
			A string `json:"a"`
		} `json:"yours"`
	} `json:"check"`
}

// ReadJudgeInput reads what the judge may see from a brainstorm file. Its error is why the judge can't weigh the
// open question: no question, or fewer than MinApproaches named approaches.
func ReadJudgeInput(raw []byte) (JudgeInput, error) {
	var src brainstormSource
	if err := json.Unmarshal(raw, &src); err != nil {
		return JudgeInput{}, fmt.Errorf("the brainstorm file is not readable: %w", err)
	}
	q := src.Question
	if q == nil {
		return JudgeInput{}, errors.New("the brainstorm has no open question")
	}
	in := JudgeInput{Question: q.Text}
	for _, a := range q.Approaches {
		if strings.TrimSpace(a.Name) != "" {
			in.Approaches = append(in.Approaches, a)
		}
	}
	if len(in.Approaches) < MinApproaches {
		return JudgeInput{}, fmt.Errorf("question.approaches lists %d named approaches; the judge needs at least %d",
			len(in.Approaches), MinApproaches)
	}
	for _, h := range src.History {
		if h.Kind == historyQuestion && !h.Superseded && strings.TrimSpace(h.A) != "" {
			in.Answers = append(in.Answers, QA{Q: h.Q, A: h.A})
		}
	}
	if src.Check != nil {
		for _, y := range src.Check.Yours {
			if strings.TrimSpace(y.A) != "" {
				in.Answers = append(in.Answers, QA{Q: y.Q, A: y.A})
			}
		}
	}
	for _, p := range src.Parts {
		if p.State == stateYours && p.Kind != kindNote {
			in.Confirmed = append(in.Confirmed, ConfirmedPart{Title: p.Title, Body: p.Body})
		}
	}
	if weighed(q.Judge) {
		in.Earlier = q.Options
	}
	return in, nil
}

// weighed reports whether a question's judge field is a weighed record. A failed record's options are the agent's.
func weighed(judge json.RawMessage) bool {
	var rec struct {
		Added   *[]string          `json:"added"`
		Dropped *[]json.RawMessage `json:"dropped"`
	}
	return json.Unmarshal(judge, &rec) == nil && rec.Added != nil && rec.Dropped != nil
}

// JudgePrompt is the judge's prompt for in, which ends with its result written to reportPath. shuffle orders the
// list (rand.Shuffle), so the agent's order can't carry its favorite. line is the user's reply on a rerun, as they
// typed it.
func JudgePrompt(in JudgeInput, line, reportPath string, shuffle func(n int, swap func(i, j int))) string {
	approaches := slices.Clone(in.Approaches)
	shuffle(len(approaches), func(i, j int) { approaches[i], approaches[j] = approaches[j], approaches[i] })
	return strings.NewReplacer(
		"[ANSWERS]", answersText(in.Answers),
		"[CONFIRMED]", confirmedText(in.Confirmed),
		"[QUESTION]", in.Question,
		"[APPROACHES]", approachesText(approaches),
		"[RERUN]", rerunText(in.Earlier, line),
		"[REPORT_PATH]", reportPath,
	).Replace(judgePromptTemplate)
}

func answersText(answers []QA) string {
	if len(answers) == 0 {
		return "(none yet)"
	}
	var b strings.Builder
	for _, qa := range answers {
		fmt.Fprintf(&b, "- Q: %s\n  A: %s\n", qa.Q, qa.A)
	}
	return strings.TrimSuffix(b.String(), "\n")
}

func confirmedText(parts []ConfirmedPart) string {
	if len(parts) == 0 {
		return "(none yet)"
	}
	var b strings.Builder
	for _, p := range parts {
		fmt.Fprintf(&b, "- %s: %s\n", p.Title, p.Body)
	}
	return strings.TrimSuffix(b.String(), "\n")
}

func approachesText(approaches []Approach) string {
	var b strings.Builder
	for i, a := range approaches {
		fmt.Fprintf(&b, "%d. %s: %s\n", i+1, a.Name, a.Description)
		if len(a.Facts) == 0 {
			b.WriteString("   Facts: none listed\n")
			continue
		}
		b.WriteString("   Facts:\n")
		for _, f := range a.Facts {
			fmt.Fprintf(&b, "   - %s\n", f)
		}
	}
	return strings.TrimSuffix(b.String(), "\n")
}

// rerunText is the rerun section, "" on a question's first judge. A bare "double check" is no reason to change a
// pick: in the benchmark, today's rule flipped on 10 of 36 double checks, and 1 of those moved toward the user's
// choice.
func rerunText(earlier []JudgeOption, line string) string {
	if len(earlier) == 0 && line == "" {
		return ""
	}
	var b strings.Builder
	b.WriteString("\n" + rerunHead + "\n")
	if len(earlier) > 0 {
		b.WriteString("\nAn earlier judge weighed it and offered:\n\n")
		for _, o := range earlier {
			mark := ""
			if o.Pick {
				mark = pickMark
			}
			fmt.Fprintf(&b, "- %s%s: %s\n", o.Label, mark, o.Detail)
		}
	}
	if line != "" {
		fmt.Fprintf(&b, "\nThe user's reply, as they typed it:\n\n%s\n", line)
	}
	b.WriteString("\nWeigh the list afresh, adding any approach the user names. A reply that only asks for another " +
		"look is no reason to change a pick: change it only for a fact you find or a reason the user gives.\n")
	return b.String()
}

// DecideJudge judges the judge's run as Decide judges the reviewer's, then checks its result. Deliver carries
// judge.json's bytes; a result that fails the check fails the judge with the check's error as the reason.
func DecideJudge(run *waveobj.Run, lostReason string) (Action, []byte) {
	action := decide(run, lostReason, JudgeEmptyReason)
	if action.Kind != Deliver {
		return action, nil
	}
	out, err := judgeFileBytes(run.Report)
	if err != nil {
		return Action{Kind: Fail, Reason: unusableHead + err.Error()}, nil
	}
	return action, out
}

// judgeFileBytes checks the judge's report and turns it into judge.json. The report is the JSON object alone:
// prose or a code fence around it fails rather than delivers half a question.
func judgeFileBytes(report string) ([]byte, error) {
	var r judgeResult
	if err := json.Unmarshal([]byte(strings.TrimSpace(report)), &r); err != nil {
		return nil, fmt.Errorf("it is not the one JSON object the prompt asks for (%v)", err)
	}
	if err := checkJudgeResult(r); err != nil {
		return nil, err
	}
	return json.Marshal(judgeFile{
		Options: r.Options,
		Read:    r.Read,
		Judge:   judgeWork{Added: orEmpty(r.Added), Dropped: orEmpty(r.Dropped)},
	})
}

func checkJudgeResult(r judgeResult) error {
	if n := len(r.Options); n < minJudgeOptions || n > maxJudgeOptions {
		return fmt.Errorf("it has %d options, not %d to %d", n, minJudgeOptions, maxJudgeOptions)
	}
	picks := 0
	for i, o := range r.Options {
		if strings.TrimSpace(o.Label) == "" {
			return fmt.Errorf("option %d has no label", i+1)
		}
		if strings.TrimSpace(o.Detail) == "" {
			return fmt.Errorf("option %d has no detail", i+1)
		}
		if o.Pick {
			picks++
		}
	}
	if picks != 1 {
		return fmt.Errorf("it picks %d options, not one", picks)
	}
	if strings.TrimSpace(r.Read) == "" {
		return errors.New("its read is empty")
	}
	for i, d := range r.Dropped {
		if strings.TrimSpace(d.Name) == "" {
			return fmt.Errorf("dropped entry %d has no name", i+1)
		}
		if strings.TrimSpace(d.Reason) == "" {
			return fmt.Errorf("dropped entry %d has no reason", i+1)
		}
	}
	return nil
}

// orEmpty writes a list the judge left out as [], never null: a weighed record holds both lists.
func orEmpty[T any](s []T) []T {
	if s == nil {
		return []T{}
	}
	return s
}

// JudgeResultPath is where the judge's result is delivered: judge.json beside the brainstorm's file.
func JudgeResultPath(brainstormFile string) string {
	return filepath.Join(filepath.Dir(brainstormFile), judgeFileName)
}

// JudgedLine is the one line that hands judge.json at path to the brainstorming agent.
func JudgedLine(path string) string {
	return judgedLineHead + path
}

// JudgeFailedLine is the one line that tells the brainstorming agent its judge failed, and why.
func JudgeFailedLine(reason string) string {
	return judgeFailedHead + reason
}
