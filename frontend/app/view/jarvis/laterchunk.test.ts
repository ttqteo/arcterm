// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { savedBody } from "@/app/view/agents/chatsaveselection";
import { describe, expect, it } from "vitest";
import { isLater, laterChunkOp, planChunks, quotedPassage, uniqueLabel } from "./laterchunk";

describe("isLater", () => {
    it("is true only for a chunk carrying the mark", () => {
        expect(isLater({ later: true })).toBe(true);
        expect(isLater({ later: false })).toBe(false);
        expect(isLater({})).toBe(false);
    });
});

type Chunk = { label: string; later?: boolean };

describe("planChunks", () => {
    it("drops later chunks and keeps the plan's order", () => {
        const chunks: Chunk[] = [
            { label: "a" },
            { label: "b", later: true },
            { label: "c", later: false },
            { label: "d", later: true },
            { label: "e" },
        ];
        expect(planChunks(chunks).map((c) => c.label)).toEqual(["a", "c", "e"]);
    });

    it("returns every chunk when none is later, and none when all are", () => {
        const plain: Chunk[] = [{ label: "a" }, { label: "b" }];
        expect(planChunks(plain)).toHaveLength(2);
        expect(planChunks<Chunk>([{ label: "a", later: true }])).toEqual([]);
        expect(planChunks<Chunk>([])).toEqual([]);
    });

    it("keeps the caller's own chunk type", () => {
        const chunks: { label: string; status: string; later?: boolean }[] = [
            { label: "a", status: "pending" },
            { label: "b", status: "pending", later: true },
        ];
        expect(planChunks(chunks)[0].status).toBe("pending");
    });
});

describe("uniqueLabel", () => {
    it("keeps a label that nothing holds", () => {
        expect(uniqueLabel([], "Push DEV")).toBe("Push DEV");
        expect(uniqueLabel(["Other"], "Push DEV")).toBe("Push DEV");
    });

    it("adds (2) for one clash", () => {
        expect(uniqueLabel(["Push DEV"], "Push DEV")).toBe("Push DEV (2)");
    });

    it("adds (3) for two clashes, and goes on from the first free number", () => {
        expect(uniqueLabel(["Push DEV", "Push DEV (2)"], "Push DEV")).toBe("Push DEV (3)");
        expect(uniqueLabel(["Push DEV", "Push DEV (2)", "Push DEV (3)"], "Push DEV")).toBe("Push DEV (4)");
        // a gap is filled: (2) is free although (3) is taken
        expect(uniqueLabel(["Push DEV", "Push DEV (3)"], "Push DEV")).toBe("Push DEV (2)");
    });

    it("compares the label exactly", () => {
        expect(uniqueLabel(["push dev"], "Push DEV")).toBe("Push DEV");
    });
});

describe("laterChunkOp", () => {
    it("is an addChunk carrying the mark and the first note", () => {
        expect(laterChunkOp({ label: "Push DEV", note: "From agent, 2026-11-27\n\n> x" })).toEqual({
            op: "addChunk",
            label: "Push DEV",
            later: true,
            note: "From agent, 2026-11-27\n\n> x",
        });
    });

    it("carries the session, the conversation and the due when given", () => {
        expect(
            laterChunkOp({
                label: "Push DEV",
                note: "n",
                session: "agent:abc",
                conversation: "c-123",
                due: "2026-12-01",
            })
        ).toEqual({
            op: "addChunk",
            label: "Push DEV",
            later: true,
            note: "n",
            session: "agent:abc",
            conversation: "c-123",
            due: "2026-12-01",
        });
    });

    it("leaves out an empty session, conversation and due", () => {
        const op = laterChunkOp({ label: "x", note: "n", session: "", conversation: "", due: "" });
        expect("session" in op).toBe(false);
        expect("conversation" in op).toBe(false);
        expect("due" in op).toBe(false);
    });
});

describe("quotedPassage", () => {
    it("unquotes the > lines of a savedBody note", () => {
        const body = savedBody("First line\nsecond line", { agentId: "t1", name: "Parser" }, new Date(2026, 10, 27));
        expect(quotedPassage(body)).toBe("First line\nsecond line");
    });

    it("keeps a blank line between quoted paragraphs", () => {
        const body = savedBody("One\n\nTwo", { agentId: "t1", name: "" }, new Date(2026, 10, 27));
        expect(quotedPassage(body)).toBe("One\n\nTwo");
    });

    it("ignores the source line above the quote", () => {
        const body = savedBody("Only this", { agentId: "t1", name: "Parser" }, new Date(2026, 10, 27));
        expect(quotedPassage(body)).not.toContain("From agent");
    });

    it("is null for plain text with no quoted line", () => {
        expect(quotedPassage("Decide which parser takes the logs")).toBeNull();
        expect(quotedPassage("")).toBeNull();
        expect(quotedPassage("a > b\nc")).toBeNull();
    });

    it("is null when the quote holds only blank lines", () => {
        expect(quotedPassage("From agent, 2026-11-27\n\n>\n>")).toBeNull();
    });
});
