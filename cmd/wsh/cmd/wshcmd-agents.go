// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"context"
	"fmt"
	"os"
	"slices"
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
	agentsWaitAgentPoll  = 5 * time.Second
	agentsWaitDefault    = 10 * time.Minute
	agentsNoRun          = "-"
	agentsAllProjectsTip = "wsh agents list --all shows every project"
	// a send to a sleeping agent waits for its wake: the server gives it 60 s to report in
	agentsSendTimeoutMs = 70_000
	agentsSelfMark      = "(you)"
	// after the folder name of a session in no project wsh knows
	agentsNoProjectMark = "(no project)"
	agentsTitleMax      = 60
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

var agentsWaitCmd = &cobra.Command{
	Use:   "wait <tab>",
	Short: "wait until a live agent stops working",
	Long: `Wait until a live agent stops working: its turn ends, it asks the user something, it goes to sleep,
or its tab closes. <tab> is a tab id or a unique prefix of one, as 'wsh agents list' prints it. A target
that is not working ends the wait at once.

Run it as a background command to carry on when another agent is done: you are told when it ends,
and the cockpit nests your row under the agent you wait on.`,
	Args:    cobra.ExactArgs(1),
	PreRunE: preRunSetupRpcClient,
	RunE:    agentsWaitRun,
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
	agentsWaitCmd.Flags().Duration("timeout", 0, "give up after this long (0 waits as long as it takes)")
	agentsCmd.AddCommand(agentsListCmd, agentsSendCmd, agentsReadCmd, agentsWaitCmd)
	rootCmd.AddCommand(agentsCmd)
}

func agentsListRun(cmd *cobra.Command, args []string) error {
	rtn, err := wshclient.AgentsListCommand(RpcClient, &wshrpc.RpcOpts{Timeout: runsReadTimeoutMs})
	if err != nil {
		return err
	}
	all, _ := cmd.Flags().GetBool("all")
	projectPath, projects, err := agentsCallerProject()
	if err != nil && !all {
		return err
	}
	if all {
		projectPath = ""
	}
	rows, hidden := agentsInProject(rtn.Agents, projectPath, projects)
	if isJSON(cmd) {
		return jsonOut(rows)
	}
	for _, line := range agentsListLines(rows, projectPath != "", getTabIdFromEnv(), hidden, projects) {
		fmt.Println(line)
	}
	return nil
}

// agentsCallerProject is the path of the project holding the current directory ("" when none does) and the path of
// every project wsh knows (registered, or a channel's)
func agentsCallerProject() (string, []string, error) {
	chans, err := runsChannels()
	if err != nil {
		return "", nil, err
	}
	here, err := runsMainCheckoutPath(context.Background(), ".")
	if err != nil {
		return "", nil, fmt.Errorf("resolving this project (pass --all to skip it): %w", err)
	}
	cfg, err := wshclient.GetFullConfigCommand(RpcClient, &wshrpc.RpcOpts{Timeout: runsReadTimeoutMs})
	if err != nil {
		return "", nil, fmt.Errorf("reading the registered projects (pass --all to skip it): %w", err)
	}
	known := runsProjects(chans, cfg.Projects)
	paths := make([]string, len(known))
	for i, p := range known {
		paths[i] = p.path
	}
	if p := runsResolveProject(known, here); p != nil {
		return p.path, paths, nil
	}
	return "", paths, nil
}

// agentsOutside says a row's session works in no project wsh knows (projects): no project's list would show it. nil
// projects (--all, when they could not be read) are unknown, and say no.
func agentsOutside(row wshrpc.AgentInfo, projects []string) bool {
	return projects != nil && !slices.ContainsFunc(projects, func(p string) bool { return runsPathWithin(row.ProjectPath, p) })
}

// agentsInProject keeps the rows inside projectPath, and those of sessions in no project (agentsOutside), which no
// project's list would show otherwise: a person's agent opened in a scratch folder was never found by an agent asking
// from its own project. An empty path keeps them all. hidden counts the rows left out, in other projects. Never nil,
// so --json prints [] for no rows.
func agentsInProject(rows []wshrpc.AgentInfo, projectPath string, projects []string) (kept []wshrpc.AgentInfo, hidden int) {
	kept = []wshrpc.AgentInfo{}
	for _, row := range rows {
		if projectPath == "" || runsPathWithin(row.ProjectPath, projectPath) || agentsOutside(row, projects) {
			kept = append(kept, row)
		} else {
			hidden++
		}
	}
	return kept, hidden
}

