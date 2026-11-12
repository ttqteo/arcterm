// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { AgentVM } from "./agentsviewmodel";
import {
    CHAT_MODES_MAX,
    cellView,
    cellViewOptions,
    chatCapable,
    nextCellView,
    parseChatModes,
    shownChatMode,
    withChatMode,
} from "./chatmode";

const claude = { id: "a1", blockId: "b1" };

describe("chatCapable", () => {
    it("is a roster Claude agent with a block, an unset harness counting as Claude", () => {
        expect(chatCapable({ ...claude, agent: "claude" })).toBe(true);
        expect(chatCapable({ ...claude, agent: "Claude" })).toBe(true);
        expect(chatCapable(claude)).toBe(true);
        expect(chatCapable({ ...claude, kind: "agent" })).toBe(true);
    });

    it("is not codex, pi, a plain terminal or a background agent", () => {
        expect(chatCapable({ ...claude, agent: "codex" })).toBe(false);
        expect(chatCapable({ ...claude, agent: "pi" })).toBe(false);
        expect(chatCapable({ ...claude, kind: "terminal" })).toBe(false);
        expect(chatCapable({ ...claude, kind: "background" })).toBe(false);
    });

    it("takes a run's lead and live workers, not an ended worker, the final stage, or an agent with no block", () => {
        const worker: AgentVM = { id: "a3", name: "w", task: "", state: "working", blockId: "b3", runId: "run-1" };
        expect(chatCapable(worker)).toBe(true);
        expect(chatCapable({ id: "ended:run-1:t-2", blockId: "b2" })).toBe(false);
        expect(chatCapable({ id: "final:run-1", blockId: "b3" })).toBe(false);
        expect(chatCapable({ id: "a2" })).toBe(false);
        expect(chatCapable(undefined)).toBe(false);
    });
});

describe("shownChatMode", () => {
    it("is Chat by default for a capable agent, and the stored mode when set", () => {
        expect(shownChatMode(claude, undefined)).toBe("chat");
        expect(shownChatMode(claude, "terminal")).toBe("terminal");
        expect(shownChatMode(claude, "chat")).toBe("chat");
    });

    it("is Terminal for an agent that is not chat-capable, whatever is stored", () => {
        expect(shownChatMode({ ...claude, agent: "codex" }, undefined)).toBe("terminal");
        expect(shownChatMode({ ...claude, agent: "codex" }, "chat")).toBe("terminal");
    });
});

describe("cellView", () => {
    it("is Chat only when the slot is the terminal and the mode is chat", () => {
        expect(cellView("terminal", "chat")).toBe("chat");
        expect(cellView("terminal", "terminal")).toBe("terminal");
        expect(cellView("canvas", "chat")).toBe("canvas");
        expect(cellView("review", "chat")).toBe("review");
        expect(cellView("brainstorm", "terminal")).toBe("brainstorm");
    });
});

describe("cellViewOptions", () => {
    it("puts Chat first for a capable agent, then Terminal, the canvas or brainstorm, then review", () => {
        expect(cellViewOptions(true, false, false, false)).toEqual(["chat", "terminal"]);
        expect(cellViewOptions(true, true, false, false)).toEqual(["chat", "terminal", "canvas"]);
        expect(cellViewOptions(true, true, true, false)).toEqual(["chat", "terminal", "canvas", "review"]);
        expect(cellViewOptions(true, false, true, false)).toEqual(["chat", "terminal", "review"]);
        // the brainstorm takes the canvas's slot
        expect(cellViewOptions(true, true, true, true)).toEqual(["chat", "terminal", "brainstorm", "review"]);
    });

    it("has no Chat for an agent that is not capable", () => {
        expect(cellViewOptions(false, false, false, false)).toEqual(["terminal"]);
        expect(cellViewOptions(false, true, true, false)).toEqual(["terminal", "canvas", "review"]);
        expect(cellViewOptions(false, false, false, true)).toEqual(["terminal", "brainstorm"]);
    });

    it("leaves Terminal out for a sleeping capable agent, as the header disables it, and keeps Chat", () => {
        // asleep with a canvas and a review open: the key walks Chat, the canvas and the review
        expect(cellViewOptions(true, true, true, false, true)).toEqual(["chat", "canvas", "review"]);
        expect(cellViewOptions(true, false, true, true, true)).toEqual(["chat", "brainstorm", "review"]);
        expect(cellViewOptions(true, true, false, false, true)).toEqual(["chat", "canvas"]);
        // asleep with nothing else open: Chat alone
        expect(cellViewOptions(true, false, false, false, true)).toEqual(["chat"]);
    });

    it("keeps the full list when not asleep, and asleep means nothing to an agent that is not capable", () => {
        expect(cellViewOptions(true, true, true, false, false)).toEqual(["chat", "terminal", "canvas", "review"]);
        expect(cellViewOptions(false, true, true, false, true)).toEqual(["terminal", "canvas", "review"]);
        expect(cellViewOptions(false, false, false, false, true)).toEqual(["terminal"]);
    });
});

