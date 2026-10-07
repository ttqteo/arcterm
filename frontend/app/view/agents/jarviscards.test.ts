import { describe, expect, it } from "vitest";
import {
    answeredAskIds,
    fleetCounts,
    parseCardData,
} from "./jarviscards";

const answered = JSON.stringify({
    askORef: "block:abc",
    workerORef: "tab:xyz",
    question: "TTL 24h or 7d?",
    options: [{ label: "24 hours", sub: "matches token" }, { label: "7 days" }],
    choice: 0,
    reason: "reversible",
});

describe("parseCardData", () => {
    it("parses an answered payload", () => {
        const cd = parseCardData({ id: "1", kind: "jarvis-answered", author: "jarvis", text: "", ts: 0, data: answered } as ChannelMessage);
        expect(cd?.question).toBe("TTL 24h or 7d?");
        expect(cd?.options).toHaveLength(2);
        expect(cd?.choice).toBe(0);
        expect(cd?.askORef).toBe("block:abc");
        expect(cd?.workerORef).toBe("tab:xyz");
    });
    it("parses an escalation payload (no choice)", () => {
        const esc = JSON.stringify({ askORef: "block:a", workerORef: "tab:b", question: "q", options: [{ label: "x" }] });
        expect(parseCardData({ id: "2", kind: "jarvis-escalation", author: "jarvis", text: "", ts: 0, data: esc } as ChannelMessage)?.choice).toBeUndefined();
    });
    it("parses a persisted humanPick", () => {
        const esc = JSON.stringify({ askORef: "block:a", workerORef: "tab:b", question: "q", options: [{ label: "x" }, { label: "y" }], humanPick: 1 });
        const cd = parseCardData({ id: "2h", kind: "jarvis-escalation", author: "jarvis", text: "", ts: 0, data: esc } as ChannelMessage);
        expect(cd?.humanPick).toBe(1);
    });
    it("returns null for a legacy message (no data)", () => {
        expect(parseCardData({ id: "3", kind: "jarvis-answered", author: "jarvis", text: "flat", ts: 0 } as ChannelMessage)).toBeNull();
    });
    it("returns null for malformed json", () => {
        expect(parseCardData({ id: "4", kind: "jarvis-answered", author: "jarvis", text: "", ts: 0, data: "{oops" } as ChannelMessage)).toBeNull();
    });
    it("returns null when required fields are missing", () => {
        expect(parseCardData({ id: "5", kind: "jarvis-answered", author: "jarvis", text: "", ts: 0, data: "{}" } as ChannelMessage)).toBeNull();
    });
});

describe("fleetCounts", () => {
    it("tallies working and waiting(=asking), ignoring idle/gone", () => {
        const snap = [
            { state: "working" }, { state: "working" }, { state: "asking" },
            { state: "idle" }, { state: "gone" },
        ] as { state: string }[];
        expect(fleetCounts(snap)).toEqual({ working: 2, waiting: 1 });
    });
    it("empty snapshot is zero", () => {
        expect(fleetCounts([])).toEqual({ working: 0, waiting: 0 });
    });
});

const answeredCard = (askId: string) =>
    JSON.stringify({ askORef: "block:a", askId, workerORef: "tab:x", question: "q", options: [{ label: "y" }], choice: 0 });

describe("answeredAskIds", () => {
    it("collects ask ids from jarvis-answered cards only (not escalations)", () => {
        const msgs = [
            { id: "1", kind: "jarvis-answered", author: "jarvis", text: "", ts: 0, data: answeredCard("ask-1") },
            { id: "2", kind: "jarvis-escalation", author: "jarvis", text: "", ts: 0, data: answeredCard("ask-2") },
            { id: "3", kind: "human", author: "you", text: "hi", ts: 0 },
        ] as ChannelMessage[];
        const s = answeredAskIds(msgs);
        expect(s.has("ask-1")).toBe(true);
        expect(s.has("ask-2")).toBe(false);
        expect(s.size).toBe(1);
    });
});
