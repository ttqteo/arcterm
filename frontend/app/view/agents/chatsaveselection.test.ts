// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    LATER_SUBLABEL_TITLE_MAX,
    laterItem,
    laterSublabel,
    passageFirstLine,
    SAVED_TITLE_MAX,
    savedBody,
    selectionQuoteBlock,
    selectionTitle,
} from "./chatsaveselection";

describe("selectionTitle", () => {
    it("takes the first line's first sentence", () => {
        expect(selectionTitle("Retry the push on a 502. Then log it.\nmore")).toBe("Retry the push on a 502.");
    });

    it("skips leading blank lines and squashes spaces", () => {
        expect(selectionTitle("\n  \n  Cache   the   token  \n")).toBe("Cache the token");
    });

    it("does not end a sentence inside a version or a path", () => {
        expect(selectionTitle("Bump to v1.2 in pkg/x.go now")).toBe("Bump to v1.2 in pkg/x.go now");
    });

    it("cuts a long line at a word, under the cap, with an ellipsis", () => {
        const words = "the quick brown fox jumps over the lazy dog ".repeat(4);
        const t = selectionTitle(words);
        expect(t.length).toBeLessThanOrEqual(SAVED_TITLE_MAX);
        expect(t.endsWith("…")).toBe(true);
        expect(words.startsWith(t.slice(0, -1))).toBe(true);
        expect(t.slice(0, -1).endsWith(" ")).toBe(false);
    });

    it("cuts a long word where it must", () => {
        const t = selectionTitle("x".repeat(200));
        expect(t).toBe("x".repeat(SAVED_TITLE_MAX - 1) + "…");
    });

    it("stays under the stores' 200-byte cap in Vietnamese", () => {
        const t = selectionTitle("ữữữữữữữữữữ ".repeat(20));
        expect(new TextEncoder().encode(t).length).toBeLessThanOrEqual(200);
    });

    it("never cuts an emoji in half", () => {
        const t = selectionTitle("a".repeat(SAVED_TITLE_MAX - 2) + "😀😀😀");
        expect(t).toBe("a".repeat(SAVED_TITLE_MAX - 2) + "…");
    });

    it("is empty for a passage of spaces", () => {
        expect(selectionTitle(" \n\t ")).toBe("");
    });
});

describe("selectionQuoteBlock", () => {
    it("quotes each line and keeps one blank line between paragraphs", () => {
        expect(selectionQuoteBlock("\nfirst  line\nsecond\n\n\n\nthird\n\n")).toBe(
            "> first line\n> second\n>\n> third"
        );
    });

    it("reads CRLF line ends", () => {
        expect(selectionQuoteBlock("a\r\nb")).toBe("> a\n> b");
    });
});

describe("savedBody", () => {
    const now = new Date(2026, 10, 27, 9, 5);

    it("names the agent, its address and the day above the quote", () => {
        expect(savedBody("Retry the push.\nlater", { agentId: "t1", name: " loom " }, now)).toBe(
            'From agent "loom" (agent:t1), 2026-11-27\n\n> Retry the push.\n> later'
        );
    });

    it("leaves the name out when the agent has none", () => {
        expect(savedBody("x", { agentId: "t1", name: "" }, now)).toBe("From agent (agent:t1), 2026-11-27\n\n> x");
    });

    it("leaves the tab address out for a note, whose frontmatter holds the conversation", () => {
        expect(savedBody("x", { agentId: "t1", name: "loom" }, now, false)).toBe(
            'From agent "loom", 2026-11-27\n\n> x'
        );
        expect(savedBody("x", { agentId: "t1", name: "" }, now, false)).toBe("From agent, 2026-11-27\n\n> x");
    });
});

describe("laterItem", () => {
    const now = new Date(2026, 10, 27, 9, 5);
    const from = { agentId: "t1", name: "loom" };

    it("is the passage's title and its saved body", () => {
        expect(laterItem("Push DEV. Then check the branch.\nlater", from, undefined, now)).toEqual({
            label: "Push DEV.",
            note: 'From agent "loom" (agent:t1), 2026-11-27\n\n> Push DEV. Then check the branch.\n> later',
        });
    });

    it("leaves the tab address out when the conversation's id is kept on the note", () => {
        expect(laterItem("Push DEV", from, "quote-source", now).note).toBe(
            'From agent "loom", 2026-11-27\n\n> Push DEV'
        );
    });

    it("keeps the address for an empty conversation id", () => {
        expect(laterItem("Push DEV", from, "", now).note).toContain("(agent:t1)");
    });

    it("keeps a label the server can take after being numbered", () => {
        // uniqueLabel appends " (n)": the title is far below the 200-character limit
        expect(laterItem("x".repeat(500), from, undefined, now).label.length).toBeLessThanOrEqual(SAVED_TITLE_MAX);
    });
});

describe("passageFirstLine", () => {
    it("is the first line with its spaces squashed", () => {
        expect(passageFirstLine("\n  Decide   which parser\ntakes the logs")).toBe("Decide which parser");
    });

    it("is empty for a passage of spaces", () => {
        expect(passageFirstLine(" \n\t ")).toBe("");
    });

    it("cuts a long line under the limit with an ellipsis", () => {
        const line = passageFirstLine("word ".repeat(100), 40);
        expect(line.length).toBeLessThanOrEqual(40);
        expect(line.endsWith("…")).toBe(true);
    });

    it("never cuts an emoji in half", () => {
        expect(passageFirstLine("a".repeat(8) + "😀😀", 10)).toBe("a".repeat(8) + "…");
    });
});

describe("laterSublabel", () => {
    it("names the initiative an agent is linked to", () => {
        expect(laterSublabel(true, "SIEM-1759 parsers")).toBe("to SIEM-1759 parsers");
    });

    it("says so while a linked initiative's title is not known yet", () => {
        expect(laterSublabel(true, undefined)).toBe("to its initiative");
        expect(laterSublabel(true, "")).toBe("to its initiative");
    });

    it("cuts a long title at a word under the limit, with an ellipsis", () => {
        const s = laterSublabel(true, "Heavy job queue follow-ups for the vndev parsers and their audit logs") ?? "";
        expect(s.startsWith("to Heavy job queue follow-ups")).toBe(true);
        expect(s.endsWith("…")).toBe(true);
        expect(s.length).toBeLessThanOrEqual("to ".length + LATER_SUBLABEL_TITLE_MAX);
    });

    it("keeps a title of exactly the limit whole", () => {
        const title = "x".repeat(LATER_SUBLABEL_TITLE_MAX);
        expect(laterSublabel(true, title)).toBe(`to ${title}`);
    });

    it("squashes the spaces of a title", () => {
        expect(laterSublabel(true, "  SIEM-1759   parsers ")).toBe("to SIEM-1759 parsers");
    });

    it("is absent for an agent that is not linked: the click asks where", () => {
        expect(laterSublabel(false, "ignored")).toBeUndefined();
        expect(laterSublabel(false, undefined)).toBeUndefined();
    });
});
