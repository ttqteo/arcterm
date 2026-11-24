import { describe, expect, it } from "vitest";
import {
    byTime,
    changeText,
    countText,
    droppedRelationRows,
    failedFigureRows,
    figureRows,
    figureSections,
    limitText,
    percentText,
    reportLangOf,
    reportWords,
    sectionView,
    seriesLabels,
    todoRows,
    type ChangeView,
    type CompareView,
    type FailedFigureRow,
    type LimitView,
    type SeriesView,
    type StackBar,
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
        expect(figureRows(c).map((r) => [r.value, r.measures, r.ref])).toEqual([
            ["A", "cold start", "a.go:1"],
            ["D", "kích thước", "d.go:4"],
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

// the figures of council 5186f93c as Go relates them, with a group and an "of" a seat would now declare
const xjs = (): Council =>
    council({
        lang: "vi",
        figures: [
            figure({ value: "0.7059", ref: "r.json:57", group: "Tỉ lệ chặn", of: "170", share: 0.7059, rate: true }),
            figure({ value: "947", ref: "x.md:613", group: "Bản vá X.js", amount: 947 }),
            figure({ value: "135", ref: "x.md:46", group: "Bản vá X.js", of: "947", share: 135 / 947, amount: 135 }),
            figure({
                value: "94",
                ref: "x.md:614",
                group: "Bản vá X.js",
                of: "135",
                share: 94 / 135,
                amount: 94,
                refs: ["c.md:87"],
            }),
            figure({ value: "41", ref: "c.md:87", group: "Bản vá X.js", of: "135", share: 41 / 135, amount: 41 }),
            figure({ value: "170", ref: "r.json:55", group: "Tỉ lệ chặn", amount: 170 }),
            figure({
                value: "120/151 = 79,5%",
                ref: "p.html:566",
                group: "Tỉ lệ chặn",
                of: "151",
                share: 120 / 151,
                rate: true,
            }),
            figure({ value: "151", ref: "p.html:313", group: "Tỉ lệ chặn", amount: 151 }),
            figure({ value: "464", ref: "x.md:619", amount: 464 }),
            figure({ value: "7", cite: "wrong", group: "Tỉ lệ chặn" }),
        ],
    });

describe("figureSections", () => {
    it("splits the verified figures by group, the ungrouped last, each whole before its parts", () => {
        const got = figureSections(xjs()).map((s) => [s.name, s.rows.map((r) => r.value)]);
        expect(got).toEqual([
            ["Tỉ lệ chặn", ["170", "0.7059", "151", "120/151 = 79,5%"]],
            ["Bản vá X.js", ["947", "135", "94", "41"]],
            ["", ["464"]],
        ]);
    });

    it("is one unnamed section when no figure has a group, and none with no verified figure", () => {
        expect(figureSections(council({ figures: [figure({ value: "A" }), figure({ value: "B" })] }))).toEqual([
            { name: "", rows: expect.any(Array) },
        ]);
        expect(figureSections(council())).toEqual([]);
    });
});

describe("sectionView", () => {
    it("draws a count whole split into parts as one bar, a split part as its own parts, and what they leave", () => {
        const [, patches] = figureSections(xjs());
        const view = sectionView(patches, "vi");
        expect(view.loose).toEqual([]);
        expect(view.bars).toHaveLength(1);
        const bar = view.bars[0] as StackBar;
        expect(bar.kind).toBe("stack");
        expect(bar.whole.value).toBe("947");
        expect(bar.segments.map((s) => [s.label, s.depth])).toEqual([
            ["94", 1],
            ["41", 1],
            ["812 còn lại", -1],
        ]);
        expect(bar.segments[0].share).toBeCloseTo(94 / 947, 9);
        expect(bar.segments[2].share).toBeCloseTo(812 / 947, 9);
        expect(bar.subtotals).toEqual(["135 = 94 + 41"]);
        expect(bar.rows.map((r) => r.value)).toEqual(["947", "135", "94", "41"]);
    });

    it("draws each rate over its denominator, and lists the denominators as rows", () => {
        const [rates] = figureSections(xjs());
        const view = sectionView(rates, "vi");
        expect(view.bars.map((b) => (b.kind === "rate" ? [b.row.value, b.pct] : null))).toEqual([
            ["0.7059", "70,6% của 170"],
            ["120/151 = 79,5%", "79,5% của 151"],
        ]);
        expect(view.loose.map((r) => r.value)).toEqual(["170", "151"]);
    });

    it("leaves a figure with no relation as a row", () => {
        const [, , alone] = figureSections(xjs());
        expect(sectionView(alone, "en")).toEqual({
            name: "",
            bars: [],
            loose: [expect.objectContaining({ value: "464" })],
        });
    });

    it("leaves no rest when the parts cover the whole", () => {
        const c = council({
            figures: [
                figure({ value: "10", amount: 10 }),
                figure({ value: "4", of: "10", share: 0.4, amount: 4 }),
                figure({ value: "6", of: "10", share: 0.6, amount: 6 }),
            ],
        });
        const bar = sectionView(figureSections(c)[0], "en").bars[0] as StackBar;
        expect(bar.segments.map((s) => s.label)).toEqual(["4", "6"]);
        expect(bar.subtotals).toEqual([]);
    });
});

describe("percentText and countText", () => {
    it("writes the council's decimal mark", () => {
        expect(percentText(120 / 151, "vi")).toBe("79,5%");
        expect(percentText(120 / 151, "en")).toBe("79.5%");
        expect(percentText(0.7, "en")).toBe("70%");
        expect(countText(1248, "vi")).toBe("1.248");
        expect(countText(1248, "en")).toBe("1,248");
    });
});

describe("droppedRelationRows", () => {
    it("lists the verified figures whose relation Go dropped, with why", () => {
        const c = council({
            figures: [
                figure({ value: "94", relnote: "the whole 135 is not a checked figure" }),
                figure({ value: "5", cite: "wrong", relnote: "x" }),
                figure({ value: "6" }),
            ],
        });
        expect(droppedRelationRows(c)).toEqual([
            { value: "94", measures: "cold start", ref: "pkg/a.go:12", note: "the whole 135 is not a checked figure" },
        ]);
    });
});

// the four charts beside the bars: a change, a limit, a line over time and bars side by side, as Go relates them
const varied = (): Council =>
    council({
        lang: "vi",
        figures: [
            figure({ value: "70,6%", group: "Tỉ lệ", was: "79,5%", rate: true, level: 0.706 }),
            figure({ value: "79,5%", group: "Tỉ lệ", rate: true, level: 0.795 }),
            figure({ value: "1248 ms", group: "Thời gian", limit: "1000", breach: true, amount: 1248, level: 1248 }),
            figure({ value: "1000", group: "Thời gian", amount: 1000, level: 1000 }),
            figure({ value: "15", group: "Theo vòng", at: "vòng 2", unit: "ca", amount: 15, level: 15 }),
            figure({ value: "12", group: "Theo vòng", at: "vòng 1", unit: "ca", amount: 12, level: 12 }),
            figure({ value: "6", group: "Lớp lỗi", unit: "ca", amount: 6, level: 6 }),
            figure({ value: "18", group: "Lớp lỗi", unit: "ca", amount: 18, level: 18 }),
            figure({ value: "7", group: "Lớp lỗi", unit: "ca", amount: 7, level: 7 }),
            figure({ value: "3 s", group: "Lớp lỗi", unit: "s", amount: 3, level: 3 }),
        ],
    });

describe("sectionView's other charts", () => {
    const views = () => figureSections(varied()).map((s) => sectionView(s, "vi"));

    it("draws a figure and its earlier value as a change, in points for a rate", () => {
        const [rates] = views();
        expect(rates.loose).toEqual([]);
        expect(rates.bars).toEqual([
            expect.objectContaining({ kind: "change", delta: "−8,9 điểm", dir: "down", scale: 0.795 }),
        ]);
        const c = rates.bars[0] as ChangeView;
        expect([c.from.value, c.to.value]).toEqual(["79,5%", "70,6%"]);
    });

    it("draws a figure against its limit, with its side in words", () => {
        const [, time] = views();
        const bar = time.bars[0] as LimitView;
        expect(bar.kind).toBe("limit");
        expect(bar.text).toBe("vượt ngưỡng tối đa 1000");
        expect(bar.limit.value).toBe("1000");
        expect(bar.scale).toBeCloseTo(1248 * 1.15, 6);
        expect(time.loose).toEqual([]);
    });

    it("draws figures that say when they hold as a line, in time order", () => {
        const [, , rounds] = views();
        const line = rounds.bars[0] as SeriesView;
        expect(line.kind).toBe("series");
        expect(line.rows.map((r) => r.at)).toEqual(["vòng 1", "vòng 2"]);
        expect([line.min, line.max]).toEqual([12, 15]);
    });

    it("draws figures of one unit side by side, largest first, and leaves a lone unit as a row", () => {
        const [, , , classes] = views();
        const cmp = classes.bars[0] as CompareView;
        expect(cmp.kind).toBe("compare");
        expect(cmp.rows.map((r) => r.value)).toEqual(["18", "7", "6"]);
        expect(cmp.max).toBe(18);
        expect(classes.loose.map((r) => r.value)).toEqual(["3 s"]);
    });

    it("words a limit and a change in English too", () => {
        expect(changeText(20, false, "en")).toBe("+20");
        expect(changeText(-0.089, true, "en")).toBe("−8.9 pts");
        expect(limitText(figureRows(varied())[2], "en")).toBe("over the max 1000");
    });
});

describe("byTime", () => {
    const row = (at: string) => figureRows(council({ figures: [figure({ at })] }))[0];
    it("orders dates, then numbered rounds, else keeps the order", () => {
        expect(byTime([row("2026-11-20"), row("2026-11-03")]).map((r) => r.at)).toEqual(["2026-11-03", "2026-11-20"]);
        expect(byTime([row("v10"), row("v2")]).map((r) => r.at)).toEqual(["v2", "v10"]);
        expect(byTime([row("sau"), row("trước")]).map((r) => r.at)).toEqual(["sau", "trước"]);
    });
});

describe("seriesLabels", () => {
    it("labels every point up to six, and past that the first, the last and evenly spaced ones", () => {
        expect(seriesLabels(4)).toEqual([true, true, true, true]);
        const twelve = seriesLabels(12);
        expect(twelve[0]).toBe(true);
        expect(twelve[11]).toBe(true);
        expect(twelve.filter(Boolean).length).toBeLessThanOrEqual(7);
        // no two kept labels side by side
        expect(twelve.some((on, i) => on && twelve[i + 1])).toBe(false);
    });
});
