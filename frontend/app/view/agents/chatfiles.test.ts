import { describe, expect, it } from "vitest";
import { CARD_LIMIT, fileTag, foldCards, splitAttachments } from "./chatfiles";
import { FILES_HEADER, messageWithAttachments, type Attachment } from "./composerattachments";

const att = (name: string, kind: Attachment["kind"], path: string): Attachment => ({
    id: name,
    name,
    kind,
    status: "ready",
    path,
});

describe("splitAttachments", () => {
    it("leaves a message with only text whole", () => {
        expect(splitAttachments("fix the bug")).toEqual({ text: "fix the bug", files: [], images: [] });
    });

    it("reads an empty message as nothing", () => {
        expect(splitAttachments("")).toEqual({ text: "", files: [], images: [] });
    });

    it("reads a trailing files block", () => {
        const msg = `look\n\n${FILES_HEADER}\n- /a/err.log\n- C:\\a\\notes.md`;
        expect(splitAttachments(msg)).toEqual({ text: "look", files: ["/a/err.log", "C:\\a\\notes.md"], images: [] });
    });

    it("reads a trailing images block", () => {
        const msg = "look\n\nAttached images:\n- /a/shot.png\n- C:\\a\\two.png";
        expect(splitAttachments(msg)).toEqual({ text: "look", files: [], images: ["/a/shot.png", "C:\\a\\two.png"] });
    });

    it("reads the images block of a message Claude Code wrapped whole as a paste", () => {
        // a Chat message queued while the agent worked, as the transcript's queued_command holds it
        const msg =
            '<pasted_content id="cdd1">\nhiển thị đẹp hơn\n\nAttached images:\n- /a/shot.png\n</pasted_content id="cdd1">';
        expect(splitAttachments(msg)).toEqual({ text: "hiển thị đẹp hơn", files: [], images: ["/a/shot.png"] });
    });

    it("reads both blocks, the files block first and the images block last", () => {
        const msg = `look\n\n${FILES_HEADER}\n- /a/err.log\n\nAttached images:\n- /a/shot.png`;
        expect(splitAttachments(msg)).toEqual({ text: "look", files: ["/a/err.log"], images: ["/a/shot.png"] });
    });

    it("reads what messageWithAttachments writes", () => {
        const msg = messageWithAttachments("look", [
            att("err.log", "file", "/a/err.log"),
            att("shot.png", "image", "/a/shot.png"),
            att("b.tex", "file", "C:\\a\\b.tex"),
        ]);
        expect(splitAttachments(msg)).toEqual({
            text: "look",
            files: ["/a/err.log", "C:\\a\\b.tex"],
            images: ["/a/shot.png"],
        });
    });

    it("reads a message that is only its blocks", () => {
        const msg = `${FILES_HEADER}\n- /a/err.log\n\nAttached images:\n- /a/shot.png`;
        expect(splitAttachments(msg)).toEqual({ text: "", files: ["/a/err.log"], images: ["/a/shot.png"] });
    });

    it("reads a CRLF message", () => {
        const msg = `look\r\n\r\n${FILES_HEADER}\r\n- /a/err.log\r\n`;
        expect(splitAttachments(msg)).toEqual({ text: "look", files: ["/a/err.log"], images: [] });
    });

    it("leaves a files block whose lines are not absolute paths as text", () => {
        const msg = `look\n\n${FILES_HEADER}\n- /a/err.log\n- notes.md`;
        expect(splitAttachments(msg)).toEqual({ text: msg, files: [], images: [] });
    });

    it("leaves a files header with no lines under it as text", () => {
        const msg = `look\n\n${FILES_HEADER}`;
        expect(splitAttachments(msg)).toEqual({ text: msg, files: [], images: [] });
    });

    it("leaves a list that has no files header as text", () => {
        const msg = "things to do\n\n- /a/one\n- /a/two";
        expect(splitAttachments(msg)).toEqual({ text: msg, files: [], images: [] });
    });

    it("leaves a files block that is not the end of the message as text", () => {
        const msg = `${FILES_HEADER}\n- /a/err.log\n\nand then some words`;
        expect(splitAttachments(msg)).toEqual({ text: msg, files: [], images: [] });
    });

    it("keeps the text of a message with an unreadable images block whole", () => {
        const msg = `look\n\n${FILES_HEADER}\n- /a/err.log\n\nAttached images:\n- shot.png`;
        expect(splitAttachments(msg)).toEqual({ text: msg, files: [], images: [] });
    });
});

describe("fileTag", () => {
    it("tags a pdf", () => {
        expect(fileTag("paper.pdf")).toEqual({ tag: "PDF", tone: "pdf" });
    });

    it("tags source and markup files as code", () => {
        expect(fileTag("related.tex")).toEqual({ tag: "TEX", tone: "code" });
        expect(fileTag("chatfiles.ts")).toEqual({ tag: "TS", tone: "code" });
        expect(fileTag("config.json")).toEqual({ tag: "JSON", tone: "code" });
    });

    it("tags prose as doc", () => {
        expect(fileTag("README.md")).toEqual({ tag: "MD", tone: "doc" });
        expect(fileTag("notes.txt")).toEqual({ tag: "TXT", tone: "doc" });
    });

    it("tags tables as data", () => {
        expect(fileTag("results.csv")).toEqual({ tag: "CSV", tone: "data" });
    });

    it("tags a name with no extension as FILE", () => {
        expect(fileTag("Makefile")).toEqual({ tag: "FILE", tone: "other" });
        expect(fileTag(".gitignore")).toEqual({ tag: "FILE", tone: "other" });
        expect(fileTag("trailing.")).toEqual({ tag: "FILE", tone: "other" });
    });

    it("cuts a long extension to 4 letters and judges the tone by the whole one", () => {
        expect(fileTag("big.markdown")).toEqual({ tag: "MARK", tone: "other" });
        expect(fileTag("data.parquet")).toEqual({ tag: "PARQ", tone: "data" });
    });

    it("reads the extension from the last dot, in any case", () => {
        expect(fileTag("archive.tar.GZ")).toEqual({ tag: "GZ", tone: "other" });
        expect(fileTag("Paper.PDF")).toEqual({ tag: "PDF", tone: "pdf" });
    });
});

describe("foldCards", () => {
    const items = (n: number) => Array.from({ length: n }, (_, i) => i);

    it("shows every card under the limit", () => {
        expect(foldCards(items(3), false)).toEqual({ shown: [0, 1, 2], more: 0 });
    });

    it("shows every card at the limit", () => {
        expect(foldCards(items(CARD_LIMIT), false)).toEqual({ shown: items(CARD_LIMIT), more: 0 });
    });

    it("folds the cards past the limit into a count while closed", () => {
        expect(CARD_LIMIT).toBe(5);
        expect(foldCards(items(8), false)).toEqual({ shown: [0, 1, 2, 3, 4], more: 3 });
    });

    it("shows every card once open", () => {
        expect(foldCards(items(8), true)).toEqual({ shown: items(8), more: 0 });
    });

    it("shows nothing for nothing", () => {
        expect(foldCards([], false)).toEqual({ shown: [], more: 0 });
    });
});
