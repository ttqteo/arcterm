import { describe, expect, it } from "vitest";
import { answersFor, askPayload, cardAnswer, cardCanAsk, DISMISS_GRACE_MS, parseAskReply, settleAsk } from "./ask-core";

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

describe("cardAnswer", () => {
    it("answers the call with the card's picks", () => {
        const questions = [color, sizes];
        expect(
            cardAnswer(questions, { answers: [{ selectedindexes: [0] }, { text: "XL" }], cancelled: false })
        ).toEqual({
            result: { questions, answers: { "Which color?": "Red", "Which sizes?": "XL" } },
        });
    });
    it("refuses the call when the card was dismissed", () => {
        expect(cardAnswer([color], { answers: [], cancelled: true })).toEqual({
            deny: "The user dismissed the question.",
        });
    });
    it("leaves the call to claude's dialog when the card never replied", () => {
        expect(cardAnswer([color], null)).toBeNull();
    });
});

describe("settleAsk", () => {
    const never = new Promise<never>(() => {});
    const isDismissal = (a: { deny?: string }) => a.deny !== undefined;
    const dismissed = { deny: "The user dismissed the question." };

    it("takes the dialog when it answers first", async () => {
        expect(await settleAsk(Promise.resolve("picked"), never, isDismissal, () => never)).toEqual({ dialog: "picked" });
    });

    it("takes the card's answer when it answers first", async () => {
        expect(await settleAsk(never, Promise.resolve({ result: 1 }), isDismissal, () => never)).toEqual({ card: { result: 1 } });
    });

    it("leaves the dialog alone when the card gave no reply", async () => {
        expect(await settleAsk(never, Promise.resolve(null), isDismissal, () => never)).toBeNull();
    });

    it("lets the dialog's answer win over a cancel that landed first, within the grace", async () => {
        let answer!: (v: string) => void;
        const dialog = new Promise<string>((resolve) => (answer = resolve));
        const waited: number[] = [];
        const settled = settleAsk(dialog, Promise.resolve(dismissed), isDismissal, (ms) => {
            waited.push(ms);
            answer("picked in the terminal");
            return never;
        });
        expect(await settled).toEqual({ dialog: "picked in the terminal" });
        expect(waited).toEqual([DISMISS_GRACE_MS]);
    });

    it("reads a cancel as dismissed when the dialog stays open past the grace", async () => {
        expect(await settleAsk(never, Promise.resolve(dismissed), isDismissal, () => Promise.resolve())).toEqual({ card: dismissed });
    });
});
