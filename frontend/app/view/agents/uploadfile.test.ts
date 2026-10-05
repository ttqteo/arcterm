import { describe, expect, it } from "vitest";
import { AGENT_DRAG_MIME } from "./griddrop";
import {
    checkUploadFile,
    collectDroppedFiles,
    isFileDrag,
    MAX_UPLOAD_BYTES,
    MAX_UPLOAD_LABEL,
    rejectionToast,
    sanitizeFileName,
    thumbSize,
    UploadError,
    type DropItemLike,
} from "./uploadfile";

const file = (name: string, size = 10, type = "text/plain") => new File([new Uint8Array(size)], name, { type });

// isDirectory undefined: a webview without the entry API
function item(f: File | null, isDirectory?: boolean): DropItemLike {
    return {
        kind: "file",
        getAsFile: () => f,
        webkitGetAsEntry: isDirectory === undefined ? undefined : () => ({ isDirectory, name: f?.name ?? "" }),
    };
}

describe("the cap", () => {
    it("stays inside the websocket message limit once base64 encoded", () => {
        // ws.ts drops a message over 5 MiB, and the bytes go out as base64 (4/3) inside a JSON envelope
        const base64Bytes = Math.ceil(MAX_UPLOAD_BYTES / 3) * 4;
        expect(base64Bytes + 4096).toBeLessThan(5 * 1024 * 1024);
    });
    it("is named as 3.5 MB", () => {
        expect(MAX_UPLOAD_LABEL).toBe("3.5 MB");
    });
});

describe("checkUploadFile", () => {
    it("takes a file up to the cap", () => {
        expect(checkUploadFile({ size: 0 })).toBeNull();
        expect(checkUploadFile({ size: MAX_UPLOAD_BYTES })).toBeNull();
    });
    it("refuses one byte over", () => {
        expect(checkUploadFile({ size: MAX_UPLOAD_BYTES + 1 })).toBe("too-large");
    });
});

describe("UploadError", () => {
    it("carries the code and the file, with a message that names both", () => {
        const e = new UploadError("too-large", "big.bin");
        expect(e).toBeInstanceOf(Error);
        expect(e.code).toBe("too-large");
        expect(e.fileName).toBe("big.bin");
        expect(e.message).toBe("big.bin is over 3.5 MB");
        expect(new UploadError("directory", "src").message).toBe("src is a folder");
        const failed = new UploadError("error", "a.txt");
        expect(failed.code).toBe("error");
        expect(failed.message).toBe("could not copy a.txt to a temporary file");
    });
});

