import { describe, expect, it } from "vitest";
import {
    LIVE_LINGER_MS,
    LIVE_STALE_MS,
    awaitsOwnMessage,
    liveExpiresAt,
    liveFresh,
    liveTexts,
    narratesThinking,
    parseLiveReply,
    streamsLiveReply,
    tidyLiveText,
    withLiveReply,
    type LiveReply,
} from "./chatlive";
import type { ChatItem } from "./chatmodel";

const reply = (over: Partial<LiveReply> = {}): LiveReply => ({
    turn: "t",
    step: 0,
    blocks: [{ index: 1, kind: "text", text: "Hello" }],
    done: false,
    at: 1000,
    ...over,
});

describe("streamsLiveReply", () => {
    it("is a Claude agent with a transcript", () => {
        expect(streamsLiveReply({ agent: "claude", transcriptPath: "/p/s.jsonl" })).toBe(true);
        expect(streamsLiveReply({ transcriptPath: "/p/s.jsonl" })).toBe(true);
        expect(streamsLiveReply({ agent: "pi", transcriptPath: "/p/s.jsonl" })).toBe(false);
        expect(streamsLiveReply({ agent: "claude" })).toBe(false);
    });
});

describe("parseLiveReply", () => {
    it("reads the mod's file", () => {
        const text = JSON.stringify({
            v: 1,
            turn: "turn-1",
            step: 2,
            blocks: [
                { index: 0, kind: "thinking", text: "Checking" },
                { index: 1, kind: "text", text: "Hi" },
                { index: 2, kind: "tool", text: "x" },
            ],
            done: true,
            at: 5,
        });
        expect(parseLiveReply(text)).toEqual({
            turn: "turn-1",
            step: 2,
            blocks: [
                { index: 0, kind: "thinking", text: "Checking" },
                { index: 1, kind: "text", text: "Hi" },
            ],
            done: true,
            at: 5,
        });
    });

    it("is null for no file, a half-written one or another shape", () => {
        expect(parseLiveReply("")).toBeNull();
        expect(parseLiveReply('{"blocks":[')).toBeNull();
        expect(parseLiveReply('{"at":1}')).toBeNull();
        expect(parseLiveReply("[]")).toBeNull();
    });
});

describe("liveFresh", () => {
    it("keeps a streaming reply until it has stood still LIVE_STALE_MS, a done one LIVE_LINGER_MS", () => {
        expect(liveFresh(reply(), 1000 + LIVE_STALE_MS - 1)).toBe(true);
        expect(liveFresh(reply(), 1000 + LIVE_STALE_MS)).toBe(false);
        expect(liveFresh(reply({ done: true }), 1000 + LIVE_LINGER_MS - 1)).toBe(true);
        expect(liveFresh(reply({ done: true }), 1000 + LIVE_LINGER_MS)).toBe(false);
        expect(liveExpiresAt(reply({ done: true }))).toBe(1000 + LIVE_LINGER_MS);
    });
});

describe("narratesThinking", () => {
    const L = (o: unknown) => JSON.stringify(o);
    it("reads the last assistant record that names its thinking display", () => {
        expect(
            narratesThinking([
                L({ type: "assistant", thinkingDisplay: "summarized" }),
                L({ type: "assistant", thinkingDisplay: "updates" }),
                L({ type: "user", message: { content: "hi" } }),
            ])
        ).toBe(true);
        expect(
            narratesThinking([
                L({ type: "assistant", thinkingDisplay: "updates" }),
                L({ type: "assistant", thinkingDisplay: "omitted" }),
            ])
        ).toBe(false);
    });

    it("is false when no record says", () => {
        expect(narratesThinking([])).toBe(false);
        expect(narratesThinking([L({ type: "assistant", message: {} }), '{"thinkingDisplay":']).valueOf()).toBe(false);
    });
});

describe("awaitsOwnMessage", () => {
    it("is true only for a plain message sent to an idle agent", () => {
        const base = { id: "1", text: "hi", sentAt: 0, seen: 0 };
        expect(awaitsOwnMessage([])).toBe(false);
        expect(awaitsOwnMessage([{ ...base, queued: true }])).toBe(false);
        expect(awaitsOwnMessage([{ ...base, kind: "btw" }])).toBe(false);
        expect(awaitsOwnMessage([{ ...base, queued: false }])).toBe(true);
        expect(awaitsOwnMessage([base])).toBe(true);
    });
});

describe("tidyLiveText", () => {
    it("leaves whole text alone", () => {
        expect(tidyLiveText("One ==two== three.\n\n```ts\nx\n```\nafter")).toBe(
            "One ==two== three.\n\n```ts\nx\n```\nafter"
        );
    });

    it("closes a code fence still open", () => {
        expect(tidyLiveText("Run this:\n```bash\nnpm test")).toBe("Run this:\n```bash\nnpm test\n```");
        expect(tidyLiveText("~~~\na\n")).toBe("~~~\na\n~~~");
    });

    it("leaves out an arc-visual block until it closes", () => {
        expect(tidyLiveText("Here it is:\n\n```arc-visual\n/Users/me/.arc/vis")).toBe("Here it is:");
    });

    it("drops a mark still open on the last line, keeping its text", () => {
        expect(tidyLiveText("Done. ==The fix is in")).toBe("Done. The fix is in");
        expect(tidyLiveText("==a== and ==b")).toBe("==a== and b");
        expect(tidyLiveText("==a==\nplain")).toBe("==a==\nplain");
    });
});

describe("liveTexts", () => {
    const r = reply({
        blocks: [
            { index: 0, kind: "thinking", text: "Checking the watcher" },
            { index: 1, kind: "text", text: "  " },
            { index: 2, kind: "text", text: "Done" },
        ],
    });
    it("draws text blocks, and thinking ones only where the session narrates in them", () => {
        expect(liveTexts(r, false)).toEqual(["Done"]);
        expect(liveTexts(r, true)).toEqual(["Checking the watcher", "Done"]);
        expect(liveTexts(null, true)).toEqual([]);
    });
});

describe("withLiveReply", () => {
    const you: ChatItem = { kind: "you", key: "you:0", text: "fix it" };
    const agent: ChatItem = {
        kind: "agent",
        key: "agent:1",
        parts: [{ kind: "prose", text: "Looking at ==the watcher== now.", uuid: "u1" }],
    };

    it("adds the texts the transcript does not hold to the last agent group", () => {
        const out = withLiveReply([you, agent], ["Looking at ==the watcher== now.", "Found it:\n```ts\nconst x"], 3);
        expect(out[1]).toEqual({
            kind: "agent",
            key: "agent:1",
            parts: [
                { kind: "prose", text: "Looking at ==the watcher== now.", uuid: "u1" },
                { kind: "prose", text: "Found it:\n```ts\nconst x\n```", live: true },
            ],
        });
    });

    it("counts a text as held whatever its marks and whitespace", () => {
        const stored: ChatItem = {
            kind: "agent",
            key: "agent:1",
            parts: [{ kind: "prose", text: "Looking at the watcher now.\n" }],
        };
        const items = [you, stored];
        expect(withLiveReply(items, ["Looking at ==the watcher==  now."], 3)).toBe(items);
    });

    it("opens a group of its own after your message, keyed as the transcript's will be", () => {
        expect(withLiveReply([you], ["Hi"], 1)).toEqual([
            you,
            { kind: "agent", key: "agent:1", parts: [{ kind: "prose", text: "Hi", live: true }] },
        ]);
    });

    it("returns the items as they were with nothing to add", () => {
        const items = [you];
        expect(withLiveReply(items, [], 1)).toBe(items);
    });
});
