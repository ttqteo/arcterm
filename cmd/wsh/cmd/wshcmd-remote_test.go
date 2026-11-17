// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"errors"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const remoteTestToken = "eyJhIjoic2VjcmV0LXRva2VuIn0="

func TestRemoteStatusText(t *testing.T) {
	cases := []struct {
		name string
		st   wshrpc.RemoteStatusData
		want string
	}{
		{
			name: "off and unset",
			st: wshrpc.RemoteStatusData{
				Tunnel:  "off",
				Missing: []string{"tunneltoken", "team", "aud", "email", "hostname"},
			},
			want: "Remote mode: off\n" +
				"Tunnel: off\n" +
				"Phone: not subscribed yet\n" +
				"Setup: missing tunneltoken, team, aud, email, hostname, run wsh remote setup\n",
		},
		{
			name: "on and up",
			st: wshrpc.RemoteStatusData{
				On: true, Hostname: "arc.example.com", Port: 47821, Tunnel: "up", Subscriptions: 2,
			},
			want: "Remote mode: on\n" +
				"Address: https://arc.example.com\n" +
				"Local port: 47821\n" +
				"Tunnel: up\n" +
				"Phone: subscribed (2)\n" +
				"Setup: complete\n",
		},
		{
			name: "down with error",
			st: wshrpc.RemoteStatusData{
				On: true, Hostname: "arc.example.com", Port: 47821, Tunnel: "down", TunnelError: "cloudflared exited: exit status 1",
			},
			want: "Remote mode: on\n" +
				"Address: https://arc.example.com\n" +
				"Local port: 47821\n" +
				"Tunnel: down (cloudflared exited: exit status 1)\n" +
				"Phone: not subscribed yet\n" +
				"Setup: complete\n",
		},
		{
			name: "cloudflared missing",
			st:   wshrpc.RemoteStatusData{Tunnel: "off", Hostname: "arc.example.com", Port: 47821, CloudflaredMissing: true},
			want: "Remote mode: off\n" +
				"Address: https://arc.example.com\n" +
				"Local port: 47821\n" +
				"Tunnel: off\n" +
				"Phone: not subscribed yet\n" +
				"Setup: complete\n" +
				"cloudflared not found: winget install --id Cloudflare.cloudflared\n",
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := remoteStatusText(&c.st)
			if got != c.want {
				t.Errorf("status text:\n got: %q\nwant: %q", got, c.want)
			}
			if strings.Contains(got, remoteTestToken) {
				t.Errorf("status text contains the token")
			}
		})
	}
}

func TestRemoteStatusTextHanded(t *testing.T) {
	st := wshrpc.RemoteStatusData{On: true, Tunnel: "up", Handed: []string{"tab-a", "tab-b"}}
	got := remoteStatusText(&st)
	if !strings.Contains(got, "Handed to phone: tab-a, tab-b\n") {
		t.Errorf("status text lacks the handed tabs:\n%s", got)
	}
	if got := remoteStatusText(&wshrpc.RemoteStatusData{Tunnel: "off"}); strings.Contains(got, "Handed") {
		t.Errorf("status text names hand-overs when there are none:\n%s", got)
	}
}

func TestRemoteHandData(t *testing.T) {
	own := func() (string, error) { return "block:3f2c9a10-0000-4000-8000-000000000001", nil }
	failing := func() (string, error) { return "", errors.New("no WAVETERM_BLOCKID env var set") }
	cases := []struct {
		name    string
		args    []string
		resolve func() (string, error)
		want    wshrpc.CommandRemoteHandData
		wantErr bool
	}{
		{name: "a tab argument is passed through, trimmed", args: []string{" tab-1 "}, resolve: failing, want: wshrpc.CommandRemoteHandData{Tab: "tab-1"}},
		{name: "no argument names the calling block", resolve: own, want: wshrpc.CommandRemoteHandData{FromORef: "block:3f2c9a10-0000-4000-8000-000000000001"}},
		{name: "a blank argument names the calling block", args: []string{"  "}, resolve: own, want: wshrpc.CommandRemoteHandData{FromORef: "block:3f2c9a10-0000-4000-8000-000000000001"}},
		{name: "no argument and no calling block is an error", resolve: failing, wantErr: true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := remoteHandData(c.args, c.resolve)
			if c.wantErr {
				if err == nil {
					t.Fatalf("want an error, got %+v", got)
				}
				return
			}
			if err != nil || got != c.want {
				t.Errorf("got %+v, %v; want %+v", got, err, c.want)
			}
		})
	}
}

func TestRemoteHandCommandsRegistered(t *testing.T) {
	for _, name := range []string{"hand", "take-back"} {
		sub, _, err := remoteCmd.Find([]string{name})
		if err != nil || sub == remoteCmd {
			t.Fatalf("wsh remote %s is not registered: %v", name, err)
		}
		if err := sub.Args(sub, []string{"a", "b"}); err == nil {
			t.Errorf("wsh remote %s accepts two arguments, want at most one", name)
		}
		if err := sub.Args(sub, nil); err != nil {
			t.Errorf("wsh remote %s refuses no argument: %v", name, err)
		}
	}
}

func TestReadTunnelToken(t *testing.T) {
	cases := []struct {
		name, in, want string
		wantErr        bool
	}{
		{name: "trims", in: "  " + remoteTestToken + " \r\n", want: remoteTestToken},
		{name: "skips blank lines", in: "\n \t\n" + remoteTestToken + "\nnext\n", want: remoteTestToken},
		{name: "no trailing newline", in: remoteTestToken, want: remoteTestToken},
		{name: "empty", in: "", wantErr: true},
		{name: "only blanks", in: "\n  \n\t\n", wantErr: true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := readTunnelToken(strings.NewReader(c.in), false)
			if c.wantErr {
				if err == nil {
					t.Fatalf("want an error, got %q", got)
				}
				return
			}
			if err != nil || got != c.want {
				t.Errorf("got %q, %v; want %q", got, err, c.want)
			}
		})
	}
}
