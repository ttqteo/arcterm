// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"errors"
	"fmt"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/agentsessions"
	"github.com/wavetermdev/waveterm/pkg/council"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

// The kinds `wsh read` takes, as the cockpit's addresses write them (frontend/app/view/jarvis/address.ts).
const (
	readKindAgent   = "agent"
	readKindRun     = "run"
	readKindCouncil = "council"
	readKindSession = "session"
	readKindEffort  = "effort"
)

const (
	readDefaultTurns = 6
	// a bare id shorter than this matches too much to mean one thing; a kind:id may be as short as readMinKindLen
	readMinBareLen = 6
	readMinKindLen = 4
	// past conversations are scanned a page at a time, newest first, up to this many
	readSessionPage = 200
	readSessionMax  = 2000
)

// the kinds in the order a bare id is looked up in, and the one a match list is sorted by; sessions last, as the
// costliest scan and the one a live agent's id never names
var readKinds = []string{readKindAgent, readKindRun, readKindCouncil, readKindEffort, readKindSession}

var readCmd = &cobra.Command{
	Use:   "read <id>",
	Short: "print what an arcterm id holds: a live agent's last turns, a run, a council and its discussion, a past conversation or an initiative",
	Long: `Look an id up and print what it holds, to read before acting on it. The id is a full id or a unique prefix of one
(the 8 characters 'wsh agents list' and 'wsh runs list' print), bare or with its kind as the cockpit writes it:
agent:<tab> (or tab:), run:<id>, council:<id>, session:<id>, effort:<id>. A bare id is looked up in every kind; one
that matches several things lists them, and kind:id picks one.

  agent    the live agent's last --turns prompts and answers, its last answer in full
  run      the run's status, route, commits, task digest and report ('wsh runs show')
  council  the council's report, matrix and whole discussion, follow-up questions included
  session  a past conversation's last --turns prompts and answers
  effort   the initiative's chunks, statuses and notes ('wsh effort show')

Reading sends nothing to the agent or the council: it only prints.`,
	Args:    cobra.ExactArgs(1),
	PreRunE: preRunSetupRpcClient,
	RunE:    readRun,
}

func init() {
	readCmd.Flags().Int("turns", readDefaultTurns, "how many prompts and answers of an agent or a past conversation to print")
	rootCmd.AddCommand(readCmd)
}

// parseReadRef splits what `wsh read` was given into its kind ("" for a bare id) and id. A leading @ is dropped, so a
// mention pasted whole reads as its id; tab: is agent:, as in the cockpit's addresses.
func parseReadRef(arg string) (kind, id string, err error) {
	ref := strings.TrimPrefix(strings.TrimSpace(arg), "@")
	if i := strings.Index(ref, ":"); i > 0 {
		k := strings.ToLower(ref[:i])
		if k == "tab" {
			k = readKindAgent
		}
		for _, known := range readKinds {
			if k == known {
				kind, ref = k, ref[i+1:]
			}
		}
		if kind == "" {
			return "", "", fmt.Errorf("%q is not a kind wsh read knows: use %s", ref[:i], strings.Join(readKinds, ", "))
		}
	}
	id = strings.ToLower(strings.TrimSpace(ref))
	switch {
	case id == "":
		return "", "", errors.New("wsh read needs an id")
	case kind == "" && len(id) < readMinBareLen:
		return "", "", fmt.Errorf("%q is too short to name one thing: give at least %d characters, or kind:id", id, readMinBareLen)
	case len(id) < readMinKindLen:
		return "", "", fmt.Errorf("%q is too short to name one thing: give at least %d characters", id, readMinKindLen)
	}
	return kind, id, nil
}

// readHit is one thing an id names: its kind and full id, a line that tells it apart in a match list, and what the
// lookup already fetched for printing it.
type readHit struct {
	Kind  string
	Id    string
	Label string
	data  any
}

// pickReadHits is the hits id names: the ones whose id is id exactly, when there are any, else the ones it starts.
// Ids compare without case. In the order of readKinds, then by id, so a match list reads the same each time.
func pickReadHits(id string, cands []readHit) []readHit {
	id = strings.ToLower(id)
	var exact, prefix []readHit
	for _, h := range cands {
		hid := strings.ToLower(h.Id)
		switch {
		case hid == id:
			exact = append(exact, h)
		case strings.HasPrefix(hid, id):
			prefix = append(prefix, h)
		}
	}
	out := prefix
	if len(exact) > 0 {
		out = exact
	}
	rank := func(k string) int {
		for i, known := range readKinds {
			if k == known {
				return i
			}
		}
		return len(readKinds)
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Kind != out[j].Kind {
			return rank(out[i].Kind) < rank(out[j].Kind)
		}
		return out[i].Id < out[j].Id
	})
	return out
}

