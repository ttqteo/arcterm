// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

const (
	remoteRpcTimeoutMs = 20000

	remoteProviderCloudflare = "cloudflare"
	remoteProviderTailscale  = "tailscale"
	remoteTunnelPrompt       = "Tunnel token:"
	remoteCloudflaredFix     = "winget install --id Cloudflare.cloudflared"
	remoteTailscaleFix       = "install it from https://tailscale.com/download and log in"
	// a tunnel token is a short base64 blob; the cap only bounds a runaway stdin
	remoteTokenMaxBytes = 1024 * 1024
)

var remoteSetupProvider, remoteSetupTeam, remoteSetupAud, remoteSetupEmail, remoteSetupHostname string
var remoteSetupPort int

var remoteCmd = &cobra.Command{
	Use:   "remote",
	Short: "answer Arc from your phone: set up, turn on or off, and check remote mode",
}

var remoteSetupCmd = &cobra.Command{
	Use:   "setup --team <name> --aud <tag> --email <addr> --hostname <host> [--port N] | setup --provider tailscale [--port N]",
	Short: "store how the phone reaches Arc: a Cloudflare tunnel behind Access (its token read from stdin), or tailscale serve",
	Long: `Cloudflare (the default): a named tunnel behind Cloudflare Access; --team, --aud, --email and --hostname
are required and the tunnel token is read from stdin.

Tailscale (--provider tailscale): tailscale serve on this machine's tailnet address. The hostname and the one
tailnet login let in are read from tailscale status; --hostname and --email override them.`,
	Args:    cobra.NoArgs,
	RunE:    remoteSetupRun,
	PreRunE: preRunSetupRpcClient,
}

var remoteOnCmd = &cobra.Command{
	Use:     "on",
	Short:   "turn remote mode on",
	Args:    cobra.NoArgs,
	RunE:    remoteOnRun,
	PreRunE: preRunSetupRpcClient,
}

var remoteOffCmd = &cobra.Command{
	Use:     "off",
	Short:   "turn remote mode off",
	Args:    cobra.NoArgs,
	RunE:    remoteOffRun,
	PreRunE: preRunSetupRpcClient,
}

var remoteStatusCmd = &cobra.Command{
	Use:     "status",
	Short:   "print whether remote mode is on, its address, tunnel and phone",
	Args:    cobra.NoArgs,
	RunE:    remoteStatusRun,
	PreRunE: preRunSetupRpcClient,
}

var remoteHandCmd = &cobra.Command{
	Use:     "hand [tab]",
	Short:   "hand an agent to the phone; with no tab, the agent in this terminal",
	Args:    cobra.MaximumNArgs(1),
	RunE:    remoteHandRun,
	PreRunE: preRunSetupRpcClient,
}

var remoteTakeBackCmd = &cobra.Command{
	Use:     "take-back [tab]",
	Short:   "take an agent back from the phone; with no tab, the agent in this terminal",
	Args:    cobra.MaximumNArgs(1),
	RunE:    remoteTakeBackRun,
	PreRunE: preRunSetupRpcClient,
}

func init() {
	remoteSetupCmd.Flags().StringVar(&remoteSetupProvider, "provider", remoteProviderCloudflare, "cloudflare or tailscale")
	remoteSetupCmd.Flags().StringVar(&remoteSetupTeam, "team", "", "Cloudflare Access team name (the part before .cloudflareaccess.com)")
	remoteSetupCmd.Flags().StringVar(&remoteSetupAud, "aud", "", "the Access application's AUD tag")
	remoteSetupCmd.Flags().StringVar(&remoteSetupEmail, "email", "", "the one email address (tailscale: tailnet login) allowed in")
	remoteSetupCmd.Flags().StringVar(&remoteSetupHostname, "hostname", "", "the public host name, e.g. arc.example.com (tailscale: read from tailscale status)")
	remoteSetupCmd.Flags().IntVar(&remoteSetupPort, "port", 0, "local port for the phone listener (default: the built-in port)")
	remoteCmd.AddCommand(remoteSetupCmd, remoteOnCmd, remoteOffCmd, remoteStatusCmd, remoteHandCmd, remoteTakeBackCmd)
	rootCmd.AddCommand(remoteCmd)
}

