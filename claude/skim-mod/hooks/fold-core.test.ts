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

    // a lead alone ("**Why:**") says nothing: the bench's criterion 1. a long sentence after it stays, cut only past
    // the sentence limit
    it("never leaves the lead alone, however long the sentence after it", () => {
        const next =
            "Ta đã thấy: harness tự sinh thua bản người dựng (HarnessDev), " + "tự cập nhật không bằng ".repeat(6);
        const item = `**Vì cái năng lực đó chưa chạy đủ tốt để đóng thành tool.** ${next}tốt hơn.`;
        expect(`**x** ${next}`.length).toBeGreaterThan(MAX_REASON_CHARS);
        expect(firstSentence(item)).toBe(`**Vì cái năng lực đó chưa chạy đủ tốt để đóng thành tool.** ${next}tốt hơn.`);
        const long = `**Why:** ${"word ".repeat(100).trim()}.`;
        const out = firstSentence(long);
        expect(out.startsWith("**Why:** word")).toBe(true);
        expect(out.endsWith("word…")).toBe(true);
    });

    it("is the lead alone only when nothing follows it", () => {
        expect(firstSentence("**Backend:**")).toBe("**Backend:**");
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

    it("keeps a heading over its first lines, and leaves out the tables and code under it", () => {
        const text = ["## Title", "", "```", "- not an item", "", "code", "```", "", "| a |", "", "Verdict.", "", "1. Item."].join(
            "\n"
        );
        expect(summary(text)).toBe("## Title\nVerdict.\n1. Item.");
    });

    it("keeps every section, a later one by its first sentence, a table-only one by its stub", () => {
        const text = [
            "Done.",
            "",
            "## Numbers",
            "| a | b |",
            "|---|---|",
            "| 1 | 2 |",
            "",
            "## Found not fixed",
            "The store test still fails on Windows. It is flaky.",
        ].join("\n");
        expect(summary(text)).toBe(
            ["Done.", "## Numbers", "(table · 1 row)", "## Found not fixed", "The store test still fails on Windows."].join(
                "\n"
            )
        );
    });

    it("keeps a later paragraph's caveat, and drops the rest of it", () => {
        const text = ["Shipped the picker.", "", "It reads well. I didn't run the tests myself. More."].join("\n");
        expect(summary(text)).toBe("Shipped the picker.\nI didn't run the tests myself.");
        expect(summary("Shipped.\n\nLưu ý: mình chưa chạy thử trên Mac.")).toBe("Shipped.\nLưu ý: mình chưa chạy thử trên Mac.");
    });

    it("takes the first line under an item that is only a label", () => {
        const text = ["Two parts changed.", "", "- **Backend:**", "  - A stuck cleanup stops. Quickly.", "- **Frontend:**", "  - The roster keeps its scroll."].join(
            "\n"
        );
        expect(summary(text)).toBe(
            ["Two parts changed.", "- **Backend:** A stuck cleanup stops.", "- **Frontend:** The roster keeps its scroll."].join("\n")
        );
    });

    it("keeps the sentence that leads into a list, and every option a colon points at", () => {
        const text = ["I read the log.", "", "Pick one:", "", "(a) Wait longer. Slow.", "(b) Run it apart.", "", "Nothing changed."].join(
            "\n"
        );
        expect(summary(text)).toBe("I read the log.\nPick one:\n(a) Wait longer.\n(b) Run it apart.");
    });

    it("shows a list one past the cap whole: a '… 1 more' line takes the line its item would", () => {
        const five = ["Verdict.", "", "- One.", "- Two.", "- Three.", "- Four.", "- Five. More words."].join("\n");
        expect(summary(five)).toBe(["Verdict.", "- One.", "- Two.", "- Three.", "- Four.", "- Five."].join("\n"));
    });

    it("keeps a numbered list's numbers, so a reply's 'type 2' still points at its item", () => {
        const text = [
            "There are five kinds.",
            "",
            "1. **Tool.** You build it.",
            "2. **Study.** You measure it.",
            "3. **Benchmark.** Others use it.",
            "4. **SoK.** You map a field.",
            "5. **Replication.** You rerun it.",
            "",
            "Type 2 is yours.",
        ].join("\n");
        expect(summary(text)).toBe(
            [
                "There are five kinds.",
                "1. **Tool.** You build it.",
                "2. **Study.** You measure it.",
                "3. **Benchmark.** Others use it.",
                "4. **SoK.** You map a field.",
                "5. **Replication.** You rerun it.",
            ].join("\n")
        );
        const seven = text.replace("You rerun it.", "You rerun it.\n6. Six.\n7. Seven.");
        expect(summary(seven).split("\n").slice(-2)).toEqual(["4. **SoK.** You map a field.", "- … 3 more"]);
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
            ["It is fixed. The button moved.", "- **One.** The marked one.", "You must rebuild to see it."].join("\n")
        );
    });

    // "You must rebuild" is a caveat claude did not mark: it stays beside the marks
    it("draws a mark inside the verdict once, with the verdict, and keeps a caveat it did not mark", () => {
        expect(summary(text, ["It is fixed."])).toBe("It is fixed. The button moved.\nYou must rebuild to see it.");
    });

    it("keeps an item's marks on one line, its lead given once", () => {
        expect(summary(text, ["**One.** First reason.", "The marked one."])).toBe(
            ["It is fixed. The button moved.", "- **One.** First reason. The marked one.", "You must rebuild to see it."].join(
                "\n"
            )
        );
    });

    it("keeps marks from several items as one list", () => {
        expect(summary(text, ["The marked one.", "Second reason.", "Three."])).toBe(
            [
                "It is fixed. The button moved.",
                "- **One.** The marked one.",
                "- **Two.** Second reason.",
                "- Three.",
                "You must rebuild to see it.",
            ].join("\n")
        );
    });

    it("keeps the reply's order when a marked list comes before the verdict", () => {
        expect(summary("- **A.** Item mark.\n- B.\n\nVerdict here. More.\n\nLast.", ["Item mark.", "More."])).toBe(
            "- **A.** Item mark.\nVerdict here. More."
        );
    });

    it("leaves out a mark it cannot find, and the code a fence holds", () => {
        const fenced = ["Verdict.", "", "```", "a mark in code", "```", "", "Later. Marked."].join("\n");
        expect(summary(fenced, ["a mark in code", "gone", "Marked."])).toBe("Verdict.\nMarked.");
    });

    it("keeps the options a marked sentence ending on a colon points at", () => {
        const text = ["Read the log.", "", "The decision is yours:", "", "- (a) Wait longer.", "- (b) Run it apart.", "", "Lean (b)."].join(
            "\n"
        );
        expect(summary(text, ["The decision is yours:", "Lean (b)."])).toBe(
            ["Read the log.", "The decision is yours:", "- (a) Wait longer.", "- (b) Run it apart.", "Lean (b)."].join("\n")
        );
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
                "Not tried on the real app.",
                "It closes arcterm and reopens the new build:",
                "```",
                "! task install",
                "```",
            ].join("\n")
        );
    });

    it("keeps a command on a line with no mark, in the reply's order", () => {
        const text = ["Verdict.", "", "Rebuild first. It takes a while.", "", "Then run `! task install` here."].join("\n");
        expect(summary(text, ["Rebuild first."])).toBe("Verdict.\nRebuild first.\n`! task install`");
    });

    it("keeps a command beside the marks of its line, once when a mark holds it", () => {
        const text = ["Verdict.", "", "Type `! task install` now. It closes arcterm. Or `! task dev`."].join("\n");
        expect(summary(text, ["Type `! task install` now.", "It closes arcterm."])).toBe(
            "Verdict.\nType `! task install` now. It closes arcterm. `! task dev`"
        );
    });

    it("never takes a command fence for the verdict", () => {
        const text = ["```", "! task install", "```", "", "Verdict.", "", "Marked."].join("\n");
        expect(summary(text, ["Marked."])).toBe("```\n! task install\n```\nVerdict.\nMarked.");
    });

    it("keeps the paragraph a verdict ending on a colon points at, which holds the answer", () => {
        const when = [
            'Launched it. Answering "when will it be done":',
            "",
            "**Estimate: overnight, done by morning.** It depends on two unknowns.",
            "",
            "- **Cases.** About 32 run.",
            "",
            "Leave the machine running. I will be told when it ends.",
        ].join("\n");
        expect(summary(when, ["Leave the machine running."])).toBe(
            [
                'Launched it. Answering "when will it be done":',
                "**Estimate: overnight, done by morning.** It depends on two unknowns.",
                "Leave the machine running.",
            ].join("\n")
        );
        expect(summary(when)).toBe(
            [
                'Launched it. Answering "when will it be done":',
                "**Estimate: overnight, done by morning.** It depends on two unknowns.",
                "- **Cases.** About 32 run.",
            ].join("\n")
        );
    });

    // a section with no mark keeps its first lines too: a marked reply folded down to its marks lost whole sections
    it("keeps a section's bold heading above its marks, once, and a section with no mark by its first lines", () => {
        const sections = [
            "Both are done.",
            "",
            "**Gap**",
            "- Dropped the padding.",
            "",
            "**Stack**",
            "- One card shows. It sits under the bar.",
            "- The list is not built.",
        ].join("\n");
        expect(summary(sections, ["One card shows.", "The list is not built."])).toBe(
            ["Both are done.", "**Gap**", "- Dropped the padding.", "**Stack**", "- One card shows.", "- The list is not built."].join(
                "\n"
            )
        );
    });

    it("keeps a markdown heading the same way, across the blank line after it", () => {
        const sections = ["Verdict.", "", "## Caveats", "", "Not tried in the app. Rest."].join("\n");
        expect(summary(sections, ["Not tried in the app."])).toBe("Verdict.\n## Caveats\nNot tried in the app.");
    });

    // layout draws marks in order and waits on one it cannot find, so the fold hands back only those it kept
    it("hands back the marks it kept, in the order they show", () => {
        expect(folded("- **A.** Item mark.\n- B.\n\nVerdict here. More.", ["gone", "Item mark.", "More."])).toEqual({
            text: "- **A.** Item mark.\nVerdict here. More.",
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