describe("sanitizeFileName", () => {
    it("keeps an ordinary name, spaces included", () => {
        expect(sanitizeFileName("notes with space.txt")).toBe("notes with space.txt");
    });
    it("drops any directory part", () => {
        expect(sanitizeFileName("a/b\\c.png")).toBe("c.png");
        expect(sanitizeFileName("C:\\Users\\me\\d.png")).toBe("d.png");
    });
    it("replaces what Windows refuses", () => {
        expect(sanitizeFileName("we:ird*name?.txt")).toBe("we_ird_name_.txt");
        expect(sanitizeFileName("tab\there.txt")).toBe("tab_here.txt");
        expect(sanitizeFileName("del\x7fhere.txt")).toBe("del_here.txt");
    });
    it("trims trailing dots and spaces and falls back when nothing is left", () => {
        expect(sanitizeFileName("x. ")).toBe("x");
        expect(sanitizeFileName("x . ")).toBe("x");
        expect(sanitizeFileName(" .. ")).toBe("file");
        expect(sanitizeFileName("...")).toBe("file");
        expect(sanitizeFileName("")).toBe("file");
    });
    it("keeps a leading dot and non-ASCII letters", () => {
        expect(sanitizeFileName(".gitignore")).toBe(".gitignore");
        expect(sanitizeFileName("résumé 日本語.pdf")).toBe("résumé 日本語.pdf");
    });
    it("moves a Windows device name out of the way", () => {
        expect(sanitizeFileName("CON.txt")).toBe("_CON.txt");
        expect(sanitizeFileName("nul")).toBe("_nul");
        expect(sanitizeFileName("COM1.txt")).toBe("_COM1.txt");
        expect(sanitizeFileName("lpt9")).toBe("_lpt9");
        expect(sanitizeFileName("console.txt")).toBe("console.txt");
        expect(sanitizeFileName("com10.txt")).toBe("com10.txt");
        expect(sanitizeFileName("com0.txt")).toBe("com0.txt");
    });
    it("shortens a long name but keeps its extension", () => {
        const out = sanitizeFileName(`${"a".repeat(300)}.pdf`);
        expect(out.length).toBe(120);
        expect(out.endsWith(".pdf")).toBe(true);
    });
    it("shortens a long name with no extension", () => {
        expect(sanitizeFileName("a".repeat(300))).toBe("a".repeat(120));
    });
    it("does not leave a dot or a space where the cut falls before the extension", () => {
        expect(sanitizeFileName(`${"a".repeat(115)}. ${"b".repeat(10)}.pdf`)).toBe(`${"a".repeat(115)}.pdf`);
        expect(sanitizeFileName(`${"a".repeat(115)}  ${"b".repeat(10)}.pdf`)).toBe(`${"a".repeat(115)}.pdf`);
    });
    it("cuts by code point, never inside a surrogate pair", () => {
        const emoji = "\u{1F600}";
        const out = sanitizeFileName(`${emoji.repeat(130)}.png`);
        expect(out).toBe(`${emoji.repeat(116)}.png`);
        expect(Array.from(out)).toHaveLength(120);
        // a name that is already short enough is not cut, however many UTF-16 units it takes
        expect(sanitizeFileName(emoji.repeat(100))).toBe(emoji.repeat(100));
    });
});

describe("isFileDrag", () => {
    it("is true for an OS file drag", () => {
        expect(isFileDrag(["Files"])).toBe(true);
    });
    it("is false for a drag with no files", () => {
        expect(isFileDrag(["text/plain"])).toBe(false);
        expect(isFileDrag([])).toBe(false);
    });
    it("is false when the drag is an agent row, whatever else rides with it", () => {
        expect(isFileDrag([AGENT_DRAG_MIME])).toBe(false);
        expect(isFileDrag(["Files", AGENT_DRAG_MIME])).toBe(false);
    });
});

describe("collectDroppedFiles", () => {
    it("takes plain files and ignores string items", () => {
        const a = file("a.txt");
        const dropped = collectDroppedFiles([item(a, false), { kind: "string", getAsFile: () => null }], [a]);
        expect(dropped.files).toEqual([a]);
        expect(dropped.rejected).toEqual([]);
    });
    it("refuses a folder by its entry and names it", () => {
        const dropped = collectDroppedFiles([item(file("src", 0, ""), true)], []);
        expect(dropped.files).toEqual([]);
        expect(dropped.rejected).toEqual([{ name: "src", code: "directory" }]);
    });
    it("takes an empty regular file when the entry says it is not a folder", () => {
        const empty = file("empty.txt", 0, "");
        expect(collectDroppedFiles([item(empty, false)], []).files).toEqual([empty]);
    });
    it("refuses a file over the cap", () => {
        const big = file("big.bin", MAX_UPLOAD_BYTES + 1, "application/octet-stream");
        const dropped = collectDroppedFiles([item(big, false)], []);
        expect(dropped.rejected).toEqual([{ name: "big.bin", code: "too-large" }]);
    });
    it("keeps the good files of a mixed drop", () => {
        const a = file("a.txt");
        const dropped = collectDroppedFiles([item(file("dir", 0, ""), true), item(a, false)], []);
        expect(dropped.files).toEqual([a]);
        expect(dropped.rejected).toHaveLength(1);
    });
    it("without the entry API, reads an empty typeless file as a folder", () => {
        const dropped = collectDroppedFiles([item(file("src", 0, ""))], []);
        expect(dropped.rejected).toEqual([{ name: "src", code: "directory" }]);
    });
    it("ignores a file item that has no file", () => {
        const dropped = collectDroppedFiles([item(null, false)], []);
        expect(dropped.files).toEqual([]);
        expect(dropped.rejected).toEqual([]);
    });
    it("names a folder by its entry when the item has no file", () => {
        const noFile: DropItemLike = {
            kind: "file",
            getAsFile: () => null,
            webkitGetAsEntry: () => ({ isDirectory: true, name: "src" }),
        };
        expect(collectDroppedFiles([noFile], []).rejected).toEqual([{ name: "src", code: "directory" }]);
    });
    it("treats an entry that is null like no entry API at all", () => {
        const noEntry = (f: File): DropItemLike => ({ kind: "file", getAsFile: () => f, webkitGetAsEntry: () => null });
        const real = file("a.txt");
        const dropped = collectDroppedFiles([noEntry(file("src", 0, "")), noEntry(real)], []);
        expect(dropped.files).toEqual([real]);
        expect(dropped.rejected).toEqual([{ name: "src", code: "directory" }]);
    });
    it("falls back to the file list when there are no items", () => {
        const a = file("a.txt");
        expect(collectDroppedFiles(null, [a]).files).toEqual([a]);
        expect(collectDroppedFiles([], [file("src", 0, "")]).rejected).toEqual([{ name: "src", code: "directory" }]);
    });
});

