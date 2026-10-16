// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"sort"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/telebot"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func TestTelegramStatusWithoutBot(t *testing.T) {
	saved := telebot.Default
	telebot.Default = nil
	t.Cleanup(func() { telebot.Default = saved })

	ws := &WshServer{}
	st, err := ws.TelegramStatusCommand(context.Background())
	if err != nil {
		t.Fatalf("TelegramStatusCommand with no bot: %v", err)
	}
	if st != (wshrpc.TelegramStatusData{}) {
		t.Errorf("status with no bot = %+v, want the zero status", st)
	}
	if _, err := ws.TelegramPairCommand(context.Background()); err == nil {
		t.Error("TelegramPairCommand with no bot returned no error")
	}
	if err := ws.TelegramUnpairCommand(context.Background()); err == nil {
		t.Error("TelegramUnpairCommand with no bot returned no error")
	}
}

func TestTelegramUnpairClearsSettings(t *testing.T) {
	m := unpairSettings()
	var keys []string
	for k, v := range m {
		keys = append(keys, k)
		if v != nil {
			t.Errorf("%s = %v, want nil (cleared)", k, v)
		}
	}
	sort.Strings(keys)
	if len(keys) != 2 || keys[0] != "telegram:chatid" || keys[1] != "telegram:chatname" {
		t.Errorf("unpairSettings keys = %v, want [telegram:chatid telegram:chatname]", keys)
	}
}
