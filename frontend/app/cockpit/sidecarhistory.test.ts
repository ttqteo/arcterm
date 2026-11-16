// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it, vi } from "vitest";

const getTranscript = vi.fn();
vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: { GetAgentTranscriptCommand: (...a: any[]) => getTranscript(...a) },
}));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));

import { OLDER_FILE_LINES, olderFromMemory, readOlderFromFile } from "./sidecarhistory";
import type { SidecarMessage } from "./sidecartypes";

// rows r0 … r(n-1), oldest first
const rows = (n: number): SidecarMessage[] => Array.from({ length: n }, (_, i) => ({ say: `r${i}` }));
const says = (rs: SidecarMessage[]) => rs.map((r) => r.say);

// Claude-format transcript lines: the assistant's one-sentence answers and its tool calls
const L = (o: unknown) => JSON.stringify(o);
const reply = (text: string) => L({ type: "assistant", message: { content: [{ type: "text", text }] } });
const toolUse = (id: string, name: string, input: unknown) =>
    L({ type: "assistant", message: { content: [{ type: "tool_use", id, name, input }] } });
const toolResult = (id: string) =>
    L({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, is_error: false }] } });

// n replies, "say 0" … "say n-1", one line each
const replyLines = (n: number) => Array.from({ length: n }, (_, i) => reply(`say ${i}`));

const CLAUDE_PATH = "/home/u/.claude/projects/p/s.jsonl";

describe("olderFromMemory", () => {
    it("starts above the rows the snapshot shows when the cursor is null, and pages to the start", () => {
        const all = rows(25);
        // the snapshot holds r17..r24
        const first = olderFromMemory(all, 8, null, 10);
        expect(says(first.rows)).toEqual(says(all.slice(7, 17)));
        expect(first.next).toBe("m:7");
        const second = olderFromMemory(all, 8, first.next, 10);
        expect(says(second.rows)).toEqual(says(all.slice(0, 7)));
        expect(second.next).toBeNull();
    });

    it("answers rows oldest first and a next that is the index of the page's first row", () => {
        const all = rows(30);
        const page = olderFromMemory(all, 8, "m:20", 5);
        expect(says(page.rows)).toEqual(["r15", "r16", "r17", "r18", "r19"]);
        expect(page.next).toBe("m:15");
    });

    it("keeps a cursor valid while new rows arrive at the bottom (index from the start)", () => {
        const before = rows(25);
        const first = olderFromMemory(before, 8, null, 10);
        const grown = [...before, { say: "new0" }, { say: "new1" }, { say: "new2" }];
        const second = olderFromMemory(grown, 8, first.next, 10);
        expect(says(second.rows)).toEqual(says(before.slice(0, 7)));
        expect(second.next).toBeNull();
    });

    it("has nothing earlier when the agent holds no more rows than the tile shows", () => {
        expect(olderFromMemory(rows(8), 8, null, 10)).toEqual({ rows: [], next: null });
        expect(olderFromMemory(rows(3), 8, null, 10)).toEqual({ rows: [], next: null });
        expect(olderFromMemory([], 8, null, 10)).toEqual({ rows: [], next: null });
    });

    it("answers the last short page with next null, and a cursor at 0 with nothing", () => {
        expect(olderFromMemory(rows(20), 8, "m:4", 10)).toEqual({ rows: rows(4), next: null });
        expect(olderFromMemory(rows(20), 8, "m:0", 10)).toEqual({ rows: [], next: null });
    });

    it("answers nothing for a cursor past the end of what is held (the 4,000-line trim moved it)", () => {
        expect(olderFromMemory(rows(20), 8, "m:21", 10)).toEqual({ rows: [], next: null });
        expect(olderFromMemory(rows(20), 8, "m:9999999", 10)).toEqual({ rows: [], next: null });
        // a cursor at the end is still a page above the last row
        expect(says(olderFromMemory(rows(20), 8, "m:20", 2).rows)).toEqual(["r18", "r19"]);
    });

    it("answers nothing for a cursor that does not parse, or is a file cursor", () => {
        for (const bad of ["", "m:", "m:-1", "m:1.5", "m:abc", "m:07", "x:3", "f:3", "3", "m:1e3", " m:3"]) {
            expect(olderFromMemory(rows(20), 8, bad, 10)).toEqual({ rows: [], next: null });
        }
    });

    it("takes a count of 0 or one that is not a number as an empty page that keeps its place", () => {
        expect(olderFromMemory(rows(20), 8, "m:10", 0)).toEqual({ rows: [], next: "m:10" });
        expect(olderFromMemory(rows(20), 8, "m:10", Number.NaN)).toEqual({ rows: [], next: "m:10" });
    });

    it("never mutates what it was given", () => {
        const all = rows(20);
        const copy = structuredClone(all);
        olderFromMemory(all, 8, null, 10);
        expect(all).toEqual(copy);
    });
});

