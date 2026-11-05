import { describe, expect, it } from "vitest";
import { canFold, FOLD_LINES, firstSentence, MAX_OPENED, MAX_REASON_CHARS, summary, toggleOpened } from "./fold-core";

describe("canFold", () => {
    it("folds past the line limit only", () => {
        expect(canFold(Array(FOLD_LINES).fill("a").join("\n"))).toBe(false);
        expect(canFold(Array(FOLD_LINES + 1).fill("a").join("\n"))).toBe(true);
    });
});

describe("firstSentence", () => {
    it("keeps the bold lead and the sentence after it", () => {
        expect(firstSentence("**Worktree.** Two agents run apart. So files differ.")).toBe(
            "**Worktree.** Two agents run apart."
        );
    });

    it("cuts a long sentence with an ellipsis", () => {
        const out = firstSentence("x".repeat(400));
        expect(out.length).toBe(MAX_REASON_CHARS);
        expect(out.endsWith("…")).toBe(true);
    });
});

describe("summary", () => {
    it("is the verdict and the lead of each top reason", () => {
        const text = [
            "Keep it per agent. The Code surface covers projects.",
            "",
            "- **One.** First reason. More words.",
            "- **Two.** Second reason.",
            "- Three. Third.",
            "- Four.",
            "- Five.",
            "- Six.",
            "",
            "A closing paragraph.",
        ].join("\n");
        expect(summary(text)).toBe(
            [
                "Keep it per agent. The Code surface covers projects.",
                "",
                "- **One.** First reason.",
                "- **Two.** Second reason.",
                "- Three.",
                "- Four.",
                "- … 2 more",
            ].join("\n")
        );
    });

    it("is the verdict alone when there is no list", () => {
        expect(summary("First.\n\nSecond.")).toBe("First.");
    });

    it("skips headings, tables and code blocks", () => {
        const text = ["## Title", "", "```", "- not an item", "", "code", "```", "", "| a |", "", "Verdict.", "", "1. Item."].join(
            "\n"
        );
        expect(summary(text)).toBe("Verdict.\n\n- Item.");
    });

    it("is the list alone when the reply opens with it", () => {
        expect(summary("- One.\n- Two.")).toBe("- One.\n- Two.");
    });
});

describe("toggleOpened", () => {
    it("opens and closes a reply", () => {
        expect(toggleOpened([], "a")).toEqual(["a"]);
        expect(toggleOpened(["a", "b"], "a")).toEqual(["b"]);
    });

    it("keeps the newest opened only", () => {
        const many = Array.from({ length: MAX_OPENED }, (_, i) => String(i));
        const out = toggleOpened(many, "new");
        expect(out.length).toBe(MAX_OPENED);
        expect(out.at(-1)).toBe("new");
        expect(out[0]).toBe("1");
    });
});
