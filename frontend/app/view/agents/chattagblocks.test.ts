import { describe, expect, it } from "vitest";
import {
    foldCommandParts,
    lineCount,
    splitTagged,
    tagHeading,
    tagLabel,
    unwrapWholePaste,
    type TaggedPart,
    type TagPart,
} from "./chattagblocks";

const tag = (name: string, body: string, attrs: Record<string, string> = {}): TagPart => ({
    kind: "tag",
    tag: name,
    attrs,
    body,
});

describe("splitTagged", () => {
    it("keeps plain text as one text part", () => {
        expect(splitTagged("fix the bug\nin app.ts")).toEqual([{ kind: "text", text: "fix the bug\nin app.ts" }]);
    });

    it("keeps an empty message as one empty text part", () => {
        expect(splitTagged("")).toEqual([{ kind: "text", text: "" }]);
    });

    it("splits a block with attributes out of the text around it", () => {
        const msg =
            "see this\n<pasted_content id=\"a1b2\" kind='log'>\nline one\nline two\n</pasted_content>\nand fix it";
        expect(splitTagged(msg)).toEqual([
            { kind: "text", text: "see this" },
            tag("pasted_content", "line one\nline two", { id: "a1b2", kind: "log" }),
            { kind: "text", text: "and fix it" },
        ]);
    });

    it("splits a block that is the whole message", () => {
        expect(splitTagged("<system-reminder>\nbe brief\n</system-reminder>")).toEqual([
            tag("system-reminder", "be brief"),
        ]);
    });

    it("splits a block on one line", () => {
        expect(splitTagged("<command-name>/skim</command-name>")).toEqual([tag("command-name", "/skim")]);
    });

    it("trims only one leading and one trailing newline of the body", () => {
        expect(splitTagged("<note>\n\n  indented\n\n</note>")).toEqual([tag("note", "\n  indented\n")]);
    });

    it("keeps an attribute with no value", () => {
        expect(splitTagged("<note hidden>\nx\n</note>")).toEqual([tag("note", "x", { hidden: "" })]);
    });

    it("splits two blocks and the text between them", () => {
        const msg = "<a>\none\n</a>\nmiddle\n<b>\ntwo\n</b>";
        expect(splitTagged(msg)).toEqual([tag("a", "one"), { kind: "text", text: "middle" }, tag("b", "two")]);
    });

    it("drops the blank text between two blocks", () => {
        expect(splitTagged("<a>\none\n</a>\n\n<b>\ntwo\n</b>")).toEqual([tag("a", "one"), tag("b", "two")]);
    });

    it("splits only the outer block of one nested in another's body", () => {
        const msg = "<outer>\nbefore\n<inner>\ndeep\n</inner>\nafter\n</outer>";
        expect(splitTagged(msg)).toEqual([tag("outer", "before\n<inner>\ndeep\n</inner>\nafter")]);
    });

    it("pairs a block of the same name nested in its body with the outer close", () => {
        const msg = "<a>\nx\n<a>\ny\n</a>\nz\n</a>\ntail";
        expect(splitTagged(msg)).toEqual([tag("a", "x\n<a>\ny\n</a>\nz"), { kind: "text", text: "tail" }]);
    });

    it("closes a block whose close tag carries attributes, as Claude Code writes a paste's", () => {
        const msg = 'see\n<pasted_content id="cdd1">\nline one\n</pasted_content id="cdd1">\nafter';
        expect(splitTagged(msg)).toEqual([
            { kind: "text", text: "see" },
            tag("pasted_content", "line one", { id: "cdd1" }),
            { kind: "text", text: "after" },
        ]);
        expect(splitTagged('<pasted_content id="x">one line</pasted_content id="x">')).toEqual([
            tag("pasted_content", "one line", { id: "x" }),
        ]);
    });

    it("leaves an unclosed tag as text", () => {
        const msg = "<pasted_content>\nnever closed";
        expect(splitTagged(msg)).toEqual([{ kind: "text", text: msg }]);
    });

    it("still finds a later block after an unclosed tag", () => {
        expect(splitTagged("<open>\nx\n<b>\ny\n</b>")).toEqual([{ kind: "text", text: "<open>\nx" }, tag("b", "y")]);
    });

    it("leaves a tag that does not start a line as text", () => {
        const msg = "look at <b>\nthis\n</b>";
        expect(splitTagged(msg)).toEqual([{ kind: "text", text: msg }]);
    });

    it("leaves a closing tag of another name as text", () => {
        const msg = "<a>\nx\n</b>";
        expect(splitTagged(msg)).toEqual([{ kind: "text", text: msg }]);
    });

    it("leaves a block inside a fence as text", () => {
        const msg = "example:\n```xml\n<a>\nx\n</a>\n```\ndone";
        expect(splitTagged(msg)).toEqual([{ kind: "text", text: msg }]);
    });

    it("splits a block after a fence has closed", () => {
        expect(splitTagged("```\ncode\n```\n<a>\nx\n</a>")).toEqual([
            { kind: "text", text: "```\ncode\n```" },
            tag("a", "x"),
        ]);
    });

    it("never splits a task-notification", () => {
        const msg = "<task-notification>\n<status>done</status>\n</task-notification>";
        expect(splitTagged(msg)).toEqual([{ kind: "text", text: msg }]);
    });

    it("leaves a name that is too long or starts with a digit as text", () => {
        const long = `<${"a".repeat(65)}>\nx\n</${"a".repeat(65)}>`;
        expect(splitTagged(long)).toEqual([{ kind: "text", text: long }]);
        expect(splitTagged("<1a>\nx\n</1a>")).toEqual([{ kind: "text", text: "<1a>\nx\n</1a>" }]);
    });

    it("reads a CRLF message", () => {
        expect(splitTagged("hi\r\n<a>\r\nx\r\n</a>\r\nbye")).toEqual([
            { kind: "text", text: "hi" },
            tag("a", "x"),
            { kind: "text", text: "bye" },
        ]);
    });
});

