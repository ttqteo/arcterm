// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package bench

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// usageGapPercent is how far the transcripts' token count may sit from the result's modelUsage before it is logged.
const usageGapPercent = 5.0

// keyReadRe is how a tool use is seen to have read the answer keys: its input names the council-bench folder, where they
// live (Phase 0b's run.sh matched the same). It runs over the input's JSON text, where a backslash is written twice.
var keyReadRe = regexp.MustCompile(`council-bench(?:/|\\\\)`)

// transcriptStats is what the lead's transcript and every teammate's hold.
type transcriptStats struct {
	Tokens    int64 // input + cache read + cache creation + output (pkg/consult's count), each assistant message once
	Messages  int   // SendMessage tool uses, each tool-use id once
	KeyReads  int   // tool uses other than Agent, Task and SendMessage whose input names the council-bench folder
	Teammates int   // teammate transcripts read
}

// claudeProjectsDir is where Claude Code keeps its transcripts: <config dir>/projects, the config dir being
// CLAUDE_CONFIG_DIR or ~/.claude.
func claudeProjectsDir() (string, error) {
	if dir := os.Getenv("CLAUDE_CONFIG_DIR"); dir != "" {
		return filepath.Join(dir, "projects"), nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("no home folder to find Claude's transcripts in: %w", err)
	}
	return filepath.Join(home, ".claude", "projects"), nil
}

// leadTranscript finds the lead's transcript, <projects>/<project folder>/<session>.jsonl, whichever project folder
// Claude put the session in.
func leadTranscript(session string) (string, error) {
	dir, err := claudeProjectsDir()
	if err != nil {
		return "", err
	}
	found, err := filepath.Glob(filepath.Join(dir, "*", session+".jsonl"))
	if err != nil {
		return "", err
	}
	if len(found) == 0 {
		return "", fmt.Errorf("no transcript of session %s under %s", session, dir)
	}
	return found[0], nil
}

// transcriptLine is the part of a transcript line this file reads. The message stays raw until the line is known to be an
// assistant's: a user line's content can be a megabyte of tool output.
type transcriptLine struct {
	Type    string          `json:"type"`
	UUID    string          `json:"uuid"`
	Message json.RawMessage `json:"message"`
}

type assistantMessage struct {
	ID      string `json:"id"`
	Content []struct {
		Type  string          `json:"type"`
		ID    string          `json:"id"`
		Name  string          `json:"name"`
		Input json.RawMessage `json:"input"`
	} `json:"content"`
	Usage struct {
		Input         int64 `json:"input_tokens"`
		CacheRead     int64 `json:"cache_read_input_tokens"`
		CacheCreation int64 `json:"cache_creation_input_tokens"`
		Output        int64 `json:"output_tokens"`
	} `json:"usage"`
}

// readTranscripts counts the lead's transcript and every teammate's (<lead minus .jsonl>/subagents/**/*.jsonl). A message
// is one message however many lines it spans (its usage repeats on each, so the largest of each field is the message's)
// and a tool-use id is one use, in a file or across them.
func readTranscripts(lead string) (transcriptStats, error) {
	files := []string{lead}
	err := filepath.WalkDir(filepath.Join(strings.TrimSuffix(lead, ".jsonl"), "subagents"), func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			if errors.Is(err, fs.ErrNotExist) {
				return nil // a lead that spawned nobody has no folder
			}
			return err
		}
		if !d.IsDir() && strings.HasSuffix(d.Name(), ".jsonl") {
			files = append(files, path)
		}
		return nil
	})
	if err != nil {
		return transcriptStats{}, fmt.Errorf("listing the teammates' transcripts: %w", err)
	}

	type usage struct{ in, cacheRead, cacheCreation, out int64 }
	messages := map[string]*usage{}
	seenUse := map[string]bool{}
	var st transcriptStats
	for n, path := range files {
		skipped, err := readTranscript(path, func(line int, ln transcriptLine, m assistantMessage) {
			id := m.ID
			if id == "" {
				id = ln.UUID
			}
			if id == "" {
				id = fmt.Sprintf("%s:%d", path, line) // nothing names the message: each line is its own
			}
			u := messages[id]
			if u == nil {
				u = &usage{}
				messages[id] = u
			}
			u.in = max(u.in, m.Usage.Input)
			u.cacheRead = max(u.cacheRead, m.Usage.CacheRead)
			u.cacheCreation = max(u.cacheCreation, m.Usage.CacheCreation)
			u.out = max(u.out, m.Usage.Output)

			for _, b := range m.Content {
				if b.Type != "tool_use" || (b.ID != "" && seenUse[b.ID]) {
					continue
				}
				if b.ID != "" {
					seenUse[b.ID] = true
				}
				switch b.Name {
				case "SendMessage":
					st.Messages++
				case "Agent", "Task":
				default:
					if keyReadRe.Match(b.Input) {
						st.KeyReads++
					}
				}
			}
		})
		if err != nil {
			return transcriptStats{}, err
		}
		if skipped > 0 {
			log.Printf("[council-bench] transcript %s: %d unreadable lines skipped (a killed session leaves a cut last line)", path, skipped)
		}
		if n > 0 {
			st.Teammates++
		}
	}
	for _, u := range messages {
		st.Tokens += u.in + u.cacheRead + u.cacheCreation + u.out
	}
	return st, nil
}

// readTranscript calls each on the assistant lines of one transcript and returns how many lines it could not read.
func readTranscript(path string, each func(line int, ln transcriptLine, m assistantMessage)) (skipped int, err error) {
	f, err := os.Open(path)
	if err != nil {
		return 0, err
	}
	defer f.Close()
	r := bufio.NewReaderSize(f, 1<<20) // a line can hold a whole tool result, past any scanner's token cap
	for line := 1; ; line++ {
		raw, rerr := r.ReadBytes('\n')
		if len(bytes.TrimSpace(raw)) > 0 {
			var ln transcriptLine
			if json.Unmarshal(raw, &ln) != nil {
				skipped++
			} else if ln.Type == "assistant" {
				var m assistantMessage
				if json.Unmarshal(ln.Message, &m) != nil {
					skipped++
				} else {
					each(line, ln, m)
				}
			}
		}
		if rerr != nil {
			if rerr == io.EOF {
				return skipped, nil
			}
			return skipped, fmt.Errorf("reading %s: %w", path, rerr)
		}
	}
}

// checkModelUsage compares the transcripts' count with the result's modelUsage, summed over every model (the session's
// cumulative count, teammates included), and logs both figures when they sit more than 5% apart. The row keeps the
// transcripts' count either way. A modelUsage of 0 is none to compare with.
func checkModelUsage(caseId string, transcripts, modelUsage int64) {
	if modelUsage <= 0 {
		return
	}
	if gap := math.Abs(float64(transcripts-modelUsage)) * 100 / float64(modelUsage); gap > usageGapPercent {
		log.Printf("[council-bench] case %s team: the transcripts hold %d tokens, the result's modelUsage %d (%.1f%% apart); the row keeps %d", caseId, transcripts, modelUsage, gap, transcripts)
	}
}
