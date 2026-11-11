// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { chatEmptyView } from "./chatempty";

describe("chatEmptyView", () => {
    it("reads a working agent with no message as its harness starting, in its project", () => {
        expect(chatEmptyView({ agent: "claude", state: "working", project: "arcterm" })).toEqual({
            phase: "starting",
            title: "Starting Claude Code…",
            detail: "Setting up a new conversation in arcterm",
        });
    });

    it("names no harness or project it does not know", () => {
        expect(chatEmptyView({ state: "working" })).toEqual({
            phase: "starting",
            title: "Starting the agent…",
            detail: "Setting up a new conversation",
        });
    });

    it("reads an agent at its prompt as a new conversation with its facts and how to begin", () => {
        const v = chatEmptyView({ agent: "claude", state: "idle", project: "arcterm", model: "opus 5.5" });
        expect(v.phase).toBe("ready");
        expect(v.title).toBe("New conversation");
        expect(v.facts).toBe("opus 5.5 · arcterm");
        expect(v.hint).toMatch(/Type below/);
    });

    it("leaves the facts out when it knows none", () => {
        expect(chatEmptyView({ agent: "pi", state: "idle" }).facts).toBeUndefined();
    });

    it("reads a controller that refused to start as failed with its reason, whatever its state", () => {
        expect(chatEmptyView({ agent: "codex", state: "working", startError: "codex not found on PATH" })).toEqual({
            phase: "failed",
            title: "Codex did not start",
            detail: "codex not found on PATH",
        });
        expect(chatEmptyView({ state: "idle", startError: "boom" }).title).toBe("The agent did not start");
    });

    it("reads a sleeping agent as asleep, woken by the box", () => {
        const v = chatEmptyView({ agent: "claude", state: "idle", sleeping: { since: 1, freedBytes: 0 } });
        expect(v.phase).toBe("asleep");
        expect(v.title).toBe("No messages yet");
        expect(v.hint).toMatch(/wake/);
    });
});