describe("readOlderFromFile", () => {
    beforeEach(() => {
        getTranscript.mockReset();
    });

    it("reads the tail window for a null cursor, with no before", async () => {
        getTranscript.mockResolvedValue({ lines: replyLines(3), start: 0, total: 3, end: 100 });
        const page = await readOlderFromFile(CLAUDE_PATH, "claude", null, []);
        expect(getTranscript).toHaveBeenCalledTimes(1);
        expect(getTranscript.mock.calls[0][1]).toEqual({ path: CLAUDE_PATH, maxlines: OLDER_FILE_LINES });
        expect(says(page.rows)).toEqual(["say 0", "say 1", "say 2"]);
        expect(page.next).toBeNull();
    });

    it("drops the rows already shown at the tail when it reads for null (compared by value)", async () => {
        getTranscript.mockResolvedValue({ lines: replyLines(6), start: 100, total: 106, end: 9000 });
        const shown: SidecarMessage[] = [{ say: "say 4" }, { say: "say 5" }];
        const page = await readOlderFromFile(CLAUDE_PATH, "claude", null, shown);
        expect(says(page.rows)).toEqual(["say 0", "say 1", "say 2", "say 3"]);
        // next comes from the answer's start, not from the rows that were dropped
        expect(page.next).toBe("f:100");
    });

    it("drops only the trailing rows that match, and compares the tool too", async () => {
        const lines = [reply("one"), reply("two"), toolUse("t1", "Bash", { command: "go test" }), toolResult("t1")];
        getTranscript.mockResolvedValue({ lines, start: 10, total: 14, end: 500 });
        // the tile's last row is "two" with its tool: the same row as the file's last
        const same = await readOlderFromFile(CLAUDE_PATH, "claude", null, [
            { say: "two", tool: { verb: "ran", target: "go test", outcome: "ok" } },
        ]);
        expect(says(same.rows)).toEqual(["one"]);
        // the same sentence with another outcome is another row: nothing is dropped
        const other = await readOlderFromFile(CLAUDE_PATH, "claude", null, [
            { say: "two", tool: { verb: "ran", target: "go test", outcome: "fail" } },
        ]);
        expect(says(other.rows)).toEqual(["one", "two"]);
        // rows that do not end the same way drop nothing
        const unrelated = await readOlderFromFile(CLAUDE_PATH, "claude", null, [{ say: "zzz" }]);
        expect(says(unrelated.rows)).toEqual(["one", "two"]);
    });

    it("answers an empty file with no rows and no next", async () => {
        getTranscript.mockResolvedValueOnce({ lines: [], start: 0, total: 0, end: 0 });
        expect(await readOlderFromFile(CLAUDE_PATH, "claude", null, [])).toEqual({ rows: [], next: null });
    });

    it("reads the window before a file cursor and takes next from the answer's start", async () => {
        getTranscript.mockResolvedValue({ lines: replyLines(400), start: 600, total: 5000, end: 99999 });
        const page = await readOlderFromFile(CLAUDE_PATH, "claude", "f:1000", []);
        expect(getTranscript.mock.calls[0][1]).toEqual({ path: CLAUDE_PATH, maxlines: OLDER_FILE_LINES, before: 1000 });
        expect(page.rows).toHaveLength(400);
        expect(page.next).toBe("f:600");
    });

    it("does not drop shown rows from a page read for a cursor", async () => {
        getTranscript.mockResolvedValue({ lines: replyLines(2), start: 10, total: 500, end: 9000 });
        const page = await readOlderFromFile(CLAUDE_PATH, "claude", "f:12", [{ say: "say 1" }]);
        expect(says(page.rows)).toEqual(["say 0", "say 1"]);
    });

    it("has next null at the start of the file", async () => {
        getTranscript.mockResolvedValue({ lines: replyLines(3), start: 0, total: 800, end: 9000 });
        const page = await readOlderFromFile(CLAUDE_PATH, "claude", "f:3", []);
        expect(page.next).toBeNull();
        expect(page.rows).toHaveLength(3);
    });

    it("answers nothing, without reading, for a cursor that does not parse, is 0, or is a memory cursor", async () => {
        for (const bad of ["", "f:", "f:-1", "f:2.5", "f:x", "f:0", "m:5", "5", "f:00"]) {
            expect(await readOlderFromFile(CLAUDE_PATH, "claude", bad, [])).toEqual({ rows: [], next: null });
        }
        expect(getTranscript).not.toHaveBeenCalled();
    });

    it("answers nothing for a cursor past the file's lines", async () => {
        // the file now holds 50 lines; the server clamps and answers its tail, which must not be taken for the page
        getTranscript.mockResolvedValue({ lines: replyLines(50), start: 0, total: 50, end: 4000 });
        expect(await readOlderFromFile(CLAUDE_PATH, "claude", "f:900", [])).toEqual({ rows: [], next: null });
    });

    it("projects with the agent's own projector, falling back to the path", async () => {
        const codex = [
            L({
                type: "response_item",
                payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "from codex" }] },
            }),
        ];
        getTranscript.mockResolvedValue({ lines: codex, start: 0, total: 1, end: 10 });
        const page = await readOlderFromFile("/home/u/.codex/sessions/r.jsonl", "codex", "f:1", []);
        expect(says(page.rows)).toEqual(["from codex"]);
        // no agent known: the .claude path says claude, so a claude line reads as claude
        getTranscript.mockResolvedValue({ lines: [reply("from claude")], start: 0, total: 1, end: 10 });
        const byPath = await readOlderFromFile(CLAUDE_PATH, undefined, "f:1", []);
        expect(says(byPath.rows)).toEqual(["from claude"]);
    });

    it("rejects when the read fails, so the bridge decides what the page sees", async () => {
        getTranscript.mockRejectedValue(new Error("no transcript file yet at x"));
        await expect(readOlderFromFile(CLAUDE_PATH, "claude", null, [])).rejects.toThrow("no transcript file yet");
    });
});
