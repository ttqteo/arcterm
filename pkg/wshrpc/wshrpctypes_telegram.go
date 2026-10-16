// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshrpc

import "context"

// TelegramCommands back the Telegram row under Settings → General → Notifications (pkg/telebot): the bot's state,
// a fresh pairing code, and unpairing the chat.
type TelegramCommands interface {
	TelegramStatusCommand(ctx context.Context) (TelegramStatusData, error) // enabled, token, polling, bot, paired chat, pair code
	TelegramPairCommand(ctx context.Context) (TelegramPairData, error)     // a fresh pairing code for /start
	TelegramUnpairCommand(ctx context.Context) error                       // forget the paired chat
}

// TelegramStatusData mirrors telebot.Status plus the paired chat's name.
type TelegramStatusData struct {
	Enabled         bool   `json:"enabled"`
	HasToken        bool   `json:"hastoken"`
	Polling         bool   `json:"polling"`
	BotName         string `json:"botname,omitempty"`
	ChatName        string `json:"chatname,omitempty"`
	PairCode        string `json:"paircode,omitempty"`
	PairCodeExpires int64  `json:"paircodeexpires,omitempty"` // UnixMilli
	LastError       string `json:"lasterror,omitempty"`
}

type TelegramPairData struct {
	Code    string `json:"code"`
	Expires int64  `json:"expires"` // UnixMilli
}