func remoteSetupRun(cmd *cobra.Command, args []string) error {
	data, err := remoteSetupData(func() (string, error) { return readTunnelToken(os.Stdin, stdinIsTerminal()) })
	if err != nil {
		return err
	}
	st, err := wshclient.RemoteSetupCommand(RpcClient, data, &wshrpc.RpcOpts{Timeout: remoteRpcTimeoutMs})
	if err != nil {
		return fmt.Errorf("remote setup: %w", err)
	}
	WriteStdout("%s", remoteStatusText(st))
	return nil
}

// remoteSetupData checks the flags for the chosen provider and reads the tunnel token only for cloudflare.
func remoteSetupData(readToken func() (string, error)) (wshrpc.CommandRemoteSetupData, error) {
	data := wshrpc.CommandRemoteSetupData{
		Provider: strings.ToLower(strings.TrimSpace(remoteSetupProvider)),
		Email:    remoteSetupEmail,
		Hostname: remoteSetupHostname,
		Port:     remoteSetupPort,
	}
	switch data.Provider {
	case remoteProviderTailscale:
		return data, nil
	case remoteProviderCloudflare:
	default:
		return data, fmt.Errorf("--provider must be %s or %s", remoteProviderCloudflare, remoteProviderTailscale)
	}
	var missing []string
	for _, f := range []struct{ name, val string }{
		{"--team", remoteSetupTeam}, {"--aud", remoteSetupAud}, {"--email", remoteSetupEmail}, {"--hostname", remoteSetupHostname},
	} {
		if strings.TrimSpace(f.val) == "" {
			missing = append(missing, f.name)
		}
	}
	if len(missing) > 0 {
		return data, fmt.Errorf("cloudflare setup needs %s", strings.Join(missing, ", "))
	}
	token, err := readToken()
	if err != nil {
		return data, err
	}
	data.TunnelToken, data.Team, data.Aud = token, remoteSetupTeam, remoteSetupAud
	return data, nil
}

func remoteOnRun(cmd *cobra.Command, args []string) error {
	st, err := wshclient.RemoteOnCommand(RpcClient, &wshrpc.RpcOpts{Timeout: remoteRpcTimeoutMs})
	if err != nil {
		return fmt.Errorf("remote on: %w", err)
	}
	WriteStdout("%s", remoteStatusText(st))
	return nil
}

func remoteOffRun(cmd *cobra.Command, args []string) error {
	st, err := wshclient.RemoteOffCommand(RpcClient, &wshrpc.RpcOpts{Timeout: remoteRpcTimeoutMs})
	if err != nil {
		return fmt.Errorf("remote off: %w", err)
	}
	WriteStdout("%s", remoteStatusText(st))
	return nil
}

func remoteStatusRun(cmd *cobra.Command, args []string) error {
	st, err := wshclient.RemoteStatusCommand(RpcClient, &wshrpc.RpcOpts{Timeout: remoteRpcTimeoutMs})
	if err != nil {
		return fmt.Errorf("remote status: %w", err)
	}
	WriteStdout("%s", remoteStatusText(st))
	return nil
}

func remoteHandRun(cmd *cobra.Command, args []string) error {
	data, err := remoteHandData(args, callingBlockORef)
	if err != nil {
		return fmt.Errorf("remote hand: %w", err)
	}
	st, err := wshclient.RemoteHandCommand(RpcClient, data, &wshrpc.RpcOpts{Timeout: remoteRpcTimeoutMs})
	if err != nil {
		return fmt.Errorf("remote hand: %w", err)
	}
	WriteStdout("%s", remoteStatusText(st))
	return nil
}

