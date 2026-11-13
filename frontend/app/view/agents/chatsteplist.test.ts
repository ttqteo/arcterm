// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { ChatItem } from "./chatmodel";
import {
    lastStepsOf,
    parseSteps,
    placeStepLists,
    shownState,
    stepBlocksOf,
    stepKeys,
    stepsKey,
    stepsPartKey,
} from "./chatsteplist";

const block = (...lines: string[]) => ["```arc-steps", ...lines, "```"].join("\n");

const you = (n: number): ChatItem => ({ kind: "you", key: `you:${n}`, text: "do it" });
const agent = (n: number, ...texts: string[]): ChatItem => ({
    kind: "agent",
    key: `agent:${n}`,
    parts: texts.map((text) => ({ kind: "prose", text })),
});
const marker = (n: number): ChatItem => ({
    kind: "marker",
    key: `marker:${n}`,
    item: { kind: "compaction", index: n } as any,
});

describe("parseSteps", () => {
    it("reads each marker as its state and keeps the order", () => {
        expect(parseSteps("[x] Look\n[>] Find\n[ ] Propose")).toEqual([
            { text: "Look", state: "done" },
            { text: "Find", state: "working" },
            { text: "Propose", state: "pending" },
        ]);
    });

    it("skips a line that does not parse and trims the text", () => {
        expect(parseSteps("Steps:\n[x]   Look  \n[?] odd\n- [ ] bullet\n[ ]\n\n[>] Find\r\n")).toEqual([
            { text: "Look", state: "done" },
            { text: "Find", state: "working" },
        ]);
    });

    it("is empty when no line parses", () => {
        expect(parseSteps("just text\n")).toEqual([]);
        expect(parseSteps("")).toEqual([]);
    });
});

describe("stepsKey", () => {
    it("is the same for the same steps in the same states, and differs otherwise", () => {
        const a = parseSteps("[x] A\n[>] B");
        expect(stepsKey(a)).toBe(stepsKey(parseSteps("  [X] A\n[>] B  \nnoise")));
        expect(stepsKey(a)).not.toBe(stepsKey(parseSteps("[x] A\n[x] B")));
    });
});

describe("stepBlocksOf", () => {
    it("finds every top-level arc-steps fence, in order", () => {
        const text = `Plan:\n\n${block("[ ] A")}\n\nThen\n\n${block("[x] A")}\n`;
        expect(stepBlocksOf(text)).toEqual(["[ ] A", "[x] A"]);
    });

    it("skips other fences and a block quoted inside a longer fence", () => {
        const text = [
            "```ts",
            "```arc-steps",
            "```",
            "",
            "````",
            block("[ ] quoted"),
            "````",
            "~~~arc-steps",
            "[x] tilde",
            "~~~",
        ].join("\n");
        expect(stepBlocksOf(text)).toEqual(["[x] tilde"]);
    });

    it("counts a block left open, as one still being written", () => {
        expect(stepBlocksOf("```arc-steps\n[x] A\n[>] B")).toEqual(["[x] A\n[>] B"]);
    });

    it("finds nothing in a reply without the word", () => {
        expect(stepBlocksOf("```ts\nconst x = 1\n```")).toEqual([]);
    });
});

describe("lastStepsOf", () => {
    it("is the last block that lists a step, skipping an empty one after it", () => {
        expect(lastStepsOf(`${block("[ ] A")}\n${block("[x] A")}\n${block("nothing")}`)).toEqual([
            { text: "A", state: "done" },
        ]);
    });

    it("is null without a block that lists a step", () => {
        expect(lastStepsOf("no blocks")).toBeNull();
        expect(lastStepsOf(block("nothing"))).toBeNull();
    });
});

describe("placeStepLists", () => {
    it("draws a turn's list at its first block, showing its last, and hides the later blocks", () => {
        const items = [
            you(0),
            agent(1, `Start\n${block("[>] A", "[ ] B")}`, "between"),
            marker(5),
            agent(6, block("[x] A", "[>] B")),
        ];
        const out = placeStepLists(items, "working");
        expect(out.get(stepsPartKey("agent:1", 0))).toEqual({
            anchor: "[>] A\n[ ] B",
            steps: [
                { text: "A", state: "done" },
                { text: "B", state: "working" },
            ],
            phase: "live",
        });
        // a part with no block is not in the map; the later block's part draws nothing
        expect(out.has(stepsPartKey("agent:1", 1))).toBe(false);
        expect(out.get(stepsPartKey("agent:6", 0))).toBeNull();
    });

    it("keeps an earlier turn's list as it last was, and over, once you send another message", () => {
        const items = [you(0), agent(1, block("[x] A", "[>] B")), you(2), agent(3, block("[>] C"))];
        const out = placeStepLists(items, "working");
        expect(out.get(stepsPartKey("agent:1", 0))?.phase).toBe("over");
        expect(out.get(stepsPartKey("agent:3", 0))).toMatchObject({ anchor: "[>] C", phase: "live" });
    });

    it("ends the last turn's list when your message comes after it, before the agent writes a new one", () => {
        const out = placeStepLists([you(0), agent(1, block("[>] A")), you(2)], "working");
        expect(out.get(stepsPartKey("agent:1", 0))?.phase).toBe("over");
    });

    it("a prompt arcterm typed starts a turn, a /btw does not", () => {
        const sent: ChatItem = { kind: "sent", key: "sent:2", from: "run", header: "h", lines: [] };
        const btw: ChatItem = { kind: "you", key: "you:2", command: "/btw why", btw: { text: "because" } as any };
        expect(placeStepLists([agent(1, block("[>] A")), sent], "working").get("agent:1#0")?.phase).toBe("over");
        expect(placeStepLists([agent(1, block("[>] A")), btw], "working").get("agent:1#0")?.phase).toBe("live");
    });

    it("reads the agent's state into the last turn's phase", () => {
        const items = [you(0), agent(1, block("[>] A"))];
        expect(placeStepLists(items, "waiting").get("agent:1#0")?.phase).toBe("waiting");
        expect(placeStepLists(items, "idle").get("agent:1#0")?.phase).toBe("over");
    });

    it("skips a block that lists no step, so the next valid one anchors the list", () => {
        const items = [you(0), agent(1, block("nothing"), block("[ ] A"))];
        const out = placeStepLists(items, "working");
        expect(out.has("agent:1#0")).toBe(false);
        expect(out.get("agent:1#1")?.anchor).toBe("[ ] A");
    });

    it("anchors the list in the first part when two blocks share it", () => {
        const items = [you(0), agent(1, `${block("[ ] A")}\n${block("[x] A")}`)];
        const out = placeStepLists(items, "idle");
        expect(out.get("agent:1#0")).toEqual({ anchor: "[ ] A", steps: [{ text: "A", state: "done" }], phase: "over" });
    });
});

describe("shownState", () => {
    it("draws a [>] step of a turn that is over as not started, and leaves the rest", () => {
        expect(shownState("working", "over")).toBe("pending");
        expect(shownState("working", "waiting")).toBe("working");
        expect(shownState("working", "live")).toBe("working");
        expect(shownState("done", "over")).toBe("done");
    });
});

describe("stepKeys", () => {
    it("keys a step by its text, counting a repeat", () => {
        const keys = stepKeys(parseSteps("[x] A\n[ ] B\n[ ] A"));
        expect(keys[0]).toBe("A");
        expect(keys[1]).toBe("B");
        expect(new Set(keys).size).toBe(3);
    });
});
