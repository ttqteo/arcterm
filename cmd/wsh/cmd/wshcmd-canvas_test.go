// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wconfig"
)

func TestCanvasPolicy(t *testing.T) {
	on, off := true, false
	cases := []struct {
		name string
		set  *bool
		want string
	}{
		{"unset keeps", nil, "keep"},
		{"off keeps", &off, "keep"},
		{"on deletes on ship", &on, "delete-on-ship"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := canvasPolicy(wconfig.SettingsType{StorageCanvasOnShip: c.set}); got != c.want {
				t.Fatalf("canvasPolicy = %q, want %q", got, c.want)
			}
		})
	}
}
