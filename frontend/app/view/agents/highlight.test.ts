import { describe, expect, it } from "vitest";
import { highlightLine, isPlainLang } from "./highlight";

describe("highlightLine", () => {
    it("classifies keyword, ident, punctuation and string", () => {
        expect(highlightLine('const x = "hi";')).toEqual([
            { t: "const", cls: "text-syntax-keyword" },
            { t: " ", cls: "text-syntax-ident" },
            { t: "x", cls: "text-syntax-ident" },
            { t: " ", cls: "text-syntax-ident" },
            { t: "=", cls: "text-syntax-punct" },
            { t: " ", cls: "text-syntax-ident" },
            { t: '"hi"', cls: "text-syntax-string" },
            { t: ";", cls: "text-syntax-punct" },
        ]);
    });

    it("classifies numbers and line comments", () => {
        expect(highlightLine("return 42; // done")).toEqual([
            { t: "return", cls: "text-syntax-keyword" },
            { t: " ", cls: "text-syntax-ident" },
            { t: "42", cls: "text-syntax-number" },
            { t: ";", cls: "text-syntax-punct" },
            { t: " ", cls: "text-syntax-ident" },
            { t: "// done", cls: "text-syntax-comment" },
        ]);
    });

    it("never returns an empty token list (blank line yields one space)", () => {
        expect(highlightLine("")).toEqual([{ t: " ", cls: "text-syntax-ident" }]);
    });

    it("keeps a word with non-ASCII letters whole, not split into punctuation", () => {
        expect(highlightLine("Kiểm tra")).toEqual([
            { t: "Kiểm", cls: "text-syntax-ident" },
            { t: " ", cls: "text-syntax-ident" },
            { t: "tra", cls: "text-syntax-ident" },
        ]);
    });

    it("never drops a character (a digit glued to a letter used to vanish)", () => {
        for (const line of ["0x1F", "1st pass", "Ưu tiên 2: §res-why → L381"]) {
            expect(
                highlightLine(line)
                    .map((tk) => tk.t)
                    .join("")
            ).toBe(line);
        }
    });
});

describe("isPlainLang", () => {
    it("treats an untagged fence and the prose languages as plain text", () => {
        for (const lang of [undefined, "", "text", "txt", "plain", "plaintext", "md", "markdown", "Markdown"]) {
            expect(isPlainLang(lang), String(lang)).toBe(true);
        }
    });

    it("highlights a tagged code language", () => {
        for (const lang of ["ts", "go", "bash", "json"]) {
            expect(isPlainLang(lang), lang).toBe(false);
        }
    });
});
