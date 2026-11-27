import { describe, expect, it } from "vitest";
import {
    matchPhrase,
    normalize,
    pointerShapes,
    pointPlan,
    rectsBounds,
    shapeLinkIds,
    shapeRects,
    splitPhrases,
} from "./boardpointers";

const elements = [
    { id: "f1", type: "frame", name: "Thiết kế 21/10: câu hỏi gốc" },
    { id: "f2", type: "frame", name: "Timeline liền mạch 21/10 – 27/11" },
    { id: "r1", type: "rectangle", frameId: "f1" },
    {
        id: "t1",
        type: "text",
        originalText: "23/10 M4: vòng thích\nnghi giữ 0 thay đổi",
        containerId: "r1",
        frameId: "f1",
    },
    { id: "d1", type: "diamond", frameId: "f1" },
    { id: "t2", type: "text", text: "23/10 Tín hiệu feedback quá yếu?", containerId: "d1", frameId: "f1" },
    { id: "r2", type: "rectangle", frameId: "f2" },
    { id: "t3", type: "text", text: "23/10 M4: vòng thích nghi giữ 0 thay đổi", containerId: "r2", frameId: "f2" },
    { id: "t4", type: "text", text: "Sửa tín hiệu, chạy lại vòng học", frameId: "f1" },
    { id: "t5", type: "text", text: "123/10 not a date", frameId: "f2" },
    { id: "gone", type: "text", text: "deleted words here", isDeleted: true },
];
const shapes = pointerShapes(elements);

describe("pointerShapes", () => {
    it("lists texts under their box, frames by title, and leaves deleted ones out", () => {
        expect(shapes.map((s) => s.id)).toEqual(["f1", "f2", "r1", "d1", "r2", "t4", "t5"]);
        expect(shapes.find((s) => s.id === "r1")?.norm).toBe("23/10 m4: vòng thích nghi giữ 0 thay đổi");
    });

    it("reads a long dash as a hyphen", () => {
        expect(normalize("21/10 – 27/11")).toBe("21/10 - 27/11");
    });
});

describe("matchPhrase", () => {
    it("finds a quoted phrase in a shape, case and line breaks aside", () => {
        expect(matchPhrase("Tín hiệu feedback quá yếu?", shapes)).toEqual(["d1"]);
        expect(matchPhrase("vòng thích nghi giữ 0", shapes)).toEqual(["r1", "r2"]);
    });

    it("finds a drawing by its title", () => {
        expect(matchPhrase("Timeline liền mạch 21/10 - 27/11", shapes)).toEqual(["f2"]);
    });

    it("finds a shape whose whole text sits in a longer phrase", () => {
        expect(matchPhrase('Không. Nhánh "Sửa tín hiệu, chạy lại vòng học" bị bỏ', shapes)).toEqual(["t4"]);
    });

    it("points a date at the shapes it starts, never at a frame or a longer number", () => {
        expect(matchPhrase("23/10", shapes)).toEqual(["r1", "d1", "r2"]);
        expect(matchPhrase("3/10", shapes)).toEqual([]);
        expect(matchPhrase("21/10", shapes)).toEqual([]);
    });

    it("leaves short phrases, part words and phrases too many shapes share", () => {
        expect(matchPhrase("M4", shapes)).toEqual([]);
        expect(matchPhrase("ín hiệu feedback", shapes)).toEqual([]);
        const many = pointerShapes(
            Array.from({ length: 6 }, (_, i) => ({ id: `x${i}`, type: "text", text: `shared words ${i}` }))
        );
        expect(matchPhrase("shared words", many)).toEqual([]);
    });
});

describe("splitPhrases", () => {
    it("splits out quoted phrases (quotes kept outside) and dates", () => {
        expect(splitPhrases('Thoi trên board ghi "Tín hiệu feedback quá yếu?" ngày 23/10.')).toEqual([
            { text: 'Thoi trên board ghi "' },
            { phrase: "Tín hiệu feedback quá yếu?" },
            { text: '" ngày ' },
            { phrase: "23/10" },
            { text: "." },
        ]);
    });

    it("keeps a date inside a quote whole in the quote, and reads curly quotes", () => {
        expect(splitPhrases("“Thiết kế 21/10” rồi")).toEqual([
            { text: "“" },
            { phrase: "Thiết kế 21/10" },
            { text: "” rồi" },
        ]);
    });

    it("is null for text with neither, and skips a fraction like 46/671", () => {
        expect(splitPhrases("không có gì")).toBeNull();
        expect(splitPhrases("46/671 ca")).toBeNull();
    });
});

describe("shapeLinkIds", () => {
    it("reads each id as the start of one shape's id", () => {
        expect(shapeLinkIds("#shape-r1", shapes)).toEqual(["r1"]);
        expect(shapeLinkIds("#shape-d1,t4", shapes)).toEqual(["d1", "t4"]);
    });

    it("leaves out an id that fits none or several, and reads another link as none", () => {
        expect(shapeLinkIds("#shape-zz,r", shapes)).toEqual([]);
        expect(shapeLinkIds("https://example.com", shapes)).toEqual([]);
        expect(shapeLinkIds(undefined, shapes)).toEqual([]);
    });
});

describe("pointPlan", () => {
    const order = ["f1", "f2"];

    it("stays on the drawing in view when it holds some, and steps on when pressed again", () => {
        expect(pointPlan(elements, order, ["r1", "d1", "r2"], "f2", false)).toEqual({ drawing: "f2", ids: ["r2"] });
        expect(pointPlan(elements, order, ["r1", "d1", "r2"], "f2", true)).toEqual({
            drawing: "f1",
            ids: ["r1", "d1"],
        });
    });

    it("goes to the drawing holding the most when none is in view", () => {
        expect(pointPlan(elements, order, ["r1", "d1", "r2"], null, false)).toEqual({
            drawing: "f1",
            ids: ["r1", "d1"],
        });
    });

    it("shows a frame as its own drawing, and is null when the shapes are gone", () => {
        expect(pointPlan(elements, order, ["f2"], "f1", false)).toEqual({ drawing: "f2", ids: ["f2"] });
        expect(pointPlan(elements, order, ["gone", "nope"], null, false)).toBeNull();
    });
});

describe("shapeRects and rectsBounds", () => {
    it("turns an arrow drawn leftward around, and boxes every shape", () => {
        const rects = shapeRects(
            [
                { id: "a", x: 10, y: 10, width: 20, height: 10 },
                { id: "arrow", x: 100, y: 50, width: -40, height: -20 },
                { id: "other", x: 0, y: 0, width: 5, height: 5 },
                { id: "gone", x: 0, y: 0, width: 5, height: 5, isDeleted: true },
            ],
            ["a", "arrow", "gone"]
        );
        expect(rects).toEqual([
            { id: "a", x: 10, y: 10, w: 20, h: 10 },
            { id: "arrow", x: 60, y: 30, w: 40, h: 20 },
        ]);
        expect(rectsBounds(rects)).toEqual({ minX: 10, minY: 10, maxX: 100, maxY: 50 });
        expect(rectsBounds([])).toBeNull();
    });
});
