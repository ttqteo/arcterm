// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What the Telegram row under Settings → General → Notifications says: the one line that follows from the
// bot's status (TelegramStatusCommand). Pure, so every state is a unit test; telegramrow.tsx only draws it.

export type TelegramView =
    | { kind: "no-token" }
    | { kind: "off" }
    | { kind: "error"; text: string }
    | { kind: "connecting" }
    | { kind: "pairing"; code: string; minutesLeft: number; bot: string }
    | { kind: "unpaired"; bot: string }
    | { kind: "paired"; chat: string; bot: string };

// `now` is UnixMilli, like paircodeexpires. No status yet reads as no token: the server answers an empty
// status before the bot exists, and the row draws no status line until its first poll lands.
export function telegramView(s: TelegramStatusData | null, now: number): TelegramView {
    if (s == null || !s.hastoken) {
        return { kind: "no-token" };
    }
    if (!s.enabled) {
        return { kind: "off" };
    }
    if (s.lasterror) {
        return { kind: "error", text: s.lasterror };
    }
    if (!s.polling) {
        return { kind: "connecting" };
    }
    const bot = s.botname ?? "";
    const expires = s.paircodeexpires ?? 0;
    if (s.paircode && expires > now) {
        return {
            kind: "pairing",
            code: s.paircode,
            minutesLeft: Math.max(1, Math.ceil((expires - now) / 60_000)),
            bot,
        };
    }
    if (s.chatname) {
        return { kind: "paired", chat: s.chatname, bot };
    }
    return { kind: "unpaired", bot };
}