// agentsListLines prints a row per agent. Two sessions in one project read alike by name, and a worktree's
// session files under its main checkout's project, so a row also shows where the session works when that is
// not the checkout, its task title, and which row is the caller's own. A session in no project (agentsOutside)
// says so after its folder's name, and a filtered list that left agents out ends with how many and how to see them.
func agentsListLines(rows []wshrpc.AgentInfo, filtered bool, selfTab string, hidden int, projects []string) []string {
	more := ""
	if filtered && hidden > 0 {
		more = fmt.Sprintf("%d more in other projects; %s", hidden, agentsAllProjectsTip)
	}
	if len(rows) == 0 {
		if filtered {
			if more != "" {
				return []string{"no live agents in this project; " + more}
			}
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
		about := agentsTitle(r.Title)
		if r.TabId == selfTab {
			about = strings.TrimSpace(agentsSelfMark + " " + about)
		}
		project := r.Project
		if agentsOutside(r, projects) {
			project = strings.TrimSpace(project + " " + agentsNoProjectMark)
		}
		fmt.Fprintln(w, strings.Join([]string{agentsShort(r.TabId), r.Name, project, run, r.Harness, r.State, agentsWhere(r), about}, "\t"))
	}
	w.Flush()
	lines := strings.Split(strings.TrimRight(buf.String(), "\n"), "\n")
	if more != "" {
		lines = append(lines, more)
	}
	return lines
}

// agentsWhere is the session's directory when it is not its project's checkout, relative to the checkout when
// inside it (a .claude/worktrees tree), "-" otherwise
func agentsWhere(r wshrpc.AgentInfo) string {
	if r.Cwd == "" || runsNormPath(r.Cwd) == runsNormPath(r.ProjectPath) {
		return agentsNoRun
	}
	if runsPathWithin(r.Cwd, r.ProjectPath) {
		return runsNormPath(r.Cwd)[len(runsNormPath(r.ProjectPath))+1:]
	}
	return r.Cwd
}

// agentsTitle is a title on one line, cut to fit a terminal row
func agentsTitle(title string) string {
	t := []rune(strings.Join(strings.Fields(title), " "))
	if len(t) > agentsTitleMax {
		return string(t[:agentsTitleMax-1]) + "…"
	}
	return string(t)
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

func agentsWaitRun(cmd *cobra.Command, args []string) error {
	timeout, _ := cmd.Flags().GetDuration("timeout")
	list := func() ([]wshrpc.AgentInfo, error) {
		rtn, err := wshclient.AgentsListCommand(RpcClient, &wshrpc.RpcOpts{Timeout: runsReadTimeoutMs})
		if err != nil {
			return nil, err
		}
		return rtn.Agents, nil
	}
	line, err := agentsWaitFor(list, time.Sleep, time.Now, args[0], timeout)
	if err != nil {
		return err
	}
	fmt.Println(line)
	return nil
}

// agentsWaitFor polls list until the agent tab names (a tab id or a unique prefix of one) is no longer working or
// is gone, and returns the line saying how it ended. A timeout of 0 never gives up. list, sleep and now are parameters
// so a test scripts them.
func agentsWaitFor(list func() ([]wshrpc.AgentInfo, error), sleep func(time.Duration), now func() time.Time,
	tab string, timeout time.Duration) (string, error) {
	rows, err := list()
	if err != nil {
		return "", err
	}
	target, err := agentsResolveTab(rows, tab)
	if err != nil {
		return "", err
	}
	who := fmt.Sprintf("%s (%s)", agentsShort(target.TabId), target.Name)
	deadline := now().Add(timeout)
	for {
		var row *wshrpc.AgentInfo
		for i := range rows {
			if rows[i].TabId == target.TabId {
				row = &rows[i]
			}
		}
		switch {
		case row == nil:
			return who + " closed", nil
		case row.State == wshrpc.AgentsState_Asking:
			return who + " is waiting on the user: it has a question open", nil
		case row.State == wshrpc.AgentsState_Sleeping:
			return who + " is asleep", nil
		case row.State != wshrpc.AgentsState_Working:
			return fmt.Sprintf("%s stopped working: it is %s", who, row.State), nil
		}
		if timeout > 0 && !now().Before(deadline) {
			return "", fmt.Errorf("%s is still working after %s", who, timeout)
		}
		sleep(agentsWaitAgentPoll)
		if rows, err = list(); err != nil {
			return "", err
		}
	}
}

// agentsResolveTab finds the row tab names by its id or a unique prefix of one, as the server resolves a send
func agentsResolveTab(rows []wshrpc.AgentInfo, tab string) (*wshrpc.AgentInfo, error) {
	tab = strings.TrimSpace(tab)
	var matches []*wshrpc.AgentInfo
	for i := range rows {
		if rows[i].TabId == tab {
			return &rows[i], nil
		}
		if tab != "" && strings.HasPrefix(rows[i].TabId, tab) {
			matches = append(matches, &rows[i])
		}
	}
	switch len(matches) {
	case 0:
		return nil, fmt.Errorf("tab %q is not a live agent session; wsh agents list --all shows the live agents", tab)
	case 1:
		return matches[0], nil
	}
	names := make([]string, len(matches))
	for i, m := range matches {
		names[i] = fmt.Sprintf("%s (%s)", m.TabId, m.Name)
	}
	return nil, fmt.Errorf("tab %q matches several live agents: %s; use more of the id", tab, strings.Join(names, ", "))
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
