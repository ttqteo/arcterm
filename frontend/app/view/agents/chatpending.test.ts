import { describe, expect, it } from "vitest";
import type { AgentEntry } from "./agentsviewmodel";
import {
    PASTE_OVER,
    PENDING_IDLE_MS,
    PENDING_MAX_MS,
    pastesBody,
    pendingStill,
    pendsAsBubble,
    pushSent,
    recall,
    sendHold,
    submitDelayMs,
    userTextCount,
    type PendingMessage,
} from "./chatpending";

const user = (text: string): AgentEntry => ({ kind: "user", text });
const msg = (text: string): AgentEntry => ({ kind: "message", text });

describe("userTextCount", () => {
    it("counts the user entries holding exactly that text, ignoring edge whitespace and Claude's messages", () => {
        const entries = [user("hello"), msg("hello"), user(" hello\n"), user("other")];
        expect(userTextCount(entries, "hello")).toBe(2);
        expect(userTextCount(entries, "nope")).toBe(0);
    });
});

describe("pendingStill", () => {
    const p = (over: Partial<PendingMessage> = {}): PendingMessage => ({
        id: "a",
        text: "hello",
        sentAt: 1000,
        seen: 1,
        ...over,
    });
    it("keeps a pending whose text the entries hold `seen` times", () => {
        expect(pendingStill([p()], [user("hello")], 2000)).toHaveLength(1);
    });
    it("drops it once the entries hold the text one more time", () => {
        expect(pendingStill([p()], [user("hello"), user("hello")], 2000)).toEqual([]);
    });
    it("drops one older than PENDING_MAX_MS", () => {
        expect(pendingStill([p()], [user("hello")], 1000 + PENDING_MAX_MS - 1)).toHaveLength(1);
        expect(pendingStill([p()], [user("hello")], 1000 + PENDING_MAX_MS)).toEqual([]);
    });
    it("drops one the agent has sat idle on for PENDING_IDLE_MS since it was sent", () => {
        // idle from 3000; sent at 1000 (queued before the turn ended, then cleared with Esc)
        expect(pendingStill([p()], [user("hello")], 3000 + PENDING_IDLE_MS - 1, 3000)).toHaveLength(1);
        expect(pendingStill([p()], [user("hello")], 3000 + PENDING_IDLE_MS, 3000)).toEqual([]);
    });
    it("counts the idle wait from the send when it was sent to an idle agent", () => {
        // idle since 500, sent at 1000 (typed in but never submitted)
        expect(pendingStill([p()], [user("hello")], 1000 + PENDING_IDLE_MS - 1, 500)).toHaveLength(1);
        expect(pendingStill([p()], [user("hello")], 1000 + PENDING_IDLE_MS, 500)).toEqual([]);
    });
    it("keeps it while the agent works, however long", () => {
        expect(pendingStill([p()], [user("hello")], 1000 + PENDING_MAX_MS - 1, null)).toHaveLength(1);
    });
    it("matches each pending against its own text", () => {
        const out = pendingStill(
            [p({ id: "a" }), p({ id: "b", text: "two", seen: 0 })],
            [user("hello"), user("two")],
            2000
        );
        expect(out.map((x) => x.id)).toEqual(["a"]);
    });
});

describe("pushSent", () => {
    it("appends, skips a repeat of the newest, and keeps the last 20", () => {
        expect(pushSent(["a"], "b")).toEqual(["a", "b"]);
        expect(pushSent(["a", "b"], "b")).toEqual(["a", "b"]);
        expect(pushSent(["a", "b"], "a")).toEqual(["a", "b", "a"]);
        let h: string[] = [];
        for (let i = 0; i < 25; i++) {
            h = pushSent(h, `m${i}`);
        }
        expect(h).toHaveLength(20);
        expect(h[0]).toBe("m5");
        expect(h[19]).toBe("m24");
    });
});

describe("recall", () => {
    const h = ["one", "two", "three"];
    it("goes up from nothing to the newest, then back through the older ones", () => {
        const a = recall(h, null, "up");
        expect(a).toEqual({ at: 2, text: "three" });
        const b = recall(h, a.at, "up");
        expect(b).toEqual({ at: 1, text: "two" });
        expect(recall(h, 0, "up")).toEqual({ at: 0, text: "one" });
    });
    it("goes down and from the newest to empty", () => {
        expect(recall(h, 0, "down")).toEqual({ at: 1, text: "two" });
        expect(recall(h, 2, "down")).toEqual({ at: null, text: "" });
        expect(recall(h, null, "down")).toEqual({ at: null, text: "" });
    });
    it("with no history stays empty", () => {
        expect(recall([], null, "up")).toEqual({ at: null, text: "" });
    });
});

describe("sendHold", () => {
    it("names why a send waits", () => {
        expect(sendHold(true, false)).toBe("Answer the permission prompt first");
        expect(sendHold(false, true)).toBe("Answer Claude's question first");
        expect(sendHold(true, true)).toBe("Answer the permission prompt first");
        expect(sendHold(false, false)).toBeNull();
    });
});

describe("pendsAsBubble", () => {
    it("is true for a message, false for a /command (the projection draws it as a command entry, never your bubble)", () => {
        expect(pendsAsBubble("hello")).toBe(true);
        expect(pendsAsBubble("use src/app and/or lib")).toBe(true);
        expect(pendsAsBubble("/compact")).toBe(false);
        expect(pendsAsBubble("  /model opus\n")).toBe(false);
    });

    it("is false for a `! cmd`, which the projection draws as its shell card", () => {
        expect(pendsAsBubble("! ls")).toBe(false);
        expect(pendsAsBubble("!git status")).toBe(false);
        expect(pendsAsBubble("great!")).toBe(true);
    });
});

describe("pastesBody", () => {
    it("pastes a message with a line break, or one longer than a typed line", () => {
        expect(pastesBody(["one", "two"].join("\n"))).toBe(true);
        expect(pastesBody("x".repeat(PASTE_OVER + 1))).toBe(true);
        expect(pastesBody("x".repeat(PASTE_OVER))).toBe(false);
        expect(pastesBody("hello")).toBe(false);
    });
});

describe("submitDelayMs", () => {
    it("waits at least the keystroke gap, more for a long paste, never past the cap", () => {
        expect(submitDelayMs(5)).toBe(80);
        expect(submitDelayMs(20_000)).toBeGreaterThan(submitDelayMs(2_000));
        expect(submitDelayMs(10_000_000)).toBe(600);
    });
});