// readAmbiguous is the error for an id that names several things: each as kind:id and its label, the way to pick one.
func readAmbiguous(id string, hits []readHit) error {
	lines := make([]string, len(hits))
	for i, h := range hits {
		lines[i] = fmt.Sprintf("  %s:%s  %s", h.Kind, h.Id, h.Label)
	}
	return fmt.Errorf("%q names %d things; read one by its kind:id:\n%s", id, len(hits), strings.Join(lines, "\n"))
}

func readRun(cmd *cobra.Command, args []string) error {
	kind, id, err := parseReadRef(args[0])
	if err != nil {
		return err
	}
	turns, _ := cmd.Flags().GetInt("turns")
	kinds := readKinds
	if kind != "" {
		kinds = []string{kind}
	}
	var hits []readHit
	for _, k := range kinds {
		// a past conversation is scanned only when nothing cheaper matched, or when it was asked for by name
		if k == readKindSession && kind == "" && len(hits) > 0 {
			break
		}
		cands, err := readCandidates(cmd, k, id)
		if err != nil {
			if kind != "" {
				return err
			}
			fmt.Fprintf(os.Stderr, "wsh read: %s lookup skipped: %v\n", k, err)
			continue
		}
		hits = append(hits, pickReadHits(id, cands)...)
	}
	hits = pickReadHits(id, hits)
	switch len(hits) {
	case 0:
		what := "a live agent, a run, a council, an initiative or a past conversation"
		if kind != "" {
			what = "a " + kind
		}
		return fmt.Errorf("%q is not %s ('wsh agents list --all', 'wsh runs list', 'wsh council list --project \"\"' list the ids)", id, what)
	case 1:
	default:
		return readAmbiguous(id, hits)
	}
	text, err := readText(cmd, hits[0], turns)
	if err != nil {
		return err
	}
	fmt.Print(strings.TrimRight(text, "\n") + "\n")
	return nil
}

// readCandidates lists the things of one kind an id could name; the ones id does not start are dropped here for the
// kinds whose list is long.
func readCandidates(cmd *cobra.Command, kind, id string) ([]readHit, error) {
	switch kind {
	case readKindAgent:
		rtn, err := wshclient.AgentsListCommand(RpcClient, &wshrpc.RpcOpts{Timeout: runsReadTimeoutMs})
		if err != nil {
			return nil, err
		}
		out := make([]readHit, 0, len(rtn.Agents))
		for _, a := range rtn.Agents {
			out = append(out, readHit{Kind: readKindAgent, Id: a.TabId, Label: readAgentLabel(a), data: a})
		}
		return out, nil
	case readKindRun:
		chans, err := runsChannels()
		if err != nil {
			return nil, err
		}
		var out []readHit
		for _, ch := range chans {
			rows, err := runsOf(ch)
			if err != nil {
				return nil, err
			}
			for _, row := range rows {
				out = append(out, readHit{Kind: readKindRun, Id: row.Run.ID,
					Label: fmt.Sprintf("%s · %s · %s", ch.Name, row.Run.Status, runsClip(row.Run.Goal, 60)),
					data:  readRunData{ch: ch, run: row.Run, rows: rows}})
			}
		}
		return out, nil
	case readKindCouncil:
		list, err := wshclient.CouncilListCommand(RpcClient, wshrpc.CommandCouncilListData{}, &wshrpc.RpcOpts{Timeout: runsReadTimeoutMs})
		if err != nil {
			return nil, err
		}
		out := make([]readHit, 0, len(list))
		for _, c := range list {
			out = append(out, readHit{Kind: readKindCouncil, Id: c.Id, Label: fmt.Sprintf("%s · %s", c.State, c.Feature)})
		}
		return out, nil
	case readKindEffort:
		rtn, err := wshclient.EffortListCommand(RpcClient, wshrpc.CommandEffortListData{IncludeArchived: true}, nil)
		if err != nil {
			return nil, err
		}
		out := make([]readHit, 0, len(rtn.Efforts))
		for _, e := range rtn.Efforts {
			oid := strings.TrimPrefix(e.ORef, "effort:")
			out = append(out, readHit{Kind: readKindEffort, Id: oid, Label: fmt.Sprintf("%s · %d/%d · %s", e.Status, e.Done, e.Total, e.Title)})
		}
		return out, nil
	case readKindSession:
		return readSessionCandidates(id)
	}
	return nil, fmt.Errorf("unknown kind %q", kind)
}

