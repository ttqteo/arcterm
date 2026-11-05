import { describe, expect, it } from "vitest";
import {
    canFold,
    endsOnQuestion,
    firstSentence,
    FOLD_LINES,
    folded,
    MAX_OPENED,
    MAX_REASON_CHARS,
    MAX_SENTENCE_CHARS,
    summary,
    toggleOpened,
} from "./fold-core";

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

    it("drops the sentence after the lead rather than cut it mid-word", () => {
        const next =
            "Ta đã thấy: harness tự sinh thua bản người dựng (HarnessDev), " + "tự cập nhật không bằng ".repeat(6);
        const item = `**Vì cái năng lực đó chưa chạy đủ tốt để đóng thành tool.** ${next}tốt hơn.`;
        expect(`**x** ${next}`.length).toBeGreaterThan(MAX_REASON_CHARS);
        expect(firstSentence(item)).toBe("**Vì cái năng lực đó chưa chạy đủ tốt để đóng thành tool.**");
    });

    it("keeps a long first sentence whole when it has no lead", () => {
        const sentence = `${"word ".repeat(40).trim()}.`;
        expect(sentence.length).toBeGreaterThan(MAX_REASON_CHARS);
        expect(firstSentence(`${sentence} Next one.`)).toBe(sentence);
    });

    it("cuts only a sentence past the sentence limit, at a space", () => {
        const out = firstSentence("word ".repeat(100));
        expect(out.length).toBeLessThanOrEqual(MAX_SENTENCE_CHARS);
        expect(out.endsWith("word…")).toBe(true);
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

describe("summary of a marked reply", () => {
    const text = [
        "It is fixed. The button moved.",
        "",
        "- **One.** First reason. The marked one.",
        "- **Two.** Second reason.",
        "- Three.",
        "",
        "A middle paragraph. You must rebuild to see it.",
        "",
        "A closing paragraph.",
    ].join("\n");

    it("is the verdict and the marked sentences, in place of the top reasons", () => {
        expect(summary(text, ["The marked one.", "You must rebuild to see it."])).toBe(
            ["It is fixed. The button moved.", "", "- **One.** The marked one.", "", "You must rebuild to see it."].join(
                "\n"
            )
        );
    });

    it("draws a mark inside the verdict once, with the verdict", () => {
        expect(summary(text, ["It is fixed."])).toBe("It is fixed. The button moved.");
    });

    it("keeps an item's marks on one line, its lead given once", () => {
        expect(summary(text, ["**One.** First reason.", "The marked one."])).toBe(
            ["It is fixed. The button moved.", "", "- **One.** First reason. The marked one."].join("\n")
        );
    });

    it("keeps marks from several items as one list", () => {
        expect(summary(text, ["The marked one.", "Second reason.", "Three."])).toBe(
            ["It is fixed. The button moved.", "", "- **One.** The marked one.", "- **Two.** Second reason.", "- Three."].join(
                "\n"
            )
        );
    });

    it("keeps the reply's order when a marked list comes before the verdict", () => {
        expect(summary("- **A.** Item mark.\n- B.\n\nVerdict here. More.\n\nLast.", ["Item mark.", "More."])).toBe(
            "- **A.** Item mark.\n\nVerdict here. More."
        );
    });

    it("leaves out a mark it cannot find, and the code a fence holds", () => {
        const fenced = ["Verdict.", "", "```", "a mark in code", "```", "", "Later. Marked."].join("\n");
        expect(summary(fenced, ["a mark in code", "gone", "Marked."])).toBe("Verdict.\n\nMarked.");
    });

    it("keeps a fence of commands for the person to type, which the mark before it points at", () => {
        const install = [
            "Built 1.0.3.",
            "",
            "Not tried on the real app. A note went to hand-checks.",
            "",
            "To install, type the command below. It closes arcterm and reopens the new build:",
            "",
            "```",
            "! task install",
            "```",
        ].join("\n");
        expect(summary(install, ["Not tried on the real app.", "It closes arcterm and reopens the new build:"])).toBe(
            [
                "Built 1.0.3.",
                "",
                "Not tried on the real app.",
                "",
                "It closes arcterm and reopens the new build:",
                "",
                "```",
                "! task install",
                "```",
            ].join("\n")
        );
    });

    it("keeps a command on a line with no mark, in the reply's order", () => {
        const text = ["Verdict.", "", "Rebuild first. It takes a while.", "", "Then run `! task install` here."].join("\n");
        expect(summary(text, ["Rebuild first."])).toBe("Verdict.\n\nRebuild first.\n\n`! task install`");
    });

    it("keeps a command beside the marks of its line, once when a mark holds it", () => {
        const text = ["Verdict.", "", "Type `! task install` now. It closes arcterm. Or `! task dev`."].join("\n");
        expect(summary(text, ["Type `! task install` now.", "It closes arcterm."])).toBe(
            "Verdict.\n\nType `! task install` now. It closes arcterm. `! task dev`"
        );
    });

    it("never takes a command fence for the verdict", () => {
        const text = ["```", "! task install", "```", "", "Verdict.", "", "Marked."].join("\n");
        expect(summary(text, ["Marked."])).toBe("```\n! task install\n```\n\nVerdict.\n\nMarked.");
    });

    // layout draws marks in order and waits on one it cannot find, so the fold hands back only those it kept
    it("hands back the marks it kept, in the order they show", () => {
        expect(folded("- **A.** Item mark.\n- B.\n\nVerdict here. More.", ["gone", "Item mark.", "More."])).toEqual({
            text: "- **A.** Item mark.\n\nVerdict here. More.",
            marks: ["Item mark.", "More."],
        });
    });

    it("hands back no marks for a reply with none", () => {
        expect(folded("First.\n\nSecond.", [])).toEqual({ text: "First.", marks: [] });
    });
});

describe("endsOnQuestion", () => {
    it("is true for a reply whose last line asks the person, marked or not", () => {
        expect(endsOnQuestion("Three ways.\n\n- **A.** One.\n- **B.** Two.\n\nWhich way: A or B?")).toBe(true);
        expect(endsOnQuestion("Done.\n\n**Commit it?**\n")).toBe(true);
        expect(endsOnQuestion("Done.\n\n- Push it too?")).toBe(true);
    });

    it("is false when the reply ends on a statement or in code", () => {
        expect(endsOnQuestion("Why did it fail? The cache.\n\nFixed now.")).toBe(false);
        expect(endsOnQuestion("Run it:\n\n```\nwhy?\n```")).toBe(false);
        expect(endsOnQuestion("")).toBe(false);
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
