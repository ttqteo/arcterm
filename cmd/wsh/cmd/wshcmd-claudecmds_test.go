// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"reflect"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func TestClaudecmdsReadListParsesTheModsJSON(t *testing.T) {
	in := `[{"name":"clear","description":"Clear the conversation","source":"builtin"},{"name":"skim:skim","source":"plugin","plugin":"skim"}]`
	got, err := readClaudeCmdsList(strings.NewReader(in))
	if err != nil {
		t.Fatalf("readClaudeCmdsList: %v", err)
	}
	want := []wshrpc.ClaudeCommandInfo{
		{Name: "clear", Description: "Clear the conversation", Source: "builtin"},
		{Name: "skim:skim", Source: "plugin", Plugin: "skim"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v, want %+v", got, want)
	}
}

func TestClaudecmdsReadListRefusesBadInput(t *testing.T) {
	for name, in := range map[string]string{
		"not json":     "clear, help",
		"an object":    `{"name":"clear"}`,
		"empty":        "",
		"over the cap": "[" + strings.Repeat(" ", claudeCmdsMaxStdinBytes) + "]",
	} {
		if _, err := readClaudeCmdsList(strings.NewReader(in)); err == nil {
			t.Errorf("%s: want an error", name)
		}
	}
}
