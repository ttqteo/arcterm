import { describe, expect, it } from "vitest";
import {
    answersFor,
    askPayload,
    cardCanAsk,
    confirmMarked,
    openPicker,
    parseAskReply,
    pickOption,
    pickerReply,
    pickerRows,
    typeOther,
} from "./ask-core";

const color = { question: "Which color?", header: "Color", multiSelect: false, options: [{ label: "Red" }, { label: "Blue" }] };
const sizes = { question: "Which sizes?", header: "Sizes", multiSelect: true, options: [{ label: "S" }, { label: "M" }, { label: "L" }] };

describe("cardCanAsk", () => {
    it("takes choice questions with options", () => {
        expect(cardCanAsk([color, { ...sizes, kind: "choice" }])).toBe(true);
    });
    it("sends the whole call native when any question is text or number, or has no options", () => {
        expect(cardCanAsk([color, { question: "Name?", header: "Name", multiSelect: false, kind: "text", options: [] }])).toBe(false);
        expect(cardCanAsk([{ ...color, kind: "number" }])).toBe(false);
        expect(cardCanAsk([{ ...color, options: [] }])).toBe(false);
        expect(cardCanAsk([])).toBe(false);
    });
});

describe("askPayload", () => {
    it("is the questions container wsh ask reads, previews included", () => {
        const preview = "x".repeat(50000);
        const parsed = JSON.parse(askPayload([{ ...color, options: [{ label: "Red", description: "warm", preview }, { label: "Blue" }] }]));
        expect(parsed).toEqual({
            questions: [
                {
                    question: "Which color?",
                    header: "Color",
                    multiSelect: false,
                    options: [{ label: "Red", description: "warm", preview }, { label: "Blue" }],
                },
            ],
        });
    });
});

describe("parseAskReply", () => {
    it("reads the last JSON line", () => {
        expect(parseAskReply('noise\n{"answers":[{"selectedindexes":[1]}],"cancelled":false}\n')).toEqual({
            answers: [{ selectedindexes: [1] }],
            cancelled: false,
        });
    });
    it("reads a cancel with null answers", () => {
        expect(parseAskReply('{"answers":null,"cancelled":true}')).toEqual({ answers: [], cancelled: true });
    });
    it("is null when wsh printed nothing usable", () => {
        expect(parseAskReply("")).toBeNull();
        expect(parseAskReply("Error: timeout")).toBeNull();
        expect(parseAskReply('{"other":1}')).toBeNull();
    });
});

describe("band picker", () => {
    it("drops previews and starts on the first question", () => {
        const p = openPicker([{ ...color, options: [{ label: "Red", description: "warm", preview: "big" }, { label: "Blue" }] }], "pane");
        expect(p).toEqual({
            site: "pane",
            questions: [{ question: "Which color?", header: "Color", multiSelect: false, options: [{ label: "Red", description: "warm" }, { label: "Blue" }] }],
            index: 0,
            answers: [],
            marked: [],
        });
        expect(pickerReply(p)).toBeNull();
    });
    it("asks for rows enough for its tallest question", () => {
        expect(pickerRows(openPicker([color, sizes], "pane"))).toBe(8);
    });
    it("answers a single-select on the pick and replies after the last question", () => {
        let p = pickOption(openPicker([color, color], "band"), 1);
        expect(p.index).toBe(1);
        expect(pickerReply(p)).toBeNull();
        p = pickOption(p, 0);
        expect(pickerReply(p)).toEqual({ answers: [{ selectedindexes: [1] }, { selectedindexes: [0] }], cancelled: false });
    });
    it("toggles marks in a multi-select and answers on confirm, in option order", () => {
        let p = pickOption(pickOption(pickOption(openPicker([sizes], "band"), 2), 0), 1);
        p = pickOption(p, 1);
        expect(p.marked).toEqual([0, 2]);
        expect(p.index).toBe(0);
        expect(pickerReply(confirmMarked(p))).toEqual({ answers: [{ selectedindexes: [0, 2] }], cancelled: false });
    });
    it("clears the marks between questions", () => {
        const p = confirmMarked(pickOption(openPicker([sizes, sizes], "band"), 1));
        expect(p).toMatchObject({ index: 1, marked: [] });
    });
    it("takes typed text for any question, trimmed", () => {
        expect(pickerReply(typeOther(openPicker([sizes], "band"), "  XL  "))).toEqual({ answers: [{ text: "XL" }], cancelled: false });
    });
    it("ignores an option that is not there, an empty confirm and blank text", () => {
        const p = openPicker([sizes], "band");
        expect(pickOption(p, 7)).toBe(p);
        expect(confirmMarked(p)).toBe(p);
        expect(typeOther(p, "   ")).toBe(p);
        const done = pickOption(openPicker([color], "band"), 0);
        expect(pickOption(done, 0)).toBe(done);
    });
});

describe("answersFor", () => {
    it("maps indexes to labels, joins a multi-select, and uses typed text verbatim", () => {
        expect(
            answersFor([color, sizes, { ...color, question: "Again?" }], {
                answers: [{ selectedindexes: [1] }, { selectedindexes: [0, 2] }, { text: "Green, please" }],
                cancelled: false,
            })
        ).toEqual({ "Which color?": "Blue", "Which sizes?": "S, L", "Again?": "Green, please" });
    });
    it("leaves out an unanswered question and an index past the options", () => {
        expect(answersFor([color, sizes], { answers: [{ selectedindexes: [7] }], cancelled: false })).toEqual({});
    });
});
