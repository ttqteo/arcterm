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
    it("returns null when any one required field is missing", () => {
        const full: Record<string, unknown> = { askORef: "block:a", question: "q", options: [{ label: "x" }] };
        for (const missing of ["askORef", "question", "options"]) {
            const rest = { ...full };
            delete rest[missing];
            expect(parseCardData({ id: "5m", kind: "jarvis-answered", author: "jarvis", text: "", ts: 0, data: JSON.stringify(rest) } as ChannelMessage)).toBeNull();
        }
    });
    it("returns null when options is not an array", () => {
        const data = JSON.stringify({ askORef: "block:a", question: "q", options: "x" });
        expect(parseCardData({ id: "5o", kind: "jarvis-answered", author: "jarvis", text: "", ts: 0, data } as ChannelMessage)).toBeNull();
    });
    it("reads every field of a full payload", () => {
        const data = JSON.stringify({
            askORef: "block:a",
            askId: "ask1",
            workerORef: "tab:w",
            question: "q",
            options: [{ label: "x", sub: "s" }],
            choice: 0,
            humanPick: 1,
            reason: "because",
        });
        expect(parseCardData({ id: "6", kind: "jarvis-answered", author: "jarvis", text: "", ts: 0, data } as ChannelMessage)).toStrictEqual({
            askORef: "block:a",
            askId: "ask1",
            workerORef: "tab:w",
            question: "q",
            options: [{ label: "x", sub: "s" }],
            choice: 0,
            humanPick: 1,
            reason: "because",
        });
    });
    it("defaults an absent optional field and drops a wrong-typed one", () => {
        const base = { askORef: "block:a", question: "q", options: [] };
        const defaulted = {
            askORef: "block:a",
            askId: undefined,
            workerORef: "",
            question: "q",
            options: [],
            choice: undefined,
            humanPick: undefined,
            reason: undefined,
        };
        const absent = JSON.stringify(base);
        expect(parseCardData({ id: "7", kind: "jarvis-answered", author: "jarvis", text: "", ts: 0, data: absent } as ChannelMessage)).toStrictEqual(defaulted);
        const wrong = JSON.stringify({ ...base, askId: 5, workerORef: 5, choice: "1", humanPick: "1", reason: 5 });
        expect(parseCardData({ id: "8", kind: "jarvis-answered", author: "jarvis", text: "", ts: 0, data: wrong } as ChannelMessage)).toStrictEqual(defaulted);
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
