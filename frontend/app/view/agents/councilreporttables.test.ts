import { describe, expect, it } from "vitest";
import {
    failedFigureRows,
    figureRows,
    reportLangOf,
    reportWords,
    todoRows,
    type FailedFigureRow,
} from "./councilreporttables";

const direction = (rank: number, extra: Partial<CouncilDirection> = {}): CouncilDirection => ({
    rank,
    title: `Title ${rank}`,
    reasoning: `Reasoning ${rank}. More of it.`,
    from: [],
    stances: {},
    agreed: true,
    ...extra,
});

const council = (extra: Partial<Council> = {}, directions: CouncilDirection[] = []): Council => ({
    id: "c1",
    project: "D:\\code\\arc",
    feature: "Rail apps",
    experts: [],
    state: "done",
    round: 3,
    summary: { text: "", directions, outcomes: {}, at: 1 },
    tokens: 0,
    calls: 0,
    created: 0,
    updated: 0,
    ...extra,
});

const figure = (extra: Partial<CouncilFigure> = {}): CouncilFigure => ({
    value: "1,248 ms",
    measures: "cold start",
    ref: "pkg/a.go:12",
    quote: "cold start 1,248 ms",
    cite: "ok",
    ...extra,
});

describe("reportLangOf", () => {
    it("reads the council's stored language", () => {
        expect(reportLangOf(council({ lang: "vi", question: "Which first?" }))).toBe("vi");
        expect(reportLangOf(council({ lang: "en", question: "Việc nào trước?" }))).toBe("en");
    });

    it("takes the question's language for a council with none, else the feature's (Go's councilLang)", () => {
        expect(reportLangOf(council({ lang: undefined, question: "Việc nào nên làm trước?" }))).toBe("vi");
        expect(reportLangOf(council({ lang: "", question: "Which first?", feature: "Thêm tập" }))).toBe("en");
        expect(reportLangOf(council({ lang: undefined, question: "  ", feature: "Thêm tập cá" }))).toBe("vi");
        expect(reportLangOf(council({ lang: undefined, question: undefined, feature: "Rail apps" }))).toBe("en");
    });
});

describe("reportWords", () => {
    it("has the .md's Vietnamese headings, columns and kind words", () => {
        const w = reportWords("vi");
        expect([w.todo, w.figures]).toEqual(["Việc cần làm", "Số liệu"]);
        expect([w.rank, w.task, w.why, w.files, w.kind]).toEqual(["#", "Việc", "Vì sao", "File đụng tới", "Loại"]);
        expect([w.value, w.measures, w.source]).toEqual(["Giá trị", "Đo gì", "Nguồn"]);
        expect(w.kinds).toEqual({ new: "việc mới", edit: "sửa chữ", decision: "quyết định" });
    });

    it("has the English ones", () => {
        const w = reportWords("en");
        expect([w.todo, w.figures]).toEqual(["To do", "Figures"]);
        expect([w.rank, w.task, w.why, w.files, w.kind]).toEqual(["#", "Task", "Why", "Files", "Kind"]);
        expect([w.value, w.measures, w.source]).toEqual(["Value", "Measures", "Source"]);
        expect(w.kinds).toEqual({ new: "new work", edit: "text edit", decision: "decision" });
    });
});

