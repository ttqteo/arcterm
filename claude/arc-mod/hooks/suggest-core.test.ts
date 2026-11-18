import { describe, expect, it } from "vitest";
import { beginPayload, endArgs, parseBegin, recentPrompts, wantsSuggest, type Row } from "./suggest-core";

describe("recentPrompts", () => {
    it("keeps the person's typed messages, oldest first, on one line each", () => {
        const rows: Row[] = [
            { role: "user", text: "first" },
            { role: "assistant", text: "ok" },
            { role: "user", text: "second\n  line" },
            { role: "user", text: "" },
            { role: "user", text: "<command-name>/clear</command-name>" },
            { role: "user", text: "  <task-notification>done</task-notification>" },
            { role: "user", text: "look at this\n\nAttached images:\n- a.png" },
        ];
        expect(recentPrompts(rows)).toEqual(["first", "second line", "look at this"]);
    });

    it("keeps only the last n", () => {
        const rows: Row[] = ["a", "b", "c", "d"].map((text) => ({ role: "user", text }));
        expect(recentPrompts(rows, 2)).toEqual(["c", "d"]);
    });
});

describe("wantsSuggest", () => {
    const answered = { reason: "answer", answer: "Done. Run the tests?" };

    it("is the main loop's answer in an arcterm block outside a run's tree", () => {
        expect(wantsSuggest(answered, true, false)).toBe(true);
    });

    it("is not outside arcterm, in a run's tree, a subagent's, an interrupted or an empty turn", () => {
        expect(wantsSuggest(answered, false, false)).toBe(false);
        expect(wantsSuggest(answered, true, true)).toBe(false);
        expect(wantsSuggest({ ...answered, agentId: "a1" }, true, false)).toBe(false);
        expect(wantsSuggest({ ...answered, reason: "aborted" }, true, false)).toBe(false);
        expect(wantsSuggest({ ...answered, reason: "error" }, true, false)).toBe(false);
        expect(wantsSuggest({ ...answered, answer: "  \n" }, true, false)).toBe(false);
    });
});

describe("parseBegin", () => {
    it("reads begin's JSON line", () => {
        expect(parseBegin('{"key":"k1","system":"S","prompt":"P"}\n')).toEqual({ key: "k1", system: "S", prompt: "P" });
    });

    it("is null for anything else", () => {
        expect(parseBegin("")).toBeNull();
        expect(parseBegin("error: no block")).toBeNull();
        expect(parseBegin('{"key":"","system":"S","prompt":"P"}')).toBeNull();
        expect(parseBegin('{"key":"k","system":1,"prompt":"P"}')).toBeNull();
        expect(parseBegin("null")).toBeNull();
    });
});

describe("wsh arguments", () => {
    it("writes begin's stdin and end's flags", () => {
        expect(JSON.parse(beginPayload("A or B?", ["x"]))).toEqual({ reply: "A or B?", recent: ["x"] });
        expect(endArgs("k1", false)).toEqual(["chatsuggest", "end", "--key", "k1"]);
        expect(endArgs("k1", true)).toEqual(["chatsuggest", "end", "--key", "k1", "--failed"]);
    });
});