describe("unwrapWholePaste", () => {
    it("reads a message that is one paste block as the paste", () => {
        expect(unwrapWholePaste('<pasted_content id="cdd1">\nfix it\nplease\n</pasted_content id="cdd1">')).toBe(
            "fix it\nplease"
        );
    });

    it("leaves a paste beside text you typed, another tag, and plain text as they came", () => {
        for (const msg of [
            "look at this\n<pasted_content>\nlog\n</pasted_content>",
            "<system-reminder>\nbe brief\n</system-reminder>",
            "<pasted_content>\nnever closed",
            "fix the bug",
        ]) {
            expect(unwrapWholePaste(msg)).toBe(msg);
        }
    });
});

describe("tagLabel", () => {
    it("names the tags it knows", () => {
        expect(tagLabel("pasted_content")).toBe("Pasted");
        expect(tagLabel("system-reminder")).toBe("System reminder");
        expect(tagLabel("local-command-stdout")).toBe("Command output");
        expect(tagLabel("local-command-caveat")).toBe("Note");
        expect(tagLabel("command-name")).toBe("Command");
    });

    it("capitalises the words of any other tag", () => {
        expect(tagLabel("foo_bar-baz")).toBe("Foo bar baz");
        expect(tagLabel("note")).toBe("Note");
    });
});

describe("lineCount", () => {
    it("counts lines", () => {
        expect(lineCount("")).toBe(0);
        expect(lineCount("one")).toBe(1);
        expect(lineCount("one\ntwo\nthree")).toBe(3);
        expect(lineCount("one\r\ntwo")).toBe(2);
        expect(lineCount("one\n\nthree")).toBe(3);
    });

    it("does not count the newline that ends the last line", () => {
        expect(lineCount("one\ntwo\n")).toBe(2);
    });
});

describe("tagHeading", () => {
    it("adds the line count to a paste", () => {
        expect(tagHeading(tag("pasted_content", "a\nb\nc"))).toBe("Pasted · 3 lines");
        expect(tagHeading(tag("pasted_content", "a"))).toBe("Pasted · 1 line");
    });

    it("names any other block by its label", () => {
        expect(tagHeading(tag("system-reminder", "a\nb"))).toBe("System reminder");
    });

    it("uses the label a folded command carries", () => {
        expect(tagHeading({ ...tag("command-name", "skim"), label: "/skim fast" })).toBe("/skim fast");
    });
});

describe("foldCommandParts", () => {
    it("leaves parts with no command block as they are", () => {
        const parts: TaggedPart[] = [{ kind: "text", text: "hi" }, tag("pasted_content", "x")];
        expect(foldCommandParts(parts)).toEqual(parts);
    });

    it("folds a command's blocks into one card labelled with the command", () => {
        const parts = splitTagged(
            "<command-message>skim</command-message>\n<command-name>/skim</command-name>\n<command-args>fast</command-args>"
        );
        expect(foldCommandParts(parts)).toEqual([{ ...tag("command-name", "skim"), label: "/skim fast" }]);
    });

    it("adds the slash a name came without and leaves out empty args", () => {
        const parts = [tag("command-name", "simplify"), tag("command-message", "simplify"), tag("command-args", " ")];
        expect(foldCommandParts(parts)).toEqual([{ ...tag("command-name", "simplify"), label: "/simplify" }]);
    });

    it("keeps the text around the command", () => {
        const parts: TaggedPart[] = [
            { kind: "text", text: "before" },
            tag("command-name", "/x"),
            { kind: "text", text: "after" },
        ];
        expect(foldCommandParts(parts)).toEqual([
            { kind: "text", text: "before" },
            { ...tag("command-name", ""), label: "/x" },
            { kind: "text", text: "after" },
        ]);
    });

    it("leaves a message or args block with no name block alone", () => {
        const parts = [tag("command-message", "x"), tag("command-args", "y")];
        expect(foldCommandParts(parts)).toEqual(parts);
    });

    it("folds each command of two in a row on its own", () => {
        const parts = [
            tag("command-name", "/a"),
            tag("command-args", "1"),
            tag("command-name", "/b"),
            tag("command-args", "2"),
        ];
        expect(foldCommandParts(parts)).toEqual([
            { ...tag("command-name", ""), label: "/a 1" },
            { ...tag("command-name", ""), label: "/b 2" },
        ]);
    });
});