// readSessionCandidates pages through the past conversations, newest first, for the ones id starts, and stops at the
// first page that holds one: a prefix long enough to read by is not shared across far-apart pages.
func readSessionCandidates(id string) ([]readHit, error) {
	var out []readHit
	cursor := ""
	for seen := 0; seen < readSessionMax; seen += readSessionPage {
		rtn, err := wshclient.GetSessionsActivityCommand(RpcClient, wshrpc.CommandGetSessionsActivityData{Limit: readSessionPage, Cursor: cursor},
			&wshrpc.RpcOpts{Timeout: runsReadTimeoutMs})
		if err != nil {
			return nil, err
		}
		for _, s := range rtn.Sessions {
			if strings.HasPrefix(strings.ToLower(s.ID), id) {
				out = append(out, readHit{Kind: readKindSession, Id: s.ID,
					Label: fmt.Sprintf("%s · %s · %s", s.ProjectName, s.Runtime, runsClip(s.Task, 60)), data: s})
			}
		}
		if len(out) > 0 || rtn.NextCursor == "" {
			return out, nil
		}
		cursor = rtn.NextCursor
	}
	return out, nil
}

type readRunData struct {
	ch   *waveobj.Channel
	run  *waveobj.Run
	rows []runsRow
}

func readAgentLabel(a wshrpc.AgentInfo) string {
	parts := []string{a.Project, a.Harness, a.State}
	if a.Title != "" {
		parts = append(parts, runsClip(a.Title, 60))
	} else if a.Name != "" {
		parts = append(parts, a.Name)
	}
	return strings.Join(parts, " · ")
}

// readText fetches what one hit holds and writes it as markdown.
func readText(cmd *cobra.Command, h readHit, turns int) (string, error) {
	switch h.Kind {
	case readKindAgent:
		a, _ := h.data.(wshrpc.AgentInfo)
		r, err := wshclient.AgentsReadCommand(RpcClient, wshrpc.CommandAgentsReadData{Tab: h.Id}, &wshrpc.RpcOpts{Timeout: runsReadTimeoutMs})
		if err != nil {
			return "", err
		}
		head := fmt.Sprintf("# Agent %s · %s\n\n", agentsShort(h.Id), readAgentLabel(a))
		return head + readTurnsText(r.Harness, r.TranscriptPath, r.Answer, turns), nil
	case readKindSession:
		s, _ := h.data.(wshrpc.SessionActivity)
		head := fmt.Sprintf("# Past conversation %s · %s · %s\n\n", h.Id, s.ProjectName, s.Runtime)
		if s.Task != "" {
			head += "Task: " + s.Task + "\n\n"
		}
		answer := ""
		if s.TranscriptPath != "" {
			answer, _ = agentsessions.LastAnswer(s.TranscriptPath, s.Runtime)
		}
		return head + readTurnsText(s.Runtime, s.TranscriptPath, answer, turns), nil
	case readKindRun:
		d, _ := h.data.(readRunData)
		runs := make([]*waveobj.Run, len(d.rows))
		for i, row := range d.rows {
			runs[i] = row.Run
		}
		lines := runsShowLines(d.ch, d.run, runsDigest(d.ch.OID, d.run), time.Now().UnixMilli(), runsAsks(d.ch.OID, d.run), runs)
		return strings.Join(lines, "\n") + "\n", nil
	case readKindCouncil:
		c, err := wshclient.CouncilGetCommand(RpcClient, wshrpc.CommandCouncilIdData{Id: h.Id}, nil)
		if err != nil {
			return "", err
		}
		return council.Document(c), nil
	case readKindEffort:
		data := wshrpc.CommandEffortGetData{EffortOID: h.Id}
		if RpcContext.BlockId != "" {
			data.SourceBlock = "block:" + RpcContext.BlockId
		}
		rtn, err := wshclient.EffortGetCommand(RpcClient, data, nil)
		if err != nil {
			return "", err
		}
		return formatEffortShow(rtn.Effort), nil
	}
	return "", fmt.Errorf("unknown kind %q", h.Kind)
}

// readTurnsText is a session's last turns as markdown: for a Claude transcript, its last `turns` prompts and answers
// (each clipped by the tail read), the last answer then in full; for any other harness, or a transcript that cannot be
// read, the last answer alone.
func readTurnsText(harness, path, answer string, turns int) string {
	var msgs []agentsessions.PeekMessage
	if harness == "claude" && path != "" {
		msgs, _, _ = agentsessions.ClaudeTailMessages(path, max(turns, 1)*2)
	}
	return formatReadTurns(msgs, answer)
}

// formatReadTurns writes msgs (oldest first) under You / Agent headings; when the last of them is an answer and the full
// answer is known, the full one stands in for its clipped copy. With no messages it is the answer alone, or a line
// saying there is none yet.
func formatReadTurns(msgs []agentsessions.PeekMessage, answer string) string {
	answer = strings.TrimSpace(answer)
	if len(msgs) == 0 {
		if answer == "" {
			return "_No answer yet._\n"
		}
		return "## Last answer\n\n" + answer + "\n"
	}
	var b strings.Builder
	for i, m := range msgs {
		who, text := "You", strings.TrimSpace(m.Text)
		if m.Role == "assistant" {
			who = "Agent"
			if i == len(msgs)-1 && answer != "" {
				text = answer
			}
		}
		fmt.Fprintf(&b, "## %s\n\n%s\n\n", who, text)
	}
	return b.String()
}
