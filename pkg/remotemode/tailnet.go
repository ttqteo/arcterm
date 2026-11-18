// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package remotemode

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
)

// tailscale serve sets this on every request it proxies from a user's device in the tailnet, after
// dropping any copy the client sent; a request from a tagged device or through Funnel carries none.
const tailnetLoginHeader = "Tailscale-User-Login"

// tailnetVerify lets in only the owner's tailnet login. The listener is bound to loopback, so only
// tailscale serve or a program on this machine reaches it, and such a program can already drive Arc
// through wsh.
func tailnetVerify(owner string) func(*http.Request) error {
	return func(r *http.Request) error {
		login := strings.TrimSpace(r.Header.Get(tailnetLoginHeader))
		if login == "" {
			return errors.New("no tailnet login: not through tailscale serve, or from a tagged device")
		}
		if owner == "" || !strings.EqualFold(login, owner) {
			return fmt.Errorf("tailnet login %q is not the owner", login)
		}
		return nil
	}
}
