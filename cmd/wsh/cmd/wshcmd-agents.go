// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"fmt"
	"os"
	"strings"
	"text/tabwriter"
	"time"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

const (
	agentsShortIdLen     = 8
	agentsWaitPoll       = 2 * time.Second
	agentsWaitDefault    = 10 * time.Minute
	agentsNoRun          = "-"
	agentsAllProjectsTip = "wsh agents list --all shows every project"
	// a send to a sleeping agent waits for its wake: the server gives it 60 s to report in
	agentsSendTimeoutMs = 70_000
)

var agentsCmd = &cobra.Command{
	Use:   "agents",
	Short: "find a live agent tab, hand it a prompt, and read its last answer",
	Args:  cobra.NoArgs,
	RunE:  func(cmd *cobra.Command, args []string) error { return cmd.Help() },
}

var agentsListCmd = &cobra.Command{
	Use:     "list",
	Short:   "list this project's live claude and pi agent tabs",
	Args:    cobra.NoArgs,
	PreRunE: preRunSetupRpcClient,
	RunE:    agentsListRun,
}

var agentsSendCmd = &cobra.Command{
	Use:   "send <tab> [text]",
	Short: "hand a prompt to a live agent's session; it joins the turn the agent is running, if any",
	Long: `Hand a prompt to a live agent's session, so follow-up work goes to the session that already holds
the context instead of a new run. <tab> is a tab id or a unique prefix of one, as 'wsh agents list'
prints it. The text is the argument or the contents of --file, never both.

The message arrives marked as sent by this agent, not typed by the user. The target cannot send one
back in the same turn: read its reply with 'wsh agents read <tab>', or pass --wait to have this
command wait for it.

A sleeping agent (state 'sleeping' in 'wsh agents list') is woken first, which can take up to a
minute, and gets the message once it has reported in.`,
	Args:    cobra.RangeArgs(1, 2),
	PreRunE: preRunSetupRpcClient,
	RunE:    agentsSendRun,
}

var agentsReadCmd = &cobra.Command{
	Use:     "read <tab>",
	Short:   "print a live agent's last answer",
	Args:    cobra.ExactArgs(1),
	PreRunE: preRunSetupRpcClient,
	RunE:    agentsReadRun,
}

func init() {
	agentsListCmd.Flags().Bool("all", false, "every project, not just this one")
	agentsListCmd.Flags().Bool("json", false, "JSON output")
	agentsSendCmd.Flags().String("file", "", "read the text from this file instead of the argument")
	agentsSendCmd.Flags().Bool("wait", false, "wait for the target's answer and print it")
	agentsSendCmd.Flags().Duration("timeout", agentsWaitDefault, "how long --wait waits")
	agentsReadCmd.Flags().Bool("json", false, "JSON output")
	agentsCmd.AddCommand(agentsListCmd, agentsSendCmd, agentsReadCmd)
	rootCmd.AddCommand(agentsCmd)
}

func agentsListRun(cmd *cobra.Command, args []string) error {
	rtn, err := wshclient.AgentsListCommand(RpcClient, &wshrpc.RpcOpts{Timeout: runsReadTimeoutMs})
	if err != nil {
		return err
	}
	all, _ := cmd.Flags().GetBool("all")
	projectPath := ""
	if !all {
		if projectPath, err = agentsCallerProject(); err != nil {
			return err
		}
	}
	rows := agentsInProject(rtn.Agents, projectPath)
	if isJSON(cmd) {
		return jsonOut(rows)
	}
	for _, line := range agentsListLines(rows, projectPath != "") {
		fmt.Println(line)
	}
	return nil
}

// agentsCallerProject is the path of the project holding the current directory, "" when none does
func agentsCallerProject() (string, error) {
	chans, err := runsChannels()
	if err != nil {
		return "", err
	}
	p, _, err := runsProjectAt(chans, "")
	if err != nil {
		return "", fmt.Errorf("resolving this project (pass --all to skip it): %w", err)
	}
	if p == nil {
		return "", nil
	}
	return p.path, nil
}

// agentsInProject keeps the rows inside projectPath; an empty path keeps them all. Never nil, so --json
// prints [] for no rows.
func agentsInProject(rows []wshrpc.AgentInfo, projectPath string) []wshrpc.AgentInfo {
	kept := []wshrpc.AgentInfo{}
	for _, row := range rows {
		if projectPath == "" || runsPathWithin(row.ProjectPath, projectPath) {
			kept = append(kept, row)
		}
	}
	return kept
}

func agentsListLines(rows []wshrpc.AgentInfo, filtered bool) []string {
	if len(rows) == 0 {
		if filtered {
			return []string{"no live agents in this project; " + agentsAllProjectsTip}
		}
		return []string{"no live agents"}
	}
	var buf strings.Builder
	w := tabwriter.NewWriter(&buf, 0, 4, 2, ' ', 0)
	for _, r := range rows {
		run := agentsNoRun
		if r.RunId != "" {
			run = agentsShort(r.RunId)
		}
		fmt.Fprintln(w, strings.Join([]string{agentsShort(r.TabId), r.Name, r.Project, run, r.Harness, r.State}, "\t"))
	}
	w.Flush()
	return strings.Split(strings.TrimRight(buf.String(), "\n"), "\n")
}