describe("nextCellView", () => {
    it("walks the options and wraps", () => {
        const o = cellViewOptions(true, true, true, false);
        expect(nextCellView("chat", o)).toBe("terminal");
        expect(nextCellView("terminal", o)).toBe("canvas");
        expect(nextCellView("canvas", o)).toBe("review");
        expect(nextCellView("review", o)).toBe("chat");
    });

    it("passes (null) with fewer than two options", () => {
        expect(nextCellView("terminal", ["terminal"])).toBeNull();
        expect(nextCellView("terminal", [])).toBeNull();
    });

    it("starts from the first option when the current view is not one", () => {
        expect(nextCellView("canvas", ["chat", "terminal"])).toBe("chat");
    });

    it("walks a sleeping agent's Chat, canvas and review, and passes when it has fewer than two", () => {
        const o = cellViewOptions(true, true, true, false, true);
        expect(nextCellView("chat", o)).toBe("canvas");
        expect(nextCellView("canvas", o)).toBe("review");
        expect(nextCellView("review", o)).toBe("chat");
        // back to the conversation from a brainstorm while asleep
        expect(nextCellView("brainstorm", cellViewOptions(true, false, false, true, true))).toBe("chat");
        expect(nextCellView("chat", cellViewOptions(true, false, false, false, true))).toBeNull();
    });
});

describe("the stored chat modes", () => {
    it("round-trips, storing only Terminal", () => {
        let m = withChatMode({}, "a1", "terminal");
        m = withChatMode(m, "a2", "terminal");
        m = withChatMode(m, "a1", "chat");
        expect(m).toEqual({ a2: "terminal" });
        expect(parseChatModes(JSON.stringify(m))).toEqual({ a2: "terminal" });
    });

    it("reads nothing from missing, broken or foreign data", () => {
        expect(parseChatModes(null)).toEqual({});
        expect(parseChatModes("not json")).toEqual({});
        expect(parseChatModes("[1,2]")).toEqual({});
        expect(parseChatModes(JSON.stringify({ a1: "chat", a2: 3, a3: "terminal" }))).toEqual({ a3: "terminal" });
    });

    it("keeps the last 200 ids, dropping the oldest", () => {
        let m = {};
        for (let i = 0; i < CHAT_MODES_MAX + 5; i++) {
            m = withChatMode(m, `a${i}`, "terminal");
        }
        const ids = Object.keys(m);
        expect(ids).toHaveLength(CHAT_MODES_MAX);
        expect(ids[0]).toBe("a5");
        expect(ids.at(-1)).toBe(`a${CHAT_MODES_MAX + 4}`);
        // setting an id again makes it the newest
        m = withChatMode(m, "a5", "terminal");
        expect(Object.keys(m).at(-1)).toBe("a5");
        expect(Object.keys(parseChatModes(JSON.stringify({ ...m, extra: "terminal" })))).toHaveLength(CHAT_MODES_MAX);
    });
});
