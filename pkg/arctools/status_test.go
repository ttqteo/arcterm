// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package arctools

import (
	"errors"
	"testing"
)

func TestStatusFoundAndMissing(t *testing.T) {
	lookPath := func(name string) (string, error) {
		if name == "lazygit" {
			return "/usr/bin/lazygit", nil
		}
		return "", errors.New("not found")
	}
	tools := Builtin()
	got := Status(tools, lookPath)
	if len(got) != len(tools) {
		t.Fatalf("got %d statuses, want %d", len(got), len(tools))
	}
	for i, st := range got {
		if st.Id != tools[i].Id {
			t.Errorf("status %d is %q, want %q: Status must keep the order it was given", i, st.Id, tools[i].Id)
		}
		if st.Id == "lazygit" {
			if !st.Found || st.Path != "/usr/bin/lazygit" {
				t.Errorf("lazygit = found %v path %q, want found at /usr/bin/lazygit", st.Found, st.Path)
			}
			continue
		}
		if st.Found || st.Path != "" {
			t.Errorf("%s = found %v path %q, want missing with no path", st.Id, st.Found, st.Path)
		}
	}
}

// visidata is the one built-in whose id and command differ: the status looks up the command.
func TestStatusLooksUpTheCommand(t *testing.T) {
	var asked []string
	lookPath := func(name string) (string, error) {
		asked = append(asked, name)
		return "", errors.New("not found")
	}
	Status([]Tool{{Id: "visidata", Command: "vd"}}, lookPath)
	if len(asked) != 1 || asked[0] != "vd" {
		t.Errorf("lookPath was asked for %v, want [vd]", asked)
	}
}

func TestStatusEmpty(t *testing.T) {
	got := Status(nil, func(string) (string, error) { return "", errors.New("x") })
	if got == nil || len(got) != 0 {
		t.Errorf("Status(nil) = %#v, want an empty non-nil slice so the RPC returns [] and not null", got)
	}
}
