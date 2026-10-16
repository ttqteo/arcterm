// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"errors"
	"fmt"

	"github.com/wavetermdev/waveterm/pkg/telebot"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

var errTelegramNotRunning = errors.New("telegram is not running")

func (ws *WshServer) TelegramStatusCommand(ctx context.Context) (wshrpc.TelegramStatusData, error) {
	if telebot.Default == nil {
		return wshrpc.TelegramStatusData{}, nil
	}
	st := telebot.Default.Status()
	return wshrpc.TelegramStatusData{
		Enabled:         st.Enabled,
		HasToken:        st.HasToken,
		Connected:       st.Connected,
		Allowed:         st.Allowed,
		AllowedUntil:    st.AllowedUntil,
		NextAllowed:     st.NextAllowed,
		Open:            st.Open,
		BotName:         st.BotName,
		ChatName:        wconfig.GetWatcher().GetFullConfig().Settings.TelegramChatName,
		PairCode:        st.PairCode,
		PairCodeExpires: st.PairCodeExpires,
		LastError:       st.LastError,
	}, nil
}

func (ws *WshServer) TelegramPairCommand(ctx context.Context) (wshrpc.TelegramPairData, error) {
	if telebot.Default == nil {
		return wshrpc.TelegramPairData{}, errTelegramNotRunning
	}
	code, expires := telebot.Default.Pair()
	return wshrpc.TelegramPairData{Code: code, Expires: expires.UnixMilli()}, nil
}

func (ws *WshServer) TelegramUnpairCommand(ctx context.Context) error {
	if telebot.Default == nil {
		return errTelegramNotRunning
	}
	if err := wconfig.SetBaseConfigValue(unpairSettings()); err != nil {
		return fmt.Errorf("clearing the paired telegram chat: %w", err)
	}
	return nil
}

// unpairSettings is the settings write that forgets the paired chat. The config hook then pokes the bot, which
// reads the cleared chat id and stops sending.
func unpairSettings() waveobj.MetaMapType {
	return waveobj.MetaMapType{"telegram:chatid": nil, "telegram:chatname": nil}
}