describe("todoRows", () => {
    it("is empty with no summary or no ranked direction", () => {
        expect(todoRows(council({ summary: undefined }))).toEqual([]);
        expect(todoRows(council())).toEqual([]);
    });

    it("numbers the rows by their place in the ranking, as the saved report's # column does, not by Direction.rank", () => {
        const rows = todoRows(council({}, [direction(7), direction(3), direction(5)]));
        expect(rows.map((r) => [r.rank, r.task])).toEqual([
            [1, "Title 3"],
            [2, "Title 5"],
            [3, "Title 7"],
        ]);
    });

    it("has a row per ranked direction in rank order, with the fields the coordinator wrote", () => {
        const c = council({ lang: "vi" }, [
            direction(2, { title: "B" }),
            direction(1, {
                title: "Move the pins",
                task: "Chuyển ghim sang settings",
                why: "Hồ sơ bị xoá thì mất ghim.",
                kind: "new",
                files: ["frontend/app/view/agents/railappsstore.ts", "pkg/wconfig/settingsconfig.go"],
            }),
        ]);
        const rows = todoRows(c);
        expect(rows.map((r) => r.rank)).toEqual([1, 2]);
        expect(rows[0]).toEqual({
            rank: 1,
            task: "Chuyển ghim sang settings",
            why: "Hồ sơ bị xoá thì mất ghim.",
            whyFallback: false,
            files: ["frontend/app/view/agents/railappsstore.ts", "pkg/wconfig/settingsconfig.go"],
            kindId: "new",
            kind: "việc mới",
        });
    });

    it("falls back for a direction with none of the new fields: the title, the reasoning's first sentence, no files, no kind", () => {
        const [row] = todoRows(council({}, [direction(1, { title: "Show asleep on the icon" })]));
        expect(row).toEqual({
            rank: 1,
            task: "Show asleep on the icon",
            why: "Reasoning 1.",
            whyFallback: true,
            files: [],
            kindId: null,
            kind: "",
        });
    });

    it("lets a Brainstorm take the first step for the task, and a Review keep the title", () => {
        const step = direction(1, { title: "An idea", firststep: "Try it on one screen" });
        expect(todoRows(council({ mode: "brainstorm" }, [step]))[0].task).toBe("Try it on one screen");
        expect(todoRows(council({ mode: "review" }, [step]))[0].task).toBe("An idea");
        // no first step: the title in both
        expect(todoRows(council({ mode: "brainstorm" }, [direction(1)]))[0].task).toBe("Title 1");
        // a written task wins over the first step
        expect(todoRows(council({ mode: "brainstorm" }, [{ ...step, task: "Do X" }]))[0].task).toBe("Do X");
    });

    it("reads a kind outside new / edit / decision as none", () => {
        const [row] = todoRows(council({}, [direction(1, { kind: "refactor" })]));
        expect(row.kindId).toBeNull();
        expect(row.kind).toBe("");
    });

    it("words the kind in the council's language", () => {
        const en = todoRows(
            council({ lang: "en" }, [direction(1, { kind: "edit" }), direction(2, { kind: "decision" })])
        );
        expect(en.map((r) => r.kind)).toEqual(["text edit", "decision"]);
        const vi = todoRows(
            council({ lang: "vi" }, [direction(1, { kind: "edit" }), direction(2, { kind: "decision" })])
        );
        expect(vi.map((r) => r.kind)).toEqual(["sửa chữ", "quyết định"]);
    });

    it("keeps a blank field on its fallback, and folds a cell's line breaks and spaces", () => {
        const [row] = todoRows(
            council({}, [
                direction(1, {
                    title: "T",
                    task: "  \n ",
                    why: "Because\n  of memory.",
                    files: ["  a.ts  ", "", "b.ts"],
                }),
            ])
        );
        expect(row.task).toBe("T");
        expect(row.why).toBe("Because of memory.");
        expect(row.files).toEqual(["a.ts", "b.ts"]);
    });

    it("cuts the reasoning's fallback at its first sentence once it is read as one line, at 160 characters", () => {
        const why = (reasoning: string) => todoRows(council({}, [direction(1, { reasoning })]))[0].why;
        expect(why("Why wait? Because of memory.")).toBe("Why wait?");
        // line breaks fold to spaces first (markdown.go's todoWhy: firstSentence(oneLine(reasoning)))
        expect(why("Sleep sooner,\nthen measure. And more.")).toBe("Sleep sooner, then measure.");
        expect(why("Sleep sooner:\n\n| a | b |")).toBe("Sleep sooner: | a | b |");
        expect(why("See pkg/services/idle.go:42 for it")).toBe("See pkg/services/idle.go:42 for it");
        expect(why("")).toBe("");
        const long = why("word ".repeat(60));
        expect([...long].length).toBeLessThanOrEqual(160);
        expect(long.endsWith("…")).toBe(true);
    });

    it("leaves out the ideas kept aside", () => {
        const c = council({}, [direction(1)]);
        c.summary!.kept = [direction(9, { title: "Kept" })];
        expect(todoRows(c).map((r) => r.rank)).toEqual([1]);
    });
});

describe("figureRows", () => {
    it("lists the figures Go verified and no others", () => {
        const c = council({
            figures: [
                figure({ value: "A", ref: "a.go:1" }),
                figure({ value: "B", cite: "wrong", citenote: "value not in the quote" }),
                figure({ value: "C", cite: undefined }),
                figure({ value: "D", ref: "d.go:4", measures: "kích thước" }),
            ],
        });
        expect(figureRows(c)).toEqual([
            { value: "A", measures: "cold start", ref: "a.go:1" },
            { value: "D", measures: "kích thước", ref: "d.go:4" },
        ]);
    });

    it("is empty with no figures", () => {
        expect(figureRows(council())).toEqual([]);
        expect(figureRows(council({ figures: [] }))).toEqual([]);
    });
});

describe("failedFigureRows", () => {
    it("lists every figure Go did not verify, with its note: the wrong ones with their reason, the rest as not checked", () => {
        const c = council({
            figures: [
                figure({ value: "A" }),
                figure({ value: "B", ref: "b.go:9", cite: "wrong", citenote: "value not in the quote" }),
                figure({ value: "C", cite: "wrong" }),
                figure({ value: "D", cite: undefined }),
                figure({ value: "E", cite: "", citenote: "  line\n 9 is odd " }),
            ],
        });
        const want: FailedFigureRow[] = [
            { value: "B", measures: "cold start", ref: "b.go:9", note: "value not in the quote" },
            { value: "C", measures: "cold start", ref: "pkg/a.go:12", note: "not checked" },
            { value: "D", measures: "cold start", ref: "pkg/a.go:12", note: "not checked" },
            { value: "E", measures: "cold start", ref: "pkg/a.go:12", note: "line 9 is odd" },
        ];
        expect(failedFigureRows(c)).toEqual(want);
    });

    it("is empty when every figure verified, or there are none", () => {
        expect(failedFigureRows(council({ figures: [figure()] }))).toEqual([]);
        expect(failedFigureRows(council())).toEqual([]);
    });
});