describe("rejectionToast", () => {
    it("says nothing when nothing was refused", () => {
        expect(rejectionToast([])).toBeNull();
    });
    it("names a single file and points at Attach for a big one", () => {
        const t = rejectionToast([{ name: "big.bin", code: "too-large" }]);
        expect(t?.title).toBe("Couldn't add “big.bin”");
        expect(t?.message).toContain("It's over 3.5 MB");
        expect(t?.message).toContain("+ Attach");
    });
    it("explains a folder", () => {
        expect(rejectionToast([{ name: "src", code: "directory" }])?.message).toContain("Folders can't be dropped");
    });
    it("explains a failed copy", () => {
        const t = rejectionToast([{ name: "a.txt", code: "error" }]);
        expect(t?.title).toBe("Couldn't add “a.txt”");
        expect(t?.message).toBe("Copying it to a temporary file failed.");
    });
    it("folds several refusals into one toast with the counts", () => {
        const t = rejectionToast([
            { name: "a", code: "too-large" },
            { name: "b", code: "too-large" },
            { name: "c", code: "directory" },
        ]);
        expect(t?.title).toBe("3 items weren't added");
        expect(t?.message).toContain("2 over 3.5 MB, 1 folder");
        expect(t?.message).toContain("+ Attach");
        expect(t?.message).toContain("Folders can't be dropped");
    });
    it("gives only the advice that fits what went wrong", () => {
        const folders = rejectionToast([
            { name: "a", code: "directory" },
            { name: "b", code: "directory" },
        ]);
        expect(folders?.message).toBe("2 folders. Folders can't be dropped.");
        const failed = rejectionToast([
            { name: "a", code: "error" },
            { name: "b", code: "error" },
        ]);
        expect(failed?.message).toBe("2 failed to copy.");
        const mixed = rejectionToast([
            { name: "a", code: "too-large" },
            { name: "b", code: "error" },
        ]);
        expect(mixed?.message).toBe("1 over 3.5 MB, 1 failed to copy. Use + Attach to insert large files by path.");
    });
});

describe("thumbSize", () => {
    it("scales the longer side to the maximum", () => {
        expect(thumbSize(960, 480)).toEqual({ width: 96, height: 48 });
        expect(thumbSize(480, 960)).toEqual({ width: 48, height: 96 });
    });
    it("never enlarges", () => {
        expect(thumbSize(50, 40)).toEqual({ width: 50, height: 40 });
    });
    it("keeps a sliver at least one pixel", () => {
        expect(thumbSize(10000, 1)).toEqual({ width: 96, height: 1 });
    });
    it("treats a missing size as one pixel", () => {
        expect(thumbSize(0, 10)).toEqual({ width: 1, height: 1 });
    });
});