func remoteTakeBackRun(cmd *cobra.Command, args []string) error {
	data, err := remoteHandData(args, callingBlockORef)
	if err != nil {
		return fmt.Errorf("remote take-back: %w", err)
	}
	st, err := wshclient.RemoteTakeBackCommand(RpcClient, data, &wshrpc.RpcOpts{Timeout: remoteRpcTimeoutMs})
	if err != nil {
		return fmt.Errorf("remote take-back: %w", err)
	}
	WriteStdout("%s", remoteStatusText(st))
	return nil
}

// remoteHandData names the tab by its argument, or by the block wsh runs in so an agent can hand itself
// over. resolve is only called when there is no argument, since outside a terminal it fails.
func remoteHandData(args []string, resolve func() (string, error)) (wshrpc.CommandRemoteHandData, error) {
	if len(args) > 0 {
		if tab := strings.TrimSpace(args[0]); tab != "" {
			return wshrpc.CommandRemoteHandData{Tab: tab}, nil
		}
	}
	from, err := resolve()
	if err != nil {
		return wshrpc.CommandRemoteHandData{}, fmt.Errorf("name an agent's tab, there is no calling terminal: %w", err)
	}
	return wshrpc.CommandRemoteHandData{FromORef: from}, nil
}

func callingBlockORef() (string, error) {
	oref, err := resolveBlockArg()
	if err != nil {
		return "", err
	}
	return oref.String(), nil
}

func stdinIsTerminal() bool {
	fi, err := os.Stdin.Stat()
	return err == nil && fi.Mode()&os.ModeCharDevice != 0
}

// readTunnelToken takes the first non-empty line, so a piped file with a trailing newline works. The
// token is never a flag: a flag lands in the process list and the shell history.
func readTunnelToken(r io.Reader, prompt bool) (string, error) {
	if prompt {
		WriteStderr("%s ", remoteTunnelPrompt)
	}
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 0, 64*1024), remoteTokenMaxBytes)
	for sc.Scan() {
		if line := strings.TrimSpace(sc.Text()); line != "" {
			return line, nil
		}
	}
	if err := sc.Err(); err != nil {
		return "", fmt.Errorf("reading tunnel token: %w", err)
	}
	return "", errors.New("no tunnel token on stdin: pipe it in or type it at the prompt")
}

func remoteStatusText(st *wshrpc.RemoteStatusData) string {
	var b strings.Builder
	onOff := "off"
	if st.On {
		onOff = "on"
	}
	fmt.Fprintf(&b, "Remote mode: %s\n", onOff)
	if st.Provider == remoteProviderTailscale {
		b.WriteString("Through: tailscale serve\n")
	}
	if st.Hostname != "" {
		fmt.Fprintf(&b, "Address: https://%s\n", st.Hostname)
	}
	if st.Port != 0 {
		fmt.Fprintf(&b, "Local port: %d\n", st.Port)
	}
	fmt.Fprintf(&b, "Tunnel: %s", st.Tunnel)
	if st.TunnelError != "" {
		fmt.Fprintf(&b, " (%s)", st.TunnelError)
	}
	b.WriteString("\n")
	if st.Subscriptions > 0 {
		fmt.Fprintf(&b, "Phone: subscribed (%d)\n", st.Subscriptions)
	} else {
		b.WriteString("Phone: not subscribed yet\n")
	}
	if len(st.Handed) > 0 {
		fmt.Fprintf(&b, "Handed to phone: %s\n", strings.Join(st.Handed, ", "))
	}
	if len(st.Missing) > 0 {
		fmt.Fprintf(&b, "Setup: missing %s, run wsh remote setup\n", strings.Join(st.Missing, ", "))
	} else {
		b.WriteString("Setup: complete\n")
	}
	if st.CloudflaredMissing {
		fmt.Fprintf(&b, "cloudflared not found: %s\n", remoteCloudflaredFix)
	}
	if st.TailscaleMissing {
		fmt.Fprintf(&b, "tailscale not found: %s\n", remoteTailscaleFix)
	}
	return b.String()
}