func agentsShort(id string) string {
	return id[:min(agentsShortIdLen, len(id))]
}

func agentsSendRun(cmd *cobra.Command, args []string) error {
	file, _ := cmd.Flags().GetString("file")
	text, err := agentsSendText(args[1:], file)
	if err != nil {
		return err
	}
	from, err := resolveBlockArg()
	if err != nil {
		return err
	}
	sent, err := wshclient.AgentsSendCommand(RpcClient, wshrpc.CommandAgentsSendData{Tab: args[0], Text: text, FromORef: from.String()},
		&wshrpc.RpcOpts{Timeout: agentsSendTimeoutMs})
	if err != nil {
		return err
	}
	for _, line := range agentsSendLines(sent) {
		fmt.Println(line)
	}
	if wait, _ := cmd.Flags().GetBool("wait"); !wait {
		return nil
	}
	timeout, _ := cmd.Flags().GetDuration("timeout")
	read := func() (*wshrpc.CommandAgentsReadRtnData, error) {
		return wshclient.AgentsReadCommand(RpcClient, wshrpc.CommandAgentsReadData{Tab: sent.TabId}, &wshrpc.RpcOpts{Timeout: runsReadTimeoutMs})
	}
	answer, err := agentsWait(read, time.Sleep, time.Now, sent, timeout)
	if err != nil {
		return err
	}
	for _, line := range agentsWaitLines(answer) {
		fmt.Println(line)
	}
	return nil
}

// agentsSendText is the message: the text argument or the file's contents, exactly one of them, not blank
func agentsSendText(textArgs []string, file string) (string, error) {
	if (len(textArgs) > 0) == (file != "") {
		return "", fmt.Errorf("pass the text as an argument or with --file, one of them")
	}
	text := ""
	if file != "" {
		b, err := os.ReadFile(file)
		if err != nil {
			return "", fmt.Errorf("reading --file: %w", err)
		}
		text = string(b)
	} else {
		text = textArgs[0]
	}
	if strings.TrimSpace(text) == "" {
		return "", fmt.Errorf("the message is empty")
	}
	return text, nil
}

func agentsSendLines(sent *wshrpc.CommandAgentsSendRtnData) []string {
	how := "it started a turn"
	if sent.MidTurn {
		how = "it joined the turn the agent is running"
	}
	id := agentsShort(sent.TabId)
	return []string{
		fmt.Sprintf("sent to %s: %s", id, how),
		"read the answer with: wsh agents read " + id,
	}
}

// agentsWait polls read until the target has answered the send: it is no longer working and its last
// answer is newer than the send. A target that ends up asking the user is returned as it stands, since
// only the user can move it on. read, sleep and now are parameters so a test scripts them.
func agentsWait(read func() (*wshrpc.CommandAgentsReadRtnData, error), sleep func(time.Duration), now func() time.Time,
	sent *wshrpc.CommandAgentsSendRtnData, timeout time.Duration) (*wshrpc.CommandAgentsReadRtnData, error) {
	deadline := now().Add(timeout)
	for {
		r, err := read()
		if err != nil {
			return nil, err
		}
		if r.State == wshrpc.AgentsState_Asking {
			return r, nil
		}
		if r.State != wshrpc.AgentsState_Working && r.AnswerTs > sent.SentTs {
			return r, nil
		}
		if !now().Before(deadline) {
			id := agentsShort(sent.TabId)
			return nil, fmt.Errorf("%s is still working after %s; run 'wsh agents read %s' later", id, timeout, id)
		}
		sleep(agentsWaitPoll)
	}
}

func agentsWaitLines(r *wshrpc.CommandAgentsReadRtnData) []string {
	if r.State == wshrpc.AgentsState_Asking {
		id := agentsShort(r.TabId)
		return []string{fmt.Sprintf("%s is waiting on the user: it has a question open. Once it is answered, run 'wsh agents read %s'", id, id)}
	}
	return agentsReadLines(r)
}

func agentsReadRun(cmd *cobra.Command, args []string) error {
	rtn, err := wshclient.AgentsReadCommand(RpcClient, wshrpc.CommandAgentsReadData{Tab: args[0]}, &wshrpc.RpcOpts{Timeout: runsReadTimeoutMs})
	if err != nil {
		return err
	}
	if isJSON(cmd) {
		return jsonOut(rtn)
	}
	for _, line := range agentsReadLines(rtn) {
		fmt.Println(line)
	}
	return nil
}

func agentsReadLines(r *wshrpc.CommandAgentsReadRtnData) []string {
	if r.Answer == "" {
		return []string{fmt.Sprintf("%s has not answered yet (state: %s)", agentsShort(r.TabId), r.State)}
	}
	return []string{r.Answer}
}
