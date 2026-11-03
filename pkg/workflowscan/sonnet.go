// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package workflowscan

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
)

const replyQuoteChars = 200

const sonnetInstructions = `You are reading the run records of an agent cockpit, Arc. Each block below is one run: a header
"### run <id> · <date> · <project> · <goal>", then one line per thing that went wrong or was corrected in that run,
each tagged with where it came from (a plan review, a task review, a question a worker asked, what the human told a
worker, a failed check, a held merge, the final verification).

Find workflow problems that recur: the same kind of mistake or friction seen in 3 or more distinct runs. Name only
patterns seen in 3 or more distinct runs. A pattern is something a small change to a prompt, a contract or a config
file could prevent, not a one-off bug in the code a run was building.

For each pattern give:
- title: one line naming the problem.
- fixtarget: the file whose text causes it and the part of it to change, as "<file> · <symbol or section>".
- citations: one per run you count, each with "run", the 8-character id from that run's block header, and "quote",
  a verbatim quote copied from that run's own lines (at least 30 characters, not paraphrased, not from another
  run). Code checks every quote against the cited run and drops the ones it cannot find.

Answer with one fenced json block and nothing after it:

` + "```json" + `
{"patterns":[{"title":"...","fixtarget":"<file> · <symbol or section>","citations":[{"run":"abcd1234","quote":"..."}]}]}
` + "```" + `

With no pattern in 3 or more distinct runs, answer {"patterns":[]}.

The run records:

`

// SonnetPrompt is the one prompt the Sonnet pass gets: the instructions, the output schema and the whole corpus.
func SonnetPrompt(c Corpus) string {
	return sonnetInstructions + c.Text + "\n"
}

var fencedJsonRe = regexp.MustCompile("(?is)```json\\s*\\n(.*?)```")

// ParseSonnetReply reads the patterns from the reply's last fenced json block, else from its outermost braces.
func ParseSonnetReply(reply string) ([]Candidate, error) {
	body := ""
	if m := fencedJsonRe.FindAllStringSubmatch(reply, -1); len(m) > 0 {
		body = m[len(m)-1][1]
	} else if start, end := strings.Index(reply, "{"), strings.LastIndex(reply, "}"); start >= 0 && end > start {
		body = reply[start : end+1]
	}
	if strings.TrimSpace(body) == "" {
		return nil, fmt.Errorf("no json block in the pattern reply: %q", head(reply))
	}
	var out struct {
		Patterns []Candidate `json:"patterns"`
	}
	if err := json.Unmarshal([]byte(body), &out); err != nil {
		return nil, fmt.Errorf("bad json in the pattern reply (%v): %q", err, head(reply))
	}
	return out.Patterns, nil
}

func head(s string) string {
	r := []rune(s)
	return string(r[:min(len(r), replyQuoteChars)])
}
