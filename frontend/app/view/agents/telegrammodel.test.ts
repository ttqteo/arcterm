// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { telegramView } from "./telegrammodel";

const NOW = 1_800_000_000_000;

// a running, connected bot with nothing else going on
const live: TelegramStatusData = { enabled: true, hastoken: true, polling: true, botname: "arc_bot" };

describe("telegramView", () => {
    it("reads no status, and a status without a token, as no token", () => {
        expect(telegramView(null, NOW)).toEqual({ kind: "no-token" });
        expect(telegramView({ enabled: false, hastoken: false, polling: false }, NOW)).toEqual({ kind: "no-token" });
    });

    it("puts a missing token ahead of everything else", () => {
        const s = { ...live, hastoken: false, lasterror: "Token rejected by Telegram", chatname: "Me" };
        expect(telegramView(s, NOW)).toEqual({ kind: "no-token" });
    });

    it("reads a token with the switch off as off, even after an error", () => {
        expect(telegramView({ ...live, enabled: false, polling: false }, NOW)).toEqual({ kind: "off" });
        expect(telegramView({ ...live, enabled: false, lasterror: "old" }, NOW)).toEqual({ kind: "off" });
    });

    it("shows the last error while the switch is on", () => {
        const s = { ...live, polling: false, lasterror: "Token rejected by Telegram" };
        expect(telegramView(s, NOW)).toEqual({ kind: "error", text: "Token rejected by Telegram" });
    });

    it("reads a bot that is not polling yet as connecting", () => {
        expect(telegramView({ ...live, polling: false, botname: undefined }, NOW)).toEqual({ kind: "connecting" });
    });

    it("shows the pair code with the minutes left, rounded up and never under one", () => {
        const base = { ...live, paircode: "123456" };
        expect(telegramView({ ...base, paircodeexpires: NOW + 10 * 60_000 }, NOW)).toEqual({
            kind: "pairing",
            code: "123456",
            minutesLeft: 10,
            bot: "arc_bot",
        });
        expect(telegramView({ ...base, paircodeexpires: NOW + 90_000 }, NOW)).toMatchObject({ minutesLeft: 2 });
        expect(telegramView({ ...base, paircodeexpires: NOW + 1 }, NOW)).toMatchObject({ minutesLeft: 1 });
    });

    it("drops a pair code that has expired", () => {
        const s = { ...live, paircode: "123456", paircodeexpires: NOW };
        expect(telegramView(s, NOW)).toEqual({ kind: "unpaired", bot: "arc_bot" });
        expect(telegramView({ ...s, paircodeexpires: NOW - 1 }, NOW)).toEqual({ kind: "unpaired", bot: "arc_bot" });
    });

    it("drops a pair code that has no expiry", () => {
        expect(telegramView({ ...live, paircode: "123456" }, NOW)).toEqual({ kind: "unpaired", bot: "arc_bot" });
    });

    it("reads a chat name as paired, and a live code beats it so a re-pair shows its code", () => {
        expect(telegramView({ ...live, chatname: "Verify chat" }, NOW)).toEqual({
            kind: "paired",
            chat: "Verify chat",
            bot: "arc_bot",
        });
        const repair = { ...live, chatname: "Verify chat", paircode: "654321", paircodeexpires: NOW + 60_000 };
        expect(telegramView(repair, NOW)).toMatchObject({ kind: "pairing", code: "654321" });
    });

    it("reads a connected bot with no chat as unpaired", () => {
        expect(telegramView(live, NOW)).toEqual({ kind: "unpaired", bot: "arc_bot" });
    });
});
