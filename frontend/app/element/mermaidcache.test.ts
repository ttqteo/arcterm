import { describe, expect, it } from "vitest";
import { chartKey, freshIds, keptSizes, normalizeChart, reservedHeight, withSize } from "./mermaidcache";

describe("normalizeChart", () => {
    it("turns <br> into newlines, CRLF into LF, and drops the final newlines", () => {
        expect(normalizeChart("graph TD<br/>A-->B<br>C\r\nD\r\n\n")).toBe("graph TD\nA-->B\nC\nD");
    });
});

describe("chartKey", () => {
    it("is the same for the same chart and differs for another", () => {
        expect(chartKey("graph TD\nA-->B")).toBe(chartKey("graph TD\nA-->B"));
        expect(chartKey("graph TD\nA-->B")).not.toBe(chartKey("graph TD\nA-->C"));
        expect(chartKey("x")).toMatch(/^[0-9a-f]{8}:1$/);
    });
});

describe("reservedHeight", () => {
    it("is the drawn height at the box's width: the natural width when the box is wider, the box's when narrower", () => {
        const size = { w: 800, r: 0.5 };
        expect(reservedHeight(size, 1000)).toBe(400);
        expect(reservedHeight(size, 600)).toBe(300);
    });

    it("is none for a box with no width yet, or a size that cannot be right", () => {
        expect(reservedHeight({ w: 800, r: 0.5 }, 0)).toBeNull();
        expect(reservedHeight({ w: 0, r: 0.5 }, 600)).toBeNull();
        expect(reservedHeight({ w: 800, r: Number.NaN }, 600)).toBeNull();
    });
});

describe("freshIds", () => {
    it("renames every use of the drawing's id, its styles and its arrowheads too", () => {
        const html =
            '<svg id="mermaid-1"><style>#mermaid-1 .node{}</style><path marker-end="url(#mermaid-1_end)"/></svg>';
        expect(freshIds(html, "mermaid-1", "mermaid-c7")).toBe(
            '<svg id="mermaid-c7"><style>#mermaid-c7 .node{}</style><path marker-end="url(#mermaid-c7_end)"/></svg>'
        );
    });

    it("leaves a drawing with no id as it is", () => {
        expect(freshIds("<svg></svg>", "", "mermaid-c7")).toBe("<svg></svg>");
    });
});

describe("withSize", () => {
    it("keeps the newest size last and drops the oldest past the cap", () => {
        let sizes = withSize({}, "a", { w: 1, r: 1 }, 2);
        sizes = withSize(sizes, "b", { w: 2, r: 1 }, 2);
        sizes = withSize(sizes, "a", { w: 3, r: 1 }, 2);
        expect(Object.keys(sizes)).toEqual(["b", "a"]);
        sizes = withSize(sizes, "c", { w: 4, r: 1 }, 2);
        expect(sizes).toEqual({ a: { w: 3, r: 1 }, c: { w: 4, r: 1 } });
    });
});

describe("keptSizes", () => {
    it("reads the stored sizes, and nothing from text that is not them", () => {
        expect(keptSizes('{"k":{"w":800,"r":0.5}}')).toEqual({ k: { w: 800, r: 0.5 } });
        expect(keptSizes('{"k":{"w":"800","r":0.5},"j":3}')).toEqual({});
        expect(keptSizes("not json")).toEqual({});
        expect(keptSizes(null)).toEqual({});
        expect(keptSizes("[1]")).toEqual({});
    });
});
