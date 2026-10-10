import { describe, expect, it } from "vitest";
import { leadingMention, mentionRefusal, sendArgs, sendOutcome } from "./mention-core";

describe("leadingMention", () => {
    it("reads a leading @ and a short tab id as the target, the rest as the message", () => {
        expect(leadingMention("@3f2a91bc review this diff")).toEqual({ id: "3f2a91bc", body: "review this diff" });
    });

    it("takes a whole tab id, and keeps the message's lines", () => {
        expect(leadingMention("@3f2a91bc-1234-5678-9abc-def012345678 first\nsecond")).toEqual({
            id: "3f2a91bc-1234-5678-9abc-def012345678",
            body: "first\nsecond",
        });
    });

    it("lowercases the id, as tab ids are", () => {
        expect(leadingMention("@3F2A91BC hi")).toEqual({ id: "3f2a91bc", body: "hi" });
    });

    it("reads a mention with no message as an empty one", () => {
        expect(leadingMention("@3f2a91bc")).toEqual({ id: "3f2a91bc", body: "" });
        expect(leadingMention("@3f2a91bc  \n ")).toEqual({ id: "3f2a91bc", body: "" });
    });

    it.each([
        ["a file mention", "@src/foo.ts fix this"],
        ["a file name", "@README.md"],
        ["an id shorter than the list prints", "@3f2a91 hi"],
        ["an id with a file extension", "@3f2a91bc.txt hi"],
        ["a token that is not hex", "@3f2a91bg hi"],
        ["a mention that does not lead", "look at @3f2a91bc"],
        ["an address", "me@3f2a91bc hi"],
        ["nothing", ""],
    ])("leaves %s to the session", (_name, text) => {
        expect(leadingMention(text)).toBeNull();
    });
});

describe("mentionRefusal", () => {
    it("asks for the message when the mention has none", () => {
        expect(mentionRefusal({ id: "3f2a91bc", body: "" }, false)).toBe("arc: write the message after @3f2a91bc");
    });

    it("refuses a prompt carrying an image, which wsh agents send cannot carry", () => {
        expect(mentionRefusal({ id: "3f2a91bc", body: "look" }, true)).toBe(
            "arc: an @mention sends text only; take the image out and send again"
        );
    });

    it("lets a message of text through", () => {
        expect(mentionRefusal({ id: "3f2a91bc", body: "look" }, false)).toBeNull();
    });
});

describe("sendArgs", () => {
    it("passes the id and message after --, so a message starting with a dash is never a flag", () => {
        expect(sendArgs({ id: "3f2a91bc", body: "- one\n- two" })).toEqual([
            "agents",
            "send",
            "--",
            "3f2a91bc",
            "- one\n- two",
        ]);
    });
});

describe("sendOutcome", () => {
    it("shows wsh's first line once sent, and keeps the draft gone", () => {
        const stdout = "sent to 3f2a91bc: it started a turn\nread the answer with: wsh agents read 3f2a91bc\n";
        expect(sendOutcome("3f2a91bc", { exitCode: 0, stdout, stderr: "" })).toEqual({
            notice: "arc: sent to 3f2a91bc: it started a turn",
            refill: false,
        });
    });

    it("names the target when wsh printed nothing", () => {
        expect(sendOutcome("3f2a91bc", { exitCode: 0, stdout: "", stderr: "" })).toEqual({
            notice: "arc: sent to 3f2a91bc",
            refill: false,
        });
    });

    it("shows the server's reason on a failure, and puts the draft back", () => {
        const stderr = 'Error: tab "3f2a91bc" is not a live agent session; wsh agents list shows the live agents\n';
        expect(sendOutcome("3f2a91bc", { exitCode: 1, stdout: "", stderr })).toEqual({
            notice: 'arc: not sent to @3f2a91bc: tab "3f2a91bc" is not a live agent session; wsh agents list shows the live agents',
            refill: true,
        });
    });

    it("names the exit code when a failure printed nothing", () => {
        expect(sendOutcome("3f2a91bc", { exitCode: 2, stdout: "", stderr: "" })).toEqual({
            notice: "arc: not sent to @3f2a91bc: wsh exited 2",
            refill: true,
        });
    });
});
